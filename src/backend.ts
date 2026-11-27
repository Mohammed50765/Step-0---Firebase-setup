import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import {
  arrayRemove,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  startAfter,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
  type QueryDocumentSnapshot,
  type Unsubscribe,
} from 'firebase/firestore';
import {
  applyAuthPersistencePreference,
  auth,
  authPersistenceReady,
  db,
  deleteUser,
  diagnoseConnection,
  disableTrustedDeviceCacheSafely,
  getAppCheckStatus,
  getAuthPersistenceMode,
  getLocalCacheMode,
  getRedirectResult,
  googleProvider,
  handleFirestoreError,
  isTrustedDeviceAuthEnabled,
  isTrustedDeviceCacheEnabled,
  OperationType,
  setTrustedDeviceCachePreference,
  signInWithRedirect,
  testConnection,
} from './firebase';
import {
  classifyAccountCleanupError,
  collectAccountDeletionTeamCandidates,
  planTeamAccountCleanup,
  purgePersistentTeamSnapshots,
  resolveSnapshotCacheTarget,
  scrubAllAccountLocalCaches,
  shouldAllowAuthAccountDeletion,
  type AccountCleanupFailure,
  type AccountDeletionTeamSnapshot,
  type AppCheckStatus,
  type AuthPersistenceMode,
} from './localCachePrivacy';
import './teamMultiplayer';
import {
  applyReportConfirmation,
  evaluateReportSubmissionGuard,
  MAX_ASSISTS_PER_MATCH,
  MAX_CONCEDED_PER_MATCH,
  MAX_GOALS_PER_MATCH,
  normalizeAttendanceStatus,
  REPORT_COOLDOWN_MS,
} from './teamMultiplayer';
import {
  clampNum,
  clampStr,
  computePeerAggregate,
  escapeHtml,
  generateSecureInviteCode,
  MAX_PENDING_JOIN_REQUESTS,
  ROYAL_PRIMARY,
  ROYAL_SECONDARY,
  sanitizeBackupImport,
  sanitizeDateStr,
  sanitizeFoot,
  sanitizeFormation,
  sanitizeHexColor,
  sanitizeImageDataUrl,
  sanitizeInviteCode,
  sanitizeMatchResult,
  sanitizePitchMode,
  sanitizePrimaryPos,
  sanitizeRoleOverride,
  sanitizeSecondaryPos,
  sanitizeSkills,
  sanitizeStarId,
  sanitizeStats6,
  stats6ToLegacySkills,
  TEAM_ID,
} from './security';
import {
  computeInviteStatus,
  createSmartInvitationRecord,
  normalizeInviteRecord,
  sanitizeReferralCode,
  validateInviteForJoin,
  type SmartInviteRecord,
} from './invitations';
import {
  isQuotaExceededError,
  QUOTA_EXCEEDED_ARABIC_MSG,
  quotaMonitor,
} from './quotaMonitor';
import { resolveEffectivePlayerName, sanitizePlayerDisplayName } from './authFlow';
import {
  buildAttendanceMatchKey,
  buildDefaultTeamCreatePayload,
  buildPrivacyNoticeAcceptedPayload,
  checkTeamQuotaEligibility,
  chunkItemsForBatch,
  DEFAULT_MAX_MEMBERS_PER_TEAM,
  findForbiddenPublicHealthFields,
  flattenConsolidatedAttendanceDocs,
  generateMultiTeamId,
  groupLegacyAttendanceByMatchKey,
  hasAcceptedCurrentPrivacyNotice,
  loadMigrationCheckpoint,
  markPrivacyNoticeAcceptedLocally,
  MAX_JOINED_TEAMS,
  MAX_OWNED_TEAMS,
  MIGRATION_BATCH_WRITE_LIMIT,
  normalizeAppAvailableStatus,
  normalizePublicAvailableStatus,
  PRIVACY_NOTICE_VERSION,
  sanitizeJoinMode,
  sanitizeLineupPublishMode,
  sanitizeTeamId,
  sanitizeTeamLogo50Kb,
  saveMigrationCheckpoint,
  sortActiveTeamsList,
  splitPlayerPublicAndPrivate,
  verifyMigrationCountReport,
  type MigrationCheckpoint,
  type MigrationCountRow,
  type MultiTeamMeta,
} from './multiTeamEngine';

const TEAM_CACHE_KEY = 'maydan_team_cache_v1';
const PAGE_SIZE_LIST = 20;

export interface TacticsSnapshotRecord {
  formation: string;
  slots: Record<string, string>;
  publishedByUid?: string;
  publishedByName?: string;
  publishedAtMs?: number;
}

export interface BackendState {
  settings: Record<string, unknown>;
  players: Array<Record<string, unknown>>;
  pendingPlayers: Array<Record<string, unknown>>;
  inviteCodes?: Array<Record<string, unknown>>;
  matches: Array<Record<string, unknown>>;
  reports: Array<Record<string, unknown>>;
  readiness: Array<Record<string, unknown>>;
  attendance: Array<Record<string, unknown>>;
  injuries: Array<Record<string, unknown>>;
  peerRatingStats: Record<string, { count: number; totalScore: number }>;
  peerRatings: Array<Record<string, unknown>>;
  adminRatings: Array<Record<string, unknown>>;
  tactics: TacticsSnapshotRecord & {
    previousSnapshot?: TacticsSnapshotRecord | null;
  };
  lineupVotes?: Record<string, string>;
  suggestions: Array<Record<string, unknown>>;
  pitchSession?: Record<string, unknown>;
  pitchPayments?: Array<Record<string, unknown>>;
  matchSessions?: Array<Record<string, unknown>>;
  matchVoteTallies?: Array<Record<string, unknown>>;
  missionClaims?: Array<Record<string, unknown>>;
  footballLibrary?: Array<Record<string, unknown>>;
}

function sanitizeTimeStr(raw: unknown, fallback = '20:30'): string {
  const s = String(raw || '').trim();
  return /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(s) ? s : fallback;
}

function makeId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function stripForbiddenHealthFields<T extends Record<string, unknown>>(obj: T): T {
  const leaked = findForbiddenPublicHealthFields(obj);
  if (!leaked.length) return obj;
  const copy = { ...obj };
  for (const k of leaked) delete copy[k];
  return copy;
}

function normalizeTeamDocToSettings(teamId: string, d: Record<string, unknown>): Record<string, unknown> {
  const joinMode = sanitizeJoinMode(d.joinMode ?? (d.requireApproval === false ? 'instant' : 'approval'));
  const lineupPublishMode = sanitizeLineupPublishMode(d.lineupPublishMode ?? d.lineupPermission);
  const founderUid = String(d.founderUid || d.creatorUid || '');
  return {
    ...d,
    id: teamId,
    teamId,
    appName: clampStr(d.appName || 'ميدان 6v6', 60) || 'ميدان 6v6',
    teamName: clampStr(d.teamName || 'فريق السداسي', 80) || 'فريق السداسي',
    primaryColor: sanitizeHexColor(d.primaryColor, ROYAL_PRIMARY),
    secondaryColor: sanitizeHexColor(d.secondaryColor, ROYAL_SECONDARY),
    logo: typeof d.logo === 'string' ? d.logo : '',
    founderUid,
    creatorUid: founderUid,
    organizerUids: Array.isArray(d.organizerUids) ? d.organizerUids : [],
    joinMode,
    requireApproval: joinMode === 'approval',
    lineupPublishMode,
    lineupPermission: lineupPublishMode,
    defaultCurrency: clampStr(d.defaultCurrency || 'ريال', 20) || 'ريال',
    defaultPitchCost: Math.max(0, Number(d.defaultPitchCost || 0)),
    maxMembersPerTeam: Math.max(6, Math.min(100, Number(d.maxMembersPerTeam || DEFAULT_MAX_MEMBERS_PER_TEAM))),
    memberCount: Math.max(0, Number(d.memberCount || 0)),
    lockSkills: Boolean(d.lockSkills),
    storageMode: 'multi',
  };
}

class MaydanBackendService {
  private coreUnsubs: Unsubscribe[] = [];
  private tabUnsubs: Unsubscribe[] = [];
  private activeUid: string | null = null;
  private activeIsCaptain = false;
  private activeTab: string | null = null;
  private activeState: BackendState | null = null;
  private activeOnUpdate: (() => void) | null = null;
  private activeOnError: ((msg: string) => void) | null = null;
  private photosMap: Record<string, { dataUrl: string; photoZoom: number; photoY: number }> = {};

  // Phase 6 Dual-Mode & Multi-Team runtime state
  activeStorageMode: 'single' | 'multi' | 'none' = 'none';
  activeTeamId: string = TEAM_ID;
  activeTeams: MultiTeamMeta[] = [];
  isPlatformOwner = false;
  platformConfig: { allowNewTeams: boolean } = { allowNewTeams: true };
  userDoc: Record<string, unknown> | null = null;
  reportsLastDoc: QueryDocumentSnapshot<DocumentData> | null = null;
  reportsHasMore = false;
  matchesLastDoc: QueryDocumentSnapshot<DocumentData> | null = null;
  matchesHasMore = false;

  init(): void {
    void testConnection();
  }

  isMultiMode(): boolean {
    return this.activeStorageMode === 'multi' && Boolean(this.activeTeamId && this.activeTeamId !== TEAM_ID);
  }

  private getSnapshotCacheKey(uid: string, teamId: string): string {
    if (teamId && teamId !== TEAM_ID) {
      return `${TEAM_CACHE_KEY}__${uid}__${teamId}`;
    }
    return TEAM_CACHE_KEY;
  }

  private isTeamOrganizer(uid: string): boolean {
    const s = (this.activeState?.settings || {}) as Record<string, unknown>;
    const orgs = Array.isArray(s.organizerUids) ? (s.organizerUids as string[]) : [];
    return this.activeIsCaptain || orgs.includes(uid);
  }

  onAuthChange(cb: (fbUser: User | null) => void): Unsubscribe {
    let innerUnsub: Unsubscribe | null = null;
    let cancelled = false;
    void authPersistenceReady.finally(() => {
      if (cancelled) return;
      innerUnsub = onAuthStateChanged(auth, cb);
    });
    return () => {
      cancelled = true;
      if (innerUnsub) innerUnsub();
    };
  }

  async consumeRedirectResult(): Promise<{ user: User | null; errorAr?: string }> {
    await authPersistenceReady;
    try {
      const res = await getRedirectResult(auth);
      return { user: res?.user ?? null };
    } catch (err: unknown) {
      const code = (err && typeof err === 'object' && 'code' in err)
        ? String((err as { code?: unknown }).code || '')
        : '';
      if (code === 'auth/unauthorized-domain') {
        return {
          user: null,
          errorAr: 'النطاق الحالي غير مضاف في إعدادات Firebase Auth (Authorized domains). افتح عبر chromatic-instrument-dpz3c.firebaseapp.com أو أضف النطاق في وحدة التحكم.',
        };
      }
      return { user: null };
    }
  }

  async signInWithGoogle(): Promise<User | null> {
    await authPersistenceReady;
    try {
      const cred = await signInWithPopup(auth, googleProvider);
      return cred.user;
    } catch (err: unknown) {
      const code = (err && typeof err === 'object' && 'code' in err)
        ? String((err as { code?: unknown }).code || '')
        : '';
      if (
        code === 'auth/popup-blocked' ||
        code === 'auth/cancelled-popup-request' ||
        code === 'auth/operation-not-supported-in-this-environment'
      ) {
        await signInWithRedirect(auth, googleProvider);
        return null;
      }
      if (code === 'auth/unauthorized-domain') {
        throw new Error(
          'تعذّر تسجيل الدخول: هذا النطاق غير مصرّح به في Firebase Auth. أضف النطاق الحالي إلى Authorized domains أو افتح عبر chromatic-instrument-dpz3c.firebaseapp.com.'
        );
      }
      if (code === 'auth/popup-closed-by-user') {
        throw new Error('تم إغلاق نافذة تسجيل الدخول قبل الإتمام.');
      }
      if (code === 'auth/network-request-failed') {
        throw new Error('تعذّر الاتصال بخدمة Google — تحقّق من الشبكة وأعد المحاولة.');
      }
      throw new Error('تعذّر إتمام تسجيل الدخول بحساب Google، حاول مجدداً.');
    }
  }

  async signOut(): Promise<void> {
    this.clearSessionData();
    await signOut(auth);
  }

  getLocalCacheMode(): 'memory' | 'persistent' {
    return getLocalCacheMode();
  }

  getAuthPersistenceMode(): AuthPersistenceMode {
    return getAuthPersistenceMode();
  }

  isTrustedDeviceAuthEnabled(): boolean {
    return isTrustedDeviceAuthEnabled();
  }

  async applyAuthPersistencePreference(
    rememberOnTrustedDevice: boolean
  ): Promise<{ enabled: boolean; mode: AuthPersistenceMode }> {
    return applyAuthPersistencePreference(rememberOnTrustedDevice);
  }

  isTrustedDeviceCacheEnabled(): boolean {
    return isTrustedDeviceCacheEnabled();
  }

  setTrustedDeviceCachePreference(enabled: boolean): { enabled: boolean; requiresReload: boolean } {
    if (!enabled) {
      purgePersistentTeamSnapshots();
    }
    return setTrustedDeviceCachePreference(enabled);
  }

  async disableTrustedDeviceCacheSafely(): Promise<{
    enabled: false;
    indexedDbAttempted: boolean;
    indexedDbCleared: boolean;
    requiresReload: boolean;
    errorCode?: string;
    messageAr: string;
  }> {
    this.stopListeners();
    return disableTrustedDeviceCacheSafely();
  }

  getAppCheckStatus(): AppCheckStatus {
    return getAppCheckStatus();
  }

  async diagnoseConnection() {
    return diagnoseConnection();
  }

  clearSessionData(): void {
    this.stopListeners();
    this.activeUid = null;
    this.activeIsCaptain = false;
    this.activeTab = null;
    this.activeState = null;
    this.activeOnUpdate = null;
    this.activeOnError = null;
    this.photosMap = {};
    this.activeStorageMode = 'none';
    this.activeTeamId = TEAM_ID;
    this.activeTeams = [];
    this.isPlatformOwner = false;
    this.userDoc = null;
    this.reportsLastDoc = null;
    this.reportsHasMore = false;
    this.matchesLastDoc = null;
    this.matchesHasMore = false;
    scrubAllAccountLocalCaches();
    try {
      if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({ type: 'CLEAR_ALL_CACHES' });
      }
    } catch {
      // Ignore SW messaging failures
    }
  }

  private stopTabListeners(): void {
    for (const u of this.tabUnsubs) {
      try {
        u();
      } catch {
        // ignore unsubscribe cleanup errors
      }
    }
    this.tabUnsubs = [];
    this.activeTab = null;
    quotaMonitor.setActiveListeners(this.getActiveListenerCount());
  }

  stopListeners(): void {
    this.stopTabListeners();
    for (const u of this.coreUnsubs) {
      try {
        u();
      } catch {
        // ignore unsubscribe cleanup errors
      }
    }
    this.coreUnsubs = [];
    quotaMonitor.setActiveListeners(0);
  }

  getActiveListenerCount(): number {
    return this.coreUnsubs.length + this.tabUnsubs.length;
  }

  private saveTeamSnapshotCache(state: BackendState): void {
    try {
      if (!this.activeUid) return;
      const target = resolveSnapshotCacheTarget();
      const store =
        target === 'local'
          ? typeof localStorage !== 'undefined'
            ? localStorage
            : null
          : typeof sessionStorage !== 'undefined'
            ? sessionStorage
            : null;

      // In shared-device safe mode ('session'), actively ensure zero team snapshots linger in localStorage.
      if (target === 'session') {
        purgePersistentTeamSnapshots();
      }
      if (!store) return;

      const leanPlayers = (state.players || []).map((p) => {
        const copy = { ...p };
        delete copy.photo;
        return copy;
      });
      const safeSettings = { ...(state.settings || {}) };
      delete safeSettings.inviteCode;
      const key = this.getSnapshotCacheKey(this.activeUid, this.activeTeamId);
      store.setItem(
        key,
        JSON.stringify({
          ownerUid: this.activeUid,
          teamId: this.activeTeamId,
          settings: safeSettings,
          players: leanPlayers,
          pitchSession: state.pitchSession || null,
          cachedAt: Date.now(),
        })
      );
    } catch {
      // Ignore storage quota errors
    }
  }

  loadTeamSnapshotCache(expectedUid?: string, teamId?: string): {
    ownerUid?: string;
    teamId?: string;
    settings?: Record<string, unknown>;
    players?: Array<Record<string, unknown>>;
    pitchSession?: Record<string, unknown> | null;
    cachedAt?: number;
  } | null {
    try {
      const target = resolveSnapshotCacheTarget();
      if (target === 'session') {
        purgePersistentTeamSnapshots();
      }
      const store =
        target === 'local'
          ? typeof localStorage !== 'undefined'
            ? localStorage
            : null
          : typeof sessionStorage !== 'undefined'
            ? sessionStorage
            : null;
      if (!store) return null;
      const uid = expectedUid || this.activeUid || '';
      const tid = teamId || this.activeTeamId || TEAM_ID;
      const key = this.getSnapshotCacheKey(uid, tid);
      const raw = store.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (expectedUid && parsed?.ownerUid !== expectedUid) {
        store.removeItem(key);
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  private handleListenerError(
    err: unknown,
    op: OperationType,
    path: string,
    onError: (msg: string) => void
  ): void {
    if (isQuotaExceededError(err)) {
      quotaMonitor.markQuotaExceeded(true);
      onError(QUOTA_EXCEEDED_ARABIC_MSG);
      return;
    }
    onError('تعذّر تحديث بعض البيانات من الخادم.');
    try {
      handleFirestoreError(err, op, path);
    } catch {
      // Logged by handleFirestoreError
    }
  }

  private handleWriteError(err: unknown, op: OperationType, path: string): never {
    if (isQuotaExceededError(err)) {
      quotaMonitor.markQuotaExceeded(true);
      throw new Error(QUOTA_EXCEEDED_ARABIC_MSG);
    }
    handleFirestoreError(err, op, path);
  }

  private async fetchPlatformConfig(): Promise<{ allowNewTeams: boolean }> {
    try {
      const snap = await getDoc(doc(db, 'platform', 'config'));
      quotaMonitor.recordReads('session', 1);
      if (snap.exists()) {
        const allow = snap.data().allowNewTeams !== false;
        this.platformConfig = { allowNewTeams: allow };
        return this.platformConfig;
      }
    } catch (err) {
      if (isQuotaExceededError(err)) {
        quotaMonitor.markQuotaExceeded(true);
      } else {
        console.warn('platform/config read notice:', err instanceof Error ? err.message : String(err));
      }
    }
    this.platformConfig = { allowNewTeams: true };
    return this.platformConfig;
  }

  private async loadUserMultiTeams(uid: string, userDocData: Record<string, unknown> | null): Promise<MultiTeamMeta[]> {
    const rawIds = Array.isArray(userDocData?.teamIds)
      ? (userDocData!.teamIds as unknown[]).map((x) => sanitizeTeamId(x)).filter(Boolean)
      : [];
    const candidateIds = Array.from(new Set(rawIds)).slice(0, MAX_JOINED_TEAMS);
    if (!candidateIds.length) return [];

    const results = await Promise.all(
      candidateIds.map(async (tid) => {
        try {
          const [tSnap, mSnap] = await Promise.all([
            getDoc(doc(db, 'teams', tid)),
            getDoc(doc(db, 'teams', tid, 'members', uid)),
          ]);
          quotaMonitor.recordReads('session', 2);
          if (!tSnap.exists() || !mSnap.exists()) return null;
          const td = tSnap.data();
          if (td.deletedAt) return null;
          const norm = normalizeTeamDocToSettings(tid, td);
          return norm as unknown as MultiTeamMeta;
        } catch (err) {
          if (isQuotaExceededError(err)) {
            quotaMonitor.markQuotaExceeded(true);
          }
          return null;
        }
      })
    );
    return results.filter((t): t is MultiTeamMeta => Boolean(t));
  }

  async resolveSession(fbUser: User): Promise<{
    status: 'ready' | 'pending' | 'rejected' | 'needs_join';
    mode: 'single' | 'multi' | 'none';
    isCaptain: boolean;
    isPlatformOwner: boolean;
    teams: MultiTeamMeta[];
    activeTeamId: string;
    platformConfig: { allowNewTeams: boolean };
    userDoc: Record<string, unknown> | null;
    canMigrateLegacyTeam: boolean;
    needsPrivacyNotice: boolean;
    captainDiagnostic: {
      code: 'verified' | 'not_found' | 'email_unverified' | 'error';
      detail?: string;
    };
    branding?: Record<string, unknown>;
    joinRequest?: Record<string, unknown>;
  }> {
    this.clearSessionData();
    this.activeUid = fbUser.uid;
    let isPlatformOwner = false;
    let captainDiagnostic: {
      code: 'verified' | 'not_found' | 'email_unverified' | 'error';
      detail?: string;
    } = { code: 'not_found' };

    if (!fbUser.emailVerified) {
      captainDiagnostic = {
        code: 'email_unverified',
        detail: 'البريد الإلكتروني للحساب غير موثّق (emailVerified=false)، فتمنع القواعد قراءة admins/{uid}.',
      };
    } else {
      try {
        const admSnap = await getDoc(doc(db, 'admins', fbUser.uid));
        quotaMonitor.recordReads('session', 1);
        isPlatformOwner = admSnap.exists();
        captainDiagnostic = { code: isPlatformOwner ? 'verified' : 'not_found' };
      } catch (err) {
        if (isQuotaExceededError(err)) {
          quotaMonitor.markQuotaExceeded(true);
          throw new Error(QUOTA_EXCEEDED_ARABIC_MSG);
        }
        isPlatformOwner = false;
        const errMsg = err instanceof Error ? err.message : String(err);
        console.warn('Captain admins/{uid} verification error:', errMsg);
        captainDiagnostic = {
          code: 'error',
          detail: errMsg,
        };
      }
    }
    this.isPlatformOwner = isPlatformOwner;

    const platformConfig = await this.fetchPlatformConfig();

    // Load or initialize user registry doc users/{uid}
    let userDoc: Record<string, unknown> | null = null;
    try {
      const uSnap = await getDoc(doc(db, 'users', fbUser.uid));
      quotaMonitor.recordReads('session', 1);
      if (uSnap.exists()) {
        userDoc = { uid: fbUser.uid, ...uSnap.data() };
      }
    } catch (err) {
      if (isQuotaExceededError(err)) {
        quotaMonitor.markQuotaExceeded(true);
        throw new Error(QUOTA_EXCEEDED_ARABIC_MSG);
      }
      console.warn('users/{uid} read notice:', err instanceof Error ? err.message : String(err));
    }
    this.userDoc = userDoc;

    // 0) Auto-promote approved pendingJoinTeamId into userDoc.teamIds cleanly without cross-user write
    const pendingJoinTid = sanitizeTeamId(userDoc?.pendingJoinTeamId);
    if (pendingJoinTid && pendingJoinTid !== TEAM_ID) {
      const existingIds = Array.isArray(userDoc?.teamIds)
        ? (userDoc!.teamIds as unknown[]).map((x) => sanitizeTeamId(x)).filter(Boolean)
        : [];
      if (!existingIds.includes(pendingJoinTid)) {
        try {
          const [jrCheck, memCheck] = await Promise.all([
            getDoc(doc(db, 'teams', pendingJoinTid, 'joinRequests', fbUser.uid)),
            getDoc(doc(db, 'teams', pendingJoinTid, 'members', fbUser.uid)),
          ]);
          quotaMonitor.recordReads('session', 2);
          if (jrCheck.exists() && jrCheck.data().status === 'approved' && memCheck.exists()) {
            const nextTeamIds = Array.from(new Set([...existingIds, pendingJoinTid])).slice(0, MAX_JOINED_TEAMS);
            await setDoc(
              doc(db, 'users', fbUser.uid),
              {
                uid: fbUser.uid,
                teamIds: nextTeamIds,
                activeTeamId: pendingJoinTid,
                pendingJoinTeamId: '',
                updatedAt: serverTimestamp(),
              },
              { merge: true }
            );
            userDoc = { ...(userDoc || { uid: fbUser.uid }), teamIds: nextTeamIds, activeTeamId: pendingJoinTid, pendingJoinTeamId: '' };
            this.userDoc = userDoc;
          }
        } catch {
          // ignore non-fatal promotion check
        }
      }
    }

    // 1) Multi-Team Mode resolution first if user belongs to >= 1 active isolated team
    const activeMultiTeams = await this.loadUserMultiTeams(fbUser.uid, userDoc);
    if (activeMultiTeams.length > 0) {
      const preferredTid = sanitizeTeamId(userDoc?.activeTeamId);
      const chosen =
        activeMultiTeams.find((t) => t.id === preferredTid) || activeMultiTeams[0];
      const sortedTeams = sortActiveTeamsList(activeMultiTeams, chosen.id);
      this.activeStorageMode = 'multi';
      this.activeTeamId = chosen.id;
      this.activeTeams = sortedTeams;
      const isFounder = chosen.founderUid === fbUser.uid;
      this.activeIsCaptain = isFounder;

      // Sync ownedTeamIds cleanly in case founder leadership was transferred to this UID
      try {
        const actualOwned = sortedTeams.filter((t) => t.founderUid === fbUser.uid).map((t) => t.id);
        const storedOwned = Array.isArray(userDoc?.ownedTeamIds)
          ? (userDoc!.ownedTeamIds as string[])
          : [];
        const mismatch =
          actualOwned.length !== storedOwned.length ||
          actualOwned.some((id) => !storedOwned.includes(id));
        if (mismatch && userDoc) {
          await setDoc(
            doc(db, 'users', fbUser.uid),
            {
              uid: fbUser.uid,
              ownedTeamIds: actualOwned,
              teamIds: sortedTeams.map((t) => t.id),
              activeTeamId: chosen.id,
              updatedAt: serverTimestamp(),
            },
            { merge: true }
          );
          userDoc.ownedTeamIds = actualOwned;
        }
      } catch {
        // non-blocking sync
      }

      const needsPrivacyNotice = !hasAcceptedCurrentPrivacyNotice(userDoc, fbUser.uid);
      return {
        status: 'ready',
        mode: 'multi',
        isCaptain: isFounder,
        isPlatformOwner,
        teams: sortedTeams,
        activeTeamId: chosen.id,
        platformConfig,
        userDoc,
        canMigrateLegacyTeam: Boolean(isPlatformOwner && !userDoc?.migratedToTeamId),
        needsPrivacyNotice,
        captainDiagnostic,
      };
    }

    // 2) Single-Team Legacy Fallback (keeps original team 100% operational pre-migration)
    const migratedTid = sanitizeTeamId(userDoc?.migratedToTeamId);
    if (!migratedTid) {
      if (isPlatformOwner) {
        await this.bootstrapCaptainWorkspace(fbUser);
        this.activeStorageMode = 'single';
        this.activeTeamId = TEAM_ID;
        this.activeIsCaptain = true;
        return {
          status: 'ready',
          mode: 'single',
          isCaptain: true,
          isPlatformOwner: true,
          teams: [],
          activeTeamId: TEAM_ID,
          platformConfig,
          userDoc,
          canMigrateLegacyTeam: true,
          needsPrivacyNotice: !hasAcceptedCurrentPrivacyNotice(userDoc, fbUser.uid),
          captainDiagnostic,
        };
      }

      let playerSnap;
      try {
        playerSnap = await getDoc(doc(db, 'players', fbUser.uid));
        quotaMonitor.recordReads('session', 1);
      } catch (err) {
        this.handleWriteError(err, OperationType.GET, `players/${fbUser.uid}`);
      }

      if (playerSnap.exists()) {
        this.activeStorageMode = 'single';
        this.activeTeamId = TEAM_ID;
        this.activeIsCaptain = false;
        return {
          status: 'ready',
          mode: 'single',
          isCaptain: false,
          isPlatformOwner: false,
          teams: [],
          activeTeamId: TEAM_ID,
          platformConfig,
          userDoc,
          canMigrateLegacyTeam: false,
          needsPrivacyNotice: !hasAcceptedCurrentPrivacyNotice(userDoc, fbUser.uid),
          captainDiagnostic,
        };
      }
    }

    // 3) Check pending Multi-Team join request (if stored in users/{uid}.pendingJoinTeamId)
    const pendingTeamId = sanitizeTeamId(userDoc?.pendingJoinTeamId);
    if (pendingTeamId && pendingTeamId !== TEAM_ID) {
      try {
        const jrSnap = await getDoc(doc(db, 'teams', pendingTeamId, 'joinRequests', fbUser.uid));
        quotaMonitor.recordReads('session', 1);
        if (jrSnap.exists()) {
          const jr = jrSnap.data();
          let tData: Record<string, unknown> = {};
          try {
            const tSnap = await getDoc(doc(db, 'teams', pendingTeamId));
            quotaMonitor.recordReads('session', 1);
            if (tSnap.exists()) tData = tSnap.data();
          } catch {
            // fallback to invite/default metadata if team doc is unavailable
          }
          const teamBrand = {
            teamName: tData.teamName || 'فريق السداسي',
            appName: tData.appName || 'ميدان 6v6',
            primaryColor: tData.primaryColor || ROYAL_PRIMARY,
            secondaryColor: tData.secondaryColor || ROYAL_SECONDARY,
            logo: tData.logo || '',
          };
          if (jr.status === 'pending') {
            return {
              status: 'pending',
              mode: 'none',
              isCaptain: false,
              isPlatformOwner,
              teams: [],
              activeTeamId: pendingTeamId,
              platformConfig,
              userDoc,
              canMigrateLegacyTeam: false,
              needsPrivacyNotice: !hasAcceptedCurrentPrivacyNotice(userDoc, fbUser.uid),
              captainDiagnostic,
              branding: teamBrand,
              joinRequest: { ...jr, teamName: teamBrand.teamName },
            };
          }
          if (jr.status === 'rejected') {
            return {
              status: 'rejected',
              mode: 'none',
              isCaptain: false,
              isPlatformOwner,
              teams: [],
              activeTeamId: pendingTeamId,
              platformConfig,
              userDoc,
              canMigrateLegacyTeam: false,
              needsPrivacyNotice: !hasAcceptedCurrentPrivacyNotice(userDoc, fbUser.uid),
              captainDiagnostic,
              branding: teamBrand,
              joinRequest: { ...jr, teamName: teamBrand.teamName },
            };
          }
        }
      } catch (err) {
        console.warn('Multi-team pending request check notice:', err instanceof Error ? err.message : String(err));
      }
    }

    // 4) Legacy Single-Team pending/rejected check + public branding
    let branding: Record<string, unknown> | undefined;
    try {
      const bSnap = await getDoc(doc(db, 'publicMeta', 'branding'));
      quotaMonitor.recordReads('session', 1);
      if (bSnap.exists()) branding = bSnap.data();
    } catch (err) {
      if (isQuotaExceededError(err)) {
        quotaMonitor.markQuotaExceeded(true);
      } else {
        console.warn('publicMeta/branding read notice:', err instanceof Error ? err.message : String(err));
      }
    }

    try {
      const jrSnap = await getDoc(doc(db, 'joinRequests', fbUser.uid));
      quotaMonitor.recordReads('session', 1);
      if (jrSnap.exists()) {
        const jr = jrSnap.data();
        if (jr.status === 'pending') {
          return {
            status: 'pending',
            mode: 'none',
            isCaptain: false,
            isPlatformOwner,
            teams: [],
            activeTeamId: TEAM_ID,
            platformConfig,
            userDoc,
            canMigrateLegacyTeam: false,
            needsPrivacyNotice: !hasAcceptedCurrentPrivacyNotice(userDoc, fbUser.uid),
            captainDiagnostic,
            branding,
            joinRequest: jr,
          };
        }
        if (jr.status === 'rejected') {
          return {
            status: 'rejected',
            mode: 'none',
            isCaptain: false,
            isPlatformOwner,
            teams: [],
            activeTeamId: TEAM_ID,
            platformConfig,
            userDoc,
            canMigrateLegacyTeam: false,
            needsPrivacyNotice: !hasAcceptedCurrentPrivacyNotice(userDoc, fbUser.uid),
            captainDiagnostic,
            branding,
            joinRequest: jr,
          };
        }
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, `joinRequests/${fbUser.uid}`);
    }

    this.activeStorageMode = 'none';
    return {
      status: 'needs_join',
      mode: 'none',
      isCaptain: false,
      isPlatformOwner,
      teams: [],
      activeTeamId: '',
      platformConfig,
      userDoc,
      canMigrateLegacyTeam: Boolean(isPlatformOwner && !migratedTid),
      needsPrivacyNotice: !hasAcceptedCurrentPrivacyNotice(userDoc, fbUser.uid),
      captainDiagnostic,
      branding,
    };
  }

  private async bootstrapCaptainWorkspace(fbUser: User): Promise<void> {
    const settingsRef = doc(db, 'settings', 'team');
    let settingsSnap;
    try {
      settingsSnap = await getDoc(settingsRef);
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, 'settings/team');
    }

    if (!settingsSnap.exists()) {
      const authCtx = { isFirebaseMode: true, isCaptainSession: true };
      const initialRec = createSmartInvitationRecord(
        {
          teamName: 'فريق السداسي',
          appName: 'ميدان 6v6',
          primaryColor: ROYAL_PRIMARY,
          requireApproval: true,
          isMemberShareCode: false,
          usageType: 'single',
          maxUses: 1,
          durationDays: 7,
        },
        authCtx
      );
      const memberShareRec = createSmartInvitationRecord(
        {
          teamName: 'فريق السداسي',
          appName: 'ميدان 6v6',
          primaryColor: ROYAL_PRIMARY,
          requireApproval: true,
          isMemberShareCode: true,
          usageType: 'multi',
          maxUses: 100,
          durationDays: 90,
        },
        authCtx
      );
      const initialCode = initialRec.code;
      const memberShareCode = memberShareRec.code;
      const batch = writeBatch(db);
      batch.set(settingsRef, {
        teamId: TEAM_ID,
        appName: 'ميدان 6v6',
        teamName: 'فريق السداسي',
        primaryColor: ROYAL_PRIMARY,
        secondaryColor: ROYAL_SECONDARY,
        logo: '',
        inviteCode: initialCode,
        memberShareCode,
        requireApproval: true,
        lockSkills: false,
        themeVersion: 'royal_v2',
        creatorUid: fbUser.uid,
        organizerUids: [fbUser.uid],
        lineupPermission: 'all',
        defaultCurrency: 'ريال',
        defaultPitchCost: 0,
        updatedAt: serverTimestamp(),
      });
      batch.set(doc(db, 'publicMeta', 'branding'), {
        appName: 'ميدان 6v6',
        teamName: 'فريق السداسي',
        primaryColor: ROYAL_PRIMARY,
        secondaryColor: ROYAL_SECONDARY,
        logo: '',
        updatedAt: serverTimestamp(),
      });
      batch.set(doc(db, 'inviteCodes', initialCode), {
        code: initialCode,
        active: true,
        requireApproval: true,
        isMemberShareCode: false,
        teamId: TEAM_ID,
        teamName: 'فريق السداسي',
        appName: 'ميدان 6v6',
        primaryColor: ROYAL_PRIMARY,
        usageType: initialRec.usageType,
        maxUses: initialRec.maxUses,
        usedCount: 0,
        durationDays: initialRec.durationDays,
        createdAtMs: initialRec.createdAtMs,
        expiresAtMs: initialRec.expiresAtMs,
        status: 'active',
        updatedAt: serverTimestamp(),
      });
      batch.set(doc(db, 'inviteAdminLogs', initialCode), {
        code: initialCode,
        createdBy: fbUser.uid,
        createdAtMs: initialRec.createdAtMs,
        updatedAt: serverTimestamp(),
      });
      batch.set(doc(db, 'inviteCodes', memberShareCode), {
        code: memberShareCode,
        active: true,
        requireApproval: true,
        isMemberShareCode: true,
        teamId: TEAM_ID,
        teamName: 'فريق السداسي',
        appName: 'ميدان 6v6',
        primaryColor: ROYAL_PRIMARY,
        usageType: memberShareRec.usageType,
        maxUses: memberShareRec.maxUses,
        usedCount: 0,
        durationDays: memberShareRec.durationDays,
        createdAtMs: memberShareRec.createdAtMs,
        expiresAtMs: memberShareRec.expiresAtMs,
        status: 'active',
        updatedAt: serverTimestamp(),
      });
      batch.set(doc(db, 'inviteAdminLogs', memberShareCode), {
        code: memberShareCode,
        createdBy: fbUser.uid,
        createdAtMs: memberShareRec.createdAtMs,
        updatedAt: serverTimestamp(),
      });
      batch.set(doc(db, 'tactics', 'current'), {
        teamId: TEAM_ID,
        formation: '2-2-1',
        slots: {},
        updatedAt: serverTimestamp(),
      });
      try {
        await batch.commit();
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, 'settings/team');
      }
    }

    const captainPlayerRef = doc(db, 'players', fbUser.uid);
    let capSnap;
    try {
      capSnap = await getDoc(captainPlayerRef);
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, `players/${fbUser.uid}`);
    }

    if (!capSnap.exists()) {
      const { name: displayName } = resolveEffectivePlayerName({
        savedName: '',
        googleDisplayName: fbUser.displayName,
        email: fbUser.email,
        fallback: 'الكابتن',
      });
      try {
        await setDoc(captainPlayerRef, {
          id: fbUser.uid,
          teamId: TEAM_ID,
          ownerUid: fbUser.uid,
          name: displayName,
          role: 'admin',
          jersey: 10,
          age: 20,
          height: 176,
          weight: 70,
          foot: 'يمين',
          primaryPos: 'لاعب وسط',
          secondaryPos: 'جناح',
          photoZoom: 105,
          photoY: 18,
          hasPhoto: false,
          skills: sanitizeSkills({
            speed: 7,
            shooting: 7,
            passing: 8,
            dribbling: 7,
            defending: 5,
            stamina: 7,
            vision: 8,
            teamwork: 7,
            control: 7,
            positioning: 6,
          }),
          top3Strengths: '',
          weak3Points: '',
          seasonGoal: '',
          availability: '',
          availableStatus: 'available',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, `players/${fbUser.uid}`);
      }
    }
  }

  /**
   * Look up a single invitation document by exact CSPRNG code to preview
   * Team Name, Identity, Join Mode, and Remaining Quota before confirming join.
   */
  async inspectInviteCode(rawCode: string): Promise<{
    exists: boolean;
    valid: boolean;
    errorAr?: string;
    record?: SmartInviteRecord;
    statusInfo?: ReturnType<typeof computeInviteStatus>;
  }> {
    const code = sanitizeInviteCode(rawCode);
    if (!code) {
      return {
        exists: false,
        valid: false,
        errorAr: 'كود الدعوة غير صالح (يجب أن يكون بالصيغة MDN-XXXX-XXXX)',
      };
    }

    const fbUser = auth.currentUser;
    if (!fbUser || !fbUser.emailVerified) {
      return {
        exists: false,
        valid: false,
        errorAr: 'يرجى تسجيل الدخول بحساب Google أولاً للتحقق من كود الدعوة',
      };
    }

    try {
      const snap = await getDoc(doc(db, 'inviteCodes', code));
      quotaMonitor.recordReads('oneShot', 1);
      if (!snap.exists()) {
        return {
          exists: false,
          valid: false,
          errorAr: 'كود الدعوة غير صحيح أو غير موجود',
        };
      }
      const record = normalizeInviteRecord({ code, ...snap.data() });
      if (!record) {
        return {
          exists: false,
          valid: false,
          errorAr: 'كود الدعوة غير صالح',
        };
      }
      const statusInfo = computeInviteStatus(record);
      return {
        exists: true,
        valid: statusInfo.status === 'active',
        errorAr: statusInfo.status === 'active' ? undefined : statusInfo.reasonAr,
        record,
        statusInfo,
      };
    } catch (err) {
      if (isQuotaExceededError(err)) {
        quotaMonitor.markQuotaExceeded(true);
        return {
          exists: false,
          valid: false,
          errorAr: QUOTA_EXCEEDED_ARABIC_MSG,
        };
      }
      console.warn('inspectInviteCode error:', err instanceof Error ? err.message : String(err));
      return {
        exists: false,
        valid: false,
        errorAr: 'تعذّر التحقق من كود الدعوة حالياً — تحقق من الشبكة وأعد المحاولة.',
      };
    }
  }

  async submitJoinWithCode(input: {
    inviteCode: string;
    name: string;
    jersey: number;
    primaryPos: string;
    stats6?: Record<string, unknown>;
    roleOverride?: string;
    referredBy?: string;
    hasExistingPersonalTeam?: boolean;
    confirmedTeamSwitch?: boolean;
  }): Promise<{ joinedDirectly: boolean; teamName?: string; teamId?: string }> {
    const fbUser = auth.currentUser;
    if (!fbUser || !fbUser.emailVerified) {
      throw new Error('يرجى تسجيل الدخول بحساب Google أولاً');
    }

    const code = sanitizeInviteCode(input.inviteCode);
    if (!code) throw new Error('كود الدعوة غير صالح (يجب أن يكون 8 خانات على الأقل)');

    const cleanName = clampStr(input.name || fbUser.displayName || 'لاعب جديد', 80) || 'لاعب جديد';
    const cleanJersey = Math.round(clampNum(input.jersey, 1, 99, 7));
    const cleanPos = sanitizePrimaryPos(input.primaryPos);
    const cleanStats6 = sanitizeStats6(input.stats6);
    const cleanRoleOverride = sanitizeRoleOverride(input.roleOverride);
    const cleanReferredBy = sanitizeReferralCode(input.referredBy);

    // Pre-inspect invite target teamId so we can dispatch to Multi-Team or legacy Single-Team
    let preInviteSnap;
    try {
      preInviteSnap = await getDoc(doc(db, 'inviteCodes', code));
      quotaMonitor.recordReads('oneShot', 1);
    } catch (err) {
      this.handleWriteError(err, OperationType.GET, `inviteCodes/${code}`);
    }
    if (!preInviteSnap.exists()) {
      throw new Error('كود الدعوة غير صحيح أو غير موجود');
    }
    const targetTeamId = sanitizeTeamId(preInviteSnap.data().teamId) || TEAM_ID;

    // ===== Multi-Team Join Path (`teams/{teamId}`) =====
    if (targetTeamId !== TEAM_ID) {
      const joinedTeamIds = Array.isArray(this.userDoc?.teamIds)
        ? (this.userDoc!.teamIds as string[])
        : this.activeTeams.map((t) => t.id);
      try {
        return await runTransaction(db, async (tx) => {
          const inviteRef = doc(db, 'inviteCodes', code);
          const teamRef = doc(db, 'teams', targetTeamId);
          const memberRef = doc(db, 'teams', targetTeamId, 'members', fbUser.uid);
          const jrRef = doc(db, 'teams', targetTeamId, 'joinRequests', fbUser.uid);
          const userRef = doc(db, 'users', fbUser.uid);

          const [inviteSnap, memberSnap, jrSnap, userSnap] = await Promise.all([
            tx.get(inviteRef),
            tx.get(memberRef),
            tx.get(jrRef),
            tx.get(userRef),
          ]);

          const uData = userSnap.exists() ? userSnap.data() : {};
          const currentJoined = Array.isArray(uData.teamIds) ? (uData.teamIds as string[]) : joinedTeamIds;

          const quotaCheck = checkTeamQuotaEligibility({
            action: 'join',
            joinedTeamIds: currentJoined,
            targetTeamId,
            maxMembersPerTeam: DEFAULT_MAX_MEMBERS_PER_TEAM,
            currentMemberCount: 0,
          });
          if (!quotaCheck.allowed) {
            throw new Error(quotaCheck.errorAr || 'لا يمكن الانضمام لهذا الفريق حالياً.');
          }

          const rawInvite = inviteSnap.exists() ? { code, ...inviteSnap.data() } : null;
          const hasPendingRequest = jrSnap.exists() && jrSnap.data().status === 'pending';

          const validation = validateInviteForJoin({
            invite: rawInvite,
            applicantUid: fbUser.uid,
            existingPlayers: memberSnap.exists() ? [{ id: fbUser.uid, ownerUid: fbUser.uid }] : [],
            existingJoinRequestStatus: hasPendingRequest ? 'pending' : null,
            hasExistingPersonalTeam: Boolean(input.hasExistingPersonalTeam),
            confirmedTeamSwitch: Boolean(input.confirmedTeamSwitch),
          });
          if (!validation.valid || !validation.normalizedInvite) {
            throw new Error(validation.errorMessageAr || 'كود الدعوة غير صالح أو منتهي الصلاحية');
          }

          const inviteData = inviteSnap.data() || {};
          const isMemberShareCode = inviteData.isMemberShareCode === true;
          const requireApproval = isMemberShareCode
            ? true
            : inviteData.joinMode === 'instant' || inviteData.requireApproval === false
              ? false
              : inviteData.requireApproval !== false;
          const teamName = clampStr(inviteData.teamName || 'فريق السداسي', 80) || 'فريق السداسي';

          if ('maxUses' in inviteData && 'usedCount' in inviteData) {
            const maxUses = Math.max(1, Number(inviteData.maxUses || 1));
            const nextUsedCount = Math.max(0, Number(inviteData.usedCount || 0)) + 1;
            tx.update(inviteRef, {
              usedCount: nextUsedCount,
              active: nextUsedCount < maxUses,
              status: nextUsedCount >= maxUses ? 'completed' : 'active',
              updatedAt: serverTimestamp(),
            });
          }

          if (requireApproval) {
            const jrDoc: Record<string, unknown> = {
              uid: fbUser.uid,
              teamId: targetTeamId,
              name: cleanName,
              jersey: cleanJersey,
              primaryPos: cleanPos,
              inviteCode: code,
              status: 'pending',
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            };
            if (cleanStats6) jrDoc.stats6 = cleanStats6;
            if (cleanRoleOverride) jrDoc.roleOverride = cleanRoleOverride;
            if (cleanReferredBy) jrDoc.referredBy = cleanReferredBy;
            tx.set(jrRef, jrDoc);
            tx.set(
              userRef,
              {
                uid: fbUser.uid,
                pendingJoinTeamId: targetTeamId,
                updatedAt: serverTimestamp(),
              },
              { merge: true }
            );
            return { joinedDirectly: false, teamName, teamId: targetTeamId };
          }

          const jrApprovedDoc: Record<string, unknown> = {
            uid: fbUser.uid,
            teamId: targetTeamId,
            name: cleanName,
            jersey: cleanJersey,
            primaryPos: cleanPos,
            inviteCode: code,
            status: 'approved',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          };
          if (cleanStats6) jrApprovedDoc.stats6 = cleanStats6;
          if (cleanRoleOverride) jrApprovedDoc.roleOverride = cleanRoleOverride;
          if (cleanReferredBy) jrApprovedDoc.referredBy = cleanReferredBy;
          tx.set(jrRef, jrApprovedDoc);

          const memberDoc: Record<string, unknown> = {
            id: fbUser.uid,
            uid: fbUser.uid,
            ownerUid: fbUser.uid,
            teamId: targetTeamId,
            name: cleanName,
            role: 'member',
            isOrganizer: false,
            jersey: cleanJersey,
            age: 18,
            height: 175,
            weight: 70,
            foot: 'يمين',
            primaryPos: cleanPos,
            secondaryPos: 'لا يوجد',
            photo: '',
            hasPhoto: false,
            photoZoom: 105,
            photoY: 18,
            skills: cleanStats6
              ? stats6ToLegacySkills(cleanStats6)
              : sanitizeSkills({
                  speed: 7,
                  shooting: 6,
                  passing: 7,
                  dribbling: 6,
                  defending: 6,
                  stamina: 7,
                  vision: 6,
                  teamwork: 7,
                  control: 7,
                  positioning: 6,
                }),
            top3Strengths: '',
            weak3Points: '',
            seasonGoal: '',
            availableStatus: 'متاح',
            roleModelStarId: '',
            joinedAtMs: Date.now(),
            updatedAtMs: Date.now(),
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          };
          if (cleanStats6) memberDoc.stats6 = cleanStats6;
          if (cleanRoleOverride) memberDoc.roleOverride = cleanRoleOverride;
          tx.set(memberRef, memberDoc);
          tx.update(teamRef, {
            memberCount: increment(1),
            updatedAt: serverTimestamp(),
          });
          tx.set(
            userRef,
            {
              uid: fbUser.uid,
              displayName: cleanName,
              teamIds: arrayUnion(targetTeamId),
              activeTeamId: targetTeamId,
              pendingJoinTeamId: '',
              updatedAt: serverTimestamp(),
            },
            { merge: true }
          );
          return { joinedDirectly: true, teamName, teamId: targetTeamId };
        });
      } catch (err) {
        if (err instanceof Error && !err.message.includes('Missing or insufficient permissions')) {
          throw err;
        }
        this.handleWriteError(err, OperationType.WRITE, `teams/${targetTeamId}/joinRequests/${fbUser.uid}`);
      }
    }

    // ===== Legacy Single-Team Join Path (`teamId == 'main'`) =====
    try {
      return await runTransaction(db, async (tx) => {
        const inviteRef = doc(db, 'inviteCodes', code);
        const playerRef = doc(db, 'players', fbUser.uid);
        const jrRef = doc(db, 'joinRequests', fbUser.uid);

        const [inviteSnap, playerSnap, jrSnap] = await Promise.all([
          tx.get(inviteRef),
          tx.get(playerRef),
          tx.get(jrRef),
        ]);

        const rawInvite = inviteSnap.exists() ? { code, ...inviteSnap.data() } : null;
        const hasPendingRequest = jrSnap.exists() && jrSnap.data().status === 'pending';

        const validation = validateInviteForJoin({
          invite: rawInvite,
          applicantUid: fbUser.uid,
          existingPlayers: playerSnap.exists() ? [{ id: fbUser.uid, ownerUid: fbUser.uid }] : [],
          existingJoinRequestStatus: hasPendingRequest ? 'pending' : null,
          hasExistingPersonalTeam: Boolean(input.hasExistingPersonalTeam),
          confirmedTeamSwitch: Boolean(input.confirmedTeamSwitch),
        });

        if (!validation.valid || !validation.normalizedInvite) {
          throw new Error(validation.errorMessageAr || 'كود الدعوة غير صالح أو منتهي الصلاحية');
        }

        const inviteData = inviteSnap.data() || {};
        const isMemberShareCode = inviteData.isMemberShareCode === true;
        const requireApproval = isMemberShareCode ? true : Boolean(inviteData.requireApproval);
        const teamName = clampStr(inviteData.teamName || 'فريق السداسي', 80) || 'فريق السداسي';

        if ('maxUses' in inviteData && 'usedCount' in inviteData) {
          const maxUses = Math.max(1, Number(inviteData.maxUses || 1));
          const nextUsedCount = Math.max(0, Number(inviteData.usedCount || 0)) + 1;
          const nextActive = nextUsedCount < maxUses;
          const nextStatus = nextUsedCount >= maxUses ? 'completed' : 'active';
          tx.update(inviteRef, {
            usedCount: nextUsedCount,
            active: nextActive,
            status: nextStatus,
            updatedAt: serverTimestamp(),
          });
        }

        if (requireApproval) {
          const jrDoc: Record<string, unknown> = {
            uid: fbUser.uid,
            name: cleanName,
            jersey: cleanJersey,
            primaryPos: cleanPos,
            inviteCode: code,
            status: 'pending',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          };
          if (cleanStats6) jrDoc.stats6 = cleanStats6;
          if (cleanRoleOverride) jrDoc.roleOverride = cleanRoleOverride;
          if (cleanReferredBy) jrDoc.referredBy = cleanReferredBy;
          tx.set(jrRef, jrDoc);
          return { joinedDirectly: false, teamName, teamId: TEAM_ID };
        }

        const jrApprovedDoc: Record<string, unknown> = {
          uid: fbUser.uid,
          name: cleanName,
          jersey: cleanJersey,
          primaryPos: cleanPos,
          inviteCode: code,
          status: 'approved',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };
        if (cleanStats6) jrApprovedDoc.stats6 = cleanStats6;
        if (cleanRoleOverride) jrApprovedDoc.roleOverride = cleanRoleOverride;
        if (cleanReferredBy) jrApprovedDoc.referredBy = cleanReferredBy;
        tx.set(jrRef, jrApprovedDoc);

        const playerDoc: Record<string, unknown> = {
          id: fbUser.uid,
          teamId: TEAM_ID,
          ownerUid: fbUser.uid,
          name: cleanName,
          role: 'player',
          jersey: cleanJersey,
          age: 18,
          height: 175,
          weight: 70,
          foot: 'يمين',
          primaryPos: cleanPos,
          secondaryPos: 'لا يوجد',
          photoZoom: 105,
          photoY: 18,
          hasPhoto: false,
          skills: cleanStats6
            ? stats6ToLegacySkills(cleanStats6)
            : sanitizeSkills({
                speed: 7,
                shooting: 6,
                passing: 7,
                dribbling: 6,
                defending: 6,
                stamina: 7,
                vision: 6,
                teamwork: 7,
                control: 7,
                positioning: 6,
              }),
          top3Strengths: '',
          weak3Points: '',
          seasonGoal: '',
          availability: '',
          availableStatus: 'available',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };
        if (cleanStats6) playerDoc.stats6 = cleanStats6;
        if (cleanRoleOverride) playerDoc.roleOverride = cleanRoleOverride;
        if (cleanReferredBy) playerDoc.referredBy = cleanReferredBy;
        tx.set(playerRef, playerDoc);

        return { joinedDirectly: true, teamName, teamId: TEAM_ID };
      });
    } catch (err) {
      if (err instanceof Error && !err.message.includes('Missing or insufficient permissions')) {
        throw err;
      }
      this.handleWriteError(err, OperationType.WRITE, `joinRequests/${fbUser.uid}`);
    }
  }

  private mergePhotosIntoPlayers(state: BackendState): void {
    state.players.forEach((p) => {
      const pid = String(p.id || '');
      const ph = this.photosMap[pid];
      if (ph) {
        p.photo = ph.dataUrl;
        p.photoZoom = ph.photoZoom;
        p.photoY = ph.photoY;
      } else if (!p.hasPhoto) {
        p.photo = '';
      }
    });
  }

  async refreshMultiMembers(state?: BackendState): Promise<void> {
    const targetState = state || this.activeState;
    if (!targetState || !this.isMultiMode()) return;
    const tid = this.activeTeamId;
    try {
      const snap = await getDocs(collection(db, 'teams', tid, 'members'));
      quotaMonitor.recordReads('oneShot', Math.max(1, snap.size));
      targetState.players = snap.docs.map((d) => {
        const clean: Record<string, unknown> = stripForbiddenHealthFields({ id: d.id, ...d.data() });
        clean.availableStatus = normalizeAppAvailableStatus(clean.availableStatus);
        return clean;
      });
      this.saveTeamSnapshotCache(targetState);
      if (this.activeOnUpdate) this.activeOnUpdate();
    } catch (err) {
      if (isQuotaExceededError(err)) {
        quotaMonitor.markQuotaExceeded(true);
        if (this.activeOnError) this.activeOnError(QUOTA_EXCEEDED_ARABIC_MSG);
        return;
      }
      console.warn('refreshMultiMembers error:', err instanceof Error ? err.message : String(err));
    }
  }

  async refreshMyPrivateRecords(state?: BackendState): Promise<void> {
    const targetState = state || this.activeState;
    const uid = this.activeUid;
    if (!targetState || !uid || !this.isMultiMode()) return;
    const tid = this.activeTeamId;
    try {
      const snap = await getDocs(collection(db, 'teams', tid, 'members', uid, 'private'));
      quotaMonitor.recordReads('oneShot', Math.max(1, snap.size));
      const rd: Array<Record<string, unknown>> = [];
      const inj: Array<Record<string, unknown>> = [];
      snap.docs.forEach((d) => {
        const data = d.data();
        if (data.kind === 'readiness') rd.push({ id: d.id, playerId: uid, ownerUid: uid, ...data });
        else if (data.kind === 'injury') inj.push({ id: d.id, playerId: uid, ownerUid: uid, ...data });
      });
      targetState.readiness = rd;
      targetState.injuries = inj;
      if (this.activeOnUpdate) this.activeOnUpdate();
    } catch (err) {
      if (isQuotaExceededError(err)) {
        quotaMonitor.markQuotaExceeded(true);
        if (this.activeOnError) this.activeOnError(QUOTA_EXCEEDED_ARABIC_MSG);
        return;
      }
      console.warn('refreshMyPrivateRecords error:', err instanceof Error ? err.message : String(err));
    }
  }

  async refreshReportsPage(state?: BackendState, append = false): Promise<{ hasMore: boolean }> {
    const targetState = state || this.activeState;
    if (!targetState) return { hasMore: false };
    const isMulti = this.isMultiMode();
    const tid = this.activeTeamId;
    try {
      const colRef = isMulti
        ? collection(db, 'teams', tid, 'reports')
        : collection(db, 'reports');
      const baseFilters = isMulti ? [] : [where('teamId', '==', TEAM_ID)];
      const q = append && this.reportsLastDoc
        ? query(colRef, ...baseFilters, orderBy('createdAt', 'desc'), startAfter(this.reportsLastDoc), limit(PAGE_SIZE_LIST))
        : query(colRef, ...baseFilters, orderBy('createdAt', 'desc'), limit(PAGE_SIZE_LIST));
      const snap = await getDocs(q);
      quotaMonitor.recordReads('oneShot', Math.max(1, snap.size));
      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      if (append) {
        const seen = new Set(targetState.reports.map((r) => String(r.id || '')));
        for (const row of rows) {
          if (!seen.has(String(row.id || ''))) targetState.reports.push(row);
        }
      } else {
        targetState.reports = rows;
      }
      this.reportsLastDoc = snap.docs.length ? snap.docs[snap.docs.length - 1] : this.reportsLastDoc;
      this.reportsHasMore = snap.docs.length === PAGE_SIZE_LIST;
      if (this.activeOnUpdate) this.activeOnUpdate();
      return { hasMore: this.reportsHasMore };
    } catch (err) {
      if (isQuotaExceededError(err)) {
        quotaMonitor.markQuotaExceeded(true);
        if (this.activeOnError) this.activeOnError(QUOTA_EXCEEDED_ARABIC_MSG);
        return { hasMore: false };
      }
      const code = String((err as { code?: string })?.code || '');
      if (!isMulti && code === 'failed-precondition') {
        try {
          const snap = await getDocs(query(collection(db, 'reports'), where('teamId', '==', TEAM_ID), limit(50)));
          quotaMonitor.recordReads('oneShot', Math.max(1, snap.size));
          targetState.reports = snap.docs
            .map((d) => ({ id: d.id, ...d.data() }))
            .sort((a, b) => Number((b as Record<string, unknown>).createdAtMs || 0) - Number((a as Record<string, unknown>).createdAtMs || 0));
          this.reportsHasMore = false;
          if (this.activeOnUpdate) this.activeOnUpdate();
        } catch {
          // ignore secondary failure
        }
        return { hasMore: false };
      }
      console.warn('refreshReportsPage error:', err instanceof Error ? err.message : String(err));
      return { hasMore: false };
    }
  }

  async loadMoreReports(): Promise<{ hasMore: boolean }> {
    return this.refreshReportsPage(this.activeState || undefined, true);
  }

  async refreshMatchesPage(state?: BackendState, append = false): Promise<{ hasMore: boolean }> {
    const targetState = state || this.activeState;
    if (!targetState) return { hasMore: false };
    const isMulti = this.isMultiMode();
    const tid = this.activeTeamId;
    try {
      const colRef = isMulti
        ? collection(db, 'teams', tid, 'matches')
        : collection(db, 'matches');
      const baseFilters = isMulti ? [] : [where('teamId', '==', TEAM_ID)];
      const q = append && this.matchesLastDoc
        ? query(colRef, ...baseFilters, orderBy('createdAt', 'desc'), startAfter(this.matchesLastDoc), limit(PAGE_SIZE_LIST))
        : query(colRef, ...baseFilters, orderBy('createdAt', 'desc'), limit(PAGE_SIZE_LIST));
      const snap = await getDocs(q);
      quotaMonitor.recordReads('oneShot', Math.max(1, snap.size));
      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      if (append) {
        const seen = new Set(targetState.matches.map((m) => String(m.id || '')));
        for (const row of rows) {
          if (!seen.has(String(row.id || ''))) targetState.matches.push(row);
        }
      } else {
        targetState.matches = rows;
      }
      this.matchesLastDoc = snap.docs.length ? snap.docs[snap.docs.length - 1] : this.matchesLastDoc;
      this.matchesHasMore = snap.docs.length === PAGE_SIZE_LIST;
      if (this.activeOnUpdate) this.activeOnUpdate();
      return { hasMore: this.matchesHasMore };
    } catch (err) {
      if (isQuotaExceededError(err)) {
        quotaMonitor.markQuotaExceeded(true);
        if (this.activeOnError) this.activeOnError(QUOTA_EXCEEDED_ARABIC_MSG);
        return { hasMore: false };
      }
      const code = String((err as { code?: string })?.code || '');
      if (!isMulti && code === 'failed-precondition') {
        try {
          const snap = await getDocs(query(collection(db, 'matches'), where('teamId', '==', TEAM_ID), limit(50)));
          quotaMonitor.recordReads('oneShot', Math.max(1, snap.size));
          targetState.matches = snap.docs
            .map((d) => ({ id: d.id, ...d.data() }))
            .sort((a, b) => String((b as Record<string, unknown>).date || '').localeCompare(String((a as Record<string, unknown>).date || '')));
          this.matchesHasMore = false;
          if (this.activeOnUpdate) this.activeOnUpdate();
        } catch {
          // ignore secondary failure
        }
        return { hasMore: false };
      }
      console.warn('refreshMatchesPage error:', err instanceof Error ? err.message : String(err));
      return { hasMore: false };
    }
  }

  async loadMoreMatches(): Promise<{ hasMore: boolean }> {
    return this.refreshMatchesPage(this.activeState || undefined, true);
  }

  /**
   * Non-realtime one-shot fetch of aggregated peer rating stats (count >= 3).
   */
  async refreshPeerRatingStats(
    state?: BackendState
  ): Promise<Record<string, { count: number; totalScore: number }>> {
    const targetState = state || this.activeState;
    if (!targetState) return {};
    const isMulti = this.isMultiMode();
    const tid = this.activeTeamId;
    try {
      const q = isMulti
        ? query(collection(db, 'teams', tid, 'peerRatingStats'), where('count', '>=', 3))
        : query(
            collection(db, 'peerRatingStats'),
            where('teamId', '==', TEAM_ID),
            where('count', '>=', 3)
          );
      const snap = await getDocs(q);
      quotaMonitor.recordReads('oneShot', Math.max(1, snap.size));
      const statsMap: Record<string, { count: number; totalScore: number }> = {};
      snap.docs.forEach((d) => {
        const data = d.data();
        const cnt = Number(data.count || 0);
        if (cnt >= 3) {
          statsMap[d.id] = {
            count: cnt,
            totalScore: Number(data.totalScore || 0),
          };
        }
      });
      targetState.peerRatingStats = statsMap;
      if (this.activeOnUpdate) this.activeOnUpdate();
      return statsMap;
    } catch (err) {
      if (this.activeOnError) {
        this.handleListenerError(err, OperationType.LIST, 'peerRatingStats', this.activeOnError);
      }
      return targetState.peerRatingStats || {};
    }
  }

  /**
   * One-shot non-realtime fetch of attendance records.
   */
  async refreshAttendance(state?: BackendState): Promise<void> {
    const targetState = state || this.activeState;
    if (!targetState) return;
    const isMulti = this.isMultiMode();
    const tid = this.activeTeamId;
    try {
      if (isMulti) {
        const snap = await getDocs(
          query(collection(db, 'teams', tid, 'attendance'), limit(15))
        );
        quotaMonitor.recordReads('oneShot', Math.max(1, snap.size));
        targetState.attendance = flattenConsolidatedAttendanceDocs(
          snap.docs.map((d) => ({ id: d.id, ...d.data() }))
        );
      } else {
        const snap = await getDocs(query(collection(db, 'attendance'), where('teamId', '==', TEAM_ID)));
        quotaMonitor.recordReads('oneShot', Math.max(1, snap.size));
        targetState.attendance = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      }
      if (this.activeOnUpdate) this.activeOnUpdate();
    } catch (err) {
      if (isQuotaExceededError(err)) {
        quotaMonitor.markQuotaExceeded(true);
        if (this.activeOnError) this.activeOnError(QUOTA_EXCEEDED_ARABIC_MSG);
        return;
      }
      console.warn('refreshAttendance error:', err instanceof Error ? err.message : String(err));
    }
  }

  /**
   * One-shot non-realtime fetch of Captain/Founder official ratings (adminRatings).
   */
  async refreshAdminRatings(state?: BackendState): Promise<void> {
    const targetState = state || this.activeState;
    if (!targetState) return;
    const isMulti = this.isMultiMode();
    const tid = this.activeTeamId;
    try {
      const snap = isMulti
        ? await getDocs(collection(db, 'teams', tid, 'adminRatings'))
        : await getDocs(query(collection(db, 'adminRatings'), where('teamId', '==', TEAM_ID)));
      quotaMonitor.recordReads('oneShot', Math.max(1, snap.size));
      targetState.adminRatings = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      if (this.activeOnUpdate) this.activeOnUpdate();
    } catch (err) {
      if (isQuotaExceededError(err)) {
        quotaMonitor.markQuotaExceeded(true);
        if (this.activeOnError) this.activeOnError(QUOTA_EXCEEDED_ARABIC_MSG);
        return;
      }
      console.warn('refreshAdminRatings error:', err instanceof Error ? err.message : String(err));
    }
  }

  /**
   * One-shot fetch of unlocked matchVoteTallies (only for verified sessions that reached >= 50% participation).
   */
  async refreshMatchVoteTallies(state?: BackendState): Promise<void> {
    const targetState = state || this.activeState;
    if (!targetState) return;
    const isMulti = this.isMultiMode();
    const tid = this.activeTeamId;
    const sessions = Array.isArray(targetState.matchSessions) ? targetState.matchSessions : [];
    const unlockedSessions = sessions.filter((s) => {
      const parts = Array.isArray(s.participantIds) ? s.participantIds : [];
      const voters = Array.isArray(s.voterUids) ? s.voterUids : [];
      return s.status === 'verified' && parts.length >= 2 && voters.length * 2 >= parts.length;
    });
    if (!unlockedSessions.length) {
      targetState.matchVoteTallies = [];
      return;
    }

    const tallies: Array<Record<string, unknown>> = [];
    for (const sess of unlockedSessions.slice(0, 6)) {
      const sid = String(sess.id || '');
      const parts = (Array.isArray(sess.participantIds) ? sess.participantIds : []) as string[];
      const fetches = parts.map(async (pid) => {
        try {
          const docRef = isMulti
            ? doc(db, 'teams', tid, 'matchVoteTallies', `${sid}__${pid}`)
            : doc(db, 'matchVoteTallies', `${sid}__${pid}`);
          const snap = await getDoc(docRef);
          quotaMonitor.recordReads('oneShot', 1);
          if (snap.exists()) {
            tallies.push({ id: snap.id, ...snap.data() });
          }
        } catch (err) {
          if (isQuotaExceededError(err)) {
            quotaMonitor.markQuotaExceeded(true);
            return;
          }
          const msg = err instanceof Error ? err.message : String(err);
          if (!msg.includes('Missing or insufficient permissions')) {
            console.warn('refreshMatchVoteTallies error:', msg);
          }
        }
      });
      await Promise.all(fetches);
    }
    targetState.matchVoteTallies = tallies;
    if (this.activeOnUpdate) this.activeOnUpdate();
  }

  /**
   * One-shot non-realtime fetch of Global Football Library articles (0 permanent listeners).
   */
  async refreshFootballLibrary(state?: BackendState): Promise<void> {
    const targetState = state || this.activeState;
    if (!targetState) return;
    const isMulti = this.isMultiMode();
    const tid = this.activeTeamId;
    try {
      const q = isMulti
        ? this.activeIsCaptain
          ? collection(db, 'teams', tid, 'footballLibrary')
          : query(collection(db, 'teams', tid, 'footballLibrary'), where('published', '==', true))
        : this.activeIsCaptain
          ? query(collection(db, 'footballLibrary'), where('teamId', '==', TEAM_ID))
          : query(
              collection(db, 'footballLibrary'),
              where('teamId', '==', TEAM_ID),
              where('published', '==', true)
            );
      const snap = await getDocs(q);
      quotaMonitor.recordReads('oneShot', Math.max(1, snap.size));
      targetState.footballLibrary = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      if (this.activeOnUpdate) this.activeOnUpdate();
    } catch (err) {
      if (isQuotaExceededError(err)) {
        quotaMonitor.markQuotaExceeded(true);
        if (this.activeOnError) this.activeOnError(QUOTA_EXCEEDED_ARABIC_MSG);
        return;
      }
      console.warn('refreshFootballLibrary error:', err instanceof Error ? err.message : String(err));
    }
  }

  subscribeTeamData(
    uid: string,
    isCaptain: boolean,
    state: BackendState,
    onUpdate: () => void,
    onError: (msg: string) => void,
    initialTab = 'fifa'
  ): void {
    this.stopListeners();
    this.activeUid = uid;
    this.activeIsCaptain = isCaptain;
    this.activeState = state;
    this.activeOnUpdate = onUpdate;
    this.activeOnError = onError;
    this.photosMap = {};
    this.reportsLastDoc = null;
    this.reportsHasMore = false;
    this.matchesLastDoc = null;
    this.matchesHasMore = false;

    const handleErr = (op: OperationType, path: string) => (err: unknown) => {
      this.handleListenerError(err, op, path, onError);
    };

    // Hydrate non-sensitive local cache ONLY if it belongs to the exact same UID & teamId
    const cached = this.loadTeamSnapshotCache(uid, this.activeTeamId);
    if (cached && cached.ownerUid === uid) {
      if (cached.settings && Object.keys(cached.settings).length && !Object.keys(state.settings || {}).length) {
        state.settings = { ...cached.settings };
      }
      if (Array.isArray(cached.players) && cached.players.length && !state.players.length) {
        state.players = cached.players;
      }
      if (cached.pitchSession && !state.pitchSession) {
        state.pitchSession = cached.pitchSession;
      }
    }

    if (this.isMultiMode()) {
      const tid = this.activeTeamId;
      // Multi-Team Core: ONLY 1 live listener (teams/{teamId}) + one-shot initial members & own private records
      this.coreUnsubs.push(
        onSnapshot(
          doc(db, 'teams', tid),
          (snap) => {
            quotaMonitor.recordReads('core', 1);
            quotaMonitor.markQuotaExceeded(false);
            if (snap.exists()) {
              const raw = snap.data();
              this.activeIsCaptain = String(raw.founderUid || '') === uid;
              const nextSettings = normalizeTeamDocToSettings(tid, raw);
              if (!this.activeIsCaptain) {
                delete nextSettings.inviteCode;
              }
              state.settings = nextSettings;
              // Sync activeTeams list entry
              this.activeTeams = this.activeTeams.map((t) =>
                t.id === tid ? ({ ...t, ...nextSettings } as unknown as MultiTeamMeta) : t
              );
              this.saveTeamSnapshotCache(state);
              onUpdate();
            }
          },
          handleErr(OperationType.GET, `teams/${tid}`)
        )
      );

      void this.refreshMultiMembers(state);
      void this.refreshMyPrivateRecords(state);
      this.setActiveTab(initialTab);
      return;
    }

    // ==================== SINGLE-TEAM LEGACY CORE LISTENERS ====================
    this.coreUnsubs.push(
      onSnapshot(
        doc(db, 'settings', 'team'),
        (snap) => {
          quotaMonitor.recordReads('core', 1);
          quotaMonitor.markQuotaExceeded(false);
          if (snap.exists()) {
            const nextSettings: Record<string, unknown> = { ...snap.data(), storageMode: 'single' };
            if (!this.activeIsCaptain) {
              delete nextSettings.inviteCode;
            }
            state.settings = nextSettings;
            this.saveTeamSnapshotCache(state);
            onUpdate();
          }
        },
        handleErr(OperationType.GET, 'settings/team')
      )
    );

    this.coreUnsubs.push(
      onSnapshot(
        query(collection(db, 'players'), where('teamId', '==', TEAM_ID)),
        (snap) => {
          quotaMonitor.recordReads('core', Math.max(1, snap.docChanges().length || snap.size));
          quotaMonitor.markQuotaExceeded(false);
          state.players = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          this.mergePhotosIntoPlayers(state);
          this.saveTeamSnapshotCache(state);
          onUpdate();
        },
        handleErr(OperationType.LIST, 'players')
      )
    );

    this.coreUnsubs.push(
      onSnapshot(
        doc(db, 'playerPhotos', uid),
        (snap) => {
          quotaMonitor.recordReads('core', 1);
          if (snap.exists()) {
            const data = snap.data();
            this.photosMap[uid] = {
              dataUrl: sanitizeImageDataUrl(data.dataUrl, 250000),
              photoZoom: Number(data.photoZoom || 105),
              photoY: typeof data.photoY === 'number' ? data.photoY : 18,
            };
          } else {
            delete this.photosMap[uid];
          }
          this.mergePhotosIntoPlayers(state);
          onUpdate();
        },
        handleErr(OperationType.GET, `playerPhotos/${uid}`)
      )
    );

    this.setActiveTab(initialTab);
  }

  /**
   * Lazy Per-Tab Listener Manager:
   * In Multi-Team mode keeps permanent/live tab listeners strictly <= 3 total across the app
   * (live ONLY on team/tactics/ready attendance & tactics; everything else uses limit(20) one-shot pagination).
   */
  setActiveTab(tabId: string): void {
    const uid = this.activeUid;
    const state = this.activeState;
    const onUpdate = this.activeOnUpdate;
    const onError = this.activeOnError;
    if (!uid || !state || !onUpdate || !onError) return;
    if (this.activeTab === tabId && (this.tabUnsubs.length > 0 || this.isMultiMode())) return;

    this.stopTabListeners();
    this.activeTab = tabId;

    const isCaptain = this.activeIsCaptain;
    const handleErr = (op: OperationType, path: string) => (err: unknown) => {
      this.handleListenerError(err, op, path, onError);
    };

    if (this.isMultiMode()) {
      const tid = this.activeTeamId;

      const subMultiAttendanceAndPitch = (includeJoinRequests: boolean) => {
        this.tabUnsubs.push(
          onSnapshot(
            query(collection(db, 'teams', tid, 'attendance'), limit(15)),
            (snap) => {
              quotaMonitor.recordReads('tab', Math.max(1, snap.docChanges().length || snap.size));
              state.attendance = flattenConsolidatedAttendanceDocs(
                snap.docs.map((d) => ({ id: d.id, ...d.data() }))
              );
              onUpdate();
            },
            handleErr(OperationType.LIST, `teams/${tid}/attendance`)
          )
        );
        this.tabUnsubs.push(
          onSnapshot(
            doc(db, 'teams', tid, 'pitchSessions', 'current'),
            (snap) => {
              quotaMonitor.recordReads('tab', 1);
              if (snap.exists()) {
                state.pitchSession = { ...snap.data() };
                this.saveTeamSnapshotCache(state);
                onUpdate();
              }
            },
            handleErr(OperationType.GET, `teams/${tid}/pitchSessions/current`)
          )
        );
        if (includeJoinRequests && isCaptain && this.tabUnsubs.length < 3) {
          this.tabUnsubs.push(
            onSnapshot(
              query(collection(db, 'teams', tid, 'joinRequests'), where('status', '==', 'pending'), limit(20)),
              (snap) => {
                quotaMonitor.recordReads('tab', Math.max(1, snap.docChanges().length || snap.size));
                state.pendingPlayers = snap.docs.slice(0, MAX_PENDING_JOIN_REQUESTS).map((d) => ({ id: d.id, ...d.data() }));
                onUpdate();
              },
              handleErr(OperationType.LIST, `teams/${tid}/joinRequests`)
            )
          );
        }
      };

      const loadOneShotPitchPayments = async () => {
        try {
          const payQ = this.isTeamOrganizer(uid)
            ? query(collection(db, 'teams', tid, 'pitchPayments'), limit(40))
            : query(collection(db, 'teams', tid, 'pitchPayments'), where('ownerUid', '==', uid), limit(10));
          const snap = await getDocs(payQ);
          quotaMonitor.recordReads('oneShot', Math.max(1, snap.size));
          state.pitchPayments = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          onUpdate();
        } catch (err) {
          if (isQuotaExceededError(err)) quotaMonitor.markQuotaExceeded(true);
        }
      };

      const loadOneShotSuggestionsAndMissions = async () => {
        try {
          const [sSnap, mSnap] = await Promise.all([
            getDocs(query(collection(db, 'teams', tid, 'suggestions'), orderBy('createdAt', 'desc'), limit(PAGE_SIZE_LIST))),
            getDocs(query(collection(db, 'teams', tid, 'missionClaims'), orderBy('createdAt', 'desc'), limit(PAGE_SIZE_LIST))),
          ]);
          quotaMonitor.recordReads('oneShot', Math.max(1, sSnap.size) + Math.max(1, mSnap.size));
          state.suggestions = sSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
          state.missionClaims = mSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
          onUpdate();
        } catch (err) {
          if (isQuotaExceededError(err)) quotaMonitor.markQuotaExceeded(true);
        }
      };

      const loadOneShotMatchSessions = async () => {
        try {
          const snap = await getDocs(
            query(collection(db, 'teams', tid, 'matchSessions'), orderBy('createdAt', 'desc'), limit(PAGE_SIZE_LIST))
          );
          quotaMonitor.recordReads('oneShot', Math.max(1, snap.size));
          state.matchSessions = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          onUpdate();
          await this.refreshMatchVoteTallies(state);
        } catch (err) {
          if (isQuotaExceededError(err)) quotaMonitor.markQuotaExceeded(true);
        }
      };

      const loadOneShotAdminData = async () => {
        try {
          if (isCaptain) {
            const [jrSnap, invSnap] = await Promise.all([
              getDocs(query(collection(db, 'teams', tid, 'joinRequests'), where('status', '==', 'pending'), limit(20))),
              getDocs(query(collection(db, 'inviteCodes'), where('teamId', '==', tid), limit(10))),
            ]);
            quotaMonitor.recordReads('oneShot', Math.max(1, jrSnap.size) + Math.max(1, invSnap.size));
            state.pendingPlayers = jrSnap.docs.slice(0, MAX_PENDING_JOIN_REQUESTS).map((d) => ({ id: d.id, ...d.data() }));
            state.inviteCodes = invSnap.docs
              .map((d) => ({ code: d.id, ...d.data() }))
              .sort((a, b) => Number((b as Record<string, unknown>).createdAtMs || 0) - Number((a as Record<string, unknown>).createdAtMs || 0));
            onUpdate();
          }
          await this.refreshMatchesPage(state, false);
          await this.refreshAdminRatings(state);
        } catch (err) {
          if (isQuotaExceededError(err)) quotaMonitor.markQuotaExceeded(true);
        }
      };

      switch (tabId) {
        case 'team': {
          subMultiAttendanceAndPitch(true);
          void loadOneShotPitchPayments();
          void this.refreshMultiMembers(state);
          break;
        }
        case 'fifa': {
          void this.refreshReportsPage(state, false);
          void this.refreshPeerRatingStats(state);
          void this.refreshAttendance(state);
          void this.refreshAdminRatings(state);
          void this.refreshMyPrivateRecords(state);
          break;
        }
        case 'live': {
          void this.refreshReportsPage(state, false);
          void loadOneShotMatchSessions();
          break;
        }
        case 'tactics': {
          this.tabUnsubs.push(
            onSnapshot(
              doc(db, 'teams', tid, 'tactics', 'current'),
              (snap) => {
                quotaMonitor.recordReads('tab', 1);
                if (snap.exists()) {
                  const d = snap.data();
                  state.tactics = {
                    formation: sanitizeFormation(d.formation),
                    slots: (d.slots && typeof d.slots === 'object' ? d.slots : {}) as Record<string, string>,
                    ...(d.publishedByUid ? { publishedByUid: String(d.publishedByUid) } : {}),
                    ...(d.publishedByName ? { publishedByName: String(d.publishedByName) } : {}),
                    ...(typeof d.publishedAtMs === 'number' ? { publishedAtMs: d.publishedAtMs } : {}),
                    ...(d.previousSnapshot && typeof d.previousSnapshot === 'object'
                      ? { previousSnapshot: d.previousSnapshot as TacticsSnapshotRecord }
                      : { previousSnapshot: null }),
                  };
                  onUpdate();
                }
              },
              handleErr(OperationType.GET, `teams/${tid}/tactics/current`)
            )
          );
          this.tabUnsubs.push(
            onSnapshot(
              collection(db, 'teams', tid, 'lineupVotes'),
              (snap) => {
                quotaMonitor.recordReads('tab', Math.max(1, snap.docChanges().length || snap.size));
                const votes: Record<string, string> = {};
                snap.docs.forEach((d) => {
                  const data = d.data();
                  if (data.vote === 'approve' || data.vote === 'swap') votes[d.id] = data.vote;
                });
                state.lineupVotes = votes;
                onUpdate();
              },
              handleErr(OperationType.LIST, `teams/${tid}/lineupVotes`)
            )
          );
          if (!state.players.length) void this.refreshMultiMembers(state);
          break;
        }
        case 'ready': {
          subMultiAttendanceAndPitch(false);
          void loadOneShotPitchPayments();
          void this.refreshMyPrivateRecords(state);
          void this.refreshReportsPage(state, false);
          break;
        }
        case 'stats': {
          void this.refreshMatchesPage(state, false);
          void this.refreshReportsPage(state, false);
          void this.refreshAdminRatings(state);
          void this.refreshPeerRatingStats(state);
          break;
        }
        case 'injuries': {
          void this.refreshMyPrivateRecords(state);
          break;
        }
        case 'social': {
          void loadOneShotSuggestionsAndMissions();
          break;
        }
        case 'library': {
          void this.refreshFootballLibrary(state);
          break;
        }
        case 'admin': {
          void loadOneShotAdminData();
          void loadOneShotSuggestionsAndMissions();
          break;
        }
        default:
          break;
      }

      quotaMonitor.setActiveListeners(this.getActiveListenerCount());
      return;
    }

    // ==================== SINGLE-TEAM LEGACY PER-TAB LISTENERS ====================
    const subReports = () => {
      this.tabUnsubs.push(
        onSnapshot(
          query(collection(db, 'reports'), where('teamId', '==', TEAM_ID)),
          (snap) => {
            quotaMonitor.recordReads('tab', Math.max(1, snap.docChanges().length || snap.size));
            state.reports = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
            onUpdate();
          },
          handleErr(OperationType.LIST, 'reports')
        )
      );
    };

    const subMatches = () => {
      this.tabUnsubs.push(
        onSnapshot(
          query(collection(db, 'matches'), where('teamId', '==', TEAM_ID)),
          (snap) => {
            quotaMonitor.recordReads('tab', Math.max(1, snap.docChanges().length || snap.size));
            state.matches = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
            onUpdate();
          },
          handleErr(OperationType.LIST, 'matches')
        )
      );
    };

    const subAdminRatings = () => {
      this.tabUnsubs.push(
        onSnapshot(
          query(collection(db, 'adminRatings'), where('teamId', '==', TEAM_ID)),
          (snap) => {
            quotaMonitor.recordReads('tab', Math.max(1, snap.docChanges().length || snap.size));
            state.adminRatings = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
            onUpdate();
          },
          handleErr(OperationType.LIST, 'adminRatings')
        )
      );
    };

    const subReadiness = () => {
      const readinessQuery = isCaptain
        ? query(collection(db, 'readiness'), where('teamId', '==', TEAM_ID))
        : query(collection(db, 'readiness'), where('ownerUid', '==', uid));
      this.tabUnsubs.push(
        onSnapshot(
          readinessQuery,
          (snap) => {
            quotaMonitor.recordReads('tab', Math.max(1, snap.docChanges().length || snap.size));
            state.readiness = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
            onUpdate();
          },
          handleErr(OperationType.LIST, 'readiness')
        )
      );
    };

    const subInjuries = () => {
      const injuriesQuery = isCaptain
        ? query(collection(db, 'injuries'), where('teamId', '==', TEAM_ID))
        : query(collection(db, 'injuries'), where('ownerUid', '==', uid));
      this.tabUnsubs.push(
        onSnapshot(
          injuriesQuery,
          (snap) => {
            quotaMonitor.recordReads('tab', Math.max(1, snap.docChanges().length || snap.size));
            state.injuries = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
            onUpdate();
          },
          handleErr(OperationType.LIST, 'injuries')
        )
      );
    };

    const subSuggestions = () => {
      this.tabUnsubs.push(
        onSnapshot(
          query(collection(db, 'suggestions'), where('teamId', '==', TEAM_ID)),
          (snap) => {
            quotaMonitor.recordReads('tab', Math.max(1, snap.docChanges().length || snap.size));
            state.suggestions = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
            onUpdate();
          },
          handleErr(OperationType.LIST, 'suggestions')
        )
      );
    };

    const subPitchHub = () => {
      this.tabUnsubs.push(
        onSnapshot(
          doc(db, 'pitchSessions', 'current'),
          (snap) => {
            quotaMonitor.recordReads('tab', 1);
            if (snap.exists()) {
              state.pitchSession = { ...snap.data() };
              this.saveTeamSnapshotCache(state);
              onUpdate();
            }
          },
          handleErr(OperationType.GET, 'pitchSessions/current')
        )
      );
      const payQuery = isCaptain
        ? query(collection(db, 'pitchPayments'), where('teamId', '==', TEAM_ID))
        : query(collection(db, 'pitchPayments'), where('ownerUid', '==', uid));
      this.tabUnsubs.push(
        onSnapshot(
          payQuery,
          (snap) => {
            quotaMonitor.recordReads('tab', Math.max(1, snap.docChanges().length || snap.size));
            state.pitchPayments = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
            onUpdate();
          },
          handleErr(OperationType.LIST, 'pitchPayments')
        )
      );
    };

    const subMatchSessions = () => {
      this.tabUnsubs.push(
        onSnapshot(
          query(collection(db, 'matchSessions'), where('teamId', '==', TEAM_ID)),
          (snap) => {
            quotaMonitor.recordReads('tab', Math.max(1, snap.docChanges().length || snap.size));
            state.matchSessions = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
            onUpdate();
            void this.refreshMatchVoteTallies(state);
          },
          handleErr(OperationType.LIST, 'matchSessions')
        )
      );
    };

    const subMissionClaims = () => {
      this.tabUnsubs.push(
        onSnapshot(
          query(collection(db, 'missionClaims'), where('teamId', '==', TEAM_ID)),
          (snap) => {
            quotaMonitor.recordReads('tab', Math.max(1, snap.docChanges().length || snap.size));
            state.missionClaims = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
            onUpdate();
          },
          handleErr(OperationType.LIST, 'missionClaims')
        )
      );
    };

    const subAttendance = () => {
      this.tabUnsubs.push(
        onSnapshot(
          query(collection(db, 'attendance'), where('teamId', '==', TEAM_ID)),
          (snap) => {
            quotaMonitor.recordReads('tab', Math.max(1, snap.docChanges().length || snap.size));
            state.attendance = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
            onUpdate();
          },
          handleErr(OperationType.LIST, 'attendance')
        )
      );
    };

    const subPlayerPhotosTeam = () => {
      this.tabUnsubs.push(
        onSnapshot(
          query(collection(db, 'playerPhotos'), where('teamId', '==', TEAM_ID)),
          (snap) => {
            quotaMonitor.recordReads('tab', Math.max(1, snap.docChanges().length || snap.size));
            const nextMap: Record<string, { dataUrl: string; photoZoom: number; photoY: number }> = {
              ...this.photosMap,
            };
            snap.docs.forEach((d) => {
              const data = d.data();
              nextMap[d.id] = {
                dataUrl: sanitizeImageDataUrl(data.dataUrl, 250000),
                photoZoom: Number(data.photoZoom || 105),
                photoY: typeof data.photoY === 'number' ? data.photoY : 18,
              };
            });
            this.photosMap = nextMap;
            this.mergePhotosIntoPlayers(state);
            onUpdate();
          },
          handleErr(OperationType.LIST, 'playerPhotos')
        )
      );
    };

    const subPendingJoinRequests = () => {
      if (!isCaptain) return;
      this.tabUnsubs.push(
        onSnapshot(
          query(collection(db, 'joinRequests'), where('status', '==', 'pending')),
          (snap) => {
            quotaMonitor.recordReads('tab', Math.max(1, snap.docChanges().length || snap.size));
            state.pendingPlayers = snap.docs
              .slice(0, MAX_PENDING_JOIN_REQUESTS)
              .map((d) => ({ id: d.id, ...d.data() }));
            onUpdate();
          },
          handleErr(OperationType.LIST, 'joinRequests')
        )
      );
    };

    switch (tabId) {
      case 'team': {
        subAttendance();
        subPitchHub();
        subPlayerPhotosTeam();
        subPendingJoinRequests();
        break;
      }
      case 'fifa': {
        subReports();
        void this.refreshPeerRatingStats(state);
        void this.refreshAttendance(state);
        void this.refreshAdminRatings(state);
        break;
      }
      case 'live': {
        subReports();
        subMatchSessions();
        break;
      }
      case 'tactics': {
        this.tabUnsubs.push(
          onSnapshot(
            doc(db, 'tactics', 'current'),
            (snap) => {
              quotaMonitor.recordReads('tab', 1);
              if (snap.exists()) {
                const d = snap.data();
                state.tactics = {
                  formation: sanitizeFormation(d.formation),
                  slots: (d.slots && typeof d.slots === 'object' ? d.slots : {}) as Record<string, string>,
                  ...(d.publishedByUid ? { publishedByUid: String(d.publishedByUid) } : {}),
                  ...(d.publishedByName ? { publishedByName: String(d.publishedByName) } : {}),
                  ...(typeof d.publishedAtMs === 'number' ? { publishedAtMs: d.publishedAtMs } : {}),
                  ...(d.previousSnapshot && typeof d.previousSnapshot === 'object'
                    ? { previousSnapshot: d.previousSnapshot as TacticsSnapshotRecord }
                    : { previousSnapshot: null }),
                };
                onUpdate();
              }
            },
            handleErr(OperationType.GET, 'tactics/current')
          )
        );
        this.tabUnsubs.push(
          onSnapshot(
            query(collection(db, 'lineupVotes'), where('teamId', '==', TEAM_ID)),
            (snap) => {
              quotaMonitor.recordReads('tab', Math.max(1, snap.docChanges().length || snap.size));
              const votes: Record<string, string> = {};
              snap.docs.forEach((d) => {
                const data = d.data();
                if (data.vote === 'approve' || data.vote === 'swap') {
                  votes[d.id] = data.vote;
                }
              });
              state.lineupVotes = votes;
              onUpdate();
            },
            handleErr(OperationType.LIST, 'lineupVotes')
          )
        );
        subPlayerPhotosTeam();
        break;
      }
      case 'ready': {
        subAttendance();
        subReadiness();
        subReports();
        subPitchHub();
        break;
      }
      case 'stats': {
        subMatches();
        subReports();
        subAdminRatings();
        void this.refreshPeerRatingStats(state);
        break;
      }
      case 'injuries': {
        subInjuries();
        break;
      }
      case 'social': {
        subSuggestions();
        subMissionClaims();
        break;
      }
      case 'library': {
        void this.refreshFootballLibrary(state);
        break;
      }
      case 'admin': {
        if (isCaptain) {
          this.tabUnsubs.push(
            onSnapshot(
              query(collection(db, 'joinRequests'), where('status', '==', 'pending')),
              (snap) => {
                quotaMonitor.recordReads('tab', Math.max(1, snap.docChanges().length || snap.size));
                state.pendingPlayers = snap.docs
                  .slice(0, MAX_PENDING_JOIN_REQUESTS)
                  .map((d) => ({ id: d.id, ...d.data() }));
                onUpdate();
              },
              handleErr(OperationType.LIST, 'joinRequests')
            )
          );
          this.tabUnsubs.push(
            onSnapshot(
              collection(db, 'inviteCodes'),
              (snap) => {
                quotaMonitor.recordReads('tab', Math.max(1, snap.docChanges().length || snap.size));
                state.inviteCodes = snap.docs
                  .map((d) => ({ code: d.id, ...d.data() }))
                  .sort((a, b) => Number((b as Record<string, unknown>).createdAtMs || 0) - Number((a as Record<string, unknown>).createdAtMs || 0));
                onUpdate();
              },
              handleErr(OperationType.LIST, 'inviteCodes')
            )
          );
          subMatches();
          subReadiness();
          subInjuries();
          subAdminRatings();
          subSuggestions();
        }
        break;
      }
      default:
        break;
    }

    quotaMonitor.setActiveListeners(this.getActiveListenerCount());
  }

  async dispatchAction(
    action: string,
    payload: Record<string, unknown>,
    currentUser: Record<string, unknown>
  ): Promise<Record<string, unknown> | void> {
    const uid = this.activeUid || auth.currentUser?.uid;
    if (!uid) throw new Error('يرجى تسجيل الدخول أولاً');
    const isMulti = this.isMultiMode();
    const tid = this.activeTeamId;

    switch (action) {
      case 'displayName': {
        const playerId = String(currentUser.id || uid);
        const check = sanitizePlayerDisplayName(payload.name);
        if (!check.valid) {
          throw new Error(check.errorAr || 'أدخل الاسم الظاهر في الملعب (حرفان على الأقل)');
        }
        try {
          if (isMulti) {
            await updateDoc(doc(db, 'teams', tid, 'members', playerId), {
              name: check.name,
              updatedAtMs: Date.now(),
              updatedAt: serverTimestamp(),
            });
            await this.refreshMultiMembers();
          } else {
            await updateDoc(doc(db, 'players', playerId), {
              name: check.name,
              updatedAt: serverTimestamp(),
            });
          }
        } catch (err) {
          this.handleWriteError(err, OperationType.UPDATE, isMulti ? `teams/${tid}/members/${playerId}` : `players/${playerId}`);
        }
        return { name: check.name };
      }

      case 'profile': {
        const playerId = String(currentUser.id || uid);
        const nameCheck = sanitizePlayerDisplayName(payload.name ?? currentUser.name);
        const safeName = nameCheck.valid
          ? nameCheck.name
          : clampStr(currentUser.name, 80) || 'لاعب';

        if (isMulti) {
          const cleanPhoto = 'photo' in payload
            ? sanitizeImageDataUrl(payload.photo, 250000)
            : sanitizeImageDataUrl(currentUser.photo, 250000);
          const updateData: Record<string, unknown> = {
            name: safeName,
            jersey: Math.round(clampNum(payload.jersey ?? currentUser.jersey, 0, 99, 10)),
            age: Math.round(clampNum(payload.age ?? currentUser.age, 10, 70, 18)),
            height: Math.round(clampNum(payload.height ?? currentUser.height, 100, 230, 175)),
            weight: Math.round(clampNum(payload.weight ?? currentUser.weight, 30, 160, 70)),
            foot: sanitizeFoot(payload.foot ?? currentUser.foot),
            primaryPos: sanitizePrimaryPos(payload.primaryPos ?? currentUser.primaryPos),
            secondaryPos: sanitizeSecondaryPos(payload.secondaryPos ?? currentUser.secondaryPos),
            photo: cleanPhoto,
            hasPhoto: Boolean(cleanPhoto),
            photoZoom: Math.round(clampNum(payload.photoZoom ?? currentUser.photoZoom, 90, 160, 105)),
            photoY: Math.round(clampNum(payload.photoY ?? currentUser.photoY, 0, 60, 18)),
            top3Strengths: clampStr(payload.top3Strengths ?? currentUser.top3Strengths, 200),
            weak3Points: clampStr(payload.weak3Points ?? currentUser.weak3Points, 200),
            seasonGoal: clampStr(payload.seasonGoal ?? currentUser.seasonGoal, 200),
            availableStatus: normalizePublicAvailableStatus(currentUser.availableStatus),
            roleModelStarId: sanitizeStarId(payload.roleModelStarId ?? currentUser.roleModelStarId),
            updatedAtMs: Date.now(),
            updatedAt: serverTimestamp(),
          };
          if (payload.skills && typeof payload.skills === 'object') {
            updateData.skills = sanitizeSkills(payload.skills as Record<string, unknown>, 10);
          }
          const cleanStats6 = sanitizeStats6(payload.stats6);
          if (cleanStats6) updateData.stats6 = cleanStats6;
          if ('roleOverride' in payload) updateData.roleOverride = sanitizeRoleOverride(payload.roleOverride);
          try {
            await updateDoc(doc(db, 'teams', tid, 'members', playerId), stripForbiddenHealthFields(updateData));
            await this.refreshMultiMembers();
          } catch (err) {
            this.handleWriteError(err, OperationType.UPDATE, `teams/${tid}/members/${playerId}`);
          }
          return;
        }

        const ref = doc(db, 'players', playerId);
        const updateData: Record<string, unknown> = {
          name: safeName,
          jersey: Math.round(clampNum(payload.jersey ?? currentUser.jersey, 0, 99, 10)),
          age: Math.round(clampNum(payload.age ?? currentUser.age, 10, 70, 18)),
          height: Math.round(clampNum(payload.height ?? currentUser.height, 100, 230, 175)),
          weight: Math.round(clampNum(payload.weight ?? currentUser.weight, 30, 160, 70)),
          foot: sanitizeFoot(payload.foot ?? currentUser.foot),
          primaryPos: sanitizePrimaryPos(payload.primaryPos ?? currentUser.primaryPos),
          secondaryPos: sanitizeSecondaryPos(payload.secondaryPos ?? currentUser.secondaryPos),
          photoZoom: Math.round(clampNum(payload.photoZoom ?? currentUser.photoZoom, 90, 160, 105)),
          photoY: Math.round(clampNum(payload.photoY ?? currentUser.photoY, 0, 60, 18)),
          top3Strengths: clampStr(payload.top3Strengths ?? currentUser.top3Strengths, 200),
          weak3Points: clampStr(payload.weak3Points ?? currentUser.weak3Points, 200),
          seasonGoal: clampStr(payload.seasonGoal ?? currentUser.seasonGoal, 200),
          availability: clampStr(payload.availability ?? currentUser.availability, 120),
          availableStatus: currentUser.availableStatus === 'unavailable' ? 'unavailable' : 'available',
          roleModelStarId: sanitizeStarId(payload.roleModelStarId ?? currentUser.roleModelStarId),
          updatedAt: serverTimestamp(),
        };
        if (payload.skills && typeof payload.skills === 'object') {
          updateData.skills = sanitizeSkills(payload.skills as Record<string, unknown>, 10);
        }
        const cleanStats6 = sanitizeStats6(payload.stats6);
        if (cleanStats6) {
          updateData.stats6 = cleanStats6;
        }
        if ('roleOverride' in payload) {
          updateData.roleOverride = sanitizeRoleOverride(payload.roleOverride);
        }
        if ('photo' in payload) {
          const cleanPhoto = sanitizeImageDataUrl(payload.photo, 250000);
          updateData.hasPhoto = Boolean(cleanPhoto);
          const photoRef = doc(db, 'playerPhotos', playerId);
          try {
            await setDoc(photoRef, {
              teamId: TEAM_ID,
              playerId,
              ownerUid: String(currentUser.ownerUid || uid),
              dataUrl: cleanPhoto,
              photoZoom: updateData.photoZoom,
              photoY: updateData.photoY,
              updatedAt: serverTimestamp(),
            });
          } catch (err) {
            handleFirestoreError(err, OperationType.WRITE, `playerPhotos/${playerId}`);
          }
        }
        try {
          await updateDoc(ref, updateData);
        } catch (err) {
          handleFirestoreError(err, OperationType.UPDATE, `players/${playerId}`);
        }
        return;
      }

      case 'photo': {
        const playerId = String(currentUser.id || uid);
        const cleanPhoto = sanitizeImageDataUrl(payload.photo, 250000);
        const zoom = Math.round(clampNum(payload.photoZoom ?? currentUser.photoZoom, 90, 160, 105));
        const y = Math.round(clampNum(payload.photoY ?? currentUser.photoY, 0, 60, 18));
        if (isMulti) {
          try {
            await updateDoc(doc(db, 'teams', tid, 'members', playerId), {
              photo: cleanPhoto,
              hasPhoto: Boolean(cleanPhoto),
              photoZoom: zoom,
              photoY: y,
              updatedAtMs: Date.now(),
              updatedAt: serverTimestamp(),
            });
            await this.refreshMultiMembers();
          } catch (err) {
            this.handleWriteError(err, OperationType.UPDATE, `teams/${tid}/members/${playerId}`);
          }
          return;
        }
        const batch = writeBatch(db);
        batch.set(doc(db, 'playerPhotos', playerId), {
          teamId: TEAM_ID,
          playerId,
          ownerUid: String(currentUser.ownerUid || uid),
          dataUrl: cleanPhoto,
          photoZoom: zoom,
          photoY: y,
          updatedAt: serverTimestamp(),
        });
        batch.update(doc(db, 'players', playerId), {
          hasPhoto: Boolean(cleanPhoto),
          photoZoom: zoom,
          photoY: y,
          updatedAt: serverTimestamp(),
        });
        try {
          await batch.commit();
        } catch (err) {
          handleFirestoreError(err, OperationType.WRITE, `playerPhotos/${playerId}`);
        }
        return;
      }

      case 'roleModel': {
        const playerId = String(currentUser.id || uid);
        const roleModelStarId = sanitizeStarId(payload.roleModelStarId);
        try {
          if (isMulti) {
            await updateDoc(doc(db, 'teams', tid, 'members', playerId), {
              roleModelStarId,
              updatedAtMs: Date.now(),
              updatedAt: serverTimestamp(),
            });
            await this.refreshMultiMembers();
          } else {
            await updateDoc(doc(db, 'players', playerId), {
              roleModelStarId,
              updatedAt: serverTimestamp(),
            });
          }
        } catch (err) {
          handleFirestoreError(err, OperationType.UPDATE, isMulti ? `teams/${tid}/members/${playerId}` : `players/${playerId}`);
        }
        return;
      }

      case 'addPlayer': {
        if (!this.activeIsCaptain) {
          throw new Error('إضافة لاعب للقائمة متاحة للكابتن فقط');
        }
        const id = String(payload.id || makeId('p')).replace(/[^a-zA-Z0-9_-]/g, '');
        if (isMulti) {
          const teamMeta = (this.activeState?.settings || {}) as Record<string, unknown>;
          const maxM = Math.max(6, Math.min(100, Number(teamMeta.maxMembersPerTeam || DEFAULT_MAX_MEMBERS_PER_TEAM)));
          const curM = Math.max(this.activeState?.players?.length || 0, Number(teamMeta.memberCount || 0));
          if (curM >= maxM) {
            throw new Error(`اكتمل عدد أعضاء الفريق حالياً (الحد الأقصى ${maxM} لاعباً).`);
          }
          const batch = writeBatch(db);
          batch.set(doc(db, 'teams', tid, 'members', id), {
            id,
            uid: id,
            ownerUid: '',
            teamId: tid,
            name: clampStr(payload.name, 80) || 'لاعب',
            role: 'member',
            isOrganizer: false,
            jersey: Math.round(clampNum(payload.jersey, 0, 99, 7)),
            age: Math.round(clampNum(payload.age, 10, 70, 18)),
            height: 175,
            weight: 70,
            foot: sanitizeFoot(payload.foot),
            primaryPos: sanitizePrimaryPos(payload.primaryPos),
            secondaryPos: 'لا يوجد',
            photo: '',
            hasPhoto: false,
            photoZoom: 105,
            photoY: 18,
            skills: sanitizeSkills(payload.skills as Record<string, unknown> | undefined, 10),
            top3Strengths: '',
            weak3Points: '',
            seasonGoal: '',
            availableStatus: 'متاح',
            roleModelStarId: '',
            joinedAtMs: Date.now(),
            updatedAtMs: Date.now(),
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          batch.update(doc(db, 'teams', tid), {
            memberCount: increment(1),
            updatedAt: serverTimestamp(),
          });
          try {
            await batch.commit();
            await this.refreshMultiMembers();
          } catch (err) {
            this.handleWriteError(err, OperationType.CREATE, `teams/${tid}/members/${id}`);
          }
          return;
        }
        try {
          await setDoc(doc(db, 'players', id), {
            id,
            teamId: TEAM_ID,
            ownerUid: '',
            name: clampStr(payload.name, 80) || 'لاعب',
            role: 'player',
            jersey: Math.round(clampNum(payload.jersey, 0, 99, 7)),
            age: Math.round(clampNum(payload.age, 10, 70, 18)),
            height: 175,
            weight: 70,
            foot: sanitizeFoot(payload.foot),
            primaryPos: sanitizePrimaryPos(payload.primaryPos),
            secondaryPos: 'لا يوجد',
            photoZoom: 105,
            photoY: 18,
            hasPhoto: false,
            skills: sanitizeSkills(payload.skills as Record<string, unknown> | undefined, 10),
            top3Strengths: '',
            weak3Points: '',
            seasonGoal: '',
            availability: '',
            availableStatus: 'available',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        } catch (err) {
          this.handleWriteError(err, OperationType.CREATE, `players/${id}`);
        }
        return;
      }

      case 'approvePlayer': {
        if (!this.activeIsCaptain) {
          throw new Error('قبول طلبات الانضمام متاح للكابتن فقط');
        }
        const applicantUid = String(payload.uid || payload.id || '');
        if (!applicantUid) throw new Error('معرّف الطلب غير صالح');
        const cleanStats6 = sanitizeStats6(payload.stats6);
        const cleanRoleOverride = sanitizeRoleOverride(payload.roleOverride);
        const cleanReferredBy = sanitizeReferralCode(payload.referredBy);

        if (isMulti) {
          const teamMeta = (this.activeState?.settings || {}) as Record<string, unknown>;
          const maxM = Math.max(6, Math.min(100, Number(teamMeta.maxMembersPerTeam || DEFAULT_MAX_MEMBERS_PER_TEAM)));
          const curM = Math.max(this.activeState?.players?.length || 0, Number(teamMeta.memberCount || 0));
          if (curM >= maxM) {
            throw new Error(`اكتمل عدد أعضاء الفريق حالياً (الحد الأقصى ${maxM} لاعباً).`);
          }
          const batch = writeBatch(db);
          batch.update(doc(db, 'teams', tid, 'joinRequests', applicantUid), {
            status: 'approved',
            updatedAt: serverTimestamp(),
          });
          const newMemberDoc: Record<string, unknown> = {
            id: applicantUid,
            uid: applicantUid,
            ownerUid: applicantUid,
            teamId: tid,
            name: clampStr(payload.name, 80) || 'لاعب',
            role: 'member',
            isOrganizer: false,
            jersey: Math.round(clampNum(payload.jersey, 1, 99, 7)),
            age: 18,
            height: 175,
            weight: 70,
            foot: 'يمين',
            primaryPos: sanitizePrimaryPos(payload.primaryPos),
            secondaryPos: 'لا يوجد',
            photo: '',
            hasPhoto: false,
            photoZoom: 105,
            photoY: 18,
            skills: cleanStats6
              ? stats6ToLegacySkills(cleanStats6)
              : sanitizeSkills({
                  speed: 7,
                  shooting: 6,
                  passing: 7,
                  dribbling: 6,
                  defending: 6,
                  stamina: 7,
                  vision: 6,
                  teamwork: 7,
                  control: 7,
                  positioning: 6,
                }),
            top3Strengths: '',
            weak3Points: '',
            seasonGoal: '',
            availableStatus: 'متاح',
            roleModelStarId: '',
            joinedAtMs: Date.now(),
            updatedAtMs: Date.now(),
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          };
          if (cleanStats6) newMemberDoc.stats6 = cleanStats6;
          if (cleanRoleOverride) newMemberDoc.roleOverride = cleanRoleOverride;
          batch.set(doc(db, 'teams', tid, 'members', applicantUid), newMemberDoc);
          batch.update(doc(db, 'teams', tid), {
            memberCount: increment(1),
            updatedAt: serverTimestamp(),
          });
          try {
            await batch.commit();
            await this.refreshMultiMembers();
          } catch (err) {
            handleFirestoreError(err, OperationType.WRITE, `teams/${tid}/joinRequests/${applicantUid}`);
          }
          return;
        }

        const batch = writeBatch(db);
        batch.update(doc(db, 'joinRequests', applicantUid), {
          status: 'approved',
          updatedAt: serverTimestamp(),
        });
        const newPlayerDoc: Record<string, unknown> = {
          id: applicantUid,
          teamId: TEAM_ID,
          ownerUid: applicantUid,
          name: clampStr(payload.name, 80) || 'لاعب',
          role: 'player',
          jersey: Math.round(clampNum(payload.jersey, 1, 99, 7)),
          age: 18,
          height: 175,
          weight: 70,
          foot: 'يمين',
          primaryPos: sanitizePrimaryPos(payload.primaryPos),
          secondaryPos: 'لا يوجد',
          photoZoom: 105,
          photoY: 18,
          hasPhoto: false,
          skills: cleanStats6
            ? stats6ToLegacySkills(cleanStats6)
            : sanitizeSkills({
                speed: 7,
                shooting: 6,
                passing: 7,
                dribbling: 6,
                defending: 6,
                stamina: 7,
                vision: 6,
                teamwork: 7,
                control: 7,
                positioning: 6,
              }),
          top3Strengths: '',
          weak3Points: '',
          seasonGoal: '',
          availability: '',
          availableStatus: 'available',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };
        if (cleanStats6) newPlayerDoc.stats6 = cleanStats6;
        if (cleanRoleOverride) newPlayerDoc.roleOverride = cleanRoleOverride;
        if (cleanReferredBy) newPlayerDoc.referredBy = cleanReferredBy;
        batch.set(doc(db, 'players', applicantUid), newPlayerDoc);
        try {
          await batch.commit();
        } catch (err) {
          handleFirestoreError(err, OperationType.WRITE, `joinRequests/${applicantUid}`);
        }
        return;
      }

      case 'rejectPlayer': {
        if (!this.activeIsCaptain) {
          throw new Error('رفض طلبات الانضمام متاح للكابتن فقط');
        }
        const applicantUid = String(payload.id || payload.uid || '');
        if (!applicantUid) return;
        try {
          if (isMulti) {
            await updateDoc(doc(db, 'teams', tid, 'joinRequests', applicantUid), {
              status: 'rejected',
              updatedAt: serverTimestamp(),
            });
          } else {
            await updateDoc(doc(db, 'joinRequests', applicantUid), {
              status: 'rejected',
              updatedAt: serverTimestamp(),
            });
          }
        } catch (err) {
          this.handleWriteError(err, OperationType.UPDATE, isMulti ? `teams/${tid}/joinRequests/${applicantUid}` : `joinRequests/${applicantUid}`);
        }
        return;
      }

      case 'attendance': {
        const playerId = String(currentUser.id || uid).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 100) || uid;
        const dateStr = sanitizeDateStr(payload.date);
        const typeStr = clampStr(payload.type || 'مباراة', 40) || 'مباراة';
        const status = normalizeAttendanceStatus(payload.status);
        const cleanPlayerName = clampStr(payload.playerName || currentUser.name, 80) || 'لاعب';

        if (isMulti) {
          const matchKey = buildAttendanceMatchKey(dateStr, typeStr);
          const attDocRef = doc(db, 'teams', tid, 'attendance', matchKey);
          try {
            await runTransaction(db, async (tx) => {
              const snap = await tx.get(attDocRef);
              const prevData = snap.exists() ? snap.data() : {};
              const prevResponses =
                prevData.responses && typeof prevData.responses === 'object'
                  ? { ...(prevData.responses as Record<string, unknown>) }
                  : {};
              prevResponses[playerId] = {
                uid: playerId,
                playerName: cleanPlayerName,
                status,
                updatedAtMs: Date.now(),
              };
              tx.set(attDocRef, {
                matchKey,
                teamId: tid,
                date: dateStr,
                type: typeStr,
                responses: prevResponses,
                updatedAtMs: Date.now(),
                updatedAt: serverTimestamp(),
              });
            });
          } catch (err) {
            this.handleWriteError(err, OperationType.WRITE, `teams/${tid}/attendance/${matchKey}`);
          }
          return;
        }

        const id = `${dateStr}__${playerId}`;
        const attRef = doc(db, 'attendance', id);
        try {
          await runTransaction(db, async (tx) => {
            const snap = await tx.get(attRef);
            const createdAtVal = snap.exists() && snap.data().createdAt
              ? snap.data().createdAt
              : serverTimestamp();
            tx.set(attRef, {
              teamId: TEAM_ID,
              playerId,
              ownerUid: uid,
              playerName: cleanPlayerName,
              date: dateStr,
              type: typeStr,
              status,
              createdAt: createdAtVal,
              updatedAt: serverTimestamp(),
            });
          });
        } catch (err) {
          this.handleWriteError(err, OperationType.WRITE, `attendance/${id}`);
        }
        return;
      }

      case 'readiness': {
        const id = makeId('rd');
        try {
          if (isMulti) {
            await setDoc(doc(db, 'teams', tid, 'members', uid, 'private', id), {
              kind: 'readiness',
              uid,
              teamId: tid,
              date: sanitizeDateStr(payload.date),
              sleep: Math.round(clampNum(payload.sleep, 1, 10, 8)),
              fatigue: Math.round(clampNum(payload.fatigue, 1, 10, 8)),
              mood: Math.round(clampNum(payload.mood, 1, 10, 8)),
              updatedAtMs: Date.now(),
              createdAt: serverTimestamp(),
            });
            await this.refreshMyPrivateRecords();
          } else {
            await setDoc(doc(db, 'readiness', id), {
              teamId: TEAM_ID,
              playerId: String(currentUser.id || uid),
              ownerUid: uid,
              date: sanitizeDateStr(payload.date),
              sleep: Math.round(clampNum(payload.sleep, 1, 10, 8)),
              fatigue: Math.round(clampNum(payload.fatigue, 1, 10, 8)),
              mood: Math.round(clampNum(payload.mood, 1, 10, 8)),
              createdAt: serverTimestamp(),
            });
          }
        } catch (err) {
          handleFirestoreError(err, OperationType.CREATE, isMulti ? `teams/${tid}/members/${uid}/private/${id}` : `readiness/${id}`);
        }
        return;
      }

      case 'injury': {
        const id = makeId('inj');
        const severity =
          payload.severity === 'متوسطة' || payload.severity === 'شديدة'
            ? payload.severity
            : 'خفيفة';
        if (isMulti) {
          const batch = writeBatch(db);
          batch.set(doc(db, 'teams', tid, 'members', uid, 'private', id), {
            kind: 'injury',
            uid,
            teamId: tid,
            type: clampStr(payload.type, 80) || 'التواء الكاحل',
            location: clampStr(payload.location, 100) || 'القدم',
            severity,
            date: sanitizeDateStr(payload.date),
            expectedReturn: sanitizeDateStr(payload.expectedReturn),
            updatedAtMs: Date.now(),
            createdAt: serverTimestamp(),
          });
          batch.update(doc(db, 'teams', tid, 'members', String(currentUser.id || uid)), {
            availableStatus: 'غير متاح',
            updatedAtMs: Date.now(),
            updatedAt: serverTimestamp(),
          });
          try {
            await batch.commit();
            await this.refreshMyPrivateRecords();
            await this.refreshMultiMembers();
          } catch (err) {
            handleFirestoreError(err, OperationType.CREATE, `teams/${tid}/members/${uid}/private/${id}`);
          }
          return;
        }
        const batch = writeBatch(db);
        batch.set(doc(db, 'injuries', id), {
          teamId: TEAM_ID,
          playerId: String(currentUser.id || uid),
          ownerUid: uid,
          type: clampStr(payload.type, 80) || 'التواء الكاحل',
          location: clampStr(payload.location, 100) || 'القدم',
          severity,
          date: sanitizeDateStr(payload.date),
          expectedReturn: sanitizeDateStr(payload.expectedReturn),
          createdAt: serverTimestamp(),
        });
        batch.update(doc(db, 'players', String(currentUser.id || uid)), {
          availableStatus: 'unavailable',
          updatedAt: serverTimestamp(),
        });
        try {
          await batch.commit();
        } catch (err) {
          handleFirestoreError(err, OperationType.CREATE, `injuries/${id}`);
        }
        return;
      }

      case 'recoverAvailable': {
        const playerId = String(currentUser.id || uid);
        try {
          if (isMulti) {
            await updateDoc(doc(db, 'teams', tid, 'members', playerId), {
              availableStatus: 'متاح',
              updatedAtMs: Date.now(),
              updatedAt: serverTimestamp(),
            });
            await this.refreshMultiMembers();
          } else {
            await updateDoc(doc(db, 'players', playerId), {
              availableStatus: 'available',
              updatedAt: serverTimestamp(),
            });
          }
        } catch (err) {
          this.handleWriteError(err, OperationType.UPDATE, isMulti ? `teams/${tid}/members/${playerId}` : `players/${playerId}`);
        }
        return;
      }

      case 'match': {
        if (!this.isTeamOrganizer(uid)) {
          throw new Error('تسجيل نتيجة المباراة الرسمية متاح لمؤسس الفريق والمنظّمين فقط');
        }
        const id = String(payload.id || makeId('m')).replace(/[^a-zA-Z0-9_-]/g, '');
        const ourScore = Math.round(clampNum(payload.ourScore, 0, 99, 0));
        const oppScore = Math.round(clampNum(payload.oppScore, 0, 99, 0));
        const matchRef = isMulti ? doc(db, 'teams', tid, 'matches', id) : doc(db, 'matches', id);
        try {
          await setDoc(matchRef, {
            teamId: tid,
            date: sanitizeDateStr(payload.date),
            opponent: clampStr(payload.opponent, 80) || 'خصم',
            ourScore,
            oppScore,
            result: ourScore > oppScore ? 'فوز' : ourScore < oppScore ? 'خسارة' : 'تعادل',
            createdBy: uid,
            createdAt: serverTimestamp(),
          });
          if (isMulti) await this.refreshMatchesPage(undefined, false);
        } catch (err) {
          this.handleWriteError(err, OperationType.CREATE, isMulti ? `teams/${tid}/matches/${id}` : `matches/${id}`);
        }
        return;
      }

      case 'report': {
        const id = makeId('rep');
        const nowMs = Date.now();
        const playerId = String(currentUser.id || uid).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 128) || uid;
        const playerName = clampStr(payload.playerName || currentUser.name, 80) || 'لاعب';
        const opponent = clampStr(payload.opponent, 80) || 'خصم';
        const goalsNum = Number(payload.goals ?? 0);
        const assistsNum = Number(payload.assists ?? 0);
        const minutesNum = Number(payload.minutes ?? 50);

        const initialCheck = evaluateReportSubmissionGuard({
          goals: goalsNum,
          assists: assistsNum,
          minutes: minutesNum,
          goalsConceded: payload.goalsConceded,
          nowMs,
        });
        if (!initialCheck.allowed) {
          throw new Error(initialCheck.errorAr || 'بيانات التقرير غير صالحة');
        }

        const throttleRef = isMulti ? doc(db, 'teams', tid, 'reportThrottle', uid) : doc(db, 'reportThrottle', uid);
        const reportRef = isMulti ? doc(db, 'teams', tid, 'reports', id) : doc(db, 'reports', id);
        const sid = String(payload.matchSessionId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 128);

        try {
          await runTransaction(db, async (tx) => {
            const thSnap = await tx.get(throttleRef);
            let lastMs = 0;
            if (thSnap.exists()) {
              const d = thSnap.data();
              const tsMillis =
                d.updatedAt && typeof d.updatedAt.toMillis === 'function'
                  ? Number(d.updatedAt.toMillis())
                  : Number(d.lastReportAtMs || 0);
              lastMs = Math.max(tsMillis, Number(d.lastReportAtMs || 0));
            }
            const txCheck = evaluateReportSubmissionGuard({
              goals: goalsNum,
              assists: assistsNum,
              minutes: minutesNum,
              goalsConceded: payload.goalsConceded,
              lastReportAtMs: lastMs,
              nowMs,
            });
            if (!txCheck.allowed) {
              throw new Error(
                txCheck.errorAr ||
                  `حماية نقاط الخبرة: انتظر ${Math.ceil(REPORT_COOLDOWN_MS / 60000)} دقيقة بين التقارير.`
              );
            }

            const reportDoc: Record<string, unknown> = {
              teamId: tid,
              playerId,
              ownerUid: uid,
              playerName,
              opponent,
              goals: Math.min(MAX_GOALS_PER_MATCH, txCheck.sanitized.goals),
              assists: Math.min(MAX_ASSISTS_PER_MATCH, txCheck.sanitized.assists),
              minutes: txCheck.sanitized.minutes,
              interceptions: Math.round(clampNum(payload.interceptions, 0, 60, 0)),
              turnovers: Math.round(clampNum(payload.turnovers, 0, 60, 0)),
              rating: Math.round(clampNum(payload.rating, 1, 10, 8)),
              rpe: Math.round(clampNum(payload.rpe, 1, 10, 7)),
              bestMoment: clampStr(payload.bestMoment, 200),
              worstMoment: clampStr(payload.worstMoment, 200),
              motmVote: clampStr(payload.motmVote, 128),
              pitchMode: sanitizePitchMode(payload.pitchMode),
              matchResult: sanitizeMatchResult(payload.matchResult),
              goalsConceded: Math.min(MAX_CONCEDED_PER_MATCH, txCheck.sanitized.goalsConceded),
              confirmedByUids: [],
              verified: false,
              createdAtMs: nowMs,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            };
            if (sid) reportDoc.matchSessionId = sid;

            tx.set(throttleRef, {
              uid,
              teamId: tid,
              lastReportAtMs: nowMs,
              updatedAt: serverTimestamp(),
            });
            tx.set(reportRef, reportDoc);
          });
          if (isMulti) await this.refreshReportsPage(undefined, false);
        } catch (err) {
          if (err instanceof Error && !err.message.includes('Missing or insufficient permissions')) {
            throw err;
          }
          this.handleWriteError(err, OperationType.CREATE, isMulti ? `teams/${tid}/reports/${id}` : `reports/${id}`);
        }
        return;
      }

      case 'confirmReport': {
        const reportId = String(payload.reportId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 128);
        if (!reportId) throw new Error('معرّف التقرير غير صالح');
        const repRef = isMulti ? doc(db, 'teams', tid, 'reports', reportId) : doc(db, 'reports', reportId);
        try {
          await runTransaction(db, async (tx) => {
            const snap = await tx.get(repRef);
            if (!snap.exists()) {
              throw new Error('لم يتم العثور على التقرير');
            }
            const data = snap.data();
            const check = applyReportConfirmation(
              {
                ownerUid: String(data.ownerUid || ''),
                playerId: String(data.playerId || ''),
                confirmedByUids: Array.isArray(data.confirmedByUids) ? (data.confirmedByUids as string[]) : [],
              },
              uid
            );
            if (!check.ok) {
              throw new Error(check.errorAr || 'لا يمكنك توثيق هذا التقرير');
            }
            if (check.alreadyConfirmed) return;
            tx.update(repRef, {
              confirmedByUids: check.confirmedByUids,
              verified: true,
              updatedAt: serverTimestamp(),
            });
          });
          if (isMulti) await this.refreshReportsPage(undefined, false);
        } catch (err) {
          if (err instanceof Error && !err.message.includes('Missing or insufficient permissions')) {
            throw err;
          }
          this.handleWriteError(err, OperationType.UPDATE, isMulti ? `teams/${tid}/reports/${reportId}` : `reports/${reportId}`);
        }
        return;
      }

      case 'peerRating': {
        const targetId = String(payload.targetId || '').replace(/[^a-zA-Z0-9_-]/g, '');
        const score = Math.round(clampNum(payload.score, 1, 10, 7));
        if (!targetId) throw new Error('اختر لاعباً للتقييم');
        if (targetId === uid || targetId === String(currentUser.id || '')) {
          throw new Error('لا يمكنك تقييم نفسك');
        }
        const ballotId = `${targetId}__${uid}`;
        const ballotRef = isMulti ? doc(db, 'teams', tid, 'peerRatings', ballotId) : doc(db, 'peerRatings', ballotId);
        const statRef = isMulti ? doc(db, 'teams', tid, 'peerRatingStats', targetId) : doc(db, 'peerRatingStats', targetId);

        let existingBallot;
        try {
          existingBallot = await getDoc(ballotRef);
        } catch (err) {
          handleFirestoreError(err, OperationType.GET, isMulti ? `teams/${tid}/peerRatings/${ballotId}` : `peerRatings/${ballotId}`);
        }

        const batch = writeBatch(db);
        if (!existingBallot.exists()) {
          batch.set(ballotRef, {
            targetId,
            raterUid: uid,
            score,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          batch.set(
            statRef,
            {
              teamId: tid,
              targetId,
              count: increment(1),
              totalScore: increment(score),
              updatedAt: serverTimestamp(),
            },
            { merge: true }
          );
        } else {
          const oldScore = Number(existingBallot.data().score || 0);
          const delta = score - oldScore;
          batch.update(ballotRef, {
            score,
            updatedAt: serverTimestamp(),
          });
          batch.update(statRef, {
            totalScore: increment(delta),
            updatedAt: serverTimestamp(),
          });
        }

        try {
          await batch.commit();
        } catch (err) {
          this.handleWriteError(err, OperationType.WRITE, isMulti ? `teams/${tid}/peerRatings/${ballotId}` : `peerRatings/${ballotId}`);
        }
        return;
      }

      case 'adminRating': {
        if (!this.activeIsCaptain) {
          throw new Error('تقييم الكابتن الرسمي متاح لمؤسس الفريق فقط');
        }
        const targetId = String(payload.targetId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 128);
        const score = Math.round(clampNum(payload.score, 1, 10, 7));
        if (!targetId) throw new Error('اختر لاعباً لتسجيل تقييم الكابتن');
        const arRef = isMulti ? doc(db, 'teams', tid, 'adminRatings', targetId) : doc(db, 'adminRatings', targetId);
        try {
          await setDoc(arRef, {
            teamId: tid,
            targetId,
            score,
            updatedAt: serverTimestamp(),
          });
          if (isMulti) await this.refreshAdminRatings();
        } catch (err) {
          this.handleWriteError(err, OperationType.WRITE, isMulti ? `teams/${tid}/adminRatings/${targetId}` : `adminRatings/${targetId}`);
        }
        return;
      }

      case 'suggestion': {
        const text = clampStr(payload.text, 500);
        if (!text) return;
        const id = makeId('sugg');
        const suggRef = isMulti ? doc(db, 'teams', tid, 'suggestions', id) : doc(db, 'suggestions', id);
        try {
          await setDoc(suggRef, {
            teamId: tid,
            text,
            createdAt: serverTimestamp(),
          });
          if (isMulti && this.activeState) {
            this.activeState.suggestions.unshift({ id, teamId: tid, text, createdAtMs: Date.now() });
            if (this.activeOnUpdate) this.activeOnUpdate();
          }
        } catch (err) {
          handleFirestoreError(err, OperationType.CREATE, isMulti ? `teams/${tid}/suggestions/${id}` : `suggestions/${id}`);
        }
        return;
      }

      case 'tactics': {
        const curSettings = (this.activeState?.settings || {}) as Record<string, unknown>;
        const orgUids = Array.isArray(curSettings.organizerUids)
          ? (curSettings.organizerUids as string[])
          : [];
        const lineupPerm =
          curSettings.lineupPublishMode === 'organizers' || curSettings.lineupPermission === 'organizers'
            ? 'organizers'
            : 'all';
        const canPublish =
          this.activeIsCaptain ||
          lineupPerm === 'all' ||
          orgUids.includes(uid);
        if (!canPublish) {
          throw new Error('نشر التشكيلة الرسمية مقتصر حالياً على منشئ الفريق ومنظّمي التشكيلة');
        }
        const rawSlots = (payload.slots && typeof payload.slots === 'object'
          ? payload.slots
          : {}) as Record<string, unknown>;
        const slots: Record<string, string> = {};
        for (const [k, v] of Object.entries(rawSlots).slice(0, 20)) {
          if (typeof v === 'string' && v.trim()) {
            slots[k.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40)] = v
              .replace(/[^a-zA-Z0-9_-]/g, '')
              .slice(0, 128);
          }
        }
        const nextFormation = sanitizeFormation(payload.formation);
        const pubByName = clampStr(payload.publishedByName || currentUser.name || 'لاعب', 80) || 'لاعب';
        const pubAtMs = Date.now();
        const tacticsRef = isMulti ? doc(db, 'teams', tid, 'tactics', 'current') : doc(db, 'tactics', 'current');
        try {
          await runTransaction(db, async (tx) => {
            const snap = await tx.get(tacticsRef);
            let prevSnapshot: TacticsSnapshotRecord | null = null;
            if (snap.exists()) {
              const cur = snap.data();
              prevSnapshot = {
                formation: sanitizeFormation(cur.formation),
                slots: (cur.slots && typeof cur.slots === 'object' ? cur.slots : {}) as Record<string, string>,
                ...(cur.publishedByUid ? { publishedByUid: String(cur.publishedByUid) } : {}),
                ...(cur.publishedByName ? { publishedByName: String(cur.publishedByName) } : {}),
                ...(typeof cur.publishedAtMs === 'number' ? { publishedAtMs: cur.publishedAtMs } : {}),
              };
            }
            tx.set(tacticsRef, {
              teamId: tid,
              formation: nextFormation,
              slots,
              publishedByUid: uid,
              publishedByName: pubByName,
              publishedAtMs: pubAtMs,
              ...(prevSnapshot ? { previousSnapshot: prevSnapshot } : {}),
              updatedAt: serverTimestamp(),
            });
          });
        } catch (err) {
          this.handleWriteError(err, OperationType.WRITE, isMulti ? `teams/${tid}/tactics/current` : 'tactics/current');
        }
        return;
      }

      case 'undoTactics': {
        const curSettings = (this.activeState?.settings || {}) as Record<string, unknown>;
        const orgUids = Array.isArray(curSettings.organizerUids)
          ? (curSettings.organizerUids as string[])
          : [];
        const lineupPerm =
          curSettings.lineupPublishMode === 'organizers' || curSettings.lineupPermission === 'organizers'
            ? 'organizers'
            : 'all';
        const canPublish =
          this.activeIsCaptain ||
          lineupPerm === 'all' ||
          orgUids.includes(uid);
        if (!canPublish) {
          throw new Error('التراجع عن نشر التشكيلة متاح لمنشئ الفريق والمنظّمين فقط');
        }
        const tacticsRef = isMulti ? doc(db, 'teams', tid, 'tactics', 'current') : doc(db, 'tactics', 'current');
        try {
          let restored: TacticsSnapshotRecord | null = null;
          await runTransaction(db, async (tx) => {
            const snap = await tx.get(tacticsRef);
            if (!snap.exists()) throw new Error('لا توجد تشكيلة سابقة للتراجع إليها');
            const prev = snap.data().previousSnapshot as TacticsSnapshotRecord | undefined;
            if (!prev || typeof prev !== 'object') {
              throw new Error('لا توجد نسخة سابقة محفوظة للتراجع');
            }
            restored = {
              formation: sanitizeFormation(prev.formation),
              slots: (prev.slots && typeof prev.slots === 'object' ? prev.slots : {}) as Record<string, string>,
              ...(prev.publishedByUid ? { publishedByUid: String(prev.publishedByUid) } : {}),
              ...(prev.publishedByName ? { publishedByName: String(prev.publishedByName) } : {}),
              ...(typeof prev.publishedAtMs === 'number' ? { publishedAtMs: prev.publishedAtMs } : {}),
            };
            tx.set(tacticsRef, {
              teamId: tid,
              ...restored,
              previousSnapshot: null,
              updatedAt: serverTimestamp(),
            });
          });
          return restored ? { tactics: restored } : undefined;
        } catch (err) {
          if (err instanceof Error && !err.message.includes('Missing or insufficient permissions')) {
            throw err;
          }
          this.handleWriteError(err, OperationType.WRITE, isMulti ? `teams/${tid}/tactics/current` : 'tactics/current');
        }
        return;
      }

      case 'voteLineup': {
        const vote = payload.vote === 'swap' ? 'swap' : 'approve';
        const voteRef = isMulti ? doc(db, 'teams', tid, 'lineupVotes', uid) : doc(db, 'lineupVotes', uid);
        try {
          await setDoc(voteRef, {
            teamId: tid,
            uid,
            vote,
            updatedAt: serverTimestamp(),
          });
        } catch (err) {
          this.handleWriteError(err, OperationType.WRITE, isMulti ? `teams/${tid}/lineupVotes/${uid}` : `lineupVotes/${uid}`);
        }
        return;
      }

      case 'leaveTeam': {
        if (this.activeIsCaptain) {
          throw new Error('منشئ الفريق لا يمكنه المغادرة مباشرة — انقل القيادة لعضو آخر أولاً أو استخدم حذف الفريق.');
        }
        if (isMulti) {
          const remainingIds = this.activeTeams.map((t) => t.id).filter((id) => id !== tid);
          const batch = writeBatch(db);
          batch.delete(doc(db, 'teams', tid, 'members', uid));
          batch.delete(doc(db, 'teams', tid, 'joinRequests', uid));
          batch.update(doc(db, 'teams', tid), {
            memberCount: increment(-1),
            organizerUids: arrayRemove(uid),
            updatedAt: serverTimestamp(),
          });
          batch.set(
            doc(db, 'users', uid),
            {
              uid,
              teamIds: arrayRemove(tid),
              activeTeamId: remainingIds[0] || '',
              updatedAt: serverTimestamp(),
            },
            { merge: true }
          );
          try {
            await batch.commit();
            this.activeTeams = this.activeTeams.filter((t) => t.id !== tid);
          } catch (err) {
            this.handleWriteError(err, OperationType.DELETE, `teams/${tid}/members/${uid}`);
          }
          return;
        }
        const batch = writeBatch(db);
        batch.delete(doc(db, 'players', uid));
        batch.delete(doc(db, 'playerPhotos', uid));
        batch.delete(doc(db, 'joinRequests', uid));
        try {
          await batch.commit();
        } catch (err) {
          this.handleWriteError(err, OperationType.DELETE, `players/${uid}`);
        }
        return;
      }

      case 'settings': {
        const curSettings = (this.activeState?.settings || {}) as Record<string, unknown>;
        const orgUids = Array.isArray(curSettings.organizerUids)
          ? (curSettings.organizerUids as string[])
          : [];
        const isDesignatedOrganizer = !this.activeIsCaptain && orgUids.includes(uid);

        if (!this.activeIsCaptain && !isDesignatedOrganizer) {
          throw new Error('تعديل إعدادات وهوية الفريق متاح لمؤسس الفريق والمنظّمين فقط');
        }

        const teamName = clampStr(payload.teamName || curSettings.teamName || 'فريق السداسي', 80) || 'فريق السداسي';
        const lineupPublishMode = sanitizeLineupPublishMode(payload.lineupPublishMode ?? payload.lineupPermission);
        const defaultCurrency = clampStr(payload.defaultCurrency || curSettings.defaultCurrency || 'ريال', 20) || 'ريال';
        const defaultPitchCost = Math.round(clampNum(payload.defaultPitchCost ?? curSettings.defaultPitchCost, 0, 100000, 0) * 10) / 10;

        if (isMulti) {
          const logoCheck = sanitizeTeamLogo50Kb(payload.logo !== undefined ? payload.logo : curSettings.logo);
          if (!logoCheck.ok) {
            throw new Error(logoCheck.errorAr || 'حجم شعار الفريق يتجاوز 50 كيلوبايت');
          }
          const logo = logoCheck.dataUrl;

          if (isDesignatedOrganizer) {
            try {
              await updateDoc(doc(db, 'teams', tid), {
                teamName,
                logo,
                defaultCurrency,
                defaultPitchCost,
                lineupPublishMode,
                updatedAtMs: Date.now(),
                updatedAt: serverTimestamp(),
              });
            } catch (err) {
              this.handleWriteError(err, OperationType.UPDATE, `teams/${tid}`);
            }
            return;
          }

          const appName = clampStr(payload.appName || curSettings.appName || 'ميدان 6v6', 60) || 'ميدان 6v6';
          const primaryColor = sanitizeHexColor(payload.primaryColor || curSettings.primaryColor, ROYAL_PRIMARY);
          const secondaryColor = sanitizeHexColor(payload.secondaryColor || curSettings.secondaryColor, ROYAL_SECONDARY);
          const inviteCode =
            sanitizeInviteCode(payload.inviteCode || curSettings.inviteCode) || generateSecureInviteCode(12);
          const memberShareCode =
            sanitizeInviteCode(payload.memberShareCode || curSettings.memberShareCode) ||
            generateSecureInviteCode(12);
          const joinMode = sanitizeJoinMode(
            payload.joinMode !== undefined
              ? payload.joinMode
              : payload.requireApproval === false
                ? 'instant'
                : 'approval'
          );
          const requireApproval = joinMode === 'approval';
          const lockSkills = Boolean(payload.lockSkills);
          const maxMembersPerTeam = Math.round(
            clampNum(payload.maxMembersPerTeam ?? curSettings.maxMembersPerTeam, 6, 100, DEFAULT_MAX_MEMBERS_PER_TEAM)
          );
          const founderUid = String(curSettings.founderUid || curSettings.creatorUid || uid).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 128) || uid;
          const rawOrgUids = Array.isArray(payload.organizerUids) ? payload.organizerUids : orgUids;
          const cleanOrgUids = Array.from(
            new Set(
              [...rawOrgUids.map((x) => String(x || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 128))]
                .filter((x) => Boolean(x) && x !== founderUid)
            )
          ).slice(0, 30);

          const authCtx = { isFirebaseMode: true, isCaptainSession: true };
          const mainInvRec = createSmartInvitationRecord(
            {
              teamId: tid,
              customCode: inviteCode,
              teamName,
              appName,
              primaryColor,
              joinMode,
              requireApproval,
              isMemberShareCode: false,
              usageType: 'multi',
              maxUses: 20,
              durationDays: 7,
            },
            authCtx
          );
          const shareInvRec = createSmartInvitationRecord(
            {
              teamId: tid,
              customCode: memberShareCode,
              teamName,
              appName,
              primaryColor,
              joinMode: 'approval',
              requireApproval: true,
              isMemberShareCode: true,
              usageType: 'multi',
              maxUses: 100,
              durationDays: 90,
            },
            authCtx
          );

          const batch = writeBatch(db);
          batch.update(doc(db, 'teams', tid), {
            appName,
            teamName,
            primaryColor,
            secondaryColor,
            logo,
            inviteCode,
            memberShareCode,
            joinMode,
            lineupPublishMode,
            lockSkills,
            maxMembersPerTeam,
            organizerUids: cleanOrgUids,
            defaultCurrency,
            defaultPitchCost,
            updatedAtMs: Date.now(),
            updatedAt: serverTimestamp(),
          });
          batch.set(
            doc(db, 'inviteCodes', inviteCode),
            {
              code: inviteCode,
              active: true,
              joinMode,
              requireApproval,
              isMemberShareCode: false,
              teamId: tid,
              teamName,
              appName,
              primaryColor,
              usageType: mainInvRec.usageType,
              maxUses: mainInvRec.maxUses,
              usedCount: 0,
              durationDays: mainInvRec.durationDays,
              createdAtMs: mainInvRec.createdAtMs,
              expiresAtMs: mainInvRec.expiresAtMs,
              status: 'active',
              updatedAt: serverTimestamp(),
            },
            { merge: true }
          );
          batch.set(
            doc(db, 'inviteCodes', memberShareCode),
            {
              code: memberShareCode,
              active: true,
              joinMode: 'approval',
              requireApproval: true,
              isMemberShareCode: true,
              teamId: tid,
              teamName,
              appName,
              primaryColor,
              usageType: shareInvRec.usageType,
              maxUses: shareInvRec.maxUses,
              usedCount: 0,
              durationDays: shareInvRec.durationDays,
              createdAtMs: shareInvRec.createdAtMs,
              expiresAtMs: shareInvRec.expiresAtMs,
              status: 'active',
              updatedAt: serverTimestamp(),
            },
            { merge: true }
          );
          try {
            await batch.commit();
          } catch (err) {
            this.handleWriteError(err, OperationType.WRITE, `teams/${tid}`);
          }
          return;
        }

        // Single-Team Legacy Settings
        const logo = sanitizeImageDataUrl(payload.logo !== undefined ? payload.logo : curSettings.logo, 180000);
        if (isDesignatedOrganizer) {
          try {
            await updateDoc(doc(db, 'settings', 'team'), {
              teamName,
              logo,
              defaultCurrency,
              defaultPitchCost,
              lineupPermission: lineupPublishMode,
              updatedAt: serverTimestamp(),
            });
          } catch (err) {
            this.handleWriteError(err, OperationType.UPDATE, 'settings/team');
          }
          return;
        }

        const appName = clampStr(payload.appName || curSettings.appName || 'ميدان 6v6', 60) || 'ميدان 6v6';
        const primaryColor = sanitizeHexColor(payload.primaryColor || curSettings.primaryColor, ROYAL_PRIMARY);
        const secondaryColor = sanitizeHexColor(payload.secondaryColor || curSettings.secondaryColor, ROYAL_SECONDARY);
        const inviteCode =
          sanitizeInviteCode(payload.inviteCode || curSettings.inviteCode) || generateSecureInviteCode(12);
        const memberShareCode =
          sanitizeInviteCode(payload.memberShareCode || curSettings.memberShareCode) ||
          generateSecureInviteCode(12);
        const requireApproval = payload.requireApproval !== false;
        const lockSkills = Boolean(payload.lockSkills);
        const creatorUid = String(curSettings.creatorUid || uid).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 128) || uid;
        const rawOrgUids = Array.isArray(payload.organizerUids) ? payload.organizerUids : orgUids;
        const cleanOrgUids = Array.from(
          new Set(
            [creatorUid, ...rawOrgUids.map((x) => String(x || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 128))]
              .filter(Boolean)
          )
        ).slice(0, 30);

        const authCtx = { isFirebaseMode: true, isCaptainSession: true };
        const mainInvRec = createSmartInvitationRecord(
          {
            customCode: inviteCode,
            teamName,
            appName,
            primaryColor,
            requireApproval,
            isMemberShareCode: false,
            usageType: 'multi',
            maxUses: 20,
            durationDays: 7,
          },
          authCtx
        );
        const shareInvRec = createSmartInvitationRecord(
          {
            customCode: memberShareCode,
            teamName,
            appName,
            primaryColor,
            requireApproval: true,
            isMemberShareCode: true,
            usageType: 'multi',
            maxUses: 100,
            durationDays: 90,
          },
          authCtx
        );

        const batch = writeBatch(db);
        batch.set(doc(db, 'settings', 'team'), {
          teamId: TEAM_ID,
          appName,
          teamName,
          primaryColor,
          secondaryColor,
          logo,
          inviteCode,
          memberShareCode,
          requireApproval,
          lockSkills,
          themeVersion: 'royal_v2',
          creatorUid,
          organizerUids: cleanOrgUids,
          lineupPermission: lineupPublishMode,
          defaultCurrency,
          defaultPitchCost,
          updatedAt: serverTimestamp(),
        });
        batch.set(doc(db, 'publicMeta', 'branding'), {
          appName,
          teamName,
          primaryColor,
          secondaryColor,
          logo,
          updatedAt: serverTimestamp(),
        });
        batch.set(
          doc(db, 'inviteCodes', inviteCode),
          {
            code: inviteCode,
            active: true,
            requireApproval,
            isMemberShareCode: false,
            teamId: TEAM_ID,
            teamName,
            appName,
            primaryColor,
            usageType: mainInvRec.usageType,
            maxUses: mainInvRec.maxUses,
            usedCount: 0,
            durationDays: mainInvRec.durationDays,
            createdAtMs: mainInvRec.createdAtMs,
            expiresAtMs: mainInvRec.expiresAtMs,
            status: 'active',
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
        batch.set(
          doc(db, 'inviteCodes', memberShareCode),
          {
            code: memberShareCode,
            active: true,
            requireApproval: true,
            isMemberShareCode: true,
            teamId: TEAM_ID,
            teamName,
            appName,
            primaryColor,
            usageType: shareInvRec.usageType,
            maxUses: shareInvRec.maxUses,
            usedCount: 0,
            durationDays: shareInvRec.durationDays,
            createdAtMs: shareInvRec.createdAtMs,
            expiresAtMs: shareInvRec.expiresAtMs,
            status: 'active',
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
        try {
          await batch.commit();
        } catch (err) {
          this.handleWriteError(err, OperationType.WRITE, 'settings/team');
        }
        return;
      }

      case 'createSmartInvite':
      case 'rotateInviteCode': {
        if (!this.activeIsCaptain) {
          throw new Error('إنشاء وتدوير دعوات الفريق متاح لمؤسس الفريق فقط');
        }
        const currSettings = (this.activeState?.settings || {}) as Record<string, unknown>;
        const isMemberShareCode = payload.isMemberShareCode === true;
        const teamJoinMode = sanitizeJoinMode(
          currSettings.joinMode ?? (currSettings.requireApproval === false ? 'instant' : 'approval')
        );
        const requireApproval = isMemberShareCode
          ? true
          : typeof payload.requireApproval === 'boolean'
            ? payload.requireApproval
            : teamJoinMode === 'approval';
        const joinMode = requireApproval ? 'approval' : 'instant';
        const teamName = clampStr(payload.teamName || currSettings.teamName || 'فريق السداسي', 80) || 'فريق السداسي';
        const appName = clampStr(payload.appName || currSettings.appName || 'ميدان 6v6', 60) || 'ميدان 6v6';
        const primaryColor = sanitizeHexColor(payload.primaryColor || currSettings.primaryColor, ROYAL_PRIMARY);

        const smartRec = createSmartInvitationRecord(
          {
            teamId: tid,
            teamName,
            appName,
            primaryColor,
            joinMode,
            requireApproval,
            isMemberShareCode,
            usageType: typeof payload.usageType === 'string' ? payload.usageType : undefined,
            maxUses:
              typeof payload.maxUses === 'number' || typeof payload.maxUses === 'string'
                ? payload.maxUses
                : undefined,
            durationDays:
              typeof payload.durationDays === 'number' || typeof payload.durationDays === 'string'
                ? payload.durationDays
                : undefined,
          },
          { isFirebaseMode: true, isCaptainSession: this.activeIsCaptain }
        );

        const newCode = smartRec.code;
        const prevCode =
          payload.revokePrevious && payload.prevInviteCode
            ? sanitizeInviteCode(payload.prevInviteCode)
            : '';

        const batch = writeBatch(db);
        const teamMetaRef = isMulti ? doc(db, 'teams', tid) : doc(db, 'settings', 'team');
        if (isMemberShareCode) {
          batch.update(teamMetaRef, {
            memberShareCode: newCode,
            updatedAt: serverTimestamp(),
          });
        } else {
          batch.update(teamMetaRef, {
            inviteCode: newCode,
            updatedAt: serverTimestamp(),
          });
        }
        batch.set(doc(db, 'inviteCodes', newCode), {
          code: newCode,
          active: true,
          joinMode,
          requireApproval: smartRec.requireApproval,
          isMemberShareCode: Boolean(smartRec.isMemberShareCode),
          teamId: tid,
          teamName: smartRec.teamName,
          appName: smartRec.appName,
          primaryColor: smartRec.primaryColor,
          usageType: smartRec.usageType,
          maxUses: smartRec.maxUses,
          usedCount: 0,
          durationDays: smartRec.durationDays,
          createdAtMs: smartRec.createdAtMs,
          expiresAtMs: smartRec.expiresAtMs,
          status: 'active',
          updatedAt: serverTimestamp(),
        });
        const adminLogRef = isMulti
          ? doc(db, 'teams', tid, 'inviteAdminLogs', newCode)
          : doc(db, 'inviteAdminLogs', newCode);
        batch.set(adminLogRef, {
          code: newCode,
          createdBy: uid,
          createdAtMs: smartRec.createdAtMs,
          updatedAt: serverTimestamp(),
        });
        if (prevCode && prevCode !== newCode) {
          batch.update(doc(db, 'inviteCodes', prevCode), {
            active: false,
            status: 'revoked',
            updatedAt: serverTimestamp(),
          });
        }
        try {
          await batch.commit();
          if (isMulti && this.activeState) {
            this.activeState.inviteCodes = [
              { ...smartRec, code: newCode },
              ...(this.activeState.inviteCodes || []).filter((x) => x.code !== prevCode),
            ];
            if (this.activeOnUpdate) this.activeOnUpdate();
          }
        } catch (err) {
          this.handleWriteError(err, OperationType.WRITE, `inviteCodes/${newCode}`);
        }
        return { inviteCode: newCode, invite: smartRec, record: smartRec };
      }

      case 'revokeSmartInvite': {
        if (!this.activeIsCaptain) {
          throw new Error('إلغاء دعوات الفريق متاح لمؤسس الفريق فقط');
        }
        const targetCode = sanitizeInviteCode(payload.code || payload.inviteCode);
        if (!targetCode) throw new Error('كود الدعوة غير صالح');
        const batch = writeBatch(db);
        batch.update(doc(db, 'inviteCodes', targetCode), {
          active: false,
          status: 'revoked',
          updatedAt: serverTimestamp(),
        });
        const adminLogRef = isMulti
          ? doc(db, 'teams', tid, 'inviteAdminLogs', targetCode)
          : doc(db, 'inviteAdminLogs', targetCode);
        batch.set(
          adminLogRef,
          {
            code: targetCode,
            revokedBy: uid,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
        try {
          await batch.commit();
        } catch (err) {
          this.handleWriteError(err, OperationType.UPDATE, `inviteCodes/${targetCode}`);
        }
        return { revokedCode: targetCode };
      }

      case 'updateRole': {
        if (!this.activeIsCaptain) {
          throw new Error('تغيير صلاحيات اللاعبين متاح لمؤسس الفريق فقط');
        }
        const targetId = String(payload.id || '');
        const ownerUid = String(payload.ownerUid || '');
        const newRole = payload.role === 'admin' || payload.role === 'organizer' ? payload.role : 'player';
        if (!targetId) return;

        if (isMulti) {
          const isOrg = newRole === 'admin' || newRole === 'organizer';
          const batch = writeBatch(db);
          batch.update(doc(db, 'teams', tid, 'members', targetId), {
            role: isOrg ? 'organizer' : 'member',
            isOrganizer: isOrg,
            updatedAtMs: Date.now(),
            updatedAt: serverTimestamp(),
          });
          batch.update(doc(db, 'teams', tid), {
            organizerUids: isOrg ? arrayUnion(targetId) : arrayRemove(targetId),
            updatedAt: serverTimestamp(),
          });
          try {
            await batch.commit();
            await this.refreshMultiMembers();
          } catch (err) {
            this.handleWriteError(err, OperationType.WRITE, `teams/${tid}/members/${targetId}`);
          }
          return;
        }

        const batch = writeBatch(db);
        batch.update(doc(db, 'players', targetId), {
          role: newRole === 'admin' ? 'admin' : 'player',
          updatedAt: serverTimestamp(),
        });
        if (ownerUid && ownerUid !== uid) {
          if (newRole === 'admin') {
            batch.set(doc(db, 'admins', ownerUid), {
              uid: ownerUid,
              promotedBy: uid,
              createdAt: serverTimestamp(),
            });
          } else {
            batch.delete(doc(db, 'admins', ownerUid));
          }
        }
        try {
          await batch.commit();
        } catch (err) {
          this.handleWriteError(err, OperationType.WRITE, `players/${targetId}`);
        }
        return;
      }

      case 'pitchSession': {
        if (!this.isTeamOrganizer(uid)) {
          throw new Error('تعديل موعد المباراة والقَطّة متاح لمؤسس الفريق والمنظّمين فقط');
        }
        const sessionDoc = {
          teamId: tid,
          title: clampStr(payload.title || 'مباراة السداسي الأسبوعية', 80) || 'مباراة السداسي الأسبوعية',
          matchDate: sanitizeDateStr(payload.matchDate),
          matchTime: sanitizeTimeStr(payload.matchTime, '20:30'),
          venue: clampStr(payload.venue || 'ملعب السداسي', 80) || 'ملعب السداسي',
          totalCost: Math.round(clampNum(payload.totalCost, 0, 100000, 0) * 10) / 10,
          currency: clampStr(payload.currency || 'ريال', 20) || 'ريال',
          confirmedCount: Math.round(clampNum(payload.confirmedCount, 0, 100, 0)),
          paidCount: Math.round(clampNum(payload.paidCount, 0, 100, 0)),
          paidTotal: Math.round(clampNum(payload.paidTotal, 0, 100000, 0) * 10) / 10,
          updatedAt: serverTimestamp(),
        };
        const psRef = isMulti
          ? doc(db, 'teams', tid, 'pitchSessions', 'current')
          : doc(db, 'pitchSessions', 'current');
        try {
          await setDoc(psRef, sessionDoc);
        } catch (err) {
          this.handleWriteError(err, OperationType.WRITE, isMulti ? `teams/${tid}/pitchSessions/current` : 'pitchSessions/current');
        }
        return;
      }

      case 'pitchPayment': {
        if (!this.isTeamOrganizer(uid)) {
          throw new Error('تحديث حالة دفع القَطّة متاح لمؤسس الفريق والمنظّمين فقط');
        }
        const pay = (payload.payment || {}) as Record<string, unknown>;
        const sess = (payload.session || {}) as Record<string, unknown>;
        const playerId = String(pay.playerId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 128);
        if (!playerId) throw new Error('معرّف اللاعب غير صالح');
        const paymentId = `current__${playerId}`;

        const batch = writeBatch(db);
        const payRef = isMulti
          ? doc(db, 'teams', tid, 'pitchPayments', paymentId)
          : doc(db, 'pitchPayments', paymentId);
        const sessRef = isMulti
          ? doc(db, 'teams', tid, 'pitchSessions', 'current')
          : doc(db, 'pitchSessions', 'current');

        batch.set(payRef, {
          teamId: tid,
          sessionId: 'current',
          playerId,
          ownerUid: String(pay.ownerUid || playerId).slice(0, 128),
          playerName: clampStr(pay.playerName || 'لاعب', 80) || 'لاعب',
          amount: Math.round(clampNum(pay.amount, 0, 10000, 0) * 10) / 10,
          paid: Boolean(pay.paid),
          updatedAt: serverTimestamp(),
        });
        batch.set(sessRef, {
          teamId: tid,
          title: clampStr(sess.title || 'مباراة السداسي الأسبوعية', 80) || 'مباراة السداسي الأسبوعية',
          matchDate: sanitizeDateStr(sess.matchDate),
          matchTime: sanitizeTimeStr(sess.matchTime, '20:30'),
          venue: clampStr(sess.venue || 'ملعب السداسي', 80) || 'ملعب السداسي',
          totalCost: Math.round(clampNum(sess.totalCost, 0, 100000, 0) * 10) / 10,
          currency: clampStr(sess.currency || 'ريال', 20) || 'ريال',
          confirmedCount: Math.round(clampNum(sess.confirmedCount, 0, 100, 0)),
          paidCount: Math.round(clampNum(sess.paidCount, 0, 100, 0)),
          paidTotal: Math.round(clampNum(sess.paidTotal, 0, 100000, 0) * 10) / 10,
          updatedAt: serverTimestamp(),
        });
        try {
          await batch.commit();
        } catch (err) {
          this.handleWriteError(err, OperationType.WRITE, isMulti ? `teams/${tid}/pitchPayments/${paymentId}` : `pitchPayments/${paymentId}`);
        }
        return;
      }

      case 'importBackup': {
        if (!this.activeIsCaptain) {
          throw new Error('استيراد النسخة الاحتياطية متاح للكابتن فقط');
        }
        if (isMulti) {
          throw new Error('استيراد النسخ الكاملة متاح من معالج الترقية أو وضع الفريق الواحد.');
        }
        const clean = sanitizeBackupImport(payload.raw);
        await this.importCleanBackupToFirestore(clean, uid);
        return;
      }

      case 'createMatchSession': {
        const id = String(payload.id || makeId('ms')).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 128);
        const rawParts = Array.isArray(payload.participantIds) ? payload.participantIds : [];
        const participantIds = Array.from(
          new Set([uid, ...rawParts.map((x) => String(x || '').replace(/[^a-zA-Z0-9_-]/g, ''))])
        )
          .filter(Boolean)
          .slice(0, 22);
        const ourScore = Math.round(clampNum(payload.ourScore, 0, 99, 0));
        const oppScore = Math.round(clampNum(payload.oppScore, 0, 99, 0));
        const result = ourScore > oppScore ? 'فوز' : ourScore < oppScore ? 'خسارة' : 'تعادل';
        const msRef = isMulti ? doc(db, 'teams', tid, 'matchSessions', id) : doc(db, 'matchSessions', id);
        const msDoc = {
          id,
          teamId: tid,
          date: sanitizeDateStr(payload.date),
          opponent: clampStr(payload.opponent, 80) || 'خصم',
          pitchMode: sanitizePitchMode(payload.pitchMode),
          ourScore,
          oppScore,
          result,
          createdBy: uid,
          participantIds,
          confirmers: [uid],
          status: 'draft',
          votingOpen: false,
          voterUids: [],
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };
        try {
          await setDoc(msRef, msDoc);
          if (isMulti && this.activeState) {
            this.activeState.matchSessions = [msDoc, ...(this.activeState.matchSessions || [])];
            if (this.activeOnUpdate) this.activeOnUpdate();
          }
        } catch (err) {
          this.handleWriteError(err, OperationType.CREATE, isMulti ? `teams/${tid}/matchSessions/${id}` : `matchSessions/${id}`);
        }
        return;
      }

      case 'confirmMatchSession': {
        const sessionId = String(payload.sessionId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 128);
        if (!sessionId) throw new Error('معرّف المباراة غير صالح');
        const confirmers = Array.isArray(payload.confirmers)
          ? payload.confirmers.map((x) => String(x || ''))
          : [uid];
        const status = payload.status === 'verified' ? 'verified' : 'draft';
        const votingOpen = status === 'verified';
        const msRef = isMulti ? doc(db, 'teams', tid, 'matchSessions', sessionId) : doc(db, 'matchSessions', sessionId);
        try {
          await updateDoc(msRef, {
            confirmers,
            status,
            votingOpen,
            updatedAt: serverTimestamp(),
          });
          if (isMulti && this.activeState) {
            this.activeState.matchSessions = (this.activeState.matchSessions || []).map((s) =>
              s.id === sessionId ? { ...s, confirmers, status, votingOpen } : s
            );
            if (this.activeOnUpdate) this.activeOnUpdate();
          }
        } catch (err) {
          this.handleWriteError(err, OperationType.UPDATE, isMulti ? `teams/${tid}/matchSessions/${sessionId}` : `matchSessions/${sessionId}`);
        }
        return;
      }

      case 'submitSecretMatchVotes': {
        const sessionId = String(payload.sessionId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 128);
        const eligibleCount = Math.round(clampNum(payload.eligibleCount, 2, 22, 6));
        const rawBallots = Array.isArray(payload.ballots)
          ? (payload.ballots as Array<{ targetId?: unknown; score?: unknown }>)
          : [];
        const validBallots: Array<{ targetId: string; score: number }> = [];
        const seenTargets = new Set<string>();
        for (const b of rawBallots) {
          const targetId = String(b.targetId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 128);
          if (!targetId || targetId === uid || seenTargets.has(targetId)) continue;
          seenTargets.add(targetId);
          validBallots.push({ targetId, score: Math.round(clampNum(b.score, 1, 10, 7)) });
        }
        if (!sessionId || !validBallots.length) return;

        const CHUNK_SIZE = 4;
        try {
          for (let i = 0; i < validBallots.length; i += CHUNK_SIZE) {
            const chunk = validBallots.slice(i, i + CHUNK_SIZE);
            const isLastChunk = i + CHUNK_SIZE >= validBallots.length;
            const batch = writeBatch(db);
            for (const { targetId, score } of chunk) {
              const ballotId = `${sessionId}__${targetId}__${uid}`;
              const tallyId = `${sessionId}__${targetId}`;
              const bRef = isMulti ? doc(db, 'teams', tid, 'matchVoteBallots', ballotId) : doc(db, 'matchVoteBallots', ballotId);
              const tRef = isMulti ? doc(db, 'teams', tid, 'matchVoteTallies', tallyId) : doc(db, 'matchVoteTallies', tallyId);

              batch.set(bRef, {
                sessionId,
                targetId,
                voterUid: uid,
                score,
                createdAt: serverTimestamp(),
              });
              batch.set(
                tRef,
                {
                  teamId: tid,
                  sessionId,
                  targetId,
                  eligibleCount,
                  count: increment(1),
                  totalScore: increment(score),
                  h1: increment(score === 1 ? 1 : 0),
                  h2: increment(score === 2 ? 1 : 0),
                  h3: increment(score === 3 ? 1 : 0),
                  h4: increment(score === 4 ? 1 : 0),
                  h5: increment(score === 5 ? 1 : 0),
                  h6: increment(score === 6 ? 1 : 0),
                  h7: increment(score === 7 ? 1 : 0),
                  h8: increment(score === 8 ? 1 : 0),
                  h9: increment(score === 9 ? 1 : 0),
                  h10: increment(score === 10 ? 1 : 0),
                  updatedAt: serverTimestamp(),
                },
                { merge: true }
              );
            }
            if (isLastChunk) {
              const msRef = isMulti ? doc(db, 'teams', tid, 'matchSessions', sessionId) : doc(db, 'matchSessions', sessionId);
              batch.update(msRef, {
                voterUids: arrayUnion(uid),
                updatedAt: serverTimestamp(),
              });
            }
            await batch.commit();
          }
          if (isMulti && this.activeState) {
            await this.refreshMatchVoteTallies(this.activeState);
          }
        } catch (err) {
          this.handleWriteError(err, OperationType.WRITE, isMulti ? `teams/${tid}/matchVoteBallots/${sessionId}` : `matchVoteBallots/${sessionId}`);
        }
        return;
      }

      case 'createMissionClaim': {
        const id = String(payload.id || makeId('mc')).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 128);
        const verifierUids = Array.isArray(payload.verifierUids)
          ? payload.verifierUids.map((x) => String(x || '').replace(/[^a-zA-Z0-9_-]/g, '')).slice(0, 2)
          : [];
        if (verifierUids.length !== 2 || verifierUids[0] === verifierUids[1] || verifierUids.includes(uid)) {
          throw new Error('يجب اختيار زميلين مختلفين غيرك للتحقق من المهمة');
        }
        const mcRef = isMulti ? doc(db, 'teams', tid, 'missionClaims', id) : doc(db, 'missionClaims', id);
        const mcDoc = {
          id,
          teamId: tid,
          missionId: String(payload.missionId || 'clean_sheet'),
          missionTitle: clampStr(payload.missionTitle, 80) || 'مهمة الفريق',
          xpReward: Math.round(clampNum(payload.xpReward, 10, 100, 30)),
          claimantUid: uid,
          claimantName: clampStr(payload.claimantName || currentUser.name, 80) || 'لاعب',
          note: clampStr(payload.note, 200),
          verifierUids,
          approverUids: [],
          rejectorUids: [],
          status: 'pending',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };
        try {
          await setDoc(mcRef, mcDoc);
          if (isMulti && this.activeState) {
            this.activeState.missionClaims = [mcDoc, ...(this.activeState.missionClaims || [])];
            if (this.activeOnUpdate) this.activeOnUpdate();
          }
        } catch (err) {
          this.handleWriteError(err, OperationType.CREATE, isMulti ? `teams/${tid}/missionClaims/${id}` : `missionClaims/${id}`);
        }
        return;
      }

      case 'verifyMissionClaim': {
        const claimId = String(payload.claimId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 128);
        if (!claimId) throw new Error('معرّف المهمة غير صالح');
        const approverUids = Array.isArray(payload.approverUids)
          ? payload.approverUids.map((x) => String(x || ''))
          : [];
        const rejectorUids = Array.isArray(payload.rejectorUids)
          ? payload.rejectorUids.map((x) => String(x || ''))
          : [];
        const status =
          payload.status === 'verified' || payload.status === 'rejected' ? payload.status : 'pending';
        const mcRef = isMulti ? doc(db, 'teams', tid, 'missionClaims', claimId) : doc(db, 'missionClaims', claimId);
        try {
          await updateDoc(mcRef, {
            approverUids,
            rejectorUids,
            status,
            updatedAt: serverTimestamp(),
          });
          if (isMulti && this.activeState) {
            this.activeState.missionClaims = (this.activeState.missionClaims || []).map((c) =>
              c.id === claimId ? { ...c, approverUids, rejectorUids, status } : c
            );
            if (this.activeOnUpdate) this.activeOnUpdate();
          }
        } catch (err) {
          this.handleWriteError(err, OperationType.UPDATE, isMulti ? `teams/${tid}/missionClaims/${claimId}` : `missionClaims/${claimId}`);
        }
        return;
      }

      case 'saveLibraryArticle': {
        if (!this.activeIsCaptain) {
          throw new Error('إدارة المكتبة الكروية العالمية متاحة للكابتن فقط');
        }
        const artId = String(payload.id || makeId('lib')).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
        if (!artId) throw new Error('معرّف المقال غير صالح');
        const rawUrl = String(payload.sourceUrl || '').trim();
        if (!/^https:\/\/[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]+$/.test(rawUrl) || rawUrl.length > 300) {
          throw new Error('رابط المصدر يجب أن يبدأ بـ https:// ويكون صالحاً');
        }
        const allowedCategories = new Set([
          'التكتيكات والخطط',
          'أساسيات المراكز والأدوار',
          'مهارات المراوغة والتحكم',
          'التمرير وصناعة اللعب',
          'التسديد والإنهاء',
          'التحركات بدون كرة',
          'الضغط الجماعي',
          'التدريب الفردي',
          'اللياقة والتحمل',
          'الإحماء والتعافي',
          'تطوير الحراس',
          'القواعد الكروية',
          'الوقاية من الإصابات والإسعافات',
        ]);
        const category = allowedCategories.has(String(payload.category || ''))
          ? String(payload.category)
          : 'التكتيكات والخطط';
        const level =
          payload.level === 'مبتدئ' || payload.level === 'متقدم' ? String(payload.level) : 'متوسط';
        const keyTakeawaysAr = Array.isArray(payload.keyTakeawaysAr)
          ? payload.keyTakeawaysAr
              .map((t) => clampStr(t, 200))
              .filter(Boolean)
              .slice(0, 6)
          : [];
        const terms = Array.isArray(payload.terms)
          ? payload.terms
              .slice(0, 8)
              .map((t) => {
                const obj = (t && typeof t === 'object' ? t : {}) as Record<string, unknown>;
                return {
                  en: clampStr(obj.en, 50),
                  ar: clampStr(obj.ar, 60),
                };
              })
              .filter((t) => t.en.length > 0 && t.ar.length > 0)
          : [];
        const docRef = isMulti ? doc(db, 'teams', tid, 'footballLibrary', artId) : doc(db, 'footballLibrary', artId);
        try {
          const existingSnap = await getDoc(docRef);
          const createdAtVal = existingSnap.exists()
            ? existingSnap.data().createdAt || serverTimestamp()
            : serverTimestamp();
          await setDoc(docRef, {
            id: artId,
            teamId: tid,
            titleAr: clampStr(payload.titleAr, 140) || 'ملخص كروي تعليمي',
            originalLang: clampStr(payload.originalLang, 40) || 'الإنجليزية',
            publisher: clampStr(payload.publisher, 100) || 'مصدر كروي دولي',
            sourceUrl: rawUrl,
            publishedAt: sanitizeDateStr(payload.publishedAt),
            lastReviewed: sanitizeDateStr(payload.lastReviewed),
            category,
            level,
            summaryAr: clampStr(payload.summaryAr, 1200) || 'ملخص تعليمي',
            keyTakeawaysAr: keyTakeawaysAr.length ? keyTakeawaysAr : ['تطبيق عملي داخل الملعب.'],
            terms: terms.length ? terms : [{ en: 'Tactics', ar: 'التكتيك' }],
            originalExcerpt: clampStr(payload.originalExcerpt, 350),
            published: payload.published !== false,
            isCustom: Boolean(payload.isCustom),
            updatedBy: uid,
            createdAt: createdAtVal,
            updatedAt: serverTimestamp(),
          });
          await this.refreshFootballLibrary();
        } catch (err) {
          this.handleWriteError(err, OperationType.WRITE, isMulti ? `teams/${tid}/footballLibrary/${artId}` : `footballLibrary/${artId}`);
        }
        return;
      }

      case 'deleteLibraryArticle': {
        if (!this.activeIsCaptain) {
          throw new Error('حذف المقالات متاح للكابتن فقط');
        }
        const artId = String(payload.id || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
        if (!artId) throw new Error('معرّف المقال غير صالح');
        const docRef = isMulti ? doc(db, 'teams', tid, 'footballLibrary', artId) : doc(db, 'footballLibrary', artId);
        try {
          await deleteDoc(docRef);
          await this.refreshFootballLibrary();
        } catch (err) {
          this.handleWriteError(err, OperationType.DELETE, isMulti ? `teams/${tid}/footballLibrary/${artId}` : `footballLibrary/${artId}`);
        }
        return;
      }

      case 'wipeReset': {
        if (!this.activeIsCaptain) {
          throw new Error('مسح البيانات متاح للكابتن فقط');
        }
        if (isMulti) {
          await this.softDeleteMultiTeam(tid);
        } else {
          await this.wipeTeamCollections(uid);
        }
        return;
      }

      default:
        console.warn('Unknown backend action:', action);
    }
  }

  // ==================== PHASE 6: MULTI-TEAM & MIGRATION ENGINE ====================

  async acceptPrivacyNotice(fbUser?: User | null): Promise<void> {
    const u = fbUser || auth.currentUser;
    const uid = u?.uid || this.activeUid;
    if (!uid) return;
    markPrivacyNoticeAcceptedLocally(uid);
    const payload = buildPrivacyNoticeAcceptedPayload(uid);
    try {
      await setDoc(
        doc(db, 'users', uid),
        {
          uid,
          displayName: clampStr(u?.displayName || 'لاعب', 80) || 'لاعب',
          privacyAcceptedAt: payload.privacyAcceptedAt,
          privacyNoticeVersion: payload.privacyNoticeVersion,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      this.userDoc = { ...(this.userDoc || { uid }), ...payload };
    } catch (err) {
      if (isQuotaExceededError(err)) quotaMonitor.markQuotaExceeded(true);
      console.warn('acceptPrivacyNotice remote sync notice:', err instanceof Error ? err.message : String(err));
    }
  }

  async setAllowNewTeams(allow: boolean): Promise<void> {
    if (!this.isPlatformOwner) {
      throw new Error('هذا الإعداد متاح لمالك المنصة فقط');
    }
    try {
      await setDoc(
        doc(db, 'platform', 'config'),
        {
          allowNewTeams: Boolean(allow),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      this.platformConfig = { allowNewTeams: Boolean(allow) };
    } catch (err) {
      this.handleWriteError(err, OperationType.WRITE, 'platform/config');
    }
  }

  async createMultiTeam(input: {
    teamName: string;
    primaryColor?: string;
    secondaryColor?: string;
    logo?: string;
    joinMode?: 'approval' | 'instant';
    lineupPublishMode?: 'organizers' | 'all';
    defaultCurrency?: string;
    defaultPitchCost?: number;
    playerName?: string;
    jersey?: number;
    primaryPos?: string;
  }): Promise<{ teamId: string; team: MultiTeamMeta }> {
    const fbUser = auth.currentUser;
    if (!fbUser || !fbUser.emailVerified) {
      throw new Error('يرجى تسجيل الدخول بحساب Google أولاً لإنشاء فريق');
    }
    const uid = fbUser.uid;
    const cfg = await this.fetchPlatformConfig();
    const uSnap = await getDoc(doc(db, 'users', uid));
    quotaMonitor.recordReads('oneShot', 1);
    const uData = uSnap.exists() ? uSnap.data() : {};
    const ownedIds = Array.isArray(uData.ownedTeamIds) ? (uData.ownedTeamIds as string[]) : [];
    const joinedIds = Array.isArray(uData.teamIds) ? (uData.teamIds as string[]) : [];

    const elig = checkTeamQuotaEligibility({
      action: 'create',
      ownedTeamIds: ownedIds,
      joinedTeamIds: joinedIds,
      allowNewTeams: cfg.allowNewTeams,
    });
    if (!elig.allowed) {
      throw new Error(elig.errorAr || 'لا يمكن إنشاء فريق جديد حالياً');
    }

    const teamId = generateMultiTeamId();
    const joinMode = sanitizeJoinMode(input.joinMode);
    const requireApproval = joinMode === 'approval';
    const lineupPublishMode = sanitizeLineupPublishMode(input.lineupPublishMode);
    const teamName = clampStr(input.teamName || 'فريق السداسي', 40) || 'فريق السداسي';
    const primaryColor = sanitizeHexColor(input.primaryColor, ROYAL_PRIMARY);
    const secondaryColor = sanitizeHexColor(input.secondaryColor, ROYAL_SECONDARY);
    const logoCheck = sanitizeTeamLogo50Kb(input.logo || '');
    if (!logoCheck.ok) {
      throw new Error(logoCheck.errorAr || 'حجم الشعار يتجاوز 50 كيلوبايت');
    }

    const authCtx = { isFirebaseMode: true, isCaptainSession: true };
    const mainInvite = createSmartInvitationRecord(
      {
        teamId,
        teamName,
        appName: 'ميدان 6v6',
        primaryColor,
        joinMode,
        requireApproval,
        isMemberShareCode: false,
        usageType: 'multi',
        maxUses: 25,
        durationDays: 14,
      },
      authCtx
    );
    const memberShareInvite = createSmartInvitationRecord(
      {
        teamId,
        teamName,
        appName: 'ميدان 6v6',
        primaryColor,
        joinMode: 'approval',
        requireApproval: true,
        isMemberShareCode: true,
        usageType: 'multi',
        maxUses: 100,
        durationDays: 90,
      },
      authCtx
    );

    const payload = buildDefaultTeamCreatePayload({
      teamId,
      teamName,
      founderUid: uid,
      defaultCurrency: input.defaultCurrency,
      defaultPitchCost: input.defaultPitchCost,
      primaryColor,
      secondaryColor,
      logo: logoCheck.dataUrl,
      joinMode,
      lineupPublishMode,
      inviteCode: mainInvite.code,
      memberShareCode: memberShareInvite.code,
    });

    const { name: creatorDisplayName } = resolveEffectivePlayerName({
      savedName: input.playerName || '',
      googleDisplayName: fbUser.displayName,
      email: fbUser.email,
      fallback: 'مؤسس الفريق',
    });

    const batch = writeBatch(db);
    batch.set(doc(db, 'teams', teamId), {
      ...payload,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(db, 'teams', teamId, 'members', uid), {
      id: uid,
      uid,
      ownerUid: uid,
      teamId,
      name: creatorDisplayName,
      role: 'founder',
      isOrganizer: true,
      jersey: Math.round(clampNum(input.jersey, 1, 99, 10)),
      age: 20,
      height: 176,
      weight: 70,
      foot: 'يمين',
      primaryPos: sanitizePrimaryPos(input.primaryPos || 'لاعب وسط'),
      secondaryPos: 'جناح',
      photo: '',
      hasPhoto: false,
      photoZoom: 105,
      photoY: 18,
      skills: sanitizeSkills({
        speed: 7,
        shooting: 7,
        passing: 8,
        dribbling: 7,
        defending: 6,
        stamina: 7,
        vision: 8,
        teamwork: 7,
        control: 7,
        positioning: 6,
      }),
      top3Strengths: '',
      weak3Points: '',
      seasonGoal: '',
      availableStatus: 'متاح',
      roleModelStarId: '',
      joinedAtMs: Date.now(),
      updatedAtMs: Date.now(),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(db, 'teams', teamId, 'tactics', 'current'), {
      teamId,
      formation: '2-2-1',
      slots: {},
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(db, 'inviteCodes', mainInvite.code), {
      code: mainInvite.code,
      active: true,
      joinMode,
      requireApproval,
      isMemberShareCode: false,
      teamId,
      teamName,
      appName: 'ميدان 6v6',
      primaryColor,
      usageType: mainInvite.usageType,
      maxUses: mainInvite.maxUses,
      usedCount: 0,
      durationDays: mainInvite.durationDays,
      createdAtMs: mainInvite.createdAtMs,
      expiresAtMs: mainInvite.expiresAtMs,
      status: 'active',
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(db, 'teams', teamId, 'inviteAdminLogs', mainInvite.code), {
      code: mainInvite.code,
      createdBy: uid,
      createdAtMs: mainInvite.createdAtMs,
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(db, 'inviteCodes', memberShareInvite.code), {
      code: memberShareInvite.code,
      active: true,
      joinMode: 'approval',
      requireApproval: true,
      isMemberShareCode: true,
      teamId,
      teamName,
      appName: 'ميدان 6v6',
      primaryColor,
      usageType: memberShareInvite.usageType,
      maxUses: memberShareInvite.maxUses,
      usedCount: 0,
      durationDays: memberShareInvite.durationDays,
      createdAtMs: memberShareInvite.createdAtMs,
      expiresAtMs: memberShareInvite.expiresAtMs,
      status: 'active',
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(db, 'teams', teamId, 'inviteAdminLogs', memberShareInvite.code), {
      code: memberShareInvite.code,
      createdBy: uid,
      createdAtMs: memberShareInvite.createdAtMs,
      updatedAt: serverTimestamp(),
    });
    batch.set(
      doc(db, 'users', uid),
      {
        uid,
        displayName: creatorDisplayName,
        teamIds: arrayUnion(teamId),
        ownedTeamIds: arrayUnion(teamId),
        activeTeamId: teamId,
        privacyAcceptedAt: Number(uData.privacyAcceptedAt || Date.now()),
        privacyNoticeVersion: String(uData.privacyNoticeVersion || PRIVACY_NOTICE_VERSION),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    try {
      await batch.commit();
      markPrivacyNoticeAcceptedLocally(uid);
      this.activeStorageMode = 'multi';
      this.activeTeamId = teamId;
      this.activeIsCaptain = true;
      this.activeTeams = sortActiveTeamsList([...this.activeTeams, payload], teamId);
      return { teamId, team: payload };
    } catch (err) {
      this.handleWriteError(err, OperationType.WRITE, `teams/${teamId}`);
    }
  }

  async switchActiveTeam(teamId: string): Promise<{ teamId: string; isCaptain: boolean }> {
    const uid = this.activeUid || auth.currentUser?.uid;
    const cleanId = sanitizeTeamId(teamId);
    if (!uid || !cleanId) throw new Error('معرّف الفريق غير صالح');
    const target = this.activeTeams.find((t) => t.id === cleanId && !t.deletedAt);
    if (!target) {
      throw new Error('لست عضواً في هذا الفريق أو تم حذفه');
    }
    this.stopListeners();
    try {
      await setDoc(
        doc(db, 'users', uid),
        {
          uid,
          activeTeamId: cleanId,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      if (this.userDoc) this.userDoc.activeTeamId = cleanId;
      this.activeStorageMode = 'multi';
      this.activeTeamId = cleanId;
      this.activeIsCaptain = target.founderUid === uid;
      return { teamId: cleanId, isCaptain: this.activeIsCaptain };
    } catch (err) {
      this.handleWriteError(err, OperationType.UPDATE, `users/${uid}`);
    }
  }

  async transferTeamFounder(newFounderUid: string): Promise<void> {
    const uid = this.activeUid || auth.currentUser?.uid;
    if (!uid || !this.isMultiMode() || !this.activeIsCaptain) {
      throw new Error('نقل قيادة الفريق متاح للمؤسس الحالي فقط');
    }
    const targetUid = String(newFounderUid || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 128);
    if (!targetUid || targetUid === uid) {
      throw new Error('اختر عضواً آخر من الفريق لنقل القيادة إليه');
    }
    const tid = this.activeTeamId;
    const targetSnap = await getDoc(doc(db, 'teams', tid, 'members', targetUid));
    if (!targetSnap.exists()) {
      throw new Error('العضو المختار غير موجود في الفريق');
    }

    const batch = writeBatch(db);
    batch.update(doc(db, 'teams', tid), {
      founderUid: targetUid,
      organizerUids: arrayUnion(uid),
      updatedAtMs: Date.now(),
      updatedAt: serverTimestamp(),
    });
    batch.update(doc(db, 'teams', tid, 'members', targetUid), {
      role: 'founder',
      isOrganizer: true,
      updatedAtMs: Date.now(),
      updatedAt: serverTimestamp(),
    });
    batch.update(doc(db, 'teams', tid, 'members', uid), {
      role: 'organizer',
      isOrganizer: true,
      updatedAtMs: Date.now(),
      updatedAt: serverTimestamp(),
    });
    batch.set(
      doc(db, 'users', uid),
      {
        uid,
        ownedTeamIds: arrayRemove(tid),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
    try {
      await batch.commit();
      this.activeIsCaptain = false;
      this.activeTeams = this.activeTeams.map((t) =>
        t.id === tid ? { ...t, founderUid: targetUid } : t
      );
      await this.refreshMultiMembers();
    } catch (err) {
      this.handleWriteError(err, OperationType.WRITE, `teams/${tid}`);
    }
  }

  async softDeleteMultiTeam(teamId?: string): Promise<void> {
    const uid = this.activeUid || auth.currentUser?.uid;
    const tid = sanitizeTeamId(teamId || this.activeTeamId);
    if (!uid || !tid || tid === TEAM_ID) {
      throw new Error('معرّف الفريق غير صالح للحذف');
    }
    const remainingIds = this.activeTeams.map((t) => t.id).filter((id) => id !== tid);
    const batch = writeBatch(db);
    batch.update(doc(db, 'teams', tid), {
      deletedAt: serverTimestamp(),
      updatedAtMs: Date.now(),
      updatedAt: serverTimestamp(),
    });
    batch.set(
      doc(db, 'users', uid),
      {
        uid,
        teamIds: arrayRemove(tid),
        ownedTeamIds: arrayRemove(tid),
        activeTeamId: remainingIds[0] || '',
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
    try {
      await batch.commit();
      this.activeTeams = this.activeTeams.filter((t) => t.id !== tid);
    } catch (err) {
      this.handleWriteError(err, OperationType.UPDATE, `teams/${tid}`);
    }
  }

  async deleteMyPrivateTeamData(teamId?: string): Promise<number> {
    const uid = this.activeUid || auth.currentUser?.uid;
    const tid = sanitizeTeamId(teamId || this.activeTeamId);
    if (!uid || !tid || tid === TEAM_ID) {
      throw new Error('حذف البيانات الخاصة من هذا المسار متاح لفرق المنصة');
    }
    const snap = await getDocs(collection(db, 'teams', tid, 'members', uid, 'private'));
    let deletedCount = 0;
    for (const chunk of chunkItemsForBatch(snap.docs, 400)) {
      const batch = writeBatch(db);
      chunk.forEach((d) => {
        batch.delete(d.ref);
        deletedCount++;
      });
      await batch.commit();
    }
    if (this.activeState) {
      this.activeState.readiness = [];
      this.activeState.injuries = [];
      if (this.activeOnUpdate) this.activeOnUpdate();
    }
    return deletedCount;
  }

  private async deleteDocIfExistsStrict(
    ref: ReturnType<typeof doc>,
    step: string,
    path: string,
    failures: AccountCleanupFailure[]
  ): Promise<boolean> {
    try {
      const snap = await getDoc(ref);
      if (!snap.exists()) return false;
      await deleteDoc(ref);
      return true;
    } catch (err: unknown) {
      const classified = classifyAccountCleanupError(err);
      if (classified.ignorableForOptionalDoc) return false;
      failures.push({
        step,
        path,
        kind: classified.kind,
        code: classified.code,
        message: classified.message,
      });
      return false;
    }
  }

  /**
   * Real Account & Personal Data Deletion (Strict Verification):
   * - Guards founders of active multi-member teams (must transfer leadership or delete team first).
   * - Distinguishes missing optional documents (`not-found`) from real permission/network failures.
   * - NEVER ignores real cleanup failures and NEVER deletes Firebase Auth until all required
   *   Firestore cleanup steps succeed. Returns an accurate partial-failure report with safe retry.
   */
  async deleteMyAccountAndData(): Promise<{
    firestoreCleaned: boolean;
    partialFailure: boolean;
    canRetryCleanup: boolean;
    authDeleted: boolean;
    requiresRecentLogin: boolean;
    teamsLeft: number;
    privateRecordsDeleted: number;
    failedSteps: AccountCleanupFailure[];
    messageAr: string;
  }> {
    const fbUser = auth.currentUser;
    const uid = fbUser?.uid || this.activeUid;
    if (!fbUser || !uid) {
      throw new Error('يرجى تسجيل الدخول أولاً لحذف الحساب.');
    }

    let teamsLeft = 0;
    let privateRecordsDeleted = 0;
    const failedSteps: AccountCleanupFailure[] = [];

    const recordError = (step: string, path: string, err: unknown, ignorableIfMissing = false) => {
      const classified = classifyAccountCleanupError(err);
      if (ignorableIfMissing && classified.ignorableForOptionalDoc) return;
      failedSteps.push({
        step,
        path,
        kind: classified.kind,
        code: classified.code,
        message: classified.message,
      });
    };

    // 1. Discover ALL candidate Multi-Teams from both in-memory cache and fresh /users/{uid}
    //    (covers active, solo-owned, soft-deleted, and pending join-request teams).
    let freshUserDoc: Record<string, unknown> | null = null;
    try {
      const uSnap = await getDoc(doc(db, 'users', uid));
      if (uSnap.exists()) {
        freshUserDoc = uSnap.data() as Record<string, unknown>;
      }
    } catch (err: unknown) {
      const classified = classifyAccountCleanupError(err);
      if (!classified.ignorableForOptionalDoc) {
        recordError('read_user_registry', `users/${uid}`, err, false);
      }
    }

    const candidateTeamIds = collectAccountDeletionTeamCandidates({
      activeTeamIds: this.activeTeams.map((t) => t.id),
      userRegistryDoc: freshUserDoc as {
        teamIds?: unknown;
        ownedTeamIds?: unknown;
        pendingJoinTeamId?: unknown;
        activeTeamId?: unknown;
      } | null,
    });

    const teamPlans: Array<{
      tid: string;
      snapshot: AccountDeletionTeamSnapshot | null;
      action: ReturnType<typeof planTeamAccountCleanup>;
    }> = [];

    for (const tid of candidateTeamIds) {
      let snapshot: AccountDeletionTeamSnapshot | null = null;
      const cachedTeam = this.activeTeams.find((t) => t.id === tid);
      try {
        const tSnap = await getDoc(doc(db, 'teams', tid));
        if (tSnap.exists()) {
          const td = tSnap.data() as Record<string, unknown>;
          snapshot = {
            id: tid,
            teamName: String(td.teamName || cachedTeam?.teamName || tid),
            founderUid: String(td.founderUid || ''),
            memberCount: Number(td.memberCount ?? 1),
            deletedAt: td.deletedAt ?? null,
          };
        }
      } catch (err: unknown) {
        const classified = classifyAccountCleanupError(err);
        if (classified.kind === 'network') {
          recordError('read_team_meta', `teams/${tid}`, err, false);
        } else if (cachedTeam) {
          snapshot = {
            id: tid,
            teamName: cachedTeam.teamName,
            founderUid: cachedTeam.founderUid,
            memberCount: cachedTeam.memberCount,
            deletedAt: cachedTeam.deletedAt,
          };
        }
      }
      teamPlans.push({
        tid,
        snapshot,
        action: planTeamAccountCleanup(snapshot, uid),
      });
    }

    // 2. Guard: if founder of any active multi-member team, require explicit transfer/soft-delete first
    const blockingOwned = teamPlans.filter((p) => p.action === 'block_active_founder_with_members');
    if (blockingOwned.length > 0) {
      const names = blockingOwned.map((p) => p.snapshot?.teamName || p.tid).join('، ');
      throw new Error(
        `أنت مؤسس الفريق (${names}) وبه أعضاء آخرون. يرجى نقل القيادة لعضو آخر أو حذف الفريق من لوحة المؤسس قبل حذف حسابك.`
      );
    }

    const cleanTeamPersonalSubdocs = async (tid: string) => {
      try {
        const privSnap = await getDocs(collection(db, 'teams', tid, 'members', uid, 'private'));
        for (const chunk of chunkItemsForBatch(privSnap.docs, 400)) {
          const b = writeBatch(db);
          chunk.forEach((d) => {
            b.delete(d.ref);
            privateRecordsDeleted++;
          });
          await b.commit();
        }
      } catch (err: unknown) {
        recordError('delete_team_private', `teams/${tid}/members/${uid}/private`, err, true);
      }

      // lineupVotes/{uid} allows direct self-delete even for non-members/pending users
      try {
        await deleteDoc(doc(db, 'teams', tid, 'lineupVotes', uid));
      } catch (err: unknown) {
        recordError('delete_team_lineup_vote', `teams/${tid}/lineupVotes/${uid}`, err, true);
      }

      await this.deleteDocIfExistsStrict(
        doc(db, 'teams', tid, 'joinRequests', uid),
        'delete_team_join_request',
        `teams/${tid}/joinRequests/${uid}`,
        failedSteps
      );
    };

    // 3. Execute rules-safe cleanup across solo-owned, active member, soft-deleted, and pending teams
    for (const plan of teamPlans) {
      const { tid, action } = plan;

      if (action === 'soft_delete_solo_owned') {
        await cleanTeamPersonalSubdocs(tid);
        try {
          await this.softDeleteMultiTeam(tid);
          teamsLeft++;
        } catch (err: unknown) {
          recordError('soft_delete_solo_team', `teams/${tid}`, err, false);
        }
        continue;
      }

      if (action === 'leave_active_member') {
        await cleanTeamPersonalSubdocs(tid);
        try {
          const memberRef = doc(db, 'teams', tid, 'members', uid);
          const memberSnap = await getDoc(memberRef);
          if (memberSnap.exists()) {
            const leaveBatch = writeBatch(db);
            leaveBatch.delete(memberRef);
            leaveBatch.update(doc(db, 'teams', tid), {
              memberCount: increment(-1),
              organizerUids: arrayRemove(uid),
              updatedAt: serverTimestamp(),
            });
            await leaveBatch.commit();
            teamsLeft++;
          }
        } catch (err: unknown) {
          recordError('leave_team_member', `teams/${tid}/members/${uid}`, err, true);
        }
        continue;
      }

      if (action === 'cleanup_soft_deleted_member') {
        await cleanTeamPersonalSubdocs(tid);
        try {
          const memberRef = doc(db, 'teams', tid, 'members', uid);
          const memberSnap = await getDoc(memberRef);
          if (memberSnap.exists()) {
            // Soft-deleted teams lock updates on teams/{tid}; delete own member doc directly.
            await deleteDoc(memberRef);
            teamsLeft++;
          }
        } catch (err: unknown) {
          recordError('delete_soft_deleted_member', `teams/${tid}/members/${uid}`, err, true);
        }
        continue;
      }

      // 'cleanup_soft_deleted_founder' | 'cleanup_orphan_refs'
      await cleanTeamPersonalSubdocs(tid);
    }

    // 4. Clean legacy single-team personal records (including orphaned legacy joinRequests)
    if (!this.isPlatformOwner) {
      let hasLegacyPlayer = false;
      try {
        const legacyPlayerSnap = await getDoc(doc(db, 'players', uid));
        hasLegacyPlayer = legacyPlayerSnap.exists();
      } catch (err: unknown) {
        const classified = classifyAccountCleanupError(err);
        // Non-legacy Multi-Team users are expected to get permission-denied on legacy /players/{uid};
        // only treat network errors as real cleanup failures here.
        if (classified.kind === 'network') {
          recordError('check_legacy_player', `players/${uid}`, err, false);
        }
      }

      if (hasLegacyPlayer) {
        const legacyOwnerCollections = ['readiness', 'injuries'] as const;
        for (const colName of legacyOwnerCollections) {
          try {
            const snap = await getDocs(query(collection(db, colName), where('ownerUid', '==', uid)));
            for (const chunk of chunkItemsForBatch(snap.docs, 400)) {
              const b = writeBatch(db);
              chunk.forEach((d) => {
                b.delete(d.ref);
                privateRecordsDeleted++;
              });
              await b.commit();
            }
          } catch (err: unknown) {
            recordError(`delete_legacy_${colName}`, `${colName}?ownerUid=${uid}`, err, true);
          }
        }
        for (const [colName, docId] of [
          ['playerPhotos', uid],
          ['lineupVotes', uid],
          ['joinRequests', uid],
          ['players', uid],
        ] as const) {
          await this.deleteDocIfExistsStrict(
            doc(db, colName, docId),
            `delete_legacy_${colName}`,
            `${colName}/${docId}`,
            failedSteps
          );
        }
      } else {
        await this.deleteDocIfExistsStrict(
          doc(db, 'joinRequests', uid),
          'delete_legacy_joinRequests',
          `joinRequests/${uid}`,
          failedSteps
        );
      }
    }

    // 5. Delete /users/{uid} registry doc ONLY if earlier team/private steps succeeded
    if (shouldAllowAuthAccountDeletion(failedSteps)) {
      await this.deleteDocIfExistsStrict(
        doc(db, 'users', uid),
        'delete_user_registry',
        `users/${uid}`,
        failedSteps
      );
    }

    // 6. Strict gate: NEVER delete Firebase Auth account if any real Firestore cleanup failed
    if (!shouldAllowAuthAccountDeletion(failedSteps)) {
      const summary = failedSteps
        .slice(0, 3)
        .map((f) => `${f.path} (${f.code})`)
        .join('، ');
      return {
        firestoreCleaned: false,
        partialFailure: true,
        canRetryCleanup: true,
        authDeleted: false,
        requiresRecentLogin: false,
        teamsLeft,
        privateRecordsDeleted,
        failedSteps,
        messageAr: `تعذّر إتمام تنظيف بعض البيانات السحابية (${failedSteps.length} خطوات: ${summary})، لذلك تم إيقاف حذف حساب الدخول حفاظاً على إمكانية استكمال التنظيف. تحقّق من الاتصال وأعد المحاولة بأمان.`,
      };
    }

    // 7. Stop listeners & scrub all local caches only after verified cloud cleanup
    this.clearSessionData();

    // 8. Delete Firebase Authentication account
    try {
      await deleteUser(fbUser);
      return {
        firestoreCleaned: true,
        partialFailure: false,
        canRetryCleanup: false,
        authDeleted: true,
        requiresRecentLogin: false,
        teamsLeft,
        privateRecordsDeleted,
        failedSteps: [],
        messageAr: 'تم التحقق من حذف بياناتك السحابية وسجلاتك الخاصة وحساب الدخول نهائياً ✓',
      };
    } catch (err: unknown) {
      const code =
        err && typeof err === 'object' && 'code' in err
          ? String((err as { code?: unknown }).code || '')
          : '';
      if (code === 'auth/requires-recent-login') {
        await signOut(auth).catch(() => {});
        return {
          firestoreCleaned: true,
          partialFailure: false,
          canRetryCleanup: false,
          authDeleted: false,
          requiresRecentLogin: true,
          teamsLeft,
          privateRecordsDeleted,
          failedSteps: [],
          messageAr:
            'تم حذف بياناتك وسجلاتك الخاصة من قاعدة البيانات بنجاح. لإكمال إزالة حساب الدخول نهائياً، سجّل الدخول مجدداً ثم اضغط «حذف الحساب» مرة أخيرة (متطلب أمني من Google/Firebase).',
        };
      }
      return {
        firestoreCleaned: true,
        partialFailure: true,
        canRetryCleanup: true,
        authDeleted: false,
        requiresRecentLogin: false,
        teamsLeft,
        privateRecordsDeleted,
        failedSteps: [
          {
            step: 'delete_firebase_auth',
            path: `auth/${uid}`,
            kind: classifyAccountCleanupError(err).kind,
            code: code || 'auth-delete-failed',
            message: err instanceof Error ? err.message : String(err),
          },
        ],
        messageAr:
          'تم تنظيف بياناتك من قاعدة البيانات، لكن تعذّر حذف حساب المصادقة حالياً. أعد تسجيل الدخول وحاول مجدداً لإكمال الإزالة.',
      };
    }
  }

  async exportLegacyTeamBackupJson(): Promise<Record<string, unknown>> {
    if (!this.isPlatformOwner) {
      throw new Error('تصدير نسخة الفريق الواحد متاح لمؤسس المنصة فقط');
    }
    const [
      settingsSnap,
      playersSnap,
      matchesSnap,
      reportsSnap,
      attSnap,
      rdSnap,
      injSnap,
      tacticsSnap,
      suggSnap,
      admRatingsSnap,
      psSnap,
      ppSnap,
    ] = await Promise.all([
      getDoc(doc(db, 'settings', 'team')),
      getDocs(query(collection(db, 'players'), where('teamId', '==', TEAM_ID))),
      getDocs(query(collection(db, 'matches'), where('teamId', '==', TEAM_ID))),
      getDocs(query(collection(db, 'reports'), where('teamId', '==', TEAM_ID))),
      getDocs(query(collection(db, 'attendance'), where('teamId', '==', TEAM_ID))),
      getDocs(query(collection(db, 'readiness'), where('teamId', '==', TEAM_ID))),
      getDocs(query(collection(db, 'injuries'), where('teamId', '==', TEAM_ID))),
      getDoc(doc(db, 'tactics', 'current')),
      getDocs(query(collection(db, 'suggestions'), where('teamId', '==', TEAM_ID))),
      getDocs(query(collection(db, 'adminRatings'), where('teamId', '==', TEAM_ID))),
      getDoc(doc(db, 'pitchSessions', 'current')),
      getDocs(query(collection(db, 'pitchPayments'), where('teamId', '==', TEAM_ID))),
    ]);

    return {
      version: 6,
      exportedAt: new Date().toISOString(),
      sourceTeamId: TEAM_ID,
      settings: settingsSnap.exists() ? settingsSnap.data() : {},
      players: playersSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
      matches: matchesSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
      reports: reportsSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
      attendance: attSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
      readiness: rdSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
      injuries: injSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
      tactics: tacticsSnap.exists() ? tacticsSnap.data() : { formation: '2-2-1', slots: {} },
      suggestions: suggSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
      adminRatings: admRatingsSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
      pitchSession: psSnap.exists() ? psSnap.data() : null,
      pitchPayments: ppSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
    };
  }

  async runLegacyToMultiMigration(input: {
    backupConfirmedAtMs: number;
    onProgress?: (msg: string, pct: number) => void;
  }): Promise<{
    targetTeamId: string;
    checkpoint: MigrationCheckpoint;
    logoAdjusted: boolean;
  }> {
    if (!this.isPlatformOwner) {
      throw new Error('معالج الترقية متاح لمالك الفريق الأساسي فقط');
    }
    const uid = this.activeUid || auth.currentUser?.uid;
    if (!uid) throw new Error('يرجى تسجيل الدخول أولاً');
    if (!input.backupConfirmedAtMs) {
      throw new Error('الخطوة 1 مطلوبة: احفظ النسخة الاحتياطية JSON أولاً قبل النسخ.');
    }

    const reportProgress = input.onProgress || (() => {});
    const existingCkpt = loadMigrationCheckpoint();
    const targetTeamId = sanitizeTeamId(existingCkpt?.targetTeamId) || generateMultiTeamId();
    const ckpt: MigrationCheckpoint = existingCkpt && existingCkpt.targetTeamId === targetTeamId
      ? existingCkpt
      : {
          sourceTeamId: TEAM_ID,
          targetTeamId,
          backupConfirmedAtMs: input.backupConfirmedAtMs,
          copiedSections: [],
        };
    saveMigrationCheckpoint(ckpt);

    reportProgress('جاري قراءة بيانات الفريق الحالي...', 10);
    const [
      settingsSnap,
      playersSnap,
      matchesSnap,
      reportsSnap,
      attSnap,
      rdSnap,
      injSnap,
      tacticsSnap,
      suggSnap,
      admRatingsSnap,
      psSnap,
      ppSnap,
    ] = await Promise.all([
      getDoc(doc(db, 'settings', 'team')),
      getDocs(query(collection(db, 'players'), where('teamId', '==', TEAM_ID))),
      getDocs(query(collection(db, 'matches'), where('teamId', '==', TEAM_ID))),
      getDocs(query(collection(db, 'reports'), where('teamId', '==', TEAM_ID))),
      getDocs(query(collection(db, 'attendance'), where('teamId', '==', TEAM_ID))),
      getDocs(query(collection(db, 'readiness'), where('teamId', '==', TEAM_ID))),
      getDocs(query(collection(db, 'injuries'), where('teamId', '==', TEAM_ID))),
      getDoc(doc(db, 'tactics', 'current')),
      getDocs(query(collection(db, 'suggestions'), where('teamId', '==', TEAM_ID))),
      getDocs(query(collection(db, 'adminRatings'), where('teamId', '==', TEAM_ID))),
      getDoc(doc(db, 'pitchSessions', 'current')),
      getDocs(query(collection(db, 'pitchPayments'), where('teamId', '==', TEAM_ID))),
    ]);

    const legSettings = settingsSnap.exists() ? settingsSnap.data() : {};
    const logoCheck = sanitizeTeamLogo50Kb(legSettings.logo || '');
    const logoAdjusted = !logoCheck.ok;
    const safeLogo = logoCheck.ok ? logoCheck.dataUrl : '';
    const founderUid = String(legSettings.creatorUid || uid);
    const organizerUids = Array.isArray(legSettings.organizerUids)
      ? (legSettings.organizerUids as string[]).filter((x) => x !== founderUid)
      : [];
    const joinMode = legSettings.requireApproval === false ? 'instant' : 'approval';
    const lineupPublishMode = legSettings.lineupPermission === 'organizers' ? 'organizers' : 'all';

    // Section 1: team header doc
    if (!ckpt.copiedSections.includes('team')) {
      reportProgress('نسخ إعدادات وهوية الفريق...', 25);
      const teamPayload = buildDefaultTeamCreatePayload({
        teamId: targetTeamId,
        teamName: String(legSettings.teamName || 'فريق السداسي'),
        founderUid,
        defaultCurrency: String(legSettings.defaultCurrency || 'ريال'),
        defaultPitchCost: Number(legSettings.defaultPitchCost || 0),
        primaryColor: String(legSettings.primaryColor || ROYAL_PRIMARY),
        secondaryColor: String(legSettings.secondaryColor || ROYAL_SECONDARY),
        logo: safeLogo,
        joinMode,
        lineupPublishMode,
        inviteCode: String(legSettings.inviteCode || generateSecureInviteCode(12)),
        memberShareCode: String(legSettings.memberShareCode || generateSecureInviteCode(12)),
      });
      teamPayload.organizerUids = organizerUids;
      teamPayload.maxMembersPerTeam = Math.max(DEFAULT_MAX_MEMBERS_PER_TEAM, Math.min(100, playersSnap.size));
      teamPayload.memberCount = Math.max(1, Math.min(teamPayload.maxMembersPerTeam, playersSnap.size));
      await setDoc(doc(db, 'teams', targetTeamId), {
        ...teamPayload,
        migratedFrom: TEAM_ID,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      ckpt.copiedSections.push('team');
      saveMigrationCheckpoint(ckpt);
    }

    // Section 2: Members + Private Split
    if (!ckpt.copiedSections.includes('members')) {
      reportProgress('نسخ الأعضاء وفصل السجلات الخاصة...', 45);
      const rdAll = rdSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const injAll = injSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const writeOps: Array<(b: ReturnType<typeof writeBatch>) => void> = [];
      for (const pDoc of playersSnap.docs) {
        const split = splitPlayerPublicAndPrivate({
          teamId: targetTeamId,
          rawPlayer: { id: pDoc.id, ...pDoc.data() },
          founderUid,
          organizerUids,
          readinessRecords: rdAll,
          injuryRecords: injAll,
        });
        writeOps.push((b) => {
          b.set(doc(db, 'teams', targetTeamId, 'members', split.publicMember.uid), {
            ...split.publicMember,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        });
        for (const priv of split.privateRecords) {
          writeOps.push((b) => {
            b.set(
              doc(db, 'teams', targetTeamId, 'members', split.publicMember.uid, 'private', priv.id),
              {
                ...priv.data,
                createdAt: serverTimestamp(),
              }
            );
          });
        }
      }
      for (const chunk of chunkItemsForBatch(writeOps, MIGRATION_BATCH_WRITE_LIMIT)) {
        const batch = writeBatch(db);
        chunk.forEach((fn) => fn(batch));
        await batch.commit();
      }
      ckpt.copiedSections.push('members');
      saveMigrationCheckpoint(ckpt);
    }

    // Section 3: Attendance consolidated docs + Tactics + Pitch
    if (!ckpt.copiedSections.includes('tactics_attendance')) {
      reportProgress('نسخ الحضور المجمّع والتشكيلة والقَطّة...', 65);
      const consolidatedAtt = groupLegacyAttendanceByMatchKey(
        attSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
      );
      const writeOps: Array<(b: ReturnType<typeof writeBatch>) => void> = [];
      for (const aDoc of consolidatedAtt) {
        writeOps.push((b) => {
          b.set(doc(db, 'teams', targetTeamId, 'attendance', aDoc.matchKey), {
            ...aDoc,
            teamId: targetTeamId,
            updatedAt: serverTimestamp(),
          });
        });
      }
      const tac = tacticsSnap.exists() ? tacticsSnap.data() : { formation: '2-2-1', slots: {} };
      writeOps.push((b) => {
        b.set(doc(db, 'teams', targetTeamId, 'tactics', 'current'), {
          ...tac,
          teamId: targetTeamId,
          updatedAt: serverTimestamp(),
        });
      });
      if (psSnap.exists()) {
        writeOps.push((b) => {
          b.set(doc(db, 'teams', targetTeamId, 'pitchSessions', 'current'), {
            ...psSnap.data(),
            teamId: targetTeamId,
            updatedAt: serverTimestamp(),
          });
        });
      }
      for (const pp of ppSnap.docs) {
        writeOps.push((b) => {
          b.set(doc(db, 'teams', targetTeamId, 'pitchPayments', pp.id), {
            ...pp.data(),
            teamId: targetTeamId,
            updatedAt: serverTimestamp(),
          });
        });
      }
      for (const chunk of chunkItemsForBatch(writeOps, MIGRATION_BATCH_WRITE_LIMIT)) {
        const batch = writeBatch(db);
        chunk.forEach((fn) => fn(batch));
        await batch.commit();
      }
      ckpt.copiedSections.push('tactics_attendance');
      saveMigrationCheckpoint(ckpt);
    }

    // Section 4: Matches + Reports + Suggestions + AdminRatings
    if (!ckpt.copiedSections.includes('history')) {
      reportProgress('نسخ سجل المباريات والتقارير والتقييمات...', 88);
      const writeOps: Array<(b: ReturnType<typeof writeBatch>) => void> = [];
      matchesSnap.docs.forEach((d) => {
        writeOps.push((b) =>
          b.set(doc(db, 'teams', targetTeamId, 'matches', d.id), { ...d.data(), teamId: targetTeamId })
        );
      });
      reportsSnap.docs.forEach((d) => {
        writeOps.push((b) =>
          b.set(doc(db, 'teams', targetTeamId, 'reports', d.id), { ...d.data(), teamId: targetTeamId, updatedAt: serverTimestamp() })
        );
      });
      suggSnap.docs.forEach((d) => {
        writeOps.push((b) =>
          b.set(doc(db, 'teams', targetTeamId, 'suggestions', d.id), { ...d.data(), teamId: targetTeamId })
        );
      });
      admRatingsSnap.docs.forEach((d) => {
        writeOps.push((b) =>
          b.set(doc(db, 'teams', targetTeamId, 'adminRatings', d.id), { ...d.data(), teamId: targetTeamId, updatedAt: serverTimestamp() })
        );
      });
      for (const chunk of chunkItemsForBatch(writeOps, MIGRATION_BATCH_WRITE_LIMIT)) {
        const batch = writeBatch(db);
        chunk.forEach((fn) => fn(batch));
        await batch.commit();
      }
      ckpt.copiedSections.push('history');
      ckpt.completedAtMs = Date.now();
      saveMigrationCheckpoint(ckpt);
    }

    reportProgress('اكتمل النسخ بأمان — جاهز لمرحلة التحقق!', 100);
    return { targetTeamId, checkpoint: ckpt, logoAdjusted };
  }

  async verifyLegacyToMultiMigration(targetTeamId: string): Promise<{
    ok: boolean;
    rows: MigrationCountRow[];
    mismatches: string[];
  }> {
    if (!this.isPlatformOwner) {
      throw new Error('التحقق من الهجرة متاح لمالك الفريق فقط');
    }
    const cleanTarget = sanitizeTeamId(targetTeamId);
    if (!cleanTarget) throw new Error('معرّف الوجهة غير صالح');

    const [
      srcPlayers,
      srcRd,
      srcInj,
      srcMatches,
      srcReports,
      srcAtt,
      srcSugg,
      dstMembers,
      dstMatches,
      dstReports,
      dstAtt,
      dstTac,
      dstSugg,
    ] = await Promise.all([
      getDocs(query(collection(db, 'players'), where('teamId', '==', TEAM_ID))),
      getDocs(query(collection(db, 'readiness'), where('teamId', '==', TEAM_ID))),
      getDocs(query(collection(db, 'injuries'), where('teamId', '==', TEAM_ID))),
      getDocs(query(collection(db, 'matches'), where('teamId', '==', TEAM_ID))),
      getDocs(query(collection(db, 'reports'), where('teamId', '==', TEAM_ID))),
      getDocs(query(collection(db, 'attendance'), where('teamId', '==', TEAM_ID))),
      getDocs(query(collection(db, 'suggestions'), where('teamId', '==', TEAM_ID))),
      getDocs(collection(db, 'teams', cleanTarget, 'members')),
      getDocs(collection(db, 'teams', cleanTarget, 'matches')),
      getDocs(collection(db, 'teams', cleanTarget, 'reports')),
      getDocs(collection(db, 'teams', cleanTarget, 'attendance')),
      getDoc(doc(db, 'teams', cleanTarget, 'tactics', 'current')),
      getDocs(collection(db, 'teams', cleanTarget, 'suggestions')),
    ]);

    let dstPrivateCount = 0;
    for (const mDoc of dstMembers.docs) {
      const pSnap = await getDocs(collection(db, 'teams', cleanTarget, 'members', mDoc.id, 'private'));
      dstPrivateCount += pSnap.size;
    }

    const groupedAtt = groupLegacyAttendanceByMatchKey(srcAtt.docs.map((d) => ({ id: d.id, ...d.data() })));
    const report = verifyMigrationCountReport(
      {
        members: srcPlayers.size,
        privateRecords: srcRd.size + srcInj.size,
        matches: srcMatches.size,
        reports: srcReports.size,
        attendanceDocs: groupedAtt.length,
        tactics: 1,
        suggestions: srcSugg.size,
      },
      {
        members: dstMembers.size,
        privateRecords: dstPrivateCount,
        matches: dstMatches.size,
        reports: dstReports.size,
        attendanceDocs: dstAtt.size,
        tactics: dstTac.exists() ? 1 : 0,
        suggestions: dstSugg.size,
      }
    );

    const ckpt = loadMigrationCheckpoint();
    if (ckpt) {
      ckpt.verifiedOk = report.ok;
      saveMigrationCheckpoint(ckpt);
    }
    return report;
  }

  async confirmSwitchToMigratedTeam(targetTeamId: string): Promise<void> {
    if (!this.isPlatformOwner) {
      throw new Error('هذا الإجراء متاح لمالك الفريق فقط');
    }
    const uid = this.activeUid || auth.currentUser?.uid;
    const cleanTarget = sanitizeTeamId(targetTeamId);
    if (!uid || !cleanTarget) throw new Error('معرّف الفريق غير صالح');

    await setDoc(
      doc(db, 'users', uid),
      {
        uid,
        teamIds: arrayUnion(cleanTarget),
        ownedTeamIds: arrayUnion(cleanTarget),
        activeTeamId: cleanTarget,
        migratedToTeamId: cleanTarget,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
    saveMigrationCheckpoint(null);
    this.activeStorageMode = 'multi';
    this.activeTeamId = cleanTarget;
  }

  private async importCleanBackupToFirestore(
    clean: ReturnType<typeof sanitizeBackupImport>,
    captainUid: string
  ): Promise<void> {
    const ops: Array<(batch: ReturnType<typeof writeBatch>) => void> = [];

    const backupShareCode = generateSecureInviteCode(12);
    const authCtx = { isFirebaseMode: true, isCaptainSession: true };
    const mainRec = createSmartInvitationRecord(
      {
        customCode: clean.settings.inviteCode,
        teamName: clean.settings.teamName,
        appName: clean.settings.appName,
        primaryColor: clean.settings.primaryColor,
        requireApproval: clean.settings.requireApproval,
        isMemberShareCode: false,
        usageType: 'multi',
        maxUses: 20,
        durationDays: 7,
      },
      authCtx
    );
    const shareRec = createSmartInvitationRecord(
      {
        customCode: backupShareCode,
        teamName: clean.settings.teamName,
        appName: clean.settings.appName,
        primaryColor: clean.settings.primaryColor,
        requireApproval: true,
        isMemberShareCode: true,
        usageType: 'multi',
        maxUses: 100,
        durationDays: 90,
      },
      authCtx
    );

    ops.push((b) => {
      b.set(doc(db, 'settings', 'team'), {
        teamId: TEAM_ID,
        ...clean.settings,
        memberShareCode: backupShareCode,
        creatorUid: captainUid,
        organizerUids: [captainUid],
        lineupPermission: 'all',
        defaultCurrency: 'ريال',
        defaultPitchCost: 0,
        updatedAt: serverTimestamp(),
      });
      b.set(doc(db, 'publicMeta', 'branding'), {
        appName: clean.settings.appName,
        teamName: clean.settings.teamName,
        primaryColor: clean.settings.primaryColor,
        secondaryColor: clean.settings.secondaryColor,
        logo: clean.settings.logo,
        updatedAt: serverTimestamp(),
      });
      b.set(doc(db, 'inviteCodes', clean.settings.inviteCode), {
        code: clean.settings.inviteCode,
        active: true,
        requireApproval: clean.settings.requireApproval,
        isMemberShareCode: false,
        teamId: TEAM_ID,
        teamName: clean.settings.teamName,
        appName: clean.settings.appName,
        primaryColor: clean.settings.primaryColor,
        usageType: mainRec.usageType,
        maxUses: mainRec.maxUses,
        usedCount: 0,
        durationDays: mainRec.durationDays,
        createdAtMs: mainRec.createdAtMs,
        expiresAtMs: mainRec.expiresAtMs,
        status: 'active',
        updatedAt: serverTimestamp(),
      });
      b.set(doc(db, 'inviteCodes', backupShareCode), {
        code: backupShareCode,
        active: true,
        requireApproval: true,
        isMemberShareCode: true,
        teamId: TEAM_ID,
        teamName: clean.settings.teamName,
        appName: clean.settings.appName,
        primaryColor: clean.settings.primaryColor,
        usageType: shareRec.usageType,
        maxUses: shareRec.maxUses,
        usedCount: 0,
        durationDays: shareRec.durationDays,
        createdAtMs: shareRec.createdAtMs,
        expiresAtMs: shareRec.expiresAtMs,
        status: 'active',
        updatedAt: serverTimestamp(),
      });
      b.set(doc(db, 'tactics', 'current'), {
        teamId: TEAM_ID,
        formation: clean.tactics.formation,
        slots: clean.tactics.slots,
        updatedAt: serverTimestamp(),
      });
    });

    for (const p of clean.players) {
      const pid = String(p.id);
      const photo = sanitizeImageDataUrl(p.photo, 250000);
      ops.push((b) => {
        b.set(doc(db, 'players', pid), {
          id: pid,
          teamId: TEAM_ID,
          ownerUid: String(p.ownerUid || ''),
          name: p.name,
          role: p.role,
          jersey: p.jersey,
          age: p.age,
          height: p.height,
          weight: p.weight,
          foot: p.foot,
          primaryPos: p.primaryPos,
          secondaryPos: p.secondaryPos,
          photoZoom: p.photoZoom,
          photoY: p.photoY,
          hasPhoto: Boolean(photo),
          skills: p.skills,
          ...(sanitizeStats6(p.stats6) ? { stats6: sanitizeStats6(p.stats6) } : {}),
          roleOverride: sanitizeRoleOverride(p.roleOverride),
          top3Strengths: p.top3Strengths,
          weak3Points: p.weak3Points,
          seasonGoal: p.seasonGoal,
          availability: p.availability,
          availableStatus: p.availableStatus,
          roleModelStarId: sanitizeStarId(p.roleModelStarId),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        if (photo) {
          b.set(doc(db, 'playerPhotos', pid), {
            teamId: TEAM_ID,
            playerId: pid,
            ownerUid: String(p.ownerUid || ''),
            dataUrl: photo,
            photoZoom: p.photoZoom,
            photoY: p.photoY,
            updatedAt: serverTimestamp(),
          });
        }
      });
    }

    for (const m of clean.matches) {
      ops.push((b) => {
        b.set(doc(db, 'matches', String(m.id)), {
          teamId: TEAM_ID,
          date: m.date,
          opponent: m.opponent,
          ourScore: m.ourScore,
          oppScore: m.oppScore,
          result: m.result,
          createdBy: captainUid,
          createdAt: serverTimestamp(),
        });
      });
    }

    const playerNameMap = new Map(clean.players.map((p) => [String(p.id), String(p.name || 'لاعب')]));
    for (const r of clean.reports) {
      ops.push((b) => {
        b.set(doc(db, 'reports', String(r.id)), {
          teamId: TEAM_ID,
          playerId: r.playerId,
          ownerUid: String(r.ownerUid || captainUid),
          playerName: playerNameMap.get(String(r.playerId)) || 'لاعب',
          opponent: r.opponent,
          goals: Math.min(MAX_GOALS_PER_MATCH, Number(r.goals || 0)),
          assists: Math.min(MAX_ASSISTS_PER_MATCH, Number(r.assists || 0)),
          minutes: r.minutes,
          interceptions: r.interceptions,
          turnovers: r.turnovers,
          rating: r.rating,
          rpe: r.rpe,
          bestMoment: r.bestMoment,
          worstMoment: r.worstMoment,
          motmVote: r.motmVote,
          pitchMode: sanitizePitchMode(r.pitchMode),
          matchResult: sanitizeMatchResult(r.matchResult),
          goalsConceded: Math.round(clampNum(r.goalsConceded, 0, MAX_CONCEDED_PER_MATCH, 0)),
          confirmedByUids: [],
          verified: false,
          createdAtMs: Date.now(),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      });
    }

    for (const a of clean.attendance) {
      ops.push((b) => {
        b.set(doc(db, 'attendance', String(a.id)), {
          teamId: TEAM_ID,
          playerId: a.playerId,
          ownerUid: String(a.ownerUid || captainUid),
          playerName: a.playerName,
          date: a.date,
          type: a.type,
          status: normalizeAttendanceStatus(a.status),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      });
    }

    for (const rd of clean.readiness) {
      ops.push((b) => {
        b.set(doc(db, 'readiness', String(rd.id)), {
          teamId: TEAM_ID,
          playerId: rd.playerId,
          ownerUid: String(rd.ownerUid || captainUid),
          date: rd.date,
          sleep: rd.sleep,
          fatigue: rd.fatigue,
          mood: rd.mood,
          createdAt: serverTimestamp(),
        });
      });
    }

    for (const inj of clean.injuries) {
      ops.push((b) => {
        b.set(doc(db, 'injuries', String(inj.id)), {
          teamId: TEAM_ID,
          playerId: inj.playerId,
          ownerUid: String(inj.ownerUid || captainUid),
          type: inj.type,
          location: inj.location,
          severity: inj.severity,
          date: inj.date,
          expectedReturn: inj.expectedReturn,
          createdAt: serverTimestamp(),
        });
      });
    }

    for (const s of clean.suggestions) {
      ops.push((b) => {
        b.set(doc(db, 'suggestions', String(s.id || makeId('sugg'))), {
          teamId: TEAM_ID,
          text: s.text,
          createdAt: serverTimestamp(),
        });
      });
    }

    for (const ar of clean.adminRatings) {
      ops.push((b) => {
        b.set(doc(db, 'adminRatings', String(ar.targetId)), {
          teamId: TEAM_ID,
          targetId: ar.targetId,
          score: ar.score,
          updatedAt: serverTimestamp(),
        });
      });
    }

    for (let i = 0; i < ops.length; i += 180) {
      const batch = writeBatch(db);
      for (const fn of ops.slice(i, i + 180)) fn(batch);
      try {
        await batch.commit();
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, 'importBackup');
      }
    }
  }

  private async wipeTeamCollections(captainUid: string): Promise<void> {
    const colNames = [
      'matches',
      'reports',
      'attendance',
      'readiness',
      'injuries',
      'suggestions',
      'adminRatings',
      'peerRatingStats',
      'pitchPayments',
      'matchSessions',
      'missionClaims',
      'lineupVotes',
    ];
    for (const colName of colNames) {
      const snap = await getDocs(query(collection(db, colName), where('teamId', '==', TEAM_ID)));
      for (let i = 0; i < snap.docs.length; i += 400) {
        const batch = writeBatch(db);
        snap.docs.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
        try {
          await batch.commit();
        } catch (err) {
          handleFirestoreError(err, OperationType.DELETE, colName);
        }
      }
    }

    const pSnap = await getDocs(query(collection(db, 'players'), where('teamId', '==', TEAM_ID)));
    const batch = writeBatch(db);
    pSnap.docs.forEach((d) => {
      if (d.id !== captainUid) {
        batch.delete(d.ref);
        batch.delete(doc(db, 'playerPhotos', d.id));
      }
    });
    batch.set(doc(db, 'tactics', 'current'), {
      teamId: TEAM_ID,
      formation: '2-2-1',
      slots: {},
      updatedAt: serverTimestamp(),
    });
    try {
      await batch.commit();
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, 'players');
    }
  }
}

export const backend = new MaydanBackendService();

declare global {
  interface Window {
    MaydanBackend?: MaydanBackendService;
    MaydanSecurity?: {
      escapeHtml: typeof import('./security').escapeHtml;
      sanitizeImageDataUrl: typeof import('./security').sanitizeImageDataUrl;
      sanitizeBackupImport: typeof import('./security').sanitizeBackupImport;
      computePeerAggregate: typeof import('./security').computePeerAggregate;
      generateSecureInviteCode: typeof import('./security').generateSecureInviteCode;
      sanitizeInviteCode: typeof import('./security').sanitizeInviteCode;
    };
  }
}

window.MaydanBackend = backend;
window.MaydanSecurity = {
  escapeHtml,
  sanitizeImageDataUrl,
  sanitizeBackupImport,
  computePeerAggregate,
  generateSecureInviteCode,
  sanitizeInviteCode,
};

backend.init();

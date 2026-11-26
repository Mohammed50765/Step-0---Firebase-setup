import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import {
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import {
  auth,
  authPersistenceReady,
  db,
  getRedirectResult,
  googleProvider,
  handleFirestoreError,
  OperationType,
  signInWithRedirect,
  testConnection,
} from './firebase';
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

const TEAM_CACHE_KEY = 'maydan_team_cache_v1';

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

  init(): void {
    void testConnection();
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

  clearSessionData(): void {
    this.stopListeners();
    this.activeUid = null;
    this.activeIsCaptain = false;
    this.activeTab = null;
    this.activeState = null;
    this.activeOnUpdate = null;
    this.activeOnError = null;
    this.photosMap = {};
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(TEAM_CACHE_KEY);
      }
    } catch {
      // Ignore storage errors
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
      if (typeof localStorage === 'undefined' || !this.activeUid) return;
      const leanPlayers = (state.players || []).map((p) => {
        const copy = { ...p };
        delete copy.photo;
        return copy;
      });
      const safeSettings = { ...(state.settings || {}) };
      delete safeSettings.inviteCode;
      localStorage.setItem(
        TEAM_CACHE_KEY,
        JSON.stringify({
          ownerUid: this.activeUid,
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

  loadTeamSnapshotCache(expectedUid?: string): {
    ownerUid?: string;
    settings?: Record<string, unknown>;
    players?: Array<Record<string, unknown>>;
    pitchSession?: Record<string, unknown> | null;
    cachedAt?: number;
  } | null {
    try {
      if (typeof localStorage === 'undefined') return null;
      const raw = localStorage.getItem(TEAM_CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (expectedUid && parsed?.ownerUid !== expectedUid) {
        localStorage.removeItem(TEAM_CACHE_KEY);
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

  async resolveSession(fbUser: User): Promise<{
    status: 'ready' | 'pending' | 'rejected' | 'needs_join';
    isCaptain: boolean;
    captainDiagnostic: {
      code: 'verified' | 'not_found' | 'email_unverified' | 'error';
      detail?: string;
    };
    branding?: Record<string, unknown>;
    joinRequest?: Record<string, unknown>;
  }> {
    this.clearSessionData();
    this.activeUid = fbUser.uid;
    let isCaptain = false;
    let captainDiagnostic: {
      code: 'verified' | 'not_found' | 'email_unverified' | 'error';
      detail?: string;
    } = { code: 'not_found' };

    // Captain identity is strictly verified via trusted admins/{uid} document ONLY
    if (!fbUser.emailVerified) {
      captainDiagnostic = {
        code: 'email_unverified',
        detail: 'البريد الإلكتروني للحساب غير موثّق (emailVerified=false)، فتمنع القواعد قراءة admins/{uid}.',
      };
    } else {
      try {
        const admSnap = await getDoc(doc(db, 'admins', fbUser.uid));
        quotaMonitor.recordReads('session', 1);
        isCaptain = admSnap.exists();
        captainDiagnostic = { code: isCaptain ? 'verified' : 'not_found' };
      } catch (err) {
        if (isQuotaExceededError(err)) {
          quotaMonitor.markQuotaExceeded(true);
          throw new Error(QUOTA_EXCEEDED_ARABIC_MSG);
        }
        isCaptain = false;
        const errMsg = err instanceof Error ? err.message : String(err);
        console.warn('Captain admins/{uid} verification error:', errMsg);
        captainDiagnostic = {
          code: 'error',
          detail: errMsg,
        };
      }
    }
    this.activeIsCaptain = isCaptain;

    if (isCaptain) {
      await this.bootstrapCaptainWorkspace(fbUser);
      return { status: 'ready', isCaptain: true, captainDiagnostic };
    }

    // Check if player profile already exists for this Google UID
    let playerSnap;
    try {
      playerSnap = await getDoc(doc(db, 'players', fbUser.uid));
      quotaMonitor.recordReads('session', 1);
    } catch (err) {
      this.handleWriteError(err, OperationType.GET, `players/${fbUser.uid}`);
    }

    if (playerSnap.exists()) {
      return { status: 'ready', isCaptain: false, captainDiagnostic };
    }

    // Fetch public branding for join/pending screens
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

    // Check existing join request
    try {
      const jrSnap = await getDoc(doc(db, 'joinRequests', fbUser.uid));
      if (jrSnap.exists()) {
        const jr = jrSnap.data();
        if (jr.status === 'pending') {
          return { status: 'pending', isCaptain: false, captainDiagnostic, branding, joinRequest: jr };
        }
        if (jr.status === 'rejected') {
          return { status: 'rejected', isCaptain: false, captainDiagnostic, branding, joinRequest: jr };
        }
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, `joinRequests/${fbUser.uid}`);
    }

    return { status: 'needs_join', isCaptain: false, captainDiagnostic, branding };
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
  }): Promise<{ joinedDirectly: boolean; teamName?: string }> {
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

        // Atomically consume +1 from invitation quota WITHOUT writing any PII (lastUsedBy) to public inviteCodes
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
          return { joinedDirectly: false, teamName };
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

        return { joinedDirectly: true, teamName };
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

  /**
   * Non-realtime one-shot fetch of aggregated peer rating stats (count >= 3).
   * Intentionally NOT subscribed via onSnapshot so live score deltas cannot
   * de-anonymize individual raters when they submit a ballot.
   */
  async refreshPeerRatingStats(
    state?: BackendState
  ): Promise<Record<string, { count: number; totalScore: number }>> {
    const targetState = state || this.activeState;
    if (!targetState) return {};
    try {
      const snap = await getDocs(
        query(
          collection(db, 'peerRatingStats'),
          where('teamId', '==', TEAM_ID),
          where('count', '>=', 3)
        )
      );
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
   * One-shot non-realtime fetch of attendance records so FIFA Shield commitment %
   * is accurate without adding a permanent core listener.
   */
  async refreshAttendance(state?: BackendState): Promise<void> {
    const targetState = state || this.activeState;
    if (!targetState) return;
    try {
      const snap = await getDocs(query(collection(db, 'attendance'), where('teamId', '==', TEAM_ID)));
      quotaMonitor.recordReads('oneShot', Math.max(1, snap.size));
      targetState.attendance = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
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
   * One-shot non-realtime fetch of Captain official ratings (adminRatings)
   * so the 3-layer rating transparency panel reflects Captain scores without an extra core listener.
   */
  async refreshAdminRatings(state?: BackendState): Promise<void> {
    const targetState = state || this.activeState;
    if (!targetState) return;
    try {
      const snap = await getDocs(query(collection(db, 'adminRatings'), where('teamId', '==', TEAM_ID)));
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
          const snap = await getDoc(doc(db, 'matchVoteTallies', `${sid}__${pid}`));
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
    try {
      const q = this.activeIsCaptain
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

    const handleErr = (op: OperationType, path: string) => (err: unknown) => {
      this.handleListenerError(err, op, path, onError);
    };

    // Hydrate non-sensitive local cache ONLY if it belongs to the exact same UID
    const cached = this.loadTeamSnapshotCache(uid);
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

    // ==================== CORE LISTENERS ONLY (3 minimal subscriptions) ====================
    // 1. Team Settings (1 doc)
    this.coreUnsubs.push(
      onSnapshot(
        doc(db, 'settings', 'team'),
        (snap) => {
          quotaMonitor.recordReads('core', 1);
          quotaMonitor.markQuotaExceeded(false);
          if (snap.exists()) {
            const nextSettings = { ...snap.data() };
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

    // 2. Team Roster (N player docs — lean, no portrait images)
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

    // 3. Current User's Own Portrait ONLY (1 doc instead of whole team)
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

    // Subscribe lazily to ONLY the initially visible tab
    this.setActiveTab(initialTab);
  }

  /**
   * Lazy Per-Tab Listener Manager:
   * Detaches listeners for the previous tab and subscribes ONLY to the
   * collections required by the currently visible tab.
   */
  setActiveTab(tabId: string): void {
    const uid = this.activeUid;
    const state = this.activeState;
    const onUpdate = this.activeOnUpdate;
    const onError = this.activeOnError;
    if (!uid || !state || !onUpdate || !onError) return;
    if (this.activeTab === tabId && this.tabUnsubs.length > 0) return;

    this.stopTabListeners();
    this.activeTab = tabId;

    const isCaptain = this.activeIsCaptain;
    const handleErr = (op: OperationType, path: string) => (err: unknown) => {
      this.handleListenerError(err, op, path, onError);
    };

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
        // One-shot non-realtime fetch of aggregated peer stats, attendance commitment & captain ratings on screen open
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
        // Load all player portraits only when opening Tactical Studio (for Poster & Mini Cards)
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
        // One-shot non-realtime fetch of aggregated peer stats on screen open
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

    switch (action) {
      case 'displayName': {
        const playerId = String(currentUser.id || uid);
        const check = sanitizePlayerDisplayName(payload.name);
        if (!check.valid) {
          throw new Error(check.errorAr || 'أدخل الاسم الظاهر في الملعب (حرفان على الأقل)');
        }
        try {
          await updateDoc(doc(db, 'players', playerId), {
            name: check.name,
            updatedAt: serverTimestamp(),
          });
        } catch (err) {
          this.handleWriteError(err, OperationType.UPDATE, `players/${playerId}`);
        }
        return { name: check.name };
      }

      case 'profile': {
        const playerId = String(currentUser.id || uid);
        const ref = doc(db, 'players', playerId);
        const nameCheck = sanitizePlayerDisplayName(payload.name ?? currentUser.name);
        const safeName = nameCheck.valid
          ? nameCheck.name
          : clampStr(currentUser.name, 80) || 'لاعب';
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
          await updateDoc(doc(db, 'players', playerId), {
            roleModelStarId,
            updatedAt: serverTimestamp(),
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.UPDATE, `players/${playerId}`);
        }
        return;
      }

      case 'addPlayer': {
        if (!this.activeIsCaptain) {
          throw new Error('إضافة لاعب للقائمة متاحة للكابتن فقط');
        }
        const id = String(payload.id || makeId('p')).replace(/[^a-zA-Z0-9_-]/g, '');
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
          await updateDoc(doc(db, 'joinRequests', applicantUid), {
            status: 'rejected',
            updatedAt: serverTimestamp(),
          });
        } catch (err) {
          this.handleWriteError(err, OperationType.UPDATE, `joinRequests/${applicantUid}`);
        }
        return;
      }

      case 'attendance': {
        const playerId = String(currentUser.id || uid).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 100) || uid;
        const dateStr = sanitizeDateStr(payload.date);
        const id = `${dateStr}__${playerId}`;
        const status = normalizeAttendanceStatus(payload.status);
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
              playerName: clampStr(payload.playerName || currentUser.name, 80) || 'لاعب',
              date: dateStr,
              type: clampStr(payload.type || 'مباراة', 40) || 'مباراة',
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
        } catch (err) {
          handleFirestoreError(err, OperationType.CREATE, `readiness/${id}`);
        }
        return;
      }

      case 'injury': {
        const id = makeId('inj');
        const batch = writeBatch(db);
        batch.set(doc(db, 'injuries', id), {
          teamId: TEAM_ID,
          playerId: String(currentUser.id || uid),
          ownerUid: uid,
          type: clampStr(payload.type, 80) || 'التواء الكاحل',
          location: clampStr(payload.location, 100) || 'القدم',
          severity:
            payload.severity === 'متوسطة' || payload.severity === 'شديدة'
              ? payload.severity
              : 'خفيفة',
          date: sanitizeDateStr(payload.date),
          expectedReturn: sanitizeDateStr(payload.expectedReturn),
          createdAt: serverTimestamp(),
        });
        // Update public availability status without leaking medical reason
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
          await updateDoc(doc(db, 'players', playerId), {
            availableStatus: 'available',
            updatedAt: serverTimestamp(),
          });
        } catch (err) {
          this.handleWriteError(err, OperationType.UPDATE, `players/${playerId}`);
        }
        return;
      }

      case 'match': {
        if (!this.activeIsCaptain) {
          throw new Error('تسجيل نتيجة المباراة الرسمية متاح للكابتن فقط');
        }
        const id = String(payload.id || makeId('m')).replace(/[^a-zA-Z0-9_-]/g, '');
        const ourScore = Math.round(clampNum(payload.ourScore, 0, 99, 0));
        const oppScore = Math.round(clampNum(payload.oppScore, 0, 99, 0));
        try {
          await setDoc(doc(db, 'matches', id), {
            teamId: TEAM_ID,
            date: sanitizeDateStr(payload.date),
            opponent: clampStr(payload.opponent, 80) || 'خصم',
            ourScore,
            oppScore,
            result: ourScore > oppScore ? 'فوز' : ourScore < oppScore ? 'خسارة' : 'تعادل',
            createdBy: uid,
            createdAt: serverTimestamp(),
          });
        } catch (err) {
          this.handleWriteError(err, OperationType.CREATE, `matches/${id}`);
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

        const throttleRef = doc(db, 'reportThrottle', uid);
        const reportRef = doc(db, 'reports', id);
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
              teamId: TEAM_ID,
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
              teamId: TEAM_ID,
              lastReportAtMs: nowMs,
              updatedAt: serverTimestamp(),
            });
            tx.set(reportRef, reportDoc);
          });
        } catch (err) {
          if (err instanceof Error && !err.message.includes('Missing or insufficient permissions')) {
            throw err;
          }
          this.handleWriteError(err, OperationType.CREATE, `reports/${id}`);
        }
        return;
      }

      case 'confirmReport': {
        const reportId = String(payload.reportId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 128);
        if (!reportId) throw new Error('معرّف التقرير غير صالح');
        const repRef = doc(db, 'reports', reportId);
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
        } catch (err) {
          if (err instanceof Error && !err.message.includes('Missing or insufficient permissions')) {
            throw err;
          }
          this.handleWriteError(err, OperationType.UPDATE, `reports/${reportId}`);
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
        const ballotRef = doc(db, 'peerRatings', ballotId);
        const statRef = doc(db, 'peerRatingStats', targetId);

        let existingBallot;
        try {
          existingBallot = await getDoc(ballotRef);
        } catch (err) {
          handleFirestoreError(err, OperationType.GET, `peerRatings/${ballotId}`);
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
              teamId: TEAM_ID,
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
          this.handleWriteError(err, OperationType.WRITE, `peerRatings/${ballotId}`);
        }
        return;
      }

      case 'adminRating': {
        if (!this.activeIsCaptain) {
          throw new Error('تقييم الكابتن الرسمي متاح للكابتن فقط');
        }
        const targetId = String(payload.targetId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 128);
        const score = Math.round(clampNum(payload.score, 1, 10, 7));
        if (!targetId) throw new Error('اختر لاعباً لتسجيل تقييم الكابتن');
        try {
          await setDoc(doc(db, 'adminRatings', targetId), {
            teamId: TEAM_ID,
            targetId,
            score,
            updatedAt: serverTimestamp(),
          });
        } catch (err) {
          this.handleWriteError(err, OperationType.WRITE, `adminRatings/${targetId}`);
        }
        return;
      }

      case 'suggestion': {
        const text = clampStr(payload.text, 500);
        if (!text) return;
        const id = makeId('sugg');
        try {
          await setDoc(doc(db, 'suggestions', id), {
            teamId: TEAM_ID,
            text,
            createdAt: serverTimestamp(),
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.CREATE, `suggestions/${id}`);
        }
        return;
      }

      case 'tactics': {
        const curSettings = (this.activeState?.settings || {}) as Record<string, unknown>;
        const orgUids = Array.isArray(curSettings.organizerUids)
          ? (curSettings.organizerUids as string[])
          : [];
        const lineupPerm = curSettings.lineupPermission === 'organizers' ? 'organizers' : 'all';
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
        const tacticsRef = doc(db, 'tactics', 'current');
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
              teamId: TEAM_ID,
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
          this.handleWriteError(err, OperationType.WRITE, 'tactics/current');
        }
        return;
      }

      case 'undoTactics': {
        const curSettings = (this.activeState?.settings || {}) as Record<string, unknown>;
        const orgUids = Array.isArray(curSettings.organizerUids)
          ? (curSettings.organizerUids as string[])
          : [];
        const lineupPerm = curSettings.lineupPermission === 'organizers' ? 'organizers' : 'all';
        const canPublish =
          this.activeIsCaptain ||
          lineupPerm === 'all' ||
          orgUids.includes(uid);
        if (!canPublish) {
          throw new Error('التراجع عن نشر التشكيلة متاح لمنشئ الفريق والمنظّمين فقط');
        }
        const tacticsRef = doc(db, 'tactics', 'current');
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
              teamId: TEAM_ID,
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
          this.handleWriteError(err, OperationType.WRITE, 'tactics/current');
        }
        return;
      }

      case 'voteLineup': {
        const vote = payload.vote === 'swap' ? 'swap' : 'approve';
        try {
          await setDoc(doc(db, 'lineupVotes', uid), {
            teamId: TEAM_ID,
            uid,
            vote,
            updatedAt: serverTimestamp(),
          });
        } catch (err) {
          this.handleWriteError(err, OperationType.WRITE, `lineupVotes/${uid}`);
        }
        return;
      }

      case 'leaveTeam': {
        if (this.activeIsCaptain) {
          throw new Error('منشئ الفريق لا يمكنه المغادرة مباشرة — رقّ كابتناً آخر أولاً أو استخدم مسح الفريق.');
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
          throw new Error('تعديل إعدادات وهوية الفريق متاح للكابتن والمنظّمين فقط');
        }

        const teamName = clampStr(payload.teamName || curSettings.teamName || 'فريق السداسي', 80) || 'فريق السداسي';
        const logo = sanitizeImageDataUrl(payload.logo !== undefined ? payload.logo : curSettings.logo, 180000);
        const lineupPermission = payload.lineupPermission === 'organizers' ? 'organizers' : 'all';
        const defaultCurrency = clampStr(payload.defaultCurrency || curSettings.defaultCurrency || 'ريال', 20) || 'ريال';
        const defaultPitchCost = Math.round(clampNum(payload.defaultPitchCost ?? curSettings.defaultPitchCost, 0, 100000, 0) * 10) / 10;

        // Tier 2: Designated Organizer updates team policy/logo/currency/cost only
        if (isDesignatedOrganizer) {
          try {
            await updateDoc(doc(db, 'settings', 'team'), {
              teamName,
              logo,
              defaultCurrency,
              defaultPitchCost,
              lineupPermission,
              updatedAt: serverTimestamp(),
            });
          } catch (err) {
            this.handleWriteError(err, OperationType.UPDATE, 'settings/team');
          }
          return;
        }

        // Tier 1: Verified Captain full settings & invite sync
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
          lineupPermission,
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
          throw new Error('إنشاء وتدوير دعوات الفريق متاح للكابتن فقط');
        }
        const currSettings = (this.activeState?.settings || {}) as Record<string, unknown>;
        const isMemberShareCode = payload.isMemberShareCode === true;
        const requireApproval = isMemberShareCode
          ? true
          : typeof payload.requireApproval === 'boolean'
            ? payload.requireApproval
            : currSettings.requireApproval !== false;
        const teamName = clampStr(payload.teamName || currSettings.teamName || 'فريق السداسي', 80) || 'فريق السداسي';
        const appName = clampStr(payload.appName || currSettings.appName || 'ميدان 6v6', 60) || 'ميدان 6v6';
        const primaryColor = sanitizeHexColor(payload.primaryColor || currSettings.primaryColor, ROYAL_PRIMARY);

        const smartRec = createSmartInvitationRecord(
          {
            teamName,
            appName,
            primaryColor,
            requireApproval,
            isMemberShareCode,
            usageType: payload.usageType,
            maxUses: payload.maxUses,
            durationDays: payload.durationDays,
          },
          { isFirebaseMode: true, isCaptainSession: this.activeIsCaptain }
        );

        const newCode = smartRec.code;
        const prevCode =
          payload.revokePrevious && payload.prevInviteCode
            ? sanitizeInviteCode(payload.prevInviteCode)
            : '';

        const batch = writeBatch(db);
        if (isMemberShareCode) {
          batch.update(doc(db, 'settings', 'team'), {
            memberShareCode: newCode,
            updatedAt: serverTimestamp(),
          });
        } else {
          batch.update(doc(db, 'settings', 'team'), {
            inviteCode: newCode,
            updatedAt: serverTimestamp(),
          });
        }
        batch.set(doc(db, 'inviteCodes', newCode), {
          code: newCode,
          active: true,
          requireApproval: smartRec.requireApproval,
          isMemberShareCode: Boolean(smartRec.isMemberShareCode),
          teamId: TEAM_ID,
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
        batch.set(doc(db, 'inviteAdminLogs', newCode), {
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
        } catch (err) {
          this.handleWriteError(err, OperationType.WRITE, `inviteCodes/${newCode}`);
        }
        return { inviteCode: newCode, invite: smartRec, record: smartRec };
      }

      case 'revokeSmartInvite': {
        if (!this.activeIsCaptain) {
          throw new Error('إلغاء دعوات الفريق متاح للكابتن فقط');
        }
        const targetCode = sanitizeInviteCode(payload.code || payload.inviteCode);
        if (!targetCode) throw new Error('كود الدعوة غير صالح');
        const batch = writeBatch(db);
        batch.update(doc(db, 'inviteCodes', targetCode), {
          active: false,
          status: 'revoked',
          updatedAt: serverTimestamp(),
        });
        batch.set(
          doc(db, 'inviteAdminLogs', targetCode),
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
          throw new Error('تغيير صلاحيات اللاعبين متاح للكابتن فقط');
        }
        const targetId = String(payload.id || '');
        const ownerUid = String(payload.ownerUid || '');
        const newRole = payload.role === 'admin' ? 'admin' : 'player';
        if (!targetId) return;
        const batch = writeBatch(db);
        batch.update(doc(db, 'players', targetId), {
          role: newRole,
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
        const curSettings = (this.activeState?.settings || {}) as Record<string, unknown>;
        const orgUids = Array.isArray(curSettings.organizerUids)
          ? (curSettings.organizerUids as string[])
          : [];
        if (!this.activeIsCaptain && !orgUids.includes(uid)) {
          throw new Error('تعديل موعد المباراة والقَطّة متاح للكابتن والمنظّمين فقط');
        }
        const sessionDoc = {
          teamId: TEAM_ID,
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
        try {
          await setDoc(doc(db, 'pitchSessions', 'current'), sessionDoc);
        } catch (err) {
          this.handleWriteError(err, OperationType.WRITE, 'pitchSessions/current');
        }
        return;
      }

      case 'pitchPayment': {
        const curSettings = (this.activeState?.settings || {}) as Record<string, unknown>;
        const orgUids = Array.isArray(curSettings.organizerUids)
          ? (curSettings.organizerUids as string[])
          : [];
        if (!this.activeIsCaptain && !orgUids.includes(uid)) {
          throw new Error('تحديث حالة دفع القَطّة متاح للكابتن والمنظّمين فقط');
        }
        const pay = (payload.payment || {}) as Record<string, unknown>;
        const sess = (payload.session || {}) as Record<string, unknown>;
        const playerId = String(pay.playerId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 128);
        if (!playerId) throw new Error('معرّف اللاعب غير صالح');
        const paymentId = `current__${playerId}`;

        const batch = writeBatch(db);
        batch.set(doc(db, 'pitchPayments', paymentId), {
          teamId: TEAM_ID,
          sessionId: 'current',
          playerId,
          ownerUid: String(pay.ownerUid || playerId).slice(0, 128),
          playerName: clampStr(pay.playerName || 'لاعب', 80) || 'لاعب',
          amount: Math.round(clampNum(pay.amount, 0, 10000, 0) * 10) / 10,
          paid: Boolean(pay.paid),
          updatedAt: serverTimestamp(),
        });
        batch.set(doc(db, 'pitchSessions', 'current'), {
          teamId: TEAM_ID,
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
          this.handleWriteError(err, OperationType.WRITE, `pitchPayments/${paymentId}`);
        }
        return;
      }

      case 'importBackup': {
        if (!this.activeIsCaptain) {
          throw new Error('استيراد النسخة الاحتياطية متاح للكابتن فقط');
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
        try {
          await setDoc(doc(db, 'matchSessions', id), {
            id,
            teamId: TEAM_ID,
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
          });
        } catch (err) {
          this.handleWriteError(err, OperationType.CREATE, `matchSessions/${id}`);
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
        try {
          await updateDoc(doc(db, 'matchSessions', sessionId), {
            confirmers,
            status,
            votingOpen,
            updatedAt: serverTimestamp(),
          });
        } catch (err) {
          this.handleWriteError(err, OperationType.UPDATE, `matchSessions/${sessionId}`);
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

        // Chunk atomic (ballot + tally) pairs into max 4 targets per writeBatch
        // to stay strictly under Firestore's 20 document-access-per-batch security rule limit (even on 11v11).
        const CHUNK_SIZE = 4;
        try {
          for (let i = 0; i < validBallots.length; i += CHUNK_SIZE) {
            const chunk = validBallots.slice(i, i + CHUNK_SIZE);
            const isLastChunk = i + CHUNK_SIZE >= validBallots.length;
            const batch = writeBatch(db);
            for (const { targetId, score } of chunk) {
              const ballotId = `${sessionId}__${targetId}__${uid}`;
              const tallyId = `${sessionId}__${targetId}`;

              batch.set(doc(db, 'matchVoteBallots', ballotId), {
                sessionId,
                targetId,
                voterUid: uid,
                score,
                createdAt: serverTimestamp(),
              });
              batch.set(
                doc(db, 'matchVoteTallies', tallyId),
                {
                  teamId: TEAM_ID,
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
              batch.update(doc(db, 'matchSessions', sessionId), {
                voterUids: arrayUnion(uid),
                updatedAt: serverTimestamp(),
              });
            }
            await batch.commit();
          }
        } catch (err) {
          this.handleWriteError(err, OperationType.WRITE, `matchVoteBallots/${sessionId}`);
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
        try {
          await setDoc(doc(db, 'missionClaims', id), {
            id,
            teamId: TEAM_ID,
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
          });
        } catch (err) {
          this.handleWriteError(err, OperationType.CREATE, `missionClaims/${id}`);
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
        try {
          await updateDoc(doc(db, 'missionClaims', claimId), {
            approverUids,
            rejectorUids,
            status,
            updatedAt: serverTimestamp(),
          });
        } catch (err) {
          this.handleWriteError(err, OperationType.UPDATE, `missionClaims/${claimId}`);
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
        const docRef = doc(db, 'footballLibrary', artId);
        try {
          const existingSnap = await getDoc(docRef);
          const createdAtVal = existingSnap.exists()
            ? existingSnap.data().createdAt || serverTimestamp()
            : serverTimestamp();
          await setDoc(docRef, {
            id: artId,
            teamId: TEAM_ID,
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
          this.handleWriteError(err, OperationType.WRITE, `footballLibrary/${artId}`);
        }
        return;
      }

      case 'deleteLibraryArticle': {
        if (!this.activeIsCaptain) {
          throw new Error('حذف المقالات متاح للكابتن فقط');
        }
        const artId = String(payload.id || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
        if (!artId) throw new Error('معرّف المقال غير صالح');
        try {
          await deleteDoc(doc(db, 'footballLibrary', artId));
          await this.refreshFootballLibrary();
        } catch (err) {
          this.handleWriteError(err, OperationType.DELETE, `footballLibrary/${artId}`);
        }
        return;
      }

      case 'wipeReset': {
        if (!this.activeIsCaptain) {
          throw new Error('مسح البيانات متاح للكابتن فقط');
        }
        await this.wipeTeamCollections(uid);
        return;
      }

      default:
        console.warn('Unknown backend action:', action);
    }
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

    // Commit in chunks of 180 operations (safely below Firestore's 500 batch limit)
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

    // Delete non-captain players
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

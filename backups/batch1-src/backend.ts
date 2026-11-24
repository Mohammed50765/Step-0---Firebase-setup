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
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import {
  auth,
  db,
  googleProvider,
  handleFirestoreError,
  OperationType,
  testConnection,
} from './firebase';
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
  isQuotaExceededError,
  QUOTA_EXCEEDED_ARABIC_MSG,
  quotaMonitor,
} from './quotaMonitor';

const TEAM_CACHE_KEY = 'maydan_team_cache_v1';

export interface BackendState {
  settings: Record<string, unknown>;
  players: Array<Record<string, unknown>>;
  pendingPlayers: Array<Record<string, unknown>>;
  matches: Array<Record<string, unknown>>;
  reports: Array<Record<string, unknown>>;
  readiness: Array<Record<string, unknown>>;
  attendance: Array<Record<string, unknown>>;
  injuries: Array<Record<string, unknown>>;
  peerRatingStats: Record<string, { count: number; totalScore: number }>;
  peerRatings: Array<Record<string, unknown>>;
  adminRatings: Array<Record<string, unknown>>;
  tactics: { formation: string; slots: Record<string, string> };
  suggestions: Array<Record<string, unknown>>;
  pitchSession?: Record<string, unknown>;
  pitchPayments?: Array<Record<string, unknown>>;
  matchSessions?: Array<Record<string, unknown>>;
  matchVoteTallies?: Array<Record<string, unknown>>;
  missionClaims?: Array<Record<string, unknown>>;
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
    return onAuthStateChanged(auth, cb);
  }

  async signInWithGoogle(): Promise<User> {
    const cred = await signInWithPopup(auth, googleProvider);
    return cred.user;
  }

  async signOut(): Promise<void> {
    this.stopListeners();
    this.activeUid = null;
    this.activeIsCaptain = false;
    this.activeState = null;
    this.activeOnUpdate = null;
    this.activeOnError = null;
    await signOut(auth);
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
      if (typeof localStorage === 'undefined') return;
      const leanPlayers = (state.players || []).map((p) => {
        const copy = { ...p };
        delete copy.photo;
        return copy;
      });
      localStorage.setItem(
        TEAM_CACHE_KEY,
        JSON.stringify({
          settings: state.settings || {},
          players: leanPlayers,
          pitchSession: state.pitchSession || null,
          cachedAt: Date.now(),
        })
      );
    } catch {
      // Ignore storage quota errors
    }
  }

  loadTeamSnapshotCache(): {
    settings?: Record<string, unknown>;
    players?: Array<Record<string, unknown>>;
    pitchSession?: Record<string, unknown> | null;
    cachedAt?: number;
  } | null {
    try {
      if (typeof localStorage === 'undefined') return null;
      const raw = localStorage.getItem(TEAM_CACHE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
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
    branding?: Record<string, unknown>;
    joinRequest?: Record<string, unknown>;
  }> {
    this.activeUid = fbUser.uid;
    let isCaptain = false;

    // Captain identity is strictly verified via trusted admins/{uid} document ONLY
    if (fbUser.emailVerified) {
      try {
        const admSnap = await getDoc(doc(db, 'admins', fbUser.uid));
        quotaMonitor.recordReads('session', 1);
        isCaptain = admSnap.exists();
      } catch (err) {
        if (isQuotaExceededError(err)) {
          quotaMonitor.markQuotaExceeded(true);
          throw new Error(QUOTA_EXCEEDED_ARABIC_MSG);
        }
        isCaptain = false;
      }
    }
    this.activeIsCaptain = isCaptain;

    if (isCaptain) {
      await this.bootstrapCaptainWorkspace(fbUser);
      return { status: 'ready', isCaptain: true };
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
      return { status: 'ready', isCaptain: false };
    }

    // Fetch public branding for join/pending screens
    let branding: Record<string, unknown> | undefined;
    try {
      const bSnap = await getDoc(doc(db, 'publicMeta', 'branding'));
      if (bSnap.exists()) branding = bSnap.data();
    } catch {
      // Optional before team initialization
    }

    // Check existing join request
    try {
      const jrSnap = await getDoc(doc(db, 'joinRequests', fbUser.uid));
      if (jrSnap.exists()) {
        const jr = jrSnap.data();
        if (jr.status === 'pending') {
          return { status: 'pending', isCaptain: false, branding, joinRequest: jr };
        }
        if (jr.status === 'rejected') {
          return { status: 'rejected', isCaptain: false, branding, joinRequest: jr };
        }
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, `joinRequests/${fbUser.uid}`);
    }

    return { status: 'needs_join', isCaptain: false, branding };
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
      const initialCode = generateSecureInviteCode(12);
      const batch = writeBatch(db);
      batch.set(settingsRef, {
        teamId: TEAM_ID,
        appName: 'ميدان 6v6',
        teamName: 'فريق السداسي',
        primaryColor: ROYAL_PRIMARY,
        secondaryColor: ROYAL_SECONDARY,
        logo: '',
        inviteCode: initialCode,
        requireApproval: true,
        lockSkills: false,
        themeVersion: 'royal_v2',
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
      const displayName = clampStr(fbUser.displayName || 'الكابتن', 80) || 'الكابتن';
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

  async submitJoinWithCode(input: {
    inviteCode: string;
    name: string;
    jersey: number;
    primaryPos: string;
    stats6?: Record<string, unknown>;
    roleOverride?: string;
  }): Promise<{ joinedDirectly: boolean }> {
    const fbUser = auth.currentUser;
    if (!fbUser || !fbUser.emailVerified) {
      throw new Error('يرجى تسجيل الدخول بحساب Google أولاً');
    }

    const code = sanitizeInviteCode(input.inviteCode);
    if (!code) throw new Error('كود الدعوة غير صالح (يجب أن يكون 8 خانات على الأقل)');

    let codeSnap;
    try {
      codeSnap = await getDoc(doc(db, 'inviteCodes', code));
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, `inviteCodes/${code}`);
    }

    if (!codeSnap.exists() || !codeSnap.data().active) {
      throw new Error('كود الدعوة غير صحيح أو منتهي الصلاحية');
    }

    const requireApproval = Boolean(codeSnap.data().requireApproval);
    const cleanName = clampStr(input.name || fbUser.displayName || 'لاعب جديد', 80) || 'لاعب جديد';
    const cleanJersey = Math.round(clampNum(input.jersey, 1, 99, 7));
    const cleanPos = sanitizePrimaryPos(input.primaryPos);
    const cleanStats6 = sanitizeStats6(input.stats6);
    const cleanRoleOverride = sanitizeRoleOverride(input.roleOverride);

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
      try {
        await setDoc(doc(db, 'joinRequests', fbUser.uid), jrDoc);
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, `joinRequests/${fbUser.uid}`);
      }
      return { joinedDirectly: false };
    }

    // Direct join: atomic batch writing approved joinRequest + player doc
    const batch = writeBatch(db);
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
    batch.set(doc(db, 'joinRequests', fbUser.uid), jrApprovedDoc);

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
    batch.set(doc(db, 'players', fbUser.uid), playerDoc);
    try {
      await batch.commit();
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `players/${fbUser.uid}`);
    }
    return { joinedDirectly: true };
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
    } catch {
      // Non-fatal; ready tab also subscribes live when opened
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
        } catch {
          // Locked (count < 2) or not yet voted for this target — safely ignore
        }
      });
      await Promise.all(fetches);
    }
    targetState.matchVoteTallies = tallies;
    if (this.activeOnUpdate) this.activeOnUpdate();
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

    // Hydrate non-sensitive local cache first so UI stays resilient on slow 3G / quota limits
    const cached = this.loadTeamSnapshotCache();
    if (cached) {
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
            state.settings = { ...snap.data() };
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

    switch (tabId) {
      case 'fifa': {
        subReports();
        // One-shot non-realtime fetch of aggregated peer stats + attendance commitment on screen open
        void this.refreshPeerRatingStats(state);
        void this.refreshAttendance(state);
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
                };
                onUpdate();
              }
            },
            handleErr(OperationType.GET, 'tactics/current')
          )
        );
        // Load all player portraits only when opening Tactical Studio (for Poster & Mini Cards)
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
        break;
      }
      case 'ready': {
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
      case 'profile': {
        const playerId = String(currentUser.id || uid);
        const ref = doc(db, 'players', playerId);
        const updateData: Record<string, unknown> = {
          name: clampStr(payload.name ?? currentUser.name, 80) || 'لاعب',
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
          handleFirestoreError(err, OperationType.CREATE, `players/${id}`);
        }
        return;
      }

      case 'approvePlayer': {
        const applicantUid = String(payload.uid || payload.id || '');
        if (!applicantUid) throw new Error('معرّف الطلب غير صالح');
        const cleanStats6 = sanitizeStats6(payload.stats6);
        const cleanRoleOverride = sanitizeRoleOverride(payload.roleOverride);
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
        batch.set(doc(db, 'players', applicantUid), newPlayerDoc);
        try {
          await batch.commit();
        } catch (err) {
          handleFirestoreError(err, OperationType.WRITE, `joinRequests/${applicantUid}`);
        }
        return;
      }

      case 'rejectPlayer': {
        const applicantUid = String(payload.id || payload.uid || '');
        if (!applicantUid) return;
        try {
          await updateDoc(doc(db, 'joinRequests', applicantUid), {
            status: 'rejected',
            updatedAt: serverTimestamp(),
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.UPDATE, `joinRequests/${applicantUid}`);
        }
        return;
      }

      case 'attendance': {
        const id = makeId('att');
        try {
          await setDoc(doc(db, 'attendance', id), {
            teamId: TEAM_ID,
            playerId: String(currentUser.id || uid),
            ownerUid: uid,
            playerName: clampStr(payload.playerName || currentUser.name, 80) || 'لاعب',
            date: sanitizeDateStr(payload.date),
            type: clampStr(payload.type || 'مباراة', 40) || 'مباراة',
            status: payload.status === 'ما فيني' ? 'ما فيني' : 'جاي',
            createdAt: serverTimestamp(),
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.CREATE, `attendance/${id}`);
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
          handleFirestoreError(err, OperationType.CREATE, `matches/${id}`);
        }
        return;
      }

      case 'report': {
        const id = makeId('rep');
        const reportDoc: Record<string, unknown> = {
          teamId: TEAM_ID,
          playerId: String(currentUser.id || uid),
          ownerUid: uid,
          opponent: clampStr(payload.opponent, 80) || 'خصم',
          goals: Math.round(clampNum(payload.goals, 0, 30, 0)),
          assists: Math.round(clampNum(payload.assists, 0, 30, 0)),
          minutes: Math.round(clampNum(payload.minutes, 1, 180, 50)),
          interceptions: Math.round(clampNum(payload.interceptions, 0, 60, 0)),
          turnovers: Math.round(clampNum(payload.turnovers, 0, 60, 0)),
          rating: Math.round(clampNum(payload.rating, 1, 10, 8)),
          rpe: Math.round(clampNum(payload.rpe, 1, 10, 7)),
          bestMoment: clampStr(payload.bestMoment, 200),
          worstMoment: clampStr(payload.worstMoment, 200),
          motmVote: clampStr(payload.motmVote, 128),
          pitchMode: sanitizePitchMode(payload.pitchMode),
          matchResult: sanitizeMatchResult(payload.matchResult),
          goalsConceded: Math.round(clampNum(payload.goalsConceded, 0, 30, 0)),
          createdAt: serverTimestamp(),
        };
        const sid = String(payload.matchSessionId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 128);
        if (sid) reportDoc.matchSessionId = sid;
        try {
          await setDoc(doc(db, 'reports', id), reportDoc);
        } catch (err) {
          handleFirestoreError(err, OperationType.CREATE, `reports/${id}`);
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
          handleFirestoreError(err, OperationType.WRITE, `peerRatings/${ballotId}`);
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
        try {
          await setDoc(doc(db, 'tactics', 'current'), {
            teamId: TEAM_ID,
            formation: sanitizeFormation(payload.formation),
            slots,
            updatedAt: serverTimestamp(),
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.WRITE, 'tactics/current');
        }
        return;
      }

      case 'settings': {
        const appName = clampStr(payload.appName || 'ميدان 6v6', 60) || 'ميدان 6v6';
        const teamName = clampStr(payload.teamName || 'فريق السداسي', 80) || 'فريق السداسي';
        const primaryColor = sanitizeHexColor(payload.primaryColor, ROYAL_PRIMARY);
        const secondaryColor = sanitizeHexColor(payload.secondaryColor, ROYAL_SECONDARY);
        const logo = sanitizeImageDataUrl(payload.logo, 180000);
        const inviteCode = sanitizeInviteCode(payload.inviteCode);
        if (!inviteCode) {
          throw new Error('كود الدعوة غير صالح (يجب أن يكون 8 خانات على الأقل)');
        }
        const requireApproval = payload.requireApproval !== false;
        const lockSkills = Boolean(payload.lockSkills);
        const prevCode = payload.prevInviteCode
          ? sanitizeInviteCode(payload.prevInviteCode)
          : '';

        const batch = writeBatch(db);
        batch.set(doc(db, 'settings', 'team'), {
          teamId: TEAM_ID,
          appName,
          teamName,
          primaryColor,
          secondaryColor,
          logo,
          inviteCode,
          requireApproval,
          lockSkills,
          themeVersion: 'royal_v2',
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
        batch.set(doc(db, 'inviteCodes', inviteCode), {
          code: inviteCode,
          active: true,
          requireApproval,
          updatedAt: serverTimestamp(),
        });
        if (prevCode && prevCode !== inviteCode) {
          batch.delete(doc(db, 'inviteCodes', prevCode));
        }
        try {
          await batch.commit();
        } catch (err) {
          handleFirestoreError(err, OperationType.WRITE, 'settings/team');
        }
        return;
      }

      case 'rotateInviteCode': {
        if (!this.activeIsCaptain) {
          throw new Error('تدوير كود الدعوة متاح للكابتن فقط');
        }
        const newCode = generateSecureInviteCode(12);
        const prevCode = payload.prevInviteCode
          ? sanitizeInviteCode(payload.prevInviteCode)
          : '';
        const requireApproval = payload.requireApproval !== false;

        const batch = writeBatch(db);
        batch.update(doc(db, 'settings', 'team'), {
          inviteCode: newCode,
          updatedAt: serverTimestamp(),
        });
        batch.set(doc(db, 'inviteCodes', newCode), {
          code: newCode,
          active: true,
          requireApproval,
          updatedAt: serverTimestamp(),
        });
        if (prevCode && prevCode !== newCode) {
          batch.delete(doc(db, 'inviteCodes', prevCode));
        }
        try {
          await batch.commit();
        } catch (err) {
          handleFirestoreError(err, OperationType.WRITE, `inviteCodes/${newCode}`);
        }
        return { inviteCode: newCode };
      }

      case 'updateRole': {
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
          handleFirestoreError(err, OperationType.WRITE, `players/${targetId}`);
        }
        return;
      }

      case 'pitchSession': {
        if (!this.activeIsCaptain) {
          throw new Error('تعديل موعد المباراة والقَطّة متاح للكابتن فقط');
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
        if (!this.activeIsCaptain) {
          throw new Error('تحديث حالة دفع القَطّة متاح للكابتن فقط');
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

    ops.push((b) => {
      b.set(doc(db, 'settings', 'team'), {
        teamId: TEAM_ID,
        ...clean.settings,
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

    for (const r of clean.reports) {
      ops.push((b) => {
        b.set(doc(db, 'reports', String(r.id)), {
          teamId: TEAM_ID,
          playerId: r.playerId,
          ownerUid: String(r.ownerUid || ''),
          opponent: r.opponent,
          goals: r.goals,
          assists: r.assists,
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
          goalsConceded: Math.round(clampNum(r.goalsConceded, 0, 30, 0)),
          createdAt: serverTimestamp(),
        });
      });
    }

    for (const a of clean.attendance) {
      ops.push((b) => {
        b.set(doc(db, 'attendance', String(a.id)), {
          teamId: TEAM_ID,
          playerId: a.playerId,
          ownerUid: String(a.ownerUid || ''),
          playerName: a.playerName,
          date: a.date,
          type: a.type,
          status: a.status,
          createdAt: serverTimestamp(),
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

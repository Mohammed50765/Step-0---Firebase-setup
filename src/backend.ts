import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import {
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
  CAPTAIN_EMAIL,
  db,
  googleProvider,
  handleFirestoreError,
  OperationType,
  testConnection,
} from './firebase';
import {
  clampNum,
  clampStr,
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
  sanitizePrimaryPos,
  sanitizeSecondaryPos,
  sanitizeSkills,
  sanitizeStarId,
  TEAM_ID,
} from './security';

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
}

function makeId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function isBootstrappedCaptainUser(fbUser: User | null): boolean {
  return Boolean(
    fbUser &&
      fbUser.emailVerified &&
      fbUser.email &&
      fbUser.email.toLowerCase() === CAPTAIN_EMAIL.toLowerCase()
  );
}

class MaydanBackendService {
  private unsubs: Unsubscribe[] = [];
  private activeUid: string | null = null;
  private activeIsCaptain = false;
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
    await signOut(auth);
  }

  stopListeners(): void {
    for (const u of this.unsubs) {
      try {
        u();
      } catch {
        // ignore unsubscribe cleanup errors
      }
    }
    this.unsubs = [];
  }

  async resolveSession(fbUser: User): Promise<{
    status: 'ready' | 'pending' | 'rejected' | 'needs_join';
    isCaptain: boolean;
    branding?: Record<string, unknown>;
    joinRequest?: Record<string, unknown>;
  }> {
    this.activeUid = fbUser.uid;
    let isCaptain = isBootstrappedCaptainUser(fbUser);

    if (!isCaptain) {
      try {
        const admSnap = await getDoc(doc(db, 'admins', fbUser.uid));
        if (admSnap.exists()) isCaptain = true;
      } catch {
        // Non-captains may not have an admin record
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
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, `players/${fbUser.uid}`);
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
      const defaultCode = 'MDN-606';
      const batch = writeBatch(db);
      batch.set(settingsRef, {
        teamId: TEAM_ID,
        appName: 'ميدان 6v6',
        teamName: 'فريق السداسي',
        primaryColor: ROYAL_PRIMARY,
        secondaryColor: ROYAL_SECONDARY,
        logo: '',
        inviteCode: defaultCode,
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
      batch.set(doc(db, 'inviteCodes', defaultCode), {
        code: defaultCode,
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
  }): Promise<{ joinedDirectly: boolean }> {
    const fbUser = auth.currentUser;
    if (!fbUser || !fbUser.emailVerified) {
      throw new Error('يرجى تسجيل الدخول بحساب Google أولاً');
    }

    const code = sanitizeInviteCode(input.inviteCode, '');
    if (!code) throw new Error('كود الدعوة غير صالح');

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

    if (requireApproval) {
      try {
        await setDoc(doc(db, 'joinRequests', fbUser.uid), {
          uid: fbUser.uid,
          name: cleanName,
          jersey: cleanJersey,
          primaryPos: cleanPos,
          inviteCode: code,
          status: 'pending',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, `joinRequests/${fbUser.uid}`);
      }
      return { joinedDirectly: false };
    }

    // Direct join: atomic batch writing approved joinRequest + player doc
    const batch = writeBatch(db);
    batch.set(doc(db, 'joinRequests', fbUser.uid), {
      uid: fbUser.uid,
      name: cleanName,
      jersey: cleanJersey,
      primaryPos: cleanPos,
      inviteCode: code,
      status: 'approved',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(db, 'players', fbUser.uid), {
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
      skills: sanitizeSkills({
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
    });
    try {
      await batch.commit();
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `players/${fbUser.uid}`);
    }
    return { joinedDirectly: true };
  }

  subscribeTeamData(
    uid: string,
    isCaptain: boolean,
    state: BackendState,
    onUpdate: () => void,
    onError: (msg: string) => void
  ): void {
    this.stopListeners();
    this.activeUid = uid;
    this.activeIsCaptain = isCaptain;
    this.photosMap = {};

    const handleErr = (op: OperationType, path: string) => (err: unknown) => {
      onError('تعذّر تحديث بعض البيانات من الخادم.');
      try {
        handleFirestoreError(err, op, path);
      } catch {
        // Logged by handleFirestoreError
      }
    };

    const mergePhotosIntoPlayers = () => {
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
    };

    // 1. Settings
    this.unsubs.push(
      onSnapshot(
        doc(db, 'settings', 'team'),
        (snap) => {
          if (snap.exists()) {
            state.settings = { ...snap.data() };
            onUpdate();
          }
        },
        handleErr(OperationType.GET, 'settings/team')
      )
    );

    // 2. Players
    this.unsubs.push(
      onSnapshot(
        query(collection(db, 'players'), where('teamId', '==', TEAM_ID)),
        (snap) => {
          state.players = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          mergePhotosIntoPlayers();
          onUpdate();
        },
        handleErr(OperationType.LIST, 'players')
      )
    );

    // 3. Player Photos (stored separately to keep /players lean)
    this.unsubs.push(
      onSnapshot(
        query(collection(db, 'playerPhotos'), where('teamId', '==', TEAM_ID)),
        (snap) => {
          const nextMap: Record<string, { dataUrl: string; photoZoom: number; photoY: number }> = {};
          snap.docs.forEach((d) => {
            const data = d.data();
            nextMap[d.id] = {
              dataUrl: sanitizeImageDataUrl(data.dataUrl, 250000),
              photoZoom: Number(data.photoZoom || 105),
              photoY: typeof data.photoY === 'number' ? data.photoY : 18,
            };
          });
          this.photosMap = nextMap;
          mergePhotosIntoPlayers();
          onUpdate();
        },
        handleErr(OperationType.LIST, 'playerPhotos')
      )
    );

    // 4. Attendance
    this.unsubs.push(
      onSnapshot(
        query(collection(db, 'attendance'), where('teamId', '==', TEAM_ID)),
        (snap) => {
          state.attendance = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          onUpdate();
        },
        handleErr(OperationType.LIST, 'attendance')
      )
    );

    // 5. Matches
    this.unsubs.push(
      onSnapshot(
        query(collection(db, 'matches'), where('teamId', '==', TEAM_ID)),
        (snap) => {
          state.matches = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          onUpdate();
        },
        handleErr(OperationType.LIST, 'matches')
      )
    );

    // 6. Reports
    this.unsubs.push(
      onSnapshot(
        query(collection(db, 'reports'), where('teamId', '==', TEAM_ID)),
        (snap) => {
          state.reports = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          onUpdate();
        },
        handleErr(OperationType.LIST, 'reports')
      )
    );

    // 7. Suggestions
    this.unsubs.push(
      onSnapshot(
        query(collection(db, 'suggestions'), where('teamId', '==', TEAM_ID)),
        (snap) => {
          state.suggestions = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          onUpdate();
        },
        handleErr(OperationType.LIST, 'suggestions')
      )
    );

    // 8. Tactics
    this.unsubs.push(
      onSnapshot(
        doc(db, 'tactics', 'current'),
        (snap) => {
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

    // 9. Aggregated Peer Rating Stats (ONLY count >= 3 enforced server-side!)
    this.unsubs.push(
      onSnapshot(
        query(
          collection(db, 'peerRatingStats'),
          where('teamId', '==', TEAM_ID),
          where('count', '>=', 3)
        ),
        (snap) => {
          const statsMap: Record<string, { count: number; totalScore: number }> = {};
          snap.docs.forEach((d) => {
            const data = d.data();
            statsMap[d.id] = {
              count: Number(data.count || 0),
              totalScore: Number(data.totalScore || 0),
            };
          });
          state.peerRatingStats = statsMap;
          onUpdate();
        },
        handleErr(OperationType.LIST, 'peerRatingStats')
      )
    );

    // 10. Admin Ratings
    this.unsubs.push(
      onSnapshot(
        query(collection(db, 'adminRatings'), where('teamId', '==', TEAM_ID)),
        (snap) => {
          state.adminRatings = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          onUpdate();
        },
        handleErr(OperationType.LIST, 'adminRatings')
      )
    );

    // 11. PRIVATE Readiness (Players query ONLY own ownerUid; Captain queries team)
    const readinessQuery = isCaptain
      ? query(collection(db, 'readiness'), where('teamId', '==', TEAM_ID))
      : query(collection(db, 'readiness'), where('ownerUid', '==', uid));
    this.unsubs.push(
      onSnapshot(
        readinessQuery,
        (snap) => {
          state.readiness = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          onUpdate();
        },
        handleErr(OperationType.LIST, 'readiness')
      )
    );

    // 12. PRIVATE Injuries (Players query ONLY own ownerUid; Captain queries team)
    const injuriesQuery = isCaptain
      ? query(collection(db, 'injuries'), where('teamId', '==', TEAM_ID))
      : query(collection(db, 'injuries'), where('ownerUid', '==', uid));
    this.unsubs.push(
      onSnapshot(
        injuriesQuery,
        (snap) => {
          state.injuries = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          onUpdate();
        },
        handleErr(OperationType.LIST, 'injuries')
      )
    );

    // 13. Pending Join Requests (Captain ONLY)
    if (isCaptain) {
      this.unsubs.push(
        onSnapshot(
          query(collection(db, 'joinRequests'), where('status', '==', 'pending')),
          (snap) => {
            state.pendingPlayers = snap.docs
              .slice(0, MAX_PENDING_JOIN_REQUESTS)
              .map((d) => ({ id: d.id, ...d.data() }));
            onUpdate();
          },
          handleErr(OperationType.LIST, 'joinRequests')
        )
      );
    }
  }

  async dispatchAction(
    action: string,
    payload: Record<string, unknown>,
    currentUser: Record<string, unknown>
  ): Promise<void> {
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
        const batch = writeBatch(db);
        batch.update(doc(db, 'joinRequests', applicantUid), {
          status: 'approved',
          updatedAt: serverTimestamp(),
        });
        batch.set(doc(db, 'players', applicantUid), {
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
          skills: sanitizeSkills({
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
        });
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
        try {
          await setDoc(doc(db, 'reports', id), {
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
            createdAt: serverTimestamp(),
          });
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
        const inviteCode = sanitizeInviteCode(payload.inviteCode, 'MDN-606');
        const requireApproval = Boolean(payload.requireApproval);
        const lockSkills = Boolean(payload.lockSkills);
        const prevCode = payload.prevInviteCode
          ? sanitizeInviteCode(payload.prevInviteCode, '')
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

      case 'importBackup': {
        if (!this.activeIsCaptain) {
          throw new Error('استيراد النسخة الاحتياطية متاح للكابتن فقط');
        }
        const clean = sanitizeBackupImport(payload.raw);
        await this.importCleanBackupToFirestore(clean, uid);
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
    };
  }
}

import {
  computePeerAggregate,
  escapeHtml,
} from './security';

window.MaydanBackend = backend;
window.MaydanSecurity = {
  escapeHtml,
  sanitizeImageDataUrl,
  sanitizeBackupImport,
  computePeerAggregate,
};

backend.init();

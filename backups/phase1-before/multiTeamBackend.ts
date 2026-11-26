import { type User } from 'firebase/auth';
import {
  arrayRemove,
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
import { db, handleFirestoreError, OperationType } from './firebase';
import {
  clampNum,
  clampStr,
  generateSecureInviteCode,
  ROYAL_PRIMARY,
  ROYAL_SECONDARY,
  sanitizeDateStr,
  sanitizeFoot,
  sanitizeFormation,
  sanitizeHexColor,
  sanitizeImageDataUrl,
  sanitizeMatchResult,
  sanitizePitchMode,
  sanitizePrimaryPos,
  sanitizeRoleOverride,
  sanitizeSecondaryPos,
  sanitizeSkills,
  sanitizeStarId,
  sanitizeStats6,
  stats6ToLegacySkills,
} from './security';
import {
  applyReportConfirmation,
  canPublishTeamLineup,
  evaluateReportSubmissionGuard,
  MAX_ASSISTS_PER_MATCH,
  MAX_GOALS_PER_MATCH,
  normalizeAttendanceStatus,
  normalizeJoinCode,
  type LineupPermissionMode,
  type LineupVoteChoice,
} from './teamMultiplayer';
import { resolveEffectivePlayerName, sanitizePlayerDisplayName } from './authFlow';
import { isQuotaExceededError, QUOTA_EXCEEDED_ARABIC_MSG, quotaMonitor } from './quotaMonitor';
import type { BackendState } from './backend';

export interface MultiTeamSummary {
  id: string;
  name: string;
  logo?: string;
  primaryColor?: string;
  secondaryColor?: string;
  createdBy: string;
  organizerUids: string[];
  memberUids: string[];
  memberCount: number;
  inviteCode: string;
  lineupPermission: LineupPermissionMode;
  defaultCurrency: string;
  defaultPitchCost: number;
  tactics?: Record<string, unknown>;
  lineupVotes?: Record<string, string>;
  pitchSession?: Record<string, unknown>;
}

function makeMultiId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function sanitizeTimeStr(raw: unknown, fallback = '20:30'): string {
  const s = String(raw || '').trim();
  return /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(s) ? s : fallback;
}

export class MultiTeamFirestoreService {
  private unsubs: Unsubscribe[] = [];
  private activeTeamId: string | null = null;
  private activeUid: string | null = null;
  private activeTeamDoc: MultiTeamSummary | null = null;
  private lastReportAtMs = 0;

  getActiveTeamId(): string | null {
    return this.activeTeamId;
  }

  getActiveTeam(): MultiTeamSummary | null {
    return this.activeTeamDoc;
  }

  getLastReportAtMs(): number {
    return this.lastReportAtMs;
  }

  stop(): void {
    for (const u of this.unsubs) {
      try {
        u();
      } catch {
        // ignore
      }
    }
    this.unsubs = [];
    this.activeTeamId = null;
    this.activeTeamDoc = null;
    this.activeUid = null;
    quotaMonitor.setActiveListeners(0);
  }

  private wrapWriteError(err: unknown, op: OperationType, path: string): never {
    if (isQuotaExceededError(err)) {
      quotaMonitor.markQuotaExceeded(true);
      throw new Error(QUOTA_EXCEEDED_ARABIC_MSG);
    }
    handleFirestoreError(err, op, path);
  }

  async listUserTeams(fbUser: User): Promise<{
    teams: MultiTeamSummary[];
    activeTeamId: string;
    lastReportAtMs: number;
  }> {
    const uid = fbUser.uid;
    let activeTeamId = '';
    let lastReportAtMs = 0;

    try {
      const userSnap = await getDoc(doc(db, 'users', uid));
      quotaMonitor.recordReads('session', 1);
      if (userSnap.exists()) {
        const uData = userSnap.data();
        activeTeamId = String(uData.activeTeamId || '');
        lastReportAtMs = Number(uData.lastReportAtMs || 0);
      }
    } catch {
      // Non-fatal on first login before user doc exists
    }
    this.lastReportAtMs = lastReportAtMs;

    let teams: MultiTeamSummary[] = [];
    try {
      const snap = await getDocs(
        query(collection(db, 'teams'), where('memberUids', 'array-contains', uid))
      );
      quotaMonitor.recordReads('session', Math.max(1, snap.size));
      teams = snap.docs.map((d) => {
        const raw = d.data();
        return {
          id: d.id,
          name: String(raw.name || 'فريق السداسي'),
          logo: String(raw.logo || ''),
          primaryColor: String(raw.primaryColor || ROYAL_PRIMARY),
          secondaryColor: String(raw.secondaryColor || ROYAL_SECONDARY),
          createdBy: String(raw.createdBy || ''),
          organizerUids: Array.isArray(raw.organizerUids) ? raw.organizerUids.map(String) : [],
          memberUids: Array.isArray(raw.memberUids) ? raw.memberUids.map(String) : [],
          memberCount: Number(raw.memberCount || (Array.isArray(raw.memberUids) ? raw.memberUids.length : 1)),
          inviteCode: String(raw.inviteCode || ''),
          lineupPermission: raw.lineupPermission === 'organizers' ? 'organizers' : 'all',
          defaultCurrency: String(raw.defaultCurrency || 'ريال'),
          defaultPitchCost: Number(raw.defaultPitchCost || 0),
          tactics: (raw.tactics && typeof raw.tactics === 'object' ? raw.tactics : undefined) as Record<string, unknown> | undefined,
          lineupVotes: (raw.lineupVotes && typeof raw.lineupVotes === 'object' ? raw.lineupVotes : {}) as Record<string, string>,
          pitchSession: (raw.pitchSession && typeof raw.pitchSession === 'object' ? raw.pitchSession : undefined) as Record<string, unknown> | undefined,
        };
      });
    } catch (err) {
      if (isQuotaExceededError(err)) {
        quotaMonitor.markQuotaExceeded(true);
        throw new Error(QUOTA_EXCEEDED_ARABIC_MSG);
      }
      console.warn('listUserTeams query error:', err);
    }

    if (activeTeamId && !teams.some((t) => t.id === activeTeamId)) {
      activeTeamId = teams[0]?.id || '';
    } else if (!activeTeamId && teams.length > 0) {
      activeTeamId = teams[0].id;
    }

    return { teams, activeTeamId, lastReportAtMs };
  }

  async createMultiTeam(
    fbUser: User,
    input: {
      name: string;
      formation?: string;
      primaryColor?: string;
      defaultCurrency?: string;
      defaultPitchCost?: number;
      lineupPermission?: LineupPermissionMode;
      jersey?: number;
      primaryPos?: string;
      playerName?: string;
    }
  ): Promise<{ teamId: string; inviteCode: string; team: MultiTeamSummary }> {
    const uid = fbUser.uid;
    const teamName = clampStr(input.name, 80);
    if (teamName.length < 2) {
      throw new Error('أدخل اسم الفريق (حرفان على الأقل)');
    }
    const teamId = makeMultiId('team');
    const inviteCode = generateSecureInviteCode(12);
    const primaryColor = sanitizeHexColor(input.primaryColor, ROYAL_PRIMARY);
    const defaultCurrency = clampStr(input.defaultCurrency || 'ريال', 20) || 'ريال';
    const defaultPitchCost = Math.max(0, Math.round(clampNum(input.defaultPitchCost, 0, 100000, 0) * 10) / 10);
    const lineupPermission: LineupPermissionMode =
      input.lineupPermission === 'organizers' ? 'organizers' : 'all';
    const formation = sanitizeFormation(input.formation || '2-2-1');
    const { name: effectiveName } = resolveEffectivePlayerName({
      savedName: input.playerName || '',
      googleDisplayName: fbUser.displayName,
      email: fbUser.email,
      fallback: 'منشئ الفريق',
    });

    // Load existing user teamIds so users/{uid} stays cleanly validated
    let prevTeamIds: string[] = [];
    let prevLastRep = this.lastReportAtMs;
    try {
      const uSnap = await getDoc(doc(db, 'users', uid));
      if (uSnap.exists()) {
        const d = uSnap.data();
        prevTeamIds = Array.isArray(d.teamIds) ? d.teamIds.map(String) : [];
        prevLastRep = Number(d.lastReportAtMs || 0);
      }
    } catch {
      // First-time user doc
    }
    const nextTeamIds = Array.from(new Set([...prevTeamIds, teamId])).slice(0, 20);
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

    const teamDocData = {
      id: teamId,
      name: teamName,
      logo: '',
      primaryColor,
      secondaryColor: ROYAL_SECONDARY,
      createdBy: uid,
      organizerUids: [uid],
      memberUids: [uid],
      memberCount: 1,
      inviteCode,
      lineupPermission,
      defaultCurrency,
      defaultPitchCost,
      tactics: {
        formation,
        slots: {},
        publishedByUid: uid,
        publishedByName: effectiveName,
        publishedAtMs: Date.now(),
      },
      lineupVotes: {},
      pitchSession: {
        teamId,
        title: 'مباراة السداسي القادمة',
        matchDate: tomorrow,
        matchTime: '20:30',
        venue: '',
        totalCost: defaultPitchCost,
        currency: defaultCurrency,
        confirmedCount: 0,
        paidCount: 0,
        paidTotal: 0,
      },
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    const batch = writeBatch(db);
    batch.set(doc(db, 'teams', teamId), teamDocData);
    batch.set(doc(db, 'teams', teamId, 'members', uid), {
      id: uid,
      teamId,
      ownerUid: uid,
      name: effectiveName,
      role: 'creator',
      jersey: Math.round(clampNum(input.jersey, 1, 99, 10)),
      age: 20,
      height: 175,
      weight: 70,
      foot: 'يمين',
      primaryPos: sanitizePrimaryPos(input.primaryPos || 'لاعب وسط'),
      secondaryPos: 'لا يوجد',
      photoUrl: String(fbUser.photoURL || '').slice(0, 500),
      photoZoom: 105,
      photoY: 18,
      hasPhoto: Boolean(fbUser.photoURL),
      skills: sanitizeSkills({
        speed: 7,
        shooting: 7,
        passing: 7,
        dribbling: 7,
        defending: 6,
        stamina: 7,
        vision: 7,
        teamwork: 8,
        control: 7,
        positioning: 7,
      }),
      top3Strengths: '',
      weak3Points: '',
      seasonGoal: '',
      availability: '',
      availableStatus: 'available',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(db, 'inviteCodes', inviteCode), {
      code: inviteCode,
      active: true,
      requireApproval: false,
      teamId,
      teamName,
      appName: 'ميدان 6v6',
      primaryColor,
      memberCount: 1,
      usageType: 'multi',
      maxUses: 100,
      usedCount: 0,
      status: 'active',
      createdBy: uid,
      createdAtMs: Date.now(),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(db, 'users', uid), {
      uid,
      displayName: effectiveName,
      photoUrl: String(fbUser.photoURL || '').slice(0, 400),
      activeTeamId: teamId,
      teamIds: nextTeamIds,
      lastReportAtMs: prevLastRep,
      updatedAt: serverTimestamp(),
    });

    try {
      await batch.commit();
    } catch (err) {
      this.wrapWriteError(err, OperationType.WRITE, `teams/${teamId}`);
    }

    return {
      teamId,
      inviteCode,
      team: {
        id: teamId,
        name: teamName,
        logo: '',
        primaryColor,
        secondaryColor: ROYAL_SECONDARY,
        createdBy: uid,
        organizerUids: [uid],
        memberUids: [uid],
        memberCount: 1,
        inviteCode,
        lineupPermission,
        defaultCurrency,
        defaultPitchCost,
        tactics: teamDocData.tactics,
        lineupVotes: {},
        pitchSession: teamDocData.pitchSession,
      },
    };
  }

  async inspectInviteCodeForJoin(rawCode: string): Promise<{
    exists: boolean;
    valid: boolean;
    errorAr?: string;
    teamId?: string;
    teamName?: string;
    memberCount?: number;
    code?: string;
    isLegacySingleTeam?: boolean;
  }> {
    const code = normalizeJoinCode(rawCode);
    if (!code) {
      return {
        exists: false,
        valid: false,
        errorAr: 'صيغة كود الدعوة غير صالحة — تأكد من الأحرف والأرقام وحاول مجدداً.',
      };
    }
    try {
      const snap = await getDoc(doc(db, 'inviteCodes', code));
      quotaMonitor.recordReads('oneShot', 1);
      if (!snap.exists()) {
        return {
          exists: false,
          valid: false,
          errorAr: 'كود الدعوة غير موجود أو غير صحيح — اطلب الكود الصحيح من صديقك.',
        };
      }
      const d = snap.data();
      if (d.active === false || d.status === 'revoked') {
        return {
          exists: true,
          valid: false,
          errorAr: 'تم إلغاء كود الدعوة هذا واستبداله بكود جديد.',
        };
      }
      const teamId = String(d.teamId || 'main');
      return {
        exists: true,
        valid: true,
        code,
        teamId,
        teamName: String(d.teamName || 'فريق السداسي'),
        memberCount: Number(d.memberCount || 1),
        isLegacySingleTeam: teamId === 'main',
      };
    } catch {
      return {
        exists: false,
        valid: false,
        errorAr: 'تعذّر التحقق من كود الدعوة حالياً — تأكد من الاتصال بالإنترنت.',
      };
    }
  }

  async joinMultiTeamByCode(
    fbUser: User,
    rawCode: string,
    profileInput?: {
      name?: string;
      jersey?: number;
      primaryPos?: string;
      stats6?: Record<string, unknown>;
      roleOverride?: string;
    }
  ): Promise<{
    teamId: string;
    teamName: string;
    alreadyMember: boolean;
    isLegacySingleTeam?: boolean;
  }> {
    const uid = fbUser.uid;
    const code = normalizeJoinCode(rawCode);
    if (!code) {
      throw new Error('كود الدعوة غير صالح — تأكد من كتابته بشكل صحيح.');
    }

    const inviteSnap = await getDoc(doc(db, 'inviteCodes', code));
    quotaMonitor.recordReads('oneShot', 1);
    if (!inviteSnap.exists()) {
      throw new Error('كود الدعوة غير صحيح أو غير موجود — تحقق من الكود وحاول مجدداً.');
    }
    const inviteData = inviteSnap.data();
    if (inviteData.active === false || inviteData.status === 'revoked') {
      throw new Error('تم إلغاء كود الدعوة هذا — اطلب الكود الجديد من منشئ الفريق.');
    }

    const teamId = String(inviteData.teamId || 'main');
    const teamName = clampStr(inviteData.teamName || 'فريق السداسي', 80) || 'فريق السداسي';
    if (teamId === 'main') {
      return { teamId: 'main', teamName, alreadyMember: false, isLegacySingleTeam: true };
    }

    // Check if already a member of this team
    let prevTeamIds: string[] = [];
    let prevLastRep = this.lastReportAtMs;
    try {
      const uSnap = await getDoc(doc(db, 'users', uid));
      if (uSnap.exists()) {
        const d = uSnap.data();
        prevTeamIds = Array.isArray(d.teamIds) ? d.teamIds.map(String) : [];
        prevLastRep = Number(d.lastReportAtMs || 0);
      }
    } catch {
      // ignore
    }

    let alreadyMember = false;
    try {
      const existingTeamSnap = await getDoc(doc(db, 'teams', teamId));
      if (existingTeamSnap.exists()) {
        const mUids = Array.isArray(existingTeamSnap.data().memberUids)
          ? existingTeamSnap.data().memberUids.map(String)
          : [];
        if (mUids.includes(uid)) {
          alreadyMember = true;
        }
      }
    } catch {
      // Expected permission-denied when NOT yet a member! Proceed to atomic join.
    }

    const { name: effectiveName } = resolveEffectivePlayerName({
      savedName: profileInput?.name || '',
      googleDisplayName: fbUser.displayName,
      email: fbUser.email,
      fallback: 'لاعب جديد',
    });
    const nextTeamIds = Array.from(new Set([...prevTeamIds, teamId])).slice(0, 20);

    if (alreadyMember) {
      await setDoc(doc(db, 'users', uid), {
        uid,
        displayName: effectiveName,
        photoUrl: String(fbUser.photoURL || '').slice(0, 400),
        activeTeamId: teamId,
        teamIds: nextTeamIds,
        lastReportAtMs: prevLastRep,
        updatedAt: serverTimestamp(),
      });
      return { teamId, teamName, alreadyMember: true };
    }

    const cleanStats6 = sanitizeStats6(profileInput?.stats6);
    const cleanRoleOverride = sanitizeRoleOverride(profileInput?.roleOverride);
    const cleanPos = sanitizePrimaryPos(profileInput?.primaryPos || 'لاعب وسط');
    const cleanJersey = Math.round(clampNum(profileInput?.jersey, 1, 99, Math.floor(Math.random() * 88) + 2));

    const memberDoc: Record<string, unknown> = {
      id: uid,
      teamId,
      ownerUid: uid,
      name: effectiveName,
      role: 'player',
      jersey: cleanJersey,
      age: 19,
      height: 175,
      weight: 70,
      foot: 'يمين',
      primaryPos: cleanPos,
      secondaryPos: 'لا يوجد',
      photoUrl: String(fbUser.photoURL || '').slice(0, 500),
      photoZoom: 105,
      photoY: 18,
      hasPhoto: Boolean(fbUser.photoURL),
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
    if (cleanStats6) memberDoc.stats6 = cleanStats6;
    if (cleanRoleOverride) memberDoc.roleOverride = cleanRoleOverride;

    const batch = writeBatch(db);
    batch.update(doc(db, 'teams', teamId), {
      memberUids: arrayUnion(uid),
      memberCount: increment(1),
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(db, 'teams', teamId, 'members', uid), memberDoc);
    batch.update(doc(db, 'inviteCodes', code), {
      memberCount: increment(1),
      usedCount: increment(1),
      lastUsedBy: uid,
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(db, 'users', uid), {
      uid,
      displayName: effectiveName,
      photoUrl: String(fbUser.photoURL || '').slice(0, 400),
      activeTeamId: teamId,
      teamIds: nextTeamIds,
      lastReportAtMs: prevLastRep,
      updatedAt: serverTimestamp(),
    });

    try {
      await batch.commit();
    } catch (err) {
      this.wrapWriteError(err, OperationType.WRITE, `teams/${teamId}`);
    }

    return { teamId, teamName, alreadyMember: false };
  }

  async switchActiveTeam(fbUser: User, teamId: string): Promise<void> {
    const uid = fbUser.uid;
    let prevTeamIds: string[] = [];
    let prevLastRep = this.lastReportAtMs;
    try {
      const uSnap = await getDoc(doc(db, 'users', uid));
      if (uSnap.exists()) {
        const d = uSnap.data();
        prevTeamIds = Array.isArray(d.teamIds) ? d.teamIds.map(String) : [];
        prevLastRep = Number(d.lastReportAtMs || 0);
      }
    } catch {
      // ignore
    }
    const nextTeamIds = Array.from(new Set([...prevTeamIds, teamId])).slice(0, 20);
    await setDoc(doc(db, 'users', uid), {
      uid,
      displayName: clampStr(fbUser.displayName || 'لاعب', 80) || 'لاعب',
      photoUrl: String(fbUser.photoURL || '').slice(0, 400),
      activeTeamId: teamId,
      teamIds: nextTeamIds,
      lastReportAtMs: prevLastRep,
      updatedAt: serverTimestamp(),
    });
  }

  subscribeTeam(
    uid: string,
    teamId: string,
    state: BackendState,
    onUpdate: () => void,
    onError: (msg: string) => void
  ): void {
    this.stop();
    this.activeUid = uid;
    this.activeTeamId = teamId;

    const handleErr = (op: OperationType, path: string) => (err: unknown) => {
      if (isQuotaExceededError(err)) {
        quotaMonitor.markQuotaExceeded(true);
        onError(QUOTA_EXCEEDED_ARABIC_MSG);
        return;
      }
      console.warn(`MultiTeam listener error (${path}):`, err);
      try {
        handleFirestoreError(err, op, path);
      } catch {
        // already logged
      }
    };

    // 1. Live Team Document (settings, published lineup, lineupVotes, pitchSession)
    this.unsubs.push(
      onSnapshot(
        doc(db, 'teams', teamId),
        (snap) => {
          quotaMonitor.recordReads('core', 1);
          if (!snap.exists()) {
            onError('تم حذف هذا الفريق أو لم يعد متاحاً.');
            return;
          }
          const raw = snap.data();
          const summary: MultiTeamSummary = {
            id: snap.id,
            name: String(raw.name || 'فريق السداسي'),
            logo: String(raw.logo || ''),
            primaryColor: String(raw.primaryColor || ROYAL_PRIMARY),
            secondaryColor: String(raw.secondaryColor || ROYAL_SECONDARY),
            createdBy: String(raw.createdBy || ''),
            organizerUids: Array.isArray(raw.organizerUids) ? raw.organizerUids.map(String) : [],
            memberUids: Array.isArray(raw.memberUids) ? raw.memberUids.map(String) : [],
            memberCount: Number(raw.memberCount || 1),
            inviteCode: String(raw.inviteCode || ''),
            lineupPermission: raw.lineupPermission === 'organizers' ? 'organizers' : 'all',
            defaultCurrency: String(raw.defaultCurrency || 'ريال'),
            defaultPitchCost: Number(raw.defaultPitchCost || 0),
            tactics: (raw.tactics && typeof raw.tactics === 'object' ? raw.tactics : undefined) as Record<string, unknown> | undefined,
            lineupVotes: (raw.lineupVotes && typeof raw.lineupVotes === 'object' ? raw.lineupVotes : {}) as Record<string, string>,
            pitchSession: (raw.pitchSession && typeof raw.pitchSession === 'object' ? raw.pitchSession : undefined) as Record<string, unknown> | undefined,
          };
          this.activeTeamDoc = summary;

          state.settings = {
            teamId: snap.id,
            appName: 'ميدان 6v6',
            teamName: summary.name,
            primaryColor: summary.primaryColor,
            secondaryColor: summary.secondaryColor,
            logo: summary.logo || '',
            inviteCode: summary.inviteCode,
            createdBy: summary.createdBy,
            organizerUids: summary.organizerUids,
            memberUids: summary.memberUids,
            memberCount: summary.memberCount,
            lineupPermission: summary.lineupPermission,
            defaultCurrency: summary.defaultCurrency,
            defaultPitchCost: summary.defaultPitchCost,
            requireApproval: false,
            lockSkills: false,
            themeVersion: 'royal_v2',
          };

          if (summary.tactics) {
            const t = summary.tactics;
            state.tactics = {
              formation: sanitizeFormation(t.formation),
              slots: (t.slots && typeof t.slots === 'object' ? t.slots : {}) as Record<string, string>,
              ...(t.publishedByName ? { publishedByName: String(t.publishedByName) } : {}),
              ...(t.publishedByUid ? { publishedByUid: String(t.publishedByUid) } : {}),
              ...(t.publishedAtMs ? { publishedAtMs: Number(t.publishedAtMs) } : {}),
              votes: summary.lineupVotes || {},
            } as BackendState['tactics'];
          }

          if (summary.pitchSession) {
            state.pitchSession = { ...summary.pitchSession };
          }
          onUpdate();
        },
        handleErr(OperationType.GET, `teams/${teamId}`)
      )
    );

    // 2. Live Team Members Roster
    this.unsubs.push(
      onSnapshot(
        collection(db, 'teams', teamId, 'members'),
        (snap) => {
          quotaMonitor.recordReads('core', Math.max(1, snap.docChanges().length || snap.size));
          state.players = snap.docs.map((d) => {
            const data = d.data();
            return {
              id: d.id,
              ...data,
              photo: String(data.photo || data.photoUrl || ''),
            };
          });
          onUpdate();
        },
        handleErr(OperationType.LIST, `teams/${teamId}/members`)
      )
    );

    // 3. Live Attendance + Pitch Fee Payments
    this.unsubs.push(
      onSnapshot(
        collection(db, 'teams', teamId, 'attendance'),
        (snap) => {
          quotaMonitor.recordReads('core', Math.max(1, snap.docChanges().length || snap.size));
          const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          state.attendance = rows;
          state.pitchPayments = rows.map((r) => ({
            id: r.id,
            teamId,
            sessionId: 'current',
            playerId: String((r as Record<string, unknown>).playerId || ''),
            ownerUid: String((r as Record<string, unknown>).ownerUid || ''),
            playerName: String((r as Record<string, unknown>).playerName || ''),
            amount: Number((r as Record<string, unknown>).amount || 0),
            paid: Boolean((r as Record<string, unknown>).paid),
          }));
          onUpdate();
        },
        handleErr(OperationType.LIST, `teams/${teamId}/attendance`)
      )
    );

    // 4. Live Team Reports Feed (auto-updates Leaderboard + Player Cards + Team Feed!)
    this.unsubs.push(
      onSnapshot(
        collection(db, 'teams', teamId, 'reports'),
        (snap) => {
          quotaMonitor.recordReads('core', Math.max(1, snap.docChanges().length || snap.size));
          state.reports = snap.docs
            .map((d) => ({ id: d.id, ...d.data() }))
            .sort((a, b) => Number((b as Record<string, unknown>).createdAtMs || 0) - Number((a as Record<string, unknown>).createdAtMs || 0));
          onUpdate();
        },
        handleErr(OperationType.LIST, `teams/${teamId}/reports`)
      )
    );

    // 5. Team Matches
    this.unsubs.push(
      onSnapshot(
        collection(db, 'teams', teamId, 'matches'),
        (snap) => {
          state.matches = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          onUpdate();
        },
        handleErr(OperationType.LIST, `teams/${teamId}/matches`)
      )
    );

    // 6. Team Suggestions
    this.unsubs.push(
      onSnapshot(
        collection(db, 'teams', teamId, 'suggestions'),
        (snap) => {
          state.suggestions = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          onUpdate();
        },
        handleErr(OperationType.LIST, `teams/${teamId}/suggestions`)
      )
    );

    // 7. Organizer Ratings
    this.unsubs.push(
      onSnapshot(
        collection(db, 'teams', teamId, 'adminRatings'),
        (snap) => {
          state.adminRatings = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          onUpdate();
        },
        handleErr(OperationType.LIST, `teams/${teamId}/adminRatings`)
      )
    );

    quotaMonitor.setActiveListeners(this.unsubs.length);
  }

  async dispatchMultiTeamAction(
    action: string,
    payload: Record<string, unknown>,
    currentUser: Record<string, unknown>
  ): Promise<Record<string, unknown> | void> {
    const uid = this.activeUid;
    const teamId = this.activeTeamId;
    if (!uid || !teamId) throw new Error('لم يتم تحديد فريق نشط بعد.');

    const team = this.activeTeamDoc;

    switch (action) {
      case 'displayName': {
        const check = sanitizePlayerDisplayName(payload.name);
        if (!check.valid) throw new Error(check.errorAr || 'أدخل اسماً صالحاً');
        await updateDoc(doc(db, 'teams', teamId, 'members', uid), {
          name: check.name,
          updatedAt: serverTimestamp(),
        });
        return { name: check.name };
      }

      case 'profile': {
        const nameCheck = sanitizePlayerDisplayName(payload.name ?? currentUser.name);
        const safeName = nameCheck.valid ? nameCheck.name : clampStr(currentUser.name, 80) || 'لاعب';
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
        if (cleanStats6) updateData.stats6 = cleanStats6;
        if ('roleOverride' in payload) updateData.roleOverride = sanitizeRoleOverride(payload.roleOverride);
        if ('photo' in payload) {
          const cleanPhoto = sanitizeImageDataUrl(payload.photo, 250000);
          updateData.photo = cleanPhoto;
          updateData.hasPhoto = Boolean(cleanPhoto);
        }
        await updateDoc(doc(db, 'teams', teamId, 'members', uid), updateData);
        return;
      }

      case 'photo': {
        const cleanPhoto = sanitizeImageDataUrl(payload.photo, 250000);
        const zoom = Math.round(clampNum(payload.photoZoom ?? currentUser.photoZoom, 90, 160, 105));
        const y = Math.round(clampNum(payload.photoY ?? currentUser.photoY, 0, 60, 18));
        await updateDoc(doc(db, 'teams', teamId, 'members', uid), {
          photo: cleanPhoto,
          hasPhoto: Boolean(cleanPhoto),
          photoZoom: zoom,
          photoY: y,
          updatedAt: serverTimestamp(),
        });
        return;
      }

      case 'roleModel': {
        await updateDoc(doc(db, 'teams', teamId, 'members', uid), {
          roleModelStarId: sanitizeStarId(payload.roleModelStarId),
          updatedAt: serverTimestamp(),
        });
        return;
      }

      case 'tactics':
      case 'publishLineup': {
        if (!canPublishTeamLineup(team, uid)) {
          throw new Error('نشر التشكيلة الرسمية مقتصر حالياً على منشئ الفريق والمنظّمين فقط.');
        }
        const rawSlots = (payload.slots && typeof payload.slots === 'object' ? payload.slots : {}) as Record<string, unknown>;
        const slots: Record<string, string> = {};
        for (const [k, v] of Object.entries(rawSlots).slice(0, 20)) {
          if (typeof v === 'string' && v.trim()) {
            slots[k.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40)] = v
              .replace(/[^a-zA-Z0-9_-]/g, '')
              .slice(0, 128);
          }
        }
        const publishedByName = clampStr(payload.publishedByName || currentUser.name || 'لاعب', 80) || 'لاعب';
        await updateDoc(doc(db, 'teams', teamId), {
          tactics: {
            formation: sanitizeFormation(payload.formation),
            slots,
            publishedByUid: uid,
            publishedByName,
            publishedAtMs: Date.now(),
          },
          lineupVotes: {},
          updatedAt: serverTimestamp(),
        });
        return { publishedByName };
      }

      case 'voteLineup': {
        const choice: LineupVoteChoice = payload.vote === 'swap' ? 'swap' : 'approve';
        const prevVotes = { ...(team?.lineupVotes || {}) };
        prevVotes[uid] = choice;
        await updateDoc(doc(db, 'teams', teamId), {
          lineupVotes: prevVotes,
          updatedAt: serverTimestamp(),
        });
        return { vote: choice };
      }

      case 'attendance': {
        const targetDate = sanitizeDateStr(payload.date || team?.pitchSession?.matchDate);
        const status = normalizeAttendanceStatus(payload.status);
        const docId = `${targetDate}__${uid}`;
        await setDoc(
          doc(db, 'teams', teamId, 'attendance', docId),
          {
            teamId,
            playerId: uid,
            ownerUid: uid,
            playerName: clampStr(payload.playerName || currentUser.name, 80) || 'لاعب',
            date: targetDate,
            type: clampStr(payload.type || 'مباراة', 40) || 'مباراة',
            status,
            paid: Boolean(payload.paid),
            amount: Math.max(0, Math.round(clampNum(payload.amount, 0, 10000, 0) * 10) / 10),
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
        return;
      }

      case 'pitchSession': {
        if (!canPublishTeamLineup(team, uid)) {
          throw new Error('تعديل موعد المباراة والقَطّة متاح للمنظّمين فقط.');
        }
        const sessionObj = {
          teamId,
          title: clampStr(payload.title || 'مباراة السداسي القادمة', 80) || 'مباراة السداسي القادمة',
          matchDate: sanitizeDateStr(payload.matchDate),
          matchTime: sanitizeTimeStr(payload.matchTime, '20:30'),
          venue: clampStr(payload.venue || '', 80),
          totalCost: Math.max(0, Math.round(clampNum(payload.totalCost, 0, 100000, 0) * 10) / 10),
          currency: clampStr(payload.currency || team?.defaultCurrency || 'ريال', 20) || 'ريال',
          confirmedCount: Math.round(clampNum(payload.confirmedCount, 0, 100, 0)),
          paidCount: Math.round(clampNum(payload.paidCount, 0, 100, 0)),
          paidTotal: Math.max(0, Math.round(clampNum(payload.paidTotal, 0, 100000, 0) * 10) / 10),
        };
        await updateDoc(doc(db, 'teams', teamId), {
          pitchSession: sessionObj,
          updatedAt: serverTimestamp(),
        });
        return;
      }

      case 'pitchPayment': {
        const pay = (payload.payment || {}) as Record<string, unknown>;
        const sess = (payload.session || {}) as Record<string, unknown>;
        const targetPid = String(pay.playerId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 128);
        if (!targetPid) throw new Error('معرّف اللاعب غير صالح');
        const targetDate = sanitizeDateStr(sess.matchDate || team?.pitchSession?.matchDate);
        const attDocId = `${targetDate}__${targetPid}`;
        await setDoc(
          doc(db, 'teams', teamId, 'attendance', attDocId),
          {
            teamId,
            playerId: targetPid,
            ownerUid: String(pay.ownerUid || targetPid).slice(0, 128),
            playerName: clampStr(pay.playerName || 'لاعب', 80) || 'لاعب',
            date: targetDate,
            type: 'مباراة',
            status: 'جاي',
            paid: Boolean(pay.paid),
            amount: Math.max(0, Math.round(clampNum(pay.amount, 0, 10000, 0) * 10) / 10),
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
        if (canPublishTeamLineup(team, uid)) {
          await updateDoc(doc(db, 'teams', teamId), {
            pitchSession: {
              teamId,
              title: clampStr(sess.title || 'مباراة السداسي القادمة', 80) || 'مباراة السداسي القادمة',
              matchDate: targetDate,
              matchTime: sanitizeTimeStr(sess.matchTime, '20:30'),
              venue: clampStr(sess.venue || '', 80),
              totalCost: Math.max(0, Math.round(clampNum(sess.totalCost, 0, 100000, 0) * 10) / 10),
              currency: clampStr(sess.currency || team?.defaultCurrency || 'ريال', 20) || 'ريال',
              confirmedCount: Math.round(clampNum(sess.confirmedCount, 0, 100, 0)),
              paidCount: Math.round(clampNum(sess.paidCount, 0, 100, 0)),
              paidTotal: Math.max(0, Math.round(clampNum(sess.paidTotal, 0, 100000, 0) * 10) / 10),
            },
            updatedAt: serverTimestamp(),
          });
        }
        return;
      }

      case 'report': {
        const nowMs = Date.now();
        const guard = evaluateReportSubmissionGuard({
          goals: payload.goals,
          assists: payload.assists,
          minutes: payload.minutes,
          goalsConceded: payload.goalsConceded,
          lastReportAtMs: this.lastReportAtMs,
          nowMs,
        });
        if (!guard.allowed) {
          throw new Error(guard.errorAr || 'لا يمكن إرسال التقرير الآن.');
        }

        const repId = makeMultiId('rep');
        const reportDoc = {
          teamId,
          playerId: uid,
          ownerUid: uid,
          playerName: clampStr(currentUser.name || 'لاعب', 80) || 'لاعب',
          opponent: clampStr(payload.opponent, 80) || 'خصم',
          goals: Math.min(MAX_GOALS_PER_MATCH, guard.sanitized.goals),
          assists: Math.min(MAX_ASSISTS_PER_MATCH, guard.sanitized.assists),
          minutes: guard.sanitized.minutes,
          interceptions: Math.round(clampNum(payload.interceptions, 0, 60, 0)),
          turnovers: Math.round(clampNum(payload.turnovers, 0, 60, 0)),
          rating: Math.round(clampNum(payload.rating, 1, 10, 8)),
          rpe: Math.round(clampNum(payload.rpe, 1, 10, 7)),
          bestMoment: clampStr(payload.bestMoment, 200),
          worstMoment: clampStr(payload.worstMoment, 200),
          motmVote: clampStr(payload.motmVote, 128),
          pitchMode: sanitizePitchMode(payload.pitchMode),
          matchResult: sanitizeMatchResult(payload.matchResult),
          goalsConceded: guard.sanitized.goalsConceded,
          confirmedByUids: [],
          verified: false,
          createdAtMs: nowMs,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };

        await setDoc(doc(db, 'teams', teamId, 'reports', repId), reportDoc);
        this.lastReportAtMs = nowMs;
        // Persist cooldown timestamp on user profile
        try {
          const uSnap = await getDoc(doc(db, 'users', uid));
          const prevData = uSnap.exists() ? uSnap.data() : {};
          const prevTeamIds = Array.isArray(prevData.teamIds) ? prevData.teamIds.map(String) : [teamId];
          await setDoc(doc(db, 'users', uid), {
            uid,
            displayName: clampStr(prevData.displayName || currentUser.name || 'لاعب', 80) || 'لاعب',
            photoUrl: String(prevData.photoUrl || '').slice(0, 400),
            activeTeamId: teamId,
            teamIds: Array.from(new Set([...prevTeamIds, teamId])).slice(0, 20),
            lastReportAtMs: nowMs,
            updatedAt: serverTimestamp(),
          });
        } catch {
          // non-fatal
        }
        return { id: repId, createdAtMs: nowMs };
      }

      case 'confirmReport': {
        const reportId = String(payload.reportId || '').replace(/[^a-zA-Z0-9_-]/g, '');
        if (!reportId) throw new Error('معرّف التقرير غير صالح');
        const repRef = doc(db, 'teams', teamId, 'reports', reportId);
        const snap = await getDoc(repRef);
        if (!snap.exists()) throw new Error('التقرير غير موجود');
        const repData = snap.data();
        const check = applyReportConfirmation(
          {
            ownerUid: String(repData.ownerUid || ''),
            playerId: String(repData.playerId || ''),
            confirmedByUids: Array.isArray(repData.confirmedByUids) ? repData.confirmedByUids.map(String) : [],
          },
          uid
        );
        if (!check.ok) throw new Error(check.errorAr || 'لا يمكن تأكيد هذا التقرير');
        if (check.alreadyConfirmed) return { alreadyConfirmed: true };
        await updateDoc(repRef, {
          confirmedByUids: check.confirmedByUids,
          verified: true,
          updatedAt: serverTimestamp(),
        });
        return { verified: true, count: check.confirmedByUids.length };
      }

      case 'match': {
        const id = makeMultiId('m');
        const ourScore = Math.round(clampNum(payload.ourScore, 0, 99, 0));
        const oppScore = Math.round(clampNum(payload.oppScore, 0, 99, 0));
        await setDoc(doc(db, 'teams', teamId, 'matches', id), {
          teamId,
          date: sanitizeDateStr(payload.date),
          opponent: clampStr(payload.opponent, 80) || 'خصم',
          ourScore,
          oppScore,
          result: ourScore > oppScore ? 'فوز' : ourScore < oppScore ? 'خسارة' : 'تعادل',
          createdBy: uid,
          createdAt: serverTimestamp(),
        });
        return;
      }

      case 'suggestion': {
        const text = clampStr(payload.text, 500);
        if (!text) return;
        await setDoc(doc(db, 'teams', teamId, 'suggestions', makeMultiId('sugg')), {
          teamId,
          text,
          createdAt: serverTimestamp(),
        });
        return;
      }

      case 'readiness': {
        await setDoc(doc(db, 'teams', teamId, 'readiness', makeMultiId('rd')), {
          teamId,
          playerId: uid,
          ownerUid: uid,
          date: sanitizeDateStr(payload.date),
          sleep: Math.round(clampNum(payload.sleep, 1, 10, 8)),
          fatigue: Math.round(clampNum(payload.fatigue, 1, 10, 8)),
          mood: Math.round(clampNum(payload.mood, 1, 10, 8)),
          createdAt: serverTimestamp(),
        });
        return;
      }

      case 'injury': {
        const batch = writeBatch(db);
        batch.set(doc(db, 'teams', teamId, 'injuries', makeMultiId('inj')), {
          teamId,
          playerId: uid,
          ownerUid: uid,
          type: clampStr(payload.type, 80) || 'التواء الكاحل',
          location: clampStr(payload.location, 100) || 'القدم',
          severity: payload.severity === 'متوسطة' || payload.severity === 'شديدة' ? payload.severity : 'خفيفة',
          date: sanitizeDateStr(payload.date),
          expectedReturn: sanitizeDateStr(payload.expectedReturn),
          createdAt: serverTimestamp(),
        });
        batch.update(doc(db, 'teams', teamId, 'members', uid), {
          availableStatus: 'unavailable',
          updatedAt: serverTimestamp(),
        });
        await batch.commit();
        return;
      }

      case 'recoverAvailable': {
        await updateDoc(doc(db, 'teams', teamId, 'members', uid), {
          availableStatus: 'available',
          updatedAt: serverTimestamp(),
        });
        return;
      }

      case 'adminRating': {
        const targetId = String(payload.targetId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 128);
        if (!targetId) throw new Error('اختر لاعباً للتقييم');
        await setDoc(doc(db, 'teams', teamId, 'adminRatings', targetId), {
          teamId,
          targetId,
          score: Math.round(clampNum(payload.score, 1, 10, 7)),
          updatedAt: serverTimestamp(),
        });
        return;
      }

      case 'updateTeamSettings': {
        if (!team || (team.createdBy !== uid && !team.organizerUids.includes(uid))) {
          throw new Error('تعديل إعدادات الفريق متاح لمنشئ الفريق والمنظّمين فقط.');
        }
        const nextName = clampStr(payload.name || team.name, 80) || team.name;
        const nextLogo = 'logo' in payload ? sanitizeImageDataUrl(payload.logo, 180000) : (team.logo || '');
        const nextColor = sanitizeHexColor(payload.primaryColor || team.primaryColor, ROYAL_PRIMARY);
        const nextCurrency = clampStr(payload.defaultCurrency || team.defaultCurrency || 'ريال', 20) || 'ريال';
        const nextCost = Math.max(0, Math.round(clampNum(payload.defaultPitchCost ?? team.defaultPitchCost, 0, 100000, 0) * 10) / 10);
        const nextPerm: LineupPermissionMode =
          payload.lineupPermission === 'organizers' ? 'organizers' : 'all';

        const batch = writeBatch(db);
        batch.update(doc(db, 'teams', teamId), {
          name: nextName,
          logo: nextLogo,
          primaryColor: nextColor,
          defaultCurrency: nextCurrency,
          defaultPitchCost: nextCost,
          lineupPermission: nextPerm,
          updatedAt: serverTimestamp(),
        });
        if (team.inviteCode) {
          batch.update(doc(db, 'inviteCodes', team.inviteCode), {
            teamName: nextName,
            primaryColor: nextColor,
            updatedAt: serverTimestamp(),
          });
        }
        await batch.commit();
        return { name: nextName };
      }

      case 'regenerateTeamInviteCode': {
        if (!team || (team.createdBy !== uid && !team.organizerUids.includes(uid))) {
          throw new Error('تجديد كود الدعوة متاح لمنشئ الفريق والمنظّمين فقط.');
        }
        const newCode = generateSecureInviteCode(12);
        const oldCode = team.inviteCode;
        const batch = writeBatch(db);
        batch.update(doc(db, 'teams', teamId), {
          inviteCode: newCode,
          updatedAt: serverTimestamp(),
        });
        batch.set(doc(db, 'inviteCodes', newCode), {
          code: newCode,
          active: true,
          requireApproval: false,
          teamId,
          teamName: team.name,
          appName: 'ميدان 6v6',
          primaryColor: sanitizeHexColor(team.primaryColor, ROYAL_PRIMARY),
          memberCount: team.memberCount,
          usageType: 'multi',
          maxUses: 100,
          usedCount: 0,
          status: 'active',
          createdBy: uid,
          createdAtMs: Date.now(),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        if (oldCode && oldCode !== newCode) {
          batch.set(
            doc(db, 'inviteCodes', oldCode),
            {
              code: oldCode,
              active: false,
              status: 'revoked',
              updatedAt: serverTimestamp(),
            },
            { merge: true }
          );
        }
        await batch.commit();
        return { inviteCode: newCode };
      }

      case 'toggleTeamOrganizer': {
        if (!team || team.createdBy !== uid) {
          throw new Error('تعيين المنظّمين متاح لمنشئ الفريق فقط.');
        }
        const targetUid = String(payload.targetUid || '').replace(/[^a-zA-Z0-9_-]/g, '');
        if (!targetUid || targetUid === team.createdBy) {
          throw new Error('لا يمكن تغيير صلاحية منشئ الفريق.');
        }
        const makeOrg = Boolean(payload.isOrganizer);
        const nextOrgs = makeOrg
          ? Array.from(new Set([...team.organizerUids, targetUid]))
          : team.organizerUids.filter((id) => id !== targetUid);
        if (!nextOrgs.includes(team.createdBy)) nextOrgs.unshift(team.createdBy);

        const batch = writeBatch(db);
        batch.update(doc(db, 'teams', teamId), {
          organizerUids: nextOrgs,
          updatedAt: serverTimestamp(),
        });
        batch.update(doc(db, 'teams', teamId, 'members', targetUid), {
          role: makeOrg ? 'organizer' : 'player',
          updatedAt: serverTimestamp(),
        });
        await batch.commit();
        return { isOrganizer: makeOrg };
      }

      case 'leaveMultiTeam': {
        if (!team) throw new Error('لم يتم العثور على الفريق.');
        if (team.createdBy === uid) {
          throw new Error('بصفتك منشئ الفريق، يمكنك حذف الفريق من الإعدادات إذا لم تعد بحاجة إليه.');
        }
        const batch = writeBatch(db);
        batch.update(doc(db, 'teams', teamId), {
          memberUids: arrayRemove(uid),
          organizerUids: arrayRemove(uid),
          memberCount: increment(-1),
          updatedAt: serverTimestamp(),
        });
        batch.delete(doc(db, 'teams', teamId, 'members', uid));
        await batch.commit();

        try {
          const uSnap = await getDoc(doc(db, 'users', uid));
          if (uSnap.exists()) {
            const d = uSnap.data();
            const remaining = (Array.isArray(d.teamIds) ? d.teamIds.map(String) : []).filter((id) => id !== teamId);
            await setDoc(doc(db, 'users', uid), {
              uid,
              displayName: clampStr(d.displayName || currentUser.name || 'لاعب', 80) || 'لاعب',
              photoUrl: String(d.photoUrl || '').slice(0, 400),
              activeTeamId: remaining[0] || '',
              teamIds: remaining,
              lastReportAtMs: Number(d.lastReportAtMs || 0),
              updatedAt: serverTimestamp(),
            });
          }
        } catch {
          // non-fatal
        }
        this.stop();
        return { leftTeamId: teamId };
      }

      case 'deleteMultiTeam': {
        if (!team || team.createdBy !== uid) {
          throw new Error('حذف الفريق متاح لمنشئ الفريق فقط.');
        }
        const inviteCode = team.inviteCode;
        const batch = writeBatch(db);
        if (inviteCode) {
          batch.delete(doc(db, 'inviteCodes', inviteCode));
        }
        batch.delete(doc(db, 'teams', teamId));
        await batch.commit();

        try {
          const uSnap = await getDoc(doc(db, 'users', uid));
          if (uSnap.exists()) {
            const d = uSnap.data();
            const remaining = (Array.isArray(d.teamIds) ? d.teamIds.map(String) : []).filter((id) => id !== teamId);
            await setDoc(doc(db, 'users', uid), {
              uid,
              displayName: clampStr(d.displayName || currentUser.name || 'لاعب', 80) || 'لاعب',
              photoUrl: String(d.photoUrl || '').slice(0, 400),
              activeTeamId: remaining[0] || '',
              teamIds: remaining,
              lastReportAtMs: Number(d.lastReportAtMs || 0),
              updatedAt: serverTimestamp(),
            });
          }
        } catch {
          // non-fatal
        }
        this.stop();
        return { deletedTeamId: teamId };
      }

      default:
        console.warn('Unhandled multi-team action:', action);
        return;
    }
  }
}

export const multiTeamService = new MultiTeamFirestoreService();

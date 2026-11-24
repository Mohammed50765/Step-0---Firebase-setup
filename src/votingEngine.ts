// Phase B: Decentralized Match Verification (Draft -> Verified),
// 20-Second Secret Collective Voting (50% Quorum Lock + Trimmed Mean),
// & 2-Teammate Random Peer Mission Verification (XP only, isolated from OVR).
// Zero external dependencies, pure TypeScript, Firebase Spark zero-budget compatible.

import { escapeHtml } from './security';

export const MATCH_VERIFY_MIN_CONFIRMATIONS = 3;
export const VOTING_ROUND_DURATION_SEC = 20;
export const VOTING_QUORUM_RATIO = 0.5;
export const MISSION_VERIFIER_COUNT = 2;

export type MatchSessionStatus = 'draft' | 'verified';
export type MissionClaimStatus = 'pending' | 'verified' | 'rejected';
export type PitchMode = '6v6' | '11v11';
export type MatchResultAr = 'فوز' | 'تعادل' | 'خسارة';

export interface MatchSessionDoc {
  id: string;
  teamId: string;
  date: string;
  opponent: string;
  pitchMode: PitchMode;
  ourScore: number;
  oppScore: number;
  result: MatchResultAr;
  createdBy: string;
  participantIds: string[];
  confirmers: string[];
  status: MatchSessionStatus;
  votingOpen: boolean;
  voterUids: string[];
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface VoteHistogramTally {
  id?: string;
  teamId?: string;
  sessionId: string;
  targetId: string;
  eligibleCount: number;
  count: number;
  totalScore: number;
  h1?: number;
  h2?: number;
  h3?: number;
  h4?: number;
  h5?: number;
  h6?: number;
  h7?: number;
  h8?: number;
  h9?: number;
  h10?: number;
  /** Optional local demo raw score list */
  scores?: number[];
}

export interface SecretVoteBallot {
  id?: string;
  sessionId: string;
  targetId: string;
  voterUid: string;
  score: number;
}

export interface MissionDefinition {
  id: string;
  title: string;
  desc: string;
  xpReward: number;
  icon: string;
}

export interface MissionClaimDoc {
  id: string;
  teamId: string;
  missionId: string;
  missionTitle: string;
  xpReward: number;
  claimantUid: string;
  claimantName: string;
  note: string;
  verifierUids: string[];
  approverUids: string[];
  rejectorUids: string[];
  status: MissionClaimStatus;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface CommitmentStats {
  attended: number;
  total: number;
  pct: number | null;
  label: string;
}

export interface QuorumStatus {
  eligible: number;
  voted: number;
  required: number;
  pct: number;
  unlocked: boolean;
}

export interface TrimmedMeanResult {
  mean: number | null;
  trimmedMean: number | null;
  count: number;
  trimmedCount: number;
  droppedLow: number | null;
  droppedHigh: number | null;
}

export interface PlayerVotingSummary {
  targetId: string;
  count: number;
  trimmedMean: number;
  rawMean: number;
  droppedLow: number | null;
  droppedHigh: number | null;
}

export interface SessionVotingAggregation {
  unlocked: boolean;
  quorum: QuorumStatus;
  results: PlayerVotingSummary[];
  motmTargetId: string | null;
  lockReason: string;
}

export const MISSION_CATALOG: readonly MissionDefinition[] = [
  {
    id: 'clean_sheet',
    title: 'تحدي نظافة الشباك',
    desc: 'الفوز بأقل من هدفين علينا في المباراة (+50 XP)',
    xpReward: 50,
    icon: '🧤',
  },
  {
    id: 'team_assists',
    title: 'تحدي التمرير الجماعي',
    desc: 'صناعة فرص وتمريرات حاسمة جماعية للفريق (+40 XP)',
    xpReward: 40,
    icon: '👟',
  },
  {
    id: 'tactical_discipline',
    title: 'انضباط تكتيكي كامل',
    desc: 'الالتزام بالمركز والتغطية الدفاعية طوال المباراة (+30 XP)',
    xpReward: 30,
    icon: '🧭',
  },
  {
    id: 'punctual_hero',
    title: 'حضور مبكّر بدون تأخير',
    desc: 'الحضور قبل صافرة البداية بـ 10 دقائق والمساعدة بالإحماء (+25 XP)',
    xpReward: 25,
    icon: '⏱️',
  },
] as const;

// ==================== PURE HELPER FUNCTIONS ====================

function clampInt(val: unknown, min: number, max: number, fallback: number): number {
  const n = Math.round(Number(val));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function dedupeStrings(arr: unknown[], maxLen = 22): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of arr) {
    const s = String(item || '').trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
    if (out.length >= maxLen) break;
  }
  return out;
}

export function computeCommitmentStats(
  attendanceList: Array<Record<string, unknown>> | null | undefined,
  player: { id?: unknown; ownerUid?: unknown } | null | undefined
): CommitmentStats {
  if (!Array.isArray(attendanceList) || !player) {
    return { attended: 0, total: 0, pct: null, label: '—' };
  }
  const pid = String(player.id || '');
  const ouid = String(player.ownerUid || '');
  if (!pid && !ouid) {
    return { attended: 0, total: 0, pct: null, label: '—' };
  }

  const mine = attendanceList.filter((a) => {
    if (!a || typeof a !== 'object') return false;
    const apid = String(a.playerId || '');
    const auid = String(a.ownerUid || '');
    return (pid && apid === pid) || (ouid && auid === ouid);
  });

  if (mine.length === 0) {
    return { attended: 0, total: 0, pct: null, label: '—' };
  }

  const attended = mine.filter((a) => a.status === 'جاي').length;
  const pct = Math.round((attended / mine.length) * 100);
  return {
    attended,
    total: mine.length,
    pct,
    label: `${pct}%`,
  };
}

// ==================== 1. MATCH VERIFICATION (DRAFT -> VERIFIED) ====================

export function createDraftMatchSession(input: {
  id?: string;
  date: string;
  opponent: string;
  pitchMode?: PitchMode | string;
  ourScore: number;
  oppScore: number;
  createdBy: string;
  participantIds: string[];
}): MatchSessionDoc {
  const creator = String(input.createdBy || '').trim();
  if (!creator) throw new Error('معرّف منشئ المباراة مطلوب');

  const participants = dedupeStrings([creator, ...(input.participantIds || [])], 22);
  if (participants.length < 2) {
    throw new Error('اختر مشاركَين اثنين على الأقل في المباراة');
  }

  const ourScore = clampInt(input.ourScore, 0, 99, 0);
  const oppScore = clampInt(input.oppScore, 0, 99, 0);
  const result: MatchResultAr = ourScore > oppScore ? 'فوز' : ourScore < oppScore ? 'خسارة' : 'تعادل';
  const pitchMode: PitchMode = String(input.pitchMode || '').toLowerCase() === '11v11' ? '11v11' : '6v6';
  const cleanDate = /^\d{4}-\d{2}-\d{2}$/.test(String(input.date || ''))
    ? String(input.date)
    : new Date().toISOString().slice(0, 10);

  return {
    id: String(input.id || `ms_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`),
    teamId: 'main',
    date: cleanDate,
    opponent: String(input.opponent || 'خصم').trim().slice(0, 80) || 'خصم',
    pitchMode,
    ourScore,
    oppScore,
    result,
    createdBy: creator,
    participantIds: participants,
    confirmers: [creator],
    status: 'draft',
    votingOpen: false,
    voterUids: [],
  };
}

export function confirmMatchSession(
  session: MatchSessionDoc,
  confirmerUid: string
): { ok: boolean; error?: string; session: MatchSessionDoc } {
  const uid = String(confirmerUid || '').trim();
  if (!uid) {
    return { ok: false, error: 'معرّف اللاعب غير صالح', session };
  }
  if (session.status === 'verified') {
    return { ok: false, error: 'المباراة موثّقة بالفعل ✓', session };
  }
  const existingConfirmers = dedupeStrings(session.confirmers || [], 22);
  if (existingConfirmers.includes(uid)) {
    return { ok: false, error: 'لقد أكّدت هذه المباراة مسبقاً — ننتظر مشاركين مختلفين', session };
  }
  if (session.participantIds.length > 0 && !session.participantIds.includes(uid)) {
    return { ok: false, error: 'فقط المشاركون في هذه المباراة يمكنهم تأكيدها', session };
  }

  const nextConfirmers = [...existingConfirmers, uid];
  const reachedVerified = nextConfirmers.length >= MATCH_VERIFY_MIN_CONFIRMATIONS;

  const nextSession: MatchSessionDoc = {
    ...session,
    confirmers: nextConfirmers,
    status: reachedVerified ? 'verified' : 'draft',
    votingOpen: reachedVerified ? true : Boolean(session.votingOpen),
  };

  return { ok: true, session: nextSession };
}

// ==================== 2. SECRET 20s VOTING + 50% QUORUM + TRIMMED MEAN ====================

export function canCastSecretVote(voterUid: string, targetId: string): boolean {
  const v = String(voterUid || '').trim();
  const t = String(targetId || '').trim();
  return Boolean(v && t && v !== t);
}

export function computeQuorumStatus(uniqueVoterCount: number, participantCount: number): QuorumStatus {
  const eligible = Math.max(0, Math.round(Number(participantCount) || 0));
  const voted = Math.max(0, Math.round(Number(uniqueVoterCount) || 0));
  if (eligible <= 0) {
    return { eligible: 0, voted: 0, required: 0, pct: 0, unlocked: false };
  }
  const required = Math.ceil(eligible * VOTING_QUORUM_RATIO);
  const pct = Math.min(100, Math.round((voted / eligible) * 100));
  const unlocked = voted >= required && voted / eligible >= VOTING_QUORUM_RATIO;
  return { eligible, voted, required, pct, unlocked };
}

export function expandHistogramScores(tally: VoteHistogramTally): number[] {
  if (Array.isArray(tally.scores) && tally.scores.length > 0) {
    return tally.scores
      .map((s) => clampInt(s, 1, 10, 7))
      .sort((a, b) => a - b);
  }
  const scores: number[] = [];
  for (let s = 1; s <= 10; s++) {
    const key = `h${s}` as keyof VoteHistogramTally;
    const freq = Math.max(0, Math.round(Number(tally[key] || 0)));
    for (let i = 0; i < Math.min(freq, 200); i++) {
      scores.push(s);
    }
  }
  return scores;
}

export function computeTrimmedMean(rawScores: number[]): TrimmedMeanResult {
  if (!Array.isArray(rawScores) || rawScores.length === 0) {
    return {
      mean: null,
      trimmedMean: null,
      count: 0,
      trimmedCount: 0,
      droppedLow: null,
      droppedHigh: null,
    };
  }

  const sorted = rawScores
    .filter((v) => Number.isFinite(Number(v)))
    .map((v) => Math.max(1, Math.min(10, Number(v))))
    .sort((a, b) => a - b);

  const n = sorted.length;
  if (n === 0) {
    return {
      mean: null,
      trimmedMean: null,
      count: 0,
      trimmedCount: 0,
      droppedLow: null,
      droppedHigh: null,
    };
  }

  const rawMean = Number((sorted.reduce((a, b) => a + b, 0) / n).toFixed(1));

  if (n >= 3) {
    const droppedLow = sorted[0];
    const droppedHigh = sorted[n - 1];
    const middle = sorted.slice(1, n - 1);
    const tMean = Number((middle.reduce((a, b) => a + b, 0) / middle.length).toFixed(1));
    return {
      mean: rawMean,
      trimmedMean: tMean,
      count: n,
      trimmedCount: middle.length,
      droppedLow,
      droppedHigh,
    };
  }

  return {
    mean: rawMean,
    trimmedMean: rawMean,
    count: n,
    trimmedCount: n,
    droppedLow: null,
    droppedHigh: null,
  };
}

export function buildTalliesFromBallots(
  sessionId: string,
  eligibleCount: number,
  ballots: SecretVoteBallot[]
): VoteHistogramTally[] {
  const dedup = new Map<string, SecretVoteBallot>();
  for (const b of ballots || []) {
    if (!b || b.sessionId !== sessionId) continue;
    if (!canCastSecretVote(b.voterUid, b.targetId)) continue;
    const key = `${b.targetId}__${b.voterUid}`;
    dedup.set(key, {
      sessionId,
      targetId: b.targetId,
      voterUid: b.voterUid,
      score: clampInt(b.score, 1, 10, 7),
    });
  }

  const byTarget = new Map<string, VoteHistogramTally>();
  for (const b of dedup.values()) {
    let t = byTarget.get(b.targetId);
    if (!t) {
      t = {
        id: `${sessionId}__${b.targetId}`,
        sessionId,
        targetId: b.targetId,
        eligibleCount,
        count: 0,
        totalScore: 0,
        h1: 0,
        h2: 0,
        h3: 0,
        h4: 0,
        h5: 0,
        h6: 0,
        h7: 0,
        h8: 0,
        h9: 0,
        h10: 0,
      };
      byTarget.set(b.targetId, t);
    }
    t.count += 1;
    t.totalScore += b.score;
    const hKey = `h${b.score}` as keyof VoteHistogramTally;
    (t[hKey] as number) = Number(t[hKey] || 0) + 1;
  }

  return Array.from(byTarget.values());
}

export function aggregateSessionVoting(
  session: MatchSessionDoc,
  tallies: VoteHistogramTally[]
): SessionVotingAggregation {
  const eligible = Math.max(session.participantIds.length, 0);
  const uniqueVoters = dedupeStrings(session.voterUids || [], 22).length;
  const quorum = computeQuorumStatus(uniqueVoters, eligible);

  if (!quorum.unlocked) {
    return {
      unlocked: false,
      quorum,
      results: [],
      motmTargetId: null,
      lockReason: `🔒 النتائج مقفولة حتى يصوّت ${quorum.required} من ${quorum.eligible} مشارك (50% على الأقل — الحالي ${quorum.pct}%).`,
    };
  }

  const sessionTallies = (tallies || []).filter((t) => t && t.sessionId === session.id && t.count > 0);
  const results: PlayerVotingSummary[] = [];

  for (const tally of sessionTallies) {
    const scores = expandHistogramScores(tally);
    const tm = computeTrimmedMean(scores);
    if (tm.trimmedMean === null || tm.mean === null) continue;
    results.push({
      targetId: tally.targetId,
      count: tm.count,
      trimmedMean: tm.trimmedMean,
      rawMean: tm.mean,
      droppedLow: tm.droppedLow,
      droppedHigh: tm.droppedHigh,
    });
  }

  results.sort((a, b) => b.trimmedMean - a.trimmedMean || b.count - a.count);

  return {
    unlocked: true,
    quorum,
    results,
    motmTargetId: results.length > 0 ? results[0].targetId : null,
    lockReason: '',
  };
}

// ==================== 3. RANDOM 2-TEAMMATE MISSION VERIFICATION ====================

function cryptoRandomFloat(): number {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.getRandomValues === 'function') {
    const buf = new Uint32Array(1);
    cryptoApi.getRandomValues(buf);
    return buf[0] / 4294967296;
  }
  return Math.random();
}

export function pickRandomVerifiers(
  claimantUid: string,
  rosterPlayerIds: string[],
  rng: () => number = cryptoRandomFloat
): { ok: boolean; verifiers: string[]; error?: string } {
  const claimant = String(claimantUid || '').trim();
  const candidates = dedupeStrings(rosterPlayerIds || [], 60).filter((id) => id !== claimant);
  if (candidates.length < MISSION_VERIFIER_COUNT) {
    return {
      ok: false,
      verifiers: [],
      error: 'يلزم وجود زميلين آخرين على الأقل بالفريق لاختيار محقّقين عشوائياً.',
    };
  }

  // Fisher-Yates shuffle
  const pool = [...candidates];
  for (let i = pool.length - 1; i > 0; i--) {
    const r = Math.max(0, Math.min(0.999999, Number(rng())));
    const j = Math.floor(r * (i + 1));
    const tmp = pool[i];
    pool[i] = pool[j];
    pool[j] = tmp;
  }

  return { ok: true, verifiers: pool.slice(0, MISSION_VERIFIER_COUNT) };
}

export function createMissionClaim(
  input: {
    id?: string;
    missionId: string;
    claimantUid: string;
    claimantName: string;
    note?: string;
  },
  rosterPlayerIds: string[],
  rng?: () => number
): { ok: boolean; error?: string; claim?: MissionClaimDoc } {
  const mission = MISSION_CATALOG.find((m) => m.id === input.missionId);
  if (!mission) {
    return { ok: false, error: 'المهمة غير موجودة في القائمة.' };
  }
  const picked = pickRandomVerifiers(input.claimantUid, rosterPlayerIds, rng);
  if (!picked.ok) {
    return { ok: false, error: picked.error };
  }

  const claim: MissionClaimDoc = {
    id: String(input.id || `mc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`),
    teamId: 'main',
    missionId: mission.id,
    missionTitle: mission.title,
    xpReward: mission.xpReward,
    claimantUid: String(input.claimantUid).trim(),
    claimantName: String(input.claimantName || 'لاعب').trim().slice(0, 80) || 'لاعب',
    note: String(input.note || '').trim().slice(0, 200),
    verifierUids: picked.verifiers,
    approverUids: [],
    rejectorUids: [],
    status: 'pending',
  };

  return { ok: true, claim };
}

export function applyMissionVerification(
  claim: MissionClaimDoc,
  verifierUid: string,
  decision: 'approved' | 'rejected'
): { ok: boolean; error?: string; claim: MissionClaimDoc } {
  const uid = String(verifierUid || '').trim();
  if (!uid) return { ok: false, error: 'معرّف غير صالح', claim };
  if (claim.status !== 'pending') {
    return { ok: false, error: 'تم حسم هذه المهمة بالفعل', claim };
  }
  if (uid === claim.claimantUid) {
    return { ok: false, error: 'لا يمكنك توثيق مهمتك بنفسك — يجب التحقق من زميلين عشوائيين', claim };
  }
  if (!claim.verifierUids.includes(uid)) {
    return { ok: false, error: 'التحقق من هذه المهمة مخصّص للزميلين المختارين عشوائياً فقط', claim };
  }
  if (claim.approverUids.includes(uid) || claim.rejectorUids.includes(uid)) {
    return { ok: false, error: 'لقد أرسلت قرارك لهذه المهمة مسبقاً', claim };
  }

  if (decision === 'rejected') {
    return {
      ok: true,
      claim: {
        ...claim,
        rejectorUids: [...claim.rejectorUids, uid],
        status: 'rejected',
      },
    };
  }

  const nextApprovers = [...claim.approverUids, uid];
  const verified = nextApprovers.length >= MISSION_VERIFIER_COUNT;
  return {
    ok: true,
    claim: {
      ...claim,
      approverUids: nextApprovers,
      status: verified ? 'verified' : 'pending',
    },
  };
}

export function getVerifiedMissionXpForPlayer(
  claims: MissionClaimDoc[] | null | undefined,
  playerUid: string
): number {
  if (!Array.isArray(claims) || !playerUid) return 0;
  return claims
    .filter((c) => c && c.status === 'verified' && c.claimantUid === playerUid)
    .reduce((sum, c) => sum + Number(c.xpReward || 0), 0);
}

// ==================== 4. SELF-CONTAINED PHASE B UI CONTROLLER ====================

export interface VotingHubHooks {
  getState: () => Record<string, unknown>;
  getCurrentUser: () => Record<string, unknown> | null;
  isCaptain: () => boolean;
  isFirebaseMode: () => boolean;
  persistAction: (action: string, payload: Record<string, unknown>) => Promise<unknown>;
  saveLocal: () => void;
  onDataChanged: () => void;
  toast: (msg: string, isErr?: boolean) => void;
}

class MaydanVotingHubUI {
  private hooks: VotingHubHooks | null = null;
  private activeVoteSessionId: string | null = null;
  private countdownSec = VOTING_ROUND_DURATION_SEC;
  private countdownTimer: ReturnType<typeof setInterval> | null = null;
  private draftScores: Record<string, number> = {};

  mount(hooks: VotingHubHooks): void {
    this.hooks = hooks;
    this.renderLiveHub();
    this.renderMissionHub();
  }

  stopTimer(): void {
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
  }

  private getPlayerName(players: Array<Record<string, unknown>>, pid: string): string {
    const found = players.find((p) => String(p.id) === pid || String(p.ownerUid) === pid);
    return found ? String(found.name || 'لاعب') : pid.slice(0, 8);
  }

  private getCurrentUid(user: Record<string, unknown>): string {
    return String(user.id || user.ownerUid || '');
  }

  private start20SecBallot(session: MatchSessionDoc): void {
    this.stopTimer();
    if (!this.hooks) return;
    const user = this.hooks.getCurrentUser();
    if (!user) return;
    const myUid = this.getCurrentUid(user);

    this.activeVoteSessionId = session.id;
    this.countdownSec = VOTING_ROUND_DURATION_SEC;
    this.draftScores = {};

    const targets = session.participantIds.filter((pid) => canCastSecretVote(myUid, pid));
    for (const tid of targets) {
      this.draftScores[tid] = 7;
    }

    this.countdownTimer = setInterval(() => {
      this.countdownSec -= 1;
      const badge = document.getElementById('voteTimerBadge');
      if (badge) {
        badge.textContent = `⏱️ ${Math.max(0, this.countdownSec)} ثانية`;
        badge.style.color = this.countdownSec <= 5 ? '#fda4af' : '#fef08a';
      }
      if (this.countdownSec <= 0) {
        this.stopTimer();
        this.activeVoteSessionId = null;
        this.hooks?.toast('انتهت مهلة الـ 20 ثانية — يمكنك فتح جولة تصويت جديدة متى شئت', true);
        this.renderLiveHub();
      }
    }, 1000);

    this.renderLiveHub();
  }

  renderLiveHub(): void {
    const root = document.getElementById('votingHubMount');
    if (!root || !this.hooks) return;
    const state = this.hooks.getState();
    const user = this.hooks.getCurrentUser();
    if (!user) return;

    const myUid = this.getCurrentUid(user);
    const players = (Array.isArray(state.players) ? state.players : []) as Array<Record<string, unknown>>;
    const sessions = (Array.isArray(state.matchSessions) ? state.matchSessions : []) as MatchSessionDoc[];
    const tallies = (Array.isArray(state.matchVoteTallies) ? state.matchVoteTallies : []) as VoteHistogramTally[];
    const demoBallots = (Array.isArray(state.matchVoteBallots) ? state.matchVoteBallots : []) as SecretVoteBallot[];
    const isFb = this.hooks.isFirebaseMode();

    const sortedSessions = [...sessions].reverse().slice(0, 5);
    const playerCheckboxes = players
      .map((p) => {
        const pid = String(p.id || '');
        const checked = 'checked';
        return `<label style="display:inline-flex;align-items:center;gap:5px;padding:5px 8px;border-radius:10px;border:1px solid var(--border-subtle);background:rgba(255,255,255,0.03);font-size:0.75rem;cursor:pointer;">
          <input type="checkbox" class="ms-part-chk" value="${escapeHtml(pid)}" ${checked} style="width:15px;height:15px;accent-color:var(--primary);" />
          <span>${escapeHtml(p.name)}</span>
        </label>`;
      })
      .join('');

    const sessionsHtml = sortedSessions.length
      ? sortedSessions
          .map((sess) => {
            const isVerified = sess.status === 'verified';
            const confirmedCount = (sess.confirmers || []).length;
            const iConfirmed = (sess.confirmers || []).includes(myUid);
            const iVoted = (sess.voterUids || []).includes(myUid);
            const canConfirm = !isVerified && !iConfirmed && sess.participantIds.includes(myUid);
            const effectiveTallies = isFb
              ? tallies.filter((t) => t.sessionId === sess.id)
              : buildTalliesFromBallots(sess.id, sess.participantIds.length, demoBallots);
            const agg = aggregateSessionVoting(sess, effectiveTallies);
            const isVotingNow = this.activeVoteSessionId === sess.id && this.countdownSec > 0;
            const voteTargets = sess.participantIds.filter((pid) => canCastSecretVote(myUid, pid));

            // Demo-only simulation helper so local testing of 3/3 verification & 50% quorum is effortless
            const unconfirmedTeammate = !isFb
              ? sess.participantIds.find((pid) => !(sess.confirmers || []).includes(pid))
              : undefined;
            const unvotedTeammate = !isFb
              ? sess.participantIds.find((pid) => !(sess.voterUids || []).includes(pid) && pid !== myUid)
              : undefined;

            return `
              <div class="item-box" style="border-color:${isVerified ? 'rgba(34,197,94,0.42)' : 'rgba(250,204,21,0.34)'};padding:12px;">
                <div class="row between" style="gap:6px;margin-bottom:6px;">
                  <div>
                    <strong style="font-size:0.9rem;">⚽ ضد ${escapeHtml(sess.opponent)} (${sess.ourScore} - ${sess.oppScore})</strong>
                    <div class="muted" style="font-size:0.72rem;">${escapeHtml(sess.date)} • ${escapeHtml(sess.pitchMode)} • ${escapeHtml(sess.result)}</div>
                  </div>
                  <span class="badge" style="color:${isVerified ? '#86efac' : '#fde68a'};border-color:${isVerified ? 'rgba(34,197,94,0.45)' : 'rgba(250,204,21,0.45)'};">
                    ${isVerified ? '✅ موثّقة (Verified)' : `⏳ مسودة Draft (${confirmedCount}/${MATCH_VERIFY_MIN_CONFIRMATIONS})`}
                  </span>
                </div>

                ${
                  !isVerified
                    ? `
                  <div class="muted" style="font-size:0.75rem;margin-bottom:8px;">
                    يلزم تأكيد <strong>${MATCH_VERIFY_MIN_CONFIRMATIONS} مشاركين مختلفين</strong> لترقية المباراة من مسودة إلى رسمية موثّقة وفتح التصويت السري.
                  </div>
                  <div class="row" style="gap:6px;">
                    ${
                      canConfirm
                        ? `<button type="button" data-ms-confirm="${escapeHtml(sess.id)}" class="btn-emerald" style="font-size:0.78rem;padding:7px 12px;">✅ تأكيد صحة المباراة (${confirmedCount}/${MATCH_VERIFY_MIN_CONFIRMATIONS})</button>`
                        : `<span class="badge" style="font-size:0.72rem;">${iConfirmed ? '✓ أنت أكّدت — بانتظار زملائك' : 'غير مدرج في قائمة المشاركين'}</span>`
                    }
                    ${
                      !isFb && unconfirmedTeammate
                        ? `<button type="button" data-ms-demo-confirm="${escapeHtml(sess.id)}" data-uid="${escapeHtml(unconfirmedTeammate)}" class="icon-btn" style="font-size:0.72rem;">🧪 محاكاة تأكيد زميل (${escapeHtml(this.getPlayerName(players, unconfirmedTeammate))})</button>`
                        : ''
                    }
                  </div>
                `
                    : `
                  <!-- Verified Match: Secret 20s Voting & 50% Quorum Trimmed Mean -->
                  <div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border-subtle);">
                    <div class="row between" style="margin-bottom:6px;gap:6px;">
                      <strong style="font-size:0.82rem;color:var(--primary);">🗳️ التصويت الجماعي السري (20 ثانية • Trimmed Mean)</strong>
                      <span class="badge" style="font-size:0.72rem;">المشاركة: ${agg.quorum.voted}/${agg.quorum.eligible} (${agg.quorum.pct}%)</span>
                    </div>

                    ${
                      isVotingNow
                        ? `
                      <div class="item-box" style="border-color:rgba(250,204,21,0.55);background:rgba(250,204,21,0.06);margin-bottom:8px;">
                        <div class="row between" style="margin-bottom:8px;">
                          <strong style="font-size:0.82rem;color:#fef08a;">قيّم زملاءك بسرعة (ممنوع تقييم النفس)</strong>
                          <span id="voteTimerBadge" class="badge" style="color:#fef08a;font-weight:900;">⏱️ ${this.countdownSec} ثانية</span>
                        </div>
                        <div style="display:flex;flex-direction:column;gap:8px;">
                          ${voteTargets
                            .map((tid) => {
                              const curVal = this.draftScores[tid] || 7;
                              return `
                                <div class="row between" style="gap:8px;padding:6px 8px;border-radius:10px;background:rgba(7,7,9,0.55);">
                                  <strong style="font-size:0.8rem;">${escapeHtml(this.getPlayerName(players, tid))}</strong>
                                  <div class="row" style="gap:6px;flex-wrap:nowrap;">
                                    <input type="range" min="1" max="10" value="${curVal}" data-vote-slider="${escapeHtml(tid)}" style="width:110px;" />
                                    <strong id="vsVal_${escapeHtml(tid)}" style="min-width:34px;text-align:center;color:var(--primary);font-size:0.82rem;">${curVal}/10</strong>
                                  </div>
                                </div>
                              `;
                            })
                            .join('')}
                        </div>
                        <div class="grid-2" style="margin-top:8px;">
                          <button type="button" data-ms-submit-vote="${escapeHtml(sess.id)}" class="btn-primary" style="font-size:0.8rem;padding:8px;">🔒 إرسال تصويتي السري</button>
                          <button type="button" id="btnCancelVoteRound" class="btn-rose" style="font-size:0.8rem;padding:8px;">إلغاء</button>
                        </div>
                      </div>
                    `
                        : `
                      <div class="row" style="gap:6px;margin-bottom:8px;">
                        ${
                          !iVoted && sess.votingOpen && voteTargets.length > 0
                            ? `<button type="button" data-ms-start-vote="${escapeHtml(sess.id)}" class="btn-primary" style="font-size:0.78rem;padding:7px 12px;">⏱️ ابدأ التصويت السري (20 ثانية)</button>`
                            : `<span class="badge" style="font-size:0.72rem;color:#86efac;">${iVoted ? '✓ تم استلام تصويتك السري' : 'التصويت مغلق'}</span>`
                        }
                        ${
                          !isFb && unvotedTeammate
                            ? `<button type="button" data-ms-demo-vote="${escapeHtml(sess.id)}" data-uid="${escapeHtml(unvotedTeammate)}" class="icon-btn" style="font-size:0.72rem;">🧪 محاكاة صوت زميل (${escapeHtml(this.getPlayerName(players, unvotedTeammate))})</button>`
                            : ''
                        }
                      </div>
                    `
                    }

                    ${
                      !agg.unlocked
                        ? `<div class="muted" style="font-size:0.76rem;padding:8px 10px;border-radius:10px;background:rgba(255,255,255,0.03);border:1px dashed rgba(250,204,21,0.3);">${escapeHtml(agg.lockReason)}</div>`
                        : `
                      <div style="padding:8px 10px;border-radius:10px;background:rgba(34,197,94,0.08);border:1px solid rgba(34,197,94,0.32);">
                        <div class="row between" style="margin-bottom:6px;">
                          <strong style="font-size:0.78rem;color:#86efac;">🏆 نتائج التصويت المفتوحة (Trimmed Mean — حذف أعلى وأقل تقييم)</strong>
                        </div>
                        ${
                          agg.results.length
                            ? agg.results
                                .map(
                                  (r, idx) => `
                              <div class="row between" style="font-size:0.78rem;padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.06);">
                                <span>${idx === 0 ? '👑 ' : ''}${escapeHtml(this.getPlayerName(players, r.targetId))}</span>
                                <strong style="color:var(--primary);">${r.trimmedMean}/10 <span class="muted" style="font-size:0.7rem;">(${r.count} أصوات${r.droppedLow !== null ? ' • حذف شاذ' : ''})</span></strong>
                              </div>
                            `
                                )
                                .join('')
                            : '<p class="muted" style="font-size:0.74rem;">بانتظار مزامنة بطاقات التقييم.</p>'
                        }
                      </div>
                    `
                    }
                  </div>
                `
                }
              </div>
            `;
          })
          .join('')
      : '<p class="muted" style="font-size:0.78rem;">لا توجد جلسات توثيق مباريات بعد — أنشئ مسودة مباراة أعلاه ليؤكّدها 3 مشاركين.</p>';

    root.innerHTML = `
      <div class="card">
        <div class="row between" style="margin-bottom:8px;">
          <div>
            <h2>🛡️ توثيق المباراة والتصويت السري الجماعي</h2>
            <p class="muted" style="font-size:0.74rem;">Draft ← Verified بموافقة 3 مشاركين مختلفين • تصويت 20 ثانية • قفل تحت 50% + Trimmed Mean</p>
          </div>
          <span class="badge">المرحلة B</span>
        </div>

        <form id="draftMatchForm" style="display:flex;flex-direction:column;gap:8px;margin-bottom:12px;padding-bottom:12px;border-bottom:1px solid var(--border-subtle);">
          <div class="grid-2">
            <input id="msOpponent" type="text" required maxlength="80" placeholder="اسم الفريق الخصم (مسودة مباراة)" />
            <select id="msPitchMode" dir="ltr">
              <option value="6v6">6v6</option>
              <option value="11v11">11v11 ×2.2</option>
            </select>
          </div>
          <div class="grid-3">
            <div><label class="muted">أهدافنا</label><input id="msOurScore" type="number" min="0" max="99" value="4" /></div>
            <div><label class="muted">أهدافهم</label><input id="msOppScore" type="number" min="0" max="99" value="2" /></div>
            <div><label class="muted">التاريخ</label><input id="msDate" type="date" value="${new Date().toISOString().slice(0, 10)}" /></div>
          </div>
          <div>
            <div class="muted" style="font-size:0.74rem;margin-bottom:4px;">المشاركون في المباراة:</div>
            <div style="display:flex;flex-wrap:wrap;gap:6px;">${playerCheckboxes}</div>
          </div>
          <button type="submit" class="btn-primary">📝 إنشاء مسودة مباراة (Draft) للتوثيق الجماعي</button>
        </form>

        <div id="matchSessionsList">${sessionsHtml}</div>
      </div>
    `;

    // Bind draft creation form
    const form = document.getElementById('draftMatchForm');
    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!this.hooks) return;
        const opp = (document.getElementById('msOpponent') as HTMLInputElement)?.value.trim() || '';
        const pitchMode = ((document.getElementById('msPitchMode') as HTMLSelectElement)?.value || '6v6') as PitchMode;
        const ourScore = Number((document.getElementById('msOurScore') as HTMLInputElement)?.value || 0);
        const oppScore = Number((document.getElementById('msOppScore') as HTMLInputElement)?.value || 0);
        const date = (document.getElementById('msDate') as HTMLInputElement)?.value || new Date().toISOString().slice(0, 10);
        const checkedIds = Array.from(document.querySelectorAll<HTMLInputElement>('.ms-part-chk:checked')).map(
          (el) => el.value
        );

        try {
          const draft = createDraftMatchSession({
            date,
            opponent: opp,
            pitchMode,
            ourScore,
            oppScore,
            createdBy: myUid,
            participantIds: checkedIds,
          });
          if (!isFb) {
            if (!Array.isArray(state.matchSessions)) state.matchSessions = [];
            (state.matchSessions as MatchSessionDoc[]).push(draft);
            this.hooks.saveLocal();
          }
          await this.hooks.persistAction('createMatchSession', draft as unknown as Record<string, unknown>);
          this.hooks.onDataChanged();
          this.renderLiveHub();
          this.hooks.toast('تم إنشاء مسودة المباراة (Draft) — بانتظار تأكيد زميلَين إضافيَين (1/3) ⏳');
        } catch (err) {
          this.hooks.toast(err instanceof Error ? err.message : 'تعذّر إنشاء المسودة', true);
        }
      });
    }

    // Bind confirm buttons
    root.querySelectorAll<HTMLButtonElement>('[data-ms-confirm]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!this.hooks) return;
        const sid = btn.dataset.msConfirm || '';
        const sess = sessions.find((s) => s.id === sid);
        if (!sess) return;
        const res = confirmMatchSession(sess, myUid);
        if (!res.ok) {
          this.hooks.toast(res.error || 'تعذّر التأكيد', true);
          return;
        }
        if (!isFb) {
          Object.assign(sess, res.session);
          this.hooks.saveLocal();
        }
        await this.hooks.persistAction('confirmMatchSession', {
          sessionId: sid,
          confirmers: res.session.confirmers,
          status: res.session.status,
          votingOpen: res.session.votingOpen,
        });
        this.hooks.onDataChanged();
        this.renderLiveHub();
        this.hooks.toast(
          res.session.status === 'verified'
            ? '🎉 تم توثيق المباراة رسمياً (3/3 Verified) وفُتح التصويت السري!'
            : `تم تسجيل تأكيدك (${res.session.confirmers.length}/3) ✓`
        );
      });
    });

    // Demo-only teammate confirm simulator
    root.querySelectorAll<HTMLButtonElement>('[data-ms-demo-confirm]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!this.hooks || isFb) return;
        const sid = btn.dataset.msDemoConfirm || '';
        const simUid = btn.dataset.uid || '';
        const sess = sessions.find((s) => s.id === sid);
        if (!sess) return;
        const res = confirmMatchSession(sess, simUid);
        if (!res.ok) {
          this.hooks.toast(res.error || 'تعذّر المحاكاة', true);
          return;
        }
        Object.assign(sess, res.session);
        this.hooks.saveLocal();
        this.hooks.onDataChanged();
        this.renderLiveHub();
        this.hooks.toast(
          res.session.status === 'verified'
            ? '🎉 اكتمل التوثيق (3/3 Verified) وفُتح التصويت السري!'
            : `تمت محاكاة تأكيد زميل (${res.session.confirmers.length}/3) ✓`
        );
      });
    });

    // Start 20-sec voting
    root.querySelectorAll<HTMLButtonElement>('[data-ms-start-vote]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const sid = btn.dataset.msStartVote || '';
        const sess = sessions.find((s) => s.id === sid);
        if (sess) this.start20SecBallot(sess);
      });
    });

    // Cancel voting round
    const cancelBtn = document.getElementById('btnCancelVoteRound');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => {
        this.stopTimer();
        this.activeVoteSessionId = null;
        this.renderLiveHub();
      });
    }

    // Sliders during 20s voting
    root.querySelectorAll<HTMLInputElement>('[data-vote-slider]').forEach((inp) => {
      inp.addEventListener('input', () => {
        const tid = inp.dataset.voteSlider || '';
        const val = clampInt(inp.value, 1, 10, 7);
        this.draftScores[tid] = val;
        const lbl = document.getElementById('vsVal_' + tid);
        if (lbl) lbl.textContent = `${val}/10`;
      });
    });

    // Submit secret ballots
    root.querySelectorAll<HTMLButtonElement>('[data-ms-submit-vote]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!this.hooks) return;
        const sid = btn.dataset.msSubmitVote || '';
        const sess = sessions.find((s) => s.id === sid);
        if (!sess) return;
        this.stopTimer();

        const ballots: Array<{ targetId: string; score: number }> = [];
        for (const [tid, sc] of Object.entries(this.draftScores)) {
          if (canCastSecretVote(myUid, tid)) {
            ballots.push({ targetId: tid, score: clampInt(sc, 1, 10, 7) });
          }
        }
        if (ballots.length === 0) {
          this.hooks.toast('لا يوجد زملاء مؤهلون للتصويت (ممنوع التصويت للنفس)', true);
          return;
        }

        if (!isFb) {
          if (!Array.isArray(state.matchVoteBallots)) state.matchVoteBallots = [];
          const list = state.matchVoteBallots as SecretVoteBallot[];
          for (const b of ballots) {
            list.push({ sessionId: sid, targetId: b.targetId, voterUid: myUid, score: b.score });
          }
          if (!sess.voterUids.includes(myUid)) sess.voterUids.push(myUid);
          this.hooks.saveLocal();
        }

        await this.hooks.persistAction('submitSecretMatchVotes', {
          sessionId: sid,
          eligibleCount: sess.participantIds.length,
          ballots,
        });
        this.activeVoteSessionId = null;
        this.hooks.onDataChanged();
        this.renderLiveHub();
        this.hooks.toast('🔒 تم حفظ تصويتك السري بنجاح (تُفتح النتائج عند 50% مشاركة)');
      });
    });

    // Demo-only teammate vote simulator (tests 50% quorum & Trimmed Mean outlier removal)
    root.querySelectorAll<HTMLButtonElement>('[data-ms-demo-vote]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!this.hooks || isFb) return;
        const sid = btn.dataset.msDemoVote || '';
        const simUid = btn.dataset.uid || '';
        const sess = sessions.find((s) => s.id === sid);
        if (!sess || sess.voterUids.includes(simUid)) return;

        if (!Array.isArray(state.matchVoteBallots)) state.matchVoteBallots = [];
        const list = state.matchVoteBallots as SecretVoteBallot[];
        const voteIdx = sess.voterUids.length;
        for (const tid of sess.participantIds) {
          if (!canCastSecretVote(simUid, tid)) continue;
          const score = voteIdx % 3 === 0 ? 8 : voteIdx % 3 === 1 ? 9 : 7;
          list.push({ sessionId: sid, targetId: tid, voterUid: simUid, score });
        }
        sess.voterUids.push(simUid);
        this.hooks.saveLocal();
        this.hooks.onDataChanged();
        this.renderLiveHub();
        this.hooks.toast('🧪 تمت محاكاة تصويت سري لزميل ✓');
      });
    });
  }

  renderMissionHub(): void {
    const root = document.getElementById('missionVerifyMount');
    if (!root || !this.hooks) return;
    const state = this.hooks.getState();
    const user = this.hooks.getCurrentUser();
    if (!user) return;

    const myUid = this.getCurrentUid(user);
    const players = (Array.isArray(state.players) ? state.players : []) as Array<Record<string, unknown>>;
    const claims = (Array.isArray(state.missionClaims) ? state.missionClaims : []) as MissionClaimDoc[];
    const isFb = this.hooks.isFirebaseMode();

    const myVerifiedXp = getVerifiedMissionXpForPlayer(claims, myUid);
    const pendingForMe = claims.filter(
      (c) =>
        c.status === 'pending' &&
        c.claimantUid !== myUid &&
        (c.verifierUids || []).includes(myUid) &&
        !(c.approverUids || []).includes(myUid) &&
        !(c.rejectorUids || []).includes(myUid)
    );

    const recentClaims = [...claims].reverse().slice(0, 6);

    root.innerHTML = `
      <div style="margin-bottom:10px;">
        <div class="row between" style="margin-bottom:6px;">
          <strong style="font-size:0.84rem;color:var(--primary);">🎯 توثيق المهام العشوائي (زميلان يتحقّقان)</strong>
          <span class="badge" style="color:#86efac;">XP مهامك: +${myVerifiedXp}</span>
        </div>
        <p class="muted" style="font-size:0.72rem;margin-bottom:8px;">
          عند إرسال مهمة، يختار النظام <strong>زميلَين عشوائياً</strong> لتأكيدها. نقاط المهام تمنح XP فقط ولا تؤثر على OVR.
        </p>

        <form id="missionClaimForm" style="display:flex;flex-direction:column;gap:6px;margin-bottom:10px;">
          <select id="mcSelect">
            ${MISSION_CATALOG.map(
              (m) => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.icon)} ${escapeHtml(m.title)} (+${m.xpReward} XP)</option>`
            ).join('')}
          </select>
          <div class="row" style="gap:6px;">
            <input id="mcNote" type="text" maxlength="200" placeholder="تفاصيل سريعة (مثلاً: مباراة الخميس)" style="flex:1;" />
            <button type="submit" class="btn-primary" style="white-space:nowrap;padding:8px 12px;">إرسال للتحقق</button>
          </div>
        </form>

        ${
          pendingForMe.length
            ? `
          <div class="item-box" style="border-color:rgba(250,204,21,0.5);background:rgba(250,204,21,0.06);margin-bottom:8px;">
            <strong style="font-size:0.78rem;color:#fef08a;display:block;margin-bottom:6px;">🔔 تم اختيارك عشوائياً للتحقق من مهام زملائك:</strong>
            ${pendingForMe
              .map(
                (c) => `
              <div class="row between" style="gap:6px;padding:6px 0;border-top:1px solid rgba(255,255,255,0.08);">
                <div>
                  <strong style="font-size:0.8rem;">${escapeHtml(c.claimantName)}</strong>
                  <div class="muted" style="font-size:0.72rem;">${escapeHtml(c.missionTitle)} (+${c.xpReward} XP)${c.note ? ` • ${escapeHtml(c.note)}` : ''}</div>
                </div>
                <div class="row" style="gap:5px;">
                  <button type="button" data-mc-act="approved" data-mc-id="${escapeHtml(c.id)}" class="btn-emerald" style="padding:5px 9px;min-height:30px;font-size:0.72rem;">✅ أؤكد</button>
                  <button type="button" data-mc-act="rejected" data-mc-id="${escapeHtml(c.id)}" class="btn-rose" style="padding:5px 9px;min-height:30px;font-size:0.72rem;">❌ رفض</button>
                </div>
              </div>
            `
              )
              .join('')}
          </div>
        `
            : ''
        }

        <div id="missionClaimsList">
          ${
            recentClaims.length
              ? recentClaims
                  .map((c) => {
                    const verNames = (c.verifierUids || []).map((v) => this.getPlayerName(players, v)).join(' و ');
                    const stBadge =
                      c.status === 'verified'
                        ? `<span class="badge" style="color:#86efac;">✅ موثّقة (+${c.xpReward} XP)</span>`
                        : c.status === 'rejected'
                          ? `<span class="badge" style="color:#fda4af;">❌ مرفوضة</span>`
                          : `<span class="badge" style="color:#fde68a;">⏳ بانتظار التحقق (${(c.approverUids || []).length}/2)</span>`;
                    const pendingVerifier = !isFb && c.status === 'pending'
                      ? (c.verifierUids || []).find((v) => !(c.approverUids || []).includes(v))
                      : undefined;
                    return `
                      <div class="item-box" style="margin-bottom:6px;padding:9px 10px;">
                        <div class="row between" style="gap:6px;">
                          <strong style="font-size:0.8rem;">${escapeHtml(c.claimantName)} — ${escapeHtml(c.missionTitle)}</strong>
                          ${stBadge}
                        </div>
                        <div class="muted" style="font-size:0.71rem;margin-top:3px;">
                          المحقّقان العشوائيان: ${escapeHtml(verNames || '—')}${c.note ? ` • «${escapeHtml(c.note)}»` : ''}
                        </div>
                        ${
                          pendingVerifier
                            ? `<button type="button" data-mc-demo-approve="${escapeHtml(c.id)}" data-uid="${escapeHtml(pendingVerifier)}" class="icon-btn" style="margin-top:6px;font-size:0.7rem;min-height:28px;">🧪 محاكاة تأكيد (${escapeHtml(this.getPlayerName(players, pendingVerifier))})</button>`
                            : ''
                        }
                      </div>
                    `;
                  })
                  .join('')
              : '<div class="muted" style="font-size:0.74rem;margin-bottom:6px;">أرسل أول مهمة أعلاه لتُختار عشوائياً للتحقق من زميلين!</div>'
          }
        </div>
      </div>
    `;

    // Bind claim form
    const form = document.getElementById('missionClaimForm');
    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!this.hooks) return;
        const missionId = (document.getElementById('mcSelect') as HTMLSelectElement)?.value || '';
        const note = (document.getElementById('mcNote') as HTMLInputElement)?.value.trim() || '';
        const rosterIds = players.map((p) => String(p.id || '')).filter(Boolean);
        const res = createMissionClaim(
          {
            missionId,
            claimantUid: myUid,
            claimantName: String(user.name || 'لاعب'),
            note,
          },
          rosterIds
        );
        if (!res.ok || !res.claim) {
          this.hooks.toast(res.error || 'تعذّر إرسال المهمة', true);
          return;
        }
        if (!isFb) {
          if (!Array.isArray(state.missionClaims)) state.missionClaims = [];
          (state.missionClaims as MissionClaimDoc[]).push(res.claim);
          this.hooks.saveLocal();
        }
        await this.hooks.persistAction('createMissionClaim', res.claim as unknown as Record<string, unknown>);
        this.hooks.onDataChanged();
        this.renderMissionHub();
        const names = res.claim.verifierUids.map((v) => this.getPlayerName(players, v)).join(' و ');
        this.hooks.toast(`تم إرسال المهمة للتحقق العشوائي من: ${names} 🎯`);
      });
    }

    // Bind verifier buttons
    root.querySelectorAll<HTMLButtonElement>('[data-mc-act]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!this.hooks) return;
        const cid = btn.dataset.mcId || '';
        const act = btn.dataset.mcAct === 'rejected' ? 'rejected' : 'approved';
        const claim = claims.find((c) => c.id === cid);
        if (!claim) return;
        const res = applyMissionVerification(claim, myUid, act);
        if (!res.ok) {
          this.hooks.toast(res.error || 'تعذّر التحقق', true);
          return;
        }
        if (!isFb) {
          Object.assign(claim, res.claim);
          this.hooks.saveLocal();
        }
        await this.hooks.persistAction('verifyMissionClaim', {
          claimId: cid,
          approverUids: res.claim.approverUids,
          rejectorUids: res.claim.rejectorUids,
          status: res.claim.status,
          decision: act,
        });
        this.hooks.onDataChanged();
        this.renderMissionHub();
        this.hooks.toast(
          res.claim.status === 'verified'
            ? `✅ اكتمل التحقق من الزميلين ومُنحت +${res.claim.xpReward} XP!`
            : act === 'rejected'
              ? 'تم تسجيل عدم تأكيد المهمة'
              : 'تم تسجيل تأكيدك (1/2) — بانتظار الزميل الثاني ✓'
        );
      });
    });

    // Demo-only verifier simulator
    root.querySelectorAll<HTMLButtonElement>('[data-mc-demo-approve]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!this.hooks || isFb) return;
        const cid = btn.dataset.mcDemoApprove || '';
        const simUid = btn.dataset.uid || '';
        const claim = claims.find((c) => c.id === cid);
        if (!claim) return;
        const res = applyMissionVerification(claim, simUid, 'approved');
        if (!res.ok) {
          this.hooks.toast(res.error || 'تعذّر المحاكاة', true);
          return;
        }
        Object.assign(claim, res.claim);
        this.hooks.saveLocal();
        this.hooks.onDataChanged();
        this.renderMissionHub();
        this.hooks.toast(
          res.claim.status === 'verified'
            ? `✅ توثّقت المهمة بنجاح (+${res.claim.xpReward} XP فقط — لا تؤثر على OVR)!`
            : '🧪 تمت محاكاة تأكيد المحقّق الأول (1/2) ✓'
        );
      });
    });
  }
}

export const votingHubUI = new MaydanVotingHubUI();

const MaydanVotingApi = {
  MATCH_VERIFY_MIN_CONFIRMATIONS,
  VOTING_ROUND_DURATION_SEC,
  VOTING_QUORUM_RATIO,
  MISSION_VERIFIER_COUNT,
  MISSION_CATALOG,
  computeCommitmentStats,
  createDraftMatchSession,
  confirmMatchSession,
  canCastSecretVote,
  computeQuorumStatus,
  expandHistogramScores,
  computeTrimmedMean,
  buildTalliesFromBallots,
  aggregateSessionVoting,
  pickRandomVerifiers,
  createMissionClaim,
  applyMissionVerification,
  getVerifiedMissionXpForPlayer,
  ui: votingHubUI,
};

declare global {
  interface Window {
    MaydanVoting?: typeof MaydanVotingApi;
  }
}

if (typeof window !== 'undefined') {
  window.MaydanVoting = MaydanVotingApi;
}

export default MaydanVotingApi;

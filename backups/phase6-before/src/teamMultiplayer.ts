import { clampNum, clampStr, normalizeUnicodeCodeText, sanitizeInviteCode } from './security';
import { splitFairTeams, type MinimalPlayer } from './tacticsData';

export const REPORT_COOLDOWN_MS = 45 * 60 * 1000; // 45 minutes between reports
export const MAX_GOALS_PER_MATCH = 12;
export const MAX_ASSISTS_PER_MATCH = 12;
export const MAX_CONCEDED_PER_MATCH = 25;
export const PENDING_JOIN_CODE_STORAGE_KEY = 'maydan_pending_join_code_v1';

export type LineupPermissionMode = 'all' | 'organizers';
export type AttendanceStatusAr = 'جاي' | 'محتمل' | 'معتذر';
export type LineupVoteChoice = 'approve' | 'swap';

export interface TeamPolicyLike {
  createdBy?: string;
  organizerUids?: string[];
  lineupPermission?: LineupPermissionMode | string;
}

/**
 * Normalizes any invite code entered manually or scanned from QR.
 */
export function normalizeJoinCode(raw: unknown): string {
  const strict = sanitizeInviteCode(raw);
  if (strict) return strict;
  const fallback = normalizeUnicodeCodeText(raw)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, '');
  if (fallback.length >= 6 && fallback.length <= 20) return fallback;
  return '';
}

/**
 * Extracts a normalized join code from a scanned QR payload (either a ?join=CODE URL or raw code).
 */
export function extractJoinCodeFromQrPayload(rawPayload: unknown): string {
  const txt = String(rawPayload ?? '').trim();
  if (!txt) return '';
  try {
    if (/^https?:\/\//i.test(txt)) {
      const u = new URL(txt);
      const qJoin = u.searchParams.get('join') || u.searchParams.get('code');
      if (qJoin) return normalizeJoinCode(qJoin);
      if (u.hash) {
        const hp = new URLSearchParams(u.hash.replace(/^#/, ''));
        const hJoin = hp.get('join') || hp.get('code');
        if (hJoin) return normalizeJoinCode(hJoin);
      }
    }
  } catch {
    // Fallback to regex/direct parsing
  }
  const match = /[?&#](?:join|code)=([A-Za-z0-9_-]{6,24})/i.exec(txt);
  if (match && match[1]) {
    return normalizeJoinCode(match[1]);
  }
  return normalizeJoinCode(txt);
}

/**
 * Builds a clean Arabic WhatsApp team invite message with team name, code, and direct join link.
 */
export function buildWhatsAppTeamInvite(input: {
  teamName: string;
  inviteCode: string;
  shareUrl: string;
}): { text: string; waUrl: string } {
  const teamName = clampStr(input.teamName || 'فريق السداسي', 80) || 'فريق السداسي';
  const code = normalizeJoinCode(input.inviteCode) || String(input.inviteCode || '').trim().toUpperCase();
  const url = String(input.shareUrl || '').trim();
  const lines = [
    `⚽ *دعوة للانضمام إلى فريق «${teamName}» في ميدان 6v6*`,
    code ? `🔑 كود الانضمام: *${code}*` : '',
    url ? `🔗 رابط الانضمام المباشر:\n${url}` : '',
    'سجّل بحساب Google وانضم معنا مباشرة للتشكيلة والقطّة وتقارير المباريات! 🏆',
  ].filter(Boolean);
  const text = lines.join('\n');
  return {
    text,
    waUrl: `https://wa.me/?text=${encodeURIComponent(text)}`,
  };
}

export function savePendingJoinCode(rawCode: unknown): string {
  const code = normalizeJoinCode(rawCode);
  if (!code) return '';
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(PENDING_JOIN_CODE_STORAGE_KEY, code);
    }
  } catch {
    // ignore storage errors
  }
  return code;
}

export function readPendingJoinCode(): string {
  try {
    if (typeof localStorage === 'undefined') return '';
    return normalizeJoinCode(localStorage.getItem(PENDING_JOIN_CODE_STORAGE_KEY) || '');
  } catch {
    return '';
  }
}

export function clearPendingJoinCode(): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(PENDING_JOIN_CODE_STORAGE_KEY);
    }
  } catch {
    // ignore storage errors
  }
}

export function isTeamCreator(team: TeamPolicyLike | null | undefined, uid: string): boolean {
  if (!team || !uid) return false;
  return String(team.createdBy || '') === uid;
}

export function isTeamOrganizer(team: TeamPolicyLike | null | undefined, uid: string): boolean {
  if (!team || !uid) return false;
  if (isTeamCreator(team, uid)) return true;
  return Array.isArray(team.organizerUids) && team.organizerUids.includes(uid);
}

/**
 * Checks whether a team member is allowed to publish the official team lineup.
 * Default mode is 'all' (Friends Mode) so everyone can publish unless restricted to organizers.
 */
export function canPublishTeamLineup(team: TeamPolicyLike | null | undefined, uid: string): boolean {
  if (!uid) return false;
  const mode = team?.lineupPermission === 'organizers' ? 'organizers' : 'all';
  if (mode === 'all') return true;
  return isTeamOrganizer(team, uid);
}

export function tallyLineupVotes(
  votes: Record<string, string> | null | undefined,
  currentUid = ''
): {
  approveCount: number;
  swapCount: number;
  myVote: LineupVoteChoice | '';
} {
  let approveCount = 0;
  let swapCount = 0;
  let myVote: LineupVoteChoice | '' = '';
  if (votes && typeof votes === 'object') {
    for (const [voterUid, choice] of Object.entries(votes)) {
      if (choice === 'approve') {
        approveCount += 1;
        if (currentUid && voterUid === currentUid) myVote = 'approve';
      } else if (choice === 'swap') {
        swapCount += 1;
        if (currentUid && voterUid === currentUid) myVote = 'swap';
      }
    }
  }
  return { approveCount, swapCount, myVote };
}

/**
 * Maps legacy ('متردد', 'مو أكيد', 'ما فيني') and current ('محتمل', 'معتذر') attendance values seamlessly.
 */
export function normalizeAttendanceStatus(raw: unknown): AttendanceStatusAr {
  const s = String(raw ?? '').trim();
  if (s === 'محتمل' || s === 'مو أكيد' || s === 'متردد') return 'محتمل';
  if (s === 'معتذر' || s === 'ما فيني') return 'معتذر';
  return 'جاي';
}

export interface FlexiblePitchSplitResult {
  totalCost: number;
  confirmedCount: number;
  perPlayerShare: number;
  paidCount: number;
  unpaidCount: number;
  paidTotal: number;
  remainingTotal: number;
}

export function computeFlexiblePitchSplit(input: {
  totalCost: number;
  confirmedUids: string[];
  paidMap: Record<string, boolean>;
}): FlexiblePitchSplitResult {
  const totalCost = Math.max(0, Math.round(Number(input.totalCost || 0) * 10) / 10);
  const confirmed = Array.from(new Set((input.confirmedUids || []).filter(Boolean)));
  const confirmedCount = confirmed.length;
  const perPlayerShare =
    confirmedCount > 0 && totalCost > 0
      ? Math.round((totalCost / confirmedCount) * 10) / 10
      : 0;
  let paidCount = 0;
  for (const uid of confirmed) {
    if (input.paidMap && input.paidMap[uid]) paidCount += 1;
  }
  const unpaidCount = Math.max(0, confirmedCount - paidCount);
  const paidTotal = Math.round(paidCount * perPlayerShare * 10) / 10;
  const remainingTotal = Math.max(0, Math.round((totalCost - paidTotal) * 10) / 10);
  return {
    totalCost,
    confirmedCount,
    perPlayerShare,
    paidCount,
    unpaidCount,
    paidTotal,
    remainingTotal,
  };
}

export interface ReportGuardResult {
  allowed: boolean;
  errorAr?: string;
  remainingMinutes?: number;
  sanitized: {
    goals: number;
    assists: number;
    minutes: number;
    goalsConceded: number;
  };
}

/**
 * Enforces anti-XP-abuse rules:
 * 1) 45-minute cooldown between reports by the same player.
 * 2) Realistic per-match caps: max 12 goals, max 12 assists, 1..180 minutes.
 */
export function evaluateReportSubmissionGuard(input: {
  goals: unknown;
  assists: unknown;
  minutes: unknown;
  goalsConceded?: unknown;
  lastReportAtMs?: number | null;
  nowMs?: number;
}): ReportGuardResult {
  const nowMs = typeof input.nowMs === 'number' && Number.isFinite(input.nowMs) ? input.nowMs : Date.now();
  const rawGoals = Number(input.goals ?? 0);
  const rawAssists = Number(input.assists ?? 0);
  const rawMinutes = Number(input.minutes ?? 50);

  const sanitized = {
    goals: Math.round(clampNum(rawGoals, 0, MAX_GOALS_PER_MATCH, 0)),
    assists: Math.round(clampNum(rawAssists, 0, MAX_ASSISTS_PER_MATCH, 0)),
    minutes: Math.round(clampNum(rawMinutes, 1, 180, 50)),
    goalsConceded: Math.round(clampNum(input.goalsConceded ?? 0, 0, MAX_CONCEDED_PER_MATCH, 0)),
  };

  if (Number.isFinite(rawGoals) && rawGoals > MAX_GOALS_PER_MATCH) {
    return {
      allowed: false,
      errorAr: `الحد الأقصى الواقعي للأهداف في المباراة الواحدة هو ${MAX_GOALS_PER_MATCH} هدفاً.`,
      sanitized,
    };
  }
  if (Number.isFinite(rawAssists) && rawAssists > MAX_ASSISTS_PER_MATCH) {
    return {
      allowed: false,
      errorAr: `الحد الأقصى الواقعي للتمريرات الحاسمة في المباراة الواحدة هو ${MAX_ASSISTS_PER_MATCH} تمريرة.`,
      sanitized,
    };
  }

  const lastMs = Number(input.lastReportAtMs || 0);
  if (lastMs > 0 && nowMs - lastMs < REPORT_COOLDOWN_MS) {
    const remainingMs = REPORT_COOLDOWN_MS - (nowMs - lastMs);
    const remainingMinutes = Math.max(1, Math.ceil(remainingMs / 60000));
    return {
      allowed: false,
      remainingMinutes,
      errorAr: `حماية نقاط الخبرة: يمكنك إرسال تقرير مباراة جديد بعد ${remainingMinutes} دقيقة (فاصل 45 دقيقة بين التقارير).`,
      sanitized,
    };
  }

  return { allowed: true, sanitized };
}

/**
 * Pure helper for teammate report confirmation ("تأكيد 👍" -> "موثّق ✓").
 * Prevents self-confirmation and guarantees unique confirmer UIDs.
 */
export function applyReportConfirmation(
  report: {
    ownerUid?: string;
    playerId?: string;
    confirmedByUids?: string[];
  },
  confirmerUid: string
): {
  ok: boolean;
  errorAr?: string;
  confirmedByUids: string[];
  verified: boolean;
  alreadyConfirmed: boolean;
} {
  const uid = String(confirmerUid || '').trim();
  const prev = Array.isArray(report.confirmedByUids)
    ? Array.from(new Set(report.confirmedByUids.map(String).filter(Boolean)))
    : [];

  if (!uid) {
    return {
      ok: false,
      errorAr: 'يرجى تسجيل الدخول لتأكيد تقرير زميلك.',
      confirmedByUids: prev,
      verified: prev.length > 0,
      alreadyConfirmed: false,
    };
  }
  if (uid === String(report.ownerUid || '') || uid === String(report.playerId || '')) {
    return {
      ok: false,
      errorAr: 'لا يمكنك تأكيد تقريرك الشخصي — يوثّقه أحد زملائك في الفريق 👍',
      confirmedByUids: prev,
      verified: prev.length > 0,
      alreadyConfirmed: false,
    };
  }
  if (prev.includes(uid)) {
    return {
      ok: true,
      confirmedByUids: prev,
      verified: prev.length > 0,
      alreadyConfirmed: true,
    };
  }
  const next = [...prev, uid].slice(0, 30);
  return {
    ok: true,
    confirmedByUids: next,
    verified: next.length > 0,
    alreadyConfirmed: false,
  };
}

/**
 * Splits confirmed attendees ("جاي") into two balanced teams using OVR ratings.
 * Falls back to all available players if fewer than 2 players have confirmed attendance yet.
 */
export function autoBalanceConfirmedAttendees(
  players: MinimalPlayer[],
  confirmedIds: string[],
  teamName = 'فريق السداسي'
): {
  usedConfirmedOnly: boolean;
  teamA: Array<MinimalPlayer & { ovr: number; fatigued?: boolean }>;
  teamB: Array<MinimalPlayer & { ovr: number; fatigued?: boolean }>;
  avgA: number;
  avgB: number;
  diff: number;
  whatsappText: string;
} {
  const confirmedSet = new Set((confirmedIds || []).filter(Boolean));
  const confirmedPlayers = (players || []).filter((p) => confirmedSet.has(String(p.id || '')));
  const useConfirmed = confirmedPlayers.length >= 2;
  const pool = useConfirmed
    ? confirmedPlayers
    : (players || []).filter((p) => p.availableStatus !== 'unavailable');
  const split = splitFairTeams(pool, teamName);
  return {
    usedConfirmedOnly: useConfirmed,
    teamA: split.gold,
    teamB: split.silver,
    avgA: split.goldAvg,
    avgB: split.silverAvg,
    diff: split.diff,
    whatsappText: split.whatsappText,
  };
}

declare global {
  interface Window {
    MaydanMultiplayer?: {
      REPORT_COOLDOWN_MS: typeof REPORT_COOLDOWN_MS;
      MAX_GOALS_PER_MATCH: typeof MAX_GOALS_PER_MATCH;
      MAX_ASSISTS_PER_MATCH: typeof MAX_ASSISTS_PER_MATCH;
      normalizeJoinCode: typeof normalizeJoinCode;
      extractJoinCodeFromQrPayload: typeof extractJoinCodeFromQrPayload;
      buildWhatsAppTeamInvite: typeof buildWhatsAppTeamInvite;
      savePendingJoinCode: typeof savePendingJoinCode;
      readPendingJoinCode: typeof readPendingJoinCode;
      clearPendingJoinCode: typeof clearPendingJoinCode;
      isTeamCreator: typeof isTeamCreator;
      isTeamOrganizer: typeof isTeamOrganizer;
      canPublishTeamLineup: typeof canPublishTeamLineup;
      tallyLineupVotes: typeof tallyLineupVotes;
      normalizeAttendanceStatus: typeof normalizeAttendanceStatus;
      computeFlexiblePitchSplit: typeof computeFlexiblePitchSplit;
      evaluateReportSubmissionGuard: typeof evaluateReportSubmissionGuard;
      applyReportConfirmation: typeof applyReportConfirmation;
      autoBalanceConfirmedAttendees: typeof autoBalanceConfirmedAttendees;
    };
  }
}

if (typeof window !== 'undefined') {
  window.MaydanMultiplayer = {
    REPORT_COOLDOWN_MS,
    MAX_GOALS_PER_MATCH,
    MAX_ASSISTS_PER_MATCH,
    normalizeJoinCode,
    extractJoinCodeFromQrPayload,
    buildWhatsAppTeamInvite,
    savePendingJoinCode,
    readPendingJoinCode,
    clearPendingJoinCode,
    isTeamCreator,
    isTeamOrganizer,
    canPublishTeamLineup,
    tallyLineupVotes,
    normalizeAttendanceStatus,
    computeFlexiblePitchSplit,
    evaluateReportSubmissionGuard,
    applyReportConfirmation,
    autoBalanceConfirmedAttendees,
  };
}

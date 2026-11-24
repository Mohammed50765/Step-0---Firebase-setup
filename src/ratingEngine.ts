// Realistic Anti-Inflation Player Rating Engine — Maydan 6v6 / 11v11
// Pure TypeScript, zero external dependencies, NaN & division-by-zero safe, all OVR/stats clamped 40–99.

export type Stat6Key = 'PAC' | 'SHO' | 'PAS' | 'DRI' | 'DEF' | 'PHY';

export interface Stats6 {
  PAC: number;
  SHO: number;
  PAS: number;
  DRI: number;
  DEF: number;
  PHY: number;
}

export type PositionRole = 'ST' | 'CAM_WINGER' | 'CM' | 'DEF_CB' | 'GK';
export type PitchMode = '6v6' | '11v11';
export type MatchResult = 'فوز' | 'تعادل' | 'خسارة';
export type FormArrow = 'up' | 'flat' | 'down';

export const STAT6_KEYS: readonly Stat6Key[] = ['PAC', 'SHO', 'PAS', 'DRI', 'DEF', 'PHY'] as const;

export const STAT6_META: Record<Stat6Key, { key: Stat6Key; labelAr: string; shortLabel: string }> = {
  PAC: { key: 'PAC', labelAr: 'السرعة', shortLabel: 'سرعة PAC' },
  SHO: { key: 'SHO', labelAr: 'التسديد', shortLabel: 'تسديد SHO' },
  PAS: { key: 'PAS', labelAr: 'التمرير', shortLabel: 'تمرير PAS' },
  DRI: { key: 'DRI', labelAr: 'المراوغة', shortLabel: 'مراوغة DRI' },
  DEF: { key: 'DEF', labelAr: 'الدفاع / التصدّي', shortLabel: 'دفاع DEF' },
  PHY: { key: 'PHY', labelAr: 'القوة البدنية', shortLabel: 'لياقة PHY' },
};

export const CREATION_BUDGET = 360;
export const STAT6_MIN = 40;
export const STAT6_MAX = 85;
export const OVR_MIN = 40;
export const OVR_MAX = 99;
export const ROLLING_WINDOW_MIN = 5;
export const ROLLING_WINDOW_MAX = 8;
export const DECLINE_CONSECUTIVE_MATCHES = 3;
export const FORM_WINDOW_MATCHES = 2;

export const PITCH_MODE_MULTIPLIER: Record<PitchMode, number> = {
  '6v6': 1.0,
  '11v11': 2.2,
};

export const TRAINING_ISOLATION_NOTE =
  'التمارين الفردية وسلاسل الالتزام تمنح XP وشارات شخصية فقط، ولا ترفع التقييم الرسمي OVR للبطاقة.';

export interface PositionRoleInfo {
  role: PositionRole;
  code: string;
  labelAr: string;
  primaryStats: readonly Stat6Key[];
  secondaryStats: readonly Stat6Key[];
  weightSummaryAr: string;
}

export const POSITION_ROLE_META: Record<PositionRole, PositionRoleInfo> = {
  ST: {
    role: 'ST',
    code: 'ST',
    labelAr: 'مهاجم (ST)',
    primaryStats: ['SHO', 'DRI', 'PAC'],
    secondaryStats: ['PAS', 'PHY', 'DEF'],
    weightSummaryAr: '70% (تسديد + مراوغة + سرعة) • 30% (تمرير + قوة + دفاع)',
  },
  CAM_WINGER: {
    role: 'CAM_WINGER',
    code: 'CAM',
    labelAr: 'صانع ألعاب / جناح (CAM/RW)',
    primaryStats: ['PAS', 'DRI'],
    secondaryStats: ['PAC', 'SHO', 'DEF', 'PHY'],
    weightSummaryAr: '70% (تمرير + مراوغة) • 30% (سرعة + تسديد + دفاع + قوة)',
  },
  CM: {
    role: 'CM',
    code: 'CM',
    labelAr: 'لاعب وسط (CM)',
    primaryStats: ['PAS', 'DRI', 'PHY'],
    secondaryStats: ['DEF', 'SHO', 'PAC'],
    weightSummaryAr: '70% (تمرير + مراوغة + قوة بدنية) • 30% (دفاع + تسديد + سرعة)',
  },
  DEF_CB: {
    role: 'DEF_CB',
    code: 'CB',
    labelAr: 'مدافع (DEF/CB)',
    primaryStats: ['DEF', 'PHY'],
    secondaryStats: ['PAC', 'PAS', 'DRI', 'SHO'],
    weightSummaryAr: '70% (دفاع + قوة بدنية) • 30% (سرعة + تمرير + مراوغة + تسديد)',
  },
  GK: {
    role: 'GK',
    code: 'GK',
    labelAr: 'حارس مرمى (GK)',
    primaryStats: ['DEF', 'PHY'],
    secondaryStats: ['PAS', 'PAC'],
    weightSummaryAr: '70% (تصدّيات وتمركز DEF + ردة فعل PHY) • 30% (تمرير PAS + سرعة PAC)',
  },
};

export interface BudgetValidationResult {
  valid: boolean;
  total: number;
  budget: number;
  remaining: number;
  stats6: Stats6;
  errors: string[];
}

export interface VerifiedMatchInput {
  id?: string;
  goals?: number;
  assists?: number;
  interceptions?: number;
  turnovers?: number;
  minutes?: number;
  pitchMode?: PitchMode | string;
  matchResult?: MatchResult | string;
  goalsConceded?: number | null;
  /** Collective post-match peer vote on 1–10 scale (optional). */
  peerVoteScore?: number | null;
  /** Draft matches (verified === false or status === 'draft') are excluded from official OVR. */
  verified?: boolean;
  status?: 'draft' | 'verified' | string;
  createdAt?: number | string;
}

export interface MatchPerformanceBreakdown {
  matchScore: number;
  realStatsScore: number;
  peerVoteScoreNormalized: number | null;
  usedPeerVote: boolean;
  pitchMode: PitchMode;
  pitchMultiplier: number;
  cleanSheetBonus: number;
}

export interface RealisticCardRatingInput {
  stats6?: Partial<Stats6> | null;
  legacySkills?: Record<string, number> | null;
  primaryPos?: string;
  roleOverride?: PositionRole | '' | null;
  verifiedMatches?: VerifiedMatchInput[] | null;
  /** Optional official Captain rating (1–10 scale from adminRatings), clearly separated from Self & Peer. */
  captainRatingScore?: number | null;
  /** Explicitly accepted and ignored in OVR math to prove training isolation. */
  trainingXp?: number;
  trainingStreak?: number;
}

export type SampleMaturity = 'none' | 'early' | 'developing' | 'stable';

export interface RatingHistoryEntry {
  date: string;
  selfOvr: number;
  performanceOvr: number | null;
  finalOvr: number;
  matchesCount: number;
  reason: string;
}

export interface RealisticCardRatingResult {
  baseOvr: number;
  finalOvr: number;
  /** Layer 1: Initial / Self-rated position-weighted OVR */
  selfLayerOvr: number;
  /** Layer 2: Field performance OVR (verified matches + peer votes + optional captain rating) */
  performanceLayerOvr: number | null;
  /** Normalized Captain rating (40–99) if provided */
  captainRatingNormalized: number | null;
  /** Sample-size maturity indicator */
  sampleMaturity: SampleMaturity;
  sampleMaturityLabel: string;
  /** Clear, auditable Arabic reasons explaining why the card moved or stayed steady */
  explanationReasons: string[];
  deltaFromMatches: number;
  declineApplied: boolean;
  declineDelta: number;
  formArrow: FormArrow;
  formIcon: string;
  formSymbol: string;
  formLabel: string;
  formDelta: number;
  windowMatchesUsed: number;
  totalVerifiedMatches: number;
  rollingAvgPerformance: number | null;
  diminishingBracket: '60-72' | '73-80' | '81-85' | '86+';
  positionRole: PositionRole;
  positionRoleInfo: PositionRoleInfo;
  stats6: Stats6;
  isLegacyDerived: boolean;
  trainingNote: string;
  matchBreakdowns: MatchPerformanceBreakdown[];
}

// ==================== SAFE MATH HELPERS ====================

export function safeNum(val: unknown, fallback = 0): number {
  const n = typeof val === 'number' ? val : Number(val);
  return Number.isFinite(n) ? n : fallback;
}

export function clamp(val: number, min: number, max: number): number {
  const n = safeNum(val, min);
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

export function safeDivide(numerator: number, denominator: number, fallback = 0): number {
  const num = safeNum(numerator, 0);
  const den = safeNum(denominator, 0);
  if (den === 0) return fallback;
  const out = num / den;
  return Number.isFinite(out) ? out : fallback;
}

export function sanitizePitchMode(mode?: string | null): PitchMode {
  return String(mode || '').trim().toLowerCase() === '11v11' ? '11v11' : '6v6';
}

export function getPitchModeMultiplier(mode?: string | null): number {
  return PITCH_MODE_MULTIPLIER[sanitizePitchMode(mode)];
}

export function sanitizeMatchResult(res?: string | null): MatchResult {
  const r = String(res || '').trim();
  if (r === 'فوز' || r === 'win') return 'فوز';
  if (r === 'خسارة' || r === 'loss') return 'خسارة';
  return 'تعادل';
}

// ==================== POSITION RESOLUTION ====================

export function resolvePositionRole(
  primaryPos?: string | null,
  roleOverride?: PositionRole | '' | null
): PositionRole {
  if (
    roleOverride === 'ST' ||
    roleOverride === 'CAM_WINGER' ||
    roleOverride === 'CM' ||
    roleOverride === 'DEF_CB' ||
    roleOverride === 'GK'
  ) {
    return roleOverride;
  }

  const raw = String(primaryPos || '').trim().toLowerCase();
  if (raw.includes('حارس') || raw === 'gk') return 'GK';
  if (raw.includes('مدافع') || raw.includes('ظهير') || raw === 'cb' || raw === 'def') return 'DEF_CB';
  if (raw.includes('مهاجم') || raw === 'st' || raw === 'cf') return 'ST';
  if (
    raw.includes('جناح') ||
    raw.includes('صانع') ||
    raw === 'cam' ||
    raw === 'rw' ||
    raw === 'lw' ||
    raw === 'winger'
  ) {
    return 'CAM_WINGER';
  }
  return 'CM';
}

// ==================== 360-POINT BUDGET & LEGACY BRIDGE ====================

export function getPresetStats6ForPosition(
  primaryPos?: string | null,
  roleOverride?: PositionRole | '' | null
): Stats6 {
  const role = resolvePositionRole(primaryPos, roleOverride);
  // Every preset sums to exactly 360 with each stat in [40, 85]
  switch (role) {
    case 'ST':
      return { PAC: 68, SHO: 74, PAS: 54, DRI: 66, DEF: 42, PHY: 56 }; // 360
    case 'CAM_WINGER':
      return { PAC: 66, SHO: 60, PAS: 72, DRI: 72, DEF: 42, PHY: 48 }; // 360
    case 'CM':
      return { PAC: 56, SHO: 54, PAS: 70, DRI: 64, DEF: 54, PHY: 62 }; // 360
    case 'DEF_CB':
      return { PAC: 56, SHO: 42, PAS: 54, DRI: 48, DEF: 80, PHY: 80 }; // 360
    case 'GK':
      return { PAC: 50, SHO: 40, PAS: 60, DRI: 44, DEF: 84, PHY: 82 }; // 360
  }
}

export function deriveStats6FromLegacySkills(
  skills?: Record<string, number> | null
): Stats6 {
  if (!skills || typeof skills !== 'object') {
    return { PAC: 60, SHO: 60, PAS: 60, DRI: 60, DEF: 60, PHY: 60 };
  }
  const s = (k: string, fb = 6) => clamp(safeNum(skills[k], fb), 1, 10);
  // Map legacy 1..10 skills into realistic 40..99 range without wiping or inflating
  const scale = (avg10: number) => Math.round(clamp(avg10 * 10, OVR_MIN, OVR_MAX));
  return {
    PAC: scale(s('speed')),
    SHO: scale(s('shooting')),
    PAS: scale((s('passing') + s('vision')) / 2),
    DRI: scale((s('dribbling') + s('control')) / 2),
    DEF: scale((s('defending') + s('positioning')) / 2),
    PHY: scale((s('stamina') + s('teamwork')) / 2),
  };
}

export function normalizeStats6ToBudget(
  rawStats: Partial<Stats6> | null | undefined,
  targetBudget = CREATION_BUDGET
): Stats6 {
  const budget = Math.round(clamp(targetBudget, STAT6_MIN * 6, STAT6_MAX * 6));
  const working: Stats6 = {
    PAC: Math.round(clamp(safeNum(rawStats?.PAC, 60), STAT6_MIN, STAT6_MAX)),
    SHO: Math.round(clamp(safeNum(rawStats?.SHO, 60), STAT6_MIN, STAT6_MAX)),
    PAS: Math.round(clamp(safeNum(rawStats?.PAS, 60), STAT6_MIN, STAT6_MAX)),
    DRI: Math.round(clamp(safeNum(rawStats?.DRI, 60), STAT6_MIN, STAT6_MAX)),
    DEF: Math.round(clamp(safeNum(rawStats?.DEF, 60), STAT6_MIN, STAT6_MAX)),
    PHY: Math.round(clamp(safeNum(rawStats?.PHY, 60), STAT6_MIN, STAT6_MAX)),
  };

  let sum = STAT6_KEYS.reduce((acc, k) => acc + working[k], 0);
  let guard = 0;

  while (sum !== budget && guard < 1000) {
    guard++;
    if (sum > budget) {
      // Decrement highest stat above STAT6_MIN to preserve relative shape
      const candidate = [...STAT6_KEYS]
        .filter((k) => working[k] > STAT6_MIN)
        .sort((a, b) => working[b] - working[a])[0];
      if (!candidate) break;
      working[candidate] -= 1;
      sum -= 1;
    } else {
      // Increment lowest stat below STAT6_MAX to preserve balance
      const candidate = [...STAT6_KEYS]
        .filter((k) => working[k] < STAT6_MAX)
        .sort((a, b) => working[a] - working[b])[0];
      if (!candidate) break;
      working[candidate] += 1;
      sum += 1;
    }
  }

  return working;
}

export function mapStats6ToLegacySkills(
  stats6: Stats6,
  existingSkills?: Record<string, number> | null
): Record<string, number> {
  const to10 = (v: number) => Math.round(clamp(safeNum(v, 60) / 10, 1, 10));
  const base = existingSkills && typeof existingSkills === 'object' ? existingSkills : {};
  const pac = to10(stats6.PAC);
  const sho = to10(stats6.SHO);
  const pas = to10(stats6.PAS);
  const dri = to10(stats6.DRI);
  const def = to10(stats6.DEF);
  const phy = to10(stats6.PHY);

  return {
    ...base,
    speed: pac,
    shooting: sho,
    passing: pas,
    vision: pas,
    dribbling: dri,
    control: dri,
    defending: def,
    positioning: def,
    stamina: phy,
    teamwork: phy,
  };
}

export function validateCardCreationBudget(
  raw: Partial<Record<Stat6Key, unknown>> | null | undefined
): BudgetValidationResult {
  const errors: string[] = [];
  const stats6: Stats6 = {
    PAC: STAT6_MIN,
    SHO: STAT6_MIN,
    PAS: STAT6_MIN,
    DRI: STAT6_MIN,
    DEF: STAT6_MIN,
    PHY: STAT6_MIN,
  };

  let total = 0;

  for (const key of STAT6_KEYS) {
    const rawVal = raw ? raw[key] : undefined;
    const num = Number(rawVal);
    if (!Number.isFinite(num)) {
      errors.push(`قيمة غير صالحة في ${STAT6_META[key].labelAr} (${key})`);
      stats6[key] = STAT6_MIN;
      total += STAT6_MIN;
      continue;
    }
    const rounded = Math.round(num);
    if (rounded < STAT6_MIN || rounded > STAT6_MAX) {
      errors.push(`${STAT6_META[key].labelAr} (${key}) يجب أن تكون بين ${STAT6_MIN} و ${STAT6_MAX}`);
    }
    stats6[key] = Math.round(clamp(rounded, STAT6_MIN, STAT6_MAX));
    total += rounded;
  }

  const remaining = CREATION_BUDGET - total;
  if (remaining > 0) {
    errors.push(`تبقّى ${remaining} نقطة يجب توزيعها للوصول إلى ${CREATION_BUDGET} نقطة.`);
  } else if (remaining < 0) {
    errors.push(`تجاوزت الميزانية بمقدار ${Math.abs(remaining)} نقطة (الحد الأقصى ${CREATION_BUDGET}).`);
  }

  return {
    valid: errors.length === 0 && remaining === 0,
    total,
    budget: CREATION_BUDGET,
    remaining,
    stats6,
    errors,
  };
}

export function hasExplicitStats6(raw: unknown): raw is Stats6 {
  if (!raw || typeof raw !== 'object') return false;
  const obj = raw as Record<string, unknown>;
  return STAT6_KEYS.every((k) => Number.isFinite(Number(obj[k])));
}

// ==================== POSITION-WEIGHTED OVR ====================

export function computePositionWeightedOvr(
  stats6: Partial<Stats6> | null | undefined,
  primaryPos?: string | null,
  roleOverride?: PositionRole | '' | null
): number {
  const role = resolvePositionRole(primaryPos, roleOverride);
  const s: Stats6 = {
    PAC: clamp(safeNum(stats6?.PAC, 60), OVR_MIN, OVR_MAX),
    SHO: clamp(safeNum(stats6?.SHO, 60), OVR_MIN, OVR_MAX),
    PAS: clamp(safeNum(stats6?.PAS, 60), OVR_MIN, OVR_MAX),
    DRI: clamp(safeNum(stats6?.DRI, 60), OVR_MIN, OVR_MAX),
    DEF: clamp(safeNum(stats6?.DEF, 60), OVR_MIN, OVR_MAX),
    PHY: clamp(safeNum(stats6?.PHY, 60), OVR_MIN, OVR_MAX),
  };

  const avg = (keys: readonly Stat6Key[]) => {
    const sum = keys.reduce((acc, k) => acc + s[k], 0);
    return safeDivide(sum, keys.length, 60);
  };

  const info = POSITION_ROLE_META[role];
  const primaryAvg = avg(info.primaryStats);
  const secondaryAvg = avg(info.secondaryStats);
  const weighted = primaryAvg * 0.7 + secondaryAvg * 0.3;

  return Math.round(clamp(weighted, OVR_MIN, OVR_MAX));
}

// ==================== HYBRID MATCH PERFORMANCE (70% STATS + 30% PEER) ====================

export function computeMatchPerformanceScore(
  match: VerifiedMatchInput,
  primaryPos?: string | null,
  roleOverride?: PositionRole | '' | null
): MatchPerformanceBreakdown {
  const role = resolvePositionRole(primaryPos, roleOverride);
  const pitchMode = sanitizePitchMode(match.pitchMode);
  const pitchMultiplier = getPitchModeMultiplier(pitchMode);
  const result = sanitizeMatchResult(match.matchResult);

  const goals = clamp(safeNum(match.goals, 0), 0, 20);
  const assists = clamp(safeNum(match.assists, 0), 0, 20);
  const interceptions = clamp(safeNum(match.interceptions, 0), 0, 40);
  const turnovers = clamp(safeNum(match.turnovers, 0), 0, 40);

  const hasConceded =
    match.goalsConceded !== null &&
    match.goalsConceded !== undefined &&
    Number.isFinite(Number(match.goalsConceded));
  const goalsConceded = hasConceded ? clamp(Number(match.goalsConceded), 0, 30) : null;

  // Baseline match score on 40–99 scale
  let realStatsScore = 60;

  // Weighted goals & assists: 1 goal or assist in 11v11 equals 2.2x its weight in 6v6
  const offensiveContribution = (goals * 6.5 + assists * 4.5) * pitchMultiplier;
  // Soft diminishing cap on single-game attacking stats to avoid absurd spikes
  const cappedAttack = Math.min(34, offensiveContribution);
  realStatsScore += cappedAttack;

  // Result bonus/penalty
  if (result === 'فوز') realStatsScore += 6;
  else if (result === 'تعادل') realStatsScore += 1;
  else realStatsScore -= 4;

  // Clean-sheet / low-goals-conceded bonus specifically for Defenders & Goalkeepers
  let cleanSheetBonus = 0;
  if (role === 'DEF_CB' || role === 'GK') {
    if (goalsConceded !== null) {
      if (goalsConceded === 0) {
        cleanSheetBonus = pitchMode === '11v11' ? 14 : 11;
      } else if (
        (pitchMode === '11v11' && goalsConceded === 1) ||
        (pitchMode === '6v6' && goalsConceded <= 2)
      ) {
        cleanSheetBonus = 6;
      } else if (
        (pitchMode === '11v11' && goalsConceded >= 4) ||
        (pitchMode === '6v6' && goalsConceded >= 6)
      ) {
        cleanSheetBonus = -6;
      }
    }
    // Defensive actions (interceptions / saves) carry higher weight for DEF & GK
    realStatsScore += Math.min(10, interceptions * 1.4);
  } else {
    realStatsScore += Math.min(6, interceptions * 0.7);
  }
  realStatsScore += cleanSheetBonus;

  // Ball security penalty
  realStatsScore -= Math.min(8, turnovers * 0.9);
  realStatsScore = Number(clamp(realStatsScore, OVR_MIN, OVR_MAX).toFixed(2));

  // 30% collective peer vote (1–10 mapped cleanly onto 40–99 scale)
  const rawPeer = match.peerVoteScore;
  const hasPeerVote =
    rawPeer !== null &&
    rawPeer !== undefined &&
    Number.isFinite(Number(rawPeer)) &&
    Number(rawPeer) >= 1 &&
    Number(rawPeer) <= 10;

  const peerVoteScoreNormalized = hasPeerVote
    ? Number(clamp(40 + ((Number(rawPeer) - 1) / 9) * 59, OVR_MIN, OVR_MAX).toFixed(2))
    : null;

  const hybridScore =
    peerVoteScoreNormalized !== null
      ? realStatsScore * 0.7 + peerVoteScoreNormalized * 0.3
      : realStatsScore;

  return {
    matchScore: Number(clamp(hybridScore, OVR_MIN, OVR_MAX).toFixed(2)),
    realStatsScore,
    peerVoteScoreNormalized,
    usedPeerVote: hasPeerVote,
    pitchMode,
    pitchMultiplier,
    cleanSheetBonus,
  };
}

// ==================== DIMINISHING RETURNS & REALISTIC PROGRESSION ====================

export function getDiminishingReturnsConfig(baseOvr: number): {
  bracket: '60-72' | '73-80' | '81-85' | '86+';
  positiveFactor: number;
  maxPositiveDelta: number;
} {
  const ovr = clamp(baseOvr, OVR_MIN, OVR_MAX);
  if (ovr <= 72) {
    return { bracket: '60-72', positiveFactor: 0.55, maxPositiveDelta: 6 };
  }
  if (ovr <= 80) {
    return { bracket: '73-80', positiveFactor: 0.35, maxPositiveDelta: 4 };
  }
  if (ovr <= 85) {
    return { bracket: '81-85', positiveFactor: 0.18, maxPositiveDelta: 2 };
  }
  return { bracket: '86+', positiveFactor: 0.08, maxPositiveDelta: 1 };
}

export function isVerifiedMatch(match: VerifiedMatchInput | null | undefined): boolean {
  if (!match || typeof match !== 'object') return false;
  if (match.verified === false) return false;
  if (String(match.status || '').toLowerCase() === 'draft') return false;
  return true;
}

export function computeRealisticCardRating(
  input: RealisticCardRatingInput
): RealisticCardRatingResult {
  const role = resolvePositionRole(input.primaryPos, input.roleOverride);
  const roleInfo = POSITION_ROLE_META[role];

  const isLegacyDerived = !hasExplicitStats6(input.stats6);
  const stats6: Stats6 = isLegacyDerived
    ? deriveStats6FromLegacySkills(input.legacySkills)
    : {
        PAC: Math.round(clamp(safeNum(input.stats6?.PAC, 60), OVR_MIN, OVR_MAX)),
        SHO: Math.round(clamp(safeNum(input.stats6?.SHO, 60), OVR_MIN, OVR_MAX)),
        PAS: Math.round(clamp(safeNum(input.stats6?.PAS, 60), OVR_MIN, OVR_MAX)),
        DRI: Math.round(clamp(safeNum(input.stats6?.DRI, 60), OVR_MIN, OVR_MAX)),
        DEF: Math.round(clamp(safeNum(input.stats6?.DEF, 60), OVR_MIN, OVR_MAX)),
        PHY: Math.round(clamp(safeNum(input.stats6?.PHY, 60), OVR_MIN, OVR_MAX)),
      };

  const baseOvr = computePositionWeightedOvr(stats6, input.primaryPos, role);
  const diminishing = getDiminishingReturnsConfig(baseOvr);

  // Filter verified matches only (drafts excluded; training XP/streaks intentionally ignored!)
  const verifiedAll = Array.isArray(input.verifiedMatches)
    ? input.verifiedMatches.filter(isVerifiedMatch)
    : [];

  // Rolling window of last 5 to 8 verified matches (caps at 8 -> zero infinite grinding)
  const rollingWindow = verifiedAll.slice(-ROLLING_WINDOW_MAX);
  const matchBreakdowns = rollingWindow.map((m) =>
    computeMatchPerformanceScore(m, input.primaryPos, role)
  );

  const windowCount = matchBreakdowns.length;
  const rollingAvgPerformance =
    windowCount > 0
      ? Number(
          safeDivide(
            matchBreakdowns.reduce((acc, b) => acc + b.matchScore, 0),
            windowCount,
            baseOvr
          ).toFixed(2)
        )
      : null;

  // Optional official Captain rating (1–10 -> 40–99), transparently separated from Self & Peer
  const rawCaptain = input.captainRatingScore;
  const hasCaptainRating =
    rawCaptain !== null &&
    rawCaptain !== undefined &&
    Number.isFinite(Number(rawCaptain)) &&
    Number(rawCaptain) >= 1 &&
    Number(rawCaptain) <= 10;
  const captainRatingNormalized = hasCaptainRating
    ? Number(clamp(40 + ((Number(rawCaptain) - 1) / 9) * 59, OVR_MIN, OVR_MAX).toFixed(1))
    : null;

  // Layer 2: Performance OVR (85% rolling verified matches + 15% Captain rating when both exist)
  const performanceLayerOvr: number | null =
    rollingAvgPerformance !== null && captainRatingNormalized !== null
      ? Math.round(clamp(rollingAvgPerformance * 0.85 + captainRatingNormalized * 0.15, OVR_MIN, OVR_MAX))
      : rollingAvgPerformance !== null
        ? Math.round(clamp(rollingAvgPerformance, OVR_MIN, OVR_MAX))
        : captainRatingNormalized !== null
          ? Math.round(clamp(captainRatingNormalized, OVR_MIN, OVR_MAX))
          : null;

  // Maturity weight ramps smoothly from 1..5 matches, full weight at 5..8 matches
  const maturityWeight = windowCount > 0 ? Math.min(1, safeDivide(windowCount, ROLLING_WINDOW_MIN, 0)) : 0;

  let sampleMaturity: SampleMaturity = 'none';
  let sampleMaturityLabel = 'تقييم أولي فقط — لم تُوثّق مباريات بعد';
  if (windowCount >= ROLLING_WINDOW_MIN) {
    sampleMaturity = 'stable';
    sampleMaturityLabel = `عيّنة مستقرة (${windowCount}/${ROLLING_WINDOW_MAX} مباريات موثّقة)`;
  } else if (windowCount >= 3) {
    sampleMaturity = 'developing';
    sampleMaturityLabel = `عيّنة قيد الاستقرار (${windowCount}/${ROLLING_WINDOW_MIN} مباريات)`;
  } else if (windowCount >= 1) {
    sampleMaturity = 'early';
    sampleMaturityLabel = `عيّنة مبكّرة (${windowCount}/${ROLLING_WINDOW_MIN} — قفزات محدودة لحماية العدالة)`;
  }

  let deltaFromMatches = 0;
  const effectivePerfSource =
    rollingAvgPerformance !== null && captainRatingNormalized !== null
      ? rollingAvgPerformance * 0.85 + captainRatingNormalized * 0.15
      : rollingAvgPerformance;

  if (effectivePerfSource !== null) {
    const rawGap = effectivePerfSource - baseOvr;
    // Anti-single-match-spike cap: 1 match -> max +1, 2 matches -> max +2
    const samplePosCap =
      windowCount <= 1
        ? 1
        : windowCount === 2
          ? Math.min(2, diminishing.maxPositiveDelta)
          : diminishing.maxPositiveDelta;
    if (rawGap > 0) {
      const scaled = rawGap * diminishing.positiveFactor * maturityWeight;
      deltaFromMatches = Math.round(Math.min(samplePosCap, scaled));
    } else if (rawGap < -6 && windowCount >= ROLLING_WINDOW_MIN) {
      // Mild negative pressure if sustained over a full rolling window
      deltaFromMatches = Math.max(-2, Math.round((rawGap + 6) * 0.15 * maturityWeight));
    }
  }

  // Realistic Decline: -1 to base OVR if last 3 consecutive verified matches are significantly below current level
  let declineApplied = false;
  let declineDelta = 0;
  if (matchBreakdowns.length >= DECLINE_CONSECUTIVE_MATCHES) {
    const lastThree = matchBreakdowns.slice(-DECLINE_CONSECUTIVE_MATCHES);
    const poorThreshold = baseOvr - 8;
    if (lastThree.every((b) => b.matchScore < poorThreshold)) {
      declineApplied = true;
      declineDelta = -1;
    }
  }

  const finalOvr = Math.round(clamp(baseOvr + deltaFromMatches + declineDelta, OVR_MIN, OVR_MAX));

  // Separate Form Arrow (last 2 verified matches ONLY — does NOT mutate base OVR)
  let formArrow: FormArrow = 'flat';
  let formIcon = '➖';
  let formSymbol = '▬';
  let formLabel = 'مستقر';
  let formDelta = 0;

  if (matchBreakdowns.length >= 1) {
    const lastTwo = matchBreakdowns.slice(-FORM_WINDOW_MATCHES);
    const lastTwoAvg = safeDivide(
      lastTwo.reduce((acc, b) => acc + b.matchScore, 0),
      lastTwo.length,
      baseOvr
    );
    formDelta = Number((lastTwoAvg - baseOvr).toFixed(1));
    if (formDelta >= 4) {
      formArrow = 'up';
      formIcon = '🟢';
      formSymbol = '▲';
      formLabel = 'صاعد';
    } else if (formDelta <= -4) {
      formArrow = 'down';
      formIcon = '🔴';
      formSymbol = '▼';
      formLabel = 'نازل';
    }
  }

  // Transparent, auditable Arabic explanations for every card state
  const explanationReasons: string[] = [];
  explanationReasons.push(
    `الطبقة 1 (الذاتي الأساسي ${baseOvr}): موزون بمركز ${roleInfo.labelAr} (70% أساسي + 30% ثانوي) من ميزانية 360 نقطة.`
  );
  if (windowCount === 0) {
    explanationReasons.push(
      'الطبقة 2 (الأداء الميداني): بانتظار تسجيل مباريات موثّقة — التقييم الذاتي الأولي نقطة بداية فقط.'
    );
  } else {
    const peerUsedCount = matchBreakdowns.filter((b) => b.usedPeerVote).length;
    const peerNote = peerUsedCount > 0 ? ' + تصويت زملاء جماعي (30%)' : '';
    const capNote = captainRatingNormalized !== null ? ` + تقييم الكابتن (${Number(rawCaptain)}/10)` : '';
    explanationReasons.push(
      `الطبقة 2 (الأداء ${performanceLayerOvr}): معدّل آخر ${windowCount} مباريات موثّقة (${rollingAvgPerformance})${peerNote}${capNote}.`
    );
  }
  if (deltaFromMatches > 0) {
    explanationReasons.push(
      `ارتفاع تدريجي (+${deltaFromMatches}) بعد تطبيق منحنى تناقص العائد (${diminishing.bracket}) وحماية استقرار العيّنة.`
    );
  } else if (deltaFromMatches < 0) {
    explanationReasons.push(
      `انخفاض تدريجي (${deltaFromMatches}) لأن الأداء الميداني في النافذة المتحرّكة أقل من التقييم الأساسي.`
    );
  } else if (windowCount > 0 && !declineApplied) {
    explanationReasons.push(
      'ثبات البطاقة (±0): أداؤك الميداني متوافق مع مستواك الحالي أو لم تتكوّن بعد نافذة كافية لتغيير كبير.'
    );
  }
  if (declineApplied) {
    explanationReasons.push(
      'تراجع واقعي (-1): آخر 3 مباريات موثّقة متتالية كانت أقل بوضوح من مستواك الحالي.'
    );
  }
  if (windowCount > 0 && windowCount < ROLLING_WINDOW_MIN) {
    explanationReasons.push(
      `ملاحظة العيّنة: لعبت ${windowCount} من أصل ${ROLLING_WINDOW_MIN} مباريات لازمة للاستقرار الكامل، لذلك التغيّر محكوم بسقف تدريجي لمنع القفزات من مباراة واحدة.`
    );
  }

  return {
    baseOvr,
    finalOvr,
    selfLayerOvr: baseOvr,
    performanceLayerOvr,
    captainRatingNormalized,
    sampleMaturity,
    sampleMaturityLabel,
    explanationReasons,
    deltaFromMatches,
    declineApplied,
    declineDelta,
    formArrow,
    formIcon,
    formSymbol,
    formLabel,
    formDelta,
    windowMatchesUsed: windowCount,
    totalVerifiedMatches: verifiedAll.length,
    rollingAvgPerformance,
    diminishingBracket: diminishing.bracket,
    positionRole: role,
    positionRoleInfo: roleInfo,
    stats6,
    isLegacyDerived,
    trainingNote: TRAINING_ISOLATION_NOTE,
    matchBreakdowns,
  };
}

// ==================== ZERO-RULE-BREAKAGE LOCAL SIDECAR META ====================
// Keeps stats6 (360-pt cards), sub-role (CM vs CAM), and report pitchMode/result/conceded
// resiliently persisted in both Demo Mode and Firebase Mode without breaking deployed Firestore rules.

const RATING_SIDECAR_KEY = 'maydan_rating_meta_v1';

export interface PlayerRatingMeta {
  stats6?: Stats6;
  roleOverride?: PositionRole | '';
  legacySkillsBackup?: Record<string, number>;
  ratingHistory?: RatingHistoryEntry[];
  updatedAt?: number;
}

export interface ReportRatingMeta {
  pitchMode: PitchMode;
  matchResult: MatchResult;
  goalsConceded: number | null;
}

export interface RatingSidecarStore {
  players: Record<string, PlayerRatingMeta>;
  reports: Record<string, ReportRatingMeta>;
  activePitchMode: PitchMode;
}

function defaultSidecar(): RatingSidecarStore {
  return { players: {}, reports: {}, activePitchMode: '6v6' };
}

export function loadRatingSidecar(): RatingSidecarStore {
  try {
    if (typeof localStorage === 'undefined') return defaultSidecar();
    const raw = localStorage.getItem(RATING_SIDECAR_KEY);
    if (!raw) return defaultSidecar();
    const parsed = JSON.parse(raw);
    return {
      players: parsed && typeof parsed.players === 'object' && parsed.players ? parsed.players : {},
      reports: parsed && typeof parsed.reports === 'object' && parsed.reports ? parsed.reports : {},
      activePitchMode: sanitizePitchMode(parsed?.activePitchMode),
    };
  } catch {
    return defaultSidecar();
  }
}

export function saveRatingSidecar(store: RatingSidecarStore): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(RATING_SIDECAR_KEY, JSON.stringify(store));
  } catch {
    // Ignore storage quota errors
  }
}

export function getPlayerRatingMeta(playerId: string): PlayerRatingMeta | null {
  if (!playerId) return null;
  const store = loadRatingSidecar();
  return store.players[playerId] || null;
}

export function savePlayerRatingMeta(playerId: string, meta: PlayerRatingMeta): void {
  if (!playerId) return;
  const store = loadRatingSidecar();
  store.players[playerId] = {
    ...(store.players[playerId] || {}),
    ...meta,
    updatedAt: Date.now(),
  };
  saveRatingSidecar(store);
}

export function appendPlayerRatingHistory(
  playerId: string,
  entry: RatingHistoryEntry,
  maxEntries = 15
): RatingHistoryEntry[] {
  if (!playerId) return [];
  const store = loadRatingSidecar();
  const prev = store.players[playerId] || {};
  const list = Array.isArray(prev.ratingHistory) ? [...prev.ratingHistory] : [];
  const last = list[list.length - 1];
  const isSameSnapshot =
    last &&
    last.finalOvr === entry.finalOvr &&
    last.selfOvr === entry.selfOvr &&
    last.matchesCount === entry.matchesCount &&
    last.reason === entry.reason;
  if (!isSameSnapshot) {
    list.push({
      date: String(entry.date || new Date().toISOString().slice(0, 10)).slice(0, 10),
      selfOvr: Math.round(clamp(safeNum(entry.selfOvr, 60), OVR_MIN, OVR_MAX)),
      performanceOvr:
        entry.performanceOvr === null
          ? null
          : Math.round(clamp(safeNum(entry.performanceOvr, 60), OVR_MIN, OVR_MAX)),
      finalOvr: Math.round(clamp(safeNum(entry.finalOvr, 60), OVR_MIN, OVR_MAX)),
      matchesCount: Math.max(0, Math.round(safeNum(entry.matchesCount, 0))),
      reason: String(entry.reason || 'تحديث البطاقة').slice(0, 120),
    });
  }
  const trimmed = list.slice(-Math.max(5, maxEntries));
  store.players[playerId] = {
    ...prev,
    ratingHistory: trimmed,
    updatedAt: Date.now(),
  };
  saveRatingSidecar(store);
  return trimmed;
}

export interface ComparisonPlayerSummary {
  name: string;
  primaryPos: string;
  matchesCount: number;
  strengths: Array<{ key: Stat6Key; labelAr: string; val: number }>;
  focusArea: { key: Stat6Key; labelAr: string; val: number };
}

export interface RespectfulComparisonResult {
  playerA: ComparisonPlayerSummary;
  playerB: ComparisonPlayerSummary;
  samePosition: boolean;
  contextNote: string;
  sampleCaution: string;
}

export function buildRespectfulComparisonSummary(
  pA: { name?: string; primaryPos?: string; stats6?: Partial<Stats6> | null; legacySkills?: Record<string, number> | null; matchesCount?: number },
  pB: { name?: string; primaryPos?: string; stats6?: Partial<Stats6> | null; legacySkills?: Record<string, number> | null; matchesCount?: number }
): RespectfulComparisonResult {
  const summarize = (p: typeof pA): ComparisonPlayerSummary => {
    const s6 = hasExplicitStats6(p.stats6)
      ? {
          PAC: Math.round(clamp(safeNum(p.stats6?.PAC, 60), OVR_MIN, OVR_MAX)),
          SHO: Math.round(clamp(safeNum(p.stats6?.SHO, 60), OVR_MIN, OVR_MAX)),
          PAS: Math.round(clamp(safeNum(p.stats6?.PAS, 60), OVR_MIN, OVR_MAX)),
          DRI: Math.round(clamp(safeNum(p.stats6?.DRI, 60), OVR_MIN, OVR_MAX)),
          DEF: Math.round(clamp(safeNum(p.stats6?.DEF, 60), OVR_MIN, OVR_MAX)),
          PHY: Math.round(clamp(safeNum(p.stats6?.PHY, 60), OVR_MIN, OVR_MAX)),
        }
      : deriveStats6FromLegacySkills(p.legacySkills);
    const ranked = STAT6_KEYS.map((k) => ({
      key: k,
      labelAr: STAT6_META[k].labelAr,
      val: s6[k],
    })).sort((a, b) => b.val - a.val);
    return {
      name: String(p.name || 'لاعب'),
      primaryPos: String(p.primaryPos || 'لاعب وسط'),
      matchesCount: Math.max(0, Math.round(safeNum(p.matchesCount, 0))),
      strengths: ranked.slice(0, 2),
      focusArea: ranked[ranked.length - 1],
    };
  };

  const playerA = summarize(pA);
  const playerB = summarize(pB);
  const samePosition = playerA.primaryPos === playerB.primaryPos;
  const contextNote = samePosition
    ? `مقارنة مباشرة ضمن نفس المركز (${playerA.primaryPos}) — تساعد على إبراز نقاط التميّز وفرص التطوير المتبادل.`
    : `مقارنة بين مركزين مختلفين (${playerA.primaryPos} مقابل ${playerB.primaryPos}) — لكل مركز دور مختلف في السداسي، فتفوّق مهارة يعكس طبيعة الدور لا الأفضلية المطلقة.`;

  const minMatches = Math.min(playerA.matchesCount, playerB.matchesCount);
  const diffMatches = Math.abs(playerA.matchesCount - playerB.matchesCount);
  let sampleCaution = 'حجم العيّنة مناسب لقراءة متوازنة بين اللاعبين.';
  if (minMatches < ROLLING_WINDOW_MIN) {
    sampleCaution = `تنبيه عيّنة مبكّرة: أحد اللاعبين لعب أقل من ${ROLLING_WINDOW_MIN} مباريات موثّقة، لذا تعتمد القراءة بدرجة أكبر على التوزيع الأولي.`;
  } else if (diffMatches >= 4) {
    sampleCaution = `يوجد فرق في عدد المباريات الموثّقة (${playerA.matchesCount} مقابل ${playerB.matchesCount})، يُنصح بمراعاة ذلك عند القراءة.`;
  }

  return { playerA, playerB, samePosition, contextNote, sampleCaution };
}

export function getReportKey(rep: { id?: string; playerId?: string; opponent?: string; goals?: number; assists?: number; minutes?: number }): string {
  if (rep.id) return String(rep.id);
  return `${rep.playerId || 'p'}_${rep.opponent || 'm'}_${safeNum(rep.goals)}_${safeNum(rep.assists)}_${safeNum(rep.minutes)}`;
}

export function getReportRatingMeta(rep: Parameters<typeof getReportKey>[0]): ReportRatingMeta | null {
  const store = loadRatingSidecar();
  return store.reports[getReportKey(rep)] || null;
}

export function saveReportRatingMeta(
  rep: Parameters<typeof getReportKey>[0],
  meta: ReportRatingMeta
): void {
  const store = loadRatingSidecar();
  store.reports[getReportKey(rep)] = {
    pitchMode: sanitizePitchMode(meta.pitchMode),
    matchResult: sanitizeMatchResult(meta.matchResult),
    goalsConceded:
      meta.goalsConceded !== null &&
      meta.goalsConceded !== undefined &&
      Number.isFinite(Number(meta.goalsConceded))
        ? Math.round(clamp(Number(meta.goalsConceded), 0, 30))
        : null,
  };
  saveRatingSidecar(store);
}

export function getActivePitchMode(): PitchMode {
  return loadRatingSidecar().activePitchMode;
}

export function setActivePitchMode(mode: string): PitchMode {
  const clean = sanitizePitchMode(mode);
  const store = loadRatingSidecar();
  store.activePitchMode = clean;
  saveRatingSidecar(store);
  return clean;
}

// ==================== WINDOW EXPORT ====================

const MaydanRatingApi = {
  STAT6_KEYS,
  STAT6_META,
  CREATION_BUDGET,
  STAT6_MIN,
  STAT6_MAX,
  OVR_MIN,
  OVR_MAX,
  ROLLING_WINDOW_MIN,
  ROLLING_WINDOW_MAX,
  PITCH_MODE_MULTIPLIER,
  POSITION_ROLE_META,
  TRAINING_ISOLATION_NOTE,
  safeNum,
  clamp,
  safeDivide,
  sanitizePitchMode,
  getPitchModeMultiplier,
  sanitizeMatchResult,
  resolvePositionRole,
  getPresetStats6ForPosition,
  deriveStats6FromLegacySkills,
  normalizeStats6ToBudget,
  mapStats6ToLegacySkills,
  validateCardCreationBudget,
  hasExplicitStats6,
  computePositionWeightedOvr,
  computeMatchPerformanceScore,
  getDiminishingReturnsConfig,
  isVerifiedMatch,
  computeRealisticCardRating,
  loadRatingSidecar,
  getPlayerRatingMeta,
  savePlayerRatingMeta,
  appendPlayerRatingHistory,
  buildRespectfulComparisonSummary,
  getReportKey,
  getReportRatingMeta,
  saveReportRatingMeta,
  getActivePitchMode,
  setActivePitchMode,
};

declare global {
  interface Window {
    MaydanRating?: typeof MaydanRatingApi;
  }
}

if (typeof window !== 'undefined') {
  window.MaydanRating = MaydanRatingApi;
}

export default MaydanRatingApi;

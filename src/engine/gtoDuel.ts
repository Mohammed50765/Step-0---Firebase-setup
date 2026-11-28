import { clampNumber } from './tacticalGeometry';

export type GtoDuelAction = 'inside_cut' | 'outside_line' | 'feint_burst' | 'pass_keep';

export interface GtoDuelActionMeta {
  id: GtoDuelAction;
  labelAr: string;
  shortAr: string;
  riskTagAr: string;
}

export const GTO_DUEL_ACTIONS: GtoDuelActionMeta[] = [
  { id: 'inside_cut', labelAr: 'المراوغة للداخل', shortAr: 'للداخل', riskTagAr: 'اختراق نحو العمق' },
  { id: 'outside_line', labelAr: 'الخروج نحو الخط', shortAr: 'نحو الخط', riskTagAr: 'انطلاق على الطرف' },
  { id: 'feint_burst', labelAr: 'التمويه ثم الانطلاق', shortAr: 'تمويه وانطلاق', riskTagAr: 'كسر توازن المدافع' },
  { id: 'pass_keep', labelAr: 'التمرير / الاحتفاظ بالكرة', shortAr: 'تمرير / احتفاظ', riskTagAr: 'خيار أمان وتغيير إيقاع' },
];

export const ALL_GTO_ACTIONS: GtoDuelAction[] = [
  'inside_cut',
  'outside_line',
  'feint_burst',
  'pass_keep',
];

export interface DefenderStance {
  /** Which move the adaptive defender is currently leaning to close */
  anticipatedMove: GtoDuelAction;
  /** Visual body angle in degrees (-35 = closing outside, +35 = closing inside, 0 = square) */
  stanceDeg: number;
  /** Visual horizontal body shade (-1..+1) */
  bodyShadeX: number;
  /** Probability weights across the 4 moves (sum = 1) */
  weights: Record<GtoDuelAction, number>;
  /** Short tactical visual cue shown to the player */
  cueAr: string;
}

export type DuelOutcomeKind = 'win' | 'partial' | 'stopped';

export interface GtoDuelRoundRecord {
  round: number;
  playerAction: GtoDuelAction;
  defenderRead: GtoDuelAction;
  outcome: DuelOutcomeKind;
  points: number;
  reasonAr: string;
}

export interface PredictabilityAssessment {
  sampleSize: number;
  sufficientSample: boolean;
  /** Null when sampleSize < 5 to avoid misleading precision on tiny samples */
  predictabilityPct: number | null;
  labelAr: string;
  dominantAction: GtoDuelAction | null;
  dominantSharePct: number;
}

export interface GtoDuelSessionState {
  history: GtoDuelRoundRecord[];
  stance: DefenderStance;
  score: number;
  wins: number;
  partials: number;
  stopped: number;
}

export interface GtoDuelSummaryReport {
  totalRounds: number;
  wins: number;
  partials: number;
  stopped: number;
  winRatePct: number;
  predictability: PredictabilityAssessment;
  actionCounts: Record<GtoDuelAction, number>;
  repeatedPatternAr: string;
  diversificationTipAr: string;
  disclaimerAr: string;
}

export const MIN_PREDICTABILITY_SAMPLES = 5;

const ACTION_LABELS_AR: Record<GtoDuelAction, string> = {
  inside_cut: 'المراوغة للداخل',
  outside_line: 'الخروج نحو الخط',
  feint_burst: 'التمويه ثم الانطلاق',
  pass_keep: 'التمرير / الاحتفاظ بالكرة',
};

function computeAdaptiveWeights(history: GtoDuelRoundRecord[]): Record<GtoDuelAction, number> {
  // Prior: neutral balanced defender with slight respect for inside cut in 6v6
  const raw: Record<GtoDuelAction, number> = {
    inside_cut: 0.28,
    outside_line: 0.26,
    feint_burst: 0.26,
    pass_keep: 0.2,
  };

  if (!history.length) return raw;

  // 1) Time-decayed move frequencies (recent habits weigh much higher)
  const decay = 0.78;
  const freq: Record<GtoDuelAction, number> = {
    inside_cut: 0,
    outside_line: 0,
    feint_burst: 0,
    pass_keep: 0,
  };
  let freqTotal = 0;
  for (let i = history.length - 1, age = 0; i >= 0; i--, age++) {
    const w = Math.pow(decay, age);
    freq[history[i].playerAction] += w;
    freqTotal += w;
  }

  // 2) First-order transition tendency P(next | prev)
  const lastAction = history[history.length - 1].playerAction;
  const trans: Record<GtoDuelAction, number> = {
    inside_cut: 0,
    outside_line: 0,
    feint_burst: 0,
    pass_keep: 0,
  };
  let transTotal = 0;
  for (let i = 0; i < history.length - 1; i++) {
    if (history[i].playerAction === lastAction) {
      const nextAct = history[i + 1].playerAction;
      trans[nextAct] += 1;
      transTotal += 1;
    }
  }

  // 3) Streak bonus if player repeated the exact same move 2+ times in a row
  let streakCount = 1;
  for (let i = history.length - 2; i >= 0; i--) {
    if (history[i].playerAction === lastAction) streakCount++;
    else break;
  }

  // Blend prior + frequency + transition smoothly (adapts noticeably by round 3+)
  const adaptStrength = clampNumber(history.length / 6, 0.22, 0.78);
  const blended: Record<GtoDuelAction, number> = {
    inside_cut: 0,
    outside_line: 0,
    feint_burst: 0,
    pass_keep: 0,
  };

  let sum = 0;
  for (const a of ALL_GTO_ACTIONS) {
    const fProb = freqTotal > 0 ? freq[a] / freqTotal : 0.25;
    const tProb = transTotal > 0 ? trans[a] / transTotal : fProb;
    const empirical = transTotal >= 2 ? fProb * 0.62 + tProb * 0.38 : fProb;
    const streakBoost = a === lastAction && streakCount >= 2 ? Math.min(0.28, (streakCount - 1) * 0.14) : 0;
    const w = raw[a] * (1 - adaptStrength) + empirical * adaptStrength + streakBoost;
    blended[a] = Math.max(0.06, w);
    sum += blended[a];
  }

  for (const a of ALL_GTO_ACTIONS) {
    blended[a] = Number((blended[a] / sum).toFixed(3));
  }
  return blended;
}

export function buildDefenderStance(history: GtoDuelRoundRecord[]): DefenderStance {
  const weights = computeAdaptiveWeights(history);

  let anticipatedMove: GtoDuelAction = 'inside_cut';
  let maxW = -1;
  for (const a of ALL_GTO_ACTIONS) {
    if (weights[a] > maxW) {
      maxW = weights[a];
      anticipatedMove = a;
    }
  }

  // Visual stance cues reflect what lane the defender is leaning to close
  if (history.length === 0) {
    return {
      anticipatedMove: 'inside_cut',
      stanceDeg: 6,
      bodyShadeX: 0.12,
      weights,
      cueAr: 'وقفة متوازنة — يراقب قدمك القوية ويبقي مسافة متوسطة.',
    };
  }

  switch (anticipatedMove) {
    case 'inside_cut':
      return {
        anticipatedMove,
        stanceDeg: 28,
        bodyShadeX: 0.65,
        weights,
        cueAr: 'يميل بجسده لإغلاق العمق والداخل — ترك مساحة أكبر نحو الخط.',
      };
    case 'outside_line':
      return {
        anticipatedMove,
        stanceDeg: -28,
        bodyShadeX: -0.65,
        weights,
        cueAr: 'يغلق ممر الطرف والخط الجانبي — يفتح زاوية القطع للداخل.',
      };
    case 'feint_burst':
      return {
        anticipatedMove,
        stanceDeg: 0,
        bodyShadeX: 0,
        weights,
        cueAr: 'يتراجع نصف خطوة متأهباً للتمويه — لا يندفع للخدعة الأولى بسهولة.',
      };
    case 'pass_keep':
      return {
        anticipatedMove,
        stanceDeg: -10,
        bodyShadeX: -0.2,
        weights,
        cueAr: 'ينقضّ للأمام لقطع التمرير وإجبارك على مواجهة مباشرة.',
      };
  }
}

export function createGtoDuelState(): GtoDuelSessionState {
  return {
    history: [],
    stance: buildDefenderStance([]),
    score: 0,
    wins: 0,
    partials: 0,
    stopped: 0,
  };
}

function sampleWeightedAction(weights: Record<GtoDuelAction, number>, rng: () => number): GtoDuelAction {
  const r = clampNumber(rng(), 0, 0.999999);
  let acc = 0;
  for (const a of ALL_GTO_ACTIONS) {
    acc += weights[a];
    if (r <= acc) return a;
  }
  return 'inside_cut';
}

/**
 * Resolves one 1v1 duel round against the adaptive defender and updates state immutably.
 */
export function stepGtoDuel(
  state: GtoDuelSessionState,
  playerAction: GtoDuelAction,
  rng: () => number = Math.random
): { nextState: GtoDuelSessionState; record: GtoDuelRoundRecord } {
  const weights = state.stance.weights;
  const defenderRead = sampleWeightedAction(weights, rng);

  let outcome: DuelOutcomeKind = 'win';
  let points = 3;
  let reasonAr = '';

  if (defenderRead === playerAction) {
    if (playerAction === 'pass_keep') {
      // Safe pass/retain under read pressure is partial retention rather than clean turnover
      outcome = 'partial';
      points = 1;
      reasonAr = 'توقّع المدافع محاولتك للاحتفاظ بالكرة وضغط عليك — حافظت عليها بصعوبة دون تقدم.';
    } else {
      outcome = 'stopped';
      points = 0;
      reasonAr = `قرأ المدافع «${ACTION_LABELS_AR[playerAction]}» وأغلق الزاوية بنجاح.`;
    }
  } else if (playerAction === 'pass_keep') {
    outcome = 'partial';
    points = 2;
    reasonAr = `كان المدافع متأهباً لـ «${ACTION_LABELS_AR[defenderRead]}» — مرّرت بأمان وأربكت توقّعه.`;
  } else {
    // Player exploited an open lane away from defender's anticipation!
    outcome = 'win';
    points = 3;
    reasonAr = `استغللت توقّع المدافع لـ «${ACTION_LABELS_AR[defenderRead]}» وتجاوزته بـ «${ACTION_LABELS_AR[playerAction]}» ✓`;
  }

  const record: GtoDuelRoundRecord = {
    round: state.history.length + 1,
    playerAction,
    defenderRead,
    outcome,
    points,
    reasonAr,
  };

  const nextHistory = [...state.history, record];
  const nextState: GtoDuelSessionState = {
    history: nextHistory,
    stance: buildDefenderStance(nextHistory),
    score: state.score + points,
    wins: state.wins + (outcome === 'win' ? 1 : 0),
    partials: state.partials + (outcome === 'partial' ? 1 : 0),
    stopped: state.stopped + (outcome === 'stopped' ? 1 : 0),
  };

  return { nextState, record };
}

/**
 * Sample-size-aware predictability indicator.
 * Explicitly avoids misleading percentages when fewer than MIN_PREDICTABILITY_SAMPLES rounds were played.
 */
export function computePredictabilityAssessment(
  history: GtoDuelRoundRecord[]
): PredictabilityAssessment {
  const n = history.length;
  const counts: Record<GtoDuelAction, number> = {
    inside_cut: 0,
    outside_line: 0,
    feint_burst: 0,
    pass_keep: 0,
  };
  for (const r of history) counts[r.playerAction]++;

  let dominantAction: GtoDuelAction | null = null;
  let maxCount = 0;
  for (const a of ALL_GTO_ACTIONS) {
    if (counts[a] > maxCount) {
      maxCount = counts[a];
      dominantAction = a;
    }
  }
  const dominantSharePct = n > 0 ? Math.round((maxCount / n) * 100) : 0;

  if (n < MIN_PREDICTABILITY_SAMPLES) {
    return {
      sampleSize: n,
      sufficientSample: false,
      predictabilityPct: null,
      labelAr: `عينة أولية (${n}/${MIN_PREDICTABILITY_SAMPLES}) — العب ${MIN_PREDICTABILITY_SAMPLES - n} جولات إضافية لقياس النمط`,
      dominantAction,
      dominantSharePct,
    };
  }

  // Normalized Shannon entropy across 4 moves: H_norm = H / log2(4) in [0..1]
  // Predictability = (1 - H_norm) blended with adjacent repeat rate
  let entropy = 0;
  for (const a of ALL_GTO_ACTIONS) {
    const p = counts[a] / n;
    if (p > 0) entropy -= p * Math.log2(p);
  }
  const normEntropy = entropy / Math.log2(ALL_GTO_ACTIONS.length);

  let repeats = 0;
  for (let i = 1; i < n; i++) {
    if (history[i].playerAction === history[i - 1].playerAction) repeats++;
  }
  const repeatRate = repeats / Math.max(1, n - 1);

  const rawPred = (1 - normEntropy) * 0.72 + repeatRate * 0.28;
  const predictabilityPct = Math.round(clampNumber(rawPred * 100, 0, 100));

  let labelAr = 'متنوّع ويصعب توقّعه ✓';
  if (predictabilityPct >= 62) labelAr = 'متكرر بوضوح — يسهل على المدافع قراءته';
  else if (predictabilityPct >= 38) labelAr = 'ميل متوسط للتكرار — نوّع الإيقاع';

  return {
    sampleSize: n,
    sufficientSample: true,
    predictabilityPct,
    labelAr,
    dominantAction,
    dominantSharePct,
  };
}

export function summarizeGtoDuelSession(state: GtoDuelSessionState): GtoDuelSummaryReport {
  const totalRounds = state.history.length;
  const actionCounts: Record<GtoDuelAction, number> = {
    inside_cut: 0,
    outside_line: 0,
    feint_burst: 0,
    pass_keep: 0,
  };
  for (const r of state.history) actionCounts[r.playerAction]++;

  const predictability = computePredictabilityAssessment(state.history);
  const winRatePct = totalRounds ? Math.round((state.wins / totalRounds) * 100) : 0;

  // Least used move for actionable diversification advice
  let leastUsed: GtoDuelAction = 'outside_line';
  let minCount = Infinity;
  for (const a of ALL_GTO_ACTIONS) {
    if (actionCounts[a] < minCount) {
      minCount = actionCounts[a];
      leastUsed = a;
    }
  }

  const repeatedPatternAr =
    predictability.dominantAction && totalRounds >= 3
      ? `أكثر حركة استخدمتها: «${ACTION_LABELS_AR[predictability.dominantAction]}» (${actionCounts[predictability.dominantAction]} من ${totalRounds} جولات).`
      : 'العب بضع جولات إضافية لاكتشاف نمطك المفضل في المواجهات الفردية.';

  const diversificationTipAr =
    totalRounds >= 3
      ? `نصيحة عملية: أدخِل «${ACTION_LABELS_AR[leastUsed]}» أكثر لكسر توقّع المدافع، وراقب ميلان جسده قبل اتخاذ القرار.`
      : 'راقب وقفة المدافع ونوّع بين الداخل والخط والتمويه حتى لا يغلق خيارك المفضل.';

  return {
    totalRounds,
    wins: state.wins,
    partials: state.partials,
    stopped: state.stopped,
    winRatePct,
    predictability,
    actionCounts,
    repeatedPatternAr,
    diversificationTipAr,
    disclaimerAr:
      'مدافع تدريبي متكيّف مستلهم من نظرية الألعاب لتمرين التنويع في 1 ضد 1 — وليس حاسباً رياضياً لتوازن ناش.',
  };
}

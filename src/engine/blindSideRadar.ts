import { clampNumber, type PitchPoint } from './tacticalGeometry';
import { analyzePassingLanes } from './dominanceXRay';

export type BlindSideDecisionId = 'pass_direct' | 'turn_away' | 'wall_pass' | 'shield_feint';

export type BlindSideDifficulty = 1 | 2 | 3;

export type BlindSideMistakeType =
  | 'blind_side_press'
  | 'missed_open_lane'
  | 'turned_into_trap'
  | 'timeout';

export interface BlindSideOptionMeta {
  id: BlindSideDecisionId;
  labelAr: string;
  shortAr: string;
}

export const BLIND_SIDE_OPTIONS: BlindSideOptionMeta[] = [
  { id: 'pass_direct', labelAr: 'تمريرة مباشرة لزميل مفتوح', shortAr: 'تمريرة مباشرة' },
  { id: 'turn_away', labelAr: 'دوران بعيداً عن جهة الضغط', shortAr: 'دوران بعيداً عن الضغط' },
  { id: 'wall_pass', labelAr: 'تمريرة جدارية سريعة (ون-تو)', shortAr: 'تمريرة جدارية' },
  { id: 'shield_feint', labelAr: 'حماية الكرة / تمويه لكسب ثانية', shortAr: 'حماية / تمويه' },
];

export interface BlindSideScenario {
  scenarioKey: string;
  titleAr: string;
  situationPromptAr: string;
  difficulty: BlindSideDifficulty;
  peekMs: number;
  decisionMs: number;
  our: PitchPoint[];
  opp: PitchPoint[];
  ball: PitchPoint;
  carrierIdx: number;
  /** Indices of opponent players hidden during the decision phase */
  maskedOppIndices: number[];
  /** Indices of teammates hidden during the decision phase (optional in higher difficulty) */
  maskedOurIndices: number[];
  /** Best tactical decision & acceptable secondary decision */
  bestDecision: BlindSideDecisionId;
  acceptableDecision?: BlindSideDecisionId;
  explanationAr: string;
  mistakeCategoryOnWrong: BlindSideMistakeType;
  audioCue: {
    /** Stereo pan -1 (left) .. +1 (right) corresponding to blind-side presser side */
    pan: number;
    urgency: 'low' | 'medium' | 'high';
  };
}

export interface BlindSideRoundOutcome {
  scenarioKey: string;
  difficulty: BlindSideDifficulty;
  chosen: BlindSideDecisionId | null;
  bestDecision: BlindSideDecisionId;
  correct: boolean;
  partial: boolean;
  timedOut: boolean;
  responseMs: number;
  mistakeType: BlindSideMistakeType | null;
  feedbackAr: string;
}

export interface BlindSideSessionSummary {
  totalRounds: number;
  correctCount: number;
  partialCount: number;
  accuracyPct: number;
  avgResponseMs: number;
  fastestResponseMs: number | null;
  topMistakeAr: string;
  mistakeCounts: Record<BlindSideMistakeType, number>;
  disclaimerAr: string;
}

interface ScenarioTemplate {
  baseKey: string;
  minLevel: BlindSideDifficulty;
  titleAr: string;
  promptAr: string;
  our: PitchPoint[];
  opp: PitchPoint[];
  carrierIdx: number;
  maskedOppIndices: number[];
  maskedOurIndices: number[];
  bestDecision: BlindSideDecisionId;
  acceptableDecision?: BlindSideDecisionId;
  explanationAr: string;
  mistakeCategoryOnWrong: BlindSideMistakeType;
  blindPressSide: -1 | 1;
}

const BASE_TEMPLATES: ScenarioTemplate[] = [
  {
    baseKey: 'rear_press_open_turn',
    minLevel: 1,
    titleAr: 'ضغط صامت من الكتف الأيمن',
    promptAr: 'تستلم الكرة بظهرك في الوسط — ركّز أين يضغط الخصم قبل إخفائه.',
    our: [
      { x: 50, y: 90 },
      { x: 26, y: 74 },
      { x: 74, y: 74 },
      { x: 52, y: 50 }, // carrier
      { x: 22, y: 36 },
      { x: 64, y: 24 },
    ],
    opp: [
      { x: 50, y: 11 },
      { x: 30, y: 26 },
      { x: 66, y: 30 },
      { x: 60, y: 55 }, // blind-side presser right/rear
      { x: 34, y: 48 }, // cuts left pass slightly
      { x: 50, y: 69 },
    ],
    carrierIdx: 3,
    maskedOppIndices: [3],
    maskedOurIndices: [],
    bestDecision: 'turn_away',
    acceptableDecision: 'shield_feint',
    explanationAr: 'المدافع يندفع من جهتك اليمنى الخلفية؛ الدوران باللمسة الأولى للجهة اليسرى المفتوحة يكسر ضغطه فوراً.',
    mistakeCategoryOnWrong: 'blind_side_press',
    blindPressSide: 1,
  },
  {
    baseKey: 'wide_overload_direct_pass',
    minLevel: 1,
    titleAr: 'انطلاق الجناح في المساحة الخالية',
    promptAr: 'قبل استلام التمريرة، افحص الجبهة المعاكسة لترى المسار المفتوح.',
    our: [
      { x: 50, y: 90 },
      { x: 32, y: 73 },
      { x: 72, y: 66 },
      { x: 68, y: 52 }, // carrier
      { x: 20, y: 33 }, // wide open teammate
      { x: 54, y: 26 },
    ],
    opp: [
      { x: 50, y: 11 },
      { x: 46, y: 28 },
      { x: 68, y: 34 },
      { x: 74, y: 57 }, // presser on touchline
      { x: 58, y: 49 },
      { x: 44, y: 62 },
    ],
    carrierIdx: 3,
    maskedOppIndices: [3, 4],
    maskedOurIndices: [],
    bestDecision: 'pass_direct',
    acceptableDecision: 'wall_pass',
    explanationAr: 'الخصم تكتّل على طرفك وترك الجناح العكسي حراً بالكامل — التمريرة المباشرة تغيّر اللعب وتضرب الضغط.',
    mistakeCategoryOnWrong: 'missed_open_lane',
    blindPressSide: 1,
  },
  {
    baseKey: 'triangle_wall_pass',
    minLevel: 1,
    titleAr: 'كماشة الوسط والمثلث الجداري',
    promptAr: 'خصمان يغلقان التقدم الفردي — ابحث عن زميل قريب للمسة جدارية.',
    our: [
      { x: 50, y: 90 },
      { x: 30, y: 74 },
      { x: 70, y: 72 },
      { x: 38, y: 54 }, // carrier
      { x: 53, y: 42 }, // wall-pass partner
      { x: 34, y: 24 },
    ],
    opp: [
      { x: 50, y: 11 },
      { x: 36, y: 28 },
      { x: 64, y: 30 },
      { x: 37, y: 45 }, // blocks front dribble
      { x: 28, y: 57 }, // blind-side left trap
      { x: 58, y: 58 },
    ],
    carrierIdx: 3,
    maskedOppIndices: [4],
    maskedOurIndices: [],
    bestDecision: 'wall_pass',
    acceptableDecision: 'pass_direct',
    explanationAr: 'المدافعان يضغطان من الأمام واليسار، والزميل على يمينك بزاوية 45° مثالي لتمريرة جدارية (ون-تو) تتجاوز الكماشة.',
    mistakeCategoryOnWrong: 'turned_into_trap',
    blindPressSide: -1,
  },
  {
    baseKey: 'high_press_shield_feint',
    minLevel: 2,
    titleAr: 'إغلاق كامل لخطوط التمرير',
    promptAr: 'زملاؤك تحت رقابة لصيقة أثناء الاستلام — ما القرار الأكثر أماناً؟',
    our: [
      { x: 50, y: 90 },
      { x: 28, y: 72 },
      { x: 72, y: 72 },
      { x: 50, y: 58 }, // carrier
      { x: 24, y: 40 },
      { x: 76, y: 40 },
    ],
    opp: [
      { x: 50, y: 11 },
      { x: 28, y: 45 }, // covers left pass
      { x: 72, y: 45 }, // covers right pass
      { x: 46, y: 50 }, // front pressure
      { x: 56, y: 63 }, // rear blind-side pressure
      { x: 50, y: 30 },
    ],
    carrierIdx: 3,
    maskedOppIndices: [1, 4],
    maskedOurIndices: [],
    bestDecision: 'shield_feint',
    acceptableDecision: 'turn_away',
    explanationAr: 'خطوط التمرير الأمامية مغلقة في هذه اللحظة؛ حماية الكرة بالجسد مع تمويه سريع تكسب ثانية لفتح زميلك.',
    mistakeCategoryOnWrong: 'blind_side_press',
    blindPressSide: 1,
  },
  {
    baseKey: 'pivot_split_lane',
    minLevel: 2,
    titleAr: 'تمريرة كسر الخط للمهاجم الثابت',
    promptAr: 'مدافع الخصم يندفع متأخراً ويفتح فجوة في العمق — هل التقطتها؟',
    our: [
      { x: 50, y: 90 },
      { x: 28, y: 76 },
      { x: 72, y: 76 },
      { x: 48, y: 60 }, // carrier
      { x: 74, y: 46 },
      { x: 50, y: 27 }, // striker open between defenders
    ],
    opp: [
      { x: 50, y: 11 },
      { x: 30, y: 31 },
      { x: 70, y: 31 },
      { x: 38, y: 54 }, // blind-side left presser
      { x: 64, y: 52 },
      { x: 48, y: 72 },
    ],
    carrierIdx: 3,
    maskedOppIndices: [1, 3],
    maskedOurIndices: [5],
    bestDecision: 'pass_direct',
    explanationAr: 'انفراج قلبي دفاع الخصم فتح ممراً مباشراً للمهاجم في العمق — التمريرة العمودية المباشرة هي الحل الأخطر.',
    mistakeCategoryOnWrong: 'missed_open_lane',
    blindPressSide: -1,
  },
  {
    baseKey: 'blind_double_press_escape',
    minLevel: 3,
    titleAr: 'فخ الضغط المزدوج على الخط',
    promptAr: 'نافذة المسح قصيرة جداً — حدّد مخرج الهروب قبل إغلاق الزاوية.',
    our: [
      { x: 50, y: 90 },
      { x: 34, y: 76 },
      { x: 74, y: 70 },
      { x: 80, y: 50 }, // carrier near right touchline
      { x: 56, y: 46 }, // interior support
      { x: 44, y: 24 },
    ],
    opp: [
      { x: 50, y: 11 },
      { x: 42, y: 28 },
      { x: 68, y: 34 },
      { x: 75, y: 43 }, // blocks forward line
      { x: 77, y: 58 }, // blind-side rear trap
      { x: 48, y: 58 },
    ],
    carrierIdx: 3,
    maskedOppIndices: [3, 4],
    maskedOurIndices: [4],
    bestDecision: 'wall_pass',
    acceptableDecision: 'pass_direct',
    explanationAr: 'الخط الجانبي مغلق من الأمام والخلف؛ اللمسة الجدارية للداخل نحو لاعب الوسط تكسر المصيدة وتفتح العمق.',
    mistakeCategoryOnWrong: 'turned_into_trap',
    blindPressSide: 1,
  },
  {
    baseKey: 'counter_press_blind_turn',
    minLevel: 3,
    titleAr: 'ارتداد الخصم السريع بعد افتكاك الكرة',
    promptAr: 'افتككت الكرة للتو — المساحة خلف كتفك الأيسر مفتوحة أم مغلقة؟',
    our: [
      { x: 50, y: 90 },
      { x: 30, y: 74 },
      { x: 70, y: 74 },
      { x: 44, y: 52 }, // carrier
      { x: 76, y: 38 },
      { x: 32, y: 26 },
    ],
    opp: [
      { x: 50, y: 11 },
      { x: 34, y: 32 },
      { x: 64, y: 34 },
      { x: 35, y: 55 }, // blind-side left presser
      { x: 54, y: 44 }, // covers right direct pass slightly
      { x: 48, y: 68 },
    ],
    carrierIdx: 3,
    maskedOppIndices: [3, 4],
    maskedOurIndices: [4],
    bestDecision: 'turn_away',
    acceptableDecision: 'shield_feint',
    explanationAr: 'الضغط الفوري قادم من يسارك؛ الدوران السريع نحو العمق الأيمن يخرجك من الزحام نحو المساحة الفارغة.',
    mistakeCategoryOnWrong: 'blind_side_press',
    blindPressSide: -1,
  },
];

function mirrorX(pt: PitchPoint): PitchPoint {
  return { x: Number((100 - pt.x).toFixed(1)), y: pt.y };
}

function jitterPoint(pt: PitchPoint, rng: () => number, amount = 2.2): PitchPoint {
  const dx = (rng() - 0.5) * 2 * amount;
  const dy = (rng() - 0.5) * 2 * amount;
  return {
    x: Number(clampNumber(pt.x + dx, 8, 92).toFixed(1)),
    y: Number(clampNumber(pt.y + dy, 10, 90).toFixed(1)),
  };
}

export function getDifficultyTimings(difficulty: BlindSideDifficulty): {
  peekMs: number;
  decisionMs: number;
  labelAr: string;
} {
  if (difficulty === 1) return { peekMs: 2500, decisionMs: 5500, labelAr: 'أساسي' };
  if (difficulty === 2) return { peekMs: 1850, decisionMs: 4200, labelAr: 'متوسط' };
  return { peekMs: 1350, decisionMs: 3200, labelAr: 'متقدم' };
}

/**
 * Generates a fresh local Blind-Side Radar scenario with progressive difficulty
 * and anti-repetition filtering + horizontal mirroring.
 */
export function generateBlindSideScenario(
  difficulty: BlindSideDifficulty,
  recentKeys: string[] = [],
  rng: () => number = Math.random
): BlindSideScenario {
  const eligible = BASE_TEMPLATES.filter((t) => t.minLevel <= difficulty);
  const recentSet = new Set(recentKeys.slice(-5));

  // Build candidate (template, mirrored) pairs to maximize variety and prevent repetition
  const candidates: Array<{ tpl: ScenarioTemplate; mirrored: boolean; key: string }> = [];
  for (const tpl of eligible) {
    candidates.push({ tpl, mirrored: false, key: `${tpl.baseKey}:L` });
    candidates.push({ tpl, mirrored: true, key: `${tpl.baseKey}:R` });
  }

  let pool = candidates.filter((c) => !recentSet.has(c.key));
  if (!pool.length) pool = candidates;

  const picked = pool[Math.floor(rng() * pool.length) % pool.length];
  const { tpl, mirrored, key } = picked;
  const timings = getDifficultyTimings(difficulty);

  const transform = (pt: PitchPoint, idx: number): PitchPoint => {
    const base = mirrored ? mirrorX(pt) : { ...pt };
    // Keep GK steady, mildly vary field players for non-static visuals without breaking geometry
    return idx === 0 ? base : jitterPoint(base, rng, 1.4);
  };

  const our = tpl.our.map((p, i) => transform(p, i));
  const opp = tpl.opp.map((p, i) => transform(p, i));
  const ball = { ...our[tpl.carrierIdx] };

  // Validate pass openness dynamically via Dominance X-Ray lane analyzer so explanation stays grounded
  const laneInfo = analyzePassingLanes({
    size: '6v6',
    our,
    opp,
    ball,
    carrierIdx: tpl.carrierIdx,
  });
  const openCount = laneInfo.lanes.filter((l) => l.status === 'open').length;

  const panSide = mirrored ? -tpl.blindPressSide : tpl.blindPressSide;
  const pan = clampNumber(panSide * (difficulty === 3 ? 0.85 : 0.65), -1, 1);

  const titleAr = mirrored
    ? tpl.titleAr.replace('الأيمن', 'الأيسر').replace('الأيسر', 'الأيمن')
    : tpl.titleAr;

  const explanationAr =
    openCount === 0 && tpl.bestDecision === 'shield_feint'
      ? `${tpl.explanationAr} (تحليل الخطوط: 0 ممرات آمنة لحظياً).`
      : tpl.explanationAr;

  return {
    scenarioKey: key,
    titleAr,
    situationPromptAr: tpl.promptAr,
    difficulty,
    peekMs: timings.peekMs,
    decisionMs: timings.decisionMs,
    our,
    opp,
    ball,
    carrierIdx: tpl.carrierIdx,
    maskedOppIndices: [...tpl.maskedOppIndices],
    maskedOurIndices: difficulty >= 2 ? [...tpl.maskedOurIndices] : [],
    bestDecision: tpl.bestDecision,
    acceptableDecision: tpl.acceptableDecision,
    explanationAr,
    mistakeCategoryOnWrong: tpl.mistakeCategoryOnWrong,
    audioCue: {
      pan,
      urgency: difficulty === 3 ? 'high' : difficulty === 2 ? 'medium' : 'low',
    },
  };
}

export function evaluateBlindSideDecision(
  scenario: BlindSideScenario,
  chosen: BlindSideDecisionId | null,
  responseMs: number
): BlindSideRoundOutcome {
  const safeMs = Math.max(0, Math.round(responseMs));
  if (!chosen) {
    return {
      scenarioKey: scenario.scenarioKey,
      difficulty: scenario.difficulty,
      chosen: null,
      bestDecision: scenario.bestDecision,
      correct: false,
      partial: false,
      timedOut: true,
      responseMs: safeMs,
      mistakeType: 'timeout',
      feedbackAr: `انتهى وقت القرار (${(scenario.decisionMs / 1000).toFixed(1)}ث). ${scenario.explanationAr}`,
    };
  }

  if (chosen === scenario.bestDecision) {
    return {
      scenarioKey: scenario.scenarioKey,
      difficulty: scenario.difficulty,
      chosen,
      bestDecision: scenario.bestDecision,
      correct: true,
      partial: false,
      timedOut: false,
      responseMs: safeMs,
      mistakeType: null,
      feedbackAr: `قرار ممتاز خلال ${(safeMs / 1000).toFixed(2)}ث ✓ — ${scenario.explanationAr}`,
    };
  }

  if (scenario.acceptableDecision && chosen === scenario.acceptableDecision) {
    return {
      scenarioKey: scenario.scenarioKey,
      difficulty: scenario.difficulty,
      chosen,
      bestDecision: scenario.bestDecision,
      correct: false,
      partial: true,
      timedOut: false,
      responseMs: safeMs,
      mistakeType: null,
      feedbackAr: `قرار مقبول وآمن نسبياً، لكن الخيار الأمثل كان أقوى: ${scenario.explanationAr}`,
    };
  }

  return {
    scenarioKey: scenario.scenarioKey,
    difficulty: scenario.difficulty,
    chosen,
    bestDecision: scenario.bestDecision,
    correct: false,
    partial: false,
    timedOut: false,
    responseMs: safeMs,
    mistakeType: scenario.mistakeCategoryOnWrong,
    feedbackAr: `قرار غير مثالي تحت الضغط ✕ — ${scenario.explanationAr}`,
  };
}

const MISTAKE_LABELS_AR: Record<BlindSideMistakeType, string> = {
  blind_side_press: 'تجاهل ضغط الخصم القادم من زاوية الظهر',
  missed_open_lane: 'تفويت تمريرة مفتوحة قبل إغلاق المسار',
  turned_into_trap: 'الدوران نحو الكماشة بدلاً من المساحة المفتوحة',
  timeout: 'التأخر في اتخاذ القرار قبل نفاد الوقت',
};

export function summarizeBlindSideSession(outcomes: BlindSideRoundOutcome[]): BlindSideSessionSummary {
  const totalRounds = outcomes.length;
  const correctCount = outcomes.filter((o) => o.correct).length;
  const partialCount = outcomes.filter((o) => o.partial).length;
  const accuracyPct = totalRounds
    ? Math.round(((correctCount + partialCount * 0.5) / totalRounds) * 100)
    : 0;

  const validTimes = outcomes.filter((o) => !o.timedOut).map((o) => o.responseMs);
  const avgResponseMs = validTimes.length
    ? Math.round(validTimes.reduce((a, b) => a + b, 0) / validTimes.length)
    : 0;
  const fastestResponseMs = validTimes.length ? Math.min(...validTimes) : null;

  const mistakeCounts: Record<BlindSideMistakeType, number> = {
    blind_side_press: 0,
    missed_open_lane: 0,
    turned_into_trap: 0,
    timeout: 0,
  };
  for (const o of outcomes) {
    if (o.mistakeType) mistakeCounts[o.mistakeType]++;
  }

  let topMistake: BlindSideMistakeType | null = null;
  let maxErr = 0;
  (Object.keys(mistakeCounts) as BlindSideMistakeType[]).forEach((k) => {
    if (mistakeCounts[k] > maxErr) {
      maxErr = mistakeCounts[k];
      topMistake = k;
    }
  });

  const topMistakeAr = topMistake
    ? MISTAKE_LABELS_AR[topMistake]
    : totalRounds > 0
      ? 'لا توجد أخطاء متكررة — قراءة ممتازة في هذه الجلسة ✓'
      : 'ابدأ جولة تدريبية لعرض التحليل';

  return {
    totalRounds,
    correctCount,
    partialCount,
    accuracyPct,
    avgResponseMs,
    fastestResponseMs,
    topMistakeAr,
    mistakeCounts,
    disclaimerAr:
      'يعكس هذا التقرير أداءك داخل تمرين المسح التكتيكي فقط، وليس فحصاً طبياً أو عصبياً للرؤية المحيطية.',
  };
}

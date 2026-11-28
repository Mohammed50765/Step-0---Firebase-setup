/**
 * MAYDAN BLACK BOX — ERROR → FREEZE → REAL REWIND → CORRECT CINEMA ENGINE
 * Reuses existing `TACTICAL_COMPARISONS_6V6` (`src/tacticsComparisons.ts`) and
 * `tacticsEngine.ts` interpolation & Bezier math.
 *
 * The rewind phase is a REAL keyframe timeline operation sampling backward
 * through the mistake keyframes (never a fake screen swap).
 */

import type { TacticalArrow, TacticalKeyframe, TacticalZone } from '../tacticsData';
import type { Point2D } from '../tacticsLayout';
import { getComparisonById } from '../tacticsComparisons';
import { easeInOutCubic, evalBallArc, interpolatePoints } from '../tacticsEngine';
import type { BlackBoxRoleId } from './roleDna';

export type CinemaPhaseId = 'setup' | 'error' | 'freeze' | 'rewind' | 'correct' | 'challenge';

export interface CinemaNarrationSegment {
  phase: Exclude<CinemaPhaseId, 'challenge'>;
  heading: string;
  principle: string;
  instruction: string;
  trigger: string;
  why: string;
  /** Concise full Arabic script (~8-10s for primary tactical chapters, crisp for transitions) */
  spokenScript: string;
}

export interface ChallengeOptionZone {
  id: string;
  label: string;
  x: number;
  y: number;
  r: number;
  isCorrect: boolean;
  feedbackTitle: string;
  feedbackBody: string;
}

export interface BlackBoxChallengeSpec {
  promptTitle: string;
  promptInstruction: string;
  /** Index inside ourPos[0..5] of the player the user must move/position */
  playerIndex: number;
  roleId: BlackBoxRoleId;
  /** Initial frozen board state right before the user's decision */
  initialFrame: TacticalKeyframe;
  /** Target winning coordinate zone on the 0..100 pitch */
  targetZone: { x: number; y: number; radius: number; label: string };
  /** Common mistake zone for specific diagnostic feedback */
  mistakeZone: { x: number; y: number; radius: number; label: string };
  /** Touch-friendly quick-tap candidate zones on the pitch (in addition to free drag/tap) */
  candidateZones: ChallengeOptionZone[];
  successHeadline: string;
  successExplanation: string;
  mistakeHeadline: string;
  mistakeExplanation: string;
  offTargetHeadline: string;
  offTargetExplanation: string;
}

export interface BlackBoxScenarioDef {
  id: 'buildup_under_pressure' | 'defensive_cover_space';
  comparisonId: string;
  formationId: '2-2-1';
  title: string;
  subtitle: string;
  primaryRoleIds: BlackBoxRoleId[];
  phaseDurationsMs: Record<Exclude<CinemaPhaseId, 'challenge'>, number>;
  mistakeFrames: TacticalKeyframe[];
  correctFrames: TacticalKeyframe[];
  /** Index in mistakeFrames where the decisive mistake freezes */
  freezeFrameIndex: number;
  freezeDangerZone: TacticalZone;
  freezeCallout: string;
  segments: Record<Exclude<CinemaPhaseId, 'challenge'>, CinemaNarrationSegment>;
  challenge: BlackBoxChallengeSpec;
}

export interface CinemaTimelineSample {
  elapsedMs: number;
  totalMs: number;
  globalProgress: number; // 0..1
  phase: Exclude<CinemaPhaseId, 'challenge'>;
  phaseProgress: number; // 0..1
  /** True while reversing time along real mistake keyframes */
  isRewinding: boolean;
  /** True during the mistake freeze frame */
  isFrozen: boolean;
  /** Semantic color emphasis for the SVG stage */
  emphasis: 'neutral' | 'mistake' | 'rewind' | 'correct';
  ourPos: Point2D[];
  oppPos: Point2D[];
  ball: { x: number; y: number; scale: number; shadowDy: number; lift: number };
  activeIndices: number[];
  arrows: TacticalArrow[];
  zones: TacticalZone[];
  triangles: Array<[number, number, number]>;
  segment: CinemaNarrationSegment;
  /** Display timecode for cinema HUD (moves backward smoothly during rewind!) */
  displaySeconds: number;
}

export interface ChallengeValidationResult {
  isCorrect: boolean;
  outcome: 'correct' | 'mistake_zone' | 'off_target';
  distanceToTarget: number;
  headline: string;
  explanation: string;
  placedPoint: Point2D;
}

function requireComparisonFrames(comparisonId: string): {
  mistake: TacticalKeyframe[];
  correct: TacticalKeyframe[];
} {
  const cmp = getComparisonById(comparisonId);
  if (!cmp) {
    throw new Error(`Missing canonical tactical comparison: ${comparisonId}`);
  }
  return {
    mistake: cmp.mistake.frames,
    correct: cmp.correct.frames,
  };
}

function buildBlackBoxScenarios(): ReadonlyArray<BlackBoxScenarioDef> {
  const buildup = requireComparisonFrames('buildup_bunching');
  const defCover = requireComparisonFrames('defensive_ball_watching');

  const scenario1: BlackBoxScenarioDef = {
    id: 'buildup_under_pressure',
    comparisonId: 'buildup_bunching',
    formationId: '2-2-1',
    title: 'الخروج بالكرة تحت الضغط',
    subtitle: 'كسر الضغط العالي بتوسيع العرض ومثلث التمرير في 2-2-1',
    primaryRoleIds: ['buildup_libero', 'inverted_winger', 'anchor', 'false_9'],
    phaseDurationsMs: {
      setup: 2800,
      error: 5400,
      freeze: 4000,
      rewind: 1700,
      correct: 7600,
    },
    mistakeFrames: buildup.mistake,
    correctFrames: buildup.correct,
    freezeFrameIndex: 1,
    freezeDangerZone: { x: 49, y: 70, r: 12, color: 'rose', label: 'تكدّس وقطع مباشر' },
    freezeCallout: 'تجميد الخطأ: تقارب المدافعين في العمق سمح لمهاجم واحد بإغلاق زاويتَي التمرير معاً.',
    segments: {
      setup: {
        phase: 'setup',
        heading: 'الوضعية الابتدائية — بداية البناء',
        principle: 'البناء تحت الضغط يبدأ بتوسيع المساحة قبل تمرير الكرة.',
        instruction: 'راقب تمركز ليبرو البناء والارتكاز أمام الحارس.',
        trigger: 'عندما يضغط الخصم في ملعبك، لا تقترب من زميلك في العمق.',
        why: 'توسيع العرض يجبر الخصم على اختيار لاعب واحد فقط للضغط.',
        spokenScript:
          'البناء تحت الضغط يبدأ بالمساحة قبل التمريرة. راقب كيف يقف الفريق أمام الحارس قبل انطلاق الضغط العالي.',
      },
      error: {
        phase: 'error',
        heading: 'المشهد الخاطئ — التكدّس في العمق',
        principle: 'الوقوف في ممر واحد يقتل زوايا الخروج.',
        instruction: 'لاحظ كيف اقترب المدافعان والوسط في قلب الملعب.',
        trigger: 'عندما تتكدّس في العمق، يصبح خط التمرير مكشوفاً للقطع الفوري.',
        why: 'مهاجم واحد للخصم يكفي لإغلاق العمق وخطف الكرة أمام مرماك.',
        spokenScript:
          'هنا يحدث الخطأ الشائع. اقترب المدافعان في عمق واحد، فأغلق الخصم الزوايا وقطع التمريرة أمام المرمى.',
      },
      freeze: {
        phase: 'freeze',
        heading: 'تجميد لحظة الخطأ',
        principle: 'فقدان الكرة في العمق يعني انفراداً مباشراً.',
        instruction: 'توقّف عند هذه اللقطة وانظر إلى المساحة الفارغة على الطرف الأيمن.',
        trigger: 'عندما تضيق المسافة بينك وبين الحارس، تخسر وقت القرار.',
        why: 'غياب العرض يمنح الخصم أخطر نقطة استخلاص في السداسي.',
        spokenScript:
          'توقّف هنا. تكدّس ثلاثة لاعبين في عمق ضيق منح الخصم استخلاصاً سهلاً وانفراداً مباشراً، رغم أن الطرف الأيمن مفتوح تماماً.',
      },
      rewind: {
        phase: 'rewind',
        heading: 'إرجاع الزمن — إعادة بناء القرار',
        principle: 'نعيد اللقطة إلى لحظة امتلاك الحارس للكرة.',
        instruction: 'شاهد كيف يتغيّر المشهد بحركة واحدة قبل التمريرة.',
        trigger: 'عندما ترى ضغط الخصم يقترب، افتح عرض الملعب فوراً.',
        why: 'خطوتان نحو الخط الجانبي تغيّران شكل الملعب بالكامل.',
        spokenScript: 'نعيد الزمن إلى لحظة امتلاك الحارس للكرة لنصحّح التمركز.',
      },
      correct: {
        phase: 'correct',
        heading: 'الحل التكتيكي — توسيع العرض ومثلث التمرير',
        principle: 'العرض الواسع يكسر الضغط بتمريرتين هادئتين.',
        instruction: 'افتح بليبرو البناء نحو الخط الجانبي، واهبط بالجناح العكسي بين الخطوط.',
        trigger: 'عندما يضغط مهاجم الخصم على العمق، تحرّك فوراً إلى الطرف المفتوح.',
        why: 'ذلك يصنع مثلث تمرير آمناً يُخرج الفريق نحو المساحة الفارغة دون مخاطرة.',
        spokenScript:
          'القاعدة بسيطة: وسّع العرض لصناعة المثلث. عندما يضغط مهاجم الخصم على العمق، تحرّك بليبرو البناء إلى الخط الجانبي واهبط بالجناح العكسي بين الخطوط، لتكسر الضغط بتمريرتين هادئتين.',
      },
    },
    challenge: {
      promptTitle: 'تحدّي القرار: أين يتحرّك ليبرو البناء؟',
      promptInstruction:
        'يمتلك الحارس الكرة والخصم يضغط على العمق. اسحب ليبرو البناء (رقم 3) أو اضغط المنطقة الصحيحة لفتح زاوية الخروج الآمنة.',
      playerIndex: 2,
      roleId: 'buildup_libero',
      initialFrame: buildup.mistake[0],
      targetZone: { x: 82, y: 74, radius: 13, label: 'فتح العرض على الطرف الأيمن' },
      mistakeZone: { x: 52, y: 71, radius: 13, label: 'التكدّس في العمق المزدحم' },
      candidateZones: [
        {
          id: 'zone_wide_right',
          label: 'افتح على الطرف الأيمن',
          x: 82,
          y: 74,
          r: 10,
          isCorrect: true,
          feedbackTitle: 'قرار تكتيكي ممتاز',
          feedbackBody: 'توسيع العرض سحب ضغط الخصم وفتح زاوية تمرير نظيفة للحارس ثم للجناح العكسي.',
        },
        {
          id: 'zone_center_bunch',
          label: 'تقدّم لقلب العمق',
          x: 52,
          y: 70,
          r: 10,
          isCorrect: false,
          feedbackTitle: 'تكدّس خطير في العمق',
          feedbackBody: 'الوقوف أمام المرمى في العمق يسمح لمهاجم الخصم بقطع التمريرة والانفراد فوراً.',
        },
        {
          id: 'zone_too_high',
          label: 'اصعد بعيداً للأمام',
          x: 78,
          y: 42,
          r: 10,
          isCorrect: false,
          feedbackTitle: 'زاوية بعيدة ومحجوبة',
          feedbackBody: 'الصعود المبكر يقطع خط التمرير الأرضي القصير ويجبر الحارس على كرة طويلة عشوائية.',
        },
      ],
      successHeadline: 'أحسنت — كسرت الضغط بزاوية خروج مثالية',
      successExplanation:
        'تحرّك ليبرو البناء نحو الخط الجانبي (الطرف الأيمن) وسّع عرض الملعب، فأصبح لدى الحارس تمريرة آمنة تماماً تفتح مثلث اللعب مع الجناح العكسي.',
      mistakeHeadline: 'احذر — هذا يعيد خطأ التكدّس في العمق',
      mistakeExplanation:
        'الوقوف في منتصف الملعب قرب المهاجم الضاغط يغلق زاوية التمرير ويعرّض مرماك لخطف فوري. جرّب توسيع العرض نحو الخط الجانبي الأيمن.',
      offTargetHeadline: 'الموقع لا يفتح مثلث التمرير الآمن بعد',
      offTargetExplanation:
        'تحتاج للوقوف بمحاذاة الطرف الأيمن في الثلث الدفاعي بحيث تكون الكرة الأرضية من الحارس سهلة ومفتوحة بعيداً عن مهاجم الخصم.',
    },
  };

  const scenario2: BlackBoxScenarioDef = {
    id: 'defensive_cover_space',
    comparisonId: 'defensive_ball_watching',
    formationId: '2-2-1',
    title: 'التغطية الدفاعية وحماية العمق',
    subtitle: 'مبدأ واحد يضغط والآخر يحمي المهاجم الثابت في 6v6 بلا تسلل',
    primaryRoleIds: ['anchor', 'buildup_libero', 'inverted_winger', 'false_9'],
    phaseDurationsMs: {
      setup: 2800,
      error: 5400,
      freeze: 4000,
      rewind: 1700,
      correct: 7600,
    },
    mistakeFrames: defCover.mistake,
    correctFrames: defCover.correct,
    freezeFrameIndex: 1,
    freezeDangerZone: { x: 44, y: 80, r: 12, color: 'rose', label: 'مهاجم ثابت بلا رقابة' },
    freezeCallout: 'تجميد الخطأ: اندفاع المدافعين معاً نحو الطرف ترك المهاجم الثابت منفرداً أمام المرمى.',
    segments: {
      setup: {
        phase: 'setup',
        heading: 'الوضعية الابتدائية — هجمة خصم من الطرف',
        principle: 'في السداسي بدون تسلل، حماية العمق تسبق مطاردة الكرة.',
        instruction: 'راقب مهاجم الخصم الثابت قرب منطقة الجزاء أثناء تحرك الكرة للطرف.',
        trigger: 'عندما يخرج زميلك للضغط على الطرف، يبدأ دورك في حماية الظهر.',
        why: 'تغطية العمق تمنع أخطر تمريرة قطرية في ملاعب 6v6.',
        spokenScript:
          'في السداسي بدون تسلل، حماية العمق هي الأولوية الأولى. راقب مهاجم الخصم الثابت قرب المرمى بينما تتجه الكرة إلى الطرف.',
      },
      error: {
        phase: 'error',
        heading: 'المشهد الخاطئ — الانجراف المزدوج للكرة',
        principle: 'مدافعان على كرة واحدة يعني مهاجماً حراً أمام الشباك.',
        instruction: 'انظر كيف ترك الارتكاز الدفاعي عمقه وركض نحو الطرف الأيمن.',
        trigger: 'عندما تراقب الكرة وحدها، تفقد موقع المهاجم خلف كتفك.',
        why: 'تمريرة أرضية واحدة تكفي لوضع الخصم وجهاً لوجه مع حارسك.',
        spokenScript:
          'الخطأ هنا واضح: اندفع المدافعان معاً نحو حامل الكرة، فاختفت التغطية الخلفية ووصلت التمريرة القطرية إلى المهاجم الحر.',
      },
      freeze: {
        phase: 'freeze',
        heading: 'تجميد لحظة الانكشاف',
        principle: 'التوازن الدفاعي ينهار لحظة مغادرة العمق.',
        instruction: 'تأمل الفراغ الأحمر خلف المدافعين — لا يوجد أي لاعب بين الكرة والمهاجم.',
        trigger: 'عندما يندفع زميلك للخط الجانبي، ممنوع أن تلحق به.',
        why: 'منع التمريرة للمهاجم الثابت أهم من خطف الكرة على الطرف.',
        spokenScript:
          'توقّف عند هذه اللقطة. اندفاع الارتكاز للطرف كشف العمق بالكامل أمام مهاجم ثابت لا ينطبق عليه التسلل.',
      },
      rewind: {
        phase: 'rewind',
        heading: 'إرجاع الزمن — استعادة التوازن الدفاعي',
        principle: 'نعود بالزمن قبل اندفاع الارتكاز نحو الكرة.',
        instruction: 'شاهد كيف يغلق تمركز ذكي واحد الهجمة بالكامل.',
        trigger: 'عندما يضغط زميلك على الطرف، تمركز أنت بين الكرة والمهاجم.',
        why: 'ذلك يحرم الخصم من خيار العمق ويجبره على الزاوية المغلقة.',
        spokenScript: 'نعيد الزمن إلى لحظة وصول الكرة للطرف لإغلاق العمق بشكل صحيح.',
      },
      correct: {
        phase: 'correct',
        heading: 'الحل التكتيكي — ضغط على الطرف + حماية العمق',
        principle: 'واحد يغلق الزاوية على الكرة، والآخر يحمي المرمى والظهر.',
        instruction: 'اثبت بالارتكاز الدفاعي أمام المهاجم الثابت بينما يعود الجناح العكسي لإكمال الكماشة.',
        trigger: 'عندما يهاجم الخصم من الطرف، تحرّك إلى خط التمرير بين الكرة والمهاجم الثابت.',
        why: 'يُحاصَر حامل الكرة على الخط الجانبي وتتحول الكرة إلى مرتدة سريعة لصالحك.',
        spokenScript:
          'توازن الدفاع يحسم السداسي. عندما يخرج ليبرو البناء لإغلاق الطرف، تحرّك بالارتكاز إلى خط التمرير بين الكرة والمهاجم الثابت، ليعود الجناح العكسي ويكمل الكماشة ويبدأ المرتدة.',
      },
    },
    challenge: {
      promptTitle: 'تحدّي القرار: أين يتمركز الارتكاز الدفاعي؟',
      promptInstruction:
        'خرج ليبرو البناء للضغط على حامل الكرة في الطرف الأيمن. اسحب الارتكاز الدفاعي (رقم 2) أو اضغط الموقع الصحيح لحماية العمق.',
      playerIndex: 1,
      roleId: 'anchor',
      initialFrame: defCover.mistake[0],
      targetZone: { x: 47, y: 77, radius: 13, label: 'إغلاق العمق بين الكرة والمهاجم' },
      mistakeZone: { x: 65, y: 65, radius: 13, label: 'الاندفاع نحو الطرف الأيمن' },
      candidateZones: [
        {
          id: 'zone_cover_center',
          label: 'احمِ العمق أمام المهاجم',
          x: 47,
          y: 77,
          r: 10,
          isCorrect: true,
          feedbackTitle: 'تغطية عمق مثالية',
          feedbackBody: 'أغلقت خط التمرير القطري نحو المهاجم الثابت وأجبرت حامل الكرة على الزاوية المغلقة.',
        },
        {
          id: 'zone_chase_wing',
          label: 'اندفع للكرة على الطرف',
          x: 65,
          y: 65,
          r: 10,
          isCorrect: false,
          feedbackTitle: 'انكشاف قاتل في الظهر',
          feedbackBody: 'الاندفاع مع زميلك يترك مهاجم الخصم الثابت منفرداً تماماً أمام الحارس.',
        },
        {
          id: 'zone_stay_wide_left',
          label: 'ابقَ بعيداً على اليسار',
          x: 20,
          y: 72,
          r: 10,
          isCorrect: false,
          feedbackTitle: 'مسافة بعيدة عن المهاجم',
          feedbackBody: 'البقاء على الخط الأيسر يترك ممراً واسعاً للتمرير القطري نحو قلب منطقة الجزاء.',
        },
      ],
      successHeadline: 'ممتاز — أغلقت العمق وأبطلت خطورة المهاجم الثابت',
      successExplanation:
        'تمركز الارتكاز الدفاعي بين الكرة ومهاجم الخصم الثابت يقطع التمريرة القطرية، ويمنح الجناح العكسي الوقت للعودة واستخلاص الكرة.',
      mistakeHeadline: 'احذر — تركت ظهرك مكشوفاً للمهاجم الثابت',
      mistakeExplanation:
        'الاندفاع نحو الطرف بينما يغطّي زميلك الكرة يفتح العمق تماماً في 6v6 بلا تسلل. تمركز بين الكرة ومهاجم الخصم أمام المرمى.',
      offTargetHeadline: 'العمق ما زال مفتوحاً للتمريرة القطرية',
      offTargetExplanation:
        'اقترب من محور المرمى أمام مهاجم الخصم الثابت (الوسط الدفاعي) لقطع خط التمرير القادم من الطرف الأيمن.',
    },
  };

  return [scenario1, scenario2];
}

export const BLACK_BOX_SCENARIOS: ReadonlyArray<BlackBoxScenarioDef> = buildBlackBoxScenarios();

export function getBlackBoxScenarioById(id: string): BlackBoxScenarioDef {
  return BLACK_BOX_SCENARIOS.find((s) => s.id === id) || BLACK_BOX_SCENARIOS[0];
}

export interface CinemaPhaseBounds {
  phase: Exclude<CinemaPhaseId, 'challenge'>;
  startMs: number;
  endMs: number;
  durationMs: number;
}

export function getCinemaTimelineBounds(scenario: BlackBoxScenarioDef): {
  bounds: CinemaPhaseBounds[];
  totalMs: number;
} {
  const order: Array<Exclude<CinemaPhaseId, 'challenge'>> = ['setup', 'error', 'freeze', 'rewind', 'correct'];
  const bounds: CinemaPhaseBounds[] = [];
  let cursor = 0;
  for (const phase of order) {
    const dur = Math.max(400, scenario.phaseDurationsMs[phase]);
    bounds.push({ phase, startMs: cursor, endMs: cursor + dur, durationMs: dur });
    cursor += dur;
  }
  return { bounds, totalMs: cursor };
}

function sampleFrameChain(
  frames: ReadonlyArray<TacticalKeyframe>,
  normalizedT: number
): {
  ourPos: Point2D[];
  oppPos: Point2D[];
  ball: { x: number; y: number; scale: number; shadowDy: number; lift: number };
  activeFrame: TacticalKeyframe;
} {
  if (frames.length === 0) {
    return {
      ourPos: [],
      oppPos: [],
      ball: { x: 50, y: 50, scale: 1, shadowDy: 2, lift: 0 },
      activeFrame: {
        title: '',
        narration: '',
        durationMs: 1000,
        ourPos: [],
        oppPos: [],
        ball: { x: 50, y: 50 },
        activeIndices: [],
        arrows: [],
      },
    };
  }
  if (frames.length === 1) {
    const f = frames[0];
    return {
      ourPos: f.ourPos.map((p) => ({ ...p })),
      oppPos: f.oppPos.map((p) => ({ ...p })),
      ball: { x: f.ball.x, y: f.ball.y, scale: 1, shadowDy: 2, lift: 0 },
      activeFrame: f,
    };
  }

  const clamped = Math.max(0, Math.min(1, normalizedT));
  const segments = frames.length - 1;
  const scaled = clamped * segments;
  const idx = Math.min(segments - 1, Math.floor(scaled));
  const localT = easeInOutCubic(scaled - idx);
  const fA = frames[idx];
  const fB = frames[idx + 1];

  const ourPos = interpolatePoints(fA.ourPos, fB.ourPos, localT);
  const oppPos = interpolatePoints(fA.oppPos, fB.oppPos, localT);
  const ballSample = evalBallArc(fA.ball, fB.ball, localT);

  return {
    ourPos,
    oppPos,
    ball: {
      x: ballSample.x,
      y: ballSample.y,
      scale: ballSample.scale,
      shadowDy: ballSample.shadowDy,
      lift: ballSample.lift,
    },
    activeFrame: localT >= 0.45 ? fB : fA,
  };
}

/**
 * Pure continuous timeline sampler for the entire Error -> Freeze -> Rewind -> Correct Cinema.
 * During `rewind`, samples backward across the actual mistake keyframes (progress 1 -> 0)
 * so every player and the ball physically retrace their exact steps in reverse.
 */
export function sampleBlackBoxTimeline(
  scenario: BlackBoxScenarioDef,
  rawElapsedMs: number
): CinemaTimelineSample {
  const { bounds, totalMs } = getCinemaTimelineBounds(scenario);
  const elapsedMs = Math.max(0, Math.min(totalMs, Number.isFinite(rawElapsedMs) ? rawElapsedMs : 0));

  let activeBound = bounds[bounds.length - 1];
  for (const b of bounds) {
    if (elapsedMs < b.endMs || b === bounds[bounds.length - 1]) {
      activeBound = b;
      break;
    }
  }

  const phase = activeBound.phase;
  const phaseProgress = Math.max(0, Math.min(1, (elapsedMs - activeBound.startMs) / activeBound.durationMs));
  const segment = scenario.segments[phase];
  const mistakeFrames = scenario.mistakeFrames;
  const correctFrames = scenario.correctFrames;
  const freezeIdx = Math.max(0, Math.min(mistakeFrames.length - 1, scenario.freezeFrameIndex));

  if (phase === 'setup') {
    const f0 = mistakeFrames[0];
    return {
      elapsedMs,
      totalMs,
      globalProgress: elapsedMs / totalMs,
      phase,
      phaseProgress,
      isRewinding: false,
      isFrozen: false,
      emphasis: 'neutral',
      ourPos: f0.ourPos.map((p) => ({ ...p })),
      oppPos: f0.oppPos.map((p) => ({ ...p })),
      ball: { x: f0.ball.x, y: f0.ball.y, scale: 1, shadowDy: 2, lift: 0 },
      activeIndices: [...f0.activeIndices],
      arrows: [],
      zones: [],
      triangles: [],
      segment,
      displaySeconds: Number((elapsedMs / 1000).toFixed(1)),
    };
  }

  if (phase === 'error') {
    const sampled = sampleFrameChain(mistakeFrames, phaseProgress);
    return {
      elapsedMs,
      totalMs,
      globalProgress: elapsedMs / totalMs,
      phase,
      phaseProgress,
      isRewinding: false,
      isFrozen: false,
      emphasis: 'mistake',
      ourPos: sampled.ourPos,
      oppPos: sampled.oppPos,
      ball: sampled.ball,
      activeIndices: [...sampled.activeFrame.activeIndices],
      arrows: sampled.activeFrame.arrows || [],
      zones: sampled.activeFrame.zones || [],
      triangles: [],
      segment,
      displaySeconds: Number((elapsedMs / 1000).toFixed(1)),
    };
  }

  if (phase === 'freeze') {
    const fFreeze = mistakeFrames[freezeIdx];
    const freezeTimeSec = Number(((bounds[1].startMs + bounds[1].durationMs * (freezeIdx / Math.max(1, mistakeFrames.length - 1))) / 1000).toFixed(1));
    return {
      elapsedMs,
      totalMs,
      globalProgress: elapsedMs / totalMs,
      phase,
      phaseProgress,
      isRewinding: false,
      isFrozen: true,
      emphasis: 'mistake',
      ourPos: fFreeze.ourPos.map((p) => ({ ...p })),
      oppPos: fFreeze.oppPos.map((p) => ({ ...p })),
      ball: { x: fFreeze.ball.x, y: fFreeze.ball.y, scale: 1.06, shadowDy: 3, lift: 0 },
      activeIndices: [...fFreeze.activeIndices],
      arrows: fFreeze.arrows || [],
      zones: [scenario.freezeDangerZone],
      triangles: [],
      segment,
      displaySeconds: freezeTimeSec,
    };
  }

  if (phase === 'rewind') {
    // REAL KEYFRAME REWIND: walk backward from mistake end/freeze back to frame 0
    const rewindChain = mistakeFrames.slice(0, Math.max(2, freezeIdx + 1));
    const reverseT = 1 - phaseProgress;
    const sampled = sampleFrameChain(rewindChain, reverseT);
    const startSec = bounds[1].endMs / 1000;
    const displaySeconds = Number((startSec * reverseT).toFixed(1));
    return {
      elapsedMs,
      totalMs,
      globalProgress: elapsedMs / totalMs,
      phase,
      phaseProgress,
      isRewinding: true,
      isFrozen: false,
      emphasis: 'rewind',
      ourPos: sampled.ourPos,
      oppPos: sampled.oppPos,
      ball: sampled.ball,
      activeIndices: [...mistakeFrames[0].activeIndices],
      arrows: [],
      zones: [],
      triangles: [],
      segment,
      displaySeconds,
    };
  }

  // phase === 'correct'
  const sampled = sampleFrameChain(correctFrames, phaseProgress);
  return {
    elapsedMs,
    totalMs,
    globalProgress: elapsedMs / totalMs,
    phase: 'correct',
    phaseProgress,
    isRewinding: false,
    isFrozen: false,
    emphasis: 'correct',
    ourPos: sampled.ourPos,
    oppPos: sampled.oppPos,
    ball: sampled.ball,
    activeIndices: [...sampled.activeFrame.activeIndices],
    arrows: sampled.activeFrame.arrows || [],
    zones: sampled.activeFrame.zones || [],
    triangles: sampled.activeFrame.triangles || [],
    segment,
    displaySeconds: Number((phaseProgress * (activeBound.durationMs / 1000)).toFixed(1)),
  };
}

/**
 * Validates the player's interactive touch/drag or tap-zone decision against
 * the scenario's tactical geometry rules.
 */
export function evaluateBlackBoxChallenge(
  scenario: BlackBoxScenarioDef,
  placedPoint: Point2D
): ChallengeValidationResult {
  const px = Math.max(4, Math.min(96, placedPoint.x));
  const py = Math.max(6, Math.min(94, placedPoint.y));
  const ch = scenario.challenge;

  const distTarget = Math.hypot(px - ch.targetZone.x, py - ch.targetZone.y);
  const distMistake = Math.hypot(px - ch.mistakeZone.x, py - ch.mistakeZone.y);

  if (distTarget <= ch.targetZone.radius) {
    return {
      isCorrect: true,
      outcome: 'correct',
      distanceToTarget: Number(distTarget.toFixed(1)),
      headline: ch.successHeadline,
      explanation: ch.successExplanation,
      placedPoint: { x: px, y: py },
    };
  }

  if (distMistake <= ch.mistakeZone.radius) {
    return {
      isCorrect: false,
      outcome: 'mistake_zone',
      distanceToTarget: Number(distTarget.toFixed(1)),
      headline: ch.mistakeHeadline,
      explanation: ch.mistakeExplanation,
      placedPoint: { x: px, y: py },
    };
  }

  return {
    isCorrect: false,
    outcome: 'off_target',
    distanceToTarget: Number(distTarget.toFixed(1)),
    headline: ch.offTargetHeadline,
    explanation: ch.offTargetExplanation,
    placedPoint: { x: px, y: py },
  };
}

/**
 * MAYDAN BLACK BOX — ROLE DNA ENGINE
 * Extends the existing 2-2-1 formation and role spotlight system (`src/tacticsData.ts`)
 * with rich tactical DNA, conditional zone guidance, and transparent explainable
 * synergy/conflict rules (zero fabricated percentages).
 */

import { getFormationDef, getRoleSpotlightSequence, type FormationSlotDef, type RoleGroup } from '../tacticsData';

export type BlackBoxRoleId = 'anchor' | 'buildup_libero' | 'inverted_winger' | 'false_9';

export interface RoleZoneBox {
  id: string;
  label: string;
  /** Pitch % coordinates (0..100 horizontal, 0=opponent goal .. 100=our goal) */
  x: number;
  y: number;
  rx: number;
  ry: number;
  guidance: string;
}

export interface RolePartnerLink {
  partnerId: BlackBoxRoleId;
  relationTitle: string;
  coordinationRule: string;
}

export interface RoleDecisionPair {
  situation: string;
  mistake: string;
  correctDecision: string;
  whyItWorks: string;
}

export interface RoleDnaProfile {
  id: BlackBoxRoleId;
  formationId: '2-2-1';
  /** Index inside ourPos[0..5] used across 2-2-1 scenarios & comparisons */
  slotIndex: number;
  slotId: string;
  roleGroup: RoleGroup;
  code: string;
  titleAr: string;
  titleEn: string;
  identityLine: string;
  homePosition: { x: number; y: number };
  preferredZones: RoleZoneBox[];
  conditionalZones: RoleZoneBox[];
  highRiskZones: RoleZoneBox[];
  onBallResponsibilities: string[];
  offBallResponsibilities: string[];
  pressingTriggers: string[];
  transitionBehavior: {
    attackToDefense: string;
    defenseToAttack: string;
  };
  partnerRelationships: RolePartnerLink[];
  commonMistakes: string[];
  correctDecisions: RoleDecisionPair[];
}

export interface RoleRuleEvaluationItem {
  id: string;
  kind: 'synergy' | 'warning';
  roles: BlackBoxRoleId[];
  title: string;
  explanation: string;
  tacticalAdjustment: string;
}

export interface RolePairingReport {
  activeRoles: BlackBoxRoleId[];
  synergies: RoleRuleEvaluationItem[];
  warnings: RoleRuleEvaluationItem[];
}

/**
 * MVP Role DNA Catalog for 6v6 `2-2-1` formation.
 * Designed as an extensible registry so additional roles & formations can be registered
 * without modifying consumer components or playback engines.
 */
export const ROLE_DNA_CATALOG: ReadonlyArray<RoleDnaProfile> = [
  {
    id: 'anchor',
    formationId: '2-2-1',
    slotIndex: 1,
    slotId: 'd2',
    roleGroup: 'def',
    code: 'ANC',
    titleAr: 'الارتكاز الدفاعي',
    titleEn: 'Anchor',
    identityLine: 'صمّام الأمان الذي يحمي العمق ويقرأ ظهر الخط قبل وصول التمريرة.',
    homePosition: { x: 34, y: 74 },
    preferredZones: [
      {
        id: 'anc_core',
        label: 'محور حماية العمق',
        x: 42,
        y: 74,
        rx: 18,
        ry: 11,
        guidance: 'تمركز بين الكرة ومهاجم الخصم الثابت مع رؤية واضحة للطرفين.',
      },
    ],
    conditionalZones: [
      {
        id: 'anc_cover_right',
        label: 'تغطية العمق الأيمن عند خروج الليبرو',
        x: 54,
        y: 76,
        rx: 14,
        ry: 9,
        guidance: 'تنتقل إلى قلب العمق فوراً عندما يتقدم ليبرو البناء أو يخرج للضغط على الطرف.',
      },
      {
        id: 'anc_support_mid',
        label: 'مساندة بناء اللعب المنخفض',
        x: 24,
        y: 66,
        rx: 12,
        ry: 10,
        guidance: 'عندما يُغلق الطرف الأيمن، افتح زاوية يسارية هادئة للحارس لاستئناف البناء.',
      },
    ],
    highRiskZones: [
      {
        id: 'anc_overcommit_wing',
        label: 'الاندفاع المزدوج للطرف البعيد',
        x: 74,
        y: 58,
        rx: 14,
        ry: 12,
        guidance: 'منطقة عالية المخاطرة ما لم يغطّ لاعب وسط عمقك — في 6v6 بلا تسلل يترك هذا مهاجم الخصم منفرداً.',
      },
    ],
    onBallResponsibilities: [
      'اللعب بلمسة أو لمستين لتأمين التمريرة الأولى دون مخاطرة أمام المرمى.',
      'تغيير جهة اللعب إلى الطرف المفتوح عند تكتل ضغط الخصم على جانب واحد.',
    ],
    offBallResponsibilities: [
      'إبقاء مهاجم الخصم الثابت داخل مجال الرؤية وإغلاق خط التمرير العمودي نحوه.',
      'توجيه الزملاء بصوت هادئ: "اضغط" لحامل الكرة و"أنا أغطّي العمق".',
    ],
    pressingTriggers: [
      'عندما يستلم الخصم وظهره لمرمانا على الطرف، يضغط زميلك بينما تثبت أنت على خط التمرير الداخلي.',
      'تخرج للمواجهة المباشرة فقط إذا اخترق الخصم الخط الأول وبقي الحارس خلفك مباشرة.',
    ],
    transitionBehavior: {
      attackToDefense: 'تراجع فوري خطوتين لحماية الممر المركزي قبل مطاردة الكرة.',
      defenseToAttack: 'افتح زاوية آمنة خلف حامل الكرة لتمنح الفريق خيار إعادة التدوير.',
    },
    partnerRelationships: [
      {
        partnerId: 'buildup_libero',
        relationTitle: 'توازن الضغط والتغطية',
        coordinationRule: 'عندما يتقدم أو يضغط ليبرو البناء، يغلق الارتكاز العمق المركزي تلقائياً.',
      },
      {
        partnerId: 'inverted_winger',
        relationTitle: 'كماشة إغلاق الممر الداخلي',
        coordinationRule: 'عودة الجناح العكسي للداخل تتيح للارتكاز البقاء ملتصقاً بمهاجم الخصم.',
      },
    ],
    commonMistakes: [
      'الاندفاع مع المدافع الثاني نحو حامل الكرة وترك العمق فارغاً.',
      'مراقبة الكرة فقط ونسيان تمركز المهاجم الثابت خلف الكتف.',
    ],
    correctDecisions: [
      {
        situation: 'الخصم يهاجم من الطرف الأيمن ومهاجمه ثابت قرب القوس',
        mistake: 'الركض نحو الطرف لمساعدة زميلك في مواجهة 2 ضد 1 على الخط.',
        correctDecision: 'التمركز بين الكرة والمهاجم الثابت على محور العمق (x≈46–50, y≈76–79).',
        whyItWorks: 'يُجبر الخصم على البقاء في زاوية ضيقة على الطرف ويمنع التمريرة القطرية القاتلة.',
      },
    ],
  },
  {
    id: 'buildup_libero',
    formationId: '2-2-1',
    slotIndex: 2,
    slotId: 'd1',
    roleGroup: 'def',
    code: 'LIB',
    titleAr: 'ليبرو البناء',
    titleEn: 'Build-up Libero',
    identityLine: 'مفتاح الخروج النظيف بالكرة تحت الضغط وصانع أول زاوية آمنة للحارس.',
    homePosition: { x: 74, y: 74 },
    preferredZones: [
      {
        id: 'lib_width',
        label: 'ممر التوسيع الأيمن',
        x: 80,
        y: 74,
        rx: 13,
        ry: 11,
        guidance: 'افتح عرض الملعب بمحاذاة الخط الجانبي لسحب مهاجم الخصم وكسر الضغط الأول.',
      },
    ],
    conditionalZones: [
      {
        id: 'lib_carry',
        label: 'التدرّج للأمام عند تراجع الخصم',
        x: 74,
        y: 58,
        rx: 12,
        ry: 10,
        guidance: 'إذا تراجع الخصم للخلف وأمّن الارتكاز عمقك، تقدّم بالكرة لإجبار لاعب وسط الخصم على الخروج.',
      },
      {
        id: 'lib_press_wide',
        label: 'تضييق الزاوية على الطرف دفاعياً',
        x: 72,
        y: 63,
        rx: 12,
        ry: 9,
        guidance: 'عندما تصل الكرة لطرف الخصم، اخرج لإغلاق زاوية التمرير للداخل بينما يغطّي الارتكاز ظهرك.',
      },
    ],
    highRiskZones: [
      {
        id: 'lib_center_bunch',
        label: 'التكدّس أمام المرمى في العمق',
        x: 52,
        y: 72,
        rx: 13,
        ry: 9,
        guidance: 'الاقتراب من وسط الملعب أثناء البناء يمنح مدافعاً واحداً للخصم قدرة تغطية لاعبين معاً.',
      },
    ],
    onBallResponsibilities: [
      'الاستلام بجسم مفتوح نحو الملعب لرؤية الجناح العكسي والمهاجم الوهمي معاً.',
      'التمرير السريع داخل المثلث لكسر خط الضغط بدل التمرير العشوائي في العمق المغلق.',
    ],
    offBallResponsibilities: [
      'التحرّك مبكراً نحو الخط الجانبي فور امتلاك الحارس للكرة.',
      'العودة السريعة لخط الدفاع فور فقدان الاستحواذ.',
    ],
    pressingTriggers: [
      'عندما يستلم جناح الخصم على الطرف الأيمن، أغلِق عليه زاوية الدخول للعمق.',
      'لا تندفع بقدم ثابتة؛ أبطئ حامل الكرة حتى يعود الجناح العكسي للمساندة.',
    ],
    transitionBehavior: {
      attackToDefense: 'حوّل فوراً لإغلاق أقرب مسار مباشر نحو مرماك وتواصل مع الارتكاز.',
      defenseToAttack: 'وسّع الملعب فوراً خلال ثانية واحدة لتمنح الحارس منفذ خروج مضموناً.',
    },
    partnerRelationships: [
      {
        partnerId: 'inverted_winger',
        relationTitle: 'مثلث كسر الضغط الجانبي',
        coordinationRule: 'توسيع الليبرو على الخط يفتح مساحة هبوط الجناح العكسي بين الخطوط.',
      },
      {
        partnerId: 'anchor',
        relationTitle: 'تأمين التقدم',
        coordinationRule: 'لا يتقدم الليبرو للمساندة الهجومية إلا عند ثبات الارتكاز في العمق.',
      },
    ],
    commonMistakes: [
      'الوقوف قريباً من الحارس في قلب الملعب مما يخنق زاوية التمرير.',
      'التمرير المتسرّع نحو العمق المزدحم تحت الضغط.',
    ],
    correctDecisions: [
      {
        situation: 'الحارس يمتلك الكرة والخصم يضغط عالياً على العمق',
        mistake: 'البقاء قريباً من دائرة الوسط أو طلب الكرة وظهرك للخصم في العمق.',
        correctDecision: 'فتح عرض الملعب نحو الطرف الأيمن (x≈78–84, y≈72–76) لاستلام آمن.',
        whyItWorks: 'يُجبر الخصم على قطع مسافة أكبر للضغط ويفتح ممر التمرير للجناح العكسي الهابط.',
      },
    ],
  },
  {
    id: 'inverted_winger',
    formationId: '2-2-1',
    slotIndex: 4,
    slotId: 'm1',
    roleGroup: 'wing',
    code: 'INV',
    titleAr: 'الجناح العكسي',
    titleEn: 'Inverted Winger',
    identityLine: 'رابط الخطوط الذي يهبط للعمق النصفي لإنهاء الضغط ويغلق الممر الداخلي دفاعياً.',
    homePosition: { x: 66, y: 52 },
    preferredZones: [
      {
        id: 'inv_halfspace',
        label: 'المساحة النصفية بين الخطوط',
        x: 60,
        y: 56,
        rx: 15,
        ry: 12,
        guidance: 'تحرّك في الممر النصفي بين وسط الخصم ودفاعه لاستلام تمريرة الليبرو بزاوية مفتوحة.',
      },
    ],
    conditionalZones: [
      {
        id: 'inv_drop_triangle',
        label: 'الهبوط لصناعة مثلث البناء',
        x: 60,
        y: 62,
        rx: 12,
        ry: 9,
        guidance: 'عندما يضغط الخصم على الليبرو، اهبط 6 أمتار لصناعة مثلث تمرير واضح.',
      },
      {
        id: 'inv_far_run',
        label: 'الاختراق خلف ظهر الدفاع عند هبوط المهاجم الوهمي',
        x: 56,
        y: 30,
        rx: 16,
        ry: 11,
        guidance: 'عندما يسحب المهاجم الوهمي قلب الدفاع للخارج، انطلق قطرياً في المساحة الفارغة.',
      },
    ],
    highRiskZones: [
      {
        id: 'inv_hide_touchline',
        label: 'الاختباء العالي على الخط بدون زاوية',
        x: 84,
        y: 34,
        rx: 10,
        ry: 13,
        guidance: 'البقاء بعيداً عن الكرة أثناء ضغط الخصم يعزل الليبرو ويحرمه من خيار التمرير الداخلي.',
      },
    ],
    onBallResponsibilities: [
      'الدوران بنصف لفة نحو الجهة العكسية فور الاستلام بين الخطوط.',
      'تحويل اللعب إلى الجناح المقابل أو التمرير في العمق للمهاجم.',
    ],
    offBallResponsibilities: [
      'قراءة لحظة استلام الليبرو والهبوط في زاوية غير محجوبة بظل مدافع الخصم.',
      'الارتداد الدفاعي لإغلاق الممر الداخلي ومساعدة الليبرو في محاصرة الطرف.',
    ],
    pressingTriggers: [
      'عندما يُجبر الليبرو خصمه على التوقف على الطرف، اقترب فوراً لإكمال الكماشة وخطف الكرة.',
      'أغلق خط التمرير القطري نحو قلب الوسط قبل مطاردة الكرة.',
    ],
    transitionBehavior: {
      attackToDefense: 'ادخل للعمق النصفي فوراً لتضييق الملعب ومنع التمرير الطولي.',
      defenseToAttack: 'اعرض نفسك بين الخطوط أو انطلق في المساحة التي يفرّغها المهاجم الوهمي.',
    },
    partnerRelationships: [
      {
        partnerId: 'buildup_libero',
        relationTitle: 'جدار التمرير الأول',
        coordinationRule: 'عندما يستلم الليبرو على الطرف، يهبط الجناح العكسي داخل الممر النصفي فوراً.',
      },
      {
        partnerId: 'false_9',
        relationTitle: 'تبادل العمق والمساحة',
        coordinationRule: 'عندما يهبط المهاجم الوهمي لاستلام الكرة، يهاجم الجناح العكسي المساحة الأمامية.',
      },
    ],
    commonMistakes: [
      'الوقوف ثابتاً خلف مدافع الخصم دون صناعة زاوية تمرير.',
      'التأخر في العودة لإغلاق المساحة بين الليبرو والارتكاز دفاعياً.',
    ],
    correctDecisions: [
      {
        situation: 'ليبرو البناء استلم الكرة على الطرف ويقترب منه مهاجم الخصم',
        mistake: 'الوقوف عالياً على الخط أو الالتصاق بالعمق المزدحم.',
        correctDecision: 'الهبوط نحو المساحة النصفية (x≈58–64, y≈56–62) لإنشاء مثلث التمرير.',
        whyItWorks: 'يمنح الليبرو تمريرة قطرية قصيرة تكسر خط الضغط الأول وتفتح الجهة المقابلة.',
      },
    ],
  },
  {
    id: 'false_9',
    formationId: '2-2-1',
    slotIndex: 5,
    slotId: 'st',
    roleGroup: 'fwd',
    code: 'F9',
    titleAr: 'المهاجم الوهمي',
    titleEn: 'False 9',
    identityLine: 'محرّك المساحات الذي يسحب الدفاع بنزوله الذكي ويبدأ توجيه الضغط العالي.',
    homePosition: { x: 50, y: 26 },
    preferredZones: [
      {
        id: 'f9_pocket',
        label: 'الجيب الأمامي المركزي',
        x: 50,
        y: 30,
        rx: 18,
        ry: 11,
        guidance: 'تثبيت مدافعي الخصم ثم التحرك المفاجئ لاستلام الكرة أو تفريغ العمق للقادمين.',
      },
    ],
    conditionalZones: [
      {
        id: 'f9_drop_link',
        label: 'الهبوط لربط الوسط وكسر التكتل',
        x: 50,
        y: 44,
        rx: 16,
        ry: 10,
        guidance: 'عندما يُغلق الخصم العمق، اهبط لاستلام الكرة وإجبار قلب الدفاع على الاختيار بين ملاحقتك أو تركك حراً.',
      },
      {
        id: 'f9_pin_high',
        label: 'التمركز خلف الدفاع في 6v6 بلا تسلل',
        x: 52,
        y: 19,
        rx: 16,
        ry: 8,
        guidance: 'بسبب غياب التسلل، التمدّد قرب المرمى يطيل ملعب الخصم ويمنح الوسط مساحة تنفس.',
      },
    ],
    highRiskZones: [
      {
        id: 'f9_drop_too_deep',
        label: 'الهبوط المفرط إلى منطقة البناء',
        x: 50,
        y: 66,
        rx: 16,
        ry: 10,
        guidance: 'النزول العميق أكثر من اللازم يزاحم الوسط ويفقد الفريق أي تهديد خلف دفاع الخصم.',
      },
    ],
    onBallResponsibilities: [
      'الاستلام بلمسة واحدة وتمريرها للجناح المنطلق في المساحة المفتوحة.',
      'حماية الكرة بالجسم لثانية واحدة لانتظار صعود الجناح العكسي.',
    ],
    offBallResponsibilities: [
      'تمديد الملعب عمودياً لمنع دفاع الخصم من التقدم وخنق الوسط.',
      'التحرك في توقيت معاكس للجناح العكسي حتى لا يتصادما في نفس المربع.',
    ],
    pressingTriggers: [
      'ابدأ الضغط بقوس نحو الخط الجانبي لإغلاق التمرير لقلب وسط الخصم.',
      'عند استخلاص الكرة في الخلف، افتح فوراً زاوية تمرير عمودية لبدء المرتدة.',
    ],
    transitionBehavior: {
      attackToDefense: 'أغلق أول تمريرة عمودية لقلب الخصم لثلاث ثوانٍ حتى ينتظم الدفاع.',
      defenseToAttack: 'اطلب الكرة في المساحة المفتوحة بزاوية واضحة فور افتكاك الزملاء للكرة.',
    },
    partnerRelationships: [
      {
        partnerId: 'inverted_winger',
        relationTitle: 'ثنائية السحب والانطلاق',
        coordinationRule: 'عندما يهبط المهاجم الوهمي يسحب المدافع ويفتح العمق لانطلاقة الجناح العكسي.',
      },
      {
        partnerId: 'anchor',
        relationTitle: 'المخرج العمودي بعد الافتكاك',
        coordinationRule: 'عندما يستخلص الارتكاز أو الوسط الكرة، يوفّر المهاجم الوهمي هدفاً فورياً في العمق.',
      },
    ],
    commonMistakes: [
      'الهبوط في نفس وقت هبوط الجناح العكسي مما يسبب تكدّساً في منتصف الملعب.',
      'الوقوف ثابتاً بين مدافعي الخصم دون حركة فصل قبل التمريرة.',
    ],
    correctDecisions: [
      {
        situation: 'الوسط كسر ضغط الخصم ويستعد للتحول الأمامي',
        mistake: 'التراجع إلى منتصف الملعب وتضييق مساحة الهجوم.',
        correctDecision: 'التمدّد في العمق الأمامي (x≈48–54, y≈20–26) لسحب الدفاع وفتح ممر التمرير.',
        whyItWorks: 'يبقي مدافعي الخصم منشغلين بالعمق ويمنح الجناح والمهاجم خيارَي تمرير وإنهاء.',
      },
    ],
  },
];

export function getRoleDnaById(roleId: BlackBoxRoleId): RoleDnaProfile {
  return ROLE_DNA_CATALOG.find((r) => r.id === roleId) || ROLE_DNA_CATALOG[0];
}

/**
 * Connects Role DNA directly with the existing `FORMATIONS_CATALOG` & `getRoleSpotlightSequence`
 * from `src/tacticsData.ts` so both systems share one tactical source of truth.
 */
export function resolveRoleWithFormationSlot(roleId: BlackBoxRoleId): {
  dna: RoleDnaProfile;
  slot: FormationSlotDef;
  legacySpotlightRule: string;
} {
  const dna = getRoleDnaById(roleId);
  const form = getFormationDef('6v6', dna.formationId);
  const slot = form.slots.find((s) => s.id === dna.slotId) || form.slots[dna.slotIndex] || form.slots[1];
  const slotIdxInForm = Math.max(0, form.slots.findIndex((s) => s.id === slot.id));
  const spotlight = getRoleSpotlightSequence('6v6', dna.formationId, slotIdxInForm);
  return {
    dna,
    slot,
    legacySpotlightRule: spotlight.goldenRule,
  };
}

/**
 * Transparent, explainable football rules evaluating synergies and tactical warnings
 * for any combination of active MVP roles (never invents unsupported percentages).
 */
export function evaluateRolePairings(selectedRoleIds: ReadonlyArray<BlackBoxRoleId>): RolePairingReport {
  const unique = Array.from(new Set(selectedRoleIds));
  const has = (id: BlackBoxRoleId) => unique.includes(id);

  const synergies: RoleRuleEvaluationItem[] = [];
  const warnings: RoleRuleEvaluationItem[] = [];

  if (has('anchor') && has('buildup_libero')) {
    synergies.push({
      id: 'syn_anchor_libero',
      kind: 'synergy',
      roles: ['anchor', 'buildup_libero'],
      title: 'تناغم الضغط والتغطية الخلفية',
      explanation:
        'يمنح وجود الارتكاز الدفاعي حرية مدروسة لليبرو البناء كي يوسّع الملعب أو يضغط على الطرف دون انكشاف العمق.',
      tacticalAdjustment: 'قاعدة واضحة: خروج الليبرو للأمام أو الطرف يعني ثبات الارتكاز تلقائياً أمام المرمى.',
    });
  }

  if (has('buildup_libero') && has('inverted_winger')) {
    synergies.push({
      id: 'syn_libero_inverted',
      kind: 'synergy',
      roles: ['buildup_libero', 'inverted_winger'],
      title: 'مثلث الخروج بالكرة تحت الضغط',
      explanation:
        'عندما يفتح ليبرو البناء عرض الملعب، يفرّغ الممر النصفي لهبوط الجناح العكسي فيتكوّن مثلث تمرير يكسر الضغط الأول.',
      tacticalAdjustment: 'لا يصعد الجناح العكسي بعيداً قبل أن يؤمّن الليبرو الاستلام الأول.',
    });
  }

  if (has('false_9') && has('inverted_winger')) {
    synergies.push({
      id: 'syn_f9_inverted',
      kind: 'synergy',
      roles: ['false_9', 'inverted_winger'],
      title: 'تبادل العمق والمساحة الأمامية',
      explanation:
        'نزول المهاجم الوهمي يسحب قلب دفاع الخصم، ما يفتح المساحة القطرية أمام انطلاقة الجناح العكسي.',
      tacticalAdjustment: 'تحرّكا بتوقيت متعاكس: واحد يهبط للاستلام والثاني يهاجم المساحة خلف الدفاع.',
    });
  }

  // Transparent tactical warnings (role conflicts or uncovered structural risks)
  if (has('buildup_libero') && !has('anchor')) {
    warnings.push({
      id: 'warn_libero_without_anchor',
      kind: 'warning',
      roles: ['buildup_libero'],
      title: 'تحذير انكشاف العمق عند تقدم الليبرو',
      explanation:
        'تفعيل ليبرو البناء دون تثبيت دور الارتكاز الدفاعي يزيد خطر الهجمات المرتدة في عمق 6v6 عند فقدان الكرة.',
      tacticalAdjustment: 'قلّل تقدم الليبرو بعد منتصف الملعب أو فعّل دور الارتكاز الدفاعي لحماية الظهر.',
    });
  }

  if (has('false_9') && has('inverted_winger') && !has('buildup_libero')) {
    warnings.push({
      id: 'warn_central_pocket_crowding',
      kind: 'warning',
      roles: ['false_9', 'inverted_winger'],
      title: 'تنبيه ازدحام الممر الداخلي',
      explanation:
        'يميل الجناح العكسي والمهاجم الوهمي للدخول إلى العمق معاً؛ بدون ليبرو يوسّع الطرف قد تضيق زوايا التمرير.',
      tacticalAdjustment: 'إذا دخل الجناح العكسي للقلب، حافظ على بقاء المهاجم الوهمي عالياً لتمديد الدفاع.',
    });
  }

  if (has('anchor') && has('false_9') && !has('inverted_winger') && !has('buildup_libero')) {
    warnings.push({
      id: 'warn_vertical_gap',
      kind: 'warning',
      roles: ['anchor', 'false_9'],
      title: 'فجوة ربط بين العمق والهجوم',
      explanation:
        'الارتكاز متمركز في الثلث الدفاعي والمهاجم الوهمي في الأمام؛ بدون لاعب رابط في الوسط تصبح التمريرة الطويلة أسهل للقطع.',
      tacticalAdjustment: 'أشرك الجناح العكسي أو ليبرو البناء لخلق محطة تمرير وسيطة بين الخطين.',
    });
  }

  return {
    activeRoles: unique,
    synergies,
    warnings,
  };
}

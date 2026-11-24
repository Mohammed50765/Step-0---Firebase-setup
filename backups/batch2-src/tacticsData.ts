import { SKILL_KEYS } from './security';

export type PitchSizeId = '5v5' | '6v6' | '7v7' | '11v11';
export type TacticalPhaseId = 'attack' | 'defend' | 'counter' | 'gegenpress';
export type RoleGroup = 'gk' | 'def' | 'mid' | 'wing' | 'fwd';

export interface FormationSlotDef {
  id: string;
  label: string;
  short: string;
  roleGroup: RoleGroup;
  x: number; // 0..100 (left to right)
  y: number; // 0..100 (top opponent goal = 0, bottom our goal = 100)
}

export interface FormationDef {
  id: string;
  size: PitchSizeId;
  name: string;
  tagline: string;
  slots: FormationSlotDef[];
  oppDefault: Array<{ x: number; y: number }>;
  links: Array<[number, number]>; // pairs of slot indices for chemistry lines
}

export interface TacticalArrow {
  from: [number, number];
  to: [number, number];
  kind: 'ball' | 'run' | 'cover';
}

export interface TacticalZone {
  x: number;
  y: number;
  r: number;
  label?: string;
  color?: 'gold' | 'cyan' | 'rose' | 'emerald';
}

export interface TacticalKeyframe {
  title: string;
  narration: string;
  durationMs: number;
  ourPos: Array<{ x: number; y: number }>;
  oppPos: Array<{ x: number; y: number }>;
  ball: { x: number; y: number };
  activeIndices: number[];
  arrows: TacticalArrow[];
  zones?: TacticalZone[];
  triangles?: Array<[number, number, number]>;
}

export interface TacticalSequence {
  id: string;
  title: string;
  subtitle: string;
  size: PitchSizeId;
  offsideEnabled: boolean;
  frames: TacticalKeyframe[];
}

export interface ScenarioDef {
  id: string;
  index: number;
  icon: string;
  title: string;
  category: 'هجومي' | 'دفاعي' | 'كرات ثابتة' | 'مواقف حاسمة';
  summary: string;
  frames: TacticalKeyframe[];
}

export interface RoleSpotlightInfo {
  roleGroup: RoleGroup;
  slotLabel: string;
  slotShort: string;
  offenseDuties: string[];
  defenseDuties: string[];
  goldenRule: string;
  zone: { x: number; y: number; rx: number; ry: number };
  sequence: TacticalSequence;
}

export const PITCH_SIZE_META: Record<
  PitchSizeId,
  { label: string; count: number; offside: boolean; badge: string }
> = {
  '5v5': { label: 'خماسي 5v5', count: 5, offside: false, badge: 'بدون تسلل • ملعب سريع' },
  '6v6': { label: 'سداسي 6v6', count: 6, offside: false, badge: 'الوضع الافتراضي • بدون تسلل' },
  '7v7': { label: 'سباعي 7v7', count: 7, offside: false, badge: 'بدون تسلل • أجنحة أوسع' },
  '11v11': { label: 'رسمي 11v11', count: 11, offside: true, badge: 'خط التسلل مفعّل تلقائياً' },
};

export const FORMATIONS_CATALOG: Record<PitchSizeId, FormationDef[]> = {
  '6v6': [
    {
      id: '2-2-1',
      size: '6v6',
      name: '2-2-1 المتوازنة',
      tagline: 'الأكثر أماناً في السداسي: مثلثات تمرير وتغطية خلفية ثابتة',
      slots: [
        { id: 'gk', label: 'حارس المرمى', short: 'GK', roleGroup: 'gk', x: 50, y: 90 },
        { id: 'd1', label: 'مدافع أيمن', short: 'RB', roleGroup: 'def', x: 72, y: 73 },
        { id: 'd2', label: 'مدافع أيسر', short: 'LB', roleGroup: 'def', x: 28, y: 73 },
        { id: 'm1', label: 'وسط أيمن', short: 'RM', roleGroup: 'wing', x: 74, y: 48 },
        { id: 'm2', label: 'وسط أيسر', short: 'LM', roleGroup: 'mid', x: 26, y: 48 },
        { id: 'st', label: 'مهاجم ثابت', short: 'ST', roleGroup: 'fwd', x: 50, y: 24 },
      ],
      oppDefault: [
        { x: 50, y: 11 },
        { x: 32, y: 27 },
        { x: 68, y: 27 },
        { x: 28, y: 50 },
        { x: 72, y: 50 },
        { x: 50, y: 66 },
      ],
      links: [
        [0, 1], [0, 2], [1, 2], [1, 3], [2, 4], [3, 4], [3, 5], [4, 5],
      ],
    },
    {
      id: '1-2-2',
      size: '6v6',
      name: '1-2-2 الهجومية',
      tagline: 'ضغط عالٍ بثنائي هجوم مع ليبرو ذكي يؤمّن الخلف',
      slots: [
        { id: 'gk', label: 'حارس المرمى', short: 'GK', roleGroup: 'gk', x: 50, y: 90 },
        { id: 'cb', label: 'مدافع ليبرو', short: 'CB', roleGroup: 'def', x: 50, y: 74 },
        { id: 'm1', label: 'وسط أيمن', short: 'CM', roleGroup: 'mid', x: 74, y: 53 },
        { id: 'm2', label: 'وسط أيسر', short: 'CM', roleGroup: 'mid', x: 26, y: 53 },
        { id: 'f1', label: 'مهاجم أيمن', short: 'RW', roleGroup: 'wing', x: 68, y: 25 },
        { id: 'f2', label: 'مهاجم أيسر', short: 'ST', roleGroup: 'fwd', x: 32, y: 25 },
      ],
      oppDefault: [
        { x: 50, y: 11 },
        { x: 35, y: 28 },
        { x: 65, y: 28 },
        { x: 50, y: 46 },
        { x: 26, y: 56 },
        { x: 74, y: 56 },
      ],
      links: [
        [0, 1], [1, 2], [1, 3], [2, 3], [2, 4], [3, 5], [4, 5],
      ],
    },
    {
      id: '2-1-2',
      size: '6v6',
      name: '2-1-2 صانع الألعاب #10',
      tagline: 'صانع ألعاب حر بالقلب يربط الدفاع بثنائي المقدمة',
      slots: [
        { id: 'gk', label: 'حارس المرمى', short: 'GK', roleGroup: 'gk', x: 50, y: 90 },
        { id: 'd1', label: 'مدافع أيمن', short: 'CB', roleGroup: 'def', x: 70, y: 74 },
        { id: 'd2', label: 'مدافع أيسر', short: 'CB', roleGroup: 'def', x: 30, y: 74 },
        { id: 'cam', label: 'صانع ألعاب #10', short: 'CAM', roleGroup: 'mid', x: 50, y: 50 },
        { id: 'f1', label: 'جناح/مهاجم أيمن', short: 'RW', roleGroup: 'wing', x: 72, y: 25 },
        { id: 'f2', label: 'مهاجم أيسر', short: 'ST', roleGroup: 'fwd', x: 28, y: 25 },
      ],
      oppDefault: [
        { x: 50, y: 11 },
        { x: 30, y: 28 },
        { x: 70, y: 28 },
        { x: 50, y: 44 },
        { x: 32, y: 60 },
        { x: 68, y: 60 },
      ],
      links: [
        [0, 1], [0, 2], [1, 2], [1, 3], [2, 3], [3, 4], [3, 5], [4, 5],
      ],
    },
    {
      id: '3-1-1',
      size: '6v6',
      name: '3-1-1 الدفاعية المرتدة',
      tagline: 'جدار دفاعي ثلاثي يحمي العمق مع مرتدات خاطفة للمهاجم',
      slots: [
        { id: 'gk', label: 'حارس المرمى', short: 'GK', roleGroup: 'gk', x: 50, y: 90 },
        { id: 'd1', label: 'ظهير أيمن', short: 'RB', roleGroup: 'def', x: 78, y: 71 },
        { id: 'd2', label: 'قلب دفاع', short: 'CB', roleGroup: 'def', x: 50, y: 76 },
        { id: 'd3', label: 'ظهير أيسر', short: 'LB', roleGroup: 'def', x: 22, y: 71 },
        { id: 'cm', label: 'محور الربط', short: 'CM', roleGroup: 'mid', x: 50, y: 50 },
        { id: 'st', label: 'مهاجم المرتدة', short: 'ST', roleGroup: 'fwd', x: 50, y: 24 },
      ],
      oppDefault: [
        { x: 50, y: 11 },
        { x: 36, y: 30 },
        { x: 64, y: 30 },
        { x: 24, y: 52 },
        { x: 76, y: 52 },
        { x: 50, y: 62 },
      ],
      links: [
        [0, 2], [1, 2], [2, 3], [1, 4], [2, 4], [3, 4], [4, 5],
      ],
    },
    {
      id: '1-3-1',
      size: '6v6',
      name: '1-3-1 الاستحواذ',
      tagline: 'سيطرة كاملة على وسط الملعب بـ 3 لاعبين وتدوير مستمر للكرة',
      slots: [
        { id: 'gk', label: 'حارس المرمى', short: 'GK', roleGroup: 'gk', x: 50, y: 90 },
        { id: 'cb', label: 'قلب الدفاع', short: 'CB', roleGroup: 'def', x: 50, y: 75 },
        { id: 'rm', label: 'طرف أيمن', short: 'RW', roleGroup: 'wing', x: 80, y: 50 },
        { id: 'cm', label: 'مايسترو الوسط', short: 'CAM', roleGroup: 'mid', x: 50, y: 52 },
        { id: 'lm', label: 'طرف أيسر', short: 'LW', roleGroup: 'wing', x: 20, y: 50 },
        { id: 'st', label: 'رأس الحربة', short: 'ST', roleGroup: 'fwd', x: 50, y: 23 },
      ],
      oppDefault: [
        { x: 50, y: 11 },
        { x: 33, y: 27 },
        { x: 67, y: 27 },
        { x: 30, y: 50 },
        { x: 70, y: 50 },
        { x: 50, y: 64 },
      ],
      links: [
        [0, 1], [1, 3], [2, 3], [3, 4], [2, 5], [3, 5], [4, 5],
      ],
    },
  ],

  '5v5': [
    {
      id: '1-2-1',
      size: '5v5',
      name: '1-2-1 الماسة',
      tagline: 'التشكيلة الذهبية للخماسي: زوايا تمرير مفتوحة في كل اتجاه',
      slots: [
        { id: 'gk', label: 'حارس مرمى', short: 'GK', roleGroup: 'gk', x: 50, y: 90 },
        { id: 'cb', label: 'مدافع', short: 'CB', roleGroup: 'def', x: 50, y: 72 },
        { id: 'rm', label: 'جناح أيمن', short: 'RW', roleGroup: 'wing', x: 76, y: 49 },
        { id: 'lm', label: 'جناح أيسر', short: 'LW', roleGroup: 'wing', x: 24, y: 49 },
        { id: 'st', label: 'مهاجم', short: 'ST', roleGroup: 'fwd', x: 50, y: 24 },
      ],
      oppDefault: [
        { x: 50, y: 11 }, { x: 50, y: 30 }, { x: 28, y: 48 }, { x: 72, y: 48 }, { x: 50, y: 64 },
      ],
      links: [[0, 1], [1, 2], [1, 3], [2, 4], [3, 4], [2, 3]],
    },
    {
      id: '2-2',
      size: '5v5',
      name: '2-2 المربع',
      tagline: 'توازن دفاعي هجومي وتبادل مراكز سريع',
      slots: [
        { id: 'gk', label: 'حارس مرمى', short: 'GK', roleGroup: 'gk', x: 50, y: 90 },
        { id: 'd1', label: 'مدافع أيمن', short: 'RB', roleGroup: 'def', x: 70, y: 70 },
        { id: 'd2', label: 'مدافع أيسر', short: 'LB', roleGroup: 'def', x: 30, y: 70 },
        { id: 'f1', label: 'مهاجم أيمن', short: 'RW', roleGroup: 'fwd', x: 70, y: 30 },
        { id: 'f2', label: 'مهاجم أيسر', short: 'ST', roleGroup: 'fwd', x: 30, y: 30 },
      ],
      oppDefault: [
        { x: 50, y: 11 }, { x: 32, y: 30 }, { x: 68, y: 30 }, { x: 32, y: 60 }, { x: 68, y: 60 },
      ],
      links: [[0, 1], [0, 2], [1, 2], [1, 3], [2, 4], [3, 4]],
    },
    {
      id: '1-1-2',
      size: '5v5',
      name: '1-1-2 الضغط العالي',
      tagline: 'للبحث عن هدف سريع بثنائي هجومي وصانع ألعاب',
      slots: [
        { id: 'gk', label: 'حارس مرمى', short: 'GK', roleGroup: 'gk', x: 50, y: 90 },
        { id: 'cb', label: 'قلب دفاع', short: 'CB', roleGroup: 'def', x: 50, y: 75 },
        { id: 'cm', label: 'صانع ألعاب', short: 'CAM', roleGroup: 'mid', x: 50, y: 52 },
        { id: 'f1', label: 'مهاجم أيمن', short: 'RW', roleGroup: 'wing', x: 72, y: 25 },
        { id: 'f2', label: 'مهاجم أيسر', short: 'ST', roleGroup: 'fwd', x: 28, y: 25 },
      ],
      oppDefault: [
        { x: 50, y: 11 }, { x: 35, y: 28 }, { x: 65, y: 28 }, { x: 50, y: 48 }, { x: 50, y: 65 },
      ],
      links: [[0, 1], [1, 2], [2, 3], [2, 4], [3, 4]],
    },
  ],

  '7v7': [
    {
      id: '2-3-1',
      size: '7v7',
      name: '2-3-1 الكلاسيكية',
      tagline: 'أفضل توازن للسباعي بأجنحة نشطة وقلب وسط مسيطر',
      slots: [
        { id: 'gk', label: 'حارس مرمى', short: 'GK', roleGroup: 'gk', x: 50, y: 91 },
        { id: 'd1', label: 'مدافع أيمن', short: 'CB', roleGroup: 'def', x: 68, y: 75 },
        { id: 'd2', label: 'مدافع أيسر', short: 'CB', roleGroup: 'def', x: 32, y: 75 },
        { id: 'rm', label: 'جناح أيمن', short: 'RW', roleGroup: 'wing', x: 82, y: 50 },
        { id: 'cm', label: 'صانع ألعاب', short: 'CAM', roleGroup: 'mid', x: 50, y: 52 },
        { id: 'lm', label: 'جناح أيسر', short: 'LW', roleGroup: 'wing', x: 18, y: 50 },
        { id: 'st', label: 'مهاجم صريح', short: 'ST', roleGroup: 'fwd', x: 50, y: 22 },
      ],
      oppDefault: [
        { x: 50, y: 10 }, { x: 32, y: 25 }, { x: 68, y: 25 }, { x: 20, y: 48 }, { x: 50, y: 46 }, { x: 80, y: 48 }, { x: 50, y: 65 },
      ],
      links: [[0, 1], [0, 2], [1, 2], [1, 4], [2, 4], [3, 4], [4, 5], [3, 6], [4, 6], [5, 6]],
    },
    {
      id: '3-2-1',
      size: '7v7',
      name: '3-2-1 الصلبة',
      tagline: 'ثلاثي دفاعي قوي مع ثنائي وسط يصنع المرتدات',
      slots: [
        { id: 'gk', label: 'حارس مرمى', short: 'GK', roleGroup: 'gk', x: 50, y: 91 },
        { id: 'rb', label: 'ظهير أيمن', short: 'RB', roleGroup: 'def', x: 80, y: 72 },
        { id: 'cb', label: 'قلب دفاع', short: 'CB', roleGroup: 'def', x: 50, y: 77 },
        { id: 'lb', label: 'ظهير أيسر', short: 'LB', roleGroup: 'def', x: 20, y: 72 },
        { id: 'm1', label: 'وسط أيمن', short: 'CM', roleGroup: 'mid', x: 66, y: 49 },
        { id: 'm2', label: 'وسط أيسر', short: 'CM', roleGroup: 'mid', x: 34, y: 49 },
        { id: 'st', label: 'مهاجم', short: 'ST', roleGroup: 'fwd', x: 50, y: 22 },
      ],
      oppDefault: [
        { x: 50, y: 10 }, { x: 32, y: 25 }, { x: 68, y: 25 }, { x: 22, y: 48 }, { x: 78, y: 48 }, { x: 40, y: 62 }, { x: 60, y: 62 },
      ],
      links: [[0, 2], [1, 2], [2, 3], [1, 4], [3, 5], [4, 5], [4, 6], [5, 6]],
    },
    {
      id: '2-2-2',
      size: '7v7',
      name: '2-2-2 الهجومية',
      tagline: 'قوة ضاربة بمهاجمين وثنائي وسط مزدوج',
      slots: [
        { id: 'gk', label: 'حارس مرمى', short: 'GK', roleGroup: 'gk', x: 50, y: 91 },
        { id: 'd1', label: 'مدافع أيمن', short: 'CB', roleGroup: 'def', x: 68, y: 75 },
        { id: 'd2', label: 'مدافع أيسر', short: 'CB', roleGroup: 'def', x: 32, y: 75 },
        { id: 'm1', label: 'وسط أيمن', short: 'CM', roleGroup: 'mid', x: 72, y: 51 },
        { id: 'm2', label: 'وسط أيسر', short: 'CM', roleGroup: 'mid', x: 28, y: 51 },
        { id: 'f1', label: 'مهاجم أيمن', short: 'ST', roleGroup: 'fwd', x: 66, y: 23 },
        { id: 'f2', label: 'مهاجم أيسر', short: 'ST', roleGroup: 'fwd', x: 34, y: 23 },
      ],
      oppDefault: [
        { x: 50, y: 10 }, { x: 30, y: 26 }, { x: 70, y: 26 }, { x: 30, y: 48 }, { x: 70, y: 48 }, { x: 36, y: 64 }, { x: 64, y: 64 },
      ],
      links: [[0, 1], [0, 2], [1, 2], [1, 3], [2, 4], [3, 4], [3, 5], [4, 6], [5, 6]],
    },
  ],

  '11v11': [
    {
      id: '4-3-3',
      size: '11v11',
      name: '4-3-3 الهجومية',
      tagline: 'الانتشار العالمي: أجنحة عريضة وخط تسلل ذكي',
      slots: [
        { id: 'gk', label: 'حارس', short: 'GK', roleGroup: 'gk', x: 50, y: 93 },
        { id: 'rb', label: 'ظهير أيمن', short: 'RB', roleGroup: 'def', x: 84, y: 76 },
        { id: 'cb1', label: 'قلب دفاع', short: 'CB', roleGroup: 'def', x: 62, y: 79 },
        { id: 'cb2', label: 'قلب دفاع', short: 'CB', roleGroup: 'def', x: 38, y: 79 },
        { id: 'lb', label: 'ظهير أيسر', short: 'LB', roleGroup: 'def', x: 16, y: 76 },
        { id: 'cm1', label: 'وسط أيمن', short: 'CM', roleGroup: 'mid', x: 70, y: 54 },
        { id: 'cdm', label: 'ارتكاز', short: 'CDM', roleGroup: 'mid', x: 50, y: 61 },
        { id: 'cm2', label: 'وسط أيسر', short: 'CM', roleGroup: 'mid', x: 30, y: 54 },
        { id: 'rw', label: 'جناح أيمن', short: 'RW', roleGroup: 'wing', x: 82, y: 28 },
        { id: 'st', label: 'رأس حربة', short: 'ST', roleGroup: 'fwd', x: 50, y: 21 },
        { id: 'lw', label: 'جناح أيسر', short: 'LW', roleGroup: 'wing', x: 18, y: 28 },
      ],
      oppDefault: [
        { x: 50, y: 8 }, { x: 18, y: 24 }, { x: 39, y: 23 }, { x: 61, y: 23 }, { x: 82, y: 24 },
        { x: 26, y: 45 }, { x: 50, y: 43 }, { x: 74, y: 45 }, { x: 22, y: 64 }, { x: 50, y: 66 }, { x: 78, y: 64 },
      ],
      links: [[0, 2], [0, 3], [1, 2], [2, 3], [3, 4], [2, 6], [3, 6], [5, 6], [6, 7], [5, 8], [7, 10], [8, 9], [9, 10]],
    },
    {
      id: '4-2-3-1',
      size: '11v11',
      name: '4-2-3-1 المتوازنة',
      tagline: 'محوران دفاعيان يؤمّنان صانع الألعاب #10 والمهاجم',
      slots: [
        { id: 'gk', label: 'حارس', short: 'GK', roleGroup: 'gk', x: 50, y: 93 },
        { id: 'rb', label: 'ظهير أيمن', short: 'RB', roleGroup: 'def', x: 84, y: 77 },
        { id: 'cb1', label: 'قلب دفاع', short: 'CB', roleGroup: 'def', x: 62, y: 80 },
        { id: 'cb2', label: 'قلب دفاع', short: 'CB', roleGroup: 'def', x: 38, y: 80 },
        { id: 'lb', label: 'ظهير أيسر', short: 'LB', roleGroup: 'def', x: 16, y: 77 },
        { id: 'cdm1', label: 'محور أيمن', short: 'CDM', roleGroup: 'mid', x: 62, y: 61 },
        { id: 'cdm2', label: 'محور أيسر', short: 'CDM', roleGroup: 'mid', x: 38, y: 61 },
        { id: 'ram', label: 'جناح أيمن', short: 'RW', roleGroup: 'wing', x: 80, y: 41 },
        { id: 'cam', label: 'صانع ألعاب #10', short: 'CAM', roleGroup: 'mid', x: 50, y: 41 },
        { id: 'lam', label: 'جناح أيسر', short: 'LW', roleGroup: 'wing', x: 20, y: 41 },
        { id: 'st', label: 'مهاجم', short: 'ST', roleGroup: 'fwd', x: 50, y: 20 },
      ],
      oppDefault: [
        { x: 50, y: 8 }, { x: 18, y: 25 }, { x: 39, y: 24 }, { x: 61, y: 24 }, { x: 82, y: 25 },
        { x: 34, y: 45 }, { x: 66, y: 45 }, { x: 20, y: 58 }, { x: 50, y: 56 }, { x: 80, y: 58 }, { x: 50, y: 68 },
      ],
      links: [[0, 2], [0, 3], [1, 2], [2, 3], [3, 4], [2, 5], [3, 6], [5, 6], [5, 8], [6, 8], [7, 8], [8, 9], [8, 10]],
    },
    {
      id: '3-5-2',
      size: '11v11',
      name: '3-5-2 السيطرة والأطراف',
      tagline: 'ثلاثي دفاعي مع جناحين طائرين وثنائي هجوم قاتل',
      slots: [
        { id: 'gk', label: 'حارس', short: 'GK', roleGroup: 'gk', x: 50, y: 93 },
        { id: 'cb1', label: 'مدافع أيمن', short: 'CB', roleGroup: 'def', x: 72, y: 78 },
        { id: 'cb2', label: 'قلب دفاع', short: 'CB', roleGroup: 'def', x: 50, y: 81 },
        { id: 'cb3', label: 'مدافع أيسر', short: 'CB', roleGroup: 'def', x: 28, y: 78 },
        { id: 'rwb', label: 'ظهير جناح أيمن', short: 'RWB', roleGroup: 'wing', x: 86, y: 53 },
        { id: 'cm1', label: 'وسط أيمن', short: 'CM', roleGroup: 'mid', x: 66, y: 55 },
        { id: 'cdm', label: 'ارتكاز', short: 'CDM', roleGroup: 'mid', x: 50, y: 62 },
        { id: 'cm2', label: 'وسط أيسر', short: 'CM', roleGroup: 'mid', x: 34, y: 55 },
        { id: 'lwb', label: 'ظهير جناح أيسر', short: 'LWB', roleGroup: 'wing', x: 14, y: 53 },
        { id: 'st1', label: 'مهاجم أيمن', short: 'ST', roleGroup: 'fwd', x: 63, y: 23 },
        { id: 'st2', label: 'مهاجم أيسر', short: 'ST', roleGroup: 'fwd', x: 37, y: 23 },
      ],
      oppDefault: [
        { x: 50, y: 8 }, { x: 18, y: 24 }, { x: 39, y: 23 }, { x: 61, y: 23 }, { x: 82, y: 24 },
        { x: 24, y: 46 }, { x: 50, y: 44 }, { x: 76, y: 46 }, { x: 24, y: 63 }, { x: 50, y: 66 }, { x: 76, y: 63 },
      ],
      links: [[0, 2], [1, 2], [2, 3], [1, 4], [3, 8], [2, 6], [5, 6], [6, 7], [5, 9], [7, 10], [9, 10]],
    },
    {
      id: '4-4-2',
      size: '11v11',
      name: '4-4-2 الكلاسيكية',
      tagline: 'خطّان متماسكان يغلقان المساحات مع ثنائي هجوم متفاهم',
      slots: [
        { id: 'gk', label: 'حارس', short: 'GK', roleGroup: 'gk', x: 50, y: 93 },
        { id: 'rb', label: 'ظهير أيمن', short: 'RB', roleGroup: 'def', x: 84, y: 77 },
        { id: 'cb1', label: 'قلب دفاع', short: 'CB', roleGroup: 'def', x: 62, y: 80 },
        { id: 'cb2', label: 'قلب دفاع', short: 'CB', roleGroup: 'def', x: 38, y: 80 },
        { id: 'lb', label: 'ظهير أيسر', short: 'LB', roleGroup: 'def', x: 16, y: 77 },
        { id: 'rm', label: 'جناح أيمن', short: 'RM', roleGroup: 'wing', x: 84, y: 52 },
        { id: 'cm1', label: 'وسط أيمن', short: 'CM', roleGroup: 'mid', x: 60, y: 55 },
        { id: 'cm2', label: 'وسط أيسر', short: 'CM', roleGroup: 'mid', x: 40, y: 55 },
        { id: 'lm', label: 'جناح أيسر', short: 'LM', roleGroup: 'wing', x: 16, y: 52 },
        { id: 'st1', label: 'مهاجم أيمن', short: 'ST', roleGroup: 'fwd', x: 62, y: 24 },
        { id: 'st2', label: 'مهاجم أيسر', short: 'ST', roleGroup: 'fwd', x: 38, y: 24 },
      ],
      oppDefault: [
        { x: 50, y: 8 }, { x: 18, y: 24 }, { x: 39, y: 23 }, { x: 61, y: 23 }, { x: 82, y: 24 },
        { x: 18, y: 46 }, { x: 40, y: 45 }, { x: 60, y: 45 }, { x: 82, y: 46 }, { x: 38, y: 65 }, { x: 62, y: 65 },
      ],
      links: [[0, 2], [0, 3], [1, 2], [2, 3], [3, 4], [1, 5], [4, 8], [5, 6], [6, 7], [7, 8], [6, 9], [7, 10], [9, 10]],
    },
  ],
};

export function getFormationDef(size: PitchSizeId, formationId?: string): FormationDef {
  const list = FORMATIONS_CATALOG[size] || FORMATIONS_CATALOG['6v6'];
  if (!formationId) return list[0];
  return list.find((f) => f.id === formationId) || list[0];
}

function clampCoord(v: number, min = 8, max = 94): number {
  return Math.max(min, Math.min(max, Math.round(v * 10) / 10));
}

/**
 * Generates a rich 4–5 step sequential keyframe animation for ANY formation across 4 phases:
 * 1) attack (كيف نهاجم معاً)
 * 2) defend (كيف نرجع وندافع معاً)
 * 3) counter (التحول السريع - مرتدة لنا)
 * 4) gegenpress (الضغط العكسي - 5 ثوانٍ)
 */
export function getFormationPhaseSequence(
  size: PitchSizeId,
  formationId: string,
  phase: TacticalPhaseId
): TacticalSequence {
  const form = getFormationDef(size, formationId);
  const base = form.slots.map((s) => ({ x: s.x, y: s.y }));
  const opp = form.oppDefault.map((o) => ({ x: o.x, y: o.y }));
  const n = base.length;
  const gkIdx = 0;
  const defIdx = Math.min(1, n - 1);
  const def2Idx = form.slots.findIndex((s, i) => i > 1 && s.roleGroup === 'def') !== -1
    ? form.slots.findIndex((s, i) => i > 1 && s.roleGroup === 'def')
    : Math.min(2, n - 1);
  const midIdx = form.slots.findIndex((s) => s.roleGroup === 'mid' || s.roleGroup === 'wing');
  const creatorIdx = midIdx !== -1 ? midIdx : Math.min(3, n - 1);
  const wingIdx = form.slots.findIndex((s, i) => i !== creatorIdx && (s.roleGroup === 'wing' || s.roleGroup === 'mid'));
  const supportIdx = wingIdx !== -1 ? wingIdx : Math.min(n - 2, creatorIdx);
  const fwdIdx = n - 1;
  const offside = PITCH_SIZE_META[size].offside;

  if (phase === 'attack') {
    const f1Our = base.map((p, i) =>
      i === defIdx ? { x: clampCoord(p.x + 8), y: clampCoord(p.y + 4) }
        : i === def2Idx ? { x: clampCoord(p.x - 8), y: clampCoord(p.y + 3) }
        : { ...p }
    );
    const f2Our = f1Our.map((p, i) =>
      i === creatorIdx ? { x: clampCoord(50), y: clampCoord(p.y + 7) }
        : i === supportIdx ? { x: clampCoord(p.x < 50 ? 15 : 85), y: clampCoord(p.y - 10) }
        : i === defIdx ? { x: clampCoord(p.x + 3), y: clampCoord(p.y - 8) }
        : { ...p }
    );
    const f3Our = f2Our.map((p, i) =>
      i === fwdIdx ? { x: clampCoord(p.x > 50 ? 58 : 42), y: clampCoord(offside ? 24 : 18) }
        : i === supportIdx ? { x: clampCoord(p.x < 50 ? 20 : 80), y: clampCoord(28) }
        : i === creatorIdx ? { x: clampCoord(52), y: clampCoord(43) }
        : i === defIdx ? { x: clampCoord(p.x), y: clampCoord(58) }
        : { ...p }
    );
    const f4Our = f3Our.map((p, i) =>
      i === fwdIdx ? { x: clampCoord(50), y: clampCoord(15) }
        : i === supportIdx ? { x: clampCoord(p.x < 50 ? 30 : 70), y: clampCoord(24) }
        : i === def2Idx ? { x: clampCoord(46), y: clampCoord(64) }
        : { ...p }
    );
    const f5Our = f4Our.map((p, i) =>
      i === defIdx ? { x: clampCoord(62), y: clampCoord(62) }
        : i === def2Idx ? { x: clampCoord(38), y: clampCoord(64) }
        : { ...p }
    );

    const oppShift = (dy: number) => opp.map((o, i) => (i === 0 ? o : { x: o.x, y: clampCoord(o.y + dy, 12, 74) }));

    return {
      id: `${size}_${form.id}_attack`,
      title: `خطة ${form.name} — كيف نهاجم معاً`,
      subtitle: offside ? 'هجوم منظّم مع احترام خط التسلل' : 'توسيع الملعب وصناعة مثلثات واستغلال العمق بدون تسلل',
      size,
      offsideEnabled: offside,
      frames: [
        {
          title: 'المرحلة 1: بداية البناء وفتح زوايا التمرير',
          narration: `يبدأ الحارس البناء الهادئ بينما يتوسّع ${form.slots[defIdx].label} لفتح زاوية تمرير آمنة بعيداً عن ضغط الخصم.`,
          durationMs: 2600,
          ourPos: f1Our,
          oppPos: oppShift(2),
          ball: { x: f1Our[defIdx].x, y: f1Our[defIdx].y - 3 },
          activeIndices: [gkIdx, defIdx],
          arrows: [
            { from: [f1Our[gkIdx].x, f1Our[gkIdx].y], to: [f1Our[defIdx].x, f1Our[defIdx].y], kind: 'ball' },
            { from: [base[defIdx].x, base[defIdx].y], to: [f1Our[defIdx].x, f1Our[defIdx].y], kind: 'run' },
          ],
          zones: [{ x: f1Our[defIdx].x, y: f1Our[defIdx].y, r: 10, label: 'زاوية آمنة', color: 'gold' }],
        },
        {
          title: 'المرحلة 2: هبوط صانع اللعب وتشكيل المثلث',
          narration: `يهبط ${form.slots[creatorIdx].label} لاستلام الكرة بين الخطوط، ويتوسّع الطرف لسحب المدافعين وتشكيل مثلث تمرير ذهبي.`,
          durationMs: 2800,
          ourPos: f2Our,
          oppPos: oppShift(5),
          ball: { x: f2Our[creatorIdx].x, y: f2Our[creatorIdx].y - 2 },
          activeIndices: [defIdx, creatorIdx, supportIdx],
          arrows: [
            { from: [f1Our[defIdx].x, f1Our[defIdx].y], to: [f2Our[creatorIdx].x, f2Our[creatorIdx].y], kind: 'ball' },
            { from: [f1Our[supportIdx].x, f1Our[supportIdx].y], to: [f2Our[supportIdx].x, f2Our[supportIdx].y], kind: 'run' },
          ],
          triangles: [[defIdx, creatorIdx, supportIdx]],
          zones: [{ x: 50, y: 36, r: 12, label: 'مساحة خلف الوسط', color: 'cyan' }],
        },
        {
          title: 'المرحلة 3: اختراق المهاجم للعمق وسحب الدفاع',
          narration: offside
            ? `ينطلق ${form.slots[fwdIdx].label} على خط واحد مع آخر مدافع لتفادي التسلل بينما يتقدم المساند على الطرف.`
            : `يستغل ${form.slots[fwdIdx].label} غياب التسلل ويقطع مباشرة خلف ظهر الدفاع لفتح ممر التمريرة القاتلة.`,
          durationMs: 2800,
          ourPos: f3Our,
          oppPos: oppShift(-4),
          ball: { x: f3Our[supportIdx].x, y: f3Our[supportIdx].y },
          activeIndices: [creatorIdx, supportIdx, fwdIdx],
          arrows: [
            { from: [f2Our[creatorIdx].x, f2Our[creatorIdx].y], to: [f3Our[supportIdx].x, f3Our[supportIdx].y], kind: 'ball' },
            { from: [f2Our[fwdIdx].x, f2Our[fwdIdx].y], to: [f3Our[fwdIdx].x, f3Our[fwdIdx].y], kind: 'run' },
          ],
          zones: [{ x: f3Our[fwdIdx].x, y: f3Our[fwdIdx].y, r: 11, label: 'عمق الهجوم', color: 'gold' }],
        },
        {
          title: 'المرحلة 4: التمريرة الحاسمة والإنهاء داخل الصندوق',
          narration: `تمريرة عرضية أرضية سريعة للمهاجم في مواجهة المرمى لإنهاء الهجمة من لمسة واحدة قبل عودة التغطية.`,
          durationMs: 2700,
          ourPos: f4Our,
          oppPos: oppShift(-7),
          ball: { x: 50, y: 12 },
          activeIndices: [supportIdx, fwdIdx],
          arrows: [
            { from: [f3Our[supportIdx].x, f3Our[supportIdx].y], to: [f4Our[fwdIdx].x, f4Our[fwdIdx].y], kind: 'ball' },
            { from: [f4Our[fwdIdx].x, f4Our[fwdIdx].y], to: [50, 9], kind: 'ball' },
          ],
          zones: [{ x: 50, y: 15, r: 12, label: 'منطقة الحسم', color: 'emerald' }],
        },
        {
          title: 'المرحلة 5: تأمين الخلف والتغطية الوقائية',
          narration: `أثناء الإنهاء يبقى ثنائي الخلف متمركزاً بالعمق لإيقاف أي مرتدة فورية في حال ارتداد الكرة.`,
          durationMs: 2500,
          ourPos: f5Our,
          oppPos: oppShift(-5),
          ball: { x: 50, y: 10 },
          activeIndices: [defIdx, def2Idx],
          arrows: [
            { from: [f4Our[defIdx].x, f4Our[defIdx].y], to: [f5Our[defIdx].x, f5Our[defIdx].y], kind: 'cover' },
            { from: [f4Our[def2Idx].x, f4Our[def2Idx].y], to: [f5Our[def2Idx].x, f5Our[def2Idx].y], kind: 'cover' },
          ],
          zones: [{ x: 50, y: 63, r: 14, label: 'تأمين المرتدة', color: 'gold' }],
        },
      ],
    };
  }

  if (phase === 'defend') {
    const f1Our = base.map((p, i) => (i === 0 ? p : { x: p.x, y: clampCoord(p.y + 8, 22, 85) }));
    const f2Our = base.map((p, i) =>
      i === 0 ? p : { x: clampCoord(50 + (p.x - 50) * 0.62), y: clampCoord(p.y + 13, 36, 84) }
    );
    const f3Our = f2Our.map((p, i) =>
      i === creatorIdx ? { x: clampCoord(64), y: clampCoord(p.y - 6) }
        : i === defIdx ? { x: clampCoord(62), y: clampCoord(73) }
        : i === def2Idx ? { x: clampCoord(45), y: clampCoord(77) }
        : { ...p }
    );
    const f4Our = f3Our.map((p, i) =>
      i === def2Idx ? { x: clampCoord(48), y: clampCoord(74) }
        : i === supportIdx ? { x: clampCoord(40), y: clampCoord(63) }
        : { ...p }
    );

    const oppAtk = opp.map((o, i) => (i === 0 ? o : { x: o.x, y: clampCoord(o.y + 20, 18, 76) }));
    return {
      id: `${size}_${form.id}_defend`,
      title: `خطة ${form.name} — كيف نرجع وندافع معاً`,
      subtitle: 'انكماش الخطوط، غلق العمق، وتقسيم أدوار الضغط والتغطية',
      size,
      offsideEnabled: offside,
      frames: [
        {
          title: 'المرحلة 1: الارتداد الجماعي الفوري للخلف',
          narration: 'فور فقدان الاستحواذ، يعود جميع اللاعبين خلف خط الكرة خلال 3 ثوانٍ لإغلاق المساحات الخلفية.',
          durationMs: 2500,
          ourPos: f1Our,
          oppPos: oppAtk,
          ball: { x: 50, y: 46 },
          activeIndices: [creatorIdx, supportIdx, fwdIdx],
          arrows: [
            { from: [base[fwdIdx].x, base[fwdIdx].y], to: [f1Our[fwdIdx].x, f1Our[fwdIdx].y], kind: 'cover' },
            { from: [base[creatorIdx].x, base[creatorIdx].y], to: [f1Our[creatorIdx].x, f1Our[creatorIdx].y], kind: 'cover' },
          ],
        },
        {
          title: 'المرحلة 2: انكماش الخطوط وتضييق العمق',
          narration: 'يتقارب الدفاع والوسط نحو القلب لمنع أي تمريرة عمودية خطيرة، وندفع الخصم نحو الخط الجانبي.',
          durationMs: 2700,
          ourPos: f2Our,
          oppPos: oppAtk.map((o, i) => (i === oppAtk.length - 1 ? { x: 74, y: 54 } : o)),
          ball: { x: 74, y: 54 },
          activeIndices: [defIdx, def2Idx, creatorIdx],
          arrows: [
            { from: [f1Our[defIdx].x, f1Our[defIdx].y], to: [f2Our[defIdx].x, f2Our[defIdx].y], kind: 'cover' },
            { from: [f1Our[def2Idx].x, f1Our[def2Idx].y], to: [f2Our[def2Idx].x, f2Our[def2Idx].y], kind: 'cover' },
          ],
          zones: [{ x: 50, y: 69, r: 16, label: 'عمق مُغلق', color: 'rose' }],
        },
        {
          title: 'المرحلة 3: لاعب يضغط والآخر يغطي ظهره',
          narration: 'يخرج أقرب لاعب للضغط على حامل الكرة وإجباره على التوقف، بينما يغطي زميله الخلفي زاوية الاختراق.',
          durationMs: 2700,
          ourPos: f3Our,
          oppPos: oppAtk.map((o, i) => (i === oppAtk.length - 1 ? { x: 74, y: 58 } : o)),
          ball: { x: 72, y: 59 },
          activeIndices: [creatorIdx, defIdx],
          arrows: [
            { from: [f2Our[creatorIdx].x, f2Our[creatorIdx].y], to: [f3Our[creatorIdx].x, f3Our[creatorIdx].y], kind: 'run' },
            { from: [f2Our[defIdx].x, f2Our[defIdx].y], to: [f3Our[defIdx].x, f3Our[defIdx].y], kind: 'cover' },
          ],
          zones: [{ x: 72, y: 59, r: 10, label: 'فخ الضغط', color: 'gold' }],
        },
        {
          title: 'المرحلة 4: التغطية العكسية وحماية القائم البعيد',
          narration: 'يدخل لاعب الطرف العكسي للعمق لمراقبة المهاجم المتسلل عند القائم البعيد ومنع الكرة العرضية.',
          durationMs: 2600,
          ourPos: f4Our,
          oppPos: oppAtk.map((o, i) => (i === oppAtk.length - 1 ? { x: 70, y: 60 } : o)),
          ball: { x: 52, y: 71 },
          activeIndices: [def2Idx, supportIdx, gkIdx],
          arrows: [
            { from: [f3Our[supportIdx].x, f3Our[supportIdx].y], to: [f4Our[supportIdx].x, f4Our[supportIdx].y], kind: 'cover' },
          ],
          zones: [{ x: 46, y: 74, r: 11, label: 'تغطية عكسية', color: 'emerald' }],
        },
      ],
    };
  }

  if (phase === 'counter') {
    const startOur = base.map((p, i) => (i === 0 ? p : { x: clampCoord(50 + (p.x - 50) * 0.72), y: clampCoord(p.y + 12, 34, 84) }));
    const f2Our = startOur.map((p, i) =>
      i === fwdIdx ? { x: 54, y: 22 }
        : i === supportIdx ? { x: 80, y: 38 }
        : i === creatorIdx ? { x: 46, y: 52 }
        : { ...p }
    );
    const f3Our = f2Our.map((p, i) =>
      i === fwdIdx ? { x: 44, y: 16 }
        : i === supportIdx ? { x: 74, y: 20 }
        : i === creatorIdx ? { x: 50, y: 36 }
        : { ...p }
    );
    const oppHigh = opp.map((o, i) => (i === 0 ? o : { x: o.x, y: clampCoord(o.y + 24, 16, 78) }));
    return {
      id: `${size}_${form.id}_counter`,
      title: `خطة ${form.name} — التحول السريع (مرتدة بـ 3 لمسات)`,
      subtitle: 'افتكاك الكرة والانطلاق المباشر خلف دفاع الخصم المتقدم',
      size,
      offsideEnabled: offside,
      frames: [
        {
          title: 'المرحلة 1: افتكاك الكرة واللمسة الأولى للأمام',
          narration: 'يقطع المدافع الكرة ويبحث فوراً في أول ثانية عن التمريرة العمودية السريعة دون إبطاء.',
          durationMs: 2400,
          ourPos: startOur,
          oppPos: oppHigh,
          ball: { x: startOur[defIdx].x, y: startOur[defIdx].y - 3 },
          activeIndices: [defIdx, creatorIdx],
          arrows: [
            { from: [startOur[defIdx].x, startOur[defIdx].y], to: [startOur[creatorIdx].x, startOur[creatorIdx].y], kind: 'ball' },
          ],
          zones: [{ x: 54, y: 26, r: 15, label: 'مساحة شاسعة!', color: 'gold' }],
        },
        {
          title: 'المرحلة 2: انطلاق المهاجم والجناح بأقصى سرعة',
          narration: 'ينطلق المهاجم بالعمق ويسانده الجناح على الطرف لخلق تفوق عددي 2 ضد 1 قبل رجوع الخصم.',
          durationMs: 2600,
          ourPos: f2Our,
          oppPos: oppHigh.map((o, i) => (i === 0 ? o : { x: o.x, y: clampCoord(o.y - 6, 14, 72) })),
          ball: { x: f2Our[supportIdx].x, y: f2Our[supportIdx].y },
          activeIndices: [creatorIdx, supportIdx, fwdIdx],
          arrows: [
            { from: [f2Our[creatorIdx].x, f2Our[creatorIdx].y], to: [f2Our[supportIdx].x, f2Our[supportIdx].y], kind: 'ball' },
            { from: [startOur[fwdIdx].x, startOur[fwdIdx].y], to: [f2Our[fwdIdx].x, f2Our[fwdIdx].y], kind: 'run' },
          ],
        },
        {
          title: 'المرحلة 3: التمريرة القاتلة وإنهاء المرتدة',
          narration: 'في اللمسة الثالثة، يمرر المساند كرة سريعة للمهاجم الحر أمام الحارس ليحسم الهجمة المرتدة بنجاح!',
          durationMs: 2600,
          ourPos: f3Our,
          oppPos: oppHigh.map((o, i) => (i === 0 ? o : { x: o.x, y: clampCoord(o.y - 14, 14, 64) })),
          ball: { x: 46, y: 11 },
          activeIndices: [supportIdx, fwdIdx],
          arrows: [
            { from: [f3Our[supportIdx].x, f3Our[supportIdx].y], to: [f3Our[fwdIdx].x, f3Our[fwdIdx].y], kind: 'ball' },
            { from: [f3Our[fwdIdx].x, f3Our[fwdIdx].y], to: [50, 9], kind: 'ball' },
          ],
          zones: [{ x: 46, y: 16, r: 11, label: 'هدف مرتدة!', color: 'emerald' }],
        },
      ],
    };
  }

  // gegenpress (الضغط العكسي)
  const highOur = base.map((p, i) => (i === 0 ? p : { x: p.x, y: clampCoord(p.y - 12, 18, 74) }));
  const pressOur = highOur.map((p, i) =>
    i === fwdIdx ? { x: 42, y: 27 }
      : i === supportIdx ? { x: 60, y: 31 }
      : i === creatorIdx ? { x: 50, y: 42 }
      : { ...p }
  );
  const recoverOur = pressOur.map((p, i) =>
    i === creatorIdx ? { x: 52, y: 34 } : { ...p }
  );
  return {
    id: `${size}_${form.id}_gegenpress`,
    title: `خطة ${form.name} — الضغط العكسي (قاعدة الـ 5 ثوانٍ)`,
    subtitle: 'استعادة الكرة فوراً بعد فقدانها عبر حصار زوايا التمرير',
    size,
    offsideEnabled: offside,
    frames: [
      {
        title: 'المرحلة 1: لحظة خسارة الكرة في نصف الخصم',
        narration: 'فقدنا الكرة للتو! لا نقف متفرجين — يبدأ عدّاد الـ 5 ثوانٍ للضغط العكسي الفوري قبل تنظيم الخصم.',
        durationMs: 2300,
        ourPos: highOur,
        oppPos: opp,
        ball: { x: 48, y: 29 },
        activeIndices: [fwdIdx, supportIdx],
        zones: [{ x: 48, y: 29, r: 12, label: 'منطقة الفقدان', color: 'rose' }],
        arrows: [],
      },
      {
        title: 'المرحلة 2: كماشة ثنائية وغلق زاوية العمق',
        narration: 'ينقض أقرب لاعبين على حامل الكرة من جهتين، بينما يغلق لاعب الوسط ممر التمرير الأمامي.',
        durationMs: 2600,
        ourPos: pressOur,
        oppPos: opp,
        ball: { x: 50, y: 29 },
        activeIndices: [fwdIdx, supportIdx, creatorIdx],
        arrows: [
          { from: [highOur[fwdIdx].x, highOur[fwdIdx].y], to: [pressOur[fwdIdx].x, pressOur[fwdIdx].y], kind: 'run' },
          { from: [highOur[supportIdx].x, highOur[supportIdx].y], to: [pressOur[supportIdx].x, pressOur[supportIdx].y], kind: 'run' },
          { from: [highOur[creatorIdx].x, highOur[creatorIdx].y], to: [pressOur[creatorIdx].x, pressOur[creatorIdx].y], kind: 'cover' },
        ],
        triangles: [[fwdIdx, supportIdx, creatorIdx]],
        zones: [{ x: 50, y: 30, r: 13, label: 'حصار 5 ثوانٍ', color: 'gold' }],
      },
      {
        title: 'المرحلة 3: قطع التمريرة المستعجلة والهجوم الفوري',
        narration: 'يضطر الخصم لتمريرة خاطئة تحت الضغط، فيقطعها لاعب الوسط ويصبح الفريق أمام المرمى مباشرة!',
        durationMs: 2600,
        ourPos: recoverOur,
        oppPos: opp,
        ball: { x: 52, y: 33 },
        activeIndices: [creatorIdx, fwdIdx],
        arrows: [
          { from: [50, 29], to: [52, 34], kind: 'ball' },
          { from: [52, 34], to: [42, 23], kind: 'ball' },
        ],
        zones: [{ x: 52, y: 34, r: 10, label: 'استعادة الكرة!', color: 'emerald' }],
      },
    ],
  };
}

/**
 * Role Spotlight Animated: Clicking ANY slot illuminates its heat zone,
 * animates ball/off-ball/defensive/passing options, and returns Arabic duties.
 */
export function getRoleSpotlightSequence(
  size: PitchSizeId,
  formationId: string,
  slotIndex: number
): RoleSpotlightInfo {
  const form = getFormationDef(size, formationId);
  const idx = Math.max(0, Math.min(form.slots.length - 1, slotIndex));
  const slot = form.slots[idx];
  const base = form.slots.map((s) => ({ x: s.x, y: s.y }));
  const opp = form.oppDefault.map((o) => ({ x: o.x, y: o.y }));

  // Find 3 closest teammates for passing options
  const nearest3 = form.slots
    .map((s, i) => ({
      i,
      s,
      dist: Math.hypot(s.x - slot.x, s.y - slot.y),
    }))
    .filter((item) => item.i !== idx)
    .sort((a, b) => a.dist - b.dist)
    .slice(0, 3);

  const dutiesMap: Record<RoleGroup, { off: string[]; def: string[]; rule: string; rx: number; ry: number }> = {
    gk: {
      off: ['بدء الهجمة بتمريرة أرضية هادئة أو رمية طويلة خلف الدفاع', 'التقدّم خارج الصندوق كخيار تمرير إضافي لفك الضغط'],
      def: ['تضييق الزاوية مبكراً في الانفرادات', 'توجيه خط الدفاع بصوت واضح ومراقبة القائم القريب'],
      rule: 'في 6v6 بدون تسلل: رميتك السريعة باليد تصنع هدفاً في 3 ثوانٍ!',
      rx: 28,
      ry: 14,
    },
    def: {
      off: ['فتح عرض الملعب لخلق زاوية تمرير للحارس', 'التقدّم لمساندة الوسط عند ضمان تغطية زميلك الخلفي'],
      def: ['ملازمة مهاجم الخصم الثابت بدون اندفاع عشوائي', 'قطع زوايا التمرير العمودية والتغطية العكسية'],
      rule: 'توازنك هو صمّام الأمان: إذا تقدّم مدافع يبقى الآخر لحماية الظهر.',
      rx: 24,
      ry: 18,
    },
    mid: {
      off: ['الهبوط بين خطوط الخصم لربط الدفاع بالهجوم', 'صناعة مثلثات التمرير وتغيير جهة اللعب بلمسة واحدة'],
      def: ['إغلاق عمق الملعب والضغط العكسي فور فقدان الكرة', 'العودة السريعة لمساندة الدفاع عند الهجمة المرتدة'],
      rule: 'ارفع رأسك قبل استلام الكرة — قرارك السريع هو ما يكسر تكتل الخصم.',
      rx: 30,
      ry: 24,
    },
    wing: {
      off: ['توسيع الملعب لسحب المدافعين ثم القطع للداخل', 'المراوغة في مواقف 1 ضد 1 وتمرير الكرات العرضية الأرضية'],
      def: ['الضغط على ظهير الخصم ومنع بناء اللعب من الطرف', 'الدخول للعمق لتغطية القائم البعيد عند هجوم الخصم من الجهة الأخرى'],
      rule: 'لا تقف على الخط طوال الوقت — تبادل العمق والطرف يربك أي دفاع.',
      rx: 20,
      ry: 28,
    },
    fwd: {
      off: ['استغلال غياب التسلل بالتمركز خلف آخر مدافع وسحب الرقابة', 'إنهاء الفرص بلمسة واحدة واللعب كمحطة لتمرير الكرة للقادمين من الخلف'],
      def: ['بدء الضغط الأول وتوجيه بناء الخصم نحو الأطراف', 'إغلاق زاوية التمرير إلى قلب وسط الخصم'],
      rule: 'تحرّكك الذكي قبل التمريرة هو نصف الهدف — اطلب الكرة في المساحة الفارغة!',
      rx: 28,
      ry: 18,
    },
  };

  const info = dutiesMap[slot.roleGroup];
  const withBallPos = base.map((p, i) =>
    i === idx ? { x: clampCoord(p.x + (p.x > 50 ? -8 : 8)), y: clampCoord(p.y - 10, 14, 88) } : p
  );
  const offBallPos = base.map((p, i) =>
    i === idx ? { x: clampCoord(p.x + (p.x > 50 ? 9 : -9)), y: clampCoord(p.y - 16, 14, 86) } : p
  );
  const defPos = base.map((p, i) =>
    i === idx ? { x: clampCoord(50 + (p.x - 50) * 0.65), y: clampCoord(p.y + 12, 24, 92) } : p
  );

  return {
    roleGroup: slot.roleGroup,
    slotLabel: slot.label,
    slotShort: slot.short,
    offenseDuties: info.off,
    defenseDuties: info.def,
    goldenRule: info.rule,
    zone: { x: slot.x, y: clampCoord(slot.y - 4, 15, 88), rx: info.rx, ry: info.ry },
    sequence: {
      id: `spotlight_${size}_${form.id}_${idx}`,
      title: `تسليط الضوء: ${slot.label} (${slot.short})`,
      subtitle: info.rule,
      size,
      offsideEnabled: PITCH_SIZE_META[size].offside,
      frames: [
        {
          title: `1. التحرك بالكرة — ${slot.label}`,
          narration: `عند استلام الكرة في مركز ${slot.label}، ادخل نحو المساحة المفتوحة لسحب المدافع وفتح خيارات التمرير.`,
          durationMs: 2600,
          ourPos: withBallPos,
          oppPos: opp,
          ball: { x: withBallPos[idx].x, y: withBallPos[idx].y - 2 },
          activeIndices: [idx],
          arrows: [
            { from: [slot.x, slot.y], to: [withBallPos[idx].x, withBallPos[idx].y], kind: 'ball' },
          ],
          zones: [{ x: withBallPos[idx].x, y: withBallPos[idx].y, r: 13, label: 'منطقة التأثير', color: 'gold' }],
        },
        {
          title: `2. الركض بدون كرة — ${slot.label}`,
          narration: `بدون كرة، يتحرك ${slot.label} في الممر الفارغ ليكسر الرقابة ويمنح زميله زاوية تمرير سهلة.`,
          durationMs: 2600,
          ourPos: offBallPos,
          oppPos: opp,
          ball: { x: base[nearest3[0]?.i ?? 0].x, y: base[nearest3[0]?.i ?? 0].y },
          activeIndices: [idx],
          arrows: [
            { from: [slot.x, slot.y], to: [offBallPos[idx].x, offBallPos[idx].y], kind: 'run' },
          ],
          zones: [{ x: offBallPos[idx].x, y: offBallPos[idx].y, r: 12, label: 'مساحة الانطلاق', color: 'cyan' }],
        },
        {
          title: `3. التمركز الدفاعي — ${slot.label}`,
          narration: `عند فقدان الكرة، يتراجع ${slot.label} نحو القلب لتضييق المساحات وحماية العمق مع بقية الفريق.`,
          durationMs: 2600,
          ourPos: defPos,
          oppPos: opp.map((o, i) => (i === 0 ? o : { x: o.x, y: clampCoord(o.y + 12, 14, 78) })),
          ball: { x: 50, y: 48 },
          activeIndices: [idx],
          arrows: [
            { from: [slot.x, slot.y], to: [defPos[idx].x, defPos[idx].y], kind: 'cover' },
          ],
          zones: [{ x: defPos[idx].x, y: defPos[idx].y, r: 12, label: 'نقطة التغطية', color: 'rose' }],
        },
        {
          title: `4. أقرب 3 خيارات تمرير لـ ${slot.label}`,
          narration: `أقرب 3 خيارات تمرير آمنة هي: ${nearest3.map((n) => n.s.label).join('، ')}. استخدمها للعب السريع من لمسة واحدة!`,
          durationMs: 2800,
          ourPos: base,
          oppPos: opp,
          ball: { x: slot.x, y: slot.y - 2 },
          activeIndices: [idx, ...nearest3.map((n) => n.i)],
          arrows: nearest3.map((n) => ({
            from: [slot.x, slot.y] as [number, number],
            to: [n.s.x, n.s.y] as [number, number],
            kind: 'ball' as const,
          })),
        },
      ],
    },
  };
}

/**
 * 10 Full Step-by-Step Animated 6v6 Tactical Scenarios
 */
export const TACTICAL_SCENARIOS_10: ScenarioDef[] = [
  {
    id: 'build_up_gk',
    index: 1,
    icon: '🧤',
    title: 'البناء من الخلف (مع الحارس)',
    category: 'هجومي',
    summary: 'كسر ضغط الخصم العالي باستخدام الحارس كاللاعب السادس',
    frames: [
      {
        title: '1. توسّع المدافعين لفتح زاوية للحارس',
        narration: 'يفتح المدافعان عرض الملعب قريباً من الخط الجانبي لإجبار مهاجمي الخصم على التباعد وترك العمق مفتوحاً.',
        durationMs: 2600,
        ourPos: [{ x: 50, y: 90 }, { x: 82, y: 76 }, { x: 18, y: 76 }, { x: 74, y: 50 }, { x: 26, y: 50 }, { x: 50, y: 26 }],
        oppPos: [{ x: 50, y: 11 }, { x: 35, y: 30 }, { x: 65, y: 30 }, { x: 30, y: 54 }, { x: 70, y: 54 }, { x: 50, y: 70 }],
        ball: { x: 50, y: 87 },
        activeIndices: [0, 1, 2],
        arrows: [
          { from: [50, 90], to: [82, 76], kind: 'ball' },
          { from: [65, 76], to: [82, 76], kind: 'run' },
          { from: [35, 76], to: [18, 76], kind: 'run' },
        ],
        zones: [{ x: 50, y: 60, r: 12, label: 'عمق مفتوح', color: 'cyan' }],
      },
      {
        title: '2. تمريرة للظهير وهبوط صانع اللعب',
        narration: 'يمرر الحارس للمدافع الأيمن، ويهبط لاعب الوسط الأيسر للعمق لاستلام الكرة في ظهر ضغط الخصم.',
        durationMs: 2600,
        ourPos: [{ x: 56, y: 86 }, { x: 82, y: 74 }, { x: 22, y: 76 }, { x: 80, y: 44 }, { x: 48, y: 58 }, { x: 50, y: 24 }],
        oppPos: [{ x: 50, y: 11 }, { x: 35, y: 30 }, { x: 65, y: 30 }, { x: 40, y: 54 }, { x: 76, y: 64 }, { x: 64, y: 72 }],
        ball: { x: 80, y: 73 },
        activeIndices: [1, 4],
        arrows: [
          { from: [82, 74], to: [48, 58], kind: 'ball' },
          { from: [26, 50], to: [48, 58], kind: 'run' },
        ],
        triangles: [[0, 1, 4]],
      },
      {
        title: '3. كسر الخط الأول والانطلاق للطرف الحر',
        narration: 'يستدير صانع اللعب بالكرة في القلب ويمرر للجناح الأيمن المنطلق في المساحة الفارغة.',
        durationMs: 2600,
        ourPos: [{ x: 52, y: 84 }, { x: 74, y: 68 }, { x: 30, y: 70 }, { x: 82, y: 34 }, { x: 50, y: 52 }, { x: 46, y: 20 }],
        oppPos: [{ x: 50, y: 11 }, { x: 36, y: 26 }, { x: 64, y: 26 }, { x: 44, y: 48 }, { x: 70, y: 56 }, { x: 56, y: 64 }],
        ball: { x: 80, y: 35 },
        activeIndices: [4, 3, 5],
        arrows: [
          { from: [48, 56], to: [82, 34], kind: 'ball' },
          { from: [50, 24], to: [46, 20], kind: 'run' },
        ],
        zones: [{ x: 82, y: 34, r: 11, label: 'كسر الضغط ✓', color: 'emerald' }],
      },
    ],
  },
  {
    id: 'break_low_block',
    index: 2,
    icon: '🔓',
    title: 'الهجوم المنظم وكسر الدفاع المتكتل',
    category: 'هجومي',
    summary: 'تدوير سريع من طرف لطرف مع جملة «خذ وهات» لكسر التكتل',
    frames: [
      {
        title: '1. جذب الدفاع المتكتل نحو الجهة اليمنى',
        narration: 'ننقل الكرة للجهة اليمنى لنجبر دفاع الخصم المتكتل على الميل بالكامل نحو الكرة وترك الجهة اليسرى خالية.',
        durationMs: 2600,
        ourPos: [{ x: 50, y: 88 }, { x: 68, y: 60 }, { x: 32, y: 62 }, { x: 84, y: 38 }, { x: 22, y: 36 }, { x: 54, y: 24 }],
        oppPos: [{ x: 50, y: 11 }, { x: 44, y: 24 }, { x: 64, y: 25 }, { x: 56, y: 36 }, { x: 74, y: 36 }, { x: 60, y: 46 }],
        ball: { x: 82, y: 39 },
        activeIndices: [3, 1],
        arrows: [{ from: [68, 60], to: [84, 38], kind: 'ball' }],
        zones: [{ x: 22, y: 32, r: 14, label: 'جهة عكسية فارغة', color: 'gold' }],
      },
      {
        title: '2. تحويل اللعب السريع بلمستين للجهة العكسية',
        narration: 'يعود الجناح بالكرة للمدافع الذي يحولها مباشرة بلمسة واحدة للجناح الأيسر الحر تماماً.',
        durationMs: 2700,
        ourPos: [{ x: 50, y: 88 }, { x: 62, y: 58 }, { x: 38, y: 56 }, { x: 78, y: 34 }, { x: 18, y: 30 }, { x: 52, y: 20 }],
        oppPos: [{ x: 50, y: 11 }, { x: 42, y: 24 }, { x: 60, y: 25 }, { x: 48, y: 36 }, { x: 68, y: 36 }, { x: 54, y: 46 }],
        ball: { x: 20, y: 31 },
        activeIndices: [1, 2, 4],
        arrows: [
          { from: [80, 38], to: [38, 56], kind: 'ball' },
          { from: [38, 56], to: [18, 30], kind: 'ball' },
        ],
      },
      {
        title: '3. «خذ وهات» مع المهاجم واختراق الصندوق',
        narration: 'يمرر الجناح الأيسر للمهاجم المحطة ثم يخترق للعمق ليستلم الكرة المرتدة ويسدد في الزاوية البعيدة.',
        durationMs: 2700,
        ourPos: [{ x: 50, y: 86 }, { x: 60, y: 58 }, { x: 38, y: 54 }, { x: 72, y: 26 }, { x: 34, y: 19 }, { x: 50, y: 24 }],
        oppPos: [{ x: 50, y: 11 }, { x: 36, y: 24 }, { x: 56, y: 24 }, { x: 42, y: 35 }, { x: 62, y: 35 }, { x: 48, y: 45 }],
        ball: { x: 48, y: 10 },
        activeIndices: [4, 5],
        arrows: [
          { from: [18, 30], to: [50, 24], kind: 'ball' },
          { from: [18, 30], to: [34, 19], kind: 'run' },
          { from: [50, 24], to: [34, 19], kind: 'ball' },
          { from: [34, 19], to: [50, 9], kind: 'ball' },
        ],
        zones: [{ x: 34, y: 19, r: 10, label: 'كسر التكتل!', color: 'emerald' }],
      },
    ],
  },
  {
    id: 'compact_defense',
    index: 3,
    icon: '🛡️',
    title: 'الدفاع الجماعي المتكتل (الكل ينزل يدافع)',
    category: 'دفاعي',
    summary: 'بناء كتلة دفاعية متماسكة من 5 لاعبين تغلق كل الممرات',
    frames: [
      {
        title: '1. نزول المهاجم لإغلاق محور الخصم',
        narration: 'يعود المهاجم حتى دائرة المنتصف ليمنع الخصم من التمرير المريح للعمق ويبدأ التضييق الجماعي.',
        durationMs: 2500,
        ourPos: [{ x: 50, y: 90 }, { x: 64, y: 76 }, { x: 36, y: 76 }, { x: 68, y: 62 }, { x: 32, y: 62 }, { x: 50, y: 50 }],
        oppPos: [{ x: 50, y: 11 }, { x: 34, y: 36 }, { x: 66, y: 36 }, { x: 24, y: 52 }, { x: 76, y: 52 }, { x: 50, y: 62 }],
        ball: { x: 50, y: 40 },
        activeIndices: [1, 2, 3, 4, 5],
        arrows: [
          { from: [50, 34], to: [50, 50], kind: 'cover' },
          { from: [74, 50], to: [68, 62], kind: 'cover' },
          { from: [26, 50], to: [32, 62], kind: 'cover' },
        ],
        zones: [{ x: 50, y: 68, r: 18, label: 'كتلة دفاعية محكمة', color: 'rose' }],
      },
      {
        title: '2. ترحيل جماعي نحو الكرة بدون فجوات',
        narration: 'عند انتقال الكرة للطرف الأيمن، يتحرك الفريق بالكامل 10 خطوات نحوها ككتلة واحدة مع إبقاء المسافة قريبة.',
        durationMs: 2600,
        ourPos: [{ x: 54, y: 90 }, { x: 72, y: 75 }, { x: 46, y: 77 }, { x: 76, y: 60 }, { x: 46, y: 63 }, { x: 60, y: 52 }],
        oppPos: [{ x: 50, y: 11 }, { x: 36, y: 38 }, { x: 70, y: 40 }, { x: 28, y: 54 }, { x: 82, y: 56 }, { x: 56, y: 66 }],
        ball: { x: 81, y: 56 },
        activeIndices: [1, 3, 2, 4],
        arrows: [
          { from: [68, 62], to: [76, 60], kind: 'cover' },
          { from: [36, 76], to: [46, 77], kind: 'cover' },
        ],
      },
      {
        title: '3. إجبار الخصم على التراجع أو التسديد البعيد',
        narration: 'بسبب انعدام المساحات في القلب، يفقد الخصم الحلول وتُقطع الكرة لبدء هجمتنا المنظمة.',
        durationMs: 2500,
        ourPos: [{ x: 52, y: 90 }, { x: 70, y: 74 }, { x: 44, y: 76 }, { x: 74, y: 58 }, { x: 44, y: 62 }, { x: 58, y: 50 }],
        oppPos: [{ x: 50, y: 11 }, { x: 36, y: 36 }, { x: 68, y: 38 }, { x: 30, y: 52 }, { x: 80, y: 55 }, { x: 54, y: 64 }],
        ball: { x: 72, y: 62 },
        activeIndices: [3, 1],
        arrows: [{ from: [80, 56], to: [72, 62], kind: 'ball' }],
        zones: [{ x: 72, y: 62, r: 10, label: 'قطع الكرة ✓', color: 'emerald' }],
      },
    ],
  },
  {
    id: 'our_corner',
    index: 4,
    icon: '🚩',
    title: 'ركنيات لنا (جملة تكتيكية جاهزة)',
    category: 'كرات ثابتة',
    summary: 'تمويه القائم القريب + تسديدة القادم من الخلف مع تأمين المرتدة',
    frames: [
      {
        title: '1. توزيع المراكز قبل تنفيذ الركنية',
        narration: 'المنفّذ عند الزاوية، المهاجم عند القائم القريب، المسدد المموّه على قوس المنطقة، ومدافعان لتأمين الخلف.',
        durationMs: 2600,
        ourPos: [{ x: 50, y: 88 }, { x: 50, y: 58 }, { x: 34, y: 48 }, { x: 92, y: 10 }, { x: 52, y: 34 }, { x: 64, y: 20 }],
        oppPos: [{ x: 52, y: 11 }, { x: 62, y: 18 }, { x: 46, y: 18 }, { x: 58, y: 28 }, { x: 38, y: 30 }, { x: 50, y: 46 }],
        ball: { x: 93, y: 9 },
        activeIndices: [3, 5, 4],
        zones: [{ x: 52, y: 24, r: 11, label: 'نقطة التسديد', color: 'gold' }],
        arrows: [],
      },
      {
        title: '2. سحب المدافعين للقائم القريب وتفريغ القوس',
        narration: 'يندفع المهاجم بسرعة نحو القائم القريب ليسحب معه مدافعين، بينما يتسلل لاعب الوسط نحو نقطة الجزاء الحرة!',
        durationMs: 2700,
        ourPos: [{ x: 50, y: 88 }, { x: 50, y: 58 }, { x: 34, y: 48 }, { x: 92, y: 10 }, { x: 54, y: 23 }, { x: 72, y: 14 }],
        oppPos: [{ x: 54, y: 11 }, { x: 68, y: 15 }, { x: 56, y: 17 }, { x: 64, y: 25 }, { x: 40, y: 28 }, { x: 50, y: 46 }],
        ball: { x: 93, y: 9 },
        activeIndices: [5, 4],
        arrows: [
          { from: [64, 20], to: [72, 14], kind: 'run' },
          { from: [52, 34], to: [54, 23], kind: 'run' },
        ],
      },
      {
        title: '3. تمريرة أرضية قوية للقادم من الخلف وتسديدة مباشرة',
        narration: 'يرسل المنفّذ كرة أرضية سريعة للقادم من الخلف على نقطة الجزاء ليسدّد مباشرة قبل تدخل الدفاع!',
        durationMs: 2700,
        ourPos: [{ x: 50, y: 88 }, { x: 50, y: 58 }, { x: 34, y: 48 }, { x: 88, y: 13 }, { x: 54, y: 22 }, { x: 72, y: 14 }],
        oppPos: [{ x: 54, y: 11 }, { x: 68, y: 15 }, { x: 56, y: 17 }, { x: 64, y: 25 }, { x: 42, y: 26 }, { x: 50, y: 46 }],
        ball: { x: 48, y: 9 },
        activeIndices: [3, 4],
        arrows: [
          { from: [92, 10], to: [54, 22], kind: 'ball' },
          { from: [54, 22], to: [48, 9], kind: 'ball' },
        ],
        zones: [{ x: 50, y: 58, r: 10, label: 'تأمين خلفي', color: 'cyan' }],
      },
    ],
  },
  {
    id: 'defend_corner',
    index: 5,
    icon: '🚧',
    title: 'الدفاع ضد ركنيات الخصم (توزيع الرقابة)',
    category: 'كرات ثابتة',
    summary: 'حراسة القائم القريب + رقابة رجل لرجل + لاعب جاهز للمرتدة',
    frames: [
      {
        title: '1. توزيع أدوار الرقابة الصارمة داخل الصندوق',
        narration: 'الحارس يراقب المرمى والكرة العالية، مدافع يقف على القائم القريب، مدافعان برقابة لصيقة، والوسط يغلق قوس التسديد.',
        durationMs: 2700,
        ourPos: [{ x: 48, y: 90 }, { x: 60, y: 86 }, { x: 44, y: 81 }, { x: 56, y: 74 }, { x: 36, y: 72 }, { x: 50, y: 54 }],
        oppPos: [{ x: 50, y: 14 }, { x: 92, y: 91 }, { x: 62, y: 83 }, { x: 44, y: 78 }, { x: 56, y: 70 }, { x: 48, y: 58 }],
        ball: { x: 92, y: 91 },
        activeIndices: [0, 1, 2, 3],
        zones: [{ x: 60, y: 86, r: 9, label: 'القائم القريب', color: 'rose' }],
        arrows: [],
      },
      {
        title: '2. إبعاد الكرة للجانب وليس للعمق!',
        narration: 'يقطع مدافع القائم القريب الكرة ويبعدها نحو الخط الجانبي أو للمهاجم المتمركز عند المنتصف.',
        durationMs: 2600,
        ourPos: [{ x: 48, y: 89 }, { x: 62, y: 84 }, { x: 46, y: 80 }, { x: 58, y: 73 }, { x: 34, y: 68 }, { x: 48, y: 44 }],
        oppPos: [{ x: 50, y: 14 }, { x: 88, y: 88 }, { x: 64, y: 82 }, { x: 46, y: 78 }, { x: 56, y: 70 }, { x: 50, y: 58 }],
        ball: { x: 48, y: 45 },
        activeIndices: [1, 5],
        arrows: [
          { from: [92, 91], to: [62, 84], kind: 'ball' },
          { from: [62, 84], to: [48, 44], kind: 'ball' },
        ],
      },
      {
        title: '3. الخروج الجماعي الفوري لتحويل الركنية لمرتدة',
        narration: 'بمجرد وصول الكرة للمهاجم عند المنتصف ينطلق معه الجناح لاستغلال تقدم كل لاعبي الخصم!',
        durationMs: 2500,
        ourPos: [{ x: 50, y: 86 }, { x: 60, y: 70 }, { x: 42, y: 70 }, { x: 70, y: 46 }, { x: 26, y: 44 }, { x: 48, y: 26 }],
        oppPos: [{ x: 50, y: 14 }, { x: 78, y: 72 }, { x: 60, y: 68 }, { x: 46, y: 64 }, { x: 54, y: 58 }, { x: 50, y: 48 }],
        ball: { x: 48, y: 24 },
        activeIndices: [5, 4, 3],
        arrows: [
          { from: [48, 44], to: [48, 26], kind: 'run' },
          { from: [34, 68], to: [26, 44], kind: 'run' },
        ],
        zones: [{ x: 48, y: 26, r: 12, label: 'مرتدة خاطفة!', color: 'emerald' }],
      },
    ],
  },
  {
    id: 'free_kick_near',
    index: 6,
    icon: '🎯',
    title: 'الضربات الحرة القريبة',
    category: 'كرات ثابتة',
    summary: 'خدعة الجدار بالتمريرة الجانبية القصيرة لفتح زاوية تسديد مفتوحة',
    frames: [
      {
        title: '1. قراءة جدار الخصم وتموضع المموّه',
        narration: 'جدار الخصم يغلق الزاوية القريبة؛ يقف لاعب ثانٍ بجانب الكرة بينما يقف المهاجم على طرف الجدار لحجب الرؤية.',
        durationMs: 2600,
        ourPos: [{ x: 50, y: 88 }, { x: 50, y: 64 }, { x: 30, y: 56 }, { x: 58, y: 34 }, { x: 48, y: 34 }, { x: 62, y: 22 }],
        oppPos: [{ x: 46, y: 11 }, { x: 51, y: 24 }, { x: 56, y: 24 }, { x: 36, y: 24 }, { x: 66, y: 24 }, { x: 44, y: 44 }],
        ball: { x: 52, y: 33 },
        activeIndices: [3, 4],
        zones: [{ x: 36, y: 28, r: 10, label: 'زاوية مفتوحة', color: 'gold' }],
        arrows: [],
      },
      {
        title: '2. التمريرة الجانبية السريعة لكسر زاوية الجدار',
        narration: 'بدلاً من التسديد في الجدار، يمرر المنفّذ لمسة سريعة جانبية لزميله المتقدم نحو المساحة المفتوحة.',
        durationMs: 2600,
        ourPos: [{ x: 50, y: 88 }, { x: 50, y: 64 }, { x: 30, y: 56 }, { x: 58, y: 34 }, { x: 36, y: 28 }, { x: 64, y: 18 }],
        oppPos: [{ x: 46, y: 11 }, { x: 51, y: 24 }, { x: 56, y: 24 }, { x: 38, y: 24 }, { x: 66, y: 24 }, { x: 44, y: 44 }],
        ball: { x: 37, y: 27 },
        activeIndices: [3, 4, 5],
        arrows: [
          { from: [52, 33], to: [36, 28], kind: 'ball' },
          { from: [48, 34], to: [36, 28], kind: 'run' },
          { from: [62, 22], to: [64, 18], kind: 'run' },
        ],
      },
      {
        title: '3. تسديدة مباشرة بالزاوية البعيدة ومتابعة المهاجم',
        narration: 'يسدد الزميل بقوة نحو الزاوية المفتوحة بينما يتابع المهاجم عند القائم البعيد لأي كرة مرتدة من الحارس.',
        durationMs: 2600,
        ourPos: [{ x: 50, y: 88 }, { x: 50, y: 64 }, { x: 32, y: 56 }, { x: 56, y: 32 }, { x: 36, y: 27 }, { x: 60, y: 15 }],
        oppPos: [{ x: 42, y: 11 }, { x: 49, y: 24 }, { x: 55, y: 24 }, { x: 38, y: 24 }, { x: 64, y: 22 }, { x: 44, y: 44 }],
        ball: { x: 56, y: 9 },
        activeIndices: [4, 5],
        arrows: [{ from: [36, 27], to: [56, 9], kind: 'ball' }],
        zones: [{ x: 56, y: 11, r: 9, label: 'الزاوية البعيدة!', color: 'emerald' }],
      },
    ],
  },
  {
    id: 'one_vs_one',
    index: 7,
    icon: '⚔️',
    title: 'موقف 1 ضد 1 (دفاعياً وهجومياً)',
    category: 'مواقف حاسمة',
    summary: 'كيف يدافع اللاعب بدون اندفاع، وكيف يحسم المهاجم بالتمويه',
    frames: [
      {
        title: '1. القاعدة الدفاعية: التوجيه نحو الخط وليس القلب',
        narration: 'دفاعياً: لا تندفع لخطف الكرة! قف بوضعية جانبية وأغلق عمق الملعب لتجبر المهاجم على الذهاب للطرف الأضعف.',
        durationMs: 2700,
        ourPos: [{ x: 50, y: 90 }, { x: 66, y: 66 }, { x: 38, y: 74 }, { x: 72, y: 50 }, { x: 34, y: 54 }, { x: 50, y: 36 }],
        oppPos: [{ x: 50, y: 11 }, { x: 34, y: 28 }, { x: 66, y: 28 }, { x: 28, y: 48 }, { x: 74, y: 58 }, { x: 46, y: 62 }],
        ball: { x: 74, y: 59 },
        activeIndices: [1, 2],
        arrows: [
          { from: [66, 66], to: [72, 62], kind: 'cover' },
          { from: [38, 74], to: [50, 74], kind: 'cover' },
        ],
        zones: [{ x: 60, y: 64, r: 10, label: 'عمق مُغلق', color: 'rose' }],
      },
      {
        title: '2. هجومياً: تمويه الجسد وتغيير الإيقاع المفاجئ',
        narration: 'هجومياً في 1 ضد 1: أبطئ خطوتك أمام المدافع ثم موّه بالكتف نحو الطرف وانطلق بسرعة نحو الداخل.',
        durationMs: 2700,
        ourPos: [{ x: 50, y: 88 }, { x: 66, y: 70 }, { x: 34, y: 70 }, { x: 74, y: 38 }, { x: 28, y: 42 }, { x: 44, y: 22 }],
        oppPos: [{ x: 50, y: 11 }, { x: 40, y: 26 }, { x: 70, y: 33 }, { x: 30, y: 46 }, { x: 72, y: 54 }, { x: 50, y: 60 }],
        ball: { x: 73, y: 37 },
        activeIndices: [3],
        arrows: [
          { from: [74, 38], to: [62, 26], kind: 'run' },
        ],
        zones: [{ x: 62, y: 26, r: 10, label: 'مساحة الاختراق', color: 'gold' }],
      },
      {
        title: '3. الحسم السريع بعد المرور قبل وصول التغطية',
        narration: 'فور تجاوز المدافع، سدّد فوراً نحو الزاوية أو مرر للمهاجم الحر قبل أن يغلق الدفاع الثغرة.',
        durationMs: 2600,
        ourPos: [{ x: 50, y: 88 }, { x: 64, y: 68 }, { x: 36, y: 68 }, { x: 60, y: 24 }, { x: 30, y: 34 }, { x: 44, y: 18 }],
        oppPos: [{ x: 50, y: 11 }, { x: 42, y: 22 }, { x: 74, y: 34 }, { x: 32, y: 42 }, { x: 70, y: 50 }, { x: 50, y: 58 }],
        ball: { x: 48, y: 10 },
        activeIndices: [3, 5],
        arrows: [
          { from: [60, 24], to: [48, 9], kind: 'ball' },
        ],
        zones: [{ x: 60, y: 24, r: 10, label: 'تفوق 1v1 ✓', color: 'emerald' }],
      },
    ],
  },
  {
    id: 'two_vs_one',
    index: 8,
    icon: '⚡',
    title: 'التفوق العددي 2 ضد 1 (التمرير أو الاختراق)',
    category: 'هجومي',
    summary: 'سحب المدافع الأخير بالكرة ثم التمرير في اللحظة المثالية',
    frames: [
      {
        title: '1. المهاجم بالكرة يتقدم مباشرة نحو المدافع الأخير',
        narration: 'لا تمرّر مبكراً! تقدّم بالكرة مباشرة نحو المدافع الوحيد لتجبره على اتخاذ قرار: إما يخرج لك أو يترك زميلك.',
        durationMs: 2600,
        ourPos: [{ x: 50, y: 90 }, { x: 64, y: 70 }, { x: 36, y: 70 }, { x: 62, y: 40 }, { x: 32, y: 44 }, { x: 34, y: 30 }],
        oppPos: [{ x: 50, y: 11 }, { x: 50, y: 27 }, { x: 76, y: 54 }, { x: 24, y: 56 }, { x: 60, y: 64 }, { x: 40, y: 66 }],
        ball: { x: 61, y: 38 },
        activeIndices: [3, 5],
        arrows: [
          { from: [62, 40], to: [56, 30], kind: 'ball' },
          { from: [34, 30], to: [32, 20], kind: 'run' },
        ],
        zones: [{ x: 50, y: 27, r: 9, label: 'المدافع الوحيد', color: 'rose' }],
      },
      {
        title: '2. لحظة التثبيت والتمريرة العرضية القاتلة',
        narration: 'بمجرد أن يخطو المدافع باتجاه حامل الكرة، تخرج التمريرة السريعة للزميل المنطلق في الجهة الفارغة!',
        durationMs: 2700,
        ourPos: [{ x: 50, y: 90 }, { x: 62, y: 68 }, { x: 38, y: 68 }, { x: 56, y: 29 }, { x: 34, y: 42 }, { x: 32, y: 19 }],
        oppPos: [{ x: 52, y: 11 }, { x: 54, y: 26 }, { x: 72, y: 48 }, { x: 28, y: 50 }, { x: 58, y: 60 }, { x: 42, y: 62 }],
        ball: { x: 33, y: 19 },
        activeIndices: [3, 5],
        arrows: [{ from: [56, 29], to: [32, 19], kind: 'ball' }],
        zones: [{ x: 32, y: 19, r: 10, label: 'انفراد كامل!', color: 'gold' }],
      },
      {
        title: '3. إنهاء سهل أمام الحارس',
        narration: 'يستلم الزميل الكرة في وضع مثالي ويسدد بلمسة واحدة في الشباك الخالية — أبسط وأضمن هدف في 6v6!',
        durationMs: 2500,
        ourPos: [{ x: 50, y: 90 }, { x: 62, y: 68 }, { x: 38, y: 68 }, { x: 56, y: 28 }, { x: 36, y: 40 }, { x: 35, y: 16 }],
        oppPos: [{ x: 44, y: 11 }, { x: 54, y: 26 }, { x: 70, y: 46 }, { x: 30, y: 48 }, { x: 58, y: 58 }, { x: 42, y: 60 }],
        ball: { x: 52, y: 9 },
        activeIndices: [5],
        arrows: [{ from: [35, 16], to: [52, 9], kind: 'ball' }],
        zones: [{ x: 50, y: 10, r: 9, label: 'هدف مضمون ✓', color: 'emerald' }],
      },
    ],
  },
  {
    id: 'last_3min_winning',
    index: 9,
    icon: '⏳',
    title: 'آخر 3 دقائق — ونحن فائزين',
    category: 'مواقف حاسمة',
    summary: 'قتل الرتم بالاستحواذ الآمن في مثلثات الزاوية وتأمين العمق',
    frames: [
      {
        title: '1. الاحتفاظ بالكرة في ملعب الخصم بدون مخاطرة',
        narration: 'نحن متقدمون! ممنوع التمريرات الطويلة العشوائية — نحتفظ بالكرة بمثلثات قصيرة قريبة من زاوية الخصم.',
        durationMs: 2600,
        ourPos: [{ x: 50, y: 91 }, { x: 62, y: 74 }, { x: 38, y: 74 }, { x: 82, y: 32 }, { x: 64, y: 42 }, { x: 76, y: 20 }],
        oppPos: [{ x: 50, y: 11 }, { x: 64, y: 24 }, { x: 74, y: 34 }, { x: 52, y: 40 }, { x: 40, y: 54 }, { x: 56, y: 62 }],
        ball: { x: 81, y: 31 },
        activeIndices: [3, 4, 5],
        triangles: [[3, 4, 5]],
        arrows: [{ from: [82, 32], to: [76, 20], kind: 'ball' }],
        zones: [{ x: 76, y: 28, r: 13, label: 'مثلث استهلاك الوقت', color: 'gold' }],
      },
      {
        title: '2. التمرير للخلف وإعادة التدوير الهادئ',
        narration: 'عندما يضغط الخصم، نعيد الكرة بهدوء للمدافع أو الحارس ونغيّر الجهة لقتل حماسهم واستهلاك الثواني.',
        durationMs: 2600,
        ourPos: [{ x: 50, y: 91 }, { x: 68, y: 72 }, { x: 26, y: 70 }, { x: 76, y: 44 }, { x: 54, y: 52 }, { x: 66, y: 32 }],
        oppPos: [{ x: 50, y: 11 }, { x: 58, y: 30 }, { x: 68, y: 42 }, { x: 48, y: 48 }, { x: 42, y: 60 }, { x: 60, y: 66 }],
        ball: { x: 28, y: 70 },
        activeIndices: [4, 1, 2],
        arrows: [
          { from: [54, 52], to: [68, 72], kind: 'ball' },
          { from: [68, 72], to: [26, 70], kind: 'ball' },
        ],
      },
      {
        title: '3. تأمين العمق حتى صافرة النهاية',
        narration: 'عند أي كرة للخصم، يعود 4 لاعبين فوراً أمام مرمانا لإغلاق كل زوايا التسديد وحسم الفوز!',
        durationMs: 2500,
        ourPos: [{ x: 50, y: 91 }, { x: 62, y: 78 }, { x: 38, y: 78 }, { x: 66, y: 66 }, { x: 34, y: 66 }, { x: 50, y: 56 }],
        oppPos: [{ x: 50, y: 14 }, { x: 32, y: 44 }, { x: 68, y: 44 }, { x: 24, y: 58 }, { x: 76, y: 58 }, { x: 50, y: 68 }],
        ball: { x: 50, y: 52 },
        activeIndices: [0, 1, 2, 3, 4],
        zones: [{ x: 50, y: 74, r: 16, label: 'فوز مؤمّن 👑', color: 'emerald' }],
        arrows: [],
      },
    ],
  },
  {
    id: 'last_3min_losing',
    index: 10,
    icon: '🔥',
    title: 'آخر 3 دقائق — ونحن خاسرين',
    category: 'مواقف حاسمة',
    summary: 'ضغط عالٍ شامل وتقدّم الحارس للمنتصف لخلق تفوق 6 ضد 5',
    frames: [
      {
        title: '1. ضغط رجل لرجل على كل لاعبي الخصم',
        narration: 'نحتاج هدف التعادل الآن! يتقدم كل لاعب لمراقبة خصمه مباشرة لمنعهم من تدوير الكرة وإجبارهم على الخطأ.',
        durationMs: 2600,
        ourPos: [{ x: 50, y: 66 }, { x: 72, y: 44 }, { x: 28, y: 44 }, { x: 74, y: 26 }, { x: 26, y: 26 }, { x: 50, y: 20 }],
        oppPos: [{ x: 50, y: 11 }, { x: 32, y: 24 }, { x: 68, y: 24 }, { x: 30, y: 40 }, { x: 70, y: 40 }, { x: 50, y: 54 }],
        ball: { x: 68, y: 24 },
        activeIndices: [3, 5, 4, 0],
        arrows: [
          { from: [74, 26], to: [68, 24], kind: 'run' },
          { from: [50, 20], to: [44, 20], kind: 'run' },
        ],
        zones: [{ x: 50, y: 26, r: 18, label: 'ضغط شامل!', color: 'rose' }],
      },
      {
        title: '2. الحارس يتقدم كصانع ألعاب سادس (Power Play)',
        narration: 'بعد استعادة الكرة، يتقدم الحارس حتى دائرة المنتصف لتصبح الهجمة 6 ضد 5 وتنفتح زاوية تسديد حرة!',
        durationMs: 2700,
        ourPos: [{ x: 50, y: 54 }, { x: 78, y: 38 }, { x: 22, y: 38 }, { x: 68, y: 22 }, { x: 32, y: 22 }, { x: 50, y: 17 }],
        oppPos: [{ x: 50, y: 11 }, { x: 38, y: 22 }, { x: 62, y: 22 }, { x: 36, y: 34 }, { x: 64, y: 34 }, { x: 50, y: 42 }],
        ball: { x: 50, y: 51 },
        activeIndices: [0, 1, 2],
        arrows: [
          { from: [50, 54], to: [78, 38], kind: 'ball' },
          { from: [50, 66], to: [50, 54], kind: 'run' },
        ],
        zones: [{ x: 50, y: 54, r: 11, label: 'الحارس السادس!', color: 'gold' }],
      },
      {
        title: '3. الكرة العرضية والزحام أمام المرمى للتعادل!',
        narration: 'تمريرة سريعة للطرف ثم عرضية أرضية حاسمة مع تواجد 3 لاعبين داخل الصندوق لاقتناص هدف التعادل!',
        durationMs: 2600,
        ourPos: [{ x: 50, y: 52 }, { x: 80, y: 32 }, { x: 28, y: 32 }, { x: 62, y: 18 }, { x: 38, y: 18 }, { x: 50, y: 14 }],
        oppPos: [{ x: 50, y: 11 }, { x: 40, y: 19 }, { x: 60, y: 19 }, { x: 40, y: 30 }, { x: 62, y: 30 }, { x: 50, y: 38 }],
        ball: { x: 50, y: 10 },
        activeIndices: [1, 5, 3, 4],
        arrows: [
          { from: [80, 32], to: [50, 14], kind: 'ball' },
          { from: [50, 14], to: [50, 9], kind: 'ball' },
        ],
        zones: [{ x: 50, y: 15, r: 12, label: 'هدف التعادل 🔥', color: 'emerald' }],
      },
    ],
  },
];

// ==================== CAPTAIN TACTICAL ALGORITHMS ====================

export interface MinimalPlayer {
  id: string;
  name: string;
  jersey?: number | string;
  primaryPos?: string;
  secondaryPos?: string;
  photo?: string;
  availableStatus?: string;
  skills?: Record<string, number>;
}

export function computePlayerOvr(player: MinimalPlayer | undefined): number {
  if (!player || !player.skills) return 65;
  const vals = SKILL_KEYS.map((k) => {
    const v = Number(player.skills?.[k]);
    return Number.isFinite(v) ? Math.max(1, Math.min(10, v)) : 6;
  });
  return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10);
}

export type ChemistryLevel = 'gold' | 'green' | 'dashed';

export function computeChemistryLink(
  pA: MinimalPlayer | undefined,
  pB: MinimalPlayer | undefined
): { level: ChemistryLevel; score: number } {
  if (!pA || !pB) return { level: 'dashed', score: 35 };
  const skA = pA.skills || {};
  const skB = pB.skills || {};
  const synergyA = Number(skA.teamwork || 6) + Number(skA.passing || 6) + Number(skA.vision || 6);
  const synergyB = Number(skB.teamwork || 6) + Number(skB.passing || 6) + Number(skB.vision || 6);
  const avg = (synergyA + synergyB) / 6; // 1..10
  const posDiversityBonus = pA.primaryPos && pB.primaryPos && pA.primaryPos !== pB.primaryPos ? 0.6 : 0;
  const total = avg + posDiversityBonus;

  if (total >= 7.5) return { level: 'gold', score: Math.min(99, Math.round(total * 10 + 14)) };
  if (total >= 6.4) return { level: 'green', score: Math.min(88, Math.round(total * 10 + 10)) };
  return { level: 'dashed', score: Math.max(45, Math.round(total * 10)) };
}

export function computeTeamChemistry(
  form: FormationDef,
  slotPlayers: Array<MinimalPlayer | undefined>
): { totalPct: number; avgOvr: number; linkResults: Array<{ a: number; b: number; level: ChemistryLevel }> } {
  const assigned = slotPlayers.filter((p): p is MinimalPlayer => Boolean(p));
  const avgOvr = assigned.length
    ? Math.round(assigned.reduce((s, p) => s + computePlayerOvr(p), 0) / assigned.length)
    : 0;

  const linkResults = form.links.map(([a, b]) => {
    const res = computeChemistryLink(slotPlayers[a], slotPlayers[b]);
    return { a, b, level: res.level, score: res.score };
  });

  const totalPct = linkResults.length
    ? Math.round(linkResults.reduce((s, r) => s + r.score, 0) / linkResults.length)
    : 0;

  return {
    totalPct,
    avgOvr,
    linkResults: linkResults.map(({ a, b, level }) => ({ a, b, level })),
  };
}

export interface FairSplitResult {
  gold: Array<MinimalPlayer & { ovr: number }>;
  silver: Array<MinimalPlayer & { ovr: number }>;
  goldAvg: number;
  silverAvg: number;
  diff: number;
  excludedUnavailable: MinimalPlayer[];
  whatsappText: string;
}

export function splitFairTeams(players: MinimalPlayer[], teamName = 'فريق السداسي'): FairSplitResult {
  const excludedUnavailable = players.filter((p) => p.availableStatus === 'unavailable');
  const pool = players
    .filter((p) => p.availableStatus !== 'unavailable')
    .map((p) => ({ ...p, ovr: computePlayerOvr(p) }));

  // Separate GKs first so each side gets a GK when >= 2 exist, then sort remaining by OVR descending
  const gks = pool.filter((p) => p.primaryPos === 'حارس مرمى').sort((a, b) => b.ovr - a.ovr);
  const outfield = pool.filter((p) => p.primaryPos !== 'حارس مرمى').sort((a, b) => b.ovr - a.ovr);
  const ordered = [...gks, ...outfield];

  const gold: Array<MinimalPlayer & { ovr: number }> = [];
  const silver: Array<MinimalPlayer & { ovr: number }> = [];
  let goldSum = 0;
  let silverSum = 0;

  for (const p of ordered) {
    if (gold.length < silver.length) {
      gold.push(p);
      goldSum += p.ovr;
    } else if (silver.length < gold.length) {
      silver.push(p);
      silverSum += p.ovr;
    } else if (goldSum <= silverSum) {
      gold.push(p);
      goldSum += p.ovr;
    } else {
      silver.push(p);
      silverSum += p.ovr;
    }
  }

  const goldAvg = gold.length ? Number((goldSum / gold.length).toFixed(1)) : 0;
  const silverAvg = silver.length ? Number((silverSum / silver.length).toFixed(1)) : 0;
  const diff = Number(Math.abs(goldAvg - silverAvg).toFixed(1));

  const whatsappText =
    `⚖️ *تقسيمة عادلة — ${teamName}*\n\n` +
    `🟡 *الفريق الذهبي* (متوسط ${goldAvg}):\n` +
    (gold.map((p, i) => `${i + 1}. ${p.name} (${p.primaryPos || 'لاعب'} • ${p.ovr})`).join('\n') || '—') +
    `\n\n⚪ *الفريق الفضي* (متوسط ${silverAvg}):\n` +
    (silver.map((p, i) => `${i + 1}. ${p.name} (${p.primaryPos || 'لاعب'} • ${p.ovr})`).join('\n') || '—') +
    `\n\n📊 فارق القوة: ${diff} نقطة فقط — بالتوفيق للجميع! ⚽👑`;

  return { gold, silver, goldAvg, silverAvg, diff, excludedUnavailable, whatsappText };
}

function slotGroupMatchesPos(group: RoleGroup, pos?: string): number {
  if (!pos) return 1;
  if (group === 'gk' && pos === 'حارس مرمى') return 10;
  if (group === 'def' && pos === 'مدافع') return 10;
  if (group === 'mid' && pos === 'لاعب وسط') return 10;
  if (group === 'wing' && (pos === 'جناح' || pos === 'لاعب وسط')) return pos === 'جناح' ? 10 : 7;
  if (group === 'fwd' && (pos === 'مهاجم' || pos === 'جناح')) return pos === 'مهاجم' ? 10 : 7;
  if (group === 'gk') return 0; // avoid putting outfield player in GK unless forced
  return 3;
}

export function suggestSmartLineup(
  players: MinimalPlayer[],
  form: FormationDef
): { slots: Record<string, string>; excludedCount: number; assignedCount: number } {
  const available = players.filter((p) => p.availableStatus !== 'unavailable');
  const excludedCount = players.length - available.length;
  const remaining = [...available];
  const slots: Record<string, string> = {};

  form.slots.forEach((slotDef, idx) => {
    if (!remaining.length) return;
    let bestIdx = 0;
    let bestScore = -1;
    remaining.forEach((p, pIdx) => {
      const prim = slotGroupMatchesPos(slotDef.roleGroup, p.primaryPos);
      const sec = slotGroupMatchesPos(slotDef.roleGroup, p.secondaryPos) * 0.65;
      const ovrBonus = computePlayerOvr(p) / 25;
      const total = Math.max(prim, sec) + ovrBonus;
      if (total > bestScore) {
        bestScore = total;
        bestIdx = pIdx;
      }
    });
    const picked = remaining.splice(bestIdx, 1)[0];
    slots[`${form.id}_${idx}`] = picked.id;
  });

  return { slots, excludedCount, assignedCount: Object.keys(slots).length };
}

export interface RotationPlan {
  intervalMin: number;
  starters: MinimalPlayer[];
  bench: MinimalPlayer[];
  schedule: Array<{ minute: number; subIn: string; subOut: string }>;
}

export function buildRotationPlan(
  players: MinimalPlayer[],
  starterCount: number,
  intervalMin = 12
): RotationPlan {
  const cleanInterval = Math.max(8, Math.min(20, Math.round(intervalMin)));
  const available = players.filter((p) => p.availableStatus !== 'unavailable');
  const starters = available.slice(0, starterCount);
  const bench = available.slice(starterCount);
  const schedule: RotationPlan['schedule'] = [];

  if (bench.length > 0 && starters.length > 1) {
    // Rotate outfield players fairly (skip GK index 0)
    const outfieldStarters = starters.slice(1);
    for (let round = 0; round < Math.max(3, bench.length); round++) {
      const minute = (round + 1) * cleanInterval;
      if (minute > 60) break;
      const subIn = bench[round % bench.length];
      const subOut = outfieldStarters[round % outfieldStarters.length];
      schedule.push({ minute, subIn: subIn.name, subOut: subOut.name });
    }
  }

  return { intervalMin: cleanInterval, starters, bench, schedule };
}

export const GK_TACTICAL_GUIDE = [
  { icon: '📐', title: 'إغلاق الزاوية مبكراً', desc: 'تقدّم خطوتين عند الانفراد لتقليص مساحة المرمى أمام المهاجم.' },
  { icon: '🚀', title: 'رمية اليد بدون تسلل', desc: 'في 6v6 ارمِ الكرة بسرعة بيدك خلف دفاع الخصم فور الإمساك بها لصناعة مرتدة فورية.' },
  { icon: '👣', title: 'اللاعب السادس بالقدم', desc: 'اخرج خطوة خارج الصندوق لفتح زاوية تمرير سهلة لمدافعيك تحت الضغط.' },
  { icon: '🗣️', title: 'قيادة الدفاع بالصوت', desc: 'أنت الوحيد الذي يرى الملعب كاملاً — نبّه زملاءك على المهاجم الحر بالخلف.' },
];

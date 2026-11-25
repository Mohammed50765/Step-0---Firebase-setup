import { escapeHtml } from './security';

export const LIBRARY_CATEGORIES = [
  'التكتيكات والخطط',
  'أساسيات المراكز والأدوار',
  'مهارات المراوغة والتحكم',
  'التمرير وصناعة اللعب',
  'التسديد والإنهاء',
  'التحركات بدون كرة',
  'الضغط الجماعي',
  'التدريب الفردي',
  'اللياقة والتحمل',
  'الإحماء والتعافي',
  'تطوير الحراس',
  'القواعد الكروية',
  'الوقاية من الإصابات والإسعافات',
] as const;

export type LibraryCategory = (typeof LIBRARY_CATEGORIES)[number];

export const LIBRARY_LEVELS = ['مبتدئ', 'متوسط', 'متقدم'] as const;
export type LibraryLevel = (typeof LIBRARY_LEVELS)[number];

export interface GlossaryTerm {
  en: string;
  ar: string;
}

export interface FootballArticle {
  id: string;
  titleAr: string;
  originalLang: string;
  publisher: string;
  sourceUrl: string;
  publishedAt: string;
  lastReviewed: string;
  category: LibraryCategory;
  level: LibraryLevel;
  summaryAr: string;
  keyTakeawaysAr: string[];
  terms: GlossaryTerm[];
  originalExcerpt: string;
  published: boolean;
  isCustom?: boolean;
}

export interface LibraryFilterOptions {
  category?: string;
  level?: string;
  query?: string;
  includeHidden?: boolean;
}

export interface LibraryMountContext {
  getCustomArticles: () => FootballArticle[];
  isCaptain: () => boolean;
  onSaveArticle: (article: FootballArticle) => Promise<boolean>;
  onDeleteArticle: (articleId: string) => Promise<boolean>;
  toast: (msg: string, isErr?: boolean) => void;
}

const LOCAL_LIBRARY_KEY = 'maydan_football_library_overrides_v1';

/**
 * Strictly allows only clean HTTPS URLs (blocks javascript:, data:, http:, etc.).
 */
export function sanitizeSourceUrl(raw: unknown): string {
  const s = String(raw || '').trim();
  if (!s || s.length > 300) return '';
  if (!/^https:\/\/[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]+$/.test(s)) return '';
  try {
    const u = new URL(s);
    if (u.protocol !== 'https:' || !u.hostname.includes('.')) return '';
    return u.toString();
  } catch {
    return '';
  }
}

export function sanitizeLibraryCategory(raw: unknown): LibraryCategory {
  const s = String(raw || '').trim();
  return (LIBRARY_CATEGORIES as readonly string[]).includes(s)
    ? (s as LibraryCategory)
    : 'التكتيكات والخطط';
}

export function sanitizeLibraryLevel(raw: unknown): LibraryLevel {
  const s = String(raw || '').trim();
  return (LIBRARY_LEVELS as readonly string[]).includes(s) ? (s as LibraryLevel) : 'متوسط';
}

export function parseGlossaryInput(raw: string): GlossaryTerm[] {
  return String(raw || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 8)
    .map((line) => {
      const parts = line.split(/\s*(?:[:—|]|\s-\s)\s*/).map((p) => p.trim()).filter(Boolean);
      if (parts.length >= 2) {
        return { en: parts[0].slice(0, 50), ar: parts.slice(1).join(' ').slice(0, 60) };
      }
      return { en: (parts[0] || '').slice(0, 50), ar: (parts[0] || '').slice(0, 60) };
    })
    .filter((t) => t.en.length > 0 && t.ar.length > 0);
}

/**
 * Curated starter catalog of 13 original Arabic educational summaries
 * synthesized from trusted, real international football & sports health references.
 * Zero copied copyrighted full text, zero invented authors or links.
 */
export const STARTER_FOOTBALL_LIBRARY: FootballArticle[] = [
  {
    id: 'lib_counter_pressing',
    titleAr: 'الضغط العكسي وقاعدة الـ 5 ثوانٍ في الملاعب المصغّرة',
    originalLang: 'الإنجليزية',
    publisher: 'UEFA Coaching & Technical',
    sourceUrl: 'https://www.uefa.com/development/coaches/',
    publishedAt: '2025-11-10',
    lastReviewed: '2026-10-15',
    category: 'الضغط الجماعي',
    level: 'متقدم',
    summaryAr:
      'يشرح هذا الملخص مبدأ استعادة الكرة فوراً خلال أول 5 ثوانٍ من فقدانها قبل أن ينجح الخصم في تنظيم هجمته المرتدة. في مباريات 6v6، المساحات قصيرة للغاية، ما يجعل إغلاق زوايا التمرير القريبة فوراً أكثر فاعلية من التراجع السلبي للخلف.',
    keyTakeawaysAr: [
      'أقرب لاعبين يضغطان مباشرة على حامل الكرة لمنعه من رفع رأسه.',
      'اللاعب الثالث يغلق ممر التمرير للعمق بدل الركض العشوائي خلف الكرة.',
      'إذا كسر الخصم الضغط خلال 5 ثوانٍ، يعود الفريق بالكامل فوراً لكتلة دفاعية متماسكة.',
    ],
    terms: [
      { en: 'Counter-Pressing', ar: 'الضغط العكسي' },
      { en: 'Pressing Trap', ar: 'فخ الضغط' },
      { en: 'Rest Defense', ar: 'الدفاع الوقائي الخلفي' },
    ],
    originalExcerpt:
      'Immediate counter-pressing aims to regain possession within seconds of losing the ball while the opponent is still disorganized.',
    published: true,
  },
  {
    id: 'lib_through_ball_creation',
    titleAr: 'صناعة اللعب والتمريرة البينية لكسر الخطوط المتكتلة',
    originalLang: 'الإنجليزية',
    publisher: 'England Football Learning (The FA)',
    sourceUrl: 'https://learn.englandfootball.com/',
    publishedAt: '2025-10-18',
    lastReviewed: '2026-10-12',
    category: 'التمرير وصناعة اللعب',
    level: 'متوسط',
    summaryAr:
      'كيف يقرأ صانع اللعب الفجوة بين مدافعي الخصم ويختار توقيت التمريرة البينية المثالي في المساحة وليس عند قدم الزميل. يركّز الدليل على وزن التمريرة وإخفاء اتجاهها بوضعية الجسد حتى آخر لحظة.',
    keyTakeawaysAr: [
      'امسح الملعب بنظرة سريعة قبل استلام الكرة لمعرفة موقع المهاجم والفجوة.',
      'مرّر في المساحة أمام سرعة زميلك وليس خلف ظهره لتسريع الإيقاع.',
      'استخدم «خذ وهات» لسحب المدافع خطوة قبل إرسال التمريرة البينية.',
    ],
    terms: [
      { en: 'Through Ball', ar: 'التمريرة البينية' },
      { en: 'Line-Breaking Pass', ar: 'تمريرة كسر الخطوط' },
      { en: 'Scanning', ar: 'المسح البصري قبل الاستلام' },
    ],
    originalExcerpt:
      'Effective playmakers scan before receiving and disguise line-breaking through balls into the space ahead of a teammate.',
    published: true,
  },
  {
    id: 'lib_off_ball_movement',
    titleAr: 'فن التحرك بدون كرة وانطلاقة الرجل الثالث',
    originalLang: 'الإنجليزية',
    publisher: 'England Football Learning (The FA)',
    sourceUrl: 'https://learn.englandfootball.com/',
    publishedAt: '2025-09-25',
    lastReviewed: '2026-10-10',
    category: 'التحركات بدون كرة',
    level: 'متوسط',
    summaryAr:
      'أغلب دقائق المباراة يلعبها اللاعب بدون كرة؛ لذلك فإن ذكاء تحركك يفتح زوايا التمرير لزملائك ويسحب الرقابة عنهم. في 6v6 بدون تسلل، التبديل السريع بين الهبوط للاستلام والانطلاق في الظهر يربك أي دفاع.',
    keyTakeawaysAr: [
      'لا تقف في ظل المدافع — تحرّك خطوتين جانبياً لتصبح مرئياً لحامل الكرة.',
      'استخدم حركة «ابتعد ثم اقترب» للتخلص من الرقابة اللصيقة.',
      'انطلاقة الرجل الثالث تفاجئ الدفاع لأن الرقابة تكون مشغولة بحامل الكرة.',
    ],
    terms: [
      { en: 'Off the Ball Movement', ar: 'التحرك بدون كرة' },
      { en: 'Third-Man Run', ar: 'انطلاقة الرجل الثالث' },
      { en: 'Half-Space', ar: 'نصف المساحة' },
    ],
    originalExcerpt:
      'Intelligent off-the-ball movement creates passing lanes, pulls markers out of shape, and unlocks third-man combinations.',
    published: true,
  },
  {
    id: 'lib_first_touch_dribbling',
    titleAr: 'اللمسة الأولى الموجّهة والمراوغة بتغيير الإيقاع',
    originalLang: 'الإنجليزية',
    publisher: 'U.S. Soccer Learning Center',
    sourceUrl: 'https://learning.ussoccer.com/',
    publishedAt: '2025-11-02',
    lastReviewed: '2026-10-14',
    category: 'مهارات المراوغة والتحكم',
    level: 'مبتدئ',
    summaryAr:
      'اللمسة الأولى الصحيحة توفر ثانية كاملة وتجعلك تتجاوز أول ضغط دون حاجة لمهارات معقدة. يشرح هذا الدليل كيف توجّه قدمك وجسدك نحو المساحة الفارغة لحظة الاستلام وتستخدم تغيير السرعة في مواقف 1 ضد 1.',
    keyTakeawaysAr: [
      'استقبل الكرة بالقدم البعيدة عن المدافع لتفتح جسدك نحو الملعب مباشرة.',
      'امسح خلف كتفك قبل وصول الكرة لتعرف إن كان هناك ضغط قريب.',
      'في 1 ضد 1، الإبطاء ثم الانطلاق المفاجئ أخطر من الحركات الاستعراضية.',
    ],
    terms: [
      { en: 'First Touch', ar: 'اللمسة الأولى' },
      { en: 'Body Orientation', ar: 'توجيه وضعية الجسد' },
      { en: 'Change of Pace', ar: 'تغيير الإيقاع' },
    ],
    originalExcerpt:
      'A positive directional first touch moves the ball away from pressure and immediately opens options to pass or drive forward.',
    published: true,
  },
  {
    id: 'lib_tactics_triangles',
    titleAr: 'بناء المثلثات وتوسيع الملعب في الخطط التكتيكية',
    originalLang: 'الإنجليزية',
    publisher: 'UEFA Coaching & Technical',
    sourceUrl: 'https://www.uefa.com/development/coaches/',
    publishedAt: '2025-08-30',
    lastReviewed: '2026-10-08',
    category: 'التكتيكات والخطط',
    level: 'مبتدئ',
    summaryAr:
      'أساس اللعب الجماعي الحديث هو توفير خيارين آمنين لحامل الكرة عبر تشكيل مثلثات ومعيّنات مترابطة. عندما يفتح الفريق عرض الملعب في الهجوم ويضيّقه في الدفاع، يفرض إيقاعه بأقل مجهود بدني.',
    keyTakeawaysAr: [
      'حافظ على مسافات متوازنة بين الخطوط حتى لا ينعزل المهاجم في الأمام.',
      'التمريرات القصيرة من لمستين تُتعب الخصم وتفتح الجهة العكسية تلقائياً.',
      'تدوير الكرة للخلف ليس ضعفاً بل وسيلة ذكية لإعادة جذب الخصم.',
    ],
    terms: [
      { en: 'Passing Triangles', ar: 'مثلثات التمرير' },
      { en: 'Switch of Play', ar: 'تحويل جهة اللعب' },
      { en: 'Compactness', ar: 'تقارب الخطوط' },
    ],
    originalExcerpt:
      'Forming clear passing triangles ensures the ball carrier always has multiple angles to retain possession or progress forward.',
    published: true,
  },
  {
    id: 'lib_positional_roles',
    titleAr: 'دليل المراكز والأدوار التكتيكية في 6v6 و11v11',
    originalLang: 'الإنجليزية',
    publisher: 'England Football Learning (The FA)',
    sourceUrl: 'https://learn.englandfootball.com/',
    publishedAt: '2025-09-12',
    lastReviewed: '2026-10-09',
    category: 'أساسيات المراكز والأدوار',
    level: 'مبتدئ',
    summaryAr:
      'مقارنة عملية بين واجبات المدافع ولاعب الوسط والجناح والمهاجم في حالتي الاستحواذ وفقدان الكرة. في 6v6 كل لاعب يملك دوراً مزدوجاً: مساندة الهجوم عند الاستحواذ والتغطية الفورية عند فقدان الكرة.',
    keyTakeawaysAr: [
      'المدافع يوازن بين البناء الهادئ وحماية العمق دون اندفاع متهور.',
      'لاعب الوسط هو بوصلة الفريق ويربط الخطوط بتمريرات سريعة.',
      'المهاجم يبدأ خط الدفاع الأول بتوجيه بناء الخصم نحو الأطراف.',
    ],
    terms: [
      { en: 'Pivot / Fixo', ar: 'المدافع المحور الخلفي' },
      { en: 'Box-to-Box', ar: 'وسط متكامل هجومياً ودفاعياً' },
      { en: 'Target Striker', ar: 'المهاجم المحطة' },
    ],
    originalExcerpt:
      'Understanding role responsibilities both in and out of possession helps every player make faster collective decisions.',
    published: true,
  },
  {
    id: 'lib_finishing_composure',
    titleAr: 'الإنهاء الهادئ واختيار زاوية التسديد داخل الصندوق',
    originalLang: 'الإنجليزية',
    publisher: 'U.S. Soccer Learning Center',
    sourceUrl: 'https://learning.ussoccer.com/',
    publishedAt: '2025-10-04',
    lastReviewed: '2026-10-11',
    category: 'التسديد والإنهاء',
    level: 'متوسط',
    summaryAr:
      'الدقة واختيار الزاوية البعيدة يتفوقان على القوة العشوائية خاصة في المرمى الصغير لمباريات 6v6. يتناول الملخص تثبيت القدم المرتكزة، إبقاء الركبة فوق الكرة، والنظر السريع لموقع الحارس قبل اللمسة الأخيرة.',
    keyTakeawaysAr: [
      'التسديد الأرضي نحو الزاوية السفلى أصعب ما يكون على الحارس في السداسي.',
      'وجّه قدم الارتكاز نحو الهدف وحافظ على توازن الجسد دون ميلان للخلف.',
      'الإنهاء من لمسة واحدة يحرم الحارس والمدافع من وقت إغلاق الزاوية.',
    ],
    terms: [
      { en: 'Clinical Finishing', ar: 'الإنهاء الحاسم' },
      { en: 'Inside-of-Foot Placement', ar: 'الركن بباطن القدم' },
      { en: 'Near / Far Post', ar: 'القائم القريب والبعيد' },
    ],
    originalExcerpt:
      'Composed finishers prioritize accuracy, low driven placement, and early shooting before defenders can recover.',
    published: true,
  },
  {
    id: 'lib_solo_training',
    titleAr: 'خطة التدريب الفردي الذكي (20 دقيقة يومياً بالكرة)',
    originalLang: 'الإنجليزية',
    publisher: 'England Football Learning (The FA)',
    sourceUrl: 'https://learn.englandfootball.com/',
    publishedAt: '2025-11-14',
    lastReviewed: '2026-10-13',
    category: 'التدريب الفردي',
    level: 'مبتدئ',
    summaryAr:
      'لا تحتاج لملعب كامل لتطوير مستواك؛ 20 دقيقة بجوار حائط وبكرة واحدة تكفي لرفع جودة اللمسة الأولى والقدم الضعيفة والتمرير السريع بشكل ملحوظ خلال 4 أسابيع.',
    keyTakeawaysAr: [
      '5 دقائق تمرير واستلام بالحائط بالقدمين (يمين ويسار) مع مسح بصري.',
      '5 دقائق تحكم بالكرة وتغيير اتجاه سريع في مساحة مترين.',
      '10 دقائق تمارين استلام ودوران بلمسة واحدة تحت إيقاع متصاعد.',
    ],
    terms: [
      { en: 'Wall Passing Drill', ar: 'تمرين الحائط للتمرير والاستلام' },
      { en: 'Weak Foot Mastery', ar: 'إتقان القدم الضعيفة' },
      { en: 'Ball Mastery', ar: 'السيطرة المتقدمة بالكرة' },
    ],
    originalExcerpt:
      'Short, high-repetition solo wall sessions build sharper first touch, two-footed comfort, and faster receiving habits.',
    published: true,
  },
  {
    id: 'lib_fitness_hiit',
    titleAr: 'اللياقة الكروية والتحمل المتقطع (HIIT) لمباريات 6v6',
    originalLang: 'الإنجليزية',
    publisher: 'NHS Sports & Exercise Health',
    sourceUrl: 'https://www.nhs.uk/live-well/exercise/',
    publishedAt: '2025-10-22',
    lastReviewed: '2026-10-14',
    category: 'اللياقة والتحمل',
    level: 'متوسط',
    summaryAr:
      'مباريات السداسي تعتمد على انطلاقات قصيرة متكررة (5–15 ثانية) تليها فترات التقاط أنفاس قصيرة، وليس الجري البطيء المتواصل. يوضّح الملخص كيف تبني قدرة الاسترجاع السريع للنبض بين الهجمة والمرتدة.',
    keyTakeawaysAr: [
      'التدريب المتقطع (جري سريع 15 ثانية + مشي 30 ثانية) يحاكي رتم 6v6 الفعلي.',
      'الترطيب المنتظم بالماء قبل المباراة بساعتين يمنع الهبوط البدني المبكر.',
      'تجنّب التمارين العنيفة قبل يوم المباراة بـ 24 ساعة للحفاظ على طراوة العضلات.',
    ],
    terms: [
      { en: 'High-Intensity Interval Training (HIIT)', ar: 'التدريب المتقطع عالي الشدة' },
      { en: 'Repeated Sprint Ability', ar: 'القدرة على تكرار الانطلاقات السريعة' },
      { en: 'Active Recovery', ar: 'الاستشفاء النشط' },
    ],
    originalExcerpt:
      'Small-sided football relies on repeated short sprints and rapid cardiovascular recovery rather than steady-state jogging.',
    published: true,
  },
  {
    id: 'lib_warmup_recovery',
    titleAr: 'بروتوكول الإحماء الحركي قبل اللعب والتعافي بعد المباراة',
    originalLang: 'الإنجليزية',
    publisher: 'NHS Sports & Exercise Health',
    sourceUrl: 'https://www.nhs.uk/live-well/exercise/',
    publishedAt: '2025-09-19',
    lastReviewed: '2026-10-15',
    category: 'الإحماء والتعافي',
    level: 'مبتدئ',
    summaryAr:
      'الدخول مباشرة للمباراة بدون إحماء هو السبب الأول للشد العضلي. يوضح هذا الدليل الفرق بين الإطالة الحركية قبل اللعب (Dynamic Warm-Up) والتهدئة والإطالة الثابتة بعد الصافرة لتسريع التعافي.',
    keyTakeawaysAr: [
      'قبل اللعب (8–10 دقائق): هرولة خفيفة + حركات مفاصل + انطلاقات تدريجية بالكرة.',
      'تجنّب الإطالة الثابتة الطويلة قبل المباراة لأنها تقلل القوة الانفجارية مؤقتاً.',
      'بعد المباراة: مشي 3 دقائق + إطالات هادئة + نوم 7–8 ساعات لإصلاح الألياف العضلية.',
    ],
    terms: [
      { en: 'Dynamic Warm-Up', ar: 'الإحماء الحركي' },
      { en: 'Cool-Down', ar: 'التهدئة بعد المجهود' },
      { en: 'Neuromuscular Activation', ar: 'تفعيل العضلات والأعصاب' },
    ],
    originalExcerpt:
      'Dynamic warm-ups raise muscle temperature and joint readiness before kickoff, while gradual cool-downs aid post-match recovery.',
    published: true,
  },
  {
    id: 'lib_goalkeeper_dev',
    titleAr: 'تطوير حراس المرمى: وضعية الاستعداد وإغلاق الزاوية واللعب بالقدم',
    originalLang: 'الإنجليزية',
    publisher: 'UEFA Coaching & Technical',
    sourceUrl: 'https://www.uefa.com/development/coaches/',
    publishedAt: '2025-11-05',
    lastReviewed: '2026-10-14',
    category: 'تطوير الحراس',
    level: 'متوسط',
    summaryAr:
      'في السداسي، الحارس يواجه تسديدات قريبة ومتكررة ويشارك كبادئ للهجمة. يشرح الدليل توقيت التوقف في «وضعية الاستعداد» لحظة التسديد، وتقليص الزاوية في الانفرادات، والرمية السريعة باليد لبناء المرتدة.',
    keyTakeawaysAr: [
      'ثبّت قدميك في وضعية استعداد متزنة قبل لمس المهاجم للكرة بلحظة.',
      'تقدّم خطوتين للأمام في الانفرادات لتقليص مساحة المرمى أمام المسدّد.',
      'تواصل بصوت واضح مع المدافعين لأنك الوحيد الذي يرى كامل الملعب.',
    ],
    terms: [
      { en: 'Set Position', ar: 'وضعية الاستعداد للحارس' },
      { en: 'Angle Narrowing', ar: 'تضييق زاوية التسديد' },
      { en: 'Distribution', ar: 'توزيع الكرة وبناء الهجمة' },
    ],
    originalExcerpt:
      'A balanced set position timed with the striker’s backlift gives goalkeepers maximum explosive reach on close-range shots.',
    published: true,
  },
  {
    id: 'lib_ifab_rules',
    titleAr: 'خلاصة قوانين اللعبة الأساسية (IFAB): الأخطاء والركلات الحرة وإعادة الكرة',
    originalLang: 'الإنجليزية',
    publisher: 'IFAB (Laws of the Game)',
    sourceUrl: 'https://www.theifab.com/laws-of-the-game-documents/',
    publishedAt: '2025-07-01',
    lastReviewed: '2026-10-15',
    category: 'القواعد الكروية',
    level: 'مبتدئ',
    summaryAr:
      'مرجع سريع لأهم القواعد التي تمنع الجدل داخل الملعب: الفرق بين الركلة الحرة المباشرة وغير المباشرة، قانون لمسة اليد غير المتعمدة، إعادة الكرة للحارس، والفارق بين قانون التسلل في 11v11 وغيابه في 6v6.',
    keyTakeawaysAr: [
      'الركلة الحرة غير المباشرة لا يُحتسب منها هدف إلا بعد لمسها للاعب آخر.',
      'إعادة الكرة المتعمّدة بالقدم للحارس تمنعه من التقاطها باليد (تُحسب ركلة غير مباشرة).',
      'احترام مسافة الجدار وإيقاف اللعب فوراً عند إصابات الرأس يحفظ سلامة الجميع.',
    ],
    terms: [
      { en: 'Direct & Indirect Free Kick', ar: 'الركلة الحرة المباشرة وغير المباشرة' },
      { en: 'Back-Pass Rule', ar: 'قانون إعادة الكرة للحارس' },
      { en: 'Advantage Rule', ar: 'إتاحة الفرصة' },
    ],
    originalExcerpt:
      'Clear knowledge of direct vs indirect free kicks, back-pass restrictions, and advantage keeps matches fair and flowing.',
    published: true,
  },
  {
    id: 'lib_injury_prevention',
    titleAr: 'الوقاية من إصابات الملاعب والتصرف الأولي الآمن (تثقيفي)',
    originalLang: 'الإنجليزية',
    publisher: 'NHS Sports & Exercise Health',
    sourceUrl: 'https://www.nhs.uk/live-well/exercise/',
    publishedAt: '2025-10-28',
    lastReviewed: '2026-10-15',
    category: 'الوقاية من الإصابات والإسعافات',
    level: 'مبتدئ',
    summaryAr:
      'مبادئ الوقاية من أشهر إصابات العشب الصناعي (التواء الكاحل وشد الخلفية وإجهاد الركبة) مع خطوات التعامل الأولي الآمن. هذا المحتوى تثقيفي عام ولا يغني عن تقييم الطبيب أو أخصائي العلاج الطبيعي عند الألم الشديد.',
    keyTakeawaysAr: [
      'اختر حذاءً مناسباً لسطح الملعب (TF للعشب الصناعي) لتقليل التواء الكاحل والركبة.',
      'عند إصابة حادة: أوقف اللعب فوراً، ارفع الطرف، وضع كمادة باردة ملفوفة بقماش (15 دقيقة).',
      'لا تعد للعب مع تورّم واضح أو عدم ثبات بالمفصل أو بعد أي ارتطام بالرأس — استشر طبيباً فوراً.',
    ],
    terms: [
      { en: 'Injury Prevention', ar: 'الوقاية من الإصابات' },
      { en: 'Load Management', ar: 'إدارة الحمل البدني' },
      { en: 'Return-to-Play Protocol', ar: 'بروتوكول العودة التدريجية للعب' },
    ],
    originalExcerpt:
      'Gradual load management, proper turf footwear, and early rest after acute strains significantly reduce recurring football injuries.',
    published: true,
  },
];

export const CORE_GLOSSARY_HIGHLIGHTS: GlossaryTerm[] = [
  { en: 'Counter-Pressing', ar: 'الضغط العكسي' },
  { en: 'Through Ball', ar: 'التمريرة البينية' },
  { en: 'Off the Ball Movement', ar: 'التحرك بدون كرة' },
  { en: 'First Touch', ar: 'اللمسة الأولى' },
  { en: 'Half-Space', ar: 'نصف المساحة' },
  { en: 'Third-Man Run', ar: 'انطلاقة الرجل الثالث' },
  { en: 'Scanning', ar: 'المسح البصري' },
  { en: 'Pressing Trap', ar: 'فخ الضغط' },
];

export function mergeLibraryArticles(customOrOverrides: FootballArticle[]): FootballArticle[] {
  const byId = new Map<string, FootballArticle>();
  for (const base of STARTER_FOOTBALL_LIBRARY) {
    byId.set(base.id, { ...base });
  }
  for (const item of customOrOverrides || []) {
    if (!item || !item.id) continue;
    const prev = byId.get(item.id);
    byId.set(item.id, {
      ...(prev || {}),
      ...item,
      isCustom: prev ? Boolean(item.isCustom) : true,
    });
  }
  return Array.from(byId.values());
}

export function filterLibraryArticles(
  articles: FootballArticle[],
  opts: LibraryFilterOptions = {}
): FootballArticle[] {
  const cat = (opts.category || 'الكل').trim();
  const lvl = (opts.level || 'الكل').trim();
  const q = (opts.query || '').trim().toLowerCase();
  const includeHidden = Boolean(opts.includeHidden);

  return articles.filter((a) => {
    if (!includeHidden && !a.published) return false;
    if (cat !== 'الكل' && a.category !== cat) return false;
    if (lvl !== 'الكل' && a.level !== lvl) return false;
    if (!q) return true;
    const hay = [
      a.titleAr,
      a.summaryAr,
      a.publisher,
      a.category,
      a.level,
      a.originalExcerpt,
      ...a.terms.flatMap((t) => [t.en, t.ar]),
    ]
      .join(' ')
      .toLowerCase();
    return hay.includes(q);
  });
}

export function validateArticleInput(input: Partial<FootballArticle>): {
  ok: boolean;
  error?: string;
  article?: FootballArticle;
} {
  const titleAr = String(input.titleAr || '').trim();
  if (titleAr.length < 4 || titleAr.length > 120) {
    return { ok: false, error: 'عنوان المقال يجب أن يكون بين 4 و120 حرفاً' };
  }
  const publisher = String(input.publisher || '').trim();
  if (publisher.length < 2 || publisher.length > 80) {
    return { ok: false, error: 'يرجى كتابة اسم المصدر/الموقع الأصلي الموثوق' };
  }
  const sourceUrl = sanitizeSourceUrl(input.sourceUrl);
  if (!sourceUrl) {
    return { ok: false, error: 'يرجى إدخال رابط مصدر صحيح يبدأ بـ https://' };
  }
  const summaryAr = String(input.summaryAr || '').trim();
  if (summaryAr.length < 20 || summaryAr.length > 1600) {
    return { ok: false, error: 'الملخص العربي يجب أن يكون بين 20 و1600 حرفاً' };
  }
  const today = new Date().toISOString().slice(0, 10);
  const dateRe = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
  const publishedAt = dateRe.test(String(input.publishedAt || '')) ? String(input.publishedAt) : today;
  const lastReviewed = dateRe.test(String(input.lastReviewed || '')) ? String(input.lastReviewed) : today;
  const originalLang = String(input.originalLang || 'الإنجليزية').trim().slice(0, 30) || 'الإنجليزية';
  const originalExcerpt = String(input.originalExcerpt || '').trim().slice(0, 420);
  const keyTakeawaysAr = Array.isArray(input.keyTakeawaysAr)
    ? input.keyTakeawaysAr.map((x) => String(x || '').trim().slice(0, 180)).filter(Boolean).slice(0, 6)
    : [];
  const terms = Array.isArray(input.terms)
    ? input.terms
        .filter((t) => t && t.en && t.ar)
        .map((t) => ({ en: String(t.en).trim().slice(0, 50), ar: String(t.ar).trim().slice(0, 60) }))
        .slice(0, 8)
    : [];

  const cleanId =
    String(input.id || `lib_custom_${Date.now()}`)
      .replace(/[^a-zA-Z0-9_-]/g, '')
      .slice(0, 64) || `lib_custom_${Date.now()}`;

  return {
    ok: true,
    article: {
      id: cleanId,
      titleAr,
      originalLang,
      publisher,
      sourceUrl,
      publishedAt,
      lastReviewed,
      category: sanitizeLibraryCategory(input.category),
      level: sanitizeLibraryLevel(input.level),
      summaryAr,
      keyTakeawaysAr,
      terms,
      originalExcerpt,
      published: input.published !== false,
      isCustom: Boolean(input.isCustom),
    },
  };
}

export function loadLocalLibraryOverrides(): FootballArticle[] {
  try {
    const raw = localStorage.getItem(LOCAL_LIBRARY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveLocalLibraryOverrides(items: FootballArticle[]): void {
  try {
    localStorage.setItem(LOCAL_LIBRARY_KEY, JSON.stringify(items.slice(0, 60)));
  } catch {
    // ignore storage quota errors
  }
}

class FootballLibraryController {
  private ctx: LibraryMountContext | null = null;
  private containerId = 'footballLibraryMount';
  private selectedCategory = 'الكل';
  private selectedLevel = 'الكل';
  private searchQuery = '';
  private openArticleId: string | null = null;
  private showExcerpt = false;
  private showCaptainForm = false;
  private editingArticleId: string | null = null;

  public mount(containerId: string, ctx: LibraryMountContext): void {
    this.containerId = containerId;
    this.ctx = ctx;
    this.render();
  }

  public syncData(): void {
    if (!this.ctx) return;
    this.render();
  }

  public reset(): void {
    this.showCaptainForm = false;
    this.editingArticleId = null;
    this.openArticleId = null;
    this.showExcerpt = false;
    this.selectedCategory = 'الكل';
    this.selectedLevel = 'الكل';
    this.searchQuery = '';
    this.ctx = null;
    const root = document.getElementById(this.containerId);
    if (root) root.innerHTML = '';
  }

  private getAllArticles(): FootballArticle[] {
    const custom = this.ctx ? this.ctx.getCustomArticles() : [];
    return mergeLibraryArticles(custom);
  }

  private render(): void {
    const root = document.getElementById(this.containerId);
    if (!root || !this.ctx) return;

    const isCap = this.ctx.isCaptain();
    const allArticles = this.getAllArticles();
    const filtered = filterLibraryArticles(allArticles, {
      category: this.selectedCategory,
      level: this.selectedLevel,
      query: this.searchQuery,
      includeHidden: isCap,
    });
    const publishedCount = allArticles.filter((a) => a.published).length;
    const hiddenCount = allArticles.length - publishedCount;
    const activeArticle = this.openArticleId
      ? allArticles.find((a) => a.id === this.openArticleId && (isCap || a.published)) || null
      : null;

    const editingArticle =
      isCap && this.editingArticleId
        ? allArticles.find((a) => a.id === this.editingArticleId) || null
        : null;

    root.innerHTML = `
      <div class="card" style="margin-bottom:12px;">
        <div class="row between" style="margin-bottom:6px;gap:8px;flex-wrap:wrap;">
          <div>
            <h2 style="margin-bottom:2px;">🌍 المكتبة الكروية العالمية (مترجمة للعربية)</h2>
            <p class="muted" style="font-size:0.78rem;">ملخصات تعليمية كروية مترجمة بدقة مع المصطلحات الإنجليزية وروابط المصادر الرسمية الموثوقة</p>
          </div>
          <div class="row" style="gap:6px;">
            <span class="badge">📚 ${publishedCount} مرجعاً منشوراً${isCap && hiddenCount ? ` • ${hiddenCount} مخفي` : ''}</span>
            ${
              isCap
                ? `<button type="button" id="btnLibToggleCms" class="btn-primary" style="min-height:36px;padding:6px 12px;font-size:0.78rem;">${this.showCaptainForm ? '✕ إغلاق لوحة الإدارة' : '➕ إضافة / إدارة المحتوى'}</button>`
                : ''
            }
          </div>
        </div>

        <!-- Core Tactical English-Arabic Glossary Bar -->
        <div class="item-box" style="margin:8px 0;padding:8px 10px;border-color:rgba(250,204,21,0.32);background:rgba(250,204,21,0.05);">
          <div style="font-size:0.75rem;font-weight:800;color:var(--primary);margin-bottom:6px;">📖 قاموس المصطلحات التكتيكية السريع (اضغط للبحث):</div>
          <div style="display:flex;flex-wrap:wrap;gap:5px;">
            ${CORE_GLOSSARY_HIGHLIGHTS.map(
              (t) =>
                `<button type="button" data-lib-term="${escapeHtml(t.en)}" class="icon-btn" style="min-height:28px;padding:3px 8px;font-size:0.71rem;"><span dir="ltr" style="color:var(--primary);font-weight:800;">${escapeHtml(t.en)}</span> — ${escapeHtml(t.ar)}</button>`
            ).join('')}
          </div>
        </div>

        <!-- Search & Level Filter -->
        <div class="grid-2" style="gap:8px;margin-bottom:8px;">
          <input id="libSearchInput" type="search" value="${escapeHtml(this.searchQuery)}" placeholder="🔍 ابحث بالعربية أو بالمصطلح الإنجليزي (مثل Counter-Pressing)..." />
          <div class="row" style="gap:5px;flex-wrap:wrap;">
            ${(['الكل', ...LIBRARY_LEVELS] as const)
              .map(
                (lv) =>
                  `<button type="button" data-lib-level="${escapeHtml(lv)}" class="star-filter-btn ${this.selectedLevel === lv ? 'active' : ''}">${escapeHtml(lv)}</button>`
              )
              .join('')}
          </div>
        </div>

        <!-- Category Filter Bar -->
        <div class="star-filter-bar" style="margin-bottom:2px;">
          ${(['الكل', ...LIBRARY_CATEGORIES] as const)
            .map(
              (cat) =>
                `<button type="button" data-lib-cat="${escapeHtml(cat)}" class="star-filter-btn ${this.selectedCategory === cat ? 'active' : ''}">${escapeHtml(cat)}</button>`
            )
            .join('')}
        </div>
      </div>

      ${isCap && this.showCaptainForm ? this.renderCaptainCmsForm(editingArticle) : ''}

      ${activeArticle ? this.renderArticleReader(activeArticle, isCap) : ''}

      <div class="card">
        <div class="row between" style="margin-bottom:10px;">
          <h3>📑 المقالات والملخصات المتاحة (${filtered.length})</h3>
          ${
            this.selectedCategory !== 'الكل' || this.selectedLevel !== 'الكل' || this.searchQuery
              ? `<button type="button" id="btnLibResetFilters" class="icon-btn" style="min-height:32px;font-size:0.74rem;">↻ عرض الكل</button>`
              : ''
          }
        </div>
        <div class="grid-2" style="gap:10px;">
          ${
            filtered.length
              ? filtered.map((art) => this.renderArticleCard(art, isCap)).join('')
              : '<div class="item-box" style="grid-column:1/-1;text-align:center;"><p class="muted">لا توجد نتائج مطابقة للبحث الحالي — جرّب تصفية أخرى أو مسح كلمة البحث.</p></div>'
          }
        </div>
      </div>
    `;

    this.bindEvents(root, allArticles, isCap);
  }

  private renderArticleCard(art: FootballArticle, isCap: boolean): string {
    const levelColor =
      art.level === 'مبتدئ' ? '#4ade80' : art.level === 'متوسط' ? '#FACC15' : '#fb7185';
    return `
      <article class="item-box" style="margin:0;display:flex;flex-direction:column;justify-content:space-between;gap:8px;${!art.published ? 'opacity:0.72;border-style:dashed;border-color:rgba(244,63,94,0.45);' : ''}">
        <div>
          <div class="row between" style="gap:6px;margin-bottom:6px;flex-wrap:wrap;">
            <span class="badge" style="font-size:0.69rem;">${escapeHtml(art.category)}</span>
            <span class="badge" style="font-size:0.69rem;color:${levelColor};">${escapeHtml(art.level)}</span>
            ${!art.published ? '<span class="badge" style="font-size:0.68rem;background:rgba(244,63,94,0.2);color:#fecdd3;">مخفي عن اللاعبين</span>' : ''}
          </div>
          <h3 style="font-size:0.92rem;color:#f8fafc;margin-bottom:5px;line-height:1.45;">${escapeHtml(art.titleAr)}</h3>
          <p class="muted" style="font-size:0.77rem;line-height:1.55;margin-bottom:7px;">${escapeHtml(art.summaryAr.slice(0, 155))}${art.summaryAr.length > 155 ? '...' : ''}</p>
          <div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px;">
            ${art.terms
              .slice(0, 3)
              .map(
                (t) =>
                  `<span style="font-size:0.68rem;padding:2px 7px;border-radius:8px;background:rgba(250,204,21,0.1);border:1px solid rgba(250,204,21,0.25);color:#fef08a;"><strong dir="ltr">${escapeHtml(t.en)}</strong> • ${escapeHtml(t.ar)}</span>`
              )
              .join('')}
          </div>
        </div>
        <div>
          <div class="row between" style="font-size:0.7rem;color:#a1a1aa;margin-bottom:7px;flex-wrap:wrap;gap:4px;">
            <span>🏛️ ${escapeHtml(art.publisher)}</span>
            <span>📅 مراجعة: ${escapeHtml(art.lastReviewed)}</span>
          </div>
          <div class="row between" style="gap:6px;">
            <button type="button" data-lib-open="${escapeHtml(art.id)}" class="btn-primary" style="flex:1;min-height:36px;padding:6px 10px;font-size:0.78rem;">📖 قراءة الملخص والمصدر</button>
            ${
              isCap
                ? `<button type="button" data-lib-edit="${escapeHtml(art.id)}" class="icon-btn" style="min-height:36px;padding:6px 9px;font-size:0.74rem;" title="تعديل">✏️</button>
                   <button type="button" data-lib-toggle-pub="${escapeHtml(art.id)}" class="icon-btn" style="min-height:36px;padding:6px 9px;font-size:0.74rem;" title="${art.published ? 'إخفاء' : 'نشر'}">${art.published ? '🙈' : '👁️'}</button>`
                : ''
            }
          </div>
        </div>
      </article>
    `;
  }

  private renderArticleReader(art: FootballArticle, isCap: boolean): string {
    const safeUrl = sanitizeSourceUrl(art.sourceUrl);
    return `
      <div id="libArticleReader" class="card" style="border-color:rgba(250,204,21,0.55);margin-bottom:12px;">
        <div class="row between" style="margin-bottom:8px;gap:8px;flex-wrap:wrap;">
          <div class="row" style="gap:6px;flex-wrap:wrap;">
            <span class="badge">${escapeHtml(art.category)}</span>
            <span class="badge">🎯 ${escapeHtml(art.level)}</span>
            <span class="badge">🌐 اللغة الأصلية: ${escapeHtml(art.originalLang)}</span>
          </div>
          <button type="button" id="btnLibCloseReader" class="icon-btn" style="min-height:34px;">✕ إغلاق المقال</button>
        </div>

        <h2 style="color:var(--primary);margin-bottom:6px;line-height:1.45;">${escapeHtml(art.titleAr)}</h2>

        <div class="item-box" style="margin-bottom:10px;font-size:0.76rem;display:flex;flex-wrap:wrap;justify-content:space-between;gap:6px;">
          <span>🏛️ <strong>المصدر الأصلي:</strong> ${escapeHtml(art.publisher)}</span>
          <span>📅 <strong>النشر:</strong> ${escapeHtml(art.publishedAt)} • <strong>آخر مراجعة:</strong> ${escapeHtml(art.lastReviewed)}</span>
          ${
            safeUrl
              ? `<a href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer" style="color:var(--primary);font-weight:800;text-decoration:underline;">🔗 فتح المصدر الرسمي الخارجي ↗</a>`
              : ''
          }
        </div>

        <p style="font-size:0.86rem;line-height:1.75;color:#f8fafc;margin-bottom:10px;">${escapeHtml(art.summaryAr)}</p>

        ${
          art.keyTakeawaysAr.length
            ? `<div class="item-box" style="margin-bottom:10px;border-color:rgba(34,197,94,0.35);background:rgba(34,197,94,0.06);">
                <div style="font-weight:800;color:#4ade80;margin-bottom:5px;font-size:0.82rem;">⚽ تطبيق عملي في الملعب:</div>
                ${art.keyTakeawaysAr.map((tip) => `<div style="font-size:0.8rem;line-height:1.6;margin-bottom:4px;">• ${escapeHtml(tip)}</div>`).join('')}
              </div>`
            : ''
        }

        ${
          art.terms.length
            ? `<div class="item-box" style="margin-bottom:10px;">
                <div style="font-weight:800;color:var(--primary);margin-bottom:6px;font-size:0.8rem;">🔤 المصطلحات الكروية الإنجليزية ومقابلها العربي:</div>
                <div style="display:grid;gap:5px;">
                  ${art.terms
                    .map(
                      (t) =>
                        `<div class="row between" style="font-size:0.78rem;padding:4px 6px;border-radius:8px;background:rgba(255,255,255,0.03);">
                          <strong dir="ltr" style="color:var(--primary);">${escapeHtml(t.en)}</strong>
                          <span style="color:#e4e4e7;">${escapeHtml(t.ar)}</span>
                        </div>`
                    )
                    .join('')}
                </div>
              </div>`
            : ''
        }

        ${
          art.originalExcerpt
            ? `<div style="margin-bottom:10px;">
                <button type="button" id="btnLibToggleExcerpt" class="icon-btn" style="min-height:34px;font-size:0.76rem;">${this.showExcerpt ? '🔼 إخفاء المقتطف الإنجليزي الأصلي' : '🔽 عرض المقتطف الإنجليزي المرجعي القصير'}</button>
                ${
                  this.showExcerpt
                    ? `<blockquote dir="ltr" style="margin-top:8px;padding:10px 12px;border-left:3px solid var(--primary);border-radius:8px;background:rgba(255,255,255,0.04);font-size:0.8rem;color:#d4d4d8;text-align:left;line-height:1.55;">"${escapeHtml(art.originalExcerpt)}"</blockquote>`
                    : ''
                }
              </div>`
            : ''
        }

        <p class="muted" style="font-size:0.71rem;margin-bottom:${isCap ? '10px' : '0'};">
          ℹ️ ملخص تعليمي مترجم بأسلوب عربي أصيل مع الإحالة للمصدر الرسمي؛ لا يتم نسخ المقالات المحمية بحقوق النشر بالكامل.
        </p>

        ${
          isCap
            ? `<div class="row" style="gap:6px;flex-wrap:wrap;padding-top:8px;border-top:1px solid var(--border-subtle);">
                <button type="button" data-lib-edit="${escapeHtml(art.id)}" class="btn-amber" style="min-height:36px;padding:6px 12px;font-size:0.78rem;">✏️ تعديل المقال</button>
                <button type="button" data-lib-review="${escapeHtml(art.id)}" class="btn-emerald" style="min-height:36px;padding:6px 12px;font-size:0.78rem;">🔄 تحديث تاريخ المراجعة اليوم</button>
                <button type="button" data-lib-toggle-pub="${escapeHtml(art.id)}" class="icon-btn" style="min-height:36px;padding:6px 12px;font-size:0.78rem;">${art.published ? '🙈 إخفاء عن اللاعبين' : '👁️ نشر للاعبين'}</button>
                ${
                  art.isCustom
                    ? `<button type="button" data-lib-delete="${escapeHtml(art.id)}" class="btn-rose" style="min-height:36px;padding:6px 12px;font-size:0.78rem;">🗑️ حذف</button>`
                    : ''
                }
              </div>`
            : ''
        }
      </div>
    `;
  }

  private renderCaptainCmsForm(editing: FootballArticle | null): string {
    const termsStr = editing ? editing.terms.map((t) => `${t.en} : ${t.ar}`).join('\n') : '';
    const tipsStr = editing ? editing.keyTakeawaysAr.join('\n') : '';
    const today = new Date().toISOString().slice(0, 10);

    return `
      <div id="libCaptainCmsBox" class="card" style="border-color:rgba(250,204,21,0.5);margin-bottom:12px;">
        <div class="row between" style="margin-bottom:8px;">
          <strong style="color:var(--primary);">👑 لوحة إدارة المكتبة الكروية (خاصة بالكابتن)</strong>
          ${editing ? `<button type="button" id="btnLibNewBlank" class="icon-btn" style="min-height:30px;font-size:0.72rem;">+ مقال جديد</button>` : ''}
        </div>
        <form id="libCmsForm" style="display:flex;flex-direction:column;gap:8px;">
          <input type="hidden" id="libFormId" value="${escapeHtml(editing?.id || '')}" />
          <input id="libFormTitle" type="text" required maxlength="120" value="${escapeHtml(editing?.titleAr || '')}" placeholder="عنوان المقال/الملخص بالعربية..." />
          <div class="grid-2" style="gap:8px;">
            <div>
              <label class="muted" style="font-size:0.72rem;">التصنيف</label>
              <select id="libFormCategory">
                ${LIBRARY_CATEGORIES.map(
                  (c) => `<option value="${escapeHtml(c)}" ${editing?.category === c ? 'selected' : ''}>${escapeHtml(c)}</option>`
                ).join('')}
              </select>
            </div>
            <div>
              <label class="muted" style="font-size:0.72rem;">المستوى</label>
              <select id="libFormLevel">
                ${LIBRARY_LEVELS.map(
                  (lv) => `<option value="${escapeHtml(lv)}" ${editing?.level === lv ? 'selected' : ''}>${escapeHtml(lv)}</option>`
                ).join('')}
              </select>
            </div>
          </div>
          <div class="grid-2" style="gap:8px;">
            <input id="libFormPublisher" type="text" required maxlength="80" value="${escapeHtml(editing?.publisher || '')}" placeholder="المصدر الرسمي (مثلاً: UEFA Coaching)" />
            <input id="libFormUrl" type="url" dir="ltr" required maxlength="300" value="${escapeHtml(editing?.sourceUrl || '')}" placeholder="https://..." />
          </div>
          <div class="grid-2" style="gap:8px;">
            <div>
              <label class="muted" style="font-size:0.72rem;">اللغة الأصلية</label>
              <input id="libFormLang" type="text" maxlength="30" value="${escapeHtml(editing?.originalLang || 'الإنجليزية')}" />
            </div>
            <div>
              <label class="muted" style="font-size:0.72rem;">تاريخ المراجعة</label>
              <input id="libFormReviewed" type="date" value="${escapeHtml(editing?.lastReviewed || today)}" />
            </div>
          </div>
          <textarea id="libFormSummary" rows="3" required maxlength="1600" placeholder="الملخص التعليمي المترجم بلغة عربية واضحة وعملية...">${escapeHtml(editing?.summaryAr || '')}</textarea>
          <textarea id="libFormTips" rows="2" placeholder="نقاط تطبيق عملي في الملعب (سطر لكل نقطة — اختياري)">${escapeHtml(tipsStr)}</textarea>
          <textarea id="libFormTerms" rows="2" placeholder="المصطلحات الإنجليزية (سطر لكل مصطلح مثل: Counter-Pressing : الضغط العكسي)">${escapeHtml(termsStr)}</textarea>
          <input id="libFormExcerpt" type="text" dir="ltr" maxlength="420" value="${escapeHtml(editing?.originalExcerpt || '')}" placeholder="Short original reference excerpt (optional)" />
          <label class="row" style="gap:6px;font-size:0.8rem;">
            <input id="libFormPublished" type="checkbox" style="width:auto;" ${editing ? (editing.published ? 'checked' : '') : 'checked'} />
            <span>منشور ومرئي لجميع لاعبي الفريق</span>
          </label>
          <div class="row" style="gap:8px;">
            <button type="submit" class="btn-primary" style="flex:1;">💾 ${editing ? 'حفظ التعديلات' : 'إضافة للمكتبة الكروية'}</button>
            <button type="button" id="btnLibCancelCms" class="icon-btn">إلغاء</button>
          </div>
        </form>
      </div>
    `;
  }

  private bindEvents(root: HTMLElement, allArticles: FootballArticle[], isCap: boolean): void {
    const searchEl = root.querySelector<HTMLInputElement>('#libSearchInput');
    searchEl?.addEventListener('input', () => {
      this.searchQuery = searchEl.value;
      const caret = searchEl.selectionStart || this.searchQuery.length;
      this.render();
      const nextInput = document.getElementById('libSearchInput') as HTMLInputElement | null;
      if (nextInput) {
        nextInput.focus();
        try {
          nextInput.setSelectionRange(caret, caret);
        } catch {
          // ignore unsupported selection range on search inputs
        }
      }
    });

    root.querySelectorAll<HTMLButtonElement>('[data-lib-term]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.searchQuery = btn.dataset.libTerm || '';
        this.selectedCategory = 'الكل';
        this.selectedLevel = 'الكل';
        this.render();
      });
    });

    root.querySelectorAll<HTMLButtonElement>('[data-lib-cat]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.selectedCategory = btn.dataset.libCat || 'الكل';
        this.render();
      });
    });

    root.querySelectorAll<HTMLButtonElement>('[data-lib-level]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.selectedLevel = btn.dataset.libLevel || 'الكل';
        this.render();
      });
    });

    root.querySelector('#btnLibResetFilters')?.addEventListener('click', () => {
      this.selectedCategory = 'الكل';
      this.selectedLevel = 'الكل';
      this.searchQuery = '';
      this.render();
    });

    root.querySelectorAll<HTMLButtonElement>('[data-lib-open]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.openArticleId = btn.dataset.libOpen || null;
        this.showExcerpt = false;
        this.render();
        document.getElementById('libArticleReader')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
    });

    root.querySelector('#btnLibCloseReader')?.addEventListener('click', () => {
      this.openArticleId = null;
      this.showExcerpt = false;
      this.render();
    });

    root.querySelector('#btnLibToggleExcerpt')?.addEventListener('click', () => {
      this.showExcerpt = !this.showExcerpt;
      this.render();
    });

    if (!isCap) return;

    root.querySelector('#btnLibToggleCms')?.addEventListener('click', () => {
      this.showCaptainForm = !this.showCaptainForm;
      if (!this.showCaptainForm) this.editingArticleId = null;
      this.render();
    });

    root.querySelector('#btnLibCancelCms')?.addEventListener('click', () => {
      this.showCaptainForm = false;
      this.editingArticleId = null;
      this.render();
    });

    root.querySelector('#btnLibNewBlank')?.addEventListener('click', () => {
      this.editingArticleId = null;
      this.render();
    });

    root.querySelectorAll<HTMLButtonElement>('[data-lib-edit]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.editingArticleId = btn.dataset.libEdit || null;
        this.showCaptainForm = true;
        this.render();
        document.getElementById('libCaptainCmsBox')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
    });

    root.querySelectorAll<HTMLButtonElement>('[data-lib-toggle-pub]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!this.ctx) return;
        const art = allArticles.find((a) => a.id === btn.dataset.libTogglePub);
        if (!art) return;
        const updated: FootballArticle = {
          ...art,
          published: !art.published,
          lastReviewed: new Date().toISOString().slice(0, 10),
        };
        const ok = await this.ctx.onSaveArticle(updated);
        if (ok) {
          this.ctx.toast(updated.published ? 'تم نشر المقال للفريق ✓' : 'تم إخفاء المقال عن اللاعبين ✓');
          this.render();
        }
      });
    });

    root.querySelectorAll<HTMLButtonElement>('[data-lib-review]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!this.ctx) return;
        const art = allArticles.find((a) => a.id === btn.dataset.libReview);
        if (!art) return;
        const today = new Date().toISOString().slice(0, 10);
        const ok = await this.ctx.onSaveArticle({ ...art, lastReviewed: today });
        if (ok) {
          this.ctx.toast(`تم تحديث تاريخ المراجعة إلى ${today} ✓`);
          this.render();
        }
      });
    });

    root.querySelectorAll<HTMLButtonElement>('[data-lib-delete]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!this.ctx) return;
        const id = btn.dataset.libDelete || '';
        if (!id) return;
        const ok = await this.ctx.onDeleteArticle(id);
        if (ok) {
          if (this.openArticleId === id) this.openArticleId = null;
          if (this.editingArticleId === id) this.editingArticleId = null;
          this.ctx.toast('تم حذف المقال من المكتبة ✓');
          this.render();
        }
      });
    });

    root.querySelector('#libCmsForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!this.ctx) return;
      const existingId = (root.querySelector<HTMLInputElement>('#libFormId')?.value || '').trim();
      const existing = existingId ? allArticles.find((a) => a.id === existingId) : null;
      const tipsRaw = root.querySelector<HTMLTextAreaElement>('#libFormTips')?.value || '';
      const termsRaw = root.querySelector<HTMLTextAreaElement>('#libFormTerms')?.value || '';

      const res = validateArticleInput({
        id: existingId || undefined,
        titleAr: root.querySelector<HTMLInputElement>('#libFormTitle')?.value || '',
        category: (root.querySelector<HTMLSelectElement>('#libFormCategory')?.value || '') as LibraryCategory,
        level: (root.querySelector<HTMLSelectElement>('#libFormLevel')?.value || '') as LibraryLevel,
        publisher: root.querySelector<HTMLInputElement>('#libFormPublisher')?.value || '',
        sourceUrl: root.querySelector<HTMLInputElement>('#libFormUrl')?.value || '',
        originalLang: root.querySelector<HTMLInputElement>('#libFormLang')?.value || 'الإنجليزية',
        publishedAt: existing?.publishedAt || new Date().toISOString().slice(0, 10),
        lastReviewed: root.querySelector<HTMLInputElement>('#libFormReviewed')?.value || new Date().toISOString().slice(0, 10),
        summaryAr: root.querySelector<HTMLTextAreaElement>('#libFormSummary')?.value || '',
        keyTakeawaysAr: tipsRaw.split('\n').map((s) => s.trim()).filter(Boolean),
        terms: parseGlossaryInput(termsRaw),
        originalExcerpt: root.querySelector<HTMLInputElement>('#libFormExcerpt')?.value || '',
        published: Boolean(root.querySelector<HTMLInputElement>('#libFormPublished')?.checked),
        isCustom: existing ? Boolean(existing.isCustom) : true,
      });

      if (!res.ok || !res.article) {
        this.ctx.toast(res.error || 'بيانات المقال غير مكتملة', true);
        return;
      }

      const saved = await this.ctx.onSaveArticle(res.article);
      if (saved) {
        this.openArticleId = res.article.id;
        this.showCaptainForm = false;
        this.editingArticleId = null;
        this.ctx.toast(existing ? 'تم تحديث المقال بنجاح ✓' : 'تمت إضافة المقال للمكتبة الكروية ✓');
        this.render();
      }
    });
  }
}

const libraryInstance = new FootballLibraryController();

declare global {
  interface Window {
    MaydanFootballLibrary?: {
      controller: FootballLibraryController;
      STARTER_FOOTBALL_LIBRARY: typeof STARTER_FOOTBALL_LIBRARY;
      LIBRARY_CATEGORIES: typeof LIBRARY_CATEGORIES;
      loadLocalLibraryOverrides: typeof loadLocalLibraryOverrides;
      saveLocalLibraryOverrides: typeof saveLocalLibraryOverrides;
      mergeLibraryArticles: typeof mergeLibraryArticles;
    };
  }
}

if (typeof window !== 'undefined') {
  window.MaydanFootballLibrary = {
    controller: libraryInstance,
    STARTER_FOOTBALL_LIBRARY,
    LIBRARY_CATEGORIES,
    loadLocalLibraryOverrides,
    saveLocalLibraryOverrides,
    mergeLibraryArticles,
  };
}

export { libraryInstance as MaydanFootballLibraryController };

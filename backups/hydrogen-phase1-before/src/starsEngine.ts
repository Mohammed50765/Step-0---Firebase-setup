import { SKILL_KEYS, type SkillKey, type SkillsMap } from './security';

export type StarCategory = 'حراس مرمى' | 'مدافعون وأظهرة' | 'لاعبو وسط' | 'أجنحة ومهاجمون';

export interface GlobalStar {
  id: string;
  name: string;
  shortPos: string;
  primaryPos: 'حارس مرمى' | 'مدافع' | 'لاعب وسط' | 'جناح' | 'مهاجم';
  category: StarCategory;
  archetype: string;
  playStyle: string;
  signature6v6: string;
  initials: string;
  accent: string;
  skills: SkillsMap;
}

export const SKILL_LABELS_AR: Record<SkillKey, string> = {
  speed: 'السرعة',
  shooting: 'التسديد',
  passing: 'التمرير',
  dribbling: 'المراوغة',
  defending: 'الدفاع',
  stamina: 'اللياقة',
  vision: 'الرؤية',
  teamwork: 'اللعب الجماعي',
  control: 'التحكم',
  positioning: 'التمركز',
};

export const SKILL_TIPS_6V6: Record<SkillKey, string> = {
  speed: 'ركّز على أول 3 خطوات انفجارية عند التحول للهجمة المرتدة في المساحات الصغيرة.',
  shooting: 'سدد بالزوايا الأرضية السريعة من لمسة واحدة قبل أن يغلق الحارس الزاوية.',
  passing: 'اعتمد على تمريرة «خذ وهات» (Wall Pass) السريعة لكسر ضغط الخصم فوراً.',
  dribbling: 'استخدم تمويه الجسد ولمسة باطن القدم للمرور في المواجهات الفردية 1 ضد 1.',
  defending: 'اقطع زاوية التمرير أولاً ولا تندفع مبكراً أمام المهاجم في الملعب السداسي.',
  stamina: 'وزّع مجهودك بين الركض السريع والرجوع المنظّم لتبقى جاهزاً في آخر 10 دقائق.',
  vision: 'ارفع رأسك قبل استلام الكرة بلمح البصر لتعرف أين يتحرك زميلك الحر.',
  teamwork: 'تحرك دائماً لفتح مثلث تمرير لزميلك صاحب الكرة ولا تكتفِ بالوقوف.',
  control: 'استلم الكرة بأسفل القدم (الصول) لتثبيتها فوراً وتوجيهها نحو المساحة الفارغة.',
  positioning: 'توقّع ارتداد الكرة وتمركز بين خطوط الخصم لاستغلال غياب قانون التسلل في 6v6.',
};

export const GLOBAL_STARS_30: GlobalStar[] = [
  // ==================== 5 حراس مرمى ====================
  {
    id: 'courtois',
    name: 'تيبو كورتوا',
    shortPos: 'GK',
    primaryPos: 'حارس مرمى',
    category: 'حراس مرمى',
    archetype: 'العملاق السدّ المنيع',
    playStyle: 'إغلاق الزوايا الصعبة وردة فعل استثنائية في الانفرادات',
    signature6v6: 'في السداسي: تقدّم خطوتين لتقليص زاوية المهاجم واعتمد على رد الفعل السريع بالقدم.',
    initials: 'تك',
    accent: '#38bdf8',
    skills: { speed: 5, shooting: 3, passing: 6, dribbling: 4, defending: 10, stamina: 7, vision: 7, teamwork: 8, control: 7, positioning: 10 },
  },
  {
    id: 'alisson',
    name: 'أليسون بيكر',
    shortPos: 'GK',
    primaryPos: 'حارس مرمى',
    category: 'حراس مرمى',
    archetype: 'الحارس الهادئ القاتل',
    playStyle: 'هدوء جليدي في الانفرادات وتمريرات طولية تبدأ المرتدة فوراً',
    signature6v6: 'في السداسي: ارمِ الكرة بيدك بسرعة للمهاجم خلف الدفاع (لا يوجد تسلل!).',
    initials: 'أب',
    accent: '#f59e0b',
    skills: { speed: 6, shooting: 4, passing: 9, dribbling: 6, defending: 9, stamina: 7, vision: 9, teamwork: 9, control: 8, positioning: 10 },
  },
  {
    id: 'neuer',
    name: 'مانويل نوير',
    shortPos: 'GK',
    primaryPos: 'حارس مرمى',
    category: 'حراس مرمى',
    archetype: 'الحارس الليبرو',
    playStyle: 'اللعب بالقدم كمدافع إضافي وبناء اللعب من الخلف بشجاعة',
    signature6v6: 'في السداسي: كن اللاعب السادس في التمرير لفك ضغط الخصم وفتح مساحات للأمام.',
    initials: 'من',
    accent: '#ef4444',
    skills: { speed: 6, shooting: 5, passing: 9, dribbling: 7, defending: 9, stamina: 8, vision: 9, teamwork: 9, control: 9, positioning: 9 },
  },
  {
    id: 'ter_stegen',
    name: 'مارك أندريه تير شتيغن',
    shortPos: 'GK',
    primaryPos: 'حارس مرمى',
    category: 'حراس مرمى',
    archetype: 'صانع اللعب من المرمى',
    playStyle: 'تمريرات أرضية دقيقة تحت الضغط وتصديات قريبة مذهلة',
    signature6v6: 'في السداسي: استخدم التمريرات القصيرة الهادئة للمدافعين ولا تشتّت الكرة عشوائياً.',
    initials: 'تش',
    accent: '#a855f7',
    skills: { speed: 5, shooting: 4, passing: 10, dribbling: 7, defending: 9, stamina: 7, vision: 9, teamwork: 9, control: 9, positioning: 9 },
  },
  {
    id: 'donnarumma',
    name: 'جانلويجي دوناروما',
    shortPos: 'GK',
    primaryPos: 'حارس مرمى',
    category: 'حراس مرمى',
    archetype: 'حارس اللحظات الكبرى',
    playStyle: 'ارتقاء هائل وتغطية كاملة للمرمى أمام التسديدات القوية',
    signature6v6: 'في السداسي: ثبّت قدميك لحظة التسديد وانقضّ بسرعة على الكرات الأرضية القوية.',
    initials: 'جد',
    accent: '#22c55e',
    skills: { speed: 6, shooting: 3, passing: 6, dribbling: 5, defending: 10, stamina: 8, vision: 7, teamwork: 8, control: 7, positioning: 9 },
  },

  // ==================== 8 مدافعون وأظهرة ====================
  {
    id: 'van_dijk',
    name: 'فيرجيل فان دايك',
    shortPos: 'CB',
    primaryPos: 'مدافع',
    category: 'مدافعون وأظهرة',
    archetype: 'القائد الصخرة',
    playStyle: 'قراءة مبكرة للهجمة وهدوء كامل وتمريرة قطرية دقيقة',
    signature6v6: 'في السداسي: وجّه زملاءك بصوتك واقطع التمريرة قبل وصولها للمهاجم.',
    initials: 'فد',
    accent: '#ef4444',
    skills: { speed: 8, shooting: 6, passing: 8, dribbling: 6, defending: 10, stamina: 8, vision: 8, teamwork: 9, control: 8, positioning: 10 },
  },
  {
    id: 'saliba',
    name: 'ويليام ساليبا',
    shortPos: 'CB',
    primaryPos: 'مدافع',
    category: 'مدافعون وأظهرة',
    archetype: 'المدافع الأنيق',
    playStyle: 'استخلاص نظيف بدون أخطاء وهدوء مذهل بالكرة تحت الضغط',
    signature6v6: 'في السداسي: تحكّم بالكرة بهدوء ثم مرّر مباشرة للاعب الوسط المتحرر.',
    initials: 'وس',
    accent: '#f97316',
    skills: { speed: 9, shooting: 5, passing: 8, dribbling: 7, defending: 10, stamina: 8, vision: 8, teamwork: 9, control: 8, positioning: 9 },
  },
  {
    id: 'ruben_dias',
    name: 'روبن دياز',
    shortPos: 'CB',
    primaryPos: 'مدافع',
    category: 'مدافعون وأظهرة',
    archetype: 'جنرال خط الدفاع',
    playStyle: 'التزام تكتيكي صارم وبلوك فدائي أمام التسديدات',
    signature6v6: 'في السداسي: حافظ على توازن خط الدفاع وغطِّ المساحة خلف زملائك المندفعين.',
    initials: 'رد',
    accent: '#38bdf8',
    skills: { speed: 7, shooting: 5, passing: 8, dribbling: 6, defending: 10, stamina: 9, vision: 8, teamwork: 10, control: 8, positioning: 10 },
  },
  {
    id: 'rudiger',
    name: 'أنطونيو روديغر',
    shortPos: 'CB',
    primaryPos: 'مدافع',
    category: 'مدافعون وأظهرة',
    archetype: 'المحارب الشرس',
    playStyle: 'قوة بدنية، سرعة ارتداد عالية، ورقابة لصيقة لا ترحم',
    signature6v6: 'في السداسي: الزم مهاجم الخصم الأخطر كظله ولا تعطه مساحة للاستدارة.',
    initials: 'أر',
    accent: '#eab308',
    skills: { speed: 9, shooting: 6, passing: 7, dribbling: 6, defending: 9, stamina: 9, vision: 7, teamwork: 8, control: 7, positioning: 9 },
  },
  {
    id: 'araujo',
    name: 'رونالد أراوخو',
    shortPos: 'CB',
    primaryPos: 'مدافع',
    category: 'مدافعون وأظهرة',
    archetype: 'الحاجز الفولاذي',
    playStyle: 'تفوق بدني في الالتحامات وسرعة فائقة في إيقاف الأجنحة',
    signature6v6: 'في السداسي: استغل سرعتك لإغلاق المرتدات الطويلة وحماية ظهر الفريق.',
    initials: 'رأ',
    accent: '#6366f1',
    skills: { speed: 9, shooting: 6, passing: 6, dribbling: 6, defending: 9, stamina: 9, vision: 7, teamwork: 8, control: 7, positioning: 9 },
  },
  {
    id: 'hakimi',
    name: 'أشرف حكيمي',
    shortPos: 'RB',
    primaryPos: 'مدافع',
    category: 'مدافعون وأظهرة',
    archetype: 'الظهير الصاروخي',
    playStyle: 'انطلاقات نارية على الطرف مع مساهمة هجومية ودفاعية مستمرة',
    signature6v6: 'في السداسي: افتح عرض الملعب على اليمين ثم اخترق بسرعة خلف الدفاع.',
    initials: 'أح',
    accent: '#22c55e',
    skills: { speed: 10, shooting: 7, passing: 8, dribbling: 8, defending: 8, stamina: 10, vision: 8, teamwork: 8, control: 8, positioning: 8 },
  },
  {
    id: 'dimarco',
    name: 'فيديريكو ديماركو',
    shortPos: 'LB',
    primaryPos: 'مدافع',
    category: 'مدافعون وأظهرة',
    archetype: 'القدم اليسرى الذهبية',
    playStyle: 'عرضيات وتمريرات متقنة وتسديدات مفاجئة من مسافة متوسطة',
    signature6v6: 'في السداسي: استثمر قدمك في التمريرات القطرية والتسديد المباغت من الأطراف.',
    initials: 'فد',
    accent: '#3b82f6',
    skills: { speed: 8, shooting: 8, passing: 9, dribbling: 8, defending: 8, stamina: 9, vision: 9, teamwork: 9, control: 8, positioning: 8 },
  },
  {
    id: 'theo_hernandez',
    name: 'ثيو هيرنانديز',
    shortPos: 'LB',
    primaryPos: 'مدافع',
    category: 'مدافعون وأظهرة',
    archetype: 'قطار الجبهة اليسرى',
    playStyle: 'اختراقات طولية بقوة وسرعة مذهلة تخلخل أي تنظيم دفاعي',
    signature6v6: 'في السداسي: انطلق بالكرة للأمام عندما ينفتح الممر وسدّد بقوة نحو الزاوية البعيدة.',
    initials: 'ثه',
    accent: '#f43f5e',
    skills: { speed: 10, shooting: 8, passing: 7, dribbling: 8, defending: 8, stamina: 9, vision: 7, teamwork: 8, control: 8, positioning: 8 },
  },

  // ==================== 8 لاعبو وسط ====================
  {
    id: 'pedri',
    name: 'بيدري',
    shortPos: 'CM',
    primaryPos: 'لاعب وسط',
    category: 'لاعبو وسط',
    archetype: 'الساحر في المساحات الضيقة',
    playStyle: 'دوران ناعم بالكرة ورؤية فذة وتمريرات تكسر التكتلات',
    signature6v6: 'في السداسي: استلم بين الخطوط واصنع الفارق بلمسة واحدة ذكية لزميلك.',
    initials: 'بد',
    accent: '#ec4899',
    skills: { speed: 8, shooting: 7, passing: 9, dribbling: 10, defending: 7, stamina: 9, vision: 10, teamwork: 10, control: 10, positioning: 9 },
  },
  {
    id: 'de_bruyne',
    name: 'كيفن دي بروين',
    shortPos: 'CAM',
    primaryPos: 'لاعب وسط',
    category: 'لاعبو وسط',
    archetype: 'مهندس التمريرات الحاسمة',
    playStyle: 'تمريرات بينية خارقة وتسديدات متقنة بكلتا القدمين',
    signature6v6: 'في السداسي: ابحث عن التمريرة الحاسمة السريعة قبل أن يتمركز دفاع الخصم.',
    initials: 'دب',
    accent: '#38bdf8',
    skills: { speed: 7, shooting: 9, passing: 10, dribbling: 8, defending: 6, stamina: 8, vision: 10, teamwork: 9, control: 9, positioning: 9 },
  },
  {
    id: 'kroos',
    name: 'توني كروس',
    shortPos: 'CM',
    primaryPos: 'لاعب وسط',
    category: 'لاعبو وسط',
    archetype: 'المايسترو الدقيق',
    playStyle: 'تحكّم تام بإيقاع اللعب ودقة تمرير شبه مثالية وهدوء مطلق',
    signature6v6: 'في السداسي: وجّه نسق المباراة — هدّئ اللعب عند التقدّم وسرّعه بتمريرة واحدة.',
    initials: 'تك',
    accent: '#facc15',
    skills: { speed: 6, shooting: 8, passing: 10, dribbling: 8, defending: 7, stamina: 8, vision: 10, teamwork: 10, control: 10, positioning: 9 },
  },
  {
    id: 'modric',
    name: 'لوكا مودريتش',
    shortPos: 'CM',
    primaryPos: 'لاعب وسط',
    category: 'لاعبو وسط',
    archetype: 'فنان الوسط الأسطوري',
    playStyle: 'تمريرات بخارج القدم ومراوغة هادئة وذكاء ميداني نادر',
    signature6v6: 'في السداسي: استخدم التمريرة المموهة وخارج القدم لفك أي حصار دفاعي.',
    initials: 'لم',
    accent: '#e2e8f0',
    skills: { speed: 7, shooting: 8, passing: 10, dribbling: 9, defending: 7, stamina: 9, vision: 10, teamwork: 10, control: 10, positioning: 9 },
  },
  {
    id: 'bruno_fernandes',
    name: 'برونو فيرنانديز',
    shortPos: 'CAM',
    primaryPos: 'لاعب وسط',
    category: 'لاعبو وسط',
    archetype: 'القائد صانع الخطورة',
    playStyle: 'تمريرات جريئة مباشرة، تسديد من خارج المنطقة، ولياقة عالية',
    signature6v6: 'في السداسي: جازف بالتمريرة العمودية السريعة وسدّد فور فتح زاوية على المرمى.',
    initials: 'بف',
    accent: '#ef4444',
    skills: { speed: 7, shooting: 9, passing: 9, dribbling: 8, defending: 7, stamina: 10, vision: 9, teamwork: 9, control: 8, positioning: 9 },
  },
  {
    id: 'bellingham',
    name: 'جود بيلينغهام',
    shortPos: 'CAM',
    primaryPos: 'لاعب وسط',
    category: 'لاعبو وسط',
    archetype: 'الوسط المتكامل الحاسم',
    playStyle: 'اقتحام متأخر لمنطقة الجزاء، قوة بدنية، وحضور قيادي في كل شبر',
    signature6v6: 'في السداسي: شارك في الدفاع ثم اندفع للمربع في التوقيت المثالي للتسجيل.',
    initials: 'جب',
    accent: '#facc15',
    skills: { speed: 8, shooting: 9, passing: 8, dribbling: 9, defending: 8, stamina: 10, vision: 9, teamwork: 9, control: 9, positioning: 10 },
  },
  {
    id: 'vitinha',
    name: 'فيتينيا',
    shortPos: 'CM',
    primaryPos: 'لاعب وسط',
    category: 'لاعبو وسط',
    archetype: 'دينامو الاستحواذ',
    playStyle: 'خفة حركة، مقاومة للضغط، وربط سلس بين الدفاع والهجوم',
    signature6v6: 'في السداسي: تحرّك باستمرار لطلب الكرة وحرّر فريقك من الضغط العالي.',
    initials: 'فت',
    accent: '#818cf8',
    skills: { speed: 8, shooting: 7, passing: 9, dribbling: 9, defending: 8, stamina: 9, vision: 9, teamwork: 10, control: 9, positioning: 9 },
  },
  {
    id: 'szoboszlai',
    name: 'دومينيك سوبوسلاي',
    shortPos: 'CM',
    primaryPos: 'لاعب وسط',
    category: 'لاعبو وسط',
    archetype: 'المدفعجي سريع الإيقاع',
    playStyle: 'تسديدات صاروخية، ركض متواصل، وضغط شرس على حامل الكرة',
    signature6v6: 'في السداسي: اضغط على دفاع الخصم فوراً واستغل الكرات الثابتة بتسديدات قوية.',
    initials: 'دس',
    accent: '#f43f5e',
    skills: { speed: 9, shooting: 9, passing: 8, dribbling: 8, defending: 7, stamina: 10, vision: 8, teamwork: 9, control: 8, positioning: 8 },
  },

  // ==================== 9 أجنحة ومهاجمون ====================
  {
    id: 'messi',
    name: 'ليونيل ميسي',
    shortPos: 'RW',
    primaryPos: 'جناح',
    category: 'أجنحة ومهاجمون',
    archetype: 'العبقري الأسطوري',
    playStyle: 'مراوغة ملتصقة بالقدم، رؤية خارقة، وإنهاء فني في أضيق زاوية',
    signature6v6: 'في السداسي: اسحب مدافعين نحوك ثم مرّر البينية القاتلة أو سدّد بدقة في الزاوية.',
    initials: 'لم',
    accent: '#facc15',
    skills: { speed: 8, shooting: 10, passing: 10, dribbling: 10, defending: 4, stamina: 7, vision: 10, teamwork: 9, control: 10, positioning: 10 },
  },
  {
    id: 'ronaldo',
    name: 'كريستيانو رونالدو',
    shortPos: 'ST',
    primaryPos: 'مهاجم',
    category: 'أجنحة ومهاجمون',
    archetype: 'ماكينة الأهداف الملكية',
    playStyle: 'تمركز حاسم داخل الصندوق، تسديدات قوية، وعقلية فوز لا تعرف الاستسلام',
    signature6v6: 'في السداسي: تمركز عند القائم البعيد واطلب الكرة للتسديد المباشر من أول لمسة.',
    initials: 'كر',
    accent: '#fbbf24',
    skills: { speed: 8, shooting: 10, passing: 7, dribbling: 8, defending: 4, stamina: 8, vision: 8, teamwork: 7, control: 9, positioning: 10 },
  },
  {
    id: 'mbappe',
    name: 'كيليان مبابي',
    shortPos: 'ST',
    primaryPos: 'مهاجم',
    category: 'أجنحة ومهاجمون',
    archetype: 'البرق الخاطف',
    playStyle: 'انطلاقة صاروخية في المساحات وإنهاء خاطف داخل الصندوق',
    signature6v6: 'في السداسي: استغل غياب التسلل وانطلق خلف آخر مدافع فور قطع فريقك للكرة.',
    initials: 'كم',
    accent: '#38bdf8',
    skills: { speed: 10, shooting: 10, passing: 8, dribbling: 10, defending: 4, stamina: 9, vision: 8, teamwork: 8, control: 9, positioning: 9 },
  },
  {
    id: 'vinicius',
    name: 'فينيسيوس جونيور',
    shortPos: 'LW',
    primaryPos: 'جناح',
    category: 'أجنحة ومهاجمون',
    archetype: 'فنان المراوغة والسرعة',
    playStyle: 'مهارات 1 ضد 1 كهربائية وسرعة مرعبة على الرواق الأيسر',
    signature6v6: 'في السداسي: اطلب الكرة على الطرف في موقف 1 ضد 1 واخترق للداخل نحو المرمى.',
    initials: 'فج',
    accent: '#facc15',
    skills: { speed: 10, shooting: 8, passing: 8, dribbling: 10, defending: 5, stamina: 9, vision: 8, teamwork: 8, control: 9, positioning: 9 },
  },
  {
    id: 'salah',
    name: 'محمد صلاح',
    shortPos: 'RW',
    primaryPos: 'جناح',
    category: 'أجنحة ومهاجمون',
    archetype: 'الملك الحاسم',
    playStyle: 'دخول قاتل من اليمين، تسديدات مقوّسة متقنة، وصناعة مستمرة',
    signature6v6: 'في السداسي: استلم على اليمين واقطع للعمق بقدمك القوية للتسديد أو التمرير العكسي.',
    initials: 'مص',
    accent: '#ef4444',
    skills: { speed: 9, shooting: 10, passing: 9, dribbling: 9, defending: 5, stamina: 9, vision: 9, teamwork: 9, control: 9, positioning: 10 },
  },
  {
    id: 'haaland',
    name: 'إيرلينغ هالاند',
    shortPos: 'ST',
    primaryPos: 'مهاجم',
    category: 'أجنحة ومهاجمون',
    archetype: 'الإعصار الفتاك',
    playStyle: 'حسم فوري من لمسة واحدة وقوة هائلة في الانطلاق والتمركز',
    signature6v6: 'في السداسي: لا تبالغ بالمراوغة — تحرّك بذكاء أمام المرمى وانهِ الهجمة بلمسة واحدة.',
    initials: 'إه',
    accent: '#38bdf8',
    skills: { speed: 9, shooting: 10, passing: 6, dribbling: 7, defending: 5, stamina: 9, vision: 7, teamwork: 7, control: 8, positioning: 10 },
  },
  {
    id: 'lamine_yamal',
    name: 'لامين يامال',
    shortPos: 'RW',
    primaryPos: 'جناح',
    category: 'أجنحة ومهاجمون',
    archetype: 'الموهبة الساحرة',
    playStyle: 'جرأة فنية، مراوغات رشيقة، وتمريرات عرضية مقوّسة بذكاء',
    signature6v6: 'في السداسي: راوغ بتغيير الإيقاع المفاجئ وافتح زوايا التمرير الساحرة لزملائك.',
    initials: 'لي',
    accent: '#a855f7',
    skills: { speed: 9, shooting: 8, passing: 9, dribbling: 10, defending: 5, stamina: 8, vision: 9, teamwork: 9, control: 10, positioning: 8 },
  },
  {
    id: 'saka',
    name: 'بوكايو ساكا',
    shortPos: 'RW',
    primaryPos: 'جناح',
    category: 'أجنحة ومهاجمون',
    archetype: 'الجناح الذكي المتوازن',
    playStyle: 'توازن رائع بين المراوغة والتمرير والالتزام الدفاعي والحسم',
    signature6v6: 'في السداسي: اجمع بين الضغط الدفاعي المبكر والاختراق الهادئ على الطرف.',
    initials: 'بس',
    accent: '#f97316',
    skills: { speed: 9, shooting: 8, passing: 9, dribbling: 9, defending: 7, stamina: 9, vision: 9, teamwork: 9, control: 9, positioning: 9 },
  },
  {
    id: 'harry_kane',
    name: 'هاري كين',
    shortPos: 'ST',
    primaryPos: 'مهاجم',
    category: 'أجنحة ومهاجمون',
    archetype: 'المهاجم المحطة الصانع',
    playStyle: 'إنهاء إكلينيكي وتمريرات ساحرة من العمق كصانع ألعاب متقدم',
    signature6v6: 'في السداسي: اسحب المدافع بنزولك لاستلام الكرة ثم هيّئها للقادمين من الخلف.',
    initials: 'هك',
    accent: '#e2e8f0',
    skills: { speed: 7, shooting: 10, passing: 9, dribbling: 8, defending: 6, stamina: 8, vision: 9, teamwork: 9, control: 9, positioning: 10 },
  },
];

export interface TwinMatchResult {
  star: GlobalStar;
  matchPct: number;
  sharedSkills: Array<{ key: SkillKey; label: string; playerVal: number; starVal: number }>;
  keyUpgrade: { key: SkillKey; label: string; gap: number; tip: string };
}

export function normalizePlayerSkills(raw: Partial<Record<SkillKey, unknown>> | undefined): SkillsMap {
  const out = {} as SkillsMap;
  for (const k of SKILL_KEYS) {
    const v = Number(raw?.[k]);
    out[k] = Number.isFinite(v) ? Math.max(1, Math.min(10, v)) : 6;
  }
  return out;
}

export function findGlobalTwins(
  rawSkills: Partial<Record<SkillKey, unknown>> | undefined,
  primaryPos: string,
  topN = 3
): TwinMatchResult[] {
  const pSk = normalizePlayerSkills(rawSkills);

  // Compute shape-centered similarity + magnitude similarity so players with fair 6-8 budgets still get rich, accurate matches
  const pVals = SKILL_KEYS.map((k) => pSk[k]);
  const pMean = pVals.reduce((a, b) => a + b, 0) / pVals.length;

  const scored = GLOBAL_STARS_30.map((star) => {
    const sVals = SKILL_KEYS.map((k) => star.skills[k]);
    const sMean = sVals.reduce((a, b) => a + b, 0) / sVals.length;

    let dot = 0;
    let magP = 0;
    let magS = 0;
    let diffSq = 0;

    for (let i = 0; i < SKILL_KEYS.length; i++) {
      const dp = pVals[i] - pMean;
      const ds = sVals[i] - sMean;
      dot += dp * ds;
      magP += dp * dp;
      magS += ds * ds;
      const d = pVals[i] - sVals[i];
      diffSq += d * d;
    }

    // Profile shape similarity (0..1)
    const shapeSim = magP > 0.001 && magS > 0.001 ? (dot / (Math.sqrt(magP) * Math.sqrt(magS)) + 1) / 2 : 0.65;
    // Normalized Euclidean closeness (0..1)
    const maxDist = Math.sqrt(SKILL_KEYS.length * 81); // max diff 9 per skill
    const distSim = Math.max(0, 1 - Math.sqrt(diffSq) / maxDist);

    // Position affinity bonus
    let posBonus = 0;
    if (star.primaryPos === primaryPos) posBonus = 0.14;
    else if (
      (primaryPos === 'جناح' && star.primaryPos === 'مهاجم') ||
      (primaryPos === 'مهاجم' && star.primaryPos === 'جناح') ||
      (primaryPos === 'لاعب وسط' && star.primaryPos === 'جناح')
    ) {
      posBonus = 0.05;
    }

    const rawScore = shapeSim * 0.48 + distSim * 0.42 + posBonus;
    const matchPct = Math.round(Math.max(48, Math.min(99, rawScore * 96 + 4)));

    // Find top shared strengths (skills where both player & star excel relative to their means)
    const shared = SKILL_KEYS.map((k) => ({
      key: k,
      label: SKILL_LABELS_AR[k],
      playerVal: pSk[k],
      starVal: star.skills[k],
      synergy: pSk[k] + star.skills[k] - Math.abs(pSk[k] - star.skills[k]) * 1.4,
    }))
      .sort((a, b) => b.synergy - a.synergy)
      .slice(0, 3)
      .map(({ key, label, playerVal, starVal }) => ({ key, label, playerVal, starVal }));

    // Find key upgrade skill (biggest positive gap where star > player)
    const gaps = SKILL_KEYS.map((k) => ({
      key: k,
      label: SKILL_LABELS_AR[k],
      gap: Math.max(0, star.skills[k] - pSk[k]),
      starVal: star.skills[k],
    })).sort((a, b) => b.gap - a.gap || b.starVal - a.starVal);

    const topGap = gaps[0];

    return {
      star,
      matchPct,
      sharedSkills: shared,
      keyUpgrade: {
        key: topGap.key,
        label: topGap.label,
        gap: topGap.gap,
        tip: SKILL_TIPS_6V6[topGap.key],
      },
    };
  });

  scored.sort((a, b) => b.matchPct - a.matchPct || a.star.id.localeCompare(b.star.id));
  return scored.slice(0, Math.max(1, topN));
}

export interface PlayerDNA {
  title: string;
  emoji: string;
  subtitle: string;
  tip6v6: string;
  axes: {
    creativity: number;
    finishing: number;
    solidity: number;
    tempo: number;
  };
}

export function computePlayerDNA(
  rawSkills: Partial<Record<SkillKey, unknown>> | undefined,
  primaryPos: string
): PlayerDNA {
  const s = normalizePlayerSkills(rawSkills);
  const creativity = Math.round(((s.passing + s.vision + s.dribbling + s.control) / 4) * 10);
  const finishing = Math.round(((s.shooting * 1.3 + s.positioning + s.speed * 0.7) / 3) * 10);
  const solidity = Math.round(((s.defending * 1.3 + s.positioning + s.teamwork * 0.7) / 3) * 10);
  const tempo = Math.round(((s.speed + s.stamina + s.teamwork) / 3) * 10);

  if (primaryPos === 'حارس مرمى') {
    if (s.passing >= 7 || s.control >= 7) {
      return {
        title: 'الحارس الليبرو صانع اللعب',
        emoji: '🧤',
        subtitle: 'تبدأ الهجمة بثقة من المرمى وتقرأ تحركات الخصم مبكراً',
        tip6v6: 'دورك الذهبي في 6v6: كن خيار التمرير الإضافي لفك الضغط وابدأ المرتدة السريعة بيدك.',
        axes: { creativity, finishing, solidity, tempo },
      };
    }
    return {
      title: 'حائط المرمى الحديدي',
      emoji: '🛡️',
      subtitle: 'إغلاق زوايا صارم وتصديات حاسمة تحمي الفريق في أصعب الدقائق',
      tip6v6: 'دورك الذهبي في 6v6: وجّه خط الدفاع بصوتك وتقدّم لغلق الزوايا في الانفرادات.',
      axes: { creativity, finishing, solidity, tempo },
    };
  }

  if (primaryPos === 'مدافع') {
    if (s.speed >= 8 && (s.dribbling >= 7 || s.passing >= 7)) {
      return {
        title: 'الظهير الطائر الحديث',
        emoji: '🚀',
        subtitle: 'تجمع بين التغطية الدفاعية السريعة والانطلاق الهجومي الخاطف',
        tip6v6: 'دورك الذهبي في 6v6: افتح المساحة على الطرف ثم ارتد فوراً عند فقدان الكرة.',
        axes: { creativity, finishing, solidity, tempo },
      };
    }
    return {
      title: 'صخرة الدفاع المنظّم',
      emoji: '🏰',
      subtitle: 'قراءة ذكية للعب واستخلاص نظيف يمنح فريقك الأمان الكامل',
      tip6v6: 'دورك الذهبي في 6v6: احفظ توازن الخلف وراقب مهاجم الخصم الثابت بدون اندفاع.',
      axes: { creativity, finishing, solidity, tempo },
    };
  }

  if (creativity >= finishing && creativity >= solidity && creativity >= tempo - 4) {
    return {
      title: 'مهندس المساحات الضيقة',
      emoji: '🪄',
      subtitle: 'تتحكم بالإيقاع وتصنع الفرص بتمريرات ذكية في أضيق الزوايا',
      tip6v6: 'دورك الذهبي في 6v6: اربط بين الخطوط باللمسة الواحدة وافتح ممرات التمرير للهدّافين.',
      axes: { creativity, finishing, solidity, tempo },
    };
  }

  if (finishing >= creativity && finishing >= solidity) {
    return {
      title: 'قنّاص الصندوق الحاسم',
      emoji: '🎯',
      subtitle: 'حس تهديفي عالٍ وتمركز قاتل يحوّل أنصاف الفرص إلى أهداف',
      tip6v6: 'دورك الذهبي في 6v6: استغل عدم وجود التسلل واطلب الكرة خلف ظهر المدافعين.',
      axes: { creativity, finishing, solidity, tempo },
    };
  }

  if (tempo >= solidity && tempo >= creativity) {
    return {
      title: 'صاروخ المرتدات والإيقاع',
      emoji: '⚡',
      subtitle: 'سرعة انفجارية ولياقة عالية تقلب المباراة في ثوانٍ معدودة',
      tip6v6: 'دورك الذهبي في 6v6: اربك الخصم بالتحولات السريعة والضغط العالي على حامل الكرة.',
      axes: { creativity, finishing, solidity, tempo },
    };
  }

  return {
    title: 'الجوكر التكتيكي المتكامل',
    emoji: '👑',
    subtitle: 'توازن شامل بين الدفاع والهجوم واللعب الجماعي في كل مناطق الملعب',
    tip6v6: 'دورك الذهبي في 6v6: غطّ المساحة الفارغة دائماً وساند الهجوم والدفاع بذكاء.',
    axes: { creativity, finishing, solidity, tempo },
  };
}

export interface PlayStyleBadge {
  id: string;
  icon: string;
  name: string;
  plus: boolean;
  desc: string;
}

export function computePlayStyles(
  rawSkills: Partial<Record<SkillKey, unknown>> | undefined,
  primaryPos: string,
  stats?: { goals?: number; assists?: number; xp?: number; matchesCount?: number }
): PlayStyleBadge[] {
  const s = normalizePlayerSkills(rawSkills);
  const g = Number(stats?.goals || 0);
  const a = Number(stats?.assists || 0);
  const badges: PlayStyleBadge[] = [];

  if (s.speed >= 8) {
    badges.push({
      id: 'rapid',
      icon: '⚡',
      name: s.speed >= 9 ? 'صاروخ الانطلاق+' : 'صاروخ الانطلاق',
      plus: s.speed >= 9,
      desc: 'سرعة انفجارية في المرتدات والاختراقات',
    });
  }
  if (s.passing >= 8 && s.vision >= 7) {
    badges.push({
      id: 'incisive',
      icon: '🎯',
      name: s.passing >= 9 || s.vision >= 9 ? 'تمريرة بينية+' : 'تمريرة بينية',
      plus: s.passing >= 9 || s.vision >= 9,
      desc: 'تمريرات حاسمة تكسر خطوط الخصم بدقة',
    });
  }
  if (s.dribbling >= 8 && s.control >= 7) {
    badges.push({
      id: 'technical',
      icon: '🪄',
      name: s.dribbling >= 9 || s.control >= 9 ? 'لمسة ساحرة+' : 'لمسة ساحرة',
      plus: s.dribbling >= 9 || s.control >= 9,
      desc: 'تحكّم فني ومراوغة ناعمة في المساحات الضيقة',
    });
  }
  if (s.shooting >= 8) {
    badges.push({
      id: 'finesse',
      icon: '🔥',
      name: s.shooting >= 9 ? 'قذيفة حاسمة+' : 'قذيفة حاسمة',
      plus: s.shooting >= 9,
      desc: 'إنهاء متقن وتسديدات خطيرة نحو الزوايا',
    });
  }
  if (s.defending >= 8 && s.positioning >= 7) {
    badges.push({
      id: 'intercept',
      icon: '🛡️',
      name: s.defending >= 9 ? 'صخرة دفاعية+' : 'صخرة دفاعية',
      plus: s.defending >= 9,
      desc: 'قراءة ممتازة للعب وقطع الكرات قبل خطورتها',
    });
  }
  if (s.stamina >= 8 && s.teamwork >= 7) {
    badges.push({
      id: 'relentless',
      icon: '🫁',
      name: s.stamina >= 9 ? 'محرك لا يهدأ+' : 'محرك لا يهدأ',
      plus: s.stamina >= 9,
      desc: 'طاقة مستمرة وروح جماعية حتى صافرة النهاية',
    });
  }
  if (primaryPos === 'حارس مرمى' && (s.positioning >= 8 || s.defending >= 8)) {
    badges.push({
      id: 'gk_wall',
      icon: '🧤',
      name: 'قفاز حديدي+',
      plus: true,
      desc: 'تصديات حاسمة وإغلاق ذكي لزوايا المرمى',
    });
  }
  if (g >= 3) {
    badges.push({
      id: 'poacher',
      icon: '⚽',
      name: 'هدّاف السداسي+',
      plus: true,
      desc: `مساهم بـ ${g} أهداف مسجّلة مع الفريق`,
    });
  }
  if (a >= 3) {
    badges.push({
      id: 'playmaker',
      icon: '🎩',
      name: 'صانع الألعاب+',
      plus: true,
      desc: `مساهم بـ ${a} تمريرات حاسمة للفريق`,
    });
  }

  if (badges.length === 0) {
    badges.push({
      id: 'core',
      icon: '✨',
      name: 'قلب الفريق',
      plus: false,
      desc: 'عضو أساسي جاهز لتطوير مهاراته نحو شارات +PlayStyle',
    });
  }

  return badges.slice(0, 4);
}

export interface RoleModelGapReport {
  star: GlobalStar;
  readinessPct: number;
  topGaps: Array<{
    key: SkillKey;
    label: string;
    playerVal: number;
    starVal: number;
    gap: number;
    tip: string;
  }>;
  strengthsMet: string[];
}

export function getStarById(starId: string | undefined): GlobalStar | null {
  if (!starId) return null;
  return GLOBAL_STARS_30.find((s) => s.id === starId) || null;
}

export function computeRoleModelGap(
  rawSkills: Partial<Record<SkillKey, unknown>> | undefined,
  starId: string | undefined
): RoleModelGapReport | null {
  const star = getStarById(starId);
  if (!star) return null;
  const pSk = normalizePlayerSkills(rawSkills);

  let totalStar = 0;
  let totalCovered = 0;
  const gaps: RoleModelGapReport['topGaps'] = [];
  const strengthsMet: string[] = [];

  for (const k of SKILL_KEYS) {
    const pv = pSk[k];
    const sv = star.skills[k];
    totalStar += sv;
    totalCovered += Math.min(pv, sv);
    const gap = Math.max(0, sv - pv);
    if (gap > 0) {
      gaps.push({
        key: k,
        label: SKILL_LABELS_AR[k],
        playerVal: pv,
        starVal: sv,
        gap,
        tip: SKILL_TIPS_6V6[k],
      });
    } else if (sv >= 7) {
      strengthsMet.push(SKILL_LABELS_AR[k]);
    }
  }

  gaps.sort((a, b) => b.gap - a.gap || b.starVal - a.starVal);
  const readinessPct = Math.round((totalCovered / Math.max(1, totalStar)) * 100);

  return {
    star,
    readinessPct,
    topGaps: gaps.slice(0, 3),
    strengthsMet: strengthsMet.slice(0, 4),
  };
}

export interface CardTierInfo {
  tierKey: 'bronze' | 'silver' | 'gold' | 'totw' | 'icon';
  tierLabel: string;
  cssClass: string;
  rank: number;
}

export function computeTierInfo(ovr: number, xp: number, goalsPlusAssists: number): CardTierInfo {
  if (ovr >= 86 && xp >= 250) {
    return { tierKey: 'icon', tierLabel: 'أسطورة ICON 👑', cssClass: 'tier-icon', rank: 5 };
  }
  if (goalsPlusAssists >= 5 && ovr >= 78) {
    return { tierKey: 'totw', tierLabel: 'نجم الأسبوع TOTW ⚡', cssClass: 'tier-totw', rank: 4 };
  }
  if (ovr >= 74) {
    return { tierKey: 'gold', tierLabel: 'ذهبي كريستالي ✨', cssClass: '', rank: 3 };
  }
  if (ovr >= 68) {
    return { tierKey: 'silver', tierLabel: 'فضي معدني', cssClass: 'tier-silver', rank: 2 };
  }
  return { tierKey: 'bronze', tierLabel: 'برونزي', cssClass: 'tier-bronze', rank: 1 };
}

export function generateCommentatorCall(input: {
  playerName: string;
  ovr: number;
  tierLabel: string;
  twinName: string;
  twinPct: number;
  dnaTitle: string;
  reason?: string;
}): { headline: string; commentary: string } {
  const name = input.playerName || 'البطل';
  const headline = input.reason || `ترقية ملكية — ${input.tierLabel}`;
  const commentary =
    `الله الله الله! يا سلام على «${name}»! ` +
    `بطاقة تقييمها ${input.ovr} بفئة (${input.tierLabel}) وبصمة «${input.dnaTitle}»! ` +
    `المهارة دي فيها لمحة واضحة من «${input.twinName}» بنسبة تطابق ${input.twinPct}% — ` +
    `استعدوا يا خصوم، الميدان السداسي اليوم على موعد مع الإبداع! 🎙️⚽👑`;
  return { headline, commentary };
}

declare global {
  interface Window {
    MaydanStars?: {
      GLOBAL_STARS_30: GlobalStar[];
      SKILL_LABELS_AR: Record<SkillKey, string>;
      findGlobalTwins: typeof findGlobalTwins;
      computePlayerDNA: typeof computePlayerDNA;
      computePlayStyles: typeof computePlayStyles;
      computeRoleModelGap: typeof computeRoleModelGap;
      computeTierInfo: typeof computeTierInfo;
      getStarById: typeof getStarById;
      generateCommentatorCall: typeof generateCommentatorCall;
    };
  }
}

if (typeof window !== 'undefined') {
  window.MaydanStars = {
    GLOBAL_STARS_30,
    SKILL_LABELS_AR,
    findGlobalTwins,
    computePlayerDNA,
    computePlayStyles,
    computeRoleModelGap,
    computeTierInfo,
    getStarById,
    generateCommentatorCall,
  };
}

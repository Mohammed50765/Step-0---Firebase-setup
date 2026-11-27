import { escapeHtml } from './security';

export interface InjuryGuide {
  id: string;
  name: string;
  shortLocation: string;
  icon: string;
  summary: string;
  causes6v6: string;
  warningSigns: string[];
  safeFirstAid: string[];
  avoidActions: string[];
  seeDoctorNow: string[];
  prevention: string[];
  returnStages: string[];
  sourceRef: string;
  lastReviewed: string;
}

export const INJURY_DISCLAIMER_AR =
  'هذا القسم للتوعية العامة والإسعاف الأولي الميداني فقط، وليس تشخيصاً طبياً ولا يغني عن الطبيب المختص، ولا يحتوي على أي أسماء أدوية أو جرعات.';

export const INJURY_REVIEW_DATE = '2026-11';
export const INJURY_TRUSTED_SOURCE =
  'إرشادات التوعية والإسعاف الرياضي الميداني (NHS Sports Injuries & Mayo Clinic First Aid)';

export const INJURIES_LIBRARY_9: InjuryGuide[] = [
  {
    id: 'ankle_sprain',
    name: 'التواء الكاحل',
    shortLocation: 'الكاحل',
    icon: '🦶',
    summary:
      'تمدّد أو شدّ مفاجئ في الأربطة التي تثبّت مفصل الكاحل، وغالباً يحدث عند التفاف القدم للداخل أثناء الجري أو الهبوط.',
    causes6v6:
      'التوقف السريع وتغيير الاتجاه المفاجئ على العشب الصناعي، أو احتكاك جانبي في المساحات الضيقة، أو ارتداء حذاء غير مناسب لأرضية السداسي.',
    warningSigns: [
      'ألم فوري على الجانب الخارجي أو الداخلي للكاحل.',
      'تورّم تدريجي أو كدمة حول المفصل خلال ساعات.',
      'صعوبة تحميل وزن الجسم على القدم أو شعور بعدم الثبات.',
    ],
    safeFirstAid: [
      'أوقف اللعب فوراً ولا تحاول «اختبار» الكاحل بالجري.',
      'أرح القدم وضع كمادة باردة ملفوفة بقماش لمدة 15 دقيقة مع راحة بين الجلسات.',
      'ارفع الساق فوق مستوى القلب أثناء الاستلقاء لتقليل التورّم.',
      'استخدم رباطاً ضاغطاً خفيفاً ومريحاً دون شدّ يمنع تدفّق الدم.',
    ],
    avoidActions: [
      'تجنّب إكمال المباراة أو الضغط على الكاحل لتجربته.',
      'تجنّب الكمادات الساخنة أو التدليك العنيف في أول 48 ساعة.',
      'تجنّب لفّ الرباط بقوة مفرطة تسبّب تنميلاً أو برودة بالأصابع.',
    ],
    seeDoctorNow: [
      'عدم القدرة على المشي 4 خطوات أو الدوس على القدم إطلاقاً.',
      'سماع صوت طقطقة قوية لحظة الالتواء أو تغيّر شكل المفصل.',
      'تورّم شديد وسريع أو ألم مباشر فوق عظمة الكاحل أو تنميل بالقدم.',
    ],
    prevention: [
      'اختيار حذاء سداسي مناسب (Turf/TF) بثبات جانبي جيد بدون مسامير طويلة.',
      'إحماء مفصل الكاحل بحركات دائرية وتوازن على قدم واحدة قبل المباراة.',
      'تقوية عضلات الساق المحيطة بالكاحل وتجنب اللعب عند الإرهاق الشديد.',
    ],
    returnStages: [
      'المرحلة 1 — راحة وحماية: المشي اليومي العادي بدون عرج واختفاء التورّم.',
      'المرحلة 2 — حركة وتوازن: تمارين حركة خفيفة وتوازن ثابت بدون ألم.',
      'المرحلة 3 — جري وتمرير: جري مستقيم خفيف ثم تمريرات قصيرة وتغيير اتجاه تدريجي.',
      'المرحلة 4 — عودة للسداسي: مشاركة بدقائق محدودة في تقسيمة ودّية قبل اللعب الكامل.',
    ],
    sourceRef: INJURY_TRUSTED_SOURCE,
    lastReviewed: INJURY_REVIEW_DATE,
  },
  {
    id: 'hamstring_strain',
    name: 'شد العضلة الخلفية',
    shortLocation: 'خلف الفخذ',
    icon: '🦵',
    summary:
      'إجهاد أو شدّ في العضلات الخلفية للفخذ يحدث عادةً أثناء الانطلاق السريع أو مدّ الساق فجأة للوصول للكرة.',
    causes6v6:
      'الانطلاقات المتكررة لمسافات قصيرة (سبرنت 15–20م) دون إحماء كافٍ، أو اللعب بعد جلوس طويل، أو تراكم الإجهاد خلال الأسبوع.',
    warningSigns: [
      'وخزة حادة أو شدّ مفاجئ في مؤخرة الفخذ أثناء الجري.',
      'تيبّس وألم عند ثني الركبة أو مدّ الساق للأمام.',
      'ضعف في دفع القدم عند المشي السريع.',
    ],
    safeFirstAid: [
      'توقّف عن اللعب فوراً واخرج من الملعب بهدوء.',
      'ضع كمادة باردة ملفوفة بقماش على موضع الألم لمدة 15 دقيقة.',
      'تجنّب الإطالة العنيفة أو التدليك القوي في الساعات الأولى.',
      'أرح الساق وتجنّب الجري أو التسديد حتى يهدأ الألم تماماً.',
    ],
    avoidActions: [
      'تجنّب محاولة «فكّ الشدّ» بإطالة قوية ومفاجئة في نفس اليوم.',
      'تجنّب العودة للجري السريع أو التسديد بمجرد خفّة الألم مؤقتاً.',
    ],
    seeDoctorNow: [
      'سماع أو الإحساس بفرقعة واضحة خلف الفخذ لحظة الإصابة.',
      'ظهور كدمة واسعة أو فجوة ملموسة في العضلة.',
      'ألم شديد يمنع المشي الطبيعي أو لا يتحسّن بعد عدة أيام من الراحة.',
    ],
    prevention: [
      'إحماء ديناميكي متدرج (جري خفيف ورفع ركب) قبل أي انطلاقة سريعة.',
      'احترام إشارة الإجهاد والنوم الجيد وعدم اللعب بمباريات متتالية دون استشفاء.',
      'شرب ماء كافٍ قبل المباراة والاهتمام بتقوية العضلات الخلفية بانتظام.',
    ],
    returnStages: [
      'المرحلة 1 — هدوء الألم: المشي الطبيعي والجلوس دون أي شدّ مزعج.',
      'المرحلة 2 — حركة لطيفة: ثني ومدّ خفيف دون مقاومة أو ألم.',
      'المرحلة 3 — جري متدرّج: جري خفيف ثم زيادة السرعة تدريجياً دون سبرنت كامل.',
      'المرحلة 4 — عودة كاملة: تجربة انطلاقات قصيرة وتمرير ثم العودة التدريجية للمباراة.',
    ],
    sourceRef: INJURY_TRUSTED_SOURCE,
    lastReviewed: INJURY_REVIEW_DATE,
  },
  {
    id: 'groin_strain',
    name: 'شد الفخذ الداخلي',
    shortLocation: 'الفخذ الداخلي (الأربية)',
    icon: '⚡',
    summary:
      'شدّ في العضلات الضامّة بالجزء الداخلي للفخذ، يرتبط كثيراً بالتمرير بباطن القدم والتسديد والانزلاق الجانبي.',
    causes6v6:
      'التسديد القوي المتكرر في ملاعب السداسي دون تسخين كافٍ، أو فتح الساق بشكل مفاجئ لاعتراض تمريرة أرضية سريعة.',
    warningSigns: [
      'ألم بالجزء الداخلي من الفخذ أو قرب منطقة الحوض عند ضمّ الساقين.',
      'انزعاج واضح عند التمرير بباطن القدم أو تغيير الاتجاه الجانبي.',
      'تيبّس في الصباح التالي للمباراة.',
    ],
    safeFirstAid: [
      'أوقف التسديد واللعب فوراً لتجنّب تفاقم الشدّ.',
      'ضع كمادة باردة ملفوفة بقماش على المنطقة المصابة 15 دقيقة.',
      'أرح الساق وتجنّب الحركات الجانبية الواسعة أو القرفصاء العميقة.',
    ],
    avoidActions: [
      'تجنّب التسديد أو التمرير الطويل بباطن القدم قبل اختفاء الألم.',
      'تجنّب فتح الساقين بزاوية واسعة لإطالة قسرية أثناء وجود ألم حاد.',
    ],
    seeDoctorNow: [
      'ألم حاد ومستمر في منطقة الأربية أو أسفل البطن.',
      'ظهور انتفاخ واضح أو كدمة كبيرة أو ألم عند السعال والحركة البسيطة.',
      'استمرار الألم لأكثر من أسبوع رغم الراحة.',
    ],
    prevention: [
      'إحماء تدريجي للحوض والفخذ الداخلي بحركات جانبية خفيفة قبل التسديد.',
      'عدم البدء بتسديدات بكامل القوة في أول دقائق الملعب.',
      'تقوية عضلات الجذع والحوض بانتظام لتحسين التوازن.',
    ],
    returnStages: [
      'المرحلة 1 — راحة: مشي يومي طبيعي بدون ألم عند ضمّ الساقين.',
      'المرحلة 2 — حركة جانبية خفيفة: خطوات جانبية بطيئة دون شدّ.',
      'المرحلة 3 — تمريرات قصيرة: تمرير خفيف بباطن القدم وجري متدرج.',
      'المرحلة 4 — تسديد تدريجي: رفع قوة التمرير والتسديد قبل خوض مباراة كاملة.',
    ],
    sourceRef: INJURY_TRUSTED_SOURCE,
    lastReviewed: INJURY_REVIEW_DATE,
  },
  {
    id: 'knee_injury',
    name: 'إصابة الركبة',
    shortLocation: 'الركبة',
    icon: '🛡️',
    summary:
      'إجهاد أو التواء في مفصل الركبة أو الأربطة المحيطة به نتيجة دوران الجسم والقدم ثابتة على الأرضية.',
    causes6v6:
      'ثبات الحذاء في العشب الصناعي أثناء الدوران السريع بالكرة، أو التحام مباشر على جانب الركبة، أو هبوط غير متوازن.',
    warningSigns: [
      'ألم داخل المفصل أو على جانبيه مع تورّم أو حرارة موضعية.',
      'شعور بأن الركبة «تخونك» أو لا تثبت عند الوقوف.',
      'صعوبة ثني الركبة بالكامل أو فردها.',
    ],
    safeFirstAid: [
      'أوقف اللعب فوراً ولا تضع وزناً زائداً على الركبة.',
      'استخدم كمادة باردة ملفوفة بقماش لمدة 15 دقيقة وارفع الساق.',
      'حافظ على الركبة في وضع مريح دون محاولة طقطقتها أو الضغط عليها.',
    ],
    avoidActions: [
      'تجنّب الدوران أو الثني القسري للركبة للتأكد من سلامتها.',
      'تجنّب الاستمرار باللعب مع إحساس بعدم ثبات المفصل أو تورّم.',
    ],
    seeDoctorNow: [
      'قفل الركبة (عدم القدرة على فردها أو ثنيها) أو عدم ثبات واضح.',
      'سماع صوت «طقطقة» داخل الركبة مع تورّم سريع خلال ساعات قليلة.',
      'عدم القدرة على الوقوف أو تحميل الوزن على الساق.',
    ],
    prevention: [
      'تجنّب الأحذية ذات المسامير الطويلة على العشب الصناعي لأنها تُثبّت القدم بقوة زائدة.',
      'تقوية عضلات الفخذ الأمامية والخلفية لحماية المفصل.',
      'الهبوط بركبتين مثنيتين قليلاً وتجنب الالتحامات المتهوّرة.',
    ],
    returnStages: [
      'المرحلة 1 — حماية واستقرار: اختفاء التورّم وثني وفرد مريح بدون ألم.',
      'المرحلة 2 — توازن وقوة خفيفة: ثبات على الساق ومشي سريع مريح.',
      'المرحلة 3 — جري مستقيم: جري خفيف دون دوران حاد أو التحام.',
      'المرحلة 4 — عودة تدريجية: تغيير اتجاه لطيف وتقسيمة بدون احتكاك قبل المباراة الكاملة.',
    ],
    sourceRef: INJURY_TRUSTED_SOURCE,
    lastReviewed: INJURY_REVIEW_DATE,
  },
  {
    id: 'leg_cramp',
    name: 'تشنج الساق',
    shortLocation: 'بطة الساق (السمانة)',
    icon: '💧',
    summary:
      'انقباض لا إرادي مؤقت ومفاجئ في عضلة بطة الساق أو القدم، شائع في نهاية المباريات السريعة والأجواء الحارة.',
    causes6v6:
      'نسق اللعب العالي في السداسي بدون توقف، وقلة شرب الماء قبل المباراة، أو اللعب بعد مجهود بدني طويل دون تعويض سوائل.',
    warningSigns: [
      'تصلّب مفاجئ ومؤلم في عضلة السمانة أو أسفل القدم.',
      'ثقل متكرر ووخز خفيف في الساقين قبل حدوث التشنج الكامل.',
    ],
    safeFirstAid: [
      'توقّف فوراً واجلس بأمان خارج خط الملعب.',
      'قم بإطالة لطيفة وبطيئة للعضلة (سحب مشط القدم نحوك بلطف دون عنف).',
      'اشرب ماءً بارداً بهدوء مع تدليك خفيف للعضلة حتى ترتخي.',
      'لا تعد للّعب فوراً إذا تكرر التشنج؛ خذ استراحة كافية.',
    ],
    avoidActions: [
      'تجنّب شدّ القدم بقوة عنيفة أثناء التشنج لتفادي تمزّق الألياف.',
      'تجنّب الجري السريع مباشرة بعد ارتخاء التشنج دون راحة وترطيب.',
    ],
    seeDoctorNow: [
      'استمرار الألم الحاد أو التورّم والاحمرار بعد زوال التشنج.',
      'تكرر التشنجات الشديدة بشكل متواصل رغم شرب الماء والراحة.',
      'الشعور بدوار شديد أو إعياء حراري عام.',
    ],
    prevention: [
      'شرب الماء بانتظام طوال اليوم قبل المباراة وليس قبل الصافرة بدقائق فقط.',
      'إحماء جيد وتبديلات دورية عادلة كل 7–10 دقائق في السداسي.',
      'تجنّب اللعب مباشرة بعد قلة نوم شديدة أو إجهاد بدني عالٍ.',
    ],
    returnStages: [
      'المرحلة 1 — إرخاء وتعويض: ارتخاء كامل للعضلة وشرب سوائل كافية.',
      'المرحلة 2 — مشي خفيف: التأكد من عدم وجود شدّ متبقٍ في اليوم التالي.',
      'المرحلة 3 — إحماء أطول: التركيز على الإطالة الحركية للساق قبل التمرين.',
      'المرحلة 4 — عودة طبيعية: اللعب بفترات متوازنة مع تبديلات منتظمة.',
    ],
    sourceRef: INJURY_TRUSTED_SOURCE,
    lastReviewed: INJURY_REVIEW_DATE,
  },
  {
    id: 'direct_bruise',
    name: 'الكدمات المباشرة',
    shortLocation: 'الفخذ أو الساق',
    icon: '💥',
    summary:
      'رضّة ناتجة عن اصطدام مباشر بركبة أو كرة قوية أو سقوط على أرضية الملعب، تسبب ألماً موضعياً وتغيّر لون الجلد أحياناً.',
    causes6v6:
      'الالتحامات القريبة في المساحات الضيقة، والتصدّي للتسديدات القريبة، أو السقوط على العشب الصناعي الخشن.',
    warningSigns: [
      'ألم موضعي واضح عند اللمس وتورّم خفيف في مكان الصدمة.',
      'ظهور احمرار أو ازرقاق تدريجي خلال اليوم التالي.',
      'تيبّس في العضلة عند محاولة الثني.',
    ],
    safeFirstAid: [
      'أرح الجزء المصاب وقيّم شدة الألم خارج الملعب.',
      'ضع كمادة باردة ملفوفة بقماش لمدة 15 دقيقة لتخفيف التورّم.',
      'تجنّب التدليك القوي أو الحرارة المباشرة على الكدمة الحديثة.',
    ],
    avoidActions: [
      'تجنّب فرك أو تدليك موضع الكدمة بقوة في أول يومين.',
      'تجنّب وضع الماء الساخن على التورّم الحديث.',
    ],
    seeDoctorNow: [
      'ألم عظمي حاد ومحدّد جداً يشتبه معه بكسر أو شرخ.',
      'تورّم كبير وصلب يتزايد بسرعة أو صعوبة في تحريك المفصل المجاور.',
      'خدر أو تنميل في الطرف المصاب أو إصابة قريبة من العين أو الأضلاع.',
    ],
    prevention: [
      'ارتداء واقيات الساق (الشين غارد) حتى في مباريات السداسي الودية.',
      'التحكم بسرعة الدخول في الكرات المشتركة واللعب النظيف.',
      'حماية الجسم بالتوازن السليم عند الهبوط.',
    ],
    returnStages: [
      'المرحلة 1 — تبريد وراحة: زوال التورّم والألم عند الحركة اليومية.',
      'المرحلة 2 — استعادة المدى: ثني ومدّ العضلة المصابة براحة تامة.',
      'المرحلة 3 — جري خفيف: حركة وتمرير بدون احتكاك مباشر.',
      'المرحلة 4 — عودة للمباراة: استخدام واقي الساق والعودة للعب الكامل عند غياب الألم.',
    ],
    sourceRef: INJURY_TRUSTED_SOURCE,
    lastReviewed: INJURY_REVIEW_DATE,
  },
  {
    id: 'shin_splints',
    name: 'التهاب الساق (قصبة الساق)',
    shortLocation: 'مقدمة الساق',
    icon: '🦴',
    summary:
      'ألم وإجهاد على طول الحافة الأمامية أو الداخلية لعظمة الساق نتيجة تكرار الصدمات على أرضيات صلبة.',
    causes6v6:
      'اللعب المتكرر على أرضيات سداسي صلبة أو عشب صناعي متهالك، أو ارتداء حذاء بنعل رقيق، أو زيادة عدد المباريات فجأة.',
    warningSigns: [
      'ألم نابض أو مزعج على طول قصبة الساق يبدأ في بداية اللعب أو بعده.',
      'حساسية وألم عند الضغط بالأصابع على الحافة الداخلية للساق.',
    ],
    safeFirstAid: [
      'خفّف حجم الجري وخذ راحة من الأرضيات الصلبة لعدة أيام.',
      'ضع كمادة باردة ملفوفة بقماش على الساق لمدة 15 دقيقة بعد النشاط.',
      'راجع حالة حذاء اللعب وبطانته قبل العودة للملعب.',
    ],
    avoidActions: [
      'تجنّب تجاهل ألم قصبة الساق المتصاعد واللعب عدة أيام متتالية.',
      'تجنّب اللعب بأحذية مستهلكة النعل على ملاعب صلبة.',
    ],
    seeDoctorNow: [
      'ألم حاد ومتركّز في نقطة صغيرة ومحددة جداً على العظمة.',
      'استمرار الألم أثناء المشي العادي أو حتى أثناء الراحة والنوم.',
      'ظهور تورّم واضح فوق عظمة الساق.',
    ],
    prevention: [
      'استخدام حذاء سداسي ببطانة ممتصة للصدمات ومناسب للأرضية.',
      'زيادة عدد المباريات تدريجياً وعدم القفز من انقطاع طويل لـ 4 مباريات أسبوعياً.',
      'إحماء عضلات السمانة والقدم جيداً قبل اللعب.',
    ],
    returnStages: [
      'المرحلة 1 — راحة من الصدمات: المشي اليومي بدون ألم نهائياً.',
      'المرحلة 2 — نشاط لطيف: حركة خفيفة وتمارين توازن دون قفز متكرر.',
      'المرحلة 3 — جري قصير: دقائق قليلة على أرضية جيدة ومراقبة الساق بعد اللعب.',
      'المرحلة 4 — عودة منتظمة: تقليل عدد المباريات الأسبوعية ثم زيادتها بالتدريج.',
    ],
    sourceRef: INJURY_TRUSTED_SOURCE,
    lastReviewed: INJURY_REVIEW_DATE,
  },
  {
    id: 'gk_fingers',
    name: 'أصابع الحارس',
    shortLocation: 'الأصابع واليد',
    icon: '🧤',
    summary:
      'التواء أو رضّة في مفاصل الأصابع نتيجة ارتطام كرة سريعة بطرف الأصابع أثناء التصدّي في المسافات القريبة.',
    causes6v6:
      'التسديدات القوية من مسافات قصيرة جداً في ملاعب السداسي، أو محاولة صدّ الكرة بأصابع مفرودة تماماً دون قفازات مناسبة.',
    warningSigns: [
      'ألم فوري وتورّم حول مفصل الإصبع.',
      'صعوبة ثني الإصبع أو الإمساك بالكرة.',
      'احمرار أو كدمة حول المفصل.',
    ],
    safeFirstAid: [
      'أوقف التصدّي فوراً وانزع القفاز وأي خاتم أو ساعة بهدوء قبل التورّم.',
      'ضع كمادة باردة ملفوفة بقماش لمدة 10–15 دقيقة وارفع اليد.',
      'لا تحاول شدّ أو «سحب» الإصبع بقوة لإرجاعه.',
    ],
    avoidActions: [
      'تجنّب سحب الإصبع أو محاولة تقويمه يدوياً بأي شكل.',
      'تجنّب الاستمرار في التصدّي لتسديدات قوية قبل زوال التورّم والألم.',
    ],
    seeDoctorNow: [
      'وجود اعوجاج واضح في شكل الإصبع أو عدم القدرة على تحريكه.',
      'تورّم شديد وسريع أو ألم حاد جداً مع تغيّر لون طرف الإصبع.',
      'جرح مفتوح فوق المفصل أو فقدان الإحساس.',
    ],
    prevention: [
      'ارتداء قفازات حارس مرمى مقاسها مناسب (يفضّل بدعامة أصابع إن وُجدت).',
      'إحماء المعصم والأصابع قبل المباراة، وتوجيه الكرة براحة اليد والذراعين لا بأطراف الأصابع.',
      'استقبال التسديدات القريبة جداً بجسم متوازن وزاوية إغلاق صحيحة.',
    ],
    returnStages: [
      'المرحلة 1 — حماية وراحة: اختفاء التورّم والقدرة على ثني وفرد الإصبع بدون ألم.',
      'المرحلة 2 — حركة خفيفة: تمارين قبض وفتح لينة لليد بدون كرة.',
      'المرحلة 3 — مسك كرات خفيفة: تمرير والتقاط كرات بطيئة بالقفازات.',
      'المرحلة 4 — عودة للحراسة: صدّ تسديدات متوسطة ثم قوية تدريجياً.',
    ],
    sourceRef: INJURY_TRUSTED_SOURCE,
    lastReviewed: INJURY_REVIEW_DATE,
  },
  {
    id: 'head_impact',
    name: 'ضربة على الرأس',
    shortLocation: 'الرأس',
    icon: '🧠',
    summary:
      'ارتطام مباشر للرأس بالكرة القوية أو برأس لاعب آخر أو بالأرض، ويتطلب حذراً عالياً وخروجاً فورياً للتقييم.',
    causes6v6:
      'الكرات العالية المشتركة في المساحات الصغيرة، أو السقوط على الأرضية، أو كرة قريبة قوية تصيب الوجه أو الرأس.',
    warningSigns: [
      'دوار أو تشوّش في الرؤية أو إحساس بعدم التوازن.',
      'صداع مفاجئ أو بطء في الاستجابة والتركيز.',
      'غثيان أو حساسية زائدة للضوء أو الصوت.',
    ],
    safeFirstAid: [
      'أخرج اللاعب من الملعب فوراً دون استثناء — «عند الشك، اخرج فوراً».',
      'اجلسه في مكان هادئ ومريح وتابع وعيه وكلامه وتوازنه باستمرار.',
      'لا تتركه وحيداً ولا تسمح له بالعودة للّعب في نفس اليوم مطلقاً.',
    ],
    avoidActions: [
      'تجنّب السماح للاعب بالعودة للملعب في نفس اليوم حتى لو شعر بتحسّن مؤقت.',
      'تجنّب ترك المصاب يغادر الملعب وحده أو يقود السيارة بعد ضربة رأس.',
    ],
    seeDoctorNow: [
      'فقدان الوعي ولو لثانية واحدة، أو نسيان ما حدث قبل أو بعد الضربة.',
      'صداع شديد يتزايد، تقيّؤ، تشوّش ذهني، تلعثم، أو ضعف بأحد الأطراف.',
      'نزيف أو خروج سائل من الأنف أو الأذن، أو نعاس غير طبيعي (توجّه للطوارئ فوراً).',
    ],
    prevention: [
      'تجنّب القفز العشوائي بالكوع المرفوع أو الالتحام الرأسي المتهوّر في السداسي.',
      'اللعب الأرضي السريع (أساس كرة السداسي) يقلّل الصدامات الهوائية.',
      'إيقاف اللعب فوراً من الجميع عند سقوط أي لاعب ممسكاً برأسه.',
    ],
    returnStages: [
      'المرحلة 1 — راحة وتقييم طبي: عدم العودة للّعب إلا بعد التأكد الطبي واختفاء الأعراض تماماً.',
      'المرحلة 2 — نشاط يومي هادئ: مشي خفيف فقط دون أي صداع أو دوار.',
      'المرحلة 3 — حركة فردية خفيفة: جري هادئ بدون ضربات رأسية وبدون احتكاك.',
      'المرحلة 4 — عودة تدريجية آمنة: موافقة طبية ثم مشاركة تدريجية عند الاطمئنان الكامل.',
    ],
    sourceRef: INJURY_TRUSTED_SOURCE,
    lastReviewed: INJURY_REVIEW_DATE,
  },
];

export function getInjuryByIdOrName(query: string): InjuryGuide | undefined {
  const q = String(query || '').trim();
  if (!q) return undefined;
  return INJURIES_LIBRARY_9.find(
    (item) => item.id === q || item.name === q || item.name.includes(q) || q.includes(item.name)
  );
}

export function renderInjuryDetailHtml(item: InjuryGuide): string {
  const renderList = (rows: string[]) =>
    `<ul style="margin:6px 0 0 0;padding-right:18px;display:flex;flex-direction:column;gap:4px;font-size:0.8rem;line-height:1.55;">${rows
      .map((r) => `<li>${escapeHtml(r)}</li>`)
      .join('')}</ul>`;

  return `
    <div style="display:flex;flex-direction:column;gap:10px;">
      <div class="row between" style="align-items:center;border-bottom:1px solid var(--border);padding-bottom:8px;">
        <div class="row" style="gap:8px;align-items:center;">
          <span style="font-size:1.5rem;" aria-hidden="true">${escapeHtml(item.icon)}</span>
          <div>
            <h3 style="margin:0;color:var(--primary);font-size:1.05rem;">${escapeHtml(item.name)}</h3>
            <div class="muted" style="font-size:0.74rem;">الموضع الشائع: ${escapeHtml(item.shortLocation)}</div>
          </div>
        </div>
      </div>

      <div class="item-box" style="margin:0;">
        <strong style="color:#fef9c3;">1. وصف مبسّط</strong>
        <p style="margin-top:4px;font-size:0.8rem;line-height:1.6;color:#e4e4e7;">${escapeHtml(item.summary)}</p>
      </div>

      <div class="item-box" style="margin:0;">
        <strong style="color:#fef9c3;">2. الأسباب الشائعة في ملاعب السداسي (6v6)</strong>
        <p style="margin-top:4px;font-size:0.8rem;line-height:1.6;color:#e4e4e7;">${escapeHtml(item.causes6v6)}</p>
      </div>

      <div class="item-box" style="margin:0;">
        <strong style="color:#fde68a;">3. الأعراض التحذيرية</strong>
        ${renderList(item.warningSigns)}
      </div>

      <div class="item-box" style="margin:0;border-color:rgba(34,197,94,0.32);">
        <strong style="color:#86efac;">4. الإسعاف الأولي الآمن (بدون أدوية أو جرعات)</strong>
        ${renderList(item.safeFirstAid)}
      </div>

      <div class="item-box" style="margin:0;border-color:rgba(245,158,11,0.38);background:rgba(245,158,11,0.06);">
        <strong style="color:#fcd34d;">⛔ ما يجب تجنّبه ومتى تتوقف عن اللعب</strong>
        ${renderList(item.avoidActions)}
      </div>

      <div class="alert-danger" style="margin:0;border-width:1.5px;border-color:rgba(244,63,94,0.75);background:rgba(244,63,94,0.16);">
        <strong style="color:#fda4af;font-size:0.88rem;">🚨 5. متى تراجع الطبيب فوراً</strong>
        ${renderList(item.seeDoctorNow)}
      </div>

      <div class="item-box" style="margin:0;">
        <strong style="color:#93c5fd;">6. الوقاية قبل وأثناء المباراة</strong>
        ${renderList(item.prevention)}
      </div>

      <div class="item-box" style="margin:0;border-color:rgba(250,204,21,0.3);">
        <strong style="color:var(--primary);">7. مراحل العودة التدريجية للّعب</strong>
        ${renderList(item.returnStages)}
      </div>

      <div class="item-box" style="margin:0;padding:8px 10px;font-size:0.71rem;color:#cbd5e1;">
        <div><strong>📚 المرجع التوعوي:</strong> ${escapeHtml(item.sourceRef)}</div>
        <div class="muted" style="font-size:0.69rem;margin-top:2px;">آخر مراجعة توعوية: ${escapeHtml(item.lastReviewed)}</div>
      </div>

      <div class="muted" style="font-size:0.72rem;text-align:center;padding:4px 0;">
        ${escapeHtml(INJURY_DISCLAIMER_AR)}
      </div>

      <button type="button" id="btnLogThisInjury" data-inj-name="${escapeHtml(item.name)}" data-inj-loc="${escapeHtml(item.shortLocation)}" class="btn-primary" style="width:100%;">
        📝 سجّل هذه الإصابة في سجلي الخاص
      </button>
    </div>
  `;
}

export interface InjuryLogRow {
  type?: string;
  location?: string;
  severity?: string;
  date?: string;
  expectedReturn?: string;
  playerId?: string;
  ownerUid?: string;
}

export interface InjuryMountHooks {
  getInjuries: () => InjuryLogRow[];
  getPlayers: () => Array<Record<string, unknown>>;
  getCurrentUser: () => Record<string, unknown> | null;
  isCaptain: () => boolean;
  onRecoverAvailable?: () => void | Promise<void>;
}

class MaydanInjuryLibraryUI {
  private hooks: InjuryMountHooks | null = null;
  private bound = false;

  mount(hooks: InjuryMountHooks): void {
    this.hooks = hooks;
    this.render();
    if (!this.bound) {
      this.bound = true;
      const closeBtn = document.getElementById('closeInjModal');
      if (closeBtn) {
        closeBtn.addEventListener('click', () => {
          document.getElementById('injModal')?.classList.add('hidden');
        });
      }
      const modalBg = document.getElementById('injModal');
      if (modalBg) {
        modalBg.addEventListener('click', (e) => {
          if (e.target === modalBg) modalBg.classList.add('hidden');
        });
      }
    }
  }

  openGuide(idOrName: string): void {
    const item = getInjuryByIdOrName(idOrName) || INJURIES_LIBRARY_9[0];
    const contentEl = document.getElementById('injModalContent');
    const modalEl = document.getElementById('injModal');
    if (!contentEl || !modalEl) return;

    contentEl.innerHTML = renderInjuryDetailHtml(item);
    modalEl.classList.remove('hidden');

    const logBtn = document.getElementById('btnLogThisInjury');
    if (logBtn) {
      logBtn.addEventListener('click', () => {
        const injTypeEl = document.getElementById('injType') as HTMLSelectElement | null;
        const injLocEl = document.getElementById('injLoc') as HTMLInputElement | null;
        const injDateEl = document.getElementById('injDate') as HTMLInputElement | null;
        if (injTypeEl) injTypeEl.value = item.name;
        if (injLocEl && !injLocEl.value.trim()) injLocEl.value = item.shortLocation;
        if (injDateEl && !injDateEl.value) injDateEl.value = new Date().toISOString().slice(0, 10);
        modalEl.classList.add('hidden');
        document.getElementById('injForm')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        injLocEl?.focus();
      });
    }
  }

  render(): void {
    if (!this.hooks) return;
    const user = this.hooks.getCurrentUser();
    const isCaptain = this.hooks.isCaptain();
    const players = this.hooks.getPlayers();
    const allInjuries = this.hooks.getInjuries();

    const typeSel = document.getElementById('injType') as HTMLSelectElement | null;
    if (typeSel && typeSel.options.length !== INJURIES_LIBRARY_9.length) {
      const prev = typeSel.value;
      typeSel.innerHTML = INJURIES_LIBRARY_9.map(
        (i) => `<option value="${escapeHtml(i.name)}">${escapeHtml(i.name)}</option>`
      ).join('');
      if (prev) typeSel.value = prev;
    }

    const grid = document.getElementById('injLibGrid');
    if (grid) {
      grid.innerHTML = INJURIES_LIBRARY_9.map(
        (item) => `
          <button type="button" data-inj-id="${escapeHtml(item.id)}" class="inj-item item-box" style="text-align:right;color:#fff;display:flex;flex-direction:column;justify-content:space-between;gap:6px;min-height:84px;">
            <div class="row between" style="width:100%;flex-wrap:nowrap;">
              <strong style="font-size:0.86rem;">${escapeHtml(item.name)}</strong>
              <span aria-hidden="true">${escapeHtml(item.icon)}</span>
            </div>
            <div class="muted" style="font-size:0.72rem;line-height:1.4;">${escapeHtml(item.shortLocation)} · 7 حقول توعوية</div>
            <div style="color:var(--primary);font-size:0.73rem;font-weight:700;">عرض الدليل الكامل ←</div>
          </button>
        `
      ).join('');

      grid.querySelectorAll<HTMLButtonElement>('[data-inj-id]').forEach((btn) => {
        btn.addEventListener('click', () => {
          this.openGuide(btn.dataset.injId || '');
        });
      });
    }

    const listEl = document.getElementById('myInjList');
    if (listEl && user) {
      const uid = String(user.id || '');
      const ownerUid = String(user.ownerUid || uid);
      const isUnavailable = user.availableStatus === 'unavailable' || user.availableStatus === 'غير متاح';
      const statusBannerHtml = `
        <div class="item-box row between" style="margin-bottom:8px;border-color:${isUnavailable ? 'rgba(239,68,68,0.45)' : 'rgba(34,197,94,0.38)'};background:${isUnavailable ? 'rgba(239,68,68,0.08)' : 'rgba(34,197,94,0.07)'};gap:8px;">
          <div>
            <strong style="font-size:0.84rem;color:${isUnavailable ? '#fda4af' : '#86efac'};">
              ${isUnavailable ? '⛔ حالتك الحالية: غير متاح (مصاب)' : '🟢 حالتك الحالية: متاح للعب'}
            </strong>
            <div class="muted" style="font-size:0.72rem;">
              ${isUnavailable ? 'عند تعافيك اضغط الزر لاستعادة جاهزيتك في القائمة والتشكيلة.' : 'تظهر لزملائك كـ «متاح للعب» بدون كشف أي تفاصيل طبية.'}
            </div>
          </div>
          ${
            isUnavailable
              ? '<button type="button" id="btnRecoverAvailable" class="btn-emerald" style="font-size:0.78rem;padding:8px 12px;white-space:nowrap;">✅ تعافيت / متاح للعب</button>'
              : ''
          }
        </div>
      `;

      // Privacy invariant: non-captains ONLY see own injury records
      const visibleInj = isCaptain
        ? allInjuries
        : allInjuries.filter((i) => i.playerId === uid || i.ownerUid === ownerUid);

      if (!visibleInj.length) {
        listEl.innerHTML =
          statusBannerHtml +
          '<p class="muted" style="font-size:0.78rem;">لا توجد إصابات مسجّلة حالياً — نسأل الله السلامة للجميع.</p>';
      } else {
        const nameById = (pid?: string) => {
          if (!pid) return '';
          const found = players.find((p) => String(p.id) === pid || String(p.ownerUid) === pid);
          return found ? String(found.name || '') : '';
        };
        listEl.innerHTML =
          statusBannerHtml +
          visibleInj
            .slice()
            .reverse()
            .map((inj) => {
              const pLabel = isCaptain && inj.playerId !== uid ? `${nameById(inj.playerId)} · ` : '';
              const sevColor =
                inj.severity === 'شديدة'
                  ? '#fda4af'
                  : inj.severity === 'متوسطة'
                    ? '#fde68a'
                    : '#86efac';
              return `
                <div class="item-box row between" style="gap:8px;">
                  <div>
                    <div style="font-weight:800;font-size:0.84rem;">
                      🔒 ${escapeHtml(pLabel)}${escapeHtml(inj.type || '')}
                      <span style="color:${sevColor};font-size:0.75rem;margin-right:4px;">(${escapeHtml(inj.severity || 'خفيفة')})</span>
                    </div>
                    <div class="muted" style="font-size:0.74rem;">
                      الموضع: ${escapeHtml(inj.location || '—')} · عودة متوقعة: ${escapeHtml(inj.expectedReturn || '—')}
                    </div>
                  </div>
                  <button type="button" data-open-guide="${escapeHtml(inj.type || '')}" class="icon-btn" style="font-size:0.72rem;white-space:nowrap;">📖 الدليل</button>
                </div>
              `;
            })
            .join('');

        listEl.querySelectorAll<HTMLButtonElement>('[data-open-guide]').forEach((btn) => {
          btn.addEventListener('click', () => {
            this.openGuide(btn.dataset.openGuide || '');
          });
        });
      }

      const recoverBtn = document.getElementById('btnRecoverAvailable');
      if (recoverBtn && this.hooks?.onRecoverAvailable) {
        recoverBtn.addEventListener('click', () => {
          void this.hooks?.onRecoverAvailable?.();
        });
      }
    }
  }
}

export const injuryLibraryUI = new MaydanInjuryLibraryUI();

declare global {
  interface Window {
    MaydanInjuries?: {
      ui: MaydanInjuryLibraryUI;
      INJURIES_LIBRARY_9: InjuryGuide[];
      INJURY_DISCLAIMER_AR: string;
      getInjuryByIdOrName: typeof getInjuryByIdOrName;
    };
  }
}

if (typeof window !== 'undefined') {
  window.MaydanInjuries = {
    ui: injuryLibraryUI,
    INJURIES_LIBRARY_9,
    INJURY_DISCLAIMER_AR,
    getInjuryByIdOrName,
  };
}

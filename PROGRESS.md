# سجل التقدم — ميدان 6v6 (المرحلة 1 — التدقيق الأمني وترقية تجربة الاستخدام)

تاريخ البدء: 2026-11-25
النسخة الاحتياطية قبل البدء: `backups/hydrogen-phase1-before/`

---

## 1. حالة خطوات التنفيذ (Phase 1 Checklist)

- [x] **الخطوة 0: الفحص الفعلي للملفات وأخذ نسخة احتياطية (`backups/hydrogen-phase1-before`)**
  - تم فحص `firestore.rules` (1173 سطراً)، `firestore.rules.test.ts`، `src/backend.ts`، `src/firebase.ts`، `firebase-applet-config.json`، و`index.html`.
  - تم أخذ نسخة احتياطية كاملة في `backups/hydrogen-phase1-before/`.
- [x] **الخطوة 1: إنشاء Service Worker آمن وخفيف (`public/sw.js`) وربطه مع المسح عند الخروج**
  - تخزين الملفات الثابتة فقط (HTML/Icons/Manifest).
  - منع تخزين أي طلبات تخص Firestore أو Google Auth أو البيانات الخاصة.
  - إضافة آلية الإصدار (`CACHE_VERSION`) وتفريغ الكاش وإلغاء التسجيل عند تسجيل الخروج (`handleSignOut`).
- [x] **الخطوة 2: إخفاء كود الإحالة (`REF`) خلف علم ميزة (`ENABLE_REFERRAL_FEATURE = false`) وإضافة زر «🤝 دعوة» للأعضاء**
  - إخفاء حقول وشارات `REF-...` من الواجهة.
  - إضافة زر «🤝 دعوة» للأعضاء لمشاركة دعوة الفريق مع تنبيه واضح بأن الانضمام يخضع لموافقة المؤسس.
- [x] **الخطوة 3: جولة ترحيب تفاعلية من 3 خطوات (Onboarding) مع معاينة حية للدرع وزر «تخطي»**
  - 3 خطوات سريعة (الهوية والمركز -> توزيع نقاط الدرع 360 -> جاهز للميدان) مع معاينة فورية وزر «تخطي» ظاهر دائماً.
- [x] **الخطوة 4: بطاقة «شو المطلوب منك الآن؟» + حالات فارغة ذكية بزر واحد + شارات تبويب محلية (`localStorage`)**
  - بطاقة سياقية ذكية توجه اللاعب لأهم خطوة حالية.
  - حالات فارغة واضحة بزر إجراء واحد مباشر.
  - شارات تنبيه محلية على التبويبات تعتمد على `localStorage` فقط (0 قراءات Firestore).
- [x] **الخطوة 5: التحقق البصري والبرمجي (`npm run build`، `npm run lint`، `npm test`، وفحص المتصفح `360×780`)**
  - تم التحقق من البناء، واجتياز 64/64 اختباراً، وفحص `360×780` و`1440×900` في Chromium بـ `0px` طفح أفقي و`0` ظهور لكلمة FIFA/فيفا.

---

## 2. بنود «تحتاج مراجعة أمنية» (لم يتم تعديل القواعد أو نشرها — بانتظار موافقة المؤسس)

> **تنبيه التزام:** التزاماً بقواعد الجلسة، لم يتم لمس `firestore.rules` أو `src/backend.ts` أو `security_spec.md`. البنود التالية مرصودة من الفحص الفعلي للكود وتحتاج موافقتك قبل تطبيقها في القواعد أو الباك-إند:

1. **فصل بيانات معاينة الدعوة العامة عن حقول التدقيق (`inviteCodes/{code}`)**:
   - **الوضع الحالي في `firestore.rules` (سطر 611):** `allow get: if isVerifiedUser() && isValidInviteCodeStr(code);` يسمح لمن يملك الكود بقراءة الوثيقة كاملة، وهي تحتوي حالياً على الحقول الاختيارية `createdBy` (معرّف المؤسس) و`lastUsedBy` (معرّف آخر من استعمل الكود).
   - **الإصلاح المقترح بعد موافقتك:** إزالة `createdBy` و`lastUsedBy` من وثيقة `inviteCodes/{code}` العامة (أو نقلها إلى مجموعة فرعية/إدارية `inviteAdminLogs/{code}` يقرؤها المؤسس فقط `isCaptain()`) بحيث تقتصر وثيقة المعاينة على: اسم الفريق، اللون، نوع الانضمام، المقاعد المتبقية (`maxUses - usedCount`)، وتاريخ الصلاحية.

2. **إحكام فحص الانضمام المباشر (`requireApproval == false`) والوثائق القديمة في `inviteCodes`**:
   - **الوضع الحالي في `firestore.rules` (سطر 658–666 و736):**
     1. الحقل `maxUses` اختياري في `isValidInviteCodeDoc` للتوافق مع الأكواد القديمة؛ إذا وُجد كود قديم بدون `maxUses` فإنه لا يفرض تحديث `usedCount + 1`.
     2. في `players/{playerId}` عند `allow create` للانضمام المباشر، يتحقق من `existsAfter(.../joinRequests/$(request.auth.uid))` ولكن لا يتحقق من أن `getAfter(.../joinRequests/$(request.auth.uid)).data.createdAt == request.time` داخل نفس المعاملة.
   - **الإصلاح المقترح بعد موافقتك:** جعل `maxUses` و`usedCount` و`expiresAtMs` إلزامية في كل وثائق `inviteCodes`، وإضافة شرط `getAfter(.../joinRequests/$(request.auth.uid)).data.createdAt == request.time` في قاعدة إنشاء `players/{playerId}`.

3. **كود مشاركة الفريق الدائم للأعضاء (`teamShareCode` بطلب معلق دائماً)**:
   - **الوضع الحالي في `src/backend.ts` (سطر 878–880):** يقوم الباك-إند بحذف `nextSettings.inviteCode` من ذاكرة الجلسة لغير الكابتن (`if (!this.activeIsCaptain) delete nextSettings.inviteCode;`) لأن `inviteCode` قد يكون مضبوطاً على انضمام مباشر.
   - **الإصلاح المقترح بعد موافقتك:** إضافة حقل عام للأعضاء في `settings/team` باسم `memberShareCode` (أو السماح للأعضاء بقراءة كود الدعوة المخصص للطلبات المعلقة فقط) مع فرض شرط في `firestore.rules` بأن أي انضمام عبر كود مشاركة الأعضاء يُنشئ دائماً طلب انضمام بحالة `status == 'pending'` ولا يسمح أبداً بإنشاء وثيقة `players/{uid}` مباشرة.

4. **معالجة أخطاء القراءة الفردية (`catch {}` الصامتة) في `src/backend.ts`**:
   - **الوضع الحالي:** توجد 6 مواضع `catch {}` في `src/backend.ts` تبتلع الأخطاء بصمت في القراءات الفردية (`publicMeta/branding` سطر 308، `inspectInviteCode` سطر 515، `refreshAttendance` سطر 750، `refreshAdminRatings` سطر 767، `refreshMatchVoteTallies` سطر 800، `refreshFootballLibrary` سطر 829).
   - **الإصلاح المقترح بعد موافقتك:** تمرير أخطاء الصلاحيات غير المتوقعة في `refreshAttendance` و`refreshAdminRatings` و`inspectInviteCode` إلى مسار تشخيص واضح بدلاً من تجاهلها بصمت.

---

# سجل التقدم — إعادة تصميم «استوديو التكتيك» (#tab-tactics)

تاريخ البدء: 2026-11-25
النسخة الاحتياطية قبل البدء: `backups/tactics-ui-before/` (`index.html`, `src/tacticsStudio.ts`, `src/tacticsData.ts`)

## المرحلة A: الواجهة والتخطيط وإصلاح الأخطاء المرئية — ✅ مكتملة (متوقف بانتظار «كمّل»)
- [x] **النسخة الاحتياطية + لقطات BEFORE (`360×780`, `412×915`, `1440×900`, `11v11`) وفحص الكونسول**
- [x] **وحدة التخطيط النقية + الاختبارات (`src/tacticsLayout.ts` و`src/tacticsLayout.test.ts` — 8/8 اختبارات ناجحة)**
- [x] **إعادة تصميم `#tab-tactics` و`.tac-*` وتحديث `src/tacticsStudio.ts`:**
  - إصلاح عكس أرقام الخطط في RTL (`<bdi dir="ltr">` + عزل `\u2066...\u2069` لخيارات `<select>` مثل `3-5-2` و`2-2-1`).
  - منع تداخل أقراص الخصم مع لاعبينا (`deOverlapPositions`) وتمييز الخصم بشكل مثمّن مائل رمادي هادئ يتوهج برتقالياً فقط عند امتلاك الكرة أو استغلال ثغرة.
  - إصلاح شارة خط التسلل (`11v11`) بتموضع ذكي لا يصطدم بالخصوم وبدون أي مربع أبيض فارغ.
  - إزالة تكرار رمز المركز (`ST`/`ST`) وإظهار الاسم أسفل القرص فقط عند تعيين لاعب فعلي.
  - ملعب زمردي ملكي بخطوط ذهبية وشباك مرمى + صندوق شرح زجاجي عائم داخل الملعب بخط مؤشر ذهبي ينتهي عند حافة القرص.
  - شريط مراحل بصف أفقي واحد قابل للتمرير + شريط تحكم مضغوط (`بسيط` / `بطاقات ميدان` / `بوستر` بدون أي ذكر لـ FIFA/فيفا) + درج `⚙️ خيارات الخطة` قابل للطي.
  - شريط تشغيل كبسولي موحّد (5 أزرار `>= 44px`) + شريط تقدم تفاعلي + بطاقة «دورك في الخطة» السفلية بدرع مصغّر ببيانات اللاعب الحقيقية (`getRealisticRatingForPlayer`) + 3 واجبات `✓` + تبديل `[👤 حركتي فقط] ⇄ [👥 مع الفريق]`.
  - إضافة هامش سفلي يضمن عدم قص البطاقة الأخيرة تحت `.bottom-nav`.
- [x] **التحقق النهائي ولقطات AFTER (`360×780`, `412×915`, `1440×900`, `11v11`):**
  - `npm run build` ناجح، `npm run lint` ناجح، `npm test` (67/67) + `src/tacticsLayout.test.ts` (8/8) = 75/75 اختبار ناجح.
  - `0` أخطاء كونسول/صفحة، `0px` طفح أفقي على المقاسات الثلاثة، أصغر هدف لمس `44px`، `0` ظهور لكلمة FIFA/فيفا.
  - لم يتم تعديل أي ملف خارج النطاق المسموح (`src/backend.ts`، `firestore.rules`، `.bottom-nav`، والهيدر العام لم تُلمَس).

## المرحلة B: محرك الأنيميشن واللمس — ✅ مكتملة (متوقف بانتظار «كمّل»)
- [x] **النسخة الاحتياطية (`backups/tactics-phaseB-before/`):** حفظ نسخ نظيفة من `index.html` و`src/tacticsStudio.ts` و`src/tacticsLayout.ts`.
- [x] **وحدة محرك الأنيميشن النقية + الاختبارات (`src/tacticsEngine.ts` و`src/tacticsEngine.test.ts` — 5/5 اختبارات ناجحة):**
  - حساب خط زمني متصل (`buildTimelineMetrics` / `sampleTimeline` / `frameIndexToElapsedMs`).
  - قوس طيران الكرة بيزيه التربيعي (`evalBallArc`) مع ارتفاع ديناميكي وتباعد الظل وحجم الكرة ومسار الذيل الذهبي (`buildPartialQuadPath`).
  - أسهم تكتيكية منحنية (`buildCurvedArrowGeometry`) برسم تدريجي عبر `stroke-dashoffset`.
  - إسقاط إحداثيات اللمس المسطّح (`projectClientToPitchPct`).
- [x] **ربط المحرك في `src/tacticsStudio.ts` و`.tac-*` في `index.html`:**
  - استبدال المؤقت المزدوج (`setTimeout` + `rafId`) بمحرك `requestAnimationFrame` واحد موحّد يدير التشغيل والتقديم/التأخير والسحب المستمر على الشريط (`0..1000`) ومزامنة التعليق الصوتي بدون تعارض.
  - إصلاح وضوح شريط التقدم الذهبي في RTL (`input[type="range"].tac-scrubber` + مسار `270deg`).
  - حماية السحب في وضع `2.5D`: تسطيح فوري ومتزامن إلى `2D` (`.pitch-drag-flat`) قبل قراءة `getBoundingClientRect()` مع حلقة إمساك ذهبية واستعادة `2.5D` فور الإفلات، مع الحفاظ على النقر القصير لتسليط الضوء على المركز (`Role Spotlight`).
  - احترام `body.data-saver` و`prefers-reduced-motion: reduce` بإيقاف الذيل والنبض وتحديث اللقطات مباشرة بدون حمل 60fps.
- [x] **التحقق الشامل:** `npm run build` ناجح، `npm run lint` ناجح، `npm test` (67/67) + `src/tacticsLayout.test.ts` (8/8) + `src/tacticsEngine.test.ts` (5/5) = 80/80 اختبار ناجح؛ فحص Chromium (`360×780`, `390×844`, `1440×900`) بـ `0` أخطاء كونسول، `0px` طفح أفقي، و`0` ظهور لـ FIFA/فيفا.

## المرحلة C: المقارنة التعليمية والصوت والأداء وتصدير PNG — ✅ مكتملة
- [x] **النسخة الاحتياطية (`backups/tactics-phaseC-before/`):** حفظ نسخ نظيفة من `index.html` و`src/tacticsStudio.ts` و`src/tacticsLayout.ts` و`src/tacticsEngine.ts`.
- [x] **وحدة المقارنة التعليمية «صح مقابل خطأ» (`src/tacticsComparisons.ts` و`src/tacticsComparisons.test.ts` — 2/2 اختبار ناجح):**
  - 6 مقارنات تكتيكية كاملة للـ `6v6` (تكدّس البناء، النوم على الكرة، اندفاع الطرفين، الضغط الفردي، مصيدة الإرجاع للحارس، ورقابة الركنيات) بانتقال فوري بنقرة واحدة بين `⚠️ الخطأ الشائع` و`✓ الصحيح التكتيكي` مع إبراز مناطق الخطر البرتقالية مقابل مناطق الأمان الخضراء/الذهبية والقاعدة التكتيكية المختصرة.
  - زر وصول داخل درج `⚙️ خيارات الخطة` + زر وصول سريع فوق قائمة الحالات الـ 10 + شريط تحكم `#tacCompareBanner` وصندوق شرح `.callout-mistake` بلون ومؤشر برتقالي عند عرض الخطأ.
- [x] **التعليق الصوتي العربي المحلي المضبوط (`src/tacticsVoice.ts` و`src/tacticsVoice.test.ts` — 3/3 اختبارات ناجحة):**
  - اختيار أذكى صوت عربي محلي متاح (`pickBestArabicVoice` + مستمع `voiceschanged`) وتنظيف النص وتفكيك رموز المراكز والأرقام التكتيكية (`6v6`، `2-2-1`، `GK`/`ST`...) لقراءة عربية طبيعية (`prepareArabicNarrationText`) مع ضبط سرعة مريحة ومهلة أمان تمنع التجمّد على الجوال.
- [x] **مراجعة وضع توفير البيانات وتقليل الحركة (`body.data-saver` + `prefers-reduced-motion: reduce`):**
  - مستمع حي لـ `matchMedia('(prefers-reduced-motion: reduce)')` وإلغاء التوهجات والنبض والذيل وتثبيت الملعب `2D` مسطّح في الحالتين.
- [x] **التحقق من تصدير بوستر التشكيلة الرسمية (`exportLineupPosterPng`):**
  - فحص توليد صورة `PNG` حقيقية بدقة `900×1280` وعرضها داخل `#pngPreviewModal` ببيانات اللاعبين الحقيقية وعزل اتجاه الأرقام (`2-2-1` و`6v6`) وبدون أي قيم OVR وهمية.
- [x] **التحقق النهائي الشامل:**
  - `npm run build` ناجح، `npm run lint` ناجح، `npm test` (67/67) + اختبارات الاستوديو (18/18) = **85/85** اختبار ناجح.
  - فحص Chromium الحي (`360×780`, `390×844`, `1440×900`): `0` أخطاء كونسول/صفحة، `0px` طفح أفقي، `0` ظهور لكلمة FIFA/فيفا، وتصدير `900×1280 PNG` ناجح.
  - لم يتم لمس أي ملف خارج النطاق المسموح (`src/backend.ts`، `firestore.rules`، ملفات المصادقة، `.bottom-nav`، والهيدر العام).

---

## المرحلة D: المحاكاة التكتيكية السينمائية (`Cinematic 3D Tactical Simulation`) — ✅ مكتملة
- [x] وضع العرض السينمائي (`cinematic`) مع 3 زوايا كاميرا (`cinematic`، `top`، `wide`) ومزامنة حركة اللاعبين والكرة ومسار التمريرات مع التشكيلة الفعلية، مع احترام `body.data-saver` و`prefers-reduced-motion: reduce`.

---

## المرحلة E: التحديث الجماعي عبر Firebase وتبسيط الواجهة والتنظيف — ✅ مكتملة
- [x] **تثبيت الجلسة وفصل الوضع التجريبي:** تفعيل `browserLocalPersistence` + شاشة تحميل تمهيدية `#authBootLoader` + `overscroll-behavior-y: none` + فصل شاشة الدخول بين Google والوضع التجريبي المحلي مع تنبيه `#demoNoticeBanner`.
- [x] **الفرق الجماعية والدعوات وماسح QR:** إتاحة إنشاء الفرق والانضمام بالكود أو رابط `?join=` لجميع مستخدمي Google، توحيد أكواد الدعوة (`inviteCodes/{code}`)، ماسح QR بالكاميرا الخلفية (`src/qrScanner.ts`)، ومشاركة واتساب.
- [x] **تبويب «الفريق» (`#tab-team`) والتشكيلة المشتركة والقطّة المرنة:** شريط تبديل الفرق، قائمة الأعضاء المباشرة، إعدادات الفريق الكاملة (`#teamSettingsModal`)، دليل الترحيب السريع (3 خطوات)، نشر التشكيلة والتصويت والتقسيمة التلقائية للحاضرين، وإزالة الرقم الثابت `180` مع خيارات الحضور المحدّثة (`جاي` / `مو أكيد` / `معتذر`).
- [x] **تغذية تقارير الفريق ومكافحة تضخيم XP:** فاصل زمني 45 دقيقة، حد أقصى 12 هدفاً و12 تمريرة، وتوثيق الزملاء (`تأكيد 👍` ← `✓ موثّق`) مع منع التوثيق الذاتي.
- [x] **توحيد التنقل وتنظيف المشروع:** 5 تبويبات سفلية موحّدة (`الفريق`، `التشكيلة`، `المباراة`، `اللوحة`، `بطاقتي`)، حذف الشريط العلوي المكرّر، وحذف مجلد `backups/` والصور المرجعية غير المستخدمة.
- [x] **نشر القواعد والتحقق النهائي:** نشر `firestore.rules` على مشروع Firebase بنجاح، واجتياز `npm run build` و`npm run lint` و`npx eslint firestore.rules` و**100/100** اختبار وحدة، والتحقق المباشر في Chromium (`0` أخطاء كونسول).

---

## المرحلة F: التحصين الأمني وتوحيد الفريق الواحد (Phases 2–5) — ✅ مكتملة (بانتظار «بوابة القواعد»)

- [x] **المرحلة 2 — تنظيف الحزم وتوحيد المنطق (`backups/phase2-before/`):**
  - إزالة حزمة `jsqr` من `package.json` وإعادة بناء `src/qrScanner.ts` بالاعتماد على `BarcodeDetector` الأصلي فقط (تحميل كسول في `index.html` بحجم حزمة `3.23 kB` / gzip `1.28 kB` وصفر وجود لـ `jsqr` في `dist/`).
  - تحديث `src/security.ts` و`src/teamMultiplayer.ts` و`src/invitations.ts` و`src/preMatchHub.ts` لدعم `memberShareCode`، وحالات الحضور الموحدة (`جاي` / `محتمل` / `معتذر`)، وعزل PII عن معاينة الدعوات.
- [x] **المرحلة 3 — تحصين الباك-إند وقواعد الأمان (`backups/phase3-before/`):**
  - تحديث `src/backend.ts`: استبدال `catch {}` الصامتة، دعم `memberShareCode` و`organizerUids` و`lineupPermission` و`defaultCurrency` و`defaultPitchCost`، عزل `inviteAdminLogs` عن `inviteCodes`، تبريد 45 دقيقة في `reportThrottle` مع توثيق الزملاء (`confirmReport`)، تراجع خطوة واحدة (`undoTactics`) و`lineupVotes`، ومغادرة الفريق (`leaveTeam`) وحذف `jsqr`.
  - تحصين `firestore.rules` على معمارية الفريق الواحد فقط (`teamId == 'main'`, `admins/{uid}`): إزالة مسارات الفرق المتعددة (`users/*`, `teams/*`)، إلزام `8–20` محرفاً لأكواد الدعوة، عزل PII في `inviteAdminLogs/{code}`، فرض `requireApproval == true` و`status == 'pending'` دائماً على `isMemberShareCode`، فرض تبريد `2700000ms` في `reportThrottle/{uid}`، ودعم صلاحيات Tier 2 للمنظّمين (`organizerUids`).
- [x] **المرحلة 4 — ربط الواجهة وإصلاحات UX (`backups/phase4-before/index.html`):**
  - توحيد تسمية الحضور إلى (`جاي` / `محتمل` / `معتذر`) وإزالة أي شارة `مصاب 🩹` (استبدالها بـ `غير متاح`).
  - إضافة شريط وحالة انتظار الموافقة مع إشعار واتساب وتحديث الحالة، وصندوق الطلبات المعلقة داخل تبويب الفريق للكابتن (`قبول ✓` / `رفض ✕`).
  - إضافة زر `↩️ تراجع عن النشر` (`#btnTacUndoPublish`)، إبراز زر التصويت المختار (`.tac-vote-active`)، وتأكيد مغادرة الفريق المدمج من خطوتين (`#tsLeaveConfirmBox`) بدون `window.confirm`.
- [x] **المرحلة 5 — مزامنة المخطط والمواصفات والاختبارات والتحقق الشامل:**
  - تحديث `firebase-blueprint.json` و`security_spec.md` و`firestore.rules.test.ts` (إضافة الحالات الأمنية `#23–#28` ومزامنة `#1–#22`).
  - نتائج الفحص النهائي:
    - `npm test`: **100/100** اختبار وحدة ناجح.
    - `npx eslint firestore.rules`: **0** أخطاء.
    - `npm run lint` (`lint_applet`): ناجح.
    - `npm run build` (`compile_applet`): ناجح (`ZERO_JSQR_IN_DIST`).
    - فحص الأصول: صورة `/assets/aistudio/4dd680f1455c4343a2f9e28fa69f624060d00d2580e286b39bd8830fb272ce75_4f298648.png` مستخدمة فعلياً في `index.html` (لا توجد أصول غير مستخدمة، وتم الحفاظ على `backups/` و`bun.lock`).
    - محاكي القواعد المحلي (`firebase emulators:exec`): تعذّر تشغيله داخل بيئة الحاوية بسبب غياب `java` (`java: not found`)، لكن تم التحقق من صلاحية كتابة `firestore.rules` عبر `eslint` وصحة البناء النحوي لملف `firestore.rules.test.ts` عبر `esbuild + node --check`.
    - التحقق الحي في Chromium عبر `playwright-cli` على المقاسات `360×780` و`390×844` و`1440×900`: `0` أخطاء كونسول، `0px` طفح أفقي، `0` ظهور لكلمة FIFA/فيفا، واجتياز تدفقات التبويبات ونشر التشكيلة والتصويت والتراجع.

### حالة النشر: ⏸️ متوقف عند «بوابة القواعد»
- لم يتم استدعاء `deploy_firebase` أو `DeployRules` بانتظار موافقتك الصريحة بعبارة **«انشر القواعد»**.

---

# سجل التقدم — المرحلة السادسة: الفرق المتعددة (Multi-Team • Zero Budget Spark)

النسخة الاحتياطية قبل البدء: `backups/phase6-before/`

- [x] **الخطوة 6.1 — الوحدات النقية واختبارات الفرق المتعددة والحصة والهجرة:**
  - تحديث `src/quotaMonitor.ts` و`src/quotaMonitor.test.ts` لدعم تنبيه الـ `70%` من الحد اليومي (`50,000`) وحاسبة تقدير القراءات اليومية للفرق المتعددة (`estimateDailySparkReads`).
  - تحديث `src/invitations.ts` لدعم `teamId` الديناميكي و`joinMode` (`'approval'` الافتراضي مقابل `'instant'`) دون كسر التوافق مع الفريق الواحد.
  - إنشاء `src/multiTeamEngine.ts` و`src/multiTeamEngine.test.ts`: حدود الفرق (`<= 3` إنشاء، `<= 5` انضمام، حد سعة الفريق، وإيقاف الإنشاء عبر `allowNewTeams`), التحقق من حجم الشعار (`<= 50 KB / 68,500 chars`), فصل الحقول العامة عن الخاصة (`/private/*`) مع منع تسرب أي حقل صحي/جاهزية في قائمة الأعضاء العامة، تجميع الحضور في وثيقة واحدة لكل مباراة (`attendance/{matchKey}`), تجزئة دفعات الهجرة (`<= 400`), التحقق من الأعداد، ونقاط الاستئناف المحلية (`maydan_m6_migration_ckpt_v1`).
  - اجتياز `npm test`: **106/106** اختبار وحدة بنجاح.
- [x] **الخطوة 6.2 — `persistentLocalCache` وتطوير الباك-إند الهجين (`src/firebase.ts` و`src/backend.ts`):**
  - تفعيل `initializeFirestore` مع `persistentLocalCache` و`persistentMultipleTabManager` وتدرج احتياطي آمن لعدم تعطل الجلسات متعددة التبويبات.
  - تطوير الباك-إند الهجين (`Single-Team main` + `Multi-Team teams/{teamId}`) مع الترقية التلقائية الآمنة (`pendingJoinTeamId`)، وعزل القراءات الخاصة (`/private/*`)، واستهلاك قراءة مستمع حي واحد دائم (`teams/{teamId}`) ومستمعات تبويب كسولة (`setActiveTab`)، وصفحات `limit(20)` مع `loadMoreReports`/`loadMoreMatches`، ودعم معالج الهجرة الآمن (`exportLegacyTeamBackupJson` -> `runLegacyToMultiMigration` -> `verifyLegacyToMultiMigration` -> `confirmSwitchToMigratedTeam`).
- [x] **الخطوة 6.3 — واجهة وتجربة المستخدم للفرق المتعددة ومعالج الترقية (`index.html`)**:
  - إضافة شريط تبديل الفرق السريع في التبويب (`#teamSwitcherBar`) وزر الهيدر (`#hdrTeamSwitcherBtn`) ونافذة تبديل الفرق (`#teamSwitcherModal`).
  - إضافة شاشة الاختيار الترحيبي بعد الدخول (`#teamOnboardingModal`) وإنشاء الفريق الكامل (`#createTeamModal` مع وضع الانضمام `'approval'`/`'instant'` وتحذير الانضمام المباشر وضغط الشعار `<= 50 KB` ومنع الإنشاء عند `allowNewTeams == false`).
  - إضافة إشعار الخصوصية المدمج (`#privacyNoticeModal`)، وتحديث إعدادات الفريق (`#teamSettingsModal`) مع نقل القيادة، وحذف البيانات الخاصة، وحذف الفريق المرن بخطوتين، وتنبيه الحصة 70%.
  - إضافة معالج الهجرة الآمن من 4 خطوات (`#migrationWizardModal`) وبطاقة مالك المنصة (`#admPlatformOwnerCard`) وأزرار «عرض المزيد» (`limit(20)`) للمباريات والتقارير.
  - التحقق بالبناء (`compile_applet` و`lint_applet`): ناجح بالكامل بدون أخطاء.
- [x] **الخطوة 6.4 — قواعد الأمان `firestore.rules` والمخطط والمواصفات والاختبارات (`36` حالة) وتقديرات الحصة**
  - تحديث `security_spec.md` (إضافة الثوابت `#13–#20` وحالات الاختبار العدائية `#29–#36`) و`firebase-blueprint.json` (توثيق `/platform`، `/users`، `/teams/{teamId}` وجميع المجموعات الفرعية الـ 21).
  - تحديث `firestore.rules` بعزل كامل بين الفرق ومنع وصول مالك المنصة لأي فريق غير منضم إليه، ومنع تسرب الحقول الصحية أو الـ PINs، وتقييد `/private/*` للمالك والمؤسس فقط، وحماية قَطّة الملعب وحدود Spark (`allowNewTeams`، `<=3` إنشاء، `<=5` انضمام، شعار `<=50 KB`).
  - توسيع `firestore.rules.test.ts` لتشمل 36 حالة اختبار أمنية (`#1–#36`) مع نجاح `npx eslint firestore.rules` (`0` أخطاء) ونجاح التحقق النحوي والتجميعي `esbuild + node --check`.
- [x] **الخطوة 6.5 — التحقق النهائي والتوقف عند «بوابة القواعد» (`⏸️ متوقف عند بوابة القواعد`)**
  - اجتياز `npm test`: **106/106** اختبار وحدة بنجاح.
  - اجتياز `npx eslint firestore.rules`: **0** أخطاء أو تحذيرات.
  - اجتياز `npx esbuild firestore.rules.test.ts --bundle --platform=node --format=esm --outfile=/tmp/rules-test.mjs && node --check /tmp/rules-test.mjs`: نجاح التحقق النحوي والتجميعي للـ **36** حالة اختبار أمنية (`#1–#36`). (تعذّر تشغيل محاكي القواعد المحلي `firebase emulators:exec` لعدم توفر `java` داخل الحاوية).
  - اجتياز `compile_applet` و`lint_applet` و`npm run build` وإعادة تشغيل الخادم بنجاح.
  - التحقق الحي في Chromium عبر `playwright-cli` (`360×780` و`1440×900`): `0` أخطاء كونسول، `0px` طفح أفقي، `0` ظهور لكلمة FIFA/فيفا، والتحقق من تفعيل وضع الانضمام `'approval'` افتراضياً وتوفر كافة نوافذ وشريط تبديل الفرق.
  - تقدير استهلاك Spark اليومي (`10` فرق × `15` لاعباً × `3` فتحات = `450` جلسة/يوم): نحو **`~1,450–2,700` قراءة يومياً** بفضل `persistentLocalCache` ومستمع دائم واحد (`teams/{teamId}`) ومستمعات تبويب كسولة وحدّ `limit(20)` — أي أقل من **`6%`** من حد Spark المجاني (`50,000` قراءة/يوم).
  - **حالة النشر:** ⏸️ متوقف تماماً عند **«بوابة القواعد»** — لم يتم استدعاء `deploy_firebase` أو `DeployRules` أو تشغيل أي هجرة بيانات فعلية بانتظار عبارة **«انشر القواعد»**.

---

# سجل التقدم — تجهيز الإطلاق التجاري (Production Release Readiness & Hardening)

تاريخ التنفيذ: 2026-11-26
النسخة الاحتياطية قبل البدء: `backups/release-hardening-before/`
التقرير الكامل: `RELEASE_READINESS_REPORT.md`

- [x] **النسخة الاحتياطية وفحص الأسرار:** حفظ نسخة تراجع كاملة في `backups/release-hardening-before/` وتأكيد خلو المستودع من أي أسرار أو مفاتيح خاصة.
- [x] **TypeScript Strict (`tsconfig.json`) وإصلاحات فعلية:** `npm run typecheck` (`0` أخطاء، صفر `any`/`@ts-ignore`) مع إصلاح `s.roleGroup` في `src/tacticsLayout.ts` والمفتاح المكرر في `src/backend.ts`.
- [x] **تحصين الخصوصية للأجهزة المشتركة (`src/localCachePrivacy.ts` و`src/firebase.ts` و`src/backend.ts`):** اعتماد `memoryLocalCache()` افتراضياً، وتفعيل `persistentLocalCache()` اختيارياً للأجهزة الشخصية فقط من إعدادات الفريق، ومسح شامل لمفاتيح التخزين المحلي والـ SW عند تسجيل الخروج.
- [x] **App Check اختياري + تشخيص الاتصال + حذف الحساب والشفافية القانونية:** إضافة `ReCaptchaV3Provider` الاختياري عبر `VITE_RECAPTCHA_SITE_KEY` (في `.env.example` فارغاً بدون Enforcement)، ودالة `deleteMyAccountAndData()` بحذف من خطوتين (كتابة `حذف`)، وتوسيع `#privacyNoticeModal` بسياسة الخصوصية والشروط وإفصاح `/private/*` وبريد الدعم `ammarfara210@gmail.com`.
- [x] **إصلاحات قواعد Firestore الحرجة وتشغيل المحاكي الفعلي (`41/41` ناجح):**
  - حل تجاوز سقف الـ 1,000 تعبير في `firestore.rules`، وإضافة فحص `resource != null` في سطر 1846، ونقل منفذ المحاكي إلى `127.0.0.1:8089` لتجنب تعارض Nginx على `8080`.
  - اجتياز **41/41** اختباراً على محاكي Firestore الفعلي (`#1–#36` + حالات التحصين الجديدة `#37–#42` شاملة محاكاة هجرة كاملة من `main` إلى `teams/{tid}`).
- [x] **تحسين الأصول والـ PWA وCI:** ضغط الشعار من `3.0 MB` إلى `69 KB` WebP (`97.7%` توفير)، وتحديث `public/sw.js` (`maydan-static-v3`) و`firebase.json` (Hosting)، وإضافة `/.github/workflows/ci.yml` الصارم والتحقق من تطابق `bun.lock`.
- [x] **التحقق الشامل:** `npm run typecheck` (0 أخطاء)، `npm run lint` (0 أخطاء)، `npm test` (**110/110**)، محاكي القواعد (**41/41**)، `npm run build` (ناجح)، واختبار Chromium E2E على المقاسات `360/390/412/1440` (`0` أخطاء، `0px` طفح، `0` ظهور لـ FIFA/فيفا، `0` مفاتيح متبقية بعد الخروج).
- **الحالة النهائية:** **`READY FOR CLOSED BETA`** — لم يتم نشر القواعد أو الاستضافة تلقائياً؛ راجع قائمة خطوات Firebase Console اليدوية في `RELEASE_READINESS_REPORT.md`.

---

# سجل التقدم — المرحلة النهائية للتطوير والاستقرار (FINAL DEVELOPMENT PHASE — MIDAN 6v6)

تاريخ التنفيذ: 2026-11-26

- [x] **الإصلاحات الأمنية والتقنية المعروفة (3A–3G):**
  - **3A (`deleteMyAccountAndData` في `src/backend.ts` و`src/localCachePrivacy.ts`):** التمييز الصارم بين `not-found` وأخطاء الصلاحيات/الشبكة عبر `deleteDocIfExistsStrict()` و`classifyAccountCleanupError()`؛ منع حذف Firebase Auth عند فشل أي خطوة تنظيف لازمة في Firestore؛ وإرجاع تقرير فشل جزئي مع زر إعادة المحاولة الآمنة في `#teamSettingsModal`.
  - **3B (استمرارية الجلسة للأجهزة المشتركة في `src/firebase.ts` و`src/backend.ts` و`index.html`):** اعتماد `browserSessionPersistence` افتراضياً؛ إتاحة خيار صريح `#chkRememberDevice` في شاشة الدخول ومفتاح `#btnToggleAuthPersist` في إعدادات الفريق لتفعيل `browserLocalPersistence` للأجهزة الشخصية فقط.
  - **3C (الكاش المحلي للقطات الفريق في `src/backend.ts` و`src/localCachePrivacy.ts`):** توجيه `saveTeamSnapshotCache()` و`loadTeamSnapshotCache()` إلى `sessionStorage` افتراضياً مع مسح `maydan_team_cache_v1*` من `localStorage` (`purgePersistentTeamSnapshots`)، وحصر الكتابة في `localStorage` عند تفعيل وضع الجهاز الموثوق فقط مع الحفاظ على تفضيلات الواجهة غير الحساسة.
  - **3D (الانتقال الآمن من التخزين الدائم إلى الذاكرة المؤقتة في `src/firebase.ts` و`src/backend.ts`):** تنفيذ `disableTrustedDeviceCacheSafely()` بإيقاف المستمعين ثم `terminate(db)` ثم `clearIndexedDbPersistence(db)`، والإبلاغ الصريح والصادق عند تعذّر مسح IndexedDB (`#tsCacheStatusNote`).
  - **3E (تنظيف المستودع):** حذف `/firestore-debug.log` وإضافة `/.gitignore` مع الحفاظ على `backups/` و`bun.lock`.
  - **3F (حالة App Check الدقيقة في `src/firebase.ts`):** دورة حياة رباعية (`'unconfigured' | 'initializing' | 'active' | 'failed'`) ترفض القيم الوهمية عبر `isValidRecaptchaSiteKey()` ولا تُبلغ عن `active` إلا بعد نجاح `initializeAppCheck()`؛ مع بقاء `VITE_RECAPTCHA_SITE_KEY` اختيارياً بالكامل.
  - **3G (حصر الحضور والجاهزية بتاريخ المباراة القادمة في `src/preMatchHub.ts` و`src/preMatchHub.test.ts` و`index.html`):** إضافة `resolveMatchScopedAttendance()` و`findMatchScopedReadiness()` و`computeNextActionState()`؛ عزل سجلات المباريات السابقة والقديمة غير المؤرخة عن العداد ورسائل واتساب والتنبيهات وبطاقة الخطوة التالية، مع اختبارات تراجع مخصصة.
- [x] **ترقية تجربة المستخدم والواجهة والموبايل (4A–6):**
  - تحويل الشاشة الرئيسية (`#tab-team`) إلى **مركز قيادة الفريق (Team Command Center)** مع لافتة المباراة القادمة، ومؤشرات الحضور المحصورة بالمباراة، وأزرار الحضور بلمسة واحدة مع إبراز الحالة المختارة (`.is-selected`)، ونقل وتوحيد `#nextActionCard` (إزالة التكرار من `#tab-fifa`)، و4 اختصارات سريعة (`[data-cmd-tab]`).
  - إبقاء 5 تبويبات سفلية (تسمية `الإحصائيات` بدلاً من `اللوحة`) وتنظيم `#moreSheet` إلى 3 مجموعات واضحة (`المباراة والجاهزية`، `التطوير والترفيه`، `الفريق والخصوصية`).
  - تحسين استوديو التكتيك على الهواتف عبر أكورديونات `<details>` قابلة للطي (`#tacScenariosAccordion` و`#tacCaptainAccordion`) مطوية تلقائياً على شاشات `< 768px` (مع احترام النقر اليدوي وتوسّع تلقائي على الشاشات العريضة) دون المساس بأي ميزة تكتيكية أو Pointer Events.
- [x] **التحقق الشامل بعد آخر تعديل:**
  - `npm run typecheck`: **0** أخطاء.
  - `npm run lint` (`check-html.mjs` + `eslint firestore.rules`): **0** أخطاء.
  - `npm test`: **116/116** اختبار وحدة ناجح.
  - `firebase emulators:exec --only firestore --project maydan-6v6-rules-test "npm run test:rules"`: **41/41** اختبار قواعد أمان ناجح على المحاكي الحقيقي.
  - `npm run build` (`compile_applet`): ناجح.
  - تحقق Chromium حقيقي عبر `playwright-cli` على المقاسات `360×780` و`390×844` و`412×915` و`1440×900`: **0** أخطاء كونسول/صفحة، **0px** طفح أفقي، **0** ظهور لكلمة FIFA/فيفا، تأكيد `chkRememberDevice` غير محدد افتراضياً، تأكيد تحديث الحضور المحصور بالمباراة (`2 -> 1 -> 2`)، تأكيد طي أكورديونات التكتيك على `390×844` وفتحها عند النقر، وتأكيد خلو `localStorage` من `maydan_team_cache_v1*` في الوضع الآمن وبعد الخروج.
- **حالة النشر:** لم يتم نشر قواعد أو استضافة على الإنتاج تلقائياً — جاهز للمراجعة اليدوية والإطلاق التدريجي (Closed Beta).


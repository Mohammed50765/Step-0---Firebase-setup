import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LIBRARY_CATEGORIES,
  LIBRARY_LEVELS,
  STARTER_FOOTBALL_LIBRARY,
  CORE_GLOSSARY_HIGHLIGHTS,
  sanitizeSourceUrl,
  filterLibraryArticles,
  mergeLibraryArticles,
  validateArticleInput,
  parseGlossaryInput,
} from './footballLibrary';

test('Starter Global Football Library covers all 13 categories with valid HTTPS sources and zero FIFA visible text', () => {
  assert.equal(LIBRARY_CATEGORIES.length, 13);
  assert.ok(STARTER_FOOTBALL_LIBRARY.length >= 13);

  const coveredCategories = new Set(STARTER_FOOTBALL_LIBRARY.map((a) => a.category));
  for (const cat of LIBRARY_CATEGORIES) {
    assert.ok(coveredCategories.has(cat), `Missing starter article for category: ${cat}`);
  }

  for (const art of STARTER_FOOTBALL_LIBRARY) {
    assert.ok(art.titleAr.length >= 10, `Title too short: ${art.id}`);
    assert.ok(art.summaryAr.length >= 50, `Summary too short: ${art.id}`);
    assert.ok(art.publisher.length >= 3, `Publisher missing: ${art.id}`);
    assert.ok(sanitizeSourceUrl(art.sourceUrl).startsWith('https://'), `Invalid source URL: ${art.id}`);
    assert.ok((LIBRARY_LEVELS as readonly string[]).includes(art.level), `Invalid level: ${art.id}`);
    assert.ok(art.terms.length >= 2, `Missing English tactical terms: ${art.id}`);
    assert.ok(art.originalExcerpt.length >= 20, `Missing short original excerpt: ${art.id}`);

    const combinedText = JSON.stringify(art);
    assert.ok(!/fifa|فيفا/i.test(combinedText), `Found forbidden FIFA text in ${art.id}`);
  }
});

test('Core tactical English terms requested by user are present in glossary and articles', () => {
  const allTerms = [
    ...CORE_GLOSSARY_HIGHLIGHTS,
    ...STARTER_FOOTBALL_LIBRARY.flatMap((a) => a.terms),
  ].map((t) => t.en.toLowerCase());

  for (const required of ['counter-pressing', 'through ball', 'off the ball movement', 'first touch']) {
    assert.ok(allTerms.includes(required), `Missing required English tactical term: ${required}`);
  }
});

test('sanitizeSourceUrl blocks javascript:, data:, http:, and malformed URLs', () => {
  assert.equal(sanitizeSourceUrl('javascript:alert(1)'), '');
  assert.equal(sanitizeSourceUrl('data:text/html,<script>alert(1)</script>'), '');
  assert.equal(sanitizeSourceUrl('http://example.com/article'), '');
  assert.equal(sanitizeSourceUrl('not-a-url'), '');
  assert.equal(
    sanitizeSourceUrl('https://www.theifab.com/laws-of-the-game-documents/'),
    'https://www.theifab.com/laws-of-the-game-documents/'
  );
});

test('filterLibraryArticles enforces publish visibility for players vs captains and supports English/Arabic search', () => {
  const hiddenCustom = validateArticleInput({
    id: 'lib_draft_secret',
    titleAr: 'مسودة تكتيكية خاصة بالكابتن',
    publisher: 'UEFA Coaching',
    sourceUrl: 'https://www.uefa.com/development/coaches/',
    summaryAr: 'ملخص تدريبي مسودة لم يُنشر بعد لبقية أعضاء الفريق حتى تكتمل المراجعة.',
    category: 'التكتيكات والخطط',
    level: 'متقدم',
    published: false,
    terms: [{ en: 'Overload', ar: 'التفوق العددي الموضعي' }],
  });
  assert.equal(hiddenCustom.ok, true);

  const merged = mergeLibraryArticles([hiddenCustom.article!]);
  const playerVisible = filterLibraryArticles(merged, { includeHidden: false });
  const captainVisible = filterLibraryArticles(merged, { includeHidden: true });
  assert.equal(playerVisible.some((a) => a.id === 'lib_draft_secret'), false);
  assert.equal(captainVisible.some((a) => a.id === 'lib_draft_secret'), true);

  const byEnglishTerm = filterLibraryArticles(merged, { query: 'Counter-Pressing', includeHidden: false });
  assert.ok(byEnglishTerm.some((a) => a.id === 'lib_counter_pressing'));

  const byLevel = filterLibraryArticles(merged, { level: 'مبتدئ', includeHidden: false });
  assert.ok(byLevel.length >= 4);
  assert.ok(byLevel.every((a) => a.level === 'مبتدئ'));
});

test('validateArticleInput and parseGlossaryInput reject invalid fields cleanly', () => {
  const badUrl = validateArticleInput({
    titleAr: 'عنوان سليم للتجربة',
    publisher: 'The FA',
    sourceUrl: 'javascript:alert(1)',
    summaryAr: 'ملخص طويل كافٍ لاختبار رفض الرابط غير الآمن.',
  });
  assert.equal(badUrl.ok, false);

  const shortSummary = validateArticleInput({
    titleAr: 'عنوان سليم',
    publisher: 'The FA',
    sourceUrl: 'https://learn.englandfootball.com/',
    summaryAr: 'قصير',
  });
  assert.equal(shortSummary.ok, false);

  const parsedTerms = parseGlossaryInput('Counter-Pressing : الضغط العكسي\nFirst Touch — اللمسة الأولى');
  assert.equal(parsedTerms.length, 2);
  assert.equal(parsedTerms[0].en, 'Counter-Pressing');
  assert.equal(parsedTerms[0].ar, 'الضغط العكسي');
});

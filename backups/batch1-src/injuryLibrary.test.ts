import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getInjuryByIdOrName,
  INJURIES_LIBRARY_9,
  INJURY_DISCLAIMER_AR,
  renderInjuryDetailHtml,
} from './injuryLibrary';

const BANNED_MEDICAL_TERMS = [
  'إيبوبروفين',
  'باراسيتامول',
  'بروفين',
  'بنادول',
  'مسكن',
  'مسكّن',
  'مضاد التهاب',
  'ملغ',
  'قرص',
  'أقراص',
  'كبسولة',
  'جرعة',
  'مرهم طبي',
  'ibuprofen',
  'paracetamol',
  'nsaid',
  'voltaren',
];

test('INJURIES_LIBRARY_9 contains exactly 9 required 6v6 injuries with all 7 structured fields', () => {
  assert.equal(INJURIES_LIBRARY_9.length, 9);

  const ids = new Set<string>();
  for (const item of INJURIES_LIBRARY_9) {
    assert.ok(item.id && !ids.has(item.id), `Duplicate or empty id: ${item.id}`);
    ids.add(item.id);
    assert.ok(item.name.length >= 3);
    assert.ok(item.summary.length >= 20, `Missing summary for ${item.id}`);
    assert.ok(item.causes6v6.length >= 20, `Missing 6v6 causes for ${item.id}`);
    assert.ok(item.warningSigns.length >= 2, `Missing warningSigns for ${item.id}`);
    assert.ok(item.safeFirstAid.length >= 3, `Missing safeFirstAid for ${item.id}`);
    assert.ok(item.seeDoctorNow.length >= 3, `Missing seeDoctorNow for ${item.id}`);
    assert.ok(item.prevention.length >= 3, `Missing prevention for ${item.id}`);
    assert.equal(item.returnStages.length, 4, `Expected 4 gradual return stages for ${item.id}`);
  }
});

test('INJURIES_LIBRARY_9 strictly excludes medication names and dosages', () => {
  const fullCorpus = INJURIES_LIBRARY_9.map((item) =>
    [
      item.name,
      item.summary,
      item.causes6v6,
      ...item.warningSigns,
      ...item.safeFirstAid,
      ...item.seeDoctorNow,
      ...item.prevention,
      ...item.returnStages,
    ].join(' ')
  )
    .join(' ')
    .toLowerCase();

  for (const term of BANNED_MEDICAL_TERMS) {
    assert.equal(
      fullCorpus.includes(term.toLowerCase()),
      false,
      `Found banned medical/drug term "${term}" in injury library`
    );
  }
  assert.ok(INJURY_DISCLAIMER_AR.includes('ليس تشخيصاً طبياً'));
});

test('renderInjuryDetailHtml includes all 7 sections and prominent doctor warning box', () => {
  const ankle = getInjuryByIdOrName('التواء الكاحل');
  assert.ok(ankle);
  const html = renderInjuryDetailHtml(ankle);
  assert.ok(html.includes('1. وصف مبسّط'));
  assert.ok(html.includes('2. الأسباب الشائعة في ملاعب السداسي'));
  assert.ok(html.includes('3. الأعراض التحذيرية'));
  assert.ok(html.includes('4. الإسعاف الأولي الآمن'));
  assert.ok(html.includes('5. متى تراجع الطبيب فوراً'));
  assert.ok(html.includes('6. الوقاية قبل وأثناء المباراة'));
  assert.ok(html.includes('7. مراحل العودة التدريجية للّعب'));
  assert.ok(html.includes('alert-danger'));
  assert.ok(html.includes('btnLogThisInjury'));
});

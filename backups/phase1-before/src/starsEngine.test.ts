import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GLOBAL_STARS_30,
  findGlobalTwins,
  computePlayerDNA,
  computePlayStyles,
  computeRoleModelGap,
  computeTierInfo,
  generateCommentatorCall,
} from './starsEngine';
import { SKILL_KEYS } from './security';

test('GLOBAL_STARS_30 contains exactly 30 stars with exact category counts and valid 1-10 skills', () => {
  assert.equal(GLOBAL_STARS_30.length, 30);

  const gk = GLOBAL_STARS_30.filter((s) => s.category === 'حراس مرمى');
  const def = GLOBAL_STARS_30.filter((s) => s.category === 'مدافعون وأظهرة');
  const mid = GLOBAL_STARS_30.filter((s) => s.category === 'لاعبو وسط');
  const fwd = GLOBAL_STARS_30.filter((s) => s.category === 'أجنحة ومهاجمون');

  assert.equal(gk.length, 5);
  assert.equal(def.length, 8);
  assert.equal(mid.length, 8);
  assert.equal(fwd.length, 9);

  const ids = new Set<string>();
  for (const star of GLOBAL_STARS_30) {
    assert.ok(!ids.has(star.id), `Duplicate star id: ${star.id}`);
    ids.add(star.id);
    for (const k of SKILL_KEYS) {
      const v = star.skills[k];
      assert.ok(v >= 1 && v <= 10, `Invalid skill ${k}=${v} for ${star.name}`);
    }
  }
});

test('findGlobalTwins returns top 3 unique descending matches and matches exact star profile #1', () => {
  const messi = GLOBAL_STARS_30.find((s) => s.id === 'messi')!;
  const twins = findGlobalTwins(messi.skills, 'جناح', 3);
  assert.equal(twins.length, 3);
  assert.equal(twins[0].star.id, 'messi');
  assert.ok(twins[0].matchPct >= 95);
  assert.ok(twins[0].matchPct >= twins[1].matchPct);
  assert.ok(twins[1].matchPct >= twins[2].matchPct);
  assert.equal(new Set(twins.map((t) => t.star.id)).size, 3);

  const courtois = GLOBAL_STARS_30.find((s) => s.id === 'courtois')!;
  const gkTwins = findGlobalTwins(courtois.skills, 'حارس مرمى', 3);
  assert.equal(gkTwins[0].star.id, 'courtois');
});

test('computePlayerDNA returns bounded axes and appropriate Arabic archetype', () => {
  const gkDna = computePlayerDNA({ passing: 8, control: 8, defending: 8, positioning: 8 }, 'حارس مرمى');
  assert.ok(gkDna.title.includes('الحارس'));
  assert.ok(gkDna.axes.solidity >= 0 && gkDna.axes.solidity <= 100);

  const creatorDna = computePlayerDNA(
    { speed: 6, shooting: 6, passing: 9, dribbling: 9, defending: 4, stamina: 7, vision: 9, teamwork: 8, control: 9, positioning: 7 },
    'لاعب وسط'
  );
  assert.ok(creatorDna.title.includes('مهندس'));
});

test('computePlayStyles unlocks PlayStyle+ badges for elite skills and verified match stats', () => {
  const badges = computePlayStyles(
    { speed: 9, shooting: 9, passing: 8, dribbling: 7, defending: 5, stamina: 7, vision: 8, teamwork: 7, control: 7, positioning: 7 },
    'مهاجم',
    { goals: 4, assists: 1 }
  );
  assert.ok(badges.some((b) => b.id === 'rapid' && b.plus));
  assert.ok(badges.some((b) => b.id === 'finesse' && b.plus));
  assert.ok(badges.some((b) => b.id === 'poacher' && b.plus));
  assert.ok(badges.length <= 4);
});

test('computeRoleModelGap calculates readiness and sorted skill gaps safely', () => {
  assert.equal(computeRoleModelGap({}, 'non_existent_star'), null);
  const gap = computeRoleModelGap(
    { speed: 6, shooting: 5, passing: 8, dribbling: 7, defending: 4, stamina: 7, vision: 7, teamwork: 7, control: 7, positioning: 6 },
    'mbappe'
  )!;
  assert.equal(gap.star.id, 'mbappe');
  assert.ok(gap.readinessPct > 40 && gap.readinessPct < 100);
  assert.equal(gap.topGaps.length, 3);
  assert.ok(gap.topGaps[0].gap >= gap.topGaps[1].gap);
});

test('computeTierInfo and generateCommentatorCall reflect progression cleanly', () => {
  const bronze = computeTierInfo(64, 20, 0);
  const gold = computeTierInfo(76, 80, 2);
  const icon = computeTierInfo(88, 300, 10);
  assert.ok(bronze.rank < gold.rank && gold.rank < icon.rank);

  const call = generateCommentatorCall({
    playerName: 'عمار',
    ovr: 79,
    tierLabel: gold.tierLabel,
    twinName: 'بيدري',
    twinPct: 91,
    dnaTitle: 'مهندس المساحات الضيقة',
  });
  assert.ok(call.commentary.includes('عمار'));
  assert.ok(call.commentary.includes('بيدري'));
  assert.ok(call.commentary.includes('91%'));
});

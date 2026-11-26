import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TACTICAL_COMPARISONS_6V6,
  getComparisonById,
  findDefaultComparisonForPhase,
  buildComparisonSequence,
} from './tacticsComparisons';

test('TACTICAL_COMPARISONS_6V6 provides 5+ complete Mistake vs Correct 6v6 animations with valid coordinates and zero FIFA text', () => {
  assert.ok(TACTICAL_COMPARISONS_6V6.length >= 5);

  for (const cmp of TACTICAL_COMPARISONS_6V6) {
    assert.ok(cmp.id.length > 2);
    assert.ok(cmp.title.length > 4);
    assert.ok(cmp.quickRule.length > 8);
    assert.ok(!/fifa|فيفا/i.test(JSON.stringify(cmp)), `Found forbidden FIFA word in ${cmp.id}`);

    for (const variant of ['mistake', 'correct'] as const) {
      const side = cmp[variant];
      assert.equal(side.variant, variant);
      assert.ok(side.frames.length >= 3, `${cmp.id}.${variant} should have >= 3 frames`);

      for (const fr of side.frames) {
        assert.equal(fr.ourPos.length, 6, `${cmp.id}.${variant} must have 6 ourPos`);
        assert.equal(fr.oppPos.length, 6, `${cmp.id}.${variant} must have 6 oppPos`);
        assert.ok(fr.narration.trim().length > 10);
        for (const p of [...fr.ourPos, ...fr.oppPos, fr.ball]) {
          assert.ok(p.x >= 0 && p.x <= 100, `x out of bounds in ${cmp.id}`);
          assert.ok(p.y >= 0 && p.y <= 100, `y out of bounds in ${cmp.id}`);
        }
      }
    }

    // Mistake variant should highlight danger ('rose') zone while Correct variant highlights safe ('emerald'/'gold') zone
    const mistakeHasRose = cmp.mistake.frames.some((f) => f.zones?.some((z) => z.color === 'rose'));
    const correctHasSafe = cmp.correct.frames.some((f) => f.zones?.some((z) => z.color === 'emerald' || z.color === 'gold'));
    assert.equal(mistakeHasRose, true, `${cmp.id}.mistake should mark a rose danger zone`);
    assert.equal(correctHasSafe, true, `${cmp.id}.correct should mark a safe emerald/gold zone`);
  }
});

test('getComparisonById, findDefaultComparisonForPhase, and buildComparisonSequence work cleanly', () => {
  const def = findDefaultComparisonForPhase('defend');
  assert.equal(def.id, 'defensive_ball_watching');

  const corner = findDefaultComparisonForPhase('setpieces');
  assert.equal(corner.id, 'corner_marking');

  const fallback = getComparisonById('unknown_id');
  assert.equal(fallback.id, TACTICAL_COMPARISONS_6V6[0].id);

  const seqMistake = buildComparisonSequence(def, 'mistake');
  const seqCorrect = buildComparisonSequence(def, 'correct');
  assert.equal(seqMistake.size, '6v6');
  assert.equal(seqMistake.offsideEnabled, false);
  assert.ok(seqMistake.title.includes('الخطأ الشائع'));
  assert.ok(seqCorrect.title.includes('التصحيح التكتيكي'));
});

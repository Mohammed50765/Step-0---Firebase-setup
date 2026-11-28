import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BLACK_BOX_SCENARIOS,
  getBlackBoxScenarioById,
  getCinemaTimelineBounds,
  sampleBlackBoxTimeline,
  evaluateBlackBoxChallenge,
} from './blackBoxCinema';

test('BLACK_BOX_SCENARIOS provides both MVP scenarios backed by canonical comparisons', () => {
  assert.equal(BLACK_BOX_SCENARIOS.length, 2);
  const s1 = getBlackBoxScenarioById('buildup_under_pressure');
  const s2 = getBlackBoxScenarioById('defensive_cover_space');
  assert.equal(s1.comparisonId, 'buildup_bunching');
  assert.equal(s2.comparisonId, 'defensive_ball_watching');

  for (const sc of [s1, s2]) {
    assert.ok(sc.mistakeFrames.length >= 2);
    assert.ok(sc.correctFrames.length >= 2);
    assert.equal(sc.formationId, '2-2-1');
    assert.ok(sc.challenge.candidateZones.length >= 3);
    assert.ok(sc.challenge.candidateZones.some((z) => z.isCorrect));
    for (const phase of ['setup', 'error', 'freeze', 'rewind', 'correct'] as const) {
      const seg = sc.segments[phase];
      assert.ok(seg.heading.length > 0);
      assert.ok(seg.principle.length > 0);
      assert.ok(seg.instruction.length > 0);
      assert.ok(seg.trigger.length > 0);
      assert.ok(seg.why.length > 0);
      assert.ok(seg.spokenScript.length > 0);
    }
  }
});

test('sampleBlackBoxTimeline traverses all 5 phases and performs REAL backward keyframe rewind', () => {
  for (const sc of BLACK_BOX_SCENARIOS) {
    const { bounds, totalMs } = getCinemaTimelineBounds(sc);
    assert.equal(bounds.length, 5);
    assert.deepEqual(
      bounds.map((b) => b.phase),
      ['setup', 'error', 'freeze', 'rewind', 'correct']
    );
    assert.ok(totalMs > 15000);

    // 1. Setup phase
    const setupSample = sampleBlackBoxTimeline(sc, bounds[0].startMs + 200);
    assert.equal(setupSample.phase, 'setup');
    assert.equal(setupSample.isRewinding, false);
    assert.equal(setupSample.isFrozen, false);

    // 2. Error phase
    const errorSample = sampleBlackBoxTimeline(sc, bounds[1].startMs + bounds[1].durationMs * 0.6);
    assert.equal(errorSample.phase, 'error');
    assert.equal(errorSample.emphasis, 'mistake');

    // 3. Freeze phase holds exact freeze keyframe coordinates steady
    const freezeStart = sampleBlackBoxTimeline(sc, bounds[2].startMs + 100);
    const freezeEnd = sampleBlackBoxTimeline(sc, bounds[2].endMs - 100);
    assert.equal(freezeStart.phase, 'freeze');
    assert.equal(freezeStart.isFrozen, true);
    assert.deepEqual(freezeStart.ourPos, freezeEnd.ourPos);
    assert.equal(freezeStart.zones.length, 1);

    // 4. REAL REWIND phase: moves backward from freeze frame coordinates back toward setup frame 0
    const rewindStart = sampleBlackBoxTimeline(sc, bounds[3].startMs + 10);
    const rewindMid = sampleBlackBoxTimeline(sc, bounds[3].startMs + bounds[3].durationMs * 0.5);
    const rewindEnd = sampleBlackBoxTimeline(sc, bounds[3].endMs - 10);

    assert.equal(rewindStart.phase, 'rewind');
    assert.equal(rewindStart.isRewinding, true);
    assert.equal(rewindStart.emphasis, 'rewind');
    // Display timecode must move backward during rewind
    assert.ok(
      rewindStart.displaySeconds > rewindMid.displaySeconds && rewindMid.displaySeconds >= rewindEnd.displaySeconds,
      `Expected rewind displaySeconds to decrease: ${rewindStart.displaySeconds} -> ${rewindMid.displaySeconds} -> ${rewindEnd.displaySeconds}`
    );

    // Key player coordinates must actually reverse from freeze frame back to initial frame 0
    const pIdx = sc.challenge.playerIndex;
    const f0 = sc.mistakeFrames[0].ourPos[pIdx];
    const fFreeze = sc.mistakeFrames[sc.freezeFrameIndex].ourPos[pIdx];
    const distStartToFreeze = Math.hypot(rewindStart.ourPos[pIdx].x - fFreeze.x, rewindStart.ourPos[pIdx].y - fFreeze.y);
    const distEndToSetup = Math.hypot(rewindEnd.ourPos[pIdx].x - f0.x, rewindEnd.ourPos[pIdx].y - f0.y);
    const distMidToSetup = Math.hypot(rewindMid.ourPos[pIdx].x - f0.x, rewindMid.ourPos[pIdx].y - f0.y);

    assert.ok(distStartToFreeze < 2.5, 'Rewind must start right at the freeze frame coordinates');
    assert.ok(distEndToSetup < 2.5, 'Rewind must finish right back at setup frame 0 coordinates');
    assert.ok(
      distMidToSetup > distEndToSetup,
      'Rewind midpoint must continuously interpolate backward rather than snapping'
    );

    // 5. Correct phase
    const correctSample = sampleBlackBoxTimeline(sc, bounds[4].startMs + bounds[4].durationMs * 0.7);
    assert.equal(correctSample.phase, 'correct');
    assert.equal(correctSample.emphasis, 'correct');
    assert.equal(correctSample.isRewinding, false);
  }
});

test('evaluateBlackBoxChallenge classifies correct, mistake_zone, and off_target decisions accurately', () => {
  const s1 = getBlackBoxScenarioById('buildup_under_pressure');
  const resCorrect = evaluateBlackBoxChallenge(s1, { x: s1.challenge.targetZone.x, y: s1.challenge.targetZone.y });
  assert.equal(resCorrect.isCorrect, true);
  assert.equal(resCorrect.outcome, 'correct');

  const resMistake = evaluateBlackBoxChallenge(s1, { x: s1.challenge.mistakeZone.x, y: s1.challenge.mistakeZone.y });
  assert.equal(resMistake.isCorrect, false);
  assert.equal(resMistake.outcome, 'mistake_zone');

  const resOff = evaluateBlackBoxChallenge(s1, { x: 12, y: 20 });
  assert.equal(resOff.isCorrect, false);
  assert.equal(resOff.outcome, 'off_target');

  const s2 = getBlackBoxScenarioById('defensive_cover_space');
  const res2Correct = evaluateBlackBoxChallenge(s2, { x: 48, y: 76 });
  assert.equal(res2Correct.isCorrect, true);
  assert.equal(res2Correct.outcome, 'correct');

  const res2Mistake = evaluateBlackBoxChallenge(s2, { x: 66, y: 64 });
  assert.equal(res2Mistake.isCorrect, false);
  assert.equal(res2Mistake.outcome, 'mistake_zone');
});

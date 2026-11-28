import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateBlindSideScenario,
  evaluateBlindSideDecision,
  summarizeBlindSideSession,
  getDifficultyTimings,
  type BlindSideRoundOutcome,
} from './blindSideRadar';

test('getDifficultyTimings tightens peek and decision windows as difficulty progresses', () => {
  const l1 = getDifficultyTimings(1);
  const l2 = getDifficultyTimings(2);
  const l3 = getDifficultyTimings(3);
  assert.ok(l1.peekMs > l2.peekMs && l2.peekMs > l3.peekMs);
  assert.ok(l1.decisionMs > l2.decisionMs && l2.decisionMs > l3.decisionMs);
});

test('generateBlindSideScenario avoids repeating recent scenario keys', () => {
  const recent: string[] = [];
  let seed = 0.13;
  const rng = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  for (let i = 0; i < 5; i++) {
    const sc = generateBlindSideScenario(2, recent, rng);
    assert.ok(!recent.includes(sc.scenarioKey), `Repeated key ${sc.scenarioKey}`);
    assert.equal(sc.our.length, 6);
    assert.equal(sc.opp.length, 6);
    assert.ok(sc.maskedOppIndices.length >= 1);
    assert.ok(sc.audioCue.pan >= -1 && sc.audioCue.pan <= 1);
    recent.push(sc.scenarioKey);
  }
});

test('evaluateBlindSideDecision and summarizeBlindSideSession compute accuracy, response time, and top error', () => {
  const sc = generateBlindSideScenario(1, [], () => 0.25);
  const okOutcome = evaluateBlindSideDecision(sc, sc.bestDecision, 1100);
  assert.equal(okOutcome.correct, true);
  assert.equal(okOutcome.mistakeType, null);

  const timeoutOutcome = evaluateBlindSideDecision(sc, null, sc.decisionMs);
  assert.equal(timeoutOutcome.timedOut, true);
  assert.equal(timeoutOutcome.mistakeType, 'timeout');

  const wrongChoice = sc.bestDecision === 'pass_direct' ? 'turn_away' : 'pass_direct';
  const wrongOutcome = evaluateBlindSideDecision(sc, wrongChoice, 1900);

  const outcomes: BlindSideRoundOutcome[] = [okOutcome, timeoutOutcome, wrongOutcome];
  const summary = summarizeBlindSideSession(outcomes);
  assert.equal(summary.totalRounds, 3);
  assert.equal(summary.correctCount, 1);
  assert.equal(summary.avgResponseMs, 1500);
  assert.equal(summary.fastestResponseMs, 1100);
  assert.ok(summary.disclaimerAr.includes('ليس فحصاً طبياً'));
});

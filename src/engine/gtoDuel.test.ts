import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGtoDuelState,
  stepGtoDuel,
  computePredictabilityAssessment,
  summarizeGtoDuelSession,
  MIN_PREDICTABILITY_SAMPLES,
} from './gtoDuel';

test('adaptive defender increases weight on repeatedly chosen player move', () => {
  let state = createGtoDuelState();
  const initialWeight = state.stance.weights.inside_cut;

  for (let i = 0; i < 4; i++) {
    state = stepGtoDuel(state, 'inside_cut', () => 0.99).nextState;
  }

  assert.ok(
    state.stance.weights.inside_cut > initialWeight + 0.2,
    `Expected defender to adapt strongly to repeated inside_cut (${initialWeight} -> ${state.stance.weights.inside_cut})`
  );
  assert.equal(state.stance.anticipatedMove, 'inside_cut');
});

test('predictability assessment guards tiny samples and detects high repetition after >= 5 rounds', () => {
  let state = createGtoDuelState();
  for (let i = 0; i < MIN_PREDICTABILITY_SAMPLES - 1; i++) {
    state = stepGtoDuel(state, 'inside_cut', () => 0.5).nextState;
  }
  const smallSample = computePredictabilityAssessment(state.history);
  assert.equal(smallSample.sufficientSample, false);
  assert.equal(smallSample.predictabilityPct, null);

  // Add 1 more round -> crosses MIN_PREDICTABILITY_SAMPLES
  state = stepGtoDuel(state, 'inside_cut', () => 0.5).nextState;
  const repeated = computePredictabilityAssessment(state.history);
  assert.equal(repeated.sufficientSample, true);
  assert.ok((repeated.predictabilityPct ?? 0) >= 85);

  // Compare with a perfectly diversified 8-round sequence
  let diverse = createGtoDuelState();
  const seq = [
    'inside_cut',
    'outside_line',
    'feint_burst',
    'pass_keep',
    'outside_line',
    'feint_burst',
    'inside_cut',
    'pass_keep',
  ] as const;
  for (const act of seq) {
    diverse = stepGtoDuel(diverse, act, () => 0.85).nextState;
  }
  const divAssess = computePredictabilityAssessment(diverse.history);
  assert.equal(divAssess.sufficientSample, true);
  assert.ok((divAssess.predictabilityPct ?? 100) <= 15);
});

test('summarizeGtoDuelSession provides actionable advice and honest non-Nash disclaimer', () => {
  let state = createGtoDuelState();
  for (let i = 0; i < 6; i++) {
    state = stepGtoDuel(state, i % 2 === 0 ? 'inside_cut' : 'feint_burst', () => 0.6).nextState;
  }
  const summary = summarizeGtoDuelSession(state);
  assert.equal(summary.totalRounds, 6);
  assert.ok(summary.diversificationTipAr.length > 10);
  assert.ok(summary.disclaimerAr.includes('ليس حاسباً رياضياً لتوازن ناش'));
});

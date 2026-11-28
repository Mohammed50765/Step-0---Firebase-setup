import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeDominanceXRay,
  computePitchControlGrid,
  computeCoverShadows,
  analyzePassingLanes,
} from './dominanceXRay';
import { estimateArrivalTimeSec, type PitchPoint } from './tacticalGeometry';

const BASE_OUR: PitchPoint[] = [
  { x: 50, y: 90 },
  { x: 28, y: 72 },
  { x: 72, y: 72 },
  { x: 26, y: 48 },
  { x: 74, y: 48 },
  { x: 50, y: 26 },
];

const BASE_OPP: PitchPoint[] = [
  { x: 50, y: 11 },
  { x: 32, y: 28 },
  { x: 68, y: 28 },
  { x: 28, y: 50 },
  { x: 72, y: 50 },
  { x: 50, y: 66 },
];

test('estimateArrivalTimeSec factors speed & acceleration beyond pure distance', () => {
  const from = { x: 20, y: 50 };
  const to = { x: 80, y: 50 };
  const fast = estimateArrivalTimeSec(from, to, '6v6', {
    reactionSec: 0.2,
    maxSpeedMps: 8.0,
    accelMps2: 6.0,
  });
  const slow = estimateArrivalTimeSec(from, to, '6v6', {
    reactionSec: 0.35,
    maxSpeedMps: 4.5,
    accelMps2: 3.0,
  });
  assert.ok(fast > 0 && slow > fast, 'Faster kinematics profile must arrive significantly sooner');
});

test('computePitchControlGrid produces valid 28x18 control distribution summing to 100%', () => {
  const grid = computePitchControlGrid({
    size: '6v6',
    our: BASE_OUR,
    opp: BASE_OPP,
    ball: { x: 50, y: 60 },
  });
  assert.equal(grid.cols, 28);
  assert.equal(grid.rows, 18);
  assert.equal(grid.cells.length, 28 * 18);
  assert.equal(grid.ourControlPct + grid.oppControlPct, 100);
  for (let i = 0; i < grid.cells.length; i++) {
    assert.ok(grid.cells[i] >= 0 && grid.cells[i] <= 1);
  }
});

test('computeCoverShadows projects geometric shadow behind defender relative to ball', () => {
  const shadows = computeCoverShadows(
    { x: 50, y: 70 },
    [{ x: 50, y: 50 }],
    '6v6'
  );
  assert.equal(shadows.length, 1);
  assert.equal(shadows[0].vertices.length, 4);
  // Shadow far vertices should extend away from ball (toward y < 50)
  const farAvgY = (shadows[0].vertices[1].y + shadows[0].vertices[2].y) / 2;
  assert.ok(farAvgY < 50, `Expected shadow to project behind defender toward y<50, got ${farAvgY}`);
});

test('analyzePassingLanes distinguishes blocked lane behind defender from open flank lane', () => {
  const our: PitchPoint[] = [
    { x: 50, y: 90 },
    { x: 50, y: 70 }, // carrier
    { x: 50, y: 30 }, // teammate directly behind defender
    { x: 86, y: 55 }, // wide open teammate
  ];
  const opp: PitchPoint[] = [
    { x: 50, y: 10 },
    { x: 50, y: 50 }, // sits directly on pass line to teammate #2
  ];
  const { carrierIdx, lanes } = analyzePassingLanes({
    size: '6v6',
    our,
    opp,
    ball: { x: 50, y: 70 },
    carrierIdx: 1,
  });
  assert.equal(carrierIdx, 1);
  const blockedLane = lanes.find((l) => l.toIdx === 2);
  const openLane = lanes.find((l) => l.toIdx === 3);
  assert.ok(blockedLane && openLane);
  assert.equal(blockedLane.status, 'blocked');
  assert.equal(openLane.status, 'open');
  assert.ok(blockedLane.reasonAr.length > 5);
});

test('computeDominanceXRay clamps evaluation to [-5, +5] and emits comparative badge only with baseline', () => {
  const base = computeDominanceXRay({
    size: '6v6',
    our: BASE_OUR,
    opp: BASE_OPP,
    ball: { x: 50, y: 70 },
  });
  assert.ok(base.evaluation.score >= -5 && base.evaluation.score <= 5);
  assert.equal(base.evaluation.comparison, undefined, 'No comparative badge without baseline');
  assert.ok(base.evaluation.reasonsAr.length >= 1);

  // Move opponents far away to create a clearly stronger tactical state
  const improved = computeDominanceXRay(
    {
      size: '6v6',
      our: BASE_OUR,
      opp: BASE_OPP.map((p) => ({ x: 92, y: 12 })),
      ball: { x: 50, y: 50 },
    },
    { baseline: base.evaluation }
  );
  assert.ok(improved.evaluation.comparison, 'Comparative badge should appear when baseline provided');
  assert.ok(improved.evaluation.comparison.delta > 0);
  assert.ok(
    improved.evaluation.comparison.badge === 'brilliant' ||
      improved.evaluation.comparison.badge === 'strong'
  );
});

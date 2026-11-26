import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTimelineMetrics,
  sampleTimeline,
  frameIndexToElapsedMs,
  evalBallArc,
  buildCurvedArrowGeometry,
  buildPartialQuadPath,
  interpolatePoints,
  projectClientToPitchPct,
} from './tacticsEngine';
import type { TacticalKeyframe } from './tacticsData';

function makeMockFrames(count = 4, dur = 2400): TacticalKeyframe[] {
  return Array.from({ length: count }, (_, i) => ({
    title: `خطوة ${i + 1}`,
    narration: `شرح ${i + 1}`,
    durationMs: dur,
    ourPos: [{ x: 20 + i * 15, y: 80 - i * 15 }],
    oppPos: [{ x: 50, y: 20 + i * 10 }],
    ball: { x: 20 + i * 15, y: 80 - i * 15 },
    activeIndices: [0],
    arrows: [],
  }));
}

test('buildTimelineMetrics and sampleTimeline map continuous ms cleanly across frames', () => {
  const frames = makeMockFrames(4, 2000);
  const m = buildTimelineMetrics(frames);

  assert.equal(m.frameCount, 4);
  assert.equal(m.totalMs, 8000);
  assert.deepEqual(m.segmentStarts, [0, 2000, 4000, 6000]);

  const s0 = sampleTimeline(m, 0);
  assert.equal(s0.frameIdx, 0);
  assert.equal(s0.moveT, 1); // Frame 0 starts cleanly in position
  assert.equal(s0.globalProgress, 0);

  // Mid-transition inside frame 1 (starts at 2000ms, moveWindow ~ 880ms)
  const s1Mid = sampleTimeline(m, 2440);
  assert.equal(s1Mid.frameIdx, 1);
  assert.ok(s1Mid.moveT > 0.3 && s1Mid.moveT < 0.7);
  assert.ok(s1Mid.arrowRevealT > 0.5);

  // Dwell portion of frame 1 (1500ms into frame 1 -> moveT settled at 1)
  const s1Dwell = sampleTimeline(m, 3500);
  assert.equal(s1Dwell.frameIdx, 1);
  assert.equal(s1Dwell.moveT, 1);
  assert.equal(s1Dwell.arrowRevealT, 1);

  // End clamping
  const sEnd = sampleTimeline(m, 99999);
  assert.equal(sEnd.frameIdx, 3);
  assert.equal(sEnd.globalProgress, 1);
  assert.equal(frameIndexToElapsedMs(m, 2), 4000);
});

test('evalBallArc keeps short passes flat and adds smooth loft & curve to long passes', () => {
  const shortMid = evalBallArc({ x: 40, y: 50 }, { x: 48, y: 52 }, 0.5);
  assert.equal(shortMid.lift, 0);
  assert.equal(shortMid.scale, 1);

  const longStart = evalBallArc({ x: 20, y: 80 }, { x: 80, y: 30 }, 0);
  const longMid = evalBallArc({ x: 20, y: 80 }, { x: 80, y: 30 }, 0.5);
  const longEnd = evalBallArc({ x: 20, y: 80 }, { x: 80, y: 30 }, 1);

  assert.equal(longStart.x, 20);
  assert.equal(longStart.y, 80);
  assert.equal(longStart.lift, 0);

  assert.equal(longEnd.x, 80);
  assert.equal(longEnd.y, 30);
  assert.equal(longEnd.lift, 0);

  assert.ok(longMid.lift > 0.85);
  assert.ok(longMid.scale > 1.15);
  assert.ok(longMid.shadowDy > 8);
});

test('buildCurvedArrowGeometry computes curved Q path and animated dashOffset', () => {
  const gHalf = buildCurvedArrowGeometry(60, 400, 260, 180, 'run', 0.5);
  const gFull = buildCurvedArrowGeometry(60, 400, 260, 180, 'run', 1);

  assert.ok(gHalf.pathD.startsWith('M 60.0 400.0 Q '));
  assert.ok(gHalf.approxLength > 280);
  assert.ok(Math.abs(gHalf.dashOffset - gHalf.approxLength * 0.5) < 0.5);
  assert.equal(gFull.dashOffset, 0);
  // Curved control point is offset from straight midpoint (160, 290)
  assert.ok(Math.hypot(gHalf.ctrlX - 160, gHalf.ctrlY - 290) > 10);
});

test('buildPartialQuadPath subdivides quadratic curve cleanly at mid progress', () => {
  const path = buildPartialQuadPath(0, 0, 50, 100, 100, 0, 0.5);
  assert.equal(path, 'M 0.0 0.0 Q 25.0 50.0 50.0 50.0');
});

test('interpolatePoints and projectClientToPitchPct clamp and interpolate accurately', () => {
  const pts = interpolatePoints([{ x: 10, y: 90 }], [{ x: 50, y: 30 }], 0.5);
  assert.deepEqual(pts, [{ x: 30, y: 60 }]);

  // Center of a 360x520 rect maps to (50, 50)
  const center = projectClientToPitchPct(280, 360, { left: 100, top: 100, width: 360, height: 520 });
  assert.ok(Math.abs(center.x - 50) < 0.1);
  assert.ok(Math.abs(center.y - 50) < 0.1);

  // Out-of-bounds pointer clamps strictly inside [6..94, 7..94]
  const oob = projectClientToPitchPct(-500, 2000, { left: 100, top: 100, width: 360, height: 520 });
  assert.equal(oob.x, 6);
  assert.equal(oob.y, 94);
});

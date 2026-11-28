import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHRONO_DETENT_THRESHOLD,
  ChronoInvocationGuard,
  computeChronoProgress,
  isChronoDetentReached,
} from './ChronoLockSlider';

test('computeChronoProgress maps RTL right-to-left drag and clamps cleanly to [0, 1]', () => {
  const rtlGeom = { trackWidth: 300, knobWidth: 44, inset: 4, rtl: true };
  // maxTravel = 300 - 44 - 8 = 248
  const start = computeChronoProgress(0, rtlGeom);
  assert.equal(start.progress, 0);
  assert.equal(start.translateX, 0);

  // Dragging wrong direction (positive in RTL) clamps to 0
  const wrongWay = computeChronoProgress(40, rtlGeom);
  assert.equal(wrongWay.progress, 0);
  assert.equal(wrongWay.translateX, 0);

  // Halfway drag left (-124px)
  const half = computeChronoProgress(-124, rtlGeom);
  assert.equal(half.progress, 0.5);
  assert.equal(half.translateX, -124);

  // Dragging beyond rail clamps to 1.0 and -maxTravel
  const full = computeChronoProgress(-400, rtlGeom);
  assert.equal(full.progress, 1);
  assert.equal(full.translateX, -248);
});

test('computeChronoProgress maps LTR left-to-right drag accurately', () => {
  const ltrGeom = { trackWidth: 252, knobWidth: 44, inset: 4, rtl: false };
  // maxTravel = 200
  const at92 = computeChronoProgress(184, ltrGeom);
  assert.equal(at92.progress, 0.92);
  assert.equal(at92.translateX, 184);
  assert.equal(isChronoDetentReached(at92.progress, CHRONO_DETENT_THRESHOLD), true);

  const at90 = computeChronoProgress(180, ltrGeom);
  assert.equal(at90.progress, 0.9);
  assert.equal(isChronoDetentReached(at90.progress, CHRONO_DETENT_THRESHOLD), false);
});

test('ChronoInvocationGuard prevents concurrent double-invocation and enforces cooldown', async () => {
  const guard = new ChronoInvocationGuard(500);
  let calls = 0;

  let releaseFirst!: () => void;
  const firstPromise = guard.run(
    () =>
      new Promise<boolean>((resolve) => {
        calls++;
        releaseFirst = () => resolve(true);
      }),
    1000
  );

  // Concurrent second trigger must be ignored
  const second = await guard.run(() => {
    calls++;
    return true;
  }, 1050);
  assert.equal(second.executed, false);
  assert.equal(guard.isLocked(), true);
  assert.equal(calls, 1);

  releaseFirst();
  const first = await firstPromise;
  assert.equal(first.executed, true);
  assert.equal(first.ok, true);
  assert.equal(guard.isLocked(), false);

  // Trigger immediately during cooldown must be blocked
  const duringCooldown = await guard.run(() => {
    calls++;
    return true;
  }, Date.now() + 100);
  assert.equal(duringCooldown.executed, false);
  assert.equal(calls, 1);

  // After cooldown, trigger succeeds cleanly
  const afterCooldown = await guard.run(() => {
    calls++;
    return true;
  }, Date.now() + 1200);
  assert.equal(afterCooldown.executed, true);
  assert.equal(afterCooldown.ok, true);
  assert.equal(calls, 2);
});

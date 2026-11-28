import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveEntranceProfile,
  computeTunnelAudioGain,
  hasUpcomingMatchWithinHours,
  TunnelEntranceSessionGuard,
} from './tunnelEntrance';
import { ENTRY_AUDIO_SPEC, clampAudioGain, isVibrationSupported } from './entryAudio';
import { mapOrientationToSheen, mapPointerToSheen } from './gyroSheen';

test('resolveEntranceProfile respects reduced-motion, data-saver, repeat session, and low-end devices', () => {
  assert.equal(
    resolveEntranceProfile({
      prefersReducedMotion: true,
      dataSaver: false,
      hardwareConcurrency: 8,
      deviceMemoryGb: 8,
      alreadyPlayedInSession: false,
    }),
    'instant'
  );

  assert.equal(
    resolveEntranceProfile({
      prefersReducedMotion: false,
      dataSaver: true,
      hardwareConcurrency: 8,
      deviceMemoryGb: 8,
      alreadyPlayedInSession: false,
    }),
    'instant'
  );

  assert.equal(
    resolveEntranceProfile({
      prefersReducedMotion: false,
      dataSaver: false,
      hardwareConcurrency: 8,
      deviceMemoryGb: 8,
      alreadyPlayedInSession: true,
    }),
    'instant'
  );

  assert.equal(
    resolveEntranceProfile({
      prefersReducedMotion: false,
      dataSaver: false,
      hardwareConcurrency: 2,
      deviceMemoryGb: 4,
      alreadyPlayedInSession: false,
    }),
    'simplified'
  );

  assert.equal(
    resolveEntranceProfile({
      prefersReducedMotion: false,
      dataSaver: false,
      hardwareConcurrency: 8,
      deviceMemoryGb: 8,
      alreadyPlayedInSession: false,
    }),
    'full'
  );
});

test('computeTunnelAudioGain produces a distant swell, gentle crest, and clean fade-out to zero', () => {
  assert.equal(computeTunnelAudioGain(0, 3200, 0.28), 0);
  const early = computeTunnelAudioGain(300, 3200, 0.28);
  const mid = computeTunnelAudioGain(1700, 3200, 0.28);
  const late = computeTunnelAudioGain(2900, 3200, 0.28);
  const end = computeTunnelAudioGain(3200, 3200, 0.28);

  assert.ok(early > 0 && early < mid, 'volume should swell from distant ambience');
  assert.equal(mid, 0.28, 'volume should reach controlled peak during tunnel opening');
  assert.ok(late > 0 && late < mid, 'volume should taper cleanly near the end');
  assert.equal(end, 0, 'volume must end cleanly at 0');
});

test('TunnelEntranceSessionGuard prevents repeating entrance or audio within the same session', () => {
  const guard = new TunnelEntranceSessionGuard();
  assert.equal(guard.hasEntrancePlayed(), false);
  assert.equal(guard.canPlayAudio(), true);

  guard.markEntrancePlayed();
  assert.equal(guard.hasEntrancePlayed(), true);

  guard.markAudioPlayed();
  assert.equal(guard.canPlayAudio(), false);

  guard.resetForTests();
  assert.equal(guard.hasEntrancePlayed(), false);
  assert.equal(guard.canPlayAudio(), true);
});

test('hasUpcomingMatchWithinHours detects only future matches within 3h local window', () => {
  const now = 1_700_000_000_000;
  assert.equal(hasUpcomingMatchWithinHours(now, [now + 90 * 60_000], 3), true);
  assert.equal(hasUpcomingMatchWithinHours(now, [now + 4 * 3_600_000], 3), false);
  assert.equal(hasUpcomingMatchWithinHours(now, [now - 10 * 60_000], 3), false);
  assert.equal(hasUpcomingMatchWithinHours(now, [null, undefined, NaN], 3), false);
});

test('gyroSheen mappers clamp sheen coordinates cleanly and cap parallax offset to <=4px', () => {
  const extremeGyro = mapOrientationToSheen(90, 120);
  assert.ok(extremeGyro.xPct >= 0 && extremeGyro.xPct <= 100);
  assert.ok(extremeGyro.yPct >= 0 && extremeGyro.yPct <= 100);
  assert.ok(Math.abs(extremeGyro.dxPx) <= 4);
  assert.ok(Math.abs(extremeGyro.dyPx) <= 4);

  const cornerPtr = mapPointerToSheen(0, 0, 390, 844);
  assert.equal(cornerPtr.dxPx, -4);
  assert.equal(cornerPtr.dyPx, -4);
  assert.ok(cornerPtr.xPct < 50 && cornerPtr.yPct < 50);
});

test('entryAudio spec and gain/vibration guards stay bounded and crash-safe', () => {
  assert.equal(ENTRY_AUDIO_SPEC.startPulseCutoffHz, 550);
  assert.equal(ENTRY_AUDIO_SPEC.confirmClickFreqHz, 2400);
  assert.equal(ENTRY_AUDIO_SPEC.confirmBassFreqHz, 55);
  assert.equal(ENTRY_AUDIO_SPEC.confirmBassDurationMs, 180);
  assert.deepEqual([...ENTRY_AUDIO_SPEC.confirmHapticPattern], [10, 24, 12]);
  assert.equal(clampAudioGain(99, 0.14), 0.14);
  assert.equal(clampAudioGain(-5, 0.14), 0);
  assert.equal(isVibrationSupported(null), false);
  assert.equal(isVibrationSupported({ vibrate: () => true }), true);
});

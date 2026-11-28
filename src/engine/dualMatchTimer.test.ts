import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDualMatchTimerState,
  startOrResumeDualMatchTimer,
  pauseDualMatchTimer,
  tickDualMatchTimer,
  confirmSubstitutionSlot,
  snoozeSubstitutionSlot,
  setMatchDuration,
  setSubIntervalMinutes,
  addManualSubMinute,
  editManualSubMinute,
  deleteManualSubMinute,
  getNextScheduledSub,
  validateMatchDurationMinutes,
  validateSubIntervalMinutes,
  validateManualSubMinute,
  serializeDualMatchTimerState,
  deserializeDualMatchTimerState,
} from './dualMatchTimer';

test('Scenario 1: 30-minute match with repeating substitutions every 5 minutes', () => {
  let state = createDualMatchTimerState({
    matchDurationMinutes: 30,
    scheduleMode: 'interval',
    intervalMinutes: 5,
  });

  // Slots must be 5, 10, 15, 20, 25 (30 is match end, not a sub)
  assert.deepEqual(
    state.slots.map((s) => s.originalMinute),
    [5, 10, 15, 20, 25]
  );

  const t0 = 1_000_000;
  state = startOrResumeDualMatchTimer(state, t0);

  // At 5:00 -> sub #1 triggers once
  let tick = tickDualMatchTimer(state, t0 + 5 * 60 * 1000);
  state = tick.state;
  assert.equal(tick.newlyTriggeredAlerts.length, 1);
  assert.equal(tick.newlyTriggeredAlerts[0].type, 'substitution');
  if (tick.newlyTriggeredAlerts[0].type === 'substitution') {
    assert.equal(tick.newlyTriggeredAlerts[0].slot.originalMinute, 5);
  }

  // Subsequent tick 1 second later at 5:01 does NOT re-trigger duplicate alert
  tick = tickDualMatchTimer(state, t0 + (5 * 60 + 1) * 1000);
  state = tick.state;
  assert.equal(tick.newlyTriggeredAlerts.length, 0);

  state = confirmSubstitutionSlot(state, null, t0 + (5 * 60 + 2) * 1000);
  assert.equal(state.slots[0].status, 'confirmed');

  // Advance through 10, 15, 20, 25 minutes
  for (const min of [10, 15, 20, 25]) {
    tick = tickDualMatchTimer(state, t0 + min * 60 * 1000);
    state = tick.state;
    assert.equal(tick.newlyTriggeredAlerts.length, 1, `Expected sub alert at minute ${min}`);
    assert.equal(tick.newlyTriggeredAlerts[0].type, 'substitution');
    state = confirmSubstitutionSlot(state, null, t0 + min * 60 * 1000);
  }

  // At 30:00 -> match end triggers, no substitution alert
  tick = tickDualMatchTimer(state, t0 + 30 * 60 * 1000);
  state = tick.state;
  assert.equal(state.matchEnded, true);
  assert.equal(state.isRunning, false);
  assert.equal(tick.remainingSec, 0);
  assert.equal(tick.newlyTriggeredAlerts.length, 1);
  assert.equal(tick.newlyTriggeredAlerts[0].type, 'match_end');
});

test('Scenario 2: 60-minute match with manually scheduled substitutions (12, 25, 38, 50) + add/edit/delete validation', () => {
  let state = createDualMatchTimerState({
    matchDurationMinutes: 60,
    scheduleMode: 'manual',
    manualMinutes: [12, 25, 38, 50],
  });

  assert.deepEqual(
    state.slots.map((s) => s.originalMinute),
    [12, 25, 38, 50]
  );

  // Reject duplicate manual minute
  const dupRes = addManualSubMinute(state, 25);
  assert.equal(dupRes.ok, false);

  // Reject invalid manual minutes (0, 60, 75, -5)
  assert.equal(validateManualSubMinute(0, 60, state.manualMinutes).ok, false);
  assert.equal(validateManualSubMinute(60, 60, state.manualMinutes).ok, false);
  assert.equal(validateManualSubMinute(-5, 60, state.manualMinutes).ok, false);

  // Add minute 44, edit 44 -> 45, then delete 45
  const added = addManualSubMinute(state, 44);
  assert.equal(added.ok, true);
  if (added.ok) state = added.state;
  assert.deepEqual(
    state.slots.map((s) => s.originalMinute),
    [12, 25, 38, 44, 50]
  );

  const edited = editManualSubMinute(state, 44, 45);
  assert.equal(edited.ok, true);
  if (edited.ok) state = edited.state;
  assert.deepEqual(
    state.slots.map((s) => s.originalMinute),
    [12, 25, 38, 45, 50]
  );

  state = deleteManualSubMinute(state, 45);
  assert.deepEqual(
    state.slots.map((s) => s.originalMinute),
    [12, 25, 38, 50]
  );

  // Run match clock across 12, 25, 38, 50, and 60
  const t0 = 2_000_000;
  state = startOrResumeDualMatchTimer(state, t0);
  for (const min of [12, 25, 38, 50]) {
    const tick = tickDualMatchTimer(state, t0 + min * 60 * 1000);
    state = tick.state;
    assert.equal(tick.newlyTriggeredAlerts.length, 1);
    assert.equal(tick.newlyTriggeredAlerts[0].type, 'substitution');
    if (tick.newlyTriggeredAlerts[0].type === 'substitution') {
      assert.equal(tick.newlyTriggeredAlerts[0].slot.originalMinute, min);
    }
    state = confirmSubstitutionSlot(state, null, t0 + min * 60 * 1000);
  }

  const endTick = tickDualMatchTimer(state, t0 + 60 * 60 * 1000);
  assert.equal(endTick.newlyTriggeredAlerts.length, 1);
  assert.equal(endTick.newlyTriggeredAlerts[0].type, 'match_end');
});

test('Scenario 3: Custom 47-minute match duration and invalid duration rejection', () => {
  assert.equal(validateMatchDurationMinutes(0).ok, false);
  assert.equal(validateMatchDurationMinutes(-15).ok, false);
  assert.equal(validateMatchDurationMinutes('abc').ok, false);
  assert.equal(validateSubIntervalMinutes(0).ok, false);

  let state = createDualMatchTimerState({
    matchDurationMinutes: 60,
    scheduleMode: 'interval',
    intervalMinutes: 15,
  });
  state = setMatchDuration(state, 47, undefined, 0);
  assert.equal(state.matchDurationMinutes, 47);
  // With 15m interval in a 47m match, subs are at 15, 30, 45
  assert.deepEqual(
    state.slots.map((s) => s.originalMinute),
    [15, 30, 45]
  );

  const t0 = 5_000_000;
  state = startOrResumeDualMatchTimer(state, t0);
  const midTick = tickDualMatchTimer(state, t0 + 20 * 60 * 1000);
  assert.equal(midTick.elapsedSec, 20 * 60);
  assert.equal(midTick.remainingSec, 27 * 60);

  const endTick = tickDualMatchTimer(midTick.state, t0 + 47 * 60 * 1000);
  assert.equal(endTick.state.matchEnded, true);
  assert.equal(endTick.elapsedSec, 47 * 60);
  assert.equal(endTick.remainingSec, 0);
});

test('Scenario 4: Pause and resume during a match preserves exact elapsed time and prevents drift', () => {
  const t0 = 10_000_000;
  let state = createDualMatchTimerState({
    matchDurationMinutes: 60,
    scheduleMode: 'manual',
    manualMinutes: [12, 25],
  });
  state = startOrResumeDualMatchTimer(state, t0);

  // Run for 10m 30s (630s), then pause
  const tPause = t0 + 630 * 1000;
  let tick = tickDualMatchTimer(state, tPause);
  state = pauseDualMatchTimer(tick.state, tPause);
  assert.equal(state.isRunning, false);
  assert.equal(state.isPaused, true);
  assert.equal(state.accumulatedElapsedMs, 630 * 1000);

  // 8 minutes of real wall-clock time pass while paused -> elapsed stays 630s, no alerts fire
  const tDuringPause = tPause + 8 * 60 * 1000;
  tick = tickDualMatchTimer(state, tDuringPause);
  assert.equal(tick.elapsedSec, 630);
  assert.equal(tick.remainingSec, 60 * 60 - 630);
  assert.equal(tick.newlyTriggeredAlerts.length, 0);

  // Resume at tDuringPause and advance 90s (total match elapsed = 720s = 12:00)
  state = startOrResumeDualMatchTimer(tick.state, tDuringPause);
  tick = tickDualMatchTimer(state, tDuringPause + 90 * 1000);
  assert.equal(tick.elapsedSec, 720);
  assert.equal(tick.newlyTriggeredAlerts.length, 1);
  assert.equal(tick.newlyTriggeredAlerts[0].type, 'substitution');
});

test('Scenario 5: Delay/Snooze a substitution (+2 min) keeps original schedule intact and re-alerts at snoozed time', () => {
  const t0 = 20_000_000;
  let state = createDualMatchTimerState({
    matchDurationMinutes: 60,
    scheduleMode: 'manual',
    manualMinutes: [12, 25, 38, 50],
  });
  state = startOrResumeDualMatchTimer(state, t0);

  // Reach minute 12 -> sub #1 alerts
  const t12 = t0 + 12 * 60 * 1000;
  let tick = tickDualMatchTimer(state, t12);
  state = tick.state;
  assert.equal(tick.newlyTriggeredAlerts.length, 1);
  assert.equal(state.activeAlertSlotId, state.slots[0].id);

  // Delay by +2 minutes
  state = snoozeSubstitutionSlot(state, 2, null, t12);
  assert.equal(state.activeAlertSlotId, null);
  assert.equal(state.slots[0].status, 'snoozed');
  assert.equal(state.slots[0].originalMinute, 12);
  assert.equal(state.slots[0].effectiveMinute, 14);
  assert.equal(state.slots[0].totalSnoozeMinutes, 2);
  assert.equal(state.slots[0].postponedCount, 1);

  // Verify original schedule [12, 25, 38, 50] is completely intact
  assert.deepEqual(
    state.slots.map((s) => s.originalMinute),
    [12, 25, 38, 50]
  );
  assert.deepEqual(
    state.slots.map((s) => s.effectiveMinute),
    [14, 25, 38, 50]
  );

  const nextInfo = getNextScheduledSub(state, t12);
  assert.ok(nextInfo);
  assert.equal(nextInfo.isPostponed, true);
  assert.equal(nextInfo.secondsUntil, 120);

  // At minute 13 -> still pending snooze
  tick = tickDualMatchTimer(state, t0 + 13 * 60 * 1000);
  state = tick.state;
  assert.equal(tick.newlyTriggeredAlerts.length, 0);

  // At minute 14 -> snoozed slot triggers again!
  tick = tickDualMatchTimer(state, t0 + 14 * 60 * 1000);
  state = tick.state;
  assert.equal(tick.newlyTriggeredAlerts.length, 1);
  assert.equal(tick.newlyTriggeredAlerts[0].type, 'substitution');
  if (tick.newlyTriggeredAlerts[0].type === 'substitution') {
    assert.equal(tick.newlyTriggeredAlerts[0].slot.originalMinute, 12);
    assert.equal(tick.newlyTriggeredAlerts[0].slot.effectiveMinute, 14);
  }
});

test('Scenario 6: Match ends before the next scheduled or snoozed substitution suppresses future sub alerts', () => {
  const t0 = 30_000_000;
  let state = createDualMatchTimerState({
    matchDurationMinutes: 30,
    scheduleMode: 'manual',
    manualMinutes: [15, 28],
  });
  state = startOrResumeDualMatchTimer(state, t0);

  // Confirm 15m sub
  let tick = tickDualMatchTimer(state, t0 + 15 * 60 * 1000);
  state = confirmSubstitutionSlot(tick.state, null, t0 + 15 * 60 * 1000);

  // At 28m, sub #2 triggers; user snoozes it by +5 minutes (which pushes it to 33m, after the 30m match end!)
  tick = tickDualMatchTimer(state, t0 + 28 * 60 * 1000);
  state = snoozeSubstitutionSlot(tick.state, 5, null, t0 + 28 * 60 * 1000);
  assert.equal(state.slots[1].effectiveMinute, 33);

  // Next scheduled sub before match end is now null because 33m >= 30m
  assert.equal(getNextScheduledSub(state, t0 + 28 * 60 * 1000), null);

  // At 30m, match ends cleanly and no sub alert fires at 30m or 33m
  tick = tickDualMatchTimer(state, t0 + 30 * 60 * 1000);
  state = tick.state;
  assert.equal(state.matchEnded, true);
  assert.equal(tick.newlyTriggeredAlerts.length, 1);
  assert.equal(tick.newlyTriggeredAlerts[0].type, 'match_end');

  const afterEndTick = tickDualMatchTimer(state, t0 + 35 * 60 * 1000);
  assert.equal(afterEndTick.newlyTriggeredAlerts.length, 0);
});

test('Scenario 7: Refresh or temporarily leave the app and return restores exact wall-clock state', () => {
  const t0 = 40_000_000;
  let state = createDualMatchTimerState({
    matchDurationMinutes: 45,
    scheduleMode: 'interval',
    intervalMinutes: 10,
  });
  state = setSubIntervalMinutes(state, 10);
  state = startOrResumeDualMatchTimer(state, t0);

  // Serialize while running at t0 + 4 minutes
  const tickBeforeLeave = tickDualMatchTimer(state, t0 + 4 * 60 * 1000);
  const savedJson = serializeDualMatchTimerState(tickBeforeLeave.state);

  // User leaves tab / refreshes and returns 7 minutes later (at t0 + 11 minutes)
  const restored = deserializeDualMatchTimerState(savedJson);
  assert.ok(restored);
  assert.equal(restored.isRunning, true);

  const tickAfterReturn = tickDualMatchTimer(restored, t0 + 11 * 60 * 1000);
  assert.equal(tickAfterReturn.elapsedSec, 11 * 60);
  assert.equal(tickAfterReturn.remainingSec, 34 * 60);
  // The 10-minute substitution alert that became due while away triggers immediately once upon return!
  assert.equal(tickAfterReturn.newlyTriggeredAlerts.length, 1);
  assert.equal(tickAfterReturn.newlyTriggeredAlerts[0].type, 'substitution');
  if (tickAfterReturn.newlyTriggeredAlerts[0].type === 'substitution') {
    assert.equal(tickAfterReturn.newlyTriggeredAlerts[0].slot.originalMinute, 10);
  }
});

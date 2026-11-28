import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeQuotaHealth,
  estimateDailySparkReads,
  isQuotaExceededError,
  quotaMonitor,
  SPARK_FREE_DAILY_READ_LIMIT,
} from './quotaMonitor';

test('isQuotaExceededError detects Firestore quota and resource-exhausted errors', () => {
  assert.equal(isQuotaExceededError(new Error('Quota exceeded for quota metric')), true);
  assert.equal(isQuotaExceededError(new Error('FirebaseError: resource-exhausted')), true);
  assert.equal(isQuotaExceededError(new Error('permission-denied')), false);
});

test('computeQuotaHealth categorizes usage safely under Spark free tier including 70% alert', () => {
  const safe = computeQuotaHealth(350, SPARK_FREE_DAILY_READ_LIMIT);
  assert.equal(safe.status, 'safe');
  assert.equal(safe.alert70, false);
  assert.equal(safe.remaining, 49650);

  const mod = computeQuotaHealth(25000, SPARK_FREE_DAILY_READ_LIMIT);
  assert.equal(mod.status, 'moderate');
  assert.equal(mod.alert70, false);
  assert.equal(mod.percentUsed, 50);

  const warn70 = computeQuotaHealth(35000, SPARK_FREE_DAILY_READ_LIMIT);
  assert.equal(warn70.status, 'high');
  assert.equal(warn70.alert70, true);

  const high = computeQuotaHealth(45000, SPARK_FREE_DAILY_READ_LIMIT);
  assert.equal(high.status, 'high');
  assert.equal(high.alert70, true);
});

test('estimateDailySparkReads stays well within 50k Spark limit for 10 teams x 15 players x 3 opens/day', () => {
  const est = estimateDailySparkReads({
    teamsCount: 10,
    playersPerTeam: 15,
    opensPerDay: 3,
    readsPerOpen: 28,
    tabSwitchReadsPerOpen: 12,
    liveUpdatesPerOpen: 6,
  });
  assert.equal(est.perOpenReads, 46);
  assert.equal(est.totalDailyReads, 20700);
  assert.equal(est.withinSparkFreeTier, true);
  assert.ok(est.percentOfSparkLimit < 50);
});

test('quotaMonitor tracks reads and writes by category cleanly', () => {
  const before = quotaMonitor.getSnapshot();
  quotaMonitor.recordReads('core', 10);
  quotaMonitor.recordReads('tab', 5);
  quotaMonitor.recordWrites(3);
  quotaMonitor.setActiveListeners(4);
  const after = quotaMonitor.getSnapshot();
  assert.equal(after.totalReads, before.totalReads + 15);
  assert.equal(after.totalWrites, before.totalWrites + 3);
  assert.equal(after.activeListeners, 4);
});


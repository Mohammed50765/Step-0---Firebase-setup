import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeQuotaHealth,
  isQuotaExceededError,
  quotaMonitor,
  SPARK_FREE_DAILY_READ_LIMIT,
} from './quotaMonitor';

test('isQuotaExceededError detects Firestore quota and resource-exhausted errors', () => {
  assert.equal(isQuotaExceededError(new Error('Quota exceeded for quota metric')), true);
  assert.equal(isQuotaExceededError(new Error('FirebaseError: resource-exhausted')), true);
  assert.equal(isQuotaExceededError(new Error('permission-denied')), false);
});

test('computeQuotaHealth categorizes usage safely under Spark free tier', () => {
  const safe = computeQuotaHealth(350, SPARK_FREE_DAILY_READ_LIMIT);
  assert.equal(safe.status, 'safe');
  assert.equal(safe.remaining, 49650);

  const mod = computeQuotaHealth(25000, SPARK_FREE_DAILY_READ_LIMIT);
  assert.equal(mod.status, 'moderate');
  assert.equal(mod.percentUsed, 50);

  const high = computeQuotaHealth(45000, SPARK_FREE_DAILY_READ_LIMIT);
  assert.equal(high.status, 'high');
});

test('quotaMonitor tracks reads by category cleanly', () => {
  const before = quotaMonitor.getSnapshot().totalReads;
  quotaMonitor.recordReads('core', 10);
  quotaMonitor.recordReads('tab', 5);
  quotaMonitor.setActiveListeners(4);
  const after = quotaMonitor.getSnapshot();
  assert.equal(after.totalReads, before + 15);
  assert.equal(after.activeListeners, 4);
});

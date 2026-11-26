import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TRUSTED_DEVICE_CACHE_PREF_KEY,
  classifyConnectionError,
  collectSensitiveStorageKeys,
  isTrustedDeviceCacheEnabled,
  resolveFirestoreCacheMode,
  scrubAllAccountLocalCaches,
  setTrustedDeviceCachePreference,
  type StorageLikeFull,
} from './localCachePrivacy';

function makeMemoryStorage(initial: Record<string, string> = {}): StorageLikeFull {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    get length() {
      return map.size;
    },
    key(index: number) {
      return Array.from(map.keys())[index] ?? null;
    },
    getItem(k: string) {
      return map.has(k) ? (map.get(k) ?? null) : null;
    },
    setItem(k: string, v: string) {
      map.set(k, String(v));
    },
    removeItem(k: string) {
      map.delete(k);
    },
    clear() {
      map.clear();
    },
  };
}

test('defaults Firestore localCache mode to memory-only for shared-device privacy', () => {
  const ls = makeMemoryStorage();
  assert.equal(isTrustedDeviceCacheEnabled(ls), false);
  assert.equal(resolveFirestoreCacheMode(ls), 'memory');

  // Corrupt or non-'true' values must still stay safely in memory mode
  ls.setItem(TRUSTED_DEVICE_CACHE_PREF_KEY, '1');
  assert.equal(resolveFirestoreCacheMode(ls), 'memory');
});

test('enables persistent localCache ONLY when user explicitly opts in on a trusted personal device', () => {
  const ls = makeMemoryStorage();
  const resOn = setTrustedDeviceCachePreference(true, ls);
  assert.equal(resOn.enabled, true);
  assert.equal(resOn.requiresReload, true);
  assert.equal(isTrustedDeviceCacheEnabled(ls), true);
  assert.equal(resolveFirestoreCacheMode(ls), 'persistent');

  const resOff = setTrustedDeviceCachePreference(false, ls);
  assert.equal(resOff.enabled, false);
  assert.equal(resOff.requiresReload, true);
  assert.equal(resolveFirestoreCacheMode(ls), 'memory');
});

test('scrubAllAccountLocalCaches purges all Multi-Team snapshots and per-UID keys while keeping device UI prefs', () => {
  const ls = makeMemoryStorage({
    maydan_team_cache_v1: '{"legacy":true}',
    maydan_team_cache_v1__uidA__team_alpha: '{"players":["A"]}',
    maydan_team_cache_v1__uidB__team_beta: '{"players":["B"]}',
    maydan_privacy_ok_uidA: '1',
    maydan_google_player_uidA: 'p1',
    maydan_m6_migration_ckpt_v1: '{"targetTeamId":"t1"}',
    maydan_pending_join_code_v1: 'MT-ABCD-1234',
    maydan_data_saver: '1',
    [TRUSTED_DEVICE_CACHE_PREF_KEY]: 'true',
  });
  const ss = makeMemoryStorage({
    temp_token: 'abc',
    nav_tab: 'roster',
  });

  const keysBefore = collectSensitiveStorageKeys(ls);
  assert.equal(keysBefore.length, 7);

  const result = scrubAllAccountLocalCaches(ls, ss);
  assert.equal(result.removedLocalKeys.length, 7);
  assert.equal(result.clearedSession, true);

  // Every user/team cache key is gone
  assert.equal(ls.getItem('maydan_team_cache_v1'), null);
  assert.equal(ls.getItem('maydan_team_cache_v1__uidA__team_alpha'), null);
  assert.equal(ls.getItem('maydan_team_cache_v1__uidB__team_beta'), null);
  assert.equal(ls.getItem('maydan_privacy_ok_uidA'), null);
  assert.equal(ls.getItem('maydan_m6_migration_ckpt_v1'), null);
  assert.equal(ls.getItem('maydan_pending_join_code_v1'), null);
  assert.equal(ss.length, 0);

  // Non-PII device preferences remain intact
  assert.equal(ls.getItem('maydan_data_saver'), '1');
  assert.equal(ls.getItem(TRUSTED_DEVICE_CACHE_PREF_KEY), 'true');
});

test('classifyConnectionError accurately distinguishes reachable permission-denied from offline, quota, config, and internal errors', () => {
  const perm = classifyConnectionError({ code: 'permission-denied', message: 'Missing or insufficient permissions.' });
  assert.equal(perm.reachable, true);
  assert.equal(perm.status, 'permission_denied_reachable');

  const off = classifyConnectionError(new Error('Failed to get document because the client is offline.'));
  assert.equal(off.reachable, false);
  assert.equal(off.status, 'offline');

  const quota = classifyConnectionError({ code: 'resource-exhausted', message: 'Quota exceeded.' });
  assert.equal(quota.reachable, false);
  assert.equal(quota.status, 'quota_exceeded');

  const cfg = classifyConnectionError({ code: 'invalid-argument', message: 'Invalid database ID.' });
  assert.equal(cfg.reachable, false);
  assert.equal(cfg.status, 'config_error');

  const internal = classifyConnectionError({ code: 'internal', message: 'Unexpected server failure.' });
  assert.equal(internal.reachable, false);
  assert.equal(internal.status, 'internal_error');
});

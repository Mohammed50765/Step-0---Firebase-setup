import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TRUSTED_DEVICE_AUTH_PREF_KEY,
  TRUSTED_DEVICE_CACHE_PREF_KEY,
  classifyAccountCleanupError,
  classifyConnectionError,
  collectAccountDeletionTeamCandidates,
  collectSensitiveStorageKeys,
  isTrustedDeviceAuthEnabled,
  isTrustedDeviceCacheEnabled,
  isValidRecaptchaSiteKey,
  planTeamAccountCleanup,
  purgePersistentTeamSnapshots,
  resolveAuthPersistenceMode,
  resolveFirestoreCacheMode,
  resolveSnapshotCacheTarget,
  scrubAllAccountLocalCaches,
  setTrustedDeviceAuthPreference,
  setTrustedDeviceCachePreference,
  shouldAllowAuthAccountDeletion,
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

test('defaults Firestore cache to memory-only, snapshots to sessionStorage, and Auth persistence to session-only', () => {
  const ls = makeMemoryStorage();
  assert.equal(isTrustedDeviceCacheEnabled(ls), false);
  assert.equal(resolveFirestoreCacheMode(ls), 'memory');
  assert.equal(resolveSnapshotCacheTarget(ls), 'session');

  assert.equal(isTrustedDeviceAuthEnabled(ls), false);
  assert.equal(resolveAuthPersistenceMode(ls), 'session');

  // Corrupt or non-'true' values must still stay safely in shared-device mode
  ls.setItem(TRUSTED_DEVICE_CACHE_PREF_KEY, '1');
  ls.setItem(TRUSTED_DEVICE_AUTH_PREF_KEY, 'yes');
  assert.equal(resolveFirestoreCacheMode(ls), 'memory');
  assert.equal(resolveSnapshotCacheTarget(ls), 'session');
  assert.equal(resolveAuthPersistenceMode(ls), 'session');
});

test('enables persistent localCache, localStorage snapshots, and local Auth persistence ONLY on explicit trusted-device opt-in', () => {
  const ls = makeMemoryStorage();
  const resOn = setTrustedDeviceCachePreference(true, ls);
  assert.equal(resOn.enabled, true);
  assert.equal(resOn.requiresReload, true);
  assert.equal(isTrustedDeviceCacheEnabled(ls), true);
  assert.equal(resolveFirestoreCacheMode(ls), 'persistent');
  assert.equal(resolveSnapshotCacheTarget(ls), 'local');

  const authOn = setTrustedDeviceAuthPreference(true, ls);
  assert.equal(authOn.enabled, true);
  assert.equal(authOn.mode, 'local');
  assert.equal(resolveAuthPersistenceMode(ls), 'local');

  const resOff = setTrustedDeviceCachePreference(false, ls);
  assert.equal(resOff.enabled, false);
  assert.equal(resolveFirestoreCacheMode(ls), 'memory');
  assert.equal(resolveSnapshotCacheTarget(ls), 'session');

  const authOff = setTrustedDeviceAuthPreference(false, ls);
  assert.equal(authOff.enabled, false);
  assert.equal(authOff.mode, 'session');
  assert.equal(resolveAuthPersistenceMode(ls), 'session');
});

test('purgePersistentTeamSnapshots removes ONLY persisted team snapshots while keeping prefs and join drafts', () => {
  const ls = makeMemoryStorage({
    maydan_team_cache_v1: '{"legacy":true}',
    maydan_team_cache_v1__uidA__team_alpha: '{"players":["A"]}',
    maydan_pending_join_code_v1: 'MT-ABCD-1234',
    maydan_data_saver: '1',
    maydan_lang: 'ar',
  });

  const removed = purgePersistentTeamSnapshots(ls);
  assert.equal(removed.length, 2);
  assert.equal(ls.getItem('maydan_team_cache_v1'), null);
  assert.equal(ls.getItem('maydan_team_cache_v1__uidA__team_alpha'), null);
  assert.equal(ls.getItem('maydan_pending_join_code_v1'), 'MT-ABCD-1234');
  assert.equal(ls.getItem('maydan_data_saver'), '1');
  assert.equal(ls.getItem('maydan_lang'), 'ar');
});

test('scrubAllAccountLocalCaches purges sensitive keys while preserving display prefs and optional join drafts', () => {
  const ls = makeMemoryStorage({
    maydan_team_cache_v1: '{"legacy":true}',
    maydan_team_cache_v1__uidA__team_alpha: '{"players":["A"]}',
    maydan_team_cache_v1__uidB__team_beta: '{"players":["B"]}',
    maydan_privacy_ok_uidA: '1',
    maydan_google_player_uidA: 'p1',
    maydan_m6_migration_ckpt_v1: '{"targetTeamId":"t1"}',
    maydan_pending_join_code_v1: 'MT-ABCD-1234',
    maydan_data_saver: '1',
    maydan_lang: 'ar',
    [TRUSTED_DEVICE_CACHE_PREF_KEY]: 'true',
    [TRUSTED_DEVICE_AUTH_PREF_KEY]: 'true',
  });
  const ss = makeMemoryStorage({
    temp_token: 'abc',
    nav_tab: 'roster',
  });

  const keysWithJoinPreserved = collectSensitiveStorageKeys(ls, { preservePendingJoinDraft: true });
  assert.equal(keysWithJoinPreserved.length, 6);

  const keysAll = collectSensitiveStorageKeys(ls);
  assert.equal(keysAll.length, 7);

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
  assert.equal(ls.getItem('maydan_lang'), 'ar');
  assert.equal(ls.getItem(TRUSTED_DEVICE_CACHE_PREF_KEY), 'true');
  assert.equal(ls.getItem(TRUSTED_DEVICE_AUTH_PREF_KEY), 'true');
});

test('classifyAccountCleanupError distinguishes missing docs from permission/network failures and blocks Auth deletion on partial failure', () => {
  const notFound = classifyAccountCleanupError({ code: 'not-found', message: 'No document to update' });
  assert.equal(notFound.kind, 'not_found');
  assert.equal(notFound.ignorableForOptionalDoc, true);

  const perm = classifyAccountCleanupError({ code: 'permission-denied', message: 'Missing or insufficient permissions.' });
  assert.equal(perm.kind, 'permission_denied');
  assert.equal(perm.ignorableForOptionalDoc, false);

  const net = classifyAccountCleanupError({ code: 'unavailable', message: 'Network unavailable' });
  assert.equal(net.kind, 'network');
  assert.equal(net.ignorableForOptionalDoc, false);

  assert.equal(shouldAllowAuthAccountDeletion([]), true);
  assert.equal(
    shouldAllowAuthAccountDeletion([
      {
        step: 'delete_private_docs',
        path: 'teams/t1/members/u1/private',
        kind: perm.kind,
        code: perm.code,
        message: perm.message,
      },
    ]),
    false
  );
});

test('isValidRecaptchaSiteKey rejects empty, short, and placeholder values while accepting valid site keys', () => {
  assert.equal(isValidRecaptchaSiteKey(''), false);
  assert.equal(isValidRecaptchaSiteKey('short'), false);
  assert.equal(isValidRecaptchaSiteKey('YOUR_RECAPTCHA_SITE_KEY_HERE'), false);
  assert.equal(isValidRecaptchaSiteKey('placeholder_site_key_123456'), false);
  assert.equal(isValidRecaptchaSiteKey('6LcFakeRealLookingSiteKey_1234567890abcd'), true);
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

test('collectAccountDeletionTeamCandidates unions active teams with fresh user registry, owned, and pending teams while skipping legacy main', () => {
  const candidates = collectAccountDeletionTeamCandidates({
    activeTeamIds: ['team_active1', 'main', ''],
    userRegistryDoc: {
      teamIds: ['team_active1', 'team_soft_deleted', 'team_member2'],
      ownedTeamIds: ['team_solo_owned', 'team_deleted_owned'],
      pendingJoinTeamId: 'team_pending_join',
      activeTeamId: 'team_active1',
    },
  });

  assert.deepEqual(candidates, [
    'team_active1',
    'team_soft_deleted',
    'team_member2',
    'team_solo_owned',
    'team_deleted_owned',
    'team_pending_join',
  ]);
});

test('planTeamAccountCleanup selects Firestore-rules-safe cleanup path for active, solo, soft-deleted, and missing teams', () => {
  assert.equal(
    planTeamAccountCleanup({ id: 't1', founderUid: 'u1', memberCount: 4, deletedAt: null }, 'u1'),
    'block_active_founder_with_members'
  );
  assert.equal(
    planTeamAccountCleanup({ id: 't2', founderUid: 'u1', memberCount: 1, deletedAt: null }, 'u1'),
    'soft_delete_solo_owned'
  );
  assert.equal(
    planTeamAccountCleanup({ id: 't3', founderUid: 'u_other', memberCount: 8, deletedAt: null }, 'u1'),
    'leave_active_member'
  );
  assert.equal(
    planTeamAccountCleanup({ id: 't4', founderUid: 'u_other', memberCount: 8, deletedAt: 1700000000 }, 'u1'),
    'cleanup_soft_deleted_member'
  );
  assert.equal(
    planTeamAccountCleanup({ id: 't5', founderUid: 'u1', memberCount: 1, deletedAt: 1700000000 }, 'u1'),
    'cleanup_soft_deleted_founder'
  );
  assert.equal(planTeamAccountCleanup(null, 'u1'), 'cleanup_orphan_refs');
});

test('scrubAllAccountLocalCaches purges all tactical studio, GTO history, rating sidecar, read notifications, library, badges, and live match keys on logout/account switch', () => {
  const ls = makeMemoryStorage({
    maydan_tactics_studio_v1: '{"customPlans":[{"id":"secret_plan"}]}',
    maydan_gto_duel_history_v1: '[{"winRatePct":88}]',
    maydan_read_notifs_v2: '["notif_u1_m1"]',
    maydan_rating_meta_v1: '{"p1":{"roleOverride":"ST"}}',
    maydan_local_tab_badges_v1: '{"team":1700000000}',
    maydan_football_library_v1: '[{"id":"custom_item"}]',
    maydan_dual_match_timer_v1: '{"isRunning":true}',
    maydan_live_match_hud_v1: '{"liveOurScore":3}',
    maydan_lang: 'ar',
    maydan_font_scale: '1',
    maydan_welcome_guide_seen_v1: '1',
  });
  const ss = makeMemoryStorage({
    maydan_dual_match_timer_v1: '{"isRunning":true}',
    maydan_live_match_hud_v1: '{"liveOurScore":3}',
  });

  const res = scrubAllAccountLocalCaches(ls, ss);
  assert.equal(res.removedLocalKeys.length, 8);
  assert.equal(res.clearedSession, true);

  // All 8 newly protected user/team/match keys must be purged
  assert.equal(ls.getItem('maydan_tactics_studio_v1'), null);
  assert.equal(ls.getItem('maydan_gto_duel_history_v1'), null);
  assert.equal(ls.getItem('maydan_read_notifs_v2'), null);
  assert.equal(ls.getItem('maydan_rating_meta_v1'), null);
  assert.equal(ls.getItem('maydan_local_tab_badges_v1'), null);
  assert.equal(ls.getItem('maydan_football_library_v1'), null);
  assert.equal(ls.getItem('maydan_dual_match_timer_v1'), null);
  assert.equal(ls.getItem('maydan_live_match_hud_v1'), null);
  assert.equal(ss.length, 0);

  // Category A device UI preferences remain untouched
  assert.equal(ls.getItem('maydan_lang'), 'ar');
  assert.equal(ls.getItem('maydan_font_scale'), '1');
  assert.equal(ls.getItem('maydan_welcome_guide_seen_v1'), '1');
});


/**
 * ميدان 6v6 — Privacy-Safe Local Cache, Auth Persistence, App Check & Account Cleanup Helpers
 *
 * Security & Shared-Device Privacy Policy:
 * - Default Auth persistence is `browserSessionPersistence` (tab/session-only) so closing
 *   the browser on a shared device never leaves the account signed in. Users can opt in to
 *   `browserLocalPersistence` only on a trusted personal device.
 * - Default Firestore local cache mode is `memoryLocalCache()` and team snapshots stay
 *   strictly in `sessionStorage` so zero team/player/health records persist to disk or
 *   IndexedDB on shared/borrowed devices.
 * - Opt-in `persistentLocalCache()` & `localStorage` snapshot caching activate ONLY when
 *   the user explicitly marks the current device as a trusted personal device.
 * - On sign-out or account switch, `scrubAllAccountLocalCaches()` performs targeted cleanup
 *   of sensitive user/team keys while keeping non-sensitive display/UI preferences intact.
 */

export const TRUSTED_DEVICE_CACHE_PREF_KEY = 'maydan_trusted_device_cache_v1';
export const TRUSTED_DEVICE_AUTH_PREF_KEY = 'maydan_trusted_device_auth_v1';

export const USER_SCOPED_STORAGE_PREFIXES = [
  'maydan_team_cache_v1',
  'maydan_google_player_',
  'maydan_privacy_ok_',
  'maydan_pending_join_code',
  'maydan_m6_migration_ckpt',
  'maydan_onboard_draft',
  'maydan_active_team_',
  'maydan_last_uid',
  'maydan_tactics_studio_v1',
  'maydan_gto_duel_history_v1',
  'maydan_read_notifs_v2',
  'maydan_rating_meta_v1',
  'maydan_local_tab_badges_v1',
  'maydan_football_library_v1',
  'maydan_dual_match_timer_v1',
  'maydan_live_match_hud_v1',
] as const;

export const PRESERVED_DEVICE_PREF_KEYS = new Set<string>([
  TRUSTED_DEVICE_CACHE_PREF_KEY,
  TRUSTED_DEVICE_AUTH_PREF_KEY,
  'maydan_data_saver',
  'maydan_tactics_muted',
  'maydan_lang',
  'maydan_font_scale',
  'maydan_welcome_guide_seen_v1',
  'maydan_tunnel_sound_pref_v1',
]);

/**
 * Explicit Section 7 classification of all browser storage keys across Categories A, B, C, and D.
 */
export const STORAGE_POLICY_CLASSIFICATION = {
  categoryA_devicePrefs: [
    'maydan_lang',
    'maydan_font_scale',
    'maydan_data_saver',
    'maydan_tactics_muted',
    'maydan_welcome_guide_seen_v1',
    'maydan_tunnel_sound_pref_v1',
    TRUSTED_DEVICE_CACHE_PREF_KEY,
    TRUSTED_DEVICE_AUTH_PREF_KEY,
  ],
  categoryB_userPrivate: [
    'maydan_last_uid',
    'maydan_active_team_',
    'maydan_google_player_',
    'maydan_privacy_ok_',
    'maydan_pending_join_code',
    'maydan_onboard_draft',
    'maydan_m6_migration_ckpt',
    'maydan_gto_duel_history_v1',
    'maydan_read_notifs_v2',
    'maydan_local_tab_badges_v1',
    'maydan_football_library_v1',
  ],
  categoryC_teamScoped: [
    'maydan_team_cache_v1',
    'maydan_tactics_studio_v1',
    'maydan_rating_meta_v1',
  ],
  categoryD_tempMatchState: [
    'maydan_dual_match_timer_v1',
    'maydan_live_match_hud_v1',
    'maydan_tunnel_entrance_played_v2',
  ],
} as const;

/**
 * Resolves an account/team-scoped storage key so shared devices never leak state across
 * different accounts or teams. Falls back to baseKey when no uid/teamId is active (e.g. demo mode),
 * and any unscoped baseKey in USER_SCOPED_STORAGE_PREFIXES is scrubbed on logout/account switch.
 */
export function resolveScopedStorageKey(
  baseKey: string,
  uid?: string | null,
  teamId?: string | null
): string {
  const cleanBase = String(baseKey || '').trim();
  const cleanUid = String(uid ?? '').trim().replace(/[^a-zA-Z0-9_-]/g, '');
  const cleanTeam = String(teamId ?? '').trim().replace(/[^a-zA-Z0-9_-]/g, '');
  if (cleanUid && cleanTeam) {
    return `${cleanBase}__${cleanUid}__${cleanTeam}`;
  }
  if (cleanUid) {
    return `${cleanBase}__${cleanUid}`;
  }
  if (cleanTeam && cleanTeam !== 'main') {
    return `${cleanBase}__team_${cleanTeam}`;
  }
  return cleanBase;
}

export type FirestoreCacheMode = 'memory' | 'persistent';
export type AuthPersistenceMode = 'session' | 'local';
export type SnapshotCacheTarget = 'session' | 'local';
export type AppCheckLifecycleState = 'unconfigured' | 'initializing' | 'active' | 'failed';

export interface AppCheckStatus {
  state: AppCheckLifecycleState;
  configured: boolean;
  active: boolean;
  mode: 'recaptcha-v3' | 'not-configured';
  errorMessage?: string;
}

export type AccountCleanupErrorKind =
  | 'not_found'
  | 'permission_denied'
  | 'network'
  | 'precondition'
  | 'unknown';

export interface AccountCleanupFailure {
  step: string;
  path: string;
  kind: AccountCleanupErrorKind;
  code: string;
  message: string;
}

export type ConnectionDiagnosticStatus =
  | 'connected'
  | 'permission_denied_reachable'
  | 'offline'
  | 'quota_exceeded'
  | 'config_error'
  | 'internal_error';

export interface ConnectionDiagnosticResult {
  reachable: boolean;
  status: ConnectionDiagnosticStatus;
  code: string;
  message: string;
}

export interface StorageLikeReader {
  getItem(key: string): string | null;
}

export interface StorageLikeWriter {
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface StorageLikeFull extends StorageLikeReader, StorageLikeWriter {
  readonly length: number;
  key(index: number): string | null;
  clear?: () => void;
}

function getDefaultLocalStorage(): StorageLikeFull | null {
  try {
    if (typeof globalThis !== 'undefined' && 'localStorage' in globalThis && globalThis.localStorage) {
      return globalThis.localStorage;
    }
  } catch {
    // Restricted storage environment (e.g. private browsing / sandboxed iframe)
  }
  return null;
}

function getDefaultSessionStorage(): StorageLikeFull | null {
  try {
    if (typeof globalThis !== 'undefined' && 'sessionStorage' in globalThis && globalThis.sessionStorage) {
      return globalThis.sessionStorage;
    }
  } catch {
    // Restricted storage environment
  }
  return null;
}

/**
 * Returns true ONLY if the user has explicitly opted in to persistent local caching
 * on this personal device. Defaults safely to false (memory-only).
 */
export function isTrustedDeviceCacheEnabled(storage?: StorageLikeReader | null): boolean {
  const store = storage === undefined ? getDefaultLocalStorage() : storage;
  if (!store) return false;
  try {
    return store.getItem(TRUSTED_DEVICE_CACHE_PREF_KEY) === 'true';
  } catch {
    return false;
  }
}

/**
 * Decides the Firestore localCache mode BEFORE initializeFirestore() is called.
 */
export function resolveFirestoreCacheMode(storage?: StorageLikeReader | null): FirestoreCacheMode {
  return isTrustedDeviceCacheEnabled(storage) ? 'persistent' : 'memory';
}

/**
 * Decides where team snapshot caches are stored:
 * - 'session' (sessionStorage) in default shared-device safe mode so zero team data persists on disk.
 * - 'local' (localStorage) ONLY when the user explicitly opted into trusted personal device caching.
 */
export function resolveSnapshotCacheTarget(storage?: StorageLikeReader | null): SnapshotCacheTarget {
  return isTrustedDeviceCacheEnabled(storage) ? 'local' : 'session';
}

/**
 * Returns true ONLY if the user explicitly chose "Remember sign-in on this personal device".
 * Defaults strictly to false (browserSessionPersistence) for shared-device privacy.
 */
export function isTrustedDeviceAuthEnabled(storage?: StorageLikeReader | null): boolean {
  const store = storage === undefined ? getDefaultLocalStorage() : storage;
  if (!store) return false;
  try {
    return store.getItem(TRUSTED_DEVICE_AUTH_PREF_KEY) === 'true';
  } catch {
    return false;
  }
}

export function resolveAuthPersistenceMode(storage?: StorageLikeReader | null): AuthPersistenceMode {
  return isTrustedDeviceAuthEnabled(storage) ? 'local' : 'session';
}

export function setTrustedDeviceAuthPreference(
  enabled: boolean,
  storage?: StorageLikeWriter | null
): { enabled: boolean; mode: AuthPersistenceMode } {
  const store = storage === undefined ? getDefaultLocalStorage() : storage;
  if (store) {
    try {
      if (enabled) {
        store.setItem(TRUSTED_DEVICE_AUTH_PREF_KEY, 'true');
      } else {
        store.removeItem(TRUSTED_DEVICE_AUTH_PREF_KEY);
      }
    } catch {
      // Ignore storage write errors in restricted contexts
    }
  }
  return { enabled: Boolean(enabled), mode: enabled ? 'local' : 'session' };
}

/**
 * Saves the trusted-device persistent cache preference.
 * Note: Changing Firestore's localCache mode requires a clean reload (and IndexedDB cleanup
 * requires terminating Firestore cleanly when no other tabs hold an open lock).
 */
export function setTrustedDeviceCachePreference(
  enabled: boolean,
  storage?: StorageLikeWriter | null
): { enabled: boolean; requiresReload: boolean } {
  const store = storage === undefined ? getDefaultLocalStorage() : storage;
  if (store) {
    try {
      if (enabled) {
        store.setItem(TRUSTED_DEVICE_CACHE_PREF_KEY, 'true');
      } else {
        store.removeItem(TRUSTED_DEVICE_CACHE_PREF_KEY);
      }
    } catch {
      // Ignore storage write errors in restricted contexts
    }
  }
  return { enabled: Boolean(enabled), requiresReload: true };
}

/**
 * Removes ONLY persisted team snapshot keys (`maydan_team_cache_v1*`) from localStorage
 * without disturbing display preferences, auth preferences, or join drafts.
 */
export function purgePersistentTeamSnapshots(localStore?: StorageLikeFull | null): string[] {
  const ls = localStore === undefined ? getDefaultLocalStorage() : localStore;
  if (!ls) return [];
  const removed: string[] = [];
  try {
    const keys: string[] = [];
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i);
      if (k && k.startsWith('maydan_team_cache_v1')) {
        keys.push(k);
      }
    }
    for (const k of keys) {
      try {
        ls.removeItem(k);
        removed.push(k);
      } catch {
        // Ignore single-key removal failure
      }
    }
  } catch {
    // Ignore storage enumeration errors
  }
  return removed;
}

/**
 * Collects all user-identifying / team-snapshot keys currently stored in localStorage.
 */
export function collectSensitiveStorageKeys(
  storage: Pick<StorageLikeFull, 'length' | 'key'> | null,
  options?: { preservePendingJoinDraft?: boolean }
): string[] {
  if (!storage) return [];
  const preserveJoin = Boolean(options?.preservePendingJoinDraft);
  const matches: string[] = [];
  try {
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (!k || PRESERVED_DEVICE_PREF_KEYS.has(k)) continue;
      if (preserveJoin && k.startsWith('maydan_pending_join_code')) continue;
      if (USER_SCOPED_STORAGE_PREFIXES.some((prefix) => k.startsWith(prefix))) {
        matches.push(k);
      }
    }
  } catch {
    // Ignore storage enumeration errors
  }
  return matches;
}

/**
 * Purges every user/team snapshot and account-scoped key from localStorage & sessionStorage.
 * Performs targeted cleanup so non-sensitive device display preferences remain intact.
 */
export function scrubAllAccountLocalCaches(
  localStore?: StorageLikeFull | null,
  sessionStore?: StorageLikeFull | null,
  options?: { preservePendingJoinDraft?: boolean }
): { removedLocalKeys: string[]; clearedSession: boolean } {
  const ls = localStore === undefined ? getDefaultLocalStorage() : localStore;
  const ss = sessionStore === undefined ? getDefaultSessionStorage() : sessionStore;
  const removedLocalKeys: string[] = [];
  let clearedSession = false;

  if (ls) {
    const keysToRemove = collectSensitiveStorageKeys(ls, options);
    for (const k of keysToRemove) {
      try {
        ls.removeItem(k);
        removedLocalKeys.push(k);
      } catch {
        // Ignore single-key removal failure
      }
    }
  }

  if (ss) {
    try {
      if (typeof ss.clear === 'function') {
        ss.clear();
        clearedSession = true;
      } else {
        const sKeys: string[] = [];
        for (let i = 0; i < ss.length; i++) {
          const k = ss.key(i);
          if (k) sKeys.push(k);
        }
        for (const k of sKeys) ss.removeItem(k);
        clearedSession = true;
      }
    } catch {
      // Ignore sessionStorage clear errors
    }
  }

  return { removedLocalKeys, clearedSession };
}

/**
 * Validates that a reCAPTCHA v3 site key is genuinely configured (not empty or a placeholder).
 */
export function isValidRecaptchaSiteKey(rawKey: unknown): boolean {
  const key = String(rawKey ?? '').trim();
  if (key.length < 16) return false;
  if (/^(your_|placeholder|changeme|example|dummy|test_key|replace_me)/i.test(key)) {
    return false;
  }
  return true;
}

/**
 * Classifies Firestore errors during account/data deletion so missing optional documents
 * (`not-found`) are cleanly distinguished from real permission/network failures that MUST
 * halt Firebase Auth deletion and report a partial cleanup state.
 */
export function classifyAccountCleanupError(err: unknown): {
  kind: AccountCleanupErrorKind;
  code: string;
  message: string;
  ignorableForOptionalDoc: boolean;
} {
  const code =
    err && typeof err === 'object' && 'code' in err
      ? String((err as { code?: unknown }).code || '').toLowerCase()
      : '';
  const message =
    err instanceof Error
      ? err.message
      : err && typeof err === 'object' && 'message' in err
        ? String((err as { message?: unknown }).message || '')
        : String(err ?? '');
  const lower = message.toLowerCase();

  if (
    code === 'not-found' ||
    code === 'firestore/not-found' ||
    lower.includes('no document to update') ||
    lower.includes('not found')
  ) {
    return { kind: 'not_found', code: code || 'not-found', message, ignorableForOptionalDoc: true };
  }

  if (
    code === 'permission-denied' ||
    code === 'firestore/permission-denied' ||
    lower.includes('missing or insufficient permissions')
  ) {
    return {
      kind: 'permission_denied',
      code: code || 'permission-denied',
      message,
      ignorableForOptionalDoc: false,
    };
  }

  if (
    code === 'unavailable' ||
    code === 'firestore/unavailable' ||
    code === 'deadline-exceeded' ||
    lower.includes('offline') ||
    lower.includes('network') ||
    lower.includes('failed to fetch')
  ) {
    return { kind: 'network', code: code || 'unavailable', message, ignorableForOptionalDoc: false };
  }

  if (code === 'failed-precondition' || code === 'firestore/failed-precondition') {
    return {
      kind: 'precondition',
      code: code || 'failed-precondition',
      message,
      ignorableForOptionalDoc: false,
    };
  }

  return { kind: 'unknown', code: code || 'unknown', message, ignorableForOptionalDoc: false };
}

/**
 * Auth account deletion may proceed ONLY when zero real Firestore cleanup failures occurred.
 */
export function shouldAllowAuthAccountDeletion(failures: AccountCleanupFailure[]): boolean {
  return Array.isArray(failures) && failures.length === 0;
}

/**
 * Accurately classifies Firestore connectivity probe errors instead of masking
 * quota/config/internal failures as healthy connections.
 */
export function classifyConnectionError(err: unknown): ConnectionDiagnosticResult {
  const code =
    err && typeof err === 'object' && 'code' in err
      ? String((err as { code?: unknown }).code || '').toLowerCase()
      : '';
  const message =
    err instanceof Error
      ? err.message
      : err && typeof err === 'object' && 'message' in err
        ? String((err as { message?: unknown }).message || '')
        : String(err ?? '');
  const lower = message.toLowerCase();

  if (
    code === 'permission-denied' ||
    code === 'firestore/permission-denied' ||
    lower.includes('missing or insufficient permissions')
  ) {
    return {
      reachable: true,
      status: 'permission_denied_reachable',
      code: code || 'permission-denied',
      message,
    };
  }

  if (
    code === 'unavailable' ||
    code === 'firestore/unavailable' ||
    lower.includes('client is offline') ||
    lower.includes('network') ||
    lower.includes('failed to fetch')
  ) {
    return {
      reachable: false,
      status: 'offline',
      code: code || 'unavailable',
      message,
    };
  }

  if (
    code === 'resource-exhausted' ||
    code === 'firestore/resource-exhausted' ||
    lower.includes('quota') ||
    lower.includes('resource exhausted')
  ) {
    return {
      reachable: false,
      status: 'quota_exceeded',
      code: code || 'resource-exhausted',
      message,
    };
  }

  if (
    code === 'invalid-argument' ||
    code === 'not-found' ||
    code === 'failed-precondition' ||
    code === 'unauthenticated' ||
    lower.includes('api key') ||
    lower.includes('project') ||
    lower.includes('database')
  ) {
    return {
      reachable: false,
      status: 'config_error',
      code: code || 'config-error',
      message,
    };
  }

  return {
    reachable: false,
    status: 'internal_error',
    code: code || 'internal',
    message,
  };
}

export interface AccountDeletionTeamSnapshot {
  id: string;
  teamName?: string;
  founderUid?: string;
  memberCount?: number;
  deletedAt?: unknown;
}

export type TeamAccountCleanupAction =
  | 'block_active_founder_with_members'
  | 'soft_delete_solo_owned'
  | 'leave_active_member'
  | 'cleanup_soft_deleted_member'
  | 'cleanup_soft_deleted_founder'
  | 'cleanup_orphan_refs';

/**
 * Deduplicates and collects every candidate Multi-Team ID associated with a user from both
 * the in-memory session cache and the fresh `/users/{uid}` Firestore registry (including
 * soft-deleted teams and pending join requests) so account deletion leaves zero orphan PII.
 */
export function collectAccountDeletionTeamCandidates(input: {
  activeTeamIds?: Array<string | null | undefined>;
  userRegistryDoc?: {
    teamIds?: unknown;
    ownedTeamIds?: unknown;
    pendingJoinTeamId?: unknown;
    activeTeamId?: unknown;
  } | null;
}): string[] {
  const seen = new Set<string>();
  const addId = (raw: unknown) => {
    const id = String(raw ?? '').trim();
    if (!id || id === 'main') return;
    if (!/^[a-zA-Z0-9_-]{2,64}$/.test(id)) return;
    seen.add(id);
  };

  if (Array.isArray(input.activeTeamIds)) {
    input.activeTeamIds.forEach(addId);
  }
  const uDoc = input.userRegistryDoc;
  if (uDoc && typeof uDoc === 'object') {
    if (Array.isArray(uDoc.teamIds)) uDoc.teamIds.forEach(addId);
    if (Array.isArray(uDoc.ownedTeamIds)) uDoc.ownedTeamIds.forEach(addId);
    addId(uDoc.pendingJoinTeamId);
    addId(uDoc.activeTeamId);
  }
  return Array.from(seen);
}

/**
 * Determines the exact Firestore-rules-compliant cleanup strategy for a single team during
 * account deletion:
 * - Active founder with >1 members => blocks deletion until leadership transfer or team deletion.
 * - Active solo founder (<=1 member) => clean private/vote/joinRequest docs + soft-delete team.
 * - Active non-founder member => clean private/vote/joinRequest docs + atomic leave batch.
 * - Soft-deleted team (deletedAt != null) => NEVER update locked teams/{tid} doc; clean
 *   private/vote/joinRequest docs and (for non-founders) delete members/{uid} directly.
 * - Missing/deleted team doc => clean residual private/vote/joinRequest docs safely.
 */
export function planTeamAccountCleanup(
  team: AccountDeletionTeamSnapshot | null | undefined,
  uid: string
): TeamAccountCleanupAction {
  if (!team || !team.id) return 'cleanup_orphan_refs';
  const isFounder = Boolean(uid && team.founderUid === uid);
  const isSoftDeleted = team.deletedAt !== null && team.deletedAt !== undefined;

  if (isSoftDeleted) {
    return isFounder ? 'cleanup_soft_deleted_founder' : 'cleanup_soft_deleted_member';
  }
  if (isFounder) {
    return Number(team.memberCount ?? 1) > 1
      ? 'block_active_founder_with_members'
      : 'soft_delete_solo_owned';
  }
  return 'leave_active_member';
}


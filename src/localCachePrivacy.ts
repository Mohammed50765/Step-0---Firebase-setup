/**
 * ميدان 6v6 — Privacy-Safe Local Cache & Connection Diagnostics
 *
 * Security & Shared-Device Privacy Policy:
 * - Default Firestore local cache mode is `memoryLocalCache()` so zero team/player/health
 *   records are persisted to IndexedDB on shared or borrowed devices.
 * - Opt-in `persistentLocalCache()` is enabled ONLY when the user explicitly marks the
 *   current device as a trusted personal device (checked BEFORE `initializeFirestore`).
 * - On sign-out or account switch, `scrubAllAccountLocalCaches()` purges every user-scoped
 *   localStorage key (including all `maydan_team_cache_v1__*` Multi-Team snapshots, migration
 *   checkpoints, pending invite codes, and per-UID flags) and clears sessionStorage.
 */

export const TRUSTED_DEVICE_CACHE_PREF_KEY = 'maydan_trusted_device_cache_v1';

export const USER_SCOPED_STORAGE_PREFIXES = [
  'maydan_team_cache_v1',
  'maydan_google_player_',
  'maydan_privacy_ok_',
  'maydan_pending_join_code',
  'maydan_m6_migration_ckpt',
  'maydan_onboard_draft',
  'maydan_active_team_',
  'maydan_last_uid',
] as const;

export const PRESERVED_DEVICE_PREF_KEYS = new Set<string>([
  TRUSTED_DEVICE_CACHE_PREF_KEY,
  'maydan_data_saver',
  'maydan_tactics_muted',
]);

export type FirestoreCacheMode = 'memory' | 'persistent';

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
 * Saves the trusted-device persistent cache preference.
 * Note: Changing Firestore's localCache mode requires a clean page reload; never call
 * clearIndexedDbPersistence() against an already active Firestore instance.
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
 * Collects all user-identifying / team-snapshot keys currently stored in localStorage.
 */
export function collectSensitiveStorageKeys(storage: Pick<StorageLikeFull, 'length' | 'key'> | null): string[] {
  if (!storage) return [];
  const matches: string[] = [];
  try {
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (!k || PRESERVED_DEVICE_PREF_KEYS.has(k)) continue;
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
 * Must be called on sign-out, account deletion, and cross-account login switch.
 */
export function scrubAllAccountLocalCaches(
  localStore?: StorageLikeFull | null,
  sessionStore?: StorageLikeFull | null
): { removedLocalKeys: string[]; clearedSession: boolean } {
  const ls = localStore === undefined ? getDefaultLocalStorage() : localStore;
  const ss = sessionStore === undefined ? getDefaultSessionStorage() : sessionStore;
  const removedLocalKeys: string[] = [];
  let clearedSession = false;

  if (ls) {
    const keysToRemove = collectSensitiveStorageKeys(ls);
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

  // Probing a default-deny sentinel doc (/test/connection) returns permission-denied
  // from the live Firestore backend, proving network reachability & valid project config.
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

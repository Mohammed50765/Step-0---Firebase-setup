import { initializeApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaV3Provider, type AppCheck } from 'firebase/app-check';
import {
  browserLocalPersistence,
  browserSessionPersistence,
  deleteUser,
  getAuth,
  getRedirectResult,
  GoogleAuthProvider,
  indexedDBLocalPersistence,
  setPersistence,
  signInWithRedirect,
} from 'firebase/auth';
import {
  doc,
  getDocFromServer,
  getFirestore,
  initializeFirestore,
  memoryLocalCache,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';
import {
  classifyConnectionError,
  isTrustedDeviceCacheEnabled,
  resolveFirestoreCacheMode,
  setTrustedDeviceCachePreference,
  type ConnectionDiagnosticResult,
  type FirestoreCacheMode,
} from './localCachePrivacy';

const app = initializeApp(firebaseConfig);

export const ACTIVE_FIRESTORE_CACHE_MODE: FirestoreCacheMode = resolveFirestoreCacheMode();

function initPrivacySafeDb(mode: FirestoreCacheMode): Firestore {
  if (mode === 'persistent') {
    try {
      return initializeFirestore(
        app,
        {
          localCache: persistentLocalCache({
            tabManager: persistentMultipleTabManager(),
          }),
        },
        firebaseConfig.firestoreDatabaseId
      );
    } catch {
      try {
        return initializeFirestore(
          app,
          {
            localCache: persistentLocalCache({}),
          },
          firebaseConfig.firestoreDatabaseId
        );
      } catch {
        return getFirestore(app, firebaseConfig.firestoreDatabaseId);
      }
    }
  }

  // Shared-device safe default: strictly in-memory cache so zero team/player/health
  // documents persist to IndexedDB across sessions or accounts.
  try {
    return initializeFirestore(
      app,
      {
        localCache: memoryLocalCache(),
      },
      firebaseConfig.firestoreDatabaseId
    );
  } catch {
    return getFirestore(app, firebaseConfig.firestoreDatabaseId);
  }
}

export const db: Firestore = initPrivacySafeDb(ACTIVE_FIRESTORE_CACHE_MODE);
export const auth = getAuth(app);

export function getLocalCacheMode(): FirestoreCacheMode {
  return ACTIVE_FIRESTORE_CACHE_MODE;
}

export { isTrustedDeviceCacheEnabled, setTrustedDeviceCachePreference };

// Optional Firebase App Check (Web - reCAPTCHA v3).
// Configured purely via public VITE_RECAPTCHA_SITE_KEY env var (never hardcoded secrets or debug tokens).
let appCheckInstance: AppCheck | null = null;
let appCheckConfigured = false;

function initOptionalAppCheck(): void {
  if (typeof window === 'undefined') return;
  const rawKey =
    typeof import.meta !== 'undefined' && import.meta.env
      ? String(import.meta.env.VITE_RECAPTCHA_SITE_KEY || '').trim()
      : '';
  if (!rawKey || rawKey.length < 16) {
    appCheckConfigured = false;
    return;
  }
  appCheckConfigured = true;
  try {
    appCheckInstance = initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(rawKey),
      isTokenAutoRefreshEnabled: true,
    });
  } catch (err) {
    console.warn('App Check initialization skipped:', err instanceof Error ? err.message : String(err));
    appCheckInstance = null;
  }
}

initOptionalAppCheck();

export function getAppCheckStatus(): {
  configured: boolean;
  active: boolean;
  mode: 'recaptcha-v3' | 'not-configured';
} {
  return {
    configured: appCheckConfigured,
    active: appCheckInstance !== null,
    mode: appCheckInstance !== null ? 'recaptcha-v3' : 'not-configured',
  };
}

async function initAuthPersistence(): Promise<void> {
  // On shared/untrusted devices (default), browserLocalPersistence is kept ONLY for
  // Google Auth session continuity while Firestore stays strictly memory-only and
  // all localStorage team snapshots are scrubbed on sign-out & account switch.
  const candidates = [
    browserLocalPersistence,
    indexedDBLocalPersistence,
    browserSessionPersistence,
  ];
  for (const mode of candidates) {
    try {
      await setPersistence(auth, mode);
      return;
    } catch {
      // Try next supported persistence layer
    }
  }
  console.warn('Firebase Auth could not configure explicit persistence; using SDK default.');
}

export const authPersistenceReady: Promise<void> = initAuthPersistence();
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });
export { deleteUser, getRedirectResult, signInWithRedirect };

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid ?? null,
      email: auth.currentUser?.email ?? null,
      emailVerified: auth.currentUser?.emailVerified ?? null,
      isAnonymous: auth.currentUser?.isAnonymous ?? null,
      tenantId: auth.currentUser?.tenantId ?? null,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function diagnoseConnection(): Promise<ConnectionDiagnosticResult> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    return {
      reachable: true,
      status: 'connected',
      code: 'ok',
      message: 'Connected to Firestore backend.',
    };
  } catch (error) {
    const diag = classifyConnectionError(error);
    if (!diag.reachable) {
      console.warn(`Firestore connection diagnostic [${diag.status}]:`, diag.code, diag.message);
    }
    return diag;
  }
}

export async function testConnection(): Promise<boolean> {
  const diag = await diagnoseConnection();
  return diag.reachable;
}

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
  clearIndexedDbPersistence,
  doc,
  getDocFromServer,
  getFirestore,
  initializeFirestore,
  memoryLocalCache,
  persistentLocalCache,
  persistentMultipleTabManager,
  terminate,
  type Firestore,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';
import {
  classifyConnectionError,
  isTrustedDeviceAuthEnabled,
  isTrustedDeviceCacheEnabled,
  isValidRecaptchaSiteKey,
  purgePersistentTeamSnapshots,
  resolveAuthPersistenceMode,
  resolveFirestoreCacheMode,
  setTrustedDeviceAuthPreference,
  setTrustedDeviceCachePreference,
  type AppCheckLifecycleState,
  type AppCheckStatus,
  type AuthPersistenceMode,
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

export {
  isTrustedDeviceAuthEnabled,
  isTrustedDeviceCacheEnabled,
  setTrustedDeviceAuthPreference,
  setTrustedDeviceCachePreference,
};

/**
 * Safely disables persistent caching and, when currently running in persistent mode,
 * follows Firebase's strict `terminate(db)` -> `clearIndexedDbPersistence(db)` sequence.
 * Never claims IndexedDB was cleared unless both APIs resolve without error.
 */
export async function disableTrustedDeviceCacheSafely(): Promise<{
  enabled: false;
  indexedDbAttempted: boolean;
  indexedDbCleared: boolean;
  requiresReload: boolean;
  errorCode?: string;
  messageAr: string;
}> {
  setTrustedDeviceCachePreference(false);
  purgePersistentTeamSnapshots();

  if (ACTIVE_FIRESTORE_CACHE_MODE !== 'persistent') {
    return {
      enabled: false,
      indexedDbAttempted: false,
      indexedDbCleared: false,
      requiresReload: false,
      messageAr:
        'الوضع المؤقت الآمن نشط بالفعل وتم التأكد من إزالة لقطات الفريق من localStorage.',
    };
  }

  try {
    await terminate(db);
    await clearIndexedDbPersistence(db);
    return {
      enabled: false,
      indexedDbAttempted: true,
      indexedDbCleared: true,
      requiresReload: true,
      messageAr:
        'تم إيقاف التخزين الدائم ومسح بيانات IndexedDB القديمة بنجاح — أعد التحميل الآن لبدء الجلسة بوضع الذاكرة المؤقتة الآمن ✓',
    };
  } catch (err: unknown) {
    const errorCode =
      err && typeof err === 'object' && 'code' in err
        ? String((err as { code?: unknown }).code || 'unknown')
        : 'unknown';
    return {
      enabled: false,
      indexedDbAttempted: true,
      indexedDbCleared: false,
      requiresReload: true,
      errorCode,
      messageAr:
        'تم تعطيل التخزين الدائم للجلسات القادمة، لكن تعذّر مسح بيانات IndexedDB القديمة الآن (تأكّد من إغلاق باقي تبويبات التطبيق أو امسح بيانات الموقع من المتصفح، ثم أعد التحميل).',
    };
  }
}

// Optional Firebase App Check (Web - reCAPTCHA v3).
// Strictly separates 'unconfigured' | 'initializing' | 'active' | 'failed'.
// Never marks active before initializeAppCheck succeeds; never uses hardcoded secrets/debug tokens.
let appCheckInstance: AppCheck | null = null;
let appCheckState: AppCheckLifecycleState = 'unconfigured';
let appCheckErrorMessage: string | undefined;

function initOptionalAppCheck(): void {
  if (typeof window === 'undefined') {
    appCheckState = 'unconfigured';
    return;
  }
  const rawKey =
    typeof import.meta !== 'undefined' && import.meta.env
      ? String(import.meta.env.VITE_RECAPTCHA_SITE_KEY || '').trim()
      : '';
  if (!isValidRecaptchaSiteKey(rawKey)) {
    appCheckState = 'unconfigured';
    appCheckInstance = null;
    appCheckErrorMessage = undefined;
    return;
  }
  appCheckState = 'initializing';
  try {
    const instance = initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(rawKey),
      isTokenAutoRefreshEnabled: true,
    });
    appCheckInstance = instance;
    appCheckState = 'active';
    appCheckErrorMessage = undefined;
  } catch (err) {
    appCheckInstance = null;
    appCheckState = 'failed';
    appCheckErrorMessage = err instanceof Error ? err.message : String(err);
    console.warn('App Check initialization failed:', appCheckErrorMessage);
  }
}

initOptionalAppCheck();

export function getAppCheckStatus(): AppCheckStatus {
  const isActive = appCheckState === 'active' && appCheckInstance !== null;
  return {
    state: appCheckState,
    configured: appCheckState !== 'unconfigured',
    active: isActive,
    mode: isActive ? 'recaptcha-v3' : 'not-configured',
    ...(appCheckErrorMessage ? { errorMessage: appCheckErrorMessage } : {}),
  };
}

let activeAuthPersistenceMode: AuthPersistenceMode = resolveAuthPersistenceMode();

export function getAuthPersistenceMode(): AuthPersistenceMode {
  return activeAuthPersistenceMode;
}

async function configureAuthPersistence(preferredMode: AuthPersistenceMode): Promise<AuthPersistenceMode> {
  // Shared-device privacy default: browserSessionPersistence so closing the browser
  // ends the session automatically. browserLocalPersistence is used ONLY on explicit opt-in.
  const candidates =
    preferredMode === 'local'
      ? [
          { mode: 'local' as const, persistence: browserLocalPersistence },
          { mode: 'local' as const, persistence: indexedDBLocalPersistence },
          { mode: 'session' as const, persistence: browserSessionPersistence },
        ]
      : [
          { mode: 'session' as const, persistence: browserSessionPersistence },
          { mode: 'local' as const, persistence: browserLocalPersistence },
        ];

  for (const item of candidates) {
    try {
      await setPersistence(auth, item.persistence);
      activeAuthPersistenceMode = item.mode;
      return item.mode;
    } catch {
      // Try next supported persistence layer
    }
  }
  console.warn('Firebase Auth could not configure explicit persistence; using SDK default.');
  return activeAuthPersistenceMode;
}

export async function applyAuthPersistencePreference(
  rememberOnTrustedDevice: boolean
): Promise<{ enabled: boolean; mode: AuthPersistenceMode }> {
  const pref = setTrustedDeviceAuthPreference(rememberOnTrustedDevice);
  const appliedMode = await configureAuthPersistence(pref.mode);
  return { enabled: appliedMode === 'local', mode: appliedMode };
}

export const authPersistenceReady: Promise<void> = configureAuthPersistence(
  resolveAuthPersistenceMode()
).then(() => undefined);

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

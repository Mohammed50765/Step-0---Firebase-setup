import {
  clampStr,
  ROYAL_PRIMARY,
  sanitizeFormation,
  sanitizeHexColor,
  sanitizeInviteCode,
  stats6ToLegacySkills,
} from './security';
import { getPresetStats6ForPosition, type Stats6 } from './ratingEngine';

export type BackendSessionStatus = 'ready' | 'pending' | 'rejected' | 'needs_join';
export type LoginTabMode = 'signin' | 'signup';
export type PostAuthMode = 'cloud_captain' | 'cloud_member' | 'google_standard';
export type GoogleJoinStatus = 'none' | 'needs_join' | 'pending' | 'rejected';

export interface PostAuthRouteInput {
  status: BackendSessionStatus;
  isCaptain: boolean;
  loginAuthTab: LoginTabMode;
  urlInviteCode?: string;
}

export interface PostAuthRouteDecision {
  mode: PostAuthMode;
  enterAppImmediately: boolean;
  attachCloudListeners: boolean;
  isCaptainSession: boolean;
  role: 'admin' | 'player';
  googleJoinStatus: GoogleJoinStatus;
  openJoinModal: boolean;
  showTeamOptionsBar: boolean;
  prefillInviteCode: string;
}

/**
 * Pure routing decision executed right after Google authentication resolves.
 * Guarantees:
 * - Captains (verified via Firestore admins/{uid}) enter full cloud captain mode.
 * - Existing team members (verified via Firestore players/{uid}) enter full cloud member mode.
 * - Any other Google user enters immediately as a safe standard player (`role: 'player'`),
 *   never blocked on an invite-code gate and never granted admin privileges or unauthorized listeners.
 * - If an invite link (`?join=CODE`) was opened, the join modal opens optionally on top of the app.
 */
export function resolvePostAuthRoute(input: PostAuthRouteInput): PostAuthRouteDecision {
  const cleanCode = sanitizeInviteCode(input.urlInviteCode || '');

  if (input.status === 'ready') {
    const isCap = Boolean(input.isCaptain);
    return {
      mode: isCap ? 'cloud_captain' : 'cloud_member',
      enterAppImmediately: true,
      attachCloudListeners: true,
      isCaptainSession: isCap,
      role: isCap ? 'admin' : 'player',
      googleJoinStatus: 'none',
      openJoinModal: false,
      showTeamOptionsBar: false,
      prefillInviteCode: '',
    };
  }

  const joinStatus: GoogleJoinStatus =
    input.status === 'pending'
      ? 'pending'
      : input.status === 'rejected'
        ? 'rejected'
        : 'needs_join';

  return {
    mode: 'google_standard',
    enterAppImmediately: true,
    attachCloudListeners: false,
    isCaptainSession: false,
    role: 'player',
    googleJoinStatus: joinStatus,
    openJoinModal: joinStatus === 'needs_join' && Boolean(cleanCode),
    showTeamOptionsBar: true,
    prefillInviteCode: cleanCode,
  };
}

/**
 * Builds an isolated per-UID localStorage key for standard Google player mode.
 */
export function buildGoogleLocalStorageKey(uid: string): string {
  const safeUid = String(uid || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 64);
  return safeUid ? `maydan_google_player_${safeUid}` : 'six_aside_demo_local_v3';
}

export interface DefaultGooglePlayerProfile {
  id: string;
  ownerUid: string;
  name: string;
  role: 'player';
  jersey: number;
  age: number;
  height: number;
  weight: number;
  foot: string;
  primaryPos: string;
  secondaryPos: string;
  photo: string;
  photoZoom: number;
  photoY: number;
  availableStatus: 'available';
  stats6: Stats6;
  roleOverride: 'CM';
  skills: ReturnType<typeof stats6ToLegacySkills>;
  top3Strengths: string;
  weak3Points: string;
  seasonGoal: string;
  availability: string;
}

/**
 * Creates a safe default player profile for any authenticated Google user entering directly.
 * Role is strictly hardcoded to 'player' (never 'admin').
 */
export function buildDefaultGooglePlayerProfile(fbUser: {
  uid?: string | null;
  displayName?: string | null;
  email?: string | null;
}): DefaultGooglePlayerProfile {
  const uid = String(fbUser?.uid || '').trim() || `g_${Date.now()}`;
  const rawDisplay = clampStr(fbUser?.displayName || '', 60);
  const emailLocal =
    !rawDisplay && fbUser?.email
      ? clampStr(String(fbUser.email).split('@')[0] || '', 40)
      : '';
  const name = rawDisplay || emailLocal || 'لاعب ميدان';
  const stats6 = getPresetStats6ForPosition('لاعب وسط', 'CM');
  return {
    id: uid,
    ownerUid: uid,
    name,
    role: 'player',
    jersey: 10,
    age: 20,
    height: 175,
    weight: 70,
    foot: 'يمين',
    primaryPos: 'لاعب وسط',
    secondaryPos: 'جناح',
    photo: '',
    photoZoom: 105,
    photoY: 18,
    availableStatus: 'available',
    stats6,
    roleOverride: 'CM',
    skills: stats6ToLegacySkills(stats6),
    top3Strengths: 'اللعب الجماعي، التمرير',
    weak3Points: '',
    seasonGoal: 'تطوير الأداء والاستمتاع باللعب',
    availability: 'متاح',
  };
}

export interface PersonalTeamInput {
  teamName: string;
  formation?: string;
  primaryColor?: string;
}

export interface SanitizedPersonalTeamResult {
  valid: boolean;
  error?: string;
  teamName: string;
  formation: string;
  primaryColor: string;
}

/**
 * Validates and sanitizes inputs for the optional in-app "إنشاء فريق" flow.
 */
export function sanitizePersonalTeamInput(input: PersonalTeamInput): SanitizedPersonalTeamResult {
  const teamName = clampStr(input?.teamName || '', 40);
  if (teamName.length < 2) {
    return {
      valid: false,
      error: 'أدخل اسم الفريق (حرفان على الأقل)',
      teamName: '',
      formation: '2-2-1',
      primaryColor: ROYAL_PRIMARY,
    };
  }
  const formation = sanitizeFormation(input?.formation || '2-2-1');
  const primaryColor = sanitizeHexColor(input?.primaryColor || ROYAL_PRIMARY, ROYAL_PRIMARY);
  return {
    valid: true,
    teamName,
    formation,
    primaryColor,
  };
}

export interface CleanSessionFlags {
  isFirebaseMode: false;
  isGoogleStandardMode: false;
  googleJoinStatus: 'none';
  isCaptainSession: false;
  appStarted: false;
  db: null;
  user: null;
}

/**
 * Single source of truth for Captain UI and Captain action authorization.
 * Local player `role` ('admin' or 'player') MUST NEVER grant Captain privileges;
 * authorization comes exclusively from `isCaptainSession` resolved via Firestore `admins/{uid}`.
 */
export function isCaptainAuthorized(input: {
  isFirebaseMode: boolean;
  isCaptainSession: boolean;
  localPlayerRole?: unknown;
}): boolean {
  void input?.localPlayerRole;
  return Boolean(input?.isFirebaseMode && input?.isCaptainSession);
}

/**
 * Produces a zeroed session-state object used on sign-out, auth-null, and account change.
 */
export function createCleanSessionFlags(): CleanSessionFlags {
  return {
    isFirebaseMode: false,
    isGoogleStandardMode: false,
    googleJoinStatus: 'none',
    isCaptainSession: false,
    appStarted: false,
    db: null,
    user: null,
  };
}

export const FRIENDS_MODE_DEFAULT = true;

/**
 * Friends Mode is enabled by default for casual 6v6 friend squads.
 * Stored as an explicit opt-out check (`!== false`) so Firestore settings/team
 * remains strictly compliant with existing security rules.
 */
export function isFriendsModeEnabled(settings?: { friendsMode?: unknown } | null): boolean {
  return settings?.friendsMode !== false;
}

/**
 * Centralized tab navigation guard: blocks direct or programmatic navigation
 * to 'admin' unless the session is strictly verified via Firestore admins/{uid}.
 */
export function switchTabGuard(
  targetTab: string,
  authCtx: {
    isFirebaseMode: boolean;
    isCaptainSession: boolean;
    localPlayerRole?: unknown;
  }
): { tab: string; blockedAdmin: boolean } {
  const cleanTab = String(targetTab || '').trim() || 'fifa';
  if (cleanTab === 'admin' && !isCaptainAuthorized(authCtx)) {
    return { tab: 'fifa', blockedAdmin: true };
  }
  return { tab: cleanTab, blockedAdmin: false };
}

export interface WipeGuardInput {
  isFirebaseMode: boolean;
  isCaptainSession: boolean;
  localPlayerRole?: unknown;
  backupDownloaded: boolean;
  secondConfirmed: boolean;
  confirmText: string;
}

export interface WipeGuardResult {
  canWipe: boolean;
  missingStep: 'unauthorized' | 'backup' | 'double_confirm' | 'confirm_word' | null;
  missingStepAr: string;
}

/**
 * Enforces Captain-only authorization, mandatory session backup download,
 * checkbox acknowledgement, and typing "حذف" before wiping team data.
 */
export function evaluateWipeGuard(input: WipeGuardInput): WipeGuardResult {
  if (
    !isCaptainAuthorized({
      isFirebaseMode: input.isFirebaseMode,
      isCaptainSession: input.isCaptainSession,
      localPlayerRole: input.localPlayerRole,
    })
  ) {
    return {
      canWipe: false,
      missingStep: 'unauthorized',
      missingStepAr: 'مسح بيانات الفريق متاح للكابتن المعتمد فقط',
    };
  }
  if (!input.backupDownloaded) {
    return {
      canWipe: false,
      missingStep: 'backup',
      missingStepAr: 'حمّل نسخة احتياطية JSON في هذه الجلسة أولاً قبل المسح',
    };
  }
  if (!input.secondConfirmed) {
    return {
      canWipe: false,
      missingStep: 'double_confirm',
      missingStepAr: 'فعّل خانة التأكيد المزدوج بأنك حفظت النسخة الاحتياطية أولاً',
    };
  }
  if (String(input.confirmText || '').trim() !== 'حذف') {
    return {
      canWipe: false,
      missingStep: 'confirm_word',
      missingStepAr: 'اكتب كلمة "حذف" للتأكيد النهائي',
    };
  }
  return {
    canWipe: true,
    missingStep: null,
    missingStepAr: '',
  };
}

declare global {
  interface Window {
    MaydanAuthFlow?: {
      resolvePostAuthRoute: typeof resolvePostAuthRoute;
      buildGoogleLocalStorageKey: typeof buildGoogleLocalStorageKey;
      buildDefaultGooglePlayerProfile: typeof buildDefaultGooglePlayerProfile;
      sanitizePersonalTeamInput: typeof sanitizePersonalTeamInput;
      isCaptainAuthorized: typeof isCaptainAuthorized;
      createCleanSessionFlags: typeof createCleanSessionFlags;
      isFriendsModeEnabled: typeof isFriendsModeEnabled;
      switchTabGuard: typeof switchTabGuard;
      evaluateWipeGuard: typeof evaluateWipeGuard;
    };
  }
}

if (typeof window !== 'undefined') {
  window.MaydanAuthFlow = {
    resolvePostAuthRoute,
    buildGoogleLocalStorageKey,
    buildDefaultGooglePlayerProfile,
    sanitizePersonalTeamInput,
    isCaptainAuthorized,
    createCleanSessionFlags,
    isFriendsModeEnabled,
    switchTabGuard,
    evaluateWipeGuard,
  };
}

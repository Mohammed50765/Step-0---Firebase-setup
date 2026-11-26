import {
  clampNum,
  clampStr,
  generateSecureInviteCode,
  ROYAL_PRIMARY,
  sanitizeHexColor,
  sanitizeInviteCode,
  TEAM_ID,
} from './security';
import { isCaptainAuthorized } from './authFlow';

export type InviteUsageType = 'single' | 'multi';
export type InviteStatus = 'active' | 'expired' | 'revoked' | 'completed';

export const DEFAULT_INVITE_USAGE_TYPE: InviteUsageType = 'single';
export const DEFAULT_INVITE_MAX_USES = 1;
export const DEFAULT_INVITE_DURATION_DAYS = 7;
export const MAX_ALLOWED_INVITE_USES = 100;
export const MAX_ALLOWED_DURATION_DAYS = 90;
const DAY_MS = 86_400_000;

export type InviteJoinMode = 'approval' | 'instant';

export interface SmartInviteOptionsInput {
  teamId?: string;
  usageType?: InviteUsageType | string;
  maxUses?: number | string;
  durationDays?: number | string;
  joinMode?: InviteJoinMode | string;
  requireApproval?: boolean;
  isMemberShareCode?: boolean;
  teamName?: string;
  appName?: string;
  primaryColor?: string;
  createdBy?: string;
  nowMs?: number;
  customCode?: string;
}

export interface SanitizedInviteOptions {
  teamId: string;
  usageType: InviteUsageType;
  maxUses: number;
  durationDays: number;
  joinMode: InviteJoinMode;
  requireApproval: boolean;
  isMemberShareCode: boolean;
  teamName: string;
  appName: string;
  primaryColor: string;
  createdBy?: string;
  createdAtMs: number;
  expiresAtMs: number;
}

export interface SmartInviteRecord {
  code: string;
  teamId: string;
  teamName: string;
  appName: string;
  primaryColor: string;
  usageType: InviteUsageType;
  maxUses: number;
  usedCount: number;
  durationDays: number;
  createdAtMs: number;
  expiresAtMs: number;
  status: InviteStatus;
  active: boolean;
  joinMode?: InviteJoinMode;
  requireApproval: boolean;
  isMemberShareCode?: boolean;
  createdBy?: string;
  lastUsedBy?: string;
}

export interface InviteStatusMeta {
  status: InviteStatus;
  labelAr: 'فعالة' | 'منتهية' | 'ملغاة' | 'مكتملة';
  reasonAr: string;
  colorHex: string;
  bgRgba: string;
  borderRgba: string;
  canUse: boolean;
  remainingUses: number;
  maxUses: number;
  usedCount: number;
  createdDateStr: string;
  expiresDateStr: string;
}

export function formatEpochDateYmd(ms: number | undefined | null): string {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return '—';
  try {
    return new Date(n).toISOString().slice(0, 10);
  } catch {
    return '—';
  }
}

export function sanitizeInvitationOptions(input: SmartInviteOptionsInput = {}): SanitizedInviteOptions {
  const rawType = String(input.usageType || DEFAULT_INVITE_USAGE_TYPE).trim().toLowerCase();
  const usageType: InviteUsageType = rawType === 'multi' ? 'multi' : 'single';
  const maxUses =
    usageType === 'single'
      ? 1
      : Math.round(clampNum(input.maxUses, 2, MAX_ALLOWED_INVITE_USES, 5));
  const durationDays = Math.round(
    clampNum(input.durationDays, 1, MAX_ALLOWED_DURATION_DAYS, DEFAULT_INVITE_DURATION_DAYS)
  );
  const nowMs =
    typeof input.nowMs === 'number' && Number.isFinite(input.nowMs) && input.nowMs > 0
      ? Math.round(input.nowMs)
      : Date.now();
  const expiresAtMs = nowMs + durationDays * DAY_MS;

  const isMemberShareCode = input.isMemberShareCode === true;
  const rawJoinMode = String(input.joinMode || '').trim().toLowerCase();
  const requireApproval = isMemberShareCode
    ? true
    : rawJoinMode === 'instant'
      ? false
      : rawJoinMode === 'approval'
        ? true
        : input.requireApproval !== false;
  const joinMode: InviteJoinMode = requireApproval ? 'approval' : 'instant';
  const rawTeamId = String(input.teamId || TEAM_ID)
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 64);
  const teamId = rawTeamId.length >= 2 ? rawTeamId : TEAM_ID;

  const cleanCreatedBy =
    typeof input.createdBy === 'string' && input.createdBy.trim()
      ? input.createdBy
          .trim()
          .replace(/[^a-zA-Z0-9_-]/g, '')
          .slice(0, 128)
      : '';

  return {
    teamId,
    usageType,
    maxUses,
    durationDays,
    joinMode,
    requireApproval,
    isMemberShareCode,
    teamName: clampStr(input.teamName || 'فريق السداسي', 80) || 'فريق السداسي',
    appName: clampStr(input.appName || 'ميدان 6v6', 60) || 'ميدان 6v6',
    primaryColor: sanitizeHexColor(input.primaryColor, ROYAL_PRIMARY),
    ...(cleanCreatedBy ? { createdBy: cleanCreatedBy } : {}),
    createdAtMs: nowMs,
    expiresAtMs,
  };
}

/**
 * Creates a new SmartInviteRecord for the Captain or Team Founder.
 * Enforces Captain/Founder authorization when authContext is supplied.
 */
export function createSmartInvitationRecord(
  input: SmartInviteOptionsInput = {},
  authContext?: { isFirebaseMode: boolean; isCaptainSession: boolean; allowLocalDemoCaptain?: boolean }
): SmartInviteRecord {
  if (authContext) {
    const allowed = authContext.allowLocalDemoCaptain
      ? true
      : isCaptainAuthorized({
          isFirebaseMode: authContext.isFirebaseMode,
          isCaptainSession: authContext.isCaptainSession,
        });
    if (!allowed) {
      throw new Error('إنشاء الدعوات متاح للكابتن المعتمد فقط');
    }
  }

  const opts = sanitizeInvitationOptions(input);
  const code = sanitizeInviteCode(input.customCode) || generateSecureInviteCode(12);

  return {
    code,
    teamId: opts.teamId,
    teamName: opts.teamName,
    appName: opts.appName,
    primaryColor: opts.primaryColor,
    usageType: opts.usageType,
    maxUses: opts.maxUses,
    usedCount: 0,
    durationDays: opts.durationDays,
    createdAtMs: opts.createdAtMs,
    expiresAtMs: opts.expiresAtMs,
    status: 'active',
    active: true,
    joinMode: opts.joinMode,
    requireApproval: opts.requireApproval,
    ...(opts.isMemberShareCode ? { isMemberShareCode: true } : {}),
    ...(opts.createdBy ? { createdBy: opts.createdBy } : {}),
  };
}

/**
 * Normalizes any raw invite doc (including legacy 4-field docs) into a rich SmartInviteRecord.
 */
export function normalizeInviteRecord(
  raw: Record<string, unknown> | null | undefined,
  fallbackTeam?: { teamName?: string; appName?: string; primaryColor?: string }
): SmartInviteRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const code = sanitizeInviteCode(raw.code);
  if (!code) return null;

  const maxUses = Math.round(clampNum(raw.maxUses, 1, MAX_ALLOWED_INVITE_USES, 1));
  const usedCount = Math.round(clampNum(raw.usedCount, 0, MAX_ALLOWED_INVITE_USES + 1, 0));
  const usageType: InviteUsageType =
    raw.usageType === 'multi' || maxUses > 1 ? 'multi' : 'single';
  const durationDays = Math.round(
    clampNum(raw.durationDays, 1, MAX_ALLOWED_DURATION_DAYS, DEFAULT_INVITE_DURATION_DAYS)
  );
  const createdAtMs =
    typeof raw.createdAtMs === 'number' && Number.isFinite(raw.createdAtMs) && raw.createdAtMs > 0
      ? Math.round(raw.createdAtMs)
      : 0;
  const expiresAtMs =
    typeof raw.expiresAtMs === 'number' && Number.isFinite(raw.expiresAtMs) && raw.expiresAtMs > 0
      ? Math.round(raw.expiresAtMs)
      : createdAtMs > 0
        ? createdAtMs + durationDays * DAY_MS
        : 0;

  const rawStatus = String(raw.status || '').trim();
  const isActiveBool = raw.active !== false;
  let status: InviteStatus = 'active';
  if (rawStatus === 'revoked') {
    status = 'revoked';
  } else if (rawStatus === 'completed' || (typeof raw.maxUses === 'number' && usedCount >= maxUses)) {
    status = 'completed';
  } else if (rawStatus === 'expired') {
    status = 'expired';
  } else if (!isActiveBool) {
    status = 'revoked';
  }

  const isMemberShareCode = raw.isMemberShareCode === true;
  const rawJoinMode = String(raw.joinMode || '').trim().toLowerCase();
  const requireApproval = isMemberShareCode
    ? true
    : rawJoinMode === 'instant'
      ? false
      : rawJoinMode === 'approval'
        ? true
        : raw.requireApproval !== false;
  const joinMode: InviteJoinMode = requireApproval ? 'approval' : 'instant';
  const rawTeamId = String(raw.teamId || TEAM_ID)
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 64);
  const teamId = rawTeamId.length >= 2 ? rawTeamId : TEAM_ID;
  const cleanCreatedBy =
    typeof raw.createdBy === 'string' && raw.createdBy.trim()
      ? raw.createdBy
          .trim()
          .replace(/[^a-zA-Z0-9_-]/g, '')
          .slice(0, 128)
      : '';

  return {
    code,
    teamId,
    teamName:
      clampStr(raw.teamName || fallbackTeam?.teamName || 'فريق السداسي', 80) || 'فريق السداسي',
    appName: clampStr(raw.appName || fallbackTeam?.appName || 'ميدان 6v6', 60) || 'ميدان 6v6',
    primaryColor: sanitizeHexColor(
      raw.primaryColor || fallbackTeam?.primaryColor,
      ROYAL_PRIMARY
    ),
    usageType,
    maxUses,
    usedCount,
    durationDays,
    createdAtMs,
    expiresAtMs,
    status,
    active: isActiveBool && status === 'active',
    joinMode,
    requireApproval,
    ...(isMemberShareCode ? { isMemberShareCode: true } : {}),
    ...(cleanCreatedBy ? { createdBy: cleanCreatedBy } : {}),
    ...(typeof raw.lastUsedBy === 'string' && raw.lastUsedBy.trim()
      ? { lastUsedBy: raw.lastUsedBy.trim().slice(0, 128) }
      : {}),
  };
}

/**
 * Evaluates the live status of an invitation (`فعالة`, `منتهية`, `ملغاة`, `مكتملة`).
 */
export function computeInviteStatus(
  rawInvite: Record<string, unknown> | SmartInviteRecord | null | undefined,
  nowMs = Date.now()
): InviteStatusMeta {
  const inv = normalizeInviteRecord(rawInvite as Record<string, unknown>);
  if (!inv) {
    return {
      status: 'revoked',
      labelAr: 'ملغاة',
      reasonAr: 'كود الدعوة غير صحيح أو غير موجود — تحقق من الكود وحاول مجدداً.',
      colorHex: '#fda4af',
      bgRgba: 'rgba(244,63,94,0.14)',
      borderRgba: 'rgba(244,63,94,0.35)',
      canUse: false,
      remainingUses: 0,
      maxUses: 1,
      usedCount: 0,
      createdDateStr: '—',
      expiresDateStr: '—',
    };
  }

  const hasQuotaFields =
    rawInvite != null &&
    typeof rawInvite === 'object' &&
    ('maxUses' in rawInvite || 'usedCount' in rawInvite);

  let status: InviteStatus = inv.status;
  if (status === 'revoked') {
    status = 'revoked';
  } else if (hasQuotaFields && inv.usedCount >= inv.maxUses) {
    status = 'completed';
  } else if (inv.expiresAtMs > 0 && nowMs >= inv.expiresAtMs) {
    status = 'expired';
  } else if (!inv.active) {
    status = 'revoked';
  } else {
    status = 'active';
  }

  const remainingUses = Math.max(0, inv.maxUses - inv.usedCount);
  const createdDateStr = formatEpochDateYmd(inv.createdAtMs);
  const expiresDateStr = formatEpochDateYmd(inv.expiresAtMs);

  switch (status) {
    case 'active':
      return {
        status: 'active',
        labelAr: 'فعالة',
        reasonAr: inv.isMemberShareCode
          ? 'دعوة مشاركة الفريق فعالة — يتطلب الانضمام موافقة المؤسس.'
          : 'الدعوة فعالة وجاهزة للاستخدام.',
        colorHex: '#86efac',
        bgRgba: 'rgba(34,197,94,0.14)',
        borderRgba: 'rgba(34,197,94,0.36)',
        canUse: true,
        remainingUses,
        maxUses: inv.maxUses,
        usedCount: inv.usedCount,
        createdDateStr,
        expiresDateStr,
      };
    case 'completed':
      return {
        status: 'completed',
        labelAr: 'مكتملة',
        reasonAr: 'اكتمل الحد الأقصى لعدد مرات استخدام كود الدعوة هذا.',
        colorHex: '#93c5fd',
        bgRgba: 'rgba(59,130,246,0.14)',
        borderRgba: 'rgba(59,130,246,0.36)',
        canUse: false,
        remainingUses: 0,
        maxUses: inv.maxUses,
        usedCount: inv.usedCount,
        createdDateStr,
        expiresDateStr,
      };
    case 'expired':
      return {
        status: 'expired',
        labelAr: 'منتهية',
        reasonAr: 'انتهت صلاحية كود الدعوة هذا — اطلب دعوة جديدة من الكابتن.',
        colorHex: '#fde047',
        bgRgba: 'rgba(250,204,21,0.12)',
        borderRgba: 'rgba(250,204,21,0.32)',
        canUse: false,
        remainingUses,
        maxUses: inv.maxUses,
        usedCount: inv.usedCount,
        createdDateStr,
        expiresDateStr,
      };
    case 'revoked':
    default:
      return {
        status: 'revoked',
        labelAr: 'ملغاة',
        reasonAr: 'تم إلغاء كود الدعوة هذا من قِبل الكابتن ولم يعد صالحاً للاستخدام.',
        colorHex: '#fda4af',
        bgRgba: 'rgba(244,63,94,0.14)',
        borderRgba: 'rgba(244,63,94,0.35)',
        canUse: false,
        remainingUses,
        maxUses: inv.maxUses,
        usedCount: inv.usedCount,
        createdDateStr,
        expiresDateStr,
      };
  }
}

export interface ValidateInviteJoinInput {
  invite: Record<string, unknown> | SmartInviteRecord | null | undefined;
  applicantUid: string;
  existingPlayers?: Array<Record<string, unknown>>;
  existingJoinRequestStatus?: string | null;
  hasExistingPersonalTeam?: boolean;
  confirmedTeamSwitch?: boolean;
  nowMs?: number;
}

export interface ValidateInviteJoinResult {
  valid: boolean;
  errorReason?:
    | 'not_found'
    | 'revoked'
    | 'expired'
    | 'completed'
    | 'already_member'
    | 'already_pending'
    | 'needs_switch_consent';
  errorMessageAr?: string;
  statusMeta: InviteStatusMeta;
  normalizedInvite: SmartInviteRecord | null;
}

/**
 * Validates an invitation code and player state before allowing join or join-request.
 */
export function validateInviteForJoin(input: ValidateInviteJoinInput): ValidateInviteJoinResult {
  const nowMs =
    typeof input.nowMs === 'number' && Number.isFinite(input.nowMs) ? input.nowMs : Date.now();
  const normalized = normalizeInviteRecord(input.invite as Record<string, unknown>);
  const statusMeta = computeInviteStatus(input.invite, nowMs);

  if (!normalized) {
    return {
      valid: false,
      errorReason: 'not_found',
      errorMessageAr: 'كود الدعوة غير صحيح أو غير موجود — تحقق من الكود وحاول مجدداً.',
      statusMeta,
      normalizedInvite: null,
    };
  }

  const uid = String(input.applicantUid || '').trim();
  if (uid && Array.isArray(input.existingPlayers)) {
    const alreadyInTeam = input.existingPlayers.some(
      (p) =>
        p &&
        ((p.id && String(p.id) === uid) || (p.ownerUid && String(p.ownerUid) === uid))
    );
    if (alreadyInTeam) {
      return {
        valid: false,
        errorReason: 'already_member',
        errorMessageAr: 'أنت عضو بالفعل في هذا الفريق ولا يمكن إنشاء عضوية مكررة.',
        statusMeta,
        normalizedInvite: normalized,
      };
    }
  }

  if (input.existingJoinRequestStatus === 'pending') {
    return {
      valid: false,
      errorReason: 'already_pending',
      errorMessageAr: 'لديك طلب انضمام معلّق قيد مراجعة الكابتن بالفعل.',
      statusMeta,
      normalizedInvite: normalized,
    };
  }

  if (statusMeta.status === 'revoked') {
    return {
      valid: false,
      errorReason: 'revoked',
      errorMessageAr: 'تم إلغاء كود الدعوة هذا من قِبل الكابتن ولم يعد صالحاً للاستخدام.',
      statusMeta,
      normalizedInvite: normalized,
    };
  }

  if (statusMeta.status === 'expired') {
    return {
      valid: false,
      errorReason: 'expired',
      errorMessageAr: 'انتهت صلاحية كود الدعوة هذا — اطلب دعوة جديدة من الكابتن.',
      statusMeta,
      normalizedInvite: normalized,
    };
  }

  if (statusMeta.status === 'completed') {
    return {
      valid: false,
      errorReason: 'completed',
      errorMessageAr: 'اكتمل الحد الأقصى لعدد مرات استخدام كود الدعوة هذا.',
      statusMeta,
      normalizedInvite: normalized,
    };
  }

  if (input.hasExistingPersonalTeam && !input.confirmedTeamSwitch) {
    return {
      valid: false,
      errorReason: 'needs_switch_consent',
      errorMessageAr: 'يرجى تأكيد موافقتك على الانتقال من فريقك الحالي إلى الفريق الجديد قبل المتابعة.',
      statusMeta,
      normalizedInvite: normalized,
    };
  }

  return {
    valid: true,
    statusMeta,
    normalizedInvite: normalized,
  };
}

/**
 * Pure helper to consume 1 use of an invitation record (mirrors the atomic Firestore transaction).
 */
export function consumeInvitationRecord(
  invite: SmartInviteRecord,
  consumerUid: string,
  nowMs = Date.now()
): SmartInviteRecord {
  const check = validateInviteForJoin({
    invite,
    applicantUid: consumerUid,
    nowMs,
  });
  if (!check.valid || !check.normalizedInvite) {
    throw new Error(check.errorMessageAr || 'كود الدعوة غير صالح');
  }
  const cur = check.normalizedInvite;
  const nextUsed = cur.usedCount + 1;
  const isCompleted = nextUsed >= cur.maxUses;
  return {
    ...cur,
    usedCount: nextUsed,
    active: !isCompleted,
    status: isCompleted ? 'completed' : 'active',
    lastUsedBy: String(consumerUid || '').trim().slice(0, 128),
  };
}

/**
 * Pure helper to revoke an invitation record (Captain only).
 */
export function revokeInvitationRecord(
  invite: SmartInviteRecord,
  authContext?: { isFirebaseMode: boolean; isCaptainSession: boolean; allowLocalDemoCaptain?: boolean }
): SmartInviteRecord {
  if (authContext) {
    const allowed = authContext.allowLocalDemoCaptain
      ? true
      : isCaptainAuthorized({
          isFirebaseMode: authContext.isFirebaseMode,
          isCaptainSession: authContext.isCaptainSession,
        });
    if (!allowed) {
      throw new Error('إلغاء الدعوات متاح للكابتن المعتمد فقط');
    }
  }
  return {
    ...invite,
    active: false,
    status: 'revoked',
  };
}

/**
 * Derives a clean, deterministic personal referral code for any player (e.g. "REF-K7P4X9").
 * Grants zero administrative privileges.
 */
export function derivePersonalReferralCode(playerId: string): string {
  const clean = String(playerId || 'player').trim();
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean.charCodeAt(i);
    h1 ^= ch;
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 ^= ch + i * 31;
    h2 = Math.imul(h2, 0x85ebca6b) >>> 0;
  }
  let code = '';
  let v1 = h1;
  let v2 = h2;
  for (let i = 0; i < 3; i++) {
    code += alphabet[v1 & 31];
    v1 >>>= 5;
  }
  for (let i = 0; i < 3; i++) {
    code += alphabet[v2 & 31];
    v2 >>>= 5;
  }
  return `REF-${code}`;
}

export function sanitizeReferralCode(raw: unknown): string {
  const s = String(raw ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '')
    .slice(0, 32);
  if (/^REF-[A-Z0-9]{4,16}$/.test(s)) return s;
  return '';
}

export function buildInviteShareUrl(baseHref: string, inviteCode: string, referralCode?: string): string {
  const cleanCode = sanitizeInviteCode(inviteCode);
  const cleanRef = sanitizeReferralCode(referralCode);
  try {
    const u = new URL(baseHref.split('#')[0]);
    u.hash = '';
    if (cleanCode) u.searchParams.set('join', cleanCode);
    else u.searchParams.delete('join');
    if (cleanRef) u.searchParams.set('ref', cleanRef);
    else u.searchParams.delete('ref');
    return u.toString();
  } catch {
    const base = String(baseHref || '').split('#')[0].split('?')[0];
    const q: string[] = [];
    if (cleanCode) q.push(`join=${encodeURIComponent(cleanCode)}`);
    if (cleanRef) q.push(`ref=${encodeURIComponent(cleanRef)}`);
    const qs = q.join('&');
    return `${base}${qs ? '?' + qs : ''}`;
  }
}

export function parseInviteAndReferralFromLocation(
  searchStr: string,
  hashStr: string
): { inviteCode: string; referralCode: string } {
  let inviteCode = '';
  let referralCode = '';

  try {
    const sp = new URLSearchParams(searchStr || '');
    const qJoin = sp.get('join');
    const qRef = sp.get('ref');
    if (qJoin) inviteCode = sanitizeInviteCode(qJoin);
    if (qRef) referralCode = sanitizeReferralCode(qRef);
  } catch {
    // ignore malformed query
  }

  try {
    const rawHash = String(hashStr || '').replace(/^#/, '');
    if (rawHash) {
      const hp = new URLSearchParams(rawHash);
      const hJoin = hp.get('join');
      const hRef = hp.get('ref');
      if (!inviteCode && hJoin) inviteCode = sanitizeInviteCode(hJoin);
      if (!referralCode && hRef) referralCode = sanitizeReferralCode(hRef);
    }
  } catch {
    // ignore malformed hash
  }

  return { inviteCode, referralCode };
}

declare global {
  interface Window {
    MaydanInvitations?: {
      DEFAULT_INVITE_USAGE_TYPE: typeof DEFAULT_INVITE_USAGE_TYPE;
      DEFAULT_INVITE_MAX_USES: typeof DEFAULT_INVITE_MAX_USES;
      DEFAULT_INVITE_DURATION_DAYS: typeof DEFAULT_INVITE_DURATION_DAYS;
      sanitizeInvitationOptions: typeof sanitizeInvitationOptions;
      createSmartInvitationRecord: typeof createSmartInvitationRecord;
      normalizeInviteRecord: typeof normalizeInviteRecord;
      computeInviteStatus: typeof computeInviteStatus;
      validateInviteForJoin: typeof validateInviteForJoin;
      consumeInvitationRecord: typeof consumeInvitationRecord;
      revokeInvitationRecord: typeof revokeInvitationRecord;
      derivePersonalReferralCode: typeof derivePersonalReferralCode;
      sanitizeReferralCode: typeof sanitizeReferralCode;
      buildInviteShareUrl: typeof buildInviteShareUrl;
      parseInviteAndReferralFromLocation: typeof parseInviteAndReferralFromLocation;
      formatEpochDateYmd: typeof formatEpochDateYmd;
    };
  }
}

if (typeof window !== 'undefined') {
  window.MaydanInvitations = {
    DEFAULT_INVITE_USAGE_TYPE,
    DEFAULT_INVITE_MAX_USES,
    DEFAULT_INVITE_DURATION_DAYS,
    sanitizeInvitationOptions,
    createSmartInvitationRecord,
    normalizeInviteRecord,
    computeInviteStatus,
    validateInviteForJoin,
    consumeInvitationRecord,
    revokeInvitationRecord,
    derivePersonalReferralCode,
    sanitizeReferralCode,
    buildInviteShareUrl,
    parseInviteAndReferralFromLocation,
    formatEpochDateYmd,
  };
}

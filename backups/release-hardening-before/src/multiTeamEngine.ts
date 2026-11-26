import {
  clampNum,
  clampStr,
  ROYAL_PRIMARY,
  ROYAL_SECONDARY,
  sanitizeDateStr,
  sanitizeFoot,
  sanitizeHexColor,
  sanitizeImageDataUrl,
  sanitizePrimaryPos,
  sanitizeRoleOverride,
  sanitizeSecondaryPos,
  sanitizeSkills,
  sanitizeStarId,
  sanitizeStats6,
} from './security';
import { normalizeAttendanceStatus, type AttendanceStatusAr } from './teamMultiplayer';

export const MAX_OWNED_TEAMS = 3;
export const MAX_JOINED_TEAMS = 5;
export const DEFAULT_MAX_MEMBERS_PER_TEAM = 30;
export const MAX_TEAM_LOGO_CHARS = 68_500; // ~50 KB base64 image payload
export const MIGRATION_BATCH_WRITE_LIMIT = 400;
export const MIGRATION_CHECKPOINT_STORAGE_KEY = 'maydan_m6_migration_ckpt_v1';
export const PRIVACY_NOTICE_VERSION = '2026-11-phase6';
export const PRIVACY_NOTICE_ACCEPTED_STORAGE_PREFIX = 'maydan_privacy_ok_';

export type TeamJoinMode = 'approval' | 'instant';
export type TeamLineupPublishMode = 'organizers' | 'all';
export type PublicAvailableStatus = 'متاح' | 'غير متاح';

export const FORBIDDEN_PUBLIC_MEMBER_FIELDS = [
  'sleep',
  'fatigue',
  'mood',
  'injury',
  'injuries',
  'severity',
  'expectedReturn',
  'readiness',
  'medicalNotes',
  'medication',
  'diagnosis',
  'rpe',
  'pin',
  'pinHash',
] as const;

export const PUBLIC_MEMBER_ALLOWED_KEYS = [
  'id',
  'uid',
  'ownerUid',
  'teamId',
  'name',
  'role',
  'isOrganizer',
  'jersey',
  'age',
  'height',
  'weight',
  'foot',
  'primaryPos',
  'secondaryPos',
  'photo',
  'hasPhoto',
  'photoZoom',
  'photoY',
  'skills',
  'stats6',
  'roleOverride',
  'top3Strengths',
  'weak3Points',
  'seasonGoal',
  'availableStatus',
  'roleModelStarId',
  'joinedAtMs',
  'updatedAtMs',
] as const;

export interface PublicTeamMemberDoc {
  id: string;
  uid: string;
  ownerUid: string;
  teamId: string;
  name: string;
  role: 'founder' | 'organizer' | 'member';
  isOrganizer: boolean;
  jersey: number;
  age: number;
  height: number;
  weight: number;
  foot: string;
  primaryPos: string;
  secondaryPos: string;
  photo: string;
  hasPhoto: boolean;
  photoZoom: number;
  photoY: number;
  skills: Record<string, number>;
  stats6?: Record<string, number>;
  roleOverride: string;
  top3Strengths: string;
  weak3Points: string;
  seasonGoal: string;
  availableStatus: PublicAvailableStatus;
  roleModelStarId: string;
  joinedAtMs: number;
  updatedAtMs: number;
}

export interface PrivateMemberRecord {
  id: string;
  kind: 'readiness' | 'injury' | 'personalGoal';
  uid: string;
  teamId: string;
  data: Record<string, unknown>;
}

export interface MultiTeamMeta {
  id: string;
  teamName: string;
  appName: string;
  founderUid: string;
  organizerUids: string[];
  primaryColor: string;
  secondaryColor: string;
  logo: string;
  joinMode: TeamJoinMode;
  lineupPublishMode: TeamLineupPublishMode;
  defaultCurrency: string;
  defaultPitchCost: number;
  maxMembersPerTeam: number;
  memberCount: number;
  inviteCode: string;
  memberShareCode: string;
  lockSkills: boolean;
  deletedAt: unknown;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface AttendanceResponseEntry {
  uid: string;
  playerName: string;
  status: AttendanceStatusAr;
  updatedAtMs: number;
}

export interface ConsolidatedAttendanceDoc {
  matchKey: string;
  date: string;
  type: string;
  responses: Record<string, AttendanceResponseEntry>;
  updatedAtMs: number;
}

export interface MigrationCheckpoint {
  sourceTeamId: string;
  targetTeamId: string;
  backupConfirmedAtMs: number;
  copiedSections: string[];
  completedAtMs?: number;
  verifiedOk?: boolean;
}

export interface MigrationCountRow {
  section: string;
  labelAr: string;
  sourceCount: number;
  destCount: number;
  matched: boolean;
}

export function sanitizeTeamId(raw: unknown): string {
  const s = String(raw ?? '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 64);
  if (s.length < 2) return '';
  return s;
}

export function generateMultiTeamId(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = new Uint8Array(12);
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi || typeof cryptoApi.getRandomValues !== 'function') {
    throw new Error('Web Crypto API غير متوفر لتوليد معرّف الفريق');
  }
  cryptoApi.getRandomValues(bytes);
  let suffix = '';
  for (let i = 0; i < bytes.length; i++) {
    suffix += alphabet[bytes[i] % alphabet.length];
  }
  return `team_${suffix}`;
}

export function sanitizeJoinMode(raw: unknown): TeamJoinMode {
  return String(raw ?? '').trim().toLowerCase() === 'instant' ? 'instant' : 'approval';
}

export function sanitizeLineupPublishMode(raw: unknown): TeamLineupPublishMode {
  return String(raw ?? '').trim().toLowerCase() === 'organizers' ? 'organizers' : 'all';
}

export function normalizePublicAvailableStatus(raw: unknown): PublicAvailableStatus {
  const s = String(raw ?? '').trim();
  if (s === 'غير متاح' || s === 'unavailable') return 'غير متاح';
  return 'متاح';
}

export function sanitizeTeamLogo50Kb(raw: unknown): {
  ok: boolean;
  dataUrl: string;
  errorAr?: string;
} {
  if (raw === '' || raw === null || raw === undefined) {
    return { ok: true, dataUrl: '' };
  }
  if (typeof raw !== 'string') {
    return { ok: false, dataUrl: '', errorAr: 'تنسيق شعار الفريق غير صالح' };
  }
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true, dataUrl: '' };
  if (trimmed.length > MAX_TEAM_LOGO_CHARS) {
    return {
      ok: false,
      dataUrl: '',
      errorAr: 'حجم شعار الفريق يتجاوز الحد الأقصى المسموح (50 كيلوبايت)',
    };
  }
  const clean = sanitizeImageDataUrl(trimmed, MAX_TEAM_LOGO_CHARS);
  if (!clean) {
    return {
      ok: false,
      dataUrl: '',
      errorAr: 'صيغة شعار الفريق غير مدعومة (يُسمح بـ PNG/JPEG/WEBP فقط)',
    };
  }
  return { ok: true, dataUrl: clean };
}

export function checkTeamQuotaEligibility(input: {
  action: 'create' | 'join';
  ownedTeamIds?: string[];
  joinedTeamIds?: string[];
  targetTeamId?: string;
  allowNewTeams?: boolean;
  maxMembersPerTeam?: number;
  currentMemberCount?: number;
}): { allowed: boolean; reasonCode?: string; errorAr?: string } {
  const owned = Array.isArray(input.ownedTeamIds) ? input.ownedTeamIds.filter(Boolean) : [];
  const joined = Array.isArray(input.joinedTeamIds) ? input.joinedTeamIds.filter(Boolean) : [];

  if (input.action === 'create') {
    if (input.allowNewTeams === false) {
      return {
        allowed: false,
        reasonCode: 'new_teams_paused',
        errorAr: 'إنشاء الفرق الجديدة متوقف مؤقتاً لحماية الحصة المجانية — يمكنك الانضمام لفريق قائم بكود دعوة.',
      };
    }
    if (owned.length >= MAX_OWNED_TEAMS) {
      return {
        allowed: false,
        reasonCode: 'max_owned_teams',
        errorAr: `بلغت الحد الأقصى لإنشاء الفرق (${MAX_OWNED_TEAMS} فرق كحد أقصى في الخطة المجانية).`,
      };
    }
    if (joined.length >= MAX_JOINED_TEAMS) {
      return {
        allowed: false,
        reasonCode: 'max_joined_teams',
        errorAr: `بلغت الحد الأقصى للعضوية في الفرق (${MAX_JOINED_TEAMS} فرق). غادر فريقاً أولاً قبل إنشاء فريق جديد.`,
      };
    }
    return { allowed: true };
  }

  const targetId = sanitizeTeamId(input.targetTeamId);
  if (targetId && joined.includes(targetId)) {
    return {
      allowed: false,
      reasonCode: 'already_member',
      errorAr: 'أنت عضو بالفعل في هذا الفريق.',
    };
  }
  if (joined.length >= MAX_JOINED_TEAMS) {
    return {
      allowed: false,
      reasonCode: 'max_joined_teams',
      errorAr: `بلغت الحد الأقصى للانضمام للفرق (${MAX_JOINED_TEAMS} فرق كحد أقصى).`,
    };
  }
  const maxMembers = Math.max(
    6,
    Math.min(100, Math.round(Number(input.maxMembersPerTeam ?? DEFAULT_MAX_MEMBERS_PER_TEAM)))
  );
  const currentMembers = Math.max(0, Math.round(Number(input.currentMemberCount ?? 0)));
  if (currentMembers >= maxMembers) {
    return {
      allowed: false,
      reasonCode: 'team_full',
      errorAr: `اكتمل عدد أعضاء الفريق حالياً (الحد الأقصى ${maxMembers} لاعباً).`,
    };
  }
  return { allowed: true };
}

export function findForbiddenPublicHealthFields(doc: Record<string, unknown> | null | undefined): string[] {
  if (!doc || typeof doc !== 'object') return [];
  const leaked: string[] = [];
  const forbiddenSet = new Set<string>(FORBIDDEN_PUBLIC_MEMBER_FIELDS);
  for (const key of Object.keys(doc)) {
    if (forbiddenSet.has(key)) leaked.push(key);
  }
  return leaked;
}

export function splitPlayerPublicAndPrivate(input: {
  teamId: string;
  rawPlayer: Record<string, unknown>;
  founderUid: string;
  organizerUids?: string[];
  readinessRecords?: Array<Record<string, unknown>>;
  injuryRecords?: Array<Record<string, unknown>>;
  nowMs?: number;
}): {
  publicMember: PublicTeamMemberDoc;
  privateRecords: PrivateMemberRecord[];
} {
  const nowMs = Number(input.nowMs || Date.now());
  const raw = input.rawPlayer || {};
  const cleanTeamId = sanitizeTeamId(input.teamId) || 'main';
  const uid = String(raw.ownerUid || raw.uid || raw.id || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 128) || 'member_legacy';
  const isFounder = uid === input.founderUid || raw.role === 'admin' || raw.role === 'founder';
  const orgSet = new Set(Array.isArray(input.organizerUids) ? input.organizerUids : []);
  const isOrg = !isFounder && (orgSet.has(uid) || raw.role === 'organizer' || raw.isOrganizer === true);
  const role: PublicTeamMemberDoc['role'] = isFounder ? 'founder' : isOrg ? 'organizer' : 'member';
  const photo = sanitizeImageDataUrl(raw.photo, 250_000);
  const s6 = sanitizeStats6(raw.stats6);
  const seasonGoal = clampStr(raw.seasonGoal, 200);

  const publicMember: PublicTeamMemberDoc = {
    id: uid,
    uid,
    ownerUid: uid,
    teamId: cleanTeamId,
    name: clampStr(raw.name || 'لاعب ميدان', 80) || 'لاعب ميدان',
    role,
    isOrganizer: isFounder || isOrg,
    jersey: Math.round(clampNum(raw.jersey, 0, 99, 10)),
    age: Math.round(clampNum(raw.age, 10, 70, 20)),
    height: Math.round(clampNum(raw.height, 100, 230, 175)),
    weight: Math.round(clampNum(raw.weight, 30, 160, 70)),
    foot: sanitizeFoot(raw.foot),
    primaryPos: sanitizePrimaryPos(raw.primaryPos),
    secondaryPos: sanitizeSecondaryPos(raw.secondaryPos),
    photo,
    hasPhoto: Boolean(photo),
    photoZoom: Math.round(clampNum(raw.photoZoom, 90, 160, 105)),
    photoY: Math.round(clampNum(raw.photoY, 0, 60, 18)),
    skills: sanitizeSkills(raw.skills as Record<string, unknown> | undefined, 10),
    ...(s6 ? { stats6: s6 } : {}),
    roleOverride: sanitizeRoleOverride(raw.roleOverride),
    top3Strengths: clampStr(raw.top3Strengths, 200),
    weak3Points: clampStr(raw.weak3Points, 200),
    seasonGoal,
    availableStatus: normalizePublicAvailableStatus(raw.availableStatus),
    roleModelStarId: sanitizeStarId(raw.roleModelStarId),
    joinedAtMs: Math.round(clampNum(raw.joinedAtMs, 0, 9_999_999_999_999, nowMs)),
    updatedAtMs: nowMs,
  };

  const privateRecords: PrivateMemberRecord[] = [];
  const pId = String(raw.id || '');
  const matchesMember = (r: Record<string, unknown>) =>
    Boolean(r && (String(r.ownerUid || '') === uid || (pId && String(r.playerId || '') === pId)));

  (input.readinessRecords || []).filter(matchesMember).forEach((r, idx) => {
    const cleanId =
      String(r.id || `rd_${idx + 1}`).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80) || `rd_${idx + 1}`;
    privateRecords.push({
      id: `rd_${cleanId}`,
      kind: 'readiness',
      uid,
      teamId: cleanTeamId,
      data: {
        kind: 'readiness',
        uid,
        teamId: cleanTeamId,
        date: sanitizeDateStr(r.date),
        sleep: Math.round(clampNum(r.sleep, 1, 10, 8)),
        fatigue: Math.round(clampNum(r.fatigue, 1, 10, 8)),
        mood: Math.round(clampNum(r.mood, 1, 10, 8)),
        updatedAtMs: nowMs,
      },
    });
  });

  (input.injuryRecords || []).filter(matchesMember).forEach((inj, idx) => {
    const cleanId =
      String(inj.id || `inj_${idx + 1}`).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80) || `inj_${idx + 1}`;
    privateRecords.push({
      id: `inj_${cleanId}`,
      kind: 'injury',
      uid,
      teamId: cleanTeamId,
      data: {
        kind: 'injury',
        uid,
        teamId: cleanTeamId,
        type: clampStr(inj.type || 'إصابة رياضية', 80) || 'إصابة رياضية',
        location: clampStr(inj.location || 'القدم', 100) || 'القدم',
        severity: inj.severity === 'متوسطة' || inj.severity === 'شديدة' ? inj.severity : 'خفيفة',
        date: sanitizeDateStr(inj.date),
        expectedReturn: sanitizeDateStr(inj.expectedReturn),
        updatedAtMs: nowMs,
      },
    });
  });

  return { publicMember, privateRecords };
}

export function buildAttendanceMatchKey(dateStr: unknown, typeStr: unknown): string {
  const date = sanitizeDateStr(dateStr);
  const rawType = String(typeStr ?? 'match').trim();
  const typeSlug = rawType === 'تمرين' || rawType === 'training' ? 'training' : 'match';
  return `${date}_${typeSlug}`;
}

export function groupLegacyAttendanceByMatchKey(
  records: Array<Record<string, unknown>>,
  nowMs = Date.now()
): ConsolidatedAttendanceDoc[] {
  const grouped = new Map<string, ConsolidatedAttendanceDoc>();
  for (const r of records || []) {
    if (!r || typeof r !== 'object') continue;
    const date = sanitizeDateStr(r.date);
    const type = clampStr(r.type || 'مباراة', 40) || 'مباراة';
    const matchKey = buildAttendanceMatchKey(date, type);
    const uid = String(r.ownerUid || r.uid || r.playerId || '')
      .trim()
      .replace(/[^a-zA-Z0-9_-]/g, '')
      .slice(0, 128);
    if (!uid) continue;

    if (!grouped.has(matchKey)) {
      grouped.set(matchKey, {
        matchKey,
        date,
        type,
        responses: {},
        updatedAtMs: nowMs,
      });
    }
    const bucket = grouped.get(matchKey)!;
    bucket.responses[uid] = {
      uid,
      playerName: clampStr(r.playerName || 'لاعب', 80) || 'لاعب',
      status: normalizeAttendanceStatus(r.status),
      updatedAtMs: nowMs,
    };
  }
  return Array.from(grouped.values());
}

export function flattenConsolidatedAttendanceDocs(
  docs: Array<Partial<ConsolidatedAttendanceDoc> & { id?: string }>
): Array<{
  id: string;
  playerId: string;
  ownerUid: string;
  playerName: string;
  date: string;
  type: string;
  status: AttendanceStatusAr;
  matchKey: string;
  updatedAtMs: number;
}> {
  const out: Array<{
    id: string;
    playerId: string;
    ownerUid: string;
    playerName: string;
    date: string;
    type: string;
    status: AttendanceStatusAr;
    matchKey: string;
    updatedAtMs: number;
  }> = [];
  for (const d of docs || []) {
    if (!d || typeof d !== 'object') continue;
    const date = sanitizeDateStr(d.date);
    const type = clampStr(d.type || 'مباراة', 40) || 'مباراة';
    const matchKey = String(d.matchKey || d.id || buildAttendanceMatchKey(date, type));
    const responses = d.responses && typeof d.responses === 'object' ? d.responses : {};
    for (const [uid, entry] of Object.entries(responses)) {
      if (!entry || typeof entry !== 'object') continue;
      out.push({
        id: `att_${uid}_${matchKey}`,
        playerId: uid,
        ownerUid: uid,
        playerName: clampStr(entry.playerName || 'لاعب', 80) || 'لاعب',
        date,
        type,
        status: normalizeAttendanceStatus(entry.status),
        matchKey,
        updatedAtMs: Number(entry.updatedAtMs || d.updatedAtMs || 0),
      });
    }
  }
  return out;
}

export function chunkItemsForBatch<T>(items: T[], maxPerBatch = MIGRATION_BATCH_WRITE_LIMIT): T[][] {
  const limit = Math.max(1, Math.min(450, Math.round(maxPerBatch)));
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += limit) {
    out.push(items.slice(i, i + limit));
  }
  return out;
}

export function verifyMigrationCountReport(
  sourceCounts: Record<string, number>,
  destCounts: Record<string, number>
): {
  ok: boolean;
  rows: MigrationCountRow[];
  mismatches: string[];
} {
  const labels: Array<[string, string]> = [
    ['members', 'أعضاء الفريق (عام فقط)'],
    ['privateRecords', 'السجلات الخاصة (جاهزية/إصابات)'],
    ['matches', 'سجل المباريات'],
    ['reports', 'تقارير اللاعبين'],
    ['attendanceDocs', 'أيام الحضور المجمّعة'],
    ['tactics', 'التشكيلة التكتيكية'],
    ['suggestions', 'الاقتراحات'],
  ];
  const rows: MigrationCountRow[] = [];
  const mismatches: string[] = [];
  for (const [key, labelAr] of labels) {
    const src = Math.max(0, Math.round(Number(sourceCounts[key] || 0)));
    const dst = Math.max(0, Math.round(Number(destCounts[key] || 0)));
    const matched = dst >= src;
    rows.push({ section: key, labelAr, sourceCount: src, destCount: dst, matched });
    if (!matched) mismatches.push(key);
  }
  return {
    ok: mismatches.length === 0,
    rows,
    mismatches,
  };
}

export function saveMigrationCheckpoint(ckpt: MigrationCheckpoint | null): void {
  try {
    if (typeof localStorage === 'undefined') return;
    if (!ckpt) {
      localStorage.removeItem(MIGRATION_CHECKPOINT_STORAGE_KEY);
    } else {
      localStorage.setItem(MIGRATION_CHECKPOINT_STORAGE_KEY, JSON.stringify(ckpt));
    }
  } catch {
    // ignore
  }
}

export function loadMigrationCheckpoint(): MigrationCheckpoint | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(MIGRATION_CHECKPOINT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<MigrationCheckpoint>;
    if (!parsed || !parsed.targetTeamId || !Array.isArray(parsed.copiedSections)) return null;
    return {
      sourceTeamId: String(parsed.sourceTeamId || 'main'),
      targetTeamId: String(parsed.targetTeamId),
      backupConfirmedAtMs: Number(parsed.backupConfirmedAtMs || 0),
      copiedSections: parsed.copiedSections.map(String),
      ...(parsed.completedAtMs ? { completedAtMs: Number(parsed.completedAtMs) } : {}),
      ...(typeof parsed.verifiedOk === 'boolean' ? { verifiedOk: parsed.verifiedOk } : {}),
    };
  } catch {
    return null;
  }
}

export function buildPrivacyNoticeAcceptedPayload(uid: string, nowMs = Date.now()): {
  privacyAcceptedAt: number;
  privacyNoticeVersion: string;
  uid: string;
} {
  return {
    uid: String(uid || '').trim(),
    privacyAcceptedAt: Math.round(nowMs),
    privacyNoticeVersion: PRIVACY_NOTICE_VERSION,
  };
}

export function hasAcceptedCurrentPrivacyNotice(
  userDoc: Record<string, unknown> | null | undefined,
  uid = ''
): boolean {
  if (userDoc && Number(userDoc.privacyAcceptedAt || 0) > 0) {
    return true;
  }
  try {
    if (uid && typeof localStorage !== 'undefined') {
      const v = localStorage.getItem(`${PRIVACY_NOTICE_ACCEPTED_STORAGE_PREFIX}${uid}`);
      if (v) return true;
    }
  } catch {
    // ignore
  }
  return false;
}

export function markPrivacyNoticeAcceptedLocally(uid: string): void {
  if (!uid) return;
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(`${PRIVACY_NOTICE_ACCEPTED_STORAGE_PREFIX}${uid}`, PRIVACY_NOTICE_VERSION);
    }
  } catch {
    // ignore
  }
}

export function buildDefaultTeamCreatePayload(input: {
  teamId?: string;
  teamName: string;
  founderUid: string;
  defaultCurrency?: string;
  defaultPitchCost?: number;
  primaryColor?: string;
  secondaryColor?: string;
  logo?: string;
  joinMode?: TeamJoinMode;
  lineupPublishMode?: TeamLineupPublishMode;
  inviteCode?: string;
  memberShareCode?: string;
  nowMs?: number;
}): MultiTeamMeta {
  const nowMs = Number(input.nowMs || Date.now());
  const cleanLogo = sanitizeTeamLogo50Kb(input.logo || '');
  if (!cleanLogo.ok) {
    throw new Error(cleanLogo.errorAr || 'شعار الفريق غير صالح');
  }
  return {
    id: sanitizeTeamId(input.teamId) || generateMultiTeamId(),
    teamName: clampStr(input.teamName || 'فريق السداسي', 40) || 'فريق السداسي',
    appName: 'ميدان 6v6',
    founderUid: String(input.founderUid || '').trim(),
    organizerUids: [],
    primaryColor: sanitizeHexColor(input.primaryColor, ROYAL_PRIMARY),
    secondaryColor: sanitizeHexColor(input.secondaryColor, ROYAL_SECONDARY),
    logo: cleanLogo.dataUrl,
    joinMode: sanitizeJoinMode(input.joinMode),
    lineupPublishMode: sanitizeLineupPublishMode(input.lineupPublishMode),
    defaultCurrency: clampStr(input.defaultCurrency || 'ريال', 16) || 'ريال',
    defaultPitchCost: Math.max(0, Math.min(100_000, Number(input.defaultPitchCost || 0))),
    maxMembersPerTeam: DEFAULT_MAX_MEMBERS_PER_TEAM,
    memberCount: 1,
    inviteCode: String(input.inviteCode || '').trim().toUpperCase(),
    memberShareCode: String(input.memberShareCode || '').trim().toUpperCase(),
    lockSkills: false,
    deletedAt: null,
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
  };
}

export function sortActiveTeamsList<T extends { id: string; teamName?: string; deletedAt?: unknown }>(
  teams: T[],
  activeTeamId = ''
): T[] {
  const alive = (teams || []).filter((t) => t && !t.deletedAt);
  return alive.sort((a, b) => {
    if (a.id === activeTeamId && b.id !== activeTeamId) return -1;
    if (b.id === activeTeamId && a.id !== activeTeamId) return 1;
    return String(a.teamName || '').localeCompare(String(b.teamName || ''), 'ar');
  });
}

declare global {
  interface Window {
    MaydanMultiTeam?: {
      MAX_OWNED_TEAMS: number;
      MAX_JOINED_TEAMS: number;
      DEFAULT_MAX_MEMBERS_PER_TEAM: number;
      MAX_TEAM_LOGO_CHARS: number;
      MIGRATION_BATCH_WRITE_LIMIT: number;
      FORBIDDEN_PUBLIC_MEMBER_FIELDS: readonly string[];
      PRIVACY_NOTICE_VERSION: string;
      sanitizeTeamId: typeof sanitizeTeamId;
      generateMultiTeamId: typeof generateMultiTeamId;
      sanitizeJoinMode: typeof sanitizeJoinMode;
      sanitizeLineupPublishMode: typeof sanitizeLineupPublishMode;
      normalizePublicAvailableStatus: typeof normalizePublicAvailableStatus;
      sanitizeTeamLogo50Kb: typeof sanitizeTeamLogo50Kb;
      checkTeamQuotaEligibility: typeof checkTeamQuotaEligibility;
      findForbiddenPublicHealthFields: typeof findForbiddenPublicHealthFields;
      splitPlayerPublicAndPrivate: typeof splitPlayerPublicAndPrivate;
      buildAttendanceMatchKey: typeof buildAttendanceMatchKey;
      groupLegacyAttendanceByMatchKey: typeof groupLegacyAttendanceByMatchKey;
      flattenConsolidatedAttendanceDocs: typeof flattenConsolidatedAttendanceDocs;
      chunkItemsForBatch: typeof chunkItemsForBatch;
      verifyMigrationCountReport: typeof verifyMigrationCountReport;
      saveMigrationCheckpoint: typeof saveMigrationCheckpoint;
      loadMigrationCheckpoint: typeof loadMigrationCheckpoint;
      buildPrivacyNoticeAcceptedPayload: typeof buildPrivacyNoticeAcceptedPayload;
      hasAcceptedCurrentPrivacyNotice: typeof hasAcceptedCurrentPrivacyNotice;
      markPrivacyNoticeAcceptedLocally: typeof markPrivacyNoticeAcceptedLocally;
      buildDefaultTeamCreatePayload: typeof buildDefaultTeamCreatePayload;
      sortActiveTeamsList: typeof sortActiveTeamsList;
    };
  }
}

if (typeof window !== 'undefined') {
  window.MaydanMultiTeam = {
    MAX_OWNED_TEAMS,
    MAX_JOINED_TEAMS,
    DEFAULT_MAX_MEMBERS_PER_TEAM,
    MAX_TEAM_LOGO_CHARS,
    MIGRATION_BATCH_WRITE_LIMIT,
    FORBIDDEN_PUBLIC_MEMBER_FIELDS,
    PRIVACY_NOTICE_VERSION,
    sanitizeTeamId,
    generateMultiTeamId,
    sanitizeJoinMode,
    sanitizeLineupPublishMode,
    normalizePublicAvailableStatus,
    sanitizeTeamLogo50Kb,
    checkTeamQuotaEligibility,
    findForbiddenPublicHealthFields,
    splitPlayerPublicAndPrivate,
    buildAttendanceMatchKey,
    groupLegacyAttendanceByMatchKey,
    flattenConsolidatedAttendanceDocs,
    chunkItemsForBatch,
    verifyMigrationCountReport,
    saveMigrationCheckpoint,
    loadMigrationCheckpoint,
    buildPrivacyNoticeAcceptedPayload,
    hasAcceptedCurrentPrivacyNotice,
    markPrivacyNoticeAcceptedLocally,
    buildDefaultTeamCreatePayload,
    sortActiveTeamsList,
  };
}

export const TEAM_ID = 'main';
export const ROYAL_PRIMARY = '#FACC15';
export const ROYAL_SECONDARY = '#EAB308';
export const MAX_PENDING_JOIN_REQUESTS = 25;

export const SKILL_KEYS = [
  'speed',
  'shooting',
  'passing',
  'dribbling',
  'defending',
  'stamina',
  'vision',
  'teamwork',
  'control',
  'positioning',
] as const;

export type SkillKey = (typeof SKILL_KEYS)[number];
export type SkillsMap = Record<SkillKey, number>;

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function clampStr(value: unknown, maxLength: number): string {
  const s = String(value ?? '').trim();
  return s.length > maxLength ? s.slice(0, maxLength) : s;
}

export function clampNum(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

export function sanitizeImageDataUrl(url: unknown, maxLen = 250000): string {
  if (typeof url !== 'string' || !url) return '';
  const trimmed = url.trim();
  if (trimmed.length > maxLen) return '';
  if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(trimmed)) {
    return '';
  }
  return trimmed;
}

export function sanitizeHexColor(color: unknown, fallback: string): string {
  if (typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color.trim())) {
    return color.trim();
  }
  return fallback;
}

const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 chars -> exact bitmask (0..31), zero modulo bias
export const MIN_INVITE_CODE_LEN = 8;
export const MAX_INVITE_CODE_LEN = 20;

export function generateSecureInviteCode(rawLength = 12): string {
  const len = Math.max(10, Math.min(16, Math.round(rawLength)));
  const bytes = new Uint8Array(len);
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi || typeof cryptoApi.getRandomValues !== 'function') {
    throw new Error('Web Crypto API (crypto.getRandomValues) غير متوفر لتوليد كود دعوة آمن');
  }
  cryptoApi.getRandomValues(bytes);
  let raw = '';
  for (let i = 0; i < len; i++) {
    raw += INVITE_ALPHABET[bytes[i] & 31];
  }
  // Group cleanly as XXXX-XXXX-XXXX when 12 chars (14 chars total, 12 CSPRNG chars >= 10)
  if (len === 12) {
    return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
  }
  return raw;
}

export function sanitizeInviteCode(code: unknown): string {
  const clean = String(code ?? '').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
  if (clean.length >= MIN_INVITE_CODE_LEN && clean.length <= MAX_INVITE_CODE_LEN) return clean;
  return '';
}

export function sanitizeDateStr(dateStr: unknown): string {
  const s = String(dateStr ?? '').trim().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return new Date().toISOString().slice(0, 10);
}

const VALID_POS = new Set(['حارس مرمى', 'مدافع', 'لاعب وسط', 'جناح', 'مهاجم']);
const VALID_SECONDARY_POS = new Set(['لا يوجد', 'حارس مرمى', 'مدافع', 'لاعب وسط', 'جناح', 'مهاجم']);
const VALID_FOOT = new Set(['يمين', 'يسار', 'كلتاهما']);
const VALID_FORMATIONS = new Set(['2-2-1', '1-2-2', '2-1-2', '3-1-1', '1-3-1']);

export function sanitizePrimaryPos(pos: unknown): string {
  const s = String(pos ?? '').trim();
  return VALID_POS.has(s) ? s : 'لاعب وسط';
}

export function sanitizeSecondaryPos(pos: unknown): string {
  const s = String(pos ?? '').trim();
  return VALID_SECONDARY_POS.has(s) ? s : 'لا يوجد';
}

export function sanitizeFoot(foot: unknown): string {
  const s = String(foot ?? '').trim();
  return VALID_FOOT.has(s) ? s : 'يمين';
}

export function sanitizeFormation(form: unknown): string {
  const s = String(form ?? '').trim();
  return VALID_FORMATIONS.has(s) ? s : '2-2-1';
}

export function sanitizeStarId(starId: unknown): string {
  const s = String(starId ?? '').trim().toLowerCase();
  if (!s) return '';
  return /^[a-z0-9_]{1,40}$/.test(s) ? s : '';
}

export function sanitizeSkills(raw: Record<string, unknown> | undefined, maxCap = 10): SkillsMap {
  const out = {} as SkillsMap;
  for (const key of SKILL_KEYS) {
    out[key] = Math.round(clampNum(raw?.[key], 1, maxCap, 6));
  }
  return out;
}

export function computePeerAggregate(stat: { count?: number; totalScore?: number } | null | undefined): { avg: string; count: number } | null {
  if (!stat) return null;
  const count = Number(stat.count || 0);
  const total = Number(stat.totalScore || 0);
  if (count < 3 || total <= 0) return null;
  return {
    avg: (total / count).toFixed(1),
    count,
  };
}

export function stripSensitivePlayerFields<T extends Record<string, unknown>>(player: T): Omit<T, 'pin' | 'pinHash'> {
  const copy = { ...player };
  delete copy.pin;
  delete copy.pinHash;
  return copy;
}

export interface CleanBackupPayload {
  settings: {
    appName: string;
    teamName: string;
    primaryColor: string;
    secondaryColor: string;
    logo: string;
    inviteCode: string;
    requireApproval: boolean;
    lockSkills: boolean;
    themeVersion: string;
  };
  players: Array<Record<string, unknown>>;
  pendingPlayers: Array<Record<string, unknown>>;
  matches: Array<Record<string, unknown>>;
  reports: Array<Record<string, unknown>>;
  readiness: Array<Record<string, unknown>>;
  attendance: Array<Record<string, unknown>>;
  injuries: Array<Record<string, unknown>>;
  peerRatings: Array<Record<string, unknown>>;
  adminRatings: Array<Record<string, unknown>>;
  tactics: { formation: string; slots: Record<string, string> };
  suggestions: Array<{ id?: string; text: string }>;
}

export function sanitizeBackupImport(raw: unknown): CleanBackupPayload {
  if (!raw || typeof raw !== 'object') {
    throw new Error('ملف النسخة الاحتياطية غير صالح');
  }
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.players) || !obj.settings || typeof obj.settings !== 'object') {
    throw new Error('ملف النسخة الاحتياطية لا يحتوي على بيانات صالحة');
  }
  const st = obj.settings as Record<string, unknown>;
  const settings = {
    appName: clampStr(st.appName || 'ميدان 6v6', 60) || 'ميدان 6v6',
    teamName: clampStr(st.teamName || 'فريق السداسي', 80) || 'فريق السداسي',
    primaryColor: sanitizeHexColor(st.primaryColor, ROYAL_PRIMARY),
    secondaryColor: sanitizeHexColor(st.secondaryColor, ROYAL_SECONDARY),
    logo: sanitizeImageDataUrl(st.logo, 180000),
    inviteCode: sanitizeInviteCode(st.inviteCode) || generateSecureInviteCode(12),
    requireApproval: typeof st.requireApproval === 'boolean' ? st.requireApproval : true,
    lockSkills: typeof st.lockSkills === 'boolean' ? st.lockSkills : false,
    themeVersion: 'royal_v2',
  };

  const players = obj.players
    .filter((p): p is Record<string, unknown> => Boolean(p && typeof p === 'object'))
    .slice(0, 60)
    .map((p, idx) => {
      const cleanId = String(p.id || `p_${idx + 1}`).replace(/[^a-zA-Z0-9_-]/g, '') || `p_${idx + 1}`;
      const photo = sanitizeImageDataUrl(p.photo, 250000);
      return {
        id: cleanId.slice(0, 128),
        ownerUid: typeof p.ownerUid === 'string' ? p.ownerUid.slice(0, 128) : '',
        name: clampStr(p.name || 'لاعب', 80) || 'لاعب',
        role: p.role === 'admin' ? 'admin' : 'player',
        jersey: Math.round(clampNum(p.jersey, 0, 99, idx + 1)),
        age: Math.round(clampNum(p.age, 10, 70, 18)),
        height: Math.round(clampNum(p.height, 100, 230, 175)),
        weight: Math.round(clampNum(p.weight, 30, 160, 70)),
        foot: sanitizeFoot(p.foot),
        primaryPos: sanitizePrimaryPos(p.primaryPos),
        secondaryPos: sanitizeSecondaryPos(p.secondaryPos),
        photo,
        hasPhoto: Boolean(photo),
        photoZoom: Math.round(clampNum(p.photoZoom, 90, 160, 105)),
        photoY: Math.round(clampNum(p.photoY, 0, 60, 18)),
        skills: sanitizeSkills(p.skills as Record<string, unknown> | undefined, 10),
        top3Strengths: clampStr(p.top3Strengths, 200),
        weak3Points: clampStr(p.weak3Points, 200),
        seasonGoal: clampStr(p.seasonGoal, 200),
        availability: clampStr(p.availability, 120),
        availableStatus: p.availableStatus === 'unavailable' ? 'unavailable' : 'available',
        roleModelStarId: sanitizeStarId(p.roleModelStarId),
      };
    });

  const matches = (Array.isArray(obj.matches) ? obj.matches : [])
    .filter((m): m is Record<string, unknown> => Boolean(m && typeof m === 'object'))
    .slice(0, 300)
    .map((m, idx) => {
      const ourScore = Math.round(clampNum(m.ourScore, 0, 99, 0));
      const oppScore = Math.round(clampNum(m.oppScore, 0, 99, 0));
      return {
        id: String(m.id || `m_${idx + 1}`).replace(/[^a-zA-Z0-9_-]/g, '') || `m_${idx + 1}`,
        date: sanitizeDateStr(m.date),
        opponent: clampStr(m.opponent || 'خصم', 80) || 'خصم',
        ourScore,
        oppScore,
        result: ourScore > oppScore ? 'فوز' : ourScore < oppScore ? 'خسارة' : 'تعادل',
      };
    });

  const reports = (Array.isArray(obj.reports) ? obj.reports : [])
    .filter((r): r is Record<string, unknown> => Boolean(r && typeof r === 'object'))
    .slice(0, 500)
    .map((r, idx) => ({
      id: String(r.id || `rep_${idx + 1}`).replace(/[^a-zA-Z0-9_-]/g, '') || `rep_${idx + 1}`,
      playerId: String(r.playerId || 'p_1').replace(/[^a-zA-Z0-9_-]/g, '') || 'p_1',
      ownerUid: typeof r.ownerUid === 'string' ? r.ownerUid.slice(0, 128) : '',
      opponent: clampStr(r.opponent || 'مباراة', 80) || 'مباراة',
      goals: Math.round(clampNum(r.goals, 0, 30, 0)),
      assists: Math.round(clampNum(r.assists, 0, 30, 0)),
      minutes: Math.round(clampNum(r.minutes, 1, 180, 50)),
      interceptions: Math.round(clampNum(r.interceptions, 0, 60, 0)),
      turnovers: Math.round(clampNum(r.turnovers, 0, 60, 0)),
      rating: Math.round(clampNum(r.rating, 1, 10, 7)),
      rpe: Math.round(clampNum(r.rpe, 1, 10, 7)),
      bestMoment: clampStr(r.bestMoment, 200),
      worstMoment: clampStr(r.worstMoment, 200),
      motmVote: clampStr(r.motmVote, 128),
    }));

  const attendance = (Array.isArray(obj.attendance) ? obj.attendance : [])
    .filter((a): a is Record<string, unknown> => Boolean(a && typeof a === 'object'))
    .slice(0, 300)
    .map((a, idx) => ({
      id: String(a.id || `att_${idx + 1}`).replace(/[^a-zA-Z0-9_-]/g, '') || `att_${idx + 1}`,
      playerId: String(a.playerId || 'p_1').replace(/[^a-zA-Z0-9_-]/g, '') || 'p_1',
      ownerUid: typeof a.ownerUid === 'string' ? a.ownerUid.slice(0, 128) : '',
      playerName: clampStr(a.playerName || 'لاعب', 80) || 'لاعب',
      date: sanitizeDateStr(a.date),
      type: clampStr(a.type || 'مباراة', 40) || 'مباراة',
      status: a.status === 'ما فيني' ? 'ما فيني' : 'جاي',
    }));

  const readiness = (Array.isArray(obj.readiness) ? obj.readiness : [])
    .filter((r): r is Record<string, unknown> => Boolean(r && typeof r === 'object'))
    .slice(0, 300)
    .map((r, idx) => ({
      id: String(r.id || `rd_${idx + 1}`).replace(/[^a-zA-Z0-9_-]/g, '') || `rd_${idx + 1}`,
      playerId: String(r.playerId || 'p_1').replace(/[^a-zA-Z0-9_-]/g, '') || 'p_1',
      ownerUid: String(r.ownerUid || r.playerId || 'p_1').replace(/[^a-zA-Z0-9_-]/g, '') || 'p_1',
      date: sanitizeDateStr(r.date),
      sleep: Math.round(clampNum(r.sleep, 1, 10, 8)),
      fatigue: Math.round(clampNum(r.fatigue, 1, 10, 8)),
      mood: Math.round(clampNum(r.mood, 1, 10, 8)),
    }));

  const injuries = (Array.isArray(obj.injuries) ? obj.injuries : [])
    .filter((i): i is Record<string, unknown> => Boolean(i && typeof i === 'object'))
    .slice(0, 200)
    .map((i, idx) => ({
      id: String(i.id || `inj_${idx + 1}`).replace(/[^a-zA-Z0-9_-]/g, '') || `inj_${idx + 1}`,
      playerId: String(i.playerId || 'p_1').replace(/[^a-zA-Z0-9_-]/g, '') || 'p_1',
      ownerUid: String(i.ownerUid || i.playerId || 'p_1').replace(/[^a-zA-Z0-9_-]/g, '') || 'p_1',
      type: clampStr(i.type || 'التواء الكاحل', 80) || 'التواء الكاحل',
      location: clampStr(i.location || 'القدم', 100) || 'القدم',
      severity: i.severity === 'متوسطة' || i.severity === 'شديدة' ? i.severity : 'خفيفة',
      date: sanitizeDateStr(i.date),
      expectedReturn: sanitizeDateStr(i.expectedReturn),
    }));

  const suggestions = (Array.isArray(obj.suggestions) ? obj.suggestions : [])
    .filter((s): s is Record<string, unknown> => Boolean(s && typeof s === 'object' && s.text))
    .slice(0, 200)
    .map((s, idx) => ({
      id: String(s.id || `sugg_${idx + 1}`).replace(/[^a-zA-Z0-9_-]/g, '') || `sugg_${idx + 1}`,
      text: clampStr(s.text, 500),
    }))
    .filter((s) => s.text.length > 0);

  const adminRatings = (Array.isArray(obj.adminRatings) ? obj.adminRatings : [])
    .filter((r): r is Record<string, unknown> => Boolean(r && typeof r === 'object' && r.targetId))
    .slice(0, 100)
    .map((r) => ({
      targetId: String(r.targetId).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 128),
      score: Math.round(clampNum(r.score, 1, 10, 7)),
    }))
    .filter((r) => r.targetId.length > 0);

  const rawTac = (obj.tactics && typeof obj.tactics === 'object' ? obj.tactics : {}) as Record<string, unknown>;
  const rawSlots = (rawTac.slots && typeof rawTac.slots === 'object' ? rawTac.slots : {}) as Record<string, unknown>;
  const slots: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawSlots).slice(0, 20)) {
    if (typeof v === 'string' && v.trim()) {
      slots[k.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40)] = v.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 128);
    }
  }

  return {
    settings,
    players,
    pendingPlayers: [],
    matches,
    reports,
    readiness,
    attendance,
    injuries,
    peerRatings: [],
    adminRatings,
    tactics: {
      formation: sanitizeFormation(rawTac.formation),
      slots,
    },
    suggestions,
  };
}

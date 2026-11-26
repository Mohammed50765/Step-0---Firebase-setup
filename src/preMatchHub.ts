import { escapeHtml } from './security';

export type FatigueLevel = 'green' | 'yellow' | 'red';

export interface FatigueInput {
  sleep: number; // 1..10 (higher = better sleep)
  muscleRest: number; // 1..10 (higher = fresher legs)
  recentRpe?: number; // 1..10 (higher = harder effort)
  matchesLast7Days?: number; // 0..10
}

export interface FatigueResult {
  level: FatigueLevel;
  emoji: '🟢' | '🟡' | '🔴';
  label: string;
  score: number; // 0..100 readiness-fatigue balance (higher = fresher)
  advice: string;
  factors: string[];
}

export function computeFatigueSignal(input: FatigueInput): FatigueResult {
  const sleep = Math.max(1, Math.min(10, Number(input.sleep || 7)));
  const muscleRest = Math.max(1, Math.min(10, Number(input.muscleRest || 7)));
  const recentRpe = Math.max(1, Math.min(10, Number(input.recentRpe ?? 6)));
  const matches7d = Math.max(0, Math.min(10, Number(input.matchesLast7Days ?? 1)));

  // Weighted freshness score (0..100): sleep 35%, muscleRest 35%, inverse RPE 18%, match load 12%
  const sleepPts = (sleep / 10) * 35;
  const musclePts = (muscleRest / 10) * 35;
  const rpePts = ((11 - recentRpe) / 10) * 18;
  const loadPts = Math.max(0, 1 - matches7d / 5) * 12;
  const score = Math.round(Math.max(0, Math.min(100, sleepPts + musclePts + rpePts + loadPts)));

  const factors: string[] = [];
  if (sleep <= 4) factors.push(`نوم قليل (${sleep}/10)`);
  if (muscleRest <= 4) factors.push(`إرهاق عضلي واضح (${muscleRest}/10)`);
  if (recentRpe >= 8) factors.push(`مجهود آخر مباراة عالٍ (RPE ${recentRpe}/10)`);
  if (matches7d >= 3) factors.push(`ضغط مباريات (${matches7d} خلال 7 أيام)`);

  // Hard safety override: severe sleep deficit or severe muscle fatigue -> red
  const isRed = score < 50 || sleep <= 3 || muscleRest <= 3 || (muscleRest <= 4 && recentRpe >= 9);
  const isYellow = !isRed && (score < 72 || sleep <= 5 || muscleRest <= 5 || matches7d >= 3);

  if (isRed) {
    return {
      level: 'red',
      emoji: '🔴',
      label: 'إجهاد عالٍ — يُفضّل الراحة أو دقائق خفيفة',
      score,
      advice:
        'جسمك يطلب استشفاءً اليوم. نسّق مع الكابتن لتقليل الدقائق أو أخذ يوم راحة لتفادي الشدّ العضلي.',
      factors: factors.length ? factors : ['مؤشر الجاهزية منخفض حالياً'],
    };
  }
  if (isYellow) {
    return {
      level: 'yellow',
      emoji: '🟡',
      label: 'إجهاد متوسط — العب بذكاء وتبديلات منتظمة',
      score,
      advice:
        'ابدأ بإحماء هادئ واطلب تبديلاً دورياً كل 8–10 دقائق مع شرب ماء كافٍ قبل وأثناء المباراة.',
      factors: factors.length ? factors : ['إرهاق خفيف متراكم'],
    };
  }
  return {
    level: 'green',
    emoji: '🟢',
    label: 'جاهزية ممتازة — جاهز للملعب',
    score,
    advice: 'مؤشرات النوم والراحة ممتازة. حافظ على الإحماء الخفيف قبل صافرة البداية.',
    factors: factors.length ? factors : ['نوم وراحة عضلية متوازنة'],
  };
}

export interface PitchSessionData {
  teamId: string;
  title: string;
  matchDate: string; // YYYY-MM-DD
  matchTime: string; // HH:MM
  venue: string;
  totalCost: number;
  currency: string;
  confirmedCount: number;
  paidCount: number;
  paidTotal: number;
}

export interface PitchPaymentRecord {
  id?: string;
  teamId: string;
  sessionId: string;
  playerId: string;
  ownerUid: string;
  playerName: string;
  amount: number;
  paid: boolean;
}

export interface PitchSplitSummary {
  totalCost: number;
  confirmedCount: number;
  perPlayerShare: number;
  paidCount: number;
  unpaidCount: number;
  paidTotal: number;
  remainingTotal: number;
}

export function computePitchSplit(input: {
  totalCost: number;
  confirmedPlayerIds: string[];
  payments: PitchPaymentRecord[];
}): PitchSplitSummary {
  const totalCost = Math.max(0, Number(input.totalCost || 0));
  const uniqueConfirmed = Array.from(new Set(input.confirmedPlayerIds.filter(Boolean)));
  const confirmedCount = uniqueConfirmed.length;
  const perPlayerShare =
    confirmedCount > 0 ? Math.round((totalCost / confirmedCount) * 10) / 10 : 0;

  const paidSet = new Set(
    (input.payments || []).filter((p) => p.paid && uniqueConfirmed.includes(p.playerId)).map((p) => p.playerId)
  );
  const paidCount = paidSet.size;
  const unpaidCount = Math.max(0, confirmedCount - paidCount);
  const paidTotal = Math.round(paidCount * perPlayerShare * 10) / 10;
  const remainingTotal = Math.max(0, Math.round((totalCost - paidTotal) * 10) / 10);

  return {
    totalCost,
    confirmedCount,
    perPlayerShare,
    paidCount,
    unpaidCount,
    paidTotal,
    remainingTotal,
  };
}

export interface WhatsAppReminderResult {
  confirmedNames: string[];
  declinedNames: string[];
  unrespondedNames: string[];
  messageText: string;
  waUrl: string;
}

export function buildWhatsAppReminder(input: {
  teamName: string;
  matchTitle: string;
  matchDate: string;
  matchTime: string;
  venue: string;
  players: Array<{ id: string; name: string; availableStatus?: string }>;
  attendance: Array<{ playerId?: string; playerName?: string; date?: string; status?: string }>;
}): WhatsAppReminderResult {
  const targetDate = String(input.matchDate || '').trim();
  // Match attendance rows for targetDate (or latest entries if date is unset)
  const latestByPlayer = new Map<string, string>();
  for (const row of input.attendance || []) {
    if (targetDate && row.date && row.date !== targetDate) continue;
    const key = String(row.playerId || row.playerName || '').trim();
    if (!key) continue;
    latestByPlayer.set(key, String(row.status || ''));
  }

  const confirmedNames: string[] = [];
  const declinedNames: string[] = [];
  const unrespondedNames: string[] = [];

  for (const p of input.players || []) {
    const status = latestByPlayer.get(p.id) || latestByPlayer.get(p.name) || '';
    if (status === 'جاي') {
      confirmedNames.push(p.name);
    } else if (status === 'ما فيني' || status === 'معتذر') {
      declinedNames.push(p.name);
    } else if (p.availableStatus !== 'unavailable') {
      unrespondedNames.push(p.name);
    }
  }

  const lines: string[] = [
    `⚽ *تذكير حضور — ${input.teamName || 'فريق السداسي'}*`,
    `📅 ${input.matchTitle || 'مباراة السداسي'} (${targetDate || 'القادمة'} الساعة ${input.matchTime || '20:00'})`,
  ];
  if (input.venue) lines.push(`🏟️ الملعب: ${input.venue}`);
  lines.push(`✅ المؤكّدون حتى الآن (${confirmedNames.length}): ${confirmedNames.length ? confirmedNames.join('، ') : 'لا يوجد بعد'}`);
  if (unrespondedNames.length > 0) {
    lines.push(`⏳ بانتظار تأكيدكم يا شباب (${unrespondedNames.length}): ${unrespondedNames.join('، ')}`);
    lines.push('يرجى الضغط على «جاي» أو «محتمل» أو «معتذر» في التطبيق لتأكيد العدد وقَطّة الملعب.');
  } else {
    lines.push('🎉 رائع! جميع اللاعبين المتاحين ردّوا على الحضور.');
  }

  const messageText = lines.join('\n');
  return {
    confirmedNames,
    declinedNames,
    unrespondedNames,
    messageText,
    waUrl: `https://wa.me/?text=${encodeURIComponent(messageText)}`,
  };
}

function escapeIcsText(text: string): string {
  return String(text || '')
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

function formatIcsLocalDateTime(dateStr: string, timeStr: string, addMinutes = 0): string {
  const mDate = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || '').trim());
  const mTime = /^(\d{2}):(\d{2})$/.exec(String(timeStr || '').trim());
  const y = mDate ? Number(mDate[1]) : 2026;
  const mo = mDate ? Number(mDate[2]) : 11;
  const d = mDate ? Number(mDate[3]) : 25;
  const h = mTime ? Number(mTime[1]) : 20;
  const mi = mTime ? Number(mTime[2]) : 0;

  const dt = new Date(Date.UTC(y, mo - 1, d, h, mi + addMinutes, 0));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${dt.getUTCFullYear()}${pad(dt.getUTCMonth() + 1)}${pad(dt.getUTCDate())}T${pad(dt.getUTCHours())}${pad(dt.getUTCMinutes())}00`;
}

export function generateMatchIcs(input: {
  title: string;
  teamName: string;
  matchDate: string;
  matchTime: string;
  durationMinutes?: number;
  venue?: string;
  description?: string;
}): string {
  const dur = Math.max(30, Math.min(240, Number(input.durationMinutes || 60)));
  const dtStart = formatIcsLocalDateTime(input.matchDate, input.matchTime, 0);
  const dtEnd = formatIcsLocalDateTime(input.matchDate, input.matchTime, dur);
  const uid = `maydan6v6-${dtStart}@maydan.local`;
  const summary = escapeIcsText(`${input.title || 'مباراة سداسي'} — ${input.teamName || 'ميدان 6v6'}`);
  const location = escapeIcsText(input.venue || 'ملعب السداسي');
  const desc = escapeIcsText(
    input.description || 'مباراة فريق السداسي (6v6) عبر تطبيق ميدان 6v6'
  );

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Maydan 6v6//Match Calendar//AR',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${dtStart}Z`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${summary}`,
    `LOCATION:${location}`,
    `DESCRIPTION:${desc}`,
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}

export interface NotificationItem {
  id: string;
  category: 'join' | 'match' | 'fatigue' | 'award';
  icon: string;
  title: string;
  body: string;
  targetTab: string;
  unread: boolean;
}

export function buildNotifications(input: {
  isCaptain: boolean;
  currentUserId: string;
  pendingPlayersCount: number;
  pitchSession?: Partial<PitchSessionData> | null;
  hasUserRepliedAttendance: boolean;
  fatigueByPlayer: Array<{ playerId: string; playerName: string; signal: FatigueResult }>;
  userLevel: number;
  userXp: number;
  readIds: string[];
}): { items: NotificationItem[]; unreadCount: number } {
  const readSet = new Set(input.readIds || []);
  const items: NotificationItem[] = [];

  // 1. Pending Join Requests (CAPTAIN ONLY)
  if (input.isCaptain && input.pendingPlayersCount > 0) {
    const id = `join_pending_${input.pendingPlayersCount}`;
    items.push({
      id,
      category: 'join',
      icon: '🤝',
      title: `لديك ${input.pendingPlayersCount} طلب انضمام معلّق`,
      body: 'راجع الطلبات الجديدة واقبل أو ارفض من لوحة الكابتن.',
      targetTab: 'admin',
      unread: !readSet.has(id),
    });
  }

  // 2. Upcoming Match Schedule & Attendance Reminder
  if (input.pitchSession && input.pitchSession.matchDate) {
    const id = `match_${input.pitchSession.matchDate}_${input.pitchSession.matchTime || '20:00'}`;
    items.push({
      id,
      category: 'match',
      icon: '📅',
      title: `مباراة قادمة: ${input.pitchSession.title || 'مباراة السداسي'}`,
      body: input.hasUserRepliedAttendance
        ? `الموعد ${input.pitchSession.matchDate} الساعة ${input.pitchSession.matchTime || '20:00'} · تم تسجيل حضورك.`
        : `الموعد ${input.pitchSession.matchDate} الساعة ${input.pitchSession.matchTime || '20:00'} · لم تؤكّد حضورك بعد!`,
      targetTab: 'ready',
      unread: !readSet.has(id),
    });
  }

  // 3. High Fatigue Alerts (STRICT PRIVACY: player sees ONLY own 🔴; Captain sees 🔴 for team/self)
  for (const entry of input.fatigueByPlayer || []) {
    if (entry.signal.level !== 'red') continue;
    const isSelf = entry.playerId === input.currentUserId;
    if (!isSelf && !input.isCaptain) continue; // Privacy gate!
    const id = `fatigue_red_${entry.playerId}_${entry.signal.score}`;
    items.push({
      id,
      category: 'fatigue',
      icon: '🔴',
      title: isSelf ? 'تنبيه إجهاد عالٍ (خاص بك)' : `إجهاد عالٍ: ${entry.playerName} (خاص بالكابتن)`,
      body: isSelf
        ? entry.signal.advice
        : `مؤشر الجاهزية ${entry.signal.score}/100 — يُنصح بتقليل دقائقه أو إراحته في المباراة القادمة.`,
      targetTab: 'ready',
      unread: !readSet.has(id),
    });
  }

  // 4. Awards & Progression
  if (input.userXp > 0) {
    const id = `award_lvl_${input.userLevel}`;
    items.push({
      id,
      category: 'award',
      icon: '🏆',
      title: `المستوى ${input.userLevel} في درع ميدان (${input.userXp} XP)`,
      body: 'استمر بتسجيل تقارير المباريات لرفع مستوى درعك وفتح شارات جديدة.',
      targetTab: 'fifa',
      unread: !readSet.has(id),
    });
  }

  return {
    items,
    unreadCount: items.filter((i) => i.unread).length,
  };
}

export interface PreMatchMountHooks {
  getState: () => Record<string, unknown>;
  getCurrentUser: () => Record<string, unknown> | null;
  isCaptain: () => boolean;
  canManagePitch?: () => boolean;
  isFirebaseMode: () => boolean;
  persistAction: (action: string, payload: Record<string, unknown>) => Promise<unknown>;
  saveLocal: () => void;
  switchTab: (tabId: string) => void;
  toast: (msg: string, isErr?: boolean) => void;
  getUserProgress: (p: Record<string, unknown>) => { xp: number; lvl: number };
}

const READ_NOTIFS_KEY = 'maydan_read_notifs_v1';

class MaydanPreMatchHubUI {
  private hooks: PreMatchMountHooks | null = null;
  private bound = false;

  private loadReadNotifs(): string[] {
    try {
      const raw = localStorage.getItem(READ_NOTIFS_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.map(String).slice(-80) : [];
    } catch {
      return [];
    }
  }

  private saveReadNotifs(ids: string[]): void {
    try {
      localStorage.setItem(READ_NOTIFS_KEY, JSON.stringify(ids.slice(-80)));
    } catch {
      // ignore storage errors
    }
  }

  mount(hooks: PreMatchMountHooks): void {
    this.hooks = hooks;
    if (!this.bound) {
      this.bound = true;
      this.bindStaticHandlers();
    }
    this.render();
    this.renderNotificationsBell();
  }

  private bindStaticHandlers(): void {
    // Live fatigue preview when dragging readiness sliders
    ['rd1', 'rd2', 'rd3'].forEach((id) => {
      document.getElementById(id)?.addEventListener('input', () => {
        this.renderFatigueWidget();
      });
    });

    // Save upcoming match + pitch fee settings (Organizer / Friends Mode)
    document.getElementById('pitchSessionForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!this.hooks) return;
      const canEditPitch = this.hooks.canManagePitch ? this.hooks.canManagePitch() : this.hooks.isCaptain();
      if (!canEditPitch) {
        this.hooks.toast('تعديل موعد المباراة والقَطّة متاح لمنشئ الفريق والمنظّمين فقط', true);
        return;
      }
      const st = this.hooks.getState();
      const settings = (st.settings || {}) as Record<string, unknown>;
      const title = (document.getElementById('pmTitle') as HTMLInputElement)?.value.trim() || 'مباراة السداسي';
      const matchDate = (document.getElementById('pmDate') as HTMLInputElement)?.value || new Date().toISOString().slice(0, 10);
      const matchTime = (document.getElementById('pmTime') as HTMLInputElement)?.value || '20:30';
      const venue = (document.getElementById('pmVenue') as HTMLInputElement)?.value.trim() || 'ملعب السداسي';
      const totalCost = Math.max(0, Number((document.getElementById('pmCost') as HTMLInputElement)?.value || 0));
      const currency = (document.getElementById('pmCurrency') as HTMLInputElement)?.value.trim() || String(settings.defaultCurrency || 'ريال');

      const prevPayments = (st.pitchPayments || []) as PitchPaymentRecord[];
      const confirmedIds = this.getConfirmedPlayerIds(matchDate);
      const split = computePitchSplit({ totalCost, confirmedPlayerIds: confirmedIds, payments: prevPayments });

      const nextSession: PitchSessionData = {
        teamId: 'main',
        title,
        matchDate,
        matchTime,
        venue,
        totalCost,
        currency,
        confirmedCount: split.confirmedCount,
        paidCount: split.paidCount,
        paidTotal: split.paidTotal,
      };
      st.pitchSession = nextSession;
      if (!this.hooks.isFirebaseMode()) this.hooks.saveLocal();
      await this.hooks.persistAction('pitchSession', nextSession as unknown as Record<string, unknown>);
      this.render();
      this.renderNotificationsBell();
      this.hooks.toast('تم حفظ موعد المباراة وحاسبة القَطّة ✓');
    });

    // Download .ics calendar file
    document.getElementById('btnAddCalendarIcs')?.addEventListener('click', () => {
      if (!this.hooks) return;
      const st = this.hooks.getState();
      const settings = (st.settings || {}) as Record<string, unknown>;
      const session = this.getSessionOrDefault();
      const ics = generateMatchIcs({
        title: session.title,
        teamName: String(settings.teamName || 'فريق السداسي'),
        matchDate: session.matchDate,
        matchTime: session.matchTime,
        durationMinutes: 60,
        venue: session.venue,
        description: `مباراة ${String(settings.teamName || 'فريق السداسي')} — التكلفة الكلية: ${session.totalCost} ${session.currency}`,
      });
      const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `maydan-match-${session.matchDate}.ics`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1500);
      this.hooks.toast('تم تحميل ملف التقويم (.ics) ✓ افتحه لإضافة الموعد');
    });

    // Smart WhatsApp Reminder
    document.getElementById('btnWaRemindMissing')?.addEventListener('click', () => {
      if (!this.hooks) return;
      const rem = this.computeCurrentReminder();
      const a = document.createElement('a');
      a.href = rem.waUrl;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.click();
    });

    document.getElementById('btnCopyRemindMissing')?.addEventListener('click', () => {
      if (!this.hooks) return;
      const rem = this.computeCurrentReminder();
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard
          .writeText(rem.messageText)
          .then(() => this.hooks?.toast('تم نسخ تذكير الحضور لواتساب ✓'))
          .catch(() => this.hooks?.toast('تعذّر النسخ التلقائي — استخدم زر واتساب المباشر', true));
      } else {
        this.hooks.toast('تم تجهيز نص التذكير ✓');
      }
    });

    // Notification Bell drawer open/close
    document.getElementById('btnNotifBell')?.addEventListener('click', () => {
      this.renderNotificationsModal();
      document.getElementById('notifModal')?.classList.remove('hidden');
    });
    document.getElementById('closeNotifModal')?.addEventListener('click', () => {
      document.getElementById('notifModal')?.classList.add('hidden');
    });
    document.getElementById('notifModal')?.addEventListener('click', (e) => {
      if ((e.target as HTMLElement)?.id === 'notifModal') {
        document.getElementById('notifModal')?.classList.add('hidden');
      }
    });
    document.getElementById('btnMarkAllNotifsRead')?.addEventListener('click', () => {
      const notifData = this.collectNotifications();
      const merged = Array.from(new Set([...this.loadReadNotifs(), ...notifData.items.map((i) => i.id)]));
      this.saveReadNotifs(merged);
      this.renderNotificationsBell();
      this.renderNotificationsModal();
      this.hooks?.toast('تم تحديد جميع التنبيهات كمقروءة ✓');
    });
  }

  private getSessionOrDefault(): PitchSessionData {
    const st = (this.hooks?.getState() || {}) as Record<string, unknown>;
    const settings = (st.settings || {}) as Record<string, unknown>;
    const raw = (st.pitchSession || {}) as Partial<PitchSessionData>;
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const defaultCost = Math.max(0, Number(settings.defaultPitchCost ?? 0));
    const resolvedCost =
      raw.totalCost !== undefined && raw.totalCost !== null && Number.isFinite(Number(raw.totalCost))
        ? Math.max(0, Number(raw.totalCost))
        : defaultCost;
    return {
      teamId: String(raw.teamId || settings.teamId || 'main'),
      title: String(raw.title || 'مباراة السداسي القادمة'),
      matchDate: String(raw.matchDate || tomorrow),
      matchTime: String(raw.matchTime || '20:30'),
      venue: String(raw.venue || 'يُحدّد لاحقاً'),
      totalCost: resolvedCost,
      currency: String(raw.currency || settings.defaultCurrency || 'ريال'),
      confirmedCount: Number(raw.confirmedCount || 0),
      paidCount: Number(raw.paidCount || 0),
      paidTotal: Number(raw.paidTotal || 0),
    };
  }

  private getConfirmedPlayerIds(matchDate: string): string[] {
    const st = (this.hooks?.getState() || {}) as Record<string, unknown>;
    const players = (st.players || []) as Array<Record<string, unknown>>;
    const attendance = (st.attendance || []) as Array<Record<string, unknown>>;
    const statusByKey = new Map<string, string>();
    for (const row of attendance) {
      if (matchDate && row.date && String(row.date) !== matchDate) continue;
      const k = String(row.playerId || row.playerName || '');
      if (k) statusByKey.set(k, String(row.status || ''));
    }
    const ids: string[] = [];
    for (const p of players) {
      const pid = String(p.id || '');
      const pname = String(p.name || '');
      const status = statusByKey.get(pid) || statusByKey.get(pname) || '';
      if (status === 'جاي') ids.push(pid);
    }
    return ids;
  }

  private computeCurrentReminder(): WhatsAppReminderResult {
    const st = (this.hooks?.getState() || {}) as Record<string, unknown>;
    const settings = (st.settings || {}) as Record<string, unknown>;
    const session = this.getSessionOrDefault();
    const players = ((st.players || []) as Array<Record<string, unknown>>).map((p) => ({
      id: String(p.id || ''),
      name: String(p.name || ''),
      availableStatus: String(p.availableStatus || 'available'),
    }));
    const attendance = ((st.attendance || []) as Array<Record<string, unknown>>).map((a) => ({
      playerId: String(a.playerId || ''),
      playerName: String(a.playerName || ''),
      date: String(a.date || ''),
      status: String(a.status || ''),
    }));
    return buildWhatsAppReminder({
      teamName: String(settings.teamName || 'فريق السداسي'),
      matchTitle: session.title,
      matchDate: session.matchDate,
      matchTime: session.matchTime,
      venue: session.venue,
      players,
      attendance,
    });
  }

  private computeAllFatigueSignals(): Array<{
    playerId: string;
    playerName: string;
    signal: FatigueResult;
  }> {
    const st = (this.hooks?.getState() || {}) as Record<string, unknown>;
    const user = this.hooks?.getCurrentUser();
    const isCaptain = Boolean(this.hooks?.isCaptain());
    const players = (st.players || []) as Array<Record<string, unknown>>;
    const readiness = (st.readiness || []) as Array<Record<string, unknown>>;
    const reports = (st.reports || []) as Array<Record<string, unknown>>;

    const visiblePlayers = isCaptain
      ? players
      : players.filter((p) => String(p.id) === String(user?.id || ''));

    const results: Array<{ playerId: string; playerName: string; signal: FatigueResult }> = [];
    const weekAgoMs = Date.now() - 7 * 86400000;

    for (const p of visiblePlayers) {
      const pid = String(p.id || '');
      const ownerUid = String(p.ownerUid || pid);
      const pReady = readiness.filter(
        (r) => String(r.playerId || '') === pid || String(r.ownerUid || '') === ownerUid
      );
      const latestRd = pReady[pReady.length - 1];

      const pReps = reports.filter((r) => String(r.playerId || '') === pid);
      const latestRep = pReps[pReps.length - 1];
      const recentMatches = pReps.filter((r) => {
        const ts = r.createdAt as { toMillis?: () => number } | number | undefined;
        if (ts && typeof ts === 'object' && typeof ts.toMillis === 'function') {
          return ts.toMillis() >= weekAgoMs;
        }
        return true;
      }).length;

      // For current user, reflect live slider values if no readiness submitted yet or editing
      const isSelf = pid === String(user?.id || '');
      const sleepEl = document.getElementById('rd1') as HTMLInputElement | null;
      const muscleEl = document.getElementById('rd2') as HTMLInputElement | null;
      const sleepVal = latestRd
        ? Number(latestRd.sleep || 8)
        : isSelf && sleepEl
          ? Number(sleepEl.value || 8)
          : 8;
      const muscleVal = latestRd
        ? Number(latestRd.fatigue || 8)
        : isSelf && muscleEl
          ? Number(muscleEl.value || 8)
          : 8;

      const signal = computeFatigueSignal({
        sleep: sleepVal,
        muscleRest: muscleVal,
        recentRpe: latestRep ? Number(latestRep.rpe || 6) : 6,
        matchesLast7Days: Math.min(5, recentMatches),
      });
      results.push({ playerId: pid, playerName: String(p.name || 'لاعب'), signal });
    }
    return results;
  }

  private renderFatigueWidget(): void {
    if (!this.hooks) return;
    const user = this.hooks.getCurrentUser();
    const isCaptain = this.hooks.isCaptain();
    const st = this.hooks.getState();
    const reports = (st.reports || []) as Array<Record<string, unknown>>;

    const sleepEl = document.getElementById('rd1') as HTMLInputElement | null;
    const muscleEl = document.getElementById('rd2') as HTMLInputElement | null;
    const myReps = user ? reports.filter((r) => String(r.playerId || '') === String(user.id || '')) : [];
    const latestRep = myReps[myReps.length - 1];

    const liveSignal = computeFatigueSignal({
      sleep: Number(sleepEl?.value || 8),
      muscleRest: Number(muscleEl?.value || 8),
      recentRpe: latestRep ? Number(latestRep.rpe || 6) : 6,
      matchesLast7Days: Math.min(5, myReps.length),
    });

    const box = document.getElementById('fatigueTrafficBox');
    if (box) {
      const borderCol =
        liveSignal.level === 'red'
          ? 'rgba(244,63,94,0.55)'
          : liveSignal.level === 'yellow'
            ? 'rgba(250,204,21,0.45)'
            : 'rgba(34,197,94,0.45)';
      box.style.borderColor = borderCol;
      box.innerHTML = `
        <div class="row between" style="margin-bottom:4px;flex-wrap:nowrap;gap:6px;">
          <strong style="font-size:0.84rem;">${liveSignal.emoji} إشارة مرور الإجهاد (خاص)</strong>
          <strong style="color:var(--primary);font-variant-numeric:tabular-nums;white-space:nowrap;">${liveSignal.score}/100</strong>
        </div>
        <div style="font-weight:800;font-size:0.84rem;margin-bottom:4px;">${escapeHtml(liveSignal.label)}</div>
        <div class="muted" style="font-size:0.75rem;line-height:1.5;">${escapeHtml(liveSignal.advice)}</div>
        <div class="muted" style="font-size:0.72rem;margin-top:4px;">العوامل: ${escapeHtml(liveSignal.factors.join(' · '))}</div>
      `;
    }

    // Captain-only team fatigue overview (strictly hidden and cleared for regular players)
    const capBox = document.getElementById('captainFatigueRadar');
    if (capBox) {
      capBox.classList.toggle('hidden', !isCaptain);
      if (isCaptain) {
        const signals = this.computeAllFatigueSignals();
        capBox.innerHTML = `
          <div class="row between" style="margin-bottom:8px;">
            <h3 style="margin:0;">🚦 رادار إجهاد الفريق (خاص بالكابتن فقط)</h3>
            <span class="muted" style="font-size:0.72rem;">لا يظهر لبقية اللاعبين</span>
          </div>
          ${signals
            .map(
              (s) => `
              <div class="item-box row between" style="margin-bottom:6px;">
                <span><strong>${escapeHtml(s.playerName)}</strong> · <span class="muted">${escapeHtml(s.signal.factors[0] || '')}</span></span>
                <span style="font-weight:800;white-space:nowrap;">${s.signal.emoji} ${s.signal.score}%</span>
              </div>
            `
            )
            .join('')}
        `;
      } else {
        capBox.innerHTML = '';
      }
    }
  }

  render(): void {
    if (!this.hooks) return;
    const st = this.hooks.getState();
    const user = this.hooks.getCurrentUser();
    const isCaptain = this.hooks.isCaptain();
    const players = (st.players || []) as Array<Record<string, unknown>>;
    const payments = (st.pitchPayments || []) as PitchPaymentRecord[];
    const session = this.getSessionOrDefault();

    this.renderFatigueWidget();

    const canManagePitch = this.hooks.canManagePitch ? this.hooks.canManagePitch() : isCaptain;

    // Populate schedule/fee form inputs (editable for organizers or all members in Friends Mode)
    const capForm = document.getElementById('pitchSessionForm');
    if (capForm) {
      capForm.classList.toggle('hidden', !canManagePitch);
      const setVal = (id: string, val: string) => {
        const el = document.getElementById(id) as HTMLInputElement | null;
        if (el) el.value = val;
      };
      if (canManagePitch) {
        const activeTag = document.activeElement?.tagName;
        if (activeTag !== 'INPUT') {
          setVal('pmTitle', session.title);
          setVal('pmDate', session.matchDate);
          setVal('pmTime', session.matchTime);
          setVal('pmVenue', session.venue === 'يُحدّد لاحقاً' ? '' : session.venue);
          setVal('pmCost', session.totalCost > 0 ? String(session.totalCost) : '');
          setVal('pmCurrency', session.currency);
        }
      } else {
        setVal('pmTitle', '');
        setVal('pmDate', '');
        setVal('pmTime', '');
        setVal('pmVenue', '');
        setVal('pmCost', '');
        setVal('pmCurrency', '');
      }
    }

    // Match summary & Pitch Fee Split
    const confirmedIds = this.getConfirmedPlayerIds(session.matchDate);
    const split = computePitchSplit({
      totalCost: session.totalCost,
      confirmedPlayerIds: confirmedIds,
      payments,
    });

    const displayPaidCount = canManagePitch ? split.paidCount : Math.max(split.paidCount, Number(session.paidCount || 0));
    const displayPaidTotal = canManagePitch ? split.paidTotal : Math.max(split.paidTotal, Number(session.paidTotal || 0));
    const displayRemaining = Math.max(0, Math.round((session.totalCost - displayPaidTotal) * 10) / 10);

    const summaryEl = document.getElementById('pitchSplitSummary');
    if (summaryEl) {
      summaryEl.innerHTML = `
        <div class="item-box" style="margin-bottom:8px;border-color:rgba(250,204,21,0.32);">
          <div style="font-weight:900;color:var(--primary);font-size:0.95rem;">${escapeHtml(session.title)}</div>
          <div class="muted" style="font-size:0.78rem;margin-top:3px;">
            📅 ${escapeHtml(session.matchDate)} · ⏰ ${escapeHtml(session.matchTime)} · 🏟️ ${escapeHtml(session.venue)}
          </div>
        </div>
        <div class="grid-3" style="gap:6px;margin-bottom:8px;text-align:center;">
          <div class="item-box" style="margin:0;padding:8px;">
            <div class="muted" style="font-size:0.7rem;">التكلفة الكلية</div>
            <strong style="font-size:0.95rem;font-variant-numeric:tabular-nums;">${session.totalCost} ${escapeHtml(session.currency)}</strong>
          </div>
          <div class="item-box" style="margin:0;padding:8px;">
            <div class="muted" style="font-size:0.7rem;">حصة الفرد (${split.confirmedCount} مؤكّد)</div>
            <strong style="color:var(--primary);font-size:0.95rem;font-variant-numeric:tabular-nums;">${split.perPlayerShare} ${escapeHtml(session.currency)}</strong>
          </div>
          <div class="item-box" style="margin:0;padding:8px;">
            <div class="muted" style="font-size:0.7rem;">المدفوع</div>
            <strong style="color:#86efac;font-size:0.9rem;font-variant-numeric:tabular-nums;">${displayPaidTotal} ${escapeHtml(session.currency)}</strong>
            <div class="muted" style="font-size:0.66rem;font-variant-numeric:tabular-nums;">متبقي: ${displayRemaining}</div>
          </div>
        </div>
      `;
    }

    // Player's own payment status (visible to every player)
    const myPayEl = document.getElementById('myPitchPayStatus');
    if (myPayEl && user) {
      const uid = String(user.id || '');
      const isConfirmed = confirmedIds.includes(uid);
      const myRecord = payments.find((p) => p.playerId === uid || p.ownerUid === String(user.ownerUid || uid));
      const isPaid = Boolean(myRecord?.paid);
      myPayEl.innerHTML = `
        <div class="item-box row between" style="border-color:${isPaid ? 'rgba(34,197,94,0.45)' : 'rgba(250,204,21,0.28)'};">
          <div>
            <strong>💳 حالتك في القَطّة</strong>
            <div class="muted" style="font-size:0.74rem;">
              ${isConfirmed ? `حصتك الحالية: ${split.perPlayerShare} ${escapeHtml(session.currency)}` : 'أكّد حضورك بـ «جاي» لتُحتسب ضمن القَطّة'}
            </div>
          </div>
          <strong style="color:${isPaid ? '#86efac' : '#fde68a'};white-space:nowrap;">
            ${isPaid ? '✅ تم الدفع' : '⏳ لم يُدفع بعد'}
          </strong>
        </div>
      `;
    }

    // Payment checklist (editable by organizers or friends in Friends Mode)
    const capPayList = document.getElementById('captainPitchPayList');
    if (capPayList) {
      capPayList.classList.toggle('hidden', !canManagePitch);
      if (!canManagePitch) {
        capPayList.innerHTML = '';
      } else {
        if (!confirmedIds.length) {
          capPayList.innerHTML =
            '<p class="muted" style="font-size:0.78rem;">لا يوجد لاعبون مؤكّدون بعد — ستظهر قائمة الدفع فور تأكيد الحضور بـ «جاي».</p>';
        } else {
          capPayList.innerHTML = `
            <div class="muted" style="font-size:0.74rem;margin-bottom:6px;">
              قائمة دفع القَطّة (المدفوع: ${displayPaidCount}/${confirmedIds.length}):
            </div>
            ${confirmedIds
              .map((pid) => {
                const p = players.find((x) => String(x.id) === pid);
                const pname = p ? String(p.name || 'لاعب') : pid;
                const rec = payments.find((x) => x.playerId === pid);
                const paid = Boolean(rec?.paid);
                return `
                  <div class="item-box row between" style="margin-bottom:6px;">
                    <div>
                      <strong>${escapeHtml(pname)}</strong>
                      <div class="muted" style="font-size:0.72rem;">الحصة: ${split.perPlayerShare} ${escapeHtml(session.currency)}</div>
                    </div>
                    <button type="button" data-toggle-pay="${escapeHtml(pid)}" class="${paid ? 'btn-emerald' : 'btn-amber'}" style="padding:6px 10px;min-height:36px;font-size:0.76rem;white-space:nowrap;">
                      ${paid ? '✅ دفع' : '⏳ لم يدفع'}
                    </button>
                  </div>
                `;
              })
              .join('')}
          `;

          capPayList.querySelectorAll<HTMLButtonElement>('[data-toggle-pay]').forEach((btn) => {
            btn.addEventListener('click', async () => {
              const allowedNow = this.hooks?.canManagePitch ? this.hooks.canManagePitch() : Boolean(this.hooks?.isCaptain());
              if (!this.hooks || !allowedNow) {
                this.hooks?.toast('تحديث حالة دفع القَطّة متاح للمنظّمين فقط', true);
                return;
              }
              const targetPid = btn.dataset.togglePay || '';
              const targetPlayer = players.find((x) => String(x.id) === targetPid);
              const existing = payments.find((x) => x.playerId === targetPid);
              const nextPaid = !Boolean(existing?.paid);
              const rec: PitchPaymentRecord = {
                id: `current__${targetPid}`,
                teamId: 'main',
                sessionId: 'current',
                playerId: targetPid,
                ownerUid: String(targetPlayer?.ownerUid || targetPid),
                playerName: String(targetPlayer?.name || 'لاعب'),
                amount: split.perPlayerShare,
                paid: nextPaid,
              };

              // Update local array immediately
              const nextPayments = payments.filter((x) => x.playerId !== targetPid);
              nextPayments.push(rec);
              st.pitchPayments = nextPayments;

              const updatedSplit = computePitchSplit({
                totalCost: session.totalCost,
                confirmedPlayerIds: confirmedIds,
                payments: nextPayments,
              });
              const updatedSession: PitchSessionData = {
                ...session,
                confirmedCount: updatedSplit.confirmedCount,
                paidCount: updatedSplit.paidCount,
                paidTotal: updatedSplit.paidTotal,
              };
              st.pitchSession = updatedSession;

              if (!this.hooks.isFirebaseMode()) this.hooks.saveLocal();
              await this.hooks.persistAction('pitchPayment', {
                payment: rec,
                session: updatedSession,
              });
              this.render();
              this.hooks.toast(nextPaid ? `تم تسجيل دفع ${rec.playerName} ✓` : `تم تعديل حالة ${rec.playerName} إلى لم يدفع`);
            });
          });
        }
      }
    }

    // Smart WhatsApp Reminder preview box
    const rem = this.computeCurrentReminder();
    const remBox = document.getElementById('waReminderPreview');
    if (remBox) {
      remBox.innerHTML = rem.unrespondedNames.length
        ? `<div class="muted" style="font-size:0.78rem;">لم يردّوا بعد (${rem.unrespondedNames.length}): <strong style="color:#fde68a;">${escapeHtml(rem.unrespondedNames.join('، '))}</strong></div>`
        : '<div style="font-size:0.78rem;color:#86efac;">🎉 جميع اللاعبين المتاحين أكّدوا ردّهم على الحضور.</div>';
    }
  }

  private collectNotifications(): { items: NotificationItem[]; unreadCount: number } {
    const st = (this.hooks?.getState() || {}) as Record<string, unknown>;
    const user = this.hooks?.getCurrentUser();
    const isCaptain = Boolean(this.hooks?.isCaptain());
    const pendingPlayers = (st.pendingPlayers || []) as Array<unknown>;
    const session = this.getSessionOrDefault();
    const attendance = (st.attendance || []) as Array<Record<string, unknown>>;
    const uid = String(user?.id || '');
    const uname = String(user?.name || '');
    const hasReplied = attendance.some(
      (a) =>
        (!session.matchDate || !a.date || String(a.date) === session.matchDate) &&
        (String(a.playerId || '') === uid || String(a.playerName || '') === uname)
    );
    const prog = user && this.hooks ? this.hooks.getUserProgress(user) : { xp: 0, lvl: 1 };

    return buildNotifications({
      isCaptain,
      currentUserId: uid,
      pendingPlayersCount: pendingPlayers.length,
      pitchSession: session,
      hasUserRepliedAttendance: hasReplied,
      fatigueByPlayer: this.computeAllFatigueSignals(),
      userLevel: prog.lvl,
      userXp: prog.xp,
      readIds: this.loadReadNotifs(),
    });
  }

  renderNotificationsBell(): void {
    const badge = document.getElementById('notifUnreadBadge');
    if (!badge) return;
    const { unreadCount } = this.collectNotifications();
    badge.textContent = unreadCount > 9 ? '9+' : String(unreadCount);
    badge.classList.toggle('hidden', unreadCount === 0);
  }

  private renderNotificationsModal(): void {
    const listEl = document.getElementById('notifModalList');
    if (!listEl) return;
    const { items } = this.collectNotifications();
    if (!items.length) {
      listEl.innerHTML = '<p class="muted" style="text-align:center;padding:12px;">لا توجد تنبيهات جديدة حالياً.</p>';
      return;
    }
    listEl.innerHTML = items
      .map(
        (item) => `
        <button type="button" data-notif-tab="${escapeHtml(item.targetTab)}" data-notif-id="${escapeHtml(item.id)}" class="item-box" style="width:100%;text-align:right;color:#fff;border-color:${item.unread ? 'rgba(250,204,21,0.45)' : 'var(--border-subtle)'};margin-bottom:6px;">
          <div class="row between" style="margin-bottom:3px;">
            <strong style="font-size:0.84rem;">${escapeHtml(item.icon)} ${escapeHtml(item.title)}</strong>
            ${item.unread ? '<span style="color:var(--primary);font-size:0.7rem;font-weight:800;">جديد</span>' : '<span class="muted" style="font-size:0.7rem;">مقروء</span>'}
          </div>
          <div class="muted" style="font-size:0.75rem;line-height:1.45;">${escapeHtml(item.body)}</div>
        </button>
      `
      )
      .join('');

    listEl.querySelectorAll<HTMLButtonElement>('[data-notif-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const nid = btn.dataset.notifId || '';
        const targetTab = btn.dataset.notifTab || 'ready';
        if (nid) {
          const merged = Array.from(new Set([...this.loadReadNotifs(), nid]));
          this.saveReadNotifs(merged);
          this.renderNotificationsBell();
        }
        document.getElementById('notifModal')?.classList.add('hidden');
        this.hooks?.switchTab(targetTab);
      });
    });
  }
}

export const preMatchHubUI = new MaydanPreMatchHubUI();

declare global {
  interface Window {
    MaydanPreMatch?: {
      ui: MaydanPreMatchHubUI;
      computeFatigueSignal: typeof computeFatigueSignal;
      computePitchSplit: typeof computePitchSplit;
      buildWhatsAppReminder: typeof buildWhatsAppReminder;
      generateMatchIcs: typeof generateMatchIcs;
      buildNotifications: typeof buildNotifications;
    };
  }
}

if (typeof window !== 'undefined') {
  window.MaydanPreMatch = {
    ui: preMatchHubUI,
    computeFatigueSignal,
    computePitchSplit,
    buildWhatsAppReminder,
    generateMatchIcs,
    buildNotifications,
  };
}

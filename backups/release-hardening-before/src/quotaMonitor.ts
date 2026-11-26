export const SPARK_FREE_DAILY_READ_LIMIT = 50000;
const QUOTA_STORAGE_KEY = 'maydan_firestore_quota_v1';

export type ReadCategory = 'session' | 'core' | 'tab' | 'oneShot';

export interface DailyQuotaSnapshot {
  date: string;
  totalReads: number;
  byCategory: Record<ReadCategory, number>;
  activeListeners: number;
  quotaExceeded: boolean;
}

export function isQuotaExceededError(err: unknown): boolean {
  const msg = String(
    err instanceof Error ? err.message : typeof err === 'object' && err !== null ? JSON.stringify(err) : err ?? ''
  ).toLowerCase();
  return (
    msg.includes('resource-exhausted') ||
    msg.includes('quota exceeded') ||
    msg.includes('free daily read units') ||
    msg.includes('daily limit')
  );
}

export const QUOTA_ALERT_70_PERCENT = 70;
export const SPARK_READ_BUDGET_PER_OPEN_TARGET = 40;

export const QUOTA_EXCEEDED_ARABIC_MSG =
  '⚠️ وصل المشروع إلى الحد اليومي المجاني لقراءات قاعدة البيانات (خطة Firebase المجانية). تُعاد الحصة تلقائياً غداً، ويمكنك الاستمرار بعرض البيانات المحفوظة محلياً.';

export const QUOTA_ALERT_70_ARABIC_MSG =
  '⚠️ تنبيه الحصة المجانية: تجاوز استهلاك اليوم 70% من حد 50,000 قراءة — يُنصح بتقليل التحديث المتكرر اليوم.';

export function computeQuotaHealth(totalReads: number, limit = SPARK_FREE_DAILY_READ_LIMIT): {
  percentUsed: number;
  remaining: number;
  status: 'safe' | 'moderate' | 'high';
  alert70: boolean;
  label: string;
} {
  const cleanReads = Math.max(0, Math.round(totalReads));
  const percentUsed = Math.min(100, Math.round((cleanReads / Math.max(1, limit)) * 1000) / 10);
  const remaining = Math.max(0, limit - cleanReads);
  const alert70 = percentUsed >= QUOTA_ALERT_70_PERCENT;
  if (percentUsed >= 80) {
    return { percentUsed, remaining, status: 'high', alert70, label: 'استهلاك مرتفع جداً — تجنّب التنقل المتكرر اليوم' };
  }
  if (alert70) {
    return { percentUsed, remaining, status: 'high', alert70, label: 'تنبيه 70%: اقتربت من الحد اليومي المجاني' };
  }
  if (percentUsed >= 40) {
    return { percentUsed, remaining, status: 'moderate', alert70, label: 'استهلاك متوسط ضمن الخطة المجانية' };
  }
  return { percentUsed, remaining, status: 'safe', alert70, label: 'استهلاك ممتاز ومنخفض جداً (مجاني 100%)' };
}

export interface DailySparkReadEstimateInput {
  teamsCount: number;
  playersPerTeam: number;
  opensPerDay: number;
  readsPerOpen?: number;
  tabSwitchReadsPerOpen?: number;
  liveUpdatesPerOpen?: number;
}

export function estimateDailySparkReads(input: DailySparkReadEstimateInput): {
  totalDailyReads: number;
  percentOfSparkLimit: number;
  withinSparkFreeTier: boolean;
  perOpenReads: number;
} {
  const teams = Math.max(1, Math.round(input.teamsCount || 1));
  const players = Math.max(1, Math.round(input.playersPerTeam || 1));
  const opens = Math.max(1, Math.round(input.opensPerDay || 1));
  const readsPerOpen = Math.max(1, Math.round(input.readsPerOpen ?? 28));
  const tabReads = Math.max(0, Math.round(input.tabSwitchReadsPerOpen ?? 12));
  const liveReads = Math.max(0, Math.round(input.liveUpdatesPerOpen ?? 6));
  const perOpenReads = readsPerOpen + tabReads + liveReads;
  const totalDailyReads = teams * players * opens * perOpenReads;
  const percentOfSparkLimit = Math.round((totalDailyReads / SPARK_FREE_DAILY_READ_LIMIT) * 1000) / 10;
  return {
    totalDailyReads,
    percentOfSparkLimit,
    withinSparkFreeTier: totalDailyReads <= SPARK_FREE_DAILY_READ_LIMIT,
    perOpenReads,
  };
}

class QuotaMonitorService {
  private state: DailyQuotaSnapshot;
  private listeners: Array<(snap: DailyQuotaSnapshot) => void> = [];

  constructor() {
    this.state = this.loadToday();
  }

  private todayStr(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private emptyToday(): DailyQuotaSnapshot {
    return {
      date: this.todayStr(),
      totalReads: 0,
      byCategory: { session: 0, core: 0, tab: 0, oneShot: 0 },
      activeListeners: 0,
      quotaExceeded: false,
    };
  }

  private loadToday(): DailyQuotaSnapshot {
    const today = this.todayStr();
    try {
      if (typeof localStorage === 'undefined') return this.emptyToday();
      const raw = localStorage.getItem(QUOTA_STORAGE_KEY);
      if (!raw) return this.emptyToday();
      const parsed = JSON.parse(raw) as Partial<DailyQuotaSnapshot>;
      if (parsed.date !== today) return this.emptyToday();
      return {
        date: today,
        totalReads: Math.max(0, Number(parsed.totalReads || 0)),
        byCategory: {
          session: Math.max(0, Number(parsed.byCategory?.session || 0)),
          core: Math.max(0, Number(parsed.byCategory?.core || 0)),
          tab: Math.max(0, Number(parsed.byCategory?.tab || 0)),
          oneShot: Math.max(0, Number(parsed.byCategory?.oneShot || 0)),
        },
        activeListeners: Math.max(0, Number(parsed.activeListeners || 0)),
        quotaExceeded: Boolean(parsed.quotaExceeded),
      };
    } catch {
      return this.emptyToday();
    }
  }

  private save(): void {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(QUOTA_STORAGE_KEY, JSON.stringify(this.state));
      }
    } catch {
      // ignore
    }
    this.listeners.forEach((cb) => cb(this.getSnapshot()));
  }

  recordReads(category: ReadCategory, count: number): void {
    if (this.state.date !== this.todayStr()) {
      this.state = this.emptyToday();
    }
    const delta = Math.max(1, Math.round(count));
    this.state.totalReads += delta;
    this.state.byCategory[category] = (this.state.byCategory[category] || 0) + delta;
    this.save();
  }

  setActiveListeners(count: number): void {
    this.state.activeListeners = Math.max(0, Math.round(count));
    this.save();
  }

  markQuotaExceeded(flag: boolean): void {
    this.state.quotaExceeded = flag;
    this.save();
  }

  getSnapshot(): DailyQuotaSnapshot {
    if (this.state.date !== this.todayStr()) {
      this.state = this.emptyToday();
    }
    return {
      ...this.state,
      byCategory: { ...this.state.byCategory },
    };
  }

  subscribe(cb: (snap: DailyQuotaSnapshot) => void): () => void {
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter((x) => x !== cb);
    };
  }
}

export const quotaMonitor = new QuotaMonitorService();

declare global {
  interface Window {
    MaydanQuota?: {
      monitor: QuotaMonitorService;
      computeQuotaHealth: typeof computeQuotaHealth;
      estimateDailySparkReads: typeof estimateDailySparkReads;
      isQuotaExceededError: typeof isQuotaExceededError;
      QUOTA_EXCEEDED_ARABIC_MSG: string;
      QUOTA_ALERT_70_ARABIC_MSG: string;
      QUOTA_ALERT_70_PERCENT: number;
      SPARK_FREE_DAILY_READ_LIMIT: number;
    };
  }
}

if (typeof window !== 'undefined') {
  window.MaydanQuota = {
    monitor: quotaMonitor,
    computeQuotaHealth,
    estimateDailySparkReads,
    isQuotaExceededError,
    QUOTA_EXCEEDED_ARABIC_MSG,
    QUOTA_ALERT_70_ARABIC_MSG,
    QUOTA_ALERT_70_PERCENT,
    SPARK_FREE_DAILY_READ_LIMIT,
  };
}

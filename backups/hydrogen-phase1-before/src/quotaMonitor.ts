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

export const QUOTA_EXCEEDED_ARABIC_MSG =
  '⚠️ وصل المشروع إلى الحد اليومي المجاني لقراءات قاعدة البيانات (خطة Firebase المجانية). تُعاد الحصة تلقائياً غداً، ويمكنك الاستمرار بعرض البيانات المحفوظة محلياً.';

export function computeQuotaHealth(totalReads: number, limit = SPARK_FREE_DAILY_READ_LIMIT): {
  percentUsed: number;
  remaining: number;
  status: 'safe' | 'moderate' | 'high';
  label: string;
} {
  const cleanReads = Math.max(0, Math.round(totalReads));
  const percentUsed = Math.min(100, Math.round((cleanReads / Math.max(1, limit)) * 1000) / 10);
  const remaining = Math.max(0, limit - cleanReads);
  if (percentUsed >= 80) {
    return { percentUsed, remaining, status: 'high', label: 'استهلاك مرتفع — تجنّب التنقل المتكرر اليوم' };
  }
  if (percentUsed >= 40) {
    return { percentUsed, remaining, status: 'moderate', label: 'استهلاك متوسط ضمن الخطة المجانية' };
  }
  return { percentUsed, remaining, status: 'safe', label: 'استهلاك ممتاز ومنخفض جداً (مجاني 100%)' };
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
      isQuotaExceededError: typeof isQuotaExceededError;
      QUOTA_EXCEEDED_ARABIC_MSG: string;
      SPARK_FREE_DAILY_READ_LIMIT: number;
    };
  }
}

if (typeof window !== 'undefined') {
  window.MaydanQuota = {
    monitor: quotaMonitor,
    computeQuotaHealth,
    isQuotaExceededError,
    QUOTA_EXCEEDED_ARABIC_MSG,
    SPARK_FREE_DAILY_READ_LIMIT,
  };
}

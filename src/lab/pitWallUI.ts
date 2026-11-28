import { escapeHtml } from '../security';
import { getSharedAudioContext } from '../ui/entryAudio';
import type { MinimalPlayer, MinimalReadinessLog } from '../tacticsData';
import {
  STYLE_META,
  applyManualRotationEdit,
  generatePitWallPlan,
  type PitWallRotationPlan,
  type TacticalPlayStyle,
} from '../engine/pitWallRotation';
import {
  MATCH_DURATION_PRESETS,
  SUB_INTERVAL_PRESETS,
  SNOOZE_DELAY_OPTIONS,
  createDualMatchTimerState,
  startOrResumeDualMatchTimer,
  pauseDualMatchTimer,
  resetDualMatchTimer,
  tickDualMatchTimer,
  confirmSubstitutionSlot,
  snoozeSubstitutionSlot,
  setMatchDuration,
  setScheduleMode,
  setSubIntervalMinutes,
  addManualSubMinute,
  editManualSubMinute,
  deleteManualSubMinute,
  getNextScheduledSub,
  validateMatchDurationMinutes,
  validateSubIntervalMinutes,
  formatMatchClock,
  serializeDualMatchTimerState,
  deserializeDualMatchTimerState,
  buildScheduledSubSlots,
  type DualMatchTimerState,
  type SubScheduleMode,
  type SubPlayerPairing,
  type ScheduledSubSlot,
} from '../engine/dualMatchTimer';

export interface PitWallControllerOptions {
  getPlayers: () => MinimalPlayer[];
  getReadiness: () => MinimalReadinessLog[];
  getStartersCount: () => number;
  toast: (msg: string, isErr?: boolean) => void;
  onTimerDisplaySync?: (formattedClock: string, isRunning: boolean) => void;
}

interface WakeLockSentinelLike {
  released?: boolean;
  release: () => Promise<void>;
  addEventListener?: (type: string, cb: () => void) => void;
}

const SESSION_TIMER_STORAGE_KEY = 'maydan_dual_match_timer_v1';

/**
 * Pit-Wall Rotation Room & Dual Match + Substitution Timer Controller:
 * Synchronizes an independent match duration timer (presets 30/45/60/75/90 + custom)
 * with an independent substitution scheduler (Repeating Interval Mode + Manual Schedule Mode),
 * smart confirm/snooze notifications, fair roster pairings, and estimated fatigue curves.
 */
export class PitWallRotationController {
  private opts: PitWallControllerOptions;
  private timerState: DualMatchTimerState;
  private style: TacticalPlayStyle = 'balanced';
  private plan: PitWallRotationPlan | null = null;
  private selectedTrackPlayerId: string | null = null;
  private editingSlotOriginalMin: number | null = null;
  private customManualPairings = new Map<number, SubPlayerPairing>();
  private validationErrorAr: string | null = null;

  // Live wall-clock interval & hardware affordances
  private timerId: number | null = null;
  private vibrateEnabled = true;
  private wakeLockEnabled = false;
  private wakeLockSentinel: WakeLockSentinelLike | null = null;
  private wakeLockStatusAr = 'غير مفعّل';
  private mountContainers = new Set<HTMLElement>();
  private readonly boundVisibilityHandler: () => void;

  constructor(opts: PitWallControllerOptions) {
    this.opts = opts;
    const restored = this.loadSessionState();
    this.timerState =
      restored ||
      createDualMatchTimerState({
        matchDurationMinutes: 60,
        scheduleMode: 'interval',
        intervalMinutes: 10,
        manualMinutes: [12, 25, 38, 50],
      });

    this.boundVisibilityHandler = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        this.performTick(Date.now());
      }
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.boundVisibilityHandler);
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('focus', this.boundVisibilityHandler);
    }

    if (this.timerState.isRunning) {
      this.performTick(Date.now());
      if (this.timerState.isRunning) {
        this.ensureIntervalLoop();
      }
    }
  }

  private loadSessionState(): DualMatchTimerState | null {
    if (typeof window === 'undefined' || !window.sessionStorage) return null;
    try {
      const raw = window.sessionStorage.getItem(SESSION_TIMER_STORAGE_KEY);
      return deserializeDualMatchTimerState(raw);
    } catch {
      return null;
    }
  }

  private saveSessionState(): void {
    if (typeof window === 'undefined' || !window.sessionStorage) return;
    try {
      window.sessionStorage.setItem(
        SESSION_TIMER_STORAGE_KEY,
        serializeDualMatchTimerState(this.timerState)
      );
    } catch {
      // Ignore storage quota errors
    }
  }

  public getTimerState(): DualMatchTimerState {
    return this.timerState;
  }

  public getElapsedSeconds(): number {
    const tick = tickDualMatchTimer(this.timerState, Date.now());
    return tick.elapsedSec;
  }

  public getFormattedElapsed(): string {
    const tick = tickDualMatchTimer(this.timerState, Date.now());
    return formatMatchClock(tick.elapsedSec);
  }

  public getFormattedRemainingOrElapsed(): string {
    const tick = tickDualMatchTimer(this.timerState, Date.now());
    return formatMatchClock(tick.remainingSec);
  }

  public isRunning(): boolean {
    return this.timerState.isRunning;
  }

  public toggleTimer(): void {
    if (this.timerState.isRunning) {
      this.pauseMatchTimer();
    } else {
      this.startMatchTimer();
    }
  }

  public resetTimer(): void {
    this.resetMatchTimer();
    this.renderAllMounts();
  }

  /**
   * Resets the in-memory and sessionStorage match timer cleanly during logout or account/team switch
   * so an active or paused match clock never leaks across accounts on a shared device.
   */
  public resetTimerForSessionCleanup(): void {
    this.clearIntervalLoop();
    void this.releaseWakeLock();
    this.timerState = createDualMatchTimerState({
      matchDurationMinutes: 60,
      scheduleMode: 'interval',
      intervalMinutes: 10,
      manualMinutes: [12, 25, 38, 50],
    });
    this.plan = null;
    this.validationErrorAr = null;
    if (typeof window !== 'undefined' && window.sessionStorage) {
      try {
        window.sessionStorage.removeItem(SESSION_TIMER_STORAGE_KEY);
      } catch {
        // Ignore storage error
      }
    }
    this.broadcastClockTick(0, this.timerState.matchDurationMinutes * 60);
    this.renderAllMounts();
  }

  private broadcastClockTick(elapsedSec: number, remainingSec: number): void {
    if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
    try {
      window.dispatchEvent(
        new CustomEvent('maydan:matchClockTick', {
          detail: {
            elapsedSec,
            remainingSec,
            formattedElapsed: formatMatchClock(elapsedSec),
            formattedRemaining: formatMatchClock(remainingSec),
            isRunning: this.timerState.isRunning,
            isPaused: this.timerState.isPaused,
            matchEnded: this.timerState.matchEnded,
            matchDurationMinutes: this.timerState.matchDurationMinutes,
          },
        })
      );
    } catch {
      // Ignore CustomEvent dispatch errors in restricted environments
    }
  }

  /**
   * Deterministic time-advance helper for testing and verification without waiting real minutes.
   */
  public fastForwardSeconds(seconds: number): void {
    const deltaMs = Math.max(0, Number(seconds) || 0) * 1000;
    const now = Date.now();
    if (this.timerState.isRunning && this.timerState.runningSinceMs !== null) {
      this.timerState = {
        ...this.timerState,
        runningSinceMs: this.timerState.runningSinceMs - deltaMs,
      };
    } else {
      this.timerState = {
        ...this.timerState,
        accumulatedElapsedMs: this.timerState.accumulatedElapsedMs + deltaMs,
      };
    }
    this.performTick(now);
  }

  private buildPairingsMapFromPlan(plan: PitWallRotationPlan): Map<number, SubPlayerPairing> {
    const map = new Map<number, SubPlayerPairing>();
    for (const ev of plan.events) {
      if (!map.has(ev.minute)) {
        map.set(ev.minute, {
          outPlayerId: ev.outPlayerId,
          outPlayerName: ev.outPlayerName,
          inPlayerId: ev.inPlayerId,
          inPlayerName: ev.inPlayerName,
          roleLabel: ev.roleLabel,
          reasonAr: ev.reasonAr,
        });
      }
    }
    for (const [min, custom] of this.customManualPairings.entries()) {
      map.set(min, custom);
    }
    return map;
  }

  private ensurePlan(forceRegenerate = false): PitWallRotationPlan {
    const players = this.opts.getPlayers() || [];
    const startersCount = this.opts.getStartersCount();
    const matchMinutes = this.timerState.matchDurationMinutes;
    const scheduleMinutes = this.timerState.slots.map((s) => s.originalMinute);

    if (
      forceRegenerate ||
      !this.plan ||
      this.plan.startersCount !== startersCount ||
      this.plan.matchMinutes !== matchMinutes ||
      this.plan.style !== this.style
    ) {
      this.plan = generatePitWallPlan(players, {
        matchMinutes,
        startersCount,
        style: this.style,
        readinessLogs: this.opts.getReadiness(),
        customScheduleMinutes: scheduleMinutes,
      });
      if (this.plan.fatigueTracks.length && !this.selectedTrackPlayerId) {
        const firstOut =
          this.plan.fatigueTracks.find((t) => !t.isGk) || this.plan.fatigueTracks[0];
        this.selectedTrackPlayerId = firstOut.playerId;
      }
    }

    const pairings = this.buildPairingsMapFromPlan(this.plan);
    this.timerState = {
      ...this.timerState,
      slots: buildScheduledSubSlots(
        this.timerState.matchDurationMinutes,
        this.timerState.scheduleMode,
        this.timerState.intervalMinutes,
        this.timerState.manualMinutes,
        this.timerState.slots,
        pairings
      ),
    };

    return this.plan;
  }

  public syncRoster(): void {
    this.plan = null;
  }

  public dispose(): void {
    this.clearIntervalLoop();
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.boundVisibilityHandler);
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('focus', this.boundVisibilityHandler);
    }
    void this.releaseWakeLock();
  }

  private playAlertSoundAndHaptics(kind: 'sub' | 'match_end'): void {
    if (
      this.vibrateEnabled &&
      typeof navigator !== 'undefined' &&
      typeof navigator.vibrate === 'function'
    ) {
      try {
        navigator.vibrate(kind === 'match_end' ? [280, 100, 280, 100, 340] : [220, 90, 220]);
      } catch {
        // Ignore blocked vibration
      }
    }
    try {
      const ac = getSharedAudioContext();
      if (ac) {
        const osc = ac.createOscillator();
        const gain = ac.createGain();
        osc.type = 'sine';
        if (kind === 'match_end') {
          osc.frequency.setValueAtTime(880, ac.currentTime);
          osc.frequency.setValueAtTime(660, ac.currentTime + 0.16);
          osc.frequency.setValueAtTime(990, ac.currentTime + 0.32);
          gain.gain.setValueAtTime(0.14, ac.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.65);
          osc.connect(gain);
          gain.connect(ac.destination);
          osc.start();
          osc.stop(ac.currentTime + 0.68);
        } else {
          osc.frequency.setValueAtTime(740, ac.currentTime);
          osc.frequency.exponentialRampToValueAtTime(980, ac.currentTime + 0.18);
          gain.gain.setValueAtTime(0.12, ac.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.45);
          osc.connect(gain);
          gain.connect(ac.destination);
          osc.start();
          osc.stop(ac.currentTime + 0.48);
        }
      }
    } catch {
      // Audio blocked or unsupported
    }
  }

  private performTick(nowMs: number = Date.now()): void {
    this.ensurePlan();
    const prevActiveAlertId = this.timerState.activeAlertSlotId;
    const prevMatchEnded = this.timerState.matchEnded;
    const tick = tickDualMatchTimer(this.timerState, nowMs);
    this.timerState = tick.state;
    this.saveSessionState();

    for (const alert of tick.newlyTriggeredAlerts) {
      if (alert.type === 'substitution') {
        this.playAlertSoundAndHaptics('sub');
        const pairTxt = alert.slot.pairing
          ? ` — دخول ${alert.slot.pairing.inPlayerName} ⇄ خروج ${alert.slot.pairing.outPlayerName}`
          : '';
        this.opts.toast(
          `⏱️ حان موعد التبديل (الدقيقة ${alert.slot.effectiveMinute}')${pairTxt}`
        );
      } else if (alert.type === 'match_end') {
        this.clearIntervalLoop();
        this.playAlertSoundAndHaptics('match_end');
        this.opts.toast(
          `🏁 انتهى وقت المباراة (${alert.matchDurationMinutes} دقيقة) ✓`
        );
      }
    }

    this.opts.onTimerDisplaySync?.(
      formatMatchClock(tick.remainingSec),
      this.timerState.isRunning
    );
    this.broadcastClockTick(tick.elapsedSec, tick.remainingSec);

    if (
      tick.newlyTriggeredAlerts.length > 0 ||
      prevActiveAlertId !== this.timerState.activeAlertSlotId ||
      prevMatchEnded !== this.timerState.matchEnded
    ) {
      this.renderAllMounts();
    } else {
      this.updateLiveClockDom(tick.elapsedSec, tick.remainingSec, tick.totalDurationSec, tick.progressPct);
    }
  }

  private ensureIntervalLoop(): void {
    if (this.timerId !== null) return;
    this.timerId = window.setInterval(() => {
      this.performTick(Date.now());
    }, 250);
  }

  private clearIntervalLoop(): void {
    if (this.timerId !== null) {
      window.clearInterval(this.timerId);
      this.timerId = null;
    }
  }

  private startMatchTimer(): void {
    this.validationErrorAr = null;
    this.timerState = startOrResumeDualMatchTimer(this.timerState, Date.now());
    this.saveSessionState();
    this.ensureIntervalLoop();
    this.performTick(Date.now());
    this.renderAllMounts();
  }

  private pauseMatchTimer(): void {
    this.timerState = pauseDualMatchTimer(this.timerState, Date.now());
    this.clearIntervalLoop();
    this.saveSessionState();
    this.performTick(Date.now());
    this.renderAllMounts();
  }

  private resetMatchTimer(): void {
    this.clearIntervalLoop();
    const plan = this.ensurePlan();
    const pairings = this.buildPairingsMapFromPlan(plan);
    this.timerState = resetDualMatchTimer(this.timerState, pairings);
    this.validationErrorAr = null;
    this.saveSessionState();
    const totalSec = this.timerState.matchDurationMinutes * 60;
    this.opts.onTimerDisplaySync?.(
      formatMatchClock(totalSec),
      false
    );
    this.broadcastClockTick(0, totalSec);
  }

  private async requestWakeLock(): Promise<void> {
    const nav = navigator as unknown as {
      wakeLock?: { request: (t: 'screen') => Promise<WakeLockSentinelLike> };
    };
    if (!nav.wakeLock || typeof nav.wakeLock.request !== 'function') {
      this.wakeLockEnabled = false;
      this.wakeLockStatusAr = 'غير مدعوم في هذا المتصفح';
      this.renderAllMounts();
      return;
    }
    try {
      this.wakeLockSentinel = await nav.wakeLock.request('screen');
      this.wakeLockEnabled = true;
      this.wakeLockStatusAr = 'مفعّل (الشاشة تبقى مضاءة)';
      this.wakeLockSentinel.addEventListener?.('release', () => {
        this.wakeLockEnabled = false;
        this.wakeLockStatusAr = 'تم إيقافه تلقائياً';
        this.renderAllMounts();
      });
    } catch {
      this.wakeLockEnabled = false;
      this.wakeLockStatusAr = 'تعذّر التفعيل (قيود الجهاز)';
    }
    this.renderAllMounts();
  }

  private async releaseWakeLock(): Promise<void> {
    if (this.wakeLockSentinel && !this.wakeLockSentinel.released) {
      try {
        await this.wakeLockSentinel.release();
      } catch {
        // Ignore release error
      }
    }
    this.wakeLockSentinel = null;
    this.wakeLockEnabled = false;
    this.wakeLockStatusAr = 'غير مفعّل';
  }

  private pruneMounts(): void {
    for (const c of Array.from(this.mountContainers)) {
      if (!c.isConnected) {
        this.mountContainers.delete(c);
      }
    }
  }

  private renderAllMounts(): void {
    this.pruneMounts();
    for (const container of this.mountContainers) {
      this.renderIntoContainer(container);
    }
  }

  private buildNextSubInnerHtml(): string {
    const totalSec = this.timerState.matchDurationMinutes * 60;
    const tick = tickDualMatchTimer(this.timerState, Date.now());
    if (this.timerState.matchEnded || tick.elapsedSec >= totalSec) {
      return `<div style="font-size:0.78rem;color:#4ade80;font-weight:800;">🏁 انتهت المباراة (${this.timerState.matchDurationMinutes} دقيقة) — لا توجد تبديلات قادمة.</div>`;
    }

    const next = getNextScheduledSub(this.timerState, Date.now());
    if (!next) {
      return `<div class="muted" style="font-size:0.76rem;">${
        this.timerState.slots.length
          ? '✅ اكتملت جميع التبديلات المجدولة قبل نهاية المباراة.'
          : 'ℹ️ لا توجد مواعيد تبديل مجدولة قبل نهاية المباراة.'
      }</div>`;
    }

    const slot = next.slot;
    const postponedBadge = next.isPostponed
      ? `<span class="pw-postponed-tag" data-testid="pw-next-postponed-badge">⏳ مؤجّل +${slot.totalSnoozeMinutes} د (الأصلي: د${slot.originalMinute})</span>`
      : '';

    const pairingHtml = slot.pairing
      ? `<div style="font-size:0.8rem;margin-top:5px;">
           🟢 دخول <strong style="color:#4ade80;">${escapeHtml(slot.pairing.inPlayerName)}</strong>
           ⇄ 🔴 خروج <strong style="color:#fb7185;">${escapeHtml(slot.pairing.outPlayerName)}</strong>
         </div>`
      : '';

    return `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
          <span style="font-size:0.8rem;color:#fde047;font-weight:900;">🔔 التبديل القادم (د${slot.effectiveMinute}):</span>
          ${postponedBadge}
        </div>
        <span dir="ltr" data-testid="pw-next-countdown" style="font-size:0.86rem;font-weight:900;color:#fff;font-variant-numeric:tabular-nums;">
          ${next.isDueNow ? 'حان الآن!' : `بعد ${formatMatchClock(next.secondsUntil)}`}
        </span>
      </div>
      ${pairingHtml}
    `;
  }

  private updateLiveClockDom(
    elapsedSec?: number,
    remainingSec?: number,
    totalDurationSec?: number,
    progressPct?: number
  ): void {
    this.pruneMounts();
    const tick =
      typeof elapsedSec === 'number' &&
      typeof remainingSec === 'number' &&
      typeof totalDurationSec === 'number' &&
      typeof progressPct === 'number'
        ? { elapsedSec, remainingSec, totalDurationSec, progressPct }
        : tickDualMatchTimer(this.timerState, Date.now());

    const elapsedStr = formatMatchClock(tick.elapsedSec);
    const remainingStr = formatMatchClock(tick.remainingSec);
    const totalStr = formatMatchClock(tick.totalDurationSec);

    for (const container of this.mountContainers) {
      const elapsedEl = container.querySelector('[data-pw-elapsed]');
      if (elapsedEl) elapsedEl.textContent = elapsedStr;

      const remEl = container.querySelector('[data-pw-remaining]');
      if (remEl) remEl.textContent = remainingStr;

      const durEl = container.querySelector('[data-pw-duration]');
      if (durEl) durEl.textContent = totalStr;

      const legacyClockEl = container.querySelector('#pitWallClockDisplay');
      if (legacyClockEl) {
        legacyClockEl.textContent = `${elapsedStr} / ${totalStr}`;
      }

      const barFill = container.querySelector<HTMLElement>('[data-pw-progress-fill]');
      if (barFill) {
        barFill.style.width = `${tick.progressPct.toFixed(1)}%`;
      }

      const toggleBtn = container.querySelector<HTMLButtonElement>('#btnPitWallToggle');
      if (toggleBtn) {
        toggleBtn.textContent = this.timerState.isRunning
          ? '⏸ إيقاف مؤقت'
          : this.timerState.isPaused
            ? '▶ استئناف المباراة'
            : '▶ بدء المباراة';
      }

      const nextBox = container.querySelector('#pitWallNextSubBox');
      if (nextBox) {
        nextBox.innerHTML = this.buildNextSubInnerHtml();
      }
    }
  }

  private buildActiveAlertHtml(): string {
    if (this.timerState.matchEnded && this.timerState.matchEndBannerOpen) {
      return `
        <div class="pw-smart-alert pw-smart-alert--ended" role="status" data-testid="pw-match-end-banner">
          <div class="row between" style="gap:8px;flex-wrap:wrap;">
            <div>
              <div style="font-weight:900;font-size:0.88rem;color:#4ade80;">🏁 انتهى وقت المباراة (${this.timerState.matchDurationMinutes} دقيقة)</div>
              <div class="muted" style="font-size:0.74rem;margin-top:2px;">تم إيقاف ساعة المباراة تلقائياً وإلغاء أي تنبيهات تبديل لاحقة.</div>
            </div>
            <button type="button" data-pw-dismiss-end="1" class="tac-pill" style="min-height:34px;padding:4px 12px;font-size:0.75rem;">إغلاق الإشعار ✕</button>
          </div>
        </div>
      `;
    }

    const activeSlot = this.timerState.slots.find(
      (s) => s.id === this.timerState.activeAlertSlotId && s.status === 'active_alert'
    );
    if (!activeSlot) return '';

    const postponedNote =
      activeSlot.postponedCount > 0
        ? `<span class="pw-postponed-tag">مؤجّل من الدقيقة ${activeSlot.originalMinute}' (+${activeSlot.totalSnoozeMinutes} د)</span>`
        : '';

    const pairingHtml = activeSlot.pairing
      ? `<div style="font-size:0.82rem;margin-top:6px;padding:6px 8px;background:rgba(0,0,0,0.35);border-radius:8px;">
           🟢 دخول <strong style="color:#4ade80;">${escapeHtml(activeSlot.pairing.inPlayerName)}</strong>
           ⇄ 🔴 خروج <strong style="color:#fb7185;">${escapeHtml(activeSlot.pairing.outPlayerName)}</strong>
         </div>`
      : '';

    return `
      <div class="pw-smart-alert" role="alert" data-testid="pw-active-sub-alert" data-alert-minute="${activeSlot.effectiveMinute}" data-original-minute="${activeSlot.originalMinute}">
        <div class="row between" style="gap:6px;flex-wrap:wrap;">
          <div style="font-weight:900;font-size:0.9rem;color:#fde047;">
            🔔 حان موعد التبديل الآن — الدقيقة <span dir="ltr">${activeSlot.effectiveMinute}'</span>
          </div>
          ${postponedNote}
        </div>
        ${pairingHtml}
        <div class="pw-alert-actions" style="margin-top:10px;">
          <button type="button" id="btnPwConfirmSub" data-pw-confirm-slot="${escapeHtml(activeSlot.id)}" class="btn-emerald pw-alert-confirm-btn">
            ✓ تأكيد التبديل
          </button>
          <div class="pw-snooze-group" role="group" aria-label="تأجيل التبديل">
            <span class="pw-snooze-label">⏳ تأجيل:</span>
            ${SNOOZE_DELAY_OPTIONS.map(
              (d) =>
                `<button type="button" data-pw-snooze="${d}" data-pw-snooze-slot="${escapeHtml(activeSlot.id)}" class="pw-snooze-btn">+${d} د</button>`
            ).join('')}
          </div>
        </div>
      </div>
    `;
  }

  private buildFatigueSvg(plan: PitWallRotationPlan): string {
    if (!plan.fatigueTracks.length) {
      return '<div class="muted" style="font-size:0.75rem;">لا يوجد لاعبون متاحون لرسم منحنى الإجهاد التقديري.</div>';
    }
    const W = 320;
    const H = 128;
    const padL = 28;
    const padR = 10;
    const padT = 12;
    const padB = 22;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;
    const maxMin = Math.max(10, plan.matchMinutes);

    const xOf = (m: number) => padL + (m / maxMin) * plotW;
    const yOf = (fatigue: number) => padT + (1 - Math.max(0, Math.min(100, fatigue)) / 100) * plotH;

    const gridLines = [25, 50, 75]
      .map(
        (v) =>
          `<line x1="${padL}" y1="${yOf(v).toFixed(1)}" x2="${W - padR}" y2="${yOf(v).toFixed(1)}" stroke="rgba(255,255,255,0.08)" stroke-dasharray="3 3"/>
           <text x="${padL - 4}" y="${(yOf(v) + 3).toFixed(1)}" text-anchor="end" fill="#94a3b8" font-size="8">${v}%</text>`
      )
      .join('');

    const tracksSvg = plan.fatigueTracks
      .map((tr) => {
        const isSel = tr.playerId === this.selectedTrackPlayerId;
        const pts = tr.points
          .map((p) => `${xOf(p.minute).toFixed(1)},${yOf(p.fatiguePct).toFixed(1)}`)
          .join(' ');
        const stroke = isSel ? '#facc15' : tr.isGk ? 'rgba(56,189,248,0.45)' : 'rgba(226,232,240,0.28)';
        const width = isSel ? 2.6 : 1.25;
        return `<polyline fill="none" stroke="${stroke}" stroke-width="${width}" stroke-linejoin="round" points="${pts}" />`;
      })
      .join('');

    const selTrack =
      plan.fatigueTracks.find((t) => t.playerId === this.selectedTrackPlayerId) ||
      plan.fatigueTracks[0];

    return `
      <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block;background:#090b10;border-radius:10px;border:1px solid rgba(250,204,21,0.18);" role="img" aria-label="منحنى الإجهاد التقديري">
        ${gridLines}
        ${tracksSvg}
        <text x="${padL}" y="${H - 6}" fill="#94a3b8" font-size="8.5">0 د</text>
        <text x="${W / 2}" y="${H - 6}" text-anchor="middle" fill="#94a3b8" font-size="8.5">${Math.round(maxMin / 2)} د</text>
        <text x="${W - padR}" y="${H - 6}" text-anchor="end" fill="#94a3b8" font-size="8.5">${maxMin} د</text>
      </svg>
      <div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:6px;">
        ${plan.fatigueTracks
          .map(
            (t) => `<button type="button" data-pw-track="${escapeHtml(t.playerId)}" class="tac-pill ${
              t.playerId === selTrack.playerId ? 'active' : ''
            }" style="font-size:0.7rem;padding:3px 8px;">${escapeHtml(t.playerName)} (${t.plannedMinutes}د)</button>`
          )
          .join('')}
      </div>
      <div class="muted" style="font-size:0.72rem;margin-top:5px;">
        اللاعب المحدّد: <strong style="color:#facc15;">${escapeHtml(selTrack.playerName)}</strong> •
        دقائق مخططة: <strong>${selTrack.plannedMinutes} د</strong> •
        ذروة الجهد التقديرية: <strong>${selTrack.peakFatiguePct}%</strong>
      </div>
    `;
  }

  private renderScheduleRowHtml(slot: ScheduledSubSlot, allRoster: Array<{ id: string; name: string }>): string {
    const isEditing = this.editingSlotOriginalMin === slot.originalMinute;
    const maxMin = Math.max(1, this.timerState.matchDurationMinutes - 1);

    if (isEditing) {
      const playerOptionsHtml = (selectedId?: string) =>
        allRoster
          .map(
            (p) =>
              `<option value="${escapeHtml(p.id)}" ${p.id === selectedId ? 'selected' : ''}>${escapeHtml(p.name)}</option>`
          )
          .join('');

      return `
        <div class="pw-slot-edit-card" data-testid="pw-slot-edit-box">
          <div style="font-size:0.75rem;font-weight:800;color:#fde047;margin-bottom:6px;">
            ✏️ تعديل موعد التبديل (الدقيقة الأصلية: د${slot.originalMinute})
          </div>
          <div class="pw-slot-edit-grid">
            <div>
              <label class="muted" style="font-size:0.68rem;display:block;margin-bottom:2px;">الدقيقة (1–${maxMin})</label>
              <input type="number" id="pwEditSlotMinInput" min="1" max="${maxMin}" value="${slot.originalMinute}" style="padding:6px 8px;font-size:0.8rem;" />
            </div>
            ${
              allRoster.length >= 2
                ? `<div>
                     <label class="muted" style="font-size:0.68rem;display:block;margin-bottom:2px;">🟢 دخول</label>
                     <select id="pwEditIn" style="padding:6px;font-size:0.76rem;">${playerOptionsHtml(slot.pairing?.inPlayerId)}</select>
                   </div>
                   <div>
                     <label class="muted" style="font-size:0.68rem;display:block;margin-bottom:2px;">🔴 خروج</label>
                     <select id="pwEditOut" style="padding:6px;font-size:0.76rem;">${playerOptionsHtml(slot.pairing?.outPlayerId)}</select>
                   </div>`
                : ''
            }
          </div>
          <div class="row" style="gap:6px;margin-top:8px;">
            <button type="button" data-pw-save-slot="${slot.originalMinute}" class="btn-primary" style="min-height:34px;padding:4px 12px;font-size:0.76rem;">✓ حفظ التعديل</button>
            <button type="button" id="btnPwCancelSlotEdit" style="min-height:34px;padding:4px 12px;font-size:0.76rem;">إلغاء</button>
          </div>
        </div>
      `;
    }

    let statusBadge = `<span class="pw-slot-status pw-slot-status--pending">⏱️ بالانتظار</span>`;
    if (slot.status === 'confirmed') {
      statusBadge = `<span class="pw-slot-status pw-slot-status--confirmed">✅ تم التنفيذ</span>`;
    } else if (slot.status === 'active_alert') {
      statusBadge = `<span class="pw-slot-status pw-slot-status--active">🔔 حان الآن</span>`;
    } else if (slot.status === 'snoozed') {
      statusBadge = `<span class="pw-slot-status pw-slot-status--snoozed">⏳ مؤجّل (+${slot.totalSnoozeMinutes} د)</span>`;
    }

    const timeLabelHtml =
      slot.postponedCount > 0
        ? `<span style="color:var(--primary);font-weight:900;">د${slot.effectiveMinute}</span>
           <span class="pw-postponed-inline" data-testid="pw-slot-postponed-label">(الأصل د${slot.originalMinute} • تأجيل +${slot.totalSnoozeMinutes}د)</span>`
        : `<span style="color:var(--primary);font-weight:900;">د${slot.originalMinute}</span>`;

    const pairingHtml = slot.pairing
      ? `<span style="font-size:0.76rem;"> • 🟢 ${escapeHtml(slot.pairing.inPlayerName)} ⇄ 🔴 ${escapeHtml(slot.pairing.outPlayerName)}</span>`
      : '';

    return `
      <div class="pw-schedule-row ${slot.status === 'confirmed' ? 'is-confirmed' : ''}" data-testid="pw-schedule-slot" data-slot-orig-min="${slot.originalMinute}" data-slot-eff-min="${slot.effectiveMinute}" data-slot-status="${slot.status}">
        <div class="pw-schedule-row-main">
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
            ${timeLabelHtml}
            ${statusBadge}
          </div>
          ${pairingHtml ? `<div style="margin-top:2px;">${pairingHtml}</div>` : ''}
        </div>
        <div class="pw-schedule-row-actions">
          ${
            slot.status !== 'confirmed'
              ? `<button type="button" data-pw-confirm-slot="${escapeHtml(slot.id)}" class="icon-btn" style="min-height:30px;padding:2px 8px;font-size:0.72rem;color:#4ade80;border-color:rgba(74,222,128,0.3);" title="تأكيد تنفيذ هذا التبديل">✓</button>`
              : ''
          }
          <button type="button" data-pw-edit-slot="${slot.originalMinute}" class="icon-btn" style="min-height:30px;padding:2px 8px;font-size:0.72rem;" title="تعديل الدقيقة أو اللاعبين">✏️</button>
          ${
            this.timerState.scheduleMode === 'manual'
              ? `<button type="button" data-pw-del-slot="${slot.originalMinute}" class="icon-btn" style="min-height:30px;padding:2px 8px;font-size:0.72rem;color:#fda4af;border-color:rgba(244,63,94,0.3);" title="حذف موعد التبديل">🗑️</button>`
              : ''
          }
        </div>
      </div>
    `;
  }

  public render(container: HTMLElement): void {
    this.mountContainers.add(container);
    this.renderIntoContainer(container);
  }

  private renderIntoContainer(container: HTMLElement): void {
    const plan = this.ensurePlan();
    const allRoster = [...plan.starters, ...plan.bench];
    const tick = tickDualMatchTimer(this.timerState, Date.now());
    const durMin = this.timerState.matchDurationMinutes;
    const isCustomDuration = !(MATCH_DURATION_PRESETS as readonly number[]).includes(durMin);
    const isCustomInterval = !(SUB_INTERVAL_PRESETS as readonly number[]).includes(
      this.timerState.intervalMinutes
    );

    let statusBadgeText = 'جاهز للبدء';
    let statusBadgeColor = 'rgba(242, 214, 117, 0.9)';
    if (this.timerState.matchEnded) {
      statusBadgeText = '🏁 انتهت المباراة';
      statusBadgeColor = '#4ade80';
    } else if (this.timerState.isRunning) {
      statusBadgeText = '🟢 المباراة جارية';
      statusBadgeColor = '#4ade80';
    } else if (this.timerState.isPaused) {
      statusBadgeText = '⏸ متوقفة مؤقتاً';
      statusBadgeColor = '#fde047';
    }

    const timelineMarkersHtml = this.timerState.slots
      .filter((s) => s.effectiveTriggerSec < durMin * 60)
      .map((s) => {
        const pct = Math.min(99, Math.max(1, (s.effectiveTriggerSec / (durMin * 60)) * 100));
        const cls =
          s.status === 'confirmed'
            ? 'is-confirmed'
            : s.status === 'active_alert'
              ? 'is-active'
              : s.status === 'snoozed'
                ? 'is-snoozed'
                : '';
        return `<span class="pw-timeline-marker ${cls}" style="inset-inline-start:${pct.toFixed(1)}%;" title="تبديل د${s.effectiveMinute}"></span>`;
      })
      .join('');

    container.innerHTML = `
      <!-- 1) UNIFIED MATCH CLOCK & CONTROLS -->
      <div class="item-box pw-clock-card" style="border-color:rgba(212,175,55,0.45);margin-bottom:10px;">
        <div class="row between" style="margin-bottom:8px;gap:8px;flex-wrap:wrap;">
          <div>
            <div style="font-weight:900;color:var(--primary);font-size:0.9rem;">⏱️ ساعة المباراة ونظام التبديلات المزدوج</div>
            <div class="muted" style="font-size:0.71rem;">ساعة موحّدة عالية الدقة — تعمل بدون انحراف حتى مع قفل الشاشة</div>
          </div>
          <span id="pitWallStatusBadge" class="badge" style="color:${statusBadgeColor};font-size:0.73rem;">${statusBadgeText}</span>
        </div>

        <!-- 3-Metric Clock Readout: Elapsed / Remaining / Duration -->
        <div class="pw-clock-metrics-grid">
          <div class="pw-clock-metric-cell">
            <span class="pw-clock-metric-lbl">الوقت المنقضي</span>
            <strong id="pitWallElapsedDisplay" data-pw-elapsed dir="ltr" class="pw-clock-metric-val">${formatMatchClock(tick.elapsedSec)}</strong>
          </div>
          <div class="pw-clock-metric-cell pw-clock-metric-cell--primary">
            <span class="pw-clock-metric-lbl">الوقت المتبقي</span>
            <strong id="pitWallRemainingDisplay" data-pw-remaining dir="ltr" class="pw-clock-metric-val pw-clock-metric-val--gold">${formatMatchClock(tick.remainingSec)}</strong>
          </div>
          <div class="pw-clock-metric-cell">
            <span class="pw-clock-metric-lbl">مدة المباراة (${durMin} د)</span>
            <strong id="pitWallDurationDisplay" data-pw-duration dir="ltr" class="pw-clock-metric-val">${formatMatchClock(tick.totalDurationSec)}</strong>
          </div>
        </div>
        <!-- Preserved legacy combined clock selector -->
        <div id="pitWallClockDisplay" class="hidden" dir="ltr">${formatMatchClock(tick.elapsedSec)} / ${formatMatchClock(tick.totalDurationSec)}</div>

        <!-- Timeline Progress Bar with Substitution Markers -->
        <div class="pw-timeline-track" dir="ltr" aria-label="شريط تقدم المباراة ومواقع التبديلات">
          <div class="pw-timeline-fill" data-pw-progress-fill style="width:${tick.progressPct.toFixed(1)}%;"></div>
          ${timelineMarkersHtml}
        </div>

        <!-- Active Substitution Alert or Match End Notification Banner -->
        <div id="pitWallActiveAlertHost">${this.buildActiveAlertHtml()}</div>

        <!-- Next Substitution Live Box -->
        <div id="pitWallNextSubBox" class="pw-next-sub-box">${this.buildNextSubInnerHtml()}</div>

        <!-- Primary Match Controls -->
        <div class="grid-2" style="gap:8px;margin-bottom:8px;">
          <button type="button" id="btnPitWallToggle" class="btn-primary" style="min-height:44px;font-size:0.84rem;font-weight:900;">${
            this.timerState.isRunning
              ? '⏸ إيقاف مؤقت'
              : this.timerState.isPaused
                ? '▶ استئناف المباراة'
                : '▶ بدء المباراة'
          }</button>
          <button type="button" id="btnPitWallReset" style="min-height:44px;font-size:0.82rem;font-weight:800;">↻ تصفير المؤقّت</button>
        </div>

        <div class="row between" style="gap:8px;flex-wrap:wrap;font-size:0.74rem;align-items:center;">
          <label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;white-space:nowrap;">
            <input type="checkbox" id="chkPitWallVibrate" style="width:auto;margin:0;accent-color:#facc15;" ${this.vibrateEnabled ? 'checked' : ''} />
            <span>اهتزاز وصوت عند التبديل</span>
          </label>
          <button type="button" id="btnPitWallWakeLock" class="tac-pill ${this.wakeLockEnabled ? 'active' : ''}" style="font-size:0.72rem;white-space:nowrap;">
            ☀️ إبقاء الشاشة مضاءة (<span id="pitWallWakeStatus">${escapeHtml(this.wakeLockStatusAr)}</span>)
          </button>
        </div>
      </div>

      ${
        this.validationErrorAr
          ? `<div class="alert-danger" role="alert" data-testid="pw-validation-error" style="margin-bottom:10px;padding:9px 12px;font-size:0.78rem;">⚠️ ${escapeHtml(this.validationErrorAr)}</div>`
          : ''
      }

      <!-- 2) INDEPENDENT MATCH DURATION CONTROLS -->
      <div class="item-box" style="margin-bottom:10px;">
        <div class="row between" style="margin-bottom:6px;gap:6px;flex-wrap:wrap;">
          <strong style="font-size:0.84rem;color:#f8fafc;">⏳ 1. مدة المباراة المستقلة</strong>
          <span class="badge" style="font-size:0.72rem;">الحالية: ${durMin} دقيقة</span>
        </div>
        <div class="row" style="gap:6px;flex-wrap:wrap;margin-bottom:8px;">
          ${MATCH_DURATION_PRESETS.map(
            (m) =>
              `<button type="button" data-pw-min="${m}" class="tac-pill ${durMin === m ? 'active' : ''}" style="min-height:36px;padding:6px 12px;">${m} د</button>`
          ).join('')}
        </div>
        <div class="pw-custom-input-row">
          <input
            type="number"
            id="pwCustomDurationInput"
            min="1"
            max="240"
            value="${isCustomDuration ? durMin : ''}"
            placeholder="مدة مخصصة بالدقائق (مثلاً 47)"
            aria-label="مدة المباراة المخصصة بالدقائق"
          />
          <button type="button" id="btnPwApplyCustomDuration" class="tac-pill active" style="min-height:38px;padding:6px 14px;white-space:nowrap;">
            تطبيق المدة
          </button>
        </div>
      </div>

      <!-- 3) INDEPENDENT SUBSTITUTION SCHEDULING SYSTEM -->
      <div class="item-box" style="margin-bottom:10px;">
        <div class="row between" style="margin-bottom:8px;gap:6px;flex-wrap:wrap;">
          <strong style="font-size:0.84rem;color:#f8fafc;">🔄 2. نظام جدولة التبديلات المستقل</strong>
          <span class="badge" style="font-size:0.72rem;">${this.timerState.slots.length} تبديلات مجدولة</span>
        </div>

        <!-- Mode Switcher: Repeating Interval vs Manual Schedule -->
        <div class="pw-mode-seg" role="tablist" aria-label="نمط جدولة التبديلات">
          <button
            type="button"
            role="tab"
            aria-selected="${this.timerState.scheduleMode === 'interval'}"
            data-pw-sched-mode="interval"
            class="pw-mode-seg-btn ${this.timerState.scheduleMode === 'interval' ? 'active' : ''}"
          >
            🔁 تكرار دوري (كل X دقائق)
          </button>
          <button
            type="button"
            role="tab"
            aria-selected="${this.timerState.scheduleMode === 'manual'}"
            data-pw-sched-mode="manual"
            class="pw-mode-seg-btn ${this.timerState.scheduleMode === 'manual' ? 'active' : ''}"
          >
            📝 جدول يدوي مخصص
          </button>
        </div>

        ${
          this.timerState.scheduleMode === 'interval'
            ? `
              <div data-testid="pw-interval-panel" style="margin-top:10px;">
                <div class="muted" style="font-size:0.73rem;margin-bottom:6px;">اختر فترة التبديل الدوري (تُحسب المواعيد تلقائياً من بداية المباراة):</div>
                <div class="row" style="gap:6px;flex-wrap:wrap;margin-bottom:8px;">
                  ${SUB_INTERVAL_PRESETS.map(
                    (iv) =>
                      `<button type="button" data-pw-interval="${iv}" class="tac-pill ${
                        this.timerState.intervalMinutes === iv ? 'active' : ''
                      }" style="min-height:36px;padding:6px 11px;">كل ${iv} د</button>`
                  ).join('')}
                </div>
                <div class="pw-custom-input-row">
                  <input
                    type="number"
                    id="pwCustomIntervalInput"
                    min="1"
                    max="120"
                    value="${isCustomInterval ? this.timerState.intervalMinutes : ''}"
                    placeholder="فترة مخصصة بالدقائق (مثلاً 7)"
                    aria-label="فترة التبديل المخصصة بالدقائق"
                  />
                  <button type="button" id="btnPwApplyCustomInterval" class="tac-pill active" style="min-height:38px;padding:6px 14px;white-space:nowrap;">
                    تطبيق الفترة
                  </button>
                </div>
              </div>
            `
            : `
              <div data-testid="pw-manual-panel" style="margin-top:10px;">
                <div class="muted" style="font-size:0.73rem;margin-bottom:6px;">أضف أو عدّل أو احذف دقائق التبديل يدوياً (مثلاً: 12، 25، 38، 50):</div>
                <div class="pw-custom-input-row">
                  <input
                    type="number"
                    id="pwManualMinuteInput"
                    min="1"
                    max="${Math.max(1, durMin - 1)}"
                    placeholder="أدخل دقيقة التبديل (1 – ${Math.max(1, durMin - 1)})"
                    aria-label="إضافة دقيقة تبديل يدوية"
                  />
                  <button type="button" id="btnPwAddManualMinute" class="btn-primary" style="min-height:38px;padding:6px 14px;font-size:0.78rem;white-space:nowrap;">
                    ＋ إضافة موعد
                  </button>
                </div>
              </div>
            `
        }

        <!-- Active Schedule List -->
        <div style="font-weight:800;font-size:0.8rem;margin:12px 0 6px;color:#fde047;display:flex;justify-content:space-between;align-items:center;">
          <span>📋 جدول مواعيد التبديل (${this.timerState.scheduleMode === 'interval' ? `تكرار كل ${this.timerState.intervalMinutes} د` : 'يدوي مخصص'}):</span>
        </div>
        <div class="pw-schedule-list" data-testid="pw-schedule-list">
          ${
            this.timerState.slots.length
              ? this.timerState.slots.map((slot) => this.renderScheduleRowHtml(slot, allRoster)).join('')
              : `<div class="muted" style="font-size:0.75rem;padding:8px 0;">لا توجد مواعيد تبديل قبل الدقيقة ${durMin}. أضف موعداً أقل من مدة المباراة.</div>`
          }
        </div>
      </div>

      <!-- 4) TACTICAL PLAY STYLE & ESTIMATED FATIGUE CURVE -->
      <div class="item-box">
        <div class="row between" style="margin-bottom:6px;flex-wrap:wrap;gap:6px;">
          <strong style="font-size:0.82rem;color:var(--primary);">📉 3. تدوير اللاعبين ومنحنى الإجهاد (${plan.starters.length} أساسي • ${plan.bench.length} احتياط)</strong>
          <span class="badge" style="font-size:0.7rem;">فارق الدقائق: ${plan.fairnessSpreadMin} د</span>
        </div>
        <div style="margin-bottom:8px;">
          <div class="muted" style="font-size:0.72rem;margin-bottom:4px;">أسلوب اللعب (يحدّد منحنى الجهد والتعافي):</div>
          <div class="row" style="gap:5px;flex-wrap:wrap;">
            ${(['high_press', 'balanced', 'counter'] as TacticalPlayStyle[])
              .map(
                (st) =>
                  `<button type="button" data-pw-style="${st}" class="tac-pill ${this.style === st ? 'active' : ''}">${escapeHtml(STYLE_META[st].labelAr)}</button>`
              )
              .join('')}
          </div>
        </div>
        ${
          plan.excluded.length
            ? `<div class="muted" style="font-size:0.72rem;color:#fda4af;margin-bottom:6px;">⛔ استُبعد تلقائياً لعدم التوفر: ${plan.excluded
                .map((e) => escapeHtml(e.name))
                .join('، ')}</div>`
            : ''
        }
        ${this.buildFatigueSvg(plan)}
        <div class="muted" style="font-size:0.69rem;margin-top:6px;line-height:1.45;">ℹ️ ${escapeHtml(plan.disclaimerAr)}</div>
      </div>
    `;

    this.bindEvents(container);
  }

  private applyNewMatchDuration(rawVal: unknown): void {
    const check = validateMatchDurationMinutes(rawVal);
    if (!check.ok) {
      this.validationErrorAr = check.errorAr;
      this.opts.toast(check.errorAr, true);
      this.renderAllMounts();
      return;
    }
    this.validationErrorAr = null;
    this.editingSlotOriginalMin = null;
    this.timerState = setMatchDuration(this.timerState, check.minutes, undefined, Date.now());
    this.plan = null;
    this.ensurePlan(true);
    this.saveSessionState();
    this.renderAllMounts();
  }

  private applyNewSubInterval(rawVal: unknown): void {
    const check = validateSubIntervalMinutes(rawVal);
    if (!check.ok) {
      this.validationErrorAr = check.errorAr;
      this.opts.toast(check.errorAr, true);
      this.renderAllMounts();
      return;
    }
    this.validationErrorAr = null;
    this.editingSlotOriginalMin = null;
    this.timerState = setSubIntervalMinutes(this.timerState, check.minutes);
    this.plan = null;
    this.ensurePlan(true);
    this.saveSessionState();
    this.renderAllMounts();
  }

  private bindEvents(container: HTMLElement): void {
    container.querySelector('#btnPitWallToggle')?.addEventListener('click', () => {
      if (this.timerState.isRunning) this.pauseMatchTimer();
      else this.startMatchTimer();
    });

    container.querySelector('#btnPitWallReset')?.addEventListener('click', () => {
      this.resetMatchTimer();
      this.renderAllMounts();
    });

    container.querySelector('#chkPitWallVibrate')?.addEventListener('change', (e) => {
      this.vibrateEnabled = (e.target as HTMLInputElement).checked;
    });

    container.querySelector('#btnPitWallWakeLock')?.addEventListener('click', () => {
      if (this.wakeLockEnabled) {
        void this.releaseWakeLock().then(() => this.renderAllMounts());
      } else {
        void this.requestWakeLock();
      }
    });

    // Match Duration Presets & Custom Input
    container.querySelectorAll<HTMLButtonElement>('[data-pw-min]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.applyNewMatchDuration(btn.dataset.pwMin);
      });
    });

    container.querySelector('#btnPwApplyCustomDuration')?.addEventListener('click', () => {
      const inp = container.querySelector<HTMLInputElement>('#pwCustomDurationInput');
      this.applyNewMatchDuration(inp?.value);
    });

    container.querySelector<HTMLInputElement>('#pwCustomDurationInput')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.applyNewMatchDuration((e.currentTarget as HTMLInputElement).value);
      }
    });

    // Scheduling Mode Tabs (Interval vs Manual)
    container.querySelectorAll<HTMLButtonElement>('[data-pw-sched-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const mode = (btn.dataset.pwSchedMode as SubScheduleMode) || 'interval';
        this.validationErrorAr = null;
        this.editingSlotOriginalMin = null;
        this.timerState = setScheduleMode(this.timerState, mode);
        this.plan = null;
        this.ensurePlan(true);
        this.saveSessionState();
        this.renderAllMounts();
      });
    });

    // Repeating Interval Presets & Custom Input
    container.querySelectorAll<HTMLButtonElement>('[data-pw-interval]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.applyNewSubInterval(btn.dataset.pwInterval);
      });
    });

    container.querySelector('#btnPwApplyCustomInterval')?.addEventListener('click', () => {
      const inp = container.querySelector<HTMLInputElement>('#pwCustomIntervalInput');
      this.applyNewSubInterval(inp?.value);
    });

    container.querySelector<HTMLInputElement>('#pwCustomIntervalInput')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.applyNewSubInterval((e.currentTarget as HTMLInputElement).value);
      }
    });

    // Add Manual Substitution Minute
    const handleAddManual = () => {
      const inp = container.querySelector<HTMLInputElement>('#pwManualMinuteInput');
      const res = addManualSubMinute(this.timerState, inp?.value);
      if (!res.ok) {
        this.validationErrorAr = res.errorAr;
        this.opts.toast(res.errorAr, true);
        this.renderAllMounts();
        return;
      }
      this.validationErrorAr = null;
      this.timerState = res.state;
      this.plan = null;
      this.ensurePlan(true);
      this.saveSessionState();
      this.opts.toast('تمت إضافة موعد التبديل إلى الجدول ✓');
      this.renderAllMounts();
    };

    container.querySelector('#btnPwAddManualMinute')?.addEventListener('click', handleAddManual);
    container.querySelector<HTMLInputElement>('#pwManualMinuteInput')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleAddManual();
      }
    });

    // Confirm Substitution Action (from Active Alert Banner or Schedule Row)
    container.querySelectorAll<HTMLButtonElement>('[data-pw-confirm-slot]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const slotId = btn.dataset.pwConfirmSlot;
        this.timerState = confirmSubstitutionSlot(this.timerState, slotId, Date.now());
        this.saveSessionState();
        this.opts.toast('تم تأكيد تنفيذ التبديل ✓');
        this.renderAllMounts();
      });
    });

    // Snooze / Delay Substitution Action (+1m, +2m, +5m)
    container.querySelectorAll<HTMLButtonElement>('[data-pw-snooze]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const delayMin = Number(btn.dataset.pwSnooze || '2');
        const slotId = btn.dataset.pwSnoozeSlot || this.timerState.activeAlertSlotId;
        this.timerState = snoozeSubstitutionSlot(this.timerState, delayMin, slotId, Date.now());
        this.saveSessionState();
        this.opts.toast(`تم تأجيل التبديل بمقدار +${delayMin} د مع الحفاظ على الجدول الأصلي ⏳`);
        this.renderAllMounts();
      });
    });

    // Dismiss Match-End Banner
    container.querySelector('[data-pw-dismiss-end]')?.addEventListener('click', () => {
      this.timerState = {
        ...this.timerState,
        matchEndBannerOpen: false,
      };
      this.saveSessionState();
      this.renderAllMounts();
    });

    // Edit & Delete Individual Substitution Slots
    container.querySelectorAll<HTMLButtonElement>('[data-pw-edit-slot]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.validationErrorAr = null;
        this.editingSlotOriginalMin = Number(btn.dataset.pwEditSlot);
        this.renderAllMounts();
      });
    });

    container.querySelector('#btnPwCancelSlotEdit')?.addEventListener('click', () => {
      this.editingSlotOriginalMin = null;
      this.renderAllMounts();
    });

    container.querySelectorAll<HTMLButtonElement>('[data-pw-save-slot]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const origMin = Number(btn.dataset.pwSaveSlot);
        const newMinRaw = container.querySelector<HTMLInputElement>('#pwEditSlotMinInput')?.value;
        const inId = container.querySelector<HTMLSelectElement>('#pwEditIn')?.value;
        const outId = container.querySelector<HTMLSelectElement>('#pwEditOut')?.value;

        // If in interval mode and user edits an individual slot minute, switch cleanly to manual mode with current slots
        if (this.timerState.scheduleMode === 'interval') {
          const currentMins = this.timerState.slots.map((s) => s.originalMinute);
          this.timerState = {
            ...this.timerState,
            scheduleMode: 'manual',
            manualMinutes: currentMins,
          };
        }

        const editRes = editManualSubMinute(this.timerState, origMin, newMinRaw);
        if (!editRes.ok) {
          this.validationErrorAr = editRes.errorAr;
          this.opts.toast(editRes.errorAr, true);
          this.renderAllMounts();
          return;
        }

        const updatedMinute = Number(newMinRaw);
        this.timerState = editRes.state;

        // Also update player pairing if selected
        if (this.plan && inId && outId && inId !== outId) {
          const allPlayers = [...this.plan.starters, ...this.plan.bench];
          const inP = allPlayers.find((p) => p.id === inId);
          const outP = allPlayers.find((p) => p.id === outId);
          if (inP && outP) {
            this.customManualPairings.delete(origMin);
            this.customManualPairings.set(updatedMinute, {
              inPlayerId: inP.id,
              inPlayerName: inP.name,
              outPlayerId: outP.id,
              outPlayerName: outP.name,
              roleLabel: outP.primaryPos || 'ميدان',
              reasonAr: 'تعديل يدوي من الكابتن',
            });
            const matchingEv = this.plan.events.find((e) => e.minute === origMin || e.minute === updatedMinute);
            if (matchingEv) {
              this.plan = applyManualRotationEdit(this.plan, matchingEv.id, {
                minute: updatedMinute,
                inPlayerId: inId,
                outPlayerId: outId,
              });
            }
          }
        }

        this.editingSlotOriginalMin = null;
        this.validationErrorAr = null;
        this.plan = null;
        this.ensurePlan(true);
        this.saveSessionState();
        this.opts.toast('تم تحديث موعد التبديل وإعادة حساب الجدول ✓');
        this.renderAllMounts();
      });
    });

    container.querySelectorAll<HTMLButtonElement>('[data-pw-del-slot]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const minToDel = Number(btn.dataset.pwDelSlot);
        this.customManualPairings.delete(minToDel);
        this.timerState = deleteManualSubMinute(this.timerState, minToDel);
        this.editingSlotOriginalMin = null;
        this.validationErrorAr = null;
        this.plan = null;
        this.ensurePlan(true);
        this.saveSessionState();
        this.opts.toast(`تم حذف موعد الدقيقة ${minToDel}' من الجدول ✓`);
        this.renderAllMounts();
      });
    });

    // Tactical Play Style & Fatigue Track Pills
    container.querySelectorAll<HTMLButtonElement>('[data-pw-style]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.style = (btn.dataset.pwStyle as TacticalPlayStyle) || 'balanced';
        this.editingSlotOriginalMin = null;
        this.ensurePlan(true);
        this.renderAllMounts();
      });
    });

    container.querySelectorAll<HTMLButtonElement>('[data-pw-track]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.selectedTrackPlayerId = btn.dataset.pwTrack || null;
        this.renderAllMounts();
      });
    });
  }
}

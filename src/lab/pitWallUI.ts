import { escapeHtml } from '../security';
import type { MinimalPlayer, MinimalReadinessLog } from '../tacticsData';
import {
  STYLE_META,
  applyManualRotationEdit,
  generatePitWallPlan,
  getNextUpcomingSub,
  type PitWallRotationPlan,
  type TacticalPlayStyle,
} from '../engine/pitWallRotation';

export interface PitWallControllerOptions {
  getPlayers: () => MinimalPlayer[];
  getReadiness: () => MinimalReadinessLog[];
  getStartersCount: () => number;
  toast: (msg: string, isErr?: boolean) => void;
}

interface WakeLockSentinelLike {
  released?: boolean;
  release: () => Promise<void>;
  addEventListener?: (type: string, cb: () => void) => void;
}

/**
 * Pit-Wall Rotation Room Controller (Feature 05):
 * Upgrades the existing captain `rotate` tab with fair rotation planning,
 * estimated fatigue curves, manual captain edits, and Offline Pit Mode (timer, alerts, vibration, wake lock).
 */
export class PitWallRotationController {
  private opts: PitWallControllerOptions;
  private matchMinutes = 60;
  private style: TacticalPlayStyle = 'balanced';
  private plan: PitWallRotationPlan | null = null;
  private selectedTrackPlayerId: string | null = null;
  private editingEventId: string | null = null;

  // Offline Pit Mode live timer state
  private pitRunning = false;
  private elapsedSec = 0;
  private lastTickTs = 0;
  private timerId: number | null = null;
  private alertedEventIds = new Set<string>();
  private vibrateEnabled = true;
  private wakeLockEnabled = false;
  private wakeLockSentinel: WakeLockSentinelLike | null = null;
  private wakeLockStatusAr = 'غير مفعّل';
  private mountContainer: HTMLElement | null = null;

  constructor(opts: PitWallControllerOptions) {
    this.opts = opts;
  }

  private ensurePlan(forceRegenerate = false): PitWallRotationPlan {
    const players = this.opts.getPlayers() || [];
    const startersCount = this.opts.getStartersCount();
    if (
      forceRegenerate ||
      !this.plan ||
      this.plan.startersCount !== startersCount ||
      this.plan.matchMinutes !== this.matchMinutes ||
      this.plan.style !== this.style
    ) {
      this.plan = generatePitWallPlan(players, {
        matchMinutes: this.matchMinutes,
        startersCount,
        style: this.style,
        readinessLogs: this.opts.getReadiness(),
      });
      if (this.plan.fatigueTracks.length && !this.selectedTrackPlayerId) {
        const firstOut = this.plan.fatigueTracks.find((t) => !t.isGk) || this.plan.fatigueTracks[0];
        this.selectedTrackPlayerId = firstOut.playerId;
      }
    }
    return this.plan;
  }

  public syncRoster(): void {
    this.plan = null;
  }

  public dispose(): void {
    this.stopPitTimer();
    void this.releaseWakeLock();
  }

  private formatClock(sec: number): string {
    const s = Math.max(0, Math.floor(sec));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
  }

  private triggerSubAlert(outName: string, inName: string, minute: number): void {
    // 1) Optional vibration (safe check)
    if (this.vibrateEnabled && typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      try {
        navigator.vibrate([220, 90, 220]);
      } catch {
        // Ignore blocked vibration
      }
    }
    // 2) Gentle local Web Audio chime (safe try/catch)
    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        const ac = new AudioCtx();
        const osc = ac.createOscillator();
        const gain = ac.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(740, ac.currentTime);
        osc.frequency.exponentialRampToValueAtTime(980, ac.currentTime + 0.18);
        gain.gain.setValueAtTime(0.11, ac.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.45);
        osc.connect(gain);
        gain.connect(ac.destination);
        osc.start();
        osc.stop(ac.currentTime + 0.48);
      }
    } catch {
      // Audio blocked or unsupported
    }
    this.opts.toast(`⏱️ تنبيه تبديل (د${minute}): دخول ${inName} ⇄ خروج ${outName}`);
  }

  private async requestWakeLock(): Promise<void> {
    const nav = navigator as unknown as {
      wakeLock?: { request: (t: 'screen') => Promise<WakeLockSentinelLike> };
    };
    if (!nav.wakeLock || typeof nav.wakeLock.request !== 'function') {
      this.wakeLockEnabled = false;
      this.wakeLockStatusAr = 'غير مدعوم في هذا المتصفح';
      this.updateLiveClockDom();
      return;
    }
    try {
      this.wakeLockSentinel = await nav.wakeLock.request('screen');
      this.wakeLockEnabled = true;
      this.wakeLockStatusAr = 'مفعّل (الشاشة تبقى مضاءة)';
      this.wakeLockSentinel.addEventListener?.('release', () => {
        this.wakeLockEnabled = false;
        this.wakeLockStatusAr = 'تم إيقافه تلقائياً';
        this.updateLiveClockDom();
      });
    } catch {
      this.wakeLockEnabled = false;
      this.wakeLockStatusAr = 'تعذّر التفعيل (وضع توفير الطاقة أو قيود الجهاز)';
    }
    this.updateLiveClockDom();
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

  private startPitTimer(): void {
    if (this.pitRunning) return;
    this.pitRunning = true;
    this.lastTickTs = Date.now();
    this.timerId = window.setInterval(() => {
      const now = Date.now();
      const deltaSec = Math.max(0, Math.round((now - this.lastTickTs) / 1000));
      if (deltaSec >= 1) {
        this.lastTickTs = now;
        this.elapsedSec += deltaSec;
        const plan = this.ensurePlan();
        // Check due substitutions
        for (const ev of plan.events) {
          if (this.elapsedSec >= ev.minute * 60 && !this.alertedEventIds.has(ev.id)) {
            this.alertedEventIds.add(ev.id);
            this.triggerSubAlert(ev.outPlayerName, ev.inPlayerName, ev.minute);
          }
        }
        if (this.elapsedSec >= this.matchMinutes * 60) {
          this.stopPitTimer();
          this.opts.toast('🏁 انتهى وقت المباراة المجدول في غرفة الدكة ✓');
        }
        this.updateLiveClockDom();
      }
    }, 500);
    this.updateLiveClockDom();
  }

  private stopPitTimer(): void {
    this.pitRunning = false;
    if (this.timerId !== null) {
      window.clearInterval(this.timerId);
      this.timerId = null;
    }
    this.updateLiveClockDom();
  }

  private resetPitTimer(): void {
    this.stopPitTimer();
    this.elapsedSec = 0;
    this.alertedEventIds.clear();
    this.updateLiveClockDom();
  }

  private updateLiveClockDom(): void {
    if (!this.mountContainer) return;
    const clockEl = this.mountContainer.querySelector('#pitWallClockDisplay');
    if (clockEl) {
      clockEl.textContent = `${this.formatClock(this.elapsedSec)} / ${this.formatClock(this.matchMinutes * 60)}`;
    }
    const toggleBtn = this.mountContainer.querySelector<HTMLButtonElement>('#btnPitWallToggle');
    if (toggleBtn) {
      toggleBtn.textContent = this.pitRunning ? '⏸ إيقاف مؤقت' : '▶ تشغيل وضع الدكة';
    }
    const wakeLbl = this.mountContainer.querySelector('#pitWallWakeStatus');
    if (wakeLbl) wakeLbl.textContent = this.wakeLockStatusAr;

    const nextBox = this.mountContainer.querySelector('#pitWallNextSubBox');
    if (nextBox && this.plan) {
      const next = getNextUpcomingSub(this.plan, this.elapsedSec);
      if (next) {
        nextBox.innerHTML = `
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
            <span style="font-size:0.78rem;color:#fde047;font-weight:800;">🔔 التبديل القادم (د${next.event.minute}):</span>
            <span dir="ltr" style="font-size:0.84rem;font-weight:900;color:#fff;">بعد ${this.formatClock(next.secondsUntil)}</span>
          </div>
          <div style="font-size:0.82rem;margin-top:4px;">
            🟢 دخول <strong style="color:#4ade80;">${escapeHtml(next.event.inPlayerName)}</strong>
            ⇄ 🔴 خروج <strong style="color:#fb7185;">${escapeHtml(next.event.outPlayerName)}</strong>
          </div>
        `;
      } else {
        nextBox.innerHTML = `<div class="muted" style="font-size:0.76rem;">${
          this.plan.events.length
            ? '✅ اكتملت جميع التبديلات المجدولة للمباراة.'
            : 'ℹ️ لا توجد تبديلات مجدولة (أضف لاعبين احتياطيين لتفعيل جدول الدكة).'
        }</div>`;
      }
    }
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

  public render(container: HTMLElement): void {
    this.mountContainer = container;
    const plan = this.ensurePlan();
    const allRoster = [...plan.starters, ...plan.bench];

    const playerOptionsHtml = (selectedId: string) =>
      allRoster
        .map(
          (p) =>
            `<option value="${escapeHtml(p.id)}" ${p.id === selectedId ? 'selected' : ''}>${escapeHtml(p.name)}</option>`
        )
        .join('');

    container.innerHTML = `
      <!-- 1) OFFLINE PIT MODE LIVE CONTROL -->
      <div class="item-box" style="border-color:rgba(250,204,21,0.48);margin-bottom:8px;">
        <div class="row between" style="margin-bottom:6px;gap:8px;flex-wrap:wrap;">
          <div>
            <div style="font-weight:900;color:var(--primary);font-size:0.88rem;">⏱️ غرفة إدارة الدكة (Pit-Wall • أوفلاين)</div>
            <div class="muted" style="font-size:0.72rem;">مؤقّت محلي 100% — تنبيهات صوتية واهتزاز عند موعد كل تبديل</div>
          </div>
          <div id="pitWallClockDisplay" dir="ltr" style="font-size:1.25rem;font-weight:900;color:var(--primary);font-variant-numeric:tabular-nums;">
            ${this.formatClock(this.elapsedSec)} / ${this.formatClock(this.matchMinutes * 60)}
          </div>
        </div>

        <div id="pitWallNextSubBox" style="background:rgba(250,204,21,0.06);border:1px solid rgba(250,204,21,0.22);border-radius:10px;padding:8px;margin-bottom:8px;"></div>

        <div class="grid-2" style="gap:6px;margin-bottom:8px;">
          <button type="button" id="btnPitWallToggle" class="btn-primary" style="min-height:38px;font-size:0.8rem;">${
            this.pitRunning ? '⏸ إيقاف مؤقت' : '▶ تشغيل وضع الدكة'
          }</button>
          <button type="button" id="btnPitWallReset" style="min-height:38px;font-size:0.8rem;">↻ تصفير الوقت</button>
        </div>

        <div class="row between" style="gap:8px;flex-wrap:wrap;font-size:0.74rem;align-items:center;">
          <label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;white-space:nowrap;">
            <input type="checkbox" id="chkPitWallVibrate" style="width:auto;margin:0;accent-color:#facc15;" ${this.vibrateEnabled ? 'checked' : ''} />
            <span>اهتزاز عند التبديل</span>
          </label>
          <button type="button" id="btnPitWallWakeLock" class="tac-pill ${this.wakeLockEnabled ? 'active' : ''}" style="font-size:0.72rem;white-space:nowrap;">
            ☀️ إبقاء الشاشة مضاءة (<span id="pitWallWakeStatus">${escapeHtml(this.wakeLockStatusAr)}</span>)
          </button>
        </div>
        <div class="muted" style="font-size:0.68rem;margin-top:6px;line-height:1.45;">
          ℹ️ ملاحظة تقنية: مؤقّتات المتصفح قد تتباطأ عند قفل شاشة الهاتف أو نقل التطبيق للخلفية حسب قيود النظام.
        </div>
      </div>

      <!-- 2) PLANNER SETTINGS -->
      <div class="item-box" style="margin-bottom:8px;">
        <div class="row between" style="margin-bottom:6px;flex-wrap:wrap;gap:6px;">
          <strong style="font-size:0.84rem;color:#f8fafc;">📋 إعدادات خطة التدوير (${plan.starters.length} أساسي • ${plan.bench.length} احتياط)</strong>
          <span class="badge" style="font-size:0.7rem;">فارق الدقائق: ${plan.fairnessSpreadMin} د</span>
        </div>

        <div style="margin-bottom:8px;">
          <div class="muted" style="font-size:0.72rem;margin-bottom:4px;">مدة المباراة:</div>
          <div class="row" style="gap:5px;flex-wrap:wrap;">
            ${[30, 40, 50, 60, 90]
              .map(
                (m) =>
                  `<button type="button" data-pw-min="${m}" class="tac-pill ${this.matchMinutes === m ? 'active' : ''}">${m} د</button>`
              )
              .join('')}
          </div>
        </div>

        <div style="margin-bottom:8px;">
          <div class="muted" style="font-size:0.72rem;margin-bottom:4px;">أسلوب اللعب (يحدّد وتيرة التدوير ومنحنى الجهد):</div>
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

        <div style="font-weight:800;font-size:0.8rem;margin:8px 0 5px;color:#fde047;">🔄 جدول التبديلات (قابل للتعديل اليدوي):</div>
        ${
          plan.events.length
            ? plan.events
                .map((ev) => {
                  const isEditing = this.editingEventId === ev.id;
                  if (isEditing) {
                    return `<div style="padding:8px;margin-bottom:6px;background:rgba(250,204,21,0.08);border:1px solid rgba(250,204,21,0.35);border-radius:10px;">
                      <div class="grid-3" style="gap:5px;margin-bottom:6px;">
                        <input type="number" id="pwEditMin" min="1" max="${plan.matchMinutes - 1}" value="${ev.minute}" style="padding:4px 6px;font-size:0.76rem;" />
                        <select id="pwEditIn" style="padding:4px;font-size:0.74rem;">${playerOptionsHtml(ev.inPlayerId)}</select>
                        <select id="pwEditOut" style="padding:4px;font-size:0.74rem;">${playerOptionsHtml(ev.outPlayerId)}</select>
                      </div>
                      <div class="row" style="gap:6px;">
                        <button type="button" data-pw-save-ev="${escapeHtml(ev.id)}" class="btn-primary" style="min-height:30px;padding:3px 10px;font-size:0.74rem;">✓ حفظ التعديل</button>
                        <button type="button" id="btnPwCancelEdit" style="min-height:30px;padding:3px 10px;font-size:0.74rem;">إلغاء</button>
                      </div>
                    </div>`;
                  }
                  const done = this.alertedEventIds.has(ev.id);
                  return `<div style="font-size:0.78rem;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.07);display:flex;justify-content:space-between;align-items:center;gap:6px;opacity:${done ? '0.6' : '1'};">
                    <div>
                      <span style="color:var(--primary);font-weight:900;">د${ev.minute}</span>
                      <span> • 🟢 ${escapeHtml(ev.inPlayerName)} ⇄ 🔴 ${escapeHtml(ev.outPlayerName)}</span>
                      <div class="muted" style="font-size:0.69rem;">${escapeHtml(ev.reasonAr)}</div>
                    </div>
                    <button type="button" data-pw-edit-ev="${escapeHtml(ev.id)}" class="icon-btn" style="min-height:28px;padding:2px 8px;font-size:0.72rem;" title="تعديل التبديل يدوياً">✏️</button>
                  </div>`;
                })
                .join('')
            : '<p class="muted" style="font-size:0.75rem;">عند توفر لاعبين على مقاعد البدلاء (أكثر من عدد التشكيلة الأساسية)، يُبنى جدول تدوير عادل تلقائياً.</p>'
        }
      </div>

      <!-- 3) ESTIMATED FATIGUE CURVE -->
      <div class="item-box">
        <div style="font-weight:800;font-size:0.82rem;color:var(--primary);margin-bottom:6px;">📉 منحنى الإجهاد والتعافي التقديري</div>
        ${this.buildFatigueSvg(plan)}
        <div class="muted" style="font-size:0.69rem;margin-top:6px;line-height:1.45;">ℹ️ ${escapeHtml(plan.disclaimerAr)}</div>
      </div>
    `;

    this.updateLiveClockDom();
    this.bindEvents(container);
  }

  private bindEvents(container: HTMLElement): void {
    container.querySelector('#btnPitWallToggle')?.addEventListener('click', () => {
      if (this.pitRunning) this.stopPitTimer();
      else this.startPitTimer();
    });

    container.querySelector('#btnPitWallReset')?.addEventListener('click', () => {
      this.resetPitTimer();
      this.render(container);
    });

    container.querySelector('#chkPitWallVibrate')?.addEventListener('change', (e) => {
      this.vibrateEnabled = (e.target as HTMLInputElement).checked;
    });

    container.querySelector('#btnPitWallWakeLock')?.addEventListener('click', () => {
      if (this.wakeLockEnabled) {
        void this.releaseWakeLock().then(() => this.render(container));
      } else {
        void this.requestWakeLock().then(() => this.render(container));
      }
    });

    container.querySelectorAll<HTMLButtonElement>('[data-pw-min]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.matchMinutes = Number(btn.dataset.pwMin || '60');
        this.editingEventId = null;
        this.ensurePlan(true);
        this.resetPitTimer();
        this.render(container);
      });
    });

    container.querySelectorAll<HTMLButtonElement>('[data-pw-style]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.style = (btn.dataset.pwStyle as TacticalPlayStyle) || 'balanced';
        this.editingEventId = null;
        this.ensurePlan(true);
        this.render(container);
      });
    });

    container.querySelectorAll<HTMLButtonElement>('[data-pw-track]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.selectedTrackPlayerId = btn.dataset.pwTrack || null;
        this.render(container);
      });
    });

    container.querySelectorAll<HTMLButtonElement>('[data-pw-edit-ev]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.editingEventId = btn.dataset.pwEditEv || null;
        this.render(container);
      });
    });

    container.querySelector('#btnPwCancelEdit')?.addEventListener('click', () => {
      this.editingEventId = null;
      this.render(container);
    });

    container.querySelectorAll<HTMLButtonElement>('[data-pw-save-ev]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const evId = btn.dataset.pwSaveEv;
        if (!evId || !this.plan) return;
        const minVal = Number((container.querySelector('#pwEditMin') as HTMLInputElement)?.value || '10');
        const inId = (container.querySelector('#pwEditIn') as HTMLSelectElement)?.value;
        const outId = (container.querySelector('#pwEditOut') as HTMLSelectElement)?.value;
        this.plan = applyManualRotationEdit(this.plan, evId, {
          minute: minVal,
          inPlayerId: inId,
          outPlayerId: outId,
        });
        this.editingEventId = null;
        this.opts.toast('تم تحديث التبديل وإعادة حساب الدقائق ومنحنى الإجهاد ✓');
        this.render(container);
      });
    });
  }
}

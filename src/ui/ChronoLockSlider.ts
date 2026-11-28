/**
 * CHRONO DETENT LOCK — Maydan 6v6 Signature Tactile Control
 * Inspired by Swiss watch crown detents and motorsport safety switches.
 *
 * Pure Pointer Events + setPointerCapture + GPU-composited transforms.
 * Supports RTL and LTR directions, async double-trigger locking, snapback cancellation,
 * optional navigator.vibrate(12), optional muted-by-default mechanical click,
 * and full keyboard + fallback button accessibility.
 */

export const CHRONO_DETENT_THRESHOLD = 0.92;

export type ChronoLockPhase = 'idle' | 'dragging' | 'committing' | 'success' | 'error';

export interface ChronoLockGeometry {
  trackWidth: number;
  knobWidth: number;
  inset: number;
  rtl: boolean;
}

export interface ChronoLockStateSnapshot {
  phase: ChronoLockPhase;
  progress: number; // 0..1
  inFlight: boolean;
  confirmCalls: number;
}

/**
 * Pure math: computes normalized slider progress (0..1) from pointer delta
 * respecting RTL (start right, drag left -> negative deltaX increases progress)
 * and LTR (start left, drag right -> positive deltaX increases progress).
 */
export function computeChronoProgress(
  deltaX: number,
  geom: ChronoLockGeometry
): { progress: number; maxTravel: number; translateX: number } {
  const maxTravel = Math.max(1, geom.trackWidth - geom.knobWidth - geom.inset * 2);
  const directionalDelta = geom.rtl ? -deltaX : deltaX;
  const clampedPx = Math.max(0, Math.min(maxTravel, directionalDelta));
  const progress = clampedPx / maxTravel;
  const translateX = clampedPx === 0 ? 0 : geom.rtl ? -clampedPx : clampedPx;
  return { progress, maxTravel, translateX };
}

export function isChronoDetentReached(
  progress: number,
  threshold: number = CHRONO_DETENT_THRESHOLD
): boolean {
  return Number.isFinite(progress) && progress >= threshold;
}

/**
 * Pure async state guard preventing double invocation of the bound confirm callback
 * whether triggered via drag completion, keyboard shortcut, or accessible fallback button.
 */
export class ChronoInvocationGuard {
  private inFlight = false;
  private lastSuccessTs = 0;
  private cooldownMs: number;

  constructor(cooldownMs = 700) {
    this.cooldownMs = cooldownMs;
  }

  canTrigger(nowMs: number = Date.now()): boolean {
    if (this.inFlight) return false;
    if (nowMs - this.lastSuccessTs < this.cooldownMs) return false;
    return true;
  }

  async run(
    fn: () => Promise<boolean | void> | boolean | void,
    nowMs: number = Date.now()
  ): Promise<{ executed: boolean; ok: boolean; error?: unknown }> {
    if (!this.canTrigger(nowMs)) {
      return { executed: false, ok: false };
    }
    this.inFlight = true;
    try {
      const res = await fn();
      const ok = res !== false;
      if (ok) {
        this.lastSuccessTs = Date.now();
      }
      return { executed: true, ok };
    } catch (error) {
      return { executed: true, ok: false, error };
    } finally {
      this.inFlight = false;
    }
  }

  isLocked(): boolean {
    return this.inFlight;
  }
}

export interface ChronoLockSliderOptions {
  container: HTMLElement;
  titleAr?: string;
  idleLabelAr?: string;
  draggingLabelAr?: string;
  nearLabelAr?: string;
  committingLabelAr?: string;
  successLabelAr?: string;
  errorLabelAr?: string;
  threshold?: number;
  enableVibration?: boolean;
  enableSound?: boolean; // Strictly false by default per specification
  onConfirm: () => Promise<boolean | void> | boolean | void;
}

const KNOB_HEX_SVG =
  `<svg class="chrono-lock-knob-svg" viewBox="0 0 42 42" fill="none" aria-hidden="true">` +
  `<polygon points="21,2 37.5,11.5 37.5,30.5 21,40 4.5,30.5 4.5,11.5" fill="#191C22" stroke="#D4AF37" stroke-width="1.6"/>` +
  `<polygon points="21,5.5 34.4,13.2 34.4,28.8 21,36.5 7.6,28.8 7.6,13.2" fill="rgba(212,175,55,0.12)" stroke="rgba(242,214,117,0.42)" stroke-width="0.9"/>` +
  `<path d="M23.5 15.5L17.8 21L23.5 26.5" stroke="#F2D675" stroke-width="1.8" stroke-linecap="square" stroke-linejoin="miter"/>` +
  `</svg>`;

export class ChronoLockSlider {
  private opts: Required<
    Pick<
      ChronoLockSliderOptions,
      | 'titleAr'
      | 'idleLabelAr'
      | 'draggingLabelAr'
      | 'nearLabelAr'
      | 'committingLabelAr'
      | 'successLabelAr'
      | 'errorLabelAr'
      | 'threshold'
      | 'enableVibration'
      | 'enableSound'
    >
  > & { container: HTMLElement; onConfirm: ChronoLockSliderOptions['onConfirm'] };

  private guard = new ChronoInvocationGuard(750);
  private phase: ChronoLockPhase = 'idle';
  private disabled = false;
  private activePointerId: number | null = null;
  private startX = 0;
  private progress = 0;
  private resetTimerId: number | null = null;
  private disposed = false;

  private rootEl!: HTMLElement;
  private trackEl!: HTMLElement;
  private fillEl!: HTMLElement;
  private knobEl!: HTMLButtonElement;
  private labelEl!: HTMLElement;
  private pctEl!: HTMLElement;
  private statusEl!: HTMLElement;

  constructor(options: ChronoLockSliderOptions) {
    this.opts = {
      container: options.container,
      onConfirm: options.onConfirm,
      titleAr: options.titleAr ?? 'قفل الاعتماد الميكانيكي',
      idleLabelAr: options.idleLabelAr ?? 'اسحب المقبض لنهاية المسار لنشر التشكيلة',
      draggingLabelAr: options.draggingLabelAr ?? 'واصل السحب حتى قفل التفعيل...',
      nearLabelAr: options.nearLabelAr ?? 'أفلت الآن لتأكيد النشر',
      committingLabelAr: options.committingLabelAr ?? 'جاري نشر التشكيلة للفريق...',
      successLabelAr: options.successLabelAr ?? 'تم نشر التشكيلة بنجاح ✓',
      errorLabelAr: options.errorLabelAr ?? 'تعذّر النشر — أعد المحاولة',
      threshold: options.threshold ?? CHRONO_DETENT_THRESHOLD,
      enableVibration: options.enableVibration ?? true,
      enableSound: options.enableSound ?? false,
    };

    this.mount();
  }

  private mount(): void {
    this.opts.container.innerHTML = `
      <div class="chrono-lock" data-chrono-phase="idle">
        <div class="chrono-lock-head">
          <span class="chrono-lock-title">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#D4AF37" stroke-width="1.5" aria-hidden="true">
              <path d="M12 2.2L20.5 7.1V16.9L12 21.8L3.5 16.9V7.1Z"/>
              <circle cx="12" cy="12" r="2.6"/>
            </svg>
            <span>${this.opts.titleAr}</span>
          </span>
          <span class="chrono-lock-pct" aria-hidden="true">0%</span>
        </div>
        <div class="chrono-lock-track" role="group" aria-label="${this.opts.titleAr}">
          <div class="chrono-lock-ticks" aria-hidden="true"></div>
          <div class="chrono-lock-fill" aria-hidden="true"></div>
          <div class="chrono-lock-label">${this.opts.idleLabelAr}</div>
          <button
            type="button"
            class="chrono-lock-knob"
            role="slider"
            aria-label="${this.opts.idleLabelAr}"
            aria-valuemin="0"
            aria-valuemax="100"
            aria-valuenow="0"
            aria-valuetext="غير مفعّل"
          >${KNOB_HEX_SVG}</button>
        </div>
        <div class="chrono-lock-status" role="status" aria-live="polite"></div>
      </div>
    `;

    this.rootEl = this.opts.container.querySelector('.chrono-lock') as HTMLElement;
    this.trackEl = this.opts.container.querySelector('.chrono-lock-track') as HTMLElement;
    this.fillEl = this.opts.container.querySelector('.chrono-lock-fill') as HTMLElement;
    this.knobEl = this.opts.container.querySelector('.chrono-lock-knob') as HTMLButtonElement;
    this.labelEl = this.opts.container.querySelector('.chrono-lock-label') as HTMLElement;
    this.pctEl = this.opts.container.querySelector('.chrono-lock-pct') as HTMLElement;
    this.statusEl = this.opts.container.querySelector('.chrono-lock-status') as HTMLElement;

    this.knobEl.addEventListener('pointerdown', this.handlePointerDown);
    this.trackEl.addEventListener('pointerdown', this.handleTrackPointerDown);
    this.knobEl.addEventListener('pointermove', this.handlePointerMove);
    this.knobEl.addEventListener('pointerup', this.handlePointerUp);
    this.knobEl.addEventListener('pointercancel', this.handlePointerCancel);
    this.knobEl.addEventListener('keydown', this.handleKeyDown);
  }

  private isRtl(): boolean {
    if (typeof window === 'undefined') return true;
    return window.getComputedStyle(this.trackEl).direction !== 'ltr';
  }

  private readGeometry(): ChronoLockGeometry {
    const trackRect = this.trackEl.getBoundingClientRect();
    const knobRect = this.knobEl.getBoundingClientRect();
    return {
      trackWidth: trackRect.width || 280,
      knobWidth: knobRect.width || 44,
      inset: 4,
      rtl: this.isRtl(),
    };
  }

  private setPhase(phase: ChronoLockPhase): void {
    this.phase = phase;
    this.rootEl.dataset.chronoPhase = phase;
    this.rootEl.classList.toggle('is-dragging', phase === 'dragging');
    this.rootEl.classList.toggle('is-committing', phase === 'committing');
    this.rootEl.classList.toggle('is-success', phase === 'success');
    this.rootEl.classList.toggle('is-error', phase === 'error');
    this.rootEl.classList.toggle('is-disabled', this.disabled || phase === 'committing');
    this.knobEl.disabled = this.disabled || phase === 'committing';
  }

  private applyVisualProgress(progress: number, translateX: number): void {
    this.progress = progress;
    const pct = Math.round(progress * 100);
    const near = progress >= this.opts.threshold;

    this.rootEl.classList.toggle('is-near', near && this.phase === 'dragging');
    this.knobEl.style.transform = `translate3d(${translateX.toFixed(1)}px, 0, 0)`;
    this.fillEl.style.transform = `scaleX(${progress.toFixed(4)})`;
    this.pctEl.textContent = `${pct}%`;
    this.knobEl.setAttribute('aria-valuenow', String(pct));
    this.knobEl.setAttribute(
      'aria-valuetext',
      near ? 'جاهز لتأكيد النشر' : pct > 0 ? `السحب ${pct}%` : 'غير مفعّل'
    );

    if (this.phase === 'dragging') {
      this.labelEl.textContent = near ? this.opts.nearLabelAr : this.opts.draggingLabelAr;
    }
  }

  private resetToIdle(): void {
    if (this.disposed) return;
    if (this.resetTimerId !== null) {
      window.clearTimeout(this.resetTimerId);
      this.resetTimerId = null;
    }
    this.activePointerId = null;
    this.setPhase('idle');
    this.rootEl.classList.remove('is-near', 'is-detent');
    this.applyVisualProgress(0, 0);
    this.labelEl.textContent = this.opts.idleLabelAr;
  }

  private triggerOptionalHaptics(): void {
    if (!this.opts.enableVibration) return;
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        navigator.vibrate(12);
      }
    } catch {
      // Gracefully ignore unsupported vibration
    }
  }

  private triggerOptionalDetentClick(): void {
    if (!this.opts.enableSound) return;
    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      const ac = new AudioCtx();
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(1180, ac.currentTime);
      osc.frequency.exponentialRampToValueAtTime(420, ac.currentTime + 0.035);
      gain.gain.setValueAtTime(0.05, ac.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.04);
      osc.connect(gain);
      gain.connect(ac.destination);
      osc.start();
      osc.stop(ac.currentTime + 0.045);
    } catch {
      // Gracefully ignore audio restrictions
    }
  }

  /**
   * Public guarded activation path so keyboard controls and the accessible fallback button
   * go through the EXACT same double-trigger guard & visual feedback as dragging.
   */
  public async activate(): Promise<boolean> {
    if (this.disposed || this.disabled || !this.guard.canTrigger()) {
      return false;
    }

    const geom = this.readGeometry();
    const { translateX } = computeChronoProgress(geom.rtl ? -geom.trackWidth : geom.trackWidth, geom);

    this.setPhase('committing');
    this.rootEl.classList.add('is-detent');
    this.applyVisualProgress(1, translateX);
    this.labelEl.textContent = this.opts.committingLabelAr;
    this.statusEl.textContent = this.opts.committingLabelAr;

    const result = await this.guard.run(this.opts.onConfirm);
    if (this.disposed || !result.executed) {
      return false;
    }

    if (result.ok) {
      this.setPhase('success');
      this.labelEl.textContent = this.opts.successLabelAr;
      this.statusEl.textContent = this.opts.successLabelAr;
      this.triggerOptionalHaptics();
      this.triggerOptionalDetentClick();
      this.resetTimerId = window.setTimeout(() => {
        this.statusEl.textContent = '';
        this.resetToIdle();
      }, 1700);
      return true;
    }

    this.setPhase('error');
    this.labelEl.textContent = this.opts.errorLabelAr;
    this.statusEl.textContent = this.opts.errorLabelAr;
    this.resetTimerId = window.setTimeout(() => {
      this.resetToIdle();
    }, 1700);
    return false;
  }

  public setDisabled(disabled: boolean): void {
    this.disabled = disabled;
    this.rootEl.classList.toggle('is-disabled', disabled || this.phase === 'committing');
    this.knobEl.disabled = disabled || this.phase === 'committing';
  }

  public getPhase(): ChronoLockPhase {
    return this.phase;
  }

  private handleTrackPointerDown = (e: PointerEvent): void => {
    if (e.target === this.knobEl || this.knobEl.contains(e.target as Node)) return;
    // Allow starting drag directly from the knob only to prevent accidental taps on the rail
  };

  private handlePointerDown = (e: PointerEvent): void => {
    if (this.disabled || this.phase === 'committing' || !this.guard.canTrigger()) return;
    if (e.button !== 0 && e.pointerType === 'mouse') return;

    if (this.resetTimerId !== null) {
      window.clearTimeout(this.resetTimerId);
      this.resetTimerId = null;
    }

    this.activePointerId = e.pointerId;
    this.startX = e.clientX;
    this.setPhase('dragging');
    this.statusEl.textContent = '';

    try {
      this.knobEl.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic pointer events in tests may not have an active browser pointer
    }
    e.preventDefault();
  };

  private handlePointerMove = (e: PointerEvent): void => {
    if (this.phase !== 'dragging' || this.activePointerId !== e.pointerId) return;
    const geom = this.readGeometry();
    const { progress, translateX } = computeChronoProgress(e.clientX - this.startX, geom);
    this.applyVisualProgress(progress, translateX);
  };

  private handlePointerUp = (e: PointerEvent): void => {
    if (this.phase !== 'dragging' || this.activePointerId !== e.pointerId) return;
    const geom = this.readGeometry();
    const { progress } = computeChronoProgress(e.clientX - this.startX, geom);

    try {
      if (this.knobEl.hasPointerCapture(e.pointerId)) {
        this.knobEl.releasePointerCapture(e.pointerId);
      }
    } catch {
      // Ignore release errors
    }

    this.activePointerId = null;

    if (isChronoDetentReached(progress, this.opts.threshold)) {
      void this.activate();
    } else {
      this.statusEl.textContent = 'تم إلغاء السحب — لم يصل المقبض لنهاية المسار';
      this.resetToIdle();
    }
  };

  private handlePointerCancel = (e: PointerEvent): void => {
    if (this.activePointerId !== e.pointerId) return;
    try {
      if (this.knobEl.hasPointerCapture(e.pointerId)) {
        this.knobEl.releasePointerCapture(e.pointerId);
      }
    } catch {
      // Ignore
    }
    this.activePointerId = null;
    this.statusEl.textContent = 'تم إلغاء السحب';
    this.resetToIdle();
  };

  private handleKeyDown = (e: KeyboardEvent): void => {
    if (this.disabled || this.phase === 'committing') return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      void this.activate();
    }
  };

  public destroy(): void {
    this.disposed = true;
    if (this.resetTimerId !== null) {
      window.clearTimeout(this.resetTimerId);
      this.resetTimerId = null;
    }
    this.knobEl.removeEventListener('pointerdown', this.handlePointerDown);
    this.trackEl.removeEventListener('pointerdown', this.handleTrackPointerDown);
    this.knobEl.removeEventListener('pointermove', this.handlePointerMove);
    this.knobEl.removeEventListener('pointerup', this.handlePointerUp);
    this.knobEl.removeEventListener('pointercancel', this.handlePointerCancel);
    this.knobEl.removeEventListener('keydown', this.handleKeyDown);
    this.opts.container.innerHTML = '';
  }
}

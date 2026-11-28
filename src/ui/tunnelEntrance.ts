/**
 * TUNNEL APERTURE SIGNATURE LOGIN ENGINE — Maydan 6v6
 * Builds cleanly on top of the 4-stage stadium tunnel-to-pitch entrance:
 *  1. Smart Adaptive Ignition (2.6s cold tunnel / 380ms Chrono-Sweep return / <3h match floodlight)
 *  2. Live Floodlight Gyro-Sheen (60fps CSS custom properties via DeviceOrientation / pointer)
 *  3. Pure Generative Web Audio + Safe Haptic Triple Signature (0 KB assets)
 *  4. Non-blocking Invite Hex Contract Seal (for invite/referral URLs only)
 *  5. Seamless 350ms GPU Pitch Depth-Dive exit transition
 *
 * Strictly preserves all existing authentication, invitation, privacy, and routing flows.
 * Uses sessionStorage ONLY for within-session visual entrance state (never localStorage).
 */

import { EntryAudioEngine } from './entryAudio';
import { GyroSheenController } from './gyroSheen';

export type TunnelStage = 'idle' | 'identity' | 'opening' | 'pitch' | 'settled';
export type TunnelMotionProfile = 'full' | 'simplified' | 'instant';

export interface EntranceProfileInput {
  prefersReducedMotion: boolean;
  dataSaver: boolean;
  hardwareConcurrency?: number | null;
  deviceMemoryGb?: number | null;
  alreadyPlayedInSession: boolean;
}

/**
 * Pure policy: decides whether to play the full 4-stage Tunnel Aperture entrance,
 * a lighter simplified version on low-resource devices, or settle immediately
 * (for prefers-reduced-motion, data-saver, or repeat visits in the same page session).
 */
export function resolveEntranceProfile(input: EntranceProfileInput): TunnelMotionProfile {
  if (input.alreadyPlayedInSession || input.prefersReducedMotion || input.dataSaver) {
    return 'instant';
  }
  const lowCores =
    typeof input.hardwareConcurrency === 'number' &&
    input.hardwareConcurrency > 0 &&
    input.hardwareConcurrency <= 2;
  const lowMem =
    typeof input.deviceMemoryGb === 'number' &&
    input.deviceMemoryGb > 0 &&
    input.deviceMemoryGb <= 2;
  if (lowCores || lowMem) {
    return 'simplified';
  }
  return 'full';
}

/**
 * Pure check: detects whether any locally known match timestamp falls within (0, windowHours]
 * from `nowMs` — strictly local in-memory inspection (ZERO Firebase/network calls).
 */
export function hasUpcomingMatchWithinHours(
  nowMs: number,
  candidateTimestampsMs: readonly (number | null | undefined)[],
  windowHours: number = 3
): boolean {
  if (!Number.isFinite(nowMs) || !Number.isFinite(windowHours) || windowHours <= 0) return false;
  const maxMs = windowHours * 3_600_000;
  for (const ts of candidateTimestampsMs) {
    if (typeof ts !== 'number' || !Number.isFinite(ts)) continue;
    const diff = ts - nowMs;
    if (diff > 0 && diff <= maxMs) return true;
  }
  return false;
}

/**
 * Pure volume envelope preserved for backwards-compatible unit tests & API stability.
 */
export function computeTunnelAudioGain(
  elapsedMs: number,
  durationMs: number = 3200,
  maxVolume: number = 0.28
): number {
  if (!Number.isFinite(elapsedMs) || !Number.isFinite(durationMs) || durationMs <= 0) return 0;
  if (elapsedMs <= 0 || elapsedMs >= durationMs) return 0;
  const clampedMax = Math.max(0, Math.min(1, maxVolume));
  const t = elapsedMs / durationMs;

  if (t < 0.48) {
    const p = t / 0.48;
    const eased = p * p * (3 - 2 * p);
    return Number((clampedMax * (0.15 + 0.85 * eased)).toFixed(4));
  }
  if (t < 0.68) {
    return Number(clampedMax.toFixed(4));
  }
  const fadeP = (t - 0.68) / 0.32;
  const remaining = Math.max(0, 1 - fadeP * fadeP);
  return Number((clampedMax * remaining).toFixed(4));
}

/**
 * Pure session guard ensuring the full cold entrance plays at most once per browser session.
 */
export class TunnelEntranceSessionGuard {
  private entrancePlayed = false;
  private audioPlayed = false;

  hasEntrancePlayed(): boolean {
    return this.entrancePlayed;
  }

  markEntrancePlayed(): void {
    this.entrancePlayed = true;
  }

  canPlayAudio(): boolean {
    return !this.audioPlayed;
  }

  markAudioPlayed(): void {
    this.audioPlayed = true;
  }

  resetForTests(): void {
    this.entrancePlayed = false;
    this.audioPlayed = false;
  }
}

export const STADIUM_AMBIENCE_ASSET_PATH = '/assets/audio/stadium-tunnel-ambience.mp3';
const SESSION_PLAYED_KEY = 'maydan_tunnel_entrance_played_v2';

export interface TunnelAudioCopy {
  ar: {
    soundOff: string;
    soundOn: string;
    skip: string;
    missingAsset: string;
    alreadyPlayed: string;
    blocked: string;
    sealTitle: string;
    sealHint: string;
    sealArmed: string;
  };
  en: {
    soundOff: string;
    soundOn: string;
    skip: string;
    missingAsset: string;
    alreadyPlayed: string;
    blocked: string;
    sealTitle: string;
    sealHint: string;
    sealArmed: string;
  };
}

export const TUNNEL_COPY: TunnelAudioCopy = {
  ar: {
    soundOff: 'أجواء الملعب',
    soundOn: 'أجواء الملعب مفعّلة',
    skip: 'تخطي',
    missingAsset: 'ميزة أجواء الملعب جاهزة — أضف ملف صوت مرخّص في public/assets/audio/stadium-tunnel-ambience.mp3',
    alreadyPlayed: 'تم تشغيل أجواء الدخول لهذه الجلسة',
    blocked: 'تعذّر تشغيل الصوت في المتصفح الحالي — يمكنك المتابعة بشكل طبيعي',
    sealTitle: 'ختم دعوة الفريق السداسي',
    sealHint: 'اضغط مطوّلاً لتفعيل الختم أو انضم مباشرة بالأسفل',
    sealArmed: 'تم تفعيل الختم — جاهز للانضمام',
  },
  en: {
    soundOff: 'Stadium Sound',
    soundOn: 'Stadium Sound On',
    skip: 'Skip',
    missingAsset: 'Stadium ambience ready — add a licensed recording at public/assets/audio/stadium-tunnel-ambience.mp3',
    alreadyPlayed: 'Stadium ambience already played for this entry session',
    blocked: 'Browser blocked audio playback — continuing silently',
    sealTitle: '6v6 Squad Contract Seal',
    sealHint: 'Hold to charge seal or continue directly below',
    sealArmed: 'Seal Engaged — Ready to Join',
  },
};

export interface TunnelApertureOptions {
  loginScreen: HTMLElement;
  skipBtn?: HTMLButtonElement | null;
  hexSealEl?: HTMLElement | null;
  getLang?: () => 'ar' | 'en';
  getUpcomingMatchTimestampsMs?: () => readonly (number | null | undefined)[];
}

export class TunnelApertureController {
  private screen: HTMLElement;
  private skipBtn: HTMLButtonElement | null;
  private hexSealEl: HTMLElement | null;
  private getLang: () => 'ar' | 'en';
  private getUpcomingMatchTimestampsMs: () => readonly (number | null | undefined)[];

  private guard = new TunnelEntranceSessionGuard();
  private audio = new EntryAudioEngine();
  private gyro: GyroSheenController;

  private stage: TunnelStage = 'idle';
  private profile: TunnelMotionProfile = 'full';
  private timers: number[] = [];
  private rafs: number[] = [];
  private sweepTimer: number | null = null;
  private exitTimer: number | null = null;
  private sealHoldTimers: number[] = [];
  private sealArmed = false;
  private disposed = false;

  constructor(options: TunnelApertureOptions) {
    this.screen = options.loginScreen;
    this.skipBtn = options.skipBtn ?? null;
    this.hexSealEl = options.hexSealEl ?? (document.getElementById('inviteHexSeal') as HTMLElement | null);
    this.getLang = options.getLang ?? (() => (this.screen.getAttribute('dir') === 'ltr' ? 'en' : 'ar'));
    this.getUpcomingMatchTimestampsMs = options.getUpcomingMatchTimestampsMs ?? (() => []);
    this.gyro = new GyroSheenController(this.screen);

    try {
      if (window.sessionStorage && window.sessionStorage.getItem(SESSION_PLAYED_KEY) === '1') {
        this.guard.markEntrancePlayed();
      }
    } catch {
      // Ignore storage access errors in restricted iframes
    }

    if (this.skipBtn) {
      this.skipBtn.addEventListener('click', this.handleSkipClick);
    }

    // Gesture unlock for Web Audio + Gyro permission + tap-to-skip on tunnel portal
    this.screen.addEventListener('pointerdown', this.handleScreenPointerDown, { passive: true });
    this.bindSignatureControlFeedback();
    this.bindInviteHexSeal();

    window.addEventListener('keydown', this.handleKeyDown);
    this.syncLabels();
  }

  private isMotionRestricted(): boolean {
    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const dataSaver = document.body.classList.contains('data-saver');
    return prefersReducedMotion || dataSaver;
  }

  private clearTimers(): void {
    for (const id of this.timers) {
      window.clearTimeout(id);
    }
    this.timers = [];
    for (const id of this.rafs) {
      window.cancelAnimationFrame(id);
    }
    this.rafs = [];
  }

  private clearSweepTimer(): void {
    if (this.sweepTimer !== null) {
      window.clearTimeout(this.sweepTimer);
      this.sweepTimer = null;
    }
    delete this.screen.dataset.tunnelSweep;
  }

  private clearExitTimer(): void {
    if (this.exitTimer !== null) {
      window.clearTimeout(this.exitTimer);
      this.exitTimer = null;
    }
    delete this.screen.dataset.tunnelExit;
  }

  private clearSealHold(): void {
    for (const id of this.sealHoldTimers) {
      window.clearTimeout(id);
    }
    this.sealHoldTimers = [];
  }

  private setStage(next: TunnelStage): void {
    this.stage = next;
    this.screen.dataset.tunnelStage = next;
    const isPlaying = next === 'identity' || next === 'opening' || next === 'pitch';
    this.screen.dataset.tunnelPlaying = isPlaying ? 'true' : 'false';
    if (this.skipBtn) {
      this.skipBtn.classList.toggle('hidden', !isPlaying);
      this.skipBtn.hidden = !isPlaying;
    }
  }

  private readSystemProfile(): TunnelMotionProfile {
    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const dataSaver = document.body.classList.contains('data-saver');
    const nav = navigator as Navigator & { deviceMemory?: number };
    return resolveEntranceProfile({
      prefersReducedMotion,
      dataSaver,
      hardwareConcurrency: typeof nav.hardwareConcurrency === 'number' ? nav.hardwareConcurrency : null,
      deviceMemoryGb: typeof nav.deviceMemory === 'number' ? nav.deviceMemory : null,
      alreadyPlayedInSession: this.guard.hasEntrancePlayed(),
    });
  }

  /**
   * Checks local in-memory match schedule ONLY (zero Firebase/network reads)
   * and activates subtle stadium corner floodlight ambiance if kickoff is within 3 hours.
   */
  public syncUpcomingMatchFloodlights(candidateTimestampsMs?: readonly (number | null | undefined)[]): void {
    const list = candidateTimestampsMs ?? this.getUpcomingMatchTimestampsMs();
    const imminent = hasUpcomingMatchWithinHours(Date.now(), list, 3);
    this.screen.dataset.matchImminent = imminent ? 'true' : 'false';
  }

  /**
   * Triggers the non-blocking 380ms Chrono-Sweep golden hairline calibration pass
   * on same-session returns (zero interaction delay).
   */
  private triggerChronoSweep(): void {
    this.clearSweepTimer();
    if (this.isMotionRestricted()) return;
    this.screen.dataset.tunnelSweep = 'active';
    this.sweepTimer = window.setTimeout(() => {
      delete this.screen.dataset.tunnelSweep;
      this.sweepTimer = null;
    }, 420);
  }

  /**
   * Called whenever `#loginScreen` becomes visible.
   * - Cold session: plays 4-stage Tunnel Aperture sequence (~2.6s) with immediate skip.
   * - Same-session return: settles immediately + plays non-blocking 380ms Chrono-Sweep.
   * - Active-play duplicate calls: ignored so boot auth resolution never interrupts motion.
   */
  public onLoginVisible(): void {
    if (this.disposed) return;
    this.clearExitTimer();
    this.syncLabels();
    this.syncUpcomingMatchFloodlights();
    this.gyro.start();

    if (this.stage === 'identity' || this.stage === 'opening' || this.stage === 'pitch') {
      return;
    }

    if (this.guard.hasEntrancePlayed()) {
      try {
        window.sessionStorage?.setItem(SESSION_PLAYED_KEY, '1');
      } catch {
        // Ignore storage errors
      }
      this.profile = 'instant';
      this.screen.dataset.tunnelProfile = 'instant';
      this.setStage('settled');
      this.triggerChronoSweep();
      return;
    }

    this.profile = this.readSystemProfile();
    this.screen.dataset.tunnelProfile = this.profile;
    this.guard.markEntrancePlayed();
    try {
      window.sessionStorage?.setItem(SESSION_PLAYED_KEY, '1');
    } catch {
      // Ignore storage errors
    }

    if (this.profile === 'instant') {
      this.setStage('settled');
      return;
    }

    this.clearTimers();
    this.setStage('identity');

    const dIdentity = this.profile === 'simplified' ? 400 : 580;
    const dOpening = this.profile === 'simplified' ? 750 : 980;
    const dPitch = this.profile === 'simplified' ? 700 : 980;

    const scheduleAfterPaint = (delayMs: number, fn: () => void) => {
      const raf1 = window.requestAnimationFrame(() => {
        if (this.disposed) return;
        const raf2 = window.requestAnimationFrame(() => {
          if (this.disposed) return;
          const tid = window.setTimeout(() => {
            if (!this.disposed) fn();
          }, delayMs);
          this.timers.push(tid);
        });
        this.rafs.push(raf2);
      });
      this.rafs.push(raf1);
    };

    scheduleAfterPaint(dIdentity, () => {
      if (this.stage !== 'identity') return;
      this.setStage('opening');
      scheduleAfterPaint(dOpening, () => {
        if (this.stage !== 'opening') return;
        this.setStage('pitch');
        scheduleAfterPaint(dPitch, () => {
          if (this.stage !== 'pitch') return;
          this.setStage('settled');
        });
      });
    });
  }

  /**
   * Seamless 350ms GPU Pitch Depth-Dive when entering the app (Google or Demo).
   * `#appShell` is already visible beneath while `#loginScreen` dives forward non-blockingly
   * (`pointer-events: none`), completing cleanly in 350ms (or instantaneously if reduced-motion).
   */
  public playExitDive(): void {
    if (this.disposed) return;
    this.clearTimers();
    this.clearSweepTimer();
    this.gyro.stop();

    if (this.stage !== 'settled') {
      this.setStage('settled');
    }

    if (this.isMotionRestricted() || this.screen.classList.contains('hidden')) {
      this.screen.classList.add('hidden');
      this.clearExitTimer();
      return;
    }

    this.clearExitTimer();
    this.screen.dataset.tunnelExit = 'diving';
    this.exitTimer = window.setTimeout(() => {
      this.screen.classList.add('hidden');
      delete this.screen.dataset.tunnelExit;
      this.exitTimer = null;
    }, 350);
  }

  public onLoginHidden(): void {
    this.clearTimers();
    this.clearSweepTimer();
    this.clearExitTimer();
    this.clearSealHold();
    this.gyro.stop();
    if (this.stage !== 'settled') {
      this.setStage('settled');
    }
  }

  public skip(): void {
    this.clearTimers();
    this.setStage('settled');
  }

  public getStage(): TunnelStage {
    return this.stage;
  }

  /**
   * Shows or hides the Invite Hex Contract Seal cleanly based on whether an invite/referral code is active.
   */
  public syncInviteSeal(code: string | null | undefined): void {
    if (!this.hexSealEl) return;
    const clean = String(code || '').trim();
    const shouldShow = clean.length > 0;
    this.hexSealEl.classList.toggle('hidden', !shouldShow);
    this.hexSealEl.hidden = !shouldShow;

    const codeBadge = this.hexSealEl.querySelector('[data-hex-seal-code]');
    if (codeBadge) codeBadge.textContent = clean;

    if (!shouldShow) {
      this.sealArmed = false;
      this.hexSealEl.dataset.sealArmed = 'false';
      this.hexSealEl.dataset.sealProgress = '0';
    } else if (!this.sealArmed) {
      this.hexSealEl.dataset.sealArmed = 'false';
      this.hexSealEl.dataset.sealProgress = '6';
    }
    this.syncLabels();
  }

  public syncLabels(): void {
    const lang = this.getLang();
    const copy = TUNNEL_COPY[lang] || TUNNEL_COPY.ar;
    if (this.skipBtn) {
      const span = this.skipBtn.querySelector('[data-tunnel-skip-label]');
      if (span) span.textContent = copy.skip;
      else this.skipBtn.textContent = copy.skip;
    }
    if (this.hexSealEl) {
      const titleEl = this.hexSealEl.querySelector('[data-hex-seal-title]');
      const hintEl = this.hexSealEl.querySelector('[data-hex-seal-hint]');
      if (titleEl) titleEl.textContent = copy.sealTitle;
      if (hintEl) hintEl.textContent = this.sealArmed ? copy.sealArmed : copy.sealHint;
    }
  }

  private bindSignatureControlFeedback(): void {
    const tickIds = ['loginTabSignIn', 'loginTabSignUp', 'btnLoginLangAr', 'btnLoginLangEn'];
    for (const id of tickIds) {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('pointerdown', this.handleMechanicalTick, { passive: true });
      }
    }

    const rememberChk = document.getElementById('chkRememberDevice');
    if (rememberChk) {
      rememberChk.addEventListener('change', this.handleMechanicalTick);
    }

    const confirmIds = ['btnGoogleSignIn', 'btnEnterDemo', 'btnOpenJoinModal'];
    for (const id of confirmIds) {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('pointerdown', this.handleConfirmSeal, { passive: true });
      }
    }
  }

  private bindInviteHexSeal(): void {
    if (!this.hexSealEl) return;
    this.hexSealEl.addEventListener('pointerdown', this.handleSealPointerDown);
    this.hexSealEl.addEventListener('pointerup', this.handleSealPointerEnd);
    this.hexSealEl.addEventListener('pointerleave', this.handleSealPointerEnd);
    this.hexSealEl.addEventListener('pointercancel', this.handleSealPointerEnd);
    this.hexSealEl.addEventListener('click', this.handleSealClick);
  }

  private spotlightJoinCta(): void {
    const openJoinBtn = document.getElementById('btnOpenJoinModal') as HTMLButtonElement | null;
    const googleBtn = document.getElementById('btnGoogleSignIn') as HTMLButtonElement | null;
    const targetBtn =
      openJoinBtn && !openJoinBtn.classList.contains('hidden') ? openJoinBtn : googleBtn;
    if (!targetBtn) return;

    targetBtn.classList.add('cta-seal-spotlight');
    try {
      targetBtn.focus({ preventScroll: true });
    } catch {
      // Ignore focus errors
    }
    window.setTimeout(() => {
      targetBtn.classList.remove('cta-seal-spotlight');
    }, 900);
  }

  private handleSealPointerDown = (): void => {
    if (!this.hexSealEl || this.disposed) return;
    this.audio.unlockFromGesture(false);
    this.clearSealHold();
    this.hexSealEl.dataset.sealHolding = 'true';
    this.hexSealEl.dataset.sealProgress = '1';
    this.audio.playHexStep(0);

    for (let step = 1; step < 6; step++) {
      const tid = window.setTimeout(() => {
        if (!this.hexSealEl || this.disposed) return;
        this.hexSealEl.dataset.sealProgress = String(step + 1);
        this.audio.playHexStep(step);
        if (step === 5) {
          this.sealArmed = true;
          this.hexSealEl.dataset.sealArmed = 'true';
          this.hexSealEl.dataset.sealHolding = 'false';
          this.audio.playConfirmSeal();
          this.syncLabels();
          this.spotlightJoinCta();
        }
      }, step * 115);
      this.sealHoldTimers.push(tid);
    }
  };

  private handleSealPointerEnd = (): void => {
    this.clearSealHold();
    if (!this.hexSealEl) return;
    this.hexSealEl.dataset.sealHolding = 'false';
    if (!this.sealArmed) {
      this.hexSealEl.dataset.sealProgress = '6';
    }
  };

  private handleSealClick = (): void => {
    if (!this.hexSealEl || this.disposed) return;
    this.audio.playMechanicalTick();
    this.spotlightJoinCta();
  };

  private handleScreenPointerDown = (ev: PointerEvent): void => {
    this.audio.unlockFromGesture(true);
    this.gyro.requestGyroFromGesture();

    // Instant tap-to-skip when user touches the portal or backdrop during the cold entrance
    if (this.screen.dataset.tunnelPlaying === 'true') {
      const target = ev.target as HTMLElement | null;
      if (target && (target.closest('.tunnel-hero-portal') || target === this.screen)) {
        this.skip();
      }
    }
  };

  private handleMechanicalTick = (): void => {
    this.audio.playMechanicalTick();
  };

  private handleConfirmSeal = (): void => {
    this.audio.playConfirmSeal();
  };

  private handleSkipClick = (): void => {
    this.audio.playMechanicalTick();
    this.skip();
  };

  private handleKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && this.screen.dataset.tunnelPlaying === 'true') {
      this.skip();
    }
  };

  public destroy(): void {
    this.disposed = true;
    this.clearTimers();
    this.clearSweepTimer();
    this.clearExitTimer();
    this.clearSealHold();
    this.gyro.destroy();
    this.audio.destroy();

    if (this.skipBtn) this.skipBtn.removeEventListener('click', this.handleSkipClick);
    this.screen.removeEventListener('pointerdown', this.handleScreenPointerDown);

    const tickIds = ['loginTabSignIn', 'loginTabSignUp', 'btnLoginLangAr', 'btnLoginLangEn'];
    for (const id of tickIds) {
      const el = document.getElementById(id);
      if (el) el.removeEventListener('pointerdown', this.handleMechanicalTick);
    }
    const rememberChk = document.getElementById('chkRememberDevice');
    if (rememberChk) rememberChk.removeEventListener('change', this.handleMechanicalTick);

    const confirmIds = ['btnGoogleSignIn', 'btnEnterDemo', 'btnOpenJoinModal'];
    for (const id of confirmIds) {
      const el = document.getElementById(id);
      if (el) el.removeEventListener('pointerdown', this.handleConfirmSeal);
    }

    if (this.hexSealEl) {
      this.hexSealEl.removeEventListener('pointerdown', this.handleSealPointerDown);
      this.hexSealEl.removeEventListener('pointerup', this.handleSealPointerEnd);
      this.hexSealEl.removeEventListener('pointerleave', this.handleSealPointerEnd);
      this.hexSealEl.removeEventListener('pointercancel', this.handleSealPointerEnd);
      this.hexSealEl.removeEventListener('click', this.handleSealClick);
    }

    window.removeEventListener('keydown', this.handleKeyDown);
  }
}

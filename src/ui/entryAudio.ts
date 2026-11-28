/**
 * MAYDAN 6V6 — GENERATIVE ENTRY AUDIO & SAFE HAPTIC SIGNATURE ENGINE
 * 0 KB external audio assets — 100% pure Web Audio API synthesis.
 * Strictly resumes AudioContext inside the first user pointerdown gesture
 * (100% iOS Safari & Android Chrome Autoplay compliant) and fails silently
 * when audio/vibration is unsupported or muted.
 */

export const ENTRY_AUDIO_SPEC = {
  startPulseCutoffHz: 550,
  startPulseHapticMs: 8,
  mechanicalTickDurationMs: 12,
  confirmClickFreqHz: 2400,
  confirmClickDurationMs: 12,
  confirmBassFreqHz: 55,
  confirmBassDurationMs: 180,
  confirmHapticPattern: [10, 24, 12] as readonly number[],
};

export function clampAudioGain(value: number, maxGain: number = 0.14): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(maxGain, value));
}

export function isVibrationSupported(nav?: { vibrate?: unknown } | null): boolean {
  return Boolean(nav && typeof nav.vibrate === 'function');
}

type AudioContextCtor = typeof AudioContext;

function getAudioContextCtor(): AudioContextCtor | null {
  if (typeof window === 'undefined') return null;
  const win = window as Window & { webkitAudioContext?: AudioContextCtor };
  return window.AudioContext || win.webkitAudioContext || null;
}

export class EntryAudioEngine {
  private ctx: AudioContext | null = null;
  private unlocked = false;
  private startPulsePlayed = false;
  private disposed = false;

  private safeVibrate(pattern: number | readonly number[]): void {
    try {
      if (typeof navigator !== 'undefined' && isVibrationSupported(navigator)) {
        navigator.vibrate(Array.isArray(pattern) ? [...pattern] : (pattern as number));
      }
    } catch {
      // Ignore vibration denial or unsupported environments
    }
  }

  private ensureContext(): AudioContext | null {
    if (this.disposed) return null;
    if (this.ctx) return this.ctx;
    const Ctor = getAudioContextCtor();
    if (!Ctor) return null;
    try {
      this.ctx = new Ctor();
      return this.ctx;
    } catch {
      return null;
    }
  }

  /**
   * Must only be called from a direct user gesture (e.g. pointerdown).
   * Resumes AudioContext safely and optionally plays the initial warm carbon pulse once.
   */
  public unlockFromGesture(withStartPulse: boolean = false): void {
    if (this.disposed) return;
    const ctx = this.ensureContext();
    if (!ctx) {
      if (withStartPulse && !this.startPulsePlayed) {
        this.startPulsePlayed = true;
        this.safeVibrate(ENTRY_AUDIO_SPEC.startPulseHapticMs);
      }
      return;
    }
    try {
      const finalize = () => {
        this.unlocked = ctx.state === 'running';
        if (withStartPulse && !this.startPulsePlayed) {
          this.startPulsePlayed = true;
          this.playStartPulse();
        }
      };
      if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
        const maybePromise = ctx.resume();
        if (maybePromise && typeof maybePromise.then === 'function') {
          maybePromise.then(finalize).catch(() => {
            // Autoplay or audio policy declined — stay silent with zero console errors
          });
        } else {
          finalize();
        }
      } else {
        finalize();
      }
    } catch {
      // Fail silently on restricted devices
    }
  }

  /**
   * 1. Touch-start signature: warm, subdued carbon pulse (Low-pass @ 550Hz) + safe 8ms haptic.
   */
  public playStartPulse(): void {
    if (this.disposed) return;
    this.safeVibrate(ENTRY_AUDIO_SPEC.startPulseHapticMs);
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;

    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(118, now);
      osc.frequency.exponentialRampToValueAtTime(64, now + 0.11);

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(ENTRY_AUDIO_SPEC.startPulseCutoffHz, now);
      filter.Q.setValueAtTime(0.9, now);

      const peak = clampAudioGain(0.085, 0.12);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(peak, now + 0.014);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.13);
    } catch {
      // Fail silently
    }
  }

  /**
   * 2. Tab / Mechanical Toggle Switch signature: crisp, dry 12ms Swiss detent tick.
   */
  public playMechanicalTick(): void {
    if (this.disposed) return;
    this.unlockFromGesture(false);
    this.safeVibrate(6);
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;

    try {
      const now = ctx.currentTime;
      const durSec = ENTRY_AUDIO_SPEC.mechanicalTickDurationMs / 1000;

      const osc = ctx.createOscillator();
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(1750, now);
      osc.frequency.exponentialRampToValueAtTime(760, now + durSec);

      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(1500, now);
      filter.Q.setValueAtTime(1.8, now);

      const peak = clampAudioGain(0.065, 0.1);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(peak, now + 0.002);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + durSec);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + durSec + 0.005);
    } catch {
      // Fail silently
    }
  }

  /**
   * Progressive edge tick for the Invite Hex Contract Seal hold gesture (steps 0..5).
   */
  public playHexStep(stepIndex: number): void {
    if (this.disposed) return;
    const idx = Math.max(0, Math.min(5, Math.floor(stepIndex)));
    this.safeVibrate(6 + idx * 2);
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;

    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      const freq = 920 + idx * 140;
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now);

      const peak = clampAudioGain(0.045 + idx * 0.006, 0.1);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(peak, now + 0.004);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.045);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.05);
    } catch {
      // Fail silently
    }
  }

  /**
   * 3. Entry Confirmation signature:
   * Clean 2.4kHz seal click (12ms) + warm 55Hz sub-bass decay (180ms) + safe double haptic [10, 24, 12].
   */
  public playConfirmSeal(): void {
    if (this.disposed) return;
    this.unlockFromGesture(false);
    this.safeVibrate(ENTRY_AUDIO_SPEC.confirmHapticPattern);
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;

    try {
      const now = ctx.currentTime;
      const clickDur = ENTRY_AUDIO_SPEC.confirmClickDurationMs / 1000;
      const bassDur = ENTRY_AUDIO_SPEC.confirmBassDurationMs / 1000;

      // Crisp 2.4kHz seal click (12ms)
      const clickOsc = ctx.createOscillator();
      const clickGain = ctx.createGain();
      clickOsc.type = 'sine';
      clickOsc.frequency.setValueAtTime(ENTRY_AUDIO_SPEC.confirmClickFreqHz, now);
      clickOsc.frequency.exponentialRampToValueAtTime(1650, now + clickDur);

      clickGain.gain.setValueAtTime(0.0001, now);
      clickGain.gain.linearRampToValueAtTime(clampAudioGain(0.075, 0.1), now + 0.002);
      clickGain.gain.exponentialRampToValueAtTime(0.0001, now + clickDur);

      clickOsc.connect(clickGain);
      clickGain.connect(ctx.destination);
      clickOsc.start(now);
      clickOsc.stop(now + clickDur + 0.005);

      // Warm 55Hz sub-bass resonance fading over 180ms
      const bassOsc = ctx.createOscillator();
      const bassFilter = ctx.createBiquadFilter();
      const bassGain = ctx.createGain();

      bassOsc.type = 'sine';
      bassOsc.frequency.setValueAtTime(ENTRY_AUDIO_SPEC.confirmBassFreqHz, now + 0.008);
      bassOsc.frequency.exponentialRampToValueAtTime(46, now + 0.008 + bassDur);

      bassFilter.type = 'lowpass';
      bassFilter.frequency.setValueAtTime(180, now + 0.008);

      bassGain.gain.setValueAtTime(0.0001, now + 0.008);
      bassGain.gain.linearRampToValueAtTime(clampAudioGain(0.115, 0.14), now + 0.028);
      bassGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.008 + bassDur);

      bassOsc.connect(bassFilter);
      bassFilter.connect(bassGain);
      bassGain.connect(ctx.destination);
      bassOsc.start(now + 0.008);
      bassOsc.stop(now + 0.02 + bassDur);
    } catch {
      // Fail silently
    }
  }

  public isUnlocked(): boolean {
    return this.unlocked;
  }

  public destroy(): void {
    this.disposed = true;
    if (this.ctx) {
      try {
        if (typeof this.ctx.close === 'function' && this.ctx.state !== 'closed') {
          void this.ctx.close();
        }
      } catch {
        // Ignore teardown errors
      }
      this.ctx = null;
    }
  }
}

let sharedAppAudioCtx: AudioContext | null = null;

/**
 * Returns a single shared AudioContext across the entire application so sound cues
 * (Pit-Wall alerts, Blind-Side Radar spatial cues, ChronoLock detents, Tactical Studio)
 * never leak new AudioContext instances on mobile browsers.
 */
export function getSharedAudioContext(): AudioContext | null {
  try {
    if (sharedAppAudioCtx && sharedAppAudioCtx.state !== 'closed') {
      if (sharedAppAudioCtx.state === 'suspended' && typeof sharedAppAudioCtx.resume === 'function') {
        void sharedAppAudioCtx.resume().catch(() => {});
      }
      return sharedAppAudioCtx;
    }
    const Ctor = getAudioContextCtor();
    if (!Ctor) return null;
    sharedAppAudioCtx = new Ctor();
    return sharedAppAudioCtx;
  } catch {
    return null;
  }
}


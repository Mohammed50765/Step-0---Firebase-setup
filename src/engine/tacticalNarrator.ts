/**
 * MAYDAN BLACK BOX — TACTICAL NEURAL NARRATOR
 * Documentary-style male Arabic tactical analyst voice + subtle optional Web Audio cinematic pad.
 *
 * Strictly honors:
 * - Zero paid APIs or external audio dependencies
 * - Browser autoplay policies (audio starts ONLY after explicit user interaction)
 * - Background music never competes with speech (automatic ducking while speaking)
 * - Clean mute, volume, pause, resume, replay, and unavailable-audio fallback
 * - Zero audio resource leaks (`dispose()` releases AudioContext and cancels SpeechSynthesis)
 */

import {
  prepareArabicNarrationText,
  estimateSpeechTimeoutMs,
  type VoiceCandidate,
} from '../tacticsVoice';

export interface NarratorAudioState {
  userUnlocked: boolean;
  muted: boolean;
  volume: number; // 0..1
  speechEnabled: boolean;
  musicEnabled: boolean;
  speechAvailable: boolean;
  webAudioAvailable: boolean;
  isSpeaking: boolean;
  isPaused: boolean;
  selectedVoiceName: string | null;
}

const ARABIC_LOCALE_ORDER = ['ar-sa', 'ar-ae', 'ar-eg', 'ar-jo', 'ar-kw', 'ar-qa', 'ar-001', 'ar'];
const MALE_VOICE_HINTS = ['maged', 'tarik', 'naayf', 'hamed', 'bassel', 'omar', 'shakir', 'hamdan', 'fahed', 'male'];
const FEMALE_VOICE_HINTS = ['laila', 'mariam', 'zariyah', 'salma', 'amina', 'rana', 'sana', 'fatima', 'female'];

/**
 * Ranks browser Arabic voices specifically toward a calm, warm male documentary analyst persona.
 */
export function pickDocumentaryMaleArabicVoice<T extends VoiceCandidate>(
  voices: ReadonlyArray<T>
): T | null {
  if (!voices || voices.length === 0) return null;
  const arabic = voices.filter((v) => String(v.lang || '').toLowerCase().startsWith('ar'));
  if (arabic.length === 0) return null;

  let best: T = arabic[0];
  let bestScore = -999;

  for (const v of arabic) {
    const lang = String(v.lang || '').toLowerCase().replace('_', '-');
    const name = String(v.name || '').toLowerCase();
    let score = 20;

    const localeIdx = ARABIC_LOCALE_ORDER.indexOf(lang);
    if (localeIdx >= 0) {
      score += (ARABIC_LOCALE_ORDER.length - localeIdx) * 8;
    } else if (lang.startsWith('ar-')) {
      score += 4;
    }

    if (v.localService) score += 10;
    if (name.includes('natural') || name.includes('enhanced') || name.includes('neural') || name.includes('premium')) {
      score += 14;
    }
    if (MALE_VOICE_HINTS.some((hint) => name.includes(hint))) {
      score += 24;
    }
    if (FEMALE_VOICE_HINTS.some((hint) => name.includes(hint))) {
      score -= 10;
    }

    if (score > bestScore) {
      bestScore = score;
      best = v;
    }
  }

  return best;
}

/**
 * Computes calm, documentary speech cadence parameters for the analyst voice.
 * Controlled moderate pace (never frantic) and slightly warm lower pitch.
 */
export function computeDocumentaryVoiceParams(playbackRate = 1): {
  rate: number;
  pitch: number;
} {
  const safeSpeed = Number.isFinite(playbackRate) ? playbackRate : 1;
  const rate = Number(Math.max(0.84, Math.min(1.12, 0.93 + (safeSpeed - 1) * 0.25)).toFixed(2));
  const pitch = 0.92;
  return { rate, pitch };
}

/**
 * Computes background music gain with automatic speech ducking so ambient music
 * never competes with the narrator on mobile speakers.
 */
export function computeAmbientGain(opts: {
  muted: boolean;
  musicEnabled: boolean;
  volume: number;
  isSpeaking: boolean;
}): number {
  if (opts.muted || !opts.musicEnabled) return 0;
  const vol = Math.max(0, Math.min(1, Number.isFinite(opts.volume) ? opts.volume : 0.8));
  const base = opts.isSpeaking ? 0.012 : 0.032;
  return Number((base * vol).toFixed(4));
}

export class TacticalNeuralNarrator {
  private state: NarratorAudioState;
  private audioCtx: AudioContext | null = null;
  private padGain: GainNode | null = null;
  private padOscs: OscillatorNode[] = [];
  private padFilter: BiquadFilterNode | null = null;
  private speechTimerId: number | null = null;
  private lastSpokenText = '';
  private onStateChange?: (state: NarratorAudioState) => void;
  private disposed = false;

  constructor(onStateChange?: (state: NarratorAudioState) => void) {
    this.onStateChange = onStateChange;
    const speechAvailable =
      typeof window !== 'undefined' &&
      'speechSynthesis' in window &&
      typeof SpeechSynthesisUtterance !== 'undefined';
    const webAudioAvailable =
      typeof window !== 'undefined' &&
      Boolean(
        window.AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      );

    this.state = {
      userUnlocked: false,
      muted: false,
      volume: 0.85,
      speechEnabled: true,
      musicEnabled: false, // Optional subtle cinematic music — user can enable anytime
      speechAvailable,
      webAudioAvailable,
      isSpeaking: false,
      isPaused: false,
      selectedVoiceName: null,
    };
  }

  public getState(): NarratorAudioState {
    return { ...this.state };
  }

  private emit(): void {
    if (this.disposed) return;
    this.onStateChange?.(this.getState());
  }

  /**
   * Must be called inside a user gesture handler (click/tap) to respect browser autoplay rules.
   */
  public unlockFromUserGesture(): void {
    if (this.disposed) return;
    this.state.userUnlocked = true;
    if (this.state.musicEnabled && !this.state.muted) {
      this.ensureAmbientPad();
    }
    this.updateAmbientPadGain();
    this.emit();
  }

  public setMuted(muted: boolean): void {
    this.state.muted = Boolean(muted);
    if (this.state.muted) {
      this.cancelSpeech();
    }
    this.updateAmbientPadGain();
    this.emit();
  }

  public toggleMute(): boolean {
    this.setMuted(!this.state.muted);
    return this.state.muted;
  }

  public setVolume(vol: number): void {
    this.state.volume = Math.max(0, Math.min(1, Number.isFinite(vol) ? vol : 0.85));
    this.updateAmbientPadGain();
    this.emit();
  }

  public setSpeechEnabled(enabled: boolean): void {
    this.state.speechEnabled = Boolean(enabled);
    if (!this.state.speechEnabled) {
      this.cancelSpeech();
    }
    this.emit();
  }

  public setMusicEnabled(enabled: boolean): void {
    this.state.musicEnabled = Boolean(enabled);
    if (this.state.musicEnabled && this.state.userUnlocked && !this.state.muted) {
      this.ensureAmbientPad();
    } else if (!this.state.musicEnabled) {
      this.stopAmbientPad();
    }
    this.updateAmbientPadGain();
    this.emit();
  }

  /**
   * Speaks a concise Arabic tactical narration segment if unlocked, unmuted, and supported.
   * Always safe to call when audio is muted or unavailable (graceful silent no-op).
   */
  public speakSegment(rawArabicText: string, playbackRate = 1): void {
    if (this.disposed) return;
    const clean = prepareArabicNarrationText(rawArabicText);
    this.lastSpokenText = clean;
    this.cancelSpeech();

    if (
      !clean ||
      !this.state.userUnlocked ||
      this.state.muted ||
      !this.state.speechEnabled ||
      !this.state.speechAvailable
    ) {
      this.updateAmbientPadGain();
      return;
    }

    try {
      const synth = window.speechSynthesis;
      const utter = new SpeechSynthesisUtterance(clean);
      const voices = typeof synth.getVoices === 'function' ? synth.getVoices() : [];
      const voice = pickDocumentaryMaleArabicVoice(voices);
      if (voice) {
        utter.voice = voice;
        utter.lang = voice.lang || 'ar-SA';
        this.state.selectedVoiceName = voice.name;
      } else {
        utter.lang = 'ar-SA';
      }

      const { rate, pitch } = computeDocumentaryVoiceParams(playbackRate);
      utter.rate = rate;
      utter.pitch = pitch;
      utter.volume = Math.max(0.1, Math.min(1, this.state.volume));

      this.state.isSpeaking = true;
      this.state.isPaused = false;
      this.updateAmbientPadGain();
      this.emit();

      const clearSpeaking = () => {
        if (this.speechTimerId !== null) {
          window.clearTimeout(this.speechTimerId);
          this.speechTimerId = null;
        }
        this.state.isSpeaking = false;
        this.state.isPaused = false;
        this.updateAmbientPadGain();
        this.emit();
      };

      utter.onend = clearSpeaking;
      utter.onerror = clearSpeaking;

      const safetyMs = estimateSpeechTimeoutMs(clean, rate);
      this.speechTimerId = window.setTimeout(clearSpeaking, safetyMs);
      synth.speak(utter);
    } catch {
      this.state.isSpeaking = false;
      this.updateAmbientPadGain();
      this.emit();
    }
  }

  public pause(): void {
    if (this.disposed) return;
    this.state.isPaused = true;
    try {
      if (this.state.speechAvailable && window.speechSynthesis.speaking) {
        window.speechSynthesis.pause();
      }
      if (this.audioCtx && this.audioCtx.state === 'running') {
        void this.audioCtx.suspend();
      }
    } catch {
      // Graceful fallback
    }
    this.emit();
  }

  public resume(): void {
    if (this.disposed) return;
    this.state.isPaused = false;
    try {
      if (this.state.speechAvailable && window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      }
      if (this.audioCtx && this.audioCtx.state === 'suspended' && this.state.musicEnabled && !this.state.muted) {
        void this.audioCtx.resume();
      }
    } catch {
      // Graceful fallback
    }
    this.emit();
  }

  public cancelSpeech(): void {
    if (this.speechTimerId !== null) {
      window.clearTimeout(this.speechTimerId);
      this.speechTimerId = null;
    }
    this.state.isSpeaking = false;
    this.state.isPaused = false;
    if (this.state.speechAvailable) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // Ignore browser cancel quirk
      }
    }
    this.updateAmbientPadGain();
  }

  /**
   * Occasional ultra-soft interaction feedback (subtle low-gain tone only — no whistles/beeps).
   */
  public playSoftFeedback(kind: 'select' | 'correct' | 'mistake'): void {
    if (this.disposed || !this.state.userUnlocked || this.state.muted || !this.state.webAudioAvailable) {
      return;
    }
    try {
      const ctx = this.ensureAudioContext();
      if (!ctx) return;
      if (ctx.state === 'suspended') {
        void ctx.resume();
      }
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';

      const freq = kind === 'correct' ? 523.25 : kind === 'mistake' ? 220 : 392;
      osc.frequency.setValueAtTime(freq, now);
      if (kind === 'correct') {
        osc.frequency.exponentialRampToValueAtTime(659.25, now + 0.12);
      }

      const peak = Math.max(0.005, 0.032 * this.state.volume);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(peak, now + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.18);
    } catch {
      // Silent no-op when audio is restricted
    }
  }

  private ensureAudioContext(): AudioContext | null {
    if (!this.state.webAudioAvailable) return null;
    if (!this.audioCtx) {
      const AudioCtxCtor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtxCtor) return null;
      this.audioCtx = new AudioCtxCtor();
    }
    return this.audioCtx;
  }

  /**
   * Builds a subtle, warm, low-pass documentary chord pad (D2 + A2) using pure Web Audio.
   * Never competes with speech thanks to automatic gain ducking.
   */
  private ensureAmbientPad(): void {
    if (!this.state.userUnlocked || this.state.muted || !this.state.musicEnabled) return;
    const ctx = this.ensureAudioContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      void ctx.resume();
    }
    if (this.padOscs.length > 0) return;

    try {
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(240, ctx.currentTime);
      filter.Q.setValueAtTime(0.7, ctx.currentTime);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);

      filter.connect(gain);
      gain.connect(ctx.destination);

      const freqs = [73.42, 110.0]; // Warm D2 + A2 open fifth documentary pad
      const oscs: OscillatorNode[] = [];
      for (const f of freqs) {
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(f, ctx.currentTime);
        osc.connect(filter);
        osc.start();
        oscs.push(osc);
      }

      this.padFilter = filter;
      this.padGain = gain;
      this.padOscs = oscs;
      this.updateAmbientPadGain();
    } catch {
      this.stopAmbientPad();
    }
  }

  private updateAmbientPadGain(): void {
    if (!this.audioCtx || !this.padGain) return;
    const target = computeAmbientGain({
      muted: this.state.muted,
      musicEnabled: this.state.musicEnabled,
      volume: this.state.volume,
      isSpeaking: this.state.isSpeaking,
    });
    try {
      this.padGain.gain.cancelScheduledValues(this.audioCtx.currentTime);
      this.padGain.gain.setTargetAtTime(target, this.audioCtx.currentTime, 0.15);
    } catch {
      // Ignore closed context
    }
  }

  private stopAmbientPad(): void {
    for (const osc of this.padOscs) {
      try {
        osc.stop();
        osc.disconnect();
      } catch {
        // Ignore
      }
    }
    this.padOscs = [];
    if (this.padFilter) {
      try {
        this.padFilter.disconnect();
      } catch {
        // Ignore
      }
      this.padFilter = null;
    }
    if (this.padGain) {
      try {
        this.padGain.disconnect();
      } catch {
        // Ignore
      }
      this.padGain = null;
    }
  }

  public getLastSpokenText(): string {
    return this.lastSpokenText;
  }

  public dispose(): void {
    this.disposed = true;
    this.cancelSpeech();
    this.stopAmbientPad();
    if (this.audioCtx) {
      try {
        void this.audioCtx.close();
      } catch {
        // Ignore
      }
      this.audioCtx = null;
    }
  }
}

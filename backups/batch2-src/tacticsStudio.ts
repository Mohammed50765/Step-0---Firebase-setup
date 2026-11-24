import {
  PITCH_SIZE_META,
  FORMATIONS_CATALOG,
  TACTICAL_SCENARIOS_10,
  GK_TACTICAL_GUIDE,
  getFormationDef,
  getFormationPhaseSequence,
  getRoleSpotlightSequence,
  computePlayerOvr,
  computeTeamChemistry,
  splitFairTeams,
  suggestSmartLineup,
  buildRotationPlan,
  type PitchSizeId,
  type TacticalPhaseId,
  type TacticalKeyframe,
  type TacticalSequence,
  type RoleSpotlightInfo,
  type MinimalPlayer,
} from './tacticsData';
import { escapeHtml, sanitizeImageDataUrl } from './security';

const STUDIO_STORAGE_KEY = 'maydan_tactics_studio_v1';
const SVG_W = 360;
const SVG_H = 520;

export type StudioViewMode = 'studio' | 'poster' | 'fifa';
export type CaptainToolTab = 'smart' | 'split' | 'roles' | 'gk' | 'rotate';

interface CustomPlan {
  id: string;
  name: string;
  size: PitchSizeId;
  formationId: string;
  frames: TacticalKeyframe[];
}

interface StudioPrefs {
  size: PitchSizeId;
  formationBySize: Record<PitchSizeId, string>;
  extraSlots: Record<string, string>;
  setPieces: {
    captainId: string;
    cornerId: string;
    freeKickId: string;
    backupGkId: string;
  };
  customPlans: CustomPlan[];
  rotationInterval: number;
}

export interface StudioContext {
  getPlayers: () => MinimalPlayer[];
  getTactics: () => { formation: string; slots: Record<string, string> };
  setTactics: (next: { formation: string; slots: Record<string, string> }) => void;
  getTeamSettings: () => { teamName?: string; logo?: string };
  isAdmin: () => boolean;
  isFirebaseMode: () => boolean;
  openSlotPicker: (slotLabel: string, currentPlayerId: string | undefined, onPick: (playerId: string) => void) => void;
  openPngPreview: (dataUrl: string, blob: Blob | null, fileName: string, title: string) => void;
  toast: (msg: string, isErr?: boolean, withUndo?: boolean) => void;
  takeSnapshot: () => void;
}

function defaultPrefs(): StudioPrefs {
  return {
    size: '6v6',
    formationBySize: {
      '5v5': '1-2-1',
      '6v6': '2-2-1',
      '7v7': '2-3-1',
      '11v11': '4-3-3',
    },
    extraSlots: {},
    setPieces: { captainId: '', cornerId: '', freeKickId: '', backupGkId: '' },
    customPlans: [],
    rotationInterval: 12,
  };
}

function loadPrefs(): StudioPrefs {
  try {
    const raw = localStorage.getItem(STUDIO_STORAGE_KEY);
    if (!raw) return defaultPrefs();
    const parsed = JSON.parse(raw);
    const base = defaultPrefs();
    return {
      size: (['5v5', '6v6', '7v7', '11v11'].includes(parsed.size) ? parsed.size : '6v6') as PitchSizeId,
      formationBySize: { ...base.formationBySize, ...(parsed.formationBySize || {}) },
      extraSlots: parsed.extraSlots && typeof parsed.extraSlots === 'object' ? parsed.extraSlots : {},
      setPieces: { ...base.setPieces, ...(parsed.setPieces || {}) },
      customPlans: Array.isArray(parsed.customPlans) ? parsed.customPlans.slice(0, 12) : [],
      rotationInterval: [12, 14, 15].includes(Number(parsed.rotationInterval)) ? Number(parsed.rotationInterval) : 12,
    };
  } catch {
    return defaultPrefs();
  }
}

function savePrefs(prefs: StudioPrefs): void {
  try {
    localStorage.setItem(STUDIO_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Ignore quota errors in restricted storage
  }
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function toSvgX(x: number): number {
  return 18 + (Math.max(2, Math.min(98, x)) / 100) * (SVG_W - 36);
}

function toSvgY(y: number): number {
  return 20 + (Math.max(2, Math.min(98, y)) / 100) * (SVG_H - 40);
}

function fromSvgX(px: number): number {
  return Math.max(6, Math.min(94, ((px - 18) / (SVG_W - 36)) * 100));
}

function fromSvgY(py: number): number {
  return Math.max(7, Math.min(94, ((py - 20) / (SVG_H - 40)) * 100));
}

// Legacy 6v6 row/col mapping for backwards compatibility with older saved tactics
const LEGACY_ROWS_6V6: Record<string, number[]> = {
  '2-2-1': [1, 2, 2, 1],
  '1-2-2': [2, 2, 1, 1],
  '2-1-2': [2, 1, 2, 1],
  '3-1-1': [1, 1, 3, 1],
  '1-3-1': [1, 3, 1, 1],
};

function getLegacyKeyForSlot(formId: string, slotIdx: number, totalSlots: number): string | null {
  const rows = LEGACY_ROWS_6V6[formId];
  if (!rows) return null;
  // In legacy HTML rows were rendered top (forwards) -> bottom (GK).
  // In FORMATIONS_CATALOG slots are indexed bottom (GK=0) -> top (forwards).
  const reversedIdx = totalSlots - 1 - slotIdx;
  let cursor = 0;
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < rows[r]; c++) {
      if (cursor === reversedIdx) return `${formId}_${r}_${c}`;
      cursor++;
    }
  }
  return null;
}

function firstWord(name?: string): string {
  return String(name || '').trim().split(/\s+/)[0] || '';
}

function playSubAlertBeep(): void {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;
    [660, 880].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + i * 0.22);
      gain.gain.setValueAtTime(0.14, now + i * 0.22);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.22 + 0.2);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + i * 0.22);
      osc.stop(now + i * 0.22 + 0.21);
    });
  } catch {
    // WebAudio blocked or unsupported
  }
}

class TacticsStudioController {
  private ctx: StudioContext | null = null;
  private prefs: StudioPrefs = loadPrefs();
  private mounted = false;

  // View & tactical modes
  private viewMode: StudioViewMode = 'studio';
  private phase: TacticalPhaseId = 'attack';
  private activeScenarioId: string | null = null;
  private scenarioCatFilter: string = 'الكل';
  private spotlightSlotIdx: number | null = null;
  private spotlightInfo: RoleSpotlightInfo | null = null;
  private is25D = true;
  private showTriangles = true;
  private showOpponents = true;
  private captainTab: CaptainToolTab = 'smart';

  // Sequence & keyframe engine
  private sequence: TacticalSequence;
  private frameIdx = 0;
  private isPlaying = false;
  private speed = 1;
  private voiceEnabled = false;
  private rafId: number | null = null;
  private stepTimerId: number | null = null;
  private speechSafetyTimer: number | null = null;
  private transitionStart = 0;
  private transitionDuration = 750;
  private fromFrame: TacticalKeyframe | null = null;

  // Live rendered coordinates (also mutated by drag & drop)
  private currentOur: Array<{ x: number; y: number }> = [];
  private currentOpp: Array<{ x: number; y: number }> = [];
  private currentBall: { x: number; y: number } = { x: 50, y: 50 };

  // Dragging state
  private dragTarget: { kind: 'our' | 'opp' | 'ball'; idx: number } | null = null;
  private dragStartClient = { x: 0, y: 0 };
  private dragMoved = false;

  // Custom plan recorder
  private isRecordingMode = false;
  private recordedFrames: TacticalKeyframe[] = [];

  // Rotation countdown timer
  private timerSecondsLeft = 12 * 60;
  private timerRunning = false;
  private timerIntervalId: number | null = null;

  constructor() {
    this.sequence = getFormationPhaseSequence('6v6', '2-2-1', 'attack');
    this.applyFrameImmediate(0);
  }

  public mount(ctx: StudioContext): void {
    this.ctx = ctx;
    if (this.mounted) {
      this.syncData();
      return;
    }
    this.mounted = true;

    // Respect initial Data Saver mode
    if (document.body.classList.contains('data-saver')) {
      this.is25D = false;
    }
    this.timerSecondsLeft = this.prefs.rotationInterval * 60;

    // Sync initial 6v6 formation with saved db.tactics
    const saved = ctx.getTactics();
    if (saved && saved.formation && FORMATIONS_CATALOG['6v6'].some((f) => f.id === saved.formation)) {
      this.prefs.formationBySize['6v6'] = saved.formation;
    }

    this.loadCurrentPhaseSequence(false);
    this.bindStaticEvents();
    this.renderAll();
  }

  public syncData(): void {
    if (!this.ctx || !this.mounted) return;
    const saved = this.ctx.getTactics();
    if (this.prefs.size === '6v6' && saved?.formation && FORMATIONS_CATALOG['6v6'].some((f) => f.id === saved.formation)) {
      if (this.prefs.formationBySize['6v6'] !== saved.formation) {
        this.prefs.formationBySize['6v6'] = saved.formation;
        if (!this.activeScenarioId && this.spotlightSlotIdx === null) {
          this.loadCurrentPhaseSequence(false);
        }
      }
    }
    this.renderAll();
  }

  public onDataSaverChanged(isDataSaver: boolean): void {
    if (isDataSaver) {
      this.is25D = false;
      this.pause();
    }
    this.renderPitchShellClasses();
    this.renderToolbarState();
  }

  public onTabDeactivated(): void {
    this.pause();
    this.stopSpeech();
  }

  public getPitchSize(): PitchSizeId {
    return this.prefs.size;
  }

  public setPitchSize(sz: PitchSizeId): void {
    if (!(['5v5', '6v6', '7v7', '11v11'] as PitchSizeId[]).includes(sz)) return;
    if (sz === this.prefs.size) return;
    this.prefs.size = sz;
    savePrefs(this.prefs);
    this.activeScenarioId = null;
    this.spotlightSlotIdx = null;
    this.spotlightInfo = null;
    this.loadCurrentPhaseSequence(false);
    if (this.mounted) this.renderAll();
    window.dispatchEvent(new CustomEvent('maydan:pitchSizeChanged', { detail: { size: sz } }));
  }

  public onFormationSelectChanged(formationId: string): void {
    const size = this.prefs.size;
    const valid = FORMATIONS_CATALOG[size].some((f) => f.id === formationId);
    if (!valid) return;
    this.prefs.formationBySize[size] = formationId;
    savePrefs(this.prefs);

    if (size === '6v6' && this.ctx) {
      const t = this.ctx.getTactics();
      this.ctx.setTactics({ formation: formationId, slots: { ...(t.slots || {}) } });
    }
    this.activeScenarioId = null;
    this.spotlightSlotIdx = null;
    this.spotlightInfo = null;
    this.loadCurrentPhaseSequence(false);
    this.renderAll();
  }

  private getCurrentFormationId(): string {
    return this.prefs.formationBySize[this.prefs.size] || FORMATIONS_CATALOG[this.prefs.size][0].id;
  }

  private getCurrentFormation() {
    return getFormationDef(this.prefs.size, this.getCurrentFormationId());
  }

  private getSlotPlayerId(formId: string, slotIdx: number, totalSlots: number): string | undefined {
    const size = this.prefs.size;
    if (size === '6v6' && this.ctx) {
      const slots = this.ctx.getTactics().slots || {};
      const direct = slots[`${formId}_${slotIdx}`];
      if (direct) return direct;
      const legacyKey = getLegacyKeyForSlot(formId, slotIdx, totalSlots);
      if (legacyKey && slots[legacyKey]) return slots[legacyKey];
      return undefined;
    }
    return this.prefs.extraSlots[`${size}_${formId}_${slotIdx}`];
  }

  private setSlotPlayerId(formId: string, slotIdx: number, playerId: string): void {
    const size = this.prefs.size;
    if (size === '6v6' && this.ctx) {
      const t = this.ctx.getTactics();
      const nextSlots: Record<string, string> = {};
      const form = this.getCurrentFormation();
      // Normalize existing 6v6 keys cleanly (keep <= 20 entries for Firestore rules!)
      form.slots.forEach((_, i) => {
        const existing = this.getSlotPlayerId(formId, i, form.slots.length);
        if (existing) nextSlots[`${formId}_${i}`] = existing;
      });
      if (playerId) nextSlots[`${formId}_${slotIdx}`] = playerId;
      else delete nextSlots[`${formId}_${slotIdx}`];
      this.ctx.setTactics({ formation: formId, slots: nextSlots });
    } else {
      if (playerId) this.prefs.extraSlots[`${size}_${formId}_${slotIdx}`] = playerId;
      else delete this.prefs.extraSlots[`${size}_${formId}_${slotIdx}`];
      savePrefs(this.prefs);
    }
  }

  private getAssignedPlayersForCurrentFormation(): Array<MinimalPlayer | undefined> {
    const form = this.getCurrentFormation();
    const players = this.ctx ? this.ctx.getPlayers() : [];
    return form.slots.map((_, idx) => {
      const pid = this.getSlotPlayerId(form.id, idx, form.slots.length);
      return pid ? players.find((p) => p.id === pid) : undefined;
    });
  }

  private loadCurrentPhaseSequence(autoPlay: boolean): void {
    this.pause();
    const formId = this.getCurrentFormationId();
    this.sequence = getFormationPhaseSequence(this.prefs.size, formId, this.phase);
    this.frameIdx = 0;
    this.applyFrameImmediate(0);
    if (autoPlay && !document.body.classList.contains('data-saver')) {
      this.play();
    }
  }

  private loadScenario(scenarioId: string): void {
    const sc = TACTICAL_SCENARIOS_10.find((s) => s.id === scenarioId);
    if (!sc) return;
    this.pause();
    this.viewMode = 'studio';
    this.prefs.size = '6v6';
    this.activeScenarioId = sc.id;
    this.spotlightSlotIdx = null;
    this.spotlightInfo = null;
    this.sequence = {
      id: sc.id,
      title: `${sc.icon} ${sc.title}`,
      subtitle: sc.summary,
      size: '6v6',
      offsideEnabled: false,
      frames: sc.frames,
    };
    this.frameIdx = 0;
    this.applyFrameImmediate(0);
    this.renderAll();
    if (!document.body.classList.contains('data-saver')) {
      this.play();
    }
    const pitchEl = document.getElementById('tacStudioViewport');
    if (pitchEl) pitchEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  private enterRoleSpotlight(slotIdx: number): void {
    this.pause();
    const formId = this.getCurrentFormationId();
    this.activeScenarioId = null;
    this.spotlightSlotIdx = slotIdx;
    this.spotlightInfo = getRoleSpotlightSequence(this.prefs.size, formId, slotIdx);
    this.sequence = this.spotlightInfo.sequence;
    this.frameIdx = 0;
    this.applyFrameImmediate(0);
    this.renderAll();
    if (!document.body.classList.contains('data-saver')) {
      this.play();
    }
  }

  private exitRoleSpotlight(): void {
    if (this.spotlightSlotIdx === null) return;
    this.spotlightSlotIdx = null;
    this.spotlightInfo = null;
    this.loadCurrentPhaseSequence(false);
    this.renderAll();
  }

  // ==================== TIMELINE & ANIMATION ENGINE ====================

  private applyFrameImmediate(idx: number): void {
    const f = this.sequence.frames[idx] || this.sequence.frames[0];
    if (!f) return;
    this.currentOur = f.ourPos.map((p) => ({ ...p }));
    this.currentOpp = f.oppPos.map((p) => ({ ...p }));
    this.currentBall = { ...f.ball };
  }

  private goToFrame(idx: number, animate = true): void {
    const total = this.sequence.frames.length;
    if (!total) return;
    const clamped = Math.max(0, Math.min(total - 1, idx));
    const prevSnapshot: TacticalKeyframe = {
      ...(this.sequence.frames[this.frameIdx] || this.sequence.frames[0]),
      ourPos: this.currentOur.map((p) => ({ ...p })),
      oppPos: this.currentOpp.map((p) => ({ ...p })),
      ball: { ...this.currentBall },
    };
    this.frameIdx = clamped;
    const target = this.sequence.frames[clamped];

    this.renderNarrationAndTimeline();

    const shouldAnimate = animate && !document.body.classList.contains('data-saver');
    if (!shouldAnimate) {
      this.applyFrameImmediate(clamped);
      this.renderSvgPitch();
      return;
    }

    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.fromFrame = prevSnapshot;
    this.transitionStart = performance.now();
    this.transitionDuration = Math.max(360, Math.round(780 / this.speed));

    const tick = (now: number) => {
      const elapsed = now - this.transitionStart;
      const rawT = Math.min(1, elapsed / this.transitionDuration);
      const t = easeInOutCubic(rawT);
      const from = this.fromFrame!;

      this.currentOur = target.ourPos.map((tp, i) => {
        const fp = from.ourPos[i] || tp;
        return { x: fp.x + (tp.x - fp.x) * t, y: fp.y + (tp.y - fp.y) * t };
      });
      this.currentOpp = target.oppPos.map((tp, i) => {
        const fp = from.oppPos[i] || tp;
        return { x: fp.x + (tp.x - fp.x) * t, y: fp.y + (tp.y - fp.y) * t };
      });
      this.currentBall = {
        x: from.ball.x + (target.ball.x - from.ball.x) * t,
        y: from.ball.y + (target.ball.y - from.ball.y) * t,
      };

      this.renderSvgPitch();

      if (rawT < 1) {
        this.rafId = requestAnimationFrame(tick);
      } else {
        this.rafId = null;
      }
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private play(): void {
    if (this.sequence.frames.length === 0) return;
    if (this.frameIdx >= this.sequence.frames.length - 1) {
      this.frameIdx = 0;
      this.applyFrameImmediate(0);
    }
    this.isPlaying = true;
    this.renderTimelineButtons();
    this.scheduleCurrentStepPlayback(true);
  }

  private pause(): void {
    this.isPlaying = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.stepTimerId !== null) {
      window.clearTimeout(this.stepTimerId);
      this.stepTimerId = null;
    }
    this.stopSpeech();
    this.renderTimelineButtons();
  }

  private replay(): void {
    this.pause();
    this.frameIdx = 0;
    this.applyFrameImmediate(0);
    this.renderSvgPitch();
    this.renderNarrationAndTimeline();
    this.play();
  }

  private stepPrev(): void {
    this.pause();
    const prev = this.frameIdx > 0 ? this.frameIdx - 1 : this.sequence.frames.length - 1;
    this.goToFrame(prev, true);
    if (this.voiceEnabled) this.speakText(this.sequence.frames[prev]?.narration || '');
  }

  private stepNext(): void {
    this.pause();
    const next = (this.frameIdx + 1) % this.sequence.frames.length;
    this.goToFrame(next, true);
    if (this.voiceEnabled) this.speakText(this.sequence.frames[next]?.narration || '');
  }

  private scheduleCurrentStepPlayback(animateEntry: boolean): void {
    if (!this.isPlaying) return;
    if (this.stepTimerId !== null) window.clearTimeout(this.stepTimerId);
    const frame = this.sequence.frames[this.frameIdx];
    if (!frame) return;

    this.goToFrame(this.frameIdx, animateEntry);

    const advance = () => {
      if (!this.isPlaying) return;
      if (this.frameIdx < this.sequence.frames.length - 1) {
        this.frameIdx++;
        this.scheduleCurrentStepPlayback(true);
      } else {
        this.isPlaying = false;
        this.renderTimelineButtons();
      }
    };

    const waitMs = Math.max(900, Math.round((frame.durationMs || 2500) / this.speed));

    if (this.voiceEnabled && this.isSpeechSupported()) {
      let speechDone = false;
      let timerDone = false;
      const tryAdvance = () => {
        if (speechDone && timerDone && this.isPlaying) {
          advance();
        }
      };
      this.stepTimerId = window.setTimeout(() => {
        timerDone = true;
        tryAdvance();
      }, Math.min(waitMs, 1800));

      this.speakText(frame.narration, () => {
        speechDone = true;
        tryAdvance();
      });
    } else {
      this.stepTimerId = window.setTimeout(advance, waitMs);
    }
  }

  // ==================== WEB SPEECH API (ARABIC VOICE) ====================

  private isSpeechSupported(): boolean {
    return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
  }

  private stopSpeech(): void {
    if (this.speechSafetyTimer !== null) {
      window.clearTimeout(this.speechSafetyTimer);
      this.speechSafetyTimer = null;
    }
    if (this.isSpeechSupported()) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // Ignore browser speech cancellation error
      }
    }
  }

  private speakText(text: string, onComplete?: () => void): void {
    this.stopSpeech();
    if (!this.isSpeechSupported() || !text) {
      onComplete?.();
      return;
    }
    try {
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = 'ar-SA';
      utter.rate = Math.max(0.75, Math.min(1.4, this.speed));
      const voices = window.speechSynthesis.getVoices ? window.speechSynthesis.getVoices() : [];
      const arVoice =
        voices.find((v) => v.lang.toLowerCase().startsWith('ar-sa')) ||
        voices.find((v) => v.lang.toLowerCase().startsWith('ar'));
      if (arVoice) utter.voice = arVoice;

      let finished = false;
      const done = () => {
        if (finished) return;
        finished = true;
        if (this.speechSafetyTimer !== null) {
          window.clearTimeout(this.speechSafetyTimer);
          this.speechSafetyTimer = null;
        }
        onComplete?.();
      };
      utter.onend = done;
      utter.onerror = done;
      // Safety timeout in case a mobile browser stalls onend
      this.speechSafetyTimer = window.setTimeout(done, Math.max(4500, Math.min(11000, text.length * 95)));
      window.speechSynthesis.speak(utter);
    } catch {
      onComplete?.();
    }
  }

  // ==================== POINTER DRAG-AND-DROP BOARD ====================

  private getSvgPointFromEvent(svg: SVGSVGElement, e: PointerEvent): { x: number; y: number } {
    const rect = svg.getBoundingClientRect();
    const rx = ((e.clientX - rect.left) / Math.max(1, rect.width)) * SVG_W;
    const ry = ((e.clientY - rect.top) / Math.max(1, rect.height)) * SVG_H;
    return { x: fromSvgX(rx), y: fromSvgY(ry) };
  }

  private handlePointerDown = (e: PointerEvent): void => {
    const target = (e.target as Element | null)?.closest('[data-drag-kind]') as HTMLElement | SVGElement | null;
    if (!target) return;
    const kind = target.getAttribute('data-drag-kind') as 'our' | 'opp' | 'ball' | null;
    const idx = Number(target.getAttribute('data-drag-idx') || '0');
    if (!kind) return;

    const svg = document.getElementById('tacPitchSvg') as unknown as SVGSVGElement | null;
    if (!svg) return;

    this.pause();
    this.dragTarget = { kind, idx };
    this.dragStartClient = { x: e.clientX, y: e.clientY };
    this.dragMoved = false;
    try {
      svg.setPointerCapture(e.pointerId);
    } catch {
      // Some synthetic events may not support pointer capture
    }
    e.preventDefault();
  };

  private handlePointerMove = (e: PointerEvent): void => {
    if (!this.dragTarget) return;
    const dist = Math.hypot(e.clientX - this.dragStartClient.x, e.clientY - this.dragStartClient.y);
    if (dist > 6) this.dragMoved = true;
    if (!this.dragMoved) return;

    const svg = document.getElementById('tacPitchSvg') as unknown as SVGSVGElement | null;
    if (!svg) return;
    const pt = this.getSvgPointFromEvent(svg, e);

    if (this.dragTarget.kind === 'our' && this.currentOur[this.dragTarget.idx]) {
      this.currentOur[this.dragTarget.idx] = pt;
    } else if (this.dragTarget.kind === 'opp' && this.currentOpp[this.dragTarget.idx]) {
      this.currentOpp[this.dragTarget.idx] = pt;
    } else if (this.dragTarget.kind === 'ball') {
      this.currentBall = pt;
    }
    this.renderSvgPitch();
  };

  private handlePointerUp = (e: PointerEvent): void => {
    if (!this.dragTarget) return;
    const released = this.dragTarget;
    const wasDrag = this.dragMoved;
    this.dragTarget = null;
    this.dragMoved = false;

    const svg = document.getElementById('tacPitchSvg') as unknown as SVGSVGElement | null;
    if (svg) {
      try {
        svg.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    }

    // Short tap on one of our players opens Role Spotlight!
    if (!wasDrag && released.kind === 'our') {
      this.enterRoleSpotlight(released.idx);
    }
  };

  // ==================== CUSTOM PLAN RECORDER ====================

  private captureCustomFrame(): void {
    const stepNo = this.recordedFrames.length + 1;
    const noteEl = document.getElementById('tacRecNote') as HTMLInputElement | null;
    const customNote = (noteEl?.value || '').trim();
    const narration = customNote || `لقطة مخصّصة رقم ${stepNo} — حرّك اللاعبين والكرة ثم أضف اللقطة التالية.`;
    this.recordedFrames.push({
      title: `لقطة ${stepNo}: ${customNote ? customNote.slice(0, 28) : 'حركة تكتيكية مخصّصة'}`,
      narration,
      durationMs: 2400,
      ourPos: this.currentOur.map((p) => ({ ...p })),
      oppPos: this.currentOpp.map((p) => ({ ...p })),
      ball: { ...this.currentBall },
      activeIndices: [],
      arrows: [],
    });
    if (noteEl) noteEl.value = '';
    this.renderRecorderPanel();
    this.ctx?.toast(`تم التقاط اللقطة #${stepNo} 🎥`);
  }

  private playRecordedDraft(): void {
    if (this.recordedFrames.length < 2) {
      this.ctx?.toast('التقط لقطتين على الأقل لتشغيل خطتك المتحركة', true);
      return;
    }
    this.pause();
    this.activeScenarioId = null;
    this.spotlightSlotIdx = null;
    this.spotlightInfo = null;
    this.sequence = {
      id: 'custom_preview',
      title: '🎥 معاينة خطتك التكتيكية الخاصة',
      subtitle: `${this.recordedFrames.length} لقطات مسجّلة يدوياً`,
      size: this.prefs.size,
      offsideEnabled: PITCH_SIZE_META[this.prefs.size].offside,
      frames: this.recordedFrames.map((f) => ({ ...f })),
    };
    this.frameIdx = 0;
    this.applyFrameImmediate(0);
    this.renderAll();
    this.play();
  }

  private saveRecordedPlan(): void {
    if (this.recordedFrames.length < 2) {
      this.ctx?.toast('التقط لقطتين على الأقل قبل حفظ الخطة', true);
      return;
    }
    const nameEl = document.getElementById('tacRecName') as HTMLInputElement | null;
    const name = (nameEl?.value || '').trim() || `خطة الكابتن (${this.prefs.size}) #${this.prefs.customPlans.length + 1}`;
    const plan: CustomPlan = {
      id: 'plan_' + Date.now(),
      name,
      size: this.prefs.size,
      formationId: this.getCurrentFormationId(),
      frames: this.recordedFrames.map((f) => ({ ...f })),
    };
    this.prefs.customPlans.unshift(plan);
    this.prefs.customPlans = this.prefs.customPlans.slice(0, 12);
    savePrefs(this.prefs);
    if (nameEl) nameEl.value = '';
    this.renderRecorderPanel();
    this.ctx?.toast(`تم حفظ خطة «${name}» في مكتبتك ✓`);
  }

  private loadCustomPlan(planId: string): void {
    const plan = this.prefs.customPlans.find((p) => p.id === planId);
    if (!plan) return;
    this.pause();
    this.prefs.size = plan.size;
    this.prefs.formationBySize[plan.size] = plan.formationId;
    this.activeScenarioId = null;
    this.spotlightSlotIdx = null;
    this.spotlightInfo = null;
    this.sequence = {
      id: plan.id,
      title: `🎥 ${plan.name}`,
      subtitle: `خطة مسجّلة (${plan.size} • ${plan.frames.length} لقطات)`,
      size: plan.size,
      offsideEnabled: PITCH_SIZE_META[plan.size].offside,
      frames: plan.frames,
    };
    this.frameIdx = 0;
    this.applyFrameImmediate(0);
    this.renderAll();
    this.play();
  }

  // ==================== 2x RETINA OFFICIAL LINEUP POSTER PNG ====================

  private loadImageSafe(src: string): Promise<HTMLImageElement | null> {
    return new Promise((resolve) => {
      if (!src) {
        resolve(null);
        return;
      }
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  private async exportLineupPosterPng(): Promise<void> {
    if (!this.ctx) return;
    const W = 900;
    const H = 1280;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const c = canvas.getContext('2d');
    if (!c) return;

    const form = this.getCurrentFormation();
    const assigned = this.getAssignedPlayersForCurrentFormation();
    const chem = computeTeamChemistry(form, assigned);
    const settings = this.ctx.getTeamSettings();
    const teamName = settings.teamName || 'فريق السداسي';

    // 1. Royal Charcoal Background
    const bgGrad = c.createLinearGradient(0, 0, W, H);
    bgGrad.addColorStop(0, '#070709');
    bgGrad.addColorStop(0.5, '#0f1218');
    bgGrad.addColorStop(1, '#070709');
    c.fillStyle = bgGrad;
    c.fillRect(0, 0, W, H);

    // Subtle golden stadium rays
    const rayGrad = c.createRadialGradient(W / 2, 120, 20, W / 2, 120, 520);
    rayGrad.addColorStop(0, 'rgba(250, 204, 21, 0.24)');
    rayGrad.addColorStop(1, 'rgba(250, 204, 21, 0)');
    c.fillStyle = rayGrad;
    c.fillRect(0, 0, W, 620);

    // Outer Royal Frame
    c.strokeStyle = 'rgba(250, 204, 21, 0.45)';
    c.lineWidth = 4;
    c.strokeRect(24, 24, W - 48, H - 48);

    // 2. Header with Team Name, Badge & Formation
    c.direction = 'rtl';
    c.textAlign = 'center';
    c.fillStyle = '#FACC15';
    c.font = '900 26px system-ui, "Segoe UI", Tahoma, Arial, sans-serif';
    c.fillText('التشكيلة الرسمية للمباراة 👑', W / 2, 82);

    c.fillStyle = '#f8fafc';
    c.font = '900 44px system-ui, "Segoe UI", Tahoma, Arial, sans-serif';
    c.fillText(teamName, W / 2, 138);

    c.fillStyle = '#fde68a';
    c.font = '700 22px system-ui, "Segoe UI", Tahoma, Arial, sans-serif';
    c.fillText(
      `الخطة: ${form.name} (${this.prefs.size})  •  OVR ${chem.avgOvr || '--'}  •  تناغم ${chem.totalPct}%`,
      W / 2,
      178
    );

    // Team logo if set
    const logoUrl = sanitizeImageDataUrl(settings.logo || '', 250000);
    if (logoUrl) {
      const logoImg = await this.loadImageSafe(logoUrl);
      if (logoImg) {
        c.save();
        c.beginPath();
        c.arc(W - 92, 108, 42, 0, Math.PI * 2);
        c.closePath();
        c.clip();
        c.drawImage(logoImg, W - 134, 66, 84, 84);
        c.restore();
        c.strokeStyle = '#FACC15';
        c.lineWidth = 3;
        c.beginPath();
        c.arc(W - 92, 108, 42, 0, Math.PI * 2);
        c.stroke();
      }
    }

    // 3. Royal Pitch Area
    const px = 64;
    const py = 212;
    const pw = W - 128;
    const ph = 920;

    const pitchGrad = c.createLinearGradient(px, py, px, py + ph);
    pitchGrad.addColorStop(0, '#092217');
    pitchGrad.addColorStop(0.5, '#0f3322');
    pitchGrad.addColorStop(1, '#081d14');
    c.fillStyle = pitchGrad;
    c.fillRect(px, py, pw, ph);

    // Grass stripes
    const stripes = 10;
    for (let i = 0; i < stripes; i++) {
      if (i % 2 === 0) {
        c.fillStyle = 'rgba(255,255,255,0.032)';
        c.fillRect(px, py + (ph / stripes) * i, pw, ph / stripes);
      }
    }

    // Pitch chalk lines in royal gold-white
    c.strokeStyle = 'rgba(250, 204, 21, 0.36)';
    c.lineWidth = 3;
    c.strokeRect(px, py, pw, ph);
    // Halfway line & circle
    c.beginPath();
    c.moveTo(px, py + ph / 2);
    c.lineTo(px + pw, py + ph / 2);
    c.stroke();
    c.beginPath();
    c.arc(px + pw / 2, py + ph / 2, 86, 0, Math.PI * 2);
    c.stroke();
    // Penalty boxes
    c.strokeRect(px + pw * 0.22, py, pw * 0.56, 128);
    c.strokeRect(px + pw * 0.22, py + ph - 128, pw * 0.56, 128);

    // 4. Draw Chemistry Links softly behind players
    chem.linkResults.forEach((lk) => {
      const sA = form.slots[lk.a];
      const sB = form.slots[lk.b];
      if (!sA || !sB) return;
      const x1 = px + (sA.x / 100) * pw;
      const y1 = py + (sA.y / 100) * ph;
      const x2 = px + (sB.x / 100) * pw;
      const y2 = py + (sB.y / 100) * ph;
      c.save();
      c.beginPath();
      c.moveTo(x1, y1);
      c.lineTo(x2, y2);
      c.lineWidth = lk.level === 'gold' ? 4 : 2.5;
      c.strokeStyle =
        lk.level === 'gold'
          ? 'rgba(250, 204, 21, 0.55)'
          : lk.level === 'green'
          ? 'rgba(34, 197, 94, 0.45)'
          : 'rgba(148, 163, 184, 0.28)';
      if (lk.level === 'dashed') c.setLineDash([8, 8]);
      c.stroke();
      c.restore();
    });

    // 5. Draw Players on Pitch with Portraits / Jersey Circles
    const avatarR = this.prefs.size === '11v11' ? 38 : 50;
    for (let i = 0; i < form.slots.length; i++) {
      const s = form.slots[i];
      const pl = assigned[i];
      const cx = px + (s.x / 100) * pw;
      const cy = py + (s.y / 100) * ph;

      // Golden glow
      c.save();
      const glow = c.createRadialGradient(cx, cy, avatarR * 0.5, cx, cy, avatarR + 22);
      glow.addColorStop(0, 'rgba(250,204,21,0.34)');
      glow.addColorStop(1, 'rgba(250,204,21,0)');
      c.fillStyle = glow;
      c.beginPath();
      c.arc(cx, cy, avatarR + 22, 0, Math.PI * 2);
      c.fill();
      c.restore();

      // Portrait or Royal disc
      const cleanPhoto = pl ? sanitizeImageDataUrl(pl.photo || '', 250000) : '';
      const img = cleanPhoto ? await this.loadImageSafe(cleanPhoto) : null;

      c.save();
      c.beginPath();
      c.arc(cx, cy, avatarR, 0, Math.PI * 2);
      c.closePath();
      c.fillStyle = pl ? '#171923' : 'rgba(18,19,24,0.78)';
      c.fill();
      if (img) {
        c.clip();
        const scale = Math.max((avatarR * 2) / img.width, (avatarR * 2) / img.height);
        const dw = img.width * scale;
        const dh = img.height * scale;
        c.drawImage(img, cx - dw / 2, cy - dh / 2, dw, dh);
      } else {
        c.fillStyle = pl ? '#FACC15' : '#94a3b8';
        c.font = `900 ${Math.round(avatarR * 0.72)}px system-ui, sans-serif`;
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText(pl ? `#${pl.jersey || '★'}` : s.short, cx, cy + 2);
      }
      c.restore();

      // Golden rim
      c.strokeStyle = pl ? '#FACC15' : 'rgba(250,204,21,0.45)';
      c.lineWidth = 4;
      c.beginPath();
      c.arc(cx, cy, avatarR, 0, Math.PI * 2);
      c.stroke();

      // Jersey number pill on top-right
      if (pl) {
        c.fillStyle = '#FACC15';
        c.beginPath();
        c.arc(cx + avatarR * 0.74, cy - avatarR * 0.7, 17, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = '#070709';
        c.font = '900 16px system-ui, sans-serif';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText(String(pl.jersey || '★'), cx + avatarR * 0.74, cy - avatarR * 0.7 + 1);
      }

      // Captain / Set-piece tag on top-left
      if (pl && this.prefs.setPieces.captainId === pl.id) {
        c.fillStyle = '#22c55e';
        c.beginPath();
        c.arc(cx - avatarR * 0.74, cy - avatarR * 0.7, 16, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = '#070709';
        c.font = '900 15px system-ui, sans-serif';
        c.fillText('C', cx - avatarR * 0.74, cy - avatarR * 0.7 + 1);
      }

      // Name plaque under disc
      const label = pl ? firstWord(pl.name) : s.label;
      c.textBaseline = 'alphabetic';
      const boxW = Math.max(104, label.length * 14 + 28);
      c.fillStyle = 'rgba(7, 7, 9, 0.88)';
      c.strokeStyle = 'rgba(250, 204, 21, 0.45)';
      c.lineWidth = 1.6;
      c.beginPath();
      c.roundRect(cx - boxW / 2, cy + avatarR + 8, boxW, 34, 10);
      c.fill();
      c.stroke();

      c.fillStyle = '#f8fafc';
      c.font = '800 19px system-ui, "Segoe UI", Tahoma, Arial, sans-serif';
      c.textAlign = 'center';
      c.fillText(label, cx, cy + avatarR + 31);
    }

    // 6. Footer Watermark
    c.fillStyle = '#FACC15';
    c.font = '800 22px system-ui, "Segoe UI", Tahoma, Arial, sans-serif';
    c.textAlign = 'center';
    c.fillText('ميدان 6v6 — النسخة الملكية  •  الاستوديو التكتيكي الشامل', W / 2, H - 62);

    const dataUrl = canvas.toDataURL('image/png', 1);
    const blob: Blob | null = await new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png', 1));
    this.ctx.openPngPreview(
      dataUrl,
      blob,
      `maydan-lineup-${this.prefs.size}-${form.id}.png`,
      `تشكيلة ${teamName} (${form.id})`
    );
    this.ctx.toast('تم تجهيز بوستر التشكيلة الرسمية بدقة 2x Retina ✨');
  }

  // ==================== ROTATION TIMER ====================

  private formatClock(sec: number): string {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  private startRotationTimer(): void {
    if (this.timerRunning) return;
    if (this.timerSecondsLeft <= 0) this.timerSecondsLeft = this.prefs.rotationInterval * 60;
    this.timerRunning = true;
    this.timerIntervalId = window.setInterval(() => {
      if (this.timerSecondsLeft > 0) {
        this.timerSecondsLeft--;
        this.updateTimerDisplayOnly();
      }
      if (this.timerSecondsLeft === 0) {
        this.pauseRotationTimer();
        playSubAlertBeep();
        this.ctx?.toast('⏱️ حان وقت التبديل العادل الآن! راجع جدول التبديلات 🔄');
      }
    }, 1000);
    this.updateTimerDisplayOnly();
  }

  private pauseRotationTimer(): void {
    this.timerRunning = false;
    if (this.timerIntervalId !== null) {
      window.clearInterval(this.timerIntervalId);
      this.timerIntervalId = null;
    }
    this.updateTimerDisplayOnly();
  }

  private resetRotationTimer(): void {
    this.pauseRotationTimer();
    this.timerSecondsLeft = this.prefs.rotationInterval * 60;
    this.updateTimerDisplayOnly();
  }

  private updateTimerDisplayOnly(): void {
    const el = document.getElementById('tacTimerDisplay');
    if (el) el.textContent = this.formatClock(this.timerSecondsLeft);
    const btn = document.getElementById('btnTacTimerToggle');
    if (btn) btn.textContent = this.timerRunning ? '⏸ إيقاف المنبّه' : '▶ تشغيل المنبّه';
  }

  // ==================== RENDERERS ====================

  private renderAll(): void {
    this.renderSizeAndFormationSelectors();
    this.renderViewModeTabs();
    this.renderPhaseButtons();
    this.renderToolbarState();
    this.renderPitchShellClasses();
    this.renderActiveViewBody();
    this.renderNarrationAndTimeline();
    this.renderSpotlightCard();
    this.renderRecorderPanel();
    this.renderScenariosSection();
    this.renderCaptainTools();
    this.renderSaveButton();
  }

  private renderSaveButton(): void {
    if (!this.ctx) return;
    const saveBtn = document.getElementById('btnSaveTactics') as HTMLButtonElement | null;
    if (!saveBtn) return;
    const isAdmin = this.ctx.isAdmin();
    const isFb = this.ctx.isFirebaseMode();
    if (this.prefs.size === '6v6') {
      saveBtn.disabled = isFb && !isAdmin;
      saveBtn.textContent =
        isFb && !isAdmin ? 'حفظ التشكيلة للفريق (متاح للكابتن فقط)' : '💾 حفظ التشكيلة الرسمية للفريق (6v6)';
    } else {
      saveBtn.disabled = false;
      saveBtn.textContent = `💾 حفظ لوحة ${this.prefs.size} محلياً`;
    }
  }

  private renderSizeAndFormationSelectors(): void {
    const sizeBar = document.getElementById('tacSizeBar');
    if (sizeBar) {
      sizeBar.innerHTML = (['6v6', '5v5', '7v7', '11v11'] as PitchSizeId[])
        .map((sz) => {
          const active = sz === this.prefs.size;
          return `<button type="button" data-tac-size="${sz}" class="tac-pill ${active ? 'active' : ''}">${escapeHtml(PITCH_SIZE_META[sz].label)}</button>`;
        })
        .join('');
    }

    const metaBadge = document.getElementById('tacSizeBadge');
    if (metaBadge) {
      metaBadge.textContent = PITCH_SIZE_META[this.prefs.size].badge;
    }

    const selectEl = document.getElementById('tacFormation') as HTMLSelectElement | null;
    if (selectEl) {
      const list = FORMATIONS_CATALOG[this.prefs.size];
      const current = this.getCurrentFormationId();
      selectEl.innerHTML = list
        .map((f) => `<option value="${escapeHtml(f.id)}" ${f.id === current ? 'selected' : ''}>${escapeHtml(f.name)}</option>`)
        .join('');
      selectEl.value = current;
    }

    const taglineEl = document.getElementById('tacFormTagline');
    if (taglineEl) {
      taglineEl.textContent = this.getCurrentFormation().tagline;
    }
  }

  private renderViewModeTabs(): void {
    document.querySelectorAll<HTMLButtonElement>('[data-tac-view]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tacView === this.viewMode);
    });
  }

  private renderPhaseButtons(): void {
    const showPhases = this.viewMode === 'studio';
    const bar = document.getElementById('tacPhaseBar');
    if (bar) bar.classList.toggle('hidden', !showPhases);

    document.querySelectorAll<HTMLButtonElement>('[data-tac-phase]').forEach((btn) => {
      const isActive = !this.activeScenarioId && this.spotlightSlotIdx === null && btn.dataset.tacPhase === this.phase;
      btn.classList.toggle('active', isActive);
    });
  }

  private renderToolbarState(): void {
    const btn25 = document.getElementById('btnTacToggle25D');
    if (btn25) {
      const saver = document.body.classList.contains('data-saver');
      btn25.textContent = saver ? '📐 2D (توفير)' : this.is25D ? '🏟️ 2.5D مائل' : '📐 2D مسطّح';
      btn25.classList.toggle('active', this.is25D && !saver);
    }
    const btnTri = document.getElementById('btnTacTriangles');
    if (btnTri) btnTri.classList.toggle('active', this.showTriangles);
    const btnOpp = document.getElementById('btnTacOpponents');
    if (btnOpp) btnOpp.classList.toggle('active', this.showOpponents);
    const btnRec = document.getElementById('btnTacRecordMode');
    if (btnRec) btnRec.classList.toggle('active', this.isRecordingMode);
  }

  private renderPitchShellClasses(): void {
    const stage = document.getElementById('tacPitchStage');
    if (!stage) return;
    const saver = document.body.classList.contains('data-saver');
    const tilt = this.is25D && !saver && this.viewMode === 'studio';
    stage.classList.toggle('pitch-25d', tilt);
    stage.classList.toggle('pitch-2d', !tilt);
  }

  private renderActiveViewBody(): void {
    const studioPanel = document.getElementById('tacStudioViewport');
    const posterPanel = document.getElementById('tacPosterViewport');
    const fifaPanel = document.getElementById('tacFifaViewport');
    const timelineWrap = document.getElementById('tacTimelineWrap');

    studioPanel?.classList.toggle('hidden', this.viewMode !== 'studio');
    timelineWrap?.classList.toggle('hidden', this.viewMode !== 'studio');
    posterPanel?.classList.toggle('hidden', this.viewMode !== 'poster');
    fifaPanel?.classList.toggle('hidden', this.viewMode !== 'fifa');

    if (this.viewMode === 'studio') {
      this.renderSvgPitch();
    } else if (this.viewMode === 'poster') {
      this.renderOfficialPosterView();
    } else if (this.viewMode === 'fifa') {
      this.renderMiniFifaView();
    }
  }

  private renderSvgPitch(): void {
    const svg = document.getElementById('tacPitchSvg') as unknown as SVGSVGElement | null;
    if (!svg) return;

    const form = this.getCurrentFormation();
    const assigned = this.getAssignedPlayersForCurrentFormation();
    const frame = this.sequence.frames[this.frameIdx] || this.sequence.frames[0];
    const activeSet = new Set(frame?.activeIndices || []);
    const saver = document.body.classList.contains('data-saver');

    // Compute dynamic offside line ONLY when 11v11 is active (2nd deepest opponent excluding GK or including GK)
    let offsideY: number | null = null;
    if (this.sequence.offsideEnabled && this.currentOpp.length >= 3) {
      const sortedY = this.currentOpp.map((o) => o.y).sort((a, b) => a - b);
      // 2nd highest opponent (closest to opponent goal at top y=0)
      offsideY = toSvgY(sortedY[1]);
    }

    const parts: string[] = [];

    // Defs (gradients & arrowheads)
    parts.push(`<defs>
      <linearGradient id="turfGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#071f14"/>
        <stop offset="50%" stop-color="#0d2f1f"/>
        <stop offset="100%" stop-color="#061910"/>
      </linearGradient>
      <radialGradient id="goldHalo" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="#FACC15" stop-opacity="0.65"/>
        <stop offset="100%" stop-color="#FACC15" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="heatZoneGrad" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="#FACC15" stop-opacity="0.34"/>
        <stop offset="65%" stop-color="#EAB308" stop-opacity="0.14"/>
        <stop offset="100%" stop-color="#FACC15" stop-opacity="0"/>
      </radialGradient>
      <marker id="arrBall" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse">
        <path d="M 0 1 L 10 5 L 0 9 z" fill="#FACC15"/>
      </marker>
      <marker id="arrRun" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
        <path d="M 0 1 L 10 5 L 0 9 z" fill="#38bdf8"/>
      </marker>
      <marker id="arrCover" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
        <path d="M 0 1 L 10 5 L 0 9 z" fill="#22c55e"/>
      </marker>
    </defs>`);

    // Turf & mowed grass bands
    parts.push(`<rect x="0" y="0" width="${SVG_W}" height="${SVG_H}" rx="16" fill="url(#turfGrad)"/>`);
    for (let i = 0; i < 10; i++) {
      if (i % 2 === 0) {
        parts.push(`<rect x="14" y="${16 + i * 48.8}" width="${SVG_W - 28}" height="48.8" fill="rgba(255,255,255,0.03)"/>`);
      }
    }

    // Pitch chalk lines
    parts.push(`<g stroke="rgba(250,204,21,0.34)" stroke-width="1.6" fill="none">
      <rect x="16" y="18" width="${SVG_W - 32}" height="${SVG_H - 36}" rx="6"/>
      <line x1="16" y1="${SVG_H / 2}" x2="${SVG_W - 16}" y2="${SVG_H / 2}"/>
      <circle cx="${SVG_W / 2}" cy="${SVG_H / 2}" r="42"/>
      <circle cx="${SVG_W / 2}" cy="${SVG_H / 2}" r="2.5" fill="#FACC15"/>
      <rect x="86" y="18" width="${SVG_W - 172}" height="64"/>
      <rect x="130" y="18" width="${SVG_W - 260}" height="24"/>
      <rect x="86" y="${SVG_H - 82}" width="${SVG_W - 172}" height="64"/>
      <rect x="130" y="${SVG_H - 42}" width="${SVG_W - 260}" height="24"/>
      <rect x="144" y="10" width="72" height="8" rx="2" stroke="#FACC15" stroke-width="2"/>
      <rect x="144" y="${SVG_H - 18}" width="72" height="8" rx="2" stroke="#FACC15" stroke-width="2"/>
    </g>`);

    // Offside line ONLY for 11v11
    if (offsideY !== null) {
      parts.push(`<g class="tac-offside-line">
        <line x1="16" y1="${offsideY.toFixed(1)}" x2="${SVG_W - 16}" y2="${offsideY.toFixed(1)}" stroke="#f43f5e" stroke-width="2" stroke-dasharray="6 4"/>
        <rect x="22" y="${(offsideY - 17).toFixed(1)}" width="84" height="15" rx="4" fill="rgba(244,63,94,0.9)"/>
        <text x="64" y="${(offsideY - 6).toFixed(1)}" text-anchor="middle" fill="#fff" font-size="9.5" font-weight="800">خط التسلل (11v11)</text>
      </g>`);
    }

    // Role Spotlight Heat Zone
    if (this.spotlightInfo) {
      const z = this.spotlightInfo.zone;
      parts.push(`<ellipse cx="${toSvgX(z.x).toFixed(1)}" cy="${toSvgY(z.y).toFixed(1)}" rx="${(z.rx * 3.1).toFixed(1)}" ry="${(z.ry * 4.2).toFixed(1)}" fill="url(#heatZoneGrad)" stroke="rgba(250,204,21,0.45)" stroke-dasharray="5 4" stroke-width="1.4"/>`);
    }

    // Open space / tactical zones from keyframe
    if (frame?.zones?.length) {
      const zoneColors: Record<string, { fill: string; stroke: string; txt: string }> = {
        gold: { fill: 'rgba(250,204,21,0.16)', stroke: 'rgba(250,204,21,0.6)', txt: '#fef08a' },
        cyan: { fill: 'rgba(56,189,248,0.16)', stroke: 'rgba(56,189,248,0.6)', txt: '#bae6fd' },
        rose: { fill: 'rgba(244,63,94,0.16)', stroke: 'rgba(244,63,94,0.6)', txt: '#fecdd3' },
        emerald: { fill: 'rgba(34,197,94,0.18)', stroke: 'rgba(34,197,94,0.65)', txt: '#bbf7d0' },
      };
      frame.zones.forEach((z) => {
        const col = zoneColors[z.color || 'gold'] || zoneColors.gold;
        const cx = toSvgX(z.x);
        const cy = toSvgY(z.y);
        const r = z.r * 3.1;
        parts.push(`<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" fill="${col.fill}" stroke="${col.stroke}" stroke-width="1.3" stroke-dasharray="4 3"/>`);
        if (z.label) {
          parts.push(`<text x="${cx.toFixed(1)}" y="${(cy - r + 12).toFixed(1)}" text-anchor="middle" fill="${col.txt}" font-size="9.5" font-weight="800">${escapeHtml(z.label)}</text>`);
        }
      });
    }

    // Passing triangles (from frame OR subtle default formation triangles when toggle ON)
    if (this.showTriangles) {
      const tris = frame?.triangles || (form.slots.length >= 5 ? [[1, 2, 3]] : []);
      tris.forEach(([a, b, c]) => {
        const pA = this.currentOur[a];
        const pB = this.currentOur[b];
        const pC = this.currentOur[c];
        if (!pA || !pB || !pC) return;
        const pts = `${toSvgX(pA.x).toFixed(1)},${toSvgY(pA.y).toFixed(1)} ${toSvgX(pB.x).toFixed(1)},${toSvgY(pB.y).toFixed(1)} ${toSvgX(pC.x).toFixed(1)},${toSvgY(pC.y).toFixed(1)}`;
        parts.push(`<polygon points="${pts}" fill="rgba(250,204,21,0.11)" stroke="rgba(250,204,21,0.38)" stroke-width="1.2" stroke-dasharray="4 3"/>`);
      });
    }

    // Tactical arrows (ball = solid gold, run = dashed cyan, cover = dotted emerald)
    if (frame?.arrows?.length) {
      frame.arrows.forEach((arr) => {
        const x1 = toSvgX(arr.from[0]);
        const y1 = toSvgY(arr.from[1]);
        const x2 = toSvgX(arr.to[0]);
        const y2 = toSvgY(arr.to[1]);
        if (Math.hypot(x2 - x1, y2 - y1) < 8) return;
        const stroke = arr.kind === 'ball' ? '#FACC15' : arr.kind === 'run' ? '#38bdf8' : '#22c55e';
        const dash = arr.kind === 'ball' ? '' : arr.kind === 'run' ? 'stroke-dasharray="6 4"' : 'stroke-dasharray="3 3"';
        const marker = arr.kind === 'ball' ? 'url(#arrBall)' : arr.kind === 'run' ? 'url(#arrRun)' : 'url(#arrCover)';
        parts.push(`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${stroke}" stroke-width="${arr.kind === 'ball' ? 2.8 : 2.1}" ${dash} marker-end="${marker}" opacity="0.92"/>`);
      });
    }

    // Opponent gray discs
    const discR = this.prefs.size === '11v11' ? 12.5 : 16;
    if (this.showOpponents) {
      this.currentOpp.forEach((op, i) => {
        const cx = toSvgX(op.x);
        const cy = toSvgY(op.y);
        const dimmed = this.spotlightSlotIdx !== null ? 'opacity="0.45"' : 'opacity="0.92"';
        parts.push(`<g data-drag-kind="opp" data-drag-idx="${i}" class="tac-disc" ${dimmed}>
          <circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${(discR - 1.5).toFixed(1)}" fill="#334155" stroke="#94a3b8" stroke-width="1.8"/>
          <text x="${cx.toFixed(1)}" y="${(cy + 3.5).toFixed(1)}" text-anchor="middle" fill="#e2e8f0" font-size="9.5" font-weight="800">${i === 0 ? 'GK' : i + 1}</text>
        </g>`);
      });
    }

    // Our Golden Team discs
    this.currentOur.forEach((pt, i) => {
      const slot = form.slots[i];
      const pl = assigned[i];
      const cx = toSvgX(pt.x);
      const cy = toSvgY(pt.y);
      const isSpotlighted = this.spotlightSlotIdx === i;
      const isDimmed = this.spotlightSlotIdx !== null && !isSpotlighted && !activeSet.has(i);
      const isActive = activeSet.has(i) || isSpotlighted;
      const numText = pl ? String(pl.jersey || '★') : slot ? slot.short : String(i + 1);
      const nameText = pl ? firstWord(pl.name) : slot ? slot.short : '';

      parts.push(`<g data-drag-kind="our" data-drag-idx="${i}" class="tac-disc tac-disc-our" opacity="${isDimmed ? '0.35' : '1'}">`);
      if (isActive && !saver) {
        parts.push(`<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${(discR + 11).toFixed(1)}" fill="url(#goldHalo)"/>`);
        parts.push(`<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${(discR + 4.5).toFixed(1)}" fill="none" stroke="#FACC15" stroke-width="1.8" stroke-dasharray="4 3"/>`);
      }
      parts.push(`<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${discR.toFixed(1)}" fill="${isActive ? '#FACC15' : '#151722'}" stroke="#FACC15" stroke-width="${isActive ? 2.6 : 2}"/>`);
      parts.push(`<text x="${cx.toFixed(1)}" y="${(cy + 3.8).toFixed(1)}" text-anchor="middle" fill="${isActive ? '#070709' : '#FACC15'}" font-size="${this.prefs.size === '11v11' ? '9' : '10.5'}" font-weight="900">${escapeHtml(numText)}</text>`);
      if (nameText) {
        parts.push(`<rect x="${(cx - 24).toFixed(1)}" y="${(cy + discR + 2).toFixed(1)}" width="48" height="14" rx="5" fill="rgba(7,7,9,0.85)" stroke="rgba(250,204,21,0.3)" stroke-width="0.8"/>`);
        parts.push(`<text x="${cx.toFixed(1)}" y="${(cy + discR + 12).toFixed(1)}" text-anchor="middle" fill="#f8fafc" font-size="8.5" font-weight="700">${escapeHtml(nameText.slice(0, 8))}</text>`);
      }
      parts.push(`</g>`);
    });

    // Football (draggable)
    const bx = toSvgX(this.currentBall.x);
    const by = toSvgY(this.currentBall.y);
    parts.push(`<g data-drag-kind="ball" data-drag-idx="0" class="tac-disc tac-ball">
      <circle cx="${bx.toFixed(1)}" cy="${by.toFixed(1)}" r="9.5" fill="rgba(0,0,0,0.45)" transform="translate(0,2)"/>
      <circle cx="${bx.toFixed(1)}" cy="${by.toFixed(1)}" r="8.5" fill="#ffffff" stroke="#070709" stroke-width="1.6"/>
      <polygon points="${bx.toFixed(1)},${(by - 3.6).toFixed(1)} ${(bx + 3.4).toFixed(1)},${(by - 1).toFixed(1)} ${(bx + 2.1).toFixed(1)},${(by + 3.1).toFixed(1)} ${(bx - 2.1).toFixed(1)},${(by + 3.1).toFixed(1)} ${(bx - 3.4).toFixed(1)},${(by - 1).toFixed(1)}" fill="#070709"/>
    </g>`);

    svg.innerHTML = parts.join('');
  }

  private renderNarrationAndTimeline(): void {
    const frame = this.sequence.frames[this.frameIdx] || this.sequence.frames[0];
    const total = this.sequence.frames.length;

    const titleEl = document.getElementById('tacSeqTitle');
    if (titleEl) titleEl.textContent = this.sequence.title;
    const subEl = document.getElementById('tacSeqSubtitle');
    if (subEl) subEl.textContent = this.sequence.subtitle;

    const stepBadge = document.getElementById('tacStepCounter');
    if (stepBadge) stepBadge.textContent = `المرحلة ${this.frameIdx + 1} / ${total}`;

    const frameTitle = document.getElementById('tacFrameTitle');
    if (frameTitle) frameTitle.textContent = frame?.title || '';

    const narrEl = document.getElementById('tacNarrationText');
    if (narrEl) narrEl.textContent = frame?.narration || '';

    const dotsEl = document.getElementById('tacStepDots');
    if (dotsEl) {
      dotsEl.innerHTML = this.sequence.frames
        .map((fr, idx) => `<button type="button" data-tac-step="${idx}" class="tac-step-dot ${idx === this.frameIdx ? 'active' : ''}" title="${escapeHtml(fr.title)}">${idx + 1}</button>`)
        .join('');
    }

    this.renderTimelineButtons();
  }

  private renderTimelineButtons(): void {
    const playBtn = document.getElementById('btnTacPlay');
    if (playBtn) {
      playBtn.textContent = this.isPlaying ? '⏸ إيقاف' : '▶ تشغيل';
      playBtn.classList.toggle('btn-primary', !this.isPlaying);
      playBtn.classList.toggle('btn-amber', this.isPlaying);
    }

    const voiceBtn = document.getElementById('btnTacVoice');
    if (voiceBtn) {
      const supported = this.isSpeechSupported();
      voiceBtn.textContent = !supported ? '🔇 غير مدعوم' : this.voiceEnabled ? '🔊 صوت مفعّل' : '🔇 تعليق صوتي';
      voiceBtn.classList.toggle('active', this.voiceEnabled && supported);
    }

    document.querySelectorAll<HTMLButtonElement>('[data-tac-speed]').forEach((b) => {
      b.classList.toggle('active', Number(b.dataset.tacSpeed) === this.speed);
    });
  }

  private renderSpotlightCard(): void {
    const box = document.getElementById('tacSpotlightCard');
    if (!box) return;
    if (this.spotlightSlotIdx === null || !this.spotlightInfo) {
      box.classList.add('hidden');
      return;
    }
    const form = this.getCurrentFormation();
    const assigned = this.getAssignedPlayersForCurrentFormation();
    const pl = assigned[this.spotlightSlotIdx];
    const info = this.spotlightInfo;

    box.classList.remove('hidden');
    box.innerHTML = `
      <div class="row between" style="margin-bottom:8px;">
        <div>
          <span class="badge">🎯 تسليط الضوء على المركز</span>
          <h3 style="margin-top:4px;color:var(--primary);">${escapeHtml(info.slotLabel)} (${escapeHtml(info.slotShort)})${pl ? ` — ${escapeHtml(pl.name)}` : ''}</h3>
        </div>
        <div class="row" style="gap:6px;">
          <button type="button" id="btnSpotAssign" class="btn-primary" style="min-height:36px;padding:6px 10px;font-size:0.78rem;">👤 تعيين لاعب</button>
          <button type="button" id="btnSpotClose" class="icon-btn" style="min-height:36px;">✕ إنهاء</button>
        </div>
      </div>
      <div class="grid-2" style="gap:8px;margin-bottom:8px;">
        <div class="item-box" style="margin:0;">
          <div style="font-weight:800;color:#22c55e;margin-bottom:4px;">⚔️ واجباتك الهجومية</div>
          ${info.offenseDuties.map((d) => `<div style="font-size:0.78rem;margin-bottom:4px;">• ${escapeHtml(d)}</div>`).join('')}
        </div>
        <div class="item-box" style="margin:0;">
          <div style="font-weight:800;color:#38bdf8;margin-bottom:4px;">🛡️ واجباتك الدفاعية</div>
          ${info.defenseDuties.map((d) => `<div style="font-size:0.78rem;margin-bottom:4px;">• ${escapeHtml(d)}</div>`).join('')}
        </div>
      </div>
      <div class="item-box" style="margin:0;border-color:rgba(250,204,21,0.45);background:rgba(250,204,21,0.08);">
        <strong style="color:var(--primary);">💡 القاعدة الذهبية:</strong>
        <span style="font-size:0.8rem;"> ${escapeHtml(info.goldenRule)}</span>
      </div>
    `;

    document.getElementById('btnSpotClose')?.addEventListener('click', () => this.exitRoleSpotlight());
    document.getElementById('btnSpotAssign')?.addEventListener('click', () => {
      if (this.spotlightSlotIdx === null || !this.ctx) return;
      const idx = this.spotlightSlotIdx;
      const curId = this.getSlotPlayerId(form.id, idx, form.slots.length);
      this.ctx.openSlotPicker(info.slotLabel, curId, (pid) => {
        this.setSlotPlayerId(form.id, idx, pid);
        this.renderAll();
      });
    });
  }

  private renderRecorderPanel(): void {
    const panel = document.getElementById('tacRecorderPanel');
    if (!panel) return;
    panel.classList.toggle('hidden', !this.isRecordingMode || this.viewMode !== 'studio');
    if (!this.isRecordingMode) return;

    const countEl = document.getElementById('tacRecCount');
    if (countEl) countEl.textContent = `${this.recordedFrames.length} لقطات مسجّلة`;

    const savedList = document.getElementById('tacSavedCustomPlans');
    if (savedList) {
      savedList.innerHTML = this.prefs.customPlans.length
        ? this.prefs.customPlans
            .map(
              (p) => `<div class="item-box row between" style="margin-bottom:6px;">
                <div>
                  <strong style="font-size:0.82rem;">🎥 ${escapeHtml(p.name)}</strong>
                  <div class="muted">${escapeHtml(p.size)} • ${p.frames.length} لقطات</div>
                </div>
                <div class="row" style="gap:6px;">
                  <button type="button" data-load-plan="${escapeHtml(p.id)}" class="btn-primary" style="min-height:34px;padding:4px 10px;font-size:0.75rem;">▶ تشغيل</button>
                  <button type="button" data-del-plan="${escapeHtml(p.id)}" class="btn-rose" style="min-height:34px;padding:4px 8px;font-size:0.75rem;">🗑️</button>
                </div>
              </div>`
            )
            .join('')
        : '<p class="muted" style="font-size:0.76rem;">لا توجد خطط محفوظة بعد — حرّك اللاعبين والكرة واضغط «+ التقاط لقطة».</p>';
    }
  }

  // ==================== VIEW MODE 2: OFFICIAL LINEUP POSTER ====================

  private renderOfficialPosterView(): void {
    const container = document.getElementById('tacPosterBoard');
    if (!container || !this.ctx) return;
    const form = this.getCurrentFormation();
    const assigned = this.getAssignedPlayersForCurrentFormation();
    const chem = computeTeamChemistry(form, assigned);
    const settings = this.ctx.getTeamSettings();

    const headerEl = document.getElementById('tacPosterHeaderMeta');
    if (headerEl) {
      headerEl.textContent = `${settings.teamName || 'فريق السداسي'} • ${form.name} (${this.prefs.size}) • OVR ${chem.avgOvr || '--'}`;
    }

    container.innerHTML = form.slots
      .map((s, idx) => {
        const pl = assigned[idx];
        const photo = pl ? sanitizeImageDataUrl(pl.photo || '', 250000) : '';
        const badges: string[] = [];
        if (pl && this.prefs.setPieces.captainId === pl.id) badges.push('©');
        if (pl && this.prefs.setPieces.cornerId === pl.id) badges.push('🚩');
        if (pl && this.prefs.setPieces.freeKickId === pl.id) badges.push('🎯');

        return `<button type="button" data-assign-slot="${idx}" class="poster-node ${this.prefs.size === '11v11' ? 'compact' : ''}" style="left:${s.x}%;top:${s.y}%;">
          <div class="poster-avatar ${pl ? 'filled' : ''}">
            ${
              photo
                ? `<img src="${photo}" alt="${escapeHtml(pl?.name || '')}" />`
                : `<span>${pl ? '#' + escapeHtml(String(pl.jersey || '★')) : '+'}</span>`
            }
            ${pl ? `<span class="poster-num">${escapeHtml(String(pl.jersey || '★'))}</span>` : ''}
            ${badges.length ? `<span class="poster-badge">${badges.join('')}</span>` : ''}
          </div>
          <div class="poster-name">${pl ? escapeHtml(firstWord(pl.name)) : escapeHtml(s.short)}</div>
        </button>`;
      })
      .join('');
  }

  // ==================== VIEW MODE 3: MINI FIFA CARDS + CHEMISTRY ====================

  private renderMiniFifaView(): void {
    const board = document.getElementById('tacFifaBoard');
    const svg = document.getElementById('tacFifaLinksSvg') as unknown as SVGSVGElement | null;
    if (!board || !svg) return;

    const form = this.getCurrentFormation();
    const assigned = this.getAssignedPlayersForCurrentFormation();
    const chem = computeTeamChemistry(form, assigned);

    const kpiChem = document.getElementById('tacKpiChem');
    if (kpiChem) kpiChem.textContent = `${chem.totalPct} / 100`;
    const kpiOvr = document.getElementById('tacKpiOvr');
    if (kpiOvr) kpiOvr.textContent = chem.avgOvr ? String(chem.avgOvr) : '--';
    const kpiAssigned = document.getElementById('tacKpiAssigned');
    if (kpiAssigned) {
      const count = assigned.filter(Boolean).length;
      kpiAssigned.textContent = `${count} / ${form.slots.length}`;
    }

    // Draw SVG Chemistry lines
    const lines = chem.linkResults
      .map((lk) => {
        const a = form.slots[lk.a];
        const b = form.slots[lk.b];
        if (!a || !b) return '';
        const cls =
          lk.level === 'gold'
            ? 'chem-line-gold'
            : lk.level === 'green'
            ? 'chem-line-green'
            : 'chem-line-dashed';
        return `<line x1="${a.x}%" y1="${a.y}%" x2="${b.x}%" y2="${b.y}%" class="${cls}" />`;
      })
      .join('');
    svg.innerHTML = lines;

    // Render Mini FIFA Cards positioned on pitch
    board.innerHTML = form.slots
      .map((s, idx) => {
        const pl = assigned[idx];
        const ovr = pl ? computePlayerOvr(pl) : 0;
        const photo = pl ? sanitizeImageDataUrl(pl.photo || '', 250000) : '';
        const tierCls = ovr >= 84 ? 'mini-diamond' : ovr >= 74 ? 'mini-gold' : pl ? 'mini-emerald' : 'mini-empty';
        return `<button type="button" data-assign-slot="${idx}" class="mini-fifa-card ${tierCls} ${this.prefs.size === '11v11' ? 'compact' : ''}" style="left:${s.x}%;top:${s.y}%;">
          <div class="mini-fifa-top">
            <span class="mini-fifa-ovr">${pl ? ovr : '+'}</span>
            <span class="mini-fifa-pos">${escapeHtml(s.short)}</span>
          </div>
          <div class="mini-fifa-pic">
            ${photo ? `<img src="${photo}" alt="" />` : `<span>${pl ? '#' + escapeHtml(String(pl.jersey || '★')) : '👤'}</span>`}
          </div>
          <div class="mini-fifa-name">${pl ? escapeHtml(firstWord(pl.name)) : escapeHtml(s.label.split(' ')[0])}</div>
        </button>`;
      })
      .join('');
  }

  // ==================== 10 ANIMATED SCENARIOS ====================

  private renderScenariosSection(): void {
    const filterEl = document.getElementById('tacScenarioFilters');
    const listEl = document.getElementById('scenariosList');
    if (!listEl) return;

    const cats = ['الكل', 'هجومي', 'دفاعي', 'كرات ثابتة', 'مواقف حاسمة'];
    if (filterEl) {
      filterEl.innerHTML = cats
        .map(
          (cat) => `<button type="button" data-sc-cat="${escapeHtml(cat)}" class="star-filter-btn ${this.scenarioCatFilter === cat ? 'active' : ''}">${escapeHtml(cat)}</button>`
        )
        .join('');
    }

    const filtered =
      this.scenarioCatFilter === 'الكل'
        ? TACTICAL_SCENARIOS_10
        : TACTICAL_SCENARIOS_10.filter((s) => s.category === this.scenarioCatFilter);

    listEl.innerHTML = filtered
      .map((sc) => {
        const active = this.activeScenarioId === sc.id;
        return `<button type="button" data-scenario-id="${escapeHtml(sc.id)}" class="scenario-card ${active ? 'active' : ''}">
          <div class="row between" style="width:100%;margin-bottom:3px;">
            <strong style="font-size:0.84rem;color:${active ? '#070709' : '#f8fafc'};">${sc.icon} ${sc.index}. ${escapeHtml(sc.title)}</strong>
            <span class="scenario-cat-tag">${escapeHtml(sc.category)}</span>
          </div>
          <div style="font-size:0.74rem;color:${active ? '#18181b' : '#a1a1aa'};text-align:right;">${escapeHtml(sc.summary)}</div>
        </button>`;
      })
      .join('');
  }

  // ==================== CAPTAIN TACTICAL TOOLS ====================

  private renderCaptainTools(): void {
    const body = document.getElementById('tacCaptainBody');
    if (!body || !this.ctx) return;

    document.querySelectorAll<HTMLButtonElement>('[data-cap-tab]').forEach((b) => {
      b.classList.toggle('active', b.dataset.capTab === this.captainTab);
    });

    const players = this.ctx.getPlayers();
    const form = this.getCurrentFormation();
    const teamName = this.ctx.getTeamSettings().teamName || 'فريق السداسي';

    if (this.captainTab === 'smart') {
      const availCount = players.filter((p) => p.availableStatus !== 'unavailable').length;
      const unavail = players.filter((p) => p.availableStatus === 'unavailable');
      body.innerHTML = `
        <div class="item-box">
          <div style="font-weight:800;color:var(--primary);margin-bottom:4px;">🧠 مقترح التشكيلة الذكي (${escapeHtml(form.name)})</div>
          <p class="muted" style="margin-bottom:10px;">يختار تلقائياً أنسب اللاعبين المتاحين لكل مركز حسب مركزهم الأساسي والثانوي وتقييمهم، ويستبعد غير المتاحين والمصابين تلقائياً.</p>
          <div class="row between" style="margin-bottom:10px;">
            <span class="badge">✅ متاحون: ${availCount}</span>
            <span class="badge" style="color:${unavail.length ? '#f43f5e' : '#22c55e'};">${unavail.length ? `⛔ مستبعدون: ${unavail.length}` : '✨ لا غيابات'}</span>
          </div>
          <button type="button" id="btnApplySmartLineup" class="btn-primary" style="width:100%;">⚡ تطبيق التشكيلة الذكية الآن على الملعب</button>
        </div>
      `;
      document.getElementById('btnApplySmartLineup')?.addEventListener('click', () => {
        if (!this.ctx) return;
        this.ctx.takeSnapshot();
        const res = suggestSmartLineup(players, form);
        Object.entries(res.slots).forEach(([key, pid]) => {
          const idx = Number(key.split('_').pop() || '0');
          this.setSlotPlayerId(form.id, idx, pid);
        });
        this.renderAll();
        this.ctx.toast(
          `تم توزيع ${res.assignedCount} لاعبين بذكاء ✓${res.excludedCount ? ` (استُبعد ${res.excludedCount} غير متاح)` : ''}`,
          false,
          true
        );
      });
      return;
    }

    if (this.captainTab === 'split') {
      const split = splitFairTeams(players, teamName);
      body.innerHTML = `
        <div class="row between" style="margin-bottom:8px;">
          <span class="badge">📊 فارق القوة: ${split.diff} نقطة فقط</span>
          <button type="button" id="btnCopySplitWa" class="btn-emerald" style="min-height:36px;padding:6px 12px;font-size:0.78rem;">📋 نسخ لواتساب</button>
        </div>
        <div class="grid-2" style="gap:8px;">
          <div class="item-box" style="margin:0;border-color:rgba(250,204,21,0.5);">
            <div style="font-weight:900;color:var(--primary);margin-bottom:6px;">🟡 الفريق الذهبي (${split.goldAvg})</div>
            ${split.gold.map((p) => `<div style="font-size:0.78rem;padding:3px 0;border-bottom:1px solid rgba(255,255,255,0.05);display:flex;justify-content:space-between;"><span>${escapeHtml(p.name)}</span><strong style="color:var(--primary);">${p.ovr}</strong></div>`).join('') || '<span class="muted">—</span>'}
          </div>
          <div class="item-box" style="margin:0;border-color:rgba(226,232,240,0.35);">
            <div style="font-weight:900;color:#e2e8f0;margin-bottom:6px;">⚪ الفريق الفضي (${split.silverAvg})</div>
            ${split.silver.map((p) => `<div style="font-size:0.78rem;padding:3px 0;border-bottom:1px solid rgba(255,255,255,0.05);display:flex;justify-content:space-between;"><span>${escapeHtml(p.name)}</span><strong style="color:#e2e8f0;">${p.ovr}</strong></div>`).join('') || '<span class="muted">—</span>'}
          </div>
        </div>
        ${split.excludedUnavailable.length ? `<p class="muted" style="margin-top:8px;">⛔ تم استبعاد غير المتاحين تلقائياً: ${split.excludedUnavailable.map((p) => escapeHtml(p.name)).join('، ')}</p>` : ''}
      `;
      document.getElementById('btnCopySplitWa')?.addEventListener('click', () => {
        if (navigator.clipboard) {
          navigator.clipboard
            .writeText(split.whatsappText)
            .then(() => this.ctx?.toast('تم نسخ التقسيمة العادلة لواتساب ✓'))
            .catch(() => this.ctx?.toast('انسخ التقسيمة يدوياً'));
        } else {
          this.ctx?.toast('النسخ التلقائي غير مدعوم في هذا المتصفح');
        }
      });
      return;
    }

    if (this.captainTab === 'roles') {
      const opts = (selectedId: string) =>
        `<option value="">— اختر لاعباً —</option>` +
        players
          .map(
            (p) =>
              `<option value="${escapeHtml(p.id)}" ${p.id === selectedId ? 'selected' : ''}>${escapeHtml(p.name)} (#${escapeHtml(String(p.jersey || '★'))})</option>`
          )
          .join('');
      body.innerHTML = `
        <div class="grid-2" style="gap:8px;">
          <div class="item-box" style="margin:0;">
            <label class="muted" style="display:block;margin-bottom:4px;">👑 قائد الملعب (C)</label>
            <select id="roleCaptainSel">${opts(this.prefs.setPieces.captainId)}</select>
          </div>
          <div class="item-box" style="margin:0;">
            <label class="muted" style="display:block;margin-bottom:4px;">🚩 منفّذ الركنيات</label>
            <select id="roleCornerSel">${opts(this.prefs.setPieces.cornerId)}</select>
          </div>
          <div class="item-box" style="margin:0;">
            <label class="muted" style="display:block;margin-bottom:4px;">🎯 منفّذ الضربات الحرة</label>
            <select id="roleFkSel">${opts(this.prefs.setPieces.freeKickId)}</select>
          </div>
          <div class="item-box" style="margin:0;">
            <label class="muted" style="display:block;margin-bottom:4px;">🧤 الحارس البديل</label>
            <select id="roleGkSel">${opts(this.prefs.setPieces.backupGkId)}</select>
          </div>
        </div>
        <p class="muted" style="margin-top:8px;">تظهر شارات القائد والكرات الثابتة تلقائياً فوق بوستر التشكيلة الرسمية ✨</p>
      `;
      const bindRole = (id: string, key: keyof StudioPrefs['setPieces']) => {
        document.getElementById(id)?.addEventListener('change', (e) => {
          this.prefs.setPieces[key] = (e.target as HTMLSelectElement).value;
          savePrefs(this.prefs);
          if (this.viewMode === 'poster') this.renderOfficialPosterView();
          this.ctx?.toast('تم تحديث الأدوار الثابتة ✓');
        });
      };
      bindRole('roleCaptainSel', 'captainId');
      bindRole('roleCornerSel', 'cornerId');
      bindRole('roleFkSel', 'freeKickId');
      bindRole('roleGkSel', 'backupGkId');
      return;
    }

    if (this.captainTab === 'gk') {
      body.innerHTML = `
        <div class="grid-2" style="gap:8px;">
          ${GK_TACTICAL_GUIDE.map(
            (g) => `<div class="item-box" style="margin:0;">
              <div style="font-weight:800;color:var(--primary);margin-bottom:4px;">${g.icon} ${escapeHtml(g.title)}</div>
              <div style="font-size:0.78rem;color:#d4d4d8;line-height:1.55;">${escapeHtml(g.desc)}</div>
            </div>`
          ).join('')}
        </div>
      `;
      return;
    }

    // Rotation plan + optional timer
    const plan = buildRotationPlan(players, PITCH_SIZE_META[this.prefs.size].count, this.prefs.rotationInterval);
    body.innerHTML = `
      <div class="item-box" style="border-color:rgba(250,204,21,0.4);">
        <div class="row between" style="margin-bottom:8px;">
          <div>
            <div style="font-weight:800;color:var(--primary);">⏱️ منبّه التبديل العادل</div>
            <div class="muted">ينبّهك بصوت لطيف وإشعار عند انتهاء الوقت</div>
          </div>
          <div id="tacTimerDisplay" style="font-size:1.5rem;font-weight:900;color:var(--primary);font-variant-numeric:tabular-nums;">${this.formatClock(this.timerSecondsLeft)}</div>
        </div>
        <div class="row" style="gap:6px;margin-bottom:8px;">
          ${[12, 14, 15]
            .map(
              (m) => `<button type="button" data-rot-min="${m}" class="tac-pill ${this.prefs.rotationInterval === m ? 'active' : ''}">كل ${m} د</button>`
            )
            .join('')}
        </div>
        <div class="grid-2" style="gap:8px;">
          <button type="button" id="btnTacTimerToggle" class="btn-primary">${this.timerRunning ? '⏸ إيقاف المنبّه' : '▶ تشغيل المنبّه'}</button>
          <button type="button" id="btnTacTimerReset">↻ تصفير العدّاد</button>
        </div>
      </div>
      <div class="item-box" style="margin-top:8px;">
        <div style="font-weight:800;margin-bottom:6px;">🔄 جدول التبديلات المقترح (${plan.bench.length ? `${plan.bench.length} احتياط` : 'لا يوجد احتياط متاح'})</div>
        ${
          plan.schedule.length
            ? plan.schedule
                .map(
                  (row) => `<div style="font-size:0.8rem;padding:5px 0;border-bottom:1px solid rgba(255,255,255,0.06);display:flex;justify-content:space-between;">
                    <span style="color:var(--primary);font-weight:800;">الدقيقة ${row.minute}</span>
                    <span>🟢 ${escapeHtml(row.subIn)} ⇄ 🔴 ${escapeHtml(row.subOut)}</span>
                  </div>`
                )
                .join('')
            : '<p class="muted">عند توفر لاعبين احتياطيين (أكثر من عدد التشكيلة الأساسية)، يُبنى جدول تبديل عادل تلقائياً.</p>'
        }
      </div>
    `;

    document.querySelectorAll<HTMLButtonElement>('[data-rot-min]').forEach((b) => {
      b.addEventListener('click', () => {
        this.prefs.rotationInterval = Number(b.dataset.rotMin);
        savePrefs(this.prefs);
        this.resetRotationTimer();
        this.renderCaptainTools();
      });
    });
    document.getElementById('btnTacTimerToggle')?.addEventListener('click', () => {
      if (this.timerRunning) this.pauseRotationTimer();
      else this.startRotationTimer();
    });
    document.getElementById('btnTacTimerReset')?.addEventListener('click', () => this.resetRotationTimer());
  }

  // ==================== STATIC EVENT BINDING ====================

  private bindStaticEvents(): void {
    // Size pills delegation
    document.getElementById('tacSizeBar')?.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-tac-size]');
      if (!btn) return;
      const sz = btn.dataset.tacSize as PitchSizeId;
      if (!sz || sz === this.prefs.size) return;
      this.setPitchSize(sz);
    });

    // View mode tabs
    document.querySelectorAll<HTMLButtonElement>('[data-tac-view]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const next = btn.dataset.tacView as StudioViewMode;
        if (!next) return;
        this.pause();
        this.viewMode = next;
        this.renderAll();
      });
    });

    // 4 Phase switcher buttons
    document.querySelectorAll<HTMLButtonElement>('[data-tac-phase]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const ph = btn.dataset.tacPhase as TacticalPhaseId;
        if (!ph) return;
        this.phase = ph;
        this.activeScenarioId = null;
        this.spotlightSlotIdx = null;
        this.spotlightInfo = null;
        this.loadCurrentPhaseSequence(true);
        this.renderAll();
      });
    });

    // Pitch Toolbar: 2.5D/2D, Triangles, Opponents, Record Mode
    document.getElementById('btnTacToggle25D')?.addEventListener('click', () => {
      if (document.body.classList.contains('data-saver')) {
        this.ctx?.toast('وضع توفير البيانات ⚡ يُبقي الملعب 2D مسطّح للخفة');
        return;
      }
      this.is25D = !this.is25D;
      this.renderPitchShellClasses();
      this.renderToolbarState();
    });

    document.getElementById('btnTacTriangles')?.addEventListener('click', () => {
      this.showTriangles = !this.showTriangles;
      this.renderToolbarState();
      this.renderSvgPitch();
    });

    document.getElementById('btnTacOpponents')?.addEventListener('click', () => {
      this.showOpponents = !this.showOpponents;
      this.renderToolbarState();
      this.renderSvgPitch();
    });

    document.getElementById('btnTacRecordMode')?.addEventListener('click', () => {
      this.isRecordingMode = !this.isRecordingMode;
      this.renderToolbarState();
      this.renderRecorderPanel();
    });

    // Timeline controls
    document.getElementById('btnTacPlay')?.addEventListener('click', () => {
      if (this.isPlaying) this.pause();
      else this.play();
    });
    document.getElementById('btnTacReplay')?.addEventListener('click', () => this.replay());
    document.getElementById('btnTacPrev')?.addEventListener('click', () => this.stepPrev());
    document.getElementById('btnTacNext')?.addEventListener('click', () => this.stepNext());
    document.getElementById('btnTacVoice')?.addEventListener('click', () => {
      if (!this.isSpeechSupported()) {
        this.ctx?.toast('التعليق الصوتي العربي غير مدعوم على هذا المتصفح — الشرح النصي يعمل بسلاسة');
        return;
      }
      this.voiceEnabled = !this.voiceEnabled;
      if (!this.voiceEnabled) this.stopSpeech();
      else {
        const cur = this.sequence.frames[this.frameIdx];
        if (cur?.narration) this.speakText(cur.narration);
      }
      this.renderTimelineButtons();
    });

    document.querySelectorAll<HTMLButtonElement>('[data-tac-speed]').forEach((b) => {
      b.addEventListener('click', () => {
        this.speed = Number(b.dataset.tacSpeed) || 1;
        this.renderTimelineButtons();
      });
    });

    document.getElementById('tacStepDots')?.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-tac-step]');
      if (!btn) return;
      this.pause();
      this.goToFrame(Number(btn.dataset.tacStep), true);
    });

    // SVG Drag & Drop pointer listeners
    const svg = document.getElementById('tacPitchSvg') as unknown as SVGSVGElement | null;
    if (svg) {
      svg.addEventListener('pointerdown', this.handlePointerDown);
      svg.addEventListener('pointermove', this.handlePointerMove);
      svg.addEventListener('pointerup', this.handlePointerUp);
      svg.addEventListener('pointercancel', this.handlePointerUp);
    }

    // Recorder actions
    document.getElementById('btnTacRecAdd')?.addEventListener('click', () => this.captureCustomFrame());
    document.getElementById('btnTacRecPlay')?.addEventListener('click', () => this.playRecordedDraft());
    document.getElementById('btnTacRecSave')?.addEventListener('click', () => this.saveRecordedPlan());
    document.getElementById('btnTacRecClear')?.addEventListener('click', () => {
      this.recordedFrames = [];
      this.renderRecorderPanel();
      this.ctx?.toast('تم مسح مسودة اللقطات');
    });
    document.getElementById('tacSavedCustomPlans')?.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const loadBtn = target.closest<HTMLButtonElement>('[data-load-plan]');
      if (loadBtn?.dataset.loadPlan) {
        this.loadCustomPlan(loadBtn.dataset.loadPlan);
        return;
      }
      const delBtn = target.closest<HTMLButtonElement>('[data-del-plan]');
      if (delBtn?.dataset.delPlan) {
        this.prefs.customPlans = this.prefs.customPlans.filter((p) => p.id !== delBtn.dataset.delPlan);
        savePrefs(this.prefs);
        this.renderRecorderPanel();
        this.ctx?.toast('تم حذف الخطة المحفوظة');
      }
    });

    // Poster & Mini FIFA click-to-assign slot delegation
    const bindAssignBoard = (id: string) => {
      document.getElementById(id)?.addEventListener('click', (e) => {
        const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-assign-slot]');
        if (!btn || !this.ctx) return;
        const idx = Number(btn.dataset.assignSlot);
        const form = this.getCurrentFormation();
        const slot = form.slots[idx];
        if (!slot) return;
        const curId = this.getSlotPlayerId(form.id, idx, form.slots.length);
        this.ctx.openSlotPicker(slot.label, curId, (pid) => {
          this.setSlotPlayerId(form.id, idx, pid);
          this.renderAll();
        });
      });
    };
    bindAssignBoard('tacPosterBoard');
    bindAssignBoard('tacFifaBoard');

    // Export Official Lineup Poster PNG
    document.getElementById('btnExportPosterPng')?.addEventListener('click', () => {
      void this.exportLineupPosterPng();
    });

    // Scenario filters & cards delegation
    document.getElementById('tacScenarioFilters')?.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-sc-cat]');
      if (!btn?.dataset.scCat) return;
      this.scenarioCatFilter = btn.dataset.scCat;
      this.renderScenariosSection();
    });
    document.getElementById('scenariosList')?.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-scenario-id]');
      if (!btn?.dataset.scenarioId) return;
      this.loadScenario(btn.dataset.scenarioId);
    });

    // Captain tools tabs
    document.querySelectorAll<HTMLButtonElement>('[data-cap-tab]').forEach((b) => {
      b.addEventListener('click', () => {
        const t = b.dataset.capTab as CaptainToolTab;
        if (!t) return;
        this.captainTab = t;
        this.renderCaptainTools();
      });
    });
  }
}

const studioInstance = new TacticsStudioController();

declare global {
  interface Window {
    MaydanTacticsStudio?: TacticsStudioController;
  }
}

window.MaydanTacticsStudio = studioInstance;
export { studioInstance as MaydanTacticsStudio };

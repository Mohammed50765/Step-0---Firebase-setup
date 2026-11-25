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
  type TacticalArrow,
  type RoleSpotlightInfo,
  type MinimalPlayer,
  type MinimalReadinessLog,
} from './tacticsData';
import { escapeHtml, sanitizeImageDataUrl } from './security';
import {
  isolateLtrTokens,
  formatFormationHtml,
  deOverlapPositions,
  computeOpponentAlertSet,
  placeOffsideBadge,
  placeCalloutBox,
  placePlayerLabels,
  resolveYourRoleCard,
} from './tacticsLayout';
import {
  buildTimelineMetrics,
  sampleTimeline,
  frameIndexToElapsedMs,
  evalBallArc,
  buildCurvedArrowGeometry,
  buildPartialQuadPath,
  interpolatePoints,
  projectClientToPitchPct,
  type TimelineMetrics,
} from './tacticsEngine';

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
  getCurrentUser?: () => MinimalPlayer | null;
  getPlayerOvr?: (p: MinimalPlayer) => number | null;
  getReadiness?: () => MinimalReadinessLog[];
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

function toSvgX(x: number): number {
  return 18 + (Math.max(2, Math.min(98, x)) / 100) * (SVG_W - 36);
}

function toSvgY(y: number): number {
  return 20 + (Math.max(2, Math.min(98, y)) / 100) * (SVG_H - 40);
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
  private optionsDrawerOpen = false;
  private speedDrawerOpen = false;
  private calloutCollapsed = false;
  private focusMineOnly = false;
  private captainTab: CaptainToolTab = 'smart';

  // Unified rAF Timeline & Animation Engine
  private sequence: TacticalSequence;
  private timelineMetrics: TimelineMetrics = buildTimelineMetrics([]);
  private frameIdx = 0;
  private timelineElapsedMs = 0;
  private isPlaying = false;
  private speed = 1;
  private voiceEnabled = false;
  private rafId: number | null = null;
  private lastRafTs = 0;
  private singleStepStopMs: number | null = null;
  private waitingForSpeech = false;
  private lastSpokenFrameIdx = -1;
  private speechSafetyTimer: number | null = null;

  // Live animation visual state (arrows, ball arc loft & comet trail)
  private arrowRevealT = 1;
  private ballLift = 0;
  private ballShadowDy = 2;
  private ballScale = 1;
  private ballTrailPath: string | null = null;

  // Live rendered coordinates (also mutated by drag & drop)
  private currentOur: Array<{ x: number; y: number }> = [];
  private currentOpp: Array<{ x: number; y: number }> = [];
  private currentBall: { x: number; y: number } = { x: 50, y: 50 };

  // Dragging state (with synchronous 2.5D -> 2D flattening protection)
  private dragTarget: { kind: 'our' | 'opp' | 'ball'; idx: number } | null = null;
  private dragStartClient = { x: 0, y: 0 };
  private dragMoved = false;
  private dragFlattened = false;

  // Custom plan recorder
  private isRecordingMode = false;
  private recordedFrames: TacticalKeyframe[] = [];

  // Rotation countdown timer
  private timerSecondsLeft = 12 * 60;
  private timerRunning = false;
  private timerIntervalId: number | null = null;

  constructor() {
    this.sequence = getFormationPhaseSequence('6v6', '2-2-1', 'attack');
    this.setActiveSequence(this.sequence);
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

  private isMotionReduced(): boolean {
    if (typeof document !== 'undefined' && document.body.classList.contains('data-saver')) return true;
    if (typeof window !== 'undefined' && window.matchMedia) {
      try {
        return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      } catch {
        return false;
      }
    }
    return false;
  }

  private setActiveSequence(seq: TacticalSequence): void {
    this.sequence = seq;
    this.timelineMetrics = buildTimelineMetrics(seq.frames);
    this.frameIdx = 0;
    this.timelineElapsedMs = 0;
    this.singleStepStopMs = null;
    this.waitingForSpeech = false;
    this.lastSpokenFrameIdx = -1;
    this.applyFrameImmediate(0);
  }

  private loadCurrentPhaseSequence(autoPlay: boolean): void {
    this.pause();
    const formId = this.getCurrentFormationId();
    this.setActiveSequence(getFormationPhaseSequence(this.prefs.size, formId, this.phase));
    if (autoPlay && !this.isMotionReduced()) {
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
    this.setActiveSequence({
      id: sc.id,
      title: `${sc.icon} ${sc.title}`,
      subtitle: sc.summary,
      size: '6v6',
      offsideEnabled: false,
      frames: sc.frames,
    });
    this.renderAll();
    if (!this.isMotionReduced()) {
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
    this.setActiveSequence(this.spotlightInfo.sequence);
    this.renderAll();
    if (!this.isMotionReduced()) {
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

  // ==================== UNIFIED rAF TIMELINE & ANIMATION ENGINE ====================

  private cancelRaf(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private applyFrameImmediate(idx: number): void {
    const total = this.sequence.frames.length;
    if (!total) return;
    const clamped = Math.max(0, Math.min(total - 1, idx));
    const f = this.sequence.frames[clamped] || this.sequence.frames[0];
    if (!f) return;
    this.frameIdx = clamped;
    this.timelineElapsedMs = frameIndexToElapsedMs(this.timelineMetrics, clamped);
    this.currentOur = f.ourPos.map((p) => ({ ...p }));
    this.currentOpp = f.oppPos.map((p) => ({ ...p }));
    this.currentBall = { ...f.ball };
    this.arrowRevealT = 1;
    this.ballLift = 0;
    this.ballShadowDy = 2;
    this.ballScale = 1;
    this.ballTrailPath = null;
  }

  private updateScrubberOnly(globalProgress: number, elapsedMs: number): void {
    const rangeEl = document.getElementById('tacProgressRange') as HTMLInputElement | null;
    if (rangeEl) {
      const clampedProg = Math.max(0, Math.min(1, globalProgress));
      rangeEl.max = '1000';
      rangeEl.value = String(Math.round(clampedProg * 1000));
      rangeEl.style.setProperty('--tac-prog', `${(clampedProg * 100).toFixed(1)}%`);
    }
    const elapsedEl = document.getElementById('tacTimeElapsed');
    if (elapsedEl) {
      const totalSec = Math.max(1, Math.round(this.timelineMetrics.totalMs / 1000));
      const sec = Math.min(totalSec, Math.floor(elapsedMs / 1000));
      elapsedEl.textContent = this.formatClock(sec);
    }
  }

  private applyTimelineAt(rawElapsedMs: number, forceTextRender = false): void {
    const frames = this.sequence.frames;
    if (!frames.length) return;

    const sample = sampleTimeline(this.timelineMetrics, rawElapsedMs);
    this.timelineElapsedMs = sample.elapsedMs;
    const frameChanged = sample.frameIdx !== this.frameIdx;
    this.frameIdx = sample.frameIdx;

    const targetFrame = frames[sample.frameIdx];
    const prevFrame = sample.frameIdx > 0 ? frames[sample.frameIdx - 1] : targetFrame;
    const reduced = this.isMotionReduced();

    const effMoveT = reduced ? 1 : sample.moveT;
    this.arrowRevealT = reduced ? 1 : sample.arrowRevealT;

    this.currentOur = interpolatePoints(prevFrame.ourPos, targetFrame.ourPos, effMoveT);
    this.currentOpp = interpolatePoints(prevFrame.oppPos, targetFrame.oppPos, effMoveT);

    if (reduced || sample.frameIdx === 0 || effMoveT >= 0.999) {
      this.currentBall = { ...targetFrame.ball };
      this.ballLift = 0;
      this.ballShadowDy = 2;
      this.ballScale = 1;
      this.ballTrailPath = null;
    } else {
      const arc = evalBallArc(prevFrame.ball, targetFrame.ball, effMoveT);
      this.currentBall = { x: arc.x, y: arc.y };
      this.ballLift = arc.lift;
      this.ballShadowDy = arc.shadowDy;
      this.ballScale = arc.scale;
      const ballDist = Math.hypot(targetFrame.ball.x - prevFrame.ball.x, targetFrame.ball.y - prevFrame.ball.y);
      if (ballDist >= 8 && effMoveT > 0.03) {
        this.ballTrailPath = buildPartialQuadPath(
          toSvgX(prevFrame.ball.x),
          toSvgY(prevFrame.ball.y),
          toSvgX(arc.ctrlX),
          toSvgY(arc.ctrlY),
          toSvgX(targetFrame.ball.x),
          toSvgY(targetFrame.ball.y),
          effMoveT
        );
      } else {
        this.ballTrailPath = null;
      }
    }

    if (frameChanged || forceTextRender) {
      this.renderNarrationAndTimeline();
      this.renderYourRoleCard();
    } else {
      this.updateScrubberOnly(sample.globalProgress, sample.elapsedMs);
    }

    this.renderSvgPitch();
  }

  private triggerVoiceForCurrentFrame(): void {
    if (!this.voiceEnabled || !this.isSpeechSupported()) return;
    if (this.lastSpokenFrameIdx === this.frameIdx) return;
    const frame = this.sequence.frames[this.frameIdx];
    this.lastSpokenFrameIdx = this.frameIdx;
    if (!frame?.narration) return;
    this.waitingForSpeech = true;
    this.speakText(frame.narration, () => {
      this.waitingForSpeech = false;
    });
  }

  private runTimelineTick = (now: number): void => {
    const dt = Math.min(64, Math.max(0, now - this.lastRafTs));
    this.lastRafTs = now;

    // Case 1: Smooth single-step transition (Prev / Next / Dot click while paused)
    if (!this.isPlaying && this.singleStepStopMs !== null) {
      const nextElapsed = this.timelineElapsedMs + dt * this.speed;
      if (nextElapsed >= this.singleStepStopMs) {
        const stopAt = this.singleStepStopMs;
        this.singleStepStopMs = null;
        this.rafId = null;
        this.applyTimelineAt(stopAt, false);
        return;
      }
      this.applyTimelineAt(nextElapsed, false);
      this.rafId = requestAnimationFrame(this.runTimelineTick);
      return;
    }

    if (!this.isPlaying) {
      this.rafId = null;
      return;
    }

    // Trigger Arabic speech once upon entering each frame
    if (this.voiceEnabled && this.isSpeechSupported() && this.lastSpokenFrameIdx !== this.frameIdx) {
      this.triggerVoiceForCurrentFrame();
    }

    const reduced = this.isMotionReduced();
    let nextElapsed = this.timelineElapsedMs + dt * this.speed;

    // Hold cleanly at end of current frame segment while Arabic voice is still reading
    if (this.waitingForSpeech) {
      const segStart = this.timelineMetrics.segmentStarts[this.frameIdx] || 0;
      const segDur = this.timelineMetrics.segmentDurations[this.frameIdx] || 2500;
      const holdMs = Math.max(segStart, segStart + segDur - 16);
      if (nextElapsed >= holdMs) {
        nextElapsed = holdMs;
      }
    }

    if (nextElapsed >= this.timelineMetrics.totalMs) {
      this.isPlaying = false;
      this.rafId = null;
      this.applyTimelineAt(this.timelineMetrics.totalMs, true);
      this.renderTimelineButtons();
      return;
    }

    if (reduced) {
      const nextSample = sampleTimeline(this.timelineMetrics, nextElapsed);
      const secChanged = Math.floor(nextElapsed / 1000) !== Math.floor(this.timelineElapsedMs / 1000);
      if (nextSample.frameIdx !== this.frameIdx) {
        this.applyTimelineAt(nextElapsed, true);
      } else {
        this.timelineElapsedMs = nextSample.elapsedMs;
        if (secChanged) {
          this.updateScrubberOnly(nextSample.globalProgress, nextSample.elapsedMs);
        }
      }
    } else {
      this.applyTimelineAt(nextElapsed, false);
    }

    this.rafId = requestAnimationFrame(this.runTimelineTick);
  };

  private goToFrame(idx: number, animate = true): void {
    const total = this.sequence.frames.length;
    if (!total) return;
    const clamped = Math.max(0, Math.min(total - 1, idx));
    this.cancelRaf();
    this.singleStepStopMs = null;

    const shouldAnimate = animate && !this.isMotionReduced() && clamped > 0;
    if (!shouldAnimate) {
      this.applyFrameImmediate(clamped);
      this.renderNarrationAndTimeline();
      this.renderYourRoleCard();
      this.renderSvgPitch();
      return;
    }

    const segStart = this.timelineMetrics.segmentStarts[clamped] || 0;
    const segDur = this.timelineMetrics.segmentDurations[clamped] || 2500;
    const moveWindowMs = Math.min(950, segDur * 0.44);

    this.singleStepStopMs = segStart + moveWindowMs;
    this.applyTimelineAt(segStart + 1, true);
    this.lastRafTs = performance.now();
    this.rafId = requestAnimationFrame(this.runTimelineTick);
  }

  private play(): void {
    if (this.sequence.frames.length === 0) return;
    this.cancelRaf();
    this.singleStepStopMs = null;
    if (this.timelineElapsedMs >= this.timelineMetrics.totalMs - 40) {
      this.timelineElapsedMs = 0;
      this.applyTimelineAt(0, true);
    }
    this.waitingForSpeech = false;
    this.lastSpokenFrameIdx = -1;
    this.isPlaying = true;
    this.lastRafTs = performance.now();
    this.renderTimelineButtons();
    this.rafId = requestAnimationFrame(this.runTimelineTick);
  }

  private pause(): void {
    this.isPlaying = false;
    this.singleStepStopMs = null;
    this.waitingForSpeech = false;
    this.cancelRaf();
    this.stopSpeech();
    this.renderTimelineButtons();
  }

  private replay(): void {
    this.pause();
    this.timelineElapsedMs = 0;
    this.applyTimelineAt(0, true);
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

  // ==================== POINTER DRAG-AND-DROP BOARD (WITH 2.5D TOUCH FLATTENING) ====================

  private getSvgPointFromEvent(svg: SVGSVGElement, e: PointerEvent): { x: number; y: number } {
    return projectClientToPitchPct(e.clientX, e.clientY, svg.getBoundingClientRect(), SVG_W, SVG_H);
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
    this.ballLift = 0;
    this.ballShadowDy = 2;
    this.ballScale = 1;
    this.ballTrailPath = null;
    this.dragTarget = { kind, idx };
    this.dragStartClient = { x: e.clientX, y: e.clientY };
    this.dragMoved = false;

    // Synchronously flatten 2.5D perspective to flat 2D BEFORE any getBoundingClientRect() projection
    this.dragFlattened = true;
    this.renderPitchShellClasses();
    this.renderSvgPitch();

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

    if (this.dragFlattened) {
      this.dragFlattened = false;
      this.renderPitchShellClasses();
    }
    this.renderSvgPitch();

    // Short tap on one of our players opens Role Spotlight!
    if (!wasDrag && released.kind === 'our') {
      this.enterRoleSpotlight(released.idx);
    }
  };

  // ==================== CUSTOM PLAN RECORDER ====================

  private buildAutoArrowsFromPrev(prev: TacticalKeyframe | undefined): TacticalArrow[] {
    if (!prev) return [];
    const arrows: TacticalArrow[] = [];
    // Ball movement arrow if ball moved significantly
    if (Math.hypot(this.currentBall.x - prev.ball.x, this.currentBall.y - prev.ball.y) >= 4) {
      arrows.push({
        from: [prev.ball.x, prev.ball.y],
        to: [this.currentBall.x, this.currentBall.y],
        kind: 'ball',
      });
    }
    // Player run arrows for players who moved meaningfully
    this.currentOur.forEach((pt, idx) => {
      const old = prev.ourPos[idx];
      if (!old) return;
      if (Math.hypot(pt.x - old.x, pt.y - old.y) >= 5) {
        arrows.push({
          from: [old.x, old.y],
          to: [pt.x, pt.y],
          kind: pt.y > old.y + 4 ? 'cover' : 'run',
        });
      }
    });
    return arrows;
  }

  private captureCustomFrame(): void {
    const stepNo = this.recordedFrames.length + 1;
    const noteEl = document.getElementById('tacRecNote') as HTMLInputElement | null;
    const customNote = (noteEl?.value || '').trim();
    const narration = customNote || `لقطة مخصّصة رقم ${stepNo} — حرّك اللاعبين والكرة ثم أضف اللقطة التالية.`;
    const prevFrame = this.recordedFrames[this.recordedFrames.length - 1];
    const autoArrows = this.buildAutoArrowsFromPrev(prevFrame);
    const movedIndices: number[] = [];
    if (prevFrame) {
      this.currentOur.forEach((pt, idx) => {
        const old = prevFrame.ourPos[idx];
        if (old && Math.hypot(pt.x - old.x, pt.y - old.y) >= 5) movedIndices.push(idx);
      });
    }
    this.recordedFrames.push({
      title: `لقطة ${stepNo}: ${customNote ? customNote.slice(0, 28) : 'حركة تكتيكية مخصّصة'}`,
      narration,
      durationMs: 2400,
      ourPos: this.currentOur.map((p) => ({ ...p })),
      oppPos: this.currentOpp.map((p) => ({ ...p })),
      ball: { ...this.currentBall },
      activeIndices: movedIndices,
      arrows: autoArrows,
    });
    if (noteEl) noteEl.value = '';
    this.renderRecorderPanel();
    this.ctx?.toast(`تم التقاط اللقطة #${stepNo} 🎥${autoArrows.length ? ' (مع أسهم الحركة تلقائياً)' : ''}`);
  }

  private popCustomFrame(): void {
    if (!this.recordedFrames.length) {
      this.ctx?.toast('لا توجد لقطات لحذفها');
      return;
    }
    this.recordedFrames.pop();
    this.renderRecorderPanel();
    this.ctx?.toast(`تم حذف آخر لقطة — المتبقي ${this.recordedFrames.length}`);
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
    this.setActiveSequence({
      id: 'custom_preview',
      title: '🎥 معاينة خطتك التكتيكية الخاصة',
      subtitle: `${this.recordedFrames.length} لقطات مسجّلة يدوياً`,
      size: this.prefs.size,
      offsideEnabled: PITCH_SIZE_META[this.prefs.size].offside,
      frames: this.recordedFrames.map((f) => ({ ...f })),
    });
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
    this.setActiveSequence({
      id: plan.id,
      title: `🎥 ${plan.name}`,
      subtitle: `خطة مسجّلة (${plan.size} • ${plan.frames.length} لقطات)`,
      size: plan.size,
      offsideEnabled: PITCH_SIZE_META[plan.size].offside,
      frames: plan.frames,
    });
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
    this.renderYourRoleCard();
    this.renderScenarioGuideCard();
    this.renderSpotlightCard();
    this.renderRecorderPanel();
    this.renderScenariosSection();
    this.renderCaptainTools();
    this.renderSaveButton();
  }

  private renderScenarioGuideCard(): void {
    const box = document.getElementById('tacScenarioGuideBox');
    if (!box) return;
    const sc = this.activeScenarioId
      ? TACTICAL_SCENARIOS_10.find((s) => s.id === this.activeScenarioId)
      : null;
    if (!sc || !sc.guide || this.viewMode !== 'studio') {
      box.classList.add('hidden');
      box.innerHTML = '';
      return;
    }
    const g = sc.guide;
    box.classList.remove('hidden');
    box.innerHTML = `
      <div class="row between" style="margin-bottom:6px;">
        <strong style="font-size:0.82rem;color:var(--primary);">📋 دليل التطبيق العملي (7 نقاط) — ${escapeHtml(sc.title)}</strong>
        <span class="badge">${escapeHtml(sc.category)}</span>
      </div>
      <div style="display:grid;gap:5px;font-size:0.77rem;line-height:1.55;color:#e4e4e7;">
        <div><strong style="color:#fde68a;">1. ما الموقف؟</strong> ${escapeHtml(g.situation)}</div>
        <div><strong style="color:#fde68a;">2. دور كل لاعب:</strong> ${escapeHtml(g.roles)}</div>
        <div><strong style="color:#38bdf8;">3. أين يتحرك؟</strong> ${escapeHtml(g.whereMove)}</div>
        <div><strong style="color:#38bdf8;">4. متى يتحرك؟</strong> ${escapeHtml(g.whenMove)}</div>
        <div><strong style="color:#FACC15;">5. مسار الكرة:</strong> ${escapeHtml(g.ballPath)}</div>
        <div><strong style="color:#4ade80;">6. الهدف من الحركة:</strong> ${escapeHtml(g.goal)}</div>
        <div style="padding:6px 8px;border-radius:8px;background:rgba(244,63,94,0.1);border:1px solid rgba(244,63,94,0.35);color:#fecdd3;">
          <strong>7. ⚠️ خطأ شائع يجب تجنبه:</strong> ${escapeHtml(g.commonMistake)}
        </div>
      </div>
    `;
  }

  private renderSaveButton(): void {
    if (!this.ctx) return;
    const saveBtn = document.getElementById('btnSaveTactics') as HTMLButtonElement | null;
    if (!saveBtn) return;
    const isAdmin = this.ctx.isAdmin();
    if (!isAdmin) {
      saveBtn.disabled = true;
      saveBtn.textContent = '🔒 اعتماد وحفظ التشكيلة الرسمية متاح للكابتن فقط';
      return;
    }
    saveBtn.disabled = false;
    if (this.prefs.size === '6v6') {
      saveBtn.innerHTML = formatFormationHtml('💾 حفظ التشكيلة الرسمية للفريق (6v6)');
    } else {
      saveBtn.innerHTML = formatFormationHtml(`💾 حفظ لوحة ${this.prefs.size} محلياً`);
    }
  }

  private renderSizeAndFormationSelectors(): void {
    const sizeBar = document.getElementById('tacSizeBar');
    if (sizeBar) {
      sizeBar.innerHTML = (['6v6', '5v5', '7v7', '11v11'] as PitchSizeId[])
        .map((sz) => {
          const active = sz === this.prefs.size;
          return `<button type="button" data-tac-size="${sz}" class="tac-pill ${active ? 'active' : ''}">${formatFormationHtml(PITCH_SIZE_META[sz].label)}</button>`;
        })
        .join('');
    }

    const metaBadge = document.getElementById('tacSizeBadge');
    if (metaBadge) {
      metaBadge.innerHTML = formatFormationHtml(PITCH_SIZE_META[this.prefs.size].badge);
    }

    const selectEl = document.getElementById('tacFormation') as HTMLSelectElement | null;
    if (selectEl) {
      const list = FORMATIONS_CATALOG[this.prefs.size];
      const current = this.getCurrentFormationId();
      selectEl.innerHTML = list
        .map(
          (f) =>
            `<option value="${escapeHtml(f.id)}" ${f.id === current ? 'selected' : ''}>${escapeHtml(isolateLtrTokens(f.name))}</option>`
        )
        .join('');
      selectEl.value = current;
    }

    const taglineEl = document.getElementById('tacFormTagline');
    if (taglineEl) {
      taglineEl.innerHTML = formatFormationHtml(this.getCurrentFormation().tagline);
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
    const optBtn = document.getElementById('btnTacOptionsDrawer');
    const optDrawer = document.getElementById('tacOptionsDrawer');
    if (optBtn) {
      optBtn.classList.toggle('active', this.optionsDrawerOpen);
      optBtn.setAttribute('aria-expanded', String(this.optionsDrawerOpen));
    }
    if (optDrawer) {
      optDrawer.classList.toggle('hidden', !this.optionsDrawerOpen);
    }

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
    stage.classList.toggle('pitch-drag-flat', this.dragFlattened);
    stage.classList.toggle('pitch-dragging', this.dragFlattened);
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

  private getFocusedUserSlotIdx(): number {
    const form = this.getCurrentFormation();
    const assigned = this.getAssignedPlayersForCurrentFormation();
    const frame = this.sequence.frames[this.frameIdx] || this.sequence.frames[0];
    const currentUser = this.ctx?.getCurrentUser ? this.ctx.getCurrentUser() : null;
    const model = resolveYourRoleCard({
      form,
      assigned,
      currentUser,
      frame,
      spotlightSlotIdx: this.spotlightSlotIdx,
      getRoleInfo: (idx) => getRoleSpotlightSequence(this.prefs.size, form.id, idx),
      getPlayerOvr: this.ctx?.getPlayerOvr,
    });
    return model.slotIdx;
  }

  private renderSvgPitch(): void {
    const svg = document.getElementById('tacPitchSvg') as unknown as SVGSVGElement | null;
    if (!svg) return;

    const form = this.getCurrentFormation();
    const assigned = this.getAssignedPlayersForCurrentFormation();
    const frame = this.sequence.frames[this.frameIdx] || this.sequence.frames[0];
    const activeSet = new Set(frame?.activeIndices || []);
    const saver = document.body.classList.contains('data-saver');
    const focusedUserIdx = this.focusMineOnly ? this.getFocusedUserSlotIdx() : null;

    // De-overlap opponents cleanly from our discs (preserve exact position of any opponent currently being dragged)
    const minSepPct = this.prefs.size === '11v11' ? 7.6 : 9.4;
    const displayOpp =
      this.dragTarget?.kind === 'opp'
        ? this.currentOpp.map((p) => ({ ...p }))
        : deOverlapPositions(this.currentOur, this.currentOpp, minSepPct);

    const oppAlerts = computeOpponentAlertSet(displayOpp, this.currentBall, this.currentOur, frame?.zones);

    // Compute dynamic offside line ONLY when 11v11 is active
    let offsideY: number | null = null;
    if (this.sequence.offsideEnabled && displayOpp.length >= 3) {
      const sortedY = displayOpp.map((o) => o.y).sort((a, b) => a - b);
      offsideY = toSvgY(sortedY[1]);
    }

    const discR = this.prefs.size === '11v11' ? 12.2 : 16;
    const ourSvgPts = this.currentOur.map((p) => ({ x: toSvgX(p.x), y: toSvgY(p.y) }));
    const oppSvgPts = displayOpp.map((p) => ({ x: toSvgX(p.x), y: toSvgY(p.y) }));
    const ballSvg = { x: toSvgX(this.currentBall.x), y: toSvgY(this.currentBall.y) };

    const parts: string[] = [];

    // Defs (royal emerald turf, luminous gold halo, net pattern, arrowheads)
    parts.push(`<defs>
      <linearGradient id="turfGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#062013"/>
        <stop offset="50%" stop-color="#0b331e"/>
        <stop offset="100%" stop-color="#04150c"/>
      </linearGradient>
      <radialGradient id="turfVignette" cx="50%" cy="48%" r="65%">
        <stop offset="0%" stop-color="#165a35" stop-opacity="0.24"/>
        <stop offset="100%" stop-color="#020905" stop-opacity="0.45"/>
      </radialGradient>
      <radialGradient id="goldHalo" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="#FACC15" stop-opacity="0.72"/>
        <stop offset="60%" stop-color="#FACC15" stop-opacity="0.22"/>
        <stop offset="100%" stop-color="#FACC15" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="oppAlertHalo" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="#fb923c" stop-opacity="0.62"/>
        <stop offset="100%" stop-color="#f97316" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="heatZoneGrad" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="#FACC15" stop-opacity="0.34"/>
        <stop offset="65%" stop-color="#EAB308" stop-opacity="0.14"/>
        <stop offset="100%" stop-color="#FACC15" stop-opacity="0"/>
      </radialGradient>
      <pattern id="goalNetPat" width="5" height="5" patternUnits="userSpaceOnUse">
        <path d="M 5 0 L 0 0 0 5" fill="none" stroke="rgba(254,240,138,0.34)" stroke-width="0.6"/>
      </pattern>
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

    // Royal Emerald Turf & subtle mowed grass bands
    parts.push(`<rect x="0" y="0" width="${SVG_W}" height="${SVG_H}" rx="16" fill="url(#turfGrad)"/>`);
    for (let i = 0; i < 10; i++) {
      if (i % 2 === 0) {
        parts.push(`<rect x="14" y="${16 + i * 48.8}" width="${SVG_W - 28}" height="48.8" fill="rgba(255,255,255,0.032)"/>`);
      }
    }
    parts.push(`<rect x="0" y="0" width="${SVG_W}" height="${SVG_H}" rx="16" fill="url(#turfVignette)"/>`);

    // Crisp Golden Pitch Chalk Lines + Penalty Arcs + Corner Arcs + Goal Nets
    parts.push(`<g stroke="rgba(250,204,21,0.42)" stroke-width="1.45" fill="none">
      <rect x="16" y="18" width="${SVG_W - 32}" height="${SVG_H - 36}" rx="4"/>
      <line x1="16" y1="${SVG_H / 2}" x2="${SVG_W - 16}" y2="${SVG_H / 2}"/>
      <circle cx="${SVG_W / 2}" cy="${SVG_H / 2}" r="42"/>
      <circle cx="${SVG_W / 2}" cy="${SVG_H / 2}" r="2.6" fill="#FACC15" stroke="none"/>
      <rect x="86" y="18" width="${SVG_W - 172}" height="64"/>
      <rect x="130" y="18" width="${SVG_W - 260}" height="24"/>
      <path d="M 142 82 A 42 42 0 0 0 218 82"/>
      <circle cx="${SVG_W / 2}" cy="60" r="2.1" fill="rgba(250,204,21,0.65)" stroke="none"/>
      <rect x="86" y="${SVG_H - 82}" width="${SVG_W - 172}" height="64"/>
      <rect x="130" y="${SVG_H - 42}" width="${SVG_W - 260}" height="24"/>
      <path d="M 142 ${SVG_H - 82} A 42 42 0 0 1 218 ${SVG_H - 82}"/>
      <circle cx="${SVG_W / 2}" cy="${SVG_H - 60}" r="2.1" fill="rgba(250,204,21,0.65)" stroke="none"/>
      <path d="M 16 27 A 9 9 0 0 0 25 18"/>
      <path d="M ${SVG_W - 25} 18 A 9 9 0 0 0 ${SVG_W - 16} 27"/>
      <path d="M 16 ${SVG_H - 27} A 9 9 0 0 1 25 ${SVG_H - 18}"/>
      <path d="M ${SVG_W - 25} ${SVG_H - 18} A 9 9 0 0 1 ${SVG_W - 16} ${SVG_H - 27}"/>
      <rect x="144" y="8" width="72" height="10" rx="2" fill="url(#goalNetPat)" stroke="#FACC15" stroke-width="1.8"/>
      <rect x="144" y="${SVG_H - 18}" width="72" height="10" rx="2" fill="url(#goalNetPat)" stroke="#FACC15" stroke-width="1.8"/>
    </g>`);

    // Offside line ONLY for 11v11 — smart non-overlapping dark-rose badge (no blank white box!)
    if (offsideY !== null) {
      const badge = placeOffsideBadge(offsideY, oppSvgPts, SVG_W);
      parts.push(`<g class="tac-offside-line">
        <line x1="16" y1="${offsideY.toFixed(1)}" x2="${SVG_W - 16}" y2="${offsideY.toFixed(1)}" stroke="#fb7185" stroke-width="1.8" stroke-dasharray="6 4"/>
        <rect x="${badge.x.toFixed(1)}" y="${badge.y.toFixed(1)}" width="${badge.w}" height="${badge.h}" rx="5" fill="rgba(136,19,55,0.92)" stroke="rgba(251,113,133,0.75)" stroke-width="1"/>
        <text x="${badge.textX.toFixed(1)}" y="${badge.textY.toFixed(1)}" text-anchor="middle" fill="#fff1f2" font-size="8.8" font-weight="800">${escapeHtml(isolateLtrTokens('خط التسلل (11v11)'))}</text>
      </g>`);
    }

    // Role Spotlight / Focus Heat Zone
    const heatZone =
      this.spotlightInfo?.zone ||
      (focusedUserIdx !== null ? getRoleSpotlightSequence(this.prefs.size, form.id, focusedUserIdx).zone : null);
    if (heatZone) {
      parts.push(`<ellipse cx="${toSvgX(heatZone.x).toFixed(1)}" cy="${toSvgY(heatZone.y).toFixed(1)}" rx="${(heatZone.rx * 3.1).toFixed(1)}" ry="${(heatZone.ry * 4.2).toFixed(1)}" fill="url(#heatZoneGrad)" stroke="rgba(250,204,21,0.48)" stroke-dasharray="5 4" stroke-width="1.4"/>`);
    }

    // Open space / tactical zones from keyframe
    if (frame?.zones?.length) {
      const zoneColors: Record<string, { fill: string; stroke: string; txt: string }> = {
        gold: { fill: 'rgba(250,204,21,0.14)', stroke: 'rgba(250,204,21,0.58)', txt: '#fef08a' },
        cyan: { fill: 'rgba(56,189,248,0.14)', stroke: 'rgba(56,189,248,0.58)', txt: '#bae6fd' },
        rose: { fill: 'rgba(249,115,22,0.16)', stroke: 'rgba(251,146,60,0.68)', txt: '#ffedd5' },
        emerald: { fill: 'rgba(34,197,94,0.16)', stroke: 'rgba(34,197,94,0.62)', txt: '#bbf7d0' },
      };
      frame.zones.forEach((z) => {
        const col = zoneColors[z.color || 'gold'] || zoneColors.gold;
        const cx = toSvgX(z.x);
        const cy = toSvgY(z.y);
        const r = z.r * 3.0;
        parts.push(`<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" fill="${col.fill}" stroke="${col.stroke}" stroke-width="1.3" stroke-dasharray="4 3"/>`);
        if (z.label) {
          const ly = cy + r + 10 < SVG_H - 22 ? cy + r + 10 : cy - r - 5;
          parts.push(`<text x="${cx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle" fill="${col.txt}" font-size="8.6" font-weight="800">${escapeHtml(z.label)}</text>`);
        }
      });
    }

    // Passing triangles
    if (this.showTriangles) {
      const tris = frame?.triangles || (form.slots.length >= 5 ? [[1, 2, 3]] : []);
      tris.forEach(([a, b, c]) => {
        const pA = ourSvgPts[a];
        const pB = ourSvgPts[b];
        const pC = ourSvgPts[c];
        if (!pA || !pB || !pC) return;
        const pts = `${pA.x.toFixed(1)},${pA.y.toFixed(1)} ${pB.x.toFixed(1)},${pB.y.toFixed(1)} ${pC.x.toFixed(1)},${pC.y.toFixed(1)}`;
        parts.push(`<polygon points="${pts}" fill="rgba(250,204,21,0.09)" stroke="rgba(250,204,21,0.34)" stroke-width="1.2" stroke-dasharray="4 3"/>`);
      });
    }

    const reduced = this.isMotionReduced();

    // Animated Curved Tactical Arrows (quadratic Bezier + progressive stroke-dashoffset draw-in)
    if (frame?.arrows?.length) {
      const reveal = reduced ? 1 : this.arrowRevealT;
      frame.arrows.forEach((arr) => {
        const x1 = toSvgX(arr.from[0]);
        const y1 = toSvgY(arr.from[1]);
        const x2 = toSvgX(arr.to[0]);
        const y2 = toSvgY(arr.to[1]);
        if (Math.hypot(x2 - x1, y2 - y1) < 8) return;

        const geom = buildCurvedArrowGeometry(x1, y1, x2, y2, arr.kind, reveal, SVG_W / 2, SVG_H / 2);
        const stroke = arr.kind === 'ball' ? '#FACC15' : arr.kind === 'run' ? '#38bdf8' : '#22c55e';
        const marker = arr.kind === 'ball' ? 'url(#arrBall)' : arr.kind === 'run' ? 'url(#arrRun)' : 'url(#arrCover)';
        const width = arr.kind === 'ball' ? 2.8 : arr.kind === 'run' ? 2.2 : 2.1;

        if (!reduced && reveal < 0.985) {
          const dashLen = geom.approxLength.toFixed(1);
          const dashOff = geom.dashOffset.toFixed(1);
          if (arr.kind === 'ball' && !saver) {
            parts.push(`<path d="${geom.pathD}" fill="none" stroke="rgba(250,204,21,0.26)" stroke-width="6.5" stroke-linecap="round" stroke-dasharray="${dashLen}" stroke-dashoffset="${dashOff}" pointer-events="none"/>`);
          }
          parts.push(`<path class="tac-arrow-path" d="${geom.pathD}" fill="none" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" stroke-dasharray="${dashLen}" stroke-dashoffset="${dashOff}" ${reveal > 0.24 ? `marker-end="${marker}"` : ''} opacity="0.95"/>`);
        } else {
          const settledDash = arr.kind === 'ball' ? '' : arr.kind === 'run' ? 'stroke-dasharray="7 4.5"' : 'stroke-dasharray="3 3.5"';
          if (arr.kind === 'ball' && !saver) {
            parts.push(`<path d="${geom.pathD}" fill="none" stroke="rgba(250,204,21,0.22)" stroke-width="6" stroke-linecap="round" pointer-events="none"/>`);
          }
          parts.push(`<path class="tac-arrow-path" d="${geom.pathD}" fill="none" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" ${settledDash} marker-end="${marker}" opacity="0.93"/>`);
        }
      });
    }

    // Opponent tokens: DISTINCT non-circular chamfered diamond/shield (never circles!)
    // Calm steel-slate by default; orange accent ONLY when carrying ball or exploiting a gap
    if (this.showOpponents) {
      const oppR = discR - 1.2;
      oppSvgPts.forEach((op, i) => {
        const isAlert = oppAlerts.has(i);
        const isGrabbed = this.dragTarget?.kind === 'opp' && this.dragTarget.idx === i;
        const dimmed = this.spotlightSlotIdx !== null || focusedUserIdx !== null ? 'opacity="0.42"' : 'opacity="0.94"';
        const fill = isAlert ? '#431407' : '#1e293b';
        const stroke = isGrabbed ? '#FEF08A' : isAlert ? '#fb923c' : '#64748b';
        const txtCol = isAlert ? '#ffedd5' : '#cbd5e1';
        // Chamfered tactical octagon-diamond shape (distinct from circular teammates)
        const c1 = oppR * 0.48;
        const c2 = oppR * 1.04;
        const polyPts = [
          `${(op.x - c1).toFixed(1)},${(op.y - c2).toFixed(1)}`,
          `${(op.x + c1).toFixed(1)},${(op.y - c2).toFixed(1)}`,
          `${(op.x + c2).toFixed(1)},${(op.y - c1).toFixed(1)}`,
          `${(op.x + c2).toFixed(1)},${(op.y + c1).toFixed(1)}`,
          `${(op.x + c1).toFixed(1)},${(op.y + c2).toFixed(1)}`,
          `${(op.x - c1).toFixed(1)},${(op.y + c2).toFixed(1)}`,
          `${(op.x - c2).toFixed(1)},${(op.y + c1).toFixed(1)}`,
          `${(op.x - c2).toFixed(1)},${(op.y - c1).toFixed(1)}`,
        ].join(' ');
        parts.push(`<g data-drag-kind="opp" data-drag-idx="${i}" class="tac-disc tac-disc-opp" ${dimmed}>`);
        if (isGrabbed) {
          parts.push(`<circle cx="${op.x.toFixed(1)}" cy="${op.y.toFixed(1)}" r="${(oppR + 6.5).toFixed(1)}" fill="none" stroke="#FEF08A" stroke-width="2" stroke-dasharray="4 3"/>`);
        } else if (isAlert && !saver) {
          parts.push(`<circle cx="${op.x.toFixed(1)}" cy="${op.y.toFixed(1)}" r="${(oppR + 8).toFixed(1)}" fill="url(#oppAlertHalo)"/>`);
        }
        parts.push(`<polygon points="${polyPts}" fill="${fill}" stroke="${stroke}" stroke-width="${isGrabbed ? 2.4 : isAlert ? 2.1 : 1.5}"/>`);
        parts.push(`<text x="${op.x.toFixed(1)}" y="${(op.y + 3.4).toFixed(1)}" text-anchor="middle" fill="${txtCol}" font-size="${this.prefs.size === '11v11' ? '8.4' : '9.4'}" font-weight="800">${i === 0 ? 'GK' : i + 1}</text>`);
        parts.push(`</g>`);
      });
    }

    // Prepare non-overlapping name labels ONLY for slots with a real assigned player (fixes duplicate ST/ST!)
    const allTokenObstacles = [...ourSvgPts, ...oppSvgPts, ballSvg];
    const placedLabels = placePlayerLabels(
      ourSvgPts.map((pt, i) => ({
        idx: i,
        cx: pt.x,
        cy: pt.y,
        label: assigned[i] ? firstWord(assigned[i]?.name) : '',
      })),
      allTokenObstacles,
      discR,
      SVG_W,
      SVG_H
    );
    const labelByIdx = new Map(placedLabels.map((l) => [l.idx, l]));

    // Our Golden Team circular discs
    ourSvgPts.forEach((pt, i) => {
      const slot = form.slots[i];
      const pl = assigned[i];
      const isSpotlighted = this.spotlightSlotIdx === i;
      const isFocusedMine = focusedUserIdx !== null && focusedUserIdx === i;
      const isGrabbed = this.dragTarget?.kind === 'our' && this.dragTarget.idx === i;
      const isDimmed =
        focusedUserIdx !== null
          ? !isFocusedMine
          : this.spotlightSlotIdx !== null && !isSpotlighted && !activeSet.has(i);
      const isActive = isGrabbed || isFocusedMine || isSpotlighted || (focusedUserIdx === null && activeSet.has(i));
      // Inside disc: jersey number if assigned, otherwise position short code ONCE
      const numText = pl ? String(pl.jersey || slot?.short || '★') : slot ? slot.short : String(i + 1);
      const lbl = labelByIdx.get(i);

      parts.push(`<g data-drag-kind="our" data-drag-idx="${i}" class="tac-disc tac-disc-our" opacity="${isDimmed ? '0.28' : '1'}">`);
      if (isGrabbed) {
        parts.push(`<circle cx="${pt.x.toFixed(1)}" cy="${pt.y.toFixed(1)}" r="${(discR + 8).toFixed(1)}" fill="none" stroke="#FEF08A" stroke-width="2.2" stroke-dasharray="4 3"/>`);
      } else if (isActive && !saver) {
        parts.push(`<circle cx="${pt.x.toFixed(1)}" cy="${pt.y.toFixed(1)}" r="${(discR + 12).toFixed(1)}" fill="url(#goldHalo)"/>`);
        parts.push(`<circle class="${reduced ? '' : 'tac-active-pulse'}" cx="${pt.x.toFixed(1)}" cy="${pt.y.toFixed(1)}" r="${(discR + 4.5).toFixed(1)}" fill="none" stroke="#FACC15" stroke-width="1.8"/>`);
      }
      parts.push(`<circle cx="${pt.x.toFixed(1)}" cy="${pt.y.toFixed(1)}" r="${discR.toFixed(1)}" fill="${isActive ? '#3a2b07' : '#0b1220'}" stroke="${isActive ? '#FEF08A' : '#FACC15'}" stroke-width="${isActive ? 2.6 : 1.9}"/>`);
      parts.push(`<text x="${pt.x.toFixed(1)}" y="${(pt.y + 3.6).toFixed(1)}" text-anchor="middle" fill="${isActive ? '#FEF08A' : '#f8fafc'}" font-size="${this.prefs.size === '11v11' ? '8.5' : '10.2'}" font-weight="900">${escapeHtml(numText)}</text>`);
      if (lbl) {
        parts.push(`<rect x="${lbl.x.toFixed(1)}" y="${lbl.y.toFixed(1)}" width="${lbl.w.toFixed(1)}" height="${lbl.h}" rx="5" fill="rgba(7,9,14,0.88)" stroke="rgba(250,204,21,0.38)" stroke-width="0.8"/>`);
        parts.push(`<text x="${lbl.textX.toFixed(1)}" y="${lbl.textY.toFixed(1)}" text-anchor="middle" fill="#f8fafc" font-size="8.4" font-weight="800">${escapeHtml(lbl.label)}</text>`);
      }
      parts.push(`</g>`);
    });

    // Fading golden comet trail behind mid-flight ball
    if (this.ballTrailPath && !reduced) {
      parts.push(`<g class="tac-ball-trail" pointer-events="none">
        <path d="${this.ballTrailPath}" fill="none" stroke="rgba(250,204,21,0.22)" stroke-width="8" stroke-linecap="round"/>
        <path d="${this.ballTrailPath}" fill="none" stroke="rgba(254,240,138,0.72)" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="10 4"/>
      </g>`);
    }

    // Football (draggable) with quadratic Bezier loft, shadow separation, and scale
    const ballGrabbed = this.dragTarget?.kind === 'ball';
    const shadowRx = Math.max(5.5, 9.2 - this.ballLift * 2.4);
    const shadowRy = Math.max(3.2, 6.2 - this.ballLift * 1.9);
    const shadowOpacity = Math.max(0.22, 0.48 - this.ballLift * 0.22);
    const ballDrawY = ballSvg.y - this.ballLift * 6.5;
    const ballR = 8.2 * this.ballScale;
    const pScale = this.ballScale;
    parts.push(`<g data-drag-kind="ball" data-drag-idx="0" class="tac-disc tac-ball">
      <ellipse cx="${ballSvg.x.toFixed(1)}" cy="${(ballSvg.y + this.ballShadowDy).toFixed(1)}" rx="${shadowRx.toFixed(1)}" ry="${shadowRy.toFixed(1)}" fill="rgba(0,0,0,${shadowOpacity.toFixed(2)})"/>
      ${ballGrabbed ? `<circle cx="${ballSvg.x.toFixed(1)}" cy="${ballDrawY.toFixed(1)}" r="${(ballR + 5.5).toFixed(1)}" fill="none" stroke="#FEF08A" stroke-width="2" stroke-dasharray="4 3"/>` : ''}
      <circle cx="${ballSvg.x.toFixed(1)}" cy="${ballDrawY.toFixed(1)}" r="${ballR.toFixed(1)}" fill="#ffffff" stroke="#070709" stroke-width="1.5"/>
      <polygon points="${ballSvg.x.toFixed(1)},${(ballDrawY - 3.5 * pScale).toFixed(1)} ${(ballSvg.x + 3.3 * pScale).toFixed(1)},${(ballDrawY - 1 * pScale).toFixed(1)} ${(ballSvg.x + 2.0 * pScale).toFixed(1)},${(ballDrawY + 3.0 * pScale).toFixed(1)} ${(ballSvg.x - 2.0 * pScale).toFixed(1)},${(ballDrawY + 3.0 * pScale).toFixed(1)} ${(ballSvg.x - 3.3 * pScale).toFixed(1)},${(ballDrawY - 1 * pScale).toFixed(1)}" fill="#070709"/>
    </g>`);

    // In-Pitch Glass Callout Box positioning + thin golden pointer line in SVG
    const anchorIdx =
      focusedUserIdx !== null
        ? focusedUserIdx
        : this.spotlightSlotIdx !== null
        ? this.spotlightSlotIdx
        : frame?.activeIndices?.length
        ? frame.activeIndices[0]
        : -1;
    const anchorSvg = anchorIdx >= 0 && ourSvgPts[anchorIdx] ? ourSvgPts[anchorIdx] : ballSvg;
    const calloutBox = placeCalloutBox(anchorSvg, allTokenObstacles, SVG_W, SVG_H, 138, 76);

    if (frame?.narration && !this.calloutCollapsed) {
      const pdx = anchorSvg.x - calloutBox.edgeX;
      const pdy = anchorSvg.y - calloutBox.edgeY;
      const plen = Math.hypot(pdx, pdy);
      const stopBack = anchorIdx >= 0 ? discR + 5.5 : 11;
      const tipX = plen > stopBack + 4 ? anchorSvg.x - (pdx / plen) * stopBack : anchorSvg.x;
      const tipY = plen > stopBack + 4 ? anchorSvg.y - (pdy / plen) * stopBack : anchorSvg.y;
      parts.push(`<g class="tac-callout-pointer" pointer-events="none">
        <line x1="${calloutBox.edgeX.toFixed(1)}" y1="${calloutBox.edgeY.toFixed(1)}" x2="${tipX.toFixed(1)}" y2="${tipY.toFixed(1)}" stroke="#FACC15" stroke-width="1.4" stroke-opacity="0.86"/>
        <circle cx="${tipX.toFixed(1)}" cy="${tipY.toFixed(1)}" r="3.2" fill="#FACC15"/>
      </g>`);
    }

    svg.innerHTML = parts.join('');
    this.renderInPitchCallout(frame, anchorIdx >= 0 ? form.slots[anchorIdx]?.label : undefined, calloutBox);
  }

  private renderInPitchCallout(
    frame: TacticalKeyframe | undefined,
    activeSlotLabel: string | undefined,
    box: { x: number; y: number; w: number; h: number }
  ): void {
    const el = document.getElementById('tacPitchCallout');
    if (!el) return;
    if (!frame || !frame.narration || this.viewMode !== 'studio') {
      el.classList.add('hidden');
      return;
    }
    el.classList.remove('hidden');
    el.classList.toggle('collapsed', this.calloutCollapsed);

    const leftPct = (box.x / SVG_W) * 100;
    const topPct = (box.y / SVG_H) * 100;
    const widthPct = (box.w / SVG_W) * 100;
    el.style.left = `${leftPct.toFixed(1)}%`;
    el.style.top = `${topPct.toFixed(1)}%`;
    el.style.width = this.calloutCollapsed ? 'auto' : `${widthPct.toFixed(1)}%`;

    const titleEl = document.getElementById('tacCalloutTitle');
    const bodyEl = document.getElementById('tacCalloutBody');
    const toggleBtn = document.getElementById('btnTacCalloutToggle');
    if (titleEl) {
      const heading = activeSlotLabel || frame.title || 'توجيه تكتيكي';
      titleEl.innerHTML = formatFormationHtml(heading);
    }
    if (bodyEl) {
      bodyEl.innerHTML = formatFormationHtml(frame.narration);
    }
    if (toggleBtn) {
      toggleBtn.textContent = this.calloutCollapsed ? '+' : '−';
    }
  }

  private renderYourRoleCard(): void {
    const card = document.getElementById('tacYourRoleCard');
    if (!card) return;
    if (this.viewMode !== 'studio') {
      card.classList.add('hidden');
      return;
    }
    card.classList.remove('hidden');

    const form = this.getCurrentFormation();
    const assigned = this.getAssignedPlayersForCurrentFormation();
    const frame = this.sequence.frames[this.frameIdx] || this.sequence.frames[0];
    const currentUser = this.ctx?.getCurrentUser ? this.ctx.getCurrentUser() : null;

    const model = resolveYourRoleCard({
      form,
      assigned,
      currentUser,
      frame,
      spotlightSlotIdx: this.spotlightSlotIdx,
      getRoleInfo: (idx) => getRoleSpotlightSequence(this.prefs.size, form.id, idx),
      getPlayerOvr: this.ctx?.getPlayerOvr,
    });

    const shieldTop = `
      <div class="tac-mini-shield-top">
        ${model.ovr !== null ? `<span class="tac-mini-shield-ovr">${model.ovr}</span>` : `<span class="tac-mini-shield-ovr" style="opacity:0.55;">★</span>`}
        <span class="tac-mini-shield-pos" dir="ltr">${escapeHtml(model.positionCode)}</span>
      </div>`;

    const shieldAvatar = model.photoUrl
      ? `<img src="${model.photoUrl}" alt="${escapeHtml(model.playerName || model.slotLabel)}" />`
      : `<span>${model.jersey ? '#' + escapeHtml(model.jersey) : escapeHtml(model.slotShort)}</span>`;

    card.innerHTML = `
      <div class="tac-role-top">
        <strong style="font-size:0.82rem;color:#FACC15;">💡 دورك في الخطة: ${escapeHtml(model.slotLabel)}</strong>
        <div class="tac-focus-seg" role="group" aria-label="نطاق التركيز">
          <button type="button" data-tac-focus="mine" class="tac-focus-btn ${this.focusMineOnly ? 'active' : ''}">👤 حركتي فقط</button>
          <button type="button" data-tac-focus="team" class="tac-focus-btn ${!this.focusMineOnly ? 'active' : ''}">👥 مع الفريق</button>
        </div>
      </div>
      <div class="tac-role-grid">
        <div class="tac-mini-shield" aria-label="بطاقة دورك الحالية">
          ${shieldTop}
          <div class="tac-mini-shield-pic">${shieldAvatar}</div>
          <div class="tac-mini-shield-name">${escapeHtml(firstWord(model.playerName || model.slotLabel))}</div>
        </div>
        <div style="min-width:0;">
          <div style="font-size:0.74rem;color:#d4d4d8;line-height:1.45;margin-bottom:5px;">${formatFormationHtml(model.momentSummary)}</div>
          <div class="tac-role-duties">
            ${model.duties
              .map(
                (d) => `<div class="tac-role-duty-item"><span class="tac-duty-check" aria-hidden="true">✓</span><span>${escapeHtml(d)}</span></div>`
              )
              .join('')}
          </div>
        </div>
      </div>
    `;
  }

  private renderNarrationAndTimeline(): void {
    const frame = this.sequence.frames[this.frameIdx] || this.sequence.frames[0];
    const total = this.sequence.frames.length;

    const titleEl = document.getElementById('tacSeqTitle');
    if (titleEl) titleEl.innerHTML = formatFormationHtml(this.sequence.title);
    const subEl = document.getElementById('tacSeqSubtitle');
    if (subEl) subEl.innerHTML = formatFormationHtml(this.sequence.subtitle);

    const stepBadge = document.getElementById('tacStepCounter');
    if (stepBadge) stepBadge.textContent = `المرحلة ${this.frameIdx + 1} / ${total}`;

    const frameTitle = document.getElementById('tacFrameTitle');
    if (frameTitle) frameTitle.innerHTML = formatFormationHtml(frame?.title || '');

    const narrEl = document.getElementById('tacNarrationText');
    if (narrEl) narrEl.innerHTML = formatFormationHtml(frame?.narration || '');

    // Update continuous interactive progress scrubber & elapsed/total clock
    const totalSec = Math.max(1, Math.round(this.timelineMetrics.totalMs / 1000));
    const globalProgress = this.timelineMetrics.totalMs > 0 ? this.timelineElapsedMs / this.timelineMetrics.totalMs : 0;
    this.updateScrubberOnly(globalProgress, this.timelineElapsedMs);
    const totalEl = document.getElementById('tacTimeTotal');
    if (totalEl) totalEl.textContent = this.formatClock(totalSec);

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
    const playIco = document.getElementById('tacPlayIco');
    const playLbl = document.getElementById('tacPlayLbl');
    if (playBtn) {
      playBtn.classList.toggle('is-playing', this.isPlaying);
      if (playIco && playLbl) {
        playIco.textContent = this.isPlaying ? '⏸' : '▶';
        playLbl.textContent = this.isPlaying ? 'إيقاف' : 'تشغيل';
      } else {
        playBtn.textContent = this.isPlaying ? '⏸ إيقاف' : '▶ تشغيل';
      }
    }

    const speedBadge = document.getElementById('tacSpeedBadge');
    if (speedBadge) speedBadge.textContent = `${this.speed}x`;
    const speedBtn = document.getElementById('btnTacSpeedCycle');
    if (speedBtn) speedBtn.setAttribute('aria-expanded', String(this.speedDrawerOpen));
    const speedDrawer = document.getElementById('tacSpeedDrawer');
    if (speedDrawer) speedDrawer.classList.toggle('hidden', !this.speedDrawerOpen);

    const voiceBtn = document.getElementById('btnTacVoice');
    if (voiceBtn) {
      const supported = this.isSpeechSupported();
      voiceBtn.textContent = !supported ? '🔇' : this.voiceEnabled ? '🔊' : '🔇';
      voiceBtn.title = !supported ? 'التعليق الصوتي غير مدعوم' : this.voiceEnabled ? 'إيقاف التعليق الصوتي' : 'تفعيل التعليق الصوتي';
      voiceBtn.setAttribute('aria-label', voiceBtn.title);
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
      headerEl.innerHTML = formatFormationHtml(
        `${settings.teamName || 'فريق السداسي'} • ${form.name} (${this.prefs.size}) • تقييم ${chem.avgOvr || '--'}`
      );
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

    // Render Mini Maydan Cards positioned on pitch (using real card OVR when available)
    const realOvrs: number[] = [];
    board.innerHTML = form.slots
      .map((s, idx) => {
        const pl = assigned[idx];
        const realOvr = pl && this.ctx?.getPlayerOvr ? this.ctx.getPlayerOvr(pl) : null;
        const ovr = typeof realOvr === 'number' && Number.isFinite(realOvr) ? Math.round(realOvr) : pl ? computePlayerOvr(pl) : 0;
        if (pl && ovr > 0) realOvrs.push(ovr);
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

    if (kpiOvr && realOvrs.length) {
      kpiOvr.textContent = String(Math.round(realOvrs.reduce((a, b) => a + b, 0) / realOvrs.length));
    }
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
    const readinessLogs = this.ctx.getReadiness ? this.ctx.getReadiness() : [];
    const form = this.getCurrentFormation();
    const teamName = this.ctx.getTeamSettings().teamName || 'فريق السداسي';
    const isAdmin = this.ctx.isAdmin();

    if (this.captainTab === 'smart') {
      const availCount = players.filter((p) => p.availableStatus !== 'unavailable').length;
      const unavail = players.filter((p) => p.availableStatus === 'unavailable');
      const preview = suggestSmartLineup(players, form, readinessLogs);
      body.innerHTML = `
        <div class="item-box">
          <div style="font-weight:800;color:var(--primary);margin-bottom:4px;">🧠 مقترح التشكيلة الذكي (${formatFormationHtml(form.name)})</div>
          <p class="muted" style="margin-bottom:8px;">يختار تلقائياً أنسب اللاعبين المتاحين لكل مركز حسب مركزهم الأساسي والثانوي وتقييمهم وجاهزيتهم البدنية، ويستبعد غير المتاحين تلقائياً.</p>
          <div class="row between" style="margin-bottom:8px;flex-wrap:wrap;gap:6px;">
            <span class="badge">✅ متاحون: ${availCount}</span>
            <span class="badge" style="color:${unavail.length ? '#f43f5e' : '#22c55e'};">${unavail.length ? `⛔ مستبعدون: ${unavail.length}` : '✨ لا غيابات'}</span>
            ${preview.fatiguedNames.length ? `<span class="badge" style="color:#fbbf24;">⚠️ إجهاد مسجّل: ${preview.fatiguedNames.length}</span>` : ''}
          </div>
          ${preview.fatiguedNames.length ? `<p class="muted" style="font-size:0.74rem;color:#fde68a;margin-bottom:8px;">⚠️ لاعبون بإجهاد مرتفع (يفضّل إراحتهم أو تقليص دقائقهم): ${preview.fatiguedNames.map((n) => escapeHtml(n)).join('، ')}</p>` : ''}
          <button type="button" id="btnApplySmartLineup" class="btn-primary" style="width:100%;" ${!isAdmin ? 'disabled' : ''}>${isAdmin ? '⚡ تطبيق الاقتراح على الملعب (قابل للتعديل)' : '🔒 تطبيق التشكيلة الرسمية متاح للكابتن فقط'}</button>
          <p class="muted" style="margin-top:6px;font-size:0.71rem;">ℹ️ أداة مساعدة فقط — القرار النهائي بيد الكابتن ويمكن تعديل أي مركز يدوياً.</p>
        </div>
      `;
      document.getElementById('btnApplySmartLineup')?.addEventListener('click', () => {
        if (!this.ctx || !this.ctx.isAdmin()) return;
        this.ctx.takeSnapshot();
        const res = suggestSmartLineup(players, form, readinessLogs);
        Object.entries(res.slots).forEach(([key, pid]) => {
          const idx = Number(key.split('_').pop() || '0');
          this.setSlotPlayerId(form.id, idx, pid);
        });
        this.renderAll();
        this.ctx.toast(
          `تم تطبيق الاقتراح على ${res.assignedCount} مراكز ✓${res.excludedCount ? ` (استُبعد ${res.excludedCount} غير متاح)` : ''}`,
          false,
          true
        );
      });
      return;
    }

    if (this.captainTab === 'split') {
      const split = splitFairTeams(players, teamName, readinessLogs);
      body.innerHTML = `
        <div class="row between" style="margin-bottom:8px;">
          <span class="badge">📊 فارق القوة: ${split.diff} نقطة فقط</span>
          <button type="button" id="btnCopySplitWa" class="btn-emerald" style="min-height:36px;padding:6px 12px;font-size:0.78rem;">📋 نسخ لواتساب</button>
        </div>
        <div class="grid-2" style="gap:8px;">
          <div class="item-box" style="margin:0;border-color:rgba(250,204,21,0.5);">
            <div style="font-weight:900;color:var(--primary);margin-bottom:6px;">🟡 الفريق الذهبي (${split.goldAvg})</div>
            ${split.gold.map((p) => `<div style="font-size:0.78rem;padding:3px 0;border-bottom:1px solid rgba(255,255,255,0.05);display:flex;justify-content:space-between;"><span>${escapeHtml(p.name)}${p.fatigued ? ' ⚠️' : ''}</span><strong style="color:var(--primary);">${p.ovr}</strong></div>`).join('') || '<span class="muted">—</span>'}
          </div>
          <div class="item-box" style="margin:0;border-color:rgba(226,232,240,0.35);">
            <div style="font-weight:900;color:#e2e8f0;margin-bottom:6px;">⚪ الفريق الفضي (${split.silverAvg})</div>
            ${split.silver.map((p) => `<div style="font-size:0.78rem;padding:3px 0;border-bottom:1px solid rgba(255,255,255,0.05);display:flex;justify-content:space-between;"><span>${escapeHtml(p.name)}${p.fatigued ? ' ⚠️' : ''}</span><strong style="color:#e2e8f0;">${p.ovr}</strong></div>`).join('') || '<span class="muted">—</span>'}
          </div>
        </div>
        ${split.excludedUnavailable.length ? `<p class="muted" style="margin-top:8px;">⛔ تم استبعاد غير المتاحين تلقائياً: ${split.excludedUnavailable.map((p) => escapeHtml(p.name)).join('، ')}</p>` : ''}
        ${split.fatiguedNames.length ? `<p class="muted" style="margin-top:4px;color:#fde68a;">⚠️ علامة الإجهاد تشير إلى جاهزية منخفضة — يمكن للكابتن تعديل التقسيمة يدوياً.</p>` : ''}
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

    // Collapsible Plan Options Drawer toggle
    document.getElementById('btnTacOptionsDrawer')?.addEventListener('click', () => {
      this.optionsDrawerOpen = !this.optionsDrawerOpen;
      this.renderToolbarState();
    });

    // In-pitch Callout collapse/expand toggle
    document.getElementById('btnTacCalloutToggle')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.calloutCollapsed = !this.calloutCollapsed;
      this.renderSvgPitch();
    });

    // Bottom «دورك في الخطة» focus toggle ([حركتي فقط] <-> [مع الفريق])
    document.getElementById('tacYourRoleCard')?.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-tac-focus]');
      if (!btn?.dataset.tacFocus) return;
      const nextMine = btn.dataset.tacFocus === 'mine';
      if (this.focusMineOnly === nextMine) return;
      this.focusMineOnly = nextMine;
      this.renderYourRoleCard();
      this.renderSvgPitch();
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
    document.getElementById('btnTacSpeedCycle')?.addEventListener('click', () => {
      this.speedDrawerOpen = !this.speedDrawerOpen;
      this.renderTimelineButtons();
    });
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
        this.speedDrawerOpen = false;
        this.renderTimelineButtons();
      });
    });

    document.getElementById('tacProgressRange')?.addEventListener('input', (e) => {
      const val = Number((e.target as HTMLInputElement).value);
      if (!Number.isFinite(val)) return;
      this.pause();
      const ratio = Math.max(0, Math.min(1, val / 1000));
      const targetMs = ratio * this.timelineMetrics.totalMs;
      this.applyTimelineAt(targetMs, false);
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
    document.getElementById('btnTacRecPop')?.addEventListener('click', () => this.popCustomFrame());
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

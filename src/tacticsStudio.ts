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
  computeSmartBallDisplayPoint,
  placeZoneLabelY,
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
import {
  TACTICAL_COMPARISONS_6V6,
  getComparisonById,
  findDefaultComparisonForPhase,
  buildComparisonSequence,
  type ComparisonVariant,
} from './tacticsComparisons';
import {
  pickBestArabicVoice,
  prepareArabicNarrationText,
  computeSpeechRate,
  estimateSpeechTimeoutMs,
} from './tacticsVoice';
import {
  PRO_SVG_W,
  PRO_SVG_H,
  portraitPctToProSvg,
  mapSlotToBoardPct,
  buildProLandscapePitchSvg,
  renderFormationMiniPitchSvg,
  projectProClientToPortraitPct,
  clampProZoomPct,
  isDrawingTool,
  isSingleClickStampTool,
  shouldBoardOverlayInterceptPointer,
  defaultColorForTool,
  createHistoryState,
  pushHistorySnapshot,
  applyHistoryUndo,
  applyHistoryRedo,
  hitTestProAnnotation,
  buildProAnnotationsDefsSvg,
  renderProAnnotationsSvgContent,
  type ProAnnotation,
  type ProAnnotationKind,
  type ProBoardSnapshot,
  type ProBoardTool,
  type ProHistoryState,
  type ProSectionTab,
} from './tacticsProBoard';
import { computeDominanceXRay, type TacticalEvaluation } from './engine/dominanceXRay';
import { tacticalFramesToGhostPlay, analyzeGhostPassIntercept } from './engine/ghostPlay';
import { buildXRayHudHtml, clearXRayCanvas, renderXRayCanvas } from './lab/xrayRenderer';
import {
  buildShareableGhostLink,
  exportGhostPlayLocalMedia,
  openGhostGuestViewer,
} from './lab/ghostPlayUI';
import { openTacticalLabModal, type TacticalLabTab } from './lab/tacticalLabUI';
import { openBlackBoxModal } from './lab/blackBoxUI';
import { PitWallRotationController } from './lab/pitWallUI';

const STUDIO_STORAGE_KEY = 'maydan_tactics_studio_v1';
const SVG_W = 360;
const SVG_H = 520;

export type StudioViewMode = 'studio' | 'cinematic' | 'poster' | 'fifa';
export type CinematicCameraAngle = 'cinematic' | 'top' | 'wide';
export type CaptainToolTab = 'smart' | 'split' | 'roles' | 'gk' | 'rotate';

type CinematicAction =
  | 'idle'
  | 'walk'
  | 'run'
  | 'sprint'
  | 'turn'
  | 'pass'
  | 'receive'
  | 'shoot'
  | 'defend'
  | 'press';

interface FigurinePose {
  action: CinematicAction;
  torsoLean: number;
  bobY: number;
  headTilt: number;
  frontHip: number;
  frontKnee: number;
  backHip: number;
  backKnee: number;
  frontArm: number;
  frontElbow: number;
  backArm: number;
  backElbow: number;
  shadowShiftX: number;
  shadowScaleX: number;
}

interface CinematicFigRefs {
  root: SVGGElement;
  shadow: SVGEllipseElement;
  selRing: SVGGElement;
  alertRing: SVGGElement;
  bodyRoot: SVGGElement;
  torso: SVGGElement;
  head: SVGGElement;
  frontLeg: SVGGElement;
  frontShin: SVGGElement;
  backLeg: SVGGElement;
  backShin: SVGGElement;
  frontArm: SVGGElement;
  frontForearm: SVGGElement;
  backArm: SVGGElement;
  backForearm: SVGGElement;
  jerseyTxt: SVGTextElement;
  tagGroup: SVGGElement;
  tagRect: SVGRectElement;
  tagText: SVGTextElement;
}

interface CinematicBallRefs {
  root: SVGGElement;
  shadow: SVGEllipseElement;
  bodyGroup: SVGGElement;
  spinGroup: SVGGElement;
  grabRing: SVGCircleElement;
}

interface CinematicDomCache {
  signature: string;
  bgLayer: SVGGElement;
  annotationsLayer: SVGGElement;
  actorsLayer: SVGGElement;
  overlayLayer: SVGGElement;
  ourFigs: CinematicFigRefs[];
  oppFigs: CinematicFigRefs[];
  ball: CinematicBallRefs;
}

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
  getTactics: () => {
    formation: string;
    slots: Record<string, string>;
    publishedByName?: string;
    publishedAtMs?: number;
    votes?: Record<string, string>;
  };
  setTactics: (next: { formation: string; slots: Record<string, string> }) => void;
  getTeamSettings: () => { teamName?: string; logo?: string; lineupPermission?: string };
  isAdmin: () => boolean;
  canPublishLineup?: () => boolean;
  onPublishLineup?: (next: { formation: string; slots: Record<string, string> }) => Promise<void> | void;
  onVoteLineup?: (vote: 'approve' | 'swap') => Promise<void> | void;
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

let cachedGrassDataUrl: string | null = null;

function getCachedGrassTextureUrl(): string {
  if (cachedGrassDataUrl !== null) return cachedGrassDataUrl;
  try {
    if (typeof document === 'undefined') {
      cachedGrassDataUrl = '';
      return '';
    }
    const canvas = document.createElement('canvas');
    canvas.width = SVG_W;
    canvas.height = SVG_H;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      cachedGrassDataUrl = '';
      return '';
    }

    // 1) Alternating rich emerald mowed grass bands
    const stripes = 10;
    const bandH = SVG_H / stripes;
    for (let i = 0; i < stripes; i++) {
      ctx.fillStyle = i % 2 === 0 ? '#0f5a23' : '#0a4419';
      ctx.fillRect(0, Math.floor(i * bandH), SVG_W, Math.ceil(bandH) + 1);
    }

    // 2) Fine deterministic organic grass speckles (light & deep turf micro-blades)
    let seed = 0x5f3759df;
    const nextRand = () => {
      seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let n = 0; n < 4800; n++) {
      const gx = nextRand() * SVG_W;
      const gy = nextRand() * SVG_H;
      const bright = nextRand() > 0.46;
      const alpha = 0.04 + nextRand() * 0.095;
      ctx.fillStyle = bright ? `rgba(134, 239, 172, ${alpha.toFixed(3)})` : `rgba(2, 22, 10, ${(alpha * 1.25).toFixed(3)})`;
      const bw = 1 + nextRand() * 1.4;
      const bh = 1.2 + nextRand() * 2.4;
      ctx.fillRect(gx, gy, bw, bh);
    }

    // 3) Subtle vertical mower sheen lines
    for (let x = 0; x < SVG_W; x += 6) {
      ctx.fillStyle = x % 12 === 0 ? 'rgba(255,255,255,0.018)' : 'rgba(0,0,0,0.02)';
      ctx.fillRect(x, 0, 2, SVG_H);
    }

    // 4) Central stadium floodlight pool + deep dramatic corner/edge vignette
    const flood = ctx.createRadialGradient(SVG_W * 0.5, SVG_H * 0.45, 22, SVG_W * 0.5, SVG_H * 0.48, SVG_H * 0.62);
    flood.addColorStop(0, 'rgba(74, 222, 128, 0.28)');
    flood.addColorStop(0.36, 'rgba(34, 197, 94, 0.11)');
    flood.addColorStop(0.7, 'rgba(3, 20, 10, 0.34)');
    flood.addColorStop(1, 'rgba(2, 8, 5, 0.84)');
    ctx.fillStyle = flood;
    ctx.fillRect(0, 0, SVG_W, SVG_H);

    // Extra corner darkening for authentic night-match broadcast mood
    const topVignette = ctx.createLinearGradient(0, 0, 0, 56);
    topVignette.addColorStop(0, 'rgba(1, 7, 4, 0.55)');
    topVignette.addColorStop(1, 'rgba(1, 7, 4, 0)');
    ctx.fillStyle = topVignette;
    ctx.fillRect(0, 0, SVG_W, 56);

    const botVignette = ctx.createLinearGradient(0, SVG_H - 72, 0, SVG_H);
    botVignette.addColorStop(0, 'rgba(1, 7, 4, 0)');
    botVignette.addColorStop(1, 'rgba(1, 7, 4, 0.68)');
    ctx.fillStyle = botVignette;
    ctx.fillRect(0, SVG_H - 72, SVG_W, 72);

    cachedGrassDataUrl = canvas.toDataURL('image/jpeg', 0.86);
  } catch {
    cachedGrassDataUrl = '';
  }
  return cachedGrassDataUrl;
}

const SVG_ICO_CALLOUT_PLAY = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8" fill="currentColor" stroke="none"/></svg>';
const SVG_ICO_BULB = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#FACC15" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z"/><line x1="12" y1="0.8" x2="12" y2="0.8"/></svg>';
const SVG_ICO_CROWN = '<svg width="14" height="10" viewBox="0 0 24 16" fill="#FACC15" aria-hidden="true"><path d="M2 14L4.5 4.5L9.5 9L12 2.5L14.5 9L19.5 4.5L22 14H2Z"/></svg>';
const SVG_ICO_PLAY = '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="7 4 20 12 7 20 7 4"/></svg>';
const SVG_ICO_PAUSE = '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="4" width="4.5" height="16" rx="1.4"/><rect x="13.5" y="4" width="4.5" height="16" rx="1.4"/></svg>';
const SVG_ICO_VOL_ON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a9.5 9.5 0 0 1 0 14"/></svg>';
const SVG_ICO_VOL_OFF = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="22" y1="9" x2="16" y2="15"/><line x1="16" y1="9" x2="22" y2="15"/></svg>';
const SVG_ICO_CHECK = '<svg width="9" height="9" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 8.5 6.5 12 13 4.5"/></svg>';

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

// ==================== CINEMATIC 2.5D ARTICULATED FIGURINE ENGINE (PURE SVG + KINEMATICS) ====================

const SVG_NS = 'http://www.w3.org/2000/svg';

function clampNum(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function easeCubic(t: number): number {
  const c = clampNum(t, 0, 1);
  return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2;
}

/**
 * Deterministic tactical stagger delay (ms) within a single keyframe transition.
 * Ball carrier / primary active mover reacts first (0ms); wingers/supports follow (55-120ms);
 * covering defenders & silver opponent reactions stagger naturally (95-185ms).
 * Fully deterministic from timeline state — pauses, resumes, and scrubs identically.
 */
function computeActorDelayMs(
  isGold: boolean,
  idx: number,
  activeSet: ReadonlySet<number>,
  distToBall: number,
  phase: TacticalPhaseId
): number {
  if (isGold) {
    if (distToBall < 9) return 0;
    if (activeSet.has(idx)) return Math.min(95, (idx % 3) * 38);
    if (phase === 'gegenpress' || phase === 'highpress') {
      return Math.min(140, 35 + Math.round(distToBall * 1.4));
    }
    return 75 + ((idx * 31) % 85);
  }
  // Silver opponent reacts cleanly to ball/pressure without simultaneous robotic starts
  if (distToBall < 11) return 28;
  return 85 + Math.min(115, Math.round(distToBall * 1.35) + ((idx * 23) % 35));
}

/**
 * Infers the realistic tactical body action for an actor from the actual scenario/keyframe movement
 * and ball trajectory (supports all 10 actions: idle, walk, run, sprint, turn, pass, receive, shoot, defend, press).
 */
function inferActorAction(params: {
  isGold: boolean;
  idx: number;
  dx: number;
  dy: number;
  localT: number;
  rawMoveWindowT: number;
  prevBall: { x: number; y: number };
  targetBall: { x: number; y: number };
  prevPos: { x: number; y: number };
  targetPos: { x: number; y: number };
  phase: TacticalPhaseId;
  activeSet: ReadonlySet<number>;
  isTurning: boolean;
  isMovingNow: boolean;
}): CinematicAction {
  const {
    isGold,
    idx,
    dx,
    dy,
    localT,
    rawMoveWindowT,
    prevBall,
    targetBall,
    prevPos,
    targetPos,
    phase,
    activeSet,
    isTurning,
    isMovingNow,
  } = params;

  const moveDist = Math.hypot(dx, dy);
  const ballDist = Math.hypot(targetBall.x - prevBall.x, targetBall.y - prevBall.y);
  const startNearBall = Math.hypot(prevPos.x - prevBall.x, prevPos.y - prevBall.y) < 12.5;
  const endNearBall = Math.hypot(targetPos.x - targetBall.x, targetPos.y - targetBall.y) < 12.5;
  const ballHeadingToGoal =
    ballDist >= 10 &&
    ((targetBall.y <= 15 && targetBall.x >= 32 && targetBall.x <= 68) ||
      (targetBall.y >= 87 && targetBall.x >= 32 && targetBall.x <= 68));

  // 1) Shoot — striking ball toward goal during launch window
  if (startNearBall && ballHeadingToGoal && rawMoveWindowT > 0.01 && rawMoveWindowT < 0.62) {
    return 'shoot';
  }
  // 2) Pass — launching ball to a teammate during kick window
  if (startNearBall && ballDist >= 8 && rawMoveWindowT > 0.01 && rawMoveWindowT < 0.52) {
    return 'pass';
  }
  // 3) Receive — cushioning/trapping incoming ball at destination
  if (endNearBall && ballDist >= 8 && rawMoveWindowT >= 0.66 && rawMoveWindowT < 0.995) {
    return 'receive';
  }

  // If settled and not performing a ball action -> Idle (or defensive stance if pressing/defending close)
  if (!isMovingNow || moveDist < 1.3 || localT <= 0.002 || localT >= 0.995) {
    return 'idle';
  }

  // 4) Turn — sharp heading change mid-transition
  if (isTurning && localT > 0.08 && localT < 0.45 && moveDist >= 3) {
    return 'turn';
  }

  const distToTargetBallStart = Math.hypot(prevPos.x - targetBall.x, prevPos.y - targetBall.y);
  const distToTargetBallEnd = Math.hypot(targetPos.x - targetBall.x, targetPos.y - targetBall.y);
  const closingBall = distToTargetBallStart - distToTargetBallEnd > 4.5 && distToTargetBallEnd < 20;

  // 5) Press — urgent closing down of ball carrier
  if (
    closingBall &&
    ((isGold && (phase === 'gegenpress' || phase === 'highpress' || activeSet.has(idx))) ||
      (!isGold && distToTargetBallEnd < 16))
  ) {
    return 'press';
  }

  // 6) Defend — retreating or lateral defensive jockeying while facing play
  const isRetreating = isGold ? dy > 2.2 : dy < -2.2;
  const isLateralShift = Math.abs(dx) > Math.abs(dy) * 1.4 && moveDist < 14;
  if ((!isGold && (isRetreating || isLateralShift)) || (isGold && phase === 'defend' && (isRetreating || isLateralShift))) {
    return 'defend';
  }

  // 7) Sprint / Run / Walk based on real displacement speed
  if (moveDist >= 18) return 'sprint';
  if (moveDist >= 6.5) return 'run';
  return 'walk';
}

/**
 * Computes articulated limb joint angles (degrees) & torso dynamics for any of the 10 actions.
 */
function computeFigurinePose(
  action: CinematicAction,
  stridePhase: number,
  actionT: number,
  isPlaying: boolean,
  reduced: boolean
): FigurinePose {
  if (reduced) {
    // Clean athletic neutral pose in data-saver / prefers-reduced-motion
    return {
      action: 'idle',
      torsoLean: 2,
      bobY: 0,
      headTilt: 0,
      frontHip: 7,
      frontKnee: 7,
      backHip: -7,
      backKnee: 7,
      frontArm: -10,
      frontElbow: 18,
      backArm: 10,
      backElbow: 18,
      shadowShiftX: 0,
      shadowScaleX: 1,
    };
  }

  const s = Math.sin(stridePhase);
  const c = Math.cos(stridePhase);

  switch (action) {
    case 'idle': {
      const breath = isPlaying ? Math.sin(stridePhase * 0.35) * 0.38 : 0;
      return {
        action,
        torsoLean: 2,
        bobY: breath,
        headTilt: 0,
        frontHip: 6,
        frontKnee: 8,
        backHip: -6,
        backKnee: 8,
        frontArm: -9,
        frontElbow: 22,
        backArm: 9,
        backElbow: 22,
        shadowShiftX: 0,
        shadowScaleX: 0.96,
      };
    }
    case 'walk': {
      const fHip = s * 17;
      const bHip = -s * 17;
      return {
        action,
        torsoLean: 5.5,
        bobY: -Math.abs(c) * 0.65,
        headTilt: 2,
        frontHip: fHip,
        frontKnee: fHip < 0 ? 18 + Math.abs(fHip) * 0.45 : 7,
        backHip: bHip,
        backKnee: bHip < 0 ? 18 + Math.abs(bHip) * 0.45 : 7,
        frontArm: -s * 15,
        frontElbow: 24,
        backArm: s * 15,
        backElbow: 24,
        shadowShiftX: 0.5,
        shadowScaleX: 1.02 + Math.abs(s) * 0.08,
      };
    }
    case 'run': {
      const fHip = s * 33;
      const bHip = -s * 33;
      return {
        action,
        torsoLean: 12.5,
        bobY: -Math.abs(c) * 1.55,
        headTilt: -4,
        frontHip: fHip,
        frontKnee: fHip < 0 ? 28 + Math.abs(fHip) * 0.72 : 12 + fHip * 0.25,
        backHip: bHip,
        backKnee: bHip < 0 ? 28 + Math.abs(bHip) * 0.72 : 12 + bHip * 0.25,
        frontArm: -s * 36,
        frontElbow: 56,
        backArm: s * 36,
        backElbow: 56,
        shadowShiftX: 1.2,
        shadowScaleX: 1.06 + Math.abs(s) * 0.16,
      };
    }
    case 'sprint': {
      const sFast = Math.sin(stridePhase * 1.42);
      const cFast = Math.cos(stridePhase * 1.42);
      const fHip = sFast * 45;
      const bHip = -sFast * 45;
      return {
        action,
        torsoLean: 19.5,
        bobY: -Math.abs(cFast) * 2.1,
        headTilt: -8,
        frontHip: fHip,
        frontKnee: fHip < 0 ? 34 + Math.abs(fHip) * 0.78 : 14 + fHip * 0.22,
        backHip: bHip,
        backKnee: bHip < 0 ? 34 + Math.abs(bHip) * 0.78 : 14 + bHip * 0.22,
        frontArm: -sFast * 48,
        frontElbow: 68,
        backArm: sFast * 48,
        backElbow: 68,
        shadowShiftX: 1.9,
        shadowScaleX: 1.12 + Math.abs(sFast) * 0.22,
      };
    }
    case 'turn': {
      const pivot = Math.sin(clampNum(actionT, 0, 1) * Math.PI);
      return {
        action,
        torsoLean: 8 + pivot * 6,
        bobY: 1.0,
        headTilt: -4,
        frontHip: 16 - pivot * 10,
        frontKnee: 24,
        backHip: -18 + pivot * 12,
        backKnee: 22,
        frontArm: -28 - pivot * 10,
        frontElbow: 46,
        backArm: 26 + pivot * 10,
        backElbow: 46,
        shadowShiftX: 0.8,
        shadowScaleX: 1.08,
      };
    }
    case 'pass': {
      // Wind-up [0..0.32] -> crisp strike [0.32..0.72] -> settle [0.72..1]
      const k = clampNum(actionT, 0, 1);
      let kickHip = 0;
      let kickKnee = 10;
      let lean = 6;
      if (k < 0.32) {
        const u = k / 0.32;
        kickHip = -28 * u;
        kickKnee = 10 + 26 * u;
        lean = 6 + 6 * u;
      } else if (k < 0.72) {
        const u = easeCubic((k - 0.32) / 0.4);
        kickHip = -28 + 64 * u;
        kickKnee = 36 - 30 * u;
        lean = 12 - 14 * u;
      } else {
        const u = (k - 0.72) / 0.28;
        kickHip = 36 * (1 - u) + 6 * u;
        kickKnee = 6 + 4 * u;
        lean = -2 * (1 - u) + 3 * u;
      }
      return {
        action,
        torsoLean: lean,
        bobY: 0.5,
        headTilt: 4,
        frontHip: kickHip,
        frontKnee: kickKnee,
        backHip: -10,
        backKnee: 16,
        frontArm: -26,
        frontElbow: 36,
        backArm: 32,
        backElbow: 38,
        shadowShiftX: 1.0,
        shadowScaleX: 1.12,
      };
    }
    case 'shoot': {
      // Deep power backswing -> explosive strike -> athletic follow-through
      const k = clampNum(actionT, 0, 1);
      let kickHip = 0;
      let kickKnee = 12;
      let lean = 10;
      if (k < 0.3) {
        const u = k / 0.3;
        kickHip = -44 * u;
        kickKnee = 14 + 42 * u;
        lean = 10 + 10 * u;
      } else if (k < 0.68) {
        const u = easeCubic((k - 0.3) / 0.38);
        kickHip = -44 + 98 * u;
        kickKnee = 56 - 52 * u;
        lean = 20 - 28 * u;
      } else {
        const u = (k - 0.68) / 0.32;
        kickHip = 54 * (1 - u) + 10 * u;
        kickKnee = 4 + 8 * u;
        lean = -8 * (1 - u) + 3 * u;
      }
      return {
        action,
        torsoLean: lean,
        bobY: -0.6,
        headTilt: 5,
        frontHip: kickHip,
        frontKnee: kickKnee,
        backHip: -16,
        backKnee: 20,
        frontArm: -42,
        frontElbow: 40,
        backArm: 48,
        backElbow: 34,
        shadowShiftX: 1.4,
        shadowScaleX: 1.2,
      };
    }
    case 'receive': {
      // Cushioning first touch as ball arrives
      const r = Math.sin(clampNum(actionT, 0, 1) * Math.PI);
      return {
        action,
        torsoLean: 6 - r * 3,
        bobY: 0.9,
        headTilt: 6,
        frontHip: 10 + r * 22,
        frontKnee: 16 + r * 14,
        backHip: -12,
        backKnee: 18,
        frontArm: -22 - r * 12,
        frontElbow: 36,
        backArm: 22 + r * 12,
        backElbow: 36,
        shadowShiftX: 0.5,
        shadowScaleX: 1.08,
      };
    }
    case 'defend': {
      // Athletic jockey crouch + lateral shuffle facing play
      const sh = Math.sin(stridePhase * 1.15) * 11;
      return {
        action,
        torsoLean: 12,
        bobY: 2.2 - Math.abs(Math.cos(stridePhase * 1.15)) * 0.5,
        headTilt: -5,
        frontHip: 18 + sh,
        frontKnee: 28,
        backHip: -16 - sh,
        backKnee: 28,
        frontArm: -28,
        frontElbow: 42,
        backArm: 28,
        backElbow: 42,
        shadowShiftX: 0.4,
        shadowScaleX: 1.14,
      };
    }
    case 'press': {
      // High-urgency pressing burst closing down ball carrier
      const sP = Math.sin(stridePhase * 1.32);
      const cP = Math.cos(stridePhase * 1.32);
      const fHip = sP * 39;
      const bHip = -sP * 39;
      return {
        action,
        torsoLean: 17.5,
        bobY: -Math.abs(cP) * 1.75,
        headTilt: -6,
        frontHip: fHip,
        frontKnee: fHip < 0 ? 32 + Math.abs(fHip) * 0.72 : 14,
        backHip: bHip,
        backKnee: bHip < 0 ? 32 + Math.abs(bHip) * 0.72 : 14,
        frontArm: -sP * 42,
        frontElbow: 62,
        backArm: sP * 42,
        backElbow: 62,
        shadowShiftX: 1.6,
        shadowScaleX: 1.12 + Math.abs(sP) * 0.18,
      };
    }
  }
}

/**
 * Builds an articulated multi-part SVG metallic humanoid footballer figurine ONCE for DOM reuse.
 * Parts: ground shadow, selection/alert ground ring, back arm + forearm, back thigh + shin + boot,
 * sculpted metallic jersey torso + shoulders + shorts + jersey number, neck + sculpted head,
 * front thigh + shin + boot, front arm + forearm, and crisp minimal identity tag.
 */
function createArticulatedFigurineNode(team: 'gold' | 'silver', idx: number): CinematicFigRefs {
  const isGold = team === 'gold';
  const bodyFill = isGold ? 'url(#cinGoldBody)' : 'url(#cinSilverBody)';
  const limbFill = isGold ? 'url(#cinGoldLimb)' : 'url(#cinSilverLimb)';
  const headFill = isGold ? 'url(#cinGoldHead)' : 'url(#cinSilverHead)';
  const shortsFill = isGold ? 'url(#cinGoldShorts)' : 'url(#cinSilverShorts)';
  const bootFill = isGold ? '#2a1d06' : '#111827';
  const rimStroke = isGold ? '#FEF08A' : '#E2E8F0';
  const accentStroke = isGold ? '#CA8A04' : '#64748B';
  const numFill = isGold ? '#1c1404' : '#0f172a';

  const root = document.createElementNS(SVG_NS, 'g');
  root.setAttribute('class', `tac-fig ${isGold ? 'tac-fig-our' : 'tac-fig-opp'}`);
  root.setAttribute('data-drag-kind', isGold ? 'our' : 'opp');
  root.setAttribute('data-drag-idx', String(idx));

  root.innerHTML = `
    <g class="cin-sel-ring" visibility="hidden" pointer-events="none">
      <ellipse cx="0" cy="1" rx="18" ry="8.2" fill="url(#goldHaloOuter)" opacity="0.72"/>
      <ellipse cx="0" cy="1" rx="12.5" ry="5.5" fill="none" stroke="#FEF08A" stroke-width="1.6"/>
      <ellipse cx="0" cy="1" rx="15.2" ry="6.8" fill="none" stroke="#FACC15" stroke-width="0.9" stroke-opacity="0.7" stroke-dasharray="3 2.5"/>
    </g>
    <g class="cin-alert-ring" visibility="hidden" pointer-events="none">
      <ellipse cx="0" cy="1" rx="15.5" ry="7" fill="url(#oppAlertHalo)" opacity="0.8"/>
      <ellipse cx="0" cy="1" rx="11.5" ry="5" fill="none" stroke="#fb923c" stroke-width="1.45"/>
    </g>
    <ellipse class="cin-shadow" cx="0" cy="1.8" rx="9.2" ry="3.7" fill="rgba(0,0,0,0.52)" pointer-events="none"/>
    <g class="cin-body-root">
      <g class="cin-torso" transform="translate(0, -14.2)">
        <g class="cin-back-arm" transform="translate(-3.4, -9.8)">
          <rect x="-1.6" y="-0.6" width="3.2" height="6.2" rx="1.5" fill="${limbFill}" stroke="${accentStroke}" stroke-width="0.45"/>
          <g class="cin-back-forearm" transform="translate(0, 5.2)">
            <rect x="-1.35" y="-0.4" width="2.7" height="5.5" rx="1.3" fill="${limbFill}" stroke="${accentStroke}" stroke-width="0.4"/>
            <circle cx="0" cy="5.3" r="1.25" fill="${headFill}"/>
          </g>
        </g>
        <g class="cin-back-leg" transform="translate(-1.8, 0.2)">
          <path d="M -2.2 -0.6 L 2.2 -0.6 L 1.85 6.8 L -1.85 6.8 Z" fill="${shortsFill}" stroke="${accentStroke}" stroke-width="0.4"/>
          <g class="cin-back-shin" transform="translate(0, 6.4)">
            <rect x="-1.5" y="-0.5" width="3.0" height="6.6" rx="1.2" fill="${limbFill}" stroke="${accentStroke}" stroke-width="0.4"/>
            <path d="M -1.7 5.8 L 3.4 5.8 Q 4.4 6.5 3.6 7.5 L -1.8 7.5 Z" fill="${bootFill}" stroke="${rimStroke}" stroke-width="0.45"/>
          </g>
        </g>
        <g class="cin-core-body">
          <path d="M -4.2 -1.6 L 4.2 -1.6 L 3.8 2.2 L -3.8 2.2 Z" fill="${shortsFill}" stroke="${accentStroke}" stroke-width="0.45"/>
          <path d="M -5.4 -10.4 Q 0 -12.0 5.4 -10.4 L 4.1 -1.2 L -4.1 -1.2 Z" fill="${bodyFill}" stroke="${rimStroke}" stroke-width="0.65"/>
          <path d="M -3.8 -9.8 Q 0 -10.9 3.8 -9.8 L 2.8 -2.8 L -2.8 -2.8 Z" fill="rgba(255,255,255,0.16)" pointer-events="none"/>
          <text class="cin-jersey-txt" x="0" y="-4.6" text-anchor="middle" fill="${numFill}" font-size="4.6" font-weight="900" pointer-events="none"></text>
        </g>
        <g class="cin-head" transform="translate(0, -12.2)">
          <rect x="-1.25" y="-1.6" width="2.5" height="2.4" rx="1" fill="${limbFill}"/>
          <circle cx="0" cy="-4.3" r="3.45" fill="${headFill}" stroke="${rimStroke}" stroke-width="0.55"/>
          <path d="M 1.0 -5.1 Q 2.7 -4.4 2.4 -2.9" fill="none" stroke="rgba(255,255,255,0.45)" stroke-width="0.6" stroke-linecap="round"/>
          <circle cx="-1.0" cy="-5.4" r="1.0" fill="rgba(255,255,255,0.34)" pointer-events="none"/>
        </g>
        <g class="cin-front-leg" transform="translate(1.8, 0.2)">
          <path d="M -2.2 -0.6 L 2.2 -0.6 L 1.85 6.8 L -1.85 6.8 Z" fill="${shortsFill}" stroke="${rimStroke}" stroke-width="0.45"/>
          <g class="cin-front-shin" transform="translate(0, 6.4)">
            <rect x="-1.55" y="-0.5" width="3.1" height="6.6" rx="1.2" fill="${limbFill}" stroke="${rimStroke}" stroke-width="0.45"/>
            <path d="M -1.7 5.8 L 3.7 5.8 Q 4.7 6.5 3.9 7.5 L -1.8 7.5 Z" fill="${bootFill}" stroke="${rimStroke}" stroke-width="0.5"/>
          </g>
        </g>
        <g class="cin-front-arm" transform="translate(3.6, -9.8)">
          <rect x="-1.65" y="-0.6" width="3.3" height="6.3" rx="1.5" fill="${limbFill}" stroke="${rimStroke}" stroke-width="0.45"/>
          <g class="cin-front-forearm" transform="translate(0, 5.2)">
            <rect x="-1.4" y="-0.4" width="2.8" height="5.6" rx="1.3" fill="${limbFill}" stroke="${rimStroke}" stroke-width="0.45"/>
            <circle cx="0" cy="5.3" r="1.3" fill="${headFill}"/>
          </g>
        </g>
      </g>
    </g>
    <g class="cin-tag" transform="translate(0, 8.8)" visibility="hidden" pointer-events="none">
      <rect class="cin-tag-rect" x="-16" y="-5.5" width="32" height="11" rx="4.5" fill="rgba(6,8,13,0.88)" stroke="${isGold ? 'rgba(250,204,21,0.55)' : 'rgba(148,163,184,0.45)'}" stroke-width="0.75"/>
      <text class="cin-tag-txt" x="0" y="2.3" text-anchor="middle" fill="${isGold ? '#FEF08A' : '#E2E8F0'}" font-size="6.4" font-weight="800"></text>
    </g>
  `;

  return {
    root,
    shadow: root.querySelector('.cin-shadow') as SVGEllipseElement,
    selRing: root.querySelector('.cin-sel-ring') as SVGGElement,
    alertRing: root.querySelector('.cin-alert-ring') as SVGGElement,
    bodyRoot: root.querySelector('.cin-body-root') as SVGGElement,
    torso: root.querySelector('.cin-torso') as SVGGElement,
    head: root.querySelector('.cin-head') as SVGGElement,
    frontLeg: root.querySelector('.cin-front-leg') as SVGGElement,
    frontShin: root.querySelector('.cin-front-shin') as SVGGElement,
    backLeg: root.querySelector('.cin-back-leg') as SVGGElement,
    backShin: root.querySelector('.cin-back-shin') as SVGGElement,
    frontArm: root.querySelector('.cin-front-arm') as SVGGElement,
    frontForearm: root.querySelector('.cin-front-forearm') as SVGGElement,
    backArm: root.querySelector('.cin-back-arm') as SVGGElement,
    backForearm: root.querySelector('.cin-back-forearm') as SVGGElement,
    jerseyTxt: root.querySelector('.cin-jersey-txt') as SVGTextElement,
    tagGroup: root.querySelector('.cin-tag') as SVGGElement,
    tagRect: root.querySelector('.cin-tag-rect') as SVGRectElement,
    tagText: root.querySelector('.cin-tag-txt') as SVGTextElement,
  };
}

function createCinematicBallNode(): CinematicBallRefs {
  const root = document.createElementNS(SVG_NS, 'g');
  root.setAttribute('class', 'tac-fig tac-ball');
  root.setAttribute('data-drag-kind', 'ball');
  root.setAttribute('data-drag-idx', '0');

  root.innerHTML = `
    <ellipse class="cin-ball-shadow" cx="0" cy="5.5" rx="7.2" ry="3.2" fill="rgba(0,0,0,0.48)" pointer-events="none"/>
    <circle class="cin-ball-grab" cx="0" cy="0" r="12.5" fill="none" stroke="#FEF08A" stroke-width="1.8" stroke-dasharray="4 3" visibility="hidden" pointer-events="none"/>
    <g class="cin-ball-body">
      <circle cx="0" cy="0" r="7.4" fill="url(#footballGrad)" stroke="#090b10" stroke-width="1.2"/>
      <g class="cin-ball-spin" pointer-events="none">
        <g stroke="#1e293b" stroke-width="0.78" stroke-linecap="round" opacity="0.75">
          <line x1="0" y1="-2.9" x2="0" y2="-6.9"/>
          <line x1="2.75" y1="-0.9" x2="6.6" y2="-2.2"/>
          <line x1="1.7" y1="2.35" x2="4.4" y2="5.7"/>
          <line x1="-1.7" y1="2.35" x2="-4.4" y2="5.7"/>
          <line x1="-2.75" y1="-0.9" x2="-6.6" y2="-2.2"/>
        </g>
        <polygon points="0,-2.9 2.75,-0.9 1.7,2.35 -1.7,2.35 -2.75,-0.9" fill="#0f172a"/>
        <polygon points="0,-7.3 1.4,-6.3 -1.4,-6.3" fill="#0f172a" opacity="0.78"/>
        <polygon points="6.9,-2.1 5.6,-1.1 6.0,-3.4" fill="#0f172a" opacity="0.72"/>
        <polygon points="-6.9,-2.1 -5.6,-1.1 -6.0,-3.4" fill="#0f172a" opacity="0.72"/>
      </g>
      <circle cx="-2.1" cy="-2.5" r="1.45" fill="rgba(255,255,255,0.68)" pointer-events="none"/>
    </g>
  `;

  return {
    root,
    shadow: root.querySelector('.cin-ball-shadow') as SVGEllipseElement,
    bodyGroup: root.querySelector('.cin-ball-body') as SVGGElement,
    spinGroup: root.querySelector('.cin-ball-spin') as SVGGElement,
    grabRing: root.querySelector('.cin-ball-grab') as SVGCircleElement,
  };
}

function applyFigurinePoseToDom(
  fig: CinematicFigRefs,
  x: number,
  y: number,
  depthScale: number,
  facingBlend: number,
  pose: FigurinePose,
  opts: {
    opacity: number;
    selected: boolean;
    alert: boolean;
    jerseyLabel: string;
    tagLabel: string;
    showTag: boolean;
  }
): void {
  fig.root.setAttribute('transform', `translate(${x.toFixed(1)}, ${y.toFixed(1)}) scale(${depthScale.toFixed(3)})`);
  fig.root.setAttribute('opacity', opts.opacity.toFixed(2));
  fig.selRing.setAttribute('visibility', opts.selected ? 'visible' : 'hidden');
  fig.alertRing.setAttribute('visibility', opts.alert && !opts.selected ? 'visible' : 'hidden');

  const safeFace = Math.abs(facingBlend) < 0.22 ? (facingBlend >= 0 ? 0.22 : -0.22) : facingBlend;
  const dirSign = safeFace >= 0 ? 1 : -1;

  fig.shadow.setAttribute('cx', (pose.shadowShiftX * dirSign).toFixed(1));
  fig.shadow.setAttribute('rx', (9.0 * pose.shadowScaleX).toFixed(1));

  fig.bodyRoot.setAttribute('transform', `scale(${safeFace.toFixed(3)}, 1)`);
  fig.torso.setAttribute('transform', `translate(0, ${(-14.2 + pose.bobY).toFixed(2)}) rotate(${pose.torsoLean.toFixed(1)})`);
  fig.head.setAttribute('transform', `translate(0, -12.2) rotate(${pose.headTilt.toFixed(1)})`);

  fig.frontLeg.setAttribute('transform', `translate(1.8, 0.2) rotate(${pose.frontHip.toFixed(1)})`);
  fig.frontShin.setAttribute('transform', `translate(0, 6.4) rotate(${pose.frontKnee.toFixed(1)})`);
  fig.backLeg.setAttribute('transform', `translate(-1.8, 0.2) rotate(${pose.backHip.toFixed(1)})`);
  fig.backShin.setAttribute('transform', `translate(0, 6.4) rotate(${pose.backKnee.toFixed(1)})`);

  fig.frontArm.setAttribute('transform', `translate(3.6, -9.8) rotate(${pose.frontArm.toFixed(1)})`);
  fig.frontForearm.setAttribute('transform', `translate(0, 5.2) rotate(${(-pose.frontElbow).toFixed(1)})`);
  fig.backArm.setAttribute('transform', `translate(-3.4, -9.8) rotate(${pose.backArm.toFixed(1)})`);
  fig.backForearm.setAttribute('transform', `translate(0, 5.2) rotate(${(-pose.backElbow).toFixed(1)})`);

  // Keep chest jersey number readable (un-mirrored if facing left)
  fig.jerseyTxt.textContent = opts.jerseyLabel;
  fig.jerseyTxt.setAttribute('transform', safeFace < 0 ? 'scale(-1, 1)' : '');

  if (opts.showTag && opts.tagLabel) {
    const w = clampNum(opts.tagLabel.length * 4.4 + 12, 24, 62);
    fig.tagGroup.setAttribute('visibility', 'visible');
    fig.tagRect.setAttribute('x', (-w / 2).toFixed(1));
    fig.tagRect.setAttribute('width', w.toFixed(1));
    fig.tagText.textContent = opts.tagLabel;
  } else {
    fig.tagGroup.setAttribute('visibility', 'hidden');
  }
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
  private cameraAngle: CinematicCameraAngle = 'cinematic';
  private phase: TacticalPhaseId = 'attack';
  private activeScenarioId: string | null = null;
  private activeComparisonId: string | null = null;
  private comparisonVariant: ComparisonVariant = 'mistake';
  private scenarioCatFilter: string = 'الكل';
  private spotlightSlotIdx: number | null = null;
  private spotlightInfo: RoleSpotlightInfo | null = null;
  private is25D = true;
  private showTriangles = true;
  private showOpponents = true;
  private optionsDrawerOpen = false;
  private speedDrawerOpen = false;
  private focusMineOnly = false;
  private captainTab: CaptainToolTab = 'smart';
  private cachedArabicVoice: SpeechSynthesisVoice | null = null;

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

  // Live animation visual state (arrows, ball arc loft, spin & comet trail)
  private arrowRevealT = 1;
  private ballLift = 0;
  private ballShadowDy = 2;
  private ballScale = 1;
  private ballSpinDeg = 0;
  private ballTrailPath: string | null = null;

  // Cinematic 2.5D reusable SVG figurine DOM cache & smooth orientation tracking
  private cinCache: CinematicDomCache | null = null;
  private ourFacings: number[] = [];
  private oppFacings: number[] = [];
  private ourLocalTs: number[] = [];
  private oppLocalTs: number[] = [];
  private lastRawMoveWindowT = 1;

  // Live rendered coordinates (also mutated by drag & drop)
  private currentOur: Array<{ x: number; y: number }> = [];
  private currentOpp: Array<{ x: number; y: number }> = [];
  private currentBall: { x: number; y: number } = { x: 50, y: 50 };

  // Dragging state (with synchronous 2.5D -> 2D flattening protection)
  private dragTarget: { kind: 'our' | 'opp' | 'ball'; idx: number } | null = null;
  private dragStartClient = { x: 0, y: 0 };
  private dragMoved = false;
  private dragFlattened = false;

  private isInteractivePitchMode(): boolean {
    return this.viewMode === 'studio' || this.viewMode === 'cinematic';
  }

  // Custom plan recorder
  private isRecordingMode = false;
  private recordedFrames: TacticalKeyframe[] = [];

  // Rotation countdown timer
  private timerSecondsLeft = 12 * 60;
  private timerRunning = false;
  private timerIntervalId: number | null = null;

  // Full-Screen Pro Mode state (shares canonical currentOur/currentOpp/currentBall/sequence/prefs with zero state loss)
  private isProFullscreen = false;
  private proSection: ProSectionTab = 'formations';
  private proTool: ProBoardTool = 'pointer';
  private proZoomPct = 100;
  private proShowNames = true;
  private proShowNumbers = true;
  private proShowTacticalLines = true;
  private proAnnotations: ProAnnotation[] = [];
  private proDraftAnnotation: ProAnnotation | null = null;
  private proHistory: ProHistoryState = createHistoryState(30);
  private proMobileDrawer: 'none' | 'left' | 'right' = 'none';
  private proSettingsOpen = false;
  private proLibraryOpen = false;
  private proDrawStartPortrait: { x: number; y: number } | null = null;
  private proDragSnapshotTaken = false;
  private activeBoardOverlaySvg: SVGSVGElement | null = null;
  private nativeViewportAnchors = new Map<string, { parent: HTMLElement; nextSibling: Node | null }>();

  // Tactical Intelligence Lab state (100% browser-local, zero Firestore)
  private xrayEnabled = false;
  private xrayBaseline: TacticalEvaluation | null = null;
  private pitWallCtrl: PitWallRotationController | null = null;

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

    // Respect initial Data Saver or OS prefers-reduced-motion
    if (this.isMotionReduced()) {
      this.is25D = false;
    }
    this.timerSecondsLeft = this.prefs.rotationInterval * 60;

    // Warm up Arabic SpeechSynthesis voice list safely (handles async browser voice loading)
    this.initSpeechVoices();

    // Listen to live OS-level prefers-reduced-motion changes
    if (typeof window !== 'undefined' && window.matchMedia) {
      try {
        const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
        const onReducedChange = () => {
          if (mq.matches) {
            this.is25D = false;
            this.pause();
          }
          this.renderPitchShellClasses();
          this.renderToolbarState();
          this.renderSvgPitch();
        };
        if (typeof mq.addEventListener === 'function') mq.addEventListener('change', onReducedChange);
        else if (typeof mq.addListener === 'function') mq.addListener(onReducedChange);
      } catch {
        // Ignore matchMedia listener errors in legacy browsers
      }
    }

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
        if (!this.activeScenarioId && !this.activeComparisonId && this.spotlightSlotIdx === null) {
          this.loadCurrentPhaseSequence(false);
        }
      }
    }
    this.pitWallCtrl?.syncRoster();
    this.renderAll();
  }

  public onDataSaverChanged(isDataSaver: boolean): void {
    if (isDataSaver) {
      this.is25D = false;
      this.pause();
    }
    this.renderPitchShellClasses();
    this.renderToolbarState();
    this.renderSvgPitch();
  }

  public onTabDeactivated(): void {
    this.pause();
    this.stopSpeech();
    if (this.isProFullscreen) {
      this.exitProFullscreen();
    }
  }

  public isProFullscreenActive(): boolean {
    return this.isProFullscreen;
  }

  public enterProFullscreen(): void {
    const overlay = document.getElementById('tacFullscreenOverlay');
    if (!overlay) return;
    this.isProFullscreen = true;
    this.proMobileDrawer = 'none';
    this.proSettingsOpen = false;
    this.proLibraryOpen = false;
    overlay.classList.remove('hidden');
    overlay.setAttribute('aria-hidden', 'false');
    document.body.classList.add('tac-pro-fullscreen-open');
    this.renderAll();
  }

  public exitProFullscreen(): void {
    const overlay = document.getElementById('tacFullscreenOverlay');
    this.isProFullscreen = false;
    this.proMobileDrawer = 'none';
    this.proSettingsOpen = false;
    this.proLibraryOpen = false;
    this.proDraftAnnotation = null;
    this.proDrawStartPortrait = null;
    this.restoreNativeViewports();
    if (overlay) {
      overlay.classList.add('hidden');
      overlay.setAttribute('aria-hidden', 'true');
    }
    document.body.classList.remove('tac-pro-fullscreen-open');
    this.renderAll();
  }

  private restoreNativeViewports(): void {
    (['tacStudioViewport', 'tacPosterViewport', 'tacFifaViewport'] as const).forEach((id) => {
      const el = document.getElementById(id);
      const anchor = this.nativeViewportAnchors.get(id);
      if (el && anchor && el.parentElement !== anchor.parent) {
        if (anchor.nextSibling && anchor.nextSibling.parentNode === anchor.parent) {
          anchor.parent.insertBefore(el, anchor.nextSibling);
        } else {
          anchor.parent.appendChild(el);
        }
      }
    });
    const pitchStage = document.getElementById('tacPitchStage');
    if (pitchStage) {
      pitchStage.style.transform = '';
      delete pitchStage.dataset.tool;
    }
    (['tacPosterField', 'tacFifaField'] as const).forEach((fid) => {
      const fel = document.getElementById(fid);
      if (fel) {
        fel.style.transform = '';
        delete fel.dataset.tool;
      }
    });
    (['tacPosterOverlaySvg', 'tacFifaOverlaySvg'] as const).forEach((oid) => {
      const oel = document.getElementById(oid);
      if (oel) {
        oel.classList.add('hidden');
        oel.classList.remove('is-interactive', 'is-passive');
        oel.innerHTML = '';
      }
    });
    this.activeBoardOverlaySvg = null;
    const host = document.getElementById('tacProNativeHost');
    if (host) host.classList.add('hidden');
    const wrap = document.getElementById('tacProPitchCanvasWrap');
    if (wrap) wrap.classList.remove('hidden');
  }

  private syncProViewModeHost(): void {
    if (!this.isProFullscreen) {
      this.restoreNativeViewports();
      return;
    }
    const host = document.getElementById('tacProNativeHost');
    const wrap = document.getElementById('tacProPitchCanvasWrap');
    const caption = document.getElementById('tacProLiveCaption');
    const stage = document.getElementById('tacProStage');
    if (!host || !wrap) return;

    if (stage) {
      stage.dataset.proView = this.viewMode;
    }

    if (this.viewMode === 'studio') {
      this.restoreNativeViewports();
      return;
    }

    // Re-host ONLY the exact original active viewport (cinematic -> #tacStudioViewport, fifa -> #tacFifaViewport, poster -> #tacPosterViewport)
    const targetId =
      this.viewMode === 'cinematic'
        ? 'tacStudioViewport'
        : this.viewMode === 'fifa'
        ? 'tacFifaViewport'
        : 'tacPosterViewport';

    (['tacStudioViewport', 'tacPosterViewport', 'tacFifaViewport'] as const).forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      if (!this.nativeViewportAnchors.has(id) && el.parentElement) {
        this.nativeViewportAnchors.set(id, { parent: el.parentElement, nextSibling: el.nextSibling });
      }
      if (id === targetId) {
        if (el.parentElement !== host) {
          host.appendChild(el);
        }
        el.classList.remove('hidden');
      } else {
        const anchor = this.nativeViewportAnchors.get(id);
        if (anchor && el.parentElement !== anchor.parent) {
          if (anchor.nextSibling && anchor.nextSibling.parentNode === anchor.parent) {
            anchor.parent.insertBefore(el, anchor.nextSibling);
          } else {
            anchor.parent.appendChild(el);
          }
        }
      }
    });

    wrap.classList.add('hidden');
    if (caption) caption.classList.add('hidden');
    host.classList.remove('hidden');
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
    this.activeComparisonId = null;
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
    this.activeComparisonId = null;
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
    if (this.viewMode !== 'cinematic') this.viewMode = 'studio';
    this.prefs.size = '6v6';
    this.activeScenarioId = sc.id;
    this.activeComparisonId = null;
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

  private enterComparisonMode(compId?: string, variant: ComparisonVariant = 'mistake'): void {
    const comp = compId ? getComparisonById(compId) : findDefaultComparisonForPhase(this.phase);
    this.pause();
    if (this.viewMode !== 'cinematic') this.viewMode = 'studio';
    this.prefs.size = '6v6';
    this.activeScenarioId = null;
    this.spotlightSlotIdx = null;
    this.spotlightInfo = null;
    this.optionsDrawerOpen = false;
    this.activeComparisonId = comp.id;
    this.comparisonVariant = variant;
    this.setActiveSequence(buildComparisonSequence(comp, variant));
    this.renderAll();
    if (!this.isMotionReduced()) {
      this.play();
    }
    const pitchEl = document.getElementById('tacStudioViewport');
    if (pitchEl) pitchEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  private setComparisonVariant(variant: ComparisonVariant): void {
    if (!this.activeComparisonId) return;
    const comp = getComparisonById(this.activeComparisonId);
    this.pause();
    this.comparisonVariant = variant;
    this.setActiveSequence(buildComparisonSequence(comp, variant));
    this.renderAll();
    if (!this.isMotionReduced()) {
      this.play();
    }
  }

  private exitComparisonMode(): void {
    if (!this.activeComparisonId) return;
    this.activeComparisonId = null;
    this.loadCurrentPhaseSequence(false);
    this.renderAll();
  }

  private enterRoleSpotlight(slotIdx: number): void {
    this.pause();
    const formId = this.getCurrentFormationId();
    this.activeScenarioId = null;
    this.activeComparisonId = null;
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
    this.ourLocalTs = f.ourPos.map(() => 1);
    this.oppLocalTs = f.oppPos.map(() => 1);
    this.lastRawMoveWindowT = 1;
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

    const segStart = this.timelineMetrics.segmentStarts[sample.frameIdx] || 0;
    const segDur = Math.max(1, this.timelineMetrics.segmentDurations[sample.frameIdx] || 2500);
    const localMs = Math.max(0, Math.min(segDur, sample.elapsedMs - segStart));
    const moveWindowMs = Math.min(950, segDur * 0.44);
    const rawWindowT = sample.frameIdx === 0 ? 1 : Math.min(1, localMs / Math.max(1, moveWindowMs));
    this.lastRawMoveWindowT = reduced ? 1 : rawWindowT;

    const effMoveT = reduced ? 1 : sample.moveT;
    this.arrowRevealT = reduced ? 1 : sample.arrowRevealT;

    // Staggered collective movement via deterministic per-actor delayMs inside the single rAF timeline
    if (this.viewMode === 'cinematic' && !reduced && sample.frameIdx > 0) {
      const activeSet = new Set(targetFrame.activeIndices || []);
      const ourTs: number[] = [];
      this.currentOur = targetFrame.ourPos.map((tp, i) => {
        const fp = prevFrame.ourPos[i] || tp;
        const distBall = Math.hypot(fp.x - prevFrame.ball.x, fp.y - prevFrame.ball.y);
        const delayMs = computeActorDelayMs(true, i, activeSet, distBall, this.phase);
        const dur = Math.max(220, moveWindowMs - delayMs * 0.55);
        const t = easeCubic(clampNum((localMs - delayMs) / dur, 0, 1));
        ourTs.push(t);
        return { x: fp.x + (tp.x - fp.x) * t, y: fp.y + (tp.y - fp.y) * t };
      });
      const oppTs: number[] = [];
      this.currentOpp = targetFrame.oppPos.map((tp, i) => {
        const fp = prevFrame.oppPos[i] || tp;
        const distBall = Math.hypot(fp.x - prevFrame.ball.x, fp.y - prevFrame.ball.y);
        const delayMs = computeActorDelayMs(false, i, activeSet, distBall, this.phase);
        const dur = Math.max(220, moveWindowMs - delayMs * 0.5);
        const t = easeCubic(clampNum((localMs - delayMs) / dur, 0, 1));
        oppTs.push(t);
        return { x: fp.x + (tp.x - fp.x) * t, y: fp.y + (tp.y - fp.y) * t };
      });
      this.ourLocalTs = ourTs;
      this.oppLocalTs = oppTs;
    } else {
      this.currentOur = interpolatePoints(prevFrame.ourPos, targetFrame.ourPos, effMoveT);
      this.currentOpp = interpolatePoints(prevFrame.oppPos, targetFrame.oppPos, effMoveT);
      this.ourLocalTs = targetFrame.ourPos.map(() => effMoveT);
      this.oppLocalTs = targetFrame.oppPos.map(() => effMoveT);
    }

    // Ball trajectory synced to passer's kick contact in Cinematic View + visual rotation spin
    const ballDist = Math.hypot(targetFrame.ball.x - prevFrame.ball.x, targetFrame.ball.y - prevFrame.ball.y);
    const kickWindup = this.viewMode === 'cinematic' && ballDist >= 8 ? 0.14 : 0;
    const ballMoveT =
      kickWindup > 0
        ? easeCubic(clampNum((rawWindowT - kickWindup) / Math.max(0.1, 0.84 - kickWindup), 0, 1))
        : effMoveT;

    if (reduced || sample.frameIdx === 0 || ballMoveT >= 0.999) {
      this.currentBall = { ...targetFrame.ball };
      this.ballLift = 0;
      this.ballShadowDy = 2;
      this.ballScale = 1;
      this.ballTrailPath = null;
    } else {
      const arc = evalBallArc(prevFrame.ball, targetFrame.ball, ballMoveT);
      this.currentBall = { x: arc.x, y: arc.y };
      this.ballLift = arc.lift;
      this.ballShadowDy = arc.shadowDy;
      this.ballScale = arc.scale;
      this.ballSpinDeg = (ballMoveT * ballDist * 14) % 360;
      if (ballDist >= 8 && ballMoveT > 0.03) {
        const useLandscapeTrail = this.isProFullscreen && this.viewMode === 'cinematic';
        const pStart = useLandscapeTrail
          ? portraitPctToProSvg(prevFrame.ball)
          : { x: toSvgX(prevFrame.ball.x), y: toSvgY(prevFrame.ball.y) };
        const pCtrl = useLandscapeTrail
          ? portraitPctToProSvg({ x: arc.ctrlX, y: arc.ctrlY })
          : { x: toSvgX(arc.ctrlX), y: toSvgY(arc.ctrlY) };
        const pEnd = useLandscapeTrail
          ? portraitPctToProSvg(targetFrame.ball)
          : { x: toSvgX(targetFrame.ball.x), y: toSvgY(targetFrame.ball.y) };
        this.ballTrailPath = buildPartialQuadPath(
          pStart.x,
          pStart.y,
          pCtrl.x,
          pCtrl.y,
          pEnd.x,
          pEnd.y,
          ballMoveT
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

  private initSpeechVoices(): void {
    if (!this.isSpeechSupported()) return;
    const refresh = () => {
      try {
        const voices = window.speechSynthesis.getVoices ? window.speechSynthesis.getVoices() : [];
        this.cachedArabicVoice = pickBestArabicVoice(voices);
      } catch {
        this.cachedArabicVoice = null;
      }
    };
    refresh();
    try {
      if (typeof window.speechSynthesis.addEventListener === 'function') {
        window.speechSynthesis.addEventListener('voiceschanged', refresh);
      } else {
        window.speechSynthesis.onvoiceschanged = refresh;
      }
    } catch {
      // Some webviews expose read-only speechSynthesis
    }
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
    const cleanText = prepareArabicNarrationText(text);
    if (!this.isSpeechSupported() || !cleanText) {
      onComplete?.();
      return;
    }
    try {
      const utter = new SpeechSynthesisUtterance(cleanText);
      const voices = window.speechSynthesis.getVoices ? window.speechSynthesis.getVoices() : [];
      const arVoice = this.cachedArabicVoice || pickBestArabicVoice(voices);
      if (arVoice) {
        this.cachedArabicVoice = arVoice;
        utter.voice = arVoice;
        utter.lang = arVoice.lang || 'ar-SA';
      } else {
        utter.lang = 'ar-SA';
      }
      utter.rate = computeSpeechRate(this.speed);
      utter.pitch = 1.0;

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
      this.speechSafetyTimer = window.setTimeout(done, estimateSpeechTimeoutMs(cleanText, utter.rate));
      window.speechSynthesis.speak(utter);
    } catch {
      onComplete?.();
    }
  }

  // ==================== POINTER DRAG-AND-DROP BOARD (WITH 2.5D TOUCH FLATTENING) ====================

  private getSvgPointFromEvent(svg: SVGSVGElement, e: PointerEvent): { x: number; y: number } {
    if (this.isProFullscreen && this.viewMode === 'cinematic') {
      return projectProClientToPortraitPct(e.clientX, e.clientY, svg.getBoundingClientRect());
    }
    return projectClientToPitchPct(e.clientX, e.clientY, svg.getBoundingClientRect(), SVG_W, SVG_H);
  }

  private handlePointerDown = (e: PointerEvent): void => {
    const svg = document.getElementById('tacPitchSvg') as unknown as SVGSVGElement | null;
    if (!svg) return;

    // In Full-Screen Cinematic mode, honor all drawing / stamp / erase tools directly on #tacPitchSvg
    if (
      this.isProFullscreen &&
      this.viewMode === 'cinematic' &&
      shouldBoardOverlayInterceptPointer(this.isProFullscreen, this.proTool)
    ) {
      if (
        this.handleProOverlayToolPointerDown(svg, e, () => {
          this.renderCinematicPitch();
        })
      ) {
        return;
      }
    }

    const target = (e.target as Element | null)?.closest('[data-drag-kind]') as HTMLElement | SVGElement | null;
    if (!target) return;
    const kind = target.getAttribute('data-drag-kind') as 'our' | 'opp' | 'ball' | null;
    const idx = Number(target.getAttribute('data-drag-idx') || '0');
    if (!kind) return;

    this.pause();
    this.ballLift = 0;
    this.ballShadowDy = 2;
    this.ballScale = 1;
    this.ballTrailPath = null;
    this.dragTarget = { kind, idx };
    this.dragStartClient = { x: e.clientX, y: e.clientY };
    this.dragMoved = false;
    this.proDragSnapshotTaken = false;

    // Capture baseline evaluation before drag so Dominance X-Ray emits true comparative move badges
    if (this.xrayEnabled && this.currentOur.length >= 2) {
      this.xrayBaseline = computeDominanceXRay({
        size: this.prefs.size,
        our: this.currentOur,
        opp: this.currentOpp,
        ball: this.currentBall,
      }).evaluation;
    }

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
    const svg = document.getElementById('tacPitchSvg') as unknown as SVGSVGElement | null;
    if (
      this.proDraftAnnotation &&
      this.proDrawStartPortrait &&
      this.isProFullscreen &&
      this.viewMode === 'cinematic' &&
      svg
    ) {
      const pt = projectProClientToPortraitPct(e.clientX, e.clientY, svg.getBoundingClientRect());
      this.proDraftAnnotation = {
        ...this.proDraftAnnotation,
        x2: pt.x,
        y2: pt.y,
      };
      this.renderCinematicPitch();
      return;
    }

    if (!this.dragTarget) return;
    const dist = Math.hypot(e.clientX - this.dragStartClient.x, e.clientY - this.dragStartClient.y);
    if (dist > 6) this.dragMoved = true;
    if (!this.dragMoved) return;
    if (!this.proDragSnapshotTaken) {
      this.pushCurrentBoardHistory();
      this.proDragSnapshotTaken = true;
    }

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
    const svg = document.getElementById('tacPitchSvg') as unknown as SVGSVGElement | null;
    if (
      this.proDraftAnnotation &&
      this.isProFullscreen &&
      this.viewMode === 'cinematic'
    ) {
      if (svg) {
        try {
          svg.releasePointerCapture(e.pointerId);
        } catch {
          // ignore
        }
      }
      const fin = this.proDraftAnnotation;
      this.proDraftAnnotation = null;
      this.proDrawStartPortrait = null;
      this.activeBoardOverlaySvg = null;
      if (Math.hypot(fin.x2 - fin.x1, fin.y2 - fin.y1) >= 2.2) {
        this.pushCurrentBoardHistory();
        this.proAnnotations.push({
          ...fin,
          id: 'ann_' + Date.now() + '_' + Math.floor(Math.random() * 999),
        });
      }
      this.renderCinematicPitch();
      this.renderProControlsState();
      return;
    }

    if (!this.dragTarget) return;
    const released = this.dragTarget;
    const wasDrag = this.dragMoved;
    this.dragTarget = null;
    this.dragMoved = false;

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
    if (!wasDrag && released.kind === 'our' && (!this.isProFullscreen || this.proTool === 'pointer')) {
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
    this.activeComparisonId = null;
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
    this.activeComparisonId = null;
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

  public async shareLineupOnWhatsApp(): Promise<void> {
    if (!this.ctx) return;
    const form = this.getCurrentFormation();
    const assigned = this.getAssignedPlayersForCurrentFormation();
    const settings = this.ctx.getTeamSettings();
    const teamName = settings.teamName || 'فريق السداسي';
    const lines = [
      `⚽ *تشكيلة ${teamName} (${form.name})*`,
      ...form.slots.map((s, idx) => {
        const pl = assigned[idx];
        return `• ${s.label}: ${pl ? `${pl.name}${pl.jersey ? ` (#${pl.jersey})` : ''}` : 'غير محدد'}`;
      }),
      '— عبر تطبيق ميدان 6v6 🏆',
    ];
    const text = lines.join('\n');
    await this.exportLineupPosterPng();
    const a = document.createElement('a');
    a.href = `https://wa.me/?text=${encodeURIComponent(text)}`;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.click();
  }

  public getCurrentLineupPayload(): { formation: string; slots: Record<string, string> } {
    const form = this.getCurrentFormation();
    const t = this.ctx?.getTactics() || { formation: form.id, slots: {} };
    return {
      formation: form.id,
      slots: { ...(t.slots || {}) },
    };
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

    const realOvrs = assigned
      .map((pl) => {
        if (!pl) return null;
        const ovr = this.ctx?.getPlayerOvr ? this.ctx.getPlayerOvr(pl) : null;
        return typeof ovr === 'number' && Number.isFinite(ovr) ? Math.round(ovr) : computePlayerOvr(pl);
      })
      .filter((v): v is number => typeof v === 'number' && v > 0);
    const posterAvgOvr = realOvrs.length
      ? Math.round(realOvrs.reduce((a, b) => a + b, 0) / realOvrs.length)
      : chem.avgOvr;

    c.fillStyle = '#fde68a';
    c.font = '700 22px system-ui, "Segoe UI", Tahoma, Arial, sans-serif';
    c.fillText(
      isolateLtrTokens(`الخطة: ${form.name} (${this.prefs.size})  •  تقييم ${posterAvgOvr || '--'}  •  تناغم ${chem.totalPct}%`),
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
      const rx = cx - boxW / 2;
      const ry = cy + avatarR + 8;
      if (typeof c.roundRect === 'function') {
        c.roundRect(rx, ry, boxW, 34, 10);
      } else {
        c.rect(rx, ry, boxW, 34);
      }
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
    c.fillText(isolateLtrTokens('ميدان 6v6 — النسخة الملكية  •  الاستوديو التكتيكي الشامل'), W / 2, H - 62);

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
    this.renderComparisonBanner();
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
    if (this.isProFullscreen) {
      this.renderProFullscreenOverlay();
    }
  }

  private renderComparisonBanner(): void {
    const banner = document.getElementById('tacCompareBanner');
    if (!banner) return;
    if (!this.activeComparisonId || !this.isInteractivePitchMode()) {
      banner.classList.add('hidden');
      banner.classList.remove('is-mistake', 'is-correct');
      return;
    }

    const comp = getComparisonById(this.activeComparisonId);
    const side = this.comparisonVariant === 'mistake' ? comp.mistake : comp.correct;

    banner.classList.remove('hidden');
    banner.classList.toggle('is-mistake', this.comparisonVariant === 'mistake');
    banner.classList.toggle('is-correct', this.comparisonVariant === 'correct');

    const pills = TACTICAL_COMPARISONS_6V6.map(
      (c) => `<button type="button" data-cmp-id="${escapeHtml(c.id)}" class="tac-compare-pill ${c.id === comp.id ? 'active' : ''}">${c.icon} ${escapeHtml(c.shortLabel)}</button>`
    ).join('');

    banner.innerHTML = `
      <div class="row between" style="margin-bottom:6px;gap:6px;">
        <strong style="font-size:0.8rem;color:${this.comparisonVariant === 'mistake' ? '#fb923c' : '#4ade80'};">
          ⚖️ مقارنة تعليمية — ${escapeHtml(comp.title)}
        </strong>
        <button type="button" id="btnTacCompareClose" class="tac-callout-toggle-btn" style="width:auto;padding:0 8px;min-height:30px;font-size:0.7rem;" title="إنهاء وضع المقارنة">✕ إنهاء</button>
      </div>
      <div class="tac-compare-pills" role="tablist" aria-label="اختر الموقف التكتيكي للمقارنة">
        ${pills}
      </div>
      <div class="tac-compare-seg" role="group" aria-label="تبديل بين الخطأ الشائع والتصحيح التكتيكي">
        <button type="button" data-cmp-variant="mistake" class="tac-compare-variant-btn is-mistake ${this.comparisonVariant === 'mistake' ? 'active' : ''}" aria-pressed="${this.comparisonVariant === 'mistake'}">
          ⚠️ الخطأ الشائع
        </button>
        <button type="button" data-cmp-variant="correct" class="tac-compare-variant-btn is-correct ${this.comparisonVariant === 'correct' ? 'active' : ''}" aria-pressed="${this.comparisonVariant === 'correct'}">
          ✓ الصحيح التكتيكي
        </button>
      </div>
      <div class="tac-compare-verdict">${formatFormationHtml(side.verdict)}</div>
      <div class="tac-compare-rule">💡 ${formatFormationHtml(comp.quickRule)}</div>
    `;
  }

  private renderScenarioGuideCard(): void {
    const box = document.getElementById('tacScenarioGuideBox');
    if (!box) return;
    const sc = this.activeScenarioId
      ? TACTICAL_SCENARIOS_10.find((s) => s.id === this.activeScenarioId)
      : null;
    if (!sc || !sc.guide || !this.isInteractivePitchMode()) {
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
    const camBar = document.getElementById('tacCameraBar');
    if (camBar) {
      camBar.classList.toggle('hidden', this.viewMode !== 'cinematic');
    }
    const effectiveCam: CinematicCameraAngle = this.isMotionReduced() ? 'top' : this.cameraAngle;
    document.querySelectorAll<HTMLButtonElement>('[data-tac-cam]').forEach((btn) => {
      const isAct = btn.dataset.tacCam === effectiveCam;
      btn.classList.toggle('active', isAct);
      btn.setAttribute('aria-pressed', String(isAct));
    });
  }

  private renderPhaseButtons(): void {
    const showPhases = this.isInteractivePitchMode();
    const bar = document.getElementById('tacPhaseBar');
    if (bar) bar.classList.toggle('hidden', !showPhases);

    document.querySelectorAll<HTMLButtonElement>('[data-tac-phase]').forEach((btn) => {
      const isActive =
        !this.activeScenarioId &&
        !this.activeComparisonId &&
        this.spotlightSlotIdx === null &&
        btn.dataset.tacPhase === this.phase;
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
      const reduced = this.isMotionReduced();
      btn25.textContent = saver
        ? '2D (توفير)'
        : reduced
        ? '2D (حركة مخفضة)'
        : this.is25D
        ? 'منظور 2.5D مائل'
        : 'منظور 2D مسطّح';
      btn25.classList.toggle('active', this.is25D && !reduced);
    }
    const btnTri = document.getElementById('btnTacTriangles');
    if (btnTri) btnTri.classList.toggle('active', this.showTriangles);
    const btnOpp = document.getElementById('btnTacOpponents');
    if (btnOpp) btnOpp.classList.toggle('active', this.showOpponents);
    const btnRec = document.getElementById('btnTacRecordMode');
    if (btnRec) btnRec.classList.toggle('active', this.isRecordingMode);

    const btnCmp = document.getElementById('btnTacCompareMode');
    if (btnCmp) {
      const cmpActive = this.activeComparisonId !== null;
      btnCmp.classList.toggle('active', cmpActive);
      btnCmp.setAttribute('aria-pressed', String(cmpActive));
    }

    const btnXray = document.getElementById('btnTacXray');
    if (btnXray) {
      btnXray.classList.toggle('active', this.xrayEnabled);
      btnXray.setAttribute('aria-pressed', String(this.xrayEnabled));
    }
    const btnProXray = document.getElementById('btnTacProXray');
    if (btnProXray) {
      btnProXray.classList.toggle('active', this.xrayEnabled);
      btnProXray.setAttribute('aria-pressed', String(this.xrayEnabled));
    }
    const btnDockXray = document.querySelector<HTMLButtonElement>('[data-lab-quick="xray"]');
    if (btnDockXray) {
      btnDockXray.classList.toggle('active', this.xrayEnabled);
      btnDockXray.setAttribute('aria-pressed', String(this.xrayEnabled));
    }
    const btnAccXray = document.getElementById('btnOpenXrayFromLab');
    if (btnAccXray) {
      btnAccXray.style.borderColor = this.xrayEnabled ? 'rgba(250, 204, 21, 0.9)' : '';
      btnAccXray.setAttribute('aria-pressed', String(this.xrayEnabled));
    }
  }

  private renderPitchShellClasses(): void {
    const stage = document.getElementById('tacPitchStage');
    if (!stage) return;
    const reduced = this.isMotionReduced();
    const isCin = this.viewMode === 'cinematic';
    const effectiveCam: CinematicCameraAngle = reduced ? 'top' : this.cameraAngle;
    const tilt = isCin
      ? effectiveCam !== 'top'
      : this.is25D && !reduced && this.viewMode === 'studio';

    stage.classList.toggle('is-cinematic', isCin);
    stage.classList.toggle('cam-cinematic', isCin && effectiveCam === 'cinematic');
    stage.classList.toggle('cam-top', isCin && effectiveCam === 'top');
    stage.classList.toggle('cam-wide', isCin && effectiveCam === 'wide');
    stage.classList.toggle('pitch-25d', !isCin && tilt);
    stage.classList.toggle('pitch-2d', !isCin && !tilt);
    stage.classList.toggle('pitch-drag-flat', this.dragFlattened);
    stage.classList.toggle('pitch-dragging', this.dragFlattened);
  }

  private renderActiveViewBody(): void {
    const studioPanel = document.getElementById('tacStudioViewport');
    const posterPanel = document.getElementById('tacPosterViewport');
    const fifaPanel = document.getElementById('tacFifaViewport');
    const timelineWrap = document.getElementById('tacTimelineWrap');

    const interactive = this.isInteractivePitchMode();
    studioPanel?.classList.toggle('hidden', !interactive);
    timelineWrap?.classList.toggle('hidden', !interactive);
    posterPanel?.classList.toggle('hidden', this.viewMode !== 'poster');
    fifaPanel?.classList.toggle('hidden', this.viewMode !== 'fifa');

    if (interactive) {
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

  private ensureCinematicDomCache(
    svg: SVGSVGElement,
    ourCount: number,
    oppCount: number,
    reduced: boolean,
    isLandscape: boolean
  ): CinematicDomCache {
    const signature = `${ourCount}_${oppCount}_${reduced ? 1 : 0}_${this.prefs.size}_${isLandscape ? 'L' : 'P'}`;
    const canvasW = isLandscape ? PRO_SVG_W : SVG_W;
    const canvasH = isLandscape ? PRO_SVG_H : SVG_H;
    const expectedViewBox = `0 0 ${canvasW} ${canvasH}`;
    if (svg.getAttribute('viewBox') !== expectedViewBox) {
      svg.setAttribute('viewBox', expectedViewBox);
    }
    if (this.cinCache && this.cinCache.signature === signature && svg.contains(this.cinCache.actorsLayer)) {
      return this.cinCache;
    }

    const grassUrl = reduced || isLandscape ? '' : getCachedGrassTextureUrl();
    const turfBg = isLandscape
      ? `<rect x="0" y="0" width="${PRO_SVG_W}" height="${PRO_SVG_H}" rx="16" fill="url(#turfGrad)"/>
         ${Array.from({ length: 12 }, (_, i) => {
           const sw = (PRO_SVG_W - 96) / 12;
           return i % 2 === 0
             ? `<rect x="${(48 + i * sw).toFixed(1)}" y="30" width="${sw.toFixed(1)}" height="${PRO_SVG_H - 60}" fill="rgba(255,255,255,0.048)"/>`
             : '';
         }).join('')}
         <rect x="0" y="0" width="${PRO_SVG_W}" height="${PRO_SVG_H}" rx="16" fill="url(#cinLandVignette)" pointer-events="none"/>`
      : grassUrl
      ? `<image href="${grassUrl}" x="0" y="0" width="${SVG_W}" height="${SVG_H}" preserveAspectRatio="none" clip-path="url(#pitchClip)"/>`
      : `<rect x="0" y="0" width="${SVG_W}" height="${SVG_H}" rx="14" fill="url(#turfGrad)"/>
         ${Array.from({ length: 10 }, (_, i) => (i % 2 === 0 ? `<rect x="14" y="${16 + i * 48.8}" width="${SVG_W - 28}" height="48.8" fill="rgba(255,255,255,0.045)"/>` : '')).join('')}`;

    const floodlightCones = reduced
      ? ''
      : isLandscape
      ? `<g pointer-events="none" clip-path="url(#pitchClip)">
          <polygon points="0,0 240,0 380,290 0,210" fill="url(#cinFloodLeft)"/>
          <polygon points="${PRO_SVG_W},0 ${PRO_SVG_W - 240},0 ${PRO_SVG_W - 380},290 ${PRO_SVG_W},210" fill="url(#cinFloodRight)"/>
          <ellipse cx="${PRO_SVG_W / 2}" cy="18" rx="300" ry="74" fill="url(#cinFloodTop)"/>
        </g>`
      : `<g pointer-events="none" clip-path="url(#pitchClip)">
          <polygon points="0,0 135,0 240,260 0,190" fill="url(#cinFloodLeft)"/>
          <polygon points="${SVG_W},0 ${SVG_W - 135},0 ${SVG_W - 240},260 ${SVG_W},190" fill="url(#cinFloodRight)"/>
          <ellipse cx="${SVG_W / 2}" cy="24" rx="150" ry="62" fill="url(#cinFloodTop)"/>
        </g>`;

    const pitchMarkings = isLandscape
      ? `<g stroke="#e5c158" stroke-opacity="0.86" stroke-width="1.8" fill="none" pointer-events="none">
          <rect x="48" y="30" width="764" height="460" rx="3"/>
          <line x1="430" y1="30" x2="430" y2="490"/>
          <circle cx="430" cy="260" r="64"/>
          <circle cx="430" cy="260" r="3.4" fill="#fde047" stroke="none"/>
          <rect x="48" y="138" width="122" height="244"/>
          <rect x="48" y="198" width="46" height="124"/>
          <path d="M 170 206 A 64 64 0 0 1 170 314"/>
          <circle cx="132" cy="260" r="2.8" fill="#fde047" stroke="none"/>
          <rect x="690" y="138" width="122" height="244"/>
          <rect x="766" y="198" width="46" height="124"/>
          <path d="M 690 206 A 64 64 0 0 0 690 314"/>
          <circle cx="728" cy="260" r="2.8" fill="#fde047" stroke="none"/>
          <path d="M 62 30 A 14 14 0 0 1 48 44"/>
          <path d="M 798 30 A 14 14 0 0 0 812 44"/>
          <path d="M 48 476 A 14 14 0 0 1 62 490"/>
          <path d="M 812 476 A 14 14 0 0 0 798 490"/>
          <rect x="24" y="216" width="24" height="88" rx="2" fill="url(#goalNetPat)" stroke="#fef9c3" stroke-width="2.1"/>
          <circle cx="48" cy="216" r="2.6" fill="#fef9c3" stroke="none"/>
          <circle cx="48" cy="304" r="2.6" fill="#fef9c3" stroke="none"/>
          <rect x="812" y="216" width="24" height="88" rx="2" fill="url(#goalNetPat)" stroke="#fef9c3" stroke-width="2.1"/>
          <circle cx="812" cy="216" r="2.6" fill="#fef9c3" stroke="none"/>
          <circle cx="812" cy="304" r="2.6" fill="#fef9c3" stroke="none"/>
        </g>`
      : `<g stroke="#e5c158" stroke-opacity="0.82" stroke-width="1.5" fill="none" pointer-events="none">
          <rect x="16" y="18" width="${SVG_W - 32}" height="${SVG_H - 36}" rx="3"/>
          <line x1="16" y1="${SVG_H / 2}" x2="${SVG_W - 16}" y2="${SVG_H / 2}"/>
          <circle cx="${SVG_W / 2}" cy="${SVG_H / 2}" r="42"/>
          <circle cx="${SVG_W / 2}" cy="${SVG_H / 2}" r="2.8" fill="#fde047" stroke="none"/>
          <rect x="86" y="18" width="${SVG_W - 172}" height="64"/>
          <rect x="130" y="18" width="${SVG_W - 260}" height="24"/>
          <path d="M 142 82 A 42 42 0 0 0 218 82"/>
          <circle cx="${SVG_W / 2}" cy="60" r="2.3" fill="#fde047" stroke="none"/>
          <rect x="86" y="${SVG_H - 82}" width="${SVG_W - 172}" height="64"/>
          <rect x="130" y="${SVG_H - 42}" width="${SVG_W - 260}" height="24"/>
          <path d="M 142 ${SVG_H - 82} A 42 42 0 0 1 218 ${SVG_H - 82}"/>
          <circle cx="${SVG_W / 2}" cy="${SVG_H - 60}" r="2.3" fill="#fde047" stroke="none"/>
          <path d="M 16 28 A 10 10 0 0 0 26 18"/>
          <path d="M ${SVG_W - 26} 18 A 10 10 0 0 0 ${SVG_W - 16} 28"/>
          <path d="M 16 ${SVG_H - 28} A 10 10 0 0 1 26 ${SVG_H - 18}"/>
          <path d="M ${SVG_W - 26} ${SVG_H - 18} A 10 10 0 0 1 ${SVG_W - 16} ${SVG_H - 28}"/>
          <rect x="142" y="5" width="76" height="13" rx="2" fill="url(#goalNetPat)" stroke="#fef9c3" stroke-width="2"/>
          <circle cx="142" cy="18" r="2.3" fill="#fef9c3" stroke="none"/>
          <circle cx="218" cy="18" r="2.3" fill="#fef9c3" stroke="none"/>
          <rect x="142" y="${SVG_H - 18}" width="76" height="13" rx="2" fill="url(#goalNetPat)" stroke="#fef9c3" stroke-width="1.8" stroke-opacity="0.72"/>
          <circle cx="142" cy="${SVG_H - 18}" r="2.1" fill="#fef9c3" stroke="none"/>
          <circle cx="218" cy="${SVG_H - 18}" r="2.1" fill="#fef9c3" stroke="none"/>
        </g>`;

    svg.innerHTML = `<defs>
      <clipPath id="pitchClip">
        <rect x="0" y="0" width="${canvasW}" height="${canvasH}" rx="${isLandscape ? 16 : 14}"/>
      </clipPath>
      <linearGradient id="turfGrad" x1="0" y1="0" x2="${isLandscape ? 1 : 0}" y2="${isLandscape ? 0.35 : 1}">
        <stop offset="0%" stop-color="#062811"/>
        <stop offset="50%" stop-color="#0f5b26"/>
        <stop offset="100%" stop-color="#041c0b"/>
      </linearGradient>
      <radialGradient id="cinLandVignette" cx="50%" cy="48%" r="68%">
        <stop offset="55%" stop-color="#000000" stop-opacity="0"/>
        <stop offset="100%" stop-color="#020b05" stop-opacity="0.42"/>
      </radialGradient>
      <linearGradient id="cinFloodLeft" x1="0%" y1="0%" x2="85%" y2="85%">
        <stop offset="0%" stop-color="#FEF9C3" stop-opacity="0.2"/>
        <stop offset="45%" stop-color="#FDE047" stop-opacity="0.06"/>
        <stop offset="100%" stop-color="#FDE047" stop-opacity="0"/>
      </linearGradient>
      <linearGradient id="cinFloodRight" x1="100%" y1="0%" x2="15%" y2="85%">
        <stop offset="0%" stop-color="#FEF9C3" stop-opacity="0.2"/>
        <stop offset="45%" stop-color="#FDE047" stop-opacity="0.06"/>
        <stop offset="100%" stop-color="#FDE047" stop-opacity="0"/>
      </linearGradient>
      <radialGradient id="cinFloodTop" cx="50%" cy="10%" r="75%">
        <stop offset="0%" stop-color="#FEFCE8" stop-opacity="0.22"/>
        <stop offset="100%" stop-color="#FEFCE8" stop-opacity="0"/>
      </radialGradient>
      <linearGradient id="cinGoldBody" x1="18%" y1="0%" x2="86%" y2="100%">
        <stop offset="0%" stop-color="#FFFBEB"/>
        <stop offset="28%" stop-color="#FDE047"/>
        <stop offset="68%" stop-color="#CA8A04"/>
        <stop offset="100%" stop-color="#713F12"/>
      </linearGradient>
      <linearGradient id="cinGoldLimb" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#FEF08A"/>
        <stop offset="52%" stop-color="#EAB308"/>
        <stop offset="100%" stop-color="#854D0E"/>
      </linearGradient>
      <radialGradient id="cinGoldHead" cx="35%" cy="28%" r="70%">
        <stop offset="0%" stop-color="#FFFBEB"/>
        <stop offset="46%" stop-color="#FACC15"/>
        <stop offset="100%" stop-color="#854D0E"/>
      </radialGradient>
      <linearGradient id="cinGoldShorts" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#78520b"/>
        <stop offset="55%" stop-color="#3b2806"/>
        <stop offset="100%" stop-color="#1a1204"/>
      </linearGradient>
      <linearGradient id="cinSilverBody" x1="18%" y1="0%" x2="86%" y2="100%">
        <stop offset="0%" stop-color="#F8FAFC"/>
        <stop offset="32%" stop-color="#CBD5E1"/>
        <stop offset="72%" stop-color="#64748B"/>
        <stop offset="100%" stop-color="#1E293B"/>
      </linearGradient>
      <linearGradient id="cinSilverLimb" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#E2E8F0"/>
        <stop offset="52%" stop-color="#94A3B8"/>
        <stop offset="100%" stop-color="#334155"/>
      </linearGradient>
      <radialGradient id="cinSilverHead" cx="35%" cy="28%" r="70%">
        <stop offset="0%" stop-color="#FFFFFF"/>
        <stop offset="48%" stop-color="#CBD5E1"/>
        <stop offset="100%" stop-color="#334155"/>
      </radialGradient>
      <linearGradient id="cinSilverShorts" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#475569"/>
        <stop offset="58%" stop-color="#1E293B"/>
        <stop offset="100%" stop-color="#0F172A"/>
      </linearGradient>
      <radialGradient id="goldHaloOuter" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="#fde047" stop-opacity="0.72"/>
        <stop offset="50%" stop-color="#FACC15" stop-opacity="0.24"/>
        <stop offset="100%" stop-color="#FACC15" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="oppAlertHalo" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="#fb923c" stop-opacity="0.62"/>
        <stop offset="100%" stop-color="#f97316" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="heatZoneGrad" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="#FACC15" stop-opacity="0.32"/>
        <stop offset="65%" stop-color="#EAB308" stop-opacity="0.12"/>
        <stop offset="100%" stop-color="#FACC15" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="footballGrad" cx="36%" cy="32%" r="68%">
        <stop offset="0%" stop-color="#ffffff"/>
        <stop offset="68%" stop-color="#e2e8f0"/>
        <stop offset="100%" stop-color="#94a3b8"/>
      </radialGradient>
      <linearGradient id="trailGoldGrad" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="#fde047" stop-opacity="0.04"/>
        <stop offset="52%" stop-color="#fde047" stop-opacity="0.46"/>
        <stop offset="100%" stop-color="#FEF9C3" stop-opacity="0.92"/>
      </linearGradient>
      <pattern id="goalNetPat" width="4.2" height="4.2" patternUnits="userSpaceOnUse">
        <path d="M 4.2 0 L 0 0 0 4.2" fill="none" stroke="rgba(255,255,255,0.52)" stroke-width="0.65"/>
      </pattern>
      <marker id="arrBall" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6.8" markerHeight="6.8" orient="auto-start-reverse">
        <path d="M 0 1 L 10 5 L 0 9 z" fill="#fde047"/>
      </marker>
      <marker id="arrRun" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6.6" markerHeight="6.6" orient="auto-start-reverse">
        <path d="M 0 1 L 10 5 L 0 9 z" fill="#fde047"/>
      </marker>
      <marker id="arrCover" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6.2" markerHeight="6.2" orient="auto-start-reverse">
        <path d="M 0 1 L 10 5 L 0 9 z" fill="#4ade80"/>
      </marker>
      ${buildProAnnotationsDefsSvg('cinAnn')}
    </defs>
    ${turfBg}
    ${floodlightCones}
    <text x="${canvasW / 2}" y="${canvasH / 2 + (isLandscape ? 8 : 5)}" text-anchor="middle" fill="#FEF08A" fill-opacity="0.06" font-size="${isLandscape ? 32 : 22}" font-weight="900" letter-spacing="${isLandscape ? 10 : 6}" pointer-events="none">MIDAN</text>
    ${pitchMarkings}
    <g id="cinDynamicBgLayer"></g>
    <g id="cinProAnnotationsLayer"></g>
    <g id="cinActorsLayer"></g>
    <g id="cinOverlayLayer" pointer-events="none"></g>`;

    const bgLayer = svg.querySelector('#cinDynamicBgLayer') as SVGGElement;
    const annotationsLayer = svg.querySelector('#cinProAnnotationsLayer') as SVGGElement;
    const actorsLayer = svg.querySelector('#cinActorsLayer') as SVGGElement;
    const overlayLayer = svg.querySelector('#cinOverlayLayer') as SVGGElement;

    const ourFigs: CinematicFigRefs[] = [];
    for (let i = 0; i < ourCount; i++) {
      const f = createArticulatedFigurineNode('gold', i);
      actorsLayer.appendChild(f.root);
      ourFigs.push(f);
    }
    const oppFigs: CinematicFigRefs[] = [];
    for (let i = 0; i < oppCount; i++) {
      const f = createArticulatedFigurineNode('silver', i);
      actorsLayer.appendChild(f.root);
      oppFigs.push(f);
    }
    const ball = createCinematicBallNode();
    actorsLayer.appendChild(ball.root);

    this.cinCache = { signature, bgLayer, annotationsLayer, actorsLayer, overlayLayer, ourFigs, oppFigs, ball };
    return this.cinCache;
  }

  private renderCinematicPitch(): void {
    const svg = document.getElementById('tacPitchSvg') as unknown as SVGSVGElement | null;
    if (!svg) return;

    const isLandscape = this.isProFullscreen;
    const canvasW = isLandscape ? PRO_SVG_W : SVG_W;
    const canvasH = isLandscape ? PRO_SVG_H : SVG_H;
    const mapPt = (pt: { x: number; y: number }): { x: number; y: number } =>
      isLandscape ? portraitPctToProSvg(pt) : { x: toSvgX(pt.x), y: toSvgY(pt.y) };

    const form = this.getCurrentFormation();
    const assigned = this.getAssignedPlayersForCurrentFormation();
    const frame = this.sequence.frames[this.frameIdx] || this.sequence.frames[0];
    const prevFrame = this.frameIdx > 0 ? this.sequence.frames[this.frameIdx - 1] : frame;
    const activeSet = new Set(frame?.activeIndices || []);
    const focusedUserIdx = this.focusMineOnly ? this.getFocusedUserSlotIdx() : null;
    const reduced = this.isMotionReduced();

    const minSepPct = this.prefs.size === '11v11' ? 7.6 : 9.4;
    const displayOpp =
      this.dragTarget?.kind === 'opp'
        ? this.currentOpp.map((p) => ({ ...p }))
        : deOverlapPositions(this.currentOur, this.currentOpp, minSepPct);
    const oppAlerts = computeOpponentAlertSet(displayOpp, this.currentBall, this.currentOur, frame?.zones);

    const cache = this.ensureCinematicDomCache(svg, this.currentOur.length, displayOpp.length, reduced, isLandscape);

    const ourSvgPts = this.currentOur.map((p) => mapPt(p));
    const oppSvgPts = displayOpp.map((p) => mapPt(p));
    const rawBallSvg = mapPt(this.currentBall);
    const isBallInFlight = this.ballLift > 0.04 || this.dragTarget?.kind === 'ball';
    const ballSvg = computeSmartBallDisplayPoint(
      rawBallSvg,
      ourSvgPts,
      oppSvgPts,
      isLandscape ? 17.5 : 13.5,
      isBallInFlight,
      canvasW,
      canvasH
    );
    const allTokenObstacles = [...ourSvgPts, ...oppSvgPts, ballSvg];

    // 1) Dynamic pitch tactical overlay layer (offside, zones, passing triangles, curved arrows, ball comet trail)
    const showTactical = !isLandscape || this.proShowTacticalLines;
    const bgParts: string[] = [];

    if (showTactical && this.sequence.offsideEnabled && displayOpp.length >= 3) {
      const sortedY = displayOpp.map((o) => o.y).sort((a, b) => a - b);
      if (isLandscape) {
        const offsideX = mapPt({ x: 50, y: sortedY[1] }).x;
        const badgeW = 114;
        const badgeX = Math.max(54, Math.min(PRO_SVG_W - 54 - badgeW, offsideX - badgeW / 2));
        bgParts.push(`<g class="tac-offside-line">
          <line x1="${offsideX.toFixed(1)}" y1="30" x2="${offsideX.toFixed(1)}" y2="490" stroke="#fb7185" stroke-width="2" stroke-dasharray="7 5"/>
          <rect x="${badgeX.toFixed(1)}" y="36" width="${badgeW}" height="18" rx="6" fill="rgba(136,19,55,0.92)" stroke="rgba(251,113,133,0.75)" stroke-width="1"/>
          <text x="${(badgeX + badgeW / 2).toFixed(1)}" y="48.5" text-anchor="middle" fill="#fff1f2" font-size="9.5" font-weight="800">${escapeHtml(isolateLtrTokens('خط التسلل (11v11)'))}</text>
        </g>`);
      } else {
        const offsideY = toSvgY(sortedY[1]);
        const badge = placeOffsideBadge(offsideY, oppSvgPts, SVG_W);
        bgParts.push(`<g class="tac-offside-line">
          <line x1="16" y1="${offsideY.toFixed(1)}" x2="${SVG_W - 16}" y2="${offsideY.toFixed(1)}" stroke="#fb7185" stroke-width="1.8" stroke-dasharray="6 4"/>
          <rect x="${badge.x.toFixed(1)}" y="${badge.y.toFixed(1)}" width="${badge.w}" height="${badge.h}" rx="5" fill="rgba(136,19,55,0.92)" stroke="rgba(251,113,133,0.75)" stroke-width="1"/>
          <text x="${badge.textX.toFixed(1)}" y="${badge.textY.toFixed(1)}" text-anchor="middle" fill="#fff1f2" font-size="8.8" font-weight="800">${escapeHtml(isolateLtrTokens('خط التسلل (11v11)'))}</text>
        </g>`);
      }
    }

    const heatZone = showTactical
      ? this.spotlightInfo?.zone ||
        (focusedUserIdx !== null ? getRoleSpotlightSequence(this.prefs.size, form.id, focusedUserIdx).zone : null)
      : null;
    if (heatZone) {
      const hz = mapPt({ x: heatZone.x, y: heatZone.y });
      const rx = isLandscape ? heatZone.ry * 6.2 : heatZone.rx * 3.1;
      const ry = isLandscape ? heatZone.rx * 4.1 : heatZone.ry * 4.2;
      bgParts.push(`<ellipse cx="${hz.x.toFixed(1)}" cy="${hz.y.toFixed(1)}" rx="${rx.toFixed(1)}" ry="${ry.toFixed(1)}" fill="url(#heatZoneGrad)" stroke="rgba(250,204,21,0.48)" stroke-dasharray="5 4" stroke-width="1.4"/>`);
    }

    if (showTactical && frame?.zones?.length) {
      const zoneColors: Record<string, { fill: string; stroke: string; txt: string }> = {
        gold: { fill: 'rgba(250,204,21,0.14)', stroke: 'rgba(250,204,21,0.62)', txt: '#fef08a' },
        cyan: { fill: 'rgba(56,189,248,0.14)', stroke: 'rgba(56,189,248,0.62)', txt: '#bae6fd' },
        rose: { fill: 'rgba(249,115,22,0.18)', stroke: 'rgba(251,146,60,0.78)', txt: '#ffedd5' },
        emerald: { fill: 'rgba(34,197,94,0.16)', stroke: 'rgba(34,197,94,0.66)', txt: '#bbf7d0' },
      };
      frame.zones.forEach((z) => {
        const col = zoneColors[z.color || 'gold'] || zoneColors.gold;
        const zp = mapPt({ x: z.x, y: z.y });
        const cx = zp.x;
        const cy = zp.y;
        const r = z.r * (isLandscape ? 4.2 : 3.0);
        bgParts.push(`<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" fill="${col.fill}" stroke="${col.stroke}" stroke-width="1.35" stroke-dasharray="4 3"/>`);
        if (z.label) {
          const ly = placeZoneLabelY(cx, cy, r, allTokenObstacles, canvasH);
          const lblW = Math.max(54, Math.min(118, z.label.length * (isLandscape ? 6.4 : 5.6) + 16));
          const padX = isLandscape ? 54 : 20;
          const pillX = Math.max(padX, Math.min(canvasW - padX - lblW, cx - lblW / 2));
          bgParts.push(`<rect x="${pillX.toFixed(1)}" y="${(ly - 10.5).toFixed(1)}" width="${lblW.toFixed(1)}" height="${isLandscape ? 16 : 14}" rx="5" fill="rgba(4,12,8,0.84)" stroke="${col.stroke}" stroke-width="0.7"/>`);
          bgParts.push(`<text x="${(pillX + lblW / 2).toFixed(1)}" y="${(ly + (isLandscape ? 0.5 : -0.8)).toFixed(1)}" text-anchor="middle" fill="${col.txt}" font-size="${isLandscape ? 9.6 : 8.4}" font-weight="800">${escapeHtml(z.label)}</text>`);
        }
      });
    }

    if (showTactical && this.showTriangles) {
      const tris = frame?.triangles || (form.slots.length >= 5 ? [[1, 2, 3]] : []);
      tris.forEach(([a, b, c]) => {
        const pA = ourSvgPts[a];
        const pB = ourSvgPts[b];
        const pC = ourSvgPts[c];
        if (!pA || !pB || !pC) return;
        const pts = `${pA.x.toFixed(1)},${pA.y.toFixed(1)} ${pB.x.toFixed(1)},${pB.y.toFixed(1)} ${pC.x.toFixed(1)},${pC.y.toFixed(1)}`;
        bgParts.push(`<polygon points="${pts}" fill="rgba(250,204,21,0.08)" stroke="rgba(250,204,21,0.34)" stroke-width="1.3" stroke-dasharray="4 3"/>`);
      });
    }

    if (showTactical && frame?.arrows?.length) {
      const reveal = reduced ? 1 : this.arrowRevealT;
      frame.arrows.forEach((arr) => {
        const p1 = mapPt({ x: arr.from[0], y: arr.from[1] });
        const p2 = mapPt({ x: arr.to[0], y: arr.to[1] });
        const x1 = p1.x;
        const y1 = p1.y;
        const x2 = p2.x;
        const y2 = p2.y;
        if (Math.hypot(x2 - x1, y2 - y1) < 8) return;
        const geom = buildCurvedArrowGeometry(x1, y1, x2, y2, arr.kind, reveal, canvasW / 2, canvasH / 2);
        const stroke = arr.kind === 'ball' ? '#fde047' : arr.kind === 'run' ? '#fde047' : '#4ade80';
        const marker = arr.kind === 'ball' ? 'url(#arrBall)' : arr.kind === 'run' ? 'url(#arrRun)' : 'url(#arrCover)';
        const width = (arr.kind === 'ball' ? 2.8 : arr.kind === 'run' ? 2.4 : 2.0) * (isLandscape ? 1.2 : 1);

        if (!reduced && reveal < 0.985) {
          const dashLen = geom.approxLength.toFixed(1);
          const dashOff = geom.dashOffset.toFixed(1);
          if (arr.kind === 'ball' || arr.kind === 'run') {
            bgParts.push(`<path d="${geom.pathD}" fill="none" stroke="url(#trailGoldGrad)" stroke-width="${arr.kind === 'ball' ? '8.5' : '6'}" stroke-linecap="round" stroke-dasharray="${dashLen}" stroke-dashoffset="${dashOff}"/>`);
          }
          bgParts.push(`<path class="tac-arrow-path" d="${geom.pathD}" fill="none" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" stroke-dasharray="${dashLen}" stroke-dashoffset="${dashOff}" ${reveal > 0.24 ? `marker-end="${marker}"` : ''} opacity="0.96"/>`);
        } else {
          const settledDash = arr.kind === 'ball' ? '' : arr.kind === 'run' ? 'stroke-dasharray="7 5"' : 'stroke-dasharray="3 3.5"';
          if (arr.kind === 'ball' && !reduced) {
            bgParts.push(`<path d="${geom.pathD}" fill="none" stroke="url(#trailGoldGrad)" stroke-width="8.5" stroke-linecap="round"/>`);
          }
          bgParts.push(`<path class="tac-arrow-path" d="${geom.pathD}" fill="none" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" ${settledDash} marker-end="${marker}" opacity="0.94"/>`);
        }
      });
    }

    if (this.ballTrailPath && !reduced) {
      bgParts.push(`<g class="tac-ball-trail">
        <path d="${this.ballTrailPath}" fill="none" stroke="url(#trailGoldGrad)" stroke-width="8" stroke-linecap="round"/>
        <path d="${this.ballTrailPath}" fill="none" stroke="rgba(254,240,138,0.8)" stroke-width="2.1" stroke-linecap="round"/>
      </g>`);
    }

    cache.bgLayer.innerHTML = bgParts.join('');
    cache.annotationsLayer.innerHTML = isLandscape
      ? renderProAnnotationsSvgContent(this.proAnnotations, this.proDraftAnnotation, 'cinAnn', { includeDefs: false })
      : '';

    // 2) Update Articulated Metallic Gold & Silver Figurines IN-PLACE (zero DOM recreation per frame)
    const baseScale = isLandscape
      ? this.prefs.size === '11v11'
        ? 1.04
        : 1.32
      : this.prefs.size === '11v11'
      ? 0.9
      : 1.18;
    const isInMotionWindow = this.lastRawMoveWindowT > 0.02 && this.lastRawMoveWindowT < 0.98;
    const isMovingNow = !reduced && (this.isPlaying || this.singleStepStopMs !== null || isInMotionWindow) && this.frameIdx > 0;
    const depthList: Array<{ y: number; node: SVGGElement }> = [];

    // Gold Team Figurines (User's Real Squad & Formation)
    ourSvgPts.forEach((pt, i) => {
      const fig = cache.ourFigs[i];
      if (!fig) return;
      const prevP = prevFrame?.ourPos[i] || this.currentOur[i];
      const targP = frame?.ourPos[i] || this.currentOur[i];
      const dx = targP.x - prevP.x;
      const dy = targP.y - prevP.y;
      const localT = this.ourLocalTs[i] ?? 1;

      const screenDx = isLandscape ? -dy : dx;
      const ballScreenDx = isLandscape
        ? -(this.currentBall.y - this.currentOur[i].y)
        : this.currentBall.x - this.currentOur[i].x;
      const prevFace = this.ourFacings[i] ?? (pt.x > canvasW / 2 ? -1 : 1);
      const targetFace =
        Math.abs(screenDx) > 1.8 ? (screenDx >= 0 ? 1 : -1) : ballScreenDx >= 0 ? 1 : -1;
      const isTurning = prevFace * targetFace < 0 && Math.abs(screenDx) > 2.2;
      const nextFace = reduced ? targetFace : prevFace + (targetFace - prevFace) * 0.24;
      this.ourFacings[i] = nextFace;

      const action = inferActorAction({
        isGold: true,
        idx: i,
        dx,
        dy,
        localT,
        rawMoveWindowT: this.lastRawMoveWindowT,
        prevBall: prevFrame?.ball || this.currentBall,
        targetBall: frame?.ball || this.currentBall,
        prevPos: prevP,
        targetPos: targP,
        phase: this.phase,
        activeSet,
        isTurning,
        isMovingNow,
      });

      const stridePhase = (this.timelineElapsedMs / 1000) * 11.2 + i * 1.37;
      const actionT =
        action === 'pass'
          ? clampNum(this.lastRawMoveWindowT / 0.5, 0, 1)
          : action === 'shoot'
          ? clampNum(this.lastRawMoveWindowT / 0.6, 0, 1)
          : action === 'receive'
          ? clampNum((this.lastRawMoveWindowT - 0.66) / 0.34, 0, 1)
          : localT;

      const pose = computeFigurinePose(action, stridePhase, actionT, isMovingNow, reduced);

      const isSpotlighted = this.spotlightSlotIdx === i;
      const isFocusedMine = focusedUserIdx !== null && focusedUserIdx === i;
      const isGrabbed = this.dragTarget?.kind === 'our' && this.dragTarget.idx === i;
      const isDimmed =
        focusedUserIdx !== null
          ? !isFocusedMine
          : this.spotlightSlotIdx !== null && !isSpotlighted && !activeSet.has(i);
      const showSelRing = isGrabbed || isFocusedMine || isSpotlighted;

      const slot = form.slots[i];
      const pl = assigned[i];
      const jerseyLabel = pl ? String(pl.jersey || slot?.short || '') : slot?.short || String(i + 1);
      const tagLabel = pl ? firstWord(pl.name) : showSelRing && slot ? slot.short : '';
      const depthScale = baseScale * (0.86 + (pt.y / canvasH) * 0.24);

      applyFigurinePoseToDom(fig, pt.x, pt.y, depthScale, nextFace, pose, {
        opacity: isDimmed ? 0.26 : 1,
        selected: showSelRing,
        alert: false,
        jerseyLabel: isLandscape && !this.proShowNumbers ? '' : jerseyLabel.slice(0, 3),
        tagLabel,
        showTag: Boolean(tagLabel) && (!isLandscape || this.proShowNames),
      });
      depthList.push({ y: pt.y, node: fig.root });
    });

    // Silver Team Figurines (Tactically Reactive Opponents)
    oppSvgPts.forEach((op, i) => {
      const fig = cache.oppFigs[i];
      if (!fig) return;
      if (!this.showOpponents) {
        fig.root.setAttribute('visibility', 'hidden');
        return;
      }
      fig.root.setAttribute('visibility', 'visible');

      const prevP = prevFrame?.oppPos[i] || displayOpp[i];
      const targP = frame?.oppPos[i] || displayOpp[i];
      const dx = targP.x - prevP.x;
      const dy = targP.y - prevP.y;
      const localT = this.oppLocalTs[i] ?? 1;

      const screenDx = isLandscape ? -dy : dx;
      const ballScreenDx = isLandscape
        ? -(this.currentBall.y - displayOpp[i].y)
        : this.currentBall.x - displayOpp[i].x;
      const prevFace = this.oppFacings[i] ?? (op.x > canvasW / 2 ? -1 : 1);
      const targetFace =
        Math.abs(screenDx) > 1.8 ? (screenDx >= 0 ? 1 : -1) : ballScreenDx >= 0 ? 1 : -1;
      const isTurning = prevFace * targetFace < 0 && Math.abs(screenDx) > 2.2;
      const nextFace = reduced ? targetFace : prevFace + (targetFace - prevFace) * 0.24;
      this.oppFacings[i] = nextFace;

      const action = inferActorAction({
        isGold: false,
        idx: i,
        dx,
        dy,
        localT,
        rawMoveWindowT: this.lastRawMoveWindowT,
        prevBall: prevFrame?.ball || this.currentBall,
        targetBall: frame?.ball || this.currentBall,
        prevPos: prevP,
        targetPos: targP,
        phase: this.phase,
        activeSet,
        isTurning,
        isMovingNow,
      });

      const stridePhase = (this.timelineElapsedMs / 1000) * 10.6 + i * 1.91 + 0.7;
      const actionT =
        action === 'pass'
          ? clampNum(this.lastRawMoveWindowT / 0.5, 0, 1)
          : action === 'shoot'
          ? clampNum(this.lastRawMoveWindowT / 0.6, 0, 1)
          : action === 'receive'
          ? clampNum((this.lastRawMoveWindowT - 0.66) / 0.34, 0, 1)
          : localT;

      const pose = computeFigurinePose(action, stridePhase, actionT, isMovingNow, reduced);
      const isAlert = oppAlerts.has(i);
      const isGrabbed = this.dragTarget?.kind === 'opp' && this.dragTarget.idx === i;
      const opacity = this.spotlightSlotIdx !== null || focusedUserIdx !== null ? 0.34 : 0.94;
      const depthScale = baseScale * 0.96 * (0.86 + (op.y / canvasH) * 0.24);

      applyFigurinePoseToDom(fig, op.x, op.y, depthScale, nextFace, pose, {
        opacity,
        selected: isGrabbed,
        alert: isAlert,
        jerseyLabel: isLandscape && !this.proShowNumbers ? '' : i === 0 ? 'GK' : String(i + 1),
        tagLabel: '',
        showTag: false,
      });
      depthList.push({ y: op.y, node: fig.root });
    });

    // 3) 3D Football with Ground Shadow Separation & Visual Spin
    const ballGrabbed = this.dragTarget?.kind === 'ball';
    const ballDepthScale = (isLandscape ? 1.16 : 1) * (0.88 + (ballSvg.y / canvasH) * 0.2) * this.ballScale;
    const ballLiftPx = this.ballLift * 10.5;
    const shadowRx = Math.max(4.6, 7.6 - this.ballLift * 2.1);
    const shadowRy = Math.max(2.2, 3.5 - this.ballLift * 1.1);
    const shadowOp = Math.max(0.2, 0.52 - this.ballLift * 0.24);

    cache.ball.root.setAttribute('transform', `translate(${ballSvg.x.toFixed(1)}, ${ballSvg.y.toFixed(1)})`);
    cache.ball.shadow.setAttribute('cy', (Math.max(4.8, this.ballShadowDy)).toFixed(1));
    cache.ball.shadow.setAttribute('rx', shadowRx.toFixed(1));
    cache.ball.shadow.setAttribute('ry', shadowRy.toFixed(1));
    cache.ball.shadow.setAttribute('fill', `rgba(0,0,0,${shadowOp.toFixed(2)})`);
    cache.ball.grabRing.setAttribute('visibility', ballGrabbed ? 'visible' : 'hidden');
    cache.ball.grabRing.setAttribute('cy', (-ballLiftPx).toFixed(1));
    cache.ball.bodyGroup.setAttribute(
      'transform',
      `translate(0, ${(-ballLiftPx).toFixed(1)}) scale(${ballDepthScale.toFixed(3)})`
    );
    cache.ball.spinGroup.setAttribute('transform', `rotate(${(reduced ? 0 : this.ballSpinDeg).toFixed(1)})`);
    depthList.push({ y: ballSvg.y + 1, node: cache.ball.root });

    // Depth-sort actors cleanly by ground y (only re-orders when needed)
    depthList.sort((a, b) => a.y - b.y);
    for (let k = 0; k < depthList.length; k++) {
      const targetNode = depthList[k].node;
      if (cache.actorsLayer.children[k] !== targetNode) {
        cache.actorsLayer.appendChild(targetNode);
      }
    }

    // 4) Callout Pointer & Glass Tactical Overlay
    const anchorIdx =
      focusedUserIdx !== null
        ? focusedUserIdx
        : this.spotlightSlotIdx !== null
        ? this.spotlightSlotIdx
        : frame?.activeIndices?.length
        ? frame.activeIndices[0]
        : -1;
    const anchorSvg = anchorIdx >= 0 && ourSvgPts[anchorIdx] ? ourSvgPts[anchorIdx] : ballSvg;
    const calloutBox = placeCalloutBox(
      anchorSvg,
      allTokenObstacles,
      canvasW,
      isLandscape ? canvasH - 36 : canvasH - 96,
      isLandscape ? 210 : 138,
      isLandscape ? 82 : 76
    );

    if (frame?.narration) {
      const tipTargetY = anchorIdx >= 0 ? anchorSvg.y - 18 : anchorSvg.y;
      const pdx = anchorSvg.x - calloutBox.edgeX;
      const pdy = tipTargetY - calloutBox.edgeY;
      const plen = Math.hypot(pdx, pdy);
      const stopBack = anchorIdx >= 0 ? 12 : 10;
      const ux = plen > 0.01 ? pdx / plen : 1;
      const uy = plen > 0.01 ? pdy / plen : 0;
      const tipX = anchorSvg.x - ux * stopBack;
      const tipY = tipTargetY - uy * stopBack;
      const ptrColor = this.activeComparisonId && this.comparisonVariant === 'mistake' ? '#fb923c' : '#FACC15';
      cache.overlayLayer.innerHTML = `<g class="tac-callout-pointer">
        ${plen > stopBack + 2 ? `<line x1="${calloutBox.edgeX.toFixed(1)}" y1="${calloutBox.edgeY.toFixed(1)}" x2="${tipX.toFixed(1)}" y2="${tipY.toFixed(1)}" stroke="${ptrColor}" stroke-width="1.35" stroke-opacity="0.88"/>` : ''}
        <circle cx="${tipX.toFixed(1)}" cy="${tipY.toFixed(1)}" r="3" fill="${ptrColor}"/>
      </g>`;
    } else {
      cache.overlayLayer.innerHTML = '';
    }

    this.renderInPitchCallout(
      frame,
      anchorIdx >= 0 ? form.slots[anchorIdx]?.label : undefined,
      calloutBox,
      canvasW,
      canvasH
    );
    this.renderXRayOverlay();
  }

  private renderSvgPitch(): void {
    if (this.isProFullscreen) {
      this.renderProPitchOnly();
    }
    if (this.viewMode === 'cinematic') {
      this.renderCinematicPitch();
      return;
    }
    this.cinCache = null;

    const svg = document.getElementById('tacPitchSvg') as unknown as SVGSVGElement | null;
    if (!svg) return;
    const portraitViewBox = `0 0 ${SVG_W} ${SVG_H}`;
    if (svg.getAttribute('viewBox') !== portraitViewBox) {
      svg.setAttribute('viewBox', portraitViewBox);
    }

    const form = this.getCurrentFormation();
    const assigned = this.getAssignedPlayersForCurrentFormation();
    const frame = this.sequence.frames[this.frameIdx] || this.sequence.frames[0];
    const activeSet = new Set(frame?.activeIndices || []);
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
    const rawBallSvg = { x: toSvgX(this.currentBall.x), y: toSvgY(this.currentBall.y) };
    const isBallInFlight = this.ballLift > 0.04 || this.dragTarget?.kind === 'ball';
    const ballSvg = computeSmartBallDisplayPoint(
      rawBallSvg,
      ourSvgPts,
      oppSvgPts,
      discR,
      isBallInFlight,
      SVG_W,
      SVG_H
    );
    const allTokenObstacles = [...ourSvgPts, ...oppSvgPts, ballSvg];
    const reduced = this.isMotionReduced();

    const parts: string[] = [];

    // Lightweight 3D Vector Defs (Zero feGaussianBlur — pure radial/linear gradients + cached grass texture)
    const grassUrl = reduced ? '' : getCachedGrassTextureUrl();
    parts.push(`<defs>
      <clipPath id="pitchClip">
        <rect x="0" y="0" width="${SVG_W}" height="${SVG_H}" rx="14"/>
      </clipPath>
      <linearGradient id="turfGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#073114"/>
        <stop offset="50%" stop-color="#0f5a23"/>
        <stop offset="100%" stop-color="#05240e"/>
      </linearGradient>
      <radialGradient id="stadiumFloodlight" cx="50%" cy="46%" r="64%">
        <stop offset="0%" stop-color="#22c55e" stop-opacity="0.22"/>
        <stop offset="48%" stop-color="#0f5a23" stop-opacity="0.1"/>
        <stop offset="82%" stop-color="#031208" stop-opacity="0.4"/>
        <stop offset="100%" stop-color="#020a05" stop-opacity="0.74"/>
      </radialGradient>
      <radialGradient id="ourDiscGrad" cx="35%" cy="28%" r="72%">
        <stop offset="0%" stop-color="#1b3256"/>
        <stop offset="52%" stop-color="#13223a"/>
        <stop offset="100%" stop-color="#070d1a"/>
      </radialGradient>
      <radialGradient id="ourDiscActiveGrad" cx="35%" cy="28%" r="74%">
        <stop offset="0%" stop-color="#3c2f0c"/>
        <stop offset="54%" stop-color="#1c190a"/>
        <stop offset="100%" stop-color="#090b10"/>
      </radialGradient>
      <radialGradient id="oppDiscGrad" cx="35%" cy="28%" r="72%">
        <stop offset="0%" stop-color="#38475e"/>
        <stop offset="60%" stop-color="#1e293b"/>
        <stop offset="100%" stop-color="#0c1322"/>
      </radialGradient>
      <radialGradient id="oppAlertGrad" cx="35%" cy="28%" r="72%">
        <stop offset="0%" stop-color="#9a3412"/>
        <stop offset="60%" stop-color="#431407"/>
        <stop offset="100%" stop-color="#1f0903"/>
      </radialGradient>
      <radialGradient id="goldHaloOuter" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="#fde047" stop-opacity="0.85"/>
        <stop offset="45%" stop-color="#FACC15" stop-opacity="0.32"/>
        <stop offset="76%" stop-color="#FACC15" stop-opacity="0.1"/>
        <stop offset="100%" stop-color="#FACC15" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="goldHaloInner" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="#FEF9C3" stop-opacity="0.95"/>
        <stop offset="58%" stop-color="#fde047" stop-opacity="0.48"/>
        <stop offset="100%" stop-color="#FACC15" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="oppAlertHalo" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="#fb923c" stop-opacity="0.64"/>
        <stop offset="100%" stop-color="#f97316" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="heatZoneGrad" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="#FACC15" stop-opacity="0.34"/>
        <stop offset="65%" stop-color="#EAB308" stop-opacity="0.14"/>
        <stop offset="100%" stop-color="#FACC15" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="footballGrad" cx="36%" cy="32%" r="68%">
        <stop offset="0%" stop-color="#ffffff"/>
        <stop offset="68%" stop-color="#e2e8f0"/>
        <stop offset="100%" stop-color="#94a3b8"/>
      </radialGradient>
      <linearGradient id="trailGoldGrad" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="#fde047" stop-opacity="0.04"/>
        <stop offset="52%" stop-color="#fde047" stop-opacity="0.46"/>
        <stop offset="100%" stop-color="#FEF9C3" stop-opacity="0.92"/>
      </linearGradient>
      <pattern id="goalNetPat" width="4.2" height="4.2" patternUnits="userSpaceOnUse">
        <path d="M 4.2 0 L 0 0 0 4.2" fill="none" stroke="rgba(255,255,255,0.52)" stroke-width="0.65"/>
      </pattern>
      <marker id="arrBall" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6.8" markerHeight="6.8" orient="auto-start-reverse">
        <path d="M 0 1 L 10 5 L 0 9 z" fill="#fde047"/>
      </marker>
      <marker id="arrRun" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6.6" markerHeight="6.6" orient="auto-start-reverse">
        <path d="M 0 1 L 10 5 L 0 9 z" fill="#fde047"/>
      </marker>
      <marker id="arrCover" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6.2" markerHeight="6.2" orient="auto-start-reverse">
        <path d="M 0 1 L 10 5 L 0 9 z" fill="#4ade80"/>
      </marker>
    </defs>`);

    // Natural Cached Emerald Grass Texture (or clean lightweight SVG fallback in Data Saver / Reduced Motion)
    if (grassUrl) {
      parts.push(`<image href="${grassUrl}" x="0" y="0" width="${SVG_W}" height="${SVG_H}" preserveAspectRatio="none" clip-path="url(#pitchClip)"/>`);
    } else {
      parts.push(`<rect x="0" y="0" width="${SVG_W}" height="${SVG_H}" rx="14" fill="url(#turfGrad)"/>`);
      for (let i = 0; i < 10; i++) {
        if (i % 2 === 0) {
          parts.push(`<rect x="14" y="${16 + i * 48.8}" width="${SVG_W - 28}" height="48.8" fill="rgba(255,255,255,0.045)"/>`);
        }
      }
      if (!reduced) {
        parts.push(`<rect x="0" y="0" width="${SVG_W}" height="${SVG_H}" rx="14" fill="url(#stadiumFloodlight)"/>`);
      }
    }

    // Subtle Center MIDAN Watermark
    parts.push(`<text x="${SVG_W / 2}" y="${SVG_H / 2 + 5}" text-anchor="middle" fill="#FEF08A" fill-opacity="0.07" font-size="22" font-weight="900" letter-spacing="6" pointer-events="none">MIDAN</text>`);

    // Metallic Gold Pitch Chalk Lines (#e5c158) + Penalty Arcs + Corner Arcs + Realistic Top/Bottom Goal Nets
    parts.push(`<g stroke="#e5c158" stroke-opacity="0.82" stroke-width="1.6" fill="none">
      <rect x="16" y="18" width="${SVG_W - 32}" height="${SVG_H - 36}" rx="3"/>
      <line x1="16" y1="${SVG_H / 2}" x2="${SVG_W - 16}" y2="${SVG_H / 2}"/>
      <circle cx="${SVG_W / 2}" cy="${SVG_H / 2}" r="42"/>
      <circle cx="${SVG_W / 2}" cy="${SVG_H / 2}" r="2.9" fill="#fde047" stroke="none"/>
      <rect x="86" y="18" width="${SVG_W - 172}" height="64"/>
      <rect x="130" y="18" width="${SVG_W - 260}" height="24"/>
      <path d="M 142 82 A 42 42 0 0 0 218 82"/>
      <circle cx="${SVG_W / 2}" cy="60" r="2.4" fill="#fde047" stroke="none"/>
      <rect x="86" y="${SVG_H - 82}" width="${SVG_W - 172}" height="64"/>
      <rect x="130" y="${SVG_H - 42}" width="${SVG_W - 260}" height="24"/>
      <path d="M 142 ${SVG_H - 82} A 42 42 0 0 1 218 ${SVG_H - 82}"/>
      <circle cx="${SVG_W / 2}" cy="${SVG_H - 60}" r="2.4" fill="#fde047" stroke="none"/>
      <path d="M 16 28 A 10 10 0 0 0 26 18"/>
      <path d="M ${SVG_W - 26} 18 A 10 10 0 0 0 ${SVG_W - 16} 28"/>
      <path d="M 16 ${SVG_H - 28} A 10 10 0 0 1 26 ${SVG_H - 18}"/>
      <path d="M ${SVG_W - 26} ${SVG_H - 18} A 10 10 0 0 1 ${SVG_W - 16} ${SVG_H - 28}"/>
      <rect x="142" y="5" width="76" height="13" rx="2" fill="url(#goalNetPat)" stroke="#fef9c3" stroke-width="2"/>
      <circle cx="142" cy="18" r="2.3" fill="#fef9c3" stroke="none"/>
      <circle cx="218" cy="18" r="2.3" fill="#fef9c3" stroke="none"/>
      <rect x="142" y="${SVG_H - 18}" width="76" height="13" rx="2" fill="url(#goalNetPat)" stroke="#fef9c3" stroke-width="1.8" stroke-opacity="0.72"/>
      <circle cx="142" cy="${SVG_H - 18}" r="2.1" fill="#fef9c3" stroke="none"/>
      <circle cx="218" cy="${SVG_H - 18}" r="2.1" fill="#fef9c3" stroke="none"/>
    </g>`);

    // Offside line ONLY for 11v11 — smart non-overlapping dark-rose badge
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

    // Open space / tactical zones from keyframe (captions placed safely clear of penalty box chalk lines)
    if (frame?.zones?.length) {
      const zoneColors: Record<string, { fill: string; stroke: string; txt: string }> = {
        gold: { fill: 'rgba(250,204,21,0.14)', stroke: 'rgba(250,204,21,0.62)', txt: '#fef08a' },
        cyan: { fill: 'rgba(56,189,248,0.14)', stroke: 'rgba(56,189,248,0.62)', txt: '#bae6fd' },
        rose: { fill: 'rgba(249,115,22,0.16)', stroke: 'rgba(251,146,60,0.72)', txt: '#ffedd5' },
        emerald: { fill: 'rgba(34,197,94,0.16)', stroke: 'rgba(34,197,94,0.66)', txt: '#bbf7d0' },
      };
      frame.zones.forEach((z) => {
        const col = zoneColors[z.color || 'gold'] || zoneColors.gold;
        const cx = toSvgX(z.x);
        const cy = toSvgY(z.y);
        const r = z.r * 3.0;
        parts.push(`<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" fill="${col.fill}" stroke="${col.stroke}" stroke-width="1.35" stroke-dasharray="4 3"/>`);
        if (z.label) {
          const ly = placeZoneLabelY(cx, cy, r, allTokenObstacles, SVG_H);
          const lblW = Math.max(46, Math.min(92, z.label.length * 5.6 + 14));
          const pillX = Math.max(20, Math.min(SVG_W - 20 - lblW, cx - lblW / 2));
          parts.push(`<rect x="${pillX.toFixed(1)}" y="${(ly - 10.5).toFixed(1)}" width="${lblW.toFixed(1)}" height="14" rx="5" fill="rgba(4,12,8,0.82)" stroke="${col.stroke}" stroke-width="0.7" pointer-events="none"/>`);
          parts.push(`<text x="${(pillX + lblW / 2).toFixed(1)}" y="${(ly - 0.8).toFixed(1)}" text-anchor="middle" fill="${col.txt}" font-size="8.4" font-weight="800" pointer-events="none">${escapeHtml(z.label)}</text>`);
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

    // Animated Curved Tactical Arrows (quadratic Bezier + luminous pass trail + progressive stroke-dashoffset)
    if (frame?.arrows?.length) {
      const reveal = reduced ? 1 : this.arrowRevealT;
      frame.arrows.forEach((arr) => {
        const x1 = toSvgX(arr.from[0]);
        const y1 = toSvgY(arr.from[1]);
        const x2 = toSvgX(arr.to[0]);
        const y2 = toSvgY(arr.to[1]);
        if (Math.hypot(x2 - x1, y2 - y1) < 8) return;

        const geom = buildCurvedArrowGeometry(x1, y1, x2, y2, arr.kind, reveal, SVG_W / 2, SVG_H / 2);
        const stroke = arr.kind === 'ball' ? '#fde047' : arr.kind === 'run' ? '#fde047' : '#4ade80';
        const marker = arr.kind === 'ball' ? 'url(#arrBall)' : arr.kind === 'run' ? 'url(#arrRun)' : 'url(#arrCover)';
        const width = arr.kind === 'ball' ? 3.0 : arr.kind === 'run' ? 2.6 : 2.1;

        if (!reduced && reveal < 0.985) {
          const dashLen = geom.approxLength.toFixed(1);
          const dashOff = geom.dashOffset.toFixed(1);
          if (arr.kind === 'ball' || arr.kind === 'run') {
            parts.push(`<path d="${geom.pathD}" fill="none" stroke="url(#trailGoldGrad)" stroke-width="${arr.kind === 'ball' ? '9' : '6.5'}" stroke-linecap="round" stroke-dasharray="${dashLen}" stroke-dashoffset="${dashOff}" pointer-events="none"/>`);
          }
          parts.push(`<path class="tac-arrow-path" d="${geom.pathD}" fill="none" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" stroke-dasharray="${dashLen}" stroke-dashoffset="${dashOff}" ${reveal > 0.24 ? `marker-end="${marker}"` : ''} opacity="0.98"/>`);
        } else {
          const settledDash = arr.kind === 'ball' ? '' : arr.kind === 'run' ? 'stroke-dasharray="7 5"' : 'stroke-dasharray="3 3.5"';
          if (arr.kind === 'ball' && !reduced) {
            parts.push(`<path d="${geom.pathD}" fill="none" stroke="url(#trailGoldGrad)" stroke-width="9" stroke-linecap="round" pointer-events="none"/>`);
          } else if (arr.kind === 'run' && !reduced) {
            parts.push(`<path d="${geom.pathD}" fill="none" stroke="rgba(253,224,71,0.22)" stroke-width="6" stroke-linecap="round" pointer-events="none"/>`);
          }
          parts.push(`<path class="tac-arrow-path" d="${geom.pathD}" fill="none" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" ${settledDash} marker-end="${marker}" opacity="0.96"/>`);
        }
      });
    }

    // Preserve user-drawn Pro Fullscreen annotations inside Normal portrait pitch too (zero lost edits on exit!)
    if (this.proAnnotations.length) {
      parts.push(`<g class="tac-user-annotations" pointer-events="none">`);
      this.proAnnotations.forEach((ann) => {
        const ax1 = toSvgX(ann.x1);
        const ay1 = toSvgY(ann.y1);
        const ax2 = toSvgX(ann.x2);
        const ay2 = toSvgY(ann.y2);
        parts.push(`<g data-pro-ann-id="${escapeHtml(ann.id)}">`);
        if (ann.kind === 'arrow') {
          parts.push(`<line x1="${ax1.toFixed(1)}" y1="${ay1.toFixed(1)}" x2="${ax2.toFixed(1)}" y2="${ay2.toFixed(1)}" stroke="${ann.color}" stroke-width="2.2" stroke-dasharray="6 4" marker-end="url(#arrBall)" opacity="0.92"/>`);
        } else if (ann.kind === 'path') {
          const g = buildCurvedArrowGeometry(ax1, ay1, ax2, ay2, 'ball', 1, SVG_W / 2, SVG_H / 2);
          parts.push(`<path d="${g.pathD}" fill="none" stroke="#FACC15" stroke-width="2.8" stroke-linecap="round" marker-end="url(#arrBall)" opacity="0.95"/>`);
        } else if (ann.kind === 'circle') {
          const r = Math.max(10, Math.hypot(ax2 - ax1, ay2 - ay1));
          parts.push(`<circle cx="${ax1.toFixed(1)}" cy="${ay1.toFixed(1)}" r="${r.toFixed(1)}" fill="rgba(56,189,248,0.14)" stroke="${ann.color}" stroke-width="1.6" stroke-dasharray="5 3"/>`);
        } else if (ann.kind === 'rect' || ann.kind === 'zone') {
          const rx = Math.min(ax1, ax2);
          const ry = Math.min(ay1, ay2);
          const rw = Math.max(16, Math.abs(ax2 - ax1));
          const rh = Math.max(16, Math.abs(ay2 - ay1));
          parts.push(`<rect x="${rx.toFixed(1)}" y="${ry.toFixed(1)}" width="${rw.toFixed(1)}" height="${rh.toFixed(1)}" rx="4" fill="rgba(56,189,248,0.18)" stroke="${ann.color}" stroke-width="1.5"/>`);
        } else if (ann.kind === 'triangle') {
          const topX = (ax1 + ax2) / 2;
          const topY = Math.min(ay1, ay2);
          const botY = Math.max(ay1, ay2);
          parts.push(`<polygon points="${topX.toFixed(1)},${topY.toFixed(1)} ${Math.max(ax1, ax2).toFixed(1)},${botY.toFixed(1)} ${Math.min(ax1, ax2).toFixed(1)},${botY.toFixed(1)}" fill="rgba(74,222,128,0.16)" stroke="${ann.color}" stroke-width="1.6"/>`);
        } else if (ann.kind === 'cone') {
          parts.push(`<polygon points="${(ax1 - 6).toFixed(1)},${(ay1 + 5).toFixed(1)} ${(ax1 + 6).toFixed(1)},${(ay1 + 5).toFixed(1)} ${ax1.toFixed(1)},${(ay1 - 7).toFixed(1)}" fill="#F59E0B" stroke="#FEF08A" stroke-width="0.9"/>`);
        } else if (ann.kind === 'flag') {
          parts.push(`<line x1="${ax1.toFixed(1)}" y1="${(ay1 + 7).toFixed(1)}" x2="${ax1.toFixed(1)}" y2="${(ay1 - 9).toFixed(1)}" stroke="#fff" stroke-width="1.5"/><polygon points="${ax1.toFixed(1)},${(ay1 - 9).toFixed(1)} ${(ax1 + 10).toFixed(1)},${(ay1 - 5.5).toFixed(1)} ${ax1.toFixed(1)},${(ay1 - 2).toFixed(1)}" fill="#EF4444"/>`);
        } else if (ann.kind === 'ball') {
          parts.push(`<circle cx="${ax1.toFixed(1)}" cy="${ay1.toFixed(1)}" r="6" fill="url(#footballGrad)" stroke="#090b10" stroke-width="1"/>`);
        }
        parts.push(`</g>`);
      });
      parts.push(`</g>`);
    }

    // Opponent tokens: Sculpted 3D chamfered octagon/shield with ground shadow (distinct from circular teammates)
    if (this.showOpponents) {
      const oppR = discR - 1.2;
      oppSvgPts.forEach((op, i) => {
        const isAlert = oppAlerts.has(i);
        const isGrabbed = this.dragTarget?.kind === 'opp' && this.dragTarget.idx === i;
        const dimmed = this.spotlightSlotIdx !== null || focusedUserIdx !== null ? 'opacity="0.42"' : 'opacity="0.95"';
        const fill = isAlert ? 'url(#oppAlertGrad)' : 'url(#oppDiscGrad)';
        const stroke = isGrabbed ? '#FEF08A' : isAlert ? '#fb923c' : '#64748b';
        const txtCol = isAlert ? '#ffedd5' : '#e2e8f0';
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
        const ic1 = c1 * 0.8;
        const ic2 = c2 * 0.8;
        const innerPolyPts = [
          `${(op.x - ic1).toFixed(1)},${(op.y - ic2).toFixed(1)}`,
          `${(op.x + ic1).toFixed(1)},${(op.y - ic2).toFixed(1)}`,
          `${(op.x + ic2).toFixed(1)},${(op.y - ic1).toFixed(1)}`,
          `${(op.x + ic2).toFixed(1)},${(op.y + ic1).toFixed(1)}`,
          `${(op.x + ic1).toFixed(1)},${(op.y + ic2).toFixed(1)}`,
          `${(op.x - ic1).toFixed(1)},${(op.y + ic2).toFixed(1)}`,
          `${(op.x - ic2).toFixed(1)},${(op.y + ic1).toFixed(1)}`,
          `${(op.x - ic2).toFixed(1)},${(op.y - ic1).toFixed(1)}`,
        ].join(' ');
        parts.push(`<g data-drag-kind="opp" data-drag-idx="${i}" class="tac-disc tac-disc-opp" ${dimmed}>`);
        parts.push(`<ellipse cx="${op.x.toFixed(1)}" cy="${(op.y + oppR * 0.92).toFixed(1)}" rx="${(oppR * 0.92).toFixed(1)}" ry="${(oppR * 0.34).toFixed(1)}" fill="rgba(0,0,0,0.42)" pointer-events="none"/>`);
        if (isGrabbed) {
          parts.push(`<circle cx="${op.x.toFixed(1)}" cy="${op.y.toFixed(1)}" r="${(oppR + 6.5).toFixed(1)}" fill="none" stroke="#FEF08A" stroke-width="2" stroke-dasharray="4 3"/>`);
        } else if (isAlert && !reduced) {
          parts.push(`<circle cx="${op.x.toFixed(1)}" cy="${op.y.toFixed(1)}" r="${(oppR + 9).toFixed(1)}" fill="url(#oppAlertHalo)"/>`);
        }
        parts.push(`<polygon points="${polyPts}" fill="${fill}" stroke="${stroke}" stroke-width="${isGrabbed ? 2.4 : isAlert ? 2.1 : 1.55}"/>`);
        parts.push(`<polygon points="${innerPolyPts}" fill="none" stroke="rgba(255,255,255,0.14)" stroke-width="0.7" pointer-events="none"/>`);
        parts.push(`<text x="${op.x.toFixed(1)}" y="${(op.y + 3.4).toFixed(1)}" text-anchor="middle" fill="${txtCol}" font-size="${this.prefs.size === '11v11' ? '8.4' : '9.4'}" font-weight="800">${i === 0 ? 'GK' : i + 1}</text>`);
        parts.push(`</g>`);
      });
    }

    // Prepare non-overlapping name labels ONLY for slots with a real assigned player
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

    // Our Golden Team 3D Vector Discs (ground shadow + radial metallic body + specular inner ring + dual gold halos)
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
      const numText = pl ? String(pl.jersey || slot?.short || '★') : slot ? slot.short : String(i + 1);
      const lbl = labelByIdx.get(i);

      parts.push(`<g data-drag-kind="our" data-drag-idx="${i}" class="tac-disc tac-disc-our" opacity="${isDimmed ? '0.28' : '1'}">`);
      // Soft ground shadow ellipse on grass
      parts.push(`<ellipse cx="${pt.x.toFixed(1)}" cy="${(pt.y + discR * 0.95).toFixed(1)}" rx="${(discR * 0.94).toFixed(1)}" ry="${(discR * 0.36).toFixed(1)}" fill="rgba(0,0,0,0.45)" pointer-events="none"/>`);
      if (isGrabbed) {
        parts.push(`<circle cx="${pt.x.toFixed(1)}" cy="${pt.y.toFixed(1)}" r="${(discR + 8).toFixed(1)}" fill="none" stroke="#FEF08A" stroke-width="2.2" stroke-dasharray="4 3"/>`);
      } else if (isActive && !reduced) {
        // Intense dual concentric radial gold glow halos + bright double golden ring (zero SVG blur filters)
        parts.push(`<circle cx="${pt.x.toFixed(1)}" cy="${pt.y.toFixed(1)}" r="${(discR + 21).toFixed(1)}" fill="url(#goldHaloOuter)" pointer-events="none"/>`);
        parts.push(`<circle cx="${pt.x.toFixed(1)}" cy="${pt.y.toFixed(1)}" r="${(discR + 11.5).toFixed(1)}" fill="url(#goldHaloInner)" pointer-events="none"/>`);
        parts.push(`<circle class="tac-active-pulse" cx="${pt.x.toFixed(1)}" cy="${pt.y.toFixed(1)}" r="${(discR + 5.2).toFixed(1)}" fill="none" stroke="#FEF08A" stroke-width="2.0"/>`);
        parts.push(`<circle cx="${pt.x.toFixed(1)}" cy="${pt.y.toFixed(1)}" r="${(discR + 2.4).toFixed(1)}" fill="none" stroke="#FACC15" stroke-width="1.2" stroke-opacity="0.82" pointer-events="none"/>`);
      }
      parts.push(`<circle cx="${pt.x.toFixed(1)}" cy="${pt.y.toFixed(1)}" r="${discR.toFixed(1)}" fill="${isActive ? 'url(#ourDiscActiveGrad)' : 'url(#ourDiscGrad)'}" stroke="${isActive ? '#FEF08A' : '#FACC15'}" stroke-width="${isActive ? 2.6 : 2.1}"/>`);
      // Fine luminous inner rim for 3D bevel polish
      parts.push(`<circle cx="${pt.x.toFixed(1)}" cy="${pt.y.toFixed(1)}" r="${(discR - 2.6).toFixed(1)}" fill="none" stroke="${isActive ? 'rgba(254,240,138,0.58)' : 'rgba(255,255,255,0.2)'}" stroke-width="0.85" pointer-events="none"/>`);
      parts.push(`<text x="${pt.x.toFixed(1)}" y="${(pt.y + 3.6).toFixed(1)}" text-anchor="middle" fill="${isActive ? '#FFFBEB' : '#ffffff'}" font-size="${this.prefs.size === '11v11' ? '8.5' : '10.2'}" font-weight="900">${escapeHtml(numText)}</text>`);
      if (lbl) {
        parts.push(`<rect x="${lbl.x.toFixed(1)}" y="${lbl.y.toFixed(1)}" width="${lbl.w.toFixed(1)}" height="${lbl.h}" rx="5" fill="rgba(7,9,14,0.88)" stroke="rgba(250,204,21,0.42)" stroke-width="0.8"/>`);
        parts.push(`<text x="${lbl.textX.toFixed(1)}" y="${lbl.textY.toFixed(1)}" text-anchor="middle" fill="#f8fafc" font-size="8.4" font-weight="800">${escapeHtml(lbl.label)}</text>`);
      }
      parts.push(`</g>`);
    });

    // Fading luminous golden gradient comet trail behind mid-flight ball
    if (this.ballTrailPath && !reduced) {
      parts.push(`<g class="tac-ball-trail" pointer-events="none">
        <path d="${this.ballTrailPath}" fill="none" stroke="url(#trailGoldGrad)" stroke-width="9" stroke-linecap="round"/>
        <path d="${this.ballTrailPath}" fill="none" stroke="rgba(254,240,138,0.82)" stroke-width="2.4" stroke-linecap="round"/>
      </g>`);
    }

    // Detailed Multi-Panel SVG Football (smartly offset beside carrier foot when resting)
    const ballGrabbed = this.dragTarget?.kind === 'ball';
    const shadowRx = Math.max(5.2, 8.6 - this.ballLift * 2.2);
    const shadowRy = Math.max(2.8, 4.4 - this.ballLift * 1.4);
    const shadowOpacity = Math.max(0.22, 0.48 - this.ballLift * 0.22);
    const ballDrawY = ballSvg.y - this.ballLift * 6.5;
    const ballR = 8.4 * this.ballScale;
    const ps = this.ballScale;
    const p1x = ballSvg.x;
    const p1y = ballDrawY - 3.3 * ps;
    const p2x = ballSvg.x + 3.1 * ps;
    const p2y = ballDrawY - 1.0 * ps;
    const p3x = ballSvg.x + 1.9 * ps;
    const p3y = ballDrawY + 2.7 * ps;
    const p4x = ballSvg.x - 1.9 * ps;
    const p4y = ballDrawY + 2.7 * ps;
    const p5x = ballSvg.x - 3.1 * ps;
    const p5y = ballDrawY - 1.0 * ps;
    parts.push(`<g data-drag-kind="ball" data-drag-idx="0" class="tac-disc tac-ball">
      <ellipse cx="${ballSvg.x.toFixed(1)}" cy="${(ballSvg.y + Math.max(6.2, this.ballShadowDy)).toFixed(1)}" rx="${shadowRx.toFixed(1)}" ry="${shadowRy.toFixed(1)}" fill="rgba(0,0,0,${shadowOpacity.toFixed(2)})"/>
      ${ballGrabbed ? `<circle cx="${ballSvg.x.toFixed(1)}" cy="${ballDrawY.toFixed(1)}" r="${(ballR + 5.5).toFixed(1)}" fill="none" stroke="#FEF08A" stroke-width="2" stroke-dasharray="4 3"/>` : ''}
      <circle cx="${ballSvg.x.toFixed(1)}" cy="${ballDrawY.toFixed(1)}" r="${ballR.toFixed(1)}" fill="url(#footballGrad)" stroke="#090b10" stroke-width="1.35"/>
      <g stroke="#1e293b" stroke-width="${(0.85 * ps).toFixed(2)}" stroke-linecap="round" opacity="0.72" pointer-events="none">
        <line x1="${p1x.toFixed(1)}" y1="${p1y.toFixed(1)}" x2="${ballSvg.x.toFixed(1)}" y2="${(ballDrawY - ballR + 0.6).toFixed(1)}"/>
        <line x1="${p2x.toFixed(1)}" y1="${p2y.toFixed(1)}" x2="${(ballSvg.x + ballR * 0.92).toFixed(1)}" y2="${(ballDrawY - ballR * 0.28).toFixed(1)}"/>
        <line x1="${p3x.toFixed(1)}" y1="${p3y.toFixed(1)}" x2="${(ballSvg.x + ballR * 0.62).toFixed(1)}" y2="${(ballDrawY + ballR * 0.78).toFixed(1)}"/>
        <line x1="${p4x.toFixed(1)}" y1="${p4y.toFixed(1)}" x2="${(ballSvg.x - ballR * 0.62).toFixed(1)}" y2="${(ballDrawY + ballR * 0.78).toFixed(1)}"/>
        <line x1="${p5x.toFixed(1)}" y1="${p5y.toFixed(1)}" x2="${(ballSvg.x - ballR * 0.92).toFixed(1)}" y2="${(ballDrawY - ballR * 0.28).toFixed(1)}"/>
      </g>
      <polygon points="${p1x.toFixed(1)},${p1y.toFixed(1)} ${p2x.toFixed(1)},${p2y.toFixed(1)} ${p3x.toFixed(1)},${p3y.toFixed(1)} ${p4x.toFixed(1)},${p4y.toFixed(1)} ${p5x.toFixed(1)},${p5y.toFixed(1)}" fill="#0f172a"/>
      <circle cx="${(ballSvg.x - 2.3 * ps).toFixed(1)}" cy="${(ballDrawY - 2.8 * ps).toFixed(1)}" r="${(1.5 * ps).toFixed(1)}" fill="rgba(255,255,255,0.65)" pointer-events="none"/>
    </g>`);

    // Smart Quadrant Callout Box positioning + short clean pointer line (never crosses midfield players)
    const anchorIdx =
      focusedUserIdx !== null
        ? focusedUserIdx
        : this.spotlightSlotIdx !== null
        ? this.spotlightSlotIdx
        : frame?.activeIndices?.length
        ? frame.activeIndices[0]
        : -1;
    const anchorSvg = anchorIdx >= 0 && ourSvgPts[anchorIdx] ? ourSvgPts[anchorIdx] : ballSvg;
    const calloutBox = placeCalloutBox(anchorSvg, allTokenObstacles, SVG_W, SVG_H - 96, 138, 76);

    if (frame?.narration) {
      const pdx = anchorSvg.x - calloutBox.edgeX;
      const pdy = anchorSvg.y - calloutBox.edgeY;
      const plen = Math.hypot(pdx, pdy);
      const stopBack = anchorIdx >= 0 ? discR + 4.5 : 11;
      const ux = plen > 0.01 ? pdx / plen : 1;
      const uy = plen > 0.01 ? pdy / plen : 0;
      const tipX = anchorSvg.x - ux * stopBack;
      const tipY = anchorSvg.y - uy * stopBack;
      const ptrColor = this.activeComparisonId && this.comparisonVariant === 'mistake' ? '#fb923c' : '#FACC15';
      parts.push(`<g class="tac-callout-pointer" pointer-events="none">
        ${plen > stopBack + 2 ? `<line x1="${calloutBox.edgeX.toFixed(1)}" y1="${calloutBox.edgeY.toFixed(1)}" x2="${tipX.toFixed(1)}" y2="${tipY.toFixed(1)}" stroke="${ptrColor}" stroke-width="1.45" stroke-opacity="0.9"/>` : ''}
        <circle cx="${tipX.toFixed(1)}" cy="${tipY.toFixed(1)}" r="3.2" fill="${ptrColor}"/>
      </g>`);
    }

    svg.innerHTML = parts.join('');
    this.renderInPitchCallout(frame, anchorIdx >= 0 ? form.slots[anchorIdx]?.label : undefined, calloutBox);
    this.renderXRayOverlay();
  }

  private renderXRayOverlay(): void {
    const portraitCanvas = document.getElementById('tacXrayCanvas') as HTMLCanvasElement | null;
    const proCanvas = document.getElementById('tacProXrayCanvas') as HTMLCanvasElement | null;
    const hud = document.getElementById('tacXrayHud');

    if (!this.xrayEnabled || !this.isInteractivePitchMode() || this.currentOur.length < 2) {
      if (portraitCanvas) {
        portraitCanvas.classList.add('hidden');
        clearXRayCanvas(portraitCanvas);
      }
      if (proCanvas) {
        proCanvas.classList.add('hidden');
        clearXRayCanvas(proCanvas);
      }
      if (hud) hud.classList.add('hidden');
      return;
    }

    const snap = computeDominanceXRay(
      {
        size: this.prefs.size,
        our: this.currentOur,
        opp: this.currentOpp,
        ball: this.currentBall,
      },
      { baseline: this.xrayBaseline || undefined }
    );

    const syncCanvasToSvg = (
      canvas: HTMLCanvasElement,
      svgEl: Element | null,
      vbW: number,
      vbH: number
    ) => {
      const parent = canvas.parentElement;
      if (!svgEl || !parent) return;
      const pRect = parent.getBoundingClientRect();
      const sRect = svgEl.getBoundingClientRect();
      if (sRect.width > 10 && sRect.height > 10) {
        // Compute exact rendered viewBox area inside SVG preserveAspectRatio="xMidYMid meet"
        const scale = Math.min(sRect.width / vbW, sRect.height / vbH);
        const renderW = vbW * scale;
        const renderH = vbH * scale;
        const offsetX = (sRect.width - renderW) / 2;
        const offsetY = (sRect.height - renderH) / 2;
        canvas.style.left = `${(sRect.left - pRect.left + offsetX).toFixed(1)}px`;
        canvas.style.top = `${(sRect.top - pRect.top + offsetY).toFixed(1)}px`;
        canvas.style.width = `${renderW.toFixed(1)}px`;
        canvas.style.height = `${renderH.toFixed(1)}px`;
        canvas.style.right = 'auto';
        canvas.style.bottom = 'auto';
      }
    };

    if (portraitCanvas) {
      portraitCanvas.classList.remove('hidden');
      syncCanvasToSvg(portraitCanvas, document.getElementById('tacPitchSvg'), SVG_W, SVG_H);
      renderXRayCanvas(portraitCanvas, snap, 'portrait');
    }
    if (proCanvas && this.isProFullscreen && this.viewMode === 'studio') {
      proCanvas.classList.remove('hidden');
      syncCanvasToSvg(proCanvas, document.getElementById('tacProPitchSvg'), PRO_SVG_W, PRO_SVG_H);
      renderXRayCanvas(proCanvas, snap, 'landscape');
    } else if (proCanvas) {
      proCanvas.classList.add('hidden');
      clearXRayCanvas(proCanvas);
    }
    if (hud) {
      hud.classList.remove('hidden');
      hud.innerHTML = buildXRayHudHtml(snap);
    }
  }

  private getActiveGhostPlayDraft(): ReturnType<typeof tacticalFramesToGhostPlay> {
    const form = this.getCurrentFormation();
    const nameInput = (document.getElementById('tacRecName') as HTMLInputElement | null)?.value?.trim();
    const frames =
      this.recordedFrames.length >= 2 ? this.recordedFrames : this.sequence.frames;
    return tacticalFramesToGhostPlay(frames, {
      size: this.prefs.size,
      formationId: form.id,
      title: nameInput || this.sequence.title || `خطة ${form.id}`,
    });
  }

  private renderInPitchCallout(
    frame: TacticalKeyframe | undefined,
    activeSlotLabel: string | undefined,
    box: { x: number; y: number; w: number; h: number },
    canvasW: number = SVG_W,
    canvasH: number = SVG_H
  ): void {
    const el = document.getElementById('tacPitchCallout');
    if (!el) return;
    if (!frame || !frame.narration || !this.isInteractivePitchMode()) {
      el.classList.add('hidden');
      return;
    }
    const isMistakeMode = this.activeComparisonId !== null && this.comparisonVariant === 'mistake';
    el.classList.remove('hidden');
    el.classList.remove('collapsed');
    el.classList.toggle('callout-mistake', isMistakeMode);

    const leftPct = (box.x / canvasW) * 100;
    const topPct = (box.y / canvasH) * 100;
    const widthPct = (box.w / canvasW) * 100;
    el.style.left = `${leftPct.toFixed(1)}%`;
    el.style.top = `${topPct.toFixed(1)}%`;
    el.style.width = `${widthPct.toFixed(1)}%`;

    const titleEl = document.getElementById('tacCalloutTitle');
    const bodyEl = document.getElementById('tacCalloutBody');
    const speakBtn = document.getElementById('btnTacCalloutToggle');
    if (titleEl) {
      const heading = isMistakeMode
        ? `⚠️ ${frame.title || 'خطأ شائع'}`
        : this.activeComparisonId
        ? `✓ ${frame.title || 'التصحيح التكتيكي'}`
        : activeSlotLabel || frame.title || 'توجيه تكتيكي';
      titleEl.innerHTML = formatFormationHtml(heading);
    }
    if (bodyEl) {
      bodyEl.innerHTML = formatFormationHtml(frame.narration);
    }
    if (speakBtn) {
      const speechOk = this.isSpeechSupported();
      speakBtn.classList.toggle('hidden', !speechOk);
      if (speechOk) {
        speakBtn.innerHTML = SVG_ICO_CALLOUT_PLAY;
        speakBtn.title = 'نطق التوجيه الصوتي';
        speakBtn.setAttribute('aria-label', 'نطق التوجيه الصوتي');
      }
    }
  }

  private renderYourRoleCard(): void {
    const card = document.getElementById('tacYourRoleCard');
    if (!card) return;
    if (!this.isInteractivePitchMode()) {
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
        ${model.ovr !== null ? `<span class="tac-mini-shield-ovr">${model.ovr}</span>` : `<span class="tac-mini-shield-ovr" style="opacity:0.6;">★</span>`}
        <span class="tac-mini-shield-pos" dir="ltr">${escapeHtml(model.positionCode)}</span>
      </div>`;

    const shieldAvatar = model.photoUrl
      ? `<img src="${model.photoUrl}" alt="${escapeHtml(model.playerName || model.slotLabel)}" />`
      : `<span>${model.jersey ? '#' + escapeHtml(model.jersey) : escapeHtml(model.slotShort)}</span>`;

    // Two clean glassmorphic cards side-by-side (RTL: col 1 = Right Duties + Focus Toggle, col 2 = Left Golden Shield + Role Brief)
    card.innerHTML = `
      <div class="tac-role-split">
        <div class="tac-role-pane tac-role-pane-duties">
          <div class="tac-role-pane-title">دورك في الخطة:</div>
          <div class="tac-role-duties">
            ${model.duties
              .slice(0, 3)
              .map(
                (d) => `<div class="tac-role-duty-item"><span class="tac-duty-check" aria-hidden="true">${SVG_ICO_CHECK}</span><span>${escapeHtml(d)}</span></div>`
              )
              .join('')}
          </div>
          <div class="tac-focus-seg" role="group" aria-label="نطاق التركيز">
            <button type="button" data-tac-focus="mine" class="tac-focus-btn ${this.focusMineOnly ? 'active' : ''}">حركتي فقط</button>
            <button type="button" data-tac-focus="team" class="tac-focus-btn ${!this.focusMineOnly ? 'active' : ''}">مع الفريق</button>
          </div>
        </div>
        <div class="tac-role-pane tac-role-pane-hero">
          <div class="tac-role-hero-copy">
            <div class="tac-role-hero-head">
              <strong class="tac-role-hero-title">${escapeHtml(model.slotLabel)}</strong>
              <span class="tac-role-bulb" aria-hidden="true">${SVG_ICO_BULB}</span>
            </div>
            <div class="tac-role-hero-divider" aria-hidden="true"></div>
            <div class="tac-role-hero-summary">${formatFormationHtml(model.momentSummary)}</div>
          </div>
          <div class="tac-mini-shield-frame" aria-label="درع ميدان المصغّر لدورك الحالي">
            <div class="tac-mini-shield">
              ${shieldTop}
              <div class="tac-mini-shield-pic">${shieldAvatar}</div>
              <div class="tac-mini-shield-name">${escapeHtml(firstWord(model.playerName || model.slotLabel))}</div>
              <div class="tac-mini-shield-crown" aria-hidden="true">${SVG_ICO_CROWN}</div>
            </div>
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
    const stepSummary = document.getElementById('tacStepCounterSummary');
    if (stepSummary) stepSummary.textContent = `${this.frameIdx + 1}/${total}`;

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
        playIco.innerHTML = this.isPlaying ? SVG_ICO_PAUSE : SVG_ICO_PLAY;
        playLbl.textContent = this.isPlaying ? 'إيقاف' : 'تشغيل';
      } else {
        playBtn.textContent = this.isPlaying ? 'إيقاف' : 'تشغيل';
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
      voiceBtn.innerHTML = !supported ? SVG_ICO_VOL_OFF : this.voiceEnabled ? SVG_ICO_VOL_ON : SVG_ICO_VOL_OFF;
      voiceBtn.title = !supported ? 'التعليق الصوتي غير مدعوم' : this.voiceEnabled ? 'إيقاف التعليق الصوتي' : 'تفعيل التعليق الصوتي';
      voiceBtn.setAttribute('aria-label', voiceBtn.title);
      voiceBtn.classList.toggle('active', this.voiceEnabled && supported);
    }

    document.querySelectorAll<HTMLButtonElement>('[data-tac-speed]').forEach((b) => {
      b.classList.toggle('active', Number(b.dataset.tacSpeed) === this.speed);
    });

    if (this.isProFullscreen) {
      this.renderProControlsState();
      if (this.proSection === 'moves') this.renderProLeftPanel();
    }
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
    panel.classList.toggle('hidden', !this.isRecordingMode || !this.isInteractivePitchMode());
    if (!this.isRecordingMode) return;

    const countEl = document.getElementById('tacRecCount');
    if (countEl) countEl.textContent = `${this.recordedFrames.length} لقطات مسجّلة`;

    const ghostInfo = document.getElementById('tacGhostInterceptInfo');
    if (ghostInfo) {
      const draft = this.getActiveGhostPlayDraft();
      if (draft && draft.frames.length >= 2) {
        const res = analyzeGhostPassIntercept(draft.frames[0], draft.frames[1], draft.size);
        ghostInfo.textContent = `⏱️ ${res.summaryAr}`;
      } else {
        ghostInfo.textContent = 'سجّل لقطتين على الأقل أو استخدم الخطة الحالية لإنشاء رابط شبح وتحدّي الإيقاف.';
      }
    }

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

  private renderBoardAnnotationsOverlay(svgId: string, defsPrefix: string): void {
    const svg = document.getElementById(svgId) as unknown as SVGSVGElement | null;
    if (!svg) return;
    if (!this.isProFullscreen) {
      svg.classList.add('hidden');
      svg.classList.remove('is-interactive', 'is-passive');
      svg.innerHTML = '';
      return;
    }
    svg.classList.remove('hidden');
    const intercept = shouldBoardOverlayInterceptPointer(this.isProFullscreen, this.proTool);
    svg.classList.toggle('is-interactive', intercept);
    svg.classList.toggle('is-passive', !intercept);
    svg.dataset.tool = this.proTool;
    svg.innerHTML = renderProAnnotationsSvgContent(this.proAnnotations, this.proDraftAnnotation, defsPrefix);
  }

  private renderOfficialPosterView(): void {
    const container = document.getElementById('tacPosterBoard');
    if (!container || !this.ctx) return;
    const form = this.getCurrentFormation();
    const assigned = this.getAssignedPlayersForCurrentFormation();
    const chem = computeTeamChemistry(form, assigned);
    const settings = this.ctx.getTeamSettings();
    const showNames = !this.isProFullscreen || this.proShowNames;
    const showNums = !this.isProFullscreen || this.proShowNumbers;

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

        const pos = mapSlotToBoardPct(s, this.isProFullscreen);
        const fallbackAvatar = pl ? (showNums ? '#' + escapeHtml(String(pl.jersey || '★')) : '★') : '+';
        return `<button type="button" data-assign-slot="${idx}" class="poster-node ${this.prefs.size === '11v11' ? 'compact' : ''}" style="left:${pos.x}%;top:${pos.y}%;">
          <div class="poster-avatar ${pl ? 'filled' : ''}">
            ${
              photo
                ? `<img src="${photo}" alt="${escapeHtml(pl?.name || '')}" />`
                : `<span>${fallbackAvatar}</span>`
            }
            ${pl && showNums ? `<span class="poster-num">${escapeHtml(String(pl.jersey || '★'))}</span>` : ''}
            ${badges.length ? `<span class="poster-badge">${badges.join('')}</span>` : ''}
          </div>
          ${showNames ? `<div class="poster-name">${pl ? escapeHtml(firstWord(pl.name)) : escapeHtml(s.short)}</div>` : ''}
        </button>`;
      })
      .join('');

    this.renderBoardAnnotationsOverlay('tacPosterOverlaySvg', 'posterAnn');
  }

  // ==================== VIEW MODE 3: MINI FIFA CARDS + CHEMISTRY ====================

  private renderMiniFifaView(): void {
    const board = document.getElementById('tacFifaBoard');
    const svg = document.getElementById('tacFifaLinksSvg') as unknown as SVGSVGElement | null;
    if (!board || !svg) return;

    const form = this.getCurrentFormation();
    const assigned = this.getAssignedPlayersForCurrentFormation();
    const chem = computeTeamChemistry(form, assigned);
    const showNames = !this.isProFullscreen || this.proShowNames;
    const showNums = !this.isProFullscreen || this.proShowNumbers;
    const showLines = !this.isProFullscreen || this.proShowTacticalLines;

    const kpiChem = document.getElementById('tacKpiChem');
    if (kpiChem) kpiChem.textContent = `${chem.totalPct} / 100`;
    const kpiOvr = document.getElementById('tacKpiOvr');
    if (kpiOvr) kpiOvr.textContent = chem.avgOvr ? String(chem.avgOvr) : '--';
    const kpiAssigned = document.getElementById('tacKpiAssigned');
    if (kpiAssigned) {
      const count = assigned.filter(Boolean).length;
      kpiAssigned.textContent = `${count} / ${form.slots.length}`;
    }

    // Draw SVG Chemistry lines (gated by showLines in Full-Screen)
    const lines = showLines
      ? chem.linkResults
          .map((lk) => {
            const a = form.slots[lk.a];
            const b = form.slots[lk.b];
            if (!a || !b) return '';
            const posA = mapSlotToBoardPct(a, this.isProFullscreen);
            const posB = mapSlotToBoardPct(b, this.isProFullscreen);
            const cls =
              lk.level === 'gold'
                ? 'chem-line-gold'
                : lk.level === 'green'
                ? 'chem-line-green'
                : 'chem-line-dashed';
            return `<line x1="${posA.x}%" y1="${posA.y}%" x2="${posB.x}%" y2="${posB.y}%" class="${cls}" />`;
          })
          .join('')
      : '';
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
        const pos = mapSlotToBoardPct(s, this.isProFullscreen);
        const fallbackAvatar = pl ? (showNums ? '#' + escapeHtml(String(pl.jersey || '★')) : '★') : '👤';
        return `<button type="button" data-assign-slot="${idx}" class="mini-fifa-card ${tierCls} ${this.prefs.size === '11v11' ? 'compact' : ''}" style="left:${pos.x}%;top:${pos.y}%;">
          <div class="mini-fifa-top">
            ${showNums ? `<span class="mini-fifa-ovr">${pl ? ovr : '+'}</span>` : '<span class="mini-fifa-ovr">•</span>'}
            <span class="mini-fifa-pos">${escapeHtml(s.short)}</span>
          </div>
          <div class="mini-fifa-pic">
            ${photo ? `<img src="${photo}" alt="" />` : `<span>${fallbackAvatar}</span>`}
          </div>
          ${showNames ? `<div class="mini-fifa-name">${pl ? escapeHtml(firstWord(pl.name)) : escapeHtml(s.label.split(' ')[0])}</div>` : ''}
        </button>`;
      })
      .join('');

    if (kpiOvr && realOvrs.length) {
      kpiOvr.textContent = String(Math.round(realOvrs.reduce((a, b) => a + b, 0) / realOvrs.length));
    }

    this.renderBoardAnnotationsOverlay('tacFifaOverlaySvg', 'fifaAnn');
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

    // Feature 05: Pit-Wall Rotation Room (upgraded rotate tab using real team roster & availability)
    this.getOrCreatePitWallController().render(body);
  }

  private getOrCreatePitWallController(): PitWallRotationController {
    if (!this.pitWallCtrl) {
      this.pitWallCtrl = new PitWallRotationController({
        getPlayers: () => this.ctx?.getPlayers() || [],
        getReadiness: () => (this.ctx?.getReadiness ? this.ctx.getReadiness() : []),
        getStartersCount: () => PITCH_SIZE_META[this.prefs.size].count,
        toast: (msg, isErr) => this.ctx?.toast(msg, isErr),
      });
    }
    return this.pitWallCtrl;
  }

  private toggleXRayMode(): void {
    this.xrayEnabled = !this.xrayEnabled;
    if (!this.xrayEnabled) this.xrayBaseline = null;
    this.renderToolbarState();
    this.renderXRayOverlay();
    if (this.xrayEnabled && !this.isInteractivePitchMode()) {
      this.viewMode = 'studio';
      this.renderAll();
    }
    if (this.isProFullscreen && this.proSection === 'lab') {
      this.renderProLeftPanel();
    }
  }

  private copyActiveGhostLink(): void {
    const draft = this.getActiveGhostPlayDraft();
    if (!draft) {
      this.ctx?.toast('سجّل لقطتين على الأقل لإنشاء رابط الشبح', true);
      return;
    }
    const res = buildShareableGhostLink(draft);
    if (res.ok && res.url) {
      if (navigator.clipboard) {
        navigator.clipboard
          .writeText(res.url)
          .then(() =>
            this.ctx?.toast('تم نسخ رابط الشبح (Ghost Link) — يفتح بدون تسجيل دخول ✓')
          )
          .catch(() => this.ctx?.toast(`رابط الشبح جاهز (${res.hash?.slice(0, 24)}...)`));
      } else {
        this.ctx?.toast('رابط الشبح جاهز للمشاركة ✓');
      }
    } else if (res.fallbackJson && navigator.clipboard) {
      navigator.clipboard
        .writeText(res.fallbackJson)
        .then(() => this.ctx?.toast('الخطة طويلة للرابط المختصر — تم نسخ بيانات JSON المحلية كبديل ✓'))
        .catch(() => this.ctx?.toast(res.reasonAr || 'تعذّر إنشاء الرابط', true));
    } else {
      this.ctx?.toast(res.reasonAr || 'تعذّر إنشاء رابط الشبح', true);
    }
  }

  private openActiveGhostTheater(): void {
    const draft = this.getActiveGhostPlayDraft();
    if (!draft) {
      this.ctx?.toast('اختر خطة أو سجّل لقطتين أولاً لفتح تحدّي إيقاف الخطة', true);
      return;
    }
    openGhostGuestViewer(draft, { toast: (m, err) => this.ctx?.toast(m, err) });
  }

  private async exportActiveGhostWebm(): Promise<void> {
    const draft = this.getActiveGhostPlayDraft();
    if (!draft) {
      this.ctx?.toast('سجّل لقطتين على الأقل لتصدير فيديو الخطة', true);
      return;
    }
    const res = await exportGhostPlayLocalMedia(draft, {
      withXRay: this.xrayEnabled,
      onStatus: (msg) => this.ctx?.toast(msg),
    });
    this.ctx?.toast(res.messageAr);
  }

  private openUnifiedLab(tab: TacticalLabTab): void {
    openTacticalLabModal(tab, {
      toast: (m, err) => this.ctx?.toast(m, err),
      isXrayEnabled: () => this.xrayEnabled,
      onToggleXray: () => this.toggleXRayMode(),
      onOpenGhostTheater: () => this.openActiveGhostTheater(),
      onCopyGhostLink: () => this.copyActiveGhostLink(),
      onExportGhostWebm: () => {
        void this.exportActiveGhostWebm();
      },
      getGhostSummary: () => {
        const draft = this.getActiveGhostPlayDraft();
        if (!draft) return null;
        const durationSec = Math.max(2, draft.frames.length * 1.4);
        return {
          title: draft.title,
          framesCount: draft.frames.length,
          durationSec,
        };
      },
      pitWallController: this.getOrCreatePitWallController(),
    });
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

    // View mode tabs (Cinematic, Studio, Midan Cards, Poster)
    document.querySelectorAll<HTMLButtonElement>('[data-tac-view]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const next = btn.dataset.tacView as StudioViewMode;
        if (!next) return;
        this.pause();
        if (next !== 'cinematic') this.cinCache = null;
        this.viewMode = next;
        this.renderAll();
      });
    });

    // Cinematic camera angle switcher (Cinematic 2.5D / Top / Wide)
    document.querySelectorAll<HTMLButtonElement>('[data-tac-cam]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const cam = btn.dataset.tacCam as CinematicCameraAngle;
        if (!cam) return;
        if (this.isMotionReduced() && cam !== 'top') {
          const isSaver = document.body.classList.contains('data-saver');
          this.ctx?.toast(
            isSaver
              ? 'وضع توفير البيانات ⚡ يُبقي الكاميرا من الأعلى للخفة'
              : 'إعداد «تقليل الحركة» في جهازك يُبقي الكاميرا من الأعلى'
          );
          return;
        }
        this.cameraAngle = cam;
        this.renderViewModeTabs();
        this.renderPitchShellClasses();
      });
    });

    // 4 Phase switcher buttons
    document.querySelectorAll<HTMLButtonElement>('[data-tac-phase]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const ph = btn.dataset.tacPhase as TacticalPhaseId;
        if (!ph) return;
        this.phase = ph;
        this.activeScenarioId = null;
        this.activeComparisonId = null;
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

    // Phase C: Mistake vs Correct Educational Comparison Mode triggers & banner delegation
    document.getElementById('btnTacCompareMode')?.addEventListener('click', () => {
      if (this.activeComparisonId) this.exitComparisonMode();
      else this.enterComparisonMode(undefined, 'mistake');
    });
    document.getElementById('btnTacCompareInline')?.addEventListener('click', () => {
      this.enterComparisonMode(undefined, 'mistake');
    });
    document.getElementById('tacCompareBanner')?.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.closest('#btnTacCompareClose')) {
        this.exitComparisonMode();
        return;
      }
      const cmpBtn = target.closest<HTMLButtonElement>('[data-cmp-id]');
      if (cmpBtn?.dataset.cmpId) {
        this.enterComparisonMode(cmpBtn.dataset.cmpId, this.comparisonVariant);
        return;
      }
      const varBtn = target.closest<HTMLButtonElement>('[data-cmp-variant]');
      if (varBtn?.dataset.cmpVariant) {
        const nextVar = varBtn.dataset.cmpVariant as ComparisonVariant;
        if (nextVar === 'mistake' || nextVar === 'correct') {
          this.setComparisonVariant(nextVar);
        }
      }
    });

    // In-pitch Callout clear audio button (speaks current frame narration locally when Web Speech API is available)
    document.getElementById('btnTacCalloutToggle')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!this.isSpeechSupported()) return;
      const frame = this.sequence.frames[this.frameIdx] || this.sequence.frames[0];
      if (frame?.narration) {
        this.speakText(frame.narration);
      }
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
      if (this.isMotionReduced()) {
        const isSaver = document.body.classList.contains('data-saver');
        this.ctx?.toast(
          isSaver
            ? 'وضع توفير البيانات ⚡ يُبقي الملعب 2D مسطّح للخفة'
            : 'إعداد «تقليل الحركة» في جهازك يُبقي الملعب 2D مسطّح للراحة'
        );
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

    // Feature 01: Dominance X-Ray Toggle (Normal + Fullscreen Pro + Lab Dock + Lab Accordion)
    document.getElementById('btnTacXray')?.addEventListener('click', () => this.toggleXRayMode());
    document.getElementById('btnTacProXray')?.addEventListener('click', () => this.toggleXRayMode());
    document.getElementById('btnOpenXrayFromLab')?.addEventListener('click', () => this.toggleXRayMode());

    // Prominent Tactical Intelligence Lab Dock (Black Box + 5 existing systems)
    document.querySelectorAll<HTMLButtonElement>('[data-lab-quick]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.labQuick;
        if (key === 'blackbox') {
          this.pause();
          this.stopSpeech();
          openBlackBoxModal({ toast: (m, e) => this.ctx?.toast(m, e) });
        } else if (key === 'xray') {
          this.toggleXRayMode();
        } else if (key === 'radar') {
          this.openUnifiedLab('radar');
        } else if (key === 'ghost') {
          this.openUnifiedLab('ghost');
        } else if (key === 'duel') {
          this.openUnifiedLab('duel');
        } else if (key === 'pitwall') {
          this.openUnifiedLab('pitwall');
        }
      });
    });

    // Sidebar Accordion Lab Triggers (Black Box + all 5 systems)
    document.getElementById('btnOpenBlackBox')?.addEventListener('click', () => {
      this.pause();
      this.stopSpeech();
      openBlackBoxModal({ toast: (m, e) => this.ctx?.toast(m, e) });
    });
    document.getElementById('btnOpenBlindSideRadar')?.addEventListener('click', () => {
      this.openUnifiedLab('radar');
    });
    document.getElementById('btnOpenGtoDuel')?.addEventListener('click', () => {
      this.openUnifiedLab('duel');
    });
    document.getElementById('btnOpenGhostTheater')?.addEventListener('click', () => {
      this.openUnifiedLab('ghost');
    });
    document.getElementById('btnOpenPitWallQuick')?.addEventListener('click', () => {
      this.captainTab = 'rotate';
      this.renderCaptainTools();
      this.openUnifiedLab('pitwall');
    });

    // Feature 03: Ghost Play Recorder Panel Actions
    document.getElementById('btnTacGhostLink')?.addEventListener('click', () => this.copyActiveGhostLink());
    document.getElementById('btnTacGhostChallenge')?.addEventListener('click', () => this.openActiveGhostTheater());
    document.getElementById('btnTacGhostWebm')?.addEventListener('click', () => {
      void this.exportActiveGhostWebm();
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

    // Full-Screen Pro Studio trigger & overlay events
    document.getElementById('btnTacFullscreen')?.addEventListener('click', () => {
      this.enterProFullscreen();
    });
    this.bindProFullscreenEvents();
  }

  // ==================== FULL-SCREEN PRO STUDIO MODE (REFERENCE-MATCHED WORKSPACE) ====================

  private captureBoardSnapshot(): ProBoardSnapshot {
    return {
      our: this.currentOur.map((p) => ({ x: p.x, y: p.y })),
      opp: this.currentOpp.map((p) => ({ x: p.x, y: p.y })),
      ball: { x: this.currentBall.x, y: this.currentBall.y },
      annotations: this.proAnnotations.map((a) => ({ ...a })),
    };
  }

  private pushCurrentBoardHistory(): void {
    this.proHistory = pushHistorySnapshot(this.proHistory, this.captureBoardSnapshot());
    if (this.isProFullscreen) this.renderProControlsState();
  }

  private applyBoardSnapshot(snap: ProBoardSnapshot): void {
    this.currentOur = snap.our.map((p) => ({ x: p.x, y: p.y }));
    this.currentOpp = snap.opp.map((p) => ({ x: p.x, y: p.y }));
    this.currentBall = { x: snap.ball.x, y: snap.ball.y };
    this.proAnnotations = snap.annotations.map((a) => ({ ...a }));
    this.renderActiveViewBody();
    if (this.isProFullscreen) this.renderProControlsState();
  }

  private proUndo(): void {
    const res = applyHistoryUndo(this.proHistory, this.captureBoardSnapshot());
    if (!res.restored) {
      this.ctx?.toast('لا توجد خطوة سابقة للتراجع عنها');
      return;
    }
    this.proHistory = res.history;
    this.applyBoardSnapshot(res.restored);
  }

  private proRedo(): void {
    const res = applyHistoryRedo(this.proHistory, this.captureBoardSnapshot());
    if (!res.restored) {
      this.ctx?.toast('لا توجد خطوة للإعادة');
      return;
    }
    this.proHistory = res.history;
    this.applyBoardSnapshot(res.restored);
  }

  private proSaveCurrentPlan(): void {
    const form = this.getCurrentFormation();
    const customArrows: TacticalArrow[] = this.proAnnotations
      .filter((a) => a.kind === 'arrow' || a.kind === 'path')
      .map((a) => ({
        from: [a.x1, a.y1],
        to: [a.x2, a.y2],
        kind: a.kind === 'path' ? 'ball' : 'run',
      }));
    const currentFrame: TacticalKeyframe = {
      title: `خطة ${form.id} (${this.prefs.size})`,
      narration:
        (this.sequence.frames[this.frameIdx]?.narration || `تشكيلة ${form.name} محفوظة من وضع التكبير الاحترافي`),
      durationMs: 2400,
      ourPos: this.currentOur.map((p) => ({ ...p })),
      oppPos: this.currentOpp.map((p) => ({ ...p })),
      ball: { ...this.currentBall },
      activeIndices: this.sequence.frames[this.frameIdx]?.activeIndices || [],
      arrows: [...(this.sequence.frames[this.frameIdx]?.arrows || []), ...customArrows],
    };
    const framesToSave: TacticalKeyframe[] =
      this.recordedFrames.length >= 2
        ? this.recordedFrames.map((f) => ({ ...f }))
        : [
            currentFrame,
            {
              ...currentFrame,
              title: `المرحلة 2 — ${form.id}`,
            },
          ];

    const planName = `خطة ${form.id} (${this.prefs.size}) #${this.prefs.customPlans.length + 1}`;
    const plan: CustomPlan = {
      id: 'plan_' + Date.now(),
      name: planName,
      size: this.prefs.size,
      formationId: form.id,
      frames: framesToSave,
    };
    this.prefs.customPlans.unshift(plan);
    this.prefs.customPlans = this.prefs.customPlans.slice(0, 12);
    savePrefs(this.prefs);

    if (this.prefs.size === '6v6' && this.ctx) {
      const t = this.ctx.getTactics();
      this.ctx.setTactics({ formation: form.id, slots: { ...(t.slots || {}) } });
    }
    this.renderRecorderPanel();
    if (this.isProFullscreen) {
      this.renderProLibraryModal();
      this.renderProLeftPanel();
    }
    this.ctx?.toast(`تم حفظ «${planName}» في مكتبة الخطط ✓`);
  }

  private renderProPitchOnly(): void {
    if (this.viewMode !== 'studio') return;
    const svg = document.getElementById('tacProPitchSvg') as unknown as SVGSVGElement | null;
    if (!svg) return;
    const form = this.getCurrentFormation();
    const assigned = this.getAssignedPlayersForCurrentFormation();
    const frame = this.sequence.frames[this.frameIdx] || this.sequence.frames[0];
    const activeSet = new Set(frame?.activeIndices || []);
    const focusedUserIdx = this.focusMineOnly ? this.getFocusedUserSlotIdx() : null;

    const ourNumbers = form.slots.map((slot, i) => {
      const pl = assigned[i];
      return pl && pl.jersey ? String(pl.jersey) : String(i + 1);
    });
    const ourNames = form.slots.map((slot, i) => {
      const pl = assigned[i];
      return pl ? firstWord(pl.name) : slot.short;
    });

    svg.innerHTML = buildProLandscapePitchSvg({
      size: this.prefs.size,
      formation: form,
      ourPortrait: this.currentOur,
      oppPortrait: this.currentOpp,
      ballPortrait: this.currentBall,
      ourNumbers,
      ourNames,
      activeIndices: activeSet,
      spotlightIdx: this.spotlightSlotIdx,
      focusedIdx: focusedUserIdx,
      dragTarget: this.dragTarget,
      frame,
      display: {
        showNames: this.proShowNames,
        showNumbers: this.proShowNumbers,
        showTacticalLines: this.proShowTacticalLines,
        showOpponents: this.showOpponents,
        showTriangles: this.showTriangles,
      },
      annotations: this.proAnnotations,
      draftAnnotation: this.proDraftAnnotation,
      arrowRevealT: this.arrowRevealT,
      ballLift: this.ballLift,
      reducedMotion: this.isMotionReduced(),
      offsideEnabled: this.sequence.offsideEnabled,
      isMistakeCompare: Boolean(this.activeComparisonId && this.comparisonVariant === 'mistake'),
    });

    // Sync live narration ticker & comparison strip at top of pitch
    const narrEl = document.getElementById('tacProLiveCaption');
    if (narrEl) {
      if (this.activeComparisonId) {
        const cmp = getComparisonById(this.activeComparisonId);
        const isMistake = this.comparisonVariant === 'mistake';
        narrEl.classList.remove('hidden');
        narrEl.innerHTML = `<div class="tac-pro-cmp-bar ${isMistake ? 'is-mistake' : 'is-correct'}">
          <span>${isMistake ? '⚠️ الخطأ الشائع' : '✓ الصحيح التكتيكي'}: <strong>${escapeHtml(cmp?.title || '')}</strong></span>
          <div class="tac-pro-cmp-actions">
            <button type="button" data-pro-cmp-var="mistake" class="tac-pro-cmp-pill ${isMistake ? 'active' : ''}">الخطأ</button>
            <button type="button" data-pro-cmp-var="correct" class="tac-pro-cmp-pill ${!isMistake ? 'active' : ''}">الصحيح</button>
            <button type="button" data-pro-cmp-close="1" class="tac-pro-cmp-pill">✕</button>
          </div>
        </div>`;
      } else if (frame?.narration) {
        narrEl.classList.remove('hidden');
        const stepLbl = `${this.frameIdx + 1}/${Math.max(1, this.sequence.frames.length)}`;
        narrEl.innerHTML = `<div class="tac-pro-caption-pill">
          <span class="tac-pro-caption-step" dir="ltr">${stepLbl}</span>
          <span class="tac-pro-caption-txt">${escapeHtml(frame.title ? `${frame.title} — ${frame.narration}` : frame.narration)}</span>
        </div>`;
      } else {
        narrEl.classList.add('hidden');
      }
    }
    this.renderXRayOverlay();
  }

  private renderProControlsState(): void {
    // Top bar play/pause state
    const playBtn = document.getElementById('btnTacProPlay');
    const playLbl = document.getElementById('tacProPlayLbl');
    if (playBtn) playBtn.classList.toggle('is-playing', this.isPlaying);
    if (playLbl) playLbl.textContent = this.isPlaying ? 'إيقاف مؤقت' : 'تشغيل الخطة';

    // Top section tabs
    document.querySelectorAll<HTMLButtonElement>('[data-pro-section]').forEach((btn) => {
      const isAct = btn.dataset.proSection === this.proSection;
      btn.classList.toggle('active', isAct);
      btn.setAttribute('aria-selected', isAct ? 'true' : 'false');
    });

    // Right drawing & advanced tool buttons
    document.querySelectorAll<HTMLButtonElement>('[data-pro-tool]').forEach((btn) => {
      const isAct = btn.dataset.proTool === this.proTool;
      btn.classList.toggle('active', isAct);
      btn.setAttribute('aria-pressed', isAct ? 'true' : 'false');
    });

    // Cursor class & Zoom on whichever pitch canvas is currently active in Full-Screen
    const scaleStr = `scale(${(this.proZoomPct / 100).toFixed(2)})`;
    const stage = document.getElementById('tacProPitchCanvasWrap');
    if (stage) {
      stage.dataset.tool = this.proTool;
      stage.style.transform = scaleStr;
    }
    const nativePitchStage = document.getElementById('tacPitchStage');
    if (nativePitchStage) {
      if (this.isProFullscreen && this.viewMode === 'cinematic') {
        nativePitchStage.dataset.tool = this.proTool;
        nativePitchStage.style.transform = scaleStr;
      } else {
        nativePitchStage.style.transform = '';
        delete nativePitchStage.dataset.tool;
      }
    }
    const posterField = document.getElementById('tacPosterField');
    if (posterField) {
      posterField.style.transform = this.isProFullscreen && this.viewMode === 'poster' ? scaleStr : '';
      if (this.isProFullscreen && this.viewMode === 'poster') {
        posterField.dataset.tool = this.proTool;
      } else {
        delete posterField.dataset.tool;
      }
    }
    const fifaField = document.getElementById('tacFifaField');
    if (fifaField) {
      fifaField.style.transform = this.isProFullscreen && this.viewMode === 'fifa' ? scaleStr : '';
      if (this.isProFullscreen && this.viewMode === 'fifa') {
        fifaField.dataset.tool = this.proTool;
      } else {
        delete fifaField.dataset.tool;
      }
    }
    (['tacPosterOverlaySvg', 'tacFifaOverlaySvg'] as const).forEach((oid) => {
      const oel = document.getElementById(oid);
      if (oel && this.isProFullscreen) {
        const intercept = shouldBoardOverlayInterceptPointer(this.isProFullscreen, this.proTool);
        oel.classList.toggle('is-interactive', intercept);
        oel.classList.toggle('is-passive', !intercept);
        oel.dataset.tool = this.proTool;
      }
    });

    // Display switches
    const chkNames = document.getElementById('chkProShowNames') as HTMLInputElement | null;
    const chkNums = document.getElementById('chkProShowNumbers') as HTMLInputElement | null;
    const chkLines = document.getElementById('chkProShowLines') as HTMLInputElement | null;
    if (chkNames) chkNames.checked = this.proShowNames;
    if (chkNums) chkNums.checked = this.proShowNumbers;
    if (chkLines) chkLines.checked = this.proShowTacticalLines;

    // Bottom dock state: Undo/Redo, Zoom, Compare, Voice
    const undoBtn = document.getElementById('btnTacProUndo') as HTMLButtonElement | null;
    const redoBtn = document.getElementById('btnTacProRedo') as HTMLButtonElement | null;
    if (undoBtn) undoBtn.disabled = this.proHistory.undoStack.length === 0;
    if (redoBtn) redoBtn.disabled = this.proHistory.redoStack.length === 0;

    const zoomLbl = document.getElementById('tacProZoomLabel');
    if (zoomLbl) zoomLbl.textContent = `${this.proZoomPct}%`;

    const cmpBtn = document.getElementById('btnTacProCompare');
    if (cmpBtn) cmpBtn.classList.toggle('active', Boolean(this.activeComparisonId));

    const voiceBtn = document.getElementById('btnTacProVoice');
    if (voiceBtn) voiceBtn.classList.toggle('active', this.voiceEnabled);

    const libBtn = document.getElementById('btnTacProLibrary');
    if (libBtn) libBtn.classList.toggle('active', this.proLibraryOpen);

    // Mobile drawer classes
    const overlay = document.getElementById('tacFullscreenOverlay');
    if (overlay) {
      overlay.classList.toggle('drawer-left-open', this.proMobileDrawer === 'left');
      overlay.classList.toggle('drawer-right-open', this.proMobileDrawer === 'right');
    }
  }

  private renderProLeftPanel(): void {
    const body = document.getElementById('tacProLeftBody');
    if (!body) return;
    const curForm = this.getCurrentFormation();

    if (this.proSection === 'formations') {
      const sizes: PitchSizeId[] = ['6v6', '5v5', '7v7', '11v11'];
      const forms = FORMATIONS_CATALOG[this.prefs.size];
      body.innerHTML = `
        <div class="tac-pro-size-row" role="group" aria-label="حجم الملعب">
          ${sizes
            .map(
              (sz) =>
                `<button type="button" data-pro-size="${sz}" class="tac-pro-size-chip ${sz === this.prefs.size ? 'active' : ''}" dir="ltr">${sz}</button>`
            )
            .join('')}
        </div>
        <div class="tac-pro-form-list" role="listbox" aria-label="قائمة التشكيلات">
          ${forms
            .map((f) => {
              const active = f.id === curForm.id;
              return `<button type="button" data-pro-formation="${escapeHtml(f.id)}" class="tac-pro-form-card ${active ? 'active' : ''}" aria-selected="${active ? 'true' : 'false'}">
                ${renderFormationMiniPitchSvg(f)}
                <div class="tac-pro-form-meta">
                  <span class="tac-pro-form-code"><bdi dir="ltr">${escapeHtml(f.id)}</bdi></span>
                  <span class="tac-pro-form-sub">${escapeHtml(f.tagline)}</span>
                </div>
                ${active ? '<span class="tac-pro-form-check" aria-hidden="true">✓</span>' : ''}
              </button>`;
            })
            .join('')}
        </div>
        <button type="button" id="btnTacProNewFormation" class="tac-pro-new-btn">
          <span>+ تشكيل جديد</span>
        </button>
      `;
      return;
    }

    if (this.proSection === 'plans') {
      const phases: Array<{ id: TacticalPhaseId; label: string; desc: string }> = [
        { id: 'attack', label: 'الهجوم والبناء', desc: 'توسيع العرض وفتح زوايا التمرير' },
        { id: 'defend', label: 'الدفاع والتغطية', desc: 'إغلاق العمق وحماية المرمى' },
        { id: 'gegenpress', label: 'الضغط العكسي', desc: 'استعادة الكرة خلال 5 ثوانٍ' },
        { id: 'counter', label: 'التحول السريع', desc: 'انطلاقة مباشرة للمساحات الفارغة' },
        { id: 'highpress', label: 'الضغط العالي', desc: 'خنق بناء الخصم من منطقته' },
        { id: 'possession', label: 'الاستحواذ والمثلثات', desc: 'تدوير الكرة وبناء مثلثات آمنة' },
        { id: 'setpieces', label: 'الكرات الثابتة', desc: 'تنظيم الركنيات والضربات الحرة' },
      ];
      body.innerHTML = `
        <div class="tac-pro-panel-head">خطط اللعب — <bdi dir="ltr">${escapeHtml(curForm.id)}</bdi></div>
        <div class="tac-pro-stack">
          ${phases
            .map(
              (p) => `<button type="button" data-pro-phase="${p.id}" class="tac-pro-list-item ${this.phase === p.id && !this.activeScenarioId ? 'active' : ''}">
                <strong>${p.label}</strong>
                <span>${p.desc}</span>
              </button>`
            )
            .join('')}
        </div>
      `;
      return;
    }

    if (this.proSection === 'moves') {
      const stepNo = this.frameIdx + 1;
      const totalSteps = Math.max(1, this.sequence.frames.length);
      body.innerHTML = `
        <div class="tac-pro-panel-head">الحركات التكتيكية والتسجيل</div>
        <div class="tac-pro-move-card">
          <div class="tac-pro-move-row">
            <span>الخطوة الحالية</span>
            <strong dir="ltr">${stepNo} / ${totalSteps}</strong>
          </div>
          <div class="tac-pro-move-btns">
            <button type="button" data-pro-move="prev" class="tac-pro-mini-btn">⏮ السابق</button>
            <button type="button" data-pro-move="play" class="tac-pro-mini-btn is-gold">${this.isPlaying ? '⏸ إيقاف' : '▶ تشغيل'}</button>
            <button type="button" data-pro-move="next" class="tac-pro-mini-btn">التالي ⏭</button>
            <button type="button" data-pro-move="replay" class="tac-pro-mini-btn">↻ إعادة</button>
          </div>
          <div class="tac-pro-move-row" style="margin-top:8px;">
            <span>السرعة</span>
            <div class="tac-pro-speed-pills">
              ${[0.5, 1, 1.5]
                .map(
                  (sp) =>
                    `<button type="button" data-pro-speed="${sp}" class="tac-pro-size-chip ${this.speed === sp ? 'active' : ''}" dir="ltr">${sp}x</button>`
                )
                .join('')}
            </div>
          </div>
        </div>
        <div class="tac-pro-move-card" style="margin-top:8px;">
          <div class="tac-pro-move-row">
            <strong>🎥 تسجيل حركة خاصة</strong>
            <span class="tac-pro-badge">${this.recordedFrames.length} لقطات</span>
          </div>
          <p class="tac-pro-hint">اسحب اللاعبين ثم اضغط التقاط لقطة لبناء حركة متحركة كاملة.</p>
          <div class="tac-pro-move-btns">
            <button type="button" data-pro-rec="capture" class="tac-pro-mini-btn is-gold">+ التقاط لقطة</button>
            <button type="button" data-pro-rec="preview" class="tac-pro-mini-btn">▶ معاينة</button>
            <button type="button" data-pro-rec="pop" class="tac-pro-mini-btn">↩ حذف أخيرة</button>
            <button type="button" data-pro-rec="save" class="tac-pro-mini-btn">💾 حفظ</button>
          </div>
          <div class="tac-pro-move-btns" style="margin-top:6px;">
            <button type="button" data-pro-lab="ghost-theater" class="tac-pro-mini-btn is-gold">👻 مسرح الشبح</button>
            <button type="button" data-pro-lab="ghost-link" class="tac-pro-mini-btn">🔗 رابط الشبح</button>
            <button type="button" data-pro-lab="ghost-webm" class="tac-pro-mini-btn">🎬 WebM</button>
          </div>
        </div>
      `;
      return;
    }

    if (this.proSection === 'learn') {
      body.innerHTML = `
        <div class="tac-pro-panel-head">المراحل والسيناريوهات التدريبية (10)</div>
        <div class="tac-pro-stack">
          ${TACTICAL_SCENARIOS_10.map(
            (sc, idx) => `<button type="button" data-pro-scenario="${escapeHtml(sc.id)}" class="tac-pro-list-item ${this.activeScenarioId === sc.id ? 'active' : ''}">
              <strong>${idx + 1}. ${escapeHtml(sc.title)}</strong>
              <span>${escapeHtml(sc.category)} • ${sc.frames.length} مراحل</span>
            </button>`
          ).join('')}
        </div>
      `;
      return;
    }

    if (this.proSection === 'lab') {
      body.innerHTML = `
        <div class="tac-pro-panel-head">🧠 مختبر الذكاء التكتيكي (5 منظومات)</div>
        <div class="tac-pro-stack">
          <div class="tac-pro-move-card">
            <div class="tac-pro-move-row">
              <strong>1. 🔬 أشعة X للسيطرة</strong>
              <span class="tac-pro-badge">${this.xrayEnabled ? 'مفعّلة الآن' : 'جاهزة'}</span>
            </div>
            <p class="tac-pro-hint">تحليل السيطرة على المساحات وظلال التغطية وخطوط التمرير مباشرة فوق الملعب.</p>
            <button type="button" data-pro-lab="xray" class="tac-pro-mini-btn ${this.xrayEnabled ? 'is-gold' : ''}" style="width:100%;">
              ${this.xrayEnabled ? '✓ إيقاف أشعة X' : '🔬 تشغيل أشعة X فوق الملعب'}
            </button>
          </div>
          <div class="tac-pro-move-card">
            <strong>2. 👁️ رادار الزاوية العمياء (Blind-Side)</strong>
            <p class="tac-pro-hint">تمرين مسح بصري سريع واتخاذ القرار الصحيح تحت الضغط مع توجيه صوتي مكاني.</p>
            <button type="button" data-pro-lab="radar" class="tac-pro-mini-btn is-gold" style="width:100%;">فتح رادار الزاوية العمياء</button>
          </div>
          <div class="tac-pro-move-card">
            <strong>3. 👻 خطط الشبح والتحدّي (Ghost Play)</strong>
            <p class="tac-pro-hint">مسرح تفاعلي لتحدّي إيقاف الخطة + رابط فوري بدون دخول + تصدير WebM.</p>
            <div class="tac-pro-move-btns">
              <button type="button" data-pro-lab="ghost-theater" class="tac-pro-mini-btn is-gold">🎬 مسرح الشبح</button>
              <button type="button" data-pro-lab="ghost-link" class="tac-pro-mini-btn">🔗 رابط الشبح</button>
            </div>
          </div>
          <div class="tac-pro-move-card">
            <strong>4. ⚔️ مواجهة 1 ضد 1 الذكية (GTO Duel)</strong>
            <p class="tac-pro-hint">مدافع متكيّف يكتشف تكرار مراوغاتك ويدرّبك على التنويع الذكي.</p>
            <button type="button" data-pro-lab="duel" class="tac-pro-mini-btn is-gold" style="width:100%;">فتح مواجهة 1 ضد 1</button>
          </div>
          <div class="tac-pro-move-card">
            <strong>5. ⏱️ غرفة الدكة (Pit-Wall Rotation)</strong>
            <p class="tac-pro-hint">خطة تبديلات عادلة + منحنى إجهاد + مؤقّت أوفلاين بالاهتزاز وتثبيت الشاشة.</p>
            <button type="button" data-pro-lab="pitwall" class="tac-pro-mini-btn is-gold" style="width:100%;">فتح غرفة الدكة (Pit-Wall)</button>
          </div>
        </div>
      `;
      return;
    }

    // Captain Tools section inside Pro Mode
    const players = this.ctx?.getPlayers() || [];
    const readiness = this.ctx?.getReadiness ? this.ctx.getReadiness() : [];
    const teamName = this.ctx?.getTeamSettings().teamName || 'ميدان 6v6';
    const split = splitFairTeams(players, teamName, readiness);
    const smart = suggestSmartLineup(players, curForm, readiness);
    const chem = computeTeamChemistry(curForm, this.getAssignedPlayersForCurrentFormation());
    body.innerHTML = `
      <div class="tac-pro-panel-head">أدوات الكابتن</div>
      <div class="tac-pro-stack">
        <div class="tac-pro-move-card">
          <strong>التشكيلة الذكية المقترحة</strong>
          <p class="tac-pro-hint">${smart.assignedCount} / ${curForm.slots.length} مركز جاهز • التناغم الحالي ${chem.totalPct}%</p>
          <button type="button" data-pro-cap-act="apply-smart" class="tac-pro-mini-btn is-gold" style="width:100%;">تطبيق التشكيلة المقترحة</button>
        </div>
        <div class="tac-pro-move-card">
          <strong>التقسيمة العادلة السريعة</strong>
          <p class="tac-pro-hint">الفريق الذهبي (${split.gold.length}) مقابل الفضي (${split.silver.length}) • فارق ${split.diff.toFixed(1)}</p>
          <button type="button" data-pro-cap-act="copy-split" class="tac-pro-mini-btn" style="width:100%;">نسخ التقسيمة لواتساب</button>
        </div>
        <div class="tac-pro-move-card">
          <strong>غرفة الدكة والتبديلات (Pit-Wall)</strong>
          <p class="tac-pro-hint">المؤقّت السريع (<span dir="ltr">${this.formatClock(this.timerSecondsLeft)}</span>) + جدول تبديلات عادل ومنحنى إجهاد</p>
          <div class="tac-pro-move-btns" style="margin-top:6px;">
            <button type="button" data-pro-lab="pitwall" class="tac-pro-mini-btn is-gold">⏱️ فتح Pit-Wall</button>
            <button type="button" data-pro-cap-act="timer-toggle" class="tac-pro-mini-btn">${this.timerRunning ? 'إيقاف' : 'تشغيل'}</button>
            <button type="button" data-pro-cap-act="timer-reset" class="tac-pro-mini-btn">تصفير</button>
          </div>
        </div>
        <button type="button" data-pro-cap-act="publish" class="tac-pro-mini-btn is-gold" style="width:100%;">نشر التشكيلة الرسمية للفريق</button>
      </div>
    `;
  }

  private renderProSettingsPopover(): void {
    const pop = document.getElementById('tacProSettingsPop');
    if (!pop) return;
    if (!this.proSettingsOpen) {
      pop.classList.add('hidden');
      return;
    }
    pop.classList.remove('hidden');
    pop.innerHTML = `
      <div class="tac-pro-pop-title">إعدادات استوديو التكبير</div>
      <div class="tac-pro-pop-row">
        <span>إظهار فريق الخصم</span>
        <button type="button" data-pro-set="opponents" class="tac-pro-mini-btn ${this.showOpponents ? 'is-gold' : ''}">${this.showOpponents ? 'مفعّل' : 'مخفي'}</button>
      </div>
      <div class="tac-pro-pop-row">
        <span>مثلثات التمرير</span>
        <button type="button" data-pro-set="triangles" class="tac-pro-mini-btn ${this.showTriangles ? 'is-gold' : ''}">${this.showTriangles ? 'مفعّل' : 'مخفي'}</button>
      </div>
      <div class="tac-pro-pop-row">
        <span>الرسومات المضافة (${this.proAnnotations.length})</span>
        <button type="button" data-pro-set="clear-draw" class="tac-pro-mini-btn">مسح الكل</button>
      </div>
      <div class="tac-pro-pop-row">
        <span>إعادة ضبط المواقع</span>
        <button type="button" data-pro-set="reset-pos" class="tac-pro-mini-btn">استعادة</button>
      </div>
    `;
  }

  private renderProLibraryModal(): void {
    const pop = document.getElementById('tacProLibraryPop');
    if (!pop) return;
    if (!this.proLibraryOpen) {
      pop.classList.add('hidden');
      return;
    }
    pop.classList.remove('hidden');
    const plans = this.prefs.customPlans;
    pop.innerHTML = `
      <div class="tac-pro-pop-head">
        <strong>📁 مكتبة الخطط المحفوظة (${plans.length})</strong>
        <button type="button" id="btnTacProCloseLib" class="tac-pro-cmp-pill">✕</button>
      </div>
      ${
        plans.length
          ? `<div class="tac-pro-stack" style="max-height:240px;overflow-y:auto;">
              ${plans
                .map(
                  (p) => `<div class="tac-pro-lib-row">
                    <button type="button" data-pro-load-plan="${escapeHtml(p.id)}" class="tac-pro-lib-open">
                      <strong>${escapeHtml(p.name)}</strong>
                      <span><bdi dir="ltr">${escapeHtml(p.size)} • ${escapeHtml(p.formationId)}</bdi> (${p.frames.length} لقطات)</span>
                    </button>
                    <button type="button" data-pro-del-plan="${escapeHtml(p.id)}" class="tac-pro-cmp-pill" title="حذف">🗑</button>
                  </div>`
                )
                .join('')}
            </div>`
          : `<p class="tac-pro-hint" style="margin:10px 0;">لا توجد خطط محفوظة بعد — اضغط «حفظ الخطة» بالأعلى لحفظ التشكيلة والأسهم الحالية.</p>`
      }
    `;
  }

  private renderProFullscreenOverlay(): void {
    if (!this.isProFullscreen) return;
    this.syncProViewModeHost();
    this.renderViewModeTabs();
    this.renderProPitchOnly();
    this.renderProLeftPanel();
    this.renderProControlsState();
    this.renderProSettingsPopover();
    this.renderProLibraryModal();
  }

  private handleProOverlayToolPointerDown(
    svg: SVGSVGElement,
    e: PointerEvent,
    reRender: () => void
  ): boolean {
    if (this.proMobileDrawer !== 'none') {
      this.proMobileDrawer = 'none';
      this.renderProControlsState();
    }
    if (this.proSettingsOpen || this.proLibraryOpen) {
      this.proSettingsOpen = false;
      this.proLibraryOpen = false;
      this.renderProSettingsPopover();
      this.renderProLibraryModal();
    }

    const pt = projectProClientToPortraitPct(e.clientX, e.clientY, svg.getBoundingClientRect());

    // 1. Eraser tool -> delete clicked annotation
    if (this.proTool === 'erase') {
      const directEl = (e.target as Element | null)?.closest('[data-pro-ann-id]');
      const hitId = directEl?.getAttribute('data-pro-ann-id') || hitTestProAnnotation(this.proAnnotations, pt);
      if (hitId) {
        this.pushCurrentBoardHistory();
        this.proAnnotations = this.proAnnotations.filter((a) => a.id !== hitId);
        reRender();
        this.renderProControlsState();
      } else {
        this.ctx?.toast('اضغط على سهم أو شكل أو مخروط لحذفه');
      }
      e.preventDefault();
      return true;
    }

    // 2. Single-click stamp tools (cone, flag, extra ball)
    if (isSingleClickStampTool(this.proTool)) {
      this.pushCurrentBoardHistory();
      this.proAnnotations.push({
        id: 'ann_' + Date.now() + '_' + Math.floor(Math.random() * 999),
        kind: this.proTool as ProAnnotationKind,
        x1: pt.x,
        y1: pt.y,
        x2: pt.x,
        y2: pt.y,
        color: defaultColorForTool(this.proTool),
      });
      reRender();
      this.renderProControlsState();
      e.preventDefault();
      return true;
    }

    // 3. Drag-to-draw vector tools (arrow, path, circle, rect, triangle, zone)
    if (isDrawingTool(this.proTool)) {
      this.pause();
      this.proDrawStartPortrait = pt;
      this.activeBoardOverlaySvg = svg;
      this.proDraftAnnotation = {
        id: 'draft',
        kind: this.proTool as ProAnnotationKind,
        x1: pt.x,
        y1: pt.y,
        x2: pt.x,
        y2: pt.y,
        color: defaultColorForTool(this.proTool),
      };
      try {
        svg.setPointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      reRender();
      e.preventDefault();
      return true;
    }

    return false;
  }

  private handleProPointerDown = (e: PointerEvent): void => {
    const svg = document.getElementById('tacProPitchSvg') as unknown as SVGSVGElement | null;
    if (!svg) return;

    if (
      this.handleProOverlayToolPointerDown(svg, e, () => {
        if (this.proDraftAnnotation) this.renderProPitchOnly();
        else this.renderSvgPitch();
      })
    ) {
      return;
    }

    // 4. Pointer / Move tool -> drag player or ball token
    const token = (e.target as Element | null)?.closest('[data-pro-drag-kind]') as SVGElement | null;
    if (!token) return;
    const kind = token.getAttribute('data-pro-drag-kind') as 'our' | 'opp' | 'ball' | null;
    const idx = Number(token.getAttribute('data-pro-drag-idx') || '0');
    if (!kind) return;

    this.pause();
    this.dragTarget = { kind, idx };
    this.dragStartClient = { x: e.clientX, y: e.clientY };
    this.dragMoved = false;
    this.proDragSnapshotTaken = false;
    try {
      svg.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    this.renderProPitchOnly();
    e.preventDefault();
  };

  private handleProPointerMove = (e: PointerEvent): void => {
    const svg = document.getElementById('tacProPitchSvg') as unknown as SVGSVGElement | null;
    if (!svg) return;

    if (this.proDraftAnnotation && this.proDrawStartPortrait) {
      const pt = projectProClientToPortraitPct(e.clientX, e.clientY, svg.getBoundingClientRect());
      this.proDraftAnnotation = {
        ...this.proDraftAnnotation,
        x2: pt.x,
        y2: pt.y,
      };
      this.renderProPitchOnly();
      return;
    }

    if (!this.dragTarget) return;
    const dist = Math.hypot(e.clientX - this.dragStartClient.x, e.clientY - this.dragStartClient.y);
    if (dist > 5) this.dragMoved = true;
    if (!this.dragMoved) return;

    if (!this.proDragSnapshotTaken) {
      this.pushCurrentBoardHistory();
      this.proDragSnapshotTaken = true;
    }
    const pt = projectProClientToPortraitPct(e.clientX, e.clientY, svg.getBoundingClientRect());
    if (this.dragTarget.kind === 'our' && this.currentOur[this.dragTarget.idx]) {
      this.currentOur[this.dragTarget.idx] = pt;
    } else if (this.dragTarget.kind === 'opp' && this.currentOpp[this.dragTarget.idx]) {
      this.currentOpp[this.dragTarget.idx] = pt;
    } else if (this.dragTarget.kind === 'ball') {
      this.currentBall = pt;
    }
    this.renderSvgPitch();
  };

  private handleProPointerUp = (e: PointerEvent): void => {
    const svg = document.getElementById('tacProPitchSvg') as unknown as SVGSVGElement | null;
    if (svg) {
      try {
        svg.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    }

    if (this.proDraftAnnotation) {
      const fin = this.proDraftAnnotation;
      this.proDraftAnnotation = null;
      this.proDrawStartPortrait = null;
      if (Math.hypot(fin.x2 - fin.x1, fin.y2 - fin.y1) >= 2.2) {
        this.pushCurrentBoardHistory();
        this.proAnnotations.push({
          ...fin,
          id: 'ann_' + Date.now() + '_' + Math.floor(Math.random() * 999),
        });
      }
      this.renderSvgPitch();
      this.renderProControlsState();
      return;
    }

    if (!this.dragTarget) return;
    const released = this.dragTarget;
    const wasDrag = this.dragMoved;
    this.dragTarget = null;
    this.dragMoved = false;
    this.renderSvgPitch();

    if (!wasDrag && released.kind === 'our' && this.proTool === 'pointer') {
      this.enterRoleSpotlight(released.idx);
    }
  };

  private bindProFullscreenEvents(): void {
    // Back / Exit Fullscreen
    document.getElementById('btnTacProBack')?.addEventListener('click', () => this.exitProFullscreen());
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isProFullscreen) {
        if (this.proSettingsOpen || this.proLibraryOpen) {
          this.proSettingsOpen = false;
          this.proLibraryOpen = false;
          this.renderProSettingsPopover();
          this.renderProLibraryModal();
        } else {
          this.exitProFullscreen();
        }
      }
    });

    // Top bar: Save, Play/Pause, Settings
    document.getElementById('btnTacProSave')?.addEventListener('click', () => this.proSaveCurrentPlan());
    document.getElementById('btnTacProPlay')?.addEventListener('click', () => {
      if (!this.isInteractivePitchMode()) {
        this.viewMode = 'studio';
        this.renderAll();
      }
      if (this.isPlaying) this.pause();
      else this.play();
      this.renderProControlsState();
    });
    document.getElementById('btnTacProSettings')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.proLibraryOpen = false;
      this.proSettingsOpen = !this.proSettingsOpen;
      this.renderProLibraryModal();
      this.renderProSettingsPopover();
    });

    // Settings popover delegation
    document.getElementById('tacProSettingsPop')?.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-pro-set]');
      if (!btn?.dataset.proSet) return;
      const act = btn.dataset.proSet;
      if (act === 'opponents') {
        this.showOpponents = !this.showOpponents;
      } else if (act === 'triangles') {
        this.showTriangles = !this.showTriangles;
      } else if (act === 'clear-draw') {
        if (this.proAnnotations.length) {
          this.pushCurrentBoardHistory();
          this.proAnnotations = [];
          this.ctx?.toast('تم مسح جميع الرسومات التكتيكية');
        }
      } else if (act === 'reset-pos') {
        this.pushCurrentBoardHistory();
        this.loadCurrentPhaseSequence(false);
        this.ctx?.toast('تمت استعادة التمركز الافتراضي');
      }
      this.renderAll();
    });

    // 5 Top Section Tabs
    document.querySelectorAll<HTMLButtonElement>('[data-pro-section]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const sec = btn.dataset.proSection as ProSectionTab | undefined;
        if (!sec) return;
        this.proSection = sec;
        if (window.innerWidth < 1024) {
          this.proMobileDrawer = 'left';
        }
        this.renderProLeftPanel();
        this.renderProControlsState();
      });
    });

    // Mobile drawer toggle buttons + backdrop
    document.getElementById('btnTacProMobLeft')?.addEventListener('click', () => {
      this.proMobileDrawer = this.proMobileDrawer === 'left' ? 'none' : 'left';
      this.renderProControlsState();
    });
    document.getElementById('btnTacProMobRight')?.addEventListener('click', () => {
      this.proMobileDrawer = this.proMobileDrawer === 'right' ? 'none' : 'right';
      this.renderProControlsState();
    });
    document.getElementById('tacProDrawerBackdrop')?.addEventListener('click', () => {
      this.proMobileDrawer = 'none';
      this.renderProControlsState();
    });

    // Left panel delegation (formations, sizes, phases, moves, scenarios, captain tools)
    document.getElementById('tacProLeftBody')?.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const szBtn = target.closest<HTMLButtonElement>('[data-pro-size]');
      if (szBtn?.dataset.proSize) {
        this.setPitchSize(szBtn.dataset.proSize as PitchSizeId);
        return;
      }
      const formBtn = target.closest<HTMLButtonElement>('[data-pro-formation]');
      if (formBtn?.dataset.proFormation) {
        this.pushCurrentBoardHistory();
        this.onFormationSelectChanged(formBtn.dataset.proFormation);
        if (window.innerWidth < 1024) this.proMobileDrawer = 'none';
        this.renderProControlsState();
        return;
      }
      if (target.closest('#btnTacProNewFormation')) {
        this.proSection = 'moves';
        this.captureCustomFrame();
        this.renderProLeftPanel();
        this.renderProControlsState();
        return;
      }
      const phBtn = target.closest<HTMLButtonElement>('[data-pro-phase]');
      if (phBtn?.dataset.proPhase) {
        this.phase = phBtn.dataset.proPhase as TacticalPhaseId;
        this.activeScenarioId = null;
        this.activeComparisonId = null;
        this.spotlightSlotIdx = null;
        this.spotlightInfo = null;
        this.loadCurrentPhaseSequence(true);
        if (window.innerWidth < 1024) this.proMobileDrawer = 'none';
        this.renderAll();
        return;
      }
      const moveBtn = target.closest<HTMLButtonElement>('[data-pro-move]');
      if (moveBtn?.dataset.proMove) {
        const m = moveBtn.dataset.proMove;
        if (m === 'prev') this.stepPrev();
        else if (m === 'next') this.stepNext();
        else if (m === 'replay') this.replay();
        else if (m === 'play') {
          if (this.isPlaying) this.pause();
          else this.play();
        }
        this.renderProFullscreenOverlay();
        return;
      }
      const spBtn = target.closest<HTMLButtonElement>('[data-pro-speed]');
      if (spBtn?.dataset.proSpeed) {
        this.speed = Number(spBtn.dataset.proSpeed) || 1;
        this.renderTimelineButtons();
        this.renderProLeftPanel();
        return;
      }
      const recBtn = target.closest<HTMLButtonElement>('[data-pro-rec]');
      if (recBtn?.dataset.proRec) {
        const r = recBtn.dataset.proRec;
        if (r === 'capture') this.captureCustomFrame();
        else if (r === 'preview') this.playRecordedDraft();
        else if (r === 'pop') this.popCustomFrame();
        else if (r === 'save') this.proSaveCurrentPlan();
        this.renderProLeftPanel();
        return;
      }
      const scBtn = target.closest<HTMLButtonElement>('[data-pro-scenario]');
      if (scBtn?.dataset.proScenario) {
        this.loadScenario(scBtn.dataset.proScenario);
        if (window.innerWidth < 1024) this.proMobileDrawer = 'none';
        this.renderProFullscreenOverlay();
        return;
      }
      const labBtn = target.closest<HTMLButtonElement>('[data-pro-lab]');
      if (labBtn?.dataset.proLab) {
        const key = labBtn.dataset.proLab;
        if (key === 'xray') this.toggleXRayMode();
        else if (key === 'radar') this.openUnifiedLab('radar');
        else if (key === 'duel') this.openUnifiedLab('duel');
        else if (key === 'pitwall') this.openUnifiedLab('pitwall');
        else if (key === 'ghost-theater') this.openActiveGhostTheater();
        else if (key === 'ghost-link') this.copyActiveGhostLink();
        else if (key === 'ghost-webm') void this.exportActiveGhostWebm();
        return;
      }
      const capBtn = target.closest<HTMLButtonElement>('[data-pro-cap-act]');
      if (capBtn?.dataset.proCapAct) {
        const act = capBtn.dataset.proCapAct;
        if (act === 'apply-smart' && this.ctx) {
          if (!this.ctx.isAdmin()) {
            this.ctx.toast('تطبيق التشكيلة الذكية متاح للكابتن فقط', true);
            return;
          }
          const form = this.getCurrentFormation();
          const smart = suggestSmartLineup(this.ctx.getPlayers(), form, this.ctx.getReadiness ? this.ctx.getReadiness() : []);
          Object.entries(smart.slots).forEach(([key, pid]) => {
            const idx = Number(key.split('_').pop() || '0');
            this.setSlotPlayerId(form.id, idx, pid);
          });
          this.ctx.toast('تم تطبيق التشكيلة الذكية المقترحة ✓');
          this.renderAll();
        } else if (act === 'copy-split' && this.ctx) {
          const teamName = this.ctx.getTeamSettings().teamName || 'ميدان 6v6';
          const split = splitFairTeams(this.ctx.getPlayers(), teamName, this.ctx.getReadiness ? this.ctx.getReadiness() : []);
          navigator.clipboard?.writeText(split.whatsappText).catch(() => {});
          this.ctx.toast('تم نسخ التقسيمة العادلة ✓');
        } else if (act === 'timer-toggle') {
          if (this.timerRunning) this.pauseRotationTimer();
          else this.startRotationTimer();
          this.renderProLeftPanel();
        } else if (act === 'timer-reset') {
          this.resetRotationTimer();
          this.renderProLeftPanel();
        } else if (act === 'publish' && this.ctx?.onPublishLineup) {
          void this.ctx.onPublishLineup(this.getCurrentLineupPayload());
        }
      }
    });

    // Right panel: Drawing & Advanced tools
    document.querySelectorAll<HTMLButtonElement>('[data-pro-tool]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tool = btn.dataset.proTool as ProBoardTool | undefined;
        if (!tool) return;
        this.proTool = tool;
        if (window.innerWidth < 1024 && tool !== 'pointer') {
          this.proMobileDrawer = 'none';
        }
        this.renderProControlsState();
      });
    });

    // Display options checkboxes (applied across all 4 Full-Screen display modes)
    const refreshDisplayForActiveMode = () => {
      if (this.viewMode === 'studio') this.renderProPitchOnly();
      else this.renderActiveViewBody();
    };
    document.getElementById('chkProShowNames')?.addEventListener('change', (e) => {
      this.proShowNames = (e.target as HTMLInputElement).checked;
      refreshDisplayForActiveMode();
    });
    document.getElementById('chkProShowNumbers')?.addEventListener('change', (e) => {
      this.proShowNumbers = (e.target as HTMLInputElement).checked;
      refreshDisplayForActiveMode();
    });
    document.getElementById('chkProShowLines')?.addEventListener('change', (e) => {
      this.proShowTacticalLines = (e.target as HTMLInputElement).checked;
      refreshDisplayForActiveMode();
    });

    // Live caption comparison toggle delegation
    document.getElementById('tacProLiveCaption')?.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('[data-pro-cmp-close]')) {
        this.exitComparisonMode();
        this.renderProFullscreenOverlay();
        return;
      }
      const vBtn = t.closest<HTMLButtonElement>('[data-pro-cmp-var]');
      if (vBtn?.dataset.proCmpVar === 'mistake' || vBtn?.dataset.proCmpVar === 'correct') {
        this.setComparisonVariant(vBtn.dataset.proCmpVar);
        this.renderProFullscreenOverlay();
      }
    });

    // Bottom Dock actions
    document.getElementById('btnTacProLibrary')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.proSettingsOpen = false;
      this.proLibraryOpen = !this.proLibraryOpen;
      this.renderProSettingsPopover();
      this.renderProLibraryModal();
      this.renderProControlsState();
    });
    document.getElementById('tacProLibraryPop')?.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('#btnTacProCloseLib')) {
        this.proLibraryOpen = false;
        this.renderProLibraryModal();
        this.renderProControlsState();
        return;
      }
      const loadBtn = t.closest<HTMLButtonElement>('[data-pro-load-plan]');
      if (loadBtn?.dataset.proLoadPlan) {
        this.loadCustomPlan(loadBtn.dataset.proLoadPlan);
        this.proLibraryOpen = false;
        this.renderProFullscreenOverlay();
        return;
      }
      const delBtn = t.closest<HTMLButtonElement>('[data-pro-del-plan]');
      if (delBtn?.dataset.proDelPlan) {
        this.prefs.customPlans = this.prefs.customPlans.filter((p) => p.id !== delBtn.dataset.proDelPlan);
        savePrefs(this.prefs);
        this.renderRecorderPanel();
        this.renderProLibraryModal();
        this.ctx?.toast('تم حذف الخطة من المكتبة');
      }
    });

    document.getElementById('btnTacProScenarios')?.addEventListener('click', () => {
      this.proSection = 'learn';
      if (window.innerWidth < 1024) this.proMobileDrawer = 'left';
      this.renderProLeftPanel();
      this.renderProControlsState();
    });

    document.getElementById('btnTacProUndo')?.addEventListener('click', () => this.proUndo());
    document.getElementById('btnTacProRedo')?.addEventListener('click', () => this.proRedo());

    document.getElementById('btnTacProZoomOut')?.addEventListener('click', () => {
      this.proZoomPct = clampProZoomPct(this.proZoomPct - 15);
      this.renderProControlsState();
    });
    document.getElementById('btnTacProZoomIn')?.addEventListener('click', () => {
      this.proZoomPct = clampProZoomPct(this.proZoomPct + 15);
      this.renderProControlsState();
    });
    document.getElementById('tacProZoomLabel')?.addEventListener('click', () => {
      this.proZoomPct = 100;
      this.renderProControlsState();
    });

    document.getElementById('btnTacProCompare')?.addEventListener('click', () => {
      if (this.activeComparisonId) this.exitComparisonMode();
      else this.enterComparisonMode(undefined, 'mistake');
      this.renderProFullscreenOverlay();
    });

    document.getElementById('btnTacProVoice')?.addEventListener('click', () => {
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
      this.renderProControlsState();
    });

    document.getElementById('btnTacProShare')?.addEventListener('click', () => {
      void this.shareLineupOnWhatsApp();
    });

    // Pro SVG Pitch Pointer Events
    const proSvg = document.getElementById('tacProPitchSvg') as unknown as SVGSVGElement | null;
    if (proSvg) {
      proSvg.addEventListener('pointerdown', this.handleProPointerDown);
      proSvg.addEventListener('pointermove', this.handleProPointerMove);
      proSvg.addEventListener('pointerup', this.handleProPointerUp);
      proSvg.addEventListener('pointercancel', this.handleProPointerUp);
    }

    // Poster & Midan Cards Full-Screen Annotation Overlay SVGs
    const bindBoardOverlaySvg = (svgId: string, defsPrefix: string) => {
      const overlaySvg = document.getElementById(svgId) as unknown as SVGSVGElement | null;
      if (!overlaySvg) return;
      overlaySvg.addEventListener('pointerdown', (e) => {
        if (!shouldBoardOverlayInterceptPointer(this.isProFullscreen, this.proTool)) return;
        this.handleProOverlayToolPointerDown(overlaySvg, e, () => {
          this.renderBoardAnnotationsOverlay(svgId, defsPrefix);
        });
      });
      overlaySvg.addEventListener('pointermove', (e) => {
        if (!this.proDraftAnnotation || !this.proDrawStartPortrait || this.activeBoardOverlaySvg !== overlaySvg) {
          return;
        }
        const pt = projectProClientToPortraitPct(e.clientX, e.clientY, overlaySvg.getBoundingClientRect());
        this.proDraftAnnotation = {
          ...this.proDraftAnnotation,
          x2: pt.x,
          y2: pt.y,
        };
        this.renderBoardAnnotationsOverlay(svgId, defsPrefix);
      });
      const finishOverlayStroke = (e: PointerEvent) => {
        if (!this.proDraftAnnotation || this.activeBoardOverlaySvg !== overlaySvg) return;
        try {
          overlaySvg.releasePointerCapture(e.pointerId);
        } catch {
          // ignore
        }
        const fin = this.proDraftAnnotation;
        this.proDraftAnnotation = null;
        this.proDrawStartPortrait = null;
        this.activeBoardOverlaySvg = null;
        if (Math.hypot(fin.x2 - fin.x1, fin.y2 - fin.y1) >= 2.2) {
          this.pushCurrentBoardHistory();
          this.proAnnotations.push({
            ...fin,
            id: 'ann_' + Date.now() + '_' + Math.floor(Math.random() * 999),
          });
        }
        this.renderBoardAnnotationsOverlay(svgId, defsPrefix);
        this.renderProControlsState();
      };
      overlaySvg.addEventListener('pointerup', finishOverlayStroke);
      overlaySvg.addEventListener('pointercancel', finishOverlayStroke);
    };
    bindBoardOverlaySvg('tacPosterOverlaySvg', 'posterAnn');
    bindBoardOverlaySvg('tacFifaOverlaySvg', 'fifaAnn');
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

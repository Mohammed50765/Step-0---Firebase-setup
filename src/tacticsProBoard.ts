import type { FormationDef, PitchSizeId, TacticalArrow, TacticalKeyframe } from './tacticsData';
import { escapeHtml } from './security';

export const PRO_SVG_W = 860;
export const PRO_SVG_H = 520;
const PITCH_PAD_X = 48;
const PITCH_PAD_Y = 30;

export type ProSectionTab = 'formations' | 'plans' | 'moves' | 'learn' | 'captain';

export type ProBoardTool =
  | 'pointer'
  | 'move'
  | 'arrow'
  | 'path'
  | 'circle'
  | 'rect'
  | 'triangle'
  | 'erase'
  | 'zone'
  | 'cone'
  | 'flag'
  | 'ball';

export type ProAnnotationKind = 'arrow' | 'path' | 'circle' | 'rect' | 'triangle' | 'zone' | 'cone' | 'flag' | 'ball';

/**
 * Stored in canonical PORTRAIT percentage space (x: 0..100, y: 0..100) so annotations
 * remain 100% lossless when toggling between Normal (portrait) and Full-Screen (landscape) views.
 */
export interface ProAnnotation {
  id: string;
  kind: ProAnnotationKind;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
}

export interface ProBoardSnapshot {
  our: Array<{ x: number; y: number }>;
  opp: Array<{ x: number; y: number }>;
  ball: { x: number; y: number };
  annotations: ProAnnotation[];
}

export interface ProHistoryState {
  undoStack: ProBoardSnapshot[];
  redoStack: ProBoardSnapshot[];
  maxDepth: number;
}

export interface ProDisplayOptions {
  showNames: boolean;
  showNumbers: boolean;
  showTacticalLines: boolean;
  showOpponents: boolean;
  showTriangles: boolean;
}

export interface ProPitchRenderInput {
  size: PitchSizeId;
  formation: FormationDef;
  ourPortrait: Array<{ x: number; y: number }>;
  oppPortrait: Array<{ x: number; y: number }>;
  ballPortrait: { x: number; y: number };
  ourNumbers: string[];
  ourNames: string[];
  activeIndices: ReadonlySet<number>;
  spotlightIdx: number | null;
  focusedIdx: number | null;
  dragTarget: { kind: 'our' | 'opp' | 'ball'; idx: number } | null;
  frame: TacticalKeyframe | undefined;
  display: ProDisplayOptions;
  annotations: ProAnnotation[];
  draftAnnotation: ProAnnotation | null;
  arrowRevealT: number;
  ballLift: number;
  reducedMotion: boolean;
  offsideEnabled: boolean;
  isMistakeCompare: boolean;
}

function clampPct(v: number): number {
  if (!Number.isFinite(v)) return 50;
  return Math.max(2, Math.min(98, v));
}

/**
 * Lossless 90-degree clockwise tactical mapping:
 * Portrait (our GK at bottom y=90, attacking up toward y=10) ->
 * Landscape (our GK at left lx=10, attacking right toward lx=90).
 */
export function portraitToLandscapePct(pt: { x: number; y: number }): { x: number; y: number } {
  return {
    x: clampPct(100 - pt.y),
    y: clampPct(pt.x),
  };
}

/**
 * Exact inverse of portraitToLandscapePct so dragging or drawing in Landscape Pro Mode
 * writes directly back to canonical Portrait state with zero drift.
 */
export function landscapeToPortraitPct(pt: { x: number; y: number }): { x: number; y: number } {
  return {
    x: clampPct(pt.y),
    y: clampPct(100 - pt.x),
  };
}

export function landscapePctToSvg(pt: { x: number; y: number }): { x: number; y: number } {
  const usableW = PRO_SVG_W - PITCH_PAD_X * 2;
  const usableH = PRO_SVG_H - PITCH_PAD_Y * 2;
  return {
    x: PITCH_PAD_X + (clampPct(pt.x) / 100) * usableW,
    y: PITCH_PAD_Y + (clampPct(pt.y) / 100) * usableH,
  };
}

export function portraitPctToProSvg(pt: { x: number; y: number }): { x: number; y: number } {
  return landscapePctToSvg(portraitToLandscapePct(pt));
}

/**
 * Maps a canonical portrait slot coordinate (x: 0..100, y: 0..100) to CSS percentage coordinates
 * for HTML tactical boards (`poster` and `fifa`).
 * - Portrait mode (`isLandscape = false`): preserves exact original portrait slot coordinates.
 * - Landscape mode (`isLandscape = true`): rotates 90° clockwise (GK on Left, ST attacking Right)
 *   with safe interior margins so player cards and avatars never clip the horizontal pitch edges.
 */
export function mapSlotToBoardPct(
  pt: { x: number; y: number },
  isLandscape: boolean
): { x: number; y: number } {
  if (!isLandscape) {
    return { x: pt.x, y: pt.y };
  }
  const rot = portraitToLandscapePct(pt);
  return {
    x: Number((8 + (rot.x / 100) * 84).toFixed(2)),
    y: Number((12 + (rot.y / 100) * 76).toFixed(2)),
  };
}

/**
 * Projects a pointer event (clientX, clientY) on the landscape SVG back into canonical Portrait pct (0..100).
 * Automatically accounts for any CSS scale/zoom because getBoundingClientRect() returns rendered dimensions.
 */
export function projectProClientToPortraitPct(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number }
): { x: number; y: number } {
  const safeW = Math.max(1, rect.width);
  const safeH = Math.max(1, rect.height);
  const svgX = ((clientX - rect.left) / safeW) * PRO_SVG_W;
  const svgY = ((clientY - rect.top) / safeH) * PRO_SVG_H;
  const usableW = PRO_SVG_W - PITCH_PAD_X * 2;
  const usableH = PRO_SVG_H - PITCH_PAD_Y * 2;
  const lx = clampPct(((svgX - PITCH_PAD_X) / usableW) * 100);
  const ly = clampPct(((svgY - PITCH_PAD_Y) / usableH) * 100);
  return landscapeToPortraitPct({ x: lx, y: ly });
}

export function clampProZoomPct(zoomPct: number): number {
  if (!Number.isFinite(zoomPct)) return 100;
  return Math.max(70, Math.min(160, Math.round(zoomPct)));
}

export function isDrawingTool(tool: ProBoardTool): boolean {
  return tool !== 'pointer' && tool !== 'move' && tool !== 'erase';
}

export function isSingleClickStampTool(tool: ProBoardTool): boolean {
  return tool === 'cone' || tool === 'flag' || tool === 'ball';
}

export function shouldBoardOverlayInterceptPointer(isProFullscreen: boolean, tool: ProBoardTool): boolean {
  return isProFullscreen && tool !== 'pointer' && tool !== 'move';
}

export function defaultColorForTool(tool: ProBoardTool): string {
  switch (tool) {
    case 'path':
      return '#FACC15';
    case 'arrow':
      return '#FFFFFF';
    case 'circle':
      return '#38BDF8';
    case 'rect':
      return '#FACC15';
    case 'triangle':
      return '#4ADE80';
    case 'zone':
      return '#38BDF8';
    default:
      return '#FACC15';
  }
}

export function cloneSnapshot(snap: ProBoardSnapshot): ProBoardSnapshot {
  return {
    our: snap.our.map((p) => ({ x: p.x, y: p.y })),
    opp: snap.opp.map((p) => ({ x: p.x, y: p.y })),
    ball: { x: snap.ball.x, y: snap.ball.y },
    annotations: snap.annotations.map((a) => ({ ...a })),
  };
}

export function createHistoryState(maxDepth = 30): ProHistoryState {
  return { undoStack: [], redoStack: [], maxDepth };
}

export function pushHistorySnapshot(state: ProHistoryState, current: ProBoardSnapshot): ProHistoryState {
  const nextUndo = [...state.undoStack, cloneSnapshot(current)];
  if (nextUndo.length > state.maxDepth) nextUndo.shift();
  return {
    undoStack: nextUndo,
    redoStack: [],
    maxDepth: state.maxDepth,
  };
}

export function applyHistoryUndo(
  state: ProHistoryState,
  current: ProBoardSnapshot
): { history: ProHistoryState; restored: ProBoardSnapshot | null } {
  if (!state.undoStack.length) return { history: state, restored: null };
  const nextUndo = state.undoStack.slice(0, -1);
  const restored = cloneSnapshot(state.undoStack[state.undoStack.length - 1]);
  const nextRedo = [...state.redoStack, cloneSnapshot(current)];
  if (nextRedo.length > state.maxDepth) nextRedo.shift();
  return {
    history: { undoStack: nextUndo, redoStack: nextRedo, maxDepth: state.maxDepth },
    restored,
  };
}

export function applyHistoryRedo(
  state: ProHistoryState,
  current: ProBoardSnapshot
): { history: ProHistoryState; restored: ProBoardSnapshot | null } {
  if (!state.redoStack.length) return { history: state, restored: null };
  const nextRedo = state.redoStack.slice(0, -1);
  const restored = cloneSnapshot(state.redoStack[state.redoStack.length - 1]);
  const nextUndo = [...state.undoStack, cloneSnapshot(current)];
  if (nextUndo.length > state.maxDepth) nextUndo.shift();
  return {
    history: { undoStack: nextUndo, redoStack: nextRedo, maxDepth: state.maxDepth },
    restored,
  };
}

function pointToSegmentDist(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-4) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * Finds the topmost annotation near a portrait-space click point for the Eraser tool.
 */
export function hitTestProAnnotation(
  annotations: ProAnnotation[],
  portraitPt: { x: number; y: number },
  tolerancePct = 6.5
): string | null {
  for (let i = annotations.length - 1; i >= 0; i--) {
    const a = annotations[i];
    if (a.kind === 'cone' || a.kind === 'flag' || a.kind === 'ball') {
      if (Math.hypot(portraitPt.x - a.x1, portraitPt.y - a.y1) <= tolerancePct) return a.id;
      continue;
    }
    if (a.kind === 'arrow' || a.kind === 'path') {
      if (pointToSegmentDist(portraitPt.x, portraitPt.y, a.x1, a.y1, a.x2, a.y2) <= tolerancePct) {
        return a.id;
      }
      continue;
    }
    if (a.kind === 'circle') {
      const r = Math.max(3, Math.hypot(a.x2 - a.x1, a.y2 - a.y1));
      const d = Math.hypot(portraitPt.x - a.x1, portraitPt.y - a.y1);
      if (d <= r + tolerancePct * 0.7) return a.id;
      continue;
    }
    // rect, triangle, zone bounding box hit
    const minX = Math.min(a.x1, a.x2) - tolerancePct * 0.5;
    const maxX = Math.max(a.x1, a.x2) + tolerancePct * 0.5;
    const minY = Math.min(a.y1, a.y2) - tolerancePct * 0.5;
    const maxY = Math.max(a.y1, a.y2) + tolerancePct * 0.5;
    if (portraitPt.x >= minX && portraitPt.x <= maxX && portraitPt.y >= minY && portraitPt.y <= maxY) {
      return a.id;
    }
  }
  return null;
}

/**
 * Renders a crisp miniature green tactical pitch thumbnail with formation player dots,
 * matching the left-hand formation list cards in the reference image.
 */
export function renderFormationMiniPitchSvg(formation: FormationDef): string {
  const dots = formation.slots
    .map((slot, idx) => {
      const x = 6 + (clampPct(slot.x) / 100) * 32;
      const y = 6 + (clampPct(slot.y) / 100) * 44;
      const fill = idx === 0 ? '#FACC15' : '#60A5FA';
      return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.35" fill="${fill}" stroke="#07150d" stroke-width="0.65"/>`;
    })
    .join('');

  return `<svg class="tac-pro-mini-pitch" viewBox="0 0 44 56" width="44" height="56" aria-hidden="true">
    <defs>
      <linearGradient id="mp_${escapeHtml(formation.id)}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#1d8f2c"/>
        <stop offset="50%" stop-color="#177825"/>
        <stop offset="100%" stop-color="#115c1c"/>
      </linearGradient>
    </defs>
    <rect x="1" y="1" width="42" height="54" rx="5" fill="url(#mp_${escapeHtml(formation.id)})" stroke="rgba(255,255,255,0.45)" stroke-width="1"/>
    <rect x="4" y="4" width="36" height="48" rx="1.5" fill="none" stroke="rgba(255,255,255,0.72)" stroke-width="0.8"/>
    <line x1="4" y1="28" x2="40" y2="28" stroke="rgba(255,255,255,0.68)" stroke-width="0.75"/>
    <circle cx="22" cy="28" r="5.2" fill="none" stroke="rgba(255,255,255,0.68)" stroke-width="0.75"/>
    <rect x="13" y="4" width="18" height="7" fill="none" stroke="rgba(255,255,255,0.62)" stroke-width="0.7"/>
    <rect x="13" y="45" width="18" height="7" fill="none" stroke="rgba(255,255,255,0.62)" stroke-width="0.7"/>
    ${dots}
  </svg>`;
}

function buildCurvedPathD(x1: number, y1: number, x2: number, y2: number, bendSign = -1): string {
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const bend = Math.min(58, Math.max(22, len * 0.22)) * bendSign;
  const cx = mx + nx * bend;
  const cy = my + ny * bend;
  return `M ${x1.toFixed(1)} ${y1.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`;
}

export function buildProAnnotationsDefsSvg(defsPrefix = 'pro'): string {
  const safePrefix = escapeHtml(defsPrefix || 'pro');
  return `<radialGradient id="${safePrefix}FootballGrad" cx="34%" cy="30%" r="70%">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="66%" stop-color="#e2e8f0"/>
      <stop offset="100%" stop-color="#94a3b8"/>
    </radialGradient>
    <marker id="${safePrefix}ArrGold" viewBox="0 0 10 10" refX="7.5" refY="5" markerWidth="6.2" markerHeight="6.2" orient="auto-start-reverse">
      <path d="M 0 0.8 L 10 5 L 0 9.2 L 2.2 5 Z" fill="#FACC15"/>
    </marker>
    <marker id="${safePrefix}ArrWhite" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M 1 1.4 L 9.2 5 L 1 8.6" fill="none" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </marker>`;
}

export function renderSingleAnnotationSvg(a: ProAnnotation, isDraft: boolean, defsPrefix = 'pro'): string {
  const safePrefix = escapeHtml(defsPrefix || 'pro');
  const p1 = portraitPctToProSvg({ x: a.x1, y: a.y1 });
  const p2 = portraitPctToProSvg({ x: a.x2, y: a.y2 });
  const op = isDraft ? '0.78' : '0.96';
  const idAttr = isDraft ? '' : `data-pro-ann-id="${escapeHtml(a.id)}"`;

  switch (a.kind) {
    case 'arrow':
      if (Math.hypot(p2.x - p1.x, p2.y - p1.y) < 8) return '';
      return `<g ${idAttr} opacity="${op}">
        <line x1="${p1.x.toFixed(1)}" y1="${p1.y.toFixed(1)}" x2="${p2.x.toFixed(1)}" y2="${p2.y.toFixed(1)}" stroke="${a.color}" stroke-width="3.2" stroke-dasharray="10 7" stroke-linecap="round" marker-end="url(#${safePrefix}ArrWhite)"/>
      </g>`;
    case 'path': {
      if (Math.hypot(p2.x - p1.x, p2.y - p1.y) < 10) return '';
      const d = buildCurvedPathD(p1.x, p1.y, p2.x, p2.y, p1.y < PRO_SVG_H / 2 ? -1 : 1);
      return `<g ${idAttr} opacity="${op}">
        <path d="${d}" fill="none" stroke="rgba(250,204,21,0.34)" stroke-width="11" stroke-linecap="round" pointer-events="none"/>
        <path d="${d}" fill="none" stroke="#FACC15" stroke-width="5" stroke-linecap="round" marker-end="url(#${safePrefix}ArrGold)"/>
      </g>`;
    }
    case 'circle': {
      const r = Math.max(14, Math.hypot(p2.x - p1.x, p2.y - p1.y));
      return `<circle ${idAttr} cx="${p1.x.toFixed(1)}" cy="${p1.y.toFixed(1)}" r="${r.toFixed(1)}" fill="rgba(56,189,248,0.14)" stroke="${a.color}" stroke-width="2.6" stroke-dasharray="7 4" opacity="${op}"/>`;
    }
    case 'rect': {
      const rx = Math.min(p1.x, p2.x);
      const ry = Math.min(p1.y, p2.y);
      const rw = Math.max(18, Math.abs(p2.x - p1.x));
      const rh = Math.max(18, Math.abs(p2.y - p1.y));
      return `<rect ${idAttr} x="${rx.toFixed(1)}" y="${ry.toFixed(1)}" width="${rw.toFixed(1)}" height="${rh.toFixed(1)}" rx="6" fill="rgba(250,204,21,0.14)" stroke="${a.color}" stroke-width="2.5" opacity="${op}"/>`;
    }
    case 'triangle': {
      const topX = (p1.x + p2.x) / 2;
      const topY = Math.min(p1.y, p2.y);
      const botY = Math.max(p1.y, p2.y);
      const leftX = Math.min(p1.x, p2.x);
      const rightX = Math.max(p1.x, p2.x);
      if (rightX - leftX < 12 && botY - topY < 12) return '';
      return `<polygon ${idAttr} points="${topX.toFixed(1)},${topY.toFixed(1)} ${rightX.toFixed(1)},${botY.toFixed(1)} ${leftX.toFixed(1)},${botY.toFixed(1)}" fill="rgba(74,222,128,0.16)" stroke="${a.color}" stroke-width="2.5" opacity="${op}"/>`;
    }
    case 'zone': {
      const zx = Math.min(p1.x, p2.x);
      const zy = Math.min(p1.y, p2.y);
      const zw = Math.max(46, Math.abs(p2.x - p1.x));
      const zh = Math.max(46, Math.abs(p2.y - p1.y));
      const skew = 16;
      const pts = `${(zx + skew).toFixed(1)},${zy.toFixed(1)} ${(zx + zw + skew).toFixed(1)},${zy.toFixed(1)} ${(zx + zw - skew).toFixed(1)},${(zy + zh).toFixed(1)} ${(zx - skew).toFixed(1)},${(zy + zh).toFixed(1)}`;
      return `<polygon ${idAttr} points="${pts}" fill="rgba(56,189,248,0.28)" stroke="rgba(186,230,253,0.62)" stroke-width="1.5" opacity="${op}"/>`;
    }
    case 'cone':
      return `<g ${idAttr} transform="translate(${p1.x.toFixed(1)}, ${p1.y.toFixed(1)})" opacity="${op}">
        <ellipse cx="0" cy="8" rx="11" ry="4.5" fill="rgba(0,0,0,0.45)"/>
        <polygon points="-9,7 9,7 2.5,-11 -2.5,-11" fill="#F59E0B" stroke="#FEF08A" stroke-width="1.2"/>
        <polygon points="-6.2,1 6.2,1 4.5,-4 -4.5,-4" fill="#FFFBEB"/>
        <rect x="-10.5" y="5.5" width="21" height="3.2" rx="1.5" fill="#D97706"/>
      </g>`;
    case 'flag':
      return `<g ${idAttr} transform="translate(${p1.x.toFixed(1)}, ${p1.y.toFixed(1)})" opacity="${op}">
        <ellipse cx="0" cy="10" rx="8" ry="3.2" fill="rgba(0,0,0,0.42)"/>
        <line x1="0" y1="10" x2="0" y2="-16" stroke="#F8FAFC" stroke-width="2.4" stroke-linecap="round"/>
        <path d="M 1 -16 L 18 -10.5 L 1 -5 Z" fill="#EF4444" stroke="#FECACA" stroke-width="1"/>
      </g>`;
    case 'ball':
      return `<g ${idAttr} transform="translate(${p1.x.toFixed(1)}, ${p1.y.toFixed(1)})" opacity="${op}">
        <ellipse cx="0" cy="7.5" rx="9" ry="4" fill="rgba(0,0,0,0.45)"/>
        <circle cx="0" cy="0" r="9.5" fill="url(#${safePrefix}FootballGrad)" stroke="#0f172a" stroke-width="1.4"/>
        <polygon points="0,-4 3.8,-1.2 2.4,3.3 -2.4,3.3 -3.8,-1.2" fill="#0f172a"/>
      </g>`;
  }
}

export function renderProAnnotationsSvgContent(
  annotations: ProAnnotation[],
  draftAnnotation: ProAnnotation | null,
  defsPrefix = 'pro',
  options?: { includeDefs?: boolean }
): string {
  const parts: string[] = [];
  if (options?.includeDefs !== false && (annotations.length > 0 || draftAnnotation)) {
    parts.push(`<defs>${buildProAnnotationsDefsSvg(defsPrefix)}</defs>`);
  }
  if (annotations.length > 0) {
    parts.push(`<g class="tac-pro-annotations">`);
    annotations.forEach((ann) => {
      parts.push(renderSingleAnnotationSvg(ann, false, defsPrefix));
    });
    parts.push(`</g>`);
  }
  if (draftAnnotation) {
    parts.push(
      `<g class="tac-pro-draft" pointer-events="none">${renderSingleAnnotationSvg(draftAnnotation, true, defsPrefix)}</g>`
    );
  }
  return parts.join('');
}

/**
 * Renders the Pro Full-Screen Horizontal Stadium SVG Pitch closely matching the reference image:
 * Vibrant mowed stadium turf, overhead twin floodlight glow, crisp white chalk markings,
 * side 3D goal nets, luminous yellow/blue/dashed arrows, glossy 3D Blue (our team) & Red (opponents) tokens,
 * classic black-and-white football, and user-drawn annotations/props.
 */
export function buildProLandscapePitchSvg(input: ProPitchRenderInput): string {
  const {
    size,
    formation,
    ourPortrait,
    oppPortrait,
    ballPortrait,
    ourNumbers,
    ourNames,
    activeIndices,
    spotlightIdx,
    focusedIdx,
    dragTarget,
    frame,
    display,
    annotations,
    draftAnnotation,
    ballLift,
    reducedMotion,
    offsideEnabled,
    isMistakeCompare,
  } = input;

  const pL = PITCH_PAD_X;
  const pT = PITCH_PAD_Y;
  const pW = PRO_SVG_W - PITCH_PAD_X * 2;
  const pH = PRO_SVG_H - PITCH_PAD_Y * 2;
  const midX = PRO_SVG_W / 2;
  const midY = PRO_SVG_H / 2;

  const ourSvg = ourPortrait.map(portraitPctToProSvg);
  const rawOppSvg = oppPortrait.map(portraitPctToProSvg);
  const ballSvg = portraitPctToProSvg(ballPortrait);
  const discR = size === '11v11' ? 19.5 : 22.5;
  const minSep = discR * 2.45;
  const oppSvg = rawOppSvg.map((op) => {
    let x = op.x;
    let y = op.y;
    for (let pass = 0; pass < 2; pass++) {
      for (const our of ourSvg) {
        const dx = x - our.x;
        const dy = y - our.y;
        const d = Math.hypot(dx, dy);
        if (d < minSep) {
          const push = minSep - d;
          const ang = d > 0.01 ? Math.atan2(dy, dx) : 0;
          x += Math.cos(ang) * push;
          y += Math.sin(ang) * push;
        }
      }
      x = Math.max(pL + discR + 4, Math.min(pL + pW - discR - 4, x));
      y = Math.max(pT + discR + 4, Math.min(pT + pH - discR - 4, y));
    }
    return { x, y };
  });

  const parts: string[] = [];

  parts.push(`<defs>
    <clipPath id="proTurfClip">
      <rect x="${pL - 10}" y="${pT - 8}" width="${pW + 20}" height="${pH + 16}" rx="10"/>
    </clipPath>
    <linearGradient id="proTurfBase" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#197b1e"/>
      <stop offset="48%" stop-color="#2ca123"/>
      <stop offset="100%" stop-color="#136818"/>
    </linearGradient>
    <radialGradient id="proFloodLeft" cx="22%" cy="8%" r="58%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.34"/>
      <stop offset="35%" stop-color="#bef264" stop-opacity="0.16"/>
      <stop offset="100%" stop-color="#052e16" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="proFloodRight" cx="78%" cy="8%" r="58%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.34"/>
      <stop offset="35%" stop-color="#bef264" stop-opacity="0.16"/>
      <stop offset="100%" stop-color="#052e16" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="proTurfVignette" cx="50%" cy="50%" r="68%">
      <stop offset="56%" stop-color="#000000" stop-opacity="0"/>
      <stop offset="100%" stop-color="#020b05" stop-opacity="0.56"/>
    </radialGradient>
    <radialGradient id="proBlueToken" cx="35%" cy="24%" r="74%">
      <stop offset="0%" stop-color="#3b82f6"/>
      <stop offset="48%" stop-color="#1d4ed8"/>
      <stop offset="85%" stop-color="#0f2573"/>
      <stop offset="100%" stop-color="#071242"/>
    </radialGradient>
    <radialGradient id="proRedToken" cx="35%" cy="24%" r="74%">
      <stop offset="0%" stop-color="#ef4444"/>
      <stop offset="48%" stop-color="#b91c1c"/>
      <stop offset="85%" stop-color="#690b0b"/>
      <stop offset="100%" stop-color="#360505"/>
    </radialGradient>
    <radialGradient id="proGoldHalo" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#FEF08A" stop-opacity="0.88"/>
      <stop offset="55%" stop-color="#FACC15" stop-opacity="0.32"/>
      <stop offset="100%" stop-color="#FACC15" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="proRedHalo" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#FCA5A5" stop-opacity="0.72"/>
      <stop offset="55%" stop-color="#EF4444" stop-opacity="0.28"/>
      <stop offset="100%" stop-color="#EF4444" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="proFootballGrad" cx="34%" cy="30%" r="70%">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="66%" stop-color="#e2e8f0"/>
      <stop offset="100%" stop-color="#94a3b8"/>
    </radialGradient>
    <pattern id="proGoalNet" width="6" height="6" patternUnits="userSpaceOnUse">
      <path d="M 6 0 L 0 0 0 6" fill="none" stroke="rgba(255,255,255,0.62)" stroke-width="0.9"/>
    </pattern>
    <marker id="proArrGold" viewBox="0 0 10 10" refX="7.5" refY="5" markerWidth="6.2" markerHeight="6.2" orient="auto-start-reverse">
      <path d="M 0 0.8 L 10 5 L 0 9.2 L 2.2 5 Z" fill="#FACC15"/>
    </marker>
    <marker id="proArrBlue" viewBox="0 0 10 10" refX="7.5" refY="5" markerWidth="6.2" markerHeight="6.2" orient="auto-start-reverse">
      <path d="M 0 0.8 L 10 5 L 0 9.2 L 2.2 5 Z" fill="#38BDF8"/>
    </marker>
    <marker id="proArrWhite" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M 1 1.4 L 9.2 5 L 1 8.6" fill="none" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </marker>
  </defs>`);

  // Stadium pitch turf + crisp alternating vertical mowed stripes
  parts.push(`<g clip-path="url(#proTurfClip)">
    <rect x="${pL - 10}" y="${pT - 8}" width="${pW + 20}" height="${pH + 16}" fill="url(#proTurfBase)"/>`);
  const stripeCount = 12;
  const stripeW = (pW + 20) / stripeCount;
  for (let i = 0; i < stripeCount; i++) {
    if (i % 2 === 0) {
      parts.push(`<rect x="${(pL - 10 + i * stripeW).toFixed(1)}" y="${pT - 8}" width="${stripeW.toFixed(1)}" height="${pH + 16}" fill="rgba(190,242,100,0.095)"/>`);
    } else {
      parts.push(`<rect x="${(pL - 10 + i * stripeW).toFixed(1)}" y="${pT - 8}" width="${stripeW.toFixed(1)}" height="${pH + 16}" fill="rgba(2,28,10,0.12)"/>`);
    }
  }
  if (!reducedMotion) {
    parts.push(`<rect x="${pL - 10}" y="${pT - 8}" width="${pW + 20}" height="${pH + 16}" fill="url(#proFloodLeft)"/>`);
    parts.push(`<rect x="${pL - 10}" y="${pT - 8}" width="${pW + 20}" height="${pH + 16}" fill="url(#proFloodRight)"/>`);
  }
  parts.push(`<rect x="${pL - 10}" y="${pT - 8}" width="${pW + 20}" height="${pH + 16}" fill="url(#proTurfVignette)"/>`);
  parts.push(`</g>`);

  // Crisp White Stadium Pitch Chalk Lines + Left/Right Penalty Boxes + 3D Side Goals
  const penW = 122;
  const penH = 264;
  const sixW = 46;
  const sixH = 126;
  const goalH = 92;
  const goalD = 26;
  parts.push(`<g stroke="rgba(255,255,255,0.92)" stroke-width="2.4" fill="none">
    <rect x="${pL}" y="${pT}" width="${pW}" height="${pH}" rx="2"/>
    <line x1="${midX}" y1="${pT}" x2="${midX}" y2="${pT + pH}"/>
    <circle cx="${midX}" cy="${midY}" r="66"/>
    <circle cx="${midX}" cy="${midY}" r="4.2" fill="#FFFFFF" stroke="none"/>

    <!-- Left Penalty & 6-yard Box (Our Goal) -->
    <rect x="${pL}" y="${midY - penH / 2}" width="${penW}" height="${penH}"/>
    <rect x="${pL}" y="${midY - sixH / 2}" width="${sixW}" height="${sixH}"/>
    <path d="M ${pL + penW} ${midY - 50} A 60 60 0 0 1 ${pL + penW} ${midY + 50}"/>
    <circle cx="${pL + 84}" cy="${midY}" r="3.4" fill="#FFFFFF" stroke="none"/>

    <!-- Right Penalty & 6-yard Box (Opponent Goal) -->
    <rect x="${pL + pW - penW}" y="${midY - penH / 2}" width="${penW}" height="${penH}"/>
    <rect x="${pL + pW - sixW}" y="${midY - sixH / 2}" width="${sixW}" height="${sixH}"/>
    <path d="M ${pL + pW - penW} ${midY - 50} A 60 60 0 0 0 ${pL + pW - penW} ${midY + 50}"/>
    <circle cx="${pL + pW - 84}" cy="${midY}" r="3.4" fill="#FFFFFF" stroke="none"/>

    <!-- Corner Arcs -->
    <path d="M ${pL + 16} ${pT} A 16 16 0 0 1 ${pL} ${pT + 16}"/>
    <path d="M ${pL + pW - 16} ${pT} A 16 16 0 0 0 ${pL + pW} ${pT + 16}"/>
    <path d="M ${pL} ${pT + pH - 16} A 16 16 0 0 1 ${pL + 16} ${pT + pH}"/>
    <path d="M ${pL + pW} ${pT + pH - 16} A 16 16 0 0 0 ${pL + pW - 16} ${pT + pH}"/>

    <!-- 3D Left Goal Net -->
    <polygon points="${pL},${midY - goalH / 2} ${pL - goalD},${midY - goalH / 2 + 8} ${pL - goalD},${midY + goalH / 2 - 8} ${pL},${midY + goalH / 2}" fill="url(#proGoalNet)" stroke="#FFFFFF" stroke-width="2.6"/>
    <!-- 3D Right Goal Net -->
    <polygon points="${pL + pW},${midY - goalH / 2} ${pL + pW + goalD},${midY - goalH / 2 + 8} ${pL + pW + goalD},${midY + goalH / 2 - 8} ${pL + pW},${midY + goalH / 2}" fill="url(#proGoalNet)" stroke="#FFFFFF" stroke-width="2.6"/>
  </g>`);

  // Dynamic Offside Line (11v11 only)
  if (offsideEnabled && oppPortrait.length >= 3) {
    const sortedY = oppPortrait.map((o) => o.y).sort((a, b) => a - b);
    const offPt = portraitPctToProSvg({ x: 50, y: sortedY[1] });
    parts.push(`<g class="tac-pro-offside">
      <line x1="${offPt.x.toFixed(1)}" y1="${pT}" x2="${offPt.x.toFixed(1)}" y2="${pT + pH}" stroke="#FB7185" stroke-width="2.4" stroke-dasharray="8 6"/>
      <rect x="${(offPt.x - 46).toFixed(1)}" y="${pT + 6}" width="92" height="20" rx="6" fill="rgba(136,19,55,0.92)" stroke="rgba(251,113,133,0.8)" stroke-width="1"/>
      <text x="${offPt.x.toFixed(1)}" y="${pT + 19.5}" text-anchor="middle" fill="#FFF1F2" font-size="10.5" font-weight="800">خط التسلل (11v11)</text>
    </g>`);
  }

  // Tactical Zones from Keyframe
  if (display.showTacticalLines && frame?.zones?.length) {
    const zoneStyle: Record<string, { fill: string; stroke: string; text: string }> = {
      gold: { fill: 'rgba(250,204,21,0.2)', stroke: 'rgba(250,204,21,0.72)', text: '#FEF08A' },
      cyan: { fill: 'rgba(56,189,248,0.24)', stroke: 'rgba(125,211,252,0.75)', text: '#E0F2FE' },
      rose: { fill: 'rgba(249,115,22,0.24)', stroke: 'rgba(251,146,60,0.82)', text: '#FFEDD5' },
      emerald: { fill: 'rgba(34,197,94,0.22)', stroke: 'rgba(74,222,128,0.75)', text: '#DCFCE7' },
    };
    frame.zones.forEach((z) => {
      const col = zoneStyle[z.color || 'cyan'] || zoneStyle.cyan;
      const c = portraitPctToProSvg({ x: z.x, y: z.y });
      const rad = Math.max(28, z.r * 4.4);
      // Translucent diamond/parallelogram zone aesthetic inspired by reference
      const pts = `${(c.x - rad * 0.2).toFixed(1)},${(c.y - rad * 0.9).toFixed(1)} ${(c.x + rad * 1.05).toFixed(1)},${(c.y - rad * 0.2).toFixed(1)} ${(c.x + rad * 0.2).toFixed(1)},${(c.y + rad * 0.9).toFixed(1)} ${(c.x - rad * 1.05).toFixed(1)},${(c.y + rad * 0.2).toFixed(1)}`;
      parts.push(`<polygon points="${pts}" fill="${col.fill}" stroke="${col.stroke}" stroke-width="1.6" stroke-dasharray="6 4"/>`);
      if (z.label) {
        parts.push(`<text x="${c.x.toFixed(1)}" y="${(c.y - rad * 0.95).toFixed(1)}" text-anchor="middle" fill="${col.text}" font-size="11.5" font-weight="800" paint-order="stroke" stroke="rgba(4,12,8,0.85)" stroke-width="3">${escapeHtml(z.label)}</text>`);
      }
    });
  }

  // Passing Triangles (when tactical lines & triangles enabled)
  if (display.showTacticalLines && display.showTriangles) {
    const tris = frame?.triangles || (formation.slots.length >= 5 ? [[1, 2, 3]] : []);
    tris.forEach(([a, b, c]) => {
      const pA = ourSvg[a];
      const pB = ourSvg[b];
      const pC = ourSvg[c];
      if (!pA || !pB || !pC) return;
      parts.push(`<polygon points="${pA.x.toFixed(1)},${pA.y.toFixed(1)} ${pB.x.toFixed(1)},${pB.y.toFixed(1)} ${pC.x.toFixed(1)},${pC.y.toFixed(1)}" fill="rgba(56,189,248,0.12)" stroke="rgba(186,230,253,0.45)" stroke-width="1.6" stroke-dasharray="6 5"/>`);
    });
  }

  // Tactical Arrows from Current Keyframe (Matching Reference Image: Bold Gold Curve, Sky-Blue Curve, White Dashed Pass)
  if (display.showTacticalLines && frame?.arrows?.length) {
    frame.arrows.forEach((arr: TacticalArrow, idx: number) => {
      const s1 = portraitPctToProSvg({ x: arr.from[0], y: arr.from[1] });
      const s2 = portraitPctToProSvg({ x: arr.to[0], y: arr.to[1] });
      const len = Math.hypot(s2.x - s1.x, s2.y - s1.y);
      if (len < 12) return;

      // Trim ends slightly so arrows terminate cleanly at player rims
      const ux = (s2.x - s1.x) / len;
      const uy = (s2.y - s1.y) / len;
      const x1 = s1.x + ux * 20;
      const y1 = s1.y + uy * 20;
      const x2 = s2.x - ux * 24;
      const y2 = s2.y - uy * 24;

      if (arr.kind === 'ball') {
        const d = buildCurvedPathD(x1, y1, x2, y2, y1 < midY ? -1 : 1);
        const col = isMistakeCompare ? '#FB923C' : '#FACC15';
        parts.push(`<path d="${d}" fill="none" stroke="rgba(250,204,21,0.28)" stroke-width="12" stroke-linecap="round" pointer-events="none"/>`);
        parts.push(`<path d="${d}" fill="none" stroke="${col}" stroke-width="5.2" stroke-linecap="round" marker-end="url(#proArrGold)"/>`);
      } else if (arr.kind === 'cover') {
        const d = buildCurvedPathD(x1, y1, x2, y2, y1 > midY ? 1 : -1);
        parts.push(`<path d="${d}" fill="none" stroke="rgba(56,189,248,0.26)" stroke-width="10" stroke-linecap="round" pointer-events="none"/>`);
        parts.push(`<path d="${d}" fill="none" stroke="#38BDF8" stroke-width="4.4" stroke-linecap="round" marker-end="url(#proArrBlue)"/>`);
      } else {
        // White crisp tactical dashed line (like reference image) for secondary passes/runs
        const isPrimaryCurve = idx === 0 && !frame.arrows?.some((a) => a.kind === 'ball');
        if (isPrimaryCurve) {
          const d = buildCurvedPathD(x1, y1, x2, y2, -1);
          parts.push(`<path d="${d}" fill="none" stroke="#FACC15" stroke-width="4.8" stroke-linecap="round" marker-end="url(#proArrGold)"/>`);
        } else {
          parts.push(`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#FFFFFF" stroke-width="2.9" stroke-dasharray="10 7" stroke-linecap="round" marker-end="url(#proArrWhite)" opacity="0.95"/>`);
        }
      }
    });
  }

  // User-drawn Annotations & Placed Tactical Props (zones/shapes/arrows/cones/flags/extra balls)
  if (annotations.length) {
    parts.push(`<g class="tac-pro-annotations">`);
    annotations.forEach((ann) => {
      parts.push(renderSingleAnnotationSvg(ann, false));
    });
    parts.push(`</g>`);
  }
  if (draftAnnotation) {
    parts.push(`<g class="tac-pro-draft" pointer-events="none">${renderSingleAnnotationSvg(draftAnnotation, true)}</g>`);
  }

  // Opponent Team Tokens — Glossy 3D Crimson Red Circles (matching reference image!)
  if (display.showOpponents) {
    oppSvg.forEach((pt, i) => {
      const isGrabbed = dragTarget?.kind === 'opp' && dragTarget.idx === i;
      const oppLabel = i === 0 ? '1' : String(Math.max(2, 11 - i));
      const dimmed = spotlightIdx !== null || focusedIdx !== null ? '0.45' : '1';
      parts.push(`<g data-pro-drag-kind="opp" data-pro-drag-idx="${i}" class="tac-pro-token tac-pro-token-opp" opacity="${dimmed}">`);
      parts.push(`<ellipse cx="${pt.x.toFixed(1)}" cy="${(pt.y + discR * 0.92).toFixed(1)}" rx="${(discR * 0.95).toFixed(1)}" ry="${(discR * 0.36).toFixed(1)}" fill="rgba(0,0,0,0.48)" pointer-events="none"/>`);
      if (!reducedMotion) {
        parts.push(`<circle cx="${pt.x.toFixed(1)}" cy="${pt.y.toFixed(1)}" r="${(discR + 13).toFixed(1)}" fill="url(#proRedHalo)" pointer-events="none"/>`);
      }
      if (isGrabbed) {
        parts.push(`<circle cx="${pt.x.toFixed(1)}" cy="${pt.y.toFixed(1)}" r="${(discR + 7).toFixed(1)}" fill="none" stroke="#FEF08A" stroke-width="2.4" stroke-dasharray="5 3"/>`);
      }
      parts.push(`<circle cx="${pt.x.toFixed(1)}" cy="${pt.y.toFixed(1)}" r="${discR.toFixed(1)}" fill="url(#proRedToken)" stroke="${isGrabbed ? '#FEF08A' : '#FCA5A5'}" stroke-width="${isGrabbed ? 3 : 2.2}"/>`);
      // Specular glossy highlight arc on top
      parts.push(`<ellipse cx="${(pt.x - discR * 0.14).toFixed(1)}" cy="${(pt.y - discR * 0.42).toFixed(1)}" rx="${(discR * 0.56).toFixed(1)}" ry="${(discR * 0.28).toFixed(1)}" fill="rgba(255,255,255,0.22)" pointer-events="none"/>`);
      if (display.showNumbers) {
        parts.push(`<text x="${pt.x.toFixed(1)}" y="${(pt.y + 6.5).toFixed(1)}" text-anchor="middle" fill="#FFFFFF" font-size="${size === '11v11' ? '15.5' : '17.5'}" font-weight="900" pointer-events="none">${oppLabel}</text>`);
      }
      parts.push(`</g>`);
    });
  }

  // Our Team Tokens — Glossy 3D Royal Blue Circles with Gold Active Halo (matching reference image!)
  ourSvg.forEach((pt, i) => {
    const isGrabbed = dragTarget?.kind === 'our' && dragTarget.idx === i;
    const isSpotlight = spotlightIdx === i;
    const isFocused = focusedIdx !== null && focusedIdx === i;
    const isDimmed = focusedIdx !== null ? !isFocused : spotlightIdx !== null && !isSpotlight && !activeIndices.has(i);
    const isActive = isGrabbed || isSpotlight || isFocused || activeIndices.has(i);
    const numTxt = ourNumbers[i] || String(i + 1);
    const nameTxt = ourNames[i] || '';

    parts.push(`<g data-pro-drag-kind="our" data-pro-drag-idx="${i}" class="tac-pro-token tac-pro-token-our" opacity="${isDimmed ? '0.32' : '1'}">`);
    parts.push(`<ellipse cx="${pt.x.toFixed(1)}" cy="${(pt.y + discR * 0.94).toFixed(1)}" rx="${(discR * 0.96).toFixed(1)}" ry="${(discR * 0.38).toFixed(1)}" fill="rgba(0,0,0,0.52)" pointer-events="none"/>`);
    if (isActive && !reducedMotion) {
      parts.push(`<circle cx="${pt.x.toFixed(1)}" cy="${pt.y.toFixed(1)}" r="${(discR + 15).toFixed(1)}" fill="url(#proGoldHalo)" pointer-events="none"/>`);
    }
    if (isGrabbed) {
      parts.push(`<circle cx="${pt.x.toFixed(1)}" cy="${pt.y.toFixed(1)}" r="${(discR + 7.5).toFixed(1)}" fill="none" stroke="#FEF08A" stroke-width="2.6" stroke-dasharray="5 3"/>`);
    }
    parts.push(`<circle cx="${pt.x.toFixed(1)}" cy="${pt.y.toFixed(1)}" r="${discR.toFixed(1)}" fill="url(#proBlueToken)" stroke="${isActive ? '#FACC15' : '#93C5FD'}" stroke-width="${isActive ? 2.8 : 2.1}"/>`);
    parts.push(`<ellipse cx="${(pt.x - discR * 0.14).toFixed(1)}" cy="${(pt.y - discR * 0.42).toFixed(1)}" rx="${(discR * 0.56).toFixed(1)}" ry="${(discR * 0.28).toFixed(1)}" fill="rgba(255,255,255,0.24)" pointer-events="none"/>`);
    if (display.showNumbers) {
      parts.push(`<text x="${pt.x.toFixed(1)}" y="${(pt.y + 6.5).toFixed(1)}" text-anchor="middle" fill="#FFFFFF" font-size="${size === '11v11' ? '15.5' : '17.5'}" font-weight="900" pointer-events="none">${escapeHtml(numTxt)}</text>`);
    }
    if (display.showNames && nameTxt) {
      const pillW = Math.max(46, Math.min(92, nameTxt.length * 7.2 + 16));
      const pillY = pt.y + discR + 6;
      parts.push(`<rect x="${(pt.x - pillW / 2).toFixed(1)}" y="${pillY.toFixed(1)}" width="${pillW.toFixed(1)}" height="18" rx="6" fill="rgba(6,9,15,0.88)" stroke="rgba(250,204,21,0.48)" stroke-width="1" pointer-events="none"/>`);
      parts.push(`<text x="${pt.x.toFixed(1)}" y="${(pillY + 12.6).toFixed(1)}" text-anchor="middle" fill="#F8FAFC" font-size="10.5" font-weight="800" pointer-events="none">${escapeHtml(nameTxt)}</text>`);
    }
    parts.push(`</g>`);
  });

  // Classic Multi-Panel Black & White Football
  const ballGrabbed = dragTarget?.kind === 'ball';
  const ballDrawY = ballSvg.y - ballLift * 10;
  const ballR = 11.2 + ballLift * 2.2;
  parts.push(`<g data-pro-drag-kind="ball" data-pro-drag-idx="0" class="tac-pro-token tac-pro-ball">
    <ellipse cx="${ballSvg.x.toFixed(1)}" cy="${(ballSvg.y + 10).toFixed(1)}" rx="${Math.max(6, 11 - ballLift * 2.5).toFixed(1)}" ry="${Math.max(3, 5 - ballLift * 1.4).toFixed(1)}" fill="rgba(0,0,0,0.48)" pointer-events="none"/>
    ${ballGrabbed ? `<circle cx="${ballSvg.x.toFixed(1)}" cy="${ballDrawY.toFixed(1)}" r="${(ballR + 6).toFixed(1)}" fill="none" stroke="#FEF08A" stroke-width="2.4" stroke-dasharray="5 3"/>` : ''}
    <circle cx="${ballSvg.x.toFixed(1)}" cy="${ballDrawY.toFixed(1)}" r="${ballR.toFixed(1)}" fill="url(#proFootballGrad)" stroke="#090B10" stroke-width="1.5"/>
    <polygon points="${ballSvg.x.toFixed(1)},${(ballDrawY - 4.4).toFixed(1)} ${(ballSvg.x + 4.2).toFixed(1)},${(ballDrawY - 1.4).toFixed(1)} ${(ballSvg.x + 2.6).toFixed(1)},${(ballDrawY + 3.6).toFixed(1)} ${(ballSvg.x - 2.6).toFixed(1)},${(ballDrawY + 3.6).toFixed(1)} ${(ballSvg.x - 4.2).toFixed(1)},${(ballDrawY - 1.4).toFixed(1)}" fill="#0F172A" pointer-events="none"/>
    <circle cx="${(ballSvg.x - 3).toFixed(1)}" cy="${(ballDrawY - 3.5).toFixed(1)}" r="2" fill="rgba(255,255,255,0.7)" pointer-events="none"/>
  </g>`);

  return parts.join('');
}

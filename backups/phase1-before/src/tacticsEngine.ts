import type { TacticalArrow, TacticalKeyframe } from './tacticsData';
import type { Point2D } from './tacticsLayout';

export interface TimelineMetrics {
  frameCount: number;
  segmentStarts: number[];
  segmentDurations: number[];
  totalMs: number;
}

export interface TimelineSample {
  frameIdx: number;
  nextFrameIdx: number;
  /** Progress across the entire sequence [0..1] */
  globalProgress: number;
  /** Progress within current frame segment [0..1] */
  segmentProgress: number;
  /** Smooth movement interpolation factor [0..1] from previous pose to current frame pose */
  moveT: number;
  /** Arrow reveal progress [0..1] */
  arrowRevealT: number;
  /** Clamped elapsed milliseconds [0..totalMs] */
  elapsedMs: number;
}

export interface BallArcSample {
  x: number;
  y: number;
  /** Loft height factor [0..1] (0 for short ground passes, up to 1 for long lofted passes) */
  lift: number;
  /** Vertical shadow offset in SVG px */
  shadowDy: number;
  /** Visual scale multiplier for the ball [1.0..1.22] */
  scale: number;
  /** Quadratic Bezier control point in pitch % coordinates */
  ctrlX: number;
  ctrlY: number;
}

export interface CurvedArrowGeometry {
  pathD: string;
  approxLength: number;
  dashOffset: number;
  ctrlX: number;
  ctrlY: number;
}

export function easeInOutCubic(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2;
}

export function easeOutQuad(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return 1 - (1 - c) * (1 - c);
}

/**
 * Builds cumulative timeline metrics for a sequence of keyframes.
 * Each frame gets a real positive duration (default 2500ms if omitted).
 */
export function buildTimelineMetrics(frames: ReadonlyArray<TacticalKeyframe>): TimelineMetrics {
  const frameCount = frames.length;
  const segmentStarts: number[] = [];
  const segmentDurations: number[] = [];
  let cursor = 0;

  for (let i = 0; i < frameCount; i++) {
    const dur = Math.max(800, Number(frames[i]?.durationMs) || 2500);
    segmentStarts.push(cursor);
    segmentDurations.push(dur);
    cursor += dur;
  }

  return {
    frameCount,
    segmentStarts,
    segmentDurations,
    totalMs: Math.max(1, cursor),
  };
}

/**
 * Samples continuous timeline state at any elapsedMs along the sequence.
 * - First ~42% of each step (capped at 950ms) smoothly glides players & arcs the ball from previous frame to current frame.
 * - Remaining dwell time lets players & arrows settle clearly for comprehension.
 * - Frame 0 starts cleanly in place (moveT = 1, arrowRevealT animates gently in).
 */
export function sampleTimeline(metrics: TimelineMetrics, rawElapsedMs: number): TimelineSample {
  if (metrics.frameCount <= 0) {
    return {
      frameIdx: 0,
      nextFrameIdx: 0,
      globalProgress: 0,
      segmentProgress: 0,
      moveT: 1,
      arrowRevealT: 1,
      elapsedMs: 0,
    };
  }

  const elapsedMs = Math.max(0, Math.min(metrics.totalMs, rawElapsedMs));
  let frameIdx = metrics.frameCount - 1;

  for (let i = 0; i < metrics.frameCount; i++) {
    const end = metrics.segmentStarts[i] + metrics.segmentDurations[i];
    if (elapsedMs < end || i === metrics.frameCount - 1) {
      frameIdx = i;
      break;
    }
  }

  const segStart = metrics.segmentStarts[frameIdx];
  const segDur = Math.max(1, metrics.segmentDurations[frameIdx]);
  const localMs = Math.max(0, Math.min(segDur, elapsedMs - segStart));
  const segmentProgress = localMs / segDur;

  const moveWindowMs = Math.min(950, segDur * 0.44);
  const rawMove = frameIdx === 0 ? 1 : Math.min(1, localMs / Math.max(1, moveWindowMs));
  const moveT = easeInOutCubic(rawMove);

  // Arrows draw smoothly slightly ahead/alongside the movement so intent is readable immediately
  const arrowWindowMs = Math.min(820, segDur * 0.38);
  const arrowRevealT = easeOutQuad(Math.min(1, localMs / Math.max(1, arrowWindowMs)));

  return {
    frameIdx,
    nextFrameIdx: Math.min(metrics.frameCount - 1, frameIdx + 1),
    globalProgress: elapsedMs / metrics.totalMs,
    segmentProgress,
    moveT,
    arrowRevealT,
    elapsedMs,
  };
}

/**
 * Maps a discrete frame index cleanly to its timeline start timestamp.
 */
export function frameIndexToElapsedMs(metrics: TimelineMetrics, frameIdx: number): number {
  if (!metrics.frameCount) return 0;
  const clamped = Math.max(0, Math.min(metrics.frameCount - 1, Math.round(frameIdx)));
  return metrics.segmentStarts[clamped] || 0;
}

/**
 * Evaluates a quadratic Bezier ball flight between `from` and `to` at progress `t` ∈ [0..1].
 * Short passes stay crisp on the ground; medium/long passes curve gracefully with dynamic lift and shadow separation.
 */
export function evalBallArc(from: Point2D, to: Point2D, rawT: number): BallArcSample {
  const t = Math.max(0, Math.min(1, rawT));
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dy);

  const midX = (from.x + to.x) * 0.5;
  const midY = (from.y + to.y) * 0.5;

  // Subtle perpendicular bend proportional to distance (zero for tiny nudges)
  let ctrlX = midX;
  let ctrlY = midY;
  if (dist >= 8) {
    const nx = -dy / dist;
    const ny = dx / dist;
    // Bend gently toward pitch center (50, 50) for natural passing arcs
    const toCenterDot = nx * (50 - midX) + ny * (50 - midY);
    const sign = toCenterDot >= 0 ? 1 : -1;
    const bend = Math.min(11, dist * 0.16) * sign;
    ctrlX = Math.max(4, Math.min(96, midX + nx * bend));
    ctrlY = Math.max(4, Math.min(96, midY + ny * bend));
  }

  const omt = 1 - t;
  const x = omt * omt * from.x + 2 * omt * t * ctrlX + t * t * to.x;
  const y = omt * omt * from.y + 2 * omt * t * ctrlY + t * t * to.y;

  // Parabolic vertical loft: 4 * t * (1 - t) peaks at 1.0 at t=0.5, 0 at endpoints
  const distFactor = dist < 14 ? 0 : Math.min(1, (dist - 14) / 36);
  const parabola = 4 * t * (1 - t);
  const lift = parabola * distFactor;

  return {
    x,
    y,
    lift,
    shadowDy: 2 + lift * 9.5,
    scale: 1 + lift * 0.22,
    ctrlX,
    ctrlY,
  };
}

/**
 * Computes a graceful quadratic Bezier SVG path and stroke-dashoffset for a tactical arrow.
 * - Ball arrows curve very slightly for crispness
 * - Run arrows curve organically toward open space (like classic tactical diagrams)
 * - Cover arrows curve gently inward
 */
export function buildCurvedArrowGeometry(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  kind: TacticalArrow['kind'],
  revealT = 1,
  svgCenterX = 180,
  svgCenterY = 260
): CurvedArrowGeometry {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const chord = Math.hypot(dx, dy);

  const midX = (x1 + x2) * 0.5;
  const midY = (y1 + y2) * 0.5;

  let ctrlX = midX;
  let ctrlY = midY;

  if (chord >= 14) {
    const nx = -dy / chord;
    const ny = dx / chord;
    const toCenterDot = nx * (svgCenterX - midX) + ny * (svgCenterY - midY);
    const sign = toCenterDot >= 0 ? 1 : -1;
    const bendRatio = kind === 'run' ? 0.2 : kind === 'cover' ? 0.14 : 0.08;
    const maxBend = kind === 'run' ? 32 : kind === 'cover' ? 22 : 14;
    const bend = Math.min(maxBend, chord * bendRatio) * sign;
    ctrlX = Math.max(18, Math.min(svgCenterX * 2 - 18, midX + nx * bend));
    ctrlY = Math.max(20, Math.min(svgCenterY * 2 - 20, midY + ny * bend));
  }

  // Approximate quadratic Bezier arc length via 2-chord Simpson-like average
  const polyLen = Math.hypot(ctrlX - x1, ctrlY - y1) + Math.hypot(x2 - ctrlX, y2 - ctrlY);
  const approxLength = Math.max(1, (chord + polyLen) * 0.5);
  const clampedReveal = Math.max(0, Math.min(1, revealT));
  const dashOffset = approxLength * (1 - clampedReveal);

  return {
    pathD: `M ${x1.toFixed(1)} ${y1.toFixed(1)} Q ${ctrlX.toFixed(1)} ${ctrlY.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`,
    approxLength,
    dashOffset,
    ctrlX,
    ctrlY,
  };
}

/**
 * Builds a partial SVG quadratic Bezier path from t=0 to t=endT using de Casteljau subdivision.
 * Used to render a fading golden comet trail behind the ball in flight.
 */
export function buildPartialQuadPath(
  x1: number,
  y1: number,
  cx: number,
  cy: number,
  x2: number,
  y2: number,
  rawEndT: number
): string {
  const t = Math.max(0.02, Math.min(1, rawEndT));
  // De Casteljau split at t
  const qx = x1 + (cx - x1) * t;
  const qy = y1 + (cy - y1) * t;
  const rx = cx + (x2 - cx) * t;
  const ry = cy + (y2 - cy) * t;
  const ex = qx + (rx - qx) * t;
  const ey = qy + (ry - qy) * t;
  return `M ${x1.toFixed(1)} ${y1.toFixed(1)} Q ${qx.toFixed(1)} ${qy.toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}`;
}

/**
 * Interpolates a list of team coordinates smoothly between `fromPts` and `toPts` at `moveT`.
 */
export function interpolatePoints(
  fromPts: ReadonlyArray<Point2D>,
  toPts: ReadonlyArray<Point2D>,
  moveT: number
): Point2D[] {
  const t = Math.max(0, Math.min(1, moveT));
  return toPts.map((tp, i) => {
    const fp = fromPts[i] || tp;
    return {
      x: fp.x + (tp.x - fp.x) * t,
      y: fp.y + (tp.y - fp.y) * t,
    };
  });
}

/**
 * Converts a client pointer coordinate inside a flat (un-tilted) SVG bounding rect into clamped pitch % [6..94, 7..94].
 */
export function projectClientToPitchPct(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
  svgW = 360,
  svgH = 520
): Point2D {
  const rx = ((clientX - rect.left) / Math.max(1, rect.width)) * svgW;
  const ry = ((clientY - rect.top) / Math.max(1, rect.height)) * svgH;
  const x = Math.max(6, Math.min(94, ((rx - 18) / (svgW - 36)) * 100));
  const y = Math.max(7, Math.min(94, ((ry - 20) / (svgH - 40)) * 100));
  return { x, y };
}

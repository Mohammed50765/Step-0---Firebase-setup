import type { PitchSizeId } from '../tacticsData';

export interface PitchPoint {
  x: number; // 0..100 portrait width (left -> right)
  y: number; // 0..100 portrait length (0 = opponent goal, 100 = our goal)
}

export interface PitchDimensionsMeters {
  widthM: number;
  lengthM: number;
}

export interface KinematicsProfile {
  /** Reaction delay before accelerating (seconds) */
  reactionSec: number;
  /** Maximum sprint speed (m/s) */
  maxSpeedMps: number;
  /** Acceleration rate (m/s^2) */
  accelMps2: number;
}

export const PITCH_DIMENSIONS_M: Record<PitchSizeId, PitchDimensionsMeters> = {
  '5v5': { widthM: 20, lengthM: 34 },
  '6v6': { widthM: 25, lengthM: 40 },
  '7v7': { widthM: 30, lengthM: 50 },
  '11v11': { widthM: 68, lengthM: 105 },
};

export const DEFAULT_OUTFIELD_KINEMATICS: KinematicsProfile = {
  reactionSec: 0.24,
  maxSpeedMps: 6.4,
  accelMps2: 4.8,
};

export const DEFAULT_GK_KINEMATICS: KinematicsProfile = {
  reactionSec: 0.2,
  maxSpeedMps: 5.1,
  accelMps2: 4.2,
};

export const DEFAULT_PASS_SPEED_MPS = 14.5;

export function clampNumber(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, v));
}

export function clampPitchPoint(p: PitchPoint, margin = 3): PitchPoint {
  const m = clampNumber(margin, 0, 20);
  return {
    x: clampNumber(p.x, m, 100 - m),
    y: clampNumber(p.y, m, 100 - m),
  };
}

export function getPitchDimensions(size: PitchSizeId = '6v6'): PitchDimensionsMeters {
  return PITCH_DIMENSIONS_M[size] || PITCH_DIMENSIONS_M['6v6'];
}

export function pctToMeters(p: PitchPoint, size: PitchSizeId = '6v6'): { x: number; y: number } {
  const dim = getPitchDimensions(size);
  return {
    x: (p.x / 100) * dim.widthM,
    y: (p.y / 100) * dim.lengthM,
  };
}

export function metersToPct(m: { x: number; y: number }, size: PitchSizeId = '6v6'): PitchPoint {
  const dim = getPitchDimensions(size);
  return {
    x: clampNumber((m.x / dim.widthM) * 100, 0, 100),
    y: clampNumber((m.y / dim.lengthM) * 100, 0, 100),
  };
}

export function distanceMeters(a: PitchPoint, b: PitchPoint, size: PitchSizeId = '6v6'): number {
  const am = pctToMeters(a, size);
  const bm = pctToMeters(b, size);
  return Math.hypot(bm.x - am.x, bm.y - am.y);
}

/**
 * Estimates minimum arrival time (seconds) for a player to reach a target point,
 * factoring reaction delay, acceleration ramp, and top speed (NOT raw Euclidean distance).
 */
export function estimateArrivalTimeSec(
  from: PitchPoint,
  to: PitchPoint,
  size: PitchSizeId = '6v6',
  profile: KinematicsProfile = DEFAULT_OUTFIELD_KINEMATICS
): number {
  const d = distanceMeters(from, to, size);
  if (d <= 0.05) return 0;

  const react = Math.max(0, profile.reactionSec);
  const vMax = Math.max(1.5, profile.maxSpeedMps);
  const accel = Math.max(1.0, profile.accelMps2);

  // Distance covered while accelerating from rest to vMax: d_acc = vMax^2 / (2 * a)
  const tToMax = vMax / accel;
  const dToMax = 0.5 * accel * tToMax * tToMax;

  if (d <= dToMax) {
    return react + Math.sqrt((2 * d) / accel);
  }
  return react + tToMax + (d - dToMax) / vMax;
}

/**
 * Estimates ground-pass ball travel time (seconds) with mild turf deceleration.
 */
export function estimateBallTravelTimeSec(
  from: PitchPoint,
  to: PitchPoint,
  size: PitchSizeId = '6v6',
  initialSpeedMps = DEFAULT_PASS_SPEED_MPS
): number {
  const d = distanceMeters(from, to, size);
  if (d <= 0.05) return 0;
  const v0 = Math.max(6, initialSpeedMps);
  // Effective average speed drops mildly over longer passes due to turf friction
  const avgSpeed = v0 * Math.max(0.68, 1 - d * 0.008);
  return d / avgSpeed;
}

export interface SegmentProjection {
  t: number; // clamped 0..1 along segment A->B
  point: PitchPoint;
  distanceM: number;
}

export function projectPointOntoSegment(
  p: PitchPoint,
  a: PitchPoint,
  b: PitchPoint,
  size: PitchSizeId = '6v6'
): SegmentProjection {
  const pm = pctToMeters(p, size);
  const am = pctToMeters(a, size);
  const bm = pctToMeters(b, size);
  const dx = bm.x - am.x;
  const dy = bm.y - am.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-6) {
    return {
      t: 0,
      point: { ...a },
      distanceM: Math.hypot(pm.x - am.x, pm.y - am.y),
    };
  }
  const rawT = ((pm.x - am.x) * dx + (pm.y - am.y) * dy) / lenSq;
  const t = clampNumber(rawT, 0, 1);
  const cx = am.x + dx * t;
  const cy = am.y + dy * t;
  return {
    t,
    point: metersToPct({ x: cx, y: cy }, size),
    distanceM: Math.hypot(pm.x - cx, pm.y - cy),
  };
}

export function findClosestPlayerIndex(
  target: PitchPoint,
  players: PitchPoint[],
  size: PitchSizeId = '6v6'
): { index: number; distanceM: number } {
  if (!players.length) return { index: -1, distanceM: Infinity };
  let bestIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < players.length; i++) {
    const d = distanceMeters(target, players[i], size);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  return { index: bestIdx, distanceM: bestDist };
}

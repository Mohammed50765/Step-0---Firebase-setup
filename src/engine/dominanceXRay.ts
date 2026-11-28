import type { PitchSizeId } from '../tacticsData';
import {
  DEFAULT_GK_KINEMATICS,
  DEFAULT_OUTFIELD_KINEMATICS,
  clampNumber,
  clampPitchPoint,
  distanceMeters,
  estimateArrivalTimeSec,
  estimateBallTravelTimeSec,
  findClosestPlayerIndex,
  metersToPct,
  pctToMeters,
  type KinematicsProfile,
  type PitchPoint,
} from './tacticalGeometry';

export interface XRayInputState {
  size: PitchSizeId;
  our: PitchPoint[];
  opp: PitchPoint[];
  ball: PitchPoint;
  /** Optional explicit ball carrier index in `our` (auto-detected if omitted) */
  carrierIdx?: number;
  /** Optional custom speed profiles per player index */
  ourProfiles?: Array<KinematicsProfile | undefined>;
  oppProfiles?: Array<KinematicsProfile | undefined>;
}

export interface PitchControlGrid {
  cols: number;
  rows: number;
  /** Row-major array [row * cols + col] of our control probability in [0..1] */
  cells: Float32Array;
  ourControlPct: number;
  oppControlPct: number;
  attackingThirdOurPct: number;
  defensiveThirdOurPct: number;
}

export interface CoverShadowPolygon {
  defenderIdx: number;
  defender: PitchPoint;
  /** 4 vertices in portrait % [nearLeft, farLeft, farRight, nearRight] */
  vertices: PitchPoint[];
  lengthM: number;
}

export type PassingLaneStatus = 'open' | 'risky' | 'blocked';

export interface PassingLaneAnalysis {
  fromIdx: number;
  toIdx: number;
  from: PitchPoint;
  to: PitchPoint;
  distanceM: number;
  ballTimeSec: number;
  bestInterceptTimeSec: number;
  /** Positive means ball arrives earlier than defender; negative means defender intercepts */
  marginSec: number;
  interceptorIdx: number | null;
  interceptPoint: PitchPoint | null;
  inCoverShadow: boolean;
  status: PassingLaneStatus;
  reasonAr: string;
}

export type TacticalMoveBadge = 'brilliant' | 'strong' | 'neutral' | 'risky' | 'mistake';

export interface TacticalEvaluation {
  /** Clamped tactical index in [-5.0, +5.0] */
  score: number;
  reasonsAr: string[];
  openLanesCount: number;
  riskyLanesCount: number;
  blockedLanesCount: number;
  carrierPressureSec: number;
  /** Present ONLY when compared against a baseline/previous state */
  comparison?: {
    delta: number;
    badge: TacticalMoveBadge;
    badgeLabelAr: string;
    noteAr: string;
  };
  disclaimerAr: string;
}

export interface DominanceXRaySnapshot {
  size: PitchSizeId;
  carrierIdx: number;
  grid: PitchControlGrid;
  coverShadows: CoverShadowPolygon[];
  passingLanes: PassingLaneAnalysis[];
  evaluation: TacticalEvaluation;
}

function getProfileForIndex(
  idx: number,
  custom?: Array<KinematicsProfile | undefined>
): KinematicsProfile {
  if (custom && custom[idx]) return custom[idx] as KinematicsProfile;
  return idx === 0 ? DEFAULT_GK_KINEMATICS : DEFAULT_OUTFIELD_KINEMATICS;
}

/**
 * Computes arrival-time based Pitch Control grid (~28x18 default).
 * Uses reaction + acceleration + max speed arrival times and a smooth logistic transition.
 */
export function computePitchControlGrid(
  state: XRayInputState,
  cols = 28,
  rows = 18
): PitchControlGrid {
  const safeCols = Math.max(8, Math.min(48, Math.round(cols)));
  const safeRows = Math.max(6, Math.min(36, Math.round(rows)));
  const cells = new Float32Array(safeCols * safeRows);

  const our = state.our || [];
  const opp = state.opp || [];
  const size = state.size || '6v6';
  // Logistic steepness parameter (seconds): ~0.32s creates crisp yet smooth territorial transitions
  const tau = 0.32;

  let totalOur = 0;
  let attSum = 0;
  let attCount = 0;
  let defSum = 0;
  let defCount = 0;

  for (let r = 0; r < safeRows; r++) {
    const py = ((r + 0.5) / safeRows) * 100;
    for (let c = 0; c < safeCols; c++) {
      const px = ((c + 0.5) / safeCols) * 100;
      const cellPt: PitchPoint = { x: px, y: py };

      let minOurT = Infinity;
      for (let i = 0; i < our.length; i++) {
        const t = estimateArrivalTimeSec(
          our[i],
          cellPt,
          size,
          getProfileForIndex(i, state.ourProfiles)
        );
        if (t < minOurT) minOurT = t;
      }

      let minOppT = Infinity;
      for (let j = 0; j < opp.length; j++) {
        const t = estimateArrivalTimeSec(
          opp[j],
          cellPt,
          size,
          getProfileForIndex(j, state.oppProfiles)
        );
        if (t < minOppT) minOppT = t;
      }

      let control = 0.5;
      if (Number.isFinite(minOurT) && Number.isFinite(minOppT)) {
        const diff = clampNumber((minOurT - minOppT) / tau, -12, 12);
        control = 1 / (1 + Math.exp(diff));
      } else if (Number.isFinite(minOurT)) {
        control = 0.95;
      } else if (Number.isFinite(minOppT)) {
        control = 0.05;
      }

      cells[r * safeCols + c] = control;
      totalOur += control;
      if (py <= 34) {
        attSum += control;
        attCount++;
      } else if (py >= 66) {
        defSum += control;
        defCount++;
      }
    }
  }

  const totalCells = safeCols * safeRows;
  const ourControlPct = Math.round((totalOur / totalCells) * 100);
  const oppControlPct = 100 - ourControlPct;
  const attackingThirdOurPct = attCount ? Math.round((attSum / attCount) * 100) : 50;
  const defensiveThirdOurPct = defCount ? Math.round((defSum / defCount) * 100) : 50;

  return {
    cols: safeCols,
    rows: safeRows,
    cells,
    ourControlPct,
    oppControlPct,
    attackingThirdOurPct,
    defensiveThirdOurPct,
  };
}

/**
 * Computes geometric cover shadows cast behind defenders relative to the ball.
 */
export function computeCoverShadows(
  ball: PitchPoint,
  opp: PitchPoint[],
  size: PitchSizeId = '6v6'
): CoverShadowPolygon[] {
  const shadows: CoverShadowPolygon[] = [];
  const ballM = pctToMeters(ball, size);
  const halfShoulderM = 0.85; // realistic interception reach half-width

  for (let i = 0; i < opp.length; i++) {
    const def = opp[i];
    const defM = pctToMeters(def, size);
    const dx = defM.x - ballM.x;
    const dy = defM.y - ballM.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.8 || dist > 26) continue;

    const ux = dx / dist;
    const uy = dy / dist;
    // Perpendicular unit vector
    const px = -uy;
    const py = ux;

    // Shadow depth scales inversely with distance (closer presser casts wider, deeper cone)
    const lengthM = clampNumber(12.5 - dist * 0.25, 4.5, 11.5);
    const farHalfWidthM = halfShoulderM + lengthM * clampNumber(halfShoulderM / Math.max(dist, 2.2), 0.14, 0.34);

    const nearLeft = metersToPct({ x: defM.x + px * halfShoulderM, y: defM.y + py * halfShoulderM }, size);
    const nearRight = metersToPct({ x: defM.x - px * halfShoulderM, y: defM.y - py * halfShoulderM }, size);
    const farLeft = metersToPct(
      {
        x: defM.x + ux * lengthM + px * farHalfWidthM,
        y: defM.y + uy * lengthM + py * farHalfWidthM,
      },
      size
    );
    const farRight = metersToPct(
      {
        x: defM.x + ux * lengthM - px * farHalfWidthM,
        y: defM.y + uy * lengthM - py * farHalfWidthM,
      },
      size
    );

    shadows.push({
      defenderIdx: i,
      defender: { ...def },
      vertices: [
        clampPitchPoint(nearLeft, 1),
        clampPitchPoint(farLeft, 1),
        clampPitchPoint(farRight, 1),
        clampPitchPoint(nearRight, 1),
      ],
      lengthM,
    });
  }

  return shadows;
}

export function isPointInsidePolygon(pt: PitchPoint, poly: PitchPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;
    const intersect =
      yi > pt.y !== yj > pt.y &&
      pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi + 1e-9) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Analyzes passing lanes from the ball carrier to all teammates, checking BOTH:
 * 1) Defender Time-to-Intercept along the pass trajectory vs ball travel time.
 * 2) Whether the receiver sits inside a defender's cover shadow.
 */
export function analyzePassingLanes(
  state: XRayInputState,
  shadows?: CoverShadowPolygon[]
): { carrierIdx: number; lanes: PassingLaneAnalysis[] } {
  const our = state.our || [];
  const opp = state.opp || [];
  const size = state.size || '6v6';

  if (our.length < 2) {
    return { carrierIdx: -1, lanes: [] };
  }

  const carrierIdx =
    typeof state.carrierIdx === 'number' && state.carrierIdx >= 0 && state.carrierIdx < our.length
      ? state.carrierIdx
      : findClosestPlayerIndex(state.ball, our, size).index;

  const origin = state.ball;
  const computedShadows = shadows || computeCoverShadows(origin, opp, size);
  const lanes: PassingLaneAnalysis[] = [];

  for (let i = 0; i < our.length; i++) {
    if (i === carrierIdx) continue;
    const target = our[i];
    const distM = distanceMeters(origin, target, size);
    if (distM < 1.2) continue;

    const totalBallTime = estimateBallTravelTimeSec(origin, target, size);

    // Check if receiver is in any defender cover shadow
    let inCoverShadow = false;
    let shadowDefIdx: number | null = null;
    for (const sh of computedShadows) {
      if (isPointInsidePolygon(target, sh.vertices)) {
        inCoverShadow = true;
        shadowDefIdx = sh.defenderIdx;
        break;
      }
    }

    // Sample points along pass trajectory (20% -> 96%) to find most dangerous intercept threat
    let worstMargin = Infinity;
    let bestInterceptTime = Infinity;
    let interceptorIdx: number | null = null;
    let interceptPoint: PitchPoint | null = null;

    const samples = 9;
    for (let s = 1; s <= samples; s++) {
      const frac = 0.18 + (s / samples) * 0.78;
      const pt: PitchPoint = {
        x: origin.x + (target.x - origin.x) * frac,
        y: origin.y + (target.y - origin.y) * frac,
      };
      const ballArrivalAtPt = estimateBallTravelTimeSec(origin, pt, size);

      for (let d = 0; d < opp.length; d++) {
        // Account for ~0.65m interception lunge reach
        const rawT = estimateArrivalTimeSec(
          opp[d],
          pt,
          size,
          getProfileForIndex(d, state.oppProfiles)
        );
        const reachBonusSec = 0.1;
        const effectiveDefT = Math.max(0, rawT - reachBonusSec);
        const margin = effectiveDefT - ballArrivalAtPt;
        if (margin < worstMargin) {
          worstMargin = margin;
          bestInterceptTime = effectiveDefT;
          interceptorIdx = d;
          interceptPoint = pt;
        }
      }
    }

    let status: PassingLaneStatus = 'open';
    let reasonAr = `مسار مفتوح • الكرة أسرع بـ ${Math.max(0.05, worstMargin).toFixed(2)}ث`;

    if (worstMargin < 0.04) {
      status = 'blocked';
      const defLabel = interceptorIdx !== null ? `الخصم #${interceptorIdx + 1}` : 'مدافع الخصم';
      reasonAr = inCoverShadow
        ? `مغلق داخل ظل تغطية ${defLabel} (يعترض قبل وصول الكرة)`
        : `خطر اعتراض مباشر: ${defLabel} يصل للمسار أسرع بـ ${Math.abs(worstMargin).toFixed(2)}ث`;
    } else if (worstMargin < 0.28 || inCoverShadow) {
      status = 'risky';
      const defLabel =
        (shadowDefIdx !== null ? shadowDefIdx : interceptorIdx) !== null
          ? `الخصم #${(shadowDefIdx !== null ? shadowDefIdx : (interceptorIdx as number)) + 1}`
          : 'المدافع';
      reasonAr = inCoverShadow
        ? `تمريرة محفوفة: المستلم في طرف ظل تغطية ${defLabel}`
        : `نافذة ضيقة: هامش الأمان ${worstMargin.toFixed(2)}ث فقط أمام ${defLabel}`;
    }

    lanes.push({
      fromIdx: carrierIdx,
      toIdx: i,
      from: { ...origin },
      to: { ...target },
      distanceM: Number(distM.toFixed(1)),
      ballTimeSec: Number(totalBallTime.toFixed(2)),
      bestInterceptTimeSec: Number.isFinite(bestInterceptTime) ? Number(bestInterceptTime.toFixed(2)) : 9.9,
      marginSec: Number.isFinite(worstMargin) ? Number(worstMargin.toFixed(2)) : 3.0,
      interceptorIdx,
      interceptPoint,
      inCoverShadow,
      status,
      reasonAr,
    });
  }

  return { carrierIdx, lanes };
}

function classifyComparisonDelta(delta: number): {
  badge: TacticalMoveBadge;
  badgeLabelAr: string;
  noteAr: string;
} {
  if (delta >= 1.1) {
    return {
      badge: 'brilliant',
      badgeLabelAr: 'نقلة ذكية ★',
      noteAr: `تحسّن ملموس في التوازن التكتيكي (+${delta.toFixed(1)}) مقارنة بالوضعية السابقة`,
    };
  }
  if (delta >= 0.35) {
    return {
      badge: 'strong',
      badgeLabelAr: 'تحرك قوي ✓',
      noteAr: `تحسّن واضح في السيطرة أو خطوط التمرير (+${delta.toFixed(1)})`,
    };
  }
  if (delta <= -1.1) {
    return {
      badge: 'mistake',
      badgeLabelAr: 'خطأ تكتيكي ✕',
      noteAr: `تراجع واضح في التوازن أو كشف مساحة خطيرة (${delta.toFixed(1)})`,
    };
  }
  if (delta <= -0.35) {
    return {
      badge: 'risky',
      badgeLabelAr: 'محفوف بالمخاطر ⚠',
      noteAr: `انخفاض في أمان الوضعية (${delta.toFixed(1)}) مقارنة بالبديل السابق`,
    };
  }
  return {
    badge: 'neutral',
    badgeLabelAr: 'متوازن',
    noteAr: `فارق طفيف (${delta >= 0 ? '+' : ''}${delta.toFixed(1)}) عن الوضعية السابقة`,
  };
}

/**
 * Evaluates a tactical state on a [-5, +5] scale with concrete human-readable Arabic reasons.
 * Emits comparative move badges ONLY when a `baseline` evaluation is supplied.
 */
export function evaluateTacticalState(
  state: XRayInputState,
  grid: PitchControlGrid,
  lanes: PassingLaneAnalysis[],
  baseline?: TacticalEvaluation
): TacticalEvaluation {
  const openLanes = lanes.filter((l) => l.status === 'open');
  const riskyLanes = lanes.filter((l) => l.status === 'risky');
  const blockedLanes = lanes.filter((l) => l.status === 'blocked');

  // Progressive open passes (moving ball forward toward opponent goal y -> 0)
  const progressiveOpen = openLanes.filter((l) => l.to.y < l.from.y - 6).length;

  // Carrier pressure (fastest opponent arrival to ball)
  let carrierPressureSec = 4.0;
  for (let i = 0; i < state.opp.length; i++) {
    const t = estimateArrivalTimeSec(
      state.opp[i],
      state.ball,
      state.size,
      getProfileForIndex(i, state.oppProfiles)
    );
    if (t < carrierPressureSec) carrierPressureSec = t;
  }

  // Defensive security: check highest outfield defender Y (remember our goal is y=100)
  const ourOutfield = state.our.slice(1);
  const deepestDefY = ourOutfield.length ? Math.max(...ourOutfield.map((p) => p.y)) : 80;
  const oppAttackers = state.opp.slice(1);
  const highestOppY = oppAttackers.length ? Math.max(...oppAttackers.map((p) => p.y)) : 30;
  const exposedBehind = highestOppY > deepestDefY + 4 && deepestDefY < 62;

  // Component scores
  const controlScore = ((grid.ourControlPct - 50) / 50) * 3.4; // approx -3.4..+3.4
  const attControlScore = ((grid.attackingThirdOurPct - 45) / 55) * 1.1;
  const passingScore = clampNumber(
    openLanes.length * 0.55 + progressiveOpen * 0.45 - blockedLanes.length * 0.32,
    -1.8,
    2.2
  );
  const pressurePenalty = carrierPressureSec < 0.7 ? -0.9 : carrierPressureSec < 1.1 ? -0.35 : 0.25;
  const counterPenalty = exposedBehind ? -1.15 : 0.2;

  const rawScore = controlScore + attControlScore + passingScore + pressurePenalty + counterPenalty;
  const score = Number(clampNumber(rawScore, -5, 5).toFixed(1));

  const reasonsAr: string[] = [];
  if (openLanes.length >= 2) {
    reasonsAr.push(
      progressiveOpen >= 1
        ? `فتح ${openLanes.length} خطوط تمرير آمنة منها ${progressiveOpen} للأمام`
        : `توفّر ${openLanes.length} خيارات تمرير آمنة لحامل الكرة`
    );
  } else if (openLanes.length === 0 && lanes.length > 0) {
    reasonsAr.push('انسداد جميع خطوط التمرير المباشرة — مطلوب تحرك داعم فوراً');
  } else {
    reasonsAr.push('خيار تمرير وحيد مفتوح — زيادة الدعم تحسّن الخروج بالكرة');
  }

  if (grid.ourControlPct >= 56) {
    reasonsAr.push(`تفوق مساحي لفريقك بنسبة ${grid.ourControlPct}% من الملعب`);
  } else if (grid.ourControlPct <= 44) {
    reasonsAr.push(`سيطرة مساحية للخصم (${grid.oppControlPct}%) — تقارب الخطوط مطلوب`);
  }

  if (exposedBehind) {
    reasonsAr.push('خطر مرتدة: مساحة مكشوفة خلف آخر مدافع');
  } else if (carrierPressureSec < 0.8) {
    reasonsAr.push('حامل الكرة تحت ضغط قريب — القرار السريع ضروري');
  } else if (grid.attackingThirdOurPct >= 55) {
    reasonsAr.push(`انتشار جيد في الثلث الهجومي (${grid.attackingThirdOurPct}%)`);
  }

  const evaluation: TacticalEvaluation = {
    score,
    reasonsAr: reasonsAr.slice(0, 3),
    openLanesCount: openLanes.length,
    riskyLanesCount: riskyLanes.length,
    blockedLanesCount: blockedLanes.length,
    carrierPressureSec: Number(carrierPressureSec.toFixed(2)),
    disclaimerAr: 'تقييم هندسي نسبي مبني على زمن الوصول وخطوط التمرير — أداة تعليمية وليست حكماً مطلقاً.',
  };

  if (baseline) {
    const delta = Number((score - baseline.score).toFixed(1));
    const classified = classifyComparisonDelta(delta);
    evaluation.comparison = {
      delta,
      ...classified,
    };
  }

  return evaluation;
}

/**
 * Full Dominance X-Ray snapshot computation in a single deterministic pass.
 */
export function computeDominanceXRay(
  state: XRayInputState,
  opts?: { cols?: number; rows?: number; baseline?: TacticalEvaluation }
): DominanceXRaySnapshot {
  const grid = computePitchControlGrid(state, opts?.cols ?? 28, opts?.rows ?? 18);
  const coverShadows = computeCoverShadows(state.ball, state.opp, state.size);
  const { carrierIdx, lanes } = analyzePassingLanes(state, coverShadows);
  const evaluation = evaluateTacticalState(state, grid, lanes, opts?.baseline);

  return {
    size: state.size,
    carrierIdx,
    grid,
    coverShadows,
    passingLanes: lanes,
    evaluation,
  };
}

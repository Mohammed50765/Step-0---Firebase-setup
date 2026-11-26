import { escapeHtml, sanitizeImageDataUrl } from './security';
import type {
  FormationDef,
  MinimalPlayer,
  TacticalKeyframe,
  TacticalZone,
  RoleSpotlightInfo,
} from './tacticsData';

export interface Point2D {
  x: number;
  y: number;
}

export interface CalloutPlacement {
  x: number;
  y: number;
  w: number;
  h: number;
  edgeX: number;
  edgeY: number;
  side:
    | 'top-right'
    | 'top-left'
    | 'upper-mid-right'
    | 'upper-mid-left'
    | 'lower-mid-right'
    | 'lower-mid-left'
    | 'bottom-right'
    | 'bottom-left';
}

export interface OffsideBadgePlacement {
  x: number;
  y: number;
  w: number;
  h: number;
  textX: number;
  textY: number;
}

export interface PlayerLabelInput {
  idx: number;
  cx: number;
  cy: number;
  label: string;
}

export interface PlayerLabelPlacement {
  idx: number;
  x: number;
  y: number;
  w: number;
  h: number;
  textX: number;
  textY: number;
  label: string;
}

export interface YourRoleCardModel {
  slotIdx: number;
  slotShort: string;
  slotLabel: string;
  playerName: string | null;
  jersey: string | null;
  photoUrl: string;
  ovr: number | null;
  positionCode: string;
  momentTitle: string;
  momentSummary: string;
  duties: string[];
  isUserAssignedHere: boolean;
}

const LTR_TOKEN_RE = /(\b\d+(?:-\d+){2,3}\b|\b\d+v\d+\b)/g;

/**
 * Wraps formation strings (e.g. 3-5-2, 4-2-1-3, 2-2-1) and pitch sizes (6v6, 11v11)
 * in Unicode LRI/PDI isolates so they never reverse inside RTL <option>, SVG, or Canvas text.
 */
export function isolateLtrTokens(text: string): string {
  const str = String(text ?? '');
  if (!str) return '';
  // Strip any existing LRM / LRI / PDI wrappers so calls are strictly idempotent
  const cleaned = str.replace(/\u200E?\u2066([^\u2069]*)\u2069\u200E?/g, '$1');
  return cleaned.replace(LTR_TOKEN_RE, '\u200E\u2066$1\u2069\u200E');
}

/**
 * Escapes HTML and wraps formation/size tokens in <bdi dir="ltr">...</bdi> for RTL-safe DOM rendering.
 */
export function formatFormationHtml(text: string): string {
  const str = String(text ?? '');
  if (!str) return '';
  const cleaned = str.replace(/\u200E?\u2066([^\u2069]*)\u2069\u200E?/g, '$1');
  const escaped = escapeHtml(cleaned);
  return escaped.replace(LTR_TOKEN_RE, '<bdi dir="ltr">$1</bdi>');
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Separates opponent disc coordinates from our team discs (and from each other)
 * so opponents never stack on top of or hide behind our players, especially in 11v11.
 * Our tactical slot positions remain untouched; only opponent display positions are nudged cleanly.
 */
export function deOverlapPositions(
  ourPts: ReadonlyArray<Point2D>,
  oppPts: ReadonlyArray<Point2D>,
  minDistPct = 8.4,
  bounds: { minX: number; maxX: number; minY: number; maxY: number } = { minX: 7, maxX: 93, minY: 7, maxY: 93 }
): Point2D[] {
  const result = oppPts.map((p) => ({ x: p.x, y: p.y }));
  if (result.length === 0) return result;

  const iterations = 6;
  for (let iter = 0; iter < iterations; iter++) {
    // 1. Push opponents away from our players
    for (let i = 0; i < result.length; i++) {
      const op = result[i];
      for (let j = 0; j < ourPts.length; j++) {
        const our = ourPts[j];
        const dx = op.x - our.x;
        const dy = op.y - our.y;
        const dist = Math.hypot(dx, dy);
        if (dist < minDistPct) {
          const push = minDistPct - dist + 0.4;
          let ux: number;
          let uy: number;
          if (dist < 0.01) {
            // Deterministic separation direction (prefer toward opponent goal / side channel)
            const angle = ((i * 73 + j * 37) % 360) * (Math.PI / 180);
            ux = Math.cos(angle);
            uy = Math.sin(angle);
          } else {
            ux = dx / dist;
            uy = dy / dist;
          }
          op.x = clamp(op.x + ux * push, bounds.minX, bounds.maxX);
          op.y = clamp(op.y + uy * push, bounds.minY, bounds.maxY);
        }
      }
    }

    // 2. Push overlapping opponents slightly apart from each other
    const oppMinDist = minDistPct * 0.85;
    for (let i = 0; i < result.length; i++) {
      for (let k = i + 1; k < result.length; k++) {
        const a = result[i];
        const b = result[k];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy);
        if (dist < oppMinDist) {
          const halfPush = (oppMinDist - dist + 0.3) * 0.5;
          const ux = dist < 0.01 ? (i % 2 === 0 ? 1 : -1) : dx / dist;
          const uy = dist < 0.01 ? 0 : dy / dist;
          a.x = clamp(a.x - ux * halfPush, bounds.minX, bounds.maxX);
          a.y = clamp(a.y - uy * halfPush, bounds.minY, bounds.maxY);
          b.x = clamp(b.x + ux * halfPush, bounds.minX, bounds.maxX);
          b.y = clamp(b.y + uy * halfPush, bounds.minY, bounds.maxY);
        }
      }
    }
  }

  return result;
}

/**
 * Determines which opponent indices should receive the warm orange highlight.
 * Rule: Opponents stay calm steel-slate by default, and glow orange ONLY when
 * holding/contesting the ball or actively exploiting a marked danger gap (rose zone).
 */
export function computeOpponentAlertSet(
  oppPts: ReadonlyArray<Point2D>,
  ball: Point2D,
  ourPts: ReadonlyArray<Point2D>,
  zones?: ReadonlyArray<TacticalZone>
): Set<number> {
  const alerted = new Set<number>();
  if (!oppPts.length) return alerted;

  // Closest distance from our team to the ball
  let minOurBallDist = Infinity;
  for (const p of ourPts) {
    const d = Math.hypot(p.x - ball.x, p.y - ball.y);
    if (d < minOurBallDist) minOurBallDist = d;
  }

  // Closest opponent to the ball
  let closestOppIdx = -1;
  let minOppBallDist = Infinity;
  for (let i = 0; i < oppPts.length; i++) {
    const d = Math.hypot(oppPts[i].x - ball.x, oppPts[i].y - ball.y);
    if (d < minOppBallDist) {
      minOppBallDist = d;
      closestOppIdx = i;
    }
  }

  // Highlight ball carrier / direct presser ONLY if opponent holds or tightly contests ball
  if (closestOppIdx >= 0 && minOppBallDist <= 7.5 && minOppBallDist <= minOurBallDist + 1.5) {
    alerted.add(closestOppIdx);
  }

  // Highlight opponents exploiting an explicit danger gap (rose zone)
  if (zones && zones.length) {
    for (const z of zones) {
      if (z.color !== 'rose') continue;
      const threshold = Math.max(8, z.r + 3);
      for (let i = 0; i < oppPts.length; i++) {
        if (Math.hypot(oppPts[i].x - z.x, oppPts[i].y - z.y) <= threshold) {
          alerted.add(i);
        }
      }
    }
  }

  return alerted;
}

/**
 * Places the 11v11 offside line label badge cleanly without overlapping opponent discs
 * or clipping outside the pitch touchline.
 */
export function placeOffsideBadge(
  offsideSvgY: number,
  oppSvgPts: ReadonlyArray<Point2D>,
  svgW = 360
): OffsideBadgePlacement {
  const w = 96;
  const h = 17;
  const candidates = [
    { x: svgW - w - 20, y: offsideSvgY - h - 4 },
    { x: 20, y: offsideSvgY - h - 4 },
    { x: svgW - w - 20, y: offsideSvgY + 5 },
    { x: 20, y: offsideSvgY + 5 },
  ];

  let best = candidates[0];
  let bestScore = Infinity;

  for (const c of candidates) {
    let score = 0;
    if (c.y < 22) score += 200;
    for (const op of oppSvgPts) {
      const closestX = clamp(op.x, c.x, c.x + w);
      const closestY = clamp(op.y, c.y, c.y + h);
      const d = Math.hypot(op.x - closestX, op.y - closestY);
      if (d < 18) score += (18 - d) * 12;
    }
    if (score < bestScore) {
      bestScore = score;
      best = c;
    }
  }

  return {
    x: best.x,
    y: best.y,
    w,
    h,
    textX: best.x + w / 2,
    textY: best.y + 11.8,
  };
}

function pointToSegmentDist(p: Point2D, a: Point2D, b: Point2D): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const lenSq = vx * vx + vy * vy;
  if (lenSq < 1e-6) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = clamp(((p.x - a.x) * vx + (p.y - a.y) * vy) / lenSq, 0, 1);
  const projX = a.x + t * vx;
  const projY = a.y + t * vy;
  return Math.hypot(p.x - projX, p.y - projY);
}

function computeBoxPerimeterEdge(
  bx: number,
  by: number,
  boxW: number,
  boxH: number,
  anchorSvg: Point2D
): { edgeX: number; edgeY: number } {
  const edgeX = clamp(anchorSvg.x, bx + 8, bx + boxW - 8);
  const edgeY = clamp(anchorSvg.y, by + 8, by + boxH - 8);
  const distLeft = Math.abs(edgeX - (bx + 8));
  const distRight = Math.abs(edgeX - (bx + boxW - 8));
  const distTop = Math.abs(edgeY - (by + 8));
  const distBottom = Math.abs(edgeY - (by + boxH - 8));
  const minEdge = Math.min(distLeft, distRight, distTop, distBottom);

  let finalEdgeX = edgeX;
  let finalEdgeY = edgeY;
  if (minEdge === distLeft) finalEdgeX = bx;
  else if (minEdge === distRight) finalEdgeX = bx + boxW;
  else if (minEdge === distTop) finalEdgeY = by;
  else finalEdgeY = by + boxH;
  return { edgeX: finalEdgeX, edgeY: finalEdgeY };
}

/**
 * Chooses the cleanest non-overlapping quadrant position inside the SVG pitch for the glass callout box:
 * strongly prefers the nearest clear quadrant to anchorSvg and penalizes pointer lines crossing over players.
 */
export function placeCalloutBox(
  anchorSvg: Point2D,
  obstaclesSvg: ReadonlyArray<Point2D>,
  svgW = 360,
  svgH = 520,
  boxW = 132,
  boxH = 74
): CalloutPlacement {
  const marginX = 20;
  const candidates: Array<{
    side: CalloutPlacement['side'];
    x: number;
    y: number;
  }> = [
    { side: 'top-right', x: svgW - boxW - marginX, y: 24 },
    { side: 'top-left', x: marginX, y: 24 },
    { side: 'upper-mid-right', x: svgW - boxW - marginX, y: Math.round(svgH * 0.25) },
    { side: 'upper-mid-left', x: marginX, y: Math.round(svgH * 0.25) },
    { side: 'lower-mid-right', x: svgW - boxW - marginX, y: Math.round(svgH * 0.56) },
    { side: 'lower-mid-left', x: marginX, y: Math.round(svgH * 0.56) },
    { side: 'bottom-right', x: svgW - boxW - marginX, y: svgH - boxH - 26 },
    { side: 'bottom-left', x: marginX, y: svgH - boxH - 26 },
  ];

  let best = candidates[0];
  let bestEdge = computeBoxPerimeterEdge(best.x, best.y, boxW, boxH, anchorSvg);
  let bestScore = Infinity;

  for (const c of candidates) {
    let score = 0;
    const cx = c.x + boxW / 2;
    const cy = c.y + boxH / 2;
    const edge = computeBoxPerimeterEdge(c.x, c.y, boxW, boxH, anchorSvg);

    // 1. Heavily penalize overlapping the active anchor itself
    const ancDistX = Math.max(c.x - anchorSvg.x, 0, anchorSvg.x - (c.x + boxW));
    const ancDistY = Math.max(c.y - anchorSvg.y, 0, anchorSvg.y - (c.y + boxH));
    const ancGap = Math.hypot(ancDistX, ancDistY);
    if (ancGap < 26) score += (26 - ancGap) * 52;

    // 2. Penalize overlapping any disc/ball obstacle
    for (const obs of obstaclesSvg) {
      const dx = Math.max(c.x - obs.x, 0, obs.x - (c.x + boxW));
      const dy = Math.max(c.y - obs.y, 0, obs.y - (c.y + boxH));
      const d = Math.hypot(dx, dy);
      if (d < 22) score += (22 - d) * 20;

      // 3. Line-of-sight penalty: discourage pointer lines cutting through other players
      if (Math.hypot(obs.x - anchorSvg.x, obs.y - anchorSvg.y) > 20) {
        const segDist = pointToSegmentDist(obs, { x: edge.edgeX, y: edge.edgeY }, anchorSvg);
        if (segDist < 19) {
          score += (19 - segDist) * 14;
        }
      }
    }

    // 4. Strongly prefer the nearest quadrant so the pointer line stays short & elegant
    const pointerLen = Math.hypot(edge.edgeX - anchorSvg.x, edge.edgeY - anchorSvg.y);
    const centerDist = Math.hypot(cx - anchorSvg.x, cy - anchorSvg.y);
    score += pointerLen * 1.05 + centerDist * 0.35;
    if (pointerLen > 190) score += (pointerLen - 190) * 1.4;

    if (score < bestScore) {
      bestScore = score;
      best = c;
      bestEdge = edge;
    }
  }

  return {
    x: best.x,
    y: best.y,
    w: boxW,
    h: boxH,
    edgeX: bestEdge.edgeX,
    edgeY: bestEdge.edgeY,
    side: best.side,
  };
}

/**
 * Smartly offsets the rendered football beside the ball-carrier's foot when resting on/inside a player disc,
 * so the ball NEVER covers the player's disc or position label (passes mid-flight stay on exact trajectory).
 */
export function computeSmartBallDisplayPoint(
  ballSvg: Point2D,
  ourSvgPts: ReadonlyArray<Point2D>,
  oppSvgPts: ReadonlyArray<Point2D>,
  discR: number,
  isInFlight: boolean,
  svgW = 360,
  svgH = 520
): Point2D {
  if (isInFlight) return { x: ballSvg.x, y: ballSvg.y };

  let nearest: Point2D | null = null;
  let nearestDist = Infinity;
  const allPlayers = [...ourSvgPts, ...oppSvgPts];
  for (const p of allPlayers) {
    const d = Math.hypot(ballSvg.x - p.x, ballSvg.y - p.y);
    if (d < nearestDist) {
      nearestDist = d;
      nearest = p;
    }
  }

  const minClear = discR + 6.5;
  if (!nearest || nearestDist >= minClear) {
    return { x: ballSvg.x, y: ballSvg.y };
  }

  // Offset neatly beside the player's foot (toward pitch center horizontally, slightly below/forward vertically)
  const dirX = nearest.x > svgW * 0.54 ? -1 : 1;
  const dirY = nearest.y > svgH * 0.84 ? -0.58 : 0.62;
  const norm = Math.hypot(dirX, dirY) || 1;
  const targetX = clamp(nearest.x + (dirX / norm) * (discR + 7.5), 24, svgW - 24);
  const targetY = clamp(nearest.y + (dirY / norm) * (discR + 7.5), 26, svgH - 26);
  return { x: targetX, y: targetY };
}

/**
 * Places tactical zone captions (e.g. «زاوية آمنة») safely clear of top/bottom penalty box chalk lines
 * (y=82 and y=438 in 360x520 SVG pitch) and nearby player discs.
 */
export function placeZoneLabelY(
  cx: number,
  cy: number,
  r: number,
  obstaclesSvg: ReadonlyArray<Point2D>,
  svgH = 520
): number {
  const chalkLines = [18, 82, svgH / 2, svgH - 82, svgH - 18];
  const candidates = [cy + r + 13, cy - r - 7, cy + r + 24, cy - r - 18];

  let bestY = candidates[0];
  let bestScore = Infinity;

  for (let i = 0; i < candidates.length; i++) {
    const y = candidates[i];
    let score = i * 6;
    if (y < 28 || y > svgH - 22) score += 250;

    for (const lineY of chalkLines) {
      const distLine = Math.abs(y - 3 - lineY);
      if (distLine < 11) score += (11 - distLine) * 24;
    }
    for (const obs of obstaclesSvg) {
      const d = Math.hypot(obs.x - cx, obs.y - (y - 3));
      if (d < 22) score += (22 - d) * 10;
    }

    if (score < bestScore) {
      bestScore = score;
      bestY = y;
    }
  }
  return bestY;
}

/**
 * Places player name tags ONLY for slots that have a real assigned player (non-empty label).
 * Prevents overlapping adjacent discs or clipping outside the pitch frame.
 */
export function placePlayerLabels(
  tokens: ReadonlyArray<PlayerLabelInput>,
  allObstacles: ReadonlyArray<Point2D>,
  discR: number,
  svgW = 360,
  svgH = 520
): PlayerLabelPlacement[] {
  const placed: PlayerLabelPlacement[] = [];

  for (const t of tokens) {
    const clean = t.label.trim();
    if (!clean) continue;
    const text = clean.slice(0, 9);
    const w = Math.max(42, Math.min(62, text.length * 6.4 + 14));
    const h = 14;

    const belowY = t.cy + discR + 3;
    const aboveY = t.cy - discR - h - 3;

    const candidates = [
      { x: clamp(t.cx - w / 2, 18, svgW - 18 - w), y: belowY },
      { x: clamp(t.cx - w / 2, 18, svgW - 18 - w), y: aboveY },
    ];

    let best = candidates[0];
    let bestScore = Infinity;

    for (let ci = 0; ci < candidates.length; ci++) {
      const c = candidates[ci];
      let score = ci === 0 ? 0 : 8; // Prefer below unless obstructed
      if (c.y + h > svgH - 18 || c.y < 18) score += 200;

      for (const obs of allObstacles) {
        if (Math.hypot(obs.x - t.cx, obs.y - t.cy) < 1) continue;
        const dx = Math.max(c.x - obs.x, 0, obs.x - (c.x + w));
        const dy = Math.max(c.y - obs.y, 0, obs.y - (c.y + h));
        const d = Math.hypot(dx, dy);
        if (d < discR + 3) score += (discR + 3 - d) * 14;
      }

      for (const prev of placed) {
        const overlapX = Math.max(0, Math.min(c.x + w, prev.x + prev.w) - Math.max(c.x, prev.x));
        const overlapY = Math.max(0, Math.min(c.y + h, prev.y + prev.h) - Math.max(c.y, prev.y));
        if (overlapX > 0 && overlapY > 0) score += 160;
      }

      if (score < bestScore) {
        bestScore = score;
        best = c;
      }
    }

    placed.push({
      idx: t.idx,
      x: best.x,
      y: best.y,
      w,
      h,
      textX: best.x + w / 2,
      textY: best.y + 10.2,
      label: text,
    });
  }

  return placed;
}

function mapArabicPosToGroup(primaryPos?: string): 'GK' | 'DEF' | 'MID' | 'FWD' {
  const s = String(primaryPos || '');
  if (s.includes('حارس')) return 'GK';
  if (s.includes('دفاع') || s.includes('ظهير') || s.includes('مدافع')) return 'DEF';
  if (s.includes('مهاجم') || s.includes('جناح') || s.includes('هجوم')) return 'FWD';
  return 'MID';
}

function posShortFromArabic(primaryPos?: string): string {
  const s = String(primaryPos || '');
  if (s.includes('حارس')) return 'GK';
  if (s.includes('ظهير')) return 'WB';
  if (s.includes('دفاع') || s.includes('مدافع')) return 'CB';
  if (s.includes('جناح')) return 'WNG';
  if (s.includes('مهاجم') || s.includes('هجوم')) return 'ST';
  return 'MID';
}

/**
 * Resolves the «دورك في الخطة» bottom card data using ONLY real player data.
 * Never fabricates OVR or fake attributes when missing.
 */
export function resolveYourRoleCard(params: {
  form: FormationDef;
  assigned: ReadonlyArray<MinimalPlayer | undefined>;
  currentUser: MinimalPlayer | null;
  frame: TacticalKeyframe | undefined;
  spotlightSlotIdx: number | null;
  getRoleInfo: (slotIdx: number) => RoleSpotlightInfo;
  getPlayerOvr?: (p: MinimalPlayer) => number | null;
}): YourRoleCardModel {
  const { form, assigned, currentUser, frame, spotlightSlotIdx, getRoleInfo, getPlayerOvr } = params;

  let slotIdx = 0;
  let isUserAssignedHere = false;

  if (spotlightSlotIdx !== null && form.slots[spotlightSlotIdx]) {
    slotIdx = spotlightSlotIdx;
    isUserAssignedHere = Boolean(currentUser && assigned[slotIdx]?.id === currentUser.id);
  } else if (currentUser) {
    const exactAssigned = assigned.findIndex((p) => p && p.id === currentUser.id);
    if (exactAssigned >= 0) {
      slotIdx = exactAssigned;
      isUserAssignedHere = true;
    } else {
      const grp = mapArabicPosToGroup(currentUser.primaryPos);
      const posMatch = form.slots.findIndex((s) => s.posGroup === grp);
      if (posMatch >= 0) {
        slotIdx = posMatch;
      } else if (frame?.activeIndices?.length && form.slots[frame.activeIndices[0]]) {
        slotIdx = frame.activeIndices[0];
      }
    }
  } else if (frame?.activeIndices?.length && form.slots[frame.activeIndices[0]]) {
    slotIdx = frame.activeIndices[0];
  }

  const slot = form.slots[slotIdx] || form.slots[0];
  const roleInfo = getRoleInfo(slotIdx);

  // Use the spotlighted slot's assigned player if user explicitly tapped another slot,
  // otherwise represent the real currentUser on the Royal Shield
  const shieldPlayer: MinimalPlayer | null =
    spotlightSlotIdx !== null ? assigned[slotIdx] || null : assigned[slotIdx] || currentUser || null;

  const rawOvr = shieldPlayer && getPlayerOvr ? getPlayerOvr(shieldPlayer) : null;
  const ovr = typeof rawOvr === 'number' && Number.isFinite(rawOvr) && rawOvr > 0 ? Math.round(rawOvr) : null;
  const photoUrl = shieldPlayer?.photo ? sanitizeImageDataUrl(shieldPlayer.photo, 250000) : '';
  const positionCode = slot?.short || posShortFromArabic(shieldPlayer?.primaryPos);

  const duties: string[] = [];
  if (roleInfo.offenseDuties[0]) duties.push(roleInfo.offenseDuties[0]);
  if (roleInfo.defenseDuties[0]) duties.push(roleInfo.defenseDuties[0]);
  if (roleInfo.goldenRule) duties.push(roleInfo.goldenRule);

  return {
    slotIdx,
    slotShort: slot?.short || 'MID',
    slotLabel: slot?.label || 'لاعب وسط',
    playerName: shieldPlayer?.name || null,
    jersey: shieldPlayer?.jersey != null ? String(shieldPlayer.jersey) : null,
    photoUrl,
    ovr,
    positionCode,
    momentTitle: frame?.title || roleInfo.slotLabel,
    momentSummary: frame?.narration || roleInfo.goldenRule,
    duties: duties.slice(0, 3),
    isUserAssignedHere,
  };
}

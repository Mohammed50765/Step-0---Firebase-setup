import { escapeHtml } from '../security';
import { PRO_SVG_H, PRO_SVG_W, portraitPctToProSvg } from '../tacticsProBoard';
import type { DominanceXRaySnapshot, PassingLaneAnalysis } from '../engine/dominanceXRay';
import type { PitchPoint } from '../engine/tacticalGeometry';

export type XRayOrientation = 'portrait' | 'landscape';

const PORTRAIT_W = 360;
const PORTRAIT_H = 520;

function projectPoint(pt: PitchPoint, orientation: XRayOrientation): { x: number; y: number } {
  if (orientation === 'landscape') {
    return portraitPctToProSvg(pt);
  }
  const cx = Math.max(2, Math.min(98, pt.x));
  const cy = Math.max(2, Math.min(98, pt.y));
  return {
    x: 18 + (cx / 100) * (PORTRAIT_W - 36),
    y: 20 + (cy / 100) * (PORTRAIT_H - 40),
  };
}

/**
 * Draws the Dominance X-Ray layer onto a transparent overlay <canvas> aligned exactly
 * to either the portrait SVG pitch (360x520) or the landscape Pro SVG pitch (860x520).
 */
export function renderXRayCanvas(
  canvas: HTMLCanvasElement,
  snapshot: DominanceXRaySnapshot,
  orientation: XRayOrientation
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const logicalW = orientation === 'landscape' ? PRO_SVG_W : PORTRAIT_W;
  const logicalH = orientation === 'landscape' ? PRO_SVG_H : PORTRAIT_H;
  const dpr = Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 2);

  const targetW = Math.round(logicalW * dpr);
  const targetH = Math.round(logicalH * dpr);
  if (canvas.width !== targetW || canvas.height !== targetH) {
    canvas.width = targetW;
    canvas.height = targetH;
  }

  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, logicalW, logicalH);

  // Clip strictly inside the playable grass rectangle
  const clipRect =
    orientation === 'landscape'
      ? { x: 48, y: 30, w: PRO_SVG_W - 96, h: PRO_SVG_H - 60 }
      : { x: 18, y: 20, w: PORTRAIT_W - 36, h: PORTRAIT_H - 40 };

  ctx.beginPath();
  ctx.rect(clipRect.x, clipRect.y, clipRect.w, clipRect.h);
  ctx.clip();

  // 1) Pitch Control Heatmap (Royal Gold = our dominance, Obsidian Slate = opponent dominance)
  const { cols, rows, cells } = snapshot.grid;
  const stepX = 100 / cols;
  const stepY = 100 / rows;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const val = cells[r * cols + c];
      const delta = val - 0.5;
      if (Math.abs(delta) < 0.045) continue;

      const p0 = projectPoint({ x: c * stepX, y: r * stepY }, orientation);
      const p1 = projectPoint({ x: (c + 1) * stepX, y: (r + 1) * stepY }, orientation);
      const rx = Math.min(p0.x, p1.x);
      const ry = Math.min(p0.y, p1.y);
      const rw = Math.abs(p1.x - p0.x) + 0.8;
      const rh = Math.abs(p1.y - p0.y) + 0.8;

      if (delta > 0) {
        const alpha = Math.min(0.42, delta * 0.78);
        ctx.fillStyle = `rgba(250, 204, 21, ${alpha.toFixed(3)})`;
      } else {
        const alpha = Math.min(0.48, Math.abs(delta) * 0.86);
        ctx.fillStyle = `rgba(9, 13, 24, ${alpha.toFixed(3)})`;
      }
      ctx.fillRect(rx, ry, rw, rh);
    }
  }

  // 2) Cover Shadows behind opponent defenders relative to ball
  for (const sh of snapshot.coverShadows) {
    if (sh.vertices.length < 3) continue;
    ctx.beginPath();
    const first = projectPoint(sh.vertices[0], orientation);
    ctx.moveTo(first.x, first.y);
    for (let i = 1; i < sh.vertices.length; i++) {
      const pt = projectPoint(sh.vertices[i], orientation);
      ctx.lineTo(pt.x, pt.y);
    }
    ctx.closePath();
    ctx.fillStyle = 'rgba(244, 63, 94, 0.16)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(251, 113, 133, 0.34)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // 3) Passing Lanes (Open = Royal Gold, Risky = Amber, Blocked = Crimson + intercept X)
  for (const lane of snapshot.passingLanes) {
    drawPassingLane(ctx, lane, orientation);
  }

  ctx.restore();
}

function drawPassingLane(
  ctx: CanvasRenderingContext2D,
  lane: PassingLaneAnalysis,
  orientation: XRayOrientation
): void {
  const from = projectPoint(lane.from, orientation);
  const to = projectPoint(lane.to, orientation);

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);

  if (lane.status === 'open') {
    ctx.strokeStyle = 'rgba(250, 204, 21, 0.92)';
    ctx.lineWidth = orientation === 'landscape' ? 2.6 : 2.1;
    ctx.setLineDash([]);
  } else if (lane.status === 'risky') {
    ctx.strokeStyle = 'rgba(245, 158, 11, 0.82)';
    ctx.lineWidth = orientation === 'landscape' ? 2.1 : 1.7;
    ctx.setLineDash([6, 4]);
  } else {
    ctx.strokeStyle = 'rgba(244, 63, 94, 0.72)';
    ctx.lineWidth = orientation === 'landscape' ? 1.8 : 1.5;
    ctx.setLineDash([3, 4]);
  }
  ctx.stroke();
  ctx.setLineDash([]);

  // Arrowhead for open & risky lanes
  if (lane.status !== 'blocked') {
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    const headLen = orientation === 'landscape' ? 9 : 7.5;
    const tipX = to.x - Math.cos(angle) * 12;
    const tipY = to.y - Math.sin(angle) * 12;
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(
      tipX - headLen * Math.cos(angle - Math.PI / 6),
      tipY - headLen * Math.sin(angle - Math.PI / 6)
    );
    ctx.lineTo(
      tipX - headLen * Math.cos(angle + Math.PI / 6),
      tipY - headLen * Math.sin(angle + Math.PI / 6)
    );
    ctx.closePath();
    ctx.fillStyle = lane.status === 'open' ? '#facc15' : '#f59e0b';
    ctx.fill();
  } else if (lane.interceptPoint) {
    // Draw crisp crimson X marker at the predicted intercept point
    const ix = projectPoint(lane.interceptPoint, orientation);
    const sz = orientation === 'landscape' ? 5.5 : 4.5;
    ctx.beginPath();
    ctx.moveTo(ix.x - sz, ix.y - sz);
    ctx.lineTo(ix.x + sz, ix.y + sz);
    ctx.moveTo(ix.x + sz, ix.y - sz);
    ctx.lineTo(ix.x - sz, ix.y + sz);
    ctx.strokeStyle = '#fb7185';
    ctx.lineWidth = 2.2;
    ctx.stroke();
  }

  ctx.restore();
}

export function clearXRayCanvas(canvas: HTMLCanvasElement | null): void {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

/**
 * Renders the compact Royal Black & Gold X-Ray Evaluation & Passing Lanes readout panel.
 */
export function buildXRayHudHtml(snapshot: DominanceXRaySnapshot): string {
  const { grid, evaluation, passingLanes } = snapshot;
  const scoreSign = evaluation.score > 0 ? '+' : '';
  const scoreColor =
    evaluation.score >= 1.0 ? '#facc15' : evaluation.score <= -1.0 ? '#fb7185' : '#e4e4e7';

  const cmp = evaluation.comparison;
  const badgeColor =
    cmp?.badge === 'brilliant'
      ? '#facc15'
      : cmp?.badge === 'strong'
        ? '#4ade80'
        : cmp?.badge === 'mistake'
          ? '#fb7185'
          : cmp?.badge === 'risky'
            ? '#fbbf24'
            : '#a1a1aa';

  const keyThreat = passingLanes.find((l) => l.status === 'blocked' || l.status === 'risky');
  const bestOpen = passingLanes
    .filter((l) => l.status === 'open')
    .sort((a, b) => b.marginSec - a.marginSec)[0];

  return `
    <div class="xray-hud-top">
      <div class="xray-hud-title">
        <span style="color:#facc15;font-weight:900;">أشعة X للسيطرة والمساحات</span>
        ${
          cmp
            ? `<span class="xray-cmp-tag" style="color:${badgeColor};border-color:${badgeColor}55;">${escapeHtml(cmp.badgeLabelAr)} (<bdi dir="ltr">${cmp.delta >= 0 ? '+' : ''}${cmp.delta.toFixed(1)}</bdi>)</span>`
            : ''
        }
      </div>
      <div class="xray-score-box" dir="ltr" style="color:${scoreColor};" title="مؤشر التقييم التكتيكي من -5 إلى +5">
        ${scoreSign}${evaluation.score.toFixed(1)} <span style="font-size:0.68rem;color:#a1a1aa;">/ 5</span>
      </div>
    </div>

    <div class="xray-control-bar-wrap">
      <div class="xray-control-labels">
        <span style="color:#facc15;font-weight:800;">فريقك <bdi dir="ltr">${grid.ourControlPct}%</bdi></span>
        <span class="muted">خطوط التمرير: <strong style="color:#facc15;">${evaluation.openLanesCount} مفتوح</strong> • <strong style="color:#fbbf24;">${evaluation.riskyLanesCount} خطر</strong> • <strong style="color:#fb7185;">${evaluation.blockedLanesCount} مغلق</strong></span>
        <span style="color:#cbd5e1;font-weight:800;">الخصم <bdi dir="ltr">${grid.oppControlPct}%</bdi></span>
      </div>
      <div class="xray-control-track" role="img" aria-label="نسبة السيطرة على الملعب">
        <div class="xray-control-fill-our" style="width:${grid.ourControlPct}%;"></div>
      </div>
    </div>

    <div class="xray-reasons">
      ${evaluation.reasonsAr
        .map((r) => `<div class="xray-reason-item">• ${escapeHtml(r)}</div>`)
        .join('')}
      ${bestOpen ? `<div class="xray-reason-item" style="color:#fde047;">✓ أفضل مسار: ${escapeHtml(bestOpen.reasonAr)}</div>` : ''}
      ${keyThreat ? `<div class="xray-reason-item" style="color:#fda4af;">⚠ تحذير: ${escapeHtml(keyThreat.reasonAr)}</div>` : ''}
    </div>

    <div class="xray-legend-row">
      <span><i style="background:#facc15;"></i> سيطرة فريقك / تمريرة آمنة</span>
      <span><i style="background:#1e293b;border:1px solid #475569;"></i> سيطرة الخصم</span>
      <span><i style="background:#fb7185;"></i> ظل التغطية / اعتراض</span>
    </div>
    <div class="xray-disclaimer">${escapeHtml(evaluation.disclaimerAr)}</div>
  `;
}

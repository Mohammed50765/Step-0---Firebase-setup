import { escapeHtml } from '../security';
import {
  buildTimelineMetrics,
  evalBallArc,
  interpolatePoints,
  projectClientToPitchPct,
  sampleTimeline,
} from '../tacticsEngine';
import { computeDominanceXRay } from '../engine/dominanceXRay';
import {
  analyzeGhostPassIntercept,
  decodeGhostPlayFromHash,
  encodeGhostPlayToHash,
  ghostPlayToTacticalSequence,
  type GhostPlayV1,
} from '../engine/ghostPlay';
import type { PitchPoint } from '../engine/tacticalGeometry';
import { buildXRayHudHtml, clearXRayCanvas, renderXRayCanvas } from './xrayRenderer';

const W = 360;
const H = 520;

function toSvgX(x: number): number {
  return 18 + (Math.max(2, Math.min(98, x)) / 100) * (W - 36);
}

function toSvgY(y: number): number {
  return 20 + (Math.max(2, Math.min(98, y)) / 100) * (H - 40);
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 500);
}

/**
 * Exports a GhostPlayV1 as a local WebM video via MediaRecorder + offscreen Canvas when supported,
 * or gracefully falls back to JSON download when MediaRecorder/WebM is unsupported.
 */
export async function exportGhostPlayLocalMedia(
  play: GhostPlayV1,
  opts?: { withXRay?: boolean; onStatus?: (msg: string) => void }
): Promise<{ mode: 'webm' | 'json'; fileName: string; messageAr: string }> {
  const safeBase = (play.title || 'maydan-ghost-play')
    .replace(/[^\u0600-\u06FFa-zA-Z0-9_-]+/g, '_')
    .slice(0, 32) || 'maydan_ghost';

  const canRecord =
    typeof window !== 'undefined' &&
    typeof MediaRecorder !== 'undefined' &&
    typeof HTMLCanvasElement !== 'undefined' &&
    typeof HTMLCanvasElement.prototype.captureStream === 'function';

  let mimeType = '';
  if (canRecord) {
    const candidates = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
    mimeType = candidates.find((m) => MediaRecorder.isTypeSupported(m)) || '';
  }

  if (!canRecord || !mimeType) {
    const jsonBlob = new Blob([JSON.stringify(play, null, 2)], { type: 'application/json' });
    const fileName = `${safeBase}.maydan-ghost.json`;
    downloadBlob(jsonBlob, fileName);
    return {
      mode: 'json',
      fileName,
      messageAr: 'متصفحك لا يدعم تسجيل WebM محلياً — تم تصدير الخطة بصيغة JSON آمنة كبديل فوري ✓',
    };
  }

  opts?.onStatus?.('جاري تسجيل الخطة محلياً بصيغة WebM...');
  const canvas = document.createElement('canvas');
  canvas.width = 720;
  canvas.height = 1040;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    const jsonBlob = new Blob([JSON.stringify(play, null, 2)], { type: 'application/json' });
    const fileName = `${safeBase}.maydan-ghost.json`;
    downloadBlob(jsonBlob, fileName);
    return { mode: 'json', fileName, messageAr: 'تعذّر تهيئة لوحة التسجيل — تم تصدير JSON كبديل.' };
  }

  const xrayCanvas = document.createElement('canvas');
  const seq = ghostPlayToTacticalSequence(play);
  const metrics = buildTimelineMetrics(seq.frames);
  const totalMs = Math.min(14000, Math.max(2400, metrics.totalMs));

  const stream = canvas.captureStream(30);
  const chunks: BlobPart[] = [];
  const recorder = new MediaRecorder(stream, { mimeType });
  recorder.ondataavailable = (ev) => {
    if (ev.data && ev.data.size > 0) chunks.push(ev.data);
  };

  const stoppedPromise = new Promise<Blob>((resolve) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
  });

  recorder.start(120);

  const drawFrameAt = (elapsedMs: number) => {
    const sample = sampleTimeline(metrics, elapsedMs);
    const prevIdx = Math.max(0, sample.frameIdx - 1);
    const fFrom = seq.frames[prevIdx] || seq.frames[0];
    const fTo = seq.frames[sample.frameIdx] || fFrom;
    const our = interpolatePoints(fFrom.ourPos, fTo.ourPos, sample.moveT);
    const opp = interpolatePoints(fFrom.oppPos, fTo.oppPos, sample.moveT);
    const ballArc = evalBallArc(fFrom.ball, fTo.ball, sample.moveT);
    const ball = { x: ballArc.x, y: ballArc.y };

    ctx.save();
    ctx.setTransform(2, 0, 0, 2, 0, 0);
    // Emerald royal pitch background
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#073114');
    grad.addColorStop(0.5, '#0f5a23');
    grad.addColorStop(1, '#05240e');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // Pitch lines
    ctx.strokeStyle = 'rgba(255,255,255,0.72)';
    ctx.lineWidth = 1.6;
    ctx.strokeRect(18, 20, W - 36, H - 40);
    ctx.beginPath();
    ctx.moveTo(18, H / 2);
    ctx.lineTo(W - 18, H / 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(W / 2, H / 2, 34, 0, Math.PI * 2);
    ctx.stroke();

    // Optional X-Ray overlay baked into WebM export
    if (opts?.withXRay) {
      const snap = computeDominanceXRay({ size: play.size, our, opp, ball });
      renderXRayCanvas(xrayCanvas, snap, 'portrait');
      ctx.drawImage(xrayCanvas, 0, 0, W, H);
    }

    // Draw players
    opp.forEach((p, idx) => {
      const cx = toSvgX(p.x);
      const cy = toSvgY(p.y);
      ctx.beginPath();
      ctx.arc(cx, cy, 13, 0, Math.PI * 2);
      ctx.fillStyle = '#1e293b';
      ctx.fill();
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 1.8;
      ctx.stroke();
      ctx.fillStyle = '#e2e8f0';
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(idx + 1), cx, cy);
    });

    our.forEach((p, idx) => {
      const cx = toSvgX(p.x);
      const cy = toSvgY(p.y);
      ctx.beginPath();
      ctx.arc(cx, cy, 14, 0, Math.PI * 2);
      ctx.fillStyle = '#0f172a';
      ctx.fill();
      ctx.strokeStyle = '#facc15';
      ctx.lineWidth = 2.2;
      ctx.stroke();
      ctx.fillStyle = '#fef08a';
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(idx + 1), cx, cy);
    });

    // Ball
    const bx = toSvgX(ball.x);
    const by = toSvgY(ball.y);
    ctx.beginPath();
    ctx.arc(bx, by, 6.2, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = '#18181b';
    ctx.lineWidth = 1.4;
    ctx.stroke();

    // Watermark header
    ctx.fillStyle = 'rgba(7,7,9,0.72)';
    ctx.fillRect(0, 0, W, 22);
    ctx.fillStyle = '#facc15';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`ميدان 6v6 • ${play.title}`, W / 2, 11);
    ctx.restore();
  };

  await new Promise<void>((resolve) => {
    const startTs = performance.now();
    const tick = (now: number) => {
      const elapsed = now - startTs;
      drawFrameAt(Math.min(elapsed, totalMs));
      if (elapsed < totalMs) {
        requestAnimationFrame(tick);
      } else {
        resolve();
      }
    };
    requestAnimationFrame(tick);
  });

  recorder.stop();
  stream.getTracks().forEach((t) => t.stop());
  const webmBlob = await stoppedPromise;
  const fileName = `${safeBase}.webm`;
  downloadBlob(webmBlob, fileName);

  return {
    mode: 'webm',
    fileName,
    messageAr: `تم تصدير فيديو الخطة محلياً (${fileName}) بصيغة WebM ✓`,
  };
}

/**
 * Builds a complete shareable Ghost Link URL (`origin + pathname + #ghost=v1...`)
 * without touching query params or existing `#join=` invite links.
 */
export function buildShareableGhostLink(play: GhostPlayV1): {
  ok: boolean;
  url?: string;
  hash?: string;
  tooLarge?: boolean;
  fallbackJson: string;
  reasonAr?: string;
} {
  const res = encodeGhostPlayToHash(play);
  if (!res.ok || !res.hash) {
    return {
      ok: false,
      tooLarge: res.tooLarge,
      fallbackJson: res.fallbackJson,
      reasonAr: res.reasonAr,
    };
  }
  const base =
    typeof window !== 'undefined' && window.location
      ? `${window.location.origin}${window.location.pathname}`
      : '';
  return {
    ok: true,
    hash: res.hash,
    url: `${base}${res.hash}`,
    fallbackJson: res.fallbackJson,
  };
}

/**
 * Standalone Zero-Login, Zero-Firestore Ghost Play Theater Modal.
 * Opens automatically when visiting `#ghost=v1...` (even when logged out) or when previewing a Ghost Link.
 * Includes full animation playback, X-Ray sync toggle, Challenge Mode (drag defenders + live Time-to-Intercept),
 * and local WebM/JSON export.
 */
export function openGhostGuestViewer(
  play: GhostPlayV1,
  opts?: { onClose?: () => void; toast?: (msg: string, isErr?: boolean) => void }
): void {
  const existing = document.getElementById('maydanGhostViewerModal');
  if (existing) existing.remove();

  const seq = ghostPlayToTacticalSequence(play);
  const metrics = buildTimelineMetrics(seq.frames);

  let isPlaying = false;
  let elapsedMs = 0;
  let rafId: number | null = null;
  let lastTs = 0;
  let xrayOn = false;
  let challengeMode = false;
  let challengeOpp: PitchPoint[] = play.frames[0].opp.map((p) => ({ ...p }));
  let draggingOppIdx: number | null = null;
  let currentFrameIdx = 0;

  const modal = document.createElement('div');
  modal.id = 'maydanGhostViewerModal';
  modal.className = 'tac-lab-modal-backdrop';
  modal.style.zIndex = '9996';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', `عرض خطة الشبح: ${play.title}`);

  modal.innerHTML = `
    <div class="tac-lab-modal-card" dir="rtl" style="max-width:520px;">
      <div class="tac-lab-modal-head">
        <div>
          <div style="font-size:0.7rem;color:#facc15;font-weight:800;">👻 مسرح خطة الشبح (بدون تسجيل دخول • محلي 100%)</div>
          <h3 style="margin:2px 0 0;font-size:1.02rem;color:#fff;">${escapeHtml(play.title)}</h3>
        </div>
        <button type="button" id="btnCloseGhostViewer" class="icon-btn" aria-label="إغلاق">✕</button>
      </div>

      <div class="tac-lab-stage-wrap" style="position:relative;max-width:340px;margin:0 auto 10px;">
        <svg id="ghostViewerSvg" viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block;border-radius:14px;touch-action:none;"></svg>
        <canvas id="ghostViewerXray" class="xray-overlay-canvas hidden" aria-hidden="true"></canvas>
      </div>

      <div id="ghostInterceptBanner" class="item-box" style="margin-bottom:8px;border-color:rgba(250,204,21,0.35);font-size:0.78rem;"></div>
      <div id="ghostXrayHud" class="xray-hud-panel hidden" style="margin-bottom:8px;"></div>

      <div class="grid-3" style="gap:6px;margin-bottom:8px;">
        <button type="button" id="btnGhostPlayToggle" class="btn-primary" style="min-height:38px;font-size:0.8rem;">▶ تشغيل</button>
        <button type="button" id="btnGhostToggleXray" class="tac-tool-btn" style="min-height:38px;font-size:0.78rem;">🔬 أشعة X</button>
        <button type="button" id="btnGhostChallenge" class="tac-tool-btn" style="min-height:38px;font-size:0.78rem;">🛡️ تحدّي الإيقاف</button>
      </div>

      <div class="row between" style="gap:6px;flex-wrap:wrap;">
        <span id="ghostStepInfo" class="muted" style="font-size:0.74rem;">اللقطة 1 / ${play.frames.length}</span>
        <div class="row" style="gap:6px;">
          <button type="button" id="btnGhostExportWebm" class="icon-btn" style="min-height:34px;font-size:0.74rem;">🎬 تصدير WebM</button>
          <button type="button" id="btnGhostCopyLink" class="icon-btn" style="min-height:34px;font-size:0.74rem;">🔗 نسخ الرابط</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const svg = modal.querySelector('#ghostViewerSvg') as SVGSVGElement;
  const xrayCanvas = modal.querySelector('#ghostViewerXray') as HTMLCanvasElement;
  const xrayHud = modal.querySelector('#ghostXrayHud') as HTMLElement;
  const interceptBanner = modal.querySelector('#ghostInterceptBanner') as HTMLElement;
  const stepInfo = modal.querySelector('#ghostStepInfo') as HTMLElement;
  const btnPlay = modal.querySelector('#btnGhostPlayToggle') as HTMLButtonElement;
  const btnXray = modal.querySelector('#btnGhostToggleXray') as HTMLButtonElement;
  const btnChallenge = modal.querySelector('#btnGhostChallenge') as HTMLButtonElement;

  const renderState = () => {
    const sample = sampleTimeline(metrics, elapsedMs);
    currentFrameIdx = sample.frameIdx;
    const prevIdx = Math.max(0, sample.frameIdx - 1);
    const fFrom = seq.frames[prevIdx] || seq.frames[0];
    const fTo = seq.frames[sample.frameIdx] || fFrom;
    const our = interpolatePoints(fFrom.ourPos, fTo.ourPos, sample.moveT);
    const opp = challengeMode
      ? challengeOpp
      : interpolatePoints(fFrom.oppPos, fTo.oppPos, sample.moveT);
    const ballArc = evalBallArc(fFrom.ball, fTo.ball, sample.moveT);
    const ball = { x: ballArc.x, y: ballArc.y };

    // Time-to-Intercept evaluation for active transition
    const fromG = play.frames[sample.frameIdx] || play.frames[0];
    const toG = play.frames[Math.min(play.frames.length - 1, sample.frameIdx + 1)] || fromG;
    const intercept = analyzeGhostPassIntercept(
      fromG,
      toG,
      play.size,
      challengeMode ? challengeOpp : undefined
    );

    // Render SVG pitch
    const parts: string[] = [];
    parts.push(`<defs>
      <linearGradient id="gTurf" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#073114"/>
        <stop offset="50%" stop-color="#0f5a23"/>
        <stop offset="100%" stop-color="#05240e"/>
      </linearGradient>
    </defs>
    <rect x="0" y="0" width="${W}" height="${H}" rx="14" fill="url(#gTurf)"/>
    <rect x="18" y="20" width="${W - 36}" height="${H - 40}" fill="none" stroke="rgba(255,255,255,0.75)" stroke-width="1.8"/>
    <line x1="18" y1="${H / 2}" x2="${W - 18}" y2="${H / 2}" stroke="rgba(255,255,255,0.65)" stroke-width="1.5"/>
    <circle cx="${W / 2}" cy="${H / 2}" r="34" fill="none" stroke="rgba(255,255,255,0.65)" stroke-width="1.5"/>
    <rect x="${W / 2 - 48}" y="20" width="96" height="40" fill="none" stroke="rgba(255,255,255,0.65)" stroke-width="1.5"/>
    <rect x="${W / 2 - 48}" y="${H - 60}" width="96" height="40" fill="none" stroke="rgba(255,255,255,0.65)" stroke-width="1.5"/>`);

    // Draw planned pass trajectory arrow
    if (intercept.isPass) {
      const col =
        intercept.verdict === 'intercepted'
          ? '#fb7185'
          : intercept.verdict === 'risky'
            ? '#fbbf24'
            : '#facc15';
      parts.push(
        `<line x1="${toSvgX(fromG.ball.x).toFixed(1)}" y1="${toSvgY(fromG.ball.y).toFixed(1)}" x2="${toSvgX(toG.ball.x).toFixed(1)}" y2="${toSvgY(toG.ball.y).toFixed(1)}" stroke="${col}" stroke-width="2.6" stroke-dasharray="6 4" />`
      );
      if (intercept.interceptPoint && intercept.verdict !== 'safe') {
        const ix = toSvgX(intercept.interceptPoint.x);
        const iy = toSvgY(intercept.interceptPoint.y);
        parts.push(
          `<circle cx="${ix.toFixed(1)}" cy="${iy.toFixed(1)}" r="8" fill="rgba(244,63,94,0.28)" stroke="#fb7185" stroke-width="1.8"/>`
        );
      }
    }

    // Opponents (draggable in Challenge Mode!)
    opp.forEach((p, i) => {
      const cx = toSvgX(p.x);
      const cy = toSvgY(p.y);
      const ring = challengeMode ? '#fb7185' : '#94a3b8';
      parts.push(`<g data-ghost-opp="${i}" style="cursor:${challengeMode ? 'grab' : 'default'};">
        <circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${challengeMode ? 15 : 13}" fill="#1e293b" stroke="${ring}" stroke-width="${challengeMode ? 2.4 : 1.8}"/>
        <text x="${cx.toFixed(1)}" y="${(cy + 3.5).toFixed(1)}" text-anchor="middle" fill="#f1f5f9" font-size="10" font-weight="800">${i + 1}</text>
      </g>`);
    });

    // Our players
    our.forEach((p, i) => {
      const cx = toSvgX(p.x);
      const cy = toSvgY(p.y);
      parts.push(`<g>
        <circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="14" fill="#0b1220" stroke="#facc15" stroke-width="2.2"/>
        <text x="${cx.toFixed(1)}" y="${(cy + 3.5).toFixed(1)}" text-anchor="middle" fill="#fef08a" font-size="10" font-weight="800">${i + 1}</text>
      </g>`);
    });

    // Ball
    parts.push(`<circle cx="${toSvgX(ball.x).toFixed(1)}" cy="${toSvgY(ball.y).toFixed(1)}" r="6.5" fill="#fff" stroke="#111827" stroke-width="1.6"/>`);
    svg.innerHTML = parts.join('');

    // X-Ray overlay sync
    if (xrayOn) {
      xrayCanvas.classList.remove('hidden');
      xrayHud.classList.remove('hidden');
      const snap = computeDominanceXRay({ size: play.size, our, opp, ball });
      renderXRayCanvas(xrayCanvas, snap, 'portrait');
      xrayHud.innerHTML = buildXRayHudHtml(snap);
    } else {
      xrayCanvas.classList.add('hidden');
      xrayHud.classList.add('hidden');
      clearXRayCanvas(xrayCanvas);
    }

    // Time-to-Intercept banner
    const verdictColor =
      intercept.verdict === 'intercepted'
        ? '#fb7185'
        : intercept.verdict === 'risky'
          ? '#fbbf24'
          : '#4ade80';
    interceptBanner.innerHTML = `
      <div style="font-weight:800;color:${verdictColor};margin-bottom:3px;">${
        challengeMode ? '🛡️ وضع تحدّي إيقاف الخطة (اسحب أي مدافع أحمر لقطع التمريرة):' : '⏱️ تحليل زمن الاعتراض (Time-to-Intercept):'
      }</div>
      <div style="color:#f4f4f5;line-height:1.45;">${escapeHtml(intercept.summaryAr)}</div>
      <div class="muted" style="font-size:0.68rem;margin-top:3px;">${escapeHtml(intercept.disclaimerAr)}</div>
    `;

    stepInfo.textContent = `اللقطة ${currentFrameIdx + 1} / ${play.frames.length}${fromG.note ? ` • ${fromG.note}` : ''}`;
  };

  const stopLoop = () => {
    isPlaying = false;
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    btnPlay.textContent = '▶ تشغيل';
  };

  const startLoop = () => {
    if (isPlaying) return;
    isPlaying = true;
    btnPlay.textContent = '⏸ إيقاف';
    lastTs = performance.now();
    const tick = (now: number) => {
      if (!isPlaying) return;
      const dt = Math.min(80, now - lastTs);
      lastTs = now;
      elapsedMs = (elapsedMs + dt) % Math.max(1000, metrics.totalMs);
      renderState();
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
  };

  // Drag opponent defenders in Challenge Mode
  svg.addEventListener('pointerdown', (e) => {
    if (!challengeMode) return;
    const grp = (e.target as HTMLElement).closest<SVGGElement>('[data-ghost-opp]');
    if (!grp) return;
    draggingOppIdx = Number(grp.dataset.ghostOpp);
    svg.setPointerCapture?.(e.pointerId);
  });

  svg.addEventListener('pointermove', (e) => {
    if (!challengeMode || draggingOppIdx === null) return;
    const rect = svg.getBoundingClientRect();
    const pt = projectClientToPitchPct(e.clientX, e.clientY, rect, W, H);
    challengeOpp[draggingOppIdx] = { x: pt.x, y: pt.y };
    renderState();
  });

  const endDrag = () => {
    draggingOppIdx = null;
  };
  svg.addEventListener('pointerup', endDrag);
  svg.addEventListener('pointercancel', endDrag);

  btnPlay.addEventListener('click', () => {
    if (isPlaying) stopLoop();
    else startLoop();
  });

  btnXray.addEventListener('click', () => {
    xrayOn = !xrayOn;
    btnXray.classList.toggle('active', xrayOn);
    renderState();
  });

  btnChallenge.addEventListener('click', () => {
    challengeMode = !challengeMode;
    btnChallenge.classList.toggle('active', challengeMode);
    if (challengeMode) {
      stopLoop();
      challengeOpp = play.frames[currentFrameIdx].opp.map((p) => ({ ...p }));
      opts?.toast?.('اسحب أي مدافع من الخصم لقطع مسار التمريرة وراقب زمن الاعتراض فوراً!');
    }
    renderState();
  });

  modal.querySelector('#btnGhostExportWebm')?.addEventListener('click', async () => {
    const res = await exportGhostPlayLocalMedia(play, { withXRay: xrayOn });
    opts?.toast?.(res.messageAr);
  });

  modal.querySelector('#btnGhostCopyLink')?.addEventListener('click', () => {
    const link = buildShareableGhostLink(play);
    if (link.ok && link.url && navigator.clipboard) {
      navigator.clipboard
        .writeText(link.url)
        .then(() => opts?.toast?.('تم نسخ رابط الشبح — يفتح ويشغّل الخطة مباشرة بدون تسجيل دخول ✓'))
        .catch(() => opts?.toast?.('تعذّر النسخ التلقائي — انسخ الرابط من شريط العنوان'));
    } else if (navigator.clipboard && link.fallbackJson) {
      navigator.clipboard
        .writeText(link.fallbackJson)
        .then(() => opts?.toast?.('الخطة كبيرة للرابط المختصر — تم نسخ بيانات JSON المحلية كبديل ✓'))
        .catch(() => opts?.toast?.(link.reasonAr || 'تعذّر النسخ'));
    }
  });

  const closeModal = () => {
    stopLoop();
    modal.remove();
    opts?.onClose?.();
  };

  modal.querySelector('#btnCloseGhostViewer')?.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  renderState();
  startLoop();
}

/**
 * Checks current URL hash (`#ghost=v1...`) safely at app boot WITHOUT touching `#join=` or `?join=`/`?ref=`.
 * If valid, opens the standalone Guest Ghost Play Viewer immediately with zero Firestore reads!
 */
export function tryBootGhostViewerFromLocation(toast?: (msg: string, isErr?: boolean) => void): boolean {
  if (typeof window === 'undefined' || !window.location) return false;
  const hash = window.location.hash || '';
  if (!hash.startsWith('#ghost=')) return false;
  const decoded = decodeGhostPlayFromHash(hash);
  if (!decoded.ok || !decoded.play) {
    toast?.(decoded.errorAr || 'رابط الشبح غير صالح.', true);
    return false;
  }
  openGhostGuestViewer(decoded.play, { toast });
  return true;
}

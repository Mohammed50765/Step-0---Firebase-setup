export interface CardExportPayload {
  playerName: string;
  teamName: string;
  appName: string;
  teamLogo?: string;
  photo?: string;
  photoZoom?: number;
  photoY?: number;
  ovr: number;
  posShort: string;
  jersey: string | number;
  tierKey: 'bronze' | 'silver' | 'gold' | 'totw' | 'icon';
  tierLabel: string;
  levelText: string;
  sixStats: Array<{ lbl: string; val: number }>;
  playStyles: Array<{ icon: string; name: string; plus: boolean }>;
  dnaTitle: string;
  twinText: string;
  goals: number;
  assists: number;
  commitment: string;
}

interface TierPalette {
  borderA: string;
  borderB: string;
  borderC: string;
  bgTop: string;
  bgMid: string;
  bgBot: string;
  glow: string;
  accent: string;
  subText: string;
}

const TIER_PALETTES: Record<CardExportPayload['tierKey'], TierPalette> = {
  bronze: {
    borderA: '#E7B587',
    borderB: '#B47846',
    borderC: '#5C3A1E',
    bgTop: '#261911',
    bgMid: '#0e0c0b',
    bgBot: '#1f140d',
    glow: 'rgba(217, 155, 102, 0.30)',
    accent: '#E7B587',
    subText: '#fed7aa',
  },
  silver: {
    borderA: '#F8FAFC',
    borderB: '#CBD5E1',
    borderC: '#475569',
    bgTop: '#1e242d',
    bgMid: '#0c0e12',
    bgBot: '#191e26',
    glow: 'rgba(226, 232, 240, 0.28)',
    accent: '#E2E8F0',
    subText: '#f1f5f9',
  },
  gold: {
    borderA: '#FEF08A',
    borderB: '#FACC15',
    borderC: '#854D0E',
    bgTop: '#241f0e',
    bgMid: '#0d0e13',
    bgBot: '#1e190b',
    glow: 'rgba(250, 204, 21, 0.34)',
    accent: '#FACC15',
    subText: '#fef08a',
  },
  totw: {
    borderA: '#FEF08A',
    borderB: '#FACC15',
    borderC: '#18181b',
    bgTop: '#181509',
    bgMid: '#09090b',
    bgBot: '#1c1808',
    glow: 'rgba(250, 204, 21, 0.42)',
    accent: '#FACC15',
    subText: '#fef08a',
  },
  icon: {
    borderA: '#FFFFFF',
    borderB: '#FEF08A',
    borderC: '#D97706',
    bgTop: '#2e2918',
    bgMid: '#12110d',
    bgBot: '#2b2412',
    glow: 'rgba(254, 249, 195, 0.42)',
    accent: '#FEF08A',
    subText: '#fffbeb',
  },
};

function loadImageSafe(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    if (!src || !src.startsWith('data:image/')) {
      resolve(null);
      return;
    }
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function drawRoundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  rTop: number,
  rBottom: number
): void {
  ctx.beginPath();
  ctx.moveTo(x + rTop, y);
  ctx.lineTo(x + w - rTop, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rTop);
  ctx.lineTo(x + w, y + h - rBottom);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rBottom, y + h);
  ctx.lineTo(x + rBottom, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rBottom);
  ctx.lineTo(x, y + rTop);
  ctx.quadraticCurveTo(x, y, x + rTop, y);
  ctx.closePath();
}

export async function renderFifaCardToCanvas(
  payload: CardExportPayload
): Promise<{ dataUrl: string; blob: Blob | null }> {
  // 2x Retina Resolution (logical 380x580 -> physical 760x1160)
  const W = 760;
  const H = 1160;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas context unavailable');

  const pal = TIER_PALETTES[payload.tierKey] || TIER_PALETTES.gold;
  const fontStack = 'system-ui, -apple-system, "Segoe UI", Tahoma, Arial, sans-serif';

  // 1. Royal Obsidian Canvas Backdrop
  const backGrad = ctx.createLinearGradient(0, 0, W, H);
  backGrad.addColorStop(0, '#070709');
  backGrad.addColorStop(0.5, '#0e1017');
  backGrad.addColorStop(1, '#070709');
  ctx.fillStyle = backGrad;
  ctx.fillRect(0, 0, W, H);

  // Subtle intersecting royal gold beams on backdrop
  ctx.save();
  ctx.strokeStyle = 'rgba(250, 204, 21, 0.14)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-40, 210);
  ctx.lineTo(W + 40, 520);
  ctx.moveTo(W + 40, 140);
  ctx.lineTo(-40, 480);
  ctx.moveTo(120, -20);
  ctx.lineTo(540, H + 20);
  ctx.stroke();
  ctx.restore();

  // 2. Top Header: Team Emblem & Name
  const teamLogoImg = payload.teamLogo ? await loadImageSafe(payload.teamLogo) : null;
  ctx.save();
  ctx.direction = 'rtl';
  ctx.textAlign = 'center';
  ctx.fillStyle = pal.accent;
  ctx.font = `900 28px ${fontStack}`;
  ctx.fillText(payload.teamName || 'فريق السداسي', W / 2, 62);
  ctx.fillStyle = '#a1a1aa';
  ctx.font = `700 18px ${fontStack}`;
  ctx.fillText(`${payload.appName || 'ميدان 6v6'} • البطاقة الملكية الرسمية`, W / 2, 92);
  ctx.restore();

  if (teamLogoImg) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(W - 76, 62, 28, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(teamLogoImg, W - 104, 34, 56, 56);
    ctx.restore();
    ctx.strokeStyle = pal.accent;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(W - 76, 62, 28, 0, Math.PI * 2);
    ctx.stroke();
  }

  // 3. Outer Metallic Shield Frame
  const sx = 54;
  const sy = 122;
  const sw = W - 108;
  const sh = 950;

  ctx.save();
  ctx.shadowColor = pal.glow;
  ctx.shadowBlur = 46;
  ctx.shadowOffsetY = 14;
  drawRoundedRectPath(ctx, sx, sy, sw, sh, 54, 104);
  const frameGrad = ctx.createLinearGradient(sx, sy, sx + sw, sy + sh);
  frameGrad.addColorStop(0, pal.borderA);
  frameGrad.addColorStop(0.38, pal.borderB);
  frameGrad.addColorStop(0.72, pal.borderC);
  frameGrad.addColorStop(1, pal.borderA);
  ctx.fillStyle = frameGrad;
  ctx.fill();
  ctx.restore();

  // Inner Shield Surface
  const ix = sx + 7;
  const iy = sy + 7;
  const iw = sw - 14;
  const ih = sh - 14;

  ctx.save();
  drawRoundedRectPath(ctx, ix, iy, iw, ih, 48, 98);
  ctx.clip();

  const innerGrad = ctx.createLinearGradient(ix, iy, ix + iw, iy + ih);
  innerGrad.addColorStop(0, pal.bgTop);
  innerGrad.addColorStop(0.5, pal.bgMid);
  innerGrad.addColorStop(1, pal.bgBot);
  ctx.fillStyle = innerGrad;
  ctx.fillRect(ix, iy, iw, ih);

  // Radial crystal glow behind player portrait
  const radGlow = ctx.createRadialGradient(ix + iw * 0.36, iy + 220, 20, ix + iw * 0.36, iy + 220, 320);
  radGlow.addColorStop(0, pal.glow);
  radGlow.addColorStop(1, 'transparent');
  ctx.fillStyle = radGlow;
  ctx.fillRect(ix, iy, iw, ih);

  // Geometric Crystal Facets
  const drawFacet = (pts: Array<[number, number]>, alpha: number, light = true) => {
    ctx.beginPath();
    pts.forEach(([px, py], idx) => (idx === 0 ? ctx.moveTo(ix + px, iy + py) : ctx.lineTo(ix + px, iy + py)));
    ctx.closePath();
    ctx.fillStyle = light ? `rgba(254, 240, 138, ${alpha})` : `rgba(255, 255, 255, ${alpha})`;
    ctx.fill();
  };
  drawFacet([[0, 0], [280, 0], [150, 220]], 0.11, true);
  drawFacet([[280, 0], [580, 0], [420, 190], [150, 220]], 0.06, false);
  drawFacet([[420, 190], [iw, 280], [540, 500], [330, 410]], 0.08, true);
  drawFacet([[70, 620], [320, 520], [570, 630], [320, 860]], 0.05, false);

  // Diagonal crystal lines
  ctx.strokeStyle = 'rgba(250, 204, 21, 0.20)';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(ix, iy + 220);
  ctx.lineTo(ix + iw, iy + 470);
  ctx.moveTo(ix + iw, iy + 120);
  ctx.lineTo(ix, iy + 440);
  ctx.stroke();

  // 4. Seamless Player Portrait (Left Side of Shield Hero, matching RTL card)
  const photoImg = payload.photo ? await loadImageSafe(payload.photo) : null;
  const pBoxX = ix + 34;
  const pBoxY = iy + 24;
  const pBoxW = 360;
  const pBoxH = 340;

  if (photoImg) {
    // Draw portrait onto an offscreen canvas so we can apply a clean radial/bottom dissolve mask
    const off = document.createElement('canvas');
    off.width = pBoxW;
    off.height = pBoxH;
    const octx = off.getContext('2d')!;
    const zoom = Math.max(0.9, Math.min(1.6, Number(payload.photoZoom || 105) / 100));
    const yPct = Math.max(0, Math.min(60, Number(payload.photoY ?? 18))) / 100;

    // Cover-fit calculation
    const imgRatio = photoImg.width / Math.max(1, photoImg.height);
    const boxRatio = pBoxW / pBoxH;
    let dw = pBoxW;
    let dh = pBoxH;
    if (imgRatio > boxRatio) {
      dh = pBoxH * zoom;
      dw = dh * imgRatio;
    } else {
      dw = pBoxW * zoom;
      dh = dw / imgRatio;
    }
    const dx = (pBoxW - dw) / 2;
    const dy = (pBoxH - dh) * yPct;

    octx.drawImage(photoImg, dx, dy, dw, dh);

    // Soft elliptical + bottom dissolve alpha mask
    octx.globalCompositeOperation = 'destination-in';
    const maskGrad = octx.createRadialGradient(pBoxW * 0.5, pBoxH * 0.42, pBoxW * 0.14, pBoxW * 0.5, pBoxH * 0.46, pBoxW * 0.5);
    maskGrad.addColorStop(0, 'rgba(0,0,0,1)');
    maskGrad.addColorStop(0.68, 'rgba(0,0,0,0.92)');
    maskGrad.addColorStop(1, 'rgba(0,0,0,0)');
    octx.fillStyle = maskGrad;
    octx.fillRect(0, 0, pBoxW, pBoxH);

    // Extra bottom smooth fade
    const botFade = octx.createLinearGradient(0, pBoxH * 0.65, 0, pBoxH);
    botFade.addColorStop(0, 'rgba(0,0,0,1)');
    botFade.addColorStop(1, 'rgba(0,0,0,0)');
    octx.fillStyle = botFade;
    octx.fillRect(0, pBoxH * 0.65, pBoxW, pBoxH * 0.35);

    ctx.drawImage(off, pBoxX, pBoxY);
  } else {
    // Royal Golden Silhouette
    ctx.save();
    const silGrad = ctx.createLinearGradient(pBoxX, pBoxY + 30, pBoxX, pBoxY + pBoxH);
    silGrad.addColorStop(0, 'rgba(250, 204, 21, 0.50)');
    silGrad.addColorStop(1, 'rgba(250, 204, 21, 0.04)');
    ctx.fillStyle = silGrad;
    ctx.beginPath();
    ctx.arc(pBoxX + pBoxW * 0.5, pBoxY + 115, 58, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(pBoxX + 75, pBoxY + 315);
    ctx.bezierCurveTo(pBoxX + 82, pBoxY + 215, pBoxX + 135, pBoxY + 190, pBoxX + pBoxW * 0.5, pBoxY + 190);
    ctx.bezierCurveTo(pBoxX + 225, pBoxY + 190, pBoxX + 278, pBoxY + 215, pBoxX + 285, pBoxY + 315);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // 5. Right Meta Pill (OVR, Pos, Jersey, Tier)
  const metaW = 196;
  const metaH = 264;
  const metaX = ix + iw - metaW - 34;
  const metaY = iy + 32;

  ctx.save();
  drawRoundedRectPath(ctx, metaX, metaY, metaW, metaH, 26, 26);
  ctx.fillStyle = 'rgba(7, 7, 9, 0.58)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(250, 204, 21, 0.32)';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.direction = 'rtl';
  ctx.textAlign = 'center';
  ctx.fillStyle = pal.accent;
  ctx.font = `900 94px ${fontStack}`;
  ctx.fillText(String(payload.ovr), metaX + metaW / 2, metaY + 98);

  ctx.fillStyle = '#fef9c3';
  ctx.font = `900 30px ${fontStack}`;
  ctx.fillText(payload.posShort || 'MID', metaX + metaW / 2, metaY + 140);

  // Jersey Pill
  drawRoundedRectPath(ctx, metaX + 44, metaY + 158, metaW - 88, 42, 21, 21);
  ctx.fillStyle = 'rgba(250, 204, 21, 0.18)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(250, 204, 21, 0.45)';
  ctx.lineWidth = 1.6;
  ctx.stroke();
  ctx.fillStyle = pal.accent;
  ctx.font = `900 24px ${fontStack}`;
  ctx.fillText(`#${payload.jersey}`, metaX + metaW / 2, metaY + 188);

  ctx.fillStyle = pal.subText;
  ctx.font = `800 18px ${fontStack}`;
  ctx.fillText(payload.tierLabel, metaX + metaW / 2, metaY + 236);
  ctx.restore();

  // 6. Player Nameplate + Level + DNA + Global Twin Ribbon
  const npX = ix + 34;
  const npY = iy + 342;
  const npW = iw - 68;
  const npH = 148;

  ctx.save();
  drawRoundedRectPath(ctx, npX, npY, npW, npH, 24, 24);
  ctx.fillStyle = 'rgba(9, 10, 14, 0.78)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(250, 204, 21, 0.28)';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.direction = 'rtl';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff';
  ctx.font = `900 42px ${fontStack}`;
  ctx.fillText(payload.playerName || 'اللاعب', npX + npW / 2, npY + 54);

  ctx.fillStyle = pal.accent;
  ctx.font = `800 21px ${fontStack}`;
  ctx.fillText(`${payload.dnaTitle}  •  ${payload.levelText}`, npX + npW / 2, npY + 94);

  if (payload.twinText) {
    ctx.fillStyle = '#e4e4e7';
    ctx.font = `700 19px ${fontStack}`;
    ctx.fillText(payload.twinText, npX + npW / 2, npY + 128);
  }
  ctx.restore();

  // 7. Classic 6 FIFA Stats Grid (2 cols × 3 rows)
  const stX = ix + 34;
  const stY = npY + npH + 22;
  const stW = iw - 68;
  const stH = 186;

  ctx.save();
  drawRoundedRectPath(ctx, stX, stY, stW, stH, 24, 24);
  ctx.fillStyle = 'rgba(8, 9, 13, 0.72)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(250, 204, 21, 0.22)';
  ctx.lineWidth = 1.8;
  ctx.stroke();

  // Vertical center divider
  ctx.strokeStyle = 'rgba(250, 204, 21, 0.16)';
  ctx.beginPath();
  ctx.moveTo(stX + stW / 2, stY + 20);
  ctx.lineTo(stX + stW / 2, stY + stH - 20);
  ctx.stroke();

  ctx.direction = 'rtl';
  const stats = payload.sixStats.slice(0, 6);
  for (let i = 0; i < stats.length; i++) {
    const col = i % 2; // 0 = right column in RTL, 1 = left column
    const row = Math.floor(i / 2);
    const cellX = col === 0 ? stX + stW / 2 + 24 : stX + 24;
    const cellW = stW / 2 - 48;
    const cy = stY + 48 + row * 54;

    ctx.textAlign = 'right';
    ctx.fillStyle = pal.accent;
    ctx.font = `900 32px ${fontStack}`;
    ctx.fillText(String(stats[i].val), cellX + cellW, cy);

    ctx.textAlign = 'left';
    ctx.fillStyle = '#e4e4e7';
    ctx.font = `800 22px ${fontStack}`;
    ctx.fillText(stats[i].lbl, cellX, cy - 2);
  }
  ctx.restore();

  // 8. PlayStyle+ Badges Row
  const psY = stY + stH + 28;
  const badges = payload.playStyles.slice(0, 3);
  if (badges.length > 0) {
    ctx.save();
    ctx.direction = 'rtl';
    ctx.font = `800 20px ${fontStack}`;
    const gap = 14;
    const pillWidths = badges.map((b) => Math.max(150, ctx.measureText(`${b.icon} ${b.name}`).width + 34));
    const totalW = pillWidths.reduce((a, b) => a + b, 0) + gap * (badges.length - 1);
    let cursorX = ix + (iw - Math.min(iw - 48, totalW)) / 2;

    badges.forEach((b, idx) => {
      const pw = Math.min(200, pillWidths[idx]);
      drawRoundedRectPath(ctx, cursorX, psY, pw, 44, 22, 22);
      ctx.fillStyle = b.plus ? 'rgba(250, 204, 21, 0.22)' : 'rgba(255, 255, 255, 0.08)';
      ctx.fill();
      ctx.strokeStyle = b.plus ? 'rgba(250, 204, 21, 0.65)' : 'rgba(255, 255, 255, 0.2)';
      ctx.lineWidth = 1.6;
      ctx.stroke();

      ctx.textAlign = 'center';
      ctx.fillStyle = b.plus ? '#fef08a' : '#f4f4f5';
      ctx.font = `800 18px ${fontStack}`;
      ctx.fillText(`${b.icon} ${b.name}`, cursorX + pw / 2, psY + 29);
      cursorX += pw + gap;
    });
    ctx.restore();
  }

  // 9. Bottom Stats Row (Goals / Assists / Commitment)
  const footY = psY + 76;
  ctx.save();
  ctx.strokeStyle = 'rgba(250, 204, 21, 0.24)';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(ix + 44, footY);
  ctx.lineTo(ix + iw - 44, footY);
  ctx.stroke();

  ctx.direction = 'rtl';
  ctx.textAlign = 'center';
  const cols = [
    { lbl: 'أهداف', val: String(payload.goals), color: '#ffffff' },
    { lbl: 'تمريرات', val: String(payload.assists), color: '#ffffff' },
    { lbl: 'الالتزام', val: payload.commitment || '100%', color: pal.accent },
  ];
  const colW = (iw - 88) / 3;
  cols.forEach((c, idx) => {
    const cx = ix + iw - 44 - colW * idx - colW / 2;
    ctx.fillStyle = '#a1a1aa';
    ctx.font = `700 20px ${fontStack}`;
    ctx.fillText(c.lbl, cx, footY + 34);
    ctx.fillStyle = c.color;
    ctx.font = `900 34px ${fontStack}`;
    ctx.fillText(c.val, cx, footY + 76);
  });
  ctx.restore();

  ctx.restore(); // end shield clip

  // 10. Royal Watermark Footer
  ctx.save();
  ctx.direction = 'rtl';
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(250, 204, 21, 0.72)';
  ctx.font = `800 19px ${fontStack}`;
  ctx.fillText(`👑 ${payload.appName || 'ميدان 6v6'} — النسخة الملكية • درع ميدان عالي الدقة`, W / 2, H - 34);
  ctx.restore();

  const dataUrl = canvas.toDataURL('image/png');
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
  return { dataUrl, blob };
}

export async function downloadOrSharePng(
  dataUrl: string,
  blob: Blob | null,
  fileName: string,
  shareTitle: string,
  preferShare = false
): Promise<'shared' | 'downloaded'> {
  const safeFile = fileName.endsWith('.png') ? fileName : `${fileName}.png`;

  if (preferShare && blob && typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      const file = new File([blob], safeFile, { type: 'image/png' });
      const navAny = navigator as Navigator & { canShare?: (data?: ShareData) => boolean };
      if (!navAny.canShare || navAny.canShare({ files: [file] })) {
        await navigator.share({
          title: shareTitle,
          text: `${shareTitle} — ميدان 6v6 👑⚽`,
          files: [file],
        });
        return 'shared';
      }
    } catch {
      // User canceled or unsupported share target; fall back cleanly to download
    }
  }

  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = safeFile;
  document.body.appendChild(a);
  a.click();
  a.remove();
  return 'downloaded';
}

export function launchGoldConfetti(): void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  if (document.body.classList.contains('data-saver')) return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const existing = document.getElementById('maydanConfettiCanvas');
  if (existing) existing.remove();

  const canvas = document.createElement('canvas');
  canvas.id = 'maydanConfettiCanvas';
  canvas.style.cssText =
    'position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:9999;';
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  document.body.appendChild(canvas);

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    canvas.remove();
    return;
  }

  const colors = ['#FACC15', '#FEF08A', '#EAB308', '#FFFFFF', '#F59E0B'];
  const particles = Array.from({ length: 58 }, () => ({
    x: Math.random() * canvas.width,
    y: -20 - Math.random() * 140,
    w: 6 + Math.random() * 6,
    h: 9 + Math.random() * 7,
    vx: (Math.random() - 0.5) * 4.2,
    vy: 3.2 + Math.random() * 4.5,
    rot: Math.random() * Math.PI * 2,
    vrot: (Math.random() - 0.5) * 0.22,
    color: colors[Math.floor(Math.random() * colors.length)],
  }));

  const start = performance.now();
  const duration = 2100;

  function frame(now: number) {
    if (!ctx || document.body.classList.contains('data-saver')) {
      canvas.remove();
      return;
    }
    const elapsed = now - start;
    if (elapsed >= duration) {
      canvas.remove();
      return;
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const fade = elapsed > 1500 ? Math.max(0, 1 - (elapsed - 1500) / 600) : 1;
    ctx.globalAlpha = fade;

    for (const p of particles) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.08;
      p.rot += p.vrot;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

declare global {
  interface Window {
    MaydanCardExporter?: {
      renderFifaCardToCanvas: typeof renderFifaCardToCanvas;
      downloadOrSharePng: typeof downloadOrSharePng;
      launchGoldConfetti: typeof launchGoldConfetti;
    };
  }
}

if (typeof window !== 'undefined') {
  window.MaydanCardExporter = {
    renderFifaCardToCanvas,
    downloadOrSharePng,
    launchGoldConfetti,
  };
}

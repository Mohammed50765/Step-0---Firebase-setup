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
  borderD: string;
  innerStroke: string;
  bgTop: string;
  bgMid: string;
  bgBot: string;
  glow: string;
  halo: string;
  accent: string;
  subText: string;
  ovrTop: string;
  ovrMid: string;
  ovrBot: string;
  vein: string;
  facetGold: string;
}

const TIER_PALETTES: Record<CardExportPayload['tierKey'], TierPalette> = {
  bronze: {
    borderA: '#F7D4B4',
    borderB: '#C27D4B',
    borderC: '#5A3217',
    borderD: '#E2A979',
    innerStroke: 'rgba(217, 155, 102, 0.56)',
    bgTop: '#21150d',
    bgMid: '#090808',
    bgBot: '#1a110b',
    glow: 'rgba(194, 125, 75, 0.30)',
    halo: 'rgba(217, 155, 102, 0.34)',
    accent: '#E2A979',
    subText: '#FED7AA',
    ovrTop: '#FFF3E6',
    ovrMid: '#E7B587',
    ovrBot: '#7C431C',
    vein: 'rgba(217, 155, 102, 0.24)',
    facetGold: 'rgba(231, 181, 135, 0.13)',
  },
  silver: {
    borderA: '#FFFFFF',
    borderB: '#CBD5E1',
    borderC: '#475569',
    borderD: '#E2E8F0',
    innerStroke: 'rgba(226, 232, 240, 0.54)',
    bgTop: '#18202b',
    bgMid: '#080a0e',
    bgBot: '#131820',
    glow: 'rgba(203, 213, 225, 0.30)',
    halo: 'rgba(226, 232, 240, 0.32)',
    accent: '#E2E8F0',
    subText: '#F8FAFC',
    ovrTop: '#FFFFFF',
    ovrMid: '#E2E8F0',
    ovrBot: '#64748B',
    vein: 'rgba(226, 232, 240, 0.22)',
    facetGold: 'rgba(241, 245, 249, 0.12)',
  },
  gold: {
    borderA: '#FFFBEB',
    borderB: '#FACC15',
    borderC: '#92400E',
    borderD: '#FEF08A',
    innerStroke: 'rgba(250, 204, 21, 0.62)',
    bgTop: '#1d180a',
    bgMid: '#070709',
    bgBot: '#161309',
    glow: 'rgba(250, 204, 21, 0.36)',
    halo: 'rgba(250, 204, 21, 0.38)',
    accent: '#FACC15',
    subText: '#FEF08A',
    ovrTop: '#FFFBEB',
    ovrMid: '#FACC15',
    ovrBot: '#B45309',
    vein: 'rgba(250, 204, 21, 0.26)',
    facetGold: 'rgba(254, 240, 138, 0.14)',
  },
  totw: {
    borderA: '#FFFBEB',
    borderB: '#FACC15',
    borderC: '#141419',
    borderD: '#FDE047',
    innerStroke: 'rgba(250, 204, 21, 0.74)',
    bgTop: '#121007',
    bgMid: '#050507',
    bgBot: '#120f06',
    glow: 'rgba(250, 204, 21, 0.44)',
    halo: 'rgba(250, 204, 21, 0.46)',
    accent: '#FDE047',
    subText: '#FEF08A',
    ovrTop: '#FFFFFF',
    ovrMid: '#FACC15',
    ovrBot: '#CA8A04',
    vein: 'rgba(250, 204, 21, 0.38)',
    facetGold: 'rgba(250, 204, 21, 0.16)',
  },
  icon: {
    borderA: '#FFFFFF',
    borderB: '#FEF9C3',
    borderC: '#B8860B',
    borderD: '#FFFFFF',
    innerStroke: 'rgba(254, 249, 195, 0.76)',
    bgTop: '#262114',
    bgMid: '#0b0a08',
    bgBot: '#211c10',
    glow: 'rgba(254, 249, 195, 0.46)',
    halo: 'rgba(254, 249, 195, 0.48)',
    accent: '#FEF9C3',
    subText: '#FFFBEB',
    ovrTop: '#FFFFFF',
    ovrMid: '#FDE68A',
    ovrBot: '#B45309',
    vein: 'rgba(254, 249, 195, 0.34)',
    facetGold: 'rgba(255, 251, 235, 0.18)',
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

function drawSculptedShieldPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number
): void {
  const pts: Array<[number, number]> = [
    [0.50, 0.006],
    [0.72, 0.032],
    [0.90, 0.024],
    [0.986, 0.084],
    [0.986, 0.735],
    [0.94, 0.832],
    [0.75, 0.928],
    [0.50, 0.994],
    [0.25, 0.928],
    [0.06, 0.832],
    [0.014, 0.735],
    [0.014, 0.084],
    [0.10, 0.024],
    [0.28, 0.032],
  ];
  ctx.beginPath();
  pts.forEach(([px, py], i) => {
    const cx = x + px * w;
    const cy = y + py * h;
    if (i === 0) ctx.moveTo(cx, cy);
    else ctx.lineTo(cx, cy);
  });
  ctx.closePath();
}

function drawDiamondDivider(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  accent: string,
  lineColor: string
): void {
  const cx = x + w / 2;
  ctx.save();
  const leftGrad = ctx.createLinearGradient(x, y, cx - 18, y);
  leftGrad.addColorStop(0, 'rgba(250, 204, 21, 0)');
  leftGrad.addColorStop(1, lineColor);
  ctx.strokeStyle = leftGrad;
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(cx - 16, y);
  ctx.stroke();

  const rightGrad = ctx.createLinearGradient(cx + 18, y, x + w, y);
  rightGrad.addColorStop(0, lineColor);
  rightGrad.addColorStop(1, 'rgba(250, 204, 21, 0)');
  ctx.strokeStyle = rightGrad;
  ctx.beginPath();
  ctx.moveTo(cx + 16, y);
  ctx.lineTo(x + w, y);
  ctx.stroke();

  // Center crystal diamond (◆)
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.moveTo(cx, y - 6.5);
  ctx.lineTo(cx + 6.5, y);
  ctx.lineTo(cx, y + 6.5);
  ctx.lineTo(cx - 6.5, y);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
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

  // Subtle intersecting royal gold crystal rays on backdrop
  ctx.save();
  ctx.strokeStyle = 'rgba(250, 204, 21, 0.13)';
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
  ctx.fillText(payload.teamName || 'فريق السداسي', W / 2, 58);
  ctx.fillStyle = '#a1a1aa';
  ctx.font = `700 18px ${fontStack}`;
  ctx.fillText(`${payload.appName || 'ميدان 6v6'} • درع ميدان الملكي`, W / 2, 88);
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

  // 3. True Sculpted Metallic Crest Outer Shell + Ambient Shadow
  const sx = 52;
  const sy = 114;
  const sw = W - 104;
  const sh = 978;

  ctx.save();
  ctx.shadowColor = pal.glow;
  ctx.shadowBlur = 48;
  ctx.shadowOffsetY = 16;
  drawSculptedShieldPath(ctx, sx, sy, sw, sh);
  const frameGrad = ctx.createLinearGradient(sx, sy, sx + sw, sy + sh);
  frameGrad.addColorStop(0, pal.borderA);
  frameGrad.addColorStop(0.32, pal.borderB);
  frameGrad.addColorStop(0.68, pal.borderC);
  frameGrad.addColorStop(1, pal.borderD);
  ctx.fillStyle = frameGrad;
  ctx.fill();
  ctx.restore();

  // Inner Sculpted Obsidian Shield Surface
  const ix = sx + 8;
  const iy = sy + 9;
  const iw = sw - 16;
  const ih = sh - 18;

  ctx.save();
  drawSculptedShieldPath(ctx, ix, iy, iw, ih);
  ctx.clip();

  const innerGrad = ctx.createLinearGradient(ix, iy, ix + iw, iy + ih);
  innerGrad.addColorStop(0, pal.bgTop);
  innerGrad.addColorStop(0.46, pal.bgMid);
  innerGrad.addColorStop(1, pal.bgBot);
  ctx.fillStyle = innerGrad;
  ctx.fillRect(ix, iy, iw, ih);

  // Top crown specular highlight
  const crownGlow = ctx.createRadialGradient(ix + iw * 0.5, iy + 20, 10, ix + iw * 0.5, iy + 60, 290);
  crownGlow.addColorStop(0, pal.facetGold);
  crownGlow.addColorStop(1, 'transparent');
  ctx.fillStyle = crownGlow;
  ctx.fillRect(ix, iy, iw, ih);

  // Geometric Obsidian Crystal Facets
  const drawFacet = (pts: Array<[number, number]>, fill: string) => {
    ctx.beginPath();
    pts.forEach(([px, py], idx) => (idx === 0 ? ctx.moveTo(ix + px * iw, iy + py * ih) : ctx.lineTo(ix + px * iw, iy + py * ih)));
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  };
  drawFacet([[0.50, 0.01], [0.84, 0.04], [0.62, 0.24], [0.35, 0.19]], 'rgba(255, 255, 255, 0.07)');
  drawFacet([[0.0, 0.08], [0.35, 0.19], [0.19, 0.41], [0.0, 0.36]], pal.facetGold);
  drawFacet([[0.84, 0.04], [1.0, 0.09], [1.0, 0.35], [0.62, 0.24]], pal.facetGold);
  drawFacet([[0.35, 0.19], [0.62, 0.24], [0.76, 0.47], [0.41, 0.44]], 'rgba(0, 0, 0, 0.28)');
  drawFacet([[0.62, 0.24], [1.0, 0.35], [0.90, 0.62], [0.76, 0.47]], 'rgba(255, 255, 255, 0.05)');
  drawFacet([[0.11, 0.74], [0.50, 0.64], [0.89, 0.74], [0.50, 0.99]], pal.facetGold);
  drawFacet([[0.50, 0.64], [0.89, 0.74], [0.75, 0.92], [0.50, 0.99]], 'rgba(255, 255, 255, 0.05)');

  // Diagonal Golden Light Veins
  ctx.strokeStyle = pal.vein;
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(ix, iy + ih * 0.26);
  ctx.lineTo(ix + iw, iy + ih * 0.55);
  ctx.moveTo(ix + iw, iy + ih * 0.15);
  ctx.lineTo(ix, iy + ih * 0.49);
  ctx.moveTo(ix + iw * 0.12, iy + ih * 0.74);
  ctx.lineTo(ix + iw * 0.88, iy + ih * 0.46);
  ctx.stroke();

  // Warm Golden Halo Behind Player Shoulders
  const haloGlow = ctx.createRadialGradient(ix + iw * 0.34, iy + 225, 16, ix + iw * 0.34, iy + 225, 210);
  haloGlow.addColorStop(0, pal.halo);
  haloGlow.addColorStop(0.55, 'rgba(250, 204, 21, 0.06)');
  haloGlow.addColorStop(1, 'transparent');
  ctx.fillStyle = haloGlow;
  ctx.fillRect(ix, iy, iw, ih);

  // 4. Seamless Player Portrait (Left Side of Shield Hero, matching RTL card)
  const photoImg = payload.photo ? await loadImageSafe(payload.photo) : null;
  const pBoxX = ix + 34;
  const pBoxY = iy + 34;
  const pBoxW = 356;
  const pBoxH = 336;

  if (photoImg) {
    const off = document.createElement('canvas');
    off.width = pBoxW;
    off.height = pBoxH;
    const octx = off.getContext('2d')!;
    const zoom = Math.max(0.9, Math.min(1.6, Number(payload.photoZoom || 105) / 100));
    const yPct = Math.max(0, Math.min(60, Number(payload.photoY ?? 18))) / 100;

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

    octx.globalCompositeOperation = 'destination-in';
    const maskGrad = octx.createRadialGradient(pBoxW * 0.5, pBoxH * 0.42, pBoxW * 0.14, pBoxW * 0.5, pBoxH * 0.46, pBoxW * 0.5);
    maskGrad.addColorStop(0, 'rgba(0,0,0,1)');
    maskGrad.addColorStop(0.68, 'rgba(0,0,0,0.92)');
    maskGrad.addColorStop(1, 'rgba(0,0,0,0)');
    octx.fillStyle = maskGrad;
    octx.fillRect(0, 0, pBoxW, pBoxH);

    const botFade = octx.createLinearGradient(0, pBoxH * 0.65, 0, pBoxH);
    botFade.addColorStop(0, 'rgba(0,0,0,1)');
    botFade.addColorStop(1, 'rgba(0,0,0,0)');
    octx.fillStyle = botFade;
    octx.fillRect(0, pBoxH * 0.65, pBoxW, pBoxH * 0.35);

    ctx.drawImage(off, pBoxX, pBoxY);
  } else {
    ctx.save();
    const silGrad = ctx.createLinearGradient(pBoxX, pBoxY + 30, pBoxX, pBoxY + pBoxH);
    silGrad.addColorStop(0, pal.halo);
    silGrad.addColorStop(1, 'rgba(250, 204, 21, 0.03)');
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

  // 5. Right Glass Meta Strip (Metallic Gradient OVR, Pos, Jersey, Tier)
  const metaW = 196;
  const metaH = 266;
  const metaX = ix + iw - metaW - 36;
  const metaY = iy + 46;

  ctx.save();
  drawRoundedRectPath(ctx, metaX, metaY, metaW, metaH, 28, 28);
  const glassGrad = ctx.createLinearGradient(metaX, metaY, metaX, metaY + metaH);
  glassGrad.addColorStop(0, 'rgba(14, 15, 22, 0.78)');
  glassGrad.addColorStop(1, 'rgba(7, 7, 9, 0.56)');
  ctx.fillStyle = glassGrad;
  ctx.fill();
  ctx.strokeStyle = pal.innerStroke;
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.direction = 'rtl';
  ctx.textAlign = 'center';

  // Metallic 24K Gradient OVR with deep shadow
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.92)';
  ctx.shadowBlur = 12;
  ctx.shadowOffsetY = 5;
  const ovrGrad = ctx.createLinearGradient(metaX, metaY + 22, metaX, metaY + 104);
  ovrGrad.addColorStop(0, pal.ovrTop);
  ovrGrad.addColorStop(0.52, pal.ovrMid);
  ovrGrad.addColorStop(1, pal.ovrBot);
  ctx.fillStyle = ovrGrad;
  ctx.font = `900 96px ${fontStack}`;
  ctx.fillText(String(payload.ovr), metaX + metaW / 2, metaY + 100);
  ctx.restore();

  ctx.fillStyle = pal.subText;
  ctx.font = `900 30px ${fontStack}`;
  ctx.fillText(payload.posShort || 'MID', metaX + metaW / 2, metaY + 142);

  // Jersey Pill
  drawRoundedRectPath(ctx, metaX + 44, metaY + 160, metaW - 88, 42, 21, 21);
  ctx.fillStyle = 'rgba(250, 204, 21, 0.14)';
  ctx.fill();
  ctx.strokeStyle = pal.innerStroke;
  ctx.lineWidth = 1.6;
  ctx.stroke();
  ctx.fillStyle = pal.accent;
  ctx.font = `900 24px ${fontStack}`;
  ctx.fillText(`#${payload.jersey}`, metaX + metaW / 2, metaY + 189);

  ctx.fillStyle = pal.subText;
  ctx.font = `800 18px ${fontStack}`;
  ctx.fillText(payload.tierLabel, metaX + metaW / 2, metaY + 238);
  ctx.restore();

  // Divider 1 (◆)
  drawDiamondDivider(ctx, ix + 44, iy + 362, iw - 88, pal.accent, pal.innerStroke);

  // 6. Player Nameplate + Level + DNA + Global Twin Ribbon
  const npX = ix + 36;
  const npY = iy + 374;
  const npW = iw - 72;
  const npH = 124;

  ctx.save();
  ctx.direction = 'rtl';
  ctx.textAlign = 'center';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
  ctx.shadowBlur = 10;
  ctx.fillStyle = '#FFFBEB';
  ctx.font = `900 44px ${fontStack}`;
  ctx.fillText(payload.playerName || 'اللاعب', npX + npW / 2, npY + 46);
  ctx.shadowBlur = 0;

  ctx.fillStyle = pal.accent;
  ctx.font = `800 20px ${fontStack}`;
  ctx.fillText(`${payload.dnaTitle}  •  ${payload.levelText}`, npX + npW / 2, npY + 84);

  if (payload.twinText) {
    ctx.fillStyle = '#e4e4e7';
    ctx.font = `700 18px ${fontStack}`;
    ctx.fillText(payload.twinText, npX + npW / 2, npY + 114);
  }
  ctx.restore();

  // Divider 2 (◆)
  drawDiamondDivider(ctx, ix + 44, npY + npH + 10, iw - 88, pal.accent, pal.innerStroke);

  // 7. 6 Core Stats Grid (2 cols × 3 rows)
  const stX = ix + 40;
  const stY = npY + npH + 26;
  const stW = iw - 80;
  const stH = 180;

  ctx.save();
  drawRoundedRectPath(ctx, stX, stY, stW, stH, 24, 24);
  ctx.fillStyle = 'rgba(7, 7, 9, 0.66)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(250, 204, 21, 0.22)';
  ctx.lineWidth = 1.8;
  ctx.stroke();

  // Tapered vertical center divider
  const vDiv = ctx.createLinearGradient(0, stY + 18, 0, stY + stH - 18);
  vDiv.addColorStop(0, 'rgba(250, 204, 21, 0)');
  vDiv.addColorStop(0.5, pal.innerStroke);
  vDiv.addColorStop(1, 'rgba(250, 204, 21, 0)');
  ctx.strokeStyle = vDiv;
  ctx.beginPath();
  ctx.moveTo(stX + stW / 2, stY + 18);
  ctx.lineTo(stX + stW / 2, stY + stH - 18);
  ctx.stroke();

  ctx.direction = 'rtl';
  const stats = payload.sixStats.slice(0, 6);
  for (let i = 0; i < stats.length; i++) {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const cellX = col === 0 ? stX + stW / 2 + 24 : stX + 24;
    const cellW = stW / 2 - 48;
    const cy = stY + 46 + row * 52;

    ctx.textAlign = 'right';
    ctx.fillStyle = pal.accent;
    ctx.font = `900 32px ${fontStack}`;
    ctx.fillText(String(stats[i].val), cellX + cellW, cy);

    ctx.textAlign = 'left';
    ctx.fillStyle = '#e4e4e7';
    ctx.font = `800 21px ${fontStack}`;
    ctx.fillText(stats[i].lbl, cellX, cy - 2);
  }
  ctx.restore();

  // Divider 3 (◆)
  drawDiamondDivider(ctx, ix + 56, stY + stH + 16, iw - 112, pal.accent, pal.innerStroke);

  // 8. PlayStyle+ Badges Row
  const psY = stY + stH + 30;
  const badges = payload.playStyles.slice(0, 3);
  if (badges.length > 0) {
    ctx.save();
    ctx.direction = 'rtl';
    ctx.font = `800 19px ${fontStack}`;
    const gap = 12;
    const pillWidths = badges.map((b) => Math.max(146, ctx.measureText(`${b.icon} ${b.name}`).width + 32));
    const totalW = pillWidths.reduce((a, b) => a + b, 0) + gap * (badges.length - 1);
    let cursorX = ix + (iw - Math.min(iw - 84, totalW)) / 2;

    badges.forEach((b, idx) => {
      const pw = Math.min(186, pillWidths[idx]);
      drawRoundedRectPath(ctx, cursorX, psY, pw, 42, 21, 21);
      ctx.fillStyle = b.plus ? 'rgba(250, 204, 21, 0.22)' : 'rgba(255, 255, 255, 0.08)';
      ctx.fill();
      ctx.strokeStyle = b.plus ? pal.innerStroke : 'rgba(255, 255, 255, 0.2)';
      ctx.lineWidth = 1.6;
      ctx.stroke();

      ctx.textAlign = 'center';
      ctx.fillStyle = b.plus ? pal.subText : '#f4f4f5';
      ctx.font = `800 18px ${fontStack}`;
      ctx.fillText(`${b.icon} ${b.name}`, cursorX + pw / 2, psY + 27);
      cursorX += pw + gap;
    });
    ctx.restore();
  }

  // Divider 4 (◆) + 9. Bottom Stats Row (Goals / Assists / Commitment)
  const footY = psY + 56;
  drawDiamondDivider(ctx, ix + 110, footY, iw - 220, pal.accent, pal.innerStroke);

  ctx.save();
  ctx.direction = 'rtl';
  ctx.textAlign = 'center';
  const cols = [
    { lbl: 'أهداف', val: String(payload.goals), color: '#FFFBEB' },
    { lbl: 'تمريرات', val: String(payload.assists), color: '#FFFBEB' },
    { lbl: 'الالتزام', val: payload.commitment || '100%', color: pal.accent },
  ];
  const colW = (iw - 210) / 3;
  cols.forEach((c, idx) => {
    const cx = ix + iw - 105 - colW * idx - colW / 2;
    ctx.fillStyle = '#a1a1aa';
    ctx.font = `700 18px ${fontStack}`;
    ctx.fillText(c.lbl, cx, footY + 32);
    ctx.fillStyle = c.color;
    ctx.font = `900 32px ${fontStack}`;
    ctx.fillText(c.val, cx, footY + 70);
  });
  ctx.restore();

  // Inner 1px (2px Retina) Golden Filigree Inset Border + Top/Bottom Diamond Jewels
  ctx.save();
  drawSculptedShieldPath(ctx, ix + 11, iy + 11, iw - 22, ih - 22);
  ctx.strokeStyle = pal.innerStroke;
  ctx.lineWidth = 2;
  ctx.stroke();

  // Top Crown Jewel (◆)
  const topJx = ix + iw / 2;
  const topJy = iy + 22;
  ctx.fillStyle = pal.borderA;
  ctx.beginPath();
  ctx.moveTo(topJx, topJy - 9);
  ctx.lineTo(topJx + 8, topJy);
  ctx.lineTo(topJx, topJy + 9);
  ctx.lineTo(topJx - 8, topJy);
  ctx.closePath();
  ctx.fill();

  // Bottom Pointed Jewel (◆)
  const botJy = iy + ih - 32;
  ctx.fillStyle = pal.borderB;
  ctx.beginPath();
  ctx.moveTo(topJx, botJy - 8);
  ctx.lineTo(topJx + 7, botJy);
  ctx.lineTo(topJx, botJy + 8);
  ctx.lineTo(topJx - 7, botJy);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  ctx.restore(); // end shield clip

  // 10. Royal Watermark Footer
  ctx.save();
  ctx.direction = 'rtl';
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(250, 204, 21, 0.76)';
  ctx.font = `800 19px ${fontStack}`;
  ctx.fillText(`👑 ${payload.appName || 'ميدان 6v6'} — النسخة الملكية • درع ميدان عالي الدقة`, W / 2, H - 28);
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

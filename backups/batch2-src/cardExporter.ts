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
  borderE: string;
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
  facetLit: string;
  facetMid: string;
  facetEdge: string;
  crysHi: string;
  crysMid: string;
  crysDeep: string;
  crysEdge: string;
  spark: string;
  ray: string;
}

const TIER_PALETTES: Record<CardExportPayload['tierKey'], TierPalette> = {
  bronze: {
    borderA: '#FFF5E6',
    borderB: '#E5984C',
    borderC: '#6B2E0E',
    borderD: '#FCD5A4',
    borderE: '#9A481A',
    innerStroke: 'rgba(252, 213, 164, 0.68)',
    bgTop: '#2a180b',
    bgMid: '#0a0706',
    bgBot: '#211309',
    glow: 'rgba(229, 152, 76, 0.44)',
    halo: 'rgba(244, 178, 108, 0.44)',
    accent: '#F4B878',
    subText: '#FFEDD5',
    ovrTop: '#FFF7ED',
    ovrMid: '#E5984C',
    ovrBot: '#7C3812',
    vein: 'rgba(244, 184, 120, 0.44)',
    facetLit: 'rgba(255, 245, 230, 0.16)',
    facetMid: 'rgba(229, 152, 76, 0.20)',
    facetEdge: 'rgba(244, 184, 120, 0.46)',
    crysHi: '#FFF7ED',
    crysMid: '#E5984C',
    crysDeep: '#6B2E0E',
    crysEdge: 'rgba(255, 237, 213, 0.85)',
    spark: '#FFF7ED',
    ray: 'rgba(235, 156, 82, 0.24)',
  },
  silver: {
    borderA: '#FFFFFF',
    borderB: '#CBD5E1',
    borderC: '#334155',
    borderD: '#F8FAFC',
    borderE: '#64748B',
    innerStroke: 'rgba(241, 245, 249, 0.68)',
    bgTop: '#1c2738',
    bgMid: '#070a0f',
    bgBot: '#151e2c',
    glow: 'rgba(203, 213, 225, 0.42)',
    halo: 'rgba(226, 232, 240, 0.42)',
    accent: '#E2E8F0',
    subText: '#FFFFFF',
    ovrTop: '#FFFFFF',
    ovrMid: '#E2E8F0',
    ovrBot: '#475569',
    vein: 'rgba(226, 232, 240, 0.44)',
    facetLit: 'rgba(255, 255, 255, 0.14)',
    facetMid: 'rgba(203, 213, 225, 0.18)',
    facetEdge: 'rgba(226, 232, 240, 0.46)',
    crysHi: '#FFFFFF',
    crysMid: '#CBD5E1',
    crysDeep: '#334155',
    crysEdge: 'rgba(255, 255, 255, 0.88)',
    spark: '#FFFFFF',
    ray: 'rgba(226, 232, 240, 0.22)',
  },
  gold: {
    borderA: '#FFFBEB',
    borderB: '#FACC15',
    borderC: '#78350F',
    borderD: '#FEF08A',
    borderE: '#B45309',
    innerStroke: 'rgba(254, 240, 138, 0.72)',
    bgTop: '#221b09',
    bgMid: '#060608',
    bgBot: '#1a1508',
    glow: 'rgba(250, 204, 21, 0.48)',
    halo: 'rgba(250, 204, 21, 0.46)',
    accent: '#FACC15',
    subText: '#FEF08A',
    ovrTop: '#FFFFFF',
    ovrMid: '#FACC15',
    ovrBot: '#92400E',
    vein: 'rgba(250, 204, 21, 0.48)',
    facetLit: 'rgba(255, 251, 235, 0.16)',
    facetMid: 'rgba(250, 204, 21, 0.20)',
    facetEdge: 'rgba(250, 204, 21, 0.48)',
    crysHi: '#FFFBEB',
    crysMid: '#FACC15',
    crysDeep: '#78350F',
    crysEdge: 'rgba(254, 240, 138, 0.9)',
    spark: '#FFFBEB',
    ray: 'rgba(250, 204, 21, 0.24)',
  },
  totw: {
    borderA: '#FFFFFF',
    borderB: '#FACC15',
    borderC: '#181409',
    borderD: '#FDE047',
    borderE: '#CA8A04',
    innerStroke: 'rgba(250, 204, 21, 0.86)',
    bgTop: '#120f05',
    bgMid: '#030305',
    bgBot: '#100d04',
    glow: 'rgba(250, 204, 21, 0.56)',
    halo: 'rgba(250, 204, 21, 0.54)',
    accent: '#FDE047',
    subText: '#FEF9C3',
    ovrTop: '#FFFFFF',
    ovrMid: '#FACC15',
    ovrBot: '#A16207',
    vein: 'rgba(250, 204, 21, 0.68)',
    facetLit: 'rgba(255, 251, 235, 0.14)',
    facetMid: 'rgba(250, 204, 21, 0.24)',
    facetEdge: 'rgba(250, 204, 21, 0.58)',
    crysHi: '#FFFBEB',
    crysMid: '#FACC15',
    crysDeep: '#1C1606',
    crysEdge: 'rgba(253, 224, 71, 0.95)',
    spark: '#FEF08A',
    ray: 'rgba(250, 204, 21, 0.30)',
  },
  icon: {
    borderA: '#FFFFFF',
    borderB: '#FEF9C3',
    borderC: '#9A6B12',
    borderD: '#FFFFFF',
    borderE: '#D4A017',
    innerStroke: 'rgba(255, 251, 235, 0.88)',
    bgTop: '#2e2715',
    bgMid: '#0c0a07',
    bgBot: '#262011',
    glow: 'rgba(254, 249, 195, 0.58)',
    halo: 'rgba(255, 251, 235, 0.58)',
    accent: '#FEF9C3',
    subText: '#FFFFFF',
    ovrTop: '#FFFFFF',
    ovrMid: '#FDE68A',
    ovrBot: '#A16207',
    vein: 'rgba(254, 249, 195, 0.56)',
    facetLit: 'rgba(255, 255, 255, 0.18)',
    facetMid: 'rgba(254, 249, 195, 0.22)',
    facetEdge: 'rgba(254, 249, 195, 0.56)',
    crysHi: '#FFFFFF',
    crysMid: '#FEF3C7',
    crysDeep: '#92660A',
    crysEdge: 'rgba(255, 255, 255, 0.96)',
    spark: '#FFFFFF',
    ray: 'rgba(254, 249, 195, 0.32)',
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

function drawStarFlare(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  color: string
): void {
  ctx.save();
  const glow = ctx.createRadialGradient(cx, cy, 1, cx, cy, radius * 1.45);
  glow.addColorStop(0, color);
  glow.addColorStop(0.45, color);
  glow.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 1.45, 0, Math.PI * 2);
  ctx.fill();

  ctx.globalAlpha = 0.96;
  ctx.fillStyle = color;
  const inner = radius * 0.22;
  ctx.beginPath();
  ctx.moveTo(cx, cy - radius);
  ctx.lineTo(cx + inner, cy - inner);
  ctx.lineTo(cx + radius, cy);
  ctx.lineTo(cx + inner, cy + inner);
  ctx.lineTo(cx, cy + radius);
  ctx.lineTo(cx - inner, cy + inner);
  ctx.lineTo(cx - radius, cy);
  ctx.lineTo(cx - inner, cy - inner);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath();
  ctx.arc(cx, cy, Math.max(2, radius * 0.18), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawProtrudingCrystals(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  pal: TierPalette
): void {
  // Exact coordinate transform matching DOM .shield-crystals-svg viewBox="0 0 376 572"
  // where the shield spans [18..358, 36..536] (340 x 500)
  const ox = sx - (18 / 340) * sw;
  const oy = sy - (36 / 500) * sh;
  const rx = sw / 340;
  const ry = sh / 500;

  const poly = (pts: Array<[number, number]>, fill: string, stroke?: string, lw = 1.2) => {
    ctx.beginPath();
    pts.forEach(([x, y], i) => {
      const px = ox + x * rx;
      const py = oy + y * ry;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = lw;
      ctx.stroke();
    }
  };

  ctx.save();
  ctx.shadowColor = pal.glow;
  ctx.shadowBlur = 16;

  // 1. TOP ROYAL CROWN CRYSTAL CLUSTER
  // Outer-Left & Outer-Right Mini Shards
  poly([[122, 22], [146, 44], [139, 47]], pal.crysHi, pal.crysEdge, 1.1);
  poly([[122, 22], [152, 38], [146, 44]], pal.crysMid, pal.crysEdge, 0.9);
  poly([[139, 47], [146, 44], [152, 38], [149, 49]], pal.crysDeep);

  poly([[254, 22], [230, 44], [237, 47]], pal.crysMid, pal.crysEdge, 1.1);
  poly([[254, 22], [224, 38], [230, 44]], pal.crysHi, pal.crysEdge, 0.9);
  poly([[237, 47], [230, 44], [224, 38], [227, 49]], pal.crysDeep);

  // Inner-Left & Inner-Right Crown Spires
  poly([[151, 10], [169, 36], [157, 46]], pal.crysHi, pal.crysEdge, 1.3);
  poly([[151, 10], [177, 39], [169, 36]], pal.crysMid, pal.crysEdge, 1.0);
  poly([[157, 46], [169, 36], [177, 39], [171, 48]], pal.crysDeep);

  poly([[225, 10], [207, 36], [219, 46]], pal.crysMid, pal.crysEdge, 1.3);
  poly([[225, 10], [199, 39], [207, 36]], pal.crysHi, pal.crysEdge, 1.0);
  poly([[219, 46], [207, 36], [199, 39], [205, 48]], pal.crysDeep);

  // Center Tall Crown Obelisk Crystal
  poly([[188, 2], [188, 36], [175, 26]], pal.crysHi, pal.crysEdge, 1.5);
  poly([[188, 2], [201, 26], [188, 36]], pal.crysMid, pal.crysEdge, 1.5);
  poly([[175, 26], [188, 36], [179, 45]], pal.crysMid);
  poly([[201, 26], [188, 36], [197, 45]], pal.crysDeep);
  poly([[179, 45], [188, 36], [197, 45], [188, 50]], pal.crysDeep, pal.crysEdge, 1.0);

  // Embedded Center Crown Diamond Jewel
  poly([[188, 25], [196, 35], [188, 45], [180, 35]], pal.crysHi, pal.crysEdge, 1.4);
  poly([[188, 25], [196, 35], [188, 35]], '#FFFFFF');
  poly([[188, 35], [196, 35], [188, 45]], pal.crysMid);

  // 2. RIGHT SHOULDER PROTRUDING 3D CRYSTAL WINGS
  poly([[373, 50], [347, 76], [333, 53]], pal.crysHi, pal.crysEdge, 1.4);
  poly([[373, 50], [356, 88], [347, 76]], pal.crysMid, pal.crysEdge, 1.2);
  poly([[333, 53], [347, 76], [356, 88], [346, 94]], pal.crysDeep);

  poly([[370, 104], [353, 115], [352, 88]], pal.crysHi, pal.crysEdge, 1.3);
  poly([[370, 104], [353, 134], [353, 115]], pal.crysMid, pal.crysEdge, 1.1);
  poly([[352, 126], [353, 115], [353, 134], [348, 140]], pal.crysDeep);

  poly([[364, 152], [352, 158], [353, 142]], pal.crysHi, pal.crysEdge, 1.0);
  poly([[364, 152], [353, 167], [352, 158]], pal.crysDeep);

  // 3. LEFT SHOULDER PROTRUDING 3D CRYSTAL WINGS
  poly([[3, 50], [29, 76], [43, 53]], pal.crysHi, pal.crysEdge, 1.4);
  poly([[3, 50], [20, 88], [29, 76]], pal.crysMid, pal.crysEdge, 1.2);
  poly([[43, 53], [29, 76], [20, 88], [30, 94]], pal.crysDeep);

  poly([[6, 104], [23, 115], [24, 88]], pal.crysHi, pal.crysEdge, 1.3);
  poly([[6, 104], [23, 134], [23, 115]], pal.crysMid, pal.crysEdge, 1.1);
  poly([[24, 126], [23, 115], [23, 134], [28, 140]], pal.crysDeep);

  poly([[12, 152], [24, 158], [23, 142]], pal.crysHi, pal.crysEdge, 1.0);
  poly([[12, 152], [23, 167], [24, 158]], pal.crysDeep);

  // 4. LOWER FLANK 3D CRYSTAL SHARDS
  poly([[366, 426], [347, 424], [353, 396]], pal.crysHi, pal.crysEdge, 1.3);
  poly([[366, 426], [339, 450], [347, 424]], pal.crysMid, pal.crysEdge, 1.1);
  poly([[339, 450], [347, 424], [335, 442]], pal.crysDeep);
  poly([[338, 476], [318, 476], [332, 456]], pal.crysHi, pal.crysEdge, 1.1);
  poly([[338, 476], [304, 487], [318, 476]], pal.crysDeep);

  poly([[10, 426], [29, 424], [23, 396]], pal.crysHi, pal.crysEdge, 1.3);
  poly([[10, 426], [37, 450], [29, 424]], pal.crysMid, pal.crysEdge, 1.1);
  poly([[37, 450], [29, 424], [41, 442]], pal.crysDeep);
  poly([[38, 476], [58, 476], [44, 456]], pal.crysHi, pal.crysEdge, 1.1);
  poly([[38, 476], [72, 487], [58, 476]], pal.crysDeep);

  // 5. BOTTOM CRYSTAL SPEARHEAD PINNACLE + FLANKING DIAMOND SPURS
  poly([[154, 545], [174, 536], [169, 527]], pal.crysHi, pal.crysEdge, 1.1);
  poly([[154, 545], [178, 543], [174, 536]], pal.crysDeep);
  poly([[222, 545], [202, 536], [207, 527]], pal.crysMid, pal.crysEdge, 1.1);
  poly([[222, 545], [198, 543], [202, 536]], pal.crysDeep);

  poly([[188, 570], [176, 536], [188, 529]], pal.crysHi, pal.crysEdge, 1.5);
  poly([[188, 570], [200, 536], [188, 529]], pal.crysMid, pal.crysEdge, 1.5);
  poly([[176, 536], [188, 529], [182, 524]], pal.crysMid);
  poly([[200, 536], [188, 529], [194, 524]], pal.crysDeep);

  ctx.restore();

  // 6. DIAMOND 4-POINT STAR FLARES (✦) ON CRYSTAL TIPS & OVR CORNER
  drawStarFlare(ctx, ox + 188 * rx, oy + 7 * ry, 18, pal.spark);
  drawStarFlare(ctx, ox + 368 * rx, oy + 50 * ry, 14, pal.spark);
  drawStarFlare(ctx, ox + 8 * rx, oy + 50 * ry, 14, pal.spark);
  drawStarFlare(ctx, ox + 332 * rx, oy + 85 * ry, 16, pal.spark);
  drawStarFlare(ctx, ox + 13 * rx, oy + 425 * ry, 12, pal.spark);
  drawStarFlare(ctx, ox + 188 * rx, oy + 566 * ry, 14, pal.spark);
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

  // 1. Royal Obsidian Canvas Backdrop + Radiant Aura Behind Shield
  const backGrad = ctx.createLinearGradient(0, 0, W, H);
  backGrad.addColorStop(0, '#070709');
  backGrad.addColorStop(0.5, '#0e1017');
  backGrad.addColorStop(1, '#070709');
  ctx.fillStyle = backGrad;
  ctx.fillRect(0, 0, W, H);

  const stageAura = ctx.createRadialGradient(W / 2, H * 0.48, 40, W / 2, H * 0.48, 460);
  stageAura.addColorStop(0, pal.ray);
  stageAura.addColorStop(1, 'transparent');
  ctx.fillStyle = stageAura;
  ctx.fillRect(0, 0, W, H);

  // Subtle intersecting royal gold crystal rays on backdrop
  ctx.save();
  ctx.strokeStyle = pal.vein;
  ctx.globalAlpha = 0.25;
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
  ctx.fillText(payload.teamName || 'فريق السداسي', W / 2, 52);
  ctx.fillStyle = '#a1a1aa';
  ctx.font = `700 18px ${fontStack}`;
  ctx.fillText(`${payload.appName || 'ميدان 6v6'} • درع ميدان الملكي`, W / 2, 82);
  ctx.restore();

  if (teamLogoImg) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(W - 76, 58, 28, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(teamLogoImg, W - 104, 30, 56, 56);
    ctx.restore();
    ctx.strokeStyle = pal.accent;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(W - 76, 58, 28, 0, Math.PI * 2);
    ctx.stroke();
  }

  // 3. True Sculpted Forged-Bevel Outer Shell (sized to leave generous room for protruding 3D crystals)
  const sx = 72;
  const sy = 144;
  const sw = W - 144; // 616
  const sh = 884;

  ctx.save();
  ctx.shadowColor = pal.glow;
  ctx.shadowBlur = 54;
  ctx.shadowOffsetY = 16;
  drawSculptedShieldPath(ctx, sx, sy, sw, sh);
  const frameGrad = ctx.createLinearGradient(sx, sy, sx + sw, sy + sh);
  frameGrad.addColorStop(0, pal.borderA);
  frameGrad.addColorStop(0.22, pal.borderB);
  frameGrad.addColorStop(0.44, pal.borderC);
  frameGrad.addColorStop(0.64, pal.borderD);
  frameGrad.addColorStop(0.84, pal.borderE);
  frameGrad.addColorStop(1, pal.borderA);
  ctx.fillStyle = frameGrad;
  ctx.fill();
  ctx.restore();

  // Dark carved bevel channel between outer rim and inner shield surface
  ctx.save();
  drawSculptedShieldPath(ctx, sx + 6, sy + 7, sw - 12, sh - 14);
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.78)';
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.restore();

  // Inner Sculpted Obsidian Shield Surface
  const ix = sx + 9;
  const iy = sy + 10;
  const iw = sw - 18;
  const ih = sh - 20;

  ctx.save();
  drawSculptedShieldPath(ctx, ix, iy, iw, ih);
  ctx.clip();

  const innerGrad = ctx.createLinearGradient(ix, iy, ix + iw, iy + ih);
  innerGrad.addColorStop(0, pal.bgTop);
  innerGrad.addColorStop(0.46, pal.bgMid);
  innerGrad.addColorStop(1, pal.bgBot);
  ctx.fillStyle = innerGrad;
  ctx.fillRect(ix, iy, iw, ih);

  // Radiant Sunburst Core & Diagonal Light Rays Behind Player Portrait
  const burstCx = ix + iw * 0.34;
  const burstCy = iy + ih * 0.24;
  const burstGlow = ctx.createRadialGradient(burstCx, burstCy, 14, burstCx, burstCy, 340);
  burstGlow.addColorStop(0, pal.halo);
  burstGlow.addColorStop(0.45, pal.ray);
  burstGlow.addColorStop(1, 'transparent');
  ctx.fillStyle = burstGlow;
  ctx.fillRect(ix, iy, iw, ih);

  const drawRay = (p1: [number, number], p2: [number, number], alpha: number) => {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = pal.ray;
    ctx.beginPath();
    ctx.moveTo(burstCx, burstCy);
    ctx.lineTo(ix + p1[0] * iw, iy + p1[1] * ih);
    ctx.lineTo(ix + p2[0] * iw, iy + p2[1] * ih);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  };
  drawRay([0.08, 0], [0.22, 0], 0.72);
  drawRay([0.42, 0], [0.56, 0], 0.62);
  drawRay([0.78, 0], [0.94, 0], 0.50);
  drawRay([1.0, 0.12], [1.0, 0.22], 0.45);
  drawRay([1.0, 0.36], [1.0, 0.46], 0.36);
  drawRay([0.0, 0.15], [0.0, 0.25], 0.52);
  drawRay([0.0, 0.40], [0.0, 0.50], 0.36);

  // High-Contrast Obsidian Crystal Polygons with Illuminated Facet Edges
  const drawFacet = (pts: Array<[number, number]>, fill: string) => {
    ctx.beginPath();
    pts.forEach(([px, py], idx) => (idx === 0 ? ctx.moveTo(ix + px * iw, iy + py * ih) : ctx.lineTo(ix + px * iw, iy + py * ih)));
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = pal.facetEdge;
    ctx.lineWidth = 1.4;
    ctx.stroke();
  };
  drawFacet([[0.50, 0.01], [0.83, 0.04], [0.63, 0.23], [0.34, 0.19]], pal.facetLit);
  drawFacet([[0.0, 0.08], [0.34, 0.19], [0.18, 0.40], [0.0, 0.36]], pal.facetMid);
  drawFacet([[0.83, 0.04], [1.0, 0.09], [1.0, 0.35], [0.63, 0.23]], pal.facetMid);
  drawFacet([[0.34, 0.19], [0.63, 0.23], [0.76, 0.47], [0.41, 0.43]], 'rgba(0, 0, 0, 0.42)');
  drawFacet([[0.63, 0.23], [1.0, 0.35], [0.90, 0.62], [0.76, 0.47]], pal.facetLit);
  drawFacet([[0.0, 0.36], [0.18, 0.40], [0.33, 0.65], [0.0, 0.70]], 'rgba(0, 0, 0, 0.40)');
  drawFacet([[0.10, 0.74], [0.50, 0.64], [0.90, 0.74], [0.50, 0.99]], pal.facetMid);
  drawFacet([[0.50, 0.64], [0.90, 0.74], [0.75, 0.92], [0.50, 0.99]], pal.facetLit);

  // Razor Diagonal Gold/Tier Lightning Veins
  ctx.save();
  ctx.strokeStyle = pal.vein;
  ctx.lineWidth = 2.0;
  ctx.beginPath();
  ctx.moveTo(ix, iy + ih * 0.25);
  ctx.lineTo(ix + iw, iy + ih * 0.55);
  ctx.moveTo(ix + iw, iy + ih * 0.14);
  ctx.lineTo(ix, iy + ih * 0.49);
  ctx.moveTo(ix + iw * 0.08, iy + ih * 0.75);
  ctx.lineTo(ix + iw * 0.92, iy + ih * 0.45);
  ctx.stroke();
  ctx.restore();

  // Holographic Diagonal Glass Sheen Band across upper-mid shield
  ctx.save();
  const sheenGrad = ctx.createLinearGradient(ix + iw * 0.1, iy, ix + iw * 0.78, iy + ih * 0.68);
  sheenGrad.addColorStop(0, 'rgba(255, 255, 255, 0)');
  sheenGrad.addColorStop(0.42, 'rgba(255, 255, 255, 0.02)');
  sheenGrad.addColorStop(0.50, 'rgba(255, 255, 255, 0.14)');
  sheenGrad.addColorStop(0.56, 'rgba(254, 240, 138, 0.09)');
  sheenGrad.addColorStop(0.66, 'rgba(255, 255, 255, 0)');
  sheenGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = sheenGrad;
  ctx.fillRect(ix, iy, iw, ih);
  ctx.restore();

  // 4. Seamless Player Portrait (Left Side of Shield Hero, matching RTL card)
  const photoImg = payload.photo ? await loadImageSafe(payload.photo) : null;
  const pBoxX = ix + 28;
  const pBoxY = iy + 28;
  const pBoxW = 330;
  const pBoxH = 312;

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
    const silGrad = ctx.createLinearGradient(pBoxX, pBoxY + 26, pBoxX, pBoxY + pBoxH);
    silGrad.addColorStop(0, pal.halo);
    silGrad.addColorStop(1, 'rgba(250, 204, 21, 0.04)');
    ctx.fillStyle = silGrad;
    ctx.beginPath();
    ctx.arc(pBoxX + pBoxW * 0.5, pBoxY + 108, 54, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(pBoxX + 68, pBoxY + 294);
    ctx.bezierCurveTo(pBoxX + 75, pBoxY + 202, pBoxX + 124, pBoxY + 178, pBoxX + pBoxW * 0.5, pBoxY + 178);
    ctx.bezierCurveTo(pBoxX + 206, pBoxY + 178, pBoxX + 255, pBoxY + 202, pBoxX + 262, pBoxY + 294);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // 5. Right Glass Meta Strip (Metallic Gradient OVR, Pos, Jersey, Tier)
  const metaW = 186;
  const metaH = 248;
  const metaX = ix + iw - metaW - 32;
  const metaY = iy + 44;

  ctx.save();
  drawRoundedRectPath(ctx, metaX, metaY, metaW, metaH, 26, 26);
  const glassGrad = ctx.createLinearGradient(metaX, metaY, metaX, metaY + metaH);
  glassGrad.addColorStop(0, 'rgba(14, 15, 22, 0.80)');
  glassGrad.addColorStop(1, 'rgba(7, 7, 9, 0.58)');
  ctx.fillStyle = glassGrad;
  ctx.fill();
  ctx.strokeStyle = pal.innerStroke;
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.direction = 'rtl';
  ctx.textAlign = 'center';

  // Metallic 24K Gradient OVR with deep shadow
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.94)';
  ctx.shadowBlur = 12;
  ctx.shadowOffsetY = 5;
  const ovrGrad = ctx.createLinearGradient(metaX, metaY + 18, metaX, metaY + 98);
  ovrGrad.addColorStop(0, pal.ovrTop);
  ovrGrad.addColorStop(0.52, pal.ovrMid);
  ovrGrad.addColorStop(1, pal.ovrBot);
  ctx.fillStyle = ovrGrad;
  ctx.font = `900 90px ${fontStack}`;
  ctx.fillText(String(payload.ovr), metaX + metaW / 2, metaY + 94);
  ctx.restore();

  ctx.fillStyle = pal.subText;
  ctx.font = `900 28px ${fontStack}`;
  ctx.fillText(payload.posShort || 'MID', metaX + metaW / 2, metaY + 134);

  // Jersey Pill
  drawRoundedRectPath(ctx, metaX + 42, metaY + 150, metaW - 84, 38, 19, 19);
  ctx.fillStyle = 'rgba(250, 204, 21, 0.14)';
  ctx.fill();
  ctx.strokeStyle = pal.innerStroke;
  ctx.lineWidth = 1.6;
  ctx.stroke();
  ctx.fillStyle = pal.accent;
  ctx.font = `900 23px ${fontStack}`;
  ctx.fillText(`#${payload.jersey}`, metaX + metaW / 2, metaY + 177);

  ctx.fillStyle = pal.subText;
  ctx.font = `800 17px ${fontStack}`;
  ctx.fillText(payload.tierLabel, metaX + metaW / 2, metaY + 224);
  ctx.restore();

  // Divider 1 (◆)
  drawDiamondDivider(ctx, ix + 40, iy + 332, iw - 80, pal.accent, pal.innerStroke);

  // 6. Player Nameplate + Level + DNA + Global Twin Ribbon
  const npX = ix + 34;
  const npY = iy + 344;
  const npW = iw - 68;
  const npH = 114;

  ctx.save();
  ctx.direction = 'rtl';
  ctx.textAlign = 'center';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.88)';
  ctx.shadowBlur = 10;
  ctx.fillStyle = '#FFFBEB';
  ctx.font = `900 42px ${fontStack}`;
  ctx.fillText(payload.playerName || 'اللاعب', npX + npW / 2, npY + 42);
  ctx.shadowBlur = 0;

  ctx.fillStyle = pal.accent;
  ctx.font = `800 19px ${fontStack}`;
  ctx.fillText(`${payload.dnaTitle}  •  ${payload.levelText}`, npX + npW / 2, npY + 76);

  if (payload.twinText) {
    ctx.fillStyle = '#e4e4e7';
    ctx.font = `700 17px ${fontStack}`;
    ctx.fillText(payload.twinText, npX + npW / 2, npY + 104);
  }
  ctx.restore();

  // Divider 2 (◆)
  drawDiamondDivider(ctx, ix + 40, npY + npH + 10, iw - 80, pal.accent, pal.innerStroke);

  // 7. 6 Core Stats Grid (2 cols × 3 rows)
  const stX = ix + 36;
  const stY = npY + npH + 24;
  const stW = iw - 72;
  const stH = 166;

  ctx.save();
  drawRoundedRectPath(ctx, stX, stY, stW, stH, 22, 22);
  ctx.fillStyle = 'rgba(7, 7, 9, 0.68)';
  ctx.fill();
  ctx.strokeStyle = pal.facetEdge;
  ctx.lineWidth = 1.6;
  ctx.stroke();

  // Tapered vertical center divider
  const vDiv = ctx.createLinearGradient(0, stY + 16, 0, stY + stH - 16);
  vDiv.addColorStop(0, 'rgba(250, 204, 21, 0)');
  vDiv.addColorStop(0.5, pal.innerStroke);
  vDiv.addColorStop(1, 'rgba(250, 204, 21, 0)');
  ctx.strokeStyle = vDiv;
  ctx.beginPath();
  ctx.moveTo(stX + stW / 2, stY + 16);
  ctx.lineTo(stX + stW / 2, stY + stH - 16);
  ctx.stroke();

  ctx.direction = 'rtl';
  const stats = payload.sixStats.slice(0, 6);
  for (let i = 0; i < stats.length; i++) {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const cellX = col === 0 ? stX + stW / 2 + 22 : stX + 22;
    const cellW = stW / 2 - 44;
    const cy = stY + 42 + row * 48;

    ctx.textAlign = 'right';
    ctx.fillStyle = pal.accent;
    ctx.font = `900 30px ${fontStack}`;
    ctx.fillText(String(stats[i].val), cellX + cellW, cy);

    ctx.textAlign = 'left';
    ctx.fillStyle = '#e4e4e7';
    ctx.font = `800 20px ${fontStack}`;
    ctx.fillText(stats[i].lbl, cellX, cy - 2);
  }
  ctx.restore();

  // Divider 3 (◆)
  drawDiamondDivider(ctx, ix + 52, stY + stH + 14, iw - 104, pal.accent, pal.innerStroke);

  // 8. PlayStyle+ Badges Row
  const psY = stY + stH + 26;
  const badges = payload.playStyles.slice(0, 3);
  if (badges.length > 0) {
    ctx.save();
    ctx.direction = 'rtl';
    ctx.font = `800 18px ${fontStack}`;
    const gap = 10;
    const pillWidths = badges.map((b) => Math.max(138, ctx.measureText(`${b.icon} ${b.name}`).width + 30));
    const totalW = pillWidths.reduce((a, b) => a + b, 0) + gap * (badges.length - 1);
    let cursorX = ix + (iw - Math.min(iw - 76, totalW)) / 2;

    badges.forEach((b, idx) => {
      const pw = Math.min(176, pillWidths[idx]);
      drawRoundedRectPath(ctx, cursorX, psY, pw, 38, 19, 19);
      ctx.fillStyle = b.plus ? 'rgba(250, 204, 21, 0.22)' : 'rgba(255, 255, 255, 0.08)';
      ctx.fill();
      ctx.strokeStyle = b.plus ? pal.innerStroke : 'rgba(255, 255, 255, 0.22)';
      ctx.lineWidth = 1.6;
      ctx.stroke();

      ctx.textAlign = 'center';
      ctx.fillStyle = b.plus ? pal.subText : '#f4f4f5';
      ctx.font = `800 17px ${fontStack}`;
      ctx.fillText(`${b.icon} ${b.name}`, cursorX + pw / 2, psY + 25);
      cursorX += pw + gap;
    });
    ctx.restore();
  }

  // Divider 4 (◆) + 9. Bottom Stats Row (Goals / Assists / Commitment)
  const footY = psY + 50;
  drawDiamondDivider(ctx, ix + 104, footY, iw - 208, pal.accent, pal.innerStroke);

  ctx.save();
  ctx.direction = 'rtl';
  ctx.textAlign = 'center';
  const cols = [
    { lbl: 'أهداف', val: String(payload.goals), color: '#FFFBEB' },
    { lbl: 'تمريرات', val: String(payload.assists), color: '#FFFBEB' },
    { lbl: 'الالتزام', val: payload.commitment || '100%', color: pal.accent },
  ];
  const colW = (iw - 196) / 3;
  cols.forEach((c, idx) => {
    const cx = ix + iw - 98 - colW * idx - colW / 2;
    ctx.fillStyle = '#a1a1aa';
    ctx.font = `700 17px ${fontStack}`;
    ctx.fillText(c.lbl, cx, footY + 28);
    ctx.fillStyle = c.color;
    ctx.font = `900 30px ${fontStack}`;
    ctx.fillText(c.val, cx, footY + 64);
  });
  ctx.restore();

  // Inner Specular Filigree Inset Border
  ctx.save();
  drawSculptedShieldPath(ctx, ix + 10, iy + 10, iw - 20, ih - 20);
  ctx.strokeStyle = pal.innerStroke;
  ctx.lineWidth = 2.2;
  ctx.stroke();

  // Bottom Inner Micro-Gem
  const topJx = ix + iw / 2;
  const botJy = iy + ih - 28;
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

  // 10. PROTRUDING 3D FACETED CRYSTALS & 4-POINT DIAMOND STAR FLARES (OVER & OUTSIDE SHIELD RIM!)
  drawProtrudingCrystals(ctx, sx, sy, sw, sh, pal);

  // 11. Royal Watermark Footer
  ctx.save();
  ctx.direction = 'rtl';
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(250, 204, 21, 0.8)';
  ctx.font = `800 19px ${fontStack}`;
  ctx.fillText(`👑 ${payload.appName || 'ميدان 6v6'} — النسخة الملكية • درع ميدان عالي الدقة`, W / 2, H - 22);
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

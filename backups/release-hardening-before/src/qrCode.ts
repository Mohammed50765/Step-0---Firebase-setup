/**
 * Pure Offline ISO/IEC 18004 QR Code Encoder & SVG Renderer (Zero external dependencies, zero network).
 * Supports UTF-8 Byte mode across Versions 1..10 (up to 271 bytes) with Reed-Solomon error correction
 * (EC Level M default, automatic fallback to Level L for very long URLs), full Finder/Separator/Timing/
 * Alignment/Format/Version patterns, 8-mask ISO penalty evaluation, and crisp 4-module white Quiet Zone SVG.
 */

export type QrEcLevel = 'L' | 'M';

export interface QrMatrixResult {
  version: number;
  ecLevel: QrEcLevel;
  size: number;
  mask: number;
  modules: boolean[][];
}

export interface QrSvgOptions {
  sizePx?: number;
  quietZone?: number;
  darkColor?: string;
  lightColor?: string;
  title?: string;
}

// ISO/IEC 18004 Alignment Pattern Center Coordinates (Versions 1..10)
const ALIGNMENT_PATTERNS: ReadonlyArray<ReadonlyArray<number>> = [
  [],
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
];

// [totalDataCodewords, ecCodewordsPerBlock, group1Blocks, group1DataCws, group2Blocks, group2DataCws]
type EcSpec = readonly [number, number, number, number, number, number];

// ISO/IEC 18004 Table 9 — Versions 1..10 for EC Level M
const EC_SPECS_M: ReadonlyArray<EcSpec> = [
  [0, 0, 0, 0, 0, 0], // placeholder V0
  [16, 10, 1, 16, 0, 0], // V1
  [28, 16, 1, 28, 0, 0], // V2
  [44, 26, 1, 44, 0, 0], // V3
  [64, 18, 2, 32, 0, 0], // V4
  [86, 24, 2, 43, 0, 0], // V5
  [108, 16, 4, 27, 0, 0], // V6
  [124, 18, 4, 31, 0, 0], // V7
  [154, 22, 2, 38, 2, 39], // V8
  [182, 22, 3, 36, 2, 37], // V9
  [216, 26, 4, 43, 1, 44], // V10
];

// ISO/IEC 18004 Table 9 — Versions 1..10 for EC Level L (fallback for extra-long URLs)
const EC_SPECS_L: ReadonlyArray<EcSpec> = [
  [0, 0, 0, 0, 0, 0], // placeholder V0
  [19, 7, 1, 19, 0, 0], // V1
  [34, 10, 1, 34, 0, 0], // V2
  [55, 15, 1, 55, 0, 0], // V3
  [80, 20, 1, 80, 0, 0], // V4
  [108, 26, 1, 108, 0, 0], // V5
  [136, 18, 2, 68, 0, 0], // V6
  [156, 20, 2, 78, 0, 0], // V7
  [194, 24, 2, 97, 0, 0], // V8
  [232, 30, 2, 116, 0, 0], // V9
  [274, 18, 2, 68, 2, 69], // V10
];

// Format indicator bits: L = 01 (1), M = 00 (0)
const EC_FORMAT_BITS: Record<QrEcLevel, number> = {
  L: 0b01,
  M: 0b00,
};

// GF(256) lookup tables with primitive polynomial x^8 + x^4 + x^3 + x^2 + 1 (0x11d)
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) {
    GF_EXP[i] = GF_EXP[i - 255];
  }
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function rsGeneratorPoly(degree: number): Uint8Array {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < degree; i++) {
    const next = new Uint8Array(poly.length + 1);
    const factor = GF_EXP[i];
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], factor);
    }
    poly = next;
  }
  return poly;
}

export function computeReedSolomonRemainder(data: Uint8Array, ecLen: number): Uint8Array {
  const gen = rsGeneratorPoly(ecLen);
  const rem = new Uint8Array(ecLen);
  for (let i = 0; i < data.length; i++) {
    const factor = data[i] ^ rem[0];
    rem.copyWithin(0, 1);
    rem[ecLen - 1] = 0;
    if (factor !== 0) {
      for (let j = 0; j < ecLen; j++) {
        rem[j] ^= gfMul(gen[j + 1], factor);
      }
    }
  }
  return rem;
}

function utf8Bytes(text: string): Uint8Array {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(text);
  }
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) out.push(code);
    else if (code < 0x800) {
      out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else {
      out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    }
  }
  return new Uint8Array(out);
}

function chooseVersionAndEc(byteLen: number, preferredEc: QrEcLevel): { version: number; ecLevel: QrEcLevel; spec: EcSpec } {
  const order: QrEcLevel[] = preferredEc === 'M' ? ['M', 'L'] : ['L', 'M'];
  for (const ec of order) {
    const table = ec === 'M' ? EC_SPECS_M : EC_SPECS_L;
    for (let v = 1; v <= 10; v++) {
      const spec = table[v];
      const countBits = v <= 9 ? 8 : 16;
      const capacityBits = spec[0] * 8;
      const requiredBits = 4 + countBits + byteLen * 8;
      if (requiredBits <= capacityBits) {
        return { version: v, ecLevel: ec, spec };
      }
    }
  }
  throw new Error('QR payload exceeds supported Version 10 capacity (271 bytes)');
}

function buildDataCodewords(bytes: Uint8Array, version: number, totalDataCws: number): Uint8Array {
  const bits: number[] = [];
  const pushBits = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) {
      bits.push((val >>> i) & 1);
    }
  };

  // Byte mode indicator (0100)
  pushBits(0b0100, 4);
  // Character count indicator (8 bits for V1..9, 16 bits for V10)
  pushBits(bytes.length, version <= 9 ? 8 : 16);
  // Payload bytes
  for (let i = 0; i < bytes.length; i++) {
    pushBits(bytes[i], 8);
  }

  const maxBits = totalDataCws * 8;
  // Terminator (up to 4 zero bits)
  const termLen = Math.min(4, maxBits - bits.length);
  for (let i = 0; i < termLen; i++) bits.push(0);
  // Pad to byte boundary
  while (bits.length % 8 !== 0) bits.push(0);

  const out = new Uint8Array(totalDataCws);
  let byteIdx = 0;
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
    out[byteIdx++] = b;
  }

  // Pad alternating 0xEC, 0x11
  let padToggle = 0;
  while (byteIdx < totalDataCws) {
    out[byteIdx++] = padToggle === 0 ? 0xec : 0x11;
    padToggle ^= 1;
  }
  return out;
}

function buildInterleavedCodewords(data: Uint8Array, spec: EcSpec): Uint8Array {
  const [, ecLen, g1Blocks, g1Data, g2Blocks, g2Data] = spec;
  const dataBlocks: Uint8Array[] = [];
  const ecBlocks: Uint8Array[] = [];
  let offset = 0;

  for (let i = 0; i < g1Blocks; i++) {
    const blk = data.subarray(offset, offset + g1Data);
    offset += g1Data;
    dataBlocks.push(blk);
    ecBlocks.push(computeReedSolomonRemainder(blk, ecLen));
  }
  for (let i = 0; i < g2Blocks; i++) {
    const blk = data.subarray(offset, offset + g2Data);
    offset += g2Data;
    dataBlocks.push(blk);
    ecBlocks.push(computeReedSolomonRemainder(blk, ecLen));
  }

  const maxDataLen = Math.max(g1Data, g2Data);
  const totalBytes = data.length + (g1Blocks + g2Blocks) * ecLen;
  const result = new Uint8Array(totalBytes);
  let pos = 0;

  for (let i = 0; i < maxDataLen; i++) {
    for (let b = 0; b < dataBlocks.length; b++) {
      if (i < dataBlocks[b].length) result[pos++] = dataBlocks[b][i];
    }
  }
  for (let i = 0; i < ecLen; i++) {
    for (let b = 0; b < ecBlocks.length; b++) {
      result[pos++] = ecBlocks[b][i];
    }
  }
  return result;
}

export function computeFormatBits(ecLevel: QrEcLevel, mask: number): number {
  const data = (EC_FORMAT_BITS[ecLevel] << 3) | (mask & 0b111);
  let rem = data << 10;
  const gen = 0b10100110111; // x^10 + x^8 + x^5 + x^4 + x^2 + x + 1
  for (let i = 14; i >= 10; i--) {
    if ((rem >>> i) & 1) rem ^= gen << (i - 10);
  }
  return ((data << 10) | rem) ^ 0b101010000010010;
}

export function computeVersionBits(version: number): number {
  let rem = version << 12;
  const gen = 0b1111100100101; // x^12 + x^11 + x^10 + x^9 + x^8 + x^5 + x^2 + 1
  for (let i = 17; i >= 12; i--) {
    if ((rem >>> i) & 1) rem ^= gen << (i - 12);
  }
  return (version << 12) | rem;
}

function createGrid<T>(size: number, fill: T): T[][] {
  return Array.from({ length: size }, () => Array.from({ length: size }, () => fill));
}

function drawFinderPattern(modules: boolean[][], isFunc: boolean[][], row: number, col: number): void {
  const size = modules.length;
  for (let dr = -1; dr <= 7; dr++) {
    for (let dc = -1; dc <= 7; dc++) {
      const r = row + dr;
      const c = col + dc;
      if (r < 0 || r >= size || c < 0 || c >= size) continue;
      const inOuter = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
      const isDark =
        inOuter &&
        (dr === 0 || dr === 6 || dc === 0 || dc === 6 || (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4));
      modules[r][c] = isDark;
      isFunc[r][c] = true;
    }
  }
}

function drawAlignmentPattern(modules: boolean[][], isFunc: boolean[][], centerR: number, centerC: number): void {
  for (let dr = -2; dr <= 2; dr++) {
    for (let dc = -2; dc <= 2; dc++) {
      const r = centerR + dr;
      const c = centerC + dc;
      const dist = Math.max(Math.abs(dr), Math.abs(dc));
      modules[r][c] = dist !== 1;
      isFunc[r][c] = true;
    }
  }
}

function drawFunctionPatterns(version: number): { modules: boolean[][]; isFunc: boolean[][] } {
  const size = 17 + version * 4;
  const modules = createGrid(size, false);
  const isFunc = createGrid(size, false);

  // Timing patterns
  for (let i = 0; i < size; i++) {
    const dark = i % 2 === 0;
    modules[6][i] = dark;
    isFunc[6][i] = true;
    modules[i][6] = dark;
    isFunc[i][6] = true;
  }

  // Three Finder patterns + white separators
  drawFinderPattern(modules, isFunc, 0, 0);
  drawFinderPattern(modules, isFunc, 0, size - 7);
  drawFinderPattern(modules, isFunc, size - 7, 0);

  // Alignment patterns (V2..V10)
  const coords = ALIGNMENT_PATTERNS[version] || [];
  for (let i = 0; i < coords.length; i++) {
    for (let j = 0; j < coords.length; j++) {
      const r = coords[i];
      const c = coords[j];
      // Skip corners overlapping the 3 finder patterns
      if ((i === 0 && j === 0) || (i === 0 && j === coords.length - 1) || (i === coords.length - 1 && j === 0)) {
        continue;
      }
      drawAlignmentPattern(modules, isFunc, r, c);
    }
  }

  // Reserve Format Info areas (actual bits written per mask)
  for (let i = 0; i <= 8; i++) {
    isFunc[8][i] = true;
    isFunc[i][8] = true;
  }
  for (let i = 0; i < 8; i++) {
    isFunc[8][size - 1 - i] = true;
  }
  for (let i = 0; i < 7; i++) {
    isFunc[size - 1 - i][8] = true;
  }

  // Fixed Dark Module at (4*version + 9, 8)
  modules[4 * version + 9][8] = true;
  isFunc[4 * version + 9][8] = true;

  // Version Information (V7..V10)
  if (version >= 7) {
    const vBits = computeVersionBits(version);
    for (let i = 0; i < 18; i++) {
      const bit = ((vBits >>> i) & 1) === 1;
      const a = Math.floor(i / 3);
      const b = size - 11 + (i % 3);
      modules[a][b] = bit;
      isFunc[a][b] = true;
      modules[b][a] = bit;
      isFunc[b][a] = true;
    }
  }

  return { modules, isFunc };
}

function writeFormatInfo(modules: boolean[][], ecLevel: QrEcLevel, mask: number): void {
  const size = modules.length;
  const bits = computeFormatBits(ecLevel, mask);

  // First copy around top-left finder
  for (let i = 0; i <= 5; i++) modules[8][i] = ((bits >>> (14 - i)) & 1) === 1;
  modules[8][7] = ((bits >>> 8) & 1) === 1;
  modules[8][8] = ((bits >>> 7) & 1) === 1;
  modules[7][8] = ((bits >>> 6) & 1) === 1;
  for (let i = 0; i <= 5; i++) modules[5 - i][8] = ((bits >>> (5 - i)) & 1) === 1;

  // Second copy across bottom-left & top-right finders
  for (let i = 0; i < 7; i++) modules[size - 1 - i][8] = ((bits >>> (14 - i)) & 1) === 1;
  for (let i = 0; i < 8; i++) modules[8][size - 8 + i] = ((bits >>> (7 - i)) & 1) === 1;
}

function placeDataCodewords(modules: boolean[][], isFunc: boolean[][], codewords: Uint8Array): void {
  const size = modules.length;
  let bitIndex = 0;
  const totalBits = codewords.length * 8;
  let upward = true;

  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5; // Skip vertical timing column
    for (let step = 0; step < size; step++) {
      const r = upward ? size - 1 - step : step;
      for (let dc = 0; dc < 2; dc++) {
        const c = right - dc;
        if (isFunc[r][c]) continue;
        let dark = false;
        if (bitIndex < totalBits) {
          dark = ((codewords[bitIndex >>> 3] >>> (7 - (bitIndex & 7))) & 1) === 1;
        }
        modules[r][c] = dark;
        bitIndex++;
      }
    }
    upward = !upward;
  }
}

function maskCondition(mask: number, r: number, c: number): boolean {
  switch (mask) {
    case 0: return (r + c) % 2 === 0;
    case 1: return r % 2 === 0;
    case 2: return c % 3 === 0;
    case 3: return (r + c) % 3 === 0;
    case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
    case 5: return ((r * c) % 2) + ((r * c) % 3) === 0;
    case 6: return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
    case 7: return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
    default: return false;
  }
}

function applyMask(baseModules: boolean[][], isFunc: boolean[][], mask: number): boolean[][] {
  const size = baseModules.length;
  const out = createGrid(size, false);
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      out[r][c] = isFunc[r][c] ? baseModules[r][c] : baseModules[r][c] !== maskCondition(mask, r, c);
    }
  }
  return out;
}

function scorePenalty(modules: boolean[][]): number {
  const size = modules.length;
  let penalty = 0;

  // Rule 1: 5+ same-colored consecutive modules in rows and columns
  for (let r = 0; r < size; r++) {
    let runColor = modules[r][0];
    let runLen = 1;
    for (let c = 1; c < size; c++) {
      if (modules[r][c] === runColor) {
        runLen++;
      } else {
        if (runLen >= 5) penalty += 3 + (runLen - 5);
        runColor = modules[r][c];
        runLen = 1;
      }
    }
    if (runLen >= 5) penalty += 3 + (runLen - 5);
  }
  for (let c = 0; c < size; c++) {
    let runColor = modules[0][c];
    let runLen = 1;
    for (let r = 1; r < size; r++) {
      if (modules[r][c] === runColor) {
        runLen++;
      } else {
        if (runLen >= 5) penalty += 3 + (runLen - 5);
        runColor = modules[r][c];
        runLen = 1;
      }
    }
    if (runLen >= 5) penalty += 3 + (runLen - 5);
  }

  // Rule 2: 2x2 blocks of same color
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const col = modules[r][c];
      if (col === modules[r][c + 1] && col === modules[r + 1][c] && col === modules[r + 1][c + 1]) {
        penalty += 3;
      }
    }
  }

  // Rule 3: Finder-like 1:1:3:1:1 patterns with 4 light modules on either side
  const isPat = (arr: boolean[], i: number): boolean => {
    // 10111010000 or 00001011101
    if (i + 10 >= arr.length) return false;
    const a =
      arr[i] && !arr[i + 1] && arr[i + 2] && arr[i + 3] && arr[i + 4] && !arr[i + 5] && arr[i + 6] &&
      !arr[i + 7] && !arr[i + 8] && !arr[i + 9] && !arr[i + 10];
    const b =
      !arr[i] && !arr[i + 1] && !arr[i + 2] && !arr[i + 3] &&
      arr[i + 4] && !arr[i + 5] && arr[i + 6] && arr[i + 7] && arr[i + 8] && !arr[i + 9] && arr[i + 10];
    return a || b;
  };
  for (let r = 0; r < size; r++) {
    for (let c = 0; c <= size - 11; c++) {
      if (isPat(modules[r], c)) penalty += 40;
    }
  }
  const colBuf: boolean[] = new Array(size);
  for (let c = 0; c < size; c++) {
    for (let r = 0; r < size; r++) colBuf[r] = modules[r][c];
    for (let r = 0; r <= size - 11; r++) {
      if (isPat(colBuf, r)) penalty += 40;
    }
  }

  // Rule 4: Dark/light ratio balance
  let darkCount = 0;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (modules[r][c]) darkCount++;
    }
  }
  const total = size * size;
  const k = Math.floor(Math.abs(darkCount * 20 - total * 10) / total);
  penalty += k * 10;

  return penalty;
}

/**
 * Encodes an arbitrary UTF-8 string into a standards-compliant ISO/IEC 18004 QR matrix.
 */
export function encodeQrMatrix(text: string, preferredEc: QrEcLevel = 'M'): QrMatrixResult {
  const payload = String(text ?? '');
  const bytes = utf8Bytes(payload);
  const { version, ecLevel, spec } = chooseVersionAndEc(bytes.length, preferredEc);
  const dataCws = buildDataCodewords(bytes, version, spec[0]);
  const fullCodewords = buildInterleavedCodewords(dataCws, spec);

  const { modules: baseModules, isFunc } = drawFunctionPatterns(version);
  placeDataCodewords(baseModules, isFunc, fullCodewords);

  let bestMask = 0;
  let bestScore = Infinity;
  let bestModules = baseModules;

  for (let mask = 0; mask < 8; mask++) {
    const candidate = applyMask(baseModules, isFunc, mask);
    writeFormatInfo(candidate, ecLevel, mask);
    const score = scorePenalty(candidate);
    if (score < bestScore) {
      bestScore = score;
      bestMask = mask;
      bestModules = candidate;
    }
  }

  return {
    version,
    ecLevel,
    size: bestModules.length,
    mask: bestMask,
    modules: bestModules,
  };
}

function escapeXmlAttr(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Renders a scannable, camera-friendly SVG QR Code with a full 4-module white Quiet Zone
 * and single unified SVG path (zero subpixel seams on high-DPI mobile screens).
 */
export function renderQrSvg(text: string, opts: QrSvgOptions = {}): string {
  const qr = encodeQrMatrix(text, 'M');
  const quiet = Math.max(4, Math.floor(opts.quietZone ?? 4));
  const sizePx = Math.max(120, Math.round(opts.sizePx ?? 168));
  const darkColor = opts.darkColor || '#000000';
  const lightColor = opts.lightColor || '#ffffff';
  const ariaLabel = escapeXmlAttr(opts.title || 'رمز QR للانضمام إلى الفريق');

  const vb = qr.size + quiet * 2;
  const pathParts: string[] = [];

  for (let r = 0; r < qr.size; r++) {
    let c = 0;
    while (c < qr.size) {
      if (!qr.modules[r][c]) {
        c++;
        continue;
      }
      const startC = c;
      while (c < qr.size && qr.modules[r][c]) c++;
      const runW = c - startC;
      pathParts.push(`M${startC + quiet},${r + quiet}h${runW}v1h-${runW}z`);
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${vb} ${vb}" width="${sizePx}" height="${sizePx}" shape-rendering="crispEdges" role="img" aria-label="${ariaLabel}"><rect width="${vb}" height="${vb}" fill="${escapeXmlAttr(lightColor)}"/><path d="${pathParts.join('')}" fill="${escapeXmlAttr(darkColor)}"/></svg>`;
}

if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).MaydanQr = {
    encodeQrMatrix,
    renderQrSvg,
  };
}

import type { PitchSizeId, TacticalArrow, TacticalKeyframe, TacticalSequence } from '../tacticsData';
import {
  clampNumber,
  clampPitchPoint,
  distanceMeters,
  estimateArrivalTimeSec,
  estimateBallTravelTimeSec,
  type PitchPoint,
} from './tacticalGeometry';

export const GHOST_HASH_PREFIX = '#ghost=v1.';
export const MAX_GHOST_HASH_LENGTH = 2200;
export const MAX_GHOST_FRAMES = 16;

const VALID_SIZES: PitchSizeId[] = ['5v5', '6v6', '7v7', '11v11'];
const SIZE_TO_CODE: Record<PitchSizeId, number> = { '5v5': 0, '6v6': 1, '7v7': 2, '11v11': 3 };
const CODE_TO_SIZE: PitchSizeId[] = ['5v5', '6v6', '7v7', '11v11'];

export interface GhostFrameV1 {
  our: PitchPoint[];
  opp: PitchPoint[];
  ball: PitchPoint;
  durationMs: number;
  note?: string;
}

export interface GhostPlayV1 {
  v: 1;
  size: PitchSizeId;
  formationId: string;
  title: string;
  frames: GhostFrameV1[];
}

export interface GhostEncodeResult {
  ok: boolean;
  hash?: string;
  tooLarge?: boolean;
  length?: number;
  fallbackJson: string;
  reasonAr?: string;
}

export interface GhostDecodeResult {
  ok: boolean;
  play?: GhostPlayV1;
  errorAr?: string;
}

export type InterceptVerdict = 'safe' | 'risky' | 'intercepted' | 'dribble';

export interface GhostPassInterceptAnalysis {
  isPass: boolean;
  passDistanceM: number;
  ballTimeSec: number;
  defenderInterceptTimeSec: number;
  marginSec: number;
  interceptorIdx: number | null;
  interceptPoint: PitchPoint | null;
  verdict: InterceptVerdict;
  summaryAr: string;
  disclaimerAr: string;
}

function sanitizeText(raw: unknown, maxLen: number): string {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/[<>"'`\u0000-\u001F\u007F]/g, '')
    .trim()
    .slice(0, maxLen);
}

function isPointLike(v: unknown): v is { x: number; y: number } {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as { x?: unknown }).x === 'number' &&
    typeof (v as { y?: unknown }).y === 'number' &&
    Number.isFinite((v as { x: number }).x) &&
    Number.isFinite((v as { y: number }).y)
  );
}

/**
 * Validates and clamps any untrusted GhostPlay payload (from URL hash or JSON import).
 */
export function sanitizeGhostPlayPayload(input: unknown): GhostPlayV1 | null {
  if (!input || typeof input !== 'object') return null;
  const obj = input as Record<string, unknown>;
  if (obj.v !== 1) return null;

  const size = VALID_SIZES.includes(obj.size as PitchSizeId) ? (obj.size as PitchSizeId) : '6v6';
  const formationId = sanitizeText(obj.formationId, 24) || '2-2-1';
  const title = sanitizeText(obj.title, 60) || 'خطة شبح تكتيكية';

  if (!Array.isArray(obj.frames) || obj.frames.length < 2) return null;
  const rawFrames = obj.frames.slice(0, MAX_GHOST_FRAMES);
  const frames: GhostFrameV1[] = [];

  for (const rf of rawFrames) {
    if (!rf || typeof rf !== 'object') return null;
    const f = rf as Record<string, unknown>;
    if (!Array.isArray(f.our) || !Array.isArray(f.opp) || !isPointLike(f.ball)) return null;
    if (f.our.length < 4 || f.our.length > 11 || f.opp.length < 4 || f.opp.length > 11) return null;

    const our: PitchPoint[] = [];
    for (const p of f.our) {
      if (!isPointLike(p)) return null;
      our.push(clampPitchPoint(p, 3));
    }
    const opp: PitchPoint[] = [];
    for (const p of f.opp) {
      if (!isPointLike(p)) return null;
      opp.push(clampPitchPoint(p, 3));
    }
    const ball = clampPitchPoint(f.ball, 3);
    const durationMs = Math.round(clampNumber(Number(f.durationMs) || 1800, 600, 6000));
    const note = sanitizeText(f.note, 110);

    frames.push(note ? { our, opp, ball, durationMs, note } : { our, opp, ball, durationMs });
  }

  return { v: 1, size, formationId, title, frames };
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const b64 =
    typeof btoa === 'function'
      ? btoa(binary)
      : Buffer.from(bytes).toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(b64url: string): Uint8Array | null {
  if (!b64url || !/^[A-Za-z0-9\-_]+$/.test(b64url)) return null;
  const padded = b64url.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64url.length % 4)) % 4);
  try {
    if (typeof atob === 'function') {
      const bin = atob(padded);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    }
    const buf = Buffer.from(padded, 'base64');
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  } catch {
    return null;
  }
}

function quantizeCoord(v: number): number {
  // 0..100 mapped to 0..200 (0.5% precision in a single byte)
  return Math.round(clampNumber(v, 0, 100) * 2);
}

function dequantizeCoord(b: number): number {
  return Number((clampNumber(b, 0, 200) / 2).toFixed(1));
}

/**
 * Encodes a GhostPlayV1 into a compact binary+base64url hash (`#ghost=v1.<payload>`).
 * Enforces MAX_GHOST_HASH_LENGTH and provides a safe JSON fallback when exceeded.
 */
export function encodeGhostPlayToHash(playInput: GhostPlayV1): GhostEncodeResult {
  const play = sanitizeGhostPlayPayload(playInput);
  if (!play) {
    return {
      ok: false,
      fallbackJson: '',
      reasonAr: 'بيانات الخطة غير صالحة (تحتاج لقطتين على الأقل).',
    };
  }

  const fallbackJson = JSON.stringify(play);
  const enc = new TextEncoder();
  const titleBytes = enc.encode(play.title);
  const formBytes = enc.encode(play.formationId);
  const noteBytesArr = play.frames.map((f) => enc.encode(f.note || ''));

  const ourCount = play.frames[0].our.length;
  const oppCount = play.frames[0].opp.length;

  // Compute exact byte length
  let totalBytes = 6 + titleBytes.length + formBytes.length;
  for (let i = 0; i < play.frames.length; i++) {
    totalBytes += 2 + (ourCount + oppCount + 1) * 2 + 1 + noteBytesArr[i].length;
  }

  const buf = new Uint8Array(totalBytes);
  let p = 0;
  buf[p++] = 1; // version
  buf[p++] = SIZE_TO_CODE[play.size];
  buf[p++] = play.frames.length;
  buf[p++] = ourCount;
  buf[p++] = oppCount;
  buf[p++] = titleBytes.length;
  buf.set(titleBytes, p);
  p += titleBytes.length;

  // Store formationId length in next byte? Wait: allocate 1 more byte cleanly:
  const buf2 = new Uint8Array(totalBytes + 1);
  buf2.set(buf.subarray(0, p), 0);
  buf2[p++] = formBytes.length;
  buf2.set(formBytes, p);
  p += formBytes.length;

  for (let i = 0; i < play.frames.length; i++) {
    const f = play.frames[i];
    const durUnits = Math.round(clampNumber(f.durationMs, 600, 6000) / 100); // 6..60
    buf2[p++] = durUnits;
    for (let k = 0; k < ourCount; k++) {
      const pt = f.our[k] || f.our[f.our.length - 1];
      buf2[p++] = quantizeCoord(pt.x);
      buf2[p++] = quantizeCoord(pt.y);
    }
    for (let k = 0; k < oppCount; k++) {
      const pt = f.opp[k] || f.opp[f.opp.length - 1];
      buf2[p++] = quantizeCoord(pt.x);
      buf2[p++] = quantizeCoord(pt.y);
    }
    buf2[p++] = quantizeCoord(f.ball.x);
    buf2[p++] = quantizeCoord(f.ball.y);
    const nb = noteBytesArr[i];
    buf2[p++] = Math.min(255, nb.length);
    if (nb.length > 0) {
      buf2.set(nb.subarray(0, Math.min(255, nb.length)), p);
      p += Math.min(255, nb.length);
    }
  }

  const encoded = bytesToBase64Url(buf2.subarray(0, p));
  const hash = `${GHOST_HASH_PREFIX}${encoded}`;

  if (hash.length > MAX_GHOST_HASH_LENGTH) {
    return {
      ok: false,
      tooLarge: true,
      length: hash.length,
      fallbackJson,
      reasonAr: 'الخطة كبيرة جداً للرابط المختصر — استخدم خيار نسخ JSON المحلي.',
    };
  }

  return {
    ok: true,
    hash,
    length: hash.length,
    fallbackJson,
  };
}

/**
 * Extracts raw ghost hash token ONLY when hash begins with `#ghost=v1.`.
 * Guaranteed never to interfere with `#join=`, `?join=`, or `?ref=`.
 */
export function extractGhostHashPayload(hashOrUrl: string): string | null {
  if (typeof hashOrUrl !== 'string' || !hashOrUrl) return null;
  const idx = hashOrUrl.indexOf(GHOST_HASH_PREFIX);
  if (idx < 0) return null;
  const tail = hashOrUrl.slice(idx + GHOST_HASH_PREFIX.length);
  const clean = tail.split('&')[0].trim();
  if (!clean || clean.length > MAX_GHOST_HASH_LENGTH) return null;
  return clean;
}

/**
 * Decodes and strictly validates a `#ghost=v1.<payload>` string or full URL.
 */
export function decodeGhostPlayFromHash(hashOrUrl: string): GhostDecodeResult {
  const token = extractGhostHashPayload(hashOrUrl);
  if (!token) {
    return { ok: false, errorAr: 'رابط الشبح غير صالح أو غير مكتمل.' };
  }
  const bytes = base64UrlToBytes(token);
  if (!bytes || bytes.length < 16) {
    return { ok: false, errorAr: 'تعذّر قراءة بيانات رابط الشبح.' };
  }

  try {
    const dec = new TextDecoder();
    let p = 0;
    const version = bytes[p++];
    if (version !== 1) return { ok: false, errorAr: 'إصدار رابط الشبح غير مدعوم.' };
    const sizeCode = bytes[p++];
    const size = CODE_TO_SIZE[sizeCode];
    if (!size) return { ok: false, errorAr: 'حجم الملعب في رابط الشبح غير صالح.' };

    const frameCount = bytes[p++];
    const ourCount = bytes[p++];
    const oppCount = bytes[p++];
    if (
      frameCount < 2 ||
      frameCount > MAX_GHOST_FRAMES ||
      ourCount < 4 ||
      ourCount > 11 ||
      oppCount < 4 ||
      oppCount > 11
    ) {
      return { ok: false, errorAr: 'بنية لقطات رابط الشبح غير صالحة.' };
    }

    const titleLen = bytes[p++];
    if (p + titleLen >= bytes.length) return { ok: false, errorAr: 'عنوان الخطة تالف.' };
    const title = dec.decode(bytes.subarray(p, p + titleLen));
    p += titleLen;

    const formLen = bytes[p++];
    if (p + formLen >= bytes.length) return { ok: false, errorAr: 'معرّف التشكيلة تالف.' };
    const formationId = dec.decode(bytes.subarray(p, p + formLen));
    p += formLen;

    const frames: GhostFrameV1[] = [];
    for (let i = 0; i < frameCount; i++) {
      if (p + 1 + (ourCount + oppCount + 1) * 2 + 1 > bytes.length) {
        return { ok: false, errorAr: 'لقطات رابط الشبح مبتورة.' };
      }
      const durationMs = bytes[p++] * 100;
      const our: PitchPoint[] = [];
      for (let k = 0; k < ourCount; k++) {
        our.push({ x: dequantizeCoord(bytes[p++]), y: dequantizeCoord(bytes[p++]) });
      }
      const opp: PitchPoint[] = [];
      for (let k = 0; k < oppCount; k++) {
        opp.push({ x: dequantizeCoord(bytes[p++]), y: dequantizeCoord(bytes[p++]) });
      }
      const ball: PitchPoint = { x: dequantizeCoord(bytes[p++]), y: dequantizeCoord(bytes[p++]) };
      const noteLen = bytes[p++];
      if (p + noteLen > bytes.length) return { ok: false, errorAr: 'ملاحظة اللقطة مبتورة.' };
      const note = noteLen > 0 ? dec.decode(bytes.subarray(p, p + noteLen)) : '';
      p += noteLen;

      frames.push(note ? { our, opp, ball, durationMs, note } : { our, opp, ball, durationMs });
    }

    const sanitized = sanitizeGhostPlayPayload({
      v: 1,
      size,
      formationId,
      title,
      frames,
    });
    if (!sanitized) return { ok: false, errorAr: 'فشل التحقق من صحة بيانات الخطة.' };
    return { ok: true, play: sanitized };
  } catch {
    return { ok: false, errorAr: 'تعذّر فك ترميز رابط الشبح.' };
  }
}

/**
 * Computes simplified geometric Time-to-Intercept for a pass transition between two frames.
 * Used live during Ghost Play playback and Challenge Mode defender adjustments.
 */
export function analyzeGhostPassIntercept(
  fromFrame: GhostFrameV1,
  toFrame: GhostFrameV1,
  size: PitchSizeId = '6v6',
  overrideOpp?: PitchPoint[]
): GhostPassInterceptAnalysis {
  const disclaimerAr = 'تقدير هندسي مبسّط لمقارنة زمن الكرة مع زمن وصول أقرب مدافع.';
  const passDistanceM = distanceMeters(fromFrame.ball, toFrame.ball, size);

  if (passDistanceM < 2.2) {
    return {
      isPass: false,
      passDistanceM: Number(passDistanceM.toFixed(1)),
      ballTimeSec: 0,
      defenderInterceptTimeSec: 0,
      marginSec: 0,
      interceptorIdx: null,
      interceptPoint: null,
      verdict: 'dribble',
      summaryAr: 'تحرك/تثبيت بالكرة — لا توجد تمريرة طويلة في هذه اللقطة',
      disclaimerAr,
    };
  }

  const defenders = overrideOpp && overrideOpp.length ? overrideOpp : fromFrame.opp;
  const ballTimeSec = estimateBallTravelTimeSec(fromFrame.ball, toFrame.ball, size);

  let worstMargin = Infinity;
  let bestDefTime = Infinity;
  let interceptorIdx: number | null = null;
  let interceptPoint: PitchPoint | null = null;

  const samples = 10;
  for (let s = 1; s <= samples; s++) {
    const frac = 0.16 + (s / samples) * 0.8;
    const pt: PitchPoint = {
      x: fromFrame.ball.x + (toFrame.ball.x - fromFrame.ball.x) * frac,
      y: fromFrame.ball.y + (toFrame.ball.y - fromFrame.ball.y) * frac,
    };
    const ballT = estimateBallTravelTimeSec(fromFrame.ball, pt, size);
    for (let d = 0; d < defenders.length; d++) {
      const defStart = defenders[d];
      const defEnd = toFrame.opp[d] || defStart;
      // Blend slightly toward defender's movement intent if not overridden
      const refDef = overrideOpp
        ? defStart
        : {
            x: defStart.x + (defEnd.x - defStart.x) * 0.2,
            y: defStart.y + (defEnd.y - defStart.y) * 0.2,
          };
      const defT = Math.max(0, estimateArrivalTimeSec(refDef, pt, size) - 0.1);
      const margin = defT - ballT;
      if (margin < worstMargin) {
        worstMargin = margin;
        bestDefTime = defT;
        interceptorIdx = d;
        interceptPoint = pt;
      }
    }
  }

  let verdict: InterceptVerdict = 'safe';
  let summaryAr = `تمريرة آمنة ✓ • زمن الكرة ${ballTimeSec.toFixed(2)}ث مقابل وصول المدافع ${bestDefTime.toFixed(2)}ث`;
  if (worstMargin < 0.03) {
    verdict = 'intercepted';
    summaryAr = `تم اعتراض التمريرة ✕ • المدافع #${(interceptorIdx ?? 0) + 1} يسبق الكرة بـ ${Math.abs(worstMargin).toFixed(2)}ث`;
  } else if (worstMargin < 0.28) {
    verdict = 'risky';
    summaryAr = `تمريرة خطرة ⚠ • هامش الأمان ${worstMargin.toFixed(2)}ث فقط أمام المدافع #${(interceptorIdx ?? 0) + 1}`;
  }

  return {
    isPass: true,
    passDistanceM: Number(passDistanceM.toFixed(1)),
    ballTimeSec: Number(ballTimeSec.toFixed(2)),
    defenderInterceptTimeSec: Number.isFinite(bestDefTime) ? Number(bestDefTime.toFixed(2)) : 9.9,
    marginSec: Number.isFinite(worstMargin) ? Number(worstMargin.toFixed(2)) : 2.5,
    interceptorIdx,
    interceptPoint,
    verdict,
    summaryAr,
    disclaimerAr,
  };
}

/**
 * Converts a GhostPlayV1 into the existing TacticalSequence contract so `src/tacticsEngine.ts`
 * animates it natively with zero duplicate animation engine!
 */
export function ghostPlayToTacticalSequence(play: GhostPlayV1): TacticalSequence {
  const frames: TacticalKeyframe[] = play.frames.map((f, idx) => {
    const next = play.frames[idx + 1];
    const arrows: TacticalArrow[] = [];
    if (next) {
      if (distanceMeters(f.ball, next.ball, play.size) >= 1.8) {
        arrows.push({ from: [f.ball.x, f.ball.y], to: [next.ball.x, next.ball.y], kind: 'ball' });
      }
      f.our.forEach((p, i) => {
        const np = next.our[i];
        if (np && Math.hypot(np.x - p.x, np.y - p.y) >= 4.5) {
          arrows.push({ from: [p.x, p.y], to: [np.x, np.y], kind: 'run' });
        }
      });
    }
    return {
      title: `اللقطة ${idx + 1}`,
      narration: f.note || `المرحلة ${idx + 1} من خطة الشبح`,
      durationMs: f.durationMs,
      ourPos: f.our.map((p) => ({ ...p })),
      oppPos: f.opp.map((p) => ({ ...p })),
      ball: { ...f.ball },
      activeIndices: [],
      arrows,
    };
  });

  return {
    id: `ghost_${play.formationId}_${frames.length}`,
    title: play.title,
    subtitle: `خطة شبح (${play.size}) • ${frames.length} لقطات`,
    size: play.size,
    offsideEnabled: play.size === '11v11',
    frames,
  };
}

/**
 * Builds a GhostPlayV1 from existing recorded or scenario TacticalKeyframes.
 */
export function tacticalFramesToGhostPlay(
  frames: TacticalKeyframe[],
  meta: { size: PitchSizeId; formationId: string; title: string }
): GhostPlayV1 | null {
  if (!frames || frames.length < 2) return null;
  return sanitizeGhostPlayPayload({
    v: 1,
    size: meta.size,
    formationId: meta.formationId,
    title: meta.title,
    frames: frames.slice(0, MAX_GHOST_FRAMES).map((f) => ({
      our: f.ourPos.map((p) => ({ x: p.x, y: p.y })),
      opp: f.oppPos.map((p) => ({ x: p.x, y: p.y })),
      ball: { x: f.ball.x, y: f.ball.y },
      durationMs: f.durationMs || 1800,
      note: f.narration || f.title || '',
    })),
  });
}

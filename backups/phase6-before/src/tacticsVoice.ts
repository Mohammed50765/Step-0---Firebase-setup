export interface VoiceCandidate {
  name: string;
  lang: string;
  localService?: boolean;
  default?: boolean;
}

const ARABIC_LOCALE_PRIORITY = ['ar-sa', 'ar-ae', 'ar-eg', 'ar-jo', 'ar-kw', 'ar-qa', 'ar-001', 'ar'];

const POSITION_SPOKEN_MAP: Record<string, string> = {
  GK: 'حارس المرمى',
  CB: 'قلب الدفاع',
  LB: 'المدافع الأيسر',
  RB: 'المدافع الأيمن',
  DM: 'لاعب الارتكاز',
  CDM: 'لاعب الارتكاز',
  CM: 'لاعب الوسط',
  LM: 'الوسط الأيسر',
  RM: 'الوسط الأيمن',
  CAM: 'صانع اللعب',
  LW: 'الجناح الأيسر',
  RW: 'الجناح الأيمن',
  ST: 'المهاجم',
  CF: 'المهاجم',
};

const DIGIT_WORDS_AR: Record<string, string> = {
  '1': 'واحد',
  '2': 'اثنين',
  '3': 'ثلاثة',
  '4': 'أربعة',
  '5': 'خمسة',
};

/**
 * Ranks available browser SpeechSynthesis voices and selects the most natural Arabic voice.
 * Prefers Gulf/MSA locales (ar-SA, ar-AE, ar-EG...) and local on-device voices over remote robotic fallbacks.
 */
export function pickBestArabicVoice<T extends VoiceCandidate>(voices: ReadonlyArray<T>): T | null {
  if (!voices || voices.length === 0) return null;

  const arabicVoices = voices.filter((v) => String(v.lang || '').toLowerCase().startsWith('ar'));
  if (arabicVoices.length === 0) return null;

  let best: T = arabicVoices[0];
  let bestScore = -1;

  for (const v of arabicVoices) {
    const lang = String(v.lang || '').toLowerCase().replace('_', '-');
    const name = String(v.name || '').toLowerCase();
    let score = 10;

    const exactIdx = ARABIC_LOCALE_PRIORITY.indexOf(lang);
    if (exactIdx >= 0) {
      score += (ARABIC_LOCALE_PRIORITY.length - exactIdx) * 10;
    } else if (lang.startsWith('ar-')) {
      score += 5;
    }

    if (v.localService) score += 12;
    if (name.includes('enhanced') || name.includes('premium') || name.includes('natural') || name.includes('maged') || name.includes('tarik') || name.includes('laila')) {
      score += 15;
    }

    if (score > bestScore) {
      bestScore = score;
      best = v;
    }
  }

  return best;
}

/**
 * Normalizes tactical Arabic text before sending to Web Speech API so the synthesizer
 * speaks natural football Arabic instead of reading emojis or raw Latin formation tokens.
 */
export function prepareArabicNarrationText(rawText: string): string {
  if (!rawText) return '';

  let out = rawText
    // Strip Unicode directional isolates and decorative emojis/symbols
    .replace(/[\u2066-\u2069\u200E\u200F]/g, '')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\uFE0F]/gu, ' ')
    .replace(/[⚠️✓✅❌⚡🔥🎯🛡️⚔️🔄🚩🎥👑💡📐🧤]/g, ' ');

  // Speak pitch sizes naturally in Arabic
  out = out
    .replace(/\b5v5\b/gi, 'خمسة ضد خمسة')
    .replace(/\b6v6\b/gi, 'ستة ضد ستة')
    .replace(/\b7v7\b/gi, 'سبعة ضد سبعة')
    .replace(/\b11v11\b/gi, 'أحد عشر ضد أحد عشر');

  // Speak formation numbers naturally (e.g. 2-2-1 -> اثنين اثنين واحد)
  out = out.replace(/\b([1-5])-([1-5])-([1-5])(?:-([1-5]))?\b/g, (_, a, b, c, d) => {
    const parts = [a, b, c, d].filter(Boolean).map((n: string) => DIGIT_WORDS_AR[n] || n);
    return parts.join(' ');
  });

  // Replace Latin football position codes with Arabic equivalents
  out = out.replace(/\b(GK|CB|LB|RB|CDM|DM|CAM|CM|LM|RM|LW|RW|ST|CF)\b/g, (m) => POSITION_SPOKEN_MAP[m] || m);

  // Clean extra punctuation and whitespace
  return out
    .replace(/[•|]/g, '، ')
    .replace(/\s*—\s*/g, '، ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Clamps playback speed into a comfortable Arabic SpeechSynthesis cadence [0.82 .. 1.32].
 */
export function computeSpeechRate(playbackSpeed: number): number {
  const s = Number.isFinite(playbackSpeed) ? playbackSpeed : 1;
  // Slightly gentler curve so 0.5x stays intelligible (0.82) and 1.5x isn't rushed (1.26)
  const mapped = 0.96 + (s - 1) * 0.52;
  return Number(Math.max(0.82, Math.min(1.32, mapped)).toFixed(2));
}

/**
 * Estimates a generous safety timeout (in ms) so mobile browsers that drop `utter.onend`
 * never freeze timeline playback permanently.
 */
export function estimateSpeechTimeoutMs(cleanText: string, rate: number): number {
  const safeRate = Math.max(0.75, rate || 1);
  const chars = Math.max(1, cleanText.length);
  const est = Math.round((chars * 92) / safeRate) + 1400;
  return Math.max(4200, Math.min(12500, est));
}

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  pickBestArabicVoice,
  prepareArabicNarrationText,
  computeSpeechRate,
  estimateSpeechTimeoutMs,
} from './tacticsVoice';

test('pickBestArabicVoice ranks local Arabic Gulf/MSA voices above remote and ignores non-Arabic', () => {
  assert.equal(pickBestArabicVoice([]), null);
  assert.equal(pickBestArabicVoice([{ name: 'Samantha', lang: 'en-US', localService: true }]), null);

  const picked = pickBestArabicVoice([
    { name: 'English US', lang: 'en-US', localService: true },
    { name: 'Google Arabic Remote', lang: 'ar-EG', localService: false },
    { name: 'Maged Enhanced', lang: 'ar-SA', localService: true },
    { name: 'Arabic Generic', lang: 'ar', localService: false },
  ]);
  assert.equal(picked?.name, 'Maged Enhanced');
});

test('prepareArabicNarrationText cleans emojis and expands 6v6, formations, and position codes into natural Arabic', () => {
  const raw = '⚽ في 6v6 بخطة 2-2-1: يمرر GK إلى CAM ثم ينطلق ST 🔥';
  const cleaned = prepareArabicNarrationText(raw);

  assert.ok(!cleaned.includes('⚽'));
  assert.ok(!cleaned.includes('🔥'));
  assert.ok(cleaned.includes('ستة ضد ستة'));
  assert.ok(cleaned.includes('اثنين اثنين واحد'));
  assert.ok(cleaned.includes('حارس المرمى'));
  assert.ok(cleaned.includes('صانع اللعب'));
  assert.ok(cleaned.includes('المهاجم'));
});

test('computeSpeechRate and estimateSpeechTimeoutMs stay within safe readable bounds', () => {
  assert.ok(computeSpeechRate(0.5) >= 0.82 && computeSpeechRate(0.5) <= 0.9);
  assert.equal(computeSpeechRate(1), 0.96);
  assert.ok(computeSpeechRate(1.5) <= 1.32 && computeSpeechRate(1.5) >= 1.15);

  const shortMs = estimateSpeechTimeoutMs('تمريرة سريعة', 1);
  const longMs = estimateSpeechTimeoutMs('أ'.repeat(400), 1);
  assert.ok(shortMs >= 4200 && shortMs <= 6000);
  assert.equal(longMs, 12500);
});

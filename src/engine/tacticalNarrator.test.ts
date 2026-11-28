import test from 'node:test';
import assert from 'node:assert/strict';
import {
  pickDocumentaryMaleArabicVoice,
  computeDocumentaryVoiceParams,
  computeAmbientGain,
  TacticalNeuralNarrator,
} from './tacticalNarrator';

test('pickDocumentaryMaleArabicVoice prefers male natural Arabic voices over female or non-Arabic voices', () => {
  const picked = pickDocumentaryMaleArabicVoice([
    { name: 'Google US English', lang: 'en-US', localService: false },
    { name: 'Laila', lang: 'ar-SA', localService: true },
    { name: 'Maged (Enhanced)', lang: 'ar-SA', localService: true },
    { name: 'Salma Natural', lang: 'ar-EG', localService: false },
  ]);
  assert.ok(picked);
  assert.equal(picked.name, 'Maged (Enhanced)');

  assert.equal(pickDocumentaryMaleArabicVoice([{ name: 'Alex', lang: 'en-US' }]), null);
  assert.equal(pickDocumentaryMaleArabicVoice([]), null);
});

test('computeDocumentaryVoiceParams enforces calm moderate pace and warm lower pitch', () => {
  const normal = computeDocumentaryVoiceParams(1);
  assert.equal(normal.rate, 0.93);
  assert.equal(normal.pitch, 0.92);

  const clampedHigh = computeDocumentaryVoiceParams(4);
  assert.ok(clampedHigh.rate <= 1.12);

  const clampedLow = computeDocumentaryVoiceParams(0.1);
  assert.ok(clampedLow.rate >= 0.84);
});

test('computeAmbientGain ducks background music during speech and zeroes when muted or disabled', () => {
  const idle = computeAmbientGain({ muted: false, musicEnabled: true, volume: 1, isSpeaking: false });
  const speaking = computeAmbientGain({ muted: false, musicEnabled: true, volume: 1, isSpeaking: true });
  assert.ok(idle > speaking, 'Ambient pad must duck lower while narrator is speaking');
  assert.ok(speaking > 0 && speaking <= 0.015, 'Ducked music must remain whisper-quiet');

  assert.equal(computeAmbientGain({ muted: true, musicEnabled: true, volume: 1, isSpeaking: false }), 0);
  assert.equal(computeAmbientGain({ muted: false, musicEnabled: false, volume: 1, isSpeaking: false }), 0);
});

test('TacticalNeuralNarrator degrades gracefully when speech and Web Audio are unavailable', () => {
  let stateUpdates = 0;
  const narrator = new TacticalNeuralNarrator(() => {
    stateUpdates += 1;
  });

  const initial = narrator.getState();
  assert.equal(initial.userUnlocked, false);
  assert.equal(initial.muted, false);
  assert.equal(initial.speechAvailable, false);
  assert.equal(initial.webAudioAvailable, false);

  // Safe user gesture unlock & state mutations without throwing in Node/headless environments
  narrator.unlockFromUserGesture();
  assert.equal(narrator.getState().userUnlocked, true);

  narrator.speakSegment('البناء تحت الضغط يبدأ بتوسيع المساحة قبل التمريرة.');
  assert.ok(narrator.getLastSpokenText().length > 0);
  assert.equal(narrator.getState().isSpeaking, false);

  narrator.setVolume(0.5);
  assert.equal(narrator.getState().volume, 0.5);

  narrator.setMusicEnabled(true);
  assert.equal(narrator.getState().musicEnabled, true);

  narrator.toggleMute();
  assert.equal(narrator.getState().muted, true);

  narrator.pause();
  narrator.resume();
  narrator.playSoftFeedback('correct');
  narrator.dispose();

  assert.ok(stateUpdates >= 4);
});

test('TacticalNeuralNarrator never invokes window.speechSynthesis even when a fake speechSynthesis object exists on globalThis.window', () => {
  let speechSynthCalled = false;
  const g = globalThis as unknown as { window?: Record<string, unknown> };
  const prevWin = g.window;
  g.window = {
    speechSynthesis: {
      speak() {
        speechSynthCalled = true;
      },
      cancel() {
        speechSynthCalled = true;
      },
      pause() {
        speechSynthCalled = true;
      },
      resume() {
        speechSynthCalled = true;
      },
      getVoices() {
        speechSynthCalled = true;
        return [];
      },
    },
    setTimeout: ((fn: () => void) => {
      fn();
      return 1;
    }) as unknown as typeof setTimeout,
    clearTimeout: (() => {}) as unknown as typeof clearTimeout,
  };

  try {
    const narrator = new TacticalNeuralNarrator();
    narrator.unlockFromUserGesture();
    narrator.speakSegment('تحرّك الجناح يفتح زاوية التمرير في العمق.');
    narrator.pause();
    narrator.resume();
    narrator.cancelSpeech();
    narrator.dispose();
    assert.equal(speechSynthCalled, false, 'window.speechSynthesis must never be called');
  } finally {
    g.window = prevWin;
  }
});


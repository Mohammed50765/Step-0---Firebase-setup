import test from 'node:test';
import assert from 'node:assert/strict';
import {
  encodeGhostPlayToHash,
  decodeGhostPlayFromHash,
  extractGhostHashPayload,
  sanitizeGhostPlayPayload,
  analyzeGhostPassIntercept,
  ghostPlayToTacticalSequence,
  MAX_GHOST_HASH_LENGTH,
  type GhostPlayV1,
} from './ghostPlay';

function makeSampleGhostPlay(): GhostPlayV1 {
  return {
    v: 1,
    size: '6v6',
    formationId: '2-2-1',
    title: 'هجمة مثلث اليمين',
    frames: [
      {
        our: [
          { x: 50, y: 90 },
          { x: 28, y: 72 },
          { x: 72, y: 72 },
          { x: 26, y: 48 },
          { x: 76, y: 48 },
          { x: 50, y: 25 },
        ],
        opp: [
          { x: 50, y: 12 },
          { x: 32, y: 28 },
          { x: 68, y: 28 },
          { x: 30, y: 50 },
          { x: 64, y: 54 },
          { x: 50, y: 66 },
        ],
        ball: { x: 72, y: 72 },
        durationMs: 1800,
        note: 'تمريرة من المدافع الأيمن للجناح',
      },
      {
        our: [
          { x: 50, y: 90 },
          { x: 30, y: 68 },
          { x: 74, y: 62 },
          { x: 28, y: 42 },
          { x: 78, y: 38 },
          { x: 54, y: 22 },
        ],
        opp: [
          { x: 50, y: 12 },
          { x: 34, y: 28 },
          { x: 66, y: 30 },
          { x: 34, y: 48 },
          { x: 68, y: 46 },
          { x: 52, y: 60 },
        ],
        ball: { x: 78, y: 38 },
        durationMs: 1900,
        note: 'انطلاق الجناح نحو المساحة',
      },
    ],
  };
}

test('encodeGhostPlayToHash and decodeGhostPlayFromHash round-trip cleanly within size limit', () => {
  const play = makeSampleGhostPlay();
  const encoded = encodeGhostPlayToHash(play);
  assert.equal(encoded.ok, true);
  assert.ok(encoded.hash && encoded.hash.startsWith('#ghost=v1.'));
  assert.ok(encoded.hash.length < MAX_GHOST_HASH_LENGTH);

  const decoded = decodeGhostPlayFromHash(encoded.hash);
  assert.equal(decoded.ok, true);
  assert.ok(decoded.play);
  assert.equal(decoded.play.title, play.title);
  assert.equal(decoded.play.size, '6v6');
  assert.equal(decoded.play.frames.length, 2);
  assert.equal(decoded.play.frames[0].ball.x, 72);
  assert.equal(decoded.play.frames[1].ball.y, 38);
});

test('extractGhostHashPayload never collides with #join= or ?join= invite links', () => {
  assert.equal(extractGhostHashPayload('#join=ABC12345'), null);
  assert.equal(extractGhostHashPayload('https://maydan-6v6.pages.dev/?join=ABC12345&ref=XYZ'), null);
  assert.equal(extractGhostHashPayload('#other=123'), null);
});

test('sanitizeGhostPlayPayload clamps out-of-bounds coordinates and strips unsafe HTML tags', () => {
  const play = makeSampleGhostPlay();
  play.title = '<script>alert(1)</script> خطة نظيفة';
  play.frames[0].ball = { x: -50, y: 250 };
  const clean = sanitizeGhostPlayPayload(play);
  assert.ok(clean);
  assert.ok(!clean.title.includes('<script>'));
  assert.equal(clean.frames[0].ball.x, 3);
  assert.equal(clean.frames[0].ball.y, 97);
});

test('decodeGhostPlayFromHash safely rejects corrupt or truncated tokens', () => {
  assert.equal(decodeGhostPlayFromHash('#ghost=v1.!!!invalid!!!').ok, false);
  assert.equal(decodeGhostPlayFromHash('#ghost=v1.AAAA').ok, false);
  assert.equal(decodeGhostPlayFromHash('').ok, false);
});

test('Challenge Mode defender repositioning changes Time-to-Intercept verdict live', () => {
  const play = makeSampleGhostPlay();
  // Move defenders far to the left so pass along right touchline is safe
  const openOpp = play.frames[0].opp.map(() => ({ x: 15, y: 20 }));
  const safeRes = analyzeGhostPassIntercept(play.frames[0], play.frames[1], '6v6', openOpp);
  assert.equal(safeRes.isPass, true);
  assert.equal(safeRes.verdict, 'safe');

  // Now move a defender directly onto the midpoint of the right-flank pass -> intercepted!
  const blockingOpp = openOpp.map((p, i) => (i === 4 ? { x: 75, y: 55 } : p));
  const cutRes = analyzeGhostPassIntercept(play.frames[0], play.frames[1], '6v6', blockingOpp);
  assert.equal(cutRes.isPass, true);
  assert.equal(cutRes.verdict, 'intercepted');
  assert.equal(cutRes.interceptorIdx, 4);
});

test('ghostPlayToTacticalSequence adapts directly to existing TacticalSequence engine contract', () => {
  const play = makeSampleGhostPlay();
  const seq = ghostPlayToTacticalSequence(play);
  assert.equal(seq.size, '6v6');
  assert.equal(seq.frames.length, 2);
  assert.ok(seq.frames[0].arrows.some((a) => a.kind === 'ball'));
});

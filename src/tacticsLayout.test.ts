import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isolateLtrTokens,
  formatFormationHtml,
  deOverlapPositions,
  computeOpponentAlertSet,
  placeOffsideBadge,
  placeCalloutBox,
  placePlayerLabels,
  resolveYourRoleCard,
  computeSmartBallDisplayPoint,
  placeZoneLabelY,
} from './tacticsLayout';
import { getFormationDef, getRoleSpotlightSequence } from './tacticsData';

test('isolateLtrTokens isolates formation numbers and pitch sizes with LRM+LRI/PDI without double-wrapping', () => {
  const s1 = isolateLtrTokens('خطة 3-5-2 السيطرة والأطراف (11v11)');
  assert.equal(s1, 'خطة \u200E\u20663-5-2\u2069\u200E السيطرة والأطراف (\u200E\u206611v11\u2069\u200E)');
  // Idempotent
  assert.equal(isolateLtrTokens(s1), s1);

  const s2 = isolateLtrTokens('2-3-1 الكلاسيكية — 6v6');
  assert.equal(s2, '\u200E\u20662-3-1\u2069\u200E الكلاسيكية — \u200E\u20666v6\u2069\u200E');
});

test('formatFormationHtml wraps formation strings in <bdi dir="ltr"> and escapes HTML', () => {
  const html = formatFormationHtml('خطة 3-5-2 <script>x</script> (6v6)');
  assert.ok(html.includes('<bdi dir="ltr">3-5-2</bdi>'));
  assert.ok(html.includes('<bdi dir="ltr">6v6</bdi>'));
  assert.ok(!html.includes('<script>'));
});

test('deOverlapPositions separates overlapping opponent discs from our players without moving our players', () => {
  const our = [
    { x: 50, y: 50 },
    { x: 38, y: 26 },
    { x: 62, y: 26 },
  ];
  const opp = [
    { x: 50, y: 50 }, // exact overlap with our[0]
    { x: 38, y: 26 }, // exact overlap with our[1]
    { x: 62, y: 26 }, // exact overlap with our[2]
  ];
  const ourSnapshot = our.map((p) => ({ ...p }));
  const separated = deOverlapPositions(our, opp, 9);

  // Our points were never mutated
  assert.deepEqual(our, ourSnapshot);
  assert.equal(separated.length, opp.length);

  // Every opponent is now >= 8.5 units away from every one of our players
  for (const op of separated) {
    assert.ok(op.x >= 7 && op.x <= 93);
    assert.ok(op.y >= 7 && op.y <= 93);
    for (const mine of our) {
      assert.ok(Math.hypot(op.x - mine.x, op.y - mine.y) >= 8.4);
    }
  }
});

test('computeOpponentAlertSet keeps opponents calm unless holding ball or exploiting a rose gap', () => {
  const our = [{ x: 50, y: 70 }];
  const opp = [
    { x: 50, y: 15 },
    { x: 30, y: 40 },
    { x: 75, y: 55 },
  ];
  // Ball is cleanly with our player -> zero opponents alerted
  const calm = computeOpponentAlertSet(opp, { x: 50, y: 69 }, our);
  assert.equal(calm.size, 0);

  // Ball is right on opp[1] -> only opp[1] alerted
  const withBall = computeOpponentAlertSet(opp, { x: 31, y: 41 }, our);
  assert.equal(withBall.size, 1);
  assert.ok(withBall.has(1));

  // Rose danger zone over opp[2] -> opp[2] alerted
  const gapAlert = computeOpponentAlertSet(opp, { x: 50, y: 69 }, our, [
    { x: 76, y: 54, r: 8, color: 'rose', label: 'ثغرة' },
  ]);
  assert.equal(gapAlert.size, 1);
  assert.ok(gapAlert.has(2));
});

test('placeOffsideBadge avoids opponent discs near the offside line', () => {
  const offsideY = 140;
  // Place opponent directly at the right-above candidate
  const opps = [{ x: 300, y: 132 }];
  const badge = placeOffsideBadge(offsideY, opps, 360);
  // Should move away from (300, 132)
  const distToOpp = Math.hypot(300 - Math.max(badge.x, Math.min(300, badge.x + badge.w)), 132 - Math.max(badge.y, Math.min(132, badge.y + badge.h)));
  assert.ok(distToOpp >= 16);
});

test('placeCalloutBox avoids active player and keeps pointer edge on box perimeter', () => {
  const anchor = { x: 180, y: 260 };
  const obstacles = [
    anchor,
    { x: 280, y: 60 }, // blocks top-right heavily
    { x: 260, y: 70 },
  ];
  const box = placeCalloutBox(anchor, obstacles, 360, 520, 132, 74);
  assert.ok(box.x >= 18 && box.x + box.w <= 342);
  assert.ok(box.y >= 20 && box.y + box.h <= 500);
  const onPerimeter =
    box.edgeX === box.x ||
    box.edgeX === box.x + box.w ||
    box.edgeY === box.y ||
    box.edgeY === box.y + box.h;
  assert.equal(onPerimeter, true);

  // GK at bottom (180, 466) with midfield players above must place callout in lower/bottom half (short pointer, never top!)
  const gkAnchor = { x: 180, y: 466 };
  const pitchPlayers = [
    gkAnchor,
    { x: 180, y: 260 }, // CAM
    { x: 180, y: 170 }, // ST
    { x: 255, y: 380 }, // RB
  ];
  const gkBox = placeCalloutBox(gkAnchor, pitchPlayers, 360, 520, 138, 76);
  const pointerLen = Math.hypot(gkBox.edgeX - gkAnchor.x, gkBox.edgeY - gkAnchor.y);
  assert.ok(gkBox.y > 240, `Expected callout in lower half for bottom GK, got y=${gkBox.y}`);
  assert.ok(pointerLen < 170, `Expected short pointer line for GK, got len=${pointerLen.toFixed(1)}`);
});

test('computeSmartBallDisplayPoint offsets resting ball beside carrier foot and preserves in-flight coordinates', () => {
  const player = { x: 250, y: 370 };
  const resting = computeSmartBallDisplayPoint({ x: 250, y: 368 }, [player], [], 16, false, 360, 520);
  const distFromCenter = Math.hypot(resting.x - player.x, resting.y - player.y);
  assert.ok(distFromCenter >= 20, `Ball must clear player disc, got dist=${distFromCenter.toFixed(1)}`);

  const midFlight = computeSmartBallDisplayPoint({ x: 250, y: 368 }, [player], [], 16, true, 360, 520);
  assert.deepEqual(midFlight, { x: 250, y: 368 });
});

test('placeZoneLabelY keeps zone captions clear of penalty box chalk line y=438', () => {
  const safeY = placeZoneLabelY(250, 400, 25, [{ x: 250, y: 400 }], 520);
  assert.ok(Math.abs(safeY - 3 - 438) >= 10, `Label y=${safeY} should avoid penalty line y=438`);
});

test('placePlayerLabels omits empty labels and avoids overlapping nearby discs', () => {
  const labels = placePlayerLabels(
    [
      { idx: 0, cx: 180, cy: 460, label: '' }, // unassigned -> skipped!
      { idx: 1, cx: 180, cy: 260, label: 'يمان' },
    ],
    [
      { x: 180, y: 260 },
      { x: 180, y: 286 }, // disc directly beneath idx 1
    ],
    16,
    360,
    520
  );
  assert.equal(labels.length, 1);
  assert.equal(labels[0].idx, 1);
  // Because another disc is directly beneath (y=286), label flips above (y < 260)
  assert.ok(labels[0].y < 260);
});

test('resolveYourRoleCard uses real currentUser data and never invents fake OVR', () => {
  const form = getFormationDef('6v6', '2-2-1');
  const user = { id: 'u1', name: 'يمان', jersey: 10, primaryPos: 'لاعب وسط', photo: '' };
  const cardNoOvr = resolveYourRoleCard({
    form,
    assigned: [undefined, undefined, undefined, user, undefined, undefined],
    currentUser: user,
    frame: {
      title: 'تمريرة للعمق',
      narration: 'افتح زاوية تمرير بين الخطوط',
      durationMs: 2500,
      ourPos: form.slots.map((s) => ({ x: s.x, y: s.y })),
      oppPos: [],
      ball: { x: 50, y: 50 },
      activeIndices: [3],
    },
    spotlightSlotIdx: null,
    getRoleInfo: (idx) => getRoleSpotlightSequence('6v6', '2-2-1', idx),
    getPlayerOvr: () => null,
  });

  assert.equal(cardNoOvr.slotIdx, 3);
  assert.equal(cardNoOvr.isUserAssignedHere, true);
  assert.equal(cardNoOvr.playerName, 'يمان');
  assert.equal(cardNoOvr.ovr, null); // Never fabricated!
  assert.equal(cardNoOvr.duties.length, 3);

  const cardWithOvr = resolveYourRoleCard({
    form,
    assigned: [undefined, undefined, undefined, user, undefined, undefined],
    currentUser: user,
    frame: undefined,
    spotlightSlotIdx: null,
    getRoleInfo: (idx) => getRoleSpotlightSequence('6v6', '2-2-1', idx),
    getPlayerOvr: () => 84,
  });
  assert.equal(cardWithOvr.ovr, 84);
});

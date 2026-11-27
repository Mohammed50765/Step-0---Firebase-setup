import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PRO_SVG_W,
  PRO_SVG_H,
  portraitToLandscapePct,
  landscapeToPortraitPct,
  projectProClientToPortraitPct,
  clampProZoomPct,
  createHistoryState,
  pushHistorySnapshot,
  applyHistoryUndo,
  applyHistoryRedo,
  hitTestProAnnotation,
  renderFormationMiniPitchSvg,
  buildProLandscapePitchSvg,
  mapSlotToBoardPct,
  renderProAnnotationsSvgContent,
  shouldBoardOverlayInterceptPointer,
  type ProAnnotation,
  type ProBoardSnapshot,
} from './tacticsProBoard';
import { getFormationDef, getFormationPhaseSequence } from './tacticsData';

test('portraitToLandscapePct and landscapeToPortraitPct are exact lossless inverses', () => {
  const samples = [
    { x: 50, y: 90 }, // Our GK -> left goal
    { x: 22, y: 72 }, // Left defender -> upper-left
    { x: 78, y: 72 }, // Right defender -> lower-left
    { x: 50, y: 18 }, // Striker -> right goal area
  ];
  for (const pt of samples) {
    const land = portraitToLandscapePct(pt);
    const back = landscapeToPortraitPct(land);
    assert.equal(back.x, pt.x);
    assert.equal(back.y, pt.y);
  }
  const gkLand = portraitToLandscapePct({ x: 50, y: 90 });
  assert.equal(gkLand.x, 10);
  assert.equal(gkLand.y, 50);
});

test('projectProClientToPortraitPct projects scaled SVG pointer coords cleanly into canonical portrait space', () => {
  // Simulated 2x zoomed rect
  const rect = { left: 100, top: 50, width: PRO_SVG_W * 1.3, height: PRO_SVG_H * 1.3 };
  const centerPortrait = projectProClientToPortraitPct(
    rect.left + rect.width / 2,
    rect.top + rect.height / 2,
    rect
  );
  assert.ok(Math.abs(centerPortrait.x - 50) < 0.2);
  assert.ok(Math.abs(centerPortrait.y - 50) < 0.2);
});

test('undo and redo history stack preserves both player coordinates and annotations without mutation', () => {
  const s0: ProBoardSnapshot = {
    our: [{ x: 50, y: 90 }],
    opp: [{ x: 50, y: 10 }],
    ball: { x: 50, y: 50 },
    annotations: [],
  };
  const ann1: ProAnnotation = { id: 'a1', kind: 'path', x1: 20, y1: 60, x2: 70, y2: 30, color: '#FACC15' };
  const s1: ProBoardSnapshot = {
    our: [{ x: 60, y: 80 }],
    opp: [{ x: 50, y: 10 }],
    ball: { x: 55, y: 45 },
    annotations: [ann1],
  };

  let hist = createHistoryState(10);
  hist = pushHistorySnapshot(hist, s0);
  assert.equal(hist.undoStack.length, 1);
  assert.equal(hist.redoStack.length, 0);

  const undone = applyHistoryUndo(hist, s1);
  assert.ok(undone.restored);
  assert.equal(undone.restored.our[0].x, 50);
  assert.equal(undone.restored.annotations.length, 0);
  assert.equal(undone.history.redoStack.length, 1);

  const redone = applyHistoryRedo(undone.history, undone.restored);
  assert.ok(redone.restored);
  assert.equal(redone.restored.our[0].x, 60);
  assert.equal(redone.restored.annotations.length, 1);
  assert.equal(redone.restored.annotations[0].id, 'a1');
});

test('hitTestProAnnotation detects arrows, shapes, and tactical props accurately', () => {
  const anns: ProAnnotation[] = [
    { id: 'arrow1', kind: 'arrow', x1: 20, y1: 20, x2: 80, y2: 20, color: '#FFFFFF' },
    { id: 'cone1', kind: 'cone', x1: 50, y1: 50, x2: 50, y2: 50, color: '#F59E0B' },
    { id: 'zone1', kind: 'zone', x1: 60, y1: 60, x2: 85, y2: 85, color: '#38BDF8' },
  ];
  assert.equal(hitTestProAnnotation(anns, { x: 50, y: 21 }), 'arrow1');
  assert.equal(hitTestProAnnotation(anns, { x: 51, y: 49 }), 'cone1');
  assert.equal(hitTestProAnnotation(anns, { x: 72, y: 72 }), 'zone1');
  assert.equal(hitTestProAnnotation(anns, { x: 10, y: 90 }), null);
});

test('clampProZoomPct bounds zoom safely and renderFormationMiniPitchSvg renders all pitch sizes', () => {
  assert.equal(clampProZoomPct(30), 70);
  assert.equal(clampProZoomPct(100), 100);
  assert.equal(clampProZoomPct(250), 160);

  for (const sz of ['5v5', '6v6', '7v7', '11v11'] as const) {
    const form = getFormationDef(sz, '');
    const mini = renderFormationMiniPitchSvg(form);
    assert.ok(mini.includes('tac-pro-mini-pitch'));
    assert.ok(mini.includes('<circle'));
  }
});

test('buildProLandscapePitchSvg renders stadium turf, blue/red tokens, annotations, and honors display toggles', () => {
  const form = getFormationDef('6v6', '2-2-1');
  const seq = getFormationPhaseSequence('6v6', '2-2-1', 'attack');
  const frame = seq.frames[0];
  const svgWithAll = buildProLandscapePitchSvg({
    size: '6v6',
    formation: form,
    ourPortrait: frame.ourPos,
    oppPortrait: frame.oppPos,
    ballPortrait: frame.ball,
    ourNumbers: ['1', '4', '5', '7', '10', '9'],
    ourNames: ['كريم', 'زيد', 'عمر', 'يمان', 'سعد', 'فهد'],
    activeIndices: new Set([0, 4]),
    spotlightIdx: null,
    focusedIdx: null,
    dragTarget: null,
    frame,
    display: {
      showNames: true,
      showNumbers: true,
      showTacticalLines: true,
      showOpponents: true,
      showTriangles: true,
    },
    annotations: [
      { id: 'c1', kind: 'cone', x1: 30, y1: 40, x2: 30, y2: 40, color: '#F59E0B' },
    ],
    draftAnnotation: null,
    arrowRevealT: 1,
    ballLift: 0,
    reducedMotion: false,
    offsideEnabled: false,
    isMistakeCompare: false,
  });

  assert.ok(svgWithAll.includes('proBlueToken'));
  assert.ok(svgWithAll.includes('proRedToken'));
  assert.ok(svgWithAll.includes('data-pro-ann-id="c1"'));
  assert.ok(svgWithAll.includes('يمان'));
  assert.ok(svgWithAll.includes('>10<'));

  const svgHiddenLabels = buildProLandscapePitchSvg({
    size: '6v6',
    formation: form,
    ourPortrait: frame.ourPos,
    oppPortrait: frame.oppPos,
    ballPortrait: frame.ball,
    ourNumbers: ['1', '4', '5', '7', '10', '9'],
    ourNames: ['كريم', 'زيد', 'عمر', 'يمان', 'سعد', 'فهد'],
    activeIndices: new Set(),
    spotlightIdx: null,
    focusedIdx: null,
    dragTarget: null,
    frame,
    display: {
      showNames: false,
      showNumbers: false,
      showTacticalLines: false,
      showOpponents: false,
      showTriangles: false,
    },
    annotations: [],
    draftAnnotation: null,
    arrowRevealT: 1,
    ballLift: 0,
    reducedMotion: true,
    offsideEnabled: false,
    isMistakeCompare: false,
  });

  assert.ok(!svgHiddenLabels.includes('يمان'));
  assert.ok(!svgHiddenLabels.includes('tac-pro-token-opp'));
});

test('mapSlotToBoardPct keeps portrait coordinates untouched and maps landscape safely inside horizontal pitch', () => {
  const gk = { x: 50, y: 89 };
  const st = { x: 50, y: 18 };
  const lw = { x: 16, y: 38 };

  assert.deepEqual(mapSlotToBoardPct(gk, false), gk);
  assert.deepEqual(mapSlotToBoardPct(st, false), st);

  const gkLand = mapSlotToBoardPct(gk, true);
  const stLand = mapSlotToBoardPct(st, true);
  const lwLand = mapSlotToBoardPct(lw, true);

  // GK on left side, ST attacking right, both vertically centered
  assert.ok(gkLand.x < 25, `Expected GK on left, got x=${gkLand.x}`);
  assert.ok(stLand.x > 70, `Expected ST on right, got x=${stLand.x}`);
  assert.equal(gkLand.y, 50);
  assert.equal(stLand.y, 50);
  // Wide winger stays comfortably inside vertical bounds
  assert.ok(lwLand.y >= 15 && lwLand.y <= 35, `Expected wide winger inside upper lane, got y=${lwLand.y}`);
});

test('renderProAnnotationsSvgContent namespaces defs IDs cleanly and shouldBoardOverlayInterceptPointer gates tools', () => {
  const anns: ProAnnotation[] = [
    { id: 'ar1', kind: 'arrow', x1: 20, y1: 80, x2: 70, y2: 30, color: '#FFFFFF' },
    { id: 'ba1', kind: 'ball', x1: 45, y1: 50, x2: 45, y2: 50, color: '#FACC15' },
  ];
  const draft: ProAnnotation = { id: 'draft', kind: 'path', x1: 30, y1: 70, x2: 60, y2: 40, color: '#FACC15' };

  const fifaHtml = renderProAnnotationsSvgContent(anns, draft, 'fifaAnn');
  assert.ok(fifaHtml.includes('id="fifaAnnArrWhite"'));
  assert.ok(fifaHtml.includes('id="fifaAnnArrGold"'));
  assert.ok(fifaHtml.includes('id="fifaAnnFootballGrad"'));
  assert.ok(fifaHtml.includes('url(#fifaAnnArrWhite)'));
  assert.ok(fifaHtml.includes('url(#fifaAnnArrGold)'));
  assert.ok(fifaHtml.includes('url(#fifaAnnFootballGrad)'));
  assert.ok(fifaHtml.includes('data-pro-ann-id="ar1"'));
  assert.ok(fifaHtml.includes('tac-pro-draft'));

  const cinBodyOnly = renderProAnnotationsSvgContent(anns, null, 'cinAnn', { includeDefs: false });
  assert.ok(!cinBodyOnly.includes('<defs>'));
  assert.ok(cinBodyOnly.includes('url(#cinAnnArrWhite)'));

  assert.equal(shouldBoardOverlayInterceptPointer(false, 'arrow'), false);
  assert.equal(shouldBoardOverlayInterceptPointer(true, 'pointer'), false);
  assert.equal(shouldBoardOverlayInterceptPointer(true, 'move'), false);
  assert.equal(shouldBoardOverlayInterceptPointer(true, 'arrow'), true);
  assert.equal(shouldBoardOverlayInterceptPointer(true, 'erase'), true);
  assert.equal(shouldBoardOverlayInterceptPointer(true, 'cone'), true);
});


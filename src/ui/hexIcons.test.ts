import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HEX_ICON_NAMES,
  computeHexAttendanceSegments,
  renderHexIconSvg,
  renderLiveHexAttendanceSvg,
} from './hexIcons';

test('HEX-6 icon catalog ships 14 clean geometric 24x24 SVGs with stroke-width 1.5 and no emojis', () => {
  assert.ok(HEX_ICON_NAMES.length >= 12 && HEX_ICON_NAMES.length <= 15);
  for (const name of HEX_ICON_NAMES) {
    const svg = renderHexIconSvg(name);
    assert.match(svg, /viewBox="0 0 24 24"/);
    assert.match(svg, /stroke-width="1\.5"/);
    assert.match(svg, /class="hex-frame"/);
    assert.doesNotMatch(svg, /[👥📋⚽📊🪪🚦💬⚙️👑]/u);
  }

  const activeSvg = renderHexIconSvg('tactics', { active: true, size: 'lg', label: 'التكتيك' });
  assert.match(activeSvg, /is-active/);
  assert.match(activeSvg, /hex-icon--lg/);
  assert.match(activeSvg, /aria-label="التكتيك"/);
});

test('computeHexAttendanceSegments calculates exact proportional segments across diverse roster sizes', () => {
  // 3 of 6 -> exactly 3 lit edges
  const r3of6 = computeHexAttendanceSegments(3, 6);
  assert.equal(r3of6.litSegments, 3);
  assert.equal(r3of6.pct, 50);
  assert.equal(r3of6.confirmed, 3);
  assert.equal(r3of6.total, 6);
  assert.equal(r3of6.isComplete, false);

  // 4 of 7 -> proportional (round(4/7 * 6) = 3) while keeping exact 4/7 numbers
  const r4of7 = computeHexAttendanceSegments(4, 7);
  assert.equal(r4of7.litSegments, 3);
  assert.equal(r4of7.confirmed, 4);
  assert.equal(r4of7.total, 7);
  assert.equal(r4of7.pct, 57);

  // 7 of 11 -> proportional (round(7/11 * 6) = 4) while keeping exact 7/11 numbers
  const r7of11 = computeHexAttendanceSegments(7, 11);
  assert.equal(r7of11.litSegments, 4);
  assert.equal(r7of11.confirmed, 7);
  assert.equal(r7of11.total, 11);
  assert.equal(r7of11.pct, 64);

  // 0 of 6 -> 0 lit
  const r0of6 = computeHexAttendanceSegments(0, 6);
  assert.equal(r0of6.litSegments, 0);
  assert.equal(r0of6.pct, 0);

  // 6 of 6 -> all 6 lit & complete
  const r6of6 = computeHexAttendanceSegments(6, 6);
  assert.equal(r6of6.litSegments, 6);
  assert.equal(r6of6.isComplete, true);
  assert.equal(r6of6.pct, 100);

  // 0 of 0 -> safe empty state
  const rEmpty = computeHexAttendanceSegments(0, 0);
  assert.equal(rEmpty.litSegments, 0);
  assert.equal(rEmpty.total, 0);

  // Over-subscribed 8 of 6 -> clamped to 6 lit edges without corrupting real count
  const rOver = computeHexAttendanceSegments(8, 6);
  assert.equal(rOver.litSegments, 6);
  assert.equal(rOver.confirmed, 8);
  assert.equal(rOver.total, 6);
  assert.equal(rOver.isComplete, true);
});

test('renderLiveHexAttendanceSvg emits 6 discrete line segments with exact data-lit flags', () => {
  const svg = renderLiveHexAttendanceSvg(7, 11);
  const litMatches = svg.match(/data-lit="1"/g) || [];
  const unlitMatches = svg.match(/data-lit="0"/g) || [];
  assert.equal(litMatches.length, 4);
  assert.equal(unlitMatches.length, 2);
  assert.match(svg, /7 من 11/);
});

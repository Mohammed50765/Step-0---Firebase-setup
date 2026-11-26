import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeFormatBits,
  computeReedSolomonRemainder,
  computeVersionBits,
  encodeQrMatrix,
  renderQrSvg,
} from './qrCode';

function assertFinderAt(modules: boolean[][], row: number, col: number): void {
  for (let dr = 0; dr < 7; dr++) {
    for (let dc = 0; dc < 7; dc++) {
      const expected =
        dr === 0 || dr === 6 || dc === 0 || dc === 6 || (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4);
      assert.equal(modules[row + dr][col + dc], expected, `Finder mismatch at (${row + dr}, ${col + dc})`);
    }
  }
}

test('ISO/IEC 18004 format bits, version bits, and Reed-Solomon remainder match spec reference values', () => {
  // Known ISO/IEC 18004 reference: EC=M (00), mask=0 -> 101010000010010 (0x5412)
  assert.equal(computeFormatBits('M', 0), 0x5412);
  // EC=L (01), mask=0 -> 111011111000100 (0x77c4)
  assert.equal(computeFormatBits('L', 0), 0x77c4);
  // Version 7 Golay(18,6) code: 000111110010010100 (0x07c94)
  assert.equal(computeVersionBits(7), 0x07c94);

  // Standard QR V1-M "HELLO WORLD" Reed-Solomon check vector (10 EC bytes for known 16-byte block)
  const sampleData = new Uint8Array([
    32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17,
  ]);
  const rs = computeReedSolomonRemainder(sampleData, 10);
  assert.deepEqual(Array.from(rs), [196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
});

test('encodeQrMatrix generates valid scannable QR matrix for invite URLs with exact finder, timing, dark module, and alignment patterns', () => {
  const inviteUrl = 'https://midan6v6.pages.dev/?join=MDN-K7P4-X9Q2';
  const qr = encodeQrMatrix(inviteUrl);

  assert.equal(qr.ecLevel, 'M');
  assert.equal(qr.size, 17 + qr.version * 4);
  assert.ok(qr.version >= 3 && qr.version <= 6, `Expected V3..V6, got V${qr.version}`);
  assert.equal(qr.modules.length, qr.size);
  assert.equal(qr.modules[0].length, qr.size);

  // All 3 Finder patterns must be exact
  assertFinderAt(qr.modules, 0, 0);
  assertFinderAt(qr.modules, 0, qr.size - 7);
  assertFinderAt(qr.modules, qr.size - 7, 0);

  // White 1-module separators around top-left finder
  for (let i = 0; i <= 7; i++) {
    assert.equal(qr.modules[7][i], false);
    assert.equal(qr.modules[i][7], false);
  }

  // Alternating Timing patterns on row 6 and col 6 between separators
  for (let i = 8; i < qr.size - 8; i++) {
    assert.equal(qr.modules[6][i], i % 2 === 0);
    assert.equal(qr.modules[i][6], i % 2 === 0);
  }

  // Fixed Dark Module at (4*version + 9, 8)
  assert.equal(qr.modules[4 * qr.version + 9][8], true);

  // Deterministic across repeated calls
  const qr2 = encodeQrMatrix(inviteUrl);
  assert.deepEqual(qr2.modules, qr.modules);
});

test('encodeQrMatrix handles long URLs cleanly up to Version 7+ (with version info) and renderQrSvg includes 4-module white Quiet Zone', () => {
  const longUrl = 'https://midan-6v6-production.pages.dev/app/team/join?join=MDN-K7P4-X9Q2&utm_source=whatsapp_squad_invite_share_link_long_test_1234567890';
  const qr = encodeQrMatrix(longUrl);
  assert.ok(qr.version >= 7, `Expected version >= 7 for long URL, got V${qr.version}`);
  assert.equal(qr.size, 17 + qr.version * 4);

  const svg = renderQrSvg('https://midan6v6.pages.dev/?join=MDN-K7P4-X9Q2', { sizePx: 180 });
  const baseQr = encodeQrMatrix('https://midan6v6.pages.dev/?join=MDN-K7P4-X9Q2');
  const expectedVb = baseQr.size + 8; // 4-module quiet zone on each side
  assert.ok(svg.startsWith('<svg '), 'SVG must start with <svg');
  assert.ok(svg.includes(`viewBox="0 0 ${expectedVb} ${expectedVb}"`), 'SVG must include 4-module quiet zone viewBox');
  assert.ok(svg.includes('fill="#ffffff"'), 'SVG must have white background');
  assert.ok(svg.includes('<path d="M4,4h7v1h-7z'), 'Top-left finder top bar must start at (4,4) inside quiet zone');
});

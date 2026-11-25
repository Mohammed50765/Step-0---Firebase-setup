import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computePeerAggregate,
  escapeHtml,
  generateSecureInviteCode,
  sanitizeBackupImport,
  sanitizeImageDataUrl,
  sanitizeInviteCode,
  stripSensitivePlayerFields,
} from './security';

test('escapeHtml neutralizes HTML/XSS payloads', () => {
  const payload = `<img src=x onerror="alert('xss')">&`;
  const escaped = escapeHtml(payload);
  assert.equal(escaped.includes('<'), false);
  assert.equal(escaped.includes('>'), false);
  assert.equal(escaped.includes('"'), false);
  assert.equal(escaped, '&lt;img src=x onerror=&quot;alert(&#39;xss&#39;)&quot;&gt;&amp;');
});

test('sanitizeImageDataUrl allows only safe raster base64 images under limit', () => {
  assert.equal(sanitizeImageDataUrl('javascript:alert(1)'), '');
  assert.equal(sanitizeImageDataUrl('data:image/svg+xml;base64,PHN2Zz4='), '');
  assert.equal(sanitizeImageDataUrl('data:text/html;base64,PHNjcmlwdD4='), '');
  const valid = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
  assert.equal(sanitizeImageDataUrl(valid), valid);
  assert.equal(sanitizeImageDataUrl(valid, 10), '');
});

test('generateSecureInviteCode produces >= 10 CSPRNG alphanumeric chars with no predictable default', () => {
  const code1 = generateSecureInviteCode();
  const code2 = generateSecureInviteCode();
  assert.notEqual(code1, code2);
  assert.equal(code1.includes('MDN-606'), false);
  assert.match(code1, /^[A-Z0-9-]{12,20}$/);
  const alnumOnly = code1.replace(/-/g, '');
  assert.ok(alnumOnly.length >= 10, `Expected >= 10 random chars, got ${alnumOnly.length}`);
  assert.equal(sanitizeInviteCode(code1), code1);
});

test('sanitizeInviteCode enforces minimum 8 chars and has no hardcoded fallback', () => {
  assert.equal(sanitizeInviteCode(''), '');
  assert.equal(sanitizeInviteCode('MDN-606'), '');
  assert.equal(sanitizeInviteCode('abc-123'), '');
  assert.equal(sanitizeInviteCode('ab12-cd34-ef56'), 'AB12-CD34-EF56');
  assert.equal(sanitizeInviteCode('12345678'), '12345678');
  assert.equal(sanitizeInviteCode('A'.repeat(21)), '');
});

test('computePeerAggregate enforces minimum 3 raters privacy threshold and rounds to 1 decimal place', () => {
  assert.equal(computePeerAggregate(null), null);
  assert.equal(computePeerAggregate({ count: 0, totalScore: 0 }), null);
  assert.equal(computePeerAggregate({ count: 2, totalScore: 18 }), null);
  assert.deepEqual(computePeerAggregate({ count: 3, totalScore: 24 }), {
    avg: '8.0',
    count: 3,
  });
  assert.deepEqual(computePeerAggregate({ count: 3, totalScore: 23 }), {
    avg: '7.7',
    count: 3,
  });
});

test('sanitizeBackupImport strips PINs, enforces requireApproval default, and replaces short invite codes with CSPRNG', () => {
  const rawBackup = {
    settings: {
      appName: 'ميدان 6v6',
      teamName: 'فريق الأبطال',
      primaryColor: 'not-a-color',
      secondaryColor: '#EAB308',
      logo: 'javascript:alert(1)',
      inviteCode: 'MDN-606', // legacy short code must be rejected and replaced
    },
    players: [
      {
        id: 'p_1',
        name: 'أحمد <script>',
        pin: '1234',
        pinHash: 'deadbeef',
        role: 'admin',
        jersey: 999,
        skills: { speed: 99, shooting: -5 },
        photo: 'data:image/svg+xml;base64,abc',
      },
    ],
    matches: [{ opponent: 'النسور', ourScore: 4, oppScore: 2, date: '2026-11-20' }],
    suggestions: [{ text: '  مقترح جيد  ' }],
  };

  const clean = sanitizeBackupImport(rawBackup);
  assert.equal(clean.settings.primaryColor, '#FACC15');
  assert.equal(clean.settings.logo, '');
  assert.notEqual(clean.settings.inviteCode, 'MDN-606');
  assert.ok(clean.settings.inviteCode.replace(/-/g, '').length >= 10);
  assert.equal(clean.settings.requireApproval, true);
  assert.equal(clean.players.length, 1);
  assert.equal('pin' in clean.players[0], false);
  assert.equal('pinHash' in clean.players[0], false);
  assert.equal(clean.players[0].jersey, 99);
  assert.equal(clean.players[0].photo, '');
  assert.equal((clean.players[0].skills as Record<string, number>).speed, 10);
  assert.equal((clean.players[0].skills as Record<string, number>).shooting, 1);
  assert.equal(clean.matches[0].result, 'فوز');
});

test('stripSensitivePlayerFields removes pin and pinHash without mutating input', () => {
  const orig = { id: 'p_1', name: 'يمان', pin: '1234', pinHash: 'abcd' };
  const stripped = stripSensitivePlayerFields(orig);
  assert.equal('pin' in stripped, false);
  assert.equal('pinHash' in stripped, false);
  assert.equal(stripped.name, 'يمان');
});

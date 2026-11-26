import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildNotifications,
  buildWhatsAppReminder,
  computeFatigueSignal,
  computePitchSplit,
  generateMatchIcs,
} from './preMatchHub';

test('computeFatigueSignal accurately classifies green, yellow, and red fatigue states', () => {
  const green = computeFatigueSignal({ sleep: 9, muscleRest: 9, recentRpe: 5, matchesLast7Days: 1 });
  assert.equal(green.level, 'green');
  assert.equal(green.emoji, '🟢');
  assert.ok(green.score >= 75);

  const yellow = computeFatigueSignal({ sleep: 6, muscleRest: 5, recentRpe: 7, matchesLast7Days: 3 });
  assert.equal(yellow.level, 'yellow');
  assert.equal(yellow.emoji, '🟡');

  const red = computeFatigueSignal({ sleep: 3, muscleRest: 4, recentRpe: 9, matchesLast7Days: 4 });
  assert.equal(red.level, 'red');
  assert.equal(red.emoji, '🔴');
  assert.ok(red.factors.length >= 2);
});

test('computePitchSplit divides pitch cost across confirmed players and tracks paid totals', () => {
  const empty = computePitchSplit({ totalCost: 180, confirmedPlayerIds: [], payments: [] });
  assert.equal(empty.perPlayerShare, 0);
  assert.equal(empty.remainingTotal, 180);

  const split = computePitchSplit({
    totalCost: 180,
    confirmedPlayerIds: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'],
    payments: [
      { teamId: 'main', sessionId: 'current', playerId: 'p1', ownerUid: 'p1', playerName: 'أ', amount: 30, paid: true },
      { teamId: 'main', sessionId: 'current', playerId: 'p2', ownerUid: 'p2', playerName: 'ب', amount: 30, paid: true },
      { teamId: 'main', sessionId: 'current', playerId: 'p3', ownerUid: 'p3', playerName: 'ج', amount: 30, paid: false },
    ],
  });
  assert.equal(split.confirmedCount, 6);
  assert.equal(split.perPlayerShare, 30);
  assert.equal(split.paidCount, 2);
  assert.equal(split.unpaidCount, 4);
  assert.equal(split.paidTotal, 60);
  assert.equal(split.remainingTotal, 120);
});

test('buildWhatsAppReminder detects only unresponded available players and formats wa.me link', () => {
  const res = buildWhatsAppReminder({
    teamName: 'فريق السداسي',
    matchTitle: 'مباراة الخميس',
    matchDate: '2026-11-26',
    matchTime: '20:30',
    venue: 'ملعب الأبطال',
    players: [
      { id: 'p1', name: 'يمان', availableStatus: 'available' },
      { id: 'p2', name: 'كريم', availableStatus: 'available' },
      { id: 'p3', name: 'زيد', availableStatus: 'available' },
      { id: 'p4', name: 'طارق', availableStatus: 'unavailable' },
    ],
    attendance: [
      { playerId: 'p1', playerName: 'يمان', date: '2026-11-26', status: 'جاي' },
      { playerId: 'p2', playerName: 'كريم', date: '2026-11-26', status: 'ما فيني' },
    ],
  });
  assert.deepEqual(res.confirmedNames, ['يمان']);
  assert.deepEqual(res.declinedNames, ['كريم']);
  assert.deepEqual(res.unrespondedNames, ['زيد']);
  assert.ok(res.messageText.includes('زيد'));
  assert.equal(res.messageText.includes('طارق'), false);
  assert.ok(res.waUrl.startsWith('https://wa.me/?text='));
});

test('generateMatchIcs builds valid RFC-5545 calendar event', () => {
  const ics = generateMatchIcs({
    title: 'مباراة الخميس',
    teamName: 'فريق السداسي',
    matchDate: '2026-11-26',
    matchTime: '20:30',
    durationMinutes: 60,
    venue: 'ملعب الأبطال',
  });
  assert.ok(ics.includes('BEGIN:VCALENDAR'));
  assert.ok(ics.includes('BEGIN:VEVENT'));
  assert.ok(ics.includes('DTSTART:20261126T203000'));
  assert.ok(ics.includes('DTEND:20261126T213000'));
  assert.ok(ics.includes('LOCATION:ملعب الأبطال'));
  assert.ok(ics.includes('END:VEVENT'));
  assert.ok(ics.includes('END:VCALENDAR'));
});

test('buildNotifications enforces strict privacy for pending join requests and teammate high-fatigue alerts', () => {
  const redSignal = computeFatigueSignal({ sleep: 2, muscleRest: 2, recentRpe: 9, matchesLast7Days: 4 });

  // Regular player must NOT see Captain join requests or another teammate's red fatigue alert!
  const playerNotifs = buildNotifications({
    isCaptain: false,
    currentUserId: 'player_a',
    pendingPlayersCount: 3,
    pitchSession: { title: 'مباراة', matchDate: '2026-11-26', matchTime: '20:00' },
    hasUserRepliedAttendance: false,
    fatigueByPlayer: [{ playerId: 'player_b', playerName: 'زميل آخر', signal: redSignal }],
    userLevel: 2,
    userXp: 120,
    readIds: [],
  });
  assert.equal(playerNotifs.items.some((i) => i.category === 'join'), false);
  assert.equal(playerNotifs.items.some((i) => i.category === 'fatigue'), false);

  // Captain MUST see join requests AND teammate red fatigue alert
  const captainNotifs = buildNotifications({
    isCaptain: true,
    currentUserId: 'captain_uid',
    pendingPlayersCount: 3,
    pitchSession: { title: 'مباراة', matchDate: '2026-11-26', matchTime: '20:00' },
    hasUserRepliedAttendance: true,
    fatigueByPlayer: [{ playerId: 'player_b', playerName: 'زميل آخر', signal: redSignal }],
    userLevel: 2,
    userXp: 120,
    readIds: [],
  });
  assert.equal(captainNotifs.items.some((i) => i.category === 'join'), true);
  assert.equal(captainNotifs.items.some((i) => i.category === 'fatigue'), true);
});

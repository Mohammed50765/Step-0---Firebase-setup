import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildNotifications,
  buildWhatsAppReminder,
  computeFatigueSignal,
  computeNextActionState,
  computePitchSplit,
  findMatchScopedReadiness,
  generateMatchIcs,
  resolveMatchScopedAttendance,
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

test('resolveMatchScopedAttendance ignores past-match & undated records and honors status updates for the upcoming match', () => {
  const players = [
    { id: 'p1', ownerUid: 'u1', name: 'يمان' },
    { id: 'p2', ownerUid: 'u2', name: 'كريم' },
    { id: 'p3', ownerUid: 'u3', name: 'زيد' },
  ];
  const attendance = [
    // Past match records — must NEVER count toward 2026-11-26!
    { playerId: 'p1', date: '2026-11-18', status: 'جاي' },
    { playerId: 'p2', date: '2026-11-18', status: 'جاي' },
    // Undated legacy record — must NOT bleed into scheduled match
    { playerId: 'p3', status: 'جاي' },
    // Upcoming match 2026-11-26: p1 confirmed, p2 first said 'جاي' then switched to 'معتذر'
    { playerId: 'p1', date: '2026-11-26', status: 'جاي', updatedAt: 1000 },
    { playerId: 'p2', date: '2026-11-26', status: 'جاي', updatedAt: 1000 },
    { playerId: 'p2', date: '2026-11-26', status: 'معتذر', updatedAt: 2000 },
  ];

  const scoped = resolveMatchScopedAttendance(attendance, '2026-11-26', players);
  assert.deepEqual(scoped.confirmedIds, ['p1']);
  assert.deepEqual(scoped.declinedIds, ['p2']);
  assert.equal(scoped.getStatusForPlayer(players[0]), 'جاي');
  assert.equal(scoped.getStatusForPlayer(players[1]), 'معتذر');
  assert.equal(scoped.getStatusForPlayer(players[2]), null);
});

test('findMatchScopedReadiness ignores stale readiness logs from past weeks and matches upcoming-match readiness', () => {
  const player = { id: 'p1', ownerUid: 'u1', name: 'يمان' };
  const staleOnly = [
    { playerId: 'p1', date: '2026-11-10', sleep: 8, fatigue: 8 },
    { playerId: 'p1', sleep: 7, fatigue: 7 }, // undated legacy row
  ];
  assert.equal(findMatchScopedReadiness(staleOnly, player, '2026-11-27'), null);

  // Readiness logged 1 day before the upcoming match counts as valid
  const withFresh = [
    ...staleOnly,
    { playerId: 'p1', date: '2026-11-26', sleep: 9, fatigue: 8 },
  ];
  const found = findMatchScopedReadiness(withFresh, player, '2026-11-27');
  assert.ok(found !== null);
  assert.equal(found?.date, '2026-11-26');
});

test('computeNextActionState shares single priority flow and never treats past-match logs as current', () => {
  const user = { id: 'p1', ownerUid: 'u1', name: 'يمان', seasonGoal: '15 هدفاً' };

  // 1. Captain with pending join requests sees approval priority first
  const capAction = computeNextActionState({
    user,
    isCaptain: true,
    pendingPlayersCount: 2,
    targetMatchDate: '2026-11-27',
    attendance: [],
    readiness: [],
    reportsCountForUser: 0,
  });
  assert.equal(capAction.key, 'pending_joins');

  // 2. Old attendance + old readiness from last week must still prompt upcoming attendance
  const staleUserAction = computeNextActionState({
    user,
    isCaptain: false,
    pendingPlayersCount: 0,
    targetMatchDate: '2026-11-27',
    attendance: [{ playerId: 'p1', date: '2026-11-19', status: 'جاي' }],
    readiness: [{ playerId: 'p1', date: '2026-11-19', sleep: 8, fatigue: 8 }],
    reportsCountForUser: 2,
  });
  assert.equal(staleUserAction.key, 'attend');

  // 3. Replied for upcoming match, but readiness is still stale -> prompts readiness
  const needReadiness = computeNextActionState({
    user,
    isCaptain: false,
    pendingPlayersCount: 0,
    targetMatchDate: '2026-11-27',
    attendance: [{ playerId: 'p1', date: '2026-11-27', status: 'جاي' }],
    readiness: [{ playerId: 'p1', date: '2026-11-19', sleep: 8, fatigue: 8 }],
    reportsCountForUser: 2,
  });
  assert.equal(needReadiness.key, 'readiness');

  // 4. Both attendance & readiness current for 2026-11-27 + has reports & goal -> ready for tactics
  const allReady = computeNextActionState({
    user,
    isCaptain: false,
    pendingPlayersCount: 0,
    targetMatchDate: '2026-11-27',
    attendance: [{ playerId: 'p1', date: '2026-11-27', status: 'جاي' }],
    readiness: [{ playerId: 'p1', matchDate: '2026-11-27', date: '2026-11-26', sleep: 8, fatigue: 8 }],
    reportsCountForUser: 2,
  });
  assert.equal(allReady.key, 'tactics');
});

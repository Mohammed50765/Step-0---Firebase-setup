import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REPORT_COOLDOWN_MS,
  MAX_GOALS_PER_MATCH,
  MAX_ASSISTS_PER_MATCH,
  normalizeJoinCode,
  extractJoinCodeFromQrPayload,
  buildWhatsAppTeamInvite,
  canPublishTeamLineup,
  isTeamCreator,
  isTeamOrganizer,
  tallyLineupVotes,
  normalizeAttendanceStatus,
  computeFlexiblePitchSplit,
  evaluateReportSubmissionGuard,
  applyReportConfirmation,
  autoBalanceConfirmedAttendees,
} from './teamMultiplayer';

test('normalizeJoinCode trims and uppercases valid codes, converts Arabic numerals, and rejects short noise', () => {
  assert.equal(normalizeJoinCode('  mdn-k7p4-x9q2  '), 'MDN-K7P4-X9Q2');
  assert.equal(normalizeJoinCode('mdn–١٢٣٤—٩٨٧٦'), 'MDN-1234-9876');
  assert.equal(normalizeJoinCode('abc12345'), 'ABC12345');
  assert.equal(normalizeJoinCode('123'), '');
});

test('extractJoinCodeFromQrPayload parses ?join= URLs, hash URLs, and raw codes', () => {
  assert.equal(
    extractJoinCodeFromQrPayload('https://maydan6v6.pages.dev/?join=mdn-a1b2-c3d4&ref=REF-1234'),
    'MDN-A1B2-C3D4'
  );
  assert.equal(
    extractJoinCodeFromQrPayload('https://example.com/#join=TEAM-9988'),
    'TEAM-9988'
  );
  assert.equal(extractJoinCodeFromQrPayload('mdn-9988-7766'), 'MDN-9988-7766');
  assert.equal(extractJoinCodeFromQrPayload('not-a-code'), 'NOT-A-CODE');
  assert.equal(extractJoinCodeFromQrPayload('hi'), '');
});

test('buildWhatsAppTeamInvite includes team name, invite code, and direct link', () => {
  const res = buildWhatsAppTeamInvite({
    teamName: 'أبطال الخميس',
    inviteCode: 'mdn-7788-99aa',
    shareUrl: 'https://maydan.app/?join=MDN-7788-99AA',
  });
  assert.match(res.text, /أبطال الخميس/);
  assert.match(res.text, /MDN-7788-99AA/);
  assert.match(res.text, /https:\/\/maydan\.app\/\?join=MDN-7788-99AA/);
  assert.ok(res.waUrl.startsWith('https://wa.me/?text='));
});

test('lineup permission defaults to Friends Mode (all) and respects organizers mode', () => {
  const teamAll = { createdBy: 'u1', organizerUids: ['u1'], lineupPermission: 'all' as const };
  assert.equal(canPublishTeamLineup(teamAll, 'u99'), true);

  const teamOrg = { createdBy: 'u1', organizerUids: ['u1', 'u2'], lineupPermission: 'organizers' as const };
  assert.equal(isTeamCreator(teamOrg, 'u1'), true);
  assert.equal(isTeamCreator(teamOrg, 'u2'), false);
  assert.equal(isTeamOrganizer(teamOrg, 'u2'), true);
  assert.equal(canPublishTeamLineup(teamOrg, 'u1'), true);
  assert.equal(canPublishTeamLineup(teamOrg, 'u2'), true);
  assert.equal(canPublishTeamLineup(teamOrg, 'u3'), false);
});

test('tallyLineupVotes counts approve & swap votes accurately', () => {
  const res = tallyLineupVotes({ u1: 'approve', u2: 'approve', u3: 'swap' }, 'u3');
  assert.equal(res.approveCount, 2);
  assert.equal(res.swapCount, 1);
  assert.equal(res.myVote, 'swap');
});

test('normalizeAttendanceStatus maps legacy & updated Arabic statuses cleanly', () => {
  assert.equal(normalizeAttendanceStatus('جاي'), 'جاي');
  assert.equal(normalizeAttendanceStatus('محتمل'), 'محتمل');
  assert.equal(normalizeAttendanceStatus('متردد'), 'محتمل');
  assert.equal(normalizeAttendanceStatus('مو أكيد'), 'محتمل');
  assert.equal(normalizeAttendanceStatus('ما فيني'), 'معتذر');
  assert.equal(normalizeAttendanceStatus('معتذر'), 'معتذر');
});

test('computeFlexiblePitchSplit computes exact share with zero hardcoded default', () => {
  const zeroCost = computeFlexiblePitchSplit({
    totalCost: 0,
    confirmedUids: ['u1', 'u2', 'u3'],
    paidMap: {},
  });
  assert.equal(zeroCost.totalCost, 0);
  assert.equal(zeroCost.perPlayerShare, 0);

  const split = computeFlexiblePitchSplit({
    totalCost: 240,
    confirmedUids: ['u1', 'u2', 'u3', 'u4', 'u5', 'u6'],
    paidMap: { u1: true, u2: true, u99: true },
  });
  assert.equal(split.confirmedCount, 6);
  assert.equal(split.perPlayerShare, 40);
  assert.equal(split.paidCount, 2);
  assert.equal(split.unpaidCount, 4);
  assert.equal(split.paidTotal, 80);
  assert.equal(split.remainingTotal, 160);
});

test('evaluateReportSubmissionGuard enforces 45-min cooldown and realistic goals/assists caps', () => {
  const now = 1_700_000_000_000;
  const tooManyGoals = evaluateReportSubmissionGuard({
    goals: MAX_GOALS_PER_MATCH + 3,
    assists: 1,
    minutes: 50,
    nowMs: now,
  });
  assert.equal(tooManyGoals.allowed, false);

  const tooManyAssists = evaluateReportSubmissionGuard({
    goals: 2,
    assists: MAX_ASSISTS_PER_MATCH + 1,
    minutes: 50,
    nowMs: now,
  });
  assert.equal(tooManyAssists.allowed, false);

  const cooldownBlocked = evaluateReportSubmissionGuard({
    goals: 2,
    assists: 1,
    minutes: 50,
    lastReportAtMs: now - 10 * 60 * 1000,
    nowMs: now,
  });
  assert.equal(cooldownBlocked.allowed, false);
  assert.equal(cooldownBlocked.remainingMinutes, 35);

  const cooldownPassed = evaluateReportSubmissionGuard({
    goals: 2,
    assists: 1,
    minutes: 50,
    lastReportAtMs: now - REPORT_COOLDOWN_MS - 1000,
    nowMs: now,
  });
  assert.equal(cooldownPassed.allowed, true);
  assert.equal(cooldownPassed.sanitized.goals, 2);
});

test('applyReportConfirmation prevents self-confirmation and verifies teammate report', () => {
  const selfRes = applyReportConfirmation({ ownerUid: 'u1', playerId: 'u1', confirmedByUids: [] }, 'u1');
  assert.equal(selfRes.ok, false);
  assert.equal(selfRes.verified, false);

  const peerRes = applyReportConfirmation({ ownerUid: 'u1', playerId: 'u1', confirmedByUids: [] }, 'u2');
  assert.equal(peerRes.ok, true);
  assert.equal(peerRes.verified, true);
  assert.deepEqual(peerRes.confirmedByUids, ['u2']);

  const dupRes = applyReportConfirmation({ ownerUid: 'u1', playerId: 'u1', confirmedByUids: ['u2'] }, 'u2');
  assert.equal(dupRes.ok, true);
  assert.equal(dupRes.alreadyConfirmed, true);
  assert.deepEqual(dupRes.confirmedByUids, ['u2']);
});

test('autoBalanceConfirmedAttendees splits confirmed players evenly by rating', () => {
  const players = [
    { id: 'p1', name: 'أحمد', primaryPos: 'مهاجم', skills: { speed: 9, shooting: 9, passing: 8 } },
    { id: 'p2', name: 'خالد', primaryPos: 'حارس مرمى', skills: { defending: 8, positioning: 8 } },
    { id: 'p3', name: 'سعد', primaryPos: 'مدافع', skills: { defending: 7, stamina: 8 } },
    { id: 'p4', name: 'عمر', primaryPos: 'لاعب وسط', skills: { passing: 8, vision: 8 } },
    { id: 'p5', name: 'طارق', primaryPos: 'جناح', skills: { speed: 6, dribbling: 6 } },
  ];
  const res = autoBalanceConfirmedAttendees(players, ['p1', 'p2', 'p3', 'p4']);
  assert.equal(res.usedConfirmedOnly, true);
  assert.equal(res.teamA.length, 2);
  assert.equal(res.teamB.length, 2);
  assert.ok(res.diff <= 15);
});

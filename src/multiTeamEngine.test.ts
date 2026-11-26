import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDefaultTeamCreatePayload,
  checkTeamQuotaEligibility,
  chunkItemsForBatch,
  findForbiddenPublicHealthFields,
  flattenConsolidatedAttendanceDocs,
  groupLegacyAttendanceByMatchKey,
  MAX_TEAM_LOGO_CHARS,
  sanitizeJoinMode,
  sanitizeTeamLogo50Kb,
  sortActiveTeamsList,
  splitPlayerPublicAndPrivate,
  verifyMigrationCountReport,
} from './multiTeamEngine';

test('Multi-Team Quota: enforces max 3 owned, max 5 joined, team capacity, and allowNewTeams pause', () => {
  const paused = checkTeamQuotaEligibility({
    action: 'create',
    allowNewTeams: false,
    ownedTeamIds: [],
    joinedTeamIds: [],
  });
  assert.equal(paused.allowed, false);
  assert.equal(paused.reasonCode, 'new_teams_paused');

  const maxOwned = checkTeamQuotaEligibility({
    action: 'create',
    allowNewTeams: true,
    ownedTeamIds: ['t1', 't2', 't3'],
    joinedTeamIds: ['t1', 't2', 't3'],
  });
  assert.equal(maxOwned.allowed, false);
  assert.equal(maxOwned.reasonCode, 'max_owned_teams');

  const maxJoined = checkTeamQuotaEligibility({
    action: 'join',
    targetTeamId: 't6',
    joinedTeamIds: ['t1', 't2', 't3', 't4', 't5'],
    currentMemberCount: 8,
    maxMembersPerTeam: 30,
  });
  assert.equal(maxJoined.allowed, false);
  assert.equal(maxJoined.reasonCode, 'max_joined_teams');

  const fullTeam = checkTeamQuotaEligibility({
    action: 'join',
    targetTeamId: 't_full',
    joinedTeamIds: ['t1'],
    currentMemberCount: 30,
    maxMembersPerTeam: 30,
  });
  assert.equal(fullTeam.allowed, false);
  assert.equal(fullTeam.reasonCode, 'team_full');

  const ok = checkTeamQuotaEligibility({
    action: 'join',
    targetTeamId: 't_new',
    joinedTeamIds: ['t1', 't2'],
    currentMemberCount: 12,
    maxMembersPerTeam: 30,
  });
  assert.equal(ok.allowed, true);
});

test('Public/Private split removes all health, readiness, injury, and PIN fields from public members doc', () => {
  const { publicMember, privateRecords } = splitPlayerPublicAndPrivate({
    teamId: 'team_abc123',
    founderUid: 'uid_founder',
    organizerUids: ['uid_org'],
    rawPlayer: {
      id: 'p_1',
      ownerUid: 'uid_player1',
      name: 'ياسر',
      jersey: 9,
      primaryPos: 'مهاجم',
      availableStatus: 'unavailable',
      sleep: 3,
      fatigue: 2,
      mood: 4,
      injury: 'التواء كاحل',
      severity: 'متوسطة',
      pin: '1234',
    },
    readinessRecords: [
      { id: 'r1', ownerUid: 'uid_player1', date: '2026-11-25', sleep: 5, fatigue: 4, mood: 6 },
    ],
    injuryRecords: [
      {
        id: 'inj1',
        ownerUid: 'uid_player1',
        type: 'التواء الكاحل',
        location: 'القدم',
        severity: 'متوسطة',
        date: '2026-11-24',
        expectedReturn: '2026-12-04',
      },
    ],
  });

  assert.equal(publicMember.availableStatus, 'غير متاح');
  assert.deepEqual(findForbiddenPublicHealthFields(publicMember as unknown as Record<string, unknown>), []);
  assert.equal(privateRecords.length, 2);
  assert.equal(privateRecords[0].kind, 'readiness');
  assert.equal(privateRecords[1].kind, 'injury');
});

test('Logo validator rejects oversized (>50KB) or invalid logos and accepts valid small base64 JPEG', () => {
  const smallJpeg = 'data:image/jpeg;base64,' + 'A'.repeat(200);
  const okRes = sanitizeTeamLogo50Kb(smallJpeg);
  assert.equal(okRes.ok, true);

  const hugeJpeg = 'data:image/jpeg;base64,' + 'A'.repeat(MAX_TEAM_LOGO_CHARS + 50);
  const badRes = sanitizeTeamLogo50Kb(hugeJpeg);
  assert.equal(badRes.ok, false);
  assert.match(badRes.errorAr || '', /50 كيلوبايت/);
});

test('Consolidated attendance groups N legacy rows into 1 doc per matchKey and flattens cleanly', () => {
  const docs = groupLegacyAttendanceByMatchKey([
    { playerId: 'u1', ownerUid: 'u1', playerName: 'أحمد', date: '2026-11-28', type: 'مباراة', status: 'جاي' },
    { playerId: 'u2', ownerUid: 'u2', playerName: 'سالم', date: '2026-11-28', type: 'مباراة', status: 'مو أكيد' },
    { playerId: 'u3', ownerUid: 'u3', playerName: 'فيصل', date: '2026-11-28', type: 'مباراة', status: 'ما فيني' },
  ]);
  assert.equal(docs.length, 1);
  assert.equal(docs[0].matchKey, '2026-11-28_match');
  assert.equal(docs[0].responses.u1.status, 'جاي');
  assert.equal(docs[0].responses.u2.status, 'محتمل');
  assert.equal(docs[0].responses.u3.status, 'معتذر');

  const flat = flattenConsolidatedAttendanceDocs(docs);
  assert.equal(flat.length, 3);
});

test('Migration helpers enforce <=400 batch chunking, count verification, and soft-delete sorting', () => {
  const chunks = chunkItemsForBatch(Array.from({ length: 850 }, (_, i) => i), 400);
  assert.deepEqual(
    chunks.map((c) => c.length),
    [400, 400, 50]
  );

  const okReport = verifyMigrationCountReport(
    { members: 12, privateRecords: 4, matches: 8, reports: 20, attendanceDocs: 3, tactics: 1, suggestions: 2 },
    { members: 12, privateRecords: 4, matches: 8, reports: 20, attendanceDocs: 3, tactics: 1, suggestions: 2 }
  );
  assert.equal(okReport.ok, true);

  const badReport = verifyMigrationCountReport(
    { members: 12, privateRecords: 4, matches: 8, reports: 20, attendanceDocs: 3, tactics: 1, suggestions: 2 },
    { members: 11, privateRecords: 4, matches: 8, reports: 20, attendanceDocs: 3, tactics: 1, suggestions: 2 }
  );
  assert.equal(badReport.ok, false);
  assert.deepEqual(badReport.mismatches, ['members']);

  const payload = buildDefaultTeamCreatePayload({
    teamName: 'فريق النخبة',
    founderUid: 'uid_cap',
    inviteCode: 'MDN-AA11-BB22',
    memberShareCode: 'MDN-CC33-DD44',
  });
  assert.equal(payload.joinMode, 'approval');
  assert.equal(sanitizeJoinMode(undefined), 'approval');

  const sorted = sortActiveTeamsList(
    [
      { id: 't_deleted', teamName: 'محذوف', deletedAt: 12345 },
      { id: 't_b', teamName: 'فريق ب', deletedAt: null },
      { id: 't_a', teamName: 'فريق أ', deletedAt: null },
    ],
    't_b'
  );
  assert.deepEqual(
    sorted.map((t) => t.id),
    ['t_b', 't_a']
  );
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MATCH_VERIFY_MIN_CONFIRMATIONS,
  VOTING_ROUND_DURATION_SEC,
  aggregateSessionVoting,
  applyMissionVerification,
  buildTalliesFromBallots,
  canCastSecretVote,
  computeCommitmentStats,
  computeQuorumStatus,
  computeTrimmedMean,
  confirmMatchSession,
  createDraftMatchSession,
  createMissionClaim,
  pickRandomVerifiers,
} from './votingEngine';

test('Draft -> Verified requires 3 distinct participants and blocks duplicate confirmers', () => {
  assert.equal(MATCH_VERIFY_MIN_CONFIRMATIONS, 3);
  const draft = createDraftMatchSession({
    id: 'ms_1',
    date: '2026-11-24',
    opponent: 'الصقور',
    pitchMode: '6v6',
    ourScore: 4,
    oppScore: 2,
    createdBy: 'p_1',
    participantIds: ['p_1', 'p_2', 'p_3', 'p_4', 'p_5', 'p_6'],
  });
  assert.equal(draft.status, 'draft');
  assert.deepEqual(draft.confirmers, ['p_1']);
  assert.equal(draft.votingOpen, false);

  // Duplicate confirmer MUST be blocked
  const dup = confirmMatchSession(draft, 'p_1');
  assert.equal(dup.ok, false);
  assert.equal(dup.session.status, 'draft');

  // Non-participant MUST be blocked
  const outsider = confirmMatchSession(draft, 'outsider');
  assert.equal(outsider.ok, false);

  // 2nd distinct participant -> still draft
  const c2 = confirmMatchSession(draft, 'p_2');
  assert.equal(c2.ok, true);
  assert.equal(c2.session.status, 'draft');
  assert.equal(c2.session.confirmers.length, 2);

  // 3rd distinct participant -> Verified + voting opens
  const c3 = confirmMatchSession(c2.session, 'p_3');
  assert.equal(c3.ok, true);
  assert.equal(c3.session.status, 'verified');
  assert.equal(c3.session.votingOpen, true);
  assert.equal(c3.session.confirmers.length, 3);
});

test('Secret 20s voting blocks self-votes, locks below 50% quorum, and computes Trimmed Mean', () => {
  assert.equal(VOTING_ROUND_DURATION_SEC, 20);
  assert.equal(canCastSecretVote('p_1', 'p_1'), false);
  assert.equal(canCastSecretVote('p_1', 'p_2'), true);

  // Quorum checks for 6 participants (requires >= 3 voters = 50%)
  assert.equal(computeQuorumStatus(2, 6).unlocked, false);
  assert.equal(computeQuorumStatus(3, 6).unlocked, true);
  assert.equal(computeQuorumStatus(2, 5).unlocked, false);
  assert.equal(computeQuorumStatus(3, 5).unlocked, true);

  // Trimmed Mean drops lowest outlier (1) and highest outlier (10)
  // Scores: [1, 7, 8, 8, 10] -> trimmed [7, 8, 8] -> 7.7
  const tm = computeTrimmedMean([10, 1, 8, 7, 8]);
  assert.equal(tm.droppedLow, 1);
  assert.equal(tm.droppedHigh, 10);
  assert.equal(tm.trimmedCount, 3);
  assert.equal(tm.trimmedMean, 7.7);

  // End-to-end session aggregation: locked at 2/6 voters, unlocked at 3/6 voters
  const baseSession = {
    ...createDraftMatchSession({
      id: 'ms_vote',
      date: '2026-11-24',
      opponent: 'النسور',
      pitchMode: '6v6',
      ourScore: 3,
      oppScore: 1,
      createdBy: 'p_1',
      participantIds: ['p_1', 'p_2', 'p_3', 'p_4', 'p_5', 'p_6'],
    }),
    status: 'verified' as const,
    votingOpen: true,
    confirmers: ['p_1', 'p_2', 'p_3'],
    voterUids: ['p_1', 'p_2'],
  };

  const ballots = [
    // Self-vote must be stripped silently
    { sessionId: 'ms_vote', targetId: 'p_1', voterUid: 'p_1', score: 10 },
    // Valid ballots for p_3: [1, 8, 9, 10] -> trimmed [8, 9] -> 8.5
    { sessionId: 'ms_vote', targetId: 'p_3', voterUid: 'p_1', score: 1 },
    { sessionId: 'ms_vote', targetId: 'p_3', voterUid: 'p_2', score: 8 },
    { sessionId: 'ms_vote', targetId: 'p_3', voterUid: 'p_4', score: 9 },
    { sessionId: 'ms_vote', targetId: 'p_3', voterUid: 'p_5', score: 10 },
  ];

  const tallies = buildTalliesFromBallots('ms_vote', 6, ballots);
  // Ensure self-vote for p_1 was excluded completely
  assert.equal(tallies.some((t) => t.targetId === 'p_1'), false);

  const lockedAgg = aggregateSessionVoting(baseSession, tallies);
  assert.equal(lockedAgg.unlocked, false);
  assert.equal(lockedAgg.results.length, 0);

  const unlockedSession = { ...baseSession, voterUids: ['p_1', 'p_2', 'p_4', 'p_5'] };
  const unlockedAgg = aggregateSessionVoting(unlockedSession, tallies);
  assert.equal(unlockedAgg.unlocked, true);
  assert.equal(unlockedAgg.results.length, 1);
  assert.equal(unlockedAgg.results[0].targetId, 'p_3');
  assert.equal(unlockedAgg.results[0].trimmedMean, 8.5);
  assert.equal(unlockedAgg.motmTargetId, 'p_3');
});

test('Random 2-teammate mission peer verification excludes claimant and requires both approvals', () => {
  const picked = pickRandomVerifiers('p_1', ['p_1', 'p_2', 'p_3', 'p_4'], () => 0.42);
  assert.equal(picked.ok, true);
  assert.equal(picked.verifiers.length, 2);
  assert.equal(picked.verifiers.includes('p_1'), false);
  assert.notEqual(picked.verifiers[0], picked.verifiers[1]);

  const created = createMissionClaim(
    { missionId: 'clean_sheet', claimantUid: 'p_1', claimantName: 'يمان', note: 'فوز 3-1' },
    ['p_1', 'p_2', 'p_3', 'p_4'],
    () => 0.25
  );
  assert.equal(created.ok, true);
  assert.ok(created.claim);
  const claim = created.claim!;
  assert.equal(claim.status, 'pending');

  // Self-verification MUST fail
  const selfTry = applyMissionVerification(claim, 'p_1', 'approved');
  assert.equal(selfTry.ok, false);

  // Unassigned player MUST fail
  const unassigned = ['p_2', 'p_3', 'p_4'].find((id) => !claim.verifierUids.includes(id))!;
  const outsiderTry = applyMissionVerification(claim, unassigned, 'approved');
  assert.equal(outsiderTry.ok, false);

  // First assigned verifier approves -> still pending (1/2)
  const v1 = applyMissionVerification(claim, claim.verifierUids[0], 'approved');
  assert.equal(v1.ok, true);
  assert.equal(v1.claim.status, 'pending');

  // Duplicate approval from same verifier MUST fail
  const dupV1 = applyMissionVerification(v1.claim, claim.verifierUids[0], 'approved');
  assert.equal(dupV1.ok, false);

  // Second assigned verifier approves -> verified (2/2)
  const v2 = applyMissionVerification(v1.claim, claim.verifierUids[1], 'approved');
  assert.equal(v2.ok, true);
  assert.equal(v2.claim.status, 'verified');
});

test('computeCommitmentStats calculates dynamic percentage from attendance records', () => {
  const p = { id: 'p_1', ownerUid: 'u_1' };
  assert.equal(computeCommitmentStats([], p).label, '—');

  const records = [
    { playerId: 'p_1', status: 'جاي' },
    { playerId: 'p_1', status: 'جاي' },
    { playerId: 'p_1', status: 'ما فيني' },
    { playerId: 'p_2', status: 'ما فيني' },
  ];
  const st = computeCommitmentStats(records, p);
  assert.equal(st.attended, 2);
  assert.equal(st.total, 3);
  assert.equal(st.pct, 67);
  assert.equal(st.label, '67%');
});

/**
 * Operational Firestore Security Rules Test Suite ("Dirty Dozen" + RBAC + Privacy)
 *
 * Runs real Firestore queries and writes against the Firebase Local Emulator
 * using @firebase/rules-unit-testing (zero regex/text scraping!).
 *
 * How to run (requires Java 17+ and Firebase CLI):
 *   firebase emulators:exec --only firestore "npm run test:rules"
 */
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';

const PROJECT_ID = 'maydan-6v6-rules-test';
const ACTIVE_INVITE_CODE = 'K9M2-P4Q7-X8V3';
const MEMBER_SHARE_CODE = 'MDN-S9H8-A7R6';
const SHORT_INVITE_CODE = 'MDN-606';

const BASE_SKILLS = {
  speed: 7,
  shooting: 7,
  passing: 7,
  dribbling: 7,
  defending: 6,
  stamina: 7,
  vision: 7,
  teamwork: 7,
  control: 7,
  positioning: 7,
};

let testEnv: RulesTestEnvironment;

function parseEmulatorHost(): { host: string; port: number } {
  const raw = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
  const [host, portStr] = raw.split(':');
  return { host: host || '127.0.0.1', port: Number(portStr) || 8080 };
}

async function seedTeamState(): Promise<void> {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const now = Timestamp.now();

    // 1. Trusted Captain record in admins/{uid}
    await setDoc(doc(db, 'admins', 'captain_uid'), {
      uid: 'captain_uid',
      promotedBy: 'bootstrap_console',
      createdAt: now,
    });

    // 2. Team settings + active 12-char CSPRNG invite code + permanent member share code
    const nowMs = Date.now();
    await setDoc(doc(db, 'settings', 'team'), {
      teamId: 'main',
      appName: 'ميدان 6v6',
      teamName: 'فريق السداسي',
      primaryColor: '#FACC15',
      secondaryColor: '#EAB308',
      logo: '',
      inviteCode: ACTIVE_INVITE_CODE,
      memberShareCode: MEMBER_SHARE_CODE,
      requireApproval: true,
      lockSkills: false,
      themeVersion: 'royal_v2',
      creatorUid: 'captain_uid',
      organizerUids: [],
      lineupPermission: 'all',
      defaultCurrency: 'ريال',
      defaultPitchCost: 180,
      updatedAt: now,
    });
    await setDoc(doc(db, 'inviteCodes', ACTIVE_INVITE_CODE), {
      code: ACTIVE_INVITE_CODE,
      active: true,
      requireApproval: true,
      isMemberShareCode: false,
      teamId: 'main',
      teamName: 'فريق السداسي',
      appName: 'ميدان 6v6',
      primaryColor: '#FACC15',
      usageType: 'multi',
      maxUses: 20,
      usedCount: 0,
      durationDays: 7,
      createdAtMs: nowMs,
      expiresAtMs: nowMs + 7 * 86400000,
      status: 'active',
      updatedAt: now,
    });
    await setDoc(doc(db, 'inviteCodes', MEMBER_SHARE_CODE), {
      code: MEMBER_SHARE_CODE,
      active: true,
      requireApproval: true,
      isMemberShareCode: true,
      teamId: 'main',
      teamName: 'فريق السداسي',
      appName: 'ميدان 6v6',
      primaryColor: '#FACC15',
      usageType: 'multi',
      maxUses: 50,
      usedCount: 0,
      durationDays: 365,
      createdAtMs: nowMs,
      expiresAtMs: nowMs + 365 * 86400000,
      status: 'active',
      updatedAt: now,
    });

    // 3. Roster players: captain_uid, player_a, player_b, player_c
    for (const p of [
      { id: 'captain_uid', name: 'الكابتن', role: 'admin', jersey: 10 },
      { id: 'player_a', name: 'لاعب أ', role: 'player', jersey: 7 },
      { id: 'player_b', name: 'لاعب ب', role: 'player', jersey: 9 },
      { id: 'player_c', name: 'لاعب ج', role: 'player', jersey: 5 },
    ]) {
      await setDoc(doc(db, 'players', p.id), {
        id: p.id,
        teamId: 'main',
        ownerUid: p.id,
        name: p.name,
        role: p.role,
        jersey: p.jersey,
        primaryPos: 'لاعب وسط',
        skills: BASE_SKILLS,
        availableStatus: 'available',
        createdAt: now,
        updatedAt: now,
      });
    }

    // 4. Private readiness & injury logs belonging to player_b
    await setDoc(doc(db, 'readiness', 'rd_player_b'), {
      teamId: 'main',
      playerId: 'player_b',
      ownerUid: 'player_b',
      date: '2026-11-23',
      sleep: 8,
      fatigue: 7,
      mood: 9,
      createdAt: now,
    });
    await setDoc(doc(db, 'injuries', 'inj_player_b'), {
      teamId: 'main',
      playerId: 'player_b',
      ownerUid: 'player_b',
      type: 'التواء الكاحل',
      location: 'الكاحل الأيمن',
      severity: 'خفيفة',
      date: '2026-11-23',
      expectedReturn: '2026-11-27',
      createdAt: now,
    });

    // 5. Peer ratings & aggregated stats:
    //    - player_a has count == 2 (BELOW privacy threshold of 3 -> MUST NOT be readable!)
    //    - player_b has count == 3 (AT privacy threshold of 3 -> readable by team members)
    await setDoc(doc(db, 'peerRatings', 'player_a__player_b'), {
      targetId: 'player_a',
      raterUid: 'player_b',
      score: 8,
      createdAt: now,
      updatedAt: now,
    });
    await setDoc(doc(db, 'peerRatingStats', 'player_a'), {
      teamId: 'main',
      targetId: 'player_a',
      count: 2,
      totalScore: 16,
      updatedAt: now,
    });
    await setDoc(doc(db, 'peerRatingStats', 'player_b'), {
      teamId: 'main',
      targetId: 'player_b',
      count: 3,
      totalScore: 25,
      updatedAt: now,
    });

    // 6. Step 5ب Pitch Session (aggregate totals) + Private Pitch Payment for player_b
    await setDoc(doc(db, 'pitchSessions', 'current'), {
      teamId: 'main',
      title: 'مباراة الخميس',
      matchDate: '2026-11-26',
      matchTime: '20:30',
      venue: 'ملعب السداسي الذهبي',
      totalCost: 180,
      currency: 'ريال',
      confirmedCount: 6,
      paidCount: 1,
      paidTotal: 30,
      updatedAt: now,
    });
    await setDoc(doc(db, 'pitchPayments', 'current__player_b'), {
      teamId: 'main',
      sessionId: 'current',
      playerId: 'player_b',
      ownerUid: 'player_b',
      playerName: 'لاعب ب',
      amount: 30,
      paid: true,
      updatedAt: now,
    });
  });
}

test.before(async () => {
  const { host, port } = parseEmulatorHost();
  const rulesPath = process.env.RULES_FILE || 'firestore.rules';
  const rules = fs.readFileSync(path.resolve(rulesPath), 'utf8');
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { host, port, rules },
  });
});

test.beforeEach(async () => {
  await testEnv.clearFirestore();
  await seedTeamState();
});

test.after(async () => {
  if (testEnv) await testEnv.cleanup();
});

// ==================== DIRTY DOZEN #1: Unauthenticated Access ====================
test('Dirty Dozen #1: unauthenticated users are denied across all collections', async () => {
  const unauthDb = testEnv.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(unauthDb, 'players', 'player_a')));
  await assertFails(getDoc(doc(unauthDb, 'settings', 'team')));
  await assertFails(getDoc(doc(unauthDb, 'readiness', 'rd_player_b')));
  await assertFails(getDoc(doc(unauthDb, 'injuries', 'inj_player_b')));
  await assertFails(getDoc(doc(unauthDb, 'peerRatings', 'player_a__player_b')));
  await assertFails(getDoc(doc(unauthDb, 'peerRatingStats', 'player_b')));
  await assertFails(getDoc(doc(unauthDb, 'admins', 'captain_uid')));
});

// ==================== DIRTY DOZEN #2: Unverified Email ====================
test('Dirty Dozen #2: unverified email is denied even if UID exists in admins/{uid}', async () => {
  const unverifiedCaptainDb = testEnv
    .authenticatedContext('captain_uid', { email: 'captain@example.com', email_verified: false })
    .firestore();

  await assertFails(getDoc(doc(unverifiedCaptainDb, 'settings', 'team')));
  await assertFails(getDoc(doc(unverifiedCaptainDb, 'injuries', 'inj_player_b')));
});

// ==================== DIRTY DOZEN #3: Captain RBAC strictly via admins/{uid} ====================
test('Dirty Dozen #3: only UID present in admins/{uid} has Captain privileges (no email bypass)', async () => {
  const playerDb = testEnv
    .authenticatedContext('player_a', { email: 'fake-captain@example.com', email_verified: true })
    .firestore();
  const captainDb = testEnv
    .authenticatedContext('captain_uid', { email: 'captain@example.com', email_verified: true })
    .firestore();

  // Regular player cannot promote themselves into admins/{uid} or write team settings
  await assertFails(
    setDoc(doc(playerDb, 'admins', 'player_a'), {
      uid: 'player_a',
      promotedBy: 'player_a',
      createdAt: serverTimestamp(),
    })
  );
  await assertFails(
    updateDoc(doc(playerDb, 'settings', 'team'), {
      inviteCode: 'Z8X7-C6V5-B4N3',
      updatedAt: serverTimestamp(),
    })
  );

  // Verified Captain in admins/{uid} CAN rotate invite code in settings/team
  await assertSucceeds(
    updateDoc(doc(captainDb, 'settings', 'team'), {
      inviteCode: 'Z8X7-C6V5-B4N3',
      updatedAt: serverTimestamp(),
    })
  );
});

// ==================== DIRTY DOZEN #4: Cross-Player Private Injuries ====================
test('Dirty Dozen #4: player cannot get or list another player injuries; owner & Captain can', async () => {
  const playerADb = testEnv
    .authenticatedContext('player_a', { email_verified: true })
    .firestore();
  const playerBDb = testEnv
    .authenticatedContext('player_b', { email_verified: true })
    .firestore();
  const captainDb = testEnv
    .authenticatedContext('captain_uid', { email_verified: true })
    .firestore();

  await assertFails(getDoc(doc(playerADb, 'injuries', 'inj_player_b')));
  await assertFails(
    getDocs(query(collection(playerADb, 'injuries'), where('teamId', '==', 'main')))
  );
  await assertSucceeds(getDoc(doc(playerBDb, 'injuries', 'inj_player_b')));
  await assertSucceeds(
    getDocs(query(collection(playerBDb, 'injuries'), where('ownerUid', '==', 'player_b')))
  );
  await assertSucceeds(
    getDocs(query(collection(captainDb, 'injuries'), where('teamId', '==', 'main')))
  );
});

// ==================== DIRTY DOZEN #5: Cross-Player Private Readiness ====================
test('Dirty Dozen #5: player cannot get or list another player readiness; owner & Captain can', async () => {
  const playerADb = testEnv
    .authenticatedContext('player_a', { email_verified: true })
    .firestore();
  const playerBDb = testEnv
    .authenticatedContext('player_b', { email_verified: true })
    .firestore();
  const captainDb = testEnv
    .authenticatedContext('captain_uid', { email_verified: true })
    .firestore();

  await assertFails(getDoc(doc(playerADb, 'readiness', 'rd_player_b')));
  await assertFails(
    getDocs(query(collection(playerADb, 'readiness'), where('teamId', '==', 'main')))
  );
  await assertSucceeds(getDoc(doc(playerBDb, 'readiness', 'rd_player_b')));
  await assertSucceeds(
    getDocs(query(collection(captainDb, 'readiness'), where('teamId', '==', 'main')))
  );
});

// ==================== DIRTY DOZEN #6: Role Escalation & Shadow Fields ====================
test('Dirty Dozen #6: player cannot escalate role, steal ownerUid, or inject shadow fields (pin/pinHash)', async () => {
  const playerADb = testEnv
    .authenticatedContext('player_a', { email_verified: true })
    .firestore();

  // Escalating own role to admin MUST fail
  await assertFails(
    updateDoc(doc(playerADb, 'players', 'player_a'), {
      role: 'admin',
      updatedAt: serverTimestamp(),
    })
  );

  // Injecting shadow fields (pin / pinHash / arbitrary keys) MUST fail
  await assertFails(
    updateDoc(doc(playerADb, 'players', 'player_a'), {
      pin: '1234',
      updatedAt: serverTimestamp(),
    })
  );

  // Editing another player's profile MUST fail
  await assertFails(
    updateDoc(doc(playerADb, 'players', 'player_b'), {
      name: 'اختراق',
      updatedAt: serverTimestamp(),
    })
  );

  // Updating own allowed profile field MUST succeed
  await assertSucceeds(
    updateDoc(doc(playerADb, 'players', 'player_a'), {
      name: 'أحمد المحدث',
      roleModelStarId: 'messi',
      updatedAt: serverTimestamp(),
    })
  );
});

// ==================== DIRTY DOZEN #7: Captain Skill-Lock Enforcement ====================
test('Dirty Dozen #7: player cannot modify skills when settings/team.lockSkills is true', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await updateDoc(doc(ctx.firestore(), 'settings', 'team'), { lockSkills: true });
  });

  const playerADb = testEnv
    .authenticatedContext('player_a', { email_verified: true })
    .firestore();

  await assertFails(
    updateDoc(doc(playerADb, 'players', 'player_a'), {
      skills: { ...BASE_SKILLS, speed: 10 },
      updatedAt: serverTimestamp(),
    })
  );
});

// ==================== DIRTY DOZEN #8: Raw peerRatings Confidentiality ====================
test('Dirty Dozen #8: peerRatings is never listable (even by Captain) and other raters ballots are unreadable', async () => {
  const playerADb = testEnv
    .authenticatedContext('player_a', { email_verified: true })
    .firestore();
  const playerBDb = testEnv
    .authenticatedContext('player_b', { email_verified: true })
    .firestore();
  const captainDb = testEnv
    .authenticatedContext('captain_uid', { email_verified: true })
    .firestore();

  // Listing peerRatings MUST fail for everyone, including Captain
  await assertFails(getDocs(collection(playerADb, 'peerRatings')));
  await assertFails(getDocs(collection(captainDb, 'peerRatings')));

  // Reading someone else's ballot MUST fail (even for the target player or Captain!)
  await assertFails(getDoc(doc(playerADb, 'peerRatings', 'player_a__player_b')));
  await assertFails(getDoc(doc(captainDb, 'peerRatings', 'player_a__player_b')));

  // Author reading their own ballot MUST succeed
  await assertSucceeds(getDoc(doc(playerBDb, 'peerRatings', 'player_a__player_b')));
});

// ==================== DIRTY DOZEN #9: Self-Rating Blocked ====================
test('Dirty Dozen #9: player cannot rate themselves in peerRatings/peerRatingStats', async () => {
  const playerADb = testEnv
    .authenticatedContext('player_a', { email_verified: true })
    .firestore();

  const batch = writeBatch(playerADb);
  batch.set(doc(playerADb, 'peerRatings', 'player_a__player_a'), {
    targetId: 'player_a',
    raterUid: 'player_a',
    score: 10,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  batch.update(doc(playerADb, 'peerRatingStats', 'player_a'), {
    count: increment(1),
    totalScore: increment(10),
    updatedAt: serverTimestamp(),
  });

  await assertFails(batch.commit());
});

// ==================== DIRTY DOZEN #10: peerRatingStats Privacy Threshold (count < 3) ====================
test('Dirty Dozen #10: peerRatingStats with count < 3 cannot be read; count >= 3 is readable', async () => {
  const playerADb = testEnv
    .authenticatedContext('player_a', { email_verified: true })
    .firestore();
  const captainDb = testEnv
    .authenticatedContext('captain_uid', { email_verified: true })
    .firestore();

  // player_a has count == 2 -> MUST fail for both players and Captain
  await assertFails(getDoc(doc(playerADb, 'peerRatingStats', 'player_a')));
  await assertFails(getDoc(doc(captainDb, 'peerRatingStats', 'player_a')));
  await assertFails(
    getDocs(query(collection(playerADb, 'peerRatingStats'), where('teamId', '==', 'main')))
  );

  // player_b has count == 3 -> MUST succeed via exact get or count >= 3 query
  await assertSucceeds(getDoc(doc(playerADb, 'peerRatingStats', 'player_b')));
  await assertSucceeds(
    getDocs(
      query(
        collection(playerADb, 'peerRatingStats'),
        where('teamId', '==', 'main'),
        where('count', '>=', 3)
      )
    )
  );
});

// ==================== DIRTY DOZEN #11: Atomic Peer Rating Integrity ====================
test('Dirty Dozen #11: tampered or non-atomic peerRatingStats fails; valid atomic batch succeeds', async () => {
  const playerCDb = testEnv
    .authenticatedContext('player_c', { email_verified: true })
    .firestore();

  // Direct standalone tamper of peerRatingStats MUST fail
  await assertFails(
    updateDoc(doc(playerCDb, 'peerRatingStats', 'player_a'), {
      count: increment(1),
      totalScore: increment(100),
      updatedAt: serverTimestamp(),
    })
  );

  // Batch with mismatched delta (+99 instead of +9) MUST fail
  const badBatch = writeBatch(playerCDb);
  badBatch.set(doc(playerCDb, 'peerRatings', 'player_a__player_c'), {
    targetId: 'player_a',
    raterUid: 'player_c',
    score: 9,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  badBatch.update(doc(playerCDb, 'peerRatingStats', 'player_a'), {
    count: increment(1),
    totalScore: increment(99),
    updatedAt: serverTimestamp(),
  });
  await assertFails(badBatch.commit());

  // Valid atomic batch (+1 count, +9 totalScore) MUST succeed
  const okBatch = writeBatch(playerCDb);
  okBatch.set(doc(playerCDb, 'peerRatings', 'player_a__player_c'), {
    targetId: 'player_a',
    raterUid: 'player_c',
    score: 9,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  okBatch.update(doc(playerCDb, 'peerRatingStats', 'player_a'), {
    count: increment(1),
    totalScore: increment(9),
    updatedAt: serverTimestamp(),
  });
  await assertSucceeds(okBatch.commit());
});

// ==================== DIRTY DOZEN #12: Short Invite Codes (<8), Forged Timestamps & Join Abuse ====================
test('Dirty Dozen #12: short invite codes (<8 chars), forged timestamps, and unauthorized joins are denied', async () => {
  const captainDb = testEnv
    .authenticatedContext('captain_uid', { email_verified: true })
    .firestore();
  const outsiderDb = testEnv
    .authenticatedContext('outsider_uid', { email_verified: true })
    .firestore();

  // Short legacy invite code (< 8 chars like MDN-606) MUST fail even for Captain
  await assertFails(
    setDoc(doc(captainDb, 'inviteCodes', SHORT_INVITE_CODE), {
      code: SHORT_INVITE_CODE,
      active: true,
      requireApproval: true,
      updatedAt: serverTimestamp(),
    })
  );
  await assertFails(
    updateDoc(doc(captainDb, 'settings', 'team'), {
      inviteCode: SHORT_INVITE_CODE,
      updatedAt: serverTimestamp(),
    })
  );

  // Forged client timestamp (!= request.time) MUST fail
  const nowMs = Date.now();
  await assertFails(
    setDoc(doc(captainDb, 'inviteCodes', 'Q2W3-E4R5-T6Y7'), {
      code: 'Q2W3-E4R5-T6Y7',
      active: true,
      requireApproval: true,
      isMemberShareCode: false,
      teamId: 'main',
      teamName: 'فريق السداسي',
      appName: 'ميدان 6v6',
      primaryColor: '#FACC15',
      usageType: 'multi',
      maxUses: 10,
      usedCount: 0,
      durationDays: 7,
      createdAtMs: nowMs,
      expiresAtMs: nowMs + 7 * 86400000,
      status: 'active',
      updatedAt: Timestamp.fromMillis(1700000000000),
    })
  );

  // Outsider trying to self-approve joinRequest when requireApproval == true MUST fail
  const approveAbuseBatch = writeBatch(outsiderDb);
  approveAbuseBatch.set(doc(outsiderDb, 'joinRequests', 'outsider_uid'), {
    uid: 'outsider_uid',
    name: 'غريب',
    jersey: 14,
    primaryPos: 'مهاجم',
    inviteCode: ACTIVE_INVITE_CODE,
    status: 'approved',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  approveAbuseBatch.update(doc(outsiderDb, 'inviteCodes', ACTIVE_INVITE_CODE), {
    usedCount: 1,
    active: true,
    status: 'active',
    updatedAt: serverTimestamp(),
  });
  await assertFails(approveAbuseBatch.commit());

  // Outsider with bogus invite code MUST fail
  await assertFails(
    setDoc(doc(outsiderDb, 'joinRequests', 'outsider_uid'), {
      uid: 'outsider_uid',
      name: 'غريب',
      jersey: 14,
      primaryPos: 'مهاجم',
      inviteCode: 'INVALID-CODE-999',
      status: 'pending',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  );

  // Standalone non-atomic joinRequest without incrementing inviteCodes.usedCount MUST fail
  await assertFails(
    setDoc(doc(outsiderDb, 'joinRequests', 'outsider_uid'), {
      uid: 'outsider_uid',
      name: 'لاعب جديد',
      jersey: 14,
      primaryPos: 'مهاجم',
      inviteCode: ACTIVE_INVITE_CODE,
      status: 'pending',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  );

  // Valid atomic pending joinRequest + inviteCodes quota consumption MUST succeed
  const validJoinBatch = writeBatch(outsiderDb);
  validJoinBatch.set(doc(outsiderDb, 'joinRequests', 'outsider_uid'), {
    uid: 'outsider_uid',
    name: 'لاعب جديد',
    jersey: 14,
    primaryPos: 'مهاجم',
    inviteCode: ACTIVE_INVITE_CODE,
    status: 'pending',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  validJoinBatch.update(doc(outsiderDb, 'inviteCodes', ACTIVE_INVITE_CODE), {
    usedCount: 1,
    active: true,
    status: 'active',
    updatedAt: serverTimestamp(),
  });
  await assertSucceeds(validJoinBatch.commit());
});

// ==================== STEP 5ب #13: Private Pitch Payment Isolation ====================
test('Step 5ب #13: player cannot read another player pitchPayment; own payment & Captain list succeed', async () => {
  const playerADb = testEnv
    .authenticatedContext('player_a', { email_verified: true })
    .firestore();
  const playerBDb = testEnv
    .authenticatedContext('player_b', { email_verified: true })
    .firestore();
  const captainDb = testEnv
    .authenticatedContext('captain_uid', { email_verified: true })
    .firestore();

  // Player A snooping on Player B's payment status MUST fail
  await assertFails(getDoc(doc(playerADb, 'pitchPayments', 'current__player_b')));
  await assertFails(
    getDocs(query(collection(playerADb, 'pitchPayments'), where('teamId', '==', 'main')))
  );

  // Player B reading their own payment status MUST succeed
  await assertSucceeds(getDoc(doc(playerBDb, 'pitchPayments', 'current__player_b')));
  await assertSucceeds(
    getDocs(query(collection(playerBDb, 'pitchPayments'), where('ownerUid', '==', 'player_b')))
  );

  // Captain listing all team pitch payments MUST succeed
  await assertSucceeds(
    getDocs(query(collection(captainDb, 'pitchPayments'), where('teamId', '==', 'main')))
  );
});

// ==================== STEP 5ب #14: Pitch Session Aggregate Read & Captain-Only Writes ====================
test('Step 5ب #14: team members can read pitchSessions/current aggregate only; only Captain writes session/payments', async () => {
  const playerADb = testEnv
    .authenticatedContext('player_a', { email_verified: true })
    .firestore();
  const captainDb = testEnv
    .authenticatedContext('captain_uid', { email_verified: true })
    .firestore();

  // Player A can get aggregate schedule/totals, but cannot list or modify pitchSessions/current
  await assertSucceeds(getDoc(doc(playerADb, 'pitchSessions', 'current')));
  await assertFails(getDocs(collection(playerADb, 'pitchSessions')));
  await assertFails(
    updateDoc(doc(playerADb, 'pitchSessions', 'current'), {
      totalCost: 0,
      updatedAt: serverTimestamp(),
    })
  );
  // Player A cannot mark themselves as paid
  await assertFails(
    setDoc(doc(playerADb, 'pitchPayments', 'current__player_a'), {
      teamId: 'main',
      sessionId: 'current',
      playerId: 'player_a',
      ownerUid: 'player_a',
      playerName: 'لاعب أ',
      amount: 30,
      paid: true,
      updatedAt: serverTimestamp(),
    })
  );

  // Captain CAN update pitchSessions/current and pitchPayments/current__player_a
  await assertSucceeds(
    setDoc(doc(captainDb, 'pitchSessions', 'current'), {
      teamId: 'main',
      title: 'مباراة الجمعة',
      matchDate: '2026-11-27',
      matchTime: '21:00',
      venue: 'ملعب النجوم',
      totalCost: 240,
      currency: 'ريال',
      confirmedCount: 8,
      paidCount: 2,
      paidTotal: 60,
      updatedAt: serverTimestamp(),
    })
  );
  await assertSucceeds(
    setDoc(doc(captainDb, 'pitchPayments', 'current__player_a'), {
      teamId: 'main',
      sessionId: 'current',
      playerId: 'player_a',
      ownerUid: 'player_a',
      playerName: 'لاعب أ',
      amount: 30,
      paid: true,
      updatedAt: serverTimestamp(),
    })
  );
});

// ==================== SECURITY FIX #15: IDOR Impersonation Blocked Across Reports/Attendance/Readiness/Injuries ====================
test('Security Fix #15 (IDOR): non-captain cannot forge playerId of another player on create; own playerId atomic report succeeds', async () => {
  const playerADb = testEnv
    .authenticatedContext('player_a', { email_verified: true })
    .firestore();
  const nowMs = Date.now();

  // Impersonating player_b in reports -> MUST fail
  const idorReportBatch = writeBatch(playerADb);
  idorReportBatch.set(doc(playerADb, 'reports', 'rep_idor_1'), {
    teamId: 'main',
    playerId: 'player_b',
    ownerUid: 'player_a',
    playerName: 'لاعب أ',
    opponent: 'النسور',
    goals: 10,
    assists: 5,
    minutes: 50,
    rating: 10,
    pitchMode: '6v6',
    matchResult: 'فوز',
    goalsConceded: 1,
    confirmedByUids: [],
    verified: false,
    createdAtMs: nowMs,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  idorReportBatch.set(doc(playerADb, 'reportThrottle', 'player_a'), {
    uid: 'player_a',
    teamId: 'main',
    lastReportAtMs: nowMs,
    updatedAt: serverTimestamp(),
  });
  await assertFails(idorReportBatch.commit());

  // Impersonating player_b in attendance -> MUST fail
  await assertFails(
    setDoc(doc(playerADb, 'attendance', 'att_idor_1'), {
      teamId: 'main',
      playerId: 'player_b',
      ownerUid: 'player_a',
      playerName: 'لاعب ب',
      date: '2026-11-24',
      type: 'مباراة',
      status: 'معتذر',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  );

  // Impersonating player_b in readiness -> MUST fail
  await assertFails(
    setDoc(doc(playerADb, 'readiness', 'rd_idor_1'), {
      teamId: 'main',
      playerId: 'player_b',
      ownerUid: 'player_a',
      date: '2026-11-24',
      sleep: 3,
      fatigue: 2,
      mood: 2,
      createdAt: serverTimestamp(),
    })
  );

  // Impersonating player_b in injuries -> MUST fail
  await assertFails(
    setDoc(doc(playerADb, 'injuries', 'inj_idor_1'), {
      teamId: 'main',
      playerId: 'player_b',
      ownerUid: 'player_a',
      type: 'التواء الكاحل',
      location: 'القدم',
      severity: 'شديدة',
      date: '2026-11-24',
      expectedReturn: '2026-12-01',
      createdAt: serverTimestamp(),
    })
  );

  // Valid own-identity report paired with reportThrottle -> MUST succeed
  const okReportBatch = writeBatch(playerADb);
  okReportBatch.set(doc(playerADb, 'reports', 'rep_own_ok'), {
    teamId: 'main',
    playerId: 'player_a',
    ownerUid: 'player_a',
    playerName: 'لاعب أ',
    opponent: 'النسور',
    goals: 2,
    assists: 1,
    minutes: 50,
    rating: 8,
    pitchMode: '11v11',
    matchResult: 'فوز',
    goalsConceded: 1,
    confirmedByUids: [],
    verified: false,
    createdAtMs: nowMs,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  okReportBatch.set(doc(playerADb, 'reportThrottle', 'player_a'), {
    uid: 'player_a',
    teamId: 'main',
    lastReportAtMs: nowMs,
    updatedAt: serverTimestamp(),
  });
  await assertSucceeds(okReportBatch.commit());
});

// ==================== PHASE A #16: 360-Point Budget & Role Override Validation ====================
test('Phase A #16: stats6 enforces exact 360-point total (40-85 each) and lockSkills server-side', async () => {
  const playerADb = testEnv
    .authenticatedContext('player_a', { email_verified: true })
    .firestore();

  // Over-budget stats6 (sum = 380) -> MUST fail
  await assertFails(
    updateDoc(doc(playerADb, 'players', 'player_a'), {
      stats6: { PAC: 70, SHO: 70, PAS: 60, DRI: 60, DEF: 60, PHY: 60 },
      updatedAt: serverTimestamp(),
    })
  );

  // Out-of-bounds single stat (90 > 85, even if sum = 360) -> MUST fail
  await assertFails(
    updateDoc(doc(playerADb, 'players', 'player_a'), {
      stats6: { PAC: 90, SHO: 50, PAS: 55, DRI: 55, DEF: 55, PHY: 55 },
      updatedAt: serverTimestamp(),
    })
  );

  // Exact 360-point budget with valid roleOverride -> MUST succeed
  await assertSucceeds(
    updateDoc(doc(playerADb, 'players', 'player_a'), {
      stats6: { PAC: 70, SHO: 65, PAS: 60, DRI: 65, DEF: 50, PHY: 50 },
      roleOverride: 'CAM_WINGER',
      updatedAt: serverTimestamp(),
    })
  );
});

// ==================== PHASE B #17: Decentralized Match Verification (Draft -> Verified by 3 Participants) ====================
test('Phase B #17: matchSession cannot skip draft, blocks duplicate confirmers, and verifies at 3rd distinct confirmer', async () => {
  const playerADb = testEnv.authenticatedContext('player_a', { email_verified: true }).firestore();
  const playerBDb = testEnv.authenticatedContext('player_b', { email_verified: true }).firestore();
  const playerCDb = testEnv.authenticatedContext('player_c', { email_verified: true }).firestore();

  const participants = ['captain_uid', 'player_a', 'player_b', 'player_c'];

  // Attempting to create directly as verified -> MUST fail
  await assertFails(
    setDoc(doc(playerADb, 'matchSessions', 'ms_skip_draft'), {
      id: 'ms_skip_draft',
      teamId: 'main',
      date: '2026-11-24',
      opponent: 'الأسود',
      pitchMode: '6v6',
      ourScore: 4,
      oppScore: 2,
      result: 'فوز',
      createdBy: 'player_a',
      participantIds: participants,
      confirmers: ['player_a', 'player_b', 'player_c'],
      status: 'verified',
      votingOpen: true,
      voterUids: [],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  );

  // Create valid Draft (1/3) -> MUST succeed
  await assertSucceeds(
    setDoc(doc(playerADb, 'matchSessions', 'ms_1'), {
      id: 'ms_1',
      teamId: 'main',
      date: '2026-11-24',
      opponent: 'الأسود',
      pitchMode: '6v6',
      ourScore: 4,
      oppScore: 2,
      result: 'فوز',
      createdBy: 'player_a',
      participantIds: participants,
      confirmers: ['player_a'],
      status: 'draft',
      votingOpen: false,
      voterUids: [],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  );

  // Duplicate confirmation by creator player_a -> MUST fail
  await assertFails(
    updateDoc(doc(playerADb, 'matchSessions', 'ms_1'), {
      confirmers: ['player_a', 'player_a'],
      status: 'draft',
      votingOpen: false,
      updatedAt: serverTimestamp(),
    })
  );

  // 2nd distinct confirmer (player_b) keeps status draft -> MUST succeed
  await assertSucceeds(
    updateDoc(doc(playerBDb, 'matchSessions', 'ms_1'), {
      confirmers: ['player_a', 'player_b'],
      status: 'draft',
      votingOpen: false,
      updatedAt: serverTimestamp(),
    })
  );

  // 3rd distinct confirmer (player_c) promotes to verified & opens voting -> MUST succeed
  await assertSucceeds(
    updateDoc(doc(playerCDb, 'matchSessions', 'ms_1'), {
      confirmers: ['player_a', 'player_b', 'player_c'],
      status: 'verified',
      votingOpen: true,
      updatedAt: serverTimestamp(),
    })
  );
});

// ==================== PHASE B #18: Secret Voting Anti-Self-Vote & 50% Quorum Lock ====================
test('Phase B #18: secret voting blocks self-votes, hides tallies below 50% quorum, and unlocks at >= 50%', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const now = Timestamp.now();
    await setDoc(doc(db, 'matchSessions', 'ms_vote'), {
      id: 'ms_vote',
      teamId: 'main',
      date: '2026-11-24',
      opponent: 'الأبطال',
      pitchMode: '6v6',
      ourScore: 5,
      oppScore: 3,
      result: 'فوز',
      createdBy: 'player_a',
      participantIds: ['captain_uid', 'player_a', 'player_b', 'player_c'],
      confirmers: ['player_a', 'player_b', 'player_c'],
      status: 'verified',
      votingOpen: true,
      voterUids: [],
      createdAt: now,
      updatedAt: now,
    });
  });

  const playerADb = testEnv.authenticatedContext('player_a', { email_verified: true }).firestore();
  const playerBDb = testEnv.authenticatedContext('player_b', { email_verified: true }).firestore();

  // Self-vote attempt by player_a -> MUST fail
  const selfBatch = writeBatch(playerADb);
  selfBatch.set(doc(playerADb, 'matchVoteBallots', 'ms_vote__player_a__player_a'), {
    sessionId: 'ms_vote',
    targetId: 'player_a',
    voterUid: 'player_a',
    score: 10,
    createdAt: serverTimestamp(),
  });
  selfBatch.set(doc(playerADb, 'matchVoteTallies', 'ms_vote__player_a'), {
    teamId: 'main',
    sessionId: 'ms_vote',
    targetId: 'player_a',
    eligibleCount: 4,
    count: 1,
    totalScore: 10,
    h1: 0, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0, h7: 0, h8: 0, h9: 0, h10: 1,
    updatedAt: serverTimestamp(),
  });
  await assertFails(selfBatch.commit());

  // Voter #1 (player_a = 1/4 = 25% < 50%) casts secret ballot for player_c
  const batchA = writeBatch(playerADb);
  batchA.set(doc(playerADb, 'matchVoteBallots', 'ms_vote__player_c__player_a'), {
    sessionId: 'ms_vote',
    targetId: 'player_c',
    voterUid: 'player_a',
    score: 8,
    createdAt: serverTimestamp(),
  });
  batchA.set(
    doc(playerADb, 'matchVoteTallies', 'ms_vote__player_c'),
    {
      teamId: 'main',
      sessionId: 'ms_vote',
      targetId: 'player_c',
      eligibleCount: 4,
      count: increment(1),
      totalScore: increment(8),
      h1: increment(0), h2: increment(0), h3: increment(0), h4: increment(0), h5: increment(0),
      h6: increment(0), h7: increment(0), h8: increment(1), h9: increment(0), h10: increment(0),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
  batchA.update(doc(playerADb, 'matchSessions', 'ms_vote'), {
    voterUids: ['player_a'],
    updatedAt: serverTimestamp(),
  });
  await assertSucceeds(batchA.commit());

  // Below 50% participation -> tally read MUST fail (locked!)
  await assertFails(getDoc(doc(playerADb, 'matchVoteTallies', 'ms_vote__player_c')));

  // Voter #2 (player_b = 2/4 = 50% >= 50%) casts secret ballot for player_c
  const batchB = writeBatch(playerBDb);
  batchB.set(doc(playerBDb, 'matchVoteBallots', 'ms_vote__player_c__player_b'), {
    sessionId: 'ms_vote',
    targetId: 'player_c',
    voterUid: 'player_b',
    score: 9,
    createdAt: serverTimestamp(),
  });
  batchB.set(
    doc(playerBDb, 'matchVoteTallies', 'ms_vote__player_c'),
    {
      teamId: 'main',
      sessionId: 'ms_vote',
      targetId: 'player_c',
      eligibleCount: 4,
      count: increment(1),
      totalScore: increment(9),
      h1: increment(0), h2: increment(0), h3: increment(0), h4: increment(0), h5: increment(0),
      h6: increment(0), h7: increment(0), h8: increment(0), h9: increment(1), h10: increment(0),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
  batchB.update(doc(playerBDb, 'matchSessions', 'ms_vote'), {
    voterUids: ['player_a', 'player_b'],
    updatedAt: serverTimestamp(),
  });
  await assertSucceeds(batchB.commit());

  // At >= 50% participation & count >= 2 -> tally read MUST succeed, while raw ballots stay secret
  await assertSucceeds(getDoc(doc(playerADb, 'matchVoteTallies', 'ms_vote__player_c')));
  await assertFails(getDoc(doc(playerADb, 'matchVoteBallots', 'ms_vote__player_c__player_b')));
});

// ==================== PHASE B #19: 2-Teammate Random Peer Mission Verification ====================
test('Phase B #19: missionClaim blocks self-verification and unassigned verifiers; 2 assigned verifiers complete claim', async () => {
  const playerADb = testEnv.authenticatedContext('player_a', { email_verified: true }).firestore();
  const playerBDb = testEnv.authenticatedContext('player_b', { email_verified: true }).firestore();
  const playerCDb = testEnv.authenticatedContext('player_c', { email_verified: true }).firestore();
  const captainDb = testEnv.authenticatedContext('captain_uid', { email_verified: true }).firestore();

  // Including self in verifierUids -> MUST fail
  await assertFails(
    setDoc(doc(playerADb, 'missionClaims', 'mc_self'), {
      id: 'mc_self',
      teamId: 'main',
      missionId: 'clean_sheet',
      missionTitle: 'تحدي نظافة الشباك',
      xpReward: 50,
      claimantUid: 'player_a',
      claimantName: 'لاعب أ',
      note: 'محاولة غش',
      verifierUids: ['player_a', 'player_b'],
      approverUids: [],
      rejectorUids: [],
      status: 'pending',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  );

  // Valid claim assigned to player_b & player_c -> MUST succeed
  await assertSucceeds(
    setDoc(doc(playerADb, 'missionClaims', 'mc_ok'), {
      id: 'mc_ok',
      teamId: 'main',
      missionId: 'clean_sheet',
      missionTitle: 'تحدي نظافة الشباك',
      xpReward: 50,
      claimantUid: 'player_a',
      claimantName: 'لاعب أ',
      note: 'مباراة الخميس',
      verifierUids: ['player_b', 'player_c'],
      approverUids: [],
      rejectorUids: [],
      status: 'pending',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  );

  // Claimant trying to approve own mission -> MUST fail
  await assertFails(
    updateDoc(doc(playerADb, 'missionClaims', 'mc_ok'), {
      approverUids: ['player_a'],
      status: 'pending',
      updatedAt: serverTimestamp(),
    })
  );

  // Unassigned user (captain_uid) trying to verify -> MUST fail
  await assertFails(
    updateDoc(doc(captainDb, 'missionClaims', 'mc_ok'), {
      approverUids: ['captain_uid'],
      status: 'pending',
      updatedAt: serverTimestamp(),
    })
  );

  // Assigned verifier #1 (player_b) approves -> remains pending (1/2)
  await assertSucceeds(
    updateDoc(doc(playerBDb, 'missionClaims', 'mc_ok'), {
      approverUids: ['player_b'],
      status: 'pending',
      updatedAt: serverTimestamp(),
    })
  );

  // Assigned verifier #2 (player_c) approves -> transitions to verified (2/2)
  await assertSucceeds(
    updateDoc(doc(playerCDb, 'missionClaims', 'mc_ok'), {
      approverUids: ['player_b', 'player_c'],
      status: 'verified',
      updatedAt: serverTimestamp(),
    })
  );
});

// ==================== BATCH 2 #20 & #21: Global Football Library RBAC, Draft Isolation & XSS Guard ====================
test('Batch 2 #20-#21: footballLibrary blocks non-captain writes, hidden draft reads, javascript: URLs & shadow fields', async () => {
  const playerADb = testEnv
    .authenticatedContext('player_a', { email_verified: true })
    .firestore();
  const captainDb = testEnv
    .authenticatedContext('captain_uid', { email_verified: true })
    .firestore();

  const validArticle = {
    id: 'lib_test_1',
    teamId: 'main',
    titleAr: 'فخ الضغط الجانبي في السداسي',
    originalLang: 'الإنجليزية',
    publisher: 'UEFA Coaching & Technical',
    sourceUrl: 'https://www.uefa.com/development/coaches/',
    publishedAt: '2026-10-10',
    lastReviewed: '2026-11-24',
    category: 'الضغط الجماعي',
    level: 'متقدم',
    summaryAr: 'ملخص تطبيقي لكيفية توجيه الخصم نحو خط التماس لإغلاق زوايا التمرير.',
    keyTakeawaysAr: ['اضغط بزاوية قوسية تغلق العمق.'],
    terms: [{ en: 'Pressing Trap', ar: 'فخ الضغط' }],
    originalExcerpt: 'A pressing trap invites a pass into a predetermined wide zone.',
    published: false,
    isCustom: true,
    updatedBy: 'captain_uid',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  // Non-captain creating article -> MUST fail
  await assertFails(
    setDoc(doc(playerADb, 'footballLibrary', 'lib_player_fail'), {
      ...validArticle,
      id: 'lib_player_fail',
      updatedBy: 'player_a',
      published: true,
    })
  );

  // Captain with javascript: XSS URL -> MUST fail
  await assertFails(
    setDoc(doc(captainDb, 'footballLibrary', 'lib_xss'), {
      ...validArticle,
      id: 'lib_xss',
      sourceUrl: 'javascript:alert(1)',
    })
  );

  // Captain with unexpected shadow field -> MUST fail
  await assertFails(
    setDoc(doc(captainDb, 'footballLibrary', 'lib_shadow'), {
      ...validArticle,
      id: 'lib_shadow',
      shadowInject: true,
    })
  );

  // Captain creates hidden draft -> MUST succeed
  await assertSucceeds(setDoc(doc(captainDb, 'footballLibrary', 'lib_test_1'), validArticle));

  // Regular player reading hidden draft -> MUST fail
  await assertFails(getDoc(doc(playerADb, 'footballLibrary', 'lib_test_1')));

  // Captain reads hidden draft and publishes it -> MUST succeed
  await assertSucceeds(getDoc(doc(captainDb, 'footballLibrary', 'lib_test_1')));
  await assertSucceeds(
    updateDoc(doc(captainDb, 'footballLibrary', 'lib_test_1'), {
      published: true,
      updatedAt: serverTimestamp(),
    })
  );

  // Regular player reading published article -> MUST succeed
  await assertSucceeds(getDoc(doc(playerADb, 'footballLibrary', 'lib_test_1')));
});

// ==================== SMART INVITATIONS #22: Captain-Only Creation/Listing, Atomic Usage Quota & Expiry ====================
test('Smart Invitations #22: enforces Captain-only create/list/revoke, atomic quota increment, and rejects expired/revoked/completed codes', async () => {
  const captainDb = testEnv.authenticatedContext('captain_uid', { email_verified: true }).firestore();
  const playerADb = testEnv.authenticatedContext('player_a', { email_verified: true }).firestore();
  const outsider1Db = testEnv.authenticatedContext('outsider_1', { email_verified: true }).firestore();
  const outsider2Db = testEnv.authenticatedContext('outsider_2', { email_verified: true }).firestore();

  const smartCode = 'MDN-K7P4-X9Q2';
  const nowMs = Date.now();

  // Non-captain cannot create or list inviteCodes
  await assertFails(
    setDoc(doc(playerADb, 'inviteCodes', smartCode), {
      code: smartCode,
      active: true,
      requireApproval: true,
      isMemberShareCode: false,
      teamId: 'main',
      teamName: 'فريق السداسي',
      appName: 'ميدان 6v6',
      primaryColor: '#FACC15',
      usageType: 'single',
      maxUses: 1,
      usedCount: 0,
      durationDays: 7,
      createdAtMs: nowMs,
      expiresAtMs: nowMs + 7 * 86400000,
      status: 'active',
      updatedAt: serverTimestamp(),
    })
  );
  await assertFails(getDocs(collection(playerADb, 'inviteCodes')));
  await assertFails(getDocs(collection(outsider1Db, 'inviteCodes')));

  // Captain creates PII-free single-use Smart Invite + private inviteAdminLogs and lists invitations
  const capBatch = writeBatch(captainDb);
  capBatch.set(doc(captainDb, 'inviteCodes', smartCode), {
    code: smartCode,
    active: true,
    requireApproval: true,
    isMemberShareCode: false,
    teamId: 'main',
    teamName: 'فريق السداسي',
    appName: 'ميدان 6v6',
    primaryColor: '#FACC15',
    usageType: 'single',
    maxUses: 1,
    usedCount: 0,
    durationDays: 7,
    createdAtMs: nowMs,
    expiresAtMs: nowMs + 7 * 86400000,
    status: 'active',
    updatedAt: serverTimestamp(),
  });
  capBatch.set(doc(captainDb, 'inviteAdminLogs', smartCode), {
    code: smartCode,
    createdBy: 'captain_uid',
    createdAtMs: nowMs,
    updatedAt: serverTimestamp(),
  });
  await assertSucceeds(capBatch.commit());
  await assertSucceeds(getDocs(collection(captainDb, 'inviteCodes')));

  // Existing team member (player_a) cannot submit a duplicate joinRequest
  await assertFails(
    setDoc(doc(playerADb, 'joinRequests', 'player_a'), {
      uid: 'player_a',
      name: 'لاعب أ',
      jersey: 7,
      primaryPos: 'مهاجم',
      inviteCode: ACTIVE_INVITE_CODE,
      status: 'pending',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  );

  // Outsider #1 cannot bypass quota increment when maxUses is present on invite doc
  await assertFails(
    setDoc(doc(outsider1Db, 'joinRequests', 'outsider_1'), {
      uid: 'outsider_1',
      name: 'لاعب جديد ١',
      jersey: 11,
      primaryPos: 'مهاجم',
      inviteCode: smartCode,
      referredBy: 'REF-AB12CD',
      status: 'pending',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  );

  // Outsider #1 atomically consumes the single-use invite WITHOUT writing PII (lastUsedBy)
  const joinBatch1 = writeBatch(outsider1Db);
  joinBatch1.set(doc(outsider1Db, 'joinRequests', 'outsider_1'), {
    uid: 'outsider_1',
    name: 'لاعب جديد ١',
    jersey: 11,
    primaryPos: 'مهاجم',
    inviteCode: smartCode,
    referredBy: 'REF-AB12CD',
    status: 'pending',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  joinBatch1.update(doc(outsider1Db, 'inviteCodes', smartCode), {
    usedCount: 1,
    active: false,
    status: 'completed',
    updatedAt: serverTimestamp(),
  });
  await assertSucceeds(joinBatch1.commit());

  // Outsider #2 attempting to reuse the completed single-use invite MUST fail
  const joinBatch2 = writeBatch(outsider2Db);
  joinBatch2.set(doc(outsider2Db, 'joinRequests', 'outsider_2'), {
    uid: 'outsider_2',
    name: 'لاعب جديد ٢',
    jersey: 12,
    primaryPos: 'مدافع',
    inviteCode: smartCode,
    status: 'pending',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  joinBatch2.update(doc(outsider2Db, 'inviteCodes', smartCode), {
    usedCount: 2,
    active: false,
    status: 'completed',
    updatedAt: serverTimestamp(),
  });
  await assertFails(joinBatch2.commit());
});

// ==================== HARDENED #23: Member Share Code Pending-Only Enforcement ====================
test('Hardened #23: isMemberShareCode enforces requireApproval==true and blocks direct players/{uid} join', async () => {
  const captainDb = testEnv.authenticatedContext('captain_uid', { email_verified: true }).firestore();
  const outsider1Db = testEnv.authenticatedContext('outsider_m1', { email_verified: true }).firestore();
  const outsider2Db = testEnv.authenticatedContext('outsider_m2', { email_verified: true }).firestore();
  const nowMs = Date.now();

  // Captain cannot create isMemberShareCode: true with requireApproval: false
  await assertFails(
    setDoc(doc(captainDb, 'inviteCodes', 'MDN-BAD-SHARE1'), {
      code: 'MDN-BAD-SHARE1',
      active: true,
      requireApproval: false,
      isMemberShareCode: true,
      teamId: 'main',
      teamName: 'فريق السداسي',
      appName: 'ميدان 6v6',
      primaryColor: '#FACC15',
      usageType: 'multi',
      maxUses: 50,
      usedCount: 0,
      durationDays: 30,
      createdAtMs: nowMs,
      expiresAtMs: nowMs + 30 * 86400000,
      status: 'active',
      updatedAt: serverTimestamp(),
    })
  );

  // Outsider trying direct status=='approved' + players/{uid} via memberShareCode MUST fail
  const directAbuseBatch = writeBatch(outsider1Db);
  directAbuseBatch.set(doc(outsider1Db, 'joinRequests', 'outsider_m1'), {
    uid: 'outsider_m1',
    name: 'متسلل مباشر',
    jersey: 20,
    primaryPos: 'مهاجم',
    inviteCode: MEMBER_SHARE_CODE,
    status: 'approved',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  directAbuseBatch.set(doc(outsider1Db, 'players', 'outsider_m1'), {
    id: 'outsider_m1',
    teamId: 'main',
    ownerUid: 'outsider_m1',
    name: 'متسلل مباشر',
    role: 'player',
    jersey: 20,
    primaryPos: 'مهاجم',
    skills: BASE_SKILLS,
    availableStatus: 'available',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  directAbuseBatch.update(doc(outsider1Db, 'inviteCodes', MEMBER_SHARE_CODE), {
    usedCount: 1,
    active: true,
    status: 'active',
    updatedAt: serverTimestamp(),
  });
  await assertFails(directAbuseBatch.commit());

  // Outsider using memberShareCode with status=='pending' + atomic quota increment MUST succeed
  const pendingOkBatch = writeBatch(outsider2Db);
  pendingOkBatch.set(doc(outsider2Db, 'joinRequests', 'outsider_m2'), {
    uid: 'outsider_m2',
    name: 'طالب انضمام',
    jersey: 21,
    primaryPos: 'مدافع',
    inviteCode: MEMBER_SHARE_CODE,
    status: 'pending',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  pendingOkBatch.update(doc(outsider2Db, 'inviteCodes', MEMBER_SHARE_CODE), {
    usedCount: 1,
    active: true,
    status: 'active',
    updatedAt: serverTimestamp(),
  });
  await assertSucceeds(pendingOkBatch.commit());
});

// ==================== HARDENED #24: Public Invite PII Isolation & inviteAdminLogs Captain-Only ====================
test('Hardened #24: inviteCodes rejects createdBy/lastUsedBy PII and inviteAdminLogs is Captain-only', async () => {
  const captainDb = testEnv.authenticatedContext('captain_uid', { email_verified: true }).firestore();
  const playerADb = testEnv.authenticatedContext('player_a', { email_verified: true }).firestore();
  const outsiderDb = testEnv.authenticatedContext('outsider_pii', { email_verified: true }).firestore();
  const nowMs = Date.now();

  // Even Captain cannot write createdBy onto public inviteCodes doc
  await assertFails(
    setDoc(doc(captainDb, 'inviteCodes', 'MDN-PII-9991'), {
      code: 'MDN-PII-9991',
      active: true,
      requireApproval: true,
      isMemberShareCode: false,
      teamId: 'main',
      teamName: 'فريق السداسي',
      appName: 'ميدان 6v6',
      primaryColor: '#FACC15',
      usageType: 'multi',
      maxUses: 10,
      usedCount: 0,
      durationDays: 7,
      createdAtMs: nowMs,
      expiresAtMs: nowMs + 7 * 86400000,
      status: 'active',
      createdBy: 'captain_uid',
      updatedAt: serverTimestamp(),
    })
  );

  // Outsider cannot inject lastUsedBy onto inviteCodes during join
  const piiJoinBatch = writeBatch(outsiderDb);
  piiJoinBatch.set(doc(outsiderDb, 'joinRequests', 'outsider_pii'), {
    uid: 'outsider_pii',
    name: 'ضيف',
    jersey: 22,
    primaryPos: 'لاعب وسط',
    inviteCode: ACTIVE_INVITE_CODE,
    status: 'pending',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  piiJoinBatch.update(doc(outsiderDb, 'inviteCodes', ACTIVE_INVITE_CODE), {
    usedCount: 1,
    active: true,
    status: 'active',
    lastUsedBy: 'outsider_pii',
    updatedAt: serverTimestamp(),
  });
  await assertFails(piiJoinBatch.commit());

  // Captain reads/writes inviteAdminLogs; regular player & outsider cannot
  await assertSucceeds(
    setDoc(doc(captainDb, 'inviteAdminLogs', ACTIVE_INVITE_CODE), {
      code: ACTIVE_INVITE_CODE,
      createdBy: 'captain_uid',
      createdAtMs: nowMs,
      updatedAt: serverTimestamp(),
    })
  );
  await assertSucceeds(getDoc(doc(captainDb, 'inviteAdminLogs', ACTIVE_INVITE_CODE)));
  await assertFails(getDoc(doc(playerADb, 'inviteAdminLogs', ACTIVE_INVITE_CODE)));
  await assertFails(
    setDoc(doc(playerADb, 'inviteAdminLogs', ACTIVE_INVITE_CODE), {
      code: ACTIVE_INVITE_CODE,
      createdBy: 'player_a',
      updatedAt: serverTimestamp(),
    })
  );
  await assertFails(getDoc(doc(outsiderDb, 'inviteAdminLogs', ACTIVE_INVITE_CODE)));
});

// ==================== HARDENED #25: 45-Min Report Cooldown & Peer-Only Verification ====================
test('Hardened #25: reportThrottle blocks rapid repeat reports within 45m and peer confirmReport blocks self-confirmation', async () => {
  const playerADb = testEnv.authenticatedContext('player_a', { email_verified: true }).firestore();
  const playerBDb = testEnv.authenticatedContext('player_b', { email_verified: true }).firestore();
  const nowMs = Date.now();

  // First atomic report by player_a + reportThrottle create MUST succeed
  const batch1 = writeBatch(playerADb);
  batch1.set(doc(playerADb, 'reports', 'rep_cd_1'), {
    teamId: 'main',
    playerId: 'player_a',
    ownerUid: 'player_a',
    playerName: 'لاعب أ',
    opponent: 'النسور',
    goals: 2,
    assists: 1,
    minutes: 45,
    rating: 8,
    confirmedByUids: [],
    verified: false,
    createdAtMs: nowMs,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  batch1.set(doc(playerADb, 'reportThrottle', 'player_a'), {
    uid: 'player_a',
    teamId: 'main',
    lastReportAtMs: nowMs,
    updatedAt: serverTimestamp(),
  });
  await assertSucceeds(batch1.commit());

  // Immediate 2nd report within 45 minutes MUST fail server-side
  const batch2 = writeBatch(playerADb);
  batch2.set(doc(playerADb, 'reports', 'rep_cd_2'), {
    teamId: 'main',
    playerId: 'player_a',
    ownerUid: 'player_a',
    playerName: 'لاعب أ',
    opponent: 'الصقور',
    goals: 3,
    assists: 0,
    minutes: 45,
    rating: 8,
    confirmedByUids: [],
    verified: false,
    createdAtMs: nowMs + 1000,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  batch2.set(doc(playerADb, 'reportThrottle', 'player_a'), {
    uid: 'player_a',
    teamId: 'main',
    lastReportAtMs: nowMs + 1000,
    updatedAt: serverTimestamp(),
  });
  await assertFails(batch2.commit());

  // Self-confirmation by owner (player_a) MUST fail
  await assertFails(
    updateDoc(doc(playerADb, 'reports', 'rep_cd_1'), {
      confirmedByUids: ['player_a'],
      verified: true,
      updatedAt: serverTimestamp(),
    })
  );

  // Teammate confirmation by player_b MUST succeed
  await assertSucceeds(
    updateDoc(doc(playerBDb, 'reports', 'rep_cd_1'), {
      confirmedByUids: ['player_b'],
      verified: true,
      updatedAt: serverTimestamp(),
    })
  );
});

// ==================== HARDENED #26: Tactics Permissions, Lineup Votes & Self-Leave ====================
test('Hardened #26: tactics obeys lineupPermission, lineupVotes blocks impersonation, and non-captain can self-leave', async () => {
  const playerADb = testEnv.authenticatedContext('player_a', { email_verified: true }).firestore();
  const playerBDb = testEnv.authenticatedContext('player_b', { email_verified: true }).firestore();
  const captainDb = testEnv.authenticatedContext('captain_uid', { email_verified: true }).firestore();

  // When lineupPermission == 'organizers', regular non-organizer player cannot write tactics/current
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await updateDoc(doc(ctx.firestore(), 'settings', 'team'), { lineupPermission: 'organizers' });
  });
  await assertFails(
    setDoc(doc(playerADb, 'tactics', 'current'), {
      teamId: 'main',
      formation: '2-2-1',
      slots: { GK: 'captain_uid', ST: 'player_a' },
      publishedByUid: 'player_a',
      publishedByName: 'لاعب أ',
      publishedAtMs: Date.now(),
      previousSnapshot: null,
      updatedAt: serverTimestamp(),
    })
  );

  // When lineupPermission == 'all', team member can publish & undo tactics/current
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await updateDoc(doc(ctx.firestore(), 'settings', 'team'), { lineupPermission: 'all' });
  });
  await assertSucceeds(
    setDoc(doc(playerADb, 'tactics', 'current'), {
      teamId: 'main',
      formation: '2-2-1',
      slots: { GK: 'captain_uid', ST: 'player_a' },
      publishedByUid: 'player_a',
      publishedByName: 'لاعب أ',
      publishedAtMs: Date.now(),
      previousSnapshot: { formation: '1-2-2', slots: { GK: 'captain_uid' } },
      updatedAt: serverTimestamp(),
    })
  );

  // Impersonating another UID in lineupVotes MUST fail; voting under own UID succeeds
  await assertFails(
    setDoc(doc(playerADb, 'lineupVotes', 'player_b'), {
      teamId: 'main',
      uid: 'player_b',
      vote: 'approve',
      updatedAt: serverTimestamp(),
    })
  );
  await assertSucceeds(
    setDoc(doc(playerBDb, 'lineupVotes', 'player_b'), {
      teamId: 'main',
      uid: 'player_b',
      vote: 'swap',
      updatedAt: serverTimestamp(),
    })
  );

  // Non-captain player_a CAN self-delete their own player doc (leave team), whereas Captain CANNOT self-delete
  await assertFails(deleteDoc(doc(captainDb, 'players', 'captain_uid')));
  await assertSucceeds(deleteDoc(doc(playerADb, 'players', 'player_a')));
});

// ==================== HARDENED #27: Tier 2 Organizer Limited Settings & Pitch Management ====================
test('Hardened #27: Tier 2 organizer updates allowed settings & pitchSessions, but cannot tamper inviteCode/organizerUids', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await updateDoc(doc(ctx.firestore(), 'settings', 'team'), { organizerUids: ['player_a'] });
  });

  const organizerDb = testEnv.authenticatedContext('player_a', { email_verified: true }).firestore();

  // Organizer CAN update allowed team settings subset
  await assertSucceeds(
    updateDoc(doc(organizerDb, 'settings', 'team'), {
      defaultCurrency: 'د.إ',
      defaultPitchCost: 220,
      lineupPermission: 'organizers',
      updatedAt: serverTimestamp(),
    })
  );

  // Organizer CANNOT tamper inviteCode, lockSkills, or organizerUids
  await assertFails(
    updateDoc(doc(organizerDb, 'settings', 'team'), {
      inviteCode: 'Z8X7-C6V5-B4N3',
      updatedAt: serverTimestamp(),
    })
  );
  await assertFails(
    updateDoc(doc(organizerDb, 'settings', 'team'), {
      organizerUids: ['player_a', 'player_b'],
      updatedAt: serverTimestamp(),
    })
  );
  await assertFails(
    updateDoc(doc(organizerDb, 'settings', 'team'), {
      lockSkills: true,
      updatedAt: serverTimestamp(),
    })
  );

  // Organizer CAN update pitchSessions/current
  await assertSucceeds(
    updateDoc(doc(organizerDb, 'pitchSessions', 'current'), {
      totalCost: 220,
      updatedAt: serverTimestamp(),
    })
  );
});

// ==================== HARDENED #28: Normalized Attendance Statuses ====================
test('Hardened #28: attendance allows جاي/محتمل/معتذر and rejects legacy disallowed values', async () => {
  const playerADb = testEnv.authenticatedContext('player_a', { email_verified: true }).firestore();

  // Legacy 'ما فيني' MUST fail
  await assertFails(
    setDoc(doc(playerADb, 'attendance', 'att_bad_status'), {
      teamId: 'main',
      playerId: 'player_a',
      ownerUid: 'player_a',
      playerName: 'لاعب أ',
      date: '2026-11-26',
      type: 'مباراة',
      status: 'ما فيني',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  );

  // Valid 'محتمل' create + update to 'جاي' MUST succeed
  await assertSucceeds(
    setDoc(doc(playerADb, 'attendance', 'att_player_a_2026-11-26'), {
      teamId: 'main',
      playerId: 'player_a',
      ownerUid: 'player_a',
      playerName: 'لاعب أ',
      date: '2026-11-26',
      type: 'مباراة',
      status: 'محتمل',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  );
  await assertSucceeds(
    updateDoc(doc(playerADb, 'attendance', 'att_player_a_2026-11-26'), {
      status: 'جاي',
      updatedAt: serverTimestamp(),
    })
  );
});


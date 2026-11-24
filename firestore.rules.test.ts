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

    // 2. Team settings + active 12-char CSPRNG invite code
    await setDoc(doc(db, 'settings', 'team'), {
      teamId: 'main',
      appName: 'ميدان 6v6',
      teamName: 'فريق السداسي',
      primaryColor: '#FACC15',
      secondaryColor: '#EAB308',
      logo: '',
      inviteCode: ACTIVE_INVITE_CODE,
      requireApproval: true,
      lockSkills: false,
      themeVersion: 'royal_v2',
      updatedAt: now,
    });
    await setDoc(doc(db, 'inviteCodes', ACTIVE_INVITE_CODE), {
      code: ACTIVE_INVITE_CODE,
      active: true,
      requireApproval: true,
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
  const rules = fs.readFileSync(path.resolve('firestore.rules'), 'utf8');
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
  await assertFails(
    setDoc(doc(captainDb, 'inviteCodes', 'Q2W3-E4R5-T6Y7'), {
      code: 'Q2W3-E4R5-T6Y7',
      active: true,
      requireApproval: true,
      updatedAt: Timestamp.fromMillis(1700000000000),
    })
  );

  // Outsider trying to self-approve joinRequest when requireApproval == true MUST fail
  await assertFails(
    setDoc(doc(outsiderDb, 'joinRequests', 'outsider_uid'), {
      uid: 'outsider_uid',
      name: 'غريب',
      jersey: 14,
      primaryPos: 'مهاجم',
      inviteCode: ACTIVE_INVITE_CODE,
      status: 'approved',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  );

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

  // Outsider submitting valid pending joinRequest with active 12-char invite code MUST succeed
  await assertSucceeds(
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

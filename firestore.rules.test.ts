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

// ==================== SECURITY FIX #15: IDOR Impersonation Blocked Across Reports/Attendance/Readiness/Injuries ====================
test('Security Fix #15 (IDOR): non-captain cannot forge playerId of another player on create; own playerId succeeds', async () => {
  const playerADb = testEnv
    .authenticatedContext('player_a', { email_verified: true })
    .firestore();

  // Impersonating player_b in reports -> MUST fail
  await assertFails(
    setDoc(doc(playerADb, 'reports', 'rep_idor_1'), {
      teamId: 'main',
      playerId: 'player_b',
      ownerUid: 'player_a',
      opponent: 'النسور',
      goals: 10,
      assists: 5,
      minutes: 50,
      rating: 10,
      pitchMode: '6v6',
      matchResult: 'فوز',
      goalsConceded: 1,
      createdAt: serverTimestamp(),
    })
  );

  // Impersonating player_b in attendance -> MUST fail
  await assertFails(
    setDoc(doc(playerADb, 'attendance', 'att_idor_1'), {
      teamId: 'main',
      playerId: 'player_b',
      ownerUid: 'player_a',
      playerName: 'لاعب ب',
      date: '2026-11-24',
      type: 'مباراة',
      status: 'ما فيني',
      createdAt: serverTimestamp(),
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

  // Valid own-identity report with Phase A fields -> MUST succeed
  await assertSucceeds(
    setDoc(doc(playerADb, 'reports', 'rep_own_ok'), {
      teamId: 'main',
      playerId: 'player_a',
      ownerUid: 'player_a',
      opponent: 'النسور',
      goals: 2,
      assists: 1,
      minutes: 50,
      rating: 8,
      pitchMode: '11v11',
      matchResult: 'فوز',
      goalsConceded: 1,
      createdAt: serverTimestamp(),
    })
  );
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



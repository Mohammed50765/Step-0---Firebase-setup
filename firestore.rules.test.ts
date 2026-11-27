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
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  chunkItemsForBatch,
  groupLegacyAttendanceByMatchKey,
  splitPlayerPublicAndPrivate,
  verifyMigrationCountReport,
} from './src/multiTeamEngine';
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
  const raw = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8089';
  const [host, portStr] = raw.split(':');
  return { host: host || '127.0.0.1', port: Number(portStr) || 8089 };
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
  const { host: rawHost, port } = parseEmulatorHost();
  const host = rawHost === 'localhost' ? '127.0.0.1' : rawHost;
  const rulesPath = process.env.RULES_FILE || 'firestore.rules';
  const rules = fs.readFileSync(path.resolve(rulesPath), 'utf8');
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      testEnv = await initializeTestEnvironment({
        projectId: PROJECT_ID,
        firestore: { host, port, rules },
      });
      return;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  throw lastErr;
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

async function seedMultiTeamPair(): Promise<void> {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const now = Timestamp.now();
    const nowMs = Date.now();

    await setDoc(doc(db, 'platform', 'config'), {
      allowNewTeams: true,
      updatedAt: now,
    });

    await setDoc(doc(db, 'teams', 'team_alpha'), {
      id: 'team_alpha',
      teamName: 'فريق ألفا',
      appName: 'ميدان 6v6',
      founderUid: 'founder_a',
      organizerUids: ['org_a'],
      primaryColor: '#FACC15',
      secondaryColor: '#EAB308',
      logo: '',
      joinMode: 'approval',
      lineupPublishMode: 'all',
      defaultCurrency: 'ريال',
      defaultPitchCost: 180,
      maxMembersPerTeam: 25,
      memberCount: 3,
      inviteCode: 'MT-ALPH-1111',
      memberShareCode: 'MS-ALPH-1111',
      lockSkills: false,
      deletedAt: null,
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
      createdAt: now,
      updatedAt: now,
    });

    await setDoc(doc(db, 'teams', 'team_beta'), {
      id: 'team_beta',
      teamName: 'فريق بيتا',
      appName: 'ميدان 6v6',
      founderUid: 'founder_b',
      organizerUids: [],
      primaryColor: '#22C55E',
      secondaryColor: '#16A34A',
      logo: '',
      joinMode: 'instant',
      lineupPublishMode: 'organizers',
      defaultCurrency: 'ريال',
      defaultPitchCost: 160,
      maxMembersPerTeam: 25,
      memberCount: 1,
      inviteCode: 'MT-BETA-2222',
      memberShareCode: 'MS-BETA-2222',
      lockSkills: false,
      deletedAt: null,
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
      createdAt: now,
      updatedAt: now,
    });

    const mkMember = (uid: string, teamId: string, name: string, role: 'founder' | 'organizer' | 'member', isOrg: boolean, jersey: number) => ({
      id: uid,
      uid,
      ownerUid: uid,
      teamId,
      name,
      role,
      isOrganizer: isOrg,
      jersey,
      primaryPos: 'مهاجم',
      skills: BASE_SKILLS,
      availableStatus: 'متاح',
      joinedAtMs: nowMs,
      updatedAtMs: nowMs,
      createdAt: now,
      updatedAt: now,
    });

    await setDoc(doc(db, 'teams', 'team_alpha', 'members', 'founder_a'), mkMember('founder_a', 'team_alpha', 'مؤسس ألفا', 'founder', true, 10));
    await setDoc(doc(db, 'teams', 'team_alpha', 'members', 'org_a'), mkMember('org_a', 'team_alpha', 'منظم ألفا', 'organizer', true, 8));
    await setDoc(doc(db, 'teams', 'team_alpha', 'members', 'mem_a'), mkMember('mem_a', 'team_alpha', 'عضو ألفا', 'member', false, 9));
    await setDoc(doc(db, 'teams', 'team_beta', 'members', 'founder_b'), mkMember('founder_b', 'team_beta', 'مؤسس بيتا', 'founder', true, 7));

    await setDoc(doc(db, 'users', 'founder_a'), {
      uid: 'founder_a',
      displayName: 'مؤسس ألفا',
      teamIds: ['team_alpha'],
      ownedTeamIds: ['team_alpha'],
      activeTeamId: 'team_alpha',
      updatedAt: now,
    });
    await setDoc(doc(db, 'users', 'org_a'), {
      uid: 'org_a',
      displayName: 'منظم ألفا',
      teamIds: ['team_alpha'],
      ownedTeamIds: [],
      activeTeamId: 'team_alpha',
      updatedAt: now,
    });
    await setDoc(doc(db, 'users', 'mem_a'), {
      uid: 'mem_a',
      displayName: 'عضو ألفا',
      teamIds: ['team_alpha'],
      ownedTeamIds: [],
      activeTeamId: 'team_alpha',
      updatedAt: now,
    });

    await setDoc(doc(db, 'inviteCodes', 'MT-ALPH-1111'), {
      code: 'MT-ALPH-1111',
      active: true,
      joinMode: 'approval',
      requireApproval: true,
      isMemberShareCode: false,
      teamId: 'team_alpha',
      teamName: 'فريق ألفا',
      appName: 'ميدان 6v6',
      primaryColor: '#FACC15',
      usageType: 'multi',
      maxUses: 25,
      usedCount: 0,
      durationDays: 14,
      createdAtMs: nowMs,
      expiresAtMs: nowMs + 14 * 86400000,
      status: 'active',
      updatedAt: now,
    });

    await setDoc(doc(db, 'inviteCodes', 'MT-BETA-2222'), {
      code: 'MT-BETA-2222',
      active: true,
      joinMode: 'instant',
      requireApproval: false,
      isMemberShareCode: false,
      teamId: 'team_beta',
      teamName: 'فريق بيتا',
      appName: 'ميدان 6v6',
      primaryColor: '#22C55E',
      usageType: 'multi',
      maxUses: 25,
      usedCount: 0,
      durationDays: 14,
      createdAtMs: nowMs,
      expiresAtMs: nowMs + 14 * 86400000,
      status: 'active',
      updatedAt: now,
    });

    await setDoc(doc(db, 'teams', 'team_alpha', 'reports', 'rep_alpha_seed'), {
      teamId: 'team_alpha',
      playerId: 'mem_a',
      ownerUid: 'mem_a',
      playerName: 'عضو ألفا',
      opponent: 'النجوم',
      goals: 1,
      assists: 1,
      minutes: 45,
      rating: 8,
      confirmedByUids: [],
      verified: false,
      createdAtMs: nowMs,
      createdAt: now,
      updatedAt: now,
    });
  });
}

// ==================== MULTI-TEAM #29: Cross-Team & Platform-Owner Isolation ====================
test('Multi-Team #29: blocks cross-team reads/writes, blocks listing /teams, and denies non-member Platform Owner access', async () => {
  await seedMultiTeamPair();
  const founderBDb = testEnv.authenticatedContext('founder_b', { email_verified: true }).firestore();
  const captainOwnerDb = testEnv.authenticatedContext('captain_uid', { email_verified: true }).firestore();
  const founderADb = testEnv.authenticatedContext('founder_a', { email_verified: true }).firestore();

  // Member of team_beta CANNOT read or write team_alpha docs
  await assertFails(getDoc(doc(founderBDb, 'teams', 'team_alpha')));
  await assertFails(getDoc(doc(founderBDb, 'teams', 'team_alpha', 'members', 'mem_a')));
  await assertFails(getDoc(doc(founderBDb, 'teams', 'team_alpha', 'reports', 'rep_alpha_seed')));
  await assertFails(
    setDoc(doc(founderBDb, 'teams', 'team_alpha', 'tactics', 'current'), {
      teamId: 'team_alpha',
      formation: '2-2-1',
      slots: {},
      updatedAt: serverTimestamp(),
    })
  );

  // Listing /teams root is blocked for everyone (even Platform Owner)
  await assertFails(getDocs(collection(founderADb, 'teams')));
  await assertFails(getDocs(collection(captainOwnerDb, 'teams')));

  // Platform Owner (admins/captain_uid) who is NOT a member of team_alpha has ZERO access
  await assertFails(getDoc(doc(captainOwnerDb, 'teams', 'team_alpha')));
  await assertFails(getDoc(doc(captainOwnerDb, 'teams', 'team_alpha', 'members', 'mem_a')));
  await assertFails(getDoc(doc(captainOwnerDb, 'teams', 'team_alpha', 'reports', 'rep_alpha_seed')));
});

// ==================== MULTI-TEAM #30: Zero-Health-Leak, Anti-Escalation & lockSkills ====================
test('Multi-Team #30: members doc rejects health/PIN fields, role self-escalation, and lockSkills bypass', async () => {
  await seedMultiTeamPair();
  const memADb = testEnv.authenticatedContext('mem_a', { email_verified: true }).firestore();

  // Injecting health/medical/PIN fields onto public members/{uid} MUST fail
  await assertFails(updateDoc(doc(memADb, 'teams', 'team_alpha', 'members', 'mem_a'), { sleep: 7, updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(memADb, 'teams', 'team_alpha', 'members', 'mem_a'), { injury: 'شد عضلي', updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(memADb, 'teams', 'team_alpha', 'members', 'mem_a'), { pin: '1234', updatedAt: serverTimestamp() }));

  // Role self-escalation MUST fail
  await assertFails(updateDoc(doc(memADb, 'teams', 'team_alpha', 'members', 'mem_a'), { role: 'founder', updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(memADb, 'teams', 'team_alpha', 'members', 'mem_a'), { isOrganizer: true, updatedAt: serverTimestamp() }));

  // When lockSkills == true, non-founder CANNOT modify skills, while jersey update succeeds
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await updateDoc(doc(ctx.firestore(), 'teams', 'team_alpha'), { lockSkills: true });
  });
  await assertFails(
    updateDoc(doc(memADb, 'teams', 'team_alpha', 'members', 'mem_a'), {
      skills: { ...BASE_SKILLS, speed: 10 },
      updatedAt: serverTimestamp(),
    })
  );
  await assertSucceeds(
    updateDoc(doc(memADb, 'teams', 'team_alpha', 'members', 'mem_a'), {
      jersey: 14,
      updatedAt: serverTimestamp(),
    })
  );
});

// ==================== MULTI-TEAM #31: Strictly Isolated /private/* Records ====================
test('Multi-Team #31: /private/* allows owner + team founder only, denying teammates, organizers, and platform owner', async () => {
  await seedMultiTeamPair();
  const memADb = testEnv.authenticatedContext('mem_a', { email_verified: true }).firestore();
  const orgADb = testEnv.authenticatedContext('org_a', { email_verified: true }).firestore();
  const founderADb = testEnv.authenticatedContext('founder_a', { email_verified: true }).firestore();
  const captainOwnerDb = testEnv.authenticatedContext('captain_uid', { email_verified: true }).firestore();

  const privRef = doc(memADb, 'teams', 'team_alpha', 'members', 'mem_a', 'private', 'rd_1');
  await assertSucceeds(
    setDoc(privRef, {
      kind: 'readiness',
      uid: 'mem_a',
      teamId: 'team_alpha',
      date: '2026-12-01',
      sleep: 8,
      fatigue: 3,
      mood: 9,
      updatedAtMs: Date.now(),
      createdAt: serverTimestamp(),
    })
  );

  // Owner + Team Founder succeed
  await assertSucceeds(getDoc(privRef));
  await assertSucceeds(getDocs(collection(founderADb, 'teams', 'team_alpha', 'members', 'mem_a', 'private')));

  // Teammate / Organizer (non-founder) / Platform Owner (non-member) fail
  await assertFails(getDoc(doc(orgADb, 'teams', 'team_alpha', 'members', 'mem_a', 'private', 'rd_1')));
  await assertFails(getDocs(collection(orgADb, 'teams', 'team_alpha', 'members', 'mem_a', 'private')));
  await assertFails(getDoc(doc(captainOwnerDb, 'teams', 'team_alpha', 'members', 'mem_a', 'private', 'rd_1')));
});

// ==================== MULTI-TEAM #32: Spark Kill-Switch, 3-Owned/5-Joined Caps & 50KB Logo ====================
test('Multi-Team #32: enforces platform/config allowNewTeams, 3-owned / 5-joined team caps, and 50KB logo limit', async () => {
  await seedMultiTeamPair();
  const captainOwnerDb = testEnv.authenticatedContext('captain_uid', { email_verified: true }).firestore();
  const founderADb = testEnv.authenticatedContext('founder_a', { email_verified: true }).firestore();
  const freshUserDb = testEnv.authenticatedContext('fresh_u', { email_verified: true }).firestore();
  const nowMs = Date.now();

  // Only Platform Owner can toggle platform/config; regular founder fails
  await assertFails(setDoc(doc(founderADb, 'platform', 'config'), { allowNewTeams: false, updatedAt: serverTimestamp() }));
  await assertSucceeds(setDoc(doc(captainOwnerDb, 'platform', 'config'), { allowNewTeams: false, updatedAt: serverTimestamp() }));

  // Creating a team when allowNewTeams == false fails
  const buildTeamCreateBatch = (userDb: ReturnType<typeof testEnv.authenticatedContext>['firestore'] extends () => infer R ? R : never, uid: string, tid: string, ownedIds: string[], teamIds: string[], logo = '') => {
    const batch = writeBatch(userDb);
    batch.set(doc(userDb, 'teams', tid), {
      id: tid,
      teamName: 'فريق جديد',
      appName: 'ميدان 6v6',
      founderUid: uid,
      organizerUids: [],
      primaryColor: '#FACC15',
      secondaryColor: '#EAB308',
      logo,
      joinMode: 'approval',
      lineupPublishMode: 'all',
      maxMembersPerTeam: 25,
      memberCount: 1,
      inviteCode: 'MT-NEW1-1234',
      memberShareCode: 'MS-NEW1-1234',
      lockSkills: false,
      deletedAt: null,
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    batch.set(
      doc(userDb, 'users', uid),
      {
        uid,
        displayName: 'مستخدم',
        teamIds: [...teamIds, tid],
        ownedTeamIds: [...ownedIds, tid],
        activeTeamId: tid,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
    return batch;
  };

  await assertFails(buildTeamCreateBatch(freshUserDb, 'fresh_u', 'team_blocked', [], []).commit());

  // Re-enable allowNewTeams and verify oversized logo (> 68,500 chars) & 3-owned cap fail
  await assertSucceeds(setDoc(doc(captainOwnerDb, 'platform', 'config'), { allowNewTeams: true, updatedAt: serverTimestamp() }));
  const hugeLogo = 'data:image/jpeg;base64,' + 'A'.repeat(69000);
  await assertFails(buildTeamCreateBatch(freshUserDb, 'fresh_u', 'team_biglogo', [], [], hugeLogo).commit());

  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'users', 'maxed_owner'), {
      uid: 'maxed_owner',
      teamIds: ['t1', 't2', 't3'],
      ownedTeamIds: ['t1', 't2', 't3'],
      updatedAt: Timestamp.now(),
    });
  });
  const maxedDb = testEnv.authenticatedContext('maxed_owner', { email_verified: true }).firestore();
  await assertFails(buildTeamCreateBatch(maxedDb, 'maxed_owner', 'team_fourth', ['t1', 't2', 't3'], ['t1', 't2', 't3']).commit());
});

// ==================== MULTI-TEAM #33: Join Modes, Team Cap & Organizer Boundary ====================
test('Multi-Team #33: enforces approval vs instant join, team maxMembersPerTeam cap, and organizer field lock', async () => {
  await seedMultiTeamPair();
  const joiner1Db = testEnv.authenticatedContext('joiner_1', { email_verified: true }).firestore();
  const orgADb = testEnv.authenticatedContext('org_a', { email_verified: true }).firestore();

  // Attempt instant join onto approval-mode team_alpha MUST fail
  const badBatch = writeBatch(joiner1Db);
  badBatch.set(doc(joiner1Db, 'teams', 'team_alpha', 'joinRequests', 'joiner_1'), {
    uid: 'joiner_1',
    teamId: 'team_alpha',
    name: 'منضم غير مصرح',
    jersey: 17,
    primaryPos: 'مهاجم',
    inviteCode: 'MT-ALPH-1111',
    status: 'approved',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  badBatch.set(doc(joiner1Db, 'teams', 'team_alpha', 'members', 'joiner_1'), {
    id: 'joiner_1',
    uid: 'joiner_1',
    ownerUid: 'joiner_1',
    teamId: 'team_alpha',
    name: 'منضم غير مصرح',
    role: 'member',
    isOrganizer: false,
    jersey: 17,
    primaryPos: 'مهاجم',
    skills: BASE_SKILLS,
    availableStatus: 'متاح',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  badBatch.update(doc(joiner1Db, 'teams', 'team_alpha'), { memberCount: increment(1), updatedAt: serverTimestamp() });
  badBatch.update(doc(joiner1Db, 'inviteCodes', 'MT-ALPH-1111'), { usedCount: 1, active: true, status: 'active', updatedAt: serverTimestamp() });
  badBatch.set(doc(joiner1Db, 'users', 'joiner_1'), { uid: 'joiner_1', teamIds: ['team_alpha'], updatedAt: serverTimestamp() });
  await assertFails(badBatch.commit());

  // Valid atomic instant join onto team_beta MUST succeed
  const okBatch = writeBatch(joiner1Db);
  okBatch.set(doc(joiner1Db, 'teams', 'team_beta', 'joinRequests', 'joiner_1'), {
    uid: 'joiner_1',
    teamId: 'team_beta',
    name: 'منضم فوري',
    jersey: 18,
    primaryPos: 'مدافع',
    inviteCode: 'MT-BETA-2222',
    status: 'approved',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  okBatch.set(doc(joiner1Db, 'teams', 'team_beta', 'members', 'joiner_1'), {
    id: 'joiner_1',
    uid: 'joiner_1',
    ownerUid: 'joiner_1',
    teamId: 'team_beta',
    name: 'منضم فوري',
    role: 'member',
    isOrganizer: false,
    jersey: 18,
    primaryPos: 'مدافع',
    skills: BASE_SKILLS,
    availableStatus: 'متاح',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  okBatch.update(doc(joiner1Db, 'teams', 'team_beta'), { memberCount: increment(1), updatedAt: serverTimestamp() });
  okBatch.update(doc(joiner1Db, 'inviteCodes', 'MT-BETA-2222'), { usedCount: 1, active: true, status: 'active', updatedAt: serverTimestamp() });
  okBatch.set(doc(joiner1Db, 'users', 'joiner_1'), { uid: 'joiner_1', teamIds: ['team_beta'], activeTeamId: 'team_beta', updatedAt: serverTimestamp() }, { merge: true });
  await assertSucceeds(okBatch.commit());

  // Organizer can update allowed subset (defaultPitchCost), CANNOT tamper joinMode/lockSkills/founderUid
  await assertSucceeds(updateDoc(doc(orgADb, 'teams', 'team_alpha'), { defaultPitchCost: 240, updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(orgADb, 'teams', 'team_alpha'), { joinMode: 'instant', updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(orgADb, 'teams', 'team_alpha'), { lockSkills: true, updatedAt: serverTimestamp() }));
});

// ==================== MULTI-TEAM #34: Leadership Transfer, Soft Delete & Self-Leave ====================
test('Multi-Team #34: enforces leadership transfer to existing member, founder-only soft delete, and atomic self-leave', async () => {
  await seedMultiTeamPair();
  const founderADb = testEnv.authenticatedContext('founder_a', { email_verified: true }).firestore();
  const orgADb = testEnv.authenticatedContext('org_a', { email_verified: true }).firestore();
  const memADb = testEnv.authenticatedContext('mem_a', { email_verified: true }).firestore();

  // Transfer leadership to non-member fails; non-founder transfer fails
  await assertFails(updateDoc(doc(founderADb, 'teams', 'team_alpha'), { founderUid: 'outsider_x', organizerUids: ['founder_a'], updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(orgADb, 'teams', 'team_alpha'), { founderUid: 'org_a', organizerUids: ['founder_a'], updatedAt: serverTimestamp() }));

  // Founder transfers leadership to existing member mem_a
  await assertSucceeds(
    updateDoc(doc(founderADb, 'teams', 'team_alpha'), {
      founderUid: 'mem_a',
      organizerUids: ['org_a', 'founder_a'],
      updatedAtMs: Date.now(),
      updatedAt: serverTimestamp(),
    })
  );

  // Non-founder org_a can atomically self-leave; new founder (mem_a) cannot self-delete member doc
  await assertFails(deleteDoc(doc(memADb, 'teams', 'team_alpha', 'members', 'mem_a')));
  const leaveBatch = writeBatch(orgADb);
  leaveBatch.delete(doc(orgADb, 'teams', 'team_alpha', 'members', 'org_a'));
  leaveBatch.update(doc(orgADb, 'teams', 'team_alpha'), {
    memberCount: increment(-1),
    organizerUids: ['founder_a'],
    updatedAt: serverTimestamp(),
  });
  await assertSucceeds(leaveBatch.commit());

  // Soft delete succeeds only for current founder (mem_a)
  await assertFails(updateDoc(doc(founderADb, 'teams', 'team_alpha'), { deletedAt: serverTimestamp(), updatedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(doc(memADb, 'teams', 'team_alpha'), { deletedAt: serverTimestamp(), updatedAtMs: Date.now(), updatedAt: serverTimestamp() }));
});

// ==================== MULTI-TEAM #35: Consolidated Attendance Isolation & /users/{uid} Lock ====================
test('Multi-Team #35: consolidated attendance isolates per-UID entries in responses map and /users/{uid} denies cross-user access', async () => {
  await seedMultiTeamPair();
  const memADb = testEnv.authenticatedContext('mem_a', { email_verified: true }).firestore();
  const orgADb = testEnv.authenticatedContext('org_a', { email_verified: true }).firestore();

  const attRefMem = doc(memADb, 'teams', 'team_alpha', 'attendance', '2026-12-01_match');
  await assertSucceeds(
    setDoc(attRefMem, {
      matchKey: '2026-12-01_match',
      teamId: 'team_alpha',
      date: '2026-12-01',
      type: 'مباراة',
      responses: {
        mem_a: { uid: 'mem_a', playerName: 'عضو ألفا', status: 'جاي', updatedAtMs: Date.now() },
      },
      updatedAtMs: Date.now(),
      updatedAt: serverTimestamp(),
    })
  );

  // mem_a CANNOT tamper with org_a's key inside responses map
  await assertFails(
    updateDoc(attRefMem, {
      'responses.org_a': { uid: 'org_a', playerName: 'منظم ألفا', status: 'معتذر', updatedAtMs: Date.now() },
      updatedAtMs: Date.now(),
      updatedAt: serverTimestamp(),
    })
  );

  // org_a CAN update their own key inside responses map
  await assertSucceeds(
    updateDoc(doc(orgADb, 'teams', 'team_alpha', 'attendance', '2026-12-01_match'), {
      'responses.org_a': { uid: 'org_a', playerName: 'منظم ألفا', status: 'محتمل', updatedAtMs: Date.now() },
      updatedAtMs: Date.now(),
      updatedAt: serverTimestamp(),
    })
  );

  // /users/{uid} strict self-only
  await assertFails(getDoc(doc(memADb, 'users', 'org_a')));
  await assertFails(getDocs(collection(memADb, 'users')));
});

// ==================== MULTI-TEAM #36: Multi-Team Cooldown, Peer Verify, Pitch Privacy & Quorum Lock ====================
test('Multi-Team #36: enforces 45m reportThrottle, peer confirmReport, /pitchPayments owner/org isolation & 50% tally quorum', async () => {
  await seedMultiTeamPair();
  const memADb = testEnv.authenticatedContext('mem_a', { email_verified: true }).firestore();
  const orgADb = testEnv.authenticatedContext('org_a', { email_verified: true }).firestore();
  const founderADb = testEnv.authenticatedContext('founder_a', { email_verified: true }).firestore();
  const nowMs = Date.now();

  // First atomic report + throttle succeeds; 2nd within 45m fails; self-confirm fails; peer confirm succeeds
  const r1 = writeBatch(memADb);
  r1.set(doc(memADb, 'teams', 'team_alpha', 'reports', 'mt_rep_1'), {
    teamId: 'team_alpha',
    playerId: 'mem_a',
    ownerUid: 'mem_a',
    playerName: 'عضو ألفا',
    opponent: 'الصقور',
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
  r1.set(doc(memADb, 'teams', 'team_alpha', 'reportThrottle', 'mem_a'), {
    uid: 'mem_a',
    teamId: 'team_alpha',
    lastReportAtMs: nowMs,
    updatedAt: serverTimestamp(),
  });
  await assertSucceeds(r1.commit());

  const r2 = writeBatch(memADb);
  r2.set(doc(memADb, 'teams', 'team_alpha', 'reports', 'mt_rep_2'), {
    teamId: 'team_alpha',
    playerId: 'mem_a',
    ownerUid: 'mem_a',
    playerName: 'عضو ألفا',
    opponent: 'النجوم',
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
  r2.set(doc(memADb, 'teams', 'team_alpha', 'reportThrottle', 'mem_a'), {
    uid: 'mem_a',
    teamId: 'team_alpha',
    lastReportAtMs: nowMs + 1000,
    updatedAt: serverTimestamp(),
  });
  await assertFails(r2.commit());

  await assertFails(updateDoc(doc(memADb, 'teams', 'team_alpha', 'reports', 'mt_rep_1'), { confirmedByUids: ['mem_a'], verified: true, updatedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(doc(orgADb, 'teams', 'team_alpha', 'reports', 'mt_rep_1'), { confirmedByUids: ['org_a'], verified: true, updatedAt: serverTimestamp() }));

  // /pitchPayments: organizer reads/writes; mem_a reads own only, denied on org_a payment
  await assertSucceeds(
    setDoc(doc(orgADb, 'teams', 'team_alpha', 'pitchPayments', 'current__org_a'), {
      teamId: 'team_alpha',
      sessionId: 'current',
      playerId: 'org_a',
      ownerUid: 'org_a',
      playerName: 'منظم ألفا',
      amount: 30,
      paid: true,
      updatedAt: serverTimestamp(),
    })
  );
  await assertFails(getDoc(doc(memADb, 'teams', 'team_alpha', 'pitchPayments', 'current__org_a')));

  // /matchVoteTallies: denied when voterUids < 50% of participantIds even if count >= 2
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const now = Timestamp.now();
    await setDoc(doc(db, 'teams', 'team_alpha', 'matchSessions', 'ms_q1'), {
      id: 'ms_q1',
      teamId: 'team_alpha',
      date: '2026-12-01',
      opponent: 'النسور',
      pitchMode: '6v6',
      ourScore: 4,
      oppScore: 2,
      result: 'فوز',
      createdBy: 'founder_a',
      participantIds: ['founder_a', 'org_a', 'mem_a', 'p4', 'p5', 'p6'],
      confirmers: ['founder_a', 'org_a', 'mem_a'],
      status: 'verified',
      votingOpen: true,
      voterUids: ['founder_a', 'org_a'], // 2/6 < 50%
      createdAt: now,
      updatedAt: now,
    });
    await setDoc(doc(db, 'teams', 'team_alpha', 'matchVoteTallies', 'ms_q1__mem_a'), {
      teamId: 'team_alpha',
      sessionId: 'ms_q1',
      targetId: 'mem_a',
      eligibleCount: 6,
      count: 2,
      totalScore: 17,
      h1: 0, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0, h7: 0, h8: 1, h9: 1, h10: 0,
      updatedAt: now,
    });
  });
  await assertFails(getDoc(doc(founderADb, 'teams', 'team_alpha', 'matchVoteTallies', 'ms_q1__mem_a')));
});

// ==================== RELEASE-HARDENING #37: Full 25-Key Member Profile Instant Join & Self-Update ====================
test('Release-Hardening #37: full 25-key member profile with stats6 + photo succeeds under 1000-expression limit', async () => {
  await seedMultiTeamPair();
  const joinerFullDb = testEnv.authenticatedContext('joiner_full', { email_verified: true }).firestore();

  const fullBatch = writeBatch(joinerFullDb);
  fullBatch.set(doc(joinerFullDb, 'teams', 'team_beta', 'joinRequests', 'joiner_full'), {
    uid: 'joiner_full',
    teamId: 'team_beta',
    name: 'لاعب كامل',
    jersey: 22,
    primaryPos: 'جناح',
    stats6: { PAC: 65, SHO: 60, PAS: 60, DRI: 65, DEF: 50, PHY: 60 },
    roleOverride: 'CAM_WINGER',
    inviteCode: 'MT-BETA-2222',
    status: 'approved',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  fullBatch.set(doc(joinerFullDb, 'teams', 'team_beta', 'members', 'joiner_full'), {
    id: 'joiner_full',
    uid: 'joiner_full',
    ownerUid: 'joiner_full',
    teamId: 'team_beta',
    name: 'لاعب كامل',
    role: 'member',
    isOrganizer: false,
    jersey: 22,
    age: 24,
    height: 178,
    weight: 72,
    foot: 'يمين',
    primaryPos: 'جناح',
    secondaryPos: 'مهاجم',
    photo: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
    hasPhoto: true,
    photoZoom: 110,
    photoY: 20,
    skills: BASE_SKILLS,
    stats6: { PAC: 65, SHO: 60, PAS: 60, DRI: 65, DEF: 50, PHY: 60 },
    roleOverride: 'CAM_WINGER',
    top3Strengths: 'سرعة ومراوغة',
    weak3Points: 'دفاع',
    seasonGoal: '10 أهداف',
    availableStatus: 'متاح',
    roleModelStarId: 'salah',
    joinedAtMs: Date.now(),
    updatedAtMs: Date.now(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  fullBatch.update(doc(joinerFullDb, 'teams', 'team_beta'), { memberCount: increment(1), updatedAt: serverTimestamp() });
  fullBatch.update(doc(joinerFullDb, 'inviteCodes', 'MT-BETA-2222'), { usedCount: 1, active: true, status: 'active', updatedAt: serverTimestamp() });
  fullBatch.set(doc(joinerFullDb, 'users', 'joiner_full'), { uid: 'joiner_full', teamIds: ['team_beta'], activeTeamId: 'team_beta', updatedAt: serverTimestamp() }, { merge: true });
  await assertSucceeds(fullBatch.commit());

  // Full-profile self-update (including skills + stats6 when lockSkills == false) MUST also succeed
  await assertSucceeds(
    updateDoc(doc(joinerFullDb, 'teams', 'team_beta', 'members', 'joiner_full'), {
      jersey: 23,
      skills: { ...BASE_SKILLS, speed: 9 },
      stats6: { PAC: 70, SHO: 60, PAS: 60, DRI: 60, DEF: 50, PHY: 60 },
      updatedAtMs: Date.now(),
      updatedAt: serverTimestamp(),
    })
  );
});

// ==================== RELEASE-HARDENING #38: Removed Member Denied Subsequent Access ====================
test('Release-Hardening #38: removed member immediately loses read/write access to team documents', async () => {
  await seedMultiTeamPair();
  const founderADb = testEnv.authenticatedContext('founder_a', { email_verified: true }).firestore();
  const memADb = testEnv.authenticatedContext('mem_a', { email_verified: true }).firestore();

  // Member has access before removal
  await assertSucceeds(getDoc(doc(memADb, 'teams', 'team_alpha')));
  await assertSucceeds(getDoc(doc(memADb, 'teams', 'team_alpha', 'members', 'founder_a')));

  // Founder removes mem_a
  const removeBatch = writeBatch(founderADb);
  removeBatch.delete(doc(founderADb, 'teams', 'team_alpha', 'members', 'mem_a'));
  removeBatch.update(doc(founderADb, 'teams', 'team_alpha'), { memberCount: increment(-1), updatedAt: serverTimestamp() });
  await assertSucceeds(removeBatch.commit());

  // Removed member is immediately denied reading team, roster, tactics, and reports
  await assertFails(getDoc(doc(memADb, 'teams', 'team_alpha')));
  await assertFails(getDoc(doc(memADb, 'teams', 'team_alpha', 'members', 'founder_a')));
  await assertFails(getDoc(doc(memADb, 'teams', 'team_alpha', 'reports', 'rep_alpha_seed')));
  await assertFails(
    setDoc(doc(memADb, 'teams', 'team_alpha', 'suggestions', 'sugg_after_kick'), {
      teamId: 'team_alpha',
      text: 'اقتراح بعد الطرد',
      createdAt: serverTimestamp(),
    })
  );
});

// ==================== RELEASE-HARDENING #39: Soft-Deleted Team Blocks Joins & Writes ====================
test('Release-Hardening #39: soft-deleted team blocks new joinRequests, settings updates, and member self-updates', async () => {
  await seedMultiTeamPair();
  const founderADb = testEnv.authenticatedContext('founder_a', { email_verified: true }).firestore();
  const memADb = testEnv.authenticatedContext('mem_a', { email_verified: true }).firestore();
  const outsiderDb = testEnv.authenticatedContext('late_joiner', { email_verified: true }).firestore();

  // Founder soft-deletes team_alpha
  await assertSucceeds(
    updateDoc(doc(founderADb, 'teams', 'team_alpha'), {
      deletedAt: serverTimestamp(),
      updatedAtMs: Date.now(),
      updatedAt: serverTimestamp(),
    })
  );

  // Subsequent team settings update & member self-update MUST fail
  await assertFails(updateDoc(doc(founderADb, 'teams', 'team_alpha'), { teamName: 'تعديل بعد الحذف', updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(memADb, 'teams', 'team_alpha', 'members', 'mem_a'), { jersey: 99, updatedAt: serverTimestamp() }));

  // Subsequent joinRequest against soft-deleted team MUST fail even with previously active inviteCode
  const joinBatch = writeBatch(outsiderDb);
  joinBatch.set(doc(outsiderDb, 'teams', 'team_alpha', 'joinRequests', 'late_joiner'), {
    uid: 'late_joiner',
    teamId: 'team_alpha',
    name: 'متأخر',
    jersey: 19,
    primaryPos: 'مهاجم',
    inviteCode: 'MT-ALPH-1111',
    status: 'pending',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  joinBatch.update(doc(outsiderDb, 'inviteCodes', 'MT-ALPH-1111'), {
    usedCount: 1,
    active: true,
    status: 'active',
    updatedAt: serverTimestamp(),
  });
  await assertFails(joinBatch.commit());
});

// ==================== RELEASE-HARDENING #40: Expired & Exhausted Invite Codes Rejected ====================
test('Release-Hardening #40: expired and exhausted invite codes are strictly rejected', async () => {
  await seedMultiTeamPair();
  const nowMs = Date.now();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const now = Timestamp.now();
    await setDoc(doc(db, 'inviteCodes', 'MT-EXPD-9999'), {
      code: 'MT-EXPD-9999',
      active: true,
      requireApproval: true,
      isMemberShareCode: false,
      teamId: 'team_alpha',
      teamName: 'فريق ألفا',
      appName: 'ميدان 6v6',
      primaryColor: '#FACC15',
      usageType: 'multi',
      maxUses: 10,
      usedCount: 0,
      durationDays: 1,
      createdAtMs: nowMs - 86400000 * 3,
      expiresAtMs: nowMs - 60000, // expired 1 minute ago
      status: 'active',
      updatedAt: now,
    });
    await setDoc(doc(db, 'inviteCodes', 'MT-FULL-8888'), {
      code: 'MT-FULL-8888',
      active: true,
      requireApproval: true,
      isMemberShareCode: false,
      teamId: 'team_alpha',
      teamName: 'فريق ألفا',
      appName: 'ميدان 6v6',
      primaryColor: '#FACC15',
      usageType: 'single',
      maxUses: 1,
      usedCount: 1, // already exhausted
      durationDays: 7,
      createdAtMs: nowMs - 10000,
      expiresAtMs: nowMs + 86400000,
      status: 'active',
      updatedAt: now,
    });
  });

  const applicantDb = testEnv.authenticatedContext('exp_tester', { email_verified: true }).firestore();

  const expBatch = writeBatch(applicantDb);
  expBatch.set(doc(applicantDb, 'teams', 'team_alpha', 'joinRequests', 'exp_tester'), {
    uid: 'exp_tester',
    teamId: 'team_alpha',
    name: 'مختبر انتهاء',
    jersey: 20,
    primaryPos: 'مدافع',
    inviteCode: 'MT-EXPD-9999',
    status: 'pending',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  expBatch.update(doc(applicantDb, 'inviteCodes', 'MT-EXPD-9999'), {
    usedCount: 1,
    active: true,
    status: 'active',
    updatedAt: serverTimestamp(),
  });
  await assertFails(expBatch.commit());

  const fullBatch = writeBatch(applicantDb);
  fullBatch.set(doc(applicantDb, 'teams', 'team_alpha', 'joinRequests', 'exp_tester'), {
    uid: 'exp_tester',
    teamId: 'team_alpha',
    name: 'مختبر امتلاء',
    jersey: 21,
    primaryPos: 'مدافع',
    inviteCode: 'MT-FULL-8888',
    status: 'pending',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  fullBatch.update(doc(applicantDb, 'inviteCodes', 'MT-FULL-8888'), {
    usedCount: 2,
    active: false,
    status: 'completed',
    updatedAt: serverTimestamp(),
  });
  await assertFails(fullBatch.commit());
});

// ==================== RELEASE-HARDENING #41: Self-Only Account Deletion & migratedFrom Owner Guard ====================
test('Release-Hardening #41: /users/{uid} allows self-delete only and non-Platform-Owner cannot spoof migratedFrom main', async () => {
  await seedMultiTeamPair();
  const memADb = testEnv.authenticatedContext('mem_a', { email_verified: true }).firestore();
  const orgADb = testEnv.authenticatedContext('org_a', { email_verified: true }).firestore();

  await assertSucceeds(
    setDoc(doc(memADb, 'users', 'mem_a'), {
      uid: 'mem_a',
      displayName: 'عضو ألفا',
      teamIds: ['team_alpha'],
      updatedAt: serverTimestamp(),
    })
  );

  // Cross-user delete MUST fail; self-delete MUST succeed
  await assertFails(deleteDoc(doc(orgADb, 'users', 'mem_a')));
  await assertSucceeds(deleteDoc(doc(memADb, 'users', 'mem_a')));

  // Non-Platform-Owner attempting to bypass caps by forging migratedFrom: 'main' MUST fail
  const nowMs = Date.now();
  await assertFails(
    setDoc(doc(orgADb, 'teams', 'team_spoof_mig'), {
      id: 'team_spoof_mig',
      teamName: 'فريق مزور',
      appName: 'ميدان 6v6',
      founderUid: 'org_a',
      organizerUids: [],
      primaryColor: '#FACC15',
      secondaryColor: '#070709',
      joinMode: 'approval',
      lineupPublishMode: 'all',
      maxMembersPerTeam: 25,
      memberCount: 1,
      inviteCode: 'MT-SPOF-1234',
      memberShareCode: 'MS-SPOF-1234',
      lockSkills: false,
      deletedAt: null,
      migratedFrom: 'main',
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  );
});

// ==================== RELEASE-HARDENING #42: Emulator-Backed Legacy -> Multi-Team Safe Migration ====================
test('Release-Hardening #42: Legacy main -> Multi-Team batched migration verifies counts, private isolation, resume idempotency, and untouched rollback data', async () => {
  const nowMs = Date.now();
  const targetTeamId = 'team_mig_verified';

  // 1. Seed realistic Legacy Single-Team ("main") dataset via admin context
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const adminFs = ctx.firestore();
    await setDoc(doc(adminFs, 'admins', 'captain_uid'), {
      uid: 'captain_uid',
      role: 'admin',
      createdAt: Timestamp.now(),
    });
    await setDoc(doc(adminFs, 'players', 'captain_uid'), {
      id: 'captain_uid',
      ownerUid: 'captain_uid',
      teamId: 'main',
      name: 'كابتن الترقية',
      role: 'admin',
      jersey: 10,
      primaryPos: 'لاعب وسط',
      skills: BASE_SKILLS,
      availableStatus: 'متاح',
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
    await setDoc(doc(adminFs, 'players', 'p_legacy_2'), {
      id: 'p_legacy_2',
      ownerUid: 'p_legacy_2',
      teamId: 'main',
      name: 'لاعب الترقية',
      role: 'player',
      jersey: 7,
      primaryPos: 'مهاجم',
      skills: BASE_SKILLS,
      availableStatus: 'متاح',
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
    await setDoc(doc(adminFs, 'readiness', 'rd_leg_1'), {
      playerId: 'p_legacy_2',
      teamId: 'main',
      date: '2026-11-26',
      sleep: 8,
      fatigue: 3,
      mood: 9,
      createdAt: Timestamp.now(),
    });
    await setDoc(doc(adminFs, 'injuries', 'inj_leg_1'), {
      playerId: 'p_legacy_2',
      teamId: 'main',
      type: 'شد عضلي',
      location: 'الفخذ',
      severity: 'خفيفة',
      date: '2026-11-25',
      expectedReturn: '2026-12-01',
      createdAt: Timestamp.now(),
    });
    await setDoc(doc(adminFs, 'attendance', 'att_leg_1'), {
      date: '2026-11-28',
      type: 'مباراة',
      playerId: 'captain_uid',
      ownerUid: 'captain_uid',
      playerName: 'كابتن الترقية',
      status: 'جاي',
      teamId: 'main',
      updatedAt: Timestamp.now(),
    });
    await setDoc(doc(adminFs, 'attendance', 'att_leg_2'), {
      date: '2026-11-28',
      type: 'مباراة',
      playerId: 'p_legacy_2',
      ownerUid: 'p_legacy_2',
      playerName: 'لاعب الترقية',
      status: 'متأخر',
      teamId: 'main',
      updatedAt: Timestamp.now(),
    });
    await setDoc(doc(adminFs, 'reports', 'rep_leg_1'), {
      teamId: 'main',
      playerId: 'p_legacy_2',
      ownerUid: 'p_legacy_2',
      playerName: 'لاعب الترقية',
      opponent: 'فريق النجوم',
      goals: 2,
      assists: 1,
      minutes: 45,
      rating: 8,
      confirmedByUids: ['captain_uid'],
      verified: true,
      createdAtMs: nowMs - 60000,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
    await setDoc(doc(adminFs, 'suggestions', 'sug_leg_1'), {
      teamId: 'main',
      text: 'ملعب الجمعة الساعة 8',
      createdAt: Timestamp.now(),
    });
  });

  // 2. Run authenticated Platform Owner (captain_uid) batched migration strictly against real Rules!
  const captainDb = testEnv.authenticatedContext('captain_uid', { email_verified: true }).firestore();
  const copiedSections = new Set<string>();

  const runMigrationPass = async () => {
    // Read legacy source collections (includes seedTeamState + added legacy docs)
    const [playersSnap, readinessSnap, injuriesSnap, attendanceSnap, reportsSnap, suggSnap] = await Promise.all([
      getDocs(query(collection(captainDb, 'players'), where('teamId', '==', 'main'))),
      getDocs(query(collection(captainDb, 'readiness'), where('teamId', '==', 'main'))),
      getDocs(query(collection(captainDb, 'injuries'), where('teamId', '==', 'main'))),
      getDocs(query(collection(captainDb, 'attendance'), where('teamId', '==', 'main'))),
      getDocs(query(collection(captainDb, 'reports'), where('teamId', '==', 'main'))),
      getDocs(query(collection(captainDb, 'suggestions'), where('teamId', '==', 'main'))),
    ]);

    // Step A: Create target Multi-Team doc (tracked by checkpoint — supports resume!)
    const teamRef = doc(captainDb, 'teams', targetTeamId);
    if (!copiedSections.has('team')) {
      await assertSucceeds(
        setDoc(teamRef, {
          id: targetTeamId,
          teamName: 'فريق الترقية الموثّق',
          appName: 'ميدان 6v6',
          founderUid: 'captain_uid',
          organizerUids: [],
          primaryColor: '#FACC15',
          secondaryColor: '#070709',
          joinMode: 'approval',
          lineupPublishMode: 'all',
          maxMembersPerTeam: 25,
          memberCount: playersSnap.size,
          inviteCode: 'MT-MIGV-1234',
          memberShareCode: 'MS-MIGV-1234',
          lockSkills: false,
          deletedAt: null,
          migratedFrom: 'main',
          createdAtMs: nowMs,
          updatedAtMs: nowMs,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );
      copiedSections.add('team');
    } else {
      const existingTeam = await assertSucceeds(getDoc(teamRef));
      assert.equal(existingTeam.exists(), true);
    }

    // Step B & C: Batched copy of public members + isolated /private/* records using production splitPlayerPublicAndPrivate()
    const rdAll = readinessSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const injAll = injuriesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    let totalPrivateExpected = 0;

    const splits = playersSnap.docs.map((pDoc) =>
      splitPlayerPublicAndPrivate({
        teamId: targetTeamId,
        rawPlayer: { id: pDoc.id, ...pDoc.data() },
        founderUid: 'captain_uid',
        organizerUids: [],
        readinessRecords: rdAll,
        injuryRecords: injAll,
        nowMs,
      })
    );
    for (const s of splits) totalPrivateExpected += s.privateRecords.length;

    if (!copiedSections.has('members')) {
      for (const chunk of chunkItemsForBatch(splits, 20)) {
        const b = writeBatch(captainDb);
        for (const s of chunk) {
          b.set(doc(captainDb, 'teams', targetTeamId, 'members', s.publicMember.id), {
            ...s.publicMember,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          for (const priv of s.privateRecords) {
            b.set(doc(captainDb, 'teams', targetTeamId, 'members', s.publicMember.id, 'private', priv.id), {
              ...priv.data,
              createdAt: serverTimestamp(),
            });
          }
        }
        await assertSucceeds(b.commit());
      }
      copiedSections.add('members');
    }

    // Step D: Consolidated attendance by matchKey
    const groupedAtt = groupLegacyAttendanceByMatchKey(
      attendanceSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
      nowMs
    );
    for (const attDoc of groupedAtt) {
      await assertSucceeds(
        setDoc(doc(captainDb, 'teams', targetTeamId, 'attendance', attDoc.matchKey), {
          teamId: targetTeamId,
          matchKey: attDoc.matchKey,
          date: attDoc.date,
          type: attDoc.type,
          responses: attDoc.responses,
          updatedAtMs: attDoc.updatedAtMs,
          updatedAt: serverTimestamp(),
        })
      );
    }

    // Step E: Reports & suggestions (skip existing on resume — mirrors src/backend.ts line 5428)
    for (const repDoc of reportsSnap.docs) {
      const rep = repDoc.data();
      const targetRef = doc(captainDb, 'teams', targetTeamId, 'reports', repDoc.id);
      if (!(await getDoc(targetRef)).exists()) {
        await assertSucceeds(
          setDoc(targetRef, {
            ...rep,
            teamId: targetTeamId,
            updatedAt: serverTimestamp(),
          })
        );
      }
    }
    for (const sDoc of suggSnap.docs) {
      const sg = sDoc.data();
      const targetRef = doc(captainDb, 'teams', targetTeamId, 'suggestions', sDoc.id);
      if (!(await getDoc(targetRef)).exists()) {
        await assertSucceeds(
          setDoc(targetRef, {
            teamId: targetTeamId,
            text: String(sg.text),
            createdAt: serverTimestamp(),
          })
        );
      }
    }

    return {
      sourceCounts: {
        players: playersSnap.size,
        privateRecords: totalPrivateExpected,
        attendanceMatches: groupedAtt.length,
        reports: reportsSnap.size,
        suggestions: suggSnap.size,
      },
    };
  };

  // Pass 1: Initial migration
  const { sourceCounts } = await runMigrationPass();
  // Pass 2: Resume / re-run idempotency (MUST succeed cleanly without duplicating records)
  await runMigrationPass();

  // 3. Verify target counts match source counts via verifyMigrationCountReport
  const [targetMembers, targetAtt, targetReports, targetSuggs] = await Promise.all([
    getDocs(query(collection(captainDb, 'teams', targetTeamId, 'members'), where('teamId', '==', targetTeamId))),
    getDocs(query(collection(captainDb, 'teams', targetTeamId, 'attendance'), where('teamId', '==', targetTeamId))),
    getDocs(query(collection(captainDb, 'teams', targetTeamId, 'reports'), where('teamId', '==', targetTeamId))),
    getDocs(query(collection(captainDb, 'teams', targetTeamId, 'suggestions'), where('teamId', '==', targetTeamId))),
  ]);
  let actualPrivateCount = 0;
  for (const mDoc of targetMembers.docs) {
    const pSnap = await getDocs(collection(captainDb, 'teams', targetTeamId, 'members', mDoc.id, 'private'));
    actualPrivateCount += pSnap.size;
  }

  const report = verifyMigrationCountReport(sourceCounts, {
    players: targetMembers.size,
    privateRecords: actualPrivateCount,
    attendanceMatches: targetAtt.size,
    reports: targetReports.size,
    suggestions: targetSuggs.size,
  });
  assert.equal(report.ok, true, `Migration count mismatch: ${JSON.stringify(report.mismatches)}`);

  // 4. Verify rollback safety: original Legacy "main" records remain 100% intact
  const legacyPlayerStillThere = await assertSucceeds(getDoc(doc(captainDb, 'players', 'p_legacy_2')));
  const legacyReadinessStillThere = await assertSucceeds(getDoc(doc(captainDb, 'readiness', 'rd_leg_1')));
  assert.equal(legacyPlayerStillThere.exists(), true);
  assert.equal(legacyReadinessStillThere.exists(), true);
});

test('Multi-Team Private Records: blocks cross-tenant outsider writes & writes on soft-deleted teams while preserving self-deletion', async () => {
  const activeTid = 'team_priv_active';
  const deletedTid = 'team_priv_deleted';
  const nowMs = Date.now();

  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const adminDb = ctx.firestore();
    await setDoc(doc(adminDb, 'teams', activeTid), {
      id: activeTid,
      teamName: 'فريق نشط',
      appName: 'ميدان 6v6',
      founderUid: 'founder_u',
      organizerUids: [],
      primaryColor: '#FACC15',
      secondaryColor: '#070709',
      joinMode: 'approval',
      lineupPublishMode: 'all',
      maxMembersPerTeam: 25,
      memberCount: 2,
      inviteCode: 'MT-PRV1-1111',
      memberShareCode: 'MS-PRV1-1111',
      lockSkills: false,
      deletedAt: null,
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
    });
    await setDoc(doc(adminDb, 'teams', activeTid, 'members', 'member_u'), {
      id: 'member_u',
      uid: 'member_u',
      ownerUid: 'member_u',
      teamId: activeTid,
      name: 'عضو نشط',
      role: 'member',
      isOrganizer: false,
      jersey: 7,
      age: 22,
      height: 175,
      weight: 70,
      foot: 'يمين',
      primaryPos: 'وسط',
      secondaryPos: 'دفاع',
      availableStatus: 'متاح',
      joinedAtMs: nowMs,
      updatedAtMs: nowMs,
    });
    await setDoc(doc(adminDb, 'teams', deletedTid), {
      id: deletedTid,
      teamName: 'فريق محذوف',
      appName: 'ميدان 6v6',
      founderUid: 'founder_u',
      organizerUids: [],
      primaryColor: '#FACC15',
      secondaryColor: '#070709',
      joinMode: 'approval',
      lineupPublishMode: 'all',
      maxMembersPerTeam: 25,
      memberCount: 2,
      inviteCode: 'MT-PRV2-2222',
      memberShareCode: 'MS-PRV2-2222',
      lockSkills: false,
      deletedAt: serverTimestamp(),
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
    });
    await setDoc(doc(adminDb, 'teams', deletedTid, 'members', 'member_u'), {
      id: 'member_u',
      uid: 'member_u',
      ownerUid: 'member_u',
      teamId: deletedTid,
      name: 'عضو سابق',
      role: 'member',
      isOrganizer: false,
      jersey: 7,
      age: 22,
      height: 175,
      weight: 70,
      foot: 'يمين',
      primaryPos: 'وسط',
      secondaryPos: 'دفاع',
      availableStatus: 'متاح',
      joinedAtMs: nowMs,
      updatedAtMs: nowMs,
    });
    await setDoc(doc(adminDb, 'teams', deletedTid, 'members', 'member_u', 'private', 'rd_old_1'), {
      kind: 'readiness',
      uid: 'member_u',
      teamId: deletedTid,
      date: '2026-11-20',
      sleep: 7,
      fatigue: 6,
      mood: 8,
      updatedAtMs: nowMs,
    });
  });

  const outsiderDb = testEnv.authenticatedContext('outsider_u', { email_verified: true }).firestore();
  const memberDb = testEnv.authenticatedContext('member_u', { email_verified: true }).firestore();

  // 1. Outsider (non-member) MUST be denied creating private records under another team
  await assertFails(
    setDoc(doc(outsiderDb, 'teams', activeTid, 'members', 'outsider_u', 'private', 'rd_spoof'), {
      kind: 'readiness',
      uid: 'outsider_u',
      teamId: activeTid,
      date: '2026-11-27',
      sleep: 8,
      fatigue: 8,
      mood: 8,
      updatedAtMs: nowMs,
      createdAt: serverTimestamp(),
    })
  );

  // 2. Active member CAN create and self-delete their own private record on an active team
  await assertSucceeds(
    setDoc(doc(memberDb, 'teams', activeTid, 'members', 'member_u', 'private', 'rd_valid_1'), {
      kind: 'readiness',
      uid: 'member_u',
      teamId: activeTid,
      date: '2026-11-27',
      sleep: 8,
      fatigue: 7,
      mood: 9,
      updatedAtMs: nowMs,
      createdAt: serverTimestamp(),
    })
  );
  await assertSucceeds(deleteDoc(doc(memberDb, 'teams', activeTid, 'members', 'member_u', 'private', 'rd_valid_1')));

  // 3. Member CANNOT create new private records inside a soft-deleted team
  await assertFails(
    setDoc(doc(memberDb, 'teams', deletedTid, 'members', 'member_u', 'private', 'rd_after_delete'), {
      kind: 'readiness',
      uid: 'member_u',
      teamId: deletedTid,
      date: '2026-11-27',
      sleep: 8,
      fatigue: 7,
      mood: 9,
      updatedAtMs: nowMs,
      createdAt: serverTimestamp(),
    })
  );

  // 4. Member CAN still read and delete existing private records on a soft-deleted team (account deletion flow)
  await assertSucceeds(getDoc(doc(memberDb, 'teams', deletedTid, 'members', 'member_u', 'private', 'rd_old_1')));
  await assertSucceeds(deleteDoc(doc(memberDb, 'teams', deletedTid, 'members', 'member_u', 'private', 'rd_old_1')));
});






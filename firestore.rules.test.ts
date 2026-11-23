import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const rules = fs.readFileSync('firestore.rules', 'utf8');
const blueprint = JSON.parse(fs.readFileSync('firebase-blueprint.json', 'utf8'));

test('Dirty Dozen #1 & #2: Default-deny safety net and strict hasAll/hasOnly schema checks exist', () => {
  assert.match(rules, /match \/\{document=\*\*\}\s*\{\s*allow read, write: if false;\s*\}/);
  assert.match(rules, /incoming\(\)\.role == existing\(\)\.role/);
  assert.match(rules, /affectedKeys\(\)\.hasOnly\(/);
  assert.match(rules, /data\.keys\(\)\.hasAll\(/);
  assert.match(rules, /data\.keys\(\)\.hasOnly\(/);
});

test('Dirty Dozen #3: Admin email check strictly enforces email_verified == true', () => {
  assert.match(rules, /function isVerifiedUser\(\)\s*\{\s*return isSignedIn\(\) && request\.auth\.token\.email_verified == true;\s*\}/);
  assert.match(rules, /function isBootstrappedCaptain\(\)\s*\{\s*return isVerifiedUser\(\) && request\.auth\.token\.email == 'ammarfara210@gmail\.com';\s*\}/);
});

test('Dirty Dozen #4 & #5: Readiness and Injuries restrict get & list strictly to ownerUid or Captain', () => {
  const readinessBlock = rules.match(/match \/readiness\/\{readinessId\}[\s\S]*?\n    \}/)?.[0] || '';
  const injuriesBlock = rules.match(/match \/injuries\/\{injuryId\}[\s\S]*?\n    \}/)?.[0] || '';
  assert.ok(readinessBlock.includes('resource.data.ownerUid == request.auth.uid || isCaptain()'));
  assert.ok(injuriesBlock.includes('resource.data.ownerUid == request.auth.uid || isCaptain()'));
});

test('Dirty Dozen #6, #7, #8, #9: Peer ratings lock raw ballots, forbid self-rating, require atomic pairing & count >= 3', () => {
  const rawBlock = rules.match(/match \/peerRatings\/\{ratingId\}[\s\S]*?\n    \}/)?.[0] || '';
  const statBlock = rules.match(/match \/peerRatingStats\/\{targetId\}[\s\S]*?\n    \}/)?.[0] || '';
  assert.ok(rawBlock.includes('allow list: if false;'));
  assert.ok(rawBlock.includes('resource.data.raterUid == request.auth.uid'));
  assert.ok(rules.includes('data.targetId != request.auth.uid'));
  assert.ok(statBlock.includes('resource.data.count >= 3'));
  assert.ok(statBlock.includes('existsAfter(/databases/$(database)/documents/peerRatings/'));
  assert.ok(statBlock.includes('getAfter(/databases/$(database)/documents/peerRatings/'));
});

test('Dirty Dozen #10, #11, #12: ID poisoning guard, request.time enforcement, and invite-code gated joinRequests', () => {
  assert.match(rules, /function isValidId\(id\)/);
  assert.match(rules, /== request\.time/);
  const joinBlock = rules.match(/match \/joinRequests\/\{uid\}[\s\S]*?\n    \}/)?.[0] || '';
  assert.ok(joinBlock.includes('uid == request.auth.uid'));
  assert.ok(joinBlock.includes('inviteCodes/$(incoming().inviteCode)'));
});

test('Every Firestore collection declared in firebase-blueprint.json has a matching rule block', () => {
  for (const path of Object.keys(blueprint.firestore)) {
    const colName = path.split('/')[1];
    assert.ok(
      rules.includes(`match /${colName}/`),
      `Missing match block in firestore.rules for collection /${colName}`
    );
  }
});

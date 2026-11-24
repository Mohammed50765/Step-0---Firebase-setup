import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDefaultGooglePlayerProfile,
  buildGoogleLocalStorageKey,
  createCleanSessionFlags,
  isCaptainAuthorized,
  resolvePostAuthRoute,
  sanitizePersonalTeamInput,
} from './authFlow';
import { validateCardCreationBudget } from './ratingEngine';

test('Captain session enters full cloud captain mode with admin role', () => {
  const route = resolvePostAuthRoute({
    status: 'ready',
    isCaptain: true,
    loginAuthTab: 'signin',
  });
  assert.equal(route.mode, 'cloud_captain');
  assert.equal(route.enterAppImmediately, true);
  assert.equal(route.attachCloudListeners, true);
  assert.equal(route.isCaptainSession, true);
  assert.equal(route.role, 'admin');
  assert.equal(route.openJoinModal, false);
  assert.equal(route.showTeamOptionsBar, false);
});

test('Existing cloud team member enters full cloud member mode with player role', () => {
  const route = resolvePostAuthRoute({
    status: 'ready',
    isCaptain: false,
    loginAuthTab: 'signin',
  });
  assert.equal(route.mode, 'cloud_member');
  assert.equal(route.enterAppImmediately, true);
  assert.equal(route.attachCloudListeners, true);
  assert.equal(route.isCaptainSession, false);
  assert.equal(route.role, 'player');
  assert.equal(route.openJoinModal, false);
  assert.equal(route.showTeamOptionsBar, false);
});

test('New Google user without invite code enters app directly as standard player (never blocked)', () => {
  const route = resolvePostAuthRoute({
    status: 'needs_join',
    isCaptain: false,
    loginAuthTab: 'signin',
  });
  assert.equal(route.mode, 'google_standard');
  assert.equal(route.enterAppImmediately, true);
  assert.equal(route.attachCloudListeners, false);
  assert.equal(route.isCaptainSession, false);
  assert.equal(route.role, 'player');
  assert.equal(route.openJoinModal, false);
  assert.equal(route.showTeamOptionsBar, true);
  assert.equal(route.googleJoinStatus, 'needs_join');
});

test('New Google user from signup tab without invite code enters app directly with team bar visible', () => {
  const route = resolvePostAuthRoute({
    status: 'needs_join',
    isCaptain: false,
    loginAuthTab: 'signup',
  });
  assert.equal(route.mode, 'google_standard');
  assert.equal(route.enterAppImmediately, true);
  assert.equal(route.attachCloudListeners, false);
  assert.equal(route.role, 'player');
  assert.equal(route.openJoinModal, false);
  assert.equal(route.showTeamOptionsBar, true);
});

test('New Google user with valid ?join=CODE enters app immediately and opens optional join modal', () => {
  const route = resolvePostAuthRoute({
    status: 'needs_join',
    isCaptain: false,
    loginAuthTab: 'signup',
    urlInviteCode: 'ABCD-1234-EFGH',
  });
  assert.equal(route.mode, 'google_standard');
  assert.equal(route.enterAppImmediately, true);
  assert.equal(route.attachCloudListeners, false);
  assert.equal(route.role, 'player');
  assert.equal(route.openJoinModal, true);
  assert.equal(route.prefillInviteCode, 'ABCD-1234-EFGH');
  assert.equal(route.showTeamOptionsBar, true);
});

test('Pending and rejected Google users enter app immediately without lockout or admin privileges', () => {
  const pendingRoute = resolvePostAuthRoute({
    status: 'pending',
    isCaptain: true, // even if mistakenly passed, non-ready status must NEVER grant captain
    loginAuthTab: 'signin',
    urlInviteCode: 'ABCD-1234-EFGH',
  });
  assert.equal(pendingRoute.mode, 'google_standard');
  assert.equal(pendingRoute.enterAppImmediately, true);
  assert.equal(pendingRoute.isCaptainSession, false);
  assert.equal(pendingRoute.role, 'player');
  assert.equal(pendingRoute.attachCloudListeners, false);
  assert.equal(pendingRoute.googleJoinStatus, 'pending');
  assert.equal(pendingRoute.openJoinModal, false);

  const rejectedRoute = resolvePostAuthRoute({
    status: 'rejected',
    isCaptain: false,
    loginAuthTab: 'signin',
  });
  assert.equal(rejectedRoute.mode, 'google_standard');
  assert.equal(rejectedRoute.enterAppImmediately, true);
  assert.equal(rejectedRoute.role, 'player');
  assert.equal(rejectedRoute.googleJoinStatus, 'rejected');
  assert.equal(rejectedRoute.showTeamOptionsBar, true);
});

test('buildDefaultGooglePlayerProfile creates safe standard player with valid 360-pt budget', () => {
  const p = buildDefaultGooglePlayerProfile({
    uid: 'uid_abc123',
    displayName: '  أحمد السالم  ',
    email: 'ahmed@example.com',
  });
  assert.equal(p.id, 'uid_abc123');
  assert.equal(p.ownerUid, 'uid_abc123');
  assert.equal(p.role, 'player');
  assert.equal(p.name, 'أحمد السالم');
  const budget = validateCardCreationBudget(p.stats6);
  assert.equal(budget.valid, true);
  assert.equal(budget.total, 360);

  const fallback = buildDefaultGooglePlayerProfile({
    uid: 'uid_empty',
    displayName: '',
    email: 'player99@gmail.com',
  });
  assert.equal(fallback.name, 'player99');
  assert.equal(fallback.role, 'player');
});

test('buildGoogleLocalStorageKey isolates per-UID storage safely', () => {
  assert.equal(buildGoogleLocalStorageKey('u123_ABC-9'), 'maydan_google_player_u123_ABC-9');
  assert.equal(buildGoogleLocalStorageKey('../hack/uid!'), 'maydan_google_player_hackuid');
  assert.equal(buildGoogleLocalStorageKey(''), 'six_aside_demo_local_v3');
});

test('sanitizePersonalTeamInput validates team name, formation, and color', () => {
  const bad = sanitizePersonalTeamInput({ teamName: 'ا' });
  assert.equal(bad.valid, false);

  const ok = sanitizePersonalTeamInput({
    teamName: '  نجوم الميدان 6v6  ',
    formation: '1-2-2',
    primaryColor: '#22c55e',
  });
  assert.equal(ok.valid, true);
  assert.equal(ok.teamName, 'نجوم الميدان 6v6');
  assert.equal(ok.formation, '1-2-2');
  assert.equal(ok.primaryColor, '#22c55e');

  const fallback = sanitizePersonalTeamInput({
    teamName: 'فريق الأبطال',
    formation: '9-9-9',
    primaryColor: 'javascript:alert(1)',
  });
  assert.equal(fallback.valid, true);
  assert.equal(fallback.formation, '2-2-1');
  assert.equal(fallback.primaryColor, '#FACC15');
});

test('isCaptainAuthorized ignores local user.role and trusts only Firebase isCaptainSession', () => {
  assert.equal(
    isCaptainAuthorized({ isFirebaseMode: false, isCaptainSession: false, localPlayerRole: 'admin' }),
    false
  );
  assert.equal(
    isCaptainAuthorized({ isFirebaseMode: false, isCaptainSession: true, localPlayerRole: 'admin' }),
    false
  );
  assert.equal(
    isCaptainAuthorized({ isFirebaseMode: true, isCaptainSession: false, localPlayerRole: 'admin' }),
    false
  );
  assert.equal(
    isCaptainAuthorized({ isFirebaseMode: true, isCaptainSession: true, localPlayerRole: 'player' }),
    true
  );
});

test('Sequential same-page transition (Captain -> Sign-out -> Player) clears all Captain flags and never leaks privileges', () => {
  // 1. Account A: Verified Captain logs in via resolveSession (admins/{uid} exists)
  const capRoute = resolvePostAuthRoute({
    status: 'ready',
    isCaptain: true,
    loginAuthTab: 'signin',
  });
  assert.equal(
    isCaptainAuthorized({
      isFirebaseMode: capRoute.attachCloudListeners,
      isCaptainSession: capRoute.isCaptainSession,
      localPlayerRole: 'admin',
    }),
    true
  );

  // 2. Sign out / Auth state becomes null
  const resetState = createCleanSessionFlags();
  assert.deepEqual(resetState, {
    isFirebaseMode: false,
    isGoogleStandardMode: false,
    googleJoinStatus: 'none',
    isCaptainSession: false,
    appStarted: false,
    db: null,
    user: null,
  });
  assert.equal(
    isCaptainAuthorized({
      isFirebaseMode: resetState.isFirebaseMode,
      isCaptainSession: resetState.isCaptainSession,
      localPlayerRole: 'admin',
    }),
    false
  );

  // 3. Account B: Non-captain team member logs in on the same page (even if player doc carried role: 'admin')
  const playerRoute = resolvePostAuthRoute({
    status: 'ready',
    isCaptain: false,
    loginAuthTab: 'signin',
  });
  assert.equal(playerRoute.isCaptainSession, false);
  assert.equal(
    isCaptainAuthorized({
      isFirebaseMode: playerRoute.attachCloudListeners,
      isCaptainSession: playerRoute.isCaptainSession,
      localPlayerRole: 'admin',
    }),
    false
  );

  // 4. Account C: New standard Google user without invite code on the same page
  const stdRoute = resolvePostAuthRoute({
    status: 'needs_join',
    isCaptain: false,
    loginAuthTab: 'signin',
  });
  assert.equal(stdRoute.isCaptainSession, false);
  assert.equal(
    isCaptainAuthorized({
      isFirebaseMode: stdRoute.attachCloudListeners,
      isCaptainSession: stdRoute.isCaptainSession,
      localPlayerRole: 'admin',
    }),
    false
  );
});

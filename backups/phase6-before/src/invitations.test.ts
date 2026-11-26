import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildInviteShareUrl,
  computeInviteStatus,
  consumeInvitationRecord,
  createSmartInvitationRecord,
  DEFAULT_INVITE_DURATION_DAYS,
  DEFAULT_INVITE_MAX_USES,
  DEFAULT_INVITE_USAGE_TYPE,
  derivePersonalReferralCode,
  parseInviteAndReferralFromLocation,
  revokeInvitationRecord,
  sanitizeReferralCode,
  validateInviteForJoin,
} from './invitations';

test('Smart Invitations: creates MDN-XXXX-XXXX CSPRNG code with default single-use and 7-day expiry', () => {
  const now = 1_760_000_000_000;
  const inv = createSmartInvitationRecord(
    {
      teamName: 'فريق النخبة',
      nowMs: now,
    },
    { isFirebaseMode: true, isCaptainSession: true }
  );

  assert.match(inv.code, /^MDN-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.equal(inv.usageType, DEFAULT_INVITE_USAGE_TYPE);
  assert.equal(inv.maxUses, DEFAULT_INVITE_MAX_USES);
  assert.equal(inv.usedCount, 0);
  assert.equal(inv.durationDays, DEFAULT_INVITE_DURATION_DAYS);
  assert.equal(inv.expiresAtMs - inv.createdAtMs, 7 * 86_400_000);
  assert.equal(inv.status, 'active');
  assert.equal(inv.active, true);

  const meta = computeInviteStatus(inv, now + 1000);
  assert.equal(meta.status, 'active');
  assert.equal(meta.labelAr, 'فعالة');
  assert.ok(meta.reasonAr.length > 0);
  assert.equal(meta.canUse, true);
  assert.equal(meta.remainingUses, 1);
  assert.equal('createdBy' in inv, false);

  const shareInv = createSmartInvitationRecord(
    {
      teamName: 'فريق النخبة',
      usageType: 'multi',
      maxUses: 100,
      durationDays: 90,
      requireApproval: false,
      isMemberShareCode: true,
      nowMs: now,
    },
    { isFirebaseMode: true, isCaptainSession: true }
  );
  assert.equal(shareInv.isMemberShareCode, true);
  assert.equal(shareInv.requireApproval, true);
  assert.match(computeInviteStatus(shareInv, now + 1000).reasonAr, /موافقة/);
});

test('Smart Invitations: blocks unauthorized non-captain player from creating or revoking invitations', () => {
  assert.throws(
    () =>
      createSmartInvitationRecord(
        { usageType: 'single' },
        { isFirebaseMode: true, isCaptainSession: false }
      ),
    /متاح للكابتن المعتمد فقط/
  );

  const validInvite = createSmartInvitationRecord(
    { usageType: 'multi', maxUses: 5 },
    { isFirebaseMode: true, isCaptainSession: true }
  );

  assert.throws(
    () =>
      revokeInvitationRecord(validInvite, {
        isFirebaseMode: true,
        isCaptainSession: false,
      }),
    /متاح للكابتن المعتمد فقط/
  );
});

test('Smart Invitations: rejects expired, revoked, and fully-used (completed) invite codes', () => {
  const now = 1_760_000_000_000;

  // 1. Single-use invite consumed once becomes completed ('مكتملة') and rejects second use
  const singleInv = createSmartInvitationRecord(
    { usageType: 'single', durationDays: 7, nowMs: now },
    { isFirebaseMode: true, isCaptainSession: true }
  );
  const afterFirstUse = consumeInvitationRecord(singleInv, 'player_1', now + 5000);
  assert.equal(afterFirstUse.usedCount, 1);
  assert.equal(afterFirstUse.status, 'completed');
  assert.equal(afterFirstUse.active, false);

  const completedMeta = computeInviteStatus(afterFirstUse, now + 6000);
  assert.equal(completedMeta.labelAr, 'مكتملة');
  assert.equal(completedMeta.canUse, false);

  const secondTry = validateInviteForJoin({
    invite: afterFirstUse,
    applicantUid: 'player_2',
    nowMs: now + 6000,
  });
  assert.equal(secondTry.valid, false);
  assert.equal(secondTry.errorReason, 'completed');

  // 2. Expired invite ('منتهية') cannot be used after expiresAtMs
  const expiredInv = createSmartInvitationRecord(
    { usageType: 'multi', maxUses: 5, durationDays: 3, nowMs: now },
    { isFirebaseMode: true, isCaptainSession: true }
  );
  const afterExpiryMs = now + 3 * 86_400_000 + 1;
  const expiredMeta = computeInviteStatus(expiredInv, afterExpiryMs);
  assert.equal(expiredMeta.status, 'expired');
  assert.equal(expiredMeta.labelAr, 'منتهية');
  assert.equal(expiredMeta.canUse, false);

  const expiredCheck = validateInviteForJoin({
    invite: expiredInv,
    applicantUid: 'player_3',
    nowMs: afterExpiryMs,
  });
  assert.equal(expiredCheck.valid, false);
  assert.equal(expiredCheck.errorReason, 'expired');

  // 3. Revoked invite ('ملغاة') cannot be used even before expiry
  const activeInv = createSmartInvitationRecord(
    { usageType: 'multi', maxUses: 10, durationDays: 14, nowMs: now },
    { isFirebaseMode: true, isCaptainSession: true }
  );
  const revokedInv = revokeInvitationRecord(activeInv, {
    isFirebaseMode: true,
    isCaptainSession: true,
  });
  const revokedMeta = computeInviteStatus(revokedInv, now + 1000);
  assert.equal(revokedMeta.status, 'revoked');
  assert.equal(revokedMeta.labelAr, 'ملغاة');
  assert.equal(revokedMeta.canUse, false);

  const revokedCheck = validateInviteForJoin({
    invite: revokedInv,
    applicantUid: 'player_4',
    nowMs: now + 1000,
  });
  assert.equal(revokedCheck.valid, false);
  assert.equal(revokedCheck.errorReason, 'revoked');
});

test('Smart Invitations: prevents duplicate membership and requires consent before switching existing personal team', () => {
  const now = 1_760_000_000_000;
  const inv = createSmartInvitationRecord(
    { usageType: 'multi', maxUses: 5, durationDays: 7, nowMs: now },
    { isFirebaseMode: true, isCaptainSession: true }
  );
  const roster = [
    { id: 'cap_1', ownerUid: 'cap_1', name: 'الكابتن' },
    { id: 'existing_plr', ownerUid: 'existing_plr', name: 'لاعب حالي' },
  ];

  // Duplicate membership must be blocked
  const dupCheck = validateInviteForJoin({
    invite: inv,
    applicantUid: 'existing_plr',
    existingPlayers: roster,
    nowMs: now + 1000,
  });
  assert.equal(dupCheck.valid, false);
  assert.equal(dupCheck.errorReason, 'already_member');

  // Pending request duplicate must be blocked
  const pendingCheck = validateInviteForJoin({
    invite: inv,
    applicantUid: 'new_plr',
    existingPlayers: roster,
    existingJoinRequestStatus: 'pending',
    nowMs: now + 1000,
  });
  assert.equal(pendingCheck.valid, false);
  assert.equal(pendingCheck.errorReason, 'already_pending');

  // Player with existing personal team must confirm switch
  const noConsentCheck = validateInviteForJoin({
    invite: inv,
    applicantUid: 'new_plr',
    existingPlayers: roster,
    hasExistingPersonalTeam: true,
    confirmedTeamSwitch: false,
    nowMs: now + 1000,
  });
  assert.equal(noConsentCheck.valid, false);
  assert.equal(noConsentCheck.errorReason, 'needs_switch_consent');

  const withConsentCheck = validateInviteForJoin({
    invite: inv,
    applicantUid: 'new_plr',
    existingPlayers: roster,
    hasExistingPersonalTeam: true,
    confirmedTeamSwitch: true,
    nowMs: now + 1000,
  });
  assert.equal(withConsentCheck.valid, true);
});

test('Smart Invitations: builds and parses shareable invite and personal referral links cleanly', () => {
  const refCode = derivePersonalReferralCode('player_uid_42');
  assert.match(refCode, /^REF-[A-Z2-9]{6}$/);
  assert.equal(sanitizeReferralCode(refCode), refCode);
  assert.equal(sanitizeReferralCode('invalid_ref'), '');

  const url = buildInviteShareUrl('https://midan.example.com/', 'MDN-K7P4-X9Q2', refCode);
  assert.equal(url.includes('#join='), false, 'Invite URL should use clean ?join= without #join= hash');
  const u = new URL(url);
  assert.equal(u.searchParams.get('join'), 'MDN-K7P4-X9Q2');
  const parsed = parseInviteAndReferralFromLocation(u.search, u.hash);
  assert.equal(parsed.inviteCode, 'MDN-K7P4-X9Q2');
  assert.equal(parsed.referralCode, refCode);

  // Backward compatibility: legacy #join=CODE hash links still parse cleanly
  const legacyParsed = parseInviteAndReferralFromLocation('', '#join=MDN-K7P4-X9Q2');
  assert.equal(legacyParsed.inviteCode, 'MDN-K7P4-X9Q2');
});

# Maydan 6v6 — Firestore Security Specification (Hardened RBAC + Step 5ب Privacy)

## 1. Data Invariants
1. **Default Deny**: Every unmatched path is denied for read and write.
2. **Verified Identity**: All writes and team reads require `request.auth != null && request.auth.token.email_verified == true`.
3. **Captain RBAC (Strict `admins/{uid}`)**: Only a verified Firebase Auth UID present in `/admins/{uid}` is an admin (`isCaptain()`). Zero hardcoded emails exist in client code or Firestore rules. No player can self-promote (`role` is immutable for non-captains, `/admins` is Captain-only).
4. **Private Medical & Readiness Isolation**: `/readiness` and `/injuries` can ONLY be read (`get` and `list`) by the document's `ownerUid == request.auth.uid` or `isCaptain()`.
5. **Anonymous Peer Rating + Min-3 Threshold**:
   - Raw ballots at `/peerRatings/{targetId}__{raterUid}` cannot be listed (`allow list: if false`) and can only be `get` by `raterUid == request.auth.uid`. Self-rating (`targetId == request.auth.uid`) is forbidden.
   - Aggregated `/peerRatingStats/{targetId}` stores only `count` and `totalScore` (zero rater identities) and is readable (`get` and `list`) ONLY when `resource.data.count >= 3` and fetched non-realtime on screen open.
   - Every write to `/peerRatingStats/{targetId}` must be atomically paired with a valid `/peerRatings/{targetId}__{uid}` write in the same batch (`getAfter` / `existsAfter`).
6. **Join Request Anti-Spam & High-Entropy Invite Gate**: `/joinRequests/{uid}` requires `uid == request.auth.uid` and an active `/inviteCodes/{inviteCode}` document (minimum 8 chars, CSPRNG 12-char default, `requireApproval == true` by default).
7. **Zero PINs / Zero Shadow Fields**: Every write validates exact allowed keys (`hasAll` + `hasOnly`), field types, string `.size()` limits, valid IDs, and `request.time` timestamps.
8. **Private Pitch Fee Payments & Aggregate Match Schedule (Step 5ب)**:
   - `/pitchSessions/current` holds ONLY match schedule and aggregate totals (`totalCost`, `confirmedCount`, `paidCount`, `paidTotal`) with zero per-player payment identities; `get` allowed for `isTeamMember()`, `list` denied, writes strictly `isCaptain()`.
   - `/pitchPayments/current__{playerId}` holds individual payment status (`paid: boolean`) readable (`get` and `list`) ONLY by `resource.data.ownerUid == request.auth.uid || isCaptain()`, and writable ONLY by `isCaptain()`.

## 2. Adversarial Payloads ("Dirty Dozen" + Step 5ب) — Must All Return `PERMISSION_DENIED`
1. **Unauthenticated Access**: Unauthenticated caller attempts `get` on any collection.
2. **Unverified Admin Email**: Caller whose UID is in `/admins/{uid}` but `email_verified == false` attempts read/write.
3. **Self-Privilege Escalation into `/admins`**: Regular player creates `/admins/{ownUid}` or updates `/settings/team`.
4. **Cross-Player Injury Snooping**: Player A attempts `get` on `/injuries/{playerBId}` or unfiltered `list` on `/injuries`.
5. **Cross-Player Readiness Snooping**: Player A attempts `get` on `/readiness/{playerBId}` or unfiltered `list` on `/readiness`.
6. **Role Escalation & Shadow Field Injection**: Regular player updates `/players/{ownUid}` with `{ "role": "admin" }` or `{ "pin": "1234" }`, or edits `/players/{otherUid}`.
7. **Captain Skill-Lock Bypass**: Regular player updates `skills` on `/players/{ownUid}` while `settings/team.lockSkills == true`.
8. **Raw Peer Rating Deanonymization**: Player or Captain attempts `list` on `/peerRatings` or `get` on another rater's ballot.
9. **Self-Rating Attack**: Player A attempts to rate themselves in `/peerRatings/{uidA}__{uidA}`.
10. **Under-Threshold Peer Rating Read**: Player or Captain attempts `get` or `list` on `/peerRatingStats/{targetId}` where `count < 3`.
11. **Orphaned/Tampered Aggregate Manipulation**: Player writes `/peerRatingStats/{targetId}` without a matching atomic ballot delta.
12. **Short Invite Codes (<8 chars), Forged Timestamps & Join Abuse**: Caller writes invite code shorter than 8 chars, forges `updatedAt != request.time`, or self-approves a `joinRequest` while `requireApproval == true`.
13. **Cross-Player Pitch Payment Snooping (Step 5ب)**: Player A attempts `get` on `/pitchPayments/current__player_b` or `list` on `/pitchPayments` with `where('teamId', '==', 'main')`.
14. **Non-Captain Pitch Fee/Schedule Tampering (Step 5ب)**: Regular player attempts to write `/pitchSessions/current` or mark themselves paid in `/pitchPayments/current__player_a`.

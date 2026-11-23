# Maydan 6v6 — Firestore Security Specification (Phase 0 TDD)

## 1. Data Invariants
1. **Default Deny**: Every unmatched path is denied for read and write.
2. **Verified Identity**: All writes and team reads require `request.auth != null && request.auth.token.email_verified == true`.
3. **Captain RBAC**: Only the bootstrapped Captain (`ammarfara210@gmail.com` with `email_verified == true`) or a UID present in `/admins/{uid}` is an admin (`isCaptain()`). No player can self-promote (`role` is immutable for non-captains, `/admins` is Captain-only).
4. **Private Medical & Readiness Isolation**: `/readiness` and `/injuries` can ONLY be read (`get` and `list`) by the document's `ownerUid == request.auth.uid` or `isCaptain()`.
5. **Anonymous Peer Rating + Min-3 Threshold**:
   - Raw ballots at `/peerRatings/{targetId}__{raterUid}` cannot be listed (`allow list: if false`) and can only be `get` by `raterUid == request.auth.uid`. Self-rating (`targetId == request.auth.uid`) is forbidden.
   - Aggregated `/peerRatingStats/{targetId}` stores only `count` and `totalScore` (zero rater identities) and is readable (`get` and `list`) ONLY when `resource.data.count >= 3`.
   - Every write to `/peerRatingStats/{targetId}` must be atomically paired with a valid `/peerRatings/{targetId}__{uid}` write in the same batch (`getAfter` / `existsAfter`).
6. **Join Request Anti-Spam & Invite Gate**: `/joinRequests/{uid}` requires `uid == request.auth.uid` and an active `/inviteCodes/{inviteCode}` document, preventing duplicate requests and unauthorized joins.
7. **Zero PINs / Zero Shadow Fields**: Every write validates exact allowed keys (`hasAll` + `hasOnly`), field types, string `.size()` limits, valid IDs, and `request.time` timestamps.

## 2. The "Dirty Dozen" Adversarial Payloads (Must All Return `PERMISSION_DENIED`)
1. **Self-Privilege Escalation**: Regular player updates `/players/{ownUid}` with `{ "role": "admin" }`.
2. **Shadow Field Injection**: Player updates `/players/{ownUid}` adding ghost field `{ "isVerified": true }` or `{ "pin": "1234" }`.
3. **Unverified Admin Email Spoof**: Caller has `token.email == "ammarfara210@gmail.com"` with `email_verified == false` attempting to update `/settings/team`.
4. **Cross-Player Injury Snooping (get)**: Player B attempts `get` on `/injuries/{playerAInjuryId}`.
5. **Cross-Player Readiness List Scraping**: Player B attempts unfiltered `list` on `/readiness` without `where('ownerUid', '==', uid)`.
6. **Raw Peer Rating Deanonymization**: Player or Captain attempts `list` on `/peerRatings` or `get` on another player's ballot `/peerRatings/p1__otherUid`.
7. **Under-Threshold Peer Rating Read**: Player attempts `get` or `list` on `/peerRatingStats/{targetId}` where `count == 2` (< 3).
8. **Self-Rating Attack**: Player A attempts to create `/peerRatings/{uidA}__{uidA}` with `{ targetId: uidA, raterUid: uidA, score: 10 }`.
9. **Orphaned Aggregate Manipulation**: Player attempts to update `/peerRatingStats/{targetId}` with `count: 100, totalScore: 1000` without a paired ballot write in the same batch.
10. **Cross-Player Profile Overwrite**: Player A attempts to update `/players/{uidB}` modifying `name` or `skills`.
11. **Oversized Resource / ID Poisoning**: Attacker creates `/suggestions/{200-char-invalid-id!}` or `/suggestions/s1` with a 50KB `text` string.
12. **Timestamp Forgery & Duplicate Join Request**: Applicant submits `/joinRequests/{otherUid}` or forged `createdAt` not equal to `request.time`, or an invalid `inviteCode`.

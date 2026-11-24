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
9. **IDOR Anti-Impersonation on Player-Created Logs**:
   - On `allow create` for `/attendance`, `/readiness`, `/injuries`, and `/reports`, non-captains MUST satisfy `incoming().playerId == request.auth.uid && incoming().ownerUid == request.auth.uid`.
10. **Phase A Fair-Budget & Match Metadata Validation**:
   - Optional `stats6` on `/players` and `/joinRequests` enforces 6 integer stats (`PAC, SHO, PAS, DRI, DEF, PHY`), each strictly `40..85`, with exact sum `== 360` and subject to `lockSkills`.
   - Optional `roleOverride` is restricted to `['', 'ST', 'CAM_WINGER', 'CM', 'DEF_CB', 'GK']`.
   - Optional report metadata (`pitchMode`, `matchResult`, `goalsConceded`, `matchSessionId`) is strictly type- and enum-validated.
11. **Phase B Decentralized Verification, Secret Voting & Random Peer Missions**:
   - `/matchSessions/{sessionId}`: Must start as `draft` with `confirmers == [createdBy]` and `votingOpen == false`. Only listed participants who haven't confirmed yet may append themselves; transitions to `verified` (`votingOpen == true`) strictly at `>= 3` distinct confirmers.
   - `/matchVoteBallots/{sessionId}__{targetId}__{voterUid}`: Strictly private (`allow list: if false`, `allow get` only for own `voterUid`), immutable, anti-self-vote (`targetId != request.auth.uid`), requires verified open session and atomic pairing with `/matchVoteTallies`.
   - `/matchVoteTallies/{sessionId}__{targetId}`: Anonymous 10-bucket histogram (`h1..h10`) enabling exact Trimmed Mean without exposing voters. Blind `increment()` updates verify `sum(h1..h10) == count`, `weightedSum == totalScore`, and non-decreasing buckets. `allow list: if false`; `allow get` locked until `count >= 2` AND `session.voterUids.size() * 2 >= session.participantIds.size()` (50% quorum).
   - `/missionClaims/{claimId}`: Assigns 2 distinct non-claimant teammates (`!(claimantUid in verifierUids)`). Only those 2 assigned verifiers may approve/reject; transitions to `verified` at 2 approvals (XP only, never touches `skills`/`stats6`).
12. **Batch 2 Proposed Rules (`DRAFT_firestore.rules` — pending Captain deployment approval)**:
   - `/attendance`: Adds `'متردد'` to allowed statuses (`['جاي', 'متردد', 'ما فيني']`).
   - `/reports` & `/matchSessions`: Adds `'5v5'` and `'7v7'` to allowed `pitchMode` (`['5v5', '6v6', '7v7', '11v11']`).
   - `/tactics/current`: Expands allowed `formation` IDs across all `5v5`, `6v6`, `7v7`, and `11v11` formations.
   - `/footballLibrary/{articleId}`: Team members may read (`get`/`list`) ONLY `published == true` articles; Captain (`isCaptain()`) may read hidden drafts and `create`/`update`/`delete` with strict `hasAll`/`hasOnly` keys, HTTPS-only `sourceUrl`, bounded arrays, and valid category/level enums.

## 2. Adversarial Payloads ("Dirty Dozen" + Step 5ب + Phase A/B + Batch 2) — Must All Return `PERMISSION_DENIED`
1. **Unauthenticated Access**: Unauthenticated caller attempts `get` on any collection.
2. **Unverified Admin Email**: Caller whose UID is in `/admins/{uid}` but `email_verified == false` attempts read/write.
3. **Self-Privilege Escalation into `/admins`**: Regular player creates `/admins/{ownUid}` or updates `/settings/team`.
4. **Cross-Player Injury Snooping**: Player A attempts `get` on `/injuries/{playerBId}` or unfiltered `list` on `/injuries`.
5. **Cross-Player Readiness Snooping**: Player A attempts `get` on `/readiness/{playerBId}` or unfiltered `list` on `/readiness`.
6. **Role Escalation & Shadow Field Injection**: Regular player updates `/players/{ownUid}` with `{ "role": "admin" }` or `{ "pin": "1234" }`, or edits `/players/{otherUid}`.
7. **Captain Skill-Lock Bypass**: Regular player updates `skills` or `stats6` on `/players/{ownUid}` while `settings/team.lockSkills == true`.
8. **Raw Peer Rating Deanonymization**: Player or Captain attempts `list` on `/peerRatings` or `get` on another rater's ballot.
9. **Self-Rating Attack**: Player A attempts to rate themselves in `/peerRatings/{uidA}__{uidA}`.
10. **Under-Threshold Peer Rating Read**: Player or Captain attempts `get` or `list` on `/peerRatingStats/{targetId}` where `count < 3`.
11. **Orphaned/Tampered Aggregate Manipulation**: Player writes `/peerRatingStats/{targetId}` without a matching atomic ballot delta.
12. **Short Invite Codes (<8 chars), Forged Timestamps & Join Abuse**: Caller writes invite code shorter than 8 chars, forges `updatedAt != request.time`, or self-approves a `joinRequest` while `requireApproval == true`.
13. **Cross-Player Pitch Payment Snooping (Step 5ب)**: Player A attempts `get` on `/pitchPayments/current__player_b` or `list` on `/pitchPayments` with `where('teamId', '==', 'main')`.
14. **Non-Captain Pitch Fee/Schedule Tampering (Step 5ب)**: Regular player attempts to write `/pitchSessions/current` or mark themselves paid in `/pitchPayments/current__player_a`.
15. **IDOR Impersonation on Logs (Security Fix)**: Player A attempts `create` on `/reports`, `/attendance`, `/readiness`, or `/injuries` with `playerId: 'player_b'` and `ownerUid: 'player_a'`.
16. **360-Point Budget Bypass (Phase A)**: Player updates `/players/{ownUid}` with `stats6` summing to `!= 360` or any stat outside `40..85`.
17. **Match Verification Bypass (Phase B)**: Player creates `/matchSessions/{id}` directly as `verified` or confirms twice.
18. **Secret Vote Self-Rating & Premature Read (Phase B)**: Player votes for themselves in `/matchVoteBallots`, reads another voter's ballot, or reads `/matchVoteTallies` while session participation is `< 50%`.
19. **Mission Self-Verification / Unassigned Verifier (Phase B)**: Claimant includes themselves in `verifierUids`, approves own mission, or an unassigned player attempts to approve/reject `/missionClaims/{id}`.
20. **Global Football Library Non-Captain Write & Hidden Draft Read (Batch 2)**: Regular player attempts to create/update/delete `/footballLibrary/{id}` OR attempts to read a hidden article (`published == false`).
21. **Global Football Library XSS URL & Shadow Field Injection (Batch 2)**: Even Captain attempts to save `/footballLibrary/{id}` with `sourceUrl: "javascript:alert(1)"` or extra unexpected fields.

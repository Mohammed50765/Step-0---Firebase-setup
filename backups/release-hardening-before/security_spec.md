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
12. **Single-Team Collaborative Hardening (Phases 3–5)**:
   - `/attendance`: Normalized to `['جاي', 'محتمل', 'معتذر']` with `updatedAt == request.time`; supports owner/Captain updates.
   - `/reports` & `/matchSessions`: Allowed `pitchMode` strictly `['5v5', '6v6', '7v7', '11v11']`; non-captain report creates require `confirmedByUids == []`, `verified == false`, and an atomic `/reportThrottle/{uid}` write enforcing a 45-minute (`2,700,000` ms) server-side cooldown; non-owner teammates confirm reports via `update` (`verified == true`).
   - `/inviteCodes/{code}` & `/inviteAdminLogs/{code}`: Public invite preview documents exclude `createdBy`/`lastUsedBy` PII and enforce `isMemberShareCode == true => requireApproval == true`; permanent member share codes NEVER permit direct `/players/{uid}` creation (`status == 'approved'` denied). Captain audit logs live strictly in `/inviteAdminLogs/{code}` (`isCaptain()` only).
   - **Tier 2 Organizers (`organizerUids` in `/settings/team`)**: Organizers may update ONLY `teamName`, `logo`, `defaultCurrency`, `defaultPitchCost`, `lineupPermission`, `updatedAt` (never `inviteCode`, `organizerUids`, or `lockSkills`), and may manage `/pitchSessions/current`, `/pitchPayments/*`, and `/tactics/current`.
   - `/tactics/current` & `/lineupVotes/{uid}`: Writes obey `canPublishLineup()` (`isCaptain()`, `'all'`, or `isOrganizer()`), support 1-step `previousSnapshot` undo, and allow members to cast `approve`/`swap` lineup votes.
   - **Self-Leave (`/players/{uid}` & `/joinRequests/{uid}`)**: Non-captain members can delete their own `/players/{uid}` and `/joinRequests/{uid}` documents atomically when leaving the team; Captains cannot self-delete.
   - `/footballLibrary/{articleId}`: Team members may read (`get`/`list`) ONLY `published == true` articles; Captain (`isCaptain()`) may read hidden drafts and `create`/`update`/`delete` with strict `hasAll`/`hasOnly` keys, HTTPS-only `sourceUrl`, bounded arrays, and valid category/level enums.
13. **Multi-Team Cross-Team & Platform Owner Isolation (Phase 6)**:
   - `/teams/{teamId}`: `allow list: if false`. `allow get` ONLY if `founderUid == request.auth.uid`, an existing member at `/teams/{teamId}/members/{uid}`, or a pending/approved applicant at `/teams/{teamId}/joinRequests/{uid}`.
   - Platform Owners in `/admins/{uid}` (`isCaptain()`) have **ZERO** privileged read or write access to any other user's `/teams/{teamId}` or subcollections unless they are explicitly the `founderUid` or a member of that specific team.
   - `/platform/config`: Single doc readable (`get`) by verified users, `list`/`delete` denied, writable ONLY by `admins/{uid}` (`allowNewTeams: boolean`).
14. **Self-Only User Registry (`/users/{uid}`)**: Strictly readable/writable (`get`, `create`, `update`) ONLY by `uid == request.auth.uid`. `list` and `delete` are denied. Server enforces `ownedTeamIds.size() <= 3` and `teamIds.size() <= 5`.
15. **Spark Zero-Budget Team & Capacity Guards**:
   - Creating a new `/teams/{teamId}` enforces: `founderUid == request.auth.uid`, `memberCount == 1`, `deletedAt == null`, `logo.size() <= 68500` (~50 KB), `maxMembersPerTeam` `6..100`, `platform/config.allowNewTeams != false`, and caller `ownedTeamIds.size() < 3` and `teamIds.size() < 5`.
   - Platform Owner legacy migration (`migratedFrom == 'main'`) allows `isCaptain()` to bootstrap the migrated `/teams/{teamId}` with `memberCount <= maxMembersPerTeam`.
16. **Public Member Zero-Health-Leak & Strict `/private/*` Isolation**:
   - `/teams/{teamId}/members/{memberId}` explicitly rejects all sensitive health/readiness/injury/medical/PIN fields (`sleep`, `fatigue`, `mood`, `injury`, `injuries`, `severity`, `expectedReturn`, `readiness`, `medicalNotes`, `medication`, `diagnosis`, `rpe`, `pin`, `pinHash`) and constrains `availableStatus` to `['متاح', 'غير متاح']`.
   - `/teams/{teamId}/members/{memberId}/private/{docId}` holds personal readiness/injury logs and is accessible (`get`, `list`, `create`, `update`, `delete`) strictly to `memberId == request.auth.uid || isMultiFounder(teamId)` — blocking fellow members, organizers, and non-member platform admins.
17. **Consolidated Match Attendance (`/teams/{teamId}/attendance/{matchKey}`)**:
   - Stores one document per match/session with bounded `responses` map (`<= 100` entries). Non-founder members updating an existing doc can modify ONLY `responses[request.auth.uid]` (`responses.diff(existing().responses).affectedKeys().hasOnly([request.auth.uid])`), preventing tampering with teammates' RSVP entries.
18. **Multi-Team Join Modes & Atomic Self-Join / Self-Leave**:
   - Default `joinMode` is `'approval'`; `'instant'` requires active non-share `/inviteCodes/{code}` (`teamId == teamId`, `requireApproval == false`, `isMemberShareCode != true`), `team.deletedAt == null`, `team.joinMode == 'instant'`, and `team.memberCount < team.maxMembersPerTeam`, paired atomically with `memberCount + 1`.
   - Team Founder cannot self-delete `/members/{founderUid}` via `leaveTeam`; non-founder members self-delete atomically while decrementing `memberCount` and removing themselves from `organizerUids`.
19. **Leadership Transfer (`transferTeamFounder`) & Soft Delete**:
   - Founder may transfer `founderUid` ONLY to an existing member (`exists(/teams/{teamId}/members/{targetUid})`) while keeping `organizerUids` valid; founder may soft-delete via `deletedAt == request.time`. Organizers may update ONLY `teamName`, `logo`, `defaultCurrency`, `defaultPitchCost`, `lineupPublishMode`, `updatedAtMs`, `updatedAt`.
20. **Team-Scoped All Subcollections**: All 21 subcollections under `/teams/{teamId}` (`members`, `members/{uid}/private`, `joinRequests`, `attendance`, `matches`, `reports`, `reportThrottle`, `peerRatings`, `peerRatingStats`, `adminRatings`, `suggestions`, `tactics`, `lineupVotes`, `pitchSessions`, `pitchPayments`, `matchSessions`, `matchVoteBallots`, `matchVoteTallies`, `missionClaims`, `footballLibrary`, `inviteAdminLogs`) mirror the full Dual-Mode invariants scoped strictly to `isMultiMember(teamId)` / `isMultiFounder(teamId)`.

## 2. Adversarial Payloads ("Dirty Dozen" + Step 5ب + Phase A/B + Hardened Single-Team #20–#28 + Multi-Team #29–#36) — Must All Return `PERMISSION_DENIED`
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
12. **Short Invite Codes (<8 chars), Forged Timestamps & Join Abuse**: Caller writes invite code shorter than 8 chars (`MDN-606`), forges `updatedAt != request.time`, submits non-atomic `joinRequest` without consuming `usedCount`, or self-approves a `joinRequest` while `requireApproval == true`.
13. **Cross-Player Pitch Payment Snooping (Step 5ب)**: Player A attempts `get` on `/pitchPayments/current__player_b` or `list` on `/pitchPayments` with `where('teamId', '==', 'main')`.
14. **Non-Captain/Non-Organizer Pitch Fee/Schedule Tampering (Step 5ب)**: Regular non-organizer player attempts to write `/pitchSessions/current` or mark themselves paid in `/pitchPayments/current__player_a`.
15. **IDOR Impersonation on Logs (Security Fix)**: Player A attempts `create` on `/reports`, `/attendance`, `/readiness`, or `/injuries` with `playerId: 'player_b'` and `ownerUid: 'player_a'`.
16. **360-Point Budget Bypass (Phase A)**: Player updates `/players/{ownUid}` with `stats6` summing to `!= 360` or any stat outside `40..85`.
17. **Match Verification Bypass (Phase B)**: Player creates `/matchSessions/{id}` directly as `verified` or confirms twice.
18. **Secret Vote Self-Rating & Premature Read (Phase B)**: Player votes for themselves in `/matchVoteBallots`, reads another voter's ballot, or reads `/matchVoteTallies` while session participation is `< 50%`.
19. **Mission Self-Verification / Unassigned Verifier (Phase B)**: Claimant includes themselves in `verifierUids`, approves own mission, or an unassigned player attempts to approve/reject `/missionClaims/{id}`.
20. **Global Football Library Non-Captain Write & Hidden Draft Read**: Regular player attempts to create/update/delete `/footballLibrary/{id}` OR attempts to read a hidden article (`published == false`).
21. **Global Football Library XSS URL & Shadow Field Injection**: Even Captain attempts to save `/footballLibrary/{id}` with `sourceUrl: "javascript:alert(1)"` or extra unexpected fields.
22. **Smart Invitations Quota & Reuse Bypass**: Non-captain writes/lists `/inviteCodes`, existing member submits duplicate `joinRequest`, or second applicant reuses a completed single-use invite code.
23. **Member Share Code Direct Join Escalation**: Outsider attempts `status: 'approved'` join or direct `/players/{uid}` creation using a `isMemberShareCode: true` code, or Captain creates `isMemberShareCode: true` with `requireApproval: false`.
24. **Invite Code PII Isolation Breach**: Any client writes `createdBy`/`lastUsedBy` into public `/inviteCodes/{code}`, or non-captain reads/writes `/inviteAdminLogs/{code}`.
25. **45-Minute Report Cooldown & Self-Confirmation Bypass**: Player A submits an immediate second `/reports` doc within 45 minutes or confirms their own report (`verified: true` as owner).
26. **Tactics / Lineup Vote Impersonation & Captain Self-Delete**: Regular player publishes `/tactics/current` when `lineupPermission == 'organizers'`, votes under another UID in `/lineupVotes/{otherUid}`, or Captain attempts self-delete on `/players/captain_uid`.
27. **Organizer Privilege Escalation**: Tier 2 organizer attempts to modify `inviteCode`, `organizerUids`, or `lockSkills` on `/settings/team`.
28. **Invalid Legacy Attendance Enum**: Player submits or updates `/attendance` with disallowed status (`'ما فيني'`).
29. **Multi-Team Cross-Team & Platform-Owner Isolation**: Member or Founder of Team B attempts read/list/write on Team A (`/teams/teamA`, members, reports, tactics); Platform Owner (`admins/{uid}`) attempts read on Team B without membership; any user attempts `list` on `/teams`.
30. **Multi-Team Public Member Health/Readiness Leak & Role Escalation**: Caller injects `sleep`, `fatigue`, `injury`, `severity`, `expectedReturn`, or `pin` into `/teams/{teamId}/members/{uid}`, attempts self-escalation (`role: 'founder'`, `isOrganizer: true`), or bypasses `lockSkills`.
31. **Multi-Team Private Subcollection Isolation**: Fellow team member, team organizer, or non-member platform admin attempts `get`/`list`/`create` on `/teams/{teamId}/members/{otherUid}/private/{docId}`.
32. **Spark Kill-Switch, Quota & Logo Caps**: User creates `/teams/{teamId}` while `platform/config.allowNewTeams == false`, when `ownedTeamIds.size() >= 3`, when `teamIds.size() >= 5`, or with a logo exceeding `68500` chars (~50 KB).
33. **Multi-Team Invite Mode & Organizer Escalation**: Outsider performs `'approved'` instant join against an `'approval'`-mode team or full team (`memberCount >= maxMembersPerTeam`), or organizer modifies `founderUid`, `joinMode`, `inviteCode`, or `lockSkills` on `/teams/{teamId}`.
34. **Multi-Team Leadership Transfer, Soft Delete & Self-Leave**: Non-founder attempts `transferTeamFounder` or `deletedAt` soft-delete; founder attempts transferring to a non-member or self-deleting `/members/{founderUid}`.
35. **Consolidated Attendance Map & `/users/{uid}` Cross-User Isolation**: Team member edits a teammate's entry inside `/teams/{teamId}/attendance/{matchKey}.responses` or attempts read/write/list on another user's `/users/{otherUid}`.
36. **Multi-Team Report Throttle, Self-Confirm, Pitch Payments & Secret Tallies Isolation**: Member bypasses 45-min cooldown in `/teams/{teamId}/reportThrottle/{uid}`, confirms own report, snoops teammate's `/teams/{teamId}/pitchPayments`, or reads `<50%` quorum `/teams/{teamId}/matchVoteTallies`.

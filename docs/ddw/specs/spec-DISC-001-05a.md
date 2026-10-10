# Spec DISC-001-05a: Groups, Members and Roles

| Field | Value |
|-------|-------|
| Ticket | DISC-001-05a |
| PRD | docs/ddw/prd/prd-DISC-001-05a.md |
| Tier | FEATURE |
| Date | 2026-10-10 |
| Spec loops | 1 |
| Loops since last human decision | 1 |

## Summary
A new hexagonal API module, `groups`, stores a group (name, default rate type), its members (a
registered user or a ghost with only a display name, each with a role), invitation links, claim
links and the group's own expense categories. Creating a group makes its creator an admin and
copies the top-level expense categories of PRD 02 Appendix A into the group in the same transaction.
Joining and claiming go through random single-purpose tokens that are stored only as SHA-256
hashes. Every group route first resolves the caller's membership: a non-member gets 404, a member
without the admin role gets 403 on admin-only actions. Nothing about expenses, balances,
settlements, removing or leaving, or the activity log is built (DISC-001-05b to 05d), and no web
screen is built: the group UI ships with 05b (parent pending decision 4, recommended option).

## Design decisions
- D1: Group data is not owned by one user, so the module does not use `scopedTo`. Each use case
  first calls a `GroupAccess` guard that loads the caller's member row: no row answers
  `ResourceNotFound` (404, FR-11, AC-21); a member row without `role = 'admin'` on an admin-only
  action answers 403 `GROUP_ADMIN_REQUIRED`. A non-member can never tell a missing group from a
  group they do not belong to.
- D2: Members. One table, `group_members`; a ghost has `user_id` null and a `display_name`; a
  registered member has `user_id` and no stored name (the name is read from `users.display_name`,
  which may be null, and the API never returns an email). A member keeps its `id` and `joined_at`
  for life, so claiming only sets `user_id` and clears `display_name` (FR-07, AC-12): every later
  record that points at the member id follows the user without being rewritten. Admin requires a
  registered member (check constraint), so a ghost cannot be promoted (409
  `GROUP_MEMBER_NOT_REGISTERED`).
- D3: Tokens. Invitation and claim tokens are 32 random bytes (256 bits, above NFR-02's 128) from
  `crypto.randomBytes`, base64url. Only `sha256(token)` is stored, so a database read does not give
  a working link. The raw token is returned once, in the creation response; the web builds the
  link. Tokens travel in the request body of a POST (`/groups/join`, `/groups/claim`), never in a
  path or query, because the request logger records `req.originalUrl`. Audit log lines carry ids
  only, never a token.
- D4: Every invalid token (unknown, expired, already used) answers the same 400 `TOKEN_INVALID`,
  so a caller cannot tell the cases apart (AC-06, AC-13). Invitations are valid for exactly 7 days
  from creation (`expires_at = now + 7 days`, FR-03) and can be used by many users until then; the
  PRD makes only claim links single-use.
- D5: Claim links. The PRD gives a claim link no expiry, only single use (NFR-02), so a claim link
  does not expire. At most one unused claim link exists per ghost member (partial unique index):
  generating another one replaces the previous one, so a leaked link is revoked by asking for a new
  one. Using it sets `used_at` in an atomic `update … where used_at is null returning`, so two
  concurrent claims cannot both succeed (AC-13). Needs the owner's confirmation (open question 1).
- D6: The 50-member limit (NFR-01) counts ghost members. Every path that adds a member (accept an
  invitation, add a ghost) runs in a transaction that first locks the group row
  (`select … for update`) and then counts the members, so two concurrent adds cannot pass 50. Over
  the limit the answer is 409 `GROUP_MEMBER_LIMIT_REACHED` (AC-08, AC-10).
- D7: A user who is already a member and opens an invitation or accepts a claim link gets 409
  `GROUP_ALREADY_MEMBER` and nothing changes (AC-07, AC-14); the unique index
  `(group_id, user_id) where user_id is not null` is the backstop. Accepting a claim link when the
  user is already in the group leaves the link unused.
- D8: Group categories live in their own table, `group_categories`, not in `categories`: the
  existing table is keyed by owner with composite foreign keys, and groups are not owners. The
  model mirrors it (default key, nullable name, icon, color, archive timestamp). Creating a group
  inserts one row per top-level expense entry of `DEFAULT_CATEGORIES` (`parentKey` null, kind
  `expense`) in the group's transaction (FR-02, AC-03). Group categories are top level and expense
  only (PRD FR-02), so there are no children and no kind. Name rules reuse `categoryNameSchema` and
  uniqueness is case-insensitive, NFC, across a category's own name and the translations of its
  default key, as for personal categories; a clash answers 409 `CATEGORY_NAME_TAKEN` (existing
  code). Group categories are never deleted, only archived (the PRD says add, rename, archive).
- D9: Default rate type. `groups.default_rate_type` stores a value of `RATE_TYPES` (FR-01, FR-09);
  changing it touches only that column (AC-17: existing records unchanged). Its effect on
  settlements is DISC-001-05c.
- D10: Account deletion (PRD 01f) must keep working once members reference users. The foreign key
  `group_members.user_id → users.id` is `on delete restrict`, and an ordered erasure step
  `eraseUserGroups` registered in the composition root turns each membership of the erased user into
  a ghost member named "Former member" with the role `member`, in the erasure transaction. That is
  the minimum for deletion to succeed; DISC-001-05c owns the requirement (its FR-10, AC-20), adds
  its proof over expenses, shares and settlements, and decides what happens to a group left without
  an admin (parent pending decision 2). One test here asserts that deleting an account does not
  fail and leaves the group usable.
- D11: Migration `0026_groups`: five new tables, additive, no change to existing tables; its
  journal `when` must exceed the maximum on `main` at merge time (now 1791590000000 for 0025), per
  the Drizzle merge rule. Rollback script `0026_groups.down.sql`, idempotent, drops the five tables
  (destructive for group data only).
- D12: The `GroupMembershipReader` port that `shared/access` declares gets its real adapter here
  (`DrizzleGroupMembershipReader`, `groupIdsOf(userId)`). It is exported but not wired into the
  other modules' policies: no shared row exists until 05b, and wiring it changes the read scope of
  every module. 05b wires it where its first shared resource appears. The module also does not
  import `shared/access` internals beyond `ResourceNotFound`.
- D13: Ports and boundaries. The module declares ports for the clock and the token source; its
  infrastructure imports `users` only through `infrastructure/db/foreign-relations.ts` (as drizzle-kit
  needs for the foreign keys). Domain and application import nothing from infrastructure
  (`architecture-boundaries.test.ts` covers it).
- D14: No new runtime dependency and no money column (`crypto` is a Node built-in); nothing in this
  ticket stores an amount.
- D15: Out of the PRD text, decided here and listed for the owner: a group name is 1 to 50
  characters (NFC, trimmed, no control or format characters, the account-name rules); a ghost
  display name uses the same rules; a group cannot be renamed or deleted (not in the PRD).
- D16: Threat model mitigation (R-04). A member has at most one invitation at a time: creating a new
  one replaces the previous one (`on conflict (created_by_member_id) do update`), so the table holds
  at most one row per member (50 per group), a leaked link is revoked by asking for a new one, and the
  7-day expiry of FR-03 is unchanged for the link in force.

## Open questions for the owner
1. Claim links do not expire (D5). Alternative: expire them after 7 days like invitations, which
   forces a new link for a ghost nobody claims in time.
2. The ghost-to-"Former member" conversion at account deletion (D10) is built here, a minimum that
   05c then proves. Alternative: delete the user's memberships and leave the proof entirely to 05c,
   which loses the membership.
3. No web screen in this ticket (Summary). Alternative: add a minimal group list and create screen
   now; it would ship without anything to use groups for until 05b.

## Coverage: PRD → blocks
| Requirement | Covered by |
|---|---|
| FR-01 | Block 1, Block 2, Block 3, Block 4, Block 5 |
| FR-02 | Block 3, Block 4, Block 5 |
| FR-03 | Block 3, Block 4, Block 5 |
| FR-04 | Block 3, Block 4, Block 5 |
| FR-05 | Block 3, Block 4, Block 5 |
| FR-06 | Block 3, Block 4, Block 5 |
| FR-07 | Block 3, Block 4, Block 5 |
| FR-08 | Block 3, Block 4, Block 5 |
| FR-09 | Block 3, Block 4, Block 5 |
| FR-10 | Block 3, Block 4, Block 5 |
| FR-11 | Block 3, Block 4, Block 5 |
| NFR-01 | Block 2 (backstop), Block 3, Block 4 (lock and count) |
| NFR-02 | Block 3 (token source), Block 4 (hash and single-use update) |

## Dependencies between blocks
Block 1 first (shared contract). Then 2 → 3 → 4 → 5: schema and migration, domain and use cases with
in-memory fakes, Drizzle adapters, routes and composition.

## Block 1 — Shared contract and error codes

**Files**
- `packages/shared/src/groups/group.ts` (new) — Zod schemas and types of the contract.
- `packages/shared/src/errors.ts` (modified) — codes `GROUP_ADMIN_REQUIRED`,
  `GROUP_ALREADY_MEMBER`, `GROUP_MEMBER_LIMIT_REACHED`, `GROUP_MEMBER_NOT_REGISTERED`.
- `packages/shared/src/index.ts` (modified) — exports.
- `apps/api/src/shared/http/error-handler.ts` (modified) — `GROUP_ADMIN_REQUIRED` maps to 403 and
  the other three to 409.
- `apps/web/src/lib/api-client.ts` (modified) — message keys for the four codes.
- `apps/web/messages/en.json`, `apps/web/messages/es.json` (modified) — `errors.groupAdminRequired`,
  `errors.groupAlreadyMember`, `errors.groupMemberLimitReached`, `errors.groupMemberNotRegistered`.
- `packages/shared/test/group-schemas.test.ts` (new).

**Logic**
Contract only; the routes of Block 5 serve it.

**Shared types** *(no route here)*
- `groupNameSchema`: string, NFC, trimmed, 1 to 50 characters, no control or format characters.
- `createGroupRequestSchema`: `{ name: groupName, defaultRateType: rateType }`, strict.
- `updateGroupRequestSchema`: `{ defaultRateType: rateType }`, strict.
- `addGhostMemberRequestSchema`: `{ displayName: groupName }`, strict.
- `joinGroupRequestSchema`, `claimGhostRequestSchema`: `{ token: string 43 characters, base64url }`,
  strict.
- `groupIdParamsSchema` `{ id: uuid }`; `groupMemberParamsSchema` `{ id: uuid, memberId: uuid }`;
  `groupCategoryParamsSchema` `{ id: uuid, categoryId: uuid }`.
- `createGroupCategoryRequestSchema`: `{ name: categoryName, icon, color }`, strict.
- `updateGroupCategoryRequestSchema`: `{ name?, icon?, color?, archived?: boolean }`, strict, at
  least one key.
- Responses: `groupResponseSchema` `{ id, name, defaultRateType, role, memberCount, createdAt }`;
  `groupDetailResponseSchema` adds `members: [{ id, displayName: string | null, isGhost, role,
  joinedAt }]`; `invitationResponseSchema` `{ token, expiresAt }`; `claimLinkResponseSchema`
  `{ token }`; `groupCategoryResponseSchema` `{ id, defaultKey, name, icon, color, archivedAt }`.

**Input validation**
Strict objects, no extra keys; the token is exactly 43 base64url characters (32 bytes); names as
above.

**Error handling**
- Unknown keys, wrong types or lengths — 400 `VALIDATION_FAILED` through the shared middleware.

**Required tests**
- [ ] A group with a 51-character name is rejected; a 50-character one passes — validates AC-02
- [ ] An empty or whitespace-only name is rejected — validates AC-02
- [ ] A token of the wrong length or alphabet is rejected — validates AC-05
- [ ] The update body with no key is rejected — validates AC-17
- [ ] The error codes map to 403 and 409 as stated — validates AC-16, AC-08

**Completion criterion**
The shared tests pass and `pnpm typecheck` accepts the new message keys on the web side.

## Block 2 — Schema and migration

**Files**
- `apps/api/src/groups/infrastructure/db/schema.ts` (new) — `groups`, `groupMembers`,
  `groupInvitations`, `groupClaimLinks`, `groupCategories`.
- `apps/api/src/groups/infrastructure/db/foreign-relations.ts` (new) — re-exports `users`.
- `apps/api/drizzle/0026_groups.sql` (generated), `apps/api/drizzle/meta/*` (generated),
  `apps/api/drizzle/rollback/0026_groups.down.sql` (new).
- `apps/api/test/groups/migration.test.ts` (new), `apps/api/test/groups/schema-introspection.test.ts` (new).

**Logic**
Generated with drizzle-kit from the schema file, then the journal `when` checked against `main`.

**Data model**
- `groups`: `id` uuid pk; `name` text not null (check 1 to 50 characters); `default_rate_type` text
  not null (check in the seven `RATE_TYPES`); `created_at`, `updated_at` timestamptz.
- `group_members`: `id` uuid pk; `group_id` uuid not null fk `groups` on delete cascade; `user_id`
  uuid null fk `users` on delete restrict; `display_name` text null (check 1 to 50 characters);
  `role` text not null default `member` (check in `admin`, `member`); `joined_at` timestamptz not
  null default now. Checks: `user_id is not null or display_name is not null`; `user_id is null or
  display_name is null`; `role = 'member' or user_id is not null`. Unique `(id, group_id)` (target
  of later foreign keys); unique `(group_id, user_id) where user_id is not null`; indexes
  `(user_id)` and `(group_id, joined_at, id)`.
- `group_invitations`: `id` uuid pk; `group_id` fk cascade; `token_hash` text not null unique;
  `created_by_member_id` uuid not null unique; `expires_at`, `created_at` timestamptz not null; composite
  fk `(created_by_member_id, group_id) → group_members(id, group_id)` on delete cascade; index
  `(group_id)`.
- `group_claim_links`: `id` uuid pk; `group_id` fk cascade; `member_id` uuid not null; `token_hash`
  text not null unique; `used_at` timestamptz null; `created_at`; composite fk `(member_id,
  group_id) → group_members(id, group_id)` on delete cascade; unique `(member_id) where used_at is
  null`.
- `group_categories`: `id` uuid pk; `group_id` fk cascade; `default_key` text null; `name` text
  null; `icon`, `color` text not null (same length checks as `categories`); `archived_at`,
  `created_at`, `updated_at`. Checks: key or name present; name 1 to 50 characters. Unique
  `(group_id, default_key) where default_key is not null`; unique `(group_id, lower(name)) where
  name is not null`; index `(group_id, created_at, id)`.

**Error handling**
- A constraint violation surfaces as a database error that the repository of Block 4 maps.

**Required tests**
- [ ] The migration applies on an empty database and on a copy of `main`'s schema; the rollback
      script is idempotent and removes only the five tables — validates NFR-01 (backstops exist)
- [ ] Introspection: the five tables have 0 `real`, `double precision` or `numeric` columns, the
      checks and unique indexes above exist, `user_id` restricts on delete
- [ ] A second membership of the same user in a group is a duplicate error from the unique index — validates AC-07
- [ ] A ghost with a role of `admin` is rejected by the check — validates AC-16 (backstop)
- [ ] A second unused claim link for the same member is a duplicate error from the unique index — validates AC-11
- [ ] A second invitation row for the same creating member is a duplicate error from the unique index — validates AC-04
- [ ] The journal `when` is greater than 1791590000000

**Completion criterion**
The migration test and the introspection test pass, and `pnpm --filter ./apps/api` typechecks.

## Block 3 — Domain and use cases

**Files**
- `apps/api/src/groups/domain/group.ts`, `member.ts`, `group-category.ts`, `errors.ts` (new) —
  entities, role rule, the 50-member constant, typed errors.
- `apps/api/src/groups/application/ports/group-repository.ts`, `clock.ts`, `token-source.ts` (new).
- `apps/api/src/groups/application/group-access.ts` (new) — the guard of D1.
- `apps/api/src/groups/application/create-group.ts`, `list-groups.ts`, `get-group.ts`,
  `update-group.ts`, `create-invitation.ts`, `join-group.ts`, `add-ghost-member.ts`,
  `create-claim-link.ts`, `claim-ghost-member.ts`, `make-admin.ts`, `list-group-categories.ts`,
  `create-group-category.ts`, `update-group-category.ts` (new).
- `apps/api/src/groups/index.ts` (new) — module barrel.
- `apps/api/test/groups/fakes.ts`, `apps/api/test/groups/use-cases.test.ts` (new).

**Logic**
Each use case calls `GroupAccess.member(userId, groupId)` first (404 for a non-member) and
`GroupAccess.admin(...)` for the admin-only ones (make admin, change rate type, add, rename or
archive categories). `CreateGroup` builds the group, its admin member and the default categories
and hands them to the repository in one call. `CreateInvitation` and `CreateClaimLink` draw a token
from the `TokenSource` port, store only its hash and return the raw value once. `JoinGroup` and
`ClaimGhostMember` take the raw token, hash it and let the repository do the lookup, the validity
check and the write atomically. `AddGhostMember` and `JoinGroup` fail with
`GROUP_MEMBER_LIMIT_REACHED` at 50. `MakeAdmin` rejects a ghost (D2). Category names are checked
with the same fold as personal categories (D8).

**Input validation**
Inputs arrive already validated by the shared schemas; the use cases re-check the invariants that
need state (limit, membership, ghost, name clash).

**Error handling**
- Non-member — `ResourceNotFound` (404); non-admin on an admin action — `GROUP_ADMIN_REQUIRED`.
- Unknown, expired or used token — `TOKEN_INVALID` (D4); already a member — `GROUP_ALREADY_MEMBER`.
- 51st member — `GROUP_MEMBER_LIMIT_REACHED`; promoting a ghost — `GROUP_MEMBER_NOT_REGISTERED`.
- Category name clash — `CATEGORY_NAME_TAKEN`.

**Required tests** *(in-memory fakes)*
- [ ] Creating a group makes the creator its only member and an admin — validates AC-01
- [ ] Creating a group creates the Appendix A top-level expense categories — validates AC-03
- [ ] An invitation expires exactly 7 days after creation, to the second — validates AC-04
- [ ] A member's second invitation replaces the first: the first token now fails with 400 — validates AC-06
- [ ] Accepting a valid invitation adds a member; an expired one fails with 400 and adds none — validates AC-05, AC-06
- [ ] Accepting an invitation as a member adds no second membership — validates AC-07
- [ ] The 51st member through an invitation or a ghost is a 409 conflict — validates AC-08, AC-10
- [ ] Adding a ghost "Pedro" creates a member without a user — validates AC-09
- [ ] A claim link is bound to its ghost, and a new one replaces the previous — validates AC-11
- [ ] Claiming keeps the member id and position; a used link is refused; a current member claiming
      is refused and the ghost stays — validates AC-12, AC-13, AC-14
- [ ] Making a member admin works for an admin and is 403 forbidden for a non-admin and a 409 conflict for a ghost —
      validates AC-15, AC-16
- [ ] Changing the rate type works for an admin and is refused otherwise — validates AC-17, AC-18
- [ ] Adding, renaming and archiving a category works for an admin and is 403 forbidden otherwise;
      a clashing name is a 409 conflict — validates AC-19, AC-20
- [ ] Any use case on a group the caller is not in answers 404 — validates AC-21
- [ ] The group list holds only the caller's groups — validates AC-22

**Completion criterion**
`use-cases.test.ts` passes with 0 imports from infrastructure and the boundary test stays green.

## Block 4 — Drizzle adapters and erasure step

**Files**
- `apps/api/src/groups/infrastructure/db/drizzle-group-repository.ts` (new) — the repository over
  the five tables, with the transactions of D5 to D7.
- `apps/api/src/groups/infrastructure/db/drizzle-group-membership-reader.ts` (new) — `groupIdsOf`
  (D12).
- `apps/api/src/groups/infrastructure/crypto/random-token-source.ts` (new) — `randomBytes(32)`,
  base64url, and `sha256` hex.
- `apps/api/src/groups/infrastructure/db/erase-user-groups.ts` (new) — the step of D10.
- `apps/api/src/groups/infrastructure/clock/system-clock.ts` (new).
- `apps/api/test/groups/group-repository.test.ts`, `membership-reader.test.ts`,
  `erasure-step.test.ts` (new; need `TEST_DATABASE_URL`).

**Logic**
`create` inserts group, admin member and categories in one transaction. `addMember` and `addGhost`
open a transaction, lock the group row, count members and insert. `acceptInvitation` receives the hash
from the use case, selects the invitation by `token_hash` with `expires_at > now`, and inserts the
member in the same transaction. `claim` runs `update group_claim_links set used_at = now where
token_hash = $1 and used_at is null returning member_id`, then sets `user_id` and clears
`display_name` on that member, in one transaction; if the user is already a member it rolls back so
the link stays unused (D7). `createClaimLink` deletes the member's unused link and inserts the new
one in one transaction (D5); `createInvitation` upserts on the creating member (D16). Unique-violation errors map to the typed errors; no `catch` swallows
anything.

**Data model**
Same tables as Block 2; the unique, check and foreign key constraints are unchanged.

**Error handling**
- Unique violation on `(group_id, user_id)` — `GROUP_ALREADY_MEMBER`; on the category name index —
  `CATEGORY_NAME_TAKEN`; anything else is rethrown.

**Required tests**
- [ ] Two concurrent accepts of the 50th seat: exactly one succeeds — validates AC-08 (NFR-01)
- [ ] Two concurrent claims of one link: exactly one succeeds, the other gets `TOKEN_INVALID` —
      validates AC-13 (NFR-02)
- [ ] An unexpired invitation works up to its last second and fails one second after — validates AC-04, AC-06
- [ ] A claim by a user already in the group is a 409 conflict, rolls back and leaves the link unused — validates AC-14
- [ ] After a claim the member keeps its id and `joined_at`, and `display_name` is cleared — validates AC-12
- [ ] The database holds the hash, never the raw token — validates NFR-02
- [ ] The token source returns 43-character values and 1,000 draws are distinct — validates NFR-02
- [ ] `groupIdsOf` returns exactly the groups the user belongs to — validates AC-22
- [ ] Deleting an account that is an admin of a group succeeds, leaves a "Former member" ghost with
      the role `member`, and the group stays readable by the others — validates AC-21 (D10)

**Completion criterion**
The adapter tests pass against PostgreSQL, including the two concurrency tests, run 20 times
without a failure.

## Block 5 — Routes and composition root

**Files**
- `apps/api/src/groups/infrastructure/http/group-routes.ts`, `group-presenter.ts` (new).
- `apps/api/src/server.ts` (modified) — mounts `createGroupRoutes({ db, logger })` and appends
  `eraseUserGroups` to `beforeUserErased`, before `eraseUserMovements`.
- `apps/api/src/groups/index.ts` (modified) — exports the routes factory and the erasure step.
- `apps/api/test/groups/group-routes.test.ts`, `group-flow.test.ts` (new).

**Logic**
Every route runs `requireSession`, `requireVerifiedEmail` and the shared `validate` middleware with
the schemas of Block 1, and answers with the response schemas. Audit lines carry the request id, the
user id and the group id, never a token or a name.

**API contract**
- `POST /groups` — body `createGroupRequestSchema` — 201 `groupResponseSchema`.
- `GET /groups` — 200 list of `groupResponseSchema`, only the caller's groups.
- `GET /groups/:id` — 200 `groupDetailResponseSchema`; 404 for a non-member.
- `PATCH /groups/:id` — body `updateGroupRequestSchema` — 200 `groupResponseSchema`; admin only.
- `POST /groups/:id/invitations` — 201 `invitationResponseSchema`; any member.
- `POST /groups/join` — body `{ token }` — 200 `groupResponseSchema`.
- `POST /groups/:id/ghost-members` — body `addGhostMemberRequestSchema` — 201 member; any member.
- `POST /groups/:id/members/:memberId/claim-links` — 201 `claimLinkResponseSchema`; any member; the
  target must be a ghost, otherwise 404.
- `POST /groups/claim` — body `{ token }` — 200 `groupResponseSchema`.
- `POST /groups/:id/members/:memberId/admin` — 200 member; admin only.
- `GET /groups/:id/categories` — 200 list; any member. `POST /groups/:id/categories` — 201;
  `PATCH /groups/:id/categories/:categoryId` — 200; admin only.
- Error codes: 400 `VALIDATION_FAILED`, `TOKEN_INVALID`; 401; 403 `GROUP_ADMIN_REQUIRED`; 404
  `NOT_FOUND`; 409 `GROUP_ALREADY_MEMBER`, `GROUP_MEMBER_LIMIT_REACHED`,
  `GROUP_MEMBER_NOT_REGISTERED`, `CATEGORY_NAME_TAKEN`.
- Auth: verified session; membership resolved per request (D1).

**Input validation**
Params, query and body through the shared schemas; no route reads `req.body` unvalidated.

**Error handling**
- Typed domain errors reach the existing error middleware; a non-member and a missing group give the
  same 404 body.

**Required tests** *(supertest over PostgreSQL)*
- [ ] Create, list and read a group end to end, the creator listed as admin — validates AC-01, AC-22
- [ ] Invalid create bodies answer 400 — validates AC-02
- [ ] The invitation flow: create, join as a second user, member list shows both; an expired link
      (clock moved 7 days and 1 second) and a repeated join answer 400 and 409 — validates AC-04, AC-05, AC-06, AC-07
- [ ] The 51st join and the 51st ghost answer 409 — validates AC-08, AC-10
- [ ] The ghost and claim flow: add "Pedro", create a link, claim as a second user, the member list
      shows the user in the same position; the link then answers 400; a current member claiming
      answers 409 — validates AC-09, AC-11, AC-12, AC-13, AC-14
- [ ] Admin actions answer 403 for a plain member and 200 for an admin (make admin, rate type,
      categories); making a ghost admin answers 409 — validates AC-15 to AC-20
- [ ] Every group route answers 404 for a user who is not a member, with the same body as for an
      unknown id — validates AC-21
- [ ] No response contains an email or a stored token hash; no log line contains a token —
      validates NFR-02
- [ ] A second API instance sees a group created through the first (no process state) — validates
      the stateless rule of `AGENTS.md`

**Completion criterion**
Route and flow tests pass; `pnpm lint`, `pnpm typecheck` and `pnpm test` are green.

## Final verification
- 22 of 22 acceptance criteria of the PRD have at least one passing test, and every input has a
  sad-path test.
- The two concurrency tests (50th seat, one-use claim) pass 20 times in a row.
- `pnpm lint`, `pnpm typecheck`, `pnpm test:coverage` (80% lines, branches and functions over the
  three packages together) and `pnpm audit --prod --audit-level high` pass.
- The migration `when` is greater than the maximum on `main` at merge time.
- No other module's read scope changed (D12), and no web screen was added (open question 3).

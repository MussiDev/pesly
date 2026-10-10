# Spec DISC-001-05c: Balances and Settlements

| Field | Value |
|-------|-------|
| Ticket | DISC-001-05c |
| PRD | docs/ddw/prd/prd-DISC-001-05c.md |
| Tier | FEATURE |
| Date | 2026-10-10 |
| Spec loops | 0 |
| Loops since last human decision | 0 |

## Summary
The `groups` module gains balances, settlements and the end of membership. A member's balance per
currency is derived from the expenses and settlements already stored: what the member paid, minus
their shares, plus the settlement legs. A pure helper in `packages/shared` turns the balances into a
short list of payments. A settlement is one row with its legs and its creation log entry, written in
one transaction; a settlement may also name one account of the caller, and the account balance reads
the settlement rows (no new movement type). A consolidated settlement clears the payments between
two members in both currencies and records the net cash in the chosen currency at the group's rate or
a manual rate. Leaving and removal are soft (`left_at`) and allowed only at balance 0 in every
currency. Editing, deleting, and reading the activity log are DISC-001-05d; no web screen is part of
this ticket.

## Design decisions
- D1: Balance of a member in a currency = sum of expense amounts they paid, minus their shares, plus
  settlement legs (a leg of `x` from member F to member T adds `x` to F and subtracts `x` from T).
  Positive means the group owes the member. Every expense and every settlement is zero-sum per
  currency, so the sum over all members is 0 after every operation (NFR-02, AC-02). Balances are
  computed from the stored rows with one aggregate query per source, never stored, so they cannot
  drift. Currencies are never mixed (FR-01).
- D2: Simplified payments (FR-02) come from a pure `simplifyDebts(balances)` in `packages/shared`:
  debtors and creditors sorted by amount descending then member id; pairs with equal amounts are
  matched first, then the largest debtor pays the largest creditor until all are 0. It returns at
  most `nonZeroMembers - 1` payments and is deterministic. Exact minimisation is NP-hard, so the
  helper does not claim it (open question 4).
- D3: Settlement model (FR-03, FR-05, FR-06). `group_settlements(id, group_id, from_member_id,
  to_member_id, currency, amount, occurred_at, created_by_member_id, account_id, account_member_id,
  rate, rate_source, rate_type, created_at)` plus `group_settlement_legs(settlement_id, currency,
  amount)`. `amount` is the cash that moves from `from` to `to` in `currency`; `legs` are the debts
  it clears, signed so that a positive leg means from→to. A plain settlement has one leg equal to
  the amount in its currency. A consolidated settlement has two legs (ARS and USD), the rate used,
  its source (`automatic` or `manual`) and, for `automatic`, the rate type.
- D4: Plain settlement input: `{ kind: 'single', fromMemberId, toMemberId, currency, amount,
  occurredAt, accountId? }`. Both members are distinct and active members of the group (400
  `GROUP_SETTLEMENT_MEMBER_INVALID`, AC-07); `amount` is a positive minor-unit string (AC-06);
  paying more than the balance is allowed and reverses the debt; a ghost can be a party, someone
  records it for them (Out of Scope of the PRD).
- D5: The caller's account (FR-04, AC-08, AC-09, AC-10). `accountId` is allowed only when the caller
  is the `from` or the `to` member of the cash; it must be a non-archived account of the caller in
  the cash currency (400 `GROUP_SETTLEMENT_ACCOUNT_INVALID` otherwise, also when it belongs to
  someone else, so it cannot be probed). The row stores `account_id` and `account_member_id`. The
  account balance port (`AccountMovements`, owned by `accounts`, implemented in `movements`) adds the
  amount when the account owner is the `to` member and subtracts it when they are the `from` member;
  `hasMovements` also answers true for an account with settlements. No `movements` row is created, so
  a settlement is neither an expense nor an income and no movement report changes (open question 1).
  `account_id` is `on delete set null` so account erasure (PRD 01f) does not fail.
- D6: Consolidated input: `{ kind: 'consolidated', memberIds: [a, b], currency, occurredAt,
  accountId?, rate?, legs }`. `legs` is `{ ARS, USD }`, signed minor-unit strings relative to a→b,
  exactly what the preview returned. The server recomputes the simplified payments of both
  currencies, takes the ones between a and b as the legs and compares them to the input inside the
  transaction; a difference answers 409 `GROUP_SETTLEMENT_STALE` (balances moved after the preview).
  Both legs must be non-zero, else 400 `GROUP_SETTLEMENT_NOTHING_TO_CONSOLIDATE`.
- D7: Conversion (FR-05, AC-11). With `rate` an integer scaled by 10,000 (ARS per USD), an ARS leg
  converts to USD minor units as `round_half_up(ars * 10,000 / rate)`, and a USD leg to ARS as
  `round_half_up(usd * rate / 10,000)`, through a helper in `packages/shared`. Cash is `leg in the
  chosen currency + converted other leg`, signed from a→b; a negative result swaps `from` and `to`
  and negates the legs, so stored `amount >= 0`. A cash of 0 is allowed only for a consolidated
  settlement (check `amount > 0 or rate_source is not null`). Both balances reach 0 because each
  leg clears its own currency; the rate affects only the cash.
- D8: Rate (FR-06, FR-07, AC-12, AC-13, AC-14). `GET /groups/:id/settlements/consolidation` returns
  the legs, the group's `default_rate_type` and the stored rate for it (`latestSell`), the prefill.
  The `rate` of the create request is optional: absent means the stored rate of the group's current
  default rate type, stored with source `automatic` and that type; present means a manual rate
  greater than 0, stored with source `manual` and no type. A rate of 0 or less is rejected by the
  schema (AC-13). If no stored rate exists and no manual rate is given, the request fails with the
  code `POST /movements` already uses for a missing rate. Existing settlements keep their stored
  rate when the default type changes (AC-14). No external call is made (AGENTS.md).
- D9: Leaving and removal (FR-08, FR-09). `group_members.left_at` (nullable). A left member keeps
  the row, so history (expenses, shares, settlements, log) stays attached (the foreign keys
  restrict deletion). Active means `left_at is null`. `POST /groups/:id/leave` (any member) and
  `DELETE /groups/:id/members/:memberId` (admin, never self) first compute the member's balance in
  both currencies in the same transaction: any value other than 0 answers 409
  `GROUP_MEMBER_HAS_BALANCE` with `details.balances` (AC-16, AC-19). A non-admin removing is 403
  `GROUP_ADMIN_REQUIRED` (AC-17). The last admin cannot leave or be removed while other active
  members remain: 409 `GROUP_LAST_ADMIN`, decided here (parent index decision 2); a sole member may
  leave. Removal also deletes the member's invitation and unused claim link and, when the member is
  in the percentage default split, resets the default split to `equal`.
- D10: Race safety. Removal locks the member row `for update` before reading the balance; the write
  paths of expenses and settlements, inside their own transaction, re-read the involved members
  `for share` with `left_at is null` and fail with the same validation errors as a non-member. A
  concurrent expense and removal therefore serialise, and a member never leaves with a balance.
- D11: A new join of a user who left creates a new member row (a new `joined_at`); the partial
  unique index on `(group_id, user_id)` now applies to active rows only, and the 50 member limit
  counts active members. `GET /groups/:id` returns active `members` and a new `formerMembers` list
  (id, displayName, leftAt) so clients can name historical records. Lists that find a group for a
  user (`listForUser`, `findMember`, `getSummary`, membership reader) ignore left rows, so a user who
  left answers 404 like a non-member.
- D12: "Former member" (FR-10, AC-20). Account erasure already converts the memberships into ghosts
  (05a, `eraseUserGroups`); this ticket proves the balances, settlements and legs stay intact and that
  the erasure also covers left members. The settlement's `account_id` goes to null with the account.
- D13: Claim (FR-11, AC-21). Settlements reference `group_members.id`, so claiming a ghost keeps them
  with the member; `GET /groups/:id/settlements` lists them with the member ids, and the claiming
  user finds theirs through their own member id.
- D14: Activity log (FR-12, AC-22). `group_activity_log.action` check extends to
  (`expense_created`, `settlement_created`); the settlement insert and its log row share a
  transaction with the legs. Reading the log is 05d.
- D15: Access (FR-13, AC-23). Every route calls `GroupAccess.member` first; a non-member, a user who
  left and a missing group answer 404 (the leave route answers 404 to a non-member too).
- D16: Reading. `GET /groups/:id/balances` returns, per currency, each active and former member with a
  non-zero balance plus every active member (balance 0 included) and `payments` from D2.
  `GET /groups/:id/settlements` is newest first (`occurred_at desc, id desc`), keyset-paginated with
  `limit` (default 50, max 100) and an opaque `cursor`. NFR-03 is met by aggregate queries over
  indexed columns and checked by a benchmark with 50 members and 10,000 expenses.
- D17: Migration `0028_group_settlements`: adds `group_members.left_at`, replaces the partial unique
  index of active members, adds the two tables, extends the activity log check. Additive;
  rollback script `0028_group_settlements.down.sql` removes the two tables, the column, restores the
  index and the check (destructive for settlement data only; it refuses to run if a member has
  `left_at`). Its journal `when` must exceed 1791667061357 (0027) and the maximum on `main` at merge.
- D18: No new runtime dependency. The module reaches `accounts` and the rate store only through
  adapter files under `infrastructure/accounts/` and `infrastructure/rates/`; `domain` and
  `application` import nothing from infrastructure. The `movements` adapter reads the new tables
  (precedent: its `credit-cards` adapters).

## Open questions for the owner
1. A settlement with an account does not create a `movements` row: PRD 03 has no movement type that
   moves money and is neither expense nor income, and a transfer needs two accounts of one user. The
   account balance reads the settlement rows, but the settlement does not appear in the movement list
   of the account. Alternative: add a `settlement` movement type to PRD 03 (touches the movement
   rules, list, filters and reports).
2. Leaving and removal are soft (`left_at`), because members with history cannot be deleted; a user
   who leaves and returns gets a new member row.
3. The last admin cannot leave or be removed while others remain (parent index decision 2,
   recommended option). A sole member may leave and the group stays without active members.
4. Simplified payments use a deterministic greedy match with at most `n - 1` payments; exact
   minimisation is NP-hard and not attempted.
5. A consolidated settlement is tied to the pair payments the preview showed; if any balance moves
   before it is saved the request answers 409 and the client previews again.

## Coverage: PRD → blocks
| Requirement | Covered by |
|---|---|
| FR-01 | Block 1, Block 3, Block 4, Block 6 |
| FR-02 | Block 1, Block 3, Block 6 |
| FR-03 | Block 1, Block 2, Block 3, Block 4, Block 6 |
| FR-04 | Block 2, Block 3, Block 4, Block 6 |
| FR-05 | Block 1, Block 3, Block 4, Block 6 |
| FR-06 | Block 1, Block 3, Block 6 |
| FR-07 | Block 3, Block 4, Block 6 |
| FR-08 | Block 3, Block 5, Block 6 |
| FR-09 | Block 3, Block 5, Block 6 |
| FR-10 | Block 5 |
| FR-11 | Block 3, Block 4 |
| FR-12 | Block 2, Block 3, Block 4 |
| FR-13 | Block 3, Block 6 |
| NFR-01 | Block 1 (integer helpers), Block 2 (no float column, introspection) |
| NFR-02 | Block 1 (property test), Block 3 (invariant on every use case), Block 4 (random operations on PostgreSQL) |
| NFR-03 | Block 4 (benchmark with 50 members and 10,000 expenses) |

## Dependencies between blocks
Block 1 first (shared helpers and contract). Then 2 → 3 → 4 → 5 → 6: data model and migration, domain
and use cases with in-memory fakes, settlement and balance adapters, membership adapters and the
queries of 05a that must ignore left members, routes and composition root.

## Block 1 — Shared helpers, contract and error codes

**Files**
- `packages/shared/src/money/simplify-debts.ts` (new) — `simplifyDebts` (D2).
- `packages/shared/src/money/convert-minor-units.ts` (new) — ARS↔USD conversion at a scaled rate (D7).
- `packages/shared/src/groups/settlement.ts` (new) — Zod contract of D4, D6, D8, D16.
- `packages/shared/src/groups/group.ts` (modified) — `formerMembers` in the group detail.
- `packages/shared/src/errors.ts` (modified) — codes `GROUP_SETTLEMENT_MEMBER_INVALID`,
  `GROUP_SETTLEMENT_ACCOUNT_INVALID`, `GROUP_SETTLEMENT_NOTHING_TO_CONSOLIDATE` (400),
  `GROUP_MEMBER_HAS_BALANCE`, `GROUP_LAST_ADMIN`, `GROUP_SETTLEMENT_STALE` (409).
- `packages/shared/src/index.ts` (modified) — exports.
- `apps/api/src/shared/http/error-handler.ts` (modified) — status of the six codes.
- `apps/web/src/lib/api-client.ts`, `apps/web/messages/en.json`, `apps/web/messages/es.json`
  (modified) — one message key per new code.
- `packages/shared/test/simplify-debts.test.ts`, `packages/shared/test/convert-minor-units.test.ts`,
  `packages/shared/test/group-settlement-schemas.test.ts` (new).

**Logic**
Pure functions with no I/O. `simplifyDebts(balances: Map<memberId, bigint>)` returns payments
`{ from, to, amount }`; it asserts the input sums to 0 and the output clears every balance.

**Shared types**
- `createSettlementRequestSchema` — discriminated union on `kind` (`single`, `consolidated`), strict.
- `consolidationQuerySchema` `{ memberA, memberB, currency }`, `consolidationPreviewSchema`
  `{ legs, defaultRateType, rate | null }`, `balancesResponseSchema`, `settlementResponseSchema`,
  `settlementPageSchema`, `listSettlementsQuerySchema` `{ limit?, cursor? }`.

**Input validation**
Strict objects; amounts positive minor-unit strings within `MINOR_UNITS_MAX`; legs non-zero signed
strings; `rate` a positive integer string scaled by 10,000; `memberIds` two distinct uuids.

**Error handling**
- Shape errors — 400 `VALIDATION_FAILED` through the shared middleware.
- State errors (members, balances, stale legs) are raised by Block 3, not by the contract.

**Required tests**
- [ ] A owes B 100.00 and B owes C 100.00 give one payment of 100.00 from A to C — validates AC-03
- [ ] All balances 0 give no payments — validates AC-04
- [ ] Property test: 10,000 seeded random zero-sum balance sets; the payments clear every balance and
      number at most the non-zero members minus 1 — validates NFR-02
- [ ] 50,000.00 ARS at 1,000.0000 converts to 50.00 USD and the inverse holds; rounding is half up —
      validates AC-11
- [ ] A settlement amount of 0 or less, an extra key or the same member on both sides is rejected as
      invalid — validates AC-06
- [ ] A manual rate of 0 or less is rejected as invalid, a positive rate is accepted — validates AC-12, AC-13
- [ ] The six error codes map to their status and have message keys in both catalogs — validates AC-16, AC-19

**Completion criterion**
The shared tests pass, including the property test, and `pnpm typecheck` accepts the new message keys
on the web side.

## Block 2 — Data model and migration

**Files**
- `apps/api/src/groups/infrastructure/db/schema.ts` (modified) — `groupSettlements`,
  `groupSettlementLegs`, `group_members.left_at`, the active-member index, the log action check.
- `apps/api/src/groups/infrastructure/db/foreign-relations.ts` (modified) — re-exports `accounts`.
- `apps/api/drizzle/0028_group_settlements.sql` (generated), `apps/api/drizzle/meta/*` (generated),
  `apps/api/drizzle/rollback/0028_group_settlements.down.sql` (new).
- `apps/api/test/groups/settlements-migration.test.ts`,
  `apps/api/test/groups/settlements-schema-introspection.test.ts` (new); the erasure registries and
  older migration tests updated if the suite needs them.

**Logic**
Generated with drizzle-kit, then the journal `when` checked against `main`; the unique index swap is
written by hand in the SQL if drizzle-kit cannot express it.

**Data model**
- `group_members.left_at` timestamptz null; the unique index `(group_id, user_id)` where `user_id is
  not null and left_at is null`; index `(group_id) where left_at is null`.
- `group_settlements`: `id` uuid pk; `group_id` fk `groups` cascade; `from_member_id`,
  `to_member_id`, `created_by_member_id` uuid not null, each with composite fk `(…, group_id) →
  group_members(id, group_id)` restrict; `account_member_id` uuid null with the same composite fk;
  `currency` text check in (`ARS`, `USD`); `amount` bigint not null check `>= 0`; `occurred_at`
  timestamptz; `account_id` uuid null fk `accounts` on delete set null; `rate` bigint null check
  `> 0`; `rate_source` text null check in (`automatic`, `manual`); `rate_type` text null; checks:
  `from_member_id <> to_member_id`, `amount > 0 or rate_source is not null`, rate fields all null or
  `rate` and `rate_source` both set, `rate_type` set only when `rate_source = 'automatic'`,
  `account_id` null iff `account_member_id` null is not required (set null on erasure) but
  `account_member_id` is one of the two parties; `created_at`. Unique `(id, group_id)`; indexes
  `(group_id, occurred_at desc, id desc)`, `(account_id)`.
- `group_settlement_legs`: `settlement_id` uuid, `group_id` uuid, `currency` text check in (`ARS`,
  `USD`), `amount` bigint not null check `<> 0`; pk `(settlement_id, currency)`; composite fk
  `(settlement_id, group_id) → group_settlements(id, group_id)` cascade; index `(group_id,
  currency)`.
- `group_activity_log.action` check in (`expense_created`, `settlement_created`).

**Error handling**
- A constraint violation surfaces as a database error that the repository of Block 4 maps.

**Required tests**
- [ ] The migration applies on an empty database and on a copy of `main`'s schema; the rollback is
      idempotent and removes only what it added — validates NFR-01 (backstops exist)
- [ ] Introspection: 0 `real`, `double precision` or `numeric` columns in the new tables; amounts
      and rate are `bigint`; the checks and indexes above exist — validates NFR-01
- [ ] A settlement with amount 0 and no rate, or with the same member on both sides, is rejected by
      the checks — validates AC-06 (backstop)
- [ ] A settlement whose member is of another group is rejected by the composite foreign key —
      validates AC-07 (backstop)
- [ ] Deleting an account referenced by `account_id` sets the column to null and keeps the
      settlement — validates AC-08 (erasure safety)
- [ ] A user who left can be a member of the same group again with a new row — validates AC-18
- [ ] A constraint violation (a duplicate leg row or a foreign key to a missing member) is rejected by
      the database as an error the repository maps
- [ ] The journal `when` is greater than 1791667061357

**Completion criterion**
The migration and introspection tests pass and `pnpm --filter ./apps/api typecheck` is clean.

## Block 3 — Domain and use cases

**Files**
- `apps/api/src/groups/domain/settlement.ts` (new) — types, balance arithmetic, consolidation rule
  (D6, D7), typed errors in `domain/errors.ts` (modified).
- `apps/api/src/groups/application/ports/group-settlement-repository.ts`,
  `settlement-account-checker.ts`, `rate-reader.ts` (new) — ports; the repository saves a settlement,
  its legs and the log row in one call and reads the balances.
- `apps/api/src/groups/application/ports/group-repository.ts` (modified) — `removeMember`.
- `apps/api/src/groups/application/get-balances.ts`, `record-settlement.ts`,
  `preview-consolidation.ts`, `list-settlements.ts`, `remove-member.ts`, `leave-group.ts` (new).
- `apps/api/src/groups/index.ts` (modified) — barrel.
- `apps/api/test/groups/settlement-fakes.ts`, `apps/api/test/groups/settlement-use-cases.test.ts`
  (new).

**Logic**
`RecordSettlement` calls `GroupAccess.member`, checks the parties are distinct active members (D4),
the account rules (D5), and for the consolidated kind builds the legs from the current simplified
payments, compares them to the input (D6), resolves the rate (D8), converts (D7) and hands one
write to the repository. `PreviewConsolidation` returns the legs and the prefill. `GetBalances`
builds the member balances and the payments (D1, D2, D16). `RemoveMember` and `LeaveGroup` apply D9
through `removeMember`, which takes the lock and checks the balance inside its transaction (D10).

**Input validation**
Inputs arrive validated by the shared contract; the use cases re-check what needs state: membership
and activity of the parties, account ownership and currency, stale legs, last admin, balance.

**Error handling**
- Non-member or user who left — `ResourceNotFound` (404); non-admin removal — `GROUP_ADMIN_REQUIRED`.
- Party not an active member of the group — `GROUP_SETTLEMENT_MEMBER_INVALID`.
- Account of another currency, of another user, archived, or sent for a caller who is not a party —
  `GROUP_SETTLEMENT_ACCOUNT_INVALID`.
- Legs different from the current ones — `GROUP_SETTLEMENT_STALE`; a missing leg —
  `GROUP_SETTLEMENT_NOTHING_TO_CONSOLIDATE`.
- Non-zero balance on leaving or removal — `GROUP_MEMBER_HAS_BALANCE` with the balances; last admin —
  `GROUP_LAST_ADMIN`.

**Required tests** *(in-memory fakes)*
- [ ] After expenses in ARS and USD, the balances of each member are shown per currency — validates AC-01
- [ ] Recording an ARS expense changes the ARS balances only and the sum stays 0 — validates AC-02
- [ ] A settlement of 30,000.00 ARS from A to B reduces what A owes B by 30,000.00 — validates AC-05
- [ ] A settlement of 0 or less is rejected as invalid — validates AC-06
- [ ] A party who is not an active member is rejected with `GROUP_SETTLEMENT_MEMBER_INVALID` — validates AC-07
- [ ] A received settlement with an account is recorded with that account and is not an income —
      validates AC-08
- [ ] A paid settlement with an account is recorded with that account and is not an expense — validates AC-09
- [ ] An account of another currency, of another user, or sent when the caller is not a party is
      rejected with `GROUP_SETTLEMENT_ACCOUNT_INVALID` — validates AC-10
- [ ] A owes B 100.00 USD and B owes A 50,000.00 ARS settled in USD at 1,000.0000 records one
      settlement of 50.00 USD from A to B and leaves both balances at 0 — validates AC-11
- [ ] A manual rate greater than 0 is used and stored with source `manual` — validates AC-12
- [ ] A rate of 0 or less is rejected as invalid — validates AC-13
- [ ] After the group's default rate type changes, the preview offers the new type's rate and the
      stored settlements keep theirs — validates AC-14
- [ ] An admin removes a member whose balance is 0 in ARS and USD — validates AC-15
- [ ] An admin removing a member with a balance other than 0 is rejected and shows the balance —
      validates AC-16
- [ ] A member who is not an admin removing another member is rejected with 403 — validates AC-17
- [ ] A member with balance 0 in every currency leaves the group — validates AC-18
- [ ] A member with a balance other than 0 leaving is rejected and shows the balance — validates AC-19
- [ ] The last admin leaving or being removed while others remain is rejected with `GROUP_LAST_ADMIN`
- [ ] After a ghost with 2 settlements is claimed, the user's settlements list shows both — validates AC-21
- [ ] Recording a settlement adds one log entry with the action, the member and the clock instant —
      validates AC-22
- [ ] A non-member, or a user who left, reading balances or recording a settlement gets 404 —
      validates AC-23
- [ ] Stale legs are rejected with `GROUP_SETTLEMENT_STALE` and a missing leg with
      `GROUP_SETTLEMENT_NOTHING_TO_CONSOLIDATE`
- [ ] If the repository write fails, no settlement, leg or log row remains — validates AC-05 (atomicity)
- [ ] 10,000 random operations (expenses, settlements, consolidations, removals) leave the sum of
      balances at 0 in each currency — validates NFR-02

**Completion criterion**
The use-case tests pass with the fakes and the architecture-boundaries test still passes.

## Block 4 — Settlement and balance adapters

**Files**
- `apps/api/src/groups/infrastructure/db/drizzle-group-settlement-repository.ts` (new) — the
  repository of Block 3, the balance aggregates and the keyset pagination.
- `apps/api/src/groups/infrastructure/accounts/drizzle-settlement-account-checker.ts` (new) — reads
  the caller's account through the existing account lookup.
- `apps/api/src/groups/infrastructure/rates/drizzle-rate-reader.ts` (new) — reads the stored rate
  (`latestSell`), no provider call.
- `apps/api/src/groups/infrastructure/db/drizzle-group-expense-repository.ts` (modified) — the
  expense write re-reads its members `for share` with `left_at is null` (D10).
- `apps/api/src/movements/infrastructure/accounts/drizzle-account-movements.ts` (modified) — adds
  the settlements to `sumsByAccount` and `hasMovements` (D5).
- `apps/api/src/groups/infrastructure/index.ts` (modified) — exports.
- `apps/api/test/groups/drizzle-group-settlement-repository.test.ts`,
  `apps/api/test/groups/settlement-account-balance.test.ts`,
  `apps/api/test/groups/balances-random-operations.test.ts`,
  `apps/api/test/perf/group-balances.perf.test.ts` (new).

**Logic**
One transaction: lock and recheck the involved members `for share`, insert the settlement, its legs
and the log row. Balances: one aggregate of paid amounts by payer, one of shares by member and one
of legs by `from`/`to`, per currency. Every query filters by group id.

**Error handling**
- A unique, check or foreign-key violation — mapped to the typed errors of Block 3.
- A failure inside the transaction — rolls back the settlement, legs and log row; any other database
  failure is rethrown with no silent `catch`.

**Required tests**
- [ ] The settlement, its legs and the log row are persisted together and read back — validates AC-05, AC-22
- [ ] An account that received a settlement rises by the amount and one that paid drops by it, with no
      row in `movements` and no change to the income and expense totals — validates AC-08, AC-09
- [ ] An account with settlements cannot be deleted by the owner — validates AC-09
- [ ] A forced failure after the leg insert leaves nothing behind — validates AC-05 (atomicity)
- [ ] The balances of the group by currency are derived from expenses, shares and legs — validates AC-01, AC-02
- [ ] After `claimGhost` the settlements of the ghost are listed for the claiming user — validates AC-21
- [ ] Pagination returns each settlement once across pages, newest first — validates AC-05
- [ ] A settlement or balance of another group is not returned — validates AC-23
- [ ] A violation of a unique, check or foreign-key constraint is rejected and mapped to the typed
      error — validates AC-06, AC-07
- [ ] A failure inside the transaction is an error that rolls back the settlement, legs and log row,
      and any other database failure is rethrown — validates AC-05
- [ ] 10,000 random operations on PostgreSQL leave the sum of balances at 0 in each currency —
      validates NFR-02
- [ ] Concurrent creation of 20 settlements in one group keeps the sum of balances at 0 — validates NFR-02
- [ ] A group with 50 members and 10,000 expenses answers the balances query in under 500 ms at p95
      over 20 runs — validates NFR-03

**Completion criterion**
The adapter tests pass against PostgreSQL (`127.0.0.1:5435`) and the accounts, movements and
erasure suites stay green.

## Block 5 — Membership adapters

**Files**
- `apps/api/src/groups/infrastructure/db/drizzle-group-repository.ts` (modified) — `removeMember`
  (D9, D10) and `left_at is null` in every query that finds, counts or lists members or groups
  (D11); `GroupDetail` carries `formerMembers`.
- `apps/api/src/groups/infrastructure/db/drizzle-group-membership-reader.ts` (modified) — ignores
  left rows.
- `apps/api/src/groups/infrastructure/db/erase-user-groups.ts` (modified only if the left members
  need a rule).
- `apps/api/test/groups/drizzle-member-removal.test.ts`, `apps/api/test/groups/former-member-erasure.test.ts`
  (new); the 05a repository tests updated for the new member list shape.

**Logic**
`removeMember` runs in one transaction: lock the member `for update`, compute the balances through
the same aggregates as Block 4, check the last-admin rule, set `left_at`, delete the member's
invitation and unused claim link and reset a percentage default split that contained the member.

**Error handling**
- Balance other than 0 — `GROUP_MEMBER_HAS_BALANCE` with the balances; last admin —
  `GROUP_LAST_ADMIN`; a member not in the group — `ResourceNotFound`.
- A database failure inside the transaction is an error that rolls back every change.

**Required tests**
- [ ] Removing a member with balance 0 sets `left_at`, keeps their expenses and shares, and drops
      their invitation and claim link — validates AC-15
- [ ] Removing a member with a balance answers 409 `GROUP_MEMBER_HAS_BALANCE` and nothing changes — validates AC-16
- [ ] A member who left is not found by `findMember`, `listForUser` or the membership reader, and is
      listed in `formerMembers` — validates AC-18, AC-23
- [ ] A removal and an expense recorded at the same time serialise: either the removal is rejected
      with the balance or the expense is rejected for an inactive member — validates AC-16
- [ ] A user who left rejoins through an invitation and gets a new member row; the 50 member limit
      counts active members only — validates AC-18
- [ ] A percentage default split containing the removed member is reset to `equal` — validates AC-15
- [ ] Deleting the account of a member with expenses, shares and settlements keeps all of them under
      a ghost named "Former member" with the same balances — validates AC-20
- [ ] Removing the last admin while others remain answers 409 `GROUP_LAST_ADMIN` and nothing
      changes; removing a member who is not in the group is rejected with `ResourceNotFound` —
      validates AC-15
- [ ] A database failure inside the transaction is an error that rolls back every change and leaves
      the member active — validates AC-15

**Completion criterion**
The adapter tests pass against PostgreSQL, the 05a and 05b suites stay green and the erasure suites
stay green.

## Block 6 — Routes and composition root

**Files**
- `apps/api/src/groups/infrastructure/http/group-routes.ts` (modified) — the routes below.
- `apps/api/src/groups/infrastructure/http/group-settlement-presenter.ts` (new).
- `apps/api/src/groups/infrastructure/http/group-presenter.ts` (modified) — `formerMembers`.
- `apps/api/src/server.ts` (modified only if the factory needs new dependencies).
- `apps/api/test/groups/group-settlement-routes.test.ts`, `apps/api/test/groups/settlement-audit.test.ts`
  (new).

**Logic**
Routes sit behind the `/groups` session and verified-email guards of 05a. The consolidation preview
route is registered before `/:id/settlements/:settlementId` style patterns.

**API contract**
- `GET /groups/:id/balances` — 200 `balancesResponseSchema`.
- `POST /groups/:id/settlements` — body `createSettlementRequestSchema`; 201 `settlementResponseSchema`.
- `GET /groups/:id/settlements` — query `listSettlementsQuerySchema`; 200 `settlementPageSchema`.
- `GET /groups/:id/settlements/consolidation` — query `consolidationQuerySchema`; 200
  `consolidationPreviewSchema`.
- `DELETE /groups/:id/members/:memberId` — admin; 204.
- `POST /groups/:id/leave` — 204.
- Error codes: `VALIDATION_FAILED` 400, `GROUP_SETTLEMENT_MEMBER_INVALID`,
  `GROUP_SETTLEMENT_ACCOUNT_INVALID`, `GROUP_SETTLEMENT_NOTHING_TO_CONSOLIDATE` 400,
  `GROUP_MEMBER_HAS_BALANCE`, `GROUP_LAST_ADMIN`, `GROUP_SETTLEMENT_STALE` 409,
  `GROUP_ADMIN_REQUIRED` 403, not found 404.
- Auth: session cookie and verified email; membership checked per group (D15).

**Error handling**
- Errors reach the single error middleware; non-members, users who left and missing groups answer 404.
- The audit lines for a created settlement and for a removal carry the request id, the user id, the
  group id and the settlement or member id, never amounts.

**Required tests**
- [ ] `GET balances` shows each member in ARS and USD and the payments per currency — validates AC-01, AC-03, AC-04
- [ ] `POST` single settlement answers 201 and the balances move by the amount — validates AC-05
- [ ] `POST` with amount 0, an unknown extra key or a bad body answers 400 — validates AC-06, AC-13
- [ ] `POST` with a non-member party answers 400 `GROUP_SETTLEMENT_MEMBER_INVALID` — validates AC-07
- [ ] `POST` into an ARS account raises it and `POST` from one lowers it, with no change to the income
      and expense totals; a USD account for an ARS settlement answers 400 — validates AC-08, AC-09, AC-10
- [ ] A consolidated settlement in USD at 1,000.0000 records 50.00 USD and both balances reach 0;
      a manual rate is stored as `manual`; a stale `legs` answers 409 — validates AC-11, AC-12
- [ ] The preview prefills the rate of the current default rate type — validates AC-14
- [ ] `DELETE member` as admin removes a member at 0, answers 409 with the balance otherwise, and
      403 to a member — validates AC-15, AC-16, AC-17
- [ ] `POST leave` removes a member at 0 and answers 409 with the balance otherwise — validates AC-18, AC-19
- [ ] A claimed ghost's settlements appear in the list for the claimer — validates AC-21
- [ ] A created settlement adds a log row; the audit line has no amount — validates AC-22
- [ ] A non-member gets 404 on every route and a user who left also gets 404 — validates AC-23
- [ ] The maximum amount passes and one more unit answers 400 — validates NFR-01

**Completion criterion**
The route tests pass, the full API suite is green, and `pnpm lint`, `pnpm typecheck` and both builds
pass.

## Final verification
All 23 acceptance criteria have a test; no money column is a float; the full suite and the coverage
floor (80% lines, branches and functions) hold; the sum of balances is 0 after every operation; the
account balance moves with a settlement while the movement totals do not; a member never leaves with
a balance; the 05a and 05b gotchas (erasure registries, `127.0.0.1` database, fresh `_test`
database, migration `when`) were applied.

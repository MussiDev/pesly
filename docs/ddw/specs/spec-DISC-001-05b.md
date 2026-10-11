# Spec DISC-001-05b: Group Expenses and Splits

| Field | Value |
|-------|-------|
| Ticket | DISC-001-05b |
| PRD | docs/ddw/prd/prd-DISC-001-05b.md |
| Tier | FEATURE |
| Date | 2026-10-10 |
| Spec loops | 0 |
| Loops since last human decision | 0 |

## Summary
The `groups` module gains group expenses. A member records an expense with one payer, a currency, a
group category and a split (equal, percentages or exact amounts). A pure allocation helper in
`packages/shared` turns the split into integer shares that always add up to the amount, giving the
leftover minor units one by one to the payer first and then to members in joining order. Expenses,
shares and the creation log entry are written in one transaction. When the caller is the payer, the
same transaction also records the full amount as an expense movement on the chosen account of the
caller (PRD 03). Each member's personal view (their shares and receivables) is exposed through one
API route for PRD 06 and PRD 09. Balances, settlements, editing, deleting and reading the log are
DISC-001-05c and 05d. The group UI is built here only as far as the contract allows: no web screen is
part of this ticket (see open question 3).

## Design decisions
- D1: Shares reference `group_members.id`, never `users.id`. Claiming a ghost (05a) keeps the member
  id, so every expense and share of the ghost follows the claiming user with no rewrite (FR-11,
  AC-21). The test is a use-case and database test over the existing claim flow.
- D2: Money is `bigint` in minor units end to end. Percentages are stored as integer basis points
  (10,000 = 100%, so 60% is 6000 and 33.33% is 3333), which keeps the "adds up to exactly 100%" rule
  integer-only (FR-04, NFR-01). No `real`, `double precision` or `numeric` column is created.
- D3: Allocation lives in `packages/shared/src/money/split-expense.ts`, as pure functions
  `splitEqual`, `splitByBasisPoints` and `validateExactSplit`, over an ordered list of member ids
  that the caller builds as "payer first (if in the split), then the rest by `joined_at, id`"
  (FR-06). Equal: each gets `floor(total / n)`; the `total mod n` leftover units go one each to the
  first members of the ordered list. Percentages: each gets `floor(total * bp / 10000)`; the
  leftover goes one unit each in the same order. Exact: amounts are taken as given and must sum to
  the total. `sum(shares) = total` is asserted inside the helper before it returns.
- D4: Split input. `split` is `{ mode: 'equal', memberIds }`, `{ mode: 'percentage', shares:
  [{ memberId, basisPoints }] }` or `{ mode: 'exact', shares: [{ memberId, amount }] }`; members are
  unique and each belongs to the group (including ghosts). A percentage total different from 10,000
  answers 400 `GROUP_SPLIT_PERCENTAGE_INVALID` with `details.total`; an exact total different from
  the amount answers 400 `GROUP_SPLIT_AMOUNT_MISMATCH` with `details.difference` (a signed bigint
  string: expense amount minus the sum, AC-09, AC-11). A member outside the group answers 400
  `GROUP_SPLIT_MEMBER_INVALID` (AC-03). Zero-amount shares are allowed in exact and percentage
  modes; at least one share must exist.
- D5: The payer. `payerMemberId` is any member of the group (FR-01). When the payer is the caller
  (the caller's own member), the body must carry `payerAccount: { accountId, categoryId }`: the
  account is one of the caller's accounts in the expense currency (400 `GROUP_PAYER_ACCOUNT_INVALID`
  otherwise, AC-15) and the category is one of the caller's personal expense categories (the
  movement needs one; the PRD names none, so the contract asks for it explicitly and the owner can
  ratify it, open question 1). When the payer is another member or a ghost, `payerAccount` must be
  absent, and no movement is recorded (AC-16; AC-18 for the other registered members).
- D6: Payer movement. For a registered caller who pays, the use case records one `expense` movement
  of the full amount on `payerAccount.accountId` through a groups-side adapter modelled on
  `credit-cards`' `ExpenseRecorder` (`infrastructure/movements/drizzle-payer-movement-recorder.ts`),
  with the rate the existing rate lookup returns for the group's `default_rate_type` and the note
  equal to the description. The balance is derived from movements, so inserting the row lowers the
  account (AC-14). The movement id is stored in `group_expenses.payer_movement_id` (nullable,
  `on delete set null`, so account erasure (PRD 01f) does not fail). The expense and the movement are
  written in one database transaction: the adapter builds the movement repository with the open
  transaction. If that proves impossible in Block 4 the implementer stops and reports (blocker),
  because compensation would break atomicity (AC-14, AC-01).
- D7: Personal view (FR-08, FR-09, pending decision 1 of the parent index). No `movements` row is
  created for a share: shares stay in `group_expense_shares`. `GET /groups/personal/shares` returns
  the caller's shares and receivables, newest first, keyset-paginated, optionally filtered by
  `from` and `to` (UTC instants). For each expense in which the caller has a share or is the payer:
  `shareAmount` (0 if not in the split) and, only for the payer, `receivableAmount = amount -
  shareAmount`. Amounts are never converted between currencies. A payer's account movement
  (D6) is the full amount; reports of PRD 06 and PRD 09 must count `shareAmount` and exclude the
  movements referenced by `payer_movement_id` (written in the parent index, not built here).
- D8: Default split (FR-02). `groups.default_split_mode` (`equal` default, or `percentage`) plus
  `group_default_split_shares(group_id, member_id, basis_points)`. `PUT /groups/:id/default-split`
  is admin-only, replaces the whole split and validates like D4; `equal` stores no rows and means
  "all current members". The option route (D9) returns it so the client prefills (AC-05, AC-06).
- D9: `GET /groups/:id/expense-options` returns the data a new expense needs in one call: members
  (id, displayName, isGhost, joinedAt), non-archived group categories (FR-10, AC-19, AC-20), the
  default split and the group's default rate type. Archived categories are rejected on create with
  400 `GROUP_EXPENSE_CATEGORY_INVALID` (AC-04); a category of another group is the same error.
- D10: Activity log (FR-12). Table `group_activity_log(id, group_id, member_id, action, subject_id,
  created_at)`, with `action` check in (`expense_created`) for now; 05d adds more actions and
  before/after columns by its own migration. The row is inserted in the expense's transaction, so no
  expense exists without its entry (AC-22). `created_at` comes from the injected `Clock`.
- D11: Access (FR-13). Every route first calls `GroupAccess.member(userId, groupId)`; a non-member
  or a missing group answers 404, never 403 (AC-23). The default-split write calls
  `GroupAccess.admin` (403 `GROUP_ADMIN_REQUIRED`). `DrizzleGroupMembershipReader` stays unwired:
  group expenses are read only through `GroupAccess`, and no other module's read scope changes
  (this closes the 05a note for 05b).
- D12: Reading. `GET /groups/:id/expenses` lists the group's expenses newest first (`occurred_at
  desc, id desc`), keyset-paginated with `limit` (default 50, max 100) and an opaque `cursor`;
  `GET /groups/:id/expenses/:expenseId` returns one, with its shares. A missing expense and an
  expense of another group are the same 404. Editing and deleting are 05d.
- D13: Limits. `description` is 1 to 200 characters (NFC, trimmed, no control characters); `amount`
  is a positive string of minor units within `MINOR_UNITS_MAX`; `occurredAt` is an ISO instant, and
  a date more than 1 day in the future is rejected. The member limit of 50 bounds a split.
- D14: Migration `0027_group_expenses`: new tables `group_expenses`, `group_expense_shares`,
  `group_default_split_shares`, `group_activity_log`; adds `groups.default_split_mode`. Additive;
  rollback script `0027_group_expenses.down.sql` drops the four tables and the column (destructive for
  group expense data only). Its journal `when` must exceed 1791661150964 (0026) and the maximum on
  `main` at merge.
- D15: No new runtime dependency. The module imports `accounts` and `categories` data only through
  its own adapter files under `infrastructure/movements/` and `infrastructure/accounts/`
  (precedent: `credit-cards`); `domain` and `application` import nothing from infrastructure.

## Open questions for the owner
1. The payer's account movement needs a personal expense category (D5), so the contract asks the
   payer to choose one. Alternative: a default "Other" category chosen by the system.
2. The shares are not turned into `movements` rows (D7); PRD 06 and PRD 09 read them through the
   personal view. Alternative: also write a movement for each registered member's share, which
   changes account-less semantics of PRD 03.
3. No web screen in this ticket, even though the parent index suggested the group UI ships with 05b
   (pending decision 4). The API and contract are complete; the screens are a separate ticket sized
   on their own.

## Coverage: PRD → blocks
| Requirement | Covered by |
|---|---|
| FR-01 | Block 1, Block 2, Block 3, Block 4, Block 5 |
| FR-02 | Block 2, Block 3, Block 4, Block 5 |
| FR-03 | Block 1, Block 3 |
| FR-04 | Block 1, Block 3 |
| FR-05 | Block 1, Block 3 |
| FR-06 | Block 1, Block 3 |
| FR-07 | Block 3, Block 4, Block 5 |
| FR-08 | Block 3, Block 4, Block 5 |
| FR-09 | Block 3, Block 4, Block 5 |
| FR-10 | Block 3, Block 4, Block 5 |
| FR-11 | Block 3, Block 4 |
| FR-12 | Block 2, Block 3, Block 4 |
| FR-13 | Block 3, Block 5 |
| NFR-01 | Block 1 (integer helpers), Block 2 (no float column, introspection) |
| NFR-02 | Block 1 (property test, 10,000 splits per mode), Block 3 (invariant on create) |

## Dependencies between blocks
Block 1 first (shared allocation and contract). Then 2 → 3 → 4 → 5: schema and migration, domain and
use cases with in-memory fakes, Drizzle and movement adapters, routes and composition root.

## Block 1 — Shared allocation, contract and error codes

**Files**
- `packages/shared/src/money/split-expense.ts` (new) — `splitEqual`, `splitByBasisPoints`,
  `validateExactSplit` (D3).
- `packages/shared/src/groups/expense.ts` (new) — Zod schemas of D4, D5, D8, D9, D12.
- `packages/shared/src/errors.ts` (modified) — codes `GROUP_SPLIT_PERCENTAGE_INVALID`,
  `GROUP_SPLIT_AMOUNT_MISMATCH`, `GROUP_SPLIT_MEMBER_INVALID`, `GROUP_EXPENSE_CATEGORY_INVALID`,
  `GROUP_PAYER_ACCOUNT_INVALID`.
- `packages/shared/src/index.ts` (modified) — exports.
- `apps/api/src/shared/http/error-handler.ts` (modified) — the five codes map to 400.
- `apps/web/src/lib/api-client.ts`, `apps/web/messages/en.json`, `apps/web/messages/es.json`
  (modified) — message keys `groupSplitPercentageInvalid`, `groupSplitAmountMismatch`,
  `groupSplitMemberInvalid`, `groupExpenseCategoryInvalid`, `groupPayerAccountInvalid`.
- `packages/shared/test/split-expense.test.ts`, `packages/shared/test/group-expense-schemas.test.ts`
  (new).

**Logic**
Pure functions with no I/O. `splitEqual(total, orderedMemberIds)` and `splitByBasisPoints(total,
orderedShares)` return `Map<memberId, bigint>`; the ordered list already puts the payer first (D3).
`validateExactSplit(total, shares)` returns the shares or throws a typed error with the difference.

**Shared types**
- `splitSchema` (discriminated union on `mode`), `createGroupExpenseRequestSchema` `{ amount,
  currency, occurredAt, payerMemberId, categoryId, description, split, payerAccount? }`, strict.
- `defaultSplitRequestSchema` (same union without `exact`), `listGroupExpensesQuerySchema` `{ limit?,
  cursor? }`, `personalSharesQuerySchema` `{ from?, to?, limit?, cursor? }`.
- Responses: `groupExpenseResponseSchema` (with `shares`), `groupExpensePageSchema`,
  `expenseOptionsResponseSchema`, `personalSharesPageSchema` `{ items: [{ expenseId, groupId,
  currency, occurredAt, shareAmount, receivableAmount | null }], nextCursor }`.

**Input validation**
Strict objects, amounts as positive minor-unit strings, basis points integers 0 to 10,000, at least
one share, unique member ids, description 1 to 200 characters.

**Error handling**
- Shape errors — 400 `VALIDATION_FAILED` through the shared middleware.
- Total or membership mismatches are reported by Block 3, not by the schema.

**Required tests**
- [ ] 40,000.00 ARS equal among 4 gives 10,000.00 each — validates AC-07
- [ ] 100,000.00 ARS at 60% / 40% gives 60,000.00 and 40,000.00 — validates AC-08
- [ ] 100.00 ARS equal among 3 with the payer first gives 33.34 / 33.33 / 33.33 — validates AC-12
- [ ] With the payer outside the split, the leftover unit goes to the first member in order — validates AC-13
- [ ] An exact split that adds up is returned as given — validates AC-10
- [ ] An exact split that does not add up is rejected with the signed difference — validates AC-11
- [ ] A percentage split totalling 9,999 basis points is rejected with the total — validates AC-09
- [ ] Property test: 10,000 seeded random splits in each of the 3 modes, `sum(shares) = total` and no share negative — validates NFR-02
- [ ] A zero or negative amount, an extra key or a duplicated member is rejected as invalid — validates AC-02
- [ ] The five error codes map to 400 and have message keys in both catalogs — validates AC-09, AC-11

**Completion criterion**
The shared tests pass, including the 30,000-split property test, and `pnpm typecheck` accepts the new
message keys on the web side.

## Block 2 — Schema and migration

**Files**
- `apps/api/src/groups/infrastructure/db/schema.ts` (modified) — `groupExpenses`,
  `groupExpenseShares`, `groupDefaultSplitShares`, `groupActivityLog`; column
  `groups.default_split_mode`.
- `apps/api/src/groups/infrastructure/db/foreign-relations.ts` (modified) — re-exports `movements`
  for the foreign key of `payer_movement_id`.
- `apps/api/drizzle/0027_group_expenses.sql` (generated), `apps/api/drizzle/meta/*` (generated),
  `apps/api/drizzle/rollback/0027_group_expenses.down.sql` (new).
- `apps/api/test/groups/expenses-migration.test.ts`,
  `apps/api/test/groups/expenses-schema-introspection.test.ts` (new); the erasure registries
  (`test/identity/user-erasure.test.ts`, `test/deploy/build-output.test.ts`) updated if the suite
  needs them.

**Logic**
Generated with drizzle-kit, then the journal `when` checked against `main`.

**Data model**
- `group_expenses`: `id` uuid pk; `group_id` fk `groups` cascade; `payer_member_id` uuid not null and
  `created_by_member_id` uuid not null, each with composite fk `(…, group_id) → group_members(id,
  group_id)` on delete restrict; `amount` bigint not null check `> 0`; `currency` text check in
  (`ARS`, `USD`); `occurred_at` timestamptz; `category_id` uuid not null fk `group_categories`;
  `description` text check 1 to 200 characters; `split_mode` text check in (`equal`, `percentage`,
  `exact`); `payer_movement_id` uuid null fk `movements` on delete set null; `created_at`. Unique
  `(id, group_id)`; indexes `(group_id, occurred_at desc, id desc)`, `(payer_member_id)`.
- `group_expense_shares`: `expense_id` uuid fk cascade; `member_id` uuid not null; `group_id` uuid not
  null; `amount` bigint not null check `>= 0`; `basis_points` integer null check `0 to 10000`;
  pk `(expense_id, member_id)`; composite fks `(expense_id, group_id) → group_expenses(id, group_id)`
  cascade and `(member_id, group_id) → group_members(id, group_id)` restrict; index `(member_id,
  expense_id)`.
- `group_default_split_shares`: `group_id`, `member_id`, `basis_points` integer check `0 to 10000`; pk
  `(group_id, member_id)`; composite fk to `group_members`; cascade on group delete.
- `group_activity_log`: `id` uuid pk; `group_id` fk cascade; `member_id` uuid not null with composite
  fk to `group_members`; `action` text check in (`expense_created`); `subject_id` uuid not null;
  `created_at` timestamptz not null; index `(group_id, created_at desc, id desc)`.
- `groups.default_split_mode` text not null default `equal`, check in (`equal`, `percentage`).

**Error handling**
- A constraint violation surfaces as a database error that the repository of Block 4 maps.

**Required tests**
- [ ] The migration applies on an empty database and on a copy of `main`'s schema; the rollback is
      idempotent and removes only what it added — validates NFR-01 (backstops exist)
- [ ] Introspection: 0 `real`, `double precision` or `numeric` columns in the four tables; amounts
      are `bigint`; the checks and indexes above exist — validates NFR-01
- [ ] A non-positive expense amount is rejected by the check — validates AC-02 (backstop)
- [ ] A share whose member is of another group is rejected by the composite foreign key — validates AC-03 (backstop)
- [ ] Deleting a movement referenced by `payer_movement_id` sets the column to null and keeps the expense — validates AC-14 (erasure safety)
- [ ] A constraint violation (a duplicate share row or a foreign key to a missing member) is rejected by the database as an error the repository maps
- [ ] The journal `when` is greater than 1791661150964

**Completion criterion**
The migration and introspection tests pass and `pnpm --filter ./apps/api typecheck` is clean.

## Block 3 — Domain and use cases

**Files**
- `apps/api/src/groups/domain/group-expense.ts` (new) — the expense type, ordering rule for leftovers, typed
  errors.
- `apps/api/src/groups/application/ports/group-expense-repository.ts`, `payer-movement-recorder.ts`
  (new) — ports; the repository saves an expense, its shares, the log row and (through the recorder)
  the payer movement in one call.
- `apps/api/src/groups/application/record-group-expense.ts`, `list-group-expenses.ts`,
  `get-group-expense.ts`, `get-expense-options.ts`, `set-default-split.ts`, `list-personal-shares.ts`
  (new).
- `apps/api/src/groups/index.ts` (modified) — barrel.
- `apps/api/test/groups/expense-fakes.ts`, `apps/api/test/groups/expense-use-cases.test.ts` (new).

**Logic**
`RecordGroupExpense` calls `GroupAccess.member`, resolves the payer and split members inside the
group (D4), checks the category is a non-archived category of the group (D9), checks the payer
account rules (D5), builds the ordered member list (payer first, then `joined_at, id`), allocates
through the shared helpers (D3), asserts the sum, and hands everything to the repository in one
transaction with the log entry (D10) and, when the caller pays, the movement (D6).
`SetDefaultSplit` calls `GroupAccess.admin` and validates like D4. `GetExpenseOptions` and
`ListPersonalShares` implement D9 and D7.

**Input validation**
Inputs arrive already validated by the shared contract; the use cases re-check what needs state: membership of
every split member, category, account currency and ownership, percentage total, exact total.

**Error handling**
- Non-member — `ResourceNotFound` (404); non-admin default split — `GROUP_ADMIN_REQUIRED`.
- Split member not in the group — `GROUP_SPLIT_MEMBER_INVALID`; percentage total off —
  `GROUP_SPLIT_PERCENTAGE_INVALID`; exact total off — `GROUP_SPLIT_AMOUNT_MISMATCH`.
- Category not of the group or archived — `GROUP_EXPENSE_CATEGORY_INVALID`.
- Payer account of another currency, of another user, or sent for a payer who is not the caller —
  `GROUP_PAYER_ACCOUNT_INVALID`; missing when the caller pays — the same code.

**Required tests** *(in-memory fakes)*
- [ ] A valid expense is stored with its shares, and the shares add up to the amount — validates AC-01
- [ ] An amount of 0 or less is rejected as invalid — validates AC-02
- [ ] A split containing a user who is not a member is rejected — validates AC-03
- [ ] A category of another group is rejected — validates AC-04
- [ ] The default split of 60% / 40% is returned by the options and used as prefill — validates AC-05
- [ ] A member who is not an admin is rejected with 403 when setting the default split — validates AC-06
- [ ] A percentage split not adding up to 100% is rejected and reports the total — validates AC-09
- [ ] An exact split not adding up is rejected and reports the difference — validates AC-11
- [ ] A registered payer paying from their ARS account records one movement of the full amount — validates AC-14
- [ ] An account whose currency differs from the expense currency is rejected — validates AC-15
- [ ] A ghost payer records the expense and no movement — validates AC-16
- [ ] A registered payer of 40,000.00 split among 4 has share 10,000.00 and receivable 30,000.00 — validates AC-17
- [ ] Another member's share of 10,000.00 appears in their personal view and no movement is recorded — validates AC-18
- [ ] An archived category is not offered by the options and is rejected on create; a new category is offered — validates AC-19, AC-20
- [ ] After a ghost is claimed, the user's personal view shows the 2 expenses and 3 shares — validates AC-21
- [ ] Creating an expense adds one log entry with the action, the member and the instant of the clock — validates AC-22
- [ ] A non-member reading or recording gets 404 — validates AC-23
- [ ] If the repository write fails, no expense, share, log row or movement remains — validates AC-01 (atomicity)
- [ ] A non-member gets `ResourceNotFound`, a non-admin gets `GROUP_ADMIN_REQUIRED`, a split member outside the group gets `GROUP_SPLIT_MEMBER_INVALID`, an archived category gets `GROUP_EXPENSE_CATEGORY_INVALID` and a payer account sent for another payer gets `GROUP_PAYER_ACCOUNT_INVALID` — validates AC-03, AC-04, AC-06, AC-15, AC-23
- [ ] A missing payer account when the caller pays is rejected with `GROUP_PAYER_ACCOUNT_INVALID` — validates AC-15
- [ ] A percentage total off gets `GROUP_SPLIT_PERCENTAGE_INVALID` and an exact total off gets `GROUP_SPLIT_AMOUNT_MISMATCH` — validates AC-09, AC-11

**Completion criterion**
The use-case tests pass with the fakes and the architecture-boundaries test still passes.

## Block 4 — Drizzle adapters

**Files**
- `apps/api/src/groups/infrastructure/db/drizzle-group-expense-repository.ts` (new) — the repository
  of Block 3, with keyset pagination and the personal-view query.
- `apps/api/src/groups/infrastructure/movements/drizzle-payer-movement-recorder.ts` (new) — records
  the payer movement on the open transaction (D6); reads the caller's account and category and the
  rate through the existing lookups.
- `apps/api/src/groups/infrastructure/index.ts` (modified) — exports.
- `apps/api/test/groups/drizzle-group-expense-repository.test.ts`,
  `apps/api/test/groups/payer-movement-recorder.test.ts` (new).

**Logic**
One transaction: insert the expense, its shares and the log row, call the recorder with the same
transaction handle, store `payer_movement_id`. Pagination is keyset on `(occurred_at, id)`. The
personal-view query selects the caller's member rows (a registered member has at most one per group)
and joins shares and expenses, with `receivable = amount - share` only where the member is the payer.
Every query filters by group id and, in the personal view, by the caller's member rows.

**Error handling**
- A unique, check or foreign-key violation — mapped to the typed errors of Block 3.
- A failure inside the transaction — rolls back the expense, shares, log row and movement; any other database failure is rethrown with no silent `catch`.

**Required tests**
- [ ] The expense, shares and log row are persisted together and read back — validates AC-01, AC-22
- [ ] The payer movement lowers the derived account balance by the full amount — validates AC-14
- [ ] A forced failure after the movement insert leaves nothing behind — validates AC-01 (atomicity)
- [ ] A ghost payer leaves no movement and a null `payer_movement_id` — validates AC-16
- [ ] The personal view returns the share and the receivable for the payer and the share only for
      others, and no data of members of other groups — validates AC-17, AC-18, AC-23
- [ ] After `claimGhost` the claiming user's personal view contains the ghost's expenses and shares
      — validates AC-21
- [ ] Pagination returns each expense once across pages with a cursor, newest first — validates AC-01
- [ ] An expense of another group requested by id is not found — validates AC-23
- [ ] A unique, check or foreign-key violation is rejected and mapped to the typed error — validates AC-02, AC-03
- [ ] A failure inside the transaction is an error that rolls back the expense, shares, log row and movement, and any other database failure is rethrown — validates AC-01
- [ ] Concurrent creation of 20 expenses in one group keeps every share sum equal to its amount —
      validates NFR-02

**Completion criterion**
The adapter tests pass against PostgreSQL (`127.0.0.1:5435`) and the erasure-related suites stay green.

## Block 5 — Routes and composition root

**Files**
- `apps/api/src/groups/infrastructure/http/group-routes.ts` (modified) — the routes below.
- `apps/api/src/groups/infrastructure/http/group-expense-presenter.ts` (new).
- `apps/api/src/server.ts` (modified only if the factory needs new dependencies).
- `apps/api/test/groups/group-expense-routes.test.ts`, `apps/api/test/groups/expense-audit.test.ts`
  (new).

**Logic**
Routes are registered behind the `/groups` session and verified-email guards of 05a; `personal/shares`
is registered before the `:id` routes.

**API contract**
- `POST /groups/:id/expenses` — body `createGroupExpenseRequestSchema`; 201 `groupExpenseResponseSchema`.
- `GET /groups/:id/expenses` — query `listGroupExpensesQuerySchema`; 200 `groupExpensePageSchema`.
- `GET /groups/:id/expenses/:expenseId` — 200 `groupExpenseResponseSchema`.
- `GET /groups/:id/expense-options` — 200 `expenseOptionsResponseSchema`.
- `PUT /groups/:id/default-split` — admin; body `defaultSplitRequestSchema`; 200 the stored split.
- `GET /groups/personal/shares` — query `personalSharesQuerySchema`; 200 `personalSharesPageSchema`.
- Error codes: `VALIDATION_FAILED` 400, the five split/payer codes 400, `GROUP_ADMIN_REQUIRED` 403,
  not found 404.
- Auth: session cookie and verified email; membership checked per group (D11).

**Error handling**
- Errors reach the single error middleware; non-members and missing groups or expenses answer 404.
- The audit lines for a created expense carry the request id, the user id, the group id and the
  expense id, never descriptions or amounts.

**Required tests**
- [ ] `POST` records a valid expense and answers 201 with its shares — validates AC-01
- [ ] `POST` with amount 0, an unknown extra key or a bad split answers 400 — validates AC-02, AC-09, AC-11
- [ ] `POST` with a non-member in the split answers 400 `GROUP_SPLIT_MEMBER_INVALID` — validates AC-03
- [ ] `POST` with a foreign category answers 400 — validates AC-04
- [ ] `PUT default-split` as admin stores 60/40 and the options return it; as a member it answers 403 — validates AC-05, AC-06
- [ ] `POST` paid from an ARS account lowers it by 40,000.00; a USD account answers 400; a ghost payer
      records no movement — validates AC-14, AC-15, AC-16
- [ ] `GET /groups/personal/shares` returns 10,000.00 share and 30,000.00 receivable for the payer
      and the share only for another member — validates AC-17, AC-18
- [ ] `GET expense-options` omits an archived category and offers a new one — validates AC-19, AC-20
- [ ] A claimed ghost's expenses and shares appear in the claimer's personal view over HTTP — validates AC-21
- [ ] A created expense adds a log row; the audit line has no amount or description — validates AC-22
- [ ] A non-member gets 404 on every route and a missing expense id also gets 404 — validates AC-23
- [ ] 10,000.00-amount boundary: the maximum amount passes and one more unit answers 400 — validates NFR-01

**Completion criterion**
The route tests pass, the full API suite is green, and `pnpm lint`, `pnpm typecheck` and both builds
pass.

## Final verification
All 23 acceptance criteria have a test; no money column is a float; the full suite and the coverage
floor (80% lines, branches and functions) hold; a registered payer's account drops by the full amount
while the personal view counts only shares; the 05a gotchas (erasure registries, `127.0.0.1` database,
fresh `_test` database) were applied.

# Spec DISC-001-06c: Budget Spending and Rollover

| Field | Value |
|-------|-------|
| Ticket | DISC-001-06c |
| PRD | docs/ddw/prd/prd-DISC-001-06c.md |
| Tier | FEATURE |
| Date | 2026-10-11 |
| Spec loops | 0 |
| Loops since last human decision | 0 |

## Summary
The `budgets` module gains a read-only computation of what each budget has spent in a month. Two new
routes, `GET /budgets/spending?month=YYYY-MM` (every budget of the caller) and
`GET /budgets/:id/spending?month=YYYY-MM` (one), return per budget its amount, the rollover carried
in, the available amount, the spending, the remaining amount, the percentage used and the stored
thresholds. The month defaults to the current month in the caller's time zone and may not be in the
future. Spending is the caller's personal expenses in the categories the budget covered in that month
(the selected ones and their subcategories) plus the caller's shares of group expenses whose group
category name matches a covered category name, both converted to the budget currency with the rate
frozen on the movement, over month boundaries in the caller's zone. Everything is read with two
aggregated SQL queries for all budgets, never one query per budget. Rollover is computed on the fly
from the previous month. No table is created, no write path changes and no screen is built (06f); the
only schema change is one index, migration 0035.

## Design decisions
- D1: Read-only, owner scoped. The routes sit behind `requireSession` and `requireVerifiedEmail`
  like the rest of `/budgets`; the budget reads take the `AccessScope` and use `scopedTo`, and the
  movement and share reads filter by the scope's user id. A budget outside the scope is
  indistinguishable from a missing one: 404 `NOT_FOUND` (FR-07, AC-23). There is no write, so no
  `AccessScope<'write'>`.
- D2: Month and bounds (FR-01, FR-04). A month is `YYYY-MM`. "Current month" comes from the `Clock` and
  `UserTimeZone` ports with `todayInTimeZone` of `packages/shared`, never the server zone (PRD 01
  FR-24). The bounds of a month are `[start, next start)` as UTC instants from `zonedLocalToInstant`
  at 00:00 of the first day in the user's zone; if midnight does not exist in that zone on that day
  (the helper returns `null`), 01:00 is used. A month later than the current one is rejected with 400
  `BUDGET_MONTH_IN_FUTURE`; a malformed month is rejected by the shared query contract with 400
  `VALIDATION_FAILED` (AC-16). Needs the owner's confirmation (PRD Decision Log).
- D3: Which version applies (FR-06). For a month M the budget version is the one with the greatest
  `effective_from` not after the first day of M (`versionInForce` of 06b); when none exists the budget
  did not exist yet and is left out of the list (404 by id) (AC-17). Unlike 06b's `listCurrent`, which
  shows a budget with its first version when every version is later, this read returns `null`.
  The covered categories of that version are its selected ids plus the children of every selected
  parent, read at request time (06b D5), so a subcategory created later is covered also in past
  months, as in 06b.
- D4: Personal spending (FR-01, FR-08). One query over `movements` joined to `accounts` for the
  account currency: `owner_id` = the caller, `type = 'expense'`, `category_id` in the union of the
  covered categories of every budget for the current and previous month, `occurred_at` inside the two
  months, and excluding the payer movement of a group expense (`not exists` over
  `group_expenses.payer_movement_id`). It groups by category, month bucket (current or previous),
  account currency and the frozen `rate`, and returns `sum(amount)::text` and `count(*)`; sums are read
  as text and parsed with `BigInt`, never as a number. Conversion happens in the domain, once per group
  (D7). The index `movements_owner_category_date_idx` (owner, category, date desc, id desc) already
  serves this predicate, so no movements index is added.
- D5: Group shares (FR-01, FR-03, FR-08). One query over the caller's member rows (the same rule as
  `GET /groups/personal/shares` in `drizzle-group-expense-repository.ts`: the expense is paid by, or
  has a share held by, one of the caller's member rows) restricted to the two months, left joined to
  the member's share and to the group category, and to the caller's own payer movement
  (`group_expenses.payer_movement_id` joined to `movements` with `owner_id` = the caller) for its
  frozen `rate`. It groups by group category (id, custom name, default key), expense currency, month
  bucket and that rate, and returns the sum of the share amounts as text and the count, ignoring
  shares of 0. The paginated personal shares endpoint is not called: aggregation needs every row of
  two months, and a keyset page loop would be N queries. The budgets module reads the group tables
  only through its own `infrastructure/db/foreign-relations.ts`, never through code of the `groups`
  module (06b D12).
- D6: Name match (FR-03). A share is counted in a budget when the case-insensitive (NFC, lower case)
  effective name of its group category equals the effective name of any category the budget covers.
  The effective names of a category are its custom name when set, otherwise both language names of its
  default key (`defaultCategoryNames` of `packages/shared`), the same rule as the categories module
  for uniqueness. The module re-implements the rule in its domain with a parity test, because it must
  not import the `categories` module code. Needs the owner's confirmation.
- D7: Conversion (FR-02, NFR-02). Same currency: the amount. Other currency: `convertMinorUnits` of
  `packages/shared` with the frozen rate (ARS per USD scaled by 10,000, half up, integer only). A
  personal expense always has a rate (a movement shape check), so it always converts. A group share in
  the other currency converts only when the payer movement of the caller supplied a rate; otherwise it
  is not counted and increments `unconvertedShareCount` of the budget (AC-12). No call reads
  `exchange_rates`, and no adapter of dolarapi.com is on this path (AC-09). Because the aggregate
  groups by identical rate, the conversion rounds once per group (category, bucket, currency, rate)
  instead of once per movement, which can differ by at most half a minor unit per movement from
  converting each movement; with one movement per group the two are equal. Needs the owner's
  confirmation (open question 3).
- D8: Rollover on the fly (FR-05, decided by the owner on 2026-10-11). For a budget whose version in
  force for M has rollover on, `rolloverAmount` = the greater of 0 and (amount of the version in
  force for the previous month, minus the spending of the previous month computed with that version's
  categories); with no version in the previous month it is 0 (AC-22). The previous month's own
  rollover is not included, so it does not compound across months (needs the owner's confirmation,
  open question 1). `available` = amount + `rolloverAmount`; `remaining` = `available` - spending,
  possibly negative; `percentUsed` = the spending times 100 divided by `available`, in `bigint`,
  rounded down and capped at 1,000, so a threshold of N percent is crossed exactly when `percentUsed`
  is at least N. The previous month is read only when some budget has rollover on.
- D9: No state. Nothing is stored, cached or snapshotted: every request recomputes from the movements,
  so a late or edited movement changes the next read (AC-21), and the API stays stateless
  (`AGENTS.md`).
- D10: Money (NFR-02). Amounts travel as exact integer strings (`exactIntegerStringSchema`, signed,
  because `remaining` can be negative); the domain uses `bigint` only. No `Number`, no `parseFloat`,
  no `toFixed`, no `numeric` cast in the code of the feature, and a source scan test enforces it as in
  06a.
- D11: Index (NFR-01). The exclusion of D4 needs to find, for a candidate movement, whether a group
  expense points at it. `group_expenses.payer_movement_id` has no index, so the probe would scan every
  group expense of every user. Migration `0035_group_expense_payer_movement_idx` adds a partial index
  on `group_expenses(payer_movement_id) where payer_movement_id is not null`. It is additive and
  changes no data. Its journal `when` is 1791790000000 (the maximum on this branch is 1791780000000
  for 0034), and it must exceed the maximum on `main` at merge time per the Drizzle merge rule.
  Rollback script `0035_group_expense_payer_movement_idx.down.sql`, idempotent (`drop index if exists`
  and the delete of the journal row by its `created_at`, pinned by a test). The index belongs to the
  `groups` schema file because the table does.
- D12: Ports. `SpendingReader` (new, in `application/ports`) with `personalSpending` and
  `shareSpending`; `BudgetVersionReader` (new) returning, per budget of the caller, the versions in
  force for the two months with their covered categories (id, custom name, default key); `Clock` and
  `UserTimeZone` exist from 06b. Domain and application import nothing from infrastructure
  (`architecture-boundaries.test.ts`).
- D13: No new runtime dependency and no float anywhere. No change to the write path of movements or
  groups, and none to the 06b tables.

## Open questions for the owner
1. Rollover is one level deep (D8): last month's own remaining amount, not compounded. Alternative:
   compound over every month since creation, which makes the read unbounded.
2. The payer movement of a group expense is left out of personal spending and the share is counted
   (D4, FR-08). Alternative: count the movement and not the payer's share.
3. A group share keeps no frozen rate of its own (the 05b tables store none), so a share in the other
   currency converts only through the payer's own movement and is otherwise reported as unconverted
   (D7). Alternative: freeze a rate on every group expense at write time, a change to the 05b write
   path plus a migration; this ticket does not do it. The user-visible effect is that an USD group
   expense paid by someone else does not reach an ARS budget until that decision is made.
4. A group category matches any covered category name, subcategories included (D6), and a month before
   the budget existed is left out (D3).

## Coverage: PRD → blocks
| Requirement | Covered by |
|---|---|
| FR-01 | Block 2, Block 3, Block 4, Block 5 |
| FR-02 | Block 2, Block 3, Block 5 |
| FR-03 | Block 2, Block 3, Block 5 |
| FR-04 | Block 1, Block 2, Block 4, Block 5 |
| FR-05 | Block 2, Block 3, Block 4, Block 5 |
| FR-06 | Block 3, Block 4 |
| FR-07 | Block 3, Block 4, Block 5 |
| FR-08 | Block 3, Block 5 |
| NFR-01 | Block 3 (index), Block 5 (benchmark) |
| NFR-02 | Block 1, Block 2, Block 5 |

## Dependencies between blocks
Block 1 first (contract and error code). Block 2 (pure domain) needs only Block 1's types. Block 3
(ports, migration and SQL adapters) and Block 4 (use cases and routes) both build on Blocks 1 and 2;
Block 4 tests against in-memory fakes of the Block 3 ports, so the two can proceed in parallel. Block 5
last: benchmark, end-to-end flow and the float scan.

## Block 1 — Shared contract and error code

**Files**
- `packages/shared/src/budgets/spending.ts` (new) — Zod validation of the query and the responses, and
  their types.
- `packages/shared/src/errors.ts` (modified) — code `BUDGET_MONTH_IN_FUTURE`.
- `packages/shared/src/index.ts` (modified) — exports.
- `apps/api/src/shared/http/error-handler.ts` (modified) — `BUDGET_MONTH_IN_FUTURE` maps to 400.
- `apps/web/src/lib/api-client.ts`, `apps/web/messages/en.json`, `apps/web/messages/es.json`
  (modified) — message key `errors.budgetMonthInFuture` in both catalogs.
- `packages/shared/test/budget-spending-schemas.test.ts` (new).

**Logic**
Contract only, no behaviour. `percentUsed` is an integer from 0 to 1,000; money fields are exact
integer strings; `month` is `YYYY-MM` with month 01 to 12.

**Shared types** *(no route here; the routes are in Block 4)*
- `budgetSpendingMonthSchema`: string matching `^\d{4}-(0[1-9]|1[0-2])$`.
- `budgetSpendingQuerySchema`: strict `{ month?: budgetSpendingMonthSchema }`.
- `budgetSpendingResponseSchema`: `{ budgetId: uuid, name, currency, month, amount, rolloverEnabled:
  boolean, rolloverAmount, available, spent, remaining (signed), percentUsed: integer 0 to 1000,
  thresholds: integer[], unconvertedShareCount: integer >= 0 }`, money as `exactIntegerStringSchema`.
- `budgetSpendingListResponseSchema`: `{ month, budgets: budgetSpendingResponseSchema[] }`.

**API contract**
- `GET /budgets/spending` and `GET /budgets/:id/spending` — no body, query `budgetSpendingQuerySchema`
  — 200 with the response schemas above; the handlers are built in Block 4, this block fixes the
  shapes.
- Error codes: 400 `VALIDATION_FAILED`, `BUDGET_MONTH_IN_FUTURE`; 401 `UNAUTHENTICATED`; 403
  `EMAIL_NOT_VERIFIED`; 404 `NOT_FOUND`.
- Auth: verified session.

**Input validation**
The query object is strict: an unknown key, a month such as `2026-13`, `2026-1`, `2026-10-01` or an
empty string is invalid and rejected.

**Error handling**
- A malformed month or an unknown key: 400 `VALIDATION_FAILED` through the shared middleware.
- `BUDGET_MONTH_IN_FUTURE` maps to 400.

**Required tests**
- [ ] `2026-10` and `2026-01` pass; `2026-13`, `2026-00`, `2026-1`, `2026-10-01`, an empty string and a
      number are rejected as invalid — validates AC-16
- [ ] An unknown query key is rejected; an absent month passes — validates AC-15, AC-16
- [ ] A response with `percentUsed` 1001, -1 or 80.5 fails to parse; a money field of `1.5` or `1e3`
      fails to parse; `-3000000` passes for `remaining` — validates AC-14, AC-28
- [ ] The error code `BUDGET_MONTH_IN_FUTURE` maps to 400 and `pnpm typecheck` accepts the web message
      key — validates AC-16
- [ ] A query with a malformed month fails with the 400 error `VALIDATION_FAILED` and a month in the
      future is rejected with the 400 error `BUDGET_MONTH_IN_FUTURE` — validates AC-16

**Completion criterion**
The shared tests pass and `pnpm typecheck` passes.

## Block 2 — Pure calculation in the domain

**Files**
- `apps/api/src/budgets/domain/month.ts` (modified) — `monthOf`, `previousMonth`, `monthStartOf`,
  `monthBounds`.
- `apps/api/src/budgets/domain/spending.ts` (new) — the pure calculation.
- `apps/api/src/budgets/domain/errors.ts` (modified) — `BudgetMonthInFuture`.
- `apps/api/test/budgets/spending-domain.test.ts` (new).

**Logic**
- `monthOf(isoDate)`: `YYYY-MM` of `YYYY-MM-DD`. `previousMonth('2026-01')` is `2025-12`.
  `monthStartOf('2026-10')` is `2026-10-01`.
- `monthBounds(month, timeZone)`: `{ from, to }` UTC instants as in D2, including the 01:00 fallback.
- `effectiveNames({ name, defaultKey })` and `namesMatch(a, b)`: D6, NFC and lower case.
- `convertAmount(amount, from, to, rate)`: D7; `null` when the currencies differ and `rate` is
  `null`; rejects a rate of 0 or less through `convertMinorUnits`.
- `spendingOf(budgetCurrency, coveredCategoryIds, coveredNames, personalRows, shareRows)`: sums the
  personal rows whose category is covered and the share rows whose group category name matches, each
  converted; returns `{ spent, unconvertedShareCount }`.
- `computeBudgetSpending({ currency, current, previous, spentCurrent, spentPrevious })`: returns the
  fields of the response per D8: `rolloverAmount`, `available`, `remaining`, `percentUsed`.
- `percentUsed(spent, available)`: `bigint` division rounded down, from 0 to 1,000; `available` is
  always greater than 0.

**Input validation**
Pure functions over already validated values. A month that is not `YYYY-MM`, or a rate of 0 or less,
throws an error rather than returning a guess.

**Error handling**
- `BudgetMonthInFuture` is a typed error with code `BUDGET_MONTH_IN_FUTURE`, thrown by the use case
  (Block 4) with the comparison done by `monthOf` and `previousMonth`.
- Invalid input to the helpers throws; nothing is swallowed.

**Required tests**
- [ ] Personal 50,000.00 ARS plus a share of 10,000.00 ARS in a covered category gives a spending of
      6000000 — validates AC-01
- [ ] A row of a category outside the covered set, and a row of income kind, are not counted — validates
      AC-04
- [ ] No rows give spent 0 and remaining equal to available — validates AC-05
- [ ] 20.00 USD at the rate 15000000 gives 3000000 ARS; 3000000 ARS at 15000000 gives 2000 USD — validates
      AC-07, AC-08
- [ ] A rate of 0 or a negative rate is rejected with an error; a conversion near the largest int64
      does not overflow (bigint) — validates AC-28
- [ ] The names "Food" and "food" match; "Food" and "Foods" do not; a default category with no custom
      name matches both its Spanish and English names; parity with the categories module's
      `effectiveNames` on the same samples — validates AC-10, AC-11
- [ ] A share in USD with no rate in an ARS budget is not counted and `unconvertedShareCount` is 1 —
      validates AC-12
- [ ] Amount 15000000, spent 12000000 gives remaining 3000000 and 80; spent 18000000 gives remaining
      -3000000 and 120; spent 100 times the amount gives 1000 (the cap) — validates AC-13, AC-14
- [ ] Rollover on, previous amount 15000000 and previous spent 13000000 gives rolloverAmount 2000000 and
      available 17000000 — validates AC-18
- [ ] Rollover on and a previous overspend gives rolloverAmount 0 and available equal to the amount —
      validates AC-19
- [ ] Rollover off gives rolloverAmount 0 whatever the previous month held — validates AC-20
- [ ] Rollover on and no previous version gives 0 — validates AC-22
- [ ] `monthBounds('2026-10', 'America/Argentina/Buenos_Aires')` starts at 2026-10-01T03:00:00Z and ends
      at 2026-11-01T03:00:00Z; an instant at 2026-10-01T01:00:00Z is before the start — validates AC-03
- [ ] `previousMonth('2026-01')` is `2025-12` and a malformed month throws an error — validates AC-15,
      AC-16
- [ ] Every function of the module is exercised with bigint only; no value is a float — validates AC-28

**Completion criterion**
`spending-domain.test.ts` passes, the domain imports nothing from infrastructure, and
`pnpm typecheck` passes.

## Block 3 — Ports, SQL adapters and migration 0035

**Files**
- `apps/api/src/budgets/application/ports/spending-reader.ts`, `budget-version-reader.ts` (new) — the
  ports.
- `apps/api/src/budgets/infrastructure/db/drizzle-spending-reader.ts` (new) — the two aggregated
  queries of D4 and D5.
- `apps/api/src/budgets/infrastructure/db/drizzle-budget-version-reader.ts` (new) — versions in
  force for two months with covered categories.
- `apps/api/src/budgets/infrastructure/db/foreign-relations.ts` (modified) — also re-exports
  `movements`, `accounts`, `groupMembers`, `groupExpenses`, `groupExpenseShares`, `groupCategories`.
- `apps/api/src/groups/infrastructure/db/schema.ts` (modified) — the partial index of D11.
- `apps/api/drizzle/0035_group_expense_payer_movement_idx.sql` (generated), `apps/api/drizzle/meta/*`
  (generated), `apps/api/drizzle/rollback/0035_group_expense_payer_movement_idx.down.sql` (new).
- `apps/api/test/budgets/spending-reader.test.ts`, `budget-version-reader.test.ts`,
  `spending-migration.test.ts`, `spending-query-plan.test.ts` (new; need `TEST_DATABASE_URL`).

**Logic**
`personalSpending(scope, window, categoryIds)` runs one `select` with `sum(m.amount)::text`, grouped as
in D4, parameterized, with the owner taken from the scope. `shareSpending(scope, window)` runs the
query of D5. Both return plain rows (`bigint` parsed from text) and no row of another user: every
joined table is reached through the caller's own member rows or owner column.
`BudgetVersionReader.forMonths(scope, months, budgetId?)` selects, with `distinct on (budget_id)`
ordered by `effective_from desc`, the version in force for each month for the caller's budgets (or one
budget), then loads categories and thresholds of those versions and the children of their selected
categories in one extra query (the covered set and, for each covered category, its custom name and
default key). A budget whose first version is later than the month yields `null` for that month. No
query runs inside a loop over budgets.

**Data model**
- No new table and no new column. Existing columns read: `movements.owner_id`, `type`, `category_id`,
  `account_id`, `amount`, `rate`, `occurred_at`; `accounts.currency`; `group_members.user_id`;
  `group_expenses.group_id`, `payer_member_id`, `amount`, `currency`, `occurred_at`, `category_id`,
  `payer_movement_id`; `group_expense_shares.amount`; `group_categories.name`, `default_key`;
  `budget_versions`, `budget_version_categories`, `budget_version_thresholds`, `categories.parent_id`,
  `name`, `default_key`.
- New index `group_expenses_payer_movement_idx` on `group_expenses(payer_movement_id)` where
  `payer_movement_id is not null` (D11). No `real`, `double precision` or `numeric` column anywhere.

**Input validation**
Ports receive validated month windows and category ids from the use case; ids are bound as parameters,
never concatenated. An empty category list returns no rows without querying.

**Error handling**
- A database error is rethrown; no `catch` swallows it. A missing budget gives `null`, which the use
  case turns into a 404.

**Required tests** *(PostgreSQL)*
- [ ] A personal expense of 50,000.00 ARS and a share of 10,000.00 ARS in covered categories come back
      as the sums of the right buckets — validates AC-01
- [ ] An expense in a child category is returned for a budget over its parent; a child created after
      the budget is returned too — validates AC-02
- [ ] A movement at 2026-10-01T01:00Z falls in the September bucket for a Buenos Aires window and in
      the October bucket for a UTC window — validates AC-03
- [ ] Income, transfers, exchanges, expenses of other categories and movements of another user are not
      returned — validates AC-04
- [ ] A budget raised from 100,000.00 ARS to 150,000.00 ARS in October returns the September version for
      September and the October version for October; a month before its first version returns `null` —
      validates AC-06, AC-17
- [ ] The expense rows in USD come back with their frozen rate; editing the stored `exchange_rates`
      after the movement does not change the rows, and the reader never touches `exchange_rates` —
      validates AC-09
- [ ] A group category named "Food" is returned with its name, and a default group category with no name
      is returned with its default key — validates AC-10
- [ ] A share in USD of a group expense paid by the caller carries the payer movement's rate; the same
      share of an expense paid by another member carries no rate — validates AC-12
- [ ] The payer movement of a group expense (30,000.00 ARS, share 10,000.00 ARS) is not in the personal
      rows while the share is in the share rows — validates AC-26
- [ ] The rows and the versions of another user are never returned, and a version read for another
      user's budget id returns nothing — validates AC-23, AC-24
- [ ] Adding a September movement changes the September rows returned by the next call — validates AC-21
- [ ] With 50 budgets the reader issues a fixed number of statements (no query per budget), counted
      through the pool — validates NFR-01
- [ ] Query plan test: with 100,000 movements the personal query uses `movements_owner_category_date_idx`
      and the exclusion uses `group_expenses_payer_movement_idx`, with no sequential scan of
      `group_expenses` — validates NFR-01
- [ ] A database error in either reader (a failing statement) is rethrown as an error and never
      swallowed; a missing or foreign budget id is a missing result, not a failure — validates AC-23
- [ ] Migration 0035 applies on an empty database and on a copy of the schema of `main`; the rollback
      script, run twice, removes only the index and the 0035 journal row; the journal `when` of 0035 is
      greater than 1791780000000 and 0 float columns exist in the changed tables — validates NFR-02

**Completion criterion**
Reader, plan and migration tests pass against PostgreSQL, and `pnpm --filter ./apps/api` typechecks.

## Block 4 — Use cases and routes

**Files**
- `apps/api/src/budgets/application/compute-spending.ts` (new) — shared orchestration of the two reads
  and the pure calculation.
- `apps/api/src/budgets/application/list-budget-spending.ts`, `get-budget-spending.ts` (new).
- `apps/api/src/budgets/application/dependencies.ts` (modified) — adds the two readers.
- `apps/api/src/budgets/index.ts` (modified) — exports.
- `apps/api/src/budgets/infrastructure/http/budget-routes.ts` (modified) — the two routes, registered
  before `/budgets/:id`.
- `apps/api/src/budgets/infrastructure/http/spending-presenter.ts` (new).
- `apps/api/test/budgets/fakes.ts` (modified), `spending-use-cases.test.ts`, `spending-routes.test.ts`
  (new).

**Logic**
`compute-spending` takes the caller's `AccessScope`, the requested month (default: the current month
from `Clock` and `UserTimeZone`), rejects a month after the current one with `BudgetMonthInFuture`,
asks `BudgetVersionReader` for the versions in force for the month and its previous month, builds the
windows with `monthBounds`, calls `personalSpending` and `shareSpending` once each for the union of
the covered categories (the previous month is included only when some budget has rollover on), and
returns for each budget with a version in force the result of `computeBudgetSpending`. The list keeps
the budgets in creation order. The by-id use case does the same for one budget and answers 404 when it
is missing, foreign or has no version in force that month (AC-17). Audit lines carry the request id,
the user id and the budget id, never a name or an amount.

**API contract**
- `GET /budgets/spending?month=YYYY-MM` — query `budgetSpendingQuerySchema` — 200
  `budgetSpendingListResponseSchema`, only the caller's budgets.
- `GET /budgets/:id/spending?month=YYYY-MM` — params `budgetIdParamsSchema`, query
  `budgetSpendingQuerySchema` — 200 `budgetSpendingResponseSchema`; 404 for a missing, foreign or
  not-yet-existing budget.
- Error codes: 400 `VALIDATION_FAILED`, `BUDGET_MONTH_IN_FUTURE`; 401 `UNAUTHENTICATED`; 403
  `EMAIL_NOT_VERIFIED`; 404 `NOT_FOUND`.
- Auth: verified session; ownership resolved per request (D1). Read-only: no body and no state change.

**Input validation**
Params and query go through the shared schemas of Block 1 and the shared `validate` middleware; the
month comparison with "today" needs state and happens in the use case.

**Error handling**
- Typed domain errors reach the existing error middleware; a foreign budget and a missing one give the
  same 404 body.

**Required tests** *(in-memory fakes; routes over PostgreSQL in Block 5)*
- [ ] Two budgets get their own spending from one call of each reader — validates AC-01, AC-24
- [ ] A budget over Food counts a row of a child category — validates AC-02
- [ ] No month uses the current month of the clock in the user's zone, also when UTC is already the next
      month — validates AC-15
- [ ] A month later than the current one is rejected with a 400 error and no reader is called — validates
      AC-16
- [ ] A month before the budget's first version leaves it out of the list and answers 404 by id —
      validates AC-17
- [ ] A budget of 150,000.00 ARS with 120,000.00 ARS spent returns remaining 3000000 and 80; with
      180,000.00 spent returns -3000000 and 120 — validates AC-13, AC-14
- [ ] No rows return spent 0 and remaining equal to available — validates AC-05
- [ ] Rollover on with 20,000.00 ARS left in September returns 17000000 available for October; with an
      overspend returns the amount; with rollover off returns the amount; with no September version
      returns the amount — validates AC-18, AC-19, AC-20, AC-22
- [ ] September uses September's version and categories when asked for September — validates AC-06
- [ ] A share in a foreign currency with no rate is reported in `unconvertedShareCount` and not summed —
      validates AC-12
- [ ] Reading a budget of another user answers 404 as for an unknown id and calls no spending reader —
      validates AC-23
- [ ] The list holds only the caller's budgets — validates AC-24
- [ ] A request with no session answers 401 and returns no body field of a budget — validates AC-25
- [ ] The previous month is not read when no budget has rollover on — validates NFR-01
- [ ] Every returned money field is a string of digits (with an optional minus) and no value passes
      through `Number` — validates AC-28

**Completion criterion**
`spending-use-cases.test.ts` and the route tests of this block pass with 0 imports from infrastructure
in the application layer, and the boundary test stays green.

## Block 5 — Benchmark, end-to-end flow and float scan

**Files**
- `apps/api/test/perf/budget-spending.perf.test.ts` (new) — mirrors `goals-list.perf.test.ts`
  (autocannon, 300 requests, 8 connections, 20 warm-up, limit 500 ms), run with `pnpm test:perf`.
- `apps/api/test/budgets/spending-flow.test.ts` (new; supertest over PostgreSQL).
- `apps/api/test/budgets/no-float-spending.test.ts` (new) — source scan, as `goals/no-float-money.test.ts`.

**Logic**
The benchmark seeds one user with `seedDataset` (100 accounts, 100,000 real movements), then through
parameterized SQL: 50 expense categories (the seeded expense rows are spread over them and their dates
over the current and previous month), 50 budgets of 06b with a version in each of the two months (half
with rollover on, half in USD), and a group with the user as member and 5,000 expenses with shares in
group categories whose names match some budget categories. After `analyze`, it asks `GET
/budgets/spending` 300 times and requires every status 200, every `percentUsed` and money field to
parse with the shared response schema, and the spending of four named budgets to equal a total the test
computes in SQL with integer arithmetic, so an adapter answering with empty rows cannot pass. A second
case asserts that the response for 50 budgets lists all 50. The flow test drives the routes through the
real use cases and adapters with a clock set to October, a user in Buenos Aires.

**API contract**
No new route: the tests exercise the two routes of Block 4 (`GET /budgets/spending`,
`GET /budgets/:id/spending`), with no body and the optional month query, and expect the 200 response
shapes of Block 1.
- Error codes asserted: 400 `VALIDATION_FAILED`, `BUDGET_MONTH_IN_FUTURE`; 401 `UNAUTHENTICATED`;
  404 `NOT_FOUND`.
- Auth: verified session.

**Data model**
No new table or column. The benchmark inserts rows into `accounts`, `categories`, `movements`,
`budgets`, `budget_versions`, `budget_version_categories`, `budget_version_thresholds`, `groups`,
`group_members`, `group_categories`, `group_expenses` and `group_expense_shares` by parameterized SQL
and deletes them afterwards; all existing constraints (foreign keys with the owner, check constraints,
not null `bigint` amounts, unique indexes) apply and no constraint is changed.

**Error handling**
- The benchmark and the flow tests fail the run on any seeding error or any status other than the
  expected one; nothing is caught and ignored.
- The scan test fails and names the offending file when a forbidden token appears.

**Required tests**
- [ ] Benchmark: p95 under 500 ms of `GET /budgets/spending` for 50 budgets and 100,000 movements, every
      status 200, spending equal to the SQL control totals — validates AC-27 (NFR-01)
- [ ] Flow: create two budgets and movements in September and October, read October and September, and
      the amounts, remaining, percentages and rollover equal the expected exact strings — validates
      AC-01, AC-06, AC-13, AC-18
- [ ] Flow: a 20.00 USD expense at 15000000 counts 3000000 in an ARS budget and an ARS expense counts in
      a USD budget; changing the stored rates afterwards leaves the answer equal — validates AC-07,
      AC-08, AC-09
- [ ] Flow: a group share with category "Food" counts in a budget over "food"; a share with an
      unmatched name counts nowhere; the payer movement of a group expense counts once, as the share —
      validates AC-10, AC-11, AC-26
- [ ] Flow: editing a September expense after October began changes the October rollover on the next
      read — validates AC-21
- [ ] Flow: a month in the future answers 400 `BUDGET_MONTH_IN_FUTURE`; a malformed month answers 400
      `VALIDATION_FAILED`; a month before the budget answers 404 by id — validates AC-16, AC-17
- [ ] Flow: a second user reading the first user's budget answers 404 with the same body as an unknown
      id, and each list holds only its owner's budgets; a request with no session answers 401 —
      validates AC-23, AC-24, AC-25
- [ ] Flow: a second API instance returns the same spending (no process state) — validates the
      stateless rule of `AGENTS.md`
- [ ] Flow: no log line contains a budget name or an amount — validates the audit rule
- [ ] Scan: the feature's source files and tests contain no `parseFloat`, `toFixed`, `Number(` (other
      than a row count), `real`, `doublePrecision`, `numeric`, `decimal` or `float` column, and the
      0035 migration declares none — validates AC-28 (NFR-02)

**Completion criterion**
The benchmark passes under `pnpm test:perf`, the flow and scan tests pass under `pnpm test`, and
`pnpm lint` and `pnpm typecheck` are green.

## Final verification
- 28 of 28 acceptance criteria of the PRD have at least one passing test, and every input has a
  sad-path test.
- `pnpm lint`, `pnpm typecheck`, `pnpm test:coverage` (80% lines, branches and functions over the three
  packages together), `pnpm test:perf` and `pnpm audit --prod --audit-level high` pass.
- The migration `when` of 0035 is greater than the maximum on `main` at merge time, and 0035 is
  renumbered behind any migration merged first.
- The rollback script, run twice, removes the index and the 0035 journal row, and the migration applies
  again afterwards.
- No write path of movements or groups changed, no 06b table changed, and no web screen was added
  (06f).

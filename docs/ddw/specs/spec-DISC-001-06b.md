# Spec DISC-001-06b: Budgets Core API

| Field | Value |
|-------|-------|
| Ticket | DISC-001-06b |
| PRD | docs/ddw/prd/prd-DISC-001-06b.md |
| Tier | FEATURE |
| Date | 2026-10-11 |
| Spec loops | 1 |
| Loops since last human decision | 0 |

## Summary
A new hexagonal API module, `budgets`, stores a user's monthly budgets: a currency, and for every
month in which the budget was edited a version holding its name, amount, rollover flag, covered
categories and alert thresholds. Creating a budget writes the budget and its first version, effective
from the first day of the current month in the user's time zone. Editing writes (or rewrites) the
version of the current month and never touches an earlier one, so a past month keeps its values for
DISC-001-06c to read. Reading returns the version in force this month, plus the covered categories:
the selected ones and the subcategories of every selected parent. A budget can only reference the
caller's own expense categories, and a user holds at most 50 budgets. Spending, rollover
computation and alerts are not built (DISC-001-06c and 06d), and no web screen is built (06f).

## Design decisions
- D1: Ownership. A budget belongs to one user (`owner_id`), so the module uses the shared access
  policy exactly like `categories`: repositories take an `AccessScope` and put it in the WHERE clause
  through `scopedTo`, and a row outside the scope is indistinguishable from a missing one, so the
  caller gets 404 `NOT_FOUND` (FR-07, AC-18). Writes take `AccessScope<'write'>`. There is no group
  access: group budgets are out of scope.
- D2: Edits are effective-month versions (FR-05). `budgets` holds the immutable identity (owner and
  currency); `budget_versions` holds one row per `(budget, effective_from)` where `effective_from` is
  the first day of a month. The current values are those of the version with the greatest
  `effective_from` not after the first day of the current month. An edit in month M writes the version
  of M: if one exists it is replaced entirely (AC-13), otherwise it is created from the current values
  merged with the changes. Earlier versions are never updated (AC-12). Versions are bounded: at most one
  per month per budget, so no unbounded growth. Needs the owner's confirmation (open question 1).
  Alternative considered: an in-place update with a `history` log; rejected because 06c must know the
  amount, categories and rollover of a past month, which an in-place update loses.
- D3: "Current month" is computed in the caller's time zone (`todayInTimeZone` of `packages/shared`)
  from a `UserTimeZone` port and a `Clock` port, never from the server zone (PRD 01 FR-24). A user who
  edits at 23:59 on the last day of a month in their zone writes the version of that month.
- D4: Categories. A version references categories through `budget_version_categories` with a
  composite foreign key `(category_id, owner_id, kind) → categories(id, owner_id, kind)`, with `kind`
  fixed to `expense` by a check, so the database itself refuses a foreign category and an income
  category (AC-03, AC-04), in addition to the use case. The use case validates first and answers: an
  unknown or foreign id, 404 `NOT_FOUND` (not distinguishable, as for every foreign resource); an
  income category, 400 `BUDGET_CATEGORY_KIND_INVALID`; an archived category, 409 `CATEGORY_ARCHIVED`
  (existing code). Archiving a category later does not change a budget that already uses it. The
  foreign key is `on delete no action` and `DEFERRABLE INITIALLY DEFERRED`: deleting a category a
  budget uses fails with the existing `CATEGORY_IN_USE` (the violation surfaces at the end of the
  autocommit delete statement; a caller wrapping the delete in a larger transaction would see it at
  `COMMIT`), and account erasure, which deletes the user's budgets and categories in one transaction,
  still succeeds because the check runs after both sides are gone. Only this key is deferred; the
  owner-scoped keys between the budget tables are immediate.
- D5: Subcategories (FR-02). Only the selected ids are stored. Every read also returns
  `coveredCategoryIds`: the selected ids plus the ids of their children, read from `categories` in the
  same scoped query at read time, so a subcategory created later is covered without an edit (AC-06).
  Selecting both a parent and one of its children is accepted and deduplicated in the covered set.
- D6: Thresholds (FR-04, NFR-02). Stored in `budget_version_thresholds`, one row per percent. When a
  request omits them the version gets `[80, 100]`. When it sends them they must be 1 to 5 distinct
  integers from 1 to 200; they are stored and returned in ascending order. An explicit empty list is
  rejected: a budget without alerts is not in the PRD, and 06d would have to define it. Needs the
  owner's confirmation (open question 3). The table check keeps the range 1 to 200; the count of 5 is
  enforced by the use case and the shared contract.
- D7: Money (NFR-01). `amount` is `bigint` in minor units; the contract carries it as an exact integer
  string (`movementAmountSchema` of the movements contract: greater than 0), and the domain converts
  it with the shared money helpers. No floating point, anywhere, including tests. Currency is `ARS` or
  `USD`, set at creation and immutable: an edit body that contains `currency` is rejected as an unknown
  key.
- D8: Limit of 50 budgets (NFR-03). `create` runs in a transaction that first takes
  `pg_advisory_xact_lock` keyed on the owner and then counts the owner's budgets; at 50 it throws
  `BudgetLimitReached`, mapped to 409 `BUDGET_LIMIT_REACHED`. 409 rather than 400, as recurring
  payments do with `RECURRING_LIMIT_REACHED`: the body is valid and conflicts with stored state. Two
  concurrent creates at 49 cannot both pass. Deleting a budget frees a slot (AC-24). Needs the owner's
  confirmation (open question 2).
- D9: Delete (FR-06) removes the budget row; versions, categories and thresholds go by `on delete
  cascade`. No movement or category is touched (AC-17). Answers 204.
- D10: Account erasure (PRD 01f). Every new table reaches `users` only through cascading keys
  (`budgets.owner_id` cascade, and the children cascade from `budgets`), and the category key is `no
  action` and deferred (D4), so no erasure step is needed and `beforeUserErased` is unchanged. The four tables are added
  to the erasure registry as policy `cascade`, and `build-output.test.ts` lists them, so the guards
  that fail on an unregistered user table stay green.
- D11: Migration `0034_budgets`: four new tables, additive, no change to existing tables. The goals
  ticket (06a) uses 0033 on another branch; the two are renumbered at merge. Its journal `when` must
  exceed the maximum on `main` at merge time (now 1791760600000 for 0032) and the one of 0033, per the
  Drizzle merge rule. Rollback script `0034_budgets.down.sql`, idempotent, drops the four tables
  (destructive for budget data only) and deletes the journal row of 0034 from
  `drizzle.__drizzle_migrations` (by its `created_at`, the journal `when`, pinned by a test) so the
  migration can be applied again. The journal entry is idx 34; idx 33 is skipped (reserved for goals).
- D12: Ports and boundaries. The module declares ports for the clock, the user time zone and the
  category reader. Its infrastructure imports `users` and `categories` only through
  `infrastructure/db/foreign-relations.ts` (as drizzle-kit needs for the foreign keys). Domain and
  application import nothing from infrastructure (`architecture-boundaries.test.ts` covers it). The
  module does not import the `categories` module code, only its table definition.
- D13: Out of the PRD text, decided here and listed for the owner: a budget name is 1 to 50
  characters (the account-name rules: NFC, trimmed, no control or format characters); two budgets may
  share a name; a budget list is ordered by creation, then id; `PATCH` is a partial update and needs at
  least one key. No new runtime dependency and no float anywhere.
- D14: Threat model mitigation (R-04). The advisory lock and the count of D8 bound the rows a user can
  create; the one-version-per-month rule of D2 bounds the versions; the shared body-size limit and the
  5-threshold and category-count limits (at most 50 categories per version, the contract rejects more)
  bound each request.

## Open questions for the owner
1. Edits as effective-month versions (D2). Alternative: update in place and let 06c use only the
   current values, which would show a past month with today's amount and categories (AC-12 would then
   only be true of the stored current row, not of history).
2. A user is limited to exactly 50 budgets, with 409 `BUDGET_LIMIT_REACHED` (D8). Alternatives: a
   higher cap, or a 400 code.
3. A budget must have 1 to 5 thresholds; omitting them means 80 and 100, and an empty list is
   rejected (D6). Alternative: allow an empty list to switch alerts off.

## Coverage: PRD → blocks
| Requirement | Covered by |
|---|---|
| FR-01 | Block 1, Block 2, Block 3, Block 4 |
| FR-02 | Block 2, Block 3, Block 4 |
| FR-03 | Block 1, Block 2, Block 3, Block 4 |
| FR-04 | Block 1, Block 2, Block 3, Block 4 |
| FR-05 | Block 1, Block 2, Block 3, Block 4 |
| FR-06 | Block 2, Block 3, Block 4 |
| FR-07 | Block 2, Block 3, Block 4 |
| NFR-01 | Block 1 (contract), Block 2 (column type) |
| NFR-02 | Block 1 (contract and rule), Block 2 (check) |
| NFR-03 | Block 2 (count under lock), Block 3, Block 4 |

## Dependencies between blocks
Block 1 first (shared contract, domain rules and ports). Blocks 2 and 3 are then independent of each
other: Block 2 builds the schema, migration and Drizzle adapters against the ports; Block 3 builds the
use cases against in-memory fakes of the same ports. Block 4 last: routes and composition root.

## Block 1 — Shared contract, domain rules and ports

**Files**
- `packages/shared/src/budgets/budget.ts` (new) — Zod validation of the contract and its types.
- `packages/shared/src/errors.ts` (modified) — codes `BUDGET_LIMIT_REACHED`,
  `BUDGET_CATEGORY_KIND_INVALID`.
- `packages/shared/src/index.ts` (modified) — exports.
- `apps/api/src/shared/http/error-handler.ts` (modified) — `BUDGET_LIMIT_REACHED` maps to 409 and
  `BUDGET_CATEGORY_KIND_INVALID` to 400.
- `apps/web/src/lib/api-client.ts` (modified) — message keys for the two codes.
- `apps/web/messages/en.json`, `apps/web/messages/es.json` (modified) — `errors.budgetLimitReached`,
  `errors.budgetCategoryKindInvalid`.
- `apps/api/src/budgets/domain/budget.ts`, `thresholds.ts`, `month.ts`, `errors.ts` (new) — entities,
  threshold rules, effective-month rules, typed errors.
- `apps/api/src/budgets/application/ports/budget-repository.ts`, `category-reader.ts`, `clock.ts`,
  `user-time-zone.ts` (new) — the ports.
- `packages/shared/test/budget-schemas.test.ts`, `apps/api/test/budgets/domain.test.ts` (new).

**Logic**
- `normalizeThresholds(input?)`: undefined gives `[80, 100]`; otherwise sorts ascending. Duplicates,
  more than 5, fewer than 1, out of 1 to 200 or non-integers are rejected before this point by the
  contract and again by the function (it throws `VALIDATION_FAILED`).
- `currentMonthStart(now, timeZone)`: the first day of the month of `now` in the zone, as
  `YYYY-MM-01`.
- `versionInForce(versions, monthStart)`: the version with the greatest `effective_from` not after
  `monthStart`, or none.
- `mergeVersion(current, changes, monthStart)`: the new version of an edit; unspecified fields are
  copied from `current`.
- The repository port: `create`, `findById`, `listCurrent`, `update`, `delete`, all scoped; `create`
  and `update` take whole versions and perform their writes in one transaction.

**Shared types** *(no route here)*
- `budgetNameSchema`: string, NFC, trimmed, 1 to 50 characters, no control or format characters.
- `budgetCurrencySchema`: `ARS` or `USD`.
- `budgetThresholdsSchema`: array of 1 to 5 distinct integers from 1 to 200.
- `createBudgetRequestSchema`: `{ name, amount: movementAmountSchema, currency, categoryIds: uuid[]
  (1 to 50, distinct), rollover?: boolean, thresholds? }`, strict.
- `updateBudgetRequestSchema`: `{ name?, amount?, categoryIds?, rollover?, thresholds? }`, strict, at
  least one key; no `currency`.
- `budgetIdParamsSchema`: `{ id: uuid }`.
- `budgetResponseSchema`: `{ id, name, amount: exact integer string, currency, rollover, thresholds,
  categoryIds, coveredCategoryIds, effectiveFrom, createdAt }`; `budgetListResponseSchema` is a list of
  it.

**Input validation**
Strict objects, no extra keys; the amount is an exact integer string greater than 0; thresholds and
category ids are checked for range, count and duplicates.

**Error handling**
- Unknown keys, wrong types, ranges or counts: 400 `VALIDATION_FAILED` through the shared middleware.
- The two new codes map to 409 and 400 as stated.

**Required tests**
- [ ] A name of 51 characters, an empty name and a whitespace-only name are rejected; 50 characters
      pass — validates AC-02
- [ ] An amount of 0, a negative amount, a decimal or a non-numeric string is rejected; 15000000 as a
      string passes — validates AC-02, AC-21
- [ ] A currency other than `ARS` or `USD` is rejected — validates AC-02
- [ ] An empty `categoryIds` is rejected; a repeated id is rejected — validates AC-02
- [ ] Thresholds 0, 201, 1.5, a repeated value, an empty list and a sixth value are rejected; 1, 200 and
      five valid values pass — validates AC-11, AC-22
- [ ] `normalizeThresholds` returns `[80, 100]` for no input and `[50, 80, 120]` for `[120, 50, 80]` —
      validates AC-09, AC-10
- [ ] The update body with no key, and the update body with `currency`, are rejected — validates AC-15
- [ ] `currentMonthStart` at 2026-10-31T23:30 in `America/Argentina/Buenos_Aires` and at 2026-11-01T01:00Z
      gives `2026-10-01` — validates AC-12
- [ ] `versionInForce` picks September's version for a September month and October's for October —
      validates AC-12
- [ ] An unknown key, a wrong type or a count out of range fails with the 400 `VALIDATION_FAILED` error — validates AC-02, AC-11
- [ ] The error codes `BUDGET_LIMIT_REACHED` (409) and `BUDGET_CATEGORY_KIND_INVALID` (400) map as stated; `pnpm typecheck` accepts the new web message keys —
      validates AC-04, AC-23

**Completion criterion**
The shared and domain tests pass, the domain imports nothing from infrastructure, and `pnpm typecheck`
passes.

## Block 2 — Data model, migration and Drizzle adapters

**Files**
- `apps/api/src/budgets/infrastructure/db/schema.ts` (new) — `budgets`, `budgetVersions`,
  `budgetVersionCategories`, `budgetVersionThresholds`.
- `apps/api/src/budgets/infrastructure/db/foreign-relations.ts` (new) — re-exports `users` and
  `categories`.
- `apps/api/drizzle/0034_budgets.sql` (generated, then hand-edited to add `DEFERRABLE INITIALLY
  DEFERRED` to the category key, which drizzle-kit cannot express), `apps/api/drizzle/meta/*`
  (generated; the snapshot therefore lacks `DEFERRABLE`),
  `apps/api/drizzle/rollback/0034_budgets.down.sql` (new).
- `apps/api/src/budgets/infrastructure/db/drizzle-budget-repository.ts` (new) — the repository, with
  the transaction of D8 and the version writes of D2.
- `apps/api/src/budgets/infrastructure/db/drizzle-category-reader.ts`,
  `drizzle-user-time-zone.ts` (new).
- `apps/api/src/budgets/infrastructure/clock/system-clock.ts` (new).
- `apps/api/test/identity/user-erasure.test.ts` (modified) — registry: add the four tables, policy
  `cascade`, with one seeder each.
- `apps/api/test/deploy/build-output.test.ts` (modified) — the table list gains the four tables.
- `apps/api/test/budgets/migration.test.ts`, `schema-introspection.test.ts`,
  `budget-repository.test.ts`, `category-reader.test.ts` (new; need `TEST_DATABASE_URL`).

**Logic**
Generated with drizzle-kit from the schema file, then the 0034 SQL is hand-edited (the category key
is made deferrable; the snapshot does not record it) and the journal `when` checked against `main`.
`create` opens a transaction, takes `pg_advisory_xact_lock` on the owner, counts the owner's budgets
and inserts the budget, its first version, categories and thresholds, or throws `BudgetLimitReached` at
50. `update` takes the budget's row lock through `scopedTo`, reads the version in force under that lock,
applies the caller's merge function to it, deletes the version of the current month if present (its
children cascade) and inserts the merged one, in one transaction, so two concurrent partial edits
both survive. `listCurrent` and `findById`
return the version in force with its categories and thresholds and compute the covered categories by
joining `categories` on `parent_id` for the selected ids, inside the same owner scope. `delete` removes
the budget row. Any violation of the category key in the repository is rethrown as `ResourceNotFound` (404, D4); no
`catch` swallows anything.

**Data model**
- `budgets`: `id` uuid pk; `owner_id` uuid not null fk `users` on delete cascade; `currency` text not
  null (check `ARS` or `USD`); `created_at`, `updated_at` timestamptz. Unique `(id, owner_id)` (target
  of the child keys); index `(owner_id, created_at, id)`.
- `budget_versions`: `id` uuid pk; `budget_id` uuid not null; `owner_id` uuid not null; `effective_from`
  date not null (check: day of month is 1); `name` text not null (check 1 to 50 characters); `amount`
  bigint not null (check greater than 0); `rollover` boolean not null default false; `created_at`
  timestamptz. Composite fk `(budget_id, owner_id) → budgets(id, owner_id)` on delete cascade. Unique
  `(budget_id, effective_from)`; unique `(id, owner_id)`.
- `budget_version_categories`: `version_id` uuid not null; `owner_id` uuid not null; `category_id` uuid
  not null; `kind` text not null default `expense` (check `expense`). Primary key `(version_id,
  category_id)`. Composite fk `(version_id, owner_id) → budget_versions(id, owner_id)` on delete
  cascade; composite fk `(category_id, owner_id, kind) → categories(id, owner_id, kind)` on delete no
  action, DEFERRABLE INITIALLY DEFERRED; index `(category_id)`.
- `budget_version_thresholds`: `version_id` uuid not null; `owner_id` uuid not null; `percent` smallint
  not null (check 1 to 200). Primary key `(version_id, percent)`. Composite fk `(version_id, owner_id) →
  budget_versions(id, owner_id)` on delete cascade.
- No `real`, `double precision` or `numeric` column anywhere.

**Error handling**
- A constraint violation surfaces as a database error that the repository maps: any violation of the
  category key answers `ResourceNotFound` (404), anything else is rethrown. Deleting a category in use
  is mapped by the categories repository to `CATEGORY_IN_USE` (409).

**Required tests**
- [ ] The migration applies on an empty database and on a copy of `main`'s schema; the rollback script
      is idempotent and removes only the four tables — validates NFR-01 (backstops exist)
- [ ] Introspection: the four tables have 0 `real`, `double precision` or `numeric` columns, `amount`
      is `bigint`, the checks, unique indexes and composite keys above exist, and only the category key is deferrable
      and deferred — validates NFR-01
- [ ] Two concurrent partial edits (name and amount) of one budget both persist
- [ ] The journal `when` of 0034 is greater than 1791760600000
- [ ] Creating a budget with two categories and no thresholds stores one version with thresholds 80 and
      100 and rollover off; the list returns it — validates AC-01, AC-07, AC-09
- [ ] The covered categories of a budget over Food are Food and its children, and a child added later
      appears without an edit — validates AC-06
- [ ] A budget over a category of another user is rejected by the repository's key with an error and
      nothing is stored — validates AC-03
- [ ] A budget over an income category is rejected by the check or the key — validates AC-04
- [ ] An edit in October writes an October version and leaves September's rows byte for byte equal —
      validates AC-12, AC-14
- [ ] Two edits in October leave exactly one October version with the latest values — validates AC-13
- [ ] An edit with a category of another user is rejected and leaves the budget unchanged — validates
      AC-16
- [ ] Reading or deleting a budget of another user returns nothing, as for a missing id — validates
      AC-18, AC-19
- [ ] Deleting a budget removes its versions, categories and thresholds and leaves the categories
      table unchanged — validates AC-17
- [ ] 20 concurrent creates by one user at 40 budgets: exactly 10 succeed and 10 fail with the limit
      error — validates AC-23 (NFR-03)
- [ ] After a delete at 50 budgets, a create succeeds — validates AC-24
- [ ] An amount of 150,000.00 ARS is stored as 15000000 and read back as the same string; the largest
      int64 round-trips — validates AC-21
- [ ] Deleting a category used by a budget fails and the budget stays; deleting the account of a user
      who owns budgets succeeds and removes all four tables' rows — validates AC-17 (D4, D10)
- [ ] Registry: the four tables are registered with policy `cascade` and their seeders insert one real
      row each; the guard that fails on an unregistered table stays green

**Completion criterion**
The adapter, migration and introspection tests pass against PostgreSQL, including the concurrency test
run 20 times without a failure, and `pnpm --filter ./apps/api` typechecks.

## Block 3 — Use cases

**Files**
- `apps/api/src/budgets/application/create-budget.ts`, `list-budgets.ts`, `get-budget.ts`,
  `update-budget.ts`, `delete-budget.ts` (new).
- `apps/api/src/budgets/application/dependencies.ts` (new) — the dependency bundle.
- `apps/api/src/budgets/index.ts` (new) — module barrel.
- `apps/api/test/budgets/fakes.ts`, `apps/api/test/budgets/use-cases.test.ts` (new).

**Logic**
- `CreateBudget`: validates the categories through the `CategoryReader` port (D4), normalizes the
  thresholds, computes the month start from the `Clock` and `UserTimeZone` ports, and hands budget and
  first version to the repository, which enforces the limit (D8).
- `UpdateBudget`: checks the budget exists (404 when missing or foreign), validates a changed category
  set as in create, and asks the repository to write the version of the current month (D2), passing a
  merge function that the repository applies to the version in force under the row lock. An edit that changes nothing still writes the version of the month.
- `ListBudgets`, `GetBudget`: return the version in force with covered categories; a budget whose first
  version is in a future month relative to the caller's zone is shown with its first version.
- `DeleteBudget`: 404 for missing or foreign, otherwise removes it.

**Input validation**
Inputs arrive already validated by the shared contract; the use cases re-check what needs state:
category ownership, kind and archive state, the limit, and the existence of the budget.

**Error handling**
- Missing or foreign budget, unknown or foreign category: `ResourceNotFound` (404).
- Income category: `BudgetCategoryKindInvalid` (400); archived category: `CategoryArchived` (409).
- The 51st budget: `BudgetLimitReached` (409).

**Required tests** *(in-memory fakes)*
- [ ] Creating "Outings" of 150,000.00 ARS over two categories stores it and lists it — validates AC-01
- [ ] A create with no category, a zero amount, an empty name or a bad currency is rejected before any
      write — validates AC-02
- [ ] A create with an unknown or foreign category answers 404 and stores nothing — validates AC-03
- [ ] A create over an income category is rejected with a 400 error — validates AC-04
- [ ] A create over an archived category is rejected with a 409 conflict — validates AC-05
- [ ] Rollover defaults to off and an explicit on is stored and returned — validates AC-07, AC-08
- [ ] Omitted thresholds store 80 and 100; `[120, 50, 80]` is returned as 50, 80, 120 — validates AC-09,
      AC-10
- [ ] The covered set of a budget over a parent includes its children, including one added after
      creation — validates AC-06
- [ ] An amount edit in October (clock set to October, zone Buenos Aires) leaves September's version
      untouched and makes the October values current — validates AC-12
- [ ] An edit of the category set, of the thresholds and of the rollover flag follows the same rule —
      validates AC-14
- [ ] Two edits in the same month leave one version — validates AC-13
- [ ] An edit at 23:30 local on the last day of a month, where UTC is already the next month, writes
      the version of the local month — validates AC-12 (D3)
- [ ] An edit with a foreign category is rejected and leaves the budget unchanged; an edit that sends a
      currency is rejected — validates AC-15, AC-16
- [ ] Deleting removes the budget; deleting or reading or editing a budget of another user answers 404
      — validates AC-17, AC-18
- [ ] The list holds only the caller's budgets — validates AC-19
- [ ] The 50th create passes and the 51st is rejected with a 409 conflict; after a delete a create passes
      again — validates AC-23, AC-24
- [ ] Five thresholds pass and a sixth is rejected — validates AC-22

**Completion criterion**
`use-cases.test.ts` passes with 0 imports from infrastructure and the boundary test stays green.

## Block 4 — Routes and composition root

**Files**
- `apps/api/src/budgets/infrastructure/http/budget-routes.ts`, `budget-presenter.ts` (new).
- `apps/api/src/server.ts` (modified) — mounts `createBudgetRoutes({ db, logger })`.
- `apps/api/src/budgets/index.ts` (modified) — exports the routes factory.
- `apps/api/test/budgets/budget-routes.test.ts`, `budget-flow.test.ts` (new).
- `apps/api/test/deploy/build-output.test.ts` (modified only if the route list is asserted there).

**Logic**
Every route runs `requireSession`, `requireVerifiedEmail` and the shared `validate` middleware with the
schemas of Block 1, obtains an `AccessScope` from the shared policy, and answers with the response
schemas. Audit lines carry the request id, the user id and the budget id, never a name or an amount.

**API contract**
- `POST /budgets` — body `createBudgetRequestSchema` — 201 `budgetResponseSchema`.
- `GET /budgets` — 200 `budgetListResponseSchema`, only the caller's budgets.
- `GET /budgets/:id` — 200 `budgetResponseSchema`; 404 for a missing or foreign budget.
- `PATCH /budgets/:id` — body `updateBudgetRequestSchema` — 200 `budgetResponseSchema`.
- `DELETE /budgets/:id` — 204; 404 for a missing or foreign budget.
- Error codes: 400 `VALIDATION_FAILED`, `BUDGET_CATEGORY_KIND_INVALID`; 401 `UNAUTHENTICATED`; 403
  `EMAIL_NOT_VERIFIED`; 404 `NOT_FOUND`; 409 `BUDGET_LIMIT_REACHED`, `CATEGORY_ARCHIVED`.
- Auth: verified session; ownership resolved per request (D1).

**Input validation**
Params and body through the shared schemas; no route reads `req.body` unvalidated.

**Error handling**
- Typed domain errors reach the existing error middleware; a foreign budget and a missing one give the
  same 404 body.

**Required tests** *(supertest over PostgreSQL)*
- [ ] Create, list, read, edit and delete a budget end to end, with the contract shape and the amount as
      an exact integer string — validates AC-01, AC-17, AC-21
- [ ] Invalid create bodies (no category, zero amount, empty name, bad currency, extra key) answer 400 —
      validates AC-02, AC-15
- [ ] Threshold bodies with 0, 201, a repeat and a sixth value answer 400; five values answer 201 —
      validates AC-11, AC-22
- [ ] A foreign category answers 404 on create and on edit; an income category answers 400; an archived
      one answers 409 — validates AC-03, AC-04, AC-05, AC-16
- [ ] A second user reading, editing or deleting the first user's budget answers 404 with the same body
      as an unknown id, and the budget is unchanged; each user's list holds only their own — validates
      AC-18, AC-19
- [ ] A request with no session answers 401 and no body field of a budget — validates AC-20
- [ ] The edit flow with the clock moved a month: September's version is still stored, October's is
      current — validates AC-12
- [ ] The 51st budget answers 409 `BUDGET_LIMIT_REACHED`; after a delete a create answers 201 —
      validates AC-23, AC-24
- [ ] A subcategory created after the budget appears in `coveredCategoryIds` on the next read —
      validates AC-06
- [ ] No log line contains a budget name or amount — validates the audit rule
- [ ] A second API instance sees a budget created through the first (no process state) — validates the
      stateless rule of `AGENTS.md`

**Completion criterion**
Route and flow tests pass; `pnpm lint`, `pnpm typecheck` and `pnpm test` are green.

## Final verification
- 24 of 24 acceptance criteria of the PRD have at least one passing test, and every input has a
  sad-path test.
- The concurrency test (50-budget limit) passes 20 times in a row.
- `pnpm lint`, `pnpm typecheck`, `pnpm test:coverage` (80% lines, branches and functions over the three
  packages together) and `pnpm audit --prod --audit-level high` pass.
- The migration `when` is greater than the maximum on `main` at merge time, and 0034 is renumbered
  behind the goals migration if 06a merges first (journal idx 34, with 33 skipped).
- The rollback script, run twice, removes the four tables and the 0034 journal row, and the migration
  applies again afterwards.
- No other module's behaviour changed, and no web screen was added (06f).

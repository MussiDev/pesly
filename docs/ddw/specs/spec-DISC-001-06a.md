# Spec DISC-001-06a: Savings Goals API

| Field | Value |
|-------|-------|
| Ticket | DISC-001-06a |
| PRD | docs/ddw/prd/prd-DISC-001-06a.md |
| Tier | FEATURE |
| Date | 2026-10-11 |
| Spec loops | 0 |
| Loops since last human decision | 0 |

## Summary
A new hexagonal API module, `goals`, stores a user's savings goals (name, target amount, ARS or USD, optional
target date, optional linked account) and the manual entries (contributions and withdrawals) of goals that are
not linked. Progress is never stored: for a linked goal it is the current balance of the linked account (opening
balance plus the movement sums, read through a port), for any other goal it is the sum of contributions minus the
sum of withdrawals. From progress the module derives the percentage of the target, the reached and overdue
states and the monthly amount needed, which counts the current month in the user's time zone and rounds up to
the minor unit. Every route is scoped to the owner: another user's goal answers 404. A goal is linked to an
account only when it is created, a withdrawal larger than the progress is rejected under a row lock, and an
account that a goal links to cannot be deleted. The module reaches accounts and users only through ports and
the `foreign-relations` file, and no web screen is built here: the goals screens are DISC-001-06e. Budgets are
DISC-001-06b to 06d.

## Design decisions
- D1: Owner scoping. Goals belong to one user, so the module follows the accounts module: every route resolves a
  scope with `OwnerOrGroupMemberAccessPolicy` and the `DenyAllGroupMembershipReader`, every repository method
  takes the scope first and filters with `scopedTo` in the same statement, and an empty result becomes
  `ResourceNotFound` (404) through `notFoundUnlessAllowed`. A goal id of another user is indistinguishable from
  a missing one (FR-12, AC-15, AC-16).
- D2: Money. `goals.target_amount` and `goal_entries.amount` are `bigint` minor units, mapped to `bigint` in
  TypeScript and to a decimal string in JSON (`minorUnitsStringSchema`). Amounts in requests use the existing
  `movementAmountSchema` (positive, at most 16 digits, at most the int64 bound). There is no `real`, `double
  precision` or `numeric` column, and no float in code or tests (NFR-01). Currency is `ARS` or `USD` (the existing
  currency schema).
- D3: Two tables, both additive. `goals` holds the goal and the optional link; `goal_entries` holds the manual
  entries with `kind` `contribution` or `withdrawal` and a positive amount. An entry has no note and no date of its
  own beyond `created_at`; entries are never edited or deleted one by one (PRD Out of Scope), only with their
  goal.
- D4: The link is set only at creation and never changes (FR-02; parent pending decision 4). It is a composite
  foreign key `(linked_account_id, owner_id) → accounts(id, owner_id)` with `on delete restrict`, reusing the
  existing `accounts_id_owner_unique` target, so the database itself rejects another user's account. Two goals may
  link to the same account. A goal with a link has no entries: contributions and withdrawals on it answer 409
  `GOAL_LINKED_TO_ACCOUNT` (AC-19).
- D5: Progress is derived on read. For unlinked goals one grouped statement sums `case kind when 'contribution'
  then amount else -amount end` per goal over the goals of the scope. For linked goals the `AccountBalances` port
  returns balances for a list of account ids; its adapter reads the opening balances and calls the movements
  module's sums through an injected `AccountMovementSums` function, in chunks of at most 500 ids, like the accounts
  module does, so the list is two statements plus the chunked sums, never one query per goal (NFR-02).
- D6: A withdrawal runs in one transaction: lock the goal row (`select … for update` scoped to the owner), reject a
  linked goal, sum the entries, reject an amount larger than the progress with 409
  `GOAL_WITHDRAWAL_EXCEEDS_PROGRESS` (equal to the progress is allowed), and insert. Contributions take the same
  lock and refuse, with 409 `GOAL_PROGRESS_TOO_LARGE`, a result above 9,999,999,999,999,999 minor units (the
  largest request amount), so the stored sums stay inside int64 (NFR-01). Two concurrent withdrawals therefore
  cannot overdraw a goal (PRD risk).
- D7: Derived fields live in the domain as pure functions of `(target, progress, targetDate, today)`:
  `percentage` is the integer part of `progress × 100 / target` using bigint arithmetic, 0 when progress is
  negative, and not capped at 100; `status` is `reached` when progress is at least the target, otherwise
  `overdue` when a target date exists and is before today, otherwise `active`; `monthsLeft` is `(targetYear −
  currentYear) × 12 + (targetMonth − currentMonth) + 1`; `monthlyAmountNeeded` is `ceil((target − progress) /
  monthsLeft)` for an `active` goal with a target date and `null` otherwise. The date of a goal that is due today
  is not overdue (AC-11 says "passed").
- D8: "Today" and the current month come from the user's stored time zone: a `UserTimeZone` port (adapter reads
  `users.time_zone` and falls back to `America/Argentina/Buenos_Aires` for an invalid value, as the recurring
  module does) and `todayInTimeZone` from `packages/shared` over an injected `Clock` (FR-08, AC-26).
- D9: Edit. `PATCH /goals/:id` changes `name`, `targetAmount` and `targetDate` (nullable to remove it); the
  currency and the link never change. Lowering the target below the progress is allowed and simply makes the goal
  reached. The response recomputes every derived field (AC-13).
- D10: Limit. A user holds at most 100 goals (FR-14). Create runs in a transaction that takes
  `pg_advisory_xact_lock` on a hash of the owner id, counts the goals and inserts, so two concurrent creates
  cannot pass 100. Over the limit the answer is 409 `GOAL_LIMIT_REACHED`.
- D11: Linking validation. Create with `accountId` calls `AccountBalances.findLinkable(scope, accountId)`: no row
  (missing or foreign) answers 404 (AC-18); a different currency answers 409 `GOAL_ACCOUNT_CURRENCY_MISMATCH`
  (AC-03); an archived account answers the existing 409 `ACCOUNT_ARCHIVED`. The composite foreign key is the
  backstop.
- D12: Account deletion (FR-13). The restricting key `goals_account_owner_fk` makes the database refuse to
  delete a linked account. The accounts repository already maps a foreign-key violation by constraint prefix
  (`credit_cards_` to `AccountLinkedToCard`); it gains `goals_` to a new `AccountLinkedToGoal` (409
  `ACCOUNT_LINKED_TO_GOAL`). The account use case is unchanged and the account stays archivable.
- D13: Account erasure (PRD 01f). The user row cascades to goals and to accounts, and the restricting key from
  goals to accounts means the cascade order is not guaranteed, so an ordered step `eraseUserGoals` deletes the
  user's goals (entries go by cascade) before the user, registered in the composition root's
  `beforeUserErased` list, as `eraseUserRecurring` is.
- D14: Migration `0033_savings_goals`: two new tables, additive, no change to existing tables. Its journal `when`
  must exceed the maximum on `main` at merge time (now 1791760600000 for 0032); this ticket uses 1791770000000 and
  the number is renumbered at merge if another migration took 0033. Rollback script
  `0033_savings_goals.down.sql`, idempotent, drops the two tables (destructive for goal data only).
- D15: Ports and boundaries. Ports: `GoalRepository`, `AccountBalances`, `UserTimeZone`, `Clock`. Domain and
  application import nothing from infrastructure and nothing from other modules; infrastructure imports `users`
  and `accounts` only through `infrastructure/db/foreign-relations.ts`. The composition root passes the movements
  module's `createAccountMovements(db)` to the goals routes, as it does for the credit cards.
- D16: Audit lines carry the request id, the user id and the goal id, never a name or an amount. No new runtime
  dependency (`pg_advisory_xact_lock` is plain SQL). No web screen.
- D17: Entry list. `GET /goals/:id/entries` returns the entries newest first (`created_at desc, id desc`), at most
  `limit` rows (default 50, maximum 100), enough for the 06e history without a cursor; paging is added when 06e
  needs it.

## Open questions for the owner
1. A goal links to an account only at creation and cannot be relinked (D4). Alternative: allow changing the link,
   which makes progress jump and leaves manual entries without a meaning.
2. A user holds at most 100 goals (D10); the original PRD only requires 50. Alternative: no upper bound.
3. An account linked to a goal cannot be deleted, only archived (D12). Alternative: unlink the goal on deletion,
   which silently turns a linked goal into an empty manual one.
4. No web screen in this ticket (Summary). Alternative: add a minimal goals list now, which would ship before
   the screens of 06e and without their design.
5. The percentage is not capped at 100 (D7), so an over-funded goal shows 120%. Alternative: cap at 100 and let
   the screen show the surplus from the amounts.

## Coverage: PRD → blocks
| Requirement | Covered by |
|---|---|
| FR-01 | Block 1, Block 2, Block 3, Block 4, Block 5 |
| FR-02 | Block 1, Block 2, Block 3, Block 4, Block 5 |
| FR-03 | Block 3, Block 4, Block 5 |
| FR-04 | Block 1, Block 2, Block 3, Block 4, Block 5 |
| FR-05 | Block 1, Block 2, Block 3, Block 4, Block 5 |
| FR-06 | Block 3, Block 4, Block 5 |
| FR-07 | Block 1, Block 3, Block 5 |
| FR-08 | Block 3, Block 5 |
| FR-09 | Block 3, Block 5 |
| FR-10 | Block 1, Block 3, Block 4, Block 5 |
| FR-11 | Block 2, Block 3, Block 4, Block 5 |
| FR-12 | Block 3, Block 4, Block 5 |
| FR-13 | Block 2, Block 6 |
| FR-14 | Block 3, Block 4, Block 5 |
| NFR-01 | Block 1, Block 2, Block 3, Block 4 |
| NFR-02 | Block 4, Block 7 |
| NFR-03 | Block 4, Block 7 |

## Dependencies between blocks
Block 1 first (shared contract). Then 2 and 3 are independent of each other (schema and migration with the
erasure step; domain and use cases with in-memory fakes). Block 4 needs 2 and 3 (adapters). Block 5 needs 4
(routes and composition). Block 6 needs only 2 (the account deletion guard). Block 7 needs 5 (performance and
flow).

## Block 1 — Shared contract and error codes

**Files**
- `packages/shared/src/goals/goal.ts` (new) — Zod schemas and types of the contract.
- `packages/shared/src/errors.ts` (modified) — codes `GOAL_ACCOUNT_CURRENCY_MISMATCH`,
  `GOAL_LINKED_TO_ACCOUNT`, `GOAL_WITHDRAWAL_EXCEEDS_PROGRESS`, `GOAL_PROGRESS_TOO_LARGE`,
  `GOAL_LIMIT_REACHED`, `ACCOUNT_LINKED_TO_GOAL`.
- `packages/shared/src/index.ts` (modified) — exports.
- `apps/api/src/shared/http/error-handler.ts` (modified) — the six codes map to 409.
- `apps/web/src/lib/api-client.ts` (modified) — message keys for the six codes.
- `apps/web/messages/en.json`, `apps/web/messages/es.json` (modified) — `errors.goalAccountCurrencyMismatch`,
  `errors.goalLinkedToAccount`, `errors.goalWithdrawalExceedsProgress`, `errors.goalProgressTooLarge`,
  `errors.goalLimitReached`, `errors.accountLinkedToGoal`.
- `packages/shared/test/goal-schemas.test.ts` (new).

**Logic**
Contract only; the routes of Block 5 serve it.

**Shared types** *(no route here)*
- `goalNameSchema`: string, NFC, trimmed, 1 to 80 characters, no control or format characters
  (`GOAL_NAME_MAX_LENGTH = 80`).
- `createGoalRequestSchema`: `{ name, targetAmount: movementAmountSchema, currency: ARS or USD, targetDate?:
  calendar date, accountId?: uuid }`, strict.
- `updateGoalRequestSchema`: `{ name?, targetAmount?, targetDate?: calendar date or null }`, strict, at least one
  key.
- `createGoalEntryRequestSchema`: `{ kind: contribution or withdrawal, amount: movementAmountSchema }`, strict.
- `goalIdParamsSchema` `{ id: uuid }`; `listGoalEntriesQuerySchema` `{ limit?: integer 1 to 100 }`.
- Responses: `goalResponseSchema` `{ id, name, targetAmount, currency, targetDate: string | null, accountId:
  string | null, progress, percentage: integer, status: active, reached or overdue, monthlyAmountNeeded: string |
  null, createdAt }` with money as minor-unit strings; `listGoalsResponseSchema` `{ goals }`;
  `goalEntryResponseSchema` `{ id, kind, amount, createdAt }`; `recordGoalEntryResponseSchema` `{ entry, goal }`;
  `listGoalEntriesResponseSchema` `{ entries }`.

**Input validation**
Strict objects, no extra keys; amounts positive integer strings; the target date a real calendar date; names as
above.

**Error handling**
- Unknown keys, wrong types, lengths or an empty update body — 400 `VALIDATION_FAILED` through the shared
  middleware.

**Required tests**
- [ ] A name of 81 characters is rejected; one of 80 passes — validates AC-17
- [ ] An empty or whitespace-only name is rejected on create and on update — validates AC-17, AC-22
- [ ] A target amount of `0`, a negative one, `1.5` or a string with a sign is rejected — validates AC-02, AC-22
- [ ] An entry amount of `0` or a negative one and an unknown kind are rejected — validates AC-20
- [ ] An update body with no key and a create body with an unknown key (`progress`) are rejected — validates AC-13
- [ ] A target date that is not a real calendar date, such as `2026-02-30`, is rejected — validates AC-01
- [ ] Every new error code maps to 409 and has a web message key in English and Spanish — validates AC-03,
      AC-07, AC-19, AC-23, AC-24

**Completion criterion**
The shared tests pass and `pnpm typecheck` accepts the new message keys on the web side.

## Block 2 — Schema, migration and erasure step

**Files**
- `apps/api/src/goals/infrastructure/db/schema.ts` (new) — `goals` and `goalEntries`.
- `apps/api/src/goals/infrastructure/db/foreign-relations.ts` (new) — re-exports `users` and `accounts`.
- `apps/api/src/goals/infrastructure/db/erase-user-goals.ts` (new) — the step of D13.
- `apps/api/drizzle/0033_savings_goals.sql` (generated), `apps/api/drizzle/meta/*` (generated),
  `apps/api/drizzle/rollback/0033_savings_goals.down.sql` (new).
- `apps/api/test/goals/migration.test.ts`, `apps/api/test/goals/schema-introspection.test.ts`,
  `apps/api/test/goals/erasure-step.test.ts` (new).
- `apps/api/test/identity/user-erasure.test.ts` (modified) — registry entries `goals` (policy `erase-step`,
  constraint `goals_account_owner_fk`) and `goal_entries` (`cascade`), the step added to the ordered-steps case.
- `apps/api/test/deploy/build-output.test.ts` (modified) — `goal_entries` and `goals` added to the table list.

**Logic**
Generated with drizzle-kit from the schema file, then the journal `when` checked against `main`. The erasure step
runs one `delete from goals where owner_id = $1` on the given transaction handle; `goal_entries` go by cascade.

**Data model**
- `goals`: `id` uuid pk; `owner_id` uuid not null fk `users` on delete cascade; `name` text not null (check 1 to
  80 characters); `target_amount` bigint not null (check `> 0`); `currency` text not null (check `ARS` or `USD`);
  `target_date` date null; `linked_account_id` uuid null; `created_at`, `updated_at` timestamptz not null.
  Composite fk `goals_account_owner_fk` `(linked_account_id, owner_id) → accounts(id, owner_id)` on delete
  restrict (a null `linked_account_id` skips it). Unique `(id, owner_id)` (target of the entries key); index
  `(owner_id, created_at, id)`; index `(linked_account_id)` where not null.
- `goal_entries`: `id` uuid pk; `goal_id` uuid not null; `owner_id` uuid not null fk `users` on delete cascade;
  `kind` text not null (check `contribution` or `withdrawal`); `amount` bigint not null (check `> 0`);
  `created_at` timestamptz not null. Composite fk `(goal_id, owner_id) → goals(id, owner_id)` on delete
  cascade; index `(goal_id, created_at, id)`; index `(owner_id)`.

**Error handling**
- A constraint violation surfaces as a database error that the repository of Block 4 maps.

**Required tests**
- [ ] The migration applies on an empty database and on a copy of `main`'s schema; the rollback script is
      idempotent and removes only the two tables — validates NFR-01
- [ ] Introspection: the two tables have 0 `real`, `double precision` or `numeric` columns, the checks and
      indexes above exist, and the key to accounts restricts on delete — validates NFR-01, AC-23
- [ ] A goal with a target amount of 0, a currency other than ARS and USD, or an empty name is rejected by the
      checks — validates AC-02, AC-17
- [ ] A goal that links to an account of another user is rejected by the composite foreign key (backstop) —
      validates AC-18
- [ ] An entry of amount 0 and an entry with an unknown kind are rejected by the checks — validates AC-20
- [ ] Deleting a goal removes its entries and no row of `accounts` or `movements` changes — validates AC-14
- [ ] Deleting an account that a goal links to fails with a foreign-key error and keeps both rows — validates AC-23
- [ ] Deleting a user who owns a linked goal and its account succeeds through `eraseUserGoals`, and the registry
      guard of the erasure test passes with both tables registered — validates FR-11 (account erasure, D13)
- [ ] The journal `when` is greater than 1791760600000

**Completion criterion**
The migration, introspection and erasure tests pass, the registry guard of `user-erasure.test.ts` is green, and
`pnpm --filter ./apps/api` typechecks.

## Block 3 — Domain and use cases

**Files**
- `apps/api/src/goals/domain/goal.ts`, `goal-progress.ts`, `errors.ts` (new) — goal type, constants (`MAX_GOALS =
  100`), the pure derivations of D7, typed errors.
- `apps/api/src/goals/application/ports/goal-repository.ts`, `account-balances.ts`, `user-time-zone.ts`,
  `clock.ts` (new).
- `apps/api/src/goals/application/goal-view.ts` (new) — builds the derived view from a goal, its progress and
  today.
- `apps/api/src/goals/application/create-goal.ts`, `list-goals.ts`, `get-goal.ts`, `update-goal.ts`,
  `delete-goal.ts`, `record-goal-entry.ts`, `list-goal-entries.ts` (new).
- `apps/api/src/goals/index.ts` (new) — module barrel.
- `apps/api/test/goals/fakes.ts`, `apps/api/test/goals/goal-progress.test.ts`,
  `apps/api/test/goals/use-cases.test.ts` (new).

**Logic**
`CreateGoal` validates the link with `AccountBalances.findLinkable` (D11) and hands the goal to the repository,
which enforces the limit (D10). `ListGoals` and `GetGoal` read the goals of the scope, their progress (entries
sum for unlinked goals, account balance for linked ones, D5) and today from `UserTimeZone` and `Clock`, and
return the view. `UpdateGoal` changes only the three fields (D9). `DeleteGoal` removes the goal and nothing
else. `RecordGoalEntry` refuses a linked goal and asks the repository to apply D6 atomically. All derivations
are pure functions of bigint and a calendar date string; no `number` carries money.

**Input validation**
Inputs arrive already validated by the Block 1 contract; the use cases re-check what needs state (ownership of the
goal and the account, currency, archive, linked, limit, progress).

**Error handling**
- Missing or foreign goal or account — `ResourceNotFound` (404).
- Currency differs from the account — `GOAL_ACCOUNT_CURRENCY_MISMATCH`; archived account — `ACCOUNT_ARCHIVED`.
- Entry on a linked goal — `GOAL_LINKED_TO_ACCOUNT`; withdrawal above progress —
  `GOAL_WITHDRAWAL_EXCEEDS_PROGRESS`; progress above the largest amount — `GOAL_PROGRESS_TOO_LARGE`.
- The 101st goal — `GOAL_LIMIT_REACHED`.

**Required tests** *(in-memory fakes)*
- [ ] Creating "Vacations", 2,000.00 USD, target date 2026-12-31 stores it and lists it — validates AC-01
- [ ] A target amount of 0 or less and an empty name are rejected — validates AC-02, AC-17
- [ ] Linking to an account in another currency is a 409 conflict, and to a foreign or missing account a 404
      with no goal created — validates AC-03, AC-18
- [ ] A linked goal's progress follows the account balance: 500.00 then 700.00 USD — validates AC-04
- [ ] A negative linked balance shows as progress and 0% — validates AC-21
- [ ] A contribution of 200.00 USD raises progress by 200.00 and changes no account balance — validates AC-05
- [ ] A withdrawal of 50.00 USD from 200.00 leaves 150.00; a withdrawal of 200.00 USD leaves 0 — validates AC-06
- [ ] A withdrawal above progress is rejected with a 409 conflict and records nothing — validates AC-07
- [ ] Contributions 300.00 and 200.00 and a withdrawal of 100.00 give 400.00 — validates AC-08
- [ ] A target of 2,000.00 with progress of 500.00 shows 25% and the percentage is an integer floor —
      validates AC-09
- [ ] On 2026-10-15 with 1,500.00 USD remaining and target date 2026-12-31 the monthly amount is 500.00 —
      validates AC-10
- [ ] A goal whose target date is yesterday and is not reached is `overdue` with no monthly amount; one due
      today is not overdue — validates AC-11
- [ ] Progress equal to or above the target gives `reached` and no monthly amount — validates AC-12
- [ ] Editing the name, target and date persists and recomputes the percentage and the monthly amount; an empty
      name or a target of 0 is rejected and leaves the goal unchanged — validates AC-13, AC-22
- [ ] Deleting a goal removes it and its entries and calls no account port — validates AC-14
- [ ] A contribution or a withdrawal on a linked goal is a 409 conflict and records nothing — validates AC-19
- [ ] 1,000.00 USD remaining over 3 months gives 333.34 (rounded up) — validates AC-25
- [ ] At 22:30 on 2026-10-31 in `America/Argentina/Buenos_Aires` (01:30 on 2026-11-01 UTC) the same goal needs
      500.00, counting October — validates AC-26
- [ ] Any use case on another user's goal answers 404 and changes nothing; the list holds only the caller's
      goals — validates AC-15, AC-16
- [ ] The 101st goal is rejected with a 409 conflict — validates AC-24
- [ ] A contribution that would push progress above 9,999,999,999,999,999 minor units is a 409 conflict —
      validates NFR-01

**Completion criterion**
`use-cases.test.ts` and `goal-progress.test.ts` pass with 0 imports from infrastructure and the boundary test
(`architecture-boundaries.test.ts`) stays green.

## Block 4 — Drizzle adapters

**Files**
- `apps/api/src/goals/infrastructure/db/drizzle-goal-repository.ts` (new) — the repository over the two tables,
  with the transactions of D6 and D10.
- `apps/api/src/goals/infrastructure/db/drizzle-account-balances.ts` (new) — `findLinkable` and `balancesOf`
  (D5), over an injected `AccountMovementSums` function.
- `apps/api/src/goals/infrastructure/db/drizzle-user-time-zone.ts` (new) — D8.
- `apps/api/src/goals/infrastructure/system-clock.ts` (new).
- `apps/api/test/goals/goal-repository.test.ts`, `account-balances.test.ts`, `user-time-zone.test.ts` (new;
  need `TEST_DATABASE_URL`).

**Logic**
`create` takes the advisory lock, counts and inserts in one transaction (D10). `recordEntry` locks the goal row,
rejects a linked goal, sums the entries, applies the withdrawal and contribution rules and inserts (D6).
`progressOf` runs one grouped statement for the unlinked goals of the scope. `balancesOf` reads the opening
balances in one statement and the movement sums in chunks of 500 ids. Foreign-key and check violations map to the
typed errors; no `catch` swallows anything and an unknown error is rethrown.

**Data model**
Same tables as Block 2, with the same constraints: `goals.target_amount` and `goal_entries.amount` bigint and
check `> 0`; `goals.name` check 1 to 80 characters; `goals.currency` check `ARS` or `USD`;
`goal_entries.kind` check `contribution` or `withdrawal`; composite key `goals_account_owner_fk` restrict;
composite key from entries to goals cascade; indexes unchanged.

**Error handling**
- A foreign-key violation on `goals_account_owner_fk` at insert — `ResourceNotFound`; anything else is rethrown.

**Required tests**
- [ ] Two concurrent withdrawals of 80.00 from a goal with 100.00: exactly one succeeds and the other is a 409
      conflict — validates AC-07 (D6)
- [ ] Two concurrent creates of the 100th goal: exactly one succeeds — validates AC-24 (D10)
- [ ] A withdrawal equal to the progress succeeds and leaves 0; one cent more is a conflict — validates AC-06,
      AC-07
- [ ] The grouped progress of 3 goals with mixed entries matches the sum computed by hand — validates AC-08
- [ ] The balance of a linked account is its opening balance plus its movement sums, including a transfer into
      it, and follows a new movement — validates AC-04
- [ ] `findLinkable` returns nothing for another user's account and for a missing one, and the archived flag for
      an archived one — validates AC-18
- [ ] A list of 1,200 linked goals' account ids is read in chunks of at most 500 — validates NFR-02
- [ ] Every repository method returns nothing or no rows for another owner's ids — validates AC-15, AC-16
- [ ] Deleting a goal removes its entries and leaves every account balance unchanged — validates AC-14
- [ ] A goal with 1,000 entries returns its progress from one statement — validates NFR-03
- [ ] The time zone adapter returns the stored zone, falls back for an invalid value and fails closed for a
      missing user — validates AC-26

**Completion criterion**
The adapter tests pass against PostgreSQL, including the two concurrency tests, run 20 times without a failure.

## Block 5 — Routes and composition root

**Files**
- `apps/api/src/goals/infrastructure/http/goal-routes.ts`, `goal-presenter.ts` (new).
- `apps/api/src/goals/index.ts` (modified) — exports the routes factory and `eraseUserGoals`.
- `apps/api/src/server.ts` (modified) — mounts `createGoalRoutes({ db, logger, movements:
  createAccountMovements(db) })` and puts `eraseUserGoals` in `beforeUserErased` after `eraseUserRecurring`.
- `apps/api/test/movements/erasure-step.test.ts` (modified) — the composition-root regex lists
  `eraseUserGoals`.
- `apps/api/test/goals/goal-routes.test.ts`, `goal-flow.test.ts` (new).

**Logic**
Every route runs `requireSession`, `requireVerifiedEmail` and the shared `validate` middleware with the schemas of
Block 1, resolves a scope (D1) and answers with the response schemas through the presenter. Audit lines carry the
request id, the user id and the goal id, never a name or an amount (D16).

**API contract**
- `POST /goals` — body `createGoalRequestSchema` — 201 `goalResponseSchema`.
- `GET /goals` — 200 `listGoalsResponseSchema`, only the caller's goals, oldest first.
- `GET /goals/:id` — 200 `goalResponseSchema`; 404 for another user's goal.
- `PATCH /goals/:id` — body `updateGoalRequestSchema` — 200 `goalResponseSchema`.
- `DELETE /goals/:id` — 204.
- `POST /goals/:id/entries` — body `createGoalEntryRequestSchema` — 201 `recordGoalEntryResponseSchema`.
- `GET /goals/:id/entries` — query `listGoalEntriesQuerySchema` — 200 `listGoalEntriesResponseSchema`.
- Error codes: 400 `VALIDATION_FAILED`; 401; 404 `NOT_FOUND`; 409 `GOAL_ACCOUNT_CURRENCY_MISMATCH`,
  `ACCOUNT_ARCHIVED`, `GOAL_LINKED_TO_ACCOUNT`, `GOAL_WITHDRAWAL_EXCEEDS_PROGRESS`, `GOAL_PROGRESS_TOO_LARGE`,
  `GOAL_LIMIT_REACHED`.
- Auth: verified session; ownership resolved per request (D1).

**Input validation**
Params, query and body through the shared schemas; no route reads `req.body` unvalidated.

**Error handling**
- Typed domain errors reach the existing error middleware; another user's goal and a missing goal give the same
  404 body.

**Required tests** *(supertest over PostgreSQL)*
- [ ] Create, list and read a goal end to end, with progress, percentage and monthly amount in the response —
      validates AC-01, AC-09, AC-10
- [ ] Invalid create bodies (target 0, empty name, unknown key, bad date) answer 400 — validates AC-02, AC-17
- [ ] Linking to an account in another currency answers 409, to another user's account 404 — validates AC-03,
      AC-18
- [ ] A linked goal shows 500.00 then 700.00 USD after a movement is recorded on its account, and its entries
      endpoints answer 409 — validates AC-04, AC-19
- [ ] Contribute 200.00, withdraw 50.00, a withdrawal of 200.00 answers 409; amounts of 0 answer 400; the
      account balances do not change — validates AC-05, AC-06, AC-07, AC-20
- [ ] The goal reaches `reached` at the target and shows `overdue` after its date with a clock moved —
      validates AC-11, AC-12
- [ ] Edit then read recomputes the percentage and the monthly amount; an invalid edit answers 400 and changes
      nothing — validates AC-13, AC-22
- [ ] Delete answers 204, the goal and its entries are gone and the account balance is unchanged — validates
      AC-14
- [ ] Every goal route answers 404 for another user's goal, with the same body as for an unknown id; the list
      holds only the caller's goals — validates AC-15, AC-16
- [ ] The 101st goal answers 409 — validates AC-24
- [ ] No response carries a float or a number for money, and no log line contains a goal name or an amount —
      validates NFR-01
- [ ] A second API instance sees a goal created through the first (no process state) — validates the stateless
      rule of `AGENTS.md`
- [ ] The composition-root test finds `createGoalRoutes` and `eraseUserGoals` in `server.ts` — validates D13

**Completion criterion**
Route and flow tests pass; `pnpm lint`, `pnpm typecheck` and `pnpm test` are green.

## Block 6 — Account deletion guard

**Files**
- `apps/api/src/accounts/domain/errors.ts` (modified) — `AccountLinkedToGoal` (409 `ACCOUNT_LINKED_TO_GOAL`).
- `apps/api/src/accounts/infrastructure/db/drizzle-account-repository.ts` (modified) — a foreign-key violation
  whose constraint starts with `goals_` maps to `AccountLinkedToGoal` (D12).
- `apps/api/test/accounts/account-use-cases.test.ts`, `apps/api/test/accounts/account-routes.test.ts`
  (modified) — the cases below.

**Logic**
The existing pre-checks run first (card link, movements); the database key is what refuses a goal link, so no
race can delete a linked account. Archiving a linked account stays allowed.

**Error handling**
- An account linked to a goal — `AccountLinkedToGoal` (409), row kept; a card link and movements keep their
  codes.

**Required tests**
- [ ] Deleting an account that a goal links to answers 409 `ACCOUNT_LINKED_TO_GOAL`, keeps the account and the
      goal — validates AC-23
- [ ] After the goal is deleted the same account can be deleted — validates AC-14, AC-23
- [ ] An account linked to a card keeps answering `ACCOUNT_LINKED_TO_CARD`, and one with movements
      `ACCOUNT_HAS_MOVEMENTS` — validates AC-23 (no regression)
- [ ] Archiving a linked account succeeds and the goal still shows the account balance — validates AC-04, AC-23

**Completion criterion**
The accounts tests pass and the new code has its English and Spanish messages from Block 1.

## Block 7 — Performance and end-to-end flow

**Files**
- `apps/api/test/perf/goals-list.perf.test.ts` (new) — uses `movements-seed.ts`.
- `apps/api/test/goals/no-float-money.test.ts` (new).

**Logic**
Seeds one user with 50 goals linked to accounts (FR-03, FR-07, FR-14), 100,000 movements spread over them and
1,000 entries on each of 5 unlinked goals (FR-06), then times the list route.

**Error handling**
- A failed seed or a request that answers anything but 200 fails the test; no timing is accepted from a failed
  request.

**Required tests**
- [ ] `GET /goals` answers in < 500 ms at p95 over at least 30 requests for 50 linked goals and 100,000
      movements — validates NFR-02
- [ ] A user with 50 goals, one of them with 1,000 entries, lists and reads every goal correctly — validates
      NFR-03
- [ ] No source file of the module and no test of it uses `parseFloat`, `Number(` over money, `toFixed` or a
      float column; an invalid float input such as `10.5` is rejected with a 400 error — validates NFR-01

**Completion criterion**
`pnpm test:perf` and the no-float test pass.

## Final verification
- 26 of 26 acceptance criteria of the PRD have at least one passing test, and every input has a sad-path test.
- The two concurrency tests (concurrent withdrawals, the 100th goal) pass 20 times in a row.
- `pnpm lint`, `pnpm typecheck`, `pnpm test:coverage` (80% lines, branches and functions over the three packages
  together) and `pnpm audit --prod --audit-level high` pass.
- The migration `when` is greater than the maximum on `main` at merge time, and the number is renumbered if
  0033 was taken.
- The user-erasure registry guard is green with both tables registered, and no web screen was added (open
  question 4).

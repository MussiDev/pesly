# Spec DISC-001-06d: Budget Alerts

| Field | Value |
|-------|-------|
| Ticket | DISC-001-06d |
| PRD | docs/ddw/prd/prd-DISC-001-06d.md |
| Tier | FEATURE |
| Date | 2026-10-11 |
| Spec loops | 0 |
| Loops since last human decision | 0 |

## Summary
After a user creates or edits an expense, the system evaluates the budgets that cover its category and
publishes an in-app notice the first time in a month that a budget's spending reaches each of its
thresholds. The movements module defines a port, `ExpenseSavedListener`, and calls it after the
transaction of the movement has committed, from the `CreateMovement` and `UpdateMovement` use cases,
which every recording path already goes through (manual, device, recurring automatic recording and
credit card installments). The budgets module implements the port: `EvaluateBudgetAlerts` reuses the
06c computation for the current month, filtered to the budgets that cover the category, and asks a store
to record, for every threshold at or below the percentage used, an alert mark. A mark is inserted with
`ON CONFLICT DO NOTHING`, and a notice of the new kind `budget_alert` is inserted in the same
transaction only for a mark that was newly inserted, so a concurrent save cannot alert twice. The
evaluation is state-based, so a crossing that was missed is caught up by the next expense. It is best
effort: it is awaited inline with a fixed time bound and any failure is logged, never raised to the
caller. One migration, 0036, adds the table `budget_alert_marks` and widens the notice kind check. No
screen, no push notification and no change to the group write path are part of this ticket.

## Design decisions
- D1: Port owned by the consumer of the event (FR-02). `apps/api/src/movements/application/ports/
  expense-saved-listener.ts` declares `ExpenseSavedListener.afterExpenseSaved(scope, { categoryId,
  occurredAt })`. The movements module imports nothing from budgets; the budgets module implements the
  port and imports only its type, the same direction the `notices` module follows for the recurring
  ports. `CreateMovement` and `UpdateMovement` take an optional `expenseSaved` hook in their
  dependencies and call it after `movements.insert` or `movements.update` returned (the repository runs
  its own transaction, so a returned row is a committed row), only when the stored movement has type
  `expense`. A deletion, an income, a transfer and an exchange never call it. `RecordManualMovement`
  and `RecordDeviceMovement` both execute `CreateMovement`, so they need no change: a device replay
  returns the stored movement before `CreateMovement` runs and never evaluates again.
- D2: Paths that reach it (FR-02). Wired: `POST /movements` and `PUT /movements/:id`
  (`movement-routes.ts`), and `buildRecorder` of `drizzle-expense-recorder.ts`, which serves the credit
  card installments recorder (server) and the recurring recorder (server and worker). Not wired, by
  design: the automatic debit recorder and the statement payment recorder create transfers and
  exchanges only, and the group payer movement recorder (05b) creates the payer movement of a group
  expense, which 06c already leaves out of personal spending; none of the three passes the hook, so
  they cannot evaluate (AC-08, AC-20).
- D3: Best effort, inline, bounded (FR-06, NFR-01). `BestEffortExpenseSavedHook` (movements
  application) wraps the listener: it awaits `afterExpenseSaved` for at most 2,000 ms
  (`EXPENSE_SAVED_TIMEOUT_MS`), clears its timer, and never throws. On an error or on the time bound it
  calls the injected `reportFailure(error)`. After a timeout the evaluation keeps running and either
  completes (the notice still appears, within the 5 s of NFR-01 in practice) or fails and is reported
  by a rejection handler attached to the same promise, so no rejection is unhandled. Why inline and not
  fire-and-forget: a detached task is lost when the process stops, a test cannot await it, and an
  in-memory queue breaks the stateless API rule of `AGENTS.md`; why not a polling worker: parent
  decision 2. Inline await adds the evaluation time to the response, which NFR-02 bounds at 100 ms at
  p95 and the 2,000 ms bound caps in the worst case. Needs the owner's confirmation.
- D4: What is logged (FR-06). `reportFailure` is wired to `logger.error` with `{ errorName, errorCode,
  userId }` taken from the error, never the error object itself: a database driver error carries the
  statement and its parameters, which would include the budget name inside the notice text. No log
  line holds a name, a category, an amount or a threshold.
- D5: Evaluation (FR-01, FR-03, FR-04). `EvaluateBudgetAlerts.execute(scope, event)` reads the user's
  zone through `UserTimeZone`, takes the month of `event.occurredAt` and the current month with
  `todayInTimeZone` and the `Clock` (never the server zone), and returns when the two differ: only the
  current month alerts, so a back-dated expense of a past month and an expense dated in a future month
  publish nothing. Otherwise it calls `computeSpending(deps, scope, currentMonth, undefined,
  categoryId)`, the 06c computation with one new optional filter, and for every returned budget takes
  `crossedThresholds(thresholds, percentUsed)`. `percentUsed` is the 06c value: spending times 100
  divided by `available` (amount plus rollover) in `bigint`, rounded down, so threshold N is crossed
  exactly when `percentUsed` is at least N. Budgets with no crossed threshold are dropped, and the rest
  go to the store in one call. State-based means no comparison with the spending before the expense: a
  threshold with no mark and a percentage at or above it is published, whichever expense got it there.
- D6: Filter of `computeSpending` (NFR-02). A fifth optional parameter `categoryId` keeps only the
  budgets whose covered categories for the month contain it, before the category union of the
  personal read is built, so the two aggregated statements of 06c read only those categories and the
  previous month is read only when one of those budgets has rollover on. The list and by-id use cases of
  06c pass nothing and behave as before.
- D7: Marks and notices in one transaction (FR-04, FR-07). `BudgetAlertStore.publish(scope, crossings)`
  is implemented by `DrizzleBudgetAlertStore` in one `db.transaction`: read the owner's language from
  `users` by id; insert every `(budget_id, owner_id, month, threshold)` with `ON CONFLICT DO NOTHING`
  returning the new rows; insert one notice per returned row with `kind = 'budget_alert'`,
  `payment_id` = the mark id, `due_date` = the first day of the month and the rendered text, with
  `ON CONFLICT DO NOTHING` on the existing notice unique key as a second guard. If the notice insert
  fails the marks roll back with it, so a threshold is never marked without its notice and a failed
  attempt retries at the next expense. Returns how many notices were created. Concurrent saves race on
  the unique key of the marks: exactly one insert returns the row (AC-13).
- D8: Text rendering through injection (FR-05). The budgets module must not import the notices domain,
  so the store receives `renderText({ language, budgetName, threshold })` from the composition root,
  which passes `renderBudgetAlertText` exported by `apps/api/src/notices/index.ts`. That function calls
  `renderNoticeText` with `kind: 'budget_alert'`, the new optional `threshold` and the month start as
  `dueDate`. Text: "Outings reached 80% of its budget" and "Outings alcanzó el 80% de su presupuesto";
  the name is cut at `NOTICE_NAME_MAX_LENGTH` (80) by the existing rule, so the text stays within the
  existing check of 1 to 300 characters. The function receives no amount and no account name, so none
  can reach the stored text.
- D9: New notice kind (FR-05). `NOTICE_KINDS` of `packages/shared` gains `budget_alert`; the schema type
  and `notices_kind_check` of the notices table gain it in migration 0036. `payment_id` is the subject
  id, here the mark id, with no foreign key, as for `card_statement_due`. The notices list already
  renders `notice.text` and never branches on the kind, so the web list needs no new component, string
  or icon; a web test pins that a `budget_alert` notice renders and is marked read like the others.
- D10: Marks table (FR-04, FR-07). `budget_alert_marks`: `id uuid` primary key, `budget_id uuid` and
  `owner_id uuid` with a composite foreign key to `budgets (id, owner_id)` `on delete cascade` (the
  same owner backstop as the 06b children), `month date` (the first day), `threshold smallint`,
  `created_at timestamptz`; unique `(budget_id, month, threshold)`; checks that `threshold` is between
  1 and 200 (the range of 06b) and that `month` is the first day of a month. The `owner_id` column is an
  addition to the columns the design named, for the composite key; it needs the owner's confirmation.
  Deleting a budget cascades its marks (AC-22); a notice already published stays, as history.
- D11: Budget edits (FR-07). Marks are never updated or removed by an edit, so a lowered amount or a
  changed threshold set alerts only the thresholds with no mark, at the next evaluation. Creating or
  editing a budget does not evaluate (out of scope).
- D12: Migration 0036 (NFR-04). `0036_budget_alert_marks`: create the table and its constraints, then
  `notices_kind_check` dropped and re-added with the five kinds. Additive, no data change. Journal
  `idx` 36, `when` 1791800000000 (the maximum on this branch is 1791790000000 for 0035), and it must
  exceed the maximum on `main` at merge time per the Drizzle merge rule. Rollback script
  `apps/api/drizzle/rollback/0036_budget_alert_marks.down.sql`, idempotent: deletes the `budget_alert`
  notices (the restored check would refuse them), restores the four-kind check, drops the table, and
  deletes the journal row by its `created_at`, guarded by `to_regclass` as the rollback of 0032 is. It
  is applied before the rollback of 0035 (newest `when` first).
- D13: Owner scope (FR-06). The evaluator and the store take the `AccessScope` of the saved movement and
  use its user id for every read and write: the version reader uses `scopedTo`, the spending reads
  filter by the user id, the marks and notices carry that id, and the composite key rejects a mark
  whose budget belongs to another user. Another user's budget over the same category is never read.
- D14: Money and dependencies (NFR-03, NFR-04). `bigint` only, percent by `bigint` division, no
  `Number`, `parseFloat` or `toFixed` in the feature; a source scan test enforces it as in 06c. No new
  runtime dependency. Domain and application import nothing from infrastructure
  (`architecture-boundaries.test.ts`).

## Open questions for the owner
1. State-based and current-month-only evaluation (D5): a missed crossing is caught up by the next
   expense, and a back-dated expense of a past month never alerts. Alternative: delta-based, which
   loses a crossing whenever one evaluation fails.
2. Inline await with a 2,000 ms bound (D3). Alternative: fire-and-forget, which can lose the alert
   when the process stops.
3. Limitation: group expense shares counted by 06c can cross a threshold, but the group write path
   (05b) is not changed, so the alert appears at the next personal expense in the category, and a budget
   that is created or lowered alerts at the next expense, not at the edit (D2, D11). Alternative:
   evaluate from the group write path and from the budget write path in a later ticket.
4. Once per threshold per budget per month, even when the spending falls and crosses again (D7, D10).
   Alternative: re-arm below the threshold.
5. The marks table carries `owner_id` for the composite key (D10).
6. The 100 ms p95 target of NFR-02 is a proposal; if the benchmark cannot meet it with 50 budgets
   covering one category, Block 5 reports the measured value instead of loosening the test.

## Coverage: PRD → blocks
| Requirement | Covered by |
|---|---|
| FR-01 | Block 3, Block 5 |
| FR-02 | Block 4, Block 5 |
| FR-03 | Block 3, Block 5 |
| FR-04 | Block 2, Block 3, Block 5 |
| FR-05 | Block 1, Block 3, Block 5 |
| FR-06 | Block 3, Block 4, Block 5 |
| FR-07 | Block 2, Block 3, Block 5 |
| NFR-01 | Block 5 |
| NFR-02 | Block 3 (filter), Block 5 (benchmark) |
| NFR-03 | Block 3, Block 5 |
| NFR-04 | Block 2, Block 5 |

## Dependencies between blocks
Blocks 1 and 2 touch disjoint files (Block 1: the shared package, the notice text and the web test;
Block 2: the two schema files, the migration and the migration tests) and can run in parallel. Blocks 3
and 4 touch disjoint files (Block 3: the budgets module; Block 4: the movements module, `server.ts` and
`worker.ts`) and can run in parallel once Blocks 1 and 2 are done, because Block 3 needs the new notice
kind and the new table and Block 4 tests against an in-memory fake of the port; the last step of Block 4,
the wiring in `server.ts` and `worker.ts`, needs the factory `createBudgetAlertListener` of Block 3 and
`renderBudgetAlertText` of Block 1 and therefore waits for Block 3. Block 5 runs last.

## Block 1 — Notice kind, notice text and web rendering

**Files**
- `packages/shared/src/notices/notice.ts` (modified) — `budget_alert` in `NOTICE_KINDS`.
- `apps/api/src/notices/domain/notice-text.ts` (modified) — optional `threshold` in `NoticeTextInput`
  and the `budget_alert` text.
- `apps/api/src/notices/index.ts` (modified) — exports `renderBudgetAlertText`.
- `packages/shared/test/notice-contracts.test.ts`, `apps/api/test/notices/notice-text.test.ts`,
  `apps/api/test/notices/no-sensitive-text.test.ts`, `apps/web/test/notices.test.tsx` (modified: the
  kind list of the contract test, a text case, the sensitive-text case and one list case).

**Logic**
`renderNoticeText` for `budget_alert` requires `threshold` to be an integer from 1 to 200 and throws
otherwise (as `reminder` does without `daysUntilDue`); Spanish: `${name} alcanzó el ${threshold}% de su
presupuesto`, English: `${name} reached ${threshold}% of its budget`. `renderBudgetAlertText({ language,
budgetName, threshold, month })` is a thin wrapper that fixes `kind` and uses the first day of `month` as
`dueDate`. The notices list component is not changed (D9).

**API contract**
No route is added or changed. `GET /notices` takes the same request (limit and cursor query) and keeps
its response shape; the `kind` field of an item can now be `budget_alert`, which the shared response
schema accepts after this block.
- Error codes: unchanged.
- Auth: verified session, unchanged.

**Data model**
No table or column here; the stored `kind` check (a check constraint on a not null column) is widened in
Block 2.

**Input validation**
`threshold` outside 1 to 200 or not an integer is rejected by throwing; the kind enum rejects any other
unknown kind as before.

**Error handling**
- A missing or invalid `threshold` for `budget_alert` throws an error; nothing is swallowed.
- An unknown notice kind is still refused by the shared enum.

**Required tests**
- [ ] An unknown kind is invalid and fails to parse; `NOTICE_KINDS` holds the five kinds and the list
      response schema parses a `budget_alert` item — validates AC-15
- [ ] The Spanish text is "Outings alcanzó el 80% de su presupuesto" and the English text is "Outings
      reached 80% of its budget" — validates AC-15
- [ ] A name of 120 characters is cut to 80 and the text stays between 1 and 300 characters — validates
      AC-16
- [ ] A missing threshold, 0, 201 and 80.5 are invalid and raise an error — validates AC-16
- [ ] The rendered text of a budget alert holds no digit other than the threshold, no currency symbol,
      no account name and no category name — validates AC-17
- [ ] The web notices list renders a `budget_alert` notice text as plain text and an unread one is
      opened and marked read like the others — validates AC-15

**Completion criterion**
The listed tests pass, `pnpm typecheck` passes and the web notices list needs no new message key.

## Block 2 — Migration 0036, schema and rollback

**Files**
- `apps/api/src/budgets/infrastructure/db/schema.ts` (modified) — `budgetAlertMarks`.
- `apps/api/src/notices/infrastructure/db/schema.ts` (modified) — the kind type and `notices_kind_check`.
- `apps/api/drizzle/0036_budget_alert_marks.sql` (generated), `apps/api/drizzle/meta/*` (generated,
  `0036_snapshot.json` and the journal entry at idx 36 with `when` 1791800000000),
  `apps/api/drizzle/rollback/0036_budget_alert_marks.down.sql` (new).
- `apps/api/test/budgets/alert-marks-migration.test.ts` (new; needs `TEST_DATABASE_URL`).
- Tests that assert the migration chain and name 0035 as the newest or roll back the newer migrations
  first (modified; found with `grep -rl 0035_group_expense_payer_movement_idx apps`): in
  `apps/api/test/`: `budgets/migration.test.ts`, `budgets/spending-migration.test.ts`,
  `budgets/no-float-spending.test.ts` (also scan 0036), `credit-cards/automatic-debit-migration.test.ts`,
  `credit-cards/statement-reminders-migration.test.ts`, `goals/migration.test.ts`,
  `groups/activity-log-migration.test.ts`, `groups/expenses-migration.test.ts`,
  `groups/migration.test.ts`, `groups/record-version-migration.test.ts`,
  `groups/settlements-migration.test.ts`, `identity/migration.test.ts` (the `NEWEST_MIGRATION`
  constant and the journal count), `investments/investments-migration.test.ts`,
  `investments/price-migration.test.ts`, `notices/notices-migration.test.ts`,
  `recurring/auto-recording-migration.test.ts`; and `apps/api/test/notices/schema-introspection.test.ts`
  (the kind list).

**Logic**
Generate the migration with drizzle-kit from the two schema files, then check it adds only the table, its
constraints and the replaced notice check. Each test above that rolls back newer migrations to test an
older one first applies `0036_budget_alert_marks.down.sql`, then the 0035 rollback, and each that names
the newest migration or the journal length is moved from 0035 to 0036. The rollback applies the
operations of D12 in the order: notices, check, table, journal row.

**Data model**
- New table `budget_alert_marks` with the columns of D10: `id` primary key, `budget_id`, `owner_id`,
  `month` and `threshold` all not null, `created_at` not null with a default of now; a unique key on
  `(budget_id, month, threshold)`; a composite foreign key on `(budget_id, owner_id)` that cascades on
  delete; a check on the threshold range and a check on the first day of the month. No `real`,
  `double precision` or `numeric` column.
- `notices_kind_check` becomes `kind in ('reminder', 'recorded', 'not_recorded', 'card_statement_due',
  'budget_alert')`.
- No other table changes.

**Input validation**
Database constraints are the validation of this block: the unique key, the composite owner key, the
threshold range and the first-day check.

**Error handling**
- Each constraint violation is a database error that the caller sees; none is swallowed.
- The rollback script is idempotent and never fails when run twice or after the rollback of 0025 dropped
  `notices`.
- A migration test that still names 0035 as the newest migration fails loudly until it is updated.

**Required tests** *(PostgreSQL)*
- [ ] Migration 0036 applies on an empty database and on a copy of the schema of `main`; the table and
      the five-kind check exist and 0 float columns exist in the changed tables — validates AC-26
- [ ] A duplicate mark with the same budget, month and threshold raises a unique key error, and a mark
      of another month or threshold is accepted — validates AC-13
- [ ] A mark whose `owner_id` is not the owner of the budget is invalid and raises a key error; a
      threshold of 0 or 201 and a month that is not the first day are invalid too — validates AC-19
- [ ] Deleting a budget deletes its marks and deleting the user deletes both — validates AC-22
- [ ] A `budget_alert` notice is accepted, an unknown kind is invalid and fails the check — validates
      AC-15
- [ ] The rollback, run twice without a failure, deletes the `budget_alert` notices, restores the four-kind check, drops
      the table and removes only the 0036 journal row, and the migration applies again afterwards —
      validates AC-26
- [ ] The journal entry at idx 36 has the greatest `when`, above 1791790000000, and its snapshot is
      chained to 0035 — validates AC-26
- [ ] Every migration test named in the Files list passes with 0036 as the newest migration — validates
      AC-26

**Completion criterion**
The migration tests pass against PostgreSQL, `pnpm typecheck` passes and no migration test that names
0035 still fails.

## Block 3 — Domain, evaluator, store and the 06c filter

**Files**
- `apps/api/src/budgets/domain/alerts.ts` (new) — `crossedThresholds`, `monthStartDate`.
- `apps/api/src/budgets/application/ports/budget-alert-store.ts` (new) — `BudgetAlertStore` and
  `AlertCrossing`.
- `apps/api/src/budgets/application/evaluate-budget-alerts.ts` (new) — `EvaluateBudgetAlerts`.
- `apps/api/src/budgets/application/compute-spending.ts` (modified) — the `categoryId` filter of D6.
- `apps/api/src/budgets/infrastructure/db/drizzle-budget-alert-store.ts` (new) — D7.
- `apps/api/src/budgets/infrastructure/db/foreign-relations.ts` (modified) — also re-exports `notices`.
- `apps/api/src/budgets/infrastructure/budget-alert-listener.ts` (new) — `createBudgetAlertListener(db,
  { renderText, clock? })`, which builds the evaluator with the SQL readers and the store and implements
  the movements port.
- `apps/api/src/budgets/index.ts` (modified) — exports.
- `apps/api/test/budgets/alerts-domain.test.ts`, `alerts-use-case.test.ts` (fakes),
  `alerts-store.test.ts` (PostgreSQL), `fakes.ts` (modified) (new and modified).

**Logic**
`crossedThresholds(thresholds, percentUsed)` returns the thresholds that are at or below `percentUsed`,
ascending. `EvaluateBudgetAlerts` follows D5 and calls `store.publish(scope, crossings)` only when there
is a crossing; each `AlertCrossing` is `{ budgetId, budgetName, month (first day), threshold }`. The
store follows D7. `createBudgetAlertListener` returns an object whose `afterExpenseSaved` calls
`execute` and returns void. No query runs inside a loop over budgets.

**Data model**
Reads the tables of 06c plus `users.language`; writes only `budget_alert_marks` and `notices` through the
store, inside one transaction, with every value bound as a parameter. No new column: the unique key of
the marks, its composite foreign key and the unique key of the notices are the constraints the store
relies on, and none changes.

**Input validation**
The event comes from the use case that saved the movement (already validated). The evaluator ignores an
event whose month is not the current one and never queries a category outside the owner scope. The store
receives integers and a first-day date, never a string built from user text.

**Error handling**
- Database errors are rethrown by the store and the evaluator; the single place that handles them is the
  hook of Block 4, which logs them (D3, D4). No `catch` in this block swallows an error.
- A failure inside the store transaction rolls back the marks and the notices together.

**Required tests** *(fakes for the domain and the evaluator, PostgreSQL for the store)*
- [ ] A budget of 150,000.00 ARS taken to 80% by an expense yields one crossing for 80 and none for 100
      — validates AC-01
- [ ] From 70% to 110% yields crossings for 80 and 100; thresholds 50 and 90 at 55% yield only 50 —
      validates AC-02, AC-03
- [ ] Amount 15000000, rollover 2000000 and spent 13600000 gives percent 80 against the available
      17000000 and no crossing of 100 — validates AC-04
- [ ] A budget whose 80 mark exists and whose spending stays at 85% publishes nothing — validates AC-05
- [ ] An expense dated in a past month, and one dated in a future month, evaluate nothing and call no
      reader — validates AC-10
- [ ] An expense at 2026-11-01T01:00:00Z with a Buenos Aires user and a clock in October evaluates the
      current month October — validates AC-11
- [ ] With a missing mark and the spending already at 90%, the next evaluation publishes the 80 crossing
      — validates AC-09
- [ ] A fall below 80% and a new rise in the same month publishes nothing because the mark exists, and a
      new month publishes again — validates AC-12, AC-14
- [ ] Two concurrent calls of the store with the same crossing create exactly 1 mark and 1 notice —
      validates AC-13
- [ ] The notice is stored with the kind `budget_alert`, the mark id as `payment_id`, the first day of
      the month as due date, the owner's language and no amount — validates AC-15, AC-17
- [ ] A failing notice insert (a forced error) rolls the mark back, so the next call publishes it —
      validates AC-13
- [ ] Only the budgets that cover the category of the event are read, the previous month is read only
      when one of them has rollover on, and another user's budget over the same category produces no
      crossing, no mark and no notice — validates AC-19
- [ ] A lowered amount makes a new crossing publish, and a threshold with a mark is not published again;
      deleting the budget removes its marks and a budget created afterwards alerts as new — validates
      AC-21, AC-22
- [ ] The percentage is an integer from `bigint` division and the source of the feature holds no float
      — validates AC-25
- [ ] A database error in the store or the evaluator is rethrown as an error, never swallowed —
      validates AC-18

**Completion criterion**
The listed tests pass, the domain and application import nothing from infrastructure, the 06c tests stay
green and `pnpm typecheck` passes.

## Block 4 — Wiring into the movement write path

**Files**
- `apps/api/src/movements/application/ports/expense-saved-listener.ts` (new).
- `apps/api/src/movements/application/best-effort-expense-saved.ts` (new) — `BestEffortExpenseSavedHook`.
- `apps/api/src/movements/application/create-movement.ts`, `update-movement.ts` (modified) — the
  optional `expenseSaved` hook.
- `apps/api/src/movements/infrastructure/http/movement-routes.ts`,
  `apps/api/src/movements/infrastructure/accounts/drizzle-expense-recorder.ts` (modified) — pass the
  hook through their options.
- `apps/api/src/movements/index.ts` (modified) — exports.
- `apps/api/src/server.ts`, `apps/api/src/worker.ts` (modified, last step) — build the listener with
  `createBudgetAlertListener` and `renderBudgetAlertText`, wrap it in the hook with a `logger.error`
  reporter and pass it to the routes and recorders.
- `apps/api/test/movements/expense-saved-hook.test.ts`, `expense-saved-wiring.test.ts` (new).

**Logic**
D1 to D4 and D2. `CreateMovement.execute` and `UpdateMovement.execute` call `expenseSaved?.run(scope,
{ categoryId, occurredAt })` after the repository returned and only for `type === 'expense'`, then return
the movement unchanged. The hook awaits the listener with the time bound and never throws. The group
payer recorder, the automatic debit recorder and the statement payment recorder are not given the hook.

**API contract**
No route is added or changed: `POST /movements` and `PUT /movements/:id` keep their request and response
shapes and error codes, and the hook adds no field to either.
- Error codes: unchanged.
- Auth: verified session, unchanged.

**Data model**
No table or column: no unique key, no foreign key, no check and no default changes in this block.

**Input validation**
Nothing new is accepted as input from the client; the hook receives the stored movement's category and
date.

**Error handling**
- The hook is the one place where a listener failure is handled: it reports the failure through the
  injected `reportFailure` (a `logger.error` with name, code and user id, D4) and returns normally, so
  the saved movement and the response are unchanged.
- A rejection that arrives after the time bound is also reported, never left unhandled.

**Required tests** *(fake listener)*
- [ ] An expense created, and an expense edited, call the listener once with the owner's scope, the
      category and the date, after the repository returned — validates AC-06
- [ ] An expense recorded through the device path with an id, through the recurring recorder and through
      the installments recorder calls the listener as a manual expense does; a device replay does not
      call it — validates AC-07
- [ ] A deletion, an income, a transfer and an exchange never call the listener — validates AC-08
- [ ] A listener that raises an error leaves the created movement stored and returned unchanged and
      calls `reportFailure` once with no budget name, no amount and only the error name, code and user
      id — validates AC-18
- [ ] A listener that never settles hits the timeout with fake timers, the movement is returned and the
      failure is reported; a later error of the same promise is reported and is not an unhandled
      rejection — validates AC-18
- [ ] The group payer recorder, the automatic debit recorder and the statement payment recorder do not
      call a listener even when one is configured for the others — validates AC-20
- [ ] The routes and the recorders built with no hook behave as before: no call, no error — validates
      AC-06

**Completion criterion**
The listed tests pass, the movements module imports nothing from budgets, the boundary test stays green
and `pnpm typecheck` passes.

## Block 5 — Flow, benchmark and float scan

**Files**
- `apps/api/test/budgets/alerts-flow.test.ts` (new; supertest over PostgreSQL, real use cases and
  adapters, a controlled clock set to October, a Buenos Aires user).
- `apps/api/test/perf/budget-alerts.perf.test.ts` (new) — mirrors `budget-spending.perf.test.ts`, run
  with `pnpm test:perf`.
- `apps/api/test/budgets/no-float-alerts.test.ts` (new) — source scan, as `no-float-spending.test.ts`.

**Logic**
The flow test drives `POST /movements`, `PUT /movements/:id`, the device path and the recurring recorder
and reads `GET /notices`. The benchmark seeds one user with `seedDataset` (100,000 movements), 50
budgets of 06b whose categories all cover the category of the measured expense (half with rollover on),
and measures the added time of `POST /movements` with the evaluation on against the same request with the
hook off, 300 requests, 8 connections, 20 warm-up, requiring the difference at p95 under 100 ms and every
status 201; the control also compares the number of notices published with a total computed in SQL, so
an evaluator that does nothing cannot pass.

**API contract**
No new route: the tests exercise `POST /movements`, `PUT /movements/:id` and `GET /notices`, each with its
existing request and response shape.
- Error codes asserted: 201 and 200 on success, 401 `UNAUTHENTICATED`, 404 `NOT_FOUND` for another
  user's movement.
- Auth: verified session.

**Data model**
No new table or column. The benchmark inserts rows into `accounts`, `categories`, `movements`,
`budgets`, `budget_versions`, `budget_version_categories` and `budget_version_thresholds` by
parameterized SQL and deletes them afterwards; every existing constraint applies (not null amounts, the
unique keys, the foreign keys with the owner and the check constraints) and none changes.

**Error handling**
- The flow and benchmark tests fail the run on any seeding error or unexpected status; nothing is caught
  and ignored.
- The scan test fails and names the offending file when a forbidden token appears.

**Required tests**
- [ ] Flow: an expense that takes a budget of 150,000.00 ARS to 80% publishes one notice readable in
      `GET /notices` with the text of Block 1 and no amount; a second expense above 80% adds none —
      validates AC-01, AC-05, AC-17
- [ ] Flow: one expense from 70% to 110% publishes two notices, and a budget with rollover on evaluates
      against the available amount — validates AC-02, AC-04
- [ ] Flow: editing an expense to a larger amount crosses a threshold and publishes; deleting an expense
      and adding it back in the same month publishes nothing new — validates AC-06, AC-12
- [ ] Flow: a device-path expense, a recurring automatic recording and a card installment each publish
      like a manual one; an income, a transfer and an exchange publish nothing — validates AC-07, AC-08
- [ ] Flow: a back-dated expense of September, with the clock in October, publishes nothing; a new month
      publishes again — validates AC-10, AC-14
- [ ] Flow: two simultaneous requests that cross the same threshold leave exactly 1 notice — validates
      AC-13
- [ ] Flow: the same budget is evaluated for its owner only, and a second user with a budget over an
      identically named category receives nothing — validates AC-19
- [ ] Flow: with the store forced to fail, `POST /movements` still answers 201 with the same body and one
      log line holds the error name and code and no budget name or amount — validates AC-18
- [ ] Flow: a request with no session answers 401 and the edit of another user's movement answers 404,
      and neither evaluates a budget — validates AC-19
- [ ] Flow: a lowered budget amount publishes at the next expense without repeating an earlier mark, and
      deleting the budget removes its marks — validates AC-21, AC-22
- [ ] Flow: the notice is readable in `GET /notices` within 5 seconds of the response of the saving
      request, measured with the real clock; a Spanish user gets the Spanish text — validates AC-23,
      AC-15
- [ ] Flow: a second API instance publishes the same notice for the same state, with no process state
      involved — validates the stateless rule of `AGENTS.md`
- [ ] Benchmark: the evaluation adds under 100 ms at p95 to `POST /movements` for 50 budgets covering the
      category and 100,000 movements, every status 201 and the notices equal the SQL control —
      validates AC-24
- [ ] Scan: a forbidden token in a file of the feature is an error that names the file; the files contain
      no `parseFloat`, `toFixed`, `Number(` (other than a row
      count), `real`, `doublePrecision`, `numeric`, `decimal` or `float` column, and the 0036 migration
      declares none; `package.json` files gain no dependency — validates AC-25, AC-26

**Completion criterion**
The benchmark passes under `pnpm test:perf`, the flow and scan tests pass under `pnpm test`, and
`pnpm lint` and `pnpm typecheck` are green.

## Final verification
- 26 of 26 acceptance criteria of the PRD have at least one passing test, and every input has a sad-path
  test.
- `pnpm lint`, `pnpm typecheck`, `pnpm test:coverage` (80% lines, branches and functions over the three
  packages together), `pnpm test:perf` and `pnpm audit --prod --audit-level high` pass.
- The migration `when` of 0036 is greater than the maximum on `main` at merge time, and 0036 is
  renumbered behind any migration merged first; the migration tests that name the newest migration are
  updated with it.
- The rollback script, run twice, removes the table, the `budget_alert` notices and the 0036 journal row,
  restores the four-kind check, and the migration applies again afterwards.
- No group write path, no 06b table and no web component changed, and no push notification was added.

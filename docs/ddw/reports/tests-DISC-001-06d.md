# Test run DISC-001-06d

| Field | Value |
|---|---|
| Runner | vitest (V8 coverage via @vitest/coverage-v8), full suite with coverage |
| Command | `pnpm test:coverage` (Vitest over `apps/api/src`, `apps/web/src` and `packages/shared/src` together, V8 coverage, `TEST_DATABASE_URL` pointing at the local PostgreSQL) |
| Total | 8813 |
| Passed | 8813 |
| Failed | 0 |
| Skipped | 0 |
| Line coverage | 96.89 |
| Branch coverage | 90.36 |
| Function coverage | 94.82 |
| Coverage floor | 80% lines, branches and functions (AGENTS.md, "Testing") |

## Scope

Full-suite run on branch feat/DISC-001-06d-budget-alerts (515 test files): Measured over `apps/api/src`, `apps/web/src` and `packages/shared/src` together, as AGENTS.md requires. The ticket adds one port (`ExpenseSavedListener`) called by `CreateMovement` and `UpdateMovement` after the movement is stored, the budgets implementation of it (`EvaluateBudgetAlerts`, `DrizzleBudgetAlertStore`, `createBudgetAlertListener`), the best-effort wrapper `BestEffortExpenseSavedHook`, a new notice kind `budget_alert` with its text, one migration (0036, additive: table `budget_alert_marks` and a widened `notices_kind_check`) and no dependency. No route and no screen are added.

Performance (`pnpm test:perf`, `apps/api/test/perf/budget-alerts.perf.test.ts`, 50 budgets over one category and 100,000 movements, p95 of `POST /movements` with the hook on minus off, limit 100 ms, NFR-02): run separately from the full suite; its figures go in the PR description.

## Acceptance criteria to tests

Folder `apps/api/test/budgets` unless a path is given. The flow tests (`alerts-flow.test.ts`) run the real HTTP routes over PostgreSQL.

| AC | Tests |
|---|---|
| AC-01 | `alerts-flow.test.ts` "publishes one readable notice at 80% and none for a second expense above it (AC-01, AC-05, AC-17)"; `alerts-use-case.test.ts` "yields one crossing for 80 and none for 100 when a 150,000.00 ARS budget reaches 80% (AC-01)"; `alerts-store.test.ts` "evaluates the current month against PostgreSQL and publishes the 80 crossing (AC-01)" |
| AC-02 | `alerts-flow.test.ts` "publishes two notices for 70% to 110% and evaluates a rollover budget against its available amount (AC-02, AC-04)"; `alerts-use-case.test.ts` "crosses 80 and 100 from 70% to 110%, and only 50 of [50, 90] at 55% (AC-02, AC-03)" |
| AC-03 | `alerts-use-case.test.ts` "crosses 80 and 100 from 70% to 110%, and only 50 of [50, 90] at 55% (AC-02, AC-03)"; `alerts-domain.test.ts` "returns the thresholds at or below the percentage, ascending" and "returns nothing below the lowest threshold" |
| AC-04 | `alerts-use-case.test.ts` "compares against the available amount with rollover (AC-04)"; `alerts-flow.test.ts` the 70% to 110% and rollover test (AC-02, AC-04); `alerts-domain.test.ts` "crosses a threshold exactly when the percentage reaches it" |
| AC-05 | `alerts-use-case.test.ts` "publishes nothing new when the 80 mark exists and spending stays at 85% (AC-05)"; `alerts-store.test.ts` "publishes only the new crossings of a call and returns how many (AC-05)"; `alerts-flow.test.ts` the 80% test (AC-01, AC-05) |
| AC-06 | `alerts-flow.test.ts` "publishes when an edit crosses a threshold and nothing when an expense is deleted and added back (AC-06, AC-12)"; `movements/expense-saved-hook.test.ts` "calls the listener once after a created expense with scope, category and date (AC-06)", "calls the listener once after an edited expense (AC-06)" and "builds without a hook and behaves as before (AC-06)"; `movements/expense-saved-routes.test.ts` "calls the hook once on POST and once on PUT with the owner and category (AC-06)" and "behaves as before with no hook (AC-06)" |
| AC-07 | `alerts-flow.test.ts` "alerts through the device path, a recurring recording and a card installment, but not for an income, a transfer or an exchange (AC-07, AC-08)"; `movements/expense-saved-wiring.test.ts` "the installments recorder calls the hook like a manual expense (AC-07)" and "the recurring recorder calls the hook on record and recordOnce, and a replay does not (AC-07)" |
| AC-08 | `alerts-flow.test.ts` the device path, recurring, installment and non-expense test (AC-07, AC-08) and the delete half of "publishes when an edit crosses a threshold and nothing when an expense is deleted and added back (AC-06, AC-12)"; `movements/expense-saved-hook.test.ts` "never calls the listener for an income, a transfer or an exchange (AC-08)" |
| AC-09 | `alerts-use-case.test.ts` "catches up a missed crossing at the next evaluation (AC-09)" |
| AC-10 | `alerts-use-case.test.ts` "evaluates nothing and reads nothing for a past or a future month (AC-10)"; `alerts-flow.test.ts` "publishes nothing for a back-dated September expense, and again in a new month (AC-10, AC-14)" |
| AC-11 | `alerts-use-case.test.ts` "uses the zone of the user: 2026-11-01T01:00Z is still October in Buenos Aires (AC-11)" |
| AC-12 | `alerts-use-case.test.ts` "does not alert again after a fall and a new rise, and alerts again in a new month (AC-12, AC-14)"; `alerts-flow.test.ts` the edit, delete and add back test (AC-06, AC-12) |
| AC-13 | `alerts-store.test.ts` "creates exactly one mark and one notice for two concurrent calls (AC-13)" and "rolls the mark back when the notice cannot be written, so the next call publishes it (AC-13)"; `alerts-flow.test.ts` "leaves exactly one notice for two simultaneous requests that cross the same threshold (AC-13)"; `alert-marks-migration.test.ts` "refuses a duplicate mark and accepts another month or threshold" |
| AC-14 | `alerts-store.test.ts` "marks a new month again (AC-14)"; `alerts-use-case.test.ts` the fall, rise and new month test (AC-12, AC-14); `alerts-flow.test.ts` the back-dated September and new month test (AC-10, AC-14) |
| AC-15 | `alerts-flow.test.ts` "makes the notice readable within 5 seconds of the response, in the language of the user (AC-15, AC-23)"; `alerts-store.test.ts` "stores a budget_alert notice with the mark id, the first day, the owner language and no amount (AC-15, AC-17)" and "writes the English text for an English user"; `notices/notice-text.test.ts` "names the budget and the threshold in both languages (AC-15)" and "is reachable through renderBudgetAlertText, which uses the month start (AC-15)"; `apps/web/test/notices.test.tsx` "renders a budget_alert notice as plain text and opens an unread one (AC-15)"; `packages/shared/test/notice-contracts.test.ts` "parses a budget_alert notice in the list and rejects an unknown kind (AC-15)" |
| AC-16 | `notices/notice-text.test.ts` "cuts a 120 character name to 80 and stays within 1 to 300 characters (AC-16)" and "rejects the threshold %s by throwing (AC-16)" |
| AC-17 | `notices/notice-text.test.ts` "never contains an amount or an account name, in both languages and all kinds (AC-17, NFR-05)"; `notices/no-sensitive-text.test.ts` "a budget alert holds no digit but the threshold, no currency and no names in %s (AC-17)"; `alerts-store.test.ts` the stored notice test (AC-15, AC-17); `alerts-flow.test.ts` the 80% test (AC-01, AC-05, AC-17) |
| AC-18 | `movements/expense-saved-hook.test.ts` "returns the created movement unchanged and reports once when the listener fails (AC-18)", "does not call the listener when the repository rejects the write (AC-18)", "times out on a listener that never settles and reports it", "reports a rejection that arrives after the time bound without an unhandled rejection", "reports the error name and the AppError code, never the message" and "does not report a listener that settles in time and leaves no timer"; `alerts-flow.test.ts` "still answers 201 when the store fails and logs the error name and code, no budget name or amount (AC-18)"; `alerts-use-case.test.ts` "rethrows an error of the store and of a reader (AC-18)"; `alerts-store.test.ts` "rethrows a database error instead of swallowing it (AC-18)" |
| AC-19 | `alerts-flow.test.ts` "notifies the owner only, never a user with a budget over an identically named category (AC-19)" and "answers 401 with no session and 404 for another user movement, evaluating nothing (AC-19)"; `alerts-use-case.test.ts` "reads only the budgets that cover the category and never another owner (AC-19)"; `alerts-store.test.ts` "rejects a crossing of a budget of another user and writes nothing (AC-19)"; `alert-marks-migration.test.ts` "refuses a mark of another owner, a threshold out of range and a month that is not the first"; `movements/expense-saved-routes.test.ts` "does not call the hook for a request with no session (AC-19)" |
| AC-20 | `movements/expense-saved-wiring.test.ts` "writers that must not evaluate (AC-20)": "%s does not reference the hook" for the group payer, automatic debit and statement payment recorders; "imports nothing from budgets" |
| AC-21 | `alerts-use-case.test.ts` "publishes a lowered amount as a new crossing without repeating a mark (AC-21)"; `alerts-flow.test.ts` "alerts a lowered amount at the next expense without repeating a mark, and deleting the budget removes its marks (AC-21, AC-22)" |
| AC-22 | `alerts-store.test.ts` "removes the marks with the budget and alerts a new budget as new (AC-22)"; `alerts-flow.test.ts` the lowered amount and budget deletion test (AC-21, AC-22); `alert-marks-migration.test.ts` "deletes the marks with the budget and with the user" |
| AC-23 | `alerts-flow.test.ts` "makes the notice readable within 5 seconds of the response, in the language of the user (AC-15, AC-23)"; `alerts-flow.test.ts` "publishes the same notices from a second API instance sharing nothing but the database (stateless rule)" |
| AC-24 | `perf/budget-alerts.perf.test.ts` "adds under 100 ms at p95 to POST /movements for 50 budgets over one category and 100,000 movements"; `alerts-use-case.test.ts` "reads only the budgets that cover the category and never another owner (AC-19)" and "does not call the store when nothing is crossed" (category filter, and no write when nothing crosses) |
| AC-25 | `alerts-domain.test.ts` "crosses a threshold exactly when the percentage reaches it"; `no-float-alerts.test.ts` "no file of the feature uses %s", "the scan catches a planted %s" and "the 0036 migration and its rollback declare no float, numeric or money column"; `alert-marks-migration.test.ts` "creates the table, widens the kind check and declares no float column" |
| AC-26 | `alert-marks-migration.test.ts` "is reverted by its idempotent rollback, which removes only its own journal row, and re-applies", "has a rollback script that forgets exactly the journal when of its migration" and "has the journal entry at idx 36 with the greatest when, chained to 0035"; `no-float-alerts.test.ts` "the feature adds no runtime dependency: its files import only modules the project already uses"; `notices/notices-migration.test.ts` and the other migration tests run the 0036 rollback in their chain |

Sad-path tests: listener failure and time bound, rejection after the time bound, non-error rejection, repository rejection (no hook call), store and reader errors rethrown, database error, notice write failure rolling the mark back, foreign budget and foreign owner mark, threshold out of range and month not the first day, unknown notice kind, no session (401), foreign movement (404), invalid threshold in the text renderer, malformed month (`alerts-flow.test.ts`, `alerts-store.test.ts`, `alerts-use-case.test.ts`, `alerts-domain.test.ts`, `alert-marks-migration.test.ts`, `movements/expense-saved-hook.test.ts`, `movements/expense-saved-routes.test.ts`, `notices/notice-text.test.ts`).

Migration 0036: `alert-marks-migration.test.ts` (8 tests: table, check widening and no float column; duplicate mark refused; foreign owner, threshold range and month day refused; cascade on budget and user; `budget_alert` accepted and unknown kind refused; idempotent rollback and re-apply; the rollback forgets exactly its own journal `when`; journal entry idx 36 with the greatest `when`). The other migration tests only changed their expected migration list or chain.

Other checks:

- Logging: `alerts-flow.test.ts` "still answers 201 when the store fails and logs the error name and code, no budget name or amount (AC-18)" and `movements/expense-saved-hook.test.ts` "reports the error name and the AppError code, never the message".
- Statelessness: `alerts-flow.test.ts` "publishes the same notices from a second API instance sharing nothing but the database (stateless rule)".
- Module boundary: `movements/expense-saved-wiring.test.ts` "imports nothing from budgets".
- `pnpm audit --prod --audit-level high`: no dependency was added or changed (no `package.json` or lockfile in the diff).
- No Playwright flow: the ticket has no screen (06f builds it); the web change is one test that the existing notices list renders a `budget_alert` notice.

## Run anomalies

(none)

## Deviations from the spec, for the record

- The `owner_id` column of `budget_alert_marks` (for the composite key to `budgets`) is an addition to the columns the design named; it is open question 5 of the spec for the owner.

## Owner decisions pending

- State-based, current-month-only evaluation and once per threshold per budget per month, even if the spending falls and crosses again (PRD Decision Log).
- Inline await with a 2,000 ms bound rather than fire-and-forget (spec D3).
- Known limitation: group expenses do not evaluate (05b is unchanged); a crossing caused by a share is announced at the next personal expense in the category, and a budget created or lowered alerts at the next expense, not at the edit.
- Migration 0036 must keep a journal `when` above the maximum on `main` at merge (currently 1791800000000).

## Failures

(none)

## Skips

(none)

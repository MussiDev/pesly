# Test run DISC-001-06c

| Field | Value |
|---|---|
| Runner | vitest (V8 coverage via @vitest/coverage-v8), full suite with coverage |
| Command | `pnpm test:coverage` (Vitest over `apps/api/src`, `apps/web/src` and `packages/shared/src` together, V8 coverage, `TEST_DATABASE_URL` pointing at the local PostgreSQL) |
| Total | 8701 |
| Passed | 8701 |
| Failed | 0 |
| Skipped | 0 |
| Line coverage | 96.92% |
| Branch coverage | 90.36% |
| Function coverage | 94.85% |
| Coverage floor | 80% lines, branches and functions (AGENTS.md, "Testing") |
| Lint | `pnpm exec eslint` over `apps/api/src/budgets`, `apps/api/test/budgets`, `apps/api/test/perf/budget-spending.perf.test.ts`, `packages/shared/src/budgets` and the shared spending test — clean, exit 0, 0 findings |

## Scope

Full run of the ticket on branch DISC-001-06c, on the final-but-one head: 506 test files, 8701 tests, 0 failed, 0 skipped. Measured over `apps/api/src`, `apps/web/src` and `packages/shared/src` together, as AGENTS.md requires. The ticket adds two read-only routes (`GET /budgets/spending`, `GET /budgets/:id/spending`), one migration (0035, additive: one partial index on `group_expenses.payer_movement_id`) and no dependency.

The last commit (3d71c4b) changed the shared month schema so that years before 1971 answer 400 instead of 500, and added its tests (`packages/shared/test/budget-spending-schemas.test.ts`, "accepts 2026-10, 2026-01 and the first supported month 1971-01" and the rejection table with `0000-01` and `1970-12`). Those tests pass; the full suite was not repeated after that commit.

Performance (`pnpm test:perf`, `apps/api/test/perf/budget-spending.perf.test.ts`, 50 budgets and 100,000 movements): p95 137.6 ms in the first run and 99.8 ms in the second, against the limit of 500 ms (NFR-01).

## Acceptance criteria to tests

Folder `apps/api/test/budgets` unless a path is given.

| AC | Tests |
|---|---|
| AC-01 | `spending-reader.test.ts` "returns the 50,000.00 ARS expense summed in the current bucket with its currency and frozen rate (AC-01)" and "returns the 10,000.00 ARS share of an expense paid by someone else, with its name (AC-01, AC-10)"; `spending-use-cases.test.ts` "gives two budgets their own spending from one call of each reader (AC-01, AC-24)"; `spending-flow.test.ts` "reads October and September with exact amounts, remaining, percentages and rollover (AC-01, AC-06, AC-13, AC-18)"; `spending-routes.test.ts` "lists the spending with the contract shape, before /budgets/:id (AC-01, AC-13)" |
| AC-02 | `spending-reader.test.ts` "returns expenses of every category it is asked for, so the children of a parent come back (AC-02)"; `budget-version-reader.test.ts` "covers the selected categories and the children of a selected parent, also one created later (AC-02)"; `spending-use-cases.test.ts` "counts a row of a child category in a budget over its parent (AC-02)" |
| AC-03 | `spending-reader.test.ts` "puts 2026-10-01T01:00Z in September for Buenos Aires and in October for UTC (AC-03)" and "puts a share in the bucket of its own month in the user zone (AC-03)"; `spending-domain.test.ts` "starts and ends at midnight of the user zone" |
| AC-04 | `spending-reader.test.ts` "does not return income, transfers, exchanges, other categories or other users (AC-04, AC-24)"; `spending-domain.test.ts` "ignores categories outside the covered set and unmatched share names" |
| AC-05 | `spending-use-cases.test.ts` "returns spent 0 and remaining equal to available with no rows (AC-05)"; `spending-domain.test.ts` "no rows give 0" and "no rows: remaining equals available" |
| AC-06 | `budget-version-reader.test.ts` "returns the September version for September and the October version for October; a month before the first is null (AC-06, AC-17)" and "uses the categories of each month own version (AC-06)"; `spending-use-cases.test.ts` "uses the version and categories of September when asked for September (AC-06)"; `spending-flow.test.ts` October and September test |
| AC-07 | `spending-flow.test.ts` "converts at the frozen rate in both directions and ignores later changes of the stored rates (AC-07, AC-08, AC-09)"; `spending-domain.test.ts` "converts USD to ARS and ARS to USD" and "converts a personal USD row with its frozen rate" |
| AC-08 | the same flow and domain tests as AC-07 (the ARS to USD direction); `spending-domain.test.ts` "does not overflow near the largest int64" |
| AC-09 | `spending-flow.test.ts` conversion test (stored rates changed after the movement, same spending); `spending-reader.test.ts` "returns USD rows with their frozen rate and never reads exchange_rates (AC-09)" |
| AC-10 | `spending-flow.test.ts` "counts a group share by the matching category name, none for another name, and the payer movement once (AC-10, AC-11, AC-26)"; `spending-domain.test.ts` "matches case-insensitively and in NFC, not by prefix", "a default with no custom name answers to both language names", "matches a share through the default key names" and "is in parity with the categories module"; `spending-reader.test.ts` "returns the default key of a default group category that has no custom name (AC-10)" |
| AC-11 | `spending-flow.test.ts` group-share test (no match, nothing counted); `spending-domain.test.ts` "ignores categories outside the covered set and unmatched share names" |
| AC-12 | `spending-use-cases.test.ts` "reports an unconvertible foreign share and leaves it out of the sum (AC-12)"; `spending-domain.test.ts` "counts a USD share with no rate as unconverted, not summed" and "converts a USD share that carries a rate"; `spending-reader.test.ts` "carries the payer movement rate only when the caller paid (AC-12)" |
| AC-13 | `spending-use-cases.test.ts` "returns remaining and percent for under and over spending (AC-13, AC-14)"; `spending-domain.test.ts` "80 percent and remaining 3000000"; `spending-routes.test.ts` list test |
| AC-14 | `spending-routes.test.ts` "reads one budget with a signed remaining when overspent (AC-14)"; `spending-domain.test.ts` "overspend gives negative remaining and 120" and "caps at 1000" |
| AC-15 | `spending-use-cases.test.ts` "uses the current month of the clock in the user zone when none is given (AC-15)"; `packages/shared/test/budget-spending-schemas.test.ts` "accepts an absent month and rejects an unknown key" |
| AC-16 | `spending-use-cases.test.ts` "rejects a month later than the current one and calls no reader (AC-16)" and "accepts the current month explicitly and any past month (AC-16)"; `spending-routes.test.ts` "rejects a malformed month and an unknown key with VALIDATION_FAILED (AC-16)" and "rejects a future month with BUDGET_MONTH_IN_FUTURE and reads nothing (AC-16)"; `spending-flow.test.ts` "rejects a future month, a malformed month, and a month before the budget (AC-16, AC-17)"; `spending-domain.test.ts` "BudgetMonthInFuture maps to 400 BUDGET_MONTH_IN_FUTURE" and "a malformed month fails the shared validation with 400 VALIDATION_FAILED"; `packages/shared/test/budget-spending-schemas.test.ts` rejection table (`0000-01`, `1970-12`, `2026-13`, `2026-00`, `2026-1`, `2026-10-01`, empty, a number) |
| AC-17 | `spending-use-cases.test.ts` "leaves out a budget that did not exist yet and answers 404 by id (AC-17)"; `budget-version-reader.test.ts` "lists a budget that did not exist yet with null for every month, in creation order"; `spending-flow.test.ts` month-before-the-budget test |
| AC-18 | `spending-use-cases.test.ts` "carries the leftover of the previous month when rollover is on (AC-18)"; `spending-domain.test.ts` "rollover on carries the previous leftover"; `spending-flow.test.ts` October and September test (170,000.00 available) |
| AC-19 | `spending-use-cases.test.ts` "carries nothing after an overspend, with rollover off or with no previous version (AC-19, AC-20, AC-22)"; `spending-domain.test.ts` "rollover on and a previous overspend carries 0" |
| AC-20 | the same use-case test as AC-19; `spending-domain.test.ts` "rollover off ignores the previous month"; `spending-use-cases.test.ts` "does not read the previous month when no budget has rollover on (NFR-01)" |
| AC-21 | `spending-flow.test.ts` "changes the October rollover when a September expense is edited after October began (AC-21)"; `spending-reader.test.ts` "reads afresh on every call: a new September movement changes the rows (AC-21)" |
| AC-22 | the same use-case test as AC-19 (no previous version); `spending-domain.test.ts` "rollover on with no previous version carries 0" |
| AC-23 | `spending-use-cases.test.ts` "answers 404 for a budget of another user and calls no spending reader (AC-23)"; `budget-version-reader.test.ts` "reads one budget by id and returns nothing for an unknown or foreign id (AC-23)"; `spending-routes.test.ts` "answers 404 for a foreign and an unknown budget with the same body (AC-23, AC-24)"; `spending-flow.test.ts` the foreign-budget, list-scope and session test (AC-23, AC-24, AC-25) |
| AC-24 | `spending-use-cases.test.ts` "lists only the budgets of the caller (AC-24)"; `budget-version-reader.test.ts` "never returns the budgets, versions or categories of another user (AC-24)"; `spending-reader.test.ts` "ignores shares of 0, groups the caller is not in, and expenses outside the window (AC-24)"; the flow test of AC-23 |
| AC-25 | `spending-routes.test.ts` "answers 401 with no session and leaks no budget field (AC-25)" and "answers 403 for an unverified email"; the flow test of AC-23 |
| AC-26 | `spending-reader.test.ts` "excludes the payer movement of a group expense and keeps the share (AC-26)"; `spending-flow.test.ts` group-share test (10,000.00 counted, not 30,000.00) |
| AC-27 | `perf/budget-spending.perf.test.ts` "keeps p95 of the list below 500 ms for 50 budgets and 100,000 movements" and "lists every one of 50 budgets of a user, each with its own spending"; `spending-query-plan.test.ts` "serves the personal query from the owner/category/date index and its exclusion from the payer movement index, with no sequential scan of group_expenses"; `spending-reader.test.ts` "issues one statement for 50 categories, never one per budget (NFR-01)" and "issues a single statement whatever the number of groups (NFR-01)"; `budget-version-reader.test.ts` "issues the same fixed number of statements for 1 and for 50 budgets (NFR-01)" |
| AC-28 | `spending-use-cases.test.ts` "produces values the wire contract accepts, with a signed remaining (AC-28)"; `packages/shared/test/budget-spending-schemas.test.ts` "parses a valid response and a negative remaining" and the amount-field rejection table; `no-float-spending.test.ts` "no source file or test of the feature uses %s" and "the 0035 migration declares no float, numeric or money column"; `spending-domain.test.ts` "the domain source uses no float, Number conversion or infrastructure import" and "returns null with no rate across currencies" |

Sad-path tests: malformed and future month, unknown query key, malformed id, foreign and unknown budget, no session, unverified email, missing rate, rate of 0 or less, database failure rethrown, empty category list (`spending-routes.test.ts`, `spending-flow.test.ts`, `spending-domain.test.ts`, `spending-reader.test.ts`, `budget-version-reader.test.ts`, `budget-spending-schemas.test.ts`).

Migration 0035: `spending-migration.test.ts` (6 tests: applies on an empty database, idempotent rollback that removes only the index and its journal row and re-applies, applies on a database with group data, the rollback forgets exactly its own journal `when`, the journal entry has the greatest `when`, no float or numeric column). The other migration tests only changed their expected migration list.

Other checks:

- Logging: `spending-routes.test.ts` "logs ids only, never a name or an amount" and `spending-flow.test.ts` "writes no budget name or amount to the logs".
- Statelessness: `spending-flow.test.ts` "returns the same spending from a second API instance (no process state)".
- `pnpm audit --prod --audit-level high`: no dependency was added or changed (lockfile and package files untouched).
- No Playwright flow: the ticket has no web screen (06f builds it); the web change is one error message key in each catalog and the api-client mapping.

## Module cross-check

An independent cross-check of the module found no blocking bug and three low warnings:

- Fixed in commit 3d71c4b: an extreme year such as `0000-01` gave a 500; the shared schema now rejects years before 1971 with a 400, tested.
- Accepted, by design (spec D7): rounding of the conversion happens once per (category, bucket, currency, rate) group, not once per movement, so the drift is at most 0.5 minor unit per movement. Documented.
- Accepted, documented in PRD AC-12: the rollover ignores the previous month's `unconvertedShareCount`.

## Run anomalies

(none)

## Deviations from the spec, for the record

- The web client mapping and the catalog key for `BUDGET_MONTH_IN_FUTURE` are outside the API-only blocks; they keep the web error mapping complete.
- The first supported month is 1971-01 (the schema regex), added after the cross-check so the previous month always falls after the epoch.

## Owner decisions pending

- Known limitation: group expenses store no frozen rate, so a share in the other currency that someone else paid is reported as `unconvertedShareCount` and not counted. Fixing it needs a 05b write-path change and a migration, out of scope here; it goes in the PR for the owner to ratify (PRD AC-12).
- Rollover carries only the previous month's own remaining amount, and a payer movement is left out of personal spending in favour of the share (PRD Decision Log).
- Migration 0035 must keep a journal `when` above the maximum on `main` at merge (currently 1791790000000).

## Failures

(none)

## Skips

(none)

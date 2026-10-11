# Test run DISC-001-05d

| Field | Value |
|---|---|
| Runner | vitest 5.0.1 (V8 coverage via @vitest/coverage-v8) |
| Command | `TEST_DATABASE_URL=postgres://argent:argent@127.0.0.1:5435/<test database> npx vitest run --coverage --maxWorkers=2 --retry=2 --coverage.reportOnFailure=true` |
| Total | 7390 |
| Passed | 7390 |
| Failed | 0 |
| Skipped | 0 |
| Line coverage | 96.80% |
| Branch coverage | 90.76% |
| Function coverage | 94.58% |
| Coverage floor | 80% lines, branches and functions (AGENTS.md, "Testing") |
| Lint | `pnpm exec eslint` over `apps/api/src/groups`, `apps/api/test/groups`, `packages/shared/src` and `packages/shared/test` — clean, 0 findings (exit 0, run again for this report); `pnpm typecheck` — clean (shared, web, api; run again for this report); `pnpm lint` as a whole stops only at `prettier --check` because of the repository's CRLF checkout on Windows, a known condition that is not related to this ticket |

## Scope

Closeout run of the ticket on branch `feat/DISC-001-05d-edit-activity-log` at commit `f0b122b` (all five blocks, the review fixes and the SAST fixes committed), on the final code. Measured over `apps/api/src`, `apps/web/src` and `packages/shared/src` together, as AGENTS.md requires: 415 test files, 7390 tests, 1010.72 s, in a fresh `_test` database. Suite coverage: statements 94.93% (13276 of 13984), branches 90.76% (7418 of 8173), functions 94.58% (3546 of 3749), lines 96.80% (12101 of 12501). I did not re-run the suite for this report; the figures come from the log of that run (`full05d.log`) and from `coverage/coverage-summary.json`, written after the last commit. The ticket adds one migration (0030, additive for data: two nullable columns, one check added, one check replaced, one trigger function and one trigger) and no dependency.

Ticket code on its own (10 source files with executable code: `groups/domain/group-change.ts`, the five application files `allocate-expense-shares.ts`, `update-group-expense.ts`, `delete-group-expense.ts`, `update-settlement.ts` and `delete-settlement.ts`, `list-activity.ts`, `drizzle-activity-log-reader.ts`, `group-activity-presenter.ts` and `packages/shared/src/groups/activity.ts`; the new port `activity-log-reader.ts` is an interface and has no executable code): 146 of 150 lines (97.33%), 89 of 106 branches (83.96%), 61 of 63 functions (96.83%). The changed parts of `drizzle-group-expense-repository.ts`, `drizzle-group-settlement-repository.ts`, `drizzle-payer-movement-recorder.ts` and the shared `group-routes.ts` are exercised by their tests and counted in the suite figures only.

Ticket code per area (covered of total, from `coverage-summary.json`):

| Area | Lines | Branches | Functions |
|---|---|---|---|
| `groups/domain` | 29/29 = 100% | 19/22 = 86.36% | 20/20 = 100% |
| `groups/application` | 93/97 = 95.88% | 64/78 = 82.05% | 33/35 = 94.29% |
| `groups/infrastructure` | 11/11 = 100% | 6/6 = 100% | 8/8 = 100% |
| `shared/src/groups/activity.ts` | 13/13 = 100% | 0/0 (no branches) | 0/0 (no functions) |
| Sum of the ticket areas | 146/150 = 97.33% | 89/106 = 83.96% | 61/63 = 96.83% |

Other checks on the same tree:

- `pnpm audit --prod --audit-level high`: no known vulnerabilities (SAST report, F-SAST-13); no dependency was added.
- Ticket tests: shared `group-activity-schemas.test.ts` and `group-update-schemas.test.ts`; API `apps/api/test/groups`: `change-use-cases` (including 10,000 random operations on the in-memory fakes), `group-change-domain`, `drizzle-expense-changes` (including the concurrent edits and the deadlock test against the payer deleting the movement), `drizzle-settlement-changes` (including the race of two PATCHes), `activity-log-reader`, `activity-log-every-write-path` (9 write paths, exactly one log row each), `balances-random-edits` (10,000 random operations on PostgreSQL with edits and deletions against an independent ledger, about 53 s), `group-change-routes`, `change-audit`, `activity-log-migration`, `activity-log-introspection`, `payer-movement-recorder` (extended with `update` and `remove`) and `error-status` (extended with the four new codes and the 405 `Allow` header).
- No benchmark: the ticket has no latency requirement (PRD NFR-01 and NFR-02 are about the log content).
- No Playwright flow: the ticket has no web screen (spec, Summary).

## Run anomalies

- The run printed one `getaddrinfo ENOTFOUND api.argent.test` line before the summary; it comes from an existing web test that tries a fake hostname, did not fail any test and is not related to this ticket.
- The run used `--retry=2`. 0 tests are reported failed; I did not inspect whether any test passed only on a retry, so a flaky test, if any, is not ruled out by this report.
- The ticket changed existing test files that list the migrations and the erasure registry (`apps/api/test/identity/migration.test.ts`, `apps/api/test/investments/investments-migration.test.ts`, `apps/api/test/investments/price-migration.test.ts`, `apps/api/test/notices/notices-migration.test.ts`, `apps/api/test/recurring/auto-recording-migration.test.ts`, `apps/api/test/groups/migration.test.ts`, `apps/api/test/groups/expenses-migration.test.ts`, `apps/api/test/groups/settlements-migration.test.ts`) so they know the new journal entry, as in previous tickets, plus `drizzle-group-expense-repository.test.ts`, `expense-fakes.ts` and `settlement-fakes.ts` for the new port methods.
- Migration number: `main` holds `0029_card_automatic_debit` (journal `when` 1791747000000, from DISC-001-10e), so this ticket's migration was renumbered at the merge from 0029 to `0030_group_activity_log_changes` (journal `when` 1791750000000, snapshot `0030_snapshot.json` chained onto main's 0029 one). The migration tests that list the chain (rollback order, counts, tags) and `activity-log-migration.test.ts` ("has the journal entry at idx 30 with a when above 0029, and chains its snapshot onto 0029") carry the new values.
- Coverage anomalies in ticket code: the branch figure of the application area (82.05%) is lower than the others because `splitUnchanged` in `update-group-expense.ts:34-41` has its percentage and fixed-amount comparisons unreached (the description-only test uses an equal split; those comparisons only decide whether stored shares are kept), the "group detail is null" guards after the membership check (`update-group-expense.ts:76`, `update-settlement.ts:58`, `delete-group-expense.ts:37`, `delete-settlement.ts:37`) are defensive, and `allocate-expense-shares.ts` has the `?? 0n` and `?? 0` fallbacks and the "allocation does not add up" throw (`:27`, `:40`, `:48`, `:52-53`, `:62`) that valid input never reaches; in `group-change.ts` the tie branches of the two sort comparators (`:118`, `:149`) are not reached because ids and currencies are distinct in a snapshot.

## Deviations from the spec, for the record

- Block 3: `update-settlement.ts` no longer sends the resolved `amount`, `occurredAt` and `legs` to the repository; it sends only the fields the request names and the repository resolves the rest under lock (fix of SAST L-1, commit `f0b122b`). The spec did not describe this.
- Block 4: `lockExpenseForChange` locks the payer's movement `for update` before the expense row (fix of SAST L-2) and re-reads the acting member under lock (404 when that member left); the settlement repository also re-reads the acting member. The spec's D4 listed neither.
- Block 3: `UpdateGroupExpense` keeps the stored shares when the amount and the split inputs are unchanged, so a description-only edit cannot move a leftover minor unit to another member; the spec did not list it. The settlement former-member delta is kept per currency (review finding).
- Extra test files beyond the spec lists: `group-change-domain.test.ts` and extra cases in `drizzle-expense-changes.test.ts`, `drizzle-settlement-changes.test.ts` and `change-use-cases.test.ts` for the review fixes.

## Failures

(none)

## Skips

(none)

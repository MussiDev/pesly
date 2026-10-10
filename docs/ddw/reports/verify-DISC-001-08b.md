# Verification DISC-001-08b

| Field | Value |
|---|---|
| Module | `apps/api/src/recurring`, `apps/api/src/movements/infrastructure/recurring`, `apps/api/src/movements/infrastructure/accounts/drizzle-expense-recorder.ts`, `apps/api/src/shared/config/env.ts`, `apps/api/src/worker.ts` |
| Line coverage | 96.63% |
| Branch coverage | 90.98% |
| Function coverage | 94.78% |
| Coverage floor | 80% (AGENTS.md, "Testing") |
| Lint | `npx eslint .` clean, `npx prettier --check --end-of-line auto .` clean, `pnpm typecheck` clean |

Coverage numbers are the whole-repo run in `docs/ddw/reports/tests-DISC-001-08b.md` (6498 tests, all
passing, against a throwaway PostgreSQL). After that run, two source-text tests for the worker wiring
were added to `apps/api/test/recurring/recording-job.test.ts`; that file was rerun alone (15 of 15
passing) and the full suite was not rerun.

## Acceptance criteria
- ✅ AC-01 — `records an expense for a due occurrence and resolves it linked to the movement` (`apps/api/test/recurring/record-due-occurrences.test.ts:78`), code `RecordDueOccurrences` (`apps/api/src/recurring/application/record-due-occurrences.ts`), real-database recorder test `records one movement with the given id` (`apps/api/test/movements/recurring-expense-recorder.test.ts:48`)
- ✅ AC-02 — `Madrid 03:59 UTC records nothing, 04:00 UTC records` (`record-due-occurrences.test.ts:109`)
- ✅ AC-03 — `archived account leaves the occurrence pending and listed` (`record-due-occurrences.test.ts:123`), real recorder `an archived account raises ACCOUNT_ARCHIVED and writes nothing` (`recurring-expense-recorder.test.ts:108`)
- ✅ AC-04 — `confirming a pending left by the job records exactly one expense` (`record-due-occurrences.test.ts:139`)
- ✅ AC-05 — `three missed dates are recorded on the next run with their own dates` (`record-due-occurrences.test.ts:154`); a weekly payment stands in for the PRD's daily example, same mechanism
- ✅ AC-06 — `due dates before autoRecordingFrom stay pending and record nothing` (`record-due-occurrences.test.ts:174`) and `a new payment stores today in the owner zone` (`apps/api/test/recurring/use-cases.test.ts:82`)
- ✅ AC-07 — `a resumed payment records nothing for the paused interval` (`record-due-occurrences.test.ts:189`)
- ✅ AC-08 — `three runs in a row leave one expense per occurrence` (`record-due-occurrences.test.ts:213`), `a second job instance started after the first stopped loses nothing` (`apps/api/test/recurring/recording-job.test.ts:305`)
- ✅ AC-09 — `two job processes over the same due occurrence leave one expense` (`recording-job.test.ts:292`), real PostgreSQL
- ✅ AC-10 — `a crash after the expense and before the resolution links the existing expense` (`record-due-occurrences.test.ts:225`)
- ✅ AC-11 — `paused, ended and deleted payments record nothing` (`record-due-occurrences.test.ts:248`), `pages by keyset and returns only active automatic payments of existing users` (`apps/api/test/recurring/automatic-payment-source.test.ts:38`)
- ✅ AC-12 — `one failing payment among three does not stop the others and is retried` (`record-due-occurrences.test.ts:272`), ids only in the report
- ✅ AC-13 — `a zone change from Buenos Aires to Tokyo moves the due time` (`record-due-occurrences.test.ts:299`)
- ✅ AC-14 — `the recorded occurrence leaves upcoming payments` (`record-due-occurrences.test.ts:313`); the expense row is asserted at the recorder level (`recurring-expense-recorder.test.ts:48`)
- ✅ AC-15 — `records at 06:00 owner time and not before, with a 60 s interval` (`recording-job.test.ts:276`), real PostgreSQL with a controlled clock; the 15 minute bound holds by construction because the interval is at most 300 s
- ✅ AC-16 — `records 1,000 due payments out of 10,000 in under 60 s` (`apps/api/test/perf/recurring-job.perf.test.ts:44`), 8.4 s measured

## Spec blocks
- ✅ Block 1 — Auto-recording start day: column and domain: every task done; tests `auto-recording-migration.test.ts`, `use-cases.test.ts`, `payment-repository.test.ts`, `schema-introspection.test.ts`
- ✅ Block 2 — Idempotent expense recorder: every task done; tests `recurring-expense-recorder.test.ts`
- ✅ Block 3 — Use cases: record due occurrences: every task done; tests `record-due-occurrences.test.ts`, `occurrence-repository.test.ts`
- ✅ Block 4 — Job, source, wiring and configuration: every task done; tests `recording-job.test.ts` (including the worker wiring tests added at verification), `automatic-payment-source.test.ts`, `worker-env.test.ts`, `env.test.ts`
- ✅ Block 5 — Registries, performance and documentation: every task done; tests `migration.test.ts`, `user-erasure.test.ts`, `perf/recurring-job.perf.test.ts`, `no-float-money.test.ts`, and the CHANGELOG entry

## Tests
- ✅ Sad-path tests: every input has one — `OccurrenceNotPending`, `ResourceNotFound` from `recordOnce` and from the lock, an unknown zone, a missing exchange rate and a rate limit (`record-due-occurrences.test.ts:324`, `:335`, `:353`, `:382`, `:399`), a foreign id and an archived account at the recorder (`recurring-expense-recorder.test.ts:95`, `:108`), eight rejected values of `RECURRING_JOB_INTERVAL_SECONDS` (`apps/api/test/foundation/worker-env.test.ts:182`), a failing migration, a stale registry head, a benchmark over budget, and a float probe in the money guard
- ✅ NFR-01 through AC-15, NFR-02 `two job processes over the same due occurrence leave one expense`, NFR-03 `records 1,000 due payments out of 10,000 in under 60 s`, NFR-04 `no-float-money.test.ts`, NFR-05 `a second job instance started after the first stopped loses nothing`
- ⚠️ W-VER-03: test timeouts and `ECONNRESET` appeared in four runs against the shared development PostgreSQL and in no run against the throwaway one; they hit different tests each time and the files pass alone (see the run anomalies in the tests report). Not a fragile assertion in this ticket
- ⚠️ Six of the eight Block 5 tests assert behaviour built in earlier blocks and passed on their first run, so their per-assertion red is missing; the two budget tests were seen failing first

Result: PASSED

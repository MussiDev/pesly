# Test run DISC-001-08c

| Field | Value |
|---|---|
| Runner | vitest 5.0.1 (v8 coverage) |
| Command | `TEST_DATABASE_URL=postgres://argent:argent@localhost:5442/pesly08c_final_test pnpm exec vitest run --coverage --maxWorkers=2` |
| Total | 6686 |
| Passed | 6686 |
| Failed | 0 |
| Skipped | 0 |
| Line coverage | 96.74% |
| Branch coverage | 90.99% |
| Function coverage | 94.87% |
| Coverage floor | 80% lines, 80% branches, 80% functions (AGENTS.md, "Testing") |
| Lint | `pnpm exec eslint .` clean, 0 findings; `pnpm exec prettier --check --end-of-line auto .` clean; `pnpm typecheck` clean |

Whole-repo run over 363 test files (`apps/api`, `apps/web`, `packages/shared`). Statement coverage is
94.98%. The run took 573 s. The benchmarks ran separately through `vitest.perf.config.ts`: the two new
ones for this ticket (`recurring-reminders.perf.test.ts` and `notices-list.perf.test.ts`) passed, with
10,000 payments and 1,000 reminders created in 0.5 s and a p95 of 3.9 ms for the notice list.

## Failures
(none)

## Skips
(none)

## Run anomalies

- The green run above used a throwaway PostgreSQL 16 container on port 5442 (data on tmpfs,
  `fsync=off`, `max_connections=300`), restarted just before it. Earlier full runs against other
  containers failed with 7 to 73 tests, a different set every time, all of them `Test timed out in 5000
  ms`, `Hook timed out in 10000 ms` or `read ECONNRESET` from PostgreSQL, in identity, investments,
  movements and credit-card files. Each of those files passed when run alone. After the same container
  had served several runs it degraded and files such as `sign-in.test.ts` and `two-instances.test.ts`
  failed three times in a row; restarting the container fixed them. I attribute all of it to the local
  Docker environment, not to this ticket, and the green run above is the one that counts.
- Two earlier red runs were caused by this ticket and were fixed before the green run: the erasure
  guard in `test/identity/user-erasure.test.ts` did not list the new `notices` table, and five tests
  in `apps/web/test/routes.test.tsx` listed every API call while the unread badge now adds one.
- One run with `--testTimeout=30000 --hookTimeout=30000` was also discarded; the green run uses the
  default 5 s and 10 s timeouts. No test, timeout, worker count or threshold was changed to obtain it.
- In the full benchmark run, 3 tests of `movements-save` and `movements-edit-delete` (not touched by this
  ticket) exceeded 300 ms while all the benchmark files ran at once; `movements-save` passed when run
  with the recurring and notices benchmarks, so I attribute it to the same contention.
- Failing-first evidence, as each implementer reported it (not recoverable from git, because each
  block landed as one commit with its tests): Block 1, the whole new file failed to load (module
  missing); Block 2, 13 of 13 on the first run, with 7 migration tests passing only because the
  throwaway database had been migrated by an earlier run; Block 3, 4 of 6 (the other 2 are
  regression guards); Block 4, 34 of 34; Block 5, 3 of 3 files failed to load; Block 6, 12 of 15 (the
  other 3 assert an absence); Block 7, 10 of 11 (the erasure test proves the owner cascade that Block 2
  already built); Block 8, 21 of 21; Block 9, 17 of 17; Block 10, benchmarks and guards passed on the
  first run because the code already existed, and a mutation check (an amount added to a notice text)
  made 2 of 5 guard tests fail.
- After the green run two tests were changed: the AC-03 check in `create-due-reminders.test.ts` now also
  steps through the old reminder day, and `notice-repository.test.ts` gained a storage-error test. Both
  files were rerun alone (29 of 29 passing); the full suite was not rerun, so the totals above are those
  of the green run.

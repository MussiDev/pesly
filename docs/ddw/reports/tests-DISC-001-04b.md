# Test run DISC-001-04b

| Field | Value |
|---|---|
| Runner | vitest 5.0.1 (V8 coverage via @vitest/coverage-v8 5.0.1) |
| Command | `TEST_DATABASE_URL=postgres://argent:argent@localhost:5435/pesly04b_test pnpm exec vitest run --coverage --maxWorkers=2` |
| Total | 5116 |
| Passed | 5116 |
| Failed | 0 |
| Skipped | 0 |
| Line coverage | 96.9% |
| Branch coverage | 92.41% |
| Function coverage | 94.9% |
| Coverage floor | 80% lines, branches and functions (AGENTS.md, "Testing") |
| Lint | `pnpm exec eslint .` — clean, 0 findings; `pnpm exec prettier --check --end-of-line auto .` — clean; `pnpm typecheck` — clean (shared, web, api) |

## Scope

Closeout run of the ticket on branch `feat/DISC-001-04b-offline-entry-sync`, on the final code (last commit `5737179`). Measured over `apps/api/src`, `apps/web/src` and `packages/shared/src` together, as AGENTS.md requires: 273 test files, 5116 tests, 1225 s. The ticket adds one migration (0018, additive) and no dependency.

An earlier run of the same command on the commit before `5737179` ran 5116 tests with 11 failed, all in two files that revert every later migration before the one they test, `test/investments/investments-migration.test.ts` and `test/investments/price-migration.test.ts`: their lists of later migrations stopped at 0017 and did not roll back 0018. Adding 0018 to both lists fixed them; this report is of the run made after that fix, and the earlier red run is not mixed into its numbers.

Other suites run on the same tree:

- `E2E_PRODUCTION_BUILD=1 pnpm e2e` (Playwright, production build, fresh `_e2e` database on the shared PostgreSQL and Mailpit, ports 3000, 4000 and 4100 free): 110 tests, 110 passed, in 3.7 minutes. That is the 103 tests of DISC-001-04a plus the 7 new flows of `apps/web/e2e/offline-sync.spec.ts` (an expense, a transfer and an exchange saved offline as pending; 5 movements surviving a reload and going out with no click under their own ids and once each; a dropped response leaving one row; a missing rate refusing the save; 100 pending movements stored in under 10 s with 10 Mbps down, 5 Mbps up and 50 ms of latency; 1,000 pending movements kept after a reload). Run without a production build the spec fails fast naming `E2E_PRODUCTION_BUILD`, by design.
- The first run of the two offline specs had one failure, a locator of my own test (`getByRole('listitem').first()` matched the navigation item "Inicio" instead of the first movement row); the test now looks for the first row of the account, and the two specs then passed 11 of 11.
- `pnpm audit --prod --audit-level high`: no known vulnerabilities; no dependency was added.
- `pnpm test:perf` was not run: the change adds one indexed primary key lookup before a creation that carries an id and leaves the list, create-without-id and accounts queries that the benchmarks measure as they were.

Deviations from the spec, for the record:

- Block 1: the spec said the update schemas "reject" an `id` key; they strip it, as they already did with `ownerId`, and the test checks that. The nil UUID is accepted by `z.uuid()` and was left alone.
- Block 2: drizzle-kit generated the primary key swap before `ADD COLUMN`; the statements of `0018_device_write_limit.sql` were reordered by hand. Every older migration test now rolls 0018 back first and its counters moved up by one.
- Block 3: `DuplicateMovementId` extends `Error`, not `AppError`, because it never reaches a response.
- Block 5: the route test R-16 of DISC-001-03b used to assert that an `id` in the body is ignored; it is honored now, so that test only checks the owner and the timestamps.
- Block 6: `queuedToMovement` takes an optional map of account currencies to read an exchange's implied rate; without it the rate stays empty.
- Block 10: the list puts the pending movements in with the loaded page by date, not strictly first, so a day never repeats its heading. The entry screen sends an id also when it is online, and a `NETWORK` failure keeps the movement under the same id.
- Block 9: the shell sends the queue for the user the API confirmed in this visit, not for the one in the pointer.
- Block 11: the shared preparation helpers of the offline flows moved to `apps/web/e2e/support/offline-visit.ts` and `offline.spec.ts` imports them. These e2e flows were written after the code they test, so there was no red phase for them; the units of every block were seen failing first, except where the block says the module was missing.
- One run of `test/movements` failed 1 test of 614 and the repeat passed 614 of 614; the first output was not kept and the test was not identified. The full run of this report did not show it.
- No subagents were used (a standing instruction of the user), so the author and the reviewer of every block are the same agent.

## Failures

(none)

## Skips

(none)

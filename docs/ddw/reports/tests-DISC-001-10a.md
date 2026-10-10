# Test run DISC-001-10a

| Field | Value |
|---|---|
| Runner | vitest 5.0.1 (V8 coverage via @vitest/coverage-v8 5.0.1) |
| Command | `TEST_DATABASE_URL=postgres://argent:argent@localhost:5435/pesly10a_test pnpm exec vitest run --coverage --maxWorkers=2 --retry=2 --coverage.reportOnFailure=true` |
| Total | 5507 |
| Passed | 5507 |
| Failed | 0 |
| Skipped | 0 |
| Line coverage | 96.82% |
| Branch coverage | 92.03% |
| Function coverage | 94.87% |
| Coverage floor | 80% lines, branches and functions (AGENTS.md, "Testing") |
| Lint | `pnpm exec eslint .` — clean, 0 findings; `pnpm exec prettier --check --end-of-line auto .` — clean; `pnpm typecheck` — clean (shared, web, api) |

## Run anomalies

Read this before the table: 5507 of 5507 tests passed, one file's teardown timed out.

- The run used `--retry=2 --coverage.reportOnFailure=true`, by the user's decision, because the shared test database dropped connections or went slow in the four earlier closeout runs, each time in a different single test outside this ticket.
- Vitest exited with code 1 and reported one test file as failed: `apps/api/test/investments/holding-routes.test.ts`. All 32 of its tests passed; its `afterAll` hook (`await connection.pool.end()`, line 22) timed out at 10 s. Vitest does not retry hooks. The file and `apps/api/src/investments` are not changed by this ticket. Run alone right after (`pnpm exec vitest run test/investments/holding-routes.test.ts` from `apps/api`, same `TEST_DATABASE_URL`) it passed: 1 file, 32 of 32 tests, 12.75 s.
- The output shows no retried test, but Vitest's default reporter may not list tests that passed on a retry, so whether retries happened in this run is unknown.
- This was the fifth closeout run. The earlier four were each red for one test: (1) `test/deploy/build-output.test.ts`, its list of tables lacked the two new tables (the ticket's own miss, fixed in `50984af`); (2) the first credit-cards probe of `test/foundation/architecture-boundaries.test.ts` timed out at 5 s paying ESLint's cold start (the ticket's own miss, fixed in `1baf211` with a warm-up); (3) `test/identity/second-factor-races.test.ts` "12 concurrent verifies against a pool of 10 connections" timed out at 30 s; (4) after merging `main`, three database-concurrency files (`test/movements/write-limiter.test.ts`, `test/identity/postgres-attempt-limiter.test.ts`, `test/identity/sign-in.test.ts`) hit hook and test timeouts, and in the next run `test/investments/price-sync-integration.test.ts` failed with `read ECONNRESET` on an insert. None of (3) and (4) is in code of this ticket, and each passed when run alone.
- Unverified hypothesis, labelled as such: the connection to the shared test database through Docker Desktop's `localhost:5435` drops or stalls under load. The PostgreSQL log of the last three hours has no terminating-connection or FATAL events, and only one test cancels a backend, scoped to its own worker pid. Finding the cause is a separate topic, not part of this ticket.

## Scope

Closeout run of the ticket on branch `feat/DISC-001-10a-cards-statements` after merging `origin/main` (merge commit `9ab44ad`), on the final code. Measured over `apps/api/src`, `apps/web/src` and `packages/shared/src` together, as AGENTS.md requires: 295 test files, 5507 tests, 1415 s. The ticket adds one migration (0019, additive) and no dependency.

Other checks on the same tree:

- `pnpm audit --prod --audit-level high`: no known vulnerabilities; no dependency was added.
- The test files this ticket touches, run after the merge: web 401 of 401, API 653 of 653, shared 27 of 27.
- Playwright (`apps/web/e2e/credit-cards.spec.ts`) is written, lints and typechecks, and was not run here: its ports and the Mailpit inbox are shared on the machine and the orchestrator runs it.
- `pnpm test:perf` was not run: the ticket adds new routes only and changes no query that the benchmarks measure.

Deviations from the spec, for the record:

- Block 1: `clampedDate` stays internal to `statement-cycle.ts`; nothing outside needs it.
- Block 3: `ListCreditCards`, `GetCreditCard` and `DeleteCreditCard` take only the dependencies they use.
- Block 4: the erasure step's sad path checks that deleting the accounts before the cards is refused, instead of a whole erasure without the step, because the cascade from `users` happened to succeed in that order on PostgreSQL 16 (the order is not guaranteed, which is why the step exists).
- Block 6: the routes were written before their tests, so they have no failing-first evidence; the composition and registry tests were seen failing first. The route tests also cover the origin guard (threat R-01). The boundary probe for `express` sits in the domain layer, the only layer where the project forbids it.
- Block 8: `nameErrorMessage` of the accounts feature takes an optional limit and returns the narrower `AccountNameMessage`, reused by the card form with 46.
- No subagents were used in this run of the ticket, so the author and the reviewer of every block are the same agent.

## Failures

(none)

## Skips

(none)

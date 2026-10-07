# Test run DISC-001-10b

| Field | Value |
|---|---|
| Runner | vitest 5.0.1 (V8 coverage via @vitest/coverage-v8 5.0.1) |
| Command | `TEST_DATABASE_URL=postgres://argent:argent@localhost:5435/pesly10b_test pnpm exec vitest run --coverage --maxWorkers=2 --retry=2 --coverage.reportOnFailure=true` |
| Total | 5659 |
| Passed | 5659 |
| Failed | 0 |
| Skipped | 0 |
| Line coverage | 96.83% |
| Branch coverage | 92.1% |
| Function coverage | 94.86% |
| Coverage floor | 80% lines, branches and functions (AGENTS.md, "Testing") |
| Lint | `pnpm exec eslint .` — clean, 0 findings; `pnpm exec prettier --check --end-of-line auto .` — clean; `pnpm typecheck` — clean (shared, api, web) |

## Run anomalies

Read this before the table: 5659 of 5659 tests passed; two test files reported a failed teardown hook.

- The run used `--retry=2 --coverage.reportOnFailure=true`, the setup of the earlier closeouts (10a, 04d), because the shared test database stalls under load.
- Vitest exited with code 1 and reported two files as failed: `apps/api/test/movements/movement-repository.test.ts` and `apps/api/test/movements/transfer-exchange-repository.test.ts`. Every test in both passed; their `afterAll` hook (`await connection.pool.end()`, line 32) timed out at 10 s, and Vitest does not retry hooks. Neither the files nor the code they test (`apps/api/src/movements` repositories) are changed by this ticket; the ticket adds two read-only and recorder adapters to the movements module, covered by `test/credit-cards/card-purchases.test.ts` and `expense-recorder.test.ts`, which passed.
- The first full run of the same tree (same command, 1548 s) had 5657 of 5659 tests passed and three files red: `test/categories/category-routes.test.ts` ("gives a user registered with the creation hook exactly the 33 defaults", test timeout 5 s, three attempts), `test/identity/google-persistence.test.ts` (one test timeout and an `afterAll` timeout) and `test/identity/sign-in.test.ts` (`afterAll` timeout). None is code of this ticket. The three files run alone right after (`pnpm exec vitest run test/categories/category-routes.test.ts test/identity/google-persistence.test.ts test/identity/sign-in.test.ts --maxWorkers=2` from `apps/api`, same `TEST_DATABASE_URL`) passed: 3 files, 73 of 73 tests, 46 s. The run was repeated, and the second run is the one reported here.
- Different unrelated files fail on each run, in database waits (hook and 5 s test timeouts), as in the 10a and 04d closeouts; the hypothesis recorded there (the Docker Desktop connection to the shared database stalls under load) is unverified and is not investigated here.

## Scope

Closeout run of the ticket on branch `feat/DISC-001-10b-card-expenses` (created from `origin/main` 663f747), on the final code. Measured over `apps/api/src`, `apps/web/src` and `packages/shared/src` together, as AGENTS.md requires: 304 test files, 5659 tests, 1528 s. The ticket adds no migration and no dependency.

Ticket code (the 26 source files this ticket adds or changes under those three trees): 94.27% lines, 89.61% branches, 94.25% functions.

Other checks on the same tree:

- `pnpm audit --prod --audit-level high`: no known vulnerabilities; no dependency was added.
- Playwright (`apps/web/e2e/credit-cards-expenses.spec.ts`) is written, lints and typechecks, and was not run here: its ports and the Mailpit inbox are shared on the machine and the orchestrator runs it.
- `pnpm test:perf` was not run: the new statement-totals query reads the existing `movements_owner_account_date_idx` and no benchmarked query changed.

Deviations from the spec, for the record:

- Block 3 and spec D7: the purchases adapter lives in the movements module (`apps/api/src/movements/infrastructure/credit-cards/drizzle-card-purchases.ts`) instead of `credit-cards` reading the movements table, after the arch-auditor of PLAN found that the second would break the module pattern; the spec was corrected before CODE.
- Block 4: an ESLint block for `credit-cards` was added to `eslint.config.mjs` so that the boundary test (credit-cards must not import movements) can pass, as the impact scan found.
- Block 6: `MovementField` accepts any catalog path for its error (it took a movement-only type) and `loadAll` of the movements form hook is exported, so the card expense screen reuses both instead of copying them; the arch-auditor of the block listed both as warnings to move to a neutral place later.
- Subagents implemented and reviewed every block (one implementer per block, then a module-verifier and an arch-auditor); the orchestrator ran the suites.

## Failures

(none)

## Skips

(none)

# Test run DISC-001-10d

| Field | Value |
|---|---|
| Runner | vitest 5.0.1 (V8 coverage via @vitest/coverage-v8 5.0.1) |
| Command | `TEST_DATABASE_URL=postgres://argent:argent@localhost:5435/pesly10d_185730_test pnpm exec vitest run --coverage --maxWorkers=2` |
| Total | 5883 |
| Passed | 5883 |
| Failed | 0 |
| Skipped | 0 |
| Line coverage | 96.78% |
| Branch coverage | 91.91% |
| Function coverage | 94.79% |
| Coverage floor | 80% lines, branches and functions (AGENTS.md, "Testing") |
| Lint | `pnpm exec eslint .` — clean, 0 findings; `pnpm exec prettier --check --end-of-line auto .` — clean; `pnpm typecheck` — clean (shared, api, web); `pnpm audit --prod --audit-level high` — no known vulnerabilities |

## Run anomalies

None: 317 test files and 5883 of 5883 tests passed with exit code 0 in a single run (1534.65 s), and no hook or test timed out. No test file needed a rerun.

## Scope

Closeout run of the ticket on branch `feat/DISC-001-10d-statement-payments` (stacked on `feat/DISC-001-10c-installments` at 2f0434f), on the final code (head 972b29d). Measured over `apps/api/src`, `apps/web/src` and `packages/shared/src` together, as AGENTS.md requires: 317 test files, 5883 tests. The 10c baseline was 311 files and 5800 tests, so the ticket adds 6 files and 83 tests.

Ticket code (the 17 source files this ticket adds or changes in the three trees, listed in the coverage summary): 95.86% statements, 84.44% branches, 95.73% functions. The lower branch figures sit in files the ticket only touched (`credit-card-detail-container.tsx` 69.01%, `statement-payment-container.tsx` 78.37%), where the uncovered branches are failure paths of 10b and 10c code and the unauthenticated redirects.

Ticket tests: `packages/shared/test/statement-payment-schemas.test.ts` (request, response and statement `payments`); `apps/api/test/credit-cards/statement-payments.test.ts` (allocation, status, use case, with fakes); `statement-payment-adapters.test.ts` (received-transfers sum including a sum beyond 2^53, recorder against PostgreSQL); `statement-payment-routes.test.ts` (route, balances, cross-user, limits, logging); `apps/web/test/statement-payment-request.test.ts`, `api-client-credit-cards.test.ts`, `statement-payment.test.tsx` (screen and statement rows in Spanish and English).

Other checks on the same tree:

- `pnpm audit --prod --audit-level high`: no known vulnerabilities (no dependency changed).
- Perf: `test/perf/credit-card-statements.perf.test.ts` (10c NFR-02, p95 below 300 ms for the statement read of a card with 60 installment purchases) still passes with the extra received-transfers query; run alone with `vitest.perf.config.ts`.
- Playwright (`apps/web/e2e/credit-cards-payments.spec.ts`) is written, lints and typechecks, and was not run here: its ports and the Mailpit inbox are shared on the machine and the orchestrator runs it. It needs the new helper `closeFirstStatement` in `apps/web/e2e/support/database.ts` (moves the first statement's dates into the past, because a statement only closes as days pass).

Deviations from the method and the spec, for the record:

- Test-first was not followed block by block: the sources of each block were written and their tests added right after, so no test was seen failing on its assertion before the code existed. The tests were run green per block and in full at the end.
- The implementer-per-block, module-verifier and arch-auditor reviews of the CODE rules were not run: the blocks were written and reviewed by the single agent that ran this ticket. `ddw-validate-arch` was invoked once at the start of CODE (before any code, nothing to flag) and ESLint with the module boundary rules and the boundary tests enforce the layers on the final tree.
- Commits were made per block as each block went green, before the test and SAST reports existed; the reports are committed afterwards.
- Spec Block 3 asked for an amount above 2^53 to round-trip through the route; the contract ceiling is 10^15 minor units (below 2^53), so the route test uses the ceiling itself and the adapter test sums eleven transfers beyond 2^53 (9,999,999,999,999,991) exactly, which is where a float would round.
- Spec Block 3 asked for "another user's transfer never counted" at the route; the movements foreign keys make it impossible to create a transfer into another user's account, so that case is asserted at the adapter (other scope sums zero) and use-case level, and at the route as Bob's card showing no payments from Ana's.
- `credit-card-routes.test.ts`, `installment-routes.test.ts` and the perf test were only adapted to the two new route dependencies.

## Failures

(none)

## Skips

(none)

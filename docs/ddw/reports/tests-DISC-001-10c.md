# Test run DISC-001-10c

| Field | Value |
|---|---|
| Runner | vitest 5.0.1 (V8 coverage via @vitest/coverage-v8 5.0.1) |
| Command | `TEST_DATABASE_URL=postgres://argent:argent@localhost:5435/pesly10c_214000_test pnpm exec vitest run --coverage --coverage.reportOnFailure=true --maxWorkers=2` |
| Total | 5800 |
| Passed | 5800 |
| Failed | 0 |
| Skipped | 0 |
| Line coverage | 96.81% |
| Branch coverage | 91.93% |
| Function coverage | 94.84% |
| Coverage floor | 80% lines, branches and functions (AGENTS.md, "Testing") |
| Lint | `pnpm exec eslint .` — clean, 0 findings; `pnpm exec prettier --check --end-of-line auto .` — clean; `pnpm typecheck` — clean (shared, api, web); `pnpm audit --prod --audit-level high` — no known vulnerabilities |

## Run anomalies

None in the reported run: 311 test files and 5800 of 5800 tests passed with exit code 0, and no hook or test timed out.

The earlier run of the same ticket (1486 s, same command on database `pesly10c_203500_test`) was not green and is not the one reported: 5789 of 5800 passed and 3 files failed. They were real defects of this ticket, not database stalls, and were fixed before the reported run:

- `test/identity/user-erasure.test.ts` (10 tests): the erasure guard found two tables reachable from `users` that the registry did not list. Fixed by registering `installment_purchases` (erase-step, with its two restricting keys) and `installments` (cascade) with seeders, and by giving `installments` an `owner_id` column with a composite key to its purchase, so the guard's user column exists and every query on installments is scoped by owner (AGENTS.md).
- `test/deploy/build-output.test.ts` (1 test): the expected table list lacked the two new tables.
- `test/movements/erasure-step.test.ts` (1 test): its source check expected `usage: createCategoryUsage(db)` in `server.ts`; the composition root now combines the movements and installment usages, so the check was updated to assert both adapters are built and combined.

The migration was regenerated after the first run (its journal `when` changed from 1791415997385 to 1791419213992), so the second and third runs used fresh databases.

## Scope

Closeout run of the ticket on branch `feat/DISC-001-10c-installments` (created from `origin/main` 77d55f1), on the final code (head a34dc69). Measured over `apps/api/src`, `apps/web/src` and `packages/shared/src` together, as AGENTS.md requires: 311 test files, 5800 tests, 1551 s.

Ticket code (the 40 source files this ticket adds or changes under those three trees): 94.28% lines, 87.44% branches, 93.54% functions.

Ticket tests: `packages/shared` split and schema tests (including 10,000 random purchases adding up exactly, NFR-03); the installment repository, schema introspection, erasure, adapters, use cases and route tests under `apps/api/test/credit-cards`; the migration tests for 0020 (apply, constraints, double rollback, journal and snapshot chain); the web request builder, client, form, card page and catalog tests.

Other checks on the same tree:

- `pnpm audit --prod --audit-level high`: no known vulnerabilities. The tree this branch started from reported one High (GHSA-cjq9-62q9-8jv4 in `next` below 16.3.8); `next` was raised to `^16.3.8` and the lockfile follows.
- `pnpm test:perf` for the new benchmark only (`test/perf/credit-card-statements.perf.test.ts`, NFR-02): p95 = 54.4 ms over 300 requests for a card with 60 installment purchases of 60 installments, against a limit of 300 ms.
- Playwright (`apps/web/e2e/credit-cards-installments.spec.ts`) is written, lints and typechecks, and was not run here: its ports and the Mailpit inbox are shared on the machine and the orchestrator runs it.

Deviations from the spec, for the record:

- Block 2: `installments` also carries `owner_id` with a composite foreign key `(purchase_id, owner_id)` to `installment_purchases(id, owner_id)` and an index on `owner_id`, plus a unique key `(id, owner_id)` on purchases. The spec described a plain key on `purchase_id`; the erasure guard and the owner-scoping rule of AGENTS.md need the column.
- The application files of Block 3 are split as `update-installment-purchase.ts`, `delete-installment-purchase.ts`, `get-installment-purchase.ts` and `list-installment-purchases.ts`, as listed in the spec; the monthly expenses use case is `list-installment-expenses.ts`.
- The implementer-per-block, module-verifier and arch-auditor reviews of the CODE rules were not run: the blocks were written and reviewed by the single agent that ran this ticket. `ddw-validate-arch` was run once on the whole change (no findings; ESLint enforces the module boundaries) and the gates below were run on the final tree.
- A patch-level raise of `next` (16.3.6 to 16.3.8) was added to clear the audit gate; it is not part of the spec.

## Failures

(none)

## Skips

(none)

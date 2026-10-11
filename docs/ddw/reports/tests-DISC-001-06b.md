# Test run DISC-001-06b

| Field | Value |
|---|---|
| Runner | vitest (V8 coverage via @vitest/coverage-v8), full suite with coverage |
| Command | `pnpm test:coverage` (Vitest over `apps/api/src`, `apps/web/src` and `packages/shared/src` together, V8 coverage, `TEST_DATABASE_URL` pointing at the local PostgreSQL) |
| Total | 8268 |
| Passed | 8268 |
| Failed | 0 |
| Skipped | 0 |
| Line coverage | 96.95% |
| Branch coverage | 90.74% |
| Function coverage | 94.88% |
| Statement coverage | 95.11% |
| Coverage floor | 80% lines, branches and functions (AGENTS.md, "Testing") |
| Lint | `pnpm exec eslint` over `apps/api/src/budgets`, `apps/api/test/budgets` and `packages/shared/src/budgets` — clean, 0 findings; typecheck and prettier clean on the ticket paths |

## Scope

Full run of the ticket on branch `feat/DISC-001-06b-budgets-core-api`, on the code before the last small commit: 473 test files, 8268 tests, 0 failed. Measured over `apps/api/src`, `apps/web/src` and `packages/shared/src` together, as AGENTS.md requires. The ticket adds one migration (0034, additive: four tables, `budgets`, `budget_versions`, `budget_categories`, `budget_thresholds`) and no dependency.

The last commit changed no source code: the journal `when` of migration 0034 moved from 1791770000000 to 1791780000000, because the goals migration (0033, ticket 06a) uses 1791770000000. The same value was updated in the rollback script and in the SAST note. After that change these were re-run and passed: the budgets tests, the identity migration and user-erasure tests, the groups migration test and the statement-reminders migration test, 12 files and 218 tests, all green.

Tests of this ticket: shared contract `packages/shared/test/budget-schemas.test.ts`; API folder `apps/api/test/budgets` (domain, use cases, repository, category reader, routes, flow, migration, schema introspection); web `apps/web/test/api-client-budget-errors.test.ts` (the two new error codes and their messages in both catalogs).

Other checks:

- The SAST report records `pnpm exec eslint` over the budgets source, tests and shared contract with 0 findings.
- `pnpm audit --prod --audit-level high`: no dependency was added or changed (lockfile untouched).
- `pnpm test:perf` was not run: the ticket adds new routes and tables only and changes no query that the benchmarks measure.
- No Playwright flow: the ticket has no web screen (06f builds it).

## Module cross-check

An independent cross-check of the module found no blocking defects. Fixed during it:

- MEDIUM: a lost update on two concurrent partial PATCH requests; the edit is now merged inside the locked transaction, and a concurrency test was added (`budget-flow.test.ts`, "keeps both fields when two partial edits of one budget run concurrently").
- MEDIUM: no route test for deleting a category used by a budget; added (`budget-routes.test.ts`, 409 `CATEGORY_IN_USE`, the category kept).
- LOW: a comment on the deferred category key, and a pin test for the rollback script (`migration.test.ts`).
- The spec was corrected to match the code (D4, D10, D11, Block 2: deferrable category key, hand-edited migration, rollback removes the journal row; journal idx 34 with 33 skipped).

Remaining lows, accepted: a race on an income category answers 404 instead of 400 (the category key is checked at commit); the user time zone port throws for a missing user.

## Run anomalies

(none)

## Deviations from the spec, for the record

- The web client test `apps/web/test/api-client-budget-errors.test.ts` and the catalog keys for the two new codes are outside the API-only blocks; they keep the web error mapping complete.
- The migration was edited by hand after generation (deferrable category key), as documented in the migration file and the spec.
- Other migration tests only changed their expected migration list.

## Owner decisions pending

- Edits stored as month versions (spec D2).
- A limit of 50 budgets per user, answering 409 `BUDGET_LIMIT_REACHED`.
- Thresholds: 1 to 5 distinct integers in 1..200, defaults 80 and 100.
- Category mapping: foreign or unknown 404, income 400, archived 409.
- Not built here: spending computation (06c), alerts (06d), web screens (06f).

## Failures

(none)

## Skips

(none)

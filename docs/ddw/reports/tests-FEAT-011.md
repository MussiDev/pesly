# Test run FEAT-011

| Field | Value |
|---|---|
| Runner | vitest 5.0.1 |
| Command | `TEST_DATABASE_URL=postgres://argent:argent@127.0.0.1:5435/feat011_test pnpm exec vitest run --coverage --maxWorkers=2 --retry=2 --coverage.reportOnFailure=true` |
| Total | 11247 |
| Passed | 11245 |
| Failed | 0 |
| Skipped | 2 |
| Line coverage | 96.87% |
| Branch coverage | 90.14% |
| Function coverage | 94.89% |
| Coverage floor | 80% lines, 80% branches, 80% functions (AGENTS.md, "Testing") |
| Lint | `pnpm exec eslint .` — clean, 0 findings; `pnpm exec prettier --check --end-of-line auto .` — clean; `pnpm typecheck` — clean |

The run covers 713 test files in one pass over `apps/api`, `apps/web` and `packages/shared`. The
dashboard perf test (`apps/api/test/perf/dashboard.perf.test.ts`, 46 statements, 1,000 ms p95 and 32 KB
body) and the budget perf tests run separately with `vitest --config vitest.perf.config.ts` and
passed. The e2e specs of the ticket (`credit-cards-spending-month`, `dashboard`, `budgets`) ran with
Playwright on a fresh database: 32 passed, 1 skipped.

## Failures
(none)

## Skips
- `apps/api/test/investments/no-float-money.test.ts` — "contains sources and no float conversions"; reason: it is
  skipped when the API root of that scan does not exist in the checkout (`it.skipIf(!apiExists)`).
- `apps/web/test/group-category-views-scans.test.ts` — "what the branch adds against main (AC-24)"; reason: it is
  skipped when there is no base ref to diff against (`describe.skipIf(base === undefined)`).

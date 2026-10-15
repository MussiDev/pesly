# Test run FEAT-012

| Field | Value |
|---|---|
| Runner | vitest 5.0.1 |
| Command | `TEST_DATABASE_URL=postgres://argent:argent@127.0.0.1:5436/feat012_test npx vitest run --coverage --maxWorkers=2 --retry=2 --coverage.reportOnFailure=true --reporter=dot` |
| Total | 11368 |
| Passed | 11366 |
| Failed | 0 |
| Skipped | 2 |
| Line coverage | 96.85% |
| Branch coverage | 90.17% |
| Function coverage | 94.88% |
| Coverage floor | 80% lines, 80% branches, 80% functions (AGENTS.md, "Testing") |
| Lint | `npx eslint apps packages --quiet` — clean, 0 findings; `prettier --check --end-of-line auto` clean (plain `pnpm lint` reports only CRLF line endings of this Windows checkout) |

## Failures
(none)

## Skips
- `apps/web/test/group-category-views-scans.test.ts` > "adds no file to apps/api/drizzle: no migration" — skipped because the file's own `describe.skipIf(base === undefined)` guard fires: the test compares the branch against a git base ref that this checkout does not resolve. Pre-existing, from FEAT-005-era group views, not touched by FEAT-012 (which does add migration 0040 on purpose, so it would not apply to this branch).
- `apps/web/test/group-category-views-scans.test.ts` > "adds no dependency to any package.json" — skipped because of the same `skipIf(base === undefined)` guard: the git base ref is not resolvable in this checkout. FEAT-012 adds no dependency (checked in the diff).

Also run outside the unit suite: Playwright `apps/web/e2e/accounts.spec.ts` (13 tests, including the FEAT-012 set-balance, hide and delete flow) — 12 passed in the first run, the new test failed on two assertions of the test itself and passed after the fix (1 passed in a rerun); the other 12 were not rerun after the e2e-file edit, which touched only that test. API perf benchmark `set-account-balance.perf.test.ts` passed inside the run (p95 20.9 ms against 500 ms).

# Test run FEAT-006

| Field | Value |
|---|---|
| Runner | Vitest 5.0 (V8 coverage) |
| Command | `TEST_DATABASE_URL=postgres://argent:argent@localhost:5435/pesly_f006_111854_test pnpm exec vitest run --coverage --maxWorkers=2` |
| Total | 6189 |
| Passed | 6189 |
| Failed | 0 |
| Skipped | 0 |
| Line coverage | 96.88% |
| Branch coverage | 91.67% |
| Function coverage | 94.89% |
| Coverage floor | 80% (AGENTS.md, "Testing") |
| Lint | `pnpm exec eslint .` clean, 0 findings; `pnpm exec prettier --check --end-of-line auto .` clean; `pnpm typecheck` clean for shared, api and web (web includes the e2e folder); `pnpm audit --prod --audit-level high` reports no known vulnerabilities |

## Failures
(none)

## Skips
(none)

## Notes

- One run covered 328 test files, API and web together; duration 547 s with `--maxWorkers=2`.
- Coverage is measured over `apps/api/src`, `apps/web/src` and `packages/shared/src` together, as
  AGENTS.md defines it. Statements were 95.19%.
- TDD evidence per block (the failing assertion seen before the code):
  - Block 1: 66 tests failed first (`setOpeningBalanceRequestSchema` and `SetOpeningBalance` were
    undefined), then 175 passed across the contracts, use case and repository files.
  - Block 2: 14 new route tests failed first with 404 (route missing), then the accounts API folder
    passed with 202 tests.
  - Block 3: 7 new tests failed first (`client.setAccountOpeningBalance is not a function`, missing
    builder module, missing catalog keys), then passed.
  - Block 4: 13 new tests failed first, then the two accounts web files passed with 129 tests.
- The Playwright spec `apps/web/e2e/accounts.spec.ts` gained one test (FEAT-006 AC-14, AC-15,
  AC-16, AC-19). It was typechecked with the web project and was not run in this ticket, as
  instructed.
- Per-block review: no implementer or reviewer subagent was spawned; each block was reviewed by the
  author against the spec (declared in the spec validation report).

## Run anomalies
None: no test failed, timed out or needed a retry, and no teardown hook stalled.

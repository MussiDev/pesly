# Test run DISC-001-03d

| Field | Value |
|---|---|
| Runner | vitest 5.0.1 (V8 coverage via @vitest/coverage-v8 5.0.1) |
| Command | `TEST_DATABASE_URL=postgres://argent:argent@localhost:5435/argent03d_test pnpm test:coverage --maxWorkers=4` |
| Total | 4527 |
| Passed | 4527 |
| Failed | 0 |
| Skipped | 0 |
| Line coverage | 97.23% |
| Branch coverage | 92.91% |
| Function coverage | 94.94% |
| Coverage floor | 80% lines, branches and functions (AGENTS.md, "Testing") |
| Lint | `pnpm exec eslint .` — clean, 0 findings; `pnpm exec prettier --check --end-of-line auto .` — clean; `pnpm typecheck` — clean |

## Scope

Closeout run of the ticket on branch `feat/DISC-001-03d-tags-filters` rebased onto `origin/main` 8cd9daf (the FEAT-004 redesign and DISC-001-07b with migration 0015), with the migration `0017_tags` at journal idx 16. Measured over `apps/api/src`, `apps/web/src` and `packages/shared/src` together, as AGENTS.md requires: 245 test files, 4527 tests (main's included), 1306 s. Every block's tests were run on their own as the blocks were built.

History of the closeout runs on this ticket, for the record:

- first run: one failure, the list of tables of the built migration in `test/deploy/build-output.test.ts` lacked `tags` and `movement_tags`, fixed in its own commit;
- run after the owner's accessibility decision: 3567 of 3567 before the rebase;
- first run after the rebase: 134 failures. Two causes, both fixed: the local test database had recorded migration 0017 (its `when` is greater than 0015's) before 0015 existed on the branch, so the migrator skipped 0015 on that database (recreated; the migration order on a database that has 0015 is correct and the journal order tests pin it), and the test files that assumed one newer migration were adapted (`identity/migration.test.ts` and `investments/price-migration.test.ts` now roll back `0017_tags` before `0015_price_snapshots`, and expect its journal idx 16; the home container fixtures gained the `tags` field that the movement response now requires);
- second run after the rebase: the run reported here.

Other suites run on the same tree:

- `pnpm e2e` (Playwright): 93/93 passed, 3.8 min, with `E2E_DATABASE_URL=postgres://argent:argent@localhost:5435/argent03d_y_e2e` (a fresh database) and the shared Mailpit; ports 3000, 4000 and 4100 were free before the run. A first run had two failures in `tags-filters.spec.ts` because the FEAT-004 redesign shows the saved confirmation as a status alert instead of a heading; the helper was updated and the whole suite run again;
- `pnpm test:perf`: 8 files, 9 tests passed with every threshold unchanged (filtered movement list under 500 ms at p95 with 100,000 movements, accounts list and saving a movement under 300 ms);
- `pnpm audit --prod --audit-level high`: no known vulnerabilities.

Decision of the owner (2026-10-03), recorded in the spec: Block 7's plan check asserts "no Sort node" only for the combined statement without the tag filter; with a tag filter the planner starts from the tag index and sorts the few hundred movements of that tag with a top-N heapsort, which the test asserts as bounded (no sequential scan of `movements`). The p95 limits are unchanged.

## Failures

(none)

## Skips

(none)

# Test run DISC-001-03d

| Field | Value |
|---|---|
| Runner | vitest 5.0.1 (V8 coverage via @vitest/coverage-v8 5.0.1) |
| Command | `TEST_DATABASE_URL=postgres://argent:argent@localhost:5435/argent03d_test pnpm exec vitest run --coverage --maxWorkers=2` |
| Total | 3567 |
| Passed | 3567 |
| Failed | 0 |
| Skipped | 0 |
| Line coverage | 97.15% |
| Branch coverage | 92.8% |
| Function coverage | 94.94% |
| Coverage floor | 80% lines, branches and functions (AGENTS.md, "Testing") |
| Lint | `pnpm exec eslint .` — clean, 0 findings; `pnpm exec prettier --check --end-of-line auto .` — clean; `pnpm typecheck` — clean |

## Scope

Closeout run of the ticket on branch `feat/DISC-001-03d-tags-filters` at the commit that adds the tags tables to the build-output migration check (branched from `origin/main` f889df9). Measured over `apps/api/src`, `apps/web/src` and `packages/shared/src` together, as AGENTS.md requires: 210 test files, 3567 tests, 1337 s. Every block's tests were run on their own as the blocks were built.

A first closeout run had one failure (`test/deploy/build-output.test.ts`, the list of tables created by the built migration did not yet include `tags` and `movement_tags`); the list was corrected in its own commit and the whole suite was run again. After the owner decided to fix the focus and `useSearchParams` debt (4 new web tests) the whole suite was run a third time, which is the run reported here.

Other suites run on the same tree:

- `pnpm e2e` (Playwright): 79/79 passed, 3.6 min, run again after the focus change, with `E2E_DATABASE_URL=postgres://argent:argent@localhost:5435/argent03d_v_e2e` (a fresh database) and the shared Mailpit; ports 3000, 4000 and 4100 were free before the run; the new flows are in `apps/web/e2e/tags-filters.spec.ts`;
- `pnpm test:perf`: 8 files, 9 tests passed; filtered movement list with 100,000 movements p95 30.6 ms (five filters), 41.0 ms (parent category), 22.4 ms (tag only) and 31.5 ms (unfiltered first page), all against a 500 ms threshold (NFR-01); accounts list p95 90.1 ms and saving a movement p95 36.2 ms against 300 ms. An earlier full perf run failed once in `accounts-list.perf.test.ts` and in the new filtered list test with warm-up requests timing out; four standalone reruns, an `EXPLAIN (ANALYZE, BUFFERS)` of the balance statement with and without the new indexes (identical plan, about 20 ms) and a clean full rerun showed it to be contention on the shared PostgreSQL and machine, not a code effect;
- `pnpm audit --prod --audit-level high`: no known vulnerabilities.

Decision of the owner (2026-10-03), recorded in the spec: Block 7's plan check asserts "no Sort node" only for the combined statement without the tag filter; with a tag filter the planner starts from the tag index and sorts the few hundred movements of that tag with a top-N heapsort, which the test asserts as bounded (no sequential scan of `movements`). The p95 limits are unchanged.

## Failures

(none)

## Skips

(none)

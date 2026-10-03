# Test run DISC-001-03d

| Field | Value |
|---|---|
| Runner | vitest 5.0.1 (V8 coverage via @vitest/coverage-v8 5.0.1) |
| Command | `TEST_DATABASE_URL=postgres://argent:argent@localhost:5435/argent03d_test pnpm test:coverage --maxWorkers=4` |
| Total | 4766 |
| Passed | 4766 |
| Failed | 0 |
| Skipped | 0 |
| Line coverage | 97.29% |
| Branch coverage | 92.99% |
| Function coverage | 95.03% |
| Coverage floor | 80% lines, branches and functions (AGENTS.md, "Testing") |
| Lint | `pnpm exec eslint .` — clean, 0 findings; `pnpm exec prettier --check --end-of-line auto .` — clean; `pnpm typecheck` — clean |

## Scope

Closeout run of the ticket on branch `feat/DISC-001-03d-tags-filters` rebased onto `origin/main` ca367d3 (DISC-001-03c merged, with FEAT-004 and DISC-001-07b before it), with the migration `0017_tags` at journal idx 17 after `0016_transfers_exchanges` (idx 16) and its cumulative snapshot `0017_snapshot.json`. Measured over `apps/api/src`, `apps/web/src` and `packages/shared/src` together, as AGENTS.md requires: 250 test files, 4766 tests (main's included), 1172 s. Every block's tests were run on their own as the blocks were built.

History of the closeout runs on this ticket, for the record:

- first run before any rebase: one failure (the table list of the built migration in `test/deploy/build-output.test.ts` lacked `tags` and `movement_tags`), fixed in its own commit;
- run after the owner's accessibility decision: 3567 of 3567;
- runs after the first rebase (onto 8cd9daf with FEAT-004 and 07b): 134 failures at first, caused by a local database that had recorded 0017 before 0015 existed (the migrator then skipped 0015; the database was recreated) and by tests that assumed one newer migration or fixtures without `tags`, all fixed; then 4527 of 4527;
- second rebase, onto ca367d3 with DISC-001-03c merged: conflicts in the shared movement schema, the movement domain types, the repository, the routes, the entry form and the movements list were resolved keeping both behaviors (tags only on expenses and income, transfers and exchanges answer no tags; the type filter accepts the four types; the account filter matches the source or the destination account). The tests that assumed two movement types or fixtures without `tags` were adapted, the 0014 rollback test now drops `movement_tags` before `movements`, and every migration test that rolls migrations back starts with `0017_tags`. This is the run reported here.

Other suites run on the same tree:

- `pnpm e2e` (Playwright): 97/97 passed, 4.8 min, with `E2E_DATABASE_URL=postgres://argent:argent@localhost:5435/argent03d_z_e2e` (a fresh database) and the shared Mailpit; ports 3000, 4000 and 4100 were free before the run;
- `pnpm test:perf`: 8 files, 11 tests passed with every threshold unchanged (filtered movement list under 500 ms at p95 with 100,000 movements, accounts list and saving a movement, a transfer and an exchange under 300 ms);
- `pnpm audit --prod --audit-level high`: no known vulnerabilities.

Decisions recorded in the spec about the performance plan check (owner, 2026-10-03, and the coordinator, 2026-10-04): the statement without an account or tag filter keeps a date-ordered index scan and no Sort node; a statement with a tag filter starts from the tag index and one with an account filter (which matches the source or the destination account) starts from the account or destination index, with a bounded top-N sort and no sequential scan of `movements`. The p95 limits are unchanged.

## Failures

(none)

## Skips

(none)

# Test run DISC-001-03e

| Field | Value |
|---|---|
| Runner | vitest 5.0.1 (V8 coverage via @vitest/coverage-v8 5.0.1) |
| Command | `TEST_DATABASE_URL=postgres://argent:argent@localhost:5435/pesly03e_test pnpm exec vitest run --coverage --maxWorkers=2` |
| Total | 4880 |
| Passed | 4880 |
| Failed | 0 |
| Skipped | 0 |
| Line coverage | 97.30% |
| Branch coverage | 92.96% |
| Function coverage | 95.06% |
| Coverage floor | 80% lines, branches and functions (AGENTS.md, "Testing") |
| Lint | `pnpm exec eslint .` — clean, 0 findings; `pnpm exec prettier --check --end-of-line auto .` — clean; `pnpm typecheck` — clean |

## Scope

Closeout run of the ticket on branch `feat/DISC-001-03e-edit-delete-movements`, created from `origin/main` 82acc3b (DISC-001-03b, 03c and 03d merged). Measured over `apps/api/src`, `apps/web/src` and `packages/shared/src` together, as AGENTS.md requires: 257 test files, 4880 tests (main's included), 1202 s. Every block's tests were first seen to fail and then run on their own as the blocks were built; the ticket adds no migration.

Other suites run on the same tree:

- `pnpm e2e` (Playwright): 99/99 passed, 4.8 min, with `E2E_DATABASE_URL` pointing at a fresh `_e2e` database on the shared PostgreSQL and Mailpit; ports 3000, 4000 and 4100 were free before the run. It includes the two flows of this ticket (edit from the list and delete after the confirmation; the edit route of another user's movement answering not found).
- `pnpm test:perf`: only the new file `movements-edit-delete.perf.test.ts` was run, 3 tests passed with `--disableConsoleIntercept`: edit with three tags p95 = 74.6 ms and delete p95 = 8.5 ms over 500 requests each, for a user with 100 accounts and 100,000 movements (limit 300 ms). The other perf files were not run: this ticket does not touch the list query, the create path or the accounts query they measure.
- `pnpm audit --prod --audit-level high`: no known vulnerabilities.

Notes on how the blocks were built, for the record:

- Blocks 2 and 3 share one commit, because the port change in Block 2 makes the Drizzle adapter of Block 3 fail to compile on its own.
- The 409 status of `MOVEMENT_TYPE_IMMUTABLE` and the web message mapping were added in Block 1, because `STATUS_BY_CODE` and the web message map are exhaustive over `ErrorCode`.
- The catalog texts planned for Block 6 were added in Blocks 7 and 8, where each is used and tested.
- No subagents were used (a standing instruction of the user): the per-block reviews were the block's tests, `tsc`, ESLint and Prettier.

## Failures

(none)

## Skips

(none)

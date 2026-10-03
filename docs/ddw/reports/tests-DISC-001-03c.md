# Test run DISC-001-03c

| Field | Value |
|---|---|
| Runner | vitest 5.0.1 (V8 coverage via @vitest/coverage-v8 5.0.1) |
| Command | `TEST_DATABASE_URL=postgres://argent:argent@localhost:5435/argent03c_test pnpm test:coverage --maxWorkers=4` |
| Total | 4157 |
| Passed | 4157 |
| Failed | 0 |
| Skipped | 0 |
| Line coverage | 97.46% |
| Branch coverage | 93.09% |
| Function coverage | 95.32% |
| Coverage floor | 80% lines, branches and functions (AGENTS.md, "Testing") |
| Lint | `pnpm exec eslint .` — clean, 0 findings; `pnpm exec prettier --check --end-of-line auto .` — clean; `pnpm typecheck` — clean |

## Scope

Closeout run of the ticket on the branch `feat/DISC-001-03c-transfers-exchange` (8 blocks, one commit each, rebased onto `origin/main` 40c8b09 after the FEAT-004 design system landed: 0 commits behind `origin/main` at the time of the run; migration `0016_transfers_exchanges`; main has no 0015 yet). Measured over `apps/api/src`, `apps/web/src` and `packages/shared/src` together, as AGENTS.md requires: 220 test files, 4157 tests, 1026 s. Every block's tests were run on their own as the blocks were built; the TDD evidence is in `docs/ddw/reports/tdd-DISC-001-03c.md`.

Before the rebase, a first full run without `--maxWorkers=4` showed 8 timeouts in concurrency tests (second-factor races, delete-user races, sessions, the movement write limiter and one totals test, 5 s limits) while other worktrees were loading the same machine and PostgreSQL server; each of those 5 files passed on its own, and the runs with 4 workers (before and after the rebase) passed with 0 failures.

Other suites run on the same tree:

- `pnpm e2e` (Playwright): 94/94 passed after the rebase, 4.2 min, with `E2E_DATABASE_URL=postgres://argent:argent@localhost:5435/argent03c_e2e` and the shared Mailpit; ports 3000, 4000 and 4100 were free; the four new flows are in `apps/web/e2e/movements.spec.ts`;
- `pnpm test:perf`: 7 files, 10 tests passed after the rebase; in isolation saving a transfer p95 44.9 ms and an exchange p95 49.0 ms against a 300 ms threshold (NFR-03), and the accounts list with 100 accounts and 100,000 movements (10% transfers and 10% exchanges) passed its threshold (NFR-06);
- `pnpm audit --prod --audit-level high`: no known vulnerabilities.

## Failures

(none)

## Skips

(none)

# Test run DISC-001-03c

| Field | Value |
|---|---|
| Runner | vitest 5.0.1 (V8 coverage via @vitest/coverage-v8 5.0.1) |
| Command | `TEST_DATABASE_URL=postgres://argent:argent@localhost:5435/argent03c_test pnpm test:coverage --maxWorkers=4` |
| Total | 3557 |
| Passed | 3557 |
| Failed | 0 |
| Skipped | 0 |
| Line coverage | 97.34% |
| Branch coverage | 93.05% |
| Function coverage | 95.15% |
| Coverage floor | 80% lines, branches and functions (AGENTS.md, "Testing") |
| Lint | `pnpm exec eslint .` — clean, 0 findings; `pnpm exec prettier --check --end-of-line auto .` — clean; `pnpm typecheck` — clean |

## Scope

Closeout run of the ticket on the branch `feat/DISC-001-03c-transfers-exchange` (8 blocks, one commit each, on top of `origin/main` f889df9, migration `0016_transfers_exchanges`). Measured over `apps/api/src`, `apps/web/src` and `packages/shared/src` together, as AGENTS.md requires: 205 test files, 3557 tests, 804 s. Every block's tests were run on their own as the blocks were built; the TDD evidence is in `docs/ddw/reports/tdd-DISC-001-03c.md`.

A first full run without `--maxWorkers=4` showed 8 timeouts in concurrency tests (second-factor races, delete-user races, sessions, the movement write limiter and one totals test, 5 s limits) while other worktrees were loading the same machine and PostgreSQL server; each of those 5 files passed on its own, and the full run with 4 workers passed with 0 failures. Nothing in the failing tests touches this ticket's behavior apart from the two movement files, which also passed alone.

Other suites run on the same tree:

- `pnpm e2e` (Playwright): 80/80 passed, 3.2 min, with `E2E_DATABASE_URL=postgres://argent:argent@localhost:5435/argent03c_e2e` and the shared Mailpit; ports 3000, 4000 and 4100 were free; the four new flows are in `apps/web/e2e/movements.spec.ts`;
- `pnpm test:perf`: 7 files, 10 tests passed; in isolation saving a transfer p95 44.9 ms and an exchange p95 49.0 ms against a 300 ms threshold (NFR-03), and the accounts list with 100 accounts and 100,000 movements (10% transfers and 10% exchanges) passed its threshold (NFR-06);
- `pnpm audit --prod --audit-level high`: no known vulnerabilities.

## Failures

(none)

## Skips

(none)

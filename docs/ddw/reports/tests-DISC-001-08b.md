# Test run DISC-001-08b

| Field | Value |
|---|---|
| Runner | vitest 5.0.1 (v8 coverage) |
| Command | `TEST_DATABASE_URL=postgres://argent:argent@127.0.0.1:5437/pesly08_test npx vitest run --coverage --maxWorkers=2` |
| Total | 6498 |
| Passed | 6498 |
| Failed | 0 |
| Skipped | 0 |
| Line coverage | 96.63% |
| Branch coverage | 90.98% |
| Function coverage | 94.78% |
| Coverage floor | 80% lines, 80% branches, 80% functions (AGENTS.md, "Testing") |
| Lint | `npx eslint .` clean, 0 findings; `npx prettier --check --end-of-line auto .` clean; `pnpm typecheck` clean |

Whole-repo run over 350 test files (`apps/api`, `apps/web`, `packages/shared`). Statement coverage is
94.88%. The run took 608 s.

## Failures
(none)

## Skips
(none)

## Run anomalies

- The final run used a throwaway PostgreSQL 16 container on port 5437 (tmpfs data, `fsync=off`,
  `max_connections=300`), created for this verification only. Four earlier full runs against the
  shared development container on port 5435 failed with 11, 21, 15 and 10 timed-out tests (5 s, 10 s
  and 30 s hooks) and `read ECONNRESET` from PostgreSQL. The failing tests changed on every run and
  concerned other modules (identity, investments, movements); each failing file passed when run alone
  (for example `sign-in.test.ts` with `recording-job.test.ts`: 23 of 23 in 4.9 s). I attribute them to
  the shared container dropping connections under load, not to the code of this ticket, and the green
  run above is the one that counts.
- A run with `--retry=2` was discarded: a retried migration-chain test leaves the shared database
  half rolled back and cascades failures into later files.
- No test, timeout, worker count or threshold was changed to obtain the green run. The 5 s and 10 s
  default timeouts applied in it.
- Tests for Blocks 1 to 4 were written before their code and seen failing first; six of the eight
  Block 5 tests assert behaviour built in earlier blocks and passed on their first run (the registry
  and guard tests), as the module verifier accepted.

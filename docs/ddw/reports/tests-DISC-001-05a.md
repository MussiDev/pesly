# Test run DISC-001-05a

| Field | Value |
|---|---|
| Runner | vitest 5.0.1 (V8 coverage via @vitest/coverage-v8 5.0.1) |
| Command | `TEST_DATABASE_URL=postgres://argent:argent@127.0.0.1:5435/pesly05a_full3_test pnpm exec vitest run --coverage --maxWorkers=2 --retry=2 --coverage.reportOnFailure=true` |
| Total | 6887 |
| Passed | 6887 |
| Failed | 0 |
| Skipped | 0 |
| Line coverage | 96.69% |
| Branch coverage | 90.87% |
| Function coverage | 94.58% |
| Coverage floor | 80% lines, branches and functions (AGENTS.md, "Testing") |
| Lint | `pnpm exec eslint .` — clean, 0 findings; `pnpm exec prettier --check --end-of-line auto .` — clean; `pnpm typecheck` — clean (shared, web, api) |

## Scope

Closeout run of the ticket on branch `feat/DISC-001-05a-groups` at commit `bf7dff5`, on the final code. Measured over `apps/api/src`, `apps/web/src` and `packages/shared/src` together, as AGENTS.md requires: 377 test files, 6887 tests, 688 s. The ticket adds one migration (0026, additive: five tables) and no dependency.

Other checks on the same tree:

- `pnpm audit --prod --audit-level high`: no known vulnerabilities; no dependency was added.
- The groups tests of this ticket: shared contract 36, API groups folder 117 tests (use cases, repository, membership reader, erasure step, token source, routes, flow, migration, introspection); the two concurrency tests (50th seat, one-use claim) passed 20 consecutive runs in the Block 4 run.
- `pnpm test:perf` was not run: the ticket adds new routes and tables only and changes no query that the benchmarks measure.
- No Playwright flow: the ticket has no web screen (spec, Summary and open question 3).

## Run anomalies

- Two earlier full runs on this branch were red and led to fixes: the first stopped on the erasure guard (`user-erasure.test.ts`) and the build output list, which did not know the five new tables (the ticket's own miss, fixed in `c0a6df2`); the second failed one test, the composition root regex of `test/movements/erasure-step.test.ts`, which did not expect the new `eraseUserGroups` step in `server.ts` (fixed in `bf7dff5`). The run reported above is the third, on the final code, and is fully green.
- Test files were run against `127.0.0.1` and not `localhost`: connections through `localhost:5435` hung intermittently on this machine during Block 4.

## Deviations from the spec, for the record

- Block 1: an extra API test file, `apps/api/test/groups/error-status.test.ts`, checks the HTTP status of the four new codes through the real error middleware.
- Block 5: `createGroupRoutes` takes an optional `clock`, so the tests can move time to prove the 7-day invitation expiry.
- The erasure registry test and the build output list were updated for the new tables, as in previous tickets (not in the spec's file lists).
- Subagents wrote and verified the blocks: implementer and verifier were different agents per block.

## Failures

(none)

## Skips

(none)

# Test run DISC-001-06a

| Field | Value |
|---|---|
| Runner | vitest 5.0.1 (V8 coverage via @vitest/coverage-v8 5.0.1) |
| Command | `pnpm exec vitest run --coverage --maxWorkers=2` with `TEST_DATABASE_URL` pointing at the local PostgreSQL (port 5435) |
| Total | 8285 |
| Passed | 8285 |
| Failed | 0 |
| Skipped | 0 |
| Line coverage | 96.97% |
| Branch coverage | 90.8% |
| Function coverage | 94.93% |
| Statement coverage | 95.14% |
| Coverage floor | 80% lines, branches and functions (AGENTS.md, "Testing") |
| Lint | `pnpm exec eslint .` clean after the SAST fix (`40271f7`); see `docs/ddw/security/sast-DISC-001-06a.md` |

## Scope

Closeout run of the ticket on the branch of DISC-001-06a, measured over `apps/api/src`, `apps/web/src` and `packages/shared/src` together, as AGENTS.md requires: 476 test files, 8285 tests. The ticket adds one migration (0033, additive: two tables, `goals` and `goal_entries`) and no dependency.

How the 8285 figure is made up: the full coverage run executed 8285 tests, of which 8266 passed and 19 failed (see Run anomalies). After the fix in commit `2ed7f63`, the 13 `*migration*.test.ts` files (185 tests, which contain the 19) were re-run and all passed. Passed = 8266 from the full run + 19 from that re-run. The coverage figures come from the full run; the fix touched only test files, so they do not move.

Other checks:

- Goals tests of this ticket: shared contract `packages/shared/test/goal-schemas.test.ts`, and the API folder `apps/api/test/goals` (use cases, progress rules, repository, account balances, time zone, routes, flow, migration, introspection, erasure step, error status, no-float scan).
- Performance: `apps/api/test/perf/goals-list.perf.test.ts` measured `GET /goals` at p95 73.4 ms over 300 requests, with 100,000 movements and 55 goals (limit 500 ms, NFR-02).
- The no-float scan (`apps/api/test/goals/no-float-money.test.ts`) passes.
- Module cross-check (an agent that did not write the code): no blocking defects. Lows: the entries list has no cursor (06e needs pagination); there is no database-level same-currency check on the account link; `viewsOf` defaults to 0 progress when a linked account is missing (unreachable through the foreign key). One finding was fixed: spec D6 cap aligned to `MOVEMENT_AMOUNT_MAX_MINOR_UNITS` (10^15).
- SAST: 0 Critical, 0 High, 0 Medium; the one lint error was fixed in `40271f7`.
- No Playwright flow: the ticket has no web screen (spec, Summary and open question 4).

## Run anomalies

- The first full run reported 19 failed tests, all in four migration-listing test files: `investments-migration`, `price-migration`, `notices-migration` and `auto-recording-migration`. They list the journal and the tables and had not been updated for migration 0033 (the ticket's own miss). Fixed in `2ed7f63`; the 13 `*migration*.test.ts` files (185 tests) then passed.
- The reported run is not one single uninterrupted pass: the 19 tests that failed were re-run through their 13 files, not through a second full run.

## Deviations from the spec, for the record

- Block 1: an extra API test file, `apps/api/test/goals/error-status.test.ts`, checks the HTTP status of the new codes through the real error middleware.
- An extra `routes-harness.ts` shared by the route and flow tests.
- Spec D6 was changed during the cross-check: the progress cap is `MOVEMENT_AMOUNT_MAX_MINOR_UNITS` (10^15).
- Four existing migration tests were updated for 0033 (not in the spec's file lists).

## Failures

(none)

## Skips

(none)

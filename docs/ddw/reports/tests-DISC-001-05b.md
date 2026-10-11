# Test run DISC-001-05b

| Field | Value |
|---|---|
| Runner | vitest 5.0.1 (V8 coverage via @vitest/coverage-v8) |
| Command | `TEST_DATABASE_URL=postgres://argent:argent@127.0.0.1:5435/<test database> pnpm exec vitest run --coverage --maxWorkers=2` |
| Total | 7028 |
| Passed | 7028 |
| Failed | 0 |
| Skipped | 0 |
| Line coverage | 96.70% |
| Branch coverage | 90.78% |
| Function coverage | 94.51% |
| Coverage floor | 80% lines, branches and functions (AGENTS.md, "Testing") |
| Lint | `pnpm exec eslint` over `apps/api/src/groups`, `apps/api/test/groups`, `packages/shared/src/groups`, `packages/shared/src/money` and `packages/shared/test` — clean, 0 findings; `pnpm exec prettier --check --end-of-line auto` over the same paths, `packages/shared/src` and the new SAST report — clean; `pnpm typecheck` — clean (shared, web, api) |

## Scope

Closeout run of the ticket on branch `feat/DISC-001-05b-group-expenses` at commit `47102bc` (all five blocks committed), on the final code. Measured over `apps/api/src`, `apps/web/src` and `packages/shared/src` together, as AGENTS.md requires: 386 test files, 7028 tests, 740.9 s. The ticket adds one migration (0027, additive: four tables and one column) and no dependency. Suite coverage: statements 94.87% (12558 of 13237), branches 90.78% (7076 of 7794), functions 94.51% (3359 of 3554), lines 96.70% (11469 of 11860).

Ticket code on its own (14 source files: the six use cases, the two ports, `domain/group-expense.ts`, `drizzle-group-expense-repository.ts`, `drizzle-payer-movement-recorder.ts`, `group-expense-presenter.ts`, `packages/shared/src/groups/expense.ts` and `packages/shared/src/money/split-expense.ts`): 305 of 306 lines (99.67%), 164 of 185 branches (88.65%), 101 of 101 functions (100%). The shared `group-routes.ts` is exercised by the route tests and counted in the suite figures only.

Other checks on the same tree:

- `pnpm audit --prod --audit-level high`: no known vulnerabilities; no dependency was added.
- Ticket tests: shared `split-expense.test.ts` (including the property tests, 10,000 seeded splits in each of the equal, percentage and exact modes) and `group-expense-schemas.test.ts`; API `apps/api/test/groups`: `expense-use-cases`, `drizzle-group-expense-repository` (including 20 concurrent creations), `payer-movement-recorder`, `group-expense-routes`, `expense-audit`, `expenses-migration`, `expenses-schema-introspection`, `error-status`.
- `pnpm test:perf` was not run: the ticket adds new routes and tables only and changes no query that the benchmarks measure.
- No Playwright flow: the ticket has no web screen (spec, Summary and open question 3).

## Run anomalies

- The run printed one `getaddrinfo ENOTFOUND api.argent.test` line before the summary; it comes from an existing web test that tries a fake hostname, did not fail any test and is not related to this ticket.
- The ticket changed existing test files that list the migrations and the erasure registry (`apps/api/test/identity/migration.test.ts`, `apps/api/test/identity/user-erasure.test.ts`, `apps/api/test/investments/*-migration.test.ts`, `apps/api/test/notices/notices-migration.test.ts`, `apps/api/test/recurring/auto-recording-migration.test.ts`, `apps/api/test/deploy/build-output.test.ts`, `apps/api/test/groups/migration.test.ts`) so they know the four new tables and the new journal entry, as in previous tickets.

## Deviations from the spec, for the record

- Block 3: AC-21 (claimed ghost) is tested as a personal view of 2 items, each expense being one item, and not literally "3 shares"; the expense and share data come from the same rows.
- Block 3: the "more than 1 day ahead" rule of D13 is checked in the use case with the injected `Clock`, and the payer's movement date is clamped to the last instant of today in the payer's time zone because movements refuse a later date; the clamp has its own tests.
- Block 1: the amount maximum is the movement maximum, 10^15 minor units (spec D13 wording "within `MINOR_UNITS_MAX`" refers to the shared bound, `bigint` 64-bit, which is wider).
- Extra test files beyond the spec lists: `expenses-schema-introspection.test.ts`, `error-status.test.ts` (extended with the `details` echo test).

## Failures

(none)

## Skips

(none)

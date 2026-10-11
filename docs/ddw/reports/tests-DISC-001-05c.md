# Test run DISC-001-05c

| Field | Value |
|---|---|
| Runner | vitest 5.0.1 (V8 coverage via @vitest/coverage-v8) |
| Command | `TEST_DATABASE_URL=postgres://argent:argent@127.0.0.1:5435/<test database> npx vitest run --coverage --maxWorkers=2 --retry=2 --coverage.reportOnFailure=true` |
| Total | 7231 |
| Passed | 7231 |
| Failed | 0 |
| Skipped | 0 |
| Line coverage | 96.76% |
| Branch coverage | 90.78% |
| Function coverage | 94.50% |
| Coverage floor | 80% lines, branches and functions (AGENTS.md, "Testing") |
| Lint | `pnpm exec eslint` over `apps/api/src/groups`, `apps/api/test/groups`, `packages/shared/src` and `packages/shared/test` — clean, 0 findings (exit 0, run again for this report); `pnpm typecheck` — clean (shared, web, api; run again for this report); `pnpm lint` as a whole stops only at `prettier --check` because of the repository's CRLF checkout on Windows, a known condition that is not related to this ticket |

## Scope

Closeout run of the ticket on branch `feat/DISC-001-05c-balances-settlements` at commit `14556ad` (all six blocks and the SAST fixes committed), on the final code. Measured over `apps/api/src`, `apps/web/src` and `packages/shared/src` together, as AGENTS.md requires: 402 test files, 7231 tests, 840.5 s, in a fresh `_test` database. Suite coverage: statements 94.90% (12975 of 13671), branches 90.78% (7293 of 8033), functions 94.50% (3459 of 3660), lines 96.76% (11837 of 12233). I did not re-run the suite for this report; the figures come from the log of that run and from `coverage/coverage-summary.json`, written after the last commit. The ticket adds one migration (0028, additive for data: two tables, one column, one index replaced and one check replaced) and no dependency.

Ticket code on its own (17 source files with executable code: `groups/domain/settlement.ts`, the six use cases `get-balances`, `record-settlement`, `preview-consolidation`, `list-settlements`, `remove-member` and `leave-group`, `drizzle-group-settlement-repository.ts`, `group-locks.ts`, `keyset-cursor.ts`, `member-balances.ts`, `drizzle-settlement-account-checker.ts`, `drizzle-rate-reader.ts`, `group-settlement-presenter.ts`, `packages/shared/src/groups/settlement.ts`, `packages/shared/src/money/simplify-debts.ts` and `packages/shared/src/money/convert-minor-units.ts`; the three new ports are interfaces and have no executable code): 305 of 307 lines (99.35%), 209 of 230 branches (90.87%), 82 of 84 functions (97.62%). The changed parts of `drizzle-group-repository.ts`, `drizzle-group-expense-repository.ts`, `drizzle-account-movements.ts` and the shared `group-routes.ts` are exercised by their tests and counted in the suite figures only.

Other checks on the same tree:

- `pnpm audit --prod --audit-level high`: no known vulnerabilities (SAST report, F-SAST-13); no dependency was added.
- Ticket tests: shared `simplify-debts.test.ts` (including the property test, 10,000 seeded zero-sum sets), `convert-minor-units.test.ts` and `group-settlement-schemas.test.ts`; API `apps/api/test/groups`: `settlement-use-cases` (including 10,000 random operations on the in-memory fakes), `settlement-account-balance`, `settlement-account-checker-rate-reader`, `drizzle-group-settlement-repository` (including 20 concurrent settlements and the lock-wait cases), `drizzle-member-removal` (including the concurrent removal and expense), `former-member-erasure`, `group-settlement-routes`, `settlement-audit`, `settlement-overflow`, `balances-random-operations` (10,000 random operations on PostgreSQL against an independent ledger), `settlements-migration`, `settlements-schema-introspection`, `group-presenter-former`, `error-status`.
- Benchmarks (NFR-03), `apps/api/test/perf/group-balances.perf.test.ts`: with 50 members, 10,000 expenses and 500 settlements the p95 of 20 balance reads is about 28 ms against the limit of 500 ms; in the worst case, with all 50 members sharing every expense (500,000 share rows), the p95 is about 60 ms. Measured by the implementer, who ran the whole perf suite with `pnpm test:perf` (22 tests passed); I did not re-run it for this report. The 10,000 random operations on PostgreSQL took about 37 s.
- No Playwright flow: the ticket has no web screen (spec, Summary).

## Run anomalies

- The run printed one `getaddrinfo ENOTFOUND api.argent.test` line before the summary; it comes from an existing web test that tries a fake hostname, did not fail any test and is not related to this ticket.
- The run used `--retry=2`. 0 tests are reported failed; I did not inspect whether any test passed only on a retry, so a flaky test, if any, is not ruled out by this report.
- The ticket changed existing test files that list the migrations and the erasure registry (`apps/api/test/identity/migration.test.ts`, `apps/api/test/identity/user-erasure.test.ts`, `apps/api/test/investments/investments-migration.test.ts`, `apps/api/test/investments/price-migration.test.ts`, `apps/api/test/notices/notices-migration.test.ts`, `apps/api/test/recurring/auto-recording-migration.test.ts`, `apps/api/test/deploy/build-output.test.ts`, `apps/api/test/groups/migration.test.ts`, `apps/api/test/groups/expenses-migration.test.ts`) so they know the new tables and the new journal entry, as in previous tickets.
- Coverage anomalies in ticket code: `presentBalances` in `domain/settlement.ts` has its two callbacks for "former members that still have a balance" unreached (lines 120-121), because a member can only leave at balance 0 and the tests never build that state; the other gaps are defensive branches (the "group detail is null" guard after the membership check in `get-balances.ts:23`, `record-settlement.ts:77` and `preview-consolidation.ts:39`, the "no row returned" throws, the foreign-key and check constraint names the tests do not each provoke in `drizzle-group-settlement-repository.ts:81-85`, the `Array.isArray` and round-trip guards of `keyset-cursor.ts:34,38`, and the `undefined` guards of `simplify-debts.ts` that its own assertions make unreachable).

## Deviations from the spec, for the record

- Block 4: the benchmark is one test with two scenarios (the realistic one and the worst case in which all 50 members share every expense, added after the SAST review); the spec listed only the first.
- Block 5: `removeMember` also rejects a removal of the caller on the admin route (`CannotRemoveSelf`, 400), so the sole-member and last-admin cases go through `POST /groups/:id/leave`; this is the use case's reading of "never self" in D9.
- Commit `14556ad` (after the SAST review) added the cash guard of a consolidation (`SettlementCashTooLarge`, 400 `VALIDATION_FAILED`) and the group lock of `setDefaultSplit`, which the spec did not list; both have their own tests (`settlement-overflow.test.ts`, `drizzle-group-expense-repository.test.ts`).
- Extra test files beyond the spec lists: `settlements-schema-introspection.test.ts`, `settlement-overflow.test.ts`, `settlement-account-checker-rate-reader.test.ts`, `group-presenter-former.test.ts` and `error-status.test.ts` (extended with the six new codes).

## Failures

(none)

## Skips

(none)

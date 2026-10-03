# Verification DISC-001-03c

| Field | Value |
|---|---|
| Module | apps/api/src/movements, packages/shared/src/movements, apps/web/src/features/movements |
| Line coverage | 97.46% |
| Branch coverage | 93.09% |
| Function coverage | 95.32% |
| Coverage floor | 80% lines, branches and functions (AGENTS.md, "Testing") |
| Lint | `pnpm exec eslint .` — clean, 0 findings; `pnpm typecheck` — clean; `prettier --check --end-of-line auto .` — clean; `drizzle-kit check` — clean |

The branch was rebased onto `origin/main` 40c8b09 (FEAT-004 design system) after this verification; the web files of the entry screen, the row and the saved notice were reconciled with the redesign, the closeout suite was re-run (4157 of 4157 tests, e2e 94 of 94, perf, lint, typecheck, audit) and the figures below are from that re-run.

Whole-module cross-check by an independent verifier that did not write the code (agent `ddw-module-verifier`), against the PRD, the spec, the TDD report, the test report and the SAST report, plus a whole-branch architecture audit (0 FAIL, 3 WARN). The coverage numbers are those of the closeout run in `docs/ddw/reports/tests-DISC-001-03c.md` (full suite, measured over `apps/api/src`, `apps/web/src` and `packages/shared/src` together); the verifier re-ran 17 test files one at a time, eslint on every changed file, `pnpm typecheck` and `drizzle-kit check`, and did not re-run the full suite. By directory over the code of this ticket the lowest function coverage is 80% (`apps/api/src/movements/infrastructure/db`, whose `schema.ts` column builders only run under drizzle-kit), the lowest line coverage 91.54% and the lowest branch coverage 89.47% (`apps/api/src/movements/infrastructure/http`). DDW does not run the suite: these numbers are the report of what was run.

Decision note: the human decisions of 2026-10-02 (Q1 half-up rounding of the implied rate, Q2 the rules of DISC-001-03b apply to transfers and exchanges, single-row storage with a destination account and amount, category null and rate only on exchanges, rollback that deletes transfer and exchange rows) are recorded in the PRD decision log and the spec.

## Acceptance criteria
- ✅ AC-01 — `CreateMovement.execute` transfer branch (apps/api/src/movements/application/create-movement.ts); test `stores a transfer with the scope owner, no category, no rate and destinationAmount equal to amount`, route test `saves a transfer and an exchange and lists them`
- ✅ AC-02 — `MovementSameAccount` and `MovementCurrencyMismatch` in create-movement.ts; tests `rejects the same account and an ARS to USD transfer`, route test `answers 400 for the same account, a currency mismatch`
- ✅ AC-03 — `CreateMovement.execute` exchange branch; test `stores an ARS-out USD-in exchange and the reverse direction`
- ✅ AC-04 — `ExchangeSameCurrency`; tests `rejects an exchange between accounts of the same currency` and the route test for 400 EXCHANGE_SAME_CURRENCY
- ✅ AC-05 — `impliedRate` (packages/shared/src/movements/implied-rate.ts); tests `computes 1,557.3000` and `derives the implied rate half-up and ignores a client rate or rateSource`
- ✅ AC-06 — `sumsByAccount` and `hasMovements` (apps/api/src/movements/infrastructure/accounts/drizzle-account-movements.ts); tests in real-adapters.test.ts (`a transfer lowers the source`, `an exchange lowers the ARS account`), totals.test.ts and the route test `changes the balances by the source and destination amounts`
- ✅ AC-07 — date check in `CreateMovement.execute` before the account lookups; tests `rejects a local date after today and accepts a UTC-tomorrow instant` and the route test for 400 MOVEMENT_DATE_IN_FUTURE
- ✅ AC-08 — `listMovementsQuery` and `toMovement` (drizzle-movement-repository.ts); tests `lists transfers and exchanges with expenses and income, newest first` and the web list test `lists a transfer and an exchange newest first`
- ✅ AC-09 — `notFoundUnlessAllowed`, the owner-scoped account lookup and the composite key `movements_destination_owner_fk`; tests `answers 404 for a foreign or unknown source or destination`, `rejects a destination account of another owner` and the route test for 404 NOT_FOUND
- ✅ AC-10 — `MovementAccountArchived`; tests `rejects an archived source or destination and works again once unarchived` and the route test for 409 ACCOUNT_ARCHIVED
- ✅ AC-11 — `movementAmountSchema` and the check `movements_destination_amount_range_check`; tests `rejects 0, negative, malformed and above-10^15 amounts on both amount fields` and the route test naming `body.amount` and `body.destinationAmount`
- ✅ AC-12 — `movementNoteSchema`; tests `rejects a note of 501 characters and a control character` and the route test naming `body.note`
- ✅ AC-13 — `RecordManualMovement.execute` wrapping all four types; tests `shares the limit of 60 across the four types and refunds an unsaved creation` and the route test `shares the limit of 60 per minute across the four types`
- ✅ AC-14 — `impliedRate` half-up; tests `rounds half-up: 2,000.00 ARS for 3.00 USD is 6,666,667`, `rounds an exact tie up` and the web preview test showing 666,6667
- ✅ AC-15 — `impliedRate` returns null and `ImpliedRateOutOfRange`; tests `returns null for a result of 0 or above RATE_MAX scaled`, `rejects an implied rate of 0 or above RATE_MAX` and the route test for 400 IMPLIED_RATE_OUT_OF_RANGE

## Spec blocks
- ✅ Block 1 — shared contracts and the implied-rate helper: movement-schemas and implied-rate tests; every task done and every promised test present and passing
- ✅ Block 2 — domain, ports and use cases: create-transfer-exchange, create-movement and record-manual-movement tests; every task done and every promised test present and passing
- ✅ Block 3 — persistence, migration 0016 and the repository: transfer-exchange-repository, movement-repository, schema-introspection, erasure-step, lookups and the 0016 describe in migration.test.ts; every task done and every promised test present and passing
- ✅ Block 4 — balances adapter: real-adapters, totals and account-obligations tests; every task done and every promised test present and passing
- ✅ Block 5 — HTTP and composition: transfer-exchange-routes, movement-routes, error-handler and validate tests; every task done and every promised test present and passing
- ✅ Block 6 — web client and the entry screen: movement-request, movements-components, movements-containers, api-client-movements and i18n-catalogs tests; every task done and every promised test present and passing
- ✅ Block 7 — the list shows transfers and exchanges: movements-list tests; every task done and every promised test present and passing
- ✅ Block 8 — end to end, performance and scans: movements.spec.ts, movements-save.perf, no-float-money and request-path tests; every task done and every promised test present and passing (the currency-rule errors are checked through the API plus picker exclusion in e2e, and as field messages in container tests)

## Tests
- ✅ Sad-path tests: every input has an invalid-input test: the create body (amount 0, negative, over 10^15, missing destination fields, note over 500 or with a control character, non-UUID destination), the use case (same account, currency mismatch, same currency, rate out of range, future date, foreign and unknown accounts, archived accounts, the 61st creation), the database (check violations, foreign owner key, vanished destination), the web request builder (same account, wrong currency pair, amounts, note, date) and the error mapping of each new code
- ✅ NFR strategy evidence: NFR-01 and NFR-02 by the introspection and no-float scans, NFR-03 by the performance test (transfer p95 44.9 ms, exchange p95 49.0 ms against 300 ms), NFR-04 by the owner-scoped queries and the AC-09 tests at use case, repository, route and e2e level
- ✅ Coverage: 97.46% lines, 93.09% branches, 95.32% functions, all above the 80% floor

## Warnings (do not block)
- ⚠️ W1: two route tests check status only (the 401/403 test and the 201 after unarchiving in AC-10); every other route assertion checks the body and the stored data.
- ⚠️ W2: no recorded evidence of the second `drizzle-kit generate` reporting no changes in the verifier's own run (the Block 3 implementer reported it, `drizzle-kit check` is clean).
- ⚠️ W3: fragile tests: the 0016 describe in migration.test.ts shares state across its five tests (the same pattern as earlier migrations), the movements save performance tests share a module-level counter and are timing based, and one use-case test reads a private field through a cast.
- ⚠️ W4: the no-float scan flags `Math.round` but not other `Math.` calls; `implied-rate.ts` is clean, so this is a guard gap, not a violation.
- ⚠️ W5: the e2e flow does not drive the UI messages for MOVEMENT_CURRENCY_MISMATCH and EXCHANGE_SAME_CURRENCY (the picker makes those states unreachable); they are covered in container tests and through the API in e2e.
- ⚠️ W6: TDD evidence notes: Block 1 reports 12 tests and 13 exist (the extra one could not have passed on the old schema); the Block 3 migration tests, the performance test and the e2e flows were not red first, as the TDD report discloses; the verifier did not re-run the red phase.
- ⚠️ W7: whole-branch architecture audit advisories: the empty-note rule is normalized in both the use case and the repository, the rollback script deletes transfer and exchange rows (approved and documented), and an exchange row shows a placeholder currency when its destination account is not among the loaded ones.
- ⚠️ W8: the migration number 0016 and its journal `when` 1790991879498 must be re-checked against `main`, 07b and 03d at merge (spec D7); the 03d branch also edits the same migration tests.

Result: PASSED

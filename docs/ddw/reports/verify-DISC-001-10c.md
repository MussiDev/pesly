# Verification DISC-001-10c

| Field | Value |
|---|---|
| Module | `apps/api/src/credit-cards`, `apps/api/src/movements/infrastructure/credit-cards`, `packages/shared/src/credit-cards` and `money/split-installments.ts`, migration `0020_installments`, `apps/web/src/features/credit-cards` |
| Line coverage | 94.28% (ticket code, 40 files); suite 96.81% |
| Branch coverage | 87.44% (ticket code); suite 91.93% |
| Function coverage | 93.54% (ticket code); suite 94.84% |
| Coverage floor | 80% lines, branches and functions (AGENTS.md, "Testing") |
| Lint | `pnpm exec eslint .` — clean, 0 findings; `pnpm exec prettier --check --end-of-line auto .` — clean; `pnpm typecheck` — clean |

Written by the agent that wrote the code: no module-verifier cross-check was run (see the tests report, deviations). The suite figures come from the full run in `docs/ddw/reports/tests-DISC-001-10c.md` (5800 of 5800 tests passed, no anomalies). The numbers are my report of what I ran, not something this document proves.

## Acceptance criteria
- ✅ AC-01 — `CreateInstallmentPurchase.execute` (`apps/api/src/credit-cards/application/create-installment-purchase.ts`); `installments.test.ts` "stores 120,000.00 ARS in 12 installments of 10,000.00 ARS (AC-01)"; `installment-routes.test.ts` "answers 201 with 12 installments for 120,000.00 ARS and lists it (AC-01)"; `installment-purchase.test.tsx` "posts 120.000,00 in 12 installments and returns to the card page (AC-01)".
- ✅ AC-02 — `createInstallmentPurchaseRequestSchema` (`packages/shared/src/credit-cards/installment.ts`); `installment-schemas.test.ts` "rejects 1 and 61 installments (AC-02)"; `installment-routes.test.ts` "answers 400 for 1 and for 61 installments and stores nothing (AC-02, invalid input)"; `installment-request.test.ts` "refuses 1 installments with a field message and no request (AC-02)"; `installment-purchase.test.tsx` "shows the field message for 1 and for 61 installments and sends nothing (AC-02)".
- ✅ AC-03 — the literal `currency: 'ARS'` of the same schema; `installment-schemas.test.ts` "rejects the currency USD (AC-03)"; `installment-routes.test.ts` "answers 400 for USD, an amount below the count and an unknown key and stores nothing (AC-03, invalid input)"; `installment-purchase.test.tsx` "has no currency choice and offers only open expense categories (AC-03)".
- ✅ AC-04 — `splitInstallments` (`packages/shared/src/money/split-installments.ts`); `installment-schemas.test.ts` "splits 100.00 ARS in 3 into 3334, 3333 and 3333 minor units (AC-04)"; `installments.test.ts` "gives 33.34, 33.33 and 33.33 ARS for 100.00 ARS in 3 installments (AC-04)"; `installment-routes.test.ts` "splits 100.00 ARS in 3 into 33.34, 33.33 and 33.33 (AC-04)".
- ✅ AC-05 — `planInstallments` and `assignStatement` (`apps/api/src/credit-cards/domain/installment.ts`); `installments.test.ts` "assigns the installments to the statements closing 2026-10-24, 2026-11-24 and 2026-12-24 (AC-05)"; `installment-routes.test.ts` "reads the installments in the statements closing 2026-10-24, 2026-11-24 and 2026-12-24 (AC-05)".
- ✅ AC-06 — `monthlyInstallmentExpenses` and `ListInstallmentExpenses`; `installments.test.ts` "counts only the installment of the month: 10,000.00 ARS in November 2026, not the rest (AC-06)"; `installment-routes.test.ts` "counts only the installment of November 2026 for its category: 10,000.00 ARS (AC-06)".
- ✅ AC-07 — `addInstallmentTotals` in `ListStatements`; `installments.test.ts` "adds the installment to the purchases of the statement: 60,000.00 ARS and 20.00 USD (AC-07)"; `installment-routes.test.ts` "reads totals of 60,000.00 ARS and 20.00 USD for purchases plus an installment (AC-07)"; `installment-purchase.test.tsx` "lists the installment inside its statement with the totals of both currencies (AC-07)".
- ✅ AC-08 — `pendingDebt` in `ListInstallmentPurchases`; `installments.test.ts` "shows a pending debt of 110,000.00 ARS for 11 installments in statements not yet closed (AC-08)"; `installment-routes.test.ts` "shows a pending debt of 110,000.00 ARS once the first statement closed (AC-08)"; `installment-purchase.test.tsx` "shows a pending debt of 110,000.00 ARS in English (AC-08)" and the Spanish case.
- ✅ AC-09 — `DeleteInstallmentPurchase` and `removeInstallments`; `installments.test.ts` "removes the 10 installments of open statements and keeps the 2 of closed ones (AC-09)"; `installment-repository.test.ts` "keeps the closed installments and cancels the purchase, then deletes it when none remain (AC-09)"; `installment-routes.test.ts` "removes the 10 open installments and keeps the 2 of closed statements (AC-09)"; `installment-purchase.test.tsx` "asks for confirmation, deletes the purchase and reloads the list (AC-09)".
- ✅ AC-10 — scoped repository and `notFoundUnlessAllowed`; `installments.test.ts` "answers ResourceNotFound to another user's get, edit and delete and changes nothing (AC-10)"; `installment-repository.test.ts` "gives another user a scope with nothing to read and nothing to change (AC-10, sad path)"; `installment-routes.test.ts` "answers 404 to Bob for get, edit, delete and list and changes nothing (AC-10)".

## Spec blocks
- ✅ Block 1 — shared contract and split: every task done; `installment-schemas.test.ts` holds the listed tests, including the 10,000-purchase exact-sum test (NFR-03) and the `RangeError` cases; `credit-card-schemas.test.ts` covers the statement `installments` list.
- ✅ Block 2 — persistence: every task done; `installment-repository.test.ts`, `schema-introspection.test.ts`, `erasure-step.test.ts` and the 0020 describe of `migration.test.ts`; deviation recorded in the tests report (`owner_id` on `installments`).
- ✅ Block 3 — domain and use cases: every task done; `installments.test.ts` (22 tests) and the updated `use-cases.test.ts`.
- ✅ Block 4 — adapters, routes and composition: every task done; `installment-routes.test.ts` (19 tests), `installment-adapters.test.ts`, the perf test `credit-card-statements.perf.test.ts` (p95 54.4 ms, NFR-02) and the unchanged `architecture-boundaries.test.ts`.
- ✅ Block 5 — web client and request builder: every task done; `api-client-credit-cards.test.ts` and `installment-request.test.ts`.
- ✅ Block 6 — web screens: every task done; `installment-purchase.test.tsx`, `credit-card-detail.test.tsx` and the catalog key-equality test.
- ✅ Block 7 — end to end: `apps/web/e2e/credit-cards-installments.spec.ts` is written, lints and typechecks; it was not run here (shared ports), the orchestrator runs it.

## Tests
- ✅ Sad-path tests: the schemas (counts 1 and 61, USD, amount below the count, unknown key, zero-width note, inverted range), the routes (a future date, archived, income and foreign categories, the 61st creation answering 429, no session, unverified email, a foreign user, a cancelled purchase, deleting a card or a category in use), the repository (foreign scope, rollback of a refused row, database-level category checks), the adapters (rejected categories, exhausted limit) and the web form (counts 1 and 61, 404 on load and save, 429 with Retry-After, network failure, archived category, failed delete).
- ⚠️ NFR-02 is checked by one local run of the benchmark (p95 54.4 ms); it depends on the machine and runs with `pnpm test:perf`, not with the suite.
- ⚠️ Editing a purchase (category and note) is covered by API tests only; the web app has no edit screen (decision for the owner).
- ⚠️ The Playwright flow was written but not run in this ticket.

Result: PASSED

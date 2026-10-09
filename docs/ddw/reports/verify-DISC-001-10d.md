# Verification DISC-001-10d

| Field | Value |
|---|---|
| Module | `apps/api/src/credit-cards` (domain `statement-payment.ts`, `statement-views.ts`, `record-statement-payment.ts`, ports), `apps/api/src/movements/infrastructure/credit-cards` (`drizzle-card-payments.ts`, `drizzle-statement-payment-recorder.ts`), `packages/shared/src/credit-cards/statement-payment.ts`, `apps/web/src/features/credit-cards` (payment form, container, request builder, statement rows) |
| Line coverage | 95.86% (ticket code, 17 files, statements); suite 96.78% |
| Branch coverage | 84.44% (ticket code); suite 91.91% |
| Function coverage | 95.73% (ticket code); suite 94.79% |
| Coverage floor | 80% lines, branches and functions (AGENTS.md, "Testing") |
| Lint | `pnpm exec eslint .` — clean, 0 findings; `pnpm exec prettier --check --end-of-line auto .` — clean; `pnpm typecheck` — clean |

Written by the agent that wrote the code: no module-verifier cross-check was run (see the tests report, deviations). The suite figures come from the full run in `docs/ddw/reports/tests-DISC-001-10d.md` (5883 of 5883 tests passed, no anomalies). The numbers are my report of what I ran, not something this document proves.

## Acceptance criteria
- ✅ AC-01 — `RecordStatementPayment.execute` (`apps/api/src/credit-cards/application/record-statement-payment.ts`) builds a transfer into the card's linked account, recorded by `createStatementPaymentRecorder` (`apps/api/src/movements/infrastructure/credit-cards/drizzle-statement-payment-recorder.ts`); `statement-payment-routes.test.ts` "moves 60,000.00 ARS from the bank to the card account as a transfer, not an expense (AC-01)" asserts the bank balance `-6000000`, the card account `6000000`, no expense and one transfer; "keeps the statement purchases unchanged after the payment (AC-01)"; `statement-payments.test.ts` "records a transfer to the ARS account of the card with the amount (AC-01)" and "does not count the payment as part of the statement purchases (AC-01)"; `statement-payment.test.tsx` "posts 60.000,00 ARS from the bank account and returns to the card page (AC-01)"; `statement-payment-schemas.test.ts` "accepts a payment of 60,000.00 ARS from a UUID account (AC-01)".
- ✅ AC-02 — the transfer rule `MovementCurrencyMismatch` reached through the recorder, with a currency-filtered account list in the form; `statement-payment-routes.test.ts` "answers 400 MOVEMENT_CURRENCY_MISMATCH from a USD account to the ARS side and stores nothing (AC-02)"; `statement-payment-adapters.test.ts` "rejects a source of another currency with the transfer rule and stores nothing (AC-02)"; `statement-payments.test.ts` "propagates a currency mismatch from the transfer rules and stores nothing (AC-02)"; `statement-payment-request.test.ts` "refuses a source account of another currency with the currency message (AC-02)"; `statement-payment.test.tsx` "offers only accounts of the chosen currency, never the card own, so a mismatch cannot be picked (AC-02)" and "shows the API mismatch message as an alert and keeps the typed values (AC-02)".
- ✅ AC-03 — `allocatePayments` and `paymentStatus` (`apps/api/src/credit-cards/domain/statement-payment.ts`) used by `buildStatementViews` (`statement-views.ts`); `statement-payments.test.ts` "shows a statement of 60,000.00 ARS paid when 60,000.00 ARS were paid (AC-03)"; `statement-payment-routes.test.ts` "reads a closed statement of 60,000.00 ARS paid after a payment of 60,000.00 ARS (AC-03)"; `statement-payment.test.tsx` "shows a closed statement of 60,000.00 ARS with 60,000.00 paid as paid, in both languages (AC-03)" and the Spanish case; `statement-payment-schemas.test.ts` "parses a closed statement paid and partially paid, and an open one with null (AC-03, AC-04)".
- ✅ AC-04 — the same derivation; `statement-payments.test.ts` "shows it partially paid when 20,000.00 ARS were paid (AC-04)"; `statement-payment-routes.test.ts` "reads it partially paid after a payment of 20,000.00 ARS, and unpaid before any (AC-04)"; `statement-payment.test.tsx` "shows a closed statement of 60,000.00 ARS with 20,000.00 paid as partially paid (AC-04)".

## Spec blocks
- ✅ Block 1 — shared contract: every task done; `statement-payment-schemas.test.ts` holds the listed tests (valid request, nine invalid inputs, path-only error report, response and `payments` parsing) and `credit-card-schemas.test.ts` carries the new field.
- ✅ Block 2 — domain and use cases: every task done; `statement-payments.test.ts` (14 tests: status, oldest-first allocation, credit, empty data, recorder call, mismatch, other user's card, other user's payments) and the unchanged `use-cases.test.ts`.
- ✅ Block 3 — adapters, route and composition: every task done; `statement-payment-routes.test.ts` (14 tests), `statement-payment-adapters.test.ts` (5 tests) and the adapted `credit-card-routes.test.ts`, `installment-routes.test.ts` and perf test; deviations on the 2^53 route case and the cross-user transfer case are in the tests report.
- ✅ Block 4 — web client and request builder: every task done; `api-client-credit-cards.test.ts` and `statement-payment-request.test.ts`.
- ✅ Block 5 — web screens: every task done; `statement-payment.test.tsx` (14 tests) and the updated fixtures of `credit-card-detail.test.tsx` and `installment-purchase.test.tsx`, plus the catalog key-equality test `i18n-catalogs.test.ts`.
- ✅ Block 6 — end to end: `apps/web/e2e/credit-cards-payments.spec.ts` is written, lints and typechecks; it was not run here (shared ports), the orchestrator runs it.

## Tests
- ✅ Sad-path tests: the schemas (amount 0, negative, decimal, leading zero, missing and non-UUID source, currency EUR, destination key, unknown key), the routes (currency mismatch, card account as source, archived source, future date, foreign card and foreign source answering 404, 61st creation answering 429, no session, unverified email, invalid bodies), the adapters (other scope sums zero, rejected recorder stores nothing), the use case (foreign card) and the web form (empty fields, 404 on load and save, 429 with Retry-After, network failure, API mismatch).
- ⚠️ NFR-01 (no float for money) is covered by the shared float guards, `bigint` arithmetic and the exact-sum adapter test beyond 2^53, not by a dedicated schema test (the ticket adds no column).
- ⚠️ The Playwright flow was written but not run in this ticket, and it relies on a new e2e helper that edits statement dates in the database.
- ⚠️ The paid amount of a statement is an allocation of all transfers received by the card (decision D1/D2); there is no per-payment link to a statement, which is a decision for the owner.

Result: PASSED

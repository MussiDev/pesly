# Spec DISC-001-10d: Statement Payments and Status

| Field | Value |
|-------|-------|
| Ticket | DISC-001-10d |
| PRD | docs/ddw/prd/prd-DISC-001-10d.md |
| Tier | FEATURE |
| Date | 2026-10-08 |
| Spec loops | 0 |
| Loops since last human decision | 0 |

## Summary
A statement payment is an ordinary transfer movement (PRD 03) from one of the caller's accounts to the
card's linked account of the same currency. A new route `POST /credit-cards/:id/payments` records it
through the movements transfer rules (a port implemented in the `movements` module, like the card expense
recorder of 10b). No table is added: the status of a closed statement is derived on read from the statement
total (purchases plus installments, 10b and 10c) and the transfers received by the card's linked account,
allocated to the closed statements oldest first. Each closed statement in `GET /credit-cards/:id/statements`
gains `payments`, the paid amount and the status per currency. The web app gets a "Pay statement" screen and
shows the paid amount and status in each closed statement row.

## Design decisions
- D1: The status is derived, not stored (like the purchase assignment of 10b). A payment is not linked to a
  statement when it is recorded; the transfers received by the card's linked account of a currency are added up
  and allocated to that currency's closed statements ordered by closing date, oldest first, each taking at most
  its total. Consequences: no migration, editing or deleting a payment through the movements API moves the
  status with it, and an amount paid beyond every closed total is a credit that the next closed statement
  absorbs. Alternative not taken: a link table from a transfer to one statement (explicit choice of the
  statement, one migration, atomic write across two modules). Reported as an owner decision.
- D2: What counts as paid: transfers (`type = 'transfer'`) whose destination is the card's ARS or USD linked
  account, owned by the caller, whatever their origin (the payment route or the ordinary movement form). Outgoing
  transfers of the card account, expenses and exchanges are not payments. A payment is never an expense: it has
  no category and the purchases query (`type = 'expense'`) does not see it (AC-01).
- D3: Status of a closed statement and currency with `total` and allocated `paid`: `paid` when `paid >= total`
  (a total of 0 is paid), `partially_paid` when `0 < paid < total`, `unpaid` when `paid = 0 < total`. An open
  statement has `payments: null`: the status is defined for closed statements (PRD FR-02). The screen hides a
  currency whose total and paid amount are both 0.
- D4: Installments and the linked ARS account balance (open point of 10c). An installment purchase is not a
  movement, so the card's ARS account balance holds the purchases only. The statement total includes the
  installments, and the payment the user records is the full statement amount, so after paying a statement
  with installments the ARS account balance exceeds the purchases it carries by the installments paid. The
  account balance is therefore not the debt of the card; the debt is read from the statements (total minus paid)
  and from the pending debt of 10c. Alternative not taken: materialize each installment as an expense on the card
  account when its statement closes (needs a scheduled job and backdating rules). Reported as an owner decision.
- D5: The request is `{ currency, sourceAccountId, amount, occurredAt, note? }`. The destination is the card's
  linked account of `currency`, chosen by the server. The transfer rules of PRD 03 decide validity: a source
  account of another currency is `MOVEMENT_CURRENCY_MISMATCH` (AC-02), the source equal to the destination is
  `MOVEMENT_SAME_ACCOUNT`, an archived account `ACCOUNT_ARCHIVED`, a date after today
  `MOVEMENT_DATE_IN_FUTURE`, a foreign or missing account or card 404. A payment may target a card with no
  closed statement yet; it then waits as credit (D1).
- D6: The creation passes through the `manual` bucket of the movement write limiter (60 per minute), because
  the recorder reuses `RecordManualMovement`. `credit-cards` never imports `movements`; the composition root
  wires the adapters.
- D7: The payment screen is online only, like the card expense and installment screens. No new runtime
  dependency, no migration, no change to existing tables (NFR-01: amounts are `bigint` or integer strings).

## Coverage: PRD → blocks
| Requirement | Covered by |
|---|---|
| FR-01 | Block 1, Block 2, Block 3, Block 4, Block 5, Block 6 |
| FR-02 | Block 1, Block 2, Block 3, Block 5, Block 6 |
| NFR-01 | Strategy: the payment is a transfer, so it stores `bigint` minor units in the existing movements table; the allocation is `bigint` arithmetic, responses carry integer strings, and the `no-float-money` guards keep scanning the new sources |

## Dependencies between blocks
Block 1 first (shared contract). Block 2 (domain and use cases) needs Block 1 for types. Block 3 (adapters,
route, composition) needs Block 2's ports. Blocks 4 and 5 (web) need Block 1 for types and Block 3 for the API.
Block 6 (end to end) needs every other block.

## Block 1 — Shared contract

**Files**
- `packages/shared/src/credit-cards/statement-payment.ts` (new) — request, response and status schemas.
- `packages/shared/src/credit-cards/credit-card.ts` (modified) — `statementResponseSchema` gains `payments`.
- `packages/shared/src/index.ts` (modified) — export.
- `packages/shared/test/statement-payment-schemas.test.ts` (new), `packages/shared/test/credit-card-schemas.test.ts` (modified).

**Logic**
- `PAYMENT_STATUSES = ['unpaid', 'partially_paid', 'paid']`, `paymentStatusSchema`.
- `createStatementPaymentRequestSchema` strict `{ currency: accountCurrencySchema, sourceAccountId: uuid, amount:
  movementAmountSchema, occurredAt: occurredAtSchema, note?: movementNoteSchema }`.
- `statementPaymentResponseSchema` `{ movementId, sourceAccountId, accountId, currency, amount, occurredAt }`.
- `statementPaymentsSchema` `{ ARS: { paid, status }, USD: { paid, status } }` with `paid` an exact integer string;
  `statementResponseSchema.payments` is that object or `null` (open statement).

**Input validation**
- Amount a positive integer string up to 10^15 without leading zeros; `occurredAt` an ISO instant; note at most 500
  characters without control or format characters; unknown keys refused; ids UUIDs; currency `ARS` or `USD`.

**Error handling**
- A schema failure is `VALIDATION_FAILED` (400) naming failing paths, never values.

**Required tests**
- [ ] a payment of `"6000000"` ARS from a UUID account parses — validates AC-01
- [ ] amount `0`, `"-5"`, `15.99`, `"015"`, a missing source account, a non-UUID source, currency `EUR` and an unknown key are rejected as invalid input — validates FR-01
- [ ] a rejected request carries only the failing paths, not the typed values (sad path)
- [ ] a statement response with `payments: null` and one with paid and status per currency parse, and a status outside the three values is rejected — validates AC-03, AC-04

**Completion criterion**
`pnpm --filter @pesly/shared exec vitest run` passes and `pnpm typecheck` shows only the expected consumers of `StatementResponse` still to update.

## Block 2 — Domain and use cases

**Files**
- `apps/api/src/credit-cards/domain/statement-payment.ts` (new) — `allocatePayments`, `paymentStatus`.
- `apps/api/src/credit-cards/domain/credit-card.ts` (modified) — `StatementView.payments`.
- `apps/api/src/credit-cards/application/ports/card-payments.ts`, `ports/statement-payment-recorder.ts` (new).
- `apps/api/src/credit-cards/application/dependencies.ts` (modified) — `cardPayments`, `paymentRecorder`; `withStatus` takes payments.
- `apps/api/src/credit-cards/application/statement-views.ts` (new) — shared builder of the views used by both statement use cases.
- `apps/api/src/credit-cards/application/record-statement-payment.ts` (new).
- `apps/api/src/credit-cards/application/list-statements.ts`, `update-statement-dates.ts` (modified).
- `apps/api/test/credit-cards/fakes.ts` (modified), `apps/api/test/credit-cards/statement-payments.test.ts` (new).

**Logic**
- `allocatePayments(closedStatements ordered by closing date, totalsByStatement, received)` returns `paid` per
  statement id and currency (D1) in `bigint`; `paymentStatus(total, paid)` per D3.
- `CardPayments.receivedByCard(scope, card)` returns `{ ARS, USD }` bigint sums (D2); implemented by the movements module.
- `StatementPaymentRecorder.record(scope, { sourceAccountId, destinationAccountId, amount, occurredAt, note? })`
  returns `{ id, occurredAt }`; implemented by the movements module through the transfer rules (D5, D6).
- `RecordStatementPayment`: scoped card load (`ResourceNotFound` first), destination = linked account of the
  currency, record; movement rule errors propagate unchanged.
- `ListStatements` and `UpdateStatementDates` build every view through `statement-views.ts`: totals, installments,
  then payments for closed statements and `null` for open ones.

**Error handling**
- `ResourceNotFound` (404) for a card that is missing or not the caller's, before anything is recorded.
- Movement errors (`MovementCurrencyMismatch`, `MovementSameAccount`, `MovementAccountArchived`,
  `MovementDateInFuture`, `MovementWriteRateLimited`) propagate and nothing is stored.

**Required tests**
- [ ] a statement of 60,000.00 ARS with payments received of 60,000.00 ARS is paid in ARS — validates AC-03
- [ ] a statement of 60,000.00 ARS with payments of 20,000.00 ARS is partially paid with 20,000.00 ARS paid — validates AC-04
- [ ] a closed statement with no payments is unpaid, one with total 0 and no payments is paid, and an open statement has no payments (D3)
- [ ] 80,000.00 ARS received against closed statements of 60,000.00 and 30,000.00 ARS (oldest first) pays the first and leaves the second partially paid with 20,000.00 paid (D1)
- [ ] a payment above every closed total marks them paid and is not lost (credit), and USD and ARS are allocated separately (D1)
- [ ] recording a payment of 60,000.00 ARS from a bank account hands the recorder the card's ARS account as destination and the amount — validates AC-01
- [ ] a payment of 60,000.00 ARS is not added to the purchases of the statement (it is not an expense) — validates AC-01
- [ ] a currency mismatch rejected by the recorder propagates and the status does not change — validates AC-02
- [ ] another user's card is `ResourceNotFound` and records nothing (sad path)
- [ ] a statement list with no payments at all reads every closed statement unpaid (error path of empty data)

**Completion criterion**
`pnpm exec vitest run test/credit-cards/statement-payments.test.ts test/credit-cards/use-cases.test.ts` passes with fakes and no
database, and domain and application files import no infrastructure.

## Block 3 — Adapters, route and composition

**Files**
- `apps/api/src/movements/infrastructure/credit-cards/drizzle-card-payments.ts` (new) — `createCardPayments(db)`.
- `apps/api/src/movements/infrastructure/credit-cards/drizzle-statement-payment-recorder.ts` (new) — `createStatementPaymentRecorder(db, logger, options?)`.
- `apps/api/src/movements/index.ts` (modified) — exports.
- `apps/api/src/credit-cards/infrastructure/http/credit-card-routes.ts`, `credit-card-presenter.ts` (modified).
- `apps/api/src/server.ts` (modified) — wiring.
- `apps/api/test/credit-cards/statement-payment-adapters.test.ts` (new), `statement-payment-routes.test.ts` (new),
  `credit-card-routes.test.ts`, `installment-routes.test.ts` (modified for the new dependencies and field),
  `apps/api/test/foundation/architecture-boundaries.test.ts` (modified only if a rule needs a case).

**Logic**
The route runs `requireSession`, `requireVerifiedEmail`, a write scope, the shared `validate` middleware and the use
case. The audit line carries request id, user id, card id and movement id, never the amount or the note.
`receivedByCard` sums `amount` of the caller's transfers with `destination_account_id` in the card's two linked
accounts, grouped by destination, in the same statement as the owner filter; the sum is cast to text so the exact value
reaches `BigInt`. The recorder wraps `RecordManualMovement` with a `transfer` input.

**API contract**
- `POST /credit-cards/:id/payments`: params `{ id: uuid }`, body `{ currency: 'ARS' | 'USD', sourceAccountId: uuid,
  amount: string, occurredAt: ISO instant, note?: string }`; response 201 with the body `{ movementId, sourceAccountId, accountId,
  currency, amount, occurredAt }`.
- `GET /credit-cards/:id/statements` and `PATCH .../statements/:statementId` (existing): each statement gains
  `payments: { ARS: { paid, status }, USD: { paid, status } } | null`.
- Error codes: 400 `VALIDATION_FAILED`, `MOVEMENT_CURRENCY_MISMATCH`, `MOVEMENT_SAME_ACCOUNT`, `MOVEMENT_DATE_IN_FUTURE`;
  401 `UNAUTHENTICATED`; 403 `EMAIL_NOT_VERIFIED`; 404 `NOT_FOUND` (card or account missing or not the user's);
  409 `ACCOUNT_ARCHIVED`; 429 `RATE_LIMITED`.
- Auth: `requireSession`, `requireVerifiedEmail`, owner scope; data of another user answers 404, never 403.

**Input validation**
- As Block 1; the JSON body limit stays 16 kB.

**Error handling**
- Domain errors map through the existing error middleware; unexpected errors are 500 `INTERNAL` without detail.

**Required tests**
- [ ] `POST` 60,000.00 ARS from a bank account to the card answers 201, the bank balance drops by 6000000 and the card's ARS account rises by 6000000, and the movement type is `transfer` — validates AC-01
- [ ] after that payment the card's expense total of the statement is unchanged and no expense exists (not counted as an expense) — validates AC-01
- [ ] `POST` from a USD account to the ARS side answers 400 `MOVEMENT_CURRENCY_MISMATCH` and stores nothing — validates AC-02
- [ ] a closed statement of 60,000.00 ARS with a payment of 60,000.00 ARS reads `payments.ARS` paid `"6000000"` status `paid` — validates AC-03
- [ ] the same statement with a payment of 20,000.00 ARS reads `partially_paid` with `"2000000"` — validates AC-04
- [ ] a payment recorded through the ordinary transfer form to the card account counts the same (D2), and an expense or an outgoing transfer of the card account does not
- [ ] another user's transfer is never counted in Ana's statements (sad path, cross-user)
- [ ] Bob's `POST` on Ana's card answers 404 and records nothing; Bob using an account of Ana's as source answers 404 (sad path)
- [ ] a source equal to the card account answers 400 `MOVEMENT_SAME_ACCOUNT`, an archived source 409, a future date 400, and an amount above 2^53 round-trips exactly (sad paths)
- [ ] the 61st creation of a minute answers 429 (sad path)
- [ ] no session answers 401 and an unverified email 403 (sad path)

**Completion criterion**
`pnpm exec vitest run test/credit-cards test/foundation` passes against PostgreSQL (`TEST_DATABASE_URL`).

## Block 4 — Web API client and request builder

**Files**
- `apps/web/src/lib/api-client.ts` (modified) — `recordStatementPayment`.
- `apps/web/src/features/credit-cards/statement-payment-request.ts` (new) — `buildStatementPaymentRequest`.
- `apps/web/test/api-client-credit-cards.test.ts` (modified), `apps/web/test/statement-payment-request.test.ts` (new).

**Logic**
The client calls the Block 3 route through the existing `request` helper, parses the answer with the
shared validator and builds paths with `resourcePath`. The builder turns the typed values into the request or per-field
messages: currency, source account (an open account of the chosen currency), amount (shared parser, positive, at
most 10^15), date and time (not after today in the user's zone), note.

**Input validation**
- Same rules as Block 1, checked client side for usability and again by the server.

**Error handling**
- A failure returns `{ ok: false, code, messageKey }`; an answer that fails its validator is `unexpected`; a network
  failure is `NETWORK`.

**Required tests**
- [ ] the client sends the right method, path and body and parses the success answer — validates AC-01
- [ ] a malformed success body maps to `unexpected` (error path)
- [ ] a card id of `..` is refused without a request (invalid input)
- [ ] the builder turns "60.000,00", ARS and a source account into an amount of `6000000` — validates AC-01
- [ ] a source account of another currency, a missing source, an empty amount, `0`, three decimals and a future date give per-field messages and no request (invalid input) — validates AC-02

**Completion criterion**
`pnpm exec vitest run test/api-client-credit-cards.test.ts test/statement-payment-request.test.ts` passes in `apps/web`.

## Block 5 — Web screens

**Files**
- `apps/web/src/features/credit-cards/components/statement-payment-form.tsx` (new), `statement-list.tsx` (modified) — presentational.
- `apps/web/src/features/credit-cards/containers/statement-payment-container.tsx` (new).
- `apps/web/src/app/[locale]/(app)/cards/[id]/payments/new/page.tsx` (new).
- `apps/web/src/features/credit-cards/containers/credit-card-detail-container.tsx` (modified) — link to the payment screen.
- `apps/web/messages/en.json`, `apps/web/messages/es.json` (modified) — `creditCards.payments.*`.
- `apps/web/test/statement-payment.test.tsx` (new), `apps/web/test/credit-card-detail.test.tsx` (modified).

**Logic**
Container/presentational split. The new screen shows the currency (the two linked accounts' currencies), the source
account (the caller's open accounts of that currency, without the card's own), amount, date and time, and note; on
success it returns to the card page. Each closed statement row shows, per currency with an amount, the paid amount and
the status as text (paid, partially paid, unpaid), never by color alone. All copy comes from the catalogs in Spanish
and English.

**Input validation**
- Block 4 builder; the form does not send while a field is invalid and focuses the first invalid one.

**Error handling**
- Field messages next to the field; `NOT_FOUND` shows the not-found state; `MOVEMENT_CURRENCY_MISMATCH`,
  `ACCOUNT_ARCHIVED`, `MOVEMENT_DATE_IN_FUTURE` and `RATE_LIMITED` show their API messages as a form alert with the typed
  values kept; `NETWORK` shows the connection-needed message; `UNAUTHENTICATED` redirects to sign-in.

**Required tests**
- [ ] typing 60.000,00, a source account and ARS posts the payment and returns to the card page — validates AC-01
- [ ] choosing a currency lists only accounts of that currency, so a mismatch cannot be picked, and the API mismatch error shows as an alert with the values kept — validates AC-02
- [ ] a closed statement of 60,000.00 ARS with 60,000.00 paid shows "paid" in Spanish and English — validates AC-03
- [ ] a closed statement of 60,000.00 ARS with 20,000.00 paid shows "partially paid" and the paid amount — validates AC-04
- [ ] an unpaid closed statement shows "unpaid", an open one shows no status, and a currency with zero total and zero paid is hidden
- [ ] a 404 shows the not-found state, a network failure keeps the typed values (sad path)
- [ ] both catalogs have the same keys

**Completion criterion**
`pnpm exec vitest run test/statement-payment.test.tsx test/credit-card-detail.test.tsx test/i18n-catalogs.test.ts` passes in `apps/web`.

## Block 6 — End to end: pay a statement and see its status

**Files**
- `apps/web/e2e/credit-cards-payments.spec.ts` (new) — in the folder and style of the existing Playwright flows, with
  `test.use({ locale: 'es-AR', timezoneId: 'America/Cordoba' })`.

**Logic**
A verified user with a bank account, a card and an expense on it in a closed statement pays part of it from the payment
screen and sees "partially paid", then pays the rest and sees "paid" (FR-01, FR-02).

**Error handling**
- The flow submits an empty amount and asserts the field message (sad path).

**Required tests**
- [ ] the flow pays 20,000.00 ARS of a 60,000.00 ARS statement and sees partially paid, then pays 40,000.00 ARS and sees paid — validates AC-01, AC-03, AC-04
- [ ] a payment with an empty amount shows the field message and creates nothing (sad path) — validates AC-02

**Completion criterion**
The spec lints and typechecks. Not run by the implementer: the orchestrator runs the e2e suite one at a time.

## Rollback
No migration and no table change: reverting the commits restores the previous API and web. Payments already recorded
are ordinary transfers and stay valid movements.

## Final verification
- Every AC-01 to AC-04 has a passing test (Blocks 2, 3, 5), NFR-01 is covered by the float guards and `bigint` strings.
- Full suite with coverage once: lines, branches and functions at or above 80% over the whole workspace.
- `pnpm lint`, `pnpm typecheck`, prettier and `pnpm audit --prod --audit-level high` are clean.

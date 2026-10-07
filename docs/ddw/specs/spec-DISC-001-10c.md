# Spec DISC-001-10c: Installment Purchases, Statement Totals and Pending Debt

| Field | Value |
|-------|-------|
| Ticket | DISC-001-10c |
| PRD | docs/ddw/prd/prd-DISC-001-10c.md |
| Tier | FEATURE |
| Date | 2026-10-07 |
| Spec loops | 0 |
| Loops since last human decision | 0 |

## Summary
The `credit-cards` API module gets its own persistence for installment purchases: table
`installment_purchases` (one row per purchase) and `installments` (one row per installment, with the
statement period it is assigned to). An installment purchase is NOT a movement: no expense is
recorded on the linked accounts, so the purchase is never counted twice and only each installment
counts as spending, in the month of its statement's due date (FR-05). New routes under
`/credit-cards/:id/installment-purchases` create, read, edit and delete purchases (FR-01 to FR-04,
FR-08, FR-09) and return the card's pending debt (FR-07); `GET /credit-cards/installment-expenses`
exposes the installments by category and month for PRD 06 and PRD 09 (FR-05, parent pending
decision 1, recommended option). The statement totals of 10b now add the installments of the
statement (FR-06) and each statement lists them. The web app gets an "Add installment purchase"
screen, the purchase list with pending debt on the card page and the installments in each
statement.

## Design decisions
- D1: A statement is identified by its `period` (`YYYY-MM`). An installment stores the period of its
  statement, not a statement id, because future statements are not stored yet (10a creates cycles
  only up to the one open today). The dates of a period are the stored statement's when it exists
  and `statementDatesFor(period, closingDay, dueDay)` otherwise, so a hand-edited statement moves its
  installments with it. Installment `n` has the period of the first installment advanced `n - 1`
  times with `nextPeriod` (AC-05).
- D2: The first installment's statement is `assignStatement(purchasedOn, statements)` of 10b, after
  `ensureStatements`. The purchase date is a calendar day (`YYYY-MM-DD`) in the user's time zone and
  cannot be after today (`MOVEMENT_DATE_IN_FUTURE`, as for expenses).
- D3: The split (FR-03) is `splitInstallments(total, count)` in `packages/shared`: every installment
  gets `total / count` (integer division) and the first also gets `total % count`. AC-04: 10000 over 3 is
  3334, 3333, 3333. A total smaller than the count is rejected (each installment is at least 1 minor
  unit).
- D4: Currency is ARS only (FR-02): the request schema takes `currency: 'ARS'` as a literal, so USD is
  refused as invalid input. Installments count and total are fixed after creation; editing is limited
  to category and note (PRD FR-09 names "edit" without a rule; changing amounts means delete and
  record again). Reported as an owner decision.
- D5: "Not yet closed" is `!isStatementClosed(closingDate, today)` of 10a with today in the user's zone.
  Deleting a purchase removes the installments of statements not yet closed (FR-08). If none remain the
  purchase row is deleted; otherwise it is kept with `cancelled_at` set, is hidden from the list and
  answers 404 afterwards, and its closed installments keep counting in totals and in the monthly
  expenses (they were paid).
- D6: Pending debt (FR-07) is the sum of the installments whose statement is not closed, `{ ARS, USD }`
  with USD always `"0"` (the card has no USD installments). It is returned by the list route of a card.
- D7: Rules shared with movements are reused through ports implemented in the `movements` module and
  wired in `server.ts`: `ExpenseCategoryGuard` (category of the caller, kind expense, not archived) and
  `InstallmentWriteLimit` (the `manual` bucket of the movement write limiter, 60 per minute). `credit-cards`
  never imports `movements`. Category deletion is blocked while an installment purchase uses it: the
  composition root combines `createCategoryUsage` with `createInstallmentCategoryUsage`.
- D8: Migration `0020_installments` (next free number after `0019_credit_cards`; 0008 to 0012 stay
  reserved). Its journal `when` exceeds main's maximum (1791246865297). Foreign keys from purchases
  to cards restrict, so `eraseUserCreditCards` deletes the purchases first, and deleting a card that has
  installment purchases is refused with `CARD_HAS_MOVEMENTS`.
- D9: No new runtime dependency. Amounts are `bigint` or integer strings end to end (NFR-01).
- D10: The installment purchase does not change the balance of the linked ARS account in this ticket.
  How a statement payment (DISC-001-10d) accounts for installments is that ticket's decision.

## Coverage: PRD → blocks
| Requirement | Covered by |
|---|---|
| FR-01 | Block 1, Block 2, Block 3, Block 4, Block 5, Block 6 |
| FR-02 | Block 1, Block 4, Block 5, Block 6 |
| FR-03 | Block 1, Block 3 |
| FR-04 | Block 3, Block 4 |
| FR-05 | Block 3, Block 4 |
| FR-06 | Block 3, Block 4, Block 6 |
| FR-07 | Block 3, Block 4, Block 6 |
| FR-08 | Block 2, Block 3, Block 4, Block 6 |
| FR-09 | Block 3, Block 4 |
| NFR-01 | Strategy: money is `bigint` and integer strings; Block 2 asserts `bigint` columns and no float column in the new tables, and the `no-float-money` guards keep scanning sources |
| NFR-02 | Strategy: the statement view reads one query of installment rows of the card (at most 60 purchases of 60 rows) and one grouped query of purchases, all indexed by card and owner, and sums in memory; Block 4 adds a perf test with 60 active purchases at p95 under 300 ms |
| NFR-03 | Strategy: `splitInstallments` is pure integer arithmetic with the leftover on the first installment; Block 1 verifies the exact sum over 10,000 random purchases |

## Dependencies between blocks
Block 1 first (shared contract and split). Block 2 (persistence) needs Block 1 only for types. Block 3
(domain and use cases) needs Block 2's port. Block 4 (adapters, routes, composition) needs Blocks 2
and 3. Blocks 5 and 6 (web) need Block 1 for types and Block 4 for the API. Block 7 (end to end)
needs every other block.

## Block 1 — Shared contract and split

**Files**
- `packages/shared/src/money/split-installments.ts` (new) — `splitInstallments`.
- `packages/shared/src/credit-cards/installment.ts` (new) — request, response and query schemas.
- `packages/shared/src/credit-cards/credit-card.ts` (modified) — `statementResponseSchema` gains `installments`.
- `packages/shared/src/index.ts` (modified) — exports.
- `packages/shared/test/split-installments.test.ts`, `packages/shared/test/installment-schemas.test.ts` (new),
  `packages/shared/test/credit-card-schemas.test.ts` (modified).

**Logic**
- `splitInstallments(total: bigint, count: number): bigint[]` per D3; throws `RangeError` for a count
  outside 2 to 60 or a total smaller than the count.
- Schemas: `createInstallmentPurchaseRequestSchema` strict `{ currency: literal 'ARS', categoryId: uuid,
  amount: movementAmountSchema, installments: int 2..60, purchasedOn: calendarDateSchema, note?:
  movementNoteSchema }` refined so `amount >= installments`; `updateInstallmentPurchaseRequestSchema`
  strict `{ categoryId?, note?: movementNoteSchema | null }` with at least one key;
  `installmentPurchaseResponseSchema` `{ id, cardId, categoryId, amount, currency, installmentCount,
  purchasedOn, note: string | null, createdAt, installments: [{ number, amount, period, closingDate,
  dueDate, status }] }`; `listInstallmentPurchasesResponseSchema` `{ items, pendingDebt: { ARS, USD } }`;
  `installmentPurchaseParamsSchema` `{ id: uuid, purchaseId: uuid }`;
  `installmentExpensesQuerySchema` `{ from: YYYY-MM, to: YYYY-MM }` with `from <= to` and at most 60
  months; `installmentExpensesResponseSchema` `{ items: [{ month, categoryId, currency: 'ARS', amount }] }`.
- `statementResponseSchema.installments`: `[{ purchaseId, number, count, amount, categoryId }]`.

**Input validation**
- `currency` exactly `ARS`; `installments` integer from 2 to 60; `amount` positive integer string up to
  10^15 minor units without leading zeros; `purchasedOn` a real calendar date; `note` at most 500
  characters without control or format characters; unknown keys refused; months match `^\d{4}-(0[1-9]|1[0-2])$`.

**Error handling**
- A schema failure is `VALIDATION_FAILED` (400) naming failing paths, never values.
- `splitInstallments` with an invalid count or a total below the count throws `RangeError`, which the
  schema refinement makes unreachable from the API.

**Required tests**
- [ ] 100.00 ARS in 3 installments splits into 3334, 3333 and 3333 minor units — validates AC-04
- [ ] 10,000 random totals and counts split into parts that add up to the total exactly, with the first part the largest — validates NFR-03
- [ ] 12,000,000 minor units in 12 installments gives 12 parts and a valid request parses — validates AC-01
- [ ] 1 and 61 installments, and 0, are rejected as invalid input — validates AC-02
- [ ] currency `USD`, a lowercase `ars` and a missing currency are rejected as invalid input — validates AC-03
- [ ] an amount smaller than the installment count, `15.99`, `"015"`, an unknown key and a zero-width character in the note are rejected as invalid input
- [ ] a range with `from` after `to`, and one longer than 60 months, are rejected as invalid input
- [ ] a rejected request carries only the failing paths, not the typed values (sad path)
- [ ] `splitInstallments` with a count of 1 or a total smaller than the count throws `RangeError` (error path)

**Completion criterion**
`pnpm --filter @pesly/shared exec vitest run` passes and `pnpm typecheck` shows only the expected
consumers of `StatementResponse` still to update in later blocks.

## Block 2 — Persistence

**Files**
- `apps/api/src/credit-cards/infrastructure/db/schema.ts` (modified) — `installmentPurchases`, `installments`.
- `apps/api/drizzle/0020_installments.sql`, `apps/api/drizzle/rollback/0020_installments.down.sql`,
  `apps/api/drizzle/meta/_journal.json`, `apps/api/drizzle/meta/0020_snapshot.json` (new or modified) — migration.
- `apps/api/src/credit-cards/application/ports/installment-repository.ts` (new) — `InstallmentRepository`.
- `apps/api/src/credit-cards/infrastructure/db/drizzle-installment-repository.ts` (new).
- `apps/api/src/credit-cards/infrastructure/db/drizzle-installment-category-usage.ts` (new) and
  `apps/api/src/credit-cards/index.ts` (modified) — `createInstallmentCategoryUsage`.
- `apps/api/src/credit-cards/infrastructure/db/erase-user-credit-cards.ts` (modified) — deletes purchases first.
- `apps/api/src/credit-cards/infrastructure/db/drizzle-credit-card-repository.ts` (modified) — card delete
  maps the restrict violation to `CardHasMovements` (already) and the use case checks first (Block 3).
- `apps/api/test/credit-cards/installment-repository.test.ts` (new), `schema-introspection.test.ts`,
  `erasure-step.test.ts` (modified).

**Logic**
- Port methods, every one filtered by the scope in the same statement: `create(scope, data)` inserts the
  purchase and its installments in one transaction; `listPurchases(scope, cardId)` active purchases
  (not cancelled) with installments, newest first; `findPurchase(scope, cardId, purchaseId)`;
  `updatePurchase(scope, cardId, purchaseId, change)`; `removeInstallments(scope, cardId, purchaseId,
  numbers)` deletes those installments and then deletes the purchase when none remain or sets
  `cancelled_at`; `listRows(scope, cardId?)` flat rows `{ cardId, purchaseId, number, count, period,
  amount, categoryId }` of all purchases including cancelled ones; `cardHasPurchases(scope, cardId)`.
- `isUsed(categoryId)` of the category usage adapter is unscoped by design like the movements one.

**Data model**
- `installment_purchases`: `id uuid pk default random`, `owner_id uuid not null` (FK users, cascade),
  `card_id uuid not null`, composite FK `(card_id, owner_id)` to `credit_cards(id, owner_id)` on delete
  restrict, `category_id uuid not null`, `category_kind text not null default 'expense'` with check
  `= 'expense'`, composite FK `(category_id, owner_id, category_kind)` to `categories(id, owner_id, kind)` on
  delete restrict, `total_amount bigint not null` check between 1 and 10^15, `installment_count smallint not
  null` check between 2 and 60, check `total_amount >= installment_count`, `purchased_on date not null`,
  `note text null` check length at most 500, `cancelled_at timestamptz null`, `created_at`, `updated_at`
  `timestamptz not null default now()`; unique `(id, owner_id)`; index `(owner_id, card_id, created_at)`; index
  `(category_id)`.
- `installments`: `purchase_id uuid not null` FK to `installment_purchases(id)` on delete cascade, `number
  smallint not null` check between 1 and 60, `period text not null` check `^[0-9]{4}-(0[1-9]|1[0-2])$`,
  `amount bigint not null` check between 1 and 10^15; primary key `(purchase_id, number)`; index `(period)`
  is not needed, rows are read by purchase and card through the join.
- No `numeric`, `real` or `double precision` column (NFR-01).

**Error handling**
- A scope that is not the owner's finds nothing (empty list, `null`, `false`, no row changed).
- A constraint violation (category of another owner, kind, card) surfaces as a database error and answers
  500 `INTERNAL`; the use case validates before writing so it is unreachable from the API.
- A failed insert of the installments rolls back the purchase (single transaction).

**Required tests**
- [ ] creating a purchase of 12 installments stores 1 purchase and 12 installment rows with their periods and amounts — validates AC-01
- [ ] listing returns only the owner's active purchases, and another user's scope gets nothing and changes nothing (sad path) — validates AC-10
- [ ] removing the installments 3 to 12 of a 12-installment purchase keeps 1 and 2 and marks the purchase cancelled, and removing all deletes the purchase — validates AC-09
- [ ] `listRows` includes the installments of a cancelled purchase and the category usage reports a category used by a purchase — validates FR-06
- [ ] a failed insert of an installment row leaves no purchase (error path, rollback)
- [ ] the new tables have `bigint` amount columns, composite foreign keys and 0 floating-point or numeric columns — validates NFR-01
- [ ] erasing a user deletes their purchases and cards without a foreign key error (sad path of ordering)
- [ ] amounts above 2^53 round-trip exactly (error path of float handling) — validates NFR-01

**Completion criterion**
`pnpm exec vitest run test/credit-cards/installment-repository.test.ts test/credit-cards/schema-introspection.test.ts test/credit-cards/erasure-step.test.ts`
passes against PostgreSQL (`TEST_DATABASE_URL`), and the migration applies and rolls back on a fresh database.

## Block 3 — Domain and use cases

**Files**
- `apps/api/src/credit-cards/domain/installment.ts` (new) — types and pure functions.
- `apps/api/src/credit-cards/domain/credit-card.ts` (modified) — `StatementView` gains `installments`.
- `apps/api/src/credit-cards/domain/statement-assignment.ts` (modified) — `addInstallments`.
- `apps/api/src/credit-cards/application/ports/expense-category-guard.ts`,
  `application/ports/installment-write-limit.ts` (new) — ports.
- `apps/api/src/credit-cards/application/dependencies.ts` (modified) — `installments`, `categories`, `writeLimit`.
- `apps/api/src/credit-cards/application/create-installment-purchase.ts`,
  `list-installment-purchases.ts`, `get-installment-purchase.ts`, `update-installment-purchase.ts`,
  `delete-installment-purchase.ts`, `list-installment-expenses.ts` (new).
- `apps/api/src/credit-cards/application/list-statements.ts`, `update-statement-dates.ts`,
  `delete-credit-card.ts` (modified).
- `apps/api/test/credit-cards/fakes.ts` (modified), `apps/api/test/credit-cards/installments.test.ts` (new),
  `apps/api/test/credit-cards/use-cases.test.ts` (modified).

**Logic**
- `planInstallments(total, count, firstPeriod)` returns `{ number, amount, period }[]` using
  `splitInstallments` and `nextPeriod` (FR-03, FR-04).
- `datesOfPeriod(period, statements, card)` returns the stored statement's dates or the computed ones (D1).
- `CreateInstallmentPurchase` (FR-01, FR-04): scoped card load, write limit, category guard, date not
  after today, `ensureStatements`, first statement by `assignStatement`, plan, `create`; releases the
  limit unit on any failure.
- `ListInstallmentPurchases` returns purchases with each installment's dates and status and the
  `pendingDebt` (FR-07, D6). `GetInstallmentPurchase` and `UpdateInstallmentPurchase` (category guard when
  the category changes) are scoped and return `ResourceNotFound` for a missing, cancelled or foreign purchase
  (FR-09).
- `DeleteInstallmentPurchase` (FR-08): removes the numbers whose statement is not closed (D5).
- `ListInstallmentExpenses(from, to)`: for the caller's cards, every installment's due-date month, summed by
  month and category (FR-05).
- `ListStatements` and `UpdateStatementDates` add the installments of each statement's period to
  `totals` and to `installments` (FR-06). `DeleteCreditCard` refuses with `CardHasMovements` when the card has
  purchases.

**Error handling**
- `ResourceNotFound` (404) for a card or purchase that is missing, cancelled or not the caller's, before any write.
- A purchase date after today: `MovementDateInFuture` (400); an archived category `CategoryArchived` (409); an
  expense category of another kind `MovementCategoryKindMismatch` (400); a missing or foreign category 404.
- Limit reached: the limit port's `RATE_LIMITED` (429) propagates; nothing is stored.
- A failure after the unit was taken releases it; the original error stands.

**Required tests**
- [ ] a purchase of 120,000.00 ARS in 12 installments stores 12 installments of 10,000.00 ARS — validates AC-01
- [ ] 100.00 ARS in 3 installments gives 33.34, 33.33 and 33.33 — validates AC-04
- [ ] a purchase dated in the statement closing 2026-10-24 in 3 installments lands in the statements of 2026-10-24, 2026-11-24 and 2026-12-24 — validates AC-05
- [ ] an installment of 10,000.00 ARS in a statement due 2026-11-05 adds 10,000.00 ARS to November 2026 for the purchase's category and nothing else of the purchase — validates AC-06
- [ ] a statement with purchases of 50,000.00 ARS and 20.00 USD and an installment of 10,000.00 ARS totals 60,000.00 ARS and 20.00 USD — validates AC-07
- [ ] 11 installments of 10,000.00 ARS in statements not yet closed give a pending debt of 110,000.00 ARS, and closed ones are excluded — validates AC-08
- [ ] deleting a 12-installment purchase after 2 statements closed removes 10 installments and keeps 2, which still count in totals — validates AC-09
- [ ] get, edit and delete of another user's purchase are `ResourceNotFound` and change nothing (sad path) — validates AC-10
- [ ] editing the category moves the monthly expense to the new category and keeps the amounts — validates FR-09
- [ ] a future purchase date, an archived category, an income category and a foreign category are refused and store nothing (sad path)
- [ ] the write limit refusing the creation stores nothing, and a failure after taking the unit releases it (sad path)
- [ ] a cancelled purchase is `ResourceNotFound` on get, edit and a second delete (sad path)
- [ ] a card with installment purchases cannot be deleted (sad path)
- [ ] a day with no installments gives zero totals and an empty month (error path of empty data)

**Completion criterion**
`pnpm exec vitest run test/credit-cards/installments.test.ts test/credit-cards/use-cases.test.ts` passes with
fakes and no database, and domain and application files import no infrastructure.

## Block 4 — Adapters, routes and composition

**Files**
- `apps/api/src/movements/infrastructure/credit-cards/drizzle-expense-category-guard.ts` (new) —
  `createExpenseCategoryGuard(db)`.
- `apps/api/src/movements/infrastructure/credit-cards/drizzle-installment-write-limit.ts` (new) —
  `createInstallmentWriteLimit(db, logger, options?)`.
- `apps/api/src/movements/index.ts` (modified) — exports.
- `apps/api/src/credit-cards/infrastructure/http/credit-card-routes.ts`, `credit-card-presenter.ts` (modified).
- `apps/api/src/server.ts` (modified) — wiring and the combined category usage.
- `eslint.config.mjs` (modified) only if the module boundary needs a new entry.
- `apps/api/test/credit-cards/credit-card-routes.test.ts` (modified), `installment-routes.test.ts` (new),
  `apps/api/test/credit-cards/installment-adapters.test.ts` (new),
  `apps/api/test/perf/credit-card-statements.perf.test.ts` (new),
  `apps/api/test/foundation/architecture-boundaries.test.ts` (modified).

**Logic**
Routes run `requireSession`, `requireVerifiedEmail`, a scope, the shared `validate` middleware and the use
case. `GET /credit-cards/installment-expenses` is declared before `/credit-cards/:id`. Audit lines carry
request id, user id, card id and purchase id, never the amount or the note. The category guard reuses the
movements `CategoryLookup` and errors; the write limit reuses the `manual` bucket of the movement write limiter.

**API contract**
- `POST /credit-cards/:id/installment-purchases`: params `{ id: uuid }`, body `{ currency: 'ARS', categoryId: uuid,
  amount: string, installments: integer 2..60, purchasedOn: 'YYYY-MM-DD', note?: string }`; 201 with the
  `installmentPurchaseResponseSchema` body.
- `GET /credit-cards/:id/installment-purchases`: 200 `{ items: InstallmentPurchase[], pendingDebt: { ARS: string,
  USD: string } }`.
- `GET /credit-cards/:id/installment-purchases/:purchaseId`: 200 `InstallmentPurchase`.
- `PATCH /credit-cards/:id/installment-purchases/:purchaseId`: body `{ categoryId?: uuid, note?: string | null }`
  with at least one key; 200 `InstallmentPurchase`.
- `DELETE /credit-cards/:id/installment-purchases/:purchaseId`: 204.
- `GET /credit-cards/installment-expenses?from=YYYY-MM&to=YYYY-MM`: 200 `{ items: [{ month, categoryId,
  currency: 'ARS', amount: string }] }`.
- `GET /credit-cards/:id/statements` and `PATCH .../statements/:statementId` (existing): each statement gains
  `installments: [{ purchaseId, number, count, amount, categoryId }]`, and `totals` include them.
- Error codes: 400 `VALIDATION_FAILED`, `MOVEMENT_DATE_IN_FUTURE`, `MOVEMENT_CATEGORY_KIND_MISMATCH`; 401
  `UNAUTHENTICATED`; 403 `EMAIL_NOT_VERIFIED`; 404 `NOT_FOUND` (card, purchase or category missing or not the
  user's); 409 `CATEGORY_ARCHIVED`, `CARD_HAS_MOVEMENTS`; 429 `RATE_LIMITED`.
- Auth: `requireSession`, `requireVerifiedEmail`, owner scope; data of another user answers 404, never 403.

**Input validation**
- As Block 1: strict bodies, UUID ids, currency `ARS`, installments 2 to 60, amount positive up to 10^15, note at
  most 500 characters, months `YYYY-MM` with a range of at most 60 months; the JSON body limit stays 16 kB.

**Error handling**
- Domain errors map through the existing error middleware; unexpected errors are 500 `INTERNAL` without detail.
- A database error propagates as 500 and leaves no partial purchase (transaction).

**Required tests**
- [ ] `POST` 120,000.00 ARS in 12 installments answers 201 with 12 installments and `GET` lists it — validates AC-01
- [ ] `POST` with 1 and with 61 installments answers 400 and stores nothing (invalid input) — validates AC-02
- [ ] `POST` with currency `USD` answers 400 and stores nothing (invalid input) — validates AC-03
- [ ] 100.00 ARS in 3 installments answers 3334, 3333, 3333 minor units — validates AC-04
- [ ] a purchase assigned to the statement closing 2026-10-24 reads installments in the statements closing 2026-10-24, 2026-11-24 and 2026-12-24 — validates AC-05
- [ ] `GET /credit-cards/installment-expenses?from=2026-11&to=2026-11` returns 10,000.00 ARS for the purchase's category and not the rest of the purchase — validates AC-06
- [ ] a statement with 50,000.00 ARS and 20.00 USD of expenses and an installment of 10,000.00 ARS reads totals `{ ARS: "6000000", USD: "2000" }` — validates AC-07
- [ ] 11 installments in open statements give `pendingDebt.ARS` of `"11000000"` — validates AC-08
- [ ] `DELETE` after 2 statements closed answers 204, leaves 2 installments in the closed statements and removes 10 — validates AC-09
- [ ] Bob's `GET`, `PATCH` and `DELETE` on Ana's purchase answer 404 and change nothing (sad path) — validates AC-10
- [ ] `POST` with a future date answers 400, with an archived category 409, with an income category 400, with a category of another user 404 (sad path)
- [ ] the 61st creation of a minute answers 429 (sad path)
- [ ] no session answers 401 and an unverified email 403 (sad path)
- [ ] deleting a card that has purchases answers 409 `CARD_HAS_MOVEMENTS` and deleting a category used by a purchase answers 409 `CATEGORY_IN_USE` (sad path)
- [ ] reading the statements of a card with 60 active installment purchases answers at p95 under 300 ms — validates NFR-02
- [ ] `credit-cards` importing from `movements` is rejected by the boundary rule (sad path)

**Completion criterion**
`pnpm exec vitest run test/credit-cards test/foundation` passes and `pnpm test:perf` includes the new benchmark
under its threshold.

## Block 5 — Web API client and request builder

**Files**
- `apps/web/src/lib/api-client.ts` (modified) — `createInstallmentPurchase`, `listInstallmentPurchases`,
  `deleteInstallmentPurchase`.
- `apps/web/src/features/credit-cards/installment-request.ts` (new) — `buildInstallmentPurchaseRequest`.
- `apps/web/test/api-client-credit-cards.test.ts` (modified), `apps/web/test/installment-request.test.ts` (new).

**Logic**
The client calls the Block 4 routes through the existing `request` helper, parses the answers with the shared
schemas and builds paths with `resourcePath`. The builder turns the typed values into the request or per-field
messages: amount (shared parser, positive, at most 10^15), installments (integer 2 to 60), category (an open
expense category), purchase date (not after today in the user's zone), note.

**Input validation**
- Same rules as Block 1, checked client side for usability and again by the server.

**Error handling**
- A failure returns `{ ok: false, code, messageKey }`; an answer that fails its validator is `unexpected`; a
  network failure is `NETWORK`.

**Required tests**
- [ ] the client sends the right method, path and body and parses the success answer — validates AC-01
- [ ] a malformed success body maps to `unexpected` (error path)
- [ ] a card or purchase id of `..` is refused without a request (invalid input)
- [ ] the builder turns "120.000,00", 12 and a category into an amount of `12000000` and 12 installments — validates AC-01
- [ ] 1 and 61 installments, an empty amount, `0`, three decimals, a missing category and a future date give per-field messages and no request (invalid input) — validates AC-02
- [ ] the builder never offers USD: the request currency is always `ARS` — validates AC-03

**Completion criterion**
`pnpm exec vitest run test/api-client-credit-cards.test.ts test/installment-request.test.ts` passes in `apps/web`.

## Block 6 — Web screens

**Files**
- `apps/web/src/features/credit-cards/components/installment-form.tsx`, `installment-purchase-list.tsx` (new)
  — presentational.
- `apps/web/src/features/credit-cards/containers/installment-purchase-container.tsx` (new).
- `apps/web/src/app/[locale]/(app)/cards/[id]/installments/new/page.tsx` (new).
- `apps/web/src/features/credit-cards/components/statement-list.tsx`,
  `containers/credit-card-detail-container.tsx` (modified).
- `apps/web/messages/en.json`, `apps/web/messages/es.json` (modified) — `creditCards.installments.*`.
- `apps/web/test/installment-purchase.test.tsx` (new), `apps/web/test/credit-card-detail.test.tsx` (modified).

**Logic**
Container/presentational split. The new screen shows amount (ARS only, no currency choice), number of installments,
category, purchase date and note; on success it returns to the card page. The card page shows the pending debt,
the active installment purchases with their installments and a delete action with a confirmation, and each
statement row lists its installments and the total including them. All copy comes from the catalogs in Spanish and
English.

**Input validation**
- Block 5 builder; the form does not send while a field is invalid and focuses the first invalid one.

**Error handling**
- Field messages next to the field; `NOT_FOUND` shows the not-found state; `MOVEMENT_DATE_IN_FUTURE`,
  `CATEGORY_ARCHIVED` and `RATE_LIMITED` show their API messages as a form alert with the typed values kept;
  `NETWORK` shows the connection-needed message; `UNAUTHENTICATED` redirects to sign-in; a failed delete shows an alert and
  keeps the purchase listed.

**Required tests**
- [ ] typing 120.000,00, 12 installments and a category posts the purchase and returns to the card page — validates AC-01
- [ ] 1 and 61 installments show the field message and send nothing (invalid input) — validates AC-02
- [ ] the form has no currency choice and the request is ARS — validates AC-03
- [ ] the card page shows a pending debt of 110,000.00 ARS in Spanish and English — validates AC-08
- [ ] a statement with purchases of 50,000.00 ARS and 20.00 USD and an installment of 10,000.00 ARS shows 60,000.00 ARS and 20.00 USD and lists the installment — validates AC-07
- [ ] deleting a purchase asks for confirmation and removes it from the list — validates AC-09
- [ ] a 404 shows the not-found state, a network failure keeps the typed values, and a failed delete keeps the purchase (sad path)
- [ ] both catalogs have the same keys

**Completion criterion**
`pnpm exec vitest run test/installment-purchase.test.tsx test/credit-card-detail.test.tsx test/i18n-catalogs.test.ts` passes in `apps/web`.

## Block 7 — End to end: record an installment purchase and see it in the statements

**Files**
- `apps/web/e2e/credit-cards-installments.spec.ts` (new) — in the folder and style of the existing Playwright
  flows, with `test.use({ locale: 'es-AR', timezoneId: 'America/Cordoba' })`.

**Logic**
A verified user creates a card, opens the installment screen from the card page, records 120,000.00 ARS in 12
installments and sees the pending debt and the installment in the open statement total (FR-01, FR-06, FR-07); then
deletes the purchase and the pending debt returns to zero (FR-08).

**Error handling**
- The flow submits 1 installment and asserts the field message (sad path).

**Required tests**
- [ ] the flow records, shows the pending debt of 120,000.00 ARS and the installment in the statement, then deletes — validates AC-01, AC-07, AC-08, AC-09
- [ ] 1 installment shows the field message and creates nothing (sad path) — validates AC-02

**Completion criterion**
The spec lints and typechecks. Not run by the implementer: the orchestrator runs the e2e suite one at a time.

## Rollback
The migration `0020_installments` has a down script that drops `installments` and `installment_purchases`.
Reverting the commits restores the previous API and web; no existing table or column changes, and no movement is
written by this ticket, so existing balances are untouched.

## Final verification
- Every AC-01 to AC-10 has a passing test (Blocks 1 to 6), NFR-01 is asserted by schema introspection and the float
  guards, NFR-02 by the perf test and NFR-03 by the 10,000-purchase test.
- Full suite with coverage once: lines, branches and functions at or above 80% over the whole workspace.
- `pnpm lint`, `pnpm typecheck`, prettier and `pnpm audit --prod --audit-level high` are clean.

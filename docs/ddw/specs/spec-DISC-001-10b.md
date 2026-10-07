# Spec DISC-001-10b: Card Expenses and Statement Assignment

| Field | Value |
|-------|-------|
| Ticket | DISC-001-10b |
| PRD | docs/ddw/prd/prd-DISC-001-10b.md |
| Tier | FEATURE |
| Date | 2026-10-06 |
| Spec loops | 0 |
| Loops since last human decision | 0 |

## Summary
The `credit-cards` API module gets a use case `RecordCardExpense` behind `POST /credit-cards/:id/expenses`.
The body carries the currency the user chose (ARS or USD) and the usual expense fields without an
account; the use case picks the card's linked account of that currency (FR-01) and records an expense
on it through a port that the movements module implements, so every movements rule (date not in the
future, category kind, frozen rate, write limit) applies unchanged. A purchase is an expense
movement on one of the card's two linked accounts, however it was recorded. Its statement is not
stored: it is derived from the purchase's calendar day in the user's time zone and the statements'
closing dates, by one pure function (a day on or before a closing date and after the previous one
belongs to that statement; the first statement takes everything up to its closing date), so moving the
closing date of an open statement reassigns purchases by construction (FR-02). Statements read
through `GET /credit-cards/:id/statements` and `PATCH .../statements/:statementId` now carry
`totals` per currency, the sum of the purchases assigned to them (FR-03), computed from per-day sums
read from the movements table. The web app gets an "Add expense" screen on the card page and the
totals in the statement list. No schema change and no migration.

## Design decisions
- D1: A purchase is an expense (`type = 'expense'`) on a linked account of the card. Income (refunds),
  transfers (statement payments, DISC-001-10d) and exchanges on those accounts are not purchases and
  are not summed (PRD FR-03: "the sum of the purchases"). Expenses recorded on a linked account
  through the ordinary movement form count too, because the rule reads accounts and dates, not the
  route used.
- D2: The statement of a purchase is derived, not stored. A column would go stale on every statement
  date change and on every edit of a movement's date through the movements API, and AC-04 would need
  a reassignment job. The derivation cannot disagree with the dates. No migration is needed, so the
  0008-0012 reservation and the `when` rule do not apply to this ticket.
- D3: Assignment rule (FR-02), one pure function `assignStatement(day, statements)` in the
  `credit-cards` domain: with the statements ordered by closing date, a day belongs to the first
  statement whose closing date is on or after it. The previous statement therefore bounds it from
  below (a day after the previous closing date reaches a later statement), and a day earlier than
  every stored cycle belongs to the first statement (the card has no earlier cycle to receive it). A
  day after the last stored closing date has no statement; reading statements first creates the
  missing cycles up to the one open today (10a decision D6), and a purchase is never dated after
  today, so none is left out. Statements have no delete route (they go with their card), so the first one
  never disappears. `PATCH` answers with the totals of the stored statements; a day after the last
  stored closing date can exist only until the next statement read creates that cycle.
- D4: The calendar day of a purchase is its `occurred_at` instant in the user's stored time zone
  (PRD 01 FR-24), the same zone that decides when a statement closes (10a D8). The repository returns
  sums per local day and account, never rows, and the domain assigns the days to statements, so the
  rule lives in one place.
- D5: Totals are always reported for both currencies (`{ ARS, USD }`, zero when there are no
  purchases) as exact integer strings of minor units, the shape the accounts totals already use. They
  are never stored (NFR-01); the sums are `bigint` in the domain and `sum(...)::text` in SQL.
- D6: The card expense request has the shape of an expense request without `accountId`, `type`,
  `tags` and `id`: `{ currency, categoryId, amount, occurredAt, note?, rate }`. Tags and the
  device-id idempotency stay with the movement form, because the card expense screen is online only
  in this ticket: the offline queue stores `POST /movements` requests, and the linked accounts are
  already in the reference copy on the device, so at the moment of paying without a connection the
  user can still record on "<card name> ARS" or "<card name> USD" with the ordinary form. This is
  reported as an open owner decision (offline card expense).
- D7: The write limit and every movement rule are reused, not copied: the movements module exports a
  factory `createExpenseRecorder(db, logger)` that builds `CreateMovement` behind
  `RecordManualMovement` (the `manual` bucket of the limiter), and the composition root hands it to
  `createCreditCardRoutes`. `credit-cards` declares the `ExpenseRecorder` port it needs and never
  imports `movements` (10a D10 pattern).
- D8: The `Cards` entry of the navigation stays as 10a shipped it. Whether the card UI ships with
  10b is parent pending decision 4 and stays an owner decision.
- D9: No new runtime dependency and no money column or float: amounts are `bigint` or integer
  strings end to end (NFR-01).

## Coverage: PRD → blocks
| Requirement | Covered by |
|---|---|
| FR-01 | Block 1, Block 2, Block 3, Block 4, Block 5, Block 6, Block 8 |
| FR-02 | Block 2, Block 3, Block 4 |
| FR-03 | Block 1, Block 2, Block 3, Block 4, Block 7, Block 8 |
| NFR-01 | Strategy: nothing in this ticket stores money; Block 1 and Block 3 keep amounts as strings and `bigint`, Block 3 asserts that the schema has no new table or column, and the existing `no-float-money` guards keep scanning the API and web sources |

## Dependencies between blocks
Block 1 first (shared contract). The API blocks run in order 2 → 3 → 4: domain and use cases against
ports with fakes, then the Drizzle and movements adapters, then routes and composition. The web
blocks need Block 1 only for types: 5 → 6 → 7. Block 8 (end to end) needs every other block.

## Block 1 — Shared contract

**Files**
- `packages/shared/src/credit-cards/credit-card.ts` (modified) — `createCardExpenseRequestSchema`,
  `cardExpenseResponseSchema`, `statementTotalsSchema`; `statementResponseSchema` gains `totals`.
- `packages/shared/test/credit-card-schemas.test.ts` (modified) — the new schemas, and the existing
  statement case gains `totals`.

**Logic**
The contract of the new route and of the statement totals (FR-01, FR-03). Reuses
`accountCurrencySchema`, `movementAmountSchema`, `occurredAtSchema`, `movementNoteSchema`,
`movementRateRequestSchema` and `exactIntegerStringSchema`.

**Shared types** *(Block 4 serves them and Blocks 5 to 7 consume them)*
- `createCardExpenseRequestSchema`: strict `{ currency: 'ARS' | 'USD', categoryId: uuid, amount:
  movementAmountSchema, occurredAt: occurredAtSchema, note?: movementNoteSchema, rate:
  movementRateRequestSchema }`.
- `cardExpenseResponseSchema`: `{ movementId: string, accountId: string, currency, amount, occurredAt,
  statementId: string | null }`.
- `statementTotalsSchema`: `z.record(accountCurrencySchema, exactIntegerStringSchema)` with both keys.
- `statementResponseSchema`: existing fields plus `totals`.

**Input validation**
- `currency`: exactly `ARS` or `USD`; `categoryId`: UUID; `amount`: positive integer string up to
  10^15 minor units, no leading zeros; `occurredAt`: ISO UTC instant, years 1970 to 2100; `note`: at
  most 500 characters, no control or format characters; `rate`: `automatic` or `manual` with a scaled
  rate string. Unknown keys (including `accountId`) are refused (strict object).

**Error handling**
- Any schema failure is `VALIDATION_FAILED` (400) with the failing paths, never the values.

**Required tests**
- [ ] a valid card expense request parses and a response with `totals` `{ ARS: "5000000", USD: "2000" }` parses — validates AC-05
- [ ] an unknown currency `EUR`, a lowercase `usd` and a missing currency are rejected as invalid input — validates FR-01
- [ ] an `accountId` key, an amount of `0`, `15.99` or `"015"`, and a note with a zero-width character are rejected as invalid input — validates FR-01
- [ ] a statement response without `totals`, or with only one currency, is rejected — validates FR-03
- [ ] a rejected request carries only the failing paths, not the typed values (sad path) — validates FR-01

**Completion criterion**
`pnpm --filter @pesly/shared exec vitest run` passes and `pnpm typecheck` shows only the expected
consumers of `StatementResponse` still to update in later blocks (none left after Block 7).

## Block 2 — Domain and use cases

**Files**
- `apps/api/src/credit-cards/domain/statement-assignment.ts` (new) — `assignStatement(day,
  statements)`, `statementTotals(statements, dailyPurchases)`, types `DailyPurchase`,
  `StatementTotals`.
- `apps/api/src/credit-cards/domain/credit-card.ts` (modified) — `StatementView` gains `totals`.
- `apps/api/src/credit-cards/application/ports/card-purchases.ts` (new) — `CardPurchases`.
- `apps/api/src/credit-cards/application/ports/expense-recorder.ts` (new) — `ExpenseRecorder`.
- `apps/api/src/credit-cards/application/ensure-statements.ts` (new) — the creation of missing cycles
  moved out of `ListStatements`.
- `apps/api/src/credit-cards/application/dependencies.ts` (modified) — `purchases`, `expenses`.
- `apps/api/src/credit-cards/application/list-statements.ts`, `update-statement-dates.ts` (modified)
  — attach totals.
- `apps/api/src/credit-cards/application/record-card-expense.ts` (new).
- `apps/api/test/credit-cards/fakes.ts` (modified), `apps/api/test/credit-cards/statement-assignment.test.ts`
  (new), `apps/api/test/credit-cards/record-card-expense.test.ts` (new),
  `apps/api/test/credit-cards/use-cases.test.ts` (modified).

**Logic**
- `assignStatement` implements D3 over statements ordered by closing date.
- `statementTotals` walks the daily sums, assigns each to a statement and adds it to that
  statement's currency; days with no statement are ignored.
- `RecordCardExpense` (FR-01): scoped load of the card (missing or foreign is `ResourceNotFound`),
  picks `arsAccountId` or `usdAccountId` from `currency`, makes sure the cycles up to the one open
  today exist, records the expense through `ExpenseRecorder` on that account, and returns the
  recorded movement with the chosen account, the currency and the statement the purchase's local day
  falls in (`null` if none).
- `ListStatements` and `UpdateStatementDates` read the daily sums once and return views with
  `totals` (FR-03).
- `ensureStatements` is the former body of `ListStatements`, shared with `RecordCardExpense`.

**Error handling**
- `ResourceNotFound` (404) for a card that is missing or not the user's, before anything is
  recorded.
- Movement rule failures (`MOVEMENT_DATE_IN_FUTURE`, `CATEGORY_ARCHIVED`, kind mismatch, `RATE_REQUIRED`,
  archived linked account, write limit) propagate unchanged from the recorder; nothing else is written.
- A failure of the recorder leaves no statement change beyond the missing cycles that reading
  statements would have created anyway.

**Required tests**
- [ ] an expense of 15.99 USD on card "Visa" is recorded on the card's USD account and an ARS expense on its ARS account — validates AC-01
- [ ] a purchase on 2026-10-24 belongs to the statement closing 2026-10-24 — validates AC-02
- [ ] a purchase on 2026-10-25 belongs to the next statement, and on 2026-09-01 (before every stored cycle) to the first — validates AC-03
- [ ] after the closing date of the open statement moves from 2026-10-24 to 2026-10-26, the purchases of 2026-10-25 and 2026-10-26 belong to it and 2026-10-27 does not — validates AC-04
- [ ] 50,000.00 ARS in two purchases and 20.00 USD in one give totals ARS 5000000 and USD 2000, and a statement with none gives zeros — validates AC-05
- [ ] a day after the last stored closing date is assigned to no statement and adds to no total (error path)
- [ ] a card of another user is `ResourceNotFound` and nothing is recorded (sad path) — validates AC-01
- [ ] a failure of the recorder (future date) propagates and the fake stored no expense (sad path)
- [ ] listing statements still creates the missing cycles (regression of the extraction) — validates FR-02

**Completion criterion**
`pnpm exec vitest run test/credit-cards/statement-assignment.test.ts test/credit-cards/record-card-expense.test.ts test/credit-cards/use-cases.test.ts`
passes with fakes and no database, and domain and application files import no infrastructure.

## Block 3 — Persistence and movements adapters

**Files**
- `apps/api/src/movements/infrastructure/credit-cards/drizzle-card-purchases.ts` (new) —
  `createCardPurchases(db)`, the `CardPurchases` port implemented where the `movements` table lives,
  as `createAccountMovements` is for the accounts module.
- `apps/api/src/movements/infrastructure/accounts/drizzle-expense-recorder.ts` (new) —
  `createExpenseRecorder(db, logger, options?)`.
- `apps/api/src/movements/index.ts` (modified) — exports both factories.
- `apps/api/test/credit-cards/card-purchases.test.ts` (new),
  `apps/api/test/credit-cards/expense-recorder.test.ts` (new),
  `apps/api/test/credit-cards/schema-introspection.test.ts` (modified) — no new table or column.

**Logic**
- `dailyPurchases(scope, card, timeZone)` of the adapter: sums of `amount` of the movements with
  `type = 'expense'` on the card's two accounts, grouped by the account and by the local day
  (`to_char(occurred_at at time zone $tz, 'YYYY-MM-DD')`), filtered by `scopedTo(scope, { owner })` in
  the same statement and returned as `{ day, currency, amount: bigint }` (`sum(...)::text` to `BigInt`).
- `createExpenseRecorder` builds `CreateMovement` with the movements adapters behind
  `RecordManualMovement` and exposes `record(scope, expense)` which creates an `expense` movement
  (D7).
- The time zone adapter of 10a already falls back to Buenos Aires for an invalid stored zone.

**Data model**
- No entity is created or changed: no migration, no column, no index. the `movements` module only reads
  its own table (`account_id`, `owner_id`, `type`, `amount`, `occurred_at`) and filters by owner and
  account, which the existing index `movements_owner_account_date_idx` serves; constraints are
  unchanged and `credit-cards` gains no import of the movements table or module.

**Error handling**
- A scope that is not the owner's finds no rows (empty list, no error).
- A database error propagates to the error middleware as 500 `INTERNAL`.
- A movements rule failure propagates as its own `AppError`.

**Required tests**
- [ ] the daily sums group expenses by local day in the user's time zone: 2026-10-25T02:00Z is 2026-10-24 in Buenos Aires and 03:00Z is 2026-10-25 — validates AC-02, AC-03
- [ ] income, transfers and exchanges on the linked accounts and expenses on other accounts are not summed — validates FR-03
- [ ] another user's scope gets no rows for the card (sad path) — validates FR-03
- [ ] amounts above 2^53 sum exactly (error path of float handling) — validates NFR-01
- [ ] the recorder stores an expense on the given account with the frozen rate and counts against the manual write limit (sad path: the limit refuses the 61st) — validates FR-01
- [ ] the schema has no new table and the card tables still have 0 floating-point or numeric columns — validates NFR-01

**Completion criterion**
`pnpm exec vitest run test/credit-cards/card-purchases.test.ts test/credit-cards/expense-recorder.test.ts test/credit-cards/schema-introspection.test.ts`
passes against PostgreSQL (`TEST_DATABASE_URL`).

## Block 4 — Routes and composition

**Files**
- `apps/api/src/credit-cards/infrastructure/http/credit-card-routes.ts` (modified) — the new route, the
  `expenses` option, totals wiring.
- `apps/api/src/credit-cards/infrastructure/http/credit-card-presenter.ts` (modified) — `totals`,
  `presentCardExpense`.
- `apps/api/src/server.ts` (modified) — `expenses: createExpenseRecorder(db, logger)` and
  `purchases: createCardPurchases(db)`.
- `eslint.config.mjs` (modified) — a `credit-cards` block repeating the test-import and movements-import
  bans of the other modules, with the domain and application blocks repeated (flat config replaces
  rule options per file).
- `apps/api/test/credit-cards/credit-card-routes.test.ts` (modified) — `setup()` passes
  `expenses` and `purchases`.
- `apps/api/test/foundation/architecture-boundaries.test.ts` (modified) — the `credit-cards` module
  still imports `movements` nowhere.

**Logic**
`POST /credit-cards/:id/expenses` runs `requireSession`, `requireVerifiedEmail`, a write scope, the
shared `validate` middleware and `RecordCardExpense`. Audit lines carry the request id, user id, card
id and movement id, never the amount or the note.

**API contract**
- Method + path: `POST /credit-cards/:id/expenses`.
- Request: params `{ id: uuid }`, body `{ currency: 'ARS' | 'USD',
  categoryId: uuid, amount: string, occurredAt: ISO UTC string, note?: string, rate: { source:
  'automatic' } | { source: 'manual', value: string } }`.
- Response: 201 `{ movementId: string, accountId: string,
  currency: 'ARS' | 'USD', amount: string, occurredAt: string, statementId: string | null }`.
- `GET /credit-cards/:id/statements` and `PATCH /credit-cards/:id/statements/:statementId` (existing)
  → each statement gains `totals: { ARS: string, USD: string }`.
- Error codes of the new route: 400 `VALIDATION_FAILED`, 404 `NOT_FOUND` (card missing or not the
  user's), 409 `ACCOUNT_ARCHIVED` and `CATEGORY_ARCHIVED`, 400 `MOVEMENT_DATE_IN_FUTURE`,
  `RATE_REQUIRED` and `MOVEMENT_CATEGORY_KIND_MISMATCH` as the movements module maps them, 429
  `RATE_LIMITED`, 401 `UNAUTHENTICATED`, 403 `EMAIL_NOT_VERIFIED`.
- Auth: `requireSession`, `requireVerifiedEmail`, owner scope; data of another user answers 404,
  never 403.

**Input validation**
- As Block 1: strict body, currency `ARS` or `USD`, positive integer string amount up to 10^15, UUID
  ids, note up to 500 characters; the JSON body limit stays 16 kB.

**Error handling**
- Domain errors map through the existing error middleware; unexpected errors are 500 `INTERNAL`
  without detail.

**Required tests**
- [ ] `POST` an expense of 15.99 USD on "Visa" answers 201 with the USD account id, and `GET /movements` shows it on "Visa USD" — validates AC-01
- [ ] with the clock on 2026-10-25 a purchase dated 2026-10-24 and one dated 2026-10-25 land in different statements, read through `GET /credit-cards/:id/statements` totals — validates AC-02, AC-03
- [ ] `PATCH` the open statement's closing date from 2026-10-24 to 2026-10-26 and the purchases of 2026-10-25 and 2026-10-26 move into its totals on the next read — validates AC-04
- [ ] a statement with 50,000.00 ARS and 20.00 USD of purchases reads totals `{ ARS: "5000000", USD: "2000" }` — validates AC-05
- [ ] `POST` with `accountId`, with currency `EUR` or with amount `0` answers 400 and records nothing (invalid input) — validates FR-01
- [ ] Bob's `POST` on Ana's card answers 404 and records nothing (sad path)
- [ ] `POST` with a future date answers 400 `MOVEMENT_DATE_IN_FUTURE`, with an archived category 409, and with no stored rate 400 `RATE_REQUIRED` (sad path)
- [ ] the 61st card expense of a minute answers 429 (sad path)
- [ ] no session answers 401 and an unverified email 403 (sad path)
- [ ] `credit-cards` importing from `movements` is rejected by the boundary rule (sad path)

**Completion criterion**
`pnpm exec vitest run test/credit-cards test/foundation` passes.

## Block 5 — Web API client and request builder

**Files**
- `apps/web/src/lib/api-client.ts` (modified) — `createCardExpense(cardId, body)`.
- `apps/web/src/features/credit-cards/card-expense-request.ts` (new) — `buildCardExpenseRequest`.
- `apps/web/src/features/movements/movement-request.ts` (modified) — `parseAmountField` exported.
- `apps/web/test/api-client-credit-cards.test.ts` (modified) — the statement fixture and the
  existing cases gain `totals`; `apps/web/test/card-expense-request.test.ts` (new).

**Logic**
`createCardExpense` calls the Block 4 route through the existing `request` helper and parses the
answer with `cardExpenseResponseSchema`; the id goes through `resourcePath`. `buildCardExpenseRequest`
turns the typed values into the request or per-field messages: currency, category (an open expense
category), amount (the shared parser, positive, at most 10^15), date and time converted to a UTC
instant in the user's time zone and not after today, note. The rate is always `{ source: 'automatic' }`
(the screen is online only, D6).

**Input validation**
- Same rules as the movement form: amount with at most 2 decimals, date not in the future in the
  user's zone, a skipped wall-clock time refused, note at most 500 characters.

**Error handling**
- A failure returns `{ ok: false, code, messageKey }`; an answer that fails its validator is
  `unexpected`; a network failure is `NETWORK`.

**Required tests**
- [ ] the client sends the right method, path and body and parses the success answer — validates FR-01
- [ ] a malformed success body maps to `unexpected` (error path)
- [ ] an id of `..` is refused without a request (invalid input)
- [ ] the builder turns "15,99", USD and a category into the request with an amount of `1599` — validates AC-01
- [ ] an empty amount, `0`, three decimals, a missing category, a future date and a skipped time give per-field messages and no request (invalid input) — validates FR-01

**Completion criterion**
`pnpm exec vitest run test/api-client-credit-cards.test.ts test/card-expense-request.test.ts` passes in `apps/web`.

## Block 6 — Web: card expense screen

**Files**
- `apps/web/src/features/credit-cards/components/card-expense-form.tsx` (new) — presentational form.
- `apps/web/src/features/credit-cards/containers/card-expense-container.tsx` (new).
- `apps/web/src/app/[locale]/(app)/cards/[id]/expense/page.tsx` (new).
- `apps/web/messages/en.json`, `apps/web/messages/es.json` (modified) — `creditCards.expense.*`.
- `apps/web/test/card-expense.test.tsx` (new).

**Logic**
Container/presentational split. The container loads the card, the user's open expense categories and
the profile (time zone), and shows the form: currency (ARS or USD, the card's accounts are not
shown), amount, category, date and time, note. On submit it builds the request (Block 5), calls the
API and, on success, returns to the card page. Without a connection (no answer) the form shows that
a connection is needed and keeps what was typed (D6). All copy comes from the catalogs in Spanish and
English.

**Input validation**
- Block 5 builder; the form never sends while a field is invalid and focuses the first invalid one.

**Error handling**
- Field messages next to the field; `NOT_FOUND` shows the not-found state; `RATE_REQUIRED`,
  `MOVEMENT_DATE_IN_FUTURE`, archived category and the write limit show their existing API messages as
  a form alert with the typed values kept; `NETWORK` shows the connection-needed message;
  `UNAUTHENTICATED` redirects to sign-in.

**Required tests**
- [ ] choosing USD, typing 15,99 and a category posts a USD expense to the card route and returns to the card page — validates AC-01
- [ ] an empty amount shows the field message and sends nothing (invalid input) — validates FR-01
- [ ] a 404 shows the not-found state (sad path)
- [ ] a 400 `RATE_REQUIRED` and a 429 show their messages and keep the typed values (sad path)
- [ ] a network failure shows the connection-needed message and keeps the values (sad path)
- [ ] the form renders in Spanish and in English, and both catalogs have the same keys

**Completion criterion**
`pnpm exec vitest run test/card-expense.test.tsx test/i18n-catalogs.test.ts` passes in `apps/web`.

## Block 7 — Web: totals in the statement list and the entry to the screen

**Files**
- `apps/web/src/features/credit-cards/components/statement-list.tsx` (modified) — totals per
  currency.
- `apps/web/src/features/credit-cards/containers/credit-card-detail-container.tsx` (modified) — the
  "Add expense" link.
- `apps/web/messages/en.json`, `apps/web/messages/es.json` (modified) — `creditCards.detail.total*`,
  `creditCards.detail.addExpense`.
- `apps/web/test/credit-card-detail.test.tsx` (modified) — the `statement()` helper gains `totals`.

**Logic**
Each statement row shows its total per currency, formatted with the locale money formatter
(FR-03), and the card page links to the expense screen. The existing edit and delete flows are
unchanged.

**Input validation**
- None: the block only displays server data.

**Error handling**
- A statement answer without totals is rejected by the client validator (Block 1), so the list never
  renders an undefined total; the existing load-failure state applies.

**Required tests**
- [ ] a statement with 50,000.00 ARS and 20.00 USD shows both totals in Spanish and English — validates AC-05
- [ ] a statement with no purchases shows zero in both currencies — validates FR-03
- [ ] the card page links to the expense screen of the card — validates FR-01
- [ ] a statement answer without `totals` shows the load-failure state (error path)

**Completion criterion**
`pnpm exec vitest run test/credit-card-detail.test.tsx` passes in `apps/web`.

## Block 8 — End to end: record a card expense and see it in the statement

**Files**
- `apps/web/e2e/credit-cards-expenses.spec.ts` (new) — written in the folder and style of the existing
  Playwright flows, with `test.use({ locale: 'es-AR', timezoneId: 'America/Cordoba' })`.

**Logic**
A verified user creates a card, opens the expense screen from the card page, records a USD expense
of today and sees the USD total of the open statement on the card page; the expense is also in the
movements list on the card's USD account (FR-01, FR-02, FR-03).

**Error handling**
- The flow submits the form with no amount and asserts the field message (sad path).

**Required tests**
- [ ] the flow above passes in Chromium — validates AC-01, AC-05
- [ ] the empty-amount submit shows the field message and creates nothing (sad path) — validates FR-01

**Completion criterion**
The spec lints and typechecks. Not run by the ticket's implementer: Playwright ports and the Mailpit
inbox are shared on the machine and the orchestrator runs the e2e suite one at a time.

## Rollback
No migration and no data change: reverting the ticket's commits restores the previous API and web.
Purchases are movements on the card's linked accounts and are untouched by the revert.

## Final verification
- Every AC-01 to AC-05 has a passing test (Blocks 2 to 7), and NFR-01 is asserted by schema
  introspection and the float guards.
- Full suite with coverage once: lines, branches and functions at or above 80% over the whole
  workspace.
- `pnpm lint`, `pnpm typecheck` and `pnpm audit --prod --audit-level high` are clean.

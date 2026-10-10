# Spec DISC-001-10a: Cards, Linked Accounts and Statement Cycles

| Field | Value |
|-------|-------|
| Ticket | DISC-001-10a |
| PRD | docs/ddw/prd/prd-DISC-001-10a.md |
| Tier | FEATURE |
| Date | 2026-10-06 |
| Spec loops | 1 |
| Loops since last human decision | 1 |

## Summary
A new hexagonal API module, `credit-cards`, stores a card (name, default closing day, default due
day) together with its two linked accounts of type credit card, "<card name> ARS" and "<card name>
USD", created in the same database transaction as the card. Each card has statements, one per
monthly cycle, keyed by the cycle's month (`period`, `YYYY-MM`) and carrying a closing date and a due
date computed from the card's default days, with the last day of the month standing in for a day the
month does not have. Statements are created on demand: the first one with the card, the following
ones when a user reads the card's statements and the latest one has closed in the user's time zone.
A statement is closed once its closing date has ended in the user's time zone; open statements can
have their dates edited, and a change of the card's default days recomputes every open statement.
The web app gets a card list, a create form and a card page with the statements. Nothing about card
expenses, installments, totals, payments, automatic debit or reminders is built (DISC-001-10b to
10f).

## Design decisions
- D1: User decision (2026-10-06, option A): deleting a card deletes the card, its statements and
  both linked accounts in one transaction, but only when neither linked account has movements;
  otherwise the API answers 409 `CARD_HAS_MOVEMENTS` and nothing changes. The PRD does not settle
  this; the user did.
- D2: User decision (2026-10-06): a linked account cannot be deleted through the accounts API
  (`DELETE /accounts/:id` answers 409 `ACCOUNT_LINKED_TO_CARD`); renaming and archiving a linked
  account stay allowed and do not touch the card.
- D3: User decision (2026-10-06): a card name is 1 to 46 characters (the same rules as an account
  name: NFC, trimmed, no control or format characters), so "<card name> ARS" fits the 50-character
  account name. If either account name is already taken by the owner (case-insensitive, PRD 02),
  creating the card is refused with 409 `ACCOUNT_NAME_TAKEN` and nothing is stored.
- D4: User decision (2026-10-06): in this ticket a card is edited only through its default closing
  and due days (FR-06); there is no card rename. The linked accounts can be renamed through the
  accounts API (D2).
- D5: User decision (2026-10-06): changing a card's default days overwrites the dates of every open
  statement, including dates a user edited by hand (FR-05), as AC-08 reads; closed statements are
  never touched.
- D6: User decision (2026-10-06): statements are created on demand, with no scheduler. The card's
  first statement is created with the card: the first cycle whose closing date is today or later in
  the user's time zone. `GET /credit-cards/:id/statements` creates, before reading, every missing
  cycle after the latest stored statement until one is open. Inserts use `on conflict (card_id,
  period) do nothing`, so two concurrent reads cannot create a cycle twice.
- D7: Cycle arithmetic (FR-03, FR-04) is a pure function in `packages/shared`: for a period
  `YYYY-MM`, the closing date is the default closing day in that month, or the month's last day when
  the month is shorter; the due date is the default due day in the closing date's month when that
  date is after the closing date, otherwise in the following month, with the same last-day rule.
  AC-04: closing day 24 and due day 5 give 2026-10-24 and 2026-11-05 for period 2026-10.
- D8: A statement is closed when `closing_date < today` in the user's time zone (FR-07): the closing
  date "has ended" once the user's calendar has moved past it. The status is computed on every read
  from the user's stored time zone (PRD 01 FR-24) and never stored, so a time zone change takes
  effect on the next read. Closing and due dates are calendar dates (`date` columns), which carry no
  time zone; `created_at` and `updated_at` are UTC timestamps.
- D9: Statement dates keep an order invariant. An edit (FR-05) is valid when the closing date is
  after the previous statement's closing date, before the closing date the next cycle would get
  from the card's current default days, and the due date is after the closing date. A change of
  default days (FR-06) is refused with 400 when a recomputed open statement would close on or before
  the previous statement's closing date. Moving an open statement's closing date to a past day is
  allowed: FR-07 then marks it closed, which mirrors a bank that closed early.
- D10: Cross-module links follow the movements pattern. `credit-cards` declares ports for what it
  needs (user time zone, whether accounts have movements) and its infrastructure imports the
  `users` and `accounts` tables only through `infrastructure/db/foreign-relations.ts`, as
  drizzle-kit needs them for the foreign keys. The card repository writes the two linked accounts
  rows inside its transaction, with the same values the accounts module would store for a credit
  card (opening balance 0, not included in the available total). Whether an account has movements
  comes from the movements module's existing `createAccountMovements(db)` adapter, wired in the
  composition root. The accounts module gains an `AccountLinks` port (default: no links) that
  `credit-cards` implements; the accounts module never imports `credit-cards`.
- D11: Database backstops. The card's two account columns are composite foreign keys
  `(account_id, owner_id) → accounts(id, owner_id)` with `on delete restrict`, so a linked account
  cannot disappear under a card even if a guard is bypassed, and the owner of both accounts is the
  card's owner. Statements reference `(card_id, owner_id) → credit_cards(id, owner_id)` with
  `on delete cascade`. Because the restricting keys would block the cascade from `users`, an ordered
  erasure step `eraseUserCreditCards` deletes the user's cards before the user is deleted (PRD 01f),
  registered after `eraseUserMovements`.
- D12: Migration `0019_credit_cards` (reserved number, PRD Risks): two new tables, additive, no
  change to existing tables; its journal `when` is greater than 1791162359112 (0018 on this branch)
  and than `main`'s maximum (1790992572883). Rollback script `0019_credit_cards.down.sql`, idempotent,
  drops both tables (destructive for card data only; the linked accounts stay as plain credit card
  accounts).
- D13: Navigation: the web app gets a `/cards` page linked from the side navigation and the More
  page (a secondary item). Parent pending decision 4 (release card UI with 10b) is a release choice
  for the orchestrator; removing the item is a one-line change.
- D14: No new runtime dependency and no money column: the tables store days, dates, names and ids
  only (NFR-01).

## Coverage: PRD → blocks
| Requirement | Covered by |
|---|---|
| FR-01 | Block 1, Block 3, Block 4, Block 6, Block 8 |
| FR-02 | Block 2, Block 3, Block 4, Block 5, Block 6 |
| FR-03 | Block 1, Block 3, Block 4, Block 6, Block 9 |
| FR-04 | Block 1, Block 3 |
| FR-05 | Block 3, Block 4, Block 6, Block 9 |
| FR-06 | Block 3, Block 4, Block 6, Block 9 |
| FR-07 | Block 1, Block 3, Block 6, Block 9 |
| FR-08 | Block 2, Block 4, Block 6, Block 7, Block 8 |
| NFR-01 | Strategy: no money is stored by this ticket; Block 2 asserts by catalog introspection that the two new tables have 0 `real`, `double precision` or `numeric` columns, and the existing `no-float-money` guard keeps scanning the schema files |

## Dependencies between blocks
Block 1 first (shared contract and cycle arithmetic). The API blocks run in order 2 → 3 → 4 → 5 →
6: the migration and schema, the domain and use cases, the Drizzle adapters, the accounts guard, the
routes and composition. The web blocks need Block 1 only for types: 7 → 8 → 9. Block 10 (end to end)
needs every other block.

## Block 1 — Shared contract and cycle arithmetic

**Files**
- `packages/shared/src/credit-cards/statement-cycle.ts` (new) — `daysInMonth`, `clampedDate`,
  `statementDatesFor(period, closingDay, dueDay)`, `nextPeriod`, `firstOpenPeriod(today,
  closingDay)`, `isStatementClosed(closingDate, today)`.
- `packages/shared/src/credit-cards/credit-card.ts` (new) — Zod schemas and types of the contract.
- `packages/shared/src/accounts/account.ts` (modified) — the name rules become `boundedNameSchema(max)`;
  `accountNameSchema` is `boundedNameSchema(50)`, unchanged behavior.
- `packages/shared/src/errors.ts` (modified) — codes `ACCOUNT_LINKED_TO_CARD`,
  `CARD_HAS_MOVEMENTS`, `STATEMENT_CLOSED`.
- `packages/shared/src/index.ts` (modified) — exports.
- `apps/api/src/shared/http/error-handler.ts` (modified) — the three codes map to 409.
- `apps/web/src/lib/api-client.ts` (modified) — message keys for the three codes.
- `apps/web/messages/en.json`, `apps/web/messages/es.json` (modified) — `errors.accountLinkedToCard`,
  `errors.cardHasMovements`, `errors.statementClosed`.
- `packages/shared/test/statement-cycle.test.ts` (new), `packages/shared/test/credit-card-schemas.test.ts` (new).

**Logic**
Pure functions over `YYYY-MM` periods and `YYYY-MM-DD` dates, computed with integer year, month and
day arithmetic (no `Date` time zone involved). `statementDatesFor` implements D7 (FR-03, FR-04).
`firstOpenPeriod(today, closingDay)` returns today's month when its closing date is today or later,
otherwise the next month (D6). `isStatementClosed` is `closingDate < today` (FR-07, D8).

**Shared types** *(no route here; Block 6 serves them and Block 7 consumes them)*
- `createCreditCardRequestSchema`: `{ name: cardName, closingDay: day, dueDay: day }`, strict.
- `updateCreditCardRequestSchema`: `{ closingDay?: day, dueDay?: day }`, strict, at least one key.
- `updateStatementRequestSchema`: `{ closingDate?: isoDate, dueDate?: isoDate }`, strict, at least one.
- `creditCardIdParamsSchema` `{ id: uuid }`; `statementParamsSchema` `{ id: uuid, statementId: uuid }`.
- `creditCardResponseSchema`: `{ id, name, closingDay, dueDay, arsAccountId, usdAccountId, createdAt }`.
- `listCreditCardsResponseSchema`: `{ items: CreditCardResponse[] }`.
- `statementResponseSchema`: `{ id, cardId, period, closingDate, dueDate, status: 'open' | 'closed' }`.
- `listStatementsResponseSchema`: `{ items: StatementResponse[] }`.

**Input validation**
- `name`: string, `boundedNameSchema(46)` (1 to 46 code points after NFC and trim, no control or
  format characters).
- `closingDay`, `dueDay`: integers 1 to 31; strings, decimals and out-of-range values are refused.
- `closingDate`, `dueDate`: `YYYY-MM-DD` that is a real calendar date (2027-02-29 is refused).
- Ids: UUID. Unknown keys are refused (strict objects).

**Error handling**
- Any schema failure is `VALIDATION_FAILED` (400) with the failing paths, never the values.
- An impossible period or date passed to the cycle functions throws `RangeError` (a programming
  error; inputs reach them already validated).

**Required tests**
- [ ] period 2026-10 with closing day 24 and due day 5 gives 2026-10-24 and 2026-11-05 — validates AC-04
- [ ] closing day 31 in period 2027-02 gives 2027-02-28, and in 2028-02 gives 2028-02-29 — validates AC-05
- [ ] due day 31 after a closing on 2026-11-24 gives 2026-11-30; due day equal to the closing day rolls to the next month — validates FR-04
- [ ] `firstOpenPeriod` picks this month on or before the closing day and the next month after it, across December to January — validates FR-03
- [ ] `isStatementClosed` is false on the closing date and true the day after — validates AC-09
- [ ] closing or due day 0, 32, 1.5 and "24" are rejected as invalid input — validates AC-02
- [ ] a 47-character name, a blank name and a name with a zero-width character are rejected as invalid input — validates FR-01
- [ ] 2027-02-29, `2026-1-05` and an empty update body are rejected as invalid input — validates FR-05
- [ ] a cycle function given an impossible period throws `RangeError` (error path)
- [ ] `accountNameSchema` behaves as before (50 characters accepted, 51 rejected) — regression

**Completion criterion**
`pnpm --filter @pesly/shared exec vitest run` passes with the new files, and `pnpm typecheck` is
clean in the API and web packages (the error-code records are exhaustive).

## Block 2 — Migration 0019, schema and rollback

**Files**
- `apps/api/src/credit-cards/infrastructure/db/schema.ts` (new) — `credit_cards`, `credit_card_statements`.
- `apps/api/src/credit-cards/infrastructure/db/foreign-relations.ts` (new) — re-exports `users` and `accounts`.
- `apps/api/drizzle/0019_credit_cards.sql`, `apps/api/drizzle/meta/0019_snapshot.json`,
  `apps/api/drizzle/meta/_journal.json` (generated by drizzle-kit, statement order hand-checked).
- `apps/api/drizzle/rollback/0019_credit_cards.down.sql` (new).
- `apps/api/test/identity/migration.test.ts` (modified) — every rollback chain reverts 0019 first,
  `ALL_MIGRATIONS` 19, each `ALL_MIGRATIONS - n` becomes `- (n + 1)`, plus a `0019_credit_cards` suite.
- `apps/api/test/investments/investments-migration.test.ts`, `apps/api/test/investments/price-migration.test.ts`
  (modified) — `0019_credit_cards` added to their lists of newer migrations.
- `apps/api/test/credit-cards/schema-introspection.test.ts` (new).

**Logic**
Two additive tables (FR-02, FR-08). The composite keys make PostgreSQL check that both linked
accounts belong to the card's owner and that a statement belongs to its card's owner (D11).

**Data model**
- `credit_cards`: `id uuid pk default gen_random_uuid()`; `owner_id uuid not null → users(id) on
  delete cascade`; `name text not null`, check `char_length between 1 and 46`; `closing_day smallint
  not null`, check `between 1 and 31`; `due_day smallint not null`, check `between 1 and 31`;
  `ars_account_id uuid not null`, `usd_account_id uuid not null`, composite foreign keys
  `credit_cards_ars_account_owner_fk (ars_account_id, owner_id) → accounts(id, owner_id) on delete
  restrict` and `credit_cards_usd_account_owner_fk` likewise; unique `ars_account_id`, unique
  `usd_account_id`; check `ars_account_id <> usd_account_id`; unique `(id, owner_id)` (target of the
  statements key); `created_at`, `updated_at timestamptz not null default now()`; index
  `(owner_id, created_at, id)`.
- `credit_card_statements`: `id uuid pk default gen_random_uuid()`; `card_id uuid not null`,
  `owner_id uuid not null`, composite foreign key `(card_id, owner_id) → credit_cards(id, owner_id)
  on delete cascade`; `period text not null`, check `~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`; `closing_date
  date not null`; `due_date date not null`; check `due_date > closing_date`; unique `(card_id,
  period)`; `created_at`, `updated_at timestamptz not null default now()`; indexes `(owner_id)` and
  `(card_id, closing_date)`.
- No `real`, `double precision` or `numeric` column (NFR-01).

**Error handling**
- The migration runs in the drizzle migrator transaction; a failure leaves the 0018 schema.
- drizzle-kit may emit the `unique (id, owner_id)` of `credit_cards` after the statements foreign
  key that needs it; the generated file is reordered by hand (as 0014 was) and carries a header.
- The rollback tolerates missing tables (`drop table if exists`) and forgets the journal row by its
  `when`, so it can run twice.

**Required tests**
- [ ] the migration applies on the 0018 schema and creates both tables with their keys — validates FR-02
- [ ] the rollback drops both tables, keeps `accounts` rows, and a second run is a no-op (sad path: already rolled back)
- [ ] every older migration suite still passes with 0019 reverted first (counters moved by one)
- [ ] a card whose ARS account belongs to another owner is refused by the foreign key — invalid input, validates AC-10
- [ ] a statement with `due_date <= closing_date`, a period `2026-13` and a closing day 32 are refused by the checks — invalid input
- [ ] deleting a linked account row directly is refused by the restricting key (sad path)
- [ ] the two new tables have 0 floating-point or numeric columns — validates NFR-01

**Completion criterion**
`pnpm exec vitest run test/identity/migration.test.ts test/investments test/credit-cards/schema-introspection.test.ts`
passes, `drizzle-kit check` reports no drift, and the 0019 journal `when` exceeds 1791162359112.

## Block 3 — Domain and use cases

**Files**
- `apps/api/src/credit-cards/domain/credit-card.ts` (new) — `CreditCard`, `Statement`, `linkedAccountNames(name)`.
- `apps/api/src/credit-cards/domain/statement-schedule.ts` (new) — `missingStatements(latest, card, today)`,
  `recomputedOpenStatements(statements, card, today)`, `validateStatementDates(...)`.
- `apps/api/src/credit-cards/domain/errors.ts` (new) — `CardAccountNameTaken`, `CardHasMovements`,
  `StatementClosed`, `StatementDatesInvalid`, `CardDaysConflict`.
- `apps/api/src/credit-cards/application/ports/credit-card-repository.ts` (new).
- `apps/api/src/credit-cards/application/ports/account-activity.ts` (new) — `hasMovements(accountId)`.
- `apps/api/src/credit-cards/application/ports/user-time-zone.ts` (new), `.../ports/clock.ts` (new).
- `apps/api/src/credit-cards/application/create-credit-card.ts`, `list-credit-cards.ts`,
  `get-credit-card.ts`, `update-credit-card-days.ts`, `delete-credit-card.ts`, `list-statements.ts`,
  `update-statement-dates.ts` (new).
- `apps/api/test/credit-cards/fakes.ts`, `apps/api/test/credit-cards/use-cases.test.ts`,
  `apps/api/test/credit-cards/statement-schedule.test.ts` (new).

**Logic**
- `CreateCreditCard` (FR-01, FR-02, FR-03): reads the user's time zone and today, computes the first
  open period (D6) and its dates, and asks the repository to create the card, its two linked
  accounts ("<name> ARS", "<name> USD") and that statement atomically.
- `ListCreditCards`, `GetCreditCard` (FR-08): scoped reads; missing or foreign is `ResourceNotFound`.
- `UpdateCreditCardDays` (FR-06, D5, D9): loads the card and its open statements (closing date today
  or later), recomputes each one's dates for its period with the new days, refuses with
  `CardDaysConflict` when one would close on or before the previous statement's closing date, then
  saves the days and the recomputed statements in one repository call. Closed statements are not
  read for writing (AC-08).
- `DeleteCreditCard` (FR-08, D1): scoped load; if either linked account has movements,
  `CardHasMovements`; otherwise the repository deletes card, statements and accounts.
- `ListStatements` (FR-03, FR-07, D6): scoped load of the card; computes the missing cycles after the
  latest statement until one has `closingDate >= today`, inserts them, returns every statement newest
  first with `status` from `isStatementClosed`.
- `UpdateStatementDates` (FR-05, D9): scoped load of the statement; closed is `StatementClosed`;
  validates the resulting pair against the previous statement and the next cycle's default closing
  date; saves.
- `missingStatements` never produces a closing date on or before the latest one: a cycle whose
  computed closing date is not after it is skipped. It stops after 1,200 cycles (a card read after
  a century) as a guard against a loop.

**Error handling**
- `ResourceNotFound` (404) for a card or statement that is missing or not the user's.
- `StatementClosed` (409 `STATEMENT_CLOSED`) when editing a closed statement.
- `StatementDatesInvalid` (400 `VALIDATION_FAILED`, fields `body.closingDate` or `body.dueDate`)
  when the order invariant breaks.
- `CardDaysConflict` (400 `VALIDATION_FAILED`, field `body.closingDay`) when new days would break it.
- `CardHasMovements` (409 `CARD_HAS_MOVEMENTS`) when a linked account has movements.

**Required tests**
- [ ] creating "Visa" with days 24 and 5 on 2026-10-06 asks for accounts "Visa ARS" and "Visa USD" and a 2026-10 statement closing 2026-10-24, due 2026-11-05 — validates AC-01, AC-03, AC-04
- [ ] created on 2026-10-25 the first statement is 2026-11 — validates FR-03
- [ ] listing statements on 2027-01-10 after a 2026-10 statement creates 2026-11, 2026-12 and 2027-01 and marks the first two closed — validates AC-09
- [ ] in America/Argentina/Buenos_Aires a 2026-10-24 statement is open at 2026-10-25T02:00Z and closed at 2026-10-25T03:00Z — validates AC-09, FR-07
- [ ] moving an open statement's closing date from 2026-10-24 to 2026-10-26 saves it — validates AC-06
- [ ] editing a closed statement fails with `StatementClosed` (sad path) — validates AC-07
- [ ] a closing date on or before the previous closing date, or at or after the next cycle's, and a due date not after the closing date fail with `StatementDatesInvalid` (sad path)
- [ ] changing the closing day from 24 to 20 rewrites the open statement to day 20, including a hand-edited one, and leaves closed ones unchanged — validates AC-08
- [ ] a day change that would close the open statement on or before the previous one fails with `CardDaysConflict` (sad path)
- [ ] deleting a card whose USD account has a movement fails with `CardHasMovements` and deletes nothing (sad path) — validates FR-08
- [ ] a card or statement of another user is `ResourceNotFound` for read, edit and delete (sad path) — validates AC-10
- [ ] `missingStatements` skips a cycle whose closing date is not after the latest one and stops at the guard (error path)

**Completion criterion**
`pnpm exec vitest run test/credit-cards/use-cases.test.ts test/credit-cards/statement-schedule.test.ts`
passes with fakes and no database, and domain and application files import no infrastructure.

## Block 4 — Persistence adapters and the erasure step

**Files**
- `apps/api/src/credit-cards/infrastructure/db/drizzle-credit-card-repository.ts` (new).
- `apps/api/src/credit-cards/infrastructure/db/drizzle-user-time-zone.ts` (new).
- `apps/api/src/credit-cards/infrastructure/db/drizzle-card-account-links.ts` (new) — implements the
  accounts module's `AccountLinks` port (Block 5).
- `apps/api/src/credit-cards/infrastructure/db/erase-user-credit-cards.ts` (new).
- `apps/api/src/credit-cards/infrastructure/system-clock.ts` (new).
- `apps/api/test/credit-cards/credit-card-repository.test.ts`, `apps/api/test/credit-cards/erasure-step.test.ts` (new).

**Logic**
- `create`: one transaction inserts the ARS account, the USD account (type `credit_card`, opening
  balance 0, `include_in_available` false), the card and its first statement; a unique violation on
  `accounts_owner_name_unique` becomes `CardAccountNameTaken` and rolls everything back (D3).
- Every read and write filters with `scopedTo(scope, { owner })` in the same statement (FR-08); list
  orders by `created_at, id` (AC-11).
- `insertStatements` uses `on conflict (card_id, period) do nothing` (D6).
- `updateDays`: one transaction updates the card's days and the recomputed open statements.
- `delete`: one transaction deletes the card (statements cascade) and then both accounts by id and
  owner; a foreign-key violation from a movement inserted in between becomes `CardHasMovements`.
- `isLinked(accountId)`: true when a card references the account (UNSCOPED BY DESIGN, like
  `AccountMovements`: the accounts module passes an id its scoped repository just returned).
- `eraseUserCreditCards(tx, userId)`: deletes the user's cards (statements cascade) so the
  restricting keys do not block the cascade from `users` (D11).
- The time zone adapter falls back to Buenos Aires for an invalid stored zone and fails closed for a
  missing user, as the movements adapter does.

**Error handling**
- Duplicate linked account name → `CardAccountNameTaken`, no row written.
- Movement inserted during a delete → `CardHasMovements`, transaction rolled back.
- Any other database error propagates to the error middleware as 500 `INTERNAL`.

**Required tests**
- [ ] create stores the card, both accounts with the right names, currencies and type, and the first statement — validates AC-01, AC-03
- [ ] create when "Visa USD" already exists (any case) fails with `CardAccountNameTaken` and leaves no card and no "Visa ARS" (sad path) — validates FR-02
- [ ] list returns only the owner's cards in creation order — validates AC-11
- [ ] reads, updates and deletes scoped to another user find nothing and change nothing (sad path) — validates AC-10
- [ ] inserting the same period twice keeps one row — validates FR-03
- [ ] delete removes card, statements and both accounts; with a movement on a linked account it fails with `CardHasMovements` and keeps every row (sad path) — validates FR-08
- [ ] `isLinked` is true for both linked accounts and false for another credit card account
- [ ] `eraseUserCreditCards` deletes only that user's cards and statements, and the user can then be erased with `eraseUserMovements` and it registered (sad path: without the step the erasure fails on the restricting key)
- [ ] an invalid stored time zone reads as Buenos Aires; a missing user fails closed (error path)

**Completion criterion**
`pnpm exec vitest run test/credit-cards/credit-card-repository.test.ts test/credit-cards/erasure-step.test.ts`
passes against PostgreSQL (`TEST_DATABASE_URL`).

## Block 5 — Accounts guard for linked accounts

**Files**
- `apps/api/src/accounts/application/ports/account-links.ts` (new) — `AccountLinks.isLinked(accountId)`.
- `apps/api/src/accounts/infrastructure/links/no-links-adapter.ts` (new) — the default.
- `apps/api/src/accounts/domain/errors.ts` (modified) — `AccountLinkedToCard`.
- `apps/api/src/accounts/application/delete-account.ts` (modified) — checks links before movements.
- `apps/api/src/accounts/infrastructure/db/drizzle-account-repository.ts` (modified) — a 23503 on a
  `credit_cards_*` constraint maps to `AccountLinkedToCard`, any other to `AccountHasMovements`.
- `apps/api/src/accounts/infrastructure/http/account-routes.ts`, `apps/api/src/accounts/index.ts` (modified) — `links` option.
- `apps/api/test/accounts/account-use-cases.test.ts`, `apps/api/test/accounts/account-routes.test.ts` (modified).

**Logic**
`DeleteAccount` (D2, FR-02): scoped load, then `links.isLinked(id)` → `AccountLinkedToCard`, then the
existing movements check. Rename and archive are unchanged.

**API contract**
- Method + path: `DELETE /accounts/:id` (existing).
- Request: params `{ id: uuid }`; no body.
- Response: 204 with no body (unchanged).
- Error codes: new 409 `ACCOUNT_LINKED_TO_CARD`; existing 404 `NOT_FOUND`, 409
  `ACCOUNT_HAS_MOVEMENTS`, 401, 403 `EMAIL_NOT_VERIFIED`.
- Auth: `requireSession`, `requireVerifiedEmail`, owner scope (unchanged).

**Input validation**
- Unchanged: `id` is a UUID (`accountIdParamsSchema`).

**Error handling**
- Linked account → 409 `ACCOUNT_LINKED_TO_CARD`, row kept.
- Foreign-key race on a card constraint → the same 409.

**Required tests**
- [ ] deleting a linked account answers 409 `ACCOUNT_LINKED_TO_CARD` and keeps it (sad path) — validates FR-02
- [ ] a 23503 on `credit_cards_ars_account_owner_fk` maps to `AccountLinkedToCard` and one on a movements key still maps to `AccountHasMovements` (sad path)
- [ ] renaming and archiving a linked account still succeed — validates FR-02
- [ ] an unlinked account without movements is still deleted (regression)

**Completion criterion**
`pnpm exec vitest run test/accounts` passes with the new cases.

## Block 6 — Routes, composition and erasure registry

**Files**
- `apps/api/src/credit-cards/infrastructure/http/credit-card-routes.ts` (new).
- `apps/api/src/credit-cards/infrastructure/http/credit-card-presenter.ts` (new).
- `apps/api/src/credit-cards/index.ts` (new) — `createCreditCardRoutes`, `createCardAccountLinks`,
  `eraseUserCreditCards`.
- `apps/api/src/server.ts` (modified) — routes, `links: createCardAccountLinks(db)`,
  `beforeUserErased: [eraseUserMovements, eraseUserCreditCards]`.
- `apps/api/test/credit-cards/credit-card-routes.test.ts` (new).
- `apps/api/test/identity/user-erasure.test.ts` (modified) — registry entries for `credit_cards`
  (erase-step, constraints `credit_cards_ars_account_owner_fk`, `credit_cards_usd_account_owner_fk`)
  and `credit_card_statements` (cascade), and the step in the end-to-end erasure.
- `apps/api/test/movements/erasure-step.test.ts` (modified) — the composition-root assertion lists both steps.
- `apps/api/test/foundation/architecture-boundaries.test.ts` (modified) — `credit-cards` domain and
  application may not import infrastructure, drizzle or express.

**Logic**
Every route: `requireSession`, `requireVerifiedEmail`, owner scope from
`OwnerOrGroupMemberAccessPolicy`, the shared `validate` middleware with the Block 1 schemas for
params, body and response. Audit log lines carry the request id, user id and card or statement id,
never the name.

**API contract**
- `POST /credit-cards` — body `{ name: string, closingDay: int, dueDay: int }` → 201
  `CreditCardResponse`. Errors: 400 `VALIDATION_FAILED`, 409 `ACCOUNT_NAME_TAKEN`.
- `GET /credit-cards` — no query → 200 `{ items: CreditCardResponse[] }`, the user's cards only,
  oldest first.
- `GET /credit-cards/:id` — params `{ id: uuid }` → 200 `CreditCardResponse`. Errors: 400, 404.
- `PATCH /credit-cards/:id` — body `{ closingDay?: int, dueDay?: int }` (at least one) → 200
  `CreditCardResponse`. Errors: 400 `VALIDATION_FAILED` (including the D9 conflict), 404.
- `DELETE /credit-cards/:id` → 204. Errors: 404, 409 `CARD_HAS_MOVEMENTS`.
- `GET /credit-cards/:id/statements` → 200 `{ items: StatementResponse[] }`, newest first, missing
  cycles created first. Errors: 400, 404.
- `PATCH /credit-cards/:id/statements/:statementId` — body `{ closingDate?: 'YYYY-MM-DD', dueDate?:
  'YYYY-MM-DD' }` (at least one) → 200 `StatementResponse`. Errors: 400 `VALIDATION_FAILED`, 404 (a
  statement of another card or user), 409 `STATEMENT_CLOSED`.
- Statements have no delete route: they go with their card.
- Auth on every route: 401 `UNAUTHENTICATED` without a session, 403 `EMAIL_NOT_VERIFIED` before the
  email is verified; data of another user answers 404, never 403.

**Input validation**
- As in Block 1: name 1 to 46 characters, days integers 1 to 31, dates real `YYYY-MM-DD`, ids UUID,
  strict bodies; the JSON body limit stays 16 kB.

**Error handling**
- Domain errors map through the error middleware: `ResourceNotFound` 404, `StatementClosed` 409,
  `CardHasMovements` 409, `CardAccountNameTaken` 409, `StatementDatesInvalid` and
  `CardDaysConflict` 400 with fields.
- Unexpected errors are 500 `INTERNAL` with no detail in the body.

**Required tests**
- [ ] `POST` "Visa" 24/5 answers 201, `GET /credit-cards` lists it, `GET /accounts` shows "Visa ARS" and "Visa USD" as credit cards — validates AC-01, AC-03
- [ ] `POST` with closing day 0 or due day 32 answers 400 and stores nothing (invalid input) — validates AC-02
- [ ] `POST` when "Visa ARS" exists answers 409 `ACCOUNT_NAME_TAKEN` (sad path)
- [ ] `GET /credit-cards/:id/statements` for a card created on 2026-10-06 returns 2026-10 with 2026-10-24 and 2026-11-05, open — validates AC-04
- [ ] `PATCH` a statement's closing date to 2026-10-26 answers 200 and a re-read shows it — validates AC-06
- [ ] `PATCH` a closed statement answers 409 `STATEMENT_CLOSED` and changes nothing (sad path) — validates AC-07
- [ ] `PATCH /credit-cards/:id` closing day 20 answers 200 and the open statement now closes on day 20, the closed one unchanged — validates AC-08
- [ ] with the clock moved past 2026-10-24 in the user's zone the statement reads `closed` — validates AC-09
- [ ] Bob's `GET`, `PATCH`, `DELETE` of Ana's card and `GET`/`PATCH` of her statements answer 404 and change nothing (sad path) — validates AC-10
- [ ] Bob's list does not contain Ana's cards — validates AC-11
- [ ] `DELETE` a card without movements answers 204 and its accounts are gone; with a movement it answers 409 `CARD_HAS_MOVEMENTS` (sad path) — validates FR-08
- [ ] no session answers 401 and an unverified email 403 (sad path)
- [ ] the erasure registry guard passes with the two new tables and erasing a user with a card succeeds — validates FR-08
- [ ] an import of infrastructure from `credit-cards` domain is rejected by the boundary rule (sad path)

**Completion criterion**
`pnpm exec vitest run test/credit-cards test/identity/user-erasure.test.ts test/movements/erasure-step.test.ts test/foundation`
passes.

## Block 7 — Web API client

**Files**
- `apps/web/src/lib/api-client.ts` (modified) — `listCreditCards`, `createCreditCard`,
  `getCreditCard`, `updateCreditCardDays`, `deleteCreditCard`, `listStatements`, `updateStatement`.
- `apps/web/test/api-client-credit-cards.test.ts` (new).

**Logic**
Each method calls the Block 6 route through the existing `request` helper (refresh on 401, origin
header on writes) and parses the answer with the shared Zod validator of that answer; ids go through
`resourcePath`, so `.` and `..` never reach a path (FR-08).

**Input validation**
- Bodies are typed with the shared request input types; the containers validate with the
  same shared validators before calling.

**Error handling**
- A failure returns `{ ok: false, code, messageKey }`; an answer that fails its validator is
  `INTERNAL` (`unexpected`); a network failure is `NETWORK`.

**Required tests**
- [ ] each method sends the right method, path and body and parses the success answer — validates FR-01, FR-05, FR-06
- [ ] a 409 `STATEMENT_CLOSED`, `CARD_HAS_MOVEMENTS` and `ACCOUNT_NAME_TAKEN` map to their message keys (sad path)
- [ ] an id of `..` is refused without a request (invalid input) — validates FR-08
- [ ] a malformed success body maps to `unexpected` (error path)

**Completion criterion**
`pnpm exec vitest run test/api-client-credit-cards.test.ts` passes in `apps/web`.

## Block 8 — Web: card list and create form

**Files**
- `apps/web/src/features/credit-cards/containers/credit-cards-container.tsx` (new).
- `apps/web/src/features/credit-cards/containers/create-credit-card-container.tsx` (new).
- `apps/web/src/features/credit-cards/components/credit-card-list.tsx` (new).
- `apps/web/src/features/credit-cards/components/credit-card-form.tsx` (new).
- `apps/web/src/features/credit-cards/components/credit-cards-load-state.tsx` (new).
- `apps/web/src/app/[locale]/(app)/cards/page.tsx`, `apps/web/src/app/[locale]/(app)/cards/new/page.tsx` (new).
- `apps/web/src/features/shell/nav-items.ts` (modified) — secondary item `/cards` (`app.nav.cards`).
- `apps/web/messages/en.json`, `apps/web/messages/es.json` (modified) — `creditCards.*`, `app.nav.cards`.
- `apps/web/test/credit-cards-list.test.tsx` (new), `apps/web/test/shell-navigation.test.tsx` (modified).

**Logic**
Container/presentational split: containers fetch through the API client, presentational components
take props only. The list shows each card's name and its default closing and due days (AC-01, AC-11)
with links to the card page, an empty state and a link to the create form. The form validates with
`createCreditCardRequestSchema` and shows per-field messages; `ACCOUNT_NAME_TAKEN` is shown on the
name field. All copy comes from the catalogs in Spanish and English.

**Input validation**
- Name: 1 to 46 characters (shared schema); days: whole numbers 1 to 31 entered in numeric inputs and
  parsed with `Number.parseInt`, rejected by the shared schema otherwise.

**Error handling**
- Field errors next to the field and focus on the first invalid one; a network or unexpected failure
  as a form alert with the typed values kept; `UNAUTHENTICATED` redirects to sign-in.

**Required tests**
- [ ] the list renders the user's cards with their days in Spanish and English — validates AC-01, AC-11
- [ ] creating "Visa" 24/5 posts it and returns to the list — validates AC-01
- [ ] day 32 or an empty name shows the field message and sends nothing (invalid input) — validates AC-02
- [ ] a 409 `ACCOUNT_NAME_TAKEN` shows the name-field message (sad path)
- [ ] a load failure shows the error state with a retry (error path)
- [ ] the nav lists `/cards` with its label in both catalogs

**Completion criterion**
`pnpm exec vitest run test/credit-cards-list.test.tsx` passes in `apps/web` and both catalogs have the
same keys (the existing catalog parity test passes).

## Block 9 — Web: card page with statements

**Files**
- `apps/web/src/features/credit-cards/containers/credit-card-detail-container.tsx` (new).
- `apps/web/src/features/credit-cards/components/statement-list.tsx` (new).
- `apps/web/src/features/credit-cards/components/statement-dates-form.tsx` (new).
- `apps/web/src/features/credit-cards/components/card-days-form.tsx` (new).
- `apps/web/src/app/[locale]/(app)/cards/[id]/page.tsx` (new).
- `apps/web/messages/en.json`, `apps/web/messages/es.json` (modified).
- `apps/web/test/credit-card-detail.test.tsx` (new).

**Logic**
The page loads the card and its statements. Each statement shows its period, closing and due dates
formatted with the locale formatter, and an open or closed badge (FR-07). Open statements have an
edit action with two date inputs (FR-05); closed ones have none. A days form changes the default
closing and due days (FR-06) and reloads the statements. Delete asks for confirmation; on
`CARD_HAS_MOVEMENTS` it explains that the card's accounts have movements (D1); on success it returns
to the list.

**Input validation**
- Dates: native date inputs producing `YYYY-MM-DD`, checked with `updateStatementRequestSchema`;
  days as in Block 8.

**Error handling**
- `STATEMENT_CLOSED` (the statement closed while the form was open) shows the message and reloads.
- `VALIDATION_FAILED` on dates shows the field message; `CARD_HAS_MOVEMENTS` shows the blocked
  message; `NOT_FOUND` shows the not-found state; other failures show an alert.

**Required tests**
- [ ] the statements render with locale dates and open/closed badges — validates AC-04, AC-09
- [ ] editing an open statement's closing date sends the new date and shows it — validates AC-06
- [ ] a closed statement has no edit action, and a 409 `STATEMENT_CLOSED` shows the message (sad path) — validates AC-07
- [ ] changing the closing day to 20 sends it and reloads the statements — validates AC-08
- [ ] delete with confirmation returns to the list; a 409 `CARD_HAS_MOVEMENTS` shows the blocked message (sad path) — validates FR-08
- [ ] a 404 shows the not-found state (sad path) — validates AC-10

**Completion criterion**
`pnpm exec vitest run test/credit-card-detail.test.tsx` passes in `apps/web`.

## Block 10 — End to end: create a card, see its accounts and edit a statement

**Files**
- `apps/web/e2e/credit-cards.spec.ts` (new) — written in the folder and style of the existing Playwright flows.

**Logic**
A verified user creates "Visa" with days 24 and 5, sees it in the card list, finds "Visa ARS" and
"Visa USD" in the accounts list, opens the card, moves the open statement's closing date by two days
and sees it saved, and tries to delete "Visa ARS" from the accounts list and gets the linked-account
message (FR-01, FR-02, FR-05).

**Error handling**
- The flow asserts the linked-account refusal message on the accounts page (sad path).

**Required tests**
- [ ] the flow above passes in Chromium — validates AC-01, AC-03, AC-06
- [ ] deleting a linked account from the accounts page shows the refusal (sad path) — validates FR-02

**Completion criterion**
The spec lints and typechecks. Not run in this ticket: Playwright ports and the Mailpit inbox are
shared on the machine and the orchestrator runs the e2e suite one at a time; it is reported as
written, not run.

## Rollback
`apps/api/drizzle/rollback/0019_credit_cards.down.sql` drops `credit_card_statements` and
`credit_cards` and deletes the 0019 journal row; it is destructive for card and statement data only.
The linked accounts survive as plain credit card accounts and keep their movements. Apply it before
the rollback of any older migration, with the API stopped, then revert the ticket's commits.

## Final verification
- Every AC-01 to AC-11 has a passing test (Blocks 1 to 9), and NFR-01 is asserted by introspection.
- Full suite with coverage once: lines, branches and functions at or above 80%, and the files of this
  ticket at or above 80% each in sum.
- `pnpm exec eslint .`, `pnpm exec prettier --check --end-of-line auto .`, `pnpm typecheck` and
  `pnpm audit --prod --audit-level high` are clean.
- Migration 0019's journal `when` is greater than 1791162359112 and than `main`'s maximum.

# Spec DISC-001-10f: Statement Due-Date Reminders

| Field | Value |
|-------|-------|
| Ticket | DISC-001-10f |
| PRD | docs/ddw/prd/prd-DISC-001-10f.md |
| Tier | FEATURE |
| Date | 2026-10-10 |
| Spec loops | 0 |
| Loops since last human decision | 0 |

## Summary
A card gains one setting, `credit_cards.reminder_days` (smallint, 0 to 30, default 3), set on creation through the
existing `POST /credit-cards` and edited through the existing `PATCH /credit-cards/:id` (no new endpoint). A new worker
job of the `credit-cards` module (`StatementReminderJob`, the `setTimeout` chain of the 08c `ReminderJob`) runs every
`RECURRING_JOB_INTERVAL_SECONDS`. For every card of every existing user it works out, in the owner's time zone, which
statements have reached their reminder day (the due date minus `reminder_days`, from 09:00 local, through the due date
itself), skips the ones whose notice already exists, computes the unpaid amount of the rest with the same
`buildStatementViews` the screen uses, and publishes ONE in-app notice for each statement that still owes something in some
currency. The notice goes through the 08c notices pipeline: a new kind `card_statement_due` (migration `0031` extends
`notices_kind_check`), stored in the existing `notices` table with the statement id in `payment_id` (the column has no
foreign key), unique per (kind, statement id, due date) by the existing unique constraint, written with
`INSERT ... ON CONFLICT DO NOTHING`. Repeated or concurrent passes therefore create no duplicate, and a statement whose due
date moves gets its own notice for the new date. The text is rendered by `renderNoticeText` in Spanish or English from the
card name and the due date only (no amount, no account name). The credit-cards module reaches the notices store only through
a port (`StatementReminderPublisher`) that the notices module implements and the worker injects, so neither module imports
the other. The job and its cross-owner source are not exported from the module index. No new runtime dependency.

## Design decisions
These are not stated by the PRD; the owner ratifies them at approval.
- D1: The notices table is reused as it is: `payment_id` carries the statement id for the new kind. It has no foreign key
  (the notice outlives its subject on purpose, `0025_notices`), the unique constraint `notices_kind_payment_due_unique`
  already includes the kind, so a statement id can never collide with a recurring payment id, and no extra column,
  rename or second unique index is needed. A rename to `subject_id` was rejected: it would change the unique constraint and
  every reader while an older API instance is still running during a rolling deploy. The overload is documented on the
  column and on the adapter; the new port speaks of `statementId`, never `paymentId`.
- D2: New notice kind `card_statement_due`. Migration `0031` drops and re-adds `notices_kind_check` with the fourth value;
  `NOTICE_KINDS` in `packages/shared` gains it, because the web client parses notices with `noticeKindSchema` and an
  unknown kind would make the whole notices list fail to parse.
- D3: `credit_cards.reminder_days smallint not null default 3`, check 0 to 30. The default backfills every existing card
  with 3, so existing cards start receiving reminders when the worker is deployed; there is no opt-in step. The owner
  ratifies this (the alternative, a nullable column meaning "no reminders" until set, contradicts FR-01 "default 3").
- D4: The shared constants live in `credit-card.ts` (`CARD_REMINDER_DAYS_MIN`, `CARD_REMINDER_DAYS_MAX`,
  `CARD_REMINDER_DAYS_DEFAULT`, `cardReminderDaysSchema`), not imported from the recurring schemas: `recurring-payment.ts`
  already imports `calendarDateSchema` from `credit-card.ts`, so the reverse import would be circular. The create schema
  takes `reminderDays` optional (the server applies 3), the update schema accepts it alone.
- D5: A request that changes only `reminderDays` does not recompute the open statements. `UpdateCreditCardDays` today
  recomputes them from the default days and overwrites hand-edited dates (10a D5); a reminder-only change must not do
  that. The web form therefore sends only the fields the user changed.
- D6: Eligibility. With `local` the owner's local date and time, `reminderToday` is `local` date when the time is 09:00 or
  later and the day before otherwise. A statement is a candidate when `dueDate >= local date` (the due date itself is
  included, a passed one is not) and `dueDate - reminder_days <= reminderToday`. A worker down for days therefore creates
  the missed reminder in its first pass, and nothing after the due date. `reminder_days = 0` reminds at 09:00 of the due date.
- D7: Open statements are reminded too. A statement is not required to be closed: with 30 reminder days the reminder day
  often falls inside the open cycle, and a card with a short gap between closing and due date would otherwise miss AC-01.
  For an open statement no payments are allocated (10d), so it owes its whole total. Consequence: the total of an open
  statement can still change before it closes; a statement with total 0 at the reminder day gets its reminder at the first
  pass after a purchase raises the total, still no later than the due date.
- D8: The unpaid amount per currency is `total - paid` (paid is 0 for an open statement). A reminder is created when it is
  greater than 0 in at least one currency, so a statement with no total (0 and 0) and a statement whose payments cover
  every total get none (FR-03). The check is made at every pass until the notice exists, so a statement paid before its
  reminder day never gets one, and a payment after the notice does not retract it.
- D9: Idempotency is the unique key (kind, statement id, due date) plus `ON CONFLICT DO NOTHING`. Before computing
  statement views the job asks the publisher which candidates already have their notice (`published`), so a card inside
  its window costs one indexed read per pass instead of three queries. A moved due date is a different key and creates its
  own notice (AC-05); the notice already created for the old date stays, and moving the date back to a date that already
  has a notice creates nothing.
- D10: The text names the card and the due date and nothing else: Spanish `El resumen de <card> vence el <d MMM>`, English
  `The <card> statement is due on <MMM d>`, the date through the existing `Intl.DateTimeFormat` day formatter with
  `timeZone: 'UTC'` on the calendar date. No days-until count (the text must not depend on when the pass ran) and no
  amount. The card name is truncated to the existing 80 characters like every notice. `NoticeTextInput.paymentName` is
  renamed `subjectName` (the payment or card name), a mechanical rename of the three existing callers.
- D11: The cross-owner source is new (`DrizzleStatementReminderSource`): every card of an existing user, owner id,
  time zone and language from the same `users` join, keyset by card id in pages of 500. It is UNSCOPED BY DESIGN like the
  08b and 10e sources and is reachable only from the worker (not exported from `credit-cards/index.ts`).
- D12: Module boundary. `credit-cards` defines `StatementReminderPublisher` (a port); the notices module implements it
  (`createStatementReminderPublisher(db)`, exported from `notices/index.ts` next to `createNoticePublisher`) and
  `worker.ts` injects it. The notices adapter imports only the port's types from `credit-cards`, as the movements recorders do.
- D13: The job reuses `RECURRING_JOB_INTERVAL_SECONDS` (integer 1 to 300, default 60), so the pass interval is at most 300
  s and meets the 15-minute bound of NFR-01 with margin. The `setTimeout` chain is copied once more instead of extracted,
  to leave the 08b, 08c and 10e files untouched; a shared base class is a later refactor.
- D14: The job calls `ensureStatements` for each card (as 10e D10), because statements are materialized only when someone
  reads the card; without it a card nobody opened this month would never be reminded. It needs a write scope, built only
  from the source's `users` join. Cycles after the one open today are not materialized, so a due date more than one cycle
  ahead is reminded once its cycle exists.
- D15: A deleted card creates nothing (AC-09) because the source reads live cards and the statements cascade. Notices
  already created for it stay (no foreign key, the same as recurring notices); the user can mark them read, and erasing the
  user removes them through the owner key. Residual: a card deleted, or a due date moved, between the job's read and its
  insert yields at most one stale notice.
- D16: The job logs identifiers only (card id, statement id, error class name). Never the card name, a language, an amount
  or a time zone.
- D17: Deploy order: migrate, then API and web, then the worker. The worker is the only creator of the new kind, so an older
  web client never sees a kind it cannot parse as long as the web ships first.

## Coverage: PRD → blocks
| Requirement | Covered by |
|---|---|
| FR-01 | Block 1, Block 2, Block 5, Block 6, Block 7, Block 8, Block 11 |
| FR-02 | Block 1, Block 2, Block 3, Block 4, Block 9, Block 10, Block 11 |
| FR-03 | Block 5, Block 11 |
| FR-04 | Block 5, Block 7, Block 11 |
| NFR-01 | Strategy: one pass every `RECURRING_JOB_INTERVAL_SECONDS` (at most 300 s); a reminder is due from 09:00 local of its day and stays due until the due date, so a running worker creates it within 5 minutes of 09:00 and a restarted worker creates every missed one on its first pass; asserted with a fake clock at 08:59, 09:00, 09:10, after downtime and after the due date (Block 5, Block 7) |
| NFR-02 | Strategy: unique key (kind, statement id, due date) on `notices` with `INSERT ... ON CONFLICT DO NOTHING`, so any number of passes or workers, one after the other or at the same time, leave one row; asserted with sequential and concurrent passes on a real database (Block 6, Block 7) |

## Dependencies between blocks
Order: 1 (shared contract) and 2 (migration and schema, independent of 1) first; 3 needs 1 and 2 for types; 4 needs 1, 2 and
3; 5 needs 1 and 3 (the card's `reminderDays`); 6 needs 1, 2 and 5 (the port); 7 needs 3, 5 and 6; 8 needs 7; 9 needs 1; 10
needs 4 and 9; 11 needs every other block. Blocks 3 and 5 both touch `apps/api/test/credit-cards/fakes.ts`; Block 3 first.

## Block 1 — Shared contract
**Files**
- `packages/shared/src/credit-cards/credit-card.ts` (modified) — the reminder constants and schema, `reminderDays` on the create, update and response schemas.
- `packages/shared/src/notices/notice.ts` (modified) — `NOTICE_KINDS` gains `card_statement_due`.
- `packages/shared/test/credit-card-schemas.test.ts` (modified) — schema cases.
- `packages/shared/test/notice-contracts.test.ts` (modified) — the new kind.

**Logic**
`cardReminderDaysSchema` is `z.number().int().min(0).max(30)`; the constants are 0, 30 and 3. `createCreditCardRequestSchema` gains
`reminderDays: cardReminderDaysSchema.optional()` (absent means "the default", applied by the server). `updateCreditCardRequestSchema`
gains the same optional key and its "at least one" refinement now counts it, so `{ reminderDays: 7 }` alone is valid.
`creditCardResponseSchema` gains `reminderDays: cardReminderDaysSchema` (required). `NOTICE_KINDS` becomes
`['reminder', 'recorded', 'not_recorded', 'card_statement_due']`, so `noticeSchema` and `listNoticesResponseSchema` accept it.

**Data model**
Request `CreateCreditCardRequest`: new field `reminderDays?: number`, integer 0 to 30, optional, no other key. Request
`UpdateCreditCardRequest`: the same field, optional, at least one of the three fields required. Response
`CreditCardResponse`: `reminderDays: number`, required, not nullable. Enum `NoticeKind`: four values.

**Input validation**
- `reminderDays`: a whole number from 0 to 30; below 0, above 30, a fraction, a string, `null`, `NaN` and `Infinity` are rejected.
- An empty update body or an unknown key is rejected as before.

**Error handling**
- A schema failure is `VALIDATION_FAILED` (400) listing the failing paths only, never the typed values (reported by the shared validation middleware).
- A notice with an unknown kind fails the notices response validator, so a client never renders a kind it does not know.

**Required tests**
- [ ] a create request without `reminderDays`, with 0, with 30 and with 7 parses — validates AC-02
- [ ] a create or update request with -1, 31, 3.5, `"3"`, `null` and `NaN` is rejected as invalid input (sad path) — validates AC-03
- [ ] an update with only `reminderDays` parses, and an empty update is still rejected (sad path) — validates FR-02
- [ ] the issues of a rejected `reminderDays` carry only the failing path, not the typed value (sad path) — validates AC-03
- [ ] the card response parses with a `reminderDays` and rejects a response without it (sad path) — validates AC-02
- [ ] a notice of kind `card_statement_due` parses in the list response and an unknown kind is rejected (sad path) — validates FR-01

**Completion criterion**
`pnpm --filter @pesly/shared exec vitest run` passes and `pnpm typecheck` shows only the expected consumers of `CreditCardResponse` still to update.

## Block 2 — Migration 0031 and schema
**Files**
- `apps/api/drizzle/0031_card_statement_reminders.sql` (new) — adds the card column and its check, and extends the notice kind check.
- `apps/api/drizzle/rollback/0031_card_statement_reminders.down.sql` (new) — reverse script, runnable twice.
- `apps/api/drizzle/meta/0031_snapshot.json` (new) — snapshot chained from `0030_snapshot.json` (`prevId` `42087736-a106-420c-a529-29b0325d06f0`).
- `apps/api/drizzle/meta/_journal.json` (modified) — entry `idx 31`, tag `0031_card_statement_reminders`, `when` 1791750600000.
- `apps/api/src/credit-cards/infrastructure/db/schema.ts` (modified) — the `reminderDays` column and its check on `creditCards`.
- `apps/api/src/notices/infrastructure/db/schema.ts` (modified) — the kind type and check with the fourth value, a comment on `payment_id` (D1).
- `apps/api/test/credit-cards/schema-introspection.test.ts` and `apps/api/test/notices/schema-introspection.test.ts` (modified), `apps/api/test/credit-cards/statement-reminders-migration.test.ts` (new) — journal, defaults, rollback.

**Logic**
The migration is additive except for the constraint swap. `ALTER TABLE "credit_cards" ADD COLUMN "reminder_days" smallint DEFAULT 3 NOT NULL`
is a constant default, so PostgreSQL stores it without rewriting the table and every existing card reads 3 (D3). Then
`ADD CONSTRAINT "credit_cards_reminder_days_check" CHECK ("reminder_days" between 0 and 30)`. Then `notices_kind_check` is dropped and
re-added with `('reminder', 'recorded', 'not_recorded', 'card_statement_due')`; existing rows all satisfy it, so the swap only scans
the small `notices` table. The notices table gains no column and no index: the existing unique constraint and the owner indexes already
serve the new kind (D1). The journal `when` is greater than 1791750000000, the maximum on `main` (0030), and must still exceed
`main`'s maximum at merge time (drizzle-migration merge rule: re-check and bump before merging).
The rollback first deletes the notices of the new kind (the restored check would refuse them), then restores the old check,
then drops the card check and column, then forgets its row in `drizzle.__drizzle_migrations` (`created_at` = the `when`); applying it
loses every card's reminder setting and every statement reminder notice, so it is a manual plan step with a backup, stated in the
script header like 0025 and 0029. Order: run it BEFORE the rollback of 0030 (newest `when` first).

**Data model**
`credit_cards` (new column)
- `reminder_days smallint not null default 3`
- check `credit_cards_reminder_days_check`: `reminder_days between 0 and 30`

`notices` (changed constraint, no new column)
- check `notices_kind_check`: `kind in ('reminder', 'recorded', 'not_recorded', 'card_statement_due')`
- unchanged and relied on: unique `notices_kind_payment_due_unique` (`kind`, `payment_id`, `due_date`), `payment_id uuid not null` with no foreign key, check `notices_text_length_check` (1 to 300 characters)

**Input validation**
Not applicable: no input; the database refuses a reminder setting outside 0 to 30 and a notice kind outside the four values.

**Error handling**
- A card inserted or updated with `reminder_days` below 0 or above 30 raises a check violation (`credit_cards_reminder_days_check`).
- A notice with a kind outside the four values raises a check violation (`notices_kind_check`).
- A second notice with the same (kind, statement id, due date) is a unique violation, turned into "not created" by `ON CONFLICT DO NOTHING` (Block 6).

**Required tests**
- [ ] migration registry: journal entry idx 31 exists, its `when` is the greatest of the journal, and `0031_snapshot.json` chains on 0030's id — validates NFR-02
- [ ] after the migration, existing cards read `reminder_days` 3 and a new card without the field reads 3 — validates AC-01
- [ ] a card with `reminder_days` -1 or 31 violates `credit_cards_reminder_days_check`, and 0 and 30 are accepted (sad path) — validates AC-03
- [ ] a notice of kind `card_statement_due` is accepted and a notice of kind `other` violates `notices_kind_check` (sad path) — validates FR-01
- [ ] two notices with the same kind, statement id and due date are a duplicate that raises the unique violation, and another due date for the same statement succeeds — validates AC-05
- [ ] the notices of the existing kinds are untouched by the migration, and the rollback deletes only the notices of the new kind — validates FR-01
- [ ] the rollback runs twice, restores the 0030 schema (no `reminder_days`, the old kind check) and the migration re-applies — validates NFR-02
- [ ] introspection: the new column, its check and the four-value kind check exist as declared — validates FR-02

**Completion criterion**
`pnpm --filter ./apps/api test` passes the migration and introspection tests against a fresh database, and `when` of 0031 is above 1791750000000 and above `main`'s maximum at merge time.

## Block 3 — Card reminder days: domain and use cases
**Files**
- `apps/api/src/credit-cards/domain/credit-card.ts` (modified) — `CreditCard.reminderDays`.
- `apps/api/src/credit-cards/application/ports/credit-card-repository.ts` (modified) — `CreateCreditCardData.reminderDays`, `updateDays` takes the three settings.
- `apps/api/src/credit-cards/application/create-credit-card.ts` and `apps/api/src/credit-cards/application/update-credit-card-days.ts` (modified) — the new field.
- `apps/api/test/credit-cards/fakes.ts` (modified) — the in-memory repository and card fixtures with the new field.
- `apps/api/test/credit-cards/use-cases.test.ts` (modified) — use case tests.

**Logic**
`CreditCard` gains `reminderDays: number`. `CreateCreditCard.execute` passes `data.reminderDays ?? CARD_REMINDER_DAYS_DEFAULT`
to the repository. `UpdateCreditCardDays.execute(scope, id, change)` resolves `closingDay`, `dueDay` and `reminderDays` from the change
and the stored card. When the change names neither day, it does not read the statements and passes an empty list (D5), so the open
statements, hand edits included, are untouched; when it names a day, the recomputation is exactly the current one. The repository
`updateDays(scope, id, settings, statements)` saves the three settings and the statements atomically and answers `null` when the
card is missing or not the caller's (`ResourceNotFound`).

**Data model**
Domain entity `CreditCard`: `reminderDays: number`, always present, 0 to 30 (the database check backs it); the repository port keeps its
owner-scoped contract, no new unique or key.

**Input validation**
Values arrive already validated by the Block 1 schemas; the use case trusts the integer range and re-checks only ownership through the scoped read.

**Error handling**
- Missing or foreign card: `ResourceNotFound`, nothing written, nothing else read.
- A day change that makes the open statements overlap: `CardDaysConflict` as today, and the reminder setting of the same request is not saved either.

**Required tests**
- [ ] creating a card without `reminderDays` stores 3, and with 7 stores 7 — validates AC-02
- [ ] updating only `reminderDays` saves it and leaves hand-edited open statement dates unchanged — validates FR-02
- [ ] updating a day and `reminderDays` together saves both and recomputes the open statements as before — validates FR-02
- [ ] another user's card is `ResourceNotFound` on update and nothing is saved (sad path) — validates FR-02
- [ ] a day change that conflicts with a closed statement raises `CardDaysConflict` and the reminder setting is not saved (sad path) — validates FR-02
- [ ] a missing card id is `ResourceNotFound` and no statement is read (sad path) — validates FR-02

**Completion criterion**
`pnpm exec vitest run test/credit-cards/use-cases.test.ts` passes with fakes and no database, and domain and application files import no infrastructure.

## Block 4 — Card reminder days: repository, presenter and routes
**Files**
- `apps/api/src/credit-cards/infrastructure/db/drizzle-credit-card-repository.ts` (modified) — maps the column, writes it on create and on `updateDays`.
- `apps/api/src/credit-cards/infrastructure/http/credit-card-presenter.ts` (modified) — emits `reminderDays`.
- `apps/api/src/credit-cards/infrastructure/http/credit-card-routes.ts` (unchanged unless the audit line needs the field) — the routes already pass the validated body to the use cases.
- `apps/api/test/credit-cards/credit-card-repository.test.ts` and `apps/api/test/credit-cards/credit-card-routes.test.ts` (modified) — database and route cases.

**Logic**
`cardColumns` and `CardRow` read `reminder_days`; `create` inserts it; `updateDays` sets it in the same transaction as the statements.
`presentCreditCard` adds `reminderDays`, so `GET /credit-cards`, `GET /credit-cards/:id`, `POST /credit-cards` and
`PATCH /credit-cards/:id` all show it. The audit lines stay `credit card created` and `credit card days changed` with the request id,
user id and card id only. A scoped miss is 404, never 403.

**Data model**
Response entity `CreditCardResponse`: `reminderDays` integer 0 to 30, required, not nullable. Stored column `credit_cards.reminder_days`
(Block 2): `smallint not null default 3`, check 0 to 30, no new index, key or unique constraint; the row mapper keeps it a plain `number`.

**API contract**
- Method + path: `POST /credit-cards` and `PATCH /credit-cards/:id` (existing; no new endpoint).
- Request: `POST` body `{ name, closingDay, dueDay, reminderDays?: integer 0..30 }`; `PATCH` params `{ id: uuid }` and body with at least one of `closingDay`, `dueDay`, `reminderDays`; unknown keys refused.
- Response: 201 and 200 with the card `{ id, name, closingDay, dueDay, arsAccountId, usdAccountId, debitArsAccountId, debitUsdAccountId, reminderDays, createdAt }`; `GET /credit-cards` and `GET /credit-cards/:id` carry the same shape.
- Error codes: 400 `VALIDATION_FAILED` (a `reminderDays` outside 0 to 30, a fraction or a non-number, and the existing day rules); 401 `UNAUTHENTICATED`; 403 `EMAIL_NOT_VERIFIED`; 404 `NOT_FOUND`; 409 `ACCOUNT_NAME_TAKEN` on create as today.
- Auth: `requireSession`, `requireVerifiedEmail`, owner write scope; data of another user answers 404, never 403.

**Input validation**
- Body and params go through the Block 1 schemas and the shared validation middleware; the JSON body limit stays 16 kB; the routes read no unvalidated `req.body`.

**Error handling**
- Invalid body (`reminderDays` out of range or not whole): `VALIDATION_FAILED` (400), nothing stored.
- Foreign or missing card on `PATCH`: `NOT_FOUND` (404), nothing stored.
- No session: 401; unverified email: 403; unexpected errors: 500 `INTERNAL` without detail.

**Required tests**
- [ ] `POST /credit-cards` with `reminderDays` 7 answers 201 with 7, and without the field answers 201 with 3 — validates AC-02
- [ ] `PATCH` with `{ reminderDays: 7 }` answers 200 with 7 and `GET /credit-cards/:id` shows it — validates AC-02
- [ ] `PATCH` with only `reminderDays` leaves the days and a hand-edited open statement untouched — validates FR-02
- [ ] `POST` and `PATCH` with `-1`, `31`, `2.5`, `"3"` answer 400 `VALIDATION_FAILED` and store nothing (sad path) — validates AC-03
- [ ] Bob's `PATCH` on Ana's card answers 404 `NOT_FOUND` and Ana's setting is unchanged (sad path) — validates FR-02
- [ ] no session answers 401 and an unverified email 403 (sad path) — validates FR-02
- [ ] the audit line of a successful `PATCH` carries the request id, user id and card id and no card name (sad path, log content) — validates FR-02

**Completion criterion**
`pnpm exec vitest run test/credit-cards/credit-card-repository.test.ts test/credit-cards/credit-card-routes.test.ts` passes against PostgreSQL (`TEST_DATABASE_URL`).

## Block 5 — Reminder domain, ports and use case
**Files**
- `apps/api/src/credit-cards/domain/statement-reminder.ts` (new) — `STATEMENT_REMINDER_TIME`, `reminderCandidates`, `owesStatement`.
- `apps/api/src/credit-cards/application/ports/statement-reminder-source.ts` (new) — cross-owner paged read of cards with owner, zone and language.
- `apps/api/src/credit-cards/application/ports/statement-reminder-publisher.ts` (new) — `published` and `publishMany`.
- `apps/api/src/credit-cards/application/create-statement-reminders.ts` (new) — the use case.
- `apps/api/test/credit-cards/fakes.ts` (modified) — `FakeStatementReminderSource`, `FakeStatementReminderPublisher`.
- `apps/api/test/credit-cards/statement-reminders.test.ts` (new) — domain and use case tests with a fake clock.

**Logic**
Domain (pure, `bigint` only):
- `reminderCandidates({ statements, reminderDays, today, reminderToday })`: the statements with `dueDate >= today` and `addDays(dueDate, -reminderDays) <= reminderToday`, oldest first (D6).
- `owesStatement(view)`: true when `total - paid > 0n` in at least one currency, with `paid` taken from `view.payments` and `0n` when `view.payments` is `null` (D7, D8).

`CreateStatementReminders.execute()` pages the source (keyset by card id, 500 per page). For each entry:
1. `local = instantToZonedLocal(clock.now(), timeZone)`; `today` is its date; `reminderToday` is `today` when the time is `>= 09:00` and `addDays(today, -1)` otherwise. An unknown zone falls back inside the shared helpers.
2. `scope` from the injected `scopeFor(ownerId)`; statements from `ensureStatements(cards, scope, card, today)` (D14); candidates from the domain function. No candidate: next card, no further query.
3. `publisher.published(ownerId, candidates)` returns the keys that already have their notice; those are dropped. None left: next card.
4. `buildStatementViews(deps, scope, card, statements, timeZone, today)`; the candidates whose view `owesStatement` become `{ ownerId, statementId, cardName, dueDate, language }` inputs; the rest are counted as `notOwed` (FR-03).
5. `publisher.publishMany(inputs)` returns how many rows were created; duplicates that won a race are not counted.
6. Counters (`cards`, `reminders`, `notOwed`, `alreadyPublished`, `failed`); a failure of one card is reported through `report` with card id and the error class name only and never stops the other cards; what failed is retried by the next pass.

**Input validation**
No external input: ids, zones, languages and amounts come from the database through the ports; the domain functions trust no value they do not compute.

**Error handling**
- A failure while handling one card (statements, views, publish) is reported with ids and the class name, counted in `failed`, and the pass continues with the next card.
- A storage failure of a whole page propagates to the job loop, which logs it and runs the next pass.

**Required tests**
- [ ] a statement due 2026-11-05 on a card with 3 reminder days creates its reminder at 2026-11-02 09:00 local and not on 2026-11-01 — validates AC-01
- [ ] at 08:59 local of the reminder day nothing is created, at 09:00 it is, and a pass at 09:10 has created it — validates NFR-01
- [ ] with the zone `Asia/Tokyo` and with `America/Argentina/Buenos_Aires` the 09:00 comes from the owner's zone, not the process zone — validates NFR-01
- [ ] a first pass days after the reminder day and before the due date creates the reminder once — validates AC-07
- [ ] a first pass on the due date at 09:00 creates it, and a first pass the day after the due date creates none — validates AC-07
- [ ] `reminderDays` 0 creates the reminder at 09:00 of the due date, and 30 creates it 30 days before — validates FR-01
- [ ] a closed statement whose payments cover the total in ARS and USD creates no reminder — validates AC-04
- [ ] a statement with a total of 0 in both currencies creates none, and one paid in ARS but owing USD creates one — validates FR-03
- [ ] an open statement with a total creates its reminder and an open statement with no total creates none — validates FR-01
- [ ] two sequential passes over the same statement create 1 reminder and the second reports `alreadyPublished` — validates AC-06
- [ ] a due date moved from 2026-11-05 to 2026-11-10 with 3 reminder days creates its reminder on 2026-11-07 and none for 2026-11-02 if it had not been created — validates AC-05
- [ ] a due date moved after the first reminder was created creates a second reminder for the new date and keeps the first — validates AC-05
- [ ] a deleted card (no longer in the source) creates no reminder — validates AC-09
- [ ] an error while handling one card is reported with ids and the class name only and the next card is still processed (sad path) — validates NFR-02
- [ ] the reported failures contain no card name, amount or language (sad path, log content) — validates AC-08

**Completion criterion**
`pnpm exec vitest run test/credit-cards/statement-reminders.test.ts` passes with fakes and no database, and domain and application files import no infrastructure and no other module.

## Block 6 — Notice text and publisher adapter (notices module)
**Files**
- `apps/api/src/notices/domain/notice-text.ts` (modified) — `card_statement_due` text; `paymentName` renamed `subjectName`.
- `apps/api/src/notices/domain/notice.ts` (modified) — `NewNotice` documents that `paymentId` is the subject id (D1).
- `apps/api/src/notices/infrastructure/db/drizzle-statement-reminder-publisher.ts` (new) — implements the credit-cards port over `notices`.
- `apps/api/src/notices/index.ts` (modified) — exports `createStatementReminderPublisher`.
- `apps/api/test/notices/notice-text.test.ts`, `apps/api/test/notices/no-sensitive-text.test.ts` (modified), `apps/api/test/notices/statement-reminder-publisher.test.ts` (new).

**Logic**
`renderNoticeText` handles `card_statement_due` with the card name as `subjectName` and `dueDate` formatted as a day: Spanish
`El resumen de ${name} vence el ${day}`, English `The ${name} statement is due on ${day}` (D10). It takes no amount and no account
name, so none can reach the stored text. The publisher maps `{ ownerId, statementId, cardName, dueDate, language }` to a `NewNotice`
(`kind: 'card_statement_due'`, `paymentId: statementId`), renders the text and inserts with
`onConflictDoNothing({ target: [kind, paymentId, dueDate] })`; `publishMany` is one multi-row insert and returns the rows created;
`published(ownerId, refs)` selects the (statement id, due date) pairs that already have a row of this kind for that owner, in one indexed
statement filtered by owner. The port types come from `credit-cards`; the notices module imports nothing else from it.

**Data model**
Writes `notices` (Block 2): `kind` `card_statement_due`, `payment_id` the statement id (no foreign key), `due_date` the statement's due date, `text` 1 to 300 characters, `owner_id` from the source's `users` join (foreign key to `users`, cascade). Reads the same table filtered by owner.

**Input validation**
Not applicable to a user: the inputs come from the job; the renderer truncates the card name to 80 characters and the database check bounds the text to 300.

**Error handling**
- A duplicate (kind, statement id, due date) is a normal outcome (`false` or fewer rows), never an error.
- Any other storage error propagates to the use case, which reports it with ids and the class name.

**Required tests**
- [ ] the Spanish and English texts name the card and the due date, for example `The Visa statement is due on Nov 5` and `El resumen de Visa vence el 5 nov` — validates AC-08
- [ ] a card name longer than 80 characters is truncated and the stored text stays within 300 characters — validates AC-08
- [ ] no stored text contains an amount in any of its written forms or an account name, for both languages (sad path, forbidden tokens) — validates AC-08
- [ ] publishing the same statement and due date twice stores 1 notice and the second call answers `false` — validates AC-06
- [ ] two `publishMany` calls started at the same time for the same statement and due date leave exactly 1 row — validates AC-06
- [ ] the same statement with another due date stores a second notice, and `published` reports each pair that exists — validates AC-05
- [ ] `published` omits another owner's notices and notices of other kinds with the same ids (sad path, cross-user) — validates NFR-02
- [ ] a notice of another owner's card is stored for the owner given and never readable through the first owner's notices list (sad path, cross-user) — validates AC-08
- [ ] the existing recurring texts and the renamed field render exactly as before — validates FR-01

**Completion criterion**
`pnpm exec vitest run test/notices` passes against PostgreSQL, and the notices module imports only types from `credit-cards` (the architecture-boundaries test passes).

## Block 7 — Source adapter, job and factory
**Files**
- `apps/api/src/credit-cards/infrastructure/db/drizzle-statement-reminder-source.ts` (new) — cross-owner paged read.
- `apps/api/src/credit-cards/infrastructure/jobs/statement-reminder-job.ts` (new) — `StatementReminderJob` and `StatementReminderLog`.
- `apps/api/src/credit-cards/jobs.ts` (modified) — `createStatementReminderJob(deps)`; still not re-exported from `./index`.
- `apps/api/test/credit-cards/statement-reminder-source.test.ts` (new), `apps/api/test/credit-cards/statement-reminder-job.test.ts` (new) — database and loop cases.

**Logic**
`DrizzleStatementReminderSource.page(afterId, limit)` selects from `credit_cards` inner-joined to `users` (owner id, time zone and
language come from the same row, so an erased user has no entry), ordered by card id with a keyset predicate; it returns identifiers,
the card fields (`reminderDays` and the debit links included, so the domain card is complete) and the zone and language only. It is
UNSCOPED BY DESIGN like the 08b and 10e sources and is reachable only from the worker.
`StatementReminderJob` is the `setTimeout` chain of `ReminderJob`: one pass, wait `intervalMs`, repeat; passes never overlap; an error
from a pass is logged and the next one still runs; `stop()` waits for the pass in progress and is idempotent; an idle pass logs at
debug level, a pass that created or failed logs its summary (counters only) at info level. The log sink de-duplicates repeated
failures by `cardId|errorName` (bounded set, cleared when full; it only suppresses log lines, never decides what is created) and
writes card id and error class name only (D16).
`createStatementReminderJob({ db, logger, publisher, cardPayments, purchases, clock?, intervalSeconds })` builds the use case over the Drizzle
repositories with the injected publisher and movements adapters, so `credit-cards` imports neither `notices` nor `movements`. The write
scope is issued by `OwnerOrGroupMemberAccessPolicy.scopeFor({ userId: ownerId, sessionId: 'statement-reminder-job', emailVerified: true }, 'write')`
where `ownerId` comes only from the source's `users` join.

**Input validation**
Not applicable: the factory takes values from the composition root; `intervalSeconds` was validated by the worker environment schema (integer 1 to 300).

**Error handling**
- A pass that throws (storage down) is logged and the next pass still runs after the interval.
- `stop()` called twice or before `start()` is harmless; `start()` twice does not start a second chain.
- A failure of one card is reported by the use case and does not reach the loop.

**Required tests**
- [ ] the source returns every card of an existing user with the owner id, zone and language of its user, and pages by card id without gaps or repeats — validates FR-01
- [ ] the source returns no entry for a deleted card and none for an erased user (sad path, no data) — validates AC-09
- [ ] at 09:10 local of the reminder day with a real database, one pass creates the notice with the card name and the due date and no amount — validates AC-01
- [ ] at 08:59 local no notice exists and at 09:00 it does, in two owner time zones — validates NFR-01
- [ ] a job started after the reminder day and before the due date creates the notice in its first pass, and one started after the due date creates none — validates AC-07
- [ ] with passes every 60 s the notice exists between 09:00 and 09:15 local — validates NFR-01
- [ ] three passes over the same statement leave 1 notice, and two passes running at the same time leave exactly 1 — validates AC-06
- [ ] a statement paid by hand between two passes before its reminder day creates no notice, and a statement with no total creates none — validates AC-04
- [ ] moving the due date of a statement after its first notice creates a second notice for the new date and keeps the first — validates AC-05
- [ ] deleting the card removes its statements and the next pass creates nothing for it — validates AC-09
- [ ] with cards of two owners, one pass creates each notice only for its own owner and in its own language (cross-user) — validates AC-08
- [ ] a pass that throws is logged and the next pass still runs, and `stop()` waits for the pass in progress and is idempotent (sad path error) — validates NFR-02
- [ ] repeated failures of one card produce one log line, and the logged fields contain no card name, amount or language (sad path) — validates AC-08
- [ ] the credit-cards module index does not export the job or the source (guard against reaching the cross-owner read from the API) — validates NFR-02

**Completion criterion**
`pnpm exec vitest run test/credit-cards/statement-reminder-source.test.ts test/credit-cards/statement-reminder-job.test.ts` passes against PostgreSQL with a fake clock, and the job file is absent from `apps/api/src/credit-cards/index.ts`.

## Block 8 — Worker wiring
**Files**
- `apps/api/src/worker.ts` (modified) — builds, starts and stops the statement reminder job beside the others.
- `apps/api/src/shared/config/env.ts` (modified, comment only) — the interval variable also paces the statement reminder job.
- `eslint.config.mjs` (modified) — `NOTICES_IMPORTS` restriction for the credit-cards domain and application.
- `apps/api/test/credit-cards/statement-reminder-worker.test.ts` (new) — start and stop of the factory output and the source guards.
- `apps/api/test/foundation/architecture-boundaries.test.ts` (modified) — a case for the notices adapter importing credit-cards types.

**Logic**
`worker.ts` imports `createStatementReminderJob` from `./credit-cards/jobs`, `createStatementReminderPublisher` from `./notices`, and reuses the
`createCardPayments` and `createCardPurchases` adapters already built for the debit job. It starts the job after `automaticDebitJob.start()`,
logs `statement reminder job started` with the interval, and adds `statementReminderJob.stop()` to the shutdown `Promise.all`, before
`pool.end()`. The log line `email worker started` that the e2e harness waits for is unchanged.

**Input validation**
`RECURRING_JOB_INTERVAL_SECONDS` stays validated by `parseWorkerEnv`: a string of digits, integer 1 to 300, default 60; this block adds no variable.

**Error handling**
- An invalid interval (`0`, `301`, `abc`, `1.5`) makes `parseWorkerEnv` throw at startup, before any job starts.
- A job that throws a pass error is logged by the job; the other jobs keep running.

**Required tests**
- [ ] the factory output starts, runs a pass, and `stop()` twice resolves without error — validates NFR-01
- [ ] a pass error of the statement reminder job is logged and the recurring and automatic debit jobs keep running (sad path) — validates NFR-01
- [ ] on shutdown the job is stopped and awaited before the pool closes, even with a pass in progress (sad path error) — validates NFR-01
- [ ] `parseWorkerEnv` still accepts 1, 60 and 300 and rejects 0, 301, `abc` and `1.5` as invalid (sad path error) — validates NFR-01
- [ ] the worker source imports the job from `credit-cards/jobs` and the publisher from `notices`, and stops the job in the shutdown list (source guard) — validates FR-01
- [ ] the API entry `server.ts` does not import `credit-cards/jobs` (guard against exposing the job to the API process) — validates NFR-02
- [ ] a probe file in `credit-cards/domain` or `application` that imports `notices` is rejected by the boundary rule (sad path) — validates NFR-02

**Completion criterion**
The worker tests pass and `pnpm --filter @pesly/api worker` starts with the new job logging its start line.

## Block 9 — Web client, request builder and catalogs
**Files**
- `apps/web/src/lib/api-client.ts` (unchanged unless a type needs the new field) — `createCreditCard` and `updateCreditCardDays` already carry the shared request types.
- `apps/web/src/features/credit-cards/card-reminder-request.ts` (new) — `parseReminderDays` and `buildCardUpdate`.
- `apps/web/src/features/credit-cards/credit-card-form-errors.ts` (modified) — the `reminderDays` field name and message.
- `apps/web/messages/en.json`, `apps/web/messages/es.json` (modified) — `creditCards.form.reminderDays*`, `creditCards.detail.reminderDays*`, `creditCards.errors.reminderDaysInvalid`, and the notices `description` and `empty` wording.
- `apps/web/test/card-reminder-request.test.ts` (new), `apps/web/test/api-client-credit-cards.test.ts` (modified).

**Logic**
`parseReminderDays(text)` returns a whole number from 0 to 30 or `null` (an empty text is the default 3 on the create form and a
validation error on the edit form). `buildCardUpdate(card, values)` returns only the fields whose value differs from the saved card
(`closingDay`, `dueDay`, `reminderDays`) and `null` when nothing changed, so a reminder-only change never sends the days (D5). The create and update
calls keep their client methods; the existing request validators parse the new response field. The catalogs gain the field labels, a hint
("We remind you this many days before the due date, at 09:00"), the error message, and the notices description and empty text now mention card statements as well as recurring payments, in both languages with the same keys.

**Input validation**
- The typed value is `''` or digits only; anything else, a number below 0 or above 30, and a fraction are dropped to a field error before any request, and the server validates again.

**Error handling**
- A failure returns `{ ok: false, code, messageKey }`; a success body that fails its validator is `unexpected`; a network failure is `NETWORK`.
- A card id such as `..` is refused by `resourcePath` without a request.

**Required tests**
- [ ] `parseReminderDays` accepts `0`, `3` and `30` and returns `null` for `-1`, `31`, `2.5`, `abc` and an empty edit value (sad path, invalid input) — validates AC-03
- [ ] `buildCardUpdate` with only the reminder days changed returns `{ reminderDays: 7 }` without the days, and with nothing changed returns `null` — validates FR-02
- [ ] the client sends `reminderDays` on create and on update and parses the card answer that carries it — validates AC-02
- [ ] a success body without `reminderDays` maps to `unexpected` (error path) — validates AC-02
- [ ] a card id of `..` is refused without a request (invalid input) — validates FR-02
- [ ] both catalogs contain the new keys with the same shape, and a missing key fails the catalog test (sad path) — validates AC-08

**Completion criterion**
`pnpm exec vitest run test/card-reminder-request.test.ts test/api-client-credit-cards.test.ts test/i18n-catalogs.test.ts` passes in `apps/web`.

## Block 10 — Web card screens
**Files**
- `apps/web/src/features/credit-cards/components/credit-card-form.tsx` (modified) — a presentational reminder days field, default `3`.
- `apps/web/src/features/credit-cards/components/card-days-form.tsx` (modified) — the field beside the two days, prefilled with the saved value.
- `apps/web/src/features/credit-cards/containers/create-credit-card-container.tsx` and `apps/web/src/features/credit-cards/containers/credit-card-detail-container.tsx` (modified) — validate, send and update the card state.
- `apps/web/test/credit-card-form.test.tsx` (new or modified), `apps/web/test/credit-card-detail.test.tsx` (modified).

**Logic**
The create form shows "Reminder days" starting at 3 with the hint; the container sends it with the card. The detail page shows the same field
in the days section prefilled with the saved value, so the setting is visible on the card (AC-02); saving builds the update with
`buildCardUpdate` and sends only the changed fields, then replaces the card in state with the answer. The days hint ("Changing a day also
moves the dates of the open statements") applies to the two days only, so a reminder-only save shows no statement warning. Presentational
components fetch nothing; all copy comes from the catalogs in Spanish and English; the edit is online only like the other card writes.

**Input validation**
- The field is a numeric input from 0 to 30; the container validates with `parseReminderDays` and shows the field error without a request; the server validates again.

**Error handling**
- `NOT_FOUND` shows the not-found state; `VALIDATION_FAILED` on a reminder-only save shows the reminder error next to the field, never the days conflict message.
- `NETWORK` keeps the typed values and shows the connection-needed message; `UNAUTHENTICATED` redirects to sign-in.

**Required tests**
- [ ] the create form starts the reminder days at 3, and typing 7 sends `reminderDays` 7 with the card — validates AC-02
- [ ] the detail page shows the saved reminder days, and saving 7 sends only `reminderDays` and shows 7 afterwards — validates AC-02
- [ ] typing -1, 31 or 2.5 shows the field error and sends no request (sad path, invalid input) — validates AC-03
- [ ] a 400 on a reminder-only save shows the reminder error and not the days conflict message (sad path) — validates AC-03
- [ ] a 404 shows the not-found state and a network failure keeps the typed values (sad path) — validates FR-02
- [ ] the field renders in Spanish and English, both catalogs have the same keys, and the field has a label and a visible error text, never conveyed by color alone — validates FR-02

**Completion criterion**
`pnpm exec vitest run test/credit-card-form.test.tsx test/credit-card-detail.test.tsx test/i18n-catalogs.test.ts` passes in `apps/web`, and `pnpm lint` and `pnpm typecheck` pass.

## Block 11 — End to end and guards
**Files**
- `apps/web/e2e/credit-cards-reminders.spec.ts` (new) — the Playwright flows, with `test.use({ locale: 'es-AR', timezoneId: 'America/Argentina/Buenos_Aires' })`.
- `apps/web/e2e/support/database.ts` (modified) — `makeFirstStatementDueSoon(email, cardName)` and `cardStatementNotices(email)`.
- `apps/api/test/credit-cards/no-float-money.test.ts` (modified) — the new files join the guard, with `no-sensitive-logs` cases.
- `apps/api/test/notices/no-sensitive-text.test.ts` (modified) — the new kind joins the forbidden-token cases.

**Logic**
Flow 1: a verified user creates a card from the form with 7 reminder days, records an ARS expense of 60,000.00 ARS on it, and sees 7 on the
card page. The helper `makeFirstStatementDueSoon` sets the first statement's closing date to `current_date` (it stays open, so the expense
belongs to it) and its due date to `current_date + 1`, so the reminder day (6 days ago) and the 09:00 rule hold at any hour of the e2e run and
the due date is never before the owner's today. Within a few passes of the worker (5 s interval) the notices page shows the statement
reminder naming the card and no amount, and the unread badge counts it. Flow 2: a second card with no expense and the same dates is created
first; the test waits for the first card's reminder and then asserts that the second card has no notice (the passes handle both cards in the
same pass), and that after two more passes the first card still has exactly one notice. Flow 3: setting 31 reminder days on the card page
shows the field error and keeps the saved value. The worker interval is already 5 s in `playwright.config.ts`; the recurring, notices and debit
specs are rerun to confirm they are unaffected. The guard test scans the new source files for `Number(`, `parseFloat`, `toFixed` and
`Math.round` and plants a forbidden token to prove the guard reports it.

**Input validation**
Not applicable: the flows type the card fields, the reminder days and the expense amount through the existing, already validated forms.

**Error handling**
- The poll for the notice times out with a clear message naming the card when the worker never ran a pass; the test fails instead of hanging.
- The guard test fails naming the file and the forbidden token.

**Required tests**
- [ ] the flow creates a card with 7 reminder days, makes its statement due soon, and after a worker pass the notices page shows one unread reminder with the card name and no amount — validates AC-01, AC-02, AC-08
- [ ] the flow with a card that has no total records no notice while the other card's notice appears, and a later pass leaves exactly one notice — validates FR-03, AC-06
- [ ] the flow with a statement fully paid before its reminder day creates no notice (sad path, no data) — validates AC-04
- [ ] a reminder-days value of 31 on the card page shows the field error and keeps the saved value (sad path invalid input) — validates AC-03
- [ ] deleting a card with a due statement before the next pass leaves no new notice for it (smoke check: a deletable card never owes a total, so AC-09 is proven by the job integration test `a deleted card creates nothing`, and this flow only shows that the notices of other cards are kept) — validates AC-09
- [ ] the new files contain no `Number(`, `parseFloat`, `toFixed` or `Math.round`, and the guard reports an error for a planted forbidden token — validates NFR-02

**Completion criterion**
The e2e spec lints and typechecks; the orchestrator runs it one at a time with the recurring, notices and debit specs, and `pnpm test` passes the guards.

## Rollback
The migration is additive except for the notice kind check swap. The reverse script `0031_card_statement_reminders.down.sql` deletes the
notices of kind `card_statement_due`, restores the three-value `notices_kind_check`, drops `credit_cards_reminder_days_check` and the
`reminder_days` column, and forgets the journal entry, so every card's reminder setting and every statement reminder notice is lost (take a
backup, stop the API and the worker, run it as a whole, then revert the commits; run it before the rollback of 0030). Notices of the three
older kinds are untouched. Reverting the code without the script is NOT fully safe: an older worker never creates the new kind, but the rows
that exist would make an older web client fail to parse the notices list, so delete them first (the first statement of the script) or ship
the web revert last. The code revert alone leaves `reminder_days` unread, which is harmless.

## Final verification
- `pnpm lint`, `pnpm typecheck`, `pnpm test`, the build commands and `pnpm audit --prod --audit-level high` pass; no runtime dependency was added.
- Every acceptance criterion AC-01 to AC-09 has a passing test named in a block above; NFR-01 is covered by the fake-clock pass tests (08:59, 09:00, 09:10, downtime, past due date, two zones), NFR-02 by the unique key, the sequential and concurrent pass tests.
- Coverage stays at or above 80% lines, branches and functions over the whole workspace (the web fields and the job count too).
- The `when` of 0031 is above the maximum on `main` at the time of the merge (re-check and bump if another migration landed).
- The job and the cross-owner source are reachable only from `worker.ts`; the API process does not import them; `credit-cards` imports neither `notices` nor `movements`.
- Logs of the job contain identifiers only: no card name, amount, language or time zone; stored notice texts contain no amount and no account name.

# Spec DISC-001-10e: Automatic Debit

| Field | Value |
|-------|-------|
| Ticket | DISC-001-10e |
| PRD | docs/ddw/prd/prd-DISC-001-10e.md |
| Tier | FEATURE |
| Date | 2026-10-10 |
| Spec loops | 0 |
| Loops since last human decision | 0 |

## Summary
A card gains two optional links, one automatic debit account per currency (`credit_cards.debit_ars_account_id`
and `debit_usd_account_id`, composite keys to the owner's accounts), edited through a new use case and
`PUT /credit-cards/:id/debit-accounts`. A new worker job of the `credit-cards` module (`AutomaticDebitJob`, the
`setTimeout` chain of the 08b recording job) runs every `RECURRING_JOB_INTERVAL_SECONDS`. For each card with a debit
account it finds the statements whose due date has arrived (local time of the due date at or after 06:00, no upper
bound), computes the unpaid remainder with the same `buildStatementViews` the screen uses, and records a transfer of
exactly that remainder from the debit account to the card's linked account of that currency. Exactly-once is a claim row
in a new table `card_automatic_debits` (primary key card, period, currency) taken under a row lock, plus a transfer id
derived deterministically from that key, so a crash between recording and marking cannot duplicate and two concurrent
passes produce one transfer. The transfer is recorded through a new unmetered, id-keyed method of a movements-side
recorder behind a port in `credit-cards`, which never imports `movements`. The job is deliberately not exported from the
module index, so the API process cannot reach the cross-owner read (the write scope is built only from the `users`
join, as in 08b). No new runtime dependency.

## Design decisions
These are not stated by the PRD; the owner ratifies them at approval.
- D1: One idempotency row per statement and currency in `card_automatic_debits` with status `pending` (transient, inside
  the claiming transaction), `recorded` or `skipped`. A settled row is never retried: a deleted or edited transfer is
  not re-created (PRD risk table: the user can edit or delete the transfer), and an archived or missing debit account
  (FR-04, AC-07) marks the row `skipped` with reason `account_unavailable`. Reasoning: retrying an archived account
  on every pass until the user acts would debit weeks later, after an un-archive, against a statement the user
  believes is unpaid on purpose. The user pays by hand, which the PRD already states.
- D2: The transfer id is derived from (card, period, currency) with SHA-256, shaped as a UUID (version nibble 8). The
  claim row cannot hold the id, because a rolled-back claim would lose a random one.
- D3: Eligibility window. A debit is due for a statement when its due date is on or before the owner's last due day
  (today when the local time is 06:00 or later, otherwise yesterday) and on or after the day the debit account of that
  currency was linked (`debit_*_linked_on`, the owner's local date at link time). Without the lower bound, linking a
  debit account would pay every old unpaid statement at once. A link made on the due date after 06:00 therefore debits
  at the next pass.
- D4: The job reuses `RECURRING_JOB_INTERVAL_SECONDS` (integer 1 to 300, default 60) instead of a new variable, so
  the pass interval is at most 300 s, which meets the 15-minute bound of NFR-02 with margin. The e2e worker sets it to 5.
- D5: The remainder of a statement is `total - paid` of `buildStatementViews` for that statement, so the oldest-first
  allocation of 10d applies: if an older closed statement of the same currency is still unpaid it absorbs the
  transfer in the screen, and the due statement keeps showing a remainder. The job does not pay older statements.
- D6: A debit account is validated at link time: currency equal to the one it is linked for (AC-02), the owner's
  (a foreign or missing id is 404, AC-05), open (`ACCOUNT_ARCHIVED` 409), and not the linked account of any of the
  owner's cards (AC-05 generalized from the card's own accounts, because deleting card A would otherwise hit the
  restrict key of card B). Several cards may share one debit account.
- D7: Archiving a debit account stays allowed, because FR-04 and AC-07 require handling it. Only deleting is blocked
  (the composite key restricts and `AccountLinks.isLinked` also reads the two new columns, so the existing
  `ACCOUNT_LINKED_TO_CARD` 409 answers); its catalog message is reworded to cover both cases.
- D8: The currency of a debit account is enforced by the use case, not by the database: the currency lives on the
  `accounts` row, and the composite key reaches only `(id, owner_id)`. The checks keep a debit account different from the
  card's own two accounts.
- D9: The transfer carries no note (a note would be a hardcoded UI string) and is dated noon of the due date in the
  owner's zone, like the 08b expenses, so it lands in the due month and never in the future.
- D10: A pass that finds a closed statement missing creates the missing cycles with `ensureStatements`, because statements
  are materialized only when someone reads the card.
- D11: The job logs identifiers only (card id, period, currency, error class name, reason). Never amounts or names.

## Coverage: PRD → blocks
| Requirement | Covered by |
|---|---|
| FR-01 | Block 1, Block 2, Block 3, Block 5, Block 8, Block 10, Block 11, Block 12 |
| FR-02 | Block 4, Block 6, Block 7, Block 9, Block 12 |
| FR-03 | Block 4, Block 7 |
| FR-04 | Block 4, Block 6, Block 12 |
| NFR-01 | Strategy: the debit amount is a `bigint` remainder in minor units end to end (shared helpers, `bigint` columns of the existing movements table); the new table stores no amount at all; the new columns are `uuid` and `date`; a guard test scans the new files for `Number(`, `parseFloat`, `toFixed` and `Math.round` (Block 12) |
| NFR-02 | Strategy: one pass every `RECURRING_JOB_INTERVAL_SECONDS` (at most 300 s), a debit is due from 06:00 local of the due date with no upper bound, so a running worker records within 5 minutes of 06:00 and a restarted worker records on its first pass; asserted with a fake clock at 05:59, 06:00, 06:10 and after downtime (Block 4, Block 7) |
| NFR-03 | Strategy: primary key (card, period, currency) on `card_automatic_debits`, claim by `INSERT ... ON CONFLICT DO NOTHING` then `SELECT ... FOR UPDATE` in one transaction, and a deterministic transfer id; asserted with sequential and concurrent passes on a real database (Block 6, Block 7) |

## Dependencies between blocks
Order: 1 (shared contract) and 2 (migration and schema, independent of 1) first; 3 needs 1 and 2 for types; 4 needs 2 and
3; 5 needs 2 and 3; 6 needs 2 and 4; 7 needs 4 and 6; 8 needs 1, 3 and 5; 9 needs 7; 10 needs 1 and 8; 11 needs 10; 12 needs
every other block. Blocks 5 and 6 touch different files, except `drizzle-credit-card-repository.ts` (Block 5 only).

## Block 1 — Shared contract and error codes

**Files**
- `packages/shared/src/credit-cards/credit-card.ts` (modified) — `setDebitAccountsRequestSchema`; `debitArsAccountId` and `debitUsdAccountId` on `creditCardResponseSchema`.
- `packages/shared/src/errors.ts` (modified) — codes `DEBIT_ACCOUNT_CURRENCY_MISMATCH` and `DEBIT_ACCOUNT_IS_CARD_ACCOUNT`.
- `packages/shared/test/credit-card-schemas.test.ts` (modified) — schema cases.

**Logic**
`setDebitAccountsRequestSchema` is `z.strictObject({ debitArsAccountId: z.uuid().nullable(), debitUsdAccountId: z.uuid().nullable() })`:
both keys are required and `null` means "no automatic debit in that currency", so a `PUT` replaces the whole setting and a
forgotten key is an error instead of a silent unlink. `creditCardResponseSchema` gains the two ids as `z.string().nullable()`.
The two error codes are added to the shared `ERROR_CODES` list (their HTTP status and web messages are added in Blocks 8 and 10).

**Data model**
Response entity `CreditCardResponse`, new fields: `debitArsAccountId: string | null` (nullable), `debitUsdAccountId: string | null`
(nullable). Request entity `SetDebitAccountsRequest`: both fields required, each a UUID or `null`, no default, no other key.

**Input validation**
- `debitArsAccountId`, `debitUsdAccountId`: a UUID string or `null`; a missing key, a non-UUID string, `""`, a number and any unknown key are rejected.

**Error handling**
- A schema failure is `VALIDATION_FAILED` (400) listing the failing paths only, never the typed values (reported by the shared validation middleware).

**Required tests**
- [ ] a request with two UUIDs, one UUID and one `null`, and two `null` all parse — validates AC-01
- [ ] a request with a missing key, a non-UUID, `""`, a number and an unknown key is rejected as invalid input (sad path) — validates FR-01
- [ ] the issues of a rejected request carry only the failing paths, not the typed values (sad path) — validates FR-01
- [ ] the card response parses with both debit fields `null` and with UUID strings, and rejects an `undefined` field (sad path) — validates AC-01

**Completion criterion**
`pnpm --filter @pesly/shared exec vitest run` passes and `pnpm typecheck` shows only the expected consumers of `CreditCardResponse` still to update.

## Block 2 — Migration 0027 and schema

**Files**
- `apps/api/drizzle/0027_card_automatic_debit.sql` (new) — adds the four `credit_cards` columns, their keys and checks, and creates `card_automatic_debits`.
- `apps/api/drizzle/rollback/0027_card_automatic_debit.down.sql` (new) — reverse script, runnable twice.
- `apps/api/drizzle/meta/0027_snapshot.json` (new) — snapshot chained from `0026_snapshot.json` (`prevId` `26a44ee5-a7df-4865-88df-fce5759ca8f7`).
- `apps/api/drizzle/meta/_journal.json` (modified) — entry `idx 27`, tag `0027_card_automatic_debit`, `when` 1791747000000.
- `apps/api/src/credit-cards/infrastructure/db/schema.ts` (modified) — the four columns, keys and checks on `creditCards`; the `cardAutomaticDebits` table.
- `apps/api/test/credit-cards/schema-introspection.test.ts` (modified) — the new keys, checks and indexes.
- `apps/api/test/credit-cards/automatic-debit-migration.test.ts` (new) — journal, defaults, rollback.

**Logic**
Additive and non-destructive: existing cards get `null` in the four new columns, so no card has an automatic debit until the
owner links one. The journal `when` is greater than 1791661150964, the maximum on `main` (0026), and must still exceed
`main`'s maximum at merge time (drizzle-migration merge rule: re-check and bump before merging). The rollback drops the new
table and columns and deletes its row from `drizzle.__drizzle_migrations`; applying it loses every debit link and claim, so it
is a manual plan step with a backup, stated in the script header like 0025.

**Data model**
`credit_cards` (new columns, all nullable)
- `debit_ars_account_id uuid null`, `debit_usd_account_id uuid null`
- `debit_ars_linked_on date null`, `debit_usd_linked_on date null` — the owner's local date at link time (D3)
- foreign key `credit_cards_debit_ars_account_owner_fk` (`debit_ars_account_id`, `owner_id`) references `accounts(id, owner_id)` on delete restrict; same for `credit_cards_debit_usd_account_owner_fk` (a null debit column skips the key)
- check `credit_cards_debit_ars_linked_check`: `(debit_ars_account_id is null) = (debit_ars_linked_on is null)`; same for USD
- check `credit_cards_debit_ars_not_card_account_check`: `debit_ars_account_id is null or (debit_ars_account_id <> ars_account_id and debit_ars_account_id <> usd_account_id)`; same for USD
- partial index `credit_cards_automatic_debit_idx` on (`id`) where `debit_ars_account_id is not null or debit_usd_account_id is not null` (serves the job's keyset page)
- no unique constraint on the debit columns: several cards may share one bank account (D6)

`card_automatic_debits`
- `card_id uuid not null`, `owner_id uuid not null`
- `period text not null`, check `period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`
- `currency text not null`, check in (`ARS`, `USD`)
- `status text not null`, check in (`pending`, `recorded`, `skipped`)
- `reason text null`, check null or in (`covered`, `account_unavailable`, `refused`)
- `movement_id uuid null` — no foreign key on purpose: the user may delete or edit the transfer and the claim must outlive it
- `created_at timestamptz not null default now()`, `updated_at timestamptz not null default now()`
- primary key `card_automatic_debits_pk` (`card_id`, `period`, `currency`)
- foreign key `card_automatic_debits_card_owner_fk` (`card_id`, `owner_id`) references `credit_cards(id, owner_id)` on delete cascade
- check `card_automatic_debits_state_check`: `(status = 'recorded' and movement_id is not null and reason is null) or (status = 'skipped' and movement_id is null and reason is not null) or (status = 'pending' and movement_id is null and reason is null)`
- index `card_automatic_debits_owner_idx` on (`owner_id`)

**Input validation**
Not applicable: no input; the database refuses a currency, status, reason, period or combination outside these rules.

**Error handling**
- A debit account of another owner or an unknown account raises a foreign key violation (`credit_cards_debit_ars_account_owner_fk`), which the repository turns into `ResourceNotFound` (Block 5).
- A debit account equal to one of the card's own accounts, or a link date without an account, raises a check violation.
- A second claim for the same (card, period, currency) is a unique violation, turned into "not claimed" by `ON CONFLICT DO NOTHING` (Block 6).
- Deleting a debit account while a card points at it is refused by the restrict key.

**Required tests**
- [ ] migration registry: journal entry idx 27 exists, its `when` is the greatest of the journal, and `0027_snapshot.json` chains on 0026's id — validates NFR-03
- [ ] after the migration, existing cards have all four new columns `null` — validates AC-04
- [ ] a debit account of another owner or an unknown id violates the composite key (sad path) — validates AC-05
- [ ] a debit account equal to the card's ARS or USD account violates its check, and a link date without an account violates `credit_cards_debit_ars_linked_check` (sad path) — validates AC-05
- [ ] deleting an account that a card uses as debit account is refused by the restrict key, and deleting the card then the account succeeds (sad path) — validates FR-01
- [ ] inserting the same (card, period, currency) twice is a duplicate that raises the unique violation, and another currency succeeds — validates AC-09
- [ ] inserting a status, currency, reason or period outside the allowed values, or `recorded` without a `movement_id`, is an error from the checks (sad path) — validates NFR-03
- [ ] deleting the card cascades to its claim rows and leaves other owners' rows — validates NFR-03
- [ ] the rollback runs twice and restores the 0026 schema, and the migration re-applies — validates NFR-03
- [ ] introspection: the four keys, checks and indexes exist as declared — validates FR-01

**Completion criterion**
`pnpm --filter ./apps/api test` passes the migration and introspection tests against a fresh database, and `when` of 0027 is above 1791661150964 and above `main`'s maximum at merge time.

## Block 3 — Card domain and link use case

**Files**
- `apps/api/src/credit-cards/domain/credit-card.ts` (modified) — `DebitLink`, `CreditCard.debitAccounts`.
- `apps/api/src/credit-cards/domain/errors.ts` (modified) — `DebitAccountCurrencyMismatch`, `DebitAccountIsCardAccount`, `DebitAccountArchived`.
- `apps/api/src/credit-cards/application/ports/debit-accounts.ts` (new) — `DebitAccounts` port.
- `apps/api/src/credit-cards/application/ports/credit-card-repository.ts` (modified) — `updateDebitAccounts`, `isCardAccount`.
- `apps/api/src/credit-cards/application/set-card-debit-accounts.ts` (new) — the use case.
- `apps/api/src/credit-cards/application/dependencies.ts` (modified) — `debitAccounts`.
- `apps/api/test/credit-cards/fakes.ts` (modified) — in-memory implementations, `debitAccounts`, card fixtures with the new field.
- `apps/api/test/credit-cards/debit-accounts.test.ts` (new) — use case tests.

**Logic**
`CreditCard.debitAccounts` is `{ ARS: DebitLink | null; USD: DebitLink | null }` with `DebitLink = { accountId: string; linkedOn: string }`.
`DebitAccounts.find(scope, id)` returns `{ currency, archived }` or `null`, filtered by the owner in the same statement.
`SetCardDebitAccounts.execute(scope, cardId, { ARS, USD })`:
1. Load the card scoped (`ResourceNotFound` first, nothing else is read for a foreign card).
2. For each currency with a non-null id: if the id equals one of the card's own accounts or `cards.isCardAccount(scope, id)` is true, throw `DebitAccountIsCardAccount`; load the account with `debitAccounts.find` (`notFoundUnlessAllowed`, a foreign or missing id is 404); an account whose currency differs from the one it is linked for throws `DebitAccountCurrencyMismatch`; an archived account throws `DebitAccountArchived`, except when it is already the current link (re-saving an unchanged setting is allowed).
3. `linkedOn` is the current link's date when the account is unchanged, otherwise today in the owner's zone (`todayOf`); `null` clears the link.
4. Both currencies are validated before anything is written; `cards.updateDebitAccounts` saves both columns in one statement and returns the card, or `null` when it vanished (`ResourceNotFound`).

**Input validation**
Values arrive already validated by the Block 1 schema; the use case re-checks currency, ownership and archive state against the database because the schema cannot know them.

**Error handling**
- Missing or foreign card: `ResourceNotFound`, nothing written.
- Account missing or of another owner: `ResourceNotFound` (404), nothing written, the other currency is not saved either.
- Currency of the account differs from the currency it is linked for: `DebitAccountCurrencyMismatch`, nothing written.
- The card's own account or any card's linked account: `DebitAccountIsCardAccount`, nothing written.
- Archived account (a new link): `DebitAccountArchived` (`ACCOUNT_ARCHIVED`), nothing written.

**Required tests**
- [ ] linking an ARS bank account for ARS saves the account and today's date, and the card reads it back — validates AC-01
- [ ] linking only ARS leaves USD `null`, and passing `null` for ARS clears the link and its date — validates AC-04
- [ ] saving the same account again keeps the original `linkedOn`, and changing to another account sets today — validates AC-01
- [ ] a USD account linked for ARS is rejected with `DebitAccountCurrencyMismatch` and nothing is saved (sad path) — validates AC-02
- [ ] the card's own ARS account, its USD account and the linked account of another card are rejected with `DebitAccountIsCardAccount` (sad path) — validates AC-05
- [ ] an account of another user and an unknown id are `ResourceNotFound` 404 and nothing is saved (sad path) — validates AC-05
- [ ] a valid ARS link with an invalid USD link saves neither (sad path, atomic) — validates AC-02
- [ ] an archived account is rejected as a new link and accepted when it is already the current link (sad path) — validates FR-01
- [ ] another user's card is `ResourceNotFound` and no account is read (sad path) — validates AC-05

**Completion criterion**
`pnpm exec vitest run test/credit-cards/debit-accounts.test.ts test/credit-cards/use-cases.test.ts` passes with fakes and no database, and domain and application files import no infrastructure.

## Block 4 — Automatic debit domain and use case

**Files**
- `apps/api/src/credit-cards/domain/automatic-debit.ts` (new) — `AUTOMATIC_DEBIT_DUE_TIME`, `automaticDebitMovementId`, `debitCandidates`, `unpaidRemainder`.
- `apps/api/src/credit-cards/application/ports/automatic-debit-source.ts` (new) — cross-owner paged read of cards with a debit account.
- `apps/api/src/credit-cards/application/ports/automatic-debit-log.ts` (new) — claim and settled-keys port.
- `apps/api/src/credit-cards/application/ports/automatic-debit-recorder.ts` (new) — id-keyed transfer recorder.
- `apps/api/src/credit-cards/application/record-automatic-debits.ts` (new) — the use case.
- `apps/api/test/credit-cards/fakes.ts` (modified) — `FakeAutomaticDebitSource`, `InMemoryAutomaticDebitLog`, `FakeAutomaticDebitRecorder`.
- `apps/api/test/credit-cards/automatic-debit.test.ts` (new) — use case and domain tests.

**Logic**
Domain (pure, `bigint` only):
- `automaticDebitMovementId(cardId, period, currency)`: SHA-256 of `pesly:automatic-debit:<card>:<period>:<currency>`, first 128 bits shaped as a UUID with version nibble 8 and variant `10`.
- `debitCandidates({ statements, debitAccounts, settled, lastDue })`: the (statement, currency) pairs oldest first whose due date is on or before `lastDue` and on or after that currency's `linkedOn`, with a debit account set and no settled key (D3).
- `unpaidRemainder(total, paid)`: `total - paid`, never negative.

`RecordAutomaticDebits.execute()` pages the source (keyset by card id, 500 per page, no overlap with the next pass). For each entry:
1. `local = instantToZonedLocal(clock.now(), timeZone)`; `lastDue` is today when the local time is `>= 06:00`, else yesterday (`addDays`). An unknown zone falls back inside the shared helpers.
2. `scope` from the injected `scopeFor(ownerId)`; statements from `ensureStatements(cards, scope, card, today)` (D10); settled keys from `log.settledKeys(scope, card.id)`; candidates from the domain function. No candidate: next card, no further query.
3. For each candidate, oldest first, `log.withClaim(scope, key, settle)`. Inside `settle` (the row is locked, the state is fresh): reload the statements, `buildStatementViews(deps, scope, card, statements, timeZone, today)` and take the view of the period. A view whose `payments` is `null` (not closed, e.g. dates edited meanwhile) returns `null`, which leaves the key unclaimed. Otherwise `remainder = unpaidRemainder(totals[currency], payments[currency].paid)`:
   - `0n` returns `{ status: 'skipped', reason: 'covered' }` (FR-03, AC-06).
   - otherwise the transfer is recorded with `recorder.recordOnce(scope, automaticDebitMovementId(...), { sourceAccountId: debit account, destinationAccountId: the card's linked account of the currency, amount: remainder, occurredAt: noon of the due date in the owner's zone })` and returns `{ status: 'recorded', movementId }` (FR-02, AC-03, AC-11).
   - an `AppError` from the recorder (archived or missing account, any movement rule) returns `{ status: 'skipped', reason: 'account_unavailable' }` for `MOVEMENT_ACCOUNT_ARCHIVED`/`ACCOUNT_ARCHIVED`/`NOT_FOUND` and `{ status: 'skipped', reason: 'refused' }` for any other `AppError` (FR-04, AC-07); the claim is then settled so it is not retried (D1).
   - a plain `Error` (storage down, timeout) is rethrown: the claim rolls back, the pass reports it and the next pass retries.
4. The use case keeps counters (`cards`, `recorded`, `skippedCovered`, `skippedUnavailable`, `skippedRefused`, `alreadySettled`, `failed`) and reports failures through `report` with ids and the error class name only; a failure of one candidate or card never stops the others.

**Input validation**
No external input: ids, zones and amounts come from the database through the ports; the domain functions trust no value they do not compute.

**Error handling**
- The recorder raises a domain error (archived, missing or refused account): the claim is settled as `skipped`, nothing is recorded, no retry.
- The recorder or the claim raises a plain `Error` (storage down): reported with ids and the class name, the claim rolls back, the next pass retries.
- A failure while handling one card (statements, views): reported, counted in `failed`, the pass continues with the next card.
- A claim already settled by another pass or process: counted in `alreadySettled`, nothing recorded.

**Required tests**
- [ ] a statement due today with an unpaid ARS remainder of 40,000.00 ARS and an ARS debit account records one transfer of `4000000` minor units from the debit account to the card's ARS account — validates AC-03
- [ ] a card with an ARS debit account and no USD debit account records nothing in USD even with a USD remainder — validates AC-04
- [ ] two debit accounts record one ARS and one USD transfer, each with its own remainder and no conversion — validates FR-02
- [ ] payments that already cover the total in ARS record nothing and settle the key as `covered` — validates AC-06
- [ ] a statement with a total of 0 in a currency records nothing in it — validates FR-03
- [ ] 15,000.00 ARS paid by hand before the due date debits only the remaining 25,000.00 ARS of a 40,000.00 ARS statement — validates AC-11
- [ ] an archived debit account (the recorder raises the archived error) records nothing, settles `skipped` with reason `account_unavailable`, and a second pass does not retry (sad path) — validates AC-07
- [ ] a missing debit account (the recorder raises 404) records nothing and settles `skipped` (sad path) — validates FR-04
- [ ] any other domain error of the recorder settles `skipped` with reason `refused` (sad path) — validates FR-04
- [ ] at 05:59 local on the due date nothing is recorded and at 06:00 the transfer is recorded — validates NFR-02
- [ ] a pass at 06:10 local on the due date has recorded the transfer — validates AC-08
- [ ] a first pass days after the due date (worker was down) records the transfer once — validates AC-10
- [ ] a statement due before the debit account was linked is never debited, and one due on the link date is — validates AC-10
- [ ] with the zone `Asia/Tokyo` the 06:00 comes from the owner's zone, not the process zone — validates NFR-02
- [ ] two sequential passes over the same statement record 1 transfer and the second reports `alreadySettled` — validates AC-09
- [ ] two statements of one card due the same day are processed oldest first and the second remainder reflects the first transfer (D5) — validates FR-02
- [ ] a plain `Error` from the recorder is reported with ids and the class name only, rolls the claim back, creates no settled key, and the next pass retries (sad path) — validates NFR-03
- [ ] an error while handling one card is reported with ids only and the next card is still processed (sad path) — validates NFR-03
- [ ] the reported failures and info lines contain no amount, account name or card name (sad path) — validates NFR-01
- [ ] the same (card, period, currency) always gives the same movement id, and a different period, currency or card gives another (domain) — validates NFR-03

**Completion criterion**
`pnpm exec vitest run test/credit-cards/automatic-debit.test.ts` passes with fakes and no database, and domain and application files import no infrastructure and no other module.

## Block 5 — Linking adapters: repository, lookups, links, erasure

**Files**
- `apps/api/src/credit-cards/infrastructure/db/drizzle-credit-card-repository.ts` (modified) — maps the new columns, `updateDebitAccounts`, `isCardAccount`.
- `apps/api/src/credit-cards/infrastructure/db/drizzle-debit-accounts.ts` (new) — `DebitAccounts` over the owner's accounts.
- `apps/api/src/credit-cards/infrastructure/db/drizzle-card-account-links.ts` (modified) — `isLinked` also answers true for an account used as debit account.
- `apps/api/src/credit-cards/infrastructure/db/foreign-relations.ts` (unchanged unless the lookup needs another relation) — `accounts` is already re-exported.
- `apps/api/src/credit-cards/infrastructure/db/erase-user-credit-cards.ts` (unchanged) — documented: the claim rows go with the cards by cascade.
- `apps/api/test/credit-cards/credit-card-repository.test.ts` (modified), `apps/api/test/credit-cards/erasure-step.test.ts` (modified) — database cases.

**Logic**
`cardColumns` and the mapper read the four columns into `CreditCard.debitAccounts` (`null` when the id is `null`; the date as `YYYY-MM-DD`
text). `updateDebitAccounts(scope, cardId, change)` is one `UPDATE ... WHERE id = $1 AND owner_id = scope` setting the four
columns together and returning the card (`null` when no row matched); a foreign key violation of the debit keys is turned into
`ResourceNotFound` (an account deleted between the check and the write, the same way `violatedConstraint` is used for the
name collision). `isCardAccount(scope, accountId)` is a scoped `exists` over `credit_cards` where the account is either linked
account. `DrizzleDebitAccounts.find` selects currency and `archived_at is not null` from `accounts` with the owner filter.
`DrizzleCardAccountLinks.isLinked` adds the two debit columns to its `or`; it stays unscoped by design and answers a boolean about
the id the accounts module just loaded. The erasure step is unchanged: `eraseUserCreditCards` deletes the cards, which removes
their debit links and `card_automatic_debits` rows by cascade, before the user's accounts go.

**Input validation**
Not applicable: the adapters receive ids already validated and scoped by the use case.

**Error handling**
- A foreign key violation on the debit keys: `ResourceNotFound`, nothing written.
- A check violation (debit account equal to a card account) is not expected after the use case; it propagates as an unexpected error and is mapped to 500 `INTERNAL` without detail.
- A scope that is not the owner's matches no row: `updateDebitAccounts` answers `null`, `isCardAccount` and `find` answer `false` and `null`.

**Required tests**
- [ ] saving a debit account for each currency reads back both accounts and dates through `findById` and `list` — validates AC-01
- [ ] clearing a link sets the account and its date to `null` in one statement — validates AC-04
- [ ] another owner's scope updates nothing and `updateDebitAccounts` answers `null` (sad path, cross-user 404) — validates AC-05
- [ ] an account deleted before the write raises the key violation, mapped to `ResourceNotFound` (sad path) — validates AC-05
- [ ] `isCardAccount` is true for a linked account of any of the owner's cards and false for a bank account and another owner's id — validates AC-05
- [ ] `isLinked` is true for an account used as debit account and false once the link is cleared — validates FR-01
- [ ] the accounts module's delete of a debit account answers `ACCOUNT_LINKED_TO_CARD` and keeps the account, and archiving it succeeds (sad path) — validates FR-04
- [ ] erasing a user deletes their cards with debit links and `card_automatic_debits` rows and then their accounts, and leaves other users' rows — validates NFR-03

**Completion criterion**
`pnpm exec vitest run test/credit-cards/credit-card-repository.test.ts test/credit-cards/erasure-step.test.ts` passes against PostgreSQL (`TEST_DATABASE_URL`).

## Block 6 — Job adapters: source, claim log, transfer recorder

**Files**
- `apps/api/src/credit-cards/infrastructure/db/drizzle-automatic-debit-source.ts` (new) — cross-owner paged read.
- `apps/api/src/credit-cards/infrastructure/db/drizzle-automatic-debit-log.ts` (new) — claim under a row lock and settled keys.
- `apps/api/src/movements/infrastructure/credit-cards/drizzle-automatic-debit-recorder.ts` (new) — `createAutomaticDebitRecorder(db, logger?, options?)`.
- `apps/api/src/movements/index.ts` (modified) — exports the recorder factory.
- `apps/api/test/credit-cards/automatic-debit-adapters.test.ts` (new) — database cases for the three adapters.

**Logic**
`DrizzleAutomaticDebitSource.page(afterId, limit)` selects from `credit_cards` joined to `users` (owner id and time zone come from
the same row, so an erased user has no entry) where at least one debit column is not null, ordered by card id with a keyset predicate
on the partial index. It returns identifiers, the card fields and the zone only; it is UNSCOPED BY DESIGN like the 08b source and is
reachable only from the worker.

`DrizzleAutomaticDebitLog`:
- `settledKeys(scope, cardId)` returns the `period|currency` keys whose status is not `pending`, filtered by owner in the same statement.
- `withClaim(scope, key, settle)` opens a transaction, runs `INSERT ... ON CONFLICT DO NOTHING` of a `pending` row, then `SELECT status ... FOR UPDATE` of the key. A row that is not `pending` ends the transaction with `'already'`. Otherwise `settle()` runs: `null` rolls back and answers `'deferred'`; a settlement updates `status`, `reason`, `movement_id` and `updated_at` in the same transaction, commits and answers `'settled'`. An error thrown by `settle` rolls back (the claim row disappears) and propagates. A concurrent pass blocks on the unique index until the first commits, then sees the settled row and answers `'already'` (NFR-03).

`createAutomaticDebitRecorder` builds `CreateMovement` like `createMovementsExpenseRecorder` and implements the credit-cards port
`recordOnce(scope, id, transfer)`: a `transfer` movement from the source to the destination account for `amount`, unmetered (it never
touches the manual write limiter, like `recordUnmeteredWithId`), with the given id. A `DuplicateMovementId` returns the stored movement
(a repeat after a crash); a duplicate id that the owner cannot read is `ResourceNotFound`.

**Data model**
Reads and writes `card_automatic_debits` (Block 2): primary key (`card_id`, `period`, `currency`), `status` in (`pending`, `recorded`,
`skipped`), unique claim per key, owner filter on every statement; the transfer id is written into `movement_id`, which has no foreign
key. The source reads `credit_cards` and `users` only.

**Input validation**
Not applicable: ids, periods and amounts come from the use case and the database; `limit` is a number chosen by the job.

**Error handling**
- Storage errors inside the claim transaction roll back and propagate; the use case reports them (Block 4).
- A conflict on the claim is a normal outcome (`'already'`), never an error.
- `DuplicateMovementId` is a normal outcome of the recorder; any movement rule error (archived, same account, currency mismatch) propagates as the `AppError` the use case classifies.

**Required tests**
- [ ] the source returns only cards with a debit account, with the owner id and zone of their user, and pages by card id without gaps or repeats — validates FR-02
- [ ] the source returns no entry for a card whose debit link was cleared, and none for an erased user (sad path, no data) — validates AC-04
- [ ] `withClaim` settles once: the second sequential call answers `'already'` and the row is unchanged — validates AC-09
- [ ] two `withClaim` calls started at the same time with a slow `settle` run `settle` once and one answers `'already'` — validates AC-09
- [ ] a `settle` that throws rolls the claim back, leaves no row, and the next call settles (sad path) — validates NFR-03
- [ ] `settle` returning `null` leaves no row and answers `'deferred'` — validates NFR-03
- [ ] `settledKeys` omits another owner's rows and `pending` rows (sad path, cross-user) — validates NFR-03
- [ ] the recorder records a transfer of an exact `bigint` amount above 2^53 with the given id, and the balances move by that amount — validates NFR-01
- [ ] the recorder called twice with the same id returns the same movement and leaves 1 transfer (duplicate id) — validates AC-09
- [ ] the recorder does not consume the manual write limit: 61 calls with different ids in a minute all succeed — validates NFR-03
- [ ] the recorder rejects an archived source account and a source in another currency with the movement rule errors (sad path) — validates FR-04
- [ ] the recorder with a source or destination account of another owner than the scope raises `ResourceNotFound` and records no transfer (sad path, cross-user) — validates NFR-03

**Completion criterion**
`pnpm exec vitest run test/credit-cards/automatic-debit-adapters.test.ts` passes against PostgreSQL, and `credit-cards` imports nothing from `movements` (the architecture-boundaries test passes).

## Block 7 — Job loop and factory

**Files**
- `apps/api/src/credit-cards/infrastructure/jobs/automatic-debit-job.ts` (new) — `AutomaticDebitJob` and `AutomaticDebitLog`.
- `apps/api/src/credit-cards/jobs.ts` (new) — `createAutomaticDebitJob(deps)`; deliberately not re-exported from `./index`.
- `apps/api/test/credit-cards/automatic-debit-job.test.ts` (new) — loop and real-database integration cases.

**Logic**
`AutomaticDebitJob` is the `setTimeout` chain of `RecordingJob`: one pass, wait `intervalMs`, repeat; passes never overlap; an
error from a pass is logged and the next one still runs; `stop()` waits for the pass in progress and is idempotent; an idle pass
logs at debug level, a pass that recorded, skipped or failed logs its summary (counters only) at info level. The log sink de-duplicates
repeated failures by `cardId|period|currency|errorName` (bounded set, cleared when full; it only suppresses log lines, never
decides what is recorded) and writes card id, period, currency, reason and error class name only.

`createAutomaticDebitJob({ db, logger, recorder, cardPayments, purchases, clock?, intervalSeconds })` builds the use case over the
Drizzle repositories (`DrizzleCreditCardRepository`, `DrizzleInstallmentRepository`, the source and the log) with the injected
movements adapters (`recorder`, `cardPayments`, `purchases`), so `credit-cards` never imports `movements`. The write scope is
issued by `OwnerOrGroupMemberAccessPolicy.scopeFor({ userId: ownerId, sessionId: 'automatic-debit-job', emailVerified: true }, 'write')`
where `ownerId` comes only from the source's `users` join.

**Input validation**
Not applicable: the factory takes values from the composition root; `intervalSeconds` was validated by the worker environment schema (integer 1 to 300).

**Error handling**
- A pass that throws (storage down) is logged and the next pass still runs after the interval.
- `stop()` called twice or before `start()` is harmless; `start()` twice does not start a second chain.
- A failure of one card or claim is reported by the use case and does not reach the loop.

**Required tests**
- [ ] at 06:10 local of a due date with a real database, one pass records the transfer, the bank balance drops and the card account rises by the remainder — validates AC-08
- [ ] a job started after 06:00 of a due date that had no pass records the transfer in its first pass — validates AC-10
- [ ] the pass interval is at most 300 s: with passes every 60 s the transfer exists between 06:00 and 06:15 local — validates NFR-02
- [ ] three passes over the same statement leave 1 transfer, 1 claim row and an unchanged balance after the first — validates AC-09
- [ ] two passes running at the same time against one database leave exactly 1 transfer — validates AC-09
- [ ] a crash after recording and before the claim commits (the claim rolled back) and a rerun leave 1 transfer, found by its deterministic id — validates NFR-03
- [ ] a statement paid by hand between two passes before 06:00 records nothing and settles `covered` — validates AC-06
- [ ] an archived debit account at the pass leaves the statement unpaid, 0 transfers, a `skipped` row, and logs ids only — validates AC-07
- [ ] a pass that throws is logged and the next pass still runs, `stop()` waits for the pass in progress and is idempotent (sad path error) — validates NFR-03
- [ ] repeated failures of one key produce one log line, and the logged fields contain no amount, account name or card name (sad path) — validates NFR-01
- [ ] an error while handling one card is reported by the use case and does not stop the loop or the next card (sad path) — validates NFR-03
- [ ] the credit-cards module index does not export the job or the source (guard against reaching the cross-owner read from the API) — validates NFR-03
- [ ] with debit links on the cards of two owners, one pass records each transfer only between that owner's own accounts and leaves the other owner's balances unchanged (cross-user) — validates NFR-03

**Completion criterion**
`pnpm exec vitest run test/credit-cards/automatic-debit-job.test.ts` passes against PostgreSQL with `MutableClock`, and the job file is absent from `apps/api/src/credit-cards/index.ts`.

## Block 8 — HTTP route and composition

**Files**
- `apps/api/src/credit-cards/infrastructure/http/credit-card-routes.ts` (modified) — `PUT /credit-cards/:id/debit-accounts`; `debitAccounts` dependency.
- `apps/api/src/credit-cards/infrastructure/http/credit-card-presenter.ts` (modified) — emits the two debit ids.
- `apps/api/src/shared/http/error-handler.ts` (modified) — status 400 for the two new codes.
- `apps/api/src/server.ts` (unchanged unless a new dependency is injected) — the route builds its own `DrizzleDebitAccounts`.
- `apps/api/test/credit-cards/debit-account-routes.test.ts` (new) — route tests; `credit-card-routes.test.ts` (modified) for the new response fields.

**Logic**
The route runs `requireSession`, `requireVerifiedEmail`, a write scope from `OwnerOrGroupMemberAccessPolicy`, the shared `validate` middleware with `creditCardIdParamsSchema` and `setDebitAccountsRequestSchema`, then `SetCardDebitAccounts` with `{ ARS: body.debitArsAccountId, USD: body.debitUsdAccountId }`. The response is the card through `presentCreditCard`, which now carries both ids; `GET /credit-cards` and `GET /credit-cards/:id` show them too. The audit line carries request id, user id and card id, never an account id list or a name. A scoped miss is 404, never 403.

**API contract**
- Method + path: `PUT /credit-cards/:id/debit-accounts`.
- Request: params `{ id: uuid }`; body `{ debitArsAccountId: uuid | null, debitUsdAccountId: uuid | null }`, both keys required, unknown keys refused.
- Response: 200 with the card `{ id, name, closingDay, dueDay, arsAccountId, usdAccountId, debitArsAccountId: string | null, debitUsdAccountId: string | null, createdAt }`.
- Error codes: 400 `VALIDATION_FAILED`, `DEBIT_ACCOUNT_CURRENCY_MISMATCH`, `DEBIT_ACCOUNT_IS_CARD_ACCOUNT`; 401 `UNAUTHENTICATED`; 403 `EMAIL_NOT_VERIFIED`; 404 `NOT_FOUND` (card or account missing or not the user's); 409 `ACCOUNT_ARCHIVED`.
- Auth: `requireSession`, `requireVerifiedEmail`, owner write scope; data of another user answers 404, never 403.

**Input validation**
- Params and body through the Block 1 schemas and the shared validation middleware; the JSON body limit stays 16 kB; the route reads no unvalidated `req.body`.

**Error handling**
- Invalid body or non-UUID id: `VALIDATION_FAILED` (400), nothing stored.
- Currency mismatch and card-account rejection: the two 400 codes, nothing stored.
- Foreign or missing card or account: `NOT_FOUND` (404), nothing stored.
- Archived account as a new link: `ACCOUNT_ARCHIVED` (409), nothing stored.
- No session: 401 `UNAUTHENTICATED`; unverified email: 403 `EMAIL_NOT_VERIFIED`; unexpected errors: 500 `INTERNAL` without detail.

**Required tests**
- [ ] `PUT` with an ARS bank account for ARS answers 200 with `debitArsAccountId` set, and `GET /credit-cards/:id` shows it — validates AC-01
- [ ] `PUT` with `null` for both answers 200 with both `null` — validates AC-04
- [ ] `PUT` with a USD account for ARS answers 400 `DEBIT_ACCOUNT_CURRENCY_MISMATCH` and stores nothing (sad path) — validates AC-02
- [ ] `PUT` with the card's own ARS account answers 400 `DEBIT_ACCOUNT_IS_CARD_ACCOUNT`, and so does another card's linked account (sad path) — validates AC-05
- [ ] `PUT` with an account of another user answers 404 `NOT_FOUND` and stores nothing, and Bob's `PUT` on Ana's card answers 404 (sad path) — validates AC-05
- [ ] `PUT` with an archived account answers 409 `ACCOUNT_ARCHIVED` (sad path) — validates FR-01
- [ ] a missing key, a non-UUID, an unknown key and a non-UUID card id answer 400 `VALIDATION_FAILED` (sad path) — validates FR-01
- [ ] no session answers 401 and an unverified email 403 (sad path) — validates FR-01
- [ ] the audit line of a successful `PUT` carries the request id, user id and card id and no account id or name (sad path, log content) — validates NFR-01

**Completion criterion**
`pnpm exec vitest run test/credit-cards test/foundation` passes against PostgreSQL, and the endpoint answers the documented bodies.

## Block 9 — Worker wiring and environment

**Files**
- `apps/api/src/worker.ts` (modified) — builds, starts and stops the automatic debit job beside the recurring jobs.
- `apps/api/src/shared/config/env.ts` (modified, comment only) — the interval variable now documents that it also paces the automatic debit job.
- `apps/api/test/foundation/worker-env.test.ts` (modified) — the interval keeps its bounds.
- `apps/api/test/credit-cards/automatic-debit-worker.test.ts` (new) — start and stop of the factory output.

**Logic**
`worker.ts` imports `createAutomaticDebitJob` from `./credit-cards/jobs`, and `createAutomaticDebitRecorder`, `createCardPayments` and
`createCardPurchases` from their `movements` adapter files (deep imports, like the recurring recorder, so the composition root is the
only place that knows both modules). It starts the job after `recurringJobs.start()`, logs `automatic debit job started` with the
interval, and adds `automaticDebitJob.stop()` to the `Promise.all` of the shutdown, before `pool.end()`. The worker log line
`email worker started` that the e2e harness waits for is unchanged.

**Input validation**
`RECURRING_JOB_INTERVAL_SECONDS` stays validated by `parseWorkerEnv`: a string of digits, integer 1 to 300, default 60.

**Error handling**
- An invalid interval (`0`, `301`, `abc`, `1.5`) makes `parseWorkerEnv` throw at startup, before any job starts.
- A job that throws a pass error is logged by the job; the other jobs keep running.
- On `SIGTERM` every job is stopped and awaited before the pool closes.

**Required tests**
- [ ] `parseWorkerEnv` still accepts 1, 60 and 300 and rejects 0, 301, `abc` and `1.5` as invalid (sad path error) — validates NFR-02
- [ ] a pass error of the automatic debit job is logged and the recurring jobs keep running (sad path) — validates NFR-02
- [ ] on shutdown the job is stopped and awaited before the pool closes, even with a pass in progress (sad path error) — validates NFR-02
- [ ] the factory output starts, runs a pass, and `stop()` twice resolves without error — validates NFR-02
- [ ] the worker source imports the job from `credit-cards/jobs` and stops it in the shutdown list (source guard) — validates FR-02
- [ ] the API entry `server.ts` does not import `credit-cards/jobs` (guard against exposing the job to the API process) — validates NFR-03

**Completion criterion**
The worker tests pass and `pnpm --filter @pesly/api worker` starts with the new job logging its start line.

## Block 10 — Web client and request builder

**Files**
- `apps/web/src/lib/api-client.ts` (modified) — `setCardDebitAccounts`, the two error codes and their message keys.
- `apps/web/src/features/credit-cards/debit-accounts-request.ts` (new) — `buildDebitAccountsRequest` and the account filter.
- `apps/web/messages/en.json`, `apps/web/messages/es.json` (modified) — `errors.debitAccountCurrencyMismatch`, `errors.debitAccountIsCardAccount`, reworded `errors.accountLinkedToCard`.
- `apps/web/test/api-client-credit-cards.test.ts` (modified), `apps/web/test/debit-accounts-request.test.ts` (new).

**Logic**
`setCardDebitAccounts(cardId, body)` calls the route through the existing `request` helper, parses the answer with the shared card
validator and builds the path with `resourcePath`. `buildDebitAccountsRequest(values)` turns the two selected values (`''` means none)
into `{ debitArsAccountId, debitUsdAccountId }` with `null` for none. `debitCandidates(accounts, currency, card)` lists the owner's open
accounts of that currency whose type is not `credit_card`, so the picker never offers a card account or an archived one. The new codes
map to `debitAccountCurrencyMismatch` and `debitAccountIsCardAccount`; `accountLinkedToCard` is reworded to say that the account is linked to a
credit card, as its own account or as an automatic debit account.

**Input validation**
- Each value is `''` or a UUID taken from the loaded accounts; anything else is dropped before the request, and the server validates again.

**Error handling**
- A failure returns `{ ok: false, code, messageKey }`; a success body that fails its validator is `unexpected`; a network failure is `NETWORK`.
- A card id such as `..` is refused by `resourcePath` without a request.

**Required tests**
- [ ] the client sends `PUT` with the right path and body and parses the success answer — validates AC-01
- [ ] a malformed success body maps to `unexpected` (error path)
- [ ] a card id of `..` is refused without a request (invalid input)
- [ ] the builder turns an ARS selection and an empty USD selection into `{ debitArsAccountId: id, debitUsdAccountId: null }` — validates AC-01
- [ ] the candidates of ARS exclude USD accounts, archived accounts and `credit_card` accounts, so a currency mismatch cannot be picked — validates AC-02
- [ ] a 400 `DEBIT_ACCOUNT_CURRENCY_MISMATCH` and a 400 `DEBIT_ACCOUNT_IS_CARD_ACCOUNT` map to their message keys (sad path) — validates AC-05
- [ ] both catalogs contain the new keys with the same shape (sad path for a missing key) — validates FR-01

**Completion criterion**
`pnpm exec vitest run test/api-client-credit-cards.test.ts test/debit-accounts-request.test.ts test/i18n-catalogs.test.ts` passes in `apps/web`.

## Block 11 — Web card screen

**Files**
- `apps/web/src/features/credit-cards/components/debit-accounts-form.tsx` (new) — presentational: two selects and a save button.
- `apps/web/src/features/credit-cards/containers/credit-card-detail-container.tsx` (modified) — loads the accounts, saves, updates the card state.
- `apps/web/messages/en.json`, `apps/web/messages/es.json` (modified) — `creditCards.detail.debit*` keys.
- `apps/web/test/debit-accounts.test.tsx` (new), `apps/web/test/credit-card-detail.test.tsx` (modified).

**Logic**
The card page shows an "Automatic debit" section below the days form: one select per currency listing "None" and the owner's candidate accounts
of that currency (Block 10), preselected with the saved link, and a note that the unpaid remainder of each statement is transferred on its
due date, with no conversion between currencies. Saving calls `setCardDebitAccounts` and replaces the card in state with the answer, so
the saved links are shown (AC-01). The container loads the accounts with the same paged loader as the payment screen; presentational
components fetch nothing. All copy comes from the catalogs in Spanish and English; the section is online only like the other card writes.

**Input validation**
- The selects only offer candidates; the request is built by Block 10; a failed save keeps what the user chose.

**Error handling**
- `NOT_FOUND` shows the not-found state of the page; `DEBIT_ACCOUNT_CURRENCY_MISMATCH`, `DEBIT_ACCOUNT_IS_CARD_ACCOUNT` and `ACCOUNT_ARCHIVED` show their catalog message as an alert with the selection kept.
- `NETWORK` shows the connection-needed message; `UNAUTHENTICATED` redirects to sign-in; the accounts failing to load shows the load state with retry.

**Required tests**
- [ ] choosing an ARS bank account and saving sends the request and shows the saved account in the section — validates AC-01
- [ ] each select lists only open accounts of its currency, never a card account — validates AC-02
- [ ] choosing "None" and saving sends `null` and shows no debit account for that currency — validates AC-04
- [ ] a 400 currency mismatch and a 400 card-account answer show their messages as an alert and keep the selection (sad path) — validates AC-05
- [ ] a 404 shows the not-found state and a network failure keeps the typed selection (sad path) — validates FR-01
- [ ] an archived account answer (409) shows its message (sad path) — validates FR-04
- [ ] the section renders in Spanish and English and both catalogs have the same keys — validates FR-01
- [ ] the section has labelled selects and a visible error text, never conveyed by color alone — validates FR-01

**Completion criterion**
`pnpm exec vitest run test/debit-accounts.test.tsx test/credit-card-detail.test.tsx test/i18n-catalogs.test.ts` passes in `apps/web`, and `pnpm lint` and `pnpm typecheck` pass.

## Block 12 — End to end and guards

**Files**
- `apps/web/e2e/credit-cards-debit.spec.ts` (new) — the Playwright flows, with `test.use({ locale: 'es-AR', timezoneId: 'America/Argentina/Buenos_Aires' })`.
- `apps/web/e2e/support/database.ts` (modified) — `backdateDebitLinks(email, cardName)` and `automaticDebitRows(email, cardName)`.
- `playwright.config.ts` (modified) — `RECURRING_JOB_INTERVAL_SECONDS: '5'` in the worker environment.
- `apps/api/test/credit-cards/no-float-money.test.ts` (new) — guard over the new files and `no-sensitive-logs` cases.
- `apps/api/test/foundation/architecture-boundaries.test.ts` (modified) — a case for `credit-cards/jobs.ts` and the log files if a rule needs one.

**Logic**
Flow 1: a verified user creates an ARS bank account "Banco", a card, an ARS expense of 60,000.00 ARS on it, links "Banco" as ARS debit
account from the card page and sees it saved. The helper `closeFirstStatement` moves the first statement into the past (due three days ago,
so the 06:00 rule holds at any hour of the e2e run) and `backdateDebitLinks` moves `debit_ars_linked_on` 30 days back (D3). Within a few
passes of the worker (5 s interval) the card page shows the statement as paid in ARS and "Banco" shows a balance lowered by 60,000.00 ARS.
Flow 2: the same setup, then `archiveAccount` archives "Banco" before the pass; the test waits until `automaticDebitRows` shows the claim as
`skipped` with reason `account_unavailable`, then asserts that the statement is still unpaid and "Banco" has no transfer. Flow 3: linking a
USD account for ARS is not offered by the picker (the mismatch cannot be chosen). The worker interval change makes recurring and notices passes
faster only; both specs are rerun to confirm they are unaffected. The guard test scans the new source files for `Number(`, `parseFloat`,
`toFixed`, `Math.round` and plants a forbidden token to prove the guard reports it.

**Input validation**
Not applicable: the flows type nothing but the expense amount through the existing, already validated form.

**Error handling**
- The poll for the claim row times out with a clear message naming the card when the worker never ran a pass; the test fails instead of hanging.
- The guard test fails naming the file and the forbidden token.

**Required tests**
- [ ] the flow links "Banco" as ARS debit account, makes the statement due, and after a worker pass the statement is paid in ARS and the bank balance dropped by 60,000.00 ARS — validates AC-01, AC-03, AC-08
- [ ] the flow with a partially paid statement debits only the remainder, and a second pass adds no transfer — validates AC-09, AC-11
- [ ] the flow with an archived debit account leaves the statement unpaid and records no transfer (sad path) — validates AC-07
- [ ] the ARS picker never lists a USD account or a card account, so a mismatch cannot be chosen (sad path invalid input) — validates AC-02
- [ ] a card with no USD debit account records nothing in USD although it has a USD remainder — validates AC-04
- [ ] the new files contain no `Number(`, `parseFloat`, `toFixed` or `Math.round`, and the guard reports an error for a planted forbidden token — validates NFR-01

**Completion criterion**
The e2e spec lints and typechecks; the orchestrator runs it one at a time with the recurring and notices specs, and `pnpm test` passes the guards.

## Rollback
The migration is additive; the reverse script `0027_card_automatic_debit.down.sql` drops `card_automatic_debits` and the four `credit_cards`
columns and forgets the journal entry, so every debit link and claim row is lost (take a backup, stop the API and the worker, run it as a
whole, then revert the commits). Transfers already recorded by the job are ordinary movements and stay valid. Reverting the code without the
script is safe: the new columns are nullable and unread by the previous version.

## Final verification
- `pnpm lint`, `pnpm typecheck`, `pnpm test`, the build commands and `pnpm audit --prod --audit-level high` pass; no runtime dependency was added.
- Every acceptance criterion AC-01 to AC-11 has a passing test named in a block above; NFR-01 is covered by the `bigint` end-to-end path and the float guard, NFR-02 by the fake-clock pass tests, NFR-03 by the claim, the deterministic id and the concurrent-run tests.
- Coverage stays at or above 80% lines, branches and functions over the whole workspace (the web section and the job count too).
- The `when` of 0027 is above the maximum on `main` at the time of the merge (re-check and bump if another migration landed).
- The job and the cross-owner source are reachable only from `worker.ts`; the API process does not import them.
- Logs of the job contain identifiers only: no amount, account name or card name.

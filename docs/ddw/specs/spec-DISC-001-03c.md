# Spec DISC-001-03c: Transfers and Currency Exchange

| Field | Value |
|-------|-------|
| Ticket | DISC-001-03c |
| PRD | docs/ddw/prd/prd-DISC-001-03c.md |
| Tier | FEATURE |
| Date | 2026-10-02 |
| Spec loops | 0 |
| Loops since last human decision | 0 |

## Summary
Transfers and currency exchanges are two new movement types stored in the existing `movements` relation of DISC-001-03b, one row each (human decision of 2026-10-02): the row carries a destination account and a destination amount, has no category, and carries a rate only when it is an exchange. A transfer moves one amount between two accounts of the user with the same currency; an exchange takes an amount out of an ARS (or USD) account and puts another amount into a USD (or ARS) account, and stores its implied rate, the ARS amount over the USD amount scaled by 10,000 and rounded half-up with `(ars*20000 + usd) / (2*usd)` on bigint (the same rule as `parseScaledRate`). A new migration (tag `0016_transfers_exchanges`) relaxes `category_id`, `rate` and `rate_source`, adds `destination_account_id` and `destination_amount`, widens the two type lists, adds a composite foreign key for the destination account (`ON DELETE RESTRICT`, same owner) and one shape check that ties the nullable columns to the type, so the database also refuses a malformed row. `CreateMovement` gains two branches, the existing creation limit of 60 per minute per user is shared by all four types, and the real `AccountMovements` adapter now subtracts the source amount and adds the destination amount, so balances and the Available and Net worth totals stay correct. The web entry screen gets a four-way type switch with a destination picker, a second amount and a read-only implied-rate preview for exchanges, and the list shows transfers and exchanges with their two accounts.

Human decisions of 2026-10-02 folded into this version (recorded in the PRD decision log): Q1 the implied rate rounds half-up; Q2 the rules of DISC-001-03b apply to the new types (amounts at most 10^15 minor units, note at most 500 characters, archived source or destination rejected with 409 `ACCOUNT_ARCHIVED`, 60 creations per minute per user shared with expenses and income, an implied rate outside 1 to RATE_MAX scaled rejected with 400); storage as one row with a destination account and amount, `category_id` null for the new types and `rate` stored only on exchanges.

## Design decisions
- **D1, one row, no legs.** A transfer or exchange is one `movements` row (`account_id` is the source). The list shows it once (AC-08); balances read both account columns. Transfers store `destination_amount = amount` (a check enforces it) so that every balance query reads one column per side.
- **D2, the shape check.** One check, `movements_shape_check`, lists the three allowed shapes: expense and income (category, rate with source `automatic` or `manual`, no destination), transfer (no category, destination with the same amount, no rate, no source, no rate type) and exchange (no category, destination, rate with source `implied`, no rate type). The 03b checks on ranges stay; the composite key to categories keeps working because a null `category_id` skips a `MATCH SIMPLE` foreign key.
- **D3, currencies are decided in the use case.** The database cannot see the currencies of the two accounts without a join, so `CreateMovement` reads both accounts (id, archived state and currency, scoped by owner) and enforces: transfer needs the same currency (`MOVEMENT_CURRENCY_MISMATCH`), exchange needs different currencies (`EXCHANGE_SAME_CURRENCY`), and source and destination differ (`MOVEMENT_SAME_ACCOUNT`, also a database check). The implied rate takes the ARS amount from whichever side is the ARS account.
- **D4, order of checks.** future date, then account lookups (a missing or foreign account, source or destination, is 404, so no case reveals another user's data), then archived (409), then the account rules (400), then the implied rate (400). The same-account check on identical ids runs before the lookups and names no data.
- **D5, error codes.** New: `MOVEMENT_SAME_ACCOUNT`, `MOVEMENT_CURRENCY_MISMATCH`, `EXCHANGE_SAME_CURRENCY`, `IMPLIED_RATE_OUT_OF_RANGE`, all 400. Reused: `MOVEMENT_DATE_IN_FUTURE` (400), `ACCOUNT_ARCHIVED` (409), `RATE_LIMITED` (429 with `Retry-After`), `NOT_FOUND` (404), `VALIDATION_FAILED` (400).
- **D6, wire format.** The request is a discriminated union on `type`; the response stays one flat object with the 03b field names, where `categoryId`, `rate`, `rateSource`, `destinationAccountId` and `destinationAmount` may be `null`. `rateSource` gains the value `implied`. Existing clients of expense and income are unaffected.
- **D7, migration number and journal.** The migration is **0016** (`0015_price_snapshots` belongs to DISC-001-07b and `0015_tags` to DISC-001-03d). Generated on this branch, drizzle-kit names it 0015; CODE renames the file, the tag, the snapshot and the rollback script to 0016 and sets the journal entry (idx 15 here) and the snapshot `prevId` to the `id` of 0014's snapshot (`13f2933c-b982-4258-972b-89c6b8fb27f4`), with a `when` greater than 1790980568164 (the greatest seen on any worktree: 07b's price snapshots) and than the `when` of any migration on `main` or on any open branch, re-checked at merge and never lowered. The branches disagree today on 07b's number (0014 or 0015), so the number is also re-checked at merge. Tests never assert that 0016 is the newest migration.
- **D8, rollback is destructive for transfers and exchanges only.** The down script deletes the rows of type `transfer` and `exchange` before it restores the not-null columns and the old checks, so after a rollback balances no longer include them; expense and income rows are untouched.
- **D9, the creation limit.** `RecordManualMovement` already wraps `CreateMovement` for every type, so the 60 per minute limit and its refund-on-failure rule apply unchanged and are shared by the four types (FR-09).
- **D11, later consumers filter on type.** Transfers and exchanges are neither expenses nor income (glossary). Any query of a later ticket (reports, budgets) that sums expenses or income must filter on `type`; an exchange row carries a `rate` but no category and must never be counted as spending or earning. This ticket adds no such query: the only aggregate is the balance adapter, which counts both sides on purpose.
- **D10, the web shows what it computes only for display.** The exchange preview computes the implied rate with the shared helper for display; the stored value is always computed by the API.

## Coverage: PRD → blocks
| Requirement | Covered by |
|---|---|
| FR-01 | Block 1, Block 2, Block 3, Block 5, Block 6, Block 8 |
| FR-02 | Block 1, Block 2, Block 3, Block 5, Block 6, Block 8 |
| FR-03 | Block 1, Block 2, Block 3, Block 5, Block 6 |
| FR-04 | Block 2, Block 3, Block 4, Block 8 |
| FR-05 | Block 2, Block 5, Block 6 |
| FR-06 | Block 3, Block 5, Block 7, Block 8 |
| FR-07 | Block 2, Block 5, Block 6 |
| FR-08 | Block 1, Block 3, Block 6 |
| FR-09 | Block 2, Block 5 |
| NFR-01 | Strategy: bigint columns and int64 strings on the wire, no `Number` on money; the shape and range checks, a schema-introspection test and the static no-float scan extended to the new files (Blocks 1, 3, 8) |
| NFR-02 | Strategy: the implied rate is computed by one bigint helper in `packages/shared`, stored in the existing bigint `rate` column under the range check; no float column; the scan covers the helper (Blocks 1, 3, 8) |
| NFR-03 | Strategy: one insert, one limiter upsert and four indexed point reads (user preferences, two accounts) in one request with no external call; a performance test with the same sample size and warm-up as 03b asserts p95 under 300 ms for a transfer and for an exchange (Block 8) |
| NFR-04 | Strategy: the repository applies `scopedTo(scope, { owner })` on every read, the owner is forced from the session, both account keys are composite with `owner_id` so the database repeats the check, and the account lookup is scoped; evidence is AC-09 on source and on destination plus the other-owner tests of Blocks 3 and 5 (Blocks 2, 3, 5) |

## Dependencies between blocks
Block 1 (shared contracts and helper) first. Block 2 (domain, ports, use cases) needs Block 1. Block 3 (migration 0016, schema, repository) needs Blocks 1 and 2. Block 4 (balance adapter) needs Block 3. Block 5 (HTTP) needs Blocks 2, 3 and 4. Block 6 (web client and entry screen) needs Blocks 1 and 5. Block 7 (web list) needs Block 6. Block 8 (end-to-end, performance and scans) is last.
Execution order: 1, 2, 3, 4, 5, then 6, 7, then 8. DISC-001-03b (the movements module) is already on `main`; the migration number and `when` are re-checked against `main`, 07b and 03d at merge (D7).

## Block 1 — Shared contracts and the implied-rate helper

**Files**
- `packages/shared/src/movements/movement.ts` (modified) — `MOVEMENT_TYPES` gains `transfer` and `exchange`; `CATEGORIZED_MOVEMENT_TYPES = ['expense', 'income']` keeps the category kinds; `MOVEMENT_RATE_SOURCES` gains `implied`; the create request becomes a discriminated union on `type`; the response gains the nullable fields.
- `packages/shared/src/movements/implied-rate.ts` (new) — `impliedRate(arsMinor, usdMinor)`.
- `packages/shared/src/errors.ts` (modified) — adds `MOVEMENT_SAME_ACCOUNT`, `MOVEMENT_CURRENCY_MISMATCH`, `EXCHANGE_SAME_CURRENCY` and `IMPLIED_RATE_OUT_OF_RANGE` to `ERROR_CODES`.
- `packages/shared/src/index.ts` (modified) — exports the new file.
- `packages/shared/test/movement-schemas.test.ts` (modified for the union and the nullable response fields), `packages/shared/test/implied-rate.test.ts` (new).

**Logic**
`MOVEMENT_TYPES = ['expense', 'income', 'transfer', 'exchange']`. The create request is a discriminated union: expense and income keep `{ type, accountId, categoryId, amount, occurredAt, note?, rate }`; transfer is `{ type: 'transfer', accountId, destinationAccountId, amount, occurredAt, note? }`; exchange is `{ type: 'exchange', accountId, destinationAccountId, amount, destinationAmount, occurredAt, note? }`, where `accountId` is the source, `amount` is what leaves it and `destinationAmount` is what enters the destination. Keys that do not belong to the type (a category or a rate on a transfer, a rate on an exchange) are stripped. `impliedRate(arsMinor, usdMinor)` returns `(ars*20000n + usd) / (2n*usd)` as a bigint when the result is between 1 and `RATE_MAX_SCALED`, and `null` outside that range; it throws a `RangeError` for a non-positive argument and never uses `Number`. 2,000.00 ARS for 3.00 USD gives 6,666,667 (666.6667) and 1,557,300.00 ARS for 1,000.00 USD gives 15,573,000 (1,557.3000). A tie (the exact fraction is one half) rounds up.
The response keeps every 03b field and adds `destinationAccountId` (uuid string or `null`) and `destinationAmount` (positive integer string or `null`); `categoryId`, `rate` and `rateSource` become nullable; `rateSource` accepts `automatic`, `manual` and `implied`.

**Input validation**
`amount` and `destinationAmount`: positive integer string, 1 to 10^15 (the existing `movementAmountSchema`). `accountId` and `destinationAccountId`: UUIDs. `occurredAt` and `note`: the existing schemas (note at most 500 code points after trimming, no control characters). `type`: one of the four values; unknown keys are stripped.

**Error handling**
- Amount of 0, negative, malformed or above 10^15: validation failure naming the field.
- Note of 501 characters or with a control character: validation failure naming `note`.
- A transfer or exchange without `destinationAccountId` or an exchange without `destinationAmount`: validation failure naming the missing field.
- `impliedRate` called with a non-positive value: `RangeError`.
- `impliedRate` whose result is outside 1 to RATE_MAX: returns `null` (the use case turns it into `IMPLIED_RATE_OUT_OF_RANGE`).

**Required tests**
- [ ] a valid transfer body and a valid exchange body parse; keys of other types are stripped — validates AC-01, AC-03
- [ ] `impliedRate` of 155,730,000 ARS minor units over 100,000 USD minor units is 15,573,000 — validates AC-05
- [ ] `impliedRate` of 200,000 over 300 is 6,666,667 and a case that ends exactly on one half rounds up — validates AC-14
- [ ] `impliedRate` returns `null` for a result of 0 or above RATE_MAX scaled (out-of-range error path), and returns the boundary values 1 and RATE_MAX — validates AC-15
- [ ] `impliedRate` throws a `RangeError` for 0 and negative arguments (invalid input) — validates FR-03
- [ ] an amount of 0, a negative amount, a malformed amount and an amount above 10^15 are rejected on both amount fields (reject) — validates AC-11
- [ ] a note of 501 characters and a note with a control character are rejected (reject) — validates AC-12
- [ ] a transfer without `destinationAccountId` and an exchange without `destinationAmount` are rejected naming the field (reject) — validates FR-02
- [ ] the response schema accepts a transfer, an exchange and an expense, and rejects an unknown `rateSource` — validates FR-06
- [ ] the four new codes exist in `ERROR_CODES` — validates AC-02, AC-04, AC-15

**Completion criterion**
The shared tests pass; `pnpm typecheck` passes across the workspace, which finds every consumer of the now nullable response fields (`categoryId`, `rate`, `rateSource`) in the API and the web app; no `Number(`, `parseFloat`, `.toFixed` or `Math.` appears in `implied-rate.ts` (checked by the scan of Block 8).

## Block 2 — Domain, ports and use cases

**Files**
- `apps/api/src/movements/domain/movement.ts` (modified) — `Movement` becomes a union by `type`; `NewMovement` uses a distributive omit (a plain `Omit` over a union collapses it).
- `apps/api/src/movements/domain/errors.ts` (modified) — `MovementSameAccount`, `MovementCurrencyMismatch`, `ExchangeSameCurrency`, `ImpliedRateOutOfRange`, all extending `AppError`.
- `apps/api/src/movements/application/ports/account-lookup.ts` (modified) — `AccountReference` gains `currency`.
- `apps/api/src/movements/application/create-movement.ts` (modified) — `CreateMovementInput` becomes a union; two new branches.
- `apps/api/src/movements/application/record-manual-movement.ts` (modified only for the input type).
- `apps/api/test/movements/fakes.ts` (modified: `InMemoryAccountLookup` returns `currency`, the in-memory repository stores the union), `apps/api/test/movements/create-transfer-exchange.test.ts` (new); `apps/api/test/movements/create-movement.test.ts`, `apps/api/test/movements/record-manual-movement.test.ts` and `apps/api/test/movements/lookups.test.ts` (modified for the union types and the account shape).

**Logic**
`Movement` is `CategorizedMovement` (type `expense` or `income`, with `categoryId`, `rate`, `rateSource`, `rateType`; no destination), `Transfer` (type `transfer`, `destinationAccountId`, `destinationAmount` equal to `amount`; no category and no rate) or `Exchange` (type `exchange`, `destinationAccountId`, `destinationAmount`, `rate`, `rateSource: 'implied'`, `rateType: null`; no category), all with `id`, `ownerId`, `accountId`, `amount`, `occurredAt`, `note`, `createdAt`.
`CreateMovement.execute(scope, input)` keeps the expense and income path unchanged. For a transfer or exchange: (1) read the user's time zone and reject a local date after today with `MovementDateInFuture`; (2) reject identical source and destination ids with `MovementSameAccount`; (3) find both accounts in the caller's scope (a missing or foreign one is a 404 through `ResourceNotFound`); (4) reject `MovementAccountArchived` when either is archived; (5) for a transfer, reject `MovementCurrencyMismatch` when the currencies differ, and store `destinationAmount = amount`; for an exchange, reject `ExchangeSameCurrency` when the currencies are equal, take the ARS amount from the ARS side, call `impliedRate` and reject `ImpliedRateOutOfRange` when it returns `null`; (6) insert with the owner taken from the scope and return the row. Neither branch reads the stored exchange rates (the implied rate is derived from the two amounts). `RecordManualMovement` is unchanged and wraps every type with the shared limiter (D9).

**Input validation**
The use case receives values parsed by the shared schemas; it re-checks the date against today, the two account ids, the currency rules and the implied-rate range.

**Error handling**
- Local date after today in the user's zone: `MovementDateInFuture`, nothing stored.
- Source equal to destination: `MovementSameAccount`, nothing stored.
- Source or destination of another user or unknown: `NOT_FOUND`, nothing stored, no difference between the cases.
- Source or destination archived: `MovementAccountArchived`, nothing stored.
- Transfer between different currencies: `MovementCurrencyMismatch`, nothing stored.
- Exchange between equal currencies: `ExchangeSameCurrency`, nothing stored.
- Implied rate outside 1 to RATE_MAX: `ImpliedRateOutOfRange`, nothing stored.
- The 61st creation in the window across all types: `MovementWriteRateLimited`, nothing stored, the unit refunded.

**Required tests**
- [ ] a transfer between two accounts of the same currency is stored with the owner of the scope, no category, no rate and `destinationAmount` equal to `amount` — validates AC-01
- [ ] a transfer of the same account fails with `MovementSameAccount` and a transfer between an ARS and a USD account fails with `MovementCurrencyMismatch` (reject) — validates AC-02
- [ ] an exchange of 1,557,300.00 ARS out of an ARS account and 1,000.00 USD into a USD account is stored, and the same exchange in the other direction (USD out, ARS in) is stored too — validates AC-03
- [ ] an exchange between two accounts of the same currency fails with `ExchangeSameCurrency` (reject) — validates AC-04
- [ ] the stored implied rate of 1,557,300.00 ARS for 1,000.00 USD is 15,573,000 with source `implied`, and of 2,000.00 ARS for 3.00 USD is 6,666,667 — validates AC-05, AC-14
- [ ] an exchange whose implied rate would be 0 or above RATE_MAX fails with `ImpliedRateOutOfRange` (reject) — validates AC-15
- [ ] a local date after today fails with `MovementDateInFuture` for a transfer and for an exchange (reject), and an instant that is tomorrow in UTC but today in a zone behind UTC is accepted — validates AC-07
- [ ] a source or destination account of another user, or an unknown id, fails as not found (404) and nothing is stored, for a transfer and for an exchange (reject) — validates AC-09
- [ ] a source or a destination account that is archived fails with `ACCOUNT_ARCHIVED` and both work again once unarchived (reject) — validates AC-10
- [ ] amounts above 10^15 and a note above 500 characters never reach storage because the schema rejects them, and the use case does not widen them — validates AC-11, AC-12
- [ ] 30 expenses and 31 transfers or exchanges in one window: the 61st creation fails with `MovementWriteRateLimited`, and a failed creation refunds its unit (error path, 429) — validates AC-13
- [ ] the expense and income cases of 03b still pass with the union types — validates AC-06
- [ ] `CreateMovement` for a transfer or exchange never calls the rate lookup (constructor keys) — validates NFR-03

**Completion criterion**
The listed tests pass against the in-memory fakes; `domain` and `application` import nothing from `infrastructure`; every existing movements unit test passes.

## Block 3 — Persistence: migration 0016, schema and repository

**Files**
- `apps/api/src/movements/infrastructure/db/schema.ts` (modified) — nullable `categoryId`, `rate`, `rateSource`; new `destinationAccountId` and `destinationAmount`; the new checks, key and index.
- `apps/api/drizzle/0016_transfers_exchanges.sql` (new, generated and renamed), `apps/api/drizzle/meta/0016_snapshot.json` (new), `apps/api/drizzle/meta/_journal.json` (modified), `apps/api/drizzle/rollback/0016_transfers_exchanges.down.sql` (new).
- `apps/api/src/movements/infrastructure/db/drizzle-movement-repository.ts` (modified) — inserts and maps the union; the destination key maps to not found.
- `apps/api/src/movements/infrastructure/db/drizzle-account-lookup.ts` (modified) — selects `currency`.
- `apps/api/test/movements/movement-repository.test.ts`, `apps/api/test/movements/schema-introspection.test.ts` (its exact list of foreign keys, indexes and column types), `apps/api/test/movements/db-fixtures.ts`, `apps/api/test/movements/erasure-step.test.ts` and `apps/api/test/perf/movements-seed.ts` (raw inserts and fixtures that must satisfy the new shape check, plus transfer and exchange fixtures) (modified); `apps/api/test/movements/transfer-exchange-repository.test.ts` (new).
- `apps/api/test/identity/migration.test.ts` (modified) — `ALL_MIGRATIONS` goes up by one, every rollback chain that starts with `rollback('0014_movements')` gets `rollback('0016_transfers_exchanges')` in front (about thirty places, plus the `0014_movements migration` block and its journal `idx` assertion), and a new `describe` covers 0016; `apps/api/test/investments/investments-migration.test.ts` (modified) — `LATER_MIGRATIONS` gains `0016_transfers_exchanges`; `apps/api/test/deploy/build-output.test.ts` and `apps/api/test/identity/user-erasure.test.ts` (modified only if they break).

**Data model**
- `movements` changes: `type` check in (`expense`, `income`, `transfer`, `exchange`); `category_id uuid` becomes nullable; `rate bigint` and `rate_source text` become nullable; new `destination_account_id uuid null` and `destination_amount bigint null`; `rate_source` check in (`automatic`, `manual`, `implied`).
- New constraints: `movements_shape_check` (the three shapes of D2); `movements_destination_amount_range_check` (`destination_amount between 1 and 1000000000000000`, null passes); `movements_destination_differs_check` (`destination_account_id <> account_id`, null passes); foreign key `movements_destination_owner_fk (destination_account_id, owner_id) -> accounts (id, owner_id) ON DELETE RESTRICT`.
- New index `movements_destination_idx (destination_account_id)` for the balance adapter and the restrict checks. Existing keys, checks and indexes stay.
- No float, real, double or numeric column; no key to `exchange_rates`.
- The migration is non-destructive: no row is rewritten, every existing row satisfies the new shape check (expense and income with a category, a rate and a source).
- Rollback `0016_transfers_exchanges.down.sql`: deletes the rows of type `transfer` and `exchange`, drops the new constraints, key, index and columns, restores `NOT NULL` on `category_id`, `rate` and `rate_source`, restores the two original checks, and deletes its row from `drizzle.__drizzle_migrations` by `when`. Destructive for transfers and exchanges only (D8); run it as a whole, with the API and the worker stopped, before the rollback of any older migration.
- Journal and numbering per D7: tag `0016_transfers_exchanges`, a `when` greater than 1790980568164 and than any migration on `main` or an open branch, never lowered; CODE checks that the snapshot chains onto 0014's, that a second `drizzle-kit generate` reports no changes and runs `drizzle-kit check`.

**Logic**
The repository inserts the fields of the union by name (a loosely typed caller cannot smuggle id or timestamps), lists and reads with `scopedTo(scope, { owner })`, and maps each row to the right variant by `type`, throwing a programming error for a row whose shape is inconsistent. A foreign-key violation on the account, category or destination key becomes `ResourceNotFound`; any other violation is rethrown. The account lookup returns id, archived state and currency in the same scoped statement.

**Error handling**
- A foreign-key violation of the destination account key on insert (an account deleted between the read and the insert): not found, never a 500 (`asNotFound` learns the new constraint name `movements_destination_owner_fk`).
- A check violation (shape, ranges, same account) cannot come from validated input: it is rethrown as a programming error.
- A row read with an inconsistent shape: a programming error, never returned to the caller.
- A database outage rejects the call; the use case rethrows it.

**Required tests**
- [ ] a transfer and an exchange round-trip through insert, list and get with exact bigint amounts, destination fields and the implied rate — validates AC-01, AC-03, AC-05
- [ ] the list returns transfers and exchanges together with expenses and income, newest first by `occurred_at` then `id` — validates AC-08
- [ ] another owner's transfers and exchanges are never returned by list or get — validates AC-09
- [ ] the database rejects a transfer with a category, with a rate, with a destination amount different from its amount, or without a destination (reject, check violation) — validates FR-01
- [ ] the database rejects an exchange without a rate, with a source other than `implied`, with a category, or with a rate of 0 or above the maximum (reject, check violation) — validates AC-15
- [ ] the database rejects an expense with a destination, an unknown type, a destination equal to the source and a destination amount of 0 or above 10^15 (check violation) — validates AC-11
- [ ] the composite key rejects a destination account of another owner (foreign-key violation) and an insert for a destination deleted between the read and the insert fails as not found, not as a 500 — validates AC-09
- [ ] erasing a user removes the user's transfers and exchanges before the accounts (the ordered erasure step) — validates NFR-04
- [ ] deleting an account that is only the destination of a movement fails with a foreign-key violation and keeps the rows (restrict) — validates FR-04
- [ ] introspection: no float or numeric column, the destination key exists with `RESTRICT` and the owner column, the new columns have the expected nullability — validates NFR-01, NFR-02
- [ ] migration test: 0016 applies on 0014, existing expense and income rows survive, the rollback deletes only transfers and exchanges, restores the old constraints and runs twice without error, and the journal `when` is greater than 07b's `1790980568164` and than every earlier entry (no "newest" claim) — validates NFR-01
- [ ] the existing 03b repository and introspection tests pass with the union and nullable columns — validates AC-06

**Completion criterion**
Repository, introspection and migration tests pass against the migrated test database; `drizzle-kit check` is clean and a second `drizzle-kit generate` reports no changes; every rollback chain in `migration.test.ts` starts with 0016; `build-output.test.ts` and `user-erasure.test.ts` pass.

## Block 4 — Balances and obligations: the real AccountMovements adapter

**Files**
- `apps/api/src/movements/infrastructure/accounts/drizzle-account-movements.ts` (modified) — sums and existence cover the destination side.
- `apps/api/src/accounts/application/ports/account-movements.ts` (modified, doc comment only: the sums include the destination side).
- `apps/api/test/movements/real-adapters.test.ts`, `apps/api/test/movements/totals.test.ts`, `apps/api/test/movements/account-obligations.test.ts`, `apps/api/test/movements/category-obligations.test.ts` (modified for the union types).

**Logic**
`sumsByAccount(ids)` runs, per chunk of at most 500 ids, two grouped statements keyed by the ids it was given: the source side (`+amount` for income, `-amount` for expense, transfer and exchange) grouped by `account_id`, and the destination side (`+destination_amount`) grouped by `destination_account_id`; the two maps are added per account, so an exchange of 1,557,300.00 ARS for 1,000.00 USD lowers the ARS account by 155,730,000 minor units and raises the USD account by 100,000. `hasMovements(accountId)` is true when the account is the source or the destination of any row (`account_id = $1 or destination_account_id = $1`, both indexed). The adapter stays unscoped by design and keyed by the given ids. The Available and Net worth totals of FEAT-003 read the balances, so they follow with no change: a transfer between two included accounts of one currency leaves Available unchanged, and an exchange moves the totals by the difference of the two sides.

**Error handling**
- An id absent from the map means zero, as before.
- A database failure rejects the call; the accounts use cases rethrow it.

**Required tests**
- [ ] after a transfer the source balance drops and the destination balance rises by the amount, and an account with no movements is zero — validates AC-06
- [ ] after an exchange the ARS account drops by the ARS amount and the USD account rises by the USD amount — validates AC-06
- [ ] sums over more than 500 ids work in chunks and only the given ids are keyed — validates NFR-04
- [ ] an account that is only a destination reports movements, so deleting it answers the existing `AccountHasMovements` (reject, conflict) — validates FR-04
- [ ] the totals test: a transfer between an included and a non-included account changes Available by the amount, and an exchange changes Net worth only by the difference between the two sides — validates AC-06
- [ ] the 03b balance, obligation and totals tests pass unchanged — validates AC-06

**Completion criterion**
The adapter and totals tests pass; the accounts balance performance test of 03b (100 accounts, 100,000 movements) is re-run with a share of transfers and exchanges and its threshold still holds.

## Block 5 — HTTP and composition

**Files**
- `apps/api/src/movements/infrastructure/http/movement-routes.ts` (modified) — the body union goes to the use case input; one pure mapper per type.
- `apps/api/src/movements/infrastructure/http/movement-presenter.ts` (modified) — the new nullable fields.
- `apps/api/src/shared/http/error-handler.ts` (modified) — `STATUS_BY_CODE` is exhaustive over `ErrorCode`, so the four new codes map to 400 or typecheck fails.
- `apps/api/test/movements/movement-routes.test.ts` (modified), `apps/api/test/movements/transfer-exchange-routes.test.ts` (new), `apps/api/test/foundation/error-handler.test.ts` (modified).

**API contract**
- `POST /movements` — request body is the union of Block 1; response 201 with the movement (flat object; for a transfer `categoryId`, `rate`, `rateSource` and `rateType` are `null`, `destinationAccountId` and `destinationAmount` are set; for an exchange `rate` is the implied rate, `rateSource` is `implied`, `categoryId` and `rateType` are `null`); errors: 400 `VALIDATION_FAILED` (with field paths), 400 `MOVEMENT_DATE_IN_FUTURE`, 400 `MOVEMENT_SAME_ACCOUNT`, 400 `MOVEMENT_CURRENCY_MISMATCH`, 400 `EXCHANGE_SAME_CURRENCY`, 400 `IMPLIED_RATE_OUT_OF_RANGE`, 401 `UNAUTHENTICATED`, 403 `EMAIL_NOT_VERIFIED`, 404 `NOT_FOUND` (an account not the caller's, or unknown), 409 `ACCOUNT_ARCHIVED`, 429 `RATE_LIMITED` with a `Retry-After` header; the 03b codes for expense and income stay.
- `GET /movements` and `GET /movements/:id` — unchanged contract; items may now be transfers and exchanges with the nullable fields; errors as in 03b.
- Auth: `requireSession` then `requireVerifiedEmail` on the `/movements` prefix; the owner always comes from the session.

**Logic**
The route validates the union with the shared `validate` middleware, maps the parsed body to the use case input by `type`, calls `RecordManualMovement` with write scope, logs only the request id, user id and movement id, and answers through `presentMovement`, which is the only place where bigint becomes a string and the nullable fields become `null`. The error handler maps the four new codes to 400.

**Input validation**
Params, query and body go through the shared Zod schemas of Block 1; unknown keys are stripped; the response is validated by the shared response schema.

**Error handling**
- Every failure answers `{ code }` (plus `fields` for validation) through the shared error handler; no SQL or stack reaches the body.
- The four new codes answer 400; archived source or destination answers 409; the limit answers 429 with `Retry-After`; an unknown or foreign account answers 404.
- A missing or malformed `destinationAmount` or `destinationAccountId` answers 400 `VALIDATION_FAILED`.

**Required tests**
- [ ] a verified user saves a transfer and an exchange and both appear in the list newest first together with an expense and an income — validates AC-01, AC-03, AC-08
- [ ] an exchange of 1,557,300.00 ARS for 1,000.00 USD answers 201 with rate 15573000 and source `implied`, and 2,000.00 ARS for 3.00 USD answers 6666667; a `rate` or a `rateSource` sent by the client on an exchange or a transfer is ignored and the stored values are the derived ones (or none) — validates AC-05, AC-14
- [ ] a transfer of the same account, a transfer between currencies and an exchange between equal currencies answer 400 `MOVEMENT_SAME_ACCOUNT`, `MOVEMENT_CURRENCY_MISMATCH` and `EXCHANGE_SAME_CURRENCY` and store nothing — validates AC-02, AC-04
- [ ] an exchange whose implied rate is out of range answers 400 `IMPLIED_RATE_OUT_OF_RANGE` and stores nothing — validates AC-15
- [ ] after a transfer and an exchange the account balances change by the source and destination amounts — validates AC-06
- [ ] a local date after today answers 400 `MOVEMENT_DATE_IN_FUTURE` for a transfer and an exchange — validates AC-07
- [ ] a source or destination account of another user answers 404 `NOT_FOUND`, stores nothing and the other user's account stays untouched — validates AC-09
- [ ] a source or destination that is archived answers 409 `ACCOUNT_ARCHIVED` and nothing is stored; both work after unarchiving — validates AC-10
- [ ] an amount above 10^15 and a note above 500 characters answer 400 `VALIDATION_FAILED` naming the field — validates AC-11, AC-12
- [ ] 30 expenses and 31 transfers or exchanges within one minute: the 61st answers 429 `RATE_LIMITED` with `Retry-After` and stores nothing, and the next minute accepts again (injected clock) — validates AC-13
- [ ] a missing `destinationAmount` on an exchange answers 400 `VALIDATION_FAILED` naming `body.destinationAmount` (invalid input) — validates FR-02
- [ ] every route answers 401 without a session and 403 without a verified email, and a state-changing request without the origin headers answers 403 — error path
- [ ] a database failure answers 500 `INTERNAL` with only `{ code }` — error path
- [ ] the error handler maps each new code to 400 — error path
- [ ] the 03b route tests for expense and income pass unchanged — validates AC-06

**Completion criterion**
Route and error-handler tests pass; the existing movements, accounts and categories suites pass.

## Block 6 — Web client and the entry screen

**Files**
- `apps/web/src/lib/api-client.ts` (modified) — `ApiErrorKey` and `MESSAGE_KEY_BY_CODE` gain the four new codes; `createMovement` and the response types follow the shared union.
- `apps/web/src/features/movements/components/movement-form.tsx` (modified) — the four-way type switch, the destination picker, the second amount and the implied-rate preview.
- `apps/web/src/features/movements/components/movement-saved.tsx` (modified) — shows the frozen rate for an expense, income or exchange and no rate for a transfer.
- `apps/web/src/features/movements/containers/create-movement-container.tsx` (modified) — builds the request per type through the new pure helper.
- `apps/web/src/features/movements/movement-request.ts` (new) — pure validation and request building per type.
- `apps/web/src/features/movements/implied-rate-preview.ts` (new) — display-only preview using the shared `impliedRate`.
- `apps/web/src/features/movements/movement-form-errors.ts` (modified) — `MovementFieldMessage` and `movementFailureErrors` gain the new codes on the right field.
- `apps/web/src/features/movements/components/rate-field.tsx` (modified only if the exchange preview reuses it).
- `apps/web/messages/es.json`, `apps/web/messages/en.json` (modified) — `movements.types`, `movements.fields`, `movements.errors`, `errors.*` for each new code and the preview text.
- `apps/web/test/movements-components.test.tsx`, `apps/web/test/movements-containers.test.tsx`, `apps/web/test/api-client-movements.test.ts`, `apps/web/test/i18n-catalogs.test.ts` (modified).

**Logic**
The type switch offers expense, income, transfer and exchange. For a transfer the screen shows source account, destination account (only the user's non-archived accounts of the source's currency, other than the source), amount, date and note; there is no category and no rate field. For an exchange it shows source account, destination account (only accounts of the other currency), the amount that leaves the source, the amount that enters the destination, date and note; a read-only line shows the implied rate computed with the shared helper and formatted with the locale (empty until both amounts are valid, and a message when it falls outside the allowed range). Expense and income behave as in 03b. The request carries `accountId`, `destinationAccountId` and the amounts as integer strings; the rate of an exchange is never sent (the API computes and freezes it). After saving, the saved view shows the implied rate of an exchange as returned by the API. All strings come from the catalogs, amounts and rates use the locale formatters, colors and spacing come from theme tokens, and presentational components fetch nothing.

**Input validation**
`movement-request.ts` validates before sending: the amount fields through `parseAmountInput` (positive, up to 2 decimals, at most 10^15 minor units), required source and destination, a destination different from the source, the currency rule per type, a local date that is not after today (same helpers as 03b), a note of at most 500 characters. The first invalid field is focused and each field shows its own message; nothing is sent while a field is invalid.

**Error handling**
- A 401 redirects to sign in; `MOVEMENT_SAME_ACCOUNT`, `MOVEMENT_CURRENCY_MISMATCH`, `EXCHANGE_SAME_CURRENCY` and `IMPLIED_RATE_OUT_OF_RANGE` show their message on the destination account or amount field; `ACCOUNT_ARCHIVED` shows the unarchive-first message on the account field that was chosen; `RATE_LIMITED` shows the too-many-requests message with the seconds from `Retry-After`; `MOVEMENT_DATE_IN_FUTURE` shows its message on the date; any other failure shows the generic message with a retry.
- When the user has fewer than two usable accounts of the needed currencies, the destination picker shows a hint instead of an empty list.

**Required tests**
- [ ] choosing transfer hides category and rate, lists as destination only the user's other active accounts of the same currency and sends `type: 'transfer'` with both account ids and the amount — validates AC-01, AC-02
- [ ] choosing exchange lists as destination only accounts of the other currency, shows two amount fields and sends no rate — validates AC-03, AC-04
- [ ] the preview shows 1,557.3000 for 1,557,300.00 ARS and 1,000.00 USD and 666.6667 for 2,000.00 ARS and 3.00 USD, and shows the range message when the rate would be out of range — validates AC-05, AC-14, AC-15
- [ ] a destination equal to the source, an amount of 0, an amount above 10^15 and a note above 500 characters are rejected on the client with no request (invalid input) — validates AC-02, AC-11, AC-12
- [ ] a later local date is rejected on the client with no request (invalid input) — validates AC-07
- [ ] the server codes for same account, currency mismatch, same currency and rate out of range show their message on the right field (error path) — validates AC-02, AC-04, AC-15
- [ ] `ACCOUNT_ARCHIVED` shows the unarchive-first message and `RATE_LIMITED` shows the too-many-requests message with the seconds from `Retry-After` (error path) — validates AC-10, AC-13
- [ ] the saved view shows the implied rate of an exchange and no rate for a transfer — validates AC-05
- [ ] a 401 redirects to sign in and a server error shows the generic message with retry (error path) — validates AC-01
- [ ] both catalogs have the same keys and every new error code maps to a message key — validates AC-02, AC-04, AC-15
- [ ] the expense and income screen tests of 03b pass unchanged — validates AC-06

**Completion criterion**
Web tests pass, `pnpm typecheck` and `pnpm lint` pass, the Spanish and English catalogs have the same keys, and no hardcoded user-visible string exists in the new components.

## Block 7 — The movements list shows transfers and exchanges

**Files**
- `apps/web/src/features/movements/components/movement-row.tsx` (modified) — a transfer and an exchange row.
- `apps/web/src/features/movements/components/movement-list.tsx` (modified) — passes the destination account.
- `apps/web/src/features/movements/containers/movements-container.tsx` (modified) — resolves the destination account name and currency from the loaded sets.
- `apps/web/messages/es.json`, `apps/web/messages/en.json` (modified) — `movements.list` row labels.
- `apps/web/test/movements-list.test.tsx` (modified).

**Logic**
A transfer row shows the title "Transfer", the source and destination account names, the amount leaving the source with its currency and the date and time in the user's zone. An exchange row shows the title "Exchange", the two account names, "-X" in the source currency and "+Y" in the destination currency, and its implied rate (always shown on an exchange row, because the rate is the point of the movement; the 03b rule of hiding the rate on ARS-account rows applies only to expense and income). Expense and income rows are unchanged. A destination account missing from the loaded sets (both active and archived accounts are loaded) shows the neutral placeholder name. The list order is the API's order.

**Input validation**
The only input is the page offset derived from the rows already shown and the total, as in 03b.

**Error handling**
- A 401 redirects to sign in; any other failure while loading shows the generic message with a retry and keeps the rows already shown.
- A movement whose account or destination account is missing from the loaded sets shows a placeholder instead of failing.

**Required tests**
- [ ] the list shows a transfer and an exchange newest first among expenses and income, with both account names and the right currencies — validates AC-08
- [ ] an exchange row shows the implied rate and an ARS-account expense row still hides the rate — validates AC-05, AC-08
- [ ] a transfer whose destination account is archived shows its name — validates AC-08
- [ ] a destination account id missing from the loaded sets shows the placeholder and does not fail (error path) — validates AC-08
- [ ] a 401 redirects to sign in and a server error shows the generic message with retry and keeps the rows (error path) — validates AC-08

**Completion criterion**
Web tests pass, `pnpm typecheck` and `pnpm lint` pass and the catalogs keep the same keys.

## Block 8 — End-to-end flow, performance and cross-cutting scans

**Files**
- `apps/web/e2e/movements.spec.ts` and `apps/web/e2e/support/database.ts` (modified) — transfer and exchange flows; the helper types of stored movements carry the nullable `rate`, `rate_source` and the destination fields.
- `apps/api/test/perf/movements-save.perf.test.ts` (modified) — latency of a transfer and an exchange; the accounts balance performance test is re-run in Block 4 with `apps/api/test/perf/movements-seed.ts`.
- `apps/api/test/movements/no-float-money.test.ts` (modified; it already covers `apps/api/src/movements` and `packages/shared/src/movements`, so `implied-rate.ts` is scanned), `apps/web/test/no-float-money.test.ts` (modified; today it scans only `features/investments` and `format-amount.ts`, so it gains `features/movements/movement-request.ts` and `implied-rate-preview.ts`), `apps/api/test/movements/request-path.test.ts` (modified).
- `apps/api/test/foundation/architecture-boundaries.test.ts` (modified only if the new files need a probe).

**Logic**
The end-to-end flow registers and verifies a user, creates two ARS accounts and one USD account with opening balances, records a transfer between the two ARS accounts, records an exchange of ARS for USD, and checks the list order, the three balances and the implied rate shown; it then tries a transfer between an ARS and a USD account and an exchange between two ARS accounts and sees the field messages. The performance test saves transfers and exchanges with the same sample size and warm-up as the accounts performance test and asserts p95 under 300 ms server-side. The no-float scan covers `apps/api/src/movements`, `packages/shared/src/movements` (including `implied-rate.ts`) and the new web files for `parseFloat`, `Number(`, `.toFixed`, `Math.round` and money identifiers annotated as numbers; the request-path scan keeps asserting that the module imports no provider, job or exchange-rates barrel.

**Input validation**
The end-to-end flow fills the entry screen with valid values, with an amount of 0, with a same-currency exchange and with a cross-currency transfer, to see the field messages.

**Error handling**
- The flow fails on any console error or API status of 400 or above that it did not provoke on purpose.
- A failed scan names the file and the offending token.

**Required tests**
- [ ] the flow records a transfer and an exchange, shows them in the list with the implied rate, and shows the three balances correctly — validates AC-01, AC-03, AC-05, AC-06, AC-08
- [ ] the flow refuses a transfer between currencies and an exchange between equal currencies with their messages (error path) — validates AC-02, AC-04
- [ ] a transfer or exchange dated tomorrow is refused with the date message (error path) — validates AC-07
- [ ] another user's account id sent by API on a transfer answers 404 and the e2e user's balances do not change (error path) — validates AC-09
- [ ] the performance test shows p95 under 300 ms for saving a transfer and for saving an exchange — validates NFR-03
- [ ] the no-float scan passes on the module and fails on probe strings in `implied-rate.ts` and the new web files — validates NFR-01, NFR-02
- [ ] the request-path scan passes on the module and still fails on probe strings importing the provider, the job or the barrel — validates NFR-04
- [ ] the whole API, shared and web suites and the e2e suite pass with the new migration, columns, routes and screens — validates FR-06

**Completion criterion**
`pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm test:perf` and `pnpm e2e` pass; the migration count and journal checks include 0016; coverage stays at or above the floor.

## Final verification
- FR-01 and FR-02: a transfer between two accounts of the same currency and a currency exchange between an ARS and a USD account can be saved through the API and the web screens.
- FR-03: every exchange stores its implied rate, rounded half-up, as a scaled integer.
- FR-04: balances and the Available and Net worth totals count the source and the destination sides.
- FR-05, FR-07, FR-08 and FR-09: future dates, archived accounts, amounts above 10^15, long notes and the 61st creation in a minute are refused.
- FR-06: transfers and exchanges appear in the movement list with expenses and income, newest first.
- NFR-01 to NFR-04: bigint everywhere, no float, p95 under 300 ms, every query filtered by the owner.
- Merge gate: before the merge, re-check the migration number and the journal `when` against `main`, 07b and 03d, renumber and re-chain the snapshot if needed, and run `drizzle-kit check` and the migration tests (D7).
- Rollback: stop the API and the worker, run `apps/api/drizzle/rollback/0016_transfers_exchanges.down.sql` as a whole (destructive for transfers and exchanges only) and revert the commits; expense and income keep working.
- No question is open: Q1 and Q2 are resolved by the human decisions of 2026-10-02.

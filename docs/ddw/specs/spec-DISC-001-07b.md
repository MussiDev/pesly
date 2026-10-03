# Spec DISC-001-07b: Crypto Prices and Daily Portfolio Snapshots

| Field | Value |
|-------|-------|
| Ticket | DISC-001-07b |
| PRD | docs/ddw/prd/prd-DISC-001-07b.md |
| Tier | FEATURE |
| Date | 2026-10-02 |
| Spec loops | 3 |
| Loops since last human decision | 0 |

## Summary
Adds two background jobs to the `investments` module, both run only by the worker process, never by the
API, plus a small read-side and web change that surfaces the market price of manually priced crypto.
The price job refreshes the USD price of every crypto holding from CoinGecko through a
`PriceProvider` port with one real adapter and one fake: one request to the Demo plan's markets
route per hour for up to 100 distinct ticker symbols (a ticker is matched as a CoinGecko symbol, the
top-ranked coin per symbol; owner decision), and the JSON price is turned into whole US cents from its
source text (never through a float). Each answered price is stored in its own `crypto_market_prices`
row (one per symbol, not user data) and, in the same transaction, copied onto every crypto holding of
that symbol that does not carry a manual price, with source `automatic` and the price's time. A manual
price is never replaced (owner decision, FR-04): the market price of that symbol is still stored, and the
holding response carries it with a server-computed flag that is true when the price is manual, the
market price exists and the two differ by more than 5% of the manual price, whatever the age of the market price
(a second server flag says whether it is at most 24 hours old). The web
shows a warning with the market price, worded "today" for a recent price and "on <date>" for an older one, and a button that calls a new endpoint to switch the holding back
to the automatic price. A symbol the provider does not return, or whose price rounds to less than one
cent, keeps its previous prices. The jobs follow the exchange-rates job of DISC-001-03a: a single
schedule row claimed with an atomic upsert that doubles as a lease, an outcome type with no thrown
provider errors, and a failure log purged after 30 days. A persisted monthly counter reserves one call
before each request and refuses the 1,001st, so the Demo plan's 10,000-call allowance is never
approached (NFR-01 asks for at most 1,000 per month). The snapshot job polls every 5 minutes: for every
time zone in use it computes the user's local date from the clock, and for each portfolio with at least
one priced holding and no snapshot for yesterday's local date it stores the total value per currency
(computed with the shared `holdingValue` and `totalsByCurrency` helpers) in one insert that is
idempotent, so any number of workers can run; a total above the 64-bit limit skips that portfolio's
snapshot, is logged and never stops the pass. Block 1 holds the pure domain, Block 2 the ports and use
cases, Block 3 the persistence (migration `0015`, provisional), Block 4 the provider adapters and the
worker environment, Block 5 the jobs and the worker wiring, Block 6 the market price in the holding
response and the switch endpoint, Block 7 the web warning and action, Block 8 the cross-cutting checks
and an end-to-end step.

Design choices the PRD leaves to the spec (technical, all decided in the PRD decision log or recorded
here): the ticker is the CoinGecko symbol (owner decision, risk accepted); unit prices keep the existing
minor-unit scale of 07a, so a price is rounded half up to the cent and a coin worth less than one cent
cannot be auto-priced (owner decision; a finer scale is a follow-up in the parent index); the 5% is
measured against the manual price and exactly 5% gives no warning; the warning is never hidden because of the age of the market price (owner decision), and the 24-hour wording rule is a server flag, like 07a's stale price flag; the switch endpoint is a `POST` without a body that rejects a holding that is not crypto
or has no stored market price; a rejection reuses the existing 400 validation error naming the field
`body.marketPrice` (no new error code); only the latest local day is snapshotted after downtime
(history cannot be reconstructed); a portfolio with no priced holding gets no snapshot row, like it shows
no total; retries back off from 15 to 60 minutes; an answer entry older than 24 hours is ignored; a request
carries at most 100 symbols, the least recently priced first (by the stored market price time).

## Coverage: PRD → blocks
| Requirement | Covered by |
|---|---|
| FR-01 | Block 1, Block 2, Block 3, Block 4, Block 5, Block 8 |
| FR-02 | Block 1, Block 2, Block 3, Block 5, Block 8 |
| FR-03 | Block 2, Block 3, Block 8 |
| FR-04 | Block 2, Block 3, Block 8 |
| FR-05 | Block 6, Block 7, Block 8 |
| FR-06 | Block 6, Block 7, Block 8 |
| NFR-01 | Strategy: one provider request per refresh cycle every 60 minutes (720 a month) for at most 100 symbols, and a persisted monthly counter (`crypto_price_usage`) that reserves one call before every request, failed attempts included, and refuses past 1,000; the schedule row, the retry backoff (15, 30, then 60 minutes) after consecutive failures and the 5-minute lease keep an outage from burning the budget; Block 2 tests simulate 45 days of hourly cycles and an outage and assert the counter never exceeds 1,000. |
| NFR-02 | Strategy: `COINGECKO_API_KEY` is optional in the worker settings (Block 4), the adapter sends the key header only when a key is set, and the worker logs once that it runs without one; Block 4 settings tests and the Block 5 jobs composition test start the worker side with no key and assert no failure. |

## Dependencies between blocks
Block 2 depends on Block 1. Block 3 depends on Blocks 1 and 2 (it implements the ports declared in
Block 2). Block 4 depends on Blocks 1 and 2. Block 5 depends on Blocks 2, 3 and 4. Block 6 depends on
Block 3 (the market price reader and the stored prices). Block 7 depends on Block 6 (the response fields
and the endpoint). Block 8 depends on Blocks 3, 4, 5, 6 and 7. Execution order: 1, 2, 3, 4, 5, 6, 7, 8.

## Block 1 — Domain: price conversion, snapshot dates and provider failures

**Files**
- `apps/api/src/investments/domain/crypto-price.ts` (new) — `PriceQuote` and `usdPriceToMinorUnits`.
- `apps/api/src/investments/domain/snapshot-date.ts` (new) — `localDateOf` and `previousDate`.
- `apps/api/src/investments/domain/price-failure.ts` (new) — `PriceProviderFailure` and its codes.

**Logic**
- `PriceQuote` is `{ symbol: string; unitPrice: bigint }`: the lowercase symbol and the price in US cents.
- The sources avoid every token of the existing no-float scan (`parseFloat`, `parseInt`, `Number(`, `toFixed`, `Math.round`, `Math.floor`, which also matches `toNumber(`): digits are handled as strings and `BigInt`, and the year, month and day of a zone date are taken as strings from `Intl.DateTimeFormat` parts and shifted with `BigInt` arithmetic.
- `usdPriceToMinorUnits(text)` takes the JSON number as its source text and returns whole cents rounded half up, or `null` when the text is not a plain decimal or an exponent form, is not above zero, rounds to less than 1 cent (a coin worth less than one cent cannot be priced), or exceeds the unit price limit of 10^12 minor units. It works on the digits and the exponent with `BigInt`: no `parseFloat`, no `Number`, so `0.1 + 0.2` style errors cannot occur (FR-01, NFR-01 of 07a).
- `localDateOf(now, timeZone)` returns the `YYYY-MM-DD` of `now` in the IANA zone through `Intl.DateTimeFormat` parts; an unknown zone raises `RangeError`. `previousDate(date)` returns the calendar day before, by integer arithmetic on year, month and day, including month and year boundaries and leap years (FR-02).
- `PriceProviderFailure` carries a code in `provider_unreachable`, `provider_timeout`, `provider_bad_status`, `provider_rate_limited` and `provider_invalid_payload`, an optional status code and an optional short detail; it never carries provider text.

**Input validation**
- The price text is parsed with a strict grammar `^[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]+)?$` capped at 40 characters; anything else returns `null` and never throws.
- The time zone string is whatever the user's stored zone is; an invalid one raises `RangeError`, handled by the caller.

**Error handling**
- Unusable price text (empty, not a number, zero, negative, below one cent, above the limit) returns `null`, which the caller treats as "no price for that symbol".
- An invalid time zone raises `RangeError`, which the snapshot use case catches per zone and counts.
- The provider failure type is the only error a provider adapter may raise for a provider fault.

**Required tests**
- [ ] `apps/api/test/investments/crypto-price.test.ts` — `usdPriceToMinorUnits('67890.1234')` is 6789012 cents, `'0.5'` is 50 and `'1.5e3'` is 150000 — validates AC-01.
- [ ] `apps/api/test/investments/crypto-price.test.ts` — half-up rounding at the cent (`'0.005'` is 1, `'0.0049'` is null); a sub-cent price such as `'0.000007'` or `'1.2e-7'` is null (error: no usable price, previous price kept) — validates AC-02.
- [ ] `apps/api/test/investments/crypto-price.test.ts` — invalid text (`''`, `'abc'`, `'-1'`, `'0'`, `'1e'`, `'NaN'`, a 41-character string) and a price above the 10^12 minor-unit limit all return null without throwing (invalid input).
- [ ] `apps/api/test/investments/snapshot-date.test.ts` — the same instant is 2026-03-01 in Buenos Aires and 2026-03-02 in UTC around local midnight; `previousDate` crosses a month, a year and a leap day correctly — validates AC-03.
- [ ] `apps/api/test/investments/snapshot-date.test.ts` — an unknown zone raises `RangeError` (invalid zone).
- [ ] `apps/api/test/investments/no-float-money.test.ts` — the existing scan of `apps/api/src/investments` also covers the three new files (no `parseFloat`, `Number(`, `Math.round` and the like) — validates NFR-01.

**Completion criterion**
`pnpm --filter @pesly/api exec vitest run test/investments/crypto-price.test.ts test/investments/snapshot-date.test.ts test/investments/no-float-money.test.ts` passes and `pnpm typecheck` passes.

## Block 2 — Application: ports and use cases

**Files**
- `apps/api/src/investments/application/price-ports.ts` (new) — `PriceProvider`, `PriceSchedule`, `CryptoPriceRepository`, `PriceFailureLog`, `SnapshotRepository`.
- `apps/api/src/investments/application/refresh-crypto-prices.ts` (new) — the `RefreshCryptoPrices` use case and its constants.
- `apps/api/src/investments/application/take-daily-snapshots.ts` (new) — the `TakeDailySnapshots` use case.

**Logic**
- The use cases take the module's existing `Clock` port from `application/ports.ts`; no second clock is declared.
- Constants: refresh every 3,600,000 ms, retry after a failure 900,000 ms, doubling with each consecutive failure up to the 3,600,000 ms interval (15, 30, 60 minutes), lease 300,000 ms, monthly limit 1,000 calls, at most 100 symbols per call, snapshot pass over pages of 200 portfolios.
- `PriceProvider.fetchPrices(symbols)` returns `PriceQuote[]` for the symbols it priced; faults surface as `PriceProviderFailure`.
- `CryptoPriceRepository` has two operations: `symbolsToPrice(limit)` and `storeAndApply(quotes, requestedAt)`, which returns `{ markets, holdings }`, the number of market prices stored and the number of holdings that received an automatic price.
- `RefreshCryptoPrices.execute()` returns `not_due`, `no_crypto_holdings`, `budget_exhausted`, `refreshed { markets, updated, unpriced }` or `failed { code }`: it claims the schedule (an atomic lease, `not_due` when another worker holds it or it is not due), reads the distinct crypto symbols of every crypto holding, manually priced ones included (least recently priced first, at most 100), returns `no_crypto_holdings` after rescheduling when there are none, reserves one call from the monthly counter before the request (`budget_exhausted` and a reschedule one interval later when 1,000 are used), calls the provider, and hands the quotes and the time the request started to `storeAndApply` (FR-01, FR-03). That operation stores each market price (a price older than the one already stored never replaces it) and applies it to the holdings of the answered symbols that carry no manual price and whose latest price is older than the market price, so a manual price is never replaced (FR-04), including one set while the request was in flight. A symbol the provider did not return, or priced below one cent, is left untouched, which keeps its previous prices (AC-02). A provider fault is recorded in the failure log, the schedule is moved ahead by the backoff of its consecutive failures (15, 30, 60 minutes), and the outcome is `failed`; a storage error propagates and the lease expiry retries.
- `TakeDailySnapshots.execute(now)`: for each time zone in use it computes `previousDate(localDateOf(now, zone))` (a zone that raises `RangeError` is skipped and counted), then walks the portfolios of that zone that have a priced holding and no snapshot for that date, in pages by portfolio id, skips a portfolio created after that local date (judged in JavaScript with `localDateOf` of its creation time), computes `totalsByCurrency` over their priced holdings with the shared helpers, and saves one row per currency in a single idempotent insert (FR-02, AC-03). A total above 2^63 - 1 skips that portfolio's snapshot for the day, counts it and reports it to the caller for logging, and the pass continues with the other portfolios (AC-04). It returns `{ saved, skippedOutOfRange, skippedZones }`.

**Input validation**
- Symbols come from stored tickers and are lowercased by the repository before the call; the use cases validate nothing else because they take no request data.

**Error handling**
- Provider fault: recorded with its code, schedule moved ahead by the backoff, outcome `failed`, previous prices untouched.
- Monthly budget used up: no provider call is made, outcome `budget_exhausted`.
- Invalid time zone: the zone is skipped and counted, other zones continue.
- A snapshot total out of the storable range: no row is written for that portfolio, it is counted and the other portfolios are still snapshotted.
- Storage errors propagate to the job, which logs them and tries again on the next pass.

**Required tests**
- [ ] `apps/api/test/investments/refresh-crypto-prices.test.ts` — with a fake provider answering btc and eth, every crypto holding of those symbols without a manual price gets the price, source `automatic` and the market price time, other instrument types are untouched — validates AC-01.
- [ ] `apps/api/test/investments/refresh-crypto-prices.test.ts` — a crypto holding with a manual price of 60,000.00 USD keeps that price and source `manual` after a successful refresh while the new market price of its ticker is stored, and a holding without any price receives the automatic one — validates AC-05.
- [ ] `apps/api/test/investments/refresh-crypto-prices.test.ts` — a provider failure (error) leaves every price as it was, records the code, moves the schedule 15 minutes ahead (30 after a second consecutive failure) and returns `failed`; a symbol missing from the answer and a sub-cent price keep the previous price — validates AC-02.
- [ ] `apps/api/test/investments/refresh-crypto-prices.test.ts` — two concurrent executions produce one provider call (the second is `not_due`); a second call before the interval is `not_due`; no crypto holdings reschedules without a call (duplicate claim, conflict).
- [ ] `apps/api/test/investments/refresh-crypto-prices.test.ts` — over 45 simulated days of hourly cycles plus a 3-day outage with 15-minute retries the reserved calls never exceed 1,000 in a calendar month and the 1,001st attempt returns `budget_exhausted` with no call (error: budget used up) — validates NFR-01.
- [ ] `apps/api/test/investments/take-daily-snapshots.test.ts` — a user in Buenos Aires and a user in UTC get their snapshot for their own previous local day at different instants, with the totals of the shared helpers (185,000.00 ARS and 500.00 USD) — validates AC-03.
- [ ] `apps/api/test/investments/take-daily-snapshots.test.ts` — running the use case twice for the same day writes one set of rows (duplicate run); a portfolio without priced holdings gets no row; a zone that raises `RangeError` is skipped and counted (invalid zone).
- [ ] `apps/api/test/investments/take-daily-snapshots.test.ts` — a portfolio total above 9,223,372,036,854,775,807 minor units is skipped and counted (error: out of range) while the snapshots of the other portfolios of the same pass are saved — validates AC-04.

**Completion criterion**
`pnpm --filter @pesly/api exec vitest run test/investments/refresh-crypto-prices.test.ts test/investments/take-daily-snapshots.test.ts` passes with in-memory fakes and `pnpm typecheck` passes.

## Block 3 — Persistence: migration 0015, repositories and erasure registry

**Files**
- `apps/api/src/investments/infrastructure/db/schema.ts` (modified) — the five new tables, defined in the existing file because `drizzle.config.ts` only globs `./src/*/infrastructure/db/schema.ts`.
- `apps/api/src/investments/infrastructure/db/drizzle-crypto-price-repository.ts` (new) — the worker side: distinct crypto symbols and the two-statement `storeAndApply` transaction.
- `apps/api/src/investments/infrastructure/db/drizzle-market-price-reader.ts` (new) — the API side: a read-only lookup of stored market prices by symbol, a separate file so the API process never imports the worker repository.
- `apps/api/src/investments/infrastructure/db/drizzle-price-schedule.ts` (new) — claim, success, failure and the monthly reservation.
- `apps/api/src/investments/infrastructure/db/drizzle-price-failure-log.ts` (new) — record and purge.
- `apps/api/src/investments/infrastructure/db/drizzle-snapshot-repository.ts` (new) — zones, portfolios to snapshot, idempotent save.
- `apps/api/drizzle/0015_price_snapshots.sql` (new, generated by `pnpm --filter @pesly/api exec drizzle-kit generate --name price_snapshots` after rebasing in CODE, provisional number: it takes the next free number then), its snapshot in `apps/api/drizzle/meta/`, the `apps/api/drizzle/meta/_journal.json` entry (modified), and `apps/api/drizzle/rollback/0015_price_snapshots.down.sql` (new).
- `apps/api/test/identity/user-erasure.test.ts` (modified) — the snapshot table in the erasure registry; `apps/api/test/identity/deletion-persistence.test.ts` (modified) — the snapshot row count in its erasure assertions. The market price table has no foreign key to users, so it is deliberately not registered (the guard fails for a registered table that is not reachable from users).
- `apps/api/test/identity/migration.test.ts`, `apps/api/test/investments/investments-migration.test.ts` and `apps/api/test/deploy/build-output.test.ts` (modified) — the new migration in the rollback chains and the expected table lists (`ALL_TABLES` gains the five new tables). Both migration tests encode newest-first rollback by journal `when` (drizzle only re-applies migrations newer than the last recorded one), so the new migration's rollback goes first in every chain, and the test of the older `0013_investments` migration rolls back the newer one before its own; none of them asserts that a migration is the newest, only the order relative to known predecessors.

**Logic**
- The price and snapshot repositories act on every user's rows by design (a worker, not a request): this is the one deliberate exception to owner-scoped queries (the jobs act on every user's holdings and portfolios at once, never for a request), so they are exported only through `apps/api/src/investments/jobs.ts`, never through the module barrel, and raw SQL is used where the ORM cannot express the statement (a comment states why). The market price reader touches no user data and is the only price repository the barrel imports. The rollback script drops the five tables and deletes its row from `drizzle.__drizzle_migrations` by the journal `when`, like the 0013 script, with a header stating what is destroyed.
- Migration number note: `0015` is provisional; main's last migration is 0013 and DISC-001-03b takes 0014. The migration is generated in CODE after rebasing, takes the next free number, and its journal `when` must be greater than every other `when` in the journal at push time; the tests never assert that it is the newest, only its order relative to known predecessors. A migration collision is resolved by whichever ticket merges later.
- `storeAndApply` runs two statements in one transaction (read committed). First `INSERT INTO crypto_market_prices (symbol, unit_price, priced_at) VALUES (...) ON CONFLICT (symbol) DO UPDATE SET unit_price = EXCLUDED.unit_price, priced_at = EXCLUDED.priced_at WHERE crypto_market_prices.priced_at < EXCLUDED.priced_at`. Then `UPDATE holdings h SET unit_price = m.unit_price, price_source = 'automatic', priced_at = m.priced_at, updated_at = now FROM crypto_market_prices m WHERE h.instrument_type = 'crypto' AND h.valuation_currency = 'USD' AND lower(h.ticker) = m.symbol AND m.symbol IN (the answered symbols) AND h.price_source IS DISTINCT FROM 'manual' AND (h.priced_at IS NULL OR h.priced_at < m.priced_at)` (every column of both relations is qualified, because both carry `unit_price` and `priced_at`). Every value is a bound parameter and the price is cast to `bigint`; the second statement reads the stored table, not only the rows the first one changed, so a holding added after the market price was stored, or whose price was cleared, also gets the stored price. Because the manual check is evaluated against the row at update time, a manual price committed while the statement waits on the row lock is kept (FR-04). The operation returns the number of rows each statement affected.
- The symbol read joins the crypto holdings to `crypto_market_prices` (`LEFT JOIN crypto_market_prices m ON m.symbol = lower(h.ticker)`, restricted to tickers that match the market symbol check) and selects at most `limit` (100) distinct symbols in two groups, as one statement: up to `ceil(limit / 2)` symbols that already have a stored market price, oldest market time first, and the remaining slots from symbols with no stored market price, drawn in random order; a group that cannot fill its share leaves the slots to the other one. This is a deliberate change from "never priced first" found by the SAST review: a ticker the provider never answers (junk typed by any user) never gets a stored price, so it would stay first forever and fill every request. With the split, such tickers take at most half of the slots, existing prices keep refreshing, and every never-priced symbol is eventually tried (the residual delay for a newly added real ticker is accepted risk M-1 of the SAST report). Ordering by the stored market time (not by the holdings' prices) keeps manually priced holdings from starving the others.
- The reader is `SELECT symbol, unit_price, priced_at FROM crypto_market_prices WHERE symbol = ANY(:symbols)`, one query per call, and returns an empty map without querying when the list is empty.
- `claim` is the same atomic upsert as the rates schedule (`ON CONFLICT DO UPDATE ... WHERE next_attempt_at <= now`); `reserveCall(month)` is `INSERT (month, calls = 1) ... ON CONFLICT (month) DO UPDATE SET calls = calls + 1 WHERE calls < 1000 RETURNING calls`, so of two simultaneous reservations at the limit exactly one succeeds; the month key is the UTC `YYYY-MM` of the clock.
- The snapshot save inserts the rows of a portfolio with `ON CONFLICT DO NOTHING` inside one transaction, so a second worker cannot duplicate them and a crash writes all currencies of a day or none.
- Portfolios to snapshot are selected by zone with their priced holdings through the user's stored zone, excluding those that already have a row for the date, paged by portfolio id.

**Data model**
- Entity `crypto_price_sync`: `id` smallint primary key with check `id = 1`; `next_attempt_at` timestamptz not null; `last_success_at` timestamptz nullable; `consecutive_failures` integer not null default 0 with check `>= 0`.
- Entity `crypto_price_usage`: `month` text primary key with check `month ~ '^[0-9]{4}-[0-9]{2}$'`; `calls` integer not null default 0 with check `calls between 0 and 1000`.
- Entity `crypto_price_refresh_failures`: `id` uuid primary key default `gen_random_uuid()`; `failed_at` timestamptz not null; `code` text not null with check in the five failure codes; `status_code` smallint nullable with check between 100 and 599; `detail` text nullable with check `char_length(detail) <= 200`; index `crypto_price_refresh_failures_failed_at_idx` on `failed_at`.
- Entity `crypto_market_prices`: `symbol` text primary key with check `symbol ~ '^[a-z0-9._-]{1,20}$'`; `unit_price` bigint (`mode: 'bigint'`) not null with check `unit_price between 1 and 1000000000000`, the same range as the holdings price check, so the copy onto a holding can never violate it; `priced_at` timestamptz not null. No foreign key and no owner column: it is public market data, not user data.
- Index `holdings_crypto_ticker_idx` on the existing `holdings` entity: expression `lower(ticker)` where `instrument_type = 'crypto'`, so the hourly update and the symbol read do not scan every holding; the rollback script drops it.
- Entity `portfolio_value_snapshots`: `portfolio_id` uuid not null; `owner_id` uuid not null; composite foreign key `(portfolio_id, owner_id)` to `portfolios(id, owner_id)` on delete cascade, so a snapshot can never carry another owner than its portfolio; `snapshot_date` date not null; `currency` text not null with check in `('ARS', 'USD')`; `total_value` bigint (`mode: 'bigint'`) not null with check `total_value >= 0`; `taken_at` timestamptz not null; primary key `(portfolio_id, snapshot_date, currency)`; index `portfolio_value_snapshots_owner_date_idx` on `(owner_id, snapshot_date)`.
- No floating-point column in any entity. The snapshot entity references users only through `portfolios`, so deleting a user cascades to it (register it in the erasure guard); the market price entity references nothing.

**Input validation**
- Repositories receive validated domain values and rely on the check constraints as the last line of defense; every value reaches SQL as a bound parameter, never concatenated.

**Error handling**
- A unique conflict on a snapshot row is the idempotent case and is swallowed by `DO NOTHING`; any other constraint violation is a programming error and propagates as an error.
- A stale lease changes nothing (the update is keyed on the lease value).
- A deadlock or connection error propagates; the job logs it and tries again on the next pass, and the transaction of `storeAndApply` leaves neither statement applied.

**Required tests**
- [ ] `apps/api/test/investments/price-repositories.test.ts` — `storeAndApply` stores one market price per symbol and updates only crypto holdings in USD of the answered symbols (case-insensitive), sets source `automatic` and the market time, leaves other types and other symbols untouched — validates AC-01.
- [ ] `apps/api/test/investments/price-repositories.test.ts` — a holding with source `manual` keeps its price, source and time while its symbol's market price is stored (AC-05); a holding added after the market price was stored, and a holding whose price was cleared, get the stored price at the next apply; a holding with an imported price older than the market price is replaced — validates AC-05.
- [ ] `apps/api/test/investments/price-repositories.test.ts` — with two connections, a manual price committed while the apply statement waits on the row lock is kept and the older market price never replaces a newer stored one (conflict between a manual price and an in-flight refresh) — validates AC-06.
- [ ] `apps/api/test/investments/price-repositories.test.ts` — at most 100 symbols are returned, half of them the oldest priced ones and the rest never-priced symbols in random order (150 junk symbols and 10 priced ones return all 10 priced ones and 90 never-priced; 70 priced and 150 never-priced return the 50 oldest priced and 50 never-priced; a small never-priced pool is eventually covered), manually priced symbols are included, a database error propagates (error), and a market price of 0 or above 10^12 is rejected by the check constraint (invalid row) — validates AC-02.
- [ ] `apps/api/test/investments/market-price-reader.test.ts` — the reader returns the stored prices of the asked symbols in one query, nothing for unknown symbols, an empty map without a query for an empty list, and a database error propagates (error) — validates FR-03.
- [ ] `apps/api/test/investments/price-schedule.test.ts` — two simultaneous claims give one owner (conflict), a stale lease updates nothing, success and failure move `next_attempt_at`, and two simultaneous reservations at 999 calls give exactly one success while the 1,001st is refused — validates NFR-01.
- [ ] `apps/api/test/investments/snapshot-repository.test.ts` — saving twice for the same portfolio and date stores one set of rows (duplicate), the portfolio query skips portfolios that already have a row, excludes unpriced holdings, pages by id, and returns a portfolio only in its owner's zone — validates AC-03.
- [ ] `apps/api/test/investments/snapshot-repository.test.ts` — a snapshot with an owner different from its portfolio's owner is rejected by the composite foreign key, a negative total and an unknown currency are rejected by the check constraints (invalid rows).
- [ ] `apps/api/test/investments/price-migration.test.ts` — the migration applies on a database holding the earlier migrations, the five tables, constraints and indexes (including `holdings_crypto_ticker_idx`) exist, none has a floating-point column, `crypto_market_prices` has no foreign key, its rollback script restores the previous state and it can be applied again.
- [ ] `apps/api/test/identity/user-erasure.test.ts` — `portfolio_value_snapshots` is registered with a seeder; the guard reports no violation and deleting the user removes its snapshots (cascade).
- [ ] `apps/api/test/identity/migration.test.ts`, `apps/api/test/investments/investments-migration.test.ts` and `apps/api/test/deploy/build-output.test.ts` — still pass with the new migration first in every rollback chain and in the expected table lists, with no "newest migration" assertion (regression of the existing migration tests).

**Completion criterion**
`pnpm --filter @pesly/api exec vitest run test/investments/price-repositories.test.ts test/investments/market-price-reader.test.ts test/investments/price-schedule.test.ts test/investments/snapshot-repository.test.ts test/investments/price-migration.test.ts test/investments/investments-migration.test.ts test/identity/user-erasure.test.ts test/identity/deletion-persistence.test.ts test/identity/migration.test.ts test/deploy/build-output.test.ts` passes against PostgreSQL, `drizzle-kit generate` reports no changes afterwards, and `pnpm typecheck` passes.

## Block 4 — Provider adapters and worker environment

**Files**
- `apps/api/src/investments/infrastructure/provider/coingecko-price-provider.ts` (new) — the CoinGecko adapter.
- `apps/api/src/investments/infrastructure/provider/coingecko-payload.ts` (new) — strict parsing of the response text.
- `apps/api/src/investments/infrastructure/provider/fake-price-provider.ts` (new) — deterministic fake with a failure switch.
- `apps/api/src/shared/config/env.ts` (modified) — the worker settings `PRICE_PROVIDER`, `COINGECKO_BASE_URL` and `COINGECKO_API_KEY` and their production rules.
- `.railway/railway.ts` (modified) — the worker declares `COINGECKO_API_KEY: preserve()`; `PRICE_PROVIDER` and `COINGECKO_BASE_URL` are not declared (their defaults are production-safe) and `apps/api/test/deploy/railway-iac.test.ts` (modified) adds the key to its `SECRETS` list and to the worker's allowed secrets only.
- `apps/api/test/helpers/test-env.ts` (modified) — `PRICE_PROVIDER: 'fake'` next to `RATE_PROVIDER` and the production overrides reset it to `coingecko`; `.env.example` (modified) — the three settings documented like the rates ones.
- `playwright.config.ts` (modified) — `PRICE_PROVIDER: 'fake'` in the worker environment.

**Logic**
- The adapter sends one request to `{base}/coins/markets` with `vs_currency=usd`, `symbols=<comma-separated lowercase symbols>`, `per_page=250` and `precision=full`, with `redirect: 'manual'`, a 10-second timeout (well below the 5-minute lease), `Accept: application/json` and, when configured, the header `x-cg-demo-api-key`. The key is never logged, stored or put in a query string.
- Mapping of faults: network error to `provider_unreachable`, abort to `provider_timeout`, status 429 to `provider_rate_limited`, any other status outside 200 to 299 to `provider_bad_status`, a non-JSON content type, a body over 512 KiB, malformed JSON or a body that is not an array to `provider_invalid_payload`.
- The payload parser reads the body with `JSON.parse` and a reviver (its third `context` argument is not in the repo's TypeScript lib, so a small local interface types it without `any`; when `context.source` is absent for a `current_price` the whole answer is `provider_invalid_payload`, never a float fallback; only `current_price` of the top-level entries is converted) that takes the source text of each `current_price` number (`context.source`, available on Node 24), so the price is converted from its digits by `usdPriceToMinorUnits` and never passes through a float. Entries without a string `symbol` or without a usable price are ignored; if the same symbol appears twice the one with the lowest `market_cap_rank` wins (a null rank sorts last); an entry whose `last_updated` is missing or older than 24 hours is ignored (a delisted coin keeps its last price, which must not get a fresh date); only symbols that were asked for are returned.
- The fake returns fixed prices for `btc`, `eth` and `sol` (and nothing for other symbols), counts its calls, and can be told to fail with a given `PriceProviderFailure`.
- Worker environment: `PRICE_PROVIDER` is `coingecko` or `fake` (default `coingecko`), `COINGECKO_BASE_URL` defaults to `https://api.coingecko.com/api/v3`, `COINGECKO_API_KEY` is optional. In production the provider must be `coingecko` and the base URL must be the default; the key is optional so a missing secret never stops the email worker from starting (NFR-02), and the worker logs once that it runs without a key; with no key the adapter sends no key header. The worker fields are shared by the API settings parser (as `RATE_PROVIDER` already is), so the API parses and ignores these settings and never imports the adapter; the settings module gains a `COINGECKO_BASE_URL_DEFAULT` export, treats an empty key as unset, and `env.ts` extends its raw worker type and production rules.

**Input validation**
- The only request data is the list of symbols, built from stored tickers that match `^[A-Za-z0-9][A-Za-z0-9._/-]*$` (07a); the adapter drops symbols containing characters outside `[a-z0-9._-]` after lowercasing, so a stored ticker can never inject query text, and it URL-encodes the joined value.
- Environment values are validated by Zod at start; a violation names the variable, never its value.

**Error handling**
- Each fault of the mapping above becomes a typed failure with its code; no provider text, no key and no URL query reaches a log or the failure log.
- A missing key is not an error; a base URL other than the default in production is a start-up error naming `COINGECKO_BASE_URL`.

**Required tests**
- [ ] `apps/api/test/investments/coingecko-price-provider.test.ts` — against a local test server, a valid answer for btc and eth returns 6789012 and 351234 cents from the digits of the JSON, the request carries `vs_currency=usd`, the joined lowercase symbols, `precision=full` and the key header, and no key in the URL; with no key configured the request carries no key header and still succeeds — validates AC-01 and AC-15.
- [ ] `apps/api/test/investments/coingecko-price-provider.test.ts` — status 429 is `provider_rate_limited`, status 500 is `provider_bad_status`, a refused connection is `provider_unreachable`, a slow server is `provider_timeout`, HTML content, malformed JSON, a non-array body and a body over 512 KiB are `provider_invalid_payload`, a redirect is not followed (error cases) — validates AC-02.
- [ ] `apps/api/test/investments/coingecko-payload.test.ts` — a null or sub-cent price and an entry without a symbol are ignored (no price kept), a repeated symbol keeps the better rank, unrequested symbols are dropped, an exponent price (`1.5e3`) is read exactly, and a stored ticker with a space or an ampersand is dropped from the request (injection-shaped symbol) — validates AC-02.
- [ ] `apps/api/test/investments/fake-price-provider.test.ts` — the fake answers deterministic prices, counts calls and fails on demand.
- [ ] `apps/api/test/foundation/worker-env.test.ts` and `apps/api/test/foundation/env.test.ts` — `PRICE_PROVIDER` defaults to `coingecko`, production rejects `fake` and a non-default base URL naming the variable (error), accepts a missing or empty key so the worker settings parse and the worker side starts with no key (validates AC-15), and rejects an invalid URL, for the worker parser and for the API parser (extends the existing tests).
- [ ] `apps/api/test/deploy/railway-iac.test.ts` — the worker service declares `COINGECKO_API_KEY` through `preserve()`, the API service does not, and no literal `PRICE_PROVIDER` or `COINGECKO_BASE_URL` is declared (extends the existing allow-list test).
- [ ] `apps/api/test/investments/coingecko-payload.test.ts` — an answer parsed without `context.source` (a stubbed `JSON.parse` that drops it) is `provider_invalid_payload`, never a float fallback; an entry with an old `last_updated` is ignored (error: stale entry).

**Completion criterion**
`pnpm --filter @pesly/api exec vitest run test/investments/coingecko-price-provider.test.ts test/investments/coingecko-payload.test.ts test/investments/fake-price-provider.test.ts test/foundation/worker-env.test.ts test/deploy/railway-iac.test.ts` passes, no test reaches the real CoinGecko, and `pnpm typecheck` passes.

## Block 5 — Jobs and worker wiring

**Files**
- `apps/api/src/investments/infrastructure/jobs/price-sync-job.ts` (new) — polls the price schedule and purges old failures.
- `apps/api/src/investments/infrastructure/jobs/snapshot-job.ts` (new) — polls the snapshot use case.
- `apps/api/src/investments/jobs.ts` (new) — `createPriceSyncJob`, `createSnapshotJob` and `createInvestmentsJobs` (which returns `start` and `stop` for both) and the adapter exports, deliberately not re-exported from `apps/api/src/investments/index.ts`.
- `apps/api/src/worker.ts` (modified) — builds the provider by `PRICE_PROVIDER`, starts `createInvestmentsJobs` and stops it on shutdown; `worker.ts` runs its side effects at import time, so the composition is tested through `createInvestmentsJobs`, not by importing the worker.
- `apps/api/test/investments/request-path.test.ts` (new) — the API's import graph.

**Logic**
- `PriceSyncJob` mirrors `RatesSyncJob`: it polls every 30 seconds (the claim is atomic, so any number of workers make at most one provider call per hour), purges failure records older than 30 days at most once an hour, logs outcomes and codes only, logs an errored pass and runs the next one, and `stop()` waits for the pass in progress.
- `SnapshotJob` polls every 5 minutes, runs `TakeDailySnapshots.execute(clock.now())`, logs the counts (a skipped out-of-range portfolio is logged as a failure once per zone and local date, from an in-memory set that only suppresses repeats, and the pass continues), and shares the same stop semantics.
- `jobs.ts` is the only place that builds the provider-backed jobs, and the worker imports it directly; the API process imports the module barrel `apps/api/src/investments/index.ts` and `server.ts` only, so no provider, job or `fetch` call is reachable from a user request (AGENTS.md: external services never in the request path).
- The worker keeps its existing `email worker started` and `rates sync started` log lines unchanged and adds `price sync started` and `snapshot job started`.

**Input validation**
- The jobs take no request data; their only inputs are the configuration parsed in Block 4 and the clock.

**Error handling**
- A storage error in a pass is logged with the error object and the next pass runs; the process does not exit.
- A provider fault is an outcome logged by code only.
- A failed purge is logged and retried at the next purge interval; it never stops a refresh.

**Required tests**
- [ ] `apps/api/test/investments/price-sync-job.test.ts` — with the fake provider and real repositories on the test database, one pass refreshes a crypto holding to source `automatic` (AC-01) and leaves a manual-priced one untouched while storing its market price (AC-05); a provider failure (error) keeps the price and the next pass inside the retry delay makes no call (AC-02); a failing storage layer is logged and the next pass still runs (error); `stop()` waits for the pass in progress.
- [ ] `apps/api/test/investments/snapshot-job.test.ts` — with a mutable clock, a pass just after local midnight in two zones stores each portfolio's snapshot for its own previous day once, a second pass stores nothing, and a pass for an invalid zone logs and continues (AC-03, invalid zone).
- [ ] `apps/api/test/investments/request-path.test.ts` — the transitive import closure of the API entry (`server.ts`, `app.ts` and the investments barrel, which is legitimately imported) contains no module under `infrastructure/provider/`, `infrastructure/jobs/`, no `jobs.ts`, `refresh-crypto-prices`, `take-daily-snapshots` or `price-ports`, and none of the worker repositories (`drizzle-crypto-price-repository`, `drizzle-price-schedule`, `drizzle-price-failure-log`, `drizzle-snapshot-repository`) while `drizzle-market-price-reader`, `schema.ts` and `ports.ts` are allowed, a stricter version of the exchange-rates request-path test (a deliberate violation probe is detected as an error).
- [ ] `apps/api/test/investments/investments-jobs.test.ts` — `createInvestmentsJobs` with the fake provider starts both jobs, `stop()` waits for both passes, stopping twice is harmless (error: double stop), and the composition built with no API key starts and completes a pass (AC-15); the `email worker started` log line of `worker.ts` is unchanged (the e2e server waits on it).

**Completion criterion**
`pnpm --filter @pesly/api exec vitest run test/investments/price-sync-job.test.ts test/investments/snapshot-job.test.ts test/investments/investments-jobs.test.ts test/investments/request-path.test.ts test/foundation` passes and `pnpm typecheck` passes.

## Block 6 — Market price in the holding response and the switch to automatic

**Files**
- `packages/shared/src/investments/constants.ts` (modified) — `MARKET_PRICE_RECENT_WITHIN_MS`, 24 hours.
- `packages/shared/src/investments/valuation.ts` (modified) — `marketPriceDiffers(manualUnitPrice, marketUnitPrice)`, pure `bigint` arithmetic with no `Math` call.
- `packages/shared/src/investments/contracts.ts` (modified) — the holding response gains `marketUnitPrice` (unsigned integer string or null), `marketPricedAt` (ISO date-time or null), `marketPriceDiffers` (boolean) and `marketPriceRecent` (boolean); the portfolio, portfolio list and add-holding responses embed it, so they change with it.
- `apps/api/src/investments/application/ports.ts` (modified) — the `MarketPriceReader` port (`findMany(symbols)` returning a map by lowercase symbol of `{ unitPrice, pricedAt }`).
- `apps/api/src/investments/application/portfolio-view.ts` (modified) — `HoldingView` gains `market`, `marketPriceDiffers` and `marketPriceRecent`; `buildHoldingView(holding, now, market)` and the portfolio builders take the market prices of the holdings' tickers.
- `apps/api/src/investments/application/holding-use-cases.ts` (modified) — `AddHolding`, `GetHolding`, `UpdateHolding` and `SetManualPrice` take the reader and return the view with the market fields; new `UseAutomaticPrice`.
- `apps/api/src/investments/application/portfolio-use-cases.ts` (modified) — `CreatePortfolio`, `ListPortfolios` and `GetPortfolio` take the reader; one lookup per call, skipped when no holding is crypto.
- `apps/api/src/investments/infrastructure/http/serializers.ts` (modified) — `serializeHolding` writes the four fields.
- `apps/api/src/investments/infrastructure/http/holding-routes.ts` (modified) — the new route and its dependency.
- `apps/api/src/investments/index.ts` (modified) — builds the reader and the use case; it imports the reader only, never the worker repository.
- `apps/api/test/investments/fakes/in-memory-investments.ts` (modified) — an in-memory `MarketPriceReader` that records its calls.
- `apps/api/test/investments/valuation.test.ts`, `contracts.test.ts`, `portfolio-view.test.ts`, `holding-use-cases.test.ts`, `portfolio-use-cases.test.ts`, `holding-routes.test.ts`, `portfolio-routes.test.ts`, `add-holding-concurrency.test.ts` and `investments-wiring.test.ts` (modified) — the new constructor arguments, the four response fields and the new route (see the tests below).

**Logic**
- `marketPriceDiffers(manual, market)` returns true when the absolute difference of the two prices times 100 is greater than the manual price times 5 (the 5% is measured against the manual price, exactly 5% is false); the absolute value is taken with a comparison, never `Math.abs`.
- The view fills `market` for a crypto holding that has a stored market price and sets `marketPriceDiffers` when the holding's price source is `manual`, a market price exists and the shared helper says the two prices differ by more than 5%; the age of the market price never changes it (owner decision, FR-05), so an old market price still warns. For an automatic or imported price, a holding without a price, or a holding without a stored market price it is false.
- `marketPriceRecent` is true when the market price time is at most 24 hours before the injected `Clock`'s now (`MARKET_PRICE_RECENT_WITHIN_MS`) and false otherwise or when there is no market price. It is a server flag, not a web computation, for the same reason as 07a's `priceStale`: the clock is injected, so tests are deterministic with a mutable clock; the browser's clock may be wrong or in another zone; and the presentational row stays free of time logic. The flag is fixed when the response is built, so a screen left open keeps its wording until the next load.
- Every holding view that is returned (list, get, add, edit and manual price) goes through the same builder, so the response is the same whichever call produced it; the use cases collect the lowercase tickers of the crypto holdings in the result and make one reader call, none when there is no crypto holding.
- `UseAutomaticPrice.execute(scope, holdingId)` reads the holding under the owner scope (an unknown or foreign id is not found), requires an instrument type crypto and a stored market price (otherwise it raises the module's `InvestmentRuleViolation` for the field `marketPrice`), then writes the price through the existing `setPrice` of the holding repository with the market unit price, source `automatic` and the market price time, and returns the refreshed view (FR-06).
- The route is `POST /investments/holdings/:holdingId/automatic-price`, the sibling of `PUT /investments/holdings/:holdingId/price`: the same session and write-scope checks, the same request id and mutation log line (action `holding.automatic-price`, ids only, no amount), and its response is validated with the holding response contract.

**API contract**
- Method + path: `POST /investments/holdings/:holdingId/automatic-price`
- Request: path parameter `holdingId` (UUID); no body.
- Response 200: the holding response, with `priceSource` `automatic`, `unitPrice` and `pricedAt` equal to the market price and `marketPriceDiffers` false.
- Error codes: 401 when there is no session, 404 `NOT_FOUND` for an unknown holding or a holding owned by another user, 400 `VALIDATION_FAILED` with the field `body.marketPrice` when the holding is not crypto or has no stored market price.
- Auth: the investments session and write scope, like the other holding routes; access to another user's data always answers 404.

**Input validation**
- The path parameter is parsed with the existing holding id params contract (a UUID); the route has no body and reads none.
- The response carries amounts as decimal strings; `marketUnitPrice` follows the same unsigned integer string rule as `unitPrice`, so JSON never carries a float.

**Error handling**
- Unknown or foreign holding: 404 `NOT_FOUND`, nothing changed.
- Holding that is not crypto or has no stored market price: 400 `VALIDATION_FAILED` on `body.marketPrice`, nothing changed (a known oddity: the field path names a body the route does not have, kept to reuse the module's single rule-violation error and its web handling).
- No session: 401, as on the other routes.
- A storage error in the reader or the repository becomes the shared 500 error response, with no amount in the log.

**Required tests**
- [ ] `apps/api/test/investments/valuation.test.ts` — `marketPriceDiffers(6000000n, 6400000n)` and `(6000000n, 5600000n)` are true (6.67% above and below), `(6000000n, 6300000n)` and `(6000000n, 5700000n)` are false (exactly 5%), and a pair at the 10^12 limit does not overflow — validates AC-07, AC-08 and AC-09.
- [ ] `apps/api/test/investments/portfolio-view.test.ts` — a manual crypto holding with a market price from 3 hours ago, 6.67% away, has `marketPriceDiffers` true, `marketPriceRecent` true and carries the market price and its date (AC-07, AC-08); at exactly 5% it is false (AC-09); an automatic or imported price is false (AC-10); a market price from 2 days ago (`marketPriceRecent` false, the 24-hour boundary tested at 24 hours and 24 hours plus one second) and one from 30 days ago both keep `marketPriceDiffers` true (AC-11, AC-16); a non-crypto holding has no market price.
- [ ] `apps/api/test/investments/contracts.test.ts` — the holding response requires the four new fields and accepts null market values; a `marketUnitPrice` that is not an unsigned integer string (invalid, for example `"1.5"`) is rejected.
- [ ] `apps/api/test/investments/holding-use-cases.test.ts` — `UseAutomaticPrice` sets price, source `automatic` and the market time and the warning disappears (AC-12); it rejects a stock holding and a crypto holding without a stored market price and changes nothing (AC-13); another owner's or an unknown id is not found (AC-14); each use case makes at most one reader call and none for a holding that is not crypto.
- [ ] `apps/api/test/investments/portfolio-use-cases.test.ts` — listing portfolios with crypto holdings makes one market lookup, a list without crypto makes none, and the response fields are filled per holding.
- [ ] `apps/api/test/investments/holding-routes.test.ts` — `POST .../automatic-price` answers 200 with the switched holding, source `automatic` and no warning (AC-12).
- [ ] `apps/api/test/investments/holding-routes.test.ts` — the route answers 404 for user B's holding and for an unknown id, and changes nothing (AC-14).
- [ ] `apps/api/test/investments/holding-routes.test.ts` — the route answers 400 with `body.marketPrice` for a stock holding and for a crypto holding with no stored market price, and changes nothing (invalid, AC-13).
- [ ] `apps/api/test/investments/holding-routes.test.ts` — the route answers 401 without a session, and a storage failure in the reader answers the shared 500 error without an amount in the log; the route is added to the existing 401/403, cross-user 404 and storage-failure 500 lists.
- [ ] `apps/api/test/investments/portfolio-routes.test.ts` — the list and read responses carry `marketUnitPrice`, `marketPricedAt`, `marketPriceDiffers` and `marketPriceRecent` for a manually priced crypto holding with a market price 6.67% away (AC-07).
- [ ] `apps/api/test/investments/add-holding-concurrency.test.ts` and `apps/api/test/investments/investments-wiring.test.ts` — still pass with the new constructor arguments, and the wiring imports the reader and not the worker repository (regression).

**Completion criterion**
`pnpm --filter @pesly/api exec vitest run test/investments/valuation.test.ts test/investments/portfolio-view.test.ts test/investments/contracts.test.ts test/investments/holding-use-cases.test.ts test/investments/portfolio-use-cases.test.ts test/investments/holding-routes.test.ts test/investments/portfolio-routes.test.ts test/investments/add-holding-concurrency.test.ts test/investments/investments-wiring.test.ts test/perf` passes, the portfolio latency benchmark of 07a (p95 under 500 ms) still passes, and `pnpm typecheck` passes.

## Block 7 — Web: manual price warning and switch to automatic

**Files**
- `apps/web/src/lib/api-client.ts` (modified) — `setHoldingAutomaticPrice(holdingId)`: a `POST` to the new route, response validated with the holding response contract, same refresh-on-unauthenticated behavior as `setHoldingPrice`.
- `apps/web/src/features/investments/components/holding-row.tsx` (modified) — a warning shown when `marketPriceDiffers`, with the market price formatted by `formatMoney` and, when `marketPriceRecent` is false, the market price date formatted by `formatDateTime` in the user's locale and time zone, and a button that calls the new optional prop `onUseAutomaticPrice`.
- `apps/web/src/features/investments/components/portfolio-card.tsx` and `investments-screen.tsx` (modified) — pass the new optional callback down to each row.
- `apps/web/src/features/investments/containers/investments-container.tsx` (modified) — the action: calls the client, replaces the portfolio in state like the other holding mutations, and on failure shows the portfolio-level message through the existing `portfolioFailure` path.
- `apps/web/messages/en.json` and `apps/web/messages/es.json` (modified) — the new keys under `investments.holding`: `manualPriceDiffersToday` (with a `{price}` placeholder), `manualPriceDiffersOn` (with `{price}` and `{date}` placeholders), `useAutomaticPrice` and `useAutomaticPriceFor` (with a `{ticker}` placeholder).
- `apps/web/test/support/holding-fixture.ts`, `api-client-investments.test.ts`, `holding-row.test.tsx`, `portfolio-card.test.tsx`, `investments-container.test.tsx` and `i18n-catalogs.test.ts` (modified) — see the tests below; the fixture gains the four response fields (null, null, false, false) so every test that parses or renders a holding keeps compiling.

**Logic**
- The warning is plain text with an icon, visible without opening the details of the row, placed with the other price notes (like the stale price text); its colors, radius and spacing come from theme tokens only.
- The warning has two texts, chosen by the server flag `marketPriceRecent`. Recent: "Este precio es manual, pero el de mercado cambió: hoy vale {price}" and "This price is manual, but the market price changed: today it's worth {price}". Older: "Este precio es manual, pero el de mercado cambió: al {date} valía {price}" and "This price is manual, but the market price changed: on {date} it was worth {price}", with the date in the user's locale and time zone. The button reads "Usar precio automático" and "Use automatic price", with an accessible name that includes the ticker; no string is hardcoded in a component (AGENTS.md).
- The button appears only when the warning shows and the callback is provided; pressing it calls `onUseAutomaticPrice(holdingId)`. The container applies the returned holding, so the warning disappears and the source reads "Automatic" (FR-06, AC-12).
- A rejected switch (404 or 400) shows the existing generic failure of the portfolio through `portfolioFailure`; no new error code is mapped.
- The component stays presentational: no data fetching in `holding-row.tsx`; the money formatting goes through `formatMoney` only, which the web no-float scan enforces.

**Input validation**
- The row displays only values already validated by the response contract; `marketUnitPrice` is converted with `BigInt` after the contract guaranteed an unsigned integer string, and the warning is never rendered when it is null.

**Error handling**
- A failed switch (network, 404 or 400) leaves the holding as it was and shows the portfolio message; the button is usable again.
- A response that fails the contract is treated like any other invalid API response by the client.

**Required tests**
- [ ] `apps/web/test/holding-row.test.tsx` — with `marketPriceDiffers` and `marketPriceRecent` true the warning says "today" with the market price formatted for the locale in Spanish and in English (AC-07, AC-08); with `marketPriceRecent` false it says "on <date>" with the date in the user's time zone and never "today" (AC-11), also for a price 30 days old (AC-16); with `marketPriceDiffers` false, or for an automatic price, there is no warning and no button (AC-09, AC-10); the button calls `onUseAutomaticPrice` with the holding id and is absent without the callback.
- [ ] `apps/web/test/api-client-investments.test.ts` — `setHoldingAutomaticPrice` sends a `POST` to `/investments/holdings/{id}/automatic-price` and returns the parsed holding (AC-12); a 404 raises the client's not-found error and a payload with an invalid `marketUnitPrice` (error) is rejected.
- [ ] `apps/web/test/investments-container.test.tsx` — pressing the button calls `POST .../automatic-price`, shows the switched holding with the source "Automatic" and no warning (AC-12); a 404 and a 400 response leave the holding and show the portfolio failure message (error cases, AC-13).
- [ ] `apps/web/test/portfolio-card.test.tsx` — the callback reaches the row of the warned holding only.
- [ ] `apps/web/test/i18n-catalogs.test.ts` — the three new warning and button keys, with the two warning variants, exist in both catalogs with the same placeholders (parity, regression).
- [ ] `apps/web/test/no-float-money.test.ts` — still passes: the market price is shown through `formatMoney` (regression of the existing scan).

**Completion criterion**
`pnpm --filter @pesly/web exec vitest run test/holding-row.test.tsx test/api-client-investments.test.ts test/investments-container.test.tsx test/portfolio-card.test.tsx test/i18n-catalogs.test.ts test/no-float-money.test.ts` passes, `pnpm lint` and `pnpm typecheck` pass.

## Block 8 — Cross-cutting checks and end-to-end step

**Files**
- `apps/api/test/investments/price-sync-integration.test.ts` (new) — the worker-level flow on the real database.
- `apps/web/e2e/investments.spec.ts` (modified) — extra steps for the automatic price, the warning and the switch; its `addHolding` helper gains an instrument type and a currency parameter so it can add a crypto holding in USD.
- `apps/api/test/investments/no-float-money.test.ts` (modified) — its `offendersIn` helper takes a directory so the probe case can scan a temporary one; the scan itself already walks every file under `apps/api/src/investments` and `packages/shared/src/investments`.

**Logic**
- The integration test creates users with portfolios and crypto holdings (one automatic, one manual), runs the price and snapshot use cases with the fake provider and a mutable clock through the 24-hour cycle (a refresh, an outage, a recovery, local midnight in two zones) and checks the stored prices, the stored market prices, the failure log, the monthly counter, the snapshots, and the portfolio response (the warning flag of the manual holding).
- The end-to-end steps add a crypto holding `BTC` in USD, wait for the worker (running with `PRICE_PROVIDER=fake`) to refresh it and expect the automatic price and the value on the screen; then set a manual unit price of 1.00 USD, expect the Spanish warning text with the fake provider's market price and the button, press it, and expect the warning to disappear and the source to read "Automático". The expectations use the catalog texts, never fixed waits, and neither step triggers an API response of 400 or above (the spec's response guard).
- The no-float scan already walks `apps/api/src/investments`; the change adds a probe that proves the scan flags a forbidden token in a new directory.

**Input validation**
- The tests use only values accepted by the contracts and the repositories; no real external service is called.

**Error handling**
- The integration test asserts the outage path (failure recorded, prices unchanged, counter incremented once per attempt) and the recovery path.
- The end-to-end steps use a unique email per run and wait for visible text, never for fixed time.

**Required tests**
- [ ] `apps/api/test/investments/price-sync-integration.test.ts` — a full cycle with the fake provider updates every crypto holding without a manual price to `automatic` (AC-01), an outage keeps the previous prices and increments the counter once per attempt (AC-02), and the next local midnight stores one snapshot per portfolio and currency with the same totals the screen computes (AC-03), all on the real database.
- [ ] `apps/api/test/investments/price-sync-integration.test.ts` — the manual holding keeps its price while the stored market price changes, and the portfolio read model flags it when the market price is more than 5% away and not when it is exactly 5% away, and a 30-day-old market price still flags it with `marketPriceRecent` false (AC-05, AC-07, AC-09, AC-16).
- [ ] `apps/api/test/investments/price-sync-integration.test.ts` — the counter never exceeds 1,000 across the simulated month, the failure log never contains provider text or the key, and an out-of-range portfolio total is skipped while the others are snapshotted (error path, NFR-01, AC-04).
- [ ] `apps/web/e2e/investments.spec.ts` — a crypto holding gets its automatic price from the worker and the screen shows the source and the value (AC-01); after a manual price of 1.00 USD the warning and the button appear, and pressing the button restores the automatic price and hides the warning (AC-07, AC-12).
- [ ] `apps/api/test/investments/no-float-money.test.ts` — the scan fails for a probe file with `parseFloat` in a new job directory (invalid source).

**Completion criterion**
`pnpm --filter @pesly/api exec vitest run test/investments/price-sync-integration.test.ts test/investments/no-float-money.test.ts` passes, `pnpm e2e` passes `investments.spec.ts` with the worker on the fake provider, and the SAST scan in CODE finds no secret, injection or logging finding.

## Final verification
- Every FR, NFR and AC of the PRD is covered by the table and by named tests.
- `pnpm lint`, `pnpm typecheck`, `pnpm test:coverage` (80% floor), `pnpm e2e` pass; no test calls CoinGecko.
- The provider is only reachable from the worker; the API process imports no provider, job, job factory or worker price repository, only the market price reader.
- An automatic price never replaces a manual one: the repository test with two connections and the integration test both pass.
- The migration applies and rolls back, `drizzle-kit generate` reports no changes, and its number and `when` are checked against main at push time.
- The follow-up "finer price scale for sub-cent crypto" is listed in the parent index `prd-DISC-001-07.md`.

# Spec DISC-001-07b: Crypto Prices and Daily Portfolio Snapshots

| Field | Value |
|-------|-------|
| Ticket | DISC-001-07b |
| PRD | docs/ddw/prd/prd-DISC-001-07b.md |
| Tier | FEATURE |
| Date | 2026-10-02 |
| Spec loops | 0 |
| Loops since last human decision | 0 |

## Summary
Adds two background jobs to the `investments` module, both run only by the worker process, never by the
API. The price job refreshes the USD price of every crypto holding from CoinGecko through a
`PriceProvider` port with one real adapter and one fake: one request to the Demo plan's markets
route per hour for up to 100 distinct ticker symbols (a ticker is matched as a CoinGecko symbol, the
top-ranked coin per symbol), the JSON price is turned into whole US cents from its source text (never
through a float), and every crypto holding of a priced symbol gets that unit price with source
`automatic` and the fetch time. A symbol the provider does not return, or whose price rounds to
less than one cent, keeps the previous price. The jobs follow the exchange-rates job of
DISC-001-03a: a single schedule row claimed with an atomic upsert that doubles as a lease, an
outcome type with no thrown provider errors, and a failure log purged after 30 days. A persisted
monthly counter reserves one call before each request and refuses the 1,001st, so the Demo plan's
10,000-call allowance is never approached (NFR-01 asks for at most 1,000 per month). The snapshot job
polls every 5 minutes: for every time zone in use it computes the user's local date from the clock,
and for each portfolio with at least one priced holding and no snapshot for yesterday's local date it
stores the total value per currency (computed with the shared `holdingValue` and `totalsByCurrency`
helpers) in one insert that is idempotent, so any number of workers can run. Block 1 holds the pure
domain, Block 2 the ports and use cases, Block 3 the persistence (migration `0015`, provisional),
Block 4 the provider adapters and the worker environment, Block 5 the jobs and the worker wiring,
Block 6 the cross-cutting checks and an end-to-end step. No web change: the screen already shows the
source `automatic`, the stale date and the value.

Design choices the PRD leaves to the spec (technical; the two marked "to confirm" are the decisions
reported with this plan): the provider is queried with the ticker as a symbol, relying on CoinGecko's
default of one top-ranked coin per symbol (to confirm: an exotic symbol shared by several coins may
resolve to an unintended coin); unit prices keep the existing minor-unit scale of 07a, so a price is
rounded half up to the cent and a coin worth less than one cent cannot be auto-priced (to confirm:
a finer price scale would change 07a's contracts and PRD); a value or total above 2^63 - 1 minor
units is not stored (the snapshot row is skipped and counted); only the latest local day is
snapshotted after downtime (history cannot be reconstructed); an automatic price replaces a manual
one on the next refresh (the PRD says every crypto holding); a portfolio with no priced holding gets
no snapshot row, like it shows no total; the refresh never overwrites a price set after its request started;
retries back off from 15 to 60 minutes; an answer entry older than 24 hours is ignored; a request carries
at most 100 symbols, the least recently priced first.

## Coverage: PRD → blocks
| Requirement | Covered by |
|---|---|
| FR-01 | Block 1, Block 2, Block 3, Block 4, Block 5, Block 6 |
| FR-02 | Block 1, Block 2, Block 3, Block 5, Block 6 |
| NFR-01 | Strategy: one provider request per refresh cycle every 60 minutes (720 a month) for at most 100 symbols, and a persisted monthly counter (`crypto_price_usage`) that reserves one call before every request, failed attempts included, and refuses past 1,000; the schedule row, the retry backoff (15, 30, then 60 minutes) after consecutive failures and the 5-minute lease keep an outage from burning the budget; Block 2 tests simulate 45 days of hourly cycles and an outage and assert the counter never exceeds 1,000. |

## Dependencies between blocks
Block 2 depends on Block 1. Block 3 depends on Blocks 1 and 2 (it implements the ports declared in
Block 2). Block 4 depends on Blocks 1 and 2. Block 5 depends on Blocks 2, 3 and 4. Block 6 depends
on Blocks 3, 4 and 5. Execution order: 1, 2, 3, 4, 5, 6.

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
- `RefreshCryptoPrices.execute()` returns `not_due`, `no_crypto_holdings`, `budget_exhausted`, `refreshed { updated, unpriced }` or `failed { code }`: it claims the schedule (an atomic lease, `not_due` when another worker holds it or it is not due), reads the distinct crypto symbols (oldest price first, at most 250), returns `no_crypto_holdings` after rescheduling when there are none, reserves one call from the monthly counter before the request (`budget_exhausted` and a reschedule one interval later when 1,000 are used), calls the provider, applies the prices it returned with source `automatic` and the time the request started (FR-01), only to holdings whose latest price is older than that instant, so a manual price set while the request was in flight is never overwritten with an older one, and marks success. A symbol the provider did not return, or priced below one cent, is left untouched, which keeps its previous price (AC-02). A provider fault is recorded in the failure log, the schedule is moved ahead by the backoff of its consecutive failures (15, 30, 60 minutes), and the outcome is `failed`; a storage error propagates and the lease expiry retries.
- `TakeDailySnapshots.execute(now)`: for each time zone in use it computes `previousDate(localDateOf(now, zone))` (a zone that raises `RangeError` is skipped and counted), then walks the portfolios of that zone that have a priced holding and no snapshot for that date, in pages by portfolio id, skips a portfolio created after that local date (judged in JavaScript with `localDateOf` of its creation time), computes `totalsByCurrency` over their priced holdings with the shared helpers, and saves one row per currency in a single idempotent insert (FR-02, AC-03). A total above 2^63 - 1 skips that portfolio and counts it. It returns `{ saved, skippedOutOfRange, skippedZones }`.

**Input validation**
- Symbols come from stored tickers and are lowercased by the repository before the call; the use cases validate nothing else because they take no request data.

**Error handling**
- Provider fault: recorded with its code, schedule moved ahead by the backoff, outcome `failed`, previous prices untouched.
- Monthly budget used up: no provider call is made, outcome `budget_exhausted`.
- Invalid time zone: the zone is skipped and counted, other zones continue.
- A snapshot total out of the storable range: no row is written for that portfolio and it is counted.
- Storage errors propagate to the job, which logs them and tries again on the next pass.

**Required tests**
- [ ] `apps/api/test/investments/refresh-crypto-prices.test.ts` — with a fake provider answering btc and eth, every crypto holding of those symbols gets the price, source `automatic` and the clock time, other instrument types are untouched — validates AC-01.
- [ ] `apps/api/test/investments/refresh-crypto-prices.test.ts` — a provider failure (error) leaves every price as it was, records the code, moves the schedule 15 minutes ahead (30 after a second consecutive failure) and returns `failed`; a symbol missing from the answer and a sub-cent price keep the previous price — validates AC-02.
- [ ] `apps/api/test/investments/refresh-crypto-prices.test.ts` — two concurrent executions produce one provider call (the second is `not_due`); a second call before the interval is `not_due`; no crypto holdings reschedules without a call (duplicate claim, conflict).
- [ ] `apps/api/test/investments/refresh-crypto-prices.test.ts` — over 45 simulated days of hourly cycles plus a 3-day outage with 15-minute retries the reserved calls never exceed 1,000 in a calendar month and the 1,001st attempt returns `budget_exhausted` with no call (error: budget used up) — validates NFR-01.
- [ ] `apps/api/test/investments/take-daily-snapshots.test.ts` — a user in Buenos Aires and a user in UTC get their snapshot for their own previous local day at different instants, with the totals of the shared helpers (185,000.00 ARS and 500.00 USD) — validates AC-03.
- [ ] `apps/api/test/investments/take-daily-snapshots.test.ts` — running the use case twice for the same day writes one set of rows (duplicate run); a portfolio without priced holdings gets no row; a zone that raises `RangeError` is skipped and counted (invalid zone); a total above 2^63 - 1 is skipped and counted (error: out of range).

**Completion criterion**
`pnpm --filter @pesly/api exec vitest run test/investments/refresh-crypto-prices.test.ts test/investments/take-daily-snapshots.test.ts` passes with in-memory fakes and `pnpm typecheck` passes.

## Block 3 — Persistence: migration 0015, repositories and erasure registry

**Files**
- `apps/api/src/investments/infrastructure/db/schema.ts` (modified) — the four new tables, defined in the existing file because `drizzle.config.ts` only globs `./src/*/infrastructure/db/schema.ts`.
- `apps/api/src/investments/infrastructure/db/drizzle-crypto-price-repository.ts` (new) — distinct crypto symbols and the one-statement price update.
- `apps/api/src/investments/infrastructure/db/drizzle-price-schedule.ts` (new) — claim, success, failure and the monthly reservation.
- `apps/api/src/investments/infrastructure/db/drizzle-price-failure-log.ts` (new) — record and purge.
- `apps/api/src/investments/infrastructure/db/drizzle-snapshot-repository.ts` (new) — zones, portfolios to snapshot, idempotent save.
- `apps/api/drizzle/0015_price_snapshots.sql` (new, generated by `pnpm --filter @pesly/api exec drizzle-kit generate --name price_snapshots` after rebasing in CODE, provisional number: it takes the next free number then), its snapshot in `apps/api/drizzle/meta/`, the `apps/api/drizzle/meta/_journal.json` entry (modified), and `apps/api/drizzle/rollback/0015_price_snapshots.down.sql` (new).
- `apps/api/test/identity/user-erasure.test.ts` (modified) — the snapshot table in the erasure registry; `apps/api/test/identity/deletion-persistence.test.ts` (modified) — the snapshot row count in its erasure assertions.
- `apps/api/test/identity/migration.test.ts`, `apps/api/test/investments/investments-migration.test.ts` and `apps/api/test/deploy/build-output.test.ts` (modified) — the new migration in the rollback chains and the expected table lists. Both migration tests encode newest-first rollback by journal `when` (drizzle only re-applies migrations newer than the last recorded one), so the new migration's rollback goes first in every chain, `ALL_MIGRATIONS` and the `ALL_TABLES` lists gain it, and the test of the older `0013_investments` migration rolls back the newer one before its own; none of them asserts that a migration is the newest, only the order relative to known predecessors.

**Logic**
- The price and snapshot repositories act on every user's rows by design (a worker, not a request): this is the one deliberate exception to owner-scoped queries, so they are exported only through `apps/api/src/investments/jobs.ts`, never through the module barrel, and the raw `UPDATE ... FROM (VALUES ...)` is used because the ORM cannot express it (a comment states why). The rollback script drops the four tables and deletes its row from `drizzle.__drizzle_migrations` by the journal `when`, like the 0013 script, with a header stating what is destroyed.
- Migration number note: `0015` is provisional; main's last migration is 0013 and DISC-001-03b takes 0014. The migration is generated in CODE after rebasing, takes the next free number, and its journal `when` must be greater than every other `when` in the journal at push time; the tests never assert that it is the newest, only its order relative to known predecessors. A migration collision is resolved by whichever ticket merges later.
- The price update is one statement: `UPDATE holdings SET unit_price, price_source = 'automatic', priced_at, updated_at FROM (VALUES (symbol, price)...) WHERE instrument_type = 'crypto' AND valuation_currency = 'USD' AND lower(ticker) = symbol AND (priced_at IS NULL OR priced_at < requested_at)`, with every value a bound parameter and the price cast to `bigint`; it returns the number of holdings updated.
- The symbol read is `SELECT lower(ticker) ... WHERE instrument_type = 'crypto' GROUP BY lower(ticker) ORDER BY min(priced_at) NULLS FIRST, lower(ticker) LIMIT 100`, so symbols never priced come first and every symbol is eventually covered when there are more than 250.
- `claim` is the same atomic upsert as the rates schedule (`ON CONFLICT DO UPDATE ... WHERE next_attempt_at <= now`); `reserveCall(month)` is `INSERT (month, calls = 1) ... ON CONFLICT (month) DO UPDATE SET calls = calls + 1 WHERE calls < 1000 RETURNING calls`, so of two simultaneous reservations at the limit exactly one succeeds; the month key is the UTC `YYYY-MM` of the clock.
- The snapshot save inserts the rows of a portfolio with `ON CONFLICT DO NOTHING` inside one transaction, so a second worker cannot duplicate them and a crash writes all currencies of a day or none.
- Portfolios to snapshot are selected by zone with their priced holdings through the user's stored zone, excluding those that already have a row for the date, paged by portfolio id.

**Data model**
- Entity `crypto_price_sync`: `id` smallint primary key with check `id = 1`; `next_attempt_at` timestamptz not null; `last_success_at` timestamptz nullable; `consecutive_failures` integer not null default 0 with check `>= 0`.
- Entity `crypto_price_usage`: `month` text primary key with check `month ~ '^[0-9]{4}-[0-9]{2}$'`; `calls` integer not null default 0 with check `calls between 0 and 1000`.
- Entity `crypto_price_refresh_failures`: `id` uuid primary key default `gen_random_uuid()`; `failed_at` timestamptz not null; `code` text not null with check in the five failure codes; `status_code` smallint nullable with check between 100 and 599; `detail` text nullable with check `char_length(detail) <= 200`; index `crypto_price_refresh_failures_failed_at_idx` on `failed_at`.
- Entity `portfolio_value_snapshots`: `portfolio_id` uuid not null; `owner_id` uuid not null; composite foreign key `(portfolio_id, owner_id)` to `portfolios(id, owner_id)` on delete cascade, so a snapshot can never carry another owner than its portfolio; `snapshot_date` date not null; `currency` text not null with check in `('ARS', 'USD')`; `total_value` bigint (`mode: 'bigint'`) not null with check `total_value >= 0`; `taken_at` timestamptz not null; primary key `(portfolio_id, snapshot_date, currency)`; index `portfolio_value_snapshots_owner_date_idx` on `(owner_id, snapshot_date)`.
- No floating-point column in any entity. The snapshot table references users only through `portfolios`, so deleting a user cascades to it (register it in the erasure guard).

**Input validation**
- Repositories receive validated domain values and rely on the check constraints as the last line of defense; every value reaches SQL as a bound parameter, never concatenated.

**Error handling**
- A unique conflict on a snapshot row is the idempotent case and is swallowed by `DO NOTHING`; any other constraint violation is a programming error and propagates as an error.
- A stale lease changes nothing (the update is keyed on the lease value).
- A deadlock or connection error propagates; the job logs it and tries again on the next pass.

**Required tests**
- [ ] `apps/api/test/investments/price-repositories.test.ts` — `applyPrices` updates only crypto holdings in USD of the priced symbols (case-insensitive), sets source `automatic` and the time, leaves other types and other symbols untouched — validates AC-01.
- [ ] `apps/api/test/investments/price-repositories.test.ts` — symbols never priced come first, at most 100 are returned, a database error propagates, and the update with a bad (negative) price is rejected by the check constraint (invalid row) — validates AC-02.
- [ ] `apps/api/test/investments/price-schedule.test.ts` — two simultaneous claims give one owner (conflict), a stale lease updates nothing, success and failure move `next_attempt_at`, and two simultaneous reservations at 999 calls give exactly one success while the 1,001st is refused — validates NFR-01.
- [ ] `apps/api/test/investments/snapshot-repository.test.ts` — saving twice for the same portfolio and date stores one set of rows (duplicate), the portfolio query skips portfolios that already have a row, excludes unpriced holdings, pages by id, and returns a portfolio only in its owner's zone — validates AC-03.
- [ ] `apps/api/test/investments/snapshot-repository.test.ts` — a snapshot with an owner different from its portfolio's owner is rejected by the composite foreign key, a negative total and an unknown currency are rejected by the check constraints (invalid rows).
- [ ] `apps/api/test/investments/price-migration.test.ts` — the migration applies on a database holding the earlier migrations, the four tables, constraints and indexes exist, its rollback script restores the previous state and it can be applied again.
- [ ] `apps/api/test/identity/user-erasure.test.ts` — `portfolio_value_snapshots` is registered with a seeder; the guard reports no violation and deleting the user removes its snapshots (cascade).
- [ ] `apps/api/test/identity/migration.test.ts`, `apps/api/test/investments/investments-migration.test.ts` and `apps/api/test/deploy/build-output.test.ts` — still pass with the new migration first in every rollback chain and in the expected table lists, with no "newest migration" assertion (regression of the existing migration tests).
- [ ] `apps/api/test/investments/price-repositories.test.ts` — a manual price set after the request started (a later `priced_at`) is not overwritten by the update, while an older price is replaced (conflict between a manual price and an in-flight refresh) — validates AC-01.

**Completion criterion**
`pnpm --filter @pesly/api exec vitest run test/investments/price-repositories.test.ts test/investments/price-schedule.test.ts test/investments/snapshot-repository.test.ts test/investments/price-migration.test.ts test/investments/investments-migration.test.ts test/identity/user-erasure.test.ts test/identity/deletion-persistence.test.ts test/identity/migration.test.ts test/deploy/build-output.test.ts` passes against PostgreSQL, `drizzle-kit generate` reports no changes afterwards, and `pnpm typecheck` passes.

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
- Worker environment: `PRICE_PROVIDER` is `coingecko` or `fake` (default `coingecko`), `COINGECKO_BASE_URL` defaults to `https://api.coingecko.com/api/v3`, `COINGECKO_API_KEY` is optional. In production the provider must be `coingecko` and the base URL must be the default; the key is optional so a missing secret never stops the email worker from starting, and the worker logs once that it runs without a key. The worker fields are shared by the API settings parser (as `RATE_PROVIDER` already is), so the API parses and ignores these settings and never imports the adapter; the settings module gains a `COINGECKO_BASE_URL_DEFAULT` export, treats an empty key as unset, and `env.ts` extends its raw worker type and production rules.

**Input validation**
- The only request data is the list of symbols, built from stored tickers that match `^[A-Za-z0-9][A-Za-z0-9._/-]*$` (07a); the adapter drops symbols containing characters outside `[a-z0-9._-]` after lowercasing, so a stored ticker can never inject query text, and it URL-encodes the joined value.
- Environment values are validated by Zod at start; a violation names the variable, never its value.

**Error handling**
- Each fault of the mapping above becomes a typed failure with its code; no provider text, no key and no URL query reaches a log or the failure log.
- A missing key is not an error; a base URL other than the default in production is a start-up error naming `COINGECKO_BASE_URL`.

**Required tests**
- [ ] `apps/api/test/investments/coingecko-price-provider.test.ts` — against a local test server, a valid answer for btc and eth returns 6789012 and 351234 cents from the digits of the JSON, the request carries `vs_currency=usd`, the joined lowercase symbols, `precision=full` and the key header, and no key in the URL — validates AC-01.
- [ ] `apps/api/test/investments/coingecko-price-provider.test.ts` — status 429 is `provider_rate_limited`, status 500 is `provider_bad_status`, a refused connection is `provider_unreachable`, a slow server is `provider_timeout`, HTML content, malformed JSON, a non-array body and a body over 512 KiB are `provider_invalid_payload`, a redirect is not followed (error cases) — validates AC-02.
- [ ] `apps/api/test/investments/coingecko-payload.test.ts` — a null or sub-cent price and an entry without a symbol are ignored (no price kept), a repeated symbol keeps the better rank, unrequested symbols are dropped, an exponent price (`1.5e3`) is read exactly, and a stored ticker with a space or an ampersand is dropped from the request (injection-shaped symbol) — validates AC-02.
- [ ] `apps/api/test/investments/fake-price-provider.test.ts` — the fake answers deterministic prices, counts calls and fails on demand.
- [ ] `apps/api/test/foundation/worker-env.test.ts` and `apps/api/test/foundation/env.test.ts` — `PRICE_PROVIDER` defaults to `coingecko`, production rejects `fake` and a non-default base URL naming the variable (error), accepts a missing or empty key, and rejects an invalid URL, for the worker parser and for the API parser (extends the existing tests).
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
- `SnapshotJob` polls every 5 minutes, runs `TakeDailySnapshots.execute(clock.now())`, logs the counts (a skipped out-of-range portfolio is logged once per zone and local date, from an in-memory set that only suppresses repeats), and shares the same stop semantics.
- `jobs.ts` is the only place that builds the provider-backed jobs, and the worker imports it directly; the API process imports the module barrel `apps/api/src/investments/index.ts` and `server.ts` only, so no provider, job or `fetch` call is reachable from a user request (AGENTS.md: external services never in the request path).
- The worker keeps its existing `email worker started` and `rates sync started` log lines unchanged and adds `price sync started` and `snapshot job started`.

**Input validation**
- The jobs take no request data; their only inputs are the configuration parsed in Block 4 and the clock.

**Error handling**
- A storage error in a pass is logged with the error object and the next pass runs; the process does not exit.
- A provider fault is an outcome logged by code only.
- A failed purge is logged and retried at the next purge interval; it never stops a refresh.

**Required tests**
- [ ] `apps/api/test/investments/price-sync-job.test.ts` — with the fake provider and real repositories on the test database, one pass refreshes a crypto holding to source `automatic` (AC-01); a provider failure (error) keeps the price and the next pass inside the retry delay makes no call (AC-02); a failing storage layer is logged and the next pass still runs (error); `stop()` waits for the pass in progress.
- [ ] `apps/api/test/investments/snapshot-job.test.ts` — with a mutable clock, a pass just after local midnight in two zones stores each portfolio's snapshot for its own previous day once, a second pass stores nothing, and a pass for an invalid zone logs and continues (AC-03, invalid zone).
- [ ] `apps/api/test/investments/request-path.test.ts` — the transitive import closure of the API entry (`server.ts`, `app.ts` and the investments barrel, which is legitimately imported) contains no module under `infrastructure/provider/`, `infrastructure/jobs/`, `jobs.ts`, `refresh-crypto-prices` or `take-daily-snapshots`, a stricter version of the exchange-rates request-path test (a deliberate violation probe is detected as an error).
- [ ] `apps/api/test/investments/investments-jobs.test.ts` — `createInvestmentsJobs` with the fake provider starts both jobs, `stop()` waits for both passes, and stopping twice is harmless (error: double stop); the `email worker started` log line of `worker.ts` is unchanged (the e2e server waits on it).

**Completion criterion**
`pnpm --filter @pesly/api exec vitest run test/investments/price-sync-job.test.ts test/investments/snapshot-job.test.ts test/investments/investments-jobs.test.ts test/investments/request-path.test.ts test/foundation` passes and `pnpm typecheck` passes.

## Block 6 — Cross-cutting checks and end-to-end step

**Files**
- `apps/api/test/investments/price-sync-integration.test.ts` (new) — the worker-level flow on the real database.
- `apps/web/e2e/investments.spec.ts` (modified) — one extra step for the automatic price.
- `apps/api/test/investments/no-float-money.test.ts` (modified) — its `offendersIn` helper takes a directory so the probe case can scan a temporary one; the scan itself already walks every file under `apps/api/src/investments`.

**Logic**
- The integration test creates users with portfolios and crypto holdings, runs the price and snapshot use cases with the fake provider and a mutable clock through the 24-hour cycle (a refresh, an outage, a recovery, local midnight in two zones) and checks the stored prices, the failure log, the monthly counter and the snapshots.
- The end-to-end step adds a crypto holding `BTC` in USD, waits for the worker (running with `PRICE_PROVIDER=fake`) to refresh it, and expects the screen to show the automatic price and the value; it uses the catalog texts for the source label.
- The no-float scan already walks `apps/api/src/investments`; the change adds a probe that proves the scan flags a forbidden token in a new directory.

**Input validation**
- The tests use only values accepted by the contracts and the repositories; no real external service is called.

**Error handling**
- The integration test asserts the outage path (failure recorded, prices unchanged, counter incremented once per attempt) and the recovery path.
- The end-to-end step uses a unique email per run and waits for visible text, never for fixed time.

**Required tests**
- [ ] `apps/api/test/investments/price-sync-integration.test.ts` — a full cycle with the fake provider updates every crypto holding to `automatic` (AC-01), an outage keeps the previous prices and increments the counter once per attempt (AC-02), and the next local midnight stores one snapshot per portfolio and currency with the same totals the screen computes (AC-03), all on the real database.
- [ ] `apps/api/test/investments/price-sync-integration.test.ts` — the counter never exceeds 1,000 across the simulated month and the failure log never contains provider text or the key (error path, NFR-01).
- [ ] `apps/web/e2e/investments.spec.ts` — a crypto holding gets its automatic price from the worker and the screen shows the source and the value (AC-01).
- [ ] `apps/api/test/investments/no-float-money.test.ts` — the scan fails for a probe file with `parseFloat` in a new job directory (invalid source).

**Completion criterion**
`pnpm --filter @pesly/api exec vitest run test/investments/price-sync-integration.test.ts test/investments/no-float-money.test.ts` passes, `pnpm e2e` passes `investments.spec.ts` with the worker on the fake provider, and the SAST scan in CODE finds no secret, injection or logging finding.

## Final verification
- Every FR, NFR and AC of the PRD is covered by the table and by named tests.
- `pnpm lint`, `pnpm typecheck`, `pnpm test:coverage` (80% floor), `pnpm e2e` pass; no test calls CoinGecko.
- The provider is only reachable from the worker; the API process imports no provider, job or job factory.
- The migration applies and rolls back, `drizzle-kit generate` reports no changes, and its number and `when` are checked against main at push time.
- The two design choices marked "to confirm" are decided by the human before CODE starts.

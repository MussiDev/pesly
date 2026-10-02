# Threat model DISC-001-07b: Crypto Prices and Daily Portfolio Snapshots

| Field | Value |
|-------|-------|
| Ticket | DISC-001-07b |
| Spec | docs/ddw/specs/spec-DISC-001-07b.md |
| Tier | FEATURE |
| Date | 2026-10-02 |

## Components
| Component | Source in the spec |
|---|---|
| `apps/api/src/investments/domain/crypto-price.ts` (`usdPriceToMinorUnits`) + `snapshot-date.ts` + `price-failure.ts` | Block 1 |
| `apps/api/src/investments/application/refresh-crypto-prices.ts` + `take-daily-snapshots.ts` + `price-ports.ts` | Block 2 |
| `apps/api/src/investments/infrastructure/db/schema.ts` (`crypto_price_sync`, `crypto_price_usage`, `crypto_price_refresh_failures`, `portfolio_value_snapshots`) + `apps/api/drizzle/0015_price_snapshots.sql` | Block 3 |
| `apps/api/src/investments/infrastructure/db/drizzle-crypto-price-repository.ts` + `drizzle-price-schedule.ts` + `drizzle-price-failure-log.ts` + `drizzle-snapshot-repository.ts` | Block 3 |
| `apps/api/src/investments/infrastructure/provider/coingecko-price-provider.ts` + `coingecko-payload.ts` (request to `{base}/coins/markets`) | Block 4 |
| `apps/api/src/shared/config/env.ts` (`PRICE_PROVIDER`, `COINGECKO_BASE_URL`, `COINGECKO_API_KEY`) + `.railway/railway.ts` | Block 4 |
| `apps/api/src/investments/infrastructure/jobs/price-sync-job.ts` + `snapshot-job.ts` + `apps/api/src/investments/jobs.ts` + `apps/api/src/worker.ts` | Block 5 |

## Trust boundaries
- Worker → CoinGecko API: public internet; the symbols of users' crypto tickers leave the system and a JSON body comes back, over TLS, to the one configured host.
- CoinGecko → worker (response): untrusted data entering trusted code; it is parsed strictly before any value reaches the database.
- Worker → PostgreSQL: private network; prices, schedule, counters, snapshots, always as bound parameters.
- Railway secrets → worker environment: `COINGECKO_API_KEY` crosses into the process; it never crosses into the API process.
- API process ↔ worker process: no direct channel; both talk only through the database, so the API request path never reaches the provider.
- Users' stored data (tickers, time zones) → provider request and job logic: user-controlled text influencing an outbound request and a time computation.

## STRIDE analysis
### `apps/api/src/investments/domain/crypto-price.ts` (`usdPriceToMinorUnits`) + `snapshot-date.ts` + `price-failure.ts`
- **Spoofing:** not applicable to pure conversions; no identity is involved.
- **Tampering:** the price text is read with a strict grammar capped at 40 characters and converted with `BigInt` from its digits, so a crafted number (huge exponent, NaN, negative, sub-cent) is rejected and never reaches storage as a wrong integer (R-03, R-07).
- **Repudiation:** the conversion keeps no state; accountability is the stored `priced_at` and source `automatic`.
- **Information Disclosure:** failures carry a code and an optional short detail naming an item, never provider text or the key (R-02, R-10).
- **Denial of Service:** the grammar is linear and the exponent is bounded before any power is computed, so `1e999999999` cannot allocate a huge integer (R-07).
- **Elevation of Privilege:** no privileges involved; the domain imports nothing from infrastructure.

### `apps/api/src/investments/application/refresh-crypto-prices.ts` + `take-daily-snapshots.ts` + `price-ports.ts`
- **Spoofing:** only the worker composes these use cases; no route calls them (R-15).
- **Tampering:** the schedule claim and the monthly reservation are atomic statements, so two workers cannot both call the provider or exceed the budget (R-04, R-05); a provider answer is applied only for requested symbols (R-03).
- **Repudiation:** every refresh outcome and every provider fault code is logged and the fault is stored in the failure log with its time.
- **Information Disclosure:** outcomes are counts and codes; no holding, quantity or user id is logged by the use cases.
- **Denial of Service:** at most 100 symbols and one request per cycle, a retry backoff (15, 30, 60 minutes) and a hard monthly cap of 1,000 reservations bound both the provider load and the cost of an outage (R-04); an invalid time zone skips only that zone (R-09).
- **Elevation of Privilege:** snapshot rows are written under the owner of each portfolio, taken from the portfolio row, never from input (R-08).

### `apps/api/src/investments/infrastructure/db/schema.ts` (`crypto_price_sync`, `crypto_price_usage`, `crypto_price_refresh_failures`, `portfolio_value_snapshots`) + `apps/api/drizzle/0015_price_snapshots.sql`
- **Spoofing:** not applicable to storage.
- **Tampering:** check constraints bound the counter (0 to 1,000), the single schedule row, the failure code, and the snapshot value and currency; the composite foreign key `(portfolio_id, owner_id)` makes a snapshot under another owner impossible and the primary key `(portfolio_id, snapshot_date, currency)` makes a duplicate day impossible (R-08).
- **Repudiation:** `taken_at` and `failed_at` timestamps record when a snapshot or a fault happened.
- **Information Disclosure:** snapshots are financial data in the application database whose volume is encrypted with AES-256; the failure log holds codes only (R-10).
- **Denial of Service:** one row per portfolio, day and currency, indexed by owner and date; failures are purged after 30 days.
- **Elevation of Privilege:** deleting a user cascades through the portfolios to the snapshots, and the erasure guard test fails until the table is registered (R-12).

### `apps/api/src/investments/infrastructure/db/drizzle-crypto-price-repository.ts` + `drizzle-price-schedule.ts` + `drizzle-price-failure-log.ts` + `drizzle-snapshot-repository.ts`
- **Spoofing:** not applicable; the repositories run in the worker with no user scope because they act on every user's holdings by design.
- **Tampering:** the bulk price update binds every symbol and price as parameters and is restricted to crypto holdings in USD (`UPDATE ... FROM (VALUES ...)`), so a ticker such as `'; drop table` is data and cannot change another instrument type (R-06); the check constraints of 07a still apply to the written price.
- **Repudiation:** updated holdings carry `price_source = 'automatic'` and `priced_at`, so an automatic price is distinguishable from a manual one.
- **Information Disclosure:** repositories return symbols and counts, never user ids to the provider layer.
- **Denial of Service:** the symbol read is limited to 100 and ordered by oldest price; the snapshot query pages by portfolio id (200 per page).
- **Elevation of Privilege:** a worker-only repository set is not exported through the API barrel (R-15).

### `apps/api/src/investments/infrastructure/provider/coingecko-price-provider.ts` + `coingecko-payload.ts`
- **Spoofing:** the base URL is pinned to the default CoinGecko host in production, so the worker's request and the key cannot be redirected to another host (R-01); redirects are not followed.
- **Tampering:** a hostile or faulty answer is limited by a 512 KiB body cap, a JSON content-type check, a strict parse, price bounds, a lowercase-symbol allowlist and the rule that only requested symbols are returned (R-03).
- **Repudiation:** each fault is mapped to a code and logged by code; the request time is recorded by the schedule.
- **Information Disclosure:** the key travels only in the `x-cg-demo-api-key` header over TLS, never in a URL, a log, the failure log or the database (R-02); the request exposes only the lowercase tickers of crypto holdings, not users.
- **Denial of Service:** a 10-second timeout well below the 5-minute lease; status 429 is a distinct failure with the retry delay; the monthly counter blocks a request loop (R-04).
- **Elevation of Privilege:** the adapter returns data only; it has no database access.

### `apps/api/src/shared/config/env.ts` (`PRICE_PROVIDER`, `COINGECKO_BASE_URL`, `COINGECKO_API_KEY`) + `.railway/railway.ts`
- **Spoofing:** production refuses `PRICE_PROVIDER=fake`, so canned prices cannot be shipped by a misconfiguration (R-01).
- **Tampering:** production refuses a non-default base URL; the key is declared with `preserve()` so infrastructure-as-code never overwrites or prints it.
- **Repudiation:** a start-up validation error names the variable and the rule, never the value.
- **Information Disclosure:** `COINGECKO_API_KEY` is declared only on the worker service, so the API process does not receive it (R-02).
- **Denial of Service:** the key is optional, so a missing secret cannot stop the email worker from starting; the worker logs once that it runs without a key.
- **Elevation of Privilege:** the worker's environment parser reads only the settings the worker needs.

### `apps/api/src/investments/infrastructure/jobs/price-sync-job.ts` + `snapshot-job.ts` + `apps/api/src/investments/jobs.ts` + `apps/api/src/worker.ts`
- **Spoofing:** the jobs run only in the worker process, started by `worker.ts`; the API entry does not import them (R-15).
- **Tampering:** all coordination is through database statements (lease, reservation, idempotent insert), so a duplicated worker or a restarted one cannot corrupt the schedule (R-05, R-08).
- **Repudiation:** each pass logs its outcome and counts; errors are logged with the error object, not provider text.
- **Information Disclosure:** logs hold outcomes, codes and counts only (R-10).
- **Denial of Service:** a pass that errors is logged and the next one runs; `stop()` waits for the pass in progress, so shutdown cannot leave a half-applied update because each write is one statement or one transaction.
- **Elevation of Privilege:** the worker holds database credentials already used by the email worker; no new privilege is added.

## Data classification
| Data | Class | At rest | In transit |
|---|---|---|---|
| `COINGECKO_API_KEY` | credentials | Railway secret on the worker service only; never in the database, logs or the failure log | TLS 1.2+ in a request header to the pinned host |
| crypto symbols sent to the provider | public | derived from tickers; not stored by the provider path | TLS 1.2+ |
| provider prices (USD) | public | `holdings.unit_price` in minor units; database volume encrypted with AES-256 | TLS 1.2+ |
| `portfolio_value_snapshots` (owner id, date, currency, total value) | financial | `bigint` columns in PostgreSQL; database volume encrypted with AES-256; never logged | TLS 1.2+ between the worker and the database |
| owner user id on snapshots | PII | foreign key to `users.id`; database volume encrypted with AES-256; opaque id only | TLS 1.2+ |
| failure log (code, status, short detail) | public | `crypto_price_refresh_failures`; no provider text, purged after 30 days | TLS 1.2+ |

## Risks and mitigations
| ID | Risk | STRIDE | Likelihood | Impact | Mitigation |
|---|---|---|---|---|---|
| R-01 | The worker's provider request (and key) is redirected to another host through configuration | S | L | H | production rejects a non-default `COINGECKO_BASE_URL` and `PRICE_PROVIDER=fake`; redirects are not followed; HTTPS only |
| R-02 | The API key leaks through logs, URLs, the failure log or the API process | I | M | M | header only, never logged or stored, declared with `preserve()` on the worker service only, tests assert it is absent from the failure log and from the request URL |
| R-03 | A malformed, hostile or faulty provider answer writes a wrong price (absurd value, huge exponent, wrong symbol) | T | M | H | strict parsing from the digits with `BigInt`, bounds of 1 cent to 10^12 minor units, only requested symbols returned, 512 KiB body cap, content-type check, a price that fails validation keeps the previous price |
| R-04 | Request loops or an outage exhaust the provider's quota or the monthly budget | D | M | M | one request per cycle, retry backoff of 15, 30 and 60 minutes, monthly counter reserved before every request (failed attempts included) with a hard cap of 1,000, simulated in tests |
| R-05 | Two workers refresh at the same time and duplicate provider calls | T | M | L | atomic schedule claim that doubles as a lease, a stale lease changes nothing |
| R-06 | SQL injection through a ticker in the bulk price update | T | L | H | every value is a bound parameter, symbols are filtered to `[a-z0-9._-]` before the request, the update is limited to crypto holdings in USD, a test stores an injection-shaped ticker as data |
| R-07 | Floating-point or overflow errors in price conversion | T | M | H | conversion from the JSON source text with `BigInt` only (`context.source`), no `parseFloat` or `Number`, exponent bounded, the existing no-float scan covers the new files |
| R-08 | A snapshot is duplicated or attributed to another owner | T | L | M | primary key `(portfolio_id, snapshot_date, currency)` with `ON CONFLICT DO NOTHING`, composite foreign key to `portfolios(id, owner_id)`, owner taken from the portfolio row |
| R-09 | A user's stored time zone breaks or stalls the snapshot job | D | L | M | zones are processed one by one with `Intl`, an invalid zone raises `RangeError` that is caught, logged and skipped, there is no SQL time zone arithmetic |
| R-10 | Provider text or personal data reaches logs or the failure log | I | M | M | failures carry a code, a status code and an optional detail naming an item (at most 200 characters, a check constraint); logs carry outcomes and counts only |
| R-11 | A slow provider call outlives its lease and two workers overlap | D | L | L | 10-second timeout against a 5-minute lease; a stale owner's updates are keyed on the lease and change nothing |
| R-12 | Snapshots survive account deletion | I | L | M | `ON DELETE CASCADE` through the portfolios and registration of `portfolio_value_snapshots` in the user-erasure guard, whose test fails until it is registered |
| R-13 | A stale price is shown as current | I | M | M | `priced_at` is written only for holdings that received a price in that cycle, so a symbol without an answer keeps its old date and the 7-day stale flag of 07a applies |
| R-14 | The API process calls the provider in a user request, or ships provider code | E | L | H | provider, jobs and factories are exported only from `apps/api/src/investments/jobs.ts`, a request-path test fails when the API entry reaches them |
| R-15 | A snapshot total above the storable range corrupts or aborts the pass | D | L | L | totals above 2^63 - 1 skip that portfolio and are counted, no row is written, other portfolios continue |
| R-16 | A ticker shared by several coins resolves to an unintended coin and prices a holding wrongly | T | M | M | accepted, see below |
| R-17 | An automatic price silently replaces a manual price of the same holding | T | M | L | the update only touches holdings priced before the request started, so a manual price set while a refresh is in flight is never overwritten with an older one; a manual price set earlier is replaced at the next refresh (accepted, see below) |

## Accepted risks
### R-16
- **Accepted by:** project owner (user) — confirmation requested in the DISC-001-07b PLAN report of 2026-10-02 and not yet given.
- **Justification:** CoinGecko resolves a symbol to the top-ranked coin by market cap, which is correct for the major coins users hold; the PRD defines the crypto ticker as the lookup key and adds no coin identifier; the price source and date stay visible on every holding so a wrong price can be spotted and corrected; the alternative of storing a CoinGecko id per holding changes the 07a contracts and PRD.
- **Review conditions:** when the owner decides the question in the PLAN report, or the first time a user reports a wrong automatic price, whichever comes first.

### R-17
- **Accepted by:** project owner (user) — confirmation requested in the DISC-001-07b PLAN report of 2026-10-02 and not yet given.
- **Justification:** the PRD says the refresh updates the unit price of every crypto holding; a manual price on a crypto holding is therefore replaced at the next hourly refresh, and the holding shows source `automatic` with its time.
- **Review conditions:** if users ask to pin a manual price on a crypto holding, or when 07c imports prices.

## Supply chain
No new runtime dependency: the adapter uses the platform `fetch`, `AbortSignal.timeout` and `JSON.parse`, validation uses `zod` (already in the lockfile) and the arithmetic uses `BigInt`. One new external service, CoinGecko, reached only from the worker through the single `PriceProvider` adapter; tests use the fake and a local test server, never CoinGecko.

## Availability
If CoinGecko is down, slow or rate limiting, the refresh fails with a code, prices keep their last value and date (the stale flag appears after 7 days), retries back off from 15 to 60 minutes within the monthly cap of 1,000 calls, and nothing else in the product is affected because the API never calls the provider. If the budget is used up, refreshes pause until the next UTC month. Snapshots do not depend on the provider: they use whatever prices exist at the end of the local day. A restarted or duplicated worker is safe because every write is an atomic claim, a single statement or an idempotent insert.

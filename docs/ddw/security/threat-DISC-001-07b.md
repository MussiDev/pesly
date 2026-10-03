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
| `apps/api/src/investments/infrastructure/db/schema.ts` (`crypto_price_sync`, `crypto_price_usage`, `crypto_price_refresh_failures`, `crypto_market_prices`, `portfolio_value_snapshots`) + `apps/api/drizzle/0015_price_snapshots.sql` | Block 3 |
| `apps/api/src/investments/infrastructure/db/drizzle-crypto-price-repository.ts` + `drizzle-price-schedule.ts` + `drizzle-price-failure-log.ts` + `drizzle-snapshot-repository.ts` | Block 3 |
| `apps/api/src/investments/infrastructure/provider/coingecko-price-provider.ts` + `coingecko-payload.ts` (request to `{base}/coins/markets`) | Block 4 |
| `apps/api/src/shared/config/env.ts` (`PRICE_PROVIDER`, `COINGECKO_BASE_URL`, `COINGECKO_API_KEY`) + `.railway/railway.ts` | Block 4 |
| `apps/api/src/investments/infrastructure/jobs/price-sync-job.ts` + `snapshot-job.ts` + `apps/api/src/investments/jobs.ts` + `apps/api/src/worker.ts` | Block 5 |
| `apps/api/src/investments/infrastructure/http/holding-routes.ts` (`POST /investments/holdings/:holdingId/automatic-price`) + `apps/api/src/investments/application/holding-use-cases.ts` (`UseAutomaticPrice`) + `apps/api/src/investments/application/portfolio-view.ts` | Block 6 |
| `apps/api/src/investments/infrastructure/db/drizzle-market-price-reader.ts` | Block 3, Block 6 |
| `apps/web/src/features/investments/components/holding-row.tsx` + `apps/web/src/features/investments/containers/investments-container.tsx` | Block 7 |

## Trust boundaries
- Worker → CoinGecko API: public internet; the symbols of users' crypto tickers leave the system and a JSON body comes back, over TLS, to the one configured host.
- CoinGecko → worker (response): untrusted data entering trusted code; it is parsed strictly before any value reaches the database.
- Worker → PostgreSQL: private network; prices, schedule, counters, snapshots, always as bound parameters.
- Railway secrets → worker environment: `COINGECKO_API_KEY` crosses into the process; it never crosses into the API process.
- API process ↔ worker process: no direct channel; both talk only through the database, so the API request path never reaches the provider.
- Users' stored data (tickers, time zones) → provider request and job logic: user-controlled text influencing an outbound request and a time computation.
- Browser → API: `POST /investments/holdings/:holdingId/automatic-price` carries a session and a holding id chosen by the caller, over TLS.
- Worker → API process through `crypto_market_prices`: public market data written by the worker and read by the API, never user data and never a write from the API.

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
- **Tampering:** the schedule claim and the monthly reservation are atomic statements, so two workers cannot both call the provider or exceed the budget (R-04, R-05); a provider answer is applied only for requested symbols (R-03), and an automatic price is never applied to a holding that carries a manual price, including one set while the request was in flight (R-17).
- **Repudiation:** every refresh outcome and every provider fault code is logged and the fault is stored in the failure log with its time.
- **Information Disclosure:** outcomes are counts and codes; no holding, quantity or user id is logged by the use cases.
- **Denial of Service:** at most 100 symbols and one request per cycle, a retry backoff (15, 30, 60 minutes) and a hard monthly cap of 1,000 reservations bound both the provider load and the cost of an outage (R-04); an invalid time zone skips only that zone (R-09).
- **Elevation of Privilege:** snapshot rows are written under the owner of each portfolio, taken from the portfolio row, never from input (R-08).

### `apps/api/src/investments/infrastructure/db/schema.ts` (`crypto_price_sync`, `crypto_price_usage`, `crypto_price_refresh_failures`, `crypto_market_prices`, `portfolio_value_snapshots`) + `apps/api/drizzle/0015_price_snapshots.sql`
- **Spoofing:** not applicable to storage.
- **Tampering:** check constraints bound the counter (0 to 1,000), the single schedule row, the failure code, and the snapshot value and currency; the composite foreign key `(portfolio_id, owner_id)` makes a snapshot under another owner impossible and the primary key `(portfolio_id, snapshot_date, currency)` makes a duplicate day impossible (R-08).
- **Repudiation:** `taken_at` and `failed_at` timestamps record when a snapshot or a fault happened.
- **Information Disclosure:** snapshots are financial data in the application database whose volume is encrypted with AES-256; the failure log holds codes only (R-10).
- **Denial of Service:** one row per portfolio, day and currency, indexed by owner and date; failures are purged after 30 days.
- **Elevation of Privilege:** deleting a user cascades through the portfolios to the snapshots, and the erasure guard test fails until the table is registered (R-12).

### `apps/api/src/investments/infrastructure/db/drizzle-crypto-price-repository.ts` + `drizzle-price-schedule.ts` + `drizzle-price-failure-log.ts` + `drizzle-snapshot-repository.ts`
- **Spoofing:** not applicable; the repositories run in the worker with no user scope because they act on every user's holdings by design.
- **Tampering:** the two statements of `storeAndApply` run in one transaction, bind every symbol and price as parameters and the holdings update is restricted to crypto holdings in USD without a manual price, so a ticker such as `'; drop table` is data and cannot change another instrument type (R-06) and a manual price is never replaced (R-17); the check constraints of 07a and of the market price entity still apply to the written price.
- **Repudiation:** updated holdings carry `price_source = 'automatic'` and `priced_at`, so an automatic price is distinguishable from a manual one, and the market price keeps its own time.
- **Information Disclosure:** repositories return symbols and counts, never user ids to the provider layer.
- **Denial of Service:** the symbol read is limited to 100, gives half of the slots to the oldest priced symbols and draws the rest at random among never-priced ones, so neither manually priced holdings nor junk tickers can starve other symbols (R-20); the snapshot query pages by portfolio id (200 per page).
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

### `apps/api/src/investments/infrastructure/http/holding-routes.ts` (`POST /investments/holdings/:holdingId/automatic-price`) + `apps/api/src/investments/application/holding-use-cases.ts` (`UseAutomaticPrice`) + `apps/api/src/investments/application/portfolio-view.ts`
- **Spoofing:** the route requires the same session as the other holding routes, and the owner always comes from the session, never from the request (R-19).
- **Tampering:** the only value written is the stored public market price, taken server-side; the caller supplies no price and no body, so a crafted amount cannot reach the holding (R-19).
- **Repudiation:** the mutation is logged with the request id, the user id and the holding id under the action `holding.automatic-price`, never an amount.
- **Information Disclosure:** another user's holding answers 404, the same as an unknown id, so ids cannot be probed; the response carries only the caller's own holding and public market data (R-19, R-18).
- **Denial of Service:** one holding read, one market lookup and one update per call, behind the same rate limits as the other holding routes; the list and read paths make at most one market query per call and none without a crypto holding.
- **Elevation of Privilege:** the owner-scoped repository and the write scope are the only way to reach a holding, so the route cannot switch another user's price (R-19).

### `apps/api/src/investments/infrastructure/db/drizzle-market-price-reader.ts`
- **Spoofing:** not applicable; it is read-only code inside the API process with no identity of its own.
- **Tampering:** it issues only a `SELECT` with bound symbols; it has no write path, and the worker repository that writes market prices is never imported by the API (R-14).
- **Repudiation:** a read changes nothing; the stored price carries its own `priced_at`.
- **Information Disclosure:** the entity holds public market prices only, with no owner column, so a read cannot reveal any user's holdings.
- **Denial of Service:** one query per request by primary key, skipped when the list of symbols is empty (R-14).
- **Elevation of Privilege:** it has no foreign key to user data and returns no user ids.

### `apps/web/src/features/investments/components/holding-row.tsx` + `apps/web/src/features/investments/containers/investments-container.tsx`
- **Spoofing:** the container calls the API through the shared client with the session cookie; the row has no network code.
- **Tampering:** the row renders values the response contract already validated and sends only the holding id; the market price shown is read-only text (R-18).
- **Repudiation:** the switch is a user action recorded by the API log line of the route; the row keeps no hidden state.
- **Information Disclosure:** the warning text is built from the catalogs and a price formatted with the locale formatter; it prints no ticker or amount outside the user's own screen, and nothing is logged in the browser.
- **Denial of Service:** one POST per click; the button is rendered only when the server flag is true and an unavailable state is shown as a portfolio failure message.
- **Elevation of Privilege:** the button is a convenience; the API decides access again with the session and the owner scope (R-19).

## Data classification
| Data | Class | At rest | In transit |
|---|---|---|---|
| `COINGECKO_API_KEY` | credentials | Railway secret on the worker service only; never in the database, logs or the failure log | TLS 1.2+ in a request header to the pinned host |
| crypto symbols sent to the provider | public | derived from tickers; not stored by the provider path | TLS 1.2+ |
| provider prices (USD) | public | `holdings.unit_price` and `crypto_market_prices.unit_price` in minor units; database volume encrypted with AES-256 | TLS 1.2+ |
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
| R-15 | A snapshot total above the storable range corrupts or aborts the pass | D | L | L | totals above 2^63 - 1 skip that portfolio's snapshot for the day, are logged once per zone and date, and the pass continues with the other portfolios (owner decision of 2026-10-02) |
| R-16 | A ticker shared by several coins resolves to an unintended coin and prices a holding wrongly | T | M | M | accepted, see below |
| R-17 | An automatic price silently replaces a manual price of the same holding | T | M | M | the holdings update excludes every holding whose source is `manual`, evaluated against the row at update time, so even a manual price committed while a refresh is in flight is kept; tests with two connections and a full cycle cover it (owner decision of 2026-10-02) |
| R-18 | A stale or wrong market price shows a misleading warning, or an old price is presented as today's | I | M | L | the flag is computed on the server for a manual price only, with exact `bigint` arithmetic and exactly 5% giving no warning; the warning is never hidden because of age (owner decision of 2026-10-02) but its wording is chosen by a server flag from the injected clock, so a price older than 24 hours is shown with its own date and never as "today"; the warning is informational and never changes a price, and a wrong coin for a shared ticker is the accepted R-16 |
| R-19 | A user switches another user's holding to the automatic price, or injects a price through the switch | E | L | H | owner-scoped lookup answering 404 for foreign or unknown ids, session and write scope on the route, no request body so the only value written is the stored public market price, the route is in the cross-user 404 and 401 test lists |
| R-20 | Junk crypto tickers that the provider never answers fill the price requests and delay or stop the pricing of real tickers | D | M | L | the symbol selection reserves half of every request for the oldest priced symbols and draws never-priced ones at random, so existing prices keep refreshing and every new ticker is eventually tried; at most 100 symbols per request and 1,000 calls a month; the residual delay for a new real ticker is accepted, see below |

## Accepted risks
### R-20
- **Accepted by:** project owner (user) — M-1 of the SAST report, confirmed on 2026-10-03 and relayed by the coordinator, as a consequence of accepted risk R-12 of DISC-001-07a (no caps on portfolios and holdings).
- **Justification:** any signed-in user can add many crypto holdings with tickers the provider never answers, so a newly added real ticker can wait about N/50 hours for its first price (N is the number of never-priced symbols); nothing is lost or exposed and existing prices keep refreshing.
- **Review conditions:** 2026-12-03, or earlier if a user reports a real ticker that stays unpriced; a follow-up should add a per-user holdings cap or a symbol attempts table ordered by last attempt.

### R-16
- **Accepted by:** project owner (user) — decision of 2026-10-02, relayed by the coordinator and recorded in the PRD decision log.
- **Justification:** CoinGecko resolves a symbol to the top-ranked coin by market cap, which is correct for the major coins users hold; the PRD defines the crypto ticker as the lookup key and adds no coin identifier; the price source and date stay visible on every holding so a wrong price can be spotted and corrected; the alternative of storing a CoinGecko id per holding changes the 07a contracts and PRD.
- **Review conditions:** the first time a user reports a wrong automatic price, or when a holding carries a coin identifier in a later ticket, whichever comes first.

## Supply chain
No new runtime dependency: the adapter uses the platform `fetch`, `AbortSignal.timeout` and `JSON.parse`, validation uses `zod` (already in the lockfile) and the arithmetic uses `BigInt`. One new external service, CoinGecko, reached only from the worker through the single `PriceProvider` adapter; tests use the fake and a local test server, never CoinGecko.

## Availability
If CoinGecko is down, slow or rate limiting, the refresh fails with a code, prices keep their last value and date (the stale flag appears after 7 days), retries back off from 15 to 60 minutes within the monthly cap of 1,000 calls, and nothing else in the product is affected because the API never calls the provider. If the budget is used up, refreshes pause until the next UTC month. The stored market price keeps its last value and date, and the divergence warning stays while the prices differ by more than 5%, with its wording switching from "today" to "on <date>" after 24 hours, so an outage never shows an old price as current. Snapshots do not depend on the provider: they use whatever prices exist at the end of the local day. A restarted or duplicated worker is safe because every write is an atomic claim, a single statement or an idempotent insert.

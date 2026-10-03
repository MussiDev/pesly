# TDD evidence DISC-001-07b

This file records the failing-first run per block, as reported by each block's implementer: the
command run before the implementation existed, what failed, and the result once it was green.

## Block 1 — Domain: price conversion, snapshot dates and provider failures

Command (both runs): `TEST_DATABASE_URL=postgres://argent:argent@localhost:5435/argent07b_test pnpm --filter @pesly/api exec vitest run test/investments/crypto-price.test.ts test/investments/snapshot-date.test.ts test/investments/no-float-money.test.ts`

| Test file | Red result (before implementation) | Green result (after) |
|---|---|---|
| `apps/api/test/investments/crypto-price.test.ts` | Suite failed at import, 0 tests ran, so no per-test assertion executed: `Error: Cannot find module '../../src/investments/domain/crypto-price'` | All tests pass |
| `apps/api/test/investments/snapshot-date.test.ts` | Suite failed at import, 0 tests ran, so no per-test assertion executed: `Error: Cannot find module '../../src/investments/domain/snapshot-date'` | All tests pass |
| `apps/api/test/investments/no-float-money.test.ts` | 3 new tests failed on a real assertion (3 pre-existing tests passed): `AssertionError: expected [ …(16) ] to include '…\apps\api\src\investments\domain\<file>'` for `crypto-price.ts`, `snapshot-date.ts` and `price-failure.ts` | 6/6 pass |

Overall: red run 3 files failed, 3 tests failed, 3 passed. Green run 3 files passed, 39 tests passed.
`pnpm typecheck` passes and ESLint reports nothing on the touched files.

### Block 1 correction round

Same command. Tests written or adjusted first, then run red, then fixed.

| Change | Red result | Green |
|---|---|---|
| crypto-price: isolated 41-char (`'0'.repeat(38)+'1.5'`) and 40-char (`'0'.repeat(37)+'1.5'`) tests | With the length cap temporarily removed from `crypto-price.ts`: `AssertionError: expected 150n to be null` (the 40-char test passes by design). Cap restored. | pass |
| snapshot-date: `localDateOf` missing year/month/day part (Intl.DateTimeFormat stubbed with `vi.spyOn`, restored in `afterEach`) | 3 failed, `AssertionError: expected [Function] to throw an error` (guard disabled; before the fix the function returned `0000-...` silently) | pass |
| snapshot-date: `previousDate` rejects malformed input (7 cases) | 7 failed: 5 `expected function to throw an error, but it didn't`, 2 `expected error to be instance of RangeError` | pass |
| no-float-money: added `Number.`, `Math.ceil`, `Math.trunc` to the forbidden list | Existing scan of `apps/api/src/investments` and `packages/shared/src/investments` still passes with all three, so all three were kept. `JSON.parse` not added. | pass |
| price-failure: doc comment reworded (no test) | n/a | n/a |

Green: 3 files, 50 tests pass; whole `test/investments` folder 16 files, 224 tests pass. `pnpm typecheck` and ESLint clean.

## Block 2 — Application: ports and use cases

Command (both runs): `TEST_DATABASE_URL=postgres://argent:argent@localhost:5435/argent07b_test pnpm --filter @pesly/api exec vitest run test/investments/refresh-crypto-prices.test.ts test/investments/take-daily-snapshots.test.ts`

| Test file | Red result (before implementation) | Green result (after) |
|---|---|---|
| `apps/api/test/investments/refresh-crypto-prices.test.ts` | Suite failed at import, 0 tests ran, so no per-test assertion executed: `Error: Cannot find module '../../src/investments/application/refresh-crypto-prices'` | 16/16 pass |
| `apps/api/test/investments/take-daily-snapshots.test.ts` | Suite failed at import, 0 tests ran, so no per-test assertion executed: `Error: Cannot find module '../../src/investments/application/take-daily-snapshots'` | 10/10 pass |

Overall: red run 2 files failed, no tests ran. Green run 2 files passed, 26 tests passed (the in-memory fakes live in `apps/api/test/investments/fakes/in-memory-prices.ts`).
`no-float-money.test.ts` (6/6), `pnpm typecheck` and ESLint on the touched files are clean.

### Block 2 correction round

Review corrections applied test first. Red run (before changing production code), `refresh-crypto-prices.test.ts` 5 failed / 16 passed:

- `a provider failure (error) ...` (after renaming to `statusCode`) → `expected [ { …(2) } ] to deeply equal [ { …(3) } ]` (the `statusCode` was dropped)
- `a storage error propagates, records no provider failure and still backs off 15 minutes` → `expected 2026-10-01T00:05:00.000Z to deeply equal 2026-10-01T00:15:00.000Z`
- `10 retries over one simulated hour of a failing storage cost at most 3 reserved calls` → `expected 10 to be less than or equal to 3`
- `an error from the failure log itself still advances the schedule and propagates` → `expected 2026-10-01T00:05:00.000Z to deeply equal 2026-10-01T00:15:00.000Z`
- `an unexpected adapter error advances the schedule and propagates unchanged` → same 00:05 vs 00:15 assertion
- `uses one clock reading for the month key and the request time` → `expected [ … ] to have a length of 3 but got 4`

`take-daily-snapshots.test.ts` cursor guard test (fake repository that ignores the cursor): `Error: looped past the cursor guard` (the first draft of this test passed before the guard because the fake still filtered saved portfolios; it was rewritten to return a fixed page).

Green: whole `test/investments` folder 18 files, 256 tests pass; `pnpm typecheck` and ESLint clean.

#### Block 2 mutation checks

Each mutation was applied temporarily, the relevant file was run, and the code was restored byte for byte (verified with `diff` against a copy).

| Mutation | Failing tests | Assertion message |
|---|---|---|
| (a) `reserveCall` after `fetchPrices` instead of before | `refresh-crypto-prices`: `a budget used up (error) makes no call...`; `over 45 simulated days ... never exceed 1,000 in a month`; `the 1,001st reservation of a month returns budget_exhausted with no call` | `expected { outcome: 'refreshed', …(3) } to deeply equal { outcome: 'budget_exhausted' }`; `expected 1082 to be 1008`; `expected { outcome: 'failed', …(1) } to deeply equal { outcome: 'budget_exhausted' }` |
| (b) backoff constant 15 minutes instead of doubling | `a provider failure (error) ... backs off 15 then 30 minutes`; `10 retries over one simulated hour ... at most 3 reserved calls`; `over 45 simulated days ...` | `expected 2026-10-01T00:30:00.000Z to deeply equal 2026-10-01T00:45:00.000Z`; `expected 4 to be less than or equal to 3`; `expected 288 to be less than or equal to 75` |
| (c) remove the int64 skip in snapshots | `take-daily-snapshots`: `a total above 9,223,372,036,854,775,807 minor units is skipped and counted ...` | `expected { saved: 4, …(4) } to match object { saved: 3, skippedOutOfRange: 1 }` |
| (d) fake `storeAndApply` also overwrites manual holdings | `refresh-crypto-prices`: `keeps a manual price of 60,000.00 USD and its source ...` | `expected { outcome: 'refreshed', …(3) } to deeply equal { outcome: 'refreshed', …(3) }` (updated count 2 instead of 1) |
| (e) remove the creation-date filter | `take-daily-snapshots`: `skips a portfolio created after the local date being snapshotted` | `expected 2 to be 1 // Object.is equality` |
| (f) remove the lease/not_due check (the `nextAttemptAt` guard of the fake `claim`, so every caller gets a lease) | `two concurrent executions produce one provider call and the second is not_due`; `a second call before the interval is not_due and calls nothing`; `10 retries ...`; `over 45 simulated days ...` | `expected [ 'refreshed', 'refreshed' ] to deeply equal [ 'not_due', 'refreshed' ]`; `expected { outcome: 'refreshed', …(3) } to deeply equal { outcome: 'not_due' }`; `expected 10 to be less than or equal to 3`; `expected 0 to be greater than 0` |

## Block 3 — Persistence: migration, repositories and erasure registry

> Renumbering note: after the rebase over DISC-001-03b (0014_movements) this migration is `0015_price_snapshots` (idx 15, journal `when` 1790980568164). The text below keeps the original 0014 numbering as history.


Migration generated with drizzle-kit: `apps/api/drizzle/0014_price_snapshots.sql` (idx 14, journal `when` 1790970865972, greater than every other `when`; the spec's 0015 is provisional and 03b takes its own number in parallel, so expect a renumber at merge). A second `drizzle-kit generate` reports "No schema changes, nothing to migrate".

Red command (every file, one run): `TEST_DATABASE_URL=postgres://argent:argent@localhost:5435/argent07b_test pnpm --filter @pesly/api exec vitest run <files>`. Green command: same, on the same files.

| Test file | Red result (before implementation) | Green result (after) |
|---|---|---|
| `test/investments/price-repositories.test.ts` (new) | Suite failed at import, 0 tests ran, so no per-test assertion executed: `Cannot find module '../../src/investments/infrastructure/db/drizzle-crypto-price-repository'` | 17/17 pass |
| `test/investments/market-price-reader.test.ts` (new) | Suite failed at import, 0 tests ran: `Cannot find module '.../drizzle-market-price-reader'` | 5/5 pass |
| `test/investments/price-schedule.test.ts` (new; includes `deferred` and `claim` returning `consecutiveFailures`) | Suite failed at import, 0 tests ran: `Cannot find module '.../drizzle-price-schedule'` | 13/13 pass |
| `test/investments/price-failure-log.test.ts` (new) | Suite failed at import, 0 tests ran: `Cannot find module '.../drizzle-price-failure-log'` | 6/6 pass |
| `test/investments/snapshot-repository.test.ts` (new) | Suite failed at import, 0 tests ran: `Cannot find module '.../drizzle-snapshot-repository'` | 16/16 pass |
| `test/investments/price-migration.test.ts` (new) | 8 tests ran, 8 failed: `ENOENT: no such file or directory, open '...rollback4_price_snapshots.down.sql'`, `AssertionError: expected undefined to be 'bigint'` | 8/8 pass |
| `test/investments/investments-migration.test.ts` (modified: five tables in `ALL_TABLES`, 0014 rolled back before 0013) | 2 failed / 2 passed: `ENOENT ... 0014_price_snapshots.down.sql` | 4/4 pass |
| `test/identity/user-erasure.test.ts` (modified: `portfolio_value_snapshots` registered with a seeder, `crypto_market_prices` deliberately not) | 7 failed / 7: `error: relation "portfolio_value_snapshots" does not exist` | 7/7 pass |
| `test/identity/deletion-persistence.test.ts` (modified: snapshot row seeded and counted, 12 to 13 rows) | 10 failed / 18: `error: relation "portfolio_value_snapshots" does not exist` | 18/18 pass |
| `test/identity/migration.test.ts` (modified: five tables, 0014 rollback first in all 21 chains, `ALL_MIGRATIONS` 14 and every `ALL_MIGRATIONS - n` plus one, no "newest" assertion) | 30 failed / 42: `ENOENT ... 0014_price_snapshots.down.sql`, `expected 13 to be 14` | 42/42 pass |
| `test/deploy/build-output.test.ts` (modified: five tables in `ALL_TABLES`) | 1 failed / 7: `expected [ 'accounts', 'auth_attempts', …(17) ] to deeply equal [ 'accounts', 'auth_attempts', …(22) ]` | 7/7 pass |

Overall: red run, 5 new suites failed at import (no test ran) and 6 other files had 58 failing tests. Green run, 11 files, 143 tests pass (65 new). Whole `test/investments` folder plus the identity, deploy and `test/exchange-rates` files: 40 files, 579 tests pass. `pnpm typecheck` and ESLint on the touched files clean; Prettier clean with `--end-of-line auto`; no forbidden float token under `apps/api/src/investments` or `packages/shared/src/investments`.

### Block 3 correction round

Tests written first, run red against the unchanged repositories, then green after the fix (`--no-file-parallelism`, port 5435 `argent07b_test`).

| New test | Red result | Fix |
|---|---|---|
| `price-repositories`: `never returns a ticker the market table would reject, and still returns the others` | `expected [ 'btc/usd', 'eth', 'has space' ] to deeply equal [ 'eth' ]` | `symbolsToPrice` WHERE adds `lower(h.ticker) ~ <bound pattern ^[a-z0-9._-]{1,20}$>` |
| `price-repositories`: `completes two concurrent calls with overlapping reversed symbol lists without a deadlock` | `error: deadlock detected` (40P01, `while inserting index tuple ... in relation "crypto_market_prices"`) | `storeAndApply` sorts the symbols before building the VALUES list |
| `price-repositories`: `works with unsorted input` | passes before and after (regression guard, the sort must not change results) | none |
| `price-failure-log`: `strips NUL characters from the detail instead of throwing` | `Failed query: insert into "crypto_price_refresh_failures" ...` (22021, invalid byte sequence) | `record()` drops NUL from the detail |
| `price-failure-log`: `stores a null status code when it is outside 100-599 instead of throwing` | `Failed query ...` (23514, `crypto_price_refresh_failures_status_code_check`) | `record()` stores null for out-of-range or non-integer codes |

The old `rejects an unknown code and an out-of-range status code` test was narrowed to the unknown code, since an out-of-range status code no longer throws. Green: 6 files, 70 tests pass; `pnpm typecheck` and ESLint clean; no forbidden token under `apps/api/src/investments`.

### Block 3 mutation checks

Each mutation was applied temporarily to the file shown, the relevant test file was run, and the file was restored byte for byte (the full suite was rerun green afterwards).

| Mutation | Failing tests | Assertion message |
|---|---|---|
| (a) remove `h.price_source IS DISTINCT FROM 'manual'` from the apply statement | `price-repositories`: `keeps the price, source and time of a manual holding ...`; `keeps a manual price committed while the apply statement waits on the row lock` | `expected { markets: 1, holdings: 1 } to deeply equal { markets: 1, holdings: +0 }` |
| (b) remove the stored-if-newer `WHERE` of the market upsert | `price-repositories`: `never replaces a newer stored market price with an older one ...`; `prices a holding added after the market price ...` | `expected { markets: 1, holdings: +0 } to deeply equal { markets: +0, holdings: +0 }` |
| (c) remove `h.priced_at IS NULL OR h.priced_at < m.priced_at` | `price-repositories`: 3 tests (`replaces an imported price older than ... keeps a price that is not older`, `never replaces a newer stored ...`, `prices a holding added ...`) | `expected { markets: 3, holdings: 3 } to deeply equal { markets: 3, holdings: 1 }` |
| (d) remove the composite foreign key from the migration SQL | `price-migration`: `defines the snapshot keys: composite owner foreign key ...` | `expected undefined to be '23503'` |
| (e) remove `WHERE calls < limit` from `reserveCall` | `price-schedule`: `gives exactly one success to two simultaneous reservations at 999 calls ...`; `refuses the 1,001st call of a month reached one reservation at a time` | `Failed query: insert into "crypto_price_usage" ... on conflict ... do update set "calls" = ... + 1` (the `calls <= 1000` check fires instead of a refusal) |
| (f) `deferred` also resets `consecutive_failures` | `price-schedule`: `deferred moves the next attempt without touching the failures or the last success` | `expected [ { …(3) } ] to deeply equal [ { …(3) } ]` |
| (g) remove the lease check from `deferred` | `price-schedule`: `a stale owner calling succeeded, failed or deferred changes nothing` | `expected [ { …(3) } ] to deeply equal [ { …(3) } ]` |
| (h) remove the already-snapshotted exclusion from `portfoliosToSnapshot` | `snapshot-repository`: `skips portfolios that already have a row for the date ...` | `expected [ …(3) ] to deeply equal [ …(2) ]` |
| (i) remove `onConflictDoNothing` from `save` | `snapshot-repository`: `writes one set of rows when saving twice ...`; `returns only the rows actually written when some already exist` | `Failed query: insert into "portfolio_value_snapshots" ...` (duplicate key) |
| (j) remove `holdings_crypto_ticker_idx` from the migration SQL | `price-migration`: `creates the indexes, including the partial expression index on holdings`; `is reverted by its rollback script ... and re-applies` | `expected undefined to be defined` |

## Block 4 — Provider adapters and worker environment

Tests were written first and run red before any source file existed or changed (`TEST_DATABASE_URL=postgres://argent:argent@localhost:5435/argent07b_test pnpm --filter @pesly/api exec vitest run <files>`).

| Test file | Red result (before implementation) | Green result |
|---|---|---|
| `test/investments/coingecko-price-provider.test.ts` (19 tests) | File failed to load: `Error: Cannot find module '../../src/investments/infrastructure/provider/coingecko-price-provider'` (import failure, no test body ran) | 19/19 |
| `test/investments/coingecko-payload.test.ts` (17 tests) | File failed to load: `Cannot find module '../../src/investments/infrastructure/provider/coingecko-payload'` (import failure) | 17/17 |
| `test/investments/fake-price-provider.test.ts` (4 tests) | File failed to load: `Cannot find module '.../provider/fake-price-provider'` (import failure) | 4/4 |
| `test/foundation/worker-env.test.ts` (+5 tests) | 4 failed: `expected undefined to be 'coingecko'`; `expected undefined to be 'CG-worker-secret-key-0123456789'`; `expected [Function] to throw an error` (fake / changed base URL in production); `expected '' to contain 'PRICE_PROVIDER'`. The accept-missing/blank-key test passes before (asserts a key is undefined, true while the setting is unknown); it is a regression guard, not a red test | all pass |
| `test/foundation/env.test.ts` (+8 tests) | 8 failed: `expected undefined to be 'coingecko'`; `expected undefined to be 'fake'`; `expected '' to contain 'PRICE_PROVIDER'` (and `COINGECKO_BASE_URL`, `COINGECKO_API_KEY`); `expected [Function] to throw an error` (production fake and base URL); `expected undefined to be 'coingecko'` | all pass |
| `test/deploy/railway-iac.test.ts` (1 new, 2 extended) | 3 failed: `argent-worker: expected [ 'DATABASE_URL', 'EMAIL_FROM', …(5) ] to deeply equal [ 'COINGECKO_API_KEY', …(7) ]`; `argent-worker.COINGECKO_API_KEY: expected undefined to deeply equal { type: 'preserve' }`; `expected undefined to deeply equal { type: 'preserve' }` | all pass |

Total red run: `Test Files 6 failed (6) | Tests 15 failed | 76 passed (91)` (3 files failed at import). Green: the six files plus `no-float-money.test.ts`: 7 files, 137 tests pass; `test/foundation test/deploy test/investments test/exchange-rates` serial: 52 files, 802 tests pass. `pnpm typecheck` and ESLint on touched files clean; Prettier clean with `--end-of-line auto`.

### Block 4 mutation checks

Each mutation was applied temporarily, the five relevant test files were run, and the file was restored byte for byte (full suite green afterwards).

| Mutation | Failing tests |
|---|---|
| float fallback: `context?.source ?? String(value)` instead of marking the source missing | `coingecko-payload`: `is provider_invalid_payload, never a float fallback, when the number source is missing` |
| key also put in the URL (`x_cg_demo_api_key=` query) | `coingecko-price-provider`: `returns cents from the digits ... with the key header` (`request.url` must not contain the key) |
| redirect followed (`redirect: 'follow'`) | `coingecko-price-provider`: `does not follow a redirect and reports it as a bad status` |
| stale `last_updated` accepted (age check removed) | `coingecko-payload`: `ignores an entry whose last_updated is missing, unreadable or older than 24 hours`, `accepts last_updated exactly 24 hours old and rejects a millisecond older`, `lets a stale clone not block the fresh entry` |
| first entry wins (rank comparison disabled) | `coingecko-payload`: `keeps the entry with the lowest market cap rank ... null last`, `prefers a ranked entry over an unranked one whatever the order` |
| key header sent even with no key | `coingecko-price-provider`: `sends no key header when no key is configured`, `treats an empty key as no key` |
| unrequested symbols returned | `coingecko-payload`: `drops symbols that were not asked for ...`; `coingecko-price-provider`: `accepts a body just under the cap` |
| injection-shaped symbols not dropped | `coingecko-payload`: `sanitizeSymbols drops injection-shaped symbols ...`; `coingecko-price-provider`: `drops injection-shaped symbols from the request ...`, `makes no request when no symbol is left after sanitizing` |
| production allows `PRICE_PROVIDER=fake` | `env.test`: `rejects fake in production`; `worker-env.test`: `refuses fake and a changed base URL in production, naming the variable only` |
| production allows a changed `COINGECKO_BASE_URL` | `env.test`: `rejects a changed base URL in production without printing it`; `worker-env.test`: same worker test |
| worker key declared as a literal in `.railway/railway.ts` | `railway-iac`: `every secret is preserved ...`, `gives the CoinGecko key to the worker only ...`, `gives the services one production configuration ...` |
| API service also declares the key | `railway-iac`: `declares each service non-secret variables ...`, `gives the CoinGecko key to the worker only ...` |

### Block 4 correction round

Tests first, run red, then the fix (`TEST_DATABASE_URL=postgres://argent:argent@localhost:5435/argent07b_test`).

| New test | Red result | Green result |
|---|---|---|
| `worker-env.test.ts`: `trims whitespace around a pasted key and still rejects interior whitespace or non-ASCII` | `Error: Invalid environment: COINGECKO_API_KEY: must be a single token without spaces` (a key with a trailing newline stopped the worker) | pass |
| `env.test.ts`: `trims whitespace around a pasted key and rejects interior whitespace or non-ASCII` | same error for the API environment | pass |
| `coingecko-payload.test.ts`: `leaves a nested current_price alone: not converted, not priced, no failure without source text` | `expected { current_price: NumberSource { text: null }, times: 2 } to deeply equal { current_price: 99.99, times: 2 }` (the nested price was converted) | pass |

Fixes: `env.ts` trims the key before the visible-token check and the comment no longer claims a key can never block startup; `coingecko-payload.ts` records the source text of `current_price` by holder object and only the top-level array entries read it, so a nested value keeps its parsed value. Re-run: the four investments files, `worker-env`, `env` (6 files, 117 tests) and `railway-iac` (23 tests) pass; typecheck and ESLint clean; no forbidden tokens in `apps/api/src/investments`. `.gitignore` gained `.vitest/` (the Vitest JSON output directory was untracked).

## Block 5 — Jobs and worker wiring

Tests written first (`TEST_DATABASE_URL=postgres://argent:argent@localhost:5435/argent07b_test pnpm --filter @pesly/api exec vitest run <files>`), run red, then the jobs, the composition and the worker wiring.

| Test file | Red result (before the implementation) | Green result |
|---|---|---|
| `price-sync-job.test.ts` (8 tests) | suite fails to load: `Error: Cannot find module '../../src/investments/infrastructure/jobs/price-sync-job'` (an import failure, not an assertion: 0 tests ran) | 8/8 pass |
| `snapshot-job.test.ts` (7 tests) | suite fails to load: `Error: Cannot find module '../../src/investments/infrastructure/jobs/snapshot-job'` (import failure, 0 tests ran) | 7/7 pass |
| `investments-jobs.test.ts` (8 tests) | suite fails to load: `Error: Cannot find module '../../src/investments/jobs'` (import failure, 0 tests ran) | 8/8 pass |
| `request-path.test.ts` (16 tests) | 15 pass and 1 fails: `the worker side is a separate graph that does reach them`: `AssertionError: expected [ '/investments/jobs.ts' ] to include '/investments/infrastructure/jobs/pric...'` (jobs.ts did not exist yet). The "API closure contains nothing forbidden" test passes before the implementation, as it must: the forbidden modules did not exist yet, so it only starts to guard something once Block 5 creates them. Its detection power is proven by the probes and the mutations below. | 16/16 pass |

The first green run of `investments-jobs.test.ts` after the worker wiring had three failures that were test mistakes, fixed in the test: a stop requested before the price pass reaches the provider skips that call by design (as in `RatesSyncJob`), so the tests now wait for the provider call first (`expected +0 to be 1`, `expected [] to have a length of 1`); and the "never logs the key" regex matched across lines.

Green: the 4 new files plus `test/foundation` pass; `pnpm typecheck` passes; `pnpm --filter @pesly/api build` bundles the entries; ESLint is clean on the touched files; no forbidden no-float token in `apps/api/src/investments`.

### Block 5 mutation checks

Each mutation was applied temporarily, the relevant files were run, and the file was restored byte for byte.

| Mutation | Failing tests |
|---|---|
| price job without error isolation (the pass error is rethrown instead of logged) | `price-sync-job`: `a failing storage layer is logged with the error and the next pass still runs` |
| `PriceSyncJob.stop()` does not await the pass in progress | `price-sync-job`: `stop() waits for the pass in progress ...`; `investments-jobs`: `stop() does not resolve before a price pass still waiting on the provider`, `the composition built with no API key starts and completes a pass (AC-15)` |
| `SnapshotJob.stop()` does not await the pass in progress | `snapshot-job`: `stop() waits for the pass in progress` |
| out-of-range skip logged on every pass (repeat suppression removed) | `snapshot-job`: `an out-of-range total is logged once per zone and date and the pass continues (AC-04)` |
| failure purge on every pass (`PURGE_INTERVAL_MS = 0`) | `price-sync-job`: `the failure purge removes records older than 30 days and runs at most hourly` |
| a failing purge rethrown (stops the refresh) | `price-sync-job`: `a failing purge is logged and does not stop the refresh` |
| API barrel imports `./jobs` | `request-path`: `the API closure contains no provider, job, use case of the jobs or worker repository` |
| API barrel imports `drizzle-price-schedule` | `request-path`: same test |
| `email worker started` text changed in the worker | `investments-jobs`: `keeps the email worker started line the e2e server waits on, unchanged` |
| worker does not stop the investments jobs on shutdown (the first run survived: no test covered it, so `starts the investments jobs and stops them on shutdown` was added) | `investments-jobs`: `starts the investments jobs and stops them on shutdown` |

### Block 5 correction round

Three corrections, tests written first and run red (`snapshot-job.test.ts`, `investments-jobs.test.ts`):

| New test | Red result | Green |
|---|---|---|
| `snapshot-job`: `the summary is info only when the pass did something, debug otherwise` | `AssertionError: expected [ 30, 30 ] to deeply equal [ 30, 20 ]` (an idle pass logged at info) | pass |
| `snapshot-job`: `an out-of-range-only pass logs the summary at info` | passes before and after: it guards that a skip-only pass is not demoted to debug | pass |
| `snapshot-job`: `an invalid time zone is logged once until it disappears and returns` | `AssertionError: expected [ { level: 40, ...(5) }, ...(2) ] to have a length of 1 but got 3` | pass |
| `investments-jobs`: `stop() stops both jobs even when one stop rejects, then rethrows the first reason` | `AssertionError: expected false to be true` (with `Promise.all` the rejection surfaced before the slower stop settled) | pass |

Fixes: the summary is `info` only when `saved`, `skippedOutOfRange` or `skippedZones` is above zero, `debug` otherwise; invalid zones use a repeat-suppression set replaced by each pass's invalid zones; `createInvestmentsJobs.stop()` uses `Promise.allSettled` and rethrows the first rejection after both settled. Re-run (serial): `price-sync-job`, `snapshot-job`, `investments-jobs`, `request-path` (43 tests) pass.

## Block 6 — Market price in the holding response and the switch to automatic

Tests written first, then run red with `TEST_DATABASE_URL=postgres://argent:argent@localhost:5435/argent07b_test pnpm --filter @pesly/api exec vitest run test/investments/valuation.test.ts test/investments/portfolio-view.test.ts test/investments/contracts.test.ts test/investments/holding-use-cases.test.ts test/investments/portfolio-use-cases.test.ts test/investments/holding-routes.test.ts test/investments/portfolio-routes.test.ts test/investments/add-holding-concurrency.test.ts test/investments/investments-wiring.test.ts` (9 files, 168 tests: 86 failed and 82 passed before the implementation; the 82 are the 07a tests that the block does not change). Most red results are not assertion failures but the consequence of the missing code (a missing export, a changed constructor); they are labelled as such.

| Test file | Red result (before the implementation) | Green result |
|---|---|---|
| `valuation.test.ts` (6 new) | `TypeError: marketPriceDiffers is not a function` (6 failed; not an assertion, the helper did not exist) | 18/18 pass |
| `portfolio-view.test.ts` (13 new tests, 13 failed) | the new tests failed on the view's missing `market`, `marketPriceDiffers` and `marketPriceRecent` (the exact assertion text was not kept; the 07a tests, which ignore the new third argument, passed) | 25/25 pass |
| `contracts.test.ts` (11 new) | `AssertionError: expected true to be false`: the four fields are not required and `marketUnitPrice` `"1.5"`, `"-1"`, `"01"`, `""`, `"abc"` and a float were accepted (11 failed) | 31/31 pass |
| `holding-use-cases.test.ts` (29 tests, all on the new setup) | `TypeError: UseAutomaticPrice is not a constructor` in `setup()` (29 failed; import-level cause, so the old tests fail with it) | 29/29 pass |
| `portfolio-use-cases.test.ts` (14) | `TypeError: this.clock.now is not a function` in `CreatePortfolio.execute` (the reader was passed where the clock was expected; 13 failed) | 14/14 pass |
| `holding-routes.test.ts` (10 new, 10 failed) | `AssertionError: expected 404 to be 200` (route absent), `expected [] to have a length of 1` (no mutation line), `expected 404 to be 400`, `expected 404 to be 500` in the storage-failure list, `expected { …(14) } to match object { …(17) }` (response without the four fields) | 32/32 pass |
| `portfolio-routes.test.ts` (1 new) | the new test failed (1 failed): the responses had no market fields (exact assertion text not kept) | 11/11 pass |
| `add-holding-concurrency.test.ts` | `TypeError: this.clock.now is not a function` (the reader was passed in the clock's place; 2 failed) | 4/4 pass |
| `investments-wiring.test.ts` (1 new) | the new test failed (1 failed): `index.ts` did not wire the reader nor the route (exact assertion text not kept) | 4/4 pass |

Green: the 9 files pass (168 tests), then the whole `test/investments` directory (31 files, 469 tests), including `request-path.test.ts` and `no-float-money.test.ts`; `pnpm --filter @pesly/api exec vitest run --config vitest.perf.config.ts test/perf/portfolio-latency.perf.test.ts` passes; `pnpm typecheck` passes (shared, api and web); the web files `api-client-investments.test.ts`, `holding-row.test.tsx` and `investments-container.test.tsx` pass (69 tests); ESLint and Prettier are clean on the touched files; the no-float token scan finds nothing in `apps/api/src/investments` or `packages/shared/src/investments`. One test of mine was wrong, not the code: `expected 64000000n to be 6400000n` (10 units at 6,400,000 is 64,000,000); the expectation was fixed.

### Block 6 mutation checks

Each mutation was applied temporarily, the files named in the table were run, and the source was restored from the saved original (the restore is verified by the green re-run and `git diff`). The first batch run was stopped by the harness time limit while mutation 12 was applied; `index.ts` was restored by hand (the injected import line deleted) and the batch re-run with smaller file sets.

| Mutation | Failing tests |
|---|---|
| age hides the warning (`marketPriceDiffers` also requires a recent market price) | `portfolio-view`: `an old market price (2 days) ...`, `an old market price (30 days) ...`, `is recent at exactly 24 hours and not recent 24 hours and one second ago, still warning (AC-11)` |
| 5% boundary exclusive (`>` becomes `>=`) | `valuation`: `is false at exactly 5% above or below`, `does not overflow at the 10^12 limit`; `portfolio-view`: `does not warn at exactly 5% above or below ... (AC-09)` |
| manual check removed (automatic and imported prices warn) | `portfolio-view`: `does not warn for a automatic price ...`, `... import price ... (AC-10)` |
| recent boundary exclusive (`<=` becomes `<`) | `portfolio-view`: `is recent at exactly 24 hours and not recent 24 hours and one second ago` |
| a non-crypto holding also gets a market price | `portfolio-view`: `gives a holding that is not crypto no market price, even when a symbol matches` |
| market read per symbol instead of one call | `portfolio-use-cases`: `lists portfolios with crypto holdings with one lookup ...`, `reads one portfolio with one lookup` |
| reader called even without crypto | `holding-use-cases`: `makes no reader call when the holding is not crypto`; `portfolio-use-cases`: `makes no lookup for a list or a read without crypto ...`, `creates a portfolio without a lookup ...` |
| tickers not lowercased in the lookup | 5 tests: `UseAutomaticPrice > sets the market price ... (AC-12)`, the get/edit/price and add/merge tests of `holding-use-cases`, and both lookup tests of `portfolio-use-cases` |
| `UseAutomaticPrice` not-found guard removed (foreign or unknown id reaches the rest) | `holding-use-cases`: `answers not found for another owner or an unknown id and changes nothing (AC-14)`, `does not look up the market for a holding it cannot switch` |
| `UseAutomaticPrice` writes source `manual` | `holding-use-cases`: `sets the market price, source automatic and the market time ... (AC-12)` |
| `UseAutomaticPrice` stamps the clock time instead of the market time | same AC-12 test |
| API `index.ts` imports the worker repository | `request-path`: `the API closure contains no provider, job, use case of the jobs or worker repository` |
| route mutation log action renamed | `holding-routes`: `POST automatic-price writes one mutation line with ids only and no amount` |
| serializer drops `marketPriceRecent` | `holding-routes`: `shows the stored market price and the warning ...`; `portfolio-routes`: `carries the market price fields on the list and the read ... (AC-07)` |
| `UseAutomaticPrice` accepts a non-crypto holding (type guard removed) | none fail: an equivalent mutant, because the market lookup only asks for crypto tickers, so a stock holding still ends in the same `marketPrice` rejection through the second guard; the guard stays as explicit intent and the AC-13 stock tests cover the outcome |
| route drops the response schema | survives: `apps/api/src/shared/http/validate.ts` parses the response with the schema at runtime, but the serializer output already satisfies the schema, so no test can tell the two apart; it is an equivalent mutant, not something `pnpm typecheck` catches |

### Block 6 correction round

Tests written first, run red against `TEST_DATABASE_URL=postgres://argent:argent@localhost:5435/argent07b_test`, then the fix.

| Test | Red result (before the fix) | Green result |
|---|---|---|
| `drizzle-repositories.test.ts`: `applies a guarded price write only when the instrument type and lowercase ticker match` | `AssertionError: expected { …(9) } to be null` (the guard was ignored, the mismatched write updated the row) | 24/24 pass |
| `holding-use-cases.test.ts`: `writes nothing and rejects on marketPrice when the ticker changes between the read and the write` | `AssertionError: promise resolved "{ …(15) }" instead of rejecting` | 55/55 pass with the next one |
| `holding-use-cases.test.ts`: `... when the instrument type changes between the read and the write` | `AssertionError: promise resolved "{ …(15) }" instead of rejecting` | pass |

Changes: `setPrice` takes an optional `PriceWriteGuard` (instrument type and lowercase ticker) added to the UPDATE's WHERE; `UseAutomaticPrice` passes it and raises `InvestmentRuleViolation('marketPrice')` when no row is updated. `DrizzleMarketPriceReader` uses the port's `MarketPrice` and `ReadonlyMap` (the duplicate `StoredMarketPrice` is gone). The perf test now seeds crypto holdings (every fifth, USD) and the matching `crypto_market_prices` rows; the 500 ms threshold is unchanged and p95 was 50 ms. The twelve block files (215 tests), the perf test, `pnpm typecheck` and ESLint pass; the no-float token scan finds nothing.

## Block 7 — Web: manual price warning and switch to automatic

Tests written first, then run red against the unmodified code (no `setHoldingAutomaticPrice`, no catalog keys, no `onUseAutomaticPrice` prop), then implemented.

Red command: `pnpm --filter @pesly/web exec vitest run test/holding-row.test.tsx test/api-client-investments.test.ts test/investments-container.test.tsx test/portfolio-card.test.tsx test/i18n-catalogs.test.ts`
Green command: the same plus `test/no-float-money.test.ts test/holding-form-accessibility.test.tsx`.

| Test file | Red result | Green result |
|---|---|---|
| `holding-row.test.tsx` (12 new) | 9 failed, e.g. `TestingLibraryElementError: Unable to find an element with the text: This price is manual, but the market price changed: today it's worth 20,500.00 ARS` and `Unable to find an accessible element with the role "button" and name "Use automatic price for AAPL"` (the 3 negative cases AC-09, AC-10 and missing price passed by construction, as they assert absence) | all pass |
| `api-client-investments.test.ts` (4 new) | 4 failed: `TypeError: client.setHoldingAutomaticPrice is not a function` | all pass |
| `investments-container.test.tsx` (3 new) | suite failed to load: `TypeError: Cannot read properties of undefined (reading 'replace')` (the catalog key `useAutomaticPriceFor` did not exist) | all pass |
| `portfolio-card.test.tsx` (1 new) | 1 failed: `Unable to find an accessible element with the role "button" and name "Use automatic price for AAPL"` | all pass |
| `i18n-catalogs.test.ts` (2 new) | 2 failed: `AssertionError: es investments.holding.manualPriceDiffersToday: expected undefined to be truthy` (and the same for en) | all pass |
| `no-float-money.test.ts`, `holding-form-accessibility.test.tsx` (existing) | not run red (regression checks) | pass (7 files, 155 tests together) |

### Block 7 mutation checks

Each mutation applied to one source file, the three component and container test files run, source restored afterwards (the diff was identical after the run).

| Mutation | Failing tests |
|---|---|
| warning shown without `marketPriceDiffers` | `AC-09: shows no warning and no button when the market price does not differ`; container `AC-12` (the warning stays after the switch) |
| `marketPriceRecent` ignored (always "today") | the two `AC-11` older-wording tests (en, es) and `AC-16` 30 day old price |
| date formatted in UTC instead of the user's time zone | both `AC-11` older-wording tests (Buenos Aires zone) |
| button without the callback guard | `shows the warning but no button without the callback` |
| button passes the ticker instead of the holding id | row `AC-12`, card `passes the callback to the warned holding only`, container `AC-12` and `AC-13` 404 |
| hardcoded button label | `the button name is in Spanish in Spanish` |
| `PortfolioCard` does not pass the callback | card test, container `AC-12`, `AC-13` 404 and 400 |
| container failure not routed to `portfolioFailure` | container `AC-13` 404 and 400 |

### Block 7 correction round

Accessibility audit: the switch unmounted the focused button with no announcement (FAIL), and nothing disabled the button while the request ran (WARN). New `automaticPrice` notice (`{ticker} ya usa el precio automático` / `{ticker} now uses the automatic price`) in the existing status region, shown after the reload; focus moves to the holding's details toggle (`data-details-toggle`), or the screen heading if it is gone. `pending` goes container, screen, `PortfolioCard`, `HoldingRow` and disables the button. The row's new-test count above is corrected to 12.

| New test | Red result |
|---|---|
| container: `announces the switch in the status region and moves focus to the holding details toggle` | `AssertionError: expected '' to be 'AAPL ya usa el precio automático'` (the suite first failed to load: `Cannot read properties of undefined (reading 'replace')`, key `notices.automaticPrice` missing; catalogs were added to reach the behavioural red) |
| container: `disables the button while the switch is in flight and sends one POST on a double click` | `AssertionError: expected 2 to be 1` (two POSTs held) |
| container: `shows the portfolio failure and no notice when the switch fails` | passes red by construction (asserts absence of a notice that did not exist); guards against the notice appearing on failure |
| row: `disables the button while a change is pending` | `AssertionError: expected false to be true` |
| row: `keeps the button enabled when nothing is pending` | passes red by construction (regression guard) |

Green: 11 web files (229 tests) plus `holding-form-schema-delegation` and `price-form` (16), `pnpm typecheck` and ESLint pass; the no-float token scan of `features/investments` finds nothing.

## Block 8 — Cross-cutting checks and end-to-end step

Block 8 adds tests over code built in Blocks 1 to 7, so the new integration and e2e tests cannot fail before any change: they passed on their first behavioural run. That is stated here instead of being hidden; the proof that they can fail is the mutation table below (each mutation applied to one source file, the test run, the file restored with `git checkout`, `git status` clean afterwards). The no-float probe was written first and failed on the unmodified helper.

API commands: `TEST_DATABASE_URL=postgres://argent:argent@localhost:5435/argent07b_test pnpm --filter @pesly/api exec vitest run test/investments/price-sync-integration.test.ts test/investments/no-float-money.test.ts`
E2E command: `E2E_DATABASE_URL=postgres://argent:argent@localhost:5435/argent07b_e2e pnpm e2e apps/web/e2e/investments.spec.ts`

| Test file | Red result | Green result |
|---|---|---|
| `price-sync-integration.test.ts` (5 tests: 24 hour cycle, manual price vs the 5% line, 30 day old market price and monthly counter, failure log leak check with the real adapter against a local stub, snapshot overflow) | Not red by construction (code already built). The first run failed only on a fixture mistake of mine (holdings seeded with a lowercase ticker, `Error: no ETH holding in the response`), fixed in the test. Behavioural proof: mutations below. | 5/5 pass (about 19 s) |
| `no-float-money.test.ts` (1 new probe test) | `flags a probe file with parseFloat in a new job directory`: `AssertionError: expected [] to deeply equal [ Array(1) ]` (the helper still joined its argument onto the repo root, so a temporary directory was never scanned) | 7/7 pass after `offendersIn` took a directory |
| `apps/web/e2e/investments.spec.ts` (3 new steps in the single flow, plus `makeCryptoPriceRefreshDue` in `e2e/support/database.ts`) | Not red by construction (code already built); mutation below fails the new step | `1 passed (41.4s)`, no API response >= 400, no console error |

### Block 8 mutation checks

| Mutation | Failing tests |
|---|---|
| refresh overwrites manual prices (the `h.price_source IS DISTINCT FROM 'manual'` line removed from `storeAndApply`) | cycle (`AssertionError: expected { unitPrice: 351234n, …(3) } to match object { source: 'manual', …(1) }`), manual vs 5% line, 30 day test |
| age hides the warning (`marketPriceDiffers` ANDed with the 24 hour rule in `portfolio-view.ts`) | 30 day old market price test (`marketPriceDiffers` expected true) |
| an out-of-range total aborts the pass (`throw` instead of counting in `take-daily-snapshots.ts`) | overflow test (`Error: overflow`) |
| the 5% rule uses `>=` (shared `marketPriceDiffers`) | cycle and manual vs 5% line (exactly 5% expected false) |
| the adapter puts the response text in the failure `detail` | leak test (`expected '[{"failed_at":"2026-03-01T22:00:00.00…' not to contain 'SECRET'`) |
| `marketPriceDiffers` forced false in `portfolio-view.ts` | e2e step `07b AC-07 a manual price far from the market shows the warning`: `expect(locator).toContainText(expected) failed` (the warning text never appears) |

### Block 8 correction round

- `investments.spec.ts`: the flow test has `test.setTimeout(180_000)`; the worker wait stays at 90 s but the default test timeout was 30 s.
- `makeCryptoPriceRefreshDue` now writes `now() - interval '1 minute'` and only advances a row that is not yet due (`where crypto_price_sync.next_attempt_at > now()` on the update), so it cannot clobber a lease held by the worker; a missing row is still inserted. The `_e2e` guard is unchanged.
- `price-sync-integration.test.ts`: the loose bounds are exact. The 24 hour cycle makes exactly 26 calls (22:00, 23:00, 23:15, 23:45, then hourly 00:45 to 21:45). The month test makes exactly 745 (72 healthy hourly calls, 3 failures at 15, 30 and 60 minute backoff, then 670 hourly attempts); the derivation is in the test comments and matched on the first run. Both are deterministic: the clock is a `MutableClock` and the schedule has no jitter. The `<= 1,000` budget invariant stays.
- `showDetails` waits for the open or the closed toggle to be visible before branching, clicks only when closed, then waits for the open state.
- Re-run: API tests 12/12 pass (serial); e2e `investments.spec.ts` 1 passed (36.1 s); `pnpm typecheck` clean; ESLint clean on the touched files.

### Notes

- The worker finds no crypto holding at start-up and defers one hour (`no_crypto_holdings`), so a flow that adds the first crypto holding would wait up to an hour. The e2e uses a support function (`makeCryptoPriceRefreshDue`, a direct upsert of the schedule row in the `_e2e` database, like `withAgedRates` for the rates) to make the refresh due, then waits for the visible price by reloading inside `toPass` (the worker polls every 30 s); there are no fixed sleeps.
- `pnpm typecheck` and ESLint on the touched files pass; the no-float token scan of `apps/api/src/investments`, `packages/shared/src/investments` and `apps/web/src/features/investments` finds nothing.

### Security fix: fair symbol selection

SAST finding: `symbolsToPrice` ordered never priced symbols first, so 100 junk tickers (never answered by the provider) typed by any users would fill every request and starve all real symbols. Fix: up to ceil(limit/2) oldest priced symbols plus never priced ones in random order; an unused share goes to the other group. No schema change.

Red run (before the fix, `price-repositories.test.ts -t symbolsToPrice`, 4 failed, 6 passed):

| Test | Red result |
|---|---|
| priced before never priced (existing test, updated) | `AssertionError: expected [ 'ada', 'sol' ] to deeply equal [ 'eth', 'btc' ]` |
| 150 junk and 10 priced: 100 symbols, 10 priced, 90 never priced | `AssertionError: expected [] to have a length of 10 but got +0` |
| 70 priced and 150 junk: 50 oldest priced and 50 never priced | `AssertionError: expected [ 'j000', 'j001', 'j002', …(47) ] to deeply equal [ 'p000', 'p001', 'p002', …(47) ]` |
| eventually draws every never priced symbol (8 symbols, limit 4, 40 calls) | `AssertionError: expected [ 'j000', 'j001', 'j002', 'j003' ] to deeply equal [ Array(8) ]` |

Already true before the fix, so not red by construction (they pin the contract): all-never-priced fills the limit, fewer symbols than the limit returns all, unused slots go to the other group, manual price ordering. The coverage test is probabilistic: failure chance per symbol per 40 calls is 2^-40 (about 1e-12).

Green: price-repositories, refresh-crypto-prices, price-sync-job, price-sync-integration and request-path, 75/75 (serial).

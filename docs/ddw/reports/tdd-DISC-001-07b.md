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

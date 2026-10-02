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

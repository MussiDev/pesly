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

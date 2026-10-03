# TDD evidence DISC-001-03c

Red-phase evidence per block, from each implementer's report and checked by that block's verifier (the verifier did not re-run the red phase against the old code; the evidence is consistent with the files on disk). Where a test could not go red, it is said. Paths are relative to the repository root.

## Block 1 — Shared contracts and the implied-rate helper (12 tests)

All 12 failed before the implementation: the six `impliedRate` tests with `TypeError: impliedRate is not a function`; the four-types list, the transfer and exchange union parsing (AC-01, AC-03), the amount rejections (AC-11), the missing destination fields (FR-02), the response shapes (FR-06) and the four new error codes against the old schemas. After: `packages/shared` 78/78.

## Block 2 — Domain, ports and use cases (31 tests)

`apps/api/test/movements/create-transfer-exchange.test.ts`: 24 of 31 failed first. The transfer saved test failed with `ResourceNotFound: NOT_FOUND` (the old code looked up a category); the error-class tests with `AssertionError: The instanceof assertion needs a constructor but undefined was given.`. Seven passed before (the 404 cases, date-first order, constructor keys), because the old code hit not-found or the date check by chance. After: 59/59 in the three use-case files.

## Block 3 — Persistence: migration 0016, schema and repository (53 tests plus updated ones)

44 of the repository, introspection, erasure and lookup tests failed first: inserts with `code 23502` (`category_id` still not null), 28 database check rejections with `expected '42703' to be '23514'` (the destination column did not exist), the `toMovement` test with a missing export, the introspection test with 3 keys instead of 4, and `lookups.test.ts` with the currency missing. The migration and investments-migration tests were not run red because they need the rollback file; they were run after it existed. The tests then caught a bug of the first shape check (a check passes on null): explicit `is not null` guards were added and the migration regenerated. After: repository group 94/94 and migration group 69/69.

## Blocks 4 and 5 — Balances adapter and HTTP (25 tests)

23 of 25 failed first. Balances: `expected undefined to be 4000n` (destination missing), `expected 700n to be 750n`, `expected +0 to be 2` (1,200 ids in chunks) and `expected false to be true` (a destination-only account has movements). Error handler: `expected 500 to be 400` for the four new codes. Routes and totals: `expected 500 to be 201/400/404/409` because POST /movements did not handle the union. Two passed first (the missing destination field answers 400 and 401/403 without a session), because validation and auth run before the handler. A follow-up added the union cases of `validate.test.ts` and the destination-only delete conflict: those tests document behavior that already existed and could not go red.

## Block 6 — Web client and entry screen (about 105 tests)

66 failed first: `Cannot find module '../src/features/movements/movement-request'`, `IntlError: MISSING_MESSAGE movements.types.transfer`, `expected <select> to be null` (category still shown for a transfer), api-client `messageKey` undefined for the new codes, catalog parity failures and the scan list `expected [] to have a length of 1`. The transfer and exchange post test in `api-client-movements.test.ts` passed from the start (the shared schemas from Block 1 already covered it) and is a regression guard. After: `apps/web` 1162/1162.

## Block 7 — The list shows transfers and exchanges (5 tests)

4 of 5 failed first (`getByText(undefined)` because the catalog keys did not exist, and the row still rendered the unknown-category label). The fifth (a 401 redirect and a 500 that keeps the rows) passed first because the container already behaved that way; it now runs with transfer rows and guards the behavior. After: `apps/web` 1167/1167.

## Block 8 — End to end, performance and scans

Web scan probes: 14 failed first with `ReferenceError: forbiddenTokensIn is not defined`, then passed after extracting the helper. API scan of `implied-rate.ts`: the scanner already covered it, so the new assertions passed first; a mutation check (appending `Number(1n) / 3` to the file) produced 6 failures naming the file and the token `Number(`, then it was reverted. The request-path scan test passed first for the same reason. The performance test and the four e2e flows were written after the behavior existed (they exercise it end to end); the first e2e run found one wrong expectation in the test itself (a transfer stores `destination_amount` equal to its amount, by design D1), which was fixed in the test.

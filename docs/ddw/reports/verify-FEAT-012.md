# Verification FEAT-012

| Field | Value |
|---|---|
| Module | apps/api/src/accounts, apps/api/src/movements, apps/api/src/reports, apps/web/src/features/accounts, apps/web/src/features/movements, packages/shared |
| Line coverage | 96.85% |
| Branch coverage | 90.16% |
| Function coverage | 94.88% |
| Coverage floor | 80% (AGENTS.md, "Testing") |
| Lint | `npx eslint apps packages --quiet` — clean, 0 findings; `pnpm typecheck` — 0 errors |

Verification was cross-checked by an independent verifier that did not write the code (first round BLOCKED on one real defect, a catalog key deleted by mistake, plus two minor items; all three were fixed in commit 59a0a9d6 and the suite, SAST and test reports were regenerated).

## Acceptance criteria
- ✅ AC-01 — `drizzle-balance-adjuster.ts:adjust`; test `set-account-balance-routes` "200 with the account and the adjustment of target minus current"
- ✅ AC-02 — `account-presenter.ts:presentAdjustment`; tests `set-account-balance-routes` (category, rate, tags, note) and `balance-adjuster` "inserts target minus current, dated now"
- ✅ AC-03 — `drizzle-account-movements.ts:sumsByAccount`; test `adjustment-read-paths` "adds a positive adjustment and applies the sign of a negative one"
- ✅ AC-04 — `drizzle-account-flow-reader.ts`; test `reports/adjustment-read-paths` "puts an adjustment in the month of its date"
- ✅ AC-05 — `flow-conditions.ts` unchanged, spending and group readers filter explicitly; test "reports, the budget spending, the month flows and group balances do not change"
- ✅ AC-06 — `drizzle-movement-filters.ts`, `movement-row.tsx`; tests `adjustment-read-paths` list test and web `movement-adjustments`, `movement-filters`
- ✅ AC-07 — generic `DeleteMovement`; test `edit-delete-routes` "deleting an adjustment restores the balance and the net worth" and the web delete-confirmation test
- ✅ AC-08 — `update-movement.ts` type-mismatch guard and the creatable-types schema; tests PUT 409 with the row unchanged and POST `type: 'adjustment'` 400
- ✅ AC-09 — removed route; `account-row.tsx` read-only opening balance; tests `account-routes` "removed PATCH answers 404" and web read-only test
- ✅ AC-10 — `set-balance-dialog.tsx`; test "shows the current balance and, as the target is typed, the signed difference"
- ✅ AC-11 — adjuster returns `adjustment: null`; route, adjuster and use-case tests assert nothing is inserted
- ✅ AC-12 — `openingBalanceSchema` and `out_of_range`; `it.each` sad-path tests and the negative-target test
- ✅ AC-13 — migration 0040 touches no rows; test `adjustment-migration` rolls back, seeds, re-applies and checks row counts, sums and computed balance
- ✅ AC-14 — adjuster returns `archived`, 409; route, adjuster and web tests
- ⚠️ AC-15 — row lock with the balance read after it; 20-concurrent-request tests at adjuster and route level assert the final balance is one of the 20 targets rather than the last committed one (warning W1 below)
- ✅ AC-16 — lock query by id and owner; route test "404 for a foreign and a missing account, nothing inserted"
- ✅ AC-17 — perf test `set-account-balance.perf.test.ts`, 10,000 movements, p95 20.9 ms against 500 ms
- ⚠️ AC-18 — dialog disables confirm and shows the offline message; dialog and container tests (warning W2: the row action itself stays enabled)
- ✅ AC-19 — `RequireSecondFactor`; route tests with TOTP, replay refused, recovery code, and 2FA off with a wrong code sent; dialog 2FA on and off
- ✅ AC-20 — `checkSecondFactor`; missing, wrong, malformed and exhausted-limit tests; wrong code counted in `auth_attempts`; 429

## Spec blocks
- ✅ Block 1 — shared contract: 12 tests, schemas, `hideAdjustments`, removed opening-balance schema
- ✅ Block 2 — migration 0040: SQL, rollback, snapshot, journal, 12 migration tests
- ✅ Block 3 — read paths: all readers handled, regression tests for reports, budgets, groups, dashboard
- ✅ Block 4 — set balance: use case, ports, adjuster, route, second-factor gate, concurrency and perf tests
- ✅ Block 5 — opening-balance edit removed from the API, route answers 404
- ✅ Block 6 — PUT and POST guards, delete restores the balance
- ✅ Block 7 — web accounts: dialog, container, client, catalogs, e2e flow
- ✅ Block 8 — web movements: row, avatar, hide filter, creatable types, changelog

## Tests
- ✅ Sad-path tests: every input of the new route has an invalid-input test (decimal, over limit, text, missing, wrong type, bad second-factor code, control character in note, foreign account, archived account, credit card account, exhausted limit) plus the removed route and the creation guard
- ✅ Quality: no dead code remains after the fix round; the unreachable guard in `update-movement.ts` was removed

## Warnings
- W1: the concurrency tests assert the final balance equals one of the 20 targets, which fails without the lock, but they do not assert it equals the target of the last committed request.
- W1b: the lock covers the account row only; `POST /movements` takes no account lock, so a movement inserted between the balance read and the commit changes the final balance by that amount. Outside AC-15.
- W2: the "Set balance" row action stays enabled offline; the confirm button is the disabled action and the offline message shows.
- W3: the PUT-409 test sends an expense body, so it exercises the pre-existing type-mismatch guard, which is the protection that applies.
- W4: the concurrency tests never hit a zero-difference turn inside the race.
- A request refused after the second-factor check burns one code, by design (documented in the use case).

Result: PASSED

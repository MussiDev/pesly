# Test run FEAT-012

| Field | Value |
|---|---|
| Runner | vitest 5.0.1 |
| Command | `TEST_DATABASE_URL=postgres://argent:argent@127.0.0.1:5436/feat012_test npx vitest run --coverage --maxWorkers=2 --retry=2 --coverage.reportOnFailure=true --reporter=dot` |
| Total | 11373 |
| Passed | 11371 |
| Failed | 0 |
| Skipped | 2 |
| Line coverage | 96.85% |
| Branch coverage | 90.16% |
| Function coverage | 94.88% |
| Coverage floor | 80% lines, 80% branches, 80% functions (AGENTS.md, "Testing") |
| Lint | `npx eslint apps packages --quiet` — clean, 0 findings; `prettier --check --end-of-line auto` clean (plain `pnpm lint` reports only CRLF line endings of this Windows checkout) |

## Failures
(none)

## Skips
- `apps/web/test/group-category-views-scans.test.ts` > "adds no file to apps/api/drizzle: no migration" — skipped because the file's own `describe.skipIf(base === undefined)` guard fires: the test compares the branch against a git base ref that this checkout does not resolve. Pre-existing, from FEAT-005-era group views, not touched by FEAT-012 (which does add migration 0040 on purpose, so it would not apply to this branch).
- `apps/web/test/group-category-views-scans.test.ts` > "adds no dependency to any package.json" — skipped because of the same `skipIf(base === undefined)` guard: the git base ref is not resolvable in this checkout. FEAT-012 adds no dependency (checked in the diff).

Also run outside the unit suite: Playwright `apps/web/e2e/accounts.spec.ts` (13 tests, including the FEAT-012 set-balance, hide and delete flow) — 12 passed in the first run, the new test failed on two assertions of the test itself and passed after the fix (1 passed in a rerun); the other 12 were not rerun after the e2e-file edit, which touched only that test. API perf benchmark `set-account-balance.perf.test.ts` passed inside the run (p95 20.9 ms against 500 ms).

## Test-first evidence (reported by the implementers, not re-run)

Each block was written test-first by an implementer agent that recorded the first failing assertion of each new test before writing the code.

- Block 1 (shared contract): 11 of 12 new tests failed first (`MOVEMENT_TYPES` lacked `adjustment`; `signedMovementAmountSchema`, `setAccountBalanceRequestSchema` and the response schema were undefined imports; `hideAdjustments` parsed `yes` as valid). One test, that creation schemas reject `adjustment`, passed before and was kept as a regression guard.
- Block 2 (migration 0040): 11 of 12 failed first (ENOENT on the rollback file, `movements_amount_range_check` and `movements_shape_check` violations on a valid adjustment). The negative-amount guard for non-adjustments passed before by design.
- Block 3 (read paths): 11 of 13 failed first (balance expected 12500 got 7500, account-flow reader sign inverted, first-steps probe counted an adjustment, `toMovement` returned undefined). The archived-account and AC-05 same-figures regression tests passed before because that behaviour was already correct.
- Block 4 (set balance): the use-case and route tests failed first (`SetAccountBalance is not a constructor`, `createBalanceAdjuster is not a function`, missing modules); the out-of-range tests failed first (500 instead of 400, check-constraint violation); the use-case mapping test for out-of-range and the perf benchmark were not seen failing.
- Blocks 5 and 6: 1 of 6 new tests failed first (removed route answered 500 because its import was gone). The other 5 passed on first run because the behaviour already existed (the type-mismatch guard, the creation schema, generic delete); a mutation check, disabling the type comparison in `update-movement.ts`, made the 409 test fail with "expected 404 to be 409", then the code was restored.
- Block 7 (web accounts): 35 tests failed first across 6 files (missing modules, `client.setAccountBalance is not a function`, missing "Fijar saldo" button, old catalog keys still present).
- Block 8 (web movements): 17 of 20 new tests failed first (`MISSING_MESSAGE movements.types.adjustment`, edit link present, `hideAdjustments` absent from the URL, type pills offered `adjustment`). The edit-container adjustment test, two movements-list container tests and two row tests were written alongside the code and were not seen failing.
- Verifier-round fixes: the settlement pending-label test failed first with `MISSING_MESSAGE groups.settlement.pending`, and the stale second-factor test failed first (the invalid-code message was not shown). The removal of the unreachable guard in `update-movement.ts` is covered by the existing 409 test and was not seen failing, because the code was dead.

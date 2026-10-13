# Verification FEAT-011

| Field | Value |
|---|---|
| Module | budgets by statement month, and available money on the home screen (`apps/api/src/budgets`, `apps/api/src/accounts`, `apps/api/src/dashboard`, `packages/shared`, `apps/web/src/features/budgets`, `apps/web/src/features/dashboard`) |
| Line coverage | 98.71% (305 of 309 lines of the 27 changed source files) |
| Branch coverage | 90.72% (176 of 194 branches of the same files) |
| Function coverage | 99.07% (106 of 107 functions of the same files) |
| Coverage floor | 80% lines, 80% branches, 80% functions (AGENTS.md, "Testing") |
| Lint | `pnpm exec eslint .` — clean, 0 findings; `pnpm exec prettier --check --end-of-line auto .` — clean; `pnpm typecheck` — clean |

The whole-repository run gives 96.87% lines, 90.14% branches and 94.89% functions (11,245 passed, 2
skipped, 0 failed; `docs/ddw/reports/tests-FEAT-011.md`). The changed-files figures come from
`coverage/coverage-summary.json` of that run. The cross-verification was done by an agent that did not
write the code. DDW does not run the suite: the numbers are the account of the run above.

## Acceptance criteria
- ✅ AC-01 — `spending-reader.test.ts`: "returns the 30,000.00 ARS purchase of 2026-09-20 ... counts in October and not September (AC-01, AC-07)"; `spending-use-cases.test.ts`: "counts the September-dated purchase and the first installment in October"; e2e `credit-cards-spending-month.spec.ts` (`apps/api/src/budgets/infrastructure/db/drizzle-spending-reader.ts:85`)
- ✅ AC-02 — `spending-reader.test.ts`: "returns 10,000.00 ARS for each statement of a 60,000.00 ARS purchase in 6 installments"; `budget-parity.test.ts`: "count the 6 installments of a purchase in the same statement months" (`drizzle-spending-reader.ts:172`)
- ✅ AC-03 — `spending-reader.test.ts`: "puts a purchase dated 2026-09-25 on the next statement (AC-03)"
- ✅ AC-04 — `statement-month.test.ts`: "uses the month of the stored due date, even when later than the period"; `spending-reader.test.ts`: "returns the edited stored due date ..." and "moves an installment to the month of an edited stored due date"
- ✅ AC-05 — `statement-month.test.ts`: "derives the due date from the closing and due days ..."; `spending-reader.test.ts`: "returns a null due date and the card days when the statement is not stored ..."; `budget-parity.test.ts`: "count the same card purchases, installments and fallback cycles in the same months"
- ⚠️ AC-06 — `spending-reader.test.ts`: "does not return an expense on a bank account, income, transfers or exchanges ... (AC-06, AC-08)" and `spending-flow.test.ts`; the "still returned by personalSpending in September" half rests on the flow tests and the existing personal-reader tests
- ✅ AC-07 — `spending-reader.test.ts`: "adds a card-account expense to exactly one of personalSpending and cardPurchaseSpending"; `spending-use-cases.test.ts`: "counts a purchase once across September and October: the two months add to the purchase (AC-07)"
- ✅ AC-08 — `spending-reader.test.ts` (same test as AC-06); `budget-parity.test.ts`: "count a statement payment, a transfer to the card, in neither (AC-08)", which has a real purchase as control
- ✅ AC-09 — `spending-domain.test.ts`: "converts a card purchase in USD with its frozen rate (AC-09)"; `spending-reader.test.ts`: "returns a purchase of 20.00 USD with its frozen rate"
- ✅ AC-10 — `spending-use-cases.test.ts`: "puts a row due last month in the previous bucket, so rollover carries its leftover (AC-10)"
- ✅ AC-11 — `alerts-use-case.test.ts`: "fires 80 in the month of the statement ..."; `alerts-flow.test.ts`: "publishes the 80% notice in October ..."
- ✅ AC-12 — `spending-reader.test.ts`: "reads an already stored purchase under the new rule, with no migration step"; the diff holds 0 migration files
- ✅ AC-13 — `budgets-list.test.tsx`: "shows the card purchases note under the header in %s"; `budget-detail.test.tsx`: "shows the card purchases note in %s"; `budgets-catalog.test.ts`
- ✅ AC-14 — `statement-month.test.ts`: "falls back to the period month when the days are unusable"; `spending-reader.test.ts`: "still returns the purchase of a card whose days give no valid cycle"
- ✅ AC-15 — `budget-spending.perf.test.ts` and `spending-query-plan.test.ts`: "serves the card purchase and installment reads from indexes ..."; thresholds unchanged
- ✅ AC-16 — `spending-reader.test.ts`: "never returns another user's card purchase (AC-16)" and "never returns another user's installment (AC-16)"
- ⚠️ AC-17 — `budgets-list.test.tsx`: "loads the list with the same single request as before (AC-17)"; the detail screen has no request-count assertion
- ✅ AC-18 — `available-section.test.ts`: "(AC-18) returns the two parts ..."; `dashboard-net-worth.test.tsx`: "shows the available money with its ARS and USD parts (AC-18)"; e2e `dashboard.spec.ts` es and en (`apps/api/src/dashboard/application/build-available.ts`)
- ✅ AC-19 — `available-section.test.ts`: "(AC-19) equals the available totals of ListAccounts for the same data"; `get-available-totals.test.ts`: "gives the same result as ListAccounts.availableTotals"
- ✅ AC-20 — `available-section.test.ts`: "(AC-20) converts the USD part with the rate the net worth read"; `dashboard-net-worth.test.tsx`: "shows the converted total in the display currency (AC-20)"
- ✅ AC-21 — `available-section.test.ts`: "(AC-21) without a rate gives total null, the reason and the two parts"; `dashboard-adapter.test.ts`: "keeps both available parts and no total on no_rate (AC-21)"
- ✅ AC-22 — `available-section.test.ts`: "(AC-22) an archived account and one not marked include-in-available add 0"; `get-available-totals.test.ts`
- ✅ AC-23 — `available-section.test.ts`: "(AC-23) a credit card with debt and an investment portfolio do not change it"
- ✅ AC-24 — `available-section.test.ts`: "(AC-24) another user's included account never counts"; `get-available-totals.test.ts`: "never counts another user's accounts"
- ✅ AC-25 — `dashboard-container.test.tsx`: "shows the available money beside the net worth ..., with no extra request (AC-18, AC-25)"; `dashboard.perf.test.ts`: "answers under 1 s at p95 with 46 statements or fewer and a body of 32 KB or less"
- ✅ AC-26 — `dashboard-catalog.test.ts`; `dashboard-net-worth.test.tsx`: "reads the label from the Spanish catalog (AC-26)"; e2e es and en tile tests
- ✅ AC-27 — `spending-domain.test.ts`: "adds an installment in the budget currency and counts one in the other (AC-27)"; `spending-use-cases.test.ts`: "reports a USD installment in an ARS budget as not converted ..."; `budget-detail.test.tsx` and `budgets-list.test.tsx`
- ✅ AC-28 — `dashboard.perf.test.ts`: the dashboard request runs 46 statements or fewer (`MAX_STATEMENTS = 46`)

## Spec blocks
- ✅ Block 1 — shared placement rule: `statement-month.ts`, its export and the reports wrapper; every task done, 5 of 5 listed tests
- ✅ Block 2 — budgets domain, row types and port: every task done; the window helpers moved to Block 4 and the spec records it
- ✅ Block 3 — Drizzle spending reader: every task done, all 13 listed tests exist
- ✅ Block 4 — use cases, callers and response: every task done; the parity test moved to Block 8 and the spec records it
- ✅ Block 5 — budget screens, note and installment notice: every task done; reuses `CardPurchasesNote`, no new key
- ✅ Block 6 — dashboard available money, API: every task done; uses `GetAvailableTotals`, reason `no_rate`
- ✅ Block 7 — dashboard available money, web and i18n: every task done
- ✅ Block 8 — end to end, parity and performance: every task done; dashboard ceiling 46 (NFR-07), no latency threshold changed

## Tests
- ✅ Sad-path tests: `spending-routes.test.ts` (400 invalid month, `BUDGET_MONTH_IN_FUTURE`, 401), `spending-use-cases.test.ts` (404 of another user's budget), `get-dashboard.test.ts` and `available-section.test.ts` (an accounts read error is not swallowed), `statement-month.test.ts` (unusable days), `spending-domain.test.ts` (missing frozen rate), `spending-reader.test.ts` (empty category list, database failure rethrown), `get-available-totals.test.ts` (movements failure), `dashboard-contracts.test.ts` and `budget-spending-schemas.test.ts` (invalid contract values), the web failure states for a missing field
- ✅ Spec tests: every test the blocks list exists and passes in the full run
- ⚠️ Fragile tests: the query-plan and perf seeds depend on index choice and `analyze`, a known class of flake (rerun once before reading it as a regression); a few assertions rely on the deterministic row order of grouped reads

## Warnings
- ⚠️ `statement-month.ts`: 80% lines and 75% branches, because the rethrow of a non-`RangeError` is untested; the aggregate stays far above the floor.
- ⚠️ Per-file branch coverage under 80% in `reports/domain/flows.ts` (70%), `dashboard/domain/net-worth-now.ts` (50%), `dashboard/index.ts` (62.5%) and `present-dashboard.ts` (66.7%); the figures include code that predates this change, and the aggregate is above the floor.
- ⚠️ The use-case test "answers 404 for a budget of another user ..." carries the label AC-23, but the criterion is AC-16.
- ⚠️ The file lists of Blocks 5 to 7 in the spec are slightly stale (the notice lives in `list/`, `net-worth-now.ts` changed instead of `build-net-worth.ts`, the skeleton needed no change).
- ⚠️ `build-available.ts` reuses `netWorthPartsNow` with zeroed inputs to convert; if that input type gains a field it would need a look.
- ⚠️ `GetAvailableTotals` repeats the pipeline of `ListAccounts`; the test that compares both is the guard against drift.
- ⚠️ The dashboard statement ceiling moved from 40 to 46 (NFR-07), a decision of the human owner recorded in the PRD.

Result: PASSED

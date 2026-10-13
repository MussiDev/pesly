# Verification FEAT-010

| Field | Value |
|---|---|
| Module | apps/api/src/reports (flow reader, report use cases), apps/api/src/dashboard/application/build-month-flows.ts, apps/web/src/components/card-purchases-note.tsx and the three screens that show it |
| Line coverage | 96% |
| Branch coverage | 86% |
| Function coverage | 99% |
| Coverage floor | 80% (AGENTS.md, "Testing") |
| Lint | `eslint`, `prettier --check --end-of-line auto` over the changed files and `pnpm typecheck` over the repo — clean |

An independent verifier (`ddw-module-verifier`, which did not write the code) read the code and the tests. It found no acceptance criterion broken, but two defects in the new SQL and a gap of process, and the rows below are the result after that round. The two defects were reproduced with a test that failed first and then fixed: a purchase-date window that made a month's figure depend on the range asked for, and a fallback period that could sit before the last stored statement after a hand-edited closing date. The gap was that the web tests of Block 3 were written after the component; the evidence added is that taking the note out of the three screens made 8 of the 15 tests fail. The coverage and test counts are my account of the runs, not something DDW measured.

## Acceptance criteria
- ✅ AC-01 — `counts a September purchase in October in the expenses by category report` and `returns a purchase far older than the requested period when it belongs to the first stored statement, whatever the range` (`apps/api/test/reports/card-purchase-flows.test.ts`, `card-purchase-rows.test.ts`); code: `cardPurchaseRows` in `drizzle-flow-reader.ts` and the placement in `get-expenses-by-category.ts`
- ✅ AC-02 — `counts the same purchase as October spending in the income and expenses report` (`card-purchase-flows.test.ts`); code: `get-income-expenses.ts`
- ✅ AC-03 — `puts a purchase dated after the closing date in the next statement`, `puts a purchase made on the closing day itself in that statement, by the local day` and `counts a purchase dated after the closing date in the month of the next statement`
- ✅ AC-04 — `returns the edited due date of a statement whose dates were changed by hand` and `follows the stored due date when it was edited by hand`
- ✅ AC-05 — `returns a null due date, the fallback period and the card days when no statement closes after the day`, `uses the due date computed from the card days when the statement is not stored` and `puts a purchase dated after an edited closing date in the cycle after the last stored statement`
- ✅ AC-06 — `counts the 2026-09-20 purchase in October and not in September`, `counts the whole current month: a purchase whose statement is due later this month counts today` and `gives the same October spending as the expenses by category report on the same data` (`apps/api/test/dashboard/card-purchases-dashboard.test.ts`); e2e `credit-cards-spending-month.spec.ts` covers the reports, not the dashboard figure
- ✅ AC-07 — `keeps an expense on a bank account in the month of its own date` (reports and dashboard)
- ✅ AC-08 — `counts the purchase exactly once across September and October`, `returns a card-account expense from cardPurchaseRows and never from personalRows, so the two add it once` and `leaves out the payer movement of a group expense, whose share counts instead`
- ✅ AC-09 — `counts a statement payment from a bank account as no spending and no income` (reports and dashboard) and `returns neither a transfer nor an exchange into the card account, in either method`
- ✅ AC-10 — `converts a 20.00 USD card purchase with its own frozen rate` (reports) and `converts a USD card purchase with its own frozen rate` (dashboard)
- ✅ AC-11 — `counts the purchase in October when the report is filtered by the card account or a tag` and `narrows the card rows by the account filter and by the tag filter`
- ✅ AC-12 — `reads a purchase stored before this change under the new rule, with no migration step`; nothing is stored either way, so this repeats AC-01 and is kept only as the statement of the requirement
- ✅ AC-13 — `card-purchases-note.test.tsx`: the note alone in both catalogs, the expenses by category report in both languages, the income and expenses report in both languages, and the dashboard in both languages (`dashboard-screen-month-notice.test.tsx`)
- ✅ AC-14 — `counts a purchase once and does not break for a card whose clamped days give a short-month due date`; a card with no usable days cannot exist (its days are required, 1 to 31), so the criterion is covered by the clamped-days case
- ✅ AC-15 — `pnpm test:perf` for the reports and the dashboard passed at the existing thresholds, twice, the second time after the query changed; run by me, not by the verifier
- ✅ AC-16 — `does not return the card purchases of another user`, `does not count the card purchase of another user for the caller` and `does not count the card purchase of another user` (dashboard)
- ✅ AC-17 — `loads the report with the same single request as before` and `loads the income and expenses report with the same single request as before`; the note makes no request of its own

## Spec blocks
- ✅ Block 1 — every task done; `apps/api/test/reports/card-purchase-rows.test.ts` (21 tests) covers the stored statement, the next statement, the closing day by local day, the edited due date, the fallback, the range filter, bank accounts, income, transfers and exchanges, the frozen rate, the filters, the quote in the tag, another user, the group payer movement, and the database refusing an expense without a rate or a category
- ✅ Block 2 — every task done; `card-purchase-flows.test.ts` (13 tests), `card-purchases-dashboard.test.ts` (7 tests) and the use case tests with fake readers for the missing rate and the unknown category
- ✅ Block 3 — every task done; `card-purchases-note.test.tsx`, the dashboard notice test and the e2e `credit-cards-spending-month.spec.ts`, which shows a card purchase made today in the movements list and not in this month's spending, and counts it once its statement is due this month

## Tests
- ✅ Sad-path tests: a tag with a quote and SQL text, the purchase of another user, an expense the database refuses without a rate or a category, a purchase with no stored statement, a clamped card, a row without a frozen rate and an unknown top category in the use cases, and a screen whose report is refused with a server answer are each tested; the change accepts no new input
- ✅ Test-first evidence: `docs/ddw/reports/tests-FEAT-010.md`, section "Tests written first", records the red run of Blocks 1 and 2, the regression tests of the verifier's two findings, and, for Block 3, that the tests came after the component and that removing the note makes 8 tests fail
- ✅ Suite: 6598 tests, 6596 passed, 0 failed, 2 skipped with a reason (a branch-relative scan of another ticket); the e2e scenario passes on its own database

## Not proven here
- The project-wide coverage floor over api, web and shared together is measured by CI; only the changed files were measured locally.
- The two fixes made after the independent verification were not reviewed again by the verifier; they are covered by regression tests that failed before.
- The e2e needs `NODE_OPTIONS=--dns-result-order=ipv4first` on this machine because of the Docker IPv6 forwarding of the email port; CI is not affected by that.
- The dashboard converts the card rows together with the installments in `count` mode, while the reports use `throw`; it cannot differ today because every card purchase has a frozen rate.

Result: PASSED

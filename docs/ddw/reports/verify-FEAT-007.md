# Verification FEAT-007

| Field | Value |
|---|---|
| Module | apps/web/src/features/groups (detail/, components/group-recent-expenses.tsx, components/group-section-state.tsx, components/group-suggested-payments-section.tsx, containers/group-detail-container.tsx, balances/suggested-payments.tsx) |
| Line coverage | 98% |
| Branch coverage | 89% |
| Function coverage | 95% |
| Coverage floor | 80% (AGENTS.md, "Testing") |
| Lint | `eslint` and `tsc --noEmit` over the changed paths — clean, 0 findings |

An independent verifier (`ddw-module-verifier`, which did not write the code) read the code and the tests. It found no defect in the code and one blocking gap (no written evidence that the tests were red first), plus ten criteria whose tests were weaker than their wording. The evidence was added to `docs/ddw/reports/tests-FEAT-007.md` and the tests were strengthened; the rows below are the result after that round. The coverage and test counts are my account of the runs, not something DDW measured.

## Acceptance criteria
- ✅ AC-01 — `shows the suggested payments and the recent expenses on the detail` (`apps/web/test/group-detail-sections-container.test.tsx`); code: `buildBalanceView` into `GroupSuggestedPaymentsSection` in `group-detail-container.tsx`. Both screens use the same builder; no test compares the two screens' output directly.
- ✅ AC-02 — `lists the payments of each currency with payer, payee, amount and a Record button` (`apps/web/test/group-detail-sections.test.tsx`)
- ✅ AC-03 — `opens the settlement form prefilled when Record is pressed` asserts the amount and the direction line "Bruno pays Ana 1,500.00 ARS"; `calls onRecord with the currency and the payment that was pressed` asserts currency and payment
- ✅ AC-04 — `closes the form and reloads only the balances after a payment is recorded` asserts the form is gone, the only call after the POST is the balances GET, and the own-balance summary changes from "You are owed 1,500.00 ARS" to "You are settled up in ARS"; e2e `the group detail records a suggested payment and lists the recent expenses`
- ✅ AC-05 — container test, recording refused by the server: the form stays open, the alert is shown and the balances are requested only once
- ✅ AC-06 — `shows the settled message when no currency has a payment`; `shows the settled message and no rows when no currency has a payment` (section)
- ✅ AC-07 — `shows at most 5 rows, in the order the API sent them` (6 items in, 5 out, order kept); hook `asks for the 5 newest expenses and the options once each`. "Newest first" is the API's ordering, which the web keeps; the web does not sort.
- ✅ AC-08 — the See all link href is asserted in `shows the suggested payments and the recent expenses on the detail` and in the section test `shows the rows, with no row actions, and the See all link to the expenses page`
- ✅ AC-09 — `shows the empty message and the link when the group has no expenses`
- ✅ AC-10 — container tests, balances call refused by the server: the retry button appears in the suggested payments section only, members and expenses stay visible, the own-balance summary shows its unavailable text, and pressing retry loads the balances again and leaves the expenses alone
- ✅ AC-11 — container tests, expenses call refused by the server: the retry button appears in the recent expenses section only, balances and members stay visible, and pressing retry loads the list again and leaves the balances alone
- ✅ AC-12 — `a 404 on the %s call shows the not-found view and neither section` and `a 401 on the %s call goes to sign-in`, each for balances, expenses and options; the group call is covered by the existing `group-detail.test.tsx`
- ✅ AC-13 — `renders both sections in Spanish` asserts the Spanish headings, link, and number and date formats; the section tests render both catalogs
- ✅ AC-14 — `issues the group, balances, list and options calls once each` and `issues the four load calls without waiting for any answer to arrive` (no call answers, and all four are issued)
- ✅ AC-15 — e2e `the group detail fits 320 px with both new sections` (320 px at the default text size, as the decision log of the PRD limits it), run again after the final change
- ✅ AC-16 — `renders from props alone and makes no request of its own` (no fetch is made while rendering the sections)
- ✅ AC-17 — `shows the members and at most 5 skeleton rows while the expenses call is held pending` (the expenses call never answers)

## Spec blocks
- ✅ Block 1 — every task done; tests `apps/web/test/group-recent-expenses-data.test.tsx` (8 tests) name the limit, the empty list, the failed list with retry, the 401 and 404 path to `onFatal`, and the unmapped category
- ✅ Block 2 — every task done; tests `apps/web/test/group-detail-sections.test.tsx` (13 tests) cover both sections, the states, both catalogs, the accessible name of Record and the `<img onerror>` case as literal text
- ✅ Block 3 — every task done; tests `apps/web/test/group-detail-sections-container.test.tsx` (22 tests) and the updated call counts of `apps/web/test/group-detail.test.tsx`; e2e in `apps/web/e2e/group-settlements.spec.ts` (the spec named `groups.spec.ts` by mistake and was corrected)

## Tests
- ✅ Sad-path tests: failed list call, failed balances call, failed record, failed reload after a record, 401 and 404 on each secondary call, an unmapped category and a script-like description are each tested; no new input is accepted by this change
- ✅ Test-first evidence: `docs/ddw/reports/tests-FEAT-007.md`, section "Tests written first", records the red run of each block
- ✅ Suite: 4718 tests, 4716 passed, 0 failed, 2 skipped with a reason (a branch-relative scan of another ticket); the two e2e scenarios and the 41 existing group e2e tests pass, each spec run on its own database

## Not proven here
- `useGroupBalances` has no direct unit test; it is exercised through the container (first load, retry, reload, 401 and 404).
- The project-wide coverage floor over api, web and shared together is measured by CI; only the changed files were measured locally.
- A single Playwright run of five group specs in one database failed on user registration (verification email not arriving in 30 s); each spec passes on its own database.

Result: PASSED

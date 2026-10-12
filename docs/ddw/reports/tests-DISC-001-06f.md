# Test run DISC-001-06f

| Field | Value |
|---|---|
| Runner | vitest (V8 coverage via @vitest/coverage-v8), full suite with coverage; Playwright for the end-to-end file |
| Command | `pnpm test:coverage` (Vitest over `apps/api/src`, `apps/web/src` and `packages/shared/src` together, V8 coverage, `TEST_DATABASE_URL` pointing at the local PostgreSQL) |
| Total | 9418 |
| Passed | 9418 |
| Failed | 0 |
| Skipped | 0 |
| Statement coverage | 94.92 |
| Line coverage | 96.79 |
| Branch coverage | 90.1 |
| Function coverage | 94.89 |
| Coverage floor | 80% lines, branches and functions (AGENTS.md, "Testing") |

## Scope

Full-suite run for ticket DISC-001-06f (553 test files), measured over `apps/api/src`, `apps/web/src` and `packages/shared/src` together, as AGENTS.md requires. The ticket is web only: budget methods in the api-client, the budget view helpers and request builders (month, thresholds, view, request, failure), the budgets catalogs (es and en), the budgets list with its month selector and progress bar, the budget detail, create and edit forms, the delete confirmation, the budget alert label in the notices list and the four pages that replace the "coming soon" placeholder. It adds no endpoint, no migration and no dependency. The budgets screens are online only (the budgets API has no offline path).

End-to-end: `apps/web/e2e/budgets.spec.ts`, 6 of 6 tests pass (create, read, edit, open the detail, add one with rollover and delete; an earlier month with no next action on the current one; the 51st budget refused; another user's budget and a malformed id; the budget alert label in the notices list; the screens at 360 px). The file was run twice, the second time after the fixes below.

## Acceptance criteria to tests

Folder `apps/web/test` unless a path is given.

| AC | Tests |
|---|---|
| AC-01 | `budgets-list.test.tsx` "shows name, currency, spent, available, remaining and percentage (%s, AC-01, AC-30)"; `api-client-budgets.test.ts` "listBudgetSpending sends no month by default, sends a given month and returns the budgets (AC-01, AC-07)"; `budgets-helpers.test.ts` "gives name, currency and the four figures as bigint and the percentage as received" |
| AC-02 | `budgets-list.test.tsx` "shows the error with a retry, never the empty state, and retries (AC-02)"; `budget-detail.test.tsx` "shows the error state with a retry that loads again (AC-02)" and "shows the error state when the categories fail to load (AC-02)" |
| AC-03 | `budgets-list.test.tsx` "draws a marker at each threshold with its label (AC-03)"; `budgets-helpers.test.ts` "puts markers at 80 and 100 for thresholds 80 and 100" |
| AC-04 | `budgets-list.test.tsx` "shows over budget, the negative amount and a full bar (AC-04)"; `budgets-helpers.test.ts` "gives overBudget, the negative bigint and a full bar for a negative remaining" |
| AC-05 | `budgets-list.test.tsx` "shows the API's percentage above 100 (AC-05)"; `budgets-helpers.test.ts` "keeps a percentage of 1000 as received with a bar width of 100" and "clamps a threshold above 100 to the bar edge and keeps its label" |
| AC-06 | `budgets-list.test.tsx` "shows the rollover amount only when rollover is on (AC-06)"; `budgets-helpers.test.ts` "keeps the rollover amount and the available amount as returned" |
| AC-07 | `budgets-list.test.tsx` "loads an earlier month with 1 request and offers the way back (AC-07, NFR-02)" and "going forward to the current month sends no month (D4)"; `budgets-helpers.test.ts` "steps back across a year boundary" and "walks back and forth and sends no month for the current one"; `apps/web/e2e/budgets.spec.ts` "an earlier month shows its budgets and the current month has no next action (AC-07, AC-08)" |
| AC-08 | `budgets-list.test.tsx` "has no next action on the current month (AC-08)"; `budgets-helpers.test.ts` "has no next step on the current month"; `apps/web/e2e/budgets.spec.ts` "an earlier month shows its budgets and the current month has no next action (AC-07, AC-08)" |
| AC-09 | `budgets-list.test.tsx` "shows the refusal of a future month and returns to the current month (AC-09)"; `api-client-budgets.test.ts` "a refused 51st budget, an income category and a future month surface their own keys (AC-09, AC-27, AC-28)"; `budgets-helpers.test.ts` "detects the future month refusal only" |
| AC-10 | `budgets-list.test.tsx` "shows the empty state with the create action when there are no budgets (AC-10)" |
| AC-11 | `budget-detail.test.tsx` "shows the figures, the covered categories by name and the thresholds (AC-11)", "shows a selected subcategory under its parent even when the parent is not selected (AC-11)" and "lists a covered category the list does not name with the unavailable label (M1)"; `api-client-budgets.test.ts` "getBudgetSpending sends the month and returns the figures (AC-11)" |
| AC-12 | `budget-detail.test.tsx` "shows the not found state for a missing, foreign or not-yet-existing budget (AC-12)", "shows the not found state when only the month has no version in force (AC-12)" and "shows not found and sends no request for a malformed budget id (invalid input)"; `api-client-budgets.test.ts` "getBudget returns the budget and a 404 is the not found failure (AC-12)"; `apps/web/e2e/budgets.spec.ts` "a budget of another user and a malformed id open the not found state (AC-12)" |
| AC-13 | `budgets-list.test.tsx` "shows the unconverted shares notice with its count and none at 0 (AC-13, AC-14)" and "renders nothing for a count of 0 and the count otherwise (AC-13, AC-14)"; `budget-detail.test.tsx` "shows the unconverted shares notice with its count (AC-13)" |
| AC-14 | `budgets-list.test.tsx` "shows the unconverted shares notice with its count and none at 0 (AC-13, AC-14)"; `budget-detail.test.tsx` "shows no unconverted shares notice at 0 (AC-14)" |
| AC-15 | `budget-form.test.tsx` "creates the budget with the default thresholds and goes to the list" and "sends the chosen currency, rollover and a changed thresholds list"; `budgets-helpers.test.ts` "builds the body with the default thresholds when none changed"; `api-client-budgets.test.ts` "createBudget sends the amount as a minor-units string and the thresholds (AC-15)"; `apps/web/e2e/budgets.spec.ts` "create, read, edit, open the detail, add one with rollover and delete a budget (AC-15, AC-21, AC-24)" |
| AC-16 | `budget-form.test.tsx` "shows a field error and sends no request for %j / %j / category %j" (empty name, 51 characters, empty, zero and non-numeric amount, no category; focus moves to the first invalid field) and "shows a field error and sends nothing for an invalid name"; `budgets-helpers.test.ts` "rejects an empty name and a name of 51 characters", "rejects an empty, zero or non-numeric amount", "rejects no category and more than 50" and "reports every invalid field at once" |
| AC-17 | `budget-form.test.tsx` "offers expense categories with subcategories under their parent and no income" |
| AC-18 | `budget-form.test.tsx` "shows a category load failure with a retry and disables the submit until it loads" and "shows a category load failure with its own retry and disables the save" |
| AC-19 | `budget-form.test.tsx` "accepts a new whole number from 1 to 200", "rejects %j as invalid" ('0', '201', '10.5', 'abc') and "rejects a duplicate"; `budgets-helpers.test.ts` "accepts 90 and keeps the list ascending", "rejects 0, 201, a decimal, text and an empty input" and "rejects a duplicate" |
| AC-20 | `budget-form.test.tsx` "hides the add control at 5 thresholds" and "shows a field error and sends nothing when the last threshold is removed"; `budgets-helpers.test.ts` "refuses a sixth threshold" and "removing the last threshold makes the builder return an input error" |
| AC-21 | `budget-form.test.tsx` "sends only the changed fields and shows the figures the API returned" and "sends the categories and thresholds when they change"; `budgets-helpers.test.ts` "sends only the changed fields"; `api-client-budgets.test.ts` "updateBudget sends only the given fields (AC-21)"; `apps/web/e2e/budgets.spec.ts` the create, read, edit, detail and delete test (AC-21) |
| AC-22 | `budget-form.test.tsx` "loads in 2 requests and shows the values, the currency read only and the note"; `budgets-helpers.test.ts` "never sends the currency" |
| AC-23 | `budget-form.test.tsx` "disables the save while nothing changed and enables it after a change"; `budgets-helpers.test.ts` "returns no body when nothing changed, comparing categories as a set" |
| AC-24 | `budget-delete.test.tsx` "confirming deletes once and calls onDeleted (AC-24, NFR-02)" and "keeps the lock after a successful delete so a later tap sends nothing"; `budget-detail.test.tsx` "goes to the list after the budget is deleted"; `api-client-budgets.test.ts` "deleteBudget resolves with no body (AC-24)"; `apps/web/e2e/budgets.spec.ts` the create, read, edit, detail and delete test (AC-24) |
| AC-25 | `budget-delete.test.tsx` "cancelling closes the confirmation and sends nothing (AC-25)" and "asks first, saying past spending is not affected (FR-12)" |
| AC-26 | `notices.test.tsx` "shows the month of a budget alert and no due label in %s (AC-26, AC-30)", "keeps \"Due {date}\" for a notice of another kind (AC-26)" and "keeps unread and read budget alerts interactive and read-only (AC-26)"; `budgets-catalog.test.ts` "has the budget alert month label in notices (%s)"; `apps/web/e2e/budgets.spec.ts` "a budget alert in the notices list shows the month and no due label (AC-26)" |
| AC-27 | `budget-form.test.tsx` "shows the refused 51st budget and keeps the values"; `api-client-budget-errors.test.ts` "maps a %i %s answer to its message key" (409 BUDGET_LIMIT_REACHED); `api-client-budgets.test.ts` "a refused 51st budget, an income category and a future month surface their own keys (AC-09, AC-27, AC-28)"; `apps/web/e2e/budgets.spec.ts` "the 51st budget is refused, the message shows and the values stay (AC-27)" |
| AC-28 | `budget-form.test.tsx` "shows the refused category kind and keeps the values"; `api-client-budget-errors.test.ts` "maps a %i %s answer to its message key" (400 BUDGET_CATEGORY_KIND_INVALID); `budgets-helpers.test.ts` "maps the refused 51st budget, the invalid category kind and the future month" |
| AC-29 | `budgets-list.test.tsx` "shows the offline message on a network failure (AC-29)"; `budget-detail.test.tsx` "shows the offline message when the load is offline (AC-29)"; `budget-delete.test.tsx` "a network failure shows the offline message and keeps the confirmation (AC-29)"; `budget-form.test.tsx` "shows the offline message and keeps the input on a network failure" and "keeps the input on a refusal and on a network failure when saving"; `api-client-budgets.test.ts` "a network failure is the offline failure (AC-29)"; `budgets-helpers.test.ts` "maps a network failure to offline and a 404 to not found" |
| AC-30 | `budgets-list.test.tsx` the es and en run of "shows name, currency, spent, available, remaining and percentage (%s, AC-01, AC-30)"; `budget-detail.test.tsx` "renders Spanish strings, amounts and months (AC-30)"; `budget-delete.test.tsx` "renders Spanish strings (AC-30)"; `budget-form.test.tsx` both "renders Spanish strings" tests; `notices.test.tsx` "shows the month of a budget alert and no due label in %s (AC-26, AC-30)"; `budgets-catalog.test.ts` "has every budgets key in %s with its ICU arguments" and "bakes no amount or date into a message"; `api-client-budget-errors.test.ts` "has both messages in the %s catalog"; `budgets-no-hardcoded-strings.test.ts` "has no hardcoded user-facing string" |

## Non-functional requirements to tests

| NFR | Tests |
|---|---|
| NFR-01 | `apps/web/e2e/budgets.spec.ts` "the list, detail, create and edit screens fit a 360 px viewport (NFR-01)" |
| NFR-02 | `budgets-list.test.tsx` "loads an earlier month with 1 request and offers the way back (AC-07, NFR-02)"; `budget-detail.test.tsx` "makes exactly 3 requests: the budget, its spending and the categories (NFR-02)"; `budget-form.test.tsx` "makes one request to load and exactly one to save, even on a double tap" and "sends one save on a double tap"; `budget-delete.test.tsx` "confirming deletes once and calls onDeleted (AC-24, NFR-02)" |
| NFR-03 | `budgets-catalog.test.ts` "has the same budgets keys in es and en", "has the same keys in es and en across the whole catalog, none empty" and "error: a catalog lacking a key or holding an empty value is detected"; `budgets-no-hardcoded-strings.test.ts` "has no hardcoded user-facing string" |
| NFR-04 | `budgets-no-hardcoded-strings.test.ts` "applies no parseFloat, toFixed or Number( to money" and "derives no percentage or amount on the client", with the planted-code checks "error: planted arithmetic on a percentage is reported with file and line", "error: planted division of an amount by 100 is reported, the percent rescale is not" and "error: planted parseFloat on an amount is reported"; `budgets-helpers.test.ts` "keeps a percentage of 1000 as received with a bar width of 100" |
| NFR-05 | Coverage figures above (all files: 96.79 lines, 90.1 branches, 94.89 functions); every AC row of the table above names at least one test |
| NFR-06 | `budgets-list.test.tsx` "has 44 px targets, labeled month actions and a labeled bar (NFR-06)"; `budget-detail.test.tsx` "has 44 px targets and labeled controls (NFR-06)"; `budget-delete.test.tsx` "controls have labels and 44 px targets (NFR-06)"; `budget-form.test.tsx` "labels every control and gives every target 44 px" |

Fixed after the independent module verifier, each with a test that failed first (commit a053486): M1 `budget-form.test.tsx` "shows a selected category the picker does not offer and lets it be unchecked (M1)" and `budget-detail.test.tsx` "lists a covered category the list does not name with the unavailable label (M1)"; M2 `budget-form.test.tsx` "commits a typed but not added threshold on save (M2)" and "shows an error and sends nothing for an invalid typed threshold on save (M2)"; M3 `budget-delete.test.tsx` "disables cancel while the delete is pending (M3)"; M4 `budget-delete.test.tsx` "sends a signed-out user to sign in when the delete answers 401 (M4)"; L2 `budgets-list.test.tsx` "capitalises only the first letter of the Spanish month label (L2)"; L3 `budget-form.test.tsx` "clears a field error as soon as the field is edited (L3)"; L6 `budget-form.test.tsx` "hides the saved summary once the user edits again (L6)"; L7 `budget-delete.test.tsx` "moves focus into the confirmation, names it, and restores focus on cancel (L7)".

Sad-path tests: signed-out user sent to sign in, list and detail load failure with retry, category list failure with retry and the submit disabled, missing, foreign and malformed budget id (no request sent), month with no version in force, malformed month in the query falling back to the current one, refused future month, offline on every screen, empty or oversized name, empty, zero and non-numeric amount, no category chosen, threshold out of range, duplicate, sixth and last-removed, refused 51st budget, refused income category, double tap sending one request, delete of a budget that is not found, delete answering 401, malformed response body, invalid body or month rejected before any request (`budgets-list.test.tsx`, `budget-detail.test.tsx`, `budget-form.test.tsx`, `budget-delete.test.tsx`, `budgets-helpers.test.ts`, `api-client-budgets.test.ts`, `api-client-budget-errors.test.ts`, `apps/web/e2e/budgets.spec.ts`).

Other checks:

- Spec Block 0 (api-client and catalogs): `api-client-budgets.test.ts`, `api-client-budget-errors.test.ts` and `budgets-catalog.test.ts`.
- Spec Block 1 (helpers): `budgets-helpers.test.ts`.
- Spec Block 2 (list, month selector, progress bar): `budgets-list.test.tsx`.
- Spec Block 3 (detail): `budget-detail.test.tsx`.
- Spec Block 4 (create and edit forms): `budget-form.test.tsx`.
- Spec Block 5 (delete and routes): `budget-delete.test.tsx`.
- Spec Block 6 (budget alert label): `notices.test.tsx`.
- Spec Block 7 (scans and end-to-end): `budgets-no-hardcoded-strings.test.ts` and `apps/web/e2e/budgets.spec.ts` (6 of 6 pass).
- `pnpm audit --prod --audit-level high`: no dependency was added or changed (no `package.json` or lockfile in the diff).

## Run anomalies

(none)

## Deviations from the spec, for the record

- NFR-02 was reworded from 2 to 3 requests for the detail page (the budget, its spending and the category list for the covered category names); the PRD now says 3.

## Owner decisions pending

- Online-only budget screens: the budgets API has no offline path.
- The month selector is limited to the current and past months.
- The categories offered come from the first 100 active expense categories; others a budget covers are shown as "unavailable category" rows that can be unchecked.
- A budget alert notice cannot link to its budget: the Notice schema carries no budget id, so it needs a shared-schema and API change, out of scope.
- A budget created this month is absent from earlier months; its detail for such a month answers not found.
- `percent / 100` is the only arithmetic, and it is display-only for the ICU percent format.

## Failures

(none)

## Skips

(none)

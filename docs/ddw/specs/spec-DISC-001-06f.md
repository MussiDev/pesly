# Spec DISC-001-06f: Budgets Screens

| Field | Value |
|-------|-------|
| Ticket | DISC-001-06f |
| PRD | docs/ddw/prd/prd-DISC-001-06f.md |
| Tier | FEATURE |
| Date | 2026-10-11 |
| Spec loops | 0 |
| Loops since last human decision | 0 |

## Summary
Web only, on the budgets API of 06b to 06d: no route, migration or dependency is added. Block 0 adds
the budget methods to the api-client and every Spanish and English catalog key (one `budgets` namespace
plus one `notices` key), so the catalogs and the client are touched by one block only. Block 1 is a pure
module: the view of a budget for a month (amounts as `bigint`, bar width, over-budget flag, marker
positions), month navigation, the form-to-request builders, the thresholds rules and the failure
mapping. Blocks 2 to 4 are the screens, each a container (`useApiClient()` plus a
`{kind: loading | failed | ready}` state) over pure presentational components, following the goals
screens (06e): the list with the month selector, the detail, and the create and edit forms. Block 5 adds
the delete with its confirmation and replaces the placeholder page with the four routes. Block 6 changes
the notices list so a budget alert shows its month instead of "Due {date}". Block 7 adds the scans, the
end-to-end tests including 360 px and the final verification. Money stays in minor units: the client only
parses typed input with the money input helpers and shows the API's figures; it never sums, divides or
derives a percentage, and it only compares the sign of the remaining amount.

## Decisions
- **D1 Routes.** `/budgets` (list for a month), `/budgets/new`, `/budgets/[id]` (detail, delete) and
  `/budgets/[id]/edit`. The existing `budgets/page.tsx` placeholder is replaced.
- **D2 Online only.** No screen is queued or cached offline (PRD decision); an offline load shows the
  shared error state with a retry, and an offline save shows the offline message and keeps the input.
- **D3 Figures come from the API.** Spent, available, remaining, rollover and percentage are rendered as
  returned. The bar width is the API percentage clamped to 0..100 for display only, and a budget is over
  budget when `BigInt(remaining) < 0n`, a sign test and not arithmetic. Percentages above 100 are shown
  as returned (up to 1,000), the bar is full.
- **D4 Month selection with no extra request.** The first load sends no month, so the API answers for
  the current month in the user's time zone, and the answer's `month` becomes the screen's current
  month. Earlier months are reached with `previousMonth(month)` and a spending call carrying that month;
  choosing the current month again sends no month. There is no next action while the current month is
  shown, and none before 1971-01 (the API's lower bound). The client never reads the clock or the
  profile to find the current month, which keeps the budget of 1 request per month (NFR-02).
- **D5 Request budget.** List: 1 request per selected month (the spending list). Detail: 3 requests, the
  budget, its spending for the month and the expense categories to show covered categories by name
  (AC-11). The PRD's NFR-02 counts only the budget and its spending (2); the budget response carries
  category ids and no names, so a third request is unavoidable without an API change. The spec tests 3
  and records the wording of NFR-02 as an owner ratification item. Create form: 1 (the categories). Edit
  form: 2 (the budget and the categories). Saving or deleting: exactly 1, and the screen updates from the
  response.
- **D6 Categories.** The picker asks for `kind: expense`, active categories, `limit: 100`, `offset: 0`
  (the API's maximum page, PRD decision), shows each parent with its subcategories grouped under it, and
  sends the selected ids only. A selected subcategory and its parent are both allowed; the API decides
  coverage.
- **D7 Thresholds editor.** A list of 1 to 5 whole numbers from 1 to 200, starting at 80 and 100, sorted
  ascending for display. Adding accepts only digits, in range and not already present; at 5 the add
  control is not offered; removing the last one is a field error on submit. Parsing uses a digits-only
  test and `Number.parseInt`, so the money scan can forbid `Number(` in every touched file.
- **D8 Edit sends changed fields only.** Name and amount by value, categories as a set, thresholds as a
  sorted list, rollover as a boolean. The currency is read only text. The form says the change applies
  from the current month (the API's rule). With no change the save action is disabled.
- **D9 No dialogs library.** The delete confirmation is an inline panel with the existing UI components,
  with cancel and confirm; no new dependency.
- **D10 Notices.** `notice-list.tsx` shows `formatPeriod(dueDate.slice(0, 7), locale)` under a catalog
  label for a notice of kind `budget_alert` and keeps "Due {date}" for every other kind. The notice has
  no budget id, so it stays non-navigable beyond today's read action.
- **D11 Parallel ownership.** Each block owns only the files it lists. The detail container (Block 3)
  imports the progress component of Block 2 and the delete action of Block 5 by fixed paths and props
  (see Dependencies); Block 3's tests replace the delete action with a stub, and Block 7 tests the real
  composition.

## Coverage: PRD → blocks
| Requirement | Covered by |
|---|---|
| FR-01, FR-02, FR-03 | Block 2, on the budget view of Block 1 |
| FR-04 | Block 2 (month selector), on the month helpers of Block 1 |
| FR-05 | Block 2 |
| FR-06, FR-07 | Block 3 (detail), FR-07 also in Block 2 (list), on the view of Block 1 |
| FR-08, FR-09, FR-10 | Block 4, on the request builders and the thresholds rules of Block 1 |
| FR-11 | Block 4 (edit form) |
| FR-12 | Block 5 (confirmation and delete), shown by Block 3 |
| FR-13 | Block 6, with its catalog key from Block 0 |
| FR-14 | Blocks 2 to 5 show failures through `errors.<messageKey>`; Block 0 returns the keys and Block 1 maps them; Block 7 checks it in the browser |
| FR-15 | Block 0 (catalogs), with every block reading only catalog keys and locale formatters |
| NFR-01 | Block 7 (end-to-end at 360 px on every screen) |
| NFR-02 | Strategy: one container per screen stays inside its budget (D5), asserted by call-count tests in Blocks 2, 3, 4 and 5 |
| NFR-03 | Block 0 (parity test), scanned again in Block 7 |
| NFR-04 | Block 1 written to pass it; Block 7 scans every touched file |
| NFR-05 | Every block ships its own tests; Block 7 runs the coverage thresholds |
| NFR-06 | Blocks 2 to 5 (44 px targets and labeled controls asserted in their component tests) |

Acceptance criteria are named by the tests of the block that builds them (AC-01 to AC-30).

## Dependencies between blocks
Blocks 0 and 1 touch disjoint files and run in parallel first. Block 6 needs only Block 0 (its catalog
key) and owns the notices files, so it runs in parallel with every other block once Block 0 is done.
Blocks 2, 3 and 4 need Blocks 0 (calls and keys) and 1 (view helpers, builders, thresholds rules); they
own disjoint folders and run in parallel. Block 5 owns the delete action and the pages; the pages import
the three containers of Blocks 2 to 4 by fixed names, so Block 5 starts after Blocks 2, 3 and 4 are
merged into the worktree (its delete action alone could start earlier, but the pages decide the order).
Block 7 is last and owns the scans and the end-to-end tests.

Fixed contracts that let Blocks 3 and 5 be written without waiting for each other:
- `BudgetProgress` (`features/budgets/list/budget-progress.tsx`, Block 2): props
  `{view: BudgetView}`; renders the bar with its threshold markers, the over-budget state and the
  figures, and is imported by the detail.
- `BudgetDeleteAction` (`features/budgets/delete/budget-delete-action.tsx`, Block 5): props
  `{budgetId: string; onDeleted: () => void}`.
- Containers used by the pages: `BudgetsContainer` (Block 2), `BudgetDetailContainer` with props
  `{budgetId: string}` (Block 3), `CreateBudgetContainer` and `EditBudgetContainer` with props
  `{budgetId: string}` for the edit one (Block 4).

| Block | Owns (parallel group) |
|---|---|
| 0 | `apps/web/src/lib/api-client.ts`, `apps/web/messages/es.json`, `en.json` and their tests (group A) |
| 1 | `features/budgets/helpers/*` (group A) |
| 2 | `features/budgets/list/*` (group B) |
| 3 | `features/budgets/detail/*` (group B) |
| 4 | `features/budgets/form/*` (group B) |
| 5 | `features/budgets/delete/*`, `app/[locale]/(app)/budgets/**` pages (group C, after B) |
| 6 | `features/notices/components/notice-list.tsx` and its test (group B) |
| 7 | e2e, scans, final verification (last) |

All `features/budgets` paths are under `apps/web/src/`.

## Block 0 — api-client budget methods and catalogs

**Files**
- `apps/web/src/lib/api-client.ts` (modified) — interface (next to the goal methods) and implementation:
  `listBudgetSpending(query)`, `getBudget(id)`, `getBudgetSpending(id, query)`, `createBudget(body)`,
  `updateBudget(id, body)`, `deleteBudget(id)`.
- `apps/web/messages/es.json`, `apps/web/messages/en.json` (modified) — the new `budgets` namespace and
  one new key in `notices`; no other key is changed.
- `apps/web/test/api-client-budgets.test.ts` (new) — the new calls.
- `apps/web/test/budgets-catalog.test.ts` (new) — the key list of the namespace in both languages.

**Logic**
Each method (FR-01, FR-06, FR-08, FR-11, FR-12) uses the existing send helpers, parses the response with
the shared budget response validators of `@pesly/shared` (`budgetSpendingListResponseSchema`,
`budgetResponseSchema`, `budgetSpendingResponseSchema`), returns the existing `ApiResult` shape and maps
error codes with the existing code-to-key map, which already holds `BUDGET_LIMIT_REACHED`,
`BUDGET_CATEGORY_KIND_INVALID` and `BUDGET_MONTH_IN_FUTURE` and whose messages already live under
`errors.*` (FR-14). `listBudgetSpending({month?})` and `getBudgetSpending(id, {month?})` send the month
only when given. `deleteBudget` returns `ApiResult<undefined>`. A missing or foreign budget comes back as
the not found failure.

The catalogs (FR-15) get, in both languages with the same structure: `budgets.list` (title,
description, create action, empty state, retry, error, month selector with previous and next labels,
the current month label), `budgets.card` (spent of available, remaining, over budget, percentage
message with a number placeholder, rollover amount, thresholds label, marker label,
unconverted-shares notice with a count placeholder), `budgets.detail` (back link, month shown, covered
categories, thresholds, edit and delete actions, not found with a link back), `budgets.form` (create and
edit titles, name, amount, currency, categories with the parent grouping label, rollover toggle,
thresholds editor with add, remove and its range hint, edit note that the change applies from the current
month, read only currency label, field errors, submit, cancel, saving state, categories error and retry)
and `budgets.delete` (confirmation title, text saying past spending is not affected, confirm and cancel).
`notices.alertMonth` carries the month label of a budget alert. Messages with numbers use ICU
placeholders; no amount or date is baked into a string, and the budget refusal messages are reused from
`errors.*`, not duplicated.

**Input validation**
- Bodies are checked against the shared budget request validators before sending; an invalid body returns
  a local failure and sends no request. A month is checked as `YYYY-MM`.
- Both catalog files stay valid JSON and the key sets stay identical.

**Error handling**
- A response that does not match its validator is a generic failure, never partial data.
- 400, 404 and 409 answers keep their message key; a network failure keeps the offline failure kind.

**Required tests**
- [ ] `listBudgetSpending` sends no month by default, sends a given month and returns the parsed budgets — validates AC-01 and AC-07.
- [ ] `getBudget` returns the budget and a 404 comes back as the not found failure — validates AC-12.
- [ ] `getBudgetSpending` sends the month and returns the figures — validates AC-11.
- [ ] `createBudget` sends the body with the amount as a minor-units string and the thresholds — validates AC-15.
- [ ] `updateBudget` sends only the given fields — validates AC-21.
- [ ] `deleteBudget` resolves with no body — validates AC-24.
- [ ] A refused 51st budget, a refused income category and a refused future month surface their own keys — validates AC-09, AC-27 and AC-28.
- [ ] A network failure is the offline failure — validates AC-29.
- [ ] A malformed response body is a failure, not data — invalid input.
- [ ] An invalid body (empty name, 6 thresholds, no category) and a malformed month are rejected before any request — invalid input.
- [ ] The Spanish and English catalogs have the same keys, none empty, and every `budgets.*` key of this block exists in both — validates NFR-03 and AC-30.
- [ ] A catalog missing a key or holding an empty value fails the parity test — invalid input.

**Completion criterion**
The api-client and catalog tests pass, the existing catalog parity test passes and typecheck is clean.

## Block 1 — Budget view helpers and request builders

**Files**
- `apps/web/src/features/budgets/helpers/budget-view.ts` (new) — display data of a budget for a month.
- `apps/web/src/features/budgets/helpers/budget-month.ts` (new) — month stepping and selector rules.
- `apps/web/src/features/budgets/helpers/budget-thresholds.ts` (new) — the thresholds editor rules.
- `apps/web/src/features/budgets/helpers/budget-request.ts` (new) — form state to request bodies and
  field errors.
- `apps/web/src/features/budgets/helpers/budget-failure.ts` (new) — failure to catalog key or not found.
- `apps/web/test/budgets-helpers.test.ts` (new).

**Logic**
`toBudgetView(spending)` returns the amounts as `bigint` parsed from the minor-units strings
(`BigInt(text)`), the integer percentage as received, the bar width (the percentage clamped to 0..100,
presentation only, D3), the marker list (each threshold with its position clamped to 0..100 and its own
value as label), the `overBudget` flag (`remaining < 0n`) and the unconverted shares count (FR-01,
FR-02, FR-03, FR-07). It never adds, divides or derives a figure. `previousMonth(month)` and
`canGoPrevious(month)` step a `YYYY-MM` string by integer arithmetic on the year and month parts, with
the floor at 1971-01; the month selector state is `{current, selected}` where `current` is the month the
no-month call answered (D4, FR-04). `monthLabelKey` is not needed: the month is formatted by the locale
formatter in the components. `addThreshold(list, text)`, `removeThreshold(list, value)` and
`canAddThreshold(list)` implement D7 and return the new list or an input error as a catalog path (FR-10).
`buildCreateBudget(state, locale)` and `buildUpdateBudget(state, original, locale)` parse the amount
with `parseAmountInput`, trim the name, and return the shared request body or a list of input errors as
catalog paths (FR-08, FR-11); the create body always carries the thresholds (default 80 and 100), and
the update body carries only changed values (D8). `budgetFailureKey(failure)` maps an api-client failure
to a catalog key, `not-found` or `offline` (FR-14), and `isMonthInFuture(failure)` lets the list return
to the current month (AC-09).

**Input validation**
- Name: trimmed, 1 to 50 characters. Amount: required, positive, parsed by `parseAmountInput`; empty,
  zero or non-numeric text is an input error. Categories: 1 to 50 ids. Thresholds: 1 to 5 distinct whole
  numbers from 1 to 200.

**Error handling**
- Every failure is a catalog path or key, never a thrown error. No `parseFloat`, `toFixed` or `Number(`
  appears in the module (NFR-04).

**Required tests**
- [ ] `toBudgetView` gives name, currency and the four figures as `bigint` and the percentage as received — validates AC-01.
- [ ] Markers sit at 80 and 100 for thresholds 80 and 100, and a threshold above 100 is clamped to the bar edge and keeps its label — validates AC-03.
- [ ] A negative remaining gives `overBudget`, the negative `bigint` and a full bar width — validates AC-04.
- [ ] A percentage of 1,000 is kept as received and the bar width is 100 — validates AC-05.
- [ ] A budget with rollover keeps the rollover amount and the available amount as the API returned them — validates AC-06.
- [ ] The unconverted shares count is kept and a count of 0 is falsy for the notice — validates AC-13 and AC-14.
- [ ] `previousMonth` crosses a year boundary and stops at 1971-01, and the current month has no next step — validates AC-07 and AC-08.
- [ ] `addThreshold` accepts 90, and rejects 0, 201, 1.5, text and a duplicate — validates AC-19.
- [ ] `canAddThreshold` is false at 5 thresholds, and removing the last one makes the request builder return an input error — validates AC-20.
- [ ] `buildCreateBudget` builds the body from valid state with the default thresholds when none changed — validates AC-15.
- [ ] An empty name, a name of 51 characters, an empty, zero or non-numeric amount, and no category are invalid input errors with no body — validates AC-16.
- [ ] `buildUpdateBudget` sends only changed fields, compares categories as a set, and returns no body when nothing changed — validates AC-21 and AC-23.
- [ ] `budgetFailureKey` maps the refused 51st budget, the invalid category kind, the future month and the network failure — validates AC-09, AC-27, AC-28 and AC-29.

**Completion criterion**
Unit tests pass and the module has no float arithmetic on money.

## Block 2 — Budgets list, month selector and progress bar

**Files**
- `apps/web/src/features/budgets/list/budgets-container.tsx` (new).
- `apps/web/src/features/budgets/list/budgets-list.tsx`, `budget-card.tsx`, `budget-progress.tsx`,
  `month-selector.tsx`, `unconverted-notice.tsx`, `budgets-empty-state.tsx` (new). `budget-progress.tsx`
  and `unconverted-notice.tsx` are exported for the detail screen to import.
- `apps/web/test/budgets-list.test.tsx` (new).

**Logic**
The container loads the spending list of the selected month in 1 request (FR-01, D4) and keeps
`{kind: loading | failed | ready}` plus the `{current, selected}` month state. Each card shows the name,
currency, spent, available, remaining and the percentage message through `formatMoney` with the budget's
currency, the rollover amount when rollover is on (FR-03), the unconverted shares notice when the count
is above 0 (FR-07), and a progress bar with a marker at each threshold; over budget shows the negative
remaining and a full bar (FR-02). A card links to the detail with the selected month in the query. The
month selector offers a previous action, the month label formatted for the locale and, only when an
earlier month is selected, a next action (FR-04). With no budgets the empty state shows the create
action (FR-05). A refused future month shows its message and loads the current month again (AC-09).
Presentational components are pure; the container owns the fetching.

**Input validation**
- The month in the query string, when present, must be `YYYY-MM` and not after the current month; any
  other value is ignored and the current month is loaded.

**Error handling**
- A failed load shows the shared error state with a retry and never the empty state (AC-02); an offline
  failure shows the offline message through `budgetFailureKey`.
- A future month refusal shows the refusal message and returns to the current month (AC-09).

**Required tests**
- [ ] The list shows name, currency, spent, available, remaining and percentage for each budget of the current month — validates AC-01.
- [ ] A failed load shows the error with a retry, no empty state, and the retry loads again — validates AC-02.
- [ ] A budget with thresholds 80 and 100 draws markers at 80 and 100 with their labels — validates AC-03.
- [ ] A negative remaining shows over budget, the negative amount and a full bar — validates AC-04.
- [ ] A percentage above 100 shows the API's percentage — validates AC-05.
- [ ] Rollover on shows the rollover amount and the available amount; rollover off shows neither — validates AC-06.
- [ ] Picking an earlier month loads and shows that month's budgets with 1 request — validates AC-07 and NFR-02.
- [ ] With the current month selected there is no next action — validates AC-08.
- [ ] A refused future month shows its message and returns to the current month — validates AC-09.
- [ ] No budgets shows the empty state with the create action — validates AC-10.
- [ ] The unconverted shares notice shows its count and is absent at 0 — validates AC-13 and AC-14.
- [ ] A query month that is malformed or in the future is ignored and the current month loads — invalid input.
- [ ] An offline failure shows the offline message — validates AC-29.
- [ ] Targets are at least 44 px, the selector actions are labeled and the bar has an accessible label — validates NFR-06.
- [ ] Spanish and English strings, amounts, percentages and months render for the list — validates AC-30.

**Completion criterion**
Component and container tests pass and the catalog parity test passes.

## Block 3 — Budget detail

**Files**
- `apps/web/src/features/budgets/detail/budget-detail-container.tsx` (new).
- `apps/web/src/features/budgets/detail/budget-detail-view.tsx`, `budget-categories.tsx`,
  `budget-not-found.tsx` (new).
- `apps/web/test/budget-detail.test.tsx` (new).

**Logic**
The container takes the budget id from its props and the month from the route query (default: the
current month). It loads the budget, its spending for the month and the expense categories in 3
requests (FR-06, D5). The view shows the same figures as the list by importing `budget-progress.tsx` and
`unconverted-notice.tsx` from Block 2, says which month it shows, lists the covered categories by name
(the selected ones; subcategory names under their parent) through `categoryLabel`, lists the thresholds,
and carries the edit link and `BudgetDeleteAction` (FR-06, FR-07). The container passes `onDeleted` to
`BudgetDeleteAction`, which navigates to the list. Block 5's component is replaced by a stub in this
block's tests (D11). A budget with no version in force in the month answers not found and shows the
not found state.

**Input validation**
- The budget id from the route must be a UUID and the month `YYYY-MM`; an invalid id shows the not found
  state and sends no request, an invalid month falls back to the current month.

**Error handling**
- A missing, foreign or not-yet-existing budget shows the not found state with a link to the list
  (AC-12).
- A failed load shows the shared error state with a retry; an offline failure shows the offline message
  through `budgetFailureKey`.

**Required tests**
- [ ] A budget shows its figures for the month, its covered categories by name and its thresholds — validates AC-11.
- [ ] A budget that does not exist, belongs to another user or has no version in the month shows the not found state — validates AC-12.
- [ ] A malformed budget id shows not found and sends no request — invalid input.
- [ ] A malformed month falls back to the current month — invalid input.
- [ ] The unconverted shares notice shows with its count and is absent at 0 — validates AC-13 and AC-14.
- [ ] The detail makes exactly 3 requests — validates NFR-02.
- [ ] A failed load shows the error state with a retry and the retry loads again — validates AC-02.
- [ ] An offline failure shows the offline message — validates AC-29.
- [ ] Targets are at least 44 px and every control is labeled — validates NFR-06.
- [ ] Spanish and English strings, amounts and months render — validates AC-30.

**Completion criterion**
Component and container tests pass and the catalog parity test passes.

## Block 4 — Create and edit forms

**Files**
- `apps/web/src/features/budgets/form/create-budget-container.tsx`,
  `edit-budget-container.tsx` (new).
- `apps/web/src/features/budgets/form/budget-form.tsx`, `budget-category-picker.tsx`,
  `budget-thresholds-editor.tsx`, `budget-read-only-fields.tsx` (new).
- `apps/web/test/budget-form.test.tsx` (new).

**Logic**
The create form has the name, the amount through `MoneyInput` and the money input helpers, the currency
(ARS or USD), the category picker, the rollover toggle and the thresholds editor starting at 80 and 100
(FR-08, FR-10). The picker lists the user's expense categories with their subcategories grouped under
the parent and offers no income category; the categories load in 1 request and a failed load shows an
error with a retry and disables the submit (FR-09, AC-17, AC-18, D6). The thresholds editor adds a whole
number from 1 to 200 that is not present, hides the add control at 5 and shows a field error when the
last one is removed and the form is submitted (D7). On success the user goes to the list, where the new
budget shows. The edit container loads the budget and the categories (2 requests) and shows name, amount,
categories, rollover and thresholds as editable; the currency is read only text and a note says the
change applies from the current month (FR-11, D8). The save sends only the changed fields and shows the
figures the API returned; with no change the save action is disabled. The submit is disabled while the
request is pending so a double tap sends once.

**Input validation**
- Built by Block 1: name 1 to 50 characters, amount required and positive, at least one category,
  thresholds 1 to 5 distinct whole numbers from 1 to 200. Field errors show before any request, focus the
  first invalid field and label every control.

**Error handling**
- A refusal (limit of 50 budgets, category kind invalid) shows its message and keeps every value entered
  (AC-27, AC-28); an offline failure shows the offline message and keeps the input (AC-29).
- A missing budget on edit shows the not found state; a failed category load shows its own error with a
  retry.

**Required tests**
- [ ] A valid create form creates the budget with the default thresholds when none changed and goes to the list — validates AC-15.
- [ ] An empty or 51-character name, an empty, zero or non-numeric amount and no category show a field error and send no request — validates AC-16.
- [ ] The picker offers expense categories with subcategories under their parent and no income category — validates AC-17.
- [ ] A failed category load shows an error with a retry and disables the submit — validates AC-18.
- [ ] The thresholds editor accepts a whole number from 1 to 200 that is new and rejects 0, 201, a decimal, text and a duplicate — validates AC-19.
- [ ] At 5 thresholds the add control is absent, and removing the last threshold shows a field error and sends no request — validates AC-20.
- [ ] Saving an edit sends only the changed fields and shows the figures the API returned — validates AC-21.
- [ ] The edit form shows the currency as read only and says the change applies from the current month — validates AC-22.
- [ ] An edit with no change disables the save action — validates AC-23.
- [ ] A refused 51st budget shows the message and keeps the values — validates AC-27.
- [ ] A refused category kind shows the message and keeps the values — validates AC-28.
- [ ] A network failure shows the offline message and keeps the input — validates AC-29.
- [ ] The create form makes 1 request, the edit form 2, saving exactly 1, and a double tap sends once — validates NFR-02.
- [ ] Every control has a label and a 44 px target — validates NFR-06.
- [ ] Spanish and English strings render for both forms — validates AC-30.

**Completion criterion**
Tests pass and a user can create a budget and edit it with the categories and thresholds editors.

## Block 5 — Delete with confirmation and routes

**Files**
- `apps/web/src/features/budgets/delete/budget-delete-action.tsx`,
  `budget-delete-confirmation.tsx` (new).
- `apps/web/src/app/[locale]/(app)/budgets/page.tsx` (modified: the placeholder becomes the list),
  `budgets/new/page.tsx`, `budgets/[id]/page.tsx`, `budgets/[id]/edit/page.tsx` (new) — thin server
  pages that render the containers and read the budget id from the route and the month from the query.
- `apps/web/test/budget-delete.test.tsx` (new).
- `apps/web/test/shell-navigation.test.tsx` (modified only if it asserts the placeholder).

**Logic**
`BudgetDeleteAction` follows the contract in Dependencies. It shows a delete button that opens an inline
confirmation saying that past spending is not affected; confirm calls `deleteBudget` once and then
`onDeleted`, cancel closes it and sends no request (FR-12, D9). The confirm action is disabled while the
request is pending. The pages use the existing page header pattern with the containers of Blocks 2 to 4;
the list page replaces the "coming soon" placeholder (FR-05 reachable from the shell).

**Input validation**
- The budget id in the route must be a valid identifier; a malformed id shows the not found state and
  sends no request.

**Error handling**
- A delete for a budget that is not found shows the not found message and leaves the confirmation open.
- A network failure on delete shows the offline message and keeps the confirmation open.

**Required tests**
- [ ] Confirming the deletion deletes once, calls `onDeleted` and the list no longer shows the budget — validates AC-24.
- [ ] Cancelling the confirmation keeps the budget and sends no request — validates AC-25.
- [ ] The confirmation says past spending is not affected — validates FR-12.
- [ ] A delete for a budget that is not found shows the not found message and leaves the confirmation open — invalid input.
- [ ] A double tap on confirm sends one delete request — invalid input.
- [ ] A network failure on delete shows the offline message and keeps the confirmation open — validates AC-29.
- [ ] The delete makes exactly 1 request — validates NFR-02.
- [ ] Controls have labels and 44 px targets — validates NFR-06.
- [ ] Spanish and English strings render — validates AC-30.
- [ ] The shell navigation test still passes with the placeholder replaced — validates AC-10.

**Completion criterion**
Tests pass, typecheck is clean with the four routes in place, and a user can delete a budget after a
confirmation.

## Block 6 — Budget alert label in the notices list

**Files**
- `apps/web/src/features/notices/components/notice-list.tsx` (modified) — the caption under the text.
- `apps/web/test/notices.test.tsx` (modified) — the new cases.

**Logic**
For a notice of kind `budget_alert` the caption shows the month of the alert through `notices.alertMonth`
(Block 0) with `formatPeriod(dueDate.slice(0, 7), locale)`; every other kind keeps the existing "Due
{date}" caption (FR-13, D10). The text is still a plain text node and the unread and read behaviors do
not change.

**Input validation**
- The alert's due date is a calendar date from the API; a value that is not `YYYY-MM-DD` falls back to the
  existing caption and never throws.

**Error handling**
- The list never throws on an unknown or malformed date; it falls back to the "Due {date}" caption.

**Required tests**
- [ ] A budget alert shows its text and the month of the alert, and no "Due" label, in Spanish and English — validates AC-26 and AC-30.
- [ ] A notice of another kind still shows "Due {date}" — validates AC-26.
- [ ] An unread and a read budget alert keep their interactive and read-only behavior — validates AC-26.
- [ ] A budget alert with a malformed due date falls back to the existing caption without an error — invalid input.

**Completion criterion**
The notices tests pass and the budget alert shows no "Due" label.

## Block 7 — Scans, end-to-end checks and final verification

**Files**
- `apps/web/e2e/budgets.spec.ts`, `apps/web/e2e/support/budgets.ts` (new).
- `apps/web/test/budgets-no-hardcoded-strings.test.ts` (new) — scans `features/budgets`, the budget pages
  and the notice list for string literals shown to the user, for `parseFloat`, `toFixed` and `Number(`,
  and for percentage or amount arithmetic.

**Logic**
One Playwright spec signs in, creates a budget with a category and the default thresholds, sees it in the
list, edits its name, amount and thresholds, opens its detail, creates a second budget with rollover,
and deletes one after confirming. A second test opens the list, the detail, the create form and the edit
form at 360 px and asserts no horizontal scroll (NFR-01). A third test creates the 51st budget refusal
path through the form and checks that the message shows and the values stay (AC-27). The scan covers every
touched file (NFR-04) and the coverage run checks the 80% thresholds (NFR-05). The support file holds the
helper that fills and saves the create form, mirroring `apps/web/e2e/support/goals.ts`.

**Input validation**
- The budget id in the route must be a valid identifier; a malformed id opens the not found state and
  sends no request, and a malformed month in the query is ignored.

**Error handling**
- A budget of another user opens the not found state in the browser; the spec resets attempt limits
  before each test, as the existing specs do.

**Required tests**
- [ ] Create, edit, detail and delete flow passes in the browser — validates AC-15, AC-21 and AC-24.
- [ ] The list, detail, create and edit screens fit 360 px without horizontal scroll — validates NFR-01.
- [ ] The Spanish and English catalogs have the same keys, none empty — validates NFR-03 and AC-30.
- [ ] No budget string is hardcoded and no `parseFloat`, `toFixed` or `Number(` is applied to money — validates NFR-04.
- [ ] The 51st budget is refused and the message shows with the form values kept in the browser — validates AC-27.
- [ ] A budget id of another user fails with 404 and opens the not found state — validates AC-12.
- [ ] A budget alert in the notices list shows the month and no "Due" label in the browser — validates AC-26.
- [ ] An earlier month shows its budgets and the next month action is absent on the current month — validates AC-07 and AC-08.

**Completion criterion**
The spec and the scans pass, and the full web suite and coverage thresholds pass.

## Final verification
- Every AC (AC-01 to AC-30) and NFR (NFR-01 to NFR-06) has a test; every input has a sad-path test.
- `pnpm typecheck`, eslint and Prettier on touched files pass; the full suite and coverage pass.
- The design-system scan and the accessibility tests pass for the new screens (labels, focus on the
  first invalid field, tokens only).
- No file under `apps/api` or `packages/shared` and no migration or dependency is added.
- Owner ratification items: online-only budget screens, the category picker capped at 100, and the
  detail making 3 requests (D5), which asks the owner to read NFR-02 as "the budget, its spending and
  the category names" or to accept an API change in a later ticket.

# Spec DISC-001-06e: Goals Screens

| Field | Value |
|-------|-------|
| Ticket | DISC-001-06e |
| PRD | docs/ddw/prd/prd-DISC-001-06e.md |
| Tier | FEATURE |
| Date | 2026-10-11 |
| Spec loops | 0 |
| Loops since last human decision | 0 |

## Summary
Web only, on the goals API of 06a: no route, migration or dependency is added. Block 0 adds the goal
methods to the api-client. Block 1 is a pure module with the view model of a goal (status, bar width,
amounts as `bigint`), the entries paging rule and the form-to-request builders. Block 2 adds every
Spanish and English catalog key under one `goals` namespace, so the catalogs are touched by one block
only. Blocks 3 to 6 are the screens, each a container (`useApiClient()` plus a
`{kind: loading | failed | ready}` state) over pure presentational components, following the groups
screens (05e, 05f): the list, the detail with the entries history, the create and edit forms, and the
entry forms with the delete confirmation. Block 7 replaces the placeholder page, adds the pages, the
scans and the end-to-end tests including 360 px. Money stays in minor units: the client only parses
typed input with the money input helpers and shows the API's figures; it never sums, divides or derives
a percentage.

## Decisions
- **D1 Routes.** `/goals` (list), `/goals/new`, `/goals/[id]` (detail, entries, entry forms, delete)
  and `/goals/[id]/edit`. The existing `goals/page.tsx` placeholder is replaced.
- **D2 Online only.** No screen is queued or cached offline (PRD decision); an offline load shows the
  shared error state with a retry, and an offline submit shows the offline message and keeps the input.
- **D3 Figures come from the API.** Progress, percentage, status and monthly amount are rendered as
  returned. The bar width is the API percentage clamped to 0..100 for display only (an overdrawn linked
  goal returns a negative progress and an empty bar, AC-02).
- **D4 Percentage text.** The percentage is an integer from the API and is shown through a catalog
  message with a number placeholder, so it is formatted per locale without any division.
- **D5 Request budget.** List: 1 request (the goals). Detail: goal and first entries page (2), or the
  goal only when it is linked (1). Create form: 0, plus 1 for the accounts when a link is chosen. Edit:
  1 (the goal). Recording an entry or deleting: exactly 1; the screen updates from the response (FR-10).
- **D6 Entries paging.** The detail asks for 50 entries. "Load more" re-asks with the next larger limit
  (50, then 100), replaces the shown entries with the response and hides the control when the response
  holds fewer entries than asked for or 100 are shown. The history says it shows the latest 100.
- **D7 No dialogs library.** The delete confirmation is an inline panel using the existing UI
  components, with cancel and confirm; no new dependency.
- **D8 Parallel ownership.** Each block owns only the files it lists. The detail container (Block 4)
  imports two components owned by Block 6 by fixed paths and props (see Dependencies); Block 4's tests
  replace them with stubs, and Block 7 tests the real composition.

## Coverage: PRD → blocks
| Requirement | Covered by |
|---|---|
| FR-01, FR-02, FR-03 | Block 3, on the view helpers of Block 1 |
| FR-04, FR-05 | Block 4, on the paging rule of Block 1 |
| FR-06, FR-07, FR-08 | Block 5, on the request builders of Block 1 |
| FR-09, FR-10, FR-11 | Block 6 (entry forms and delete), shown by Block 4 |
| FR-12 | Blocks 3 to 6 show failures through `errors.<messageKey>`; Block 0 returns the keys; Block 7 checks it in the browser |
| FR-13 | Block 2 (catalogs), with every block reading only catalog keys and locale formatters |
| NFR-01 | Block 7 (end-to-end at 360 px on every screen) |
| NFR-02 | Strategy: one container per screen stays inside its budget (D5), asserted by call-count tests in Blocks 3, 4, 5 and 6 |
| NFR-03 | Block 2 (parity test), run again in Block 7 |
| NFR-04 | Block 1 written to pass it; Block 7 scans every touched file |
| NFR-05 | Every block ships its own tests; Block 7 runs the coverage thresholds |
| NFR-06 | Blocks 3 to 6 (44 px targets and labeled controls asserted in their component tests) |

## Dependencies between blocks
Blocks 0, 1 and 2 touch disjoint files and run in parallel first. Blocks 3 to 6 need Blocks 0 (calls),
1 (view helpers and builders) and 2 (catalog keys); they are independent of each other and run in
parallel because they own disjoint folders. Block 7 is last and owns the pages, the scans and the
end-to-end tests.

Fixed contracts that let Blocks 4 and 6 run in parallel:
- `GoalEntryActions` (`features/goals/entries/goal-entry-actions.tsx`, Block 6): props
  `{goal: GoalResponse; onRecorded: (response: RecordGoalEntryResponse) => void}`. It renders the
  contribution and withdrawal forms, or the linked-goal notice when `goal.accountId` is not null.
- `GoalDeleteAction` (`features/goals/delete/goal-delete-action.tsx`, Block 6): props
  `{goalId: string; onDeleted: () => void}`.

| Block | Owns (parallel group) |
|---|---|
| 0 | `apps/web/src/lib/api-client.ts` and its test (group A) |
| 1 | `features/goals/helpers/*` (group A) |
| 2 | `apps/web/messages/es.json`, `en.json` (group A) |
| 3 | `features/goals/list/*` (group B) |
| 4 | `features/goals/detail/*` (group B) |
| 5 | `features/goals/form/*` (group B) |
| 6 | `features/goals/entries/*`, `features/goals/delete/*` (group B) |
| 7 | `app/[locale]/(app)/goals/**` pages, e2e, scans |

All `features/goals` paths are under `apps/web/src/`.

## Block 0 — api-client goal methods

**Files**
- `apps/web/src/lib/api-client.ts` (modified) — interface (next to the group methods) and
  implementation: `listGoals()`, `getGoal(id)`, `createGoal(body)`, `updateGoal(id, body)`,
  `deleteGoal(id)`, `recordGoalEntry(id, body)`, `listGoalEntries(id, {limit})`.
- `apps/web/test/api-client-goals.test.ts` (new) — the new calls.

**Logic**
Each method (FR-01, FR-04, FR-05, FR-06, FR-08, FR-09, FR-11) uses the existing send helpers, parses
the response with the shared goal response validators of `@pesly/shared` (`listGoalsResponseSchema`,
`goalResponseSchema`, `recordGoalEntryResponseSchema`, `listGoalEntriesResponseSchema`), returns the
existing `ApiResult` shape and maps error codes with the existing code-to-key map, which already holds
the five goal keys (FR-12). `deleteGoal` returns `ApiResult<undefined>`. A missing or foreign goal
comes back as the not found failure so the screens can tell it from other failures.

**Input validation**
- Bodies are checked against the shared goal request validators before sending; an invalid body returns
  a local failure and sends no request. `listGoalEntries` checks that `limit` is 1 to 100.

**Error handling**
- A response that does not match its validator is a generic failure, never partial data.
- 400, 404 and 409 answers keep their message key; a network failure keeps the offline failure kind.

**Required tests**
- [ ] `listGoals` returns the parsed goals — validates AC-01.
- [ ] `getGoal` returns the goal and a 404 comes back as the not found failure — validates AC-09.
- [ ] `listGoalEntries` sends the limit and returns the entries — validates AC-10.
- [ ] `createGoal` sends the body with the amount as a minor-units string — validates AC-12.
- [ ] `updateGoal` sends `targetDate: null` to remove the date — validates AC-18.
- [ ] `recordGoalEntry` returns the entry and the updated goal — validates AC-20.
- [ ] `deleteGoal` resolves with no body — validates AC-24.
- [ ] A refused withdrawal and a refused 100th goal surface their own keys — validates AC-26 and AC-27.
- [ ] A network failure is the offline failure — validates AC-28.
- [ ] A malformed response body is a failure, not data — invalid input.
- [ ] An invalid body (empty name, limit 101) is rejected before any request — invalid input.

**Completion criterion**
The api-client tests pass and typecheck is clean.

## Block 1 — Goal view helpers and request builders

**Files**
- `apps/web/src/features/goals/helpers/goal-view.ts` (new) — display data of a goal.
- `apps/web/src/features/goals/helpers/entries-paging.ts` (new) — next limit and load-more rule.
- `apps/web/src/features/goals/helpers/goal-request.ts` (new) — form state to request bodies and field
  errors.
- `apps/web/src/features/goals/helpers/goal-failure.ts` (new) — failure to catalog key or not found.
- `apps/web/test/goals-helpers.test.ts` (new).

**Logic**
`toGoalView(goal)` returns the goal's amounts as `bigint` parsed from the minor-units strings
(`BigInt(text)`), the integer percentage as received, the bar width (the percentage clamped to 0..100,
presentation only, D3) and a display state: `reached`, `overdue`, `active-with-monthly` or `active`
(FR-02). It never adds, divides or derives a figure. `nextEntriesLimit(asked)` gives 50 then 100;
`canLoadMore(returned, asked)` is false when `returned < asked` or `returned >= 100` (FR-05, D6).
`buildCreateGoal(state, locale)` and `buildUpdateGoal(state, original, locale)` parse the amount with
`parseAmountInput`, trim the name, and return the shared request body or a list of input errors as
catalog paths (FR-06, FR-08); the update body carries only changed values and `targetDate: null` when
the date was cleared. `buildEntry(kind, text, locale)` does the same for an entry amount (FR-09).
`goalFailureKey(failure)` maps an api-client failure to a catalog key, `not-found` or `offline`
(FR-12).

**Input validation**
- Name: trimmed, 1 to 80 characters. Amount: required, positive, parsed by `parseAmountInput`; empty,
  zero or non-numeric text is a input error. Target date: empty or a calendar date.

**Error handling**
- Every failure is a catalog path or key, never a thrown error. No `parseFloat`, `toFixed` or `Number(`
  is applied to money (NFR-04).

**Required tests**
- [ ] `toGoalView` gives reached, overdue, active with the monthly amount and active with none — validates AC-03, AC-04 and AC-05.
- [ ] A negative progress gives a 0 bar width and the negative amount — validates AC-02.
- [ ] The monthly amount is the API's string as a `bigint`, never recomputed — validates AC-03.
- [ ] `canLoadMore` is false when fewer entries than asked came back or 100 are shown, true otherwise — validates AC-10 and AC-11.
- [ ] `nextEntriesLimit` goes from 50 to 100 and stops at 100 — validates AC-10.
- [ ] `buildCreateGoal` builds the body from valid state — validates AC-12.
- [ ] An empty name, a name of 81 characters, an empty, zero or non-numeric amount are invalid input errors with no body — validates AC-13.
- [ ] `buildUpdateGoal` sends only changed values and a null date when cleared — validates AC-17 and AC-18.
- [ ] An empty name or a zero amount on edit is a input error — validates AC-19.
- [ ] `buildEntry` rejects an empty, zero or non-numeric amount — validates AC-21.
- [ ] `goalFailureKey` maps the refused withdrawal, the goal limit, the unsupported size and the network failure — validates AC-26, AC-27 and AC-28.

**Completion criterion**
Unit tests pass and the module has no float arithmetic on money.

## Block 2 — i18n catalogs

**Files**
- `apps/web/messages/es.json`, `apps/web/messages/en.json` (modified) — the new `goals` namespace; no
  other key is changed.

**Logic**
One block adds every key the goal screens read (FR-13), in both languages together, with the same
structure: `goals.list` (title, description, create action, empty state, retry, error), `goals.card`
(progress of target, percentage message with a number placeholder, monthly amount needed, reached,
overdue, target date, linked to account label), `goals.detail` (title, back link, entries title, entry
kinds contribution and withdrawal, entries note that only the latest 100 are shown, no entries yet,
load more, edit and delete actions, linked-goal notice that progress follows the account balance, not
found with link back), `goals.form` (create and edit titles, name, target amount, currency, target date
with clear action, link to an account with its none option and its no accounts message, field errors,
submit and cancel, saving state), `goals.entries` (contribution and withdrawal forms, amount label,
submit labels, recorded confirmation) and `goals.delete` (confirmation title, text saying that its
entries are removed and no account balance changes, confirm and cancel). Messages with plurals or
numbers use ICU placeholders; no amount or date is baked into a string.

**Input validation**
- Both files stay valid JSON and the key sets stay identical.

**Error handling**
- The goal refusal messages already exist under `errors.*` and are reused, not duplicated.

**Required tests**
- [ ] The Spanish and English catalogs have the same keys, none empty — validates NFR-03.
- [ ] Every `goals.*` key listed in the spec exists in both languages — validates AC-29.
- [ ] A catalog missing a key or holding an empty value fails the parity test — invalid input.

**Completion criterion**
The existing catalog parity test passes and both files are well-formed.

## Block 3 — Goals list screen

**Files**
- `apps/web/src/features/goals/list/goals-container.tsx` (new).
- `apps/web/src/features/goals/list/goals-list.tsx`, `goal-card.tsx`, `goal-progress.tsx`,
  `goals-empty-state.tsx` (new). `goal-progress.tsx` is the bar, amounts and state badge, exported for
  the detail screen to import.
- `apps/web/test/goals-list.test.tsx` (new).

**Logic**
The container loads the goals in 1 request (FR-01) and keeps `{kind: loading | failed | ready}`. Each
card shows the name, progress and target through `formatMoney` with the goal's currency, the percentage
message, a progress bar and the state from `toGoalView`: the monthly amount needed for an active goal
with a target date, "reached", or "overdue" instead of a monthly amount (FR-02). A card links to the
detail. The page header carries the create goal action. With no goals the empty state shows the create
action (FR-03). Presentational components are pure; the container owns the fetching.

**Input validation**
- None: the screen takes no input.

**Error handling**
- A failed load shows the shared error state with a retry and never the empty state (AC-07); an offline
  failure shows the offline message through `goalFailureKey`.

**Required tests**
- [ ] The list shows name, progress, target, currency, percentage and a bar for each goal — validates AC-01.
- [ ] An overdrawn linked goal shows the negative progress, 0% and an empty bar — validates AC-02.
- [ ] A goal with a target date shows the monthly amount as returned — validates AC-03.
- [ ] A reached goal shows reached and no monthly amount — validates AC-04.
- [ ] An overdue goal shows overdue instead of a monthly amount — validates AC-05.
- [ ] No goals shows the empty state with the create action — validates AC-06.
- [ ] A failed load shows the error with a retry, no empty state, and the retry loads again — validates AC-07.
- [ ] The page makes exactly 1 request — validates NFR-02.
- [ ] Targets are at least 44 px and the bar has an accessible label — validates NFR-06.
- [ ] Spanish and English strings, amounts and percentages render for the list — validates AC-29.

**Completion criterion**
Component and container tests pass and the catalog parity test passes.

## Block 4 — Goal detail and entries history

**Files**
- `apps/web/src/features/goals/detail/goal-detail-container.tsx` (new).
- `apps/web/src/features/goals/detail/goal-detail-view.tsx`, `goal-entries-list.tsx`,
  `goal-not-found.tsx` (new).
- `apps/web/test/goal-detail.test.tsx` (new).

**Logic**
The container takes the goal id from its props, loads the goal and, when `accountId` is null, the first
50 entries (2 requests; 1 for a linked goal) (FR-04, D5). The view shows the same figures as the list by
importing `goal-progress.tsx` from Block 3, then the entries newest first with kind, amount through
`formatMoney` and date through `formatDateTime` in the user's time zone, a note that only the latest 100
are shown, and the edit and delete actions. For a linked goal it shows no history and renders
`GoalEntryActions`, which shows the notice. "Load more" re-asks with `nextEntriesLimit` and replaces the
list, hidden by `canLoadMore` (FR-05, D6). The container passes `onRecorded` to `GoalEntryActions`: it
puts the returned entry at the top and replaces the goal with the returned goal, with no request
(FR-10), and passes `onDeleted` to `GoalDeleteAction`, which navigates to the list. Blocks 6 components
are replaced by stubs in this block's tests (D8).

**Input validation**
- The goal id from the route must be a UUID; anything else shows the not found state and sends no
  request.

**Error handling**
- A missing or foreign goal shows the not found state with a link to the list (AC-09).
- A failed load shows the shared error state with a retry; a failed "load more" keeps the shown entries
  and offers a retry. An offline failure shows the offline message.

**Required tests**
- [ ] A goal not linked to an account shows its figures and entries newest first with kind, amount and date — validates AC-08.
- [ ] A goal that does not exist shows the not found state — validates AC-09.
- [ ] A malformed goal id shows not found and sends no request — invalid input.
- [ ] "Load more" asks for the next larger limit and shows the extra entries without reloading — validates AC-10.
- [ ] The control disappears when fewer entries than asked came back, or 100 are shown — validates AC-11.
- [ ] A recorded entry appears at the top and the progress follows the response with no extra request — validates AC-20 and AC-23.
- [ ] A linked goal shows no history and makes only 1 request; an unlinked goal makes 2 — validates NFR-02.
- [ ] A failed load shows the error state with a retry — validates AC-07.
- [ ] A "load more" that fails keeps the shown entries and shows an error with a retry — invalid input.
- [ ] An offline failure shows the offline message and keeps the shown data — validates AC-28.
- [ ] Spanish and English strings, amounts and dates render — validates AC-29.

**Completion criterion**
Component and container tests pass and the catalog parity test passes.

## Block 5 — Create and edit forms

**Files**
- `apps/web/src/features/goals/form/create-goal-container.tsx`,
  `edit-goal-container.tsx` (new).
- `apps/web/src/features/goals/form/goal-form.tsx`, `goal-account-select.tsx`,
  `goal-read-only-fields.tsx` (new).
- `apps/web/test/goal-form.test.tsx` (new).

**Logic**
The create form has the name, the target amount through `MoneyInput` and the money input helpers, the
currency, an optional target date and an optional link to an account (FR-06). The accounts are loaded
with `listAccounts` only when the user turns the link on, with active accounts only, and the select
offers those in the chosen currency (FR-07, D5). Changing the currency clears the chosen account. On
success the user goes to the list, where the new goal shows. The edit container loads the goal (1
request) and shows name, target amount and target date as editable, with a clear-date action that sends
a null date; currency and link are shown as read only text, and no link control is offered (FR-07,
FR-08). The save shows the figures the API returned. The submit is disabled while the request is
pending so a double tap sends once.

**Input validation**
- Built by Block 1: name 1 to 80 characters, amount required and positive, date empty or valid. Field
  errors show before any request, focus the first invalid field and label every control.

**Error handling**
- A refusal (limit of 100 goals, currency mismatch, unsupported size) shows its message and keeps every
  value entered (AC-27); an offline failure shows the offline message and keeps the input (AC-28).
- A missing goal on edit shows the not found state.

**Required tests**
- [ ] A valid create form creates the goal and goes to the list — validates AC-12.
- [ ] An empty or 81-character name, and an empty, zero or non-numeric amount, show a field error and send no request — validates AC-13.
- [ ] Choosing a currency and the link offers only active accounts in that currency — validates AC-14.
- [ ] Changing the currency clears the chosen account — validates AC-15.
- [ ] The edit form shows the account and currency as read only and offers no link — validates AC-16.
- [ ] Saving an edit shows the figures the API returned — validates AC-17.
- [ ] Clearing the target date and saving sends a null date and shows no monthly amount — validates AC-18.
- [ ] An edit with an empty name or a zero amount shows a field error and sends no request — validates AC-19.
- [ ] A refused 100th goal shows the message and keeps the values — validates AC-27.
- [ ] A network failure shows the offline message and keeps the input — validates AC-28.
- [ ] The create form makes 0 requests, and 1 only when the link is chosen; a double tap sends once — validates NFR-02.
- [ ] Every control has a label and a 44 px target — validates NFR-06.
- [ ] Spanish and English strings render for both forms — validates AC-29.

**Completion criterion**
Tests pass and a user can create a goal, with and without a link, and edit it.

## Block 6 — Contribute, withdraw and delete

**Files**
- `apps/web/src/features/goals/entries/goal-entry-actions.tsx`, `goal-entry-form.tsx`,
  `linked-goal-notice.tsx` (new).
- `apps/web/src/features/goals/delete/goal-delete-action.tsx`,
  `goal-delete-confirmation.tsx` (new).
- `apps/web/test/goal-entries.test.tsx`, `apps/web/test/goal-delete.test.tsx` (new).

**Logic**
`GoalEntryActions` follows the contract in Dependencies. For a goal not linked to an account it renders
a contribution form and a withdrawal form, each with an amount through `MoneyInput`; the submit calls
`recordGoalEntry` once and hands the response to `onRecorded`, then clears the amount (FR-09, FR-10).
For a linked goal it renders only the notice that its progress follows the account balance. The submit
is disabled while pending. `GoalDeleteAction` shows a delete button that opens an inline confirmation
saying that the goal's entries are removed and that no account balance changes; confirm calls
`deleteGoal` once and then `onDeleted`; cancel closes it and sends no request (FR-11, D7).

**Input validation**
- The amount is built by Block 1 (`buildEntry`): required, positive; a field error shows before any
  request.

**Error handling**
- A refused withdrawal larger than the progress or an unsupported size shows the message and keeps the
  amount entered (AC-26); an offline failure shows the offline message and keeps the amount (AC-28).
- A goal that no longer exists on delete shows the not found message and leaves the confirmation open.

**Required tests**
- [ ] A contribution of 200.00 on an unlinked goal calls once and hands the entry and goal to `onRecorded` — validates AC-20.
- [ ] An empty, zero or non-numeric amount shows a field error and sends no request — validates AC-21.
- [ ] A linked goal shows no forms and the notice that progress follows the account balance — validates AC-22.
- [ ] Recording an entry makes exactly 1 request — validates AC-23 and NFR-02.
- [ ] Confirming the deletion deletes once and calls `onDeleted` — validates AC-24.
- [ ] Cancelling the confirmation keeps the goal and sends no request — validates AC-25.
- [ ] The confirmation says the entries are removed and no account balance changes — validates FR-11.
- [ ] A refused withdrawal shows the message and keeps the amount entered — validates AC-26.
- [ ] A network failure on record or delete shows the offline message and keeps the input — validates AC-28.
- [ ] A delete for a goal that is not found shows the message; a double tap sends once — invalid input.
- [ ] Controls have labels and 44 px targets — validates NFR-06.
- [ ] Spanish and English strings render — validates AC-29.

**Completion criterion**
Tests pass and a user can contribute, withdraw and delete with a confirmation.

## Block 7 — Pages, scans and end-to-end checks

**Files**
- `apps/web/src/app/[locale]/(app)/goals/page.tsx` (modified: the placeholder becomes the list),
  `goals/new/page.tsx`, `goals/[id]/page.tsx`, `goals/[id]/edit/page.tsx` (new) — thin server pages
  that render the containers and read the goal id from the route.
- `apps/web/e2e/goals.spec.ts`, `apps/web/e2e/support/goals.ts` (new).
- `apps/web/test/goals-no-hardcoded-strings.test.ts` (new) — scans `features/goals` for literals and
  for `parseFloat`, `toFixed` and `Number(` applied to money, and for percentage or amount arithmetic.
- `apps/web/test/shell-navigation.test.tsx` (modified only if it asserts the placeholder).

**Logic**
Pages render the existing page header pattern with the containers. One Playwright spec signs in, creates
an unlinked goal, records a contribution and a withdrawal, reads the history, edits the goal, creates a
linked goal and sees that it has no entry forms, and deletes a goal after confirming. A second test
opens the list, the detail, the create form and the edit form at 360 px and asserts no horizontal
scroll (NFR-01). The scan covers every touched file (NFR-04) and the coverage run checks the 80%
thresholds (NFR-05).

**Input validation**
- The goal id in the route must be a valid identifier; a malformed id shows the not found state and
  sends no request.

**Error handling**
- A goal of another user opens the not found state in the browser; the spec resets attempt limits
  before each test, as the existing specs do.

**Required tests**
- [ ] Create, contribute, withdraw, edit and delete flow passes in the browser — validates AC-12, AC-17, AC-20 and AC-24.
- [ ] The list, detail, create and edit screens fit 360 px without horizontal scroll — validates NFR-01.
- [ ] The Spanish and English catalogs have the same keys, none empty — validates NFR-03 and AC-29.
- [ ] No goal string is hardcoded and no `parseFloat`, `toFixed` or `Number(` is applied to money — validates NFR-04.
- [ ] A withdrawal larger than the progress is refused and the message shows in the browser — validates AC-26.
- [ ] A goal id of another user fails with 404 and opens the not found state — validates AC-09.
- [ ] The shell navigation test still passes with the goals page replaced — validates AC-06.

**Completion criterion**
The spec and the scans pass, and the full web suite and coverage thresholds pass.

## Final verification
- Every AC (AC-01 to AC-29) and NFR (NFR-01 to NFR-06) has a test; every input has a sad-path test.
- `pnpm typecheck`, eslint and Prettier on touched files pass; the full suite and coverage pass.
- The design-system scan and the accessibility tests pass for the new screens (labels, focus on the
  first invalid field, tokens only).
- Owner ratification items: online-only goal screens, and the history capped at the latest 100 entries.

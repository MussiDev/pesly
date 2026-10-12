# PRD DISC-001-06f: Budgets Screens

| Field | Value |
|-------|-------|
| Ticket | DISC-001-06f |
| Tracker | none |
| Date | 2026-10-11 |
| PRD loops | 0 |
| Loops since last human decision | 0 |

## Context and Problem
Last of six sub-tickets of Savings Goals & Budgets (parent index: `prd-DISC-001-06.md`; the budgets API
is 06b to 06d, the goals screens are 06e). The budgets API is merged: budgets with categories,
currency, rollover and thresholds (06b), spending per month with rollover (06c) and in-app alerts
through the notices module (06d). The `/budgets` route still shows the "coming soon" placeholder and
the web api-client has no budget methods, so a user cannot create a budget, see how much of it is
spent or edit it. This ticket replaces the placeholder with the budget list for a chosen month, a
budget detail, create and edit forms and a delete with confirmation, all on the existing API. It adds
no endpoint, migration or dependency. The budgets API has no offline path (the sync queue covers
movements and group records only), so these screens are online only.

Budget alerts already arrive as notices of kind `budget_alert` and the existing notices list renders
them as plain text. The only gap found is that the list labels every notice "Due {date}", which does
not fit an alert (see FR-13).

## Goals
- A user can see every budget of a month with what is spent, what is available, what remains and how
  close it is to its alert thresholds.
- A user can create, edit and delete a budget and read its detail.
- A user reads a budget alert in the notices list without a misleading "due" label.

## Functional Requirements
- FR-01: The system must show on the budgets page the user's budgets for the selected month, each with
  name, currency, spent, available, remaining and percentage used, all as the API returned them.
- FR-02: The system must show on each budget a progress bar for the percentage used with a marker at
  each alert threshold, and must show a budget as over budget when its remaining amount is negative.
- FR-03: The system must show on each budget its rollover amount when the budget has rollover on.
- FR-04: The system must provide a month selector on the budgets page that defaults to the current
  month and offers the current month and earlier months only, never a future month.
- FR-05: The system must show an empty state with a "create budget" action when the user has no
  budgets for the selected month.
- FR-06: The system must provide a budget detail page with the same figures as the list for the
  selected month, plus the covered categories and the thresholds.
- FR-07: The system must show a notice on a budget, in the list and in the detail, when its
  `unconvertedShareCount` is greater than 0, saying that some group shares in the other currency are
  not counted.
- FR-08: The system must provide a create form with name, amount, currency, categories, rollover
  toggle and thresholds.
- FR-09: The system must offer for the categories only the user's expense categories (the first 100
  returned by the API), and must send the selected category ids only.
- FR-10: The system must provide a thresholds editor with 1 to 5 distinct whole numbers from 1 to 200,
  starting at 80 and 100.
- FR-11: The system must provide an edit form for name, amount, categories, rollover and thresholds,
  must show the currency as read only, and must say that the change applies from the current month.
- FR-12: The system must delete a budget only after the user confirms, say that past spending is not
  affected, and return to the list.
- FR-13: The system must show a budget alert in the notices list without the "Due {date}" label, with
  the month of the alert instead.
- FR-14: The system must show the API's refusals with the existing error catalog (limit of 50 budgets,
  category kind invalid, month in the future, budget not found) and keep what the user entered.
- FR-15: The system must show every string in Spanish and English from the i18n catalogs, with amounts,
  percentages and dates formatted for the active locale.

## Non-Functional Requirements
- NFR-01: Each budget screen must render without horizontal scrolling at a 360 px wide viewport,
  verified by an end-to-end test at that width.
- NFR-02: The budgets page must load with at most 1 API request per selected month, the detail page
  with at most 3 (the budget, its spending for the month and the category list for the covered category names), the create form with at most 1 (the
  category list), and saving a budget must use exactly 1 request, verified by a test that counts the
  calls.
- NFR-03: The Spanish and English catalogs must have 0 missing or empty keys, verified by the existing
  catalog parity test, and 0 hardcoded user-facing strings are allowed in the touched files, verified
  by a scan test.
- NFR-04: 0 occurrences of `parseFloat`, `toFixed` or `Number(` applied to money are allowed in the
  touched files, and 0 percentages or amounts are computed in the client beyond the API's figures,
  verified by a scan in the test suite.
- NFR-05: The touched web files must reach at least 80% line, branch and function coverage with
  Vitest, and each acceptance criterion must have at least one test.
- NFR-06: The screens must reach at least 44 px touch targets and 0 unlabeled form controls, verified
  by component tests.

## Acceptance Criteria
*(EARS)*
- AC-01 (FR-01): WHEN a user opens the budgets page with budgets, THE system SHALL list each with name,
  currency, spent, available, remaining and percentage used for the current month.
- AC-02 (FR-01): IF the budgets request fails, THEN THE system SHALL show an error with a retry action
  and no empty state.
- AC-03 (FR-02): WHEN a budget has thresholds of 80 and 100, THE system SHALL draw a marker at 80% and
  at 100% on its progress bar.
- AC-04 (FR-02): WHILE a budget's remaining amount is negative, THE system SHALL show it as over
  budget, with the negative remaining amount and a full bar.
- AC-05 (FR-02): WHEN the percentage used is above 100, THE system SHALL show the percentage the API
  returned, up to 1,000.
- AC-06 (FR-03): WHERE a budget has rollover on, THE system SHALL show the rollover amount the API
  returned and the available amount that includes it.
- AC-07 (FR-04): WHEN a user picks an earlier month, THE system SHALL load and show the budgets of that
  month.
- AC-08 (FR-04): WHILE the current month is selected, THE system SHALL not offer a next month action.
- AC-09 (FR-04): IF the API refuses a month in the future, THEN THE system SHALL show that message and
  return to the current month.
- AC-10 (FR-05): WHILE the user has no budgets for the selected month, THE system SHALL show the empty
  state with the create budget action.
- AC-11 (FR-06): WHEN a user opens a budget, THE system SHALL show its figures for the selected month,
  its covered categories by name and its thresholds.
- AC-12 (FR-06): IF the budget does not exist, belongs to another user or had no version in force in
  the selected month, THEN THE system SHALL show the not found state.
- AC-13 (FR-07): WHEN a budget's `unconvertedShareCount` is greater than 0, THE system SHALL show the
  notice with that count in the list and in the detail.
- AC-14 (FR-07): WHILE a budget's `unconvertedShareCount` is 0, THE system SHALL not show the notice.
- AC-15 (FR-08): WHEN a user submits a valid create form, THE system SHALL create the budget with the
  default thresholds of 80 and 100 when the user changed none, and show it in the list.
- AC-16 (FR-08): IF the name is empty or longer than 50 characters, or the amount is empty, zero or not
  a number, or no category is chosen, THEN THE system SHALL show a field error and not send the
  request.
- AC-17 (FR-09): WHEN the create form opens, THE system SHALL offer the user's expense categories with
  their subcategories grouped under the parent, and no income category.
- AC-18 (FR-09): IF the category list request fails, THEN THE system SHALL show an error with a retry
  action and disable the submit.
- AC-19 (FR-10): WHEN a user adds a threshold, THE system SHALL accept it only when it is a whole
  number from 1 to 200 that is not already in the list.
- AC-20 (FR-10): IF the user has 5 thresholds, THEN THE system SHALL not offer to add another, and IF
  the user removes the last one, THEN THE system SHALL show a field error and not send the request.
- AC-21 (FR-11): WHEN a user saves an edited budget, THE system SHALL send only the changed fields and
  show the figures the API returned.
- AC-22 (FR-11): WHILE a budget is edited, THE system SHALL show its currency as read only and SHALL
  say the change applies from the current month.
- AC-23 (FR-11): IF the edit form has no change, THEN THE system SHALL disable the save action.
- AC-24 (FR-12): WHEN a user confirms the deletion, THE system SHALL delete the budget, return to the
  list and not show it.
- AC-25 (FR-12): IF the user cancels the confirmation, THEN THE system SHALL keep the budget and send
  no request.
- AC-26 (FR-13): WHEN the notices list contains a notice of kind `budget_alert`, THE system SHALL show
  its text and the month of the alert, and no "Due" label.
- AC-27 (FR-14): IF the API refuses a budget because the user holds 50 budgets, THEN THE system SHALL
  show that message and keep the form values.
- AC-28 (FR-14): IF the API refuses a category that is not an expense category, THEN THE system SHALL
  show that message and keep the form values.
- AC-29 (FR-14): IF a request fails with no connection, THEN THE system SHALL show the offline message
  and keep everything the user entered.
- AC-30 (FR-15): WHERE the interface language is Spanish or English, THE system SHALL show every
  budget string, amount, percentage and date in that language.

## Out of Scope
- Offline creation or editing of budgets: the budgets API has no offline path.
- Any API change, including a cursor or search for categories: only the first 100 expense categories
  are offered (see Decision Log).
- Editing past months or reading how a budget changed over time: edits apply from the current month
  and the screens show one month at a time.
- Changing a budget's currency after creation (06b).
- Group or shared budgets, and budgets over income categories.
- Push or email notifications for alerts; the in-app notices list is the only channel.
- Charts beyond the progress bar and threshold markers.
- Changing when alerts fire or their text (06d), and opening a budget from an alert: the notice carries
  no budget id.

## Risks and Mitigations
- **Client and server disagree on money** -> the client only parses input with the money input helpers
  and sends minor-unit strings; it never computes spent, remaining or percentages (NFR-04).
- **More than 100 expense categories cannot all be offered** -> the form offers the first 100 and the
  Decision Log records the limit; a search is a later ticket.
- **A threshold marker above 100 falls outside the bar** -> markers are clamped to the bar's width and
  labeled with their value (AC-03).
- **A user reads an old month and thinks the budget changed** -> the detail says which month it shows,
  and the edit form says the change applies from the current month (AC-22).
- **A budget created this month is missing in earlier months** -> the API returns only budgets with a
  version in force, so the earlier month shows no such budget and the detail answers not found (AC-12).
- **A small screen hides the progress bar or form actions** -> mobile first layout, checked at 360 px
  (NFR-01).
- **A double tap saves twice** -> the submit is disabled while the request is pending.

## Dependencies
- DISC-001-06b (budgets API), DISC-001-06c (spending) and DISC-001-06d (alerts through notices) — all
  merged; request and response schemas from `@pesly/shared`.
- The api-client (04e) gains budget methods and already maps `BUDGET_LIMIT_REACHED`,
  `BUDGET_CATEGORY_KIND_INVALID` and `BUDGET_MONTH_IN_FUTURE` to catalog keys.
- PRD 03 (categories) — `listCategories` for the expense categories.
- The notices screen (08c) in `apps/web/src/features/notices`.
- FEAT-004 (design system), the money input helpers (`formatMoneyInput`, `parseAmountInput`) and the
  goals screens (06e) as the pattern for containers, helpers and tests.

## Decision Log
- 2026-10-11: Budgets screens are online only because the budgets API has no offline path. Proposed by
  the model, awaiting the owner's acceptance.
- 2026-10-11: The month selector offers the current month and earlier months only, because the API
  refuses a future month. Proposed by the model, awaiting the owner's acceptance.
- 2026-10-11: The category picker offers the first 100 expense categories (the API's maximum page);
  searching or paging categories needs a later ticket. Proposed by the model, awaiting the owner's
  acceptance.
- 2026-10-11: Edits are effective from the current month, as the API does, and the form says so;
  history of earlier versions is not shown. Proposed by the model, awaiting the owner's acceptance.
- 2026-10-11: The notices list is changed minimally: a `budget_alert` shows the month of the alert
  instead of "Due {date}", because the notice has no budget id to link to. Proposed by the model,
  awaiting the owner's acceptance.

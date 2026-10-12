# PRD DISC-001-06e: Goals Screens

| Field | Value |
|-------|-------|
| Ticket | DISC-001-06e |
| Tracker | none |
| Date | 2026-10-11 |
| PRD loops | 0 |
| Loops since last human decision | 0 |

## Context and Problem
Fifth of six sub-tickets of Savings Goals & Budgets (parent index: `prd-DISC-001-06.md`; the goals API
is 06a, budgets are 06b to 06d and 06f). The goals API is merged, but the `/goals` route still shows
the "coming soon" placeholder, and the web api-client has no goal methods, so a user cannot create a
goal, see how far along it is or record money set aside. This ticket replaces the placeholder with the
goal list, a goal detail with its entries history, create and edit forms, contribution and withdrawal
forms and a delete with confirmation, all on the existing API. It adds no endpoint, migration or
dependency. The goals API has no offline path (the sync queue covers movements and group records
only), so these screens are online only.

## Goals
- A user can see all their goals with progress, percentage, monthly amount needed and their reached
  or overdue state.
- A user can create, edit and delete a goal, and read its entries history.
- A user can record contributions to and withdrawals from a goal that is not linked to an account.

## Functional Requirements
- FR-01: The system must show the user's goals on the goals page, each with name, progress and target
  with their currency, percentage, and a progress bar.
- FR-02: The system must show on each goal its state: active with the monthly amount needed when it has
  a target date, reached, or overdue.
- FR-03: The system must show an empty state with a "create goal" action when the user has no goals.
- FR-04: The system must provide a goal detail page with the same figures as the list and, for a goal
  not linked to an account, its entries history newest first with kind, amount and date.
- FR-05: The system must load older entries on request: the API accepts only a `limit` (default 50,
  maximum 100), so each request asks for the next larger page up to 100, and the control disappears
  when the API returns fewer entries than asked for or the 100 entries are shown.
- FR-06: The system must provide a create form with name, target amount, currency, optional target
  date and an optional linked account.
- FR-07: The system must offer for the link only the user's active accounts in the chosen currency,
  and must not offer the link when editing.
- FR-08: The system must provide an edit form for name, target amount and target date, where clearing
  the date removes it.
- FR-09: The system must provide contribution and withdrawal forms with an amount for a goal not
  linked to an account, and must not offer them on a linked goal, which shows that its progress follows
  the account balance.
- FR-10: The system must update the goal's progress and entries from the response after recording an
  entry, with no extra request.
- FR-11: The system must delete a goal only after the user confirms, say that its entries are removed
  and that no account balance changes, and return to the list.
- FR-12: The system must show the API's refusals with the existing error catalog (limit of 100 goals,
  currency mismatch, withdrawal larger than the progress, unsupported size, goal not found) and keep
  what the user entered.
- FR-13: The system must show every string in Spanish and English from the i18n catalogs, with amounts,
  percentages and dates formatted for the active locale.

## Non-Functional Requirements
- NFR-01: Each goals screen must render without horizontal scrolling at a 360 px wide viewport,
  verified by an end-to-end test at that width.
- NFR-02: The goals page must load with at most 1 API request, the detail page with at most 2 (1 for
  a linked goal), the create form with at most 1 (the account list, only when a link is chosen), and
  recording an entry must use exactly 1, verified by a test that counts the calls.
- NFR-03: The Spanish and English catalogs must have 0 missing or empty keys, verified by the existing
  catalog parity test.
- NFR-04: 0 occurrences of `parseFloat`, `toFixed` or `Number(` applied to money are allowed in the
  touched files, and 0 percentages or amounts are computed in the client beyond the API's figures,
  verified by a scan in the test suite.
- NFR-05: The touched web files must reach at least 80% line, branch and function coverage with
  Vitest, and each acceptance criterion must have at least one test.
- NFR-06: The screens must reach at least 44 px touch targets and 0 unlabeled form controls, verified
  by component tests.

## Acceptance Criteria
*(EARS)*
- AC-01 (FR-01): WHEN a user opens the goals page with goals, THE system SHALL list each with name,
  progress, target, currency, percentage and progress bar.
- AC-02 (FR-01): WHEN a linked goal's account is overdrawn, THE system SHALL show the negative
  progress and 0% with an empty bar.
- AC-03 (FR-02): WHEN a goal has a target date and is not reached, THE system SHALL show its monthly
  amount needed as the API returned it.
- AC-04 (FR-02): WHEN a goal is reached, THE system SHALL show it as reached with no monthly amount.
- AC-05 (FR-02): IF a goal is overdue, THEN THE system SHALL show it as overdue instead of a monthly
  amount.
- AC-06 (FR-03): WHILE the user has no goals, THE system SHALL show the empty state with the create
  goal action.
- AC-07 (FR-03): IF the goals request fails, THEN THE system SHALL show an error with a retry action
  and no empty state.
- AC-08 (FR-04): WHEN a user opens a goal not linked to an account, THE system SHALL show its figures
  and its entries, newest first, with kind, amount and date.
- AC-09 (FR-04): IF the goal does not exist or belongs to another user, THEN THE system SHALL show the
  not found state.
- AC-10 (FR-05): WHEN the user asks for more entries and the last page was full, THE system SHALL
  request the next larger limit and show the additional entries without reloading the page.
- AC-11 (FR-05): WHEN the API returns fewer entries than the limit asked for, or 100 are shown, THE
  system SHALL hide the load more control.
- AC-12 (FR-06): WHEN a user submits a valid create form, THE system SHALL create the goal and show it
  in the list.
- AC-13 (FR-06): IF the name is empty or longer than 80 characters, or the target amount is empty, zero
  or not a number, THEN THE system SHALL show a field error and not send the request.
- AC-14 (FR-07): WHEN the user chooses a currency and the link option, THE system SHALL offer only
  their active accounts in that currency.
- AC-15 (FR-07): WHEN the user changes the currency after choosing an account, THE system SHALL clear
  the chosen account.
- AC-16 (FR-07): WHILE a goal is edited, THE system SHALL not show the account or currency as
  editable.
- AC-17 (FR-08): WHEN a user saves a new name, target amount or target date, THE system SHALL show the
  figures the API returned.
- AC-18 (FR-08): WHEN the user clears the target date and saves, THE system SHALL remove it and show no
  monthly amount.
- AC-19 (FR-08): IF the edit form has an empty name or a target amount of zero, THEN THE system SHALL
  show a field error and not send the request.
- AC-20 (FR-09): WHEN a user records a contribution of 200.00 on a goal not linked to an account, THE
  system SHALL add the entry at the top of the history and show the progress from the response.
- AC-21 (FR-09): IF the amount is empty, zero or not a number, THEN THE system SHALL show a field
  error and not send the request.
- AC-22 (FR-09): WHILE a goal is linked to an account, THE system SHALL not show the contribution and
  withdrawal forms and SHALL say its progress follows the account balance.
- AC-23 (FR-10): WHEN an entry is recorded, THE system SHALL make no request other than the one that
  records it.
- AC-24 (FR-11): WHEN a user confirms the deletion, THE system SHALL delete the goal, return to the
  list and not show it.
- AC-25 (FR-11): IF the user cancels the confirmation, THEN THE system SHALL keep the goal and send no
  request.
- AC-26 (FR-12): IF the API refuses a withdrawal larger than the progress, THEN THE system SHALL show
  that message and keep the amount entered.
- AC-27 (FR-12): IF the API refuses a goal because the user holds 100 goals, THEN THE system SHALL show
  that message and keep the form values.
- AC-28 (FR-12): IF a request fails with no connection, THEN THE system SHALL show the offline message
  and keep everything the user entered.
- AC-29 (FR-13): WHERE the interface language is Spanish or English, THE system SHALL show every goal
  string, amount and date in that language.

## Out of Scope
- Offline creation or editing of goals and entries: the goals API has no offline path.
- Any API change, including a cursor or offset for entries: only the first 100 entries are reachable
  (see Decision Log).
- Editing or deleting a single entry, and notes or dates on entries (06a out of scope).
- Linking, unlinking or relinking an account after creation, and changing the currency (06a).
- Budget screens (DISC-001-06f) and push or email notifications when a goal is reached.
- Shared goals, automatic contributions and currency conversion.
- The account delete refusal `ACCOUNT_LINKED_TO_GOAL`: it belongs to the accounts screens, not to
  deleting a goal.

## Risks and Mitigations
- **Entries beyond the newest 100 cannot be read** -> the history says it shows the latest 100, and
  the progress is always the API's figure, never a client sum (NFR-04).
- **Client and server disagree on money** -> the client only parses input with the money input helpers
  and sends minor-unit strings; it never computes progress or percentages (NFR-04).
- **A linked goal looks editable like the others** -> the account and currency are read only on edit
  and the entry forms are hidden for linked goals (AC-16, AC-22).
- **A small screen hides the form actions** -> mobile first layout, checked at 360 px (NFR-01).
- **A double tap records an entry twice** -> the submit is disabled while the request is pending.

## Dependencies
- DISC-001-06a (goals API) — merged; response and request schemas from `@pesly/shared`.
- The api-client (04e) gains goal methods and already maps the goal error codes to catalog keys.
- PRD 02 (accounts) — `listAccounts` for the linkable accounts.
- FEAT-004 (design system) and the money input helpers (`formatMoneyInput`, `parseAmountInput`).

## Decision Log
- 2026-10-11: Goals screens are online only because the goals API has no offline path. Proposed by
  the model, awaiting the owner's acceptance.
- 2026-10-11: The entries API has only a `limit` (maximum 100), so "load more" grows the limit and the
  history stops at the latest 100 entries; adding a cursor needs an API change outside this ticket.
  Proposed by the model, awaiting the owner's acceptance.

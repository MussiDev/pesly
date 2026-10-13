# PRD FEAT-007: Group detail — suggested payments and recent expenses

| Field | Value |
|-------|-------|
| Ticket | FEAT-007 |
| Tracker | none |
| Date | 2026-10-12 |
| PRD loops | 3 |
| Loops since last human decision | 0 |

## Context and Problem

The group detail screen (`/groups/[id]`) shows the caller's own balance, four shortcuts
(expenses, activity, categories, default split), the members, the invitation and ghost-member
panels, the admin actions and the leave panel. The two things a member opens a group for are one tap
away but not on the screen:

- **Who pays whom.** The suggested payments exist only on `/groups/[id]/balances`, together with the
  form that records a payment (DISC-001-05g).
- **What was spent lately.** The expenses exist only on `/groups/[id]/expenses` (DISC-001-05f).

The redesign of the home and group screens (PR #76) made the detail screen the group's home, so it
should answer "what do I owe and what happened" without a second navigation.

The detail screen already loads the group and the balances (for the own-balance summary), so the
suggested payments need no new request. The recent expenses need two more calls to existing endpoints: the list
(`GET /groups/:id/expenses?limit=5`) and the expense options, because the list carries only a
category id and the options name the categories. No API, schema or migration change is needed.

## Goals

- Show, on the group detail, the payments that would settle each currency, with the same wording and
  amounts as the balances screen, and let the member record one without leaving the screen.
- Show, on the group detail, the most recent expenses of the group, with a link to the full list.
- Keep the detail screen usable when either new section fails to load.

## Functional Requirements

- FR-01: The group detail shows a "Suggested payments" section with, per currency, the payments that
  settle the group, built from the balances the screen already loads and the same view builder the
  balances screen uses (`buildBalanceView`), so both screens always show the same payments.
- FR-02: Each suggested payment row shows payer, payee and amount formatted with its currency, and a
  "Record" button.
- FR-03: Pressing "Record" opens the settlement form on the detail screen prefilled with that
  payment's payer, payee, amount and currency, using the existing settlement form container.
- FR-04: After a payment is recorded, the detail screen reloads the balances, so the own-balance
  summary and the suggested payments reflect it, and closes the form.
- FR-05: When the group has no suggested payments in any currency, the section shows a short
  "all settled" message instead of an empty list.
- FR-06: The group detail shows a "Recent expenses" section with the 5 newest expenses of the group
  (description, category, payer, amount, date), loaded with one call to the existing list endpoint
  with `limit=5` and one call to the existing expense options endpoint, which names the categories.
- FR-07: The "Recent expenses" section has a "See all" link to `/groups/[id]/expenses`.
- FR-08: When the group has no expenses, the section shows an empty message with the link to the
  expenses page, where the expense is created.
- FR-09: Each new section loads and fails independently: a failed balances call or a failed expenses
  call shows a retry message in that section only and never hides the members or the rest of the
  screen.
- FR-10: Every string of the two sections goes through the i18n catalogs in Spanish and English,
  and amounts and dates use the locale formatters.
- FR-11: The two sections are presentational components with no data fetching; the detail container
  owns the requests (container/presentational split).

## Non-Functional Requirements

- NFR-01: The detail screen makes at most 4 requests on first load (group, balances, recent
  expenses, expense options), issued in parallel, and no request is added to any other screen.
- NFR-02: The detail screen renders the group name and members as soon as the group call answers,
  without waiting for the recent expenses call; while that call is pending, the recent expenses
  section shows at most 5 skeleton rows.
- NFR-03: The sections meet WCAG 2.1 AA: the Record buttons are reachable by keyboard, have
  accessible names that include payer and payee, and the layout has no horizontal scroll at 320 px
  width at the default text size.
- NFR-04: Coverage of the new web code stays at or above the project floor of 80% lines, branches
  and functions, and no `any` is introduced.

## Acceptance Criteria

- AC-01 (FR-01): WHEN a group has balances in ARS and USD, THE group detail SHALL show suggested
  payments grouped by currency, equal to the ones `/groups/[id]/balances` shows for the same data.
- AC-02 (FR-02): WHEN a suggested payment exists, THE group detail SHALL show its payer, payee and
  amount formatted with its currency, and a Record button.
- AC-03 (FR-03): WHEN the member presses Record on a suggested payment, THE group detail SHALL open
  the settlement form prefilled with that payment's payer, payee, amount and currency.
- AC-04 (FR-04): WHEN a payment is recorded from the detail screen, THE group detail SHALL close the
  form and reload the balances, so the suggested payments and the own-balance summary change.
- AC-05 (FR-04): IF recording the payment fails, THEN THE group detail SHALL keep the form open and
  show the failure, as the balances screen does, without reloading the balances.
- AC-06 (FR-05): WHEN no currency has a suggested payment, THE group detail SHALL show the "all
  settled" message and no payment rows.
- AC-07 (FR-06): WHEN the group has more than 5 expenses, THE group detail SHALL request the list
  with `limit=5` and show exactly those 5, newest first.
- AC-08 (FR-07): WHEN the member follows "See all", THE group detail SHALL navigate to
  `/groups/[id]/expenses`.
- AC-09 (FR-08): WHEN the group has no expenses, THE group detail SHALL show the empty message and
  the link to the expenses page.
- AC-10 (FR-09): IF the balances call fails, THEN THE group detail SHALL show a retry message in the
  suggested payments section and keep the members and the recent expenses visible.
- AC-11 (FR-09): IF the recent expenses call fails, THEN THE group detail SHALL show a retry message
  in that section and keep the members and the suggested payments visible.
- AC-12 (FR-09): IF the group is not found or the session expired, THEN THE group detail SHALL keep
  its current behaviour (not-found view, redirect to sign-in) and show neither section.
- AC-13 (FR-10): WHILE the interface language is English or Spanish, THE group detail SHALL show the
  two sections' text from the catalog of that language, with amounts and dates in its locale format.
- AC-14 (NFR-01): WHEN the detail screen loads, THE group detail SHALL issue the group, balances, recent
  expenses and expense options requests in parallel and no more than those four.
- AC-15 (NFR-03): WHILE the viewport is 320 px wide at the default text size, THE group detail SHALL
  show both sections without horizontal scroll.
- AC-16 (FR-11): WHEN the two sections are rendered in a component test with props only, THE
  sections SHALL show their content with zero calls to the API client, because the container owns
  every request.
- AC-17 (NFR-02): WHILE the recent expenses call is pending, THE group detail SHALL show the group
  name and members and at most 5 skeleton rows in the recent expenses section.

## Out of Scope

- Any API, shared schema or database change.
- Paging, filtering or editing expenses from the detail screen (they stay on the expenses page).
- Showing the group's expenses queued offline (the detail screen stays online only, as it is today).
- Changes to the balances, settlements or expenses screens, which keep working as they do.
- The consolidated settlement flow (it stays on `/groups/[id]/settlements/consolidate`).
- Push notifications or in-app notices about debts.
- The group detail at 200% text size: at that size the existing header and balance card already make
  the page scroll horizontally (measured 522 px of content in a 320 px viewport with the new sections
  removed), so fixing it belongs to its own ticket and not to this one.

## Risks and Mitigations

- **Duplicated logic between the balances screen and the detail screen.** Mitigation: both use
  `buildBalanceView` and the existing `SuggestedPayments` component; the detail container must not
  re-implement the payment computation.
- **The detail container grows (about 250 lines today).** Mitigation: the new sections are separate
  presentational components and the new loading logic goes in a small hook or sub-container, not in
  the existing container body.
- **A stale balance after recording a payment from another device.** Mitigation: the existing
  settlement endpoint answers 409 when debts moved; the form shows it as on the balances screen.
- **Layout regression at 320 px on the redesigned screen.** Mitigation: AC-15 is covered by a
  browser test at the narrow viewport.

## Dependencies

- DISC-001-05g (balances, suggested payments, settlement form) and DISC-001-05f (expenses list).
- The redesign of the home and group screens (PR #76), whose detail layout the sections join.
- Existing endpoints `GET /groups/:id/balances`, `GET /groups/:id/expenses` and the expense options
  endpoint behind `getExpenseOptions`.

## Decision log

- 2026-10-12: Decided by the owner: AC-15 and NFR-03 are limited to 320 px at the default text size; the group detail at 200% text size is left to its own ticket, because the existing header and balance card already overflow there (measured 522 px of content in a 320 px viewport with the new sections removed).

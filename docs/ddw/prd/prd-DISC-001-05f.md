# PRD DISC-001-05f: Group Expenses Screens

| Field | Value |
|-------|-------|
| Ticket | DISC-001-05f |
| Tracker | none |
| Date | 2026-10-11 |
| PRD loops | 1 |
| Loops since last human decision | 1 |

## Context and Problem
Second of four web sub-tickets of PRD 05 (parent index: `prd-DISC-001-05.md`; 05e groups and members,
05g balances and settlements, 05h editing, activity and conflicts). The expense API is complete (05b)
and 05e put a group on screen, but a member still cannot record or read an expense: the group detail
has no expense list, no form and no way to choose how an amount is split. This ticket builds those
screens on the existing API. It adds no endpoint, no migration and no dependency.

## Goals
- A member can record an expense paid by any member and choose how it is split.
- A member can read the group's expenses, newest first, and load more.
- An admin can set the group's default split.
- A user can see their own share of every group expense across groups.

## Functional Requirements
- FR-01: The system must show the group's expenses on the group page, newest first, each with
  description, category, payer, amount with its currency, date and the viewer's own share.
- FR-02: The system must load further expenses on request, 50 per page, until the list ends.
- FR-03: The system must show an empty state with an "add expense" action when the group has no
  expenses.
- FR-04: The system must provide an expense form with amount, currency, date, payer, category and
  description, prefilled with the group's default split and today's date.
- FR-05: The system must let the user pick the split mode: equal, percentage or exact amounts.
- FR-06: The system must, in equal mode, let the user choose which members take part, and show each
  member's resulting share.
- FR-07: The system must, in percentage mode, let the user enter a percentage per member and show the
  running total against 100%.
- FR-08: The system must, in exact mode, let the user enter an amount per member and show the
  remaining amount against the expense total.
- FR-09: The system must block sending while the split does not add up and say by how much it is off.
- FR-10: The system must ask for the payer's own account and personal category when the payer is the
  current user, and not ask for them otherwise.
- FR-11: The system must let an admin edit the group's default split as equal or by percentages.
- FR-12: The system must provide a personal shares page listing the user's shares across all groups for
  a date range, per currency, with the amount still owed to them when they paid.
- FR-13: The system must show every string in Spanish and English from the i18n catalogs.

## Non-Functional Requirements
- NFR-01: Each screen must render without horizontal scrolling at a 360 px wide viewport, verified by
  an end-to-end test at that width.
- NFR-02: The expense form must load its data with at most 3 API requests, and the list page with at
  most 2, verified by a test that counts the calls.
- NFR-03: The Spanish and English catalogs must have 0 missing or empty keys, verified by the existing
  catalog parity test.
- NFR-04: The client-side split totals must agree with the server: over 1,000 random splits of random
  amounts, 0 splits accepted by the client are refused by the shared split rules, verified by a
  property test.
- NFR-05: 0 occurrences of `parseFloat`, `toFixed` or `Number(` applied to money are allowed in the touched
  files, verified by a scan in the test suite.

## Acceptance Criteria
*(EARS)*
- AC-01 (FR-01): WHEN a member opens a group with expenses, THE system SHALL list them newest first
  with description, category, payer, amount, date and the viewer's share.
- AC-02 (FR-02): WHEN the user asks for more and a next page exists, THE system SHALL append the next 50
  expenses without reloading the page.
- AC-03 (FR-03): WHILE a group has no expenses, THE system SHALL show the empty state with the add
  expense action.
- AC-04 (FR-04): WHEN a member submits a valid form, THE system SHALL create the expense and show it at
  the top of the list.
- AC-05 (FR-04): IF the amount is empty, zero or not a number, or the description is empty or longer
  than 200 characters, THEN THE system SHALL show a field error and not send the request.
- AC-06 (FR-05): WHEN the user changes the split mode, THE system SHALL keep the amount and payer and
  reset only the per-member values.
- AC-07 (FR-06): WHEN the user selects members in equal mode, THE system SHALL show each share with the
  leftover minor units given to the payer first.
- AC-08 (FR-07): WHILE the percentages do not total 100%, THE system SHALL show the difference and
  disable sending.
- AC-09 (FR-08): WHILE the exact amounts do not sum to the expense total, THE system SHALL show the
  remaining amount and disable sending.
- AC-10 (FR-09): IF the server refuses the split as invalid, THEN THE system SHALL show that message and
  keep everything the user entered.
- AC-11 (FR-10): WHEN the current user is chosen as payer, THE system SHALL require one of their
  accounts in the expense currency and a personal category.
- AC-12 (FR-10): IF the current user is chosen as payer and has no account in that currency, THEN THE
  system SHALL say so and not send the request.
- AC-13 (FR-11): WHEN an admin saves a default split, THE system SHALL show it as the prefill of the
  next expense form.
- AC-14 (FR-11): IF a member who is not an admin opens the default split, THEN THE system SHALL show it
  read only.
- AC-15 (FR-12): WHEN the user opens the personal shares page, THE system SHALL list their shares for
  the chosen range with currency, and show totals per currency without converting between them.
- AC-16 (FR-12): IF the range is invalid, THEN THE system SHALL show a field error and not send the
  request.
- AC-17 (FR-13): WHERE the interface language is Spanish or English, THE system SHALL show every
  expense string in that language.

## Out of Scope
- Editing and deleting expenses, the activity log and conflict handling (05h).
- Balances, suggested payments and settlements (05g).
- Offline creation of group expenses: the screens are online only, as decided for PRD 05.
- Changing the currency or payer of an existing expense (05d decision).
- Receipt photos, comments, recurring group expenses and converting a group expense between currencies.

## Risks and Mitigations
- **Client and server disagree on a split** -> the client uses the shared split helpers and a property
  test (NFR-04); the server stays authoritative and its refusal is displayed (AC-10).
- **Money lost to floating point while typing percentages** -> basis points and minor units only
  (NFR-05).
- **Payer account rules are easy to get wrong** -> they are asked for exactly when the payer is the
  current user (FR-10) and tested both ways.
- **A long form is hard to use at 360 px** -> one field group per step of the form, mobile first
  (NFR-01).

## Dependencies
- DISC-001-05b (expense API), 05a (default split) and 05d (version field) — merged.
- DISC-001-05e (draft PR #54) — group screens, api-client group methods and the `groups` catalog this
  ticket builds on; this branch is stacked on it.
- PRD 02 (accounts) — the payer's accounts and personal categories.
- FEAT-004 (design system) and the money input helpers.

## Decision Log
- 2026-10-11: The group web UI keeps the 05e to 05h split; 05f owns the personal shares view because
  it reads the same expenses and is the only consumer of that endpoint. Proposed by the model,
  awaiting the owner's acceptance.
- 2026-10-11: Group expenses are online only in this ticket; offline entry stays with the sync layer
  of 04e and is not extended here. Proposed by the model, awaiting the owner's acceptance.

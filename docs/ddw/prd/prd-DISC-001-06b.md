# PRD DISC-001-06b: Budgets Core API

| Field | Value |
|-------|-------|
| Ticket | DISC-001-06b |
| Tracker | none |
| Date | 2026-10-11 |
| PRD loops | 0 |
| Loops since last human decision | 0 |

## Context and Problem
Second of six sub-tickets of Savings Goals & Budgets (parent index: `prd-DISC-001-06.md`; the
sub-tickets are 06a goals API, 06b budgets core API, 06c budget spending and rollover, 06d budget
alerts, 06e goals screens and 06f budgets screens). Users want to cap their monthly spending per
category ("at most ARS 150,000 a month on outings"). Before spending can be computed (06c) or
alerts raised (06d), the system needs the budget itself: its name, amount, currency, the categories
it covers, its rollover flag and its alert thresholds, plus the rules to create, read, edit and
delete it, owned by one user. An edit takes effect from the current month and must leave earlier
months as they were, so this ticket also fixes how edits are stored. This ticket creates the
`budgets` module with no spending computation, no alert and no screen. Requirement IDs were
renumbered for this sub-ticket; the original IDs of the parent PRD are listed in the Decision Log.

## Goals
- Let a user define a monthly budget in ARS or USD over one or more of their own expense
  categories, with the subcategories of a selected parent included.
- Store the rollover flag and the alert thresholds so 06c and 06d only read them.
- Keep a history of edits by month, so changing a budget never rewrites a past month.
- Keep budgets private to their owner.

## Functional Requirements
- FR-01: The system must allow a user to create a monthly budget with a name, an amount greater
  than 0, a currency (ARS or USD) and one or more of the user's own expense categories.
- FR-02: The system must include, for every parent category selected in a budget, all of its
  subcategories, including subcategories created after the budget.
- FR-03: The system must store for each budget a rollover flag, off by default, that the user can
  turn on or off.
- FR-04: The system must store for each budget its alert thresholds as percentages of the available
  amount, with defaults of 80% and 100% when the user sets none.
- FR-05: The system must allow a user to edit the name, amount, categories, thresholds and rollover
  flag of a budget, with effect from the current month in the user's time zone, and must keep the
  values of earlier months unchanged.
- FR-06: The system must allow a user to delete a budget.
- FR-07: The system must allow a user to list and read only their own budgets, and to edit and
  delete only their own budgets.

## Non-Functional Requirements
- NFR-01: Budget amounts must be stored as 64-bit integers in minor units, with 0 floating-point
  columns or fields for money.
- NFR-02: Alert thresholds must be integers between 1 and 200 (percent), with at most 5 thresholds
  per budget.
- NFR-03: A user must be able to hold at least 50 budgets; the system limits a user to exactly 50
  budgets.

## Acceptance Criteria
- AC-01 (FR-01): WHEN a user creates a budget "Outings" of 150,000.00 ARS over the categories
  Entertainment and Restaurants, THE system SHALL store it and show it in the budget list.
- AC-02 (FR-01): IF a user creates a budget with no category, with an amount of 0 or less, with an
  empty name or with a currency other than ARS or USD, THEN THE system SHALL reject it.
- AC-03 (FR-01): IF a user creates a budget with a category that belongs to another user or does
  not exist, THEN THE system SHALL reject it and create nothing.
- AC-04 (FR-01): IF a user creates a budget over an income category, THEN THE system SHALL reject
  it.
- AC-05 (FR-01): IF a user creates a budget over an archived category, THEN THE system SHALL reject
  it.
- AC-06 (FR-02): WHEN a budget includes the parent category Food, THE system SHALL return Groceries,
  Restaurants and Delivery as covered by that budget, and SHALL return a subcategory created later
  under Food as covered as well.
- AC-07 (FR-03): WHEN a user creates a budget without a rollover setting, THE system SHALL store
  rollover as off.
- AC-08 (FR-03): WHEN a user turns rollover on for a budget, THE system SHALL persist the setting
  and show it on the budget.
- AC-09 (FR-04): WHEN a user creates a budget without thresholds, THE system SHALL store thresholds
  of 80% and 100%.
- AC-10 (FR-04): WHEN a user creates a budget with the thresholds 120, 50 and 80, THE system SHALL
  store them and return them in ascending order.
- AC-11 (FR-04): IF a user sets a threshold below 1 or above 200, a threshold that is not an
  integer, a repeated threshold or more than 5 thresholds, THEN THE system SHALL reject it.
- AC-12 (FR-05): WHEN a user changes the amount of a budget in October, THE system SHALL return the
  new amount as the budget's current values and SHALL keep the September values stored unchanged.
- AC-13 (FR-05): WHEN a user edits a budget twice in the same month, THE system SHALL keep a single
  version for that month holding the latest values.
- AC-14 (FR-05): WHEN a user changes the categories, thresholds or rollover flag of a budget, THE
  system SHALL apply the same effective-month rule as for the amount.
- AC-15 (FR-05): IF a user edits a budget with an invalid value or a request that changes the
  currency, THEN THE system SHALL reject it and leave the budget unchanged.
- AC-16 (FR-05): IF a user edits a budget with a category that belongs to another user, THEN THE
  system SHALL reject it and leave the budget unchanged.
- AC-17 (FR-06): WHEN a user deletes a budget, THE system SHALL remove it with all its stored
  versions and SHALL not change any category or movement.
- AC-18 (FR-07): IF a user requests to read, edit or delete a budget owned by another user, THEN THE
  system SHALL answer 404 Not Found and leave it unchanged.
- AC-19 (FR-07): WHEN a user opens their budget list, THE system SHALL show only the budgets they
  own.
- AC-20 (FR-07): IF a request has no valid session, THEN THE system SHALL answer 401 and return no
  budget data.
- AC-21 (NFR-01): WHEN a user creates a budget of 150,000.00 ARS, THE system SHALL store 15000000
  minor units in a 64-bit integer column and return the amount as an exact integer string.
- AC-22 (NFR-02): WHEN a user creates a budget with 5 valid thresholds, THE system SHALL accept it;
  IF a sixth is sent, THEN THE system SHALL reject it.
- AC-23 (NFR-03): WHILE a user holds 49 budgets, THE system SHALL let the user create the 50th;
  IF the user holds 50 budgets and creates another, THEN THE system SHALL reject it with a 409
  conflict and create nothing.
- AC-24 (NFR-03): WHEN a user holding 50 budgets deletes one, THE system SHALL let the user create
  a new one.

## Out of Scope
- Computing spending, remaining amount and percentage used of a budget (DISC-001-06c).
- Rollover computation: only the flag is stored here (DISC-001-06c).
- Alerts and their once-per-month state (DISC-001-06d); only the thresholds are stored here.
- Web screens for budgets (DISC-001-06f).
- Savings goals (DISC-001-06a, DISC-001-06e).
- Weekly, yearly or custom periods (monthly only), group or shared budgets, budgets over income
  categories, zero-based and Flex methodologies, and moving money between budget categories.
- Changing the currency of an existing budget: delete it and create a new one.
- Reading the budget values of a past month through the API: the versions are stored here and read
  by 06c.
- Group category matching (parent FR-16): done in DISC-001-06c.

## Risks and Mitigations
- **An edit rewrites a past month** → every edit writes a version effective from the first day of
  the current month and never touches an earlier version (FR-05, AC-12).
- **A budget points at another user's category** → the foreign key from budget categories to
  categories includes the owner, so the database refuses a foreign category as well as the use
  case (AC-03, AC-16).
- **A user deletes a category a budget uses** → the foreign key refuses it and the existing
  `CATEGORY_IN_USE` answer is returned; archiving remains allowed.
- **Two concurrent creates pass the 50-budget limit** → the count runs inside a transaction that
  holds a per-user lock (NFR-03, AC-23).
- **The migration collides with another branch's** → this ticket adds the budget tables as
  migration 0034, while the goals ticket uses 0033 on another branch; numbers are renumbered at
  merge, and its journal `when` must exceed the maximum `when` on `main` at merge time, or a
  database that already ran a newer migration skips it silently (same rule as DISC-001-05a).

## Dependencies
- PRD 01 (Identity & Access) — ownership and access control (FR-07) and the user's time zone
  (FR-05); merged.
- PRD 02 (Accounts & Categories) — expense categories and subcategories selected in a budget
  (FR-01, FR-02); merged.
- DISC-001-06a is independent: no code is shared between goals and budgets, so either can merge
  first.
- Database migration: 0034, its journal `when` greater than the maximum on `main` when it merges.

## Decision Log
- 2026-09-25: Budget design after reviewing Monarch, YNAB, Wallet and Spendee: monthly period, one
  or more categories per budget, ARS or USD, optional rollover, thresholds of 80% and 100% by
  default, up to 5 thresholds between 1 and 200 percent (parent PRD Decision Log).
- 2026-10-11: Parent PRD split into six sub-tickets; this one covers budgets core API. Parent IDs
  map as: FR-12 to FR-01, FR-13 to FR-02, FR-18 to FR-03, FR-20 to FR-04, FR-22 to FR-05, FR-23 to
  FR-06, the budget part of FR-24 to FR-07, NFR-01 to NFR-01, NFR-05 to NFR-02, NFR-04 (budgets) to
  NFR-03.
- 2026-10-11: Edits are stored as versions effective from a month (spec D2); proposed by this
  ticket, pending the owner's confirmation (spec open question 1).
- 2026-10-11: A user holds at most 50 budgets and the 51st answers 409 `BUDGET_LIMIT_REACHED`, as
  recurring payments answer 409 at their cap; 409 chosen over 400 because the request is valid and
  conflicts with the stored state. Pending the owner's confirmation (spec open question 2).
- 2026-10-11: Subcategories are expanded when spending is read, not copied when the budget is saved,
  so a new subcategory is covered automatically (AC-06).
- 2026-10-11: Two budgets may share a name; the PRD asks for no uniqueness.

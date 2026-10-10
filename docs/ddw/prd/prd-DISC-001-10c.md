# PRD DISC-001-10c: Installment Purchases, Statement Totals and Pending Debt

| Field | Value |
|-------|-------|
| Ticket | DISC-001-10c |
| Tracker | none |
| Date | 2026-10-06 |
| PRD loops | 0 |
| Loops since last human decision | 0 |

## Context and Problem
Third of six sub-tickets of Credit Cards: Statements & Installments (parent index:
`prd-DISC-001-10.md`). In Argentina purchases are split into installments ("12 cuotas sin
interés") that land on future statements. Users need to record them, to see the installments in
each statement's total, to know how much debt is committed in future installments, and to see each
installment as spending in the month they actually pay it (decision 2026-09-25: cash-flow view,
the usual one in Argentina). This ticket builds on the card expenses and statement assignment of
DISC-001-10b. Paying statements comes in DISC-001-10d. Split from `prd-DISC-001-10.md`
(2026-10-06, user decision). Requirement IDs were renumbered; the parent index maps every original
ID to its new one.

## Goals
- Record installment purchases and spread them over future statements.
- Count each installment as spending in the month of its statement.
- Show each statement's total per currency with its installments, and each card's pending debt.

## Functional Requirements
- FR-01: The system must allow a user to record an installment purchase on a card with a total
  amount in ARS and a number of installments from 2 to 60.
- FR-02: The system must reject installment purchases in USD.
- FR-03: The system must split an installment purchase into equal installments, assigning the
  minor units left over to the first installment.
- FR-04: The system must assign the first installment to the statement of the purchase date and
  each following installment to the next statement.
- FR-05: The system must count each installment as an expense of the purchase's category in the
  month of its statement's due date, for reports (PRD 09) and budgets (PRD 06).
- FR-06: The system must include the installments assigned to a statement in the total per
  currency that DISC-001-10b shows, so that the total is the sum of the purchases and installments
  assigned to it.
- FR-07: The system must show, for each card, its pending debt: the sum of the installments
  assigned to statements that are not yet closed, per currency.
- FR-08: The system must allow a user to delete an installment purchase, removing the installments
  assigned to statements not yet closed and keeping the ones in closed statements.
- FR-09: The system must let a user read, edit and delete only their own installment purchases.

## Non-Functional Requirements
- NFR-01: Amounts must be stored as 64-bit integers in minor units, with 0 floating-point columns
  or fields for money (concept decision).
- NFR-02: The statement view must answer in < 300 ms at p95 for a card with 60 active installment
  purchases, measured server-side.
- NFR-03: For every installment purchase, the sum of its installments must equal its total amount
  exactly (difference of 0 minor units), verified by an automated test over 10,000 random
  purchases.

## Acceptance Criteria
- AC-01 (FR-01): WHEN a user records a purchase of 120,000.00 ARS in 12 installments, THE system
  SHALL store it with 12 installments.
- AC-02 (FR-01): IF a user records an installment purchase with fewer than 2 or more than 60
  installments, THEN THE system SHALL reject it.
- AC-03 (FR-02): IF a user records an installment purchase in USD, THEN THE system SHALL reject
  it.
- AC-04 (FR-03): WHEN a purchase of 100.00 ARS is split into 3 installments, THE system SHALL
  create installments of 33.34, 33.33 and 33.33 ARS.
- AC-05 (FR-04): WHEN a purchase in 3 installments is assigned to the statement closing on
  2026-10-24, THE system SHALL assign its installments to the statements closing on 2026-10-24,
  2026-11-24 and 2026-12-24.
- AC-06 (FR-05): WHEN an installment of 10,000.00 ARS belongs to a statement due on 2026-11-05,
  THE system SHALL count 10,000.00 ARS as an expense of the purchase's category in November 2026
  and SHALL not count the rest of the purchase in that month.
- AC-07 (FR-06): WHEN a statement has purchases of 50,000.00 ARS and 20.00 USD and an installment
  of 10,000.00 ARS, THE system SHALL show totals of 60,000.00 ARS and 20.00 USD.
- AC-08 (FR-07): WHEN a card has 11 installments of 10,000.00 ARS in statements not yet closed,
  THE system SHALL show a pending debt of 110,000.00 ARS.
- AC-09 (FR-08): WHEN a user deletes a purchase in 12 installments after 2 statements have
  closed, THE system SHALL remove the 10 installments of statements not yet closed and keep the 2
  in the closed statements.
- AC-10 (FR-09): IF a user requests to read, edit or delete an installment purchase owned by
  another user, THEN THE system SHALL answer 404 Not Found and leave it unchanged.

## Out of Scope
- Cards, linked accounts, statement cycles and ownership of cards and statements
  (DISC-001-10a).
- Card expenses and their assignment to statements (DISC-001-10b).
- Statement payments and payment status (DISC-001-10d).
- Automatic debit (DISC-001-10e).
- Statement due-date reminders (DISC-001-10f).
- Early cancellation of installments (precancelación).
- Installments with interest and installment plans in USD.
- Automatic calculation of interest, fees or taxes (the user records them as expenses).
- Paying a group expense in installments.
- Credit limit and available credit.
- Minimum payment calculation.

## Risks and Mitigations
- **Double counting installments in reports** → only each installment counts, in its statement's
  month (FR-05, AC-06).
- **Rounding makes installments not add up** → leftover to the first installment and exact-sum
  invariant (FR-03, NFR-03).
- **Budgets and reports are not built yet** → this ticket exposes the monthly installment amounts
  by category; how PRD 06 and PRD 09 consume them is a pending decision of the parent index.

## Dependencies
- DISC-001-10b (Card Expenses and Statement Assignment) — purchases assigned to statements and the
  total per currency that FR-06 completes (FR-04, FR-06).
- DISC-001-10a (Cards, Linked Accounts and Statement Cycles) — cards, statements and closing
  dates (FR-04, FR-07, FR-09); reached through DISC-001-10b.
- PRD 01 (Identity & Access) — access control (FR-09).
- PRD 02 (Accounts & Categories) — categories of the purchases (FR-05).
- PRD 03 (Movements & Exchange Rates) — expenses on the card (FR-01).
- PRD 06 (Savings Goals & Budgets) — budgets receive installments by statement month (FR-05);
  not built.
- PRD 09 (Dashboard & Reports) — reports receive installments by statement month (FR-05); not
  built.

## Decision Log
- 2026-09-25: Each installment counts as spending in the month of its statement (cash flow)
  (original Decision Log).
- 2026-09-25: Design reviewed against Money Manager (Realbyte) and Argentine bank documentation:
  2–60 ARS installments with leftover to the first one, no interest calculation (original Decision
  Log).
- 2026-09-25: User approved that the statement month is the due-date month (original Decision
  Log).
- 2026-10-06: Parent PRD split into DISC-001-10a to 10f by user decision.
- 2026-10-06: The original FR-14 is divided: this ticket adds the installments to the total of
  purchases of DISC-001-10b; FR-06 here is derived text. Listed in the parent index.

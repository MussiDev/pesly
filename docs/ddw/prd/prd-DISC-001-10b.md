# PRD DISC-001-10b: Card Expenses and Statement Assignment

| Field | Value |
|-------|-------|
| Ticket | DISC-001-10b |
| Tracker | none |
| Date | 2026-10-06 |
| PRD loops | 0 |
| Loops since last human decision | 0 |

## Context and Problem
Second of six sub-tickets of Credit Cards: Statements & Installments (parent index:
`prd-DISC-001-10.md`). With the cards, linked accounts and statement cycles of DISC-001-10a, a
user can now spend with the card: an expense on a card goes to the linked account of its currency,
and the closing date decides which statement it belongs to. The user also sees, for each
statement, how much the purchases add up to per currency. Installment purchases come in
DISC-001-10c. Split from `prd-DISC-001-10.md` (2026-10-06, user decision). Requirement IDs were
renumbered; the parent index maps every original ID to its new one.

## Goals
- Record an expense on a card in the right currency without the user choosing between accounts.
- Group purchases into statements by closing date and show each statement's total per currency.

## Functional Requirements
- FR-01: The system must assign an expense recorded on a credit card to the linked account whose
  currency matches the currency the user chose for the expense.
- FR-02: The system must assign a purchase dated on or before a statement's closing date to that
  statement, and a purchase dated after it to the next statement, and must apply the same rule
  again when the closing date of a statement that is not yet closed changes.
- FR-03: The system must show, for each statement, its total per currency: the sum of the
  purchases assigned to it.

## Non-Functional Requirements
- NFR-01: Amounts must be stored as 64-bit integers in minor units, with 0 floating-point columns
  or fields for money (concept decision).

## Acceptance Criteria
- AC-01 (FR-01): WHEN a user records an expense of 15.99 USD on card "Visa", THE system SHALL
  record it on the account "Visa USD".
- AC-02 (FR-02): WHEN a purchase dated 2026-10-24 is recorded on a card whose statement closes on
  2026-10-24, THE system SHALL assign it to that statement.
- AC-03 (FR-02): WHEN a purchase dated 2026-10-25 is recorded on that card, THE system SHALL
  assign it to the next statement.
- AC-04 (FR-02): WHEN a user moves the closing date of an open statement from 2026-10-24 to
  2026-10-26, THE system SHALL reassign the purchases dated 2026-10-25 and 2026-10-26 to that
  statement.
- AC-05 (FR-03): WHEN a statement has purchases of 50,000.00 ARS and 20.00 USD, THE system SHALL
  show totals of 50,000.00 ARS and 20.00 USD.

## Out of Scope
- Creating cards, linked accounts and statements, and changing their dates (DISC-001-10a).
- Installment purchases and their part of the statement total (DISC-001-10c).
- Statement payments and payment status (DISC-001-10d).
- Automatic debit (DISC-001-10e).
- Statement due-date reminders (DISC-001-10f).
- Automatic calculation of interest, fees or taxes (the user records them as expenses).
- Paying a group expense in installments.
- Converting the USD balance to ARS at payment time (each currency is paid from an account in
  that currency).

## Risks and Mitigations
- **The user picks the wrong currency account for a card expense** → the app chooses the linked
  account from the expense currency (FR-01).
- **Banks move closing dates around holidays and purchases end up in the wrong statement** →
  purchases are assigned again when the closing date of an open statement changes (FR-02,
  AC-04).

## Dependencies
- DISC-001-10a (Cards, Linked Accounts and Statement Cycles) — the cards, the linked accounts and
  the statements with their closing dates (FR-01, FR-02, FR-03).
- PRD 02 (Accounts & Categories) — the credit card account type (FR-01).
- PRD 03 (Movements & Exchange Rates) — the expenses recorded on a card (FR-01, FR-02).

## Decision Log
- 2026-09-25: Two linked accounts per card (ARS and USD), chosen automatically from the expense
  currency (original Decision Log).
- 2026-09-25: Design reviewed against Money Manager (Realbyte) and Argentine bank documentation:
  purchase assignment by closing date, no interest calculation (original Decision Log).
- 2026-10-06: Parent PRD split into DISC-001-10a to 10f by user decision.
- 2026-10-06: The original FR-14 (statement total) is divided: the total of the purchases is FR-03
  here and the installments join it in DISC-001-10c. The reassignment when a closing date changes
  (original AC-06) is written into FR-02. Both are listed in the parent index.

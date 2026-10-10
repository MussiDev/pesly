# PRD DISC-001-10d: Statement Payments and Status

| Field | Value |
|-------|-------|
| Ticket | DISC-001-10d |
| Tracker | none |
| Date | 2026-10-06 |
| PRD loops | 0 |
| Loops since last human decision | 0 |

## Context and Problem
Fourth of six sub-tickets of Credit Cards: Statements & Installments (parent index:
`prd-DISC-001-10.md`). Once a statement has a total (DISC-001-10b and 10c), the user pays it from
one of their accounts. A payment is a transfer to the card's linked account of the same currency,
not an expense, and each closed statement shows whether it is paid, partially paid or unpaid, per
currency. Automatic payments come in DISC-001-10e. Split from `prd-DISC-001-10.md` (2026-10-06,
user decision). Requirement IDs were renumbered; the parent index maps every original ID to its
new one.

## Goals
- Support manual statement payments, each currency paid from an account in that currency.
- Show for each closed statement and currency how much of it is paid.

## Functional Requirements
- FR-01: The system must allow a user to record a statement payment as a transfer (PRD 03) of an
  amount greater than 0 from one of their accounts to the card's linked account of the same
  currency.
- FR-02: The system must show, for each closed statement and currency, its status: paid when
  payments cover the total, partially paid when they cover part of it, unpaid when there are none.

## Non-Functional Requirements
- NFR-01: Amounts must be stored as 64-bit integers in minor units, with 0 floating-point columns
  or fields for money (concept decision).

## Acceptance Criteria
- AC-01 (FR-01): WHEN a user records a payment of 60,000.00 ARS from their bank account to "Visa
  ARS", THE system SHALL subtract it from the bank account and add it to "Visa ARS", without
  counting it as an expense.
- AC-02 (FR-01): IF a user records a statement payment from an account whose currency differs
  from the card account's currency, THEN THE system SHALL reject it.
- AC-03 (FR-02): WHEN a closed statement of 60,000.00 ARS has payments of 60,000.00 ARS, THE
  system SHALL show it as paid in ARS.
- AC-04 (FR-02): WHEN a closed statement of 60,000.00 ARS has payments of 20,000.00 ARS, THE
  system SHALL show it as partially paid in ARS.

## Out of Scope
- Cards, linked accounts and statement cycles (DISC-001-10a).
- Card expenses and the purchases of a statement (DISC-001-10b).
- Installment purchases, statement totals and pending debt (DISC-001-10c).
- Automatic debit and its transfers (DISC-001-10e).
- Statement due-date reminders (DISC-001-10f).
- Minimum payment calculation.
- Converting the USD balance to ARS at payment time (each currency is paid from an account in
  that currency).
- Automatic calculation of interest, fees or taxes (the user records them as expenses).

## Risks and Mitigations
- **A payment counted as spending** → the payment is a transfer between accounts, never an
  expense (FR-01, AC-01).
- **A payment in the wrong currency** → rejected when the currencies differ (AC-02).

## Dependencies
- DISC-001-10c (Installment Purchases, Statement Totals and Pending Debt) — the total of a
  statement, which the status compares with the payments (FR-02).
- DISC-001-10b (Card Expenses and Statement Assignment) and DISC-001-10a (Cards, Linked Accounts
  and Statement Cycles) — the closed statements and the card's linked accounts (FR-01, FR-02);
  reached through DISC-001-10c.
- PRD 03 (Movements & Exchange Rates) — the transfer a payment is recorded as (FR-01).

## Decision Log
- 2026-09-25: Design reviewed against Money Manager (Realbyte) and Argentine bank documentation:
  manual payments by transfer (original Decision Log).
- 2026-09-25: User approved: each currency is paid from an account in that currency, with no
  USD-to-ARS conversion (original Decision Log).
- 2026-10-06: Parent PRD split into DISC-001-10a to 10f by user decision.

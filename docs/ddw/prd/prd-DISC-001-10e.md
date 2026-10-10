# PRD DISC-001-10e: Automatic Debit

| Field | Value |
|-------|-------|
| Ticket | DISC-001-10e |
| Tracker | none |
| Date | 2026-10-06 |
| PRD loops | 0 |
| Loops since last human decision | 0 |

## Context and Problem
Fifth of six sub-tickets of Credit Cards: Statements & Installments (parent index:
`prd-DISC-001-10.md`). Many users have their card statement debited automatically from a bank
account. This ticket lets the user link an optional automatic debit account per currency to a
card, and records on the due date a transfer of the unpaid remainder (decision 2026-09-25, based
on Money Manager's billing account model). It builds on the manual payments and the statement
status of DISC-001-10d. Split from `prd-DISC-001-10.md` (2026-10-06, user decision). Requirement
IDs were renumbered; the parent index maps every original ID to its new one.

## Goals
- Support optional automatic debit, per currency, with no USD-to-ARS conversion.
- Record each automatic payment once, at the start of the due date.

## Functional Requirements
- FR-01: The system must allow a user to link to a card an optional automatic debit account per
  currency, chosen among their accounts of that currency.
- FR-02: The system must record on a statement's due date, for each currency with an automatic
  debit account, a transfer of the unpaid remainder of that currency from the debit account to the
  card's linked account.

## Non-Functional Requirements
- NFR-01: Amounts must be stored as 64-bit integers in minor units, with 0 floating-point columns
  or fields for money (concept decision).
- NFR-02: Automatic debits must be recorded between 06:00 and 06:15 of the due date, in the
  user's time zone.
- NFR-03: The automatic debit job must be idempotent: running it any number of times for the same
  day must produce 0 duplicate transfers.

## Acceptance Criteria
- AC-01 (FR-01): WHEN a user links an ARS bank account as automatic debit account for ARS, THE
  system SHALL persist the link and show it on the card.
- AC-02 (FR-01): IF a user links as automatic debit account an account whose currency differs
  from the one it is linked for, THEN THE system SHALL reject it.
- AC-03 (FR-02): WHEN the due date of a statement with an unpaid ARS remainder of 40,000.00 ARS
  arrives and the card has an ARS debit account, THE system SHALL record a transfer of 40,000.00
  ARS from the debit account to the card's ARS account.
- AC-04 (FR-02): WHILE a card has no automatic debit account for a currency, THE system SHALL
  record no automatic payment in that currency.

## Out of Scope
- Cards, linked accounts and statement cycles (DISC-001-10a).
- Card expenses (DISC-001-10b) and installment purchases, totals and pending debt
  (DISC-001-10c).
- Manual statement payments and the payment status that defines the unpaid remainder
  (DISC-001-10d).
- Statement due-date reminders (DISC-001-10f).
- Converting the USD balance to ARS at payment time (each currency is paid from an account in
  that currency).
- Minimum payment calculation.
- Importing card statements or connecting to banks (no credentials are stored, concept decision).

## Risks and Mitigations
- **Automatic debit records a payment the bank did not make** (insufficient funds) → the user can
  edit or delete the transfer (PRD 03); the debit is opt-in per currency (FR-01, AC-04).
- **The job runs twice for the same day** → idempotent job with 0 duplicate transfers (NFR-03).
- **The scheduler is not decided** → the original PRD cited PRD 08 for scheduling and PRD 08 is
  not built; how the job is scheduled until then is a pending decision of the parent index.

## Dependencies
- DISC-001-10d (Statement Payments and Status) — the payments and the unpaid remainder of a
  statement (FR-02).
- DISC-001-10c, DISC-001-10b and DISC-001-10a — the statements, their totals and the card's linked
  accounts (FR-01, FR-02); reached through DISC-001-10d.
- PRD 02 (Accounts & Categories) — the accounts a debit account is chosen among (FR-01).
- PRD 03 (Movements & Exchange Rates) — the transfers the job records (FR-02).
- PRD 08 (Recurring Payments & Reminders) — scheduling, as the original PRD declared for NFR-02;
  not built.

## Decision Log
- 2026-09-25: Design reviewed against Money Manager (Realbyte) and Argentine bank documentation:
  optional automatic debit per currency (original Decision Log).
- 2026-09-25: User approved: automatic debit per currency (no USD-to-ARS conversion), debit pays
  the unpaid remainder at 06:00 user time (original Decision Log).
- 2026-10-06: Parent PRD split into DISC-001-10a to 10f by user decision.

# PRD DISC-001-10e: Automatic Debit

| Field | Value |
|-------|-------|
| Ticket | DISC-001-10e |
| Tracker | none |
| Date | 2026-10-10 |
| PRD loops | 1 |
| Loops since last human decision | 0 |

## Context and Problem
Fifth of six sub-tickets of Credit Cards: Statements & Installments (parent index:
`prd-DISC-001-10.md`). Many users have their card statement debited automatically from a bank
account. This ticket lets the user link an optional automatic debit account per currency to a
card, and records on the due date a transfer of the unpaid remainder (decision 2026-09-25, based
on Money Manager's billing account model). It builds on the manual payments and the statement
status of DISC-001-10d, which is merged. The scheduler that was an open decision when this PRD was
split is now decided: PRD 08 is built, and the recurring payments job of DISC-001-08b already runs
in the worker, so this job runs there too, in the same way. Split from `prd-DISC-001-10.md`
(2026-10-06, user decision). Requirement IDs were renumbered; the parent index maps every original
ID to its new one.

## Goals
- Support optional automatic debit, per currency, with no USD-to-ARS conversion.
- Record each automatic payment once, at the start of the due date.

## Functional Requirements
- FR-01: The system must allow a user to link to a card an optional automatic debit account per
  currency, chosen among their accounts of that currency.
- FR-02: The system must record on a statement's due date, for each currency with an automatic
  debit account, a transfer of the unpaid remainder of that currency from the debit account to the
  card's linked account.
- FR-03: The system must record no automatic payment for a currency whose unpaid remainder on the
  due date is 0.
- FR-04: The system must record no automatic payment when the debit account is archived or does
  not exist at the moment of the debit, leaving the statement unpaid for the user to pay by hand.

## Non-Functional Requirements
- NFR-01: Amounts must be stored as 64-bit integers in minor units, with 0 floating-point columns
  or fields for money (concept decision).
- NFR-02: While the worker runs, an automatic debit must be recorded no later than 15 minutes
  after 06:00 of the due date, in the user's time zone; after the worker was stopped, the first
  pass after 06:00 on the due date or later must record it.
- NFR-03: The automatic debit job must be idempotent: running it any number of times for the same
  day must produce 0 duplicate transfers, including two runs at the same time.

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
- AC-05 (FR-01): IF a user links as automatic debit account the card's own linked account or an
  account of another user, THEN THE system SHALL reject it.
- AC-06 (FR-03): WHEN the due date of a statement arrives and the payments already recorded cover
  its total in a currency, THE system SHALL record no automatic payment in that currency.
- AC-07 (FR-04): IF the debit account of a currency is archived when the due date arrives, THEN
  THE system SHALL record no automatic payment in that currency and leave the statement unpaid.
- AC-08 (NFR-02): WHEN the worker runs a pass at 06:10 of a due date in the user's time zone, THE
  system SHALL have recorded the automatic payment of that statement.
- AC-09 (NFR-03): WHEN the job runs twice for the same statement and currency, one after the other
  or at the same time, THE system SHALL have recorded exactly one transfer.
- AC-10 (NFR-02): WHEN the worker starts after 06:00 of a due date that had no pass, THE system
  SHALL record the automatic payment in its first pass.
- AC-11 (FR-02): WHEN a user pays part of a statement by hand before its due date, THE system SHALL
  debit only the remainder on the due date.

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
- Checking the funds of the debit account: the transfer is recorded as the user configured it.
- Notifying the user that a debit was recorded or skipped (a later notices ticket).
- Importing card statements or connecting to banks (no credentials are stored, concept decision).

## Risks and Mitigations
- **Automatic debit records a payment the bank did not make** (insufficient funds) → the user can
  edit or delete the transfer (PRD 03); the debit is opt-in per currency (FR-01, AC-04).
- **The job runs twice for the same day** → idempotent job with 0 duplicate transfers (NFR-03),
  decided in PLAN as a unique record per statement and currency plus a deterministic transfer id.
- **The job records a debit of a statement the user already paid by hand** → the remainder is
  derived from the recorded payments at the moment of the debit (FR-03, AC-06, AC-11).
- **The worker is down at 06:00** → the first pass after 06:00 records the debit (NFR-02,
  AC-10); a statement paid meanwhile has no remainder and records nothing.
- **A debit account is archived or deleted after being linked** → no payment is recorded (FR-04);
  the link is protected from deletion like the card's own accounts, as decided in PLAN.

## Dependencies
- DISC-001-10d (Statement Payments and Status) — the payments and the unpaid remainder of a
  statement (FR-02); merged.
- DISC-001-10c, DISC-001-10b and DISC-001-10a — the statements, their totals and the card's linked
  accounts (FR-01, FR-02); reached through DISC-001-10d; merged.
- PRD 02 (Accounts & Categories) — the accounts a debit account is chosen among (FR-01).
- PRD 03 (Movements & Exchange Rates) — the transfers the job records (FR-02).
- PRD 08 (Recurring Payments & Reminders), DISC-001-08b — the worker and the job pattern this job
  follows (NFR-02); merged.

## Decision Log
- 2026-09-25: Design reviewed against Money Manager (Realbyte) and Argentine bank documentation:
  optional automatic debit per currency (original Decision Log).
- 2026-09-25: User approved: automatic debit per currency (no USD-to-ARS conversion), debit pays
  the unpaid remainder at 06:00 user time (original Decision Log).
- 2026-10-06: Parent PRD split into DISC-001-10a to 10f by user decision.
- 2026-10-10: PRD 08 is merged. Scheduler decided as a job of the existing worker, with the
  pattern of DISC-001-08b (a pass loop, no overlap, catch-up after downtime). FR-03, FR-04,
  AC-05 to AC-11 and the catch-up rule of NFR-02 added; to ratify with the owner at approval.

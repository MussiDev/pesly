# PRD DISC-001-10f: Statement Due-Date Reminders

| Field | Value |
|-------|-------|
| Ticket | DISC-001-10f |
| Tracker | none |
| Date | 2026-10-10 |
| PRD loops | 1 |
| Loops since last human decision | 0 |

## Context and Problem
Sixth of six sub-tickets of Credit Cards: Statements & Installments (parent index:
`prd-DISC-001-10.md`). A user who pays the card by hand needs to be reminded before each
statement's due date. PRD 08 is now built: the worker creates in-app notices at 09:00 in the
user's time zone (DISC-001-08c) and the notices screen shows them, so this ticket reuses that
channel and that scheduling. Push delivery of notices arrives with DISC-001-08d and will carry
these reminders too. Split from `prd-DISC-001-10.md` (2026-10-06, user decision). Requirement IDs
were renumbered; the parent index maps every original ID to its new one.

## Goals
- Remind the user of each statement's due date, a configurable number of days before.
- Not remind of a statement that needs no payment.

## Functional Requirements
- FR-01: The system must create an in-app reminder of each statement's due date, through the
  notices of PRD 08, a configurable number of days before (0 to 30, default 3), at 09:00 in the
  user's time zone.
- FR-02: The system must allow a user to set the number of reminder days of a card, on creation
  and on edit.
- FR-03: The system must create no reminder for a statement whose payments already cover its total
  in every currency, nor for a statement with no total.
- FR-04: The system must follow the due date of a statement edited after the reminder was
  scheduled, creating the reminder for the new date.

## Non-Functional Requirements
- NFR-01: The reminder must be created no later than 15 minutes after 09:00 of its day, in the
  user's time zone, while the worker runs; after the worker was stopped, the first pass after
  09:00 must create the reminders of the days missed, up to the due date.
- NFR-02: The reminder job must be idempotent: running it any number of times for the same
  statement and due date must produce 0 duplicate reminders, including two runs at the same time.

## Acceptance Criteria
- AC-01 (FR-01): WHEN a statement is due on 2026-11-05 and the card has 3 reminder days, THE
  system SHALL create its reminder on 2026-11-02.
- AC-02 (FR-02): WHEN a user sets 7 reminder days on a card, THE system SHALL persist them and
  show them on the card.
- AC-03 (FR-02): IF a user sets reminder days below 0 or above 30 or not a whole number, THEN THE
  system SHALL reject it.
- AC-04 (FR-03): WHEN the reminder day of a statement arrives and its payments already cover its
  total, THE system SHALL create no reminder.
- AC-05 (FR-04): WHEN a user moves the due date of an open statement from 2026-11-05 to
  2026-11-10 with 3 reminder days, THE system SHALL create its reminder on 2026-11-07 and none for
  2026-11-02 that was not yet created.
- AC-06 (NFR-02): WHEN the job runs twice for the same statement and due date, one after the other
  or at the same time, THE system SHALL have created exactly one reminder.
- AC-07 (NFR-01): WHEN the worker starts after 09:00 of the reminder day, THE system SHALL create
  the reminder in its first pass, and WHEN the due date has already passed, THE system SHALL
  create none.
- AC-08 (FR-01): THE reminder text SHALL name the card and the due date, in the language of the
  user, and SHALL contain no amount and no account name.
- AC-09 (FR-01): WHEN a card is deleted, THE system SHALL create no reminder for its statements.

## Out of Scope
- Cards, linked accounts and statement cycles, which define the due dates (DISC-001-10a).
- Card expenses (DISC-001-10b), installment purchases and totals (DISC-001-10c).
- Statement payments and payment status (DISC-001-10d).
- Automatic debit (DISC-001-10e).
- Push delivery of the reminder (DISC-001-08d); this ticket creates the notice that push will
  carry.
- Reminders by email or by any channel other than the in-app notices.
- A reminder per statement at more than one lead time.

## Risks and Mitigations
- **A statement's due date changes after the reminder was scheduled** → reminders are not
  scheduled in advance: the job reads the current due date on each pass, and the notice is unique
  per statement and due date, so a moved date creates its own reminder (FR-04, AC-05).
- **A reminder for a statement the user already paid** → the job checks the recorded payments on
  the day (FR-03, AC-04).
- **Reminders leak financial data** → the text carries the card name and the day only (AC-08).
- **The notices store only recurring-payment kinds** → a new notice kind is added by a migration
  that extends the kind check, decided in PLAN.

## Dependencies
- PRD 08 (Recurring Payments & Reminders), DISC-001-08b and 08c — the worker, the job pattern and
  the notices (FR-01); merged.
- DISC-001-10a (Cards, Linked Accounts and Statement Cycles) — the statements and their due dates
  (FR-01, FR-04).
- DISC-001-10d (Statement Payments and Status) — the payments that tell whether a statement is
  paid (FR-03).
- PRD 01 (Identity & Access) — the user's time zone (PRD 01, FR-24) and language, used to compute
  the day and write the text (FR-01).

## Decision Log
- 2026-09-25: Design reviewed against Money Manager (Realbyte) and Argentine bank documentation:
  statement reminders via PRD 08 (original Decision Log).
- 2026-10-06: Parent PRD split into DISC-001-10a to 10f by user decision.
- 2026-10-06: Blocked by PRD 08, which is not built; it starts when PRD 08 is merged.
- 2026-10-10: PRD 08 is merged. Channel decided as the in-app notices of DISC-001-08c, reminder
  days stored per card, no reminder for a paid or empty statement, the job reads the current due
  date on every pass. FR-02 to FR-04, NFR-01, NFR-02 and AC-02 to AC-09 added; to ratify with the
  owner at approval.

# PRD DISC-001-10f: Statement Due-Date Reminders

| Field | Value |
|-------|-------|
| Ticket | DISC-001-10f |
| Tracker | none |
| Date | 2026-10-06 |
| PRD loops | 0 |
| Loops since last human decision | 0 |

## Context and Problem
Sixth of six sub-tickets of Credit Cards: Statements & Installments (parent index:
`prd-DISC-001-10.md`). A user who pays the card by hand needs to be reminded before each
statement's due date. The reminder uses the channels and scheduling of PRD 08 (Recurring Payments
& Reminders), which is not built, so this ticket is blocked until PRD 08 is merged. Split from
`prd-DISC-001-10.md` (2026-10-06, user decision). Requirement IDs were renumbered; the parent
index maps every original ID to its new one.

## Goals
- Remind the user of each statement's due date, a configurable number of days before.

## Functional Requirements
- FR-01: The system must send a reminder of each statement's due date, through the channels of
  PRD 08, a configurable number of days before (0 to 30, default 3).

## Non-Functional Requirements
None. The original PRD set no non-functional requirement for the reminder, and this ticket stores no
money, so the money rule (NFR-01) of the other sub-tickets does not apply.

## Acceptance Criteria
- AC-01 (FR-01): WHEN a statement is due on 2026-11-05 and the card has 3 reminder days, THE
  system SHALL send its reminder on 2026-11-02.

## Out of Scope
- Cards, linked accounts and statement cycles, which define the due dates (DISC-001-10a).
- Card expenses (DISC-001-10b), installment purchases and totals (DISC-001-10c).
- Statement payments and payment status (DISC-001-10d).
- Automatic debit (DISC-001-10e).
- The reminder channels and their scheduling (PRD 08).

## Risks and Mitigations
- **PRD 08 is not built** → this ticket stays blocked until PRD 08 is merged; the channels are a
  pending decision of the parent index.
- **A statement's due date changes after the reminder is scheduled** → the due date is editable
  per open statement (DISC-001-10a, FR-05); how the reminder follows it is decided in this
  ticket's PLAN.

## Dependencies
- PRD 08 (Recurring Payments & Reminders) — reminder channels and scheduling (FR-01); not built,
  so this ticket is blocked.
- DISC-001-10a (Cards, Linked Accounts and Statement Cycles) — the statements and their due dates
  (FR-01).
- PRD 01 (Identity & Access) — the user's time zone (PRD 01, FR-24), used to compute the day of the reminder (FR-01).

## Decision Log
- 2026-09-25: Design reviewed against Money Manager (Realbyte) and Argentine bank documentation:
  statement reminders via PRD 08 (original Decision Log).
- 2026-10-06: Parent PRD split into DISC-001-10a to 10f by user decision.
- 2026-10-06: Blocked by PRD 08, which is not built; it starts when PRD 08 is merged.

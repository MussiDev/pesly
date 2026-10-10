# PRD DISC-001-10a: Cards, Linked Accounts and Statement Cycles

| Field | Value |
|-------|-------|
| Ticket | DISC-001-10a |
| Tracker | none |
| Date | 2026-10-06 |
| PRD loops | 0 |
| Loops since last human decision | 0 |

## Context and Problem
First of six sub-tickets of Credit Cards: Statements & Installments (parent index:
`prd-DISC-001-10.md`). In Argentina the credit card is the main payment method, and it works in a
way a plain account cannot model: purchases are grouped into monthly statements by a closing date
and paid by a due date, and a card is billed in two currencies (ARS and USD). PRD 02 declared the
credit card account type and left its behavior to this PRD. This ticket creates the card, its two
linked accounts (so "one currency per account" from PRD 02 still holds) and its statement cycles
with editable closing and due dates. Assigning purchases to statements is DISC-001-10b;
installments, totals, payments, automatic debit and reminders come in the next sub-tickets. Split
from `prd-DISC-001-10.md` (2026-10-06, user decision). Requirement IDs were renumbered; the parent
index maps every original ID to its new one.

## Goals
- Model each card with statement cycles: closing date and due date, editable per statement.
- Handle ARS and USD balances of the same card without breaking "one currency per account"
  (PRD 02): two linked accounts per card.

## Functional Requirements
- FR-01: The system must allow a user to create a credit card with a name, a default closing day
  of the month and a default due day of the month.
- FR-02: The system must create, for every new credit card, two linked accounts of type credit
  card (PRD 02): one in ARS and one in USD, named "<card name> ARS" and "<card name> USD".
- FR-03: The system must create for every card one statement per monthly cycle, with a closing
  date on the card's default closing day and a due date on the first occurrence of the card's
  default due day after that closing date.
- FR-04: The system must use the last day of the month when a card's default closing or due day
  does not exist in that month (for example the 31st in February).
- FR-05: The system must allow a user to change the closing date and the due date of a statement
  that is not yet closed.
- FR-06: The system must allow a user to change the default closing and due days of a card, with
  effect on statements not yet closed.
- FR-07: The system must consider a statement closed once its closing date has ended in the
  user's time zone (PRD 01, FR-24).
- FR-08: The system must let a user read, edit and delete only their own cards and statements.

## Non-Functional Requirements
- NFR-01: Amounts must be stored as 64-bit integers in minor units, with 0 floating-point columns
  or fields for money (concept decision).

## Acceptance Criteria
- AC-01 (FR-01): WHEN a user creates a card "Visa" with closing day 24 and due day 5, THE system
  SHALL store it and show it in the card list.
- AC-02 (FR-01): IF a user creates a card with a closing or due day outside 1 to 31, THEN THE
  system SHALL reject it.
- AC-03 (FR-02): WHEN a card "Visa" is created, THE system SHALL create the credit card accounts
  "Visa ARS" in ARS and "Visa USD" in USD, linked to it.
- AC-04 (FR-03): WHEN a card with closing day 24 and due day 5 has its October 2026 cycle created,
  THE system SHALL set its closing date to 2026-10-24 and its due date to 2026-11-05.
- AC-05 (FR-04): WHEN a card has closing day 31, THE system SHALL set the closing date of its
  February 2027 statement to 2027-02-28.
- AC-06 (FR-05): WHEN a user moves the closing date of an open statement from 2026-10-24 to
  2026-10-26, THE system SHALL persist it.
- AC-07 (FR-05): IF a user tries to change the dates of a closed statement, THEN THE system SHALL
  reject it.
- AC-08 (FR-06): WHEN a user changes a card's default closing day from 24 to 20, THE system SHALL
  use day 20 for statements not yet closed and leave closed statements unchanged.
- AC-09 (FR-07): WHEN the closing date 2026-10-24 ends in the user's time zone, THE system SHALL
  mark that statement as closed.
- AC-10 (FR-08): IF a user requests to read, edit or delete a card or statement owned by another
  user, THEN THE system SHALL answer 404 Not Found and leave it unchanged.
- AC-11 (FR-08): WHEN a user opens their card list, THE system SHALL show only their own cards.

## Out of Scope
- Expenses recorded on a card, their account choice and their assignment to statements, including
  reassigning purchases when a closing date moves (DISC-001-10b).
- Installment purchases, statement totals and pending debt (DISC-001-10c).
- Statement payments and payment status (DISC-001-10d).
- Automatic debit (DISC-001-10e).
- Statement due-date reminders (DISC-001-10f).
- Ownership of installment purchases (DISC-001-10c).
- Credit limit and available credit.
- Additional cards (extensiones) and cards shared between users.
- Importing card statements or connecting to banks (no credentials are stored, concept decision).

## Risks and Mitigations
- **Banks move closing and due dates around holidays** → dates editable per open statement
  (FR-05).
- **The migration collides with another branch's** → this ticket is the first of the PRD to add a
  database migration; its number is reserved as 0019, and its journal `when` must exceed the
  maximum `when` on `main` at merge time, or a database that already ran a newer migration skips
  it silently (same rule recorded for DISC-001-03c and 03d in `prd-DISC-001-03.md`).
- **A month without the configured day** → the last day of the month is used (FR-04, AC-05).

## Dependencies
- PRD 01 (Identity & Access) — user time zone (FR-07) and access control (FR-08); merged.
- PRD 02 (Accounts & Categories) — the credit card account type behind the linked accounts
  (FR-02); merged.
- PRD 03 (Movements & Exchange Rates) — merged; no requirement of this ticket reads it directly,
  and DISC-001-10b builds on it.
- Database migration: number 0019 is reserved for this ticket; its journal `when` must be greater
  than the maximum on `main` when it merges.

## Decision Log
- 2026-09-25: Credit cards modeled with statement cycles and installments in their own PRD
  (concept; original `prd-DISC-001-10.md`).
- 2026-09-25: Two linked accounts per card (ARS and USD), keeping "one currency per account" from
  PRD 02 (original Decision Log).
- 2026-09-25: Design reviewed against Money Manager (Realbyte) and Argentine bank documentation:
  closing/due dates editable per statement (original Decision Log).
- 2026-09-25: User approved that nonexistent days fall on the last day of the month (original
  Decision Log).
- 2026-10-06: Parent PRD split into DISC-001-10a to 10f by user decision.
- 2026-10-06: The original AC-06 is divided: persisting the new closing date is AC-06 here, and
  reassigning purchases is DISC-001-10b. Listed in the parent index.

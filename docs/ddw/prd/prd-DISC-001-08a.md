# PRD DISC-001-08a: Recurring Payments and Occurrences

| Field | Value |
|-------|-------|
| Ticket | DISC-001-08a |
| Tracker | none |
| Date | 2026-10-09 |
| PRD loops | 0 |
| Loops since last human decision | 0 |

## Context and Problem
First of four sub-tickets of Recurring Payments & Reminders (parent: `prd-DISC-001-08.md`, split
2026-10-09). Users need to define a payment that repeats (rent, internet, a subscription) once and
see what is coming. This ticket delivers the recurring payment itself, the computation of its due
dates in the user's time zone, the occurrences it produces, and the manual flow for
confirmation-mode payments (confirm or skip). It does not run any background job: occurrences are
materialized idempotently when the user reads them, through a use case the later scheduler
(DISC-001-08b) will call as well. Automatic recording, reminders, in-app notices and push are
DISC-001-08b, 08c and 08d. Requirement IDs are renumbered; the table in the parent maps them.

## Goals
- Create, edit, pause, resume and delete recurring payments (weekly, monthly, yearly).
- Produce occurrences with correct due dates, including short months.
- Let the user confirm or skip pending occurrences and see overdue and upcoming ones.

## Functional Requirements
- FR-01: The system must allow a user to create a recurring payment with a name, an amount, one
  of their accounts, an expense category, a frequency, a start date, an optional end date and a
  mode (automatic or confirmation). *(parent FR-01)*
- FR-02: The system must offer exactly these frequencies: weekly (on a weekday), monthly (on a
  day of the month) and yearly (on a date). *(parent FR-02)*
- FR-03: The system must schedule a monthly occurrence whose day does not exist in a month on the
  last day of that month. *(parent FR-03)*
- FR-04: The system must create a pending occurrence for each due date of a recurring payment in
  confirmation mode that has arrived, without recording any expense, and must create each
  occurrence once. *(parent FR-05, NFR-04)*
- FR-05: The system must allow a user to confirm a pending occurrence, with the amount and date
  prefilled and editable, and must then record the expense on the payment's account and category
  through the movements module. *(parent FR-06)*
- FR-06: The system must allow a user to skip a pending occurrence without recording any expense.
  *(parent FR-07)*
- FR-07: The system must show a pending occurrence whose due date has passed as overdue until it is
  confirmed or skipped. *(parent FR-08)*
- FR-08: The system must list the occurrences of the user's recurring payments due in the next 30
  days, ordered by due date. *(parent FR-17)*
- FR-09: The system must allow a user to edit a recurring payment, with effect on occurrences not
  yet confirmed or skipped. *(parent FR-18)*
- FR-10: The system must allow a user to pause a recurring payment and to resume it, creating no
  occurrences while it is paused and scheduling from the resume date onward after resuming.
  *(parent FR-19, FR-23)*
- FR-11: The system must allow a user to delete a recurring payment, removing its pending and
  future occurrences and keeping the expenses already recorded. *(parent FR-20)*
- FR-12: The system must compute due dates in the user's time zone. *(parent FR-21)*
- FR-13: The system must let a user read, edit and delete only their own recurring payments and
  occurrences. *(parent FR-22)*
- FR-14: The system must show recurring payments, their occurrences and every message of this
  feature in the user's interface language, Spanish or English, with no string outside the
  catalogs. *(parent FR-24, PRD 01 FR-26)*

## Non-Functional Requirements
- NFR-01: Amounts must be stored as 64-bit integers in minor units, with 0 floating-point columns
  or fields for money.
- NFR-02: The upcoming payments list must answer in < 300 ms at p95 for a user with 100 recurring
  payments, measured server-side.
- NFR-03: Materializing occurrences must be idempotent: calling it any number of times for the
  same moment must produce 0 duplicate occurrences, and 2 concurrent calls must produce the same
  result as one.
- NFR-04: Every recurring payment endpoint must validate params, query and body with shared Zod
  schemas and reject invalid input with a 4xx and 0 changes to stored data.

## Acceptance Criteria
- AC-01 (FR-01): WHEN a user creates a recurring payment "Rent", 350,000.00 ARS, monthly on day 5,
  confirmation mode, THE system SHALL store it and show its next occurrence.
- AC-02 (FR-01): IF a user creates a recurring payment with an amount of 0 or less, a name that is
  empty, an end date before its start date, or an account or category that is not theirs, THEN
  THE system SHALL reject it and store nothing.
- AC-03 (FR-02): WHEN a user opens the frequency selector, THE system SHALL offer exactly weekly,
  monthly and yearly.
- AC-04 (FR-03): WHEN a monthly recurring payment is set for day 31, THE system SHALL schedule its
  February 2027 occurrence on 2027-02-28.
- AC-05 (FR-03): WHEN a yearly recurring payment is set for 29 February, THE system SHALL schedule
  its 2027 occurrence on 2027-02-28.
- AC-06 (FR-04): WHEN the due date of a confirmation-mode payment has arrived and the user opens
  upcoming payments twice, THE system SHALL hold exactly one pending occurrence for that date and
  no account balance SHALL change.
- AC-07 (FR-05): WHEN a user confirms a pending occurrence after changing the amount from
  45,000.00 to 48,250.00 ARS, THE system SHALL record an expense of 48,250.00 ARS and mark the
  occurrence as confirmed.
- AC-08 (FR-05): IF a user confirms an occurrence that is already confirmed or skipped, or whose
  account is archived, THEN THE system SHALL reject it and record no expense.
- AC-09 (FR-06): WHEN a user skips a pending occurrence, THE system SHALL mark it as skipped and
  record no expense.
- AC-10 (FR-07): WHILE a pending occurrence is past its due date and not confirmed or skipped, THE
  system SHALL show it as overdue.
- AC-11 (FR-08): WHEN a user opens upcoming payments, THE system SHALL list the occurrences due in
  the next 30 days ordered by due date, and none outside that window other than overdue ones.
- AC-12 (FR-09): WHEN a user changes the amount of a recurring payment, THE system SHALL use the
  new amount for occurrences not yet confirmed or skipped, and leave recorded expenses unchanged.
- AC-13 (FR-10): WHILE a recurring payment is paused, THE system SHALL create no occurrences for
  it.
- AC-14 (FR-10): WHEN a user resumes a paused recurring payment, THE system SHALL schedule its next
  occurrence from the resume date onward and create none for the dates missed while paused.
- AC-15 (FR-11): WHEN a user deletes a recurring payment, THE system SHALL remove its pending and
  future occurrences and keep the expenses already recorded.
- AC-16 (FR-12): WHEN a payment is due on the first day of a month in `Asia/Tokyo` and the server
  clock is still on the previous day in UTC, THE system SHALL treat it as due that day.
- AC-17 (FR-13): IF a user requests to read, edit, delete, confirm or skip a recurring payment or
  occurrence owned by another user, THEN THE system SHALL answer 404 Not Found and leave it
  unchanged.
- AC-18 (FR-13): WHEN a user opens upcoming payments, THE system SHALL show only their own
  occurrences.
- AC-19 (FR-14): WHEN a user whose interface language is Spanish opens upcoming payments, THE
  system SHALL show every label, status and message in Spanish.

## Out of Scope
- Recording the expense of automatic-mode payments on their due date (DISC-001-08b).
- The scheduled job and its timing guarantees (DISC-001-08b).
- Reminders, in-app notices and reminder days (DISC-001-08c).
- Push notifications and the "Enable notifications" control (DISC-001-08d).
- Email or SMS reminders, recurring incomes and transfers, recurring group expenses, frequencies
  other than weekly, monthly and yearly, automatic detection of recurring payments, paying bills
  from the app and credit card statement reminders.

## Risks and Mitigations
- **Duplicate occurrences from concurrent reads** → unique key on payment and due date, with
  insert-or-ignore (NFR-03).
- **Wrong day near midnight or on short months** → due dates are computed in the user's time zone
  with explicit tests for month ends and leap years (AC-04, AC-05, AC-16).
- **A long-paused or very old payment generating a flood of occurrences** → resume skips missed
  dates (AC-14) and materialization starts from the later of the start date and the last created
  occurrence.
- **Edit changes history** → recorded expenses are movements and never change (AC-12).

## Dependencies
- PRD 01 (Identity & Access) — user time zone and interface language, ownership.
- PRD 02 (Accounts & Categories) — accounts and expense categories.
- PRD 03 (Movements & Exchange Rates) — recording the expense and its rate.

## Decision Log
- 2026-10-09: PRD 08 split into 08a core and occurrences, 08b scheduler and automatic recording,
  08c reminders and in-app notices, 08d push. Chosen by the orchestrator under the user's
  go-ahead to start PRD 08.
- 2026-10-09: In 08a occurrences are materialized on read by an idempotent use case, so no job is
  needed yet; 08b calls the same use case from the scheduler.

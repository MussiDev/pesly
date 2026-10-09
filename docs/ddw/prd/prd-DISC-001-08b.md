# PRD DISC-001-08b: Scheduler and Automatic Recording

| Field | Value |
|-------|-------|
| Ticket | DISC-001-08b |
| Tracker | none |
| Date | 2026-10-09 |
| PRD loops | 0 |
| Loops since last human decision | 0 |

## Context and Problem
Second of four sub-tickets of Recurring Payments & Reminders (parent: `prd-DISC-001-08.md`;
previous: `prd-DISC-001-08a.md`, merged in PR #40). DISC-001-08a stores recurring payments and
produces occurrences, but an automatic-mode payment still records nothing: the user has to
remember it. This ticket adds the scheduled job that records the expense of each due occurrence of
an automatic payment on its due date, in the user's time zone, and makes that recording safe to
repeat: the job can run many times, in several processes, or stop halfway, and no occurrence
becomes two expenses (this closes the crash window accepted as R-08 in the 08a threat model).
Notifying the user (reminders, in-app notices, the "could not record" notice) is DISC-001-08c;
push is DISC-001-08d. Requirement IDs are renumbered; the parent maps them.

## Goals
- Record the expense of every automatic occurrence on its due date without the user opening the app.
- Guarantee at most one expense per occurrence, whatever happens to the job.
- Keep the job fast enough to grow to 10,000 recurring payments.

## Functional Requirements
- FR-01: The system must run a scheduled job that records, for each active automatic recurring
  payment whose occurrence is due, an expense with the payment's amount, account and category
  dated on the due date, and must mark that occurrence as resolved and linked to the expense.
  *(parent FR-04)*
- FR-02: The system must treat an occurrence as due once 06:00 of its due date has arrived in the
  time zone of the payment's owner, regardless of the server's time zone. *(parent FR-21)*
- FR-03: The system must leave an automatic occurrence pending, with no expense recorded, when the
  expense cannot be recorded (for example the account is archived), so that the user can confirm or
  skip it as in DISC-001-08a. *(parent FR-04)*
- FR-04: The system must record an automatic occurrence whose due date passed while the job was
  not running the next time the job runs, dated on its due date, provided its due date is on or
  after the day the payment was created or resumed. *(parent FR-04)*
- FR-05: The system must create as pending, and not record, the occurrences of an automatic
  payment whose due date is before the day the payment was created or resumed, so that the user
  confirms or skips them. *(parent FR-04)*
- FR-06: The system must record the expense of an occurrence at most once, even when the job runs
  repeatedly, runs in several processes at the same time, or stops after recording the expense and
  before marking the occurrence. *(parent NFR-04)*
- FR-07: The system must record no expense for a paused or ended recurring payment, nor for a
  deleted one. *(parent FR-19)*
- FR-08: The system must keep processing the other payments when recording the expense of one
  payment fails, and must report the failure in the log without amounts or names. *(parent NFR-04)*
- FR-09: The system must compute the due times of occurrences not yet processed in the owner's new
  time zone after the owner changes it. *(parent FR-21)*

## Non-Functional Requirements
- NFR-01: The expense of an automatic occurrence must be recorded between 06:00 and 06:15 of its due
  date in the owner's time zone while the job is running, measured as the interval between the
  local 06:00 and the movement's creation time.
- NFR-02: Running the job any number of times for the same day, and running 2 job processes at the
  same time, must produce 0 duplicate expenses and 0 duplicate occurrences.
- NFR-03: One job run over 10,000 active recurring payments, of which 1,000 are due, must finish in
  < 60 s on the test database.
- NFR-04: Amounts must stay 64-bit integers in minor units, with 0 floating-point values for money
  in the job, its storage and its tests.
- NFR-05: The job must keep 0 state in process memory between runs, so that stopping a process and
  starting another one loses 0 occurrences.

## Acceptance Criteria
- AC-01 (FR-01): WHEN the due date of an occurrence of the active automatic payment "Rent",
  350,000.00 ARS, arrives and the job runs, THE system SHALL record one expense of 350,000.00 ARS on
  the payment's account and category dated on the due date, and SHALL mark the occurrence resolved
  with that expense linked.
- AC-02 (FR-02): WHEN an automatic occurrence is due on 2026-10-05 for a user whose time zone is
  `Europe/Madrid` and the job runs at 03:59 UTC on 2026-10-05, THE system SHALL record nothing, and
  WHEN the job runs at 04:00 UTC, THE system SHALL record the expense.
- AC-03 (FR-03): IF the account of an automatic payment is archived when the job runs, THEN THE
  system SHALL record no expense, SHALL leave the occurrence pending, and SHALL list it as pending
  or overdue in upcoming payments.
- AC-04 (FR-03): WHEN the user confirms an occurrence that the job left pending, THE system SHALL
  record the expense exactly once and mark the occurrence confirmed.
- AC-05 (FR-04): WHEN the job did not run from 2026-10-05 to 2026-10-07 and a daily automatic
  payment created on 2026-10-01 is due each day, THE system SHALL record three expenses on the next
  run, dated 2026-10-05, 2026-10-06 and 2026-10-07.
- AC-06 (FR-05): WHEN a user creates on 2026-10-09 a monthly automatic payment on day 1 with a start
  date of 2026-09-01, THE system SHALL create the occurrences of 2026-09-01 and 2026-10-01 as
  pending and SHALL record no expense for them.
- AC-07 (FR-05): WHEN a user resumes on 2026-10-09 an automatic payment paused since 2026-09-20,
  THE system SHALL record no expense for the due dates missed while it was paused.
- AC-08 (FR-06): WHEN the job runs three times in a row for the same day, THE system SHALL hold
  exactly one expense for each due occurrence.
- AC-09 (FR-06): WHEN two job processes run at the same moment over the same due occurrence, THE
  system SHALL hold exactly one expense for it.
- AC-10 (FR-06): IF the job stops after the expense of an occurrence is recorded and before the
  occurrence is marked, THEN THE system SHALL on the next run mark the occurrence resolved with the
  existing expense linked and SHALL record no second expense.
- AC-11 (FR-07): WHILE an automatic payment is paused, past its end date or deleted, THE system
  SHALL record no expense for it when the job runs.
- AC-12 (FR-08): IF the expense of one payment fails to record when the job runs over three due
  payments, THEN THE system SHALL record the expenses of the other two, SHALL log the failure with
  identifiers only, and SHALL retry the failed one on the next run.
- AC-13 (FR-09): WHEN a user whose time zone is `America/Argentina/Buenos_Aires` changes it to
  `Asia/Tokyo` on 2026-10-04 while an automatic occurrence is due on 2026-10-05, THE system SHALL
  record it once 06:00 of 2026-10-05 has arrived in Tokyo, at 21:00 UTC on 2026-10-04.
- AC-14 (FR-01): WHEN a user opens upcoming payments after the job recorded an automatic
  occurrence, THE system SHALL not list that occurrence, and SHALL show the expense in movements.
- AC-15 (NFR-01): WHEN the job runs every minute and an occurrence is due at 06:00 local, THE
  system SHALL record its expense between 06:00 and 06:15 local.
- AC-16 (NFR-03): WHEN the job runs over 10,000 active payments with 1,000 due, THE system SHALL
  finish in < 60 s.

## Out of Scope
- Reminders before the due date, reminder days and in-app notices, including the notice that an
  automatic expense was recorded or could not be recorded (DISC-001-08c).
- Push notifications and the "Enable notifications" control (DISC-001-08d).
- Automatic debit of credit card statements, which reuses this scheduler (DISC-001-10e).
- A user interface to see job runs, retry them by hand or change the schedule time.
- Changing the confirmation-mode flow of DISC-001-08a.
- Payments in USD with a manual exchange rate, and recording at a time other than 06:00 local.

## Risks and Mitigations
- **Duplicate expenses from repeated or parallel runs, or a crash between two writes** → the expense
  carries a key unique per occurrence, so a second attempt finds the first one (FR-06, AC-08 to AC-10).
- **Backdated expenses the user never saw** → occurrences before creation or resumption stay
  pending for the user to confirm (FR-05), decided with the project owner on 2026-10-09.
- **No stored exchange rate** → the automatic rate throws `RATE_REQUIRED` when none is stored; the
  occurrence stays pending and is retried on the next run (FR-03, FR-08).
- **One bad payment blocking the rest** → failures are isolated per payment (FR-08).
- **Slow job as users grow** → batch reads and a measured 10,000-payment benchmark (NFR-03).

## Dependencies
- DISC-001-08a (merged) — recurring payments, occurrences, materialization and the expense recorder
  port.
- PRD 01 (Identity & Access) — owner time zone; stateless processes (PRD 01 NFR-09).
- PRD 02 (Accounts & Categories) — account state (archived) and categories.
- PRD 03 (Movements & Exchange Rates) — recording the expense and its frozen exchange rate.
- DISC-001-08c — will consume the "could not record" outcome of this job to notify the user.

## Decision Log
- 2026-10-09: Past due dates, decided by the project owner: those that fall while the payment exists
  and the job was down are recorded on the next run (catch-up); those before the day the payment was
  created or resumed stay pending for the user to confirm.
- 2026-10-09: The job is a recurring task of the existing worker process, not a new service; this is
  a design detail confirmed in PLAN.
- 2026-10-09: This ticket stays one deliverable, with 16 acceptance criteria over the recurring and
  movements modules and the worker, because the pieces are not shippable apart (a job without
  idempotency would duplicate expenses).

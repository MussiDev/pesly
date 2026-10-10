# PRD DISC-001-08c: Reminders and In-App Notices

| Field | Value |
|-------|-------|
| Ticket | DISC-001-08c |
| Tracker | none |
| Date | 2026-10-10 |
| PRD loops | 0 |
| Loops since last human decision | 0 |

## Context and Problem
Third of four sub-tickets of Recurring Payments & Reminders (parent: `prd-DISC-001-08.md`;
previous: `prd-DISC-001-08a.md` merged in PR #40 and `prd-DISC-001-08b.md` in PR #42). Recurring
payments are stored and their automatic occurrences are recorded by the scheduled job, but the user
is told nothing: not that a payment is coming, not that an expense was recorded for them, and not
that an automatic occurrence could not be recorded and is waiting for them. This ticket adds the
reminder days of each payment, the notices the job creates (reminder, recorded, could not be
recorded) and the in-app screen where the user reads them. Delivering the same notices as push
notifications is DISC-001-08d; this ticket stores each notice as a row that 08d will read.
Requirement IDs are renumbered; the parent maps them.

## Goals
- Remind the user of each occurrence a configurable number of days before its due date.
- Tell the user when an automatic expense was recorded and when one could not be.
- Give the user one place in the app to read their notices.

## Functional Requirements
- FR-01: The system must allow a user to set, per recurring payment, how many days before the due
  date to be reminded, from 0 to 30, with a default of 3, when creating and when editing the
  payment. *(parent FR-09)*
- FR-02: The system must create one reminder notice for each occurrence of an active recurring
  payment, at 09:00 of the day that is the payment's reminder days before the due date, in the time
  zone of the payment's owner, regardless of the server's time zone. *(parent FR-10, FR-21)*
- FR-03: The system must create a reminder whose time passed while the job was not running the next
  time the job runs, as long as the due date has not passed, and must create no reminder for a
  reminder day before the day the payment was created or resumed. *(parent FR-10)*
- FR-04: The system must create no reminder for a paused, ended or deleted recurring payment, nor
  for an occurrence that is already recorded, confirmed or skipped. *(parent FR-19)*
- FR-05: The system must create a notice that an expense was recorded when the job records the
  expense of an automatic occurrence. *(parent FR-11)*
- FR-06: The system must create a notice that an automatic occurrence was not recorded and is
  waiting for the user when the job leaves it pending because its expense cannot be recorded, once
  for that occurrence however many times the job retries it. *(parent AC-06)*
- FR-07: The system must write the text of every notice in the owner's interface language, naming
  the payment and the day it is due, and must put no amount and no account name in it.
  *(parent FR-24, FR-16)*
- FR-08: The system must list the user's own notices, newest first, in pages, with the count of
  unread ones. *(parent FR-12)*
- FR-09: The system must allow a user to mark one notice, or all their notices, as read.
  *(parent FR-12)*
- FR-10: The system must let a user read and change only their own notices. *(parent FR-22)*
- FR-11: The system must create at most one notice of each kind for the same occurrence of the same
  payment. *(parent NFR-04)*
- FR-12: The system must keep the recorded expense and keep processing the other payments when
  creating a notice fails, and must report the failure in the log without amounts or names.
  *(parent NFR-04)*
- FR-13: The system must compute the reminder times of occurrences not yet processed in the owner's
  new time zone after the owner changes it. *(parent FR-21)*
- FR-14: The system must show the user, in the web app, the number of unread notices, the list of
  notices with a control to mark them read, and a field for the reminder days in the recurring
  payment form. *(parent FR-12, FR-09)*
- FR-15: The system must delete the notices of a user when the user deletes their account.
  *(parent FR-22)*

## Non-Functional Requirements
- NFR-01: A reminder must be created between 09:00 and 09:15 of its day in the owner's time zone
  while the job is running, measured as the interval between the local 09:00 and the notice's
  creation time.
- NFR-02: Running the job any number of times for the same day, and running 2 job processes at the
  same time, must produce 0 duplicate notices.
- NFR-03: One job run over 10,000 active recurring payments, of which 1,000 have a reminder due,
  must finish in < 60 s on the test database.
- NFR-04: Listing notices must answer in < 300 ms at p95 for a user with 1,000 notices, measured
  server-side.
- NFR-05: 0 notices must contain an amount or an account name, in either interface language.

## Acceptance Criteria
- AC-01 (FR-01): WHEN a user creates a recurring payment without setting reminder days, THE system
  SHALL store 3 days.
- AC-02 (FR-01): IF a user sets reminder days of -1 or 31, or a fractional value, THEN THE system
  SHALL reject the request and store nothing.
- AC-03 (FR-01): WHEN a user edits the reminder days of a payment from 3 to 0, THE system SHALL use
  0 for the reminders not yet created.
- AC-04 (FR-02): WHEN a payment due on 2026-10-10 has 3 reminder days, THE system SHALL create its
  reminder at 09:00 on 2026-10-07 in the owner's time zone and not before.
- AC-05 (FR-02): WHEN a payment due on 2026-10-05 has 0 reminder days and its owner's time zone is
  `Europe/Madrid`, THE system SHALL create its reminder at 09:00 Madrid time on 2026-10-05, which
  is 07:00 UTC, regardless of the server's time zone.
- AC-06 (FR-03): WHEN the job did not run on the reminder day and runs the next day, before the due
  date, THE system SHALL create the reminder on that run.
- AC-07 (FR-03): IF the due date has passed when the job runs, THEN THE system SHALL create no
  reminder for it.
- AC-08 (FR-03): WHEN a payment is created on 2026-10-09 for a due date of 2026-10-11 with 3 reminder
  days, THE system SHALL create no reminder for it, because the reminder day is before the day it
  was created.
- AC-09 (FR-04): WHILE a recurring payment is paused, THE system SHALL create no reminder for it.
- AC-10 (FR-04): IF an occurrence is already recorded, confirmed or skipped when its reminder time
  arrives, THEN THE system SHALL create no reminder for it.
- AC-11 (FR-04): WHEN a payment is deleted or has ended, THE system SHALL create no reminder for it.
- AC-12 (FR-05): WHEN the job records the expense of an automatic occurrence, THE system SHALL
  create a notice that the expense was recorded.
- AC-13 (FR-06): WHEN the job leaves an automatic occurrence pending because its account is
  archived, THE system SHALL create a notice that it is waiting for the user.
- AC-14 (FR-06): IF the job retries that occurrence 5 more times, THEN THE system SHALL still hold 1
  notice of that kind for it.
- AC-15 (FR-07): WHEN a reminder for "Luz" due tomorrow is created for a user whose interface
  language is Spanish, THE system SHALL store the text "Luz vence mañana".
- AC-16 (FR-07): WHEN a reminder for "Electricity" due tomorrow is created for a user whose
  interface language is English, THE system SHALL store the text "Electricity is due tomorrow".
- AC-17 (FR-07): WHEN a reminder is created for a payment of 350,000.00 ARS on an account named
  "Galicia", THE system SHALL store a text with neither the amount nor the account name.
- AC-18 (FR-08): WHEN a user lists their notices, THE system SHALL return them newest first, with a
  page of at most 50, a cursor for the next page and the count of unread notices.
- AC-19 (FR-08): IF a user asks for a page size over 50 or an invalid cursor, THEN THE system
  SHALL reject the request.
- AC-20 (FR-09): WHEN a user marks a notice as read, THE system SHALL keep it in the list as read
  and lower the unread count by 1.
- AC-21 (FR-09): WHEN a user marks all notices as read, THE system SHALL set the unread count to 0.
- AC-22 (FR-10): IF a user lists or marks as read a notice owned by another user, THEN THE system
  SHALL answer 404 Not Found and leave it unchanged.
- AC-23 (FR-11): WHEN the job runs 3 times in a row over the same reminder, THE system SHALL hold 1
  notice for it.
- AC-24 (FR-11): WHEN 2 job processes handle the same reminder at the same time, THE system SHALL
  hold 1 notice for it.
- AC-25 (FR-12): IF creating the notice of a recorded expense fails, THEN THE system SHALL keep the
  recorded expense, process the remaining payments and log the failure with ids only.
- AC-26 (FR-13): WHEN a user changes their time zone from `America/Argentina/Buenos_Aires` to
  `Asia/Tokyo`, THE system SHALL create the reminders not yet created at 09:00 Tokyo time.
- AC-27 (FR-14): WHEN a user has 3 unread notices, THE web app SHALL show the number 3 on the
  notices entry.
- AC-28 (FR-14): WHEN a user opens the notices screen and taps a notice, THE web app SHALL show it
  as read.
- AC-29 (FR-14): WHEN a user opens the recurring payment form, THE web app SHALL show the reminder
  days field with 3 prefilled for a new payment.
- AC-30 (FR-15): WHEN a user deletes their account, THE system SHALL delete all their notices.

## Out of Scope
- Push notifications, the "Enable notifications" control and the iPhone Home Screen explanation
  (DISC-001-08d).
- Email or SMS (decision 2026-09-25: push and in-app only).
- Budget alerts (PRD 06 owns them; it may reuse the notices table later).
- Deleting a single notice, and automatic deletion of old notices.
- Reminders for credit card statement due dates (PRD 10 decides).
- Per-user settings to turn reminders off.

## Risks and Mitigations
- **Notices pile up without limit** → accepted for now (no purge in scope); the list is paged and
  indexed (NFR-04), and a purge is a follow-up if volume shows it.
- **A reminder duplicated by two job processes** → a uniqueness rule on notice kind, payment and due
  date (FR-11, NFR-02).
- **A notice failure blocks recording** → notice creation is isolated from the expense (FR-12).
- **Financial data in notice text** → the text is built from the payment name and the day only
  (FR-07, NFR-05).
- **Reminder storm when a payment is created close to its due date** → no reminder before the day it
  was created or resumed (FR-03).

## Dependencies
- DISC-001-08a — recurring payments, occurrences, the reminder days column does not exist yet and is
  added here.
- DISC-001-08b — the scheduled job and its outcomes (recorded, left pending), the
  `auto_recording_from` day reused by FR-03.
- PRD 01 (Identity & Access) — owner time zone and interface language (FR-02, FR-07), account
  deletion (FR-15), ownership (FR-10).
- DISC-001-08d — will read the notices this ticket stores to send push.

## Decision Log
- 2026-10-10: Orchestrator, under the user's `minimal` autonomy: reminders before the day a payment
  was created or resumed are not sent (same day boundary as 08b decision B); reminders missed while
  the job was down are sent on the next run until the due date; notices carry no amounts or account
  names in either channel; no purge and no per-notice delete in this ticket. Ratify or change at PR
  review.

# PRD DISC-001-06d: Budget Alerts

| Field | Value |
|-------|-------|
| Ticket | DISC-001-06d |
| Tracker | none |
| Date | 2026-10-11 |
| PRD loops | 0 |
| Loops since last human decision | 0 |

## Context and Problem
Fourth of six sub-tickets of Savings Goals & Budgets (parent index: `prd-DISC-001-06.md`; the
sub-tickets are 06a goals API, 06b budgets core API, 06c budget spending and rollover, 06d budget
alerts, 06e goals screens and 06f budgets screens). 06b stores the thresholds of a budget (default 80
and 100 percent) and 06c returns the percentage of the budget used in a month, but nobody tells the
user when a threshold is crossed: they would have to open the budget to find out. This ticket makes the
system tell them. After a user saves an expense, the system works out whether the expense made a budget
cross one of its thresholds for the first time in the month and, if so, publishes an in-app notice
through the existing `notices` module (DISC-001-08c) within 5 seconds. The alert is state-based: it is
decided from the spending the user has at that moment, so a crossing that was missed once is caught by
the next expense. It adds one table, `budget_alert_marks`, that remembers which threshold of which
budget already alerted in which month. It adds no screen (06f), no push notification and no change to
the group write path (05b). Requirement IDs were renumbered for this sub-ticket; the original IDs of
the parent PRD are listed in the Decision Log.

## Goals
- Show an in-app alert the first time in a month that a budget's spending crosses each of its
  thresholds, and never repeat it in that month.
- Make the alert visible within 5 seconds of saving the expense that crosses the threshold.
- Never fail, and never slow down beyond a fixed bound, the saving of a movement because of an alert.
- Keep amounts and account names out of the alert text.

## Functional Requirements
- FR-01: The system must publish an in-app notice for a budget the first time in a month that the
  budget's spending reaches each of its thresholds, where the percentage used is the one 06c computes
  against the available amount (amount plus rollover).
- FR-02: The system must evaluate the budgets after the transaction of a saved expense commits,
  whether the expense is created or edited and through whichever path it was recorded (manual, device,
  recurring automatic recording or credit card installments), and must not evaluate after a deletion
  or after an income, a transfer or a currency exchange.
- FR-03: The system must publish a notice only for the current month in the user's time zone; an
  expense dated in a past or a future month must not publish one.
- FR-04: The system must publish at most one notice per threshold per budget per month, including when
  two movements are saved at the same time and when the spending falls below the threshold and crosses
  it again in the same month.
- FR-05: The system must write the notice text in the language of the user with the budget name and the
  threshold percentage only, never an amount and never an account name, within the notice text length
  limit of 300 characters.
- FR-06: The system must evaluate only the budgets of the owner of the saved expense and must not fail
  or roll back the saving of the movement when the evaluation fails; the failure is logged without a
  budget name or an amount.
- FR-07: The system must keep the record of the alerts already published when a budget is edited, so no
  threshold alerts twice in a month, and must remove that record when the budget is deleted.

## Non-Functional Requirements
- NFR-01: The alert must be visible in the notices list within 5 seconds of the response of the request
  that saved the crossing expense, measured server-side.
- NFR-02: The evaluation must add under 150 ms at p95 to the saving of an expense for a user with 50
  budgets that cover the category of the expense and 100,000 movements, measured server-side.
- NFR-03: Money must be computed as 64-bit integers in minor units and the percentage with integer
  arithmetic, with 0 floating-point values anywhere in the feature.
- NFR-04: The feature must add 1 database migration, which is additive and has a rollback script, and
  0 new runtime dependencies.

## Acceptance Criteria
- AC-01 (FR-01): WHEN an expense makes the spending of a budget of 150,000.00 ARS cross 80% for the
  first time in the month, THE system SHALL publish an in-app notice for that budget that names the
  budget and 80%.
- AC-02 (FR-01): WHEN one expense takes a budget from 70% to 110% used, THE system SHALL publish two
  notices, one for the 80% threshold and one for the 100% threshold.
- AC-03 (FR-01): WHEN a budget has the thresholds 50 and 90 and an expense takes it to 55% used, THE
  system SHALL publish the notice for 50% and none for 90%.
- AC-04 (FR-01): WHEN a budget with rollover on has 150,000.00 ARS of amount, 20,000.00 ARS carried in
  and 136,000.00 ARS spent, THE system SHALL treat 80% as crossed against the available 170,000.00 ARS
  and SHALL NOT treat 100% as crossed.
- AC-05 (FR-01): WHEN a later expense in the same month keeps the spending above 80% without reaching a
  threshold that has no notice yet, THE system SHALL NOT publish another notice.
- AC-06 (FR-02): WHEN an expense edit raises the amount of a saved expense so the budget crosses a
  threshold, THE system SHALL publish the notice for that threshold.
- AC-07 (FR-02): WHEN an expense is recorded through the device path with a chosen id, through a
  recurring automatic recording or as a credit card installment, THE system SHALL publish the notice
  as for a manual expense.
- AC-08 (FR-02): IF a movement is deleted, or is an income, a transfer or a currency exchange, THEN THE
  system SHALL not evaluate any budget and SHALL publish no notice.
- AC-09 (FR-02): WHEN an earlier evaluation did not run and a later expense in the same category is
  saved while the spending is already above the threshold, THE system SHALL publish the notice that was
  missed.
- AC-10 (FR-03): IF an expense is dated in a month before the current month in the user's time zone,
  THEN THE system SHALL publish no notice, even when it makes a past month cross a threshold.
- AC-11 (FR-03): WHEN an expense occurs at 01:00 UTC on 1 November and the user's time zone is
  America/Argentina/Buenos_Aires, THE system SHALL evaluate it in October, the user's current month.
- AC-12 (FR-04): WHEN the spending falls below 80% because an expense is edited or deleted and then
  crosses 80% again in the same month, THE system SHALL NOT publish a second notice for 80%.
- AC-13 (FR-04): WHEN two expenses that each cross the same threshold of the same budget are saved at
  the same time, THE system SHALL publish exactly 1 notice for that threshold.
- AC-14 (FR-04): WHEN a new month starts and the spending of the budget crosses 80% again, THE system
  SHALL publish a new notice for that month.
- AC-15 (FR-05): WHEN a notice is published for a user whose language is Spanish, THE system SHALL write
  it in Spanish, and in English for a user whose language is English, with the budget name and the
  threshold percentage and no amount.
- AC-16 (FR-05): IF the name of a budget is longer than 80 characters, THEN THE system SHALL truncate it
  in the notice text and keep the text between 1 and 300 characters.
- AC-17 (FR-05): THE system SHALL NOT include in the text of a notice an amount, a currency figure, an
  account name or the name of a category.
- AC-18 (FR-06): IF the evaluation fails with an error or exceeds its time bound, THEN THE system SHALL
  keep the saved movement, answer the request as if no evaluation existed and write a log line with ids
  only.
- AC-19 (FR-06): IF another user has a budget over the same category, THEN THE system SHALL NOT evaluate
  that budget and SHALL NOT publish any notice to that user.
- AC-20 (FR-06): WHEN an expense of a group is recorded by the group write path, THE system SHALL
  evaluate nothing for that write.
- AC-21 (FR-07): WHEN the user lowers the amount of a budget in the middle of the month so the spending
  crosses a threshold, THE system SHALL publish the notice at the next evaluation and SHALL NOT publish
  again a threshold that already has a notice.
- AC-22 (FR-07): WHEN a budget is deleted, THE system SHALL remove its alert records, so a budget created
  afterwards alerts as new.
- AC-23 (NFR-01): WHEN an expense crosses a threshold, THE system SHALL make the notice readable in
  `GET /notices` within 5 seconds of the response of the saving request.
- AC-24 (NFR-02): WHEN an expense is saved by a user with 50 budgets covering its category and 100,000
  movements, THE system SHALL add under 150 ms at p95 to the saving request.
- AC-25 (NFR-03): WHEN the percentage used is compared with a threshold, THE system SHALL compute it
  with `bigint` division rounded down and no floating-point value.
- AC-26 (NFR-04): WHEN the migration of this ticket is applied and rolled back twice, THE system SHALL
  keep every other table unchanged and add 0 runtime dependencies to `package.json`.

## Out of Scope
- Alerts for group expenses: the group write path (05b) does not evaluate budgets; because the
  evaluation is state-based, the next personal expense in the category catches the crossing up (see the
  Risks).
- Push notifications: `AGENTS.md` forbids amounts and account names in push text, and the notices list
  is the only channel of this ticket.
- Web screens, the unread badge refresh and the display of alerts inside the budget screen (DISC-001-06f);
  the existing notices list already shows any notice text.
- Editing thresholds (06b) and evaluating when a budget is created or edited: an edit alerts at the next
  expense, not at the edit.
- A background worker that polls for crossings, which cannot meet 5 seconds (parent decision 2).
- Alerts for deleted expenses, income, transfers and currency exchanges.

## Risks and Mitigations
- **The alert is slower than 5 seconds or slows the movement** → the evaluation runs inline after the
  commit with a fixed time bound and reads only the budgets that cover the category of the expense,
  through the two aggregated queries of 06c; a benchmark covers NFR-02 (AC-24) and a measured test
  covers NFR-01 (AC-23).
- **The same threshold alerts twice under concurrent saves** → one record per (budget, month,
  threshold) enforced by a unique constraint, inserted with `ON CONFLICT DO NOTHING`, and the notice is
  published only for a newly inserted record, in the same transaction (AC-13).
- **A failing evaluation breaks the saving of a movement** → the evaluation is best effort: it runs
  after the commit, every error is logged with the logger and swallowed at one place only, and the
  response is unchanged (AC-18).
- **A group expense crosses a threshold and nobody is told** → the group write path is out of scope;
  the next personal expense in the category publishes the missed alert (AC-09); recorded as a
  limitation for the owner.
- **Alert text leaks money or private names** → the text is rendered by the amount-free
  `renderNoticeText`, which receives only the budget name and the threshold; a test scans the stored
  text (AC-17).
- **A user receives another user's alert** → every read and write uses the `AccessScope` of the owner of
  the saved expense; the marks and the notice share that owner id (AC-19).
- **A past month alerts when an old expense is back-dated** → only the current month in the user's time
  zone alerts (AC-10).
- **The migration number collides with another branch** → this ticket adds migration 0036, renumbered
  at merge, and its journal `when` must exceed the maximum `when` on `main` at merge time (same rule as
  DISC-001-05a and 06b).

## Dependencies
- DISC-001-06c (Budget Spending and Rollover) — the spending, available amount and percentage used per
  budget and month (FR-01, FR-03); on the base branch of this ticket.
- DISC-001-06b (Budgets Core API) — budgets, versions, covered categories and thresholds (FR-01,
  FR-07); on the base branch of this ticket.
- PRD 03 (Movements & Exchange Rates) — the create and update use cases of expenses and the paths that
  call them (FR-02); merged.
- DISC-001-08c (Notices) — the notices table, the notices list and `renderNoticeText` (FR-01, FR-05);
  merged.
- PRD 01 (Identity & Access) — the owner scope, the user time zone and the user language (FR-03, FR-05,
  FR-06); merged.
- Database migration: 0036 (one table and a widened check on `notices`), its journal `when` greater than
  the maximum on `main` when it merges.

## Decision Log
- 2026-10-11: Parent PRD split into six sub-tickets; this one covers budget alerts. Parent IDs map as:
  FR-21 to FR-01, NFR-03 to NFR-01, AC-29 to AC-01, AC-30 to AC-05. New in this ticket: FR-02 to FR-07,
  NFR-02 to NFR-04 and the criteria not listed.
- 2026-10-11: Decided by the owner (parent decision 2): the movements write path calls a port after the
  commit that evaluates the budgets and publishes a notice through `notices`; a polling worker cannot
  meet 5 seconds.
- 2026-10-11: Proposed by the model, awaiting the owner: the evaluation is state-based, not
  delta-based: after an expense it computes the percentage used of every budget that covers the
  category and publishes every threshold at or below it that has no record, so a missed crossing is
  caught up by the next expense. Alternative: compare the spending before and after the expense, which
  loses a crossing whenever one evaluation fails.
- 2026-10-11: Proposed by the model, awaiting the owner: only the current month in the user's time zone
  alerts, so a back-dated expense in a past month never does. Alternative: alert for any month, which
  would announce crossings of months that are over.
- 2026-10-11: Proposed by the model, awaiting the owner: once per threshold per budget per month, even
  if the spending falls and crosses again, kept in a new table `budget_alert_marks` with a unique key
  (budget, month, threshold). Alternative: re-arm a threshold when the spending falls below it, which
  repeats alerts when the user edits expenses around the line.
- 2026-10-11: Proposed by the model, awaiting the owner: the evaluation runs inline after the commit, awaited
  with a fixed time bound and a logged failure, rather than fire-and-forget. A fire-and-forget task
  can be lost when the process stops and cannot be awaited by a test of the 5-second bound; an
  in-memory queue would break the stateless API rule of `AGENTS.md`.
- 2026-10-11: Proposed by the model, awaiting the owner: the alert is a new notice kind `budget_alert`
  whose `payment_id` carries the id of the alert record (a subject id with no foreign key, as for
  `card_statement_due`) and whose due date is the first day of the month; the text is
  "Outings reached 80% of its budget" or "Outings alcanzó el 80% de su presupuesto".
- 2026-10-11: Proposed by the model, awaiting the owner: group expenses are out of scope (limitation):
  the shares counted by 06c can cross a threshold, but the group write path (05b) is not changed; the
  next personal expense in the category catches the crossing up.
- 2026-10-11: Proposed by the model, awaiting the owner: no alert at the moment a budget is created or
  edited; a lowered amount alerts at the next expense in a covered category.

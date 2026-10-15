# PRD FEAT-013: Installment schedule preview and closing-day clarity

| Field | Value |
|-------|-------|
| Ticket | FEAT-013 |
| Tracker | none |
| Date | 2026-10-15 |
| PRD loops | 1 |
| Loops since last human decision | 1 |

## Context and Problem

The card purchase form (DISC-001-10c FR-01) takes an amount, a number of payments from 1 to 60, a
category and a date, and saves. It never shows what that produces, so the user cannot tell:

- how much each installment is, and that the first one carries the leftover cents (FR-03 of 10c);
- which statement each installment lands in, and when that statement closes and is due;
- that a purchase made **on the closing day** goes to the statement that closes that day;
- that a purchase dated before the last closed statement lands in a statement that is **already
  closed**, so its first installment is owed immediately.

One field ("1 to 60") also switches between a plain card expense (1 payment) and an installment
purchase (2 or more), which the form does not say.

This change adds a live **schedule preview** to the form and states the closing-day rule next to it.
It does not change which statement a purchase goes to, nor any stored data.

**Decision of the owner (2026-10-15):** keep the current rule (a purchase on the closing day belongs
to the statement closing that day). A per-card option to move it to the next statement is not part
of this ticket.

## Goals

- Before saving, the user sees every installment with its amount, statement, closing date and due
  date.
- The user is told which statement the purchase goes to and why, including the closing-day rule.
- The user is warned when the purchase goes to a statement that is already closed.
- What the preview shows is exactly what saving stores.

## Functional Requirements

- FR-01: While the amount, the number of payments and the purchase date of the card purchase form are
  valid, the form shows a schedule with one row per payment.
- FR-02: Each row shows the payment number, its amount, the statement it belongs to, that
  statement's closing date and its due date.
- FR-03: The amounts of the rows follow the split of the purchase: equal parts with the leftover
  minor units on the first row, adding up to the total.
- FR-04: The first row's statement is the one the save will assign: the first stored statement that
  closes on or after the purchase date; each following row is the next statement.
- FR-05: Next to the schedule the form states that a purchase made on a statement's closing day
  belongs to that statement, and names the closing date of the first statement.
- FR-06: When the first statement is already closed, the form shows a warning that its first payment
  is already owed.
- FR-07: With one payment the form shows a single row, labelled as a plain card expense, and with two
  or more it labels the schedule as installments.
- FR-08: The schedule updates as the user edits the amount, the payments or the date, without
  sending anything to the server.
- FR-09: When the card has statements with dates edited by the user, the preview uses those stored
  dates, and the default cycle dates for statements that are not stored yet.
- FR-10: The schedule shows the purchase currency on every amount and applies no conversion.

## Non-Functional Requirements

- NFR-01: The schedule of 60 payments renders within 100 ms of an edit on a mid-range phone profile
  (4x CPU slowdown), measured in a test.
- NFR-02: The preview and the save assign the same statement and the same amounts in 100% of a
  property test over purchase dates, closing days and counts from 2 to 60.
- NFR-03: 0 new strings are missing from the Spanish and English catalogs, and the schedule is
  readable by a screen reader as a table with column headers.
- NFR-04: 0 new network requests are made by editing the form; the statements are loaded once with
  the card.
- NFR-05: Amounts are 64-bit integers in minor units; no floating point in the computation or the
  tests.

## Acceptance Criteria

- AC-01 (FR-01): WHEN the amount, payments and date are valid, THE form SHALL show one schedule row
  per payment, and WHEN any of them is invalid or empty, THE form SHALL show no schedule.
- AC-02 (FR-02): WHEN the schedule is shown, THE form SHALL show for each row the number, the amount,
  the statement month, the closing date and the due date.
- AC-03 (FR-03): WHEN 100.00 ARS is split in 3 payments, THE schedule SHALL show 33.34, 33.33 and
  33.33, and the rows SHALL add up to the total for any amount and count.
- AC-04 (FR-04): WHEN the purchase date is on or before a statement's closing date and after the
  previous one, THE first row SHALL be that statement, and each next row SHALL be the following
  statement.
- AC-05 (FR-05): WHILE the schedule is shown, THE form SHALL state that a purchase on the closing day
  belongs to the statement closing that day, with the first statement's closing date.
- AC-06 (FR-06): IF the first statement's closing date is before today, THEN THE form SHALL show a
  warning that the first payment is already owed.
- AC-07 (FR-07): WHEN the payments are 1, THE form SHALL show one row marked as a card expense, and
  WHEN they are 2 or more, THE form SHALL label the schedule as installments.
- AC-08 (FR-08): WHEN the user changes the amount, the payments or the date, THE form SHALL update
  the schedule with no request to the server.
- AC-09 (FR-09): WHERE a statement's dates were edited by the user, THE schedule SHALL show those
  dates, and for a statement not stored yet it SHALL show the dates of the default cycle.
- AC-10 (FR-10): WHEN the purchase currency is USD, THE schedule SHALL show USD amounts and no ARS
  conversion.
- AC-11 (FR-04): WHEN the purchase is saved, THE stored installments SHALL match the schedule that
  was shown for the same values: same amounts and same statements.
- AC-12 (FR-01): IF the card statements fail to load, THEN THE form SHALL show the existing load
  error and no schedule, and SHALL NOT show a schedule that was not computed from the stored statements.
- AC-13 (FR-03): IF the amount is smaller than the number of payments in minor units, THEN THE form
  SHALL show the existing validation error and no schedule.

## Out of Scope

- Changing the closing-day rule or adding a per-card option for it.
- Editing the schedule (custom dates or amounts per installment).
- Shared (group) expenses paid with a card in installments: a separate PRD.
- Interest, financing cost or conversion of USD installments.
- Changes to the statement screens or to the installment purchase list.

## Risks and Mitigations

- **Preview and save disagree:** both must use the same rule. Mitigation: one shared pure function
  used by the API assignment path where possible, and a property test (NFR-02, AC-11).
- **Stale statements:** the card's statements are loaded once, so a statement edited in another
  device could differ. Mitigation: the server stays authoritative; the saved purchase view shows the
  final dates.
- **Statements not created yet:** the API creates missing cycles at save time. Mitigation: the
  preview falls back to the default cycle dates for those (FR-09).

## Dependencies

- Credit cards module: statements list endpoint (`GET /credit-cards/:id/statements`), card closing
  and due days.
- `packages/shared`: statement cycle arithmetic and the installment split.
- DISC-001-10c (installment rules), the card purchase form and its container.

# PRD FEAT-010: Count card purchases in the month their statement is due

| Field | Value |
|-------|-------|
| Ticket | FEAT-010 |
| Tracker | none |
| Date | 2026-10-12 |
| PRD loops | 1 |
| Loops since last human decision | 1 |

## Context and Problem

The app has two rules for when a card expense counts as spending in reports and on the dashboard:

- An **installment** counts in the month of the due date of its statement. This is an explicit
  decision of 2026-09-25 (DISC-001-10c): the spending view is cash flow, the month the user really
  pays.
- A **purchase in one payment** is an ordinary expense movement on the card's linked account, and it
  counts in the month of its purchase date.

So a purchase made on 20 September with a card whose statement closes on 24 September and is due on
5 October shows as September spending, although the user pays it in October. The user then sees the
card payment of October as a transfer (DISC-001-10d: a payment is never an expense, so purchases are
not counted twice) and no October spending for it. In the same card, installments follow the payment
month and one-payment purchases follow the purchase month.

This change applies the rule of the installments to every expense made on a card, in the places that
sum spending over months: the two reports (expenses by category, and income versus expenses) and the
monthly flows of the dashboard. The payment stays a transfer, so nothing is counted twice.

## Goals

- A card purchase counts as spending in the month its statement is due, the same as an installment.
- The reports and the dashboard agree with each other and with what the user pays each month.
- The movement itself is untouched: its date, its account balance effect and its row in the movements
  list stay as they are.

## Functional Requirements

- FR-01: The expenses-by-category report and the income-versus-expenses report count an expense
  movement recorded on a credit card account in the month of the due date of the statement the
  purchase belongs to, and not in the month of its purchase date.
- FR-02: The monthly flows of the dashboard apply the same rule, so the spending of the month and where
  the money went match the reports.
- FR-03: The statement of a purchase is the one defined in DISC-001-10b: a purchase dated on or before
  a statement's closing date belongs to that statement, and one dated after it to the next; the due
  date is the stored date of the statement when it exists and the one computed from the card's closing
  and due days otherwise, as for installments.
- FR-04: An expense movement on an account that is not a credit card account keeps counting in the
  month of its own date.
- FR-05: A card purchase counts once: in the month of its statement's due date and in no other month.
- FR-06: Transfers and exchanges, among them the card statement payments, keep not counting as
  spending or income.
- FR-07: The amount of a card purchase is converted to the display currency with the movement's frozen
  rate, as every expense movement is today.
- FR-08: The rule applies the same way when a report is filtered by account or by tag.
- FR-09: The change is computed when the reports and the dashboard are read: no stored month, no data
  migration, and the history re-reads under the new rule at once.
- FR-10: The reports and the dashboard show a one-line note, from the i18n catalogs in Spanish and
  English, saying that card purchases count in the month their statement is due.

## Non-Functional Requirements

- NFR-01: The reports and dashboard endpoints keep passing their existing latency benchmarks
  (`pnpm test:perf`) with 0 threshold changes.
- NFR-02: Every query reads only the caller's own movements, cards and statements, so 0 rows of another
  user enter any sum, and no endpoint changes its authorization.
- NFR-03: All amounts stay integers in minor units with 0 floating-point money values, and the
  conversion rounds as it does today.
- NFR-04: The web screens issue 0 additional API requests because of this change.
- NFR-05: Coverage of the new and changed code stays at or above the project floor of 80% lines,
  branches and functions, and no `any` is introduced.

## Acceptance Criteria

- AC-01 (FR-01): WHEN a purchase of 30,000.00 ARS dated 2026-09-20 is recorded on a card whose
  statement closes on 2026-09-24 and is due on 2026-10-05, THE expenses-by-category report SHALL count
  it in October 2026 and not in September 2026.
- AC-02 (FR-01): WHEN the same purchase exists, THE income-versus-expenses report SHALL count it as
  October 2026 spending and September 2026 SHALL not include it.
- AC-03 (FR-03): WHEN a purchase is dated 2026-09-25, after that statement's closing date, THE reports
  SHALL count it in the month of the due date of the next statement.
- AC-04 (FR-03): WHEN a statement's stored due date has been edited to another day or month, THE
  reports SHALL count its purchases in the month of that stored due date.
- AC-05 (FR-03): WHEN a purchase belongs to a statement that is not stored yet, THE reports SHALL use
  the due date computed from the card's closing and due days.
- AC-06 (FR-02): WHEN the dashboard shows October 2026, THE spending of the month SHALL include the
  30,000.00 ARS purchase dated 2026-09-20 and the month of September SHALL not.
- AC-07 (FR-04): WHEN an expense of 8,000.00 ARS is recorded on a bank account on 2026-09-20, THE
  reports and the dashboard SHALL count it in September 2026.
- AC-08 (FR-05): WHEN a card purchase is counted in October, THE reports SHALL not count it in the
  month of its purchase date, and the total of the two months SHALL equal the purchase once.
- AC-09 (FR-06): WHEN a statement payment of 30,000.00 ARS is recorded from a bank account to the
  card, THE reports and the dashboard SHALL count 0 of it as spending or income.
- AC-10 (FR-07): WHEN a card purchase of 20.00 USD with a frozen rate is counted in ARS, THE reports
  SHALL convert it with that frozen rate.
- AC-11 (FR-08): WHEN a report is filtered by the card account or by a tag on a card purchase, THE
  report SHALL count the purchase in the month of its statement's due date.
- AC-12 (FR-09): WHEN the rule ships, THE reports SHALL count already stored card purchases under the
  new rule with no migration step.
- AC-13 (FR-10): WHILE the interface language is Spanish or English, THE reports and the dashboard
  SHALL show the note about card purchases from that language's catalog, and both catalogs SHALL carry
  the same keys.
- AC-14 (FR-01): IF a card has no stored statement and no closing or due day that gives a due date,
  THEN THE reports SHALL count the purchase in the month of its purchase date and SHALL not fail.
- AC-15 (NFR-01): WHEN the latency benchmarks of the reports and the dashboard run, THE benchmarks
  SHALL pass at their existing thresholds.
- AC-16 (NFR-02): IF another user owns a card purchase in the same period, THEN THE reports and the
  dashboard SHALL not count it for the caller.
- AC-17 (NFR-04): WHEN the reports or the dashboard load, THE web app SHALL issue the same requests as
  before this change.

## Out of Scope

- The date of the movement, the movements list, the account balances and the net worth: they do not
  change.
- Budgets: they sum expenses by purchase date today and do not count installments at all; aligning
  them is its own ticket.
- Group expenses and the caller's shares of them; they keep counting by the expense date.
- A switch between purchase-date and payment-date views.
- Changing how a statement payment is recorded or labeled (DISC-001-10d and FEAT-009).
- Interest, fees and taxes recorded on a card, which are expense movements and follow this rule like
  any other purchase.
- Showing in a report which statement a purchase belongs to.

## Risks and Mitigations

- **A purchase counted twice or never.** The monthly sums must take each card purchase from exactly
  one source. Mitigation: card-account expenses leave the date-based sum and enter the statement-based
  one, and a test adds both sums for a purchase and expects exactly one count (AC-08).
- **Reports and dashboard disagree.** They have separate readers today. Mitigation: both read the same
  statement-month rule, and a test compares the same data through both (AC-06, AC-01).
- **A month already read changes.** Spending of past months moves once the rule ships. Mitigation: the
  note of FR-10 says so on the screens, and the PRD states it (FR-09) so it is not read as a bug.
- **Slower sums.** Statement dates join the movement sums. Mitigation: the latency benchmarks stay in
  the gate (AC-15), and the join is by card and statement period, not by row.
- **A card whose dates are missing.** Mitigation: the purchase falls back to its own date instead of
  being dropped (AC-14).

## Dependencies

- DISC-001-10a (cards, their closing and due days, stored statements), DISC-001-10b (the statement of
  a purchase) and DISC-001-10c (installments counted in the month of the statement's due date).
- DISC-001-10d (payments as transfers, so purchases are not counted twice).
- DISC-001-09a, 09b, 09c and 09d (the reports, the dashboard flows and their screens).
- The i18n catalogs `reports` and `dashboard` and the shared account type values.

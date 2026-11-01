# PRD FEAT-015: Unpaid card statements as pending, not as this month's expenses

| Field | Value |
|-------|-------|
| Ticket | FEAT-015 |
| Tracker | none |
| Date | 2026-11-01 |
| PRD loops | 0 |
| Loops since last human decision | 0 |

## Context and Problem

Since FEAT-010 a card purchase, like an installment, counts as an expense in the month its
statement is due, and the current month holds every statement due in it, even one due later in the
month (FEAT-010 D5). A user who imports a statement at the start of the month sees the whole
statement in the dashboard's "Expenses" and "Net result" for the month although nothing has been
paid or debited yet, so the month looks spent before it is.

The user chose to separate what is already paid from what is pending: the dashboard's expenses of
the current month leave out the card amounts of statements that still owe money, and show them on
their own as "Pending on cards" with the next due date. When the statement is paid (a recorded
payment or an automatic debit) its purchases move into the month's expenses.

## Goals

- The dashboard's month expenses, net result and categories count only card statements that are
  fully paid.
- The user sees, next to the month, how much card money is still pending this month and when the
  next statement is due.
- Paying a statement moves its purchases into the month's expenses with no other action.

## Functional Requirements

- FR-01: In the dashboard's current month, a card purchase or installment whose statement (card,
  period and currency) still owes money is left out of expenses, net result, the change against the
  previous month and the expenses by category.
- FR-02: Those amounts are shown as a separate "pending on cards" total of the current month,
  converted to the display currency like the expenses.
- FR-03: The pending total comes with the earliest due date among the statements it includes.
- FR-04: A statement owes money in a currency while the payments allocated to it in that currency
  are less than its total in that currency, whether it is closed or still open.
- FR-05: When a statement is fully paid in a currency, its purchases and installments in that
  currency count as expenses of the month of its due date, as before.
- FR-06: Pending amounts that cannot be converted to the display currency are counted, not guessed,
  like the installments today.
- FR-07: The dashboard note about card purchases states the new rule: card purchases count in the
  month their statement is due, once the statement is paid.
- FR-08: The dashboard shows the pending line only when the pending total or its unconverted count
  is above zero.

## Non-Functional Requirements

- NFR-01: The stored statements and their payments are read once per dashboard request and shared by
  the upcoming list and the month (no second read of the statements).
- NFR-02: Amounts are 64-bit integers in minor units; no floating point anywhere, tests included.
- NFR-03: 0 new strings missing from the Spanish and English catalogs.

## Acceptance Criteria

- AC-01 (FR-01): WHEN a statement due this month owes its whole ARS total, THE dashboard SHALL leave
  its ARS purchases out of the month's expenses and categories.
- AC-02 (FR-02): WHEN that statement holds 150,000.00 ARS of purchases, THE dashboard SHALL show
  150,000.00 ARS as pending on cards.
- AC-03 (FR-03): WHEN two unpaid statements are due on the 5th and the 12th, THE pending total SHALL
  carry the 5th as its due date.
- AC-04 (FR-04, FR-05): WHEN a payment covering the statement's total is recorded, THE dashboard
  SHALL count its purchases as expenses of the month and SHALL show no pending amount for it.
- AC-05 (FR-04): WHEN a payment covers only part of the total, THE statement SHALL still be pending
  in full.
- AC-06 (FR-04): WHEN a statement is paid in ARS but still owes USD, THE ARS purchases SHALL count as
  expenses and THE USD purchases SHALL be pending.
- AC-07 (FR-06): IF a pending installment in another currency has no rate, THEN THE dashboard SHALL
  count it as unconverted and SHALL NOT add a guessed amount.
- AC-08 (FR-08): WHEN nothing is pending, THE dashboard SHALL show no pending line.
- AC-09 (FR-01): WHEN a statement due in a previous month is still unpaid, THE dashboard SHALL leave
  the earlier months unchanged.

## Out of Scope

- Reports (income vs expenses, expenses by category) and budgets keep counting card purchases in the
  due month, paid or not.
- The net worth and the available total, which already treat card purchases as debt.
- Splitting a partly paid statement between paid and pending.

## Risks and Mitigations

- **A user who never records payments** sees card purchases only as pending in the current month.
  Mitigation: the pending line is visible next to the expenses, and earlier months are unchanged.
- **The dashboard and the reports disagree for the current month.** Mitigation: the note states the
  rule; reports are explicitly out of scope.

## Dependencies

- FEAT-010 (card purchases in the due month), DISC-001-10e (statement payments and automatic debits).
- The dashboard's card statement source (statement views with allocated payments).

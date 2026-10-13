# PRD FEAT-011: Budgets by statement month, and available money on the home screen

| Field | Value |
|-------|-------|
| Ticket | FEAT-011 |
| Tracker | none |
| Date | 2026-10-13 |
| PRD loops | 2 |
| Loops since last human decision | 0 |

## Context and Problem

FEAT-010 made the reports and the dashboard count card spending in the month the statement is due,
the month the user really pays (DISC-001-10c). The budgets were left out and still disagree with
them:

- A **purchase in one payment** on a card is an expense movement on the card's linked account, and a
  budget counts it in the month of its purchase date.
- An **installment** is not counted by a budget at all, although the reports count it in the month
  of its statement's due date.

So a 30,000.00 ARS purchase made on 20 September with a statement due on 5 October consumes the
September budget, while the reports show it as October spending, and the installments of a purchase
in 6 payments never consume any budget. The user sees a budget that says one thing and a report that
says another for the same category and month.

This change makes the budgets sum card spending with the rule of FEAT-010: every expense made on a
card, one-payment purchase or installment, counts in the month of the due date of its statement.

The same ticket also fixes a gap on the home screen. The accounts screen shows the **available**
money (the balances of the accounts the user marks "include in available") next to the net worth,
but the home screen shows only the net worth. A user who opens the app to know how much they can
spend today has to go to the accounts screen. The home screen gets the available money beside the net
worth, computed with the same rule as the accounts screen.

## Goals

- The spending of a budget in a month equals what the reports show for the same categories and month.
- A card purchase and an installment consume the budget of the month the user pays them.
- Alerts, rollover and the budget screens read the same corrected spending, with no stored data
  changed.
- The home screen shows the available money next to the net worth, and it matches the accounts
  screen.

## Functional Requirements

- FR-01: The spending of a budget counts an expense movement recorded on a credit card account in the
  month of the due date of the statement the purchase belongs to, and not in the month of its
  purchase date.
- FR-02: The spending of a budget counts each installment of a card purchase whose category the
  budget covers, in the month of the due date of the statement the installment is assigned to.
- FR-03: The statement of a purchase and its due date follow DISC-001-10b and FEAT-010: a purchase
  dated on or before a statement's closing date belongs to that statement and one dated after it to
  the next; the due date is the stored date of the statement when it exists and the one computed
  from the card's closing and due days otherwise.
- FR-04: An expense movement on an account that is not a credit card account keeps counting in the
  month of its own date.
- FR-05: A card expense counts once: in the month of its statement's due date and in no other month.
- FR-06: Transfers and exchanges, among them the card statement payments, keep not counting as
  budget spending.
- FR-07: The amount of a card expense movement is converted to the budget currency with its frozen
  rate, as every budget expense is today. An installment stores no frozen rate, so, as in the
  reports, an installment in the budget's own currency is added to the spending and one in the other
  currency is not converted: it is left out of the sum and counted, and the budget screens show that
  count with the notice they already use for shares that cannot be converted.
- FR-08: The previous-month spending used by rollover, the budget alerts and the budget detail all
  use the same rule, so every figure of a budget is read from one calculation.
- FR-09: The change is computed when the budgets are read: no stored month, no data migration, and
  the history re-reads under the new rule at once.
- FR-10: The budget screens show a one-line note, from the i18n catalogs in Spanish and English,
  saying that card spending counts in the month its statement is due.
- FR-11: The home screen shows the available money of the user: the sum of the balances of the active
  accounts marked "include in available", as the accounts screen computes it, with its ARS part, its
  USD part and a total converted to the display currency.
- FR-12: The converted total of the available money uses the same current rate as the net worth of the
  home screen; when that conversion is unavailable, the home screen shows the ARS and USD parts and
  the same notice as the net worth, and no converted total.
- FR-13: The available money counts no investments, no group balances and no card debt, and it leaves
  out the accounts that are archived or not marked "include in available", exactly as the accounts
  screen does.

## Non-Functional Requirements

- NFR-01: The budget endpoints keep passing their existing latency benchmarks (`pnpm test:perf`) with
  0 threshold changes.
- NFR-02: Every query reads only the caller's own movements, cards, installments and statements, so
  0 rows of another user enter any sum, and no endpoint changes its authorization.
- NFR-03: All amounts stay integers in minor units with 0 floating-point money values, and the
  conversion rounds as it does today.
- NFR-04: The web screens issue 0 additional API requests because of this change.
- NFR-05: Coverage of the new and changed code stays at or above the project floor of 80% lines,
  branches and functions, and no `any` is introduced.
- NFR-06: The available money arrives in the existing dashboard response, so the home screen issues
  0 additional API requests, and the dashboard endpoint keeps passing its latency benchmark at its
  existing threshold.

## Acceptance Criteria

- AC-01 (FR-01): WHEN a purchase of 30,000.00 ARS dated 2026-09-20 is recorded on a card whose
  statement closes on 2026-09-24 and is due on 2026-10-05, THE budget that covers its category SHALL
  count it in October 2026 and not in September 2026.
- AC-02 (FR-02): WHEN a purchase of 60,000.00 ARS in 6 installments has its first installment on a
  statement due in October 2026, THE budget that covers its category SHALL count 10,000.00 ARS in
  October 2026 and 10,000.00 ARS in each following month.
- AC-03 (FR-03): WHEN a purchase is dated 2026-09-25, after that statement's closing date, THE budget
  SHALL count it in the month of the due date of the next statement.
- AC-04 (FR-03): WHEN a statement's stored due date has been edited to another day or month, THE
  budget SHALL count its purchases and installments in the month of that stored due date.
- AC-05 (FR-03): WHEN a purchase belongs to a statement that is not stored yet, THE budget SHALL use
  the due date computed from the card's closing and due days.
- AC-06 (FR-04): WHEN an expense of 8,000.00 ARS is recorded on a bank account on 2026-09-20, THE
  budget SHALL count it in September 2026.
- AC-07 (FR-05): WHEN a card purchase is counted in October, THE budget SHALL not count it in the
  month of its purchase date, and the total of the two months SHALL equal the purchase once.
- AC-08 (FR-06): WHEN a statement payment of 30,000.00 ARS is recorded from a bank account to the
  card, THE budget SHALL count 0 of it as spending.
- AC-09 (FR-07): WHEN a card purchase of 20.00 USD with a frozen rate is counted in a budget in ARS,
  THE budget SHALL convert it with that frozen rate.
- AC-10 (FR-08): WHEN rollover carries the leftover of a month with a card purchase, THE next month
  SHALL start from the leftover computed under the new rule.
- AC-11 (FR-08): WHEN a card purchase pushes a budget over an alert threshold in the month of its
  statement, THE alert SHALL fire for that month.
- AC-12 (FR-09): WHEN the rule ships, THE budgets SHALL count already stored card purchases and
  installments under the new rule with no migration step.
- AC-13 (FR-10): WHILE the interface language is Spanish or English, THE budget screens SHALL show
  the note about card spending from that language's catalog, and both catalogs SHALL carry the same
  keys.
- AC-14 (FR-01): IF a card has no stored statement and no closing or due day that gives a due date,
  THEN THE budget SHALL count the purchase in the month of its purchase date and SHALL not fail.
- AC-15 (NFR-01): WHEN the latency benchmarks of the budget endpoints run, THE benchmarks SHALL pass
  at their existing thresholds.
- AC-16 (NFR-02): IF another user owns a card purchase or installment in the same period, THEN THE
  budget SHALL not count it for the caller.
- AC-17 (NFR-04): WHEN the budget screens load, THE web app SHALL issue the same requests as before
  this change.
- AC-18 (FR-11): WHEN the user opens the home screen with 100,000.00 ARS in a bank account included
  in available and 50.00 USD in a wallet included in available, THE home screen SHALL show the
  available money with 100,000.00 ARS and 50.00 USD as its parts.
- AC-19 (FR-11): WHEN the accounts screen and the home screen read the same data, THE available parts
  of both SHALL be equal.
- AC-20 (FR-12): WHEN the current rate of the net worth exists, THE home screen SHALL show the
  available total converted to the display currency with that rate.
- AC-21 (FR-12): IF the current rate does not exist, THEN THE home screen SHALL show the ARS and USD
  parts of the available money with the conversion notice and no converted total.
- AC-22 (FR-13): WHEN an account is archived or not marked "include in available", THE home screen
  SHALL count 0 of its balance as available.
- AC-23 (FR-13): WHEN the user has a credit card with debt and an investment portfolio, THE available
  money SHALL not include the debt or the portfolio.
- AC-24 (NFR-02): IF another user owns an account marked "include in available", THEN THE home screen
  SHALL not count its balance for the caller.
- AC-25 (NFR-06): WHEN the home screen loads, THE web app SHALL issue the same requests as before
  this change, and the dashboard benchmark SHALL pass at its existing threshold.
- AC-26 (FR-11): WHILE the interface language is Spanish or English, THE home screen SHALL show the
  label of the available money from that language's catalog, and both catalogs SHALL carry the same
  keys.
- AC-27 (FR-07): WHEN a budget in ARS covers a category with an installment of 10.00 USD and one of
  5,000.00 ARS in the same month, THE budget SHALL count 5,000.00 ARS as spent, SHALL leave the USD
  installment out of the sum, and SHALL report 1 installment not converted.

## Out of Scope

- The reports and the spending parts of the dashboard: FEAT-010 already changed them.
- The date of the movement, the movements list, the account balances and the net worth.
- Shares of group expenses: they keep counting by the expense date.
- A switch between purchase-date and payment-date views.
- Changing how a statement payment is recorded or labeled.
- Showing on a budget which statement a purchase belongs to.

## Risks and Mitigations

- **A purchase counted twice or never.** Card-account expenses leave the date-based sum and enter the
  statement-based one. Mitigation: a test adds both sums for a purchase and expects exactly one count
  (AC-07).
- **Budgets and reports disagree again.** Mitigation: the budgets reuse the statement-month rule of
  the reports instead of a second copy, and a test compares the same data through both.
- **A budget already read changes.** A past month moves once the rule ships, and a budget that was
  under its limit may now be over. Mitigation: the note of FR-10 says so, the PRD states it (FR-09),
  and alerts are not re-sent for months already evaluated.
- **Slower sums.** Statement dates join the budget sums, and `budget-alerts.perf` already runs close
  to its limit. Mitigation: the benchmarks stay in the gate (AC-15).
- **A card whose dates are missing.** Mitigation: the purchase falls back to its own date (AC-14).

## Dependencies

- FEAT-010 (the statement-month rule in the reports) and DISC-001-10a, 10b, 10c, 10d.
- DISC-001-06 (budgets, rollover and alerts).
- DISC-001-02 (accounts and the "include in available" flag) and DISC-001-09c (the home screen net worth).
- The i18n catalog `budgets` and the shared account type values.

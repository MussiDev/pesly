# PRD DISC-001-06a: Savings Goals API

| Field | Value |
|-------|-------|
| Ticket | DISC-001-06a |
| Tracker | none |
| Date | 2026-10-11 |
| PRD loops | 0 |
| Loops since last human decision | 0 |

## Context and Problem
First of six sub-tickets of Savings Goals & Budgets (parent index: `prd-DISC-001-06.md`). Users
want to save for concrete things ("Vacations: USD 2,000 by December") and see whether they are on
track. Some keep a separate account per goal; others keep everything in one account and set money
aside mentally. This ticket creates the `goals` module of the API: goals in ARS or USD, either
linked to one of the user's accounts (progress is that account's balance) or tracked with manual
contributions and withdrawals, with progress, percentage, the monthly amount needed and the reached
and overdue states. Budgets are DISC-001-06b to 06d; the goals screens are DISC-001-06e. No web
screen is built here. Split from `prd-DISC-001-06.md` (2026-10-11, user decision). Requirement IDs
were kept where they did not change; the parent index maps every original ID to its new one.

## Goals
- Let users define savings goals and see their progress and the monthly contribution needed.
- Support both goal styles: linked to an account, or tracked with manual contributions
  (decision 2026-09-25).
- Keep every goal private to its owner.

## Functional Requirements
- FR-01: The system must allow a user to create a savings goal with a name, a target amount, a
  currency (ARS or USD) and an optional target date.
- FR-02: The system must allow a user to link a goal to one of their accounts with the same
  currency when creating it.
- FR-03: The system must compute the progress of a linked goal as the current balance of the
  linked account.
- FR-04: The system must allow a user to record contributions to a goal that is not linked to an
  account.
- FR-05: The system must allow a user to record withdrawals from a goal that is not linked to an
  account.
- FR-06: The system must compute the progress of a goal that is not linked to an account as the
  sum of its contributions minus the sum of its withdrawals.
- FR-07: The system must show for each goal its progress amount and its percentage of the target.
- FR-08: The system must show for each goal with a target date the monthly amount needed to reach
  the target, computed as the remaining amount divided by the number of months left, including
  the current month in the user's time zone, rounded up to the minor unit.
- FR-09: The system must mark a goal as reached when its progress is greater than or equal to its
  target amount.
- FR-10: The system must allow a user to edit the name, target amount and target date of a goal.
- FR-11: The system must allow a user to delete a goal.
- FR-12: The system must let a user read, edit and delete only their own goals.
- FR-13: The system must not allow an account that is linked to a goal to be deleted.
- FR-14: The system must allow a user to hold at most 100 goals.

## Non-Functional Requirements
- NFR-01: Amounts must be stored as 64-bit integers in minor units, with 0 floating-point columns
  or fields for money (concept decision).
- NFR-02: The goal list must answer in < 500 ms at p95 for a user with 50 goals linked to accounts
  and 100,000 movements, measured server-side.
- NFR-03: A user must be able to hold at least 50 goals, each with at least 1,000 contributions
  and withdrawals, within the limit of NFR-02.

## Acceptance Criteria
- AC-01 (FR-01): WHEN a user creates a goal "Vacations" with a target of 2,000.00 USD and a
  target date of 2026-12-31, THE system SHALL store it and show it in the goal list.
- AC-02 (FR-01): IF a user creates a goal with a target amount of 0 or less, THEN THE system
  SHALL reject it.
- AC-03 (FR-02): IF a user links a goal to an account with a different currency, THEN THE system
  SHALL reject it.
- AC-04 (FR-03): WHEN the balance of the account linked to a goal changes from 500.00 to 700.00
  USD, THE system SHALL show a progress of 700.00 USD for that goal.
- AC-05 (FR-04): WHEN a user records a contribution of 200.00 USD to a goal not linked to an
  account, THE system SHALL increase its progress by 200.00 USD and SHALL not change any account
  balance.
- AC-06 (FR-05): WHEN a user records a withdrawal of 50.00 USD from a goal not linked to an
  account with a progress of 200.00 USD, THE system SHALL show a progress of 150.00 USD.
- AC-07 (FR-05): IF a user records a withdrawal larger than the goal's current progress, THEN THE
  system SHALL reject it.
- AC-08 (FR-06): WHEN a goal not linked to an account has contributions of 300.00 and 200.00 USD
  and a withdrawal of 100.00 USD, THE system SHALL show a progress of 400.00 USD.
- AC-09 (FR-07): WHEN a goal with a target of 2,000.00 USD has a progress of 500.00 USD, THE
  system SHALL show 500.00 USD and 25%.
- AC-10 (FR-08): WHEN on 2026-10-15 a goal has 1,500.00 USD remaining and a target date of
  2026-12-31, THE system SHALL show a monthly amount needed of 500.00 USD (3 months: October,
  November, December).
- AC-11 (FR-08): IF the target date of a goal has passed and the goal is not reached, THEN THE
  system SHALL show it as overdue instead of a monthly amount.
- AC-12 (FR-09): WHEN a goal's progress reaches or exceeds its target amount, THE system SHALL
  show it as reached.
- AC-13 (FR-10): WHEN a user saves a new name, target amount or target date for a goal, THE
  system SHALL persist it and recompute its percentage and monthly amount needed.
- AC-14 (FR-11): WHEN a user deletes a goal, THE system SHALL remove it and its contributions and
  withdrawals, and SHALL not change any account balance.
- AC-15 (FR-12): IF a user requests to read, edit or delete a goal owned by another user, THEN
  THE system SHALL answer 404 Not Found and leave it unchanged.
- AC-16 (FR-12): WHEN a user opens their goals, THE system SHALL show only the ones they own.
- AC-17 (FR-01): IF a user creates a goal with an empty name, THEN THE system SHALL reject it.
- AC-18 (FR-02): IF a user links a goal to an account owned by another user, THEN THE system
  SHALL answer 404 Not Found and create no goal.
- AC-19 (FR-04): IF a user records a contribution or a withdrawal on a goal linked to an account,
  THEN THE system SHALL reject it and change nothing.
- AC-20 (FR-04): IF a user records a contribution or a withdrawal with an amount of 0 or less, THEN
  THE system SHALL reject it.
- AC-21 (FR-07): WHEN the balance of the account linked to a goal is negative, THE system SHALL
  show that balance as the progress and 0% as its percentage.
- AC-22 (FR-10): IF a user edits a goal to an empty name or a target amount of 0 or less, THEN THE
  system SHALL reject it and leave the goal unchanged.
- AC-23 (FR-13): IF a user deletes an account that is linked to a goal, THEN THE system SHALL
  reject it, keep the account and keep the goal.
- AC-24 (FR-14): IF a user who already holds 100 goals creates another one, THEN THE system SHALL
  reject it.
- AC-25 (FR-08): WHEN on 2026-10-15 a goal has 1,000.00 USD remaining and a target date of
  2026-12-31, THE system SHALL show a monthly amount needed of 333.34 USD (rounded up).
- AC-26 (FR-08): WHEN it is 22:30 on 2026-10-31 in the user's time zone (01:30 on 2026-11-01 UTC)
  and a goal has 1,500.00 USD remaining and a target date of 2026-12-31, THE system SHALL show a
  monthly amount needed of 500.00 USD, counting October as the current month.

## Out of Scope
- Budgets, their spending, rollover and alerts (DISC-001-06b to 06d).
- The goals screens (DISC-001-06e): this ticket has no web screen.
- Shared or group savings goals.
- Automatic contributions to goals (e.g. "set aside 10% of every income").
- Editing or deleting a single contribution or withdrawal, and notes or dates on them: an entry is
  recorded as of now and kept as is.
- Changing the currency of a goal, or linking, unlinking or relinking an account after creation.
- Push or email notifications when a goal is reached (PRD 08 covers reminders).
- Currencies other than ARS and USD, and converting a goal across currencies.

## Risks and Mitigations
- **A linked goal's progress falls when the user spends from that account** → expected: the goal
  reflects the real balance (FR-03, AC-21); users who want isolation use manual contributions.
- **Two withdrawals recorded at once overdraw a goal** → the withdrawal check and the insert run
  in one transaction that locks the goal row (spec D5), so the progress never goes below 0.
- **An account linked to a goal is deleted and the progress vanishes** → deletion is rejected
  (FR-13), and the database foreign key is the backstop.
- **"This month" differs between the server and the user** → the current month comes from the
  user's stored time zone, never from the server clock zone (FR-08, AC-26).
- **The migration collides with another branch's** → this ticket adds the first goal tables as 0033;
  its journal `when` must exceed the maximum `when` on `main` at merge time, or a database that
  already ran a newer migration skips it silently (same rule as DISC-001-03c and 05a).

## Dependencies
- PRD 01 (Identity & Access) — ownership and access control (FR-12) and the user time zone (FR-08);
  merged.
- PRD 02 (Accounts & Categories) — the accounts a goal links to and their balances (FR-02, FR-03,
  FR-13); merged.
- PRD 03 (Movements & Exchange Rates) — the movements that make up an account balance (FR-03);
  merged.
- Database migration: 0033, its journal `when` must be greater than the maximum on `main` when it
  merges (renumbered at merge if another migration took 0033).

## Decision Log
- 2026-09-25: Savings = balances (accounts) + goals + category budgets with alerts (original
  PRD 06, concept).
- 2026-09-25: Goals can be linked to an account or tracked with manual contributions.
- 2026-09-25: User approved the monthly amount counting the current month, no withdrawal beyond
  progress, rounding up to the minor unit.
- 2026-09-25: User decision: per-user time zone, mandatory. Dates are computed in the user's time
  zone (PRD 01, FR-24).
- 2026-10-11: Parent PRD split into DISC-001-06a to 06f by user decision.
- 2026-10-11: Added with the split, awaiting acceptance: a goal is linked only at creation (spec
  and pending decision 4 of the parent), a user holds at most 100 goals, and an account linked to a
  goal cannot be deleted.

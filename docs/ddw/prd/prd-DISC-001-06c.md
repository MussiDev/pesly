# PRD DISC-001-06c: Budget Spending and Rollover

| Field | Value |
|-------|-------|
| Ticket | DISC-001-06c |
| Tracker | none |
| Date | 2026-10-11 |
| PRD loops | 0 |
| Loops since last human decision | 0 |

## Context and Problem
Third of six sub-tickets of Savings Goals & Budgets (parent index: `prd-DISC-001-06.md`; the
sub-tickets are 06a goals API, 06b budgets core API, 06c budget spending and rollover, 06d budget
alerts, 06e goals screens and 06f budgets screens). 06b stores a budget (name, amount, currency,
categories, rollover flag, thresholds) as one version per month. Nothing yet says how much of it was
spent. A user who sets "at most ARS 150,000 a month on outings" needs to see, for a month, how much
the budget has consumed, how much is left, what percentage is used and, when rollover is on, how much
of last month's unspent amount was carried in. This ticket adds that read-only computation to the
`budgets` module: spending is the user's personal expenses plus the user's shares of group expenses,
in the categories of the budget, converted to the budget currency with the rate frozen on each
movement, over month boundaries in the user's time zone. It adds no screen (06f), no alert (06d) and
no table; the only schema change is one index. Requirement IDs were renumbered for this sub-ticket;
the original IDs of the parent PRD are listed in the Decision Log.

## Goals
- Return, per budget and month, the amount, the carried-in rollover, the spending, the remaining
  amount and the percentage used.
- Count personal expenses and group shares together without counting a group expense twice.
- Never use a live exchange rate and never use a floating-point number for money.
- Compute rollover on the fly from the previous month's movements, so an edited or late movement fixes
  it with no rewrite.
- Answer fast enough for the budgets screen: p95 under 500 ms for 50 budgets and 100,000 movements.

## Functional Requirements
- FR-01: The system must compute the spending of a budget in a month as the sum of the user's
  personal expenses and the user's group expense shares in the categories of the budget, including the
  subcategories of every selected parent, with month boundaries in the user's time zone.
- FR-02: The system must convert to the budget currency every expense or share recorded in the other
  currency, using the rate frozen on that movement and never a current rate.
- FR-03: The system must count a group expense share toward a budget when the name of its group
  category matches, case-insensitively, the name of a category covered by the budget.
- FR-04: The system must return for each budget in a month, the current month by default, its amount,
  its spending, its remaining amount and its percentage used.
- FR-05: The system must add to the available amount of a budget with rollover on, for a month, the
  remaining amount of the previous month when that remaining amount is greater than 0, computed from
  the movements of the previous month at the time of the request.
- FR-06: The system must compute a past month with the budget version that was effective in that
  month (name, amount, categories, rollover flag), never with the current version.
- FR-07: The system must let a user read the spending of only their own budgets.
- FR-08: The system must count a group expense paid by the user once, through the user's share, and
  not also through the personal movement that was recorded for the payment.

## Non-Functional Requirements
- NFR-01: The spending of all of a user's budgets must be returned in under 500 ms at p95 for a user
  with 50 budgets and 100,000 movements, measured server-side.
- NFR-02: Money must be computed and returned as 64-bit integers in minor units, with exchange rates
  as integers scaled by 10,000 and 0 floating-point values anywhere in the computation.

## Acceptance Criteria
- AC-01 (FR-01): WHEN in October a user has personal expenses of 50,000.00 ARS and a group share of
  10,000.00 ARS in the categories of a budget, THE system SHALL return an October spending of
  60,000.00 ARS for that budget.
- AC-02 (FR-01): WHEN a budget includes the parent category Food, THE system SHALL count the
  expenses of Groceries, Restaurants and Delivery, and of a subcategory created after the budget, in
  its spending.
- AC-03 (FR-01): WHEN an expense occurs at 01:00 UTC on 1 October and the user's time zone is
  America/Argentina/Buenos_Aires, THE system SHALL count it in September and not in October.
- AC-04 (FR-01): THE system SHALL NOT count income, transfers, currency exchanges or expenses of
  categories outside the budget, and SHALL NOT count movements of another user.
- AC-05 (FR-04): WHEN a user has no expense in a month, THE system SHALL return a spending of 0 and a
  remaining amount equal to the available amount.
- AC-06 (FR-06): WHEN a user raised the amount of a budget from 100,000.00 ARS to 150,000.00 ARS in
  October and asks for September, THE system SHALL compute September with 100,000.00 ARS and the
  September categories.
- AC-07 (FR-02): WHEN an expense of 20.00 USD with a frozen rate of 1,500.0000 falls into an ARS
  budget, THE system SHALL count 30,000.00 ARS.
- AC-08 (FR-02): WHEN an expense of 30,000.00 ARS with a frozen rate of 1,500.0000 falls into a USD
  budget, THE system SHALL count 20.00 USD.
- AC-09 (FR-02): WHEN the stored exchange rates change after a movement was recorded, THE system
  SHALL return the same spending for that movement and SHALL call no external service.
- AC-10 (FR-03): WHEN a group share has the group category "Food" and a budget covers the personal
  category "food", THE system SHALL count that share in the budget.
- AC-11 (FR-03): IF a group share's category name matches no category covered by any budget, THEN THE
  system SHALL not count it in any budget.
- AC-12 (FR-02): IF a group share is in a currency other than the budget currency and the system has
  no rate frozen for it, THEN THE system SHALL not count it and SHALL report how many shares were left
  out for that budget.
- AC-13 (FR-04): WHEN a budget of 150,000.00 ARS has a spending of 120,000.00 ARS, THE system SHALL
  return a remaining amount of 30,000.00 ARS and 80% used.
- AC-14 (FR-04): WHEN a budget of 150,000.00 ARS has a spending of 180,000.00 ARS, THE system SHALL
  return a remaining amount of -30,000.00 ARS and 120% used.
- AC-15 (FR-04): WHEN the request names no month, THE system SHALL use the current month in the user's
  time zone.
- AC-16 (FR-04): IF the requested month is malformed or later than the current month in the user's
  time zone, THEN THE system SHALL reject the request with a 400 error.
- AC-17 (FR-06): WHEN the requested month is earlier than the first version of a budget, THE system
  SHALL leave that budget out of the list and SHALL answer 404 Not Found when it is requested by id.
- AC-18 (FR-05): WHEN October starts and a budget of 150,000.00 ARS with rollover on had 20,000.00 ARS
  remaining in September, THE system SHALL return 170,000.00 ARS available for October.
- AC-19 (FR-05): WHEN October starts and a budget with rollover on overspent in September, THE system
  SHALL return only the budget amount available for October.
- AC-20 (FR-05): WHILE rollover is off for a budget, THE system SHALL return only the budget amount
  available in every month.
- AC-21 (FR-05): WHEN a September expense is added or edited after October began, THE system SHALL
  return the rollover of October recomputed from the September movements as they are at that moment.
- AC-22 (FR-05): WHEN a budget with rollover on has no version in the previous month, THE system SHALL
  return a rollover of 0.
- AC-23 (FR-07): IF a user requests the spending of a budget owned by another user, THEN THE system
  SHALL answer 404 Not Found and return no data.
- AC-24 (FR-07): WHEN a user asks for the spending of all budgets, THE system SHALL return only the
  budgets they own.
- AC-25 (FR-07): IF a request has no valid session, THEN THE system SHALL answer 401 and return no
  spending data.
- AC-26 (FR-08): WHEN the user paid a group expense of 30,000.00 ARS with a share of 10,000.00 ARS
  and the payment was recorded as a personal expense, THE system SHALL count 10,000.00 ARS toward the
  budgets and not 30,000.00 ARS.
- AC-27 (NFR-01): WHEN a user with 50 budgets and 100,000 movements asks for the spending of all
  budgets, THE system SHALL answer in under 500 ms at p95.
- AC-28 (NFR-02): WHEN the spending is computed, THE system SHALL return every amount as an exact
  integer string in minor units, and SHALL compute every conversion with integer arithmetic.

## Out of Scope
- Alerts when a threshold is crossed and their once-per-month state (DISC-001-06d); this ticket only
  returns the thresholds already stored by 06b next to the percentage used.
- Web screens (DISC-001-06f).
- Snapshots of closed months and a job to write them: rollover is computed on the fly.
- Rollover that compounds over more than one earlier month: only the previous month's remaining amount
  is carried in (see the Decision Log).
- Carrying overspending into the next month (a negative remaining amount rolls over as 0).
- Group or shared budgets, weekly, yearly or custom periods, and budgets over income categories.
- Storing a frozen rate on group expenses and their shares (05b write path); see the Risks.
- Changes to the budget versions or to the way edits are stored (06b).

## Risks and Mitigations
- **A group expense is counted twice for its payer** → the personal movement recorded when the user
  pays a group expense carries the full amount (05b spec D6); it is left out of the personal spending
  and the user's share is counted instead (FR-08, AC-26).
- **A group share has no frozen rate** → the shares table keeps no rate, so a share in the other
  currency can be converted only through the payer's own movement; any other is not counted and is
  reported per budget (AC-12) instead of being guessed with a live rate.
- **Converted amounts drift from what the user expects** → conversion always uses the rate frozen on
  the movement (FR-02, AC-09), never today's rate, and never calls dolarapi.com.
- **Names of group and personal categories do not match** → unmatched shares are simply not counted
  (AC-11), as in the original decision.
- **The month query is slow with 100,000 movements** → one aggregated SQL query for all budgets over
  the two months needed, using the existing owner, category and date index, with no query per budget;
  a benchmark covers NFR-01 (AC-27).
- **Rollover drifts from what the user saw** → it is recomputed on every read from the previous
  month's movements, so a late movement changes it (AC-21); this is the intended behaviour.
- **The index for the payer-movement exclusion collides with another branch's migration** → this
  ticket adds one index as migration 0035, renumbered at merge, and its journal `when` must exceed the
  maximum `when` on `main` at merge time (same rule as DISC-001-05a and 06b).

## Dependencies
- DISC-001-06b (Budgets Core API) — budgets and their versions per month, covered categories (FR-01,
  FR-05, FR-06, FR-07); on the base branch of this ticket.
- PRD 01 (Identity & Access) — ownership and access control (FR-07) and the user's time zone (FR-01,
  FR-04); merged.
- PRD 02 (Accounts & Categories) — categories and subcategories (FR-01, FR-03); merged.
- PRD 03 (Movements & Exchange Rates) — personal expenses and the rate frozen on each movement (FR-01,
  FR-02); merged.
- PRD 05 (Groups & Expense Splitting), DISC-001-05b — group expense shares and group categories, the
  same data as `GET /groups/personal/shares` (FR-01, FR-03, FR-08); merged.
- Database migration: 0035 (one index), its journal `when` greater than the maximum on `main` when it
  merges.

## Decision Log
- 2026-09-25: Budget design after reviewing Monarch, YNAB, Wallet and Spendee: only the user's share of
  group expenses, remaining amount rolled over only when positive (parent PRD Decision Log).
- 2026-10-11: Parent PRD split into six sub-tickets; this one covers budget spending and rollover.
  Parent IDs map as: FR-14 to FR-01, FR-15 to FR-02, FR-16 to FR-03, FR-17 to FR-04, FR-19 to FR-05,
  the budgets part of FR-24 to FR-07, NFR-02 to NFR-01, NFR-01 to NFR-02, AC-18 to AC-01, AC-19 to
  AC-07, AC-20 to AC-10, AC-21 to AC-11, AC-22 to AC-13, AC-24 to AC-18, AC-25 to AC-19, AC-26 to
  AC-20. New in this ticket: FR-06, FR-08 and the criteria not listed.
- 2026-10-11: Decided by the owner (parent pending decision 1): rollover is computed on the fly from
  the previous month's movements, with no snapshot and no job; past months use the budget version
  effective in that month.
- 2026-10-11: Proposed by the model, awaiting the owner's acceptance: the rollover carries only the
  previous month's own remaining amount (previous version's amount minus previous spending), not the
  previous month's available amount, so it does not compound across months and needs two months of
  movements per budget (parent NFR-02 note). Alternative: compound over all months since the budget
  was created, which is unbounded work per read.
- 2026-10-11: Proposed by the model, awaiting the owner's acceptance: a personal movement recorded as
  the payer movement of a group expense (05b D6, full amount) is excluded from personal spending and
  the share is counted instead (FR-08). Alternative: count the movement and ignore the share for the
  payer, which would count the full amount the user may recover from others.
- 2026-10-11: Proposed by the model, awaiting the owner's acceptance: a group share in the other
  currency is converted only with the rate frozen on the payer's own movement; otherwise it is not
  counted and reported (AC-12). Alternative: store a frozen rate on every group expense (a 05b write
  path change and migration), or convert with the stored current rate, which breaks the frozen-rate
  rule.
- 2026-10-11: Proposed by the model, awaiting the owner's acceptance: a group category matches a
  budget when its name equals the name of any category the budget covers, subcategories included, using
  the same effective names as the categories module (custom name, or both language names of a
  default).
- 2026-10-11: Proposed by the model, awaiting the owner's acceptance: a month before a budget's first
  version leaves it out of the list (404 by id), and a month later than the current one is rejected
  with 400.
- 2026-10-11: Proposed by the model, awaiting the owner's acceptance: the percentage used is an
  integer rounded down and capped at 1,000, so a threshold of N percent is crossed exactly when the
  returned percentage is at least N.

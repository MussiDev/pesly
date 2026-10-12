# PRD DISC-001-09a: Reports API

| Field | Value |
|-------|-------|
| Ticket | DISC-001-09a |
| Tracker | none |
| Date | 2026-10-12 |
| PRD loops | 1 |
| Loops since last human decision | 1 |

## Context and Problem
First of four sub-tickets of Dashboard & Reports (parent index: `prd-DISC-001-09.md`; the sub-tickets
are 09a reports API, 09b dashboard API, 09c dashboard screens and navigation (with the theme choice),
and 09d reports screens). Every module records one slice of the user's money, but nothing adds the
slices up over time. This ticket adds a new `reports` module to `apps/api` with three read-only
endpoints: expenses by category over a date range of up to 24 months, income against expenses per month
for the last 12 months, and net worth at each month end over a date range of up to 24 months. The first
two can be filtered by account, tag and date range. Flows (income and expenses) are converted to the
user's display currency with the rate frozen on each movement; each past month-end net worth point is
converted with the latest stored rate on or before that month end (parent FR-19 and FR-20). Only the
user's own data and the user's own shares of group expenses are read. It adds no screen (09c and 09d),
no dashboard endpoint (09b) and no theme setting.

Investigation of the code for this PRD found three facts that shape the scope, each recorded in the
Decision Log for owner ratification: (1) `exchange_rates` keeps one row per rate type that each refresh
replaces in place, so a past rate cannot be read and parent FR-20 needs a small history table; (2) no
account balance history exists, so the balance at a month end is rebuilt from the opening balance and
the movements and settlements dated up to it; (3) `portfolio_value_snapshots` (DISC-001-07b) exists
only from the day it was deployed, so earlier months have no investment value. Requirement IDs were
renumbered for this sub-ticket; the original IDs of the parent PRD are in the Decision Log.

## Goals
- Return, as JSON the 09d screens can draw directly, the three reports with every amount as an exact
  integer in minor units.
- Make the numbers agree with the rest of the app: the same frozen-rate, ownership and group-share rules
  as the budgets (DISC-001-06c), the same balance rules as the accounts and the group balances.
- Never use a live rate for a flow and never call an external service in a report request.
- Answer each report in under 2 s at p95 for 24 months over 100,000 movements.
- Say plainly, in the response, which numbers are incomplete (a month without a rate, a month before the
  first investment snapshot, a share that could not be converted) instead of guessing.

## Functional Requirements
- FR-01: The system must return, for `GET /reports/expenses-by-category`, the expense total per
  top-level category (subcategories added to their parent) in the user's display currency for a date
  range of up to 24 calendar months.
- FR-02: The system must reject a report request whose date is malformed, whose `from` is later than
  its `to`, whose `to` is later than today in the user's time zone, or whose range exceeds the limit of
  that report, with a 400 error that states the limit.
- FR-03: The system must return, for `GET /reports/income-expenses`, one income total and one expense
  total per calendar month in the user's display currency for the last 12 months, the current month
  included.
- FR-04: The system must return, for `GET /reports/net-worth`, one net worth value per month end in
  the date range, which spans up to 24 calendar months, with the ARS component and the USD component of
  each point.
- FR-05: The system must filter the reports of FR-01 and FR-03 by account, by tag (case-insensitive
  name) and by date range (`from` and `to`, local dates in the user's time zone, both inclusive).
- FR-06: The system must convert every income and every expense of FR-01 and FR-03 that is in a
  currency other than the display currency with the rate frozen on that movement, never with a stored
  or live rate.
- FR-07: The system must count as expenses the user's personal expense movements, leaving out the
  payer movement of a group expense, plus the user's share of each group expense, matched to a personal
  category by name and converted as DISC-001-06c does; and must count as income only income movements,
  never transfers or currency exchanges.
- FR-08: The system must count each credit card installment as an expense in the calendar month of the
  due date of its statement and in the category of its purchase, and must leave installments out of any
  report that is filtered by account or tag.
- FR-09: The system must compute the account part of a net worth point as the sum, per currency, of the
  opening balance of every non-archived account plus the signed effect of every movement and settlement
  payment dated up to the end of that month in the user's time zone.
- FR-10: The system must compute the investment part of a net worth point from the latest daily
  portfolio snapshot of each portfolio on or before the last day of that month, per currency.
- FR-11: The system must compute the group part of a net worth point, per currency, as the sum over the
  user's group memberships of what the member paid, minus the member's shares, plus the signed
  settlement legs, counting only expenses and settlements dated up to the end of that month.
- FR-12: The system must subtract from a net worth point, per currency, the credit card installments of
  purchases made on or before that month end whose statement closes after it.
- FR-13: The system must convert the USD component of each past month-end net worth point to the
  display currency with the sell rate of the user's default rate type stored on or before that month end
  (parent FR-20), and must return the point with its two components and no converted total when no such
  rate exists.
- FR-14: The system must keep, for every rate type, the last buy and sell rate stored on each calendar
  day, so that a rate on or before a past date can be read.
- FR-15: The system must date the net worth point of the current month with today in the user's time
  zone and convert it with the latest stored rate.
- FR-16: The system must read only data the user owns and the user's own shares of group expenses, must
  answer 404 for an account or tag that is not the user's, and must answer 401 without a valid session.

## Non-Functional Requirements
- NFR-01: Each of the three reports must be returned in under 2 s at p95, measured server-side, for a
  24-month range over a user with 100,000 movements (parent NFR-02).
- NFR-02: Money must be computed and returned as 64-bit integers in minor units, with exchange rates as
  integers scaled by 10,000 and 0 floating-point values anywhere in the feature.
- NFR-03: The feature must add 1 database migration, which is additive and has a rollback script, and 0
  new runtime dependencies.
- NFR-04: A report request must not call any external service: 0 outbound calls per request.

## Acceptance Criteria
- AC-01 (FR-01): WHEN a user requests expenses by category from 2025-01-01 to 2026-09-30, THE system
  SHALL return the total per top-level category for that range, each with the category id, its name and
  an amount in minor units of the display currency.
- AC-02 (FR-01): WHEN an expense is in the subcategory Groceries of the parent Food, THE system SHALL
  add it to the total of Food and return no row for Groceries.
- AC-03 (FR-01): WHEN a request covers a range with no expense, THE system SHALL return an empty list and
  a total of 0.
- AC-04 (FR-02): IF a user requests expenses by category or net worth for a range longer than 24
  calendar months, THEN THE system SHALL answer 400 and state the limit of 24 months.
- AC-05 (FR-02): IF a request has a malformed date, a `from` later than `to`, or a `to` later than today
  in the user's time zone, THEN THE system SHALL answer 400 and return no data.
- AC-06 (FR-02): IF a user requests the income and expenses report for a range longer than 12 calendar
  months, THEN THE system SHALL answer 400 and state the limit of 12 months.
- AC-07 (FR-03): WHEN a user opens the income and expenses report without dates, THE system SHALL return
  12 months, from 11 months before the current month to the current month, each with one income amount
  and one expense amount.
- AC-08 (FR-03): WHEN a month has no movement, THE system SHALL return that month with an income of 0
  and an expense of 0.
- AC-09 (FR-04): WHEN a user requests net worth from 2025-10-01 to 2026-09-30, THE system SHALL return 12
  points, one per month end, in date order.
- AC-10 (FR-04): WHEN a point is returned, THE system SHALL include its date, its ARS component, its USD
  component and its converted total or the reason it has none.
- AC-11 (FR-05): WHEN a user filters the category report by the tag "vacations2026", THE system SHALL
  include only movements with that tag.
- AC-12 (FR-05): WHEN a user filters the income and expenses report by one account, THE system SHALL
  include only the income and expense movements of that account.
- AC-13 (FR-05): WHEN a user filters by the tag "Vacations2026" and the stored tag is "vacations2026",
  THE system SHALL match it.
- AC-14 (FR-05): WHEN a request names `from` 2026-03-01 and `to` 2026-03-31, THE system SHALL count the
  movements from 00:00 on 1 March to 23:59:59 on 31 March in the user's time zone and no other.
- AC-15 (FR-06): WHEN a 20.00 USD expense with a frozen rate of 1,400.0000 appears in a report in ARS,
  THE system SHALL count it as 28,000.00 ARS even if today's stored rate is different.
- AC-16 (FR-06): WHEN the stored exchange rates change after a movement was recorded, THE system SHALL
  return the same report amounts for it.
- AC-17 (FR-06): WHEN a 30,000.00 ARS expense with a frozen rate of 1,500.0000 appears in a report in
  USD, THE system SHALL count it as 20.00 USD.
- AC-18 (FR-07): WHEN in October a user has personal expenses of 50,000.00 ARS and a group share of
  10,000.00 ARS in a group category named like a personal category, THE system SHALL return 60,000.00
  ARS for that category in October.
- AC-19 (FR-07): WHEN the user paid a group expense of 30,000.00 ARS with a share of 10,000.00 ARS and
  the payment was recorded as a personal expense, THE system SHALL count 10,000.00 ARS and not 30,000.00
  ARS.
- AC-20 (FR-07): WHEN a group share matches no personal category by name, THE system SHALL return it in
  one row with a null category id.
- AC-21 (FR-07): IF a group share is in a currency other than the display currency and the system has no
  frozen rate for it, THEN THE system SHALL leave it out of the amounts and return the number of shares
  left out.
- AC-22 (FR-07): THE system SHALL NOT count a transfer or a currency exchange as income or as an expense.
- AC-23 (FR-08): WHEN an installment of 10,000.00 ARS belongs to a statement due on 2026-11-10, THE
  system SHALL count it in November 2026 in the category of its purchase.
- AC-24 (FR-08): WHEN a report is filtered by an account or a tag, THE system SHALL leave installments
  out.
- AC-25 (FR-08): IF an installment is in a currency other than the display currency, THEN THE system
  SHALL leave it out of the amounts and return the number of installments left out, because it has no
  frozen rate.
- AC-26 (FR-09): WHEN an account has an opening balance of 100,000.00 ARS, an expense of 30,000.00 ARS in
  April and an income of 10,000.00 ARS in July, THE system SHALL return an ARS account part of 70,000.00
  for the end of April and 80,000.00 for the end of July.
- AC-27 (FR-09): WHEN a transfer moves 5,000.00 ARS from one ARS account to another in June, THE system
  SHALL return the same total ARS account part before and after the transfer.
- AC-28 (FR-09): WHEN a movement is dated 01:00 UTC on 1 July and the user's time zone is
  America/Argentina/Buenos_Aires, THE system SHALL count it in June.
- AC-29 (FR-09): THE system SHALL NOT include an archived account in any net worth point.
- AC-30 (FR-10): WHEN a portfolio has snapshots on 2026-06-29 and 2026-07-02 and the point is for 2026-06-30,
  THE system SHALL use the snapshot of 2026-06-29.
- AC-31 (FR-10): WHEN a month end is earlier than the first snapshot of a portfolio created before that
  month end, THE system SHALL count 0 for that portfolio and mark the point as having incomplete
  investments.
- AC-32 (FR-10): WHEN a portfolio was created after a month end, THE system SHALL count 0 for it at that
  month end and SHALL NOT mark the point as incomplete.
- AC-33 (FR-11): WHEN at a month end group members owe the user 30,000.00 ARS and the user owes 20,000.00
  ARS in another group, THE system SHALL add 10,000.00 ARS to the ARS group part of that point.
- AC-34 (FR-11): WHEN a settlement is dated after a month end, THE system SHALL NOT include its legs in
  that point.
- AC-35 (FR-12): WHEN a purchase of 6 installments of 10,000.00 ARS was made in April and its statements
  close on 2026-06-20, 2026-07-20 and later months, THE system SHALL subtract the installments of the
  statements that close after 2026-06-30 from the ARS part of the point of 2026-06-30.
- AC-36 (FR-12): WHEN an installment belongs to a statement that closed on or before the month end, THE
  system SHALL NOT subtract it from that point.
- AC-37 (FR-13): WHEN the net worth point for 2026-06-30 is computed, THE system SHALL convert its USD
  component with the sell rate of the user's default rate type stored on 2026-06-30 or the latest day
  before it.
- AC-38 (FR-13): IF no rate is stored on or before a month end, THEN THE system SHALL return that point
  with its ARS and USD components, a null converted total and the reason "no rate".
- AC-39 (FR-13): WHEN the display currency is ARS and the USD component is 1,000.00 and the rate is
  1,500.0000, THE system SHALL return a converted total that includes 1,500,000.00 ARS for the USD part.
- AC-40 (FR-14): WHEN a rate refresh stores new rates twice on the same day, THE system SHALL keep one
  history row per rate type for that day, holding the last values stored.
- AC-41 (FR-14): WHEN the migration of this ticket is applied, THE system SHALL create a history row for
  each rate type from the rates already stored, dated by the day they were fetched.
- AC-42 (FR-15): WHEN the current month is in the requested range, THE system SHALL return its point
  dated today and converted with the latest stored rate of the default rate type.
- AC-43 (FR-16): IF a report request includes an account or a tag that belongs to another user or does
  not exist for the user, THEN THE system SHALL answer 404 Not Found and return no data.
- AC-44 (FR-16): WHEN a user belongs to a group, THE system SHALL include in their reports only their
  own shares of the group's expenses and never an amount of another member.
- AC-45 (FR-16): IF a request has no valid session, THEN THE system SHALL answer 401 and return no data.
- AC-46 (FR-16): WHEN two users have movements, THE system SHALL return in each report only the movements
  of the caller.
- AC-47 (NFR-01): WHEN a user with 100,000 movements asks for each of the three reports over 24 months
  (12 for the income and expenses report), THE system SHALL answer in under 2 s at p95 over 20 runs.
- AC-48 (NFR-02): WHEN a report is computed, THE system SHALL return every amount as an exact integer
  string in minor units and SHALL compute every conversion with integer arithmetic.
- AC-49 (NFR-03): WHEN the migration of this ticket is applied and rolled back twice, THE system SHALL
  keep every other table unchanged and add 0 runtime dependencies to `package.json`.
- AC-50 (NFR-04): WHEN a report is requested, THE system SHALL make 0 outbound calls to dolarapi.com or
  any other external service.

## Out of Scope
- The dashboard endpoints: net worth now, KPIs, category breakdown, budgets, next 7 days, "Do these
  first", group balances, the insight and the first-steps flag (DISC-001-09b).
- Web screens, charts and the navigation (DISC-001-09c and 09d) and the theme choice (09c).
- Exporting reports to CSV or PDF, group-level reports, forecasts, and report periods other than months
  (parent Out of Scope).
- Precomputed month-end snapshots of net worth: the reports are computed on the fly; a snapshot table is
  added only if the benchmark of NFR-01 fails (parent Risks).
- Investment values for months before the first daily snapshot: they are not recorded anywhere and are
  not reconstructed.
- Rates for days before this ticket's history starts, other than the one row seeded by the migration.
- Filters on the net worth report, and filtering by category.
- Reports offline (parent Out of Scope).

## Risks and Mitigations
- **A past month cannot be converted because rates were never kept** → `exchange_rates` holds one
  replaced row per type; this ticket keeps a daily history from now on (FR-14) and returns the point
  with its two components and a reason when no rate exists (AC-38) instead of using today's rate.
- **Net worth of old months looks too low because investments are missing** → the point is marked with
  incomplete investments (AC-31) so the screen can say so.
- **Report numbers disagree with the budgets** → flows reuse the 06c rules: payer movement left out and
  the share counted instead (AC-19), group category matched by name, no live rate, shares without a rate
  reported (AC-21).
- **Group shares have no frozen rate, installments have none either** → a share or an installment in the
  other currency is left out and counted in the response (AC-21, AC-25); today's rate is never guessed.
- **A 24-month net worth over 100,000 movements is slow** → account balances come from one aggregated
  query that buckets movements by month, not from one query per month; the group part, the installment
  part and the snapshots are one aggregated query each; a benchmark covers NFR-01 (AC-47); PLAN may add
  an index or a snapshot table if the benchmark fails.
- **A user reads another user's data through a filter id or a tag name** → every query takes the
  `AccessScope` of the request and puts it in the WHERE clause through `scopedTo`; an account or tag that
  is not the user's answers 404 (AC-43).
- **Day boundaries disagree with what the user sees** → months and range days are computed in the user's
  time zone (AC-14, AC-28).
- **The migration number collides with another branch** → this ticket adds migration 0038, renumbered at
  merge, and its journal `when` must exceed the maximum `when` on `main` at merge time (same rule as
  DISC-001-05a, 06b and 06c).

## Dependencies
- PRD 01 (Identity & Access) — session, display currency, default rate type and time zone (FR-01,
  FR-13, FR-16); merged.
- PRD 02 (Accounts & Categories) — accounts, opening balances, archived state and categories (FR-01,
  FR-09); merged.
- PRD 03 (Movements & Exchange Rates) — movements, tags, the frozen rate on each movement and the
  exchange rate refresh that this ticket extends with a history (FR-05, FR-06, FR-13, FR-14); merged.
- PRD 05 (Groups & Expense Splitting) — shares, expenses, settlements and group categories (FR-07,
  FR-11); merged.
- DISC-001-06c (Budget Spending and Rollover) — the conversion, payer-movement and name-matching rules
  reused by FR-06 and FR-07; on the base branch of this ticket.
- DISC-001-07b (Crypto Prices and Daily Portfolio Snapshots) — `portfolio_value_snapshots` (FR-10);
  merged.
- PRD 10 (Credit Cards: Statements & Installments) — installments, statements and their dates (FR-08,
  FR-12); merged.
- Database migration: 0038 (one history table of rates and its seed), its journal `when` greater than
  the maximum on `main` when it merges.

## Decision Log
- 2026-10-12: Parent PRD split into four sub-tickets by the owner: 09a reports API, 09b dashboard API,
  09c dashboard screens and navigation with the theme choice (parent FR-23), 09d reports screens. This
  one covers parent FR-15 to FR-20, FR-22 and NFR-02. Parent IDs map as: FR-15 to FR-01, FR-16 to FR-03,
  FR-17 to FR-04, FR-18 to FR-05, FR-19 to FR-06, FR-20 to FR-13, FR-22 to FR-16, NFR-02 to NFR-01,
  AC-20 to AC-01, AC-21 to AC-04, AC-22 to AC-07, AC-23 to AC-09, AC-24 to AC-11, AC-25 to AC-15, AC-26
  to AC-37, AC-28 to AC-43, AC-29 to AC-44. New in this ticket: FR-02, FR-07 to FR-12, FR-14, FR-15,
  NFR-02 to NFR-04 and the criteria not listed. AC-22 and AC-23 of the parent are API behaviour here;
  the bars and the chart are 09d.
- 2026-10-12: Proposed by the model, for owner ratification (1): three endpoints under a new `reports`
  module of `apps/api`, all `GET` and read-only: `/reports/expenses-by-category`,
  `/reports/income-expenses` and `/reports/net-worth`, with query parameters `from` and `to` (local
  dates `YYYY-MM-DD`), and `accountId` and `tag` on the first two. Amounts are integer strings in minor
  units of the display currency. Alternative: one endpoint with a `report` parameter, which mixes three
  response shapes.
- 2026-10-12: Proposed by the model, for owner ratification (2): `exchange_rates` holds one row per rate
  type that each refresh replaces in place (schema `exchange_rates`, primary key `rate_type`), so parent
  FR-20 cannot be met with the current schema. This ticket adds a table `exchange_rate_history` with
  `rate_type`, `rate_date`, `buy`, `sell` and `recorded_at`, one row per rate type and calendar day
  (Argentina date) holding the last values of that day, written by the existing refresh and seeded by
  the migration from the rows stored today. Alternatives: use the frozen rates of the user's own
  movements as a history, which exists only for days with a movement; or convert every month with
  today's rate, which breaks parent FR-20.
- 2026-10-12: Proposed by the model, for owner ratification (3): a month end with no history row on or
  before it (every month before the seed) is returned with its ARS and USD components, a null converted
  total and the reason "no rate"; the response never falls back to a later rate. Consequence: right
  after release, past months of the net worth chart have no converted line until the screens decide how
  to draw them (09d). Alternative: use the earliest stored rate for older months, which contradicts the
  "on or before" rule.
- 2026-10-12: Proposed by the model, for owner ratification (4): the balance of an account at a month end
  is rebuilt, not read from a stored history: its opening balance plus the signed movements and
  settlement payments dated before the first instant after that month end in the user's time zone (the
  rule of the balance read by the accounts module, limited by date). The opening balance is treated as
  the balance before the first movement whatever the creation date of the account, and archived accounts
  are left out of every point, like the account totals. Alternatives: store a balance snapshot per
  account and month (a write path and a migration), or include archived accounts, which makes the
  current point differ from the dashboard.
- 2026-10-12: Proposed by the model, for owner ratification (5): investments in a past point come from
  `portfolio_value_snapshots` only: the latest snapshot of each portfolio on or before the last day of
  the month, per currency. A month before the first snapshot of a portfolio created before that month
  end counts 0 for it and marks the point `investmentsIncomplete`; holdings and prices of past days are
  not reconstructed because prices were never recorded. Alternative: value past months with today's
  holdings and prices, which shows a value that never existed.
- 2026-10-12: Proposed by the model, for owner ratification (6): the group part of a point is the user's
  net balance per currency, from expenses and settlements dated up to the month end (paid minus shares
  plus legs, the formula of the group balances), summed over the user's memberships; positive balances
  are receivables and negative ones are debts, and their sum is the amount that enters net worth, so the
  two are not returned apart. The group part is converted only with the month-end rate of FR-13, never
  with a frozen rate. Alternative: leave groups out of the series, which makes the current point differ
  from the dashboard formula of parent FR-01.
- 2026-10-12: Proposed by the model, for owner ratification (7): the pending installment debt of a point
  is the sum of the installments of purchases with a purchase date on or before the month end whose
  statement closing date is after it, taken from the statements as stored now; a purchase deleted or
  cancelled later changes the past points. Alternative: store the debt at each month end, a write path
  that does not exist.
- 2026-10-12: Proposed by the model, for owner ratification (8): the point of the current month is dated
  today in the user's time zone, not the last day of the month, and uses the latest stored rate (parent
  FR-02); every other point uses its month end. A request whose range includes the current month
  therefore returns a last point dated today.
- 2026-10-12: Proposed by the model, for owner ratification (9): the expense report groups by top-level
  category (subcategories added to the parent, as the categories have one level). A group share goes to
  the personal top-level category whose effective name matches the group category name
  case-insensitively (the 06c rule, subcategory names included); a share that matches none goes to one
  row with a null category id. Alternative: show group categories as their own rows, which splits one
  concept (Food) into two rows.
- 2026-10-12: Proposed by the model, for owner ratification (10): installments count as expenses in the
  month of the due date of their statement and are left out of any report filtered by account or tag,
  because an installment has no account and no tags. An installment in the other currency is left out
  and counted in the response, because the installment tables store no frozen rate; a rate is never
  guessed. Alternative: convert it with the rate of the purchase date from the new history, which is a
  live-style rate and would disagree with the budgets.
- 2026-10-12: Proposed by the model, for owner ratification (11): with an account or tag filter the
  group shares are left out as well, because a share belongs to no account of the user and has no tags;
  only personal movements are reported. Without a filter shares are included (parent FR-22, AC-29).
- 2026-10-12: Proposed by the model, for owner ratification (12): ranges are local dates, both ends
  inclusive, and the limit counts the calendar months the range touches (24 for the category and net
  worth reports, 12 for the income and expenses report, whose default is the 12 months ending in the
  current month); a `to` later than today is rejected with 400. Parent FR-16 says only "last 12 months";
  accepting `from` and `to` up to 12 months follows parent FR-18 (filter by date range). Alternative:
  fix the window and ignore the dates for that report.
- 2026-10-12: Proposed by the model, for owner ratification (13): the tag filter takes the tag name,
  compared case-insensitively like the movements list; a name the user does not have answers 404, which
  is also what another user's tag answers, so a request cannot tell the two apart (parent AC-28).
- 2026-10-12: Proposed by the model, for owner ratification (14): the USD component is converted with the
  sell rate of the default rate type (parent AC-02 uses the sell rate), and an ARS display currency
  multiplies the USD component by it; a USD display currency divides the ARS component by it, with the
  rounding of `convertMinorUnits` in `packages/shared`.
- 2026-10-12: Proposed by the model, for owner ratification (15): the reports are computed on the fly
  with aggregated SQL (one statement per source, bucketed by month in the user's time zone), with no
  precomputed month-end snapshot; parent Risks leave that choice to PLAN and it is revisited only if the
  benchmark of NFR-01 fails. The migration number 0038 is provisional and renumbered at merge.

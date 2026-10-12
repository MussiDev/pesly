# PRD DISC-001-09b: Dashboard API

| Field | Value |
|-------|-------|
| Ticket | DISC-001-09b |
| Tracker | none |
| Date | 2026-10-12 |
| PRD loops | 0 |
| Loops since last human decision | 0 |

## Context and Problem
Second of four sub-tickets of Dashboard & Reports (parent index: `prd-DISC-001-09.md`; 09a reports API is
merged, 09c is the dashboard screens and navigation with the theme choice, 09d the reports screens). The
home screen of 09c has to answer in one glance how much the user is worth, how this month is going, what
is coming and what needs attention. Today that means calling the accounts, investments, budgets,
recurring, credit cards and groups endpoints separately and adding the slices up on the phone, with the
risk that the numbers disagree with the reports. This ticket adds one read model: a new `dashboard` module
of `apps/api` with a single read-only endpoint, `GET /dashboard`, that returns everything the home screen
draws except the net worth chart and the report screens (those are the endpoints of 09a, which 09c calls
as they are).

The endpoint composes what exists instead of re-deriving it: the flow rules (frozen rate, payer movement
left out and the share counted, installments by the due-date month of their statement) and the net worth
rules of `apps/api/src/reports` (09a), the budget calculation of `apps/api/src/budgets`
(`computeSpending`, DISC-001-06c), the recurring payments and credit card statements already stored, and
the group balance formula of `apps/api/src/groups` (`balancesByCurrency`). Investigation of the code found
three facts that shape the scope, each recorded in the Decision Log for owner ratification: (1) failed
syncs and group conflicts live only in the device queue (PRD 04, IndexedDB), so the server cannot list
them and the "Do these first" list of this endpoint carries only the server-side items; (2) the parent
dashboard has no goals widget, so goals are not read; (3) no migration is needed, because every figure is
computed from tables that exist, including the stored exchange rate of the user's default rate type.
Requirement IDs were renumbered for this sub-ticket; the parent IDs are in the Decision Log.

## Goals
- Return the whole home read model in one request, as JSON the 09c screen draws directly, with every
  amount as an exact integer string in minor units.
- Keep ARS and USD apart wherever the number is a stock or a debt, and convert to the display currency only
  where the parent defines it (flows with the frozen rate, the net worth total with today's stored rate).
- Make the numbers agree with 09a and with the budgets, by calling the same use cases and domain rules
  rather than copying them.
- Never call an external service in the request and never use a rate that is not stored.
- Answer in under 1 s at p95 for a user with 100,000 movements, 50 budgets, 500 holdings and 10 groups.

## Functional Requirements
- FR-01: The system must return, for `GET /dashboard`, one JSON object with the sections `netWorth`,
  `month`, `categories`, `budgets`, `upcoming`, `actions`, `groups`, `insight` and `firstSteps`, accepting
  no query parameter, with every amount as an exact integer string in minor units.
- FR-02: The system must return in `netWorth` the ARS part and the USD part of the user's net worth now,
  each the sum of the balances of the non-archived accounts, the value of the investments, what group
  members owe the user minus what the user owes them, minus the credit card installments in statements not
  yet closed, with the four parts also returned per currency.
- FR-03: The system must return in `netWorth` a `total` in the display currency, converting the USD part
  with the latest stored sell rate of the user's default rate type, and a null `total` with the reason
  `no_rate` when the USD part is not zero and no rate is stored.
- FR-04: The system must value the investments of `netWorth` from the holdings and the prices stored now,
  per valuation currency, count 0 for a holding with no price, and return the number of holdings without a
  price.
- FR-05: The system must return in `month` the expenses, the income and the net result (income minus
  expenses) from the first day of the current month to today in the user's time zone, in the display
  currency, using the flow rules of the reports module.
- FR-06: The system must return, for each value of `month`, the change against the same period of the
  previous month (day 1 to the same day of the month, clamped to the last day of a shorter month) as a
  whole percent, and a null change when the previous value is 0.
- FR-07: The system must return in `categories` the current month's expenses to date by top-level
  category, each with its amount in the display currency and its share of the total as a whole percent
  rounded down, ordered by amount from the largest.
- FR-08: The system must return in `budgets` up to 3 budgets of the current month with the highest
  percentage used, each with its own currency, its amount available, its amount spent, its percentage used
  and a status of `on_track` below 80%, `close` from 80% to 99% and `over` from 100%.
- FR-09: The system must return in `upcoming` the scheduled recurring payment dates and the credit card
  statement due dates from tomorrow through the next 7 days, ordered by date, at most 20 entries, each with
  its kind, date, name and amount in its own currency.
- FR-10: The system must return in `actions` the pending and overdue recurring occurrences and the closed
  credit card statements that are unpaid or partly paid and due within 3 days or already past due, at most
  20 items, overdue items first, each with its kind and the id of what resolves it.
- FR-11: The system must return in `groups`, per currency and never mixed, the total that group members
  owe the user and the total the user owes, adding the positive and the negative net balances of the
  user's groups.
- FR-12: The system must return in `insight` the current month's top category by spending with its amount,
  its share of the month's total as a whole percent, and its change against the average of the previous 3
  complete months as a whole percent, or a null change when fewer than 3 previous months have expenses, and
  a null insight when the month has no expense.
- FR-13: The system must return in `firstSteps` whether the user has at least one non-archived account and
  at least one movement, and a flag `show` that is true when either is missing.
- FR-14: The system must read only data the user owns and the user's own shares of group expenses, only
  groups the user is a member of, and must answer 401 without a valid session and the verified-email error
  of the reports module for an unverified user.
- FR-15: The system must reuse the use cases and domain rules of the reports, budgets, recurring, credit
  cards, investments and groups modules for FR-02 to FR-12 instead of implementing a second copy, so that a
  figure equals the one the module's own endpoint returns.
- FR-16: The system must fail the whole request with the standard error response when any of its sources
  fails, and must never return a section filled with a guessed or partial value.

## Non-Functional Requirements
- NFR-01: The dashboard must be returned in under 1 s at p95, measured server-side, for a user with
  100,000 movements, 50 budgets, 500 holdings and 10 groups (parent NFR-01).
- NFR-02: Money must be computed and returned as 64-bit integers in minor units, exchange rates as
  integers scaled by 10,000, percentages as whole numbers, and 0 floating-point values anywhere in the
  feature.
- NFR-03: The feature must add 0 database migrations, 0 new tables or columns and 0 new runtime
  dependencies.
- NFR-04: A dashboard request must make 0 outbound calls to dolarapi.com, CoinGecko or any other external
  service.
- NFR-05: A dashboard request must run at most 40 SQL statements, none of them per movement, per month or
  per holding.
- NFR-06: The response must be at most 32 KB for the user of NFR-01.

## Acceptance Criteria
- AC-01 (FR-01): WHEN a signed-in user requests `GET /dashboard`, THE system SHALL answer 200 with the
  sections `netWorth`, `month`, `categories`, `budgets`, `upcoming`, `actions`, `groups`, `insight` and
  `firstSteps`.
- AC-02 (FR-01): IF the request has any query parameter, THEN THE system SHALL answer 400 and return no
  data.
- AC-03 (FR-01): WHEN a response contains an amount, THE system SHALL serialize it as an integer string
  such as `"142000000"` in minor units and never as a number.
- AC-04 (FR-02): WHEN a user has accounts of 1,000,000.00 ARS, investments of 500,000.00 ARS, group
  receivables of 50,000.00 ARS, group debts of 20,000.00 ARS and pending installments of 110,000.00 ARS,
  THE system SHALL return an ARS part of 142000000 minor units.
- AC-05 (FR-02): WHEN a user has 1,000.00 USD in accounts and 20.00 USD of group debt, THE system SHALL
  return a USD part of 98000 minor units, without converting it into ARS.
- AC-06 (FR-02): THE system SHALL NOT include an archived account in the net worth.
- AC-07 (FR-02): WHEN a user opens the dashboard, THE system SHALL return the accounts, investments, groups
  and pending installments parts separately, each with its ARS and USD values.
- AC-08 (FR-03): WHEN the display currency is ARS, the USD part is 1,000.00 and the stored sell rate of
  the default rate type is 1,500.0000, THE system SHALL count that part as 1,500,000.00 ARS in the `total`.
- AC-09 (FR-03): IF the USD part is not zero and no rate is stored for the default rate type, THEN THE
  system SHALL return a null `total`, the reason `no_rate` and both currency parts.
- AC-10 (FR-03): WHEN the USD part is 0 and no rate is stored, THE system SHALL return the ARS part as the
  `total` and no reason.
- AC-11 (FR-03): WHEN the display currency is USD and the ARS part is 1,500,000.00 at a rate of 1,500.0000,
  THE system SHALL count it as 1,000.00 USD with the rounding of `convertMinorUnits`.
- AC-12 (FR-04): WHEN a crypto holding has a stored price, THE system SHALL value it from that price
  without calling CoinGecko.
- AC-13 (FR-04): IF a holding has no price, THEN THE system SHALL count 0 for it and return the number of
  holdings without a price.
- AC-14 (FR-05): WHEN in October a user has personal expenses of 200,000.00 ARS, group shares of 30,000.00
  ARS and installments of 10,000.00 ARS, THE system SHALL return October expenses of 240,000.00 ARS.
- AC-15 (FR-05): WHEN in October a user records incomes of 800,000.00 ARS and the expenses are 240,000.00
  ARS, THE system SHALL return an income of 800,000.00 ARS and a net result of 560,000.00 ARS.
- AC-16 (FR-05): WHEN a 20.00 USD expense with a frozen rate of 1,400.0000 appears in the month and the
  display currency is ARS, THE system SHALL count it as 28,000.00 ARS even if today's stored rate is
  different.
- AC-17 (FR-05): WHEN the user paid a group expense of 30,000.00 ARS with a share of 10,000.00 ARS and the
  payment was recorded as a personal expense, THE system SHALL count 10,000.00 ARS and not 30,000.00 ARS.
- AC-18 (FR-05): IF a group share or an installment is in a currency other than the display currency and
  has no frozen rate, THEN THE system SHALL leave it out and return the number of shares and installments
  left out in `month`.
- AC-19 (FR-05): THE system SHALL NOT count a transfer or a currency exchange as income or as an expense.
- AC-20 (FR-06): WHEN expenses from 1 to 15 October are 240,000.00 ARS and from 1 to 15 September were
  200,000.00 ARS, THE system SHALL return a change of 20 for the expenses.
- AC-21 (FR-06): IF the previous month's value for the same period is 0, THEN THE system SHALL return a
  null change for it.
- AC-22 (FR-06): WHEN today is 31 March, THE system SHALL compare 1 to 31 March with 1 to 28 February
  (29 in a leap year).
- AC-23 (FR-07): WHEN October expenses are 120,000.00 ARS in Food and 80,000.00 ARS in Transport, THE
  system SHALL return Food with 12000000 minor units and a share of 60, then Transport with 8000000 minor units and a share of 40.
- AC-24 (FR-07): WHEN an expense is in the subcategory Groceries of the parent Food, THE system SHALL add
  it to Food and return no row for Groceries.
- AC-25 (FR-07): WHEN the month has no expense, THE system SHALL return an empty `categories` list.
- AC-26 (FR-08): WHEN a user has budgets at 50%, 85%, 105% and 30% used, THE system SHALL return the 105%
  budget as `over`, the 85% one as `close` and the 50% one as `on_track`, in that order, and not the 30%
  one.
- AC-27 (FR-08): WHEN a budget is at exactly 80% or exactly 100% used, THE system SHALL return `close` for
  80% and `over` for 100%.
- AC-28 (FR-08): WHEN a user has a USD budget and an ARS budget, THE system SHALL return each with its own
  currency and compare their percentages without converting either amount.
- AC-29 (FR-08): WHILE a user has no budget in force this month, THE system SHALL return an empty
  `budgets` list.
- AC-30 (FR-09): WHEN a user has a recurring payment due in 3 days and a card statement due in 6 days, THE
  system SHALL list both, the payment first.
- AC-31 (FR-09): THE system SHALL NOT list an entry due later than today plus 7 days or one that is
  already paid.
- AC-32 (FR-09): WHEN more than 20 entries fall in the next 7 days, THE system SHALL return the 20 earliest
  by date.
- AC-33 (FR-10): WHEN a user has one pending occurrence, one overdue occurrence and one unpaid closed
  statement due in 2 days, THE system SHALL list those 3 items, the overdue one first, each with the id of
  the occurrence or the statement.
- AC-34 (FR-10): WHILE a user has no item that needs action, THE system SHALL return an empty `actions`
  list.
- AC-35 (FR-10): IF a closed statement is fully paid, THEN THE system SHALL NOT list it in `actions` or in
  `upcoming`.
- AC-36 (FR-11): WHEN group members owe the user 30,000.00 ARS in one group and the user owes 50.00 USD in
  another, THE system SHALL return "owed to you" 3000000 ARS and "you owe" 5000 USD, with 0 in the other
  two cells.
- AC-37 (FR-11): WHEN the user is owed 30,000.00 ARS in one group and owes 20,000.00 ARS in another, THE
  system SHALL return both amounts separately and not their difference.
- AC-38 (FR-11): WHEN the user left a group and owes nothing in it, THE system SHALL not count that group.
- AC-39 (FR-12): WHEN Restaurants is 32% of October spending and 40% above its average of July to
  September, THE system SHALL return the insight with Restaurants, a share of 32 and a change of 40.
- AC-40 (FR-12): IF fewer than 3 of the previous 3 months have expenses, THEN THE system SHALL return the
  insight with a null change.
- AC-41 (FR-12): IF the month has no expense, THEN THE system SHALL return a null insight.
- AC-42 (FR-13): WHILE a user has no non-archived account or no movement, THE system SHALL return `show`
  true and still return the other sections with zero values.
- AC-43 (FR-13): WHEN a user has an account and a movement, THE system SHALL return `show` false.
- AC-44 (FR-14): IF the request has no valid session, THEN THE system SHALL answer 401 and return no data.
- AC-45 (FR-14): WHEN two users have data, THE system SHALL return in each response only the data of the
  caller and, for groups, only the caller's own shares and balances.
- AC-46 (FR-14): IF the user's email is not verified, THEN THE system SHALL answer with the verified-email
  error of the reports routes and return no data.
- AC-47 (FR-15): WHEN the same user calls `GET /dashboard` and the 09a reports for the same date, THE
  system SHALL return month expenses equal to the report total and a net worth ARS part and USD part equal
  to the last point of `GET /reports/net-worth`, except the investments part (FR-04).
- AC-48 (FR-15): WHEN the budgets endpoint returns a percentage used for a budget, THE system SHALL return
  the same percentage in `budgets`.
- AC-49 (FR-16): IF a source read fails, THEN THE system SHALL answer the standard 5xx error response and
  return no section.
- AC-50 (NFR-01): WHEN a user with 100,000 movements, 50 budgets, 500 holdings and 10 groups requests the
  dashboard, THE system SHALL answer in under 1 s at p95 over 20 runs.
- AC-51 (NFR-02): WHEN the dashboard is computed, THE system SHALL return every amount as an exact integer
  string and SHALL compute every conversion and percentage with integer arithmetic.
- AC-52 (NFR-03): WHEN the feature is built, THE system SHALL add 0 files under `apps/api/drizzle` and 0
  runtime dependencies to `package.json`.
- AC-53 (NFR-04): WHEN the dashboard is requested, THE system SHALL make 0 outbound calls to dolarapi.com,
  CoinGecko or any other external service.
- AC-54 (NFR-05): WHEN the dashboard is requested for the user of NFR-01, THE system SHALL run at most 40
  SQL statements.
- AC-55 (NFR-06): WHEN the dashboard is returned for the user of NFR-01, THE system SHALL answer a body of
  at most 32 KB.

## Out of Scope
- Web screens, the KPI cards, the net worth chart, the "Do these first" rendering and the navigation
  (DISC-001-09c), the theme choice (09c) and the report screens (09d).
- The three reports and the net worth series (DISC-001-09a, merged): the home chart is drawn from
  `GET /reports/net-worth`.
- Failed syncs and group conflicts in "Do these first": they exist only in the device queue (PRD 04c and
  04e), so 09c adds them to the list the endpoint returns.
- Savings goals: the parent dashboard has no goals widget.
- Prose of the insight and of the status pills: the endpoint returns structured values and 09c writes the
  text through the i18n catalogs.
- Forecasts, user-customizable widgets, group-level reports and exports (parent Out of Scope).
- Viewing the dashboard offline (parent Out of Scope).
- A database migration, a precomputed snapshot table or a cache: the dashboard is computed on the fly, and
  a snapshot is considered only if the benchmark of NFR-01 fails.

## Risks and Mitigations
- **Numbers disagree with the reports or the module screens** → the endpoint calls the 09a use cases, the
  budget calculation and the group balance functions instead of copying them (FR-15), and criteria compare
  it with those endpoints (AC-47, AC-48).
- **The net worth of the dashboard differs from the chart's last point** → both use the same parts; the
  only difference is the investments part, valued now here and from the daily snapshot there (FR-04),
  recorded as an owner decision (Decision Log 4).
- **Conversion mixes currencies silently** → only flows use the frozen rate and only the net worth total
  uses the stored rate; budgets, upcoming entries and group balances stay in their own currency (AC-28,
  AC-36).
- **No rate is stored** → the total is null with a reason and both parts remain (AC-09), never a guessed
  rate and never an external call (AC-53).
- **The response takes too long** → one aggregated read per source, no query per movement, month or
  holding, a ceiling of 40 statements (NFR-05), a benchmark (AC-50); PLAN may add an index if it fails.
- **A user reads another user's data** → every query takes the request's `AccessScope`; the endpoint has
  no id parameter, so there is nothing to answer 404 for, and the groups read is limited to the caller's
  memberships (AC-45).
- **The upcoming list misses a payment that no job has materialized yet** → pending occurrences come from
  the stored rows the recurring module already maintains; PLAN confirms whether the request materializes
  them as `GET /recurring/upcoming` does (Decision Log 7).
- **The client lists items the server does not know** → failed syncs and conflicts are the client's to add
  (Out of Scope); the endpoint says nothing about them, so a missing item is never reported as resolved.
- **A section returns stale or partial data after a failure** → the whole request fails (FR-16, AC-49).

## Dependencies
- PRD 01 (Identity & Access) — session, verified email, display currency, default rate type and time zone
  (FR-03, FR-05, FR-14); merged.
- PRD 02 (Accounts & Categories) — account balances, archived state and categories (FR-02, FR-07, FR-13);
  merged.
- PRD 03 (Movements & Exchange Rates) — movements, frozen rates and the stored current rates (FR-03,
  FR-05, FR-13); merged.
- PRD 05 (Groups & Expense Splitting) — shares, balances and settlements (FR-02, FR-05, FR-11); merged.
- DISC-001-06c (Budget Spending and Rollover) — `computeSpending`, the percentage used and the
  conversion rules (FR-08); merged.
- PRD 07 (Investments) — holdings and stored prices (FR-04); merged.
- PRD 08 (Recurring Payments & Reminders) — stored occurrences and the payment schedules (FR-09, FR-10);
  merged.
- PRD 10 (Credit Cards: Statements & Installments) — statements, due dates, payment status and the
  installment debt (FR-02, FR-05, FR-09, FR-10); merged.
- DISC-001-09a (Reports API) — the flow, category and net worth use cases and domain rules (FR-02, FR-05,
  FR-07, FR-12, FR-15); merged.
- Database migration: none.

## Decision Log
- 2026-10-12: Parent PRD split into four sub-tickets by the owner: 09a reports API, 09b dashboard API,
  09c dashboard screens and navigation with the theme choice (parent FR-23), 09d reports screens. This one
  covers parent FR-01 to FR-07, FR-09 to FR-14, FR-21, FR-22 and NFR-01. Parent IDs map as: FR-01 and FR-03
  to FR-02, FR-02 to FR-03, FR-04 to FR-06 to FR-05, FR-07 to FR-06, FR-09 to FR-07, FR-10 to FR-08, FR-11
  to FR-09, FR-12 to FR-10, FR-13 to FR-11, FR-14 to FR-12, FR-21 to FR-13, FR-22 to FR-14, NFR-01 to
  NFR-01; AC-01 to AC-04, AC-02 and AC-03 to AC-08 and AC-09, AC-04 to AC-07, AC-05 to AC-14, AC-06 and
  AC-07 to AC-15, AC-08 to AC-20, AC-09 to AC-21, AC-12 to AC-23, AC-13 to AC-26, AC-14 to AC-30, AC-15 to
  AC-33, AC-16 to AC-34, AC-17 to AC-36, AC-18 and AC-19 to AC-39 and AC-40, AC-27 to AC-42. The net worth
  chart (parent FR-08, AC-10, AC-11) is `GET /reports/net-worth` of 09a, drawn by 09c. New in this ticket:
  FR-01, FR-04, FR-08 status fields, FR-15, FR-16, NFR-02 to NFR-06 and the criteria not listed.
- 2026-10-12: Proposed by the model, for owner ratification (1): one endpoint, `GET /dashboard`, in a new
  `dashboard` module of `apps/api` (hexagonal: ports, a use case that composes the other modules' use cases
  and Drizzle readers, a presenter and a route; the only file importing other modules' tables follows the
  `foreign-relations.ts` pattern of `reports`), with no query parameter and `requireSession` plus
  `requireVerifiedEmail` like the reports. The response is validated with a Zod schema added to
  `packages/shared`. Alternative: one endpoint per widget, which costs the phone seven round trips and lets
  the widgets disagree.
- 2026-10-12: Proposed by the model, for owner ratification (2): amounts are integer strings in minor
  units (the `exactIntegerStringSchema` of 09a); percentages are whole numbers (not money, so JSON numbers);
  dates are `YYYY-MM-DD` local dates. Category and group fields carry ids and `defaultKey` for the i18n
  catalogs, never prose.
- 2026-10-12: Proposed by the model, for owner ratification (3): per-currency rule. `netWorth` returns the
  ARS part and the USD part unconverted plus a `total` in the display currency; `month`, `categories` and
  `insight` are in the display currency through the frozen rates of 09a; `budgets`, `upcoming` and `groups`
  stay in their own currency. Owed and owing are computed per group and per currency and then summed by
  sign, so a debt in one group does not cancel a receivable in another (the 09a series nets them because it
  feeds one number; the home card shows both, parent FR-13).
- 2026-10-12: Proposed by the model, for owner ratification (4): the investments of the net worth now are
  valued from the holdings and the prices stored at request time (PRD 07, no external call), while the 09a
  series reads the daily snapshot, so the dashboard and the chart's last point can differ by the price
  movement since the last snapshot. Alternative: take the latest snapshot, which makes the two equal and
  shows a value up to a day old. This is open question 1 of the report.
- 2026-10-12: Proposed by the model, for owner ratification (5): "month to date" and "same period of the
  previous month" are two calls of the 09a flow rules with a range each; installments are dated by the
  due-date month of their statement, not by the day, so both periods carry the whole month's installments
  of their month. The percent change is `(current - previous) * 100 / previous`, truncated toward zero,
  computed with bigint.
- 2026-10-12: Proposed by the model, for owner ratification (6): the insight's change compares the current
  month-to-date amount of the top category with the average of the same category over the previous 3
  complete months, as `(current * 3 - sum3) * 100 / sum3` truncated toward zero; with fewer than 3 of those
  months holding any expense the change is null (parent AC-19). Shares that match no personal category form
  one candidate with a null category id.
- 2026-10-12: Proposed by the model, for owner ratification (7): `upcoming` holds the `scheduled` dates of
  active recurring payments and the due dates of unpaid statements from tomorrow to today plus 7 days;
  occurrences that are pending (due today) or overdue and closed statements due within 3 days or past due
  go only to `actions`, so one item never appears in both lists. Statements are read as stored (the daily
  jobs of the credit cards module create them). Whether the request also materializes the pending
  occurrences, as `GET /recurring/upcoming` does with an idempotent write, is open question 2 of the report.
- 2026-10-12: Proposed by the model, for owner ratification (8): failed syncs and group conflicts (parent
  FR-12) are device state of PRD 04 and are not stored on the server; the endpoint returns the server-side
  items and 09c appends the local ones. The `firstSteps` flag counts non-archived accounts and any movement,
  and the endpoint still returns the other sections with zero values when it is true, so the screen decides
  what to hide.
- 2026-10-12: Proposed by the model, for owner ratification (9): no migration. The latest stored rate of
  the default rate type is read from `exchange_rates`, the same source the reports use for the current
  point; the history table of 09a is not needed for "now".

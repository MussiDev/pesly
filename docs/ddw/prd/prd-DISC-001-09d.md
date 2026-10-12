# PRD DISC-001-09d: Reports Screens

| Field | Value |
|-------|-------|
| Ticket | DISC-001-09d |
| Tracker | none |
| Date | 2026-10-12 |
| PRD loops | 0 |
| Loops since last human decision | 0 |

## Context and Problem
Last of four sub-tickets of Dashboard & Reports (parent index: `prd-DISC-001-09.md`; 09a is the reports
API, merged; 09b is the dashboard API, merged; 09c is the dashboard screen, merged; 09d is this ticket).
The API already answers three reports, all `GET`, read-only and scoped to the signed-in user: expenses by
category (`/reports/expenses-by-category`), income against expenses per month (`/reports/income-expenses`)
and net worth per month (`/reports/net-worth`). The web app reads only one of them, and only for the
dashboard chart (`getNetWorthSeries` in `apps/web/src/lib/api-client.ts`, with no query). There is no
reports route, no navigation entry and no link from the dashboard, so a user cannot choose a date range,
filter by account or tag, or see more than the last 12 months of net worth. This ticket adds the three
report screens on top of the existing API. It adds no API change, no migration and no runtime dependency.

Investigation of the code and of the 09a contract found six facts that shape the scope; each is recorded in
the Decision Log for owner ratification:
1. The query is only `from`, `to` (local dates `YYYY-MM-DD`), plus `accountId` and `tag` on the first two
   reports; the net worth report takes no account or tag filter. The limits are 24 months for the category
   and net worth reports and 12 for income against expenses (`REPORT_MAX_MONTHS` in `packages/shared`). The
   defaults are the current month for categories and the last 12 months for the other two. A `to` after
   today, a `from` after `to` or a range over the limit answers 400 naming `query.from` or `query.to`; an
   account or tag that is not the user's answers 404.
2. There is no display currency parameter. Every response carries the `currency` the API chose, which is
   the user's display currency from the profile (PRD 01, FR-21). The screens cannot switch currency per
   report without an API change, which is out of scope.
3. The category response returns amounts and a `total`, not percentages; a row with a null `categoryId`
   groups the group shares that match no personal category, and a row carries either a `defaultKey` (a
   default category, named through the catalogs in the user's language) or a `name`.
4. The net worth response carries, per point, the `ars` and `usd` components, a converted `total` that is
   null with the reason `no_rate` when no stored rate exists on or before that month end, and a flag
   `investmentsIncomplete`. Right after release, past months have no converted total (09a Decision Log,
   item 3), so the chart must draw gaps instead of bridging them.
5. The responses count what they could not convert (`unconvertedShareCount`, `unconvertedInstallmentCount`)
   and, under an account or tag filter, leave out installments and group shares (09a Decision Log, items 10
   and 11). Without a notice, a filtered total looks lower than the dashboard for no visible reason.
6. The web app already has the pieces to build on: a chart drawn in plain SVG with the `--chart-1` to
   `--chart-5` theme tokens (`donut-chart.tsx`, `features/dashboard/chart`), a presentational filter bar for
   movements (`movement-filters.tsx`) with a single-tag input container, URL-held filters with shared
   validation (`movement-filters-state.ts`), `pill-tabs`, `empty-state`, `error-state` and `skeleton`
   components, and `formatMoney` and calendar-date formatters. The navigation lists (`nav-items.ts`) have no
   reports entry.

## Goals
- A user opens the reports from the main navigation or from the dashboard and reads, for a range they
  choose, where the money went, how income compares with expenses, and how net worth evolved.
- Every figure on screen is the one the API returned, in the currency the API returned; the client formats
  it and never converts or sums across currencies. The one derived figure, a category's share, is computed
  with integer arithmetic only.
- The reports read well in light and dark, from 360 px to 1920 px, never rely on color alone and are usable
  with the keyboard and a screen reader.
- Empty, loading, failed and out-of-range situations each say what happened and what to do next.
- Every string comes from the Spanish and English catalogs.

## Functional Requirements
- FR-01: The system must provide a reports area with three screens, expenses by category, income against
  expenses and net worth, each on its own route, with one tab bar to move between them.
- FR-02: The system must list the reports area in the side menu and in the More list of the navigation,
  highlighted as current on the three report routes.
- FR-03: The system must link from the dashboard's categories card to the expenses by category report and
  from the dashboard's net worth card to the net worth report.
- FR-04: The system must show on the expenses by category screen the total of the range and, per category, its
  name, its amount and its share of the total, ordered by amount from the largest.
- FR-05: The system must draw the expenses by category as a ring chart of the five largest categories plus
  one segment for all the rest, while the list below it shows every category.
- FR-06: The system must name each category row with the catalog name for a default category, the stored name
  for any other, and a catalog label for the row with no category id.
- FR-07: The system must show on the income against expenses screen one income bar and one expense bar per
  month of the range, and under each month its net result (income minus expenses) with a sign.
- FR-08: The system must draw the net worth screen as an area and line chart of the converted total per
  point, with a tooltip of the point's date and value that works with pointer, touch and keyboard.
- FR-09: The system must show for the selected net worth point its ARS and USD components without
  conversion, next to the converted total.
- FR-10: The system must draw a gap, and not a line, over a net worth point whose converted total is
  missing, and must say in text that no exchange rate exists for that month end.
- FR-11: The system must tell the user, on a net worth point flagged `investmentsIncomplete`, that the
  investments of that month are not fully counted.
- FR-12: The system must let the user filter the two flow reports by date range, by one account and by one
  tag, and the net worth report by date range only.
- FR-13: The system must offer date range presets (this month, last 3 months, last 12 months and, where the
  report allows it, last 24 months) and a custom range with a from and a to date.
- FR-14: The system must keep the filters of a report in the page address, validate each value with the
  shared query schemas, and ignore a malformed value without dropping the others.
- FR-15: The system must refuse to send a custom range whose `from` is after its `to`, or longer than the
  report's limit, and must say the limit in months next to the date fields.
- FR-16: The system must show the currency of every report next to its figures and tell the user that it is
  the display currency of their profile, with a link to change it in the profile settings.
- FR-17: The system must show, when a response counts shares or installments left out of the conversion, a notice
  with those counts.
- FR-18: The system must show, while an account or tag filter is active on a flow report, a notice that card
  installments and group shares are not part of a filtered report.
- FR-19: The system must show a loading state with the final layout while a report is requested, an empty
  state when the range has no data, and an error state with a retry button when the request fails.
- FR-20: The system must show, when the device is offline, a message that reports need a connection, with a
  retry button, and must not show figures from an earlier request.
- FR-21: The system must offer under each chart a text alternative with the same figures, so that no value is
  available only in the drawing.
- FR-22: The system must request a report once per filter change, and must ignore the answer of a request that
  a newer one replaced.
- FR-23: The system must send the user to the sign-in page when a report request answers 401.

## Non-Functional Requirements
- NFR-01: Each report screen must show its loading layout in < 1 s and its content must reach Largest
  Contentful Paint in < 2.5 s at p75 on a mid-range phone over 4G (reference: 4 GB RAM, 2021 hardware; 10
  Mbps down, 50 ms latency), once the API answers in < 2 s (09a NFR-01).
- NFR-02: A filter change must produce exactly 1 report request, and at most 1 report request must be in
  flight per screen.
- NFR-03: The three screens must be usable from 360 px to 1920 px wide with 0 horizontal scroll of the page,
  including with the system text size at 200%.
- NFR-04: Text must have a contrast ratio of at least 4.5:1, and chart marks, bar edges and focus outlines at
  least 3:1, against their background, in both light and dark themes (WCAG 2.1 AA, 1.4.3 and 1.4.11).
- NFR-05: 100% of the interactive controls (tabs, presets, selects, date fields, buttons, chart plot) must
  be reachable and operable with the keyboard alone and must have a touch target of at least 44 px by 44 px.
- NFR-06: 100% of the visible strings, including chart labels, tooltips, notices and the names of ranges, must
  come from the message catalogs, with the same keys in Spanish and English; amounts, dates and months must
  use the locale formatters.
- NFR-07: The change must add no runtime dependency and write no report figure to browser storage, a cache
  or the service worker: 0 additions to the dependency list and 0 stored copies of report data.
- NFR-08: A chart must show at most 24 months or 6 ring segments, and must stay legible at 360 px wide
  (month labels thinned, never overlapping).
- NFR-09: The new web code must keep the project's coverage floor of 80% lines, branches and functions, and
  every FR must be named by at least one automated test.

## Acceptance Criteria
*(EARS: WHEN, WHILE, WHERE and IF ... THEN, each with SHALL; the FR a criterion validates is in parentheses.)*
- AC-01 (FR-01): WHEN a user opens `/reports`, THE system SHALL show the expenses by category screen with a
  tab bar of three tabs named Expenses by category, Income vs expenses and Net worth.
- AC-02 (FR-01): WHEN a user selects the Net worth tab, THE system SHALL open the net worth route and mark that
  tab as the current one for assistive technology.
- AC-03 (FR-01): IF a user opens a report route directly with no active session, THEN THE system SHALL send
  them to the sign-in page and bring them back to that route after signing in.
- AC-04 (FR-02): WHEN a user opens the app at 1024 px wide or more, THE system SHALL list Reports in the side
  menu, in the plan ahead block.
- AC-05 (FR-02): WHEN a user opens the More page on a phone, THE system SHALL list Reports among its
  destinations, and SHALL mark More as current on the report routes.
- AC-06 (FR-03): WHEN a user selects the dashboard's categories card link, THE system SHALL open the expenses
  by category report.
- AC-07 (FR-03): WHEN a user selects the dashboard's net worth card link, THE system SHALL open the net worth
  report.
- AC-08 (FR-04): WHEN the API returns a total of 200,000.00 ARS with Food at 120,000.00 and Transport at
  80,000.00, THE system SHALL show Food with 120,000.00 ARS and 60% first, and Transport with 80,000.00 ARS
  and 40% second.
- AC-09 (FR-04): WHEN the API returns a total of 100.00 ARS with three categories of 33.34, 33.33 and 33.33,
  THE system SHALL show whole-number shares computed with integers, never from floating point, and the
  shown shares SHALL not add up to more than 100%.
- AC-10 (FR-04): IF the total of the range is 0.00, THEN THE system SHALL show the empty state instead of
  categories with a percentage.
- AC-11 (FR-05): WHEN the API returns 8 categories, THE system SHALL draw 6 ring segments, the 5 largest and
  one for the rest, and SHALL list all 8 categories.
- AC-12 (FR-05): WHEN a category has a share under 1%, THE system SHALL list it with its amount and the
  share "<1%".
- AC-13 (FR-06): WHEN a row carries the default key of Food and the language is English, THE system SHALL show
  the name Food, and in Spanish the catalog's Spanish name of that key.
- AC-14 (FR-06): WHEN a row has a null category id, THE system SHALL name it with the catalog label for group
  shares without a matching category.
- AC-15 (FR-07): WHEN the API returns 12 months, THE system SHALL draw one income bar and one expense bar for
  each of them, with the month named in the user's language.
- AC-16 (FR-07): WHEN October has income of 800,000.00 ARS and expenses of 240,000.00 ARS, THE system SHALL
  show a net result of +560,000.00 ARS under October, and for expenses above income a result with a minus sign.
- AC-17 (FR-07): WHILE every month of the range has 0 income and 0 expenses, THE system SHALL show the empty
  state instead of empty bars.
- AC-18 (FR-08): WHEN a user taps or hovers a point of the net worth chart, THE system SHALL show a tooltip with
  that point's date and converted total.
- AC-19 (FR-08): WHEN the chart plot has the focus and the user presses the left or right arrow, THE system SHALL
  move the selection by one point and announce its date and value.
- AC-20 (FR-09): WHEN a user selects the point of 2026-06-30 with 1,000,000.00 ARS and 500.00 USD, THE system
  SHALL show both components in their own currency, next to the converted total.
- AC-21 (FR-10): WHEN a point has a null total with the reason `no_rate`, THE system SHALL leave that month
  without a line segment and SHALL state that no exchange rate exists for that month end.
- AC-22 (FR-10): IF no point of the range has a converted total, THEN THE system SHALL show the ARS and USD
  components per month in a list and a notice that the conversion is unavailable, instead of an empty chart.
- AC-23 (FR-11): WHEN a selected point has `investmentsIncomplete` set, THE system SHALL show a note that the
  investments of that month are not fully counted.
- AC-24 (FR-12): WHEN a user opens a flow report, THE system SHALL offer the date range, an account selector
  and a one-tag input.
- AC-25 (FR-12): WHEN a user opens the net worth report, THE system SHALL offer the date range only, with no
  account or tag control.
- AC-26 (FR-12): WHEN a user filters the category report by the tag "vacations2026", THE system SHALL request
  the report with that tag and show the response.
- AC-27 (FR-12): IF the API answers 404 for an account or a tag filter, THEN THE system SHALL show that the
  filter no longer exists, clear it and offer to reload the report.
- AC-28 (FR-13): WHEN a user selects the preset last 3 months, THE system SHALL request the range that starts on
  the first day of the month two months before the current one and ends today in the user's time zone.
- AC-29 (FR-13): WHERE the report is income against expenses, THE system SHALL not offer the preset last 24
  months.
- AC-30 (FR-14): WHEN a user opens a report address with `?tag=vacations2026&from=2026-01-01`, THE system SHALL
  apply both filters and show them as active.
- AC-31 (FR-14): IF the address carries `from=31-12-2026`, THEN THE system SHALL ignore that value, keep the other
  filters and show the default range.
- AC-32 (FR-15): IF a user enters a `from` date after the `to` date, THEN THE system SHALL not send a request and
  SHALL mark the date fields as invalid with a message.
- AC-33 (FR-15): IF a user picks a range of 13 months on the income against expenses report, THEN THE system SHALL
  not send a request and SHALL state the limit of 12 months.
- AC-34 (FR-15): IF the API answers 400 naming the query field `to` because it is later than today, THEN THE
  system SHALL show a message on the date fields and keep the previous figures hidden.
- AC-35 (FR-16): WHEN a report loads in ARS, THE system SHALL show the code ARS next to the figures, a sentence
  that the currency is the profile's display currency, and a link to the profile settings.
- AC-36 (FR-16): WHEN the API returns the currency USD, THE system SHALL format every amount of that report as USD
  and SHALL not sum or mix it with ARS figures.
- AC-37 (FR-17): WHEN a response has an unconverted share count of 2 and an unconverted installment count of 1,
  THE system SHALL show a notice with those two counts, and WHEN both are 0, THE system SHALL show no notice.
- AC-38 (FR-18): WHILE an account or tag filter is active on a flow report, THE system SHALL show the notice that
  installments and group shares are not part of the report.
- AC-39 (FR-18): WHILE no account or tag filter is active, THE system SHALL not show that notice.
- AC-40 (FR-19): WHILE a report request is in flight, THE system SHALL show a skeleton with the layout of the
  final screen, and the controls SHALL remain operable.
- AC-41 (FR-19): WHEN the range has no movements, THE system SHALL show an empty state that names the range and
  offers to widen it or to record a movement.
- AC-42 (FR-19): IF the request fails with a server error, THEN THE system SHALL show an error state with a retry
  button that stays disabled while the retry is in flight.
- AC-43 (FR-20): IF the device is offline when a report is requested, THEN THE system SHALL show the message that
  reports need a connection and a retry button, and SHALL show no earlier figures.
- AC-44 (FR-20): WHEN the connection returns and the user presses retry, THE system SHALL request the report again
  and show it.
- AC-45 (FR-21): WHEN a chart is on screen, THE system SHALL render below it a list with the same figures, one
  row per category, month or point.
- AC-46 (FR-21): WHEN a screen reader reaches a chart, THE system SHALL expose its name and a summary of the range
  and the total, and SHALL hide the decorative drawing from the reading order.
- AC-47 (FR-22): WHEN a user changes the account filter twice within one second, THE system SHALL show the answer
  of the second request only, even if the first answers later.
- AC-48 (FR-23): IF a report request answers 401 and the session cannot be refreshed, THEN THE system SHALL send
  the user to the sign-in page and SHALL discard the report figures from memory.
- AC-49 (FR-04): WHEN a user is signed in with Spanish selected, THE system SHALL show every label, notice and
  month of the reports in Spanish, and the amounts with the Spanish number format.
- AC-50 (FR-12): WHILE a report is shown at 360 px wide, THE system SHALL collapse the filters behind one
  control that names the number of active filters, and SHALL show them open at 1024 px or wider.

## Out of Scope
- Any API, migration or contract change: the reports are 09a.
- A currency switch per report, which the API cannot serve (Decision Log).
- Account or tag filters on net worth, and a category filter on any report (not in the API).
- Opening the movements behind a category, month or point (drill-down).
- Exporting to CSV, PDF or an image, and sharing a report as a link to a snapshot.
- Group-level reports, forecasts, projections and AI insights (parent Out of Scope).
- Report periods other than months, and comparing two ranges.
- Viewing reports offline or from a stored copy (parent Out of Scope).
- A charting library; the charts are drawn in SVG with the existing theme tokens.
- Changes to the dashboard beyond the two links of FR-03, and to pages other than the navigation lists.

## Risks and Mitigations
- **Past months without a rate leave the net worth chart almost empty right after release** -> gaps and a
  per-month text reason (FR-10), a components list when nothing converts (AC-22), and the cause stated in the
  Decision Log so the owner knows before release.
- **A filtered total looks lower than the dashboard and the user distrusts the numbers** -> the permanent
  notice under an active filter (FR-18) and the unconverted counts (FR-17).
- **A chart is unreadable at 360 px with 24 months** -> thinned month labels, a ring limited to 6 segments, and a
  list with every figure (NFR-08, FR-21).
- **Color-only meaning excludes color-blind users** -> every segment and bar has a text label or a list row,
  and the net result carries a sign (NFR-04, FR-07, FR-21).
- **Rapid filter changes show a stale answer** -> one request per change and a discarded stale answer (NFR-02,
  FR-22, AC-47).
- **Financial figures leak into the device** -> state in React only, no storage or cache (NFR-07).
- **Shares add to 99% or 101% because of rounding** -> integer arithmetic with the leftover given to the largest
  category, and a test with thirds (AC-09).
- **A date typed in another format breaks the request** -> every filter value is validated with the shared
  schemas before it is sent (FR-14, FR-15).

## Dependencies
- DISC-001-09a (reports API) -- `/reports/expenses-by-category`, `/reports/income-expenses` and
  `/reports/net-worth`, their query and response contracts and range limits in `packages/shared/src/reports`.
- DISC-001-09c (dashboard screens) -- the navigation lists and breakpoint, the SVG chart pieces and
  the dashboard cards that receive the two links.
- PRD 01 (Identity & Access) -- session, display currency and time zone of the profile.
- PRD 02 (Accounts & Categories) -- accounts for the account selector, default category names.
- PRD 03 (Movements & Exchange Rates) -- tags for the tag input and the frozen rates behind the figures.
- No new runtime dependency: charts use SVG and the existing theme tokens; filters reuse the existing
  presentational components.

## Decision Log
- 2026-10-12: Parent PRD split into four sub-tickets by the owner (09a, 09b, 09c, 09d). This one covers
  the screens of parent FR-15 to FR-18 and FR-22 (the web side only), and the display of FR-19 and FR-20, whose
  conversion is done by the API. It reads only the three existing reports of 09a.
- 2026-10-12: Proposed by the model, for owner ratification (1): the reports area is three routes under
  `/reports` (`/reports/categories`, `/reports/income-expenses`, `/reports/net-worth`) sharing one layout with a
  tab bar, and `/reports` redirects to the categories route. Alternative: one route with a tab held in the query,
  which makes the dashboard links and the back button less clear.
- 2026-10-12: Proposed by the model, for owner ratification (2): the display currency cannot be chosen on a
  report. The API takes no currency parameter and always answers in the profile's display currency, so the
  screens state the currency and link to the profile settings (FR-16). Alternative: add a `currency` query
  parameter to 09a, which this ticket does not do; record it as a follow-up if the owner wants a per-report
  switch.
- 2026-10-12: Proposed by the model, for owner ratification (3): the share of a category is computed in the
  client with integer arithmetic (basis points, whole percent shown, "<1%" under one percent), because the
  response has amounts and a total only; the leftover of rounding goes to the largest category so the shown
  shares never exceed 100%. The ring draws the 5 largest categories and one segment for the rest, matching the
  5 chart colors of the theme. Alternative: add shares to the API response, which is out of scope.
  2026-10-12 note: the leftover of rounding goes by largest remainder instead of to the largest category, because
  the latter can show 100% for a 50% category; no row ends above its true share plus one point, and the rest
  segment of the ring shows its own share (rest amount over the total), not the sum of the rounded-down rows.
- 2026-10-12: Proposed by the model, for owner ratification (4): net worth points without a converted total are
  drawn as gaps with a text reason and never bridged or filled with an older or later rate (follows 09a
  decision 3); when no point converts, the ARS and USD components are listed per month. Alternative: draw the ARS
  line alone, which hides that USD is missing.
- 2026-10-12: Proposed by the model, for owner ratification (5): the report is requested without `from` and `to`
  on first open, so the API defaults apply (the current month for categories, 12 months for the other two), and
  the screen shows the range the response resolved. Presets send explicit dates computed in the user's time
  zone from the profile. Alternative: always send explicit dates, which duplicates the API's default rule in the
  client.
- 2026-10-12: Proposed by the model, for owner ratification (6): reports are online-only. Offline the screen
  asks for a connection and shows no earlier figures, and no copy is kept in storage or in session memory
  (unlike the dashboard's session memory). This follows the parent Out of Scope and NFR-07. Alternative: reuse
  the dashboard's session memory for the last answer of each report.
- 2026-10-12: Proposed by the model, for owner ratification (7): the net worth screen hides the account and tag
  controls instead of disabling them, because 09a gives that report no such filters; if the owner wants them, it
  is an API change in a later ticket.
- 2026-10-12: Proposed by the model, for owner ratification (8): the account selector lists the user's active
  and archived accounts, because expenses of an archived account still belong to the flow reports (net worth
  leaves archived accounts out, which is a 09a rule). The tag control reuses the single-tag input of the
  movements filters. Alternative: active accounts only, which would make an archived account's expenses
  unreachable by filter.
- 2026-10-12: Proposed by the model, for owner ratification (9): the dashboard's categories card and net worth
  card each receive one link to their report; this is the only change to the 09c dashboard. The navigation entry
  goes in the plan ahead block of the side menu and in the More list, not in the phone bottom bar, which keeps
  its four items.
- 2026-10-12: Proposed by the model, for owner ratification (10): the income against expenses chart is drawn in
  plain SVG as grouped bars from the theme tokens, and the three screens add no charting library; filters sit in a
  collapsible control under 1024 px with the count of active filters. Alternative: add a chart library, which
  needs a justified runtime dependency (project rules) and is not required by these three charts.

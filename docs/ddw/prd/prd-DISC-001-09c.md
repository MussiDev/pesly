# PRD DISC-001-09c: Dashboard Screens and Navigation

| Field | Value |
|-------|-------|
| Ticket | DISC-001-09c |
| Tracker | none |
| Date | 2026-10-12 |
| PRD loops | 0 |
| Loops since last human decision | 0 |

## Context and Problem
Third of four sub-tickets of Dashboard & Reports (parent index: `prd-DISC-001-09.md`; 09a is the
reports API, merged; 09b is the dashboard API; 09c is this ticket, the dashboard screen, the
navigation breakpoint and the theme choice; 09d is the reports screens). The home route `/` today
shows a balance summary, a month summary, the accounts, recent movements and quick actions built
from several account and movement requests. It answers none of the questions users open the app for:
how much am I worth, what did I spend and on what, which budgets are at risk, what is due, and what
needs my action. This ticket replaces that content with the dashboard of the parent PRD, drawn from
the one dashboard endpoint of 09b, and finishes two parent requirements that belong to the shell:
sidebar navigation from 1024 px with a bottom bar below, and the light, dark or system theme choice.
It adds no API endpoint, no migration and no dependency.

Investigation of the code found four facts that shape the scope, each recorded in the Decision Log for
owner ratification:
1. The side menu and the bottom bar switch at 900 px today (the `desk` breakpoint, 56.25 rem in
   `apps/web/src/app/globals.css`, and the comments in `top-nav.tsx` and `bottom-nav.tsx`). The parent
   NFR-04, approved by the owner on 2026-09-25, says 1024 px.
2. The theme is a custom provider (`theme-provider.tsx`, `lib/theme.ts`), not `next-themes`. It stores
   `light` or `dark` in `localStorage` under `pesly-theme`; "system" is only the absence of a stored
   value, and the control is a two-state switch (`theme-toggle.tsx`), so a user who chose a theme
   cannot go back to following the system. Signing out does not clear the key. The profile API
   (`updateProfileRequestSchema`) has no theme field.
3. No chart library is installed (`apps/web/package.json`). The web app already draws a donut chart
   with plain SVG and the chart colors are theme tokens (`--chart-1` to `--chart-5`).
4. The 09b PRD (`GET /dashboard`, one read-only endpoint) leaves two things to this screen: the net
   worth chart is drawn from `GET /reports/net-worth` of 09a, not from the dashboard response, and
   failed syncs and group conflicts live only in the device queue, so this screen appends them to
   "Do these first" from the queue counts the shell already reads. The dashboard therefore makes 2
   requests, not 1. The 09b response carries amounts as integer strings, whole-number percentages,
   statuses `on_track`, `close` and `over`, and category keys instead of prose; the screen writes
   every sentence through the catalogs and computes none of the figures.

## Goals
- A user opens the app and, within one screen on a phone and without scrolling on a desktop, sees net
  worth, the month's expenses, income and net result with their change, and what needs attention.
- Every number on the dashboard is the one the API returned; the client formats it and never
  recomputes it.
- The dashboard reads well in light and dark, from 360 px to 1920 px, and never relies on color alone.
- The navigation matches the owner's approved rule (sidebar from 1024 px, bottom bar below) and the
  user can choose light, dark or the system theme.
- A new user with no accounts or no movements is guided to the first step instead of seeing empty
  charts.

## Design Reference
The traits of the parent PRD apply (a row of KPI cards with a large value and a delta chip, one large
area chart with a tooltip, rounded cards on a neutral background, color reserved for meaning, status
pills in plain words, a "Do these first" list, one plain-language insight, sidebar on wide screens).
They are direction; the measurable parts are NFR-01 to NFR-06 below. Colors, radii and spacing come
from the existing theme tokens, and the existing shadcn/ui-based components in
`apps/web/src/components/ui` (card, chip, badge, list-row, amount, empty-state, error-state, skeleton,
pill-tabs, donut-chart) are composed, not restyled.

## Functional Requirements
- FR-01: The system must show on the home page of an authenticated user a net worth card with the
  `total` of the dashboard response in the user's display currency (parent FR-01, FR-02).
- FR-02: The system must show on the net worth card the ARS part and the USD part separately, each as
  returned, without converting one into the other (parent FR-03).
- FR-03: The system must state on the net worth card that the conversion is unavailable, and show the
  per-currency parts only, when the dashboard response carries a null `total` with the reason `no_rate`
  (parent FR-02, AC-03).
- FR-04: The system must show three KPI cards with the current month's expenses, income and net
  result as returned in the display currency (parent FR-04, FR-05, FR-06).
- FR-05: The system must show on each KPI card a delta chip with the whole-number change against the
  same period of the previous month as returned, with an explicit sign and a word that says favorable
  or unfavorable (an increase in expenses is unfavorable; an increase in income or in the net result
  is favorable), and "—" when the response carries a null change (parent FR-07, NFR-06).
- FR-06: The system must show a net worth area chart with the points of the last 12 month ends read
  from `GET /reports/net-worth` (09a) in the display currency, drawing the points that carry a
  converted total, and must draw it without a new dependency unless PLAN records a justification
  (parent FR-08).
- FR-07: The system must show on the chart a tooltip with the date and the net worth of the point
  selected by hover, tap or keyboard, and must offer the same points as a text table for assistive
  technology that shows, for a point with no converted total, its ARS and USD parts and that the
  conversion is unavailable (parent FR-08, NFR-05).
- FR-08: The system must show the current month's expenses by top-level category, each with its name,
  its amount and its whole-number share of the total as returned, with a text label on every segment so
  that color is never the only identifier (parent FR-09, NFR-06).
- FR-09: The system must show up to 3 budgets as returned, each with its name, its own currency, its
  percentage used and a status pill reading "On track", "Close" or "Over" for the status `on_track`,
  `close` or `over`, linking to the budget (parent FR-10, NFR-06).
- FR-10: The system must list the recurring payment dates and credit card statement due dates of the
  next 7 days in the order returned, each with its date, name and amount in its own currency, linking
  to where it is handled by its kind (parent FR-11).
- FR-11: The system must show a "Do these first" list with the items of the dashboard `actions` as
  returned, overdue first, each linking to where it is resolved by its kind and id, and must hide the
  list when there is none (parent FR-12).
- FR-12: The system must add to "Do these first" the failed movements, and the failed and conflicting
  group changes, held in the device queue, each group of items linking to `/movements` or `/groups`,
  and must show them also while offline (parent FR-12).
- FR-13: The system must show the total that group members owe the user and the total the user owes,
  per currency and never added together, as returned (parent FR-13).
- FR-14: The system must show the insight as one sentence built from the category, the whole-number
  share of the month's spending and the whole-number change against the previous 3 months' average
  that the response carries, must leave out the comparison when the change is null, and must hide the
  insight when the response carries none (parent FR-14).
- FR-15: The system must show a first-steps guide with the actions "create an account" and "record a
  movement" in place of the net worth chart and the cards when the `firstSteps` section says to show
  it, marking the step already done (parent FR-21).
- FR-16: The system must show a notice on the card concerned when the response says that holdings have
  no price or that group shares or installments were left out for lack of a rate, with their count.
- FR-17: The system must show a skeleton with the final layout while the dashboard loads, an error
  state with a retry action when the dashboard request fails, a retry on the chart alone when only the
  net worth series fails, and, when a request fails offline, the data of the earlier load of this
  session with a notice that it is out of date.
- FR-18: The system must load the dashboard with one request to `GET /dashboard` and one request to
  `GET /reports/net-worth`, sent together, and no other request for the figures of FR-01 to FR-14.
- FR-19: The system must show the side navigation from 1024 px wide and the bottom navigation bar
  below 1024 px, on every authenticated page (parent NFR-04).
- FR-20: The system must let the user choose light theme, dark theme or the system setting from a
  three-option control in the navigation, with the system setting as the default (parent FR-23).
- FR-21: The system must apply the chosen theme before the first paint and keep the choice on the
  device across signing out and in again (parent FR-23, AC-30).
- FR-22: The system must show every dashboard string in Spanish and English from the i18n catalogs,
  and every amount, percentage and date formatted for the active locale and the user's time zone,
  naming categories from the response's category keys through the catalogs.
- FR-23: The system must keep the "add movement" quick action on the home page, and must no longer show
  on it the balance summary, month summary and pending payment banner that the dashboard replaces.

## Non-Functional Requirements
- NFR-01: The dashboard must reach Largest Contentful Paint below 2.5 s at p75 on the reference mid-range
  phone over 4G of parent NFR-03 (4 GB RAM, 2021 hardware; 10 Mbps down, 50 ms latency); the lab test
  under that throttling profile reports a median of 5 runs below 2.5 s.
- NFR-02: The dashboard and the navigation must be usable from 360 px to 1920 px wide with 0 horizontal
  scroll, verified by an end-to-end test at 360, 768, 1023, 1024 and 1920 px in both themes.
- NFR-03: The text of every dashboard element must have a contrast ratio of at least 4.5:1 against its
  background, and non-text graphics (chart line, segments, pill borders) at least 3:1, in both themes,
  verified by an automated accessibility scan on each state of the screen (WCAG 2.1 AA).
- NFR-04: 100% of the delta chips and status pills must carry text or a sign (+ or −) besides color,
  verified by a component test that renders each variant without color.
- NFR-05: The dashboard must send exactly 2 requests for its data on opening, verified by a test that
  counts the calls, and must add 0 runtime dependencies to `apps/web/package.json` unless the
  justification is recorded in the PLAN spec.
- NFR-06: 0 hardcoded user-facing strings, 0 missing or empty keys between the Spanish and English
  catalogs, and 0 occurrences of `parseFloat`, `toFixed` or `Number(` applied to money in the touched
  files, verified by the existing catalog parity test and a scan test.
- NFR-07: The touched web files must reach at least 80% line, branch and function coverage with
  Vitest, and every acceptance criterion must have at least one test.
- NFR-08: Every interactive element of the dashboard and of the navigation, including the theme
  control, must be operable by keyboard alone and have a touch target of at least 44 px, verified by
  component tests.

## Acceptance Criteria
*(EARS)*
- AC-01 (FR-01): WHEN the dashboard response carries a total of 142000000 minor units in display
  currency ARS, THE system SHALL show 1,420,000.00 ARS formatted for the active locale on the net worth
  card.
- AC-02 (FR-01): WHILE the dashboard request is pending, THE system SHALL show the net worth card as a
  skeleton of the same size and no amount.
- AC-03 (FR-01): IF the dashboard request fails, THEN THE system SHALL show an error state with a
  retry action and no amounts.
- AC-04 (FR-02): WHEN the response carries an ARS part of 1,000,000.00 and a USD part of 1,000.00,
  THE system SHALL show both lines separately on the net worth card.
- AC-05 (FR-03): IF the response carries a null total with the reason `no_rate`, THEN THE system SHALL
  show the per-currency parts and a message that the conversion is unavailable, and no converted total.
- AC-06 (FR-04): WHEN the response carries October expenses of 240,000.00 ARS, income of 800,000.00
  ARS and a net result of 560,000.00 ARS, THE system SHALL show three KPI cards with those amounts.
- AC-07 (FR-04): IF the net result is negative, THEN THE system SHALL show it with a minus sign.
- AC-08 (FR-05): WHEN the expenses change is 20, THE system SHALL show a chip reading "+20%" marked in
  words as unfavorable, and when the income change is 20 a chip reading "+20%" marked as favorable.
- AC-09 (FR-05): IF the response carries a null change, THEN THE system SHALL show "—" in the chip.
- AC-10 (FR-06): WHEN the net worth series carries 12 points with a converted total, THE system SHALL
  draw 12 points on the chart.
- AC-11 (FR-06): IF the series carries a single point, THEN THE system SHALL show that point and its
  value without a line.
- AC-12 (FR-06): IF no point of the series carries a converted total, THEN THE system SHALL show no
  line, say that the conversion is unavailable and show the per-currency parts in the table.
- AC-13 (FR-07): WHEN a user hovers, taps or focuses a point with the keyboard, THE system SHALL show
  a tooltip with that month end's date and net worth.
- AC-14 (FR-07): WHERE the chart is read by assistive technology, THE system SHALL expose a table with
  one row per point (date and value or the ARS and USD parts).
- AC-15 (FR-08): WHEN the response carries Food with 120,000.00 ARS and a share of 60 and Transport with
  80,000.00 ARS and a share of 40, THE system SHALL list both with name, amount and "60%" or "40%" as
  text.
- AC-16 (FR-08): WHILE the response carries an empty category list, THE system SHALL show a short
  message that there is no spending this month instead of an empty chart.
- AC-17 (FR-09): WHEN the response carries budgets with the statuses `over`, `close` and `on_track` in
  that order, THE system SHALL show them in that order with the pills "Over", "Close" and "On track".
- AC-18 (FR-09): WHILE the response carries no budget, THE system SHALL show a link to create one
  instead of an empty list.
- AC-19 (FR-10): WHEN the response carries a payment due in 3 days and a statement due in 6 days, THE
  system SHALL list the payment first, each with its date, name and amount in its own currency.
- AC-20 (FR-10): WHILE the response carries nothing due in the next 7 days, THE system SHALL show that
  nothing is due.
- AC-21 (FR-11): WHEN the response carries a pending occurrence, an overdue occurrence and an unpaid
  statement, THE system SHALL list the 3 items, the overdue one first, each linking to where it is
  resolved.
- AC-22 (FR-11): WHILE the response carries no action and the device queue holds no failed or
  conflicting change, THE system SHALL not render "Do these first".
- AC-23 (FR-12): WHEN the device queue holds 2 failed movements and 1 group conflict, THE system SHALL
  list them in "Do these first" with links to `/movements` and `/groups`.
- AC-24 (FR-12): WHILE the device is offline, THE system SHALL still list the items of the device queue.
- AC-25 (FR-13): WHEN the response carries 30,000.00 ARS owed to the user and 50.00 USD owed by the
  user, THE system SHALL show "owed to you" with 30,000.00 ARS and "you owe" with 50.00 USD, without a
  difference between them.
- AC-26 (FR-14): WHEN the response carries Restaurants with a share of 32 and a change of 40, THE system
  SHALL show one sentence stating both numbers.
- AC-27 (FR-14): IF the response carries a null change, THEN THE system SHALL show the sentence with
  the share only.
- AC-28 (FR-14): IF the response carries a null insight, THEN THE system SHALL not render the insight.
- AC-29 (FR-15): WHILE the `firstSteps` section says to show the guide because the user has no account,
  THE system SHALL show the guide with a link to create an account and no chart or KPI card.
- AC-30 (FR-15): WHILE the `firstSteps` section says to show the guide because the user has accounts
  and no movement, THE system SHALL show the guide with the account step marked done and a link to
  record a movement.
- AC-31 (FR-16): WHEN the response says that 2 holdings have no price, THE system SHALL show on the net
  worth card a notice with that count.
- AC-32 (FR-16): WHEN the response says that 3 shares or installments were left out for lack of a rate,
  THE system SHALL show on the month's cards a notice with that count.
- AC-33 (FR-17): WHILE the dashboard is loading, THE system SHALL show a skeleton with the same layout
  as the loaded screen, so that the content does not move when the data arrives.
- AC-34 (FR-17): IF the net worth series request fails and the dashboard request succeeds, THEN THE
  system SHALL show every other widget and, in place of the chart, an error with a retry action.
- AC-35 (FR-17): IF a request fails while the device is offline and data from an earlier load of this
  session is held, THEN THE system SHALL keep showing that data with a notice that it is out of date.
- AC-36 (FR-17): IF a request fails while the device is offline and no earlier data is held, THEN THE
  system SHALL show the offline message with a retry action and no amounts.
- AC-37 (FR-18): WHEN the dashboard opens, THE system SHALL send exactly 1 request to `GET /dashboard`
  and 1 request to `GET /reports/net-worth`, and no other request for figures.
- AC-38 (FR-19): WHEN the viewport is 1024 px wide or more, THE system SHALL show the side navigation
  and no bottom bar.
- AC-39 (FR-19): WHEN the viewport is 1023 px wide or less, THE system SHALL show the bottom bar and no
  side navigation.
- AC-40 (FR-19): IF the viewport is between 900 px and 1023 px wide, THEN THE system SHALL show the
  bottom bar, because the former 900 px breakpoint no longer applies.
- AC-41 (FR-20): WHEN a user opens the theme control, THE system SHALL offer light, dark and system,
  with the current one marked by text and not only by color.
- AC-42 (FR-20): WHILE the user has made no choice, THE system SHALL follow the operating system's light
  or dark setting and mark "system" as the current option.
- AC-43 (FR-20): WHEN the operating system changes between light and dark while "system" is chosen, THE
  system SHALL change the theme without a reload.
- AC-44 (FR-21): WHEN a user chooses dark theme, THE system SHALL render every screen in dark theme and
  keep the choice after signing out and in again.
- AC-45 (FR-21): IF the browser blocks local storage, THEN THE system SHALL apply the choice for the
  current session and not fail.
- AC-46 (FR-21): WHEN a user who chose dark theme loads any page, THE system SHALL apply the dark theme
  before the first paint, with no flash of the light theme.
- AC-47 (FR-22): WHERE the interface language is Spanish or English, THE system SHALL show every
  dashboard string, amount, percentage and date in that language.
- AC-48 (FR-22): IF the response carries a category key with no catalog entry, THEN THE system SHALL
  show the category's own name returned by the API and not an empty label.
- AC-49 (FR-23): WHEN a user opens the home page, THE system SHALL show the "add movement" quick action
  and none of the removed balance summary, month summary or pending payment banner.
- AC-50 (FR-01): IF the display currency of the response is USD, THEN THE system SHALL show the total
  and the month's amounts in USD.

## Out of Scope
- Any API, migration or endpoint change: the dashboard endpoint is 09b and the reports are 09a.
- The reports screens (expenses by category, income against expenses, net worth over a range, filters):
  09d.
- Storing the theme choice in the user's profile so that it follows the user across devices (see
  Decision Log).
- Viewing the dashboard offline beyond the data already loaded in the session (parent Out of Scope:
  PRD 04 covers only movements).
- User-customizable dashboards, widget reordering and hiding.
- Forecasts, AI insights and exports.
- Pull-to-refresh and live updates; the dashboard refreshes when it opens and on retry.
- A goals widget: the parent dashboard has none.
- Restyling pages other than the shell and the home page; other pages only inherit the new
  breakpoint and the theme control.

## Risks and Mitigations
- **The LCP budget is missed on a mid-range phone** -> 2 parallel requests (NFR-05), a skeleton with the
  final layout, the net worth card as the first element, the chart drawn in SVG without a library and
  allowed to arrive after the cards (AC-34).
- **Moving the breakpoint from 900 px to 1024 px breaks layouts that use `desk:`** -> the token is
  changed in one place; the pages that use it (9 files) are checked at 1023 and 1024 px by the
  end-to-end test of NFR-02.
- **Color-only meaning excludes color-blind users** -> text or sign on every chip and pill (NFR-04),
  labels on chart segments (FR-08).
- **A chart is unreadable to a screen reader** -> a text table with the same points (FR-07).
- **The numbers disagree with other screens** -> the screen shows only what the API returned (NFR-06);
  09b composes the same use cases as the reports and the budgets.
- **The chart's last point differs slightly from the net worth card** -> 09b values investments at the
  current stored prices while the 09a series uses the daily snapshot (09b Decision Log 4); the card is
  the figure of record and the tooltip states the month end date.
- **Right after release the past months of the chart have no converted value** -> 09a returns a null
  total for a month end without a stored rate (09a Decision Log 3); the chart draws only converted
  points and the table lists the rest (FR-07, AC-12).
- **Stale data after a failed refresh looks current** -> the out-of-date notice (FR-17).
- **The theme choice is device-local, so a second device shows the system theme** -> recorded in the
  Decision Log; a profile field is a later ticket.
- **The 09b or 09a response changes after this PRD** -> the screens depend only on the response
  schemas in `@pesly/shared`; a change there is a type error, not a silent difference.

## Dependencies
- DISC-001-09b (dashboard API): `GET /dashboard` and its response schema in `@pesly/shared`; its PRD is
  `prd-DISC-001-09b.md`. The names of budgets, upcoming entries and categories in that response are
  assumed present; PLAN confirms against the merged schema (Decision Log 8).
- DISC-001-09a (reports API, merged): `GET /reports/net-worth` for the chart, with its limit of 24
  months and its refusal of a `to` later than today.
- PRD 01 (Identity & Access): display currency, default rate type and time zone from the session.
- PRD 04 (Offline Entry & Sync): the device queue counts (failed movements, failed and conflicting
  group changes) already read by the shell container.
- FEAT-004 (design system): the components and tokens named in Design Reference.
- The shell (`apps/web/src/features/shell`), the theme provider and `lib/theme.ts`, and the `desk`
  breakpoint token in `apps/web/src/app/globals.css`.
- The existing routes the dashboard links to: `/budgets`, `/recurring`, `/cards`, `/groups`,
  `/movements`, `/accounts/new`, `/movements/new`, `/notices`.

## Decision Log
- 2026-10-12: Parent PRD split into four sub-tickets by the owner; this one covers parent FR-01 to
  FR-14, FR-21 and FR-23 as screens, NFR-03 to NFR-06, and the navigation rule of parent NFR-04. Parent
  IDs map as: FR-01 and FR-02 to FR-01, FR-03 to FR-02, FR-04 to FR-06 to FR-04, FR-07 to FR-05, FR-08
  to FR-06 and FR-07, FR-09 to FR-08, FR-10 to FR-09, FR-11 to FR-10, FR-12 to FR-11 and FR-12, FR-13
  to FR-13, FR-14 to FR-14, FR-21 to FR-15, FR-23 to FR-20 and FR-21, NFR-03 to NFR-01, NFR-04 to
  NFR-02 and FR-19, NFR-05 to NFR-03, NFR-06 to NFR-04. New in this ticket: FR-16 to FR-18, FR-22,
  FR-23 and NFR-05 to NFR-08.
- 2026-10-12: Proposed by the model, for owner ratification (1): move the `desk` breakpoint from 900 px
  to 1024 px (64 rem), as the owner approved on 2026-09-25 for the parent NFR-04. Alternative: keep
  900 px and amend the parent NFR. Tradeoff: 1024 px puts tablets in portrait on the bottom bar.
- 2026-10-12: Proposed by the model, for owner ratification (2): the theme choice is stored on the
  device only (`localStorage`, the mechanism that exists today), which meets parent AC-30 on the same
  device and keeps this ticket free of API changes. Alternative: add a `theme` field to the profile
  (shared schema, API, migration) so the choice follows the user across devices; that is its own
  ticket. A shared device keeps one theme for every account on it.
- 2026-10-12: Proposed by the model, for owner ratification (3): the theme control becomes a
  three-option control (light, dark, system) replacing the two-state switch, because with the switch
  a user who chose a theme can never return to following the system (parent AC-31). "System" is
  stored by removing the stored value, as today, so existing stored values keep working.
- 2026-10-12: Proposed by the model, for owner ratification (4): the net worth chart is drawn in SVG
  with the theme tokens, as the donut chart is, and no chart library is added. PLAN chooses a library
  only if it records why SVG is not enough; that would be a new runtime dependency to justify in the
  spec (AGENTS.md).
- 2026-10-12: Proposed by the model, for owner ratification (5): the home page keeps only the "add
  movement" quick action beside the dashboard; the balance summary, month summary and pending payment
  banner are replaced by the net worth card, the KPI cards and "Do these first". The accounts list and
  recent movements stay one tap away in their own pages. Alternative: keep them below the dashboard, at
  the cost of more requests and a longer page.
- 2026-10-12: Proposed by the model, for owner ratification (6): the LCP budget is verified in a lab
  test under the reference throttling profile (median of 5 runs), because a field p75 cannot be
  measured in CI; a field measurement is not part of this ticket.
- 2026-10-12: Proposed by the model, for owner ratification (7): the dashboard makes 2 requests
  (`GET /dashboard` and `GET /reports/net-worth`) because 09b leaves the chart series to 09a, and adds
  the device-queue items to "Do these first" because 09b cannot know them (09b Decision Log 8). The
  chart range is the last 12 month ends up to today. Offline, the screen keeps the data of the session
  with an out-of-date notice; no persistent cache of financial data is added.
- 2026-10-12: Proposed by the model, for owner ratification (8): open question for the 09b author and
  PLAN. The 09b PRD says category and group fields carry ids and `defaultKey`, never prose; this PRD
  assumes a custom category and a budget also carry a display name in the response (AC-48 falls back
  to the API name). If they do not, one extra request for the category list is needed and NFR-05
  changes from 2 to 3.

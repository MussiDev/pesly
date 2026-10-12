# PRD DISC-001-05j: Group Category Views

| Field | Value |
|-------|-------|
| Ticket | DISC-001-05j |
| Tracker | none |
| Date | 2026-10-11 |
| PRD loops | 0 |
| Loops since last human decision | 0 |

## Context and Problem
Web sub-ticket of PRD 05 (parent index: `prd-DISC-001-05.md`; 05f expenses, 05g balances and settlements,
05h editing, activity and conflicts). The owner asked, in Spanish: "agrega que se puedan ver categorias en
el grupo de en que se gasto porque ese diseño esta re basico". The model reads it as: inside a group a
member wants to SEE which category each expense belongs to and where the group's money goes, because the
current group expense screens are too basic (Decision Log).

What exists today, read from the code. Every group expense carries a `categoryId`, and the API lists the
group's categories, archived ones included, with `icon`, `color`, `defaultKey`, `name` and `archivedAt`
(`GET /groups/:id/categories`, `GET /groups/:id/expense-options`). The web expense row (05f) prints the
category as one line of plain text, with no icon and no color, and falls back to "No category" when the id
is unknown. The personal categories screen already renders icon and color with `CategoryVisual`, and the
group categories screen reuses it. There is no way to filter the list by category or period, and no
totals: `GET /groups/:id/expenses` takes only `limit` and `cursor`, 50 items a page, so a total computed in
the browser would cover only the pages loaded and would be wrong. No report exists for groups (PRD 09 is
not built).

This ticket gives the row and the detail a visible category, adds a category and period filter to the
list, and adds a "spending by category" view per group. It needs an API addition (Decision Log); the spec
decides its shape. A migration is not expected: the table has an index on `(group_id, occurred_at, id)` and
a per-group month stays small; PLAN confirms it with the 5,000-expense benchmark.

## Goals
- A member sees at a glance the category of every group expense, by icon, color and name.
- A member filters the group's expenses by category and by month.
- A member sees where the group's money went in a month, per category and per currency, without opening
  every expense.
- Nothing about categories is lost when a category is archived or unknown.

## Functional Requirements
- FR-01: The system must show on every group expense row the category's icon, color and name, using the
  shared category visual.
- FR-02: The system must show the same category visual and name on the group expense detail and on the
  expense edit screen.
- FR-03: The system must let a member filter the expense list by one or several categories, and clear the
  filter.
- FR-04: The system must let a member choose the month to read, defaulting to the current month in the
  user's time zone, and apply it to the list and to the summary.
- FR-05: The system must show a "spending by category" view of the group for the chosen month, with one
  line per category and currency: the total, the category's share of that currency's total and a
  proportional bar.
- FR-06: The system must order the summary lines of each currency by total, largest first, and never add or
  compare amounts of different currencies.
- FR-07: The system must filter the expense list by a category when the member taps that category in the
  summary, and show which filter is active.
- FR-08: The system must show an empty state when the chosen month has no expenses, and a distinct one when
  a filter leaves none, with an action to clear it.
- FR-09: The system must keep showing archived categories, marked as archived, on the expenses and in the
  summary that belong to them.
- FR-10: The system must show a neutral icon, a neutral color and the "No category" label for an expense
  whose category cannot be found, and still count it in the summary under that label.
- FR-11: The system must show every string of these views in Spanish and English from the i18n catalogs,
  and every amount, percentage and month with the locale formatters.
- FR-12: The system must not use color as the only signal: each category shows its icon and its name next
  to the color, and each bar shows its amount and percentage as text, with the contrast of the design
  system.
- FR-13: The system must add to the API the filter by categories and by a date range on the group expense
  list, and a per-group summary of totals by category and currency for a date range, computed on the
  server over the whole range.

## Non-Functional Requirements
- NFR-01: Each screen and state of this ticket must render without horizontal scrolling at a 360 px wide
  viewport, verified by an end-to-end test at that width.
- NFR-02: The summary screen must load with at most 2 API requests (the group and the summary, which
  carries the categories it names), and the filtered list with at most 3 (the group, the options and the
  first page), each verified by a test that counts the calls.
- NFR-03: Every total must be computed as an integer in minor units (`bigint`) and sent as a string, with 0
  floating-point operations; a test over 1,000 random sets of expenses checks that the summary of each
  currency equals the sum of its expenses and that the sum of the categories equals the currency total.
- NFR-04: The summary of a group with 5,000 expenses must answer in under 300 ms at the 95th percentile,
  verified by a benchmark in `apps/api/test/perf` run with `pnpm test:perf`, like `group-balances.perf`.
- NFR-05: The Spanish and English catalogs must have 0 missing or empty keys, verified by the existing
  catalog parity test.
- NFR-06: Every new query must be scoped to the group of a member, and a non-member must get 404 on the
  filter and on the summary, verified by an integration test.

## Acceptance Criteria
*(EARS)*
- AC-01 (FR-01): WHEN the expense list shows an expense, THE system SHALL show on its row the category's
  icon in the category's color together with the category's name.
- AC-02 (FR-01): WHERE the category has no custom name, THE system SHALL show the translated name of its
  default key.
- AC-03 (FR-02): WHEN a member opens the detail or the edit screen of an expense, THE system SHALL show the
  expense's category with its icon, color and name.
- AC-04 (FR-03): WHEN a member chooses one or several categories, THE system SHALL show only the expenses
  of those categories, newest first, and keep the paging by cursor within the filter.
- AC-05 (FR-03): WHEN a member clears the filter, THE system SHALL show the expenses of the chosen month
  again.
- AC-06 (FR-03): IF the filter names an id that is not a UUID, THEN THE API SHALL answer a validation
  error and THE system SHALL show no result from it.
- AC-07 (FR-04): WHEN a member opens the group's expenses or summary, THE system SHALL select the current
  month in the user's time zone.
- AC-08 (FR-04): WHEN a member chooses another month, THE system SHALL reload the list and the summary
  for the whole of that month in the user's time zone, from its first instant to its last.
- AC-09 (FR-04): IF the chosen month is in the future or more than 10 years back, THEN THE system SHALL
  not offer it.
- AC-10 (FR-05): WHEN a member opens the summary, THE system SHALL show, per currency, each category with
  its total, its share of the currency's total as a percentage and a bar proportional to that share.
- AC-11 (FR-05): THE system SHALL show a currency's total apart from the category lines, in the same
  currency.
- AC-12 (FR-06): WHEN the summary lists the categories of a currency, THE system SHALL order them by total,
  largest first, with ties broken by name.
- AC-13 (FR-06): IF the group has expenses in ARS and in USD in the chosen month, THEN THE system SHALL
  show two separate lists and no amount converted or summed across them.
- AC-14 (FR-07): WHEN a member taps a category in the summary, THE system SHALL open the expense list
  filtered by that category and month and show the active filter as a removable chip.
- AC-15 (FR-07): WHEN the filtered list is opened from the summary, THE system SHALL show the same total
  for the category as the summary line.
- AC-16 (FR-08): WHILE the chosen month has no expenses, THE system SHALL show an empty state for the
  month, in the list and in the summary.
- AC-17 (FR-08): IF a category filter leaves no expense in the month, THEN THE system SHALL show that
  nothing matches and offer to clear the filter.
- AC-18 (FR-09): WHEN an expense belongs to an archived category, THE system SHALL show its row and its
  summary line with the category's icon and name and an "archived" marker.
- AC-19 (FR-09): WHEN a category is archived, THE system SHALL offer it in the filter only if it has
  expenses in the chosen month.
- AC-20 (FR-10): IF an expense's category id is not among the group's categories, THEN THE system SHALL
  show it with a neutral icon, a neutral color and the "No category" label.
- AC-21 (FR-10): WHEN expenses without a known category exist in the month, THE summary SHALL include one
  line labelled "No category" per currency with their total.
- AC-22 (FR-11): WHERE the interface language is Spanish or English, THE system SHALL show every string of
  these views in that language and format amounts, percentages and months with that locale.
- AC-23 (FR-12): THE system SHALL show for every category, wherever it appears, an icon and a name beside
  its color, and for every bar the amount and the percentage as text.
- AC-24 (FR-12): WHEN the theme is light or dark, THE system SHALL draw the category colors and text with
  the design-system tokens, with no hardcoded color value.
- AC-25 (FR-13): WHEN the list is requested with categories and a date range, THE API SHALL return only
  the expenses whose category is in the list and whose date is inside the range, newest first.
- AC-26 (FR-13): WHEN the summary is requested for a range, THE API SHALL return, per currency and per
  category, the sum of the expense amounts and the number of expenses, over every expense in the range and
  not only a page.
- AC-27 (FR-13): IF the range is reversed, is longer than 366 days or an id is not a UUID, THEN THE API
  SHALL answer a validation error and read nothing.
- AC-28 (FR-13): IF the caller is not a member of the group, THEN THE API SHALL answer 404 on the list
  filter and on the summary.
- AC-29 (FR-13): WHEN an expense is edited or deleted, THE summary of the next request SHALL reflect it.
- AC-30 (FR-05): IF the summary request fails, THEN THE system SHALL show the error and a retry action, and
  keep the list usable.

## Out of Scope
- A charts library and any new runtime dependency: bars are drawn with the design-system tokens.
- Exporting the summary or the expenses (CSV, PDF, image).
- Personal category reports across groups and the user's own shares by category (PRD 09).
- Budgets per group category and alerts on them.
- Creating, renaming, recoloring or archiving categories (05e owns them).
- Comparing groups, comparing months side by side and forecasting.
- Converting USD to ARS to produce one total: currencies are never mixed.
- Filtering by member, payer or free text.
- Offline use of the summary and of the filters (PRD 05 decision: group screens are online).

## Risks and Mitigations
- **A total built from the pages loaded is wrong** → the summary is computed on the server over the whole
  range (FR-13, AC-26).
- **ARS and USD are added together** → the summary is keyed by currency and never mixes them (FR-06,
  AC-13).
- **A float slips into money** → sums are `bigint` and travel as strings; percentages are only a display of
  integers (NFR-03).
- **Color is the only cue** → icon, name and text amounts always accompany it (FR-12).
- **A month is cut at the wrong instant** → the range comes from the user's time zone, the same helper as
  the personal shares view (FR-04, AC-08).
- **Archived or deleted categories distort the summary** → they keep their line, marked, or fall under
  "No category" (FR-09, FR-10).
- **Conflict with 05h on the same list row and container** → this ticket branches after 05h merges
  (Dependencies).
- **A slow summary on a large group** → benchmark with 5,000 expenses and a 300 ms limit (NFR-04).

## Dependencies
- DISC-001-05b (group expenses API), 05e (group categories and the group detail) and 05f (the expense list
  and form): the data and screens this ticket extends.
- DISC-001-05h (editing, activity and conflicts, open PR #63) modifies the same expense list row
  (`expense-row.tsx`) and container (`group-expenses-container.tsx`) to add sync markers and row actions.
  05j branches from `origin/main` after 05h merges, so it does not rebase over a moving row.
- `CategoryVisual` and the category tokens of the personal categories (reused, not copied), and
  `groupCategoryLabel`.
- `currentMonthRange` and the time zone helpers already used by the personal shares view.
- FEAT-004 / FEAT-005 (design system) — components and tokens.

## Decision Log
- 2026-10-11: The owner's request is read as "see the category of every group expense and where the group
  spends". Proposed by the model, awaiting the owner's acceptance.
- 2026-10-11: An API addition is needed: the list is paginated by 50, so totals and a category filter
  cannot be computed in the browser. Proposed: a `categoryIds` filter and a `from`/`to` range on
  `GET /groups/:id/expenses`, and `GET /groups/:id/expenses/summary` returning bigint sums per currency
  and category. The spec decides the exact shape. No migration is expected: the existing group and date
  index serves it. Proposed by the model, awaiting the owner's acceptance.
- 2026-10-11: The summary is a section of the expenses page, not a charts view; bars use design tokens and
  no dependency. Proposed by the model, awaiting the owner's acceptance.
- 2026-10-11: Period is one calendar month at a time, in the user's time zone; custom ranges stay out of
  scope. Proposed by the model, awaiting the owner's acceptance.

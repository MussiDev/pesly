# Spec DISC-001-09c: Dashboard Screens and Navigation

| Field | Value |
|-------|-------|
| Ticket | DISC-001-09c |
| PRD | docs/ddw/prd/prd-DISC-001-09c.md |
| Tier | FEATURE |
| Date | 2026-10-12 |
| Spec loops | 0 |
| Loops since last human decision | 0 |

## Summary
Web only, on the dashboard read of 09b and the net worth series of 09a: no API route, migration or
runtime dependency is added. Block 0 is the only block that touches the api-client and the message
catalogs: it adds the two calls (the dashboard and the net worth series), a provisional parser for the
09b response shape in one file, one adapter file that turns that shape into the view types every other
block draws, the shared locale formatters, and every Spanish and English key of a new `dashboard`
namespace. Because 09b is not merged, a later change of its response touches the parser and the adapter
only (D1, flagged for the owner). Block 1 moves the `desk` breakpoint from 900 px to 1024 px and gives the
side menu its own row for the theme control; Block 2 turns the theme switch into a three-option control.
Blocks 3 to 6 are pure presentational cards (KPI cards, net worth card with the SVG chart, category,
budget, upcoming and group cards, "Do these first" with the device-queue items, the insight and the
first-steps guide). Block 7 is the container: the 2 parallel requests, the loading, error, chart-retry and
offline states, the layout, and the replacement of the old home content. Block 8 holds the browser tests
at 360 and 1280 px (and the other widths of NFR-02), both themes, the lab LCP test, the contrast probe and
the scans. Money stays in minor units: the client parses integer strings with `BigInt`, formats them with
the existing locale formatters and never adds, subtracts, divides or converts an amount; the chart
geometry uses bigint arithmetic on the series values and only turns a small integer permille into a
drawing coordinate.

## Decisions
- **D1 Provisional 09b contract in one place (FLAG for the owner and the 09b author).** The 09b
  response schema does not exist yet (no 09b spec, nothing in `packages/shared`). Block 0 writes the
  parser from the 09b PRD (sections, integer-string amounts, whole-number percentages, `on_track` |
  `close` | `over`, category keys) in `apps/web/src/lib/dashboard-contract.ts`, and the mapping from that
  shape to the screen's view types in `apps/web/src/features/dashboard/contract/dashboard-adapter.ts`.
  Nothing else in the app imports the parser or reads a raw field. When 09b merges, the parser file is
  deleted in favor of the shared schema and only the adapter is adjusted; the assumed fields are listed
  in Block 0 (A1 to A9) so they can be compared with the merged 09b spec line by line.
  Update 2026-10-12: the parser and the adapter were aligned to spec-DISC-001-09b (response shape,
  link targets, derived `overdue`); A1 to A9 are superseded by that spec.
- **D2 Series request.** The net worth call sends no `from` or `to`, so the API answers its default
  range of 12 months ending today (the current month is dated today, earlier ones at their month end);
  the client never reads the clock. Points with a null total are kept for the points list and are not
  drawn (FR-06).
- **D3 Chart without a library.** The area chart is inline SVG with the `--chart-*` tokens, as the donut
  is (PRD decision 4). The plot is one focusable element with `role="slider"` (a 44 px tall target
  across the whole plot); pointer position, arrow keys, Home and End select a drawn point and the tooltip
  shows its date and value. The same points are always rendered as a native HTML data grid for assistive
  technology (AC-14). Geometry: the vertical position of a point is a permille computed in bigint from
  the series values, and only that small integer goes through `Number.parseInt`, so the money scan can
  forbid `Number(` in every touched file.
- **D4 Home content.** The home page keeps the existing `QuickActions` component as "the add movement
  quick action" (its four links all open the new-movement screen, FR-23); the balance summary, month
  summary, pending payment banner, accounts list, recent movements and shortcuts components are removed
  with their tests (PRD decision 5). Their unused `home.*` catalog keys are removed in Block 8.
- **D5 Device-queue items.** Block 6 adds a small hook that reads the same two local counters the shell
  container reads (`readQueueCounts` and `readGroupQueueCounts`) and re-reads on the same events; the
  shell container is not modified. No HTTP request is added, so FR-18 and NFR-05 hold, and the items show
  offline because nothing depends on the network. The items are appended after the server items.
- **D6 Out-of-date data.** The container keeps the last successful pair of answers of this session in a
  module-level memory store keyed by the user id of the session pointer; nothing is persisted (no
  `localStorage`, `sessionStorage` or IndexedDB). It is read only when a request fails with the network
  failure while the device is offline, and never for another user id or after the pointer is gone.
- **D7 Theme control.** `ThemeToggle` keeps its exported name (its importers are untouched) and becomes
  a three-option radio group built on native radio inputs (keyboard and focus for free), each option
  with an icon and a visible text label; the chosen one also shows a check mark and `aria-checked`, so it
  is not marked by color alone. "System" is stored by removing the key, so the existing stored values
  keep working. The pre-paint script is unchanged (it already treats a missing or unknown value as the
  system setting).
- **D8 First steps layout.** While the first-steps guide shows, it replaces the net worth card and the
  KPI cards, and the category, budget, upcoming, group and insight cards are not rendered (the response
  carries zeros for them); "Do these first" still renders when it has items, so a failed device change is
  never hidden.
- **D9 Links.** Links are built only in the adapter from fixed route prefixes and ids that the parser
  validated as UUIDs. A budget links to `/budgets/{id}`; an upcoming or action entry links to its
  recurring payment or card when the response carries that id and otherwise to `/recurring` or `/cards`
  (the pages 09c is allowed to link to); queue items link to `/movements` and `/groups`.
- **D10 Delta words.** A delta chip reads sign, whole number and percent sign ("+20%", "−5%", "0%") plus
  a visible word: "Favorable", "Unfavorable" or "No change". For expenses a positive change is
  unfavorable; for income and the net result it is favorable. A null change reads "—" with the word "No
  comparison". A caption on each card says it compares with the same period of the previous month.
- **D11 Contrast and accessibility checks without a dependency.** NFR-03 is verified by an in-repo probe
  (Block 8) that reads the computed colors of every text node and chart graphic in the browser; adding
  `@axe-core/playwright` as a dev dependency was considered and not chosen, to keep the dependency list
  untouched. Contrast failures found by the probe are fixed in the color tokens of `globals.css` by
  Block 8, which runs after Block 1.
- **D12 LCP.** NFR-01 is a lab test under the reference profile (Chromium, 10 Mbps, 50 ms latency, CPU
  slowed 4x, production build), median of 5 runs below 2.5 s (PRD decision 6).
- **D13 Parallel ownership.** Each block owns only the files it lists. Block 7 imports the cards of
  Blocks 3 to 6 by the fixed names and props below and is tested with the real cards after they merge.

## Coverage: PRD → blocks
| Requirement | Covered by |
|---|---|
| FR-01 | Block 4 (net worth card), on the view of Block 0 |
| FR-02 | Block 4 |
| FR-03 | Block 4 |
| FR-04 | Block 3 (KPI cards), on the view of Block 0 |
| FR-05 | Block 3 (delta chip), words and sign per D10 |
| FR-06 | Block 4 (chart), on the series call of Block 0 |
| FR-07 | Block 4 (tooltip and points list) |
| FR-08 | Block 5 (category card) |
| FR-09 | Block 5 (budgets card) |
| FR-10 | Block 5 (upcoming card) |
| FR-11 | Block 6 (list of server actions), links built in Block 0 |
| FR-12 | Block 6 (device-queue items) |
| FR-13 | Block 5 (groups card) |
| FR-14 | Block 6 (insight card) |
| FR-15 | Block 6 (first steps), placed by Block 7 |
| FR-16 | Block 3 (month notice) and Block 4 (net worth notice) |
| FR-17 | Block 7 (skeleton, error, offline and out-of-date states), chart retry in Block 4 |
| FR-18 | Block 0 (the two calls), Block 7 (sent together, no other request) |
| FR-19 | Block 1 (breakpoint and navigation), Block 8 (browser check) |
| FR-20 | Block 2 |
| FR-21 | Block 2 (storage and pre-paint), Block 8 (browser check) |
| FR-22 | Block 0 (catalogs, formatters, category names); every block reads only catalog keys and formatters |
| FR-23 | Block 7 (home page content) |
| NFR-01 | Strategy: two parallel requests, a skeleton with the final layout, the net worth card first and the chart allowed to arrive later (Block 7); measured by the lab test of Block 8 |
| NFR-02 | Strategy: mobile-first single column that becomes a grid from `desk`, no fixed widths, `min-w-0` on every card (Blocks 3 to 7); measured by the 5-width, 2-theme browser test of Block 8 |
| NFR-03 | Strategy: theme tokens only, no color literals (design-system scan), text on every status; measured by the contrast probe on every state in Block 8 |
| NFR-04 | Blocks 3 and 5 (component tests that render every chip and pill variant without color) |
| NFR-05 | Block 7 (call-count test) and Block 8 (the dependency list of `apps/web/package.json` is unchanged) |
| NFR-06 | Block 0 (catalog parity test and formatters), Block 8 (string and money scan of every touched file) |
| NFR-07 | Strategy: every block ships its own Vitest tests and Block 8 runs the coverage thresholds |
| NFR-08 | Blocks 1 to 7 (labels, keyboard and 44 px class assertions in component tests), Block 8 (measured targets in the browser) |

Acceptance criteria are named by the tests of the blocks (AC-01 to AC-50).

## Dependencies between blocks
Blocks 0 and 1 touch disjoint files and run in parallel first. Blocks 2, 3, 4, 5 and 6 need Block 0
(view types, formatters, catalog keys) and own disjoint folders, so they run in parallel once Block 0 is
merged into the worktree. Block 7 imports the cards of Blocks 3 to 6 by fixed names and starts after they
are merged; Block 1 is not a prerequisite for it. Block 8 is last: it owns the end-to-end tests, the
scans, the catalog cleanup and, if the contrast probe finds a failing pair, the color tokens.

Fixed contracts that let Blocks 3 to 7 be written without waiting for each other (types live in
`features/dashboard/dashboard-view.ts`, Block 0):
- `KpiCards` (`components/kpi-cards.tsx`, Block 3): props `{locale: Locale; currency: Currency; month: MonthView}`.
- `NetWorthCard` (`components/net-worth-card.tsx`, Block 4): props
  `{locale: Locale; currency: Currency; netWorth: NetWorthView; series: SeriesState}` where
  `SeriesState = {kind: 'ready'; points: SeriesPointView[]} | {kind: 'failed'; retrying: boolean; onRetry: () => void}`.
- `CategoriesCard`, `BudgetsCard`, `UpcomingCard`, `GroupsCard` (Block 5, `components/`): props
  `{locale: Locale; currency: Currency; categories: CategoryView[]}`, `{locale; budgets: BudgetView[]}`,
  `{locale; upcoming: UpcomingView[]}` and `{locale; groups: GroupsView}`.
- `DoTheseFirst` (`components/do-these-first.tsx`, Block 6): props `{locale: Locale; items: AttentionItem[]}`;
  it renders nothing for an empty list. `buildAttentionItems(actions, queue)` (`attention-items.ts`, Block
  6) returns the list; `useQueueAttention()` returns `{ready: boolean; queue: QueueAttention}`.
- `InsightCard` (`components/insight-card.tsx`, Block 6): props `{locale: Locale; insight: InsightView | null}`.
- `FirstSteps` (`components/first-steps.tsx`, Block 6): props `{firstSteps: FirstStepsView}`.

| Block | Owns (parallel group) |
|---|---|
| 0 | `apps/web/src/lib/api-client.ts`, `apps/web/src/lib/dashboard-contract.ts`, `features/dashboard/dashboard-view.ts`, `features/dashboard/format.ts`, `features/dashboard/contract/*`, `apps/web/messages/es.json`, `en.json` (group A) |
| 1 | `app/globals.css` (breakpoint line), `lib/use-compact-viewport.ts`, `features/shell/components/top-nav.tsx`, `bottom-nav.tsx` (group A) |
| 2 | `components/theme-provider.tsx`, `components/theme-toggle.tsx`, `lib/theme.ts` (group B) |
| 3 | `features/dashboard/components/kpi-cards.tsx`, `delta-chip.tsx`, `month-notice.tsx` (group B) |
| 4 | `features/dashboard/components/net-worth-*.tsx`, `features/dashboard/chart/*` (group B) |
| 5 | `features/dashboard/components/categories-card.tsx`, `budgets-card.tsx`, `upcoming-card.tsx`, `groups-card.tsx` (group B) |
| 6 | `features/dashboard/components/do-these-first.tsx`, `insight-card.tsx`, `first-steps.tsx`, `features/dashboard/attention/*` (group B) |
| 7 | `features/dashboard/containers/*`, `features/dashboard/components/dashboard-screen.tsx`, `dashboard-skeleton.tsx`, `features/home/**`, `app/[locale]/(app)/page.tsx` (group C, after B) |
| 8 | `apps/web/e2e/*dashboard*`, `e2e/support/*`, scans, catalog cleanup, color tokens if needed (last) |

All `features/...`, `components/...`, `lib/...` and `app/...` paths are under `apps/web/src/`, and test
files under `apps/web/test/`.

## Block 0 — Dashboard calls, 09b parser and adapter, formatters and catalogs

**Files**
- `apps/web/src/lib/api-client.ts` (modified) — interface and implementation of `getDashboard()` and
  `getNetWorthSeries()`, next to the recurring methods.
- `apps/web/src/lib/dashboard-contract.ts` (new) — the provisional parser of the 09b response shape
  (D1, to be replaced by the shared schema).
- `apps/web/src/features/dashboard/dashboard-view.ts` (new) — the view types of the screen.
- `apps/web/src/features/dashboard/contract/dashboard-adapter.ts` (new) — `toDashboardView(raw)`,
  the only reader of raw fields, with category naming and link building.
- `apps/web/src/features/dashboard/format.ts` (new) — locale formatters for whole percents and deltas.
- `apps/web/messages/es.json`, `apps/web/messages/en.json` (modified) — the new `dashboard` namespace and
  the `theme.system` option keys; no other key is changed.
- `apps/web/test/api-client-dashboard.test.ts`, `dashboard-adapter.test.ts`, `dashboard-catalog.test.ts`
  (new).

**Logic**
`getDashboard()` sends one request for the dashboard and `getNetWorthSeries()` one request for the net
worth series, both with the session cookie and no query (FR-18, D2). Each parses its body (the dashboard
with the provisional parser, the series with `netWorthResponseSchema` of `@pesly/shared`), returns the
existing `ApiResult` shape and maps failures with the existing code-to-key map. `toDashboardView(raw)`
turns every amount string into a `bigint` with `BigInt(text)` (the parser has already proven it is an
integer string), keeps percentages and counts as the whole numbers received, maps the budget statuses,
resolves each category name (a default key known to `@pesly/shared` uses `defaultCategoryName` in the
active language; an unknown key uses the name the response carries; with neither, the label key
`dashboard.categories.other`, AC-48) and builds every link (D9). `format.ts` exports `formatWholePercent`,
`formatSignedPercent` (explicit "+" or "−", none for 0) and `formatCount`, using `Intl.NumberFormat` on
whole numbers only. The catalogs get, in both languages with the same structure: `dashboard.title`,
`dashboard.netWorth` (label, ARS and USD lines, conversion unavailable, holdings without a price with a
count), `dashboard.month` (labels, comparison caption, shares and installments left out with a count),
`dashboard.delta` (favorable, unfavorable, no change, no comparison), `dashboard.chart` (name, tooltip,
points list headings, single point, no converted point, retry), `dashboard.categories`,
`dashboard.budgets` (statuses On track, Close, Over; create link), `dashboard.upcoming`,
`dashboard.groups` (owed to you, you owe), `dashboard.attention` (title, one label per action kind, three
queue labels with a count), `dashboard.insight` (sentence with and without the change),
`dashboard.firstSteps`, `dashboard.states` (loading, error, offline, out of date, retry) and
`theme.system` plus the three option labels. Messages with numbers use ICU placeholders; no amount or
date is baked into a string.

**API contract** *(the contract this block consumes; no endpoint is added or changed)*
- Method + path: `GET /dashboard` (09b) and `GET /reports/net-worth` (09a, merged), no query parameter.
- Request: no body, no query; the session cookie authenticates.
- Response: the dashboard body per the assumptions below; the series body is `netWorthResponseSchema`
  (`currency`, `from`, `to`, `points` with `date`, `ars`, `usd`, `total`, `reason`).
- Error codes: 401 (session), the verified-email error, 5xx and the network failure, all through the
  existing code-to-key map; a body that does not match its parser is a generic failure.
- Auth: the existing session cookie through the shared client (credentialed, same-site).
- Assumptions about 09b, to be checked against its merged spec (A1 to A9): A1 a top-level `currency`
  (the display currency); A2 `netWorth` with `ars`, `usd`, `total` (nullable), `reason` (`no_rate` or
  null) and `holdingsWithoutPrice`; A3 `month` with `expenses`, `income`, `net` amounts, a `change` per
  value (nullable integer) and the counts of shares and installments left out; A4 `categories` rows with
  `categoryId`, `defaultKey`, `name` (both nullable), `amount` and `share`; A5 `budgets` rows with `id`,
  `name`, `currency`, `percent` and `status`; A6 `upcoming` and `actions` rows with `kind`, the id that
  resolves them (UUID), and optionally `name`, `date`, `amount` and `currency` (the screen falls back to
  the kind label when a name is absent); A7 `groups` with `owedToYou` and `youOwe`, each `ARS` and `USD`;
  A8 `insight` as null or `{defaultKey, name, share, change}`; A9 `firstSteps` with `hasAccount`,
  `hasMovement` and `show`. The PRD Decision Log 8 (names in the response) is the open question behind A4
  and A5; if 09b carries ids only, one more request is needed and NFR-05 changes from 2 to 3.

**Data model** *(view types only; nothing is persisted)*
- `Currency` is `'ARS' | 'USD'`; every amount is a `bigint` in minor units, never null unless stated.
- `NetWorthView`: `total` bigint, nullable; `reason` `'no_rate'`, nullable; `ars`, `usd` bigint;
  `holdingsWithoutPrice` integer, default 0.
- `MonthView`: `expenses`, `income`, `net` each `{value: bigint; change: number | null}`; `leftOutCount`
  integer, default 0.
- `CategoryView`: `key` string unique per row, `label` (default key and name, both nullable), `amount`
  bigint, `share` integer 0 to 100.
- `BudgetView`: `id` UUID, `name`, `currency`, `percent` integer, `status` one of three values.
- `UpcomingView` and `ActionView`: `kind`, `href` (built, never from free text), `name`, `date` and
  `amount` nullable.
- `GroupsView`: `owedToYou` and `youOwe`, each a record of `Currency` to bigint, default 0.
- `InsightView` nullable; `FirstStepsView` three booleans.
- `SeriesPointView`: `date`, `ars`, `usd` bigint, `total` bigint nullable, `reason` nullable.

**Input validation**
- The parser accepts an amount only as an integer string (optional minus sign, digits, within the 64-bit
  range of `exactIntegerStringSchema`), percentages and counts only as integers, statuses and currencies
  only from their closed sets, ids only as UUIDs. Unknown extra fields are ignored; a missing section is a
  failure of the whole answer (never a guessed value).
- Both catalog files stay valid JSON with identical key sets and no empty value.

**Error handling**
- A body that does not match its parser, including an amount such as `"12.5"`, is a generic failure and
  yields no view.
- A 401, a verified-email error or a 5xx keeps its own message key; a network failure keeps the offline
  failure kind so the container can tell them apart.
- A category with an unknown default key and no name still gets a label, never an empty string.

**Required tests**
- [ ] `getDashboard` sends a single request to `/dashboard` with no query and returns the parsed body — validates AC-37.
- [ ] `getNetWorthSeries` sends a single request to `/reports/net-worth` with no query and returns the points — validates AC-37 and AC-10.
- [ ] A network failure and a 401 keep their own failure kinds and message keys — validates AC-03 and AC-36.
- [ ] A malformed body (decimal amount, unknown status, id that is not a UUID) is an error and yields no view — invalid input.
- [ ] `toDashboardView` turns `"142000000"` into the `bigint` 142000000n and keeps the display currency, ARS and USD — validates AC-01 and AC-50.
- [ ] A null total with the reason `no_rate` keeps both parts and no total; a null change stays null — validates AC-05 and AC-09.
- [ ] The budget statuses and their order are kept as returned — validates AC-17.
- [ ] A known default key is named in the active language, an unknown key falls back to the response name, and with no name to the generic label — validates AC-48.
- [ ] Links are built only from UUID ids and fixed prefixes, and fall back to `/recurring` or `/cards` — validates AC-21.
- [ ] `formatSignedPercent` gives "+20%", "−5%" and "0%" for es and en, and no float is involved — validates AC-08 and AC-47.
- [ ] The Spanish and English catalogs have the same keys, none empty, and every key of the namespace exists in both — validates AC-47.
- [ ] A catalog with a missing key or an empty value fails the parity test — invalid input.

**Completion criterion**
The api-client, adapter and catalog tests pass, the existing catalog parity test passes and typecheck is
clean; the parser and the adapter are the only files that name a raw dashboard field.

## Block 1 — Breakpoint from 900 px to 1024 px and navigation rows

**Files**
- `apps/web/src/app/globals.css` (modified) — only the `--breakpoint-desk` line and its comment.
- `apps/web/src/lib/use-compact-viewport.ts` (modified) — the compact query and its comment.
- `apps/web/src/features/shell/components/top-nav.tsx` (modified) — comment, and the theme control gets
  its own full-width row above the sign out button.
- `apps/web/src/features/shell/components/bottom-nav.tsx` (modified) — comment only.
- `apps/web/test/shell-breakpoint.test.tsx` (new).

**Logic**
The `desk` token becomes `64rem` (1024 px), which moves the side menu, the bottom bar and the nine files
that use `desk:` in one place (FR-19). The compact query of `useCompactViewport` becomes
`(max-width: 63.9975rem)`, the same "just below the token" trick the 900 px value used, so the two never
disagree. The side menu's footer becomes a grid with the theme control on a full-width row and the sign
out button below it, so the three options of Block 2 have room at the 264 px width; the component is used
as it is today and keeps its exported name. No page other than the shell is restyled; the pages that use
`desk:` are checked in the browser by Block 8 at 1023 and 1024 px.

**Error handling**
- A browser without `matchMedia` keeps the current fallback (not compact), so server rendering and tests
  without the API are unchanged.
- A stale mention of 900 px left in a comment or a test is an error found by the scan of this block.

**Required tests**
- [ ] The `desk` token of `globals.css` is `64rem` and the text `56.25rem` no longer appears in the app sources — validates AC-38, AC-39 and AC-40.
- [ ] `useCompactViewport` answers true at 1023 px and false at 1024 px, and true at 900 px — validates AC-39 and AC-40.
- [ ] The side menu carries the `hidden desk:flex` classes and the bottom bar the `desk:hidden` class, so exactly one shows at each width — validates AC-38 and AC-39.
- [ ] The theme control and the sign out button are in the side menu footer, each on its own row, and the navigation links keep a 44 px height class — validates NFR-08.
- [ ] The existing shell and navigation tests still pass with the new token — validates FR-19.
- [ ] A scan reports an error for any source, comment or test that still names 900 px as the breakpoint — invalid input.
- [ ] A missing `matchMedia` falls back to not compact without throwing, an error case of the hook — invalid input.

**Completion criterion**
The shell tests pass, the token is 64rem in one place and no source mentions 900 px as the breakpoint.

## Block 2 — Theme: light, dark or system

**Files**
- `apps/web/src/lib/theme.ts` (modified) — the choice type and its parser.
- `apps/web/src/components/theme-provider.tsx` (modified) — choice state, system following.
- `apps/web/src/components/theme-toggle.tsx` (modified) — the three-option control (D7).
- `apps/web/test/theme-provider.test.tsx` (modified), `apps/web/test/theme-control.test.tsx` (new).

**Logic**
`lib/theme.ts` adds `THEME_CHOICES = ['light', 'dark', 'system']` and `parseThemeChoice`, which returns the
stored value when it is `light` or `dark` and `system` for anything else (missing, tampered or the legacy
`system`); `resolveTheme` and the constant pre-paint script are not changed, so the key and the rules stay
in sync. The provider keeps the choice, the resolved theme and the operating system preference: choosing
`system` removes the stored key (inside a guarded call), choosing `light` or `dark` stores it, and a
blocked storage keeps the choice in memory for the session (FR-21). It already listens to
`prefers-color-scheme`, so with `system` chosen an operating system change toggles the `dark` class
without a reload (FR-20). `useTheme()` returns `{theme, choice, setTheme}` where `setTheme` accepts a
choice. `ThemeToggle` renders a labeled radio group of three native radio inputs, each in a label of at
least 44 px with an icon and its text; the current one shows a check mark and is the checked radio, and
with no stored choice "System" is the checked one. Arrow keys move and select, as native radios do.

**Input validation**
- The stored value is read as an unknown string and accepted only when it is exactly `light` or `dark`;
  anything else means no choice.

**Error handling**
- A `localStorage` read or write that throws is swallowed in the existing guarded helpers: the control
  keeps working for the session and the page does not fail.
- A `matchMedia` that is missing or changes while unmounted adds no error (listener removed on unmount).

**Required tests**
- [ ] Opening the control offers light, dark and system and marks the current one with a check mark and a checked state, not by color alone — validates AC-41.
- [ ] With nothing stored, "System" is checked and the interface follows the operating system dark or light setting — validates AC-42.
- [ ] With "System" chosen, a change of the operating system preference toggles the dark class without a reload — validates AC-43.
- [ ] Choosing dark stores the key and adds the dark class; choosing system removes the key; the choice survives a remount, as after signing out and in — validates AC-44.
- [ ] A blocked `localStorage` (read and write throw) applies the choice for the session and shows no error — validates AC-45.
- [ ] A stored value that is invalid (`"purple"`, the legacy `"system"`) is treated as no choice and the pre-paint script still follows the operating system — validates AC-46 and invalid input.
- [ ] The pre-paint script string applies dark for a stored `dark` before any component runs and is constant (no variable text) — validates AC-46.
- [ ] Arrow keys move between the options, each option has a label and a 44 px height class — validates NFR-08.
- [ ] The three labels render in Spanish and English — validates FR-20.

**Completion criterion**
The theme tests pass, the three-option control replaces the switch in the side menu, the More page and the
design-system page without touching their files.

## Block 3 — KPI cards, delta chips and the month notice

**Files**
- `apps/web/src/features/dashboard/components/kpi-cards.tsx` (new) — the three cards.
- `apps/web/src/features/dashboard/components/delta-chip.tsx` (new) — sign, number and word.
- `apps/web/src/features/dashboard/components/month-notice.tsx` (new) — the left-out notice.
- `apps/web/test/dashboard-kpi.test.tsx` (new).

**Logic**
`KpiCards` renders the month's expenses, income and net result (FR-04) from `MonthView` with `formatMoney`
in the display currency, composing `Card` and `Badge`; a negative net result prints with its minus sign
(AC-07). At 360 px the three cards stack as compact rows (label and value on one line, chip below) and
from `sm` they sit in one row; every card has `min-w-0` and wraps long amounts instead of overflowing.
`DeltaChip` takes the change, the kind (`expense`, `income` or `net`) and the locale, and renders the
signed whole percent from `formatSignedPercent` plus a visible word per D10 (FR-05); it uses the `success`
badge variant for favorable, `destructive` for unfavorable and `outline` for no change or no comparison.
`MonthNotice` shows, when `leftOutCount` is above 0, a notice with the count and the reason (a share or an
installment in another currency has no frozen rate), and nothing at 0 (FR-16). Nothing here adds,
subtracts or converts an amount.

**Error handling**
- A null change renders "—" with the "No comparison" word, never "NaN%" or an empty chip.
- A change outside the expected range (for example 100000) is printed as received and wraps.
- An amount of 0 prints "0,00" with its currency and no sign.

**Required tests**
- [ ] Three KPI cards show October expenses 240,000.00 ARS, income 800,000.00 ARS and net result 560,000.00 ARS — validates AC-06.
- [ ] A negative net result prints with a minus sign — validates AC-07.
- [ ] A null change is an error-free edge: no "NaN%" and no empty chip is rendered — invalid input.
- [ ] An invalid out-of-range change (100000) prints as received and wraps; an amount of 0 prints with no sign — invalid input.
- [ ] An expenses change of 20 reads "+20%" with the word Unfavorable, and an income change of 20 reads "+20%" with the word Favorable — validates AC-08.
- [ ] A null change reads "—" with the no-comparison word — validates AC-09.
- [ ] With a display currency of USD the three amounts print in USD — validates AC-50.
- [ ] A count of 3 left-out shares or installments shows the notice with that count, and an invalid count of 0 shows none and no error — validates AC-32.
- [ ] Rendering every chip variant without any stylesheet still shows a sign or a word for 100% of them (positive, negative, zero, null; each of the three kinds) — validates NFR-04.
- [ ] Every card is reachable and has an accessible name, the chip text is not hidden from assistive technology, and no element is interactive without a 44 px target — validates NFR-08.
- [ ] Spanish and English strings and amounts render — validates AC-47.

**Completion criterion**
The KPI tests pass and every chip variant carries text or a sign.

## Block 4 — Net worth card and area chart

**Files**
- `apps/web/src/features/dashboard/components/net-worth-card.tsx` (new) — the card and its states.
- `apps/web/src/features/dashboard/components/net-worth-notice.tsx` (new) — holdings without a price.
- `apps/web/src/features/dashboard/chart/net-worth-chart.tsx` (new) — the SVG, the slider and the tooltip.
- `apps/web/src/features/dashboard/chart/chart-geometry.ts` (new) — pure coordinates in bigint (D3).
- `apps/web/src/features/dashboard/chart/net-worth-points-list.tsx` (new) — the grid for assistive technology.
- `apps/web/test/dashboard-net-worth.test.tsx`, `dashboard-chart-geometry.test.ts` (new).

**Logic**
`NetWorthCard` shows the `total` in the display currency as the first and largest element (FR-01), the ARS
part and the USD part on separate lines, each as returned and never converted (FR-02), and the holdings
notice with its count when above 0 (FR-16). With a null total and the reason `no_rate` it shows the two
parts and a message that the conversion is unavailable, and no converted total (FR-03). Under the figures
sits the chart for a ready series, or, for a failed series, an error with a retry action that fills the
chart's place (AC-34), so the rest of the card never moves. `chart-geometry.ts` takes the drawn points (the
ones with a total), computes the minimum and maximum in bigint, and returns for each point an x position
(index spread over 0 to 1000) and a y permille ((value − min) × 1000 / (max − min), or 500 when max equals
min), converted with `Number.parseInt(permille.toString(), 10)`; it never divides money by a float. The
chart draws an area and a line with `stroke-chart-2` and `fill-chart-2/15` (theme tokens), one dot per
drawn point, and nothing else; 12 drawn points draw 12 dots (FR-06). A single drawn point shows the dot and
its value as text and no line (AC-11); no drawn point shows no line, the conversion-unavailable message and
the points list (AC-12). The plot is one `role="slider"` element with `aria-valuetext` (date and value);
pointer move, tap, arrow keys, Home and End select a drawn point and show a tooltip with its date (formatted
with `formatCalendarDate`) and its value (FR-07, AC-13); the tooltip anchor is clamped so it never leaves
the plot, with no horizontal scroll. `NetWorthPointsList` always renders a native data grid with a caption,
one row per point of the series, in order: date and value, or, for a point with no total, its ARS and USD
parts and the conversion-unavailable text (AC-14). The card says in text that the last point may differ
slightly from the figure above (the card is the figure of record).

**Data model** *(view types of the chart, nothing persisted)*
- `ChartPoint`: `date` string, `value` bigint, `x` integer 0 to 1000, `y` integer 0 to 1000 (constraints:
  both coordinates are not nullable and derive only from the series).
- Default selection: none until the user points, taps or focuses; the slider starts at the last drawn
  point for keyboard users.

**Input validation**
- Keyboard and pointer input only select an index among the drawn points: an index outside the range is
  clamped, a pointer position outside the plot is ignored, and no text is parsed.

**Error handling**
- A failed series shows the retry in the chart's place and calls `onRetry` once per press; while
  `retrying` the button is disabled so a double tap sends one request.
- A series with 0 points renders the conversion-unavailable message and an empty points list without an
  error; points with equal values draw a flat line, not a division by zero.
- A total of 0 with USD and ARS parts of 0 draws and prints "0,00" without a sign.

**Required tests**
- [ ] A total of 142000000 minor units in ARS prints "1,420,000.00 ARS" in English on the card — validates AC-01.
- [ ] An ARS part of 1,000,000.00 and a USD part of 1,000.00 show on two separate lines and no converted sum — validates AC-04.
- [ ] A null total with the reason `no_rate` shows both parts, the unavailable message and no converted total — validates AC-05.
- [ ] A series with 12 converted points draws 12 dots — validates AC-10.
- [ ] A series with a single point shows the point and its value and no line — validates AC-11.
- [ ] A series with no converted point shows no line, the unavailable message, and each point's ARS and USD parts in the points list — validates AC-12.
- [ ] Hover, tap and arrow keys on the plot show a tooltip with that month end's date and net worth — validates AC-13.
- [ ] The points list has one row per point with the date and the value or the two parts, and a caption — validates AC-14.
- [ ] A count of 2 holdings without a price shows a notice with that count, and 0 shows none — validates AC-31.
- [ ] A series error with a successful card shows the retry in place of the chart and calls the retry once on a double tap — validates AC-34.
- [ ] A series with 0 points and a flat series draw no error and no invalid coordinate (no division by zero) — invalid input.
- [ ] With a display currency of USD the total and the points print in USD — validates AC-50.
- [ ] The geometry keeps the extremes at 0 and 1000, a flat series at 500, and never throws on 0 or 1 points, an error-free edge — invalid input.
- [ ] The slider is focusable, labeled and 44 px tall, and the retry button is a 44 px target — validates NFR-08.
- [ ] Spanish and English strings, dates and amounts render — validates AC-47.

**Completion criterion**
The net worth and geometry tests pass, the chart needs no dependency and every drawn point is reachable by
keyboard.

## Block 5 — Category, budgets, upcoming and group cards

**Files**
- `apps/web/src/features/dashboard/components/categories-card.tsx` (new) — spending by category.
- `apps/web/src/features/dashboard/components/budgets-card.tsx` (new) — up to 3 budgets with pills.
- `apps/web/src/features/dashboard/components/upcoming-card.tsx` (new) — the next 7 days.
- `apps/web/src/features/dashboard/components/groups-card.tsx` (new) — owed and owing.
- `apps/web/test/dashboard-cards.test.tsx` (new).

**Logic**
`CategoriesCard` lists the rows as returned (FR-08): each row is a list item with the category name, its
amount in the display currency, its whole-number share as text ("60%") and a thin horizontal bar whose
width is the share (`style` width in percent, a drawing value); the text is always there, so color is never
the only identifier. With an empty list it shows a short "no spending this month" message instead of a
chart (AC-16). `BudgetsCard` shows at most 3 budgets in the order received, each a link to
`/budgets/{id}` with its name, its own currency, its percentage used as text and a status pill built on
`Badge` reading "On track", "Close" or "Over" (`success`, `warning`, `destructive` variants); with none it
shows a link to create one (FR-09). `UpcomingCard` lists the entries in the order returned, each with its
date (`formatCalendarDate`), name and amount in its own currency, linking where the adapter says; with none
it says nothing is due (FR-10). `GroupsCard` shows "owed to you" and "you owe" per currency in four cells,
never summed or netted, each cell as returned (FR-13); a currency with 0 shows "0,00". Every list is a
real list with an accessible name and every link is a 44 px target.

**Error handling**
- A budget with a percentage above 100 prints as received and its bar is not drawn beyond the card.
- A category row with an empty label falls back to the generic label from the adapter, never to an empty
  string.
- An upcoming entry with no name uses the label of its kind, and one with no amount prints only the name
  and date.

**Required tests**
- [ ] Food with 120,000.00 ARS and 60 and Transport with 80,000.00 ARS and 40 list name, amount and "60%" and "40%" as text — validates AC-15.
- [ ] An empty category list shows the no-spending message and no chart, an error-free empty state — validates AC-16.
- [ ] Budgets with the statuses over, close and on track show in that order with the pills Over, Close and On track — validates AC-17.
- [ ] No budget shows a link to create one — validates AC-18.
- [ ] A payment due in 3 days and a statement due in 6 days list the payment first with date, name and amount in their own currency — validates AC-19.
- [ ] Nothing due shows the nothing-due message — validates AC-20.
- [ ] 30,000.00 ARS owed to the user and 50.00 USD owed by the user show in "owed to you" and "you owe" with no difference — validates AC-25.
- [ ] A category with an unknown key and no name still shows a non-empty label and the response name when present — validates AC-48.
- [ ] Every status pill variant rendered without a stylesheet still reads its word — validates NFR-04.
- [ ] A budget over 100 percent and a row with a long name render with `min-w-0` and wrapping, with no error — invalid input.
- [ ] A category row with an empty label and an upcoming entry with no name or amount fall back without an error and without an empty string — invalid input.
- [ ] Lists are labeled and links have a 44 px height class — validates NFR-08.
- [ ] Spanish and English strings, dates and amounts render — validates AC-47.

**Completion criterion**
The card tests pass and every pill carries its word.

## Block 6 — "Do these first", device-queue items, insight and first steps

**Files**
- `apps/web/src/features/dashboard/components/do-these-first.tsx` (new) — the list.
- `apps/web/src/features/dashboard/attention/attention-items.ts` (new) — `buildAttentionItems`.
- `apps/web/src/features/dashboard/attention/use-queue-attention.ts` (new) — the device-queue hook (D5).
- `apps/web/src/features/dashboard/components/insight-card.tsx` (new) — the one sentence.
- `apps/web/src/features/dashboard/components/first-steps.tsx` (new) — the guide.
- `apps/web/test/dashboard-attention.test.tsx`, `dashboard-first-steps.test.tsx` (new).

**Logic**
`buildAttentionItems(actions, queue)` returns the server actions in the order received (overdue first, as
the API orders them) followed by at most three queue items, each with a count: failed movements
(link `/movements`), failed group changes and group conflicts (links `/groups`), and nothing for a count
of 0 (FR-11, FR-12). `DoTheseFirst` renders a titled list where each item is a link with its text (kind
label, name, due date and amount when present, "Overdue" word for an overdue one); an empty list renders
nothing, not even the title (AC-22). `useQueueAttention` calls `readQueueCounts` and `readGroupQueueCounts`
with the id of the session pointer, re-reads on the queue-changed and sync-finished events, treats an
unreadable queue as empty, and returns `ready` once the first read ends; it makes no HTTP request and
works offline (AC-24). `InsightCard` builds one sentence from the category label, the share and the
change: with a change it says whether spending is above or below the previous 3 months' average, with a
null change it keeps the share only, and with a null insight it renders nothing (FR-14). `FirstSteps`
shows the two steps, "create an account" (link `/accounts/new`) and "record a movement" (link
`/movements/new`), marks a finished step with a check and the word "Done", and links only the pending
one as the primary action (FR-15).

**Error handling**
- A queue that cannot be read counts as empty and the hook still becomes ready, so the dashboard never
  waits for a failed read.
- An action kind this build does not know uses the generic label and still links to its fallback page.
- A change of exactly 0 reads "in line with" the average, never "0% above".

**Required tests**
- [ ] A pending occurrence, an overdue occurrence and an unpaid statement list 3 items with the overdue one first, each linking where it is resolved — validates AC-21.
- [ ] No action and an empty device queue render no title and no list — validates AC-22.
- [ ] 2 failed movements and 1 group conflict list 2 items with links to `/movements` and `/groups` — validates AC-23.
- [ ] With the connectivity status offline the queue items still list, and no request is sent — validates AC-24.
- [ ] Restaurants with a share of 32 and a change of 40 show one sentence stating both numbers — validates AC-26.
- [ ] A null change shows the sentence with the share only — validates AC-27.
- [ ] A null insight renders nothing — validates AC-28.
- [ ] With no account the guide links to create one and shows no chart or KPI card — validates AC-29.
- [ ] With an account and no movement the account step is marked done and the movement step links to record one — validates AC-30.
- [ ] An unreadable queue (the reader rejects with an error) counts as empty and the hook is ready — invalid input.
- [ ] An unknown action kind renders the generic label with a link — invalid input.
- [ ] Items and steps are links with 44 px height classes and accessible names — validates NFR-08.
- [ ] Spanish and English sentences, labels and numbers render — validates AC-47.

**Completion criterion**
The attention and first-steps tests pass and no HTTP call is made by the hook.

## Block 7 — Dashboard container, screen layout and the new home

**Files**
- `apps/web/src/features/dashboard/containers/dashboard-container.tsx` (new) — requests and states.
- `apps/web/src/features/dashboard/containers/dashboard-session-cache.ts` (new) — the in-memory store (D6).
- `apps/web/src/features/dashboard/components/dashboard-screen.tsx` (new) — the layout of the cards.
- `apps/web/src/features/dashboard/components/dashboard-skeleton.tsx` (new) — the loading layout.
- `apps/web/src/app/[locale]/(app)/page.tsx` (modified) — renders the new container.
- `apps/web/src/features/home/**` (removed components and container; `quick-actions.tsx` and
  `time-zone.ts` stay), `apps/web/test/home-components.test.tsx` (modified: only the quick actions),
  `home-container.test.tsx`, `home-recent-movements-link.test.tsx` (removed), `groups-list.test.tsx`
  (modified: the shortcuts case removed), `apps/web/test/dashboard-container.test.tsx` (new).

**Logic**
On opening, the container sends the dashboard request and the net worth series request together with
`Promise.all`, and no other request for figures (FR-18); it never calls the profile or the accounts. It
also waits for `useQueueAttention` to be ready. State is `loading`, `failed`, `offline-empty` or `ready`
with a series state of its own (FR-17). While loading it renders the skeleton, which has the same layout
and card heights as the ready screen, with the net worth card as the first element (AC-33, AC-02). A
failed dashboard request shows the shared error state with a retry and no amount (AC-03) and an expired
session redirects to sign-in like the old home. A failed series request with a successful dashboard shows
every other widget and the chart-sized error with its own retry, which sends only the series request
(AC-34). When a request fails with the network failure while the device is offline, the container reads
the memory store for the session pointer's user: with data it keeps showing it under a notice that it is
out of date (AC-35), without data it shows the offline message and a retry (AC-36). Every success writes
the store. `DashboardScreen` lays the cards out as one stack below `desk` and as a two-part grid from `desk`
(net worth card, KPI cards and categories on the left, "Do these first", budgets, upcoming, groups and
insight on the right), keeps `QuickActions` after the first screen of cards (FR-23), and when
`firstSteps.show` is true renders `FirstSteps` in place of the net worth card and the KPI cards and hides
the other cards, keeping "Do these first" (D8). The home page keeps its `<main>` and a visually hidden
level-one heading. The removed home components and tests go with the `home` container.

**Input validation**
- The only inputs are the two answers; both pass their parsers (Block 0) before the screen sees them, and
  the session pointer's user id is only compared for equality with the key of the store.

**Error handling**
- A dashboard failure while online is the error state; the retry is single-flight (disabled while a
  request is in flight) and re-sends both requests.
- A failure of the series alone never hides another widget, and a failure of the dashboard never shows an
  amount from another user: the store is read only for the same user id and only when offline.
- A successful reload replaces the out-of-date notice and the store at once.

**Required tests**
- [ ] While the requests are pending the net worth card is a skeleton with no amount — validates AC-02.
- [ ] A failed dashboard request shows the error state with a retry and no amount; retry sends the two requests again once — validates AC-03.
- [ ] The skeleton and the loaded screen share the same cards, order and heights (same class markers), so the content does not move — validates AC-33.
- [ ] A failed series request with a successful dashboard shows every other widget and the retry in the chart's place, and its retry sends only the series request — validates AC-34.
- [ ] An offline failure with earlier data of the session keeps the data under the out-of-date notice — validates AC-35.
- [ ] An offline failure with no earlier data shows the offline message, a retry and no amount; data of another user id is never shown — validates AC-36.
- [ ] Opening the dashboard sends exactly 2 requests, one to `/dashboard` and one to `/reports/net-worth`, and none to accounts, movements, profile, budgets, recurring, cards or groups — validates AC-37 and NFR-05.
- [ ] An API error response (500) on both requests is the error state and the screen shows no partial section — validates AC-49.
- [ ] A 401 answer redirects to sign-in and shows no amount — invalid input.
- [ ] With the guide flag true the guide replaces the net worth card and the KPI cards, the other cards are absent and "Do these first" still shows its queue items — validates AC-29 and AC-30.
- [ ] The home page shows the "add movement" quick action and none of the balance summary, month summary or pending payment banner — validates AC-49.
- [ ] The screen renders in Spanish and English with the locale's amounts, percentages and dates — validates AC-47.
- [ ] The retry buttons and links are 44 px targets reachable by keyboard in a logical order — validates NFR-08.

**Completion criterion**
The container tests pass, the home page shows the dashboard, typecheck is clean with the removed
components, and the old home tests no longer reference removed files.

## Block 8 — Browser tests, scans, cleanup and final verification

**Files**
- `apps/web/e2e/dashboard.spec.ts` (new) — states, widths, themes, navigation, theme control.
- `apps/web/e2e/dashboard-lcp.spec.ts` (new) — the lab LCP test (D12).
- `apps/web/e2e/support/dashboard.ts` (new) — seeds and request counters.
- `apps/web/e2e/support/contrast.ts` (new) — the contrast probe (D11).
- `apps/web/test/dashboard-scans.test.ts` (new) — string, money and dependency scans.
- `apps/web/messages/es.json`, `apps/web/messages/en.json` (modified) — removal of the unused `home.*` keys.
- `apps/web/src/app/globals.css` (modified only if the probe finds a failing color pair).

**Logic**
The browser spec signs in a seeded user (accounts in ARS and USD, an expense and an income this month and
last month, a budget, a recurring payment due in 3 days and a closed statement due in 2 days, built with
the existing support helpers and `withE2eDatabase`) and checks, at 360 and 1280 px, in light and dark, that
the net worth card, the three KPI cards and "Do these first" are in view, that the page has 0 horizontal
scroll, and that the dashboard sent exactly one request to each of the two paths and none to the other
figure paths (FR-18). A loop over 360, 768, 1023, 1024 and 1920 px in both themes asserts no horizontal
scroll on the dashboard and the navigation (NFR-02), the bottom bar and no side menu at 1023 and the
reverse at 1024 (AC-38 to AC-40). Further tests cover the states: first steps for a new user, the
conversion-unavailable state (stored rates removed), a failed series (request aborted), a failed
dashboard (response 500), offline after a load (out-of-date notice) and a device-queue item. The theme
tests choose dark, sign out and in again and expect the dark theme (AC-44), block the app scripts and
expect the dark class already present before the first paint (AC-46) and switch the operating system
preference with "System" chosen (AC-43). The contrast probe reads, for every text node, the computed text
color and the composited background (resolved through a canvas so any CSS color syntax gives sRGB), checks
4.5:1 for text and 3:1 for the chart line, the category bars and the focus ring, on every state in both
themes (NFR-03). The lab test runs the production build under the CDP profile 5 times and fails when the
median of the largest contentful paint is 2.5 s or more (NFR-01). The scan test checks every touched web
file for hardcoded strings, `parseFloat`, `toFixed` and `Number(` and for color literals, and the
dependency block of `apps/web/package.json` against its recorded list (NFR-05, NFR-06). The coverage run
checks the 80% thresholds on the touched files (NFR-07).

**Input validation**
- The seeded values are typed in the spec's own helpers and the request counter reads only the path of
  each request, so no test input reaches the application unvalidated.

**Error handling**
- A contrast pair under its threshold names the element, its colors and the state, so the failing token
  is found at once; a failing text pair is fixed in the token and the whole probe runs again.
- A run of the lab test that cannot attach the throttling session is an error, never a silent pass.
- A seed that cannot be created fails the spec with the helper's own message.

**Required tests**
- [ ] The dashboard at 360 px and at 1280 px, in light and dark, shows the net worth card, the three KPI cards and "Do these first" in view with 0 horizontal scroll — validates NFR-02 and AC-06.
- [ ] Widths 360, 768, 1023, 1024 and 1920 in both themes have no horizontal scroll on the dashboard and the navigation — validates NFR-02.
- [ ] At 1024 px or more the side menu shows and the bottom bar does not; at 1023 px and at 900 px the bottom bar shows and the side menu does not — validates AC-38, AC-39 and AC-40.
- [ ] The theme control offers light, dark and system; dark survives signing out and in; the dark class is present with the app scripts blocked; an operating system change updates "System" without a reload — validates AC-41, AC-43, AC-44 and AC-46.
- [ ] The dashboard sends exactly 2 figure requests on opening in the real browser — validates AC-37 and NFR-05.
- [ ] A new user sees the first-steps guide and no chart; after creating an account the movement step remains — validates AC-29 and AC-30.
- [ ] With stored rates removed the net worth card shows both parts and the unavailable message; with a failed series the chart shows its retry and the other cards stay — validates AC-05 and AC-34.
- [ ] A failed dashboard request (500) shows the error state with a retry that works, and offline after a load shows the out-of-date notice — validates AC-03 and AC-35.
- [ ] Every interactive element of the dashboard and the navigation is at least 44 by 44 px and reachable by keyboard — validates NFR-08.
- [ ] The contrast probe passes on the ready, first-steps, no-rate, chart-error, error and offline states in both themes — validates NFR-03.
- [ ] The lab LCP median of 5 runs under the reference profile is below 2.5 s — validates NFR-01.
- [ ] No dashboard string is hardcoded and no `parseFloat`, `toFixed` or `Number(` is applied to money in a touched file; the design-system scan and the catalog parity test pass after the cleanup of the `home.*` keys — validates NFR-06.
- [ ] The runtime dependency list of `apps/web/package.json` is unchanged — validates NFR-05.
- [ ] The coverage run reports at least 80% lines, branches and functions over the touched files — validates NFR-07.
- [ ] The home page offers the quick action and no balance summary in the browser — validates AC-49.
- [ ] A contrast probe error names the element, its colors and the state; a probe run without the throttling session is an error, never a silent pass — invalid input.

**Completion criterion**
The e2e specs and the scans pass, the full web suite and the coverage thresholds pass, and the lab LCP test
is below 2.5 s.

## Final verification
- Every FR (FR-01 to FR-23), NFR (NFR-01 to NFR-08) and AC (AC-01 to AC-50) has a test; every input and
  every documented error has a sad-path test.
- `pnpm typecheck`, eslint and Prettier on touched files pass; the full suite and `pnpm test:coverage`
  pass; `pnpm e2e` passes for the new specs and the existing design-system and navigation specs.
- No file under `apps/api`, `packages/shared` or `apps/api/drizzle` is changed, and `apps/web/package.json`
  has the same runtime dependencies.
- When 09b merges: delete `lib/dashboard-contract.ts`, import its shared schema in the api-client and
  re-check the nine assumptions A1 to A9 against it in `dashboard-adapter.ts` only.
- Owner ratification items (the PRD's Decision Log 1 to 8, plus): D1 (provisional contract), the
  check-mark-plus-label reading of "marked by text" in AC-41 (D7), the first-steps layout (D8), the
  fallback links to `/recurring` and `/cards` when the response has no payment or card id (D9), and the
  contrast probe in place of an accessibility library (D11).

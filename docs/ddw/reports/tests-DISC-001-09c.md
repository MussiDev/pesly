# Test run DISC-001-09c

| Field | Value |
|---|---|
| Runner | vitest (V8 coverage via @vitest/coverage-v8), full suite with coverage; Playwright for the browser specs |
| Command | `pnpm test:coverage` (Vitest over `apps/api/src`, `apps/web/src` and `packages/shared/src` together, V8 coverage, `TEST_DATABASE_URL` pointing at the local PostgreSQL); `pnpm e2e` for `dashboard.spec.ts`, `design-system.spec.ts` and `dashboard-lcp.spec.ts` |
| Total | 10374 |
| Passed | 10374 |
| Failed | 0 |
| Skipped | 0 |
| Line coverage | 96.81 |
| Branch coverage | 90.05 |
| Function coverage | 94.93 |
| Statement coverage | 94.94 |
| Coverage floor | 80% lines, branches and functions (AGENTS.md, "Testing") |

## Scope

Full-suite run on the worktree of DISC-001-09c after merging `main` (09b included): 651 test files, 10374 tests, all passing, measured over `apps/api/src`, `apps/web/src` and `packages/shared/src` together, as AGENTS.md requires. The ticket is web only: the dashboard screens (net worth card and SVG area chart, three KPI cards, category, budgets, upcoming and group cards, "Do these first" with the device-queue items, insight, first steps, skeleton, error and offline states), the `desk` breakpoint moved from 900 px to 1024 px, the three-option theme control (light, dark, system), the new home page and the cleanup of the old `home.*` keys. No file under `apps/api`, `packages/shared` or `apps/api/drizzle` is changed and no dependency is added. The dashboard body is parsed with the shared schema from `@pesly/shared` (09b merged), not a local copy.

Browser tests (Playwright against the dev server): `dashboard.spec.ts` and `design-system.spec.ts` together give 45 passed and 1 skipped. The skipped test is the request-count test (`the home sends exactly one request to each of the two figure paths ...`), which only runs with `E2E_PRODUCTION_BUILD=1`; it passed in an earlier production-build run (22 of 22 in `dashboard.spec.ts`). `dashboard-lcp.spec.ts` passed in the earlier production-build run (median of 5 runs under CDP throttling, below 2.5 s, NFR-01). The contrast probe (`e2e/support/contrast.ts`) passes on the ready, first-steps, no-rate, chart-error, error and offline states in both themes (NFR-03).

Product bugs found by the browser tests and fixed (each with a regression check in the specs): the visually hidden points table made the page 524 px wide at 360 px (NFR-02); the sync banner links were under 44 px (NFR-08); the light-theme success and warning text had contrast ratios of 4.32:1 and 4.34:1, so the tokens were corrected (NFR-03).

Fixes made after the independent module verifier and the SAST scan, each with a test written first and included in the 10374 above: the month notice is rendered by the screen (`dashboard-screen-month-notice.test.tsx`); the chart draws segments by date instead of bridging missing totals, and is hidden when the series currency differs from the display currency (`dashboard-net-worth.test.tsx`); the skeleton gives up waiting for IndexedDB after 2 s; the in-memory dashboard answers are cleared on sign-out and on the unauthenticated redirect (`dashboard-container.test.tsx`); the tooltip closes on Escape and the slider moves by a page with PageUp and PageDown; the theme provider guards a missing `matchMedia` and follows the `storage` event.

## Acceptance criteria to tests

Folder `apps/web/test` unless a path is given; `e2e/` is `apps/web/e2e`. Tags in the test names are the AC numbers of this PRD; where a test has no tag, it is matched by name and said so.

| AC | Tests |
|---|---|
| AC-01 | `dashboard-net-worth.test.tsx` "prints the total in English as 1,420,000.00 ARS (AC-01)"; `dashboard-adapter.test.ts` "turns amount strings into bigint and keeps the currency, ARS and USD (AC-01, AC-50)" |
| AC-02 | `dashboard-container.test.tsx` "shows a skeleton with no amount while the requests are pending (AC-02)" |
| AC-03 | `dashboard-container.test.tsx` "DashboardContainer errors (AC-03, AC-49)": "shows the error state with no amount and a retry that re-sends both requests once" and "recovers when the retry succeeds"; `api-client-dashboard.test.ts` "keeps the network failure and the 401 as their own kinds (AC-03, AC-36)"; `e2e/dashboard.spec.ts` "a failed dashboard shows the error state, and its retry works (AC-03)" |
| AC-04 | `dashboard-net-worth.test.tsx` "shows the ARS and USD parts on two separate lines and no converted sum (AC-04)" |
| AC-05 | `dashboard-net-worth.test.tsx` "with a null total and no_rate shows both parts, the message and no total (AC-05)"; `dashboard-adapter.test.ts` "keeps both parts and no total on no_rate, and a null change null (AC-05, AC-09)"; `e2e/dashboard.spec.ts` "with the stored rates removed the net worth card shows both parts and the unavailable message (AC-05)" |
| AC-06 | `dashboard-kpi.test.tsx` "shows October expenses, income and net result in ARS (AC-06)"; `e2e/dashboard.spec.ts` "the home at ${width} px in the ${theme} theme shows its cards with no horizontal scroll (NFR-02, AC-06)" |
| AC-07 | `dashboard-kpi.test.tsx` "prints a negative net result with a minus sign (AC-07)" |
| AC-08 | `dashboard-kpi.test.tsx` "reads +20% Unfavorable for expenses and +20% Favorable for income (AC-08)"; `dashboard-adapter.test.ts` "formatSignedPercent gives +20%, -5% and 0% in es and en (AC-08, AC-47)" |
| AC-09 | `dashboard-kpi.test.tsx` "reads a dash and the no-comparison word for a null change (AC-09)"; `dashboard-adapter.test.ts` the null-change test (AC-05, AC-09) |
| AC-10 | `dashboard-net-worth.test.tsx` "draws 12 dots for 12 converted points (AC-10)"; `dashboard-adapter.test.ts` "maps points to bigint and keeps null totals with their reason (AC-10, AC-12)"; `api-client-dashboard.test.ts` "getNetWorthSeries sends one request to /reports/net-worth with no query (AC-37, AC-10)" |
| AC-11 | `dashboard-net-worth.test.tsx` "with a single point shows the point value and no line (AC-11)" |
| AC-12 | `dashboard-net-worth.test.tsx` "with no converted point shows no line, the message and the parts in the list (AC-12)"; `dashboard-adapter.test.ts` (AC-10, AC-12) |
| AC-13 | `dashboard-net-worth.test.tsx` "shows a tooltip with the date and value on arrow keys, Home and End (AC-13)", "shows the tooltip for a pointer position and ignores one outside the plot" (hover and tap, untagged by number), "dismisses the tooltip on Escape and keeps the focus" and "hides the tooltip on blur" |
| AC-14 | `dashboard-net-worth.test.tsx` "has a caption and one row per point with the date and the value or the parts (AC-14)" |
| AC-15 | `dashboard-cards.test.tsx` "lists name, amount and whole share as text for each row (AC-15)" |
| AC-16 | `dashboard-cards.test.tsx` "shows the no-spending message and no list for an empty list (AC-16)" |
| AC-17 | `dashboard-cards.test.tsx` "shows over, close and on track in the order received with their words (AC-17, NFR-04)"; `dashboard-adapter.test.ts` "keeps the budget statuses and their order (AC-17)" |
| AC-18 | `dashboard-cards.test.tsx` "shows a link to create a budget when there are none (AC-18)" |
| AC-19 | `dashboard-cards.test.tsx` "lists the entries in order with date, name and own-currency amount (AC-19)" |
| AC-20 | `dashboard-cards.test.tsx` "shows the nothing-due message when empty (AC-20)" |
| AC-21 | `dashboard-attention.test.tsx` "lists the overdue item first, each linking where it is resolved (AC-21)"; `dashboard-adapter.test.ts` "builds links from the real ids of each union member (AC-21)" |
| AC-22 | `dashboard-attention.test.tsx` "renders no title and no list for an empty list (AC-22)" |
| AC-23 | `dashboard-attention.test.tsx` "lists 2 failed movements and 1 group conflict with their links (AC-23)"; `e2e/dashboard.spec.ts` "a failed change waiting on the device is listed under "do these first" (FR-12)" |
| AC-24 | `dashboard-attention.test.tsx` "lists the queue items offline and sends no request (AC-24)"; `dashboard-container.test.tsx` "puts the device-queue items after the server ones in "Do these first" (AC-24)" |
| AC-25 | `dashboard-cards.test.tsx` "shows owed to you and you owe per currency with no difference (AC-25)" |
| AC-26 | `dashboard-attention.test.tsx` "states the share and the change above the average (AC-26)" |
| AC-27 | `dashboard-attention.test.tsx` "keeps the share only for a null change (AC-27)" |
| AC-28 | `dashboard-attention.test.tsx` "renders nothing for a null insight (AC-28)" |
| AC-29 | `dashboard-first-steps.test.tsx` "links to create an account when there is none, with no chart or KPI (AC-29)"; `dashboard-container.test.tsx` "first steps layout (AC-29, AC-30)"; `e2e/dashboard.spec.ts` "a new user sees the first-steps guide and no chart; after creating an account the movement step remains (AC-29, AC-30)" |
| AC-30 | `dashboard-first-steps.test.tsx` "marks the account step done and links to record a movement (AC-30)"; the same container describe and the same e2e test (AC-29, AC-30) |
| AC-31 | `dashboard-net-worth.test.tsx` "shows the count when above 0 (AC-31)" and "shows nothing at 0 (AC-31)" |
| AC-32 | `dashboard-kpi.test.tsx` "shows the count and the reason when shares are left out (AC-32)" and "shows nothing and no error for a count of 0 (AC-32)"; `dashboard-screen-month-notice.test.tsx` "says how many shares or installments are left out of the month" (the screen renders the notice; added after the module verifier found it was never rendered) |
| AC-33 | `dashboard-container.test.tsx` "skeleton and screen share one layout (AC-33)": "renders the same slots, in the same order, with the same classes"; `e2e/design-system.spec.ts` "the home shows its skeleton while the data is still loading (NFR-07)" |
| AC-34 | `dashboard-container.test.tsx` "DashboardContainer chart failure (AC-34)": "keeps every other widget and retries only the series request"; `dashboard-net-worth.test.tsx` "shows the retry in place of the chart and calls it once on a double tap (AC-34)"; `e2e/dashboard.spec.ts` "a failed series shows the chart retry and the other cards stay (AC-34)" |
| AC-35 | `dashboard-container.test.tsx` "DashboardContainer offline (AC-35, AC-36)": "keeps earlier data of the session under the out-of-date notice"; `e2e/dashboard.spec.ts` "offline after a load shows the figures with the out-of-date notice (AC-35)" |
| AC-36 | `dashboard-container.test.tsx` the same describe: "shows the offline message and a retry, no amount, when there is no earlier data"; `api-client-dashboard.test.ts` (AC-03, AC-36) |
| AC-37 | `dashboard-container.test.tsx` "sends exactly the dashboard and net worth requests and nothing else (AC-37, NFR-05)"; `api-client-dashboard.test.ts` "getDashboard sends one request to /dashboard with no query (AC-37)"; `e2e/dashboard.spec.ts` "the home sends exactly one request to each of the two figure paths and none to any other (FR-18, AC-37, NFR-05)" (runs only with `E2E_PRODUCTION_BUILD=1`) |
| AC-38 | `shell-breakpoint.test.tsx` "desk breakpoint token (AC-38, AC-39, AC-40)": "is 64rem in globals.css, in one place" and "shows the side menu from desk and hides the bottom bar from desk"; `e2e/dashboard.spec.ts` "widths 360, 768, 1023, 1024 and 1920 in the ${theme} theme have no horizontal scroll and the right navigation" (untagged by number) |
| AC-39 | the same `shell-breakpoint.test.tsx` describe and the same e2e width test (bottom bar and no side menu at 1023 px) |
| AC-40 | `shell-breakpoint.test.tsx` "is no longer 900 px anywhere in the app sources"; `shell-navigation.test.tsx` "stays beside the content, so it never covers a focused or scrolled-to element (AC-40)"; the same e2e width test |
| AC-41 | `theme-control.test.tsx` "offers light, dark and system in a labeled group (AC-41)" and "marks the current option with a check mark besides the checked state (AC-41)"; `e2e/dashboard.spec.ts` "offers light, dark and system, and marks the chosen one with a check and its state" |
| AC-42 | `theme-control.test.tsx` "checks System with nothing stored and follows the operating system (AC-42)"; `theme-provider.test.tsx` "follows the operating system until a choice is stored" |
| AC-43 | `theme-control.test.tsx` "toggles the dark class when the system changes while System is chosen (AC-43)"; `e2e/dashboard.spec.ts` ""System" follows the operating system without a reload (AC-43)" |
| AC-44 | `theme-control.test.tsx` "stores dark, removes the key for system and survives a remount (AC-44)"; `e2e/dashboard.spec.ts` "dark survives signing out and signing in again (AC-44)" |
| AC-45 | `theme-control.test.tsx` "keeps the choice for the session when localStorage is blocked (AC-45)"; `theme-provider.test.tsx` "keeps the choice in memory when localStorage throws" |
| AC-46 | `theme-control.test.tsx` "treats the stored value %j as no choice (AC-46)" and "is constant, reads the same key and applies dark for a stored dark (AC-46)"; `e2e/dashboard.spec.ts` "the dark class is present before the first paint, with the scripts of the app blocked (AC-46)" |
| AC-47 | `dashboard-catalog.test.ts` "has the same dashboard keys in both languages"; `dashboard-container.test.tsx` "renders every card with the amounts of the response (AC-47, Spanish)" and "renders in English with English amounts (AC-47)"; Spanish rendering tests in `dashboard-kpi.test.tsx`, `dashboard-net-worth.test.tsx` and `dashboard-cards.test.tsx` (AC-47) |
| AC-48 | `dashboard-adapter.test.ts` "names categories in the active language, then the response name, then the generic label (AC-48)"; `dashboard-cards.test.tsx` "falls back to a non-empty label for a row with an empty label (AC-48)" |
| AC-49 | `dashboard-container.test.tsx` "home page content (AC-49)": "offers the add-movement quick action" and "no longer has the removed home components"; "is the error state with no partial section when both requests answer 500 (AC-49)"; `e2e/dashboard.spec.ts` "the home offers the quick actions and no balance summary (AC-49)" |
| AC-50 | `dashboard-net-worth.test.tsx` "prints the total and the points in USD for a USD display currency (AC-50)"; `dashboard-kpi.test.tsx` "prints the three amounts in USD when it is the display currency (AC-50)"; `dashboard-adapter.test.ts` (AC-01, AC-50) |

Every AC from AC-01 to AC-50 has at least one test; none is left without one.

Sad-path tests: both requests answering 500 (error state, no partial section, retry that works), a dashboard body that does not match the shared parser (error state), a 401 (redirect to sign-in with no amount and the remembered answers cleared), the series request failing alone (chart retry, other cards stay), offline with and without earlier data of the session, another user's id never served from memory, a pointer outside the plot, a null total with `no_rate`, a null change and a null insight, an empty category list, no budget, nothing due, an empty series, a series in another currency than the display one, localStorage blocked or throwing, a stored theme value that is not valid, a missing `matchMedia`, a catalog with a missing key or an empty value (parity check), and planted hardcoded strings, `parseFloat`, `toFixed`, `Number(` and colour literals reported by the scan.

Non-functional checks:

- NFR-01: `e2e/dashboard-lcp.spec.ts` (production build, median of 5 runs under the reference CDP profile, below 2.5 s); `dashboard-e2e-support.test.ts` "the lab profile (NFR-01, invalid input)".
- NFR-02: `e2e/dashboard.spec.ts` widths 360, 768, 1023, 1024 and 1920 px in both themes.
- NFR-03: `e2e/dashboard.spec.ts` "the contrast probe (NFR-03)" on six states in both themes; `dashboard-e2e-support.test.ts` contrast math, background flattening and invalid input.
- NFR-04: `dashboard-kpi.test.tsx` "carries a sign or a word in every variant without any stylesheet (NFR-04)"; `dashboard-cards.test.tsx` (AC-17, NFR-04).
- NFR-05: `dashboard-container.test.tsx` (AC-37, NFR-05); `dashboard-scans.test.ts` "keeps the runtime dependencies as they were" and "adds no development dependency either".
- NFR-06: `dashboard-scans.test.ts` (hardcoded strings, money functions, colour literals, catalogs after the cleanup); `dashboard-catalog.test.ts`; `i18n-catalogs.test.ts`; `no-float-money.test.ts`.
- NFR-07: the coverage run above (the web files of the ticket are inside the suite figures).
- NFR-08: component tests (`dashboard-container.test.tsx`, `dashboard-net-worth.test.tsx`, `dashboard-kpi.test.tsx`, `theme-control.test.tsx`, `shell-breakpoint.test.tsx`) and `e2e/dashboard.spec.ts` (44 by 44 px and keyboard reach at each width).

Other checks:

- Security: `docs/ddw/security/sast-DISC-001-09c.md` reports 0 Critical, 0 High, 0 Medium, 1 Low and 4 Info. The Low (the dashboard answers stayed in memory after sign-out) is fixed: `clearDashboardMemory` runs after `wipeLocalData` and on the unauthenticated redirect, with tests.
- `pnpm audit --prod --audit-level high`: no dependency was added or changed.

## Run anomalies

(none in the final run)

## Deviations from the spec, for the record

- The e2e specs answer `GET /dashboard` with a fixture parsed by the real shared schema (`e2e/support/dashboard-fixtures.ts`) instead of real seeds. The spec asked for seeded data; this was done while 09b was not merged. Now that 09b is merged, the switch to real seeds is a TODO. `GET /reports/net-worth` and the accounts and movements seeds are real.
- The contract assumptions of the first design (A1 to A9) disagreed with the 09b spec; they were replaced by the shared schema from `@pesly/shared` once 09b merged (spec decision D1).

## Owner decisions pending

For ratification (PRD 09c Decision Log items 1 to 8):

1. The `desk` breakpoint moves from 900 px to 1024 px (tablets in portrait use the bottom bar).
2. The theme choice is stored on the device only (`localStorage`); a shared device keeps one theme for every account.
3. The theme control has three options (light, dark, system) in place of the two-state switch.
4. The net worth chart is drawn in SVG with the theme tokens; no chart library is added.
5. The home keeps only the "add movement" quick action beside the dashboard.
6. The LCP budget is verified by a lab test (median of 5 runs under the reference throttling), not a field p75.
7. The dashboard makes 2 requests (`GET /dashboard` and `GET /reports/net-worth`) and the device-queue items are added on the device; offline, the data of the session is kept in memory with an out-of-date notice.
8. Category and group names: the response carries a display name for custom categories and budgets (AC-48 falls back to the API name); confirmed by the shared schema of 09b.

Also: the known limitation that the e2e specs stub `GET /dashboard` with a schema-parsed fixture (TODO to use real seeds), the cached view keeps its labels in the language it was fetched in, the wording of the delta chip, and the pre-paint theme script that only runs with a CSP nonce (development builds can flash the light theme).

## Failures

(none)

## Skips

One Playwright test is skipped by design: the request-count test runs only with `E2E_PRODUCTION_BUILD=1`; it passed in the production-build run. The Vitest suite skips nothing.

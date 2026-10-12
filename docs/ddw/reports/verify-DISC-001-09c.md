# Verification DISC-001-09c

| Field | Value |
|---|---|
| Module | `apps/web/src/features/dashboard/**` (view, adapter, formatters, cards, chart, attention items, container, session memory), `apps/web/src/features/shell/**` and `apps/web/src/lib/use-compact-viewport.ts` (breakpoint), `apps/web/src/components/theme-provider.tsx`, `theme-toggle.tsx` and `apps/web/src/lib/theme.ts` (theme), `apps/web/src/features/home/**` (quick actions only), `apps/web/src/lib/api-client.ts`, `apps/web/messages/{es,en}.json`, `apps/web/src/app/globals.css` |
| Line coverage | suite 96.81% |
| Branch coverage | suite 90.05% |
| Function coverage | suite 94.93% |
| Statement coverage | suite 94.94% |
| Coverage floor | 80% lines, branches and functions (AGENTS.md, "Testing") |
| Lint | clean on the files of the ticket (`pnpm lint` and `pnpm typecheck`; SAST in `docs/ddw/security/sast-DISC-001-09c.md` reports no suppression and no `any`) |

Verified against the PRD (`docs/ddw/prd/prd-DISC-001-09c.md`) and the spec (`docs/ddw/specs/spec-DISC-001-09c.md`) by reading the test files under `apps/web/test` and `apps/web/e2e`, and by matching the test names against the test report. Suite figures come from the full run in `docs/ddw/reports/tests-DISC-001-09c.md` (651 test files, 10374 tests, all passing, after merging `main` with 09b). Browser figures: `dashboard.spec.ts` and `design-system.spec.ts` give 45 passed and 1 skipped (the request-count test runs only with `E2E_PRODUCTION_BUILD=1` and passed in a production-build run); `dashboard-lcp.spec.ts` passed (median of 5 under CDP throttling). Test files are in `apps/web/test` unless a path is given; `e2e/` is `apps/web/e2e`.

## Acceptance criteria
- ✅ AC-01 — `dashboard-net-worth.test.tsx` "prints the total in English as 1,420,000.00 ARS (AC-01)"; `dashboard-adapter.test.ts` "turns amount strings into bigint and keeps the currency, ARS and USD (AC-01, AC-50)".
- ✅ AC-02 — `dashboard-container.test.tsx` "shows a skeleton with no amount while the requests are pending (AC-02)".
- ✅ AC-03 — `dashboard-container.test.tsx` describe "DashboardContainer errors (AC-03, AC-49)" (the state with no amount and a retry that re-sends both requests once, and the recovery when the retry succeeds); `api-client-dashboard.test.ts` "keeps the network ... as their own kinds (AC-03, AC-36)"; `e2e/dashboard.spec.ts` "a ... dashboard shows the ... state, and its retry works (AC-03)" (500 response).
- ✅ AC-04 — `dashboard-net-worth.test.tsx` "shows the ARS and USD parts on two separate lines and no converted sum (AC-04)".
- ✅ AC-05 — `dashboard-net-worth.test.tsx` "with a null total and no_rate shows both parts, the message and no total (AC-05)"; `dashboard-adapter.test.ts` "keeps both parts and no total on no_rate, and a null change null (AC-05, AC-09)"; `e2e/dashboard.spec.ts` "with the stored rates removed the net worth card shows both parts and the unavailable message (AC-05)".
- ✅ AC-06 — `dashboard-kpi.test.tsx` "shows October expenses, income and net result in ARS (AC-06)"; `e2e/dashboard.spec.ts` "the home at ${width} px in the ${theme} theme shows its cards with no horizontal scroll (NFR-02, AC-06)".
- ✅ AC-07 — `dashboard-kpi.test.tsx` "prints a negative net result with a minus sign (AC-07)".
- ✅ AC-08 — `dashboard-kpi.test.tsx` "reads +20% Unfavorable for expenses and +20% Favorable for income (AC-08)"; `dashboard-adapter.test.ts` "formatSignedPercent gives +20%, -5% and 0% in es and en (AC-08, AC-47)".
- ✅ AC-09 — `dashboard-kpi.test.tsx` "reads a dash and the no-comparison word for a null change (AC-09)"; `dashboard-adapter.test.ts` the null-change test (AC-05, AC-09).
- ✅ AC-10 — `dashboard-net-worth.test.tsx` "draws 12 dots for 12 converted points (AC-10)"; `dashboard-adapter.test.ts` "maps points to bigint and keeps null totals with their reason (AC-10, AC-12)"; `api-client-dashboard.test.ts` "getNetWorthSeries sends one request to /reports/net-worth with no query (AC-37, AC-10)".
- ✅ AC-11 — `dashboard-net-worth.test.tsx` "with a single point shows the point value and no line (AC-11)".
- ✅ AC-12 — `dashboard-net-worth.test.tsx` "with no converted point shows no line, the message and the parts in the list (AC-12)"; `dashboard-adapter.test.ts` (AC-10, AC-12).
- ✅ AC-13 — `dashboard-net-worth.test.tsx` "shows a tooltip with the date and value on arrow keys, Home and End (AC-13)", "shows the tooltip for a pointer position and ignores one outside the plot" (hover and tap, untagged by number), "dismisses the tooltip on Escape and keeps the focus" and "hides the tooltip on blur".
- ✅ AC-14 — `dashboard-net-worth.test.tsx` "has a caption and one row per point with the date and the value or the parts (AC-14)".
- ✅ AC-15 — `dashboard-cards.test.tsx` "lists name, amount and whole share as text for each row (AC-15)".
- ✅ AC-16 — `dashboard-cards.test.tsx` "shows the no-spending message and no list for an empty list (AC-16)".
- ✅ AC-17 — `dashboard-cards.test.tsx` "shows over, close and on track in the order received with their words (AC-17, NFR-04)"; `dashboard-adapter.test.ts` "keeps the budget statuses and their order (AC-17)".
- ✅ AC-18 — `dashboard-cards.test.tsx` "shows a link to create a budget when there are none (AC-18)".
- ✅ AC-19 — `dashboard-cards.test.tsx` "lists the entries in order with date, name and own-currency amount (AC-19)".
- ✅ AC-20 — `dashboard-cards.test.tsx` "shows the nothing-due message when empty (AC-20)".
- ✅ AC-21 — `dashboard-attention.test.tsx` "lists the overdue item first, each linking where it is resolved (AC-21)"; `dashboard-adapter.test.ts` "builds links from the real ids of each union member (AC-21)".
- ✅ AC-22 — `dashboard-attention.test.tsx` "renders no title and no list for an empty list (AC-22)".
- ✅ AC-23 — `dashboard-attention.test.tsx` "lists 2 ... movements and 1 group conflict with their links (AC-23)"; `e2e/dashboard.spec.ts` the device-queue item listed under "do these first" (FR-12).
- ✅ AC-24 — `dashboard-attention.test.tsx` "lists the queue items offline and sends no request (AC-24)"; `dashboard-container.test.tsx` "puts the device-queue items after the server ones in "Do these first" (AC-24)".
- ✅ AC-25 — `dashboard-cards.test.tsx` "shows owed to you and you owe per currency with no difference (AC-25)".
- ✅ AC-26 — `dashboard-attention.test.tsx` "states the share and the change above the average (AC-26)".
- ✅ AC-27 — `dashboard-attention.test.tsx` "keeps the share only for a null change (AC-27)".
- ✅ AC-28 — `dashboard-attention.test.tsx` "renders nothing for a null insight (AC-28)".
- ✅ AC-29 — `dashboard-first-steps.test.tsx` "links to create an account when there is none, with no chart or KPI (AC-29)"; `dashboard-container.test.tsx` "first steps layout (AC-29, AC-30)"; `e2e/dashboard.spec.ts` "a new user sees the first-steps guide and no chart; after creating an account the movement step remains (AC-29, AC-30)".
- ✅ AC-30 — `dashboard-first-steps.test.tsx` "marks the account step done and links to record a movement (AC-30)"; the same container describe and the same e2e test (AC-29, AC-30).
- ✅ AC-31 — `dashboard-net-worth.test.tsx` "shows the count when above 0 (AC-31)" and "shows nothing at 0 (AC-31)".
- ✅ AC-32 — `dashboard-kpi.test.tsx` "shows the count and the reason when shares are left out (AC-32)" and "shows nothing ... for a count of 0 (AC-32)"; `dashboard-screen-month-notice.test.tsx` "says how many shares or installments are left out of the month" (the screen renders the notice; added after the module verifier found it was never rendered).
- ✅ AC-33 — `dashboard-container.test.tsx` "skeleton and screen share one layout (AC-33)": "renders the same slots, in the same order, with the same classes"; `e2e/design-system.spec.ts` "the home shows its skeleton while the data is still loading (NFR-07)".
- ✅ AC-34 — `dashboard-container.test.tsx` describe "DashboardContainer chart ... (AC-34)": "keeps every other widget and retries only the series request"; `dashboard-net-worth.test.tsx` "shows the retry in place of the chart and calls it once on a double tap (AC-34)"; `e2e/dashboard.spec.ts` the series request aborted, the chart retry and the other cards stay (AC-34).
- ✅ AC-35 — `dashboard-container.test.tsx` "DashboardContainer offline (AC-35, AC-36)": "keeps earlier data of the session under the out-of-date notice"; `e2e/dashboard.spec.ts` "offline after a load shows the figures with the out-of-date notice (AC-35)".
- ✅ AC-36 — `dashboard-container.test.tsx` describe "DashboardContainer offline (AC-35, AC-36)": "shows the offline message and a retry, no amount, when there is no earlier data"; `api-client-dashboard.test.ts` the network case (AC-03, AC-36).
- ✅ AC-37 — `dashboard-container.test.tsx` "sends exactly the dashboard and net worth requests and nothing else (AC-37, NFR-05)"; `api-client-dashboard.test.ts` "getDashboard sends one request to /dashboard with no query (AC-37)"; `e2e/dashboard.spec.ts` "the home sends exactly one request to each of the two figure paths and none to any other (FR-18, AC-37, NFR-05)" (runs only with `E2E_PRODUCTION_BUILD=1`).
- ✅ AC-38 — `shell-breakpoint.test.tsx` "desk breakpoint token (AC-38, AC-39, AC-40)": "is 64rem in globals.css, in one place" and "shows the side menu from desk and hides the bottom bar from desk"; `e2e/dashboard.spec.ts` "widths 360, 768, 1023, 1024 and 1920 in the ${theme} theme have no horizontal scroll and the right navigation" (untagged by number).
- ✅ AC-39 — the same `shell-breakpoint.test.tsx` describe and the same e2e width test (bottom bar and no side menu at 1023 px).
- ✅ AC-40 — `shell-breakpoint.test.tsx` "is no longer 900 px anywhere in the app sources"; `shell-navigation.test.tsx` "stays beside the content, so it never covers a focused or scrolled-to element (AC-40)"; the same e2e width test.
- ✅ AC-41 — `theme-control.test.tsx` "offers light, dark and system in a labeled group (AC-41)" and "marks the current option with a check mark besides the checked state (AC-41)"; `e2e/dashboard.spec.ts` "offers light, dark and system, and marks the chosen one with a check and its state".
- ✅ AC-42 — `theme-control.test.tsx` "checks System with nothing stored and follows the operating system (AC-42)"; `theme-provider.test.tsx` "follows the operating system until a choice is stored".
- ✅ AC-43 — `theme-control.test.tsx` "toggles the dark class when the system changes while System is chosen (AC-43)"; `e2e/dashboard.spec.ts` ""System" follows the operating system without a reload (AC-43)".
- ✅ AC-44 — `theme-control.test.tsx` "stores dark, removes the key for system and survives a remount (AC-44)"; `e2e/dashboard.spec.ts` "dark survives signing out and signing in again (AC-44)".
- ✅ AC-45 — `theme-control.test.tsx` "keeps the choice for the session when localStorage is blocked (AC-45)"; `theme-provider.test.tsx` "keeps the choice in memory when localStorage throws".
- ✅ AC-46 — `theme-control.test.tsx` "treats the stored value %j as no choice (AC-46)" and "is constant, reads the same key and applies dark for a stored dark (AC-46)"; `e2e/dashboard.spec.ts` "the dark class is present before the first paint, with the scripts of the app blocked (AC-46)".
- ✅ AC-47 — `dashboard-catalog.test.ts` "has the same dashboard keys in both languages"; `dashboard-container.test.tsx` "renders every card with the amounts of the response (AC-47, Spanish)" and "renders in English with English amounts (AC-47)"; Spanish rendering tests in `dashboard-kpi.test.tsx`, `dashboard-net-worth.test.tsx` and `dashboard-cards.test.tsx` (AC-47).
- ✅ AC-48 — `dashboard-adapter.test.ts` "names categories in the active language, then the response name, then the generic label (AC-48)"; `dashboard-cards.test.tsx` "falls back to a non-empty label for a row with an empty label (AC-48)".
- ✅ AC-49 — `dashboard-container.test.tsx` describe "home page content (AC-49)": "offers the add-movement quick action" and "no longer has the removed home components"; the test where both requests answer 500 and no partial section shows (AC-49); `e2e/dashboard.spec.ts` "the home offers the quick actions and no balance summary (AC-49)".
- ✅ AC-50 — `dashboard-net-worth.test.tsx` "prints the total and the points in USD for a USD display currency (AC-50)"; `dashboard-kpi.test.tsx` "prints the three amounts in USD when it is the display currency (AC-50)"; `dashboard-adapter.test.ts` (AC-01, AC-50).

## Spec blocks
- ✅ Block 0 — dashboard calls, parser and adapter, formatters and catalogs: `api-client.ts` (`getDashboard`, `getNetWorthSeries`), `features/dashboard/contract/dashboard-adapter.ts`, `format.ts`; `api-client-dashboard.test.ts`, `dashboard-adapter.test.ts`, `dashboard-catalog.test.ts`; the body is parsed by the shared schema and `lib/dashboard-contract.ts` is gone (D1).
- ✅ Block 1 — breakpoint from 900 px to 1024 px and navigation rows: `globals.css`, `use-compact-viewport.ts`, `top-nav.tsx`; `shell-breakpoint.test.tsx`.
- ✅ Block 2 — theme: light, dark or system: `lib/theme.ts`, `theme-provider.tsx`, `theme-toggle.tsx`; `theme-provider.test.tsx`, `theme-control.test.tsx`, `theme.test.ts`.
- ✅ Block 3 — KPI cards, delta chips and the month notice: `dashboard-kpi.test.tsx`, `dashboard-screen-month-notice.test.tsx`.
- ✅ Block 4 — net worth card and area chart: `dashboard-net-worth.test.tsx`, `dashboard-chart-geometry.test.ts`.
- ✅ Block 5 — category, budgets, upcoming and group cards: `dashboard-cards.test.tsx`.
- ✅ Block 6 — "Do these first", device-queue items, insight and first steps: `dashboard-attention.test.tsx`, `dashboard-first-steps.test.tsx`.
- ✅ Block 7 — dashboard container, screen layout and the new home: `dashboard-container.test.tsx`, `home-components.test.tsx`.
- ✅ Block 8 — browser tests, scans, cleanup and final verification: `e2e/dashboard.spec.ts`, `e2e/dashboard-lcp.spec.ts`, `e2e/support/dashboard.ts`, `e2e/support/contrast.ts`, `dashboard-scans.test.ts`, `dashboard-e2e-support.test.ts`; the `home.*` keys are removed from both catalogs.

## Tests
- ✅ Sad-path tests: both requests answering 500, a body that does not match the shared parser, a 401 with the remembered answers cleared, the series request alone broken, offline with and without earlier data, another user's id never served, a null total with `no_rate`, null change and null insight, empty lists, a series in another currency, blocked localStorage, an invalid stored theme value, a missing `matchMedia`, a catalog with a missing key, and planted strings and money functions in the scan.
- ✅ NFR-01 (LCP below 2.5 s, median of 5 under the reference profile): `e2e/dashboard-lcp.spec.ts` passed in the production build.
- ✅ NFR-02 (360 to 1920 px, 0 horizontal scroll, both themes): `e2e/dashboard.spec.ts` at 360, 768, 1023, 1024 and 1920 px; it found a 524 px overflow at 360 px caused by the visually hidden points table, now fixed.
- ✅ NFR-03 (contrast 4.5:1 text, 3:1 graphics, both themes): the contrast probe passes on six states in both themes; it found light-theme success and warning text at 4.32:1 and 4.34:1, now fixed in the tokens.
- ✅ NFR-04 (sign or text besides color): `dashboard-kpi.test.tsx` "carries a sign or a word in every variant without any stylesheet (NFR-04)" and `dashboard-cards.test.tsx` (AC-17, NFR-04).
- ✅ NFR-05 (2 requests, 0 new runtime dependencies): `dashboard-container.test.tsx` and `dashboard-scans.test.ts`; the real-browser count runs with `E2E_PRODUCTION_BUILD=1` and passed.
- ✅ NFR-06 (no hardcoded string, catalog parity, no money through `parseFloat`, `toFixed` or `Number(`): `dashboard-scans.test.ts`, `dashboard-catalog.test.ts`, `i18n-catalogs.test.ts`, `no-float-money.test.ts`.
- ✅ NFR-07 (80% on touched web files, every AC with a test): the suite coverage is above the floor and every AC from AC-01 to AC-50 has at least one test (see above; none is left without one).
- ✅ NFR-08 (keyboard and 44 px targets): component tests and the 44 by 44 px browser check at each width; it found sync banner links under 44 px, now fixed.
- ✅ Independent module verifier: verdict BLOCKED at first with 2 High, both fixed with tests written first: the month notice of AC-32 was never rendered (now rendered by the screen and tested at screen level) and the contract assumptions A1 to A9 disagreed with the 09b spec (replaced by the shared schema from `@pesly/shared` once 09b merged). Medium findings fixed: the chart bridged missing totals (now segments by date), the series currency was ignored (the chart is hidden on a mismatch), the skeleton could hang on IndexedDB (2 s timeout), the answers were not cleared on sign-out (cleared). Low findings fixed: tooltip Escape, slider PageUp and PageDown, the theme provider `matchMedia` guard and `storage` event.
- ✅ Security: `docs/ddw/security/sast-DISC-001-09c.md` reports 0 Critical, 0 High, 0 Medium, 1 Low and 4 Info; the Low (dashboard answers kept in memory after sign-out) is fixed with `clearDashboardMemory` after `wipeLocalData` and on the unauthenticated redirect, with tests.
- ⚠️ Items from the PRD or the spec that await the owner, none blocking:
  - Decision Log 1: the `desk` breakpoint moves from 900 px to 1024 px.
  - Decision Log 2: the theme choice is stored on the device only.
  - Decision Log 3: the theme control has three options (light, dark, system).
  - Decision Log 4: the net worth chart is drawn in SVG with no new dependency.
  - Decision Log 5: the home keeps only the "add movement" quick action beside the dashboard.
  - Decision Log 6: the LCP budget is verified by a lab test, not a field p75.
  - Decision Log 7: two requests, device-queue items added on the device, in-memory data of the session with an out-of-date notice offline.
  - Decision Log 8: category and budget display names in the response (confirmed by the shared schema of 09b).
  - Known limitation: the e2e specs answer `GET /dashboard` with a fixture parsed by the real shared schema; switching to real seeds is a TODO now that 09b is merged. `GET /reports/net-worth` and the accounts and movements seeds are real.
  - Accepted, not fixed: the cached view keeps its labels in the language it was fetched in; the wording of the delta chip; the pre-paint theme script only runs with a CSP nonce, so development builds can flash the light theme.
  - Spec D1, D7, D8, D9 and D11 (shared contract, check mark plus label for AC-41, first-steps layout, fallback links to `/recurring` and `/cards`, contrast probe in place of an accessibility library).
  - AC-38, AC-39 and AC-40 are checked in the browser by an e2e test with no AC tag in its name; they are matched by name above.

Result: PASSED

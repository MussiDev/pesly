# Test run DISC-001-09d

| Field | Value |
|---|---|
| Runner | vitest (V8 coverage via @vitest/coverage-v8), full suite with coverage; Playwright on the production build for the browser specs |
| Command | `pnpm test:coverage` (Vitest over `apps/api/src`, `apps/web/src` and `packages/shared/src` together, V8 coverage, `TEST_DATABASE_URL` pointing at the local PostgreSQL); `pnpm e2e` for `reports.spec.ts` and `reports-lcp.spec.ts` |
| Total | 10633 |
| Passed | 10631 |
| Failed | 0 |
| Skipped | 2 |
| Line coverage | 96.81 |
| Branch coverage | 90.06 |
| Function coverage | 94.9 |
| Statement coverage | 94.95 |
| Coverage floor | 80% lines, branches and functions (AGENTS.md, "Testing") |

## Scope

Full-suite run on the worktree of DISC-001-09d on the final code (before the last commit, which touched only the browser specs): 669 test files, 10631 tests passed and 2 skipped, measured over `apps/api/src`, `apps/web/src` and `packages/shared/src` together, as AGENTS.md requires. The ticket is web only: the reports area with three screens (expenses by category, income against expenses, net worth), the shared pieces (tab bar, filter bar, notices, states, text-alternative list, request hook), the navigation entry, the two dashboard links and the return to a report route after sign-in. No file under `apps/api` or the database migrations is changed and no dependency is added. The reports are read through the contracts of 09a in `@pesly/shared`.

Browser tests (Playwright on the production build): `reports.spec.ts` 34 of 34 passed; `reports-lcp.spec.ts` 3 of 3 passed (median largest contentful paint below 2.5 s for each report over 5 runs). In an earlier Playwright run one test did not pass, the real-data category shares; the cause was a stale constant in the spec after the shares moved to the largest remainder method, and the constant was corrected.

Typecheck: locally only the 3 known `LayoutProps` errors from the Next.js generated types (typegen) appear; they are not in the files of this ticket and CI is clean. Lint is clean on the files of the ticket.

Findings of the independent module verifier, each fixed with a test written first (the assertion that was red is in `docs/ddw/reports/tdd-DISC-001-09d.md`): the shell imported from `features/auth` (the return path moved to `apps/web/src/lib/return-path.ts`); the shell fetched the session on every navigation; the shares could differ from the true share by more than one point (largest remainder method); the rest segment of the ring showed the wrong share; a hardcoded ARS currency note; an invalid range invisible while the filters were collapsed; the account selector showed "All accounts" for an unknown active account and did not reload its options on reconnect; aria wiring and a local rejection of a `to` in the future; the limit text always shown; tab labels aligned with the PRD; a skeleton fallback and a heading on the categories screen; the Spanish voseo; a stronger exact-percent test. One finding is accepted (a transient extra request while the profile time zone resolves; the answer is discarded and no wrong figure is shown) and one was not a defect.

Browser bugs found by the specs and fixed: no horizontal scroll was possible at 200% text (the categories screen overflowed by 143 px); the figure list rows did not wrap and the total could not break. Both are fixed with wrapping rules and a wrapping legend for the donut.

## Requirements to tests

Folder `apps/web/test` unless a path is given; `e2e/` is `apps/web/e2e`. The ids in the test names are the FR, NFR and AC numbers of the PRD (`docs/ddw/prd/prd-DISC-001-09d.md`).

### Functional requirements

| FR | Tests |
|---|---|
| FR-01 | `reports-scans.test.ts` "names FR-01 to FR-23 in at least one test or suite title', () => {"; `e2e/reports.spec.ts` "opening /reports lands on the categories screen with three tabs, and Net worth is marked current (FR-01, AC-01, AC-02)"; `e2e/reports.spec.ts` "a signed-out visit to ${key} goes to sign-in and comes back after signing in (FR-01, FR-23, AC-03)" |
| FR-02 | `e2e/reports.spec.ts` "the side menu at 1280 px lists Reports in the plan ahead block; the More page at 360 px lists it and marks More current (FR-02, AC-04, AC-05)" |
| FR-03 | `e2e/reports.spec.ts` "the dashboard links open the categories and the net worth reports (FR-03, AC-06, AC-07)" |
| FR-04 | `e2e/reports.spec.ts` "the category report shows the real total, the shares and 6 ring segments for 8 categories (FR-04, FR-05, FR-06, AC-08, AC-11, AC-13)"; `e2e/reports.spec.ts` "shares are whole numbers, never over 100%, a null category is the group shares and a tiny one is under 1% (FR-04, FR-05, FR-06, AC-09, AC-12, AC-14)"; `e2e/reports.spec.ts` "the fixture of AC-08 shows 60% and 40% in Spanish with the profile currency note (FR-04, FR-16, AC-08, AC-35, AC-49)"; and 1 more test(s) |
| FR-05 | `e2e/reports.spec.ts` "the category report shows the real total, the shares and 6 ring segments for 8 categories (FR-04, FR-05, FR-06, AC-08, AC-11, AC-13)"; `e2e/reports.spec.ts` "shares are whole numbers, never over 100%, a null category is the group shares and a tiny one is under 1% (FR-04, FR-05, FR-06, AC-09, AC-12, AC-14)" |
| FR-06 | `e2e/reports.spec.ts` "the category report shows the real total, the shares and 6 ring segments for 8 categories (FR-04, FR-05, FR-06, AC-08, AC-11, AC-13)"; `e2e/reports.spec.ts` "shares are whole numbers, never over 100%, a null category is the group shares and a tiny one is under 1% (FR-04, FR-05, FR-06, AC-09, AC-12, AC-14)" |
| FR-07 | `e2e/reports.spec.ts` "income against expenses shows 12 months and the net result signs (FR-07, AC-15, AC-16)"; `e2e/reports.spec.ts` "Spanish labels, months and number format on all three screens (FR-04, FR-07, FR-08, AC-49)" |
| FR-08 | `e2e/reports.spec.ts` "the net worth report lists the real months and ends today (FR-08, FR-09)"; `e2e/reports.spec.ts` "a net worth with a month without a rate leaves a gap, says why, and the arrows move the selection (FR-08, FR-09, FR-10, FR-11, AC-19, AC-20, AC-21, AC-23)"; `e2e/reports.spec.ts` "Spanish labels, months and number format on all three screens (FR-04, FR-07, FR-08, AC-49)" |
| FR-09 | `e2e/reports.spec.ts` "the net worth report lists the real months and ends today (FR-08, FR-09)"; `e2e/reports.spec.ts` "a net worth with a month without a rate leaves a gap, says why, and the arrows move the selection (FR-08, FR-09, FR-10, FR-11, AC-19, AC-20, AC-21, AC-23)" |
| FR-10 | `e2e/reports.spec.ts` "a net worth with a month without a rate leaves a gap, says why, and the arrows move the selection (FR-08, FR-09, FR-10, FR-11, AC-19, AC-20, AC-21, AC-23)"; `e2e/reports.spec.ts` "a net worth where no month converts shows the components and the notice instead of a chart (FR-10, AC-22)" |
| FR-11 | `e2e/reports.spec.ts` "a net worth with a month without a rate leaves a gap, says why, and the arrows move the selection (FR-08, FR-09, FR-10, FR-11, AC-19, AC-20, AC-21, AC-23)" |
| FR-12 | `e2e/reports.spec.ts` "each screen offers its own controls and the presets request the right range (FR-12, FR-13, AC-24, AC-25, AC-26, AC-28, AC-29)"; `e2e/reports.spec.ts` "at 360 px the filters collapse behind one control with the count, and at 1024 px they are open (FR-12, AC-50)" |
| FR-13 | `e2e/reports.spec.ts` "each screen offers its own controls and the presets request the right range (FR-12, FR-13, AC-24, AC-25, AC-26, AC-28, AC-29)" |
| FR-14 | `e2e/reports.spec.ts` "the address ?tag=vacations2026&from=2026-01-01 applies both and from=31-12-2026 is ignored (FR-14, AC-30, AC-31)" |
| FR-15 | `reports-shared-components.test.tsx` "shows the limit of the range next to the date fields at all times (FR-15)', () => {"; `e2e/reports.spec.ts` "a from after the to sends no request and 13 months on income against expenses states the limit (FR-15, AC-32, AC-33)"; `e2e/reports.spec.ts` "a 400 on to, a 404 on a filter and a lost session each show their own state (FR-15, FR-23, AC-27, AC-34, AC-48)" |
| FR-16 | `e2e/reports.spec.ts` "the fixture of AC-08 shows 60% and 40% in Spanish with the profile currency note (FR-04, FR-16, AC-08, AC-35, AC-49)"; `e2e/reports.spec.ts` "a USD answer is formatted as USD and never mixed with ARS (FR-16, AC-36)" |
| FR-17 | `e2e/reports.spec.ts` "unconverted counts and the filtered notice appear only when they apply (FR-17, FR-18, AC-37, AC-38, AC-39)" |
| FR-18 | `e2e/reports.spec.ts` "unconverted counts and the filtered notice appear only when they apply (FR-17, FR-18, AC-37, AC-38, AC-39)" |
| FR-19 | `e2e/reports.spec.ts` "a range with nothing shows the empty state that names it and offers to widen it (FR-19, AC-10, AC-17, AC-41)"; `e2e/reports.spec.ts` "loading shows a skeleton with the controls operable, then the figures; a server error has a retry that stays disabled while it runs (FR-19, AC-40, AC-42)" |
| FR-20 | `e2e/reports.spec.ts` "offline shows the connection message and no figures; back online, retry shows the report; nothing is stored (FR-20, AC-43, AC-44, NFR-07)" |
| FR-21 | `e2e/reports.spec.ts` "every chart has a named figure with a summary, a hidden drawing and a list with the same figures (FR-21, AC-45, AC-46)" |
| FR-22 | `reports-use-report.test.tsx` "retry is single-flight and flags retrying while in flight (FR-22)"; `e2e/reports.spec.ts` "two account changes within a second show the answer of the second request only (FR-22, AC-47)" |
| FR-23 | `reports-scans.test.ts` "names FR-01 to FR-23 in at least one test or suite title', () => {"; `e2e/reports.spec.ts` "a signed-out visit to ${key} goes to sign-in and comes back after signing in (FR-01, FR-23, AC-03)"; `e2e/reports.spec.ts` "a return address that is not a report route is ignored after signing in (FR-23, D2)"; and 1 more test(s) |

The test `reports-scans.test.ts` "names FR-01 to FR-23 in at least one test or suite title" keeps this mapping from drifting.

### Acceptance criteria

| AC | Tests |
|---|---|
| AC-01 | `reports-catalog.test.ts` "names the tabs as the PRD does (AC-01)', () => {"; `reports-layout.test.tsx` "the index page redirects /reports to /reports/categories (AC-01)"; `reports-shared-components.test.tsx` "shows three names and marks the current one (AC-01, AC-02)', () => {"; and 1 more test(s) |
| AC-02 | `reports-shared-components.test.tsx` "shows three names and marks the current one (AC-01, AC-02)', () => {"; `e2e/reports.spec.ts` "opening /reports lands on the categories screen with three tabs, and Net worth is marked current (FR-01, AC-01, AC-02)" |
| AC-03 | `e2e/reports.spec.ts` "a signed-out visit to ${key} goes to sign-in and comes back after signing in (FR-01, FR-23, AC-03)" |
| AC-04 | `reports-navigation.test.tsx` "the side menu lists Reports in the plan ahead block, below the 1024 px bottom bar (AC-04)', () => {"; `e2e/reports.spec.ts` "the side menu at 1280 px lists Reports in the plan ahead block; the More page at 360 px lists it and marks More current (FR-02, AC-04, AC-05)" |
| AC-05 | `reports-navigation.test.tsx` "the More page lists Reports (AC-05)', () => {"; `reports-navigation.test.tsx` "More is current on %s (AC-05)', (path) => {"; `e2e/reports.spec.ts` "the side menu at 1280 px lists Reports in the plan ahead block; the More page at 360 px lists it and marks More current (FR-02, AC-04, AC-05)" |
| AC-06 | `e2e/reports.spec.ts` "the dashboard links open the categories and the net worth reports (FR-03, AC-06, AC-07)" |
| AC-07 | `e2e/reports.spec.ts` "the dashboard links open the categories and the net worth reports (FR-03, AC-06, AC-07)" |
| AC-08 | `reports-adapters.test.ts` "toCategoriesView sorts from the largest, names the rows and computes the shares (AC-08, AC-13)', () => {"; `reports-categories.test.tsx` "shows the total with Food 60% first and Transport 40% second (AC-08)"; `reports-shares.test.ts` "120,000.00 and 80,000.00 of 200,000.00 give 60% and 40% (AC-08)', () => {"; and 2 more test(s) |
| AC-09 | `reports-categories.test.tsx` "thirds show whole shares that add up to at most 100% (AC-09)"; `reports-categories.test.tsx` "33.34, 33.33 and 33.33 of 100.00 show exactly 34%, 33% and 33% (AC-09)"; `reports-shares.test.ts` "thirds 33.34, 33.33 and 33.33 of 100.00 give 34, 33, 33 by integer arithmetic (AC-09)', () => {"; and 1 more test(s) |
| AC-10 | `reports-categories.test.tsx` "a total of 0.00 shows the empty state and no percentage (AC-10)"; `reports-shares.test.ts` "error: a total of 0.00 or a negative total gives no shares and never divides (AC-10)', () => {"; `e2e/reports.spec.ts` "a range with nothing shows the empty state that names it and offers to widen it (FR-19, AC-10, AC-17, AC-41)" |
| AC-11 | `reports-categories.test.tsx` "8 categories draw 6 ring segments and list 8 rows (AC-11)"; `reports-ring.test.ts` "8 rows give the 5 largest plus one rest segment, 6 in all (AC-11)', () => {"; `e2e/reports.spec.ts` "the category report shows the real total, the shares and 6 ring segments for 8 categories (FR-04, FR-05, FR-06, AC-08, AC-11, AC-13)" |
| AC-12 | `reports-categories.test.tsx` "a share under 1% lists "<1%" with its amount (AC-12)"; `reports-shares.test.ts` "flags a row of 0.4% as under one and keeps its amount (AC-12)', () => {"; `e2e/reports.spec.ts` "shares are whole numbers, never over 100%, a null category is the group shares and a tiny one is under 1% (FR-04, FR-05, FR-06, AC-09, AC-12, AC-14)" |
| AC-13 | `reports-adapters.test.ts` "toCategoriesView sorts from the largest, names the rows and computes the shares (AC-08, AC-13)', () => {"; `reports-categories.test.tsx` "names default keys in English and Spanish and the null id as group shares (AC-13, AC-14)"; `reports-category-names.test.ts` "a default key is the English name in English (AC-13)', () => {"; and 2 more test(s) |
| AC-14 | `reports-categories.test.tsx` "names default keys in English and Spanish and the null id as group shares (AC-13, AC-14)"; `reports-category-names.test.ts` "a null category id with no name gives the group-shares label (AC-14)', () => {"; `e2e/reports.spec.ts` "shares are whole numbers, never over 100%, a null category is the group shares and a tiny one is under 1% (FR-04, FR-05, FR-06, AC-09, AC-12, AC-14)" |
| AC-15 | `reports-income-expenses.test.tsx` "draws 12 income bars and 12 expense bars with month names in the language (AC-15)"; `e2e/reports.spec.ts` "income against expenses shows 12 months and the net result signs (FR-07, AC-15, AC-16)" |
| AC-16 | `reports-adapters.test.ts` "toIncomeExpensesView computes the net result in bigint (AC-16)', () => {"; `reports-income-expenses.test.tsx` "shows +560,000.00 for 800,000.00 income against 240,000.00 expenses (AC-16)"; `reports-income-expenses.test.tsx` "shows a minus sign when expenses are above income (AC-16)"; and 1 more test(s) |
| AC-17 | `reports-income-expenses.test.tsx` "shows the empty state and no bars when every month is at 0 (AC-17)"; `e2e/reports.spec.ts` "a range with nothing shows the empty state that names it and offers to widen it (FR-19, AC-10, AC-17, AC-41)" |
| AC-18 | `reports-net-worth.test.tsx` "shows a tooltip with the date and the converted total on pointer and tap (AC-18)', () => {" |
| AC-19 | `reports-net-worth.test.tsx` "moves the selection with the arrows and announces date and value (AC-19)', () => {"; `e2e/reports.spec.ts` "a net worth with a month without a rate leaves a gap, says why, and the arrows move the selection (FR-08, FR-09, FR-10, FR-11, AC-19, AC-20, AC-21, AC-23)" |
| AC-20 | `reports-net-worth.test.tsx` "shows ARS and USD in their own currency next to the total (AC-20)', () => {"; `e2e/reports.spec.ts` "a net worth with a month without a rate leaves a gap, says why, and the arrows move the selection (FR-08, FR-09, FR-10, FR-11, AC-19, AC-20, AC-21, AC-23)" |
| AC-21 | `reports-adapters.test.ts` "toNetWorthView keeps a missing total as null with its reason (AC-21)', () => {"; `reports-net-worth.test.tsx` "leaves a gap for a null total and says no exchange rate exists (AC-21)', () => {"; `e2e/reports.spec.ts` "a net worth with a month without a rate leaves a gap, says why, and the arrows move the selection (FR-08, FR-09, FR-10, FR-11, AC-19, AC-20, AC-21, AC-23)" |
| AC-22 | `reports-net-worth.test.tsx` "with no total at all lists ARS and USD per month and no chart (AC-22)', () => {"; `e2e/reports.spec.ts` "a net worth where no month converts shows the components and the notice instead of a chart (FR-10, AC-22)" |
| AC-23 | `reports-net-worth.test.tsx` "flags a point with incomplete investments (AC-23)', () => {"; `e2e/reports.spec.ts` "a net worth with a month without a rate leaves a gap, says why, and the arrows move the selection (FR-08, FR-09, FR-10, FR-11, AC-19, AC-20, AC-21, AC-23)" |
| AC-24 | `reports-income-expenses.test.tsx` "offers the account selector and the tag input (AC-24)"; `reports-shared-components.test.tsx` "a flow report shows range, account and tag controls (AC-24)', () => {"; `e2e/reports.spec.ts` "each screen offers its own controls and the presets request the right range (FR-12, FR-13, AC-24, AC-25, AC-26, AC-28, AC-29)" |
| AC-25 | `reports-net-worth.test.tsx` "offers the date range only, no account or tag control (AC-25)', () => {"; `reports-shared-components.test.tsx` "net worth shows the range only and offers last 24 months (AC-25)', () => {"; `e2e/reports.spec.ts` "each screen offers its own controls and the presets request the right range (FR-12, FR-13, AC-24, AC-25, AC-26, AC-28, AC-29)" |
| AC-26 | `reports-categories.test.tsx` "filtering by the tag vacations2026 requests the report with that tag (AC-26)"; `api-client-reports.test.ts` "the category call sends tag=vacations2026 and parses the answer (AC-26)"; `e2e/reports.spec.ts` "each screen offers its own controls and the presets request the right range (FR-12, FR-13, AC-24, AC-25, AC-26, AC-28, AC-29)" |
| AC-27 | `reports-categories.test.tsx` "a 404 for an account filter shows the filter-gone alert and clears the filters on reload (AC-27)"; `reports-income-expenses.test.tsx` "shows the filter-gone alert on a 404 and clears the filters on reload (AC-27)"; `reports-shared-components.test.tsx` "the filter-gone alert asks to clear the entity filters (AC-27)"; and 2 more test(s) |
| AC-28 | `reports-categories.test.tsx` "first open sends no from and no to; a preset sends explicit dates (AC-28)"; `reports-range.test.ts` "last 3 months from 2026-10-12 starts 2026-08-01 and ends today (AC-28)', () => {"; `reports-shared-components.test.tsx` "a preset calls onChange once with its dates (AC-28)"; and 1 more test(s) |
| AC-29 | `reports-income-expenses.test.tsx` "offers no last-24 preset (AC-29)"; `reports-range.test.ts` "income against expenses offers no last-24 preset; the other two do (AC-29)', () => {"; `reports-shared-components.test.tsx` "income against expenses has no last-24 preset (AC-29)', () => {"; and 1 more test(s) |
| AC-30 | `reports-filters-state.test.ts` "?tag=vacations2026&from=2026-01-01 applies both (AC-30)', () => {"; `e2e/reports.spec.ts` "the address ?tag=vacations2026&from=2026-01-01 applies both and from=31-12-2026 is ignored (FR-14, AC-30, AC-31)" |
| AC-31 | `reports-filters-state.test.ts` "from=31-12-2026 is ignored and the other filters stay (AC-31)', () => {"; `e2e/reports.spec.ts` "the address ?tag=vacations2026&from=2026-01-01 applies both and from=31-12-2026 is ignored (FR-14, AC-30, AC-31)" |
| AC-32 | `reports-range.test.ts` "from after to gives from_after_to (AC-32)', () => {"; `reports-shared-components.test.tsx` "a from after to marks both fields invalid, shows the message and sends nothing (AC-32)', () => {"; `reports-use-report.test.tsx` "a range that fails the local check sends no request and gives badRange (AC-32, AC-33)', () => {"; and 1 more test(s) |
| AC-33 | `reports-income-expenses.test.tsx` "refuses 13 months with the 12-month limit and sends no request (AC-33)"; `reports-range.test.ts` "13 months on income against expenses gives too_long with 12 (AC-33)', () => {"; `reports-shared-components.test.tsx` "13 months on income against expenses states the limit of 12 and sends nothing (AC-33)', () => {"; and 2 more test(s) |
| AC-34 | `reports-shared-components.test.tsx` "the range alert shows the catalog message (AC-34)', () => {"; `reports-use-report.test.tsx` "a 400 naming query.to gives badRange with the field and no figures (AC-34)"; `e2e/reports.spec.ts` "a 400 on to, a 404 on a filter and a lost session each show their own state (FR-15, FR-23, AC-27, AC-34, AC-48)" |
| AC-35 | `reports-shared-components.test.tsx` "shows the code, the sentence and the profile settings link (AC-35)', () => {"; `e2e/reports.spec.ts` "the fixture of AC-08 shows 60% and 40% in Spanish with the profile currency note (FR-04, FR-16, AC-08, AC-35, AC-49)" |
| AC-36 | `reports-shared-components.test.tsx` "a USD figure formats as USD without mixing currencies (AC-36)', () => {"; `e2e/reports.spec.ts` "a USD answer is formatted as USD and never mixed with ARS (FR-16, AC-36)" |
| AC-37 | `reports-income-expenses.test.tsx` "shows the unconverted notice for 2 shares and 1 installment (AC-37)"; `reports-income-expenses.test.tsx` "shows no unconverted notice for 0 and 0 (AC-37)"; `reports-shared-components.test.tsx` "shows both counts for 2 and 1 (AC-37)', () => {"; and 2 more test(s) |
| AC-38 | `reports-income-expenses.test.tsx` "sends the tag filter and shows the filtered notice only with a filter (AC-38, AC-39)"; `reports-shared-components.test.tsx` "shows the filtered notice only with a filter (AC-38, AC-39)', () => {"; `e2e/reports.spec.ts` "unconverted counts and the filtered notice appear only when they apply (FR-17, FR-18, AC-37, AC-38, AC-39)" |
| AC-39 | `reports-income-expenses.test.tsx` "sends the tag filter and shows the filtered notice only with a filter (AC-38, AC-39)"; `reports-income-expenses.test.tsx` "does not show the filtered notice without a filter (AC-39)"; `reports-shared-components.test.tsx` "shows the filtered notice only with a filter (AC-38, AC-39)', () => {"; and 1 more test(s) |
| AC-40 | `reports-shared-components.test.tsx` "the skeleton announces loading and leaves the controls operable (AC-40)"; `e2e/reports.spec.ts` "loading shows a skeleton with the controls operable, then the figures; a server error has a retry that stays disabled while it runs (FR-19, AC-40, AC-42)" |
| AC-41 | `reports-shared-components.test.tsx` "the empty state names the range and offers both actions (AC-41)"; `e2e/reports.spec.ts` "a range with nothing shows the empty state that names it and offers to widen it (FR-19, AC-10, AC-17, AC-41)" |
| AC-42 | `reports-income-expenses.test.tsx` "shows the error state with retry and no figures when the request fails (AC-42)"; `reports-shared-components.test.tsx` "the error state has a retry button, disabled with the retrying label while in flight (AC-42)"; `reports-use-report.test.tsx` "sends exactly one request per filter change (AC-42)"; and 1 more test(s) |
| AC-43 | `reports-income-expenses.test.tsx` "shows the offline message and no figures when offline (AC-43)"; `reports-use-report.test.tsx` "offline sends no request, shows offline, and retry works once back online (AC-43, AC-44)"; `e2e/reports.spec.ts` "offline shows the connection message and no figures; back online, retry shows the report; nothing is stored (FR-20, AC-43, AC-44, NFR-07)" |
| AC-44 | `reports-use-report.test.tsx` "offline sends no request, shows offline, and retry works once back online (AC-43, AC-44)"; `e2e/reports.spec.ts` "offline shows the connection message and no figures; back online, retry shows the report; nothing is stored (FR-20, AC-43, AC-44, NFR-07)" |
| AC-45 | `reports-categories.test.tsx` "the list has one row per category and the chart exposes a name and summary (AC-45, AC-46)"; `reports-income-expenses.test.tsx` "carries the same figures in the list and in the chart summary (AC-45, AC-46)"; `reports-net-worth.test.tsx` "repeats every point in a text list and hides the drawing (AC-45, AC-46)', () => {"; and 2 more test(s) |
| AC-46 | `reports-categories.test.tsx` "the list has one row per category and the chart exposes a name and summary (AC-45, AC-46)"; `reports-income-expenses.test.tsx` "carries the same figures in the list and in the chart summary (AC-45, AC-46)"; `reports-net-worth.test.tsx` "repeats every point in a text list and hides the drawing (AC-45, AC-46)', () => {"; and 2 more test(s) |
| AC-47 | `reports-use-report.test.tsx` "shows only the second answer when the first answers later (AC-47)"; `e2e/reports.spec.ts` "two account changes within a second show the answer of the second request only (FR-22, AC-47)" |
| AC-48 | `reports-net-worth.test.tsx` "a 401 sends the user to sign-in and shows no figures (AC-48)"; `reports-use-report.test.tsx` "a 401 drops the data and sends the user to sign-in with the report path (AC-48)"; `e2e/reports.spec.ts` "a 400 on to, a 404 on a filter and a lost session each show their own state (FR-15, FR-23, AC-27, AC-34, AC-48)" |
| AC-49 | `reports-categories.test.tsx` "with Spanish selected labels, notices and amounts are Spanish (AC-49)"; `reports-income-expenses.test.tsx` "renders the language in Spanish: labels, notice and amount format (AC-49)"; `e2e/reports.spec.ts` "the fixture of AC-08 shows 60% and 40% in Spanish with the profile currency note (FR-04, FR-16, AC-08, AC-35, AC-49)"; and 1 more test(s) |
| AC-50 | `reports-shared-components.test.tsx` "under 1024 px the filters sit behind one control naming the active count (AC-50)"; `reports-shared-components.test.tsx` "from 1024 px the filters are open and there is no toggle (AC-50)', () => {"; `e2e/reports.spec.ts` "at 360 px the filters collapse behind one control with the count, and at 1024 px they are open (FR-12, AC-50)" |

Every AC from AC-01 to AC-50 has at least one test; none is left without one.

### Non-functional requirements

| NFR | Tests |
|---|---|
| NFR-01 | `e2e/reports-lcp.spec.ts` "the median largest contentful paint of the ${key} report over 5 runs is below 2.5 s (NFR-01)" |
| NFR-02 | `e2e/reports.spec.ts` "one filter change sends exactly one report request (NFR-02)" |
| NFR-03 | `e2e/reports.spec.ts` "widths 360, 768, 1024, 1280 and 1920 in the ${theme} theme: no horizontal scroll at 200% text (NFR-03)" |
| NFR-04 | `reports-scans.test.ts` "has no hardcoded visible string and no colour literal (NFR-06, NFR-04)', () => {" |
| NFR-05 | `e2e/reports.spec.ts` "widths and themes (NFR-03, NFR-04, NFR-05)" |
| NFR-06 | `reports-scans.test.ts` "applies no parseFloat, toFixed or Number( on money (NFR-06)', () => {"; `reports-scans.test.ts` "has no hardcoded visible string and no colour literal (NFR-06, NFR-04)', () => {" |
| NFR-07 | `reports-scans.test.ts` "has no storage, cache or service worker call (NFR-07)', () => {"; `reports-scans.test.ts` "has no raw HTML insertion and no logging (NFR-07)', () => {"; `reports-scans.test.ts` "adds no rule for the reports calls to the service worker (NFR-07)', () => {"; and 1 more test(s) |
| NFR-08 | `reports-income-expenses.test.tsx` "thins the month labels at 24 months without drawing them all (NFR-08)" |
| NFR-09 | `reports-scans.test.ts` "every functional requirement is named by a test (NFR-09)" |

NFR-01 is the lab test of the largest contentful paint on the production build. NFR-05 (keyboard reach and 44 px targets) is checked by the browser width test. NFR-09 is this run: coverage is above the floor and every requirement is named by a test.

Sad-path tests: a 401 sends the user to sign-in with no figure, a 404 on an account or tag filter shows the filter-gone alert, a 400 naming `to` shows the range alert with no figure, a server answer of 500 shows the retry (single flight), offline sends no request and works again after reconnecting, a stale answer is discarded, a `from` after `to` and 13 months on income against expenses send nothing, an invalid address value is ignored, a total of 0.00 or a negative total gives no share and no division, a return address that is not a report route is ignored, and a null total with no rate leaves a gap.

Other checks:

- Security: `docs/ddw/security/sast-DISC-001-09d.md` reports 0 Critical, 0 High, 0 Medium, 0 Low and 4 Info.
- `pnpm audit --prod --audit-level high`: no dependency was added or changed.

## Run anomalies

(none in the final run)

## Deviations from the spec, for the record

- The return path after sign-in lives in `apps/web/src/lib/return-path.ts`, not in a file of `features/auth` as the spec file list had it, so that the shell does not import from a feature.
- The shares use the largest remainder method instead of the rule of PRD Decision 3, so they add up to 100% and never differ from the true share by more than one point; the PRD Decision Log notes it.

## Owner decisions pending

The deviation on the shares (largest remainder method, PRD Decision Log) awaits ratification. The transient extra request while the profile time zone resolves is accepted and not fixed.

## Failures

(none)

## Skips

The Vitest suite skips 2 tests, none of them in the files of this ticket; they are the only conditional skip guards in the suite:

- `apps/api/test/investments/no-float-money.test.ts` uses `it.skipIf(!apiExists)`; the reason is that the guard skips the scan when the folder it scans is absent in the run.
- `apps/web/test/group-category-views-scans.test.ts` uses `describe.skipIf(base === undefined)`; the reason is that the guard skips the comparison against main when no base reference is available in the run.

The browser specs of the ticket skip nothing in the production-build run.

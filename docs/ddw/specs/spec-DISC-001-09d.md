# Spec DISC-001-09d: Reports Screens

| Field | Value |
|-------|-------|
| Ticket | DISC-001-09d |
| PRD | docs/ddw/prd/prd-DISC-001-09d.md |
| Tier | FEATURE |
| Date | 2026-10-12 |
| Spec loops | 0 |
| Loops since last human decision | 0 |

## Summary
Web only, on the three reports of 09a (contracts in `packages/shared/src/reports/report.ts` and
`packages/shared/src/reports/report-range.ts`): no API route, migration or runtime dependency is added and
no contract is declared here. Block 1 owns every shared file that more than one block would otherwise edit:
the pure helpers (integer shares, ring segments, category names, range presets and checks, filters held in
the page address, the return path after sign-in), the three api-client calls and every Spanish and English
catalog key of the new `reports` namespace. Block 2 builds the shared presentational pieces and the one
request hook the three screens use (tab bar and layout, filter bar, notices, loading, empty, error and
offline states, text-alternative list). Blocks 3, 4 and 5 are the three screens, each with its own chart,
container and route page, and own disjoint folders. Block 6 adds the navigation entry, the two dashboard
links and the return to a report route after sign-in. Block 7 holds the scans and Block 8 the browser tests.
Money stays in minor units: amounts are parsed as `bigint`, formatted with `formatMoney` from
`apps/web/src/lib/format-amount.ts` and never summed across currencies; the only derived figure, a share, is
a bigint division. Charts are plain SVG with the `--chart-*` tokens and the pure geometry already in
`apps/web/src/features/dashboard/chart/chart-geometry.ts` (imported, not edited).

## Decisions
- **D1 Routes (PRD decision 1).** `/reports` redirects to `/reports/categories`; the other two routes are
  `/reports/income-expenses` and `/reports/net-worth`. One layout with a tab bar of three links wraps them;
  the current tab carries `aria-current="page"`.
- **D2 Return after sign-in (AC-03).** Nothing in the web app brings the user back to the page they asked
  for. This spec adds the smallest safe version: the shell and the report request hook send an expired
  session to `/sign-in?next=<path>`, where the path is accepted only when it is exactly one of the four
  report routes (an allow-list in `apps/web/src/features/auth/return-path.ts`); any other value is ignored
  and the user lands on `/` as today. Only the pathname travels, never the filters. The Google sign-in
  start is not changed (flag for the owner: a user who signs in with Google lands on `/`).
- **D3 One request per change, stale answers dropped (FR-22, NFR-02).** The request hook sends one request per
  distinct filter key and per retry, and discards the answer of any request whose key was replaced
  (sequence counter). NFR-02's "at most one in flight" is read as: a retry is single-flight (its button is
  disabled while it runs) and no polling or repeat exists; a superseded request still finishes on the wire
  but its answer is never shown, which is what AC-47 requires.
- **D4 Today and time zone.** The presets need today in the profile's time zone: the hook reads the profile
  once through the existing `getProfile` call (`preferences.timeZone`) and computes today with
  `todayInTimeZone` from `packages/shared/src/time/zoned-time.ts`. With no `from` and no `to` in the address
  nothing is computed and the API defaults apply (PRD decision 5); the screen shows the range the answer
  resolved. Month arithmetic uses `addMonths` and `monthsBetween` from `report-range.ts`.
- **D5 Shares.** Basis points are not shown; the whole percent of a row is `amount * 100 / total` as a bigint
  division rounded down. The leftover (100 minus the sum of the rounded-down shares) goes to the largest
  category, so shown shares never exceed 100% (AC-09). A row whose rounded-down share is 0 and whose amount
  is positive shows the catalog text for "under 1%"; a row with an amount of 0 or less shows 0%. A total of 0
  or less is the empty state (AC-10).
- **D6 No stored copies (PRD decision 6).** Report answers live in React state of the container only. The
  hook drops the previous answer the moment a new key is requested, on failure, offline and 401, so no
  earlier figure is ever shown. The dashboard's session memory is not touched or reused.
- **D7 Account options (PRD decision 8).** The account selector loads active accounts and archived accounts
  with two calls of `listAccounts`, reading every page the way `movements-container.tsx` does; archived ones
  are labeled with the catalog text. The tag control reuses `TagInputContainer` through the filter bar's
  render slot, as the movements filters do.
- **D8 Ownership of shared files.** `apps/web/messages/en.json` and `apps/web/messages/es.json` are owned by
  Block 1 only, with every key the other blocks use already present (key groups are listed in Block 1). A
  block that finds a missing key stops and asks Block 1's owner to add it, so the catalogs never conflict.
  `apps/web/src/lib/api-client.ts` is owned by Block 1 only. `apps/web/src/features/shell/nav-items.ts`,
  `apps/web/src/features/shell/containers/authenticated-shell-container.tsx`, the two dashboard cards and the
  two sign-in containers are owned by Block 6 only.
- **D9 Chart text.** Chart labels are SVG `<text>` nodes rendered by React as text; no `dangerouslySetInnerHTML`
  and no string is concatenated into markup. Every chart is hidden from assistive technology
  (`aria-hidden`) except its named container, which exposes the summary, and is followed by a native list
  with the same figures (FR-21).

## Coverage: PRD → blocks
| Requirement | Covered by |
|---|---|
| FR-01 | Block 2 (layout and tab bar), Blocks 3, 4 and 5 (the three route pages), Block 1 (return path used by AC-03) |
| FR-02 | Block 6 |
| FR-03 | Block 6 |
| FR-04 | Block 1 (share math), Block 3 (list and total) |
| FR-05 | Block 1 (ring segments), Block 3 (ring chart) |
| FR-06 | Block 1 (category names), Block 3 (rows) |
| FR-07 | Block 4 |
| FR-08 | Block 5 |
| FR-09 | Block 5 |
| FR-10 | Block 5 |
| FR-11 | Block 5 |
| FR-12 | Block 1 (query building), Block 2 (filter bar), Blocks 3, 4 and 5 (which controls each screen offers) |
| FR-13 | Block 1 (presets), Block 2 (preset control) |
| FR-14 | Block 1 (filters held in the address), Block 2 (address sync hook) |
| FR-15 | Block 1 (range checks), Block 2 (date fields and messages) |
| FR-16 | Block 2 (currency note), Blocks 3, 4 and 5 (placed next to the figures) |
| FR-17 | Block 2 (notice), Blocks 3 and 4 (placed; the net worth response has no counts) |
| FR-18 | Block 2 (notice), Blocks 3 and 4 (placed) |
| FR-19 | Block 2 (skeleton, empty and error states), Blocks 3, 4 and 5 (screen-specific skeleton layout) |
| FR-20 | Block 2 (request hook and offline state) |
| FR-21 | Block 2 (text-alternative list), Blocks 3, 4 and 5 (rows and chart summary) |
| FR-22 | Block 2 (request hook) |
| FR-23 | Block 2 (request hook), Block 1 (return path) |
| NFR-01 | Strategy: one request per screen, a skeleton with the final layout from the first render and charts drawn from the answer with no extra request; measured by the lab test of Block 8 |
| NFR-02 | Block 2 (hook call-count tests), Block 8 (request counts in the browser) |
| NFR-03 | Strategy: single column with `min-w-0` and wrapped text, chart widths from the container; measured by the 5-width, 2-theme test of Block 8 |
| NFR-04 | Strategy: theme tokens only and text or sign on every mark; measured by the contrast probe in Block 8 |
| NFR-05 | Blocks 2 to 5 (component tests on keyboard order and 44 px classes), Block 8 (measured targets in the browser) |
| NFR-06 | Block 1 (catalog parity test and formatters), Block 7 (no literal strings scan) |
| NFR-07 | Block 7 (dependency list unchanged, no storage or cache call in the new files) |
| NFR-08 | Blocks 3, 4 and 5 (ring limited to 6 segments, label thinning in the bar and area charts) |
| NFR-09 | Strategy: every block ships its own Vitest tests; Block 7 runs the coverage floor; Block 8 names every FR in a test title |

Acceptance criteria are named by the tests of the blocks (AC-01 to AC-50).

## Dependencies between blocks
Block 1 is first and alone: it holds the shared helpers, the api-client calls and the catalogs every other
block reads. After it, Blocks 2 and 6 run in parallel (Block 6 needs only catalog keys and the return-path
helper of Block 1; Block 2 needs the helpers). Blocks 3, 4 and 5 need Block 2 and own disjoint folders, so
they run in parallel once Block 2 is merged into the worktree. Block 7 (scans and coverage) and Block 8
(browser tests) run last, in parallel with each other, after Blocks 3 to 6.

Fixed contracts that let Blocks 3 to 5 be written without waiting for each other (all names are in files of
Block 1 or Block 2, under `apps/web/src/features/reports/`):
- `ReportKind` is `'categories' | 'incomeExpenses' | 'netWorth'`; `REPORT_MAX_MONTHS` is imported from
  `@pesly/shared`.
- `useReport` (`use-report.ts`, Block 2): `useReport<T>({ kind, filters, load })` returns
  `{ state, retry }` where `state` is `loading`, `ready` (with `data`), `empty`-free (the screen decides
  emptiness), `failed` (with `retrying`), `offline`, `filterGone` or `badRange` (with the failing field).
- `ReportFilters` (`components/report-filters.tsx`, Block 2): props include `kind`, `filters`, `accounts`,
  `today`, `onChange`, `renderTagField`; it hides the account and tag controls when `kind` is `netWorth`.
- `ReportNotices` (`components/report-notices.tsx`, Block 2): props `{ unconvertedShares, unconvertedInstallments, filtered }`.
- `ReportStates` (`components/report-states.tsx`, Block 2): `ReportLoading`, `ReportEmpty`, `ReportError`,
  `ReportOffline`, `FilterGoneAlert` and `RangeAlert`.
- `FiguresList` (`components/figures-list.tsx`, Block 2): the native list under a chart,
  props `{ label, rows: { key, label, value, note? }[] }`.
- `CurrencyNote` (`components/currency-note.tsx`, Block 2): props `{ currency }`.

| Block | Owns (parallel group) |
|---|---|
| 1 | `apps/web/src/features/reports/*.ts` (helpers), `apps/web/src/features/auth/return-path.ts`, `apps/web/src/lib/api-client.ts`, `apps/web/messages/en.json`, `apps/web/messages/es.json` (group A, first) |
| 2 | `apps/web/src/features/reports/use-report.ts`, `use-report-filters.ts`, `use-report-context.ts`, `load-account-options.ts`, `apps/web/src/features/reports/components/*` shared files, `apps/web/src/app/[locale]/(app)/reports/layout.tsx`, `reports/page.tsx` (group B) |
| 6 | `apps/web/src/features/shell/nav-items.ts`, `features/shell/containers/authenticated-shell-container.tsx`, `features/dashboard/components/categories-card.tsx`, `net-worth-card.tsx`, `features/auth/containers/sign-in-container.tsx`, `second-factor-container.tsx` (group B, parallel with 2) |
| 3 | `apps/web/src/features/reports/categories/*`, `apps/web/src/app/[locale]/(app)/reports/categories/page.tsx` (group C) |
| 4 | `apps/web/src/features/reports/income-expenses/*`, `apps/web/src/app/[locale]/(app)/reports/income-expenses/page.tsx` (group C) |
| 5 | `apps/web/src/features/reports/net-worth/*`, `apps/web/src/app/[locale]/(app)/reports/net-worth/page.tsx` (group C) |
| 7 | `apps/web/test/reports-scans.test.ts` (group D) |
| 8 | `apps/web/e2e/reports.spec.ts`, `apps/web/e2e/reports-lcp.spec.ts`, `apps/web/e2e/support/reports.ts` (group D) |

Test files of Blocks 1 to 6 are under `apps/web/test/` with the names given in each block; no two blocks
write the same test file.

## Block 1 — Shared helpers, api-client calls and catalogs

**Files**
- `apps/web/src/features/reports/report-view.ts` (new) — view types the screens draw: category row view (label,
  amount, whole percent, under-one flag), ring segment view, month view (income, expenses, net result), net
  worth point view (date, ars, usd, total or null, reason, incomplete flag). Amounts are `bigint`.
- `apps/web/src/features/reports/report-adapters.ts` (new) — the only reader of raw response fields:
  `toCategoriesView`, `toIncomeExpensesView`, `toNetWorthView`; turns amount strings into `bigint` with
  `BigInt(text)` (already proven integer strings by the response parser of the api-client).
- `apps/web/src/features/reports/shares.ts` (new) — `computeShares(rows, total)` per D5 and
  `ringSegments(rows)` (the 5 largest positive rows plus one "rest" segment when more than 5 remain).
- `apps/web/src/features/reports/category-names.ts` (new) — `categoryRowLabel(row, locale, labels)` using
  `DEFAULT_CATEGORIES` and `defaultCategoryName` from `@pesly/shared`, the stored name otherwise, the catalog
  label for a row without category id.
- `apps/web/src/features/reports/range.ts` (new) — `presetsFor(kind)`, `rangeOfPreset(preset, today)`,
  `activePreset(filters, today, kind)`, `checkRange({from, to, today, kind})` returning
  `ok` or one of `from_after_to`, `too_long` (with the limit in months).
- `apps/web/src/features/reports/report-filters-state.ts` (new) — `parseReportFilters(params, kind)`,
  `serializeReportFilters(filters)`, `hasEntityFilter(filters)`, `toReportQuery(filters)`; same pattern as
  `apps/web/src/features/movements/movement-filters-state.ts`.
- `apps/web/src/features/auth/return-path.ts` (new) — `safeReturnPath(value)` (allow-list of the four report
  routes, anything else gives `undefined`) and `signInHref(currentPath)`.
- `apps/web/src/lib/api-client.ts` (modified) — `getNetWorthSeries` accepts an optional query; new
  `getExpensesByCategory(query)` and `getIncomeExpenses(query)`; the types for their parameters.
- `apps/web/messages/en.json` and `apps/web/messages/es.json` (modified) — the whole `reports` namespace
  (groups below), `app.nav.reports`, `dashboard.categories.viewReport`, `dashboard.netWorth.viewReport`.

**Logic**
- Calls: the three report reads of 09a (expenses by category, income against expenses and net worth, by the
  paths in the PRD) are sent with `refreshOnUnauthenticated: true`, a query string built only from the defined keys of the
  query type (`from`, `to`, `accountId`, `tag`; net worth only `from` and `to`), and the response parsed with
  the shared response definitions already exported from `packages/shared/src/reports/report.ts`. The
  existing no-argument call keeps working (the dashboard still calls it with no query).
- Shares: integer arithmetic only, per D5; ties keep the order of the sorted list (amount from the largest,
  then label in the locale's collation).
- Ring: at most 6 segments; the rest segment sums the others; a non-positive row is not drawn.
- Presets: this month starts on the first day of today's month; last 3, 12 and 24 months start on the first
  day of the month 2, 11 and 23 months before; all end today. Income against expenses has no last-24 preset.
  The default preset (no `from`, no `to`) is this month for categories and last 12 months for the other two.
- Filters in the address: keys `from`, `to`, `accountId`, `tag`; each value is checked with the shared query
  definition of the report (`reportFlowQuerySchema` or `netWorthQuerySchema` field by field); a malformed
  value is ignored on its own and the others still apply (AC-31); for net worth `accountId` and `tag` are
  never read.
- Catalog key groups under `reports` (both languages, same keys): `title`; `tabs` (label, categories,
  incomeExpenses, netWorth); `range` (label, from, to, apply, custom, presets for this month, 3, 12 and 24
  months, resolved, limit with a month count, errors for `fromAfterTo`, `tooLong`, `toInFuture`);
  `filters` (toggle with a count, account, allAccounts, archivedAccount, tag, clear); `currency` (note with
  the currency code, change link); `notices` (unconverted with two counts, filtered); `states` (loading,
  empty title, empty description naming the range, widen, record, error title, retry, offline title,
  offline description, offline retry, filterGone message, filterGone reload, badRange message);
  `categories` (title, total, other, groupShares, underOne, chart name, chart summary, list name);
  `incomeExpenses` (title, income, expenses, net, chart name, chart summary, list name);
  `netWorth` (title, date, ars, usd, total, noRate, investmentsIncomplete, conversionUnavailable, tooltip,
  chart name, chart summary, list name, selected point).
- Return path: exact match on the four routes without query or fragment; `signInHref('/reports/net-worth')`
  gives `/sign-in?next=%2Freports%2Fnet-worth`.

**Input validation**
- Address values: `from` and `to` are local dates `YYYY-MM-DD` (the shared date definition rejects other
  formats and impossible days); `accountId` is a UUID; `tag` follows the shared movement tag definition
  (length and characters). Any other value is dropped, never sent.
- `next` for the sign-in: a string equal to one of four fixed paths; anything else, including absolute URLs,
  `//host`, backslashes and encoded variants, gives no return path.
- Response bodies are parsed by the api-client with the shared response definitions before any adapter reads
  them; a body that fails parsing becomes a generic failure.

**Error handling**
- A failed parse or a network failure is an `ApiResult` failure with the existing message keys; no raw server
  text is exposed.
- `computeShares` with a total of 0 or less returns no rows' shares (the screen shows the empty state); it
  never divides by zero.
- A category row with neither a known default key nor a name gets the catalog label for a row without a name.

**Required tests**
- [ ] `apps/web/test/reports-shares.test.ts`: 120,000.00 and 80,000.00 of 200,000.00 give 60% and 40% — validates AC-08
- [ ] Thirds: 33.34, 33.33 and 33.33 of 100.00 give 34%, 33%, 33% (never above 100%), by integer arithmetic only — validates AC-09
- [ ] A row of 0.4% is flagged under-one and keeps its amount — validates AC-12
- [ ] Total 0.00 and negative total give no shares — validates AC-10
- [ ] Property test: for any amounts and total the shown shares sum to at most 100 and are never negative
- [ ] `apps/web/test/reports-ring.test.ts`: 8 rows give 5 largest plus 1 rest segment (6), all 8 stay in the list — validates AC-11
- [ ] Sad path: all rows non-positive gives zero segments
- [ ] `apps/web/test/reports-category-names.test.ts`: default key Food is "Food" in English and the Spanish catalog name in Spanish — validates AC-13
- [ ] A null category id gives the catalog group-shares label — validates AC-14
- [ ] Sad path: unknown default key falls back to the stored name, then to the generic label
- [ ] `apps/web/test/reports-range.test.ts`: last 3 months from 2026-10-12 starts 2026-08-01 and ends today — validates AC-28
- [ ] Income against expenses offers no last-24 preset; the other two do — validates AC-29
- [ ] `from` after `to` gives `from_after_to`; 13 months on income against expenses gives `too_long` with 12 — validates AC-32, AC-33
- [ ] Preset arithmetic across a year boundary and in a leap-year February
- [ ] `apps/web/test/reports-filters-state.test.ts`: `?tag=vacations2026&from=2026-01-01` applies both — validates AC-30
- [ ] `from=31-12-2026` is ignored and the other filters stay — validates AC-31
- [ ] Sad paths: `accountId=not-a-uuid`, a tag over the length limit and a repeated key are ignored; net worth ignores `accountId` and `tag`
- [ ] `apps/web/test/api-client-reports.test.ts`: the category call sends `tag=vacations2026` and parses the answer — validates AC-26
- [ ] The three calls send only defined keys, keep the no-query net worth call unchanged and refuse a body that fails the shared response definition
- [ ] Sad path: an invalid or rejected answer body of any of the three calls gives a failure result, never partial data
- [ ] `apps/web/test/reports-catalog.test.ts`: every key of the groups above exists in `en.json` and `es.json` with the same placeholders — validates NFR-06
- [ ] `apps/web/test/return-path.test.ts`: the four routes are accepted; `https://evil.example`, `//evil.example`, `/\evil`, `/reports/../movements`, `/reports/net-worth?x=1` and an empty value give `undefined`

**Completion criterion**
The listed tests pass, `pnpm typecheck` and `pnpm lint` pass, the existing `apps/web/test/api-client-dashboard.test.ts`
still passes, and no file other than the ones above is touched. Block 1 is merged into the worktree before
any other block starts.

## Block 2 — Shared screens pieces, request hook, layout and tab bar

**Files**
- `apps/web/src/features/reports/use-report.ts` (new) — the request hook (D3, D6).
- `apps/web/src/features/reports/use-report-context.ts` (new) — reads the profile once for the time zone and
  gives `today`; offline or failed profile falls back to the device's own time zone name.
- `apps/web/src/features/reports/use-report-filters.ts` (new) — reads the address with `useSearchParams`,
  returns parsed filters and a setter that replaces the address (no history entry per keystroke).
- `apps/web/src/features/reports/load-account-options.ts` (new) — D7.
- `apps/web/src/features/reports/components/report-tabs.tsx` (new) — the three tab links.
- `apps/web/src/features/reports/components/report-filters.tsx` (new) — presets, custom dates, account
  selector, tag slot, clear; collapsed behind one control with the active count under 1024 px, open from 1024
  px (uses `apps/web/src/lib/use-compact-viewport.ts`).
- `apps/web/src/features/reports/components/report-notices.tsx` (new) — unconverted counts and filtered notice.
- `apps/web/src/features/reports/components/currency-note.tsx` (new) — currency code, display-currency
  sentence and link to `/settings/profile`.
- `apps/web/src/features/reports/components/report-states.tsx` (new) — loading, empty, error, offline,
  filter-gone and range alerts, built on `skeleton.tsx`, `empty-state.tsx`, `error-state.tsx` and `alert.tsx`
  in `apps/web/src/components/ui/`.
- `apps/web/src/features/reports/components/figures-list.tsx` (new) — the text alternative (FR-21).
- `apps/web/src/app/[locale]/(app)/reports/layout.tsx` (new) — page header and tab bar around the children.
- `apps/web/src/app/[locale]/(app)/reports/page.tsx` (new) — redirects to `/reports/categories`.

**Logic**
- `useReport`: builds a key from the report kind and the serialized filters; when the key changes, drops the
  earlier answer, shows `loading`, and, unless the device is offline (`isOffline()` from
  `apps/web/src/lib/connectivity.ts`) or the range check of Block 1 fails, calls `load` once. The answer is
  applied only when its sequence number is the latest. Mapping: success is `ready`; `UNAUTHENTICATED` clears
  the state and calls `router.replace(signInHref(pathname))`; `NETWORK` with the device offline is `offline`,
  other `NETWORK` and server errors are `failed`; `NOT_FOUND` is `filterGone`; `VALIDATION_FAILED` naming
  `query.from` or `query.to` is `badRange` with that field. `retry` sends the same key again and sets
  `retrying` until the answer arrives; while it is true the retry button is disabled.
- A range that fails the local check sends no request and gives the range message next to the date fields.
- The filter bar never fetches and never touches the address: it receives values and calls `onChange`, the
  container owns both (same split as `movement-filters.tsx`). Changing a preset or a field calls `onChange`
  once. The reload action of `FilterGoneAlert` asks the container to clear the account and tag filters.
- The tab bar marks the tab of the current path with `aria-current="page"`; every tab, preset, select, date
  field and button has a 44 px minimum target by the classes of the design system.
- `ReportNotices` shows the counts notice only when either count is above 0 (AC-37) and the filtered notice
  only when an account or tag filter is active (AC-38, AC-39).
- `CurrencyNote` formats nothing; the code and sentence come from the catalog; the link uses the `Link` of
  `apps/web/src/i18n/navigation.ts`.
- Empty state names the range with the locale date formatter and offers links to widen (clears dates) and to
  `/movements/new`.

**Input validation**
- Date fields are `type="date"` inputs; the typed value goes through `checkRange` before `onChange` reaches
  the container, so an invalid pair is shown as invalid (`aria-invalid`, `aria-describedby` to the message)
  and not sent.
- The account selector holds only ids from the loaded list or the empty value; the tag slot is the existing
  single-tag input with its own length rules.
- Values that arrive from the address were already validated by Block 1.

**Error handling**
- Failure to load account options leaves the selector empty with the filter still usable by tag; the report
  request is not blocked by it.
- Every failed state shows catalog text only, never the server's text, ids or an amount.
- A response that arrives after unmount is ignored; the effect cleanup marks the request stale.
- 404 clears both entity filters on confirmation and shows the alert; 400 on `to` or `from` shows the range
  alert and keeps figures hidden.

**Required tests**
- [ ] `apps/web/test/reports-use-report.test.tsx`: two filter changes within one second show only the second answer even when the first answers later — validates AC-47
- [ ] One filter change sends exactly one request; retry is single-flight and the retry control is disabled while in flight — validates AC-42, FR-22
- [ ] A 401 answer drops the data, calls the router with the sign-in address and the current report path — validates AC-48
- [ ] Offline at request time sends no request, shows `offline` and no earlier figures; after the connection returns, retry requests and shows the report — validates AC-43, AC-44
- [ ] A 404 gives `filterGone` and a 400 naming `query.to` gives `badRange` with figures hidden — validates AC-27, AC-34
- [ ] Sad path: a network failure while online gives `failed`, not `offline`
- [ ] `apps/web/test/reports-shared-components.test.tsx`: tabs show three names and mark the current one with `aria-current="page"` — validates AC-01, AC-02
- [ ] The filter bar of a flow report shows range, account and tag controls; the net worth one shows the range only — validates AC-24, AC-25
- [ ] A `from` after `to` marks both date fields invalid, shows the message and calls no `onChange` with a request — validates AC-32
- [ ] 13 months on income against expenses states the limit of 12 and sends nothing — validates AC-33
- [ ] At 360 px width the filters sit behind one control naming the count of active filters; at 1024 px they are open — validates AC-50
- [ ] The currency note shows the code, the display-currency sentence and the profile settings link; a USD answer is formatted as USD without mixing — validates AC-35, AC-36
- [ ] The notice shows both counts for 2 and 1 and nothing for 0 and 0 — validates AC-37
- [ ] The filtered notice shows with an account or tag filter and not without — validates AC-38, AC-39
- [ ] Skeleton keeps the controls operable; empty state names the range and offers both actions; the error state has a retry button — validates AC-40, AC-41, AC-42
- [ ] The figures list renders one row per entry and the chart name and summary are exposed while the drawing is hidden from the reading order — validates AC-45, AC-46
- [ ] `apps/web/test/reports-layout.test.tsx`: the redirect page sends `/reports` to `/reports/categories` — validates AC-01

**Completion criterion**
The listed tests pass, no component in this block fetches or reads the address except the hooks, and
`pnpm typecheck` and `pnpm lint` pass. Blocks 3, 4 and 5 import only the names fixed in
"Dependencies between blocks".

## Block 3 — Expenses by category screen

**Files**
- `apps/web/src/features/reports/categories/categories-container.tsx` (new) — wires `useReport`,
  `useReportFilters`, `useReportContext`, the account loader and the tag container; maps the answer with
  `toCategoriesView`.
- `apps/web/src/features/reports/categories/categories-screen.tsx` (new) — presentational: filters slot,
  currency note, notices, total, ring, list, states.
- `apps/web/src/features/reports/categories/category-ring.tsx` (new) — the ring chart for the segments of
  Block 1, built on `apps/web/src/components/ui/donut-chart.tsx`.
- `apps/web/src/features/reports/categories/categories-skeleton.tsx` (new) — the final layout as a skeleton.
- `apps/web/src/app/[locale]/(app)/reports/categories/page.tsx` (new) — the route page with a `Suspense`
  boundary around the container (the address is read on the client).

**Logic**
- Sends no `from` and no `to` on first open; sends the filters of the address otherwise (D4). The answer's own
  `from` and `to` are shown as the resolved range.
- Shows the total with `formatMoney`; each row shows label, amount and whole percent (or the under-one
  text), ordered by amount from the largest; the ring shows the segments of Block 1 with a legend and the
  share as text; the list below shows every row. When the total is 0 or less the empty state replaces the
  chart and list (AC-10).
- Notices: unconverted counts, filtered notice (when an account or tag filter is active), currency note.
- Tooltip-free: ring meaning is carried by the legend and the list, never by color alone; the chart has a
  name and a summary of the range and the total for assistive technology.

**Input validation**
- Filters arrive through Block 2's hook, already validated; the container sends `accountId` and `tag` only
  when present and valid.

**Error handling**
- Every state of `useReport` maps to a Block 2 state component; `filterGone` clears both entity filters and
  offers the reload; `badRange` shows the range alert; the screen never shows figures of an earlier answer.
- A category name is rendered as React text (no markup interpretation).

**Required tests**
- [ ] `apps/web/test/reports-categories.test.tsx`: total 200,000.00 with Food 120,000.00 and Transport 80,000.00 shows Food 60% first and Transport 40% second — validates AC-08
- [ ] Thirds show whole-number shares that do not add up to more than 100% — validates AC-09
- [ ] A total of 0.00 shows the empty state and no percentage — validates AC-10
- [ ] 8 categories draw 6 ring segments and list 8 rows — validates AC-11
- [ ] A share under 1% lists "<1%" with its amount — validates AC-12
- [ ] Default key names in English and Spanish; null category id uses the group-shares label — validates AC-13, AC-14
- [ ] Filtering by the tag `vacations2026` requests the report with that tag and shows the answer — validates AC-26
- [ ] The first open sends no `from` and no `to`; a preset sends explicit dates — validates AC-28
- [ ] With Spanish selected every label, notice and month is Spanish and amounts use the Spanish format — validates AC-49
- [ ] A name containing `<img src=x onerror=alert(1)>` renders as text and creates no element
- [ ] The list below the ring has one row per category and the chart exposes a name and summary — validates AC-45, AC-46
- [ ] Sad path: a failing request shows the error state with retry and no earlier figures
- [ ] A 404 answer for an account filter shows the filter-gone alert, clears the filter and offers the reload — validates AC-27

**Completion criterion**
The listed tests pass, the page opens at `/reports/categories` in the test render, and the folder holds no
catalog, api-client or shared-component edit.

## Block 4 — Income against expenses screen

**Files**
- `apps/web/src/features/reports/income-expenses/income-expenses-container.tsx` (new) — wiring as Block 3,
  with the 12-month limit and no last-24 preset.
- `apps/web/src/features/reports/income-expenses/income-expenses-screen.tsx` (new) — presentational.
- `apps/web/src/features/reports/income-expenses/month-bars.tsx` (new) — grouped bars in SVG: one income bar
  and one expense bar per month, month labels thinned to stay legible at 360 px, a sign and text for the
  net result under each month.
- `apps/web/src/features/reports/income-expenses/income-expenses-skeleton.tsx` (new) — final layout skeleton.
- `apps/web/src/app/[locale]/(app)/reports/income-expenses/page.tsx` (new) — route page with `Suspense`.

**Logic**
- Bar heights come from a bigint division by the largest month value into a small integer permille; only that
  integer becomes a coordinate. Income and expense use two theme tokens plus a different fill pattern or
  label so color is not the only difference.
- Net result under each month is income minus expenses in `bigint`, shown with an explicit plus or minus sign
  and the locale money format; month names come from the locale date formatter.
- When every month has 0 income and 0 expenses the empty state replaces the bars (AC-17).
- Below the chart a list gives each month's income, expenses and net result (FR-21).
- Notices: unconverted counts, filtered notice when an account or tag filter is active, currency note.

**Input validation**
- Same as Block 3; the range check uses the 12-month limit of `REPORT_MAX_MONTHS.incomeExpenses`.

**Error handling**
- As Block 3. A months list longer than 24 or in a wrong order is drawn as received but at most 24 months are
  drawn (NFR-08), and the list still shows each month received up to that bound.

**Required tests**
- [ ] `apps/web/test/reports-income-expenses.test.tsx`: 12 months draw 12 income bars and 12 expense bars with month names in the user's language — validates AC-15
- [ ] October with 800,000.00 income and 240,000.00 expenses shows +560,000.00; expenses above income shows a minus sign — validates AC-16
- [ ] Every month at 0 shows the empty state and no bars — validates AC-17
- [ ] The preset list has no last-24 preset; 13 months is refused with the 12-month limit — validates AC-29, AC-33
- [ ] The account selector and tag input are offered — validates AC-24
- [ ] The notice about installments and group shares shows only with an active filter — validates AC-38, AC-39
- [ ] Unconverted counts of 2 and 1 show the notice — validates AC-37
- [ ] The list and the chart summary carry the same figures — validates AC-45, AC-46
- [ ] At 24 months labels are thinned (not every month labeled) and none overlap by construction of the label step
- [ ] Sad path: offline shows the connection message and no figures — validates AC-43

**Completion criterion**
The listed tests pass and the folder holds no catalog, api-client or shared-component edit.

## Block 5 — Net worth screen

**Files**
- `apps/web/src/features/reports/net-worth/net-worth-container.tsx` (new) — wiring as Block 3, range only,
  24-month limit.
- `apps/web/src/features/reports/net-worth/net-worth-screen.tsx` (new) — presentational.
- `apps/web/src/features/reports/net-worth/net-worth-area-chart.tsx` (new) — SVG area and line, gaps for
  missing totals, selection by pointer, touch and keyboard; imports geometry from
  `apps/web/src/features/dashboard/chart/chart-geometry.ts` without changing it.
- `apps/web/src/features/reports/net-worth/net-worth-detail.tsx` (new) — the selected point: date, converted
  total, ARS and USD components, the no-rate text and the investments note.
- `apps/web/src/features/reports/net-worth/net-worth-skeleton.tsx` (new) — final layout skeleton.
- `apps/web/src/app/[locale]/(app)/reports/net-worth/page.tsx` (new) — route page with `Suspense`.

**Logic**
- Points without a total start a new line segment and are never bridged or filled with another month's rate
  (PRD decision 4); the text for that month says no exchange rate exists for that month end.
- The plot is one focusable slider: left and right arrows move the selection by one point and announce date
  and value; hover or tap shows a tooltip with the point's date and converted total.
- The selected point shows `ars` in ARS and `usd` in USD next to the converted total, never converted or
  summed by the client.
- A point with `investmentsIncomplete` shows the note that the investments of that month are not fully counted.
- When no point has a total, the chart is replaced by the list of ARS and USD components per month and a
  notice that conversion is unavailable (AC-22).
- Under the chart, a list of every point's date, total or reason, and components.
- Only the range filter is offered; no account, tag or filtered notice; the currency note is shown.

**Input validation**
- Range through Block 2's hook; the 24-month limit of `REPORT_MAX_MONTHS.netWorth`; the selected index is
  clamped to the drawn points so a key press at an end changes nothing.

**Error handling**
- As Block 3. A series longer than 24 points draws the last 24 (NFR-08); an all-equal series draws a flat
  line with no division by zero (the geometry helper already handles a zero span).

**Required tests**
- [ ] `apps/web/test/reports-net-worth.test.tsx`: tapping or hovering a point shows a tooltip with its date and converted total — validates AC-18
- [ ] With focus on the plot, arrow right and left move the selection by one and the live announcement has date and value — validates AC-19
- [ ] The point of 2026-06-30 with 1,000,000.00 ARS and 500.00 USD shows both components in their own currency next to the total — validates AC-20
- [ ] A point with a null total and reason `no_rate` leaves a gap (no line segment) and says no exchange rate exists for that month end — validates AC-21
- [ ] No point with a total shows the components list and the conversion-unavailable notice instead of a chart — validates AC-22
- [ ] `investmentsIncomplete` shows the investments note — validates AC-23
- [ ] Only the date range is offered: no account or tag control — validates AC-25
- [ ] The text list repeats every point; the chart has a name and summary and the drawing is hidden from assistive technology — validates AC-45, AC-46
- [ ] Sad path: a 401 answer sends the user to sign-in and shows no figures — validates AC-48

**Completion criterion**
The listed tests pass and the folder holds no catalog, api-client, shared-component or dashboard-chart edit.

## Block 6 — Navigation entry, dashboard links and return after sign-in

**Files**
- `apps/web/src/features/shell/nav-items.ts` (modified) — `reports` added to `NavLabelKey`, a Reports item
  with the `ChartLine` icon of `lucide-react` added to `PLAN_ITEMS` (the More list already spreads that
  list); `backButtonVisibility` treats every path under `/reports/` like a menu root.
- `apps/web/src/features/shell/containers/authenticated-shell-container.tsx` (modified) — an expired session
  redirects with `signInHref(pathname)` from Block 1.
- `apps/web/src/features/dashboard/components/categories-card.tsx` (modified) — one link to
  `/reports/categories`.
- `apps/web/src/features/dashboard/components/net-worth-card.tsx` (modified) — one link to
  `/reports/net-worth`.
- `apps/web/src/features/auth/containers/sign-in-container.tsx` (modified) — after a successful sign-in with
  a verified email, goes to `safeReturnPath(next)` when valid, else `/`; passes `next` on to the second step.
- `apps/web/src/features/auth/containers/second-factor-container.tsx` (modified) — same return on success.

**Logic**
- The Reports item is listed in the side menu's plan ahead block (from 1024 px) and in the More list; the
  bottom bar keeps its four items and More is current on every report route (`isActiveInBottomNav` already
  matches by prefix).
- The two dashboard links use the `Link` of `apps/web/src/i18n/navigation.ts` with the catalog labels of
  Block 1 and a 44 px target; no other dashboard behavior changes.
- Return path: only the pathname of a report route is carried, and only when `safeReturnPath` accepts it;
  the unverified-email destination still wins over the return path.

**Input validation**
- `next` is read from the address and passed through `safeReturnPath`; a value that is not one of the four
  fixed routes is ignored.

**Error handling**
- A missing or invalid `next` behaves exactly as today (home). No error is shown for a rejected value.

**Required tests**
- [ ] `apps/web/test/reports-navigation.test.tsx`: the side menu lists Reports in the plan ahead block at 1024 px — validates AC-04
- [ ] The More page lists Reports and More is current on `/reports/categories`, `/reports/income-expenses` and `/reports/net-worth` — validates AC-05
- [ ] The dashboard categories card link opens `/reports/categories`; the net worth card link opens `/reports/net-worth` — validates AC-06, AC-07
- [ ] The bottom bar still has four items; no back button on the report routes in the desk layout
- [ ] A shell with no session redirects to `/sign-in?next=%2Freports%2Fnet-worth` — validates AC-03
- [ ] Sign-in with `next=/reports/net-worth` returns to that route; with `next=https://evil.example` or `//evil.example` it goes to `/` — validates AC-03
- [ ] Second-factor success returns to the report route; an unverified email goes to the check-your-email page
- [ ] Sad path: an invalid or missing `next` value is ignored and sign-in goes to `/` with no error shown
- [ ] The existing `apps/web/test/shell-navigation.test.tsx`, `apps/web/test/dashboard-cards.test.tsx` and `apps/web/test/sign-in-container.test.tsx` still pass

**Completion criterion**
The listed tests pass and the existing shell, dashboard and sign-in tests still pass unchanged.

## Block 7 — Scans and coverage guard

**Files**
- `apps/web/test/reports-scans.test.ts` (new) — reads the new and touched files of this ticket as text.

**Logic**
- Scans fail the suite when any file under `apps/web/src/features/reports/` or `apps/web/src/app/[locale]/(app)/reports/`
  contains: `dangerouslySetInnerHTML`, `innerHTML`, `localStorage`, `sessionStorage`, `indexedDB`, `caches.`,
  `parseFloat`, `toFixed`, `Number(` on an amount, `console.` calls, a color literal (hex, `rgb(`, `hsl(`)
  or a quoted user-facing literal in a component outside the catalogs.
- Checks that `apps/web/package.json` has the same dependency lists as on `main` (recorded in the test as the
  expected sets) and that `apps/web/src/app/sw.ts` has no rule for the reports calls.

**Input validation**
- Not applicable; the test reads repository files only.

**Error handling**
- A missing file fails with its path in the message; the scan never skips a folder silently.

**Required tests**
- [ ] No storage, cache or service worker call in the new files — validates NFR-07
- [ ] No raw HTML insertion and no logging in the new files — validates NFR-07
- [ ] No floating point on money (`parseFloat`, `toFixed`, `Number(` on an amount) — validates NFR-06
- [ ] No hardcoded visible string in the new components and no color literal — validates NFR-06, NFR-04
- [ ] The dependency lists of `apps/web/package.json` are unchanged — validates NFR-07
- [ ] `pnpm test:coverage` meets 80% lines, branches and functions over the three source folders — validates NFR-09
- [ ] Sad path: a missing source file makes the scan fail with its path in the message
- [ ] Every FR-01 to FR-23 appears by id in the title of at least one test of Blocks 1 to 6 or 8 — validates NFR-09

**Completion criterion**
The scan test passes and `pnpm test:coverage` meets the floor of `AGENTS.md`.

## Block 8 — Browser tests with typed fixtures

**Files**
- `apps/web/e2e/support/reports.ts` (new) — typed fixtures built with the shared response types
  (`ExpensesByCategoryResponse`, `IncomeExpensesResponse`, `NetWorthResponse`) and checked with their
  shared response definitions; route stubs for the cases real data cannot produce (a slow first answer, 404
  for a filter, 400 on `to`, 401, a server error); helpers that count report requests.
- `apps/web/e2e/reports.spec.ts` (new) — the flows below, in `es-AR` and the `America/Cordoba` time zone,
  with real seeded accounts and movements for the happy paths.
- `apps/web/e2e/reports-lcp.spec.ts` (new) — the lab LCP test, in the manner of `apps/web/e2e/dashboard-lcp.spec.ts`.

**Logic**
- Uses the existing helpers of `apps/web/e2e/support/` (`accounts.ts`, `database.ts`, `dashboard.ts`,
  `contrast.ts`, `offline-visit.ts`) without editing them; the new support file only adds report fixtures.
- Widths 360, 768, 1024, 1280 and 1920 px in light and dark: no horizontal overflow, 44 px targets,
  keyboard reachability, contrast probe on every state (loading, ready, empty, error, offline).
- The LCP test needs the production build, as the dashboard one does.

**Input validation**
- Fixtures are parsed with the shared response definitions before a stub serves them, so a drifted fixture
  fails the test instead of the page.

**Error handling**
- Stubs are removed after each test; a test that leaves a stub fails in `afterEach`.

**Required tests**
- [ ] Opening `/reports` lands on the categories screen with three tabs; selecting Net worth opens its route and marks it current — validates AC-01, AC-02
- [ ] A signed-out visit to a report route goes to sign-in and returns to the route after signing in — validates AC-03
- [ ] Side menu at 1280 px lists Reports; the More page at 360 px lists it and marks More current — validates AC-04, AC-05
- [ ] The dashboard links open the two reports — validates AC-06, AC-07
- [ ] With seeded movements the category report shows the real total, shares and ring segment count — validates AC-08, AC-11
- [ ] Income against expenses shows 12 months and the net result signs — validates AC-15, AC-16
- [ ] Net worth with a stored-rate-free past shows gaps and the no-rate text; keyboard arrows move the selection — validates AC-19, AC-21
- [ ] A custom range with `from` after `to` sends no request; 13 months on income against expenses states the limit — validates AC-32, AC-33
- [ ] A 400 on `to`, a 404 on a filter and a 401 each show their state (message, cleared filter and reload, sign-in) — validates AC-27, AC-34, AC-48
- [ ] The address `?tag=vacations2026&from=2026-01-01` applies both filters and `from=31-12-2026` is ignored — validates AC-30, AC-31
- [ ] Offline shows the connection message and no figures; back online, retry shows the report; no report figure is found in `localStorage`, `sessionStorage`, IndexedDB or the Cache Storage — validates AC-43, AC-44, NFR-07
- [ ] One filter change sends exactly one report request; two changes within a second show the second answer — validates NFR-02, AC-47
- [ ] Spanish labels and months and the Spanish number format on all three screens — validates AC-49
- [ ] At 360 px the filters collapse behind one control with the count; at 1024 px they are open — validates AC-50
- [ ] 5 widths by 2 themes: no horizontal overflow (also at 200% text), targets of at least 44 px, keyboard order, contrast of text 4.5:1 and marks 3:1 — validates NFR-03, NFR-04, NFR-05
- [ ] The median largest contentful paint of each report over 5 runs under the reference profile stays under 2.5 s — validates NFR-01

**Completion criterion**
`pnpm e2e` (one worker) passes for `reports.spec.ts`, and `reports-lcp.spec.ts` passes on the production
build.

## Final verification
- Every FR-01 to FR-23 and NFR-01 to NFR-09 maps to a block above and is named by at least one automated
  test; every AC-01 to AC-50 is named by a test of Blocks 1 to 6 or 8.
- `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:coverage` (80% lines,
  branches and functions) and the two build commands of `AGENTS.md` pass; `pnpm audit --prod --audit-level high`
  reports nothing new and the dependency lists of `apps/web/package.json` are unchanged.
- No file under `apps/api`, `packages/shared` or the database migrations changed; the only shared-file edits
  are the ones named in Blocks 1 and 6.
- No report figure is written to browser storage, a cache or the service worker, and none is logged.
- Both catalogs have the same keys; no visible string is hardcoded.

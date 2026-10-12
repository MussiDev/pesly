# Spec DISC-001-05j: Group Category Views

| Field | Value |
|-------|-------|
| Ticket | DISC-001-05j |
| PRD | docs/ddw/prd/prd-DISC-001-05j.md |
| Tier | FEATURE |
| Date | 2026-10-12 |
| Spec loops | 0 |
| Loops since last human decision | 0 |

## Summary
Small API addition plus web screens, stacked on 05b, 05e, 05f and 05h (all merged). The API gains a
category and date-range filter on `GET /groups/:id/expenses` and a new read,
`GET /groups/:id/expenses/summary`, which sums the expense amounts per currency and category over the
whole range on the server, as `bigint` sums sent as strings; there is no migration, because the existing
index `group_expenses_group_occurred_idx` on `(group_id, occurred_at desc, id desc)` serves both reads.
The web shows the category of each expense as a chip (icon, color, name, archived marker), adds a month
picker and a category filter to the expenses page, and adds a "spending by category" section above the list
whose lines tap into the filter. Percentages are integer basis points computed with `bigint`; no money value
goes through a float and no dependency is added. Blocks 1 to 5 are the contract, the two API changes, the
api-client method and the pure web logic; Blocks 6 to 10 are the screens; Block 11 is the end-to-end check.

## Decisions
- **D1 Filter shape.** `categoryIds` is one query parameter holding comma-separated UUIDs (1 to 50, no
  repeats); `from` and `to` are UTC instants like the personal shares query (inclusive bounds). With both
  present, `from <= to` and `to - from <= 366 days` (AC-27). Any violation is 400 `VALIDATION_FAILED`
  before the use case runs. A valid UUID of a category the group does not own simply matches nothing: every
  query is scoped by `group_id`, so it reveals nothing.
- **D2 Summary shape.** `GET /groups/:id/expenses/summary?from=&to=` (both required, same range rules)
  answers `{from, to, currencies: [{currency, total, count, categories: [{categoryId, total, count}]}],
  categories: GroupCategoryResponse[]}`. `total` is a non-negative integer string in minor units, `count` an
  integer. `currencies` is ordered ARS then USD and lists only currencies that have expenses in the range;
  each `categories` list is ordered by `total` desc then `categoryId` asc (the server does not know the
  display name, so the client breaks ties by name, AC-12). `categories` (top level) holds the categories the
  lines name, archived ones included, so the screen needs no second request (NFR-02). The currency `total` is
  computed by the use case as the `bigint` sum of its category totals, so the sum of the lines always equals
  the total (NFR-03).
- **D3 Where the summary lives (PRD decision).** A section of the expenses page, above the list, not a new
  route and not a chart view. One calendar month at a time in the user's time zone (PRD decision); custom
  ranges stay out. The month bounds are the first instant of day 1 (`zonedLocalToInstant`) to one
  millisecond before the first instant of the next month, in the user's zone.
- **D4 Request budgets (NFR-02).** The list section keeps its 3 requests on first load (group, options, first
  page; 05h D5). A change of month or category refetches only the first page (1 request): the group and the
  options are already in memory. The summary section makes 1 request on load (`getGroupExpenseSummary`), which
  is within the PRD's budget of 2; it does not repeat `getGroup`, because the list section already shows the
  not-found state and the summary answers 404 itself. A month change refetches the summary (1). The page's
  first load is therefore 4 requests in total, asserted per section.
- **D5 State, not URL.** The chosen month and the category filter are component state of the page container
  (Block 9), reset when the group changes. No search parameters, so no new external input reaches a screen.
  Tapping a summary line sets the filter to that category (replacing a previous one, AC-14) and keeps the month.
- **D6 Percentages and bars.** Share of a line = `total * 10000n / currencyTotal` with round-half-up in
  `bigint` (basis points, 0 to 10000). Only the display goes through `Intl.NumberFormat` percent of
  `basisPoints / 10000`, in one function (`formatShare`), and a bar width is `basisPoints / 100` as a CSS
  percent. A scan allows that function and nothing else to convert a basis-point number; no `total` or
  `amount` value is ever converted to a number.
- **D7 Unknown category (FR-10).** The database makes `group_expenses.category_id` a foreign key, so the API
  never returns an expense or a summary line whose category is missing from `categories`. The fallback is
  still built, defensively, for a queued change overlay, a stale options answer or a newer API: a pure
  resolver returns a neutral icon, a neutral color and the existing `groups.expenses.uncategorized` copy,
  and the summary merges every line whose id is not in `categories` into one "No category" line per
  currency, carrying the ids it merged so tapping it still filters by them.
- **D8 Archived category in the filter (AC-19).** The filter offers every active category and an archived one
  only when the summary of the chosen month has a line for it. The options answer is the source of the
  active ones, the summary of the archived ones.
- **D9 Detail screen (FR-02).** The group has no read-only expense detail route today: the expense screen is
  the edit screen (`.../expenses/[expenseId]/edit`, 05h). The category chip is shown there, above the form,
  read-only; the select that changes the category stays. Ratification item.
- **D10 Filtered total (AC-15).** While a category filter is active the list section shows, above the list,
  the filter's total per currency and the expense count, taken from the summary (sum of the selected lines
  of each currency), because the list is paginated and cannot sum itself. It is the same string the summary
  line shows.
- **D11 Color is never alone (FR-12, AC-23).** `CategoryChip` always renders the icon (through
  `CategoryVisual`), the name as text and, for archived, the text marker. A summary bar sits beside text with
  the amount and the percentage. Colors come from the existing `CategoryVisual` tokens and `bg-primary` or
  `bg-muted` for bars; no hex or `rgb` value is written.
- **D12 No new dependency, no migration, no new shared formatter outside the feature.** New web code lives in
  `features/groups/category-views/`; month and percent formatting use `Intl` with the active locale.
- **D13 Online only.** The summary and the filters need the API (PRD out of scope for offline). A request
  failure shows the shared error with retry and never blocks the list (AC-30).

## Coverage: PRD → blocks
| Requirement | Covered by |
|---|---|
| FR-01 | Block 5, Block 6, Block 7 |
| FR-02 | Block 6, Block 10 |
| FR-03 | Block 1, Block 2, Block 4, Block 6, Block 7, Block 9 |
| FR-04 | Block 5, Block 6, Block 7, Block 8, Block 9 |
| FR-05 | Block 5, Block 6, Block 8 |
| FR-06 | Block 3, Block 5, Block 6, Block 8 |
| FR-07 | Block 5, Block 7, Block 9 |
| FR-08 | Block 6, Block 7, Block 8, Block 9 |
| FR-09 | Block 5, Block 6, Block 7, Block 8 |
| FR-10 | Block 5, Block 6, Block 8 |
| FR-11 | Every web block adds its keys and uses the locale formatters; Block 11 checks |
| FR-12 | Block 6, Block 8, Block 11 |
| FR-13 | Block 1, Block 2, Block 3, Block 4 |
| NFR-01 | Block 11 (end-to-end at 360 px) |
| NFR-02 | Strategy: D4 budgets, asserted by a call-count test in Blocks 7 and 8 and counted again in the browser by Block 11 |
| NFR-03 | Block 3 (property test over 1,000 random sets), Block 5 (bigint percent property test) |
| NFR-04 | Block 3 (benchmark in `apps/api/test/perf`) |
| NFR-05 | Strategy: every web block adds Spanish and English keys together under `groups.categoryViews`; the existing catalog parity test runs in each block and in Block 11 |
| NFR-06 | Block 2, Block 3 (non-member integration tests) |

## Dependencies between blocks
Block 1 (shared contract) is first. Blocks 2, 3, 4 and 5 each need Block 1 and touch disjoint files, so they
run in parallel (group B). Block 6 needs Block 5 (view-model types). Blocks 7, 8 and 10 need Blocks 5 and 6
and touch disjoint folders, so they run in parallel (group D); Block 7 also needs Block 4. Block 8 needs
Block 4. Block 9 needs Blocks 7 and 8. Block 11 is last and owns the end-to-end spec. Shared files are the
catalogs `apps/web/messages/en.json` and `apps/web/messages/es.json`, and `apps/api/src/groups/infrastructure/http/group-routes.ts`
(only Block 3 edits it). Each web block adds keys under its own sub-namespace of `groups.categoryViews` by
targeted `Edit` insertion at a distinct anchor, never by rewriting the file: `chip`, `filter`, `month` and
`summary` (Block 6), `list` (Block 7), `summarySection` (Block 8), `page` (Block 9) and `detail` (Block 10).
Parallel blocks that must write the same JSON file take turns at the edit step.

| Block | Owns (parallel group) |
|---|---|
| 1 | `packages/shared/src/groups/expense.ts`, `expense-summary.ts`, `index.ts` (group A) |
| 2 | API list filter: `list-group-expenses.ts`, port query, `drizzle-group-expense-repository.ts` `listExpenses` (group B) |
| 3 | API summary: new port, adapter, use case, presenter, route in `group-routes.ts`, perf test (group B) |
| 4 | `apps/web/src/lib/api-client.ts` and its tests (group B) |
| 5 | `features/groups/category-views/*.ts` pure logic (group B) |
| 6 | `features/groups/category-views/components/*` presentational (group C) |
| 7 | `features/groups/expenses/list/*` (group D) |
| 8 | `features/groups/category-views/summary-container.tsx` (group D) |
| 9 | `features/groups/category-views/group-expenses-page.tsx` and the route page (group E) |
| 10 | `features/groups/expenses/edit/expense-edit-view.tsx` (group D) |
| 11 | `apps/web/e2e/group-category-views.spec.ts` and its support file (last) |

## Block 1 — Shared contract for the filter and the summary

**Files**
- `packages/shared/src/groups/expense-summary.ts` (new) — constants, `categoryIdsParamSchema`,
  `dateRangeRefinement`, `groupExpenseSummaryQuerySchema`, `groupExpenseSummaryResponseSchema` and types.
- `packages/shared/src/groups/expense.ts` (modified) — `listGroupExpensesQuerySchema` gains `categoryIds`,
  `from` and `to`.
- `packages/shared/src/index.ts` (modified) — one `export * from './groups/expense-summary'` line.
- `packages/shared/test/group-expense-summary-schemas.test.ts` (new).

**Logic**
`GROUP_EXPENSE_RANGE_MAX_DAYS = 366` and `GROUP_EXPENSE_CATEGORY_FILTER_MAX = 50`. `categoryIdsParamSchema`
accepts a string of at most 1,850 characters, splits it on commas, requires 1 to 50 entries, each a UUID and
all different, and outputs `string[]`. `from` and `to` reuse `occurredAtSchema`. A shared refinement rejects
`from > to` and a span above 366 days when both are present; the summary query makes both required. The
response schema has `from`, `to`, `currencies` (`currency` as `accountCurrencySchema`, `total` and every line
`total` as non-negative integer strings, `count` as non-negative integers) and `categories` as
`groupCategoryResponseSchema[]`. Money is only strings here; no `number` carries an amount.

**Data model**
- No stored entity changes. The contract describes the answer of `group_expenses` sums: `total` is a
  not null string of a non-negative integer, `count` a not null non-negative integer, `currency` one of
  `ARS` or `USD`; no default is applied to any field.

**Input validation**
- `categoryIds`: 1 to 50 comma-separated UUIDs, no empty entry, no repeat, at most 1,850 characters.
- `from`, `to`: ISO instants as `occurredAtSchema`; summary requires both; `from <= to`; span at most 366 days.
- Strict object: any other key is invalid.

**Error handling**
- A failed parse is a Zod error that the shared validation middleware turns into 400 `VALIDATION_FAILED`;
  the schemas never throw outside `parse`.

**Required tests**
- [ ] A list query with 1 and with 50 distinct UUIDs and a valid range parses to arrays and instants —
  validates AC-25.
- [ ] An invalid query (a non-UUID entry, an empty entry `a,,b`, an empty string, a repeated id, 51 ids)
  is an error — validates AC-06, AC-27.
- [ ] A reversed range and a span of 367 days are rejected, 366 days is accepted — validates AC-27.
- [ ] The summary query without `from` or without `to`, and with an extra key, is an invalid input error —
  validates AC-27.
- [ ] The response schema accepts the documented shape, and rejects a numeric `total`, a negative `total` and
  an unknown currency — validates AC-26.

**Completion criterion**
The shared tests pass, `pnpm typecheck` is clean and the existing `group-expense-schemas.test.ts` still passes.

## Block 2 — API: category and range filter on the expense list

**Files**
- `apps/api/src/groups/application/ports/group-expense-repository.ts` (modified) — `ListExpensesQuery`
  gains `categoryIds?: readonly string[]`, `from?: Date`, `to?: Date`.
- `apps/api/src/groups/application/list-group-expenses.ts` (modified) — passes the filters on.
- `apps/api/src/groups/infrastructure/db/drizzle-group-expense-repository.ts` (modified) — `listExpenses`
  adds the conditions.
- `apps/api/test/groups/expense-fakes.ts` (modified) — the fake applies the same filters.
- `apps/api/test/groups/group-expense-filter.test.ts` (new) — use case and route tests.
- `apps/api/test/groups/drizzle-group-expense-repository.test.ts` (modified) — database cases.

**Logic**
The use case checks membership first (`GroupAccess.member`), then calls `listExpenses(groupId, ...)` with
the filters converted as `ListPersonalShares` does for its range. The adapter adds, to the existing
`group_id` condition, `category_id in (...)` when `categoryIds` is present (Drizzle `inArray`, parameterized),
`occurred_at >= from` and `occurred_at <= to`. The order stays `occurred_at desc, id desc` and the keyset
cursor stays a pure position, so a page of a filtered list continues the same filter (AC-04). The route is
unchanged: the query schema of Block 1 is what it validates. No migration.

**Data model**
- No change. The read uses the existing index `group_expenses_group_occurred_idx` on `(group_id,
  occurred_at desc, id desc)`; `category_id` is a not null foreign key to `group_categories`, so every
  filtered row has a category. No migration, no default added.

**API contract**
- Method + path: `GET /groups/:id/expenses`
- Request: params `id` (UUID); query `limit?`, `cursor?`, `categoryIds?` (comma-separated UUIDs), `from?`,
  `to?` (ISO instants)
- Response: 200 `groupExpensePageSchema`, newest first, only expenses whose category is in the list and whose
  `occurredAt` is within `[from, to]`
- Error codes: `VALIDATION_FAILED` 400, not found 404 (non-member and unknown group), 401 with no session
- Auth: session cookie and verified email; any member of the group

**Input validation**
- Block 1's `listGroupExpensesQuerySchema` through the shared validation middleware; the cursor keeps its
  existing decoding.

**Error handling**
- A non-member and an unknown group are the same `ResourceNotFound`, so 404, never 403.
- An invalid filter never reaches the use case.

**Required tests**
- [ ] With 3 categories and expenses in 2 months, `categoryIds` of one category plus a month range returns
  only its expenses of that month, newest first — validates AC-25.
- [ ] Two categories in `categoryIds` return the union, and the cursor of page 1 continues page 2 of the same
  filter without repeating or skipping an expense — validates AC-04.
- [ ] `from` and `to` are inclusive: an expense at exactly `from` and one at exactly `to` are returned, one
  millisecond outside is not — validates AC-25.
- [ ] Without filters the list is exactly as before (regression) — validates AC-05.
- [ ] A non-UUID id, a reversed range and a 367-day range answer 400 and the repository is not called —
  validates AC-06, AC-27.
- [ ] A non-member and a stranger's group id get 404 on the filtered list, and a valid UUID of another
  group's category returns an empty page, not an error — validates AC-28, NFR-06.
- [ ] A request with no session is 401 — invalid input.

**Completion criterion**
The API tests pass, `pnpm typecheck` is clean and the list route still returns the same shape for an
unfiltered request.

## Block 3 — API: group expense summary

**Files**
- `apps/api/src/groups/application/ports/group-expense-summary-reader.ts` (new) — port
  `GroupExpenseSummaryReader.summarize(groupId, {from, to})` returning rows
  `{currency, categoryId, total: bigint, count: number}`.
- `apps/api/src/groups/infrastructure/db/drizzle-group-expense-summary-reader.ts` (new) — the adapter.
- `apps/api/src/groups/application/summarize-group-expenses.ts` (new) — the use case.
- `apps/api/src/groups/infrastructure/http/group-expense-summary-presenter.ts` (new).
- `apps/api/src/groups/infrastructure/http/group-routes.ts` (modified) — the route, registered before
  `/groups/:id/expenses/:expenseId`; the adapter and use case are built beside the others.
- `apps/api/src/groups/index.ts` (modified) — export the use case if the module barrel exports its siblings.
- `apps/api/test/groups/summary-fakes.ts` (new), `apps/api/test/groups/group-expense-summary.test.ts` (new),
  `apps/api/test/groups/group-expense-summary-routes.test.ts` (new),
  `apps/api/test/groups/drizzle-group-expense-summary-reader.test.ts` (new),
  `apps/api/test/perf/group-expense-summary.perf.test.ts` (new).

**Logic**
The adapter runs one aggregate over `group_expenses`: `where group_id = $1 and occurred_at between from and
to group by currency, category_id`, selecting `sum(amount)::text` (PostgreSQL `numeric`, so no overflow) and
`count(*)`; it converts the text with `BigInt`. The use case checks membership (`GroupAccess.member`), reads
the rows, builds per currency the category lines ordered by total desc then `categoryId` asc, computes the
currency `total` and `count` as the sum of its lines in `bigint`, orders currencies ARS then USD, then loads
`groups.listCategories(groupId)` and keeps those named by a line (archived ones included). The presenter turns
every `bigint` into a string. Nothing is cached: each request reads the table, so an edit or a delete shows
in the next response (AC-29). Currencies are keyed separately and never added together (FR-06).

**Data model**
- No change and no migration. The aggregate reads `group_expenses` (`amount` bigint not null with check
  `amount > 0`, `currency` check in `ARS`/`USD`, `category_id` not null foreign key) through the existing
  index `group_expenses_group_occurred_idx`; nothing is written and nothing is cached.

**API contract**
- Method + path: `GET /groups/:id/expenses/summary`
- Request: params `id` (UUID); query `from` and `to` (ISO instants, both required, `from <= to`, span at most
  366 days)
- Response: 200 `groupExpenseSummaryResponseSchema` (D2): `currencies[]` with `currency`, `total`, `count`,
  `categories[]` (`categoryId`, `total`, `count`), and top-level `categories[]`
- Error codes: `VALIDATION_FAILED` 400, not found 404 (non-member, unknown group), 401 with no session
- Auth: session cookie and verified email; any member of the group

**Input validation**
- `groupIdParamsSchema` and `groupExpenseSummaryQuerySchema` (Block 1) through the shared validation
  middleware; the response is typed with `groupExpenseSummaryResponseSchema`.

**Error handling**
- A non-member and an unknown group are 404, never 403; a range error is 400 before any read; a database
  failure is the existing 500 mapping, with no partial body.

**Required tests**
- [ ] A month with ARS and USD expenses in 3 categories returns two currency blocks, each with its own lines
  and total, and no amount from one appears in the other — validates AC-26, AC-13.
- [ ] Lines are ordered by total desc, and equal totals by `categoryId` asc — validates AC-12.
- [ ] Over 1,000 random sets of expenses (seeded), for each currency the lines add up to the currency total,
  the currency total equals the sum of its expenses computed independently in `bigint`, and `count` equals the
  number of expenses — validates NFR-03, AC-26.
- [ ] More than 50 expenses in the range are all counted (not a page) — validates AC-26.
- [ ] An archived category with expenses keeps its line and appears in `categories` with `archivedAt` set —
  validates AC-18.
- [ ] After an expense is edited and after one is deleted, the next summary reflects both — validates AC-29.
- [ ] A reversed range, a 367-day range, a missing `from` and a non-UUID group id answer 400 and the reader is
  not called — validates AC-27.
- [ ] A non-member and an unknown group get 404 for the same body shape, and a request with no session is
  401 — validates AC-28, NFR-06.
- [ ] A group with no expenses in the range returns `currencies: []` — validates AC-16.
- [ ] The benchmark seeds 5,000 expenses in a group, runs 20 summaries and asserts p95 below 300 ms, run with
  `pnpm test:perf` — validates NFR-04.

**Completion criterion**
The API tests pass, `pnpm --filter ./apps/api test:perf group-expense-summary` passes, and the route returns
200 with string sums for a seeded group.

## Block 4 — Web api-client methods

**Files**
- `apps/web/src/lib/api-client.ts` (modified) — `listGroupExpenses` accepts the new query keys and
  `getGroupExpenseSummary(groupId, {from, to})` is added to the interface and the implementation.
- `apps/web/test/api-client-group-expenses.test.ts` (modified) — filter cases.
- `apps/web/test/api-client-group-expense-summary.test.ts` (new).

**Logic**
`listGroupExpenses` builds the query with `URLSearchParams` and joins `categoryIds` with commas. Both
methods validate the query with the Block 1 schemas before sending and the answer with
`groupExpensePageSchema` and `groupExpenseSummaryResponseSchema`. They go through `onGroup` (which encodes
and validates the group id) and `request` with `refreshOnUnauthenticated: true`, as their siblings do.
Failures reuse the existing key mapping.

**Input validation**
- A malformed group id, a non-UUID category id, a reversed range, a range above 366 days and a missing bound
  of the summary are a local `VALIDATION_FAILED` and send no request (AC-06).

**Error handling**
- A response that does not match its schema is a generic failure, never partial data; 404 is `NOT_FOUND`;
  401 is retried once through the existing refresh.

**Required tests**
- [ ] `listGroupExpenses` with `categoryIds`, `from` and `to` calls `GET /groups/:id/expenses` with the
  encoded query — validates AC-04.
- [ ] `getGroupExpenseSummary` calls `GET /groups/:id/expenses/summary?from&to` and returns the parsed
  answer with string totals — validates AC-26.
- [ ] A response with a numeric total or an unknown currency is a failure with no data — validates AC-26.
- [ ] A non-UUID category id, a reversed range and a malformed group id are rejected before any request —
  validates AC-06, AC-27.
- [ ] A 404 is `NOT_FOUND` for both methods — validates AC-28.

**Completion criterion**
The api-client tests pass and typecheck is clean.

## Block 5 — Pure view logic: categories, months and summary lines

**Files**
- `apps/web/src/features/groups/category-views/types.ts` (new) — `CategoryDisplay`, `SummaryView`,
  `SummaryLine`, `MonthOption`.
- `apps/web/src/features/groups/category-views/resolve-category.ts` (new) — id to `CategoryDisplay`.
- `apps/web/src/features/groups/category-views/months.ts` (new) — current month, offered months, bounds.
- `apps/web/src/features/groups/category-views/summary-view.ts` (new) — response to view, shares, filtered
  totals.
- `apps/web/src/features/groups/category-views/format.ts` (new) — `formatMonth`, `formatShare`.
- `apps/web/test/group-category-views-logic.test.ts`,
  `apps/web/test/group-category-views-logic.property.test.ts` (new).

**Logic**
`resolveCategory(id, categories, language)` returns `{id, label, icon, color, archived, known}` using
`groupCategoryLabel` for the name, and for an id not in the list a neutral icon, a neutral color and the
`uncategorized` marker with `known: false` (D7). `months.ts`: `currentMonth(now, timeZone)` (`YYYY-MM`,
through `dateInTimeZone`), `offeredMonths(now, timeZone)` returning the current month and the 120 before it,
newest first (no future month, none older than 10 years, AC-09), and `monthBounds(month, timeZone)` returning
`{from, to}` as ISO instants of the first instant of the month and one millisecond before the next month,
both through `zonedLocalToInstant` (AC-08). `summary-view.ts`: `buildSummaryView(response, language)` returns
per currency the lines `{key, categoryIds, display, total, count, shareBasisPoints}`; shares are
`total * 10000n / currencyTotal` rounded half up in `bigint` (D6), the lines are ordered by total desc then
by label (locale-aware, AC-12), a line of an archived category carries `archived`, and every line whose id is
missing from `response.categories` is merged into one "No category" line carrying its ids (D7, AC-21).
`filteredTotals(view, categoryIds)` returns per currency the `bigint` sum and count of the selected lines
(D10). `formatMonth` and `formatShare` use `Intl` with the active locale. Money stays `bigint` and strings.

**Input validation**
- The module receives responses already validated by Block 4; an empty `currencies` yields an empty view and
  a currency total of 0 yields lines with a 0 share, never a division by zero.

**Error handling**
- Pure functions: no I/O, no throw on well-formed input; an id missing from the categories is the fallback,
  never the raw id.

**Required tests**
- [ ] A default-key category without a name resolves to its translated default name; a named one to its own
  name — validates AC-02.
- [ ] A category with an icon and a color resolves to both, and an archived one is marked — validates AC-01,
  AC-18.
- [ ] An id that is not in the list resolves to the neutral icon, neutral color and the uncategorized label —
  validates AC-20.
- [ ] `offeredMonths` starts at the current month in the user's zone (a time just after local midnight on the
  last day of a month, in `America/Argentina/Buenos_Aires`, is still that month), has 121 entries and no
  future month — validates AC-07, AC-09.
- [ ] `monthBounds` of a 31-, 30- and 28/29-day month runs from the first to the last instant of the month in
  the zone, so an expense at 23:59 local on the last day is inside and one at 00:00 of the next is not —
  validates AC-08.
- [ ] Each currency has its own lines and total, never summed together — validates AC-13, AC-11.
- [ ] Lines are ordered by total desc and equal totals by name in Spanish and in English — validates AC-12.
- [ ] Shares are integer basis points that follow `total * 10000 / currencyTotal`; for 1,000 random sets
  every share is within 1 basis point of the exact ratio, a line with the whole total is 10000 and a 0 total
  does not divide — validates AC-10, NFR-03.
- [ ] Lines with ids missing from the categories become one "No category" line per currency with the sum of
  its parts — validates AC-21.
- [ ] `filteredTotals` for one category equals that summary line's total and count, and for two categories
  the sum per currency — validates AC-15.
- [ ] `formatMonth` and `formatShare` render in es and en with the locale's separators — validates AC-22.
- [ ] The new files contain no `parseFloat`, `toFixed` or `Number(` on a total, an amount or a count —
  scan, validates NFR-03.

**Completion criterion**
The logic tests pass and typecheck is clean.

## Block 6 — Presentational components and base catalog keys

**Files**
- `apps/web/src/features/groups/category-views/components/category-chip.tsx` (new).
- `apps/web/src/features/groups/category-views/components/category-filter.tsx` (new).
- `apps/web/src/features/groups/category-views/components/month-picker.tsx` (new).
- `apps/web/src/features/groups/category-views/components/category-summary.tsx` (new) — the per-currency
  blocks, lines and bars.
- `apps/web/src/features/groups/category-views/components/active-filter-chips.tsx` (new) — removable chips
  and the clear action.
- `apps/web/test/group-category-views-components.test.tsx` (new).
- `apps/web/messages/en.json`, `apps/web/messages/es.json` (modified) — `groups.categoryViews.chip`,
  `.filter`, `.month` and `.summary` keys.

**Logic**
All pure, props in and callbacks out, no data fetching. `CategoryChip({display, size})` renders
`CategoryVisual` (smaller class override), the name as text that wraps and the archived marker as text with
an icon when `display.archived`. `CategoryFilter` is a group of toggle buttons with `aria-pressed`, each a
chip; it lists what it is given (D8 is the container's job). `MonthPicker` is a native `select` with a label
plus previous and next buttons disabled at the limits. `CategorySummary` renders per currency a heading with
the currency, the total on its own line (AC-11) and a list; each line is a button (when `onSelect` is given)
with the chip, the formatted amount, the percentage as text and a bar (`div` with `bg-primary` on a `bg-muted`
track, width from basis points) that is `aria-hidden` because the text carries the same information (D11).
`ActiveFilterChips` shows each selected category as a chip with a remove button and a "clear" button. Strings
come from props produced with `useTranslations` inside the component files; no literal text.

**Input validation**
- Not applicable: presentational components receive typed props and render values as React text only; no
  `dangerouslySetInnerHTML`.

**Error handling**
- A bar with 0 basis points renders width 0 and its text; an empty list renders nothing and the container
  decides the empty state.

**Required tests**
- [ ] The chip shows icon, color class and name, and the archived marker as text — validates AC-01, AC-18,
  AC-23.
- [ ] The neutral fallback chip shows a neutral icon, the uncategorized label and no raw id — validates
  AC-20.
- [ ] The filter toggles one or several categories through callbacks and the active ones are
  `aria-pressed` — validates AC-04.
- [ ] Removing a chip and "clear" call their callbacks — validates AC-05, AC-14.
- [ ] The month picker lists the offered months, none in the future, and its previous and next buttons stop
  at the limits — validates AC-07, AC-09.
- [ ] The summary shows for each line the amount and the percentage as text and a bar; the currency total
  is shown apart in the same currency; two currencies render two separate lists — validates AC-10, AC-11,
  AC-13, AC-23.
- [ ] A text-and-icon check: no component marks a state by color alone, and the files contain no hex or `rgb`
  value (design-token scan) — validates AC-23, AC-24.
- [ ] A name with markup (`<img src=x onerror=alert(1)>`) renders as literal text — invalid input.
- [ ] Spanish and English render with no hardcoded string — validates AC-22.

**Completion criterion**
The component tests pass, the design-system scan passes and typecheck is clean.

## Block 7 — Expense list: chips, filters and states

**Files**
- `apps/web/src/features/groups/expenses/list/expense-row.tsx` (modified) — `category: string` becomes
  `category: CategoryDisplay` rendered with `CategoryChip`.
- `apps/web/src/features/groups/expenses/list/group-expenses-list.tsx` (modified) — filtered-empty state,
  filtered total header.
- `apps/web/src/features/groups/expenses/list/group-expenses-container.tsx` (modified) — accepts
  `range` and `categoryIds` props, passes them to `listGroupExpenses`, resolves each row's category.
- `apps/web/src/features/groups/expenses/list/expenses-empty-state.tsx` (modified) — month-empty variant.
- `apps/web/test/group-expenses-list.test.tsx` (modified) — new cases, request counts.
- `apps/web/messages/en.json`, `apps/web/messages/es.json` (modified) — `groups.categoryViews.list` keys.

**Logic**
The container takes `GroupExpensesContainerProps {groupId, range, categoryIds, filteredTotals?, onClearFilter?,
onLoadedOptions?}`. The first load keeps its 3 requests (D4), now with the filters in the page request. When
`range` or `categoryIds` change, only the first page is requested again (1 request) under the existing
generation guard, so a late answer from the previous filter is dropped; "load more" keeps the same filters
and the cursor of the previous answer. Each row's category is `resolveCategory(expense.categoryId,
options.categories, language)` (FR-01, FR-10), so an unknown id shows the neutral fallback. `onLoadedOptions`
hands the categories to the page container for the filter list. An empty page with no filter shows the
month-empty state (AC-16, with the add action); an empty page with a filter shows "nothing matches" with a
clear-filter action (AC-17). While a filter is active the list shows the filtered total of D10 above the rows
(AC-15). The 05h overlay, markers, actions and sync reload are untouched.

**Input validation**
- None new: the filters are built by Block 9 from the picker and the options, and validated again by the
  api-client (Block 4).

**Error handling**
- A failed filtered page shows the existing load-failed state with retry; a failed reload after a filter
  change keeps the rows on screen and shows the error once; a 404 shows not-found.

**Required tests**
- [ ] Each row shows its category's icon, color and name, and a category without a name shows the translated
  default name — validates AC-01, AC-02.
- [ ] A row whose category is archived shows the archived marker; an unknown category id shows the neutral
  fallback — validates AC-18, AC-20.
- [ ] The first load makes exactly 3 requests, and a change of month or category makes exactly 1 more — validates
  NFR-02.
- [ ] A category filter sends `categoryIds` and the range to the list, "load more" keeps them and uses the
  previous cursor, and clearing the filter requests the month again — validates AC-04, AC-05, AC-08.
- [ ] A late answer of the previous filter does not replace the current rows — validates AC-04.
- [ ] A month with no expenses shows the month-empty state; a filter with no match shows "nothing matches"
  and its clear action calls the callback — validates AC-16, AC-17.
- [ ] With a filter active the filtered total above the list equals the string given from the summary —
  validates AC-15.
- [ ] A failed page after a filter change shows the error and keeps the previous rows — invalid input,
  validates AC-30.
- [ ] Spanish and English render with no hardcoded string — validates AC-22.
- [ ] The existing 05f and 05h list tests still pass with the request count updated — regression.

**Completion criterion**
The list tests pass, the other expense tests pass and typecheck is clean.

## Block 8 — Summary section container

**Files**
- `apps/web/src/features/groups/category-views/summary-container.tsx` (new).
- `apps/web/test/group-category-summary.test.tsx` (new).
- `apps/web/messages/en.json`, `apps/web/messages/es.json` (modified) — `groups.categoryViews.summarySection`
  keys.

**Logic**
`CategorySummaryContainer({groupId, range, selectedCategoryIds, onSelectCategory, onLoaded})` calls
`getGroupExpenseSummary(groupId, range)` once per `groupId` and `range` (D4), builds the view with
`buildSummaryView`, renders `CategorySummary` and reports the view up through `onLoaded` so the page can
offer archived categories (D8) and compute filtered totals (D10). While loading it shows a skeleton text; on
failure it shows the error text with a retry button and nothing else is blocked (AC-30). A month with no
`currencies` shows the month-empty state (AC-16). A tap on a line calls `onSelectCategory(categoryIds)`; the
selected lines are marked with `aria-pressed` and a text marker. Amounts use `formatMoney(BigInt(total),
currency, language)`; no `Number` touches a total.

**Input validation**
- `groupId` is checked by `isGroupId`; anything else is the not-found state with no request.

**Error handling**
- 404 shows not-found; 401 goes to sign-in; any other failure shows the error and retry, once per click; an
  answer that is stale (a newer range was requested) is dropped.

**Required tests**
- [ ] The section makes exactly 1 request on load and 1 on a month change — validates NFR-02.
- [ ] With ARS and USD expenses it shows two lists, each with its total in its own currency and no summed
  amount — validates AC-10, AC-11, AC-13.
- [ ] The lines are in the order of the view and show amount and percentage as text — validates AC-12,
  AC-23.
- [ ] An archived category line shows its icon, name and the archived marker; an unknown one is merged into
  "No category" — validates AC-18, AC-21.
- [ ] A month with no expenses shows the month-empty state — validates AC-16.
- [ ] Tapping a line calls `onSelectCategory` with its ids — validates AC-14.
- [ ] A failed request shows the error with a retry that requests again, and the page's list is not touched —
  validates AC-30.
- [ ] A 404 shows not-found, a 401 goes to sign-in and a malformed group id shows not-found with no request —
  invalid input.
- [ ] An answer for an older month arriving late is dropped — invalid input.
- [ ] Spanish and English render with no hardcoded string and months and percentages in the locale — validates
  AC-22.

**Completion criterion**
The summary tests pass and typecheck is clean.

## Block 9 — Page composition and the route

**Files**
- `apps/web/src/features/groups/category-views/group-expenses-page.tsx` (new) — the container that owns the
  month and the filter.
- `apps/web/src/app/[locale]/(app)/groups/[id]/expenses/page.tsx` (modified) — renders the page container.
- `apps/web/test/group-expenses-page.test.tsx` (new).
- `apps/web/messages/en.json`, `apps/web/messages/es.json` (modified) — `groups.categoryViews.page` keys.

**Logic**
`GroupExpensesPage({groupId})` (guarded by `isGroupId`) keeps `month` (default `currentMonth(new Date(),
timeZone)`, AC-07) and `categoryIds` (D5) in state, computes `range = monthBounds(month, timeZone)`, and renders
in order: `MonthPicker`, `CategorySummaryContainer`, the filter (`CategoryFilter` built from the options'
categories that are active plus the archived ones that have a line in the loaded summary, D8, with the
active chips), and `GroupExpensesContainer` with `range`, `categoryIds`, `filteredTotals` and the clear
callback. Choosing another month clears the filter's archived-only ids that no longer have expenses and
reloads the list and the summary (AC-08). Tapping a summary line replaces the filter with that category and
shows its removable chip (AC-14). A month the picker does not offer is never set (AC-09). The page keeps the
add-expense action and the back link of the existing screen.

**Input validation**
- `groupId` through `isGroupId`; the month comes only from the picker's own options, the category ids only
  from the loaded categories and summary lines, so no free text becomes a query.

**Error handling**
- The summary and the list fail independently: each shows its own error and retry (AC-30); the picker and the
  filter stay usable.

**Required tests**
- [ ] On open the current month in the user's zone is selected and both the list and the summary request its
  bounds — validates AC-07, AC-08.
- [ ] Choosing another month reloads both with that month's bounds and the future and older-than-10-years
  months are not offered — validates AC-08, AC-09.
- [ ] Choosing one or several categories shows only their expenses, and clearing the filter shows the month
  again — validates AC-04, AC-05.
- [ ] Tapping a summary line filters the list by that category and month, shows the removable chip and the
  filtered total equals the summary line's — validates AC-14, AC-15.
- [ ] An archived category appears in the filter only when the month's summary has a line for it —
  validates AC-19.
- [ ] A summary failure leaves the list working and offers retry — validates AC-30.
- [ ] The first load makes 4 requests in total (3 list, 1 summary) and a month change makes 2 — validates
  NFR-02.
- [ ] A malformed group id shows not-found with no request — invalid input.
- [ ] Spanish and English render with no hardcoded string — validates AC-22.

**Completion criterion**
The page tests pass, the other expense and group tests pass and typecheck is clean.

## Block 10 — Category chip on the expense screen

**Files**
- `apps/web/src/features/groups/expenses/edit/expense-edit-view.tsx` (modified) — the chip above the form.
- `apps/web/src/features/groups/expenses/edit/expense-edit-container.tsx` (modified) — resolves the category
  with `resolveCategory` from the loaded options and passes it.
- `apps/web/test/group-expense-edit.test.tsx` (modified) — new cases.
- `apps/web/messages/en.json`, `apps/web/messages/es.json` (modified) — `groups.categoryViews.detail` keys.

**Logic**
The edit screen already loads the expense and the options (3 requests, 05h D4). It resolves the expense's
current category from the options and renders a read-only `CategoryChip` with a short label ("Category")
above the form, so the screen shows icon, color and name (D9). An archived or unknown category shows the
marker or the neutral fallback. The category select and every other field are unchanged, and no request is
added.

**Input validation**
- None new.

**Error handling**
- A category missing from the options is the neutral fallback, never a raw id; no new failure path.

**Required tests**
- [ ] The screen shows the expense's category icon, color and name above the form — validates AC-03.
- [ ] An archived category shows the archived marker and an unknown id the neutral fallback — validates
  AC-18, AC-20.
- [ ] The screen still makes exactly 3 requests on load and the form fields are unchanged — validates
  NFR-02.
- [ ] Spanish and English render the chip label with no hardcoded string — validates AC-22.
- [ ] An invalid category id missing from the options shows the neutral fallback and no error — validates
  AC-20.
- [ ] The existing 05h edit tests still pass — regression.

**Completion criterion**
The edit tests pass and typecheck is clean.

## Block 11 — End-to-end checks and final scans

**Files**
- `apps/web/e2e/group-category-views.spec.ts` (new).
- `apps/web/e2e/support/group-category-views.ts` (new) — helpers over the existing `support/groups.ts`.
- `apps/web/test/group-category-views-scans.test.ts` (new) — source scans.

**Logic**
One Playwright spec with two members. It creates a group, adds expenses through the API helpers in ARS and
USD, in this month and in the previous one, in three categories (one archived). It checks: the rows show the
chips; the summary shows two currency lists with text amounts and percentages; tapping a line filters the
list and shows the chip and the matching total; choosing the previous month reloads both; a month without
expenses and a filter without matches show their states; a non-member gets not-found on the page. A test at
360 px opens the expenses page with the summary, the filter, the empty states and the error state and asserts
no horizontal scroll. A request counter asserts the budgets of D4. The scans read the new folders: no
`dangerouslySetInnerHTML`, no `parseFloat`, `toFixed` or `Number(` on a total, amount or count (only
`formatShare` may convert a basis-point number), no hex, `rgb` or `hsl` literal, no dependency added to any
`package.json`, no new file in `apps/api/drizzle`.

**Input validation**
- Not applicable: the spec and the scans take no input.

**Error handling**
- The spec resets attempt limits before each test as the existing specs do and runs one e2e at a time
  (project rule).

**Required tests**
- [ ] Rows show icon, color and name, an archived category is marked, and the detail screen shows the same
  chip — validates AC-01, AC-03, AC-18.
- [ ] The summary of the current month shows ARS and USD as separate lists ordered by total with text amounts
  and percentages — validates AC-10, AC-11, AC-12, AC-13, AC-23.
- [ ] Tapping a summary line filters the list, shows the removable chip and the same total; clearing it
  restores the month — validates AC-05, AC-14, AC-15.
- [ ] Choosing the previous month reloads list and summary; a month with no expenses and a filter with no
  match show their states — validates AC-08, AC-16, AC-17.
- [ ] A user who is not in the group gets not-found on the expenses page — validates AC-28.
- [ ] A summary edit is reflected after the author edits an expense and reloads — validates AC-29.
- [ ] The expenses page with the summary, the filter, the empty states and the error state fits 360 px
  without horizontal scroll — validates NFR-01.
- [ ] The first load makes at most 3 requests for the list and 1 for the summary, and a filter change makes
  1 — validates NFR-02.
- [ ] The Spanish and English catalogs have the same keys, none empty, and the page renders in both —
  validates NFR-05, AC-22.
- [ ] The source scans find no float on money, no hardcoded color, no new dependency and no migration —
  validates NFR-03, AC-24.

**Completion criterion**
The spec and the scans pass, and the full web and API suites and the coverage thresholds pass.

## Final verification
- Every AC (AC-01 to AC-30) and NFR (NFR-01 to NFR-06) has a test; every input has a sad-path test.
- `pnpm typecheck`, eslint and Prettier on touched files pass; the full API and web suites, `pnpm test:perf`
  for the summary benchmark and the coverage floor of 80% pass.
- No migration was added and no dependency was added; the API changes are the `categoryIds`, `from` and `to`
  filters of `GET /groups/:id/expenses` and the new `GET /groups/:id/expenses/summary`.
- Rollback: revert the ticket's commits; there is no migration to reverse and no stored data to repair.
- Every total and count travels as a string and is summed in `bigint`; no money value goes through a float.
- The design-system scan and accessibility tests pass for the new screens (labels, tokens only, icon and text
  next to every color).
- Owner ratification items: (1) the "detail" of FR-02 is the edit screen, because no read-only detail route
  exists (D9); (2) the summary section makes 1 request and the page 4 on first load, below the PRD's
  per-section budgets (D4); (3) month and filter live in component state, not in the URL (D5).

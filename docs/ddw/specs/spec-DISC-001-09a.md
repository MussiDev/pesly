# Spec DISC-001-09a: Reports API

| Field | Value |
|-------|-------|
| Ticket | DISC-001-09a |
| PRD | docs/ddw/prd/prd-DISC-001-09a.md |
| Tier | FEATURE |
| Date | 2026-10-12 |
| Spec loops | 0 |
| Loops since last human decision | 0 |

## Summary
A new `reports` module in `apps/api` serves three read-only reports behind `requireSession` and
`requireVerifiedEmail`: expenses by top-level category, income against expenses per month, and net worth
per month end. Flows are read with aggregated SQL grouped by month, top-level category, currency and the
frozen rate of each movement, then converted in `bigint` with `convertMinorUnits` from `packages/shared`, the
06c rule; the caller's group shares and the credit card installments are added from their own aggregated
reads. Net worth is rebuilt from four sources, each one statement bucketed by month in the user's time zone:
the opening balances plus the signed movements and settlement payments of the non-archived accounts, the
latest daily portfolio snapshot per portfolio, the user's group balance, and the pending installment debt;
the USD part of a past point is converted with a month-end rate read from a new history table. One migration,
0038, adds `exchange_rate_history`, seeded from the rates stored today and written by the existing refresh.
No screen, no dashboard route, no new runtime dependency and no external call are part of this ticket.

## Design decisions
- D1: Module shape (FR-16, NFR-04). `apps/api/src/reports/` follows the hexagonal layout of AGENTS.md:
  `domain/` (pure rules), `application/` (use cases and ports), `infrastructure/` (Drizzle readers, clock,
  routes). The module reads the tables of other modules only through its own
  `infrastructure/db/foreign-relations.ts`, the same pattern as `budgets/infrastructure/db/foreign-relations.ts`,
  and imports no application or domain file of another module. Domain and application import nothing from
  infrastructure. The module holds no process state and calls no external service.
- D2: Contract (FR-01 to FR-05). Three routes under `/reports`, all read-only: expenses by category, income
  and expenses, net worth. The query takes `from` and `to` (local `YYYY-MM-DD`), plus `accountId` and `tag`
  on the first two; the net worth query is strict and refuses filters. Every amount is an exact integer
  string in minor units of the display currency, except the two components of a net worth point, which are
  in their own currencies. The response schemas live in `packages/shared/src/reports/report.ts` and every
  route sends through `validate({ response })`.
- D3: Errors without a new code (FR-02). A bad range answers `VALIDATION_FAILED` (400) with `fields`
  (`query.from`, `query.to`) and, when the range is too long, `details.maxMonths` as `"24"` or `"12"`, which is
  how the response states the limit. A foreign or unknown account or tag answers `NOT_FOUND` (404) through
  `ResourceNotFound`. No `ErrorCode` is added, because `MESSAGE_KEY_BY_CODE` in `apps/web/src/lib/api-client.ts`
  is exhaustive and the screens (09d) own their wording. Needs the owner's confirmation.
- D4: Range rules (FR-02, FR-03, FR-15). `resolveReportRange` in `packages/shared` takes the optional `from`
  and `to`, today in the user's zone, the limit of the report and its default window. With no `to`, `to` is
  today; with no `from`, `from` is the first day of the month that is `defaultMonths - 1` months before the
  month of `to` (12 for income and expenses and for net worth, 1 for the category report). The limit counts the
  calendar months the range touches (24, 24 and 12). `to` after today, `from` after `to` and a range over the
  limit are 400. The default windows for the category and net worth reports are not in the PRD and need the
  owner's confirmation.
- D5: Day boundaries (FR-05). `from` is the start of its local day and the upper bound is the start of the
  local day after `to`, as a half-open interval of instants (`[from, before)`), computed with
  `zonedLocalToInstant` and the first valid hour when a clock change skips midnight. Months are bucketed in
  SQL with `to_char(<timestamptz> at time zone <zone>, 'YYYY-MM')`, the zone bound as a parameter, so a
  movement at 01:00 UTC on 1 July in Buenos Aires belongs to June.
- D6: Personal flows (FR-06, FR-07). One aggregated read over `movements` joined to `accounts` returns rows
  `(month, type, top category id, currency, frozen rate, sum, count)` for `expense` and `income` movements
  only, so transfers and exchanges never count. The top-level category is `coalesce(categories.parent_id,
  categories.id)`. The payer movement of a group expense is left out with the same `not exists` probe that
  06c uses. The conversion is `convertAmount` of 06c (same currency: unchanged; otherwise
  `convertMinorUnits` with the frozen rate of the group), applied once per row, so the rounding equals the
  budgets'. The conversion helpers are copied into `reports/domain/conversion.ts` instead of imported from
  budgets, and a parity test runs the same fixture through both modules.
- D7: Group shares (FR-07). One read with the 06c query shape, bucketed by month: the caller's member rows,
  their shares of group expenses, and the rate of the caller's own payer movement when they paid. A share goes
  to the personal top-level category whose effective names (its own and its children's, the 06c rule) match
  the group category name case-insensitively; ties go to the earliest created category. A share that matches
  none goes to one row with a null category id. A share in another currency with no frozen rate is left out
  and counted by its `count(*)`, so the response counts shares and not rows of the grouping (06c counts rows;
  this is stricter and needs the owner's confirmation).
- D8: Installments in flows (FR-08). A read over `installments`, `installment_purchases`, `credit_cards` and
  a left join to `credit_card_statements` returns rows `(period, stored due date or null, card closing and
  due days, top category id, currency, sum, count)` for the periods within two months of the range. The due
  date is the stored one or `statementDatesFor` of `packages/shared`; an installment counts in the month of its
  due date when that date is inside `[from, to]`, in the category of its purchase. One in another currency is
  left out and counted, because installments store no frozen rate. With an account or a tag filter both the
  shares and the installments are not read.
- D9: Filters and ownership (FR-05, FR-16). `accountId` and `tag` are checked before any report read: the
  account must be the caller's, the tag name is compared with `lower()` against the caller's tags, and either
  failing is 404, the same answer for a foreign and for a missing one. The account filter keeps the
  movements whose own account is the one named; the tag filter is the `movement_tags` subquery of the movements
  list, with the owner on every table. Every read takes the issued `AccessScope`, applies `scopedTo` or the
  user id in its WHERE, and the group reads start from the caller's member rows.
- D10: Rate history (FR-14). Table `exchange_rate_history`: primary key `(rate_type, rate_date)`, `buy` and
  `sell` bigint, `recorded_at`. `rate_date` is the Argentina calendar date of the fetch, computed with
  `dateInTimeZone(fetchedAt, 'America/Argentina/Buenos_Aires')`. `DrizzleRateRepository.replaceAll` runs its
  upsert of `exchange_rates` and the upsert of the history in one transaction, the second with
  `ON CONFLICT (rate_type, rate_date) DO UPDATE`, so the last values of a day win. The migration seeds one row
  per stored rate type from `exchange_rates`, dated by `fetched_at`. A past month end is compared with
  `rate_date` as plain dates, so the Argentina date of the rate and the user's local date are assumed equal
  (the product targets Argentina; a user in another zone can be off by one day).
- D11: Account part (FR-09). One statement per source over the owner's non-archived accounts: signed source
  effects of movements (`income` positive, every other type negative), destination amounts of transfers and
  exchanges, and settlement payments by the `account_member_id` rule of the accounts module (positive for the
  receiving member, negative for the paying one), each tagged with currency and a month bucket, `null` for
  everything before the range. The opening balance of every non-archived account is summed per currency and
  added to the baseline. The application accumulates month by month. A transfer between two included accounts
  of one currency nets to 0; the upper bound is the end of the last point's local day.
- D12: Investments (FR-10). `portfolio_value_snapshots` read once with a lateral join over the point dates:
  the latest snapshot on or before each date per portfolio and currency, summed per currency. A point is
  `investmentsIncomplete` when a portfolio created before the point's end instant has no snapshot on or
  before it. A portfolio created after the point counts 0 and does not mark it.
- D13: Group part (FR-11). One statement over the caller's member rows (former members included, because a
  former member can still hold a balance): expenses paid, minus shares, plus the settlement legs of the
  settlements where the member is the payer, minus those where it is the receiver, each bucketed by
  `occurred_at` in the user's zone, the formula of `memberBalances`. Positive and negative balances are summed
  into one number per currency, and it is converted only with the month-end rate.
- D14: Installment debt (FR-12). Rows `(period, stored closing date or null, card days, purchase month,
  currency, sum)` for purchases with `purchased_on` not after the last point and periods from one month before
  the first point. The pure function subtracts, per point, the rows whose purchase month is not after the
  point's month and whose closing date (stored or derived) is after the point's date. It reads the
  statements as stored now (PRD decision 7).
- D15: Conversion of a point (FR-13, FR-15). The sell rate of the user's default rate type: a past point reads
  the history by a lateral join (`rate_date <=` the point's date, latest first); the current month point,
  dated today, reads `exchange_rates`. With no rate and a non-zero foreign component, the point returns its two
  components, `total` null and `reason` `"no_rate"`; when the foreign component is 0 no rate is needed and the
  total is the home component (a PRD interpretation that needs the owner's confirmation). Display ARS:
  `ars + convertMinorUnits(usd, 'USD', rate)`; display USD: `usd + convertMinorUnits(ars, 'ARS', rate)`.
- D16: Points (FR-04, FR-15). One point per calendar month the range touches, in date order, dated the last
  day of the month, except the current month, dated today.
- D17: Money, dependencies and the network (NFR-02, NFR-03, NFR-04). `bigint` only; sums come back from SQL as
  text and go through `BigInt`; a source scan test bans `parseFloat`, `toFixed`, `Math.round`, `Math.floor` and
  `Number(` in the module, its shared schemas and its tests (`Number.parseInt` and `Number.isInteger` stay
  allowed). No dependency is added to any `package.json`. A test asserts that no report request calls
  `fetch` or opens a socket, and a scan keeps the reports module off the rates provider and job files.
- D18: Performance (NFR-01). No precomputed snapshot (PRD decision 15). The flow reads are single
  aggregates over `movements_owner_date_idx`; the account part is one scan of the owner's movements before
  the end bound (100,000 rows aggregated in the database, never in the application); every other source is
  one statement. The benchmark seeds 100,000 movements spread over 24 months; if a report misses 2 s at p95
  the block reports the measured value and the options (an index, a snapshot table) go back to the owner.
- D19: Migration 0038 (NFR-03). `0038_exchange_rate_history`: create the table and its checks, then a seed
  `INSERT ... SELECT` appended by hand to the generated file. Journal `idx` 38, `when` 1791820000000 (the
  maximum on `main` is 1791810000000 for 0037); it must exceed the maximum on `main` at merge time and the
  number is provisional and renumbered at merge (the Drizzle merge rule). Rollback script
  `apps/api/drizzle/rollback/0038_exchange_rate_history.down.sql`, idempotent: drops the table and deletes the
  journal row by `created_at`. It is applied before the rollback of 0037.

## Open questions for the owner
1. Default windows when `from` and `to` are omitted on the category report (the current month) and on the net
   worth report (12 months) (D4). The PRD fixes only the income and expenses default.
2. No new error code: the limit travels in `details.maxMonths` of a `VALIDATION_FAILED` (D3).
3. A point with a zero foreign component returns a total without a rate (D15). Literal reading of FR-13: null.
4. Unconverted shares are counted by share, not by grouped row as 06c does (D7).
5. Installments count by the due date inside `[from, to]` (D8); a partial month of the range counts only the
   installments whose due date falls in it.
6. The rate history date is the Argentina date and is compared with the user's local month end as a plain
   date (D10).
7. The group part includes the member rows of groups the user already left (D13).
8. Archived accounts leave net worth (FR-09) but their past movements stay in the flow reports, as in the
   budgets (D6, D11).
9. The conversion helpers are duplicated from budgets, guarded by a parity test, so the two modules stay
   independent (D6).

## Coverage: PRD → blocks
| Requirement | Covered by |
|---|---|
| FR-01 | Block 3, Block 5 |
| FR-02 | Block 0, Block 2, Block 5, Block 7 |
| FR-03 | Block 4 |
| FR-04 | Block 6, Block 7 |
| FR-05 | Block 2, Block 3, Block 4, Block 5 |
| FR-06 | Block 3, Block 4, Block 5 |
| FR-07 | Block 3, Block 4, Block 5 |
| FR-08 | Block 3, Block 4, Block 5 |
| FR-09 | Block 6 |
| FR-10 | Block 6 |
| FR-11 | Block 6 |
| FR-12 | Block 6 |
| FR-13 | Block 7 |
| FR-14 | Block 1 |
| FR-15 | Block 0, Block 7 |
| FR-16 | Block 2, Block 3, Block 6, Block 8 |
| NFR-01 | Strategy: aggregated SQL per source bucketed by month, never a query per month or per row; Block 8 holds the 24-month benchmark over 100,000 movements at p95 under 2 s |
| NFR-02 | Strategy: `bigint` sums read as text, conversion by `convertMinorUnits`, rates as integers scaled by 10,000, integer strings in the responses; Blocks 0, 3, 6 and 7 build it and Block 8 scans for floats |
| NFR-03 | Strategy: one additive migration with an idempotent rollback script (Block 1) and a pinned dependency list (Block 8) |
| NFR-04 | Strategy: the module imports no provider or job and the tests spy on `fetch` and sockets (Block 8) |

| Acceptance criteria | Covered by |
|---|---|
| AC-01, AC-02, AC-03, AC-11 | Block 5 |
| AC-04, AC-05, AC-06 | Block 0, Block 2 |
| AC-07, AC-08, AC-12 | Block 4 |
| AC-09, AC-10 | Block 0, Block 7 |
| AC-13 | Block 2, Block 5 |
| AC-14 to AC-23 | Block 3 (AC-18, AC-19, AC-20, AC-21 and AC-23 also in Block 5, AC-22 also in Block 4) |
| AC-24, AC-25 | Block 3, Block 4, Block 5 |
| AC-26 to AC-36 | Block 6 |
| AC-37 to AC-39 | Block 7 |
| AC-40, AC-41 | Block 1 |
| AC-42 | Block 0, Block 7 |
| AC-43, AC-45 | Block 2, Block 8 |
| AC-44, AC-46 | Block 3, Block 8 |
| AC-47, AC-48, AC-49, AC-50 | Block 8 (AC-48 also in Block 0, AC-49 also in Block 1) |

## Dependencies between blocks
Blocks 0 and 1 touch disjoint files (Block 0: `packages/shared`; Block 1: the exchange-rates module, the
Drizzle files and the migration tests) and run in parallel. Block 2 needs Block 0 (schemas and range helpers).
Block 3 needs Block 2 (ports, foreign relations, preferences) and Block 6 needs Blocks 1 and 2; Blocks 3 and 6
touch disjoint files and run in parallel. Blocks 4 and 5 need Block 3 and touch disjoint files, so they run in
parallel. Block 7 needs Block 6 (its source port) and Block 1 (the history table). Block 8 runs last: it wires
the three use cases into the module, the server and the benchmark. Order: {0, 1}, 2, {3, 6}, {4, 5, 7}, 8, with
7 starting after 6.

## Block 0 — Shared contracts, range and month helpers

**Files**
- `packages/shared/src/reports/report.ts` (new) — query and response Zod schemas, limits and types.
- `packages/shared/src/reports/report-range.ts` (new) — `resolveReportRange`, `monthsBetween`, `addMonths`,
  `netWorthPointDates`, `startOfLocalDay`, `localDayBounds`.
- `packages/shared/src/index.ts` (modified) — exports both files.
- `packages/shared/test/report-contracts.test.ts`, `packages/shared/test/report-range.test.ts` (new).

**Logic**
`REPORT_MAX_MONTHS` is `{ expensesByCategory: 24, incomeExpenses: 12, netWorth: 24 }`. The flow query schema is
a strict object with `from`, `to` (the `localDateSchema` of `movement-filters.ts`), `accountId` (uuid) and
`tag` (`movementTagSchema`); the net worth query is a strict object with `from` and `to` only. The responses are:
expenses by category `{ currency, from, to, total, categories: [{ categoryId (uuid or null), name (or null),
defaultKey (or null), amount }], unconvertedShareCount, unconvertedInstallmentCount }`; income and expenses
`{ currency, from, to, months: [{ month, income, expenses }], unconvertedShareCount,
unconvertedInstallmentCount }`; net worth `{ currency, from, to, points: [{ date, ars, usd, total (or null),
reason ('no_rate' or null), investmentsIncomplete }] }`; amounts use `exactIntegerStringSchema`.
`resolveReportRange` follows D4 and throws a subclass of `AppError` (`VALIDATION_FAILED`, `fields`, `details`)
and returns `{ from, to, months }`. `localDayBounds(from, to, zone)` returns the half-open instants of D5.
`netWorthPointDates(months, today)` follows D16.

**Data model**
No stored data. The shapes are nullable where the PRD says so: `categoryId`, `name`, `defaultKey`, `total` and
`reason` are nullable; `total` and `reason` are null together or both set, enforced by a refinement; every
amount is a not null integer string; the month and date fields keep a fixed pattern.

**Input validation**
Query: `from` and `to` must be real days between 1970 and 2100; `accountId` a uuid; `tag` 1 to 30 characters
after NFC and trim; any unknown key is refused by the strict object. `resolveReportRange` refuses `to` after
today, `from` after `to` and a range over the limit.

**Error handling**
- A range error carries `VALIDATION_FAILED`, the failing `fields` and, for the limit, `details.maxMonths`.
- A malformed date or an unknown key fails the schema before any range logic runs.

**Required tests**
- [ ] A range of 25 touched months is a 400 error for the category and net worth limits and 13 for income and
      expenses, each with `details.maxMonths` of "24" or "12"; exactly 24 and 12 months are accepted — validates AC-04, AC-06
- [ ] 2025-01-31 to 2025-02-01 touches 2 months, not 1 — validates AC-04
- [ ] A malformed date, a `from` after `to` and a `to` after today are invalid and name `query.from` or
      `query.to` — validates AC-05
- [ ] With no dates the income range is 12 months from 11 months before the current month, and `to` is today —
      validates AC-07
- [ ] `netWorthPointDates` for 2025-10 to 2026-09 returns 12 month ends in date order, February of a leap year
      ends on the 29th — validates AC-09
- [ ] The current month point is dated today and a past month keeps its last day — validates AC-42
- [ ] The net worth response schema parses a point with its two components and a `total` or a `reason`, and a
      `total` with no `reason` pair is an invalid response — validates AC-10
- [ ] An amount such as "12.5", "1e3" or a JSON number is invalid in every response schema — validates AC-48
- [ ] `localDayBounds('2026-03-01', '2026-03-31', 'America/Argentina/Buenos_Aires')` spans 2026-03-01T03:00:00Z
      to 2026-04-01T03:00:00Z — validates AC-14
- [ ] The net worth query refuses `accountId` and `tag`, and the flow query refuses an unknown key — validates FR-05

**Completion criterion**
The listed tests pass, `pnpm typecheck` passes for `packages/shared` and `apps/api`, and the schemas are
importable from `@pesly/shared`.

## Block 1 — Exchange rate history: migration, write path and seed

**Files**
- `apps/api/src/exchange-rates/infrastructure/db/schema.ts` (modified) — `exchangeRateHistory`.
- `apps/api/src/exchange-rates/infrastructure/db/drizzle-rate-repository.ts` (modified) — `replaceAll` writes
  both tables in one transaction.
- `apps/api/drizzle/0038_exchange_rate_history.sql` (generated, plus the hand-appended seed),
  `apps/api/drizzle/meta/*` (generated, `0038_snapshot.json` and the journal entry at idx 38 with `when`
  1791820000000), `apps/api/drizzle/rollback/0038_exchange_rate_history.down.sql` (new).
- `apps/api/test/exchange-rates/rate-history-migration.test.ts`, `apps/api/test/exchange-rates/rate-history-write.test.ts`
  (new; need `TEST_DATABASE_URL`).
- Tests that name 0037 as the newest migration or roll back newer migrations first (modified; found with
  `grep -rl 0036_budget_alert_marks apps/api/test`): `budgets/alert-marks-migration.test.ts`,
  `budgets/migration.test.ts`, `budgets/spending-migration.test.ts`, `credit-cards/automatic-debit-migration.test.ts`,
  `credit-cards/statement-reminders-migration.test.ts`, `goals/migration.test.ts`,
  `groups/activity-log-migration.test.ts`, `groups/expenses-migration.test.ts`, `groups/migration.test.ts`,
  `groups/record-version-migration.test.ts`, `groups/settlements-migration.test.ts`,
  `identity/migration.test.ts` (the `NEWEST_MIGRATION` constant and the journal count),
  `investments/investments-migration.test.ts`, `investments/price-migration.test.ts`,
  `notices/notices-migration.test.ts`, `recurring/auto-recording-migration.test.ts`.

**Logic**
Generate the migration with drizzle-kit from the schema file, check it adds only the table and its checks,
then append the seed of D10 by hand: one row per `exchange_rates` row with `rate_date` equal to the Argentina
date of `fetched_at`. `replaceAll` keeps its port signature: inside `db.transaction` it upserts
`exchange_rates` as today and upserts one history row per quote, dated with `dateInTimeZone(fetchedAt,
'America/Argentina/Buenos_Aires')`, updating `buy`, `sell` and `recorded_at` on conflict. A failure of either
statement rolls both back. Each test above that rolls back newer migrations to test an older one first applies
`0038_exchange_rate_history.down.sql`, then the 0037 rollback, and each that names the newest migration or the
journal length moves from 0037 to 0038. The rollback drops the table and deletes the journal row.

**Data model**
- New table `exchange_rate_history`: `rate_type` text not null, `rate_date` date not null, `buy` bigint not null,
  `sell` bigint not null, `recorded_at` timestamptz not null; primary key `(rate_type, rate_date)`; checks that
  `rate_type` is one of the seven `RATE_TYPES` and that `buy` and `sell` are between 1 and `RATE_MAX_SCALED`.
  The primary key index serves the lateral lookup of the latest date on or before a given day. No `real`,
  `double precision` or `numeric` column. No foreign key (the table outlives any one stored rate).
- No other table changes.

**Input validation**
The values come from the provider quotes already validated by `assertCompleteQuotes`; the database checks are
the second line: rate type, range of `buy` and `sell`, and the primary key.

**Error handling**
- A failing history upsert rolls back the `exchange_rates` upsert, and the error propagates to the refresh,
  which leaves the lease to expire as it does for any storage error.
- The rollback script is idempotent and never fails when run twice.

**Required tests** *(PostgreSQL)*
- [ ] Two refreshes on the same Argentina day leave one history row per rate type holding the values of the
      second — validates AC-40
- [ ] A refresh on the next day adds a second row and keeps the first; a fetch at 02:00 UTC counts as the
      previous Argentina day — validates AC-40
- [ ] Applying 0038 on a database whose `exchange_rates` holds seven rows creates seven history rows dated by
      `fetched_at` with the same `buy` and `sell` — validates AC-41
- [ ] A history row with an unknown rate type, a `sell` of 0 or a duplicate key is invalid and raises a
      constraint error — validates FR-14
- [ ] A forced error in the history upsert leaves `exchange_rates` unchanged — validates FR-14
- [ ] The rollback, run twice with no error, drops the table and removes only the 0038 journal row; applying
      0038 again afterwards works, and every other table keeps its rows — validates AC-49
- [ ] The journal entry at idx 38 has the greatest `when`, above 1791810000000, and its snapshot is chained to
      0037 — validates NFR-03
- [ ] Every migration test named in the Files list passes with 0038 as the newest migration — validates NFR-03

**Completion criterion**
The migration and write tests pass against PostgreSQL, `pnpm typecheck` passes, and no migration test that
names 0037 as the newest still fails.

## Block 2 — Reports module skeleton, routes, preferences and filter checks

**Files**
- `apps/api/src/reports/application/ports/report-preferences.ts`, `report-filter-reader.ts`, `clock.ts`,
  `report-use-cases.ts` (new) — ports and the three use case interfaces.
- `apps/api/src/reports/application/prepare-report.ts` (new) — `prepareReport`, the shared first step.
- `apps/api/src/reports/infrastructure/db/foreign-relations.ts`, `drizzle-report-preferences.ts`,
  `drizzle-report-filter-reader.ts` (new); `apps/api/src/reports/infrastructure/clock/system-clock.ts` (new).
- `apps/api/src/reports/infrastructure/http/report-routes.ts` (new) — `createReportRoutes`.
- `apps/api/test/reports/fakes.ts`, `route-harness.ts`, `prepare-report.test.ts`, `report-routes.test.ts`,
  `filter-reader.test.ts` (new).

**Logic**
`ReportPreferences.preferencesOf(userId)` returns the display currency, the default rate type and the time
zone from `users` by primary key, failing closed for a missing user, with an invalid stored zone replaced by
`America/Argentina/Buenos_Aires` as the other modules do. `ReportFilterReader.ownsAccount(scope, id)` and
`ownsTag(scope, name)` read with the owner in the WHERE (the tag compared with `lower()`). `prepareReport(deps,
scope, query, spec)` reads the preferences, computes today with `todayInTimeZone` and the `Clock`, resolves the
range of Block 0, checks the filters and returns a `ReportContext` with the preferences, today, the range, its
instant bounds and the filters; it throws `ResourceNotFound` for a foreign filter. `ReportUseCases` is the
object `{ expensesByCategory, incomeExpenses, netWorth }`, each with `execute(scope, query)` returning the
response of Block 0. The routes register `requireSession` and `requireVerifiedEmail` on `/reports`, create the
read scope with the `OwnerOrGroupMemberAccessPolicy` over `DenyAllGroupMembershipReader` as `/budgets` does,
and log ids only.

**API contract**
- Method + path: `GET /reports/expenses-by-category`, `GET /reports/income-expenses`, `GET /reports/net-worth`.
- Request: query only, no body: `from` and `to` (local `YYYY-MM-DD`), plus `accountId` (uuid) and `tag` (1 to
  30 characters) on the first two; the net worth query refuses `accountId` and `tag`.
- Response 200: the three schemas of Block 0, validated before sending; amounts are integer strings in minor
  units.
- Error codes: 400 `VALIDATION_FAILED` (with `fields`, and `details.maxMonths` over the limit), 401
  `UNAUTHENTICATED`, 403 `EMAIL_NOT_VERIFIED`, 404 `NOT_FOUND` for an account or tag that is not the caller's.
- Auth: a verified session; the read scope of the caller, never a user id taken from the request.

**Data model**
Reads `users` (display currency, default rate type, time zone), `accounts` and `tags` through the owner
column; no table or column is added, and the reads rely on the primary key of `users` and on the unique
`(owner_id, lower(name))` index of `tags`.

**Input validation**
The route validates the query with the schemas of Block 0 through the shared `validate` middleware; `prepareReport`
validates the range and the ownership of the filters before any report read runs.

**Error handling**
- A foreign or unknown account or tag is `ResourceNotFound` and answers 404 with no data.
- A bad range answers 400 through `AppError`; a missing session answers 401 before any use case runs.

**Required tests** *(fakes for the use cases and ports, PostgreSQL for the readers)*
- [ ] A request with no session cookie answers 401 and calls no use case — validates AC-45
- [ ] A range of 25 months on the category and net worth routes and of 13 on income and expenses answers 400
      with `details.maxMonths` — validates AC-04, AC-06
- [ ] A malformed date, a `from` after `to` and a `to` after today in the user's zone answer 400 and return no
      data; `to` equal to today is accepted — validates AC-05
- [ ] An `accountId` of another user and an unknown one both answer 404 with the same body; a tag of another
      user and an unknown tag answer 404 — validates AC-43
- [ ] The tag "Vacations2026" matches the stored "vacations2026" and a NFC-equivalent spelling — validates AC-13
- [ ] A reader called with the scope of user A never sees an account or tag of user B — validates AC-46
- [ ] An unverified email answers 403, and the net worth route with `accountId` is a 400 error — validates FR-16
- [ ] The preferences reader returns the stored display currency, default rate type and zone, falls back for
      an invalid stored zone, and a missing user is an error — validates FR-02

**Completion criterion**
The listed tests pass, `pnpm typecheck` passes and the routes answer 200 with fake use cases that return a valid
response.

## Block 3 — Flow core: conversion rules and the aggregated readers

**Files**
- `apps/api/src/reports/domain/conversion.ts` (new) — `convertAmount`, `effectiveNames`, `namesMatch`.
- `apps/api/src/reports/domain/flows.ts` (new) — folding of rows, share matching, `installmentDueDate`.
- `apps/api/src/reports/application/ports/flow-reader.ts` (new) — `FlowReader` and the row types.
- `apps/api/src/reports/infrastructure/db/flow-conditions.ts` (new) — owner, account, tag and date conditions.
- `apps/api/src/reports/infrastructure/db/drizzle-flow-reader.ts` (new) — personal, share, installment and
  top-level category reads.
- `apps/api/test/reports/flow-domain.test.ts`, `flow-reader.test.ts`, `budget-parity.test.ts`,
  `flow-fixtures.ts` (new).

**Logic**
`FlowReader` has four methods taking the scope: `personalRows(scope, window)` returns `(month, type,
topCategoryId, currency, rate, sum, count)` as D6; `shareRows(scope, window)` the share rows of D7;
`installmentRows(scope, periodFrom, periodTo)` the rows of D8; `topCategories(scope)` the caller's top-level
expense categories with their custom or default names and the names of their children. The window is `{ from,
before, timeZone, accountId?, tag? }`. `flow-conditions.ts` builds the WHERE once for the personal read, so the
account, tag and date rules exist in one place. `domain/flows.ts` holds the pure functions the use cases call:
`convertRows` (converts each row, summing what converted and counting what did not), `matchShareCategory`
(D7) and `installmentDueDate` (D8). No query runs in a loop over rows, categories or months.

**Data model**
Reads `movements`, `accounts`, `categories`, `movement_tags`, `tags`, `group_members`, `group_expenses`,
`group_expense_shares`, `group_categories`, `installments`, `installment_purchases`, `credit_cards` and
`credit_card_statements`, each with the owner or the caller's member row in the WHERE. No column or index is
added; the reads rely on `movements_owner_date_idx`, the owner indexes of the installment tables and the
primary keys. Sums are read as text and parsed with `BigInt`, never nullable (a group with no rows is absent).

**Input validation**
The window comes from `prepareReport` (range, zone and filters already validated); the readers bind every
value as a parameter, the zone and the instants included, and never build SQL from the tag name or ids.

**Error handling**
- A personal expense row with no frozen rate or a null category is an invariant error and is thrown, never
  guessed (06c does the same).
- A database error is rethrown; the single place that turns it into a response is the error middleware.

**Required tests** *(fakes for the domain, PostgreSQL for the readers)*
- [ ] A 20.00 USD expense with a frozen rate of 1,400.0000 converts to 28,000.00 ARS whatever `exchange_rates`
      or the history holds today — validates AC-15
- [ ] Changing every stored rate after recording leaves the rows and the converted sums identical — validates AC-16
- [ ] A 30,000.00 ARS expense with a frozen rate of 1,500.0000 converts to 20.00 USD — validates AC-17
- [ ] Personal expenses of 50,000.00 ARS and a share of 10,000.00 ARS in a group category named like the
      personal category give 60,000.00 ARS for that category in the month — validates AC-18
- [ ] A group expense of 30,000.00 ARS paid by the user with a share of 10,000.00 ARS and a personal payer
      movement counts 10,000.00 ARS and not 30,000.00 ARS — validates AC-19
- [ ] A share whose group category matches no personal category folds into one row with a null category id —
      validates AC-20
- [ ] A share in USD with no frozen rate (someone else paid) is left out and counted by `count(*)`, so 3 shares
      in one row count 3 — validates AC-21
- [ ] Transfers and exchanges never appear in the personal rows, income rows come only from income movements —
      validates AC-22
- [ ] An installment of 10,000.00 ARS of a statement due on 2026-11-10 lands in 2026-11 in the category of its
      purchase, from a stored statement and from the derived dates — validates AC-23
- [ ] An installment in USD with an ARS display is left out and counted by its `count(*)` — validates AC-25
- [ ] Movements at 2026-03-01T02:59:59Z and 2026-04-01T03:00:00Z are outside the March window and those at
      2026-03-01T03:00:00Z and 2026-04-01T02:59:59Z are inside, for a Buenos Aires user — validates AC-14
- [ ] A movement at 01:00 UTC on 1 July is bucketed in June for America/Argentina/Buenos_Aires — validates AC-28
- [ ] The tag "Vacations2026" keeps only the movements with that tag, and the account filter keeps only that
      account; with either filter set the use case contract is to call no share or installment read — validates AC-11, AC-12, AC-24
- [ ] User B's movements, shares and installments never appear in the rows read for user A, and a group
      member's own shares are the only shares returned — validates AC-44, AC-46
- [ ] The same fixture through `computeSpending` of budgets and through the reports conversion gives equal
      spent amounts for the category — validates FR-06
- [ ] A null frozen rate on an expense row is an error and an unknown currency is invalid — validates FR-06

**Completion criterion**
The listed tests pass against PostgreSQL, the parity test passes, and `pnpm typecheck` passes.

## Block 4 — Income and expenses report

**Files**
- `apps/api/src/reports/domain/monthly-flows.ts` (new) — folds rows into the 12 monthly entries.
- `apps/api/src/reports/application/get-income-expenses.ts` (new) — `GetIncomeExpenses`.
- `apps/api/src/reports/infrastructure/http/present-income-expenses.ts` (new) — `bigint` to integer strings.
- `apps/api/test/reports/income-expenses-domain.test.ts`, `income-expenses-use-case.test.ts` (new, fakes),
  `income-expenses-flow.test.ts` (new, PostgreSQL).

**Logic**
`GetIncomeExpenses.execute(scope, query)` calls `prepareReport` with the 12-month limit and default, reads
`personalRows`, and, only when neither `accountId` nor `tag` is present, `shareRows` and `installmentRows`. It
converts every row to the display currency (Block 3), adds income rows to the month income and expense rows,
share rows and installments to the month expenses, and returns one entry per month of the range, in date
order, with `"0"` for a month with no flow, plus the two unconverted counts. Installments are placed in the
month of their due date inside `[from, to]`.

**Data model**
No stored data; the response month entries are not nullable and every amount defaults to the integer string
"0" for an empty month.

**Input validation**
The query is validated by Block 2; this use case trusts the `ReportContext` and refuses a context whose range
holds more than 12 months by throwing.

**Error handling**
- A range over 12 months is rejected in `prepareReport` (400); the use case does not catch it.
- A reader error is rethrown with no partial response.

**Required tests** *(fakes, then PostgreSQL)*
- [ ] With no dates the response has 12 months from 11 months before the current month to the current one, each
      with an income and an expense — validates AC-07
- [ ] A month with no movement returns an income of "0" and an expense of "0" — validates AC-08
- [ ] Filtering by one account keeps only the income and expense movements of that account, and a transfer
      out of it is not counted — validates AC-12
- [ ] A transfer and a currency exchange change neither income nor expenses — validates AC-22
- [ ] With an account or a tag filter the share and installment readers are never called, and without a
      filter the shares and the installments of the due month are added to the expenses — validates AC-24
- [ ] An installment in USD with an ARS display is left out and reported in `unconvertedInstallmentCount` —
      validates AC-25
- [ ] A range of 13 months reaching the use case is an error and 12 months with `from` and `to` is accepted —
      validates AC-06
- [ ] Frozen rates win over stored ones in a month holding a 20.00 USD expense — validates AC-15
- [ ] A reader error leaves the use case with no response, and a context with a missing range is invalid —
      validates FR-03

**Completion criterion**
The listed tests pass and the report over a seeded two-month fixture equals the hand-computed values.

## Block 5 — Expenses by category report

**Files**
- `apps/api/src/reports/domain/category-totals.ts` (new) — folds rows by top-level category, orders them.
- `apps/api/src/reports/application/get-expenses-by-category.ts` (new) — `GetExpensesByCategory`.
- `apps/api/src/reports/infrastructure/http/present-expenses-by-category.ts` (new) — integer strings.
- `apps/api/test/reports/category-totals-domain.test.ts`, `expenses-by-category-use-case.test.ts` (new, fakes),
  `expenses-by-category-flow.test.ts` (new, PostgreSQL).

**Logic**
`GetExpensesByCategory.execute(scope, query)` calls `prepareReport` with the 24-month limit and the one-month
default, reads `personalRows` for `expense` rows, plus, when no filter is present, `shareRows`,
`installmentRows` and `topCategories`. It converts every row (Block 3), adds a subcategory to its top-level
category (the row already carries the top id), matches each share to a top-level category by name or to the
null row, adds the installments by the category of their purchase, and returns the rows ordered by amount
descending and then by id, with the total and the two unconverted counts. A range with no expense returns an
empty list and a total of "0".

**Data model**
No stored data; `categoryId`, `name` and `defaultKey` are nullable in the response (a null category row has
all three null) and the total is never null.

**Input validation**
The query is validated by Block 2; the use case trusts the `ReportContext`, and a tag or account filter makes it
skip the share and installment reads.

**Error handling**
- A range over 24 months is rejected in `prepareReport` (400); the use case does not catch it.
- A row whose top-level category is missing from `topCategories` is an invariant error and is thrown.

**Required tests** *(fakes, then PostgreSQL)*
- [ ] From 2025-01-01 to 2026-09-30 the response holds one row per top-level category with its id, name and an
      amount in minor units of the display currency — validates AC-01
- [ ] An expense in Groceries under Food adds to Food and returns no Groceries row — validates AC-02
- [ ] A range with no expense returns an empty list and a total of "0" — validates AC-03
- [ ] Filtering by the tag "vacations2026" includes only the movements with that tag, and the tag
      "Vacations2026" matches it — validates AC-11, AC-13
- [ ] Personal expenses of 50,000.00 ARS plus a share of 10,000.00 ARS matched by name give 60,000.00 ARS for
      that category, and an unmatched share is one row with a null category id — validates AC-18, AC-20
- [ ] A payer movement of a group expense counts only the user's share — validates AC-19
- [ ] A share in the other currency with no frozen rate is left out and counted — validates AC-21
- [ ] An installment of 10,000.00 ARS due on 2026-11-10 adds to its purchase category, and with an account or
      tag filter installments are left out — validates AC-23, AC-24
- [ ] An installment in the other currency is left out and counted — validates AC-25
- [ ] A top-level category missing from the category read is an error, and a filter naming an account of
      another user is a 404 before any read — validates FR-01
- [ ] A range of 25 months reaching the use case is a 400 error from `prepareReport` and no reader runs —
      validates AC-04

**Completion criterion**
The listed tests pass and the report over a seeded fixture with a parent, two children, a group share and an
installment equals the hand-computed values.

## Block 6 — Net worth sources: accounts, groups, investments and installment debt

**Files**
- `apps/api/src/reports/application/ports/net-worth-sources.ts` (new) — `NetWorthSources` and its result types.
- `apps/api/src/reports/domain/installment-debt.ts` (new) — pure per-point debt from the rows.
- `apps/api/src/reports/infrastructure/db/drizzle-account-flow-reader.ts`,
  `drizzle-group-flow-reader.ts`, `drizzle-investment-reader.ts`, `drizzle-installment-debt-reader.ts` (new).
- `apps/api/test/reports/net-worth-sources.test.ts`, `installment-debt-domain.test.ts`,
  `net-worth-fixtures.ts` (new).

**Logic**
`NetWorthSources` has four methods that take the scope and a window `{ start, end, timeZone, points }`:
`accountFlows` returns `{ opening, baseline, byMonth }` per currency (D11); `groupFlows` the same shape without
opening (D13); `investmentValues(points)` the per-point values and the set of incomplete dates (D12);
`installmentDebtRows` the rows of D14. Each is one statement (the account one a `union all` of the three
signed sources, grouped by currency and bucket), with the zone and the instants as parameters. The domain
function `installmentDebt(rows, points)` follows D14, deriving a missing closing date with `statementDatesFor`.
Archived accounts are excluded by `archived_at is null` in every account read.

**Data model**
Reads `accounts`, `movements`, `group_settlements`, `group_members`, `group_expenses`, `group_expense_shares`,
`group_settlement_legs`, `portfolios`, `portfolio_value_snapshots`, `installments`, `installment_purchases`,
`credit_cards` and `credit_card_statements` with the owner or the caller's member rows in the WHERE; no column
or index is added (the lateral snapshot read uses the primary key of `portfolio_value_snapshots`, the
settlement read `group_settlements_account_idx`). Sums are read as text; the bucket is nullable and null means
before the range.

**Input validation**
The window comes from the use case of Block 7 (range already validated); every value is a bound parameter, the
dates passed to the investment read as a `date[]` and the instants as a `timestamptz[]`.

**Error handling**
- A database error is rethrown and no partial source is returned.
- A debt row with an invalid period or currency is an invariant error and is thrown.

**Required tests** *(PostgreSQL for the readers, fakes for the domain)*
- [ ] An account with an opening balance of 100,000.00 ARS, an expense of 30,000.00 ARS in April and an income
      of 10,000.00 ARS in July accumulates to 70,000.00 at the end of April and 80,000.00 at the end of July —
      validates AC-26
- [ ] A transfer of 5,000.00 ARS between two ARS accounts in June leaves the total ARS account part equal
      before and after, and an exchange moves value between the currencies — validates AC-27
- [ ] A movement at 01:00 UTC on 1 July is in the June bucket for Buenos Aires — validates AC-28
- [ ] An archived account and its movements and settlement payments are in no bucket and not in the opening
      sum — validates AC-29
- [ ] Snapshots on 2026-06-29 and 2026-07-02 give the 2026-06-29 value for the point of 2026-06-30 — validates AC-30
- [ ] A portfolio created before a point with no snapshot on or before it counts 0 and marks the point
      incomplete — validates AC-31
- [ ] A portfolio created after a point counts 0 and does not mark it incomplete — validates AC-32
- [ ] Group members owing the user 30,000.00 ARS and the user owing 20,000.00 ARS in another group add
      10,000.00 ARS to the ARS group part, and the member rows of a group the user left still count — validates AC-33
- [ ] A settlement dated after the month end is in no bucket of that point — validates AC-34
- [ ] A purchase of 6 installments of 10,000.00 ARS made in April with statements closing on 2026-06-20,
      2026-07-20 and later subtracts the installments closing after 2026-06-30 from the point of 2026-06-30 —
      validates AC-35
- [ ] An installment of a statement that closed on or before the month end is not subtracted, and an
      installment of a purchase made after the month end is not either — validates AC-36
- [ ] Rows of user B never reach any of the four sources of user A — validates FR-16
- [ ] A debt row with an invalid period is an error and an unknown currency is invalid — validates FR-12
- [ ] A database error in one source rejects the whole read, and no partial source is returned as an error
      result — validates FR-09

**Completion criterion**
The listed tests pass against PostgreSQL and `pnpm typecheck` passes.

## Block 7 — Net worth report: rate lookup, point assembly and use case

**Files**
- `apps/api/src/reports/application/ports/net-worth-rate-reader.ts` (new) — `NetWorthRateReader`.
- `apps/api/src/reports/domain/net-worth.ts` (new) — accumulation, conversion and `assemblePoints`.
- `apps/api/src/reports/application/get-net-worth.ts` (new) — `GetNetWorth`.
- `apps/api/src/reports/infrastructure/db/drizzle-net-worth-rate-reader.ts` (new) — history lateral read and
  the current stored rate.
- `apps/api/src/reports/infrastructure/http/present-net-worth.ts` (new) — integer strings.
- `apps/api/test/reports/net-worth-domain.test.ts`, `net-worth-use-case.test.ts` (fakes),
  `net-worth-rate-reader.test.ts` (PostgreSQL) (new).

**Logic**
`GetNetWorth.execute(scope, query)` calls `prepareReport` with the 24-month limit and the 12-month default,
builds the points of D16 with their end instants, reads the four sources of Block 6 and the rates once, and
calls `assemblePoints`. For each point the ARS and USD components are the accumulated account part, plus the
investments, plus the group part, minus the installment debt, per currency (D11 to D14); the conversion is
D15. The rate reader returns a map from point date to the sell rate or null: past dates by one lateral query
over `exchange_rate_history`, the current point from `exchange_rates`. `investmentsIncomplete` is copied from
the investment read.

**Data model**
Reads `exchange_rate_history` (the primary key `(rate_type, rate_date)` serves the lookup) and
`exchange_rates`; nothing is written. In the response `total` and `reason` are nullable and set as a pair.

**Input validation**
The query is validated by Block 2; the rate reader binds the rate type, the dates as a `date[]` and nothing
else from the request.

**Error handling**
- A missing rate is not an error: the point is returned with `total` null and `reason` `"no_rate"` (D15).
- A source or rate reader error is rethrown; no point is guessed.

**Required tests** *(fakes for the use case and the domain, PostgreSQL for the rate reader)*
- [ ] A request from 2025-10-01 to 2026-09-30 returns 12 points in date order, each with its date, ARS
      component, USD component and a `total` or a `reason` — validates AC-09, AC-10
- [ ] A range over 24 months reaching the use case is a 400 error from `prepareReport` — validates AC-04
- [ ] The point of 2026-06-30 converts its USD component with the sell rate of the default rate type stored on
      2026-06-30, or on the latest day before it, and never with a later rate — validates AC-37
- [ ] With no history row on or before a month end and a non-zero USD component the point has its two
      components, a null `total` and the reason "no_rate" — validates AC-38
- [ ] Display ARS with a USD component of 1,000.00 and a rate of 1,500.0000 includes 1,500,000.00 ARS for the
      USD part, and display USD divides the ARS component by the rate with the rounding of
      `convertMinorUnits` — validates AC-39
- [ ] A range that includes the current month ends with a point dated today, converted with the latest stored
      rate of the default rate type, and the past points keep their month end dates — validates AC-42
- [ ] The components add the four sources per currency: accounts, investments, group part and minus the
      installment debt — validates FR-04
- [ ] A zero USD component with no rate still returns a total (D15), and the rate reader returns null for a
      date before the first history row — validates FR-13
- [ ] A rate reader error is propagated and no response is built — validates FR-15

**Completion criterion**
The listed tests pass and the use case over fake sources returns the hand-computed 12 points.

## Block 8 — Composition, ownership flows and benchmark

**Files**
- `apps/api/src/reports/index.ts` (new) — `createReportRoutes({ db, logger, clock?, useCases? })`, the default
  composition of the Drizzle readers and the three use cases.
- `apps/api/src/server.ts` (modified) — registers `createReportRoutes({ db, logger })`.
- `apps/api/test/reports/reports-flow.test.ts` (new, PostgreSQL) — the three reports through HTTP with two users.
- `apps/api/test/reports/no-float-reports.test.ts`, `no-outbound.test.ts`, `dependencies.test.ts` (new).
- `apps/api/test/perf/reports.perf.test.ts` (new) — the benchmark; it reuses `movements-seed.ts`.

**Logic**
`createReportRoutes` builds `DrizzleReportPreferences`, `DrizzleReportFilterReader`, `DrizzleFlowReader`, the
four net worth sources and the rate reader, wires them into the three use cases and returns the router of Block
2. The flow test seeds two users, each with movements, a group, an installment purchase, snapshots and rate
history, and asserts that each report returns only the caller's figures. The benchmark seeds the 100,000
movements of `movements-seed.ts`, re-dates them over 24 months with one SQL update, adds 50 rates, shares,
installments and snapshots, and measures 20 runs of each report over HTTP, 24 months (12 for income and
expenses). The scan tests read the source files of the module, `packages/shared/src/reports` and the tests.

**Data model**
Reads only; writes nothing. The benchmark inserts test rows into `movements`, `exchange_rate_history` and the
group, installment and snapshot tables of its own user and deletes them afterwards; no check, index or
migration is added here, and a missed target is reported, not patched with a hidden index.

**Input validation**
The flow test sends malformed dates, an over-limit range and a foreign filter through the real routes and the
real validation middleware, never around them.

**Error handling**
- A missed benchmark target is reported with the measured value and the report, never loosened silently.
- A leftover outbound call or float token fails the scan tests and names the file.

**Required tests** *(PostgreSQL; the benchmark with `pnpm test:perf`)*
- [ ] With two users, each report returns only the caller's movements, shares, snapshots and installments —
      validates AC-46
- [ ] A group member sees only their own shares in the category and income and expenses reports and never an
      amount of another member — validates AC-44
- [ ] An account or tag of another user answers 404 through the real routes, and a request with no session
      answers 401 and returns no data — validates AC-43, AC-45
- [ ] A frozen-rate expense returns the same amounts after the stored rates and the history change — validates AC-16
- [ ] Each of the three reports answers in under 2 s at p95 over 20 runs for 24 months (12 for income and
      expenses) with 100,000 movements — validates AC-47, NFR-01
- [ ] Every amount in the three responses is an integer string and the source scan finds no `parseFloat`,
      `toFixed`, `Math.round`, `Math.floor` or `Number(` in the module, its shared schemas or its tests —
      validates AC-48
- [ ] The migration of Block 1 applied and rolled back twice keeps every other table unchanged, and the
      dependency lists of `apps/api/package.json` and `packages/shared/package.json` equal the pinned lists —
      validates AC-49
- [ ] `fetch` is never called and no socket is opened while the three reports run, and no file of the module
      imports a rates provider, a job or an HTTP client — validates AC-50
- [ ] A bad range and an unknown filter reach the error middleware and the response holds no stack or SQL —
      validates FR-16

**Completion criterion**
The flow, scan and dependency tests pass against PostgreSQL, the benchmark reports the three p95 values under
2 s, and `pnpm lint`, `pnpm typecheck` and the full test suite pass.

## Final verification
Every AC of the PRD has at least one named test (see the coverage tables). `pnpm install --frozen-lockfile`,
`pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm test:perf` pass; migration 0038 applies on an empty
database and on a copy of the schema of `main`, rolls back twice without error, and its journal `when` is above
the maximum on `main`; the reports of a seeded user equal the hand-computed fixtures; and the budgets spending
of the same data equals the category report for a covered category.

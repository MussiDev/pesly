# Spec DISC-001-09b: Dashboard API

| Field | Value |
|-------|-------|
| Ticket | DISC-001-09b |
| PRD | docs/ddw/prd/prd-DISC-001-09b.md |
| Tier | FEATURE |
| Date | 2026-10-12 |
| Spec loops | 0 |
| Loops since last human decision | 0 |

## Summary
A new `dashboard` module in `apps/api` serves one read-only route, `GET /dashboard`, behind `requireSession` and
`requireVerifiedEmail`. A use case reads the caller's preferences once, then builds seven sections in parallel
(net worth, month flows with categories and insight, budgets, agenda, groups, first steps) and fails as a whole
when any source fails. Nothing is re-derived: the module calls the 09a flow readers and domain rules
(`reports`), `computeSpending` (`budgets`), `ListUpcoming` (`recurring`, which also materializes the pending
occurrences, owner decision 2), `buildStatementViews` (`credit-cards`), `ListPortfolios` (`investments`, owner
decision 1) and the group balance functions (`groups`), each through the barrel of its module. New code is the
composition, the section rules (percentages, periods, ordering, caps), three small SQL readers (group balances
of all the caller's groups, account currencies, first steps) and the Zod contract in `packages/shared`. Owed to
you and you owe stay two per-currency numbers (owner decision 3). No migration, no table, no dependency, no
screen and no external call.

## Design decisions
- D1: Module shape and imports (FR-15, NFR-03). `apps/api/src/dashboard/` follows the hexagonal layout:
  `domain/` (pure section rules), `application/` (builders, ports, the use case), `infrastructure/` (Drizzle
  readers, adapters, route). Other modules are reached only through their barrel (`../../reports`,
  `../../budgets`, `../../recurring`, `../../credit-cards`, `../../investments`, `../../groups`,
  `../../movements`); the only file that imports another module's tables is
  `infrastructure/db/foreign-relations.ts`, the pattern of `reports`. Block 1 adds the missing exports to those
  barrels, and a boundary test (Block 8) scans the imports of the module.
- D2: Contract (FR-01, NFR-02). One response schema in `packages/shared/src/dashboard/dashboard.ts`; the query is
  `z.strictObject({})`, so any query parameter is `VALIDATION_FAILED` (400). Amounts are `exactIntegerStringSchema`
  strings in minor units; percentages are whole JSON numbers; dates are `YYYY-MM-DD`; categories and groups carry
  ids and `defaultKey`, never prose. The route sends through `validate({ query, response })`.
- D3: One preferences read per request (FR-05, NFR-05). `prepareDashboard` reads the display currency, default rate
  type and time zone with the reports reader, computes `today` with `todayInTimeZone`, and returns a
  `DashboardContext`. A request-scoped `ContextTimeZones` implements the `UserTimeZone` ports of budgets and
  recurring by answering the zone already read (and failing closed for another user id), so those use cases do not
  read it again; this saves three statements.
- D4: Net worth now (FR-02, FR-03, FR-04, FR-15). The 09a account reader and installment debt reader run over a
  one-point window dated today (window start: first instant of the current local month; point end: first instant
  after today). `accumulate` and `assemblePoints` of `reports` produce the ARS part, the USD part, `total` and
  `reason`, so conversion, `no_rate` and the zero-foreign-part rule are the ones of the chart. The investments
  part is valued live by `ListPortfolios` (sum of its per-portfolio `totals` and `holdingsWithoutPrice`); the
  group part is the sum of the per-group balances of D10, which equals the 09a group reader. The four parts are
  returned per currency, the installment debt as a positive amount that is subtracted. The rate is read once with
  `sellRates(rateType, [today], today)`, which reads the stored current rate and never the provider.
- D5: Month flows (FR-05, FR-06, FR-07, FR-12). Let M be the current local month, F its first day, T today, M1..M3
  the three complete months before it, and P the previous month's first day through the same day of month as T,
  clamped to its last day. Reads: `personalRows` and `shareRows` over [first day of M3, end of T] (month-to-date
  and the three complete months at once, bucketed by month in SQL), the same two over P, one `installmentRows` over
  the periods from two months before M3 to two months after M, and `topCategories`: six statements. Rows are
  converted with `convertRows` (personal: `throw`; shares and installments: `count`). Installments count in the
  month of their due date and, per the PRD decision log (5), a month carries the whole month's installments, not
  only those due by T. This differs from the 09a report over [F, T] when an installment is due after T (open
  question 1).
- D6: Percentages (FR-06, FR-07, FR-12, NFR-02). Pure functions in `dashboard/domain/percent.ts`: `wholePercent(part,
  total)` is `part * 100n / total` (0 when total is not positive); `changePercent(current, previous)` is null when
  previous is 0, else `(current - previous) * 100n / abs(previous)` truncated toward zero, clamped to +/-1,000,000
  so the JSON number stays exact; for a positive previous value this is the PRD formula, and a negative previous
  net result uses its absolute value so that an improvement is positive (open question 2). The insight change is
  `(current * 3n - sum3) * 100n / sum3` with the same clamp, null when sum3 is not positive. A bounded `bigint` goes
  to a JSON number only through `Number.parseInt(value.toString(), 10)`.
- D7: Categories and insight (FR-07, FR-12). The month-to-date expense rows (personal, matched shares through
  `matchShareCategory`, installments by the category of their purchase) are folded with `addToCategory` and ordered
  with `orderCategoryTotals`; each row carries `wholePercent` of the total. The insight is the first row (largest
  amount, ties by id, the null category last) with its share and its change against the average of the same
  category over M1..M3; it is null when the month has no expense, and its change is null when fewer than 3 of
  M1..M3 hold any expense in any category or the category's three-month sum is not positive.
- D8: Budgets (FR-08, FR-15). `computeSpending(deps, scope)` (no month: the current one) returns every budget in
  force; the section sorts by `percentUsed` descending (stable, so the older budget wins a tie), keeps 3, and
  adds `status`: `on_track` below 80, `close` from 80 to 99, `over` from 100. Amounts stay in each budget's own
  currency and no conversion happens.
- D9: Agenda (FR-09, FR-10). `ListUpcoming.execute` materializes the pending occurrences (idempotent insert, the
  same as `GET /recurring/upcoming`, owner decision 2) and returns overdue, pending and scheduled entries up to 30
  days. Statements are read as stored: the cards, one read of all installment rows (served to every card from
  memory), then per card its stored statements, daily purchases and received payments, through
  `buildStatementViews`; no statement is created. A statement owes in a currency when `unpaidRemainder(total,
  paid)` is positive. Routing is exclusive: an occurrence due before today is `overdue_occurrence`, due today
  `pending_occurrence` (both in `actions`); a closed owing statement due on or before today plus 3 days is
  `unpaid_statement` in `actions`; every other owing statement due after today and on or before today plus 7 days,
  and every scheduled date in the same span, goes to `upcoming` (one entry per statement and currency owed). An
  open statement due today is in neither list. `actions` is ordered overdue first, then by date, then kind, then
  id, capped at 20; `upcoming` by date, then kind, then id, capped at 20. The currency of a recurring payment is
  the currency of its account, read for all entries in one statement.
- D10: Groups (FR-02, FR-11, FR-15). One statement reads, for every member row of the caller (former memberships
  included), the three sources of the 04e formula per group and currency: expense amounts paid, shares, and
  settlement legs sent minus received. The domain builds a `BalanceSourcesByCurrency` per group and calls
  `balancesByCurrency` and `balancesOf` of `groups`, so the formula is the module's. Per currency, positive group
  balances add to "owed to you" and negative ones to "you owe" (as a positive amount); the net worth group part is
  their difference. A group with a zero balance contributes nothing. Reading all groups in one statement avoids
  the roughly six statements per group of `GetBalances`.
- D11: First steps (FR-13). One statement: `exists` a non-archived account of the caller and `exists` a movement
  of the caller. `show` is true when either is missing; every other section is still computed.
- D12: Failure and concurrency (FR-16). `GetDashboard` awaits `Promise.all` over the section builders; there is no
  `catch`, so a rejected source reaches the error middleware as the standard 5xx response and no section is sent.
  Section builders return `bigint` results; one presenter writes strings and is validated by the response schema.
- D13: Statement budget (NFR-05). For the benchmark user with 2 cards the handler runs: preferences 1, first steps
  1, net worth 7 (accounts, debt, groups, 3 for investments, rate), flows 6, budgets 8, agenda 13 (payments read
  twice, insert, pending, account currencies, cards, installment rows, 3 per card), total 36. A test counts every
  statement of the whole request, session lookup included, through `pg.Client.prototype.query`.
- D14: Money, dependencies and the network (NFR-02, NFR-03, NFR-04). `bigint` only; a scan test bans `parseFloat`,
  `toFixed`, `Math.round`, `Math.floor` and `Number(` in the module, its shared schema and its tests
  (`Number.parseInt` and `Number.isInteger` stay allowed). No `package.json` and no file under `apps/api/drizzle`
  changes; a test asserts that no dashboard request calls `fetch` or opens a socket and that the module imports no
  rates provider, price provider or job.
- D15: Performance (NFR-01, NFR-06). No snapshot and no cache (PRD out of scope). The benchmark reuses
  `movements-seed.ts`, adds 50 budgets, 500 holdings, 10 groups, 2 cards with installments, recurring payments and
  stored rates, and measures 20 runs over HTTP; a missed target is reported with the measured value and the
  options go back to the owner.

## Open questions for the owner
1. Month installments (D5): the dashboard counts the whole month's installments, as the PRD decision log (5)
   says, so mid-month it can exceed the 09a report over the same dates (AC-47 holds when every installment of the
   month is already due). The alternative is to count only those due by today, which makes both always equal.
2. Percent change with a negative previous value (D6): the PRD formula divides by the signed previous value, which
   flips the sign for a negative net result; the spec divides by its absolute value.

## Coverage: PRD → blocks
| Requirement | Covered by |
|---|---|
| FR-01 | Block 0, Block 2, Block 8 |
| FR-02 | Block 3, Block 4 |
| FR-03 | Block 4 |
| FR-04 | Block 4 |
| FR-05 | Block 5 |
| FR-06 | Block 5 |
| FR-07 | Block 5 |
| FR-08 | Block 6 |
| FR-09 | Block 7 |
| FR-10 | Block 7 |
| FR-11 | Block 3 |
| FR-12 | Block 5 |
| FR-13 | Block 2 |
| FR-14 | Block 2, Block 8 |
| FR-15 | Block 1, Block 4, Block 5, Block 6, Block 8 |
| FR-16 | Block 8 |
| NFR-01 | Strategy: aggregated reads per source, one SQL statement for all groups and none per movement, month or holding, sections run in parallel; Block 8 holds the benchmark with 100,000 movements, 50 budgets, 500 holdings and 10 groups at p95 under 1 s |
| NFR-02 | Strategy: `bigint` sums read as text, `convertMinorUnits` and integer percent functions only, integer strings in the response; Blocks 0, 3, 4, 5 and 6 build it and Block 8 scans for floats |
| NFR-03 | Strategy: composition of existing readers, no migration and no dependency; Block 8 checks the Drizzle folder and the pinned dependency lists |
| NFR-04 | Strategy: stored rates and prices only, no provider or job import; Block 8 spies on `fetch` and sockets |
| NFR-05 | Strategy: one statement per source, request-scoped zone reuse, installment rows read once for all cards (D13); Block 8 counts statements with the benchmark user at 40 or fewer |
| NFR-06 | Strategy: lists capped at 3, 20 and 20 entries, amounts as short strings; Block 8 measures the body of the benchmark user at 32 KB or less |

| Acceptance criteria | Covered by |
|---|---|
| AC-01, AC-02, AC-03 | Block 0, Block 2 (AC-02 also in Block 8) |
| AC-04, AC-05, AC-06, AC-07 | Block 4 |
| AC-08, AC-09, AC-10, AC-11 | Block 4 |
| AC-12, AC-13 | Block 4 |
| AC-14 to AC-19 | Block 5 |
| AC-20, AC-21, AC-22 | Block 5 |
| AC-23, AC-24, AC-25 | Block 5 |
| AC-26, AC-27, AC-28, AC-29 | Block 6 |
| AC-30 to AC-35 | Block 7 |
| AC-36, AC-37, AC-38 | Block 3 |
| AC-39, AC-40, AC-41 | Block 5 |
| AC-42, AC-43 | Block 2 (AC-42 also in Block 8) |
| AC-44, AC-46 | Block 2, Block 8 |
| AC-45 | Block 3, Block 8 |
| AC-47, AC-48 | Block 8 (AC-48 also in Block 6) |
| AC-49 | Block 8 |
| AC-50, AC-51, AC-52, AC-53, AC-54, AC-55 | Block 8 |

## Dependencies between blocks
Blocks 0 and 1 touch disjoint files (Block 0: `packages/shared`; Block 1: the barrels of five existing modules)
and run in parallel. Block 2 needs Block 0 (schema and types) and Block 1 (the reports exports). Blocks 3, 5, 6 and
7 need Blocks 1 and 2 and touch disjoint files, so they run in parallel. Block 4 needs Block 3 (the group balance
port) and runs once Block 3 is done, in parallel with whatever of 5, 6 and 7 remains. Block 8 runs last: it wires
the sections, the presenter, the server and the benchmark. Order: {0, 1}, 2, {3, 5, 6, 7}, 4, 8.

## Block 0 — Shared contract

**Files**
- `packages/shared/src/dashboard/dashboard.ts` (new) — query and response Zod schemas, enums and types.
- `packages/shared/src/index.ts` (modified) — exports the new file.
- `packages/shared/test/dashboard-contracts.test.ts` (new).

**Logic**
`dashboardQuerySchema` is `z.strictObject({})`. `dashboardResponseSchema` has `currency`, `today` and the nine
sections of FR-01. `netWorth`: `ars`, `usd`, `total` (nullable), `reason` (`'no_rate'` or null, set exactly when
`total` is null, enforced by a refinement), `holdingsWithoutPrice` (int), and `parts` with `accounts`,
`investments`, `groups` and `installmentDebt`, each `{ ars, usd }`. `month`: `from`, `to`, `expenses`, `income`,
`net`, `change` `{ expenses, income, net }` (whole numbers or null), `unconvertedShareCount`,
`unconvertedInstallmentCount`. `categories`: rows `{ categoryId (uuid or null), name, defaultKey (nullable),
amount, sharePercent }`. `budgets`: at most 3 rows `{ budgetId, name, currency, available, spent, percentUsed,
status }`. `upcoming` (at most 20): a discriminated union on `kind` (`recurring_payment` with `paymentId`,
`card_statement` with `cardId` and `statementId`), each with `date`, `name`, `currency`, `amount`. `actions` (at
most 20): `kind` (`overdue_occurrence`, `pending_occurrence`, `unpaid_statement`), `dueDate`, `name`,
`occurrenceId` or `statementId` and `cardId`. `groups`: `owedToYou` and `youOwe`, each `{ ars, usd }`. `insight`:
null or `{ categoryId, name, defaultKey, amount, sharePercent, changePercent }`. `firstSteps`: `hasAccount`,
`hasMovement`, `show`. Amounts use `exactIntegerStringSchema` (the 09a `reportCurrencySchema` and `localDateSchema`
are reused).

**Data model**
No stored data. Nullable: `total`, `reason`, `change.*`, `insight`, `insight.changePercent`, `categoryId`, `name`,
`defaultKey`. Defaults: none, every amount is a required integer string. Percent fields are `z.number().int()`
within +/-1,000,000, `status` and `kind` are enums.

**Input validation**
The query takes no key at all: any parameter fails the strict object. Response schemas refuse a JSON number, a
decimal string or an exponent as an amount, a `percentUsed` above 1,000 and lists above their caps.

**Error handling**
- A query with any key is an invalid input: the strict schema fails and the route answers 400.
- A response that breaks the schema (a number amount, `total` and `reason` both set) fails validation before
  sending, so a use case bug cannot reach the client.

**Required tests**
- [ ] A complete response parses and holds the sections `netWorth`, `month`, `categories`, `budgets`, `upcoming`,
      `actions`, `groups`, `insight` and `firstSteps` — validates AC-01
- [ ] The query schema is invalid with `?from=2026-10-01`, `?x=1` and an empty `?q=`, and valid with no key —
      validates AC-02
- [ ] An amount such as "12.5", "1e3", `142000000` as a JSON number or "" is invalid in every amount field, and
      "142000000" is valid — validates AC-03
- [ ] A `netWorth` with a `total` and a `reason` together, or with neither, fails the refinement — validates AC-09
- [ ] A budgets list of 4 rows, an upcoming list of 21 and an actions list of 21 are invalid — validates FR-08, FR-09, FR-10
- [ ] A `percentUsed` of 1001 and a change of 1,000,001 are invalid, a null change and a null insight are valid —
      validates FR-06, FR-12
- [ ] A `status` outside `on_track`, `close` and `over` is invalid — validates FR-08

**Completion criterion**
The listed tests pass, `pnpm typecheck` passes for `packages/shared` and `apps/api`, and the schemas are
importable from `@pesly/shared`.

## Block 1 — Exports of the source modules

**Files**
- `apps/api/src/reports/index.ts` (modified) — exports the flow, net worth and preference readers, the use-case
  ports and the pure rules the dashboard reuses.
- `apps/api/src/budgets/index.ts` (modified) — exports the Drizzle version and spending readers and the system clock.
- `apps/api/src/recurring/index.ts` (modified) — exports `ListUpcoming`, the two Drizzle readers, `UpcomingEntry` and the clock.
- `apps/api/src/credit-cards/index.ts` (modified) — exports `buildStatementViews`, `owesStatement`, `unpaidRemainder`, the card and installment readers and their ports.
- `apps/api/src/investments/index.ts` (modified) — exports `ListPortfolios`, the portfolio, holding and market price readers.
- `apps/api/test/dashboard/source-exports.test.ts` (new).

**Logic**
Only `export` lines are added; no behavior changes. From `reports`: `DrizzleReportPreferences`, `SystemClock`,
`DrizzleFlowReader`, `DrizzleAccountFlowReader`, `DrizzleInstallmentDebtReader`, `DrizzleNetWorthRateReader`,
`accumulate`, `assemblePoints`, `installmentDebt`, `convertRows`, `installmentMonthOf`, `matchShareCategory`,
`addToCategory`, `orderCategoryTotals` and the types `FlowReader`, `FlowWindow`, `NetWorthSources`,
`NetWorthWindow`, `NetWorthRateReader`, `CurrencyAmounts`, `TopCategory`. From `budgets`: `DrizzleBudgetVersionReader`,
`DrizzleSpendingReader`, `SystemClock`. From `recurring`: `ListUpcoming`, `DrizzleRecurringPaymentRepository`,
`DrizzleOccurrenceRepository`, `SystemClock`. From `credit-cards`: `buildStatementViews`, `owesStatement`,
`unpaidRemainder`, `DrizzleCreditCardRepository`, `DrizzleInstallmentRepository`, `StatementView`,
`InstallmentRow`, `InstallmentRepository`, `CardPurchases`, `CardPayments`. From `investments`: `ListPortfolios`,
`DrizzlePortfolioRepository`, `DrizzleHoldingRepository`, `DrizzleMarketPriceReader`, `PortfolioView`. A name that
collides with an existing export of the same barrel is exported under an alias.

**Data model**
No stored data and no change to any table; the files only re-export, with no default value and no check involved.

**Input validation**
Not applicable: no input surface is added.

**Error handling**
- A barrel export that creates a circular import fails the test that imports every barrel in a fresh process.
- A renamed or missing export fails type checking, never a runtime fallback.

**Required tests**
- [ ] Importing the five barrels and the dashboard-facing names from each yields defined functions and classes —
      validates FR-15
- [ ] A circular import error never appears when the five barrels load together in one fresh process — validates FR-15
- [ ] Every existing export of each barrel is still present (a snapshot of the previous export names), so no
      current import fails — validates NFR-03
- [ ] A missing dashboard-facing export is an error that names the barrel and the symbol — validates FR-15

**Completion criterion**
The listed tests pass, `pnpm typecheck` and `pnpm lint` pass, and the five existing suites of those modules are untouched and green.

## Block 2 — Module skeleton, route, context and first steps

**Files**
- `apps/api/src/dashboard/application/dashboard-context.ts` (new) — `DashboardContext`, `prepareDashboard`.
- `apps/api/src/dashboard/application/context-time-zones.ts` (new) — `ContextTimeZones`.
- `apps/api/src/dashboard/application/ports/dashboard-use-case.ts`, `first-steps-reader.ts` (new) — ports.
- `apps/api/src/dashboard/application/build-first-steps.ts` (new) — `buildFirstSteps`.
- `apps/api/src/dashboard/infrastructure/db/foreign-relations.ts`, `drizzle-first-steps-reader.ts` (new).
- `apps/api/src/dashboard/infrastructure/http/dashboard-routes.ts` (new) — `createDashboardRoutes`.
- `apps/api/test/dashboard/fakes.ts`, `route-harness.ts`, `dashboard-context.test.ts`, `context-time-zones.test.ts`,
  `first-steps.test.ts`, `dashboard-routes.test.ts` (new).

**Logic**
`prepareDashboard(deps, scope)` reads the preferences with the `ReportPreferencesReader` of `reports`, computes
`today` with `todayInTimeZone` and the clock, and returns `{ preferences, today, month, monthStart, userId }`.
`ContextTimeZones(userId, zone)` has `timeZoneOf(id)`, which returns the zone for its own user id and throws for any
other. `FirstStepsReader.firstStepsOf(scope)` runs one statement with two `exists` probes (a non-archived account
and any movement, both with the owner in the WHERE) and returns two booleans; `buildFirstSteps` adds `show`.
`createDashboardRoutes({ db, logger, useCase, clock? })` mounts `requireSession` and `requireVerifiedEmail` on
`/dashboard`, issues the read scope with `OwnerOrGroupMemberAccessPolicy` over `DenyAllGroupMembershipReader` as
`/reports` does, calls the injected `DashboardUseCase`, and logs the request id and user id only.

**API contract**
- Method + path: `GET /dashboard`
- Request: no body and no query parameter; the query is the strict empty object of Block 0.
- Response 200: `dashboardResponseSchema`, validated before sending; amounts are integer strings in minor units.
- Error codes: 400 `VALIDATION_FAILED` (any query parameter), 401 `UNAUTHENTICATED`, 403 `EMAIL_NOT_VERIFIED`,
  standard 5xx for a failed source. No 404: the route has no id.
- Auth: a verified session; the read scope of the caller, never a user id from the request.

**Data model**
Reads `users` (through the reports reader), `accounts` and `movements` by the owner column; nothing is written and no
column or index is added (the probes use `accounts` and `movements_owner_date_idx`). The booleans are never null.

**Input validation**
The route validates the query with `dashboardQuerySchema` through the shared `validate` middleware; the readers bind
the user id from the issued scope as a parameter.

**Error handling**
- A missing session answers 401 before any use case runs, and an unverified email answers 403.
- A query parameter answers 400 and the use case is not called.
- A missing user row is an error from the preferences reader (fail closed) and reaches the error middleware.

**Required tests** *(fakes for the use case, PostgreSQL for the reader)*
- [ ] A signed-in verified user gets 200 with a response that parses, from a fake use case — validates AC-01
- [ ] `?from=2026-10-01` and `?x=1` answer 400 `VALIDATION_FAILED`, return no data and never call the use case —
      validates AC-02
- [ ] A request with no session cookie answers 401, calls no use case and returns no data — validates AC-44
- [ ] An unverified email answers 403 `EMAIL_NOT_VERIFIED` with the body of the reports routes and no data —
      validates AC-46
- [ ] The scope handed to the use case is the caller's, and a user id in a header or query is ignored — validates AC-45
- [ ] A user with no account and no movement gets `hasAccount` false, `hasMovement` false and `show` true; with
      only an archived account `hasAccount` is false — validates AC-42
- [ ] A user with one account and one movement gets `show` false, and another user's rows never count — validates AC-43
- [ ] `ContextTimeZones` answers the zone for its user and throws for another id — validates FR-14
- [ ] `prepareDashboard` computes today in the stored zone, falls back for an invalid zone, and a missing user is
      an error — validates FR-05
- [ ] A use case that fails answers the standard 500 with no stack and no section — validates FR-16

**Completion criterion**
The listed tests pass, `pnpm typecheck` passes, and the route answers 200 with a fake use case.

## Block 3 — Group balances and the groups section

**Files**
- `apps/api/src/dashboard/application/ports/group-balance-reader.ts` (new) — `GroupBalanceReader`.
- `apps/api/src/dashboard/domain/group-totals.ts` (new) — per-group balances, owed and owing, net.
- `apps/api/src/dashboard/application/build-groups.ts` (new) — `buildGroups`.
- `apps/api/src/dashboard/infrastructure/db/drizzle-group-balance-reader.ts` (new).
- `apps/api/test/dashboard/group-totals-domain.test.ts`, `groups-section.test.ts`, `group-balance-reader.test.ts` (new).

**Logic**
`GroupBalanceReader.sourcesOf(scope)` returns, per group the caller is or was a member of, `{ groupId, memberId,
sources }` where `sources` is the `BalanceSourcesByCurrency` of `groups` holding only the caller's member: paid,
shares and legs per currency. One statement unions the four signed sources by group and currency from the caller's
member rows. `group-totals.ts` builds `balancesByCurrency(sources)` and `balancesOf(balances, memberId)` per group,
then returns `{ owedToYou, youOwe }` per currency (positive balances summed; negative ones summed as a positive
amount) and `netOf` (owed minus owing) for the net worth. `buildGroups(reader result)` returns the section.

**Data model**
Reads `group_members`, `group_expenses`, `group_expense_shares`, `group_settlements` and `group_settlement_legs`,
starting from the member rows whose `user_id` is the scope's user; nothing is written, no column or index is added
(`group_members` and the legs keys serve the joins). Sums are read as text; no balance is null (a missing source is 0).

**Input validation**
The only input is the issued scope; the user id is a bound parameter and no value from the request is read.

**Error handling**
- A database error is rethrown and no partial group result is returned.
- A row with an unknown currency is an invariant error and is thrown.

**Required tests** *(fakes for the domain, PostgreSQL for the reader)*
- [ ] Group A owes the user 30,000.00 ARS and the user owes 50.00 USD in group B: owed to you 3000000 ARS and you
      owe 5000 USD, with 0 in the other two cells — validates AC-36
- [ ] Owed 30,000.00 ARS in one group and owing 20,000.00 ARS in another give both amounts and never their
      difference, while the net is 10,000.00 ARS — validates AC-37
- [ ] A group the user left with a zero balance contributes nothing, and a left group with a balance still counts —
      validates AC-38
- [ ] The per-group balance equals `GetBalances` of the groups module for the same fixture, and the summed net
      equals the 09a group reader at today — validates FR-11, FR-15
- [ ] An invalid foreign row check: members of other users and groups the caller never joined never appear — validates AC-45
- [ ] Settlement legs sent and received change the balance as in the 04e formula — validates FR-11
- [ ] A database error rejects the whole read and returns no group — validates FR-16
- [ ] An unknown currency row is an invalid source and fails with an error — validates FR-16

**Completion criterion**
The listed tests pass against PostgreSQL and `pnpm typecheck` passes.

## Block 4 — Net worth section

**Files**
- `apps/api/src/dashboard/application/ports/investment-valuation.ts` (new) — `InvestmentValuation`.
- `apps/api/src/dashboard/domain/net-worth-now.ts` (new) — window of the single point, parts, assembly input.
- `apps/api/src/dashboard/application/build-net-worth.ts` (new) — `buildNetWorth`.
- `apps/api/src/dashboard/infrastructure/investments/portfolio-valuation.ts` (new) — adapter over `ListPortfolios`.
- `apps/api/test/dashboard/net-worth-now-domain.test.ts`, `net-worth-section.test.ts`, `portfolio-valuation.test.ts` (new).

**Logic**
`InvestmentValuation.valueNow(scope)` returns `{ ARS, USD, holdingsWithoutPrice }`: the adapter runs
`ListPortfolios.execute` and sums each portfolio's `totals` per currency and its `holdingsWithoutPrice` (a holding
with no price counts 0). `buildNetWorth(deps, scope, context, groupNet)` builds the one-point window of D4, reads
`accountFlows`, `installmentDebtRows`, the rate and the investments in parallel, calls `accumulate` for the
account part and `installmentDebt` for the debt, and calls `assemblePoints` with the investments of `valueNow`,
the group part `groupNet` (from Block 3) as the baseline and the display currency, so `total` and `reason` follow
09a. The section returns the two parts and `total`, the four parts per currency and `holdingsWithoutPrice`.
Archived accounts are excluded by the 09a reader.

**Data model**
Reads only, through the 09a readers, `portfolios`, `holdings` and the stored crypto prices through
`ListPortfolios`, and `exchange_rates`; no column or index is added. Nullable: `total` and `reason`, set as a pair.

**Input validation**
No request input: the scope, today and the preferences come from the context; the rate reader binds the rate type
and the date as parameters.

**Error handling**
- A missing rate is not an error: a non-zero foreign part gives `total` null and `reason` `no_rate`, a zero foreign
  part gives the home part as `total`.
- A source error is rethrown and no part is guessed.

**Required tests** *(fakes for the sources, PostgreSQL for the adapter)*
- [ ] Accounts 1,000,000.00 ARS, investments 500,000.00 ARS, group receivable 50,000.00 and debt 20,000.00 and
      pending installments 110,000.00 give an ARS part of 142000000 — validates AC-04
- [ ] 1,000.00 USD in accounts and 20.00 USD of group debt give a USD part of 98000 and the ARS part is unchanged —
      validates AC-05
- [ ] An archived account is not in the net worth — validates AC-06
- [ ] The section returns accounts, investments, groups and installment debt separately, each with ARS and USD —
      validates AC-07
- [ ] Display ARS, USD part 1,000.00 and a stored sell rate of 1,500.0000 count 1,500,000.00 ARS in `total` —
      validates AC-08
- [ ] A non-zero USD part with no stored rate gives a null `total`, the reason `no_rate` and both parts — validates AC-09
- [ ] A zero USD part with no stored rate gives the ARS part as `total` and no reason — validates AC-10
- [ ] Display USD with an ARS part of 1,500,000.00 at 1,500.0000 gives 1,000.00 USD with the rounding of
      `convertMinorUnits` — validates AC-11
- [ ] A crypto holding with a stored price is valued from it and `fetch` is never called — validates AC-12
- [ ] A holding with no price counts 0 and `holdingsWithoutPrice` is 1 — validates AC-13
- [ ] The ARS and USD parts equal the 09a `assemblePoints` result for the same inputs apart from the investments —
      validates FR-15
- [ ] A source or rate reader error rejects the section and no part is returned — validates FR-16

**Completion criterion**
The listed tests pass and the section over fake sources returns the hand-computed parts of AC-04 and AC-05.

## Block 5 — Month flows, categories and insight

**Files**
- `apps/api/src/dashboard/domain/percent.ts` (new) — `wholePercent`, `changePercent`, `insightChange`, `toJsonInt`.
- `apps/api/src/dashboard/domain/period.ts` (new) — month periods and the clamped previous period.
- `apps/api/src/dashboard/domain/month-flows.ts` (new) — folds converted rows into the month, categories and insight.
- `apps/api/src/dashboard/application/build-month-flows.ts` (new) — `buildMonthFlows`.
- `apps/api/test/dashboard/percent-domain.test.ts`, `period-domain.test.ts`, `month-flows-domain.test.ts`,
  `month-flows-section.test.ts` (new, fakes).

**Logic**
`period.ts` returns, for today T, `{ month, first, monthEnd, previousMonth, previousFrom, previousTo, history }`
(D5): `previousTo` is the same day of month clamped to the last day of the previous month, and `history` is
M3..M1. `buildMonthFlows(deps, scope, context)` makes the six reads of D5 with the `FlowReader` of `reports`
(`personalRows`, `shareRows`, `installmentRows`, `topCategories`), converts with `convertRows`, folds the
month-to-date, the previous period and the three months, and returns `month` (expenses, income, net, the three
changes, the unconverted counts of the current month), `categories` and `insight` (D6, D7). Installments are placed
by `installmentMonthOf` against the whole month. A top-level category missing from `topCategories` is an invariant
error.

**Data model**
No stored data; reads through the `FlowReader` of `reports`, no column or index is added. Nullable: every change
and the insight; the amounts are never null and default to 0n for an empty period.

**Input validation**
No request input: today, the zone and the display currency come from the context, and the windows are built with
`localDayBounds` from validated local dates.

**Error handling**
- A personal row with no frozen rate is an invariant error and is thrown, as in the reports.
- A reader error is rethrown with no partial section.

**Required tests** *(fakes, then the domain functions)*
- [ ] October personal expenses of 200,000.00 ARS, group shares of 30,000.00 and installments of 10,000.00 give
      expenses of 240,000.00 ARS — validates AC-14
- [ ] Incomes of 800,000.00 and expenses of 240,000.00 give income 800,000.00 and net 560,000.00 — validates AC-15
- [ ] A 20.00 USD expense with a frozen rate of 1,400.0000 counts 28,000.00 ARS whatever today's stored rate is —
      validates AC-16
- [ ] A group expense of 30,000.00 paid by the user with a share of 10,000.00 and a personal payer movement counts
      10,000.00 — validates AC-17
- [ ] A share or installment in another currency with no rate is left out and the counts in `month` are 1 and 1 —
      validates AC-18
- [ ] Transfers and exchanges never reach the rows, so they change neither income nor expenses — validates AC-19
- [ ] Expenses 1 to 15 October of 240,000.00 against 200,000.00 for 1 to 15 September give a change of 20 —
      validates AC-20
- [ ] A previous period value of 0 gives a null change — validates AC-21
- [ ] On 31 March the previous period ends on 28 February (29 in a leap year), on 30 April it ends on 30 March —
      validates AC-22
- [ ] Food 120,000.00 and Transport 80,000.00 give Food 12000000 with a share of 60, then Transport 8000000 with 40 —
      validates AC-23
- [ ] An expense in Groceries under Food adds to Food and there is no Groceries row — validates AC-24
- [ ] A month with no expense gives an empty `categories` list, a null insight and zero values — validates AC-25, AC-41
- [ ] Restaurants at 32% of the month and 40% above the average of July to September gives an insight with
      Restaurants, a share of 32 and a change of 40 — validates AC-39
- [ ] Fewer than 3 of the previous 3 months with expenses gives the insight with a null change — validates AC-40
- [ ] The percent functions truncate toward zero, clamp at 1,000,000 and give null for a zero previous value, and a
      negative previous net result uses its absolute value — validates FR-06
- [ ] A top-level category missing from `topCategories` and a personal row with no frozen rate are errors —
      validates FR-16
- [ ] The month expenses equal the 09a expenses report over the same dates when every installment is already due —
      validates FR-15

**Completion criterion**
The listed tests pass and the section over a fake fixture with a parent category, a group share and an installment
equals the hand-computed values.

## Block 6 — Budgets section

**Files**
- `apps/api/src/dashboard/domain/budget-highlights.ts` (new) — `budgetStatus`, `topBudgets`.
- `apps/api/src/dashboard/application/build-budgets.ts` (new) — `buildBudgets`.
- `apps/api/test/dashboard/budget-highlights-domain.test.ts`, `budgets-section.test.ts` (fakes),
  `budgets-section-flow.test.ts` (PostgreSQL) (new).

**Logic**
`buildBudgets(deps, scope, context)` builds `SpendingDependencies` for the request (`timeZones` is a
`ContextTimeZones`, the readers and the clock are injected), calls `computeSpending(deps, scope)` and passes the
result to `topBudgets`, which sorts by `percentUsed` descending with a stable sort, keeps 3 and adds the status of
D8. The fields are `budgetId`, `name`, `currency`, `available`, `spent`, `percentUsed`, `status`. Amounts are
never converted.

**Data model**
No stored data; the budgets reads are the existing 06c ones, no column or index is added. `percentUsed` is an
integer from 0 to 1,000 and never null; the list is empty when no budget is in force.

**Input validation**
No request input; the month is the current one by omission and the scope is the caller's.

**Error handling**
- A budget calculation error is rethrown and the section is not returned.
- A zero or negative available amount is rejected by the 06c domain function and reaches the error middleware.

**Required tests** *(fakes for the domain, PostgreSQL for the flow)*
- [ ] Budgets at 50%, 85%, 105% and 30% return the 105% one `over`, the 85% one `close` and the 50% one
      `on_track`, in that order, without the 30% one — validates AC-26
- [ ] Exactly 80% is `close` and exactly 100% is `over`, 79% is `on_track` and 99% is `close` — validates AC-27
- [ ] A USD budget and an ARS budget keep their own currency and are compared by percentage with no conversion —
      validates AC-28
- [ ] With no budget in force the list is empty — validates AC-29
- [ ] The percentage of each returned budget equals the `percentUsed` of the budgets spending list for the same
      data, rollover included — validates AC-48
- [ ] Two budgets at the same percentage keep the older one first — validates FR-08
- [ ] A spending read error rejects the section and returns no budget — validates FR-16
- [ ] An invalid available amount is an error that reaches the middleware — validates FR-16

**Completion criterion**
The listed tests pass against PostgreSQL and `pnpm typecheck` passes.

## Block 7 — Upcoming and actions

**Files**
- `apps/api/src/dashboard/domain/agenda.ts` (new) — routing, ordering and caps.
- `apps/api/src/dashboard/application/ports/account-currency-reader.ts`, `card-statement-source.ts` (new) — ports.
- `apps/api/src/dashboard/application/build-agenda.ts` (new) — `buildAgenda`.
- `apps/api/src/dashboard/infrastructure/db/drizzle-account-currency-reader.ts` (new).
- `apps/api/src/dashboard/infrastructure/credit-cards/drizzle-card-statement-source.ts` (new).
- `apps/api/test/dashboard/agenda-domain.test.ts`, `agenda-section.test.ts`, `card-statement-source.test.ts` (new).

**Logic**
`buildAgenda(deps, scope, context)` asks the recurring source (a `ListUpcoming` built per request with a
`ContextTimeZones`) for its entries, reads the currencies of their accounts with `currenciesOf(scope, ids)` (one
statement), and asks `CardStatementSource.dueStatements(scope, today)` for the stored statements with
`dueDate <= today + 7`. The source returns `{ cardId, cardName, statementId, dueDate, closed, owed: { ARS, USD } }`:
its adapter lists the cards, reads all installment rows once and serves them to `buildStatementViews` per card
from memory, so each card costs three statements (D9, D13). `agenda.ts` applies the routing rules, ordering and
caps of D9. A recurring entry becomes `recurring_payment` in `upcoming` with its payment id, a statement owed in a
currency becomes `card_statement` with its card id, statement id and that currency; occurrences become actions with
their occurrence id.

**Data model**
No stored data; reads `accounts` by id and owner, the card and statement readers of `credit-cards`, and the
occurrences through `ListUpcoming` (which writes only the idempotent pending rows of its own module). No column or
index is added; the currency map has no null entries for the caller's own accounts.

**Input validation**
No request input; the account ids are bound as an array parameter and are those of the caller's own payments.

**Error handling**
- An entry whose account is not found in the caller's accounts is an invariant error and is thrown, never given a
  guessed currency.
- A source error is rethrown and neither list is returned.

**Required tests** *(fakes for the domain and use case, PostgreSQL for the adapters)*
- [ ] A recurring payment due in 3 days and a card statement due in 6 days are both in `upcoming`, the payment
      first — validates AC-30
- [ ] An entry due in 8 days and a paid statement are not listed — validates AC-31
- [ ] With 25 entries in the next 7 days the response holds the 20 earliest by date — validates AC-32
- [ ] One pending occurrence, one overdue occurrence and one unpaid closed statement due in 2 days give 3 actions,
      the overdue one first, each with its occurrence or statement id — validates AC-33
- [ ] With nothing to resolve `actions` is empty — validates AC-34
- [ ] A fully paid closed statement is in neither list, a partly paid one is in `actions` and an item is never in
      both lists — validates AC-35
- [ ] The request materializes the pending occurrences exactly as the upcoming list does, twice in a row leaves one
      row per due date, and reads the account currencies once — validates FR-09
- [ ] A recurring entry with an unknown account is an error and gets no guessed currency — validates FR-16
- [ ] A statement source error rejects the section and returns neither list — validates FR-16
- [ ] The statement source reads the installment rows once for 3 cards and creates no statement — validates NFR-05

**Completion criterion**
The listed tests pass against PostgreSQL and the section over fakes returns the hand-ordered lists.

## Block 8 — Composition, ownership flows, scans and benchmark

**Files**
- `apps/api/src/dashboard/application/get-dashboard.ts` (new) — `GetDashboard`.
- `apps/api/src/dashboard/infrastructure/http/present-dashboard.ts` (new) — `bigint` to integer strings.
- `apps/api/src/dashboard/index.ts` (new) — `createDashboardRoutes({ db, logger, clock?, useCase? })` with the default composition.
- `apps/api/src/server.ts` (modified) — registers the dashboard routes.
- `apps/api/test/dashboard/get-dashboard.test.ts`, `dashboard-flow.test.ts`, `dashboard-parity.test.ts`,
  `no-float-dashboard.test.ts`, `no-outbound.test.ts`, `boundaries.test.ts`, `dependencies.test.ts`,
  `statement-counter.ts` (new).
- `apps/api/test/perf/dashboard.perf.test.ts` (new) — the benchmark; it reuses `movements-seed.ts`.

**Logic**
`GetDashboard.execute(scope)` calls `prepareDashboard`, starts the group balance read once, awaits `Promise.all`
over `buildNetWorth`, `buildMonthFlows`, `buildBudgets`, `buildAgenda`, `buildGroups` and `buildFirstSteps`, and
passes the results to the presenter, with no `catch` (D12). `createDashboardRoutes` builds the Drizzle readers
(reports, budgets, recurring, credit cards, investments, the three of this module), the card statement source and
the portfolio valuation, creates the request-scoped budgets and recurring dependencies from the context, and
returns the router of Block 2. The flow test seeds two users with accounts, movements, a group, a card with
installments, budgets, recurring payments and holdings. The parity test compares the figures with the 09a net
worth and expenses reports, the budgets spending list and the group balances. The benchmark seeds 100,000
movements re-dated over 24 months, 50 budgets, 500 holdings (crypto among them), 10 groups with expenses, 2 cards
with installments, recurring payments, stored rates and 40 top-level categories with spending, and times 20
runs over HTTP after 2 warm-up runs; the statement counter wraps `pg.Client.prototype.query` for the whole
request. The scan tests read the sources of the module, `packages/shared/src/dashboard` and the tests.

**Data model**
Reads only; the benchmark inserts rows for its own user and deletes them afterwards. No check, index or migration is
added, and the dependency test asserts that `apps/api/drizzle` and both `package.json` files are unchanged.

**Input validation**
The flow test sends a query parameter and a missing session through the real routes and the real validation
middleware, never around them.

**Error handling**
- A failing source answers the standard 5xx with no section, no stack and no SQL in the body.
- A missed benchmark target is reported with the measured value, never loosened silently; a leftover outbound call
  or float token fails the scan tests and names the file.

**Required tests** *(PostgreSQL; the benchmark with `pnpm test:perf`)*
- [ ] A query parameter answers 400 with no data through the real routes — validates AC-02
- [ ] Every amount of the real response is an integer string and the response parses with the shared schema —
      validates AC-03, AC-51
- [ ] A user with no account and no movement gets `show` true and every other section with zero values or empty
      lists — validates AC-42
- [ ] A request with no session answers 401 with no data and an unverified user answers 403 — validates AC-44, AC-46
- [ ] With two users each response holds only the caller's accounts, shares, balances, budgets and cards, and a
      group member sees only their own shares — validates AC-45
- [ ] For the same user and date the month expenses equal the 09a expenses report total and the ARS and USD parts
      equal the last point of the 09a net worth report apart from the investments part — validates AC-47
- [ ] The percentage of each budget equals the one of the budgets endpoint — validates AC-48
- [ ] A source made to fail (a reader that throws) answers 500 and returns no section — validates AC-49
- [ ] The benchmark user answers in under 1 s at p95 over 20 runs, with real figures in every section — validates
      AC-50, NFR-01
- [ ] The source scan finds no `parseFloat`, `toFixed`, `Math.round`, `Math.floor` or `Number(` in the module, its
      shared schema or its tests — validates AC-51
- [ ] `apps/api/drizzle` and the dependency lists of `apps/api/package.json` and `packages/shared/package.json`
      equal the pinned ones — validates AC-52
- [ ] `fetch` is never called and no socket is opened while the dashboard runs, and no file of the module imports
      a provider or a job — validates AC-53
- [ ] The whole request, session lookup included, runs 40 statements or fewer for the benchmark user, none per
      movement, month or holding — validates AC-54
- [ ] The body for the benchmark user is 32 KB or less — validates AC-55
- [ ] The module imports other modules only through their barrels and the domain and application layers import no
      infrastructure — validates D1
- [ ] A failed benchmark run reports the measured p95, the statement count and the body size — validates NFR-05

**Completion criterion**
The flow, parity, scan and boundary tests pass against PostgreSQL, the benchmark reports p95 under 1 s, 40
statements or fewer and a body of 32 KB or less, and `pnpm lint`, `pnpm typecheck` and the full test suite pass.

## Final verification
Every AC of the PRD has at least one named test (see the coverage tables). `pnpm install --frozen-lockfile`,
`pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm test:perf` pass; no file is added under `apps/api/drizzle`
and no dependency changes; the dashboard of a seeded user equals the hand-computed fixtures, its month expenses and
net worth parts equal the 09a reports under the stated condition, and its budget percentages equal the budgets
endpoint.

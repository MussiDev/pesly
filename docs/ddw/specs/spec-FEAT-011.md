# Spec FEAT-011: Budgets by statement month, and available money on the home screen

| Field | Value |
|-------|-------|
| Ticket | FEAT-011 |
| PRD | docs/ddw/prd/prd-FEAT-011.md |
| Tier | FEATURE |
| Date | 2026-10-13 |
| Spec loops | 1 |
| Loops since last human decision | 1 |

## Summary

Budgets read their spending through one port, `SpendingReader`, whose `personalSpending` sums expense
movements by purchase date and which has no installments at all. The change gives the port two more
reads, `cardPurchaseSpending` and `installmentSpending`, that return card expenses with the statement
they belong to, and makes `personalSpending` leave out every expense movement on a card's linked
account. The placement rule that turns a statement row into a `YYYY-MM` due month moves from the
reports module to `packages/shared`, so reports and budgets import one rule instead of keeping a copy.
`computeSpending` places each card row in the current or previous month bucket by that due month and
feeds it to the same `spendingOf` calculation; installments in another currency than the budget are
left out and counted in a new `unconvertedInstallmentCount`. Every consumer of `computeSpending`
(budget list, budget detail, alert evaluation, dashboard highlights) picks it up unchanged. The budget
screens reuse the existing `CardPurchasesNote`. Separately, the dashboard response gets an `available`
section computed by the accounts module's own `ListAccounts` totals, converted with the net worth
rate, and the home screen shows it beside the net worth. No migration: every month is computed on read.

## Coverage: PRD → blocks

| Requirement | Covered by |
|---|---|
| FR-01 | Block 3 (reader), Block 4 (placement in buckets) |
| FR-02 | Block 2 (rows and domain), Block 3 (installment read), Block 4 |
| FR-03 | Block 1 (shared rule), Block 3 (statement lookup and fallback period) |
| FR-04 | Block 3 (card-account test in the exclusion) |
| FR-05 | Block 3 (exclusion from the date-based sum), Block 4 |
| FR-06 | Block 3 (only expense movements and installments are read) |
| FR-07 | Block 2 (frozen rate; installments in the other currency left out and counted), Block 4, Block 5 |
| FR-08 | Block 4 (one calculation for list, detail, alerts and dashboard highlights) |
| FR-09 | Block 3 (computed on read, no write) |
| FR-10 | Block 5 |
| FR-11 | Block 6 (API), Block 7 (screen) |
| FR-12 | Block 6, Block 7 |
| FR-13 | Block 6 (accounts rule reused, not rewritten) |
| NFR-01 | Strategy: two extra grouped queries per budget read, joined by card and statement, no per-row or per-budget query; the existing perf tests run unchanged in Block 8 |
| NFR-02 | Strategy: every condition goes through `scopedTo` with the caller's owner column, as the other readers do; the accounts section reads through `ListAccounts`, which is already owner-scoped |
| NFR-03 | Strategy: sums stay bigint read as text; conversion is the existing `convertAmount` and the shared money helpers |
| NFR-04 | Block 5 and Block 7: the notes and the tile use data the screens already hold; no request is added |
| NFR-05 | Strategy: tests of every block, run with coverage on the changed files; no `any` |
| NFR-06 | Strategy: `available` joins the existing `GET /dashboard` response, built in the parallel section reads already there; the dashboard perf test runs unchanged in Block 8 |

## Dependencies between blocks

Block 2 and Block 3 depend on Block 1 (the shared rule). Block 3 depends on Block 2 (row types and
port). Block 4 depends on Blocks 2 and 3. Block 5 depends on Block 4 (the new response field). Block 6
is independent of Blocks 1 to 5 and can run in parallel. Block 7 depends on Block 6. Block 8 depends on
all the others. Order: 1, 2, 3, 4, 5, 6, 7, 8.

## Block 1 — Shared placement rule

**Files**
- `packages/shared/src/credit-cards/statement-month.ts` (new) — `installmentDueDate` and
  `statementDueMonth` (the due date of a statement row and its `YYYY-MM`), moved from
  `apps/api/src/reports/domain/flows.ts`.
- `packages/shared/src/index.ts` (modified) — exports the new file.
- `apps/api/src/reports/domain/flows.ts` (modified) — imports the rule from `@pesly/shared` and keeps
  `installmentMonthOf` as a wrapper over it, so its callers do not change.
- `packages/shared/test/statement-month.test.ts` (new) — unit tests of the rule.
- `apps/api/test/reports/` flow-domain tests (modified) — keep passing against the wrapper.

**Logic**
The rule is the one FEAT-010 uses: a row has a statement `period`, the stored due date when the
statement exists and `null` otherwise, and the card's `closingDay` and `dueDay`. The due date is the
stored one, or the one `statementDatesFor` computes. `statementDueMonth` returns the `YYYY-MM` of that
due date. `installmentMonthOf(row, from, to)` keeps its inclusive range filter by calling it.

**Error handling**
- A row whose closing and due days give no valid date: `statementDueMonth` falls back to the row's
  `period` month and does not throw (the purchase is then counted in its own statement month).

**Required tests**
- [ ] A stored due date in a later month than the period gives that month — validates AC-04.
- [ ] No stored due date uses the card's closing and due days — validates AC-05.
- [ ] A statement due in the month after its period (closing 24 Sep, due 5 Oct) gives `2026-10` —
      validates AC-01 (rule level).
- [ ] The row with unusable days falls back to the period month and does not fail — validates AC-14.
- [ ] The reports' existing placement tests pass through the wrapper unchanged — validates AC-12
      (no behaviour change for reports).

**Completion criterion**
`pnpm --filter ./packages/shared test` and the reports flow-domain tests pass, the reports module no
longer defines the rule, and `pnpm typecheck` is clean.

## Block 2 — Budgets domain, row types and port

**Files**
- `apps/api/src/budgets/domain/spending.ts` (modified) — adds `CardPurchaseRow` and
  `InstallmentSpendingRow`, and extends `spendingOf` with the card rows and an
  `unconvertedInstallmentCount` result.
- `apps/api/src/budgets/application/ports/spending-reader.ts` (modified) — adds
  `StatementSpendingRow`, `cardPurchaseSpending` and `installmentSpending` to `SpendingReader`. The rows carry the statement fields, and the use case derives the due month in Block 4.
- `apps/api/test/budgets/fakes.ts` (modified) — `FakeSpendingReader` implements the two new reads.
- `apps/api/test/budgets/spending-fixtures.ts` (modified) — builders for the new rows.
- `apps/api/test/budgets/spending-domain.test.ts` (modified) — unit tests of the calculation.
- `apps/api/test/budgets/no-float-spending.test.ts` (modified) — covers the new rows.

**Logic**
`CardPurchaseRow` has `categoryId`, `currency`, the movement's frozen `rate`, `sum`, and the statement
fields (`period`, `dueDate`, `closingDay`, `dueDay`). `InstallmentSpendingRow` is the same without a
rate. `spendingOf(...)` adds a card purchase row like a personal row (it throws on a missing frozen
rate, as today). An installment row in the budget's currency is added; an installment row in the other
currency is not added and adds its `count` to `unconvertedInstallmentCount`. The category match stays on
the exact `categoryId` through the covered ids: budgets do not roll subcategories up to a top category,
so a budget that covers a subcategory counts the card expenses of that subcategory and no others,
exactly as its date-based sum does today.

**Error handling**
- A card purchase row without a frozen rate: `RangeError('A personal expense needs a frozen rate')`,
  as for a personal row.
- An installment row in the other currency: not an error; it is left out and counted.

**Required tests**
- [ ] A card purchase row in the budget currency adds its sum — validates AC-01 (calculation level).
- [ ] A card purchase in USD with a frozen rate is converted with that rate — validates AC-09.
- [ ] An installment in the budget currency is added; one in the other currency is left out and counted
      (5,000.00 ARS counted, 10.00 USD counted as 1 not converted) — validates AC-27.
- [ ] A card purchase row with a missing frozen rate fails with `RangeError`.
- [ ] An installment in the other currency raises no error: it is left out and counted.
- [ ] A row whose category the budget does not cover adds nothing.
- [ ] No money value in the new rows is a float — validates NFR-03.

**Completion criterion**
`spending-domain.test.ts`, `no-float-spending.test.ts` and the fake-backed tests pass; the domain
imports nothing from infrastructure (`domain.test.ts` rule).

## Block 3 — Drizzle spending reader

**Files**
- `apps/api/src/budgets/infrastructure/db/foreign-relations.ts` (modified) — re-exports `creditCards`,
  `creditCardStatements`, `installments` and `installmentPurchases`.
- `apps/api/src/budgets/infrastructure/db/drizzle-spending-reader.ts` (modified) — leaves card-account
  expenses out of `personalSpending`; implements `cardPurchaseSpending` and `installmentSpending`.
- `apps/api/test/budgets/spending-reader.test.ts` (modified) — integration tests against PostgreSQL.
- `apps/api/test/budgets/spending-query-plan.test.ts` (modified) — the plan of the new queries.

**Logic**
`personalSpending` adds the exclusion `notExists(credit_cards where type = expense and the movement's
account is the card's ARS or USD account of the same owner)`, the one `personalConditions` has in
reports. The statement lookup and this exclusion are deliberate copies of the reports' SQL, because a
module does not import another module's readers and the repository already keeps such copies in step
with a parity test; Block 8's parity test is the guard against drift and covers the fallback cycle and
the card without a stored statement. `cardPurchaseSpending(scope, window, categoryIds, timeZone)` is a copy of the reports'
`cardPurchaseRows` statement lookup: the purchase's calendar day in the user's zone, the first stored
statement closing on or after it, and otherwise the cycle the card's days give but never one at or
before the last stored statement. It groups by statement, category, account currency and frozen rate,
reads no purchase-date bound (the statement places it), then the reader keeps the rows whose due month
falls inside the two bucket months. `installmentSpending(scope, window, categoryIds)` reads installments
by the period of their statement, joined to the stored statement for its due date, grouped by statement,
category and purchase currency. Both read only `movements.categoryId` and
`installmentPurchases.categoryId` in `categoryIds`, and every query goes through `scopedTo`.

**Error handling**
- A card whose statement has no stored row and gives no cycle: the purchase falls back to the period of
  its own date and is returned, never dropped or failed.
- An empty `categoryIds`: returns no rows without querying, as `personalSpending` does.

**Required tests**
- [ ] The 30,000.00 ARS purchase of 2026-09-20 on a card closing 24 Sep and due 5 Oct is returned in the
      October bucket and not in the September bucket — validates AC-01, AC-07.
- [ ] A purchase dated 2026-09-25 is returned for the next statement — validates AC-03.
- [ ] An edited stored due date moves its purchases and installments to that month — validates AC-04.
- [ ] A purchase on a statement not stored yet uses the computed due date — validates AC-05.
- [ ] A 60,000.00 ARS purchase in 6 installments returns 10,000.00 ARS for each statement — validates
      AC-02.
- [ ] An 8,000.00 ARS expense on a bank account is still returned by `personalSpending` in September —
      validates AC-06.
- [ ] A statement payment (transfer to the card) appears in no read — validates AC-08.
- [ ] A purchase of 20.00 USD returns its frozen rate — validates AC-09.
- [ ] A card with a missing statement and no resolvable cycle returns the purchase and does not fail —
      validates AC-14.
- [ ] Another user's card purchase and installment in the same period never appear — validates AC-16.
- [ ] Already stored purchases are read under the new rule with no migration — validates AC-12.
- [ ] An empty category list returns no rows and issues no query, without raising an error.
- [ ] The query plan of the new reads uses the card and statement indexes (no sequential scan of
      movements by row) — validates NFR-01.

**Completion criterion**
`spending-reader.test.ts` and `spending-query-plan.test.ts` pass against PostgreSQL, and a movement on
a card account appears in exactly one of `personalSpending` and `cardPurchaseSpending`.

## Block 4 — Use cases, callers and response

**Files**
- `apps/api/src/budgets/application/compute-spending.ts` (modified) — reads the two new rows, buckets
  them by due month, and returns `unconvertedInstallmentCount`.
- `apps/api/src/budgets/infrastructure/http/spending-presenter.ts` (modified) — presents the new field.
- `packages/shared/src/budgets/spending.ts` (modified) — `unconvertedInstallmentCount` in the spending
  response contract.
- `apps/api/src/dashboard/application/build-budgets.ts` (modified) — carries the field into the
  dashboard budget highlights where the budget response is reused.
- `apps/api/test/budgets/spending-use-cases.test.ts`, `spending-flow.test.ts`,
  `spending-routes.test.ts`, `alerts-use-case.test.ts`, `alerts-flow.test.ts` (modified).
- `apps/api/test/dashboard/budgets-section.test.ts`, `budgets-section-flow.test.ts` (modified).
- `apps/api/test/budgets/` exports test and `dashboard/test/source-exports.test.ts` (modified if the
  exported names change).

**Logic**
`computeSpending` passes the user's time zone to the card read, decides the bucket of a statement row by
comparing its `statementDueMonth` to the month and the previous month (a row outside both is ignored),
and passes the bucketed rows to `spendingOf`. `list-budget-spending`, `get-budget-spending`,
`evaluate-budget-alerts` and `build-budgets` already call `computeSpending`, so rollover (previous
month), the alert thresholds and the dashboard highlights read the same corrected spending.

**API contract**
- Method + path: `GET /budgets/spending`, `GET /budgets/:id/spending` (existing; the response is
  modified).
- Request: unchanged (`month` query as `YYYY-MM`, optional).
- Response: unchanged fields plus `unconvertedInstallmentCount: integer >= 0` on every budget spending
  item.
- Error codes: unchanged (`400` invalid month, `404` budget not found or not the caller's, `401`).
- Auth: session and verified email, as today; the data is scoped to the caller.

**Error handling**
- A month in the future: `BudgetMonthInFuture`, unchanged.
- A budget that is not the caller's: `404`, never `403`.

**Required tests**
- [ ] The budget spending of October counts the September-dated purchase and the first installment —
      validates AC-01, AC-02.
- [ ] A purchase counts once across September and October: the two months add to the purchase —
      validates AC-07.
- [ ] Rollover carries the leftover of a month with a card purchase, from the new rule — validates
      AC-10.
- [ ] An alert fires in the month of the statement when a card purchase crosses a threshold —
      validates AC-11.
- [ ] The response carries `unconvertedInstallmentCount` for a USD installment in an ARS budget —
      validates AC-27.
- [ ] The dashboard budget highlights show the same spent as the budget endpoint for the same data —
      validates FR-08.
- [ ] A budget of another user answers `404`.
- [ ] A future month returns the `BudgetMonthInFuture` error.
- [ ] The budgets and the reports give the same amount for the same categories, month and data —
      validates the parity requirement of the goals.

**Completion criterion**
The listed budget and dashboard-budget tests pass, every `computeSpending` caller type-checks, and the
shared schema parses the new response.

## Block 5 — Budget screens: card note and installment notice

**Files**
- `apps/web/src/features/budgets/helpers/budget-view.ts` (modified) — carries
  `unconvertedInstallmentCount`.
- `apps/web/src/features/budgets/components/unconverted-notice.tsx` (modified) — counts shares and
  installments left out.
- `apps/web/src/features/budgets/list/budgets-list.tsx` (modified) — mounts `CardPurchasesNote` in
  `BudgetsHeader`.
- `apps/web/src/features/budgets/detail/budget-detail-view.tsx` (modified) — mounts `CardPurchasesNote`
  and passes both counts to the notice.
- `apps/web/src/features/budgets/list/budget-card.tsx` (modified) — passes both counts to the notice.
- `apps/web/test/budgets-list.test.tsx`, `budget-detail.test.tsx`, `card-purchases-note.test.tsx`,
  `budgets-catalog.test.ts`, `budgets-no-hardcoded-strings.test.ts` (modified).

**Logic**
The note reuses the existing `CardPurchasesNote` component and its `cardPurchasesNote.text` key, which
already exist in both catalogs, so no key is added to the `budgets` namespace. The unconverted notice
sums `unconvertedShareCount + unconvertedInstallmentCount`, the same way the dashboard adapter does for
its months.

**Error handling**
- A response without `unconvertedInstallmentCount` fails the shared schema parse and shows the screen's
  existing failure state; no value is guessed.

**Required tests**
- [ ] The budget list and the budget detail show the card purchases note in Spanish and in English —
      validates AC-13.
- [ ] A budget with 1 installment not converted shows the notice with that count — validates AC-27.
- [ ] Both catalogs carry the same keys and no string is hardcoded — validates AC-13.
- [ ] The screens issue the same requests as before — validates AC-17.
- [ ] A response missing the new field shows the failure state, not a notice with a wrong count.

**Completion criterion**
The listed web tests pass with `npx vitest run` and the budgets screens render the note in both
languages.

## Block 6 — Dashboard available money: API

**Files**
- `packages/shared/src/dashboard/dashboard.ts` (modified) — adds `dashboardAvailableSchema` and the
  `available` field of the response.
- `apps/api/src/accounts/index.ts` (modified) — also exports `DrizzleAccountRepository`, the only
  adapter `ListAccounts` needs from this module; the movement sums come from `createAccountMovements`
  in the movements barrel, which the dashboard already imports.
- `apps/api/src/dashboard/application/build-available.ts` (new) — builds the section from the accounts
  totals and the rate.
- `apps/api/src/dashboard/application/build-net-worth.ts` (modified) — also returns the rate it read,
  so the available section converts with the same rate without a second read.
- `apps/api/src/dashboard/application/get-dashboard.ts`, `dashboard-context.ts` (modified) — run the
  section in the parallel reads and pass it on.
- `apps/api/src/dashboard/infrastructure/http/present-dashboard.ts` (modified) — presents it.
- `apps/api/src/dashboard/index.ts` (modified) — composes `ListAccounts`.
- `apps/api/test/dashboard/boundaries.test.ts` (modified) — adds `accounts` to `SOURCE_MODULES`.
- `apps/api/test/dashboard/available-section.test.ts` (new), `fakes.ts`, `world-fixtures.ts`,
  `route-harness.ts`, `dashboard-routes.test.ts`, `get-dashboard.test.ts`, `dashboard-flow.test.ts`,
  `dashboard-parity.test.ts`, `net-worth-section.test.ts` (modified).
- `packages/shared/test/dashboard-contracts.test.ts` (modified).

**Logic**
`buildAvailable` runs `ListAccounts.execute(scope, { limit: 1, offset: 0 })` and takes its
`availableTotals` (ARS and USD); the totals are computed from all the active accounts, not from the
page, so the limit does not change them. They are
the balances of the active accounts marked "include in available": the accounts screen shows
exactly these, so the two screens agree by construction and the flag is the only filter (an archived
account is not listed, savings count only if the user marked them, a credit card account never carries
the flag). It adds no investments, no group balances and no card debt. The converted total uses the
current rate the net worth section already read, with the same `NetWorthParts` conversion; when the rate
is missing the section returns the two parts, `total: null` and the same reason the net worth uses.

**API contract**
- Method + path: `GET /dashboard` (existing; the response is modified).
- Request: unchanged.
- Response: unchanged sections plus `available: { ars: string, usd: string, total: string | null,
  reason: 'rate_unavailable' | null }`, amounts as exact integer strings in minor units, `total` and
  `reason` both null or both set, as `netWorth` does.
- Error codes: unchanged (`401`, `403` unverified email).
- Auth: session and verified email, as today; the data is the caller's own.

**Error handling**
- The accounts read fails: the dashboard section fails as the other sections do (the error is not
  swallowed and no amount is guessed).
- The rate is missing: the section answers `total: null` with its reason and the two parts.

**Required tests**
- [ ] 100,000.00 ARS in a bank account and 50.00 USD in a wallet, both included, give those two parts —
      validates AC-18.
- [ ] The home section and `ListAccounts` give equal available parts for the same data — validates
      AC-19.
- [ ] With the rate present the total is the parts converted with that rate — validates AC-20.
- [ ] With the rate missing the response has the two parts, `total: null` and the reason — validates
      AC-21.
- [ ] An archived account and an account not marked "include in available" add 0 — validates AC-22.
- [ ] A credit card with debt and an investment portfolio do not change the available — validates
      AC-23.
- [ ] Another user's included account never counts — validates AC-24.
- [ ] The endpoint adds no request and the dashboard perf test keeps its threshold — validates AC-25.
- [ ] An accounts read error fails the dashboard section and is not swallowed.
- [ ] The dashboard boundaries test accepts `accounts` only through its barrel.

**Completion criterion**
The dashboard API tests and `dashboard-contracts.test.ts` pass, `pnpm typecheck` is clean, and
`GET /dashboard` returns `available` parsed by the shared schema.

## Block 7 — Dashboard available money: web and i18n

**Files**
- `apps/web/src/features/dashboard/dashboard-view.ts` (modified) — `AvailableView`.
- `apps/web/src/features/dashboard/contract/dashboard-adapter.ts` (modified) — maps the section.
- `apps/web/src/features/dashboard/components/net-worth-card.tsx` (modified) — the available tile beside
  the net worth.
- `apps/web/src/features/dashboard/components/dashboard-screen.tsx`, `dashboard-skeleton.tsx` (modified).
- `apps/web/messages/en.json`, `apps/web/messages/es.json` (modified) — `dashboard` namespace keys.
- `apps/web/test/dashboard-net-worth.test.tsx`, `dashboard-adapter.test.ts`, `dashboard-catalog.test.ts`,
  `dashboard-container.test.tsx`, `dashboard-screen-month-notice.test.tsx`, `dashboard-first-steps.test.tsx`,
  `api-client-dashboard.test.ts`, `i18n-catalogs.test.ts` (modified).
- `apps/web/e2e/support/dashboard-fixtures.ts`, `e2e/support/dashboard.ts` (modified).

**Logic**
The net worth card shows an "available" tile with the converted total when it exists, and the ARS and
USD parts as the net worth does; when the total is null it shows the same conversion-unavailable notice
and the parts. The labels come from the `dashboard` catalog in both languages.

**Error handling**
- A response without `available` fails the shared schema parse and the screen shows its existing failure
  state.
- `total` null: the tile shows the notice and the parts, no converted figure.

**Required tests**
- [ ] The home screen shows the available money with its ARS and USD parts — validates AC-18.
- [ ] With a converted total the tile shows it in the display currency — validates AC-20.
- [ ] With the total missing the tile shows the notice and the two parts — validates AC-21.
- [ ] The label is read from the Spanish and the English catalog and both carry the same keys —
      validates AC-26.
- [ ] The home screen issues the same requests as before — validates AC-25.
- [ ] A response missing `available` shows the failure state.

**Completion criterion**
The listed web tests pass and the home screen renders the tile in both languages.

## Block 8 — End to end, parity and performance

**Files**
- `apps/web/e2e/credit-cards-spending-month.spec.ts` (modified) — a budget step.
- `apps/web/e2e/dashboard.spec.ts`, `apps/web/e2e/investments.spec.ts` (modified) — the available tile.
- `apps/api/test/reports/budget-parity.test.ts`, `apps/api/test/reports/flow-fixtures.ts` (modified) —
  card and installment cases through budgets and reports.
- `apps/api/test/perf/budget-spending.perf.test.ts`, `budget-alerts.perf.test.ts`,
  `dashboard.perf.test.ts` (run; modified only if the seed needs card rows).

**Logic**
The e2e flow creates a card, records the 30,000.00 ARS purchase of 2026-09-20 and checks that the
October budget consumes it and the September one does not, and that the home screen shows the available
money. The parity test builds one dataset and compares budgets and reports for the same categories and
month.

**Error handling**
- The perf tests are known to flake near their limit: a failure is rerun once before it is read as a
  regression, and no threshold is changed.

**Required tests**
- [ ] e2e: the October budget counts the September purchase; the September budget does not — validates
      AC-01, AC-07.
- [ ] e2e: the home screen shows the available money in Spanish and English — validates AC-18, AC-26.
- [ ] Parity: budgets and reports return the same spending for card purchases and installments —
      validates FR-08.
- [ ] Parity: the fallback cycle and a card without a stored statement place the purchase in the same
      month in budgets and in reports — validates AC-05.
- [ ] The three perf tests pass at their existing thresholds — validates AC-15, AC-25.
- [ ] A transfer payment of the statement counts in neither budgets nor reports — validates AC-08.
- [ ] A flaky perf failure is rerun once and no threshold is changed (error path of the gate).

**Completion criterion**
`pnpm e2e` for the three specs, the parity test and `pnpm test:perf` pass with 0 threshold changes.

## Final verification

- Every AC of the PRD has a test in the blocks above (AC-01 to AC-27).
- `pnpm typecheck`, `pnpm lint`, `pnpm test` and the coverage floor of 80% hold.
- A card purchase appears in exactly one month of every budget, report and dashboard figure.
- The accounts screen and the home screen show the same available money.
- No migration was added and no threshold of a perf test was changed.

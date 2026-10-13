# Spec FEAT-010: Count card purchases in the month their statement is due

| Field | Value |
|-------|-------|
| Ticket | FEAT-010 |
| PRD | docs/ddw/prd/prd-FEAT-010.md |
| Tier | FEATURE |
| Date | 2026-10-12 |
| Spec loops | 1 |
| Loops since last human decision | 1 |

## Summary

The reports and the dashboard read their spending through one port, `FlowReader`. Today an expense
movement on a card's linked account comes out of `personalRows` by its own date, and installments come
out of `installmentRows` by the due date of their statement. The change gives the port a third method,
`cardPurchaseRows`, that returns the card purchases as rows shaped like installment rows (a statement
period, the stored due date or none, the card's closing and due days) plus the movement's frozen rate.
`personalRows` stops returning expense movements on card accounts. The three consumers (the two
reports and the dashboard month flows) add the new rows to the installment rows before the code they
already have places each row in a month by due date, so the placement rule, the month window and the
conversion are the existing ones. The web app only gets a note, next to the notices the three
screens already show. No endpoint, schema or migration changes; the month is computed on read.

## Coverage: PRD → blocks

| Requirement | Covered by |
|---|---|
| FR-01 | Block 1 (rows), Block 2 (reports) |
| FR-02 | Block 2 (dashboard) |
| FR-03 | Block 1 (statement lookup and fallback period) |
| FR-04 | Block 1 (card-account test in the exclusion) |
| FR-05 | Block 1 (exclusion from the date-based rows), Block 2 |
| FR-06 | Block 1 (only expense movements are read), Block 2 |
| FR-07 | Block 1 (the movement's frozen rate in the row), Block 2 |
| FR-08 | Block 1 (account and tag conditions), Block 2 |
| FR-09 | Block 1 (computed on read, no write) |
| FR-10 | Block 3 |
| NFR-01 | Strategy: one extra query per read, joined by card and statement, no per-row query; the existing perf tests run unchanged in Block 2 |
| NFR-02 | Strategy: every condition goes through `scopedTo` with the caller's owner column, as the other readers do |
| NFR-03 | Strategy: sums stay bigint read as text; conversion is the existing `convertRows` |
| NFR-04 | Block 3: the notes use data the screens already hold; no request is added |
| NFR-05 | Strategy: tests of every block, run with coverage on the changed files |

## Dependencies between blocks

Block 2 depends on Block 1 (the port method). Block 3 is independent of the API blocks and can run
after them. Order: 1, 2, 3.

## Block 1 — Reader: card purchase rows and the exclusion

**Files**
- `apps/api/src/reports/application/ports/flow-reader.ts` (modified) — adds `CardPurchaseFlowRow`
  (an `InstallmentFlowRow` whose `rate` is the movement's frozen `bigint`) and
  `cardPurchaseRows(scope, periodFrom, periodTo, options)`, where the options are the user's
  `timeZone` and the optional `accountId` and `tag`.
- `apps/api/src/reports/infrastructure/db/flow-conditions.ts` (modified) — splits the owner, group
  payer, account and tag conditions out of `personalConditions` so the new query reuses them, and
  adds the exclusion of expense movements on a card's linked account from `personalConditions`.
- `apps/api/src/reports/infrastructure/db/drizzle-flow-reader.ts` (modified) — implements
  `cardPurchaseRows`.
- `apps/api/src/reports/index.ts` (modified) — exports the new row type.
- `apps/api/test/dashboard/fakes.ts` and the fake flow readers of `apps/api/test/reports` (modified) —
  implement the new port method.
- `apps/api/test/reports/card-purchase-rows.test.ts` (new) — integration tests against PostgreSQL.

**Logic**
`cardPurchaseRows` selects the caller's expense movements whose account is `credit_cards.ars_account_id`
or `credit_cards.usd_account_id` of one of the caller's cards, leaves out the payer movement of a group
expense (its share counts instead), applies the optional account and tag filters, and reads for each
movement its local day in the user's time zone. The statement of a movement is found as in
DISC-001-10b: the stored statement of the card with the earliest closing date that is on or after the
day (a day before every stored cycle goes to the first one). The row carries that statement's `period`
and `dueDate`; when no stored statement closes on or after the day, the row carries a fallback period
(the day's month when its day of the month is on or before the card's closing day, else the next
month, and never a period at or before the last stored statement's), a null `dueDate` and the
card's closing and due days, so the existing
`installmentDueDate` computes the due date. Rows are grouped by (period, due date, closing day, due
day, top category, currency, frozen rate) and sums are read as text. Only periods in
`[periodFrom, periodTo]` are returned. No purchase-date window is applied: a purchase long before the
first stored cycle still belongs to that cycle, and a window would make the figure of a month depend
on the range asked for; the read is still one grouped query over the caller's card-account expenses
only. The
exclusion in `personalConditions` removes expense movements on a card account and keeps income
movements, and expense movements on other accounts, as they are.

**Data model**
No change. Reads `movements`, `accounts`, `credit_cards` and `credit_card_statements` (all with their
existing constraints and indexes); no table, column, index or migration is added or changed.

**Error handling**
- A card purchase without a frozen rate cannot be stored (`movements_shape_check`); the read keeps a
  guard that throws `A flow movement has no frozen rate` if one ever appeared, as `personalRows` does.
- An expense without a category cannot be stored either; the read keeps the same kind of guard.
- A card whose statements are not stored yet — the row falls back to the computed period and never
  fails.

**Required tests**
- [ ] A purchase of 30,000.00 ARS dated 2026-09-20 on a card closing on the 24th and due on the 5th
      comes back with the September statement's period and its stored due date of 2026-10-05 —
      validates AC-01, AC-03
- [ ] A purchase dated 2026-09-25 comes back with the next statement's period — validates AC-03
- [ ] A statement whose stored due date was edited comes back with the edited date — validates AC-04
- [ ] A purchase with no stored statement closing on or after its day comes back with a null due date,
      the fallback period and the card's days — validates AC-05
- [ ] An error case: a card whose days give no valid due date still returns the row, with the
      fallback, and does not fail — validates AC-14
- [ ] An expense on a bank account is not returned, and `personalRows` still returns it in its own
      month — validates AC-07
- [ ] An expense on a card account is returned by `cardPurchaseRows` and not by `personalRows`, so the
      two sums add it exactly once — validates AC-08
- [ ] A transfer and an exchange into the card account are returned by neither method — validates AC-09
- [ ] The row carries the movement's frozen rate — validates AC-10
- [ ] The account filter and the tag filter narrow the card rows — validates AC-11
- [ ] A card purchase of another user in the same period is not returned — validates AC-16
- [ ] A purchase dated long before the first stored statement comes back, with the same row, for a
      narrow range and for a wide one — validates AC-01, AC-03
- [ ] A purchase dated after a statement whose closing date was edited by hand, with no later statement
      stored, falls in the cycle after the last stored statement — validates AC-05
- [ ] The payer movement of a group expense is not returned, because its share counts instead —
      validates AC-08
- [ ] A tag filter containing a quote and SQL text is treated as plain text and returns no rows —
      threat R-02
- [ ] The database rejects an expense without a frozen rate with an error (`movements_shape_check`),
      so the guard of the read has no reachable input — error case
- [ ] The database rejects an expense without a category with an error — error case
- [ ] A purchase stored before the change is read under the new rule with no migration step — validates
      AC-12

**Completion criterion**
`card-purchase-rows.test.ts` passes against PostgreSQL and the existing reports and dashboard tests
pass with the fakes updated; `pnpm typecheck` passes.

## Block 2 — The reports and the dashboard read the card purchases

**Files**
- `apps/api/src/reports/application/get-expenses-by-category.ts` (modified) — calls `cardPurchaseRows`
  with the period range and filters, and adds its rows to the installment rows before the placement.
- `apps/api/src/reports/application/get-income-expenses.ts` (modified) — the same.
- `apps/api/src/dashboard/application/build-month-flows.ts` (modified) — the same, with the periods it
  already uses for installments, so the current month holds the whole month.
- `apps/api/test/reports/card-purchase-flows.test.ts` (new) — both reports through the real reader.
- `apps/api/test/dashboard/card-purchases-dashboard.test.ts` (new) — the dashboard month flows, and
  the parity of dashboard and reports on the same data.
- `apps/api/test/reports/expenses-by-category-use-case.test.ts`,
  `apps/api/test/reports/income-expenses-use-case.test.ts` and
  `apps/api/test/dashboard/month-flows-section.test.ts` (modified) — the use cases on fake readers,
  with the card purchase error cases.

**Logic**
Installment rows are still read only when no account or tag filter is active (their existing rule);
card purchase rows are read in every case (FR-08). Both lists go through the same placement code
(`installmentMonthOf` against the range, then the month period), so a purchase falls in the month of
its statement's due date and in no other. Card purchase rows are converted with their frozen rate by
`convertRows`; installment rows with no rate keep today's conversion. The dashboard places each row
in the current month, a history month or the previous comparison month as it does for installments.

**Error handling**
- The reader throws on a corrupt purchase — the use case lets the error reach the shared error
  middleware, as for the other flow rows.
- A card purchase row whose top category is not among the known categories — the dashboard throws a
  `RangeError` as it does for installments.

**Required tests**
- [ ] Expenses by category: the 2026-09-20 purchase counts in October and not in September — validates
      AC-01
- [ ] Income versus expenses: the same purchase is October spending and September has none — validates
      AC-02
- [ ] Dashboard: the current month of October includes the purchase and September does not — validates
      AC-06
- [ ] Dashboard and reports give the same October spending on the same data — validates AC-06, AC-01
- [ ] An expense on a bank account on 2026-09-20 counts in September in the reports and the dashboard —
      validates AC-07
- [ ] The two months together hold the purchase once — validates AC-08
- [ ] A statement payment of 30,000.00 ARS from a bank account counts as 0 spending and 0 income in
      both — validates AC-09
- [ ] A 20.00 USD purchase with its frozen rate converts to ARS with that rate — validates AC-10
- [ ] A report filtered by the card account or by a tag counts the purchase in October — validates AC-11
- [ ] A purchase of another user does not reach the caller's figures — validates AC-16
- [ ] A purchase with no stored statement and a card without usable days counts in the purchase month
      and the read does not fail — validates AC-14
- [ ] The existing latency benchmarks of reports and dashboard pass at their current thresholds with
      `pnpm test:perf` — validates AC-15
- [ ] A corrupt purchase without a frozen rate fails the read with an error, and no partial report is
      returned — error case
- [ ] A top category missing from the known categories makes the dashboard fail with a `RangeError`,
      as it does for an installment — error case

**Completion criterion**
The two new test files pass against PostgreSQL, the existing reports, dashboard and budget-parity tests
still pass, and `pnpm test:perf` passes with 0 threshold changes.

## Block 3 — The note on the screens

**Files**
- `apps/web/src/components/card-purchases-note.tsx` (new) — the one-line note that card purchases
  count in the month their statement is due.
- `apps/web/src/features/reports/categories/categories-screen.tsx`,
  `apps/web/src/features/reports/income-expenses/income-expenses-screen.tsx` and
  `apps/web/src/features/dashboard/components/dashboard-screen.tsx` (modified) — show the note next
  to the notices they already show.
- `apps/web/messages/en.json` and `apps/web/messages/es.json` (modified) — the same new key
  `cardPurchasesNote.text`.
- `apps/web/test/card-purchases-note.test.tsx` (new) — the note alone and on the two report screens.
- `apps/web/test/dashboard-screen-month-notice.test.tsx` (modified) — the dashboard note.
- `apps/web/e2e/credit-cards-spending-month.spec.ts` (new) and `apps/web/e2e/support/database.ts`
  (modified) — one scenario with a card purchase and a statement moved to be due this month.

**Logic**
The note is a presentational component with a fixed catalog string, so no prop and no request is
added. The existing notices keep rendering nothing when they have nothing to say; the card note shows
whenever the figures of the screen show.

**Error handling**
- The catalogs lack a key — the existing catalog parity tests fail the build, so a missing key is a
  failing test and not a runtime error.
- A screen in an error state shows no figures — the note is not shown without figures, so an error
  state shows no note.

**Required tests**
- [ ] The reports note renders in Spanish and in English from the catalogs — validates AC-13
- [ ] The dashboard note renders in Spanish and in English from the catalogs — validates AC-13
- [ ] A missing or empty catalog key fails the parity test: the catalogs have the same keys — validates AC-13
- [ ] An error state of the reports and of the dashboard shows no note and fails nothing else — error case
- [ ] Loading the reports and the dashboard issues the same requests as before — validates AC-17
- [ ] e2e: a card purchase made today is in the movements list and is not this month's spending while
      its statement is due later, and counts once the statement is due this month — validates AC-01,
      AC-06

**Completion criterion**
The new and changed web tests pass, the catalog parity tests pass, and the e2e scenario passes against
a local PostgreSQL; `pnpm typecheck`, `eslint` and `prettier --check` pass.

## Final verification

- Every AC-01 to AC-17 has at least one test, and every failure path of the blocks has one.
- A card purchase is counted once across the date-based rows and the statement-based rows.
- The reports and the dashboard agree on the same data; budgets and the movements list are untouched.
- No migration, no new dependency, no `any`, and `pnpm test:perf` passes at its current thresholds.

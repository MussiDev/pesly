# Test run DISC-001-09a

| Field | Value |
|---|---|
| Runner | vitest (V8 coverage via @vitest/coverage-v8), full suite with coverage |
| Command | `pnpm test:coverage` (Vitest over `apps/api/src`, `apps/web/src` and `packages/shared/src` together, V8 coverage, `TEST_DATABASE_URL` pointing at the local PostgreSQL) |
| Total | 9625 |
| Passed | 9625 |
| Failed | 0 |
| Skipped | 0 |
| Line coverage | 96.82 |
| Branch coverage | 90.04 |
| Function coverage | 94.96 |
| Statement coverage | 94.96 |
| Coverage floor | 80% lines, branches and functions (AGENTS.md, "Testing") |

## Scope

Full-suite run on the worktree of DISC-001-09a (578 test files), measured over `apps/api/src`, `apps/web/src` and `packages/shared/src` together, as AGENTS.md requires. The ticket adds the `reports` module in `apps/api` (three read-only reports: expenses by category, income and expenses per month, net worth per month end), the shared contracts and range helpers in `packages/shared/src/reports`, one migration (0038, additive: table `exchange_rate_history`, seeded from the stored rates and written by the existing rate refresh) and no dependency. No screen and no dashboard route are added.

Run anomalies and the fix: the first full run had one failing test, the build-output deploy test (`apps/api/test/deploy/build-output.test.ts`), whose table list did not include the new table `exchange_rate_history`. The list was fixed and the full run was repeated: 9625 of 9625 pass. The figures above are those of the repeated run.

After that run the independent module verifier reported a Medium finding (net worth investments carried a stale per-currency snapshot). It was fixed with a failing-first test, and three tests were added in `apps/api/test/reports/net-worth-sources.test.ts` ("does not carry a currency that the portfolio stopped having after an older snapshot day", "sums every currency row of the portfolio latest snapshot day on or before the point", "picks the latest snapshot day per portfolio, not across portfolios"). They are not counted in the 9625 above, which is the figure of the full run before the fix.

Performance (`pnpm test:perf`, `apps/api/test/perf/reports.perf.test.ts`, 100,000 movements, 20 runs over HTTP, limit 2 s, NFR-01): run separately from the full suite.

| Report | Range | p95 |
|---|---|---|
| Expenses by category | 24 months | 176.7 ms |
| Income and expenses | 12 months | 77.4 ms |
| Net worth | 24 months | 161.6 ms |

## Acceptance criteria to tests

Folder `apps/api/test/reports` unless a path is given; `shared:` is `packages/shared/test`. The flow tests (`*-flow.test.ts`, `flow-reader.test.ts`, `net-worth-sources.test.ts`, `filter-reader.test.ts`) run the real readers over PostgreSQL.

| AC | Tests |
|---|---|
| AC-01 | `expenses-by-category-use-case.test.ts` "returns one row per top-level category with id, name and amount (AC-01, AC-02)"; `expenses-by-category-flow.test.ts` "equals the hand-computed values for a parent, two children, a share and an installment" |
| AC-02 | the same use-case test (AC-01, AC-02) and the same flow test (a subcategory counted in its parent) |
| AC-03 | `expenses-by-category-use-case.test.ts` "returns an empty list and a total of 0 when there is no expense (AC-03)" |
| AC-04 | `expenses-by-category-use-case.test.ts` "rejects a range of 25 months and reads nothing (AC-04)"; `shared:report-range.test.ts` "counts 2025-01-31 to 2025-02-01 as 2 touched months (AC-04)" and "rejects 25 touched months for the 24 limits and 13 for income and expenses (AC-04, AC-06)"; `net-worth-use-case.test.ts` "rejects a range over 24 months before any source runs" |
| AC-05 | `shared:report-range.test.ts` "rejects a from after to and a to after today, naming the field (AC-05)"; `report-routes.test.ts` (malformed date and range answered 400 through the shared validation middleware) |
| AC-06 | `income-expenses-use-case.test.ts` "rejects a 13 month range and accepts 12 months with from and to (AC-06)"; `shared:report-range.test.ts` "accepts exactly 24 and 12 months (AC-06)" |
| AC-07 | `income-expenses-use-case.test.ts` "defaults to the 12 months ending in the current one, each with income and expenses (AC-07)"; `shared:report-range.test.ts` "defaults to 12 months ending today for income and expenses (AC-07)" |
| AC-08 | `income-expenses-use-case.test.ts` "returns "0" income and "0" expenses for a month with no movement (AC-08)"; `income-expenses-domain.test.ts` "returns one entry per month in order, zero for a month with no flow (AC-08)" |
| AC-09 | `shared:report-range.test.ts` "returns 12 month ends in order for 2025-10 to 2026-09 (AC-09)"; `net-worth-use-case.test.ts` "returns 12 points in date order for 2025-10-01 to 2026-09-30" |
| AC-10 | `shared:report-contracts.test.ts` "parses a net worth point with a total or with a no_rate reason (AC-10)" and "refuses a point that sets both or neither of total and reason (AC-10)"; `net-worth-domain.test.ts` "adds accounts, investments and groups and subtracts the installment debt per currency" |
| AC-11 | `flow-reader.test.ts` "keeps only the movements with the tag, matched case-insensitively (AC-11)" |
| AC-12 | `flow-reader.test.ts` "keeps only the movements of the account named (AC-12)"; `income-expenses-use-case.test.ts` "passes the account filter and the instant bounds to the personal read (AC-12)"; `income-expenses-flow.test.ts` "filters by account and by tag and skips shares and installments (AC-12, AC-24)" |
| AC-13 | `filter-reader.test.ts` "matches a tag case-insensitively and never sees the tags of another user" (untagged by number); `flow-reader.test.ts` the case-insensitive tag test (AC-11) |
| AC-14 | `flow-reader.test.ts` "applies the half-open window to the instants of a Buenos Aires month (AC-14)"; `shared:report-range.test.ts` "spans March 2026 in Buenos Aires from 03:00Z to 03:00Z of April (AC-14)" |
| AC-15 | `flow-domain.test.ts` "converts 20.00 USD at a frozen 1,400.0000 to 28,000.00 ARS (AC-15)"; `flow-reader.test.ts` "keeps the 20.00 USD expense in USD with its frozen rate, whatever the stored rates become (AC-15, AC-16)"; `income-expenses-use-case.test.ts` "adds income rows to income and expense rows to expenses, converted with the frozen rate (AC-15, AC-22)" |
| AC-16 | `flow-reader.test.ts` the frozen-rate test (AC-15, AC-16); `reports-flow.test.ts` "keeps a frozen-rate expense unchanged after the stored rates and history change (AC-16)" |
| AC-17 | `flow-domain.test.ts` "converts 30,000.00 ARS at a frozen 1,500.0000 to 20.00 USD (AC-17)" |
| AC-18 | `flow-domain.test.ts` "matches the personal category by the effective name, case-insensitively (AC-18)" and "adds the share to the personal rows of the category: 50,000.00 + 10,000.00 = 60,000.00 (AC-18)"; `expenses-by-category-use-case.test.ts` "adds a matched share, and folds an unmatched one into a null category row (AC-18, AC-20)" |
| AC-19 | `flow-reader.test.ts` "leaves out the payer movement of a group expense (AC-19)" and "returns only the caller shares and never those of other users or of other members (AC-44)" |
| AC-20 | `flow-domain.test.ts` "gives null when nothing matches (AC-20)"; `expenses-by-category-use-case.test.ts` the matched and unmatched share test (AC-18, AC-20) |
| AC-21 | `flow-domain.test.ts` "leaves out a share in USD with no frozen rate and counts its shares, not its rows (AC-21)"; `flow-reader.test.ts` "counts 3 shares of one row with count(*) when someone else paid in USD (AC-21)"; `expenses-by-category-use-case.test.ts` "leaves out a share in the other currency with no rate and counts it (AC-21)" |
| AC-22 | `flow-reader.test.ts` "returns income only from income movements and never transfers or exchanges (AC-22)"; `income-expenses-use-case.test.ts` the income and expense conversion test (AC-15, AC-22) |
| AC-23 | `flow-domain.test.ts` "uses the stored due date of the statement (AC-23)" and "derives the due date from the card days when no statement is stored (AC-23)"; `expenses-by-category-use-case.test.ts` "adds the installment due inside the range to its purchase category (AC-23)" and "derives the due date when no statement is stored (AC-23)"; `flow-reader.test.ts` "returns the stored due date of a stored statement, in the category of its purchase (AC-23)" and "returns a null due date when no statement is stored and the card days to derive it (AC-23)"; `income-expenses-flow.test.ts` "adds the installments of the due month to the expenses (AC-23)" |
| AC-24 | `expenses-by-category-use-case.test.ts` "reads no shares or installments with an account or tag filter (AC-24)"; `income-expenses-use-case.test.ts` "never calls the share or installment readers with an account or a tag filter (AC-24)" and "adds the shares and the installments of their due month to the expenses without filters (AC-24)"; `income-expenses-flow.test.ts` the account and tag test (AC-12, AC-24) |
| AC-25 | `expenses-by-category-use-case.test.ts` "leaves out an installment in the other currency and counts it (AC-25)"; `income-expenses-use-case.test.ts` "leaves an installment in USD out of an ARS display and counts it (AC-25)"; `flow-reader.test.ts` "keeps an installment in USD with its currency so the use case can count it (AC-25)" |
| AC-26 | `net-worth-sources.test.ts` "accumulates an opening balance, an April expense and a July income" and "puts what happened before the range in the baseline"; `net-worth-domain.test.ts` "adds opening, baseline and every bucket up to each point month" (untagged by number) |
| AC-27 | `net-worth-sources.test.ts` "(AC-27) leaves the total unchanged by a transfer between two ARS accounts and moves value in an exchange" |
| AC-28 | `flow-reader.test.ts` "buckets 01:00 UTC on 1 July in June for Buenos Aires and in July for UTC (AC-28)"; `net-worth-sources.test.ts` "buckets a movement at 01:00 UTC on 1 July in June for Buenos Aires" |
| AC-29 | `net-worth-sources.test.ts` "(AC-29) excludes an archived account with its movements, settlements and opening balance" |
| AC-30 | `net-worth-sources.test.ts` "(AC-30) uses the latest snapshot on or before the point date"; and, after the Medium fix, "picks the latest snapshot day per portfolio, not across portfolios" |
| AC-31 | `net-worth-sources.test.ts` "counts 0 and marks the point incomplete for a portfolio created before it with no snapshot" (untagged by number) |
| AC-32 | `net-worth-sources.test.ts` "(AC-32) counts 0 and does not mark a portfolio created after the point" |
| AC-33 | `net-worth-sources.test.ts` "(AC-33) adds what members owe the user and subtracts what the user owes, former groups included" |
| AC-34 | `net-worth-sources.test.ts` "(AC-34) puts a settlement dated after the month end in no bucket of that point" |
| AC-35 | `installment-debt-domain.test.ts` "(AC-35, AC-36) subtracts the installments whose statement closes after the point, from stored or derived dates"; `net-worth-sources.test.ts` "reads the rows of a purchase with stored and derived closing dates" |
| AC-36 | the same `installment-debt-domain.test.ts` test (AC-35, AC-36) |
| AC-37 | `net-worth-rate-reader.test.ts` "(AC-37) uses the latest history row on or before each past date and never a later one"; `net-worth-use-case.test.ts` "(AC-37) converts with the default rate type and the rate of the point date, never a later one" |
| AC-38 | `net-worth-use-case.test.ts` "(AC-38) returns both components, a null total and no_rate without a rate"; `net-worth-domain.test.ts` "returns a null total and no_rate when the rate is missing and the foreign part is non-zero" |
| AC-39 | `net-worth-domain.test.ts` "(AC-39) converts the USD component to ARS with the point rate (display ARS)" and "divides the ARS component by the rate in display USD" |
| AC-40 | `apps/api/test/exchange-rates/rate-history-write.test.ts` "(AC-40) two refreshes on the same Argentina day leave one row per type with the second values" |
| AC-41 | `apps/api/test/exchange-rates/rate-history-migration.test.ts` "(AC-41) seeds one history row per stored rate, dated by fetched_at in Argentina" |
| AC-42 | `shared:report-range.test.ts` "dates the current month point today and keeps past month ends (AC-42)"; `net-worth-use-case.test.ts` "ends a range that includes the current month with a point dated today" |
| AC-43 | `reports-flow.test.ts` "answers 404 for an account or a tag of another user, and 401 with no session (AC-43, AC-45)"; `filter-reader.test.ts` "owns the account of the caller and never one of another user or an unknown one" |
| AC-44 | `reports-flow.test.ts` "shows a group member only their own share, never an amount of another member (AC-44)"; `flow-reader.test.ts` "returns only the caller shares and never those of other users or of other members (AC-44)" |
| AC-45 | `reports-flow.test.ts` the 404 and 401 test (AC-43, AC-45) |
| AC-46 | `reports-flow.test.ts` "return only the caller figures for expenses by category (AC-46)", "return only the caller months for income and expenses (AC-46)" and "return only the caller snapshots, accounts, shares and installments in net worth (AC-46)"; `flow-reader.test.ts` "never returns the movements of another user (AC-44, AC-46)" |
| AC-47 | `apps/api/test/perf/reports.perf.test.ts` "reports latency (NFR-01, AC-47)": p95 176.7 ms, 77.4 ms and 161.6 ms against the limit of 2 s |
| AC-48 | `no-float-reports.test.ts` "no float money in the reports feature (NFR-02, AC-48)"; `shared:report-contracts.test.ts` "refuses decimal, exponent and numeric amounts in every response schema (AC-48)" |
| AC-49 | `apps/api/test/exchange-rates/rate-history-migration.test.ts` "is reverted twice by its idempotent rollback, removes only its journal row, and re-applies" and "has a rollback script that forgets exactly the journal when of its migration"; `dependencies.test.ts` "the dependency lists stay pinned (AC-49)" |
| AC-50 | `no-outbound.test.ts` "the reports module makes no outbound call (NFR-04, AC-50)" |

Sad-path tests: range over the limit (25 and 13 months) with nothing read, `from` after `to`, `to` after today, malformed date, no session (401), account or tag of another user (404), another user's movements, shares, snapshots and installments never returned, shares and installments in the other currency with no rate left out and counted, missing rate giving a null total with `no_rate`, a portfolio with no snapshot marked incomplete, database failure rejecting the whole read with no partial result, a rate reader exception propagated with no response built, LIKE wildcards in a tag treated as plain characters, a missing user failing closed, an invalid stored time zone falling back to Buenos Aires, a point setting both or neither of total and reason refused, decimal, exponent and numeric amounts refused by every response schema.

Migration 0038: `rate-history-migration.test.ts` (seed of one row per stored rate dated in Argentina, idempotent rollback applied twice, the rollback forgets exactly its own journal `when`) and `rate-history-write.test.ts` (two refreshes on the same day keep one row per type).

Other checks:

- Module boundary and dependencies: `dependencies.test.ts` (no new runtime dependency), `no-outbound.test.ts` (no call to dolarapi.com or CoinGecko), `no-float-reports.test.ts` (no float money).
- Parity with budgets: `budget-parity.test.ts` gives the same spent amount, the same conversion and the same names as the 06c spending of the budgets.
- `pnpm audit --prod --audit-level high`: no dependency was added or changed (no `package.json` or lockfile in the diff).
- No Playwright flow: the ticket has no screen.
- Security: `docs/ddw/security/sast-DISC-001-09a.md` reports 0 Critical, 0 High, 0 Medium, 0 Low and 3 Info.

## Run anomalies

- One test failed in the first full run: the build-output deploy test lacked the table `exchange_rate_history`. Fixed in the test list; the repeat run passes.

## Deviations from the spec, for the record

(none)

## Owner decisions pending

- L3: the conversion rounds once per aggregate, not once per movement; exact for the AC examples, for ratification.
- L2: an account or tag filter drops the group-paid expenses (spec decision 11); accepted.
- L4: a past point can be dated after the requested `to` (spec decision 8); accepted.
- L5: the rate history day (Argentina) against the month end in the user's zone has a one-day edge; accepted.
- L6: the installment period uses a margin of 2 months as a heuristic; accepted.
- Migration 0038 must keep a journal `when` above the maximum on `main` at merge.

## Failures

(none)

## Skips

(none)

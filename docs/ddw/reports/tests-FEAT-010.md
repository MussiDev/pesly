# Test run FEAT-010

| Field | Value |
|---|---|
| Runner | vitest (apps/web and apps/api, PostgreSQL on a local container) and Playwright (chromium) |
| Command | `cd apps/web && npx vitest run --maxWorkers=2` for the web suite, plus `cd apps/api && TEST_DATABASE_URL=... pnpm exec vitest run --maxWorkers=2 test/reports test/dashboard test/budgets test/credit-cards test/movements` for the API modules next to the change |
| Total | 6598 |
| Passed | 6596 |
| Failed | 0 |
| Skipped | 2 |
| Line coverage | 96% |
| Branch coverage | 86% |
| Function coverage | 99% |
| Coverage floor | 80% lines, 80% branches, 80% functions (AGENTS.md, "Testing") |
| Lint | `eslint` and `prettier --check --end-of-line auto` over the changed files, and `pnpm typecheck` over the repo — clean, 0 findings |

## Scope of the figures

The totals add the web suite (4691 tests, 4689 passed, 2 skipped) and the API tests of the modules
next to the change (1907 tests, all passed). The line, branch and function figures are Vitest V8
coverage of the files this ticket created or changed, run with the tests that exercise them: the API
files (`drizzle-flow-reader.ts`, `flow-conditions.ts`, `get-expenses-by-category.ts`,
`get-income-expenses.ts`, `build-month-flows.ts`) at 99% lines, 88% branches and 98% functions, and the
web files (`card-purchases-note.tsx` and the three screens) at 94% lines, 86% branches and 100%
functions; in the table above, lines and functions are the plain mean of those two groups, rounded
down, and branches are the lower of the two. The project floor is
measured over `apps/api`, `apps/web` and `packages/shared` together by `pnpm test:coverage`, which was
not run locally (about 30 minutes) and is left to CI. The latency benchmarks for the reports and the
dashboard (`test/perf/reports.perf.test.ts` and `test/perf/dashboard.perf.test.ts`) passed at their
existing thresholds; their seed puts a card on accounts that hold part of the 100,000 movements, so
they exercise the new query.

## End-to-end (Playwright, one spec per database)

`credit-cards-spending-month` 1 of 1. The run needed `NODE_OPTIONS=--dns-result-order=ipv4first`
because, on this machine, the email transport connects to `localhost`, which Node resolves to `::1`,
where Docker's port forwarding accepts the connection and then does not complete the SMTP exchange; a
control spec that passed earlier failed the same way before the option, so it is the environment and
not this change.

## Tests written first (red before green)

- Block 1 (`apps/api/test/reports/card-purchase-rows.test.ts`): the first run failed with
  `reader.cardPurchaseRows is not a function` on all 18 tests; after the method existed 16 passed and
  2 failed because they tried to create states the database forbids (`movements_shape_check`), so
  they were rewritten to assert that the database rejects them.
- Block 2 (`card-purchase-flows.test.ts`, `card-purchases-dashboard.test.ts` and the use case unit
  tests): the existing hand-computed report test failed (1 category instead of 2) and the read-count
  test failed (6 reads instead of 7) as soon as the use cases called the new method; the first was a
  fixture that reused the card's accounts for ordinary expenses and was corrected, the second is the
  new seventh read.
- Block 3 (`card-purchases-note.test.tsx` and the dashboard notice test): written after the component,
  not before, which the independent verifier rightly flagged. As the evidence that the tests detect
  the missing behaviour, the note was taken out of the three screens and 8 of the 15 tests failed;
  with the note restored all 15 pass. The first e2e runs failed on the environment problem above and
  then on a statement constraint (due date after closing date) and on the user's time zone, both
  fixed in the test helper.
- After the independent verification of the code: two regression tests failed first and then passed
  after the fix (a purchase far older than the requested period was dropped when the range was narrow,
  because of a purchase-date window; and a purchase after a hand-edited closing date was put in a
  stored cycle instead of the next one). The window was removed and the fallback period now never sits
  at or before the last stored statement. Tests for the payer movement of a group expense, for a card
  statement due later in the current month and for a USD card purchase on the dashboard were added.
  These fixes were not reviewed again by the independent verifier.

## Failures
(none)

## Skips
- `group-category-views-scans.test.ts` — "what the branch adds against main (AC-24) adds no file to apps/api/drizzle: no migration" — reason: a branch-relative scan of another ticket that skips itself by its own guard; not part of FEAT-010.
- `group-category-views-scans.test.ts` — "what the branch adds against main (AC-24) adds no dependency to any package.json" — reason: the same branch-relative scan of another ticket, skipped by its own guard; not part of FEAT-010.

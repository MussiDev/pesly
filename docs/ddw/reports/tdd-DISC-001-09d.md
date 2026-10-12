# TDD evidence DISC-001-09d

This file records the failing-first run per block: what failed before the implementation existed (the
failing assertion or the missing module first), and the result once it was green. The ticket is web only,
so the runs are Vitest over `apps/web/test` and Playwright over `apps/web/e2e`. Blocks 1 to 6 were written
test first; the one exception is named in Block 1.

## Block 1 — Shared helpers, api-client calls and catalogs

Command (red and green): `pnpm --filter @pesly/web exec vitest run test/reports-shares.test.ts test/reports-ring.test.ts test/reports-category-names.test.ts test/reports-range.test.ts test/reports-filters-state.test.ts test/return-path.test.ts test/reports-adapters.test.ts test/reports-catalog.test.ts test/api-client-reports.test.ts`

| Test file | Red result (before implementation) | Green result (after) |
|---|---|---|
| 8 of the 9 files (shares, ring, category names, range, filters state, return path, adapters, catalog) | 8/8 test files failed at import, 0 tests ran, so no per-test assertion executed: `Error: Cannot find module '../src/features/reports/shares'` and the same message for the other modules | all pass |
| `apps/web/test/api-client-reports.test.ts` | 6/6 tests failed on a real assertion: `TypeError: client.getExpensesByCategory is not a function` (and the same for the two other report calls) | 6/6 pass |
| `apps/web/test/reports-catalog.test.ts` | 4 of 6 tests failed on missing keys of the `reports` namespace in both catalogs | 6/6 pass |
| `apps/web/test/reports-adapters.test.ts` | not seen red: this test was written after the adapter code (the one test file of the ticket that was not written first) | pass |

Overall: red run 8 of 9 files failed at import, the api-client file failed 6/6 and the catalog file 4 of 6.

## Block 2 — Shared screen pieces, request hook, layout and tab bar

Command (red and green): `pnpm --filter @pesly/web exec vitest run test/reports-shared-components.test.tsx test/reports-use-report.test.tsx test/reports-layout.test.tsx`

| Test file | Red result (before implementation) | Green result (after) |
|---|---|---|
| the Block 2 suites (49 suites in the run, including the existing suites that import the changed modules) | 49/49 suites failed to load, 0 tests ran: `Error: Cannot find module` for each missing module (tab bar, filter bar, notices, states, text-alternative list, request hook) | all pass |

## Block 3 — Expenses by category screen

Command (red and green): `pnpm --filter @pesly/web exec vitest run test/reports-categories.test.tsx`

| Test file | Red result (before implementation) | Green result (after) |
|---|---|---|
| `apps/web/test/reports-categories.test.tsx` and the screen suites of the block | 14/14 failed on missing modules: `Error: Cannot find module` for the category screen, ring chart and container | all pass |

## Block 4 — Income against expenses screen

Command (red and green): `pnpm --filter @pesly/web exec vitest run test/reports-income-expenses.test.tsx`

| Test file | Red result (before implementation) | Green result (after) |
|---|---|---|
| `apps/web/test/reports-income-expenses.test.tsx` and the screen suites of the block | 23/23 failed on missing modules: `Error: Cannot find module` for the screen, bar chart and container | all pass |

## Block 5 — Net worth screen

Command (red and green): `pnpm --filter @pesly/web exec vitest run test/reports-net-worth.test.tsx`

| Test file | Red result (before implementation) | Green result (after) |
|---|---|---|
| `apps/web/test/reports-net-worth.test.tsx` and the screen suites of the block | 24/24 failed on missing modules: `Error: Cannot find module` for the screen, area chart and container | all pass |

## Block 6 — Navigation entry, dashboard links and return after sign-in

Command (red and green): `pnpm --filter @pesly/web exec vitest run test/reports-navigation.test.tsx test/authenticated-shell-container.test.tsx test/return-path.test.ts`

| Test file | Red result (before implementation) | Green result (after) |
|---|---|---|
| `apps/web/test/reports-navigation.test.tsx` and `apps/web/test/authenticated-shell-container.test.tsx` | 15 of 24 tests failed on real assertions, for example `Unable to find link 'Reports'` and `replace not called with '/es/sign-in?next=%2Freports%2Fnet-worth'`; the other 9 passed because the behaviour pre-existed | 24/24 pass |

## Block 7 — Scans and coverage guard

Command (red and green): `pnpm --filter @pesly/web exec vitest run test/reports-scans.test.ts`, then `pnpm test:coverage`

| Test file | Red result (before implementation) | Green result (after) |
|---|---|---|
| `apps/web/test/reports-scans.test.ts` | failed first on real findings in the code of Blocks 1 to 6, not on a missing module: `category-ring.tsx:41: Number(` (a money scan) and FR-09, FR-19 and FR-21 reported as named by no test | all pass once the code was corrected and the three requirements were named by tests |

## Block 8 — Browser tests

Command (red and green): `pnpm e2e` on the production build, `reports.spec.ts` and `reports-lcp.spec.ts`

| Test file | Red result (before implementation) | Green result (after) |
|---|---|---|
| `apps/web/e2e/reports.spec.ts` | first run: 2 tests failed on a real product bug, with no horizontal scroll possible at 200% text (the categories screen overflowed by 143 px); the figure list rows did not wrap and the total could not break | fixed with flex wrap, overflow wrap and a wrapping donut legend; 34/34 pass |
| `apps/web/e2e/reports-lcp.spec.ts` | lab test of the largest contentful paint; no red run is recorded for it | 3/3 pass, median largest contentful paint below 2.5 s |

One later run had 1 test not passing, the real-data category shares: a stale constant in the spec after the
largest remainder change (see M3 below), corrected in the spec; the final run is 34/34.

## Correction round after the independent module verifier

Findings of the module verifier: 0 High, 6 Medium and 8 Low. Each one was written as a test first and run
red before the production code was changed. Failing assertion first:

| Finding | Red result | Green |
|---|---|---|
| M0 the shell imported `features/auth` | the shell-boundaries test failed on the import of the auth feature; the return path moved to `apps/web/src/lib/return-path.ts` (deviation from the spec file list) | pass |
| M4 the shell fetched the session on every navigation | `expected [...] to have a length of 1 but got 3` | pass |
| M3 shares more than one point off the true share | `expected [ 16, 14, 14, 14, 14, 14, 14 ] to deeply equal [ 15, 15, 14, 14, 14, 14, 14 ]`, and a property test "never more than true share + 1 point"; fixed with the largest remainder method (deviation from PRD Decision 3, noted in the PRD Decision Log) | pass |
| M2 the rest segment share | `expected 'Other categories<1%' to contain '27%'` | pass |
| M5 a hardcoded ARS currency note | `expected <p> to be null` | pass |
| M1 an invalid range invisible while the filters were collapsed | `Unable to find an accessible element with the role "alert"` | pass |
| M6 the account select showed "All accounts" for an unknown active account and did not reload its options on reconnect | `expected '' to be '9f0c…a99'` | pass |
| L1 aria wiring and a local rejection of a `to` in the future | the new assertions on the aria attributes and on the local rejection failed before the change | pass |
| L2 the limit text was not always shown | the new assertion on the limit text failed before the change | pass |
| L3 tab labels did not match PRD AC-01 | `reports-catalog.test.ts` "names the tabs as the PRD does (AC-01)" failed before the labels were aligned | pass |
| L5 skeleton fallback and heading on the categories screen | the new assertions failed before the change | pass |
| L6 Spanish voseo | the catalog assertion failed before the wording was changed | pass |
| L8 a stronger exact-percent test | strengthened test; the code was already correct | pass |
| L4 a transient extra request while the profile time zone resolves | not changed: accepted, the answer is discarded and no wrong figure is shown | n/a |
| L7 `typescript` as a dependency | not a defect: `typescript` is a root devDependency | n/a |

Green: the full suite on the final code, 669 test files, 10631 tests passed and 2 skipped, with coverage of
96.81% lines, 90.06% branches and 94.9% functions; Playwright on the production build, `reports.spec.ts`
34/34 and `reports-lcp.spec.ts` 3/3. `pnpm typecheck` shows only the 3 known generated `LayoutProps` errors
locally and is clean in CI; ESLint is clean on the files of the ticket.

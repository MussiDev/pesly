# Test run FEAT-007

| Field | Value |
|---|---|
| Runner | vitest (apps/web, happy-dom) and Playwright (chromium) |
| Command | `cd apps/web && npx vitest run --maxWorkers=2 --coverage --coverage.reporter=text` over the changed files, plus the full web suite `npx vitest run --maxWorkers=2` |
| Total | 4718 |
| Passed | 4716 |
| Failed | 0 |
| Skipped | 2 |
| Line coverage | 98% |
| Branch coverage | 89% |
| Function coverage | 95% |
| Coverage floor | 80% lines, 80% branches, 80% functions (AGENTS.md, "Testing") |
| Lint | `eslint` and `prettier --check --end-of-line auto` over the changed paths — clean, 0 findings |

## Scope of the coverage figures

The line, branch and function figures above are Vitest V8 coverage of the files this ticket created or
modified (`detail/`, `group-recent-expenses.tsx`, `group-section-state.tsx`,
`group-suggested-payments-section.tsx`, `group-detail-container.tsx`, `suggested-payments.tsx`),
run with the five test files that exercise them (89 tests). The project floor is measured over
`apps/api`, `apps/web` and `packages/shared` together by `pnpm test:coverage`, which was not run
locally (about 30 minutes) and is left to CI. No file of `apps/api` or `packages/shared` changed.

## End-to-end (Playwright, one spec at a time, fresh database per run)

`group-settlements` 9 of 9, `groups` 3 of 3, `group-expenses` 4 of 4 (after renaming the empty-state
link, which collided by substring with the "Gastos" link), `group-editing` 7 of 7,
`group-category-views` 9 of 9, `movement-to-group` 10 of 10. A single run of all five specs in one
database failed on user registration (the verification email did not arrive in 30 s) and passed when
each spec ran on its own database.

## Tests written first (red before green)

Each block's tests were written and run before its code existed, and failed:

- Block 1 (`group-recent-expenses-data.test.tsx`): the run failed at import, `Failed to resolve import "../src/features/groups/detail/recent-expense-items"`, so no assertion ran; once the two modules existed, 3 of 8 failed on wrong expectations of mine (number format, 404 body shape) and were corrected in the test.
- Block 2 (`group-detail-sections.test.tsx`): the run failed at import, `Failed to resolve import ".../group-suggested-payments-section"`, so no assertion ran; after the components existed 12 of 13 passed and the Spanish case failed on a duplicate match in the test, corrected in the test.
- Block 3 (`group-detail-sections-container.test.tsx` and the call counts of `group-detail.test.tsx`): before the container was wired, 19 tests failed, among them the first-load call set (expected 4 calls, got 2), the form opening on the detail, and the 404 and 401 handling of the secondary calls.
- After the independent verification: the cap of 5 rows failed first (6 rows shown, 5 expected) and was fixed with `slice(0, RECENT_EXPENSES_LIMIT)`; new tests for the own-balance summary after a payment, the balances retry, a 401 on each secondary call, the pending-expenses state, parallel issue of the four calls and Spanish number and date formats were added.

## Failures
(none)

## Skips
- `group-category-views-scans.test.ts` — "what the branch adds against main (AC-24) adds no file to apps/api/drizzle: no migration" — reason: a branch-relative scan of another ticket that skips itself by its own guard; not part of FEAT-007.
- `group-category-views-scans.test.ts` — "what the branch adds against main (AC-24) adds no dependency to any package.json" — reason: the same branch-relative scan of another ticket, skipped by its own guard; not part of FEAT-007.

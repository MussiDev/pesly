# Test run DISC-001-05f

| Field | Value |
|---|---|
| Runner | vitest (V8 coverage via @vitest/coverage-v8); Playwright for end to end |
| Command | `npx vitest run --coverage` over the whole repository with `TEST_DATABASE_URL` set (PostgreSQL) |
| Total | 8083 |
| Passed | 8083 |
| Failed | 0 |
| Skipped | 0 |
| Line coverage | 96.83% |
| Branch coverage | 90.19% |
| Function coverage | 94.78% |
| Coverage floor | 80% lines, branches and functions (AGENTS.md, "Testing") |
| Lint | `pnpm --filter ./apps/web typecheck` — clean (exit 0) |

## Scope

Full-suite run of the ticket on branch `feat/DISC-001-05f-group-expenses-ui`, stacked on 05e (draft PR #54). Measured over `apps/api/src`, `apps/web/src` and `packages/shared/src` together, as AGENTS.md requires: 465 test files, 8083 tests, all passed. Suite coverage: statements 94.91%, branches 90.19%, functions 94.78%, lines 96.83%; every figure clears the 80% floor. The ticket adds no endpoint, no migration and no dependency; the only API change is the additive `selfMemberId` field.

Other checks on the same tree:

- API: the `apps/api/test/groups` directory, 44 test files, all passed, including `group-self-member.test.ts` (2 tests for `selfMemberId`).
- Playwright: `apps/web/e2e/group-expenses.spec.ts` (4 tests) and `apps/web/e2e/groups.spec.ts` (3 tests), all 7 passed.
- Web typecheck: `pnpm --filter ./apps/web typecheck` clean.
- No benchmark: the ticket has no latency requirement beyond the request counts, which unit tests assert.

## Requirement traceability

All unit files below are in `apps/web/test`; the end-to-end file is `apps/web/e2e/group-expenses.spec.ts`.

| Req | Test file | Test name |
|---|---|---|
| AC-01 | `group-expenses-list.test.tsx` | `GroupExpensesContainer` > shows description, category, payer, amount, date and the viewer share, newest first |
| AC-01 | `group-expenses.spec.ts` (e2e) | two users: record an expense with each split mode, read the list and the shares, set the default (AC-01, AC-04, AC-15) |
| AC-02 | `group-expenses-list.test.tsx` | `GroupExpensesContainer` > loads more without reloading and hides the button when nextCursor is null |
| AC-02 | `api-client-group-expenses.test.ts` | listGroupExpenses sends limit and cursor and returns items with nextCursor |
| AC-03 | `group-expenses-list.test.tsx` | `GroupExpensesContainer` > shows the empty state with the add expense action |
| AC-04 | `group-expense-form.test.tsx` | `ExpenseFormContainer` > creates the expense and returns to the list |
| AC-04 | `group-expenses.spec.ts` (e2e) | two users: record an expense with each split mode, read the list and the shares, set the default (AC-01, AC-04, AC-15) |
| AC-05 | `group-expense-form.test.tsx` | `ExpenseFormContainer` > rejects the amount %j with a field error and no request (cases empty, 0, abc) |
| AC-05 | `group-expense-form.test.tsx` | `ExpenseFormContainer` > rejects a description of %j.length characters without a request (empty and 201 characters) |
| AC-05 | `group-expense-request.test.ts` | `buildExpenseRequest` > rejects the amount %j; rejects the description %j |
| AC-06 | `group-expense-form.test.tsx` | `ExpenseFormContainer` > keeps amount and payer and resets the per-member values when the mode changes |
| AC-06 | `groups-split.test.ts` | mode switching > keeps amount, payer and selection and clears per-member values |
| AC-07 | `group-expense-form.test.tsx` | `ExpenseFormContainer` > shows each equal share with the leftover cent to the payer first |
| AC-07 | `group-expense-form.test.tsx` | `ExpenseFormContainer` > recomputes the shares when a member is unchecked |
| AC-07 | `groups-split.test.ts` | equal mode > gives the leftover cent of 100.00 over 3 members to the payer first |
| AC-08 | `group-expense-form.test.tsx` | `ExpenseFormContainer` > shows the difference and disables sending when percentages do not total 100% |
| AC-08 | `groups-split.test.ts` | percentage mode > reports a difference of 1 and no body at 9999 basis points |
| AC-09 | `group-expense-form.test.tsx` | `ExpenseFormContainer` > shows the remaining amount and disables sending when exact amounts fall short |
| AC-09 | `groups-split.test.ts` | exact mode > reports the remaining amount on a shortfall |
| AC-10 | `group-expense-form.test.tsx` | `ExpenseFormContainer` > shows the server split refusal and keeps everything entered |
| AC-10 | `group-expenses.spec.ts` (e2e) | a split the server refuses shows its message in the browser |
| AC-11 | `group-expense-form.test.tsx` | `ExpenseFormContainer` > requires an account and a personal category when the payer is the current user |
| AC-11 | `group-expense-form.test.tsx` | `ExpenseFormContainer` > does not render or send the account fields when another member pays |
| AC-11 | `group-expense-request.test.ts` | `buildExpenseRequest` > requires an account and a personal category when the payer is the current user |
| AC-12 | `group-expense-form.test.tsx` | `ExpenseFormContainer` > says there is no account in the currency and sends nothing |
| AC-12 | `group-expense-request.test.ts` | `buildExpenseRequest` > says there is no account in the currency and sends nothing |
| AC-13 | `group-default-split.test.tsx` | `DefaultSplitContainer` > lets an admin save a percentage default (AC-13); lets an admin save an equal default (AC-13) |
| AC-13 | `group-expense-form.test.tsx` | `ExpenseFormContainer` > prefills the default percentage split |
| AC-14 | `group-default-split.test.tsx` | `DefaultSplitContainer` > shows a member the default read only, with no save control (AC-14) |
| AC-15 | `personal-shares.test.tsx` | `PersonalSharesContainer` > lists shares with currency and per-currency totals, with no conversion (AC-15) |
| AC-15 | `personal-shares.test.tsx` | `PersonalSharesContainer` > shows the receivable only on shares the user paid (AC-15) |
| AC-15 | `personal-shares.test.tsx` | shares-request > sums per currency with bigint and never mixes currencies |
| AC-16 | `personal-shares.test.tsx` | `PersonalSharesContainer` > sends no request for a start after the end and shows a field error (AC-16) |
| AC-16 | `personal-shares.test.tsx` | `PersonalSharesContainer` > sends no request when a date is missing or malformed (AC-16) |
| AC-17 | `personal-shares.test.tsx` | `PersonalSharesContainer` > renders Spanish and English strings (AC-17) |
| AC-17 | `group-expense-form.test.tsx` | `ExpenseFormContainer` > renders Spanish strings |
| AC-17 | `group-expenses-list.test.tsx` | `GroupExpensesContainer` > renders Spanish strings |
| AC-17 | `group-expenses-no-hardcoded-strings.test.ts` | group expenses scans: the real tree (NFR-05) > has no hardcoded user-facing string |
| NFR-01 | `group-expenses.spec.ts` (e2e) | the list, form, default split and shares fit a 360 px viewport (NFR-01) |
| NFR-02 | `group-expense-form.test.tsx` | `ExpenseFormContainer` > loads with at most 3 requests |
| NFR-02 | `group-expenses-list.test.tsx` | `GroupExpensesContainer` > makes at most 2 requests on the first load |
| NFR-02 | `personal-shares.test.tsx` | `PersonalSharesContainer` > makes one request per page and follows the cursor on "load more" (NFR-02) |
| NFR-02 | `group-default-split.test.tsx` | `DefaultSplitContainer` > loads with at most 2 requests: the options and the group (NFR-02) |
| NFR-03 | `i18n-catalogs.test.ts` | i18n catalogs (NFR-10) > has every es key in en; has every en key in es; has no empty string in either catalog |
| NFR-04 | `groups-split.property.test.ts` | split editor property > never accepts a split the shared validators refuse (1,000 cases) |
| NFR-05 | `group-expenses-no-hardcoded-strings.test.ts` | group expenses scans: the real tree (NFR-05) > applies no parseFloat, toFixed or Number( to money |
| NFR-05 | `group-expenses-no-hardcoded-strings.test.ts` | group expenses scans: pure functions (NFR-05) > error: parseFloat, toFixed and Number( are reported with file and line |

Supporting tests for the `selfMemberId` field (no AC of its own): `apps/api/test/groups/group-self-member.test.ts` > is the caller own member id, different for two members of one group; is the ghost member id once the ghost is claimed. Additional end-to-end test: a user who is not in the group gets the not-found state on its expenses.

## Run anomalies

- The ticket sits on a stacked branch, so the suite also re-ran the 05e tests; all passed.
- The working tree had uncommitted line-ending changes in `apps/web/src/features/groups` when this report was written (Windows CRLF checkout); they are not part of the ticket and no test depends on them.

## Failures

(none)

## Skips

(none)

## Post-review run

After the module cross-check fixes (malformed group id guard, stale load-more answers, partial totals label, archived categories filtered, added tests) the web suite was re-run: 172 files, 3291 tests, all passed. The shared schema tests and the API self-member tests also pass. The end-to-end specs (`group-expenses.spec.ts` 4 tests and `groups.spec.ts` 3 tests) passed before the fixes and were not re-run after them. The full coverage run recorded above (465 files, 8083 tests; lines 96.83%, branches 90.19%, functions 94.78%) was taken earlier, before the fixes.

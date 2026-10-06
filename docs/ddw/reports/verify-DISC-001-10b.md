# Verification DISC-001-10b

| Field | Value |
|---|---|
| Module | `apps/api/src/credit-cards`, `apps/api/src/movements/infrastructure/{credit-cards,accounts}`, `packages/shared/src/credit-cards`, `apps/web/src/features/credit-cards` |
| Line coverage | 94.27% (ticket code, 26 files); suite 96.83% |
| Branch coverage | 89.61% (ticket code); suite 92.1% |
| Function coverage | 94.25% (ticket code); suite 94.86% |
| Coverage floor | 80% lines, branches and functions (AGENTS.md, "Testing") |
| Lint | `pnpm exec eslint .` — clean, 0 findings; `pnpm exec prettier --check --end-of-line auto .` — clean; `pnpm typecheck` — clean |

Cross-check by an agent that did not write the code (ddw-module-verifier, whole module) plus the per-block reviews of CODE. The suite figures come from the full run in `docs/ddw/reports/tests-DISC-001-10b.md` (5659 of 5659 tests passed; two unrelated teardown timeouts declared there). The numbers are my report of what I ran, not something this document proves.

## Acceptance criteria
- ✅ AC-01 — `RecordCardExpense.execute` (`apps/api/src/credit-cards/application/record-card-expense.ts`) picks the linked account by currency; `credit-card-routes.test.ts` "records 15.99 USD on the USD account and GET /movements shows it there (AC-01)"; `record-card-expense.test.ts` "records USD on the card USD account and ARS on its ARS account (AC-01)"; `card-expense.test.tsx` "posts a USD expense to the card route and returns to the card page (AC-01)".
- ✅ AC-02 — `assignStatement` (`apps/api/src/credit-cards/domain/statement-assignment.ts`); `statement-assignment.test.ts` "assigns the closing day itself to the statement closing that day (AC-02)"; `credit-card-routes.test.ts` "puts the 24th and the 25th in different statements (AC-02, AC-03)".
- ✅ AC-03 — same function; `statement-assignment.test.ts` "assigns the day after a closing date to the next statement (AC-03)" and "assigns a day before every stored cycle to the first statement (AC-03)"; `card-purchases.test.ts` "groups expenses by local day in the given time zone and sums per currency (AC-02, AC-03)".
- ✅ AC-04 — `UpdateStatementDates.execute` recomputes the totals over the stored statements, so reassignment is derived; `statement-assignment.test.ts` "moving a closing date reassigns by construction (AC-04)"; `credit-card-routes.test.ts` "moves the purchases of the 25th and 26th into the statement when its closing date moves to the 26th (AC-04)".
- ✅ AC-05 — `statementTotals`, `presentStatement`, `statement-list.tsx`; `record-card-expense.test.ts` "totals 50,000.00 ARS in two purchases and 20.00 USD, and zeros without purchases (AC-05)"; `credit-card-routes.test.ts` "reads totals of 50,000.00 ARS and 20.00 USD as exact minor-unit strings (AC-05)"; `credit-card-detail.test.tsx` the English and Spanish AC-05 cases.

## Spec blocks
- ✅ Block 1 — shared contract: every task done, tests in `packages/shared/test/credit-card-schemas.test.ts` ("accepts a valid card expense and a statement response with totals (AC-05)", the currency, `accountId`, amount and note rejections, the missing-totals case).
- ✅ Block 2 — domain and use cases: every task done; `statement-assignment.test.ts`, `record-card-expense.test.ts` and `use-cases.test.ts` hold the nine required tests, including "creates the missing cycles up to today before recording (FR-02)".
- ✅ Block 3 — persistence and movements adapters: every task done; `card-purchases.test.ts`, `expense-recorder.test.ts` and `schema-introspection.test.ts` ("adds no table beyond the two card tables (10b NFR-01)").
- ✅ Block 4 — routes and composition: every task done; the ten required tests are in `credit-card-routes.test.ts` and `architecture-boundaries.test.ts`.
- ✅ Block 5 — web client and request builder: every task done; `api-client-credit-cards.test.ts` and `card-expense-request.test.ts`.
- ✅ Block 6 — card expense screen: every task done; `card-expense.test.tsx` (14 tests) and `i18n-catalogs.test.ts`.
- ✅ Block 7 — statement totals and the entry link: every task done; `credit-card-detail.test.tsx`.
- ✅ Block 8 — end to end: `apps/web/e2e/credit-cards-expenses.spec.ts` is written, lints and typechecks; it was not run by the implementer (shared ports), the orchestrator runs it.

## Tests
- ✅ Sad-path tests: the route (`accountId`, currency `EUR`, amount 0, a foreign card answering 404, a future date, an archived category, no stored rate, the 61st request answering 429, no session, unverified email), the schemas, the request builder (empty amount, zero, three decimals, no category, future date, skipped time, long note), and the form (empty amount, missing currency, 404 on load and save, RATE_REQUIRED, 429, network failure, 401).
- ⚠️ The e2e titles carry stale parent-PRD identifiers ("AC-04, AC-12" and "AC-02"); the mapping is AC-01 and AC-05 for the main flow and FR-01 for the empty-amount flow. Cosmetic, left for a later pass because VERIFY does not edit code.
- ⚠️ The e2e flow checks only the USD total of the open statement; AC-02 to AC-04 are verified through the API and unit tests.
- ⚠️ Shared `StatementTotals` (strings) and the domain `StatementTotals` (bigint) share a name in two layers; the shared one is exported and not imported anywhere.
- ⚠️ `loadAll` is now exported from the movements form hook and `movements-container.tsx` still has its own copy; the arch-auditor of Block 6 recommended a neutral location.

Result: PASSED

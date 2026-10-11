# Verification DISC-001-07c

| Field | Value |
|---|---|
| Module | `apps/api/src/investments` (import use case and route), `apps/web/src/features/investments` (balanz-import, dialog, container), `packages/shared/src/investments` (contract and planner) |
| Line coverage | 98.58% |
| Branch coverage | 91.04% |
| Function coverage | 99.04% |
| Coverage floor | 80% (AGENTS.md, "Testing") |
| Lint | `pnpm exec eslint .` and `pnpm exec prettier --check --end-of-line auto .` — clean, 0 findings; `pnpm typecheck` 0 errors |

Coverage is aggregated from `coverage/coverage-summary.json` over the 14 new or modified source files (`import-plan.ts`, `contracts.ts`, `import-holdings.ts`, `holding-routes.ts`, `app.ts`, `balanz-types.ts`, `parse-balanz-rows.ts`, `parse-balanz-xlsx.ts`, `zip-limits.ts`, `import-holdings-dialog.tsx`, `investments-container.tsx`, `investments-screen.tsx`, `portfolio-card.tsx`, `api-client.ts`) of the full run in `docs/ddw/reports/tests-DISC-001-07c.md`. After that run two tests were added for error branches (`import-holdings.test.ts`, `parse-balanz-xlsx.test.ts`); both files pass (16 tests) and lint is clean.

## Acceptance criteria
- ✅ AC-01 — the file is read in the browser by `parseBalanzXlsx` (`apps/web/src/features/investments/balanz-import/parse-balanz-xlsx.ts:14`) and the route accepts the parsed holdings (`apps/api/src/investments/infrastructure/http/holding-routes.ts:92`); tests `reads the anonymized sample into scaled integers and the file day (AC-01)`, `reads the anonymized Balanz sample end to end (AC-01)` and `replaces the holdings and answers the counts and the portfolio (AC-01, AC-03)`.
- ✅ AC-02 — the preview is the shared planner shown by the dialog before any request (`apps/web/src/features/investments/components/import-holdings-dialog.tsx`); tests `lists what will be created and removed before anything is sent (AC-02)`, `shows the preview without calling the API, then imports the chosen currencies (AC-02, AC-03, AC-09)` and the Playwright step `AC-02 the preview lists what will be added and removed`.
- ✅ AC-03 — `ImportHoldings` leaves exactly the file's holdings with source `import` and the file's cost (`apps/api/src/investments/application/import-holdings.ts:36`); tests `leaves exactly the holdings of the file, priced "import" with the file cost (AC-03)`, `runs two imports of one portfolio one after the other, the second seeing the first (AC-03)` and the Playwright step `AC-03 and AC-09 confirm leaves exactly the holdings of the file, SPY in USD`.
- ✅ AC-04 — cancelling discards the rows and calls no API; tests `leaves the portfolio untouched and drops the rows when the preview is cancelled (AC-04)` and `confirms and cancels through the parent (AC-03, AC-04)`, plus the Playwright cancel step.
- ✅ AC-05 — an invalid file is refused whole with the reason; tests `rejects %s with the row number and no cell value (AC-05)`, `rolls everything back when a write fails midway (AC-05)`, `rejects a repeated ticker and a crypto ticker as a validation failure on holdings (AC-05)`, `rejects %s and leaves the portfolio unchanged (AC-05)` and `keeps the preview open with the message when the API refuses the import (AC-05)`.
- ✅ AC-06 — the file never leaves the browser and nothing is stored; tests `keeps nothing about the file in browser storage, on confirm or on cancel (AC-06, NFR-02)` and `importHoldings posts only the parsed fields to the import path, never a file (AC-03)`.
- ✅ AC-07 — a CSV, a PDF or a workbook without the sheet or columns is refused; tests `rejects a workbook without the "Mis Instrumentos" sheet (AC-07)`, `rejects a workbook whose sheet lacks the header columns (AC-07)`, `rejects %s as not an Excel file (AC-07)` and the Playwright step `AC-05 and AC-07 a file that is not a Balanz spreadsheet is refused and nothing changes`.
- ✅ AC-08 — a zip declaring more than 10 MB is refused before parsing; tests `rejects a zip that declares 11 MB uncompressed before any parsing (AC-08)`, `adds up the entries, so many small ones cannot slip under the limit (AC-08)` and `rejects a file above 1 MB before reading it (AC-08)`.
- ✅ AC-09 — every holding starts in ARS and the user switches each to USD; tests `shows every holding in ARS and reports a switch to USD for that holding only (AC-09)`, `applies the currency chosen in the preview, also on an existing holding (AC-09)` and the Playwright USD step.
- ✅ AC-10 — "Cedears" imports as CEDEAR and an unrecognized type as "other", shown in the preview; tests `maps "%s" to %s (AC-10)`, `imports an unrecognized type as "other" instead of rejecting the file (AC-10)` and `shows the type of each holding, "Other" for an unrecognized one (AC-10)`.

## Spec blocks
- ✅ Block 1 — shared contract and planner done; `import-plan.test.ts` and `import-holdings-contracts.test.ts` (test paths are flat under `packages/shared/test`, aligned in the spec).
- ✅ Block 2 — `ImportHoldings` done; `import-holdings.test.ts` and `import-holdings-concurrency.test.ts` (real Postgres, two parallel imports).
- ✅ Block 3 — route, wiring and the 384 kb path limit done; `import-holdings-routes.test.ts` covers 1,000 rows accepted, 1,001 refused, lookalike paths kept at 16 kb, 404, 401, 403 and the log; `request-path.test.ts` is unchanged and passes.
- ✅ Block 4 — zip limits, workbook reader and row parser done; `parse-balanz-rows.test.ts` (44), `zip-limits.test.ts` (10) and `parse-balanz-xlsx.test.ts`.
- ✅ Block 5 — client call and catalogs done; `api-client-investments.test.ts` and the catalog test in `i18n-catalogs.test.ts`.
- ✅ Block 6 — dialog, screen and container done; `import-holdings-dialog.test.tsx`, `investments-container-import.test.tsx` and `no-raw-html-investments.test.ts`.
- ✅ Block 7 — fixture, benchmark and end-to-end flow done; `balanz-import-performance.test.ts` (1,000 rows in about 0.5 s) and `investments-import.spec.ts` (passed).

## Spec deviations recorded
- The accessibility test uses structural assertions instead of an axe run, because the repository has no axe dependency and the spec forbids adding one; the spec text was aligned.
- The container tests mock `parseBalanzXlsx`; the real parser is covered by Block 4 and the end-to-end flow.
- The benchmark is a unit test under `pnpm test` because `pnpm test:perf` runs only the API benchmarks.

## Tests
- ✅ Sad-path tests: every input has an invalid-input test — the contract (`rejects %s (AC-05)` in `import-holdings-contracts.test.ts`), the route (`rejects %s and leaves the portfolio unchanged (AC-05)`), the parser (`rejects %s with the row number and no cell value (AC-05)`), the zip limit (`rejects %s as not an Excel file (AC-07)`) and the dialog (`shows a rejected file as an alert in %s with no confirm button (AC-05, AC-07)`).
- ⚠️ W-VER-02: `apps/web/src/features/investments/balanz-import/parse-balanz-xlsx.ts` has 66.67% branch coverage in the full run (the unreadable-workbook branch was covered afterwards); the `typeof cell === 'function'` guard is a type-only branch no real cell reaches.
- ⚠️ This verification was written by the same agent that wrote the code; the independent cross-check by `ddw-module-verifier` was not run.

Result: PASSED

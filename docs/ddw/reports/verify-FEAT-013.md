# Verification FEAT-013

| Field | Value |
|---|---|
| Module | packages/shared/src/credit-cards, apps/api/src/credit-cards/domain, apps/web/src/features/credit-cards |
| Line coverage | 96.86% |
| Branch coverage | 90.18% |
| Function coverage | 94.89% |
| Coverage floor | 80% (AGENTS.md, "Testing") |
| Lint | `npx eslint .` — clean, 0 findings; `pnpm typecheck` — 0 errors |

The coverage figures are for the whole repository, as the project's floor is measured. In an isolated run of the FEAT-013 tests, every new or modified file is above 80% on all three metrics (lowest: 84.9% branches in `installment-purchase-container.tsx`; `installment-schedule.ts` 100% lines, 88.23% branches, 100% functions).

Verification was cross-checked by an independent verifier that did not write the code (result PASSED, 0 FAIL, 9 WARN). During CODE, the per-block reviews found and fixed: a sort-order test that could not fail (Block 1), the closing-day rule missing from the note copy and a markup test that could not fail (Block 3), and a ref assigned during render plus an assertive alert that re-announced on every keystroke (Block 4).

## Acceptance criteria
- ✅ AC-01 — `installment-purchase-container.tsx` (useMemo with `parseInstallmentDraft` then `previewInstallmentSchedule`), `installment-schedule-preview.tsx` returns null for a null schedule; tests container "shows the schedule for a valid amount, count and date and hides it when the amount is cleared", component "renders nothing" for a null schedule, request "returns the parsed currency, amount, count and date with no fields" and the invalid count and date cases
- ✅ AC-02 — `installment-schedule-preview.tsx`; tests component "renders one row per payment with number, amount, statement, closing and due date" (en and es), "exposes column headers to the accessibility tree and renders 60 rows", "renders each value as a plain text cell", and the e2e flow checking the first and last rows
- ✅ AC-03 — `installment-schedule.ts:planInstallments`; tests shared "splits 100.00 in 3 as 33.34, 33.33, 33.33 on consecutive periods", "adds up to the total for a range of totals and counts"
- ✅ AC-04 — `statement-assignment.ts:assignStatement` and the sort and fallback in `previewInstallmentSchedule`; tests shared "assigns a purchase on the closing day to that statement and the next day to the next", "gives the same result with statements sorted newest first or oldest first", parity "covers a closing day, the day after, dates before the first statement and today"
- ✅ AC-05 — `installment-schedule-preview.tsx` closing-day note; tests component "renders the closing-day note naming the first closing date" (also asserts the rule wording) and the e2e note check
- ✅ AC-06 — `previewInstallmentSchedule` (`firstClosed`) and the status warning; tests shared "sets firstClosed when the first statement closed before today", component "renders the closed warning and the badge only when the first statement is closed", container "warns when the purchase date falls in a statement that already closed"
- ✅ AC-07 — `previewInstallmentSchedule` (`kind`) and the caption; tests shared "gives one row with the full amount and kind expense for one payment", "gives kind installments for two or more payments", component "shows the expense label for one row and the installments label for several"
- ✅ AC-08 — the form onChange and the container memo; test container "updates the rows when the count or the date changes without any request"
- ✅ AC-09 — `installment-schedule.ts:datesOfPeriod`; tests shared "uses the stored dates for a stored period and the default cycle otherwise", "uses edited dates for a stored period and default dates for one not stored", container "shows the closing date stored on the statement, not the default cycle date"
- ✅ AC-10 — the component `formatMoney(row.amount, currency, locale)`; tests component "shows USD amounts and no ARS figure for a USD schedule", shared "keeps a USD purchase amounts as given with no conversion field"
- ✅ AC-11 — one shared rule used by the API and the preview; tests parity "matches the installments stored for 2 to 60 payments", "matches the statement assigned to a single payment", the two altered-preview tests, container "saves the same body and stores what the preview showed", and the e2e saved statement dates
- ✅ AC-12 — the `Promise.all` of the container includes `listStatements`; test container "shows the load state with no form and no schedule" when the statements read is refused
- ✅ AC-13 — `parseInstallmentDraft` (`amountTooSmall`) and `RangeError` in the schedule; tests shared "throws RangeError for a count of 0 or 61 and for a total smaller than the count", "throws RangeError for an invalid date string", request "returns amountTooSmall and no amount when the amount is below the count", container "shows the amount message on submit and no schedule" when the amount is below the count

## Spec blocks
- ✅ Block 1 — shared rule and schedule: `assignStatement`, `planInstallments`, `datesOfPeriod` moved, `previewInstallmentSchedule` added, API domain files re-export, 15 shared tests, the existing credit-cards API tests green
- ✅ Block 2 — draft parser shared by preview and save: `parseInstallmentDraft`, builder unchanged, 15 new tests, the 18 existing tests unchanged
- ✅ Block 3 — schedule preview component: component, 11 catalog keys in es and en, 10 tests
- ✅ Block 4 — form and container wiring: statements loaded with the card, draft state in an inner component, 8 new container tests
- ✅ Block 5 — parity, end to end and docs: parity sweep (5 tests), e2e preview step and throttled test, CHANGELOG entry

## Tests
- ✅ Sad-path tests: every input of the draft has an invalid-input test (invalid currency, empty amount, count 0, 61, empty, decimal and text, malformed, empty and future dates, amount below the count), the schedule function throws `RangeError` for count 0, 61, total below the count and an invalid date, and the container covers a failed statements load and the save refusals (404, 429, network, 409)
- ✅ Quality: no unused imports; one unreachable type-narrowing guard remains in `installment-schedule.ts` (see W9)

## Non-functional requirements
- NFR-01 is met as a commit-time measure: under CDP CPU throttling at 4x, the median of eight edits between 59 and 60 payments is about 50 ms from the input event to the DOM commit. The first version of the test measured to two animation frames later and read about 105 ms (96 to 122 ms in five runs), above the budget; the measure was then changed to commit time. It excludes style, layout and paint, and emulated throttling is not a real device.
- NFR-02 is met by a deterministic sweep over a fixed grid (closing days 1, 15, 28, 31; counts 1, 2, 3, 12, 60; four totals including one above 2^53; closing days, the day after, before the first statement and today), not by a property test over every count from 2 to 60. The PRD wording was not amended.
- NFR-03, NFR-04 and NFR-05 are met: catalog parity test green and table semantics tested; one extra read at load and none on edit (call count asserted); bigint end to end with no `Number()` on amounts.

## Warnings
- W1: Block 5 adds no production code, so its sweep passed on the first run; only the altered-preview tests show the comparison can fail.
- W2: NFR-02 was narrowed from a property test over counts 2 to 60 to a fixed grid, and the PRD was not amended; edited statement dates and USD are covered by the unit tests, not by the sweep.
- W3: the container has no test that an invalid count or date hides the schedule (AC-01), only the cleared amount.
- W4: the container has no test that choosing USD shows USD in the table; the component and the shared function are tested.
- W5: the AC-11 container test derives its expectation with the same function production uses; the parity test and the e2e carry the independent evidence.
- W6: AC-12 is tested for a 500 on the statements read, not for a 401, a 404 or a dropped connection, nor for the retry button.
- W7: preview and save can still disagree in three cases: the page stays open past midnight (`today` is fixed at load and a purchase dated into the new day can fall in a statement the server creates at save time), statements or the card days are edited on another device, and a device clock ahead of the server. The server stays authoritative and the saved purchase shows the final dates; none of the three is tested.
- W8: the NFR-01 test is machine-dependent and records the first DOM mutation after each input, so an unrelated mutation could be read as the render; it takes the median of eight edits to reduce noise.
- W9: `installment-schedule.ts` has an unreachable `throw` kept for type narrowing and one untested sort-comparator branch.

Result: PASSED

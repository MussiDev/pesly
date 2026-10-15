# Spec FEAT-013: Installment schedule preview and closing-day clarity

| Field | Value |
|-------|-------|
| Ticket | FEAT-013 |
| PRD | docs/ddw/prd/prd-FEAT-013.md |
| Tier | FEATURE |
| Date | 2026-10-15 |
| Spec loops | 0 |
| Loops since last human decision | 0 |

## Summary

The rule that decides which statement a purchase belongs to, and how its installments are split and
dated, lives today only in `apps/api/src/credit-cards/domain`. The preview needs the same rule on the
device, so the three pure pieces (`assignStatement`, `planInstallments`, `datesOfPeriod`) move to
`packages/shared` and the API domain files re-export them, which leaves every API call site and test
untouched. A new pure function `previewInstallmentSchedule` composes them into the rows the form shows.
On the web, the draft validation that already lives in `buildInstallmentPurchaseRequest` is extracted
so the preview and the save share it, a presentational table component renders the rows with the
closing-day note and the closed-statement warning, and the container loads the card's statements once
with the card and computes the schedule from the form's draft. No route, migration or stored data
changes. Moving the rule to `shared` also settles the PRD risk "preview and save disagree".

## Coverage: PRD → blocks

| Requirement | Covered by |
|---|---|
| FR-01 | Block 2, Block 4 |
| FR-02 | Block 1, Block 3 |
| FR-03 | Block 1 |
| FR-04 | Block 1, Block 5 |
| FR-05 | Block 3 |
| FR-06 | Block 1, Block 3 |
| FR-07 | Block 1, Block 3 |
| FR-08 | Block 4 |
| FR-09 | Block 1 |
| FR-10 | Block 3 |
| NFR-01 | Block 5 (Playwright run with 4x CPU throttling) |
| NFR-02 | Block 5 (deterministic sweep through the real use cases) |
| NFR-03 | Block 3 (catalog parity test, table semantics test) |
| NFR-04 | Block 4 (one extra read at load, none on edit) |
| NFR-05 | Block 1, Block 5 (bigint end to end, no float in tests) |

## Dependencies between blocks

Block 1 first: Blocks 2 and 3 are independent of each other and need only Block 1's types. Block 4
needs Blocks 1, 2 and 3. Block 5 needs Blocks 1 and 4. Order: 1, 2, 3, 4, 5.

## Block 1 — Shared rule and schedule

**Files**
- `packages/shared/src/credit-cards/statement-assignment.ts` (new) — `assignStatement`, moved from
  the API domain unchanged.
- `packages/shared/src/credit-cards/installment-schedule.ts` (new) — `PlannedInstallment`,
  `planInstallments`, `datesOfPeriod` moved from `apps/api/src/credit-cards/domain/installment.ts`,
  and the new `previewInstallmentSchedule`.
- `packages/shared/src/index.ts` (modified) — export both modules.
- `apps/api/src/credit-cards/domain/statement-assignment.ts` (modified) — `assignStatement` becomes a
  re-export of the shared one; `statementTotals` and `DailyPurchase` stay.
- `apps/api/src/credit-cards/domain/installment.ts` (modified) — `PlannedInstallment`,
  `planInstallments` and `datesOfPeriod` become re-exports; the rest stays.
- `packages/shared/test/installment-schedule.test.ts` (new).

**Logic**
- `assignStatement(day, statements)` and `planInstallments(total, count, firstPeriod)` keep their
  current bodies. `datesOfPeriod(period, statements, card)` keeps its body with `card` typed as
  `{ closingDay: number; dueDay: number }` and `statements` as `{ period; closingDate; dueDate }[]`
  (structural types, so the API `Statement` and `CreditCard` still fit).
- `previewInstallmentSchedule({ total, count, purchasedOn, today, card, statements })` returns
  `{ kind: 'expense' | 'installments'; rows: ScheduleRow[]; firstClosed: boolean;
  firstClosingDate: string }`, where `ScheduleRow` is `{ number, amount: bigint, period, closingDate,
  dueDate, closed }`.
  1. Sort a copy of `statements` by `closingDate` ascending (the list route returns newest first).
  2. The first period is `assignStatement(purchasedOn, sorted)?.period`; when none closes on or after
     the day, the last stored statement's period (the rule of `CreateInstallmentPurchase`); when the
     list is empty, `firstOpenPeriod(purchasedOn, card.closingDay)`.
  3. `count === 1`: one row with the whole `total` and `kind: 'expense'`. `count` 2 to 60: the rows of
     `planInstallments(total, count, firstPeriod)` with `kind: 'installments'`.
  4. Each row's dates come from `datesOfPeriod`, and `closed` is `isStatementClosed(closingDate,
     today)`. `firstClosed` and `firstClosingDate` read the first row.
- The amounts are `bigint` and no step converts them to a number.

**Input validation**
- `count` must be an integer from 1 to 60 and `total` at least `count` minor units for `count >= 2`;
  otherwise the function throws `RangeError` (the web never calls it with an invalid draft, Block 2).
- `purchasedOn` and `today` are `YYYY-MM-DD` calendar dates.

**Error handling**
- Invalid `count` or `total`: `RangeError` from the existing `splitInstallments`, unchanged.
- An invalid date string: `RangeError` from the existing cycle arithmetic, unchanged.

**Required tests**
- [ ] 100.00 split in 3 gives 33.34, 33.33, 33.33 and the rows add up for a range of totals and counts
      — validates AC-03
- [ ] a purchase on the closing day gets that statement, and the day after gets the next one
      — validates AC-04
- [ ] with stored statements sorted newest first the result is the same as sorted oldest first
      — validates AC-04
- [ ] a statement with edited dates is used for its period and a period not stored gets the default
      cycle dates — validates AC-09
- [ ] one payment gives one row with the full amount and `kind: 'expense'`; two or more give
      `kind: 'installments'` — validates AC-07
- [ ] a first statement closed before `today` sets `firstClosed`; an open one does not
      — validates AC-06
- [ ] a USD purchase keeps its amounts as given with no conversion field — validates AC-10
- [ ] a count of 0 or 61, and a total smaller than the count, are invalid and throw `RangeError`
      — validates AC-13
- [ ] an invalid date string is rejected with a `RangeError` — validates AC-13
- [ ] the existing `statement-assignment`, `installments` and `statement-schedule` API tests pass
      unchanged after the move — validates AC-11

**Completion criterion**
`pnpm --filter @pesly/shared test` and the credit-cards API tests pass, `pnpm typecheck` is clean, and
the API domain files contain no copy of the moved bodies.

## Block 2 — Draft parser shared by preview and save

**Files**
- `apps/web/src/features/credit-cards/installment-request.ts` (modified) — extract
  `parseInstallmentDraft(values, context)` returning `{ currency?, amount?, count?, purchasedOn?,
  fields }`; `buildInstallmentPurchaseRequest` calls it and adds category, note and the request body.
- `apps/web/test/installment-request.test.ts` (modified) — cases for the extracted function.

**Logic**
- `parseInstallmentDraft` holds the current validation of currency, amount (via `parseAmountField`),
  count (the three-digit integer pattern, 1 to 60, and the `amountTooSmall` rule for 2 or more) and
  purchase date (calendar date, not after today in the user's time zone). It adds no new rule.
- `buildInstallmentPurchaseRequest` keeps its signature and result, so the container and its tests are
  unchanged; it merges the draft's `fields` with the category and note checks.

**Input validation**
- Same limits as today: amount through `parseAmountField`, count `^\d{1,3}$` within 1 to 60, date a
  calendar date not in the future.

**Error handling**
- Each invalid value yields the same catalog path as today in `fields`, and the draft then carries no
  value for it.

**Required tests**
- [ ] a valid draft returns the parsed amount, count and date with no fields — validates AC-01
- [ ] an invalid draft (empty amount, count of 0 or 61, malformed or future date) returns the matching
      error field and no parsed value — validates AC-01
- [ ] an amount smaller than the count returns `amountTooSmall` and no parsed amount — validates AC-13
- [ ] every existing `buildInstallmentPurchaseRequest` test passes unchanged — validates AC-11

**Completion criterion**
The existing request-builder tests pass and the new draft tests pass; the builder contains no
duplicate of the draft checks.

## Block 3 — Schedule preview component

**Files**
- `apps/web/src/features/credit-cards/components/installment-schedule-preview.tsx` (new) —
  presentational schedule grid, closing-day note and closed warning.
- `apps/web/messages/es.json` and `apps/web/messages/en.json` (modified) — keys under
  `creditCards.installments.preview`: `title`, `expenseLabel`, `installmentsLabel`, `columns.number`,
  `columns.amount`, `columns.statement`, `columns.closes`, `columns.due`, `closedBadge`,
  `closingDayNote` (argument `date`), `closedWarning`.
- `apps/web/test/installment-schedule-preview.test.tsx` (new).

**Logic**
- Props: `{ schedule: SchedulePreview | null; currency: 'ARS' | 'USD' }`. With `null` it renders
  nothing. Otherwise it renders a captioned grid with header cells (expense or installments label as caption; header cells with
  `scope="col"`) and one row per entry showing number, amount, the statement month, the closing
  date and the due date, plus a badge on a closed statement.
- Amounts are formatted with the existing locale money formatter and dates and periods with
  `features/credit-cards/format-dates.ts`; the component never converts a `bigint` through `Number`.
- Under the grid: the closing-day note with the first statement's closing date, and, when
  `firstClosed`, a destructive `Alert` with the closed warning. Colors and radii come from tokens.
- The component does no fetching and no parsing.

**Error handling**
- A `null` schedule renders nothing; an empty `rows` array is not produced by Block 1.

**Required tests**
- [ ] renders one row per payment with number, amount, statement, closing and due date
      — validates AC-02
- [ ] renders the closing-day note naming the first closing date — validates AC-05
- [ ] renders the closed warning only when `firstClosed` is true — validates AC-06
- [ ] one row shows the expense label and several rows show the installments label
      — validates AC-07
- [ ] a USD schedule shows USD amounts and no ARS figure — validates AC-10
- [ ] a missing (`null`) schedule renders nothing and shows no error — validates AC-01
- [ ] the table exposes column headers to the accessibility tree and 60 rows render
      — validates AC-02
- [ ] the es and en catalogs keep key and argument parity (`i18n-catalogs.test.ts` stays green)
      — validates AC-02
- [ ] a value containing markup is rendered as text — validates AC-02

**Completion criterion**
The component tests pass, the catalog parity test passes, and `pnpm lint` reports no hardcoded
string or color in the new file.

## Block 4 — Form and container wiring

**Files**
- `apps/web/src/features/credit-cards/components/installment-form.tsx` (modified) — `onDraftChange`
  and `schedule` props.
- `apps/web/src/features/credit-cards/containers/installment-purchase-container.tsx` (modified) —
  load statements, hold the draft, compute the schedule.
- `apps/web/test/installment-purchase.test.tsx` (modified) — statements stub and new cases.

**Logic**
- The form calls `onDraftChange({ currency, amount, installments, purchasedOn })` from the form's
  `onChange`, reading the raw strings with `readField`, and renders the preview component below the
  count field with the `schedule` it receives. It still submits as today.
- The container adds `api.listStatements(cardId)` to the existing `Promise.all`; a failure of any
  result takes the existing `failed`, `notFound` or sign-in path, and the page does not show a form
  without statements. The ready state moves into an inner component so the draft state and the memo
  sit above any early return.
- From the draft, the inner component calls `parseInstallmentDraft`; when amount, count and date are
  all valid it calls `previewInstallmentSchedule` with the card's days, the statements and `today`,
  and passes the result to the form; otherwise it passes `null`. Editing the form sends no request.
- The statement list route creates the missing cycles up to the one open today when it is read; the
  preview relies on that and the spec records it as the dependency. `today` is computed once at load,
  so the closed warning can be stale after midnight until the page reloads (accepted).

**Input validation**
- The form's raw strings (currency, amount, count, date) go through `parseInstallmentDraft` of Block 2;
  nothing else is read from the form for the preview.

**Error handling**
- The statements read fails with a network error: the existing load error with retry, no form and no
  schedule.
- Sign-in expired: redirect to sign-in as today.

**Required tests**
- [ ] typing a valid amount, count and date shows the schedule, and clearing the amount hides it
      — validates AC-01
- [ ] changing the count or the date updates the rows with no new request to the API stub
      — validates AC-08
- [ ] a purchase date before the last closed statement shows the closed warning — validates AC-06
- [ ] statements that fail to load show the load error, with no form and no schedule
      — validates AC-12
- [ ] an amount smaller than the count shows the amount error on submit and no schedule
      — validates AC-13
- [ ] saving still posts the same body as before, and a stored purchase matches the rows that were
      shown — validates AC-11
- [ ] the shared test fixture `formRoutes()` stubs the statements route and every existing test passes
      — validates AC-11

**Completion criterion**
The container tests pass with the statements stub, the form shows the live schedule, and no request is
sent while editing.

## Block 5 — Parity, end to end and docs

**Files**
- `apps/api/test/credit-cards/installment-preview-parity.test.ts` (new) — sweep through the real use
  cases.
- `apps/web/e2e/credit-cards-installments.spec.ts` (modified) — preview step in the existing flow.
- `CHANGELOG.md` (modified) — user-facing entry.

**Logic**
- The parity test builds a card and its statements with the in-memory fakes of
  `apps/api/test/credit-cards/fakes.ts` and, for a deterministic grid of closing days (1, 15, 28, 31),
  purchase dates (a closing day, the day after, a day before the first statement, today), totals and
  counts (1, 2, 3, 12, 60), runs `CreateInstallmentPurchase` or `RecordCardExpense` and compares the
  stored installments or the assigned statement with `previewInstallmentSchedule` for the same input:
  same amounts, same statement periods, same dates. It uses `bigint` throughout.
- The e2e test opens the purchase form for a card, types an amount, count and date and checks the
  schedule rows and the closing-day note, then saves and checks the same statements on the card
  detail. A second test runs with 4x CPU throttling and checks that 60 rows appear within 100 ms of
  the last keystroke.
- The CHANGELOG entry says the form now shows the schedule and the closing-day rule.

**Input validation**
The tests take fixed grids and no user input; the e2e types only valid amounts, counts and dates.

**Error handling**
- A mismatch fails the sweep with the input that caused it, and an e2e failure leaves the Playwright
  trace.

**Required tests**
- [ ] the sweep matches the stored installments for 2 to 60 payments — validates AC-11
- [ ] the sweep matches the assigned statement for one payment — validates AC-11
- [ ] a deliberately altered preview makes the sweep fail with the offending input in its error
      — validates AC-11
- [ ] the sweep covers dates before the first statement and a closing day — validates AC-04
- [ ] the e2e flow shows the schedule rows and the closing-day note before saving — validates AC-02
- [ ] the throttled e2e shows 60 rows within 100 ms — validates AC-01

**Completion criterion**
The sweep and the Playwright spec pass, and the CHANGELOG describes the change.

## Final verification

- `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm test:coverage` pass with the coverage floor.
- The API domain files hold no copy of the moved rule, and every API test of credit cards passes
  unchanged.
- The preview and the stored purchase match for the whole sweep, and no new route, migration or
  dependency was added.
- Every AC-01 to AC-13 of the PRD has at least one named test above.

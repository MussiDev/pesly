# Spec FEAT-007: Group detail — suggested payments and recent expenses

| Field | Value |
|-------|-------|
| Ticket | FEAT-007 |
| PRD | docs/ddw/prd/prd-FEAT-007.md |
| Tier | FEATURE |
| Date | 2026-10-12 |
| Spec loops | 3 |
| Loops since last human decision | 0 |

## Summary

Web-only change. The group detail container keeps loading the group and the balances, and now also
loads the 5 newest expenses and the expense options (for category names), each in its own state so
one failure never hides the rest. Two new presentational sections render the suggested payments
(reusing `buildBalanceView`, `SuggestedPayments` and `SettlementFormContainer`) and the recent
expenses (reusing `ExpenseRow`). The new request logic lives in a hook, not in the container body.
No API, shared schema, dependency or migration change.

## Coverage: PRD → blocks

| Requirement | Covered by |
|---|---|
| FR-01, FR-02, FR-05 | Block 2 (section), Block 3 (wiring) |
| FR-03, FR-04 | Block 3 |
| FR-06, FR-07, FR-08 | Block 1 (data), Block 2 (section) |
| FR-09 | Block 1 (independent states), Block 3 |
| FR-10 | Block 2 (catalog keys en/es) |
| FR-11 | Block 2 (props-only sections), Block 1 (hook owns requests) |
| NFR-01 | Block 3: the four calls start in one effect; no call added elsewhere |
| NFR-02 | Block 1 and 3: the group state is independent of the expenses state; skeleton capped at 5 rows |
| NFR-03 | Block 2 (accessible names, wrapping layout) and Block 3 (320 px browser test at the default text size) |
| NFR-04 | Tests of Blocks 1 to 3 keep the 80% floor; no `any` |

## Dependencies between blocks

Block 2 depends on Block 1 (the row view data type). Block 3 depends on Blocks 1 and 2. Order: 1, 2, 3.

## Block 1 — Recent expenses data

**Files**
- `apps/web/src/features/groups/detail/use-recent-expenses.ts` (new) — hook returning
  `{ kind: 'loading' } | { kind: 'failed'; error } | { kind: 'ready'; items }` plus `retry()`; one
  call to `api.listGroupExpenses(groupId, { limit: 5 })` and one to `api.getExpenseOptions(groupId)`,
  started together; an unmounted or superseded request is ignored.
- `apps/web/src/features/groups/detail/recent-expense-items.ts` (new) — pure function mapping
  `GroupExpenseResponse[]` and `ExpenseOptionsResponse` to the `ExpenseRowProps` shape (category via
  `resolveCategory`, payer name, `formatMoney`, `formatDateTime`, the viewer's own share).

**Logic**
The hook never redirects or sets a screen state itself; it reports `UNAUTHENTICATED` and `NOT_FOUND`
to the container through an `onFatal(code)` callback so the container keeps owning navigation
(AC-12). Any other failure becomes `failed` with the API's `messageKey`. The mapping reuses the same
helpers as `group-expenses-container.tsx` and adds no queued-change overlay (out of scope).

**Error handling**
- List or options call fails with a retryable code — `failed`, section shows retry (AC-11).
- 401 / 404 — `onFatal`, the container decides (AC-12).
- An expense whose category is not in the options — `resolveCategory` returns the "uncategorized"
  display; no throw.

**Required tests**
- [ ] Hook requests the list with `limit: 5` and the options once each — validates AC-07, AC-14
- [ ] Items are mapped newest first with category, payer, amount, date and own share — validates AC-07
- [ ] Empty list returns `ready` with zero items — validates AC-09
- [ ] A failed list call returns `failed`, and `retry()` loads again — validates AC-11 (sad path: list call error)
- [ ] A 404 or 401 answer reaches `onFatal` and leaves no `failed` state — validates AC-12 (sad path: not found, unauthenticated)
- [ ] An unmapped category id fails to resolve and falls back to the uncategorized display, with no error thrown — edge case of AC-07

**Completion criterion**
`pnpm --filter ./apps/web test` passes the new hook and mapper tests; both files have no `any`.

## Block 2 — Presentational sections and catalog

**Files**
- `apps/web/src/features/groups/components/group-suggested-payments-section.tsx` (new) — props:
  `views: CurrencyBalanceView[]`, `onRecord(currency, payment)`; renders one `SuggestedPayments` per
  currency that has payments, or the "all settled" message when none has (FR-05).
- `apps/web/src/features/groups/components/group-recent-expenses.tsx` (new) — props:
  `items: ExpenseRowProps[]`, `groupId`; renders up to 5 `ExpenseRow` without `edit`, the "See all"
  link to `/groups/[id]/expenses`, and the empty state with the same link (FR-07, FR-08).
- `apps/web/src/features/groups/components/group-section-state.tsx` (new) — small presentational
  wrapper for a section's `loading` (at most 5 skeleton rows), `failed` (message plus retry button)
  and `ready` content.
- `apps/web/src/features/groups/balances/suggested-payments.tsx` (modified) — the Record button gets
  an accessible name that includes payer and payee (`aria-label` from a new catalog key).
- `apps/web/messages/en.json`, `apps/web/messages/es.json` (modified) — keys under `groups.detail`:
  `suggestedTitle`, `allSettled`, `recentTitle`, `seeAll`, `recentEmpty`, `sectionFailed`,
  `recordFor` (payer and payee in the name). Existing `groups.balances` keys stay as they are.

**Logic**
All three components are pure: no `useApiClient`, no effects, no navigation except `Link`. Amounts
and dates arrive already formatted or go through `formatMoney` and the locale formatters.

**Error handling**
- Section `failed` — shows the translated message and a retry button wired to a prop; never throws.

**Required tests**
- [ ] Suggested section lists payments per currency with payer, payee, formatted amount, Record — AC-01, AC-02
- [ ] Record calls `onRecord` with that currency and payment — AC-03
- [ ] No payments in any currency shows the settled message and no rows — AC-06
- [ ] Recent expenses shows the rows, the See all link href and no row actions — AC-07, AC-08
- [ ] Empty items shows the empty message and the link — AC-09
- [ ] Failed state (error) shows retry and calls it; loading shows at most 5 skeleton rows — AC-10, AC-11, AC-17
- [ ] Sections render with props only and no API client provider — AC-16
- [ ] Spanish and English render from their catalogs — AC-13
- [ ] The Record button's accessible name contains payer and payee — NFR-03
- [ ] A description such as `<img onerror>` renders as literal text, never as markup — threat R-01

**Completion criterion**
Component tests pass; `en.json` and `es.json` have the same new keys (the existing catalog parity
test passes).

## Block 3 — Detail container wiring and browser test

**Files**
- `apps/web/src/features/groups/containers/group-detail-container.tsx` (modified) — balances become
  their own state (`loading | failed | ready`), loaded in the same effect as the group so the four
  calls start together; the own-balance summary keeps its current `null` fallback; renders the two
  sections after `OwnBalanceSummary` and the shortcuts; opens `SettlementFormContainer` inline with
  the pressed payment as `initial`; on `onRecorded` closes the form and reloads the balances only;
  retry buttons reload only their own section.
- `apps/web/test/group-detail.test.tsx` (modified) — new cases for AC-03 to AC-05, AC-10 to AC-12,
  AC-14.
- `apps/web/e2e/group-settlements.spec.ts` (modified) — one scenario: record a suggested payment from the detail
  and see the balance change; one 320 px scenario at the default text size for AC-15.

**Logic**
The group call still decides the screen (`loading`, `not-found`, `ready`, sign-in redirect). Balances
and recent expenses failures never change that decision. The form is mounted keyed by a counter, as
the balances container does, so pressing Record on another payment remounts it.

**Input validation**
No new input is accepted: the only input surface is the existing settlement form, which keeps its
current validation (amount, accounts, members) and its server-side checks. The detail screen passes
it a prefill built from the balances response and validates nothing itself.

**Error handling**
- Balances call fails — suggested section shows retry, own-balance summary shows its current
  fallback, members and expenses stay (AC-10).
- Recording a payment fails — the form stays open and shows the failure through the existing
  `SettlementFormContainer`; balances are not reloaded (AC-05).
- Reload after recording fails — the suggested section shows retry; the form is already closed.

**Required tests**
- [ ] Record on a suggestion opens the form prefilled — AC-03
- [ ] A recorded payment closes the form and reloads balances once, not the group or the expenses — AC-04
- [ ] A failed record (error) keeps the form open and does not reload balances — AC-05
- [ ] A balances call failure shows retry in its section only — AC-10
- [ ] An expenses call failure shows retry in its section only — AC-11
- [ ] A group 404 shows the not-found view and neither section; a 401 redirects — AC-12
- [ ] A failed reload after recording a payment shows retry in the suggested section (error) — AC-10
- [ ] A 404 on the balances or expenses call (not the group call) shows the not-found view and neither section — AC-12, threat R-04
- [ ] First load issues exactly `getGroup`, `getGroupBalances`, `listGroupExpenses`, `getExpenseOptions` once — AC-14
- [ ] The members render while the expenses call is still pending — AC-17
- [ ] e2e: record from the detail changes the balance; 320 px has no horizontal scroll — AC-04, AC-15

**Completion criterion**
`pnpm typecheck`, `pnpm lint` and the web tests pass; the e2e scenarios pass against a local
Postgres; `pnpm test:coverage` stays at or above 80%.

## Final verification

- Every AC-01 to AC-17 has at least one test; every failure path (FR-09) has a sad-path test.
- The balances and settlements screens are untouched and their existing tests still pass.
- No file outside `apps/web` and `docs/ddw` changed; no new dependency; no `any`.

## Decision log

- 2026-10-12: Decided by the owner: AC-15 and NFR-03 are limited to 320 px at the default text size; the group detail at 200% text size is left to its own ticket, because the existing header and balance card already overflow there (measured 522 px of content in a 320 px viewport with the new sections removed).

# Spec DISC-001-05f: Group Expenses Screens

| Field | Value |
|-------|-------|
| Ticket | DISC-001-05f |
| PRD | docs/ddw/prd/prd-DISC-001-05f.md |
| Tier | FEATURE |
| Date | 2026-10-11 |
| Spec loops | 0 |
| Loops since last human decision | 0 |

## Summary
Web only, stacked on 05e. The expense routes already exist (05a, 05b), so this ticket adds no route,
migration or dependency. Block 1 adds five api-client methods. Block 2 is a pure module that turns the
client split state into the request body and computes totals and remaining amounts with the shared money
helpers and `allocateShares`. Blocks 3 to 6 are the screens, each a container (`useApiClient()` plus a
`{kind: loading | failed | ready}` state) over presentational components, using the 05e pattern and
failure mapping through `errors.<messageKey>`: the expense list with pagination, the expense form with the
split editor and the payer account section, the default split and the personal shares page. Block 7
wires pages, links from the group detail, catalogs, the no-literal and no-float scans and the 360 px
end-to-end test. Money stays in `bigint` minor units and basis points everywhere.

## Decisions
- **D1 Routes.** `/groups/[id]/expenses` (list), `/groups/[id]/expenses/new` (form),
  `/groups/[id]/default-split` and `/groups/shares`. The static `/groups/shares` page is placed beside
  `/groups/[id]`; the segment name `shares` is reserved so it never clashes with a group id.
- **D2 One source of truth for rules.** The client builds the split with the shared split types and
  validates it with the shared validators and `allocateShares`; it never re-implements rounding. The
  server stays authoritative and its refusal is shown (AC-10).
- **D3 Typing percentages.** Percentages are typed as decimal text with up to 2 decimals and parsed to
  basis points by integer string parsing (no float step); amounts use `parseAmountInput`.
- **D4 Payer section.** The form loads the caller's accounts and personal categories, so the form needs
  at most 3 requests (options, accounts, personal categories); the fields render only when the caller is
  chosen as payer.
- **D5 Request budget.** Form: expense options, accounts, personal categories (3). List: group
  expense page plus expense options for names (2). Default split: expense options (1). Shares: 1 per page.
- **D6 Online only.** No screen is queued or cached offline (PRD 05 decision); an offline load shows the
  shared error state with a retry.
- **D7 No dialogs, no new dependency.** The form is a page, not a modal.
- **D8 Page size.** The list sends `limit` 50 and follows `nextCursor`; it appends and never re-fetches
  earlier pages.

## Coverage: PRD → blocks
| Requirement | Covered by |
|---|---|
| FR-01, FR-02, FR-03 | Block 3 |
| FR-04, FR-05, FR-06, FR-07, FR-08, FR-09 | Block 4, on the logic of Block 2 |
| FR-10 | Block 4 |
| FR-11 | Block 5 |
| FR-12 | Block 6 |
| FR-13 | Every block adds its catalog keys; Block 7 checks parity |
| NFR-01 | Block 7 (end-to-end at 360 px) |
| NFR-02 | Strategy: one container per screen stays inside its budget (D5), asserted by call-count tests in Blocks 3, 4 and 5 |
| NFR-03 | Strategy: every block adds Spanish and English keys together; the existing catalog parity test runs in each block and in Block 7 |
| NFR-04 | Block 2 |
| NFR-05 | Block 7 (scan), with Block 2 written to pass it |

## Dependencies between blocks
Block 1 and Block 2 are independent and run in parallel first. Blocks 3, 4, 5 and 6 each need Block 1;
Block 4 also needs Block 2, and Block 5 needs Block 2 for percentage parsing. Blocks 3, 4, 5 and 6 are
independent of each other and run in parallel; each owns only its own files and adds catalog keys under
its own sub-namespace of `groups` (`expenses`, `split`, `defaultSplit`, `shares`) by targeted insertion,
so the shared JSON files are the only overlap. Block 7 is last and owns the page files.

| Block | Owns (parallel group) |
|---|---|
| 1 | `api-client.ts` and its test (group A) |
| 2 | `features/groups/split/*` (group A) |
| 3 | `features/groups/expenses/list/*` (group B) |
| 4 | `features/groups/expenses/form/*` (group B) |
| 5 | `features/groups/default-split/*` (group B) |
| 6 | `features/groups/shares/*` (group B) |
| 7 | `app/**` pages, group detail links, e2e, scans |

## Block 1 — api-client expense methods

**Files**
- `apps/web/src/lib/api-client.ts` (modified) — interface (near the group methods) and implementation:
  `createGroupExpense(groupId, body)`, `listGroupExpenses(groupId, {limit, cursor})`,
  `getExpenseOptions(groupId)`, `setDefaultSplit(groupId, body)`,
  `listPersonalShares({from, to, limit, cursor})`.
- `apps/web/test/api-client-group-expenses.test.ts` (new) — the new calls.

**Logic**
Each method (FR-01, FR-02, FR-04, FR-11, FR-12) uses the existing send helpers, validates the response
with the shared response validator of its call, returns the existing `ApiResult` shape and maps error
codes with the existing code-to-key map. Failure keys `groupSplit*`, `groupExpenseCategoryInvalid` and
`groupPayerAccountInvalid` are surfaced as received. Bodies are serialised with the existing bigint-safe
JSON helper so money is never a float.

**Input validation**
- Bodies are checked against the shared request validators before sending; an invalid body returns a
  local failure and sends no request.

**Error handling**
- A response that does not match its validator is a generic `INTERNAL` failure, never partial data.
- 400, 403, 404 and 409 answers keep their message key.

**Required tests**
- [ ] `createGroupExpense` sends the body and returns the parsed expense — validates AC-04.
- [ ] `listGroupExpenses` sends limit and cursor and returns items with `nextCursor` — validates AC-02.
- [ ] `getExpenseOptions` returns members, categories, default split and rate type — validates AC-04.
- [ ] `setDefaultSplit` sends equal and percentage bodies — validates AC-13.
- [ ] `listPersonalShares` sends the range and returns items with the receivable — validates AC-15.
- [ ] A 400 split refusal surfaces its own key — validates AC-10.
- [ ] A 404 for a group the user cannot see stays not found, and a 403 stays forbidden.
- [ ] A malformed response body is an error, not data — invalid input.
- [ ] An invalid body (description over 200 characters) is rejected before any request — invalid input.

**Completion criterion**
The api-client tests pass and typecheck is clean.

## Block 2 — Pure split-editor logic

**Files**
- `apps/web/src/features/groups/split/split-state.ts` (new) — client state types and mode switching.
- `apps/web/src/features/groups/split/split-request.ts` (new) — state to the shared split body, plus
  totals, remaining and per-member preview.
- `apps/web/src/features/groups/split/percentage-input.ts` (new) — typed text to basis points.
- `apps/web/test/groups-split.test.ts`, `apps/web/test/groups-split.property.test.ts` (new).

**Logic**
The state holds the mode, the selected member ids (equal), a text value per member (percentage and exact)
and the amount in minor units. `buildSplit(state, amount, payerMemberId)` returns either the shared split
body or a list of field errors as catalog paths. `previewShares` calls `allocateShares` so the leftover
minor units go to the payer first (FR-06, AC-07). `percentageTotal` and `exactRemaining` return signed
`bigint` differences used by FR-07, FR-08 and FR-09 (`10000 - total`, `amount - sum`). Changing the mode
keeps amount and payer and resets only the per-member values (AC-06). No float conversion touches money.

**Input validation**
- Percentage text: digits with at most 2 decimals, between 0 and 100; exact text goes through
  `parseAmountInput`; an empty or malformed value is a field error. Equal mode needs at least 1 member.

**Error handling**
- Every failure is a catalog path, never a thrown error; a split that does not add up returns the
  difference so the UI can say by how much it is off.

**Required tests**
- [ ] Equal mode over 3 members of 100.00 gives the leftover cent to the payer first — validates AC-07.
- [ ] Percentage total of 9999 basis points reports a difference of 1 and no body — validates AC-08.
- [ ] Exact amounts that sum to the total build a body; a shortfall reports the remaining amount — validates AC-09.
- [ ] Changing mode keeps amount and payer and clears per-member values — validates AC-06.
- [ ] Property test over 1,000 random splits of random amounts: no split the client accepts is refused
  by the shared split validators — validates NFR-04.
- [ ] An empty equal selection is invalid and returns a field error.
- [ ] A percentage such as `12.345` or `abc` is rejected as a field error — invalid input.
- [ ] A negative or non-numeric exact amount is rejected — invalid input.

**Completion criterion**
Unit and property tests pass, and the module has no float arithmetic on money.

## Block 3 — Expense list container and component

**Files**
- `apps/web/src/features/groups/expenses/list/group-expenses-container.tsx` (new).
- `apps/web/src/features/groups/expenses/list/group-expenses-list.tsx`, `expense-row.tsx`,
  `expenses-empty-state.tsx` (new).
- `apps/web/test/group-expenses-list.test.tsx` (new).
- `apps/web/messages/es.json`, `en.json` (modified) — `groups.expenses`.

**Logic**
The container loads the first page (limit 50) and the expense options in 2 requests (FR-01). Each row
shows description, category name, payer name, amount with currency through `formatMoney`, the date through
`formatDateTime` and the viewer's own share. "Load more" (FR-02) requests the next cursor and appends.
An empty group shows the empty state with an add expense link (FR-03). The presentational list is pure.

**Input validation**
- The cursor comes only from the previous response, never from user text.

**Error handling**
- A load failure shows the shared error state with a retry; a failed "load more" keeps the loaded rows and
  offers a retry.
- A 404 shows the not-found state with a link to the groups list.

**Required tests**
- [ ] The list shows description, category, payer, amount, date and the viewer's share, newest first — validates AC-01.
- [ ] "Load more" appends the next 50 without reloading and disappears when `nextCursor` is null — validates AC-02.
- [ ] An empty group shows the empty state with the add expense action — validates AC-03.
- [ ] A load error shows the retry and the retry loads again.
- [ ] A failed "load more" keeps the loaded rows and shows an error.
- [ ] A 404 shows the not-found state with a link back.
- [ ] The first load makes at most 2 requests — validates NFR-02.
- [ ] Spanish and English strings render for the list — validates AC-17.

**Completion criterion**
Component and container tests pass and the catalog parity test passes.

## Block 4 — Expense form, split editor and payer account section

**Files**
- `apps/web/src/features/groups/expenses/form/expense-form-container.tsx` (new).
- `apps/web/src/features/groups/expenses/form/expense-form.tsx`, `split-mode-picker.tsx`,
  `equal-split-fields.tsx`, `percentage-split-fields.tsx`, `exact-split-fields.tsx`,
  `payer-account-fields.tsx`, `split-summary.tsx` (new).
- `apps/web/src/features/groups/expenses/form/expense-request.ts` (new) — field validation and body.
- `apps/web/test/group-expense-form.test.tsx`, `apps/web/test/group-expense-request.test.ts` (new).
- `apps/web/messages/es.json`, `en.json` (modified) — `groups.split` and `groups.expenses.form`.

**Logic**
The container loads expense options, the caller's accounts and personal categories (3 requests) and
prefills the split from the group default split and the date with today in the user's time zone (FR-04).
The form has one field group per step: amount and currency, date and payer, category and description,
split. The mode picker (FR-05) switches among equal (member checkboxes with the resulting share per member,
FR-06), percentage (a field per member and the running total against 100%, FR-07) and exact (a field per
member and the remaining amount, FR-08), using Block 2. Send is disabled while the split is off and the
difference is shown (FR-09). When the chosen payer is the current user, the form shows an account picker
limited to the caller's accounts in the expense currency and a personal category picker, and requires
both; it says so and sends nothing when no account has that currency (FR-10). When the payer is another
member, those fields are not rendered and not sent. On success the user returns to the list with the new
expense on top (AC-04).

**Input validation**
- Amount: required, positive, parsed by `parseAmountInput`. Description: required, trimmed, 1 to 200
  characters. Date, payer, category and currency: required and chosen from loaded options.

**Error handling**
- Field errors show before any request and focus the first invalid field.
- A server split refusal (400) shows its message and keeps every entered value (AC-10).
- 404 and 403 show their messages; the form data is untouched.

**Required tests**
- [ ] A valid form creates the expense and shows it at the top of the list — validates AC-04.
- [ ] An empty, zero or non-numeric amount shows a field error and sends no request — validates AC-05.
- [ ] An empty description or one over 200 characters is invalid and sends no request — validates AC-05.
- [ ] Changing the split mode keeps amount and payer and resets the per-member values — validates AC-06.
- [ ] Equal mode shows each share with the leftover to the payer first — validates AC-07.
- [ ] Percentages that do not total 100% show the difference and disable sending — validates AC-08.
- [ ] Exact amounts that do not sum to the total show the remaining amount and disable sending — validates AC-09.
- [ ] A 400 split refusal shows the server message and keeps everything entered — validates AC-10.
- [ ] Choosing the current user as payer requires an account in the currency and a personal category — validates AC-11.
- [ ] Choosing the current user as payer with no account in that currency shows a message and sends no request — validates AC-12.
- [ ] Choosing another member as payer does not render or send the account fields — validates AC-11.
- [ ] A 403 or 404 on submit shows its message and keeps the form.
- [ ] The form loads with at most 3 requests — validates NFR-02.
- [ ] Spanish and English strings render for the form — validates AC-17.

**Completion criterion**
Tests pass and a member can record an expense with each split mode.

## Block 5 — Default split container

**Files**
- `apps/web/src/features/groups/default-split/default-split-container.tsx` (new).
- `apps/web/src/features/groups/default-split/default-split-form.tsx`,
  `default-split-readonly.tsx` (new).
- `apps/web/src/features/groups/default-split/default-split-request.ts` (new).
- `apps/web/test/group-default-split.test.tsx` (new).
- `apps/web/messages/es.json`, `en.json` (modified) — `groups.defaultSplit`.

**Logic**
The container loads the expense options (1 request) and the group role. An admin edits the default as
equal or by percentages per member (FR-11), reusing the percentage parsing and total of Block 2, and
saves it; the next expense form then prefills from it (AC-13). A member who is not an admin sees the
current default read only (AC-14).

**Input validation**
- Percentages must total 10000 basis points; each member id comes from the loaded members.

**Error handling**
- A 403 shows its message and leaves the default unchanged; a 400 refusal is shown and keeps typed values.
- A load failure shows the shared error state with a retry.

**Required tests**
- [ ] An admin saves a percentage default and the next form is prefilled with it — validates AC-13.
- [ ] An admin saves an equal default — validates AC-13.
- [ ] A non-admin member sees the default read only with no save control — validates AC-14.
- [ ] Percentages that do not total 100% are invalid, show the difference and send no request — invalid input.
- [ ] A 403 on save shows its message and changes nothing.
- [ ] A 400 refusal keeps the typed values.
- [ ] The page loads with at most 1 request — validates NFR-02.

**Completion criterion**
Tests pass and the admin and member views work.

## Block 6 — Personal shares page

**Files**
- `apps/web/src/features/groups/shares/personal-shares-container.tsx` (new).
- `apps/web/src/features/groups/shares/personal-shares-list.tsx`, `shares-range-form.tsx`,
  `shares-totals.tsx` (new).
- `apps/web/src/features/groups/shares/shares-request.ts` (new) — range validation.
- `apps/web/test/personal-shares.test.tsx` (new).
- `apps/web/messages/es.json`, `en.json` (modified) — `groups.shares`.

**Logic**
The page defaults to the current month in the user's time zone, requests the shares for the range and lists
each one with group, currency, date, share amount and, when the user paid, the amount still owed to them
(FR-12). Totals are summed per currency with `bigint` and never converted between currencies. "Load more"
follows the cursor.

**Input validation**
- From and to are valid dates, with from not after to; otherwise a field error and no request.

**Error handling**
- A load failure shows the shared error state with a retry; an empty range shows an empty state.

**Required tests**
- [ ] The page lists shares for the range with currency and per-currency totals, with no conversion — validates AC-15.
- [ ] The receivable shows only on shares the user paid — validates AC-15.
- [ ] A range where from is after to shows a field error and sends no request — validates AC-16.
- [ ] A malformed date is invalid and sends no request — validates AC-16.
- [ ] An empty range shows the empty state.
- [ ] A load error shows the retry.
- [ ] The page makes 1 request per page of results — validates NFR-02.
- [ ] Spanish and English strings render — validates AC-17.

**Completion criterion**
Tests pass and the totals match the listed items per currency.

## Block 7 — Pages, links, catalogs and end-to-end checks

**Files**
- `apps/web/src/app/[locale]/(app)/groups/[id]/expenses/page.tsx`, `expenses/new/page.tsx`,
  `[id]/default-split/page.tsx`, `groups/shares/page.tsx` (new) — thin server pages.
- `apps/web/src/features/groups/containers/group-detail-container.tsx` (modified) — links to the
  expenses, the new expense form, the default split, and the shares page.
- `apps/web/e2e/group-expenses.spec.ts` (new), `apps/web/e2e/support/group-expenses.ts` (new).
- `apps/web/test/group-expenses-no-hardcoded-strings.test.ts` (new) — scans the new folders for
  literals and for `parseFloat`, `toFixed` and `Number(` applied to money.

**Logic**
The pages render their containers and read the group id from the route. The detail links mirror the
categories link. One Playwright spec with two users creates a group, records an expense with each split
mode, reads the list and the shares page, and has an admin set the default. A second test opens every new
screen at 360 px and asserts no horizontal scroll (NFR-01). The scan covers every touched file (NFR-05).

**Input validation**
- The group id in the route must be a valid identifier; a malformed id shows the not-found state and
  sends no request.

**Error handling**
- The spec resets attempt limits before each test, as the existing specs do.

**Required tests**
- [ ] Create expense, list and shares flow passes with two users — validates AC-01, AC-04, AC-15.
- [ ] The list, form, default split and shares fit 360 px without horizontal scroll — validates NFR-01.
- [ ] The Spanish and English catalogs have the same keys, none empty — validates NFR-03 and AC-17.
- [ ] No expense string is hardcoded and no `parseFloat`, `toFixed` or `Number(` is applied to money — validates NFR-05.
- [ ] A split the server refuses shows the message in the browser — invalid input.
- [ ] A member who is not in the group gets the not-found state on the expenses page — 404.

**Completion criterion**
The spec and the scans pass, and the full web suite and coverage thresholds pass.

## Final verification
- Every AC (AC-01 to AC-17) and NFR (NFR-01 to NFR-05) has a test; every input has a sad-path test.
- `pnpm typecheck`, eslint and Prettier on touched files pass; the full suite and coverage pass.
- The design-system scan and accessibility tests pass for the new screens (labels, focus on the first
  invalid field, tokens only).
- Owner ratification items: online-only expense entry, personal shares owned by 05f, and that the
  shares route is the static `/groups/shares`.

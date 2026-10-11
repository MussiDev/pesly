# Spec DISC-001-05g: Balances and Settlements Screens

| Field | Value |
|-------|-------|
| Ticket | DISC-001-05g |
| PRD | docs/ddw/prd/prd-DISC-001-05g.md |
| Tier | FEATURE |
| Date | 2026-10-11 |
| Spec loops | 0 |
| Loops since last human decision | 0 |

## Summary
Web only, stacked on 05e. The balances, settlement and consolidation routes already exist (05c, 05d), so
this ticket adds no route, migration or dependency. Block 1 adds four api-client methods. Block 2 is a pure
module: amount, date and rate parsing with the shared helpers, the single-settlement and consolidation
request builders, and the balance view data (who owes, who is owed, own balance first). Blocks 3 to 6 are
the screens, each a container (`useApiClient()` plus a `{kind: loading | failed | not-found | ready}`
state) over presentational components, following the 05e pattern and its failure mapping through
`errors.<messageKey>`: the balances page with suggested payments, the single settlement form with the
account choice, the consolidation flow, and the settlements history. Block 7 links the page from the group
detail and shows the user's own balance there. Block 8 wires the pages, the catalogs and the end-to-end and
request-count checks. Money stays in `bigint` minor units, rates scaled by 10,000, and strings on the wire.

## Decisions
- **D1 Routes.** `/groups/[id]/balances` (balances, suggested payments and the single settlement form),
  `/groups/[id]/settlements` (history) and `/groups/[id]/settlements/consolidate` (consolidation). The
  balances page is separate from the detail, as the PRD decides, so the detail keeps its budget.
- **D2 The single form is a panel, not a route.** "Record" on a suggested payment, or "Record a payment",
  opens the form inside the balances page from component state. The prefill (members, currency, amount) never
  travels in the URL, costs no request and leaves no amount in browser history or server logs.
- **D3 Own member id.** "Own balance first" (AC-21), "is the caller a party" (AC-10, AC-11) and the detail
  summary (FR-11) need the caller's member id. The group detail answer of 05f carries `selfMemberId`; this
  ticket reads it from `getGroup` and adds no request. 05g therefore starts coding after 05f is merged into
  the chain (or rebased on it). It is the only coupling and it is a ratification item.
- **D4 Request budget.** Balances page: `getGroup` and `getGroupBalances` (2, NFR-02). History: `getGroup`
  (for names) and the first settlements page (2). Consolidation page: `getGroup` (1), then one preview per
  choice of pair and currency. The account list is requested only when a form opens for a caller who is a
  party, one request per form opening; it is an action, not page load.
- **D5 Accounts.** The account choice uses `listAccounts({archived: false, limit: 100})` and filters by the
  settlement currency on the client. "None" is always offered and is the default. An account is never sent
  when the caller is not a party (AC-11); the API enforces it as well.
- **D6 Preview is the source of the legs.** The consolidated request sends the preview legs verbatim, in the
  order `memberA`, `memberB` that produced them; the client never recomputes a leg. The client computes only
  the cash shown before confirming (`convertMinorUnits` of `@pesly/shared`, the function the API uses) and
  never sends it. A non-zero leg on both currencies is required to offer recording (AC-13).
- **D7 Rate input.** The manual rate is typed in the locale notation and parsed to a rate scaled by 10,000
  with `parseRateInput`; it is sent as a decimal string. When the group has no stored rate (`rate: null`)
  recording needs a manual rate; the form says so and sends nothing without it.
- **D8 Stale preview (409).** `GROUP_SETTLEMENT_STALE` reloads the preview, replaces the shown legs, keeps
  the members, currency and any manual rate typed, shows the stale message and requires a new confirmation.
  Nothing is recorded automatically after a reload.
- **D9 Result of a consolidation.** After a 201 the confirmation shows who pays whom and the amount in the
  chosen currency from the response, then loads the preview of the same pair once more to show both legs at
  0 (a preview with zero legs is a 200); that one extra request is an action, not page load.
- **D10 Paging.** The history sends `limit` 50 and follows `nextCursor`; it appends and never refetches
  earlier pages. The cursor comes only from the previous response. Rows are deduplicated by settlement id as
  a second guard against repeats.
- **D11 Online only, no dialogs, no dependency.** Nothing is queued or cached offline; an offline load shows
  the shared error state with a retry. Forms are in-page panels or pages, not modals.
- **D12 Names.** Member names come from `getGroup` (`members` and `formerMembers`); a ghost or an unnamed
  member uses the existing `groups.detail.unnamed` copy. Former members can appear in balances and history
  and are shown with their stored name.
- **D13 Direction in words.** Before sending, the form shows "A pays B amount" in words built from the
  chosen values, as the PRD risk mitigation asks.

## Coverage: PRD → blocks
| Requirement | Covered by |
|---|---|
| FR-01 | Block 1 |
| FR-02 | Block 2, Block 3 |
| FR-03 | Block 3 |
| FR-04 | Block 3, Block 4 |
| FR-05 | Block 2, Block 4 |
| FR-06 | Block 4 |
| FR-07 | Block 5 |
| FR-08 | Block 2, Block 5 |
| FR-09 | Block 5 |
| FR-10 | Block 6 |
| FR-11 | Block 7 |
| FR-12 | Block 8; every block adds its catalog keys and uses the locale formatters |
| NFR-01 | Block 8 (end-to-end at 360 px) |
| NFR-02 | Strategy: one container per screen stays inside its budget (D4), asserted by a call-count test in Block 3 and in Block 6; Block 8 counts again in the browser |
| NFR-03 | Strategy: every block adds Spanish and English keys together; the existing catalog parity test runs in each block and in Block 8 |
| NFR-04 | Block 2 (property test), Block 1 (wire strings) |

## Dependencies between blocks
Block 1 and Block 2 are independent and run first, in parallel. Blocks 3, 4, 5 and 6 each need Block 1 and
Block 2; Block 3 mounts the form of Block 4, so Block 4 is built before Block 3 is wired, and Blocks 5 and 6
are independent of both. Block 7 needs Block 1 and Block 2. Block 8 is last and owns the page files and the
end-to-end spec. Each block adds its catalog keys under its own sub-namespace of `groups`
(`balances`, `settlement`, `consolidate`, `settlements`) by targeted insertion, so the shared JSON files are
the only overlap. 05f touches `api-client.ts` and the catalogs too: merge order decides who rebases (PRD).

| Block | Owns (parallel group) |
|---|---|
| 1 | `api-client.ts` and its test (group A) |
| 2 | `features/groups/settlements/*.ts` logic (group A) |
| 3 | `features/groups/balances/*` (group B) |
| 4 | `features/groups/settlement-form/*` (group B) |
| 5 | `features/groups/consolidation/*` (group B) |
| 6 | `features/groups/settlements-history/*` (group B) |
| 7 | `group-detail-container.tsx` (group C) |
| 8 | `app/**` pages, e2e, catalogs check (last) |

## Block 1 — api-client settlement methods

**Files**
- `apps/web/src/lib/api-client.ts` (modified) — interface (beside `getSettlement`) and implementation:
  `getGroupBalances(groupId)`, `listSettlements(groupId, {limit, cursor})`,
  `createSettlement(groupId, body)` and `getConsolidationPreview(groupId, {memberA, memberB, currency})`.
- `apps/web/test/api-client-group-settlements.test.ts` (new) — the four calls with a fake `fetch`, as
  `api-client-groups.test.ts` does.

**Logic**
Each method (FR-01) goes through the existing `onGroup` path helper, `request` with
`refreshOnUnauthenticated: true`, and validates the answer with the shared response validator of its route:
`balancesResponseSchema`, `settlementPageSchema`, `settlementResponseSchema` and
`consolidationPreviewSchema`. Failure mapping reuses `MESSAGE_KEY_BY_CODE`; the settlement keys
(`groupSettlementMemberInvalid`, `groupSettlementAccountInvalid`, `groupSettlementNothingToConsolidate`,
`groupSettlementStale`, `rateRequired`) already exist and are surfaced as received. The preview and list
query strings are built with `URLSearchParams` from validated values, so `memberA`, `memberB`, `currency`,
`limit` and `cursor` are encoded. Bodies are the shared `CreateSettlementRequest`; money, legs and the rate
are strings and are never converted to a number.

**Input validation**
- The group id goes through `resourcePath`; a malformed id returns `VALIDATION_FAILED` and sends no request.
- `createSettlement` checks the body with `createSettlementRequestSchema` and `getConsolidationPreview`
  checks the query with `consolidationQuerySchema` before sending; an invalid one is a local
  `VALIDATION_FAILED` and sends no request.

**Error handling**
- A response that does not match its validator is a generic `INTERNAL` failure, never partial data.
- 400, 404 and 409 answers keep their message key; a 409 `GROUP_SETTLEMENT_STALE` has no `details.current`,
  so it stays an ordinary failure with code `GROUP_SETTLEMENT_STALE`.
- A 401 is retried once through the existing refresh path.

**Required tests**
- [ ] `getGroupBalances` calls `GET /groups/:id/balances` and returns the parsed balances — validates AC-01.
- [ ] `listSettlements` sends `limit` and `cursor` and returns items with `nextCursor` — validates AC-01.
- [ ] `createSettlement` sends a single and a consolidated body and returns the settlement — validates AC-01.
- [ ] `getConsolidationPreview` sends `memberA`, `memberB` and `currency` and returns legs, rate type and
  rate (also with `rate: null`) — validates AC-01.
- [ ] 1,000 random amounts typed as locale text reach the request body as the exact minor-units string, with
  no `number` anywhere on the path — validates NFR-04.
- [ ] A 400 `GROUP_SETTLEMENT_MEMBER_INVALID` and a 400 `GROUP_SETTLEMENT_NOTHING_TO_CONSOLIDATE` surface their
  own keys — validates AC-09, AC-13.
- [ ] A 409 `GROUP_SETTLEMENT_STALE` surfaces `groupSettlementStale` — validates AC-17.
- [ ] A 404 for a group the user is not in is `NOT_FOUND` — validates AC-23.
- [ ] A malformed response body is an error, not data — invalid input.
- [ ] A malformed group id, a body with `fromMemberId` equal to `toMemberId` and a query with equal members
  are rejected before any request — invalid input.

**Completion criterion**
The api-client tests pass and typecheck is clean.

## Block 2 — Pure settlement logic

**Files**
- `apps/web/src/features/groups/settlements/balance-view.ts` (new) — the balance view data.
- `apps/web/src/features/groups/settlements/settlement-request.ts` (new) — form values to the single body,
  with field errors.
- `apps/web/src/features/groups/settlements/consolidation-request.ts` (new) — preview, rate and cash to the
  consolidated body.
- `apps/web/test/groups-settlements-logic.test.ts`, `apps/web/test/groups-settlements-logic.property.test.ts`
  (new).

**Logic**
`buildBalanceView(balances, group, selfMemberId)` returns, per currency, one row per member with the signed
`bigint` balance, a status (`owes` when negative, `owed` when positive, `even` at 0), the member name from
`members` or `formerMembers`, the caller's row first (AC-21), and the payments with names. A currency whose
every balance is 0 is `settled` (AC-05). `buildSettlementRequest(values, context)` parses the amount with
`parseAmountInput` (positive), turns the local date into an instant with `zonedLocalToInstant` in the user's
time zone, requires two different members and returns the shared `kind: 'single'` body or field errors as
catalog paths; the account id is included only when the caller is a party and chose one (D5).
`buildConsolidationRequest(preview, choice)` returns the `kind: 'consolidated'` body with `memberIds`
`[memberA, memberB]`, the currency, the date, the preview legs verbatim and, only when typed, the manual rate
parsed by `parseRateInput` and sent as its decimal string (D6, D7). `cashOf(preview, currency, rate)`
computes the amount that changes hands with `convertMinorUnits` and the sign rule of the API (the leg in the
chosen currency plus the converted other leg; a negative total swaps the parties). No float conversion
touches money.

**Input validation**
- Amount text: required, positive, at most two decimals, within the movement maximum; any other text is a
  field error. Date: a valid local date-time, not skipped by a time-zone gap, not in the future.
- Members: both chosen from the loaded active members and different. Currency: ARS or USD.
- Rate text: digits with the locale decimal separator, up to 4 decimals, greater than 0 and at most the
  shared maximum; empty, zero, negative or malformed text is a field error.

**Error handling**
- Every failure is a catalog path in a field-errors object, never a thrown error; a form with errors builds
  no body.

**Required tests**
- [ ] A negative balance is `owes` and a positive one is `owed`, in ARS and USD separately — validates AC-03.
- [ ] The caller's row comes first in each currency, the rest keep the API order — validates AC-21.
- [ ] A currency whose balances are all 0 is `settled` with no payments — validates AC-05.
- [ ] A suggested payment prefills members, currency, amount and today's date in the user's time zone —
  validates AC-06.
- [ ] A valid form builds the single body with minor-units strings — validates AC-07.
- [ ] An empty, `0`, negative or non-numeric amount is a field error with no body — validates AC-08.
- [ ] The same member on both sides is a field error with no body — validates AC-08.
- [ ] The account id is in the body only for a party who chose one, never for a non-party — validates AC-10,
  AC-11.
- [ ] The consolidated body carries the preview legs verbatim and `memberIds` in preview order — validates
  AC-12.
- [ ] A manual rate `1.234,5678` (es) and `1,234.5678` (en) becomes `12345678` as a string — validates AC-14.
- [ ] An empty rate, `0`, a negative one and `abc` are field errors with no body — validates AC-15.
- [ ] `cashOf` matches the cash the API stores for a set of fixed cases, including a negative total that
  swaps the parties — validates AC-16.
- [ ] Property test over 1,000 random amounts and rates: the string sent equals the value typed and no
  accepted body is refused by the shared request validators — validates NFR-04.
- [ ] A date in the future, a malformed date and an amount above the maximum are field errors — invalid input.

**Completion criterion**
Unit and property tests pass, and the module has no float arithmetic on money (scanned in Block 8).

## Block 3 — Balances page and suggested payments

**Files**
- `apps/web/src/features/groups/balances/group-balances-container.tsx` (new).
- `apps/web/src/features/groups/balances/balances-by-currency.tsx`, `member-balance-row.tsx`,
  `suggested-payments.tsx` (new).
- `apps/web/test/group-balances.test.tsx` (new).
- `apps/web/messages/es.json`, `en.json` (modified) — `groups.balances`.

**Logic**
The container loads `getGroup` and `getGroupBalances` in parallel (2 requests, FR-02, NFR-02) and builds the
view with Block 2. Each currency is a section with its members (name, formatted balance with `formatMoney`,
and an owes or owed badge that carries text, not only colour), then the suggested payments as
"{payer} pays {payee} {amount}" with a "Record" button (FR-03, FR-04), or the settled state when the
currency has no payments (AC-05). The page also has a "Record a payment" button and links to the history and
to the consolidation. "Record" and "Record a payment" open the panel of Block 4 in place (D2); when it
reports a recorded settlement the container reloads only the balances (1 request). The presentational parts
are pure and receive the view data and callbacks.

**Error handling**
- A load failure shows the shared error state with a retry; a 404 on either request shows the not-found
  state with a link back to the groups list (AC-23); a 401 that cannot be refreshed goes to sign-in.
- A failed reload after recording keeps the old balances and shows the failure with a retry.

**Required tests**
- [ ] The page shows each member's balance in ARS and in USD separately — validates AC-02.
- [ ] A negative balance shows "owes" and a positive one "is owed", with text — validates AC-03.
- [ ] A currency with payments lists each as payer, payee and amount — validates AC-04.
- [ ] A currency with all balances 0 shows the settled state and no payments — validates AC-05.
- [ ] "Record" on a suggested payment opens the form prefilled — validates AC-06.
- [ ] The caller's own balance is the first row of each currency — validates AC-21.
- [ ] A 404 shows the not-found state and a link back — validates AC-23.
- [ ] The first load makes exactly 2 requests (`getGroup`, `getGroupBalances`) — validates NFR-02.
- [ ] A recorded settlement reloads the balances with 1 request and shows the new numbers — validates AC-07.
- [ ] A load error shows the retry and the retry loads again — error handling.
- [ ] Spanish and English strings render for the page — validates AC-22.

**Completion criterion**
Component and container tests pass and the catalog parity test passes.

## Block 4 — Single settlement form with account choice

**Files**
- `apps/web/src/features/groups/settlement-form/settlement-form-container.tsx` (new) — owns the form state,
  the account request and the submit.
- `apps/web/src/features/groups/settlement-form/settlement-form.tsx`, `settlement-account-field.tsx`,
  `settlement-direction-summary.tsx` (new) — presentational.
- `apps/web/test/settlement-form.test.tsx` (new).
- `apps/web/messages/es.json`, `en.json` (modified) — `groups.settlement`.

**Logic**
The form (FR-05) has the payer, the payee, the currency, the amount and the date, prefilled from a
suggested payment or from today (FR-04), and a sentence "{payer} pays {payee} {amount}" updated as the
values change (D13). When the caller is the payer or the payee (`selfMemberId`), the container requests
`listAccounts` once per opening and the account field offers the caller's open accounts of the chosen
currency plus "none" (FR-06, D5); changing the currency or the parties refreshes the choices and drops an
account that no longer fits. Otherwise the field is not rendered and nothing is sent. Submit builds the body
with Block 2; while a request is in flight the button is disabled and the form ignores a second submit. On
201 the form closes and tells the balances container to reload. Ghost members can be chosen on either side
(someone records the settlement for them).

**Input validation**
- As Block 2: positive amount, valid date, two different active members, currency, optional account id
  taken only from the loaded account list.

**Error handling**
- Field errors show before any request and focus the first invalid field.
- 400 `GROUP_SETTLEMENT_MEMBER_INVALID` shows its message, keeps every typed value and keeps the form open
  (AC-09); 400 `GROUP_SETTLEMENT_ACCOUNT_INVALID` shows its message and clears only the account.
- 404 shows the not-found message; a failure to load the accounts shows an inline retry and still allows
  recording without an account.

**Required tests**
- [ ] A valid form records the settlement and the balances page shows the updated balances — validates AC-07.
- [ ] An empty, zero or negative amount shows a field error and sends no request — validates AC-08.
- [ ] The same member on both sides shows a field error and sends no request — validates AC-08.
- [ ] A 400 member-invalid answer shows its message and keeps the form with its values — validates AC-09.
- [ ] A caller who is a party sees their open accounts of the currency and the chosen id is sent — validates
  AC-10.
- [ ] A caller who is not a party sees no account field, the accounts are not requested and no account id is
  sent — validates AC-11.
- [ ] Changing the currency refreshes the accounts and drops one in another currency — validates AC-10.
- [ ] The form shows "A pays B amount" in words and it follows the values — validates AC-06.
- [ ] A double click sends one request — validates AC-07.
- [ ] A 400 account-invalid answer clears only the account and keeps the rest — validates AC-10.
- [ ] A failed account load shows a retry and recording without an account still works — error handling.
- [ ] Spanish and English strings render for the form — validates AC-22.

**Completion criterion**
Tests pass and a member can record a payment from a suggestion and from scratch.

## Block 5 — Consolidation flow

**Files**
- `apps/web/src/features/groups/consolidation/consolidation-container.tsx` (new).
- `apps/web/src/features/groups/consolidation/consolidation-choice-form.tsx`, `consolidation-preview.tsx`,
  `consolidation-rate-field.tsx`, `consolidation-result.tsx` (new).
- `apps/web/test/consolidation.test.tsx` (new).
- `apps/web/messages/es.json`, `en.json` (modified) — `groups.consolidate`.

**Logic**
The container loads `getGroup` (1 request). The member picks two different active members and the currency
to settle in (FR-07, defaulting the first member to the caller). Each valid choice requests the preview; the
screen shows the amount of each currency per member direction, the group's default rate type by name and the
prefilled rate formatted with `formatRateInput`, and the cash that would change hands in the chosen currency
from `cashOf` (D6). The member may type a manual rate that replaces the prefilled one (FR-08, D7). If either
leg is 0 the screen says there is nothing to consolidate and offers no record action (AC-13). "Record" sends
the consolidated body; on 201 the screen shows one confirmation with who pays whom and the amount in the
chosen currency, and loads the preview of the pair again to show both legs at 0 (FR-09, D9). A 409
`GROUP_SETTLEMENT_STALE` reloads the preview, shows the new legs and cash, keeps the choice and the manual
rate, and asks for a new confirmation (AC-17, D8). Changing the choice discards the previous preview and
ignores late answers of an earlier choice.

**Input validation**
- Two different active members from the loaded group, currency ARS or USD, rate and date as Block 2. The
  legs come only from the last preview; nothing typed becomes a leg.

**Error handling**
- 400 nothing-to-consolidate shows its message and no record action; 400 member-invalid shows its message
  and keeps the choice; a 400 for a cash above the maximum shows the validation message.
- `RATE_REQUIRED` (no stored rate and none typed) shows the rate field error; the form asks for a manual rate.
- A preview failure shows an inline error with a retry and keeps the choice; 404 shows the not-found state.

**Required tests**
- [ ] Choosing two members and a currency shows the amount in each currency, the rate type and the rate —
  validates AC-12.
- [ ] Two members with a zero leg show "nothing to consolidate" and no record action — validates AC-13.
- [ ] A manual rate greater than 0 replaces the prefilled one and is sent as its scaled string — validates
  AC-14.
- [ ] An empty or 0 manual rate shows a field error and sends no record request — validates AC-15.
- [ ] A recorded consolidation shows the cash amount in the chosen currency and both legs at 0 — validates
  AC-16.
- [ ] A 409 stale answer reloads the preview, shows the new legs, keeps the manual rate and asks to confirm
  again, with nothing recorded meanwhile — validates AC-17.
- [ ] The preview with `rate: null` requires a manual rate before recording — validates AC-15.
- [ ] Choosing the same member twice is a field error and requests no preview — invalid input.
- [ ] A late preview of an earlier choice does not overwrite the current one — invalid input.
- [ ] A preview failure shows the retry and keeps the choice — error handling.
- [ ] A double click on record sends one request — validates AC-16.
- [ ] Spanish and English strings render for the flow — validates AC-22.

**Completion criterion**
Tests pass and a consolidation can be previewed, adjusted, recorded and re-confirmed after a stale answer.

## Block 6 — Settlements history

**Files**
- `apps/web/src/features/groups/settlements-history/settlements-history-container.tsx` (new).
- `apps/web/src/features/groups/settlements-history/settlements-list.tsx`, `settlement-row.tsx`,
  `settlements-empty-state.tsx` (new).
- `apps/web/test/settlements-history.test.tsx` (new).
- `apps/web/messages/es.json`, `en.json` (modified) — `groups.settlements`.

**Logic**
The container loads `getGroup` and the first page (limit 50) in 2 requests (D4, D10). Each row shows payer
and payee names, the amount with `formatMoney` in the settlement currency, the date with `formatDateTime`
in the user's time zone and a "consolidated" marker when the settlement has a rate (a consolidated one; its
amount is the cash that changed hands). "Load more" follows `nextCursor`, appends and removes duplicates by
id (AC-19). An empty history shows an empty state with a link to the balances page. Rows are read-only:
editing and deleting belong to 05h.

**Input validation**
- The cursor comes only from the previous response, never from user text.

**Error handling**
- A load failure shows the shared error state with a retry; a failed "load more" keeps the loaded rows and
  offers a retry; a 404 shows the not-found state with a link back.

**Required tests**
- [ ] The history lists newest first with parties, amount, date and the consolidated marker — validates AC-18.
- [ ] "Load more" appends the next page without repeating any settlement and disappears when `nextCursor` is
  null — validates AC-19.
- [ ] A page that repeats an id already shown does not duplicate the row — validates AC-19.
- [ ] A former member in a settlement is named from `formerMembers` — validates AC-18.
- [ ] An empty history shows the empty state and the link to balances — validates AC-18.
- [ ] A failed "load more" keeps the rows and shows an error with a retry — error handling.
- [ ] A load error shows the retry; a 404 shows the not-found state — validates AC-23.
- [ ] The first load makes exactly 2 requests — validates NFR-02.
- [ ] Spanish and English strings render for the list — validates AC-22.

**Completion criterion**
Tests pass and the catalog parity test passes.

## Block 7 — Group detail link and own balance

**Files**
- `apps/web/src/features/groups/containers/group-detail-container.tsx` (modified) — a link to the balances
  page beside the categories link, and an own-balance summary.
- `apps/web/src/features/groups/components/own-balance-summary.tsx` (new) — presentational.
- `apps/web/test/group-detail.test.tsx` (modified) — new cases.
- `apps/web/messages/es.json`, `en.json` (modified) — `groups.detail.balancesLink`, `groups.detail.ownBalance`.

**Logic**
The detail already loads `getGroup`. It now also requests `getGroupBalances` (2 requests, within the 05e
budget) and shows the caller's balance per currency using `selfMemberId` (D3) and the Block 2 view. The link
(FR-11) is always shown. If the balances request fails, the rest of the detail still renders and the summary
shows a short inline unavailable message, because balances are secondary information here.

**Error handling**
- A balances failure never blocks the detail; a 404 follows the existing not-found handling of the group
  request.

**Required tests**
- [ ] The detail shows a link to the balances page of the group — validates AC-20.
- [ ] The detail shows the user's own balance in ARS and in USD, marked owing or owed — validates AC-21.
- [ ] A failed balances request leaves the members and actions visible, with an error message — error handling.
- [ ] The detail still loads with at most 2 requests — validates NFR-02.
- [ ] Spanish and English strings render for the link and the summary — validates AC-22.

**Completion criterion**
The existing detail tests and the new ones pass.

## Block 8 — Pages, catalogs and end-to-end checks

**Files**
- `apps/web/src/app/[locale]/(app)/groups/[id]/balances/page.tsx`, `settlements/page.tsx`,
  `settlements/consolidate/page.tsx` (new) — thin server pages that render the containers, as the
  categories page does.
- `apps/web/e2e/group-settlements.spec.ts` (new), `apps/web/e2e/support/group-settlements.ts` (new) — the
  helpers seed debts through the group expense API of the signed-in context.
- `apps/web/test/group-settlements-no-float.test.ts` (new) — scans the new folders for `parseFloat`,
  `toFixed`, `Number(` and `Math.round` applied to money, and for float arithmetic on amounts.

**Logic**
One Playwright spec with two users: they create and join a group, seed an ARS debt and a USD debt, read the
balances, record a suggested payment (with and without an own account), consolidate with the prefilled rate,
and read the history. A second test opens the balances page, the form open, the consolidation page and the
history at 360 px and asserts there is no horizontal scroll (NFR-01). A third test counts the requests the
balances page makes on load. The no-literal scan of `groups-no-hardcoded-strings.test.ts` already covers
`src/features/groups`, so the new folders are scanned without a new file. The parity test of
`i18n-catalogs.test.ts` covers NFR-03.

**Input validation**
- A route id that is not a UUID reaches the API, which answers 400; the screen shows the shared error with a
  retry and no data, as the group detail does (`resourcePath` only refuses empty and dot segments).

**Error handling**
- The spec resets attempt limits before each test, as the existing specs do.

**Required tests**
- [ ] Two users record a suggested payment and the balances update for both — validates AC-02, AC-06, AC-07.
- [ ] A recorded payment with an own account shows in the history and the account is sent — validates AC-10,
  AC-18.
- [ ] A consolidation with the prefilled rate and one with a manual rate end with both pair balances at 0 —
  validates AC-12, AC-14, AC-16.
- [ ] A balance that moves between preview and record shows the stale message and a refreshed preview in the
  browser — validates AC-17.
- [ ] The history pages with "load more" and repeats nothing — validates AC-19.
- [ ] The balances, form, consolidation and history fit 360 px without horizontal scroll — validates NFR-01.
- [ ] The balances page makes at most 2 API requests on load — validates NFR-02.
- [ ] The Spanish and English catalogs have the same keys, none empty, and the screens render in both —
  validates NFR-03, AC-22.
- [ ] No money value goes through a float in the new folders — validates NFR-04.
- [ ] A user who is not in the group gets the not-found state on the balances page — validates AC-23.
- [ ] The group detail shows the balances link and the own balance — validates AC-20, AC-21.
- [ ] A member rejected by the server (left the group meanwhile) shows its message in the browser — invalid
  input.

**Completion criterion**
The spec and the scans pass, and the full web suite and the coverage thresholds pass.

## Final verification
- Every AC (AC-01 to AC-23) and NFR (NFR-01 to NFR-04) has a test; every input has a sad-path test.
- `pnpm typecheck`, eslint and Prettier on touched files pass; the full web suite and coverage pass.
- The design-system scan and accessibility tests pass for the new screens (labels, focus on the first
  invalid field, tokens only, owes/owed carried by text).
- Owner ratification items: (1) 05g reads `selfMemberId` from the group detail introduced by 05f, so it
  starts after 05f is merged; (2) the single settlement form is an in-page panel, not a route (D2);
  (3) the success confirmation of a consolidation loads one extra preview to prove both legs at 0 (D9);
  (4) the group detail adds a second request for the own balance (D4, Block 7).

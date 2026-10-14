# Spec FEAT-012: Balance adjustments instead of editing the opening balance

| Field | Value |
|-------|-------|
| Ticket | FEAT-012 |
| PRD | docs/ddw/prd/prd-FEAT-012.md |
| Tier | FEATURE |
| Date | 2026-10-13 |
| Spec loops | 1 |
| Loops since last human decision | 0 |

## Summary

An adjustment is stored as a new `adjustment` value of the existing `movements.type`, with a signed
amount, no category, no rate and no destination. Reusing the table keeps the movements list, the
delete route, pagination and the owner scoping working unchanged. Three readers assume "not income
means expense" and must learn the new type (account balance sums, the account-flow reader for net
worth, the shared amount schema); the report, budget and group readers already filter on explicit
types and only get regression tests. A new use case `SetAccountBalance` locks the account row, computes
`target − current` inside one transaction and inserts the adjustment through a port owned by the
movements module. The opening-balance edit (route, use case, repository method, web form, messages)
is removed. The web gets a "Set balance" dialog on the account row and an "Adjustment" row in the
movements list with a switch to hide it.

## Coverage: PRD → blocks

| Requirement | Covered by |
|---|---|
| FR-01 | Block 1, Block 4, Block 7 |
| FR-02 | Block 1, Block 2, Block 3 |
| FR-03 | Block 3 |
| FR-04 | Block 3 |
| FR-05 | Block 3 |
| FR-06 | Block 1, Block 3, Block 8 |
| FR-07 | Block 6, Block 8 |
| FR-08 | Block 6 |
| FR-09 | Block 5, Block 7 |
| FR-10 | Block 7 |
| FR-11 | Block 4, Block 7 |
| FR-12 | Block 1, Block 4 |
| FR-13 | Block 2 |
| FR-14 | Block 1, Block 4, Block 7 |
| NFR-01 | Block 4 (perf test in `pnpm test:perf`) |
| NFR-02 | Block 4 (row lock inside one transaction; 20-concurrent-request test) |
| NFR-03 | Block 1, Block 4 (bigint end to end) |
| NFR-04 | Block 4, Block 6 (owner-scoped queries, 404) |
| NFR-05 | Block 7, Block 8 (catalog parity test, keyboard test) |
| NFR-06 | Block 7 (action disabled offline; no queue entry) |

## Dependencies between blocks

Block 1 → Block 2 → Block 3 → Block 4 → Block 5 and Block 6 (independent of each other) → Block 7 →
Block 8. Block 7 needs the API of Blocks 4 and 5; Block 8 needs Blocks 1 and 3.

## Block 1 — Shared contract

**Files**
- `packages/shared/src/movements/movement.ts` (modified) — add `'adjustment'` to `MOVEMENT_TYPES`;
  add `CREATABLE_MOVEMENT_TYPES` (the four existing types) and use it for creation schemas; add
  `signedMovementAmountSchema` (non-zero integer string, absolute value ≤ 10^15) and use it for the
  response `amount`.
- `packages/shared/src/movements/movement-filters.ts` (modified) — add the boolean query param
  `hideAdjustments`.
- `packages/shared/src/accounts/account.ts` (modified) — remove `setOpeningBalanceRequestSchema`; add
  `setAccountBalanceRequestSchema` (`{ balance, note?, secondFactorCode? }`, `balance` reuses
  `openingBalanceSchema`, `note` reuses `movementNoteSchema`, `secondFactorCode` reuses
  `secondFactorCodeSchema`) and `setAccountBalanceResponseSchema`.
- `packages/shared/test/` (modified) — contract tests.

**Logic**
Pure schemas. `POST /movements` and the create form keep accepting only `CREATABLE_MOVEMENT_TYPES`.

**API contract**
- Method + path: `POST /accounts/:id/balance`
- Request: `{ balance: string /* integer minor units, signed */, note?: string, secondFactorCode?: string }`
- Response 200: `{ account: AccountResponse, adjustment: MovementResponse | null }`; `adjustment` is
  `null` when the target equals the current balance.
- Error codes: 400 validation, 404 not found or not the user's, 409 account archived, 422 credit
  card account, `TOTP_INVALID` for a missing, wrong or used second-factor code, 429 when the
  attempt limits are exhausted.
- Auth: the existing authenticated write scope.

**Input validation**
- `balance`: integer string, same sign rules and bounds as `openingBalanceSchema`.
- `note`: trimmed, at most 500 code points, no control or format characters.
- `secondFactorCode`: the existing `secondFactorCodeSchema` (a 6-digit TOTP code or a recovery code).
- `hideAdjustments`: `"true"` or `"false"`.

**Error handling**
- A non-integer, out-of-range or malformed `balance` fails schema parsing with 400 and a field error.

**Required tests**
- [ ] `signedMovementAmountSchema` accepts `"-500"` and `"500"`, rejects `"0"`, `"1.5"`, `"1e3"` — AC-12
- [ ] `setAccountBalanceRequestSchema` rejects a value above the limit and a non-integer — AC-12
- [ ] `setAccountBalanceRequestSchema` rejects a malformed `secondFactorCode` and accepts a TOTP or recovery code — AC-20
- [ ] Creation schemas reject `type: 'adjustment'` — AC-08
- [ ] `hideAdjustments` parses `true`/`false` and rejects other text — AC-06

**Completion criterion**
`pnpm --filter ./packages/shared test` passes and `pnpm typecheck` shows no errors in packages that
consume `MOVEMENT_TYPES`.

## Block 2 — Migration 0040

**Files**
- `apps/api/src/movements/infrastructure/db/schema.ts` (modified) — type enum, amount check, shape
  check.
- `apps/api/drizzle/0040_balance_adjustments.sql` (new) — the migration.
- `apps/api/drizzle/rollback/0040_balance_adjustments.down.sql` (new) — the rollback.
- `apps/api/drizzle/meta/0040_snapshot.json` and `apps/api/drizzle/meta/_journal.json` (modified).
- `apps/api/test/movements/adjustment-migration.test.ts` (new) — modeled on
  `apps/api/test/budgets/migration.test.ts`.

**Data model**
- `movements_type_check` recreated to allow `adjustment`.
- `movements_amount_range_check` becomes: `adjustment` → `amount <> 0 and abs(amount) <= 10^15`;
  other types → `amount between 1 and 10^15`.
- `movements_shape_check` gets a fourth branch: `adjustment` → category, rate, rate source, rate
  type, destination account and destination amount are all null.
- Entity `movements`, `type` text not null, `amount` bigint not null, `category_id` uuid nullable,
  `rate`/`rate_source`/`rate_type` nullable, `destination_account_id` uuid nullable,
  `destination_amount` bigint nullable; no unique constraint and no index is added (the list keeps
  using `movements_owner_date_idx`).
- No column added, no data touched. The journal `when` is greater than `1791830000000` and than
  `origin/main`'s maximum at merge time (see the Drizzle merge rule).

**Error handling**
- The rollback fails loudly if an `adjustment` row exists, so a rollback cannot silently delete
  balance history; the operator exports or removes them first.

**Required tests**
- [ ] Applying the migration to a database with existing accounts and movements keeps every row and
      every computed balance — validates AC-13
- [ ] An `adjustment` with a category, a rate or a destination is a sad path: the shape check will reject it
- [ ] An `adjustment` with amount `0` is rejected; `-1` and `1` are accepted
- [ ] A non-adjustment with a negative amount is still rejected
- [ ] Rollback with an `adjustment` row present raises an error and deletes nothing; with none it succeeds

**Completion criterion**
The migration test passes against a fresh database and the rollback test restores the previous
constraints when no adjustment exists.

## Block 3 — Domain and read paths

**Files**
- `apps/api/src/movements/domain/movement.ts` (modified) — `Adjustment` variant in the union.
- `apps/api/src/movements/infrastructure/db/drizzle-movement-repository.ts` (modified) — `toMovement`
  and the writer handle `adjustment`.
- `apps/api/src/movements/infrastructure/http/movement-presenter.ts` and `movement-routes.ts`
  (modified) — present an adjustment; `hideAdjustments` filter.
- `apps/api/src/movements/infrastructure/db/drizzle-movement-filters.ts` (modified) — clause for
  `hideAdjustments`.
- `apps/api/src/movements/infrastructure/accounts/drizzle-account-movements.ts` (modified) —
  `when 'adjustment' then amount` in the balance sum.
- `apps/api/src/reports/infrastructure/db/drizzle-account-flow-reader.ts` (modified) — an
  adjustment leg with its own sign.
- `apps/api/src/dashboard/infrastructure/db/drizzle-first-steps-reader.ts` (modified) — an adjustment
  does not count as a first movement.

**Logic**
Balance = opening + Σ(income) − Σ(expense) + Σ(adjustment, signed) + transfers and exchanges as
today. Net worth takes the adjustment from the month of its `occurred_at`; USD accounts are
converted with the rate that month's point already uses. `personalConditions` (`type in
('expense','income')`) is left as is, so reports, budgets, alerts and the group readers ignore
adjustments.

**Error handling**
- A row with an unknown type in `toMovement` keeps throwing; the new case removes the throw for
  `adjustment`.

**Required tests**
- [ ] Account balance includes a positive and a negative adjustment — validates AC-03
- [ ] The account-flow reader puts an adjustment in its own month and leaves earlier months equal —
      validates AC-04
- [ ] Income vs expense report, expenses by category, a budget's spending and a group balance return
      the same figures with and without an adjustment — validates AC-05
- [ ] The movements list returns the adjustment with type `adjustment`; `hideAdjustments=true` omits
      it — validates AC-06
- [ ] The first-steps probe ignores an adjustment
- [ ] Mapping a row with an unknown type raises an error, while `adjustment` maps to its variant

**Completion criterion**
Every reader listed above has a test with an adjustment, `pnpm --filter ./apps/api test` passes for
the movements, accounts, reports, budgets, dashboard and groups folders.

## Block 4 — Set balance use case

**Files**
- `apps/api/src/accounts/application/set-account-balance.ts` (new) — use case.
- `apps/api/src/accounts/application/ports/` (modified) — `BalanceAdjuster` and `SecondFactorGate`
  ports.
- `apps/api/src/identity/application/require-second-factor.ts` (new) — checks the code when 2FA is
  on, reusing the limits and code check of disabling 2FA.
- `apps/api/src/identity/application/delete-user.ts` (modified) — calls the shared check instead of
  its private copy.
- `apps/api/src/movements/infrastructure/accounts/drizzle-balance-adjuster.ts` (new) — transaction
  implementing the port.
- `apps/api/src/accounts/infrastructure/http/account-routes.ts` (modified) — `POST
  /accounts/:id/balance` with `validate`, `scopeOf(..., 'write')` and `audit('account balance
  adjusted', requestId, auth, account.id)` (ids only, no amounts).
- `apps/api/src/accounts/index.ts` (modified) — wiring.
- `apps/api/test/accounts/` (new and modified) — unit, repository and route tests, plus fakes.
- `apps/api/test/perf/` (modified) — latency benchmark.

**Logic**
Before anything is written the use case asks the `SecondFactorGate` (adapter: identity's
`RequireSecondFactor`): with 2FA off it returns at once; with 2FA on it reserves attempts with
`TWO_FACTOR_DISABLE_POLICIES`, checks and spends the code, records a wrong code against the sign-in
limit, and throws `TotpInvalid` or `RateLimited`. The code is spent before the transaction, as in
account deletion, so a request that then fails on a guard has burned one code. The adjuster opens a
transaction, runs `select ... from accounts where id = $1 and owner_id = $2 for
update`, answers `not_found`, `archived` or `credit_card` when applicable, then computes the current
balance (opening + movement sums, the same query as the balance read) **after** the lock, and
inserts an adjustment of `target − current` dated now. A zero difference inserts nothing and returns
`adjustment: null`. The accounts module depends on the port only, never on movements internals.

**API contract**
- Method + path: `POST /accounts/:id/balance`
- Request: params `id` uuid; body `{ balance: string, note?: string }`
- Response 200: `{ account: AccountResponse, adjustment: MovementResponse | null }`
- Error codes: 400, 404, 409, 422
- Auth: authenticated user with write scope; the account must belong to the user

**Data model**
- Entity `movements` (no schema change): inserted row has `type` = `adjustment` not null, `amount`
  bigint signed non-zero, `account_id` uuid FK not null, `owner_id` uuid FK not null, `occurred_at`
  timestamptz = now, `note` text nullable; category, rate, rate source, rate type, destination
  account and destination amount are null. No unique constraint; the existing indexes serve it.

**Input validation**
- `id` uuid; `balance`, `note` and `secondFactorCode` as in Block 1.

**Error handling**
- Account missing or not the user's — `ResourceNotFound`, 404.
- Account archived — `AccountArchived`, 409.
- Credit card account — 422, the same error family the accounts module already uses for card
  restrictions.
- 2FA on and the code missing, wrong or already used — `TotpInvalid`, nothing recorded.
- Attempt limits exhausted — `RateLimited` (429), the code is not checked.
- Concurrent requests — serialized by the row lock; each computes its difference from the balance
  left by the previous one.

**Required tests**
- [ ] Target above and below the current balance records `target − current` — validates AC-01
- [ ] The stored row has the account currency, no category, tags or rate, and the note — validates
      AC-02
- [ ] Target equal to current records nothing and returns `adjustment: null` — validates AC-11
- [ ] A negative target within limits is accepted — validates AC-12
- [ ] A target out of range or not an integer returns 400 and records nothing — validates AC-12
- [ ] An archived account returns 409 and records nothing — validates AC-14
- [ ] With 2FA on, a valid TOTP code records the adjustment and with 2FA off no code is asked — validates AC-19
- [ ] With 2FA on, a missing, wrong or already used code is rejected with `TOTP_INVALID`, records nothing and a wrong code counts against the limits — validates AC-20
- [ ] When the attempt limits are exhausted the request fails with 429 and the code is not checked — validates AC-20
- [ ] `DeleteUser` keeps its second-factor behavior after the extraction (existing tests stay green)
- [ ] 20 concurrent requests end with the balance equal to the last target applied and no lost
      update — validates AC-15
- [ ] An account of another user returns 404 and records nothing — validates AC-16
- [ ] A credit card account returns 422
- [ ] Benchmark: p95 ≤ 500 ms on 10,000 movements — validates AC-17

**Completion criterion**
`pnpm --filter ./apps/api test` and `pnpm test:perf` pass for the new files, and the route answers
200 with the account and the adjustment for a valid request.

## Block 5 — Remove the opening-balance edit (API)

**Files**
- `apps/api/src/accounts/application/set-opening-balance.ts` (deleted).
- `apps/api/src/accounts/infrastructure/http/account-routes.ts` (modified) — remove `PATCH
  /accounts/:id/opening-balance`.
- `apps/api/src/accounts/application/ports/account-repository.ts` and
  `.../drizzle-account-repository.ts` (modified) — remove `setOpeningBalance`.
- `apps/api/test/accounts/` (modified) — remove the tests of the removed pieces.

**API contract**
- Method + path: `PATCH /accounts/:id/opening-balance` is removed
- Request: any; Response: 404 with the standard error body
- Error codes: 404
- Auth: not applicable, the route no longer exists

**Logic**
The opening balance stays a creation field (`POST /accounts`) and a read-only response field.

**Error handling**
- A call to the removed route reaches no handler and answers 404 through the router's default.

**Required tests**
- [ ] `PATCH /accounts/:id/opening-balance` answers 404 — validates AC-09
- [ ] `POST /accounts` still stores `openingBalance` — validates AC-09

**Completion criterion**
No reference to `setOpeningBalance` or `SetOpeningBalance` remains in `apps/api/src`; the accounts
tests pass.

## Block 6 — Movements edit and create guards

**Files**
- `apps/api/src/movements/application/update-movement.ts` (modified) — reject an adjustment.
- `apps/api/src/movements/application/create-movement.ts` (modified) — no adjustment creation.
- `apps/api/test/movements/` (modified).

**API contract**
- Method + path: `PUT /movements/:id`, `POST /movements`, `DELETE /movements/:id`
- Request: unchanged; `POST` body `type` is one of `CREATABLE_MOVEMENT_TYPES`
- Response: `PUT` on an adjustment 409; `POST` with `adjustment` 400; `DELETE` 204
- Error codes: 400, 404, 409
- Auth: authenticated user with write scope; the movement must belong to the user

**Data model**
- Entity `movements` (unchanged): an adjustment row is immutable after insert (no update path) and
  is removed only by delete; no new constraint or index.

**Logic**
`PUT /movements/:id` on an adjustment fails with the existing `MovementTypeImmutable` error (409) and
changes nothing; `DELETE /movements/:id` works as for any movement and removes the adjustment.
`POST /movements` rejects `type: 'adjustment'` through the creation schema.

**Error handling**
- Edit attempt on an adjustment — 409, row unchanged.
- Delete of a movement that is not the user's — 404, as today.

**Required tests**
- [ ] `PUT` on an adjustment answers 409 and leaves the row unchanged — validates AC-08
- [ ] `POST /movements` with `type: 'adjustment'` answers 400 — validates AC-08
- [ ] Deleting an adjustment restores the balance and the net worth to the values without it —
      validates AC-07
- [ ] Deleting another user's adjustment answers 404 — validates AC-16

**Completion criterion**
The movements route and use-case tests pass, including the three new ones.

## Block 7 — Web accounts

**Files**
- `apps/web/src/features/accounts/components/set-balance-dialog.tsx` (new) — presentational dialog.
- `apps/web/src/features/accounts/containers/accounts-container.tsx` (modified) — open, submit,
  results, offline state.
- `apps/web/src/features/accounts/components/account-row.tsx` (modified) — "Set balance" action,
  read-only opening balance; remove `OpeningBalanceForm` and its props.
- `apps/web/src/features/accounts/set-balance-request.ts` (new) and
  `opening-balance-request.ts` (deleted).
- `apps/web/src/lib/api-client.ts` (modified) — `setAccountBalance` (sends `secondFactorCode` when
  given); remove the opening-balance call.
- `apps/web/messages/es.json` and `en.json` (modified) — add `accounts.setBalance.*`; remove
  `accounts.actions.editOpeningBalance` and `accounts.openingEdit.*`.
- `apps/web/test/` and `apps/web/e2e/accounts.spec.ts` (modified).

**API contract**
- Method + path: consumes `GET /auth/2fa` (unchanged) and `POST /accounts/:id/balance` (Block 4)
- Request: no body for the status call; the balance call as in Block 1
- Response: `{ enabled: boolean, recoveryCodesRemaining: number }` for the status call
- Error codes: as in Block 4
- Auth: the web session cookie

**Logic**
The dialog shows the current balance, a money input for the target and the resulting difference with
its sign (computed with the shared money helpers). Confirm is disabled when the target is empty or
invalid, and offline it is disabled with a message that the action needs a connection; nothing enters
the offline queue. When `GET /auth/2fa` says 2FA is on, the dialog shows a second-factor code field and confirm needs it; with 2FA off no field is shown. A zero difference shows "No difference" and sends no request. Focus lands on the
target field on open and returns to the row action on close.

**Input validation**
- The same limits as the shared schema; invalid input shows the existing `amountInvalid` and
  `amountOutOfRange` messages.

**Error handling**
- `TOTP_INVALID` — the code field shows the existing invalid-code message and the dialog stays open; 429 — the existing too-many-attempts message;
- 409 archived — message that the account is archived; 404 — the list refreshes; network failure —
  inline error, no state change.

**Required tests**
- [ ] The dialog shows the current balance and the signed difference before confirming — validates
      AC-10
- [ ] Equal target shows "no difference" and does not call the API — validates AC-11
- [ ] Invalid and out-of-range targets show the field error — validates AC-12
- [ ] The opening balance is read-only on an existing account — validates AC-09
- [ ] With 2FA on the dialog asks for the code and sends it; with 2FA off it shows no code field — validates AC-19
- [ ] A wrong code shows the invalid-code message and keeps the dialog open — validates AC-20
- [ ] Offline, the action is disabled with the explanation and no queue entry is made — validates
      AC-18
- [ ] The dialog is operable by keyboard; every control has an accessible name — validates NFR-05
- [ ] The catalog test confirms the Spanish and English key sets match

**Completion criterion**
`pnpm --filter ./apps/web test`, `pnpm lint` and `pnpm typecheck` pass, and the e2e accounts flow
sets a balance and sees the new balance.

## Block 8 — Web movements, docs and changelog

**Files**
- `apps/web/src/features/movements/components/movement-row.tsx` and `movement-avatar.tsx`
  (modified) — "Adjustment" label, signed amount, no edit link, delete kept.
- `apps/web/src/features/movements/components/movement-filters.tsx` (modified) — "Hide adjustments"
  control bound to `hideAdjustments`.
- `apps/web/src/features/movements/components/type-pills.tsx`, `initial-type.ts` and
  `movement-request.ts` (modified) — use `CREATABLE_MOVEMENT_TYPES`.
- Delete confirmation for an adjustment states that later balances change.
- `apps/web/messages/es.json` and `en.json` (modified).
- `CHANGELOG` and the PRD status tables (modified).

**Input validation**
- `hideAdjustments` is sent only as `true` or `false`; any other value is dropped by the filter state
  before the request.

**Logic**
An adjustment row never links to the edit screen. The create form never lists "Adjustment".

**Error handling**
- The delete failure path reuses the existing movement delete error handling.

**Required tests**
- [ ] The row renders the "Adjustment" label and the signed amount — validates AC-06
- [ ] The hide control omits adjustments from the list — validates AC-06
- [ ] The row has no edit link, and deleting it asks for confirmation naming the effect — validates
      AC-07, AC-08
- [ ] The create form offers only the four creatable types
- [ ] A failed delete of an adjustment shows the existing movement delete error and keeps the row
- [ ] The catalog test confirms key parity

**Completion criterion**
The web tests, lint and typecheck pass and the movements e2e flow shows, hides and deletes an
adjustment.

## Final verification

- Every FR, NFR and AC of the PRD maps to a test named above.
- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:coverage` (80% floor), `pnpm test:perf`
  and the Playwright accounts and movements flows pass.
- The migration's journal `when` exceeds `origin/main`'s maximum at merge time.
- No reference to the opening-balance edit remains in code, catalogs or tests.

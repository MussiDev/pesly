# Spec FEAT-006: Edit an account's opening balance

| Field | Value |
|-------|-------|
| Ticket | FEAT-006 |
| PRD | docs/ddw/prd/prd-FEAT-006.md |
| Tier | FEATURE |
| Date | 2026-10-09 |
| Spec loops | 0 |
| Loops since last human decision | 0 |

## Summary

A new use case `SetOpeningBalance` and a new route `PATCH /accounts/:id/opening-balance` change one
column, `accounts.opening_balance`, through the existing scoped repository. The balance stays
derived (opening balance plus the movement sum read through the existing `AccountMovements` port),
so the response is built exactly like rename's. The web app adds an "Edit opening balance" row
action with a small form that reuses `MoneyInput`, `parseAmountInput` and `openingBalanceSchema`
from account creation. No migration and no new dependency: the column exists, every package used
is already installed (NFR-03).

Rules found by reading the module (PRD FR-05): `RenameAccount` and the repository's `rename` apply
no archived rule and no credit-card-link rule; `AccountLinks.isLinked` is consulted only by
`DeleteAccount`. The new use case therefore follows rename: archived accounts and card-linked
accounts are allowed, and no error is added for either. The accounts routes have no per-route rate
limiter (only identity routes use one); the new route follows the same conventions as rename and
archive: `requireSession`, `requireVerifiedEmail`, the shared `validate` middleware and the central
error handler, with no new limiter.

Audit: the repository logging convention is ids only, never a name or an amount
(`audit()` in `account-routes.ts`). The new line carries `requestId`, `userId` and `accountId`, so
the old and new values are not logged (FR-06, NFR-04).

## Coverage: PRD → blocks

| Requirement | Covered by |
|---|---|
| FR-01 | Block 1 (schema), Block 2 (route) |
| FR-02 | Block 1 (use case), Block 2 (route) |
| FR-03 | Block 1 (the repository updates one column) |
| FR-04 | Block 1 (scoped update), Block 2 (route) |
| FR-05 | Block 1 (no rule added), Block 2 |
| FR-06 | Block 2 |
| FR-07 | Block 4 |
| FR-08 | Block 4 |
| FR-09 | Block 3 (request builder), Block 4 |
| FR-10 | Block 3 (client error mapping), Block 4 |
| FR-11 | Block 3 (catalogs), Block 4 |
| NFR-01 | Strategy: one `UPDATE ... WHERE id = $1 AND owner scope RETURNING` statement in the repository, no read-then-write; a missing or foreign row matches 0 rows and nothing else runs |
| NFR-02 | Strategy: the body is a decimal string validated by `openingBalanceSchema` (bigint bounds), converted with `BigInt`; the web form goes through `parseAmountInput` and `formatMinorUnitsString`; the existing `no-float-money` tests scan the new files |
| NFR-03 | Strategy: no `package.json` and no `drizzle/` change; verified with `git diff --stat` at VERIFY |
| NFR-04 | Strategy: the audit line is built from ids only and a route test asserts the log contains neither the amount nor the name |
| NFR-05 | Strategy: the action uses `IconAction` and the form uses `Button size="sm"` exactly like rename, which already meet 44 by 44 CSS pixels |
| NFR-06 | Strategy: every block ships its tests; the full suite with coverage runs at the end of CODE |

## Dependencies between blocks

Block 1 goes first (schema and repository). Block 2 depends on Block 1 (route calls the use case
and uses the schema). Block 3 depends on Block 1 (the web client imports the shared schema type).
Block 4 depends on Block 3 (the container calls the client and the request builder, the row uses
the catalog strings). Blocks 2 and 3 are independent of each other.

## Block 1 — Shared schema, use case and repository

**Files**
- `packages/shared/src/accounts/account.ts` (modified) — adds `setOpeningBalanceRequestSchema` and its type.
- `apps/api/src/accounts/application/ports/account-repository.ts` (modified) — adds `setOpeningBalance`.
- `apps/api/src/accounts/application/set-opening-balance.ts` (new) — the use case.
- `apps/api/src/accounts/infrastructure/db/drizzle-account-repository.ts` (modified) — the update.
- `apps/api/src/accounts/index.ts` (modified) — exports the use case.
- `apps/api/test/accounts/fakes.ts` (modified) — the in-memory `setOpeningBalance`.
- `apps/api/test/shared/account-contracts.test.ts`, `apps/api/test/accounts/account-use-cases.test.ts`, `apps/api/test/accounts/account-repository.test.ts` (modified) — the tests.

**Logic**

`setOpeningBalanceRequestSchema = z.object({ openingBalance: openingBalanceSchema })`: required, no
default, unknown keys stripped. `AccountRepository.setOpeningBalance(scope, id, openingBalance)`
returns the updated `Account` or `null` when nothing in scope matches. The Drizzle implementation
is one `update accounts set opening_balance = $v, updated_at = now() where id = $id and <owner
scope> returning <columns>`, using the existing `scopedRow` helper, so a foreign or missing row
matches 0 rows (NFR-01). `SetOpeningBalance.execute(scope: AccessScope<'write'>, id, openingBalance:
bigint)` calls the repository, maps `null` to `ResourceNotFound` through `notFoundUnlessAllowed`
and returns `withSingleBalance(movements, account)`, like `RenameAccount`. It adds no archived and
no card-link check (FR-05). Writing the same value is a normal update that returns the account.

**Data model**
- No schema change. Column `accounts.opening_balance` is `bigint`, not null, existing; the value is
  already bounded by the request schema, and the column has no default that this change touches.
  `updated_at` is set with `now()`. Rollback: reverting the commit is enough, because there is no migration; values already corrected stay valid under the same bounds.

**Input validation**
- The schema accepts only a minor-units integer string with an absolute value of at most 10^15; the
  use case receives a `bigint` that already passed it at the route.

**Error handling**
- A missing account or an account of another user: the repository returns `null`, the use case
  raises `ResourceNotFound` (404 at the route), and nothing is written.
- A value the schema refuses never reaches the use case: the schema test shows the rejection.

**Required tests**
- [ ] schema accepts `"0"`, `"-1500"`, `"1000000000000000"` and `"-1000000000000000"` — validates AC-04 and NFR-02
- [ ] sad path: schema rejects a missing field, `"1.5"`, `"abc"`, the number `100`, `"1000000000000001"` and `"-1000000000000001"` — validates AC-02 and NFR-02
- [ ] use case returns the account with the new opening balance and `balance` equal to the new opening balance plus the movement sum (movements fake with a sum) — validates AC-05
- [ ] use case with the same value returns the unchanged account — validates AC-06
- [ ] repository against PostgreSQL changes only `opening_balance` and `updated_at`, and the account's movements rows (read before and after with the movements fixtures) are identical — validates AC-07 and NFR-01
- [ ] sad path: use case and repository on a missing id and on another user's account raise 404 `ResourceNotFound` (`null` from the repository) and leave the other user's row unchanged — validates AC-08 and AC-09
- [ ] use case on an archived account and on a credit card account (and one reported as linked by the links fake) succeeds and keeps the account archived — validates AC-11 and AC-12

**Completion criterion**
All Block 1 tests pass and `pnpm typecheck` is clean for `packages/shared` and `apps/api`.

## Block 2 — Route and audit line

**Files**
- `apps/api/src/accounts/infrastructure/http/account-routes.ts` (modified) — the new route.
- `apps/api/test/accounts/account-routes.test.ts` (modified) — route tests.

**Logic**

`router.patch('/accounts/:id/opening-balance', validate({ params: accountIdParamsSchema, body:
setOpeningBalanceRequestSchema, response: accountResponseSchema }, handler))`. The handler builds a
write scope, calls `setOpeningBalance.execute(scope, params.id, BigInt(body.openingBalance))`, calls
`audit('account opening balance changed', requestId, auth, account.id)` and answers
`presentAccount(account)` with status 200. `requireSession` and `requireVerifiedEmail` already
cover `/accounts`. The path does not collide with `PATCH /accounts/:id` (rename) because Express
matches the full path. The line is composed from `requestId`, `userId` and `accountId` only.

**API contract**
- `PATCH /accounts/:id/opening-balance` — Params: `id` UUID. Request body: `{ openingBalance: string }` (minor-units integer string, absolute value at most 10^15). Response 200: `AccountResponse` with the new `openingBalance` and the recomputed `balance`. Errors: 400 `VALIDATION_FAILED` (bad id, missing or malformed or out-of-range amount, with `fields`), 401 `UNAUTHENTICATED`, 403 `EMAIL_NOT_VERIFIED`, 404 `NOT_FOUND` (missing or foreign account). Auth: session cookie plus verified email, plus the existing origin guard for state-changing methods.

**Input validation**
- Params and body go through the shared `validate` middleware with the shared schemas; the handler never reads `req.body`.

**Error handling**
- Invalid body or id answers 400 `VALIDATION_FAILED` before the use case runs; nothing is written.
- A missing or foreign account answers 404 `NOT_FOUND`, the same body for both.
- No session answers 401; an unverified email answers 403 `EMAIL_NOT_VERIFIED`.

**Required tests**
- [ ] owner changes the opening balance and receives 200 with the account carrying it; GET afterwards shows it — validates AC-01
- [ ] sad path: missing field, string `"1.5"`, number instead of string and a value above the limit answer 400 and GET shows the account unchanged — validates AC-02
- [ ] sad path: a non-UUID id answers 400 and writes nothing — validates AC-03
- [ ] zero and negative values are accepted — validates AC-04
- [ ] with movements sums set in the test adapter the response `balance` is the new opening balance plus the sum, and the list totals follow — validates AC-05
- [ ] sending the current value answers 200 unchanged — validates AC-06
- [ ] sad path: an unknown id answers 404 and another user's account answers 404 with the same body and keeps its value — validates AC-08 and AC-09
- [ ] sad path: no session answers 401, an unverified user answers 403 `EMAIL_NOT_VERIFIED`, and a request without the trusted origin headers is refused, all without a write — validates AC-10
- [ ] an archived account and a credit card account (reported as linked by the links adapter) accept the change, and the archived one stays archived — validates AC-11 and AC-12
- [ ] the log line has the message, the request id, the user id and the account id, and does not contain the new amount, the old amount or the account name — validates AC-13 and NFR-04

**Completion criterion**
All route tests pass and the full accounts API test folder passes.

## Block 3 — Web client, request builder and catalogs

**Files**
- `apps/web/src/lib/api-client.ts` (modified) — `setAccountOpeningBalance(id, body)` and its input type.
- `apps/web/src/features/accounts/opening-balance-request.ts` (new) — `buildOpeningBalanceRequest(text, locale)`.
- `apps/web/messages/en.json`, `apps/web/messages/es.json` (modified) — the new strings.
- `apps/web/test/api-client.test.ts`, `apps/web/test/opening-balance-request.test.ts` (modified / new) — the tests.

**Logic**

`setAccountOpeningBalance` is `PATCH {accountPath}/opening-balance` with the JSON body, response
parsed with `accountResponseSchema`, `refreshOnUnauthenticated: true` and the same `onAccount` id
encoding and error mapping as `renameAccount`. `buildOpeningBalanceRequest(text, locale)` trims the
text; empty or unparsable (`parseAmountInput` returns `null`) gives `{ error:
'accounts.errors.amountInvalid' }`; otherwise it formats with `formatMinorUnitsString`, checks
`openingBalanceSchema` and gives `{ error: 'accounts.errors.amountOutOfRange' }` when refused, else
`{ request: { openingBalance } }`. Catalog keys under `accounts`: `actions.editOpeningBalance`,
`openingEdit.current`, `openingEdit.field`, `openingEdit.hint`, `openingEdit.preview`, in Spanish
and English. The existing `accounts.errors.*` messages are reused.

**Input validation**
- The builder is the web input validation: only a string parsed to minor units and accepted by `openingBalanceSchema` becomes a request; the client sends nothing else.

**Error handling**
- The client returns the same typed `ApiResult` failures as rename: `UNAUTHENTICATED`, `VALIDATION_FAILED`, `NOT_FOUND` mapped to the unexpected message key, network and server errors mapped to their message keys.
- An empty or malformed amount returns the invalid-amount message key; an out-of-range amount returns the out-of-range key.

**Required tests**
- [ ] the client sends PATCH to the encoded id path plus `/opening-balance` with the JSON body and returns the parsed account — validates FR-10 and AC-19
- [ ] sad path: the client maps a 404 `NOT_FOUND`, a 401 `UNAUTHENTICATED`, a 400 and a network failure to the same keys rename uses — validates AC-20
- [ ] the builder turns `"1.234,56"` (es) and `"1,234.56"` (en) and `"-10"` into minor-unit strings and returns a request — validates AC-16 and NFR-02
- [ ] sad path: the builder rejects empty, `"abc"` and malformed text with the invalid-amount key — validates AC-17
- [ ] sad path: the builder rejects a value above the limit with the out-of-range key — validates AC-18
- [ ] the existing catalog parity test fails if a new key is missing from either language, and the new keys exist in both — validates AC-22

**Completion criterion**
Block 3 tests pass, the catalog parity test passes and `pnpm typecheck` is clean for `apps/web`.

## Block 4 — Row action, form and container

**Files**
- `apps/web/src/features/accounts/components/account-row.tsx` (modified) — the action button and `OpeningBalanceForm`.
- `apps/web/src/features/accounts/components/account-list.tsx` (modified) — passes the new props.
- `apps/web/src/features/accounts/containers/accounts-container.tsx` (modified) — state and the submit handler.
- `apps/web/test/accounts-components.test.tsx`, `apps/web/test/accounts-containers.test.tsx` (modified) — the tests.
- `apps/web/e2e/accounts.spec.ts` (modified) — an end-to-end flow, written and typechecked only.

**Logic**

The row shows an `IconAction` (label `accounts.actions.editOpeningBalance`, Lucide `Coins`) after
Rename, on every account including archived ones and credit cards. The container owns
`editingOpeningId` and `openingError`; starting any other action clears them (`clearTransient`).
Submitting calls `buildOpeningBalanceRequest(text, locale)`; on `error` it sets `openingError` and
sends nothing; on `request` it sets `pending`, calls the client, then on success replaces the row,
closes the form and bumps the silent reload so the totals are read again; on `UNAUTHENTICATED` it
goes to `/sign-in`; on any other failure the form stays open and the container sets `actionError`
(same as rename for non-field errors). `OpeningBalanceForm` is presentational: it shows the current
value with `formatMoney`, a `MoneyInput` (with `allowNegative`) pre-filled with the current value as
typed text, the hint, the preview computed as `balance - openingBalance + typed` in `bigint`, Save
and Cancel. The preview is hidden while the text does not parse.

**Input validation**
- The form text is parsed by `buildOpeningBalanceRequest` before any request; the preview uses `parseAmountInput` and bigint arithmetic only.

**Error handling**
- Invalid or out-of-range text shows the field message under the input and sends no request.
- An API failure keeps the form open and shows the mapped message in the list alert; an expired session redirects to sign-in.
- Cancel closes the form, clears the field message and sends no request.

**Required tests**
- [ ] the action appears on an active account, an archived account and a credit card account — validates AC-14
- [ ] opening the form shows the current value formatted for the account currency, the pre-filled input and the hint — validates AC-15
- [ ] typing a valid amount shows the preview equal to balance minus opening plus typed, including a negative value — validates AC-16
- [ ] sad path: empty or malformed text shows the invalid-amount message and calls no client function — validates AC-17
- [ ] sad path: text above the limit shows the out-of-range message with the formatted limit and calls no client function — validates AC-18
- [ ] on success the container shows the updated row, closes the form and reloads the totals — validates AC-19
- [ ] sad path: an API error keeps the form open and shows the mapped message, and a 401 goes to the sign-in page — validates AC-20
- [ ] cancel closes the form and sends no request — validates AC-21
- [ ] e2e (typechecked, not run in this ticket): edit the opening balance of an account and see the new balance in the list — validates AC-19

**Completion criterion**
Block 4 tests pass, `pnpm typecheck`, lint and prettier are clean, and the accounts web tests pass.

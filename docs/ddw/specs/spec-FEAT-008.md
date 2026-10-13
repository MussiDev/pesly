# Spec FEAT-008: Link a group expense to the payer's own account

| Field | Value |
|-------|-------|
| Ticket | FEAT-008 |
| PRD | docs/ddw/prd/prd-FEAT-008.md |
| Tier | FEATURE |
| Date | 2026-10-13 |
| Spec loops | 0 |
| Loops since last human decision | 0 |

## Summary

The columns that hold the link already exist (`group_expenses.payer_movement_id` and
`adopted_movement`), and edits and deletes already follow them, so there is no migration. The change
adds one write path to the groups module: a use case `LinkPayerMovement` and a repository method
`linkPayerMovement` that, in one transaction and under the same locks as an expense change, either
records a new movement for the payer (`create`, through the recorder the expense write already uses)
or adopts one of the payer's own (`adopt`, with the checks and the locks of DISC-001-05i), and then
sets the two columns. It writes no activity log row, does not touch the version or the shares, and
notifies nobody. A second use case lists the candidates for `adopt`. Three error codes are added to the
shared catalog. The web app gets a screen with the two ways, reached from an action on the expense row
that only the payer sees, online only, in the pattern of "send to group".

## Coverage: PRD → blocks

| Requirement | Covered by |
|---|---|
| FR-01 | Block 1 (schema), Block 2 (endpoint) |
| FR-02, FR-03, FR-04 | Block 2 |
| FR-05 | Block 2 (the repository method writes only the two columns) |
| FR-06 | Block 2 |
| FR-07, FR-08, FR-09, FR-10 | Block 3 |
| FR-11 | Block 3 (catalogs); Block 1 (error messages) |
| FR-12 | Block 3 |
| NFR-01 | Block 2: one transaction with the locks of an expense change |
| NFR-02 | Block 2: a latency benchmark with 10,000 expenses in the group |
| NFR-03 | Block 3: the action is decided from data the list already holds |
| NFR-04 | Block 2: membership and ownership checks on every read and write |
| NFR-05 | Block 3: a 360 px browser test and keyboard-reachable controls |
| NFR-06 | Strategy: tests of every block, run with coverage on the changed files |

## Dependencies between blocks

Block 2 depends on Block 1 (the schemas, the codes and the status map). Block 3 depends on Blocks 1 and
2. Order: 1, 2, 3.

## Block 1 — Shared contract: schemas and error codes

**Files**
- `packages/shared/src/errors.ts` (modified) — adds `GROUP_PAYER_ONLY`, `GROUP_EXPENSE_ALREADY_LINKED`
  and `GROUP_MOVEMENT_MISMATCH` to the code list.
- `packages/shared/src/groups/expense.ts` (modified) — adds `linkPayerMovementRequestSchema` and
  `movementCandidatesResponseSchema` with their types.
- `apps/api/src/shared/http/error-handler.ts` (modified) — the status of each new code: 403, 409, 400.
- `apps/api/src/groups/domain/group-expense.ts` (modified) — the typed errors `GroupPayerOnly`,
  `GroupExpenseAlreadyLinked` and `GroupMovementMismatch`.
- `apps/web/src/lib/api-client.ts` (modified) — the three message keys and their entries in the
  exhaustive code map.
- `apps/web/messages/en.json` and `apps/web/messages/es.json` (modified) — the three messages under
  `errors`.
- `packages/shared/test/group-link-payer-movement-schemas.test.ts` (new).
- `apps/api/test/groups/error-status.test.ts` (modified) — the three statuses.

**Logic**
`linkPayerMovementRequestSchema` is a `z.discriminatedUnion('mode', ...)` of two `z.strictObject`s:
`{ mode: 'create', accountId: uuid, categoryId: uuid }` and `{ mode: 'adopt', movementId: uuid }`, so
an unknown key or a mixed body is refused. `movementCandidatesResponseSchema` is `{ items: [{ id,
amount, occurredAt, note, accountId, accountName }] }` with the amount as a minor-units string and at
most 20 items. The three new codes are `403` for `GROUP_PAYER_ONLY`, `409` for
`GROUP_EXPENSE_ALREADY_LINKED` and `400` for `GROUP_MOVEMENT_MISMATCH`, in line with
`GROUP_MOVEMENT_NOT_EXPENSE` (400) and `GROUP_MOVEMENT_ALREADY_SENT` (409).

**Input validation**
The body is validated by the schema above: `mode` is one of two literals, the ids are UUIDs, and every
unknown key is refused. The candidate list has no input beyond the ids of the path.

**Error handling**
- An unknown `mode`, a missing field, a field of the other mode or an extra key — the schema refuses it
  and the route answers 400 `VALIDATION_FAILED`.
- A code with no status or no message — the exhaustive maps of the API and of the web client fail to
  typecheck, and the catalog tests fail, so it cannot ship.

**Required tests**
- [ ] The request schema accepts a well formed `create` body and a well formed `adopt` body — validates
      AC-01
- [ ] The request schema rejects an unknown mode, a mixed body and an extra key as invalid — validates
      AC-01
- [ ] The candidates schema accepts at most 20 items and rejects a 21st as invalid — validates AC-18
- [ ] The three codes are in the catalog with the statuses 403, 409 and 400 — validates AC-03, AC-05,
      AC-14
- [ ] A catalog without the message of a new code fails the existing catalog tests, which now cover the
      three codes in both languages — validates AC-26

**Completion criterion**
`pnpm typecheck` passes, the shared tests, `error-status.test.ts` and the web catalog tests pass.

## Block 2 — API: link use case, candidates and routes

**Files**
- `apps/api/src/groups/application/link-payer-movement.ts` (new) — the use case.
- `apps/api/src/groups/application/list-movement-candidates.ts` (new) — the candidates use case.
- `apps/api/src/groups/application/ports/group-expense-repository.ts` (modified) — adds
  `linkPayerMovement`.
- `apps/api/src/groups/application/ports/payer-movement-recorder.ts` (modified) — adds
  `listCandidates`.
- `apps/api/src/groups/infrastructure/db/drizzle-group-expense-repository.ts` (modified) — implements
  `linkPayerMovement` under the locks of an expense change.
- `apps/api/src/groups/infrastructure/movements/drizzle-payer-movement-recorder.ts` (modified) —
  implements `listCandidates`.
- `apps/api/src/groups/infrastructure/http/group-routes.ts` (modified) — the two routes and their
  wiring.
- `apps/api/src/groups/index.ts` (modified) — exports the two use cases.
- `apps/api/test/groups/expense-fakes.ts` (modified) — the in-memory recorder and repository get the new
  methods.
- `apps/api/test/groups/link-payer-movement-use-case.test.ts`,
  `link-payer-movement-routes.test.ts`, `link-payer-movement-repository.test.ts` (new).
- `apps/api/test/perf/link-payer-movement.perf.test.ts` (new).

**Logic**
`LinkPayerMovement.execute(userId, groupId, expenseId, body)`:
1. `access.member` (a missing group or a non-member is a 404), then read the expense (null is a 404).
2. The caller must be the payer: if the payer member is not the caller, or the payer is a ghost, the
   answer is `GroupPayerOnly`.
3. An expense with a `payerMovementId` answers `GroupExpenseAlreadyLinked`.
4. `create`: `payerMovements.isUsable({ userId, accountId, categoryId, currency: expense.currency })`,
   false answers `GroupPayerAccountInvalid` (the same answer for an account or a category that is
   missing or another user's, as recording an expense does).
5. `adopt`: `peekAdoptable(userId, movementId)`, null answers a 404; a movement that is not an expense
   answers `GroupMovementNotExpense`; one already linked answers `GroupMovementAlreadySent`; one whose
   amount or currency differs from the expense's answers `GroupMovementMismatch`.
6. `expenses.linkPayerMovement(...)`, with the group's default rate type for `create` and the peeked
   amount and date as the expected values for `adopt`.

`linkPayerMovement` runs in one transaction, taking the locks in the order of `lockExpenseForChange`:
the group `for share`, then (for `adopt`) the movement `for update` through `lockForAdoption`, then the
expense row `for update`, then the members `for share` ordered by id. After the locks it re-checks that
`payerMovementId` is still null (else `GroupExpenseAlreadyLinked`), and for `adopt` that the movement is
still unlinked (`GroupMovementAlreadySent`) and unchanged (`GroupMovementChanged`, as in the send path).
`create` records the movement through `recorder.record` with the full amount, the expense's date, the
description as note and the group's rate type, and sets `adopted_movement` to false; `adopt` sets it to
true. It updates only `payer_movement_id` and `adopted_movement` of the expense, and returns the expense
with its shares. It inserts no activity log row, does not change `version` and does not touch the
shares. The recorder clamps a future date to the end of today in the payer's time zone, so the movement
of a `create` can be dated before an expense dated ahead.

`ListMovementCandidates` checks membership, the payer and the unlinked state like the link, then asks the
recorder for the payer's expense movements of the expense's currency and amount that no group expense
points to, newest first, at most 20, joined to the payer's accounts for the name.

**API contract**
- Method and path: `POST /groups/:id/expenses/:expenseId/payer-movement`.
- Request: params `{ id: uuid, expenseId: uuid }`; body `linkPayerMovementRequestSchema`.
- Response: 200 with the expense in the shape of the other expense endpoints, `payerMovementId` set.
- Error codes: 400 `VALIDATION_FAILED`, 400 `GROUP_PAYER_ACCOUNT_INVALID`, 400
  `GROUP_MOVEMENT_NOT_EXPENSE`, 400 `GROUP_MOVEMENT_MISMATCH`, 403 `GROUP_PAYER_ONLY`, 404 `NOT_FOUND`,
  409 `GROUP_EXPENSE_ALREADY_LINKED`, 409 `GROUP_MOVEMENT_ALREADY_SENT`, 409 `GROUP_MOVEMENT_CHANGED`.
- Auth: a session with a verified email, a member of the group, and the payer of the expense.
- Method and path: `GET /groups/:id/expenses/:expenseId/movement-candidates`.
- Request: params `{ id: uuid, expenseId: uuid }`, no body and no query.
- Response: 200 `movementCandidatesResponseSchema`.
- Error codes: 403 `GROUP_PAYER_ONLY`, 404 `NOT_FOUND`, 409 `GROUP_EXPENSE_ALREADY_LINKED`.
- Auth: the same.

**Data model**
No change and no migration. It uses `group_expenses.payer_movement_id` (nullable foreign key to
`movements`, `on delete set null`, unique where not null) and `group_expenses.adopted_movement` (not
null, default false), whose constraints stay as they are.

**Input validation**
Every route validates its params and body with the shared schemas through the shared validation
middleware; the handlers receive the inferred types, and no handler reads an unvalidated request.

**Error handling**
- The caller is not the payer, or the payer is a ghost — 403 `GROUP_PAYER_ONLY`, nothing written.
- The expense already has a linked movement, also when two requests race — 409
  `GROUP_EXPENSE_ALREADY_LINKED`; the expense row lock serialises them and the loser changes nothing.
- The account or category is unusable, missing or another user's — 400 `GROUP_PAYER_ACCOUNT_INVALID`.
- The movement is missing or another user's — 404, the same answer for both.
- The movement is not an expense, differs in amount or currency, is already linked or changed after it
  was read — 400, 400, 409 and 409 with their own codes, nothing written.

**Required tests**
- [ ] The payer links an unlinked expense in `create` mode and the response carries the movement id —
      validates AC-02
- [ ] A body that is neither shape, or has an extra key, answers 400 and writes nothing — validates
      AC-01
- [ ] A member who is not the payer is forbidden (403 `GROUP_PAYER_ONLY`), and so is the member who
      asks for the candidates — validates AC-03, AC-19
- [ ] An expense paid by a ghost member answers 403 `GROUP_PAYER_ONLY` — validates AC-04
- [ ] An expense that is already linked answers 409 `GROUP_EXPENSE_ALREADY_LINKED`, for the link and for
      the candidates — validates AC-05, AC-19
- [ ] A missing group, a missing expense and a caller outside the group answer the same 404 — validates
      AC-06
- [ ] `create` subtracts 40,000.00 ARS from the chosen ARS account with one expense movement carrying
      the category, the date and the description — validates AC-07
- [ ] An archived account, another user's account and an account in another currency are rejected with
      400 `GROUP_PAYER_ACCOUNT_INVALID`, with no movement — validates AC-08
- [ ] A category that is not the payer's expense category is rejected with 400 and no movement —
      validates AC-09
- [ ] Deleting an expense linked in `create` mode deletes the movement — validates AC-10
- [ ] `adopt` links one of the payer's own expense movements of the same amount and currency and changes
      no account balance — validates AC-11
- [ ] A movement that is an income is rejected with 400 `GROUP_MOVEMENT_NOT_EXPENSE` — validates AC-12
- [ ] A movement already linked to another expense answers 409 `GROUP_MOVEMENT_ALREADY_SENT` — validates
      AC-13
- [ ] A movement of another amount or currency is rejected with 400 `GROUP_MOVEMENT_MISMATCH`, linking
      nothing — validates AC-14
- [ ] A missing movement and another user's movement answer the same 404 — validates AC-15, AC-31
- [ ] After an `adopt` link, editing the expense carries amount and date and keeps the note, deleting it
      keeps and detaches the movement, and editing the movement amount, account or date answers 409
      `MOVEMENT_LOCKED_BY_GROUP_EXPENSE` — validates AC-16
- [ ] A link leaves the shares, the version, the balances and the activity log unchanged, and the
      activity-log write-path test still passes — validates AC-17
- [ ] The candidates are at most 20, newest first, only the payer's, unlinked, of the same amount and
      currency — validates AC-18
- [ ] Twenty simultaneous links of the same expense apply exactly one and answer the rest 409 with one
      linked movement — validates AC-28
- [ ] The two endpoints answer under 300 ms at the 95th percentile with 10,000 expenses in the group —
      validates AC-29
- [ ] An account, category or movement of another user is never read: the answers are those of the two
      tests above — validates AC-31
- [ ] A request whose movement changed between the read and the lock fails with 409
      `GROUP_MOVEMENT_CHANGED` and links nothing — error case

**Completion criterion**
The three new API test files and the perf test pass against PostgreSQL, the existing groups, movements
and activity-log tests still pass, and `pnpm typecheck` and `eslint` pass.

## Block 3 — Web: the link screen and the row action

**Files**
- `apps/web/src/lib/api-client.ts` (modified) — `linkPayerMovement` and `getMovementCandidates`.
- `apps/web/src/features/groups/expenses/link/link-expense-container.tsx` (new) — loads the expense, the
  accounts, the categories and the candidates, checks the connection, submits.
- `apps/web/src/features/groups/expenses/link/link-expense-view.tsx`,
  `create-way-form.tsx`, `adopt-way-list.tsx` (new) — presentational components.
- `apps/web/src/features/groups/expenses/link/link-request.ts` (new) — builds the body from the screen
  values.
- `apps/web/src/app/[locale]/(app)/groups/[id]/expenses/[expenseId]/link/page.tsx` (new) — the route.
- `apps/web/src/features/groups/expenses/list/expense-row.tsx`,
  `group-expenses-list.tsx` and `group-expenses-container.tsx` (modified) — the action and the linked
  marker.
- `apps/web/messages/en.json` and `apps/web/messages/es.json` (modified) — the keys of the screen and
  of the row.
- `apps/web/test/group-expense-link.test.tsx`, `group-expense-link-view.test.tsx`,
  `api-client-group-link.test.ts`, `group-expenses-list.test.tsx` (new and modified).
- `apps/web/e2e/group-expense-link.spec.ts` (new).

**Logic**
The row shows "Link to my account" when the expense is synced, the caller's member is its payer and it
has no `payerMovementId`; all three are in data the list already holds, so no request is added. A row
already linked shows a "Linked to your account" marker to its payer. The action is a link outside the
`edit` block, so it stays when the device queue is unavailable. The container follows the send-to-group
pattern: while the device is offline it shows the connection notice and sends nothing; otherwise it loads
the expense, the payer's accounts and personal expense categories through the existing form-data loader,
and the candidates, and reports 401 and 404 like the other screens. The `create` way offers the accounts
in the expense's currency and the payer's expense categories (reusing `PayerAccountFields`); the `adopt`
way lists the candidates with account, date and note, and when there are none says so and points to the
`create` way. A successful link returns to the expenses list, which reloads on mount and shows the row
as linked; a refused or failed one shows the failure through `GroupIssue` and keeps what the payer chose.
Amounts and dates go through the locale formatters and every string through the catalogs.

**Input validation**
The screen builds the body with `link-request.ts` and checks it with the shared schema before sending;
an empty account or category keeps the submit button from sending, and the server validates again.

**Error handling**
- The device is offline — the screen says linking needs a connection and sends no request.
- The expense is not found or the payer cannot link it — the not-found view or the failure, with a way
  back to the list.
- The server refuses the link or the request fails — the failure and a retry or back action, with the
  choices kept.

**Required tests**
- [ ] The row action shows only for the payer of a synced, unlinked expense, and not for another member,
      a linked expense or a queued one — validates AC-20
- [ ] The `create` way offers only non-archived accounts in the expense's currency and the payer's
      expense categories — validates AC-21
- [ ] With no candidates the `adopt` way says so and offers the `create` way — validates AC-22
- [ ] A successful link goes back to the list, which shows the row as linked — validates AC-23
- [ ] A refused link (400, 403 or 409) shows the failure and keeps the choices — validates AC-24
- [ ] A network error shows the failure with a retry, and offline the screen sends no request, with 0
      calls to the API client — validates AC-24, AC-25
- [ ] An expense that is not found (404) or that the caller cannot link (403) shows the not-found view or
      the failure with a way back to the list — error case
- [ ] The screen reads its text from the Spanish and the English catalogs, and the catalogs have the same
      keys — validates AC-26
- [ ] The presentational components render with props only and make no call to the API client — validates
      AC-27
- [ ] Loading the expenses list issues the same requests as before this change — validates AC-30
- [ ] At 360 px the screen and the row show no horizontal scroll, and the controls are reachable by
      keyboard — validates AC-32
- [ ] e2e: another member records "Ana paid" and Ana links it in both ways, sees the movement and the
      balance change, and the row shows as linked — validates AC-02, AC-07, AC-11, AC-23

**Completion criterion**
The new and changed web tests pass, the catalog and hard-coded-string scan tests pass, the e2e passes
against a local PostgreSQL, and `pnpm typecheck`, `eslint` and `prettier --check` pass.

## Final verification

- Every AC-01 to AC-32 has at least one test, and every failure path of the blocks has one.
- A link writes nothing but the two columns, and one request of two racing for the same expense wins.
- The existing edit, delete, lock and activity-log behaviour of expenses is unchanged.
- No migration, no new dependency, no `any`, and the latency test passes at 300 ms.

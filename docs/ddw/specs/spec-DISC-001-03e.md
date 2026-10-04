# Spec DISC-001-03e: Edit and Delete Movements

| Field | Value |
|-------|-------|
| Ticket | DISC-001-03e |
| PRD | docs/ddw/prd/prd-DISC-001-03e.md |
| Tier | FEATURE |
| Date | 2026-10-04 |
| Spec loops | 2 |
| Loops since last human decision | 2 |

## Summary
Two new owner-scoped routes, `PUT /movements/:id` (replace) and `DELETE /movements/:id`, built on two
new use cases, `UpdateMovement` and `DeleteMovement`. The creation rules (future date, account and
category checks, rate resolution, implied rate of an exchange) are extracted from `CreateMovement`
into one builder that both creation and edition call, so an edit can never be looser than a create.
No schema change and no migration: account balances are not stored, they are summed from the
movements on read (`drizzle-account-movements.ts`), so persisting an edit or a delete in one
transaction recomputes every account involved, before and after. The web app gets an edit screen that
reuses the entry form and a delete action with an inline confirmation on each list row. The ticket
also adds the repository's `README.md` (user request, see Block 10).

## Design decisions
- D1: Edit is a full replacement (`PUT`): the body has the shape of a creation, so an omitted `note`
  or `tags` clears it. The movement `id`, `ownerId` and `createdAt` never change; `updated_at` is set.
- D2: The `type` of a movement is immutable (an expense cannot become a transfer): the body carries
  the type and a different one answers 409 `MOVEMENT_TYPE_IMMUTABLE`. The category kind is tied to
  the type by a database key, so a type change is a delete plus a create, which already exists.
- D3: The rate of an expense or income has a third source on edit, `keep`, which leaves the frozen
  `rate`, `rateSource` and `rateType` untouched. `automatic` re-reads the latest stored rate and
  `manual` freezes the given value, both only when the user asks. The frozen-rate rule of the
  glossary therefore holds for every edit that does not touch the rate. An exchange recomputes its
  implied rate from its two amounts, as on creation. A transfer has no rate.
- D4: An edit may keep an archived account, destination or category the movement already points at
  (fixing a typo in an old note must not require unarchiving), but it cannot move the movement to an
  archived one: the check applies only to a reference that changes.
- D5: Deleting a movement deletes its tag links by the existing `ON DELETE CASCADE`; the user's tags
  stay as suggestions, because tag lifecycle belongs to DISC-001-03d.
- D6: Edit and delete are not behind the per-owner creation limiter: they create no rows, each one
  touches one movement and at most 10 tag links, and the limiter counts creations (see the threat
  model for the denial-of-service analysis).
- D7: Both routes answer 404 for a movement that does not exist or belongs to someone else, in the
  same statement that scopes the owner, never 403 (AGENTS.md).

## Coverage: PRD → blocks
| Requirement | Covered by |
|---|---|
| FR-01 | Block 1, Block 2, Block 3, Block 4, Block 5, Block 6, Block 7 |
| FR-02 | Block 3, Block 4, Block 5, Block 6, Block 8 |
| FR-03 | Block 2, Block 3, Block 4, Block 5 |
| FR-04 | Block 2, Block 4, Block 5, Block 6 |
| NFR-01 | Strategy: amounts keep travelling as decimal strings in the API and as `bigint` in the use cases and the repository; the edit body reuses `movementAmountSchema`, and the existing no-float-money test keeps scanning the movements sources. |
| NFR-02 | Strategy: the rate of an edit is a scaled integer string parsed to `bigint`, or kept, or read from the stored rates as `bigint`; an exchange recomputes it with `impliedRate` on integers; nothing converts a rate to a float. |
| NFR-03 | Strategy: one indexed single-row statement by primary key and owner inside one transaction, at most 10 tag links, no external call in the request path; Block 9 measures p95 under 300 ms for both operations against PostgreSQL. |
| NFR-04 | Strategy: every statement of `update` and `delete` carries the `scopedTo` predicate on the owner in the same statement, and the tag-link delete is also filtered by owner; Block 3 and Block 5 test a second user's movement. |

## Dependencies between blocks
Execution order: Block 1 → Block 2 → Block 3 → Block 4 → Block 5 → Block 6 → Block 7 → Block 8 →
Block 9. Block 2 needs the shared error code of Block 1. Block 3 implements the port changed in Block 2.
Block 4 needs the builder of Block 2 and the repository methods of Block 3. Block 5 wires the use cases
of Block 4. Block 6 needs the contract of Block 1 and the routes of Block 5 to be exercised end to end.
Block 7 and Block 8 need the client of Block 6. Block 9 needs everything before it. Block 10 is
independent and can run at any point, but it is done last so its Status list reflects the final state.

## Block 1 — Shared edit contract (FR-01, AC-05)

**Files**
- `packages/shared/src/movements/movement.ts` (modified) — adds `updateMovementRequestSchema`, the
  discriminated union on `type` with the shape of the create request, where an expense or income
  `rate` also accepts `{ source: 'keep' }`; exports `UpdateMovementRequest`.
- `packages/shared/src/errors.ts` (modified) — adds the code `MOVEMENT_TYPE_IMMUTABLE`.
- `packages/shared/test/movement-schemas.test.ts` (modified) — contract tests for the edit body.

**Logic**
The edit contract reuses the field validators of the create request (`movementAmountSchema`,
`occurredAtSchema`, `movementNoteSchema`, `movementTagsSchema`, `scaledRateStringSchema`) so both
accept exactly the same values. Transfers and exchanges keep their create shapes; unknown keys are
stripped like on create.

**Input validation**
- `amount` and `destinationAmount`: positive integer string, 1 to 10^15, no leading zeros.
- `occurredAt`: ISO 8601 UTC instant, year 1970 to 2100.
- `note`: trimmed, at most 500 code points, no control or format characters; empty becomes absent.
- `tags`: at most 10, each 1 to 30 code points; only for expense and income.
- `rate`: `automatic`, `keep`, or `manual` with a scaled integer string; only for expense and income.
- `accountId`, `destinationAccountId`, `categoryId`: UUID.

**Error handling**
- A body that breaks any rule above is a validation failure: 400 `VALIDATION_FAILED`, nothing stored.
- A `type` outside the four movement types is a validation failure of the same kind.

**Required tests**
- [ ] The edit contract accepts a valid body of each of the four types — validates FR-01.
- [ ] An expense body with `rate: { source: 'keep' }` is accepted, and a transfer body with a rate is stripped — validates FR-01.
- [ ] An invalid edit body with amount "0" fails validation — validates AC-05.
- [ ] An invalid edit body with a negative amount string fails validation and is an error for the caller — validates AC-05.
- [ ] A body with a missing `categoryId` on an expense, or an unknown `type`, fails validation — validates FR-01.

**Completion criterion**
The three shared tests above pass, `pnpm --filter @pesly/shared typecheck` is clean, and the API and
the web app can import `updateMovementRequestSchema` and `UpdateMovementRequest` from `@pesly/shared`.

## Block 2 — Domain error, port and shared builder (FR-01, FR-03, FR-04, NFR-01, NFR-02)

**Files**
- `apps/api/src/movements/domain/errors.ts` (modified) — adds `MovementTypeImmutable`.
- `apps/api/src/movements/application/ports/movement-repository.ts` (modified) — adds `update` and
  `delete`, and lets `findById` take a scope of any action so the write path can read the current row.
- `apps/api/src/movements/application/build-new-movement.ts` (new) — the creation rules, extracted.
- `apps/api/src/movements/application/create-movement.ts` (modified) — delegates to the builder.
- `apps/api/test/movements/fakes.ts` (modified) — the in-memory repository implements the new methods.
- `apps/api/test/movements/build-new-movement.test.ts` (new) — builder tests, create and edit modes.

**Logic**
`buildNewMovement(deps, scope, input, existing?)` runs the rules of `CreateMovement` in the same order
(accounts exist and are open, category kind, rate resolution, same account, currency checks, implied
rate) and returns a `NewMovement`. With `existing` it applies D3 and D4: `keep` copies the stored rate
fields, and an archived account, destination or category is accepted when it equals the stored one.
Without `existing` the behavior is exactly the current one, which the existing create tests guard.
The repository port gains `update(scope, id, data): Promise<Movement | null>` and
`delete(scope, id): Promise<boolean>`; `null` and `false` mean not found in scope.

**Input validation**
- The builder receives values already parsed by the shared contract (bigint amounts, `Date` instant);
  it re-checks only what needs the database: ownership and archive state of every referenced account
  and category, category kind, currency pairing, and the implied-rate range.

**Error handling**
- An account, destination or category that is missing or owned by someone else raises not found (404).
- A move to an archived account or category raises `ACCOUNT_ARCHIVED` or `CATEGORY_ARCHIVED` (400).
- `rate: keep` on a movement that has no stored rate (a transfer) is a validation failure: 400.

**Required tests**
- [ ] Create mode behaves exactly as before: the existing `create-movement.test.ts` and `create-transfer-exchange.test.ts` pass unchanged — validates FR-01.
- [ ] Edit mode with `keep` returns the stored `rate`, `rateSource` and `rateType` untouched — validates FR-01.
- [ ] Edit mode with `automatic` and with `manual` freezes the new rate as `bigint` — validates FR-01.
- [ ] Edit mode keeps an archived account the movement already points at, but moving to an archived one raises `ACCOUNT_ARCHIVED` error — validates FR-01.
- [ ] A category of the other kind raises `MOVEMENT_CATEGORY_KIND_MISMATCH` and an archived one raises `CATEGORY_ARCHIVED` error — validates FR-01.
- [ ] An account owned by another user is not found: 404 and nothing is built — validates FR-03.
- [ ] A date after today in the user's time zone is rejected in edit mode with `MOVEMENT_DATE_IN_FUTURE` error — validates FR-04.
- [ ] `keep` on a transfer is an invalid request and fails — validates FR-01.

**Completion criterion**
All builder tests and the unchanged create tests pass, `pnpm --filter @pesly/api typecheck` is clean,
and `CreateMovement` has no copy of the rules left.

## Block 3 — Drizzle repository: update and delete (FR-01, FR-02, FR-03, NFR-01, NFR-02, NFR-04)

**Files**
- `apps/api/src/movements/infrastructure/db/drizzle-movement-repository.ts` (modified) — `update` and
  `delete`.
- `apps/api/test/movements/update-delete-repository.test.ts` (new) — real PostgreSQL tests.

**Logic**
`update` runs in one transaction: `UPDATE movements SET <every editable field>, updated_at = now()`
filtered by id, by the owner through `scopedTo`, and by `type = data.type`, with `RETURNING`; no row
means `null`. It then deletes the movement's tag links (filtered by movement and owner) and re-links
the new tags with the existing `linkTags`, in the given order; transfers and exchanges store none.
Foreign key violations of an account, destination or category that vanished between the read and the
write become not found through the existing `asNotFound`. `delete` is
`DELETE FROM movements WHERE id AND owner RETURNING id` and answers a boolean; the tag links go with
the row by their cascading key. Both use the same `AccessScope<'write'>` type as `insert`.

**Input validation**
- Values reaching the repository are already built by the use case; the database constraints stay the
  last line: amount range, shape per type, destination differs from source, rate source and type.

**Error handling**
- A movement that is missing or owned by another user: `update` returns `null` and `delete` returns
  `false`, both 404 at the route, and no row changes.
- An account or category deleted concurrently: the key violation is mapped to not found, not a 500.

**Required tests**
- [ ] Updating the amount of an expense changes the source account's summed balance by the difference — validates AC-01.
- [ ] Moving an expense to another account recomputes both accounts: the old gets the amount back, the new loses it — validates AC-01.
- [ ] Editing note, tags, category, rate and date persists them and sets `updated_at` while `createdAt` stays — validates AC-01.
- [ ] Editing a transfer and an exchange recomputes the balances of the source and the destination — validates AC-01.
- [ ] Deleting an expense, an income, a transfer and an exchange removes the row, its tag links, and reverses every balance — validates AC-02.
- [ ] Another owner's movement is not updated: `update` returns null (404) and the row is unchanged — validates AC-03.
- [ ] Another owner's movement is not deleted: `delete` returns false (404) and the row is unchanged — validates AC-03.
- [ ] A concurrent account deletion during `update` is mapped to not found, never an error 500 — validates AC-01.

**Completion criterion**
`update-delete-repository.test.ts` passes against PostgreSQL, `movement-repository.test.ts` and
`schema-introspection.test.ts` still pass untouched, and a statement log shows the owner predicate in
every statement of both methods.

## Block 4 — Use cases UpdateMovement and DeleteMovement (FR-01, FR-02, FR-03, FR-04)

**Files**
- `apps/api/src/movements/application/update-movement.ts` (new) — the edit use case.
- `apps/api/src/movements/application/delete-movement.ts` (new) — the delete use case.
- `apps/api/test/movements/update-movement.test.ts` (new) — use case tests with the fakes.
- `apps/api/test/movements/delete-movement.test.ts` (new) — use case tests with the fakes.

**Logic**
`UpdateMovement.execute(scope, id, input)`: read the preferences; reject a date later than today in
the user's time zone before touching the database (the same comparison as creation); load the current
movement and turn an empty result into not found; reject a body whose `type` differs from the stored
one with `MovementTypeImmutable`; build the new values with `buildNewMovement` in edit mode; call
`movements.update`; a `null` result (the movement vanished meanwhile) is not found.
`DeleteMovement.execute(scope, id)` calls `movements.delete` and turns `false` into not found.
Neither use case touches the write limiter (D6).

**Input validation**
- `id` is a UUID validated at the route; the body arrives parsed by the shared contract. The use case
  adds the rules that need the database or the clock: ownership, type equality and the future date.

**Error handling**
- A movement that does not exist or belongs to another user: 404 `NOT_FOUND`, nothing changes.
- A date after today in the user's time zone: 400 `MOVEMENT_DATE_IN_FUTURE`, nothing changes.
- A different `type` than the stored one: 409 `MOVEMENT_TYPE_IMMUTABLE`, nothing changes.
- The movement deleted by someone else between the read and the write: 404, not a 500.

**Required tests**
- [ ] A valid edit of an expense returns the updated movement and calls `update` once with the built values — validates AC-01.
- [ ] An edit with `keep` on an old expense keeps its frozen rate even when the stored rates changed since — validates AC-01.
- [ ] Deleting an existing movement calls `delete` once and returns — validates AC-02.
- [ ] Editing or deleting a movement of another owner is a 404 and calls nothing that writes — validates AC-03.
- [ ] An edit to tomorrow's date in the user's time zone is rejected with `MOVEMENT_DATE_IN_FUTURE` error and nothing is written — validates AC-04.
- [ ] An edit that keeps an old past date passes the date rule — validates FR-04.
- [ ] An edit with a different type fails with `MOVEMENT_TYPE_IMMUTABLE` error and nothing is written — validates FR-01.
- [ ] When `update` returns null the use case answers 404, not a crash — validates FR-03.
- [ ] When `delete` returns false the use case answers 404 — validates FR-03.

**Completion criterion**
The four use case test files pass with the in-memory fakes, and no `any` is introduced
(`pnpm lint` and `pnpm typecheck` clean for `apps/api`).

## Block 5 — HTTP routes (FR-01, FR-02, FR-03, FR-04, NFR-04)

**Files**
- `apps/api/src/movements/infrastructure/http/movement-routes.ts` (modified) — `PUT /movements/:id` and
  `DELETE /movements/:id`, wired to the new use cases.
- `apps/api/src/shared/http/error-handler.ts` (modified) — maps `MOVEMENT_TYPE_IMMUTABLE` to 409.
- `apps/api/test/movements/edit-delete-routes.test.ts` (new) — route tests with a real database.
- `apps/api/test/foundation/error-handler.test.ts` (modified) — the new code and status.

**Logic**
Both routes sit behind `requireSession` and `requireVerifiedEmail` through the existing
`router.use('/movements', …)`. Each validates `params` with `movementIdParamsSchema` (and the body of
`PUT` with `updateMovementRequestSchema`) through the shared `validate` middleware, obtains a write
scope with `policy.scopeFor(auth, 'write')`, runs its use case and answers. The log line carries ids
only, never the amount, the note or the rate. The presenter used by `POST` formats the `PUT` response.

**API contract**
- Method and path: `PUT /movements/:id`.
- Request: params `{ id: uuid }`; body `UpdateMovementRequest` (the four type variants of Block 1,
  with `rate` of `automatic`, `keep` or `manual`).
- Response: 200 with `MovementResponse` (the same body as `GET /movements/:id`).
- Error codes: 400 `VALIDATION_FAILED`, 400 `MOVEMENT_DATE_IN_FUTURE`, 400 `ACCOUNT_ARCHIVED`,
  400 `CATEGORY_ARCHIVED`, 400 `MOVEMENT_CATEGORY_KIND_MISMATCH`, 400 `MOVEMENT_SAME_ACCOUNT`,
  400 `MOVEMENT_CURRENCY_MISMATCH`, 400 `EXCHANGE_SAME_CURRENCY`, 400 `IMPLIED_RATE_OUT_OF_RANGE`,
  404 `NOT_FOUND`, 409 `MOVEMENT_TYPE_IMMUTABLE`, 401 `UNAUTHENTICATED`, 403 `EMAIL_NOT_VERIFIED`.
- Auth: session cookie, verified email, owner scope; a movement outside the scope is 404.
- Method and path: `DELETE /movements/:id`.
- Request: params `{ id: uuid }`, no body.
- Response: 204 with no body.
- Error codes: 400 `VALIDATION_FAILED` for a malformed id, 404 `NOT_FOUND`, 401 `UNAUTHENTICATED`,
  403 `EMAIL_NOT_VERIFIED`.
- Auth: session cookie, verified email, owner scope; a movement outside the scope is 404.

**Input validation**
- `id` must be a UUID; the body is parsed by the shared contract, so amount, date, note, tags and rate
  follow the Block 1 rules and unknown keys are stripped.

**Error handling**
- A malformed id or body: 400 `VALIDATION_FAILED`.
- Another user's movement or a missing one: 404 `NOT_FOUND`, identical body for both.
- A future date: 400 `MOVEMENT_DATE_IN_FUTURE`.
- A different type: 409 `MOVEMENT_TYPE_IMMUTABLE`.
- No session or an unverified email: 401 or 403 from the existing middleware, unchanged.

**Required tests**
- [ ] `PUT` of an expense changes amount, date, account, category, note, tags and rate and `GET /accounts` shows the recomputed balances — validates AC-01.
- [ ] `PUT` of a transfer and of an exchange recomputes the balances of both accounts — validates AC-01.
- [ ] `DELETE` answers 204 and the balances of the accounts involved are reversed — validates AC-02.
- [ ] `PUT` and `DELETE` of another user's movement answer 404 with the same body as a random UUID and leave it unchanged — validates AC-03.
- [ ] `PUT` with a date of tomorrow in the user's time zone answers 400 `MOVEMENT_DATE_IN_FUTURE` and the movement is unchanged — validates AC-04.
- [ ] `PUT` with amount "0" or a negative amount answers 400 `VALIDATION_FAILED` and the movement is unchanged — validates AC-05.
- [ ] `PUT` with a different `type` answers 409 and a malformed id answers 400 — validates FR-01.
- [ ] Without a session both routes answer 401, and with an unverified email they answer 403 — validates FR-03.
- [ ] `PUT` and `DELETE` without the web origin or the `X-Requested-With` header are refused with 403 and change nothing — validates FR-03.
- [ ] A `PUT` body that also carries `ownerId`, `id` and `createdAt` leaves all three unchanged, because unknown keys are stripped — validates FR-03.
- [ ] The log lines of a `PUT`, a `DELETE` and a rejected request contain the movement id and never the amount, note, rate or tags — validates FR-01.

**Completion criterion**
`edit-delete-routes.test.ts` and `error-handler.test.ts` pass, the request logs contain no amount,
note or rate, and `pnpm lint` and `pnpm typecheck` are clean for `apps/api`.

## Block 6 — Web client, request builder and messages (FR-01, FR-02, FR-04)

**Files**
- `apps/web/src/lib/api-client.ts` (modified) — `getMovement`, `updateMovement`, `deleteMovement`,
  and the message key of `MOVEMENT_TYPE_IMMUTABLE`.
- `apps/web/src/features/movements/movement-request.ts` (modified) — a `mode` option; in edit mode an
  unedited rate becomes `{ source: 'keep' }`.
- `apps/web/src/features/movements/movement-form-errors.ts` (modified) — the new code in the failure map.
- `apps/web/messages/en.json` (modified) — edit and delete texts and the new error.
- `apps/web/messages/es.json` (modified) — the same keys in Spanish.
- `apps/web/test/api-client-movements.test.ts` (modified) and
  `apps/web/test/movement-request.test.ts` (modified) — tests for the above.

**Logic**
The client functions follow `createMovement`: typed through the shared contracts, results as
`ApiResult`. `buildMovementRequest` keeps validating on the client first (amount, destination, date
not after today in the user's zone, note, tags), so nothing is sent while a field is invalid; in edit
mode it never builds a rate the user did not touch. No UI string is hardcoded: every text goes through
the catalogs.

**Input validation**
- The same client rules as creation: amount positive and at most 10^15 minor units, date valid and not
  after today, note and tags limits, accounts and category open and compatible with the type.

**Error handling**
- A failed `updateMovement` or `deleteMovement` returns the API code mapped to a message key, shown
  next to the field or at the top of the screen.
- `UNAUTHENTICATED` leaves for the sign-in screen, like the other calls.

**Required tests**
- [ ] `updateMovement` sends `PUT /movements/:id` with the built body and parses the response — validates FR-01.
- [ ] `deleteMovement` sends `DELETE /movements/:id` and resolves on 204 — validates FR-02.
- [ ] An error response of `updateMovement` maps `MOVEMENT_DATE_IN_FUTURE` and `MOVEMENT_TYPE_IMMUTABLE` to their message keys — validates FR-04.
- [ ] A 404 from `deleteMovement` is a failed result with the not-found key, not an exception — validates FR-02.
- [ ] Edit mode with an unedited rate builds `{ source: 'keep' }`, and an edited one builds `manual` — validates FR-01.
- [ ] A date after today or an amount of 0 is invalid on the client and no request is built — validates FR-04.
- [ ] The English and Spanish catalogs have the same keys for the new texts — validates FR-01.

**Completion criterion**
The tests above pass, `pnpm --filter @pesly/web typecheck` is clean, and the i18n catalog key parity
test still passes.

## Block 7 — Edit screen (FR-01, FR-04)

**Files**
- `apps/web/src/features/movements/use-movement-form-data.ts` (new) — the data loading of the entry
  screen (profile, open accounts and categories, stored rates), extracted.
- `apps/web/src/features/movements/containers/create-movement-container.tsx` (modified) — uses it.
- `apps/web/src/features/movements/containers/edit-movement-container.tsx` (new) — loads the
  movement, shows the form filled in, saves with `updateMovement`.
- `apps/web/src/features/movements/components/movement-form.tsx` (modified) — optional initial values
  and a locked type; stays presentational.
- `apps/web/src/app/[locale]/(app)/movements/[id]/edit/page.tsx` (new) — the route.

**Logic**
The edit container loads the movement with `getMovement` and the form data with the extracted hook,
adds the movement's own archived account or category to the choices so the form can show them (D4),
and renders `MovementForm` with the initial values, the type locked and the rate field showing the
stored rate as not edited. On save it builds the request in edit mode and calls `updateMovement`; on
success it goes back to the list. A 404 shows the not-found state and a network failure keeps the
form mounted with what the user typed.

**Input validation**
- The form enforces the Block 6 client rules and shows each message under its field; the type cannot
  be changed, and the destination fields appear only for transfers and exchanges.

**Error handling**
- The movement cannot be loaded or is not found: a not-found state with a link back to the list.
- The API rejects the edit (date, archived account, rate): the message appears and the form stays.

**Required tests**
- [ ] The edit screen loads a movement and shows its amount, date, account, category, note, tags and rate filled in — validates AC-01.
- [ ] Saving an edited amount calls `updateMovement` with the changed amount and leaves for the list — validates AC-01.
- [ ] The type selector is locked and an unedited rate is sent as `keep` — validates FR-01.
- [ ] A date after today shows the date error and sends nothing — validates AC-04.
- [ ] An amount of 0 shows the amount error and sends nothing — validates AC-05.
- [ ] A movement that is not found shows the not-found state, not a crash — validates AC-03.
- [ ] The create screen still behaves as before after the data hook extraction: `movements-containers.test.tsx` passes unchanged — validates FR-01.

**Completion criterion**
The web tests above pass and `/movements/<id>/edit` renders in the browser for the user's own movement
in both languages.

## Block 8 — Delete from the list (FR-02)

**Files**
- `apps/web/src/features/movements/components/movement-row.tsx` (modified) — edit link and delete
  button with the inline confirmation, all as props; stays presentational.
- `apps/web/src/features/movements/components/movement-list.tsx` (modified) — passes the row props.
- `apps/web/src/features/movements/containers/movements-container.tsx` (modified) — owns the
  confirming id, calls `deleteMovement`, reloads the list.
- `apps/web/test/movements-list.test.tsx` (modified) and `apps/web/test/movements-containers.test.tsx`
  (modified) — tests for the row and the container.

**Logic**
Each row shows an edit link to `/movements/<id>/edit` and a delete button. The button asks for an
inline confirmation (the pattern of the categories list); confirming calls `deleteMovement`, and on
success the list and its total are reloaded so the row disappears. The confirmation is a two-step
action with a cancel, with an accessible name that does not include the amount.

**Input validation**
- No user input beyond the confirmation click; the id comes from the loaded list item.

**Error handling**
- A failed delete keeps the row, closes the confirmation and shows the mapped error message.
- A delete that answers 404 (already deleted elsewhere) reloads the list instead of showing an error.

**Required tests**
- [ ] Each row shows an edit link to the edit route and a delete button — validates AC-01.
- [ ] Confirming a delete calls `deleteMovement` and the row disappears after the reload — validates AC-02.
- [ ] Cancelling the confirmation deletes nothing — validates AC-02.
- [ ] A failed delete keeps the row and shows the error message — validates AC-02.
- [ ] A delete that answers 404 reloads the list without an error — validates AC-03.

**Completion criterion**
The row and container tests pass and `pnpm lint` is clean for `apps/web`.

## Block 9 — Latency and end-to-end (NFR-03, AC-01, AC-02, AC-03)

**Files**
- `apps/api/test/perf/movements-edit-delete.perf.test.ts` (new) — p95 of edit and delete.
- `apps/web/e2e/movements.spec.ts` (modified) — the edit and delete flows in the browser.

**Logic**
The perf test seeds movements with the existing `movements-seed.ts` helper, runs a fixed number of
`PUT` and `DELETE` requests against PostgreSQL and asserts the 95th percentile of each is under
300 ms, measured server-side as in `movements-save.perf.test.ts`. The end-to-end test records an
expense, edits its amount and category from the list (FR-01), checks the balance, deletes it with the
confirmation (FR-02) and checks the balance again.

**Error handling**
- A run slower than the threshold fails the perf test with the measured p95 in its message.
- An end-to-end step that cannot find its element fails with Playwright's usual error and trace.

**Required tests**
- [ ] The p95 of `PUT /movements/:id` stays under 300 ms over the seeded set — validates NFR-03.
- [ ] The p95 of `DELETE /movements/:id` stays under 300 ms over the seeded set — validates NFR-03.
- [ ] A run over the 300 ms threshold must fail the perf test with an error that carries the measured p95 — validates NFR-03.
- [ ] In the browser, editing an expense updates the row and the account balance — validates AC-01.
- [ ] In the browser, deleting a movement removes the row and reverses the balance — validates AC-02.
- [ ] In the browser, a second user's movement id on the edit route shows the not-found state, a 404 — validates AC-03.

**Completion criterion**
`pnpm test:perf` and `pnpm e2e` pass locally with the documented databases, and the measured p95
values are recorded in the verification report.

## Block 10 — README (user request, no PRD requirement)

**Files**
- `README.md` (new) — the project README the user supplied, with corrections (below).
- `apps/api/test/deploy/readme.test.ts` (new) — keeps the README honest.

**Logic**
The repository has no README today. The content the user supplied is added as it is, with three
changes decided with the user: a short "Status" section that separates what is built (identity,
accounts, categories, movements, exchange rates, investments) from what is planned (credit cards,
groups, budgets, goals, recurring payments, reports, offline synchronization); the Getting Started
steps use the commands that exist in the repository (`docker compose up -d`, `pnpm install`, copy
`.env.example` to `.env`, `pnpm db:migrate`, `pnpm --filter @pesly/api dev`,
`pnpm --filter @pesly/web dev`) instead of `./dev.sh`, which does not exist; and the movements
feature list mentions editing and deleting. Nothing else in the supplied text is changed. This block
has no FR because it documents the project rather than the feature; it is a justified enabler (W-SPEC-01).

**Input validation**
- The test reads `README.md` and `package.json` as plain text; nothing from a user reaches it.

**Error handling**
- A README that names a script, workspace path or file that does not exist fails the test with the
  missing name.

**Required tests**
- [ ] Every `pnpm` script named in the README exists in the root `package.json` or a workspace one — validates the Block 10 criterion.
- [ ] Every `apps/`, `packages/` and `docs/ddw/` path the README shows as existing exists in the repository — validates the Block 10 criterion.
- [ ] The README does not mention `dev.sh` and has a Status section: a missing section is a failure — validates the Block 10 criterion.

**Completion criterion**
`README.md` exists at the repository root, the three README tests pass, and `pnpm lint` (Prettier
check) is clean for it.

## Final verification
- `pnpm lint`, `pnpm typecheck`, `pnpm test:coverage` (80% lines, branches and functions over the
  three trees together), `pnpm test:perf` and `pnpm e2e` pass.
- No migration was added: `apps/api/drizzle/` is unchanged and the journal still ends at
  `0017_tags`; the rollback of this ticket is reverting the commits, with no data to reverse.
- Every AC of the PRD has a passing test: AC-01 and AC-02 against real balances, AC-03 with a second
  user, AC-04 with tomorrow in the user's time zone, AC-05 with 0 and negative amounts.
- Editing a movement never changes its frozen rate unless the user edits the rate (D3).
- The README's commands and paths exist, and its Status section matches the code at closeout.

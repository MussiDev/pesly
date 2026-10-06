# Spec DISC-001-04b: Offline Entry and Sync of New Movements

| Field | Value |
|-------|-------|
| Ticket | DISC-001-04b |
| PRD | docs/ddw/prd/prd-DISC-001-04b.md |
| Tier | FEATURE |
| Date | 2026-10-05 |
| Spec loops | 1 |
| Loops since last human decision | 1 |

## Summary
A user can save an expense, income, transfer or currency exchange with no connectivity. The save goes
to a durable queue in the user's IndexedDB (a new `queue` store, database version 2), the movement
appears in the list marked as pending, and a sync pass sends the queue to `POST /movements` when the
app starts online, when the `online` event fires and right after a save that could not reach the
server. Every movement gets a UUID on the device before it is stored; the API accepts that UUID as an
optional `id` and makes the create idempotent: the same owner sending an id that exists gets the
stored movement back (200) and no second row. Nothing about editing, deleting, sync states, failures
or retries with backoff is built here (DISC-001-04c).

## Design decisions
- D1: The queue is a separate IndexedDB store, `queue`, keyed by the movement id and indexed by
  `createdAt`. The `movements` store is a cache that every unfiltered online load replaces
  (`replaceAll`), so a pending movement kept there would be erased by the next refresh. The database
  goes from version 1 to 2; the upgrade only adds the store and keeps both existing ones.
- D2: The id is generated on the device with `crypto.randomUUID()` at submit time, with or without
  connectivity (AC-03). The online path also sends it, so a response lost on the way is retried with
  the same id and cannot create a second row; a `NETWORK` failure while the browser reports it is
  online falls back to the queue with the same id.
- D3: `POST /movements` gains an optional `id` (UUID) on every variant. Without it the route behaves
  exactly as today (manual limit of 60 per minute). With it the route calls a new use case,
  `RecordDeviceMovement`: (1) read the movement by id inside the caller's scope; if found, return it
  with 200, validating nothing and spending no limit unit; (2) otherwise spend one unit of the
  `device` limit bucket, create with that id and answer 201; (3) if the insert loses a race on the
  primary key, read again: found means a replay (200, unit refunded), not found means the id belongs
  to another user and the answer is the standard 404, which reveals nothing (AGENTS.md: data that is
  not the user's answers 404).
- D4: A replay returns the stored movement and ignores the payload it carries. A changed payload under
  a known id is never a second row and never an edit; edits are `PUT /movements/:id` (DISC-001-04c).
  The frozen rate stays the one stored by the first call.
- D5: User decision (2026-10-05, option a): creations that carry an id use a separate limit bucket of
  600 per minute per user, replays are free, and the manual limit stays at 60. This keeps NFR-02
  reachable (100 pending movements in under 10 s). The bucket is a column on `movement_rate_limits`
  (`bucket`, default `manual`, part of the primary key): migration 0018, additive, with a rollback
  script. Consequence, recorded in the threat model: an online client that adds an id is held to 600
  per minute instead of 60.
- D6: User decision (2026-10-05, option a): an expense or income saved with no connectivity freezes
  the rate the user saw on the device, sent as `manual` with that value; with no stored rate and no
  typed rate the form requires one (FR-06, AC-07). Online behavior is unchanged: an untouched rate
  field still asks for the server's `automatic` rate. Exchanges and transfers carry no rate input.
- D7: A sync pass sends the queue with up to 4 requests in flight and decides per answer. Success
  removes the item. A failure that says nothing about the item (`NETWORK`, `UNAUTHENTICATED`,
  `EMAIL_NOT_VERIFIED`, `RATE_LIMITED`, `INTERNAL`) stops the pass and keeps every item. Any other
  failure is the server rejecting that movement: the item stays in the queue flagged `rejected` with
  the error code, is skipped by later passes, and is never deleted. Showing and handling rejected items
  is DISC-001-04c; until it lands 04b is not released alone (parent index, pending decision 1).
- D8: One pass at a time per user, across tabs: the pass runs inside `navigator.locks.request(
  'pesly-sync-<userId>', { ifAvailable: true })`; a browser without Web Locks uses an in-memory guard
  for the tab. A second pass that finds the lock taken does nothing. If two tabs ever sent the same
  item, the idempotent create makes the second a replay.
- D9: Triggers are the app start (shell ready), the `online` event, and a `pesly:movement-queued`
  window event fired after a save that fell back to the queue while online. A pass that ends on
  `RATE_LIMITED` schedules one retry after `Retry-After`. There is no background sync while the app is
  closed (PRD Out of Scope).
- D10: A pass that sent at least one item fires `pesly:sync-finished`; the movement list reloads on it,
  which also refreshes the device copy (decision 2 of the parent index). The list merges queued items
  in front of the loaded page when no filter is active and drops a queued item whose id is already in
  the loaded page, so a movement is never shown twice.
- D11: No new runtime dependency. `crypto.randomUUID`, IndexedDB and Web Locks are platform APIs; the
  tests use `fake-indexeddb`, already a dev dependency from DISC-001-04a.

## Coverage: PRD → blocks
| Requirement | Covered by |
|---|---|
| FR-01 | Block 6, Block 10 |
| FR-02 | Block 1, Block 7, Block 10 |
| FR-03 | Block 6, Block 11 |
| FR-04 | Block 8, Block 9, Block 11 |
| FR-05 | Block 1, Block 3, Block 4, Block 5, Block 11 |
| FR-06 | Block 7 |
| NFR-01 | Block 6 (a store of 1,000 queued movements round-trips) |
| NFR-02 | Block 2 and Block 4 (the 600 per minute bucket), Block 8 (concurrency), Block 11 (100 movements under 4G conditions) |
| NFR-03 | Block 8 (1,000 randomized runs against an idempotent fake server), Block 4 (concurrent replay on PostgreSQL) |

## Dependencies between blocks
Block 1 first (the contract). Blocks 2, 3, 4, 5 are the API and run in order: 2 → 3 → 4 → 5. Blocks 6,
7, 8 are web and independent of the API blocks except for the type from Block 1: 6 → 7, and 8 needs
6. Block 9 needs 6 and 8. Block 10 needs 6, 7 and 9. Block 11 needs everything.

## Block 1 — Shared contract: optional device id

**Files**
- `packages/shared/src/movements/movement.ts` (modified) — `id: z.uuid().optional()` on the four
  create variants; the update schemas keep their shape (the id is in the path).
- `packages/shared/test/movement-schemas.test.ts` (modified) — the new cases (the file that already tests
  `createMovementRequestSchema`).

**Logic**
`createMovementRequestSchema` accepts an optional `id`. The inferred `CreateMovementRequest` gains
`id?: string`. `updateMovementRequestSchema` is built from the same field objects today
(`createTransferSchema`, `createExchangeSchema`, `updateCategorizedMovementSchema`), so the shape
shared by both is split: the creation-only `id` is added in `createMovementRequestSchema` and not in
the update variants, keeping `PUT` strict about unknown keys.

**Input validation**
- `id`: a UUID (`z.uuid()`), optional; anything else is `VALIDATION_FAILED`.

**Error handling**
- A malformed id fails the whole request body with the existing validation error; nothing is stored.

**Required tests**
- [ ] a valid UUID on each of the four types parses and is kept — validates AC-03
- [ ] a request without `id` still parses (the manual path is unchanged) — validates FR-05
- [ ] a non-UUID, an empty string and a number are rejected as invalid — invalid input
- [ ] `updateMovementRequestSchema` still rejects an `id` key — invalid input

**Completion criterion**
`pnpm --filter @pesly/shared test` passes with the new cases and `pnpm typecheck` is clean in the API
and web packages.

## Block 2 — Limit bucket: migration 0018, schema and limiter

**Files**
- `apps/api/src/movements/infrastructure/db/schema.ts` (modified) — `bucket` column, primary key
  `(owner_id, bucket, window_start)`, a check that the bucket is one of the two values.
- `apps/api/drizzle/0018_device_write_limit.sql` (new) — the additive migration.
- `apps/api/drizzle/rollback/0018_device_write_limit.down.sql` (new) — the rollback.
- `apps/api/drizzle/meta/_journal.json`, `apps/api/drizzle/meta/0018_snapshot.json` (generated by
  drizzle-kit, `when` greater than main's maximum, 1790992572883).
- `apps/api/src/movements/application/ports/movement-write-limiter.ts` (modified) — `WritePolicy`
  gains `bucket: 'manual' | 'device'`.
- `apps/api/src/movements/infrastructure/db/drizzle-movement-write-limiter.ts` (modified) — `record`
  and `release` filter and upsert on the bucket; the cleanup of older windows is per bucket.
- `apps/api/src/movements/application/record-manual-movement.ts` (modified) — its policy carries
  `bucket: 'manual'`.
- `apps/api/test/movements/write-limiter.test.ts`, `apps/api/test/identity/migration.test.ts`,
  `apps/api/test/movements/schema-introspection.test.ts` (modified).

**Logic**
Counters of the two buckets never share a row, so spending the device bucket never moves the manual
one. The migration is additive for data (a column with a default) and swaps the primary key of a table
that holds about one row per user; the rollback deletes the device rows, drops the check, the key and
the column, and restores the old key. `release` stops ignoring its policy and refunds in the policy's
bucket.

**Data model**
- `movement_rate_limits.bucket`: `text`, not null, default `'manual'`, check `in ('manual','device')`.
- Primary key `(owner_id, bucket, window_start)`; `count` unchanged.
- No index to add: the key covers the lookup.

**Error handling**
- The migration runs in the drizzle migrator transaction; a failure leaves the old schema.
- Running the rollback loses only counters (a minute of limit history), never a movement.

**Required tests**
- [ ] the two buckets of one owner count independently in the same window — validates NFR-02
- [ ] cleanup of older windows removes only the same bucket's rows — validates NFR-02
- [ ] `release` refunds the bucket it was recorded in and never goes below zero — invalid input
- [ ] a row inserted without a bucket reads back as `manual` (existing rows keep working) — validates
  FR-05
- [ ] the migration applies on a database holding the 0017 schema and the rollback restores it
- [ ] an invalid bucket value is refused by the check — invalid input

**Completion criterion**
The migration and rollback tests pass, the existing limiter tests still pass with `bucket: 'manual'`,
and `drizzle-kit` reports no schema drift.

## Block 3 — Repository and creation with a given id

**Files**
- `apps/api/src/movements/application/ports/movement-repository.ts` (modified) — `insert(scope, data,
  id?)`.
- `apps/api/src/movements/infrastructure/db/drizzle-movement-repository.ts` (modified) — the id is
  stored when given; a primary key violation (`movements_pkey`, code `23505`) becomes
  `DuplicateMovementId`.
- `apps/api/src/movements/domain/errors.ts` (modified) — `DuplicateMovementId`, an internal error the
  use case catches; it has no HTTP mapping on purpose.
- `apps/api/src/movements/application/create-movement.ts` (modified) — `execute(scope, input, id?)`
  passes the id to the repository.
- `apps/api/test/movements/movement-repository.test.ts`, `create-movement.test.ts`, `fakes.ts`
  (modified).

**Logic**
Callers that pass no id are untouched: the third argument is optional, and the investments module does
not use `CreateMovement` (checked). The repository never takes the owner or the timestamps from the
caller; it takes only the id, and only from `CreateMovement`. A unique violation on any other
constraint is rethrown as it is.

**Data model**
No schema change: `movements.id` is already a `uuid` primary key with `defaultRandom()`; the id given
by a caller is unique by that key, not nullable and never the owner's to choose.

**Input validation**
- The id reaches the repository already checked as a UUID by the shared schema (Block 1); the
  repository stores it only as a bound parameter of the insert, never in a built statement.
- A caller that passes no id gets a generated one, exactly as before.

**Error handling**
- Same id inserted twice: `DuplicateMovementId`, never a 500; the transaction rolls back, so no tag
  link of the losing insert remains.
- The existing not-found mapping for a vanished account or category is untouched.

**Required tests**
- [ ] an insert with an id stores the row under that id — validates AC-03
- [ ] an insert without an id still gets a generated id — validates FR-05
- [ ] the same id twice is a duplicate: it throws `DuplicateMovementId` and leaves one row and one set of tag links — validates AC-06
- [ ] the same id under two owners is a duplicate for the second owner and leaves the first row intact — validates AC-06
- [ ] `CreateMovement.execute` with an id passes it through, and without one does not — validates
  FR-02
- [ ] the existing not-found mapping for a vanished account or category is untouched when an id is given — invalid input
- [ ] an unrelated unique violation is rethrown unchanged — invalid input

**Completion criterion**
The repository and use case tests pass against PostgreSQL and the investments tests are unaffected.

## Block 4 — Use case: idempotent create with the device bucket

**Files**
- `apps/api/src/movements/application/record-device-movement.ts` (new) — `RecordDeviceMovement`,
  `DEFAULT_DEVICE_WRITE_LIMIT = 600`.
- `apps/api/src/movements/index.ts` (modified) — export it if the module barrel lists use cases.
- `apps/api/test/movements/record-device-movement.test.ts` (new).

**Logic**
`execute(scope, id, input): Promise<{ movement: Movement; created: boolean }>`:
1. `findById(scope, id)`: found → `{ movement, created: false }`, before any validation and before
   the limiter. A scoped read returns nothing for another owner's row.
2. Spend one unit of the `device` bucket (`limit` 600, window 60 s); over the limit throws
   `MovementWriteRateLimited(retryAfter)` with the same cap on the wait as the manual path, and
   refunds the unit.
3. `CreateMovement.execute(scope, input, id)`; success keeps the unit and returns `created: true`.
4. `DuplicateMovementId`: refund the unit, `findById(scope, id)` again; found → `created: false`;
   not found → `ResourceNotFound` (the id is another user's).
5. Any other error refunds the unit and propagates, as the manual path does; a failing refund is
   reported through `reportReleaseFailure` and does not replace the original error.

**Input validation**
- `id` and `input` arrive already validated by the shared schema (Blocks 1 and 5); the use case adds
  no format check of its own. The id is used only as a lookup key and as the id of the insert, both as
  bound parameters. Every business rule of `buildNewMovement` still runs on a new id.

**Error handling**
- Rate limited: `RATE_LIMITED` with `Retry-After`.
- Validation errors of `buildNewMovement` (archived account, future date, wrong category kind...):
  unchanged, and they refund the unit.
- Another user's id: `NOT_FOUND`.

**Required tests**
- [ ] a new id creates the movement and answers `created: true` — validates AC-03
- [ ] the same call twice returns the same movement, `created: false`, one row — validates AC-06
- [ ] a replay returns the stored movement even when the account was archived since — validates AC-06
- [ ] a replay with a different payload returns the first movement unchanged — validates AC-06
- [ ] a replay spends no limit unit, even with the bucket exhausted — validates NFR-02
- [ ] 100 distinct ids in one window all succeed, and the 601st is rejected as rate limited with a retry time and a refund — validates NFR-02
- [ ] two identical creates sent concurrently (`Promise.all`) leave one row and both answers carry the
  same id — validates NFR-03
- [ ] another user's id answers 404 not found and creates nothing — validates AC-06
- [ ] validation errors of `buildNewMovement` refund the unit and store nothing — invalid input
- [ ] a failing refund is reported and the original error stands — invalid input

**Completion criterion**
`record-device-movement.test.ts` passes against PostgreSQL, including the concurrent case.

## Block 5 — Route: `POST /movements` with an id

**Files**
- `apps/api/src/movements/infrastructure/http/movement-routes.ts` (modified) — builds
  `RecordDeviceMovement`; `POST /movements` picks the path by `body.id`; `MovementRoutesOptions` gains
  `deviceWriteLimit?`.
- `apps/api/test/movements/movement-routes.test.ts`, `edit-delete-routes.test.ts` (modified) — route
  cases.

**API contract**
- Method + path: `POST /movements` (unchanged path).
- Request: the existing variants plus optional `id` (UUID).
- Response: `movementResponseSchema`; **201** when the movement was created now, **200** when the id
  already existed for the caller. The body of both is the stored movement (same id).
- Error codes: `VALIDATION_FAILED` (400), `UNAUTHENTICATED` (401), `EMAIL_NOT_VERIFIED` (403),
  `NOT_FOUND` (404, also for another user's id), `RATE_LIMITED` (429 with `Retry-After`), the existing
  movement rule errors (409/422 as today), `INTERNAL` (500).
- Auth: unchanged (`requireSession`, `requireVerifiedEmail`, write scope).

**Logic**
No `id` → `RecordManualMovement` exactly as before. With `id` → `RecordDeviceMovement`. The log line
carries ids only: "movement created" or "movement replayed", with `requestId`, `userId` and
`movementId`, never an amount, note, rate or tag.

**Error handling**
- Every error path of the new use case maps through the existing error middleware; no new `catch`.

**Required tests**
- [ ] with an id: 201 and the stored id equals the sent id — validates AC-03
- [ ] the same body twice: 201 then 200, one row, the same body — validates AC-06
- [ ] a bad id: 400 `VALIDATION_FAILED`, nothing stored — invalid input
- [ ] another user's id: 404 and the body shows nothing of that movement — validates AC-06
- [ ] no id: 201 and the manual limit (60) still applies; sending 61 manual creations is limited while
  the device bucket is untouched — validates NFR-02
- [ ] with an id: 100 creations in a minute all answer 201 — validates NFR-02
- [ ] 401 without a session and 403 without a verified email on the id path — invalid input
- [ ] the log of a replay holds the movement id and none of the movement's data — validates FR-05
- [ ] a 500 on the id path does not echo the body or the id's owner — invalid input

**Completion criterion**
The route tests pass against PostgreSQL and `pnpm --filter @pesly/api test` is green.

## Block 6 — Web: the local queue

**Files**
- `apps/web/src/lib/local-store/database.ts` (modified) — `DATABASE_VERSION = 2`, `QUEUE_STORE`,
  `QUEUE_CREATED_AT_INDEX`, the upgrade creates the store when missing, `onversionchange` closes the
  connection so an upgrade in another tab is never blocked by this one.
- `apps/web/src/lib/local-store/stores.ts` (modified) — `putItem(QUEUE_STORE, value)`,
  `deleteItem(QUEUE_STORE, key)`; `getAll` on the queue is ordered by `createdAt`; `clear` still takes
  any store.
- `apps/web/src/lib/local-store/queue.ts` (new) — `queuedMovementSchema`, `enqueueMovement`,
  `loadQueue`, `removeQueued`, `markRejected`, and `queuedToMovement` (the `MovementResponse` shape a
  list row needs).
- `apps/web/src/lib/local-store/device-copy.ts` (modified) — `writeQueuedMovement(userId, request)`
  returning whether it was stored, `readQueuedMovements(userId)`, `removeQueuedMovement`,
  `rejectQueuedMovement`.
- `apps/web/test/local-store.test.ts` and `apps/web/test/queue.test.ts` (modified and new).

**Logic**
A queued record is `{ id, request, createdAt, rejection? }`, where `request` is a parsed
`CreateMovementRequest` that already carries the id, and `createdAt` is the device instant of the save.
Reads parse each record with `queuedMovementSchema`; one that does not parse is skipped and kept (never
deleted on a guess) so a future version can read it. Saving is one transaction, and a failing write
stores nothing. `queuedToMovement` builds the list row: an exchange's rate comes from the shared
`impliedRate` of its two amounts, a transfer's destination amount equals its amount, an expense or
income shows the manual rate it was saved with, `rateSource` is `manual` for those and `implied` for
exchanges.

**Data model**
- Store `queue`: keyPath `id`, index `createdAt`; values as above.
- Database version 2; version 1 databases upgrade in place and keep `reference` and `movements`.

**Input validation**
- `queuedMovementSchema`: id a UUID equal to `request.id`, `request` through the shared create schema
  with a required id, `createdAt` an ISO instant, `rejection.code` a short string.

**Error handling**
- A blocked upgrade (another tab still on version 1) or a missing IndexedDB reports not-stored; the
  caller shows the save failure message. Nothing is thrown into a working screen.

**Required tests**
- [ ] a saved movement is read back by a new connection (a close and reopen of the database) —
  validates AC-04
- [ ] 5 queued movements are still 5 after reopening — validates AC-04
- [ ] 1,000 queued movements are stored and read back, in `createdAt` order — validates NFR-01
- [ ] a version 1 database upgrades to 2, keeping its reference data and recent movements, and gains an
  empty queue — validates FR-03
- [ ] `replaceAll` on `movements` leaves the queue untouched — validates FR-03
- [ ] a record that does not parse is skipped by `loadQueue` and not deleted — invalid input
- [ ] a failing write stores nothing — invalid input
- [ ] no IndexedDB: the enqueue reports not-stored and does not throw — invalid input
- [ ] `queuedToMovement` of an expense, a transfer and an exchange has the right amounts and rate —
  validates AC-02

**Completion criterion**
The local store tests pass under happy-dom with `fake-indexeddb`.

## Block 7 — Web: the request builder, the offline rate and the id

**Files**
- `apps/web/src/features/movements/movement-request.ts` (modified) — `MovementRequestContext` gains
  `offline: boolean`; the rate rule for an offline creation.
- `apps/web/src/features/movements/containers/create-movement-container.tsx` (modified in Block 10)
  passes `offline` and the id; this block only changes the builder and its tests.
- `apps/web/test/movement-request.test.ts` (modified).

**Logic**
Offline, for an expense or income: a rate the user typed becomes `manual` with that value; an untouched
rate field with a stored rate becomes `manual` with the stored rate the field shows
(`parseRateInput(context.defaultRate, locale)`); an empty field with no stored rate is the existing
`movements.errors.rateRequired` (AC-07). Online the rule is unchanged (`automatic` for an untouched
field with a stored rate). The id is not built here: the container adds `crypto.randomUUID()` at
submit time, so a rejected form keeps no id.

**Input validation**
- A stored `defaultRate` that does not parse is treated as no stored rate (the field is then required).

**Error handling**
- Each field error keeps its existing message key; no new key.

**Required tests**
- [ ] offline expense with a stored rate and an untouched field builds `manual` with the shown value —
  validates FR-06
- [ ] offline expense with no stored rate and an empty field is refused with `rateRequired` — validates
  AC-07
- [ ] offline income with no stored rate and a typed rate builds `manual` with it — validates AC-07
- [ ] offline expense with an unparsable rate is refused with `rateInvalid` — invalid input
- [ ] online expense with a stored rate and an untouched field still builds `automatic` — validates
  FR-06
- [ ] transfers and exchanges offline build the same request as online — validates AC-02

**Completion criterion**
The builder tests pass and the existing edit-flow tests are unchanged.

## Block 8 — Web: the sync pass

**Files**
- `apps/web/src/lib/sync/sync-pass.ts` (new) — the pure engine.
- `apps/web/test/sync-pass.test.ts` (new).

**Logic**
`runSyncPass({ items, send, onSent, onRejected, concurrency = 4 })` sends the items that are not
rejected, oldest first, with at most `concurrency` in flight, and returns `{ sent, rejected, stopped?,
retryAfterSeconds? }`. `send` calls `api.createMovement` with the item's request. Per answer:
- ok → `onSent(id)` (the caller removes it);
- `NETWORK`, `UNAUTHENTICATED`, `EMAIL_NOT_VERIFIED`, `RATE_LIMITED`, `INTERNAL` → stop launching,
  wait for what is in flight, keep every item, report `stopped` with that reason (and the retry time
  for `RATE_LIMITED`);
- any other failure → `onRejected(id, code)` and go on with the next item.
A failure of `onSent` (the queue could not remove it) never stops the pass: the item will be sent
again and the server answers 200.

**Error handling**
- `send` throwing (it should not) counts as `NETWORK`: stop, keep everything.

**Required tests**
- [ ] a pass over an empty queue sends nothing — validates AC-05
- [ ] a pass sends every pending item once and reports them sent — validates AC-05
- [ ] at most 4 requests are in flight at once, with 100 items — validates NFR-02
- [ ] `NETWORK` stops the pass and keeps every item that was not sent — validates FR-04
- [ ] `UNAUTHENTICATED`, `EMAIL_NOT_VERIFIED` and `INTERNAL` each stop the pass and keep the items —
  validates FR-04
- [ ] `RATE_LIMITED` stops the pass and reports the retry time from the answer — validates FR-04
- [ ] a rejected movement is flagged with the code and the pass goes on with the rest — validates FR-04
- [ ] rejected items are skipped by a later pass — validates FR-04
- [ ] an `onSent` that fails does not stop the pass — invalid input
- [ ] 1,000 randomized runs cut the connection at a random point (before the request, after the server
  stored the movement but before the answer, after the answer), against a fake server that stores
  each id once: afterwards every movement is on the server exactly once and none is left in the queue
  once a final uncut pass runs, with a seeded generator so a failure is reproducible — validates NFR-03
- [ ] the same randomized run with two passes started at once leaves 0 duplicates on the fake server —
  validates NFR-03

**Completion criterion**
The pass tests pass, including the 1,000 randomized runs in under 20 s.

## Block 9 — Web: running the pass (lock, triggers, events)

**Files**
- `apps/web/src/lib/sync/sync-queue.ts` (new) — `syncMovementQueue(userId, api)`, the lock, the
  retry timer, the events.
- `apps/web/src/lib/sync/sync-events.ts` (new) — `MOVEMENT_QUEUED_EVENT`, `SYNC_FINISHED_EVENT` and
  small dispatch and subscribe helpers.
- `apps/web/src/features/shell/containers/authenticated-shell-container.tsx` (modified) — the shell
  starts a pass when it becomes ready while online, on the `online` event and on the queued event.
- `apps/web/src/lib/api-client.ts` (modified) — `CreateMovementInput` already derives from the shared
  schema, so the optional `id` flows through; no new method. A 200 and a 201 are both a success.
- `apps/web/test/sync-queue.test.ts` (new); `apps/web/test/authenticated-shell-container.test.tsx`
  (modified).

**Logic**
`syncMovementQueue` takes the user's lock without waiting, reads the queue from the user's store, runs
`runSyncPass`, removes sent items, flags rejected ones, fires `pesly:sync-finished` when anything was
sent, and schedules one retry after `retryAfterSeconds` when the pass ended on `RATE_LIMITED`. With no
Web Locks it uses a module-level guard. It never runs while `isOffline()` and never for a user the
device does not know (no session pointer). The shell triggers need a verified pointer, like the
other offline paths of DISC-001-04a, and clear the retry timer on unmount.

**Data model**
No new entity, field, constraint or index: the pass reads and writes the `queue` store of Block 6,
which keeps its unique key `id` and its `createdAt` index; nothing is nullable that was not before.

**Error handling**
- Any thrown error inside a pass is caught at the boundary and leaves the queue as it was; it is
  reported nowhere with request data in it.

**Required tests**
- [ ] a pass starts without any user action when the shell is ready and there is a queue —
  validates AC-05
- [ ] the `online` event starts a pass — validates AC-05
- [ ] a queued event while online starts a pass; while offline it does nothing — validates FR-04
- [ ] a second pass started while one runs does nothing (the lock) — validates FR-05
- [ ] without Web Locks the in-memory guard gives the same result — validates FR-05
- [ ] a pass that sent items fires the finished event once; one that sent nothing does not — validates
  FR-04
- [ ] `RATE_LIMITED` schedules one retry after the given seconds, and unmounting cancels it —
  validates FR-04
- [ ] no pass runs without a session pointer or while offline — invalid input
- [ ] an error thrown inside a pass leaves the queue intact — invalid input

**Completion criterion**
The runner and shell tests pass, and the existing shell tests (persistent storage, pointer) are
unchanged.

## Block 10 — Web: saving offline and the pending list

**Files**
- `apps/web/src/features/movements/containers/create-movement-container.tsx` (modified) — the id, the
  offline branch, the fallback on `NETWORK`.
- `apps/web/src/features/movements/components/movement-saved.tsx` (modified) — a `pending` variant.
- `apps/web/src/features/movements/containers/movements-container.tsx` (modified) — merges the queue,
  reloads on `pesly:sync-finished`.
- `apps/web/src/features/movements/components/movement-list.tsx`, `movement-row.tsx` (modified) —
  `pending` on `MovementListItem` and a badge.
- `apps/web/messages/en.json`, `apps/web/messages/es.json` (modified) — `movements.pending`,
  `movements.savedOffline`, `movements.errors.offlineSaveFailed`.
- the matching tests: `apps/web/test/movements-list.test.tsx` and the create-screen tests (a new `create-movement-container.test.tsx` if none covers the container).

**Logic**
On submit the container builds the request, adds `id: crypto.randomUUID()` and: offline → enqueue and
show the pending notice, with no request at all; online → `api.createMovement`, and on `NETWORK` →
enqueue with the same id, fire the queued event and show the pending notice. A failed enqueue (no user
known, no store, a blocked upgrade) keeps the form filled and shows `offlineSaveFailed`. The list reads
the queue next to the server page or the device copy and puts queued items first when no filter is
active, each with a "Pending" badge; a queued item whose id is in the loaded page is dropped, and the
rejected ones are not shown here (DISC-001-04c). Both message files carry the new keys; the Spanish
copy is neutral.

**Input validation**
- What the user typed goes through `buildMovementRequest` (Block 7) before anything is queued or sent:
  the same amount, date, note, tag, account, category and rate rules as online. The queue accepts only
  a parsed request with a UUID id (Block 6).

**Error handling**
- A save that cannot be stored (no user known, no store, a blocked upgrade) keeps the form filled and
  shows `offlineSaveFailed`; nothing is queued and nothing is lost.
- A server rule failure on the online path (archived account, future date...) keeps showing its
  existing message and queues nothing: only a `NETWORK` failure falls back to the queue.
- A queue that cannot be read when the list loads leaves the list as it was, without the pending rows.

**Required tests**
- [ ] offline, saving a valid expense stores it in the queue, makes no request, shows the pending
  notice and the form resets — validates AC-01
- [ ] the saved expense appears in the list marked as pending, ahead of the cached movements —
  validates AC-01
- [ ] offline, saving a valid transfer and a valid exchange store them in the queue as pending —
  validates AC-02
- [ ] every save sends or stores a UUID, offline and online — validates AC-03
- [ ] online, a `NETWORK` failure queues the same id the request carried and fires the queued event —
  validates FR-02
- [ ] the queued record is still shown as pending after the screen remounts — validates AC-04
- [ ] an offline expense with no stored rate and no typed rate is refused and nothing is queued —
  validates AC-07
- [ ] a failing enqueue keeps the form filled and shows `offlineSaveFailed` — invalid input
- [ ] a server rule failure online keeps its message and queues nothing — invalid input
- [ ] an unreadable queue leaves the list without the pending rows and shows no error — invalid input
- [ ] a queued item already in the loaded page is not shown twice — validates FR-05
- [ ] rejected items do not appear in the list — validates FR-04
- [ ] with a filter active, the queued items are not mixed into the filtered page — validates AC-01
- [ ] the keys exist in both catalogs (the existing parity test) — validates FR-01

**Completion criterion**
The container, list and catalog tests pass, and the existing movement screens' tests are unchanged.

## Block 11 — End to end: offline save, reopen, sync, duplicates, speed

**Files**
- `apps/web/e2e/offline-sync.spec.ts` (new) — runs on the production build like `offline.spec.ts`.
- `apps/web/e2e/support/database.ts` (modified) — `countMovementsById(email, id)` and a helper that
  reads a user's movement rows.
- `apps/web/e2e/support/queue.ts` (new) — seeds the queue through `page.evaluate` for the speed test.

**Logic**
The tests drive a real browser against the real API and PostgreSQL: save offline, reload while still
offline, go online, wait for the queue to drain, and read the rows from the database.

**Error handling**
- The suite refuses to run without a production build, naming `E2E_PRODUCTION_BUILD`, as
  `offline.spec.ts` does. Each test creates its own user and rows and removes them afterwards, so a
  failed test leaves nothing for the next one.
- A timing assertion that misses its budget fails with the measured time in the message.

**Required tests**
- [ ] offline, a user saves an expense and sees it in the list as pending — validates AC-01
- [ ] offline, a user saves a transfer and an exchange and sees both as pending — validates AC-02
- [ ] after saving 5 movements offline and reloading the page, the 5 are still pending — validates
  AC-04
- [ ] when the connection returns the 5 are sent with no click, the list stops showing them as
  pending, and the database holds each once — validates AC-05
- [ ] the browser has the id the form generated: the stored row has the id seen in IndexedDB —
  validates AC-03
- [ ] the first response of a create is dropped after the server stored the movement, and the retry is not a duplicate: one row — validates AC-06
- [ ] an offline expense with no cached rate and no typed rate is rejected with a rate required error and is not saved — validates AC-07
- [ ] 100 pending movements, with CDP network emulation at 10 Mbps down, 5 Mbps up and 50 ms of
  latency, are all stored in under 10 s — validates NFR-02
- [ ] 1,000 pending movements stay in the queue after a reload — validates NFR-01
- [ ] no console errors and no failed same-origin request other than the cancelled prefetches the
  earlier suite already ignores — validates FR-04

**Completion criterion**
`pnpm e2e` passes with the new file on a production build, and the existing suites still pass.

## Final verification
- Every acceptance criterion (AC-01 to AC-07) has a unit or integration test and an end-to-end flow
  where it is visible to the user.
- `POST /movements` with an id twice never creates two rows (route, use case, repository and browser
  levels), and a replay spends no limit unit.
- A queue of 1,000 survives a reload; 100 pending movements sync in under 10 s under the 4G profile;
  1,000 randomized cut-and-retry runs lose 0 and duplicate 0.
- `pnpm lint`, `pnpm typecheck`, `pnpm test:coverage` (80% floor for lines, branches and functions),
  the e2e suite and `pnpm audit --prod --audit-level high` pass.
- Migration 0018 applies on a 0017 database, its rollback restores it, and its journal `when` is
  greater than the maximum on `main` at merge time.
- DISC-001-04b is not released alone: 04c adds the failed state a rejected queued movement needs, and
  04a still ships with 04d.

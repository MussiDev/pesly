# Spec DISC-001-04c: Offline Edit and Delete, Sync States, Failures and Retries

| Field | Value |
|-------|-------|
| Ticket | DISC-001-04c |
| PRD | docs/ddw/prd/prd-DISC-001-04c.md |
| Tier | FEATURE |
| Date | 2026-10-06 |
| Spec loops | 1 |
| Loops since last human decision | 1 |

## Summary
The device queue of DISC-001-04b grows from "new movements" to "changes": one record per movement
id, with an operation (`create`, `update` or `delete`) and a revision that every local change bumps.
Editing or deleting a cached movement with no connectivity writes that record and shows the change at
once; online, an edit or delete goes straight to the API as today and falls back to the queue on a
network error. The sync pass sends every operation (`POST`, `PUT`, `DELETE`), settles a record only
if it did not change while it was in flight, writes the server's answer into the device copy, and
retries network and server failures with exponential backoff (5 s doubling, capped at 5 minutes). The
movement list shows each row as pending, synced or failed; a failed row shows the reason and offers
edit, retry and discard; the shell shows how many changes are waiting. The API is unchanged:
`PUT /movements/:id` already keeps the last write it receives. No migration, no new dependency, no new
IndexedDB store (the database stays at version 2).

## Design decisions
- D1: One queue record per movement id (the `queue` store is already keyed by `id`). A record is
  `{ id, operation, request?, base?, createdAt, revision, rejection? }`: `create` carries the creation
  request of 04b; `update` carries an `UpdateMovementRequest` and `base`, the server movement it edits
  (what the list shows under the edit); `delete` carries `base`. `createdAt` is the instant of the
  first queued change (the send order); `revision` starts at 1 and every local change adds 1. A record
  written by 04b (no `operation`, no `revision`) reads as `create`, revision 0.
- D2: Changes to the same movement collapse into its one record, in one IndexedDB transaction:
  editing a queued `create` replaces its request (an untouched rate keeps the create's rate); editing
  a queued `update` replaces its request; deleting anything queued turns the record into `delete`,
  keeping the oldest `base`. A queued `create` is never dropped on delete: it may already be on the
  server (a lost answer), so its delete is sent and a `404` answer counts as done. Any local change
  clears `rejection`: editing a failed change is "edit and retry" (FR-05).
- D3: Settling is conditional on the revision that was sent. On success the record is removed only if
  its revision is unchanged; if a `create` changed while it was in flight it becomes an `update` of
  the stored movement (an `automatic` rate becomes `keep`, because the server already froze one at
  creation); any other changed record is left for the next pass. A rejection is flagged only if the
  revision is unchanged. Without this, a change made during a pass would be deleted by the pass's
  success, or a newer edit would be swallowed by the idempotent replay of 04b (D4 of 04b).
- D4: Conflicts on personal movements: `PUT /movements/:id` writes whatever it receives, so the change
  received last is the one kept (FR-04, AC-04) with no API change. `DELETE` answering `404` is what
  the user wanted (already gone) and settles the record. `PUT` answering `404` means the movement was
  deleted on another device: the change is failed with the reason "This movement was deleted on
  another device" (the wording the PRD left to this PLAN). Any other non-stopping failure code is a
  failed change, as in 04b.
- D5: A sent `create` or `update` writes the server's answer into the device copy (`movements` store,
  put by id) and a sent `delete` removes the movement from it, so a device that goes offline right
  after a pass shows the version the server kept, as synced (AC-04). The copy is not trimmed here; the
  next online load replaces it whole (04a).
- D6: Sync state of a row: `pending` when its id has a queued record without rejection, `failed` when
  the record has one, `synced` otherwise. Pending keeps the warning badge of 04b; failed is a
  destructive badge with the reason under it; synced is a small cloud-check icon whose accessible
  name is "Synced", so every row states its state without a word on each row.
- D7: A pending delete hides its row (the user asked it gone) and counts as waiting. A failed delete
  shows the row again, as failed, with retry and discard.
- D8: A failed row offers: Edit (for `create` and `update`; saving re-queues it and clears the flag),
  Retry (clears the flag and starts a pass; useful once the cause was fixed elsewhere, such as an
  account unarchived), and Discard (removes the queued change: a failed create disappears, a failed
  edit or delete shows the server version again after the reload).
- D9: Retries (FR-06, NFR-01): a pass that stops on `offline` (no HTTP answer while the browser says
  it is online) or `server-error` schedules the next pass after `5 × 2^(n−1)` seconds, capped at
  300 s, where `n` counts consecutive stopped passes of the user (5, 10, 20, 40, 80, 160, 300, 300…).
  A pass that ends without stopping resets `n`. `rate-limited` keeps the `Retry-After` wait of 04b.
  `unauthenticated` and `not-verified` schedule nothing (they need the person). While the browser is
  offline no timer runs; the `online` event starts the pass (AC-07). One timer per tab; the shell
  cancels it on unmount.
- D10: The waiting count (FR-03) is shown by the shell, above the page: "N changes waiting to sync"
  while any record is pending, and "N changes failed" (a link to the movement list) while any failed.
  A `pesly:queue-changed` window event, fired after every queue write (save, edit, delete, retry,
  discard, settle, reject), makes the shell and the list read the queue again.
- D11: The edit screen moves to `/movements/edit?id=<id>`. The service worker caches pages by path
  with `ignoreSearch`, so one cached page serves every movement offline; `/movements/[id]/edit` could
  never be cached for an id not visited online. The warm-up list of 04a gains the new path. The old
  route stays and renders the same container, so existing links keep working.
- D12: The edit screen finds the movement in the queue first (a pending create or edit is edited as it
  is now on the device), then online through `GET /movements/:id`, and offline in the device copy. A
  movement in none of them offline shows "This movement is not available without a connection" (the
  100-movement limit, PRD Out of Scope). Offline, the form options come from the reference copy, which
  holds only active accounts and categories (04a): an edit of a movement on an archived account
  offline shows the form's existing required-field error. The copy is read, never written, by the edit
  screen.
- D13: Online, an edit or delete of a movement with no queued record is sent directly, as today; a
  `NETWORK` failure queues it with the same values and fires `pesly:movement-queued`. A movement that
  already has a queued record is always changed through the queue (followed by a pass when online),
  so its changes reach the server in order.
- D14: No new runtime dependency, no migration, no API source change, no new IndexedDB store or index.
  Group movements and the conflict state are DISC-001-04e.

## Coverage: PRD → blocks
| Requirement | Covered by |
|---|---|
| FR-01 | Block 1, Block 2, Block 4, Block 5, Block 7 |
| FR-02 | Block 2, Block 5, Block 7 |
| FR-03 | Block 1, Block 6, Block 7 |
| FR-04 | Block 3, Block 7 |
| FR-05 | Block 1, Block 3, Block 5, Block 7 |
| FR-06 | Block 3 |
| FR-07 | Block 3, Block 7 |
| NFR-01 | Block 3 (the backoff sequence 5 s doubling to a 300 s cap, asserted with fake timers) |

## Dependencies between blocks
Block 1 first (the queue model). Block 2 needs 1. Block 3 needs 1. Block 4 needs 1 and 2. Block 5
needs 1, 2 and 3 (the queue-changed event). Block 6 needs 1 and 3. Block 7 needs everything. Order:
1 → 2 → 3 → 4 → 5 → 6 → 7.

## Block 1 — Queue of changes: model, collapsing and settling

**Files**
- `apps/web/src/lib/local-store/stores.ts` (modified) — `updateItem(store, key, change)`: a read and a
  write of one key in one `readwrite` transaction; `putItem` and `deleteItem` accept the `movements`
  store too.
- `apps/web/src/lib/local-store/queue.ts` (modified) — `queuedChangeSchema` (D1), `queueEdit`,
  `queueDelete`, `retryQueued`, `discardQueued`, `settleSent`, `markRejected(store, id, code,
  revision)`, `countQueue`; `enqueueMovement` writes `operation: 'create'` and revision 1.
- `apps/web/src/lib/local-store/device-copy.ts` (modified) — wrappers `writeQueuedEdit`,
  `writeQueuedDelete`, `retryQueuedChange`, `discardQueuedChange`, `readQueuedChange`,
  `readQueueCounts`; each write fires the queue-changed event.
- `apps/web/src/lib/sync/sync-events.ts` (modified) — `QUEUE_CHANGED_EVENT`, `notifyQueueChanged`,
  `onQueueChanged`.
- `apps/web/test/queue.test.ts`, `apps/web/test/local-store.test.ts` (modified).

**Logic**
`updateItem` calls `change(current)` inside the transaction: `undefined` leaves the key, `null`
deletes it, a value is put; a throw aborts and stores nothing. The queue functions use it so every
collapse (D2) and every conditional settle (D3) is one transaction: `queueEdit(store, base, request)`
creates an `update`, or folds into a queued `create` (rate `keep` becomes the create's rate) or
`update`, and answers `false` for a queued `delete`; `queueDelete(store, base)` turns any record into
`delete`; `settleSent(store, id, revision, stored?)` removes, converts a changed `create` into an
`update` of `stored`, or leaves; `markRejected` flags only an unchanged revision; `retryQueued` clears
the flag and bumps the revision; `discardQueued` removes the record; `countQueue` answers
`{ pending, failed }`.

**Data model**
- Store `queue` (unchanged key `id`, index `createdAt`). Values: `operation` one of `create`, `update`,
  `delete`; `request` (create or update schema of `packages/shared`, required for `create` and
  `update`); `base` (`movementResponseSchema`, required for `update` and `delete`, with `base.id`
  equal to `id`); `createdAt` ISO instant; `revision` integer ≥ 0; `rejection.code` 1 to 64 chars.
- Database version stays 2; records written by 04b read as `create` with revision 0.

**Input validation**
- Every record is parsed with `queuedChangeSchema` before it is written and after it is read; a write
  that does not parse stores nothing; a stored record that does not parse is skipped and kept (04b).
- `queueEdit` parses the request with `updateMovementRequestSchema` and refuses a type that differs
  from the record's or the base's (the API answers 409 for that anyway).

**Error handling**
- A failing transaction stores nothing and the wrapper answers `false`; nothing is thrown into a
  screen (the `withStore` rule of 04a).

**Required tests**
- [ ] an edit of a cached movement queues an `update` with its base and revision 1 — validates AC-01
- [ ] a delete of a cached movement queues a `delete` — validates AC-01
- [ ] an edit of a queued `create` replaces its request and keeps `create`; an untouched rate keeps
  the create's rate — validates AC-01
- [ ] two edits of the same movement leave one record with the second request and revision 2 —
  validates AC-01
- [ ] a delete of a queued `create` or `update` leaves one `delete` record — validates AC-01
- [ ] an edit of a queued `delete` is refused and changes nothing — invalid input
- [ ] an edit of a failed record clears the rejection — validates AC-05
- [ ] `settleSent` with the sent revision removes the record; with an older revision it leaves it —
  validates FR-04
- [ ] `settleSent` of a `create` changed in flight converts it to an `update` with `automatic` read as
  `keep` — validates FR-04
- [ ] `markRejected` with an older revision does not flag — validates AC-05
- [ ] `retryQueued` clears the flag and `discardQueued` removes the record — validates AC-05
- [ ] `countQueue` counts pending and failed apart — validates AC-03
- [ ] a record written by 04b (no operation, no revision) reads as `create` — validates FR-07
- [ ] a record whose base id differs from its id does not parse and is skipped — invalid input
- [ ] `updateItem` whose change throws stores nothing — invalid input
- [ ] every wrapper write fires the queue-changed event once, and a failing write answers `false` —
  validates AC-03

**Completion criterion**
The queue and local store tests pass under happy-dom with `fake-indexeddb`, and the 04b queue tests
still pass.

## Block 2 — What the list shows for a queued change

**Files**
- `apps/web/src/lib/local-store/queue.ts` (modified) — `changeToMovement(record, currencies)` builds
  the row of a `create` (04b's `queuedToMovement`) or of an `update` over its base.
- `apps/web/src/features/movements/sync-overlay.ts` (new) — `overlayQueue(page, queue, options)`, a
  pure function that merges the loaded rows and the queue into rows with a sync state.
- `apps/web/test/sync-overlay.test.ts` (new); `apps/web/test/queue.test.ts` (modified).

**Logic**
`changeToMovement` of an `update` takes the base and the edited fields; the rate is the base's for
`keep`, the typed value with source `manual` for `manual`, and empty with source `automatic` for
`automatic` (the server freezes it on arrival); omitted note and tags read as cleared (the `PUT`
contract). `overlayQueue(page, queue, { includeUnlisted, currencies })` answers
`{ movement, syncState, failure? }[]`: a page row with no record is `synced`; with an `update` record
it shows the edited values; with a pending `delete` it is left out; with a failed `delete` it shows
the base as failed. Records not in the page (creates, and updates of movements beyond the page) are
added only when `includeUnlisted` (no filter active, the rule of 04b), newest `occurredAt` first.
`failure` carries the operation and the rejection code.

**Error handling**
- An `update` whose base has a different type than its request is shown as its base (the record will
  fail on the server with `MOVEMENT_TYPE_IMMUTABLE` and show the reason).

**Required tests**
- [ ] a page row with a pending `update` shows the edited amount, note and tags and is pending —
  validates AC-01
- [ ] a page row with a pending `delete` is left out — validates AC-01
- [ ] a row with no record is synced, a pending record is pending, a rejected one is failed with its
  code — validates AC-02
- [ ] a failed `delete` shows its base row as failed — validates AC-05
- [ ] a queued `create` not in the page is added, and with `includeUnlisted` false it is not —
  validates AC-02
- [ ] an `update` with rate `keep`, `manual` and `automatic` shows the base rate, the typed rate and
  no rate — validates AC-01
- [ ] an `update` whose request type differs from its base shows the base — invalid input

**Completion criterion**
The overlay and queue tests pass; `overlayQueue` has no React or IndexedDB import.

## Block 3 — Sending edits and deletions, settling, retrying with backoff

**Files**
- `apps/web/src/lib/sync/sync-pass.ts` (modified) — the pass sends records (not requests): `send(item)`,
  `onSent(item, data)`, `onRejected(item, code)`.
- `apps/web/src/lib/sync/sync-queue.ts` (modified) — sends by operation (`createMovement`,
  `updateMovement`, `deleteMovement`), maps a `delete` answered `404` to success, settles with the
  sent revision, writes the device copy (D5), fires the queue-changed event, and schedules the
  backoff retry (D9).
- `apps/web/src/lib/sync/backoff.ts` (new) — `retryDelaySeconds(attempt)`, `BACKOFF_START_SECONDS = 5`,
  `BACKOFF_CAP_SECONDS = 300`.
- `apps/web/src/lib/local-store/reference-cache.ts` (modified) — `putRecentMovement`,
  `removeRecentMovement`.
- `apps/web/test/sync-pass.test.ts`, `apps/web/test/sync-queue.test.ts` (modified),
  `apps/web/test/backoff.test.ts` (new).
- `apps/api/test/movements/edit-delete-routes.test.ts` (modified) — the server side of AC-04, a
  characterization test of behavior that already exists.

**Logic**
`runSyncPass` keeps its concurrency, stop codes and per-answer decisions (04b D7) and passes the
record to the callbacks. In `runLocked`, `send` dispatches on the operation; `onSent` calls
`settleSent(store, id, revision, data)` and then the copy write; `onRejected` calls `markRejected`
with the revision. After the pass: queue-changed when anything was settled or flagged, sync-finished
when anything was sent (04b). A pass stopped on `offline` or `server-error` while the browser is
online schedules the next pass after `retryDelaySeconds(n)`; a pass that did not stop resets `n`.
`retryDelaySeconds(n) = min(5 × 2^(n−1), 300)` for `n ≥ 1`.

**API contract**
- No change on the server; the client uses two existing routes as they are.
- Method + path: `PUT /movements/:id` and `DELETE /movements/:id`.
- Request: `PUT` takes `updateMovementRequestSchema` (the record's `request`, same type as the
  stored movement); `DELETE` has no body. The path id is the record's UUID.
- Response: `PUT` 200 with `movementResponseSchema` (the stored movement, written into the device
  copy); `DELETE` 204 with no body.
- Error codes: `VALIDATION_FAILED` (400), `UNAUTHENTICATED` (401), `EMAIL_NOT_VERIFIED` (403),
  `NOT_FOUND` (404), `MOVEMENT_TYPE_IMMUTABLE` (409), the movement rule errors (409/422 as today),
  `INTERNAL` (500). Stop codes and failed codes are split as in 04b D7, plus D4.
- Auth: unchanged (`requireSession`, `requireVerifiedEmail`, write scope, the web origin headers);
  the queue is only sent for the user the API confirmed in this visit (04b).

**Error handling**
- `PUT` 404: failed with code `NOT_FOUND`, shown as deleted on another device (D4).
- A copy write that fails is ignored: the queue is already settled and the next online load replaces
  the copy.
- A thrown error inside the pass leaves the queue as it was (04b).

**Required tests**
- [ ] a pass sends a queued `update` with `PUT` and a `delete` with `DELETE`, and removes both —
  validates AC-07
- [ ] the `online` event with only an edit queued starts a pass that sends it with no user action —
  validates AC-07
- [ ] a `delete` answered 404 is settled as done — validates FR-04
- [ ] an `update` answered 404 is flagged `NOT_FOUND` — validates AC-05
- [ ] an `update` answered with a validation error (`ACCOUNT_ARCHIVED`) is flagged with that code —
  validates AC-05
- [ ] a record edited while its request was in flight is not removed by the success, and the next pass
  sends the new version — validates FR-04
- [ ] two devices' edits to one movement on a fake last-write-wins server: the one received last is
  kept, and after each device's pass its copy holds the server's answer, as synced — validates AC-04
- [ ] a sent `update` writes the answer into the device copy and a sent `delete` removes it —
  validates AC-04
- [ ] `NETWORK` and `INTERNAL` keep the record pending and schedule a retry; the retry sends it —
  validates AC-06
- [ ] the retry delays are 5, 10, 20, 40, 80, 160, 300 and 300 s, and a pass that completes resets
  them — validates NFR-01
- [ ] no timer while the browser is offline, and none after `UNAUTHENTICATED` — validates FR-06
- [ ] `retryDelaySeconds` of 0, a negative and a non-integer attempt answers the start delay — invalid
  input
- [ ] API: two `PUT`s of one movement with different amounts answer 200 and the second is the stored
  one — validates AC-04

**Completion criterion**
The pass, runner and backoff tests pass, the 04b randomized duplicate test still passes, and the API
route test passes against PostgreSQL.

## Block 4 — Editing offline: the edit screen

**Files**
- `apps/web/src/app/[locale]/(app)/movements/edit/page.tsx` (new) — the edit route by query string,
  with a Suspense boundary for `useSearchParams`.
- `apps/web/src/features/movements/containers/edit-movement-route-container.tsx` (new) — reads `id`
  from the query and renders `EditMovementContainer`; a missing id shows the not-found view.
- `apps/web/src/features/movements/containers/edit-movement-container.tsx` (modified) — local lookup
  (D12) and queued save (D13).
- `apps/web/src/features/movements/use-movement-form-data.ts` (modified) — with `includeArchived`, the
  copy is read offline or on a network failure, and still never written.
- `apps/web/src/features/movements/components/movement-row.tsx` (modified) — the edit link points to
  `/movements/edit?id=<id>`.
- `apps/web/src/lib/service-worker/shell-cache.ts` (modified) — `warmUrls` adds
  `/<locale>/movements/edit`.
- `apps/web/messages/en.json`, `apps/web/messages/es.json` (modified) —
  `movements.edit.notAvailableOffline`.
- `apps/web/e2e/movements.spec.ts` (modified) — the URL assertion of the edit flow.
- `apps/web/test/edit-movement-container.test.tsx`, `apps/web/test/shell-cache.test.ts`,
  `apps/web/test/offline-entry-screen.test.tsx` (modified).

**Logic**
Loading: a queued record for the id wins (a `create` or `update` is shown through `changeToMovement`;
a `delete` is not found); otherwise online `GET` as today, with `NETWORK` falling back to the copy;
offline the copy. Saving: build the request with the edit references and `offline`; when offline or
when the id has a record, `writeQueuedEdit(base, request)` and, online, fire `pesly:movement-queued`;
otherwise `PUT`, with `NETWORK` falling back to the queue. Every queued save goes back to the list.

**Input validation**
- The query `id` must be a UUID (`z.uuid()`); anything else shows the not-found view and reads
  nothing.
- What the user typed goes through `buildMovementRequest` with the same rules as online before it is
  sent or queued; the queue parses it again (Block 1).

**Error handling**
- A save that cannot be stored keeps the form filled and shows the existing `offlineSaveFailed`.
- A server rule failure online keeps its message and queues nothing (04b's rule).

**Required tests**
- [ ] offline, editing a cached movement queues the update, makes no request and returns to the list —
  validates AC-01
- [ ] offline, the screen opens a movement from the device copy with no request — validates AC-01
- [ ] a movement with a queued `create` opens with the queued values, and saving folds into it —
  validates AC-01
- [ ] online with no record, saving sends `PUT` as before; a `NETWORK` failure queues the same request
  and fires the queued event — validates FR-01
- [ ] online with a queued record, saving queues and fires the queued event instead of `PUT` —
  validates FR-04
- [ ] offline, a movement in neither the queue nor the copy shows the not-available message —
  invalid input
- [ ] a malformed or missing `id` in the query shows the not-found view — invalid input
- [ ] a failing queued save keeps the form and shows `offlineSaveFailed` — invalid input
- [ ] `warmUrls` lists the edit path, and the row's edit link uses it — validates AC-01

**Completion criterion**
The edit container, entry screen and shell cache tests pass, and the existing edit tests pass with
the new link.

## Block 5 — The list: sync states, failed changes and deleting offline

**Files**
- `apps/web/src/features/movements/containers/movements-container.tsx` (modified) — uses
  `overlayQueue`; reads the queue on queue-changed; deletes through the queue (D13); retry and discard.
- `apps/web/src/features/movements/components/movement-list.tsx` (modified) — `syncState` and
  `failure` on `MovementListItem` (replacing `pending`); `onRetry` and `onDiscard` in the row actions.
- `apps/web/src/features/movements/components/movement-row.tsx` (modified) — the three state markers
  (D6), the reason, and the failed actions (D8).
- `apps/web/src/features/movements/sync-failure.ts` (new) — `failureMessageKey(operation, code)`:
  `NOT_FOUND` on an update is the deleted-elsewhere message; known API codes use their existing error
  message; anything else is the generic one.
- `apps/web/src/lib/api-client.ts` (modified) — exports `messageKeyOf(code)` over the existing
  code-to-message table.
- `apps/web/messages/en.json`, `apps/web/messages/es.json` (modified) — `movements.list.synced`,
  `movements.list.failed`, `movements.list.actions.retry`, `movements.list.actions.discard`,
  `movements.sync.deletedElsewhere`.
- `apps/web/test/movements-list.test.tsx`, `apps/web/test/movements-containers.test.tsx`,
  `apps/web/test/offline-save.test.tsx`, `apps/web/test/sync-failure.test.ts` (modified and new).

**Logic**
The container reads the queue whenever the list settles and on queue-changed, and passes
`overlayQueue(...)` rows to the list. Delete: offline or with a queued record → `writeQueuedDelete`
(and a pass when online); online with none → `DELETE`, with `NETWORK` falling back to the queue.
Retry → `retryQueuedChange` and a pass when online. Discard → `discardQueuedChange` and a list reload.
Pending and failed rows keep edit and delete; a failed row adds retry and discard and shows the reason
as text under the badge.

**Data model**
- No persisted schema change: the block reads and writes the `queue` store of Block 1 (key `id`,
  index `createdAt`, unchanged) only through its wrappers.
- In memory, `MovementListItem.pending?: boolean` becomes `syncState?: 'pending' | 'synced' |
  'failed'` (absent: no marker, for screens that show no state) and `failure?: { operation: 'create' |
  'update' | 'delete'; code: string }`, present only when `syncState` is `failed`.

**Input validation**
- The rejection code shown is never rendered as text: it only selects a catalog message.

**Error handling**
- A queue that cannot be read leaves the rows as synced or loaded, with no error (04b's rule).
- A queued delete that cannot be stored shows the existing delete error and the row stays.

**Required tests**
- [ ] offline, deleting a cached movement after the confirmation queues it, makes no request and hides
  the row — validates AC-01
- [ ] online, a `NETWORK` failure of a delete queues it — validates FR-01
- [ ] each row shows its state: synced (an icon named "Synced"), pending badge, failed badge — validates
  AC-02
- [ ] a row turns from pending to synced when the queue-changed event follows a settled record —
  validates AC-02
- [ ] a failed row shows the reason (archived account; deleted on another device) and offers edit,
  retry and discard — validates AC-05
- [ ] retry clears the flag and starts a pass; discard removes the change and the server row shows
  again — validates AC-05
- [ ] a failed delete offers retry and discard and no edit — validates AC-05
- [ ] an unknown rejection code shows the generic message, never the code — invalid input
- [ ] a queued delete that cannot be stored keeps the row and shows the delete error — invalid input
- [ ] the new keys exist in both catalogs (the existing parity test) — validates FR-02

**Completion criterion**
The list, container, offline save and failure message tests pass, and the 04b pending tests pass with
`syncState`.

## Block 6 — The waiting count in the shell

**Files**
- `apps/web/src/features/shell/components/sync-status.tsx` (new) — presentational: the pending and
  failed counts, `role="status"`, renders nothing at zero.
- `apps/web/src/features/shell/components/authenticated-shell.tsx` (modified) — a `syncStatus` slot
  above the page.
- `apps/web/src/features/shell/containers/authenticated-shell-container.tsx` (modified) — reads
  `readQueueCounts` for the pointer's user when ready, on queue-changed and on sync-finished.
- `apps/web/messages/en.json`, `apps/web/messages/es.json` (modified) — `app.sync.waiting` and
  `app.sync.failed` (ICU plurals).
- `apps/web/test/sync-status.test.tsx` (new); `apps/web/test/authenticated-shell-container.test.tsx`
  (modified).

**Logic**
The container keeps `{ pending, failed }` and passes it to the shell, offline too (the pointer's user,
as the offline shell of 04a). The failed line links to `/movements`.

**Error handling**
- A queue that cannot be read counts as zero: nothing shows and nothing is thrown.

**Required tests**
- [ ] with 3 pending changes the shell shows "3 changes waiting to sync" — validates AC-03
- [ ] the count follows the queue-changed event (3 → 0 after a pass) and disappears at zero —
  validates AC-03
- [ ] failed changes show their own count with a link to the list — validates AC-05
- [ ] offline, the count is read for the pointer's user — validates AC-03
- [ ] a queue that cannot be read shows nothing — invalid input

**Completion criterion**
The sync status and shell container tests pass, and the existing shell tests are unchanged.

## Block 7 — End to end: edit and delete offline, states, failure, conflict

**Files**
- `apps/web/e2e/offline-edit-sync.spec.ts` (new) — on the production build, like
  `offline-sync.spec.ts`.
- `apps/web/e2e/support/database.ts` (modified) — `readMovementById` and `archiveAccount` helpers if
  missing.

**Logic**
A real browser against the real API and PostgreSQL: edit and delete offline, watch the count and the
states, go online, wait for the queue to drain, read the rows from the database; archive an account
while a change waits to make it fail; edit one movement from two browser contexts.

**Error handling**
- The suite refuses to run without a production build, naming `E2E_PRODUCTION_BUILD`; each test
  creates and removes its own user, as 04b's suite does.

**Required tests**
- [ ] offline, a user edits a cached movement and deletes another; the list shows the edit as pending
  and hides the deleted one — validates AC-01
- [ ] the rows show pending while offline and synced once the queue drains — validates AC-02
- [ ] the shell shows "2 changes waiting to sync" offline and nothing after the sync — validates AC-03
- [ ] two contexts edit the same movement; the database keeps the one sent last and both lists show it
  after reloading — validates AC-04
- [ ] an edit queued against an account archived meanwhile shows as failed with the reason; discard
  removes it — validates AC-05
- [ ] with the API answering 500 for a while, the edit stays pending and is sent once it recovers —
  validates AC-06
- [ ] going back online sends the edit and the delete with no click, and the database reflects both —
  validates AC-07
- [ ] no console errors and no failed same-origin request besides the cancelled prefetches —
  validates FR-02

**Completion criterion**
The file lints and typechecks; it runs with `pnpm e2e` on a production build (run by the orchestrator,
one worktree at a time).

## Final verification
- Every acceptance criterion (AC-01 to AC-07) has a unit or integration test, and an end-to-end flow
  where it is visible to the user.
- A change made while its previous version is in flight is never lost and never swallowed by a replay.
- Retries follow 5, 10, 20, 40, 80, 160, 300 s and stay at 300 s.
- `pnpm lint`, `pnpm typecheck`, `pnpm test:coverage` (80% floor for lines, branches and functions)
  and `pnpm audit --prod --audit-level high` pass; the e2e file lints and typechecks.
- No migration, no new runtime dependency, no API source change.
- Rollback: reverting the branch returns the web app to 04b. The database version stays 2, so no
  IndexedDB downgrade happens; `create` records keep working (04b ignores the extra `operation` and
  `revision` fields) and `update` or `delete` records do not parse under 04b's schema, so 04b skips
  and keeps them rather than sending or deleting them. Nothing on the server changes.

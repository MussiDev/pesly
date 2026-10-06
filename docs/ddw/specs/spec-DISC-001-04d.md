# Spec DISC-001-04d: Session, Sign Out and Local Data

| Field | Value |
|-------|-------|
| Ticket | DISC-001-04d |
| PRD | docs/ddw/prd/prd-DISC-001-04d.md |
| Tier | FEATURE |
| Date | 2026-10-06 |
| Spec loops | 1 |
| Loops since last human decision | 1 |

## Summary
A confirmed sign out now removes the user's local data from the device: the session pointer and the
whole per-user IndexedDB database `pesly-<userId>` (queue, cached entities, recent movements) are
deleted after the API ends the session. A user with changes pending sync is warned first, with the
count, and must confirm that they will be lost. The wipe is recorded in a `localStorage` marker
before it starts, so an interrupted wipe is finished on the next start and no code can reopen the
database until the API confirms that user again. A session that expires keeps the queue, and the
queue is only ever sent for the user the API confirmed in this visit (the 04b rule, now covered by
tests for this PRD). Web only: no API change, no migration, no new dependency, no new IndexedDB store.

## Design decisions
- D1: The wipe deletes the database, not its stores. `indexedDB.deleteDatabase('pesly-<userId>')`
  removes the queue, the reference copy and the recent movements in one operation of the browser,
  with no store left behind if a later version adds one (NFR-01). Clearing store by store would need
  a list kept in sync with the schema.
- D2: An interrupted wipe leaves nothing readable through the app (PRD risk "a sign out interrupted
  half way"). Order: (1) the user id is added to the wipe marker `pesly.wipe` in `localStorage`
  (a JSON array of user ids), (2) the session pointer is cleared, (3) the database is deleted. While
  the id is in the marker, `openLocalDatabase` refuses to open that user's database
  (`LocalStoreUnavailable`), and the authenticated shell deletes the database of every id in the
  marker when it starts. The id leaves the marker only when the API confirms that user again, so a
  late writer in another tab cannot recreate the database in between.
- D3: A `blocked` deletion (another tab holds a connection) is not a failure: every connection of
  this app closes on `versionchange` (04a), so the deletion completes as soon as the other tab
  reacts; the marker already protects the data meanwhile. The wipe answers `deleted`, `pending`
  (blocked) or `unavailable` (no IndexedDB, or the deletion failed); it never throws, and in the last
  two cases the marker stays so the next start finishes the job.
- D4: The local wipe happens only after the API answers the sign out with success. The API route is
  idempotent (204 with or without a session, it clears the cookies), so a success means this browser
  no longer has a session. On any failure (offline included) the user stays signed in, sees the
  existing error, and keeps their data and queue: wiping while the cookie is still valid would leave
  a signed-in browser with no local copy and gain nothing on a shared device. Signing out while
  offline therefore keeps failing as today (PRD 01 behavior, unchanged).
- D5: "Changes pending sync" (FR-03) are the queue records not yet on the server: pending and failed
  (`readQueueCounts`, 04c). With a total above zero, the sign out first shows a confirmation with the
  count, saying they will be lost; cancelling changes nothing. With zero, the sign out goes ahead as
  today, with no extra step. The count is read at the moment the user asks to sign out, for the
  pointer's user.
- D6: Before calling the API the sign out cancels the scheduled sync retry (`cancelSyncRetry`). A
  pass already running is not awaited: after the API ends the session every further send answers 401
  and the pass stops (04b), and the deletion closes its connection through `versionchange`.
- D7: Session expiry keeps everything (FR-01). Every `UNAUTHENTICATED` answer (shell, screens, sync
  pass) only redirects to sign-in or stops the pass; none of them clears the pointer, the marker or
  the database. Once the same user signs in, the shell confirms them and starts a pass of their queue.
- D8: Another user signing in never sends the previous user's queue (FR-02): the shell starts a pass
  only for the user the API confirmed in this visit, and each user's queue lives in their own
  database. The previous user's data stays on the device until they sign out on it. This settles
  pending decision 5 of the parent index with its recommendation, and matches the PRD's Out of Scope
  (wiping the previous user's data when a different user signs in is not done).
- D9: Other tabs follow a sign out: the shell listens to the `storage` event and sends the tab to
  sign-in when the session pointer is removed by another tab of the same origin.
- D10: Deleting the account (PRD 01) is a sign out the user confirmed with their password or Google:
  after the API confirms the deletion, the web wipes the local data the same way. An `UNAUTHENTICATED`
  answer there is session expiry and keeps the data (D7).
- D11: The service worker needs no change: its caches hold the application shell and same-origin
  pages rendered without account data (04a, 04c R-09), and it never caches API answers. The theme key
  `pesly-theme` holds no account data and stays.
- D12: No new runtime dependency, no migration, no API change, no IndexedDB version change. The
  confirmation is an inline `role="alertdialog"` region built from the owned `Button` component,
  because `components/ui` has no dialog primitive and adding Radix Dialog would be a new dependency.
- D13: Pending changes are lost on a confirmed sign out (PRD decision of 2026-09-25). Moving them to
  another user, or keeping them, is out of scope.

## Coverage: PRD → blocks
| Requirement | Covered by |
|---|---|
| FR-01 | Block 3, Block 4 |
| FR-02 | Block 3 |
| FR-03 | Block 2, Block 4 |
| FR-04 | Block 1, Block 2, Block 3, Block 4 |
| NFR-01 | Block 1 and Block 4. Strategy: the whole per-user database is deleted (D1), so the queue, the cached entities and the recent movements go together, and the session pointer is cleared; tests assert that after the wipe the database list has no `pesly-<userId>` entry, that every store reads empty when reopened after the marker is cleared, and that the pointer is gone (100% of the three kinds of local data) |

## Dependencies between blocks
Block 1 first (the wipe and the marker). Block 2 needs Block 1 (the sign out calls the wipe). Block 3
needs Block 1 (resume and clear the marker) and Block 2 (the shell passes the confirmation through).
Block 4 needs every other block. Order: 1 → 2 → 3 → 4.

## Block 1 — Wiping a user's local data

**Files**
- `apps/web/src/lib/local-store/user-id.ts` (new) — `USER_ID_PATTERN`, the one copy of the id rule
  that `database.ts`, `session-pointer.ts` and `wipe-marker.ts` share.
- `apps/web/src/lib/local-store/session-pointer.ts` (modified) — uses `USER_ID_PATTERN`.
- `apps/web/src/lib/local-store/wipe-marker.ts` (new) — the `pesly.wipe` key: `readWipeMarker()`,
  `addToWipeMarker(userId)`, `removeFromWipeMarker(userId)`, `isWipePending(userId)`. Its own module
  so that `database.ts` (the guard) and `wipe.ts` (which needs `databaseNameFor`) do not import each
  other.
- `apps/web/src/lib/local-store/wipe.ts` (new) — `wipeLocalData(userId)`, `resumePendingWipes()`.
- `apps/web/src/lib/local-store/database.ts` (modified) — `openLocalDatabase` refuses a user whose
  wipe is pending.
- `apps/web/test/wipe.test.ts` (new), `apps/web/test/local-store.test.ts` (modified).

**Logic**
`wipeLocalData(userId)` adds the id to the marker, clears the session pointer, then deletes the
database named by `databaseNameFor(userId)` and answers `deleted`, `pending` or `unavailable` (D2,
D3). `resumePendingWipes()` deletes the database of every id in the marker and leaves the marker as
it is (D2). `openLocalDatabase(userId)` rejects with `LocalStoreUnavailable` when `isWipePending` is
true, before opening anything. The marker functions read and write `localStorage` through
try/catch like the session pointer: blocked storage reads as an empty marker and writes nothing.

**Data model**
- Entity: the wipe marker, `localStorage['pesly.wipe']`, a JSON array of user ids. Constraints:
  each entry is a not null string matching `^[A-Za-z0-9-]+$` (the database-name rule of 04a);
  entries are unique (adding an id already present changes nothing); at most 20 entries, adding the
  21st drops the oldest; default when the key is missing or does not parse: the empty array. No
  index: it is read whole.
- IndexedDB: unchanged (version 2, stores `reference`, `movements`, `queue`, the `occurredAt` and
  `createdAt` indexes); whole databases are deleted.

**Input validation**
- The user id must match `^[A-Za-z0-9-]+$`; an invalid id makes `wipeLocalData` answer `unavailable`
  and touches nothing (`databaseNameFor` throws `TypeError`, which is caught).
- The stored marker is parsed with a Zod schema (array of ids); text that is not JSON or does not
  parse reads as an empty marker, and invalid entries are never used to name a database.

**Error handling**
- IndexedDB missing → `unavailable`, the marker stays (the next start finishes the wipe).
- The deletion request fails (`onerror`) → `unavailable`, the marker stays.
- The deletion is blocked by another tab → `pending`; the request completes when that tab closes its
  connection on `versionchange`.
- Blocked `localStorage` → the marker reads empty and is not written; the pointer clear is a no-op
  (04a); the database is still deleted.
- An invalid user id → `unavailable`, nothing touched.
- A pending wipe → `openLocalDatabase` rejects with `LocalStoreUnavailable`, which every caller
  already turns into "no local copy" (04a `withStore`, 04b `runLocked`).

**Required tests**
- [ ] `wipeLocalData` deletes the user's database: queue, reference copy and recent movements are gone
  and the database list has no `pesly-<id>` — validates AC-04
- [ ] `wipeLocalData` clears the session pointer and adds the id to the marker — validates AC-04
- [ ] `wipeLocalData` leaves another user's database untouched — validates AC-02
- [ ] while the id is in the marker `openLocalDatabase` rejects with `LocalStoreUnavailable`, and
  once the id is removed it opens an empty database — validates AC-04 (NFR-01)
- [ ] `resumePendingWipes` deletes a database left by an interrupted wipe (marker written, database
  still there) — validates AC-04
- [ ] error: without IndexedDB the wipe answers `unavailable` and keeps the marker
- [ ] error: a deletion request that fails answers `unavailable` and keeps the marker
- [ ] error: a deletion blocked by an open connection answers `pending` and completes once that
  connection closes on `versionchange`
- [ ] error: with blocked `localStorage` the database is still deleted and nothing throws
- [ ] error: an invalid user id answers `unavailable` and touches nothing — invalid input
- [ ] error: a marker that is not JSON or holds an invalid id reads as empty — invalid input
- [ ] the marker keeps at most 20 ids, without duplicates — invalid input

**Completion criterion**
`wipe.test.ts` and `local-store.test.ts` pass under happy-dom with `fake-indexeddb`, and the 04a, 04b
and 04c local store and queue tests still pass.

## Block 2 — Warning and wipe on a confirmed sign out

**Files**
- `apps/web/src/features/shell/use-sign-out.ts` (modified) — `requestSignOut`, `confirmSignOut`,
  `cancelSignOut`, `confirming` (the count, or `undefined`); the sign out cancels the sync retry,
  calls the API and wipes on success.
- `apps/web/src/features/shell/components/sign-out-confirmation.tsx` (new) — presentational
  confirmation: `count`, `signingOut`, `onConfirm`, `onCancel`.
- `apps/web/src/features/shell/components/authenticated-shell.tsx` (modified) — optional
  `signOutConfirmation` slot rendered next to the sign-out alert.
- `apps/web/src/features/shell/components/more-menu.tsx` (modified) — the same optional slot.
- `apps/web/src/features/shell/containers/more-container.tsx` (modified) — wires the hook to the slot.
- `apps/web/src/features/shell/containers/authenticated-shell-container.tsx` (modified) — wires the
  hook to the slot.
- `apps/web/messages/en.json`, `apps/web/messages/es.json` (modified) — `auth.signOut.confirmTitle`,
  `confirmBody` (ICU plural on `count`), `confirm`, `cancel`.
- `apps/web/test/sign-out.test.tsx` (new), `apps/web/test/shell-navigation.test.tsx` (modified).

**Logic**
`requestSignOut()` reads `readQueueCounts(readSessionPointer()?.userId)`; `pending + failed > 0` sets
`confirming` to that total and stops; zero signs out at once (D5). `confirmSignOut()` signs out;
`cancelSignOut()` clears `confirming`. Signing out: `cancelSyncRetry()`, `api.signOut()`; on success
`wipeLocalData(userId)` for the pointer's user (when there is one) and `router.replace('/sign-in')`;
on failure `signOutError` is set, `confirming` is cleared and nothing is wiped (D4, D6). The
confirmation renders `role="alertdialog"` labelled by its title, says how many changes will be lost,
and offers "sign out and discard" (destructive outline button) and "cancel"; focus moves to cancel
when it appears. Both buttons are disabled while signing out. Strings come from the catalogs; colors
and spacing from theme tokens.

**Input validation**
- The count is a non-negative integer derived from the queue; the pointer is parsed by its schema
  (04a). The confirmation takes no free text from the user.

**Error handling**
- `api.signOut()` fails (network, server) → the error alert shows the catalog message, the user stays
  signed in, and the queue and copy are untouched.
- The queue cannot be read (no IndexedDB, blocked) → it counts as zero and the sign out goes ahead
  without a warning: there is nothing on the device to lose.
- No pointer (blocked `localStorage`) → nothing to wipe; the sign out completes.
- The wipe answers `pending` or `unavailable` → the sign out still completes; the marker finishes it
  on the next start (Block 1).

**Required tests**
- [ ] with 2 pending and 1 failed change, asking to sign out shows the confirmation saying 3 changes
  will be lost, and calls no API — validates AC-03
- [ ] confirming signs out, deletes the user's database, clears the pointer and goes to sign-in —
  validates AC-04
- [ ] cancelling hides the confirmation and keeps the queue and the session — validates AC-03
- [ ] with an empty queue the sign out goes ahead at once, without the confirmation, and wipes the
  local data — validates AC-04
- [ ] the More page shows the same confirmation and wipes on confirm — validates AC-03
- [ ] the confirmation renders in Spanish and English with the plural for 1 and for several changes —
  validates AC-03
- [ ] error: when the API sign out fails, the error shows and the queue, copy and pointer are kept
- [ ] error: a queue that cannot be read counts as zero and the sign out goes ahead without a warning
- [ ] error: without a pointer the sign out completes and wipes nothing
- [ ] error: a wipe that answers `pending` or `unavailable` still completes the sign out

**Completion criterion**
`sign-out.test.tsx` and `shell-navigation.test.tsx` pass, and `i18n-catalogs.test.ts` still passes
with the new keys in both catalogs.

## Block 3 — Session lifecycle: expiry, another user, other tabs and account deletion

**Files**
- `apps/web/src/features/shell/containers/authenticated-shell-container.tsx` (modified) — resumes
  pending wipes on mount, clears the marker for the confirmed user before writing the pointer,
  listens to `storage` for the pointer's removal.
- `apps/web/src/features/profile/containers/delete-user-container.tsx` (modified) — wipes after a
  successful deletion.
- `apps/web/test/authenticated-shell-container.test.tsx` (modified),
  `apps/web/test/delete-user-container.test.tsx` (modified).

**Logic**
On mount the shell calls `resumePendingWipes()` (D2). When `GET /auth/session` confirms a verified
user, the shell calls `removeFromWipeMarker(id)` before `writeSessionPointer`, so that user's
database can be opened again, empty, and filled by the next online load. A `storage` event whose key
is `pesly.session` and whose new value is `null` sends the tab to `/sign-in` (D9). Session expiry is
left as it is: redirects only (D7). The pass keeps starting only for the confirmed user (D8). The
account deletion, on `ok`, calls `cancelSyncRetry()` and then `wipeLocalData` for the pointer's
user before going to sign-in; on `UNAUTHENTICATED` it only redirects (D10). The pointer is the right
user there: the deletion needs a connection, and online the shell writes the pointer only for the
user the API confirmed in this visit before it renders the page.

**API contract**
Existing routes, consumed unchanged (no API source change in this ticket):
- Method + path: `GET /auth/session`. Request: no body, session cookie. Response: 200
  `{ user: { id, email, emailVerified, language, timeZone } }` (shared session schema). Error codes:
  401 `UNAUTHENTICATED` (after the client's refresh attempt), network error. Auth: session cookie.
- Method + path: `POST /profile/delete` through `api.deleteMyAccount` (PRD 01). Request: body
  `{ password?, secondFactorCode? }` (shared `deleteUserRequestSchema`). Response: success with no
  body. Error codes: 401 `UNAUTHENTICATED` and `REAUTHENTICATION_REQUIRED`, validation errors, as
  mapped by the API's error middleware today. Auth: session cookie plus re-authentication.

**Input validation**
- The `storage` event is acted on only for the key `pesly.session` with a `null` new value; any other
  key or value is ignored. The confirmed user id comes from the API answer, parsed by the shared
  session schema, and is checked by the id rule before it touches the marker.

**Error handling**
- `resumePendingWipes` fails or IndexedDB is missing → nothing is shown; the marker stays and the
  next start tries again.
- The session check answers 401 → redirect to sign-in with the pointer, marker and database kept.
- The session check fails with a network error and a pointer exists → the app opens from the pointer
  as in 04a; a user in the marker has no pointer, so it cannot open.
- The account deletion fails → the existing error handling of PRD 01; nothing is wiped.

**Required tests**
- [ ] a session that expires (401 on the session check) with queued changes keeps the queue, the
  copy and the pointer, and redirects to sign-in — validates AC-01
- [ ] after the expiry, the same user signing in again gets their queue sent with no user action —
  validates AC-01
- [ ] with user A's changes queued and user B confirmed by the API, only B's queue is sent and A's
  queue stays on the device untouched — validates AC-02
- [ ] the shell finishes an interrupted wipe on start (marker for A, A's database present) —
  validates AC-04
- [ ] the confirmed user is removed from the marker before the pointer is written, so their data can
  be stored again — validates AC-04
- [ ] removing the pointer in another tab (a `storage` event) sends this tab to sign-in — validates
  AC-04
- [ ] a successful account deletion wipes the user's local data before going to sign-in — validates
  AC-04
- [ ] error: a `storage` event for another key, or with a value, is ignored — invalid input
- [ ] error: an account deletion answered 401 redirects and keeps the local data
- [ ] error: a failed account deletion wipes nothing
- [ ] error: when IndexedDB is missing the shell starts normally and the marker stays

**Completion criterion**
`authenticated-shell-container.test.tsx` and `delete-user-container.test.tsx` pass, including the
04a, 04b and 04c cases already there.

## Block 4 — End to end: sign out with pending changes

**Files**
- `apps/web/e2e/offline-sign-out.spec.ts` (new) — Playwright flow on Chromium.

**Logic**
Sign in, save a movement while the browser is offline (it queues), reconnect with the movement
requests held back by a route so the change stays pending, ask to sign out: the confirmation names 1
change; cancel keeps the user in; confirm signs out and lands on sign-in; `indexedDB.databases()` has
no `pesly-<id>` entry and `localStorage` has no `pesly.session`. A second flow signs out with an empty
queue (no confirmation) and checks the same wipe; a third lets the session expire (cookies cleared)
with a queued change, signs in as the same user and sees the change synced.

**Input validation**
- Not applicable: the flow drives the UI with the inputs of the earlier blocks.

**Error handling**
- A sign out attempted offline shows the existing error and keeps the queued change (D4).

**Required tests**
- [ ] confirming the sign out with a pending change removes the database and the pointer from the
  browser — validates AC-03, AC-04
- [ ] a session that expires with a queued change, followed by the same user's sign-in, syncs the
  change — validates AC-01
- [ ] error: a sign out attempted offline shows the error and keeps the queued change

**Completion criterion**
The spec file lints and typechecks; it is run by the orchestrator, one Playwright run at a time
(ports and the Mailpit inbox are shared on this machine).

## Final verification
- Every AC of the PRD has a passing Vitest test; the e2e flows are written and pass when run.
- `pnpm exec eslint .`, `pnpm exec prettier --check --end-of-line auto .` and `pnpm typecheck` are
  clean; coverage stays at or above 80% lines, branches and functions, and the ticket's files are at
  or above it too.
- No API source change, no migration, no new dependency, database version still 2.
- Rollback: no schema change and no migration; reverting the commits restores the 04c behavior (data
  kept on sign out). A `pesly.wipe` key left by this version is ignored by the old code.
- The accepted risks R-03 and R-04 of 04a, R-06 and R-07 of 04b and R-03 and R-07 of 04c are revisited
  in this ticket's threat model.

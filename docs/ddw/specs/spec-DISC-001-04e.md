# Spec DISC-001-04e: Conflicts on Group Movements

| Field | Value |
|-------|-------|
| Ticket | DISC-001-04e |
| PRD | docs/ddw/prd/prd-DISC-001-04e.md |
| Tier | FEATURE |
| Date | 2026-10-11 |
| Spec loops | 0 |
| Loops since last human decision | 0 |

## Summary
A "group movement" is a group expense or a group settlement (rows of the groups module, not the
payer's personal movement). Each gets an integer `version` that grows with every change. Every
change or deletion names the version it was based on; when that is older than the stored one, the
API applies nothing and answers 409 `GROUP_RECORD_CONFLICT` carrying the server version. The web
offline layer gets a queue for group changes, a fourth sync state `conflict`, and a resolution that
keeps either version, written as one atomic local transaction so no version is lost before the user
chooses. No group screen exists yet, so this ticket delivers the API, the shared contract, the local
store, the sync pass and the conflict resolution component; wiring them into group screens belongs
to the group UI ticket.

## Decisions
- **D1 Version counter.** `version integer not null default 1` on `group_expenses` and
  `group_settlements`, incremented by 1 in the same transaction as every change. A counter, not a
  timestamp: two changes in the same millisecond cannot share a value.
- **D2 Base version is required.** `PUT` and `PATCH` carry `baseVersion` in the body; `DELETE`
  carries it in the query. A request without it is a 400, so a client can never overwrite silently.
  This narrows 05d's last-write-wins decision (05d open question 5), which the owner has not yet
  ratified; the activity log is unchanged.
- **D3 Conflict answer.** 409 `GROUP_RECORD_CONFLICT` with the current server record (the same body
  as a GET) in `details.current`. Nothing is written and no log row is added. A record deleted on
  the server stays a 404, as today.
- **D4 Resolution.** "Keep server's" drops the local change and adopts the server copy. "Keep mine"
  resends the local change with `baseVersion` set to the server version received; if another change
  slipped in meanwhile, the answer is a new conflict. The server stores no conflict state: until the
  user chooses, the server version is simply the one nobody replaced (FR-03, AC-04).
- **D5 Scope of the offline layer.** Only changes and deletions of existing group expenses and
  settlements are queued. Offline creation of group expenses stays out (05 open question 3 stays
  online-only); membership and group edits stay out as the PRD says.
- **D6 Local store.** A new IndexedDB store `groupQueue` (database version 2 to 3), one record per
  `kind` + record id, holding the operation, the local request, the base record and, in conflict,
  the server record. Existing stores are untouched.
- **D7 No new dependency.** Drizzle, Zod, Express, idb layer and React Query already in use.

## Coverage: PRD → blocks
| Requirement | Covered by |
|---|---|
| FR-01 | Block 1, Block 2, Block 3, Block 4, Block 6 |
| FR-02 | Block 5, Block 6, Block 8 |
| FR-03 | Block 3, Block 6 |
| FR-04 | Block 6, Block 7 |
| NFR-01 | Strategy: resolution is one IndexedDB transaction, tested by interrupting it 1,000 times (Block 6) |

## Dependencies between blocks
Block 1 first. Blocks 2 then 3 then 4 (API, sequential). Block 5 needs only Block 1. Block 6 needs
Block 5. Blocks 7 and 8 need Block 6 and are independent of each other. The API chain and the web
chain do not touch the same files and can run in parallel after Block 1.

## Block 1 — Shared contract

**Files**
- `packages/shared/src/groups/expense.ts` (modified) — `version` on the expense response;
  `baseVersion` on the update request; delete query with `baseVersion`.
- `packages/shared/src/groups/settlement.ts` (modified) — same for settlements (`PATCH` body and
  delete query).
- `packages/shared/src/errors.ts` (modified) — code `GROUP_RECORD_CONFLICT`.
- `packages/shared/src/groups/conflict.ts` (new) — `groupRecordConflictSchema` with
  `current` (expense or settlement response).

**Logic**
`version` is a positive integer. `baseVersion` is a positive integer, required. The conflict body
type lets a client read the server record without a second request.

**Input validation**
- `baseVersion`: integer, minimum 1, maximum 2147483647; unknown keys stay rejected.

**Error handling**
- A missing, zero, negative, fractional or non-numeric `baseVersion` is a validation error.

**Required tests**
- [ ] Update request accepts `baseVersion` 1 — validates AC-01.
- [ ] Update request rejects a missing `baseVersion` — invalid input.
- [ ] Update request rejects `baseVersion` 0 and 1.5 — invalid input.
- [ ] Delete query rejects a non-numeric `baseVersion` — invalid input.
- [ ] Conflict body parses an expense and a settlement as `current`.

**Completion criterion**
Shared tests pass and `pnpm typecheck` shows the new fields flowing to the API and web.

## Block 2 — Migration and database schema

**Files**
- `apps/api/src/groups/infrastructure/db/schema.ts` (modified) — `version` columns.
- `apps/api/drizzle/0031_group_record_version.sql`, `meta/_journal.json` (idx 31, `when` above
  1791750000000 and above the maximum on `main` at merge), `meta/0031_snapshot.json`,
  `rollback/0031_group_record_version.down.sql` (new).
- Migration listing tests listed in the Final verification (modified).

**Logic**
Add the column with default 1 so existing rows get version 1; a check constrains it to at least 1.
The rollback drops the columns.

**Data model**
- `group_expenses.version integer not null default 1`, check `version >= 1`.
- `group_settlements.version integer not null default 1`, check `version >= 1`.
- No new index: lookups stay by primary key.

**Error handling**
- Applying the migration on a database with existing rows keeps them readable with version 1.

**Required tests**
- [ ] Migration adds both columns with default 1 and the check — validates AC-01.
- [ ] Rollback removes both columns and leaves the 0030 shape.
- [ ] A row inserted with version 0 is rejected by the check — invalid input.
- [ ] Journal `when` is greater than the previous entry and the snapshot chain is intact.

**Completion criterion**
Migration tests pass up and down on a fresh database and every migration listing test is updated.

## Block 3 — Version check in the use cases and repositories

**Files**
- `apps/api/src/groups/application/update-group-expense.ts`, `delete-group-expense.ts`,
  `update-settlement.ts`, `delete-settlement.ts` (modified) — take `baseVersion`.
- `apps/api/src/groups/application/ports/*` and
  `apps/api/src/groups/infrastructure/db/drizzle-group-expense-repository.ts`,
  `drizzle-group-settlement-repository.ts` (modified) — compare under the group lock, increment on
  write.
- `apps/api/src/groups/domain/errors.ts` (modified) — `GroupRecordConflictError` carrying the
  current record.
- `apps/api/src/shared/http/error-handler.ts` (modified) — 409 with `details.current`.

**Logic**
Inside the existing transaction and group lock the repository reads the row; when
`baseVersion` is lower than the stored `version` it raises the conflict error with the stored record
and writes nothing, including the payer movement and the log. A `baseVersion` higher than the
stored one is also refused as a conflict (a client cannot invent the future). A matching version
applies the change, sets `version = version + 1` and returns the new version. The permission and
former-member rules run first, so a conflict never reveals a record the caller cannot touch.

**API contract**
- Method + path: `PUT /groups/:id/expenses/:expenseId`, `PATCH /groups/:id/settlements/:settlementId`,
  `DELETE /groups/:id/expenses/:expenseId?baseVersion=N`,
  `DELETE /groups/:id/settlements/:settlementId?baseVersion=N`
- Request: the 05d body plus `baseVersion: integer` (query for DELETE).
- Response: the 05d body plus `version: integer`; DELETE answers 204.
- Error codes: 400 missing or invalid `baseVersion`; 403 `GROUP_RECORD_EDIT_FORBIDDEN`; 404 missing,
  foreign or left; 409 `GROUP_RECORD_CONFLICT` with `details.current`; 409 the existing 05d codes.
- Auth: session and verified email, group access first, then the 05d permission rule.

**Error handling**
- Stale or future `baseVersion`: 409 conflict, nothing written, no log row, no payer movement change.
- Two edits with the same `baseVersion` at once: the group lock serialises them; the second gets the
  conflict.

**Required tests**
- [ ] An edit with the current version applies and returns version + 1 — validates AC-01.
- [ ] An edit with an older version answers 409 `GROUP_RECORD_CONFLICT`, writes nothing and adds no
      log row — validates AC-01.
- [ ] The 409 body holds the server record, so the other member's data is intact — validates AC-04.
- [ ] A delete with an older version answers 409 and the record remains — validates AC-01.
- [ ] A settlement PATCH with an older version answers 409 — validates AC-01.
- [ ] A future `baseVersion` answers 409 — invalid input.
- [ ] A missing `baseVersion` answers 400 — invalid input.
- [ ] Two concurrent edits on the same version: one 200, one 409, the final version is base + 1.
- [ ] A non-member and a member who is not the author still get 404 and 403 before any conflict.
- [ ] The payer movement and the shares stay unchanged after a conflict — validates AC-04.

**Completion criterion**
The listed tests pass and the 05d tests, updated to send `baseVersion`, still pass.

## Block 4 — Routes, read side and audit

**Files**
- `apps/api/src/groups/infrastructure/http/group-routes.ts` (modified) — validate the new field and
  query, pass `baseVersion`, include `version` in every expense and settlement response (GET, list,
  POST, PUT, PATCH).
- `apps/api/test/groups/*` (modified) — add `baseVersion` to the existing edit and delete tests.

**Logic**
Creation answers version 1. Audit lines for a conflict carry request id, user id, group id, record
id, base and stored version, and no amounts or descriptions.

**Error handling**
- A conflict is logged at info level with ids only.

**Required tests**
- [ ] POST returns version 1 and GET returns the stored version — validates AC-04.
- [ ] A conflict audit line carries both versions and no amount or description.
- [ ] The activity log still has one row per applied change and none per conflict — validates AC-01.
- [ ] 10,000 random operations with edits, deletes and stale attempts keep balances summing to 0.

**Completion criterion**
`pnpm --filter ./apps/api test` passes for the groups module and the routes expose version.

## Block 5 — Web API client for group changes

**Files**
- `apps/web/src/lib/api-client.ts` (modified) — `getGroupExpense`, `updateGroupExpense`,
  `deleteGroupExpense`, `getSettlement`, `updateSettlement`, `deleteSettlement`; the conflict error
  keeps the typed `current` record; add `GROUP_RECORD_CONFLICT` to the error key union.
- `apps/web/src/lib/api-client.test.ts` (modified).

**Logic**
A 409 with that code surfaces as a `conflict` outcome carrying `current`, not as a generic failure.

**Error handling**
- A 409 body that does not parse as `groupRecordConflictSchema` is treated as a generic server
  error, never as a conflict.

**Required tests**
- [ ] Update sends `baseVersion` in the body and delete sends it in the query.
- [ ] A 409 `GROUP_RECORD_CONFLICT` returns the conflict outcome with the server record — validates
      AC-02.
- [ ] A malformed 409 body is a failure, not a conflict — invalid input.
- [ ] A 404 stays "not found" and a 403 stays forbidden.

**Completion criterion**
Client tests pass and typecheck is green.

## Block 6 — Local group queue and atomic resolution

**Files**
- `apps/web/src/lib/local-store/database.ts` (modified) — `groupQueue` store, version 3 upgrade.
- `apps/web/src/lib/local-store/group-queue.ts` (new) — queue, fold rules, conflict marking,
  resolution.
- `apps/web/src/lib/local-store/group-queue.test.ts` (new).

**Logic**
A record is `{kind, id, groupId, operation: 'update' | 'delete', request?, base, revision,
conflict?: {server}}`. Editing again folds into the record and keeps the oldest base; a delete
replaces an update. `markConflict(record, server)` stores the server copy without removing the
local request (FR-01, FR-03). `keepMine` sets `base` to the server record, clears the conflict and
leaves the record queued, in one transaction. `keepServer` removes the record and writes the server
copy to the local cache, in one transaction. Both read and write in a single IndexedDB transaction,
so an interruption leaves the state before or after, never a state with neither version.

**Error handling**
- Marking a conflict on a record that changed meanwhile (revision differs) is refused and retried by
  the next pass.
- Resolving a record that has no conflict is refused.

**Required tests**
- [ ] A conflict keeps both the local request and the server record — validates AC-02.
- [ ] `keepMine` rebases the record onto the server version and queues it — validates AC-03.
- [ ] `keepServer` removes the local change and stores the server copy — validates AC-02.
- [ ] Resolving a record without a conflict is rejected — invalid input.
- [ ] Interrupting a resolution at a random point 1,000 times never leaves zero versions: after each
      interruption either both versions remain or the chosen one is stored — validates NFR-01.
- [ ] A queue record survives a reload of the database and a downgrade-free upgrade from version 2.

**Completion criterion**
Local-store tests pass, including the 1,000-interruption run.

## Block 7 — Sync pass and conflict state

**Files**
- `apps/web/src/lib/sync/sync-queue.ts`, `sync-pass.ts` (modified) — process group records, branch
  on the conflict outcome instead of `onRejected`.
- `apps/web/src/features/groups/sync-overlay.ts` (new) — `SyncState` for group records adding
  `conflict`.
- `apps/web/src/lib/sync/sync-events.ts` (modified) — queue-changed event covers group records.
- Tests beside each file.

**Logic**
A pass sends each unresolved group record with its `base.version`. A 409 conflict calls
`markConflict` and the pass continues; the record is skipped by later passes until resolved
(FR-01). The overlay maps a record with a conflict to `conflict`, a rejection to `failed`, a queued
record to `pending` and none to `synced` (FR-04, AC-05). The shell count reports conflicts apart
from failures.

**Error handling**
- Network and server errors keep the 04c backoff; a conflict is never retried automatically.
- A 404 on update becomes the failed reason "deleted on another device", as in 04c.

**Required tests**
- [ ] A 409 moves the record to conflict and later passes skip it — validates AC-01.
- [ ] A queued edit sends the base version of its record — validates AC-01.
- [ ] The overlay shows `conflict` for a record in conflict — validates AC-05.
- [ ] The overlay shows `synced` after `keepServer` and `pending` after `keepMine` — validates AC-03.
- [ ] A network error leaves the record queued and does not mark a conflict.
- [ ] A 404 fails the record with the deleted-elsewhere reason.

**Completion criterion**
Sync tests pass and the overlay type covers four states.

## Block 8 — Conflict resolution component

**Files**
- `apps/web/src/features/groups/components/group-conflict-view.tsx` (new) — presentational, pure.
- `apps/web/src/features/groups/containers/group-conflict-container.tsx` (new) — reads the record,
  calls `keepMine` / `keepServer`, triggers a pass.
- `apps/web/messages/es.json`, `en.json` (modified) — catalogs for labels.
- Tests beside each file.

**Logic**
Two columns, "Mine" and "Server's", showing amount, date, category, description and split for an
expense, or amount and date for a settlement, with the differing fields highlighted, and the two
buttons "Keep mine" and "Keep server's". No merge. Amounts go through the locale formatters; no
string is hardcoded.

**Error handling**
- If the record has no conflict the container renders nothing and reports it.
- A failed resolution shows the error and keeps both versions.

**Required tests**
- [ ] The view shows both versions side by side with both buttons — validates AC-02.
- [ ] "Keep mine" calls `keepMine` and requests a sync pass — validates AC-03.
- [ ] "Keep server's" calls `keepServer` — validates AC-02.
- [ ] A record without conflict renders nothing — invalid input.
- [ ] A rejected resolution keeps both versions on screen and shows an error.
- [ ] Catalog keys exist in Spanish and English.

**Completion criterion**
Component tests pass; coverage of the new web files is at least 90%.

## Final verification
- Migration listing tests updated for 0031 (`identity/migration`, `groups/migration`,
  `expenses-migration`, `settlements-migration`, `activity-log-migration`, `investments`,
  `price-migration`, `notices-migration`, `auto-recording-migration`,
  `credit-cards/automatic-debit-migration`) and the journal `when` above `main`'s maximum.
- Full suite and coverage thresholds pass; typecheck, eslint and Prettier on touched files pass.
- Every AC (AC-01 to AC-05) and NFR-01 has a test; every input has a sad-path test.
- Owner ratification items: D2 (required `baseVersion`, narrowing 05d last-write-wins), D5 (offline
  creation stays online-only), and that group screens are a separate ticket.

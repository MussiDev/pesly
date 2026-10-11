# Spec DISC-001-05d: Editing Rules and Activity Log

| Field | Value |
|-------|-------|
| Ticket | DISC-001-05d |
| PRD | docs/ddw/prd/prd-DISC-001-05d.md |
| Tier | FEATURE |
| Date | 2026-10-10 |
| Spec loops | 0 |
| Loops since last human decision | 0 |

## Summary
The `groups` module gains editing and deleting of group expenses and settlements under one
permission rule (the member who recorded it, or an admin), and a readable, immutable activity log.
An edit recomputes the shares with the allocation helpers of 05b and keeps the balances derived from
stored rows, so the zero-sum invariant of 05c holds with no extra code. Every edit and deletion
writes a log row with the values before and after in the same transaction. The log table gains two
`jsonb` snapshot columns and a database trigger that forbids updating or deleting a row while its
group exists. Members read the log through one paginated route; requests to change an entry answer
405. When the expense has a payer movement, the movement follows the expense in the same
transaction. No web screen is part of this ticket; completing it unblocks DISC-001-04e.

## Design decisions
- D1: Permission (FR-01). A record may be edited or deleted by the caller when the caller's member
  is `created_by_member_id`, or the caller is an admin. Any other member answers 403
  `GROUP_RECORD_EDIT_FORBIDDEN` and the record stays unchanged (AC-03, AC-04); a non-member, a user
  who left and a missing group, expense or settlement answer 404 (the order is group access first,
  then the record, then the permission). A record created by a ghost or by a member who left can
  therefore be changed only by an admin.
- D2: Editable fields. An expense edit is a full replacement of `amount`, `occurredAt`, `categoryId`,
  `description` and `split`, validated exactly like creation (05b D3, D4, D9, D13); currency, payer,
  `payerAccount` and the creator are not editable, and a body that names them is invalid (strict
  schema). A wrong currency or payer is fixed by deleting and recording again (open question 1). A
  settlement edit is a partial update of `amount` and `occurredAt` of a plain settlement (parties,
  currency and account are fixed); a consolidated settlement cannot be edited, only deleted
  (409 `GROUP_SETTLEMENT_CONSOLIDATED`), because its legs and rate describe two debts at once.
- D3: Effect on balances (FR-02, AC-05, AC-06). The group balances are derived on read from expenses,
  shares and settlement legs (05c D1), so replacing the rows is enough: an expense edit deletes and
  reinserts its shares in the expense's transaction; a settlement edit rewrites `amount` and its
  single leg; a deletion removes the row and its shares or legs by cascade. A settlement account
  balance follows the row (05c D5). No balance is stored, so none can drift.
- D4: Locks. An expense edit or deletion takes the group row `for share` and rechecks the involved
  members, like creation (05c D10), so it serialises with consolidated settlements (which take the
  group `for update`). A settlement edit or deletion takes the group `for update`. Member rows are
  locked `for share` in id order.
- D5: Former members. An edit or deletion that would change the balance of a member who left (the
  members in the stored split, the payer, or the parties of a settlement) answers 409
  `GROUP_RECORD_FORMER_MEMBER` and changes nothing, so no one who left at balance 0 is left with a
  debt. An edit may keep a former member's share only if that share is unchanged. Open question 2.
- D6: Payer movement (05b D6). When the expense has `payer_movement_id`, an edit rewrites that
  movement in the same transaction with the new amount, date (clamped like creation) and the
  description as note, on the same account and category; a deletion deletes the movement. Both run
  under the payer's own scope through new methods `update` and `remove` of the groups-side
  `PayerMovementRecorder` port, never under the editor's scope, so an admin editing another member's
  expense does not need access to that member's accounts. If the movement no longer exists
  (`payer_movement_id` is null) nothing is touched. Open question 3.
- D7: Activity log columns. `group_activity_log` gains `before jsonb null` and `after jsonb null` and
  its `action` check becomes (`expense_created`, `expense_updated`, `expense_deleted`,
  `settlement_created`, `settlement_updated`, `settlement_deleted`). Creation rows keep both columns
  null. An update row stores `before` and `after`; a deletion row stores `before` (the values it had)
  and a null `after` (FR-03, AC-08, AC-09). A snapshot of an expense is `{ amount, currency,
  occurredAt, categoryId, description, splitMode, payerMemberId, shares: [{ memberId, amount }] }`; of a
  settlement `{ fromMemberId, toMemberId, currency, amount, occurredAt, legs: [{ currency, amount }] }`.
  Every amount is a JSON string of an integer in minor units, never a JSON number, so there are no
  floats and no precision loss (NFR-02). The log row is written in the same transaction as the change,
  so no change exists without its entry (NFR-01).
- D8: Immutability (FR-05, NFR-01). A migration trigger `group_activity_log_immutable` runs before
  `update` and before `delete` on the table and raises an exception, except when the delete happens
  because the group no longer exists (cascade of a group deletion, which 05b already restricts while
  expenses exist). The application has no write path other than the insert in the transaction of a
  change. The routes `PUT`, `PATCH` and `DELETE` on `/groups/:id/activity/:entryId` answer 405
  `GROUP_ACTIVITY_LOG_IMMUTABLE` with an `Allow` header, for members, so the request is rejected
  with a stable code and the entry is unchanged (AC-11); non-members get 404.
- D9: Reading (FR-04, FR-06, AC-10, AC-12). `GET /groups/:id/activity` returns the entries newest
  first (`created_at desc, id desc`), keyset-paginated with `limit` (default 50, max 100) and an
  opaque cursor, to any active member of the group, each with `id`, `action`, `subjectType`
  (`expense` or `settlement`), `subjectId`, `memberId`, `createdAt`, `before`, `after`. The log of a
  deleted record stays readable. Filtering and searching are out of scope.
- D10: Editing does not conflict-check. Two members editing the same record at once: the last commit
  wins and the log keeps both changes with their before values; conflict handling for offline edits is
  DISC-001-04e. The group locks of D4 serialise the two writes, so each log row's `before` is the
  value the other left.
- D11: Routes. `PUT /groups/:id/expenses/:expenseId` (200 the expense), `DELETE
  /groups/:id/expenses/:expenseId` (204), `PATCH /groups/:id/settlements/:settlementId` (200 the
  settlement), `DELETE /groups/:id/settlements/:settlementId` (204), `GET /groups/:id/activity`, and
  the three 405 routes of D8. The `consolidation` preview route of 05c stays registered before the
  `:settlementId` routes.
- D12: Migration `0029_group_activity_log_changes`: adds the two `jsonb` columns, replaces the
  `action` check and creates the trigger and its function. Additive; rollback script
  `0029_group_activity_log_changes.down.sql` drops the trigger, the function and the columns,
  deletes the rows of the four new actions and restores the old check (destructive for change
  history only). Its journal `when` must exceed 1791670861757 (0028) and the maximum on `main` at
  merge.
- D13: No new runtime dependency; `domain` and `application` import nothing from infrastructure.

## Open questions for the owner
1. Currency and payer of an expense are not editable (D2); the way to fix them is delete and record
   again. Alternative: allow them, which needs the payer movement to move between accounts and users.
2. An edit or deletion touching a member who left is refused (D5). Alternative: allow it and let a
   former member carry a balance, which breaks the rule that members leave only at 0.
3. The payer's account movement is rewritten or deleted together with the expense (D6), overwriting a
   manual change the payer may have made to that movement.
4. Consolidated settlements can only be deleted, not edited (D2).
5. Concurrent edits are last-write-wins with both changes logged; offline conflicts are 04e (D10).

## Coverage: PRD → blocks
| Requirement | Covered by |
|---|---|
| FR-01 | Block 1, Block 3, Block 5 |
| FR-02 | Block 3, Block 4, Block 5 |
| FR-03 | Block 2, Block 3, Block 4 |
| FR-04 | Block 3, Block 4, Block 5 |
| FR-05 | Block 2, Block 5 |
| FR-06 | Block 3, Block 5 |
| NFR-01 | Block 2 (trigger), Block 4 (test over every write path) |
| NFR-02 | Block 1 (string amounts), Block 2 (no float column, introspection), Block 4 (snapshots) |

## Dependencies between blocks
Block 1 first (shared contract and codes). Then 2 → 3 → 4 → 5: migration, domain and use cases with
in-memory fakes, Drizzle adapters (Parts A and B can be built in parallel), routes and composition
root.

## Block 1 — Shared contract and error codes

**Files**
- `packages/shared/src/groups/activity.ts` (new) — Zod contract of D7 and D9.
- `packages/shared/src/groups/expense.ts` (modified) — `updateGroupExpenseRequestSchema` (D2).
- `packages/shared/src/groups/settlement.ts` (modified) — `updateSettlementRequestSchema` (D2).
- `packages/shared/src/errors.ts` (modified) — codes `GROUP_RECORD_EDIT_FORBIDDEN` (403),
  `GROUP_RECORD_FORMER_MEMBER` (409), `GROUP_SETTLEMENT_CONSOLIDATED` (409),
  `GROUP_ACTIVITY_LOG_IMMUTABLE` (405).
- `packages/shared/src/index.ts` (modified) — exports.
- `apps/api/src/shared/http/error-handler.ts` (modified) — status of the four codes (405 is new).
- `apps/web/src/lib/api-client.ts`, `apps/web/messages/en.json`, `apps/web/messages/es.json`
  (modified) — one message key per new code.
- `packages/shared/test/group-activity-schemas.test.ts`, `packages/shared/test/group-update-schemas.test.ts`
  (new); `apps/api/test/groups/error-status.test.ts` (modified).

**Logic**
Pure contract with no I/O. The expense update reuses the split contract of 05b; the settlement update
requires at least one of its two fields.

**Shared types**
- `updateGroupExpenseRequestSchema` `{ amount, occurredAt, categoryId, description, split }`, strict.
- `updateSettlementRequestSchema` `{ amount?, occurredAt? }`, strict, at least one key.
- `activityEntrySchema` `{ id, action, subjectType, subjectId, memberId, createdAt, before, after }`,
  `activityPageSchema` `{ items, nextCursor }`, `listActivityQuerySchema` `{ limit?, cursor? }`,
  `expenseSnapshotSchema`, `settlementSnapshotSchema` (amounts as integer strings).

**Input validation**
Strict objects; amounts positive minor-unit strings; description 1 to 200 characters; `limit` 1 to
100; opaque cursor string.

**Error handling**
- Shape errors — 400 `VALIDATION_FAILED` through the shared middleware.
- State errors (permission, former member, consolidated) are raised by Block 3.

**Required tests**
- [ ] An expense update with `currency`, `payerMemberId` or an extra key is invalid, a valid one
      parses — validates AC-07 (contract)
- [ ] A settlement update with no key, an amount of 0 or an extra key is invalid — validates AC-04 (contract)
- [ ] The snapshot and entry schemas accept integer-string amounts and reject a JSON number or a
      decimal string as invalid — validates NFR-02
- [ ] The four codes map to 403, 409, 409 and 405 and have message keys in both catalogs — validates AC-03, AC-11

**Completion criterion**
The shared tests pass and `pnpm typecheck` accepts the new message keys on the web side.

## Block 2 — Data model and migration

**Files**
- `apps/api/src/groups/infrastructure/db/schema.ts` (modified) — `before`, `after`, the action
  check and enum of `groupActivityLog`.
- `apps/api/drizzle/0029_group_activity_log_changes.sql` (generated and hand-edited for the trigger),
  `apps/api/drizzle/meta/*` (generated),
  `apps/api/drizzle/rollback/0029_group_activity_log_changes.down.sql` (new).
- `apps/api/test/groups/activity-log-migration.test.ts`,
  `apps/api/test/groups/activity-log-introspection.test.ts` (new); older migration tests and the
  erasure registries updated if the suite needs them.

**Logic**
Generated with drizzle-kit; the trigger function and trigger are appended by hand to the SQL file
and to the rollback. The journal `when` is checked against `main`.

**Data model**
- `group_activity_log.before` jsonb null, `group_activity_log.after` jsonb null.
- `action` check in (`expense_created`, `expense_updated`, `expense_deleted`, `settlement_created`,
  `settlement_updated`, `settlement_deleted`).
- Check: an `*_updated` row has `before` and `after` not null; an `*_deleted` row has `before` not
  null and `after` null; a `*_created` row has both null.
- Trigger `group_activity_log_immutable` (before update, before delete, per row): raises an exception
  unless the operation is a delete and the group row no longer exists.

**Error handling**
- An update or delete of a log row is rejected by the trigger with a database exception that the
  repository does not catch; a check violation surfaces as a database error.

**Required tests**
- [ ] The migration applies on an empty database and after the previous migrations; the rollback is
      idempotent and removes only what it added — validates NFR-01 (backstops exist)
- [ ] Introspection: the new columns are `jsonb`, 0 `real`, `double precision` or `numeric` columns
      in the table, the checks and the trigger exist — validates NFR-02
- [ ] An update of a log row fails with the trigger exception and the row is unchanged — validates AC-11
- [ ] A delete of a log row fails with the trigger exception while the group exists — validates AC-11
- [ ] Deleting a group that has log rows and nothing else removes the rows without error — validates NFR-01
- [ ] An `updated` row without `before` or `after`, and a `deleted` row with `after`, are rejected as
      a check violation — validates AC-08, AC-09
- [ ] The journal `when` is greater than 1791670861757

**Completion criterion**
The migration and introspection tests pass and `pnpm --filter ./apps/api typecheck` is clean.

## Block 3 — Domain and use cases

**Files**
- `apps/api/src/groups/domain/group-change.ts` (new) — permission rule (D1), former-member rule (D5),
  snapshot builders (D7), typed errors in `domain/errors.ts` (modified).
- `apps/api/src/groups/application/ports/group-expense-repository.ts`,
  `group-settlement-repository.ts`, `payer-movement-recorder.ts` (modified) — update and delete
  operations that take the change and its log entry; `ports/activity-log-reader.ts` (new).
- `apps/api/src/groups/application/update-group-expense.ts`, `delete-group-expense.ts`,
  `update-settlement.ts`, `delete-settlement.ts`, `list-activity.ts` (new);
  `record-group-expense.ts` (modified) — its allocation step is extracted so the edit reuses it.
- `apps/api/src/groups/index.ts` (modified) — barrel.
- `apps/api/test/groups/change-fakes.ts`, `apps/api/test/groups/change-use-cases.test.ts` (new).

**Logic**
Each use case calls `GroupAccess.member`, loads the record in that group (404 if missing), applies
D1, checks D5, builds the `before` snapshot and, for updates, the new rows and the `after` snapshot,
and hands one write to the repository, which also writes the log row (D7) and, for an expense with a
payer movement, updates or removes the movement (D6). `ListActivity` implements D9.

**Input validation**
Inputs arrive validated by the shared contract; the use cases re-check what needs state: the split
members and category (as creation), the former-member rule, the consolidated rule and the date limit.

**Error handling**
- Non-member, user who left, missing record — `ResourceNotFound` (404).
- Member without permission — `GROUP_RECORD_EDIT_FORBIDDEN` (403).
- Invalid split on an edit — the typed errors of 05b (`GROUP_SPLIT_*`, `GROUP_EXPENSE_CATEGORY_INVALID`).
- Record touching a member who left — `GROUP_RECORD_FORMER_MEMBER`; consolidated settlement edit —
  `GROUP_SETTLEMENT_CONSOLIDATED`.

**Required tests** *(in-memory fakes)*
- [ ] The member who recorded an expense edits it and deletes it — validates AC-01
- [ ] An admin who did not record a settlement edits it and deletes it — validates AC-02
- [ ] A member who is not the author or an admin editing or deleting an expense answers 403 and the
      expense is unchanged — validates AC-03
- [ ] A member who is not the author or an admin editing or deleting a settlement answers 403 and the
      settlement is unchanged — validates AC-04
- [ ] Editing 40,000.00 ARS to 60,000.00 ARS recomputes the shares and the balances — validates AC-05
- [ ] Deleting a settlement restores the balances to what they were before it — validates AC-06
- [ ] An edit with an invalid split is an error, nothing changes and no log row is written — validates AC-07
- [ ] An edit of an expense or a settlement adds a log entry with the action, the member, the instant
      of the clock and the before and after values — validates AC-08
- [ ] A deletion adds a log entry with the action, the member, the instant and the values it had —
      validates AC-09
- [ ] The log lists every entry newest first to any member, the log of a deleted record included —
      validates AC-10
- [ ] A non-member, or a user who left, reading the log or changing a record gets 404 — validates AC-12
- [ ] An edit or deletion touching a member who left answers 409 and nothing changes
- [ ] Editing a consolidated settlement answers 409; deleting it restores both currencies
- [ ] A payer movement follows an edit and is removed by a deletion; a null movement id touches nothing
- [ ] If the repository write fails, no change, log row or movement update remains — validates AC-08 (atomicity)
- [ ] 10,000 random operations (create, edit, delete, settle) keep the sum of balances at 0 in each
      currency — validates AC-05, AC-06

**Completion criterion**
The use-case tests pass with the fakes and the architecture-boundaries test still passes.

## Block 4 — Drizzle adapters

**Files**
- Part A: `apps/api/src/groups/infrastructure/db/drizzle-group-expense-repository.ts` (modified) —
  update and delete under the locks of D4, shares replaced, log row, payer movement sync;
  `apps/api/src/groups/infrastructure/movements/drizzle-payer-movement-recorder.ts` (modified) —
  `update` and `remove` under the payer's scope on the open transaction.
- Part B: `apps/api/src/groups/infrastructure/db/drizzle-group-settlement-repository.ts` (modified)
  — update and delete under the group `for update`; `apps/api/src/groups/infrastructure/db/
  drizzle-activity-log-reader.ts` (new) — keyset pagination.
- `apps/api/test/groups/drizzle-expense-changes.test.ts`, `drizzle-settlement-changes.test.ts`,
  `activity-log-reader.test.ts`, `activity-log-every-write-path.test.ts`,
  `balances-random-edits.test.ts` (new).

**Logic**
One transaction per change: take the locks, load the record, apply the change, replace shares or
legs, insert the log row with the snapshots and sync the payer movement. The log reader filters by
group id and orders by `(created_at desc, id desc)`.

**Error handling**
- A unique, check or foreign-key violation — mapped to the typed errors of Block 3.
- A failure inside the transaction — rolls back the change, the log row and the movement update; any
  other database failure is rethrown with no silent `catch`.

**Required tests**
- [ ] An expense edit replaces the shares and moves the group balances; the account of the payer
      follows the new amount — validates AC-05
- [ ] A settlement deletion restores the balances and the account balance — validates AC-06
- [ ] Each edit and deletion writes its log row with the stored before and after values, amounts as
      integer strings — validates AC-08, AC-09
- [ ] A forced failure after the log insert leaves the record, shares, movement and log unchanged —
      validates AC-08 (atomicity)
- [ ] The reader returns each entry once across pages, newest first, and nothing of other groups —
      validates AC-10, AC-12
- [ ] Table-driven test over every write path (create, edit, delete of expenses and settlements, the
      consolidated one included): each leaves exactly one log row of the right action — validates NFR-01
- [ ] A direct update or delete of a log row fails with the trigger exception — validates AC-11
- [ ] A constraint violation (a share for a member of another group) is an error mapped to the
      typed error — validates AC-07
- [ ] A failure inside the transaction is an error that rolls back every change, and any other
      database failure is rethrown — validates AC-08
- [ ] Concurrent edits of one expense by two admins serialise and keep both log rows with consistent
      before values — validates AC-08
- [ ] 10,000 random operations on PostgreSQL including edits and deletions leave the sum of balances
      at 0 in each currency — validates AC-05, AC-06

**Completion criterion**
The adapter tests pass against PostgreSQL (`127.0.0.1:5435`) and the accounts, movements and erasure
suites stay green.

## Block 5 — Routes and composition root

**Files**
- `apps/api/src/groups/infrastructure/http/group-routes.ts` (modified) — the routes of D11.
- `apps/api/src/groups/infrastructure/http/group-activity-presenter.ts` (new).
- `apps/api/src/server.ts` (modified only if the factory needs new dependencies).
- `apps/api/test/groups/group-change-routes.test.ts`, `apps/api/test/groups/change-audit.test.ts`
  (new).

**Logic**
Routes sit behind the `/groups` session and verified-email guards of 05a. The 405 handlers answer to
members only, after group access, so a non-member still gets 404.

**API contract**
- `PUT /groups/:id/expenses/:expenseId` — Request: body `updateGroupExpenseRequestSchema`. Response: 200, the expense.
- `DELETE /groups/:id/expenses/:expenseId` — 204.
- `PATCH /groups/:id/settlements/:settlementId` — body `updateSettlementRequestSchema`; 200 the settlement.
- `DELETE /groups/:id/settlements/:settlementId` — 204.
- `GET /groups/:id/activity` — query `listActivityQuerySchema`; 200 `activityPageSchema`.
- `PUT`, `PATCH`, `DELETE /groups/:id/activity/:entryId` — 405 `GROUP_ACTIVITY_LOG_IMMUTABLE`.
- Error codes: `VALIDATION_FAILED` and the 05b split codes 400, `GROUP_RECORD_EDIT_FORBIDDEN` 403,
  `GROUP_RECORD_FORMER_MEMBER` and `GROUP_SETTLEMENT_CONSOLIDATED` 409, 405 for the log, not found 404.
- Auth: session cookie and verified email; membership checked per group.

**Error handling**
- Errors reach the single error middleware; non-members, users who left and missing records answer 404.
- The audit lines for an edit or deletion carry the request id, the user id, the group id and the
  record id, never amounts or descriptions.

**Required tests**
- [ ] `PUT` and `DELETE` of an expense by its author answer 200 and 204 — validates AC-01
- [ ] `PATCH` and `DELETE` of a settlement by an admin who did not record it answer 200 and 204 —
      validates AC-02
- [ ] A member who is neither the author nor an admin gets 403 on the expense and the settlement
      routes and nothing changes — validates AC-03, AC-04
- [ ] `PUT` of 40,000.00 to 60,000.00 ARS moves the balances; deleting a settlement restores them —
      validates AC-05, AC-06
- [ ] `PUT` with a split that does not add up answers 400 and the expense is unchanged; an unknown
      key such as `currency` answers 400 — validates AC-07
- [ ] An edit and a deletion each add a log row visible in `GET activity` with the before and after
      values; the audit line has no amount — validates AC-08, AC-09
- [ ] `GET activity` shows every entry newest first to any member, with pagination — validates AC-10
- [ ] `PUT`, `PATCH` and `DELETE` on a log entry answer 405 to a member and the entry is unchanged —
      validates AC-11
- [ ] A non-member and a user who left get 404 on every route, and a missing record also gets 404 —
      validates AC-12
- [ ] A record touching a member who left answers 409; a consolidated settlement edit answers 409

**Completion criterion**
The route tests pass, the full API suite is green, and `pnpm lint`, `pnpm typecheck` and both builds
pass.

## Final verification
All 12 acceptance criteria have a test; every write path of expenses and settlements writes exactly one
log row in its transaction; the log rows cannot be updated or deleted while the group exists; no money
column or snapshot field is a float; the sum of balances is 0 after every operation including edits
and deletions; the full suite and the coverage floor (80% lines, branches and functions) hold; the
05a, 05b and 05c gotchas (erasure registries, `127.0.0.1` database, fresh `_test` database, migration
`when`) were applied.

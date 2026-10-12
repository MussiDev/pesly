# Spec DISC-001-05i: Send an Existing Movement to a Group

| Field | Value |
|-------|-------|
| Ticket | DISC-001-05i |
| PRD | docs/ddw/prd/prd-DISC-001-05i.md |
| Tier | FEATURE |
| Date | 2026-10-11 |
| Spec loops | 1 |
| Loops since last human decision | 0 |

## Summary
A person turns a personal expense movement into a group expense without retyping anything. The API gains one
endpoint, `POST /groups/:id/expenses/from-movement`, that creates the group expense adopting the movement
as the payer's account movement (no second movement), one migration (`0036_group_expense_from_movement`:
a unique index on the movement link, a marker `adopted_movement` on `group_expenses` and a marker
`from_movement` on `group_activity_log`), an edit lock on adopted movements inside the movements
repository, a detach-on-delete rule for adopted expenses and a note-preserving propagation rule for
adopted expenses. The web gains a "Send to group" icon action on each eligible row of the movements list
(next to edit and delete) with an "In group X" marker for linked rows, a send screen `/movements/send?id=`
where one tap chooses the group and the category and an equal split are preselected (at most 3 taps), a
notice and the locked fields on the edit screen (no action there), links from the home screen's recent
movements to `/movements?focus=<id>` that highlight the row in the list, the new error messages and the
"created from a movement" marker on the activity page; the list answer gains the group links of its rows. Owner decisions already taken (PRD Decision Log): deleting an
adopted expense detaches and keeps the movement; an expense edit carries amount and date but never the note;
amount, account and date of an adopted movement are locked with a 409; the creation log entry carries a
field; deleting the movement of an adopted expense nulls the link and keeps the expense. No new runtime
dependency. Money stays in `bigint` minor units and strings on the wire; no floating point anywhere.

## Decisions
- **D1 Endpoint shape.** `POST /groups/:id/expenses/from-movement`, body `{ movementId, categoryId,
  description?, split }`, answer 201 `groupExpenseResponseSchema`. The body names no amount, currency,
  date, account or payer: they come from the movement, and the strict schema rejects any such key. The
  payer is always the caller's own active member (PRD out of scope: another payer).
- **D2 Where the lock is taken (race safety).** Creation takes, in this order, the group row `for share`,
  the active members, the movement row `for update`, then inserts. This is the order `lockExpenseForChange`
  already uses (group, then movement, then expense), so no new deadlock cycle exists. Twenty concurrent sends
  of one movement serialise on the movement row: the first inserts, the other 19 read the link under the lock
  and answer 409 `GROUP_MOVEMENT_ALREADY_SENT`. The unique index is the second line: a unique violation on
  `group_expenses_payer_movement_unique` is mapped to the same 409.
- **D3 Edit lock lives in the movements repository, default on.** `DrizzleMovementRepository.update` reads
  the row `for update` inside its own transaction, and when a group expense with `adopted_movement` points at
  it, refuses a change of `amount`, `account_id` or `occurred_at` (instant equality in milliseconds) with
  `MovementLockedByGroupExpense` (409 `MOVEMENT_LOCKED_BY_GROUP_EXPENSE`). It is the only code path that
  updates a movement row (confirmed by reading the repository and the routes), so `PUT /movements/:id`,
  a queued edit replayed by the sync pass and the payer recorder all go through it. The lock is on by
  default; the one caller that must bypass it, the payer recorder applying an expense edit, passes
  `{ bypassGroupLock: true }` explicitly. Taking the lock and the check in one transaction closes the race
  between an edit that read the movement as free and a send that adopted it.
- **D4 Link read.** `GET /movements/:id` answers a detail shape: the movement plus `groupExpense: { groupId,
  expenseId, adopted } | null`. `GET /movements` (the list) keeps `movementResponseSchema` for its items and
  gains one sibling field, `groupLinks`, a record from movement id to the same link for the movements of
  that page that are linked (empty when none), read by one owner-scoped query for the page's ids. `PUT`,
  `POST` and the items themselves are unchanged, so the device copies and the offline queue are untouched.
  The group name is not sent: the web asks `getGroup` (edit screen) or `listGroups` (list, once, only when a
  page has a link) and shows a neutral text when the group is not visible (the person left it).
- **D5 Adopted marker and detach.** `group_expenses.adopted_movement` (boolean, default false) is set only
  by this endpoint. Delete of an adopted expense skips `PayerMovementRecorder.remove`: the expense row goes,
  the movement stays and is a plain personal expense again (the budget probe `not exists` finds no link).
  Delete of a non-adopted expense is unchanged (AC-31). Deleting the movement of an adopted expense sets the
  link to null through the existing `on delete set null`; the expense stays with `adopted_movement` true and
  no link, and a later delete of that expense touches no movement.
- **D6 Note is never propagated for adopted expenses.** `PayerMovementUpdate` gains `keepNote`, set from
  `stored.adopted_movement`; the recorder then writes the movement's own note back. Amount and date still
  propagate through `UpdateMovement` with the lock bypass, and the existing clamp to today applies. Rate,
  category, tags and account are untouched (as today).
- **D7 Activity marker.** `group_activity_log.from_movement` (boolean, default false, check: true only for
  `expense_created`). The creation log row is written in the same transaction with `from_movement` true.
  `activityEntrySchema` gains the required boolean `fromMovement`; the entry never names the movement, the
  account or its id (AC-18). The log keeps its immutability trigger: only an insert is added.
- **D8 Description.** When `description` is omitted the server derives it from the movement note: collapse
  whitespace, cut to 200 code points, validate with `groupExpenseDescriptionSchema`; a null, empty or
  invalid result is 400 `VALIDATION_FAILED` on `body.description` (AC-22). The web always sends the field it
  shows.
- **D9 New error codes.** `GROUP_MOVEMENT_NOT_EXPENSE` 400 (AC-03), `GROUP_MOVEMENT_ALREADY_SENT` 409 (AC-21,
  AC-23, AC-24), `MOVEMENT_LOCKED_BY_GROUP_EXPENSE` 409 (AC-25) and `GROUP_MOVEMENT_CHANGED` 409 (the movement's
  amount or date changed between the preview read and the lock; not in the PRD, flagged below). Every one
  carries only its code: no amount, account name or note (R-06 of the threat model).
- **D10 Eligibility, in the API.** Not found, another owner's movement and a movement whose account is not
  the caller's are the same `ResourceNotFound` (404, AC-32). A group the caller is not an active member of
  is 404 (AC-33), decided before the movement is read. Then: type must be `expense` (400, AC-03); a link
  already present is 409 (AC-21). Card installments are not movements; statement payments and automatic
  debits are transfers, so the type rule excludes them. Movements made by a recurring payment or a device
  are ordinary expenses and may be sent.
- **D11 Online only, request budgets (NFR-02, NFR-09).** The send screen loads `getMovement` and `listGroups`
  (2), then `getExpenseOptions(groupId)` once the group is chosen (1; with exactly one group it is chosen
  on load, so 3 loads in all), then one `sendMovementToGroup`: 4 requests in the best visit and no polling.
  The movements list adds at most 1 request (`listGroups`, only when a loaded row is linked); the home screen
  adds none. The action is not offered offline, for a movement with a queued change on the device, for a
  device-copy row or for one the server does not hold (AC-02, AC-04).
- **D12 Where the action lives (owner decision 2026-10-11).** There is no movement detail screen and the home
  rows are not clickable today. The action is an icon link on each eligible row of the movements list
  (`movement-row.tsx`, next to edit and delete, same `Link` and `buttonVariants` pattern, accessible name with
  the title); a linked row shows an "In group X" marker. The edit screen (`/movements/edit?id=`) shows only a
  notice and the locked fields. The send screen is `/movements/send?id=` (query-based like the edit screen).
- **D13 Reuse and no dependency.** The send form composes the 05f split components (`split-mode-picker`,
  `equal-split-fields`, `percentage-split-fields`, `exact-split-fields`, `split-summary`) and the shared
  `buildSplit`, `previewShares` and `initialSplitState`; `expense-form.tsx` is not edited.
- **D14 Erasure.** The migration adds columns only, so no new table references `users`. The erasure registry
  and `build-output.test.ts` table lists stay as they are, and a test asserts it (Block 2). Account erasure
  deletes the user's movements, which sets the link of an adopted expense to null (D5).

- **D15 Defaults for at most 3 taps (NFR-08).** Choosing a group is the only required tap: the group is
  preselected when the person has exactly one; the category is the group's active `other-expenses` default
  (else the first active one, else none and a field error); the description is the note cut to 200 code
  points; the split is `initialSplitState({ mode: 'equal' }, activeMemberIds, selfMemberId)`, equal among all
  active members and ignoring the group's own default split for the start (the editor offers percentage and
  exact; the group's default percentages apply there as in 05f). All defaults are visible before the confirm
  button. The category default is an assumption of this spec (the PRD leaves deriving it from the movement's
  own category out of scope), flagged below.
- **D16 List links, focus and home (FR-15 to FR-17).** The list container reads `focus`, accepts it only as a
  uuid, finds the row among the loaded ones (the first 100, plus the pages the person already opened) and
  marks it (`aria-current`, text, token ring, scroll and focus once); anything else leaves the list
  unmarked with no error, no request and no echo of the value. `parseFilters` and `serializeFilters` ignore
  `focus`. The home rows get a stretched `Link` to `/movements?focus=<id>`; the home container and read
  model do not change (the row id is already there, the five newest movements are inside page one).

- **D17 Decision Log (owner, 2026-10-11).** After reading the spec the owner changed the UX: the action is a
  list-row icon (not an edit-screen button), the send takes at most 3 taps with a preselected equal split, and
  the home recent rows link to the list with a highlight (PRD Decision Log, same date). The five earlier owner
  decisions (detach on delete, note never propagated, 409 lock, log field, null link on movement delete) are
  unchanged. This spec was revised once (Spec loops 1) and the loop counter since a human decision is 0.

Items for the owner (also in the final verification): (1) the group category preselected on the send screen
is "Other expenses" (D15), the one assumption added by the UX change; (2) `GROUP_MOVEMENT_CHANGED` is a fourth error code the PRD did not name (D9);
(3) the migration number 0036 is also taken by the open 06d branch, whichever merges second renumbers and
keeps its `when` above the other; (4) the rollback script detaches adopted expenses (Block 2) so rolled-back
code can never delete a personal movement; (5) an admin who edits another member's adopted expense changes
the payer's movement amount and date, the existing 05d rule that FR-11 keeps; (6) the movement's manual rate
stays editable on an adopted movement because the PRD locks only amount, account and date; (7) `fromMovement`
is a required field of the activity entry, so a web bundle cached before the deploy fails the strict parse
of the activity page until it reloads; (8) the focus highlight finds only loaded rows (D16).

## Coverage: PRD → blocks
| Requirement | Covered by |
|---|---|
| FR-01 | Block 8 (rule), Block 12 (icon), Block 9 (screen), Block 14 |
| FR-02 | Block 3, Block 5 (links in the list answer), Block 8, Block 12 |
| FR-03 | Block 8, Block 9 |
| FR-04 | Block 8, Block 9 |
| FR-05 | Block 3, Block 4, Block 6 |
| FR-06 | Block 4 (the link makes the budget probe skip the movement), Block 12 |
| FR-07 | Block 1, Block 2, Block 4, Block 11 |
| FR-08 | Block 1, Block 3, Block 4, Block 6 |
| FR-09 | Block 2, Block 4, Block 6 |
| FR-10 | Block 5, Block 7, Block 10 |
| FR-11 | Block 4 |
| FR-12 | Block 4 |
| FR-13 | Block 3, Block 5, Block 6 |
| FR-14 | Block 7, Block 9, Block 10, Block 11, Block 12, Block 13 (every string in the catalogs; Block 14 checks parity) |
| FR-15 | Block 10, Block 5 (the link read), Block 14 |
| FR-16 | Block 13 (home link), Block 12 (focus and highlight), Block 14 |
| FR-17 | Block 12, Block 14 |
| NFR-01 | Block 14: end-to-end test of the send screen, the list rows with icon and marker, the edit notice and the home rows at 360 px wide, asserting no horizontal scroll |
| NFR-02 | Strategy: the screen budget of D11 (2 requests, then 1, then 1 to send), asserted by a call-count unit test in Block 9 and again in the browser in Block 14 |
| NFR-03 | Block 4: integration test counting rows of `movements` before and after one send and 100 sends of 100 movements giving 100 distinct links |
| NFR-04 | Strategy: every web block adds Spanish and English keys together and the existing catalog parity test runs in Blocks 7, 9, 10, 11, 12, 13 and 14 |
| NFR-05 | Block 3 (1,000 random amounts through the use case with the shares adding up) and Block 14 (scan for float conversions in the new files) |
| NFR-06 | Block 4: integration test against PostgreSQL with 20 concurrent sends giving 1 success, 19 answers of 409, 1 expense and 1 log entry |
| NFR-07 | Block 4: table counts compared after each refusal kind (expense, shares, log, movement row) |
| NFR-08 | Block 14: end-to-end test that counts the interactions from the list to a recorded send (at most 3, or 2 with one group); defaults in Blocks 8 and 9 |
| NFR-09 | Block 12 (list requests, `focus` costs none) and Block 13 (home requests unchanged), counted by tests and again in Block 14 |
| Edit lock and link read (D3, D4) | Block 5 |
| Migration and rollback (D2, D5, D7) | Block 2 |

## Dependencies between blocks
Group A, in parallel and first: Block 1 (shared contracts and error codes) and Block 2 (migration and
schema). Group B, after group A: Block 3 needs Block 1; Block 5 needs Blocks 1 and 2; Blocks 7, 8 and 11 need
Block 1 only; Block 13 (home links) needs nothing from the others and can start at once (group A or B).
Group C: Block 4 needs Blocks 2, 3 and 5 (the recorder calls the lock bypass of Block 5); Block 9 needs
Blocks 7 and 8; Block 10 needs Block 7; Block 12 (list) needs Blocks 5, 7 and 8 (the `groupLinks` answer, the
client and `canOfferSendToGroup`). Group D: Block 6 needs Blocks 3 and 4. Group E: Block 14 is last and needs
all of them. Shared files and their single owner: `apps/api/src/groups/infrastructure/db/schema.ts`
(Block 2), `apps/api/src/groups/infrastructure/http/group-routes.ts` (Block 6),
`apps/api/src/shared/http/error-handler.ts` and `packages/shared/src/errors.ts` (Block 1),
`apps/web/src/lib/api-client.ts` (Block 7), `movement-row.tsx`, `movement-list.tsx` and
`movements-container.tsx` (Block 12), `recent-movements.tsx` (Block 13), `edit-movement-container.tsx` and
`movement-form.tsx` (Block 10). The catalogs `apps/web/messages/en.json` and `apps/web/messages/es.json` are
written by six blocks, each by targeted `Edit` insertion under its own namespace: `errors` (Block 7),
`movements.sendToGroup` (Block 9), `movements.edit` group keys (Block 10), `groups.activity` (Block 11),
`movements.list` keys (Block 12), `home.recent` key (Block 13). Blocks that must write the same JSON file take
turns at that step only.

| Block | Owns (parallel group) |
|---|---|
| 1 | `packages/shared/src/groups/*`, `movements/movement.ts`, `errors.ts`, api `error-handler.ts` (A) |
| 2 | `groups/infrastructure/db/schema.ts`, `apps/api/drizzle/*` (A) |
| 3 | `groups/domain`, `groups/application` (B) |
| 4 | `groups/infrastructure/db/*`, `groups/infrastructure/movements/*` (C) |
| 5 | `apps/api/src/movements/**` (B) |
| 6 | `groups/infrastructure/http/*` (D) |
| 7 | `apps/web/src/lib/api-client.ts`, `errors` catalog keys (B) |
| 8 | `apps/web/src/features/movements/send-to-group/*.ts` logic (B) |
| 9 | `apps/web/src/features/movements/send-to-group/*.tsx`, the send page (C) |
| 10 | `edit-movement-container.tsx`, `movement-form.tsx` (C) |
| 11 | `apps/web/src/features/groups/activity/*` (B) |
| 12 | `movement-row.tsx`, `movement-list.tsx`, `movements-container.tsx` (C) |
| 13 | `apps/web/src/features/home/components/recent-movements.tsx` (B) |
| 14 | `apps/web/e2e/*`, cross-cutting tests (E) |

## Block 1 — Shared contracts and error codes

**Files**
- `packages/shared/src/groups/expense.ts` (modified) — `sendMovementToGroupRequestSchema`.
- `packages/shared/src/groups/activity.ts` (modified) — `fromMovement` on `activityEntrySchema`.
- `packages/shared/src/movements/movement.ts` (modified) — `movementGroupLinkSchema`, `movementDetailResponseSchema` and `groupLinks` on `listMovementsResponseSchema`.
- `packages/shared/src/errors.ts` (modified) and `apps/api/src/shared/http/error-handler.ts` (modified) — the four codes of D9 and their statuses.
- `packages/shared/test/group-send-movement-schemas.test.ts` (new); `packages/shared/test/group-activity-schemas.test.ts` and `apps/api/test/groups/error-status.test.ts` (modified).

**Logic**
`sendMovementToGroupRequestSchema` is a `strictObject` of `movementId` (uuid), `categoryId` (uuid),
`description` (optional, `groupExpenseDescriptionSchema`) and `split` (`splitSchema`). `movementGroupLinkSchema`
is a strict object of `groupId` (uuid), `expenseId` (uuid) and `adopted` (boolean). `movementDetailResponseSchema`
is `movementResponseSchema.extend({ groupExpense: movementGroupLinkSchema.nullable() })`.
`listMovementsResponseSchema` gains `groupLinks: z.record(z.uuid(), movementGroupLinkSchema)` (empty when no
movement of the page is linked). `activityEntrySchema`
gains `fromMovement: z.boolean()`. The error handler maps `GROUP_MOVEMENT_NOT_EXPENSE` to 400 and the other
three to 409. All are exported through the existing barrel.

**Data model**
No stored data. Contract shapes only: `fromMovement` is a required boolean; `groupExpense` is nullable;
`description` is optional; every object is strict, so an unknown key is rejected.

**Input validation**
- The request body rejects any key beyond the four (an `amount`, `currency`, `occurredAt`, `accountId`,
  `payerMemberId` or `payerAccount` is an unknown key); ids must be UUIDs; the split keeps its 1 to 50 members rule.
- A description over 200 characters, empty, or with control characters is invalid.

**Error handling**
- A body that fails the schema is the existing 400 `VALIDATION_FAILED`; the new codes carry only their code,
  never an amount, a note or a name.

**Required tests**
- [ ] The request schema accepts a valid body with and without `description` — validates AC-12, AC-22.
- [ ] The request schema rejects an unknown key such as `amount`, `currency` or `payerAccount` — invalid input, validates AC-14.
- [ ] The request schema rejects a malformed `movementId`, an empty or 201-character description and a split with a duplicate member — validates AC-22, AC-20.
- [ ] The detail response schema accepts a null link and a link with `adopted` true, and rejects a link with a numeric id — invalid input.
- [ ] The list response schema accepts an empty `groupLinks` and one keyed by a movement uuid, and rejects a key that is not a uuid and a link with a missing `groupId` — invalid input, validates AC-05.
- [ ] The activity entry schema requires `fromMovement` and rejects an entry without it — validates AC-17, AC-18.
- [ ] Each new code answers its status over HTTP with a body equal to `{ code }` (400 for the type rule, 409 for the other three) — validates AC-03, AC-21, AC-25.

**Completion criterion**
The shared and error-status tests pass and `pnpm typecheck` is clean for `packages/shared` and `apps/api`.

## Block 2 — Data model and migration 0036

**Files**
- `apps/api/src/groups/infrastructure/db/schema.ts` (modified) — the three additions below.
- `apps/api/drizzle/0036_group_expense_from_movement.sql` (generated, then hand-edited for the pre-check), `apps/api/drizzle/meta/_journal.json` and `apps/api/drizzle/meta/0036_snapshot.json` (generated).
- `apps/api/drizzle/rollback/0036_group_expense_from_movement.down.sql` (new).
- `apps/api/test/groups/from-movement-migration.test.ts` (new), `apps/api/test/groups/expenses-schema-introspection.test.ts` and `apps/api/test/identity/user-erasure.test.ts` (modified only if a list changes).

**Logic**
Generate with `pnpm --filter ./apps/api db:generate`, then hand-edit the SQL to start with a pre-check that
aborts when any movement already has two expenses: a `DO $$` block that raises an exception when
`select payer_movement_id from group_expenses where payer_movement_id is not null group by payer_movement_id
having count(*) > 1` returns a row (none can exist by construction, each creation records its own movement;
the check states it). The journal entry is idx 36, tag `0036_group_expense_from_movement`, `when` 1791810000000,
which exceeds the maximum on `main` (1791790000000 for 0035) and the 1791800000000 of the open 06d branch
(Drizzle merge rule). The rollback script is idempotent and follows the style of `0035_*.down.sql`: it first
sets `payer_movement_id` to null on every adopted expense (so code from before this ticket can never delete a
personal movement through `PayerMovementRecorder.remove`; the budgets then count that movement fully and the
share again until the expense is deleted, which the plan states), drops the check and the two columns, drops the
unique index, recreates the plain `group_expenses_payer_movement_idx` of 0035, and deletes the journal row
`created_at = 1791810000000`. Rollback plan: take a backup, stop the API and the worker, run the script as a
whole (`psql -1 -f`), revert the commit that added the migration; apply it before the rollbacks of older
migrations.

**Data model**
- `group_expenses.adopted_movement` boolean, not null, default false. No check (the link can become null
  later, D5).
- `group_activity_log.from_movement` boolean, not null, default false; check
  `group_activity_log_from_movement_check`: `from_movement = false or action = 'expense_created'`.
- Unique partial index `group_expenses_payer_movement_unique` on `(payer_movement_id)` where
  `payer_movement_id is not null`; the plain partial index `group_expenses_payer_movement_idx` of 0035 is
  dropped in the same migration because the unique index serves the same budget probe. No new table, no new
  foreign key to `users`; no `real`, `double precision` or `numeric` column.

**Input validation**
- Not applicable to user input; the migration validates stored data with the pre-check above, and the check
  constraint rejects a marker on any action other than a creation.

**Error handling**
- A duplicate link found by the pre-check aborts the migration with a clear exception and changes nothing;
  an insert that breaks the unique index raises 23505, which Block 4 maps to the 409 of D2.

**Required tests**
- [ ] The migration applies on an empty database and on a copy of `main`'s schema, and the pre-check raises an error when two expenses share a movement (seeded before applying) — validates FR-09, NFR-06.
- [ ] Introspection: both columns are boolean not null with default false, the check and the unique partial index exist, the plain index is gone and no new column is `real`, `double precision` or `numeric` — validates FR-07, FR-09.
- [ ] Inserting two expenses with one `payer_movement_id` fails with a unique violation, and two expenses with a null link both insert — validates AC-24.
- [ ] A log row with `from_movement` true and action `expense_updated` is rejected by the check, and the immutability trigger still refuses update and delete of a log row — validates AC-17.
- [ ] The rollback script, run twice, detaches adopted expenses, restores the plain index, removes the columns and the journal row, and the migration applies again afterwards — validates AC-29.
- [ ] The journal `when` of 0036 is greater than 1791790000000 and 1791800000000, and no new table references `users` (the erasure registry lists are unchanged) — validates FR-09.

**Completion criterion**
The migration tests pass against PostgreSQL, `pnpm db:generate` shows no pending diff, and the rollback script
runs twice without error.

## Block 3 — Application layer: SendMovementToGroup, ports and errors

**Files**
- `apps/api/src/groups/domain/group-expense.ts` (modified) — `adoptedMovement` on `GroupExpense`; `GroupMovementNotExpense`, `GroupMovementAlreadySent`, `GroupMovementChanged`.
- `apps/api/src/groups/application/send-movement-to-group.ts` (new) — the use case.
- `apps/api/src/groups/application/ports/payer-movement-recorder.ts`, `group-expense-repository.ts`, `activity-log-reader.ts` (modified) — see Logic.
- `apps/api/src/groups/index.ts` (modified) — exports.
- `apps/api/test/groups/expense-fakes.ts` (modified) and `apps/api/test/groups/send-movement-use-case.test.ts` (new).

**Logic**
`PayerMovementRecorder` gains `peekAdoptable(userId, movementId)` returning `AdoptableMovement | null` (`id`,
`type`, `amount`, `currency` of the account, `occurredAt`, `note`, `linked` boolean) read under the user's
scope, `lockForAdoption(unit, userId, movementId)` (same shape, row `for update`) and `keepNote` on
`PayerMovementUpdate`. `NewGroupExpense` gains `adoptedMovement: { userId, movementId, expectedAmount,
expectedOccurredAt } | null` (mutually exclusive with `payerMovement`) and `NewExpenseActivity` gains
`fromMovement`. `SendMovementToGroup.execute(userId, groupId, data)`: (1) `GroupAccess.member`, 404 when not a
member; (2) `peekAdoptable`, null is `ResourceNotFound`; (3) type not expense is `GroupMovementNotExpense`;
`linked` is `GroupMovementAlreadySent`; (4) the group's active members must include every split member
(`GroupSplitMemberInvalid`), the category must be an unarchived one of the group
(`GroupExpenseCategoryInvalid`); (5) description from the request or derived (D8); (6) `allocateShares(amount,
callerMemberId, split, members)` with the movement's amount, so the shares add up to it (percentage and exact
mismatches throw the existing split errors); (7) `expenses.saveExpense` with `adoptedMovement` and
`activity: { action: 'expense_created', memberId, createdAt, fromMovement: true }`. The expense currency, amount
and date are the movement's.

**Input validation**
- The use case trusts the route's schema for shape and re-checks state: membership, movement ownership and
  type, link, category, split members and totals, description.

**Error handling**
- `ResourceNotFound` for a non-member, a missing movement and another user's movement (404, never 403).
- `GroupMovementNotExpense` (400), `GroupMovementAlreadySent` (409), and the existing category, split and
  validation errors; nothing is written when any of them is thrown.

**Required tests**
- [ ] A 40,000.00 ARS movement split equally among 4 members gives 4 shares of 10,000.00 and one expense linked to the movement — validates AC-12.
- [ ] Income, a transfer and an exchange are rejected with `GroupMovementNotExpense` and nothing is saved — validates AC-03.
- [ ] A movement that is already linked is rejected with `GroupMovementAlreadySent` — validates AC-21.
- [ ] A movement of another user, an unknown movement and a group where the caller is not a member are 404 and reveal nothing — validates AC-32, AC-33.
- [ ] A category of another group or archived is rejected, and a split naming a non-member is rejected — validates AC-19, AC-20.
- [ ] An omitted description is derived from the note cut to 200 characters; an empty or null note with no description is rejected as invalid — validates AC-07, AC-22.
- [ ] Percentages not totalling 100 and exact amounts not totalling the movement amount are rejected before any write — validates AC-11.
- [ ] 1,000 random amounts: the expense amount equals the movement amount and the shares add up to it, with bigint only — validates NFR-05.
- [ ] A refused send writes nothing in the fakes (no expense, share, log entry or movement change) — validates AC-14, NFR-07.

**Completion criterion**
The use-case tests pass and `pnpm typecheck` is clean; no infrastructure import exists in domain or application.

## Block 4 — Persistence adapters, propagation, detach and concurrency tests

**Files**
- `apps/api/src/groups/infrastructure/db/drizzle-group-expense-repository.ts` (modified) — adoption in `saveExpense`, `keepNote` and detach in update and delete, the new column in `expenseColumns`.
- `apps/api/src/groups/infrastructure/movements/drizzle-payer-movement-recorder.ts` (modified) — `peekAdoptable`, `lockForAdoption`, note-preserving `update` with the lock bypass.
- `apps/api/src/groups/infrastructure/db/drizzle-activity-log-reader.ts` and `apps/api/src/groups/infrastructure/http/group-activity-presenter.ts` (modified) — `fromMovement`.
- `apps/api/test/groups/send-movement-repository.test.ts` (new); `apps/api/test/groups/activity-log-every-write-path.test.ts`, `drizzle-group-expense-repository.test.ts` and `payer-movement-recorder.test.ts` (modified).

**Logic**
`saveExpense` with `adoptedMovement`: group row `for share`, active members, then `lockForAdoption` (movement
`for update` under the payer's own scope, joined to its account for the currency); null is `ResourceNotFound`;
an amount or date different from the expected ones is `GroupMovementChanged`; `linked` is
`GroupMovementAlreadySent`; then the expense insert sets `payer_movement_id`, `adopted_movement` true and the
shares, and the log row is inserted with `from_movement` true. A unique violation on
`group_expenses_payer_movement_unique` maps to `GroupMovementAlreadySent`. No movement row is inserted.
`updateExpense` passes `keepNote: stored.adoptedMovement`; the recorder writes the movement's own note back
and calls `UpdateMovement.execute(..., { bypassGroupLock: true })`. `deleteExpense` skips
`PayerMovementRecorder.remove` when `stored.adoptedMovement` is true and removes it otherwise (AC-31). The
activity reader selects `from_movement` and the presenter maps it to `fromMovement`; every log write of the
repository sets it explicitly.

**Data model**
- No new column or table: it writes the columns of Block 2 (`adopted_movement`, `from_movement`,
  `payer_movement_id`) and relies on the unique index `group_expenses_payer_movement_unique`; the movement row
  is never inserted or changed by a send (nullable link kept as `on delete set null`).

**Input validation**
- The repository trusts the use case for shape and re-checks state under lock: membership of every involved
  member, the movement's owner and its link, and the expected amount and date.

**Error handling**
- A lost race (link present under lock, or unique violation) is `GroupMovementAlreadySent` (409), a changed
  movement is `GroupMovementChanged` (409), a missing movement is `ResourceNotFound` (404); each rolls the
  whole transaction back.

**Required tests**
- [ ] A send creates 0 movement rows: the `movements` count before and after is equal, the balance of the account is unchanged and the category, note, tags and rate of the movement are unchanged — validates AC-13, NFR-03.
- [ ] 100 sends of 100 different movements leave 100 expenses with 100 distinct `payer_movement_id` and 100 log entries with `from_movement` true — validates NFR-03, AC-17.
- [ ] 20 concurrent sends of one movement give exactly 1 success and 19 answers of 409, 1 expense, 1 set of shares and 1 log entry, and 0 duplicate rows by counting rows — validates AC-24, NFR-06.
- [ ] A second send after a success answers 409 and creates nothing — validates AC-23.
- [ ] After each refusal kind (not an expense, already linked, invalid category, invalid split, changed movement, 404) the counts of expenses, shares, log rows and the movement row are equal to before — validates AC-14, NFR-07.
- [ ] The personal view and the budget spending read count only the share (10,000.00 of 40,000.00) and a receivable of 30,000.00, and the amount is counted once — validates AC-15, AC-16.
- [ ] An edit of an adopted expense moves the movement's amount and date and leaves its note, account, category, tags and rate as they were — validates AC-28.
- [ ] Deleting an adopted expense keeps the movement with its amount, account and note, the balance is unchanged, the budget counts it fully again and the deletion entry is written — validates AC-29, AC-30.
- [ ] Deleting a non-adopted expense still deletes its payer movement — validates AC-31.
- [ ] Deleting the movement of an adopted expense leaves the expense with a null link, and deleting that expense later touches no movement — conflict path of D5.
- [ ] "Every write path logs": a send leaves exactly one `expense_created` row with `from_movement` true, every other write path still leaves one row with it false — validates AC-17, AC-18.

**Completion criterion**
The repository, recorder and write-path tests pass against PostgreSQL, including the concurrency test run 3
times in a row without a failure.

## Block 5 — Movement edit lock and link read

**Files**
- `apps/api/src/movements/domain/errors.ts` (modified) — `MovementLockedByGroupExpense` (409 `MOVEMENT_LOCKED_BY_GROUP_EXPENSE`).
- `apps/api/src/movements/application/ports/movement-repository.ts`, `update-movement.ts` and `get-movement.ts` (modified) — `update(..., options?)`, `UpdateMovement.execute(..., options?)`, `groupLinks`.
- `apps/api/src/movements/infrastructure/db/drizzle-movement-repository.ts` and `foreign-relations.ts` (modified) — the lock inside the update transaction and the link query.
- `apps/api/src/movements/infrastructure/http/movement-routes.ts` and `movement-presenter.ts` (modified) — the detail answer for `GET /movements/:id` and `groupLinks` in the list answer.
- `apps/api/test/movements/edit-lock.test.ts` (new); `apps/api/test/movements/update-movement.test.ts` and `edit-delete-routes.test.ts` (modified).

**Logic**
`MovementRepository.update` takes an optional `{ bypassGroupLock?: boolean }`. Inside its transaction it
reads the row `for update` through the same scope; unless bypassed, when a `group_expenses` row with
`adopted_movement` true has `payer_movement_id` equal to the id, any difference in `amount`, `account_id` or
`occurred_at` throws `MovementLockedByGroupExpense` and nothing is written; category, note, tags and rate
changes are written as before. `groupLinks(scope, ids)` returns the link of each owned movement
(`groupId`, `expenseId`, `adopted`) from one query scoped by owner. `GetMovement` returns the movement and its
link; `GET /movements/:id` answers `movementDetailResponseSchema`; `ListMovements` also calls `groupLinks`
with the ids of the page (one query, no join in the list query) and the list answer carries them as
`groupLinks`; `PUT`, `POST`, the list items and the device replay keep their shapes. `foreign-relations.ts` re-exports `groupExpenses` from the groups schema, as the
budgets module does. `RecordDeviceMovement` is unchanged: a repeat of an id returns the stored movement and
writes nothing, so a replayed creation cannot bypass the lock.

**Data model**
- No column or table change: it reads `group_expenses.adopted_movement` and `payer_movement_id` (the unique
  partial index of Block 2 serves the lookup) and writes the same `movements` columns as before.

**API contract**
- `GET /movements/:id` — Request: params `movementIdParamsSchema`, no body. Response: 200
  `movementDetailResponseSchema` (the movement plus `groupExpense`).
- `GET /movements` — Request unchanged. Response: 200 `listMovementsResponseSchema` with the new `groupLinks`
  record (ids only, owner scope).
- `PUT /movements/:id` — Request and response unchanged (`updateMovementRequestSchema`,
  `movementResponseSchema`); new error `MOVEMENT_LOCKED_BY_GROUP_EXPENSE` 409.
- Error codes: `VALIDATION_FAILED` 400, `MOVEMENT_LOCKED_BY_GROUP_EXPENSE` 409, 404 for a missing movement or
  another user's, 401 with no session. Auth: session cookie and verified email, owner scope.

**Input validation**
- The params and the body keep their existing schemas; the lock compares only the values already validated
  by `buildNewMovement`, and instants are compared by their millisecond value.

**Error handling**
- A refused change answers 409 with only the code and writes nothing; a foreign or unknown id is 404 as before.

**Required tests**
- [ ] An edit changing the amount, the account or the date of an adopted movement answers 409 `MOVEMENT_LOCKED_BY_GROUP_EXPENSE` and changes nothing — validates AC-25.
- [ ] An edit changing only the category, the note or the tags of an adopted movement saves — validates AC-26.
- [ ] A movement linked to a non-adopted expense (created in the group) is not locked: its amount edit still saves — validates FR-10.
- [ ] A queued edit replayed through `PUT /movements/:id` with a locked field is refused with the same 409 (the sync pass stores a rejected change with that code) — validates AC-27.
- [ ] The bypass option lets the payer recorder change amount and date of an adopted movement — validates AC-28.
- [ ] A race: an edit and a send of one movement run at the same time, and either the send wins and the edit of the amount answers 409, or the edit wins and the send answers 409 `GROUP_MOVEMENT_CHANGED`, never a drift — validates AC-24, AC-25.
- [ ] `GET /movements/:id` returns `groupExpense: null` for a free movement, the link with `adopted` for a linked one, and 404 for another user's movement — validates AC-05, AC-32.
- [ ] A repeated device creation id returns the stored movement and does not change an adopted one — validates AC-25.
- [ ] `GET /movements` returns `groupLinks` with an entry only for the linked movements of that page (adopted and group-created), `{}` when none, no entry for another user's link, and makes at most one extra query — validates AC-05, NFR-09.

**Completion criterion**
The movements tests pass against PostgreSQL and the existing movements suite is green with the default lock on.

## Block 6 — Route for sending a movement

**Files**
- `apps/api/src/groups/infrastructure/http/group-routes.ts` (modified) — the new route and the use case wiring.
- `apps/api/test/groups/routes-harness.ts` (modified) and `apps/api/test/groups/send-movement-routes.test.ts` (new).

**Logic**
`POST /groups/:id/expenses/from-movement` is registered with the other expense routes behind `requireSession`
and `requireVerifiedEmail`, validated by `groupIdParamsSchema`, `sendMovementToGroupRequestSchema` and
`groupExpenseResponseSchema` through the shared validation middleware; the handler calls
`SendMovementToGroup.execute(userIdOf(auth), params.id, body)` and answers 201 with `presentGroupExpense`. The
audit line `group expense created from movement` carries ids only (request id, user id, group id, expense id),
never an amount, a description or the movement's note.

**API contract**
- `POST /groups/:id/expenses/from-movement` — Request: params `{ id }` (uuid), body
  `sendMovementToGroupRequestSchema`. Response: 201 `groupExpenseResponseSchema`.
- Error codes: `VALIDATION_FAILED` 400, `GROUP_MOVEMENT_NOT_EXPENSE` 400, `GROUP_EXPENSE_CATEGORY_INVALID` 400,
  `GROUP_SPLIT_*` 400, `GROUP_MOVEMENT_ALREADY_SENT` 409, `GROUP_MOVEMENT_CHANGED` 409, 404 (not a member,
  unknown or foreign movement), 401 with no session, 403 `EMAIL_NOT_VERIFIED`.
- Auth: session cookie and verified email; the group membership and the movement owner are checked inside the
  use case, and both failures answer 404.

**Input validation**
- Params and body go through the shared Zod schemas; no handler reads `req.body` unvalidated; a body that
  names `amount`, `currency`, `occurredAt`, `accountId` or `payerMemberId` is rejected as an unknown key.

**Error handling**
- Typed errors reach the existing error middleware and become the statuses of D9; a 404 never says whether
  the group or the movement was the missing part.

**Required tests**
- [ ] A member sends an expense movement: 201, the exact response shape with string amounts, `payerMovementId` equal to the movement id — validates AC-12, AC-13.
- [ ] Income, a transfer and an exchange answer 400 `GROUP_MOVEMENT_NOT_EXPENSE` — validates AC-03.
- [ ] A second send of the same movement answers 409 `GROUP_MOVEMENT_ALREADY_SENT` — validates AC-21, AC-23.
- [ ] Another user's movement and an unknown movement answer 404 with the same body — validates AC-32.
- [ ] A group that does not exist and a group the caller does not belong to answer 404 with the same body, never 403 — validates AC-33.
- [ ] A category not of the group or archived, a split with a non-member, a description of 201 characters or empty answer 400 with the right code — validates AC-19, AC-20, AC-22.
- [ ] A body with an `amount` key, a malformed id, or no session answers 400 or 401 and writes nothing — validates NFR-07.
- [ ] The response and the error bodies of a refusal contain no amount, note, account name or movement id beyond the code — validates AC-21, AC-25.
- [ ] The activity page of the group shows the creation entry with `fromMovement` true and no reference to the movement's account — validates AC-17, AC-18.

**Completion criterion**
The route tests pass and a manual `POST` against a local API with a seeded movement answers 201 once and 409 the
second time.

## Block 7 — Web api-client, error mapping and error messages

**Files**
- `apps/web/src/lib/api-client.ts` (modified) — `sendMovementToGroup`, `getMovement` returning the detail shape, the four codes in `MESSAGE_KEY_BY_CODE` and `ApiErrorKey`.
- `apps/web/messages/en.json` and `apps/web/messages/es.json` (modified) — the four `errors.*` keys, Spanish and English.
- `apps/web/test/api-client-send-movement.test.ts` (new).

**Logic**
`sendMovementToGroup(groupId, body)` goes through the group path helper with `refreshOnUnauthenticated: true`,
checks the body with `sendMovementToGroupRequestSchema` before sending (an invalid body is a local
`VALIDATION_FAILED` and sends no request) and validates the answer with `groupExpenseResponseSchema`.
`getMovement` validates with `movementDetailResponseSchema`; `listMovements` validates with the list schema
that now carries `groupLinks` and returns it to the callers. The codes map to `groupMovementNotExpense`,
`groupMovementAlreadySent`, `groupMovementChanged` and `movementLockedByGroupExpense`, which the movement
sync overlay already shows through `messageKeyOf`, so a queued edit refused by the lock is a failed row with
that message and the discard action.

**Data model**
- No stored data: contract shapes only. The client schemas are the shared strict ones of Block 1 (`groupExpense` is nullable, `groupLinks` is a required record that is empty and never null, ids are uuids) (`sendMovementToGroupRequestSchema`, `movementDetailResponseSchema`, the list schema with `groupLinks`); nothing is persisted on the device by this block.

**Input validation**
- The group id goes through `resourcePath`; the body is checked locally with the shared schema; a response
  that does not match the schema is a generic failure, never partial data.

**Error handling**
- A 409 lock answer is `ok: false` with the code and its message key; a 404 is `NOT_FOUND`; a 401 is retried once
  through the existing refresh.

**Required tests**
- [ ] `sendMovementToGroup` posts to `/groups/:id/expenses/from-movement` with the body and returns the expense — validates AC-12.
- [ ] A body with an extra key or a malformed movement id is rejected locally and sends no request — invalid input.
- [ ] A 409 `GROUP_MOVEMENT_ALREADY_SENT` and a 409 `MOVEMENT_LOCKED_BY_GROUP_EXPENSE` come back with their message keys — validates AC-21, AC-25.
- [ ] A queued movement edit rejected with the lock code is shown as a failed change with that message and the discard action — validates AC-27.
- [ ] A 404 is `NOT_FOUND` and a response with a numeric amount is a failure with no data — validates AC-32.
- [ ] `listMovements` returns the `groupLinks` of the answer, and an answer whose `groupLinks` has a malformed link is a failure with no data — validates AC-05.
- [ ] The Spanish and English catalogs have the four new keys, none empty (the parity test) — validates AC-34, NFR-04.

**Completion criterion**
The api-client tests and the catalog parity test pass and typecheck is clean.

## Block 8 — Web pure logic for the send screen

**Files**
- `apps/web/src/features/movements/send-to-group/eligibility.ts` (new) — `canOfferSendToGroup`.
- `apps/web/src/features/movements/send-to-group/send-defaults.ts` (new) — `pickOnlyGroup`, `defaultCategoryId`, `defaultSendSplit`.
- `apps/web/src/features/movements/send-to-group/send-request.ts` (new) — `descriptionFromNote`, `buildSendRequest`, field errors.
- `apps/web/test/send-to-group-logic.test.ts` and `apps/web/test/send-to-group-logic.property.test.ts` (new).

**Logic**
`canOfferSendToGroup({ movement, groupExpense, queued, online })` is true only when the device is online, the
movement is an expense that the server holds (`queued` false, and the row is not a device copy), and
`groupExpense` is null (AC-01 to AC-05). `pickOnlyGroup(groups)` returns the id when the person has exactly one
group and `undefined` otherwise (AC-35). `defaultCategoryId(categories)` returns the id of the active category
whose `defaultKey` is `other-expenses`, else the first active category in the order the options answer gives,
else an empty string (AC-07, D15). `defaultSendSplit(options)` returns `initialSplitState({ mode: 'equal' },
activeMemberIds, options.selfMemberId)` from the 05f `expense-request.ts`: equal, every active member checked,
the group's own default split ignored for the start (AC-36). `descriptionFromNote(note)` collapses whitespace
and cuts to 200 code points with `Array.from`, so a note with line breaks or an emoji never breaks the limit
(AC-07). `buildSendRequest(values, context)` returns the `SendMovementToGroupRequest` or a field-errors
object: the category must be chosen and the description non-empty (AC-09), and the split is built with the
shared `buildSplit` against the movement's amount, so percentages not totalling 100 and exact amounts not
totalling the amount are field errors (AC-10, AC-11); the amount is the movement's `bigint`, shown with the
locale formatter and never parsed back from text.

**Input validation**
- The typed description, the chosen category and the split fields; the movement amount is never read from a
  text field. A body is built only when there are no field errors.

**Error handling**
- Every failure is a catalog path in a field-errors object, never a thrown error; a form with errors builds no
  request.

**Required tests**
- [ ] The action is offered for an online, server-held, unlinked expense — validates AC-01.
- [ ] The action is not offered offline, for income, a transfer or an exchange, for a queued movement, for a device-copy row and for a linked one — invalid states, validates AC-02, AC-03, AC-04, AC-05.
- [ ] `pickOnlyGroup` returns the id for one group and `undefined` for none and for two or more — validates AC-35.
- [ ] `defaultCategoryId` picks `other-expenses` when active, the first active category when it is archived or missing, and an empty string when there is none — validates AC-07.
- [ ] `defaultSendSplit` is equal with every active member checked, also when the group's default split is percentage, and builds a request that splits 40,000.00 ARS into 4 shares of 10,000.00 — validates AC-36, AC-12.
- [ ] A note of 500 characters, with line breaks and emoji, becomes a description of at most 200 code points — validates AC-07.
- [ ] An empty description or a cleared category is a field error and builds no request — validates AC-09.
- [ ] Percentages totalling 99 and exact amounts that differ from the movement amount are field errors with no request — validates AC-11.
- [ ] The default values alone build a valid request with the movement id and no amount, currency, date or payer — validates AC-37.
- [ ] 1,000 random amounts: the built split adds up to the amount with no `number` on the path — validates NFR-05.

**Completion criterion**
The logic and property tests pass and typecheck is clean.

## Block 9 — Web send screen

**Files**
- `apps/web/src/features/movements/send-to-group/send-to-group-container.tsx` (new) — loads, preselects, sends.
- `apps/web/src/features/movements/send-to-group/send-to-group-form.tsx` (new) — presentational: group chooser, category, description, split summary, the split editor and the confirm button; it composes the 05f split components.
- `apps/web/src/app/[locale]/(app)/movements/send/page.tsx` (new) — `/movements/send?id=` inside `Suspense`.
- `apps/web/messages/en.json` and `apps/web/messages/es.json` (modified) — the `movements.sendToGroup` namespace.
- `apps/web/test/send-to-group-container.test.tsx` (new).

**Logic**
The container reads `id` from the query and calls `getMovement` and `listGroups` in parallel (2 requests). It
shows the amount, currency and date as text from the locale formatters and the groups as a list of buttons
(a radio group: one tap chooses one, `aria-checked`). When `pickOnlyGroup` returns an id, that group is
chosen with no tap. The container calls `getExpenseOptions(groupId)` once per chosen group (1 request) and then
preselects the category (`defaultCategoryId`), the description (`descriptionFromNote`) and the split
(`defaultSendSplit`, equal among all active members). The form shows them as visible text and fields before
the confirm button: the category select, the description field and a split summary ("Equal among 4
members: 10,000.00 ARS each"). A "Change split" button opens the 05f split editor (`split-mode-picker` and the
three field components), which edits the same state. The confirm button ("Send to group") calls
`buildSendRequest` and then `sendMovementToGroup` (1 request) and on success goes to the group's expense list;
it is disabled while the request runs. With the default values the path from the list is the icon (tap 1), the
group (tap 2) and the confirm button (tap 3), or 2 taps with one group (NFR-08). The page shows "needs a
connection" offline, "not found or not synced yet" for a 404, "already sent to a group" when the link
exists, and a link to the groups list when the person belongs to none (AC-08). The form is a presentational
component with no data fetching; field errors move focus to the first invalid field. Every string is a
catalog key.

Strings (`movements.sendToGroup`, English / Spanish): `title` "Send to a group" / "Enviar a un grupo";
`chooseGroup` "Choose a group" / "Elige un grupo"; `category` "Group category" / "Categoría del grupo";
`description` "Description" / "Descripción"; `splitSummary` "Equal among {count} members: {each} each" /
"En partes iguales entre {count} miembros: {each} cada uno"; `changeSplit` "Change split" / "Cambiar el
reparto"; `confirm` "Send to group" / "Enviar al grupo"; `offline` "Sending to a group needs a connection" /
"Enviar a un grupo requiere conexión"; `notFound` "Movement not found or not synced yet" / "No encontramos el
movimiento o todavía no se sincronizó"; `alreadySent` "This movement was already sent to a group" / "Este
movimiento ya se envió a un grupo"; `noGroups` "You do not belong to any group yet" / "Todavía no
perteneces a ningún grupo"; `goToGroups` "Go to groups" / "Ir a grupos".

**Input validation**
- The query `id` is checked with a `z.uuid()` schema (as `edit-movement-route-container.tsx` does) before
  any request; a malformed id renders the not-found state and sends none. The form fields are validated by
  Block 8 before sending, and the server validates again.

**Error handling**
- A 409 shows the specific message and the screen stays; a 404 shows the not-found state; any other failure
  keeps the typed values for retry; a 401 goes to sign-in.

**Required tests**
- [ ] The screen shows the movement's amount, currency and date as text and lists the groups — validates AC-06.
- [ ] Choosing a group with one tap lists its categories with "Other expenses" chosen and prefills the description from the note cut to 200 characters — validates AC-07.
- [ ] A person with one group sees it chosen with its options loaded and no tap — validates AC-35.
- [ ] A person with no group sees the empty message and the link to the groups list — validates AC-08.
- [ ] With a group chosen the split summary shows equal among all active members, and one tap on the confirm button sends the request with that split and nothing else typed — validates AC-36, AC-37.
- [ ] Opening the split editor and changing to percentage or exact sends the changed split; a total mismatch blocks the submit — validates AC-10, AC-11, AC-38.
- [ ] A submit with an empty description or a cleared category shows the field errors and sends nothing — invalid input, validates AC-09.
- [ ] The screen makes at most 2 requests before a group is chosen, 1 after (3 loads with one group) and exactly 1 to send — validates NFR-02.
- [ ] Offline, the screen offers no form and says that sending needs a connection — validates AC-02.
- [ ] A 409 `GROUP_MOVEMENT_ALREADY_SENT` and a 404 show their messages in Spanish and in English, with no amount or account name in the error text — validates AC-21, AC-34.
- [ ] The Spanish and English catalogs have 0 missing or empty keys for `movements.sendToGroup` — validates NFR-04, AC-34.

**Completion criterion**
The container tests pass, the design-system scan finds no hardcoded color or string, and typecheck is clean.

## Block 10 — Web edit screen: link notice and locked fields

**Files**
- `apps/web/src/features/movements/containers/edit-movement-container.tsx` (modified) — keeps the link from `getMovement` and shows the notice.
- `apps/web/src/features/movements/components/movement-form.tsx` (modified) — a `lockedFields` prop that shows amount, account and date as read-only text, and a `groupNotice` slot.
- `apps/web/messages/en.json` and `apps/web/messages/es.json` (modified) — group keys under `movements.edit`.
- `apps/web/test/edit-movement-group-notice.test.tsx` (new).

**Logic**
The edit screen carries no "Send to group" action (D12). `EditMovementContainer` keeps `groupExpense` from the
detail answer. With a link it calls `getGroup(groupId)` once and shows a notice "This movement belongs to an
expense in {group}" (or the neutral text when that answers 404). When `adopted` is true the notice adds "Amount,
account and date are locked; change them from the group expense" and the container passes `lockedFields` so
those three show as read-only text, while category, note and tags stay editable (AC-26, AC-39). When the link is
not adopted (an expense created in the group) the notice shows and every field stays editable (AC-40). Copies
read from the device and queued creations have no link and show no notice.

Strings (`movements.edit`, English / Spanish): `groupNotice` "This movement belongs to an expense in {group}" /
"Este movimiento pertenece a un gasto de {group}"; `groupNoticeUnknown` "This movement belongs to a group
expense" / "Este movimiento pertenece a un gasto de grupo"; `lockedFields` "Amount, account and date are
locked; change them from the group expense" / "El monto, la cuenta y la fecha están bloqueados; cámbialos desde
el gasto del grupo".

**Input validation**
- The form keeps its existing field validation; locked fields are not part of the typed input, and the
  request built for a locked movement carries the stored amount, account and date unchanged.

**Error handling**
- A 409 `MOVEMENT_LOCKED_BY_GROUP_EXPENSE` on save (the link appeared after the screen loaded) shows its
  message and keeps the typed values; the queued path is covered by the failed-change overlay of Block 7.

**Required tests**
- [ ] The edit screen of a free movement shows no notice and no "Send to group" action — validates AC-01 (the action lives only in the list).
- [ ] An adopted movement shows the notice with the group name, or the neutral text when the group answers 404, and names the locked fields — validates AC-39.
- [ ] A movement linked to a group-created expense shows the notice and every field stays editable — validates AC-40.
- [ ] For an adopted movement amount, account and date are read-only and category, note and tags save — validates AC-26.
- [ ] A save refused with a 409 lock keeps the typed values and shows the message in Spanish and English — validates AC-25, AC-34.
- [ ] 360 px layout: the notice and the read-only fields do not overflow (checked in Block 14) and the new keys have no missing or empty value — validates NFR-04.

**Completion criterion**
The edit-screen tests pass and the existing movement edit tests are green.

## Block 11 — Web activity marker

**Files**
- `apps/web/src/features/groups/activity/activity-view.ts` (modified) — `fromMovement` on `ActivityRowView`.
- `apps/web/src/features/groups/activity/activity-entry.tsx` (modified) — the marker text.
- `apps/web/messages/en.json` and `apps/web/messages/es.json` (modified) — `groups.activity.fromMovement`.
- `apps/web/test/group-activity-from-movement.test.tsx` (new); `apps/web/test/group-activity-view.test.ts` (modified if it builds entries).

**Logic**
`buildActivityView` copies `entry.fromMovement` to the row; `activity-entry.tsx` shows the catalog text
"created from a movement" next to a `expense_created` row when it is true, as text and not as a colour only.
It never shows an account, a movement id or an amount from the movement beyond what the creation entry already
shows (a creation carries no snapshot).

**Input validation**
- The entry is parsed by `activityPageSchema` in the api-client (`fromMovement` required boolean); a value
  that is not a boolean fails the parse and shows the generic failure state.

**Error handling**
- A page that fails the parse shows the existing generic failure with retry and never partial rows.

**Required tests**
- [ ] A creation entry with `fromMovement` true shows the marker and one with false does not — validates AC-18.
- [ ] The marker text appears in Spanish and in English and names no account or movement id — validates AC-18, AC-34.
- [ ] An entry whose `fromMovement` is missing or not a boolean fails the parse and shows the failure state — invalid input.
- [ ] The Spanish and English catalogs have the new key, none empty — validates NFR-04.

**Completion criterion**
The activity tests pass and the existing 05h activity tests are green.

## Block 12 — Web movements list: send icon, group marker and focus highlight

**Files**
- `apps/web/src/features/movements/components/movement-row.tsx` (modified) — a `groupAction` prop (`{ kind: 'send' }` or `{ kind: 'linked'; groupName: string | undefined }`) and a `highlighted` prop; the icon link, the marker and the highlight.
- `apps/web/src/features/movements/components/movement-list.tsx` (modified) — `groupAction` on `MovementListItem` and a `focusId` prop passed to the matching row.
- `apps/web/src/features/movements/containers/movements-container.tsx` (modified) — reads `focus`, keeps the `groupLinks` of the list answer, loads the person's groups when needed and computes each row's `groupAction`.
- `apps/web/messages/en.json` and `apps/web/messages/es.json` (modified) — `movements.list.actions.sendToGroup`, `movements.list.inGroup`, `movements.list.inGroupUnknown`, `movements.list.highlighted`.
- `apps/web/test/movement-row-send-to-group.test.tsx` and `apps/web/test/movements-container-focus.test.tsx` (new); `apps/web/test/movement-list.test.tsx` and `apps/web/test/movements-container.test.tsx` (modified if they build rows or count requests).

**Logic**
The container computes, per loaded movement, `groupAction`: `{ kind: 'linked', groupName }` when
`groupLinks[movement.id]` exists (the name comes from `listGroups`, `undefined` when the group is not among
the person's groups, AC-05), `{ kind: 'send' }` when `canOfferSendToGroup` is true (online, the list is the
server's and not the device copy, the row has no `syncState` of pending or failed, no link) and nothing
otherwise. `listGroups` runs once, online only, and only when the loaded page has at least one link (NFR-09);
a failure of it leaves the markers neutral ("In a group") and never blocks the list. `MovementRow` renders
the send action as a `Link` to `/movements/send?id=<id>` styled with `buttonVariants({ size: 'icon', variant:
'ghost' })` and a `Users` icon, placed before the edit link, with `title` and an `sr-only` name
"{Send to group} {title}" (the same pattern as the edit link; no nested interactive element), and the
marker as a `p` "In group {name}" under the note. Neither shows while a delete confirmation is open or for a
failed delete, like edit.

Focus: the container reads `focus` from `useSearchParams`, accepts it only when `z.uuid()` passes (never
rendered, never sent to the API, AC-44) and passes it as `focusId`. `parseFilters` and `serializeFilters`
ignore the key, so it never counts as a filter, and the first filter change rewrites the address without it.
When the list settles and a row with that id exists, that row gets `highlighted`: `aria-current="true"`, a
token-based ring and an `sr-only` "Selected movement" text (not color alone, AC-42), `tabIndex={-1}`, and once
per `focusId` an effect calls `scrollIntoView({ block: 'center' })` (with `behavior: 'auto'` under
`prefers-reduced-motion`) and `focus({ preventScroll: true })` (AC-41). A valid id that is not among the loaded
rows (deleted, another user's, beyond the first 100, hidden by a search) highlights nothing and shows no error
and no extra request (AC-43). The same row actions exist on the focused row (AC-41). Files shared with other
blocks: none beyond the catalogs; this block is the single owner of the three list files.

Strings (English / Spanish): `movements.list.actions.sendToGroup` "Send to group" / "Enviar a un grupo";
`movements.list.inGroup` "In group {name}" / "En el grupo {name}"; `movements.list.inGroupUnknown` "In a group" /
"En un grupo"; `movements.list.highlighted` "Selected movement" / "Movimiento seleccionado".

**Input validation**
- `focus` is parsed with `z.uuid()` and used only to compare with loaded ids; the group names are rendered
  as React text; the link target is built from the movement's own id.

**Error handling**
- `listGroups` failing keeps the list and shows neutral markers; a `focus` that matches nothing is no
  error; a list that fails to load shows its existing failure state.

**Required tests**
- [ ] An eligible online expense row shows the send icon link to `/movements/send?id=` with an accessible name that includes the title, next to edit and delete — validates AC-01.
- [ ] No icon offline, from the device copy, for income, a transfer, an exchange, a queued or failed row, and for a linked row — invalid states, validates AC-02, AC-03, AC-04.
- [ ] A linked row shows "In group {name}", and "In a group" when the group is not among the person's groups or `listGroups` fails — validates AC-05.
- [ ] `listGroups` is requested once when a loaded row is linked and never when none is; opening with `?focus=` makes the same requests as without it — validates NFR-09.
- [ ] `?focus=<id of a loaded row>` marks that row (`aria-current`, the text "Selected movement"), calls `scrollIntoView` and focuses it once, and its row actions work — validates AC-41, AC-42.
- [ ] `?focus=` with a valid id that is not loaded, and with a malformed value (`abc`, a script tag), shows the list with no highlight, no alert and no rendering of the value — validates AC-43, AC-44.
- [ ] A filter change drops `focus` from the address and keeps the filters — validates FR-17.
- [ ] 360 px: a row with the three icons, the marker and a long title wraps without overflow (checked in Block 14); the four new keys exist in both catalogs, none empty — validates NFR-01, NFR-04, AC-34.

**Completion criterion**
The list tests pass, the existing movements list and container tests are green, and typecheck is clean.

## Block 13 — Web home: recent movements as links

**Files**
- `apps/web/src/features/home/components/recent-movements.tsx` (modified) — each row becomes a link.
- `apps/web/messages/en.json` and `apps/web/messages/es.json` (modified) — `home.recent.openInMovements`.
- `apps/web/test/home-recent-movements-link.test.tsx` (new); `apps/web/test/home-screen.test.tsx` and `apps/web/test/home-container.test.tsx` (modified only if they query the rows).

**Logic**
Each row keeps `ListRow` (`as="li"`, `interactive`, `relative`) and its title becomes one `Link` to
`/movements?focus=<item.id>` with a stretched hit area (`after:absolute after:inset-0`), so the whole row is
the link and there is exactly one interactive element per row; the amount and date stay plain text inside the
row. The link's accessible name is the row title plus an `sr-only` "Open in movements" (the amount stays
readable in the row). There is no change to `home-container.tsx`, `RecentMovementItem` (it already carries
`id`) or the home requests (NFR-09: 0 more); the five newest movements are inside the list's first page.
Strings: `home.recent.openInMovements` "Open in movements" / "Abrir en movimientos".

**Input validation**
- The id in the address comes from the API's own movement id and is URL-encoded by building the target with
  `encodeURIComponent`; nothing the user typed reaches the address.

**Error handling**
- The link is a plain navigation that adds no request and no state; an id the list cannot find is dealt with by Block 12 (AC-43). A home row whose test finds the list unreachable is covered by the existing home error state.

**Required tests**
- [ ] Each row renders one link to `/movements?focus=<id>` whose accessible name includes the title and "Open in movements", and the row holds no other link or button — validates AC-41, AC-42.
- [ ] The row link is reachable and activated by keyboard (Tab, Enter) — validates AC-42.
- [ ] A row with a note, one without, and one with an unknown account all link and keep their amount and date text — validates AC-41.
- [ ] The empty state is unchanged and the home screen makes the same number of requests as before — validates NFR-09.
- [ ] When the home requests fail, the existing error state shows and no row link renders — error path unchanged, validates NFR-09.
- [ ] The new key exists in both catalogs, none empty — validates NFR-04, AC-34.

**Completion criterion**
The home tests pass, the existing home tests are green and typecheck is clean.

## Block 14 — End-to-end checks and cross-cutting scans

**Files**
- `apps/web/e2e/movement-to-group.spec.ts` (new) — the browser flows.
- `apps/web/test/send-to-group-scans.test.ts` (new) — scans over the new folders and the touched files.
- `apps/api/test/groups/send-movement-http-flow.test.ts` (new) — the whole path over HTTP with a real database.

**Logic**
The end-to-end spec seeds a user with an ARS account, an expense movement and a group of 4, then: opens the
movements list, taps the send icon of the movement, chooses the group and confirms with the preselected
category and equal split, and counts the interactions with a helper that wraps every click (at most 3,
NFR-08; 2 with a one-group user); checks the group's expense list, balances and the activity page, and that
the movement count and the account balance did not change; shows that the row now reads "In group X" with no
icon; then opens the edit screen (notice, read-only amount, account and date, no send action), deletes the
group expense and checks the movement is still there and editable, and repeats the send changing the split in
the editor. From the home screen it opens the recent row of a movement and checks the URL has `focus`, that
the row is `aria-current` and in the viewport and that edit and delete work on it; then opens `/movements?focus=`
with a random uuid and with `abc` (no highlight, no alert). It repeats the flows at 360 px wide, offline (no
icon) and with a second tab sending the same movement (one succeeds, the other shows the already-sent
message). The request counts of the send screen are taken from `page.on('request')`. The scan test greps the
new and touched files for `parseFloat`, `toFixed`, `Number(` on money and for hardcoded strings. The HTTP flow
test checks the budget spending before and after the send and after the delete (the amount is counted once,
then fully again).

**Input validation**
- The end-to-end spec drives the same fields a person types (category, description, split values) and an
  invalid one (empty description) plus hostile `focus` values; no new input surface is added.

**Error handling**
- A refused send, an offline attempt, a locked edit and an unknown `focus` each show their message (or none,
  for `focus`) and leave the data as it was.

**Required tests**
- [ ] From the list, a person sends a movement to a group in at most 3 interactions with the default split and the account balance and movement count are unchanged, the group shows the expense and the activity page shows the marker — validates AC-12, AC-13, AC-17, AC-18, AC-37, NFR-08.
- [ ] A person with one group sends in at most 2 interactions — validates AC-35, NFR-08.
- [ ] Changing the split in the editor sends the changed split — validates AC-38.
- [ ] The personal figures count 10,000.00 of 40,000.00 and a receivable of 30,000.00, and the budget counts the amount once — validates AC-15, AC-16, FR-06.
- [ ] The row of the sent movement shows "In group X" and no icon, and the edit screen shows the notice with read-only amount, account and date and no send action; a refused queued edit appears as a failed change with the message and a discard action — validates AC-05, AC-25, AC-27, AC-39.
- [ ] Deleting the group expense keeps the movement as a plain personal expense that counts fully again — validates AC-29, AC-30.
- [ ] The home recent row opens the list at that movement, highlighted and in the viewport, with working row actions — validates AC-41, AC-42.
- [ ] An unknown or malformed `focus` shows the list with no highlight and no error — validates AC-43, AC-44.
- [ ] The send screen, the list rows with the icon and marker, the edit notice and the home rows fit 360 px wide with no horizontal scroll — validates NFR-01.
- [ ] A send from a second tab for the same movement shows the already-sent message (409) and nothing is duplicated — validates AC-23, AC-24.
- [ ] The Spanish and English catalogs have the same keys, none empty, and the screens render in both — validates NFR-04, AC-34.
- [ ] The scan finds 0 floating-point conversions of money and 0 hardcoded strings in the new and touched files — validates NFR-05, FR-14.
- [ ] The send screen makes at most 2 requests before a group is chosen, 1 after and 1 to send, counted in the browser; the home screen makes no extra request and the list at most 1 — validates NFR-02, NFR-09.

**Completion criterion**
The end-to-end spec and the scans pass, and the full web and API suites with the coverage thresholds pass in CI.

## Final verification
- Every AC (AC-01 to AC-44) and NFR (NFR-01 to NFR-09) has a test; every input has a sad-path test.
- `pnpm typecheck`, eslint and Prettier on touched files pass; the full suites and coverage pass; the
  migration applies on an empty database and on a copy of `main`; the rollback script runs twice.
- No new runtime dependency; the only new route is `POST /groups/:id/expenses/from-movement`; the only new
  tables or foreign keys are none (two columns and one index); the list answer gains a `groupLinks` field.
- Items for the owner: (1) the group category preselected on the send screen is "Other expenses" (D15); (2) the
  fourth code `GROUP_MOVEMENT_CHANGED` (D9); (3) the 0036 number is shared with the open 06d branch and the
  second to merge renumbers; (4) the rollback script detaches adopted expenses; (5) an admin edit of an adopted
  expense changes the payer's movement amount and date; (6) the manual rate of an adopted movement stays
  editable; (7) `fromMovement` is required in the activity entry; (8) the focus highlight only finds movements
  in the first 100 rows of the list (D16).

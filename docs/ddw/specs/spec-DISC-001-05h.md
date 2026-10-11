# Spec DISC-001-05h: Editing, Activity and Conflict Screens

| Field | Value |
|-------|-------|
| Ticket | DISC-001-05h |
| PRD | docs/ddw/prd/prd-DISC-001-05h.md |
| Tier | FEATURE |
| Date | 2026-10-11 |
| Spec loops | 0 |
| Loops since last human decision | 0 |

## Summary
Web only, stacked on 05e, 05f and 05g. The edit, delete and activity routes already exist in the API (05d),
so this ticket adds no route, migration, endpoint or dependency. Block 1 adds the one missing api-client
method, `listGroupActivity`. Blocks 2 and 3 are pure modules: permissions, edit values and edit requests,
the values a queued change shows on a row, and the activity view data. Block 4 is the bridge to the 04e
layer: a hook over `queueGroupUpdate`, `queueGroupDelete`, `retryGroupChange`, `discardGroupChange` and
`loadGroupQueue`, the rejection-to-message mapping, and the shared presentational pieces (sync marker, row
actions, delete confirmation, failed-change panel). Blocks 5 and 6 are the expense and settlement edit
screens, which also mount `GroupConflictContainer` when the record is in conflict. Blocks 7 and 8 add the
actions and markers to the expense list and the settlement history. Block 9 is the activity page. Block 10
links the activity page from the group detail. Block 11 adds the group counts to the shell sync status.
Block 12 owns the route files, the catalogs check and the end-to-end checks. Every edit or delete is written
to the group queue and sent by the existing sync pass (owner decision): no form calls
`updateGroupExpense`, `deleteGroupExpense`, `updateSettlement` or `deleteSettlement` itself. Money stays in
`bigint` minor units and strings on the wire.

## Decisions
- **D1 Routes.** `/groups/[id]/expenses/[expenseId]/edit`, `/groups/[id]/settlements/[settlementId]/edit`
  and `/groups/[id]/activity`. The activity page is separate from the detail so the detail keeps its
  2-request budget (PRD decision, 05e NFR-02). The edit routes carry the record id, never an amount.
- **D2 One path, owner decision.** An edit or a delete is `queueGroupUpdate` or `queueGroupDelete` followed
  by `notifyGroupChangeQueued()`; the shell's existing listener starts the pass that sends it. The cost,
  accepted in the PRD, is that a server refusal reaches the person after the pass as a failed row, not
  inline under the form. FR-09 is met by the failed-change panel (Block 4) and by the not-found and
  not-allowed states that the screens decide before queuing, from the loaded group and record.
- **D3 Who may act (FR-08).** `canEditRecord(createdByMemberId, selfMemberId, role)` is true when the
  caller's member id equals `createdByMemberId` or the caller's role is `admin`. `selfMemberId` and the
  caller's `role` come from `getGroup` (`members` entry whose id is `selfMemberId`). The browser decision
  only hides actions; the API answers 403 `GROUP_RECORD_EDIT_FORBIDDEN` and stays the authority.
- **D4 Request budgets (NFR-02).** Expense edit: `getGroup`, `getGroupExpense`, `getExpenseOptions` (3).
  Settlement edit: `getGroup`, `getSettlement` (2). Activity: `getGroup` and the first page (2). Reads of
  IndexedDB are not API requests. Saving or deleting makes no API request from the screen: the pass does.
- **D5 Expense list gains `getGroup` (PRD gap, flagged).** The expense list of 05f makes 2 requests
  (`listGroupExpenses`, `getExpenseOptions`), and `getExpenseOptions` carries `selfMemberId` but not the
  member's `role`, which AC-15 needs for admins. Block 7 adds `getGroup` as a third request and updates the
  05f request-count test from 2 to 3. The alternative, adding `role` to the expense options answer, would
  change an API response and is out of this ticket. Owner ratification item.
- **D6 Category names on the activity page (PRD gap, flagged).** Snapshots carry `categoryId` only, and the
  page's budget is 2 requests. The page renders from `getGroup` and the first page; only when a shown entry
  has a category value it requests `listGroupCategories` once, after first render, and shows the category
  name when it arrives (a neutral "Category" text meanwhile). The 2-request test covers the load; the extra
  request is asserted to happen at most once per page load. Owner ratification item.
- **D7 Settlement account as text.** The settlement edit screen shows "Recorded against an account" or "No
  account" from `accountId !== null`; it never names the account, because naming it needs `listAccounts` and
  the screen has a budget of 2. The payer's account may also belong to another member.
- **D8 Edit prefill reads the queue first.** If the record already has a queued update, the fields start from
  that request, not from the loaded record (the next save folds into it and keeps the oldest base, 04e D5).
  A queued delete shows "already queued for deletion"; a record in conflict shows the conflict view; a
  rejected change shows the failed-change panel above the fields.
- **D9 Percentage prefill.** The expense response carries amounts, not basis points. A `percentage` record is
  prefilled with percentages computed with integer arithmetic (`share * 10000 / amount`, remainder to the
  payer); when they cannot sum to 100.00 the split is prefilled in `exact` mode with the stored amounts.
- **D10 Consolidated settlements.** `isConsolidatedSettlement(settlement)` is `settlement.rate !== null`
  (PRD decision). Such a record offers deletion only; its edit address shows that and offers the deletion.
- **D11 Rejection reasons.** A rejected change keeps only a short code (04e). Block 4 maps it to the
  `errors.<messageKey>` text through the api-client's failure key table and decides whether retry makes
  sense: codes that retrying cannot fix are `GROUP_RECORD_FORMER_MEMBER`, `GROUP_SETTLEMENT_CONSOLIDATED`,
  `NOT_FOUND`, `VALIDATION_FAILED`, `GROUP_EXPENSE_CATEGORY_INVALID`, `GROUP_SPLIT_PERCENTAGE_INVALID`,
  `GROUP_SPLIT_AMOUNT_MISMATCH`, `GROUP_SPLIT_MEMBER_INVALID` and `GROUP_SETTLEMENT_MEMBER_INVALID`; every
  other code offers retry and discard.
- **D12 Shell sync status link.** The group counts are per device user, with no group id, so the shell
  link goes to the groups list (`/groups`). This is the PRD's recommended default for open question 1 and
  is not yet explicitly confirmed by the owner; ratification item. Counts are numbers only, never names.
- **D13 Refresh after a pass.** Lists reload their first page when `onSyncFinished` fires and re-read the
  queue when `onQueueChanged` fires, so an applied change shows the new values with no marker (AC-07). A
  pending update shows the values the person typed (`applyQueuedValues`); a pending delete hides the row.
- **D14 Online only creation, no dialogs, no dependency.** The creation screens are unchanged. Delete
  confirmation is an in-page panel, not a modal. No new runtime dependency.
- **D15 Names and text.** Member names come from `getGroup` (`members` and `formerMembers`), the existing
  `groups.detail.unnamed` copy covers unnamed and ghost members, and every name, description and amount is
  rendered as React text, never as HTML.

## Coverage: PRD → blocks
| Requirement | Covered by |
|---|---|
| FR-01 | Block 1 |
| FR-02 | Block 2, Block 5 |
| FR-03 | Block 2, Block 4, Block 5 |
| FR-04 | Block 4, Block 5, Block 7 |
| FR-05 | Block 2, Block 6 |
| FR-06 | Block 2, Block 6, Block 8 |
| FR-07 | Block 4, Block 6, Block 8 |
| FR-08 | Block 2, Block 5, Block 6, Block 7, Block 8 |
| FR-09 | Block 4, Block 5, Block 6 |
| FR-10 | Block 2, Block 4, Block 7, Block 8, Block 11 |
| FR-11 | Block 4, Block 7, Block 8 |
| FR-12 | Block 5, Block 6 (mounts `GroupConflictContainer`) |
| FR-13 | Block 3, Block 9, Block 10 |
| FR-14 | Block 3, Block 9 |
| FR-15 | Every block adds its catalog keys and uses the locale formatters; Block 12 checks |
| NFR-01 | Block 12 (end-to-end at 360 px) |
| NFR-02 | Strategy: one container per screen stays inside its budget (D4), asserted by a call-count test in Blocks 5, 6 and 9; Block 12 counts again in the browser |
| NFR-03 | Strategy: every block adds Spanish and English keys together; the existing catalog parity test runs in each block and in Block 12 |
| NFR-04 | Block 2 (property test), Block 4 (queued amount equals typed amount) |
| NFR-05 | Block 4 (interruption seam test), Block 12 (end-to-end, one conflict resolved each way) |

## Dependencies between blocks
Blocks 1, 2, 3, 4, 10 and 11 are independent of each other and run first, in parallel (group A). Blocks 5,
6, 7, 8 and 9 each need Block 4; Blocks 5, 6, 7 and 8 also need Block 2; Block 9 needs Blocks 1 and 3.
Blocks 5 to 9 touch disjoint folders and run in parallel once their inputs exist (group B), except that
Block 5 and Block 6 both read Block 4's components, which they do not edit. Block 12 is last and owns the
route files and the end-to-end spec (group C). Shared files are the catalogs `apps/web/messages/en.json`
and `apps/web/messages/es.json` (and no shared barrel: the new folders export by direct path). Each block
adds keys under its own sub-namespace by targeted `Edit` insertion at a distinct anchor, never by rewriting
the file: `groups.edit.common` (Block 4), `groups.edit.expense` (Block 5), `groups.edit.settlement`
(Block 6), `groups.activity` (Blocks 3 and 9: Block 3 owns `groups.activity.fields`, Block 9 the rest),
`groups.detail.activityLink` (Block 10) and `app.sync` (Block 11). Parallel blocks that must write the same
JSON file take turns at the edit, so the orchestrator may serialize only the catalog step. 05f and 05g also
touch `api-client.ts`, the lists and the catalogs; merge order decides who rebases (PRD).

| Block | Owns (parallel group) |
|---|---|
| 1 | `apps/web/src/lib/api-client.ts` and its test (group A) |
| 2 | `features/groups/edit/*.ts` permission and request logic (group A) |
| 3 | `features/groups/activity/activity-view.ts` (group A) |
| 4 | `features/groups/edit/use-group-changes.ts`, `rejection.ts`, `components/*` (group A) |
| 5 | `features/groups/expenses/edit/*`, `expense-form.tsx` lock (group B) |
| 6 | `features/groups/settlements-edit/*` (group B) |
| 7 | `features/groups/expenses/list/*` (group B) |
| 8 | `features/groups/settlements-history/*` (group B) |
| 9 | `features/groups/activity/*` containers and components (group B) |
| 10 | `group-detail-container.tsx` (group A) |
| 11 | `features/shell/**` sync status (group A) |
| 12 | `app/**` pages, e2e, catalogs check (last) |

## Block 1 — api-client activity method

**Files**
- `apps/web/src/lib/api-client.ts` (modified) — interface (beside `listSettlements`) and implementation of
  `listGroupActivity(groupId, {limit, cursor})`.
- `apps/web/test/api-client-group-activity.test.ts` (new) — the call with a fake `fetch`, as
  `api-client-group-settlements.test.ts` does.

**Logic**
The method (FR-01) goes through the existing group path helper, `request` with
`refreshOnUnauthenticated: true`, and validates the answer with `activityPageSchema` from `@pesly/shared`.
The query string is built with `URLSearchParams` from values that passed `listActivityQuerySchema`, so
`limit` and `cursor` are encoded. Failure mapping reuses the existing key mapping, including
`groupActivityLogImmutable`.

**Input validation**
- The group id goes through `resourcePath`; a malformed id returns `VALIDATION_FAILED` and sends no request.
- The query is checked with `listActivityQuerySchema` before sending; a `limit` above the maximum or an
  empty or oversized cursor is a local `VALIDATION_FAILED` and sends no request.

**Error handling**
- A response that does not match `activityPageSchema` is a generic `INTERNAL` failure, never partial data.
- A 404 for a group the user is not in is `NOT_FOUND`; a 401 is retried once through the existing refresh.

**Required tests**
- [ ] `listGroupActivity` calls `GET /groups/:id/activity` with `limit` and `cursor` and returns the items
  with `nextCursor` — validates AC-01.
- [ ] A response with an entry that has an unknown action, a numeric amount or an extra key is a failure and
  returns no data — validates AC-02.
- [ ] A 404 is `NOT_FOUND` — validates AC-33.
- [ ] A malformed group id, a `limit` of 0 and an empty cursor are rejected before any request — invalid
  input.

**Completion criterion**
The api-client tests pass and typecheck is clean.

## Block 2 — Pure permission and edit logic

**Files**
- `apps/web/src/features/groups/edit/permissions.ts` (new) — `canEditRecord`, `isConsolidatedSettlement`,
  `selfRole`.
- `apps/web/src/features/groups/edit/expense-edit-values.ts` (new) — loaded expense or queued request to
  `ExpenseFormValues`, and form values to `ExpenseEditRequest`.
- `apps/web/src/features/groups/edit/settlement-edit-request.ts` (new) — loaded settlement or queued
  request to values, and values to `SettlementEditRequest`.
- `apps/web/src/features/groups/edit/queued-values.ts` (new) — `applyQueuedValues`, the values a row shows
  for a pending update.
- `apps/web/test/groups-edit-logic.test.ts`, `apps/web/test/groups-edit-logic.property.test.ts` (new).

**Logic**
`canEditRecord` implements D3 and `isConsolidatedSettlement` D10. `expenseEditValues(expense, queued,
context)` returns the `ExpenseFormValues` of the queued request when there is one, otherwise of the loaded
record: the amount as locale text from `formatMinorUnits`, the date through `instantToZonedLocal` in the
user's time zone, the split state from `splitMode` and `shares` (D9, integer arithmetic only).
`buildExpenseEditRequest(values, context)` reuses `buildExpenseRequest` for validation and returns only
`amount`, `occurredAt`, `categoryId`, `description` and `split`, never currency, payer, payer account or
`baseVersion` (the queue owns it from `base.version`), or the same field errors. The settlement version
parses the amount with `parseAmountInput` (positive), turns the local date into an instant with
`zonedLocalToInstant`, and returns a request holding only the fields that differ from the loaded record, or
a field error when nothing changed. `applyQueuedValues(record, change)` returns the record with the
request's amount, date, category, description and shares applied, for display only. No float conversion
touches money.

**Input validation**
- Expense: the same rules as creation (positive amount within the movement maximum, valid local date not in
  the future, group category not archived, description 1 to the shared maximum, split adding up to the
  amount); a payer or currency is not read at all.
- Settlement: amount required and positive with at most two decimals; date a valid local date-time not
  skipped by a time-zone gap and not in the future; at least one of them changed.

**Error handling**
- Every failure is a catalog path in a field-errors object, never a thrown error; a form with errors builds
  no request.

**Required tests**
- [ ] The creator and an admin can edit; another member, and a caller whose role is unknown, cannot —
  validates AC-15, AC-16.
- [ ] A settlement with a rate is consolidated and one without is not — validates AC-12.
- [ ] A loaded expense becomes form values with its amount, date, category, description and split (equal,
  exact and percentage) — validates AC-03.
- [ ] A queued request wins over the loaded record when the values are prefilled — validates AC-06.
- [ ] The built expense request has no currency, payer, payer account or `baseVersion` — validates AC-04,
  AC-06.
- [ ] An empty, `0`, negative or non-numeric amount, and a split that does not add up, are field errors with
  no request — validates AC-05.
- [ ] A settlement edit with an empty or `0` amount is a field error with no request; a valid one carries
  the changed fields only — validates AC-10, AC-11.
- [ ] `applyQueuedValues` shows the queued amount, date and shares on the row and leaves the record intact —
  validates AC-20.
- [ ] 1,000 random amounts typed as locale text reach the request as the exact minor-units string, for an
  expense and for a settlement, with no `number` on the path — validates NFR-04.

**Completion criterion**
The logic tests pass, typecheck is clean and the new files contain no `parseFloat`, `toFixed` or `Number(`
on money.

## Block 3 — Pure activity view logic

**Files**
- `apps/web/src/features/groups/activity/activity-view.ts` (new) — entry to display rows.
- `apps/web/test/groups-activity-view.test.ts` (new).

**Logic**
`buildActivityView(entries, names, categories, context)` returns, per entry, the acting member's name
(`members` then `formerMembers`, then the unnamed copy), the action and record kind as catalog keys, the
instant, and a list of detail rows. For an `*_updated` entry the detail rows are the fields that differ
between `before` and `after`, each with the field key and both values formatted: amounts with
`formatMoney(BigInt(...), currency, language)`, dates with `formatDateTime` in the user's time zone,
members and categories by name, the split mode and the per-member shares as text. For an `*_deleted` entry
the rows are the values of `before`; for an `*_created` entry there are none (AC-36). Values are plain
strings so the components render them as text. `mergeActivityPages(shown, page)` appends a page and drops
any entry whose id is already shown.

**Input validation**
- The module receives entries already validated by `activityPageSchema`; an `*_updated` entry with a null
  `before` or `after`, or a snapshot of the wrong kind for its subject, yields the action row with no
  detail rows and never throws.

**Error handling**
- An unknown member or category id resolves to the unnamed or neutral copy, never to the raw id.

**Required tests**
- [ ] Entries keep the API's newest-first order and carry name, action, kind and instant — validates AC-30.
- [ ] A repeated entry id in the next page is not appended — validates AC-31.
- [ ] An actor in `formerMembers` is named from it — validates AC-32.
- [ ] An update shows exactly the fields that differ, with both values formatted in es and en; unchanged
  fields do not appear — validates AC-35.
- [ ] A deletion shows the values of `before` and a creation shows no detail rows — validates AC-36.
- [ ] A name or description containing markup characters comes out unchanged as a string — validates
  AC-30, AC-35 (rendering as text is asserted in Block 9).
- [ ] A snapshot of the wrong kind or a null side does not throw — invalid input.

**Completion criterion**
The tests pass and typecheck is clean.

## Block 4 — Group changes hook and shared pieces

**Files**
- `apps/web/src/features/groups/edit/use-group-changes.ts` (new) — the hook.
- `apps/web/src/features/groups/edit/rejection.ts` (new) — code to message key and retry rule.
- `apps/web/src/features/groups/edit/components/sync-marker.tsx` (new).
- `apps/web/src/features/groups/edit/components/row-actions.tsx` (new).
- `apps/web/src/features/groups/edit/components/delete-confirm.tsx` (new).
- `apps/web/src/features/groups/edit/components/failed-change-panel.tsx` (new).
- `apps/web/test/group-changes-hook.test.tsx`, `apps/web/test/group-edit-components.test.tsx`,
  `apps/web/test/group-edit-resolution.test.ts` (new).
- `apps/web/messages/en.json`, `apps/web/messages/es.json` (modified) — `groups.edit.common` keys.

**Logic**
`useGroupChanges(groupId)` reads the user id from `readSessionPointer()`, loads the queue with
`withGroupQueue` and `loadGroupQueue`, keeps the changes of that group, and re-reads on `onQueueChanged`.
It returns `{ready, available, changes, queueUpdate, queueDelete, retry, discard}`. The four actions open
the queue through `withGroupQueue`, call `queueGroupUpdate`, `queueGroupDelete`, `retryGroupChange` or
`discardGroupChange`, then `notifyQueueChanged()`, and for `queueUpdate`, `queueDelete` and `retry` also
`notifyGroupChangeQueued()` (D2). `available` is false when there is no session pointer or the store
cannot be opened. `rejection.ts` maps a stored code to `errors.<messageKey>` through the api-client's key
mapping and answers `canRetry(code)` by D11. `SyncMarker` shows waiting, failed or conflict as an icon and
text (never colour alone) with tokens only; `RowActions` shows edit and delete only when told they are
allowed and edit only when not consolidated; `DeleteConfirm` is the in-page confirmation with confirm and
cancel; `FailedChangePanel` shows the reason and retry (when `canRetry`) and discard. All are
presentational and take strings and callbacks.

**Input validation**
- `queueUpdate` receives a request already built by Block 2; the queue re-validates it with the shared
  contract and throws on an invalid one, which the hook reports as a failure and stores nothing.

**Error handling**
- A queue that cannot be opened or written sets `available` false or returns a failure, and the screens show
  `groups.edit.common.unavailable`; nothing is lost silently and no API call is made as a fallback.
- `queueDelete` of a record with a queued delete is accepted as done (04e), so a double click is harmless.

**Required tests**
- [ ] `queueUpdate` stores one update whose `base` is the loaded record and asks for a pass — validates
  AC-06.
- [ ] `queueDelete` stores a delete with the loaded record as `base` and asks for a pass; cancelling the
  confirmation stores nothing — validates AC-08, AC-09.
- [ ] `retry` clears the rejection and asks for a pass; `discard` removes the change — validates AC-23,
  AC-24.
- [ ] A refusal that retrying cannot fix offers only discard, with the reason text — validates AC-25.
- [ ] A waiting, failed and conflict change are marked with text, not colour alone — validates AC-20, AC-21.
- [ ] 1,000 random amounts typed, queued and read back from the queue are equal as strings — validates
  NFR-04.
- [ ] An interrupted `keepMine` and an interrupted `keepServer` (04e `onStep` seam) leave the queued change
  and the server copy as they were, and a completed choice loses neither before it is made — validates
  NFR-05, AC-29.
- [ ] No session pointer or an unopenable store gives `available` false and calls no API method — invalid
  input.
- [ ] The Spanish and English `groups.edit.common` keys exist and are not empty — validates NFR-03.

**Completion criterion**
The tests pass, typecheck is clean and the new files call no `update*` or `delete*` api-client method.

## Block 5 — Expense edit screen

**Files**
- `apps/web/src/features/groups/expenses/edit/expense-edit-container.tsx` (new).
- `apps/web/src/features/groups/expenses/edit/expense-edit-view.tsx` (new) — states: not allowed,
  queued delete, conflict, form.
- `apps/web/src/features/groups/expenses/form/expense-form.tsx` (modified) — an optional `locked` prop that
  replaces the currency select, the payer select and the payer-account fields with read-only text; with the
  prop absent the create form is unchanged.
- `apps/web/test/group-expense-edit.test.tsx` (new); `apps/web/test/group-expense-form.test.tsx` (modified,
  one case).
- `apps/web/messages/en.json`, `apps/web/messages/es.json` (modified) — `groups.edit.expense` keys.

**Logic**
The container (`isGroupId` guard, then a screen) loads `getGroup`, `getGroupExpense` and
`getExpenseOptions` in one `Promise.all` (D4). A 404 on any is the not-found state; a 401 goes to sign-in.
It computes `canEditRecord` (D3): not allowed shows the not-allowed state with no fields (AC-16). It reads
the queue through `useGroupChanges`: a queued delete shows the already-deleting state, a conflict mounts
`GroupConflictContainer` with `memberNames` and `categoryNames` built from the group and the options, and a
rejected change shows `FailedChangePanel` above the form. Otherwise it renders `ExpenseForm` with
`expenseEditValues`, the currency and the payer as text, and members and categories from the options. On
submit it runs `buildExpenseEditRequest`; with field errors it shows them and queues nothing; otherwise it
calls `queueUpdate({kind: 'expense', base: loadedExpense, request})` and navigates to the expense list. A
delete button opens `DeleteConfirm` and confirming calls `queueDelete`. The entered values stay on every
refusal.

**Input validation**
- The route ids are checked by `isGroupId` and the same UUID check for the expense id; anything else is the
  not-found state with no request.
- All field rules are Block 2's; the form shows the first invalid field focused.

**Error handling**
- A 404 is not-found (AC-18). A failed `getGroup`, `getGroupExpense` or `getExpenseOptions` that is not a 404
  shows the shared load-failed state with retry.
- A refusal that arrives later through the sync pass shows in the failed panel with its message and the
  entered values (AC-17, AC-19); this screen never applies a change itself.

**Required tests**
- [ ] The fields start from the expense's amount, date, category, description and split — validates AC-03.
- [ ] The currency and the payer show as text and no control changes them — validates AC-04.
- [ ] An empty amount, a `0` amount and a split that does not add up show a field error and queue nothing —
  validates AC-05.
- [ ] Saving stores one queued update with the loaded record as `base`, asks for a pass and returns to the
  list — validates AC-06.
- [ ] Confirming the deletion queues it; cancelling leaves the queue empty — validates AC-08, AC-09.
- [ ] A member who is neither the creator nor an admin sees the not-allowed state and no fields; the
  creator and an admin see the form — validates AC-15, AC-16.
- [ ] A rejected change with `GROUP_RECORD_EDIT_FORBIDDEN` shows that message with the entered values; a
  `GROUP_RECORD_FORMER_MEMBER` shows its message and only discard — validates AC-17, AC-19, AC-25.
- [ ] A 404 on the expense shows the not-found state — validates AC-18.
- [ ] A record in conflict shows both versions side by side with the member and category names, "keep mine"
  keeps the change queued and asks for a pass, "keep server's" drops it — validates AC-26, AC-27, AC-28.
- [ ] A refused choice keeps both versions and shows the error — validates AC-29.
- [ ] The screen makes exactly 3 API requests on load and none on save — validates NFR-02.
- [ ] The screen renders in Spanish and English with no hardcoded string — validates AC-37.
- [ ] A malformed route id shows not-found and sends no request — invalid input.
- [ ] The create form is unchanged without `locked` — regression.

**Completion criterion**
The tests pass, the existing expense form tests pass and typecheck is clean.

## Block 6 — Settlement edit screen

**Files**
- `apps/web/src/features/groups/settlements-edit/settlement-edit-container.tsx` (new).
- `apps/web/src/features/groups/settlements-edit/settlement-edit-form.tsx` (new) — amount and date fields,
  parties, currency and account as text.
- `apps/web/src/features/groups/settlements-edit/settlement-delete-only.tsx` (new) — the consolidated state.
- `apps/web/test/group-settlement-edit.test.tsx` (new).
- `apps/web/messages/en.json`, `apps/web/messages/es.json` (modified) — `groups.edit.settlement` keys.

**Logic**
The container loads `getGroup` and `getSettlement` in one `Promise.all` (2 requests, D4) and applies the
same gates as Block 5: not-found, not allowed, queued delete, conflict (`GroupConflictContainer` with member
names), failed panel. A consolidated settlement (D10) renders `SettlementDeleteOnly`: the sentence that it
can only be deleted and the delete action with `DeleteConfirm`, with no fields (AC-12, AC-13). A plain one
renders the form with the amount and the date as the only inputs, the parties, the currency and the
account text (D7) as read-only text. Submit runs the Block 2 builder and calls `queueUpdate({kind:
'settlement', base: loaded, request})`; delete calls `queueDelete`. No API update or delete call is made
by the screen.

**Input validation**
- The route ids are validated like Block 5; amount and date rules are Block 2's.

**Error handling**
- A 404 is not-found; other load failures show the shared load-failed state with retry.
- A later refusal (for example `GROUP_SETTLEMENT_CONSOLIDATED`) shows in the failed panel with its message
  and offers only discard (AC-19, AC-25).

**Required tests**
- [ ] A plain settlement offers amount and date as fields and shows parties, currency and account as text —
  validates AC-10.
- [ ] An empty or `0` amount shows a field error and queues nothing — validates AC-11.
- [ ] Saving queues one update with the loaded record as `base` and asks for a pass — validates AC-06.
- [ ] A consolidated settlement shows no edit action and only deletion; its edit address says it can only be
  deleted and offers the deletion — validates AC-12, AC-13.
- [ ] Confirming the deletion queues it and cancelling does not — validates AC-14, AC-09.
- [ ] A non-creator, non-admin sees the not-allowed state; the creator and an admin see the actions —
  validates AC-15, AC-16.
- [ ] A rejection `GROUP_RECORD_EDIT_FORBIDDEN` shows its message and keeps the values; a 404 shows
  not-found — validates AC-17, AC-18.
- [ ] A settlement in conflict resolves both ways with names of members — validates AC-26, AC-27, AC-28.
- [ ] The screen makes exactly 2 API requests on load — validates NFR-02.
- [ ] The screen renders in Spanish and English — validates AC-37.
- [ ] A malformed route id shows not-found with no request — invalid input.

**Completion criterion**
The tests pass and typecheck is clean.

## Block 7 — Expense list actions and markers

**Files**
- `apps/web/src/features/groups/expenses/list/expense-row.tsx` (modified) — marker, actions, panels.
- `apps/web/src/features/groups/expenses/list/group-expenses-list.tsx` (modified) — passes row state.
- `apps/web/src/features/groups/expenses/list/group-expenses-container.tsx` (modified) — `getGroup` (D5),
  overlay, handlers, reload on `onSyncFinished`.
- `apps/web/test/group-expenses-list.test.tsx` (modified) — the request count goes from 2 to 3; new cases.
- `apps/web/messages/en.json`, `apps/web/messages/es.json` (modified) — only keys under `groups.edit.common`
  if a row needs one that Block 4 lacks, by targeted insertion.

**Logic**
The container adds `api.getGroup(groupId)` to its first `Promise.all` (3 requests, D5) and takes
`selfMemberId` and the caller's role from it. It reads the queue with `useGroupChanges`, builds the rows
with `overlayGroupRecords('expense', expenses, changes)` so a pending delete hides its row, shows the values
from `applyQueuedValues` for a pending update, and passes each row its `SyncState`. A row shows
`RowActions` only when `canEditRecord` is true (AC-15, AC-16); edit links to the edit route, delete opens
`DeleteConfirm` and confirming calls `queueDelete`. A failed row shows `FailedChangePanel` with retry or
discard; a conflict row links to the edit route to resolve. On `onSyncFinished` the first page reloads, so an
applied change shows its new values with no marker (AC-07). "Load more" keeps its generation guard.

**Input validation**
- None new: ids come from the loaded page.

**Error handling**
- A `getGroup` failure that is a 404 shows not-found, any other shows the shared load-failed state, like the
  other two requests.
- A queue that is not `available` shows rows without markers or actions that need it, and the unavailable
  text once, never a silent drop.

**Required tests**
- [ ] The first load makes 3 requests (the page, the options and the group) and the cursor still comes only
  from the previous answer — validates NFR-02 (D5).
- [ ] The creator's rows and an admin's rows show edit and delete; another member's rows show neither —
  validates AC-15, AC-16.
- [ ] A row with a queued update is marked waiting and shows the queued values; a row with a queued delete
  disappears — validates AC-20, AC-08.
- [ ] A row with a rejection is marked failed with the reason; retry queues it again and asks for a pass;
  discard shows the record as the server holds it; a non-retryable reason offers only discard — validates
  AC-21, AC-23, AC-24, AC-25.
- [ ] A row with a conflict is marked in conflict and links to the resolution — validates AC-21.
- [ ] After `onSyncFinished` the row shows the server's values with no marker — validates AC-07.
- [ ] Confirming a deletion queues it, cancelling leaves the queue unchanged — validates AC-08, AC-09.
- [ ] A 404 from `getGroup` shows the not-found state and any other error shows the load-failed state with
  retry — invalid input, validates AC-18.
- [ ] An unavailable queue is an error shown once as text, with the rows still listed — invalid input.
- [ ] Spanish and English render with no hardcoded string — validates AC-37.

**Completion criterion**
The tests pass, the other expense list tests pass and typecheck is clean.

## Block 8 — Settlement history actions and markers

**Files**
- `apps/web/src/features/groups/settlements-history/settlement-row.tsx` (modified) — marker, actions.
- `apps/web/src/features/groups/settlements-history/settlements-list.tsx` (modified).
- `apps/web/src/features/groups/settlements-history/settlements-history-container.tsx` (modified) —
  overlay, handlers, reload on `onSyncFinished`.
- `apps/web/test/group-settlements-history.test.tsx` (new, or the existing history test file if present).
- `apps/web/messages/en.json`, `apps/web/messages/es.json` (modified) — only missing row keys, by targeted
  insertion.

**Logic**
The container already loads `getGroup` and the first page (2 requests) and keeps that. It takes
`selfMemberId` and the role from the group, reads the queue with `useGroupChanges`, overlays
`overlayGroupRecords('settlement', items, changes)` and renders `SettlementRow` with the marker and the
actions. A consolidated row (`rate !== null`) offers delete only, a plain one edit and delete (FR-06); both only when `canEditRecord` is true. Retry, discard, delete confirmation and the
conflict link behave as in Block 7. A pending update shows the queued amount and date, a pending delete
hides the row, and `onSyncFinished` reloads the first page.

**Input validation**
- None new.

**Error handling**
- A queue that is not `available` shows rows without the queue-dependent parts and the unavailable text.

**Required tests**
- [ ] A plain row shows edit and delete for the creator and an admin; a consolidated row shows delete only;
  other members see neither — validates AC-12, AC-15, AC-16.
- [ ] Confirming the deletion of a row queues it and hides the row; cancelling leaves it — validates AC-14,
  AC-09.
- [ ] A queued update marks the row waiting with the queued values; a rejection marks it failed with retry
  and discard; a conflict marks it and links to the resolution — validates AC-20, AC-21, AC-23, AC-24.
- [ ] A refusal retrying cannot fix offers only discard — validates AC-25.
- [ ] After `onSyncFinished` the row shows the new values with no marker — validates AC-07.
- [ ] The page still makes 2 requests on load — validates NFR-02.
- [ ] An unavailable queue is an error shown once as text, with the rows still listed — invalid input.
- [ ] Spanish and English render with no hardcoded string — validates AC-37.

**Completion criterion**
The tests pass, the 05g history tests pass and typecheck is clean.

## Block 9 — Activity page

**Files**
- `apps/web/src/features/groups/activity/group-activity-container.tsx` (new).
- `apps/web/src/features/groups/activity/activity-list.tsx` (new).
- `apps/web/src/features/groups/activity/activity-entry.tsx` (new).
- `apps/web/test/group-activity.test.tsx` (new).
- `apps/web/messages/en.json`, `apps/web/messages/es.json` (modified) — `groups.activity` keys other than
  `fields` (Block 3).

**Logic**
The container (`isGroupId` guard) loads `getGroup` and `listGroupActivity(groupId, {limit: 50})` in one
`Promise.all` (2 requests, D4), builds the view with `buildActivityView` and renders newest first, each
entry with the member's name, the action, the kind and the date and time, and its detail rows (AC-30,
AC-35, AC-36). When a shown entry has a category value it requests `listGroupCategories` once (D6) and
re-builds the view when it arrives. "Load more" follows the cursor of the previous answer with `limit` 50,
appends through `mergeActivityPages` and never refetches earlier pages; it keeps the loaded entries when it
fails and offers retry. Names, notes and values are rendered as React text; no `dangerouslySetInnerHTML`
and no markdown rendering of any log value.

**Input validation**
- The group id is checked by `isGroupId`; the cursor comes only from the previous response and is never
  built from user text.

**Error handling**
- A 404 on the group or the page is the not-found state with no hint that the group exists (AC-33); a 401
  goes to sign-in; other failures show the shared load-failed state with retry; a failed "load more" keeps
  the list.
- A failed category request leaves the neutral text and does not retry on its own.

**Required tests**
- [ ] The page lists entries newest first with name, action, kind and date and time — validates AC-30.
- [ ] "Load more" appends the next page and repeats no entry; with no cursor the control is absent —
  validates AC-31.
- [ ] An entry by a member who left shows their name from the former members — validates AC-32.
- [ ] A non-member gets the not-found state — validates AC-33.
- [ ] An edit entry shows each changed field with both values formatted; a deletion shows the values the
  record had; a creation shows the action only — validates AC-35, AC-36.
- [ ] A member name and a description containing `<img src=x onerror=alert(1)>` render as literal text and
  create no element — validates AC-30, AC-35.
- [ ] The page makes exactly 2 requests on load, and the category request, when needed, happens once —
  validates NFR-02 (D6).
- [ ] Spanish and English render the page with no hardcoded string and dates in the user's time zone —
  validates AC-37.
- [ ] A 404 shows not-found and a 401 goes to sign-in; any other error shows the load-failed state with
  retry — invalid input, validates AC-33.
- [ ] A failed "load more" is an error that keeps the entries and offers retry — invalid input.
- [ ] A failed category request is an error that leaves the neutral text and does not retry — invalid input.
- [ ] A malformed group id shows not-found with no request — invalid input.

**Completion criterion**
The tests pass and typecheck is clean.

## Block 10 — Group detail link

**Files**
- `apps/web/src/features/groups/containers/group-detail-container.tsx` (modified) — one link beside the
  existing ones.
- `apps/web/test/group-detail.test.tsx` (modified).
- `apps/web/messages/en.json`, `apps/web/messages/es.json` (modified) — `groups.detail.activityLink`.

**Logic**
The detail adds a link to `/groups/<encoded id>/activity` with the `activityLink` text, shown to every
member, using `Link` from `@/i18n/navigation` and `buttonVariants` like its siblings. It adds no request;
the detail keeps its current count.

**Error handling**
- No new failure path: the link is rendered only in the ready state.

**Required tests**
- [ ] A member opening the detail sees the activity link with the encoded group id — validates AC-34.
- [ ] The detail makes no additional request — validates NFR-02 (05e budget kept).
- [ ] The link is absent in the load error and not-found states — invalid input.
- [ ] The link text exists in Spanish and English — validates AC-37.

**Completion criterion**
The detail tests pass and typecheck is clean.

## Block 11 — Shell sync status for group changes

**Files**
- `apps/web/src/features/shell/components/sync-status.tsx` (modified) — group counts and their link.
- `apps/web/src/features/shell/containers/authenticated-shell-container.tsx` (modified) — reads the group
  counts.
- `apps/web/test/shell-sync-status.test.tsx` (new, or the existing sync status test file if present).
- `apps/web/messages/en.json`, `apps/web/messages/es.json` (modified) — `app.sync` keys for groups.

**Logic**
`SyncStatus` gains optional `groupWaiting`, `groupFailed` and `groupConflict` props (default 0), shown as
separate lines from the movement counts, each with its plural message. The group lines link to `/groups`
(D12) with `Link` from `@/i18n/navigation`; the movement lines are unchanged. The shell container keeps a
second state from `readGroupQueueCounts(readSessionPointer()?.userId)`, read in the same effect and on the
same triggers as `readQueueCounts` (`onQueueChanged`, `onSyncFinished`, on mount), and passes the three
numbers. The connection `pending` count stays the movement count. Counts are read for the signed-in user's
own database only and carry no group name or id.

**Error handling**
- A group queue that cannot be read counts as empty (existing `readGroupQueueCounts` behavior); the status
  renders nothing for groups then.

**Required tests**
- [ ] With group changes waiting, failed and in conflict, the status shows each count apart from the movement
  counts — validates AC-22.
- [ ] With only movement counts the status is unchanged, and with all counts 0 it renders nothing — validates
  AC-22.
- [ ] The group lines link to the groups list and contain no group name or id — validates AC-22 (D12).
- [ ] The counts update when `onQueueChanged` fires — validates AC-22.
- [ ] A user with no session pointer shows 0 group changes — invalid input.
- [ ] The new `app.sync` keys exist in both catalogs — validates AC-37, NFR-03.

**Completion criterion**
The shell tests pass, the existing sync status and shell tests pass and typecheck is clean.

## Block 12 — Pages, catalogs and end-to-end checks

**Files**
- `apps/web/src/app/[locale]/(app)/groups/[id]/expenses/[expenseId]/edit/page.tsx` (new).
- `apps/web/src/app/[locale]/(app)/groups/[id]/settlements/[settlementId]/edit/page.tsx` (new).
- `apps/web/src/app/[locale]/(app)/groups/[id]/activity/page.tsx` (new).
- `apps/web/e2e/group-editing.spec.ts` (new).
- `apps/web/e2e/support/group-editing.ts` (new) — helpers over the existing `support/groups.ts`.

**Logic**
Each page follows the sibling pages: `await params`, a `<main>` with the shared layout classes and one
container from Blocks 5, 6 and 9. One Playwright spec with two users: they create and join a group, one
records an expense and a settlement. The author edits the expense (row waiting, then applied), the other
member sees no actions, the admin edits it, and the author deletes a settlement. A second test makes two
members edit the same expense (one offline, using the existing offline helpers), and resolves the conflict
once with "keep mine" and once with "keep server's" on two records, checking the server copy and the queue
after each (NFR-05). A third test opens the edit screens, the activity page and the conflict view at 360 px
and asserts no horizontal scroll (NFR-01). A fourth counts the requests of each screen on load (NFR-02). A
fifth queues a change offline, signs out and asserts the group queue database is gone and a second user on
the same browser sees 0 group changes. The no-literal scan `groups-no-hardcoded-strings.test.ts` already
covers `src/features/groups`, and the parity test `i18n-catalogs.test.ts` covers NFR-03.

**Input validation**
- A route id that is not a UUID reaches the container, which shows not-found with no request.

**Error handling**
- The spec resets attempt limits before each test, as the existing specs do, and runs one e2e at a time
  (project rule).

**Required tests**
- [ ] The author edits an expense: the row shows waiting, then the new values with no marker, and the
  activity page lists the edit with before and after values — validates AC-03, AC-06, AC-07, AC-30, AC-35.
- [ ] The author deletes an expense and a settlement after confirming; cancelling changes nothing — validates
  AC-08, AC-09, AC-14.
- [ ] A consolidated settlement offers only deletion, also at its edit address — validates AC-12, AC-13.
- [ ] A member who is neither creator nor admin sees no actions and the not-allowed state at the edit
  address; an admin sees them — validates AC-15, AC-16.
- [ ] A refusal by the server (the member left meanwhile, or the actor lost the role) shows its message on
  a failed row with the entered values kept — validates AC-17, AC-19.
- [ ] An edit address of a record that does not exist shows not-found — validates AC-18.
- [ ] The failed row retries and discards — validates AC-23, AC-24, AC-25.
- [ ] The shell shows the group counts and links to the groups list — validates AC-22.
- [ ] Two members edit the same expense; the second sees the conflict with both versions and the differing
  fields marked; one conflict is resolved with "keep mine" and one with "keep server's", and no version is
  lost before the choice — validates AC-26, AC-27, AC-28, NFR-05.
- [ ] The activity page pages with "load more", repeats nothing, names a former member and is linked from the
  detail — validates AC-31, AC-32, AC-34.
- [ ] A user who is not in the group gets not-found on the edit and activity addresses — validates AC-33,
  AC-18.
- [ ] The edit screens, the activity page, the failed row and the conflict view fit 360 px without
  horizontal scroll — validates NFR-01.
- [ ] The expense edit screen makes at most 3 API requests, the settlement edit at most 2 and the activity
  page at most 2 — validates NFR-02.
- [ ] The Spanish and English catalogs have the same keys, none empty, and the screens render in both —
  validates NFR-03, AC-37.
- [ ] 1,000 random amounts typed on the edit forms are queued equal to the typed value, and no money value
  goes through a float in the new folders (scan) — validates NFR-04.
- [ ] Signing out deletes the group queue and another user on the device sees none of it — data at rest.

**Completion criterion**
The spec and the scans pass, and the full web suite and the coverage thresholds pass.

## Final verification
- Every AC (AC-01 to AC-37) and NFR (NFR-01 to NFR-05) has a test; every input has a sad-path test.
- `pnpm typecheck`, eslint and Prettier on touched files pass; the full web suite and coverage pass.
- The design-system scan and accessibility tests pass for the new screens (labels, focus on the first
  invalid field, tokens only, markers carried by text and icon, not colour).
- No block calls `updateGroupExpense`, `deleteGroupExpense`, `updateSettlement` or `deleteSettlement`
  outside the sync pass (scan), and no new endpoint, route, migration or dependency was added.
- Owner ratification items: (1) the expense list adds `getGroup`, so its budget goes from 2 to 3 (D5);
  (2) category names on the activity page need one extra request after first render (D6); (3) the
  settlement edit screen shows the account as text without its name (D7); (4) the shell sync status links to
  the groups list, the recommended default of open question 1, not yet explicitly confirmed (D12); (5) 05h
  starts coding after 05e, 05f and 05g are merged into the chain, since it edits their files.

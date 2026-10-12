# PRD DISC-001-05h: Editing, Activity and Conflict Screens

| Field | Value |
|-------|-------|
| Ticket | DISC-001-05h |
| Tracker | none |
| Date | 2026-10-11 |
| PRD loops | 0 |
| Loops since last human decision | 0 |

## Context and Problem
Last of four web sub-tickets of PRD 05 (parent index: `prd-DISC-001-05.md`; 05e groups and members,
05f expenses, 05g balances and settlements). The API already edits and deletes group records under the
rules of `prd-DISC-001-05d.md` (`PUT` and `DELETE /groups/:id/expenses/:expenseId`, `PATCH` and `DELETE`
`/groups/:id/settlements/:settlementId`, each with the `baseVersion` the client last saw) and lists the
immutable activity log (`GET /groups/:id/activity`, newest first, cursor pages, `before` and `after`
snapshots). The web app has the matching api-client methods for edits and deletes, and the offline layer of
`prd-DISC-001-04e.md` (a group queue in IndexedDB, the sync pass that sends it, the conflict storage and a
conflict container with its `groupConflict` catalog). But no screen edits or deletes a group record, the log
has no page and no api-client method, and the 04e layer is not mounted anywhere: nothing writes to the group
queue, no row shows a sync state and nobody can resolve a conflict. This ticket builds the three missing
screens, adds the one missing api-client method (`listGroupActivity`) and mounts the 04e layer on them. It
adds one endpoint, `GET /groups/:id/settlements/:settlementId`, so the settlement edit screen can read one
settlement (Decision Log, 2026-10-11).

The creation screens stay online only (PRD 05 decision, 05e and 05f). What 05h mounts is the change layer:
an edit or a delete of a record that was loaded is written to the group queue and sent by the existing sync
pass, so it survives a connection that drops after the screen opened and a stale version becomes a conflict
the person resolves, not an error. What stays out is in Out of Scope.

## Goals
- A member who recorded a group expense or settlement, and any admin, corrects or deletes it from the app.
- Nobody else sees actions they cannot use, and a refusal from the server is always explained.
- A change that waits on the device, failed or was made over by someone else is visible, and the person
  resolves it.
- Every member reads who changed what, with the values before and after.

## Functional Requirements
- FR-01: The system must add to the api-client a method that lists the group activity log by cursor page and
  returns the validated page.
- FR-02: The system must show an edit screen for a group expense with its amount, date, category,
  description and split prefilled, and with the currency and the payer shown but not editable.
- FR-03: The system must save an edited expense by queuing the change with the version of the record that
  was loaded, and start a sync pass.
- FR-04: The system must let the person delete a group expense after a confirmation, by queuing the deletion
  with the version of the record that was loaded.
- FR-05: The system must show an edit screen for a plain group settlement where the amount and the date can
  change, and the parties, the currency and the account are shown but not editable.
- FR-06: The system must offer only deletion, with no edit, for a consolidated settlement.
- FR-07: The system must let the person delete a group settlement after a confirmation, by queuing the
  deletion with the version of the record that was loaded.
- FR-08: The system must offer the edit and delete actions of a group expense or settlement only to the
  member who recorded it and to admins.
- FR-09: The system must show the message of every refusal the API answers to an edit or a delete, and keep
  the entered values.
- FR-10: The system must mark each expense and settlement row with its sync state (waiting, failed or in
  conflict) read from the group queue, and must show in the shell's sync status the count of group changes
  in each state.
- FR-11: The system must let the person retry or discard a group change that the server refused.
- FR-12: The system must let the person resolve a group record in conflict by choosing their version or the
  server's, using the conflict view of 04e with the names of members and categories.
- FR-13: The system must show a page of the group activity log, newest first, with the member who acted, the
  action, the record and the date and time, loading more on request, and link it from the group detail.
- FR-14: The system must show, for an edit entry, each field that changed with its value before and after,
  and for a deletion entry the values the record had.
- FR-15: The system must show every string of these screens in Spanish and English from the i18n catalogs,
  and every amount and date with the locale formatters.

## Non-Functional Requirements
- NFR-01: Each screen must render without horizontal scrolling at a 360 px wide viewport, verified by an
  end-to-end test at that width.
- NFR-02: The expense edit screen must load with at most 3 API requests (the group, the expense and the
  expense options), the settlement edit screen with at most 2 (the group and the settlement) and the
  activity page with at most 2 (the group and the first page), each verified by a test that counts the
  calls.
- NFR-03: The Spanish and English catalogs must have 0 missing or empty keys, verified by the existing
  catalog parity test.
- NFR-04: Every amount must travel as a string and be converted with the shared money helpers, with 0
  floating-point conversions, verified by a test over 1,000 random amounts that the amount queued equals the
  amount typed.
- NFR-05: A choice in a conflict must lose 0 versions before it is made, and an interrupted choice must
  leave the queued change and the server copy as they were, verified by the 04e interruption test seam and
  an end-to-end test that resolves one conflict each way.

## Acceptance Criteria
*(EARS)*
- AC-01 (FR-01): WHEN a screen asks for the activity log with a cursor, THE api-client SHALL call
  `GET /groups/:id/activity` with that cursor and return the validated page.
- AC-02 (FR-01): IF the response does not pass the shared activity schema, THEN THE api-client SHALL answer
  a failure and not return the data.
- AC-03 (FR-02): WHEN the person opens the edit screen of an expense, THE system SHALL show its current
  amount, date, category, description and split in the fields.
- AC-04 (FR-02): THE system SHALL show the expense's currency and payer as text, with no field to change
  them.
- AC-05 (FR-02): IF the amount is empty or 0 or less, or the split does not add up to the amount, THEN THE
  system SHALL show a field error and not queue the change.
- AC-06 (FR-03): WHEN the person saves an edited expense, THE system SHALL store one queued update whose
  `base` is the loaded record, and ask for a sync pass.
- AC-07 (FR-03): WHEN the sync pass applies the update, THE system SHALL show the row with the new values
  and no marker.
- AC-08 (FR-04): WHEN the person confirms the deletion of an expense, THE system SHALL queue the deletion
  and stop showing the row.
- AC-09 (FR-04): WHEN the person cancels the confirmation, THE system SHALL leave the expense and the queue
  unchanged.
- AC-10 (FR-05): WHEN the person opens the edit screen of a plain settlement, THE system SHALL offer the
  amount and the date, and show the parties, currency and account as text.
- AC-11 (FR-05): IF the amount is empty or 0 or less, THEN THE system SHALL show a field error and not queue
  the change.
- AC-12 (FR-06): WHILE a settlement is consolidated, THE system SHALL show no edit action and only the
  delete action.
- AC-13 (FR-06): IF the person opens the edit address of a consolidated settlement, THEN THE system SHALL
  say that it can only be deleted and offer the deletion.
- AC-14 (FR-07): WHEN the person confirms the deletion of a settlement, THE system SHALL queue the deletion
  and stop showing the row.
- AC-15 (FR-08): WHEN the viewer recorded the record or is an admin of the group, THE system SHALL show the
  edit and delete actions on it.
- AC-16 (FR-08): IF the viewer is neither the member who recorded the record nor an admin, THEN THE system
  SHALL show no edit or delete action and show the not-allowed state at the edit address.
- AC-17 (FR-09): IF the API answers that the viewer is not allowed to edit the record, THEN THE system SHALL show
  that message and keep the entered values.
- AC-18 (FR-09): IF the API answers not found, THEN THE system SHALL show the not-found state.
- AC-19 (FR-09): IF the API answers that a member of the record left the group, or that a consolidated
  settlement cannot be edited, THEN THE system SHALL show that message and not apply the change.
- AC-20 (FR-10): WHILE a queued change waits for the sync pass, THE system SHALL mark its row as waiting.
- AC-21 (FR-10): WHILE the server refused a queued change, THE system SHALL mark its row as failed, and
  WHILE the server holds a newer version, THE system SHALL mark it as in conflict.
- AC-22 (FR-10): WHILE group changes wait, failed or conflict, THE shell's sync status SHALL show the count
  of each, apart from the movement counts.
- AC-23 (FR-11): WHEN the person chooses retry on a failed change, THE system SHALL queue it again and ask
  for a sync pass.
- AC-24 (FR-11): WHEN the person chooses discard on a failed change, THE system SHALL remove it from the
  queue and show the record as the server holds it.
- AC-25 (FR-11): IF the failed change was refused for a reason that retrying cannot fix, THEN THE system
  SHALL show the reason and offer only discard.
- AC-26 (FR-12): WHEN the person opens a record in conflict, THE system SHALL show their version and the
  server's side by side with the fields that differ marked.
- AC-27 (FR-12): WHEN the person chooses "keep mine", THE system SHALL keep their change queued on top of
  the server's version and ask for a sync pass.
- AC-28 (FR-12): WHEN the person chooses "keep server's", THE system SHALL drop their change and show the
  server's version.
- AC-29 (FR-12): IF a choice cannot be applied, THEN THE system SHALL keep both versions and show the error.
- AC-30 (FR-13): WHEN a member opens the activity page, THE system SHALL list the entries newest first, each
  with the member's name, the action, the kind of record and the date and time.
- AC-31 (FR-13): WHEN more entries exist than one page, THE system SHALL offer to load more and append them
  without repeating any.
- AC-32 (FR-13): IF an entry names a member who left the group, THEN THE system SHALL show their name from
  the former members list.
- AC-33 (FR-13): IF the user is not a member of the group, THEN THE system SHALL show the not-found state.
- AC-34 (FR-13): WHEN a member opens the group detail, THE system SHALL show a link to the activity page.
- AC-35 (FR-14): WHEN an entry is an edit, THE system SHALL show each field that differs between `before`
  and `after` with both values formatted.
- AC-36 (FR-14): WHEN an entry is a deletion, THE system SHALL show the values the record had, and WHEN it is
  a creation, THE system SHALL show the action only.
- AC-37 (FR-15): WHERE the interface language is Spanish or English, THE system SHALL show every string of
  these screens in that language.

## Out of Scope
- Offline creation of expenses and settlements, offline opening of these screens and any offline cache read
  of a group list (PRD 05 decision, 05e and 05f): the queue serves changes to records that were loaded.
- Changing the currency, the payer, the payer account or the parties of a record (05d rule): the API
  rejects them and the screens do not offer them.
- Undoing or restoring a deleted record, comments, reactions and filtering the log (05d).
- Editing or deleting a log entry: the log is append-only and the API answers 405 (05d).
- Merging two versions field by field: a conflict is one choice between two whole versions (04e).
- Push or email notice of a change to the other members (PRD 08).
- Conflict handling for movements that are not group records (the personal queue of 04c to 04e).

## Risks and Mitigations
- **An edit of someone else's record** → the actions show only to the author and admins, and the server
  still answers 403, shown to the person (FR-08, FR-09).
- **A change lost because two members edited the same record** → every change carries `baseVersion`, a
  stale one becomes a conflict with both versions kept until the person chooses (FR-12, NFR-05).
- **The person thinks a queued change is saved** → the row carries a waiting marker until the pass applies
  it, and the shell counts it (FR-10).
- **A refusal arrives after the screen closed** → the failed marker keeps the reason and offers retry or
  discard (FR-11).
- **A float slips into money** → amounts stay strings and go through the shared helpers (NFR-04).
- **Log entries are heavy to read** → only changed fields are shown for an edit (FR-14).
- **The 04e layer has no screen to prove it** → the end-to-end test runs one conflict through both choices
  (NFR-05).

## Dependencies
- DISC-001-05d (editing rules and activity log) — the endpoints, the permission rule and the 409 answers.
- DISC-001-04e (conflicts on group movements) — the group queue, sync pass, conflict storage, conflict view
  and the `groupConflict` catalog, merged and unmounted until this ticket.
- DISC-001-05e (groups and members, draft PR #54) — the group detail, failure mapping and `selfMemberId` read
  by the permission rule.
- DISC-001-05f (group expenses) — the expense list and form that the edit screen reuses.
- DISC-001-05g (balances and settlements) — the settlement history that gains the row actions.
- Merge order: 05f and 05g touch the same api-client file and the same group lists; this ticket branches
  from `origin/main` and rebases after them.
- FEAT-004 (design system) — components and tokens.

## Decision Log
- 2026-10-11: Owner approved adding GET /groups/:id/settlements/:settlementId; the 05h PRD's 'no new endpoint' premise was wrong because no read-one route existed; proposed by the model, approved by the owner.
- 2026-10-11: Group web UI split into 05e to 05h; 05h covers editing, the log and the conflict layer.
  Proposed by the model, awaiting the owner's acceptance.
- 2026-10-11: Edits and deletes are written to the 04e group queue and sent by its sync pass, instead of
  calling the API directly from the form. This is what makes the conflict, failed and waiting states
  exist, and it keeps one path for online and interrupted connections; the cost is that a server refusal
  such as 403 reaches the person after the pass, as a failed row, not inline under the form. Proposed by
  the model, awaiting the owner's acceptance.
- 2026-10-11: Creation stays online only; the PRD 05 "online only" decision is read as "no offline entry of
  new records and no offline screens", not as "no queue for changes to loaded records". Proposed by the
  model, awaiting the owner's acceptance.
- 2026-10-11: The viewer may edit when their member id equals `createdByMemberId` or their role is admin,
  computed in the browser from the group detail; the server stays the authority. Proposed by the model,
  awaiting the owner's acceptance.
- 2026-10-11: A consolidated settlement is detected by the settlement's `rate` being present; it offers
  deletion only, as the API answers 409 `GROUP_SETTLEMENT_CONSOLIDATED` to an edit. Proposed by the model,
  awaiting the owner's acceptance.
- 2026-10-11: The activity page is a separate route under the group, so the detail keeps its 2-request
  budget (05e NFR-02). Proposed by the model, awaiting the owner's acceptance.
- Open question 1: where does the shell's group sync status link? Recommended: the groups list, because the
  queue count knows no group; alternative: store the group id in the count and link to the first group with
  a conflict.
- 2026-10-11: Open question 2 resolved by the owner: edits and deletes always go through the queue, one path, no direct call first.
- 2026-10-11: Open question 1 resolved by the owner: the shell's group sync status links to the groups list.

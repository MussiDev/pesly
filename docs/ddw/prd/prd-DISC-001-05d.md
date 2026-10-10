# PRD DISC-001-05d: Editing Rules and Activity Log

| Field | Value |
|-------|-------|
| Ticket | DISC-001-05d |
| Tracker | none |
| Date | 2026-10-10 |
| PRD loops | 0 |
| Loops since last human decision | 0 |

## Context and Problem
Last of four sub-tickets of Groups & Expense Splitting (parent index: `prd-DISC-001-05.md`). Shared
money needs protection: a group expense or settlement can be changed or deleted only by the member
who recorded it or by an admin, and every change must be visible to all members. Creation entries
of the activity log are written by DISC-001-05b (expenses) and DISC-001-05c (settlements); this
ticket adds editing and deleting under the permission rule, logs those changes with the values
before and after, and lets every member read the log. Completing it unblocks DISC-001-04e (conflicts
on group movements). Split from `prd-DISC-001-05.md` (2026-10-10, user decision).

## Goals
- Only the author of a record, or an admin, changes it.
- Every change is recorded, visible to all members and impossible to rewrite.

## Functional Requirements
- FR-01: The system must allow only the member who recorded a group expense or settlement, or an
  admin, to edit or delete it.
- FR-02: The system must apply an edit or deletion of a group expense or settlement and update the
  balances of the group and the personal figures of the members involved.
- FR-03: The system must add to the group activity log an entry for every edit and deletion of a
  group expense or settlement, with the action, the member who did it, the date and time, and the
  values before and after for edits.
- FR-04: The system must show the group activity log to every member of the group, newest first.
- FR-05: The system must reject any attempt to edit or delete an entry of the activity log.
- FR-06: The system must allow only members of a group to read its activity log.

## Non-Functional Requirements
- NFR-01: 100% of creations, edits and deletions of group expenses and settlements must appear in
  the activity log, verified by an automated test over every write path, and log entries must never
  be edited or deleted while the group exists.
- NFR-02: Amounts stored in log entries must be 64-bit integers in minor units, with 0
  floating-point columns or fields for money (concept decision).

## Acceptance Criteria
- AC-01 (FR-01): WHEN the member who recorded a group expense edits or deletes it, THE system SHALL
  apply the change.
- AC-02 (FR-01): WHEN an admin who did not record a group settlement edits or deletes it, THE
  system SHALL apply the change.
- AC-03 (FR-01): IF a member who is neither the one who recorded a group expense nor an admin tries
  to edit or delete it, THEN THE system SHALL reject it and leave the expense unchanged.
- AC-04 (FR-01): IF a member who is neither the one who recorded a settlement nor an admin tries to
  edit or delete it, THEN THE system SHALL reject it and leave the settlement unchanged.
- AC-05 (FR-02): WHEN an expense of 40,000.00 ARS is edited to 60,000.00 ARS, THE system SHALL
  recompute its shares and update the balances of the group.
- AC-06 (FR-02): WHEN a settlement is deleted, THE system SHALL restore the balances to what they
  were before it.
- AC-07 (FR-02): IF an edit of a group expense results in an invalid split, THEN THE system SHALL
  reject it and leave the expense unchanged.
- AC-08 (FR-03): WHEN a group expense or settlement is edited, THE system SHALL add a log entry
  with the action, the member, the date and time, and the values before and after.
- AC-09 (FR-03): WHEN a group expense or settlement is deleted, THE system SHALL add a log entry
  with the action, the member, the date and time, and the values it had.
- AC-10 (FR-04): WHEN any member opens the group activity log, THE system SHALL show all its
  entries, newest first.
- AC-11 (FR-05): IF a request tries to edit or delete a log entry, THEN THE system SHALL reject it
  and leave the entry unchanged.
- AC-12 (FR-06): IF a user who is not a member of a group requests its activity log, THEN THE
  system SHALL answer 404 Not Found.

## Out of Scope
- Conflicts when a group expense is edited offline by two members (DISC-001-04e).
- Undoing or restoring a deleted record.
- Comments, reactions or chat on expenses.
- Filtering or searching the activity log.
- Email or push notifications of group activity (PRD 08 covers reminders).

## Risks and Mitigations
- **An admin abuses edit rights** → every change is logged with before and after values and visible
  to all members (FR-03, FR-04).
- **A record changes without an entry** → NFR-01 requires a test over every write path; creation
  entries are written by DISC-001-05b and DISC-001-05c.
- **Editing breaks the zero-sum balances** → the edit recomputes shares with the rules of
  DISC-001-05b and keeps the invariant of DISC-001-05c (FR-02, AC-05).
- **Concurrent offline edits** → explicit conflicts per DISC-001-04e.

## Dependencies
- DISC-001-05a (Groups, Members and Roles) — roles and membership.
- DISC-001-05b (Group Expenses and Splits) — the expenses edited and their creation log entries.
- DISC-001-05c (Balances and Settlements) — the settlements edited and the balances recomputed.
- Unblocks DISC-001-04e (Conflicts on Group Movements).
- Database migration: assigned at PLAN if the log table needs changes; its journal `when` must be
  greater than the maximum on `main` when it merges.

## Decision Log
- 2026-09-25: Only the member who recorded an expense or an admin edits or deletes it; the activity
  log is visible to all members and immutable (original Decision Log).
- 2026-10-10: Parent PRD split into DISC-001-05a to 05d by user decision.
- 2026-10-10: The original NFR-06 ("100% of changes appear in the log") is stated here as the
  verification over every write path, while creation entries are FR-12 of 05b and FR-12 of 05c.
  Listed in the parent index.

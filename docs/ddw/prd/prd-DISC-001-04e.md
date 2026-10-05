# PRD DISC-001-04e: Conflicts on Group Movements

| Field | Value |
|-------|-------|
| Ticket | DISC-001-04e |
| Tracker | none |
| Date | 2026-10-04 |
| PRD loops | 0 |
| Loops since last human decision | 0 |

## Context and Problem
Last of five sub-tickets of Offline Entry & Sync (parent index: `prd-DISC-001-04.md`). A movement
shared through a group can be changed by several members, so "the last change wins" would silently
erase someone else's work. For group movements the rule is explicit: a change made on an older
version than the server's is not applied, it becomes a conflict, and the user chooses which of the
two versions to keep. **This ticket is blocked until PRD 05 (Groups & Expense Splitting) is built:**
until then no movement is a group movement. Split from `prd-DISC-001-04.md` (2026-10-04, user
decision). Requirement IDs were renumbered; the parent index maps every original ID to its new one.

## Goals
- Never apply a change to a group movement on top of a newer server version.
- Show both versions and let the user keep one.
- Keep the server version for everyone until the conflict is resolved.

## Functional Requirements
- FR-01: The system must not apply a change to a group movement made on a version older than the
  one on the server, and must mark it as a conflict.
- FR-02: The system must show the user both versions of a group movement in conflict (theirs and
  the server's) and let them keep one of the two.
- FR-03: The system must keep the server version of a group movement in conflict until the user
  resolves the conflict.
- FR-04: The system must show the sync state conflict on a group movement in conflict.

## Non-Functional Requirements
- NFR-01: Resolving a conflict must delete 0 versions before the user chooses one, verified by a
  test that interrupts the resolution at a random point 1,000 times.

## Acceptance Criteria
- AC-01 (FR-01): IF a change to a group movement arrives based on a version older than the
  server's, THEN THE system SHALL not apply it and SHALL mark it as a conflict.
- AC-02 (FR-02): WHEN a user opens a group movement in conflict, THE system SHALL show their
  version and the server version side by side and offer "keep mine" and "keep server's".
- AC-03 (FR-02): WHEN a user chooses "keep mine" in a conflict, THE system SHALL apply their
  version on the server as a new version and mark the movement as synced.
- AC-04 (FR-03): WHILE a group movement is in conflict, THE system SHALL show the server version
  to the other group members.
- AC-05 (FR-04): WHEN a group movement is in conflict, THE system SHALL show its sync state as
  conflict.

## Out of Scope
- Field-by-field merging of conflicting changes.
- Conflicts on personal movements (last change wins, DISC-001-04c).
- Offline creation or editing of groups and group membership.
- Notifying other members that a conflict exists.

## Risks and Mitigations
- **Group members lose each other's changes** → explicit conflicts, with the server version kept
  until the user resolves them (FR-01 to FR-03).
- **A conflict nobody resolves** → the server version stays valid for the other members (FR-03);
  a reminder to resolve it is out of scope.
- **The blocking dependency** → no group movement exists until PRD 05 is built; this PRD is
  validated now so the contract is recorded, and it starts only when PRD 05 is merged.
- **Knowing which version a change was based on** → the movement needs a version that changes with
  every edit; whether it is a counter or a timestamp, and the migration it needs, is a decision for
  this ticket's PLAN.

## Dependencies
- DISC-001-04c (Offline Edit and Delete, Sync States, Failures and Retries) — the queue of edits
  and the sync states (FR-01, FR-04).
- PRD 05 (Groups & Expense Splitting) — which movements are group movements and who the other
  members are (FR-01 to FR-04). **Blocking.**
- PRD 03 (Movements & Exchange Rates) — the movement the new version is stored on (FR-02).

## Decision Log
- 2026-09-25: Conflict strategy is mixed: last change wins for personal movements, explicit user
  choice for group movements (user approval recorded in the original `prd-DISC-001-04.md`).
- 2026-10-04: Parent PRD split into DISC-001-04a to 04e by user decision.
- 2026-10-04: FR-04, AC-05 and NFR-01 were added while splitting: FR-04 and AC-05 carry the
  conflict state that the original FR-09 listed and DISC-001-04c leaves out; NFR-01 turns the
  original FR-14 ("keep the server version until the user resolves") into a measurable number.
  Listed in the parent index.

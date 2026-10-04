# PRD DISC-001-04c: Offline Edit and Delete, Sync States, Failures and Retries

| Field | Value |
|-------|-------|
| Ticket | DISC-001-04c |
| Tracker | none |
| Date | 2026-10-04 |
| PRD loops | 0 |
| Loops since last human decision | 0 |

## Context and Problem
Third of five sub-tickets of Offline Entry & Sync (parent index: `prd-DISC-001-04.md`). With
DISC-001-04b a new movement can be recorded offline and synced. People also correct and remove
movements (PRD 03), and a user who cannot see what is still waiting cannot trust the app. This
ticket adds editing and deleting the cached movements offline, the sync state of every movement,
the count of waiting changes, last-change-wins for personal movements, failed changes that the
server rejects, and retries with backoff. Split from `prd-DISC-001-04.md` (2026-10-04, user
decision). Requirement IDs were renumbered; the parent index maps every original ID to its new one.

## Goals
- Edit and delete the cached movements with no connectivity.
- Make the sync state visible so the user always knows what is not yet on the server.
- Settle conflicts on personal movements, and give a failed change a way out.

## Functional Requirements
- FR-01: The system must allow a signed-in user to edit and delete their cached movements while
  the device has no connectivity.
- FR-02: The system must show the sync state of every movement: pending, synced or failed.
- FR-03: The system must show the number of changes waiting to be synced.
- FR-04: The system must apply the last change received by the server when two changes to the
  same personal movement conflict.
- FR-05: The system must mark as failed a queued change that the server rejects on validation
  (for example, an archived account), and let the user edit it and retry, or discard it.
- FR-06: The system must retry sending queued changes that failed because of network or server
  errors.
- FR-07: The system must send the queued edits and deletions to the server automatically when
  connectivity returns.

## Non-Functional Requirements
- NFR-01: Retries must use exponential backoff starting at 5 s and capped at 5 minutes between
  attempts.

## Acceptance Criteria
- AC-01 (FR-01): WHILE the device has no connectivity, WHEN a user edits or deletes one of their
  cached movements, THE system SHALL apply it on the device and queue the change as pending.
- AC-02 (FR-02): WHEN a movement changes sync state, THE system SHALL show its current state:
  pending, synced or failed.
- AC-03 (FR-03): WHILE there are changes waiting to be synced, THE system SHALL show their count.
- AC-04 (FR-04): WHEN two changes to the same personal movement reach the server, THE system
  SHALL keep the one received last and mark both devices' copies as synced with that version.
- AC-05 (FR-05): IF the server rejects a queued change on validation, THEN THE system SHALL mark
  it as failed, show the reason, and offer to edit and retry or discard it.
- AC-06 (FR-06): IF sending a queued change fails because of a network or server error, THEN THE
  system SHALL keep it pending and retry it.
- AC-07 (FR-07): WHEN connectivity returns with a queued edit or deletion, THE system SHALL start
  sending it without any user action.

## Out of Scope
- The conflict sync state and conflict resolution on group movements (DISC-001-04e).
- Session expiry, sign out and wiping local data (DISC-001-04d).
- Field-by-field merging of conflicting changes.
- Conflict resolution for personal movements by user choice.
- Editing or deleting movements older than the 100 most recent without connectivity.
- Background sync while the app is closed.

## Risks and Mitigations
- **Silent overwrite of personal edits (last change wins)** → accepted by decision: it is the same
  person on two devices, conflicts are rare and low-impact.
- **Queued changes become invalid by the time they sync** (archived account, deleted category) →
  the failed state with edit-and-retry (FR-05).
- **A flood of retries against a failing server** → exponential backoff capped at 5 minutes
  (NFR-01).
- **A change to a movement that was deleted on another device** → the server answers not found:
  the change is a failed change with its reason (FR-05); the exact wording is a decision for this
  ticket's PLAN.

## Dependencies
- DISC-001-04b (Offline Entry and Sync of New Movements) — the local queue, the sync engine and
  the idempotent write (FR-04, FR-06, FR-07).
- DISC-001-04a (Local Store, App Shell and Reference Cache) — the 100 cached movements (FR-01).
- PRD 03 (Movements & Exchange Rates) — editing and deleting movements, and the validation the
  server applies (FR-01, FR-05).
- PRD 02 (Accounts & Categories) — archived accounts and categories that make a change fail
  (FR-05).

## Decision Log
- 2026-09-25: Conflict strategy is mixed: last change wins for personal movements, explicit user
  choice for group movements (user approval recorded in the original `prd-DISC-001-04.md`).
- 2026-10-04: Parent PRD split into DISC-001-04a to 04e by user decision.
- 2026-10-04: FR-07 and AC-07 were added while splitting: the original FR-04 and AC-05 sent "the
  queued changes" and DISC-001-04b sends the new movements, so this ticket sends the edits and
  deletions. The state set of FR-02 has three states here; the fourth, conflict, is added by
  DISC-001-04e. Listed in the parent index.

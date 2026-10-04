# PRD DISC-001-04d: Session, Sign Out and Local Data

| Field | Value |
|-------|-------|
| Ticket | DISC-001-04d |
| Tracker | none |
| Date | 2026-10-04 |
| PRD loops | 0 |
| Loops since last human decision | 0 |

## Context and Problem
Fourth of five sub-tickets of Offline Entry & Sync (parent index: `prd-DISC-001-04.md`). Once
movements wait on the device, three things about the person using it matter: a session that expires
while offline must not lose the queue, a different person signing in on the same device must not
send someone else's changes, and financial data must not stay on a shared or lost device after a
sign out. This ticket covers the session behavior of the queue, the warning at sign out and the
wipe of the local data. Split from `prd-DISC-001-04.md` (2026-10-04, user decision). Requirement
IDs were renumbered; the parent index maps every original ID to its new one.

## Goals
- Keep the queue through an expired session and sync it after the same user signs in again.
- Never send one user's changes under another user.
- Remove every trace of a user's data from the device when they sign out.

## Functional Requirements
- FR-01: The system must keep the local queue when the session expires while offline, and sync it
  after the same user signs in again.
- FR-02: The system must not send the pending changes of a user under a different signed-in user.
- FR-03: The system must warn a user who signs out with changes pending sync.
- FR-04: The system must delete all local data of a user from the device when they confirm the
  sign out.

## Non-Functional Requirements
- NFR-01: 100% of a user's local data (queue, cached entities, recent movements) must be removed
  from the device after a confirmed sign out.

## Acceptance Criteria
- AC-01 (FR-01): IF the session expires while there are pending changes, THEN THE system SHALL
  keep them and sync them after the same user signs in again.
- AC-02 (FR-02): IF a different user signs in on the device while another user's changes are
  pending, THEN THE system SHALL not send those changes under the new user.
- AC-03 (FR-03): WHEN a user with pending changes chooses to sign out, THE system SHALL warn that
  the pending changes will be lost and ask for confirmation.
- AC-04 (FR-04): WHEN a user confirms the sign out, THE system SHALL delete their queue, cached
  entities and cached movements from the device.

## Out of Scope
- Offline sign-in or registration.
- Keeping a user's local data after a confirmed sign out.
- Moving pending changes from one user to another.
- Encryption of local data beyond what the browser and operating system provide.
- Wiping the data of the user who is no longer signed in when a different user signs in (a
  decision for this ticket's PLAN, see the parent index).

## Risks and Mitigations
- **Financial data left on a shared or lost device** → the local data is wiped on a confirmed sign
  out (FR-04, NFR-01); stronger device-level protection is out of scope.
- **Pending changes lost on sign out** → the user is warned and must confirm (FR-03).
- **Changes sent under the wrong user** → the queue belongs to the user who created it and is never
  sent under another one (FR-02).
- **A sign out that is interrupted half way** → the wipe must leave no partial data readable; the
  mechanism is a decision for this ticket's PLAN.

## Dependencies
- DISC-001-04b (Offline Entry and Sync of New Movements) — the local queue (FR-01, FR-02).
- DISC-001-04a (Local Store, App Shell and Reference Cache) — the cached entities and movements to
  wipe (FR-04).
- PRD 01 (Identity & Access) — sessions, session expiry and sign out (FR-01 to FR-04).

## Decision Log
- 2026-09-25: Pending changes are lost on a confirmed sign out (user approval recorded in the
  original `prd-DISC-001-04.md`).
- 2026-10-04: Parent PRD split into DISC-001-04a to 04e by user decision.
- 2026-10-04: The original FR-17 held two behaviors, keeping the queue through an expired session
  and not sending it under another user; they are FR-01 and FR-02 here, so each has its own
  criterion. Listed in the parent index.

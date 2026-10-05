# PRD DISC-001-04b: Offline Entry and Sync of New Movements

| Field | Value |
|-------|-------|
| Ticket | DISC-001-04b |
| Tracker | none |
| Date | 2026-10-04 |
| PRD loops | 0 |
| Loops since last human decision | 0 |

## Context and Problem
Second of five sub-tickets of Offline Entry & Sync (parent index: `prd-DISC-001-04.md`). The
core use case is writing down an expense at the moment of paying, on the subway or in a basement
bar. With the local store and the cached reference data of DISC-001-04a, a movement can now be
recorded without connectivity: it goes to a durable local queue with an identifier generated on
the device, and it is sent to the server when connectivity returns, once and without duplicates.
This ticket covers new movements only; edits, deletions, states, failures and retries come in
DISC-001-04c. Split from `prd-DISC-001-04.md` (2026-10-04, user decision). Requirement IDs were
renumbered; the parent index maps every original ID to its new one.

## Goals
- Record expenses, incomes, transfers and currency exchanges with no connectivity, with the same
  form as online.
- Send them automatically when connectivity returns, with no duplicates and no losses.

## Functional Requirements
- FR-01: The system must allow a signed-in user to record expenses, incomes, transfers and
  currency exchanges (PRD 03) while the device has no connectivity.
- FR-02: The system must assign every movement created on the device a globally unique
  identifier generated on the device.
- FR-03: The system must keep movements recorded without connectivity in a local queue that
  survives closing the app and restarting the device.
- FR-04: The system must send the queued new movements to the server automatically when
  connectivity returns.
- FR-05: The system must store each movement only once on the server, even when the device sends
  it more than once.
- FR-06: The system must require a manual rate on an expense or income recorded without
  connectivity when the device has no stored rate.

## Non-Functional Requirements
- NFR-01: The local queue must hold at least 1,000 pending movements.
- NFR-02: Syncing 100 pending movements must finish in < 10 s on a 4G connection (reference: 10
  Mbps down, 5 Mbps up, 50 ms latency).
- NFR-03: Sync must lose 0 movements and create 0 duplicates in a test that cuts connectivity at
  a random point during 1,000 sync runs.

## Acceptance Criteria
- AC-01 (FR-01): WHILE the device has no connectivity, WHEN a user saves a valid expense, THE
  system SHALL store it in the local queue and show it in the movement list as pending.
- AC-02 (FR-01): WHILE the device has no connectivity, WHEN a user saves a valid transfer or
  currency exchange, THE system SHALL store it in the local queue as pending.
- AC-03 (FR-02): WHEN a movement is created on the device, THE system SHALL assign it a UUID
  before storing it, with or without connectivity.
- AC-04 (FR-03): WHEN a user closes the app with 5 pending movements and opens it again, THE
  system SHALL still show those 5 movements as pending.
- AC-05 (FR-04): WHEN connectivity returns with pending movements, THE system SHALL start sending
  them without any user action.
- AC-06 (FR-05): IF the device sends the same movement twice (for example, the connection dropped
  before the response arrived), THEN THE system SHALL store it only once on the server.
- AC-07 (FR-06): IF a user records an expense or income without connectivity and the device has
  no stored rate, THEN THE system SHALL require a manual rate before saving.

## Out of Scope
- Editing and deleting movements without connectivity (DISC-001-04c).
- The four sync states, the count of waiting changes, failed changes and retries with backoff
  (DISC-001-04c).
- Session expiry, sign out and wiping local data (DISC-001-04d).
- Conflicts on group movements (DISC-001-04e).
- Offline creation of accounts, categories, groups, goals, budgets, investments and recurring
  payments (only movements work offline).
- Background sync while the app is closed (sync runs when the app is open).

## Risks and Mitigations
- **Duplicates from retries** → identifiers generated on the device and an idempotent write on the
  server (FR-02, FR-05, NFR-03).
- **A queued movement that the server rejects stays unseen until DISC-001-04c lands** → the
  parent index records as a pending decision that 04b and 04c are released together; until the
  user decides, 04b is not deployed alone.
- **The queue is lost when the browser evicts storage** → DISC-001-04a requests persistent
  storage and warns when it is denied.
- **A queued movement becomes invalid by the time it syncs** (archived account, deleted category)
  → handled as a failed change in DISC-001-04c.

## Dependencies
- DISC-001-04a (Local Store, App Shell and Reference Cache) — the local store, the service worker
  and the cached reference data (FR-01, FR-06).
- PRD 01 (Identity & Access) — the session the sync sends under (FR-04).
- PRD 02 (Accounts & Categories) — accounts and categories a queued movement refers to (FR-01).
- PRD 03 (Movements & Exchange Rates) — movement types, validation and stored rates (FR-01, FR-05,
  FR-06); the create contract gains an identifier chosen by the device.
- Browser platform: IndexedDB — FR-03.

## Decision Log
- 2026-09-25: Offline entry with later sync; only movements work offline; a manual rate is
  required when none is stored; sync only while the app is open (user approval recorded in the
  original `prd-DISC-001-04.md`).
- 2026-10-04: Parent PRD split into DISC-001-04a to 04e by user decision.
- 2026-10-04: FR-04 covers new movements here; the same requirement for edits and deletions is in
  DISC-001-04c. Listed in the parent index.

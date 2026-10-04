# PRD DISC-001-04a: Local Store, App Shell and Reference Cache

| Field | Value |
|-------|-------|
| Ticket | DISC-001-04a |
| Tracker | none |
| Date | 2026-10-04 |
| PRD loops | 0 |
| Loops since last human decision | 0 |

## Context and Problem
First of five sub-tickets of Offline Entry & Sync (parent index: `prd-DISC-001-04.md`). Writing down
an expense at the moment of paying only works if the app starts without connectivity and has what
the entry form needs: the user's accounts, categories, tags and a rate. Today the app needs the
network for everything: nothing is stored on the device and nothing is cached by a service worker.
This ticket is the foundation the rest builds on: a per-user local store, the cached application
shell, a device copy of the reference data and of the most recent movements, and the browser's
persistent storage. Split from `prd-DISC-001-04.md` (2026-10-04, user decision). Requirement IDs
were renumbered; the parent index maps every original ID to its new one.

## Goals
- Start the app and open the entry form with no connectivity.
- Keep on the device what the entry form and the movement list need.
- Protect the local data from being evicted by the browser, and say so when that is not possible.

## Functional Requirements
- FR-01: The system must keep on the device a copy of the signed-in user's active accounts, active
  categories, tags, default rate type and latest stored rates.
- FR-02: The system must keep on the device the user's 100 most recent movements.
- FR-03: The system must show the 100 most recent movements in the movement list without
  connectivity.
- FR-04: The system must cache the application shell (HTML, JavaScript, CSS and icons) with a
  service worker, so the app starts without connectivity after one online visit.
- FR-05: The system must request persistent storage from the browser where the browser supports
  it.
- FR-06: The system must warn the user when the browser denies persistent storage.

## Non-Functional Requirements
- NFR-01: The entry form must open in < 1 s without connectivity on a mid-range phone (reference:
  4 GB RAM, 2021 hardware).
- NFR-02: The application shell must start with 0 network requests when the device is offline.

## Acceptance Criteria
- AC-01 (FR-01): WHILE the device has no connectivity, WHEN a user opens the entry form, THE
  system SHALL offer their active accounts, active categories and tags, and prefill the rate with
  the latest stored rate of their default rate type.
- AC-02 (FR-03): WHILE the device has no connectivity, WHEN a user opens the movement list, THE
  system SHALL show their 100 most recent movements.
- AC-03 (FR-02): WHEN a user has more than 100 movements and the device loads them online, THE
  system SHALL keep on the device only the 100 most recent.
- AC-04 (FR-04): WHILE the device has no connectivity, WHEN a user opens the app after at least
  one online visit, THE system SHALL start from the cached application shell.
- AC-05 (FR-05): WHEN a user signs in on a browser that supports persistent storage, THE system
  SHALL request persistent storage.
- AC-06 (FR-06): IF the browser denies persistent storage, THEN THE system SHALL warn the user
  that the browser can remove the data kept on the device.

## Out of Scope
- Saving a movement without connectivity and the local queue of pending changes (DISC-001-04b).
- Editing and deleting cached movements without connectivity (DISC-001-04c).
- Wiping the local data on sign out (DISC-001-04d).
- Conflicts on group movements (DISC-001-04e).
- Full offline browsing of history beyond the 100 most recent movements.
- Background sync while the app is closed.
- Encryption of local data beyond what the browser and operating system provide.

## Risks and Mitigations
- **Browsers evict local storage under pressure (notably iOS Safari)** → persistent storage is
  requested (FR-05) and the user is warned when it is denied (FR-06).
- **Saving still needs connectivity until DISC-001-04b lands** → the form opens offline, but a
  save without connectivity keeps answering with the existing network error; this ticket does not
  hide it.
- **A stale application shell after a new deploy** → the service worker installs the new version in
  the background and the next start uses it; the update strategy is a decision for this ticket's
  PLAN (see the parent index, pending decisions).
- **The cached reference data goes stale** → when it refreshes is a decision for this ticket's
  PLAN (see the parent index, pending decisions).

## Dependencies
- PRD 01 (Identity & Access) — the signed-in user the local store belongs to (FR-01, FR-05).
- PRD 02 (Accounts & Categories) — accounts and categories copied to the device (FR-01).
- PRD 03 (Movements & Exchange Rates) — movements, tags and stored rates read from the API (FR-01,
  FR-02).
- Browser platform: Service Worker, IndexedDB and the Storage API (`navigator.storage.persist`)
  — FR-01, FR-04, FR-05.

## Decision Log
- 2026-09-25: Offline entry with later sync; full offline browsing out of scope (concept). 100
  most recent movements cached; persistent storage requested with a warning if denied (user
  approval recorded in the original `prd-DISC-001-04.md`).
- 2026-10-04: Parent PRD split into DISC-001-04a to 04e by user decision.
- 2026-10-04: FR-04, FR-05, FR-06 and AC-03 to AC-06 were added while splitting: FR-04 turns the
  original NFR-07 into a requirement, FR-05 and FR-06 apply the persistent-storage decision of
  2026-09-25. Listed in the parent index as added while splitting.

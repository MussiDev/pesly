# Threat model DISC-001-04c: Offline Edit and Delete, Sync States, Failures and Retries

| Field | Value |
|-------|-------|
| Ticket | DISC-001-04c |
| Spec | docs/ddw/specs/spec-DISC-001-04c.md |
| Tier | FEATURE |
| Date | 2026-10-06 |

## Components
| Component | Source in the spec |
|---|---|
| `apps/web/src/lib/local-store/stores.ts`, `apps/web/src/lib/local-store/queue.ts`, `apps/web/src/lib/local-store/device-copy.ts` and `apps/web/src/lib/sync/sync-events.ts` | Block 1 |
| `apps/web/src/features/movements/sync-overlay.ts` | Block 2 |
| `apps/web/src/lib/sync/sync-pass.ts`, `apps/web/src/lib/sync/sync-queue.ts`, `apps/web/src/lib/sync/backoff.ts` and `apps/web/src/lib/local-store/reference-cache.ts` | Block 3 |
| `apps/web/src/features/movements/containers/edit-movement-container.tsx`, `apps/web/src/features/movements/containers/edit-movement-route-container.tsx`, `apps/web/src/features/movements/use-movement-form-data.ts` and `apps/web/src/lib/service-worker/shell-cache.ts` | Block 4 |
| `apps/web/src/features/movements/containers/movements-container.tsx`, `apps/web/src/features/movements/components/movement-row.tsx` and `apps/web/src/features/movements/sync-failure.ts` | Block 5 |
| `apps/web/src/features/shell/components/sync-status.tsx` and `apps/web/src/features/shell/containers/authenticated-shell-container.tsx` | Block 6 |

## Trust boundaries
- Browser → API: the sync pass now sends `PUT /movements/:id` with an edit (amount, date, note, tags, rate, account and category ids) and `DELETE /movements/:id`, under the session cookie and the web origin headers, over the public internet.
- Page → IndexedDB: scripts of the web origin write queued edits and deletions, with the server movement each one changes (`base`), into the per-user `queue` store, and write the server's answers into the `movements` copy; financial data kept on the device in plain form under the browser's per-origin isolation.
- Tab ↔ tab: several tabs of one user share the queue, the `pesly-sync-<userId>` lock and the `pesly:queue-changed` window event, which carries no data.
- Address bar → edit screen: `/movements/edit?id=<id>` takes the movement id from the query string, which anyone can type or link.
- Device owner → browser profile: anyone with the unlocked device or the browser profile can read the queue and the copy, as in DISC-001-04a and 04b.
- Queue → API session: the pass sends what one user queued under the session the API confirmed in this visit.

## STRIDE analysis
### `apps/web/src/lib/local-store/stores.ts`, `apps/web/src/lib/local-store/queue.ts`, `apps/web/src/lib/local-store/device-copy.ts` and `apps/web/src/lib/sync/sync-events.ts`
- **Spoofing:** the queue lives in the database named for the pointer's user (04a); a record carries no owner, and the server decides ownership from the session (R-03).
- **Tampering:** every record is parsed with `queuedChangeSchema` on write and on read (operation, UUID id equal to `base.id` and to the create request's id, shared request schemas, revision, short code); a record that does not parse is skipped and kept, never sent (R-04).
- **Repudiation:** the queue is local state with no audit value; the server logs every `PUT` and `DELETE` with the movement id (existing routes).
- **Information Disclosure:** `pesly:queue-changed` carries no data; the rejection code is a short code with no movement data and is never rendered as text (R-07).
- **Denial of Service:** one record per movement id bounds the queue by the movements the user touches, and every collapse runs in one transaction, so two writes cannot leave two records for one id (R-05).
- **Elevation of Privilege:** the queue grants nothing: every queued change is validated again by the API's scope, schemas and business rules.

### `apps/web/src/features/movements/sync-overlay.ts`
- **Spoofing:** not applicable; it is a pure function of the loaded page and the queue of the same user.
- **Tampering:** it changes nothing; a record whose request type differs from its base is shown as its base, so a malformed record cannot change what a server row looks like.
- **Repudiation:** not applicable; nothing is written.
- **Information Disclosure:** it shows only the user's own server rows and queued changes, already on the device.
- **Denial of Service:** it is linear in the page plus the queue (at most a few hundred items).
- **Elevation of Privilege:** not applicable; it renders data and calls nothing.

### `apps/web/src/lib/sync/sync-pass.ts`, `apps/web/src/lib/sync/sync-queue.ts`, `apps/web/src/lib/sync/backoff.ts` and `apps/web/src/lib/local-store/reference-cache.ts`
- **Spoofing:** a pass runs only for the user the API confirmed in this visit, and the server scopes `PUT` and `DELETE` by the session, so a change queued by another user of the device answers 404 and is flagged, never applied to the wrong account (R-03).
- **Tampering:** settling is conditional on the sent revision inside one transaction, so a success never deletes a newer local change and a newer edit is never swallowed by a create replay (R-01); the last change received by the server wins, by the PRD's decision (R-02).
- **Repudiation:** the API logs each edit and delete with request id, user id and movement id; the pass logs nothing about requests.
- **Information Disclosure:** the copy written after a send holds the server's own answer for the same user, in the same store 04a already keeps; nothing is logged (R-07).
- **Denial of Service:** at most 4 requests in flight, a stop on network, server and limit errors, one timer per tab with exponential backoff from 5 s capped at 300 s, no timer while offline or after an authentication stop (R-06).
- **Elevation of Privilege:** a `DELETE` answered 404 only settles the local record; it never deletes anything else.

### `apps/web/src/features/movements/containers/edit-movement-container.tsx`, `apps/web/src/features/movements/containers/edit-movement-route-container.tsx`, `apps/web/src/features/movements/use-movement-form-data.ts` and `apps/web/src/lib/service-worker/shell-cache.ts`
- **Spoofing:** the screen opens only movements found in the user's own queue, copy or a scoped `GET`; a foreign id answers the existing not-found view (R-08).
- **Tampering:** the query id must be a UUID before anything is read, and what the user types goes through `buildMovementRequest` and the shared update schema before it is queued or sent (R-08).
- **Repudiation:** the server logs the edit when it arrives.
- **Information Disclosure:** the not-available and not-found views say nothing about whether the id exists for someone else; the cached edit page is the same HTML for every id and holds no movement data (R-09).
- **Denial of Service:** one cached page more in the pages cache; the form copy is read, never written, by the edit screen.
- **Elevation of Privilege:** an archived account or category is offered only when the movement already uses it, as today; offline the copy holds only active ones.

### `apps/web/src/features/movements/containers/movements-container.tsx`, `apps/web/src/features/movements/components/movement-row.tsx` and `apps/web/src/features/movements/sync-failure.ts`
- **Spoofing:** the list reads the queue of the pointer's user only.
- **Tampering:** retry and discard act on one record by id inside the user's store; discard removes only the local change and never calls the API.
- **Repudiation:** a discarded change leaves no trace by design: it never reached the server.
- **Information Disclosure:** the failure reason is a catalog message chosen by the code; an unknown code shows the generic message and never the raw code (R-07).
- **Denial of Service:** a retry starts one pass under the same lock and backoff as any other.
- **Elevation of Privilege:** the delete confirmation of PRD 03 still precedes every delete, queued or not.

### `apps/web/src/features/shell/components/sync-status.tsx` and `apps/web/src/features/shell/containers/authenticated-shell-container.tsx`
- **Spoofing:** the counts are read for the pointer's user, the same rule as the offline shell of 04a.
- **Tampering:** the counts are derived from the queue on every read; nothing is stored.
- **Repudiation:** not applicable; it is a read-only indicator.
- **Information Disclosure:** it shows two numbers and no amount, account or note.
- **Denial of Service:** one cursor over the queue per queue-changed event.
- **Elevation of Privilege:** not applicable; the failed link only navigates to the list.

## Data classification
| Data | Class | At rest | In transit |
|---|---|---|---|
| Queued edits (amount, date, note, tags, rate, account and category ids) and the `base` server movement of each queued edit or deletion | financial | per-user IndexedDB database on a disk that the device operating system encrypts where the user has it on; under the decision recorded in R-04 of DISC-001-04a (R-07) | stays on the device until sent, then TLS |
| Server answers written into the device copy after a send | financial | the same per-user database and store that 04a already keeps | TLS |
| Movement amounts, dates, notes, tags and rates in `PUT /movements/:id` | financial | PostgreSQL volume encrypted at rest, owner-scoped statements with bound parameters (existing route) | TLS (production HTTPS guard), session cookie flagged Secure |
| Session cookie presented by the sync pass | credentials | not stored by this module; the identity module stores it hashed | TLS, cookie flagged Secure in production |
| Rejection code, revision, operation and the waiting counts | public | the same per-user database; no movement data | stays on the device |

## Risks and mitigations
| ID | Risk | STRIDE | Likelihood | Impact | Mitigation |
|---|---|---|---|---|---|
| R-01 | A change made while the previous version is in flight is lost: the pass's success deletes it, or the idempotent create replay swallows an edit of a pending create | T | Medium | High | Every record carries a revision; settle and reject run in one transaction and act only on the sent revision; a create changed in flight becomes an update of the stored movement; tests cover the in-flight edit and the 04b randomized duplicate test still runs (Blocks 1, 3) |
| R-02 | An edit on one device silently overwrites a newer edit made on another device (last change wins) | T | Medium | Low | Accepted by the PRD decision of 2026-09-25 for personal movements (same person, rare, low impact); both devices end on the server's version because every send writes the answer into the copy and reloads the list; group movements are DISC-001-04e (Block 3) |
| R-03 | One user's queued edit or delete is sent under another user's session on a shared device | S | Low | High | The queue is per-user, a pass starts only for the user confirmed in this visit, and the server scopes `PUT` and `DELETE` by the session, so a foreign id answers 404 and the change is flagged, not applied; the wipe on sign out is DISC-001-04d (Blocks 1, 3) |
| R-04 | A script of the web origin edits a queued record to change another movement | T | Low | Medium | The script could call the API with the cookie anyway; records are parsed on read and write, the API re-validates every field and scopes every id to the session (Blocks 1, 3) |
| R-05 | A delete of a pending create is dropped locally while the create already reached the server, so the movement comes back | T | Medium | Medium | A delete of any queued record is sent, never dropped; `DELETE` answering 404 counts as done; tests cover delete after create (Blocks 1, 3) |
| R-06 | Retries flood the API while it is failing | D | Medium | Medium | Exponential backoff from 5 s, doubling, capped at 300 s, reset only after a complete pass; at most 4 requests in flight; no timer while offline or after 401/403; `Retry-After` honored on 429; tests assert the sequence with fake timers (Block 3) |
| R-07 | Financial data of edits, the bases and the refreshed copy is readable from the device, or leaks through the failure text | I | Medium | Medium | Same data class and per-origin sandbox as R-04 of `threat-DISC-001-04a.md`, whose decision this ticket does not change; records leave the queue once settled; the failure reason is a catalog message selected by code, never the code or server text (Blocks 1, 5) |
| R-08 | The query id of the edit screen is used to probe or open another user's movement | E | Low | Medium | The id must be a UUID; the screen reads only the user's queue, copy and a session-scoped `GET` that answers 404 for foreign ids; tests cover a malformed and a missing id (Block 4) |
| R-09 | The cached edit page or the warm-up leaks one user's movement to another user of the device | I | Low | Medium | The cached HTML is the empty shell of the route (data loads client-side), the same for every id; the service worker still never caches API answers (Block 4) |
| R-10 | A failed change stays unseen and the user believes it was saved | D | Medium | High | Failed rows show a destructive badge and the reason, the shell shows the failed count with a link, and every failed change can be edited, retried or discarded (Blocks 5, 6) |

## Supply chain
No runtime dependency is added: IndexedDB, Web Locks and timers are platform APIs; `lucide-react` (already a dependency) provides the cloud-check icon; tests use `fake-indexeddb`, a dev dependency since DISC-001-04a. The audit (`pnpm audit --prod --audit-level high`) and the SAST step cover the change (R-04).

## Availability
The vectors are a retry storm against a failing API (R-06), a queue that grows with one record per touched movement (R-01, R-05) and a failed change nobody notices (R-10). The backoff with a 5-minute cap, the bounded concurrency, the one-record-per-id collapse and the visible failed state bound each of them. The API is unchanged, so a deploy order problem cannot arise: the routes this ticket sends to already exist.

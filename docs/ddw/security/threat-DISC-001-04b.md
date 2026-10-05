# Threat model DISC-001-04b: Offline Entry and Sync of New Movements

| Field | Value |
|-------|-------|
| Ticket | DISC-001-04b |
| Spec | docs/ddw/specs/spec-DISC-001-04b.md |
| Tier | FEATURE |
| Date | 2026-10-05 |

## Components
| Component | Source in the spec |
|---|---|
| `packages/shared/src/movements/movement.ts` | Block 1 |
| `apps/api/src/movements/infrastructure/db/drizzle-movement-write-limiter.ts`, `apps/api/src/movements/infrastructure/db/schema.ts` and `apps/api/drizzle/0018_device_write_limit.sql` | Block 2 |
| `apps/api/src/movements/infrastructure/db/drizzle-movement-repository.ts` and `apps/api/src/movements/application/create-movement.ts` | Block 3 |
| `apps/api/src/movements/application/record-device-movement.ts` | Block 4 |
| `apps/api/src/movements/infrastructure/http/movement-routes.ts` | Block 5 |
| `apps/web/src/lib/local-store/database.ts`, `apps/web/src/lib/local-store/stores.ts`, `apps/web/src/lib/local-store/queue.ts` and `apps/web/src/lib/local-store/device-copy.ts` | Block 6 |
| `apps/web/src/features/movements/movement-request.ts` | Block 7 |
| `apps/web/src/lib/sync/sync-pass.ts` | Block 8 |
| `apps/web/src/lib/sync/sync-queue.ts`, `apps/web/src/lib/sync/sync-events.ts` and `apps/web/src/features/shell/containers/authenticated-shell-container.tsx` | Block 9 |
| `apps/web/src/features/movements/containers/create-movement-container.tsx` and `apps/web/src/features/movements/containers/movements-container.tsx` | Block 10 |

## Trust boundaries
- Browser → API: `POST /movements` now carries an `id` chosen by the device and the movement's amount, date, note, tags and rate, under the session cookie, over the public internet.
- API → PostgreSQL: the lookup by id, the insert and the limiter upsert cross into the private database network as bound parameters.
- Page → IndexedDB: scripts of the web origin write the queue of unsent movements, which is financial data kept on the device in plain form under the browser's per-origin isolation.
- Tab ↔ tab: several tabs of the same user share one queue and one lock name (`pesly-sync-<userId>`), and talk through window events.
- Device owner → browser profile: anyone with the unlocked device or the browser profile can read the queue, as they can read the device copy of DISC-001-04a.
- Queue → API session: the sync pass sends what one user queued under whatever session the browser holds when it runs.

## STRIDE analysis
### `packages/shared/src/movements/movement.ts`
- **Spoofing:** the schema carries no owner; the owner comes from the session scope, so an `id` cannot name who owns the movement.
- **Tampering:** `id` is optional and must be a UUID, and unknown keys are stripped as before, so nothing else can ride along with it; the update schemas keep rejecting an `id` key.
- **Repudiation:** not applicable; the schema only describes a request.
- **Information Disclosure:** a malformed id answers the existing validation error and echoes nothing.
- **Denial of Service:** the id is 36 characters, so it adds no meaningful body size.
- **Elevation of Privilege:** the id grants no permission; every business rule still runs on the use case.

### `apps/api/src/movements/infrastructure/db/drizzle-movement-write-limiter.ts`, `apps/api/src/movements/infrastructure/db/schema.ts` and `apps/api/drizzle/0018_device_write_limit.sql`
- **Spoofing:** the counter is keyed by the owner from the session scope and by a bucket the server picks from the presence of the id, never from a header.
- **Tampering:** the bucket is a checked column (`manual` or `device`), so an invalid value cannot be stored (R-03).
- **Repudiation:** a limited request answers 429 with `Retry-After` and is logged by the error middleware with the request id and code.
- **Information Disclosure:** the counters hold a user id, a bucket, a window and a count, and nothing about movements.
- **Denial of Service:** the device bucket caps an owner at 600 creations per minute, replays are free but are a single indexed read, and an additive migration on a table of about one row per user cannot lock the database for long (R-03, R-09, R-10).
- **Elevation of Privilege:** spending the device bucket never changes the manual one, so the stricter 60 per minute stays for requests with no id.

### `apps/api/src/movements/infrastructure/db/drizzle-movement-repository.ts` and `apps/api/src/movements/application/create-movement.ts`
- **Spoofing:** the owner is the scope's user and never a parameter; the repository takes only an id from the caller (R-02).
- **Tampering:** the id is stored as a bound parameter, and a duplicate is a primary key violation that rolls back the whole transaction, tags included, instead of overwriting anything (R-04).
- **Repudiation:** the repository logs nothing; the route logs the movement id.
- **Information Disclosure:** a duplicate key becomes an internal error the use case handles, never a response that names the existing row's owner (R-01).
- **Denial of Service:** one extra indexed primary key lookup per request with an id.
- **Elevation of Privilege:** the insert still goes through the composite foreign keys that tie accounts and categories to the owner, so an id cannot attach a movement to another user's account.

### `apps/api/src/movements/application/record-device-movement.ts`
- **Spoofing:** `findById` and the re-read after a conflict both use the caller's scope, so another user's movement is never found and never returned (R-02).
- **Tampering:** a replay returns the stored movement and applies nothing from the payload it carries, so replaying a changed body cannot edit a movement (R-04).
- **Repudiation:** the route logs "movement created" or "movement replayed" with request id, user id and movement id, which tells a first save from a retry.
- **Information Disclosure:** an id of another user answers the standard 404, the same answer the rest of the API gives for data that is not the caller's (R-01).
- **Denial of Service:** a replay spends no unit and runs before validation, so a retry storm costs one read each; a new id spends one unit of the device bucket and a refused one is refunded (R-03, R-09).
- **Elevation of Privilege:** the replay lookup runs before validation on purpose, and it can only return a row the caller already owns, so skipping validation grants nothing.

### `apps/api/src/movements/infrastructure/http/movement-routes.ts`
- **Spoofing:** the route stays behind `requireSession` and `requireVerifiedEmail`, and the write scope comes from the access policy.
- **Tampering:** the body is validated by the shared schema before any use case runs, and a request with no id takes the unchanged manual path.
- **Repudiation:** both outcomes are logged with ids only (R-11).
- **Information Disclosure:** the 201 and 200 bodies are the stored movement of the caller, and a 404 or 429 body names nothing about the request.
- **Denial of Service:** the manual path keeps its 60 per minute and the id path its 600 per minute (R-03).
- **Elevation of Privilege:** an id does not change the access action: it stays a write, scoped to the caller.

### `apps/web/src/lib/local-store/database.ts`, `apps/web/src/lib/local-store/stores.ts`, `apps/web/src/lib/local-store/queue.ts` and `apps/web/src/lib/local-store/device-copy.ts`
- **Spoofing:** the queue lives in the per-user database `pesly-<userId>` of DISC-001-04a, so one user's code path opens that user's queue only (R-06).
- **Tampering:** a script of the same origin can edit a queued record, but it could also call the API with the user's cookie, so it gains nothing the server does not re-validate; every record is parsed on read and one that does not parse is skipped, never trusted (R-05).
- **Repudiation:** a queued record carries the device instant of the save, and the server keeps its own `createdAt`.
- **Information Disclosure:** the queue holds amounts, notes, tags and account ids in plain form until they sync, the same data class as the device copy (R-07).
- **Denial of Service:** a full disk or an upgrade blocked by another tab reports "not stored" and the save shows a message instead of losing the entry silently; `onversionchange` closes the connection so an old tab never blocks the upgrade (R-08).
- **Elevation of Privilege:** nothing in the queue is a credential, and the session cookie is not stored here.

### `apps/web/src/features/movements/movement-request.ts`
- **Spoofing:** the request carries no owner and no rate source other than `manual` offline.
- **Tampering:** the rate sent offline is the value shown on the form, which the user can edit; that is the same freedom as typing a manual rate online, and the server validates its range (R-12).
- **Repudiation:** a manual rate is stored with `rateSource: manual`, so it is never presented as an official quote.
- **Information Disclosure:** the builder only reads what the form holds and logs nothing.
- **Denial of Service:** an unparsable stored rate is treated as absent and the field is required, so it cannot produce an invalid request.
- **Elevation of Privilege:** a client that sends `manual` gets no capability that the online form does not already give.

### `apps/web/src/lib/sync/sync-pass.ts`
- **Spoofing:** the pass sends the items it was given and nothing else; it takes no user id of its own.
- **Tampering:** a failure that says nothing about an item keeps every item, and a rejection flags the item without deleting it, so no answer can silently drop a movement (R-04, R-08).
- **Repudiation:** a rejected item keeps the error code the server gave it for DISC-001-04c to show.
- **Information Disclosure:** the pass holds requests in memory and logs nothing about their contents.
- **Denial of Service:** at most 4 requests are in flight, the pass stops on `NETWORK`, `RATE_LIMITED`, `INTERNAL`, `UNAUTHENTICATED` and `EMAIL_NOT_VERIFIED`, and rejected items are skipped, so a bad item cannot loop (R-09).
- **Elevation of Privilege:** the pass has no way to pick an owner or a bucket; the server decides both.

### `apps/web/src/lib/sync/sync-queue.ts`, `apps/web/src/lib/sync/sync-events.ts` and `apps/web/src/features/shell/containers/authenticated-shell-container.tsx`
- **Spoofing:** a pass starts only for the user named by the verified pointer, after the shell's online session check, and never while the browser reports it is offline (R-06).
- **Tampering:** a second pass finds the lock taken and does nothing; without Web Locks an in-memory guard stands in, and if two tabs ever send the same item the server answers 200 (R-04).
- **Repudiation:** the queued and finished events carry no movement data.
- **Information Disclosure:** the events are window events with no payload, and nothing is written to the console with request data.
- **Denial of Service:** a pass that ends on `RATE_LIMITED` schedules one retry after `Retry-After`, and unmounting cancels it; there is no polling loop (R-09).
- **Elevation of Privilege:** a pass that meets a 401 stops and keeps the queue; it never retries under another identity.

### `apps/web/src/features/movements/containers/create-movement-container.tsx` and `apps/web/src/features/movements/containers/movements-container.tsx`
- **Spoofing:** the container reads the user id from the pointer and refuses to queue when there is none, so a save never lands in an unknown user's store.
- **Tampering:** only a parsed request is queued; a server rule failure online queues nothing, so a rejected movement is never turned into a pending one.
- **Repudiation:** the user sees the pending notice and a "Pending" badge in the list, so a saved-offline movement is never mistaken for a synced one.
- **Information Disclosure:** the list renders names and notes as React text, and a queued row reveals nothing the user's device did not already hold.
- **Denial of Service:** the list reads the queue once per load and merges by id, so 1,000 queued items are one bounded read.
- **Elevation of Privilege:** rendering a pending row grants no server action: edit and delete of a pending row are DISC-001-04c.

## Data classification
| Data | Class | At rest | In transit |
|---|---|---|---|
| Movement amounts, dates, notes, tags, account and category ids and rates in the request of `POST /movements` | financial | PostgreSQL volume encrypted at rest, owner-scoped statements with bound parameters | TLS (production HTTPS guard), session cookie flagged Secure |
| The `id` chosen by the device (a random UUID) | public | stored as the movement's primary key; it carries no meaning and reveals nothing about the user | TLS |
| Queued movements on the device (the same fields, until they sync) | financial | per-user IndexedDB database on a disk that the device operating system encrypts where the user has it on; under the decision recorded in R-04 of DISC-001-04a (R-07) | stays on the device until sent, then TLS |
| Rate limit counters (user id, bucket, window, count) | PII | PostgreSQL volume encrypted at rest, one row per user per bucket and window | not sent to the client |
| Session cookie presented by the sync pass | credentials | not stored by this module; the identity module stores it hashed | TLS, cookie flagged Secure in production |
| Rejected-item error code kept in the queue | public | the same per-user database, a short code with no movement data | stays on the device |

## Risks and mitigations
| ID | Risk | STRIDE | Likelihood | Impact | Mitigation |
|---|---|---|---|---|---|
| R-01 | A caller learns that a UUID belongs to another user's movement, because that id answers 404 and a new id answers 201 | I | Low | Low | The id is a random 122-bit value nobody can guess, the answer is the standard 404 the API gives for data that is not the caller's, the duplicate-key error never reaches a response, and a route test checks the body (Blocks 3, 4, 5) |
| R-02 | A caller reads or overwrites another user's movement by sending its id | T | Low | High | `findById` and the re-read after a conflict are scoped to the caller, the insert never takes the owner from the request, the composite foreign keys tie accounts to the owner, and tests with two owners cover the replay and the conflict (Blocks 3, 4) |
| R-03 | An online client adds an id to its creations and is held to 600 per minute instead of 60 (the user's decision of 2026-10-05, option a) | D | Medium | Medium | The device bucket is a hard cap of 600 per minute per user behind a verified session, replays cost one read and no unit, the manual bucket is untouched for requests without an id, and tests cover both buckets and the 601st request (Blocks 2, 4, 5) |
| R-04 | A retry, a lost response or two tabs create the same movement twice, or lose one | T | Medium | High | The id is the primary key, a lost race becomes a replay, the sync lock serializes passes, a failed answer keeps the item, and tests run 1,000 randomized cuts plus a concurrent replay on PostgreSQL (Blocks 3, 4, 8, 9) |
| R-05 | A script of the web origin edits a queued movement before it is sent | T | Low | Medium | The script could call the API with the user's cookie anyway, so nothing is gained; every field is re-validated by the shared schema and the business rules on the server, and unparsable records are skipped on read (Blocks 5, 6) |
| R-06 | One user's queue is sent under another user's session on a shared device | S | Low | High | The queue lives in the per-user database, a pass starts only for the verified pointer's user after the session check, and the owner-scoped accounts make the server answer 404 for a queued movement under another session, which flags it instead of storing it; the wipe on sign out and the rule against sending the previous user's changes are DISC-001-04d (Blocks 6, 9) |
| R-07 | Unsent financial data kept on the device is readable by someone with the unlocked device or the browser profile | I | Medium | Medium | Same data class and same per-origin sandbox as R-04 of `threat-DISC-001-04a.md`, whose recorded decision on local data this ticket does not change; the queue holds an item only until it syncs, and the wipe on sign out is DISC-001-04d (Block 6) |
| R-08 | A queued movement is lost: the browser evicts storage, the disk is full, an upgrade is blocked, or a rejected item stays unseen | D | Medium | High | Persistent storage is requested by DISC-001-04a, a save that cannot be stored shows a message and keeps the form, `onversionchange` closes old connections, a rejected item is flagged and never deleted, and 04b is not released without 04c, which shows failed items (Blocks 6, 8, 10) |
| R-09 | A large queue or a retry loop overloads the API | D | Medium | Medium | At most 4 requests in flight, the pass stops on network, server and limit errors, one timer honors `Retry-After`, rejected items are skipped, and the device bucket caps an owner at 600 per minute (Blocks 2, 8, 9) |
| R-10 | Migration 0018 fails, locks the limiter table or leaves the key half-changed | D | Low | Medium | The change is a column with a default plus a primary key swap on a table of about one row per user, run in the migrator transaction, with a rollback script and tests that apply and revert it on a 0017 database; the journal `when` is checked against main before merge (Block 2) |
| R-11 | Movement data leaks into logs or error bodies on the new path | I | Medium | Medium | The route logs ids only for both outcomes, the duplicate-key error is internal, a test checks the replay log and a 500 body, and the sync code logs nothing about requests (Blocks 5, 9) |
| R-12 | An offline client sends a made-up rate frozen as `manual` | T | Medium | Low | The rate is validated by the shared rate schema and its bounds, it is stored as `manual` and never as an official quote, and the user can already type any manual rate online (Blocks 5, 7) |

## Supply chain
No runtime dependency is added: `crypto.randomUUID`, IndexedDB and Web Locks are platform APIs, and the tests use `fake-indexeddb`, a dev dependency already added by DISC-001-04a. The audit (`pnpm audit --prod --audit-level high`) and the SAST step cover the change (R-05, R-10).

## Availability
The vectors are a retry storm or a large queue hitting `POST /movements` (R-09), a client using the id path to exceed the manual limit (R-03), a migration that stalls the limiter table (R-10), and a queue lost to eviction or a full disk (R-08). The device bucket, the replay that costs one read, the bounded concurrency, the additive migration with a rollback and the persistent storage request bound each of them. A failed deploy of the API leaves the old route working: a request without an id is unchanged, and a client that sends an id to an old API gets its movement created without the idempotency until the new version is up, which is why 04b ships with 04c and after the API.

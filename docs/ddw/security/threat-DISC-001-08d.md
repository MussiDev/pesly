# Threat model DISC-001-08d: Push notifications for notices

| Field | Value |
|-------|-------|
| Ticket | DISC-001-08d |
| Spec | docs/ddw/specs/spec-DISC-001-08d.md |
| Tier | FEATURE |
| Date | 2026-10-12 |

## Components
| Component | Source in the spec |
|---|---|
| `apps/api/drizzle/0039_push_notifications.sql` | Block 2 |
| `packages/shared/src/push/push.ts` | Block 1 |
| `apps/api/src/shared/config/env.ts` | Block 3 |
| `apps/api/scripts/generate-vapid-keys.mjs` | Block 3 |
| `.railway/railway.ts` | Block 3 |
| `apps/api/src/push/infrastructure/providers/web-push-provider.ts` | Block 4 |
| `apps/api/src/push/infrastructure/providers/aes128gcm.ts` | Block 4 |
| `apps/api/src/push/infrastructure/http/push-routes.ts` | Block 5 |
| `apps/api/src/push/infrastructure/db/drizzle-push-subscription-repository.ts` | Block 5 |
| `apps/api/src/push/domain/push-payload.ts` | Block 6 |
| `apps/api/src/push/infrastructure/db/drizzle-push-fan-out.ts` | Block 6 |
| `apps/api/src/push/infrastructure/db/drizzle-push-delivery-queue.ts` | Block 7 |
| `apps/api/src/push/application/deliver-due-pushes.ts` | Block 7 |
| `apps/api/src/push/infrastructure/jobs/push-job.ts` | Block 8 |
| `apps/api/src/shared/logging/logger.ts` | Block 8 |
| `apps/web/src/lib/service-worker/push-handlers.ts` | Block 9 |
| `apps/web/src/features/notifications/containers/notifications-settings-container.tsx` | Block 10 |

## Trust boundaries
- Browser → API: `GET /push/config`, `PUT /push/subscriptions` and `POST /push/subscriptions/unsubscribe` carry a
  session and, for the store route, a URL and two keys chosen by the client over the public internet. The URL is the
  one attacker-controlled value that the worker later sends a request to (FR-02).
- Worker process → push service: the worker posts an encrypted message to a third-party host named by a stored URL,
  signed with the VAPID private key. This is the only outbound call of the feature, and the only place the private key
  is used (FR-08, FR-22).
- Push service → browser: the message crosses a third party that sees the destination, the size and the timing, and
  relays the ciphertext to the device; the service worker then shows it on a lock screen (FR-16).
- Environment → worker and API: the VAPID keys, the subject and the provider selection come from Railway variables; the
  private key reaches the worker only (FR-22).
- Notices → deliveries: the fan-out copies the reach of a user's notice onto the subscriptions registered for that user,
  so the subscription's owner decides who reads the notice text (FR-06).
- Notification → app window: a tap carries a link from the payload into `clients.openWindow` or `navigate` (FR-17).
- Worker → logs: error objects from a network call may carry the URL; logs leave the process (NFR-07).

## STRIDE analysis
### `apps/api/drizzle/0039_push_notifications.sql`
- **Spoofing:** not applicable, a migration carries no identity.
- **Tampering:** additive and transactional: two new tables and one nullable column; the rollback drops only what 0039
  created (R-14). The one-off `UPDATE` that marks existing notices as handled touches only `push_handled_at`.
- **Repudiation:** the migration journal and its rollback file record the change; the number is provisional until merge.
- **Information Disclosure:** the new tables hold push URLs, keys and delivery state, no notice text and no amount.
- **Denial of Service:** creating empty tables and one column takes no long lock; the single `UPDATE` runs on a table of
  at most 200 payments per user.
- **Elevation of Privilege:** `user_id` and `subscription_id` foreign keys cascade, so a deleted user keeps no
  subscription, key or delivery (AC-10, FR-04).

### `packages/shared/src/push/push.ts`
- **Spoofing:** not applicable, a pure validation module.
- **Tampering:** the allowlist is one anchored, case-sensitive pattern over the raw string, not a parsed URL, so parser
  differences (user-info, backslash, trailing dot, port, IP literal) cannot turn an allowed-looking string into another
  host (R-01).
- **Repudiation:** not applicable.
- **Information Disclosure:** validation failures report paths only, never the value of the URL or a key.
- **Denial of Service:** the URL is capped at 2,048 characters and the keys have fixed lengths, so the check is linear and
  bounded.
- **Elevation of Privilege:** the same function is imported by the route and by the adapter, so the adapter never trusts
  a stored value more than a request value (R-01).

### `apps/api/src/shared/config/env.ts`
- **Spoofing:** not applicable.
- **Tampering:** in production the provider must be `webpush` and every VAPID setting must be present and well formed;
  the private key must derive the public key, so a swapped or truncated key stops startup instead of failing every send
  with 403 (R-04).
- **Repudiation:** a failed start names the variable and the rule, which the platform logs.
- **Information Disclosure:** the API parses the public key only and ignores a stray private key, so the private key
  never enters the API process; errors name the variable and never print its value (R-03).
- **Denial of Service:** `PUSH_JOB_INTERVAL_SECONDS` is bounded to 1 to 60, so a typo cannot hammer the database or stop
  the job.
- **Elevation of Privilege:** the fake provider cannot be selected in production, so a misconfiguration cannot silently
  disable delivery or open a code path meant for tests.

### `apps/api/scripts/generate-vapid-keys.mjs`
- **Spoofing:** not applicable.
- **Tampering:** it only prints a new pair; it writes no file and edits no variable.
- **Repudiation:** not applicable.
- **Information Disclosure:** the private key goes to the terminal of the person who runs it and nowhere else; nothing
  imports the script, so no process prints it (R-03).
- **Denial of Service:** not applicable.
- **Elevation of Privilege:** rotating the pair invalidates every device subscription, so the runbook says to rotate only
  with a re-subscription campaign (R-04).

### `.railway/railway.ts`
- **Spoofing:** not applicable.
- **Tampering:** the change is applied through plan, approval and apply, never directly; the definition declares the
  private key as `preserve()` on the worker only (R-03).
- **Repudiation:** the plan and the approval are the record of who changed the variables.
- **Information Disclosure:** no literal secret is committed; the deployment test fails when a secret name has a literal
  value or appears on the API service.
- **Denial of Service:** the settings add no service and no resource limit change.
- **Elevation of Privilege:** the API service receives the public key only, so compromising the API process does not
  expose the signing key.

### `apps/api/src/push/infrastructure/providers/web-push-provider.ts`
- **Spoofing:** the VAPID token proves to the push service that the message comes from this application server; its
  audience is the origin of the target URL and its expiry is at most 12 hours, so a leaked token is useful for one push
  service for a short time (R-05).
- **Tampering:** the request is sent with `redirect: 'manual'`, so a push service (or an attacker host that slipped past
  the allowlist) cannot redirect the worker to an internal address; a 3xx is a final failure (R-01).
- **Repudiation:** a failed send is logged by the caller with the delivery id, the notice id and the status code.
- **Information Disclosure:** the adapter never logs and never passes an error object upward, because the message of a
  network error can contain the URL; the body travels encrypted for the device's key (R-06, R-10).
- **Denial of Service:** every request is aborted after 10 s and the process holds at most 20 sends in flight, so a slow
  or hostile host cannot exhaust sockets or stall the job beyond a bounded time (R-08).
- **Elevation of Privilege:** before every request it re-checks the stored URL against the allowlist and returns a final
  failure with no request when it does not match, so a tampered row cannot make the worker call an arbitrary host
  (server-side request forgery, R-01).

### `apps/api/src/push/infrastructure/providers/aes128gcm.ts`
- **Spoofing:** the authentication secret of the device is mixed into the key derivation, so a third party that knows
  only the public key cannot produce a message the device accepts.
- **Tampering:** AES-128-GCM authenticates the record; a modified ciphertext fails to decrypt on the device. A fresh
  salt and a fresh ephemeral key are used for every message (R-07).
- **Repudiation:** not applicable.
- **Information Disclosure:** the push service relays ciphertext only; the notice text is readable by the device alone.
  The hand-written cryptography is checked against the RFC 8291 test vector byte for byte, with the `web-push` library
  as the documented fallback if the vector cannot pass (R-07).
- **Denial of Service:** one record of at most 3,993 bytes, so encryption cost is constant and bounded.
- **Elevation of Privilege:** not applicable, a pure function with no I/O.

### `apps/api/src/push/infrastructure/http/push-routes.ts`
- **Spoofing:** `requireSession` and `requireVerifiedEmail` run before every handler; the user comes from the access
  scope, never from the body (R-02).
- **Tampering:** body, params and responses are validated with the shared schemas; the store route also checks that the
  device key is a point on the P-256 curve, so a malformed key is refused at the edge and not at send time.
- **Repudiation:** audit lines carry the user id and the subscription id; they never carry the URL or the keys.
- **Information Disclosure:** removing a URL stored for another user answers 404 with the same body as an unknown URL, so
  the route does not confirm who holds a URL (R-02). The remove route is a `POST` with a body so the URL stays out of
  access logs (R-06).
- **Denial of Service:** each user holds at most 10 subscriptions (the 11th replaces the least recently updated), the JSON
  body limit is 16 kb and the store runs one short transaction under a per-user advisory lock; row growth is bounded per
  user and the repeat of the same URL is an update (R-09).
- **Elevation of Privilege:** write scope for store and remove, read scope for the configuration; a user can change only
  their own rows because every statement carries the user id (R-02).

### `apps/api/src/push/infrastructure/db/drizzle-push-subscription-repository.ts`
- **Spoofing:** the user id is the scope's; the URL is the natural key of a device and is unique across users.
- **Tampering:** the upsert changes the owner of an existing URL to the latest user who proved a session (AC-03) and, in
  the same transaction, deletes the pending deliveries that were created for the previous owner's notices (R-02).
- **Repudiation:** the update time of the row records the last store.
- **Information Disclosure:** every query is parameterized and scoped by the user id; nothing returns another user's row.
- **Denial of Service:** the cap and the delete of the surplus run under `pg_advisory_xact_lock` for the user, so
  concurrent stores cannot exceed 10 rows and cannot deadlock on each other (R-09).
- **Elevation of Privilege:** there is no query in this repository without a user predicate except the worker-side
  deletion of a subscription the push service reported as gone.

### `apps/api/src/push/domain/push-payload.ts`
- **Spoofing:** not applicable, a pure function.
- **Tampering:** the title is the fixed brand name and the link is built from the owner's language, never from the notice
  or from user input (R-10).
- **Repudiation:** not applicable.
- **Information Disclosure:** the body is the stored notice text (no amount and no account name since 08c) or, for a card
  statement, a generic sentence with the day and no card name; the function refuses a `budget_alert` and a payload over
  3,000 bytes (R-06, R-10).
- **Denial of Service:** the text is at most 300 characters, so the payload fits one record.
- **Elevation of Privilege:** not applicable.

### `apps/api/src/push/infrastructure/db/drizzle-push-fan-out.ts`
- **Spoofing:** each delivery is created from the notice's owner and the subscriptions registered for that same owner
  in one statement.
- **Tampering:** the unique key (notice, subscription) with `ON CONFLICT DO NOTHING` makes a repeated or parallel fan-out
  a no-op; the notice is marked handled in the same transaction, so a subscription added later never receives an old
  notice (R-11).
- **Repudiation:** the handled mark and the delivery rows record what was fanned out and when.
- **Information Disclosure:** a notice of kind `budget_alert`, a read notice and a notice older than 24 hours get no
  delivery, so stale or in-app-only text is never pushed (R-10).
- **Denial of Service:** batches of 500 with `FOR UPDATE SKIP LOCKED` on a partial index keep a backlog from locking the
  table or growing memory; a failing batch rolls back and is retried at the next pass.
- **Elevation of Privilege:** it is worker-side code and is not exported through the module barrel, so no request can
  trigger it.

### `apps/api/src/push/infrastructure/db/drizzle-push-delivery-queue.ts`
- **Spoofing:** the claim joins the delivery to the notice and the subscription and refuses a row whose subscription owner
  is not the notice owner (R-02).
- **Tampering:** every mark is guarded by `status = 'pending'`, so a late second writer changes nothing; the claim sets
  the lease in the same statement that selects the row (R-11).
- **Repudiation:** attempts, status and sent time are stored per delivery.
- **Information Disclosure:** the claim returns the URL and keys only to the use case that sends; nothing logs them.
- **Denial of Service:** a lease of 2 minutes makes a crashed claim due again and the attempt counter, incremented at the
  claim, ends a poison delivery after 5 attempts; finished rows are purged after 7 days (R-08, R-12).
- **Elevation of Privilege:** not exported through the module barrel; only the worker builds it.

### `apps/api/src/push/application/deliver-due-pushes.ts`
- **Spoofing:** the destination comes from the claimed row, never from the notice text.
- **Tampering:** a read notice, a `budget_alert` or an owner mismatch is skipped without a send; a 404 or 410 deletes only
  that subscription; a 403 is final and keeps the subscription because it means our VAPID key is wrong (R-04, R-11).
- **Repudiation:** failures are logged with ids and a status code, never with the URL, keys or text.
- **Information Disclosure:** the log call takes explicit fields and no error object; a guard test scans every line for
  the URL, keys, VAPID private key and notice text (R-06).
- **Denial of Service:** one shared limiter keeps 20 sends in flight per process and one failing device never stops the
  others; retries wait 30, 90, 210 and 450 s and honour `Retry-After` up to 900 s (R-08).
- **Elevation of Privilege:** it receives the queue, the provider and the clock as ports and holds no scope on any other
  module's data.

### `apps/api/src/push/infrastructure/jobs/push-job.ts`
- **Spoofing:** not applicable, there is no end user in the loop.
- **Tampering:** each step runs in its own `try/catch` and the next pass is scheduled after the previous one ends, so
  passes do not overlap in one process; several workers are safe because of the unique key and the lease (R-11).
- **Repudiation:** a failed step is logged with the error class name only.
- **Information Disclosure:** the job logs counts and ids only.
- **Denial of Service:** a push failure never reaches notice creation, recording or listing, because the job only reads
  notices and writes its own state (AC-38); an unreachable push service ends every pass normally (R-08).
- **Elevation of Privilege:** it is built only in the worker, with the provider chosen from the validated environment.

### `apps/api/src/shared/logging/logger.ts`
- **Spoofing:** not applicable.
- **Tampering:** the redaction list is extended with the push URL, the keys and the VAPID private key fields, in the same
  top-level and nested shapes as the existing secrets.
- **Repudiation:** not applicable.
- **Information Disclosure:** redaction is the second layer after the rule of never logging these values; a test runs a
  full job with failing sends and scans every line (R-06).
- **Denial of Service:** not applicable.
- **Elevation of Privilege:** not applicable.

### `apps/web/src/lib/service-worker/push-handlers.ts`
- **Spoofing:** a push can only be delivered to the registration of this origin by a message encrypted for its key; the
  handler still treats the data as untrusted and validates it with the shared schema (R-13).
- **Tampering:** a notification link is opened only when it is a path of the app's own origin: another origin,
  `//host`, a backslash form and `javascript:` all open the root (R-13).
- **Repudiation:** not applicable.
- **Information Disclosure:** the lock screen shows only the notice text that the server already rendered without
  amounts or account names; a missing or malformed payload shows a generic `Pesly` notification with no text (R-10).
- **Denial of Service:** the notification `tag` is the notice id, so a repeat replaces the earlier one instead of
  stacking; the handler never throws on bad data, which keeps the browser from revoking the subscription.
- **Elevation of Privilege:** it holds no privilege beyond showing a notification and opening a window of its own
  origin.

### `apps/web/src/features/notifications/containers/notifications-settings-container.tsx`
- **Spoofing:** it calls the API with the session cookie and never builds another user's identifier.
- **Tampering:** it sends only the subscription the browser produced; the server validates the URL, the keys and the
  size (R-01).
- **Repudiation:** not applicable.
- **Information Disclosure:** the permission prompt appears only after the user taps "Enable notifications", and a
  denial stores nothing; the screen shows no URL or key (R-13).
- **Denial of Service:** the screen re-registers the subscription once per visit; a failed call shows a retry state and
  loops nowhere.
- **Elevation of Privilege:** on a shared browser the endpoint belongs to the last user who enabled it, and disabling
  removes the server row first, so one user's pushes do not follow another user's session (R-02).

## Data classification
| Data | Class | At rest | In transit |
|---|---|---|---|
| VAPID private key | credentials | Railway secret variable of the worker only (`preserve()`); never in the database, the repository, the API process or logs | TLS 1.2 or higher inside the platform; used only to sign a token |
| push subscription URL | credentials | PostgreSQL volume encryption of the managed host; owner-scoped queries; never logged | TLS 1.2 or higher between the browser and the API, and from the worker to the push service |
| `p256dh` key and `auth` secret of a device | credentials | same as above; deleted with the subscription | TLS 1.2 or higher |
| notice text in a push body | financial | encrypted end to end with aes128gcm for the device key; the database keeps only the stored notice (08c) | TLS 1.2 or higher to the push service, ciphertext relayed to the device |
| delivery state (status, attempts, times) | financial | PostgreSQL volume encryption of the managed host; purged 7 days after the last update | TLS 1.2 or higher between the worker and the database |
| owner language read by the job | PII | same as above | TLS 1.2 or higher |

## Risks and mitigations
| ID | Risk | STRIDE | Likelihood | Impact | Mitigation |
|---|---|---|---|---|---|
| R-01 | Server-side request forgery: a client-chosen push URL makes the worker call an internal or arbitrary host | E | M | H | https-only anchored allowlist of four push service host patterns on the raw string (no IP, no port, no credentials, no `localhost`), the adapter re-checks the stored URL before every request, `redirect: 'manual'` with a final failure on 3xx, 10 s timeout; tests AC-05, AC-63 and the tampered-row test of Block 4 |
| R-02 | Cross-user subscription takeover or leakage: another user's URL is removed or read, or a moved subscription keeps receiving the previous owner's notices | E | M | H | Every statement carries the user id, a foreign URL answers 404 like an unknown one, an owner change deletes the previous owner's pending deliveries, the claim refuses a delivery whose subscription owner is not the notice owner, and disabling deletes the server row first; tests AC-03, AC-09, AC-11 |
| R-03 | VAPID private key leaks through the API, logs, the repository or Railway | I | L | H | Worker-only setting parsed only by the worker, `preserve()` in the IaC, no literal in code, a stray key ignored by the API, errors name the variable without its value, key script prints only to the operator's terminal; tests AC-60, NFR-07 |
| R-04 | A wrong, truncated or rotated key makes every push fail with 403, or a fake provider runs in production | D | M | H | Production refuses to start unless the provider is `webpush` and the private key derives the public key, a 403 is a final failure that keeps the subscription and logs the status, the runbook forbids rotation without re-subscribing devices; tests AC-28, AC-60 |
| R-05 | A leaked VAPID token is replayed to push to devices | S | L | M | The token's audience is one push service origin and its expiry is at most 12 hours, it is signed per send, and it only authorises a message the device can decrypt; test AC-62 |
| R-06 | Payload content leakage: an amount, an account name, a card name, a subscription URL or key reaches the push, a log line or the lock screen | I | M | H | The text comes from the amount-free stored notice or a generic card sentence, `budget_alert` is never pushed, logs take explicit ids and status codes and no error object, the logger redacts the key names, the remove route uses a body; guard tests NFR-04 and NFR-07, tests AC-34, AC-35, AC-39 |
| R-07 | The hand-written aes128gcm or VAPID implementation is wrong or weak | T | M | M | Verified against the RFC 8291 test vector byte for byte, a fresh salt and ephemeral key per message, only `node:crypto` and `jose` primitives, the `web-push` library as the documented fallback with its own justification; test AC-62 |
| R-08 | A slow or failing push service stalls the worker, exhausts sockets or blocks notices | D | M | M | 10 s timeout per send, at most 20 in flight per process, per-device retries with a 900 s cap, per-row and per-step isolation, no write path into notices; tests AC-38, NFR-06 |
| R-09 | Subscription spam grows the table or the request volume (one user, or many verified accounts) | D | M | M | Verified email and session required, 10 subscriptions per user with the least recently updated replaced, a repeated URL is an update, a 16 kb body limit and a short transaction; residual risk of request volume is listed under accepted risks; tests AC-07, NFR-05 |
| R-10 | A notice that should stay in-app, is stale or has changed is pushed (budget alert, read notice, notice older than 24 hours) | I | M | M | Fan-out excludes `budget_alert`, read and old notices, the delivery is re-checked for read state when it comes due, TTL of 6 hours; tests AC-17, AC-18, AC-19 |
| R-11 | Replay or duplicate delivery: parallel workers, a repeated pass or a crash repeat a push | T | M | M | Unique key (notice, subscription), claim with row lock and lease, marks guarded by status, `tag` and `Topic` equal to the notice id so a repeat replaces the earlier push; at most one send per claim is promised, not zero repeats after a crash; tests AC-15, AC-24, AC-25, AC-26 |
| R-12 | Delivery rows and subscriptions pile up | D | L | L | Finished deliveries are purged 7 days after their last update, a subscription reported gone is deleted at the first 404 or 410, rows cascade with the user |
| R-13 | A forged or malformed push, or a hostile link, makes the service worker open another site or fail | S | L | M | Payload parsed and validated with the shared schema, a generic notification for bad data, links opened only when they are same-origin paths, permission asked only after an explicit tap; tests AC-42, AC-45, AC-47 |
| R-14 | The migration blocks or loses data | T | L | M | Additive change only, a rollback that runs twice, a migration test on a fresh database, number re-checked against 09b and 09c at merge; test of Block 2 |
| R-15 | A signed-out user keeps receiving their notices on a shared device: the push subscription outlives the session on the server and in the browser | I | M | M | Mitigated: sign-out removes the subscription first, best effort and while the session is still valid (`POST /push/subscriptions/unsubscribe`, then the browser `unsubscribe()`); it never asks for permission and a failure, an unsupported browser or no subscription never blocks the sign-out; tests in `sign-out-push.test.tsx` |

## Accepted risks
### Request volume of subscription spam by many verified accounts (R-09)
- **Accepted by:** the product owner, on ratification of the spec.
- **Justification:** the API has no general request rate limiter (only sign-in has one) and the API is stateless by
  rule, so it cannot count requests in process memory. Row growth is bounded (10 rows per user, one row per URL), the
  work per request is one short transaction under 300 ms, and each account needs a verified email address, which makes
  a mass attack expensive. A platform-level limit is the right layer for raw request volume.
- **Review conditions:** review when a general rate limiter exists for the write routes, or when the monitored volume of
  `PUT /push/subscriptions` or the size of `push_subscriptions` shows abuse.

### Repeat of a push after a crash between an accepted send and its mark (R-11)
- **Accepted by:** the product owner, on ratification of the spec.
- **Justification:** exactly-once delivery over HTTP is impossible; the design promises at most one send per claim and
  makes a repeat harmless, because the notification `tag` and the push `Topic` are the notice id, so the repeat replaces
  the earlier notification on the device and in the push service.
- **Review conditions:** review if users report visible duplicates, or when a push service stops honouring `Topic`.

## Supply chain
No new runtime dependency: VAPID uses `jose`, which `apps/api` already depends on, and the encryption uses `node:crypto`
and the built-in `fetch`. The documented fallback is the `web-push` library; adding it requires its own justification, a
look at its transitive tree on the lockfile, a clean `pnpm audit --prod --audit-level high` and the owner's
ratification before it is installed. The push services (Google, Mozilla, Apple, Microsoft) are third parties that see
the destination, the size and the timing of each message but never its content.

## Availability
The push job is a separate chain in the worker, so a failure in it does not stop the email, rates, recurring or statement
jobs, and the job only reads notices, so it cannot delay creating or listing them. Several workers can run it because of
the unique key, the lease and the guarded marks. If every worker is down, the next pass after recovery sends the
deliveries still younger than their 6-hour TTL and fans out notices younger than 24 hours; older ones stay in-app only,
which is the source of truth. If a push service is unreachable, deliveries retry up to 5 attempts and then end as failed
without affecting other devices. The settings screen degrades to an error with a retry when the API is unreachable.

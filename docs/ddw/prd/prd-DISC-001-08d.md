# PRD DISC-001-08d: Push Notifications for Notices

| Field | Value |
|-------|-------|
| Ticket | DISC-001-08d |
| Tracker | none |
| Date | 2026-10-12 |
| PRD loops | 0 |
| Loops since last human decision | 0 |

## Context and Problem
Fourth and last of four sub-tickets of Recurring Payments & Reminders (parent:
`prd-DISC-001-08.md`; previous: `prd-DISC-001-08a.md` recurring payments, `prd-DISC-001-08b.md` the
scheduled recording job, `prd-DISC-001-08c.md` reminders and in-app notices, all merged). The worker
now stores a notice for every reminder, every automatic recording and every statement due date
(`prd-DISC-001-10f.md`), and the user reads them in the app. A user who does not open the app at
09:00 still misses the reminder, which is the whole point of a reminder. This ticket delivers the
stored notices as Web Push notifications to every device where the user enabled them: the
subscriptions of each device, a worker job that turns undelivered notices into one push per device and
sends them through a Web Push provider behind a port, the service worker code that shows the
notification and opens the app on a tap, and the opt-in screen (permission asked only on an explicit
tap, per-device enable and disable, the Home Screen explanation for iPhone and iPad). The in-app notice
stays the source of truth: a failed push never removes or alters it. Requirement IDs are renumbered
for this sub-ticket; the Decision Log maps the parent's.

Investigation of the code for this PRD found the facts that shape the scope: the worker is one process
with interval jobs and row-lock claims (`apps/api/src/worker.ts`, the email outbox in
`identity/infrastructure/email/email-worker.ts` is the model for retries); `notices` already carries a
uniqueness rule per kind, subject and due date but no delivery state; the service worker
(`apps/web/src/app/sw.ts`, Serwist) handles fetch and cache only and has no `push` or
`notificationclick` handler; the API and worker environments (`apps/api/src/shared/config/env.ts`)
have no push settings; `.railway/railway.ts` declares the api, worker and web services; and
`apps/api/package.json` has no Web Push library (it has `jose`).

## Goals
- Deliver every reminder, recorded and not-recorded notice and every statement due-date reminder as a
  push notification to each device where the user enabled push.
- Never push the same notice twice to the same device, and never let one device's failure affect
  another's or the in-app notice.
- Keep amounts and account names out of every push, in the user's interface language.
- Ask for the browser permission only when the user taps "Enable notifications".
- Open the notices screen when the user taps a push.
- Keep the Web Push provider replaceable: one port, one real adapter, one fake for tests.

## Functional Requirements
- FR-01: The system must store a push subscription (endpoint, `p256dh` key, `auth` secret) for the
  signed-in user's device, creating it or updating it when the endpoint is already stored. *(parent
  FR-13)*
- FR-02: The system must reject a subscription whose endpoint is not an https URL on the allowlist of
  push service hosts, or whose keys or size are invalid, and must keep at most 10 subscriptions per
  user. *(parent FR-13)*
- FR-03: The system must allow a user to delete the subscription of one device without touching their
  other devices. *(parent FR-14)*
- FR-04: The system must let a user change only their own subscriptions, and must delete a user's
  subscriptions and deliveries when the user deletes their account. *(parent FR-13)*
- FR-05: The system must tell the web app whether push is available and give it the public VAPID key
  to subscribe with. *(parent FR-13)*
- FR-06: The system must create, for each notice that is pushed, one delivery for each subscription
  the owner has at that moment. *(parent FR-13)*
- FR-07: The system must create no delivery for a notice of kind `budget_alert`, for a notice that is
  already read, for a notice more than 24 hours old when the job reaches it, or for an owner with no
  subscription. *(parent Out of Scope, FR-12)*
- FR-08: The system must send each due delivery through the Web Push provider port to its device,
  with a time to live of 6 hours, and mark it sent. *(parent FR-13)*
- FR-09: The system must send each delivery at most once, however many times the job runs and however
  many worker processes run at the same time. *(parent NFR-04)*
- FR-10: The system must delete a subscription that the push service reports as expired (404 or 410),
  keep the notice and keep the deliveries of the user's other devices. *(parent FR-13)*
- FR-11: The system must retry a delivery that failed for a transient reason up to 5 attempts in all,
  with growing waits, treat the other failures as final, and handle each device on its own.
  *(parent NFR-04)*
- FR-12: The system must write the text of a push in the owner's interface language, with no amount
  and no account name, and without the card name for a statement due-date reminder. *(parent FR-16,
  FR-24)*
- FR-13: The system must put in each push the notice id, a fixed title, the text and a link to the
  notices screen in the owner's language. *(parent FR-13)*
- FR-14: The system must keep creating notices, recording expenses and listing notices when pushing
  fails, and must report each failed send in the log with ids and status code only. *(parent NFR-04)*
- FR-15: The system must delete sent and failed deliveries 7 days after they were last updated.
  *(parent NFR-04)*
- FR-16: The service worker must show a notification when a push arrives, tagged with the notice id so
  a repeat replaces it instead of stacking. *(parent FR-13)*
- FR-17: The service worker must open or focus the app on the notification's link when the user taps
  it, and only on a path of the app's own origin. *(parent FR-13)*
- FR-18: The web app must ask the browser for push permission only when the user taps "Enable
  notifications". *(parent FR-14)*
- FR-19: The web app must show, for the current device, whether notifications are on or off, with a
  control to turn them on and another to turn them off. *(parent FR-14)*
- FR-20: The web app must tell the user on iPhone or iPad that push notifications require adding the
  app to the Home Screen when push is not available there, and must tell the user whose browser has
  no Web Push or whose permission is blocked what is wrong. *(parent FR-15)*
- FR-21: The web app must re-register the current subscription of the device with the server each time
  the user opens the notifications settings, because the browser can change it silently. *(parent
  FR-13)*
- FR-22: The system must reach the push service only through one port with one real adapter and one
  fake, selected by `PUSH_PROVIDER`, with the VAPID keys and contact taken from the environment.
  *(parent FR-13)*

## Non-Functional Requirements
- NFR-01: A notice must be handed to the push service < 30 s after it is created at p95, and never
  later than 5 min while the worker runs, so a reminder created between 09:00 and 09:10 of its day
  reaches the push service before 09:15, measured with the fake provider on the test database. The
  push job runs every `PUSH_JOB_INTERVAL_SECONDS`, an integer from 1 to 60 with a default of 10.
- NFR-02: One job pass over 5,000 due deliveries must finish in < 60 s with the fake provider on the
  test database.
- NFR-03: Running the job 3 times in a row, and running 2 worker processes at the same time, must
  produce 0 duplicate sends for the same notice and device.
- NFR-04: 0 push payloads must contain an amount or an account name, in either language, and every
  payload must be <= 3,000 bytes before encryption.
- NFR-05: Storing and deleting a subscription must answer in < 300 ms at p95 for a user with 10
  subscriptions, measured server-side.
- NFR-06: Each send must time out after 10 s, and one process must have at most 20 sends in flight,
  so a slow push service delays the job by a bounded time and exhausts no sockets.
- NFR-07: 0 log lines must contain the VAPID private key, a subscription endpoint, a `p256dh` key, an
  `auth` secret or the text of a notice.

## Acceptance Criteria
- AC-01 (FR-01): WHEN a signed-in user with a verified email sends a valid subscription, THE system
  SHALL store it for that user and answer 200 with its id.
- AC-02 (FR-01): WHEN the same user sends an endpoint that is already stored with new keys, THE system
  SHALL keep 1 row for that endpoint and update its keys.
- AC-03 (FR-01): WHEN a second user enables notifications on a browser whose endpoint is stored for
  the first user, THE system SHALL hold that endpoint for the second user only.
- AC-04 (FR-01): IF the request has no session, THEN THE system SHALL answer 401 Unauthorized and
  store nothing.
- AC-05 (FR-02): IF the endpoint is not https, is not on a host of the allowlist, is an IP address or
  `localhost`, has credentials or a port other than 443, THEN THE system SHALL reject the request with
  400 and store nothing.
- AC-06 (FR-02): IF the `p256dh` key is not base64url of 65 bytes, the `auth` secret is not base64url
  of 16 bytes or the endpoint is longer than 2,048 characters, THEN THE system SHALL reject the
  request with 400 and store nothing.
- AC-07 (FR-02): WHEN a user who holds 10 subscriptions stores an 11th, THE system SHALL delete the
  subscription updated least recently and keep 10.
- AC-08 (FR-03): WHEN a user deletes the subscription of one of their 2 devices, THE system SHALL
  delete it and keep the other.
- AC-09 (FR-03): IF the endpoint to delete is not stored for the caller, THEN THE system SHALL answer
  404 Not Found and change nothing.
- AC-10 (FR-04): WHEN a user deletes their account, THE system SHALL delete all their subscriptions
  and deliveries.
- AC-11 (FR-04): IF a user deletes an endpoint stored for another user, THEN THE system SHALL answer
  404 Not Found and leave that subscription unchanged.
- AC-12 (FR-05): WHEN a signed-in user asks for the push configuration and the VAPID public key is
  set, THE system SHALL answer that push is available and return the key.
- AC-13 (FR-05): IF no VAPID public key is set, THEN THE system SHALL answer that push is not
  available and return no key.
- AC-14 (FR-06): WHEN a reminder notice is created for a user with 2 subscriptions, THE system SHALL
  create 2 deliveries for it, one for each.
- AC-15 (FR-06): WHEN the job runs 3 times over the same notice, THE system SHALL hold 1 delivery for
  each subscription.
- AC-16 (FR-06): WHEN a user enables push on a new device after a notice was already turned into
  deliveries, THE system SHALL not send that notice to the new device.
- AC-17 (FR-07): WHEN a notice of kind `budget_alert` is created, THE system SHALL create no delivery
  for it.
- AC-18 (FR-07): IF the notice is already read when its delivery comes due, THEN THE system SHALL send
  nothing and mark the delivery skipped.
- AC-19 (FR-07): IF a notice is 25 hours old when the job reaches it, THEN THE system SHALL create no
  delivery for it.
- AC-20 (FR-07): WHEN a user with no subscriptions gets a notice, THE system SHALL create no delivery
  and keep the in-app notice unread.
- AC-21 (FR-08): WHEN a delivery is due and the push service accepts it with 201, THE system SHALL mark
  it sent with the time of sending and not send it again.
- AC-22 (FR-08): WHEN a reminder is pushed to a user who enabled notifications on 2 devices, THE
  system SHALL send 1 push to each of the 2 endpoints.
- AC-23 (FR-08): WHEN a push is sent, THE request SHALL carry a time to live of 21,600 s and a topic
  equal to the notice id without hyphens.
- AC-24 (FR-09): WHEN the job runs 3 times in a row over the same due delivery, THE system SHALL send
  it once.
- AC-25 (FR-09): WHEN 2 worker processes handle the same due delivery at the same time, THE system
  SHALL send it once.
- AC-26 (FR-09): IF a process stops after claiming a delivery and before marking it, THEN THE system
  SHALL make it due again after a lease of 2 minutes and send it from another pass.
- AC-27 (FR-10): IF the push service answers 410 Gone or 404 for an endpoint, THEN THE system SHALL
  delete that subscription and its pending deliveries, keep the in-app notice and still send to the
  user's other devices.
- AC-28 (FR-10): IF the push service answers 400, 401, 403 or 413, THEN THE system SHALL mark the
  delivery failed without retrying, keep the subscription and log the status code.
- AC-29 (FR-11): IF the push service answers 429 or 5xx, times out or cannot be reached, THEN THE
  system SHALL retry after 30 s, 90 s, 210 s and 450 s, waiting at least the `Retry-After` it sent,
  capped at 900 s.
- AC-30 (FR-11): IF the fifth attempt of a delivery fails, THEN THE system SHALL mark it failed, make
  no further attempt and log the failure.
- AC-31 (FR-11): IF the push to device A fails with 503 and the push to device B succeeds, THEN THE
  system SHALL keep B sent, retry A alone and not send to B again.
- AC-32 (FR-12): WHEN a push is sent for "Electricity" due tomorrow to a user whose interface language
  is English, THE system SHALL send the text "Electricity is due tomorrow".
- AC-33 (FR-12): WHEN a push is sent for "Luz" due tomorrow to a user whose interface language is
  Spanish, THE system SHALL send the text "Luz vence mañana".
- AC-34 (FR-12): WHEN a push is sent for a payment of 350,000.00 ARS charged to an account named
  "Galicia", THE system SHALL send a payload with neither the amount nor the account name.
- AC-35 (FR-12): WHEN a push is sent for the statement of the card "Visa Galicia" due on 2026-10-15 to
  a user whose interface language is English, THE system SHALL send the text "A card statement is due
  on Oct 15" without the card name.
- AC-36 (FR-13): WHEN a push is sent to a user whose interface language is Spanish, THE system SHALL
  send a payload with the notice id, the title "Pesly", the text and the link `/es/notices`.
- AC-37 (FR-13): WHEN a push is sent to a user whose interface language is English, THE system SHALL
  send the link `/en/notices`.
- AC-38 (FR-14): IF the push service is unreachable for every device, THEN THE system SHALL keep
  creating notices, recording automatic expenses and listing the notices with the right unread count.
- AC-39 (FR-14): IF a send fails, THEN THE system SHALL log the delivery id, the notice id and the
  status code and nothing else about the device or the text.
- AC-40 (FR-15): WHEN a sent or failed delivery was last updated 7 days ago, THE system SHALL delete
  it and leave the notice unchanged.
- AC-41 (FR-16): WHEN the service worker receives a push with a valid payload, THE service worker
  SHALL show a notification with the payload's title and text, tagged with the notice id.
- AC-42 (FR-16): IF the push payload is missing or is not valid JSON, THEN THE service worker SHALL
  show a notification titled "Pesly" without text that opens the app root.
- AC-43 (FR-17): WHEN the user taps a notification while an app window is open, THE service worker
  SHALL focus that window and navigate it to the notification's link.
- AC-44 (FR-17): WHEN the user taps a notification and no app window is open, THE service worker SHALL
  open a window on the notification's link.
- AC-45 (FR-17): IF the link of a notification is not a path of the app's own origin, THEN THE service
  worker SHALL open the app root instead.
- AC-46 (FR-18): WHEN the user taps "Enable notifications", THE web app SHALL ask the browser for push
  permission.
- AC-47 (FR-18): WHILE the user has not tapped "Enable notifications", THE web app SHALL not ask for
  push permission, on any screen and on sign-in.
- AC-48 (FR-18): WHEN the browser grants the permission, THE web app SHALL subscribe the device with
  the public key from the server, store the subscription and show notifications as on.
- AC-49 (FR-18): IF the browser denies the permission, THEN THE web app SHALL store nothing and show
  that notifications are blocked and how to allow them in the browser settings.
- AC-50 (FR-18): IF the server rejects the subscription after the browser created it, THEN THE web app
  SHALL remove the browser subscription and show an error with a retry.
- AC-51 (FR-19): WHEN notifications are on for the device and the user taps "Disable notifications",
  THE web app SHALL delete the subscription on the server, remove it in the browser and show
  notifications as off, leaving the other devices on.
- AC-52 (FR-19): WHILE the permission is granted and the browser holds a subscription, THE web app
  SHALL show notifications as on for this device.
- AC-53 (FR-19): IF the server cannot delete the subscription when the user disables notifications,
  THEN THE web app SHALL keep notifications on and show an error with a retry.
- AC-54 (FR-20): WHEN a user on iPhone or iPad without the app on the Home Screen taps "Enable
  notifications", THE web app SHALL explain that push notifications require adding the app to the Home
  Screen and SHALL not ask for permission.
- AC-55 (FR-20): IF the browser has no Push API or no Notification API, THEN THE web app SHALL show
  that this browser cannot receive push notifications and offer no enable control.
- AC-56 (FR-20): WHILE the app runs from the Home Screen on iPhone or iPad, THE web app SHALL offer
  "Enable notifications" like on any other browser.
- AC-57 (FR-21): WHEN the user opens the notifications settings and the browser holds a subscription
  with the permission granted, THE web app SHALL send that subscription to the server.
- AC-58 (FR-21): IF the browser holds no subscription for the device, THEN THE web app SHALL show
  notifications as off and call no endpoint that stores a subscription.
- AC-59 (FR-22): WHEN `PUSH_PROVIDER` is `fake`, THE system SHALL open no connection to a push service
  and SHALL record each send for the tests to read.
- AC-60 (FR-22): IF `NODE_ENV` is production and `PUSH_PROVIDER` is not `webpush` or a VAPID setting is
  missing or malformed, THEN THE worker and the API SHALL refuse to start and name the variable
  without its value.
- AC-61 (FR-22): IF `PUSH_PROVIDER` is `webpush` and `VAPID_SUBJECT` is neither a `mailto:` nor an
  https URL, THEN THE worker SHALL refuse to start.
- AC-62 (FR-22): WHEN the adapter is given the inputs of the RFC 8291 test vector, THE adapter SHALL
  produce the encrypted body of that vector, and its VAPID header SHALL carry an ES256 token whose
  audience is the push service origin and whose expiry is 12 hours or less.
- AC-63 (FR-22): IF the push service answers with a redirect, THEN THE adapter SHALL not follow it and
  SHALL report a final failure.

## Out of Scope
- Email or SMS (decision 2026-09-25: push and in-app only).
- Push for budget alerts (`budget_alert` notices stay in-app; PRD 06 keeps them there).
- A `pushsubscriptionchange` handler in the service worker; the settings screen re-registers the
  subscription instead (FR-21).
- Native apps and push channels other than Web Push (FCM or APNs direct).
- Per-kind or per-payment push settings, quiet hours and snoozing.
- A list of the user's devices with names, and remote disabling of another device.
- Action buttons on notifications, and opening a notice by its id (the link opens the notices
  screen).
- Showing a badge count on the app icon.
- Pushing notices created before this ticket is deployed (they are marked as handled by the migration).
- Calling the real push service from tests; one manual end-to-end check per environment is a spec
  task.

## Risks and Mitigations
- **The server posts to an endpoint chosen by the client (SSRF)** → https only, an allowlist of push
  service hosts, no IP literals, no redirects, a 10 s timeout (FR-02, AC-05, AC-63, NFR-06).
- **A crash between sending and marking repeats a push** → a lease makes the claim safe (AC-26), and
  the notification `tag` and the push `Topic` are the notice id, so a repeat replaces the earlier one
  on the device and in the push service (FR-16, AC-23); exactly-once over HTTP is not possible, so the
  PRD promises at most one send per claim, not zero repeats after a crash.
- **Financial data on the lock screen** → the text comes from the stored notice text, which has no
  amounts or account names, or is generic for card statements (FR-12, NFR-04).
- **A new runtime dependency, or hand-written cryptography** → see Decision Log item 3: no new
  dependency, with `node:crypto` and the existing `jose`, checked against the RFC 8291 test vector
  (AC-62). If the spec cannot meet that vector, the fallback is the `web-push` library, justified in
  the spec before it is added.
- **A misconfigured or rotated VAPID key makes every push fail with 403** → a final failure per
  delivery, logged with the status code (AC-28), startup refuses malformed keys in production (AC-60)
  and the private key is never rotated without re-subscribing devices; documented in the spec.
- **The push window of the parent (09:00 to 09:15) depends on the notice window of 08c** → the push job
  adds at most 30 s at p95 and 5 min at worst (NFR-01); 08c creates reminders in a 60 s pass, so
  reminders created by 09:10 meet the window.
- **iPhone users who do not install the app miss push** → the in-app notice stays (FR-07 never touches
  it) and the Home Screen explanation is shown (AC-54); accepted by the 2026-09-25 decision.
- **Real push cannot be exercised by Playwright** → the fake provider covers the server, a unit test
  with a fake `PushManager` covers the web app, and one manual check per environment covers the
  browser and the push service.
- **A user on a shared browser receives another user's pushes** → the endpoint belongs to the last user
  who enabled it (AC-03), and disabling deletes it (AC-51).

## Dependencies
- DISC-001-08c — the `notices` table and its publishers; this ticket adds the push handling state to it.
- DISC-001-10f — statement due-date reminders are notices of kind `card_statement_due` and are pushed.
- DISC-001-08b — the worker process and interval job pattern this job joins.
- PRD 01 (Identity & Access) — session, verified email, owner language and account deletion (FR-04,
  FR-12).
- `AGENTS.md` — external services behind adapters, no amounts or account names in push text, i18n for
  every user-facing string (FR-18 to FR-20), no real external calls in tests.
- A VAPID key pair and a contact (`VAPID_SUBJECT`) per environment; in production the settings are added
  to the Railway services through `.railway/railway.ts` with the plan, approval and apply flow, the
  public key on the API and the worker and the private key on the worker only.
- Browsers: Push API and Notification API; iOS and iPadOS 16.4 or later with the app on the Home
  Screen.

## Decision Log
- 2026-10-12: Parent IDs map to this ticket as: FR-13 to FR-01, FR-02, FR-04 to FR-06, FR-08, FR-10,
  FR-13, FR-16, FR-17, FR-21 and FR-22; FR-14 to FR-03, FR-18 and FR-19; FR-15 to FR-20; FR-16 to FR-12;
  FR-24 (push part) to FR-12; NFR-03 to NFR-01; NFR-04 (push part) to NFR-03; AC-16 to AC-22; AC-17 to
  AC-27; AC-18 to AC-46; AC-19 to AC-47; AC-20 to AC-54; AC-21 to AC-32; AC-31 to AC-33. FR-12, FR-13
  and FR-15 of the parent (in-app) were delivered by 08c. New in this ticket: FR-07, FR-09, FR-11,
  FR-14, FR-15, NFR-02 and NFR-04 to NFR-07 and the criteria not listed.
- 2026-10-12: Proposed by the model, for owner ratification (1): one ticket with spec blocks, not a
  split. The pieces share one contract (subscription shape, payload shape, link) and none is useful
  alone: subscriptions without the job send nothing, the job without the web app has no subscribers,
  and the service worker without both has nothing to show. Expected blocks: A data and port (tables,
  provider port, fake, adapter, env), B API routes (subscriptions and configuration), C worker job
  (fan-out, send, retry, purge), D web (service worker handlers, notifications settings). If the spec
  estimates a PR over the review limit, the natural split is A to C (API and worker) then D (web), in
  that order.
- 2026-10-12: Proposed by the model, for owner ratification (2): two additions to the database. A
  `push_subscriptions` table (owner, endpoint unique, `p256dh`, `auth`, timestamps; cascade on user
  delete) and a `push_deliveries` table (notice, subscription, status, attempts, next attempt, lease,
  sent time; unique on notice and subscription; cascade on both). `notices` gets a nullable
  `push_handled_at` column; the migration sets it for every existing row so no old notice is pushed,
  the job sets it when it turns a notice into deliveries or skips it. A delivery table gives
  per-device retries and the uniqueness that makes idempotency a database rule (as 08c did for
  notices). Alternative rejected: a push state on the notice only, which cannot record that device A
  succeeded and device B must retry. The migration is additive; its number follows the merge rule at
  PLAN.
- 2026-10-12: Proposed by the model, for owner ratification (3): no new runtime dependency. The
  adapter implements VAPID (RFC 8292, an ES256 JWT, signed with the `jose` library that `apps/api`
  already depends on) and the `aes128gcm` content encoding (RFC 8291, ECDH, HKDF and AES-128-GCM from
  `node:crypto`) and sends with the built-in `fetch`, about 150 lines, verified against the RFC's own
  test vector (AC-62). Compared with the `web-push` package: the package does the same and is the
  common choice, but it adds a dependency tree to the worker (its own `http_ece`, `jws`, `asn1.js` and
  other packages, to be confirmed on the lockfile at PLAN), the project already carries overrides for
  transitive advisories, and a hand-written adapter is small, fully tested, and gives control of
  redirects, timeouts and logging (AC-63, NFR-06, NFR-07). The cost is that the cryptography is ours;
  the test vector and the fallback in Risks bound it. Ratify, or choose `web-push`; either way
  the spec justifies the dependency before adding it.
- 2026-10-12: Proposed by the model, for owner ratification (4): which notices are pushed. Reminder,
  recorded, not-recorded and statement due-date notices are pushed; `budget_alert` is not (the parent
  and PRD 06 keep budget alerts in-app). A statement due-date push says "A card statement is due on
  <day>" without the card name, because a card is an account-like name and `AGENTS.md` forbids account
  names in push text; the in-app notice keeps the card name. A payment name (a user label like "Luz")
  is allowed, as 08c decided for both channels.
- 2026-10-12: Proposed by the model, for owner ratification (5): subscription endpoints are checked
  against an allowlist of push service hosts: `fcm.googleapis.com`, `*.push.services.mozilla.com`,
  `*.push.apple.com` and `*.notify.windows.com`, kept in one constant. This closes the server-side
  request forgery of a client-chosen URL, at the cost that a new push service needs a code change; the
  alternative (any public https host, resolved and checked for private addresses) is less strict and
  harder to test.
- 2026-10-12: Proposed by the model, for owner ratification (6): delivery rules. Time to live 6 hours
  (a "due tomorrow" reminder is still useful that long, not after); urgency normal; at most 5 attempts
  with the waits of the email outbox (30, 90, 210, 450 s); a notice older than 24 hours is not pushed;
  a notice already read when its delivery is due is not pushed; deliveries are purged after 7 days
  like the email outbox; a lease of 2 minutes; 10 s timeout and 20 sends in flight. A 403 is final
  without removing the subscription, because a 403 means our VAPID key, not the device, is wrong.
- 2026-10-12: Proposed by the model, for owner ratification (7): configuration. New variables:
  `PUSH_PROVIDER` (`webpush` or `fake`, default `fake`, must be `webpush` in production, like
  `RATE_PROVIDER`), `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` (base64url, 65 and 32 bytes),
  `VAPID_SUBJECT` and `PUSH_JOB_INTERVAL_SECONDS`. The API parses the public key only; the worker
  parses all of them, so the private key never reaches the API process. `.env.example` and
  `.railway/railway.ts` are updated (`preserve()` for the private key; public key and subject as plain
  values) and the Railway change goes through plan, approval and apply, not directly. A script to
  generate a key pair is part of the spec. Outside production, unset keys make the configuration
  endpoint answer that push is not available.
- 2026-10-12: Proposed by the model, for owner ratification (8): the interface. A new settings screen
  `/settings/notifications` holds the control (it is the only place permission is asked); no prompt
  appears elsewhere. The push links to `/<language>/notices`, not to the notice, because the screen
  already lists and marks notices and a per-notice route does not exist. The notification title is the
  fixed brand name "Pesly" and the body is the notice text.
- 2026-10-12: Proposed by the model, for owner ratification (9): per-user cap of 10 subscriptions (the
  least recently updated is replaced); an endpoint belongs to the last user who stored it, so a shared
  browser never pushes user A's notices after user B enabled notifications; no
  `pushsubscriptionchange` handler, the settings screen re-registers instead (FR-21), and a stale
  endpoint disappears at the first 404 or 410.

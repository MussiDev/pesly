# Spec DISC-001-08d: Push Notifications for Notices

| Field | Value |
|-------|-------|
| Ticket | DISC-001-08d |
| PRD | docs/ddw/prd/prd-DISC-001-08d.md |
| Tier | FEATURE |
| Date | 2026-10-12 |
| Spec loops | 0 |
| Loops since last human decision | 0 |

## Summary
A new `push` module (hexagonal, `apps/api/src/push/`) stores one subscription per device and one delivery per
(notice, subscription). The worker gets a fourth job next to the recurring, statement and email jobs: each pass
turns undelivered notices into deliveries (`FanOutNotices`), claims due deliveries with a row lock and a 2-minute
lease (`DeliverDuePushes`), sends them through a `PushProvider` port with at most 20 sends in flight, and
purges finished deliveries. The real adapter implements VAPID (RFC 8292, signed with `jose`) and the
`aes128gcm` encoding (RFC 8291, `node:crypto`) over the built-in `fetch`, and is checked against the RFC test
vector; a fake provider serves tests and local runs. The API gets three routes (configuration, store, remove)
whose push URL is validated against an allowlist of push service hosts. The web app gets a service worker
`push` and `notificationclick` handler (pure logic in a testable module), a push client and a
`/settings/notifications` screen. No new runtime dependency is added.

## Coverage: PRD → blocks
| Requirement | Covered by |
|---|---|
| FR-01 | Block 1, Block 5 |
| FR-02 | Block 1, Block 5 |
| FR-03 | Block 5, Block 10 |
| FR-04 | Block 2, Block 5 |
| FR-05 | Block 1, Block 5, Block 9 |
| FR-06 | Block 2, Block 6 |
| FR-07 | Block 6, Block 7 |
| FR-08 | Block 4, Block 7 |
| FR-09 | Block 2, Block 7, Block 8 |
| FR-10 | Block 7 |
| FR-11 | Block 4, Block 7 |
| FR-12 | Block 6 |
| FR-13 | Block 1, Block 6 |
| FR-14 | Block 7, Block 8 |
| FR-15 | Block 7, Block 8 |
| FR-16 | Block 9 |
| FR-17 | Block 9 |
| FR-18 | Block 9, Block 10 |
| FR-19 | Block 10 |
| FR-20 | Block 9, Block 10 |
| FR-21 | Block 10 |
| FR-22 | Block 3, Block 4, Block 8 |
| NFR-01 | Strategy: the push job runs every `PUSH_JOB_INTERVAL_SECONDS` (1 to 60, default 10, Block 3) and one pass fans out and then delivers, so a notice reaches the provider within one interval plus the pass time; asserted in Block 8 with a fake clock stepping every 10 s and 100 notices created at random offsets (p95 under 30 s, maximum under 5 min), including the 09:00 to 09:15 reminder window. |
| NFR-02 | Strategy: deliveries are claimed 100 at a time with `FOR UPDATE SKIP LOCKED` on the partial index `push_deliveries_due_idx`, sent 20 at a time and marked with one statement each; benchmark of 5,000 due deliveries with the fake provider in Block 8. |
| NFR-03 | Strategy: the unique key (notice, subscription) makes the fan-out idempotent, the claim sets a lease inside the same statement that selects the row, and every mark is guarded by `status = 'pending'`; asserted with 3 sequential passes and 2 concurrent worker instances in Block 7 and Block 8. |
| NFR-04 | Strategy: the payload is built by one pure function from the notice kind, its stored text (no amount, no account name by 08c) and the day, a statement due-date text carries no card name, and the function refuses a payload over 3,000 bytes; guard test over both languages and all pushed kinds in Block 7. |
| NFR-05 | Strategy: storing is one transaction of at most four statements on `push_subscriptions_endpoint_unique` and `push_subscriptions_user_updated_idx`, removing is one statement; benchmark with a user holding 10 subscriptions (p95 under 300 ms) in Block 5. |
| NFR-06 | Strategy: the adapter aborts every request after 10 s through `AbortSignal.timeout(10_000)` and never follows a redirect (Block 4), and one shared concurrency limiter of 20 wraps every send of the process (Block 7); asserted with a provider that never answers. |
| NFR-07 | Strategy: the push code logs only the delivery id, the notice id, the subscription id and a status code or an error class name, never an error object whose message may carry the URL; the logger also redacts the keys `endpoint`, `p256dh`, `authSecret` and `vapidPrivateKey` (Block 8), and a guard test sends failing deliveries and scans every log line. |

## Decisions and fallbacks
- **Migration number is provisional.** The newest migration on this branch is `0038_exchange_rate_history`. This spec uses `0039_push_notifications` with a journal `when` of `1791830000000` (above `1791820000000`, the maximum of the journal now). The 09b and 09c tickets may also add migrations: whoever merges second renumbers, and the journal `when` must exceed the maximum on `main` at merge time (the Drizzle merge rule). A test in Block 2 asserts that the `0039` journal `when` is the greatest of the journal.
- **No new runtime dependency (PRD Decision Log item 3).** The adapter uses `jose` (already in `apps/api`) for the ES256 token and `node:crypto` (`createECDH`, `hkdfSync`, `createCipheriv`) for RFC 8291, and the built-in `fetch`. Block 4 carries the RFC 8291 test vector. **Fallback decision:** if the vector test cannot be made to pass byte for byte, or a real push service rejects a body that passes the vector, Block 4 switches `web-push-provider.ts` internals to the `web-push` library. That change needs its own justification first (its transitive tree checked on the lockfile, `pnpm audit --prod --audit-level high` clean, the existing overrides respected) and the owner's ratification, as `AGENTS.md` requires for a new runtime dependency. The port, the fake and every other block stay unchanged; the vector test is replaced by a test of the headers and the outcome mapping.
- **Removing a subscription is a `POST`, not a `DELETE` (PRD silent).** The key of a subscription is its URL, which is long and secret-like. A query string would put it in access logs (NFR-07) and some proxies drop a body on `DELETE`, so the route is `POST /push/subscriptions/unsubscribe` with a JSON body.
- **Where the push text comes from.** For `reminder`, `recorded` and `not_recorded` the push body is the stored notice text, which 08c already rendered in the owner's language without amounts or account names. For `card_statement_due` the stored text names the card, so the body is rendered again from the due date and the owner's current language with no card name. The link uses the owner's language at send time. A language change between the notice and its push (at most 24 hours) leaves the stored text in the old language; accepted.
- **Attempts are counted at the claim, not at the failure.** A process that dies after claiming still burns one of the 5 attempts, so a poison delivery cannot loop forever. A crash between an accepted send and the mark repeats at most once per lease; the `tag` and the `Topic` header (the notice id) make the repeat replace the earlier push (PRD Risks).
- **Purge covers `skipped` too.** FR-15 names sent and failed deliveries; a skipped delivery is also finished, so the purge removes the three finished states 7 days after their last update.
- **A moved subscription loses its pending deliveries.** An endpoint belongs to the last user who stored it (AC-03). When the owner changes, the pending deliveries of the previous owner are deleted in the same transaction, and the claim also refuses a delivery whose notice owner is not the subscription owner, so user A's notice text never reaches user B's browser.
- **VAPID settings in Railway.** The private key is `preserve()` on the worker only. The public key and the subject are `preserve()` as well until the owner generates the pair and chooses the contact; then they may become literals. The change goes through plan, approval and apply, never directly (memory rule for `.railway/railway.ts`).
- **`.env.example` edit.** The session that writes this spec cannot read or edit `.env.example` (a deny rule), so Block 3 lists it as a modified file and the implementer adds the five new variables there, after the `RECURRING_JOB_INTERVAL_SECONDS` entry, with the same comment style as the provider variables.
- **Manual check per environment (PRD Out of Scope).** Listed in Final verification; it is the only step that reaches a real push service.

## Dependencies between blocks
Order: 1, 2 and 3 have no dependency on each other and can run in parallel. 4 needs 3 (the port lives in
Block 4, the settings it reads in Block 3). 5 needs 1 and 2. 6 needs 1, 2 and 4 (the port types). 7 needs 2, 4 and
6. 8 needs 3, 4, 6 and 7. 9 needs 1 only. 10 needs 1 and 9, and its end-to-end flow needs 5 and 3 (the e2e API
environment). The parallel groups are therefore: {1, 2, 3, 9}, then {4, 5}, then {6}, then {7}, then {8, 10}.
No file belongs to two blocks: `env.ts`, `.env.example` and the Railway files are Block 3 only; `logger.ts` and
`worker.ts` are Block 8 only; `server.ts` is Block 5 only; `sw.ts` and `api-client.ts` are Block 9 only; the
catalogs, `nav-items.ts` and `playwright.config.ts` are Block 10 only. If the pull request exceeds the review
limit, the natural split is Blocks 1 to 8 (API and worker) and then Blocks 9 and 10 (web), in that order.

## Block 1 — Shared contracts

**Files**
- `packages/shared/src/push/push.ts` (new) — Zod schemas, constants and the allowlist check of the push contract.
- `packages/shared/src/push/index.ts` (new) — barrel.
- `packages/shared/src/index.ts` (modified) — exports `./push`.
- `packages/shared/test/push-schemas.test.ts` (new) — the shared tests.

**Logic**
`PUSH_SERVICE_HOSTS` is the one constant of allowed hosts: `fcm.googleapis.com`, `*.push.services.mozilla.com`,
`*.push.apple.com` and `*.notify.windows.com` (at least one label before the suffix). `isAllowedPushUrl(value)` is a
pure function over one anchored, case-sensitive regular expression, not over `new URL`: the string must be
`https://` + an allowed host + `/` + path characters from the URL-safe set (letters, digits and `-._~!$&'()*+,;=:@%/`)
+ an optional `?query`, at most 2,048 characters, no `#`, no backslash, no space. A user-info part, a port, an IP
literal, `localhost`, a trailing dot and a non-https scheme all fail because the host must be followed directly by `/`
and must match the list. `pushSubscriptionRequestSchema` is `{ endpoint, keys: { p256dh, auth } }` (unknown keys such as
`expirationTime` are stripped); `p256dh` is base64url of 65 bytes (87 characters, canonical final character) and `auth`
is base64url of 16 bytes (22 characters), checked by length arithmetic over the alphabet so the shared package needs
no Node typings. `unsubscribeRequestSchema` is `{ endpoint: string 1..2048 }` without the allowlist, so an unknown URL
answers 404 and not 400. `pushConfigResponseSchema` is `{ available: boolean, publicKey: string | null }` refined so
`available` is true exactly when the key is present. `pushPayloadSchema` is `{ noticeId: uuid, title: string 1..40,
body: string 0..300, url: string }` where `url` is a path that starts with one `/` (never `//`, no backslash).
`pushNoticesLink(language)` returns `/es/notices` or `/en/notices`. Constants: `PUSH_MAX_SUBSCRIPTIONS = 10`,
`PUSH_TTL_SECONDS = 21600`, `PUSH_PAYLOAD_MAX_BYTES = 3000`, `PUSH_MAX_ATTEMPTS = 5`.

**API contract**
Contracts only; the routes that use them are in Block 5.
- Method + path: `GET /push/config`, `PUT /push/subscriptions`, `POST /push/subscriptions/unsubscribe`.
- Request: `PUT` body `{ endpoint: string, keys: { p256dh: string, auth: string } }`; `POST` body `{ endpoint: string }`; `GET` has none.
- Response: `{ available: boolean, publicKey: string | null }`; `{ id: string }`; empty body with 204.
- Error codes: `VALIDATION_FAILED` (400).
- Auth: not applicable here (the routes carry session and verified email).

**Input validation**
- `endpoint`: at most 2,048 characters and on the allowlist for storing; `p256dh` 87 base64url characters; `auth` 22 base64url characters; `url` of a payload a same-origin path only.

**Error handling**
- A failed check is reported by the shared validation middleware as `VALIDATION_FAILED` listing paths only, never values.
- `isAllowedPushUrl` never throws: any non-string or malformed value returns false.
- A key of the wrong length or alphabet fails the schema without being decoded further.

**Required tests**
- [ ] valid endpoints of the four hosts (`https://fcm.googleapis.com/fcm/send/abc`, `https://updates.push.services.mozilla.com/wpush/v2/abc`, `https://web.push.apple.com/abc`, `https://wns2-par02p.notify.windows.com/w/?token=abc`) are accepted — validates AC-01
- [ ] reject (400 mapping) `http://`, `https://evil.example/x`, `https://fcm.googleapis.com.evil.example/x`, `https://user:pw@fcm.googleapis.com/x`, `https://fcm.googleapis.com:8443/x`, `https://127.0.0.1/x`, `https://localhost/x`, `https://[::1]/x`, `https://fcm.googleapis.com\@evil.example/x` and a trailing-dot host — validates AC-05
- [ ] a bare `push.apple.com` with no label before the suffix is invalid, a host that only ends with the suffix text (`evilpush.apple.com`) is invalid — validates AC-05
- [ ] `p256dh` of 64 bytes, of 66 bytes, with a non-base64url character or with a non-canonical last character is invalid; `auth` of 15 and 17 bytes is invalid; an endpoint of 2,049 characters is invalid — validates AC-06
- [ ] the config schema rejects `available: true` with a null key and `available: false` with a key — validates AC-13
- [ ] the config schema accepts `{ available: true, publicKey }` — validates AC-12
- [ ] payload schema accepts `{ noticeId, title: 'Pesly', body, url: '/es/notices' }` and rejects `url` values `//evil.example`, `https://evil.example` and `javascript:alert(1)` — validates AC-36
- [ ] `pushNoticesLink('en')` is `/en/notices` and `pushNoticesLink('es')` is `/es/notices` — validates AC-37

**Completion criterion**
The shared tests pass, `pnpm typecheck` passes across the workspace and the push barrel is exported without Node or DOM types.

## Block 2 — Migration 0039 and Drizzle definitions

**Files**
- `apps/api/drizzle/0039_push_notifications.sql` (new) — creates `push_subscriptions` and `push_deliveries`, adds `notices.push_handled_at`.
- `apps/api/drizzle/rollback/0039_push_notifications.down.sql` (new) — reverse, runnable twice.
- `apps/api/drizzle/meta/0039_snapshot.json` (new) and `apps/api/drizzle/meta/_journal.json` (modified) — snapshot chained from `0038_snapshot.json`, journal entry `idx 39` with `when` 1791830000000.
- `apps/api/src/push/infrastructure/db/schema.ts` (new) and `foreign-relations.ts` (new) — the two tables; the second re-exports `users` and `notices`, the only cross-module imports of the module.
- `apps/api/src/notices/infrastructure/db/schema.ts` (modified) — `pushHandledAt` column and its partial index.
- `apps/api/test/push/push-migration.test.ts` and `apps/api/test/push/push-schema-introspection.test.ts` (new) — migration, constraint and introspection tests.

**Logic**
The migration is additive. It creates the two tables, adds the nullable `notices.push_handled_at`, then runs
`UPDATE notices SET push_handled_at = now()` once so no notice that exists before the deploy is pushed (Out of
Scope), and creates the partial index after the update. The update touches a small table (at most 200 payments per
user) in the migration transaction. A notice inserted by the previous code between the migration and the deploy keeps
`push_handled_at` null and is pushed once by the new job if it is younger than 24 hours, which is the intended
behaviour. The rollback drops the two tables, the index and the column with `IF EXISTS`, so it runs twice.

**Data model**
`push_subscriptions`
- `id uuid primary key default gen_random_uuid()`
- `user_id uuid not null` references `users(id)` on delete cascade
- `endpoint text not null`, check `char_length(endpoint) between 1 and 2048`
- `p256dh text not null`, check `char_length(p256dh) = 87`
- `auth text not null`, check `char_length(auth) = 22`
- `created_at timestamptz not null default now()`, `updated_at timestamptz not null default now()`
- unique `push_subscriptions_endpoint_unique` on (`endpoint`); index `push_subscriptions_user_updated_idx` on (`user_id`, `updated_at` desc, `id` desc)

`push_deliveries`
- `id uuid primary key default gen_random_uuid()`
- `notice_id uuid not null` references `notices(id)` on delete cascade
- `subscription_id uuid not null` references `push_subscriptions(id)` on delete cascade
- `status text not null default 'pending'`, check in (`pending`, `sent`, `failed`, `skipped`)
- `attempts smallint not null default 0`, check between 0 and 5
- `next_attempt_at timestamptz not null default now()`, `lease_until timestamptz null`, `sent_at timestamptz null`
- `created_at timestamptz not null default now()`, `updated_at timestamptz not null default now()`
- unique `push_deliveries_notice_subscription_unique` on (`notice_id`, `subscription_id`)
- partial index `push_deliveries_due_idx` on (`next_attempt_at`) where `status = 'pending'`; index `push_deliveries_subscription_idx` on (`subscription_id`); partial index `push_deliveries_done_idx` on (`updated_at`) where `status <> 'pending'`

`notices`: `push_handled_at timestamptz null`, partial index `notices_push_unhandled_idx` on (`created_at`) where `push_handled_at is null`.

**Input validation**
Not applicable: no input; the database refuses a length, a status, an attempt count or a duplicate outside these rules.

**Error handling**
- A duplicate (notice, subscription) raises a unique violation that the repository of Block 6 turns into "nothing inserted" through `ON CONFLICT DO NOTHING`.
- A second subscription with the same endpoint raises a unique violation that the repository of Block 5 turns into an update.
- A status, a key length or an attempt count outside the checks raises a check violation.

**Required tests**
- [ ] migration registry: journal entry idx 39 exists, its `when` is the greatest of the journal and `0039_snapshot.json` chains on 0038's id — validates NFR-03
- [ ] notices that exist before the migration have `push_handled_at` set and a notice inserted afterwards has it null — validates FR-06
- [ ] inserting the same (notice, subscription) twice is a duplicate that raises the unique violation, and a different subscription succeeds — validates AC-15
- [ ] inserting a second row with an existing endpoint is a conflict that raises the unique violation — validates FR-04
- [ ] an endpoint of 2,049 characters, a `p256dh` of 86 characters and a status `queued` are invalid: each raises an error from the checks — validates NFR-04
- [ ] deleting the user cascades to their subscriptions and deliveries and leaves other users' rows untouched — validates AC-10
- [ ] deleting a subscription deletes its deliveries and keeps the notice — validates AC-27
- [ ] the rollback runs twice and restores the 0038 schema, and the migration re-applies — validates NFR-03
- [ ] introspection: the unique keys, the foreign keys with cascade and the three partial indexes exist as declared — validates NFR-02

**Completion criterion**
`pnpm --filter ./apps/api test` passes the migration and introspection tests on a fresh database, and the journal `when` is above 1791820000000 and above the maximum on `main` at merge time.

## Block 3 — Configuration, deployment settings and key generation

**Files**
- `apps/api/src/shared/config/env.ts` (modified) — the push settings of the worker and of the API.
- `.env.example` (modified) — the five new variables with comments (a deny rule blocks reading it in this session; the implementer edits it).
- `.railway/railway.ts` (modified) — declares the push variables on the api and the worker services.
- `apps/api/scripts/generate-vapid-keys.mjs` (new) — prints a VAPID key pair for one environment.
- `apps/api/test/foundation/push-env.test.ts` and `apps/api/test/deploy/railway-iac.test.ts` (new and modified) — settings and deployment tests.

**Logic**
Shared by the API and the worker (added to the common field set): `PUSH_PROVIDER` (`webpush` or `fake`, default `fake`) and
`VAPID_PUBLIC_KEY` (optional, base64url of 65 bytes starting with `0x04`; a blank value counts as unset). Worker only
(added to the worker's own object, so the API never parses or receives them and a stray value is ignored): `VAPID_PRIVATE_KEY`
(base64url of 32 bytes), `VAPID_SUBJECT` and `PUSH_JOB_INTERVAL_SECONDS` (integer 1 to 60, default 10). Rules, for both
processes: in production `PUSH_PROVIDER` must be `webpush` and `VAPID_PUBLIC_KEY` must be present. Rules for the worker: with
`PUSH_PROVIDER=webpush` (always in production) the private key and the subject are required, the subject is a `mailto:`
address or an https URL, and the private key must derive the configured public key (checked with `createECDH`), so a
mismatched pair stops startup. Every failure names the variable and the rule, never the value, through the existing
`parseWith`. Outside production, unset keys with the fake provider are valid and the configuration route later answers that
push is not available. The key script uses `crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' })`, exports the raw
public point and the private scalar as base64url and prints `VAPID_PUBLIC_KEY=` and `VAPID_PRIVATE_KEY=` lines to standard
output only when run by a person; nothing imports it. In `.railway/railway.ts` the api service gets `PUSH_PROVIDER: 'webpush'`
and `VAPID_PUBLIC_KEY: preserve()`; the worker gets `PUSH_PROVIDER: 'webpush'`, `VAPID_PUBLIC_KEY: preserve()`,
`VAPID_PRIVATE_KEY: preserve()` and `VAPID_SUBJECT: preserve()`.

**Input validation**
- `PUSH_PROVIDER` one of two values; `VAPID_PUBLIC_KEY` 87 base64url characters decoding to a point that starts with `0x04`; `VAPID_PRIVATE_KEY` 43 base64url characters; `VAPID_SUBJECT` at most 255 characters on one line, `mailto:` or https; `PUSH_JOB_INTERVAL_SECONDS` digits only, 1 to 60.

**Error handling**
- A production start without `PUSH_PROVIDER=webpush` or a VAPID setting throws `Invalid environment: <NAME>: <rule>` before anything runs.
- A malformed key, a subject that is neither `mailto:` nor https, or a private key that does not match the public key throws naming the variable.
- A `PUSH_JOB_INTERVAL_SECONDS` outside 1 to 60 or not an integer throws naming the variable.

**Required tests**
- [ ] defaults: `PUSH_PROVIDER` is `fake` and `PUSH_JOB_INTERVAL_SECONDS` is 10 when unset; 1 and 60 are valid — validates NFR-01
- [ ] `PUSH_JOB_INTERVAL_SECONDS` of 0, 61, `1.5` and `abc` is invalid and the error names the variable — validates NFR-01
- [ ] production with `PUSH_PROVIDER=fake`, with no public key or (worker) no private key throws an error that names each variable without its value, in the API and in the worker — validates AC-60
- [ ] production with a public key of 64 bytes or a private key of 31 bytes is invalid, and a private key that does not derive the public key is rejected — validates AC-60
- [ ] `PUSH_PROVIDER=webpush` with `VAPID_SUBJECT=ftp://x` or `https://` plus spaces is invalid and the worker refuses to start, `mailto:ops@example.com` and `https://pesly.com.ar/contact` are accepted — validates AC-61
- [ ] the API environment parses without `VAPID_PRIVATE_KEY` and ignores it when set, so the value never appears in the parsed API settings — validates AC-60
- [ ] non-production with the fake provider and no keys parses and the settings carry no key — validates AC-59
- [ ] the generated key pair passes the worker's production key rules; the Railway definition keeps the private key as `preserve()` on the worker only and has no literal secret — validates FR-22

**Completion criterion**
The settings and deployment tests pass, `pnpm lint` and `pnpm typecheck` pass, and the production settings of the API and the worker refuse to start on every case above. The Railway change is only planned here; applying it follows plan, approval and apply.

## Block 4 — Provider port, fake provider and Web Push adapter

**Files**
- `apps/api/src/push/application/ports/push-provider.ts` (new) — the port, its message and outcome types.
- `apps/api/src/push/infrastructure/providers/fake-push-provider.ts` (new) — records sends, scripts outcomes, opens no connection.
- `apps/api/src/push/infrastructure/providers/web-push-provider.ts` (new) — sends, classifies the answer.
- `apps/api/src/push/infrastructure/providers/aes128gcm.ts` (new) and `vapid.ts` (new) — RFC 8291 encryption and RFC 8292 header, pure.
- `apps/api/test/push/aes128gcm.test.ts`, `vapid.test.ts`, `web-push-provider.test.ts`, `fake-push-provider.test.ts` and `apps/api/test/push/rfc8291-vector.ts` (new) — adapter tests and the vector fixture.

**Logic**
`PushProvider.send(message)` takes `{ target: { pushUrl, p256dh, auth }, body: Uint8Array, ttlSeconds, topic, urgency: 'normal' }`
and resolves to a closed set: `accepted`, `gone`, `rejected` (`status`: number or null) or `retry` (`status`: number or null,
`retryAfterSeconds`: number or null). It never throws for an HTTP or network outcome. `aes128gcm.ts` exports
`encryptPayload({ plaintext, uaPublic, authSecret, salt, serverKeyPair })`, deterministic when the salt and the key pair are
given and random otherwise: ECDH over P-256, `PRK_key = HKDF(auth, ecdh, "WebPush: info\0" || ua_public || as_public, 32)`, then the
content-encryption key (16 bytes, info `Content-Encoding: aes128gcm\0`) and nonce (12 bytes, info `Content-Encoding: nonce\0`),
plaintext followed by the `0x02` delimiter, one record, record size 4096, header `salt || rs || idlen || as_public`. `vapid.ts`
builds `Authorization: vapid t=<jwt>, k=<public key>`: an ES256 token signed with `jose` (`importJWK` from the raw 32-byte scalar
and the 65-byte point) with `aud` the origin of the push URL, `sub` the configured subject and `exp` at most 12 hours ahead.
`web-push-provider.ts` first re-checks the URL with `isAllowedPushUrl` and returns `rejected` with no request when it fails
(defence in depth against a tampered row), then posts with `Content-Encoding: aes128gcm`, `Content-Type: application/octet-stream`,
`TTL`, `Topic`, `Urgency` and the VAPID header, with `redirect: 'manual'`, `signal: AbortSignal.timeout(10_000)` and an injectable
`fetch`. Mapping: 200, 201 and 202 are `accepted`; 404 and 410 are `gone`; 400, 401, 403, 413, any other 4xx and any 3xx are `rejected`
with the status; 429, any 5xx, a timeout, a network failure and an aborted request are `retry`, taking `Retry-After` as seconds or an HTTP
date. The adapter never logs; the caller logs a status. `FakePushProvider` exposes `sent` (the messages in order), `script(pushUrl,
outcomes)` for per-device outcomes and a settable delay.

**Input validation**
- `topic` 1 to 32 characters from the base64url alphabet; `ttlSeconds` integer 0 to 86400; `body` at most 3,993 bytes (the single-record limit); key lengths re-checked before encrypting.

**Error handling**
- A malformed key or a body over the record limit fails before any request and is reported as `rejected` with a null status.
- A redirect answer is a final `rejected` and the redirect is not followed; a timeout or a dropped connection is `retry` with a null status.
- An unexpected answer status is `rejected` (final) so an unknown behaviour never loops.

**Required tests**
- [ ] the encryption of the RFC 8291 example inputs (plaintext "When I grow up, I want to be a watermelon", the RFC's server key pair, user agent public key, auth secret and salt) produces the RFC's encrypted body byte for byte, and a decrypt with the user agent's private key returns the plaintext — validates AC-62
- [ ] the VAPID header holds a token that `jwtVerify` accepts with the public key, with `aud` equal to the origin of the push URL, `sub` equal to the subject and `exp` at most 12 hours after `iat`; a different origin gives a different `aud` — validates AC-62
- [ ] a redirect answer (301, 302, 307) is not followed (one `fetch` call), is `rejected` with the status and is final — validates AC-63
- [ ] every request carries `TTL: 21600`, `Topic` equal to the notice id without hyphens, `Urgency: normal` and `Content-Encoding: aes128gcm` — validates AC-23
- [ ] a 201 answer is `accepted` and a 202 is `accepted` — validates AC-21
- [ ] 404 and 410 map to `gone`; 400, 401, 403 and 413 map to `rejected` with the status — validates AC-28
- [ ] 429 with `Retry-After: 120`, 503, a network error and a timeout map to `retry`, the date form of `Retry-After` is read and a negative value is ignored — validates AC-29
- [ ] a push URL that is not on the allowlist (a tampered row) makes no request and returns `rejected` — validates AC-05
- [ ] a request that never answers is aborted after 10 s (fake timers) and ends as `retry`, and no socket stays open — validates NFR-06
- [ ] the fake provider records each message in order, opens no connection (a `fetch` spy stays at zero) and returns the scripted outcome for one device and `accepted` for another — validates AC-59
- [ ] a body of 4,000 bytes and a public key of 64 bytes are invalid and fail with `rejected` and no request — validates FR-08

**Completion criterion**
The RFC 8291 vector test passes byte for byte, all adapter tests pass without network access, and a code search shows the adapter imports only `jose`, `node:crypto` and the shared allowlist. If the vector cannot pass, the fallback of the Decisions section applies before this block is closed.

## Block 5 — Subscription routes

**Files**
- `apps/api/src/push/domain/push-subscription.ts` (new) — the `PushSubscription` type and the on-curve check of the user agent key.
- `apps/api/src/push/application/manage-push-subscriptions.ts` (new) — `StorePushSubscription` and `RemovePushSubscription` use cases and the repository port.
- `apps/api/src/push/infrastructure/db/drizzle-push-subscription-repository.ts` (new) — upsert, cap, delete.
- `apps/api/src/push/infrastructure/http/push-routes.ts` (new) — the three routes.
- `apps/api/src/push/index.ts` (new) and `apps/api/src/server.ts` (modified) — barrel (routes only) and registration of `createPushRoutes({ db, logger, publicKey })`.
- `apps/api/test/push/push-routes.test.ts`, `push-erasure.test.ts` and `apps/api/test/perf/push-subscriptions.perf.test.ts` (new) — route, erasure and latency tests.

**Logic**
`router.use('/push', requireSession, requireVerifiedEmail)`. Each handler takes its user from the scope of
`OwnerOrGroupMemberAccessPolicy` (write for store and remove, read for the configuration), as the notices routes do. Store runs
one transaction: take `pg_advisory_xact_lock(hashtextextended(userId, 0))`, check that the `p256dh` point is on the P-256 curve
(`createECDH('prime256v1').computeSecret`, a throw means invalid), insert with `ON CONFLICT (endpoint) DO UPDATE SET user_id,
p256dh, auth, updated_at = now()` returning the id, delete the pending deliveries of that subscription whose notice belongs to
another user (an owner change), then delete every row of the user beyond the 10 most recently updated (the 11th replaces the
least recently updated). Remove deletes `WHERE user_id = scope.userId AND endpoint = $1` and answers 404 when no row matched,
which is also the answer for another user's URL. The configuration route answers `{ available: true, publicKey }` when the
public key setting is present and `{ available: false, publicKey: null }` otherwise. The routes work when push is unavailable (a
stored subscription is harmless). Audit lines carry the user id and the subscription id only; the URL and the keys are never
logged and the request logger does not see them (they travel in the body).

**API contract**
- `GET /push/config` — Request: no params, no body. Response 200: `{ available: boolean, publicKey: string | null }`. Error codes: `UNAUTHENTICATED` (401). Auth: session and verified email, read scope.
- `PUT /push/subscriptions` — Request: body `{ endpoint: string, keys: { p256dh: string, auth: string } }`. Response 200: `{ id: string }`. Error codes: `VALIDATION_FAILED` (400), `UNAUTHENTICATED` (401). Auth: session and verified email, write scope.
- `POST /push/subscriptions/unsubscribe` — Request: body `{ endpoint: string }`. Response 204, empty. Error codes: `VALIDATION_FAILED` (400), `NOT_FOUND` (404, not stored for the caller or stored for another user), `UNAUTHENTICATED` (401). Auth: session and verified email, write scope.

**Data model**
Uses `push_subscriptions` of Block 2 unchanged: `endpoint` unique, `user_id` foreign key with cascade, `p256dh` and `auth` not null with their length checks. The 10-row cap is enforced by the transaction under the per-user advisory lock, not by a constraint.

**Input validation**
Body and responses go through the shared schemas of Block 1 and the shared validation middleware; `keys.p256dh` must also be a point of the curve; the JSON body limit of 16 kb already applies.

**Error handling**
- A body that fails the allowlist, the key lengths or the curve check answers `VALIDATION_FAILED` (400) and stores nothing.
- A missing session answers `UNAUTHENTICATED` (401) on the three routes; a verified email is required.
- An unknown or foreign URL on remove answers `NOT_FOUND` (404), never 403, and changes nothing.
- A storage error propagates to the shared error middleware as 500 with no body detail.

**Required tests**
- [ ] a signed-in user with a verified email stores a valid subscription: 200 with an id and one row — validates AC-01
- [ ] storing the same endpoint again with new keys keeps one row for that endpoint, updates the keys and returns the same id — validates AC-02
- [ ] a second user stores the endpoint held by the first: the row belongs to the second user only, and the first user's pending deliveries for it are deleted — validates AC-03
- [ ] a request with no session answers 401 `UNAUTHENTICATED` on the three routes and stores nothing — validates AC-04
- [ ] an endpoint that is http, off the allowlist, an IP address, `localhost`, with credentials or with port 8443 answers 400 `VALIDATION_FAILED` and stores nothing — validates AC-05
- [ ] a `p256dh` of the wrong length, an `auth` of the wrong length, an endpoint of 2,049 characters and a 65-byte key that is not on the curve answer 400 and store nothing — validates AC-06
- [ ] a user with 10 subscriptions stores an 11th: the least recently updated is deleted and 10 remain; two concurrent stores of new endpoints for a user with 9 leave at most 10 — validates AC-07
- [ ] a user with 2 devices removes one: 204, the other stays — validates AC-08
- [ ] removing an endpoint that is not stored answers 404 `NOT_FOUND` and changes nothing — validates AC-09
- [ ] removing an endpoint stored for another user answers 404 `NOT_FOUND` and the row and its deliveries stay unchanged — validates AC-11
- [ ] deleting the account removes the user's subscriptions and deliveries and leaves other users' rows — validates AC-10
- [ ] with the public key set the configuration answers `available: true` and the key — validates AC-12
- [ ] with no public key set the configuration answers `available: false` and a null key, and a missing session answers 401 — validates AC-13
- [ ] with 10 stored subscriptions the p95 of 100 store calls and of 100 remove calls is under 300 ms — validates NFR-05
- [ ] the audit lines and the error body of a failed store contain neither the endpoint nor the keys — validates NFR-07

**Completion criterion**
The route tests pass on a real database, the three routes answer with the documented bodies, and the performance test stays under 300 ms at p95.

## Block 6 — Push text and fan-out of notices

**Files**
- `apps/api/src/push/domain/push-payload.ts` (new) — pure `renderPushPayload`.
- `apps/api/src/push/application/ports/clock.ts` (new) and `ports/push-fan-out.ts` (new) — the clock and the fan-out port.
- `apps/api/src/push/application/fan-out-notices.ts` (new) — the use case.
- `apps/api/src/push/infrastructure/db/drizzle-push-fan-out.ts` (new) — the set-based statements.
- `apps/api/test/push/push-payload.test.ts` and `apps/api/test/push/fan-out-notices.test.ts` (new) — unit and database tests.

**Logic**
`renderPushPayload({ noticeId, kind, language, storedText, dueDate })` returns `{ noticeId, title: 'Pesly', body, url }` where `url` is
`pushNoticesLink(language)`. For `reminder`, `recorded` and `not_recorded` the body is `storedText`. For `card_statement_due` the body is
rendered from the day (`Intl.DateTimeFormat(language, { day: 'numeric', month: 'short', timeZone: 'UTC' })`): `A card statement is due on Oct 15`
or `Vence un resumen de tarjeta el 15 oct`, with no card name. `budget_alert` is never rendered (it throws, so a caller bug cannot push it).
The function throws if the UTF-8 length of the JSON exceeds 3,000 bytes. `FanOutNotices.execute()` repeats one batch of 500 until a
batch is smaller: in one transaction it selects `notices` with `push_handled_at IS NULL` ordered by (`created_at`, `id`) with `FOR UPDATE
SKIP LOCKED`; for each notice that is not `budget_alert`, not read and younger than 24 hours by the injected clock it inserts one
delivery per subscription of the owner with `ON CONFLICT DO NOTHING` (one `INSERT ... SELECT` for the batch); then it sets
`push_handled_at` to the clock for every notice of the batch, including the skipped ones, so a device added later never receives an
old notice. It returns counts only.

**Input validation**
No external input: every value comes from the database; the language is `users.language` (`es` or `en`).

**Error handling**
- A storage error rolls the batch back (nothing is marked handled) and propagates to the job, which logs it and runs the next pass.
- A `budget_alert` notice is marked handled without a delivery and without an error.
- A notice whose owner has no subscription is marked handled with no delivery.
- A payload over the byte limit throws before any send; the delivery use case of Block 7 turns it into a final failure.

**Required tests**
- [ ] a reminder notice for a user with 2 subscriptions creates 2 deliveries, one per subscription — validates AC-14
- [ ] three runs over the same notice hold 1 delivery per subscription, and two concurrent runs do the same without a duplicate or an error — validates AC-15
- [ ] a subscription added after the notice was handled gets no delivery for it — validates AC-16
- [ ] a `budget_alert` notice gets no delivery and is marked handled; `recorded`, `not_recorded` and `card_statement_due` notices get deliveries — validates AC-17
- [ ] a notice 25 hours old gets no delivery, a notice 23 hours old does, and a read notice gets none — validates AC-19
- [ ] a user with a missing subscription (none stored): no delivery is created, the notice stays unread and is marked handled — validates AC-20
- [ ] the English text for "Electricity" due tomorrow is `Electricity is due tomorrow`, taken from the stored text — validates AC-32
- [ ] the Spanish text for "Luz" due tomorrow is `Luz vence mañana` — validates AC-33
- [ ] a payment of 350000.00 on an account named "Galicia" produces a payload with neither `350000` nor `Galicia`, in both languages and all four kinds — validates AC-34
- [ ] the statement of the card "Visa Galicia" due 2026-10-15 in English renders `A card statement is due on Oct 15` and not the card name; the Spanish text carries no card name either — validates AC-35
- [ ] a Spanish user gets `{ noticeId, title: 'Pesly', body, url: '/es/notices' }` — validates AC-36
- [ ] an English user gets the url `/en/notices` — validates AC-37
- [ ] a `budget_alert` kind and a body that makes the payload 3,001 bytes are invalid and throw an error — validates NFR-04
- [ ] a storage error in the middle of a batch rolls it back: no notice is marked handled and the next run handles it — validates FR-06

**Completion criterion**
The payload and fan-out tests pass on a real database, and every pushed kind produces a payload of at most 3,000 bytes.

## Block 7 — Delivery of due pushes

**Files**
- `apps/api/src/push/application/ports/push-delivery-queue.ts` (new) — claim, mark and purge port.
- `apps/api/src/push/application/deliver-due-pushes.ts` (new) — the use case: send, classify, retry.
- `apps/api/src/push/application/limit-concurrency.ts` (new) — a counting limiter, no dependency.
- `apps/api/src/push/infrastructure/db/drizzle-push-delivery-queue.ts` (new) — the claim with lease and the guarded marks.
- `apps/api/test/push/deliver-due-pushes.test.ts`, `push-delivery-concurrency.test.ts` and `push-no-sensitive-text.test.ts` (new) — database tests with the fake provider.

**Logic**
`claimDue(now, limit)` runs one statement: select up to `limit` deliveries with `status = 'pending'`, `next_attempt_at <= now` and
`lease_until IS NULL OR lease_until <= now`, ordered by (`next_attempt_at`, `id`), `FOR UPDATE SKIP LOCKED`; update them with
`attempts = attempts + 1`, `lease_until = now + 120 s`, `updated_at = now`; and return them joined to the notice (kind, text, due date,
read time, owner), the subscription (URL, keys, owner) and the owner's language. A claim that was never marked becomes due again
when its lease passes (AC-26). `DeliverDuePushes.execute()` claims batches of 100 until a batch is empty and hands every row to the
process-wide limiter of 20. Per row: a read notice, a `budget_alert` kind or a subscription whose owner is not the notice owner is
marked `skipped` with nothing sent; otherwise it builds the payload with `renderPushPayload`, sends with `ttlSeconds` 21600, `topic` the
notice id without hyphens and `urgency` normal, and acts on the outcome: `accepted` marks `sent` with the time; `gone` deletes the
subscription (its pending deliveries cascade, the notice and the other devices are untouched); `rejected` marks `failed` and logs the
status; `retry` marks `failed` when `attempts` is 5, otherwise schedules `next_attempt_at = now + min(900, max(30 × (2^attempts − 1),
Retry-After))` and clears the lease, giving 30, 90, 210 and 450 s. Every mark has `WHERE id = $1 AND status = 'pending'`, so a late
second writer changes nothing. An exception while handling one row (a storage error on the mark, a payload over the limit) is caught per
row, logged with the ids and the error class name, and the row is left to its lease. `purgeDone(cutoff)` deletes rows whose status is not
`pending` and whose `updated_at` is before the cutoff. Logs carry the delivery id, the notice id and the status code only.

**Input validation**
No external input: the rows come from the database and the provider outcome is a closed set.

**Error handling**
- A `gone` outcome deletes only that subscription; the other devices of the user still receive their pushes in the same pass.
- A `rejected` outcome (400, 401, 403, 413, a redirect) is final, keeps the subscription (a 403 means the VAPID key is wrong, not the device) and logs the status.
- A `retry` outcome on the fifth attempt is final and logged; before that it is rescheduled for that device alone.
- A thrown error on one row never stops the other rows of the batch or the pass.

**Required tests**
- [ ] a due delivery accepted with 201 is marked `sent` with the sending time and is not sent again by the next pass — validates AC-21
- [ ] a reminder for a user with 2 devices sends 1 push to each of the 2 endpoints — validates AC-22
- [ ] the message carries `ttlSeconds` 21600 and a topic equal to the notice id without hyphens — validates AC-23
- [ ] three passes in a row over the same due delivery send it once — validates AC-24
- [ ] two instances of the use case claiming at the same time send each delivery once — validates AC-25
- [ ] a claimed delivery that is never marked is due again after the 2-minute lease and is sent by a later pass; before the lease passes it is not claimed — validates AC-26
- [ ] a notice read before its delivery is due sends nothing and the delivery is `skipped` — validates AC-18
- [ ] a 410 and a 404 outcome delete that subscription and its pending deliveries, keep the notice and the other device still receives its push — validates AC-27
- [ ] 400, 401, 403 and 413 mark the delivery `failed` with no retry, keep the subscription and log the status — validates AC-28
- [ ] 429 with `Retry-After: 100`, 503, a timeout and a network error schedule the retries at 30, 90, 210 and 450 s, the wait is at least `Retry-After` and is capped at 900 s — validates AC-29
- [ ] the fifth failed attempt marks the delivery `failed`, makes no sixth attempt and logs the failure — validates AC-30
- [ ] device A fails with 503 and device B succeeds: B stays `sent`, A is retried alone and B is not sent again — validates AC-31
- [ ] with the provider unreachable for every device no delivery is lost and notices stay unchanged — validates AC-38
- [ ] a failed send logs the delivery id, the notice id and the status code and nothing else about the device or the text — validates AC-39
- [ ] a payment of 350000.00 on the account "Galicia" published by the real recording path, then fanned out and sent, never reaches the provider with an amount or the account name, in both languages — validates NFR-04
- [ ] a provider that never answers leaves at most 20 sends in flight at any moment while 60 deliveries are due, and an error thrown by one row does not stop the rest — validates NFR-06
- [ ] a duplicate mark on an already-sent delivery changes nothing and a mark with an invalid status is rejected — validates NFR-03

**Completion criterion**
The delivery tests pass on a real database with the fake provider, with no duplicate send in the sequential, concurrent and lease cases, and the in-flight count never exceeds 20.

## Block 8 — Push job, worker wiring and log safety

**Files**
- `apps/api/src/push/infrastructure/jobs/push-job.ts` (new) — the `setTimeout` chain: fan out, deliver, purge hourly.
- `apps/api/src/push/jobs.ts` (new) — `createPushJob` over the PostgreSQL implementations; worker side only, not in the barrel.
- `apps/api/src/worker.ts` (modified) — builds the provider from `PUSH_PROVIDER`, starts the job and stops it on shutdown.
- `apps/api/src/shared/logging/logger.ts` (modified) — redacts the push URL, key and secret fields of a subscription and of the VAPID settings.
- `apps/api/test/push/push-job.test.ts`, `push-log-safety.test.ts`, `push-two-workers.test.ts` and `apps/api/test/perf/push-delivery.perf.test.ts` (new) — job, log, concurrency and benchmark tests.

**Logic**
`PushJob` is the same chain as the reminder job: one pass runs `FanOutNotices`, then `DeliverDuePushes`, then, at most once an hour,
`purgeDone(now − 7 days)` (the three finished states), each in its own `try/catch` so a failing step is logged and the next step and
the next pass still run; the next pass is scheduled `PUSH_JOB_INTERVAL_SECONDS` after the previous one ends, and `stop()` waits for
the pass in progress. `createPushJob` receives the provider, so `worker.ts` chooses `WebPushProvider` (with the public key, private
key and subject of the worker settings) when `PUSH_PROVIDER` is `webpush` and `FakePushProvider` otherwise, as it does for rates and
prices. No pass touches notices, recording or listing except through the fan-out's own `push_handled_at` mark, so a push failure
cannot affect them. Log calls use `{ deliveryId, noticeId, statusCode }` or `{ errorClass }` and never pass an error object, because
the message of a network error can carry the URL.

**Input validation**
Not applicable: the interval was validated at startup by Block 3 and nothing else comes from outside.

**Error handling**
- A failing fan-out step is logged and the delivery step of the same pass still runs.
- A failing purge is logged and retried at the next hourly slot.
- A pass that throws is logged and the next pass still runs; with the provider unreachable every pass ends normally.

**Required tests**
- [ ] with a fake clock stepping every 10 s a notice created at 09:00:00 reaches the fake provider on the first pass after creation, and over 100 notices created at random offsets the p95 hand-over is under 30 s and the maximum under 5 min — validates NFR-01
- [ ] a reminder created at 09:10 reaches the provider before 09:15 — validates NFR-01
- [ ] sad path: with a provider that fails every send the job keeps running, notices keep being created, an automatic expense is still recorded and the notices list shows the right unread count — validates AC-38
- [ ] a send that ends in an error logs the delivery id, the notice id and the status code, and a failure whose message contains the push URL leaves no log line with the URL, a key or the notice text — validates AC-39
- [ ] a sent or failed delivery last updated 7 days ago is deleted by the purge and the notice is unchanged; one updated 6 days ago stays — validates AC-40
- [ ] a failing purge or a failing fan-out is an error that is logged and the next step and the next pass still run — validates FR-14
- [ ] `PUSH_PROVIDER=fake` opens no connection and records each send for the test to read; the webpush selection needs the three settings — validates AC-59
- [ ] two worker instances running the whole job over the same due deliveries send each notice to each device once — validates NFR-03
- [ ] the logger redacts `endpoint`, `p256dh`, `authSecret`, `vapidPrivateKey` and `body.keys.auth` at the top level and nested, and the VAPID private key never appears in any line of a full job run — validates NFR-07
- [ ] one pass over 5,000 due deliveries with the fake provider finishes in under 60 s — validates NFR-02
- [ ] the worker starts the job with the configured interval and stops it on shutdown without a pending timer — validates FR-22

**Completion criterion**
The job, log and concurrency tests pass, `pnpm test:perf` passes the 5,000-delivery benchmark, and the worker starts and stops the push job with the other jobs.

## Block 9 — Web: service worker handlers, push support and API client

**Files**
- `apps/web/src/lib/service-worker/push-handlers.ts` (new) — pure logic of the `push` and `notificationclick` events.
- `apps/web/src/app/sw.ts` (modified) — registers the two listeners that delegate to the handlers.
- `apps/web/src/lib/push/push-support.ts` (new) and `push-client.ts` (new) — capability detection, subscribe, read and remove in the browser.
- `apps/web/src/lib/api-client.ts` (modified) — `getPushConfig`, `storePushSubscription`, `removePushSubscription`.
- `apps/web/test/push-handlers.test.ts`, `service-worker-push-entry.test.ts`, `push-support.test.ts`, `push-client.test.ts` and `api-client-push.test.ts` (new) — unit tests with fakes.

**Logic**
`push-handlers.ts` takes a small `WorkerDeps` (`showNotification`, `matchAll`, `openWindow`, `origin`) so Vitest runs it with no worker.
`handlePush(text, deps)` parses the data with `pushPayloadSchema.safeParse(JSON.parse(text))`; a valid payload shows
`showNotification(title, { body, tag: noticeId, data: { url } })`; a missing, non-JSON or shape-invalid payload still shows a notification titled
`Pesly` with no body that opens the root (the browser requires a visible notification for every push). `resolveTarget(url, origin)` returns the
path and query only when `url` is a string that starts with one `/`, has no backslash and resolves to the same origin; anything else returns
`/`. `handleNotificationClick(notification, deps)` closes the notification, finds a window client of the origin, focuses it and navigates it
to the target (opening a window when `navigate` is unavailable or fails), and opens a window on the target when no client exists. `sw.ts` adds
`self.addEventListener('push', ...)` and `('notificationclick', ...)` with `event.waitUntil` around the handlers. `push-support.ts` returns a
state from plain values (`userAgent`, `maxTouchPoints`, `standalone`, `hasPushManager`, `hasNotification`, `permission`): `unsupported`,
`ios-needs-install` (iPhone, iPad or an iPadOS desktop user agent that is not running from the Home Screen), `blocked`, `ready`. `push-client.ts`
wraps `navigator.serviceWorker.ready`: `readSubscription()`, `subscribe(publicKey)` (the only place that calls `Notification.requestPermission`
and `pushManager.subscribe`, with `userVisibleOnly: true` and the key as a `Uint8Array`) and `unsubscribe()`; the API client methods use the
shared schemas of Block 1 and the existing request helper with `refreshOnUnauthenticated`.

**Input validation**
- Payload text is parsed as JSON and checked with the shared schema, never trusted; a notification link is accepted only as a same-origin path; the subscription sent to the API is built from the browser's JSON with only `endpoint` and the two keys.

**Error handling**
- A missing, empty, non-JSON or schema-invalid push payload shows the generic `Pesly` notification and never throws.
- A link that is another origin, protocol-relative or `javascript:` opens the app root.
- A `navigate` that rejects falls back to opening a window; `showNotification` that rejects is passed to `waitUntil` so the browser reports it.
- `subscribe` returns a typed failure for a denied permission and for a browser error, never an exception to the container.

**Required tests**
- [ ] a valid payload shows a notification with the payload's title and body tagged with the notice id — validates AC-41
- [ ] a missing payload, an empty string, text that is not JSON and JSON that fails the schema (invalid `noticeId`) show a notification titled `Pesly` with no body that opens `/` — validates AC-42
- [ ] a tap with an open window of the origin focuses it and navigates it to the link — validates AC-43
- [ ] a tap with no open window opens a window on the link; a `navigate` that fails (error) opens a window instead — validates AC-44
- [ ] invalid links `https://evil.example/x`, `//evil.example`, `/\evil.example` and `javascript:alert(1)` open the root, and `/es/notices` opens as is — validates AC-45
- [ ] the entry module registers the `push` and `notificationclick` listeners and the `message` and `fetch` listeners are untouched (stubbed `self` and `serwist`) — validates FR-16
- [ ] an iPhone and an iPadOS desktop user agent outside the Home Screen are `ios-needs-install`, and the same agents in standalone mode are `ready` — validates AC-56
- [ ] no `PushManager` or no `Notification` on a non-iOS agent is `unsupported`; permission `denied` is `blocked` — validates AC-55
- [ ] on `ios-needs-install` the client's `subscribe` is never called and `requestPermission` is never called — validates AC-54
- [ ] `subscribe(publicKey)` asks the permission once, subscribes with `userVisibleOnly`, and a denied permission returns a failure without creating a subscription — validates AC-46
- [ ] the API client sends the store and remove bodies with only the endpoint and keys, parses the configuration, and a 400, a 404 and a network error map to typed failures — validates AC-50
- [ ] a source guard test shows `requestPermission` appears only in `push-client.ts` — validates AC-47

**Completion criterion**
The web unit tests pass, `pnpm lint` and `pnpm typecheck` pass, and the service worker builds with the two new listeners in a production build.

## Block 10 — Web: notifications settings screen and end-to-end flow

**Files**
- `apps/web/src/features/notifications/containers/notifications-settings-container.tsx` (new) — state, API and browser calls.
- `apps/web/src/features/notifications/components/notifications-settings.tsx` (new) — presentational states and controls.
- `apps/web/src/app/[locale]/(app)/settings/notifications/page.tsx` (new) and `apps/web/src/features/shell/nav-items.ts` (modified) — the route and its menu entry.
- `apps/web/messages/en.json` and `apps/web/messages/es.json` (modified) — `notifications` keys and the nav label.
- `apps/web/e2e/push-notifications.spec.ts` (new) and `playwright.config.ts` (modified) — the end-to-end flow and a test public key on the e2e API.
- `apps/web/test/notifications-settings.test.tsx`, `notifications-catalog.test.ts` and the existing nav tests (new and modified) — container, catalog and navigation tests.

**Logic**
The container reads the support state (Block 9), the configuration (`getPushConfig`) and, when the permission is granted, the browser's
subscription. With a subscription it re-registers it with `storePushSubscription` each time the screen opens (FR-21) and shows notifications as
on; an error of that sync keeps it on and shows a retryable sync message. Without one it shows off. "Enable notifications" (the only call to
`push-client.subscribe`) asks the permission, subscribes with the server's public key and stores the subscription; a denied permission shows the
blocked state with how to allow it in the browser settings and stores nothing; a server rejection after the browser subscribed calls
`unsubscribe()` on the browser subscription and shows an error with a retry. "Disable notifications" removes the subscription on the server first,
then in the browser, then shows off; a server failure keeps it on with an error and a retry, and a 404 from the server counts as already removed.
On `ios-needs-install` the enable control is shown and explains the Home Screen requirement without asking; on `unsupported` there is no enable
control and the browser limit is explained; while offline the controls are disabled with a message. Presentational components fetch nothing and
all strings come from the catalogs. The end-to-end spec installs, with `addInitScript`, a stub of `navigator.serviceWorker.ready`, `PushManager` and
`Notification` that returns a subscription with an allowlisted URL and valid P-256 keys generated in the test, and drives the real API and database.

**Input validation**
The screen sends no free text: only the subscription the browser produced, validated by the API; the retry action reuses the same subscription.

**Error handling**
- The configuration cannot be loaded: an error state with a retry, no enable control.
- The browser denies the permission: blocked message, nothing is stored.
- The server rejects the new subscription (400, 5xx, network): the browser subscription is removed and an error with a retry shows.
- The server cannot delete on disable: notifications stay on with an error and a retry.

**Required tests**
- [ ] tapping "Enable notifications" asks the browser for permission — validates AC-46
- [ ] opening the screen, signing in and every other screen never ask for permission (spy on `requestPermission` stays at zero) — validates AC-47
- [ ] a granted permission subscribes with the server's public key, stores the subscription and shows on — validates AC-48
- [ ] a denied permission stores nothing (no API call) and shows blocked with the browser-settings help — validates AC-49
- [ ] the server answers 400 after the browser subscribed: the browser subscription is removed and an error with a retry shows — validates AC-50
- [ ] "Disable notifications" removes the subscription on the server and in the browser and shows off, leaving the other devices untouched — validates AC-51
- [ ] permission granted plus a browser subscription shows on for this device — validates AC-52
- [ ] a server error on remove keeps notifications on and shows an error with a retry — validates AC-53
- [ ] on an iPhone outside the Home Screen tapping enable shows the Home Screen explanation and never asks for permission — validates AC-54
- [ ] with no Push API the screen says the browser cannot receive push and offers no enable control — validates AC-55
- [ ] opening the screen with a granted permission and a browser subscription sends that subscription to the server — validates AC-57
- [ ] no browser subscription shows off and calls no store route — validates AC-58
- [ ] the nav lists the notifications settings entry and the catalogs hold the same `notifications` keys in both languages with no hardcoded string — validates FR-19
- [ ] end to end: enabling stores one row for the e2e user, reloading the screen shows on and re-registers, disabling removes the row — validates AC-48
- [ ] end to end: an enable attempt whose stub endpoint is off the allowlist ends in an error state and no row — validates AC-50
- [ ] the configuration failing to load shows the error state with a retry — validates FR-05
- [ ] disabling when the server answers 404 shows off and removes the browser subscription — validates AC-51

**Completion criterion**
The web unit tests pass, the Playwright flow passes against the fake push provider and the real API, `pnpm lint` and `pnpm typecheck` pass, and the screen renders in both languages inside the authenticated shell.

## Final verification
- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:perf`, `pnpm e2e` and both build commands pass, and coverage stays at or above 80% lines, branches and functions over `apps/api/src`, `apps/web/src` and `packages/shared/src`.
- Every acceptance criterion AC-01 to AC-63 has a passing test named in a block above, and the RFC 8291 vector test (AC-62) passes byte for byte.
- The `0039` journal `when` is above the maximum on `main` at merge time and the number is re-checked against any migration merged by 09b or 09c.
- `pnpm audit --prod --audit-level high` reports nothing new and no runtime dependency was added (the lockfile is unchanged), or the `web-push` fallback was justified and ratified first.
- No log line of a full test run contains a VAPID key, a push URL, a `p256dh` key, an `auth` secret or a notice text.
- Manual check per environment, recorded in the pull request: generate the key pair with `generate-vapid-keys.mjs`, set the variables through plan, approval and apply, enable notifications on desktop Chrome or Android and on an iPhone with the app on the Home Screen, create a reminder, confirm one push arrives within the window with no amount and no account name on the lock screen, tap it and land on `/<language>/notices`, then disable and confirm no further push.

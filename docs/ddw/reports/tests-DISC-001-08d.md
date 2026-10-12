# Test run DISC-001-08d

| Field | Value |
|---|---|
| Runner | vitest (V8 coverage via @vitest/coverage-v8), full suite with coverage |
| Command | `pnpm test:coverage` (Vitest over `apps/api/src`, `apps/web/src` and `packages/shared/src` together, V8 coverage, `TEST_DATABASE_URL` pointing at the local PostgreSQL) |
| Total | 10476 |
| Passed | 10474 |
| Failed | 0 |
| Skipped | 2 |
| Line coverage | 96.84 |
| Branch coverage | 90.11 |
| Function coverage | 94.86 |
| Statement coverage | 94.94 |
| Coverage floor | 80% lines, branches and functions (AGENTS.md, "Testing") |

- Lint and types: `pnpm typecheck` was clean on this tree; eslint was clean on the touched files during development; prettier with `--end-of-line auto` is clean; a CI lint run will confirm.
- Security: `docs/ddw/security/sast-DISC-001-08d.md` reports 0 Critical, 0 High, 0 Medium, 0 Low and 4 Info.

## Scope

Full-suite run (665 test files) on the worktree of DISC-001-08d after merging `main` into it, measured over `apps/api/src`, `apps/web/src` and `packages/shared/src` together, as AGENTS.md requires. The ticket adds the `push` module in `apps/api` (subscriptions, deliveries, the `PushProvider` port with one fake and one Web Push adapter written over `node:crypto`, `jose` and the built-in `fetch`, the fan-out and delivery use cases and the worker job), the shared push contracts in `packages/shared/src/push`, the service worker `push` and `notificationclick` handlers, the push client and the `/settings/notifications` screen in `apps/web`, one migration (0039, additive: tables `push_subscriptions` and `push_deliveries` and the column `notices.push_handled_at`) and no dependency (the RFC 8291 test vector passes byte for byte, so the `web-push` fallback was not needed).

## Acceptance criteria to tests

Folder `apps/api/test/push` unless a path is given; `shared:` is `packages/shared/test`, `web:` is `apps/web/test`, `e2e:` is `apps/web/e2e`, `env:` is `apps/api/test/foundation/push-env.test.ts`. Criteria whose tests carry no `AC-` tag are matched by test name. The database tests run the real repositories over PostgreSQL.

| AC | Tests |
|---|---|
| AC-01 | `push-routes.test.ts` "stores a valid subscription: 200 with a real uuid and one row (AC-01)" |
| AC-02 | `push-routes.test.ts` "storing the same endpoint again updates the keys and returns the same id (AC-02)" |
| AC-03 | `push-routes.test.ts` "moves the endpoint to the second user and deletes the first user pending deliveries (AC-03)" and "keeps the deliveries of the same owner when the endpoint is stored again (AC-03)" |
| AC-04 | `push-routes.test.ts` "answers 401 UNAUTHENTICATED with no session on the three routes and stores nothing (AC-04)" |
| AC-05 | `push-routes.test.ts` "rejects an endpoint that is %s with 400 and stores nothing (AC-05)"; `shared:push-schemas.test.ts` (host allowlist, port, credentials, IP literal and `localhost` cases) |
| AC-06 | `push-routes.test.ts` "rejects wrong key lengths, a 2,049-character endpoint and an off-curve key (AC-06)"; `shared:push-schemas.test.ts` (64 and 66 byte `p256dh`, 15 and 17 byte `auth`) |
| AC-07 | `push-routes.test.ts` "replaces the least recently updated at the 11th and caps concurrent stores at 10 (AC-07)"; `push-send-guards.test.ts` "a store that waited on the per-user lock does not evict its own row" |
| AC-08 | `push-routes.test.ts` "removes one device and keeps the other: 204 (AC-08)" |
| AC-09 | `push-routes.test.ts` "answers 404 NOT_FOUND for an endpoint that is not stored (AC-09)" |
| AC-10 | `push-erasure.test.ts` "removes the user's subscriptions and deliveries and leaves other users' (AC-10)"; `push-migration.test.ts` (cascade on user delete); `apps/api/test/identity/user-erasure.test.ts` (the erasure registry lists `push_subscriptions` and `push_deliveries`) |
| AC-11 | `push-routes.test.ts` "answers 404 for another user endpoint and leaves the row and deliveries (AC-11)" |
| AC-12 | `push-routes.test.ts` "answers available with the public key when it is set (AC-12)"; `shared:push-schemas.test.ts` config schema |
| AC-13 | `push-routes.test.ts` "answers unavailable with a null key when it is not set (AC-13)"; `shared:push-schemas.test.ts` config schema |
| AC-14 | `fan-out-notices.test.ts` "creates one delivery per subscription of the owner (AC-14)" |
| AC-15 | `fan-out-notices.test.ts` "is idempotent across runs, also when two run concurrently (AC-15)"; `push-migration.test.ts` unique (notice, subscription) |
| AC-16 | `fan-out-notices.test.ts` "gives a subscription added later nothing for an already handled notice (AC-16)" |
| AC-17 | `fan-out-notices.test.ts` "skips budget_alert and delivers the other kinds (AC-17)" |
| AC-18 | `deliver-due-pushes.test.ts` "skips a delivery whose notice was read, sending nothing" |
| AC-19 | `fan-out-notices.test.ts` "skips notices older than 24 hours and read ones (AC-19)"; `push-send-guards.test.ts` "skips a delivery whose notice is older than 24 hours at send time" |
| AC-20 | `fan-out-notices.test.ts` "handles a notice of a user without subscriptions and leaves it unread (AC-20)" |
| AC-21 | `deliver-due-pushes.test.ts` "marks an accepted delivery sent with the sending time and does not resend it"; `web-push-provider.test.ts` "maps %i to accepted" (200, 201, 202) |
| AC-22 | `deliver-due-pushes.test.ts` "sends one push to each device of the user with ttl 21600 and the notice id as topic" |
| AC-23 | the same test (ttl 21600 and topic equal to the notice id without hyphens); `web-push-provider.test.ts` "sends the required headers and an encrypted body without following redirects" |
| AC-24 | `push-two-workers.test.ts` "running the whole job over the same notices send each notice to each device once"; `deliver-due-pushes.test.ts` "marks an accepted delivery sent with the sending time and does not resend it" |
| AC-25 | `push-delivery-concurrency.test.ts` "two instances claiming at the same time send each delivery once"; `push-two-workers.test.ts` (two jobs over 30 notices) |
| AC-26 | `deliver-due-pushes.test.ts` "does not claim a leased delivery before 2 minutes and claims it afterwards" |
| AC-27 | `deliver-due-pushes.test.ts` "deletes the subscription on gone and still pushes the other device"; `web-push-provider.test.ts` "maps %i to gone" (404, 410); `push-schema-introspection.test.ts` and `push-migration.test.ts` (deliveries cascade, notice kept) |
| AC-28 | `deliver-due-pushes.test.ts` it.each 400, 401, 403 and 413 (marked failed without retry, subscription kept, status logged); `web-push-provider.test.ts` "maps %i to rejected with the status" |
| AC-29 | `deliver-due-pushes.test.ts` "retries at 30, 90, 210 and 450 seconds and fails on the fifth attempt" and "waits at least Retry-After and caps the wait at 900 seconds"; `web-push-provider.test.ts` 429 with `Retry-After`, 503, HTTP-date form, garbage value, network error and "aborts a request that never answers after 10 s and ends as retry" |
| AC-30 | `deliver-due-pushes.test.ts` "retries at 30, 90, 210 and 450 seconds and fails on the fifth attempt" and "fails an exhausted delivery whose lease passed instead of claiming a sixth time" |
| AC-31 | `deliver-due-pushes.test.ts` "retries only the failing device" |
| AC-32 | `push-payload.test.ts` "uses the stored English text of a reminder (AC-32)" |
| AC-33 | `push-payload.test.ts` "uses the stored Spanish text of a reminder (AC-33)" |
| AC-34 | `push-payload.test.ts` "keeps amounts and account names out of every pushed kind and language (AC-34)"; `push-no-sensitive-text.test.ts` |
| AC-35 | `push-payload.test.ts` "renders a statement notice from the day with no card name (AC-35)" |
| AC-36 | `push-payload.test.ts` "gives a Spanish user the Spanish link and an English user the English one (AC-36, AC-37)" |
| AC-37 | the same test; `shared:push-schemas.test.ts` `pushNoticesLink` |
| AC-38 | `push-job.test.ts` "PushJob with a provider that fails every send (AC-38)": "keeps running, keeps creating notices and leaves the unread count right"; `deliver-due-pushes.test.ts` "loses no delivery when the provider is unreachable for every device" |
| AC-39 | `deliver-due-pushes.test.ts` "logs the delivery id, notice id and status and nothing about the device or text"; `push-log-safety.test.ts` "logs the delivery id, the notice id and the status code of a rejected send" and "never logs the push URL, keys, the VAPID private key or the notice text" |
| AC-40 | `push-job.test.ts` "PushJob purge (AC-40)": "deletes finished deliveries last updated 7 days ago and keeps newer ones, the notice stays"; `deliver-due-pushes.test.ts` "purges finished deliveries older than the cutoff and keeps pending and recent ones" |
| AC-41 | `web:push-handlers.test.ts` "shows the payload title and body tagged with the notice id (AC-41)" |
| AC-42 | `web:push-handlers.test.ts` "shows the generic notification for %s (AC-42)" |
| AC-43 | `web:push-handlers.test.ts` "closes the notification, focuses an open window of the origin and navigates it (AC-43)" |
| AC-44 | `web:push-handlers.test.ts` "opens a window on the link when no window of the origin is open (AC-44)", "opens a window when navigate fails (AC-44)" and "opens a window when navigate is unavailable (AC-44)" |
| AC-45 | `web:push-handlers.test.ts` "opens the root for %s (AC-45)", "keeps a same-origin path and its query as is (AC-45)", "opens the root for the link %s (AC-45)" and "opens the root when the notification carries no data (AC-45)" |
| AC-46 | `web:notifications-settings.test.tsx` "asks for the permission only when "Enable notifications" is tapped (AC-46, AC-47)"; `web:push-client.test.ts` "asks the permission once and subscribes with userVisibleOnly and a Uint8Array key (AC-46)" |
| AC-47 | `web:notifications-settings.test.tsx` (same test); `web:push-client.test.ts` "source guard (AC-47)"; `e2e:push-notifications.spec.ts` (AC-47) |
| AC-48 | `web:notifications-settings.test.tsx` "subscribes with the server key, stores the subscription and shows on (AC-48)"; `e2e:push-notifications.spec.ts` |
| AC-49 | `web:notifications-settings.test.tsx` "stores nothing and shows blocked with the browser-settings help when the permission is denied (AC-49)"; `web:push-client.test.ts` "fails as denied and creates no subscription when the permission is not granted (AC-46)" |
| AC-50 | `web:notifications-settings.test.tsx` "removes the browser subscription and shows an error with a retry when the server answers 400 (AC-50)"; `web:api-client-push.test.ts` (typed failures); `e2e:push-notifications.spec.ts` "a subscription from an unknown push service ends in an error state and stores nothing (AC-50)" |
| AC-51 | `web:notifications-settings.test.tsx` "removes the subscription on the server and in the browser and shows off (AC-51)" and "treats a 404 on disable as already removed ... (AC-51)"; `e2e:push-notifications.spec.ts` |
| AC-52 | `web:notifications-settings.test.tsx` "shows on for this device with a granted permission and a browser subscription (AC-52)" |
| AC-53 | `web:notifications-settings.test.tsx` "keeps notifications on and offers a retry when the server cannot remove the subscription (AC-53)" |
| AC-54 | `web:notifications-settings.test.tsx` "explains the Home Screen on an iPhone outside it and never asks for the permission (AC-54)"; `web:push-client.test.ts` "ios-needs-install (AC-54)" |
| AC-55 | `web:notifications-settings.test.tsx` "says the browser cannot receive push and offers no enable control without the Push API (AC-55)"; `web:push-support.test.ts` "is unsupported without PushManager or Notification on a non-iOS agent (AC-55)" |
| AC-56 | `web:push-support.test.ts` "needs the Home Screen on an iPhone and on an iPadOS desktop user agent (AC-56)" and "is ready on the same agents in standalone mode (AC-56)" |
| AC-57 | `web:notifications-settings.test.tsx` "sends the existing browser subscription to the server each time the screen opens (AC-57)"; `e2e:push-notifications.spec.ts` (reopening re-registers) |
| AC-58 | `web:notifications-settings.test.tsx` "shows off and calls no store route without a browser subscription (AC-58)" |
| AC-59 | `push-job.test.ts` "push provider selection (AC-59)": "fake opens no connection and records each send"; `fake-push-provider.test.ts` "records messages in order, opens no connection and scripts one device" |
| AC-60 | `env:` "refuses the fake provider in production, in the API and the worker", "requires the public key in production, in the API and the worker, blank counting as unset", "requires the private key and the subject in the worker, naming them without values", "rejects a public key of 64 bytes and a private key of 31 bytes" and "rejects a private key that does not derive the public key, naming the variable only"; `push-job.test.ts` "webpush builds the real provider from the three settings" |
| AC-61 | `env:` "rejects VAPID_SUBJECT %j with the worker refusing to start" (`ftp://x`, `https://`, a space, `mailto:`, a newline), "accepts %s" (`mailto:` and https) and "rejects a subject longer than 255 characters" |
| AC-62 | `aes128gcm.test.ts` "reproduces the RFC 8291 example body byte for byte" (vector in `rfc8291-vector.ts`) and "is decryptable by the user agent private key"; `vapid.test.ts` "builds a token jwtVerify accepts with aud, sub and a short exp" and "uses the origin of each push URL as aud" |
| AC-63 | `web-push-provider.test.ts` "maps %i to rejected with the status" for 301, 302 and 307 (one request, no follow) and "sends the required headers and an encrypted body without following redirects" |

Every criterion AC-01 to AC-63 has at least one test; none is left without one.

## Performance, end-to-end and the RFC vector

- Benchmarks (`pnpm test:perf`, run separately from the full suite): `apps/api/test/perf/push-delivery.perf.test.ts`, one pass over 5,000 due deliveries with the fake provider took 941 ms (limit 60 s, NFR-02); `apps/api/test/perf/push-subscriptions.perf.test.ts`, storing and deleting a subscription for a user with 10 subscriptions has p95 under 300 ms (NFR-05).
- End-to-end (`pnpm e2e`, Playwright, `apps/web/e2e/push-notifications.spec.ts`): 2 tests, both pass: the opt-in flow (enable stores one subscription, reopening the screen shows it on and re-registers it, disabling removes it) and a subscription from an unknown push service ends in an error state with nothing stored.
- RFC 8291 test vector (`aes128gcm.test.ts`): the encrypted body matches the vector byte for byte, so no `web-push` dependency was needed and `package.json` and the lockfile are unchanged.
- Sad paths covered: no session 401, endpoint off the allowlist, wrong key lengths, a point off the curve, another user's endpoint 404, expired endpoint 404 and 410, final statuses 400, 401, 403 and 413, retries to the fifth attempt, a provider that never answers, redirects not followed, a throwing row left to its lease, production configuration without a key.

## Run anomalies

- The final full run on the merged tree had 665 files and 10,476 tests with one failing test: `apps/api/test/dashboard/dependencies.test.ts` "apps/api/drizzle holds no new migration" (a pin from 09b on 38 migrations, broken by migration 0039). The test now pins the migration prefix instead of a count and was re-run in isolation (4 of 4 pass); it was not re-run inside a second full run. The totals above are therefore 10,474 passed plus the 2 skipped tests of that run, with the fixed test counted as passing.
- The first full run before the fixes had 10 failing tests. Nine came from the erasure guard registry in `apps/api/test/identity/user-erasure.test.ts`, which did not list the new tables `push_subscriptions` and `push_deliveries`; both were registered and the tests pass. The tenth was the 05j branch-relative scan, fixed on `main` by PR #71 and brought in by the merge. The figures above are those of the repeated run on the merged tree.
- After that run the independent module verifier reported two Medium findings, both fixed with tests: sign-out left the push subscription alive (the subscription is now removed on the server and in the browser before sign-out, best effort; `web:sign-out-push.test.tsx`) and a takeover race between the claim and the send (an atomic ownership confirmation right before the send; `push-send-guards.test.ts` "skips the delivery when another user took the endpoint after the claim"). Low findings fixed: a delivery of a notice older than 24 hours is skipped at send time, `pushUrl` is redacted from logs (`push-log-safety.test.ts` "redacts pushUrl at the top level and nested"), the constants are imported from `packages/shared` (`push-send-guards.test.ts` "are defined once, in packages/shared") and the subscription cap eviction no longer races (`clock_timestamp`, `push-send-guards.test.ts` "a store that waited on the per-user lock does not evict its own row").

## Deviations from the spec, for the record

(none)

## Owner decisions pending

- Decision Log items 1 to 9 of `docs/ddw/prd/prd-DISC-001-08d.md`, proposed by the model and awaiting ratification: (1) one ticket with ten spec blocks; (2) the tables `push_subscriptions` and `push_deliveries` and the column `notices.push_handled_at`; (3) no new runtime dependency, with the adapter over `node:crypto` and `jose`; (4) which notices are pushed and the card statement text without the card name; (5) the allowlist of push service hosts; (6) the delivery rules (time to live 6 hours, 5 attempts, 24 hour age limit, 7 day purge, 2 minute lease, 10 s timeout, 20 in flight, a 403 is final); (7) the configuration variables and `.railway/railway.ts` changes; (8) the settings screen and the link to the notices screen; (9) the cap of 10 subscriptions and the last-user rule for an endpoint.
- The payload text of a reminder reuses the notice text stored when it was created, written in the language of that moment; if the user changes language afterwards, the text and the `/es` or `/en` link can differ (cosmetic, accepted).
- Sign-out removes the device's push subscription, best effort (threat R-15).
- Before `PUSH_PROVIDER=webpush` is enabled in production, the real Railway variables must be set (the VAPID key pair and the subject, generated with `generate-vapid-keys.mjs`); `.railway/railway.ts` is edited but not applied, and the apply goes through plan and approval.
- Migration 0039 has a journal `when` of 1791830000000, above the maximum on `main` (the 0038 entry, 1791820000000); it must stay above the maximum on `main` at merge.
- One manual end-to-end check per environment against a real push service is still to be recorded in the pull request (the only step that reaches a real push service).

## Failures

(none)

## Skips

Two conditional skips that exist on `main`, unrelated to this ticket:

- `apps/api/test/investments/no-float-money.test.ts` (`it.skipIf(!apiExists)`): skipped because the scanned directory is missing in this environment, reason: it is skipped explicitly, never a silent pass.
- `apps/web/test/group-category-views-scans.test.ts` (`describe.skipIf(base === undefined)`): skipped because no git base branch is available in this environment, reason: the scan compares the branch against `main`.

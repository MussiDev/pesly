# Verification DISC-001-08d

| Field | Value |
|---|---|
| Module | `apps/api/src/push/**` (domain, application, Drizzle repositories, Web Push adapter, fake provider, HTTP routes, push job), `apps/api/src/worker.ts` and `apps/api/src/shared/config/env.ts` (push settings), `packages/shared/src/push/**` (contracts), `apps/web` (service worker push handlers, push client, `/settings/notifications` screen, sign-out cleanup); migration `0039_push_notifications` |
| Line coverage | suite 96.84% |
| Branch coverage | suite 90.11% |
| Function coverage | suite 94.86% |
| Statement coverage | suite 94.94% |
| Coverage floor | 80% lines, branches and functions (AGENTS.md, "Testing") |
| Lint | clean on the files of the ticket (`pnpm typecheck` clean on the tree, eslint clean on the touched files, prettier `--end-of-line auto` clean, a CI lint run will confirm; SAST in `docs/ddw/security/sast-DISC-001-08d.md` reports no suppression and no `any`) |

Verified against the PRD (`docs/ddw/prd/prd-DISC-001-08d.md`) and the spec (`docs/ddw/specs/spec-DISC-001-08d.md`) by reading the test files under `apps/api/test/push`, `apps/api/test/foundation/push-env.test.ts`, `apps/api/test/perf` (`push-delivery.perf.test.ts`, `push-subscriptions.perf.test.ts`), `apps/web/test` (push tests), `apps/web/e2e/push-notifications.spec.ts` and `packages/shared/test/push-schemas.test.ts`, and by matching the test names against the test report. Suite figures come from the full run in `docs/ddw/reports/tests-DISC-001-08d.md` (10476 tests, 665 files; 10,474 passed and 2 skipped; the one test that failed in that run, `dashboard/dependencies.test.ts`, was fixed and re-run in isolation, 4 of 4 passing, not in a second full run).

## Acceptance criteria
- ✅ AC-01 — `push-routes.test.ts` "stores a valid subscription: 200 with a real uuid and one row (AC-01)".
- ✅ AC-02 — `push-routes.test.ts` "storing the same endpoint again updates the keys and returns the same id (AC-02)".
- ✅ AC-03 — `push-routes.test.ts` two tests tagged AC-03: the endpoint moves to the second user and the first user's pending deliveries are deleted; the same owner keeps their deliveries.
- ✅ AC-04 — `push-routes.test.ts` "answers 401 UNAUTHENTICATED with no session on the three routes and stores nothing (AC-04)".
- ✅ AC-05 — `push-routes.test.ts` it.each "rejects an endpoint that is %s with 400 and stores nothing (AC-05)"; `shared:push-schemas.test.ts` host, port, credentials, IP and `localhost` cases.
- ✅ AC-06 — `push-routes.test.ts` "rejects wrong key lengths, a 2,049-character endpoint and an off-curve key (AC-06)"; `shared:push-schemas.test.ts`.
- ✅ AC-07 — `push-routes.test.ts` "replaces the least recently updated at the 11th and caps concurrent stores at 10 (AC-07)"; `push-send-guards.test.ts` "a store that waited on the per-user lock does not evict its own row".
- ✅ AC-08 — `push-routes.test.ts` "removes one device and keeps the other: 204 (AC-08)".
- ✅ AC-09 — `push-routes.test.ts` "answers 404 NOT_FOUND for an endpoint that is not stored (AC-09)".
- ✅ AC-10 — `push-erasure.test.ts` "removes the user's subscriptions and deliveries and leaves other users' (AC-10)"; `push-migration.test.ts` cascade; `user-erasure.test.ts` registry lists both tables.
- ✅ AC-11 — `push-routes.test.ts` "answers 404 for another user endpoint and leaves the row and deliveries (AC-11)".
- ✅ AC-12 — `push-routes.test.ts` "answers available with the public key when it is set (AC-12)".
- ✅ AC-13 — `push-routes.test.ts` "answers unavailable with a null key when it is not set (AC-13)".
- ✅ AC-14 — `fan-out-notices.test.ts` "creates one delivery per subscription of the owner (AC-14)".
- ✅ AC-15 — `fan-out-notices.test.ts` "is idempotent across runs, also when two run concurrently (AC-15)"; the unique key in `push-migration.test.ts`.
- ✅ AC-16 — `fan-out-notices.test.ts` "gives a subscription added later nothing for an already handled notice (AC-16)".
- ✅ AC-17 — `fan-out-notices.test.ts` "skips budget_alert and delivers the other kinds (AC-17)".
- ✅ AC-18 — `deliver-due-pushes.test.ts` "skips a delivery whose notice was read, sending nothing" (no AC tag, matched by name).
- ✅ AC-19 — `fan-out-notices.test.ts` "skips notices older than 24 hours and read ones (AC-19)"; `push-send-guards.test.ts` "skips a delivery whose notice is older than 24 hours at send time".
- ✅ AC-20 — `fan-out-notices.test.ts` "handles a notice of a user without subscriptions and leaves it unread (AC-20)".
- ✅ AC-21 — `deliver-due-pushes.test.ts` "marks an accepted delivery sent with the sending time and does not resend it" (matched by name).
- ✅ AC-22 — `deliver-due-pushes.test.ts` "sends one push to each device of the user with ttl 21600 and the notice id as topic" (matched by name).
- ✅ AC-23 — the same test (time to live 21,600 s and topic); `web-push-provider.test.ts` "sends the required headers and an encrypted body without following redirects".
- ✅ AC-24 — `push-two-workers.test.ts` "running the whole job over the same notices send each notice to each device once"; `deliver-due-pushes.test.ts` accepted delivery not resent (matched by name).
- ✅ AC-25 — `push-delivery-concurrency.test.ts` "two instances claiming at the same time send each delivery once"; `push-two-workers.test.ts` (matched by name).
- ✅ AC-26 — `deliver-due-pushes.test.ts` "does not claim a leased delivery before 2 minutes and claims it afterwards" (matched by name).
- ✅ AC-27 — `deliver-due-pushes.test.ts` "deletes the subscription on gone and still pushes the other device"; `web-push-provider.test.ts` "maps %i to gone" for 404 and 410 (matched by name).
- ✅ AC-28 — `deliver-due-pushes.test.ts` it.each 400, 401, 403 and 413 (marked final with no retry, subscription kept, status logged); `web-push-provider.test.ts` "maps %i to rejected with the status" (matched by name).
- ✅ AC-29 — `deliver-due-pushes.test.ts` the retry test with waits of 30, 90, 210 and 450 seconds over five attempts, and "waits at least Retry-After and caps the wait at 900 seconds"; `web-push-provider.test.ts` 429, 503, network and timeout cases (matched by name).
- ✅ AC-30 — `deliver-due-pushes.test.ts` the fifth attempt marks the delivery as final and no sixth claim is made ("... instead of claiming a sixth time"; matched by name).
- ✅ AC-31 — `deliver-due-pushes.test.ts` the test that retries only the one device that answered 503 and does not resend to the other (matched by name; see the test report).
- ✅ AC-32 — `push-payload.test.ts` "uses the stored English text of a reminder (AC-32)".
- ✅ AC-33 — `push-payload.test.ts` "uses the stored Spanish text of a reminder (AC-33)".
- ✅ AC-34 — `push-payload.test.ts` "keeps amounts and account names out of every pushed kind and language (AC-34)"; `push-no-sensitive-text.test.ts`.
- ✅ AC-35 — `push-payload.test.ts` "renders a statement notice from the day with no card name (AC-35)".
- ✅ AC-36 — `push-payload.test.ts` "gives a Spanish user the Spanish link and an English user the English one (AC-36, AC-37)".
- ✅ AC-37 — the same test; `shared:push-schemas.test.ts` `pushNoticesLink`.
- ✅ AC-38 — `push-job.test.ts` "PushJob with a provider that rejects every send (AC-38)": notices are still created and the unread count is right.
- ✅ AC-39 — `deliver-due-pushes.test.ts` "logs the delivery id, notice id and status and nothing about the device or text"; `push-log-safety.test.ts` "logs the delivery id, the notice id and the status code of a rejected send" (matched by name).
- ✅ AC-40 — `push-job.test.ts` "PushJob purge (AC-40)": finished deliveries last updated 7 days ago are deleted and the notice stays.
- ✅ AC-41 — `web:push-handlers.test.ts` "shows the payload title and body tagged with the notice id (AC-41)".
- ✅ AC-42 — `web:push-handlers.test.ts` "shows the generic notification for %s (AC-42)".
- ✅ AC-43 — `web:push-handlers.test.ts` "closes the notification, focuses an open window of the origin and navigates it (AC-43)".
- ✅ AC-44 — `web:push-handlers.test.ts` three tests tagged AC-44 (no window open, navigation refused, navigation unavailable).
- ✅ AC-45 — `web:push-handlers.test.ts` four tests tagged AC-45 (cross-origin and malformed links open the root; a same-origin path is kept).
- ✅ AC-46 — `web:notifications-settings.test.tsx` "asks for the permission only when "Enable notifications" is tapped (AC-46, AC-47)"; `web:push-client.test.ts` (AC-46).
- ✅ AC-47 — the same settings test; `web:push-client.test.ts` "source guard (AC-47)"; `e2e:push-notifications.spec.ts` (AC-47).
- ✅ AC-48 — `web:notifications-settings.test.tsx` "subscribes with the server key, stores the subscription and shows on (AC-48)"; the Playwright opt-in flow.
- ✅ AC-49 — `web:notifications-settings.test.tsx` two tests tagged AC-49 (permission denied; the browser already denies).
- ✅ AC-50 — `web:notifications-settings.test.tsx` the test tagged AC-50 (the server answers 400: the browser subscription is removed and a retry is offered); `e2e:push-notifications.spec.ts` unknown push service (AC-50).
- ✅ AC-51 — `web:notifications-settings.test.tsx` "removes the subscription on the server and in the browser and shows off (AC-51)"; the Playwright opt-in flow.
- ✅ AC-52 — `web:notifications-settings.test.tsx` "shows on for this device with a granted permission and a browser subscription (AC-52)".
- ✅ AC-53 — `web:notifications-settings.test.tsx` "keeps notifications on and offers a retry when the server cannot remove the subscription (AC-53)".
- ✅ AC-54 — `web:notifications-settings.test.tsx` "explains the Home Screen on an iPhone outside it and never asks for the permission (AC-54)"; `web:push-client.test.ts` "ios-needs-install (AC-54)".
- ✅ AC-55 — `web:notifications-settings.test.tsx` "says the browser cannot receive push and offers no enable control without the Push API (AC-55)"; `web:push-support.test.ts` (AC-55).
- ✅ AC-56 — `web:push-support.test.ts` "is ready on the same agents in standalone mode (AC-56)" and "needs the Home Screen on an iPhone and on an iPadOS desktop user agent (AC-56)".
- ✅ AC-57 — `web:notifications-settings.test.tsx` "sends the existing browser subscription to the server each time the screen opens (AC-57)"; the Playwright flow re-registers on reopening.
- ✅ AC-58 — `web:notifications-settings.test.tsx` "shows off and calls no store route without a browser subscription (AC-58)".
- ✅ AC-59 — `push-job.test.ts` "push provider selection (AC-59)": "fake opens no connection and records each send"; `fake-push-provider.test.ts`.
- ✅ AC-60 — `push-env.test.ts` production cases: the fake provider refused, a missing public key (blank counts as unset), a missing private key or subject in the worker, a malformed key and a private key that does not derive the public key, each naming the variable without its value (matched by name).
- ✅ AC-61 — `push-env.test.ts` "rejects VAPID_SUBJECT %j with the worker refusing to start" for `ftp://x`, `https://`, a space, `mailto:` and a newline; `mailto:` and https values accepted (matched by name).
- ✅ AC-62 — `aes128gcm.test.ts` "reproduces the RFC 8291 example body byte for byte"; `vapid.test.ts` "builds a token jwtVerify accepts with aud, sub and a short exp" and "uses the origin of each push URL as aud" (matched by name).
- ✅ AC-63 — `web-push-provider.test.ts` statuses 301, 302 and 307 map to a final rejection with one request, and "sends the required headers and an encrypted body without following redirects" (matched by name).

## Spec blocks
- ✅ Block 1 — shared contracts: `packages/shared/src/push/push.ts` and `index.ts`; `push-schemas.test.ts`.
- ✅ Block 2 — migration 0039 and Drizzle definitions: `apps/api/drizzle/0039_push_notifications.sql` and its rollback exist, journal `when` 1791830000000 above main's 0038 (1791820000000); `push-migration.test.ts` and `push-schema-introspection.test.ts`.
- ✅ Block 3 — configuration, deployment settings and key generation: `env.ts` push settings, `.env.example`, `.railway/railway.ts` edited (not applied), `apps/api/scripts/generate-vapid-keys.mjs`; `push-env.test.ts` and `railway-iac.test.ts`.
- ✅ Block 4 — provider port, fake provider and Web Push adapter: `aes128gcm.test.ts`, `vapid.test.ts`, `web-push-provider.test.ts` and `fake-push-provider.test.ts`; the RFC 8291 vector passes byte for byte.
- ✅ Block 5 — subscription routes: `push-routes.test.ts`, `push-erasure.test.ts` and `apps/api/test/perf/push-subscriptions.perf.test.ts` (p95 under 300 ms).
- ✅ Block 6 — push text and fan-out of notices: `push-payload.test.ts` and `fan-out-notices.test.ts`.
- ✅ Block 7 — delivery of due pushes: `deliver-due-pushes.test.ts`, `push-delivery-concurrency.test.ts`, `push-no-sensitive-text.test.ts` and `push-send-guards.test.ts`.
- ✅ Block 8 — push job, worker wiring and log safety: `push-job.test.ts`, `push-log-safety.test.ts`, `push-two-workers.test.ts` and `apps/api/test/perf/push-delivery.perf.test.ts` (5,000 due deliveries in one pass: 941 ms, limit 60 s).
- ✅ Block 9 — web service worker handlers, push support and API client: `push-handlers.test.ts`, `service-worker-push-entry.test.ts`, `push-support.test.ts`, `push-client.test.ts` and `api-client-push.test.ts`.
- ✅ Block 10 — web notifications settings screen and end-to-end flow: `notifications-settings.test.tsx`, `notifications-catalog.test.ts`, `sign-out-push.test.tsx` and `apps/web/e2e/push-notifications.spec.ts` (2 Playwright tests pass).

## Tests
- ✅ Sad-path tests: no session 401, endpoint off the allowlist, wrong key lengths, off-curve key, another user's endpoint 404, endpoint not stored 404, expired endpoint 404 and 410, final statuses 400, 401, 403 and 413, retries up to the fifth attempt, a provider that never answers, redirects not followed, a throwing row left to its lease, production configuration with a missing or malformed VAPID setting, permission denied in the browser, server rejecting the subscription, server unable to remove it.
- ✅ NFR-01 (hand-off to the push service under 30 s at p95, 5 min at worst): `push-job.test.ts` "hands 100 notices created at random offsets to the provider with p95 under 30 s and max under 5 min" and "hands a reminder created at 09:10 to the provider before 09:15".
- ✅ NFR-02 (5,000 due deliveries in under 60 s): 941 ms.
- ✅ NFR-03 (0 duplicate sends over 3 passes and 2 workers): `push-two-workers.test.ts` and `push-delivery-concurrency.test.ts`.
- ✅ NFR-04 (0 payloads with an amount or an account name, at most 3,000 bytes): `push-payload.test.ts` and `push-no-sensitive-text.test.ts`.
- ✅ NFR-05 (store and delete under 300 ms at p95 with 10 subscriptions): `push-subscriptions.perf.test.ts`.
- ✅ NFR-06 (10 s timeout, at most 20 sends in flight): `web-push-provider.test.ts` "aborts a request that never answers after 10 s and ends as retry" and `push-delivery-concurrency.test.ts` "keeps at most 20 sends in flight with 60 due deliveries and a provider that never answers".
- ✅ NFR-07 (0 log lines with a key, an endpoint or a notice text): `push-log-safety.test.ts`.
- ✅ Registries: the full run found the erasure guard registry missing `push_subscriptions` and `push_deliveries`; both were registered in `user-erasure.test.ts` and the repeat run passes. The branch-relative scan failure of 05j was fixed on `main` by PR #71.
- ✅ Independent module verifier: 0 High. Two Medium findings, both fixed with tests: sign-out left the push subscription alive (now removed on the server and in the browser before sign-out, best effort, threat R-15), and a takeover race between the claim and the send (an atomic ownership confirmation right before the send). Lows fixed: delivery skipped when the notice is older than 24 hours at send time, `pushUrl` log redaction, constants imported from `packages/shared`, subscription cap eviction race (`clock_timestamp`). One Low accepted: the payload text of a reminder is in the language of its creation while the link follows the current language (cosmetic).
- ✅ Security: `docs/ddw/security/sast-DISC-001-08d.md` reports 0 Critical, 0 High, 0 Medium, 0 Low and 4 Info; no dependency was added (the lockfile is unchanged).
- ⚠️ Items from the PRD or the spec that await the owner, none blocking:
  - Decision Log items 1 to 9 of the PRD (one ticket with ten blocks; the two tables and `push_handled_at`; no new dependency; which notices are pushed and the statement text without the card name; the allowlist of push hosts; the delivery rules; the configuration variables; the settings screen and its link; the cap of 10 subscriptions and the last-user rule).
  - The payload text of a reminder reuses the stored notice text, written in the language at creation.
  - Sign-out removes the device's push subscription, best effort.
  - The real Railway variables (VAPID key pair and subject) must be set before `PUSH_PROVIDER=webpush` is enabled in production; `.railway/railway.ts` is edited but not applied.
  - Migration 0039 must keep a journal `when` above the maximum on `main` at merge.
  - One manual end-to-end check per environment against a real push service remains to be recorded in the pull request.
  - 17 criteria (AC-18, AC-21 to AC-31, AC-39 and AC-60 to AC-63) have no AC tag in their tests and are matched by test name above; they could be tagged when the files are next edited.

Result: PASSED

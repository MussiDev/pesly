# SAST report DISC-001-04b: Offline Entry and Sync of New Movements

| Field | Value |
|---|---|
| Ticket | DISC-001-04b |
| Tier | FEATURE |
| Date | 2026-10-05 |
| Scope | `git diff 08c3321..HEAD` over `apps/` and `packages/` without tests and e2e (28 source files): `packages/shared/src/movements/movement.ts`; `apps/api/src/movements/**` (`application/{create-movement,record-device-movement,record-manual-movement}.ts`, `application/ports/{movement-repository,movement-write-limiter}.ts`, `domain/errors.ts`, `infrastructure/db/{drizzle-movement-repository,drizzle-movement-write-limiter,schema}.ts`, `infrastructure/http/movement-routes.ts`); migration `apps/api/drizzle/0018_device_write_limit.sql` and its rollback; `apps/web/src/lib/local-store/**` (`database.ts`, `stores.ts`, `queue.ts`, `device-copy.ts`), `apps/web/src/lib/sync/**` (`sync-pass.ts`, `sync-queue.ts`, `sync-events.ts`), `apps/web/src/lib/api-client.ts`, the entry screen, the movement list and the shell container, catalogs; tests, e2e and the e2e helpers scanned for secrets only. One migration (0018, additive). No dependency added. |
| Method | Manual review of the diff by the orchestrator against catalog §4, targeted searches over the changed files (secrets, dangerous sinks, raw SQL, logging, outbound calls), the threat model R-01 to R-12 as checklist, plus `pnpm audit --prod --audit-level high` on the final tree |
| Result | PASSED — 0 Critical, 0 High, 0 Medium open; 4 Info documented below |

## Findings by rule

- ✅ F-SAST-01 Hardcoded secrets (CWE-798): the secret-pattern search over the 28 source files returns nothing but comments and existing catalog names; `.env` is ignored by git; the queue holds no credential, and the session cookie is never stored by this module (`apps/web/src/lib/sync/sync-queue.ts` only passes the API client it was given).
- ✅ F-SAST-02 SQL injection (CWE-89): the new statements are Drizzle builders with bound values: the insert takes the id as a bound parameter (`apps/api/src/movements/infrastructure/db/drizzle-movement-repository.ts:244`), the lookup by id goes through `findById` scoped to the owner, and the limiter upsert binds owner, bucket and window (`apps/api/src/movements/infrastructure/db/drizzle-movement-write-limiter.ts:45`); the migration and its rollback are fixed text with no interpolation.
- ✅ F-SAST-03 OS command injection (CWE-78): no `child_process`, `exec` or `spawn` in the scope.
- ✅ F-SAST-04 Insecure deserialization (CWE-502): the request body is parsed by the shared Zod schema through the one `validate` middleware (`apps/api/src/movements/infrastructure/http/movement-routes.ts:218`); on the web every record read back from IndexedDB is parsed with `queuedMovementSchema` before use and one that does not parse is skipped (`apps/web/src/lib/local-store/queue.ts:58`); no custom deserialization.
- ✅ F-SAST-05 Path traversal (CWE-22): no file access in `src`; the rollback script is run by hand and reads nothing from input.
- ✅ F-SAST-06 XSS (CWE-79): the pending badge, the offline notice and the saved notice are static catalog text in React nodes; the queued movement is shown through the same row component as server data, its note as React text; no `dangerouslySetInnerHTML`, `innerHTML` or `document.write` in the scope.
- ✅ F-SAST-07 SSRF (CWE-918): no outbound request is added on the API; the sync pass calls only the application's own API client (`apps/web/src/lib/sync/sync-queue.ts:41`).
- ✅ F-SAST-08 Broken cryptography (CWE-327): the device id comes from `crypto.randomUUID()` (`apps/web/src/features/movements/containers/create-movement-container.tsx:80`), a cryptographically secure source; no `Math.random` and no hashing in the scope.
- ✅ F-SAST-09 Debug mode in production (CWE-489): no debug flag added and no `console` call in the scope.
- ✅ F-SAST-10 Logging sensitive data (CWE-532): the route logs `requestId`, `userId` and `movementId` only, for both "movement created" and "movement replayed" (`apps/api/src/movements/infrastructure/http/movement-routes.ts:230`), and a route test checks that neither the amount, the note nor the rate reach the log of a created or a replayed movement (threat R-11); the sync code logs nothing.
- ✅ F-SAST-11 Unrestricted upload (CWE-434): no upload surface.
- ✅ F-SAST-12 Missing CSRF protection (CWE-352): `POST /movements` keeps its session, verified-email and origin guards unchanged; the optional `id` adds no new route and no new state-changing verb.
- ✅ F-SAST-13 Critical/High CVE in a dependency: `pnpm audit --prod --audit-level high` on the final tree — "No known vulnerabilities found"; no dependency was added.
- ✅ F-SAST-14 Incomplete input validation (CWE-20): `id` is a UUID validated by the shared schema on all four creation variants and stripped from the edit schemas (`packages/shared/src/movements/movement.ts`); a malformed id answers 400 and stores nothing; the bucket is a column with a check constraint (`apps/api/src/movements/infrastructure/db/schema.ts:165`); a queued record must carry an id equal to its key and a request that passes the creation schema (`apps/web/src/lib/local-store/queue.ts:22`).
- ✅ F-SAST-15 Insecure error handling (CWE-209): the duplicate-key error is internal and is turned into a replay or a not found before it can reach a response (`apps/api/src/movements/application/record-device-movement.ts:80-83`); a 500 on the id path answers `{ code }` only, which a route test checks; on the web every storage failure is swallowed into a defined fallback (`false`, an empty queue, `undefined`) with no internal text shown.
- ✅ F-SAST-16 Medium CVE in a dependency: none (`pnpm audit` clean at the `high` level and no dependency changed).
- ✅ F-SAST-17 Unsafe function (CWE-95): no `eval`, `new Function` or `exec` in the scope.
- ✅ F-SAST-18 Suppressions complete: no suppressions in this report.
- ✅ F-SAST-19 Suppressions within review window: no suppressions in this report.

## Cross-cutting checks

- Authorization and data scope: the replay lookup and the re-read after a lost race are both scoped to the caller (`apps/api/src/movements/application/record-device-movement.ts:57,82`), so another user's movement is never returned, and an id of another user answers the standard 404 (route, use case and repository tests with two owners; threat R-01, R-02). The insert still goes through the composite keys that tie accounts and categories to the owner. The queue lives in the per-user database `pesly-<userId>`, and the shell sends it only for the user the API confirmed in this visit, never for whoever the pointer names (`apps/web/src/features/shell/containers/authenticated-shell-container.tsx:83`; threat R-06).
- Idempotency and integrity: the id is the primary key, a lost race becomes a replay (a concurrent test with 20 identical creates leaves one row and one spent unit), a replay returns the stored movement and applies nothing from its payload, and the sync pass resends the same id on every attempt (1,000 randomized cuts and 1,000 runs of two passes at once in the unit tests, plus a dropped-response flow in the browser; threat R-04).
- Limits and abuse: creations with an id are counted in their own bucket of 600 per minute per user, replays spend no unit, and requests without an id keep the 60 per minute (route and limiter tests, threat R-03, R-09); the sync pass sends at most 4 requests at a time, stops on network, session, limit and server errors, and honors `Retry-After` with one timer.
- Migration 0018: additive for data (a column with a default `manual`), a primary key swap on a table of about one row per user, applied and reverted in tests on a 0017 database; the rollback only deletes device counters and runs twice and on a missing table (threat R-10). Its journal `when` (1791162359112) is above the maximum on `main` today and must be checked again at merge.
- Release: a movement the server refuses stays in the queue, flagged and not shown, until DISC-001-04c; 04b is not released without 04c, and 04a still ships with 04d (see I-2, I-3).

## Low and informational findings (W-SAST-01)

| ID | Severity | Location | Finding | Disposition |
|---|---|---|---|---|
| I-1 | Info (CWE-922) | `apps/web/src/lib/local-store/queue.ts` | The queue holds unsent amounts, notes, tags and account ids unencrypted in IndexedDB on the device | Same data class and sandbox as threat R-04 of DISC-001-04a, whose recorded decision on local data this ticket does not change (threat R-07); an item leaves the queue once sent. It is NOT wiped on sign-out yet: that wipe belongs to DISC-001-04d and must be in place before 04 ships |
| I-2 | Info (CWE-770) | `apps/api/src/movements/application/record-device-movement.ts:11` | A client that adds an `id` to its creations is held to 600 per minute instead of 60 | Documented in threat R-03 as the consequence of the user's decision of 2026-10-05 (option a): still a hard cap per user behind a verified session, replays are free and cheap, and the manual bucket is untouched for requests without an id |
| I-3 | Info (CWE-390) | `apps/web/src/lib/sync/sync-pass.ts:37` | A movement the server refuses is flagged and kept, and nothing shows it to the person yet | Threat R-08: kept on purpose so nothing is lost; showing and handling it is DISC-001-04c, which is why 04b must be released with 04c |
| I-4 | Info (CWE-204) | `apps/api/src/movements/application/record-device-movement.ts:83` | An id that exists for another user answers 404 while a new id answers 201, so a caller who already knows a UUID learns that it is taken | Threat R-01: the ids are random 122-bit values nobody can guess, the answer is the standard 404 of the API, and the duplicate-key error never reaches a response |

## Summary

Total: 19 categories clean, 0 vulnerabilities open (0 critical, 0 high, 0 medium); 4 Info
documented, none blocking.

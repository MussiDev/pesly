# SAST report DISC-001-04c: Offline Edit and Delete, Sync States, Failures and Retries

| Field | Value |
|---|---|
| Ticket | DISC-001-04c |
| Tier | FEATURE |
| Date | 2026-10-06 |
| Scope | `git diff 0714f5b..HEAD` over `apps/` and `packages/` without tests and e2e (23 source files, all in `apps/web/src`): `lib/local-store/{stores,queue,device-copy,reference-cache}.ts`, `lib/sync/{sync-pass,sync-queue,sync-events,backoff}.ts`, `lib/api-client.ts`, `lib/service-worker/shell-cache.ts`, `features/movements/{sync-overlay,sync-failure,use-movement-form-data}.ts`, the edit screen (`containers/edit-movement-container.tsx`, `containers/edit-movement-route-container.tsx`, `app/[locale]/(app)/movements/edit/page.tsx`, the old `[id]/edit/page.tsx`), the movement list (`containers/movements-container.tsx`, `components/movement-list.tsx`, `components/movement-row.tsx`), the shell (`components/authenticated-shell.tsx`, `components/sync-status.tsx`, `containers/authenticated-shell-container.tsx`), catalogs; tests, e2e and the e2e helpers scanned for secrets only. No API source change, no migration, no dependency added. |
| Method | Manual review of the diff by the orchestrator against catalog §4, targeted searches over the changed files (secrets, dangerous sinks, raw SQL, logging, outbound calls), the threat model R-01 to R-10 as checklist, plus `pnpm audit --prod --audit-level high` on the final tree |
| Result | PASSED — 0 Critical, 0 High, 0 Medium open; 3 Info documented below |

## Findings by rule

- ✅ F-SAST-01 Hardcoded secrets (CWE-798): the secret-pattern search over the 23 source files returns only existing catalog identifiers of `apps/web/src/lib/api-client.ts` (error keys such as `passwordTooShort`); the queue holds no credential and the sync code only uses the API client it is given (`apps/web/src/lib/sync/sync-queue.ts:67`).
- ✅ F-SAST-02 SQL injection (CWE-89): no SQL in the scope; the API is unchanged. The two new e2e helpers (`apps/web/e2e/support/database.ts`) bind every value as a parameter.
- ✅ F-SAST-03 OS command injection (CWE-78): no `child_process`, `exec` or `spawn` in the scope.
- ✅ F-SAST-04 Insecure deserialization (CWE-502): every queue record is parsed with `queuedMovementSchema` before it is written (`apps/web/src/lib/local-store/queue.ts:86`) and after it is read (`apps/web/src/lib/local-store/queue.ts:113`); a record that does not parse is skipped and kept; the server answer written into the device copy is parsed with `movementResponseSchema` first (`apps/web/src/lib/sync/sync-queue.ts`).
- ✅ F-SAST-05 Path traversal (CWE-22): no file access; the edit route builds no path from its query.
- ✅ F-SAST-06 XSS (CWE-79): the sync markers, the waiting count and the failure reason are catalog text in React nodes; the rejection code is never rendered, it only selects a catalog key (`apps/web/src/features/movements/components/movement-row.tsx:214`, `apps/web/src/lib/api-client.ts:182`); no `dangerouslySetInnerHTML`, `innerHTML` or `document.write` in the scope.
- ✅ F-SAST-07 SSRF (CWE-918): no new outbound request; the pass calls `PUT` and `DELETE` of the application's own API through its client (`apps/web/src/lib/sync/sync-queue.ts:67-72`).
- ✅ F-SAST-08 Broken cryptography (CWE-327): no randomness or hashing added; ids of edited and deleted movements come from the server.
- ✅ F-SAST-09 Debug mode in production (CWE-489): no debug flag added and no `console` call in the scope.
- ✅ F-SAST-10 Logging sensitive data (CWE-532): nothing is logged by the new code; the API routes keep logging movement ids only.
- ✅ F-SAST-11 Unrestricted upload (CWE-434): no upload surface.
- ✅ F-SAST-12 Missing CSRF protection (CWE-352): no new route; `PUT` and `DELETE /movements/:id` keep their session, verified-email and origin guards, and the client sends them with the same headers as before.
- ✅ F-SAST-13 Critical/High CVE in a dependency: `pnpm audit --prod --audit-level high` on the final tree — "No known vulnerabilities found"; no manifest or lockfile changed.
- ✅ F-SAST-14 Incomplete input validation (CWE-20): the edit route accepts only a UUID in `?id=` and reads nothing otherwise (`apps/web/src/features/movements/containers/edit-movement-route-container.tsx:7-11`); a queued edit is parsed with the shared `updateMovementRequestSchema` and refused when its type differs from the movement's; the API re-validates every field on arrival.
- ✅ F-SAST-15 Insecure error handling (CWE-209): every storage failure becomes a defined fallback (`false`, zero counts, `undefined`) with no internal text shown; a failed change shows a catalog message, and an unknown code shows the generic message (unit and container tests).
- ✅ F-SAST-16 Medium CVE in a dependency: none (`pnpm audit` clean and no dependency changed).
- ✅ F-SAST-17 Unsafe function (CWE-95): no `eval`, `new Function` or `exec` in the scope.
- ✅ F-SAST-18 Suppressions complete: no suppressions in this report.
- ✅ F-SAST-19 Suppressions within review window: no suppressions in this report.

## Cross-cutting checks

- Authorization and data scope: the queue is per user (`pesly-<userId>`), the pass runs only for the user the API confirmed in this visit (04b), and the server scopes `PUT` and `DELETE` by the session, so a change queued under another user answers 404 and is flagged, never applied (threat R-03). The list, the edit screen and the shell read the queue of the pointer's user only (`apps/web/src/features/shell/containers/authenticated-shell-container.tsx:105`).
- Integrity of queued changes: one record per movement id; every collapse, settle and reject runs inside one IndexedDB transaction (`apps/web/src/lib/local-store/stores.ts:148`) and acts only on the revision that was sent (`apps/web/src/lib/local-store/queue.ts:271`, `:298`), so a change made during a pass is neither deleted nor swallowed by a create replay (threat R-01); a delete of a queued create is sent, and a 404 answer settles it (threat R-05).
- Availability: retries follow 5 s doubling to a 300 s cap, reset after a complete pass, with no timer while the browser is offline or after a refused session (`apps/web/src/lib/sync/sync-queue.ts:44-62`; threat R-06).
- Service worker: one more page path is warmed (`/<locale>/movements/edit`); it is the empty route shell, the same HTML for every movement, and the worker still never caches API answers (threat R-09).

## Low and informational findings (W-SAST-01)

| ID | Severity | Location | Finding | Disposition |
|---|---|---|---|---|
| I-1 | Info (CWE-922) | `apps/web/src/lib/local-store/queue.ts` | Queued edits and the server movement each one changes (`base`) are kept unencrypted in IndexedDB, and sent answers are written into the device copy | Same data class and sandbox as threat R-04 of DISC-001-04a, whose decision this ticket does not change (threat R-07); records leave the queue once settled. The wipe on sign-out belongs to DISC-001-04d and must ship before 04 does |
| I-2 | Info (CWE-841) | `apps/web/src/lib/sync/sync-queue.ts:72` | The last change received by the server wins, so an older offline edit can overwrite a newer one made on another device | Accepted by the PRD decision of 2026-09-25 for personal movements (threat R-02); both devices end on the server's version after their next load |
| I-3 | Info (CWE-770) | `apps/web/src/lib/sync/sync-queue.ts:44` | The backoff counter lives in the tab's memory: a reload starts again at 5 s | One client per user, a 5 s floor, a 5 minute cap and at most 4 requests in flight bound the load (threat R-06); keeping retry state across reloads is not asked by NFR-01 |

## Summary

Total: 19 categories clean, 0 vulnerabilities open (0 critical, 0 high, 0 medium); 3 Info
documented, none blocking.

# SAST report DISC-001-08c: Reminders and in-app notices

| Field | Value |
|---|---|
| Ticket | DISC-001-08c |
| Tier | FEATURE |
| Date | 2026-10-10 |
| Scope | `git diff 76fdc1f..HEAD` over `apps` and `packages`: `apps/api/src/notices` (domain, use cases, Drizzle repository and publisher, routes, presenter), `apps/api/src/recurring` (reminder pass, source, job, recording hooks, ports), `apps/api/src/worker.ts`, `apps/api/src/server.ts`, `apps/api/drizzle/0025_notices.sql` and its rollback, `apps/web/src/features/notices`, the shell navigation, the recurring form, `apps/web/src/lib/api-client.ts`, `packages/shared/src/notices` and the recurring contracts, plus tests |
| Method | Manual review of the changed source plus pattern scans over the changed files (`dangerouslySetInnerHTML`, `innerHTML`, `eval(`, `new Function`, `child_process`, `exec(`, raw `sql`, template literals in queries, `password`, `secret`, `token`, `api key`, `console.`, logger calls), and `pnpm audit --prod --audit-level high` |
| Result | PASSED — 0 Critical, 0 High, 0 Medium open; 0 Low and 1 Info documented below |

## Findings by rule

- ✅ F-SAST-01 Hardcoded secrets (CWE-798): the scan for password, secret, token and key assignments over the changed files found none; the only matches are the existing `COINGECKO_API_KEY` reads in `apps/api/src/worker.ts:50` and password-reset type names in `apps/web/src/lib/api-client.ts:16`, none added by this ticket.
- ✅ F-SAST-02 SQL injection (CWE-89): the notices repository uses Drizzle operators and bound parameters; the keyset predicate at `apps/api/src/notices/infrastructure/db/drizzle-notice-repository.ts:36` binds the cursor values as parameters with `::timestamptz` and `::uuid` casts after the shared validator decoded them, and the `now()` fragments at `apps/api/src/notices/infrastructure/db/drizzle-notice-repository.ts:57` are constants; the migration is a static statement (`apps/api/drizzle/0025_notices.sql:1`).
- ✅ F-SAST-03 OS command injection (CWE-78): no `child_process`, `exec` or `spawn` in the changed code.
- ✅ F-SAST-04 Insecure deserialization (CWE-502): the cursor is parsed with `JSON.parse` inside a try/catch and then validated field by field with Zod before use (`packages/shared/src/notices/notice.ts:73`); nothing else deserializes input.
- ✅ F-SAST-05 Path traversal (CWE-22): no file path is built from input.
- ✅ F-SAST-06 XSS (CWE-79): notice text is rendered as a React text node (`apps/web/src/features/notices/components/notice-list.tsx:32`); no `dangerouslySetInnerHTML` or `innerHTML` in the changed code, and a web test renders markup literally.
- ✅ F-SAST-07 SSRF (CWE-918): no outbound request was added; the web client calls the existing API base only.
- ✅ F-SAST-08 Broken cryptography (CWE-327): no cryptography added or changed.
- ✅ F-SAST-09 Debug mode in production (CWE-489): no debug flag added; idle reminder passes log at debug level (`apps/api/src/recurring/infrastructure/jobs/reminder-job.ts:59`).
- ✅ F-SAST-10 Logging sensitive data (CWE-532): the reminder failure log carries payment id, page position and error class name only (`apps/api/src/recurring/infrastructure/jobs/reminder-job.ts:20`); the route audit line carries request, user and notice ids (`apps/api/src/notices/infrastructure/http/notices-routes.ts:60`) and a test asserts it excludes the notice text; the pass error goes through the `err` serializer.
- ✅ F-SAST-11 Unrestricted upload (CWE-434): not applicable, no upload surface.
- ✅ F-SAST-12 Missing CSRF protection (CWE-352): the three new routes sit behind the existing session middleware and cookie policy used by every authenticated route (`apps/api/src/notices/infrastructure/http/notices-routes.ts:64`); no new cookie or auth mechanism was added.
- ✅ F-SAST-13 Critical/High CVE in a dependency: `pnpm audit --prod --audit-level high` reported "No known vulnerabilities found"; no dependency was added.
- ✅ F-SAST-14 Incomplete input validation (CWE-20): `limit`, `cursor`, the notice id and `reminderDays` are validated by the shared Zod schemas before any handler runs (`apps/api/src/notices/infrastructure/http/notices-routes.ts:70`, `packages/shared/src/recurring/recurring-payment.ts:84`); sad-path tests reject `limit` 51 and 0, a malformed cursor, a non-uuid id and `reminderDays` -1, 31 and 1.5.
- ✅ F-SAST-15 Insecure error handling (CWE-209): route errors go through the shared error middleware (404 for a foreign notice, 400 listing paths only); the job catches errors per payment and reports ids and the class name, never a message or a stack.
- ✅ F-SAST-16 Medium CVE in a dependency: `pnpm audit` over production dependencies reports no known vulnerabilities.
- ✅ F-SAST-17 Unsafe function (CWE-95): no `eval`, `new Function` or `innerHTML`; money stays bigint and `apps/api/test/recurring/no-float-money.test.ts` now also scans the notices files.
- ✅ F-SAST-18 Suppressions complete: no suppressions in this report.
- ✅ F-SAST-19 Suppressions within review window: no suppressions in this report.

## Low and informational findings (W-SAST-01)

| ID | Severity | Location | Finding | Disposition |
|---|---|---|---|---|
| I-1 | Info | `apps/api/src/recurring/infrastructure/db/drizzle-reminder-payment-source.ts:1` | The reminder source reads every owner's active payments and the publisher writes notices for the owner it is given, with no end-user scope; neither is exported through a module index a route can reach | Accepted: the documented worker-only exception, the owner and language come from the same `users` join row (threat model R-04) |

## Summary

Total: 19 categories clean, 0 vulnerabilities open (0 critical, 0 high, 0 medium); 0 Low and 1 Info
documented.

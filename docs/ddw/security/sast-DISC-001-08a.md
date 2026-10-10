# SAST report DISC-001-08a: Recurring payments and occurrences

| Field | Value |
|---|---|
| Ticket | DISC-001-08a |
| Tier | FEATURE |
| Date | 2026-10-09 |
| Scope | `git diff origin/main` over `apps` and `packages`: `packages/shared/src/recurring`; `apps/api/src/recurring` (domain, use cases, ports, Drizzle repositories, routes, presenter); `apps/api/src/movements/infrastructure/recurring`; `apps/api/drizzle/0023_recurring_payments.sql` and its rollback; `apps/web/src/features/recurring`, the three pages under `recurring`, `lib/api-client.ts`, catalogs and navigation; tests and one e2e spec |
| Method | Manual review of the changed source plus pattern scans over the new source trees (`dangerouslySetInnerHTML`, `innerHTML`, `eval`, `child_process`, `console.`, `localStorage`, `JSON.parse`, `readFile`, `new RegExp`, `Math.random`, `fetch(`, `password`, `secret`, `token`, `Number(`, `parseFloat`, `toFixed`, raw `sql` fragments), and `pnpm audit --prod --audit-level high` |
| Result | PASSED — 0 Critical, 0 High, 0 Medium open; 0 Low and 2 Info documented below |

## Findings by rule

- ✅ F-SAST-01 Hardcoded secrets (CWE-798): the scan for password, secret and token assignments over the new trees found none; `.env*` is ignored and was not read.
- ✅ F-SAST-02 SQL injection (CWE-89): repositories use Drizzle operators with bound parameters; the only `.execute` is in the use cases (not SQL), and the raw `sql` fragments are constant check expressions in the schema (`apps/api/src/recurring/infrastructure/db/schema.ts:54`) with no input; the row lock is `.for('update')` (`apps/api/src/recurring/infrastructure/db/drizzle-occurrence-repository.ts:76`).
- ✅ F-SAST-03 OS command injection (CWE-78): no `child_process`, `exec` or `spawn` in the new trees.
- ✅ F-SAST-04 Insecure deserialization (CWE-502): the only parsed input is the request, parsed by the Zod schemas in `packages/shared/src/recurring/recurring-payment.ts`; no `JSON.parse` of untrusted data was added.
- ✅ F-SAST-05 Path traversal (CWE-22): no file path is built; the web client builds URLs from encoded ids and the two links are `/recurring/${id}` with a UUID id (`apps/web/src/features/recurring/components/recurring-payment-list.tsx:35`).
- ✅ F-SAST-06 XSS (CWE-79): no `dangerouslySetInnerHTML` or `innerHTML`; names and amounts render as React text nodes (`apps/web/src/features/recurring/components/occurrence-row.tsx:49`).
- ✅ F-SAST-07 SSRF (CWE-918): no outbound request from the API was added; the web client calls only the configured API origin.
- ✅ F-SAST-08 Broken cryptography (CWE-327): no cryptography added or changed.
- ✅ F-SAST-09 Debug mode in production (CWE-489): no debug flag or verbose error path was added.
- ✅ F-SAST-10 Logging sensitive data (CWE-532): audit lines carry request id, user id and payment or occurrence id only (`apps/api/src/recurring/infrastructure/http/recurring-routes.ts:93`); a route test asserts the log contains no name and no amount.
- ✅ F-SAST-11 Unrestricted upload (CWE-434): not applicable, no upload surface.
- ✅ F-SAST-12 Missing CSRF protection (CWE-352): every write is behind `requireSession`, `requireVerifiedEmail` and the global origin guard; a route test sends writes without the trusted headers and expects refusal with no change (`apps/api/test/recurring/recurring-routes.test.ts`).
- ✅ F-SAST-13 Critical/High CVE in a dependency: `pnpm audit --prod --audit-level high` — "No known vulnerabilities found"; no dependency was added or changed.
- ✅ F-SAST-14 Incomplete input validation (CWE-20): every route validates params and body with the shared schemas (name 1 to 80, amount bounded to 10^15, calendar-valid dates, fields per frequency); the database repeats the bounds as check constraints; the web builders validate before sending; sad-path tests cover each.
- ✅ F-SAST-15 Insecure error handling (CWE-209): domain errors go through the central handler as codes; a Postgres foreign-key violation is mapped to the same 404 as a missing row (`apps/api/src/recurring/infrastructure/db/drizzle-recurring-payment-repository.ts`), so no SQL detail or other user's id existence leaks; the web client maps failures to message keys.
- ✅ F-SAST-16 Medium CVE in a dependency: `pnpm audit` over production dependencies reports no known vulnerabilities.
- ✅ F-SAST-17 Unsafe function (CWE-95): no `eval`, `new Function`, `innerHTML` or `document.write`; no `Number(`, `parseFloat`, `toFixed` or `Math.round` on money, which stays bigint and decimal strings (guarded by `apps/api/test/recurring/no-float-money.test.ts`).
- ✅ F-SAST-18 Suppressions complete: no suppressions in this report.
- ✅ F-SAST-19 Suppressions within review window: no suppressions in this report.

## Low and informational findings (W-SAST-01)

| ID | Severity | Location | Finding | Disposition |
|---|---|---|---|---|
| I-1 | Info | `apps/api/src/recurring/infrastructure/http/recurring-routes.ts:105` | Create, edit, pause, resume and delete have no dedicated rate limiter; confirm is throttled by the movements write limiter | Accepted: the cap of 200 payments per user bounds creation and each action is one owner-scoped statement behind a verified session (threat model R-03) |
| I-2 | Info | `apps/api/src/recurring/infrastructure/db/drizzle-occurrence-repository.ts:76` | The confirmation holds a row lock and a pooled connection while the recorder runs, so about 10 simultaneous confirmations could starve the pool | Accepted: the movements write limiter allows 60 per minute per owner and the lock is per row; recorded as R-05 in the threat model |

## Summary

Total: 17 categories clean, 0 vulnerabilities open (0 critical, 0 high, 0 medium); 0 Low and 2 Info
documented.

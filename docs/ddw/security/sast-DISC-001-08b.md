# SAST report DISC-001-08b: Scheduler and automatic recording of recurring payments

| Field | Value |
|---|---|
| Ticket | DISC-001-08b |
| Tier | FEATURE |
| Date | 2026-10-09 |
| Scope | `git diff origin/main` over `apps`: `apps/api/src/recurring` (use case, ports, Drizzle source and repositories, job, factory), `apps/api/src/movements/infrastructure/accounts/drizzle-expense-recorder.ts` and `.../recurring/drizzle-recurring-expense-recorder.ts`, `apps/api/src/shared/config/env.ts`, `apps/api/src/worker.ts`, `apps/api/drizzle/0024_recurring_auto_recording_from.sql` and its rollback, `.env.example` (not read, see I-2), tests and `CHANGELOG.md` |
| Method | Manual review of the changed source plus pattern scans over the new trees (`eval`, `new Function`, `child_process`, `exec(`, `innerHTML`, `Math.random`, `md5`, `sha1`, raw `sql`, template literals in queries, `password`, `secret`, `token`, `api key`, `console.`), and `pnpm audit --prod --audit-level high` |
| Result | PASSED — 0 Critical, 0 High, 0 Medium open; 0 Low and 2 Info documented below |

## Findings by rule

- ✅ F-SAST-01 Hardcoded secrets (CWE-798): the scan for password, secret, token and key assignments over `apps/api/src/recurring` found none; the job marker `JOB_SESSION_ID` at `apps/api/src/recurring/jobs.ts:49` is a constant label, not a credential.
- ✅ F-SAST-02 SQL injection (CWE-89): the Drizzle source and repositories use operators with bound parameters (`apps/api/src/recurring/infrastructure/db/drizzle-automatic-payment-source.ts:41`); the only raw `sql` fragments are constant expressions in the schema (`apps/api/src/recurring/infrastructure/db/schema.ts:57`), and the migration is a static statement with no input (`apps/api/drizzle/0024_recurring_auto_recording_from.sql:2`).
- ✅ F-SAST-03 OS command injection (CWE-78): no `child_process`, `exec` or `spawn` in the new code.
- ✅ F-SAST-04 Insecure deserialization (CWE-502): no `JSON.parse` of untrusted data was added; the job reads rows from the database only.
- ✅ F-SAST-05 Path traversal (CWE-22): no file path is built from input.
- ✅ F-SAST-06 XSS (CWE-79): no web code changed.
- ✅ F-SAST-07 SSRF (CWE-918): the job makes no outbound request.
- ✅ F-SAST-08 Broken cryptography (CWE-327): no cryptography added or changed.
- ✅ F-SAST-09 Debug mode in production (CWE-489): no debug flag was added; idle passes log at debug level only.
- ✅ F-SAST-10 Logging sensitive data (CWE-532): failure lines carry payment id, occurrence id and the error class name only (`apps/api/src/recurring/infrastructure/jobs/recording-job.ts:25`); the pass error goes through the `err` serializer that drops row values (`apps/api/src/shared/logging/logger.ts:59`, `apps/api/src/recurring/infrastructure/jobs/recording-job.ts:86`); a job test asserts the report carries ids only.
- ✅ F-SAST-11 Unrestricted upload (CWE-434): not applicable, no upload surface.
- ✅ F-SAST-12 Missing CSRF protection (CWE-352): not applicable, the job has no HTTP surface and no route was added or changed.
- ✅ F-SAST-13 Critical/High CVE in a dependency: `pnpm audit --prod --audit-level high` reported "No known vulnerabilities found"; no dependency was added.
- ✅ F-SAST-14 Incomplete input validation (CWE-20): the only new input is `RECURRING_JOB_INTERVAL_SECONDS`, validated as an integer from 1 to 300 with default 60 (`apps/api/src/shared/config/env.ts:92`); sad-path tests reject `0`, `301`, `abc`, `1.5`, `-1`, an empty string, `1e2` and `' 60 '`.
- ✅ F-SAST-15 Insecure error handling (CWE-209): errors are caught per payment, counted and reported with ids and class name; no message text or stack reaches the report callback, and nothing is returned to a caller.
- ✅ F-SAST-16 Medium CVE in a dependency: `pnpm audit` over production dependencies reports no known vulnerabilities.
- ✅ F-SAST-17 Unsafe function (CWE-95): no `eval`, `new Function` or `innerHTML`; money stays bigint, guarded by `apps/api/test/recurring/no-float-money.test.ts`, which now lists the five job files.
- ✅ F-SAST-18 Suppressions complete: no suppressions in this report.
- ✅ F-SAST-19 Suppressions within review window: no suppressions in this report.

## Low and informational findings (W-SAST-01)

| ID | Severity | Location | Finding | Disposition |
|---|---|---|---|---|
| I-1 | Info | `apps/api/src/recurring/jobs.ts:40` | The job reads every owner's active automatic payments and writes in their names with a synthetic scope; the group reader denies all, so group data is unreachable | Accepted: the cross-owner read is the documented worker-only exception, with the user id taken from the same join row (threat model R-03) |
| I-2 | Info | `.env.example` | The file is blocked from reading in this environment by a deny rule, so this review did not inspect the variable block the implementer added; the closeout asks the project owner to check it by hand | Open for the project owner: confirm that `git diff -- .env.example` adds only `RECURRING_JOB_INTERVAL_SECONDS` with a comment and no value other than the default |

## Summary

Total: 17 categories clean, 0 vulnerabilities open (0 critical, 0 high, 0 medium); 0 Low and 2 Info
documented.

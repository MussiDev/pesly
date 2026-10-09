# SAST report FEAT-006: Edit an account's opening balance

| Field | Value |
|---|---|
| Ticket | FEAT-006 |
| Tier | FEATURE |
| Date | 2026-10-09 |
| Scope | `git diff 533395f` over `apps` and `packages`: `packages/shared/src/accounts/account.ts`; `apps/api/src/accounts` (use case, port, Drizzle repository, routes, index); `apps/web/src` (`lib/api-client.ts`, `features/accounts`); `apps/web/messages`; tests and one e2e spec. No `package.json`, lockfile or `apps/api/drizzle` file changed |
| Method | Manual review of the changed source plus pattern scans over the source diff (`dangerouslySetInnerHTML`, `innerHTML`, `eval`, `new Function`, `document.write`, `child_process`, `exec`, `spawn`, `console.`, `localStorage`, `sessionStorage`, `new RegExp`, `readFile`, `Math.random`, `password`, `secret`, `token`, `Number(`, `parseFloat`, `toFixed`), which returned no match, and `pnpm audit --prod --audit-level high` |
| Result | PASSED — 0 Critical, 0 High, 0 Medium open; 0 Low and 2 Info documented below |

## Findings by rule

- ✅ F-SAST-01 Hardcoded secrets (CWE-798): the scan for password, secret and token assignments over the source diff found none; `.env*` is ignored (`.gitignore:12`) and was not read.
- ✅ F-SAST-02 SQL injection (CWE-89): the only new statement is a Drizzle `update(accounts).set({ openingBalance, updatedAt })` with a bound bigint parameter and the shared `scopedRow` condition (`apps/api/src/accounts/infrastructure/db/drizzle-account-repository.ts:120`); the only raw SQL is the existing `sql\`now()\`` fragment, which takes no input.
- ✅ F-SAST-03 OS command injection (CWE-78): no `child_process`, `exec` or `spawn` in the diff.
- ✅ F-SAST-04 Insecure deserialization (CWE-502): the only parsed input is the request body, parsed by the Zod schema `setOpeningBalanceRequestSchema` (`packages/shared/src/accounts/account.ts:122`); no `JSON.parse` of untrusted data was added.
- ✅ F-SAST-05 Path traversal (CWE-22): no file path is built; the web client builds the URL from `resourcePath('accounts', id)`, which encodes the id as one segment (`apps/web/src/lib/api-client.ts:698`), and a test sends `a/b` and expects `a%2Fb`.
- ✅ F-SAST-06 XSS (CWE-79): no `dangerouslySetInnerHTML` or `innerHTML`; the account name and amounts are React text nodes (`apps/web/src/features/accounts/components/account-row.tsx:199`).
- ✅ F-SAST-07 SSRF (CWE-918): no outbound request from the API was added; the web client calls only the configured API origin.
- ✅ F-SAST-08 Broken cryptography (CWE-327): no cryptography added or changed.
- ✅ F-SAST-09 Debug mode in production (CWE-489): no debug flag or verbose error path was added.
- ✅ F-SAST-10 Logging sensitive data (CWE-532): the audit line carries request id, user id and account id only (`apps/api/src/accounts/infrastructure/http/account-routes.ts:168`); a route test asserts the log has no old amount, no new amount and no account name, and no field outside an allowlist (`apps/api/test/accounts/account-routes.test.ts`).
- ✅ F-SAST-11 Unrestricted upload (CWE-434): not applicable, no upload surface.
- ✅ F-SAST-12 Missing CSRF protection (CWE-352): the new route is a PATCH behind `requireSession`, `requireVerifiedEmail` and the existing origin guard; a route test sends the request without the web origin headers and expects 403 with the value unchanged (`apps/api/test/accounts/account-routes.test.ts`).
- ✅ F-SAST-13 Critical/High CVE in a dependency: `pnpm audit --prod --audit-level high` — "No known vulnerabilities found"; no dependency was added or changed.
- ✅ F-SAST-14 Incomplete input validation (CWE-20): the id and body go through `validate` with `accountIdParamsSchema` and `setOpeningBalanceRequestSchema` (bounded to plus or minus 10^15 minor units, string only); the web form text goes through `parseAmountInput` and `openingBalanceSchema` before any request (`apps/web/src/features/accounts/opening-balance-request.ts:19`); tests cover missing, decimal, numeric, over-limit and non-UUID inputs.
- ✅ F-SAST-15 Insecure error handling (CWE-209): errors go through the central handler as codes and field paths; a foreign and a missing account return the same 404 body, asserted by a route test; the web client maps failures to message keys only.
- ✅ F-SAST-16 Medium CVE in a dependency: `pnpm audit` over production dependencies reports no known vulnerabilities.
- ✅ F-SAST-17 Unsafe function (CWE-95): no `eval`, `new Function`, `innerHTML` or `document.write`; no `Number`, `parseFloat` or `toFixed` on amounts, which stay bigint.
- ✅ F-SAST-18 Suppressions complete: no suppressions in this report.
- ✅ F-SAST-19 Suppressions within review window: no suppressions in this report.

## Low and informational findings (W-SAST-01)

| ID | Severity | Location | Finding | Disposition |
|---|---|---|---|---|
| I-1 | Info | `apps/api/src/accounts/infrastructure/http/account-routes.ts:153` | The new route has no dedicated rate limiter, like rename and archive | Accepted: one indexed single-row UPDATE behind a verified session; recorded as R-07 in the threat model and left to the owner as a decision |
| I-2 | Info | `apps/api/src/accounts/application/set-opening-balance.ts:21` | The change is allowed on archived and card-linked accounts | Accepted: same behavior as rename, accepted risk R-03 in the threat model |

## Summary

Total: 17 categories clean, 0 vulnerabilities open (0 critical, 0 high, 0 medium); 0 Low and 2 Info
documented.

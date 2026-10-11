# SAST report DISC-001-07c: Balanz Holdings Excel Import

| Field | Value |
|---|---|
| Ticket | DISC-001-07c |
| Tier | FEATURE |
| Date | 2026-10-10 |
| Scope | `git diff origin/main` over `apps` and `packages`: 19 changed source files (`apps/api/src/app.ts`, `apps/api/src/investments/**`, `apps/web/src/features/investments/**`, `apps/web/src/lib/api-client.ts`, `apps/web/messages`, `packages/shared/src/investments/**`) plus tests and one fixture; no `package.json` or lockfile changed |
| Method | Manual review of every changed source file plus pattern scans over the diff (`eval`, `new Function`, `innerHTML`, `dangerouslySetInnerHTML`, `child_process`, `exec(`, `spawn(`, `readFile`, `fetch(`, `createHash`, `md5`, `sha1`, `Math.random`, `console.log`, secret-looking names) and `pnpm audit --prod --audit-level high` |
| Result | PASSED — 0 Critical, 0 High, 0 Medium open; 0 Low |

## Findings by rule

- ✅ F-SAST-01 Hardcoded secrets (CWE-798): the scan found no key, token or password assignment in the diff; `.env*` is ignored (`.gitignore:12`) and the sample workbook holds only tickers and amounts.
- ✅ F-SAST-02 SQL injection (CWE-89): the import writes through the existing Drizzle repositories (`apps/api/src/investments/application/import-holdings.ts:47`); no SQL string is built and no user object reaches a query.
- ✅ F-SAST-03 OS command injection (CWE-78): no `child_process`, `exec` or `spawn` in the diff; the only `.exec` calls are `RegExp.exec` on a decimal and a day (`apps/web/src/features/investments/balanz-import/parse-balanz-rows.ts:57`, `:71`).
- ✅ F-SAST-04 Insecure deserialization (CWE-502): no `JSON.parse` of untrusted text was added; the file is read by `read-excel-file` as text cells, formulas are never evaluated (`apps/web/src/features/investments/balanz-import/parse-balanz-xlsx.ts:21`) and the request body goes through the Zod schema (`apps/api/src/investments/infrastructure/http/holding-routes.ts:97`).
- ✅ F-SAST-05 Path traversal (CWE-22): no file path is built from the file or the request; the browser reads the chosen `File` in memory and the file name is never read, stored or sent.
- ✅ F-SAST-06 XSS (CWE-79): tickers, names and types from the file render as React text (`apps/web/src/features/investments/components/import-holdings-dialog.tsx`); no `dangerouslySetInnerHTML` or `innerHTML` was added, and a scan test fails if one appears (`apps/web/test/no-raw-html-investments.test.ts`) plus a dialog test with `<img src=x onerror=alert(1)>`.
- ✅ F-SAST-07 SSRF (CWE-918): no outbound request was added on the API or the web side beyond the existing same-origin API client call (`apps/web/src/lib/api-client.ts`).
- ✅ F-SAST-08 Broken cryptography (CWE-327): no cryptography added or changed.
- ✅ F-SAST-09 Debug mode in production (CWE-489): no debug flag or verbose error path was added.
- ✅ F-SAST-10 Logging sensitive data (CWE-532): the only log line carries the request id, user id, action and the three counts (`apps/api/src/investments/infrastructure/http/holding-routes.ts:122`); a route test asserts that no ticker, name, quantity, cost or price appears in the log lines; no `console.*` in the changed source.
- ✅ F-SAST-11 Unrestricted upload (CWE-434): there is no upload; the file never leaves the browser, is limited to 1 MB and 10 MB declared uncompressed before decompression (`apps/web/src/features/investments/balanz-import/zip-limits.ts:3`, `:48`), and the API accepts a JSON body with at most 1,000 holdings under a 384 kb limit that applies to the exact import path only (`apps/api/src/app.ts:25`, `:26`).
- ✅ F-SAST-12 Missing CSRF protection (CWE-352): the new `POST` sits behind the module's session and verified-email guards, the app's origin guard and the `X-Requested-With` header like every investments mutation; route tests cover 401 and 403.
- ✅ F-SAST-13 Critical or High CVE in a dependency (CWE-1395): `pnpm audit --prod --audit-level high` reports no known vulnerabilities, and `package.json` and `pnpm-lock.yaml` are unchanged.
- ✅ F-SAST-14 Incomplete input validation (CWE-20): params, body and response are validated with the shared Zod schemas (`apps/api/src/investments/infrastructure/http/holding-routes.ts:96`), amounts are bounded integer strings, `pricedOn` a real calendar day, `crypto` is refused and the item count is capped; the browser parser rejects the whole file on any bad row.
- ✅ F-SAST-15 Insecure error handling (CWE-209): failures are `VALIDATION_FAILED` with the field name `body.holdings` only (`apps/api/src/investments/application/import-holdings.ts:117`) and parse errors carry a reason code, column names or a row number, never a cell value.
- ✅ F-SAST-16 Medium CVE in a dependency (CWE-1395): the same audit lists no moderate finding for the production dependencies, and nothing new was added.
- ✅ F-SAST-17 Unsafe function (CWE-676): no `eval`, `new Function`, `document.write` or dynamic code in the diff.

## Suppressions
(none)

## Notes
- The browser-side zip limit reads the declared sizes of the directory; a header that lies about them is not caught, and the effect is limited to the user's own tab (threat model R-01).
- Reviewed by the model that wrote the code; the triage of any finding by `ddw-sec-auditor` was not needed because none was reported.

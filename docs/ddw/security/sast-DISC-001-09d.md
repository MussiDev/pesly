# SAST report DISC-001-09d: Reports Screens

| Field | Value |
|---|---|
| Ticket | DISC-001-09d |
| Tier | FEATURE |
| Date | 2026-10-12 |
| Scope | The web files changed by the branch (`git diff --name-only origin/main...HEAD`, docs excluded): `apps/web/src/features/reports/**`, `apps/web/src/app/[locale]/(app)/reports/**`, `apps/web/src/lib/return-path.ts`, `read-return-path.ts` and the sign-in and second-factor containers, `features/shell/containers/authenticated-shell-container.tsx` and `nav-items.ts`, the dashboard `categories-card.tsx` and `net-worth-card.tsx`, the report calls of `apps/web/src/lib/api-client.ts`, `apps/web/messages/{en,es}.json` and `apps/web/e2e/{reports*.spec.ts,support/reports.ts}` (read only for secrets). No API code is in scope. Tests are read only for what they assert. No dependency, service worker or CSP file changed. |
| Method | Manual review by one reader (no semgrep or other SAST scanner is installed in this environment) against catalog §4: targeted searches over the scope (`dangerouslySetInnerHTML`, `innerHTML`, `document.*`, `eval`, `new Function`, `console`, `localStorage`, `sessionStorage`, IndexedDB, `window.open`, `window.location`, `href=`, every `router.push` and `router.replace`, `parseFloat`, `toFixed`, `Number(`, `Object.assign`, `process.env`, `eslint-disable`, `@ts-ignore`, `any`, secret patterns), a full read of `return-path.ts`, `read-return-path.ts`, `report-filters-state.ts`, `use-report-filters.ts`, `use-report.ts`, `load-account-options.ts`, the diff of `api-client.ts` and of the auth containers; the allow-list of `safeReturnPath` was executed in a Node script against 26 hostile and edge values; the threat model (`threat-DISC-001-09d.md`) as checklist |
| Result | PASSED - 0 Critical, 0 High, 0 Medium, 0 Low open; 4 Info documented below |

## Findings by rule

- ✅ F-SAST-01 Hardcoded secrets (CWE-798): the secret-pattern search finds no key, password, token or connection string in the reports code, the auth changes or `e2e/support/reports.ts`; the client holds no credential and the session is an HttpOnly cookie.
- ✅ F-SAST-02 SQL injection (CWE-89): not applicable; browser code that builds no SQL. The three report calls only build a query string (see cross-cutting checks).
- ✅ F-SAST-03 OS command injection (CWE-78): no `child_process`, `exec` or `spawn` in the scope.
- ✅ F-SAST-04 Insecure deserialization (CWE-502): `getNetWorthSeries`, `getExpensesByCategory` and `getIncomeExpenses` parse their answer with the shared `netWorthResponseSchema`, `expensesByCategoryResponseSchema` and `incomeExpensesResponseSchema` (`api-client.ts:1346-1366`); a mismatch is the generic failure and the adapter only converts already validated integer strings with `BigInt`. No `JSON.parse` is added. The two `Object.assign` calls (`report-filters-state.ts:42,67`) write a key taken from the constant `KEYS` tuple, never from the address or the server, so there is no prototype pollution.
- ✅ F-SAST-05 Path traversal (CWE-22): no file access; the three API paths are constants plus an encoded query; the only navigation targets are the four fixed report paths and static links.
- ✅ F-SAST-06 XSS (CWE-79): no `dangerouslySetInnerHTML`, `innerHTML` or `document.*` in the scope. Category names, tag and account names are React text children, option labels, SVG text nodes or `aria-label` attributes (`figures-list.tsx:18,43`, `category-ring.tsx`, `month-bars.tsx`, `net-worth-area-chart.tsx:175`), all escaped by React. The only inline style built from a number is `left: ${clampAnchor(x) / 10}%` (`net-worth-area-chart.tsx:206`), where `clampAnchor` is `Math.min(900, Math.max(100, x))`, so no server string reaches CSS.
- ✅ F-SAST-07 SSRF (CWE-918): browser code; the only outbound target is the configured API base URL through `request`.
- ✅ F-SAST-08 Broken cryptography (CWE-327): no cryptography added; no `Math.random`, MD5 or SHA-1 in the scope.
- ✅ F-SAST-09 Debug mode in production (CWE-489): no `console` call, debug flag or `NODE_ENV` branch in the scope.
- ✅ F-SAST-10 Logging sensitive data (CWE-532): no `console` call, analytics or error reporter in the scope; figures, tags and ids are never logged.
- ✅ F-SAST-11 Unrestricted upload (CWE-434): no upload surface.
- ✅ F-SAST-12 Missing CSRF protection (CWE-352): the three new calls are GETs through the existing `request`; no state-changing call is added.
- ✅ F-SAST-13 Critical/High CVE in a dependency: no `package.json` or `pnpm-lock.yaml` change in the branch; `reports-scans.test.ts` pins the dependency lists; the audit is re-run by the release gate.
- ✅ F-SAST-14 Incomplete input validation (CWE-20): every address value (`from`, `to`, `accountId`, `tag`) goes through the shared `reportFlowQuerySchema` or `netWorthQuerySchema` field before use, a repeated key is ignored (`values.length !== 1`), the request is only sent when the range check passes (`use-report.ts` `rangeOk`), and `next` goes through the exact allow-list (cross-cutting checks).
- ✅ F-SAST-15 Insecure error handling (CWE-209): `use-report.ts` maps `UNAUTHENTICATED`, `NOT_FOUND`, `NETWORK` and the rest to catalog states (`loading` plus redirect, `filterGone`, `offline`, `failed`); server text, ids and filters are never rendered.
- ✅ F-SAST-16 Medium CVE in a dependency: none (no dependency changed).
- ✅ F-SAST-17 Unsafe function (CWE-95): no `eval`, `new Function` or string timers in the scope.
- ✅ F-SAST-18 Suppressions complete: the scope has no `eslint-disable`, `@ts-ignore` or `@ts-expect-error`, and no `any`.
- ✅ F-SAST-19 Suppressions within review window: no suppressions in this report.

## Cross-cutting checks

- Open redirect through `next`: `safeReturnPath` is `RETURN_PATHS.includes(value)` over four literals (`/reports`, `/reports/categories`, `/reports/income-expenses`, `/reports/net-worth`): strict string equality, no prefix, regex or URL parsing. Executed in Node, every one of these returns `undefined`: `//evil.com`, `/\evil.com`, `/\/evil.com`, `%2f%2fevil.com`, `/%2f/evil.com`, `https://evil.com`, `javascript:alert(1)`, `/Reports` (case), `/reports/` (trailing slash), `/reports?x=1`, `/reports#a`, `/reports/../x`, `/reports/%2e%2e/x`, `/reports%00`, a trailing newline, a leading space, the empty string, `/es/reports` and `/reports;x`. Through the real read path (`URL.searchParams.get`) the double-encoded `%252Freports` and `%2F%2Fevil.com` also fail, and a repeated `next` takes the first value, which is itself checked. The four exact paths are accepted, and only the returned literal (never the input) reaches `router.replace`. The i18n `router.replace` takes a locale-relative path, so even an accepted value cannot leave the origin. `signInHref` encodes the already allowed path with `encodeURIComponent`, and its inputs (`pathRef.current`, `pathname ?? ''` from the locale-less i18n `usePathname`) pass through the same allow-list, so a pathname that is not a report route sends the visitor to plain `/sign-in`. The unverified-email destination still wins over a return path (`sign-in-container.tsx:77`, `second-factor-container.tsx:53`).
- URL query parameter injection into API calls: `reportQueryString` (`api-client.ts:546-556`) writes only the keys of the fixed list given by each call, with `URLSearchParams.set`, which percent-encodes `&`, `=`, `#`, `%0d%0a` and non-ASCII, so a tag such as `a&accountId=x` cannot add a key. The values reaching it were already parsed by the shared query schemas (UUID account, 1 to 30 code point tag without control or format characters, ISO dates) or come from the date controls checked by the range rules. The page address is rewritten with `serializeReportFilters(...).toString()`, also `URLSearchParams`. Net worth reads no `accountId` or `tag` (its schema has no such key).
- Storage and cache of figures: no `localStorage`, `sessionStorage`, IndexedDB or Cache Storage use in `features/reports`; the only `window.location` read is `readReturnPath`. Figures live in React state of `use-report.ts`, replaced on key change and dropped on offline, failure and 401. The dashboard session `Map` is not used by the reports. `app/sw.ts` is unchanged and has `runtimeCaching: []`, so the three report GETs (credentialed API calls) are not cached by the service worker.
- Sensitive data in the address: the address carries only dates, an account UUID and a tag; no amount, balance or token. The sign-in address carries only one of four fixed paths.
- Money: no `parseFloat` or `toFixed` on amounts; amounts stay `bigint`. `Number(` appears only on a bounded permille (`month-bars.tsx:30`, value up to 1000) and on an index modulo (`category-ring.tsx:42`), never on an amount (I-3).
- Stale responses: `use-report.ts` uses an `active` flag in the effect cleanup, so an answer to a replaced request cannot overwrite a newer one.
- Supply chain: no manifest, lockfile, remote script, font or image added in the scope.

## Threat model checklist (threat-DISC-001-09d)

- Open redirect through `next`: exact four-path allow-list, executed against hostile values. Mitigated.
- Injected query keys or text through address filters: shared schemas, single-value rule and `URLSearchParams`. Mitigated.
- Script injection through category, tag or account names, in HTML or SVG: React text nodes and attributes only; scan test in `reports-scans.test.ts`. Mitigated.
- Another user's account id in the address: only a UUID to the client; the API answers 404 and the screen shows the filter-gone state. Mitigated (the API is authoritative).
- Figures persisted on the device or cached by the service worker: none (cross-cutting checks). Mitigated.
- A slow older answer showing figures of another filter: `active` flag. Mitigated.
- An error leaks server details: catalog states only (F-SAST-15). Mitigated.
- Floating point on money: none. Mitigated.

## Low and informational findings (W-SAST-01)

| ID | Severity | Location | Finding | Disposition |
|---|---|---|---|---|
| I-1 | Info (CWE-601) | `apps/web/src/lib/return-path.ts:13-16` | `safeReturnPath` is a strict equality allow-list; it is the single gate for `next` | Not exploitable: verified against 26 hostile and edge values, including encoded, backslash, case, trailing-slash, dot-segment and double-encoded variants; no value outside the four literals is returned |
| I-2 | Info (CWE-601) | `apps/web/src/features/auth/containers/sign-in-container.tsx` (Google start) | The Google sign-in path does not carry `next`, so a visitor who signs in with Google lands on `/` and not on the report | Functional only, no security impact: dropping `next` is the safe direction. Carrying it through OAuth would need a server-side allow-list and is out of this ticket |
| I-3 | Info (CWE-682) | `apps/web/src/features/reports/income-expenses/month-bars.tsx:30`, `category-ring.tsx:42` | `Number(...)` on a bigint result | Display only: the operand is a permille in 0..1000 or a slot index, computed with `bigint` division first; no amount is converted |
| I-4 | Info (CWE-79) | `apps/web/src/features/reports/net-worth/net-worth-area-chart.tsx:206` | A computed value is interpolated in an inline `style` | Not exploitable: the number is clamped by `clampAnchor` to 100..900 before it becomes a percentage; no server string reaches the style |

## Summary

Total: 19 categories clean, 0 vulnerabilities open (0 critical, 0 high, 0 medium, 0 low); 4 Info documented, none blocking.

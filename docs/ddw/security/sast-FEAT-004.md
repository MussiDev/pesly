# SAST report FEAT-004: Pesly design system and UX/UI overhaul

| Field | Value |
|---|---|
| Ticket | FEAT-004 |
| Tier | FEATURE |
| Date | 2026-10-03 |
| Scope | `git diff --ignore-cr-at-eol f889df9..HEAD`: 129 files, every one under `apps/web` (`src/app`, `src/components`, `src/features`, `src/lib`, `messages`, `test`, `e2e`); no file under `apps/api`, `packages/shared` or any `package.json` or lockfile changed |
| Method | Manual review plus pattern scans over `apps/web/src` (`dangerouslySetInnerHTML`, `innerHTML`, `eval`, `new Function`, `document.write`, `Math.random`, `localStorage`, `sessionStorage`, `indexedDB`, `document.cookie`, `child_process`, hardcoded secret patterns), `pnpm audit --prod --audit-level high` and `pnpm audit` |
| Result | PASSED — 0 Critical, 0 High, 0 Medium open; 1 Low and 4 Info documented below |

## Findings by rule

- ✅ F-SAST-01 Hardcoded secrets (CWE-798): a scan for key, secret, password, token and private-key assignments over `apps/web/src` found none; the four hex fills in `apps/web/src/features/auth/components/google-sign-in-button.tsx:14` are the Google brand logo colours, not secrets; `.env*` is ignored (`.gitignore:12`).
- ✅ F-SAST-02 SQL injection (CWE-89): not applicable, the diff has no database or SQL code.
- ✅ F-SAST-03 OS command injection (CWE-78): no `child_process`, `exec` or `spawn` in the diff.
- ✅ F-SAST-04 Insecure deserialization (CWE-502): no new `JSON.parse` of untrusted data; API responses are parsed by the existing Zod schemas in `apps/web/src/lib/api-client.ts`, and the home reads them only through that client (`apps/web/src/features/home/containers/home-container.tsx:66`).
- ✅ F-SAST-05 Path traversal (CWE-22): no filesystem access in `apps/web/src`; the scan test reads source files only inside the test suite (`apps/web/test/design-system-scan.test.ts`).
- ✅ F-SAST-06 XSS (CWE-79): the only `dangerouslySetInnerHTML` is the theme pre-paint script (`apps/web/src/app/[locale]/layout.tsx:50`), whose content is the constant `THEME_SCRIPT` (`apps/web/src/lib/theme.ts:21`) with no interpolation of request or stored data, and which carries the per-request CSP nonce (`layout.tsx:48`); every other value, including account names, movement notes, amounts and error text, is rendered as a React text node.
- ✅ F-SAST-07 SSRF (CWE-918): no new outbound requests; the home calls the injected API client, whose origin is the fixed `API_ORIGIN` (`apps/web/src/features/home/containers/home-container.tsx:66`), and `next/font/google` downloads the typeface at build time only.
- ✅ F-SAST-08 Broken cryptography (CWE-327): no cryptography added; the nonce is the existing one generated in `apps/web/src/proxy.ts:14` and only read by the layout.
- ✅ F-SAST-09 Debug mode in production (CWE-489): `/design-system` answers 404 in production (`apps/web/src/app/[locale]/design-system/page.tsx:7`) and a test asserts it; no debug flag was added.
- ✅ F-SAST-10 Logging sensitive data (CWE-532): no `console.*` call in `apps/web/src`; the e2e specs log nothing about users.
- ✅ F-SAST-11 Unrestricted upload (CWE-434): not applicable, no upload surface.
- ✅ F-SAST-12 Missing CSRF protection (CWE-352): no new endpoint and no new mutating call; every existing mutation keeps the API's Origin and `X-Requested-With` guard, and the sign-out request is unchanged (`apps/web/src/features/shell/use-sign-out.ts`).
- ✅ F-SAST-13 Critical/High CVE in a dependency: `pnpm audit --prod --audit-level high` — "No known vulnerabilities found"; no dependency was added or changed.
- ✅ F-SAST-14 Incomplete input validation (CWE-20): the one new stored input, the theme value, goes through the allowlist `parseTheme` (`apps/web/src/lib/theme.ts:7`) and the inline script applies only `dark` or `light`; API amounts are parsed with `exactIntegerStringSchema.safeParse` and a malformed value renders a placeholder instead of throwing (`apps/web/src/features/accounts/components/accounts-headline.tsx`); forms keep their shared Zod validation.
- ✅ F-SAST-15 Insecure error handling (CWE-209): error states show catalog text chosen by error code (`apps/web/src/components/ui/error-state.tsx`), never text supplied by the API, and the home shows no balance when its data requests fail (`apps/web/src/features/home/containers/home-container.tsx:89`).
- ✅ F-SAST-16 Medium CVE in a dependency: `pnpm audit` — "No known vulnerabilities found".
- ✅ F-SAST-17 Unsafe function (CWE-95): no `eval`, `new Function`, `innerHTML`, `document.write` or `Math.random` in `apps/web/src`.
- ✅ F-SAST-18 Suppressions complete: no suppressions in this report.
- ✅ F-SAST-19 Suppressions within review window: no suppressions in this report.

## Financial data and session review

The home keeps balances and movements in React state only; a scan found no `localStorage`, `sessionStorage` or `indexedDB` use outside the theme preference (`apps/web/src/components/theme-provider.tsx:23`, `:32`), and a test fails if the home writes to any of them. The shell mounts its children only after the existing session check succeeds, so a user without a session or with an unverified email is redirected before any screen requests data. The Server Component `apps/web/src/app/[locale]/(app)/page.tsx` touches no financial data.

## Low and informational findings (W-SAST-01)

| ID | Severity | Location | Finding | Disposition |
|---|---|---|---|---|
| L-1 | Low (CWE-200) | `apps/web/src/app/[locale]/design-system/page.tsx:7` | The reference page is gated only by `NODE_ENV`; a production deployment with a wrong `NODE_ENV` would expose a page that lists tokens and components, no user data | Accepted: low impact; covered by threat R-03 and a unit test of the production gate |
| I-1 | Info | `apps/web/src/lib/theme.ts:21` | The theme preference sits in `localStorage` where any script on the origin can change it | Accepted: cosmetic, validated by `parseTheme`, threat R-02 |
| I-2 | Info | `apps/web/src/app/[locale]/layout.tsx:50` | On a client re-render (language switch) React 19 warns "script tag while rendering React component" for the theme script; the script already ran during server rendering | Accepted: dev-only warning, no security effect |
| I-3 | Info | `apps/web/src/features/home/containers/home-container.tsx:66` | The home sends six API requests in one batch per load and per retry | Accepted: fixed limits, no polling, retry disabled while in flight; threat R-08 amended to match |
| I-4 | Info | `apps/web/test/design-system-scan.test.ts:11` | The colour-literal scan allowlists the four Google logo colours in one file | Accepted: allowlist by file and by exact colour, with tests that fail for any other colour or file; threat R-06 |

## Summary

Total: 17 categories clean, 0 vulnerabilities open (0 critical, 0 high, 0 medium); 1 Low and 4 Info
documented.

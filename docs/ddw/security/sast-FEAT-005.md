# SAST report FEAT-005: Professional UX/UI redesign with merchant and asset logos

| Field | Value |
|---|---|
| Ticket | FEAT-005 |
| Tier | FEATURE |
| Date | 2026-10-05 |
| Scope | `git diff origin/main` over `apps` and `packages`: every changed source file is under `apps/web` (`src/app`, `src/components`, `src/features`, `src/lib`, `messages`, `public/logos`, `next.config.ts`, `test`, `e2e`); no file under `apps/api` or `packages/shared`, and no `package.json` or lockfile, changed |
| Method | Manual review of the changed source plus pattern scans over the diff (`dangerouslySetInnerHTML`, `innerHTML`, `eval`, `new Function`, `document.write`, `child_process`, `exec`, `spawn`, `console.log`, `localStorage`, `sessionStorage`, `fetch(`, `new RegExp`, `readFile`, `Math.random`, hardcoded secret patterns), a content scan of the 62 logo files, and `pnpm audit --prod --audit-level high` |
| Result | PASSED — 0 Critical, 0 High, 0 Medium open; 0 Low and 3 Info documented below |

## Findings by rule

- ✅ F-SAST-01 Hardcoded secrets (CWE-798): the scan for key, secret, password and token assignments over the diff found none; the colour values inside the logo files are public brand colours, not secrets; `.env*` is ignored (`.gitignore:12`).
- ✅ F-SAST-02 SQL injection (CWE-89): not applicable, the diff has no database or SQL code and `apps/api` is untouched.
- ✅ F-SAST-03 OS command injection (CWE-78): no `child_process`, `exec` or `spawn` in the diff.
- ✅ F-SAST-04 Insecure deserialization (CWE-502): no `JSON.parse` of untrusted data was added; holding values are read with `exactIntegerStringSchema.safeParse` (`apps/web/src/features/investments/composition.ts:32`).
- ✅ F-SAST-05 Path traversal (CWE-22): the only file paths are logo paths built from catalog constants (`apps/web/src/lib/logos/merchant-catalog.ts:12`); no note or ticker reaches a path, and a test asserts every path starts with `/logos/` and contains no `..` or scheme (`apps/web/test/logos-catalog.test.ts`).
- ✅ F-SAST-06 XSS (CWE-79): no `dangerouslySetInnerHTML` or `innerHTML` was added; the avatar sets `src` on an `<img>` with empty alt (`apps/web/src/components/ui/avatar.tsx:35`), so a logo can never run script; a logo opened directly as a document is sandboxed by the policy header on `/logos/:path*` (`apps/web/next.config.ts:18`, `:33`), and the integrity test rejects script, event attributes, `foreignObject`, `href` and external URLs in every file (`apps/web/test/logos-catalog.test.ts`); movement notes and instrument names stay React text nodes.
- ✅ F-SAST-07 SSRF (CWE-918): no outbound request was added; logos are static same-origin files, and the new-movement Server Component reads only the `type` query value (`apps/web/src/app/[locale]/(app)/movements/new/page.tsx:13`).
- ✅ F-SAST-08 Broken cryptography (CWE-327): no cryptography added or changed.
- ✅ F-SAST-09 Debug mode in production (CWE-489): no debug flag was added and `/design-system` keeps its production 404, asserted by `apps/web/test/design-system-page.test.tsx`.
- ✅ F-SAST-10 Logging sensitive data (CWE-532): no `console.*` call in the changed source.
- ✅ F-SAST-11 Unrestricted upload (CWE-434): not applicable, no upload surface; the logo files are committed assets.
- ✅ F-SAST-12 Missing CSRF protection (CWE-352): no endpoint and no mutating call was added; the circular quick actions are plain links and every existing mutation, including sign out now rendered in the top navigation (`apps/web/src/features/shell/components/top-nav.tsx:28`), keeps its existing handler.
- ✅ F-SAST-13 Critical/High CVE in a dependency: `pnpm audit --prod --audit-level high` — "No known vulnerabilities found"; no dependency was added or changed.
- ✅ F-SAST-14 Incomplete input validation (CWE-20): the one new untrusted input, the `type` query value, passes the allowlist `parseInitialType` (`apps/web/src/features/movements/initial-type.ts:8`) and anything else, including a repeated parameter, opens on an expense; the movement note is only tokenized and compared (`apps/web/src/lib/logos/normalize.ts:5`, `apps/web/src/lib/logos/resolve-merchant.ts:48`), never turned into a pattern, path or markup, and no `new RegExp` was added.
- ✅ F-SAST-15 Insecure error handling (CWE-209): no new error text is shown; a logo that fails to load falls back silently to initials or an icon (`apps/web/src/components/ui/avatar.tsx:42`).
- ✅ F-SAST-16 Medium CVE in a dependency: `pnpm audit` over production dependencies reports no known vulnerabilities.
- ✅ F-SAST-17 Unsafe function (CWE-95): no `eval`, `new Function`, `innerHTML` or `document.write` in the changed source.
- ✅ F-SAST-18 Suppressions complete: no suppressions in this report.
- ✅ F-SAST-19 Suppressions within review window: no suppressions in this report.

## Content security review

The content security policy keeps `img-src 'self' blob: data:` (`apps/web/src/lib/content-security-policy.ts:18`) and a test asserts it has no third-party host, so a logo can only come from the app's own origin and no merchant or ticker is disclosed to a third party. The proxy matcher skips every path that contains a dot, which is why `/logos/:path*` carries its own sandboxing policy; a header test fails if that rule is missing or weakened (`apps/web/test/logos-headers.test.ts`). The font is downloaded by `next/font` at build time and served from the app's origin.

## Low and informational findings (W-SAST-01)

| ID | Severity | Location | Finding | Disposition |
|---|---|---|---|---|
| I-1 | Info | `apps/web/public/logos/NOTICE.md` | The logo files are CC0 files of company marks; the marks themselves stay the property of their owners, so redistribution of a mark is a trademark question the license does not settle | Accepted: nominative use to identify the merchant or instrument, recorded per file, and any entry can be removed without a code change; threat R-06 |
| I-2 | Info | `apps/web/src/lib/logos/resolve-merchant.ts:35` | A note can name a brand and so show its logo next to a movement | Accepted: only the owner's own notes feed the matching, the note stays visible in the row and the image has empty alt text; threat R-03 |
| I-3 | Info | `apps/web/public/logos/*.svg` | The 62 files are served as static assets with no integrity hash | Accepted: they are committed and reviewed with the code, scanned by the integrity test on every run, and sandboxed when opened as a document; threat R-01 and R-06 |

## Summary

Total: 17 categories clean, 0 vulnerabilities open (0 critical, 0 high, 0 medium); 0 Low and 3 Info
documented.

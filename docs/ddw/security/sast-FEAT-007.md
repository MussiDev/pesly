# SAST FEAT-007: Group detail — suggested payments and recent expenses

| Field | Value |
|---|---|
| Ticket | FEAT-007 |
| Date | 2026-10-12 |
| Scope | 6 modified and 9 new files under `apps/web` (components, hooks, container, catalogs, tests, one e2e spec); no file of `apps/api`, `packages/shared`, migrations or lockfiles changed |

## Categories

- F-SAST-01 ✅ hardcoded secrets: none. Pattern scan for key, secret, password and token assignments over the new files found nothing; `.env` is in `.gitignore`.
- F-SAST-02 ✅ SQL/NoSQL injection: the change has no database access; it only calls the existing API client methods.
- F-SAST-03 ✅ OS command injection: no exec, spawn or shell call in the changed files.
- F-SAST-04 ✅ insecure deserialization: no deserialization; responses are parsed by the shared client's Zod schemas before use.
- F-SAST-05 ✅ path traversal: no file system access; the group id in the URL is validated by `isGroupId` where used and encoded with `encodeURIComponent` in every link (`group-recent-expenses.tsx:19`).
- F-SAST-06 ✅ XSS: no `dangerouslySetInnerHTML`, `innerHTML` or `document.write` in the changed files; expense descriptions render as React text children (`expense-row.tsx` through `group-recent-expenses.tsx:46`), and a test renders `<img onerror>` as literal text (threat R-01).
- F-SAST-07 ✅ SSRF: no server-side request is built from user input; the web app only calls its own API origin through the shared client.
- F-SAST-08 ✅ broken cryptography: none used.
- F-SAST-09 ✅ debug mode in production: no debug flag, console output or dev-only branch added.
- F-SAST-10 ✅ logging sensitive data: no logging added; amounts and names are rendered, never written to a log or a notification.
- F-SAST-11 ✅ unrestricted upload: no upload surface.
- F-SAST-12 ✅ missing CSRF protection: no new write endpoint; recording a payment reuses the existing settlement endpoint and its protections.
- F-SAST-13 ✅ Critical/High CVE in a dependency: `pnpm audit --prod --audit-level high` reports "No known vulnerabilities found"; no dependency was added.
- F-SAST-14 ✅ incomplete input validation: no new input; the settlement form keeps its own validation and the server revalidates (`group-detail-container.tsx:275`, threat R-02).
- F-SAST-15 ✅ insecure error handling: failures show a translated generic message through the catalog key `groups.detail.sectionFailed`; no stack trace or server text is shown (`group-section-state.tsx:34`).
- F-SAST-16 ✅ Medium CVE in a dependency: the same audit reports none.
- F-SAST-17 ✅ unsafe function: no `eval`, `new Function` or dynamic code in the changed files.

## Findings
(none)

## Suppressions
(none)

Result: PASSED

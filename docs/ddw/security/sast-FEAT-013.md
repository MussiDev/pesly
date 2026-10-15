# SAST FEAT-013: Installment schedule preview and closing-day clarity

| Field | Value |
|---|---|
| Ticket | FEAT-013 |
| Date | 2026-10-15 |
| Scope | the shared statement assignment and schedule modules under `packages/shared/src/credit-cards`, the two API domain files that now re-export them under `apps/api/src/credit-cards/domain`, and the card purchase form, container, draft parser and preview component under `apps/web/src/features/credit-cards` with both catalogs; no route, migration, dependency or lockfile changed |

## Categories

- F-SAST-01 ✅ hardcoded secrets: none; a pattern scan for key, secret, password and token assignments over the 9 changed source files found nothing, and `.env` is in `.gitignore`.
- F-SAST-02 ✅ SQL/NoSQL injection: no query is built or changed; the shared module is pure arithmetic over dates and bigint amounts (`packages/shared/src/credit-cards/installment-schedule.ts:55`) and the API domain files only re-export it.
- F-SAST-03 ✅ OS command injection: no exec, spawn or shell call in the changed source.
- F-SAST-04 ✅ insecure deserialization: the new read reuses `api.listStatements` at `apps/web/src/features/credit-cards/containers/installment-purchase-container.tsx:88`, which parses the response with the shared Zod schema; nothing is deserialized from user input.
- F-SAST-05 ✅ path traversal: no file system access in the changed source.
- F-SAST-06 ✅ XSS: the preview renders catalog strings, formatted amounts and formatted dates as React text in `apps/web/src/features/credit-cards/components/installment-schedule-preview.tsx:88`; no `dangerouslySetInnerHTML`, `innerHTML` or `document.write` was added, and a test asserts every cell is plain text.
- F-SAST-07 ✅ SSRF: no server-side request is built from any value; the web app calls the existing API client only.
- F-SAST-08 ✅ broken cryptography: none added or touched.
- F-SAST-09 ✅ debug mode in production: no debug flag or console output added; a scan of the changed source found no `console.` call.
- F-SAST-10 ✅ logging sensitive data: nothing is logged by the new code; amounts stay in component state and are not written to the URL or storage.
- F-SAST-11 ✅ unrestricted upload: no upload surface.
- F-SAST-12 ✅ missing CSRF protection: the change adds no write; the save path and its routes are unchanged.
- F-SAST-13 ✅ Critical/High CVE in a dependency: `pnpm audit --prod --audit-level high` reports "No known vulnerabilities found"; no dependency was added.
- F-SAST-14 ✅ incomplete input validation: the draft is validated by `parseInstallmentDraft` at `apps/web/src/features/credit-cards/installment-request.ts:91` (amount, a three-digit integer count from 1 to 60 at `:106`, a calendar date not in the future) before the schedule function is called at `apps/web/src/features/credit-cards/containers/installment-purchase-container.tsx:184`, and the server still validates the same body with the shared Zod schema on save.
- F-SAST-15 ✅ insecure error handling: a failed statements read takes the existing load-error state with catalog messages and no raw server text; the schedule function throws `RangeError` only for impossible inputs the parser has already rejected (`packages/shared/src/credit-cards/installment-schedule.ts:116`).
- F-SAST-16 ✅ Medium CVE in a dependency: the same audit reports none.
- F-SAST-17 ✅ unsafe function: no `eval`, `new Function` or dynamic code in the changed source.

## Findings
(none)

## Suppressions
(none)

Result: PASSED

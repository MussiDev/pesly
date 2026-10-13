# SAST FEAT-011: Budgets by statement month, and available money on the home screen

| Field | Value |
|---|---|
| Ticket | FEAT-011 |
| Date | 2026-10-13 |
| Scope | 29 source files and their tests under `apps/api`, `apps/web` and `packages/shared`, plus the two catalogs; no migration, lockfile or dependency changed |

## Categories

- F-SAST-01 ✅ hardcoded secrets: none. A pattern scan for key, secret, password and token assignments over the 29 changed source files found nothing, and `.env*` is in `.gitignore` (line 12).
- F-SAST-02 ✅ SQL/NoSQL injection: the one new raw query, `apps/api/src/budgets/infrastructure/db/drizzle-spending-reader.ts:122`, is a `sql` template where every value (the zone, the category ids, the instants) is a bound parameter and every table or column is a Drizzle object; there is no string concatenation, and the two `sql.raw` calls (lines 306 and 359) are the fixed ordinals of an existing `groupBy`, with no input in them.
- F-SAST-03 ✅ OS command injection: no exec, spawn or shell call in the changed source.
- F-SAST-04 ✅ insecure deserialization: none; rows are read from PostgreSQL and `BigInt` is applied to text sums, never to user input.
- F-SAST-05 ✅ path traversal: no file system access in the changed source.
- F-SAST-06 ✅ XSS: the web screens render fixed catalog strings and numbers through next-intl and the locale formatters (`apps/web/src/features/dashboard/components/net-worth-card.tsx`, `apps/web/src/features/budgets/list/unconverted-notice.tsx`); no `dangerouslySetInnerHTML`, `innerHTML` or `document.write` was added.
- F-SAST-07 ✅ SSRF: no server-side request is built from any value; the change reads only PostgreSQL and the stored rate.
- F-SAST-08 ✅ broken cryptography: none used.
- F-SAST-09 ✅ debug mode in production: no debug flag, console output or dev-only branch added.
- F-SAST-10 ✅ logging sensitive data: no logging added; the reads return aggregates and the available section returns two sums and a total, with no account names.
- F-SAST-11 ✅ unrestricted upload: no upload surface.
- F-SAST-12 ✅ missing CSRF protection: no new write endpoint and no new route; `GET /budgets/spending`, `GET /budgets/:id/spending` and `GET /dashboard` stay read-only behind the existing session and verified email.
- F-SAST-13 ✅ Critical/High CVE in a dependency: `pnpm audit --prod --audit-level high` reports "No known vulnerabilities found"; no dependency was added.
- F-SAST-14 ✅ incomplete input validation: the change adds no input of its own; the `month` query reaches `computeSpending` already validated by the route schema and rejected when in the future, and the category ids come from the caller's own budgets (`apps/api/src/budgets/infrastructure/db/drizzle-spending-reader.ts:109`).
- F-SAST-15 ✅ insecure error handling: a row with no frozen rate makes the read throw and a failed accounts read rejects the dashboard; the existing error middleware answers without internals, and nothing is caught and swallowed (`apps/api/src/accounts/application/get-available-totals.ts:21`).
- F-SAST-16 ✅ Medium CVE in a dependency: the same audit reports none.
- F-SAST-17 ✅ unsafe function: no `eval`, `new Function` or dynamic code in the changed source.

## Findings
(none)

## Suppressions
(none)

Result: PASSED

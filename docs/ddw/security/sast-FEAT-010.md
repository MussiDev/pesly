# SAST FEAT-010: Count card purchases in the month their statement is due

| Field | Value |
|---|---|
| Ticket | FEAT-010 |
| Date | 2026-10-12 |
| Scope | 8 modified and 6 new source and test files under `apps/api` and `apps/web`, plus the two catalogs; no migration, lockfile or dependency changed |

## Categories

- F-SAST-01 ✅ hardcoded secrets: none. A pattern scan for key, secret, password and token assignments over the new and changed source found nothing, and `.env` is in `.gitignore`.
- F-SAST-02 ✅ SQL/NoSQL injection: the one raw query, `apps/api/src/reports/infrastructure/db/drizzle-flow-reader.ts:252`, is a `sql` template where every value (the zone, the period bounds, the tag) is a bound parameter and every table or column is a Drizzle object; there is no string concatenation and no `sql.raw` in the new method, and a test sends a tag with a quote and SQL text and gets no rows.
- F-SAST-03 ✅ OS command injection: no exec, spawn or shell call in the changed source.
- F-SAST-04 ✅ insecure deserialization: none; rows are read from PostgreSQL and `BigInt` is applied to text sums, never to user input.
- F-SAST-05 ✅ path traversal: no file system access in the changed source.
- F-SAST-06 ✅ XSS: the web note renders a fixed catalog string through next-intl (`apps/web/src/components/card-purchases-note.tsx:7`); no `dangerouslySetInnerHTML`, `innerHTML` or `document.write` was added.
- F-SAST-07 ✅ SSRF: no server-side request is built from any value; the change reads only PostgreSQL.
- F-SAST-08 ✅ broken cryptography: none used.
- F-SAST-09 ✅ debug mode in production: no debug flag, console output or dev-only branch added.
- F-SAST-10 ✅ logging sensitive data: no logging added; the read returns aggregates and logs nothing.
- F-SAST-11 ✅ unrestricted upload: no upload surface.
- F-SAST-12 ✅ missing CSRF protection: no new write endpoint and no new route; the two report endpoints and the dashboard stay read-only `GET`s behind the existing session.
- F-SAST-13 ✅ Critical/High CVE in a dependency: `pnpm audit --prod --audit-level high` reports "No known vulnerabilities found"; no dependency was added.
- F-SAST-14 ✅ incomplete input validation: the new method adds no input of its own; the period and filters reach it already validated by `prepareReport`, and the tag stays a bound parameter in `apps/api/src/reports/infrastructure/db/flow-conditions.ts:43`.
- F-SAST-15 ✅ insecure error handling: a corrupt row makes the read throw, and the existing error middleware answers without internals; the new web note has no error path.
- F-SAST-16 ✅ Medium CVE in a dependency: the same audit reports none.
- F-SAST-17 ✅ unsafe function: no `eval`, `new Function` or dynamic code in the changed source.

## Findings
(none)

## Suppressions
(none)

Result: PASSED

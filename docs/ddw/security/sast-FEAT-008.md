# SAST FEAT-008: Link a group expense to the payer's account

| Field | Value |
|---|---|
| Ticket | FEAT-008 |
| Date | 2026-10-13 |
| Scope | the new use cases, repository and recorder methods and two routes under `apps/api/src/groups`, the shared schemas, and the link feature, route and client calls under `apps/web`, plus the two catalogs and their tests; no migration, lockfile or dependency changed |

## Categories

- F-SAST-01 ✅ hardcoded secrets: none; a pattern scan for key, secret, password and token assignments over the new and changed source found nothing, and `.env` is in `.gitignore`.
- F-SAST-02 ✅ SQL/NoSQL injection: the new repository method goes through Drizzle objects and row locks (`apps/api/src/groups/infrastructure/db/drizzle-group-expense-repository.ts:299`), with no string concatenation and no `sql.raw`; the one raw statement it reaches, `:487`, is the existing `lockExpenseForChange` and binds the movement id as a parameter.
- F-SAST-03 ✅ OS command injection: no exec, spawn or shell call in the changed source.
- F-SAST-04 ✅ insecure deserialization: the body is parsed by the strict Zod union `linkPayerMovementRequestSchema` at `apps/api/src/groups/infrastructure/http/group-routes.ts:538`, and `BigInt` is applied only to database text values.
- F-SAST-05 ✅ path traversal: no file system access in the changed source.
- F-SAST-06 ✅ XSS: the web screen renders catalog strings and movement notes as React text through `apps/web/src/features/groups/expenses/link/link-expense-view.tsx`; no `dangerouslySetInnerHTML`, `innerHTML` or `document.write` was added.
- F-SAST-07 ✅ SSRF: no server-side request is built from any value; the change reads and writes only PostgreSQL.
- F-SAST-08 ✅ broken cryptography: none used.
- F-SAST-09 ✅ debug mode in production: no debug flag, console output or dev-only branch added.
- F-SAST-10 ✅ logging sensitive data: the only log is the audit entry at `apps/api/src/groups/infrastructure/http/group-routes.ts:548`, which carries the request id, the user, the group id and the expense id, and no amount, note or account name.
- F-SAST-11 ✅ unrestricted upload: no upload surface.
- F-SAST-12 ✅ missing CSRF protection: the new write is a `POST` behind the existing session and the existing cross-site protections of the API; the candidates route is a read-only `GET`.
- F-SAST-13 ✅ Critical/High CVE in a dependency: `pnpm audit --prod --audit-level high` reports "No known vulnerabilities found"; no dependency was added.
- F-SAST-14 ✅ incomplete input validation: params, body and response of both routes go through the shared validation middleware (`group-routes.ts:538` and `:559`); ownership of the movement is checked in `apps/api/src/groups/infrastructure/movements/drizzle-payer-movement-recorder.ts:80` and `:135`, the payer check is `apps/api/src/groups/application/link-payer-movement.ts:109`, and a foreign movement answers 404.
- F-SAST-15 ✅ insecure error handling: the typed domain errors (`GROUP_PAYER_ONLY`, `GROUP_EXPENSE_ALREADY_LINKED`, `GROUP_MOVEMENT_MISMATCH`) go through the one error middleware and carry no internals; the web container shows a catalog message and keeps no raw server text.
- F-SAST-16 ✅ Medium CVE in a dependency: the same audit reports none.
- F-SAST-17 ✅ unsafe function: no `eval`, `new Function` or dynamic code in the changed source.

## Findings
(none)

## Suppressions
(none)

Result: PASSED

# SAST FEAT-012: Balance adjustments instead of editing the opening balance

| Field | Value |
|---|---|
| Ticket | FEAT-012 |
| Date | 2026-10-14 |
| Scope | the set-balance use case, ports, route and balance adjuster under `apps/api/src/accounts` and `apps/api/src/movements`, the shared second-factor check under `apps/api/src/identity`, the adjustment-aware readers under `apps/api/src/reports` and `apps/api/src/dashboard`, migration 0040, the shared schemas, and the accounts and movements features under `apps/web` with both catalogs; the opening-balance edit was removed; no dependency or lockfile changed |

## Categories

- F-SAST-01 ✅ hardcoded secrets: none; a pattern scan for key, secret, password, token and connection-string assignments over the 54 changed source files found only comments and the existing environment-variable names in `apps/api/src/identity/index.ts:244`, and `.env` is in `.gitignore`.
- F-SAST-02 ✅ SQL/NoSQL injection: every raw statement uses the Drizzle `sql` template with bound parameters and explicit uuid casts, never string concatenation: the account lock at `apps/api/src/movements/infrastructure/accounts/drizzle-balance-adjuster.ts:33`, the balance sums at `apps/api/src/movements/infrastructure/accounts/drizzle-account-movements.ts:32` and `:45`, and the flow reader at `apps/api/src/reports/infrastructure/db/drizzle-account-flow-reader.ts:30`; no `sql.raw` was added, and the migration `apps/api/drizzle/0040_balance_adjustments.sql` is static DDL.
- F-SAST-03 ✅ OS command injection: no exec, spawn or shell call in the changed source.
- F-SAST-04 ✅ insecure deserialization: the body of the new route is parsed by the shared Zod schema `setAccountBalanceRequestSchema` at `apps/api/src/accounts/infrastructure/http/account-routes.ts:164`, and `BigInt` is applied only after parsing (`:176`) to an integer string within bounds.
- F-SAST-05 ✅ path traversal: no file system access in the changed source.
- F-SAST-06 ✅ XSS: the dialog and the movement row render catalog strings, amounts and notes as React text through `apps/web/src/features/accounts/components/set-balance-dialog.tsx` and `apps/web/src/features/movements/components/movement-row.tsx`; no `dangerouslySetInnerHTML`, `innerHTML` or `document.write` was added.
- F-SAST-07 ✅ SSRF: no server-side request is built from any value; the change reads and writes only PostgreSQL.
- F-SAST-08 ✅ broken cryptography: none added; the second-factor check reuses the existing TOTP engine, AES-GCM secret box and Argon2id recovery-code hashing at `apps/api/src/identity/application/require-second-factor.ts:50`.
- F-SAST-09 ✅ debug mode in production: no debug flag, console output or dev-only branch added (a scan of the changed source found no `console.` call).
- F-SAST-10 ✅ logging sensitive data: the only log of the new route is the audit entry at `apps/api/src/accounts/infrastructure/http/account-routes.ts:181`, with the request id, the user id and the account id, and no amount, balance, note or second-factor code.
- F-SAST-11 ✅ unrestricted upload: no upload surface.
- F-SAST-12 ✅ missing CSRF protection: the new write is a `POST` behind the existing session and the existing cross-site protections of the API; `GET /auth/2fa` is the unchanged read-only status call.
- F-SAST-13 ✅ Critical/High CVE in a dependency: `pnpm audit --prod --audit-level high` reports "No known vulnerabilities found"; no dependency was added.
- F-SAST-14 ✅ incomplete input validation: params and body of the new route go through the shared validation middleware (`account-routes.ts:164`); the account is locked by id and owner together, so a foreign account answers 404 (`drizzle-balance-adjuster.ts:33`); archived and credit-card accounts are refused (`:41`, `:42`); a difference outside the allowed range answers 400 instead of reaching the database check; the removed `PATCH /accounts/:id/opening-balance` route answers 404.
- F-SAST-15 ✅ insecure error handling: the typed errors (`TOTP_INVALID`, `RATE_LIMITED`, `ACCOUNT_ARCHIVED`, the validation error for a card account) go through the one error middleware and carry no internals; a missing, wrong or already used second-factor code answers the same `TOTP_INVALID`; the web container shows catalog messages and keeps no raw server text.
- F-SAST-16 ✅ Medium CVE in a dependency: the same audit reports none.
- F-SAST-17 ✅ unsafe function: no `eval`, `new Function` or dynamic code in the changed source.

## Findings
(none)

## Suppressions
(none)

Result: PASSED

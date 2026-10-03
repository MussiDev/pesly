# SAST report DISC-001-03c: Transfers and Currency Exchange

| Field | Value |
|---|---|
| Ticket | DISC-001-03c |
| Tier | FEATURE |
| Date | 2026-10-03 |
| Scope | `git diff f889df9..HEAD` over `apps/` and `packages/` without tests and e2e (32 source files): `packages/shared/src/movements/{movement,implied-rate}.ts`, `errors.ts`, `index.ts`; `apps/api/src/movements/**` (domain, create-movement use case, account lookup port and Drizzle lookup, Drizzle repository, schema, balances adapter, routes, presenter); `apps/api/src/shared/http/{error-handler,validate}.ts`; the accounts port doc comment; migration `0016_transfers_exchanges` with its rollback, snapshot and journal; `apps/web/src/features/movements/**` (form, saved view, list, row, containers, request builder, preview, error mapping, rate formatter), `apps/web/src/lib/api-client.ts`, catalogs; tests, fixtures and e2e scanned for secrets only |
| Method | Manual review of the diff by the orchestrator against catalog §4, targeted searches over the scope (secrets, raw SQL, dangerous functions, outbound calls, logging, HTML sinks, file access, cryptography), the threat model R-01 to R-09 as checklist, plus `pnpm audit --prod --audit-level high` on the final tree |
| Result | PASSED — 0 Critical, 0 High, 0 Medium open; 2 Info documented below |

## Findings by rule

- ✅ F-SAST-01 Hardcoded secrets (CWE-798): the secret-pattern search over the 32 source files returns nothing; the test database URLs appear only in test and e2e support with the existing local credentials; no `.env` change.
- ✅ F-SAST-02 SQL injection (CWE-89): every statement is a Drizzle builder or a `sql` template whose interpolations are columns or bound parameters (`apps/api/src/movements/infrastructure/accounts/drizzle-account-movements.ts:29,37,52` where ids go through `inArray` bound parameters in chunks of 500 and `eq`/`or`; `apps/api/src/movements/infrastructure/db/drizzle-movement-repository.ts:146` ordering by columns); the only `sql.raw` calls take compile-time constants for check constraints (`apps/api/src/movements/infrastructure/db/schema.ts:31,37,38,100`, never from input); migration 0016 and its rollback are static DDL (`apps/api/drizzle/rollback/0016_transfers_exchanges.down.sql:15` is a fixed `DO` block guarded by `to_regclass`).
- ✅ F-SAST-03 OS command injection (CWE-78): no `child_process`, `exec` or `spawn` in the scope.
- ✅ F-SAST-04 Insecure deserialization (CWE-502): request bodies are parsed by Express JSON and validated by the shared Zod discriminated union through the `validate` middleware (`apps/api/src/movements/infrastructure/http/movement-routes.ts:157`); no custom deserialization.
- ✅ F-SAST-05 Path traversal (CWE-22): no file access in `src`.
- ✅ F-SAST-06 XSS (CWE-79): the web code renders through React text nodes; no `dangerouslySetInnerHTML`, `innerHTML` or `document.write` in the scope; the note and account names are rendered as text only (`apps/web/src/features/movements/components/movement-row.tsx`).
- ✅ F-SAST-07 SSRF (CWE-918): no outbound request is added on the API; the web client only calls the configured API base with fixed paths (`apps/web/src/lib/api-client.ts`); no new URL is built from input.
- ✅ F-SAST-08 Broken cryptography (CWE-327): no cryptography added; no `Math.random` or hashing in the scope.
- ✅ F-SAST-09 Debug mode in production (CWE-489): no debug flag added.
- ✅ F-SAST-10 Logging sensitive data (CWE-532): the audit line carries request id, user id and movement id only (`apps/api/src/movements/infrastructure/http/movement-routes.ts`, unchanged shape); the new inconsistent-row error names the row id and type, never an amount (`apps/api/src/movements/infrastructure/db/drizzle-movement-repository.ts:53`); no `console` in the web code.
- ✅ F-SAST-11 Unrestricted upload (CWE-434): no upload surface.
- ✅ F-SAST-12 Missing CSRF protection (CWE-352): `POST /movements` sits behind `requireSession`, `requireVerifiedEmail` and the global origin guard (unchanged; tested by the existing route tests and the new transfer and exchange route tests); no CORS change.
- ✅ F-SAST-13 Critical/High CVE in a dependency: `pnpm audit --prod --audit-level high` on the final tree — "No known vulnerabilities found"; no `package.json` or lockfile change in this ticket.
- ✅ F-SAST-14 Incomplete input validation (CWE-20): params, query and body are validated by shared schemas through the one `validate` middleware (amounts 1 to 10^15 on both amount fields, note at most 500, account ids as UUIDs, type as one of four values, keys that do not belong to the type stripped, so a client cannot send a rate on an exchange or a category on a transfer: tested); the use case re-checks the date, the currency rules and the implied-rate range; the database repeats them with the shape, range and differs checks and the composite keys on both account columns (`apps/api/src/movements/infrastructure/db/schema.ts:105-115`); ownership of both accounts is checked in the same statement as the lookup (`apps/api/src/movements/infrastructure/db/drizzle-account-lookup.ts`).
- ✅ F-SAST-15 Insecure error handling (CWE-209): errors map to `{ code }` bodies through the one error middleware (`apps/api/src/shared/http/error-handler.ts`, four new codes at 400), a database failure answers 500 `{ code: 'INTERNAL' }`; foreign source and destination accounts answer 404 identical to missing ones (tested for both).
- ✅ F-SAST-16 Medium CVE in a dependency: none (`pnpm audit` clean).
- ✅ F-SAST-17 Unsafe function (CWE-95): no `eval`, `new Function` or `exec` in the scope; the new regular expressions are static literals without nested quantifiers.
- ✅ F-SAST-18 Suppressions complete: no suppressions in this report.
- ✅ F-SAST-19 Suppressions within review window: no suppressions in this report.

## Cross-cutting checks

- Authorization and data scope: the use case reads both accounts with the caller's scope (404 otherwise, in the order of the spec D4) and the repository scopes every read by owner in the same statement; the balance adapter stays unscoped by design, keyed by the ids it is given, and now reads the destination column the same way (threat R-03, R-07, tested with another user's rows and a destination-only account).
- Abuse and availability: the existing database-backed limit of 60 creations per minute per user covers the four types through `RecordManualMovement` (tested across types with an injected clock, threat R-05); list pages are capped at 100.
- Integrity: the shape check closes the null-passes-a-check hole with explicit `is not null` guards (found by the tests, fixed before commit); `destination_amount = amount` for transfers; composite foreign keys with `ON DELETE RESTRICT` on source and destination; the stored implied rate is derived on the server by one bigint helper and a client-sent rate is ignored (threat R-02).
- Money and time: amounts are `bigint`, rates scaled integers; a scan test forbids float constructs in the module, in `implied-rate.ts` and in the new web files; the date rule uses the user's time zone as in 03b.
- Migration: `0016_transfers_exchanges` is non-destructive (relaxes not-null columns, adds two columns, a key, an index and checks; every existing row satisfies the shape check); its rollback is documented destructive for transfers and exchanges only, idempotent, and deletes its journal row by `when` 1790991879498, greater than every other `when` seen (threat R-06, R-08); the number and `when` are re-checked at merge.
- Supply chain: no new dependency.

## Low and informational findings (W-SAST-01)

| ID | Severity | Location | Finding | Disposition |
|---|---|---|---|---|
| I-1 | Info (CWE-209) | `apps/api/src/movements/infrastructure/db/drizzle-movement-repository.ts:53` | A row with an inconsistent shape throws an error whose message contains the movement id and its type | Accepted: the error is only logged server side and the client receives 500 `{ code: 'INTERNAL' }`; it can only occur if the database check is bypassed |
| I-2 | Info (CWE-841) | `apps/web/src/features/movements/containers/create-movement-container.tsx` | The create request still has no idempotency key (human decision D1 of DISC-001-03b: a lost response followed by a retry can create a duplicate) | Accepted: unchanged known limitation, owned by the PRD 04 offline sync ticket |

## Summary

Total: 19 categories clean, 0 vulnerabilities open (0 critical, 0 high, 0 medium); 2 Info
documented, none blocking.
No known vulnerabilities found

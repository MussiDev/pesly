# SAST report DISC-001-10d: Statement Payments and Status

| Field | Value |
|---|---|
| Ticket | DISC-001-10d |
| Tier | FEATURE |
| Date | 2026-10-08 |
| Scope | `git diff 2f0434f..HEAD` over `apps/` and `packages/` without tests and e2e: `packages/shared/src/credit-cards/{statement-payment,credit-card}.ts`; `apps/api/src/credit-cards/**` (domain `statement-payment.ts`, use cases `record-statement-payment.ts` and `statement-views.ts`, ports, routes, presenter); `apps/api/src/movements/infrastructure/credit-cards/{drizzle-card-payments,drizzle-statement-payment-recorder}.ts` and `movements/index.ts`; `apps/api/src/server.ts`; `apps/web/src/features/credit-cards/**`, the `/cards/[id]/payments/new` page, `apps/web/src/lib/api-client.ts`, both catalogs; tests and e2e scanned for secrets only. No migration and no dependency change |
| Method | Review of the diff by the author with targeted searches over the changed files (secret patterns, `sql.raw` and interpolated SQL, `eval`/`exec`/`child_process`, `innerHTML`/`dangerouslySetInnerHTML`, `console`, file access, outbound calls, logger calls), the threat model R-01 to R-05 as checklist, ESLint with the module boundary rules, plus `pnpm audit --prod --audit-level high` on the final tree. No per-block subagent review was run (see the tests report, deviations) |
| Result | PASSED — 0 Critical, 0 High, 0 Medium open; 2 Info documented below |

## Findings by rule

- ✅ F-SAST-01 Hardcoded secrets (CWE-798): the secret-pattern search over the changed sources finds no literal secret; the e2e spec reuses the fixed test password of the existing flows against a throwaway database; `.env` is ignored by git.
- ✅ F-SAST-02 SQL injection (CWE-89): the new query is built with Drizzle's query builder and bound parameters (`apps/api/src/movements/infrastructure/credit-cards/drizzle-card-payments.ts:18`); the only raw fragment is `sum(amount)::text`, with no input; the owner filter `scopedTo` sits in the same statement as the destination filter (`drizzle-card-payments.ts:28`).
- ✅ F-SAST-03 OS command injection (CWE-78): no `child_process`, `exec` or `spawn` in the scope.
- ✅ F-SAST-04 Insecure deserialization (CWE-502): the new route validates params, body and response with the shared strict Zod schemas in the one `validate` middleware (`apps/api/src/credit-cards/infrastructure/http/credit-card-routes.ts:308`); the web client parses every answer with the shared schemas (`apps/web/src/lib/api-client.ts`).
- ✅ F-SAST-05 Path traversal (CWE-22): no file access in `src`; the web client builds the card path with `resourcePath`, which refuses `.`, `..` and empty ids, and the API validates ids as UUIDs.
- ✅ F-SAST-06 XSS (CWE-79): amounts, account names and notes render as React text nodes or option labels; no `dangerouslySetInnerHTML`, `innerHTML` or `document.write` in the scope; notes refuse control and format characters (`movementNoteSchema`).
- ✅ F-SAST-07 SSRF (CWE-918): the API makes no outbound request in this ticket; the web client calls only its configured API origin.
- ✅ F-SAST-08 Broken cryptography (CWE-327): no hashing, randomness or encryption in the scope.
- ✅ F-SAST-09 Debug mode in production (CWE-489): no debug flag and no `console` call added (search over the scope returns none).
- ✅ F-SAST-10 Logging sensitive data (CWE-532): the audit line of the new route carries request id, user id, card id and movement id only (`credit-card-routes.ts:325`); a route test asserts that neither the amount nor the note reaches the captured log (threat R-01).
- ✅ F-SAST-11 Unrestricted upload (CWE-434): no upload surface.
- ✅ F-SAST-12 Missing CSRF protection (CWE-352): `POST /credit-cards/:id/payments` sits behind the existing origin guard, session and verified-email middleware like every other route.
- ✅ F-SAST-13 Critical/High CVE in a dependency: `pnpm audit --prod --audit-level high` on the final tree — "No known vulnerabilities found"; the lockfile and manifests are unchanged by this ticket.
- ✅ F-SAST-14 Incomplete input validation (CWE-20): currency enum, UUID source account, positive integer string amount up to 10^15, ISO instant, note up to 500 characters without control characters, strict body that refuses a destination key (`packages/shared/src/credit-cards/statement-payment.ts`); the transfer rules of PRD 03 and the movements table constraints apply on top (currency, archived, same account, future date).
- ✅ F-SAST-15 Insecure error handling (CWE-209): the route has no try/catch; typed errors reach the one error middleware and bodies are `{ code, fields? }` only; a foreign card or account answers the standard 404 (`apps/api/src/credit-cards/application/record-statement-payment.ts:30`).
- ✅ F-SAST-16 Medium CVE in a dependency: `pnpm audit` reports none at the high level and no dependency changed.
- ✅ F-SAST-17 Unsafe function (CWE-95): no `eval`, `new Function` or dynamic code in the scope.
- ✅ F-SAST-18 Suppressions complete: no suppressions in this report.
- ✅ F-SAST-19 Suppressions within review window: no suppressions in this report.

## Cross-cutting checks

- Authorization and data scope: the card is loaded through the scoped repository before anything is recorded; the transfer rules resolve both accounts under the caller's scope; the received-transfers sum filters by owner in the same statement. Bob's payment on Ana's card, and Bob paying from Ana's account, answer 404 and store nothing (route test, threat R-01).
- Destination: the request has no destination field and the server derives the card's linked account of the currency (threat R-03); a `destinationAccountId` key is refused with 400.
- Write limit: the payment spends the `manual` bucket of the movement write limiter through `RecordManualMovement`, and the 61st creation of a minute answers 429 (threat R-02).
- Module boundary: `credit-cards` declares the `CardPayments` and `StatementPaymentRecorder` ports and imports nothing from `movements`; the existing ESLint block and boundary tests refuse such an import.
- Money: amounts are `bigint` and integer strings end to end; the allocation is `bigint` arithmetic and the SQL sum is cast to text, with a test that sums beyond 2^53 exactly (threat R-04).

## Low and informational findings (W-SAST-01)

| ID | Severity | Location | Finding | Disposition |
|---|---|---|---|---|
| I-1 | Info (CWE-840) | `apps/api/src/credit-cards/application/statement-views.ts:22` | Any transfer into the card account counts as a payment, including one made with the ordinary movement form | Intended by decision D2 of the spec so editing or deleting a payment through the movements API moves the status; reported to the owner as a decision |
| I-2 | Info (CWE-400) | `apps/api/src/movements/infrastructure/credit-cards/drizzle-card-payments.ts:18` | The sum reads all transfers to the card's two accounts on every statement read | One grouped query served by the destination index and the owner filter, returning at most two rows; no unbounded result |

## Summary

Total: 19 categories clean, 0 vulnerabilities open (0 critical, 0 high, 0 medium); 2 Info
documented, none blocking.

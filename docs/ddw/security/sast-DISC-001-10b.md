# SAST report DISC-001-10b: Card Expenses and Statement Assignment

| Field | Value |
|---|---|
| Ticket | DISC-001-10b |
| Tier | FEATURE |
| Date | 2026-10-06 |
| Scope | `git diff 663f747..HEAD` over `apps/`, `packages/` and `eslint.config.mjs` without tests and e2e (29 files): `packages/shared/src/credit-cards/credit-card.ts`; `apps/api/src/credit-cards/**` (domain, application, ports, routes, presenter); `apps/api/src/movements/infrastructure/{credit-cards/drizzle-card-purchases,accounts/drizzle-expense-recorder}.ts` and `movements/index.ts`; `apps/api/src/server.ts`; `apps/web/src/features/credit-cards/**`, the `/cards/[id]/expense` page, the two movements helper edits, `apps/web/src/lib/api-client.ts`, both catalogs; tests and e2e scanned for secrets only. No migration, no schema change, no dependency added. |
| Method | Review of the diff by the author with targeted searches over the changed files (secret patterns, `sql.raw` and interpolated SQL, `eval`/`exec`/`child_process`, `innerHTML`/`dangerouslySetInnerHTML`, file access, outbound calls, logger calls), the threat model R-01 to R-05 as checklist, per-block module-verifier and arch-auditor reviews, plus `pnpm audit --prod --audit-level high` on the final tree |
| Result | PASSED — 0 Critical, 0 High, 0 Medium open; 3 Info documented below |

## Findings by rule

- ✅ F-SAST-01 Hardcoded secrets (CWE-798): the secret-pattern search over the 29 files finds only identifiers such as `passwordResetResponseSchema` in `apps/web/src/lib/api-client.ts:16`, no literal secret; the e2e spec reuses the fixed test password of the existing flows against a throwaway database; `.env` is ignored by git.
- ✅ F-SAST-02 SQL injection (CWE-89): the only raw fragment is `to_char(... at time zone ${timeZone}, 'YYYY-MM-DD')` in `apps/api/src/movements/infrastructure/credit-cards/drizzle-card-purchases.ts:23`, where the time zone is a bound parameter of the drizzle `sql` template and the `groupBy(sql\`1, 2\`)` at `:40` is a constant; the owner filter `scopedTo` sits in the same statement (`:34`); no `sql.raw` in the scope.
- ✅ F-SAST-03 OS command injection (CWE-78): no `child_process`, `exec` or `spawn` in the scope.
- ✅ F-SAST-04 Insecure deserialization (CWE-502): the new route validates params, body and response with the shared strict Zod schemas in the one `validate` middleware (`apps/api/src/credit-cards/infrastructure/http/credit-card-routes.ts:212`); the web client parses the answer with `cardExpenseResponseSchema` (`apps/web/src/lib/api-client.ts:729`).
- ✅ F-SAST-05 Path traversal (CWE-22): no file access in `src`; the web client builds the card path with `resourcePath`, which refuses `.`, `..` and empty ids (`apps/web/src/lib/api-client.ts:209`), and the API validates the id as a UUID.
- ✅ F-SAST-06 XSS (CWE-79): amounts, category labels and notes render as React text nodes; no `dangerouslySetInnerHTML`, `innerHTML` or `document.write` in the scope; notes refuse control and format characters (`packages/shared/src/movements/movement.ts`, `movementNoteSchema`).
- ✅ F-SAST-07 SSRF (CWE-918): the API makes no outbound request in this ticket; the web client calls only its configured API origin.
- ✅ F-SAST-08 Broken cryptography (CWE-327): no hashing, randomness or encryption in the scope.
- ✅ F-SAST-09 Debug mode in production (CWE-489): no debug flag and no `console` call added (search over the scope returns none).
- ✅ F-SAST-10 Logging sensitive data (CWE-532): the audit line of the new route carries request id, user id, card id and movement id only (`apps/api/src/credit-cards/infrastructure/http/credit-card-routes.ts:233`); a route test asserts that neither the amount nor the note reaches the captured log (threat R-01).
- ✅ F-SAST-11 Unrestricted upload (CWE-434): no upload surface.
- ✅ F-SAST-12 Missing CSRF protection (CWE-352): `POST /credit-cards/:id/expenses` sits behind the existing origin guard, session and verified-email middleware like every other state-changing route.
- ✅ F-SAST-13 Critical/High CVE in a dependency: `pnpm audit --prod --audit-level high` on the final tree — "No known vulnerabilities found"; no dependency added.
- ✅ F-SAST-14 Incomplete input validation (CWE-20): currency `ARS` or `USD`, UUID ids, positive integer string amount up to 10^15, ISO UTC instant between 1970 and 2100, note up to 500 characters without control characters, strict body that refuses `accountId` (`packages/shared/src/credit-cards/credit-card.ts`); the movements rules (date not in the future, category kind and open state) run in the reused `CreateMovement`.
- ✅ F-SAST-15 Insecure error handling (CWE-209): the route has no try/catch; typed errors reach the one error middleware and bodies are `{ code, fields? }` only; a foreign card answers the standard 404 (`apps/api/src/credit-cards/application/record-card-expense.ts:44`).
- ✅ F-SAST-16 Medium CVE in a dependency: none (`pnpm audit` clean and no dependency changed).
- ✅ F-SAST-17 Unsafe function (CWE-95): no `eval`, `new Function` or dynamic code in the scope.
- ✅ F-SAST-18 Suppressions complete: no suppressions in this report.
- ✅ F-SAST-19 Suppressions within review window: no suppressions in this report.

## Cross-cutting checks

- Authorization and data scope: the card is loaded through the scoped repository before anything is recorded, the linked account is chosen server side from the card and the currency, and the daily purchase sums filter by owner in the same statement; a card of another user answers 404 on the new route (route test with two users, threat R-01).
- Write limit: the card expense goes through `RecordManualMovement`, so it spends the same `manual` limiter bucket as `POST /movements`; a route test shows the 61st creation of a minute answers 429 (threat R-02).
- Module boundary: `credit-cards` declares the `ExpenseRecorder` and `CardPurchases` ports and imports nothing from `movements`; an ESLint block and five boundary tests refuse such an import (spec Block 4).
- No migration: reverting the commits restores the previous behavior; purchases stay as movements on the linked accounts.

## Low and informational findings (W-SAST-01)

| ID | Severity | Location | Finding | Disposition |
|---|---|---|---|---|
| I-1 | Info (CWE-770) | `apps/api/src/credit-cards/infrastructure/http/credit-card-routes.ts:212` | The new route has no limit of its own beyond the shared `manual` movement bucket | Threat R-02: intended, the bucket is shared with `POST /movements` (spec D7) |
| I-2 | Info (CWE-400) | `apps/api/src/movements/infrastructure/credit-cards/drizzle-card-purchases.ts:34` | The daily sums scan every expense of the card's two accounts on each statement read, with no lower date bound | Result size is bounded by days of use times two currencies and the existing `movements_owner_account_date_idx` serves the filter; a purchase before the first cycle belongs to the first statement, so a bound would change the rule (spec D3) |
| I-3 | Info (CWE-840) | `apps/api/src/credit-cards/application/record-card-expense.ts:47` | Missing statement cycles are created before the expense is recorded, so a rejected expense leaves them created | Idempotent inserts that any statement read creates anyway (10a decision D6); no data is lost or exposed |

## Summary

Total: 19 categories clean, 0 vulnerabilities open (0 critical, 0 high, 0 medium); 3 Info
documented, none blocking.

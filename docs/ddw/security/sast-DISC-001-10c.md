# SAST report DISC-001-10c: Installment Purchases, Statement Totals and Pending Debt

| Field | Value |
|---|---|
| Ticket | DISC-001-10c |
| Tier | FEATURE |
| Date | 2026-10-08 |
| Scope | `git diff 77d55f1..HEAD` over `apps/`, `packages/` and the lockfile without tests and e2e: `packages/shared/src/credit-cards/{installment,credit-card}.ts` and `money/split-installments.ts`; `apps/api/src/credit-cards/**` (domain, use cases, ports, repository, routes, presenter, schema); `apps/api/src/movements/infrastructure/credit-cards/{drizzle-expense-category-guard,drizzle-installment-write-limit}.ts` and `movements/index.ts`; `apps/api/src/server.ts`; migration `apps/api/drizzle/0020_installments.sql` and its rollback; `apps/web/src/features/credit-cards/**`, the `/cards/[id]/installments/new` page, `apps/web/src/lib/api-client.ts`, both catalogs; `apps/web/package.json` and `pnpm-lock.yaml` (next 16.3.8); tests and e2e scanned for secrets only. |
| Method | Review of the diff by the author with targeted searches over the changed files (secret patterns, `sql.raw` and interpolated SQL, `eval`/`exec`/`child_process`, `innerHTML`/`dangerouslySetInnerHTML`, file access, outbound calls, logger calls), the threat model R-01 to R-05 as checklist, ESLint with the module boundary rules, plus `pnpm audit --prod --audit-level high` on the final tree. No per-block subagent review was run (see the tests report, deviations) |
| Result | PASSED — 0 Critical, 0 High, 0 Medium open; 3 Info documented below |

## Findings by rule

- ✅ F-SAST-01 Hardcoded secrets (CWE-798): the secret-pattern search over the changed sources finds no literal secret; the e2e spec reuses the fixed test password of the existing flows against a throwaway database; `.env` is ignored by git.
- ✅ F-SAST-02 SQL injection (CWE-89): every statement is built with Drizzle's query builder and bound parameters (`apps/api/src/credit-cards/infrastructure/db/drizzle-installment-repository.ts`); the only raw fragments are `sql.raw('1000000000000000')` in `apps/api/src/credit-cards/infrastructure/db/schema.ts:98`, a constant literal for the amount range check (the same pattern as `movements`), and `count(*)::int`/`1` selects with no input; the owner filter `scopedTo` sits in the same statement as every card, purchase and installment filter (`drizzle-installment-repository.ts:33` and `:196`).
- ✅ F-SAST-03 OS command injection (CWE-78): no `child_process`, `exec` or `spawn` in the scope.
- ✅ F-SAST-04 Insecure deserialization (CWE-502): the new routes validate params, body, query and response with the shared strict Zod schemas in the one `validate` middleware (`apps/api/src/credit-cards/infrastructure/http/credit-card-routes.ts:293` to `:380`); the web client parses every answer with the shared schemas (`apps/web/src/lib/api-client.ts`).
- ✅ F-SAST-05 Path traversal (CWE-22): no file access in `src`; the web client builds card and purchase paths with `resourcePath`, which refuses `.`, `..` and empty ids (`apps/web/src/lib/api-client.ts:526`), and the API validates both ids as UUIDs.
- ✅ F-SAST-06 XSS (CWE-79): amounts, notes and category labels render as React text nodes; no `dangerouslySetInnerHTML`, `innerHTML` or `document.write` in the scope; notes refuse control and format characters (`movementNoteSchema`).
- ✅ F-SAST-07 SSRF (CWE-918): the API makes no outbound request in this ticket; the web client calls only its configured API origin. The `next` upgrade closes GHSA-cjq9-62q9-8jv4, a server-side request forgery in the Next.js image optimizer.
- ✅ F-SAST-08 Broken cryptography (CWE-327): no hashing, randomness or encryption in the scope.
- ✅ F-SAST-09 Debug mode in production (CWE-489): no debug flag and no `console` call added (search over the scope returns none).
- ✅ F-SAST-10 Logging sensitive data (CWE-532): the audit lines of the new routes carry request id, user id, card id and purchase id only (`credit-card-routes.ts:310`, `:356`, `:372`); a route test asserts that neither the amount nor the note reaches the captured log (threat R-01).
- ✅ F-SAST-11 Unrestricted upload (CWE-434): no upload surface.
- ✅ F-SAST-12 Missing CSRF protection (CWE-352): the state-changing routes (`POST`, `PATCH`, `DELETE` under `/credit-cards/:id/installment-purchases`) sit behind the existing origin guard, session and verified-email middleware like every other route.
- ✅ F-SAST-13 Critical/High CVE in a dependency: `pnpm audit --prod --audit-level high` on the final tree — "No known vulnerabilities found". It reported one High (GHSA-cjq9-62q9-8jv4, `next` >=16.0.0 <16.3.8) on the tree this branch started from; `next` is raised to `^16.3.8` in `apps/web/package.json` (a patch-level raise, no new dependency) and the lockfile follows.
- ✅ F-SAST-14 Incomplete input validation (CWE-20): currency literal `ARS`, installments integer 2 to 60, UUID ids, positive integer string amount up to 10^15 and at least one minor unit per installment, real calendar date not after today in the user's zone, note up to 500 characters without control characters, months `YYYY-MM` in a range of at most 60 months, strict bodies that refuse `accountId` and amount edits (`packages/shared/src/credit-cards/installment.ts`); the database repeats the ranges as check constraints in migration 0020.
- ✅ F-SAST-15 Insecure error handling (CWE-209): the routes have no try/catch; typed errors reach the one error middleware and bodies are `{ code, fields? }` only; a foreign or cancelled card or purchase answers the standard 404 (`apps/api/src/credit-cards/application/update-installment-purchase.ts`).
- ✅ F-SAST-16 Medium CVE in a dependency: `pnpm audit` reports none at the high level; the `next` raise also takes the patched release line.
- ✅ F-SAST-17 Unsafe function (CWE-95): no `eval`, `new Function` or dynamic code in the scope.
- ✅ F-SAST-18 Suppressions complete: no suppressions in this report.
- ✅ F-SAST-19 Suppressions within review window: no suppressions in this report.

## Cross-cutting checks

- Authorization and data scope: the card is loaded through the scoped repository before anything is written, the purchase and installment queries filter by owner in the same statement, and the migration ties purchases to their card and category and installments to their purchase with composite owner keys; Bob's get, edit, delete, list and create on Ana's card answer 404 and change nothing (route test, threat R-01).
- Write limit: creation spends the `manual` bucket of the movement write limiter through the `InstallmentWriteLimit` port, refunds the unit on any failure, and the 61st creation of a minute answers 429 (threat R-02).
- Module boundary: `credit-cards` declares the `ExpenseCategoryGuard` and `InstallmentWriteLimit` ports and imports nothing from `movements`; the existing ESLint block and boundary tests refuse such an import.
- Money: amounts are `bigint` and integer strings end to end; the split is integer arithmetic with the leftover on the first installment and 10,000 random purchases add up exactly (threat R-04).
- Migration 0020 is additive (two new tables), applies and reverts in the migration tests, and its journal `when` (1791419213992) is above main's maximum (1791246865297) and must be checked again at merge.

## Low and informational findings (W-SAST-01)

| ID | Severity | Location | Finding | Disposition |
|---|---|---|---|---|
| I-1 | Info (CWE-770) | `apps/api/src/credit-cards/infrastructure/http/credit-card-routes.ts:293` | The user has no cap on the number of active installment purchases, only the shared 60 per minute creation limit | Threat R-02: the PRD sets no cap (NFR-02 is measured at 60 purchases) and none is invented here; the p95 benchmark with 60 purchases of 60 installments is 54 ms |
| I-2 | Info (CWE-400) | `apps/api/src/credit-cards/application/list-installment-expenses.ts:22` | The monthly expenses read loads every installment row of the caller and every statement of each card before filtering by month | Bounded by the caller's own purchases and by the indexed owner filter; the range is capped at 60 months in the contract; revisit when PRD 06 and PRD 09 consume it |
| I-3 | Info (CWE-840) | `apps/api/src/credit-cards/application/create-installment-purchase.ts:56` | Missing statement cycles are created before the purchase is stored, so a rejected purchase leaves them created | Idempotent inserts that any statement read creates anyway (10a decision D6); no data is lost or exposed |

## Summary

Total: 19 categories clean, 0 vulnerabilities open (0 critical, 0 high, 0 medium); 3 Info
documented, none blocking.

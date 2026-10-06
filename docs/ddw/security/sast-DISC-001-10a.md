# SAST report DISC-001-10a: Cards, Linked Accounts and Statement Cycles

| Field | Value |
|---|---|
| Ticket | DISC-001-10a |
| Tier | FEATURE |
| Date | 2026-10-06 |
| Scope | `git diff cc9d38e..HEAD` over `apps/` and `packages/` without tests, e2e and drizzle snapshots (60 files): `packages/shared/src/credit-cards/{statement-cycle,credit-card}.ts`, `packages/shared/src/{accounts/account,errors,index}.ts`; `apps/api/src/credit-cards/**` (domain, application, ports, Drizzle repository, links, time zone, erasure step, routes, presenter, index); `apps/api/src/accounts/**` (the `AccountLinks` port, its default adapter, `delete-account.ts`, the repository mapping, the routes option); `apps/api/src/server.ts`, `apps/api/src/shared/http/error-handler.ts`; migration `apps/api/drizzle/0019_credit_cards.sql` and its rollback; `apps/web/src/features/credit-cards/**`, the `/cards` pages, `apps/web/src/lib/api-client.ts`, `nav-items.ts`, `account-form-errors.ts`, both catalogs; tests, e2e and their helpers scanned for secrets only. One migration (0019, additive). No dependency added. |
| Method | Manual review of the diff by the author (no separate reviewer: the run has no sub-agents) against catalog §4, targeted searches over the changed files (secret patterns, `sql.raw` and interpolated SQL, `eval`/`exec`/`child_process`, `innerHTML`/`dangerouslySetInnerHTML`, file access, outbound calls, logger calls), the threat model R-01 to R-13 as checklist, plus `pnpm audit --prod --audit-level high` on the final tree |
| Result | PASSED — 0 Critical, 0 High, 0 Medium open; 3 Info documented below |

## Findings by rule

- ✅ F-SAST-01 Hardcoded secrets (CWE-798): the secret-pattern search over the 60 files returns only `apps/web/e2e/credit-cards.spec.ts:7`, the fixed test password every e2e flow uses against its throwaway database; `.env` is ignored by git; no token or connection string in the source.
- ✅ F-SAST-02 SQL injection (CWE-89): every statement is a Drizzle builder with bound values and the owner filter from `scopedTo` in the same statement (`apps/api/src/credit-cards/infrastructure/db/drizzle-credit-card-repository.ts:41`, `:46`, `:62`, `:138`); no `sql.raw` in the scope; the check-constraint literals in `schema.ts` are compile-time constants; the migration and its rollback are fixed text.
- ✅ F-SAST-03 OS command injection (CWE-78): no `child_process`, `exec` or `spawn` in the scope (the only `.exec` hits are `RegExp.exec` in `packages/shared/src/credit-cards/statement-cycle.ts:25`, `:58`).
- ✅ F-SAST-04 Insecure deserialization (CWE-502): request bodies, params and responses go through the shared strict Zod schemas in the one `validate` middleware (`apps/api/src/credit-cards/infrastructure/http/credit-card-routes.ts:99`, `:131`, `:174`); the web client parses every answer with the same schemas.
- ✅ F-SAST-05 Path traversal (CWE-22): no file access in `src`; on the web the ids go through `resourcePath`, which refuses `.`, `..` and empty ids and encodes the rest (`apps/web/src/lib/api-client.ts:472`, `:481-482`), and the API validates them as UUIDs.
- ✅ F-SAST-06 XSS (CWE-79): card names, dates and statuses render as React text nodes; no `dangerouslySetInnerHTML`, `innerHTML` or `document.write` in the scope; names refuse control and format characters (`packages/shared/src/accounts/account.ts`, `boundedNameSchema`).
- ✅ F-SAST-07 SSRF (CWE-918): the API makes no outbound request in this ticket; the web client calls only its configured API origin (`apps/web/src/lib/api-client.ts:386`).
- ✅ F-SAST-08 Broken cryptography (CWE-327): no hashing, randomness or encryption in the scope; ids come from PostgreSQL `gen_random_uuid()`.
- ✅ F-SAST-09 Debug mode in production (CWE-489): no debug flag and no `console` call added.
- ✅ F-SAST-10 Logging sensitive data (CWE-532): the audit lines carry `requestId`, `userId`, `cardId` and `statementId` only (`apps/api/src/credit-cards/infrastructure/http/credit-card-routes.ts:90`, `:104`, `:140`, `:153`); a route test asserts that the card name never reaches the captured log (threat R-03).
- ✅ F-SAST-11 Unrestricted upload (CWE-434): no upload surface.
- ✅ F-SAST-12 Missing CSRF protection (CWE-352): the new state-changing routes sit behind the existing origin guard (Origin plus `X-Requested-With`), session and verified-email middleware; a route test posts without the header and gets 403 with nothing stored (threat R-01).
- ✅ F-SAST-13 Critical/High CVE in a dependency: `pnpm audit --prod --audit-level high` on the final tree — "No known vulnerabilities found"; no dependency added.
- ✅ F-SAST-14 Incomplete input validation (CWE-20): name 1 to 46 characters, days integers 1 to 31, dates real `YYYY-MM-DD`, ids UUID, strict bodies with at least one key on updates (`packages/shared/src/credit-cards/credit-card.ts`); the order invariant of statement dates is enforced in the domain (`apps/api/src/credit-cards/domain/statement-schedule.ts`) and the database checks mirror the ranges (`apps/api/drizzle/0019_credit_cards.sql`).
- ✅ F-SAST-15 Insecure error handling (CWE-209): unique and foreign-key violations become typed errors before they can reach a response (`apps/api/src/credit-cards/infrastructure/db/drizzle-credit-card-repository.ts:97`, `apps/api/src/accounts/infrastructure/db/drizzle-account-repository.ts:179`); error bodies are `{ code, fields? }` only.
- ✅ F-SAST-16 Medium CVE in a dependency: none (`pnpm audit` clean and no dependency changed).
- ✅ F-SAST-17 Unsafe function (CWE-95): no `eval`, `new Function` or dynamic code in the scope.
- ✅ F-SAST-18 Suppressions complete: no suppressions in this report.
- ✅ F-SAST-19 Suppressions within review window: no suppressions in this report.

## Cross-cutting checks

- Authorization and data scope: every repository statement is owner-scoped; a card or statement of another user answers the standard 404 on all seven routes (route test with two users, threat R-02); the composite keys `(account_id, owner_id)` and `(card_id, owner_id)` make PostgreSQL refuse a cross-owner link even if a scope check were missing (migration test).
- Integrity of financial history: deleting a card checks movements on both linked accounts and the movements' restricting keys refuse a delete that races a new movement, mapped to 409 (user decision D1, threat R-07); a linked account cannot be deleted through the accounts API, by guard and by restricting key (D2, threat R-08).
- Erasure: `eraseUserCreditCards` runs after `eraseUserMovements` in the composition root, and the erasure registry lists both tables with the two allowed restricting constraints (threat R-09).
- Migration 0019: additive (two new tables), applied and reverted in tests on a 0018 database; the rollback runs twice; its journal `when` (1791246865297) is above 0018 and `main`'s maximum today and must be checked again at merge (threat R-10).

## Low and informational findings (W-SAST-01)

| ID | Severity | Location | Finding | Disposition |
|---|---|---|---|---|
| I-1 | Info (CWE-770) | `apps/api/src/credit-cards/infrastructure/http/credit-card-routes.ts:99` | `POST /credit-cards` has no per-user rate limit, and each call writes two accounts, a card and a statement | Threat R-13: the same surface as `POST /accounts`, which is equally unlimited at personal scale; constant-size transaction behind a verified session and the 16 kB body cap |
| I-2 | Info (CWE-834) | `apps/api/src/credit-cards/domain/statement-schedule.ts:26` | Reading statements creates every missing monthly cycle since the latest one | Threat R-05: bounded by the elapsed months and a hard guard of 1,200 cycles, with idempotent inserts per period |
| I-3 | Info (CWE-639) | `apps/api/src/accounts/application/delete-account.ts:23` | `AccountLinks.isLinked` takes no scope | Unscoped by design like `AccountMovements`: it only receives an id the scoped repository just returned and answers a boolean; another user's account answers 404 before it is called |

## Summary

Total: 19 categories clean, 0 vulnerabilities open (0 critical, 0 high, 0 medium); 3 Info
documented, none blocking.

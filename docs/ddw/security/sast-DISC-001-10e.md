# SAST report DISC-001-10e: Automatic debit of credit card statements

| Field | Value |
|---|---|
| Ticket | DISC-001-10e |
| Tier | FEATURE |
| Date | 2026-10-10 |
| Scope | `git diff f497d76..HEAD` over `apps` and `packages` (12 blocks, commits `f9e7ee2` to `d92a603`): `apps/api/src/credit-cards` (domain `automatic-debit.ts`, use cases `set-card-debit-accounts.ts` and `record-automatic-debits.ts`, Drizzle claim log, source, debit-account lookup and repository, route, job loop and `jobs.ts`), `apps/api/src/movements/infrastructure/credit-cards/drizzle-automatic-debit-recorder.ts`, `apps/api/src/worker.ts`, `apps/api/src/shared/config/env.ts`, `apps/api/drizzle/0029_card_automatic_debit.sql` and its rollback, `apps/web/src/features/credit-cards` (debit accounts form and request builder), `apps/web/src/lib/api-client.ts`, `packages/shared/src/credit-cards`, plus tests |
| Method | ESLint (`pnpm exec eslint .`, clean, including the security-relevant rules of the project config), `pnpm audit --prod --audit-level high`, a manual review of the new code against risks R-01 to R-14 of `docs/ddw/security/threat-DISC-001-10e.md`, grep checks over the changed non-test sources (`any`, `parseFloat`, `toFixed`, `Number(` near money, `sql` templates and `db.execute`, `dangerouslySetInnerHTML`, `innerHTML`, `eval(`, `new Function`, `child_process`, `exec(`, `console.`, secret-like names, imports of `credit-cards/jobs` and of the cross-owner source), and the independent reports of `ddw-module-verifier` and `ddw-arch-auditor` |
| Result | PASSED: 0 Critical, 0 High, 0 Medium open; 4 Low and 1 Info documented below |

## Findings by rule

- ✅ F-SAST-01 Hardcoded secrets (CWE-798): the scan for password, secret, token and key names over the changed sources found none added by this ticket; the only matches are a comment in `apps/api/src/credit-cards/domain/automatic-debit.ts:31` stating the SHA-256 is "never for secrets" and the existing `jwtSecretSchema` in `apps/api/src/shared/config/env.ts:6`. The worker interval is the only environment value the job reads, and it was already validated.
- ✅ F-SAST-02 SQL injection (CWE-89): the claim log uses Drizzle `onConflictDoNothing` and `.for('update')` with bound values (`apps/api/src/credit-cards/infrastructure/db/drizzle-automatic-debit-log.ts:59` and `:64`); the source, the lookup and the repository use Drizzle operators; the `sql` templates in `apps/api/src/credit-cards/infrastructure/db/schema.ts:74` to `:116` are static check constraints over column references; the migration is static DDL (`apps/api/drizzle/0029_card_automatic_debit.sql:11`). No `db.execute`, `sql.raw` or string concatenation into a query.
- ✅ F-SAST-03 OS command injection (CWE-78): no `child_process`, `exec` or `spawn` in the changed code.
- ✅ F-SAST-04 Insecure deserialization (CWE-502): the only input of the new route is a strict Zod body with two keys and a uuid param (`apps/api/src/credit-cards/infrastructure/http/credit-card-routes.ts:237`); nothing is deserialized beyond `JSON` through the shared validator.
- ✅ F-SAST-05 Path traversal (CWE-22): no file path is built from input; the web request builder refuses a card id such as `..` through `resourcePath` without a request (`apps/web/src/features/credit-cards/debit-accounts-request.ts`).
- ✅ F-SAST-06 XSS (CWE-79): the debit accounts form renders account names as React text nodes and error text through the i18n catalogs (`apps/web/src/features/credit-cards/components/debit-accounts-form.tsx`); no `dangerouslySetInnerHTML` or `innerHTML` in the changed code.
- ✅ F-SAST-07 SSRF (CWE-918): no outbound request added; the web client calls the existing API base only and the job talks to the database only.
- ✅ F-SAST-08 Broken cryptography (CWE-327): the only cryptography is a SHA-256 used to derive an idempotency id from card, period and currency with the `pesly:automatic-debit:` prefix (`apps/api/src/credit-cards/domain/automatic-debit.ts:99`); it protects nothing and is not an identity. It is written by hand in the domain (`:33`) because the domain may not import `node:crypto` (documented decision D2), and a test checks it against the real SHA-256 for short, long and non-ASCII input (`automatic-debit.test.ts`, `derives the id from the real SHA-256 of the key`).
- ✅ F-SAST-09 Debug mode in production (CWE-489): no debug flag added; an idle pass logs at debug level and a pass that did something at info (`apps/api/src/credit-cards/infrastructure/jobs/automatic-debit-job.ts:86`).
- ✅ F-SAST-10 Logging sensitive data (CWE-532): failures and settlements log card id, period, currency, reason and error class name only, de-duplicated per key (`apps/api/src/credit-cards/infrastructure/jobs/automatic-debit-job.ts:25` and `:42`); the pass-level error logs only the class name (`:100`, fixed by finding L1 below); the route audit line carries request id, user id and card id and never an account id or name (`apps/api/src/credit-cards/infrastructure/http/credit-card-routes.ts:251`). Tests assert no amount, account name or card name in any logged field (`automatic-debit.test.ts`, `automatic-debit-job.test.ts`, `debit-account-routes.test.ts`).
- ✅ F-SAST-11 Unrestricted upload (CWE-434): not applicable, no upload surface.
- ✅ F-SAST-12 Missing CSRF protection (CWE-352): the new `PUT` sits behind `requireSession` and `requireVerifiedEmail` and the cookie policy of every authenticated route; no new cookie or auth mechanism (`apps/api/src/credit-cards/infrastructure/http/credit-card-routes.ts:237`). The job has no HTTP surface.
- ✅ F-SAST-13 Critical/High CVE in a dependency: `pnpm audit --prod --audit-level high` reported "No known vulnerabilities found"; no dependency was added (`node:crypto` was not even needed).
- ✅ F-SAST-14 Incomplete input validation (CWE-20): card id and both account ids are validated by the shared Zod schema before any handler runs, with both keys required so a forgotten key cannot silently unlink (`packages/shared/src/credit-cards/credit-card.ts`); sad-path tests cover a non-uuid card id (400), a wrong-currency account (400), a card account (400), an archived account (409), a foreign account or card (404), no session (401) and an unverified email (403) in `debit-account-routes.test.ts`, and the database checks in `automatic-debit-migration.test.ts`.
- ✅ F-SAST-15 Insecure error handling (CWE-209): route errors go through the shared error middleware with new typed errors (`apps/api/src/shared/http/error-handler.ts`); a foreign or missing account or card is a 404 and never a 403; the job catches errors per claim and per card and reports ids and the class name, never a message or a stack.
- ✅ F-SAST-16 Medium CVE in a dependency: `pnpm audit` over production dependencies reports no known vulnerabilities.
- ✅ F-SAST-17 Unsafe function (CWE-95): no `eval`, `new Function` or `innerHTML`; no `any` in the changed sources; money stays `bigint` and `apps/api/test/credit-cards/no-float-money.test.ts` now scans the debit files for `Number(`, `parseFloat` and `toFixed`.
- ✅ F-SAST-18 Suppressions complete: no suppressions in this report.
- ✅ F-SAST-19 Suppressions within review window: no suppressions in this report.

## Review against the threat model (R-01 to R-14)

| Risk | Mitigation found in the code | Verdict |
|---|---|---|
| R-01 double debit under concurrency or a crash | primary key (card, period, currency) in `0029_card_automatic_debit.sql:11`; claim by `onConflictDoNothing` then `.for('update')` in one transaction (`drizzle-automatic-debit-log.ts:47` to `:64`); transfer id from the SHA-256 of the key (`domain/automatic-debit.ts:99`); the recorder returns the stored movement on a repeat (`drizzle-automatic-debit-recorder.ts:58`); tests: concurrent claims, two simultaneous passes, crash then rerun | Mitigated; residual edge accepted by the threat model |
| R-02 wrong owner scope | scope built per owner from the `users` join (`drizzle-automatic-debit-source.ts:40`, `record-automatic-debits.ts:109`); composite owner keys (`0029_card_automatic_debit.sql:23` to `:26`); recorder tests for a foreign source and destination account (added in the review, M1) and the two-owner pass test | Mitigated |
| R-03 cross-owner source reachable from the API | `credit-cards/jobs.ts` is not re-exported from the module index; only `apps/api/src/worker.ts:7` imports it (grep over `apps/api/src` finds no other importer); tests `the module index does not export the job, the source or the factory` and `the API entry server.ts never imports credit-cards/jobs` | Mitigated |
| R-04 IDOR on the new route | card loaded first with the owner scope, accounts looked up with the owner filter, 404 for foreign and missing alike (`set-card-debit-accounts.ts:39` and `:54`, `drizzle-debit-accounts.ts`); scoped `UPDATE` and composite keys as the second layer; route tests for Bob on Ana's card | Mitigated |
| R-05 wrong currency, archived or card account | currency and archive checks and `isCardAccount` in `set-card-debit-accounts.ts:54` to `:62`; database checks `credit_cards_debit_*_not_card_account_check` (`0029_card_automatic_debit.sql:30` and `:31`); picker filter in `debit-accounts-request.ts`; the recorder's own currency rule | Mitigated |
| R-06 paying statements due before the link | `debit_*_linked_on` lower bound kept when the same account is saved again (`set-card-debit-accounts.ts:60`), applied by `debitCandidates` in `domain/automatic-debit.ts`; tests for statements due before and on the link date | Mitigated |
| R-07 hijacked session redirects a debit | the link can only name an account of the same owner and the transfer only moves the remainder to the card's own account; verified email, session and audit line | Mitigated, no new privilege |
| R-08 debit account archived, deleted or unlinked later | an unavailable account settles the claim `skipped` and is not retried (`record-automatic-debits.ts`); delete blocked by the restrict key and `isLinked` (`drizzle-card-account-links.ts`); tests for archived, missing and refused accounts | Mitigated |
| R-09 stale remainder | the remainder is recomputed inside the claim lock from fresh statements and payments with the screen's `buildStatementViews`; a covered statement settles `covered`; tests for hand payment before and between passes | Mitigated |
| R-10 logs expose amounts or names | sink and pass log carry ids and class name only (`automatic-debit-job.ts:25`, `:42`, `:100`); tests assert it | Mitigated |
| R-11 erasure and card deletion | cascade from `credit_cards` to the claim table; cards are deleted before accounts (`erase-user-credit-cards.ts`, unchanged); the source inner-joins `users`; `erasure-step.test.ts` keeps other users' rows | Mitigated |
| R-12 slow or blocked job | per-card and per-claim isolation, keyset pages of 500 over the partial index (`schema.ts:91`), passes never overlap, bounded de-duplication at 10,000 keys, interval 1 to 300 s validated by `parseWorkerEnv`; tests for each | Mitigated |
| R-13 no attribution of a link change | audit line with request id, user id and card id (`credit-card-routes.ts:251`); test that it holds no account id or name; claim row and transfer record each debit | Mitigated |
| R-14 migration and rollback | additive nullable columns, rollback script with a data-loss header, registry and journal tests (`automatic-debit-migration.test.ts`, `identity/migration.test.ts`); the journal `when` 1791747000000 must still be re-checked against `main` before merge | Mitigated; merge-time check pending |

## Independent review findings and resolution (commit d92a603)

The independent `ddw-module-verifier` and `ddw-arch-auditor` reviewed the branch. Every finding that
could change behavior or a guarantee was fixed in `d92a603`; the rest are accepted below.

| ID | Severity | Finding | Resolution |
|---|---|---|---|
| M1 | Medium | The recorder had no tests for a foreign source or destination account (R-02) | Fixed: `automatic-debit-adapters.test.ts` now covers a foreign source and destination account (`it.each(['source', 'destination'])`) and a stored id that belongs to another user (`raises ResourceNotFound when the id belongs to another user`) |
| M2 | Medium | A write-budget test passed vacuously and the job carried dead options | Fixed: the vacuous test was replaced by one that can fail and the dead options were removed |
| L1 | Low | The pass-level error log carried more than the error class name | Fixed: it now logs `{ errorName }` only (`automatic-debit-job.ts:100`), covered by `logs only the error class of a failed pass, never its message` in `automatic-debit-job.test.ts` |
| W1 | Low | The import style of the job in `worker.ts` and some spec wording | Fixed: the worker import style was aligned and the spec wording was corrected |

## Low and informational findings (W-SAST-01)

| ID | Severity | Location | Finding | Disposition |
|---|---|---|---|---|
| L2 | Low | `apps/api/test/credit-cards/automatic-debit-job.test.ts:435` | The crash-rerun case settles the claim with `movement_id` null, so the test does not assert the stored movement id on that path | Accepted: test-strength note; the idempotent recorder is asserted separately in `automatic-debit-adapters.test.ts` (`returns the stored movement on a repeat`) |
| L3 | Low | `apps/api/test/credit-cards/` | Test-strength note raised by the reviewer | Accepted as a test-strength note, no behavior risk found |
| L4 | Low | `apps/api/test/credit-cards/` | Test-strength note raised by the reviewer | Accepted as a test-strength note, no behavior risk found |
| L6 | Low | `apps/api/test/credit-cards/` | Test-strength note raised by the reviewer | Accepted as a test-strength note, no behavior risk found |
| I-1 | Info | `apps/api/src/credit-cards/infrastructure/db/drizzle-automatic-debit-source.ts:40` | The source reads every owner's cards with a debit account, with no end-user scope | Accepted: the documented worker-only exception; owner and zone come from the same `users` join row and the source is not exported (threat model R-03) |

## Summary

Total: 19 categories clean, 0 vulnerabilities open (0 critical, 0 high, 0 medium); 4 Low and 1 Info
documented, all accepted. The hand-written SHA-256 in the domain is a documented decision (the domain may
not import `node:crypto`), covered by a test against the real digest.

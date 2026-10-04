# SAST report DISC-001-03e: Edit and Delete Movements

| Field | Value |
|---|---|
| Ticket | DISC-001-03e |
| Tier | FEATURE |
| Date | 2026-10-04 |
| Scope | `git diff origin/main...HEAD` (origin/main 82acc3b, with DISC-001-03b, 03c and 03d merged) over `apps/` and `packages/` without tests and e2e (22 source files): `packages/shared/src/{errors,movements/movement}.ts`; `apps/api/src/movements/**` (`domain/errors.ts`, `application/{build-new-movement,create-movement,update-movement,delete-movement}.ts`, `application/ports/movement-repository.ts`, `infrastructure/db/drizzle-movement-repository.ts`, `infrastructure/http/movement-routes.ts`); `apps/api/src/shared/http/error-handler.ts`; `apps/web/src/features/movements/**` (`use-movement-form-data.ts`, `movement-request.ts`, the edit and list containers, `movement-form.tsx`, `movement-list.tsx`, `movement-row.tsx`, `rate-field.tsx`); `apps/web/src/lib/api-client.ts`; the edit page `apps/web/src/app/[locale]/(app)/movements/[id]/edit/page.tsx`; catalogs and `README.md`; tests, e2e and the perf test scanned for secrets only. There is no migration and no dependency change. |
| Method | Manual review of the diff by the orchestrator against catalog §4, targeted searches over the diff (secrets, raw SQL, dangerous functions, outbound calls, logging, HTML sinks, file access, cryptography), the threat model R-01 to R-13 as checklist, plus `pnpm audit --prod --audit-level high` on the final tree |
| Result | PASSED — 0 Critical, 0 High, 0 Medium open; 2 Info documented below |

## Findings by rule

- ✅ F-SAST-01 Hardcoded secrets (CWE-798): the secret-pattern search over the added lines of the 22 source files returns nothing, and `.env` is ignored by git; the only literals the search finds are the throwaway passphrase of seeded test users in two test files (see I-1); the README names `.env.example` and copies no value from it.
- ✅ F-SAST-02 SQL injection (CWE-89): the new statements are Drizzle builders (`apps/api/src/movements/infrastructure/db/drizzle-movement-repository.ts:264-318`) whose values are bound parameters; the only `sql` template added is the constant `now()` for `updated_at` (`drizzle-movement-repository.ts:286`); the tag link statement that the edit reuses binds names and owner as parameters and takes constants through `sql.identifier`; no migration is added.
- ✅ F-SAST-03 OS command injection (CWE-78): no `child_process`, `exec` or `spawn` in the scope.
- ✅ F-SAST-04 Insecure deserialization (CWE-502): the `PUT` body and the `:id` param are parsed by Express and validated by the shared Zod contract through the one `validate` middleware (`apps/api/src/movements/infrastructure/http/movement-routes.ts:249-270`); unknown keys are stripped, which a route test pins for `ownerId`, `id` and `createdAt`; no custom deserialization.
- ✅ F-SAST-05 Path traversal (CWE-22): no file access in `src`; the web client builds `/movements/<id>` through `resourcePath`, which refuses an empty id, `.` and `..` and encodes the rest (`apps/web/src/lib/api-client.ts:437`).
- ✅ F-SAST-06 XSS (CWE-79): the edit screen and the row actions render notes, tags and names through React text nodes and shadcn components; no `dangerouslySetInnerHTML`, `innerHTML` or `document.write` in the scope (threat R-10); the README is Markdown and runs nothing.
- ✅ F-SAST-07 SSRF (CWE-918): no outbound request is added on the API; the web client keeps building `${baseUrl}${path}` from the configured API base and a UUID-shaped segment.
- ✅ F-SAST-08 Broken cryptography (CWE-327): no cryptography added; no `Math.random` or hashing in the scope.
- ✅ F-SAST-09 Debug mode in production (CWE-489): no debug flag added; no `console` call in the scope.
- ✅ F-SAST-10 Logging sensitive data (CWE-532): the new audit lines carry request id, user id and movement id only (`apps/api/src/movements/infrastructure/http/movement-routes.ts:263,275`); a route test sends a distinctive amount, note, tag and rate through a successful `PUT`, a rejected `PUT` and a `DELETE`, and asserts that none of them reaches the movements log or the error log (threat R-08).
- ✅ F-SAST-11 Unrestricted upload (CWE-434): no upload surface.
- ✅ F-SAST-12 Missing CSRF protection (CWE-352): `PUT /movements/:id` and `DELETE /movements/:id` sit behind `requireSession`, `requireVerifiedEmail` and the global origin guard, which requires the web origin and `X-Requested-With` on every non-safe method; a route test sends both methods without the headers and expects 403 with the movement unchanged (threat R-06).
- ✅ F-SAST-13 Critical/High CVE in a dependency: `pnpm audit --prod --audit-level high` on the final tree — "No known vulnerabilities found"; no `package.json` or lockfile change in this ticket.
- ✅ F-SAST-14 Incomplete input validation (CWE-20): `id` is a UUID, the body is validated by the shared contract (amount 1 to 10^15, UTC instant between 1970 and 2100, note up to 500 code points without control or format characters, at most 10 tags of 1 to 30 code points, rate `automatic`, `keep` or `manual` with a scaled integer), the date is compared with today in the user's time zone by the one builder that creation also uses, and the database checks and composite keys repeat the ranges and the owner (`apps/api/src/movements/application/build-new-movement.ts`, threat R-03, R-09).
- ✅ F-SAST-15 Insecure error handling (CWE-209): errors map to `{ code }` bodies through the one error middleware; the new code `MOVEMENT_TYPE_IMMUTABLE` answers 409 there; `keep` without a stored rate raises `VALIDATION_FAILED` whose message never reaches the body (`apps/api/src/movements/application/build-new-movement.ts:126`); a foreign or missing id answers 404 with the same body, and the movement is loaded in scope before the type check, so the type of a foreign movement cannot be probed (`apps/api/src/movements/application/update-movement.ts:29-30`, threat R-02).
- ✅ F-SAST-16 Medium CVE in a dependency: none (`pnpm audit` clean).
- ✅ F-SAST-17 Unsafe function (CWE-95): no `eval`, `new Function` or `exec` in the scope; no new regular expression with nested quantifiers in `src`.
- ✅ F-SAST-18 Suppressions complete: no suppressions in this report.
- ✅ F-SAST-19 Suppressions within review window: no suppressions in this report.

## Cross-cutting checks

- Authorization and data scope: `update` and `delete` apply `scopedTo(scope, { owner })` on `movements` in the same statement that matches the id (`apps/api/src/movements/infrastructure/db/drizzle-movement-repository.ts:288-293,314`), the removal of the old tag links is filtered by owner as well (`drizzle-movement-repository.ts:299-301`), and the update also matches the stored type; a second user's id answers 404 on both routes (route and repository tests, threat R-01).
- Integrity: the update, the removal of the old tag links and the new links run in one transaction, and a test forces the tag write to fail and checks that the whole edit rolls back; balances are summed on read, so no stored balance can drift (threat R-04).
- Abuse and availability: both operations touch one movement and at most 10 links and create no rows; the JSON body limit stays in force; measured p95 is 74.6 ms for an edit with three tags and 8.5 ms for a delete, with 100,000 movements and a limit of 300 ms (threat R-07).
- Mass assignment: the repository picks every column one by one, and the contract strips unknown keys (threat R-03).
- Migration: none; reverting the commits restores the previous behavior without touching stored movements.
- Supply chain: no new dependency.

## Low and informational findings (W-SAST-01)

| ID | Severity | Location | Finding | Disposition |
|---|---|---|---|---|
| I-1 | Info (CWE-798) | `apps/api/test/movements/edit-delete-routes.test.ts:35` and `apps/api/test/perf/movements-edit-delete.perf.test.ts:31` | A literal passphrase for the throwaway users the tests seed in the test database | Accepted: the same literal and purpose as the existing movement route tests, it protects no real account and never reaches production code |
| I-2 | Info (CWE-1021) | `apps/web/src/app/[locale]/(app)/movements/[id]/edit/page.tsx` | The movement id is visible in the address bar and in browser history | Accepted: the id is an unguessable UUID, every read and write of it is owner-scoped on the server, and a foreign id only reaches the not-found state (threat R-01) |

## Summary

Total: 19 categories clean, 0 vulnerabilities open (0 critical, 0 high, 0 medium); 2 Info
documented, none blocking.

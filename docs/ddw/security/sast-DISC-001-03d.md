# SAST report DISC-001-03d: Tags and Filters

| Field | Value |
|---|---|
| Ticket | DISC-001-03d |
| Tier | FEATURE |
| Date | 2026-10-03 |
| Scope | `git diff f889df9...HEAD` over `apps/` and `packages/` without tests and e2e (38 source files): `packages/shared/src/movements/{tag,movement-filters,movement}.ts`; `apps/api/src/movements/**` (domain, application ports and use cases, `drizzle-movement-filters.ts`, `drizzle-movement-repository.ts`, `drizzle-tag-repository.ts`, `tags-schema.ts`, `schema.ts`, routes, presenter, barrel); `apps/api/src/server.ts`; migration `0017_tags` with its rollback, snapshot and journal; `apps/web/src/features/movements/**`, `apps/web/src/components/ui/badge.tsx`, `apps/web/src/lib/api-client.ts`, the movements page, catalogs; tests, fixtures and e2e scanned for secrets only |
| Method | Manual review of the diff by the orchestrator against catalog §4, targeted searches over the scope (secrets, raw SQL, dangerous functions, outbound calls, logging, HTML sinks, file access, cryptography), the threat model R-01 to R-10 as checklist, plus `pnpm audit --prod --audit-level high` on the final tree |
| Result | PASSED — 0 Critical, 0 High, 0 Medium open; 3 Info documented below |

## Findings by rule

- ✅ F-SAST-01 Hardcoded secrets (CWE-798): the secret-pattern search over the 38 source files returns nothing; the test database URLs appear only in tests and e2e support with the existing local credentials; no `.env` change.
- ✅ F-SAST-02 SQL injection (CWE-89): every statement is a Drizzle builder or a `sql` template whose interpolations are columns or bound parameters (`apps/api/src/movements/infrastructure/db/drizzle-movement-filters.ts:26,33`, `drizzle-movement-repository.ts:104-116` where tag names and the owner go through bound parameters and `sql.identifier` takes constants, `drizzle-tag-repository.ts:18-25` where the prefix is escaped for `\`, `%` and `_` and bound as one parameter); the only `sql.raw` calls take compile-time constants for check constraints (`apps/api/src/movements/infrastructure/db/schema.ts:32,38,39,86`, quoting escaped, never from input); migration 0017 and its rollback are static DDL.
- ✅ F-SAST-03 OS command injection (CWE-78): no `child_process`, `exec` or `spawn` in the scope.
- ✅ F-SAST-04 Insecure deserialization (CWE-502): request bodies and queries are parsed by Express and validated by shared Zod schemas (`apps/api/src/movements/infrastructure/http/movement-routes.ts:102,131`, `tag-routes.ts:32`); the filter state read from the URL is validated per key with the same shared schema (`apps/web/src/features/movements/movement-filters-state.ts`); no custom deserialization.
- ✅ F-SAST-05 Path traversal (CWE-22): no file access in `src` (the search for `readFile`, `writeFile` and `path.join` in the scope finds none).
- ✅ F-SAST-06 XSS (CWE-79): the web code renders tags, names and notes through React text nodes and shadcn components; no `dangerouslySetInnerHTML`, `innerHTML` or `document.write` in the scope (threat R-07).
- ✅ F-SAST-07 SSRF (CWE-918): no outbound request is added on the API; the web client builds `${baseUrl}${path}` from the configured API base and fixed paths (`apps/web/src/lib/api-client.ts:324`), with filter values encoded as query parameters.
- ✅ F-SAST-08 Broken cryptography (CWE-327): no cryptography added; no `Math.random` or hashing in the scope.
- ✅ F-SAST-09 Debug mode in production (CWE-489): no debug flag added; `apps/api/src/server.ts:40` only logs the port and environment, as before.
- ✅ F-SAST-10 Logging sensitive data (CWE-532): the audit line carries request id, user id and movement id only (`apps/api/src/movements/infrastructure/http/movement-routes.ts:116`), `tag-routes.ts` logs nothing, and tests assert that neither the body nor the log holds a tag, a prefix or a filter value for a 500 with a query-level error (threat R-08); no `console` in the web code.
- ✅ F-SAST-11 Unrestricted upload (CWE-434): no upload surface.
- ✅ F-SAST-12 Missing CSRF protection (CWE-352): `POST /movements` keeps `requireSession`, `requireVerifiedEmail` and the global origin guard; the new `GET /tags` and the filtered `GET /movements` are read-only and change no state.
- ✅ F-SAST-13 Critical/High CVE in a dependency: `pnpm audit --prod --audit-level high` on the final tree — "No known vulnerabilities found"; no `package.json` or lockfile change in this ticket.
- ✅ F-SAST-14 Incomplete input validation (CWE-20): params, query and body are validated by shared schemas through the one `validate` middleware (tags: at most 10 entries of 1 to 30 code points, NFC, no control or format characters; filters: UUIDs, real dates between 1970 and 2100 with `from` not after `to`, a movement type, a tag; suggestions: prefix 1 to 30 and limit 1 to 20; page at most 100); database checks mirror the ranges (`tags_name_length_check`, `movement_tags_position_check`, unique `(owner_id, lower(name))`); every tag, link and category subquery is scoped by owner (`drizzle-movement-filters.ts`, `drizzle-movement-repository.ts`) and the composite foreign keys forbid a cross-owner link (threat R-01).
- ✅ F-SAST-15 Insecure error handling (CWE-209): errors map to `{ code }` bodies through the one error middleware; a schema failure names field paths and never values (tested); a database failure answers 500 `{ code: 'INTERNAL' }`; a foreign account, category or tag filter answers 200 with an empty page byte-identical to a filter that matches nothing, which is the documented carve-out of the 404 rule for filter predicates (human decision Q3, threat R-02).
- ✅ F-SAST-16 Medium CVE in a dependency: none (`pnpm audit` clean).
- ✅ F-SAST-17 Unsafe function (CWE-95): no `eval`, `new Function` or `exec` in the scope; no new regular expression with nested quantifiers.
- ✅ F-SAST-18 Suppressions complete: no suppressions in this report.
- ✅ F-SAST-19 Suppressions within review window: no suppressions in this report.

## Cross-cutting checks

- Authorization and data scope: every statement on `movements`, `tags`, `movement_tags` and `categories` applies `scopedTo(scope, { owner })` on its own table in the same statement, including subqueries and the page tag loader; suggestions return only the caller's tag names.
- Abuse and availability: tag growth is bounded by 10 per movement and by the existing creation limit of 60 per minute; list pages stay capped at 100 and suggestions at 20; new composite indexes keep filtered lists measured under 500 ms at p95 with 100,000 movements (threat R-05, R-06).
- Integrity: composite foreign keys `(movement_id, owner_id)` and `(tag_id, owner_id)` keep links under one owner; a movement carries at most 10 links by a database check; the tag insert and the links run in the movement's transaction.
- Migration: `0017_tags` is additive (two tables, one unique constraint on `movements`, indexes); its rollback removes only tag data; the journal `when` 1790992572883 is greater than 0014's 1790966184307.
- Supply chain: no new dependency; the Badge component is owned source.

## Low and informational findings (W-SAST-01)

| ID | Severity | Location | Finding | Disposition |
|---|---|---|---|---|
| I-1 | Info (CWE-532) | `apps/api/src/movements/infrastructure/http/movement-routes.ts:81` | A limiter release failure logs the raw error object; a driver error can carry statement text | Accepted: unchanged from DISC-001-03b, the statement only touches the `movement_rate_limits` counters and the logger redacts sensitive keys |
| I-2 | Info (CWE-532) | `apps/api/src/shared/logging/logger.ts` | The error serializer masks the message of query and data-exception errors, but a non-driver error that embeds request values in its message would be logged as is | Accepted: existing behavior, no code path of this ticket builds such an error, and the query-level 500 test confirms no tag, prefix or date reaches the log |
| I-3 | Info (CWE-1021) | `apps/web/src/features/movements/components/movement-filters.tsx` | Filter values (tag names, ids) live in the address bar and browser history | Accepted: the existing referrer policy keeps the URL from other sites and history is the user's own device (threat R-10) |

## Summary

Total: 19 categories clean, 0 vulnerabilities open (0 critical, 0 high, 0 medium); 3 Info
documented, none blocking.
No known vulnerabilities found

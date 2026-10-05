# SAST report DISC-001-04a: Local Store, App Shell and Reference Cache

| Field | Value |
|---|---|
| Ticket | DISC-001-04a |
| Tier | FEATURE |
| Date | 2026-10-04 |
| Scope | `git diff origin/main...HEAD` over `apps/` and `packages/` without tests and e2e (35 source files): `packages/shared/src/movements/tag.ts`; `apps/api/src/movements/**` (`application/list-tags.ts`, `application/ports/tag-repository.ts`, `infrastructure/db/drizzle-tag-repository.ts`, `infrastructure/http/tag-routes.ts`); `apps/web/src/lib/local-store/**`, `apps/web/src/lib/service-worker/**`, `apps/web/src/app/sw.ts`, `apps/web/src/app/serwist/[path]/route.ts`, `apps/web/src/components/service-worker-registrar.tsx`, `apps/web/src/lib/{connectivity,content-security-policy,api-client}.ts`, `apps/web/next.config.ts`, the shell and movements containers and components, catalogs, `eslint.config.mjs`, `pnpm-workspace.yaml`; tests, e2e and the seeding helper scanned for secrets only. There is no migration. Dependencies added to `apps/web`: `@serwist/turbopack` 9.5.12, `serwist` 9.5.12, `esbuild` 0.28.2 (exact), dev `fake-indexeddb`; one override, `browserslist ^4.28.7`. |
| Method | Manual review of the diff by the orchestrator against catalog §4, targeted searches over the added lines (secrets, dangerous sinks, raw SQL, logging, outbound calls, cache and message handlers), the threat model R-01 to R-12 as checklist, plus `pnpm audit --prod --audit-level high` on the final tree |
| Result | PASSED — 0 Critical, 0 High, 0 Medium open; 3 Info documented below |

## Findings by rule

- ✅ F-SAST-01 Hardcoded secrets (CWE-798): the secret-pattern search over the added lines of the 35 source files returns nothing, `.env` is ignored by git and only `.env.example` is tracked; the throwaway passphrase of seeded e2e users lives in the existing support helper (see I-1); the local store keeps no credential, and the session pointer holds a user id and a boolean.
- ✅ F-SAST-02 SQL injection (CWE-89): the one new query is a Drizzle builder (`apps/api/src/movements/infrastructure/db/drizzle-tag-repository.ts:30`) with `limit` and `offset` as bound values and a constant `lower(...)` order expression; the owner scope is applied through `scopedTo`; the e2e seeding helper binds the email and the count as parameters and refuses a non-positive count.
- ✅ F-SAST-03 OS command injection (CWE-78): no `child_process`, `exec` or `spawn` in the scope.
- ✅ F-SAST-04 Insecure deserialization (CWE-502): the query of `GET /tags/all` is parsed by the shared Zod schema through the one `validate` middleware (`apps/api/src/movements/infrastructure/http/tag-routes.ts:48`); on the web, everything read back from IndexedDB is parsed with the shared schemas before use, and the worker parses a page's message instead of trusting it (`apps/web/src/lib/service-worker/shell-cache.ts:86`); no custom deserialization.
- ✅ F-SAST-05 Path traversal (CWE-22): no file access in `src`; the cache URLs of the worker message must be a single-slash same-origin path and are normalized through `URL` (`shell-cache.ts:86`), so a `//host` or backslash form is dropped.
- ✅ F-SAST-06 XSS (CWE-79): the storage warning and the offline notice are static catalog text in React nodes; the local copy is rendered through the same components as server data; no `dangerouslySetInnerHTML`, `innerHTML` or `document.write` in the scope.
- ✅ F-SAST-07 SSRF (CWE-918): no outbound request is added on the API; the worker fetches only same-origin URLs, because `acceptedCacheUrls` and the navigation handler reject any other origin (`apps/web/src/app/sw.ts:59-68`, `apps/web/src/lib/service-worker/cache-urls.ts:20`), and the API origin is never cached (threat R-05, R-10).
- ✅ F-SAST-08 Broken cryptography (CWE-327): no cryptography added; no `Math.random` or hashing in the scope.
- ✅ F-SAST-09 Debug mode in production (CWE-489): no debug flag added; the registrar only runs in a production build by default; no `console` call in the scope.
- ✅ F-SAST-10 Logging sensitive data (CWE-532): no logging added in the web code; `GET /tags/all` is covered by a route test that makes the repository fail and asserts that no tag name reaches the error body (threat R-11).
- ✅ F-SAST-11 Unrestricted upload (CWE-434): no upload surface.
- ✅ F-SAST-12 Missing CSRF protection (CWE-352): the only new API route is a safe `GET` behind `requireSession` and `requireVerifiedEmail`; the worker issues only `GET`s and never answers or caches a write (`shouldServeFromCache` requires `GET`).
- ✅ F-SAST-13 Critical/High CVE in a dependency: `pnpm audit --prod --audit-level high` on the final tree — "No known vulnerabilities found"; the two high advisories on `browserslist <=4.28.6` (GHSA-c83g-rgw3-j3cx, GHSA-73wf-gq98-2v4g), reached through the Serwist packages, are cleared by the override in `pnpm-workspace.yaml` (4.28.7 was published on 2026-07-21, so no release-age exclusion was needed).
- ✅ F-SAST-14 Incomplete input validation (CWE-20): `limit` is 1 to 100 with a default of 50 and `offset` is a non-negative integer, both coerced and bounded by the shared schema (`packages/shared/src/movements/tag.ts`); the worker message is validated by type and shape before any URL is fetched; the persistence request and the storage result are a closed set of three values.
- ✅ F-SAST-15 Insecure error handling (CWE-209): errors on `/tags/all` go through the one error middleware as `{ code }` bodies; every storage and worker failure on the web is swallowed into a defined fallback (`LocalStoreUnavailable`, `denied`, an empty 204 for framework prefetches) with no internal text shown to the user.
- ✅ F-SAST-16 Medium CVE in a dependency: none (`pnpm audit` clean at the `high` level and the override above also covers the moderate range of the same package).
- ✅ F-SAST-17 Unsafe function (CWE-95): no `eval`, `new Function` or `exec` in the scope; the worker is built from our own source with `esbuild` and loads no remote script (`worker-src 'self'`, `apps/web/src/lib/content-security-policy.ts:23`).
- ✅ F-SAST-18 Suppressions complete: no suppressions in this report.
- ✅ F-SAST-19 Suppressions within review window: no suppressions in this report.

## Cross-cutting checks

- Authorization and data scope: `GET /tags/all` counts and lists only the owner's tags through the same scope as the existing suggestions route; another user's tags never appear (repository and route tests, threat R-01). The device copy is keyed per user (`pesly-<userId>`), so a second account on the same browser opens its own database and not the first one's (threat R-03). Wiping the copy on a confirmed sign-out is not part of this ticket: the threat model assigns it to DISC-001-04d, and until then the copy stays on the device after sign-out (see I-2).
- Cache boundaries: the worker keeps only the hashed build assets and same-origin HTML documents that answered 200 without a redirect; the API origin, redirects, opaque and cross-origin responses are never stored (`isCacheableDocument`, `shell-cache.ts:58`), and `skipWaiting` is off so a stale worker cannot take over mid-session (threat R-05, R-06).
- Scope of the worker: `Service-Worker-Allowed: /` is sent only for `/serwist/*` (`apps/web/next.config.ts:29`), with `no-cache` so a new version is noticed.
- Eviction: persistent storage is requested and a refusal is shown to the user; the warning renders after the content so it cannot shift the screen (threat R-09).
- Abuse and availability: `GET /tags/all` is bounded at 100 rows per call and is a single indexed owner read; the worker work is bounded by the two warm-up URLs (threat R-02, R-10).
- Migration: none; reverting the commits restores the previous behavior, and a leftover worker is replaced by the next load.
- Supply chain: three runtime dependencies added to `apps/web` (`@serwist/turbopack`, `serwist`, `esbuild`), each justified in the spec; `esbuild` is pinned exactly, Serwist is pinned to 9.5.12 because 9.5.13 sits inside the release-age window, and no `minimumReleaseAgeExclude` entry was added.

## Low and informational findings (W-SAST-01)

| ID | Severity | Location | Finding | Disposition |
|---|---|---|---|---|
| I-1 | Info (CWE-798) | `apps/web/e2e/support/accounts.ts:6` | A literal passphrase for the throwaway users the e2e flows register | Accepted: the existing helper, reused by the new offline spec; it protects no real account and never reaches production code |
| I-2 | Info (CWE-922) | `apps/web/src/lib/local-store/stores.ts` | The reference copy and the 100 recent movements sit unencrypted in IndexedDB on the device | Accepted in threat R-04 (accepted risk with its approval recorded there): the copy is limited to active reference data and 100 movements, the browser sandbox protects the origin's storage, and encrypting at rest with a key kept on the same device would add no protection. It is NOT wiped on sign-out yet; that wipe belongs to DISC-001-04d (threat R-03) and must be in place before 04 ships |
| I-3 | Info (CWE-1021) | `apps/web/src/lib/local-store/session-pointer.ts:4` | `localStorage` keeps `pesly.session` with a user id and a verified flag | Accepted: the pointer grants nothing, the API still demands a valid session for every request, and a tampered pointer only opens an empty or the user's own local copy |

## Summary

Total: 19 categories clean, 0 vulnerabilities open (0 critical, 0 high, 0 medium); 3 Info
documented, none blocking.

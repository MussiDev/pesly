# SAST report DISC-001-07b: Crypto Prices and Daily Portfolio Snapshots

| Field | Value |
|-------|-------|
| Ticket | DISC-001-07b |
| Tier | FEATURE |
| Date | 2026-10-03 |
| Scope | `git diff --ignore-cr-at-eol origin/main...HEAD` outside docs, tests and e2e: `apps/api/src/investments/**` (domain `crypto-price.ts`, `snapshot-date.ts`, `price-failure.ts`; use cases and ports; Drizzle repositories; routes; serializers; jobs; provider adapters; `jobs.ts`; module wiring), `apps/api/src/shared/config/env.ts`, `apps/api/src/worker.ts`, migration `apps/api/drizzle/0015_price_snapshots.sql` and its rollback, `.railway/railway.ts`, `.env.example`, `playwright.config.ts` (the added line only), `packages/shared/src/investments/**`, `apps/web/src/features/investments/**`, `apps/web/src/lib/api-client.ts`, the es/en catalogs; tests, fixtures and e2e read for secrets only |
| Method | Manual review by `ddw-sec-auditor` against catalog §4 plus pattern scans, `pnpm audit --prod --audit-level high` and `pnpm audit` (both: "No known vulnerabilities found"; this ticket adds no dependency) |
| Result | PASSED — 0 Critical, 0 High, 1 Medium suppressed (M-1, accepted risk), 3 Low and 3 Info documented below |

## Findings by rule

- ✅ F-SAST-01 Hardcoded secrets (CWE-798): `.env.example:35` holds an empty `COINGECKO_API_KEY=`; `.railway/railway.ts` declares the key with `preserve()` on the worker service only; the only `playwright.config.ts` change is `PRICE_PROVIDER: 'fake'` (its existing fixture secrets predate the ticket and are `e2e-` test values); no key, DSN or token under `src`.
- ✅ F-SAST-02 SQL injection (CWE-89): every `sql` template binds its inputs as parameters (`apps/api/src/investments/infrastructure/db/drizzle-crypto-price-repository.ts` VALUES and IN lists, `${limit}::int`, the ticker pattern; `drizzle-holding-repository.ts` price guard `lower(...) = ${guard.ticker}`); `sql.raw` appears only for compile-time constants in `schema.ts:45`, `:50`, `:70`, `:108`, `:112`, `:214`; migration `apps/api/drizzle/0015_price_snapshots.sql:1` is static DDL; a test stores an injection-shaped ticker as data.
- ✅ F-SAST-03 OS command injection (CWE-78): no `child_process`, `exec` or `spawn` in the scope.
- ✅ F-SAST-04 Insecure deserialization (CWE-502): the `JSON.parse` reviver of the provider answer only records number source text keyed by holder object (`apps/api/src/investments/infrastructure/provider/coingecko-payload.ts:41`); a missing source fails closed to `provider_invalid_payload` (`:93`); nested prices are never read; prices go through `BigInt` from digits only, with text length, exponent and shift bounds (`apps/api/src/investments/domain/crypto-price.ts:34`); no `eval`.
- ✅ F-SAST-05 Path traversal (CWE-22): the new route takes a UUID param (`packages/shared/src/investments/contracts.ts` holding id params) and the client uses `encodeURIComponent` (`apps/web/src/lib/api-client.ts`); no filesystem access.
- ✅ F-SAST-06 XSS (CWE-79): no `dangerouslySetInnerHTML`, `innerHTML` or `document.write`; the warning is built from catalog messages and locale-formatted numbers (`apps/web/src/features/investments/components/holding-row.tsx`).
- ✅ F-SAST-07 SSRF (CWE-918): the only outbound request is the CoinGecko adapter; the base URL is pinned to the default in production (`apps/api/src/shared/config/env.ts:166`), redirects are not followed (`redirect: 'manual'`, `coingecko-price-provider.ts:85`), the key goes only in a header, symbols are filtered to `[a-z0-9._-]` and URL-encoded (`:73`), the body is capped at 512 KiB while streaming, the content type must be JSON and the call has a 10 second timeout; the API process never imports the adapter (tested by `request-path.test.ts`).
- ✅ F-SAST-08 Broken cryptography (CWE-327): no new cryptography; `random()` only orders symbol selection (`drizzle-crypto-price-repository.ts:38`).
- ✅ F-SAST-09 Debug mode in production (CWE-489): no debug switch; production rejects `PRICE_PROVIDER=fake` and a non-default base URL (`apps/api/src/shared/config/env.ts:166`).
- ✅ F-SAST-10 Logging sensitive data (CWE-532): job and worker logs carry outcomes, codes, counts, zone, date and portfolio ids only (`apps/api/src/investments/infrastructure/jobs/price-sync-job.ts`, `snapshot-job.ts`), the worker logs only whether a key is set (`apps/api/src/worker.ts`), the adapter never logs or stores the key or the body (a test asserts it with sentinel values), the route log carries ids only (`apps/api/src/investments/infrastructure/http/holding-routes.ts:158`).
- ✅ F-SAST-11 Unrestricted upload (CWE-434): not applicable; no upload in this ticket.
- ✅ F-SAST-12 Missing CSRF protection (CWE-352): the new `POST /investments/holdings/:holdingId/automatic-price` sits under the global origin guard (`apps/api/src/app.ts:127`) on top of SameSite=Strict cookies; the client sends `X-Requested-With`.
- ✅ F-SAST-13 Critical/High CVE in a dependency: `pnpm audit --prod --audit-level high` and `pnpm audit` report no known vulnerabilities; `package.json` and `pnpm-lock.yaml` are untouched by this ticket.
- ⚠️ F-SAST-14 Incomplete input validation (CWE-20): every route and setting is validated (the new route takes only a UUID param and has a response schema, `holding-routes.ts:153`; `PRICE_PROVIDER` is an enum; the API key is a trimmed visible-ASCII token of at most 255 characters, `env.ts:56`), but the number of crypto holdings a user may create is not bounded, which lets junk tickers delay the first price of newly added real tickers (M-1, suppressed below, `apps/api/src/investments/infrastructure/db/drizzle-crypto-price-repository.ts:16`).
- ✅ F-SAST-15 Insecure error handling (CWE-209): the switch rejection carries only the field name `body.marketPrice` (`apps/api/src/investments/application/holding-use-cases.ts:151`); a foreign or missing holding answers the same 404; the failure log stores a fixed code, a status 100 to 599 and a detail of at most 200 characters written by our own code, with NUL removed (`drizzle-price-failure-log.ts:28`).
- ✅ F-SAST-16 Medium CVE in a dependency: none; `pnpm audit` is clean at every severity.
- ✅ F-SAST-17 Unsafe function (CWE-95): no `eval`, `new Function` or unsafe regular expressions; the price and content-type patterns are anchored and linear (`crypto-price.ts:10`).
- ✅ F-SAST-18 Suppressions complete: the one suppression below carries all seven fields.
- ✅ F-SAST-19 Suppressions within review window: the suppression is dated 2026-10-03 with a review date of 2026-12-03.

## Suppression and Medium finding

### Suppression: M-1

| Field | Value |
|---|---|
| File | `apps/api/src/investments/infrastructure/db/drizzle-crypto-price-repository.ts:16` |
| Category | F-SAST-14 Incomplete input validation (unbounded number of crypto holdings per user; availability) |
| Disposition | ACCEPTED_RISK |
| Reviewer | Joako (project owner): accepted risk R-12 of DISC-001-07a (no caps on portfolios and holdings, decision of 2026-10-01), re-confirmed for this specific consequence on 2026-10-03 (decision relayed by the coordinator) |
| Date | 2026-10-03 |
| Justification | Any signed-in user can add many crypto holdings with tickers the provider never answers, so a newly added real ticker waits about N/50 hours for its first price (N is the number of never-priced symbols) and the hourly selection scans every crypto holding. Nothing is lost or exposed: existing prices keep refreshing and no other user's data is touched. |
| Compensating control | `symbolsToPrice` reserves at least half of each request for the oldest priced symbols and draws the never-priced ones at random, so junk tickers cannot stop existing prices from refreshing and every real ticker is eventually tried; a request carries at most 100 symbols and the monthly counter caps provider calls at 1,000. |
| Review by | 2026-12-03 (a follow-up ticket should add a per-user holdings cap or a symbol attempts table ordered by last attempt) |

## Authorization and data integrity review

The new route uses the investments session and write scope; `findById` and the guarded `setPrice` both go through the owner scope, so another user's holding answers 404, and the price write is also guarded on instrument type and ticker so a concurrent edit cannot land the price on a different holding (`apps/api/src/investments/infrastructure/db/drizzle-holding-repository.ts`). The cross-owner worker repositories (`drizzle-crypto-price-repository.ts`, `drizzle-snapshot-repository.ts`, `drizzle-price-schedule.ts`, `drizzle-price-failure-log.ts`) are exported only through `apps/api/src/investments/jobs.ts`, which the API process never imports (`apps/api/test/investments/request-path.test.ts`); the API reads market prices through the read-only `DrizzleMarketPriceReader` over a table that holds public data and no user columns. The composite foreign key `(portfolio_id, owner_id)` to `portfolios(id, owner_id)` stops a snapshot under another owner, check constraints bound prices (1 to 10^12), totals (non-negative), the call counter (0 to 1,000) and the failure detail, inserts are idempotent, and the lease claim and the monthly reservation are single atomic statements. The rollback script header states that it destroys the five tables (`apps/api/drizzle/rollback/0015_price_snapshots.down.sql:1`).

## Low and informational findings (W-SAST-01)

| ID | Severity | Location | Finding | Disposition |
|---|---|---|---|---|
| L-1 | Low | `apps/api/src/investments/infrastructure/db/drizzle-crypto-price-repository.ts:34` | A symbol priced once and later no longer answered (delisted, or older than 24 hours) keeps its old market time and stays at the head of the oldest-first group; more than 50 of them would stop the rest of that group refreshing | Accepted: only real provider symbols reach this state; the follow-up of M-1 (attempts table) fixes it |
| L-2 | Low | `apps/api/src/investments/application/holding-use-cases.ts:149` | The switch to the automatic price does not compare the holding's current price time with the market price time, so a newer automatic price applied by the worker between the read and the write can be overwritten by the stored one until the next hourly refresh | Accepted: the value self-heals within the hour; own data only |
| L-3 | Low | `apps/api/src/app.ts` | No rate limit on the new route, like its sibling investments routes | Accepted risk R-12 of DISC-001-07a (human decision, 2026-10-01); the route costs one indexed read and one update |
| I-1 | Info | `apps/api/src/investments/infrastructure/provider/coingecko-payload.ts:63` | Prices are keyed by ticker symbol and an unranked clone can price a ticker with no ranked coin; one request with `per_page=250` has no paging | Accepted risk R-16 of the threat model (owner decision, 2026-10-02); the manual-price rule and the 5% warning mitigate it |
| I-2 | Info | `apps/api/src/shared/config/env.ts:88` | Outside production `COINGECKO_BASE_URL` accepts any valid URL, including http, for local fake servers; the API process also parses `COINGECKO_API_KEY` although only the worker service receives it | Accepted: production pins the URL; the key is declared on the worker service only |
| I-3 | Info | `apps/api/drizzle/rollback/0015_price_snapshots.down.sql:1` | The rollback is destructive and documented | None |

## Summary

Total: 18 categories clean and 1 (F-SAST-14) with one Medium finding suppressed as an accepted risk, 0 vulnerabilities open (0 critical, 0 high, 0 medium open); 3 Low and 3 Info documented. Medium M-1 is an accepted risk confirmed by the owner on 2026-10-03, with a review date of 2026-12-03.

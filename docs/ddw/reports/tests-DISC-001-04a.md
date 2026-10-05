# Test run DISC-001-04a

| Field | Value |
|---|---|
| Runner | vitest 5.0.1 (V8 coverage via @vitest/coverage-v8 5.0.1) |
| Command | `TEST_DATABASE_URL=postgres://argent:argent@localhost:5435/pesly04a_cov_test pnpm exec vitest run --coverage --maxWorkers=2` |
| Total | 4992 |
| Passed | 4992 |
| Failed | 0 |
| Skipped | 0 |
| Line coverage | 96.82% |
| Branch coverage | 92.23% |
| Function coverage | 94.75% |
| Coverage floor | 80% lines, branches and functions (AGENTS.md, "Testing") |
| Lint | `pnpm exec eslint .` — clean, 0 findings; `pnpm exec prettier --check --end-of-line auto .` — clean for the files of the ticket; `pnpm typecheck` — clean (both web tsconfigs) |

## Scope

Closeout run of the ticket on branch `feat/DISC-001-04a-local-store-app-shell`. Measured over `apps/api/src`, `apps/web/src` and `packages/shared/src` together, as AGENTS.md requires: 268 test files, 4992 tests, 1252 s. The ticket adds no migration.

Other suites run on the same tree:

- `E2E_PRODUCTION_BUILD=1 pnpm e2e` (Playwright, production build, fresh `_e2e` database on the shared PostgreSQL and Mailpit, ports 3000, 4000 and 4100 free): 103 tests, 102 passed and 1 failed on the first full run. The failure was `design-system.spec.ts` "the movements page shifts at most 0.1 in light" (0.163): the storage warning of Block 10 arrived after `persist()` resolved and pushed the content down. The warning now renders after the content; the layout-shift file then passed 24/24 with `--repeat-each=4`. The full suite was not run a second time.
- `apps/web/e2e/offline.spec.ts` (new): 4/4 passed on the production build (NFR-01 under 4x CPU throttle, NFR-02, AC-02, AC-04, AC-06). Run without a production build it fails fast naming `E2E_PRODUCTION_BUILD`, by design.
- `pnpm audit --prod --audit-level high`: no known vulnerabilities, after the `browserslist >=4.28.7` override (two high advisories reached through the Serwist packages).
- `pnpm test:perf` was not run: the ticket adds one cheap read (`GET /tags/all`, indexed by owner) and no change to the list, create or accounts queries the benchmarks measure.

Deviations from the spec, for the record:

- Serwist is pinned to 9.5.12, not 9.5.13: the newer release was inside the release-age window and no exclusion was added.
- The worker and registrar are our own (`runtimeCaching: []`, a custom navigation handler) instead of `defaultCache` and `SerwistProvider`, so no cross-origin response can be cached. The warm-up message type is `PESLY_CACHE_URLS`.
- Extra files: `device-copy.ts`, `warmup.ts`, `cache-urls.ts`, `tsconfig.sw.json`, `service-worker-registrar.tsx`, and an ESLint override for `sw.ts`.
- Block 6: `listAllTags` failing on the network with no copy keeps the existing `errors.network` message. Block 7: the shell also falls back to the pointer on a network failure.
- Block 10: `persistence.ts` was written before its unit test was seen failing; the shell tests were seen failing first.
- Block 11 found that Next's `?_rsc=` prefetches fail without a connection; the worker now answers same-origin `_rsc` reads with an empty 204 (`isFrameworkFetch`, with tests). Chromium does not propagate `setOffline` to the worker's `navigator.onLine`, so the worker also answers 204 when such a fetch fails online. The e2e failure tracker ignores `net::ERR_ABORTED`, a request the page cancels itself.
- No subagents were used (a standing instruction of the user).

## Failures

(none)

## Skips

(none)

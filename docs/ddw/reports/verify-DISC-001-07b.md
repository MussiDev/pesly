# Verification DISC-001-07b

| Field | Value |
|---|---|
| Module | `apps/api/src/investments/**` (price domain, ports and use cases, Drizzle repositories, CoinGecko adapter and fake, jobs, worker wiring, holding routes), `packages/shared/src/investments/**`, `apps/web/src/features/investments/**`, `apps/web/src/lib/api-client.ts`, migration `0015_price_snapshots` |
| Line coverage | 97.34% |
| Branch coverage | 92.91% |
| Function coverage | 95.04% |
| Coverage floor | 80% lines, branches and functions (AGENTS.md, "Testing") |
| Lint | `pnpm exec eslint .` — clean, 0 findings; `pnpm typecheck` — clean; `pnpm exec prettier --check --end-of-line auto .` — 0 findings in this ticket's files, 1 in `apps/web/test/movements-containers.test.tsx`, identical to `origin/main` and already failing there |

Run (round 2, on the branch rebased onto `origin/main` 40c8b09): vitest 5.0.1 with V8 coverage over
`apps/api/src`, `apps/web/src` and `packages/shared/src`, 4274 tests passed, 0 failed, 0 skipped
(233 files), report `docs/ddw/reports/tests-DISC-001-07b.md`; Playwright 90/90; perf 8/8; SAST `docs/ddw/security/sast-DISC-001-07b.md`
(0 Critical, 0 High, one Medium accepted by the owner). Coverage of the new and modified files: every new
application, domain and route file is at or above 95% lines; the lowest branch figures are
`drizzle-crypto-price-repository.ts` (70%, two `rowCount ?? 0` fallbacks), `drizzle-snapshot-repository.ts`
(83.3%) and `coingecko-price-provider.ts` (85%); `schema.ts` (45% lines) and `worker.ts` (0%, exercised only
by e2e and source-text assertions) were already below the figure before this ticket and the floor is global.
The cross-verification was done by `ddw-module-verifier`, an agent that did not write the code; the numbers
are this session's account of the runs above.

## Acceptance criteria
- ✅ AC-01 — `refresh-crypto-prices.test.ts` "prices every crypto holding of the answered symbols without a manual price and leaves other types alone"; `price-repositories.test.ts` "stores one market price per symbol and prices only crypto USD holdings"; `price-sync-job.test.ts` AC-01 pass; implemented in `refresh-crypto-prices.ts:RefreshCryptoPrices.execute` and `drizzle-crypto-price-repository.ts:storeAndApply`
- ✅ AC-02 — `refresh-crypto-prices.test.ts` the provider fault test (previous prices untouched, retry backs off 15 then 30 minutes) and "a symbol missing from the answer and a sub-cent price keep the previous price"; `price-sync-job.test.ts` AC-02
- ✅ AC-03 — `take-daily-snapshots.test.ts` "snapshots each user for their own previous local day at different instants, with the shared helper totals"; `snapshot-job.test.ts` AC-03 two zones; `snapshot-repository.test.ts` one set of rows when saving twice
- ✅ AC-04 — `take-daily-snapshots.test.ts` "a total above 9,223,372,036,854,775,807 minor units is skipped and counted while the others are saved"; `snapshot-job.test.ts` AC-04 logged once and the pass continues
- ✅ AC-05 — `refresh-crypto-prices.test.ts` "keeps a manual price of 60,000.00 USD and its source"; `price-repositories.test.ts` "keeps the price, source and time of a manual holding while the market price is stored (AC-05)"; `price-sync-integration.test.ts` manual holding keeps its price
- ✅ AC-06 — `price-repositories.test.ts` "keeps a manual price committed while the apply statement waits on the row lock" (two real connections)
- ✅ AC-07 — `valuation.test.ts` "is true when the market price is 6.67% above or below"; `portfolio-view.test.ts` AC-07 and AC-08 warns with its date; `holding-routes.test.ts` shows the stored market price and the warning; web `holding-row.test.tsx` "AC-07: a recent market price says today"; e2e step 07b AC-07
- ✅ AC-08 — `portfolio-view.test.ts` "warns when the market price is 6.67% below the manual one"; web `holding-row.test.tsx` "AC-08" in Spanish and with a USD price
- ✅ AC-09 — `valuation.test.ts` "is false at exactly 5% above or below"; `portfolio-view.test.ts` "does not warn at exactly 5% above or below"; web `holding-row.test.tsx` "AC-09: shows no warning and no button"
- ✅ AC-10 — `portfolio-view.test.ts` automatic and import prices never warn; web `holding-row.test.tsx` "AC-10: shows no warning and no button for an automatic price"
- ✅ AC-11 — `portfolio-view.test.ts` recent at exactly 24 hours, not recent 24 hours and one second ago and still warning, 2 days and 30 days; `holding-routes.test.ts` keeps the warning for a market price a month old; web `holding-row.test.tsx` "AC-11: an older market price says on <date> in the user time zone and never today"
- ✅ AC-12 — `holding-use-cases.test.ts` "sets the market price, source automatic and the market time, and the warning disappears (AC-12)"; `holding-routes.test.ts` POST automatic-price answers 200 with the switched holding; web `api-client-investments.test.ts`, `investments-container.test.tsx` "AC-12: pressing the button switches the holding"; e2e step 07b AC-12
- ✅ AC-13 — `holding-use-cases.test.ts` rejects a stock and a crypto holding without a stored market price; `holding-routes.test.ts` two 400 tests with `body.marketPrice` that re-read the holding; web container 404 and 400 cases
- ✅ AC-14 — `holding-use-cases.test.ts` "answers not found for another owner or an unknown id"; `holding-routes.test.ts` "answers 404 for the holding of user B and for an unknown id, and changes nothing"
- ✅ AC-15 — `worker-env.test.ts` and `env.test.ts` "accepts a missing, empty or blank key in production so the worker starts without one"; `investments-jobs.test.ts` "the composition built with no API key starts and completes a pass (AC-15)"; `coingecko-price-provider.test.ts` "sends no key header when no key is configured"
- ✅ AC-16 — `portfolio-view.test.ts` 30 day case; `holding-routes.test.ts` keeps the warning for a market price a month old; `price-sync-integration.test.ts` "flags a manual price against a 30 day old market price"; web `holding-row.test.tsx` "AC-16: a 30 day old market price still warns with its date"

Requirements: FR-01 (AC-01, AC-02), FR-02 (AC-03, AC-04), FR-03 (AC-05, `market-price-reader.test.ts`), FR-04 (AC-05, AC-06),
FR-05 (AC-07 to AC-11, AC-16), FR-06 (AC-12 to AC-14), NFR-01 (`refresh-crypto-prices.test.ts` "over 45 simulated days
... never exceed 1,000", `price-schedule.test.ts` two simultaneous reservations at 999, `price-sync-integration.test.ts`
month test), NFR-02 (AC-15). No test asserts only a status code.

## Spec blocks
- ✅ Block 1 — domain: `crypto-price.ts`, `snapshot-date.ts`, `price-failure.ts`; `crypto-price.test.ts`, `snapshot-date.test.ts`, `no-float-money.test.ts` all present and passing
- ✅ Block 2 — application ports and use cases; `refresh-crypto-prices.test.ts`, `take-daily-snapshots.test.ts` all present and passing
- ✅ Block 3 — persistence and migration `0015_price_snapshots` (journal `when` 1790980568164, above `0014_movements`); `price-repositories.test.ts`, `market-price-reader.test.ts`, `price-schedule.test.ts`, `snapshot-repository.test.ts`, `price-migration.test.ts`, erasure registry and migration regression tests present and passing
- ✅ Block 4 — CoinGecko adapter, fake provider, worker settings, Railway declaration; `coingecko-price-provider.test.ts`, `coingecko-payload.test.ts`, `fake-price-provider.test.ts`, `worker-env.test.ts`, `env.test.ts`, `railway-iac.test.ts` present and passing
- ✅ Block 5 — jobs and worker wiring; `price-sync-job.test.ts`, `snapshot-job.test.ts`, `investments-jobs.test.ts`, `request-path.test.ts` present and passing
- ✅ Block 6 — market price in the holding response and the switch route; `valuation.test.ts`, `portfolio-view.test.ts`, `contracts.test.ts`, `holding-use-cases.test.ts`, `portfolio-use-cases.test.ts`, `holding-routes.test.ts`, `portfolio-routes.test.ts` present and passing
- ✅ Block 7 — web warning and switch; `holding-row.test.tsx`, `api-client-investments.test.ts`, `investments-container.test.tsx`, `portfolio-card.test.tsx`, `i18n-catalogs.test.ts` present and passing
- ✅ Block 8 — `price-sync-integration.test.ts`, the investments e2e steps and the no-float probe present and passing

Deliberate deviations from the spec text, all recorded in the commits and the TDD report: the migration number
is 0015 after the rebase; the client method is `setHoldingAutomaticPrice`; the schedule port has an extra
`deferred()`; the snapshot result carries extra `outOfRange` and `invalidZones` fields for logging; the price
write takes an optional guard on instrument type and ticker; a storage error after a reserved call backs off
before propagating; `symbolsToPrice` selects half oldest-priced and half random never-priced symbols.

## Tests
- ✅ Sad-path tests: the new route (`holding-routes.test.ts` 400 with `body.marketPrice`, 404, 401, 403, 500), the settings (`env.test.ts`, `worker-env.test.ts`), the adapter (429, 500, redirect, refused connection, slow server, HTML, malformed JSON, non-array body, body over 512 KiB), the payload parser, `usdPriceToMinorUnits` (13 invalid texts return null), the date helpers (unknown zone, malformed date), the jobs (storage error, failed purge, double stop) and the repositories (check constraints, composite foreign key) each have invalid-input tests
- ✅ Lint and type checker: `pnpm typecheck`, `pnpm exec eslint .` and `pnpm exec prettier --check --end-of-line auto .` pass with no findings

## Warnings
- ⚠️ W-VER-01 dead code: a few exports are used only inside their own file (`marketSymbolsOf`, `MarketPrices`, `OutOfRangeSnapshot`, the `*Dependencies` interfaces, `InvestmentsJobs`) and `take-daily-snapshots.ts:66` (`rows.length === 0`) is effectively unreachable; none blocks
- ⚠️ W-VER-02 business logic between 80 and 90%: `take-daily-snapshots.ts` has 89.47% branches (the untested rethrow of a non-RangeError at line 44 and the unreachable line 66); every other domain and application file is at 94.7% or above
- ⚠️ W-VER-03 fragile tests: `price-repositories.test.ts` "eventually draws every never priced symbol" is probabilistic (about 2^-37 failure chance, unseeded `random()`); `waitForLockWaiter` assumes serial test files; the job tests use real 5 to 60 ms timers; the investments e2e depends on the worker's 30 second poll (90 second wait, 180 second test timeout) and on the fake BTC constant staying in sync with `fake-price-provider.ts`; the worker log-line tests read the source of `worker.ts`
- ⚠️ Test and document defects found by the cross-verification, none a requirement failure: the provider test "declared or chunked" never sends a Content-Length, so the declared-length branch of `coingecko-price-provider.ts` is uncovered (the streaming cap still enforces the limit); the SAST report cites line numbers that no longer match the files (the findings are correct); the spec (Block 3) and the threat model describe the old never-priced-first ordering of `symbolsToPrice` that the SAST-driven fix replaced (the TDD report and the tests document the new behaviour); web test titles reuse "AC-11" and "AC-12" from 07a in a separate `describe`
- ⚠️ TDD evidence: red runs of several blocks were import failures with no test running (said in the report); Block 6 kept no assertion text for three files; Block 8's integration tests and e2e steps passed on the first behavioural run and are backed by a six-row mutation table instead; the cross-verification found every named test on disk with assertions that can fail
- ✅ Branch behind main: resolved in round 2 (see below); the branch is 0 commits behind `origin/main` 40c8b09

## Round 2 (corrective loop after the first verdict)

Round 1 passed with the warnings above. Before closeout the owner approved the push and a draft PR, which
needed the branch rebased onto the current `origin/main` and the stale documents corrected, so the ticket went
back through CODE and PLAN and came here again:
- Rebase onto `origin/main` 40c8b09: one conflict, in `apps/web/src/features/investments/components/holding-row.tsx`,
  resolved by keeping FEAT-004's restyled row and adding the 07b warning in its type scale (`text-small`); the
  migration is still `0015_price_snapshots`, journal `when` 1790980568164, above `0014_movements` (1790966184307),
  snapshot `prevId` chained to the 0014 snapshot, `drizzle-kit generate` reports no changes.
- Re-run on the rebased tree: 4274 unit and integration tests passed, 97.34% lines, 92.91% branches and 95.04%
  functions; Playwright 90/90; perf 8/8; typecheck and eslint clean.
- The SAST report file and line references were corrected against the current files and the report was
  re-validated; the spec (Block 3 symbol read and its test line) and the threat model (the denial of service
  entry, new risk R-20 and its acceptance) now describe the fair symbol selection; both re-validated.
- The remaining warnings (dead exports, the 89.47% branch figure of `take-daily-snapshots.ts`, the fragile tests
  listed above, the undeclared Content-Length test, and the TDD evidence notes) are unchanged and do not block.

Result: PASSED

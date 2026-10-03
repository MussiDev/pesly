# Test run DISC-001-07b

| Field | Value |
|---|---|
| Runner | vitest 5.0.1 (V8 coverage via @vitest/coverage-v8 5.0.1) |
| Command | `TEST_DATABASE_URL=postgres://argent:argent@localhost:5435/argent07b_test pnpm test:coverage` |
| Total | 3674 |
| Passed | 3674 |
| Failed | 0 |
| Skipped | 0 |
| Line coverage | 97.21% |
| Branch coverage | 92.71% |
| Function coverage | 94.85% |
| Coverage floor | 80% lines, branches and functions (AGENTS.md, "Testing") |
| Lint | `pnpm exec eslint .` and `pnpm exec prettier --check --end-of-line auto .` — clean, 0 findings; `pnpm typecheck` — clean |

## Scope

Coverage is measured over `apps/api/src`, `apps/web/src` and `packages/shared/src` together, as AGENTS.md
requires (218 test files). The run is on the branch `feat/DISC-001-07b-prices-snapshots`, rebased on
`origin/main` f889df9 (0 commits behind at the time of the run), after all 8 blocks, the review
correction rounds and the fix for the crypto symbol selection (commit `2e3afc8`) were committed. An
earlier run of this report (3669 tests) and a first run of the same tree that was invalidated when the
Postgres container restarted in the middle of it (1 failure "terminating connection due to
administrator command" and 457 skipped tests, an environment interruption, not a code failure) were
superseded by this one. The Prettier check uses `--end-of-line auto` because this Windows checkout
reports CRLF on every file otherwise; the content check is the same.

Other suites on the same tree:
- `pnpm e2e` (Playwright) with
  `E2E_DATABASE_URL=postgres://argent:argent@localhost:5435/argent07bfinal_e2e`, Mailpit and the fake
  OIDC server: 76/76 passed (3.5 minutes), taken just before the symbol selection fix; after the fix
  `apps/web/e2e/investments.spec.ts` was run again alone on a fresh database
  (`argent07bfinal2_e2e`) and passed 1/1 (37.4 s), including the three steps added by this ticket (automatic
  price from the worker on the fake provider, manual price warning with the "today" wording, switch back to
  the automatic price with the status notice and no API response of 400 or above).
- `pnpm test:perf`: 7 files and 8 tests passed, including the 07a portfolio benchmark extended with
  crypto holdings and stored market prices so the new one-query market lookup is exercised
  (NFR-03 of 07a: p95 well under the 500 ms budget).
- No test calls CoinGecko, Google, a broker or any other real external service: the provider tests use
  a local `127.0.0.1` test server and the fake provider.

Migration `0015_price_snapshots`: journal `idx` 15, journal `when` 1790980568164, which is greater
than every other `when` in the journal, including `0014_movements` (1790966184307) of main; its snapshot
`prevId` equals the id of the `0014_movements` snapshot (13f2933c-b982-4258-972b-89c6b8fb27f4);
`drizzle-kit generate` reports no changes.

## Failures
(none)

## Skips
(none)

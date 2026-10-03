# Test run DISC-001-07b

| Field | Value |
|---|---|
| Runner | vitest 5.0.1 (V8 coverage via @vitest/coverage-v8 5.0.1) |
| Command | `TEST_DATABASE_URL=postgres://argent:argent@localhost:5435/argent07b_test pnpm test:coverage` |
| Total | 4274 |
| Passed | 4274 |
| Failed | 0 |
| Skipped | 0 |
| Line coverage | 97.34% |
| Branch coverage | 92.91% |
| Function coverage | 95.04% |
| Coverage floor | 80% lines, branches and functions (AGENTS.md, "Testing") |
| Lint | `pnpm exec eslint .` — clean, 0 findings; `pnpm typecheck` — clean; `pnpm exec prettier --check --end-of-line auto .` — 0 findings in this ticket's files, 1 in `apps/web/test/movements-containers.test.tsx`, a file that is identical to `origin/main` and already fails the check there (untouched here, to be fixed by its own ticket) |

## Scope

Coverage is measured over `apps/api/src`, `apps/web/src` and `packages/shared/src` together, as AGENTS.md
requires (233 test files). The run is on the branch `feat/DISC-001-07b-prices-snapshots` rebased on
`origin/main` 40c8b09 (0 commits behind at the time of the run, 19 commits ahead), after all 8 blocks, the
review correction rounds, the fix for the crypto symbol selection (commit `2e3afc8`) and the resolution of the
only rebase conflict (`apps/web/src/features/investments/components/holding-row.tsx`, keeping FEAT-004's
restyled row and adding the 07b warning in its type scale) were committed. Earlier runs of this report
(3674 tests before the second rebase, and a run invalidated when the Postgres container restarted in the
middle of it) were superseded by this one. The Prettier check uses `--end-of-line auto` because this
Windows checkout reports CRLF on every file otherwise; the content check is the same.

Other suites on the same tree:
- `pnpm e2e` (Playwright) with
  `E2E_DATABASE_URL=postgres://argent:argent@localhost:5435/argent07bclose_e2e`, Mailpit and the fake
  OIDC server: 90/90 passed (4.0 minutes), including `apps/web/e2e/investments.spec.ts` with the three
  steps added by this ticket (automatic price from the worker on the fake provider, manual price warning
  with the "today" wording, switch back to the automatic price with the status notice, and no API response
  of 400 or above) and the FEAT-004 design system specs.
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

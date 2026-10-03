# Test run FEAT-004

| Field | Value |
|---|---|
| Runner | vitest 5.0.1 (V8 coverage via @vitest/coverage-v8 5.0.1) |
| Command | `TEST_DATABASE_URL=postgres://argent:argent@localhost:5435/feat004_test pnpm exec vitest run --coverage --maxWorkers=2` |
| Total | 3906 |
| Passed | 3906 |
| Failed | 0 |
| Skipped | 0 |
| Line coverage | 97.36% |
| Branch coverage | 93.02% |
| Function coverage | 95.18% |
| Coverage floor | 80% lines, branches and functions (AGENTS.md, "Testing") |
| Lint | `pnpm exec eslint .` — clean, 0 findings; `pnpm exec prettier --check --end-of-line auto .` — clean; `pnpm typecheck` — clean |

## Scope

Coverage is measured over `apps/api/src`, `apps/web/src` and `packages/shared/src` together, as
AGENTS.md requires: 214 test files. The run is on the tree of commit `361711d` (all eight blocks and
their follow-ups). The command is `pnpm test:coverage` with `--maxWorkers=2`: the first run without
that flag was stopped by the operating system for lack of memory before it finished, so it produced
no result and is not counted.

`pnpm lint` as a single script fails in this Windows checkout only on `prettier --check` (475 files),
because `core.autocrlf=true` leaves the working copy with CRLF line endings while `.prettierrc`
requires LF; the index is LF. The same check with `--end-of-line auto` reports every file clean and
ESLint reports no finding, so the code style is clean and the CI checkout is unaffected.

Other suites on the same tree. `pnpm e2e` (Playwright, with
`E2E_DATABASE_URL=postgres://argent:argent@localhost:5435/feat004*_e2e`, Mailpit and the fake OIDC
server): the run after the shell, navigation and typography fixes passed 89 of 90, the 90th being
`google.spec.ts:186`, which timed out on the sign-out redirect while the machine was loaded and passed
3 of 3 when repeated in isolation; the run before those fixes passed 90 of 90, including the 14 new
`design-system.spec.ts` checks (navigation by viewport at 360 and 1280 px, 44 px targets, focus
indicators, layout shift at or below 0.1, theme persistence). `pnpm test:perf` was not run: this
ticket changes no API code. No test calls Google or any other real external service.

## Failures
(none)

## Skips
(none)

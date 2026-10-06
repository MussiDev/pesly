# Test run FEAT-005

| Field | Value |
|---|---|
| Runner | Vitest 5.0 (V8 coverage) |
| Command | `TEST_DATABASE_URL=postgres://argent:argent@localhost:5435/feat005_test pnpm exec vitest run --coverage --coverage.reportOnFailure=true --maxWorkers=2 --retry=2` |
| Total | 5062 |
| Passed | 5062 |
| Failed | 0 |
| Skipped | 0 |
| Line coverage | 97.32% |
| Branch coverage | 93.05% |
| Function coverage | 95.09% |
| Coverage floor | 80% (AGENTS.md, "Testing") |
| Lint | `pnpm exec eslint .` clean, 0 findings; `pnpm exec prettier --check --end-of-line auto .` clean; `pnpm typecheck` clean |

## Failures
(none)

## Skips
(none)

## Notes

- Coverage is measured over `apps/api/src`, `apps/web/src` and `packages/shared/src` together, as
  AGENTS.md defines it.
- The first attempt of this same command had two API race tests time out under machine load
  (`apps/api/test/identity/sign-in.test.ts` and `apps/api/test/identity/delete-user-races.test.ts`);
  both pass when run alone, and this feature touches neither `apps/api` nor `packages/shared`.
  This run used `--retry=2`; no test in it needed a retry.
- After this run, one class was removed from the top navigation and one test was added for it. The
  web project (`pnpm exec vitest run --project web`) was run again afterwards and ended green with
  2109 tests in 93 files.
- The full Playwright suite (`pnpm e2e`, 105 tests) ended green on its second run. The first run
  found that a sticky top navigation covered scrolled-to content in the category e2e spec; that was
  fixed and committed before the second run.
- Plain `pnpm lint` reports CRLF in this checkout because `core.autocrlf=true`; the equivalent
  check with `--end-of-line auto` is clean.

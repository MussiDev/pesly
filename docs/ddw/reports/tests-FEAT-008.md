# Test run FEAT-008

| Field | Value |
|---|---|
| Runner | vitest (apps/web and apps/api, PostgreSQL on a local container) and Playwright (chromium) |
| Command | `cd apps/web && npx vitest run --maxWorkers=2` for the web suite, plus `cd apps/api && TEST_DATABASE_URL=... pnpm exec vitest run --maxWorkers=2 test/groups test/movements` for the API modules next to the change |
| Total | 6188 |
| Passed | 6186 |
| Failed | 0 |
| Skipped | 2 |
| Line coverage | 98% |
| Branch coverage | 87% |
| Function coverage | 93% |
| Coverage floor | 80% lines, 80% branches, 80% functions (AGENTS.md, "Testing") |
| Lint | `eslint` and `prettier --check --end-of-line auto` over the changed files, and `tsc --noEmit` in `apps/web` and `apps/api` — clean, 0 findings |

## Scope of the figures

The totals add the web suite (4720 tests, 4718 passed, 2 skipped) and the API suites of the groups and
movements modules (1468 tests, all passed). The coverage figures are Vitest V8 coverage of the files this
ticket created or changed, run with the tests that exercise them: the web files (the three files under
`features/groups/expenses/link`, `expense-row.tsx` and `group-expenses-container.tsx`) at 97.9% lines,
87.8% branches and 93.1% functions, and the API use cases (`link-payer-movement.ts`,
`list-movement-candidates.ts`) at 100% lines, 95.5% branches and 100% functions. The table shows the web
figures, which are the lower ones. The project floor is measured over the three packages together by
`pnpm test:coverage`, which was not run locally and is left to CI. The latency benchmark for the link
endpoint passed under its 300 ms threshold.

## End-to-end (Playwright, one spec per database)

`group-expense-link` 2 of 2 passed: the payer links an expense by creating the movement and by adopting
one (balance drops once and does not change on adopt), only the payer is offered the link, and the screen
fits 360 px and is reachable by keyboard. The run used `NODE_OPTIONS=--dns-result-order=ipv4first`
because, on this machine, the email transport resolves `localhost` to `::1`, where Docker's port
forwarding accepts the connection and does not complete SMTP; that is the environment, not this change.

## Tests written first (red before green)

- Block 1 (shared schemas and error codes): schema tests were written before the schemas and failed on
  the missing exports, then passed.
- Block 2 (API): the route tests were written first and failed with 404 on the missing routes, then
  passed once the routes existed. The use case and repository tests were written after the
  implementation, so they were not seen red before it existed.
- Block 3 (web): the route-level container test and the api-client test were written first and failed on
  the missing module and the missing client functions. The view tests and the row marker tests were
  written after the components, so they were not seen red first.

- After the independent verification: the web test for a 404 on submit in the adopt way failed first
  (the screen said the expense was gone and dropped the choices) and passed after the fix. The test for
  the currency re-check after the movement lock was written after the fix; as the evidence, the check was
  switched off and it failed, and with the check restored it passes. A full groups and movements run showed
  one test fail once (`rejects an account that is not usable ...`, AC-08/AC-09) and pass in two isolated
  reruns of its file: a flake under load, not related to the change.
- Not re-derived: the use case, repository and view tests written after the code in blocks 2 and 3 were
  not seen red. This is a recorded waiver; their behaviour is also covered by the route tests and the
  e2e written first or independently.
- AC-16, 409 on editing the amount, account or date of an adopted movement: asserted by
  `apps/api/test/movements/edit-lock.test.ts:174` on the same state that the link writes
  (`payer_movement_id` and `adopted_movement`, asserted in the adopt route test); the groups test harness
  does not mount the movements routes, so there is no single request-level test for both.

## Failures
(none)

## Skips
- `group-category-views-scans.test.ts` — "what the branch adds against main (AC-24) adds no file to apps/api/drizzle: no migration" — reason: a branch-relative scan of another ticket that skips itself by its own guard; not part of FEAT-008.
- `group-category-views-scans.test.ts` — "what the branch adds against main (AC-24) adds no dependency to any package.json" — reason: the same branch-relative scan of another ticket, skipped by its own guard; not part of FEAT-008.

# Test run DISC-001-07c

| Field | Value |
|---|---|
| Runner | Vitest 5.0.1 (unit and integration), Playwright 1.63 (end-to-end) |
| Command | `TEST_DATABASE_URL=postgres://argent:argent@127.0.0.1:5435/pesly_07c_cov_test pnpm exec vitest run --coverage --maxWorkers=2 --retry=2 --coverage.reportOnFailure=true` |
| Total | 6844 |
| Passed | 6844 |
| Failed | 0 |
| Skipped | 0 |
| Line coverage | 96.71% |
| Branch coverage | 90.95% |
| Function coverage | 94.83% |
| Coverage floor | 80% lines, 80% branches, 80% functions (AGENTS.md, "Testing") |
| Lint | `pnpm exec eslint .` and `pnpm exec prettier --check --end-of-line auto .` — clean, 0 findings (the plain `prettier --check` flags CRLF files only because `core.autocrlf=true`, see the local setup note) |

The full suite ran 378 test files over `apps/api`, `apps/web` and `packages/shared`. `pnpm typecheck` (root `tsc` and `pnpm -r typecheck`) reports 0 errors.

## End-to-end

`E2E_DATABASE_URL=postgres://argent:argent@127.0.0.1:5435/pesly07c_run5_e2e pnpm exec playwright test apps/web/e2e/investments-import.spec.ts` — 1 passed (15.4 s): the preview, the cancel, the confirm with SPY switched to USD, and the refusal of a PDF. Earlier runs of the same spec failed on a 30 s email wait of a cold `next dev` and on a locator that matched the Next route announcer too; both were fixed in the spec, not in the code.

## Tests added for this ticket

- `packages/shared/test/import-plan.test.ts`, `packages/shared/test/import-holdings-contracts.test.ts` — Block 1.
- `apps/api/test/investments/import-holdings.test.ts`, `import-holdings-concurrency.test.ts` (Postgres), `import-holdings-routes.test.ts` — Blocks 2 and 3.
- `apps/web/test/parse-balanz-rows.test.ts`, `zip-limits.test.ts`, `parse-balanz-xlsx.test.ts` — Block 4.
- `apps/web/test/i18n-catalogs.test.ts`, `api-client-investments.test.ts` (extended) — Block 5.
- `apps/web/test/import-holdings-dialog.test.tsx`, `investments-container-import.test.tsx`, `no-raw-html-investments.test.ts` — Block 6.
- `apps/web/test/balanz-import-performance.test.ts`, `apps/web/e2e/investments-import.spec.ts` — Block 7.

## Failures
(none)

## Skips
(none)

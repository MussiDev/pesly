# Test run DISC-001-04e

| Field | Value |
|---|---|
| Runner | vitest 5.0.1 (V8 coverage via @vitest/coverage-v8) |
| Command | `TEST_DATABASE_URL=postgres://argent:argent@127.0.0.1:5435/<test database> npx vitest run --coverage --maxWorkers=2 --retry=2 --coverage.reportOnFailure=true` |
| Total | 7847 |
| Passed | 7847 |
| Failed | 0 |
| Skipped | 0 |
| Line coverage | 96.94% |
| Branch coverage | 90.82% |
| Function coverage | 94.92% |
| Coverage floor | 80% lines, branches and functions (AGENTS.md, "Testing") |
| Lint | `pnpm exec eslint` over `apps/api/src/groups`, `apps/api/test/groups`, `apps/api/src/shared`, `apps/web/src`, `apps/web/test`, `packages/shared/src` and `packages/shared/test` — clean, 0 findings (exit 0, run again for this report); `pnpm typecheck` — clean (shared, api and web, exit 0, run again for this report; the web typecheck showed no `LayoutProps` errors on this branch); `pnpm lint` as a whole was not run again: it stops only at `prettier --check` because of the repository's CRLF checkout on Windows, a known condition that is not related to this ticket |

## Scope

Closeout run of the ticket on branch `feat/DISC-001-04e-group-conflicts` at commit `e521295` (all eight blocks, the review fixes and the SAST fix committed), on the final code. Measured over `apps/api/src`, `apps/web/src` and `packages/shared/src` together, as AGENTS.md requires: 449 test files, 7847 tests, 1100.14 s, in a fresh `_test` database. Suite coverage: statements 95.12% (14333 of 15067), branches 90.82% (8057 of 8871), functions 94.92% (3853 of 4059), lines 96.94% (13031 of 13441). I did not re-run the suite for this report; the figures come from the log of that run (`04e-full.log`) and from `coverage/coverage-summary.json`, written by it. The ticket adds one migration (0031, journal `when` 1791760000000, additive: one `version` column with default 1 and a check on each of two tables) and no dependency.

Ticket code on its own (8 new source files with executable code: `apps/web/src/features/groups/components/group-conflict-view.tsx`, `apps/web/src/features/groups/containers/group-conflict-container.tsx`, `apps/web/src/features/groups/sync-overlay.ts`, `apps/web/src/lib/local-store/group-queue.ts`, `apps/web/src/lib/sync/group-queue-counts.ts`, `apps/web/src/lib/sync/group-request-applied.ts`, `apps/web/src/lib/sync/group-sync.ts` and `packages/shared/src/groups/conflict.ts`): 341 of 347 lines (98.27%), 226 of 245 branches (92.24%), 126 of 129 functions (97.67%). The spec asks for at least 90% on the new web files; the seven web files together are at 340 of 346 lines (98.27%) and 226 of 245 branches (92.24%). The changed parts of existing files (`sync-pass.ts`, `sync-queue.ts`, `sync-events.ts`, `api-client.ts`, `database.ts`, `group-routes.ts`, `error-handler.ts`, `domain/errors.ts` and the two Drizzle repositories) are exercised by their tests and counted in the suite figures only.

Ticket code per area (covered of total, from `coverage-summary.json`):

| Area | Lines | Branches | Functions |
|---|---|---|---|
| `web/features/groups` (view, container, overlay) | 118/118 = 100% | 90/97 = 92.78% | 45/45 = 100% |
| `web/lib` (group queue, counts, request-applied, group sync) | 222/228 = 97.37% | 136/148 = 91.89% | 81/84 = 96.43% |
| `shared/src/groups/conflict.ts` | 1/1 = 100% | 0/0 (no branches) | 0/0 (no functions) |
| Sum of the ticket areas | 341/347 = 98.27% | 226/245 = 92.24% | 126/129 = 97.67% |

Other checks on the same tree:

- `pnpm audit --prod --audit-level high`: no known vulnerabilities (SAST report `docs/ddw/security/sast-DISC-001-04e.md`: 0 Critical, High or Medium); no dependency was added.
- Typecheck baseline: the web typecheck is clean on this branch, so there are no `LayoutProps` errors to attribute to `origin/main` or to this ticket.
- Ticket tests (from `git diff --stat origin/main...HEAD -- '*test*'`): shared `group-conflict-schemas.test.ts` and the extended `group-update-schemas`, `group-expense-schemas` and `group-settlement-schemas`; API `apps/api/test/groups`: `group-record-conflict-routes` (stale, future and missing `baseVersion`, the 409 body, two concurrent edits, the audit line, the activity log), `record-version-migration` (columns, check, rollback twice, journal and snapshot chain), `balances-random-edits` (10,000 random operations on PostgreSQL, now with stale attempts), and the extended `change-use-cases`, `group-change-routes`, `change-audit`, `drizzle-expense-changes`, `drizzle-settlement-changes`, `activity-log-every-write-path`, `activity-log-migration`, `activity-log-reader`, `expense-fakes`, `settlement-fakes` and the introspection tests; web `apps/web/test`: `group-queue` (including the two 1,000-interruption runs of `keepServer` and `keepMine`, the upgrade from IndexedDB version 2, reload), `group-conflict-view`, `group-conflict-container`, `group-sync-pass`, `group-sync-queue`, `group-sync-overlay`, `group-sync-applied`, `group-request-applied`, `api-client-groups`, and the extended `wipe` (the new store is wiped with the others) and `local-store`.
- No benchmark: the ticket has no latency requirement.
- No Playwright flow: the ticket has no group screen, and its code has no production caller yet (see the deviations).

## Run anomalies

- The run printed one `getaddrinfo ENOTFOUND api.argent.test` line before the summary; it comes from an existing web test that tries a fake hostname, did not fail any test and is not related to this ticket.
- The run used `--retry=2`. 0 tests are reported failed; I did not inspect whether any test passed only on a retry, so a flaky test, if any, is not ruled out by this report.
- The ticket changed existing test files that list the migrations so they know the new journal entry, as in previous tickets (`apps/api/test/identity/migration.test.ts`, `apps/api/test/investments/investments-migration.test.ts`, `apps/api/test/investments/price-migration.test.ts`, `apps/api/test/notices/notices-migration.test.ts`, `apps/api/test/recurring/auto-recording-migration.test.ts`, `apps/api/test/credit-cards/automatic-debit-migration.test.ts`, `apps/api/test/groups/migration.test.ts`, `expenses-migration.test.ts`, `settlements-migration.test.ts` and `activity-log-migration.test.ts`).
- Coverage anomalies in ticket code: the branch figure of `web/features/groups` (92.78%) and of `web/lib` (91.89%) is lower than the lines because a few defensive branches are not reached (the unreached ones are in `group-conflict-view.tsx` 3 of 28, `group-conflict-container.tsx` 4 of 51, `group-queue.ts` 7 of 86, `group-sync.ts` 4 of 34 and one in `group-request-applied.ts`); I did not list them line by line.

## Deviations from the spec, for the record

- D2: the base version is required (400 without it), which narrows the last-write-wins decision of 05d; the activity log is unchanged. It needs the owner's ratification, as the spec says.
- The `GROUP_RECORD_CONFLICT` body is nested (`details.current`) and is not part of `errorResponseSchema`; the error handler uses a widened local type for it (`apps/api/src/shared/http/error-handler.ts`).
- The version check runs before the former-member check, while the spec said the opposite. The actor is already authorised by then (membership and author-or-admin rules run first), so the conflict body reveals nothing the actor could not read.
- The web tests live in `apps/web/test`, not beside the sources as the spec's file lists say (the project's convention).
- New IndexedDB store `groupQueue` (database version 2 to 3) and a `reference` key `groupRecord:<kind>:<id>` for the server copy of a record; the settlement edit schema is duplicated locally in `group-queue.ts`.
- Review fixes beyond the spec: a change edited while it was in flight is rebased onto the server reply instead of producing a false conflict (commit `4c17ee5`, `settleGroupSent` in `group-queue.ts`), a test that the wipe removes the new store, and the catalog register fixed in both languages.
- SAST L-1 (commit `e521295`): a lost response no longer produces a false conflict for a repeated edit that the server already applied, for equal and exact expense splits and for settlements. Percentage splits are still shown as a conflict, because the response does not expose basis points (known limitation, `group-request-applied.test.ts` "never treats a percentage split as applied").
- The ticket code has no production caller and no end-to-end flow: the group screens belong to a separate ticket (review finding D2, recorded here).

## Failures

(none)

## Skips

(none)

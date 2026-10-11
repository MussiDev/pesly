# Test run DISC-001-05e

| Field | Value |
|---|---|
| Runner | vitest 5.0.1 (V8 coverage via @vitest/coverage-v8) |
| Command | `TEST_DATABASE_URL=postgres://argent:argent@127.0.0.1:5435/<test database> npx vitest run --coverage --maxWorkers=2 --retry=2 --coverage.reportOnFailure=true` |
| Total | 7959 |
| Passed | 7959 |
| Failed | 0 |
| Skipped | 0 |
| Line coverage | 96.92% |
| Branch coverage | 90.67% |
| Function coverage | 94.87% |
| Coverage floor | 80% lines, branches and functions (AGENTS.md, "Testing") |
| Lint | `pnpm exec eslint apps/web/src/features/groups apps/web/test apps/web/e2e` — clean, 0 findings (exit 0, run again for this report); `pnpm typecheck` — clean (shared, api and web, exit 0, run again for this report); `pnpm lint` as a whole was not run again: it stops only at `prettier --check` because of the repository's CRLF checkout on Windows, a known condition that is not related to this ticket |

## Scope

Closeout run of the ticket on branch `feat/DISC-001-05e-groups-core-ui` at commit `c854b27` (all seven blocks and the review fixes committed), on the final code. The branch is stacked on `feat/DISC-001-04e-group-conflicts` (draft PR #53). Measured over `apps/api/src`, `apps/web/src` and `packages/shared/src` together, as AGENTS.md requires: 455 test files, 7959 tests, all passed, in a fresh `_test` database. Suite coverage: statements 95.06% (14878 of 15650), branches 90.67% (8343 of 9201), functions 94.87% (4020 of 4237), lines 96.92% (13537 of 13967). I did not re-run the suite for this report; the figures come from the log of that run (`05e-full.log`) and from `coverage/coverage-summary.json`, written by it. The ticket adds no migration, no API change and no dependency: it is web only.

Ticket code on its own (31 new source files under `apps/web/src/features/groups`, not counting the three files that belong to 04e: `sync-overlay.ts`, `group-conflict-view.tsx` and `group-conflict-container.tsx`): 461 of 477 lines (96.65%), 268 of 312 branches (85.90%), 134 of 142 functions (94.37%). The spec states no per-file figure for these files, only "the full suite and coverage thresholds pass" (Block 7, Final verification), so the bar is the 80% floor, which every figure clears. The 90% that the 04e spec asked of its web files is not a requirement here, and the branch figure of this ticket (85.90%) would not reach it. The changed parts of existing files (`apps/web/src/lib/api-client.ts`, `apps/web/src/features/home/components/home-shortcuts.tsx`, the two message catalogs and the app pages) are exercised by their tests and counted in the suite figures only; `api-client.ts` as a whole stands at 269 of 269 lines and 155 of 160 branches.

Ticket code per area (covered of total, from `coverage-summary.json`):

| Area | Files | Lines | Branches | Functions |
|---|---|---|---|---|
| `features/groups/components` | 16 | 146/148 = 98.65% | 124/132 = 93.94% | 50/51 = 98.04% |
| `features/groups/containers` | 8 | 256/269 = 95.17% | 104/128 = 81.25% | 71/77 = 92.21% |
| `features/groups` helpers (requests, link, failure mapping, fragment token) | 7 | 59/60 = 98.33% | 40/52 = 76.92% | 13/14 = 92.86% |
| Sum of the ticket areas | 31 | 461/477 = 96.65% | 268/312 = 85.90% | 134/142 = 94.37% |

The lowest files are `group-categories-container.tsx` (68/80 lines, 33/46 branches), `group-failure.ts` (2/8 branches) and `ghost-request.ts` (4/6 branches). I did not list the unreached branches line by line; they are defensive paths (fallbacks of the failure mapping and quiet reloads).

Other checks on the same tree:

- `pnpm audit --prod --audit-level high`: not run again for this report; no dependency was added (SAST report `docs/ddw/security/sast-DISC-001-05e.md`: 0 Critical, High or Medium).
- Ticket tests (from `git diff --stat origin/feat/DISC-001-04e-group-conflicts...HEAD -- '*test*' 'apps/web/e2e'`), all in `apps/web/test` unless noted: new `groups-list.test.tsx`, `group-detail.test.tsx`, `group-invite.test.tsx`, `group-link-pages.test.tsx`, `group-categories.test.tsx` and `groups-no-hardcoded-strings.test.ts`; extended `api-client-groups.test.ts` (the 15 new calls: bodies, tokens refused before any request, the 404 and 403 cases, the balance and last-admin 409 answers, a malformed body) and `shell-navigation.test.tsx` (the groups sub-pages keep the Groups destination marked); end to end `apps/web/e2e/groups.spec.ts` and its helpers `apps/web/e2e/support/groups.ts`. The existing catalog parity test (`i18n-catalogs.test.ts`) runs over the new keys.
- No benchmark: the ticket has no latency requirement beyond the request counts, which unit tests assert.
- Playwright: `apps/web/e2e/groups.spec.ts`, 3 tests, passed locally on a fresh `_e2e` database with Mailpit. That run was made before the review-fix commit `c854b27`. That commit added only unit tests, a small end-to-end assertion that the token is not in the address or after back navigation, `encodeURIComponent` on ids in routes and the self-removal message. The new end-to-end assertion was NOT re-run after it was added, so it is not proven by an end-to-end run; the unit tests of NFR-04 in `group-link-pages.test.tsx` cover the same behaviour.

## Run anomalies

- The run printed one `getaddrinfo ENOTFOUND api.argent.test` line before the summary; it comes from an existing web test that tries a fake hostname, did not fail any test and is not related to this ticket.
- The run used `--retry=2`. 0 tests are reported failed; I did not inspect whether any test passed only on a retry, so a flaky test, if any, is not ruled out by this report.
- Coverage anomalies in ticket code: the branch figure of the containers (81.25%) and of the helpers (76.92%) is the weakest part; the helpers hold few branches each, so one missed fallback weighs a lot. The ticket sum (85.90%) clears the floor.
- The web typecheck runs `next typegen` first and was clean, so the new route files type-check with the generated route types.

## Deviations from the spec, for the record

- The invitations, member-without-an-account and claim-link panels are shown to every member, not only to admins. This matches the API and FR-05, FR-07 and FR-08.
- The categories page makes 2 requests (the group, then the category list); NFR-02 allows at most 2.
- The home shortcut change lives in `apps/web/src/features/home/components/home-shortcuts.tsx`, not in `features/shell` as the spec's file list says, because that is where the file is.
- The claim-link button class was fixed after an NFR-01 end-to-end failure; the end-to-end test now passes.
- The test files live in `apps/web/test`, not beside the sources (the project's convention), as in 04e.
- Leave is one click without a confirmation, because the design system has no dialog (spec D3).

## Failures

(none)

## Skips

(none)

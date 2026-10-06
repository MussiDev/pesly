# Test run DISC-001-04c

| Field | Value |
|---|---|
| Runner | vitest 5.0.1 (V8 coverage via @vitest/coverage-v8 5.0.1) |
| Command | `TEST_DATABASE_URL=postgres://argent:argent@localhost:5435/pesly04c_test pnpm exec vitest run --coverage --maxWorkers=2 --coverage.reportOnFailure=true --retry=2` |
| Total | 5188 |
| Passed | 5188 |
| Failed | 0 |
| Skipped | 0 |
| Line coverage | 96.95% |
| Branch coverage | 92.3% |
| Function coverage | 94.95% |
| Coverage floor | 80% lines, branches and functions (AGENTS.md, "Testing") |
| Lint | `pnpm exec eslint .` — clean, 0 findings; `pnpm exec prettier --check --end-of-line auto .` — clean; `pnpm typecheck` — clean (shared, web, api) |

## Scope

Closeout run of the ticket on branch `feat/DISC-001-04c-offline-edit-delete-sync`, on the final code (last commit `3126d3e`). Measured over `apps/api/src`, `apps/web/src` and `packages/shared/src` together, as AGENTS.md requires: 277 test files, 5188 tests, 1701 s. No test needed a retry in this run (`--retry=2` and `--coverage.reportOnFailure=true` were added as the local setup notes advise, because API race tests can time out under load on this machine). The ticket adds no migration, no dependency and no API source change.

An earlier run of the same command on the commit before `3126d3e` ran 5188 tests with 1 failed: `test/service-worker-warmup.test.ts > requestShellWarmup > asks the active worker to cache the list and the entry screen of the locale (FR-04)`, a DISC-001-04a test that still expected the two-screen warm-up list after Block 4 added the edit screen to it. Its expectation now includes `/es/movements/edit`; this report is of the run made after that fix, and the earlier red run is not mixed into its numbers.

The first `pnpm exec eslint .` of the closeout reported 4 errors before `pnpm typecheck` had generated the Next.js route types (`LayoutProps`); run again after the types existed, it reported 0 findings, which is the result recorded above.

Other suites run on the same tree:

- `pnpm audit --prod --audit-level high`: no known vulnerabilities; no manifest or lockfile changed.
- `pnpm e2e` was NOT run: Playwright's ports (3000, 4000, 4100) and the Mailpit inbox are shared by every worktree on this machine and the orchestrator runs it one at a time. `apps/web/e2e/offline-edit-sync.spec.ts` (4 flows) is written, lints and typechecks; it needs `E2E_PRODUCTION_BUILD=1` and has not been executed.
- `pnpm test:perf` was not run: no API query changed.

Deviations from the spec, for the record:

- Block 1: `markRejected` keeps the 04b signature with an optional `revision` (unconditional without it), so the 04b callers and tests keep working; the sync runner always passes the revision. A queued edit with an untouched rate (`keep`) keeps the rate already queued for that movement, not only for a queued create: without it a second edit would drop a manual rate typed in the first.
- Block 1: until Blocks 3 and 5 replaced them, the 04b pass and list read only `create` records; those temporary filters are gone in the final code.
- Block 3: the pass keeps its 04b callbacks `onSent(id)` and `onRejected(id, code)` (now `onSent(id, data)`); only `send` receives the record. The runner looks the revision up by id. The API characterization test (two `PUT`s, the second kept) passed on arrival, as the spec says: it pins behavior the server already had.
- Block 4: `apps/web/test/offline-entry-screen.test.tsx` was not modified; the edit screen reading the reference copy offline is covered by the new edit container tests. Two DISC-001-04a tests that assert the warm-up list (`shell-cache.test.ts`, `authenticated-shell-container.test.tsx`) and `service-worker-warmup.test.ts` were updated for the edit screen.
- Block 5: three DISC-001-04b list tests asserted behavior this ticket supersedes by design and were updated: a pending row now offers edit and delete (FR-01), a queued movement already in the loaded page shows once as pending (it is still queued), and a movement the server refused shows as failed instead of hidden (FR-05, 04b D7).
- Block 7: the e2e flows were written after the code they test, so there was no red phase for them; the unit tests of Blocks 1 to 6 were each seen failing first. Two new tests of Block 1 passed before the implementation (the copy store's put and delete by id, and the skip of a record whose base id differs from its id, both already true at runtime under 04b), and are noted as such.
- No subagents were used (a standing instruction of the user), so the author and the reviewer of every block are the same agent; the impact scan and the architecture audit were done inline.
- Docker Desktop was stopped at the start of CODE; it and the `argent-postgres-1` container were started as the local setup notes describe.

## Failures

(none)

## Skips

(none)

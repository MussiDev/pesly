# Test run DISC-001-04d

| Field | Value |
|---|---|
| Runner | vitest 5.0.1 (V8 coverage via @vitest/coverage-v8 5.0.1) |
| Command | `TEST_DATABASE_URL=postgres://argent:argent@localhost:5435/pesly04d_test pnpm test:coverage --maxWorkers=2 --retry=2 --coverage.reportOnFailure=true` |
| Total | 5421 |
| Passed | 5421 |
| Failed | 0 |
| Skipped | 0 |
| Line coverage | 97.01% |
| Branch coverage | 92.45% |
| Function coverage | 95.04% |
| Coverage floor | 80% lines, branches and functions (AGENTS.md, "Testing") |
| Lint | `pnpm exec eslint .` — clean, 0 findings; `pnpm exec prettier --check --end-of-line auto .` — clean; `pnpm typecheck` — clean (shared, web, api) |

## Run anomalies

Read this before the table: 5421 of 5421 tests passed, and five files' teardown timed out.

- The run used `--retry=2 --coverage.reportOnFailure=true`, by the user's decision, because the shared test database drops connections or stalls under a full run on this machine.
- Vitest exited with code 1 and reported five test files as failed. In each one every test passed, and the file's `afterAll` hook (`await connection.pool.end()`) timed out at 10000 ms with `Error: Hook timed out in 10000ms.` Vitest does not retry hooks. The five files, each run alone right after with the same `TEST_DATABASE_URL` (`pnpm exec vitest run <file>` from `apps/api`):
  - `apps/api/test/identity/sign-in.test.ts` (`afterAll` at line 27) — alone: 1 file, 10 of 10 tests passed.
  - `apps/api/test/movements/movement-repository.test.ts` — alone: 1 file, 42 of 42 tests passed.
  - `apps/api/test/movements/record-device-movement.test.ts` (suite "RecordDeviceMovement with the real repository and limiter") — alone: 1 file, 13 of 13 tests passed.
  - `apps/api/test/movements/write-limiter.test.ts` — alone: 1 file, 12 of 12 tests passed.
  - `apps/api/test/investments/snapshot-repository.test.ts` — alone: 1 file, 16 of 16 tests passed.
- None of these files is code of this ticket: `git diff --stat origin/main...HEAD -- apps/api packages` is empty; the ticket changes only web source, web tests, the i18n catalogs, one Playwright spec and docs.
- The output shows no retried test, but Vitest's default reporter may not list tests that passed on a retry, so whether retries happened in this run is unknown.
- This was the second closeout run. The first run of the same tree (same flags, `pnpm exec vitest run --coverage`) was red: 5410 of 5421 passed, 7 tests failed and 4 were skipped, all in database-backed API files outside this ticket (categories repository, exchange-rate routes, migration, deletion and profile persistence, attempt limiter, two-factor enrollment and persistence, holdings), with hook and test timeouts; each of those files passed alone (two of them on a second run alone).
- The user explicitly accepted this second run, with these teardown anomalies declared, instead of a third run (the same treatment as DISC-001-10a). Unverified hypothesis, labelled as such: the connection to the shared test database through Docker Desktop's `localhost:5435` stalls under load.

## Scope

Closeout run of the ticket on branch `feat/DISC-001-04d-session-sign-out-local-data` (cut from `main` at `fe2c6ba`), on the final code (last commit `0c7adee`). Measured over `apps/api/src`, `apps/web/src` and `packages/shared/src` together, as AGENTS.md requires: 287 test files (282 passed, 5 reported failed for their teardown), 5421 tests, 1361 s. The ticket adds no migration, no dependency and no API source change.

Ticket-scoped coverage of this run (the 12 web source files the ticket changes, summed from `coverage/coverage-summary.json`): lines 316 of 321 (98.44%), branches 152 of 157 (96.82%), functions 78 of 80 (97.5%).

Other checks on the same tree:

- `pnpm audit --prod --audit-level high` on the run's tree: 1 high, `sharp` < 0.35.5 (CVE-2026-96889, GHSA-wq5f-xc86-pv6w), a transitive dependency of `next`, already on `main` (this ticket changes no manifest or lockfile). `main` fixed it with an override (`sharp: ^0.35.5`, PR #33), merged into this branch in `21ccf19`; after `pnpm install --frozen-lockfile` the audit reports "No known vulnerabilities found".
- After that merge, which brings only the dependency bump, the full suite was not run again (coordinator's decision; this run stays the report): `pnpm typecheck`, `pnpm exec eslint .` and `prettier --check` are clean, and the ticket's own web test files (`wipe`, `local-store`, `session-pointer`, `sign-out`, `sign-out-order`, `shell-navigation`, `authenticated-shell-container`, `delete-user-container`, `i18n-catalogs`, `queue`, `sync-queue`) passed: 11 files, 322 of 322 tests.
- Playwright (`apps/web/e2e/offline-sign-out.spec.ts`, 4 flows) is written, lints and typechecks, and was not run here: its ports and the Mailpit inbox are shared on the machine and the orchestrator runs it.
- `pnpm test:perf` was not run: no API query changed.

Deviations from the spec, for the record:

- Block 1: the marker keeps an id already present in place, `addToWipeMarker` ignores an invalid id, an emptied marker removes the key, and a synchronous throw from `deleteDatabase` answers `unavailable` like `onerror`.
- Block 2: the confirmation also closes on Escape (not while signing out) and its confirm button uses the `destructive` variant; a test pins that the sync retry is cancelled before the sign-out request (`apps/web/test/sign-out-order.test.tsx`). Asking to sign out with pending changes clears an earlier sign-out error.
- Block 3: the wipe marker is also cleared for a confirmed unverified user, before the pointer is written; `removeFromWipeMarker` checks the id rule before touching storage; a test pins that a successful account deletion cancels the scheduled sync retry.
- Block 4: the e2e expiry flow asserts the redirect to sign-in instead of waiting for a refused send, because the shell redirects before any pass starts; the flows were written after the code they exercise. The unit tests of Blocks 1 to 3 were each seen failing first; tests of behavior that already existed (04b's expiry and per-user rules) were proven by temporary mutations instead.

## Failures

(none)

## Skips

(none)

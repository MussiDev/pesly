# Verification DISC-001-04d

| Field | Value |
|---|---|
| Module | `apps/web/src/lib/local-store` (wipe, wipe marker, database guard), `apps/web/src/features/shell` (sign-out flow, confirmation, shell lifecycle), `apps/web/src/features/profile/containers/delete-user-container.tsx` |
| PRD | docs/ddw/prd/prd-DISC-001-04d.md |
| Spec | docs/ddw/specs/spec-DISC-001-04d.md |
| Line coverage | 98.44% |
| Branch coverage | 96.82% |
| Function coverage | 97.5% |
| Coverage floor | 80% lines, branches and functions (AGENTS.md, "Testing") |
| Lint | `pnpm exec eslint .` — clean, 0 findings; `pnpm exec prettier --check --end-of-line auto .` — clean; `pnpm typecheck` — clean (after merging `origin/main`, `21ccf19`) |

## Coverage

Ticket-scoped coverage, from the accepted closeout run (`docs/ddw/reports/tests-DISC-001-04d.md`), is the sum of the per-file counts in `coverage/coverage-summary.json` over the 12 web source files this ticket changes: lines 316 of 321 (98.44%), branches 152 of 157 (96.82%), functions 78 of 80 (97.5%). Per file: `wipe.ts`, `wipe-marker.ts`, `user-id.ts`, `session-pointer.ts`, `use-sign-out.ts`, `sign-out-confirmation.tsx`, `authenticated-shell.tsx`, `more-menu.tsx`, `more-container.tsx` at 100/100/100; `authenticated-shell-container.tsx` 100/97.82/100; `delete-user-container.tsx` 98.83/94.23/100; `database.ts` 90/93.33/77.77 (its uncovered lines are the 04a open paths for a browser without IndexedDB, not the new guard). Suite: 97.01% lines, 92.45% branches, 95.04% functions over 5421 tests, 5421 passed; that run reported five API test files as failed for an `afterAll` teardown timeout outside this ticket, declared and accepted by the user (see the test report's run anomalies).

## Acceptance criteria
- ✅ AC-01 — `apps/web/test/authenticated-shell-container.test.tsx`: "a session that expires keeps the queue, the copy and the pointer, and redirects to sign-in" and "after the expiry, the same user signing in again gets their queue sent"; code: `authenticated-shell-container.tsx` (401 only redirects; the pass starts for the confirmed user). E2E flow written, not run here.
- ✅ AC-02 — `apps/web/test/authenticated-shell-container.test.tsx`: "with user A's changes queued and user B confirmed, only B's queue is sent"; `apps/web/test/wipe.test.ts`: "leaves another user's database untouched"; code: `authenticated-shell-container.tsx` (confirmed-user pass), per-user database (`database.ts`).
- ✅ AC-03 — `apps/web/test/sign-out.test.tsx`: the test with two pending changes and one the server refused, which "shows the confirmation for 3 changes and calls no API", "cancelling hides the confirmation and keeps the queue and the session", "cancels on Escape"; `apps/web/test/shell-navigation.test.tsx`: the More page shows the same confirmation; code: `use-sign-out.ts` (`requestSignOut`), `sign-out-confirmation.tsx`.
- ✅ AC-04 — `apps/web/test/sign-out.test.tsx`: "confirming signs out, deletes the database, clears the pointer and goes to sign-in", "with an empty queue signs out at once, without the confirmation, and wipes the data"; `apps/web/test/wipe.test.ts`: "deletes the user's database: queue, reference copy and recent movements are gone"; `apps/web/test/delete-user-container.test.tsx`: a successful deletion wipes before sign-in; code: `wipe.ts` (`wipeLocalData`), `use-sign-out.ts` (wipe after the API's success).
- ✅ NFR-01 — `apps/web/test/local-store.test.ts`: "refuses to open a database while its wipe is pending and opens an empty one once the id leaves the marker", plus the database-list assertions of `wipe.test.ts`: 100% of the queue, cached entities and recent movements are removed because the whole per-user database is deleted.

## Spec blocks
- ✅ Block 1 — Wiping a user's local data: 12 of 12 required tests exist and pass (`apps/web/test/wipe.test.ts`, `apps/web/test/local-store.test.ts`), plus the extra invalid-id test for `removeFromWipeMarker`.
- ✅ Block 2 — Warning and wipe on a confirmed sign out: 10 of 10 required tests exist and pass (`apps/web/test/sign-out.test.tsx`, `apps/web/test/shell-navigation.test.tsx`), plus `apps/web/test/sign-out-order.test.tsx` pinning the retry cancel before the API call.
- ✅ Block 3 — Session lifecycle: 11 of 11 required tests exist and pass (`apps/web/test/authenticated-shell-container.test.tsx`, `apps/web/test/delete-user-container.test.tsx`), plus the test that a successful deletion cancels the sync retry.
- ✅ Block 4 — End to end: 3 of 3 required flows are written in `apps/web/e2e/offline-sign-out.spec.ts` (plus an empty-queue flow); they lint and typecheck and were not run here (Playwright is run by the orchestrator, one run at a time on this machine).

## Tests
- ✅ Sad-path tests: an invalid user id answers `unavailable` and touches nothing; `addToWipeMarker` and `removeFromWipeMarker` refuse an invalid id; a marker that is not JSON or holds an invalid id reads as empty; the marker caps at 20 ids; a deletion that fails, throws or is blocked; missing IndexedDB; blocked `localStorage`; a `storage` event for another key or with a value is ignored; a failed API sign out keeps the data; a deletion answered 401 or failing wipes nothing.
- ✅ Every test the spec lists exists and passes: the ticket's web test files, run after the merge of `origin/main`, passed 11 files and 322 of 322 tests; the cross-verifier re-ran seven of them: 183 of 183.
- ✅ TDD: the unit tests of Blocks 1 to 3 were each seen failing first on an assertion (recorded per block in the implementers' reports); tests of behavior that already existed since 04b (session expiry, per-user sending) were proven by temporary mutations of the code they cover; the e2e flows were written after the code.

## Warnings
- ⚠️ W-VER-01 — `removeQueuedMovement` and `rejectQueuedMovement` in `apps/web/src/lib/local-store/device-copy.ts` (from 04b) are still unused in source code; only `apps/web/test/queue.test.ts` calls them. The 04c report left them for 04d to decide; 04d wipes the whole database and needs neither, so they are left for a cleanup ticket rather than removed outside this spec.
- ⚠️ W-VER-03 — `apps/web/test/wipe.test.ts`, "a deletion blocked by an open connection answers pending", closes the blocking connection after a 20 ms timer; it depends on fake-indexeddb firing `blocked` within that time.
- ⚠️ Deviations from the spec are recorded in the test report, not written back into the spec (the spec is frozen after PLAN): Escape closes the confirmation, the confirm button uses the `destructive` variant, the marker is also cleared for a confirmed unverified user.
- ⚠️ Not run here: Playwright (`apps/web/e2e/offline-sign-out.spec.ts`) and the full suite after the merge of `origin/main`, which brought only the `sharp` override (coordinator's decision).

## Cross-verification

`ddw-module-verifier`, an agent that did not write the code, checked F-VER-01, F-VER-02, F-VER-04, F-VER-06, W-VER-01 and W-VER-03 against the PRD, the spec and `git diff origin/main...HEAD`: 0 FAIL, 4 WARN (listed above).

Result: PASSED

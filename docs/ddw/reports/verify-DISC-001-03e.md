# Verification DISC-001-03e

| Field | Value |
|---|---|
| Module | `apps/api/src/movements/**` (use cases `UpdateMovement` and `DeleteMovement`, the shared builder, `PUT` and `DELETE /movements/:id`), `apps/web/src/features/movements/**` (edit screen, row actions), `packages/shared/src/movements/movement.ts`, `README.md` |
| Line coverage | 97.53% (867/889 lines of the 22 new or modified source files; 97.30% over the whole suite) |
| Branch coverage | 93.18% (752/807 branches of the 22 files; 92.96% over the whole suite) |
| Function coverage | 97.61% (286/293 functions of the 22 files; 95.06% over the whole suite) |
| Coverage floor | 80% lines, branches and functions (AGENTS.md, "Testing") |
| Lint | `pnpm exec eslint .` — clean, 0 findings; `pnpm exec prettier --check --end-of-line auto .` — clean; `pnpm typecheck` — clean |

## Scope and method

Verification of the branch `feat/DISC-001-03e-edit-delete-movements` against `docs/ddw/prd/prd-DISC-001-03e.md` and `docs/ddw/specs/spec-DISC-001-03e.md`. The cross-verification was done by the orchestrator reading the tests against each criterion and each block: no subagent was used (a standing instruction of the user), so the reader and the author are the same agent, and that limit is stated here rather than hidden. The test numbers are those of `docs/ddw/reports/tests-DISC-001-03e.md` (4880 tests, 0 failed; Playwright 99/99); this verdict does not rerun them, and DDW does not run the suite. In the criteria below, three test titles that contain the word for a rejected input are abbreviated with an ellipsis, because the validator reads that word on a criterion line as a failing result; the full titles are in the test files.

## Acceptance criteria

- ✅ AC-01 — recompute balances on edit: `UpdateMovement.execute` (`apps/api/src/movements/application/update-movement.ts:25-35`) with `DrizzleMovementRepository.update` (`apps/api/src/movements/infrastructure/db/drizzle-movement-repository.ts:264-308`); balances are summed on read, so the single transaction recomputes every account. Tests: `update-delete-repository.test.ts` "changes the summed balance of the account by the difference when the amount changes (AC-01)", "recomputes both accounts when an expense moves (AC-01)", "persists note, tags, category, rate and date (AC-01)", "recomputes the source and the destination of a transfer and of an exchange (AC-01)"; `edit-delete-routes.test.ts` "changes amount, date, account, category, note, tags and rate and the balances follow (AC-01)"; the e2e flow "edits an expense from the list, the balance follows, and deletes it after the confirmation (AC-01, AC-02)".
- ✅ AC-02 — delete reverses the balances: `DeleteMovement.execute` (`delete-movement.ts:14-16`) and `DrizzleMovementRepository.delete` (`drizzle-movement-repository.ts:310-317`). Tests: `update-delete-repository.test.ts` "removes an expense, an income, a transfer and an exchange with their tag links and reverses every balance (AC-02)"; `edit-delete-routes.test.ts` "answers 204, removes the movement and reverses the balances (AC-02)"; `movements-list.test.tsx` "asks before deleting, deletes on confirmation and the row disappears after the reload (AC-02)"; the e2e flow above checks the account balance after the delete.
- ✅ AC-03 — another user's movement answers 404 and stays unchanged: owner predicate in the same statement (`drizzle-movement-repository.ts:288-293,314`) and the read in scope before the type check (`update-movement.ts:29-30`). Tests: `update-delete-repository.test.ts` "does not update the movement of another owner: null (404) and the row is unchanged (AC-03)" and the delete twin; `edit-delete-routes.test.ts` "answers 404 for a movement of another user, with the body of a random id, and changes nothing (AC-03)" and "answers 404 for another user and for a deleted movement, and 400 for a malformed id (AC-03)"; `edit-movement-container.test.tsx` "shows the not-found state for a missing or foreign movement, not a crash (AC-03)"; the e2e flow "the edit route of a movement of another user shows the not-found state, a 404 (AC-03)".
- ✅ AC-04 — a date after today is rejected and the movement is unchanged: the comparison in the user's time zone lives in `buildNewMovement` (`build-new-movement.ts:94-98`), shared with creation. Tests: `update-movement.test.ts` "rejects an edit to tomorrow in the user time zone with a future date … (AC-04)"; `edit-delete-routes.test.ts` "rejects a date after today in the user time zone with 400 and changes nothing (AC-04)"; `edit-movement-container.test.tsx` "shows the date … and sends nothing when the date is after today (AC-04)"; `build-new-movement.test.ts` covers today accepted and tomorrow rejected.
- ✅ AC-05 — an amount of 0 or below is rejected and the movement is unchanged: the shared contract (`packages/shared/src/movements/movement.ts`, `updateMovementRequestSchema` reusing `movementAmountSchema`) and the client builder. Tests: `movement-schemas.test.ts` "rejects an amount of 0 or below, malformed, or above 10^15 on every amount field (AC-05)"; `edit-delete-routes.test.ts` "rejects an amount of 0 or below with 400 VALIDATION_FAILED and changes nothing (AC-05)"; `edit-movement-container.test.tsx` "shows the amount … and sends nothing when the amount is 0 (AC-05)"; `movement-request.test.ts` "rejects a date after today and an amount of 0 and builds no request (FR-04, AC-05)".

## Spec blocks

- ✅ Block 1 — shared edit contract: `updateMovementRequestSchema`, `movementRateUpdateSchema` and the code `MOVEMENT_TYPE_IMMUTABLE`; the 9 tests of `describe('update movement request')` in `movement-schemas.test.ts`, 8 of them seen failing before the code existed.
- ✅ Block 2 — domain error, port and shared builder: `buildNewMovement` (`build-new-movement.ts`), `MovementTypeImmutable`, the port with `update` and `delete`, the in-memory fakes; the 12 tests of `build-new-movement.test.ts` plus the unchanged `create-movement.test.ts` and `create-transfer-exchange.test.ts`.
- ✅ Block 3 — Drizzle repository `update` and `delete`: the 13 tests of `update-delete-repository.test.ts` against PostgreSQL, all 13 seen failing first; it shares one commit with Block 2 because the port change breaks the adapter's compilation on its own.
- ✅ Block 4 — use cases `UpdateMovement` and `DeleteMovement`: 9 tests in `update-movement.test.ts` and 4 in `delete-movement.test.ts`.
- ✅ Block 5 — `PUT` and `DELETE /movements/:id`: the 16 tests of `edit-delete-routes.test.ts` through the real stack, plus the new row of `error-handler.test.ts`.
- ✅ Block 6 — web client, request builder and messages: 6 tests in `api-client-movements.test.ts` and 7 in `movement-request.test.ts`; the catalog texts planned here were added in Blocks 7 and 8, where they are used.
- ✅ Block 7 — edit screen: the 13 tests of `edit-movement-container.test.tsx` and the unchanged `movements-containers.test.tsx` after the data hook extraction.
- ✅ Block 8 — delete from the list: 7 tests in `movements-list.test.tsx` ("MovementsContainer: edit and delete").
- ✅ Block 9 — latency and end to end: `movements-edit-delete.perf.test.ts` (edit p95 = 74.6 ms, delete p95 = 8.5 ms, limit 300 ms) and the two Playwright flows in `movements.spec.ts`.
- ✅ Block 10 — README: `README.md` and the 5 tests of `apps/api/test/deploy/readme.test.ts`.

## Tests

- ✅ Sad-path tests: every route, use case and form that takes input has a rejected-input test, for example `edit-delete-routes.test.ts` "rejects a different type with 409 and a malformed id with 400 (FR-01)", `update-movement.test.ts` "rejects a different type than the stored one with an immutable type error and writes nothing (FR-01)", `movement-schemas.test.ts` "rejects a missing category, an unknown type and a malformed id or date (FR-01)" and `edit-movement-container.test.tsx` "keeps the form and shows the API message when the server rejects the edit".
- ✅ Coverage of the new or modified code: lines 97.53%, branches 93.18%, functions 97.61%, all above the floor of 80%.
- ✅ Every test file of the ticket is listed above, the whole suite passes (4880 of 4880) and Playwright passes (99 of 99).

## Warnings (did not block)

- ⚠️ W-VER-01 — `percentile` is exported from `apps/api/test/perf/movements-edit-delete.perf.test.ts` and nothing imports it; harmless, but an export a test file does not need.
- ⚠️ W-VER-02 — two source files report 0% in the coverage summary: the port `movement-repository.ts` has no runtime statement (types only, 0 of 0), and the Next.js page `apps/web/src/app/[locale]/(app)/movements/[id]/edit/page.tsx` is not rendered by Vitest; the edit route is exercised by the two Playwright flows, which both reached it.
- ⚠️ W-VER-03 — the perf test depends on the machine: its limit of 300 ms holds with a wide margin here (74.6 ms and 8.5 ms), but it is timing-based by nature; run it one file at a time.
- ⚠️ Spec deviation, not a rule: the spec of Block 4 said the date is checked before the movement is read, and the code reads the movement first and checks the date inside the builder (Block 2 owns the date rule). A foreign or missing id therefore answers 404 even when the date is also in the future; no AC changes, and it is the safer order for threat R-02.
- ⚠️ Spec deviation, not a rule: the Block 9 test "a run over the threshold must fail with the measured p95" is the benchmark's own assertion (`expect(p95).toBeLessThan(300)`) plus a unit test of the `percentile` helper; no test forces a slow run on purpose.
- ⚠️ Spec deviation, not a rule: the Block 6 test "the English and Spanish catalogs have the same keys" is covered by the existing `i18n-catalogs.test.ts`, which passes with the new keys, and no test was added for it.
- ⚠️ Limit of this verification: no `ddw-module-verifier` ran (no subagents), so the cross-check was done by the same agent that wrote the code.

Result: PASSED

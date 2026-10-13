# Verification FEAT-008

| Field | Value |
|---|---|
| Module | apps/api/src/groups (link and candidates use cases, expense repository, payer movement recorder, routes), packages/shared (link schemas and error codes), apps/web/src/features/groups/expenses/link and the row action in the expenses list |
| Line coverage | 98% |
| Branch coverage | 87% |
| Function coverage | 93% |
| Coverage floor | 80% (AGENTS.md, "Testing") |
| Lint | `eslint`, `prettier --check --end-of-line auto` over the changed files and `tsc --noEmit` in `apps/api` and `apps/web` — clean |

An independent verifier (`ddw-module-verifier`, which did not write the code) read the code and the tests and blocked the first pass with one process gap and three real gaps. The rows below are the result after the fixes. The gaps were: the currency of an adopted movement was not checked again under the lock, so a race could bypass the currency rule (fixed in `drizzle-group-expense-repository.ts`, with a test that fails when the check is switched off); a 404 on submit in the adopt way showed "expense not found" and dropped the choices (fixed in `link-expense-container.tsx`, with a test that failed first); the 409 for editing an adopted movement had no test next to the link tests (it is asserted in `apps/api/test/movements/edit-lock.test.ts:174` on the state the link writes, recorded in the tests report); and some line references in the SAST report were stale (corrected). The late-written tests are a recorded waiver in the tests report. The fixes were not reviewed again by the verifier. The coverage and test counts are my account of the runs, not something DDW measured.

## Acceptance criteria
- ✅ AC-01 — strict link body: `link-payer-movement-routes.test.ts` (invalid bodies), the shared schema test, `api-client-group-link.test.ts` and `buildLinkRequest` in `group-expense-link-view.test.tsx`; code: `linkPayerMovementRequestSchema`
- ✅ AC-02 — create way records the movement and links it: routes test for create mode and the e2e `group-expense-link.spec.ts`; code: `link-payer-movement.ts`
- ✅ AC-03 — a member who is not the payer is refused with 403: routes test and the repository test that calls it directly
- ✅ AC-04 — a ghost payer is refused: routes test for a payer that is a ghost member
- ✅ AC-05 — a payer who left the group is refused: routes test
- ✅ AC-06 — a non-member or a missing group or expense answers 404: routes test
- ✅ AC-07 — the created movement has the expense amount, currency, date, frozen rate and category, and the account balance drops once: routes test and the e2e balance check
- ✅ AC-08 — an account that is foreign, archived or of another currency is refused with `GROUP_PAYER_ACCOUNT_INVALID`: routes test
- ✅ AC-09 — a category that is foreign or of the wrong type is refused with the same code: routes test
- ✅ AC-10 — deleting the expense keeps the created movement: routes test for delete
- ✅ AC-11 — adopt way links an existing movement without creating or changing one: routes test and the e2e, which checks the balance is unchanged
- ✅ AC-12 — an income movement is refused with `GROUP_MOVEMENT_NOT_EXPENSE`: routes test
- ✅ AC-13 — a movement already linked to another expense is refused: routes test and the repository test; two expenses racing for the same movement link only one
- ✅ AC-14 — a movement of another amount or currency is refused with 400 `GROUP_MOVEMENT_MISMATCH`: routes test; the currency is also checked again under the lock, with a repository test
- ✅ AC-15 — a movement that is missing or belongs to someone else answers 404: routes test, with the same body for both; the web screen keeps the choices on that 404
- ✅ AC-16 — deleting keeps and detaches the adopted movement, editing carries amount and date and keeps the note (routes tests); editing the amount, account or date from the movements screen answers 409 (`edit-lock.test.ts:174`)
- ✅ AC-17 — shares, version and activity log stay untouched: routes test and the repository test
- ✅ AC-18 — candidates are the payer's own unlinked expense movements of the same amount and currency, newest first, at most 20: routes tests and the shared schema test
- ✅ AC-19 — only the payer can list the candidates: routes test and use case test
- ✅ AC-20 — only the payer sees the link action, only for synced and unlinked expenses: `group-expenses-list.test.tsx` and the e2e
- ✅ AC-21 — the create form offers only usable accounts of the expense currency and the personal categories: `group-expense-link.test.tsx`
- ✅ AC-22 — loading, retry and empty states of the candidates, with the way back to create: `group-expense-link.test.tsx` and `group-expense-link-view.test.tsx`
- ✅ AC-23 — after a link the person returns to the list and sees the linked marker: container test and the e2e
- ✅ AC-24 — a refused link keeps what was chosen and shows the reason: container tests for a conflict, a network problem and a 404 on submit
- ✅ AC-25 — offline, nothing is sent and the screen says linking needs a connection: container test
- ✅ AC-26 — Spanish and English texts: view test in Spanish and the catalog parity test
- ✅ AC-27 — the view is presentational and makes no request: `group-expense-link-view.test.tsx`
- ✅ AC-28 — the expense row lock is taken before the write: repository test and the 20 simultaneous links test
- ✅ AC-29 — latency under 300 ms for links and candidate lists: `link-payer-movement.perf.test.ts`, run by me
- ✅ AC-30 — the expenses list makes no extra request: the AC-30 test in `group-expenses-list.test.tsx`
- ✅ AC-31 — foreign data answers 400 or 404 with the same body as missing data: routes tests for accounts, categories and movements
- ✅ AC-32 — the screen and the row fit 360 px and are reachable by keyboard: e2e `group-expense-link.spec.ts`, second scenario

## Spec blocks
- ✅ Block 1 — every task done; shared schemas, error codes, API domain errors, web client keys and catalog messages
- ✅ Block 2 — every task done; `LinkPayerMovement` and `ListMovementCandidates`, the repository link with the lock order group, movement, expense row, payer member, the recorder and the two routes
- ✅ Block 3 — every task done; the link screen with its container, view and request builder, the route, the row action and marker, and the e2e

## Tests
- ✅ Sad-path tests: bodies that are invalid, a non-payer, a ghost payer, a payer who left, a foreign account, category or movement, an income movement, a movement that is linked or of another amount or currency, a movement that changed between the read and the lock, a write that is rolled back, an offline device, a refused link and a network problem are each tested
- ✅ Test-first evidence: `docs/ddw/reports/tests-FEAT-008.md`, section "Tests written first", records which tests were seen red, which were written after the code, the evidence added after the verifier and the recorded waiver
- ✅ Suite: 6188 tests, 6186 passed, 0 failed, 2 skipped with a reason (a branch-relative scan of another ticket); the two e2e scenarios pass on their own database

## Not proven here
- The project-wide coverage floor over api, web and shared together is measured by CI; only the changed files were measured locally.
- The fixes made after the independent verification were not reviewed again by the verifier.
- The use case, repository and view tests written after the code were not seen red; this is a recorded waiver.
- The e2e needs `NODE_OPTIONS=--dns-result-order=ipv4first` on this machine because of the Docker IPv6 forwarding of the email port; CI is not affected by that.
- One test of the groups suite failed once under load in a full run and passed in two isolated reruns and in a clean full rerun.

Result: PASSED

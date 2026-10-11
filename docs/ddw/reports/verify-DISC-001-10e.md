# Verification DISC-001-10e

| Field | Value |
|---|---|
| Module | `apps/api/src/credit-cards` (automatic debit domain, use cases, claim log, source, job loop, `jobs.ts`, debit accounts route), `apps/api/src/movements/infrastructure/credit-cards` (transfer recorder), `apps/api/src/worker.ts`, `apps/api/src/shared/config/env.ts`, `apps/api/drizzle/0027_card_automatic_debit.sql`, `packages/shared/src/credit-cards`, `apps/web/src/features/credit-cards` (debit accounts form and request builder) |
| Line coverage | 96.76% |
| Branch coverage | 90.89% |
| Function coverage | 94.71% |
| Coverage floor | 80% (AGENTS.md, "Testing") |
| Lint | `pnpm exec eslint .` clean, `pnpm exec prettier --check --end-of-line auto .` clean, `tsc -p tsconfig.json` and `pnpm -r typecheck` clean |

Coverage numbers are the whole-repo run in `docs/ddw/reports/tests-DISC-001-10e.md` (387 files, 7061
tests, all passing; end to end `credit-cards-debit.spec.ts` 5 of 5 and the four regression flows 7 of 7).
The module was cross-checked by `ddw-module-verifier`, which did not write the code: PASSED WITH
WARNINGS, 11 of 11 acceptance criteria passing, none reported failing. Its two medium warnings (the missing
foreign-account recorder tests and a vacuous write-budget test) were fixed in commit `d92a603`; the
independent `ddw-arch-auditor` findings are resolved in `docs/ddw/security/sast-DISC-001-10e.md`.

## Traceability PRD to spec to code to tests

| Requirement | Spec blocks | Code | Tests |
|---|---|---|---|
| FR-01 link an automatic debit account per currency | 1, 2, 3, 5, 8, 10, 11, 12 | `set-card-debit-accounts.ts`, `drizzle-debit-accounts.ts`, `drizzle-credit-card-repository.ts`, `credit-card-routes.ts` (`PUT /credit-cards/:id/debit-accounts`), `debit-accounts-form.tsx`, `debit-accounts-request.ts` | `debit-accounts.test.ts`, `debit-account-routes.test.ts`, `automatic-debit-migration.test.ts`, web `debit-accounts.test.tsx`, `debit-accounts-request.test.ts` |
| FR-02 record the unpaid remainder on the due date | 4, 6, 7, 9, 12 | `domain/automatic-debit.ts`, `record-automatic-debits.ts`, `drizzle-automatic-debit-source.ts`, `drizzle-automatic-debit-recorder.ts`, `automatic-debit-job.ts` | `automatic-debit.test.ts`, `automatic-debit-job.test.ts`, `automatic-debit-adapters.test.ts`, e2e `credit-cards-debit.spec.ts` |
| FR-03 nothing when the remainder is 0 | 4, 7 | `unpaidRemainder` and the `covered` settlement | `automatic-debit.test.ts` (`records nothing in a currency whose statement total is 0`) |
| FR-04 nothing when the debit account is archived or gone | 4, 6, 12 | `record-automatic-debits.ts` (`skipped` settlement), `drizzle-card-account-links.ts` | `automatic-debit.test.ts`, `automatic-debit-job.test.ts`, e2e archived-account flow |
| NFR-01 integer money | 4, 12 | `bigint` remainder, claim table with no amount | `no-float-money.test.ts`, `automatic-debit-adapters.test.ts` (largest allowed amount) |
| NFR-02 06:00 plus 15 minutes, catch-up | 4, 7, 9 | `debitCandidates`, `AutomaticDebitJob`, `RECURRING_JOB_INTERVAL_SECONDS` | `automatic-debit.test.ts` (05:59 and 06:00, owner zone), `automatic-debit-job.test.ts` (passes every 60 s within 15 minutes) |
| NFR-03 idempotency | 2, 4, 6, 7 | primary key (card, period, currency), claim with `FOR UPDATE`, deterministic transfer id | `automatic-debit-job.test.ts` (three passes, simultaneous passes, crash then rerun), `automatic-debit-adapters.test.ts` |

## Acceptance criteria
- ✅ AC-01 — `links an ARS bank account with today and the card reads it back` (`apps/api/test/credit-cards/debit-accounts.test.ts`), `links an ARS bank account and shows it on GET` (`debit-account-routes.test.ts`), web `saves an ARS bank account and shows it as the saved link` (`apps/web/test/debit-accounts.test.tsx`), e2e `apps/web/e2e/credit-cards-debit.spec.ts`; code `SetCardDebitAccounts`
- ✅ AC-02 — `rejects a USD account linked for ARS and saves nothing` (`debit-accounts.test.ts`), route `answers 400 DEBIT_ACCOUNT_CURRENCY_MISMATCH` (`debit-account-routes.test.ts`), web `never offers a USD account for ARS nor an ARS one for USD` (`debit-accounts-request.test.ts`), e2e picker flow
- ✅ AC-03 — `records one transfer of the unpaid ARS remainder from the debit to the card account` (`apps/api/test/credit-cards/automatic-debit.test.ts`), `records the transfer at 06:10 local and moves both balances` (`automatic-debit-job.test.ts`), e2e first flow
- ✅ AC-04 — `records nothing in USD for a card with only an ARS debit account` (`automatic-debit.test.ts`), `links only ARS, leaves USD null, and null clears the link and its date` (`debit-accounts.test.ts`), e2e `a card with no USD debit account records nothing in USD`
- ✅ AC-05 — `rejects the card's own accounts and another card's linked account` and `answers ResourceNotFound for another user account` (`debit-accounts.test.ts`), route `answers 400 DEBIT_ACCOUNT_IS_CARD_ACCOUNT` and `answers 404 for an account of another user` (`debit-account-routes.test.ts`), database `refuses a debit account of another owner and one that is the card's own account` (`automatic-debit-migration.test.ts`)
- ✅ AC-06 — `records nothing when payments cover the total and settles it as covered` (`automatic-debit.test.ts`), real database `a statement paid by hand before the due time records nothing and settles covered` (`automatic-debit-job.test.ts`)
- ✅ AC-07 — `settles skipped as account_unavailable when the account is archived and never retries` (`automatic-debit.test.ts`), real database `an archived debit account leaves the statement unpaid, settles skipped and logs ids only` (`automatic-debit-job.test.ts`), e2e archived-account flow
- ✅ AC-08 — `has recorded the transfer by a pass at 06:10 local` (`automatic-debit.test.ts`), `records the transfer at 06:10 local and moves both balances` (`automatic-debit-job.test.ts`), e2e first flow
- ✅ AC-09 — `records 1 transfer over two sequential passes and reports alreadySettled` (`automatic-debit.test.ts`), `three passes over the same statement leave 1 transfer and 1 claim row` and `two passes running at the same time leave exactly 1 transfer` (`automatic-debit-job.test.ts`), `runs settle once when two claims start together` (`automatic-debit-adapters.test.ts`), e2e second pass
- ✅ AC-10 — `records once on the first pass days after the due date` and `never debits a statement due before the link date and debits one due on it` (`automatic-debit.test.ts`), `a job started after 06:00 that had no earlier pass records in its first pass` (`automatic-debit-job.test.ts`)
- ✅ AC-11 — `debits only what is left after a payment made by hand before the due date` (`automatic-debit.test.ts`), e2e `debits only the remainder of a partially paid statement`

## Spec blocks
- ✅ Block 1 — Shared contract and error codes: every task done; tests `packages/shared/test/credit-card-schemas.test.ts`
- ✅ Block 2 — Migration 0027 and schema: every task done; tests `automatic-debit-migration.test.ts`, `schema-introspection.test.ts`, the registry in `identity/migration.test.ts`; journal `when` 1791747000000, to be re-checked against `main` before merge
- ✅ Block 3 — Card domain and link use case: every task done; tests `debit-accounts.test.ts`
- ✅ Block 4 — Automatic debit domain and use case: every task done; tests `automatic-debit.test.ts`
- ✅ Block 5 — Linking adapters: every task done; tests `credit-card-repository.test.ts`, `erasure-step.test.ts`, `user-erasure.test.ts`
- ✅ Block 6 — Job adapters (source, claim log, transfer recorder): every task done; tests `automatic-debit-adapters.test.ts`
- ✅ Block 7 — Job loop and factory: every task done; tests `automatic-debit-job.test.ts`
- ✅ Block 8 — HTTP route and composition: every task done; tests `debit-account-routes.test.ts`, `credit-card-routes.test.ts`
- ✅ Block 9 — Worker wiring and environment: every task done; tests `automatic-debit-worker.test.ts`, `deploy/build-output.test.ts`
- ✅ Block 10 — Web client and request builder: every task done; tests `apps/web/test/debit-accounts-request.test.ts`, `api-client-credit-cards.test.ts`
- ✅ Block 11 — Web card screen: every task done; tests `apps/web/test/debit-accounts.test.tsx`, `credit-card-detail.test.tsx`
- ✅ Block 12 — End to end and guards: every task done; tests `apps/web/e2e/credit-cards-debit.spec.ts` (5 flows), `no-float-money.test.ts`

## Tests
- ✅ Sad-path tests: every input has one: a wrong-currency account, the card's own account, an account of another user, an archived account, a non-uuid card id, a missing session, an unverified email, an archived or removed debit account at the due date, a plain exception in one card that does not stop the next, a claim that rolls back and is retried, a malformed period and an inconsistent claim row at the database, a foreign source or destination account in the recorder, and in the web client a 404, a network failure, an unauthenticated save and a load failure
- ✅ NFR-01 to NFR-03 are asserted by the tests listed in the traceability table above, with the 15 minute window checked with a fake clock and the idempotency checked on a real database
- ⚠️ Test-first evidence is per implementer report, not per commit: each implementer reported tests failing before the implementation (suite-level `module not found` or assertion failures), but each block landed as one commit with its tests, so it cannot be recovered from git
- ⚠️ The migration `when` 1791747000000 (journal entry idx 27) must be re-checked against the maximum of `main` before merge and bumped if another migration landed first (Drizzle migration merge rule)
- ⚠️ Open low items, accepted as test-strength notes: L2 (the crash-rerun case settles with a null `movement_id`), L3, L4 and L6; none changes behavior
- ⚠️ The SHA-256 of the transfer id is written by hand in the domain because the domain may not import `node:crypto`; it is checked against the real digest by a test (documented decision D2)
- ⚠️ If the user deletes the transfer in the seconds between a crash and the rerun, the rerun records it once more, bounded to one remainder (residual edge of the threat model)

Result: PASSED

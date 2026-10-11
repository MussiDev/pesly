# Test run DISC-001-10e

| Field | Value |
|---|---|
| Runner | vitest (v8 coverage), Playwright for the end-to-end flows |
| Command | `TEST_DATABASE_URL=<local PostgreSQL, throwaway database> pnpm exec vitest run --coverage --maxWorkers=2 --retry=2` |
| Total | 7061 |
| Passed | 7061 |
| Failed | 0 |
| Skipped | 0 |
| Line coverage | 96.76% |
| Branch coverage | 90.89% |
| Function coverage | 94.71% |
| Coverage floor | 80% lines, 80% branches, 80% functions (AGENTS.md, "Testing") |
| Lint | `pnpm exec eslint .` clean, 0 findings; `pnpm exec prettier --check --end-of-line auto .` clean; `tsc -p tsconfig.json` and `pnpm -r typecheck` clean |

Whole-repo run over 387 test files (`apps/api`, `apps/web`, `packages/shared`). Statement coverage is
94.97%. The numbers come from the `coverage/coverage-summary.json` of this run (lines 11405 of 11786,
branches 7076 of 7785, functions 3332 of 3518, statements 12483 of 13144). `pnpm audit --prod
--audit-level high` reports "No known vulnerabilities found"; no dependency was added.

End to end (Playwright, one run at a time, with `NODE_OPTIONS=--dns-result-order=ipv4first` because
`wslrelay` shadows `localhost:1025` on IPv6 on this machine):

- `apps/web/e2e/credit-cards-debit.spec.ts`: 5 passed (5 of 5).
- Regression flows `recurring`, `notices`, `credit-cards` and `credit-cards-payments`: 7 passed (7 of 7).

## Failures
(none)

## Skips
(none)

## Coverage of the new files

The per-file figures are read from the same `coverage/coverage-summary.json` (lines, branches,
functions). The four files under `application/ports/` are type-only and have 0 statements.

| File | Lines | Branches | Functions |
|---|---|---|---|
| `apps/api/src/credit-cards/domain/automatic-debit.ts` | 100% | 76.31% | 100% |
| `apps/api/src/credit-cards/application/record-automatic-debits.ts` | 100% | 88.88% | 100% |
| `apps/api/src/credit-cards/application/set-card-debit-accounts.ts` | 100% | 94.11% | 100% |
| `apps/api/src/credit-cards/infrastructure/jobs/automatic-debit-job.ts` | 100% | 95.23% | 100% |
| `apps/api/src/credit-cards/jobs.ts` | 100% | 100% | 100% |
| `apps/api/src/credit-cards/infrastructure/db/drizzle-automatic-debit-log.ts` | 100% | 100% | 100% |
| `apps/api/src/credit-cards/infrastructure/db/drizzle-automatic-debit-source.ts` | 100% | 100% | 100% |
| `apps/api/src/credit-cards/infrastructure/db/drizzle-debit-accounts.ts` | 100% | 100% | 100% |
| `apps/api/src/movements/infrastructure/credit-cards/drizzle-automatic-debit-recorder.ts` | 100% | 100% | 100% |
| `apps/web/src/features/credit-cards/debit-accounts-request.ts` | 100% | 100% | 100% |
| `apps/web/src/features/credit-cards/components/debit-accounts-form.tsx` | 100% | 100% | 100% |

The branch figure of `domain/automatic-debit.ts` (76.31%) is the lowest of the new files and is under the
80% floor on its own; the floor is measured over the workspace, where the total is 90.89%. The file holds
the hand-written SHA-256, whose typed-array reads carry `?? 0` fallbacks that a valid input never takes;
this is a reading of the source, not a per-branch report.

## Acceptance criteria to tests

| AC | Tests |
|---|---|
| AC-01 | `debit-accounts.test.ts` (`links an ARS bank account with today and the card reads it back`), `debit-account-routes.test.ts` (`links an ARS bank account and shows it on GET`), web `debit-accounts.test.tsx` (`saves an ARS bank account and shows it as the saved link`), `debit-accounts-request.test.ts`, e2e `credit-cards-debit.spec.ts` (first flow), `automatic-debit-migration.test.ts` (`leaves existing cards with no automatic debit`) |
| AC-02 | `debit-accounts.test.ts` (`rejects a USD account linked for ARS and saves nothing`, `saves neither currency when one of them is invalid`), `debit-account-routes.test.ts` (`answers 400 DEBIT_ACCOUNT_CURRENCY_MISMATCH`), web `debit-accounts-request.test.ts` (`never offers a USD account for ARS nor an ARS one for USD`), `debit-accounts.test.tsx`, e2e `the ARS picker never lists a USD account or a card account` |
| AC-03 | `automatic-debit.test.ts` (`records one transfer of the unpaid ARS remainder from the debit to the card account`, `dates the transfer at noon of the due day in the owner zone`), `automatic-debit-job.test.ts` (`records the transfer at 06:10 local and moves both balances`), e2e first flow |
| AC-04 | `automatic-debit.test.ts` (`records nothing in USD for a card with only an ARS debit account`, `returns nothing without a debit account in that currency`), `debit-accounts.test.ts` (`links only ARS, leaves USD null, and null clears the link`), `automatic-debit-adapters.test.ts` (`returns no entry once the debit link is cleared`), e2e `a card with no USD debit account records nothing in USD` |
| AC-05 | `debit-accounts.test.ts` (`rejects the card's own accounts and another card's linked account`, `answers ResourceNotFound for another user account`), `debit-account-routes.test.ts` (`answers 400 DEBIT_ACCOUNT_IS_CARD_ACCOUNT`, `answers 404 for an account of another user`), `automatic-debit-migration.test.ts` (`refuses a debit account of another owner and one that is the card's own account`), web `debit-accounts-request.test.ts` (`never offers the card's own accounts`) |
| AC-06 | `automatic-debit.test.ts` (`records nothing when payments cover the total and settles it as covered`), `automatic-debit-job.test.ts` (`a statement paid by hand before the due time records nothing and settles covered`) |
| AC-07 | `automatic-debit.test.ts` (`settles skipped as account_unavailable when the account is archived and never retries`), `automatic-debit-job.test.ts` (`an archived debit account leaves the statement unpaid, settles skipped and logs ids only`), e2e `an archived debit account leaves the statement unpaid and records no transfer` |
| AC-08 | `automatic-debit.test.ts` (`has recorded the transfer by a pass at 06:10 local`), `automatic-debit-job.test.ts` (`records the transfer at 06:10 local and moves both balances`), e2e first flow |
| AC-09 | `automatic-debit.test.ts` (`records 1 transfer over two sequential passes`), `automatic-debit-job.test.ts` (`three passes over the same statement leave 1 transfer and 1 claim row`, `two passes running at the same time leave exactly 1 transfer`), `automatic-debit-adapters.test.ts` (`runs settle once when two claims start together`), e2e `a second pass adds no transfer` |
| AC-10 | `automatic-debit.test.ts` (`records once on the first pass days after the due date`, `never debits a statement due before the link date and debits one due on it`), `automatic-debit-job.test.ts` (`a job started after 06:00 that had no earlier pass records in its first pass`) |
| AC-11 | `automatic-debit.test.ts` (`debits only what is left after a payment made by hand before the due date`), e2e `debits only the remainder of a partially paid statement` |

## Non-functional requirements to tests

| NFR | Tests |
|---|---|
| NFR-01 (bigint money, no float) | `apps/api/test/credit-cards/no-float-money.test.ts` (scans the new debit files), `automatic-debit-adapters.test.ts` (`records a transfer of the largest allowed amount under the given id`), `automatic-debit.test.ts` (`puts no amount, account name or card name in the failures and info lines`), `automatic-debit-migration.test.ts` (the claim table stores no amount) |
| NFR-02 (06:00 plus 15 minutes, catch-up) | `automatic-debit.test.ts` (`records nothing at 05:59 local on the due date and records at 06:00`, `takes the 06:00 from the owner zone, not the process zone`), `automatic-debit-job.test.ts` (`passes every 60 s record the transfer within 15 minutes of 06:00 local`) |
| NFR-03 (idempotency, concurrency) | `automatic-debit.test.ts` (`gives the same movement id for the same key and another for any change`, `reports a plain Error with ids and class name only, rolls back and retries next pass`), `automatic-debit-job.test.ts` (`a crash after recording and before the claim commits is repaired by a rerun`, `records each owner transfer only between that owner accounts`), `automatic-debit-adapters.test.ts` (the recorder repeat and claim tests), `automatic-debit-migration.test.ts` (`refuses the same (card, period, currency) twice`), `erasure-step.test.ts` |

## Run anomalies

- The two end-to-end suites were run one at a time, as the local setup requires; `NODE_OPTIONS=--dns-result-order=ipv4first`
  was set because `wslrelay` answers on `localhost:1025` over IPv6 and shadows Mailpit. No test, timeout,
  worker count or threshold was changed to obtain the green run; `--retry=2` is the local setup the project
  notes recommend for the API race tests under load, and the run did not fail any test in the end.
- Failing-first evidence is per implementer report, not recoverable per commit (each block landed as one
  commit with its tests): the implementers reported suite-level `module not found` failures for the new
  domain, adapter and job files and assertion failures for the changes to existing files.
- The migration `when` of `0029_card_automatic_debit` (1791747000000) must be re-checked against the
  maximum of `main` before merge (see the Drizzle migration merge rule).

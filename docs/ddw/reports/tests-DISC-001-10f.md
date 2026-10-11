# Test run DISC-001-10f

| Field | Value |
|---|---|
| Runner | vitest (v8 coverage), Playwright for the end-to-end flows |
| Command | `TEST_DATABASE_URL=<local PostgreSQL, throwaway database> pnpm exec vitest run --coverage --maxWorkers=2 --retry=2` |
| Total | 7574 |
| Passed | 7574 |
| Failed | 0 |
| Skipped | 0 |
| Line coverage | 96.87% |
| Branch coverage | 90.92% |
| Function coverage | 94.69% |
| Coverage floor | 80% lines, 80% branches, 80% functions (AGENTS.md, "Testing") |
| Lint | `pnpm exec eslint .` clean, 0 findings; `pnpm exec prettier --check --end-of-line auto .` clean; `tsc -p tsconfig.json` and `pnpm -r typecheck` clean |

Whole-repo run over 420 test files (`apps/api`, `apps/web`, `packages/shared`). Statement coverage is
95.06%. The numbers come from the `coverage/coverage-summary.json` of this run (lines 12249 of 12644,
branches 7560 of 8315, functions 3585 of 3786, statements 13443 of 14141). `pnpm audit --prod
--audit-level high` reports "No known vulnerabilities found"; no dependency was added.

End to end (Playwright, one run at a time, with `NODE_OPTIONS=--dns-result-order=ipv4first` because
`wslrelay` shadows `localhost:1025` on IPv6 on this machine):

- `apps/web/e2e/credit-cards-reminders.spec.ts`: 5 passed (5 of 5).
- Regression flows `recurring`, `notices`, `credit-cards`, `credit-cards-debit` and `credit-cards-payments`: 12 passed (12 of 12).

## Failures
(none)

## Skips
(none)

## Coverage of the new and changed files

The per-file figures are read from the same `coverage/coverage-summary.json` (lines, branches,
functions). The two files under `application/ports/` are type-only and have 0 statements. `apps/api/src/worker.ts`
reports 0 of 35 statements because the worker entry point is never executed by the suite; its wiring is
asserted by the source-guard cases of `statement-reminder-worker.test.ts` and by the e2e flows, which start a
real worker.

| File | Lines | Branches | Functions |
|---|---|---|---|
| `apps/api/src/credit-cards/domain/statement-reminder.ts` | 100% | 83.33% | 100% |
| `apps/api/src/credit-cards/application/create-statement-reminders.ts` | 100% | 95% | 100% |
| `apps/api/src/credit-cards/application/update-credit-card-days.ts` | 100% | 91.66% | 100% |
| `apps/api/src/credit-cards/infrastructure/jobs/statement-reminder-job.ts` | 100% | 92.85% | 100% |
| `apps/api/src/credit-cards/infrastructure/db/drizzle-statement-reminder-source.ts` | 100% | 66.66% | 100% |
| `apps/api/src/credit-cards/infrastructure/db/drizzle-credit-card-repository.ts` | 96.61% | 87.5% | 100% |
| `apps/api/src/credit-cards/jobs.ts` | 100% | 100% | 100% |
| `apps/api/src/notices/domain/notice-text.ts` | 100% | 100% | 100% |
| `apps/api/src/notices/infrastructure/db/drizzle-statement-reminder-publisher.ts` | 100% | 100% | 100% |
| `packages/shared/src/credit-cards/credit-card.ts` | 100% | 100% | 100% |
| `apps/web/src/features/credit-cards/card-reminder-request.ts` | 100% | 100% | 100% |
| `apps/web/src/features/credit-cards/credit-card-form-errors.ts` | 100% | 83.33% | 100% |
| `apps/web/src/features/credit-cards/components/card-days-form.tsx` | 100% | 100% | 100% |
| `apps/web/src/features/credit-cards/components/credit-card-form.tsx` | 100% | 100% | 100% |
| `apps/web/src/features/credit-cards/containers/create-credit-card-container.tsx` | 97.14% | 91.66% | 100% |
| `apps/web/src/features/credit-cards/containers/credit-card-detail-container.tsx` | 97.77% | 81.81% | 94.11% |

The branch figure of `drizzle-statement-reminder-source.ts` (66.66%, 6 statements) is the lowest of the
touched files and is under the 80% floor on its own; the floor is measured over the workspace, where the total
is 90.92%. This is a reading of the summary, not a per-branch report; the file is exercised against a real
database by `statement-reminder-source.test.ts`.

## Acceptance criteria to tests

Paths: API tests are under `apps/api/test/credit-cards/` unless a directory is given; web tests under
`apps/web/test/`; shared tests under `packages/shared/test/`.

| AC | Tests |
|---|---|
| AC-01 | `statement-reminders.test.ts` (`creates the reminder at 2026-11-02 09:00 local and not on 2026-11-01 (AC-01)`), `statement-reminder-job.test.ts` (`at 09:10 local of the reminder day one pass creates the notice with the card name and the due date, no amount (AC-01)`, `a Spanish owner gets the Spanish text (AC-01)`), `statement-reminders-migration.test.ts` (`gives existing cards 3 after a rollback re-apply, and a new card without the field 3 (AC-01)`), e2e `credit-cards-reminders.spec.ts` first flow |
| AC-02 | `credit-card-schemas.test.ts` (`accepts a create request without reminderDays and with 0, 30 and 7 (AC-02)`, `requires reminderDays in the card response (AC-02)`), `use-cases.test.ts` (`stores reminderDays 3 when absent and the given value otherwise (AC-02)`), `credit-card-routes.test.ts` (`defaults the reminder days to 3 and stores the ones sent (FR-02)`), `credit-card-repository.test.ts` (`stores the reminder days on create and reads them back through findById and list`), web `credit-card-form.test.tsx` (`typing 7 sends reminderDays 7 with the card (AC-02)`), `credit-card-detail.test.tsx` (`shows the saved reminder days and the hint on the card (AC-02)`, `saving 7 sends only reminderDays and shows 7 afterwards, with no statement reload (AC-02, D5)`), `api-client-credit-cards.test.ts` (`sends reminderDays on create and on update and parses the card that carries it (AC-02)`, `maps a success body without reminderDays to unexpected (error path, AC-02)`), e2e first flow |
| AC-03 | `credit-card-schemas.test.ts` (`it.each([-1, 31, 3.5, '3', null, NaN, Infinity])` rejects, `reports only the failing path, never the typed value (AC-03)`), `credit-card-routes.test.ts` (`it.each([-1, 31, 1.5, '3'])` and `it.each([-1, 31, 2.5, '3', null])` answer 400), `statement-reminders-migration.test.ts` (`accepts 0 and 30 and refuses -1 and 31 with the named check (AC-03)`), `credit-card-repository.test.ts` (`accepts 0 and 30 and refuses 31 and -1 at the database (sad path)`), web `card-reminder-request.test.ts` (`it.each(['-1', '31', '2.5', 'abc', '', '  ', '1e1', '+3'])` return null), `credit-card-form.test.tsx` (`it.each(['-1', '31', '2.5'])`), `credit-card-detail.test.tsx` (`it.each(['-1', '31', '2.5', ''])`, `a 400 on a reminder-only save shows the reminder error, not the days conflict (sad path, AC-03)`), e2e `31 reminder days on the card page show the field error and keep the saved value (AC-03, sad path)` |
| AC-04 | `statement-reminders.test.ts` (`creates none when payments cover the total in ARS and USD (AC-04)`), `statement-reminder-job.test.ts` (`a statement already paid creates nothing (AC-04)`), e2e `a statement fully paid before its reminder day creates no notice while the other card notice appears (AC-04, sad path, no data)` |
| AC-05 | `statement-reminders.test.ts` (`creates the reminder of a due date moved from 11-05 to 11-10 on 11-07 and none on 11-02 (AC-05)`, `creates a second reminder for a due date moved after the first and keeps the first (AC-05)`), `statement-reminder-job.test.ts` (`a moved due date makes one new notice for the new date (AC-05)`), `statement-reminder-publisher.test.ts` (`same statement with another due date is a second notice and each pair is reported (AC-05)`), `statement-reminders-migration.test.ts` (`refuses a duplicate (kind, statement, due date) and accepts another due date (AC-05)`) |
| AC-06 | `statement-reminders.test.ts` (`creates 1 reminder over two sequential passes and reports alreadyPublished (AC-06)`), `statement-reminder-job.test.ts` (`three passes over the same statement leave 1 notice (NFR-02)`, `two passes running at the same time leave exactly 1 notice (NFR-02)`), `apps/api/test/notices/statement-reminder-publisher.test.ts` (`publishing the same statement and due date twice stores 1 notice (AC-06)`, `two calls started at the same time leave exactly 1 row (AC-06)`), e2e `a card with no total records no notice while the other card notice appears, and later passes leave exactly one (FR-03, AC-06)` |
| AC-07 | `statement-reminders.test.ts` (`creates the reminder once on a first pass days after the reminder day (AC-07)`, `creates on the due date at 09:00 and none the day after it (AC-07)`), `statement-reminder-job.test.ts` (`a job started after the reminder day and before the due date creates it in its first pass; after the due date none (AC-07)`) |
| AC-08 | `apps/api/test/notices/notice-text.test.ts` (`names the card and the due date in both languages (AC-08)`, `truncates a long card name to 80 characters and stays within 300 (AC-08)`), `apps/api/test/notices/no-sensitive-text.test.ts` (`never contains an amount or an account name in %s`), `apps/api/test/notices/statement-reminder-publisher.test.ts` (`stores the rendered notice and counts it (AC-08)`, cross-user cases), `statement-reminders.test.ts` (`reports failures without card name, amount, language or zone (AC-08)`), `statement-reminder-job.test.ts` (`each owner gets only the notice of their own card (cross-user)`), e2e first flow (reminder names the card, no amount) |
| AC-09 | `statement-reminder-job.test.ts` (`a deleted card creates nothing (AC-09)`), `statement-reminders.test.ts` (`creates nothing for a deleted card (AC-09)`), `statement-reminder-source.test.ts` (`returns no entry for a deleted card and none for an erased user (AC-09, sad path)`). The e2e `smoke: deleting a card with a due statement keeps the notices of other cards` is a smoke check only: a deletable card never owes a total, so it cannot prove AC-09; the real proof is the job integration test `statement-reminder-job.test.ts` |

## Functional requirements to tests

| FR | Tests |
|---|---|
| FR-01 (reminder at 09:00, 0 to 30 days, default 3) | `statement-reminders.test.ts` (`reminds at 09:00 of the due date with 0 days and 30 days before with 30 (FR-01)`, `reminds an open statement with a total and not one without it (FR-01)`), `statement-reminder-job.test.ts` (`a card whose reminder days are 0 reminds on the due date at 09:00 and never earlier`), `statement-reminder-source.test.ts` (`returns every card with the owner, zone and language of its user, paged without gaps (FR-01)`), `statement-reminders-migration.test.ts` (`accepts a notice of kind card_statement_due and refuses an unknown kind (FR-01)`), `notices/schema-introspection.test.ts` (`allows exactly the four notice kinds in the kind check (10f FR-01)`), shared `notice-contracts.test.ts` (`knows the four kinds`, `parses a card_statement_due notice in the list and rejects an unknown kind (FR-01)`) |
| FR-02 (reminder days on creation and edit) | `use-cases.test.ts` (`saves only reminderDays and leaves hand-edited open statement dates unchanged (FR-02, D5)`, `saves a day and reminderDays together and recomputes the open statements (FR-02)`, `keeps the stored reminderDays when a day change conflicts (sad path, FR-02)`, `saves nothing for another user's card on a reminder-only change (sad path, FR-02)`, `answers 404 for a missing card id and reads no statements (sad path, FR-02)`), `credit-card-routes.test.ts` (`changes only the reminder days and leaves the days and statements (FR-02)`, `audits a reminder change with request id, user id and card id, never the card name (FR-02)`, `answers 401 without a session and 403 before the email is verified on a reminder change (sad path)`, `answers 404 to another user changing the reminder days (sad path)`), `credit-card-repository.test.ts` (`does not change another user's reminder days (sad path)`), web `card-reminder-request.test.ts` (`sends only the reminder days when only they changed, never the days`, `returns null when nothing changed`), `api-client-credit-cards.test.ts` (`refuses ".." on update without a request (invalid input, FR-02)`) |
| FR-03 (none when covered or without a total) | `statement-reminders.test.ts` (`creates none for a total of 0 and one for a statement paid in ARS but owing USD (FR-03)`), `statement-reminder-job.test.ts` (`a statement with no total creates no notice while another card statement does (FR-01)`), e2e second flow (`FR-03, AC-06`) |
| FR-04 (follow a moved due date) | the AC-05 tests above |

## Non-functional requirements to tests

| NFR | Tests |
|---|---|
| NFR-01 (09:00 plus 15 minutes, catch-up) | `statement-reminders.test.ts` (`creates nothing at 08:59 local of the reminder day, creates at 09:00 and has by 09:10 (NFR-01)`, `takes the 09:00 from the owner zone, not the process zone (NFR-01)`, `starts reminding at 09:00 local`), `statement-reminder-job.test.ts` (`08:59 local creates nothing and 09:00 does, in two owner time zones (NFR-01)`, `with passes every 60 s the notice exists between 09:00 and 09:15 local (NFR-01)`), `statement-reminder-worker.test.ts` (`starts, runs a pass and stops twice without error (factory output over the real adapters)`, `sad path: stop() waits for the pass in progress before it resolves`) |
| NFR-02 (idempotency, concurrency) | `statement-reminder-job.test.ts` (three passes and two simultaneous passes, as in AC-06), `statement-reminder-publisher.test.ts` (`two calls started at the same time leave exactly 1 row (AC-06)`, `keys have the exact format of the credit-cards reminderKey`), `statement-reminders-migration.test.ts` (unique key and rollback cases), plus the guards `no-float-money.test.ts` (new files, planted float reported), `statement-reminder-job.test.ts` (`the module index does not export the job, the source or the factory (D11)`), `statement-reminder-worker.test.ts` (`sad path: the API entry server.ts never imports credit-cards/jobs`), `foundation/architecture-boundaries.test.ts` (notices adapter probe) |

## Run anomalies

- The end-to-end suites were run one at a time, as the local setup requires; `NODE_OPTIONS=--dns-result-order=ipv4first`
  was set because `wslrelay` answers on `localhost:1025` over IPv6 and shadows Mailpit. No test, timeout,
  worker count or threshold was changed to obtain the green run; `--retry=2` is the local setup the project
  notes recommend for the API race tests under load, and the run did not fail any test in the end.
- The e2e check of AC-09 is a smoke check, not a proof (see the AC-09 row): its real proof is
  `apps/api/test/credit-cards/statement-reminder-job.test.ts`.
- Failing-first evidence is per implementer report, not recoverable per commit (each block landed as one
  commit with its tests); it is listed per block in `docs/ddw/reports/verify-DISC-001-10f.md`. Some blocks
  failed only at suite level (`module not found`), not on a single assertion.
- The migration `when` of `0032_card_statement_reminders` (1791760600000) must be re-checked against the
  maximum of `main` before merge (see the Drizzle migration merge rule).

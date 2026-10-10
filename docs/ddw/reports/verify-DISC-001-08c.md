# Verification DISC-001-08c

| Field | Value |
|---|---|
| Module | `apps/api/src/notices`, `apps/api/src/recurring` (reminder pass, recording hooks, source, job), `apps/api/src/worker.ts`, `apps/api/src/server.ts`, `packages/shared/src/notices`, `apps/web/src/features/notices`, `apps/web/src/features/recurring`, `apps/web/src/features/shell` |
| Line coverage | 96.74% |
| Branch coverage | 90.99% |
| Function coverage | 94.87% |
| Coverage floor | 80% (AGENTS.md, "Testing") |
| Lint | `pnpm exec eslint .` clean, `pnpm exec prettier --check --end-of-line auto .` clean, `pnpm typecheck` clean |

Coverage numbers are the whole-repo run in `docs/ddw/reports/tests-DISC-001-08c.md` (363 files, 6686
tests, all passing, against a throwaway PostgreSQL). After that run two tests were changed in
`apps/api/test/recurring/create-due-reminders.test.ts` and `apps/api/test/notices/notice-repository.test.ts`
(a discriminating check for AC-03 and the storage-exception test of Block 4); those two files were rerun
alone (29 of 29 passing) and the full suite was not rerun. The module was cross-checked by a verifier
that did not write the code.

## Acceptance criteria
- ✅ AC-01 — `create without reminderDays parses to 3` (`packages/shared/test/notice-contracts.test.ts`), `creating without reminderDays stores and returns 3` (`apps/api/test/recurring/recurring-routes.test.ts`), web `sends reminderDays 3 when the field is left untouched`; code `createRecurringPaymentSchema`
- ✅ AC-02 — `reminderDays` -1, 31 and 1.5 at four layers: shared `it.each`, route `it.each` answering 400, DB check in `apps/api/test/notices/notices-migration.test.ts` (`refuses a reminder_days outside 0 to 30`), web `it.each`
- ✅ AC-03 — `editing from 3 to 0 returns 0 and the repository holds 0` (`recurring-routes.test.ts`), `editing the reminder days from 3 to 0 before the reminder day uses 0` (`apps/api/test/recurring/create-due-reminders.test.ts`, which now steps through the old reminder day and expects nothing), web `starts the edit form from the stored value`
- ✅ AC-04 — `creates the reminder at 09:00 owner time and not at 08:59` (`create-due-reminders.test.ts`), code `CreateDueReminders` (`apps/api/src/recurring/application/create-due-reminders.ts`)
- ✅ AC-05 — `Madrid 06:59 UTC creates nothing, 07:00 UTC creates it, whatever the process zone` (`create-due-reminders.test.ts`, process zone set to `Pacific/Auckland`)
- ✅ AC-06 — `a missed reminder day is created the next day` (`create-due-reminders.test.ts`)
- ✅ AC-07 — `a due date that has passed gets no reminder` (`create-due-reminders.test.ts`)
- ✅ AC-08 — `no reminder for a day before the payment was created or resumed` (`create-due-reminders.test.ts`)
- ✅ AC-09 — `a paused payment gets no reminder` (`create-due-reminders.test.ts`), `reminder-source.test.ts` for the active-only read
- ✅ AC-10 — `confirmed, skipped and recorded occurrences get no reminder, a pending one does` (`create-due-reminders.test.ts`), real database `not created for an occurrence already confirmed` (`reminder-job.test.ts`)
- ✅ AC-11 — `a payment past its end date and a deleted payment get no reminder` (`create-due-reminders.test.ts`)
- ✅ AC-12 — `publishes one recorded notice with the payment name and day and no amount` (`record-due-occurrences.test.ts`), real database `record-notices.test.ts`
- ✅ AC-13 — `an archived account leaves the occurrence pending and publishes one not_recorded` (`record-due-occurrences.test.ts`), real database `record-notices.test.ts`, `a plain recorder exception creates no not_recorded notice`
- ✅ AC-14 — `five more retries keep one not_recorded notice` (`record-due-occurrences.test.ts`), real database `after 6 passes` (`record-notices.test.ts`) carries the unique key
- ✅ AC-15 — `says "Luz vence mañana"` (`apps/api/test/notices/notice-text.test.ts`), code `renderNoticeText`
- ✅ AC-16 — `says "Electricity is due tomorrow"` (`notice-text.test.ts`)
- ✅ AC-17 — `never contains an amount or an account name` (`notice-text.test.ts`), `no-sensitive-text.test.ts` over both languages and the stored rows
- ✅ AC-18 — `returns the newest first with the unread count`, `pages 60 notices with no overlap and no gap`, `keeps pages stable when notices share the same created_at` (`notice-repository.test.ts`), route `pages 60 notices as 50 then 10` (`notices-routes.test.ts`)
- ✅ AC-19 — shared `it.each` over `limit` 51, 0, 1.5 and 'abc', undecodable and over-long cursors, route `rejects limit 51 and a malformed cursor with 400`
- ✅ AC-20 — `marks one read, keeps it listed and lowers the count by 1`, `keeps the first read_at when marked again` (`notice-repository.test.ts`), route `marks one read, keeps it in the list as read`
- ✅ AC-21 — `sets the unread count to 0 and touches only the caller notices` (`notice-repository.test.ts`), route `answers { unreadCount: 0 } and the next list shows 0 unread`
- ✅ AC-22 — `answers ResourceNotFound for another user notice and leaves the row unchanged` (`notice-repository.test.ts`), route `answers 404 NOT_FOUND and leaves it unread`, `never lists another user's notice`
- ✅ AC-23 — `publishing the same key three times keeps 1 row` (`notice-publisher.test.ts`), real database three-pass tests in `reminder-job.test.ts` and `record-notices.test.ts`
- ✅ AC-24 — `two concurrent publishes of the same key` (`notice-publisher.test.ts`), real database concurrent passes in `reminder-job.test.ts` and `record-notices.test.ts`
- ✅ AC-25 — `a publisher that throws keeps the expense, does not stop the others and logs ids only` (`record-due-occurrences.test.ts`), the three `CreateDueReminders` isolation tests (one payment, one page, one pass), `propagates a storage exception from the repository unchanged`
- ✅ AC-26 — `a time zone change to Asia/Tokyo creates the reminder at 09:00 Tokyo time` (`create-due-reminders.test.ts`)
- ✅ AC-27 — web `shows the number of unread notices on the link`, `caps at 99+` (`apps/web/test/notices.test.tsx`)
- ✅ AC-28 — web `lists the notices and marks an unread one read when tapped`, `puts the notice back as unread`, `shows the retry state`, `markup shown literally`; e2e `apps/web/e2e/notices.spec.ts`
- ✅ AC-29 — web `shows the reminder days field with 3 prefilled` (`apps/web/test/recurring-containers.test.tsx`)
- ✅ AC-30 — `removes all the user's notices through the owner cascade` (`apps/api/test/notices/erasure.test.ts`, through the real account deletion), the `notices` entry of the registry in `apps/api/test/identity/user-erasure.test.ts`

## Spec blocks
- ✅ Block 1 — Shared contracts: every task done; tests `packages/shared/test/notice-contracts.test.ts`, `recurring-contracts.test.ts`
- ✅ Block 2 — Migration 0025 and schema: every task done; tests `notices-migration.test.ts`, `notices/schema-introspection.test.ts`, the registry in `identity/migration.test.ts`; journal `when` 1791590000000 is above `origin/main`'s maximum 1791585171427
- ✅ Block 3 — `reminder_days` in the recurring module: every task done; tests `recurring-routes.test.ts`, `payment-repository.test.ts`
- ✅ Block 4 — Notices module: every task done; tests `notice-text.test.ts`, `notice-repository.test.ts`, `notice-publisher.test.ts` (the storage-error test of the repository was added at verification)
- ✅ Block 5 — Reminder pass: every task done; tests `create-due-reminders.test.ts`, `reminder-source.test.ts`, `reminder-job.test.ts`
- ✅ Block 6 — Recorded and not-recorded notices: every task done; tests `record-due-occurrences.test.ts`, `record-notices.test.ts`
- ✅ Block 7 — Notices API: every task done; tests `notices-routes.test.ts`, `erasure.test.ts`
- ✅ Block 8 — Web notices screen and badge: every task done; tests `apps/web/test/notices.test.tsx`, the shell navigation tests
- ✅ Block 9 — Web reminder days field: every task done; tests `recurring-request.test.ts`, `recurring-components.test.tsx`, `recurring-containers.test.tsx`
- ✅ Block 10 — Performance and guards: every task done; tests `perf/recurring-reminders.perf.test.ts`, `perf/notices-list.perf.test.ts`, `no-sensitive-text.test.ts`, `no-float-money.test.ts`

## Tests
- ✅ Sad-path tests: every input has one — `reminderDays` -1, 31 and 1.5 (shared, route, database check and web), `limit` 51, 0 and 1.5, an undecodable and an over-long cursor, a non-uuid notice id answering 400, a foreign or missing notice answering 404, no session answering 401, an unverified email answering 403, a reminder text without days, a publisher error, a plain recorder error and a storage error, and a planted float in the money guard
- ✅ NFR-01 `with a pass every 60 s, the reminder is created within 15 minutes` (`reminder-job.test.ts`), NFR-02 the unique index and the real-database concurrency tests, NFR-03 `creates 1,000 reminders out of 10,000 active payments in under 60 s` (0.5 s measured), NFR-04 `keeps p95 of GET /notices?limit=50 below 300 ms` (3.9 ms measured), NFR-05 `no-sensitive-text.test.ts` and `no-float-money.test.ts`
- ⚠️ W-VER-03: test timeouts and `ECONNRESET` appeared in earlier local full runs and hit different files each time; every file passed alone and the final full run was green (see the run anomalies in the tests report). Not a fragile assertion in this ticket
- ⚠️ The e2e flow seeds the notice by SQL instead of running the reminder pass, and its seeded text does not match its due date; the pass itself is covered by the real-database tests. Limitation of the harness, not of the feature
- ⚠️ A `recorded` notice is lost for good if publishing fails or the process dies right after the occurrence is confirmed; this follows FR-12 (the expense stays, the failure is logged with ids) and is accepted
- ⚠️ A confirmation in the milliseconds between the reminder pass reading resolved dates and inserting can still produce a reminder for a resolved occurrence; cosmetic, accepted
- ⚠️ A payment created today with 0 reminder days and a due date today gets its reminder right after 09:00, and an automatic one may also show a recorded notice; consistent with the PRD
- ⚠️ The notices adapter imports the recurring `NoticePublisher` port (type only, as the spec places it), which leaves two small language types; minor
- ⚠️ Test-first evidence is per implementer report, not per commit: each block landed as one commit with its tests. Failing-first counts are listed in the tests report

Result: PASSED

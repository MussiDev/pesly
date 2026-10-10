# Spec DISC-001-08b: Scheduler and automatic recording of recurring payments

| Field | Value |
|-------|-------|
| Ticket | DISC-001-08b |
| PRD | docs/ddw/prd/prd-DISC-001-08b.md |
| Tier | FEATURE |
| Date | 2026-10-09 |
| Spec loops | 3 |
| Loops since last human decision | 0 |

Human decision (2026-10-09): the project owner reviewed the spec after the third corrective loop,
including the architecture-audit changes (`.down.sql` rollback name, counted `OccurrenceNotPending`,
reported `ResourceNotFound`, noon `occurredAt`, sequential processing, the documented cross-owner
source), and approved it to move to CODE.

## Summary
A job inside the existing worker process wakes every 60 seconds, pages through the active automatic
recurring payments with their owner's time zone, and for each one records the expense of every due
occurrence through the movements module. The idempotency key is the movement id: the movement is
created with the occurrence's id, so a repeated or interrupted run meets `DuplicateMovementId`,
fetches the stored movement and only links it. A new column `auto_recording_from` on
`recurring_payments` (set on creation, resume, switch to automatic and schedule edits) separates the
due dates that are recorded from those that stay pending for the user (decision of 2026-10-09).
`MaterializeOccurrences` also creates the pending rows before that day for automatic payments, so the
user sees them at once. No new dependency and no new service.

## Coverage: PRD → blocks
| Requirement | Covered by |
|---|---|
| FR-01 | Block 3, Block 4 |
| FR-02 | Block 3, Block 4 |
| FR-03 | Block 3 |
| FR-04 | Block 3 |
| FR-05 | Block 1, Block 3 |
| FR-06 | Block 2, Block 3 |
| FR-07 | Block 3, Block 4 |
| FR-08 | Block 3, Block 4 |
| FR-09 | Block 3 |
| NFR-01 | Strategy: a 60 s interval (env `RECURRING_JOB_INTERVAL_SECONDS`, 1 to 300) against a 15 min window; the due check is `local time >= 06:00`, measured in the tests with a controlled clock |
| NFR-02 | Strategy: movement id equals occurrence id, `FOR UPDATE` on the occurrence and insert-or-ignore; tested with 3 sequential and 2 concurrent runs |
| NFR-03 | Strategy: keyset pages of 500 payments, one query per page, writes only for due payments; a benchmark with 10,000 payments and 1,000 due |
| NFR-04 | Strategy: every amount is `bigint`; the existing money guard test covers the new files |
| NFR-05 | Strategy: no state between runs apart from a bounded log de-duplication set that never affects what is recorded; a test starts a second job instance after the first stopped |

## Dependencies between blocks
Block 1 (column and domain) first. Block 2 (recorder) is independent of Block 1. Block 3 needs Blocks 1
and 2. Block 4 needs Block 3. Block 5 closes the registries, performance and documentation after
Block 4.

## Block 1 — Auto-recording start day: column and domain

**Files**
- `apps/api/drizzle/0024_recurring_auto_recording_from.sql` (new) — adds `auto_recording_from`
- `apps/api/drizzle/rollback/0024_recurring_auto_recording_from.down.sql` (new; same folder and
  `.down.sql` naming as `0023_recurring_payments.down.sql`) — drops the column
- `apps/api/drizzle/meta/_journal.json` (modified) — entry idx 24, `when` above 1791563194787
- `apps/api/drizzle/meta/0024_snapshot.json` (new) — drizzle snapshot, like every migration
- `apps/api/src/recurring/infrastructure/db/schema.ts` (modified) — column `autoRecordingFrom`
- `apps/api/src/recurring/domain/recurring-payment.ts` (modified) — field `autoRecordingFrom`
- `apps/api/src/recurring/application/ports/recurring-payment-repository.ts` (modified) — `setStatus`
  takes a changes object `{ status, scheduleFrom, autoRecordingFrom? }`
- `apps/api/src/recurring/infrastructure/db/drizzle-recurring-payment-repository.ts` (modified) —
  mapping and `setStatus`
- `apps/api/src/recurring/application/create-recurring-payment.ts` (modified) — sets the field to
  today in the owner's zone; dependencies add `timeZones` and `clock`
- `apps/api/src/recurring/application/resume-recurring-payment.ts` and `pause-recurring-payment.ts`
  (modified) — new `setStatus` shape; resume sets the field to today
- `apps/api/src/recurring/application/update-recurring-payment.ts` (modified) — sets the field to today
  when the mode changes to automatic or on the same edit that already deletes pending occurrences;
  dependencies add `timeZones` and `clock`
- `apps/api/test/recurring/fakes.ts`, `fixtures.ts`, `payment-repository.test.ts`,
  `recurring-perf.test.ts`, `use-cases.test.ts`, `schema-introspection.test.ts` (modified) — the new
  required field and the changed signature

**Logic**
The field is the first day whose due dates may be recorded without the user. Existing rows are
backfilled with the date of `created_at` in the owner's time zone (`users.time_zone`, UTC when the
name is not a zone PostgreSQL knows, so one bad value cannot abort the migration), which keeps 08a's automatic payments (never recorded so far) from recording the
past. The column keeps a `current_date` default (the database session's date, not the owner's) only as a
safety net so raw inserts in tests and seeds stay valid; every application insert sets the field
explicitly. Dropping the column in the rollback loses the start day, which is acceptable because the
change is otherwise additive.

**Data model**
- Entity `recurring_payments`: add `auto_recording_from date not null default current_date`.
  Backfill in the same migration: add nullable, `update ... set auto_recording_from = (created_at at
  time zone case when exists (select 1 from pg_timezone_names n where n.name = u.time_zone) then u.time_zone else 'UTC' end)::date` joined to `users`, then set not null with the default.
  No index: the job reads all active automatic payments.
- `RecurringPayment.autoRecordingFrom`: `YYYY-MM-DD` string like the other dates.

**Error handling**
- A migration failure rolls back its transaction (DDL is transactional in PostgreSQL).
- `setStatus` on a payment of another owner keeps raising `ResourceNotFound`.

**Required tests**
- [ ] migration adds the column, backfills it from the owner's zone and rolls back — validates FR-05
- [ ] new payment stores today in the owner's zone — validates AC-06
- [ ] resume sets the field to today and keeps `scheduleFrom` behavior — validates AC-07
- [ ] switching confirmation to automatic sets the field to today — validates AC-06
- [ ] sad path: `setStatus` for another owner's payment raises `ResourceNotFound`
- [ ] sad path: a failing migration rolls back its transaction and leaves the schema unchanged

**Completion criterion**
`pnpm --filter ./apps/api test -- recurring` passes with the column present, the rollback test restores
the 0023 schema, and `pnpm typecheck` is clean.

## Block 2 — Idempotent expense recorder

**Files**
- `apps/api/src/recurring/application/ports/expense-recorder.ts` (modified) — adds
  `recordOnce(scope, id, expense)` returning `{ id, occurredAt }`
- `apps/api/src/movements/infrastructure/accounts/drizzle-expense-recorder.ts` (modified) — the shared
  class gets `recordUnmeteredWithId` (the credit-cards port stays unchanged)
- `apps/api/src/movements/infrastructure/recurring/drizzle-recurring-expense-recorder.ts` (modified) —
  implements `recordOnce`
- `apps/api/test/recurring/fakes.ts` (modified) — `FakeExpenseRecorder.recordOnce`, idempotent by id
- `apps/api/test/movements/recurring-expense-recorder.test.ts` (new)

**Logic**
`recordOnce` calls `CreateMovement.execute(scope, input, id)` on the unmetered path (the job must not
spend the user's manual write budget). On `DuplicateMovementId` it reads the stored movement with
`MovementRepository.findById(scope, id)` and returns it, so the caller treats both outcomes alike. A
duplicate with no stored movement for this owner raises `ResourceNotFound`, because the id belongs to
someone else. The existing `record` keeps using the manual limiter.

**Input validation**
- `id`: a UUID read from the database (the occurrence id), never from a request.
- `expense`: validated by `CreateMovement` (amount range, account and category ownership, expense kind).

**Error handling**
- Archived account, missing rate, closed category: the movement errors propagate unchanged.
- `DuplicateMovementId` is handled inside; any other error propagates.

**Required tests**
- [ ] records one movement with the given id and returns it — validates AC-01
- [ ] second call with the same id returns the stored movement and writes nothing — validates AC-08
- [ ] sad path: an id owned by another user raises `ResourceNotFound`
- [ ] sad path: an archived account raises the movement error and writes nothing — validates AC-03

**Completion criterion**
The two new recorder tests pass and the credit-cards recorder tests still pass unchanged.

## Block 3 — Use cases: record due occurrences

**Files**
- `apps/api/src/recurring/application/ports/automatic-payment-source.ts` (new) — `page(afterId,
  limit)` returns payments with `timeZone`, keyset by id
- `apps/api/src/recurring/application/ports/occurrence-repository.ts` (modified) — adds
  `listRecordable(scope, paymentId, from, to)` returning pending occurrences with their ids
- `apps/api/src/recurring/application/record-due-occurrences.ts` (new)
- `apps/api/src/recurring/application/materialize-occurrences.ts` (modified) — automatic payments
  materialize pending rows only for dates before `autoRecordingFrom`
- `apps/api/src/recurring/infrastructure/db/drizzle-occurrence-repository.ts` (modified) —
  `listRecordable`
- `apps/api/test/recurring/fakes.ts` (modified) — fake source and repository method
- `apps/api/test/recurring/record-due-occurrences.test.ts` (new)

**Logic**
For each payment of a page: take the owner's clock (`todayInTimeZone` and the local time), the due
dates from `max(scheduleFrom, startDate, today - 366 days)` to today, counting today only when the
local time is 06:00 or later. Insert-or-ignore the occurrence rows for those dates. Dates before
`autoRecordingFrom` stay pending and are never recorded. For the others, `listRecordable` returns the
pending rows and each one goes through `withLockedPending` with the movement id set to the occurrence
id: `recordOnce` runs inside, and the resolution is `confirmed` with `confirmedAmount` equal to the
payment's amount and the movement id. The scope of the owner is built by the caller (Block 4). The movement is placed at noon of the due date
in the owner's zone, with the UTC fallback, exactly as `ConfirmOccurrence` does, never at the run time.
The floor of the due-date window reuses `MATERIALIZE_LOOKBACK_DAYS`. Payments and occurrences are
processed one after another: `withLockedPending` holds the occurrence row lock while the recorder
commits the movement on its own connection, which is safe because the movement id makes a repeat
idempotent (AC-10), and sequential processing keeps one pool connection per pass in use.
`OccurrenceNotPending` is the only error skipped as benign (another process resolved the row); it is
caught by an explicit `instanceof` and counted as `skippedAlreadyResolved`. `ResourceNotFound` raised
by `recordOnce` (a movement id owned by someone else) is a reported failure. `ResourceNotFound` raised by
`withLockedPending` (the row was deleted by a schedule edit during the pass) is counted as
`skippedMissing` and logged at info level. Any other error leaves the occurrence pending, is passed to
a `report` callback with identifiers only, and the loop continues with the next occurrence and payment.
The source excludes erased users through its join on `users`. A paused, ended or
deleted payment is never returned by the source. The use case returns counters for the log.

**Error handling**
- Recorder errors (archived account, no rate, rate limit): occurrence stays pending, retried next run.
- `OccurrenceNotPending` is counted as already resolved; `ResourceNotFound` from `recordOnce` is reported as a failure; `ResourceNotFound` from `withLockedPending` is counted as missing.
- A zone name the runtime rejects falls back to the stored default, as `DrizzleUserTimeZone` does.

**Required tests**
- [ ] records an expense for a due occurrence and resolves it linked to the movement — validates AC-01
- [ ] Madrid 03:59 UTC records nothing, 04:00 UTC records — validates AC-02
- [ ] archived account leaves the occurrence pending and listed — validates AC-03
- [ ] confirming a pending left by the job records exactly one expense — validates AC-04
- [ ] three missed daily dates are recorded on the next run with their own dates — validates AC-05
- [ ] due dates before `autoRecordingFrom` stay pending and record nothing — validates AC-06
- [ ] a resumed payment records nothing for the paused interval — validates AC-07
- [ ] three runs in a row leave one expense per occurrence — validates AC-08
- [ ] a crash after the expense and before the resolution links the existing expense on the next run — validates AC-10
- [ ] paused, ended and deleted payments record nothing — validates AC-11
- [ ] one failing payment among three does not stop the others and is retried — validates AC-12
- [ ] a zone change from Buenos Aires to Tokyo moves the due time — validates AC-13
- [ ] the recorded occurrence leaves upcoming payments — validates AC-14
- [ ] sad path: `OccurrenceNotPending` is counted as already resolved and raises nothing
- [ ] sad path: `ResourceNotFound` from `recordOnce` is reported as a failure with ids only
- [ ] sad path: `ResourceNotFound` from `withLockedPending` is counted as missing and logged at info level
- [ ] the movement is dated at noon of the due date in the owner's zone, not at the run time
- [ ] sad path: a recorder error such as a missing exchange rate or a rate limit leaves the occurrence pending and retried on the next run — validates AC-12
- [ ] sad path: a zone name the runtime rejects falls back to the stored default zone

**Completion criterion**
`record-due-occurrences.test.ts` and the updated materialize tests pass, with every listed test green.

## Block 4 — Job, source, wiring and configuration

**Files**
- `apps/api/src/recurring/infrastructure/db/drizzle-automatic-payment-source.ts` (new) — keyset pages
  of active automatic payments joined to `users.time_zone`
- `apps/api/src/recurring/infrastructure/jobs/recording-job.ts` (new) — `setTimeout` chain with
  an in-flight promise and a stopped flag, like `investments/.../snapshot-job.ts`
- `apps/api/src/recurring/jobs.ts` (new) — `createRecurringJobs({ db, logger, recorder, clock?,
  intervalSeconds })` returning `{ start, stop }` like `InvestmentsJobs`; worker-side only, not
  re-exported by the module index; neither this file nor the job imports from `movements` (the
  recorder is injected, and the existing lint rule covers `recurring/**`)
- `apps/api/src/worker.ts` (modified) — builds the recorder with `createRecurringExpenseRecorder`,
  starts the job, logs its start like the other jobs and stops it in the `Promise.all` of the shutdown
- `apps/api/src/shared/config/env.ts` (modified) — `RECURRING_JOB_INTERVAL_SECONDS` in the worker
  fields and its raw interface
- `apps/api/test/foundation/worker-env.test.ts`, `env.test.ts`, `apps/api/test/helpers/test-env.ts`
  (modified) — the new variable
- `apps/api/test/recurring/recording-job.test.ts`, `automatic-payment-source.test.ts` (new)
- `.env.example` (modified; confirm it by hand, the scan could not read it)

**Logic**
The factory builds the policy once (`OwnerOrGroupMemberAccessPolicy` over `DenyAllGroupMembershipReader`)
and issues one write scope per payment owner from a synthetic `AuthContext` (`sessionId` a fixed job
marker that no audit line or limiter key persists, `emailVerified: true`), the only constructor of a
write scope; the `userId` comes solely from the source's `users` join, never from input.
`AutomaticPaymentSource.page` is an approved exception to owner scoping: it is a cross-owner read for
the system job, returns identifiers, the schedule fields and the time zone only, and is reachable only
from the worker. The job runs one pass, waits the
interval, repeats; an exception in a pass is logged and the next pass still runs; `stop()` waits for
the pass in progress and is idempotent. Failures are logged with payment and occurrence ids only. A
bounded set (10,000 keys, cleared when full) de-duplicates the log of an error that repeats every
pass; its key is the occurrence id plus the error class, never a message; it never decides what is
recorded. `RECURRING_JOB_INTERVAL_SECONDS` stays out of Railway: the default 60 applies, so
`.railway/railway.ts` and its test do not change.

**Input validation**
- `RECURRING_JOB_INTERVAL_SECONDS`: integer string, 1 to 300, default 60; other values fail worker
  start-up with the env error (Zod schema in `env.ts`).

**Error handling**
- Database down during a pass: the pass fails, is logged, and the next interval retries.
- Shutdown during a pass: `stop()` waits for the pass, then the pool closes.

**Required tests**
- [ ] two job processes over the same due occurrence leave one expense — validates AC-09
- [ ] the job records at 06:00 and not before, with a controlled clock and a 60 s interval — validates AC-15
- [ ] a pass that throws does not stop the job; `stop()` twice is harmless
- [ ] sad path: a database failure during a pass is logged and the next interval retries it
- [ ] sad path: shutdown during a pass waits for the pass and then closes
- [ ] a second job instance started after the first stopped loses nothing — validates AC-08
- [ ] sad path: `RECURRING_JOB_INTERVAL_SECONDS` of 0, 301 and `abc` fail the worker env
- [ ] the source pages by keyset and returns only active automatic payments of existing users — validates AC-11

**Completion criterion**
Job, source and env tests pass, `pnpm --filter ./apps/api build` succeeds and `worker.ts` starts and
stops the job without leaving open handles in its test.

## Block 5 — Registries, performance and documentation

**Files**
- `apps/api/test/identity/migration.test.ts` (modified) — the rollback chain starts at 0024; a shared
  helper replaces the repeated `rollback('0023_recurring_payments')` heads
- `apps/api/test/identity/user-erasure.test.ts` (modified) — the raw insert and the erasure run with
  the new column
- `apps/api/test/recurring/recurring-perf.test.ts` (modified) — benchmark of the job
- `apps/api/test/recurring/no-float-money.test.ts` (modified) — covers the new files
- `CHANGELOG.md` (modified)

**Data model**
No schema change in this block; the constraints are those of Block 1 (`auto_recording_from date not null default current_date`). The tests only exercise them.

**Error handling**
- A registry test that still expects 0023 as the newest migration fails loudly; the helper makes the head one constant.
- The benchmark fails the run when the pass takes 60 s or more.

**Logic**
Registries are updated so the migration chain, the erasure test and the money guard include the new
column and files. The benchmark seeds 10,000 active automatic payments with 1,000 due and runs one pass
against the recording fakes of the movement side and the real repositories.

**Required tests**
- [ ] one pass over 10,000 payments with 1,000 due finishes in under 60 s — validates AC-16
- [ ] the migration chain test rolls back 0024 then 0023 and finds the schema as before 0023
- [ ] erasure removes a user's automatic payments and occurrences with the new column
- [ ] sad path: the money guard fails when a float is introduced in the new job files
- [ ] sad path: a registry test that still expects 0023 as the newest migration fails loudly, proving the helper holds the head in one constant
- [ ] sad path: the benchmark fails the run when the pass takes 60 s or more

**Completion criterion**
The whole suite passes with coverage over 80% lines, branches and functions, lint, typecheck and
Prettier are clean, and the CHANGELOG entry exists.

## Final verification
Every AC of the PRD has a test by name; the job records on a due date at 06:00 owner time, exactly
once under repeated, concurrent and interrupted runs; payments created or resumed today record nothing
for earlier dates; the full suite, coverage, SAST and the benchmark are green.

# Spec DISC-001-08c: Reminders and In-App Notices

| Field | Value |
|-------|-------|
| Ticket | DISC-001-08c |
| PRD | docs/ddw/prd/prd-DISC-001-08c.md |
| Tier | FEATURE |
| Date | 2026-10-10 |
| Spec loops | 0 |
| Loops since last human decision | 0 |

## Summary
A new `notices` module stores one row per notice (`reminder`, `recorded`, `not_recorded`) with its text
already rendered in the owner's language, and serves it through three owner-scoped routes. The
recurring module gains a `reminder_days` column and two producers: a reminder pass (`CreateDueReminders`,
its own `setTimeout` chain next to the 08b recording job) and two hooks inside `RecordDueOccurrences`
(recorded, not recorded). Recurring publishes through a `NoticePublisher` port; the worker injects the
notices adapter, as it does with the expense recorder, so recurring never imports notices internals.
Idempotency is a unique index on (kind, payment, due date) plus `ON CONFLICT DO NOTHING`, so repeated
runs and two processes cannot duplicate. The web app gets a notices screen, an unread badge in the
shell and a reminder-days field. No new runtime dependency: text and dates use the built-in `Intl`.

## Coverage: PRD → blocks
| Requirement | Covered by |
|---|---|
| FR-01 | Block 1, Block 2, Block 3, Block 9 |
| FR-02 | Block 5 |
| FR-03 | Block 5 |
| FR-04 | Block 5 |
| FR-05 | Block 4, Block 6 |
| FR-06 | Block 4, Block 6 |
| FR-07 | Block 4 |
| FR-08 | Block 1, Block 4, Block 7 |
| FR-09 | Block 1, Block 4, Block 7 |
| FR-10 | Block 4, Block 7 |
| FR-11 | Block 2, Block 4, Block 5, Block 6 |
| FR-12 | Block 6 |
| FR-13 | Block 5 |
| FR-14 | Block 8, Block 9 |
| FR-15 | Block 2, Block 7 |
| NFR-01 | Strategy: the reminder pass runs every `RECURRING_JOB_INTERVAL_SECONDS` (1 to 300, default 60), so a reminder is created within 5 minutes of 09:00 owner-local at most and within 1 minute by default; asserted in Block 5 with a fake clock stepping every 60 s. |
| NFR-02 | Strategy: unique index `notices_kind_payment_due_unique` and `ON CONFLICT DO NOTHING` (Block 2, Block 4); asserted with 3 sequential passes and 2 concurrent passes (Block 5, Block 6). |
| NFR-03 | Strategy: keyset pages of 500 payments, one query per page for resolved occurrences and one multi-row insert per page, no per-payment round trip; benchmark in Block 10. |
| NFR-04 | Strategy: index `notices_owner_created_idx` (owner, created_at desc, id desc) serves the keyset page, partial index `notices_owner_unread_idx` serves the unread count; benchmark in Block 10. |
| NFR-05 | Strategy: the text is built only from the payment name, the day and the language by a pure function that receives no amount and no account name; guard test over both languages (Block 4, Block 10). |

## Dependencies between blocks
Order: 1 → 2 → 3 and 4 (independent of each other, both need 2) → 5 and 6 (both need 3 and 4) → 7 (needs
4) → 8 (needs 1 and 7) → 9 (needs 1 and 3) → 10 (needs all). Blocks 5 and 6 touch different files of the
recurring module except `jobs.ts`, which Block 5 creates the wiring in and Block 6 completes.

## Block 1 — Shared contracts

**Files**
- `packages/shared/src/notices/notice.ts` (new) — Zod schemas and types of the notices API.
- `packages/shared/src/notices/index.ts` (new) — barrel.
- `packages/shared/src/index.ts` (modified) — exports `./notices`.
- `packages/shared/src/recurring/recurring-payment.ts` (modified) — `reminderDays` on create (optional, default 3), update (optional) and response.

**Logic**
`reminderDaysSchema` is `z.number().int().min(0).max(30)`; the create validator applies `.default(3)` so
a request without it stores 3. `listNoticesQuerySchema`: `limit` coerced integer 1 to 50 (default 20) and
optional `cursor` string. `noticeKindSchema` is `z.enum(['reminder', 'recorded', 'not_recorded'])`. The
cursor is opaque base64url; a helper `decodeNoticeCursor` returns `{ createdAt, id }` or `null`, and the
query validator refines the cursor so an invalid one fails validation.

**API contract**
Contracts only; the routes that use them are `GET /notices` (Block 7) and `POST /recurring/payments`
(Block 3).
- Request: `{ limit?: 1..50, cursor?: string }`.
- Response: `{ items: Notice[], nextCursor: string | null, unreadCount: number }` with
  `Notice = { id, kind, text, dueDate, createdAt, readAt: string | null }`.
- Error codes: `VALIDATION_FAILED` (400).
- Auth: not applicable here (the routes carry it).

**Input validation**
- `reminderDays`: integer 0 to 30; -1, 31 and 1.5 are rejected.
- `limit`: integer 1 to 50; `cursor`: at most 200 characters, base64url, decodes to a timestamp and a uuid.

**Error handling**
- A schema failure is reported by the shared validation middleware as `VALIDATION_FAILED` listing paths only.

**Required tests**
- [ ] the create validator without `reminderDays` parses to 3 — validates AC-01
- [ ] `reminderDays` of -1, 31 and 1.5 fail with a `VALIDATION_FAILED`-mappable issue on the path — validates AC-02
- [ ] update schema accepts `reminderDays: 0` alone — validates AC-03
- [ ] list query: `limit` 51, `limit` 0 and a cursor that does not decode all fail validation — validates AC-19
- [ ] list query accepts `limit` 50 and a cursor produced by the encoder — validates AC-18

**Completion criterion**
The shared tests above pass, `pnpm typecheck` passes across the workspace and the notices barrel is exported.

## Block 2 — Migration 0025 and schema

**Files**
- `apps/api/drizzle/0025_notices.sql` (new) — adds `recurring_payments.reminder_days` and creates `notices`.
- `apps/api/drizzle/rollback/0025_notices.down.sql` (new) — drops the table and the column, runnable twice.
- `apps/api/drizzle/meta/0025_snapshot.json` (new) — snapshot chained from `0024_snapshot.json`.
- `apps/api/drizzle/meta/_journal.json` (modified) — entry `idx 25`, `when` greater than 1791585171427 and greater than the maximum on `main` at merge time.
- `apps/api/src/recurring/infrastructure/db/schema.ts` (modified) — `reminderDays` column and check.
- `apps/api/src/notices/infrastructure/db/schema.ts` (new) — the `notices` table.
- `apps/api/src/notices/infrastructure/db/foreign-relations.ts` (new) — re-exports `users` (the only cross-module import of the module).
- `apps/api/drizzle.config.ts` (modified, only if it lists schema files) — includes the notices schema.

**Logic**
`ALTER TABLE recurring_payments ADD COLUMN reminder_days smallint NOT NULL DEFAULT 3` (an additive,
non-destructive change; existing rows get 3) with a check 0 to 30. `CREATE TABLE notices`. The rollback
is the reverse and drops only what 0025 created.

**Data model**
`recurring_payments.reminder_days smallint not null default 3`, check `reminder_days between 0 and 30`.

`notices`
- `id uuid primary key default gen_random_uuid()`
- `owner_id uuid not null` references `users(id)` on delete cascade
- `kind text not null`, check in (`reminder`, `recorded`, `not_recorded`)
- `payment_id uuid not null`, no foreign key on purpose: the notice outlives the payment, as `movement_id` does
- `due_date date not null`
- `text text not null`, check `char_length(text) between 1 and 300`
- `created_at timestamptz not null default now()`
- `read_at timestamptz null`
- unique `notices_kind_payment_due_unique` on (`kind`, `payment_id`, `due_date`)
- index `notices_owner_created_idx` on (`owner_id`, `created_at` desc, `id` desc)
- partial index `notices_owner_unread_idx` on (`owner_id`) where `read_at is null`

**Input validation**
Not applicable: no input; the database refuses a kind, a length or a duplicate outside these rules.

**Error handling**
- A duplicate (kind, payment, due date) raises a unique violation, which the repository turns into "nothing inserted" through `ON CONFLICT DO NOTHING` (Block 4).
- A `reminder_days` outside 0 to 30 raises a check violation (`recurring_payments_reminder_days_check`).

**Required tests**
- [ ] migration registry: journal entry idx 25 exists, its `when` is the greatest of the journal, and `0025_snapshot.json` chains on 0024's id — validates NFR-02
- [ ] after the migration, existing recurring payments have `reminder_days` 3 — validates AC-01
- [ ] inserting `reminder_days` 31 is an error: `recurring_payments_reminder_days_check` is violated — validates AC-02
- [ ] inserting the same (kind, payment, due date) twice is a duplicate that raises the unique violation, and a different kind succeeds — validates AC-23
- [ ] inserting a `kind` outside the three, or a `text` of 301 characters, is an error from the checks — validates NFR-05
- [ ] deleting the user cascades to their notices and leaves other users' notices — validates AC-30
- [ ] the rollback runs twice and restores the 0024 schema; the migration re-applies — validates NFR-02
- [ ] introspection: the `notices` indexes and `owner_id` foreign key exist as declared — validates NFR-04

**Completion criterion**
`pnpm --filter ./apps/api test` passes the migration and introspection tests against a fresh database and
the journal `when` is above 1791585171427 (and above `main`'s maximum at the time of merge).

## Block 3 — `reminder_days` in the recurring module

**Files**
- `apps/api/src/recurring/domain/recurring-payment.ts` (modified) — `reminderDays: number` on `RecurringPayment`.
- `apps/api/src/recurring/application/create-recurring-payment.ts` (modified) — passes `reminderDays`.
- `apps/api/src/recurring/application/update-recurring-payment.ts` (modified) — accepts `reminderDays`.
- `apps/api/src/recurring/application/ports/recurring-payment-repository.ts` (modified) — create and update inputs carry it.
- `apps/api/src/recurring/infrastructure/db/drizzle-recurring-payment-repository.ts` (modified) — maps the column.
- `apps/api/src/recurring/infrastructure/db/drizzle-automatic-payment-source.ts` (modified) — selects `reminderDays`.
- `apps/api/src/recurring/infrastructure/http/recurring-presenter.ts` (modified) — emits `reminderDays`.
- `apps/api/test/recurring/fixtures.ts` (modified) — `rentOf` accepts `reminderDays`.

**Logic**
The value travels from the validated body to the column and back in `GET`/`POST`/`PATCH` responses.
Editing it changes nothing already created: reminders read the current value when they are created
(Block 5).

**Data model**
`recurring_payments.reminder_days smallint not null default 3` with a check between 0 and 30 (added in
Block 2); the repository maps it to `RecurringPayment.reminderDays`.

**API contract**
Existing `POST /recurring/payments` and `PATCH /recurring/payments/:id` (both modified).
- Request: the 08a body plus `reminderDays?: integer 0..30` (create default 3).
- Response: the 08a payment plus `reminderDays: integer`.
- Error codes: `VALIDATION_FAILED` (400), `NOT_FOUND` (404).
- Auth: session and verified email, write scope (unchanged).

**Input validation**
`reminderDays` integer 0 to 30 through the shared schema of Block 1; the route reads no unvalidated body.

**Error handling**
- Out of range or fractional `reminderDays`: `VALIDATION_FAILED`, nothing stored.
- Another user's payment id on `PATCH`: `NOT_FOUND`, the payment is left unchanged.

**Required tests**
- [ ] creating without `reminderDays` stores and returns 3 — validates AC-01
- [ ] creating with -1, 31 and 1.5 answers 400 `VALIDATION_FAILED` and stores nothing — validates AC-02
- [ ] editing from 3 to 0 returns 0 and the repository holds 0 — validates AC-03
- [ ] `PATCH` of another user's payment answers 404 `NOT_FOUND` and leaves `reminderDays` unchanged — validates AC-22

**Completion criterion**
The recurring route and repository tests pass with `reminderDays` present in every payment response, and
the 08a/08b recurring suites still pass.

## Block 4 — Notices module: text, repository, publisher

**Files**
- `apps/api/src/notices/domain/notice.ts` (new) — `Notice`, `NoticeKind`, `NewNotice`.
- `apps/api/src/notices/domain/notice-text.ts` (new) — pure `renderNoticeText`.
- `apps/api/src/notices/application/ports/notice-repository.ts` (new) — `NoticeRepository` port.
- `apps/api/src/notices/application/list-notices.ts` (new) — keyset page and unread count.
- `apps/api/src/notices/application/mark-notice-read.ts` (new) — one notice.
- `apps/api/src/notices/application/mark-all-notices-read.ts` (new) — all of the caller's notices.
- `apps/api/src/notices/infrastructure/db/drizzle-notice-repository.ts` (new) — Drizzle implementation.
- `apps/api/src/notices/infrastructure/db/drizzle-notice-publisher.ts` (new) — implements the recurring `NoticePublisher` port with `ON CONFLICT DO NOTHING`.
- `apps/api/src/recurring/application/ports/notice-publisher.ts` (new) — the port recurring depends on.
- `apps/api/src/notices/index.ts` (new) — barrel (routes factory, publisher factory).

**Logic**
`renderNoticeText({ kind, language, paymentName, daysUntilDue, dueDate })` returns:
- `reminder`, 0 days: `{name} vence hoy` / `{name} is due today`; 1 day: `{name} vence mañana` / `{name} is due tomorrow`; N days: `{name} vence en {N} días` / `{name} is due in {N} days`.
- `recorded`: `Se registró {name} del {day}` / `{name} of {day} was recorded`.
- `not_recorded`: `No se pudo registrar {name} del {day}. Está pendiente de tu confirmación.` / `{name} of {day} could not be recorded. It is waiting for your confirmation.`
`{day}` is the due date formatted with `Intl.DateTimeFormat(language, { day: 'numeric', month: 'short', timeZone: 'UTC' })`. The function takes no amount and no account name, so none can reach the text. The name is cut to 80 characters (its stored limit); the total stays under 300.

`NoticeRepository` (owner-scoped): `list(scope, { limit, cursor })` ordered by (`created_at`, `id`) descending using a keyset predicate; `unreadCount(scope)`; `markRead(scope, id)` sets `read_at = coalesce(read_at, now())` where id and owner match and returns the row or `null`; `markAllRead(scope)`; every query carries `owner_id = scope.userId`. The publisher is the system path: `publish(notice: NewNotice): Promise<boolean>` inserts with `ON CONFLICT (kind, payment_id, due_date) DO NOTHING` and returns whether a row was created; `publishMany` does one multi-row insert for a page of reminders.

**Data model**
Uses the `notices` table of Block 2 unchanged: `owner_id`, `kind`, `payment_id`, `due_date` and `text`
are not null, `read_at` is nullable, the key (`kind`, `payment_id`, `due_date`) is unique, and the
owner index orders the page.

**Input validation**
The use cases receive already-validated values (Block 1 schemas); the publisher receives ids and a
language that come from the database (`users.language` is constrained to `es` or `en`).

**Error handling**
- `markRead` on an id that is not the caller's or does not exist: `ResourceNotFound` (`NOT_FOUND`), nothing changes.
- A unique conflict in the publisher is a normal outcome (`false`), never an error.
- Any other storage error propagates to the caller, which isolates it (Block 5, Block 6).

**Required tests**
- [ ] text for "Luz" due tomorrow in Spanish is `Luz vence mañana` — validates AC-15
- [ ] text for "Electricity" due tomorrow in English is `Electricity is due tomorrow` — validates AC-16
- [ ] text for 0 days and for 3 days in both languages, and for `recorded` and `not_recorded` — validates AC-12, AC-13
- [ ] a payment of 350000.00 on an account named "Galicia" produces text containing neither `350000` nor `Galicia`, in both languages and all three kinds — validates AC-17, NFR-05
- [ ] list returns newest first, at most 50, a cursor that yields the next page without overlap, and the unread count — validates AC-18
- [ ] marking one notice read keeps it in the list as read and lowers the unread count by 1; marking it again keeps the first `read_at` — validates AC-20
- [ ] marking all read sets the unread count to 0 and touches only the caller's notices — validates AC-21
- [ ] a user cannot list, nor mark read, another user's notice: 404 `NOT_FOUND`, the row unchanged — validates AC-22
- [ ] publishing the same (kind, payment, due date) three times is a duplicate: 1 row stays and `false` is returned after the first — validates AC-23
- [ ] two concurrent publishes of the same key are a conflict that keeps 1 row — validates AC-24
- [ ] a storage error inside the repository propagates unchanged to the caller — validates AC-25

**Completion criterion**
The notices unit and repository tests pass, and the use cases and publisher compile against the ports
without importing recurring internals (checked by the architecture review).

## Block 5 — Reminder pass

**Files**
- `apps/api/src/recurring/application/create-due-reminders.ts` (new) — the use case.
- `apps/api/src/recurring/application/ports/reminder-payment-source.ts` (new) — paged cross-owner read of active payments of any mode, with the owner's time zone and language.
- `apps/api/src/recurring/application/ports/occurrence-repository.ts` (modified) — `listResolvedDueDates(paymentIds, from, to)`.
- `apps/api/src/recurring/infrastructure/db/drizzle-reminder-payment-source.ts` (new) — `users` join, active only, ordered by payment id.
- `apps/api/src/recurring/infrastructure/db/drizzle-occurrence-repository.ts` (modified) — implements `listResolvedDueDates`.
- `apps/api/src/recurring/infrastructure/jobs/reminder-job.ts` (new) — the same `setTimeout` chain as the recording job (a separate class so the 08b job is untouched).
- `apps/api/src/recurring/jobs.ts` (modified) — builds and starts the reminder job next to the recording job; adds the `notices: NoticePublisher` dependency.
- `apps/api/src/worker.ts` (modified) — injects the notices publisher.
- `apps/api/test/recurring/fakes.ts` (modified) — `FakeNoticePublisher`.

**Logic**
For each page of 500 active payments (keyset by payment id): compute the owner's local date and time
from the injected clock. `reminderToday` is today when local time is 09:00 or later, otherwise the day
before. Candidate due dates are `dueDatesBetween(payment, today, today + 30 days)` (the longest reminder
window), bounded by the payment's `scheduleFrom`, `startDate` and `endDate`. A due date `D` qualifies when
`D - reminderDays >= autoRecordingFrom` (no reminder for a day before the payment was created or
resumed), `D - reminderDays <= reminderToday` (its reminder day has arrived, including a missed one),
and `D >= today` (the due date has not passed). Occurrences already `confirmed` or `skipped` are removed
using one `listResolvedDueDates` call per page; a recorded automatic occurrence is `confirmed`, so it is
removed too. The page's reminders go to `publishMany` in one insert, each with `daysUntilDue = D - today`
and the owner's language. Paused payments are excluded by the source; deleted ones no longer exist.
The pass uses the owner's current `users.time_zone` every time, so a time zone change applies to the
reminders not yet created. The pass reports failures per payment and continues; errors carry ids only.

**Input validation**
No external input. A time zone name unknown to the runtime falls back to the stored default inside the shared time helpers, as in 08b.

**Error handling**
- A failure while handling one payment is reported with ids and the error class name and the pass continues with the next payment.
- A failure of the page insert is reported for that page and the next page still runs; the reminders of that page are retried on the next pass.
- A pass that throws (storage down) is logged and the next pass still runs (same chain as 08b).

**Required tests**
- [ ] a payment due 2026-10-10 with 3 reminder days gets its reminder at 09:00 on 2026-10-07 in the owner's zone and not at 08:59 — validates AC-04
- [ ] a payment due 2026-10-05 with 0 reminder days and zone `Europe/Madrid` gets its reminder at 07:00 UTC and not at 06:59 UTC, with the process zone set to another zone — validates AC-05
- [ ] the job did not run on the reminder day and runs the next day before the due date: the reminder is created then — validates AC-06
- [ ] the due date has passed: no reminder — validates AC-07
- [ ] a payment created on 2026-10-09 for a due date of 2026-10-11 with 3 reminder days gets no reminder — validates AC-08
- [ ] a paused payment gets no reminder — validates AC-09
- [ ] an occurrence already recorded, confirmed or skipped gets no reminder — validates AC-10
- [ ] a payment past its end date and a deleted payment get no reminder — validates AC-11
- [ ] editing the reminder days from 3 to 0 before the reminder day uses 0 for reminders not yet created — validates AC-03
- [ ] three passes over the same reminder hold 1 notice — validates AC-23
- [ ] two concurrent passes over the same reminder hold 1 notice — validates AC-24
- [ ] a time zone change from `America/Argentina/Buenos_Aires` to `Asia/Tokyo` creates the reminder at 09:00 Tokyo time — validates AC-26
- [ ] with a pass every 60 s, the reminder is created between 09:00 and 09:15 local — validates NFR-01
- [ ] an error in one payment is reported with ids only and the other payments still get their reminders — validates AC-25
- [ ] an error of the page insert is reported and the next page still runs — validates AC-25
- [ ] a pass that throws an error (storage down) is logged and the next pass still runs — validates AC-25

**Completion criterion**
The listed tests pass with a fake clock and the real database, and the worker starts both jobs and stops
both on shutdown.

## Block 6 — Recorded and not-recorded notices

**Files**
- `apps/api/src/recurring/application/record-due-occurrences.ts` (modified) — publishes after a recorded occurrence and after a domain failure of the recorder.
- `apps/api/src/recurring/application/ports/automatic-payment-source.ts` (modified) — the entry carries the owner's `language`.
- `apps/api/src/recurring/infrastructure/db/drizzle-automatic-payment-source.ts` (modified) — selects `users.language`.
- `apps/api/src/recurring/jobs.ts` (modified) — passes the publisher to the use case.
- `apps/api/test/recurring/record-due-occurrences.test.ts` (modified) — notice cases.

**Logic**
After the occurrence lock commits and `summary.recorded++`, the use case publishes a `recorded` notice
(payment name, due date, owner language). When the recorder throws an `AppError` other than the
`ResourceNotFound` of a missing row (the expense cannot be recorded: archived account, no stored
rate), the occurrence stays pending and a `not_recorded` notice is published. A plain `Error`
(storage down, timeout) is a transient failure: it is reported and retried, and no notice is created
for it. The unique key (kind, payment, due date) keeps one `not_recorded` notice per occurrence however
many passes retry it. Publishing runs in its own `try/catch` outside the occurrence lock: a failure is
reported with ids and the error class name, and never rolls back the expense nor stops the next payment.

**Input validation**
Values come from the database; the publisher's language is the `users.language` value (`es` or `en`).

**Error handling**
- Publishing fails: the expense stays recorded, `summary.failed` is not incremented for the expense, the failure is reported with the ids, and the other payments are processed.
- The recorder throws a plain `Error`: reported as in 08b, no notice.
- A repeated pass over an already-recorded occurrence publishes nothing new (the occurrence is no longer pending).

**Required tests**
- [ ] the job records an automatic occurrence and creates one `recorded` notice with the payment name and day and no amount — validates AC-12
- [ ] the recorder raises an error because the account is archived: no expense, the occurrence stays pending and one `not_recorded` notice exists — validates AC-13
- [ ] the job retries that occurrence 5 more times: still 1 notice of that kind — validates AC-14
- [ ] three passes over the same recorded occurrence hold 1 `recorded` notice — validates AC-23
- [ ] two concurrent passes over the same occurrence hold 1 `recorded` notice — validates AC-24
- [ ] the publisher throws an error when the notice of a recorded expense is created: the expense stays recorded, the other payments are processed and the failure is logged with ids only — validates AC-25
- [ ] a plain `Error` from the recorder is reported and creates no `not_recorded` notice — validates AC-13

**Completion criterion**
The 08b recording tests still pass unchanged apart from the notice dependency, and the new notice tests pass.

## Block 7 — Notices API

**Files**
- `apps/api/src/notices/infrastructure/http/notices-routes.ts` (new) — the three routes.
- `apps/api/src/notices/infrastructure/http/notices-presenter.ts` (new) — domain notice to response shape.
- `apps/api/src/server.ts` (modified) — registers `createNoticesRoutes({ db, logger })`.
- `apps/api/test/notices/notices-routes.test.ts` (new) — route tests.
- `apps/api/test/notices/erasure.test.ts` (new) — account deletion removes notices.

**Logic**
`router.use('/notices', requireSession, requireVerifiedEmail)`; each handler gets its scope from
`OwnerOrGroupMemberAccessPolicy` (read for the list, write for marking), as the recurring routes do.
`POST /notices/read-all` is declared before `/:id` so the path is never read as an id. Audit lines carry
ids only. Deleting a user removes their notices through the `owner_id` cascade, so no erasure step is
registered.

**API contract**
- `GET /notices?limit&cursor` — Request: query `limit` 1..50 and `cursor`, no body. Response 200: `{ items: [{ id, kind, text, dueDate, createdAt, readAt }], nextCursor: string | null, unreadCount: number }`. Error codes: `VALIDATION_FAILED` (400), `UNAUTHENTICATED` (401). Auth: session, verified email, read scope.
- `POST /notices/:id/read` — Request: path param `id` (uuid), no body. Response 200: the notice with `readAt` set. Error codes: `VALIDATION_FAILED` (400, id not a uuid), `NOT_FOUND` (404, missing or another user's), `UNAUTHENTICATED` (401). Auth: session, verified email, write scope.
- `POST /notices/read-all` — Request: no params, no body. Response 200: `{ unreadCount: 0 }`. Error codes: `UNAUTHENTICATED` (401). Auth: session, verified email, write scope.

**Input validation**
Query, params and responses go through the shared schemas of Block 1 and the shared validation middleware.

**Error handling**
- Invalid `limit` or `cursor`: `VALIDATION_FAILED`, nothing read.
- A notice that is not the caller's: `NOT_FOUND`, never 403, nothing changed.
- No session: `UNAUTHENTICATED`.

**Required tests**
- [ ] a user with 60 notices lists page 1 of 50 newest first with a `nextCursor`, then page 2 of 10 with `nextCursor` null, and the unread count — validates AC-18
- [ ] `limit=51` and a malformed cursor answer 400 `VALIDATION_FAILED` — validates AC-19
- [ ] marking one read answers 200, keeps it in the list as read and the unread count drops by 1 — validates AC-20
- [ ] read-all answers `{ unreadCount: 0 }` and a following list shows 0 unread — validates AC-21
- [ ] listing never includes another user's notice; marking another user's notice answers 404 `NOT_FOUND` and leaves it unread — validates AC-22
- [ ] a request without a session answers 401 `UNAUTHENTICATED` on the three routes — validates AC-22
- [ ] deleting the account removes all the user's notices and leaves other users' notices — validates AC-30

**Completion criterion**
The route tests pass and the three endpoints answer with the documented bodies on a real database.

## Block 8 — Web: notices screen and unread badge

**Files**
- `apps/web/src/lib/api-client.ts` (modified) — `listNotices`, `markNoticeRead`, `markAllNoticesRead`.
- `apps/web/src/features/notices/containers/notices-container.tsx` (new) — fetches, pages, marks read.
- `apps/web/src/features/notices/components/notice-list.tsx` (new) — presentational list with mark-read controls.
- `apps/web/src/features/notices/containers/unread-badge-container.tsx` (new) — fetches the unread count.
- `apps/web/src/features/notices/components/notices-link.tsx` (new) — bell link with the count.
- `apps/web/src/app/[locale]/(app)/notices/page.tsx` (new) — the route.
- `apps/web/src/features/shell/nav-items.ts` (modified) — `notices` destination.
- `apps/web/src/features/shell/components/top-nav.tsx` (modified) — shows the notices link and badge.
- `apps/web/src/features/shell/components/more-menu.tsx` (modified) — lists the destination.
- `apps/web/messages/en.json`, `apps/web/messages/es.json` (modified) — `notices` keys (title, empty, markAllRead, unread, errors).

**Logic**
The notices screen lists the notices newest first with a "load more" control that uses the cursor, shows
unread ones distinctly and marks one read when it is tapped (optimistic, restored on failure). A
"mark all as read" control calls read-all. The badge fetches the first page with `limit=1` on shell mount and
after the notices screen changes the count; it shows nothing while loading, on failure or when the
count is 0. Presentational components fetch nothing. All strings go through the catalogs; the notice
text itself is stored server-side in the owner's language.

**Input validation**
The web app sends no free text: only ids from the list and the cursor it received.

**Error handling**
- The list fails to load (offline, server error): the screen shows a retry state and keeps nothing stale.
- Marking read fails: the notice returns to unread and a message is shown.
- The badge fails: no badge is shown and the rest of the shell is unaffected.

**Required tests**
- [ ] with 3 unread notices the notices link shows the number 3 — validates AC-27
- [ ] with 0 unread notices no number is shown, and an error in the count request shows none — validates AC-27
- [ ] tapping a notice shows it as read and calls `markNoticeRead` with its id — validates AC-28
- [ ] marking read has an error: the notice is shown unread again with an error message — validates AC-28
- [ ] "load more" requests the next page with the cursor and appends it — validates AC-18
- [ ] a loading error shows the retry state — validates AC-28
- [ ] "mark all as read" calls `markAllNoticesRead` and shows 0 unread — validates AC-21
- [ ] a notice whose text contains markup is shown as literal text, never as HTML — validates AC-28

**Completion criterion**
The web unit tests pass, `pnpm lint` and `pnpm typecheck` pass, and the notices route renders in the
authenticated shell in both languages.

## Block 9 — Web: reminder days field

**Files**
- `apps/web/src/features/recurring/recurring-request.ts` (modified) — `reminderDays` in the form values and the request builder, with an integer 0 to 30 check.
- `apps/web/src/features/recurring/components/recurring-payment-form.tsx` (modified) — the field, prefilled with 3 for a new payment.
- `apps/web/src/features/recurring/containers/payment-form-container.tsx` (modified) — initial values for create and edit.
- `apps/web/src/features/recurring/recurring-failure.ts` (modified) — maps the server field error.
- `apps/web/messages/en.json`, `apps/web/messages/es.json` (modified) — label, help text and `recurring.errors.reminderDaysInvalid`.

**Logic**
The field is a whole-number input from 0 to 30 with the label "Remind me … days before". The builder
reads it without a float (the same `readInteger` helper as the other whole-number fields) and puts
`reminderDays` in the request. An edit form starts from the stored value.

**Input validation**
Integer 0 to 30; empty means the default 3 on create; a value outside the range or fractional is
rejected in the form before the request.

**Error handling**
- A value outside 0 to 30 or fractional: the field shows `recurring.errors.reminderDaysInvalid` and no request is sent.
- A server `VALIDATION_FAILED` on `reminderDays` shows the same field error.

**Required tests**
- [ ] opening the new payment form shows the reminder days field with 3 prefilled — validates AC-29
- [ ] submitting a new payment without touching the field sends `reminderDays: 3` — validates AC-01
- [ ] values -1, 31 and 1.5 are invalid: the field error shows and no request is sent — validates AC-02
- [ ] a server 400 `VALIDATION_FAILED` on `reminderDays` shows the same field error — validates AC-02
- [ ] the edit form starts from the stored value and sends the changed value — validates AC-03

**Completion criterion**
The recurring web tests pass, and the form shows the field in both languages.

## Block 10 — Performance and guards

**Files**
- `apps/api/test/perf/recurring-reminders.perf.test.ts` (new) — NFR-03 benchmark.
- `apps/api/test/perf/notices-list.perf.test.ts` (new) — NFR-04 benchmark.
- `apps/api/test/recurring/no-float-money.test.ts` (modified) — adds the new recurring files to the guarded list.
- `apps/api/test/notices/no-sensitive-text.test.ts` (new) — NFR-05 guard over the text function and the stored rows.

**Logic**
The reminder benchmark seeds 10,000 active payments, 1,000 of them with a reminder due, in batches, and
times one pass against the 60 s budget; the list benchmark seeds 1,000 notices for one user and measures
the p95 of 100 list calls against the 300 ms budget. The text guard protects the no-amount rule of FR-07. Both follow the conventions of the 08b
perf tests (`vitest.perf.config.ts`, seeding helpers, own database).

**Input validation**
Not applicable.

**Error handling**
- The no-float guard fails naming the file and the forbidden token; a benchmark over its budget fails its own test with the measured value.

**Required tests**
- [ ] one reminder pass over 10,000 active payments with 1,000 reminders due finishes in < 60 s — validates NFR-03
- [ ] the p95 of listing notices for a user with 1,000 notices is < 300 ms — validates NFR-04
- [ ] no stored notice, over every kind and both languages, contains an amount or an account name — validates NFR-05
- [ ] the new recurring and notices files contain no `Number(`, `parseFloat`, `toFixed` or `Math.round`, and the guard reports an error for a planted forbidden token — validates NFR-05

**Completion criterion**
`pnpm test:perf` passes both benchmarks and `pnpm test` passes the guards.

## Final verification
- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:perf` and the build commands pass, and coverage stays at or above 80% lines, branches and functions.
- Every acceptance criterion AC-01 to AC-30 has a passing test named in a block above.
- One e2e flow (create a payment with reminder days, run the reminder pass, see the unread badge and mark the notice read) passes with Playwright.
- The migration journal `when` of 0025 is above the maximum on `main` at the time of the merge.
- `pnpm audit --prod --audit-level high` reports nothing new and no runtime dependency was added.

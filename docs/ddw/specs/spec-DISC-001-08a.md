# Spec DISC-001-08a: Recurring payments and occurrences

| Field | Value |
|-------|-------|
| Ticket | DISC-001-08a |
| PRD | docs/ddw/prd/prd-DISC-001-08a.md |
| Tier | FEATURE |
| Date | 2026-10-09 |
| Spec loops | 0 |
| Loops since last human decision | 0 |

## Summary

A new API module `apps/api/src/recurring/` (hexagonal, copied from `credit-cards`) owns two tables,
`recurring_payments` and `recurring_occurrences` (migration 0023). The due-date rules are pure
functions in `packages/shared/src/recurring/` so API and web share them. Confirmation-mode
occurrences are materialized idempotently by a use case `MaterializeOccurrences` that the upcoming
list calls on read (and that DISC-001-08b will call from its job); future dates inside the 30-day
window are projected on the fly and never stored. Confirming an occurrence records an expense
through a port `ExpenseRecorder` declared in `recurring` and implemented in the movements module
(the same pattern credit-cards uses, because ESLint forbids importing movements). No new
dependency and no offline queue: the screens are online only, like cards.

Design decisions taken here, not written in the PRD:
- **Stored vs projected.** Only pending, confirmed and skipped occurrences are rows. Dates after
  today are computed on read (status `scheduled`), so editing a payment never has to rewrite
  future rows (AC-12, AC-15).
- **Cursor.** Each payment has `schedule_from` (date): the first day it may produce occurrences.
  It is the start date at creation and the resume date after a resume (AC-14). Materialization
  covers `max(schedule_from, start_date, today - 366 days)` to today, so an old payment cannot
  flood the table.
- **Schedule edits.** Changing frequency, weekday, day of month, month, start or end date deletes
  the payment's pending occurrences and lets materialization recreate them; confirmed and skipped
  rows stay, and the unique key `(payment_id, due_date)` keeps them from reappearing.
- **Confirm atomicity.** Confirm locks the occurrence row (`select ... for update` in a
  transaction), calls the recorder, then marks it confirmed with the movement id. A failed
  recording rolls everything back; a double tap finds the row no longer pending and gets 409.
- **Automatic mode** payments are stored and projected in 08a but materialize no occurrence and
  record nothing; that is DISC-001-08b.
- **Per-user cap** of 200 recurring payments (`RECURRING_LIMIT_REACHED`, 409), a defensive limit
  that keeps the on-read materialization bounded (NFR-02, NFR-03).
- New error codes `RECURRING_OCCURRENCE_NOT_PENDING` (409) and `RECURRING_LIMIT_REACHED` (409).

## Coverage: PRD → blocks

| Requirement | Covered by |
|---|---|
| FR-01 | Block 1 (schema), Block 3 (create), Block 4 (route) |
| FR-02 | Block 1 (frequency enum and rule), Block 6 (selector) |
| FR-03 | Block 1 (schedule function) |
| FR-04 | Block 3 (materialize), Block 4 (upcoming route) |
| FR-05 | Block 3 (confirm), Block 4 (route and recorder adapter), Block 6 |
| FR-06 | Block 3 (skip), Block 4, Block 6 |
| FR-07 | Block 3 (overdue flag), Block 6 |
| FR-08 | Block 3 (upcoming), Block 4, Block 6 |
| FR-09 | Block 3 (update), Block 4, Block 6 |
| FR-10 | Block 3 (pause and resume), Block 4, Block 6 |
| FR-11 | Block 2 (cascade), Block 3 (delete), Block 4, Block 6 |
| FR-12 | Block 1 (zone-aware today), Block 3 |
| FR-13 | Block 2 (scoped repositories), Block 3, Block 4 |
| FR-14 | Block 5 (catalogs), Block 6 |
| NFR-01 | Strategy: money columns are `bigint`, API fields are decimal strings validated by shared schemas, web uses `parseAmountInput` and `formatMinorUnitsString`; a new `no-float-money` test scans the three new source trees (Block 4, Block 5) |
| NFR-02 | Block 4 (perf test: 100 payments, p95 under 300 ms) |
| NFR-03 | Block 2 (unique key and insert-or-ignore), Block 3 (concurrent materialization test) |
| NFR-04 | Block 1 (schemas), Block 4 (validate middleware on every route, sad-path tests) |

## Dependencies between blocks

Block 1 first (shared). Block 2 depends on Block 1. Block 3 depends on Blocks 1 and 2. Block 4
depends on Block 3. Block 5 depends on Block 1 and can run in parallel with Blocks 2 to 4. Block 6
depends on Blocks 4 and 5.

## Block 1 — Shared schemas, schedule rules and error codes

**Files**
- `packages/shared/src/recurring/recurring-payment.ts` (new) — Zod schemas and types.
- `packages/shared/src/recurring/schedule.ts` (new) — pure due-date functions.
- `packages/shared/src/recurring/index.ts` (new), `packages/shared/src/index.ts` (modified) — exports.
- `packages/shared/src/errors.ts` (modified) — the two new codes.
- `apps/api/src/shared/http/error-handler.ts` (modified) — status map (409 both).
- `packages/shared/test/recurring-schedule.test.ts`, `packages/shared/test/recurring-contracts.test.ts` (new).

**Logic**

`frequencySchema = z.enum(['weekly','monthly','yearly'])`, `modeSchema = z.enum(['automatic',
'confirmation'])`. `createRecurringPaymentSchema`: `name` (trimmed, 1 to 80), `amount` (positive
minor-units decimal string, at most 10^15, same helper as account amounts), `accountId` and
`categoryId` (UUID), `frequency`, `weekday` (0 to 6, Monday = 0, required only for weekly),
`dayOfMonth` (1 to 31, required only for monthly and yearly), `month` (1 to 12, required only for
yearly), `startDate` (`YYYY-MM-DD`, real calendar date), optional `endDate`, `mode`. A
`superRefine` rejects fields that do not belong to the frequency, missing ones, and `endDate <
startDate`. `updateRecurringPaymentSchema` is the same object, all fields optional, at least one
present. Response schemas: `recurringPaymentResponseSchema` (payment plus `status` active|paused
and `nextDueDate`), `upcomingResponseSchema` (items with `kind` pending|overdue|scheduled, due
date, payment id, name, amount, account and category ids, and the occurrence id for pending and
overdue ones), `confirmOccurrenceSchema` (`amount` optional positive string, `date` optional
`YYYY-MM-DD`).

`schedule.ts` exports `dueDatesBetween(rule, fromDay, toDay): string[]` (inclusive, ascending,
only real dates inside `startDate`..`endDate`), `nextDueDate(rule, fromDay): string | null`,
`clampDay(year, month, day)` (last day of the month when absent; 29 February in a non-leap year
becomes 28 February) and `addDays(day, n)`. All work on `YYYY-MM-DD` strings with UTC date math at
noon, so the server time zone never matters; the caller passes "today" computed with
`todayInTimeZone` (FR-12). No `Number(`, `parseFloat`, `toFixed` or `Math.round` (money guard).

**Error handling**
- Schemas reject malformed input with `VALIDATION_FAILED` and per-field messages; the schedule
  functions never throw on a valid rule and return an empty list when the window is empty.

**Required tests**
- [ ] schema accepts the "Rent" payload (350000.00 ARS, monthly day 5, confirmation) — validates AC-01
- [ ] sad path: schema rejects amount `"0"`, negative, `"1.5"`, an empty name, `endDate` before `startDate`, a monthly rule without `dayOfMonth`, a weekly rule with `dayOfMonth`, `month` 13 — validates AC-02
- [ ] the frequency enum is exactly weekly, monthly, yearly and anything else is rejected — validates AC-03
- [ ] monthly day 31 yields 2027-02-28, 2027-04-30 and 2028-02-29 — validates AC-04
- [ ] yearly 29 February yields 2027-02-28 and 2028-02-29 — validates AC-05
- [ ] weekly Monday over a four-week window yields four dates, boundaries inclusive, nothing before `startDate` or after `endDate` — validates AC-01 and AC-04
- [ ] `nextDueDate` returns the next date from a given day and `null` after `endDate` — validates AC-01

**Completion criterion**
Shared tests pass; `pnpm typecheck` clean for `packages/shared` and `apps/api`.

## Block 2 — Migration 0023, Drizzle schema, repositories and erasure

**Files**
- `apps/api/src/recurring/infrastructure/db/schema.ts` (new), `foreign-relations.ts` (new).
- `apps/api/drizzle/0023_<name>.sql`, `meta/0023_snapshot.json`, `meta/_journal.json`, `rollback/0023_<name>.down.sql` (new/modified; generated with `pnpm --filter @pesly/api db:generate`).
- `apps/api/src/recurring/application/ports/recurring-payment-repository.ts`, `occurrence-repository.ts`, `user-time-zone.ts`, `expense-recorder.ts` (new) — ports.
- `apps/api/src/recurring/infrastructure/db/drizzle-recurring-payment-repository.ts`, `drizzle-occurrence-repository.ts`, `drizzle-user-time-zone.ts`, `erase-user-recurring.ts` (new).
- `apps/api/src/server.ts` (modified) — adds `eraseUserRecurring` to `beforeUserErased`, before movements and accounts.
- `eslint.config.mjs` (modified) — a `recurring` block that forbids importing movements, like credit-cards.
- `apps/api/test/recurring/payment-repository.test.ts`, `occurrence-repository.test.ts`, `schema-introspection.test.ts`, `erasure-step.test.ts`, `apps/api/test/identity/migration.test.ts` (modified if it pins the journal).

**Data model**
- `recurring_payments`: `id uuid pk`, `owner_id uuid not null → users`, `name text not null`, `amount bigint not null check > 0`, `account_id uuid`, `category_id uuid`, `frequency text not null check in (...)`, `weekday smallint null check 0..6`, `day_of_month smallint null check 1..31`, `month smallint null check 1..12`, `start_date date not null`, `end_date date null check >= start_date`, `mode text not null check in (...)`, `status text not null default 'active' check in ('active','paused')`, `schedule_from date not null`, `created_at`, `updated_at timestamptz`. Composite foreign keys `(account_id, owner_id)` and `(category_id, owner_id)` follow the pattern in `credit_cards_ars_account_owner_fk`. Index `(owner_id, status)`.
- `recurring_occurrences`: `id uuid pk`, `payment_id uuid not null → recurring_payments on delete cascade`, `owner_id uuid not null`, `due_date date not null`, `status text not null default 'pending' check in ('pending','confirmed','skipped')`, `confirmed_amount bigint null`, `movement_id uuid null` (no foreign key: a deleted movement must not block, and the module must not reference movements' tables), `resolved_at timestamptz null`, `created_at`. `unique (payment_id, due_date)`; index `(owner_id, status, due_date)`.
- Rollback script (hand-written): drops both tables and deletes the `__drizzle_migrations` row for the new `when`; reverting is safe because nothing else references them. The journal `when` must exceed 1791510000000 (current max); re-check at merge.

**Logic**

Payment repository: `create`, `get`, `list`, `count`, `update`, `setStatus(paused|active, scheduleFrom)`, `delete`, all taking an `AccessScope` and using `notFoundUnlessAllowed` so foreign rows answer `ResourceNotFound`. Occurrence repository: `insertIgnore(rows)` (`on conflict (payment_id, due_date) do nothing`), `listPending(scope)`, `deletePendingFor(paymentId)`, and `withLockedPending(scope, id, fn)` which opens a transaction, `select ... for update`, throws `ResourceNotFound` when absent or foreign and `OccurrenceNotPending` when already resolved, runs `fn` and updates the row from its result. `eraseUserRecurring(userId)` deletes the user's payments (occurrences cascade). `DrizzleUserTimeZone` copies the credit-cards adapter (falls back to `America/Argentina/Buenos_Aires`).

**Error handling**
- Foreign or missing rows raise `ResourceNotFound`; a violated check or foreign key is a bug and surfaces as 500 through the central handler without leaking SQL.

**Required tests**
- [ ] schema introspection: columns, checks, unique key, cascade and composite foreign keys exist — validates NFR-01 and NFR-03
- [ ] `insertIgnore` called twice with the same rows and called concurrently stores one row per `(payment, due date)` — validates NFR-03 and AC-06
- [ ] sad path: a payment with an account of another user fails the composite foreign key — validates AC-02
- [ ] sad path: get, update, delete and `withLockedPending` on another user's rows raise `ResourceNotFound` and leave data unchanged — validates AC-17
- [ ] deleting a payment removes its occurrences and leaves movements rows untouched — validates AC-15
- [ ] `withLockedPending` on a resolved row raises `OccurrenceNotPending`; a thrown error inside `fn` leaves the row pending — validates AC-08
- [ ] erasure step removes a user's payments and occurrences and no one else's — validates AC-17
- [ ] migration test applies 0023 on a database at 0022 and the rollback script returns it to 0022 — validates NFR-01

**Completion criterion**
Repository tests pass against PostgreSQL; `pnpm lint` and `pnpm typecheck` clean for `apps/api`.

## Block 3 — Use cases

**Files**
- `apps/api/src/recurring/domain/errors.ts`, `domain/recurring-payment.ts` (new) — `OccurrenceNotPending`, `RecurringLimitReached`, entities.
- `apps/api/src/recurring/application/dependencies.ts` (new), `create-recurring-payment.ts`, `update-recurring-payment.ts`, `pause-recurring-payment.ts`, `resume-recurring-payment.ts`, `delete-recurring-payment.ts`, `list-recurring-payments.ts`, `materialize-occurrences.ts`, `list-upcoming.ts`, `confirm-occurrence.ts`, `skip-occurrence.ts` (new).
- `apps/api/test/recurring/fakes.ts`, `use-cases.test.ts`, `materialize.test.ts` (new).

**Logic**

Each use case takes an `AccessScope`. `CreatePayment`: counts the user's payments (limit 200), verifies the account and category belong to the user and are not archived through the recorder-side checks at confirm time (creation only validates ownership through the foreign keys), sets `schedule_from = startDate`. `UpdatePayment`: applies the partial change; when a schedule field changed it calls `deletePendingFor`; does not touch resolved occurrences. `Pause` sets `paused`; `Resume` sets `active` and `schedule_from = today` in the user's zone. `Delete` deletes the payment (cascade). `MaterializeOccurrences(scope, now)`: for the user's active confirmation-mode payments computes `dueDatesBetween` from the cursor bound described in the Summary to today and calls `insertIgnore`. `ListUpcoming(scope, now)`: materializes, then returns pending rows split into `overdue` (due before today) and `pending` (due today), plus projected `scheduled` items for tomorrow through today + 30 days from active payments (all modes), ordered by due date. `ConfirmOccurrence(scope, id, {amount?, date?})`: uses `withLockedPending`; amount defaults to the payment's current amount, date to the due date; calls `ExpenseRecorder.record` with `rate: {source: 'automatic'}` and `occurredAt` = noon of the date in the user's zone (`zonedLocalToInstant`); stores `confirmed_amount`, `movement_id`, `resolved_at`. `SkipOccurrence` marks skipped with no recording.

**Error handling**
- Recorder errors (`ACCOUNT_ARCHIVED`, `CATEGORY_ARCHIVED`, `RATE_REQUIRED`, `MOVEMENT_DATE_IN_FUTURE`, `RATE_LIMITED`) propagate unchanged and roll back the confirmation, leaving the occurrence pending.
- Confirming or skipping a resolved occurrence raises `OccurrenceNotPending` (409). Creating the 201st payment raises `RecurringLimitReached` (409).

**Required tests**
- [ ] create stores the payment and `ListUpcoming` shows its next occurrence as `scheduled` — validates AC-01
- [ ] sad path: create with another user's account or category fails and stores nothing; the 201st payment is refused — validates AC-02
- [ ] with the clock on the due date, two `ListUpcoming` calls hold one pending occurrence, balances unchanged (recorder fake not called); two concurrent materializations hold one row — validates AC-06
- [ ] a payment due in the future is only projected, a payment due 30 days ahead is listed and 31 days ahead is not, ordered by date — validates AC-11
- [ ] confirm with amount 48250.00 calls the recorder with that amount, account and category and marks confirmed with the movement id — validates AC-07
- [ ] sad path: confirm of a confirmed or skipped occurrence raises 409 and records nothing; confirm when the recorder raises `ACCOUNT_ARCHIVED` leaves it pending — validates AC-08
- [ ] skip marks skipped, calls the recorder zero times, and the date is not materialized again — validates AC-09
- [ ] a pending occurrence before today is returned as `overdue` and stays so across days until resolved — validates AC-10
- [ ] update of the amount is used by the next confirm and a recorded expense keeps its old amount; a schedule edit deletes pending occurrences and keeps confirmed ones — validates AC-12
- [ ] paused payment materializes nothing and is not projected — validates AC-13
- [ ] resume sets the cursor to today: dates missed while paused are never created and the next one is scheduled from today — validates AC-14
- [ ] delete removes pending and future occurrences; the recorder fake's recorded movements remain — validates AC-15
- [ ] with the user's zone `Asia/Tokyo` and the clock at 16:30 UTC on 2026-10-31, a payment due 2026-11-01 materializes as due today — validates AC-16
- [ ] sad path: every use case on another user's payment or occurrence raises `ResourceNotFound`; `ListUpcoming` returns only the caller's items — validates AC-17 and AC-18

**Completion criterion**
Use-case tests pass; coverage of `apps/api/src/recurring/application` at least 90% lines.

## Block 4 — Routes, movements adapter and wiring

**Files**
- `apps/api/src/recurring/infrastructure/http/recurring-routes.ts`, `recurring-presenter.ts` (new); `apps/api/src/recurring/index.ts` (new barrel).
- `apps/api/src/movements/infrastructure/recurring/drizzle-recurring-expense-recorder.ts` (new) and `apps/api/src/movements/index.ts` (modified) — adapter implementing the `recurring` port with `RecordManualMovement` (metered, as `createExpenseRecorder` does for cards).
- `apps/api/src/server.ts` (modified) — registers `createRecurringRoutes` in `routerFactories` and wires the adapter.
- `apps/api/test/recurring/recurring-routes.test.ts`, `recurring-upcoming.perf.test.ts`, `no-float-money.test.ts` (new).

**API contract** (all under `/recurring`, `requireSession`, `requireVerifiedEmail`, shared `validate`, origin guard on non-GET)
- `POST /recurring/payments` body `createRecurringPaymentSchema` → 201 payment.
- `GET /recurring/payments` → 200 list; `GET /recurring/payments/:id` → 200.
- `PATCH /recurring/payments/:id` body `updateRecurringPaymentSchema` → 200.
- `POST /recurring/payments/:id/pause` and `/resume` → 200 payment; `DELETE /recurring/payments/:id` → 204.
- `GET /recurring/upcoming` → 200 `upcomingResponseSchema`.
- `POST /recurring/occurrences/:id/confirm` body `confirmOccurrenceSchema` → 200; `POST /recurring/occurrences/:id/skip` → 200.
- Errors: 400 `VALIDATION_FAILED`, 401, 403 `EMAIL_NOT_VERIFIED`, 404 `NOT_FOUND`, 409 `RECURRING_OCCURRENCE_NOT_PENDING`, `RECURRING_LIMIT_REACHED`, `ACCOUNT_ARCHIVED`, `CATEGORY_ARCHIVED`, 429 `RATE_LIMITED`. Static paths are registered before `/:id`.

- Auth: session cookie plus verified email on every route; ownership is enforced by the scope, never by the body.

**Data model**
- No schema change in this block (the tables come from Block 2); nullable `movement_id` stays without a foreign key, and every query is scoped by owner.

**Input validation**
- Params, query and body of every route go through the shared `validate` middleware with the schemas of Block 1: UUID ids, `YYYY-MM-DD` dates, amounts as bounded decimal strings, names at most 80 characters; no handler reads `req.body` directly.

**Logic**

Handlers build scopes with `scopeOf` exactly like credit-cards, call one use case and present the result. Audit lines carry request, user and entity ids only, never names or amounts.

**Error handling**
- Validation failures answer 400 before any use case runs; all domain errors go through the central error handler; foreign ids answer 404 with the same body as missing ones.

**Required tests**
- [ ] create "Rent" over HTTP answers 201 and `GET /recurring/payments` lists it with its next due date — validates AC-01
- [ ] sad path: amount `0`, empty name, end before start, reminder-style unknown fields, foreign account answer 400 or 404 and store nothing — validates AC-02 and NFR-04
- [ ] sad path: non-UUID ids, malformed bodies and unknown frequency answer 400 on every route, and no data changes — validates NFR-04
- [ ] two `GET /recurring/upcoming` calls on the due date return one pending item; balances read through the accounts route are unchanged — validates AC-06
- [ ] confirm over HTTP with `{amount: "4825000"}` creates an expense of that amount visible in `GET /movements` and marks it confirmed; a second confirm answers 409 — validates AC-07 and AC-08
- [ ] sad path: confirm on an archived account answers 409 `ACCOUNT_ARCHIVED` and the occurrence stays pending — validates AC-08
- [ ] skip answers 200, no movement exists — validates AC-09
- [ ] overdue and 30-day window items are returned in order with the right `kind` — validates AC-10 and AC-11
- [ ] PATCH amount, pause, resume and DELETE behave per AC-12 to AC-15, checked through `GET /recurring/upcoming` and `GET /movements` — validates AC-12, AC-13, AC-14 and AC-15
- [ ] user in `Asia/Tokyo` with the movable clock at 16:30 UTC on the last day of the month sees the next-day payment as due today — validates AC-16
- [ ] sad path: every route with another user's id answers 404 with the missing-id body and changes nothing; upcoming shows only own items — validates AC-17 and AC-18
- [ ] sad path: no session answers 401, an unverified user 403, and a request without the trusted headers is refused — validates AC-17
- [ ] perf: 100 payments, p95 of `GET /recurring/upcoming` under 300 ms over 50 calls (timeout 180 s) — validates NFR-02
- [ ] `no-float-money` scans `apps/api/src/recurring`, `packages/shared/src/recurring` and `apps/web/src/features/recurring` — validates NFR-01

**Completion criterion**
Route tests and the perf test pass; full `apps/api` tests green.

## Block 5 — Web client, catalogs and navigation

**Files**
- `apps/web/src/lib/api-client.ts` (modified) — methods for every endpoint, error-code mapping for the two new codes.
- `apps/web/src/features/recurring/recurring-request.ts` (new) — `buildRecurringPaymentRequest(form, locale)` and `buildConfirmRequest`.
- `apps/web/messages/en.json`, `es.json` (modified) — namespace `recurring` and `app.nav.recurring`, `errors` entries.
- `apps/web/src/features/shell/nav-items.ts`, `more-menu.tsx` (modified) — navigation entry.
- `apps/web/test/api-client-recurring.test.ts`, `recurring-request.test.ts` (new).

**API contract**
- Consumes the endpoints listed in Block 4 with the same methods, paths and error codes; every response is parsed with the shared schema before use. Auth: session cookie with the `X-Requested-With: argent` header on writes.

**Data model**
- No schema change in this block: no table, no foreign key, no unique key; the form state is in memory only and every field is nullable until submitted.

**Input validation**
- The builders accept only a trimmed name of 1 to 80 characters, an amount parsed to a positive minor-units string at most 10^15, real calendar dates and the fields that belong to the chosen frequency; nothing else is sent.

**Logic**

Client methods parse every response with the shared schemas and map errors like `renameAccount`. The builders trim and parse the amount with `parseAmountInput` and `formatMinorUnitsString`, return `{ error: <i18n key> }` for an empty or malformed amount, an end date before the start date, or a missing weekday or day, and otherwise a request the shared schema accepts. Catalog keys cover labels, frequencies, statuses (`scheduled`, `pending`, `overdue`, `confirmed`, `skipped`, `paused`), actions, confirm form, empty state and the two error codes, in Spanish and English; no string is hardcoded in components.

**Error handling**
- API failures map to typed results (`UNAUTHENTICATED`, `VALIDATION_FAILED`, `NOT_FOUND`, the two 409 codes, network and server errors) with catalog message keys.

**Required tests**
- [ ] client sends each request to the right path and method and parses the response — validates FR-01 and AC-01
- [ ] sad path: client maps 404, 401, 400, both 409 codes and network failure to their keys — validates AC-08 and AC-17
- [ ] builders convert `"350.000,00"` (es) and `"350,000.00"` (en) to minor units and produce schema-valid requests — validates AC-01
- [ ] sad path: builders reject empty or malformed amount, end before start and missing weekday or day with message keys — validates AC-02
- [ ] the catalog parity test passes and the Spanish status labels exist — validates AC-19

**Completion criterion**
Web tests pass; `pnpm typecheck` clean for `apps/web`.

## Block 6 — Web screens and end-to-end flow

**Files**
- `apps/web/src/app/[locale]/(app)/recurring/page.tsx`, `recurring/new/page.tsx`, `recurring/[id]/page.tsx` (new).
- `apps/web/src/features/recurring/components/` — `upcoming-list.tsx`, `occurrence-row.tsx`, `confirm-occurrence-form.tsx`, `recurring-payment-form.tsx`, `recurring-payment-list.tsx` (new, presentational).
- `apps/web/src/features/recurring/containers/` — `upcoming-container.tsx`, `payment-form-container.tsx`, `payment-detail-container.tsx` (new).
- `apps/web/test/recurring-components.test.tsx`, `recurring-containers.test.tsx` (new).
- `apps/web/e2e/recurring.spec.ts` (new, written and typechecked; run by the orchestrator, one at a time).

**Input validation**
- Forms validate through the Block 5 builders before sending: name length, positive amount, real dates, end date not before start date, and only the fields of the chosen frequency; the server validates again.

**Logic**

The main screen shows overdue first, then pending, then scheduled items for the next 30 days, each row with name, due date, status badge and, for overdue and pending rows, Confirm and Skip actions. Confirm opens a small form with amount and date prefilled and editable. The payment form has a frequency selector with exactly the three options and shows only the fields that belong to the chosen frequency. The detail screen edits, pauses, resumes and deletes (with an explicit confirmation). Containers fetch and mutate through the client; components are pure and use theme tokens and the shared UI components. The screens are online only and show the standard offline message from the shell when the network is down.

**Error handling**
- Failed requests show the mapped catalog message in the form or row and keep the entered values; a 409 on confirm refreshes the list.

**Required tests**
- [ ] the frequency selector renders exactly three options, and the day and weekday fields follow the choice — validates AC-03
- [ ] the list renders overdue, pending and scheduled rows in order with the right badge and actions — validates AC-10 and AC-11
- [ ] confirm form prefilled with the payment amount; submitting 48250.00 calls the client with that amount — validates AC-07
- [ ] sad path: invalid form values show the message and send nothing; a 409 shows its message and refreshes — validates AC-02 and AC-08
- [ ] skip, pause, resume and delete call the client and update the list — validates AC-09, AC-13, AC-14 and AC-15
- [ ] with Spanish messages every label and status renders in Spanish — validates AC-19
- [ ] e2e: create a monthly confirmation payment dated in the past, see it overdue, confirm it with a changed amount and find the expense in movements — validates AC-01, AC-07 and AC-10

**Completion criterion**
Web unit tests pass and the e2e spec typechecks; the orchestrator runs it once at the end.

## Final verification

Full `pnpm test:coverage` meets 80% lines, branches and functions; `pnpm lint`, `pnpm typecheck`
and both builds pass; `pnpm audit --prod --audit-level high` clean; the e2e spec passes once.

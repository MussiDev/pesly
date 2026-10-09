# Verification DISC-001-08a

| Field | Value |
|---|---|
| Module | `apps/api/src/recurring`, `packages/shared/src/recurring`, `apps/web/src/features/recurring`, `apps/api/src/movements/infrastructure/recurring` |
| Line coverage | 96.65% |
| Branch coverage | 90.95% |
| Function coverage | 94.72% |
| Coverage floor | 80% (AGENTS.md, "Testing") |
| Lint | `pnpm exec eslint .` clean, `pnpm exec prettier --check --end-of-line auto .` clean, `pnpm typecheck` clean |

Coverage numbers are the whole-repo run in `docs/ddw/reports/tests-DISC-001-08a.md` (6421 tests). Over the
changed sources alone: `apps/api/src/recurring` 100% lines, 92.59% branches, 100% functions;
`apps/web/src/features/recurring` 100% lines, 95.34% branches, 100% functions. The three `page.tsx`
files under `recurring` are thin wrappers covered by the Playwright spec only.

## Acceptance criteria
- ✅ AC-01 — `creates "Rent" with 201 and lists it with its next due date (AC-01)` (`apps/api/test/recurring/recurring-routes.test.ts:192`), schema `accepts the Rent payload` (`packages/shared/test/recurring-contracts.test.ts:31`), code `CreateRecurringPayment` (`apps/api/src/recurring/application/create-recurring-payment.ts`)
- ✅ AC-02 — `rejects %s (AC-02)` (`packages/shared/test/recurring-contracts.test.ts:75`), `sad path: the 201st payment is refused (AC-02)` (`apps/api/test/recurring/use-cases.test.ts:132`), `sad path: a payment on an account or category of another user fails the composite key and answers not found (AC-02)`
- ✅ AC-03 — `is exactly weekly, monthly, yearly (AC-03)` (`packages/shared/test/recurring-contracts.test.ts:87`), `offers exactly weekly, monthly and yearly, and the day fields follow the choice (AC-03)` (`apps/web/test/recurring-components.test.tsx:71`)
- ✅ AC-04 — `monthly day 31 yields the clamped end of short months (AC-04)` (`packages/shared/test/recurring-schedule.test.ts:39`), code `dueDatesBetween` and `clampDay` (`packages/shared/src/recurring/schedule.ts`)
- ✅ AC-05 — `yearly 29 February yields 28 February in non-leap years (AC-05)` (`packages/shared/test/recurring-schedule.test.ts:49`)
- ✅ AC-06 — `returns one pending item on the due date however many times it is read, balances untouched (AC-06)` (`apps/api/test/recurring/recurring-routes.test.ts:315`), `two concurrent materializations hold one row` (`apps/api/test/recurring/materialize.test.ts:59`)
- ✅ AC-07 — `confirms with an edited amount, records the expense, and rejects a second confirm (AC-07, AC-08)` (`apps/api/test/recurring/recurring-routes.test.ts:330`), `confirms with an edited amount and reloads the list (AC-07)` (`apps/web/test/recurring-containers.test.tsx:129`), code `ConfirmOccurrence` (`apps/api/src/recurring/application/confirm-occurrence.ts`)
- ✅ AC-08 — `answers 409 ACCOUNT_ARCHIVED on an archived account and leaves the occurrence pending (AC-08)` (`apps/api/test/recurring/recurring-routes.test.ts:368`), `sad path: a resolved row raises OccurrenceNotPending and fn never runs (AC-08)`
- ✅ AC-09 — `skips with 200, records nothing and never brings the date back (AC-09)` (`apps/api/test/recurring/recurring-routes.test.ts:391`), `skips an occurrence and reloads the list (AC-09)` (`apps/web/test/recurring-containers.test.tsx:208`)
- ✅ AC-10 — `returns overdue, pending and scheduled items in date order with the right kind (AC-10, AC-11)` (`apps/api/test/recurring/recurring-routes.test.ts:416`), `returns a pending occurrence before today as overdue, across days, until resolved` (`apps/api/test/recurring/use-cases.test.ts:340`), code `ListUpcoming` (`apps/api/src/recurring/application/list-upcoming.ts`)
- ✅ AC-11 — `only projects a payment due in the future and lists 30 days ahead but not 31` (`apps/api/test/recurring/use-cases.test.ts:157`), route test at `recurring-routes.test.ts:416`
- ✅ AC-12 — `PATCH amount changes what the upcoming items carry (AC-12)` (`apps/api/test/recurring/recurring-routes.test.ts:454`), `uses the new amount on the next confirm and keeps the recorded expense as it was` (`apps/api/test/recurring/use-cases.test.ts:362`)
- ✅ AC-13 — `pause removes the payment from upcoming and resume does not backfill (AC-13, AC-14)` (`apps/api/test/recurring/recurring-routes.test.ts:470`), `a paused payment materializes nothing and is not projected` (`use-cases.test.ts:438`)
- ✅ AC-14 — `resume moves the cursor to today in the zone: missed dates are never created` (`apps/api/test/recurring/use-cases.test.ts:451`)
- ✅ AC-15 — `DELETE answers 204, drops the occurrences and keeps recorded movements (AC-15)` (`apps/api/test/recurring/recurring-routes.test.ts:507`), `deleting a payment removes its occurrences and leaves movements untouched (AC-15)` (`payment-repository.test.ts:167`)
- ✅ AC-16 — `shows a payment due the next day in Asia/Tokyo as due today at 16:30 UTC (AC-16)` (`apps/api/test/recurring/recurring-routes.test.ts:436`), `uses the user zone: Asia/Tokyo at 16:30 UTC on 2026-10-31 is already 2026-11-01` (`use-cases.test.ts:205`)
- ✅ AC-17 — `answers 404 with the missing-id body on every route for another user's ids (AC-17, AC-18)` (`apps/api/test/recurring/recurring-routes.test.ts:524`), `answers 401 without a session and 403 before the email is verified (AC-17)`, `refuses a state-changing request without the trusted headers (AC-17)`
- ✅ AC-18 — `ListUpcoming and ListRecurringPayments return only the caller items` (`apps/api/test/recurring/use-cases.test.ts:550`), route test at `recurring-routes.test.ts:524`
- ✅ AC-19 — `renders every label and status in Spanish (AC-19)` (`apps/web/test/recurring-components.test.tsx:224`), `renders labels and statuses in Spanish (AC-19)` (`apps/web/test/recurring-containers.test.tsx:249`)

## Spec blocks
- ✅ Block 1 — Shared schemas, schedule rules and error codes: every task done; tests in `recurring-contracts.test.ts` and `recurring-schedule.test.ts`
- ✅ Block 2 — Migration 0023, schema, repositories and erasure: every task done; tests `schema-introspection.test.ts`, `payment-repository.test.ts`, `occurrence-repository.test.ts`, `erasure-step.test.ts`, `migration.test.ts`
- ✅ Block 3 — Use cases: every task done; tests `use-cases.test.ts`, `materialize.test.ts`
- ✅ Block 4 — Routes, movements adapter and wiring: every task done; tests `recurring-routes.test.ts`, `recurring-perf.test.ts`, `no-float-money.test.ts`
- ✅ Block 5 — Web client, catalogs and navigation: every task done; tests `api-client-recurring.test.ts`, `recurring-request.test.ts`, `recurring-catalog.test.ts`
- ✅ Block 6 — Web screens and end-to-end flow: every task done; tests `recurring-components.test.tsx`, `recurring-containers.test.tsx`, `e2e/recurring.spec.ts`

## Tests
- ✅ Sad-path tests: every input has one — `sad path: the 201st payment is refused (AC-02)`, `%s %s answers 400 and changes nothing` (`recurring-routes.test.ts:298`), `rejects %s (AC-02)`, `shows the message and sends nothing for an invalid amount (AC-02)`, `sad path: every use case on another user payment or occurrence raises ResourceNotFound`
- ✅ NFR-01 `has no float, real, double, numeric or money column and stores amounts as bigint (NFR-01)` and `no-float-money.test.ts`; NFR-02 `keeps p95 of 50 reads with 100 payments below 300 ms` (`recurring-perf.test.ts:38`); NFR-03 `stores one row when called concurrently (NFR-03, AC-06)`; NFR-04 `%s %s answers 400 and changes nothing`
- ✅ Playwright `apps/web/e2e/recurring.spec.ts` ran once: 2 of 2 passed (create a past-dated monthly payment, see it overdue, confirm it with 48.250,00 and find the expense in movements; refuse an empty form) — covers AC-01, AC-02, AC-07 and AC-10 end to end
- ⚠️ W-VER-03: three tests in the repository files wait on a real Postgres and failed once on the shared 10-second setup hook while Docker stalled; they are deterministic and pass on rerun (see the run anomalies in the tests report). Not a fragile assertion
- ⚠️ Block 3, 4 and 5 tests were partly written after their code (declared in the tests report); the behaviors are covered, only the per-assertion red is missing for them

Result: PASSED

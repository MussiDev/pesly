# Threat model DISC-001-08a: Recurring payments and occurrences

| Field | Value |
|-------|-------|
| Ticket | DISC-001-08a |
| Spec | docs/ddw/specs/spec-DISC-001-08a.md |
| Tier | FEATURE |
| Date | 2026-10-09 |

## Components
| Component | Source in the spec |
|---|---|
| `packages/shared/src/recurring/recurring-payment.ts` | Block 1 |
| `packages/shared/src/recurring/schedule.ts` | Block 1 |
| `apps/api/src/recurring/infrastructure/db/drizzle-recurring-payment-repository.ts` | Block 2 |
| `apps/api/src/recurring/infrastructure/db/drizzle-occurrence-repository.ts` | Block 2 |
| `apps/api/src/recurring/application/confirm-occurrence.ts` | Block 3 |
| `apps/api/src/recurring/application/materialize-occurrences.ts` | Block 3 |
| `apps/api/src/recurring/infrastructure/http/recurring-routes.ts` | Block 4 |
| `apps/api/src/movements/infrastructure/recurring/drizzle-recurring-expense-recorder.ts` | Block 4 |
| `apps/web/src/features/recurring/containers/upcoming-container.tsx` | Block 6 |

## Trust boundaries
- Browser → API: every `/recurring` request crosses the public internet with a session cookie and the `X-Requested-With` and `Origin` headers.
- API → database: repositories issue owner-scoped SQL; the occurrence lock holds a row for the length of a confirmation.
- Recurring module → movements module: the confirmation crosses through the `ExpenseRecorder` port into the movements use case, which enforces its own account, category, rate and write-limit rules.

## STRIDE analysis
### `packages/shared/src/recurring/recurring-payment.ts`
- **Spoofing:** the schema does not carry identity; the owner is taken from the session scope, never from the body.
- **Tampering:** bounded strings and amounts, calendar-valid dates and per-frequency fields reject crafted payloads before any use case runs (R-02).
- **Repudiation:** not applicable to a pure schema; the routes log the action.
- **Information Disclosure:** validation errors list field names only, not stored values.
- **Denial of Service:** name length 80 and amount at most 10^15 bound the payload size.
- **Elevation of Privilege:** unknown keys are stripped, so a body cannot set `ownerId`, `status` or `scheduleFrom`.

### `packages/shared/src/recurring/schedule.ts`
- **Spoofing:** not applicable, pure functions with no identity.
- **Tampering:** inputs are validated rules; the functions use UTC string math and do not read the server clock or zone.
- **Repudiation:** not applicable.
- **Information Disclosure:** no data beyond the rule passed in.
- **Denial of Service:** a window larger than 366 days is never requested by the use case, so the list stays bounded (R-03).
- **Elevation of Privilege:** not applicable, no privileged operation.

### `apps/api/src/recurring/infrastructure/db/drizzle-recurring-payment-repository.ts`
- **Spoofing:** the owner id comes from the verified session scope only.
- **Tampering:** every statement carries the owner scope and composite foreign keys `(account_id, owner_id)` and `(category_id, owner_id)` stop a payment from pointing at another user's account (R-01).
- **Repudiation:** create, update, pause, resume and delete write an audit line with ids only.
- **Information Disclosure:** a foreign or missing id answers the same 404 body, so ids cannot be probed (R-01).
- **Denial of Service:** the per-user cap of 200 payments bounds storage and the on-read materialization (R-03).
- **Elevation of Privilege:** there is no admin path; scope checks run in the repository, not only in the route.

### `apps/api/src/recurring/infrastructure/db/drizzle-occurrence-repository.ts`
- **Spoofing:** rows carry `owner_id` and every read and write filters on it.
- **Tampering:** the unique key `(payment_id, due_date)` and insert-or-ignore stop duplicate occurrences from concurrent reads; `for update` stops two resolutions of one row (R-04).
- **Repudiation:** the occurrence keeps `status`, `resolved_at`, `confirmed_amount` and `movement_id`, so each resolution is traceable.
- **Information Disclosure:** foreign occurrence ids answer 404.
- **Denial of Service:** the lock is per row and held only during one confirmation; a stalled recorder call could hold it, bounded by the request timeout (R-05).
- **Elevation of Privilege:** `withLockedPending` rejects foreign rows before running the callback.

### `apps/api/src/recurring/application/confirm-occurrence.ts`
- **Spoofing:** acts only on the scope's owner.
- **Tampering:** a user can change the amount and date of their own confirmation, which is the intended feature; the recorder re-validates ownership, archived state and future dates (R-06).
- **Repudiation:** the confirmed occurrence stores the movement id and the confirmed amount.
- **Information Disclosure:** errors from the recorder carry codes, not data of other users.
- **Denial of Service:** confirmations go through the metered movement write limiter (60 per minute per owner), so a loop of confirms is throttled.
- **Elevation of Privilege:** the recorder checks that the account and category belong to the scope, so a payment cannot spend from an account the user lost access to.

### `apps/api/src/recurring/application/materialize-occurrences.ts`
- **Spoofing:** acts only on the scope's owner.
- **Tampering:** dates come from the pure schedule function in the user's stored zone; a user cannot inject dates (R-02).
- **Repudiation:** occurrences have a `created_at`.
- **Information Disclosure:** only the caller's rows are read.
- **Denial of Service:** the lookback is capped at 366 days and 200 payments, so one call inserts a bounded number of rows (R-03).
- **Elevation of Privilege:** not applicable, it never records an expense in this ticket.

### `apps/api/src/recurring/infrastructure/http/recurring-routes.ts`
- **Spoofing:** `requireSession` and `requireVerifiedEmail` guard the router; the origin guard blocks cross-site writes (R-07).
- **Tampering:** the shared `validate` middleware checks params, query and body on every route.
- **Repudiation:** audit lines with request, user and entity ids.
- **Information Disclosure:** the 404 body is identical for missing and foreign entities; logs hold ids only, never names or amounts.
- **Denial of Service:** the payment cap, the metered recorder and the row-level work keep each request bounded (R-03).
- **Elevation of Privilege:** handlers never read `req.body` unvalidated and never trust an owner id from the client.

### `apps/api/src/movements/infrastructure/recurring/drizzle-recurring-expense-recorder.ts`
- **Spoofing:** receives a typed scope from the caller; it cannot be constructed from a request body.
- **Tampering:** reuses `RecordManualMovement`, so the frozen rate, category-kind check and future-date rule apply unchanged.
- **Repudiation:** the movement record is the audit trail.
- **Information Disclosure:** returns only the movement id and date.
- **Denial of Service:** uses the metered path, not the unmetered one.
- **Elevation of Privilege:** the adapter is the only code allowed to cross into movements, enforced by the ESLint boundary block.

### `apps/web/src/features/recurring/containers/upcoming-container.tsx`
- **Spoofing:** relies on the session cookie; no tokens in client storage.
- **Tampering:** the form values are validated again by the server.
- **Repudiation:** not applicable on the client.
- **Information Disclosure:** names and amounts render through React, which escapes text; nothing is written to logs or the URL.
- **Denial of Service:** one list request per screen load; actions are disabled while a request is in flight.
- **Elevation of Privilege:** hiding an action in the UI is not relied on; the server enforces ownership.

## Data classification
| Data | Class | At rest | In transit |
|---|---|---|---|
| name, amount, account and category ids, dates of a recurring payment | financial | PostgreSQL volume encryption of the managed host; owner-scoped queries | TLS 1.2 or higher |
| occurrence status, confirmed amount, movement id | financial | same as above | TLS 1.2 or higher |
| session cookie | credentials | stored hashed by the identity module, unchanged | TLS, `Secure` and `HttpOnly` cookie |

## Risks and mitigations
| ID | Risk | STRIDE | Likelihood | Impact | Mitigation |
|---|---|---|---|---|---|
| R-01 | A user reads, edits or spends from another user's payment, account or occurrence | E | M | H | Owner scope in every repository, composite foreign keys, identical 404 body, tests for every route with a foreign id |
| R-02 | Crafted dates or fields produce wrong or hostile schedules | T | M | M | Shared strict schemas, calendar-valid dates, per-frequency fields, UTC string math with month-end and leap-year tests |
| R-03 | Large or old payments flood occurrences or slow the on-read job | D | M | M | Cap of 200 payments, 366-day lookback, perf test at 100 payments under 300 ms p95 |
| R-04 | Concurrent reads or confirmations duplicate occurrences or expenses | T | H | H | Unique key with insert-or-ignore, `for update` lock, resolved rows answer 409, concurrency test |
| R-05 | A slow recorder call holds an occurrence lock | D | L | L | Lock is one row only and bounded by the request timeout; accepted below |
| R-06 | A confirmed amount differs from what the payment said | T | L | L | Intended: the user edits their own confirmation; recorded amount is stored next to the movement |
| R-07 | Cross-site request forges a write | S | M | H | Global origin guard plus `X-Requested-With`, cookies `SameSite`, tests without trusted headers |
| R-08 | A crash after the expense is recorded but before the occurrence is marked leaves an orphan expense and a pending row | T | L | M | accepted, see below |

## Accepted risks
### R-05
- **Accepted by:** Joako (project owner), 2026-10-09
- **Justification:** the lock covers one row for one request and only the owner can hit it, so the worst case is that the owner's own retry waits.
- **Review conditions:** revisit if a confirmation ever calls an external service or if lock waits appear in production logs.

### R-08
- **Accepted by:** Joako (project owner), 2026-10-09
- **Justification:** the two writes sit in different modules and transactions; the window is one process crash between two statements. The user sees both the expense and the still-pending row and can delete the expense or skip the occurrence.
- **Review conditions:** revisit when DISC-001-08b adds the automatic recording, which needs a stronger idempotency key on the movement.

## Supply chain
No new dependency: the ticket uses packages already installed (Zod, Drizzle, Express, React, Next.js). The audit step of the closeout re-checks the existing set.

## Availability
The on-read materialization is bounded by the payment cap and the lookback; the job-based processing at scale (10,000 payments) belongs to DISC-001-08b. The routes sit behind the platform's edge limits and the movements write limiter covers the only expensive action.

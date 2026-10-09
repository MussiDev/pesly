# Threat model DISC-001-08b: Scheduler and automatic recording of recurring payments

| Field | Value |
|-------|-------|
| Ticket | DISC-001-08b |
| Spec | docs/ddw/specs/spec-DISC-001-08b.md |
| Tier | FEATURE |
| Date | 2026-10-09 |

## Components
| Component | Source in the spec |
|---|---|
| `apps/api/drizzle/0024_recurring_auto_recording_from.sql` | Block 1 |
| `apps/api/src/recurring/application/update-recurring-payment.ts` | Block 1 |
| `apps/api/src/movements/infrastructure/recurring/drizzle-recurring-expense-recorder.ts` | Block 2 |
| `apps/api/src/recurring/application/record-due-occurrences.ts` | Block 3 |
| `apps/api/src/recurring/infrastructure/db/drizzle-automatic-payment-source.ts` | Block 4 |
| `apps/api/src/recurring/infrastructure/jobs/recording-job.ts` | Block 4 |
| `apps/api/src/recurring/jobs.ts` | Block 4 |
| `apps/api/src/shared/config/env.ts` | Block 4 |

## Trust boundaries
- Worker process → database: the job reads every user's active automatic payments and writes in
  their names, with no end user and no session in the loop.
- Recurring module → movements module: the recorder port crosses into the movements use case, which
  enforces its own account, category, rate and ownership rules.
- Environment → worker: `RECURRING_JOB_INTERVAL_SECONDS` crosses from the platform configuration
  into the process.
- Browser → API: unchanged from 08a; the edits that move `auto_recording_from` arrive through the
  existing owner-scoped routes.

## STRIDE analysis
### `apps/api/drizzle/0024_recurring_auto_recording_from.sql`
- **Spoofing:** not applicable, a migration carries no identity.
- **Tampering:** the backfill sets the column from `created_at` in the owner's zone, so no existing
  automatic payment records its past (R-04); the migration is transactional.
- **Repudiation:** the migration journal and its rollback file record the change.
- **Information Disclosure:** the column holds a date, no personal data.
- **Denial of Service:** one `update ... join users` over the payments table, bounded by the 200
  payments per user cap.
- **Elevation of Privilege:** not applicable.

### `apps/api/src/recurring/application/update-recurring-payment.ts`
- **Spoofing:** acts only on the scope's owner, taken from the session.
- **Tampering:** the owner can move `auto_recording_from` only forward by editing their own payment, and
  the field is never read from the request body; unknown keys are stripped by the shared schema.
- **Repudiation:** the existing audit line records the edit with ids only.
- **Information Disclosure:** the field is not exposed by the API.
- **Denial of Service:** an edit touches one row.
- **Elevation of Privilege:** a foreign payment id answers 404 as in 08a.

### `apps/api/src/movements/infrastructure/recurring/drizzle-recurring-expense-recorder.ts`
- **Spoofing:** a movement id chosen by the caller could collide with another user's movement; the
  duplicate path reads with the owner scope, so a foreign id raises not found and links nothing (R-02).
- **Tampering:** the id equals the occurrence id, which only the job reads from the database; no request
  can set it.
- **Repudiation:** the movement row and the occurrence's `movement_id` and `resolved_at` record each
  automatic expense.
- **Information Disclosure:** the adapter returns only the movement id and date.
- **Denial of Service:** the unmetered path skips the manual limiter on purpose; volume is bounded by 200
  payments per user times their due dates (R-05).
- **Elevation of Privilege:** the movements rules (account and category ownership, expense kind) still run
  inside `CreateMovement`.

### `apps/api/src/recurring/application/record-due-occurrences.ts`
- **Spoofing:** each write uses a scope built for the payment's owner; the job never acts as a user it
  did not read from a payment.
- **Tampering:** dates come from the pure schedule function in the owner's zone; a double run is stopped
  by the occurrence's unique key, its `FOR UPDATE` lock and the movement id (R-01).
- **Repudiation:** failures are logged with payment and occurrence ids; recorded expenses are linked.
- **Information Disclosure:** logs carry ids only, never names or amounts (PRD FR-08).
- **Denial of Service:** one failing payment is isolated and the lookback is capped at 366 days (R-06).
- **Elevation of Privilege:** the synthetic scope is a write scope for one owner at a time; it grants
  nothing across owners, and queries stay owner-scoped (R-03).

### `apps/api/src/recurring/infrastructure/db/drizzle-automatic-payment-source.ts`
- **Spoofing:** not applicable, it reads rows.
- **Tampering:** read only; the query returns active automatic payments joined to `users.time_zone`.
- **Repudiation:** not applicable, no write.
- **Information Disclosure:** it reads every owner's payments, which is its purpose; it is reachable only
  from the worker and not from a request (R-03).
- **Denial of Service:** keyset pages of 500 rows keep memory flat for 10,000 payments.
- **Elevation of Privilege:** not exported through the module index, so no route can call it.

### `apps/api/src/recurring/infrastructure/jobs/recording-job.ts`
- **Spoofing:** not applicable.
- **Tampering:** timer and in-flight state live in the process, but what gets recorded depends only on the
  database, so a restart changes nothing (NFR-05).
- **Repudiation:** each pass logs counters.
- **Information Disclosure:** pass logs carry counts and ids only.
- **Denial of Service:** a pass runs after the previous one ended, so slow passes never overlap; a
  repeating error is logged once per key by a bounded set of 10,000 entries (R-06).
- **Elevation of Privilege:** not applicable.

### `apps/api/src/recurring/jobs.ts`
- **Spoofing:** the synthetic `AuthContext` carries a fixed job marker as session id, never a real
  session.
- **Tampering:** the factory wires fixed dependencies; nothing is read from a request.
- **Repudiation:** the job marker appears in the audit context of the writes.
- **Information Disclosure:** not applicable.
- **Denial of Service:** not applicable.
- **Elevation of Privilege:** the policy is the same `OwnerOrGroupMemberAccessPolicy` the API uses; the
  group reader denies all, so the job cannot reach group data (R-03).

### `apps/api/src/shared/config/env.ts`
- **Spoofing:** not applicable.
- **Tampering:** the variable is validated as an integer from 1 to 300, so a bad value fails start-up.
- **Repudiation:** not applicable.
- **Information Disclosure:** the value is not secret.
- **Denial of Service:** the lower bound of 1 second limits how hard a misconfigured job can poll (R-07).
- **Elevation of Privilege:** not applicable.

## Data classification
| Data | Class | At rest | In transit |
|---|---|---|---|
| name, amount, account and category ids, due dates of a recurring payment | financial | PostgreSQL volume encryption of the managed host; owner-scoped queries | TLS 1.2 or higher between the worker and the database |
| recorded expense and its link to the occurrence | financial | same as above | TLS 1.2 or higher |
| `auto_recording_from` | financial | same as above | TLS 1.2 or higher |
| owner time zone | PII | same as above | TLS 1.2 or higher |

## Risks and mitigations
| ID | Risk | STRIDE | Likelihood | Impact | Mitigation |
|---|---|---|---|---|---|
| R-01 | Two runs or a crash between the expense and the occurrence write produce two expenses | T | M | H | Movement id equals occurrence id, `DuplicateMovementId` is handled by linking, `FOR UPDATE` and unique key, concurrency and crash tests (AC-08 to AC-10) |
| R-02 | A caller-chosen movement id collides with another user's movement | S | L | H | The duplicate path reads with the owner scope and raises not found for a foreign id; ids come only from the database |
| R-03 | The job's write scope reaches data of the wrong owner | E | L | H | One scope per owner built from the payment row, group reader denies all, every query owner-scoped, source not exported through the module index |
| R-04 | Old automatic payments or edits record past dates the user never saw | T | M | M | Backfilled `auto_recording_from`, reset on create, resume, switch to automatic and schedule edits, tests AC-06 and AC-07 |
| R-05 | The unmetered recorder lets one user generate many movements | D | L | L | Bounded by the 200-payment cap and the 366-day lookback; only schedule rules create dates |
| R-06 | A failing payment blocks the job or floods the logs | D | M | M | Per-payment isolation, overlap guard, log de-duplication set capped at 10,000 keys |
| R-07 | A bad interval value hammers the database | D | L | M | Zod bounds 1 to 300 seconds, default 60 |
| R-08 | An archived account is retried every minute until the user acts | D | M | L | One cheap failed attempt per occurrence per pass, a log line once per error key through the capped set, per-payment isolation, and the 200-payment cap bound the cost; the retry is what records the expense once the account is unarchived, and DISC-001-08c will notify the user |

## Supply chain
No new dependency: the job uses the Node timer, Drizzle, Zod and the existing access policy. The audit
step of the closeout re-checks the installed set.

## Availability
The job is a single loop in the worker process; several workers can run it because row locks and the
movement id make each occurrence record once. If every worker is down, the next run after recovery
records the missed dates dated on their due dates (catch-up, FR-04). The 60 s default leaves a 15 min
window for the 06:00 to 06:15 guarantee.

# Threat model DISC-001-10e: Automatic debit of credit card statements

| Field | Value |
|-------|-------|
| Ticket | DISC-001-10e |
| Spec | docs/ddw/specs/spec-DISC-001-10e.md |
| Tier | FEATURE |
| Date | 2026-10-10 |

## Components
| Component | Source in the spec |
|---|---|
| `apps/api/drizzle/0027_card_automatic_debit.sql` | Block 2 |
| `apps/api/src/credit-cards/infrastructure/db/schema.ts` | Block 2 |
| `apps/api/src/credit-cards/application/set-card-debit-accounts.ts` | Block 3 |
| `apps/api/src/credit-cards/infrastructure/db/drizzle-credit-card-repository.ts` | Block 5 |
| `apps/api/src/credit-cards/infrastructure/db/drizzle-debit-accounts.ts` | Block 5 |
| `apps/api/src/credit-cards/infrastructure/db/drizzle-card-account-links.ts` | Block 5 |
| `apps/api/src/credit-cards/infrastructure/db/erase-user-credit-cards.ts` | Block 5 |
| `apps/api/src/credit-cards/infrastructure/http/credit-card-routes.ts` | Block 8 |
| `apps/api/src/credit-cards/domain/automatic-debit.ts` | Block 4 |
| `apps/api/src/credit-cards/application/record-automatic-debits.ts` | Block 4 |
| `apps/api/src/credit-cards/infrastructure/db/drizzle-automatic-debit-source.ts` | Block 6 |
| `apps/api/src/credit-cards/infrastructure/db/drizzle-automatic-debit-log.ts` | Block 6 |
| `apps/api/src/movements/infrastructure/credit-cards/drizzle-automatic-debit-recorder.ts` | Block 6 |
| `apps/api/src/credit-cards/infrastructure/jobs/automatic-debit-job.ts` | Block 7 |
| `apps/api/src/credit-cards/jobs.ts` | Block 7 |
| `apps/api/src/worker.ts` | Block 9 |
| `apps/web/src/features/credit-cards/debit-accounts-request.ts` | Block 10 |

## Trust boundaries
- Browser → API: `PUT /credit-cards/:id/debit-accounts` carries a card id and two account ids chosen by
  the user over the public internet; the session and the owner scope decide whose data they may name.
- API → database: the route, the use case and the repositories read and write `credit_cards` and
  `accounts` with the owner scope on every statement; the composite keys back it at the schema level.
- Worker process → database: the job reads every owner's cards with a debit account and writes
  transfers in their names, with no end user and no session in the loop. This is the only cross-owner
  read of the feature.
- API process → worker-only code: `credit-cards/jobs.ts` and the cross-owner source must stay
  unreachable from `server.ts` and from the module index.
- Credit-cards module → movements module: the recorder port crosses into `CreateMovement`, which
  enforces its own account, currency and archive rules; `credit-cards` never imports `movements`.
- Environment → worker: `RECURRING_JOB_INTERVAL_SECONDS` crosses from the platform configuration into
  the process (unchanged validation, now also pacing this job).

## STRIDE analysis
### `apps/api/drizzle/0027_card_automatic_debit.sql`
- **Spoofing:** not applicable, a migration carries no identity.
- **Tampering:** additive and nullable: existing cards get `null` in the four columns, so no card
  debits anything until its owner links an account; the composite keys, the card-account check and the
  state check of `card_automatic_debits` refuse inconsistent rows even if a code path is wrong (R-04,
  R-05).
- **Repudiation:** the journal entry and the rollback script record the change; the rollback header
  states that it loses every link and claim and needs a backup (R-14).
- **Information Disclosure:** the new columns hold ids, dates and statuses; no amount is stored in
  the claim table.
- **Denial of Service:** `ALTER TABLE ... ADD COLUMN` without defaults and one new table; the partial
  index keeps the job's page cheap (R-12).
- **Elevation of Privilege:** not applicable.

### `apps/api/src/credit-cards/infrastructure/db/schema.ts`
- **Spoofing:** not applicable.
- **Tampering:** `credit_cards_debit_*_account_owner_fk` ties the debit account to `(id, owner_id)` so a
  card can never point at another owner's account; `card_automatic_debits_card_owner_fk` ties each claim
  to the card's owner (R-02, R-04).
- **Repudiation:** `created_at` and `updated_at` plus `status`, `reason` and `movement_id` record every
  settled claim.
- **Information Disclosure:** `movement_id` has no foreign key on purpose, so a deleted transfer leaves
  only an orphan uuid in the owner's own row.
- **Denial of Service:** primary key (card, period, currency) bounds the table to one row per statement
  and currency.
- **Elevation of Privilege:** `on delete restrict` on the debit keys blocks deleting an account that a
  card debits; `on delete cascade` on the claim removes it with the card (R-11).

### `apps/api/src/credit-cards/application/set-card-debit-accounts.ts`
- **Spoofing:** acts only on the write scope built from the session; the card is loaded first and a
  foreign card stops the use case before any account is read (R-04).
- **Tampering:** both currencies are validated before anything is written; the account must be of the
  currency it is linked for, open, the owner's, and not a card account of any of the owner's cards
  (R-05, R-08); `linkedOn` is computed server-side and an unchanged account keeps its original date
  (R-06).
- **Repudiation:** the route's audit line records who changed which card (R-13).
- **Information Disclosure:** a foreign or missing account is 404 in both cases, so the endpoint does
  not confirm that an id exists for another user (R-04).
- **Denial of Service:** at most one card read, two account reads and one update per call.
- **Elevation of Privilege:** it can only link accounts of the same owner, so even a hijacked session
  cannot point a future debit outside the owner's accounts (R-07).

### `apps/api/src/credit-cards/infrastructure/db/drizzle-credit-card-repository.ts`
- **Spoofing:** not applicable.
- **Tampering:** `updateDebitAccounts` is one `UPDATE ... WHERE id AND owner_id = scope` writing the four
  columns together, so the account and its link date cannot diverge; a key violation from an account
  deleted meanwhile becomes `ResourceNotFound` (R-04).
- **Repudiation:** not applicable.
- **Information Disclosure:** another owner's scope matches no row and answers `null` (404), never a
  difference between "not yours" and "does not exist".
- **Denial of Service:** one indexed statement per call.
- **Elevation of Privilege:** the owner filter is in the statement, not in the caller; `isCardAccount` is
  scoped the same way.

### `apps/api/src/credit-cards/infrastructure/db/drizzle-debit-accounts.ts`
- **Spoofing:** not applicable.
- **Tampering:** read only.
- **Repudiation:** not applicable, no write.
- **Information Disclosure:** it returns only currency and an archived flag, filtered by the owner in
  the same statement; no balance or name leaves it (R-04).
- **Denial of Service:** one primary-key lookup per currency.
- **Elevation of Privilege:** a foreign account id yields `null`, so the use case answers 404 and never
  reaches the update (R-04).

### `apps/api/src/credit-cards/infrastructure/db/drizzle-card-account-links.ts`
- **Spoofing:** not applicable.
- **Tampering:** `isLinked` now also reads the two debit columns, so the accounts module refuses to
  delete a debit account (`ACCOUNT_LINKED_TO_CARD`) and the job never debits an account that vanished
  (R-08).
- **Repudiation:** not applicable.
- **Information Disclosure:** it is unscoped by design but answers a boolean about an id that the
  accounts module just loaded with the owner scope; it returns no row.
- **Denial of Service:** one `exists` over an indexed pair of columns.
- **Elevation of Privilege:** not applicable, it grants nothing.

### `apps/api/src/credit-cards/infrastructure/db/erase-user-credit-cards.ts`
- **Spoofing:** not applicable.
- **Tampering:** unchanged code; it deletes the cards before the accounts, so the restrict key on the
  debit columns never blocks erasure (R-11).
- **Repudiation:** not applicable.
- **Information Disclosure:** the cascade removes the links and every `card_automatic_debits` row, so no
  trace of an erased user's debits stays (R-11).
- **Denial of Service:** bounded by the user's own cards.
- **Elevation of Privilege:** not applicable.

### `apps/api/src/credit-cards/infrastructure/http/credit-card-routes.ts`
- **Spoofing:** `requireSession` and `requireVerifiedEmail` run before the handler; the scope comes from
  the session, never from the body (R-04, R-07).
- **Tampering:** the body is a strict Zod object with both keys required, so an unknown key or a
  forgotten key (a silent unlink) is a 400; params are a uuid.
- **Repudiation:** the audit line carries request id, user id and card id, and never account ids or
  names (R-13).
- **Information Disclosure:** a card or account of another user answers 404, never 403; the 400 body
  lists failing paths only and the response carries ids that the owner already knows (R-04).
- **Denial of Service:** the 16 kB body limit and one small write per call.
- **Elevation of Privilege:** Bob's `PUT` on Ana's card answers 404 and stores nothing; there is no way
  to name an account outside the session owner's data (R-04).

### `apps/api/src/credit-cards/domain/automatic-debit.ts`
- **Spoofing:** the derived transfer id uses SHA-256 over card, period and currency, with the `pesly:`
  prefix; it carries no secret and is only read by the job, so it is an idempotency key, not an
  identity (R-01).
- **Tampering:** pure `bigint` functions; `unpaidRemainder` never goes negative; `debitCandidates`
  applies the 06:00 rule and the link-date lower bound (R-06, R-09).
- **Repudiation:** not applicable, no side effects.
- **Information Disclosure:** not applicable.
- **Denial of Service:** pure and linear in the statements of one card.
- **Elevation of Privilege:** not applicable.

### `apps/api/src/credit-cards/application/record-automatic-debits.ts`
- **Spoofing:** each write uses a scope built for the card's owner as read from the source row; the use
  case never acts as an owner it did not read (R-02).
- **Tampering:** the remainder is recomputed inside the claim lock from fresh statements and payments,
  so a hand payment between the read and the claim is deducted; a statement whose state changed
  returns `null` and stays unclaimed (R-09). An `AppError` settles the claim `skipped`, so an
  archived account is not retried later against the user's intent (R-08).
- **Repudiation:** every outcome is a row in `card_automatic_debits` and every transfer is a movement
  with its id; failures are reported with ids and the error class name (R-10).
- **Information Disclosure:** `report` and the counters carry ids, period, currency, reason and class
  name only; a test asserts no amount, account name or card name appears (R-10).
- **Denial of Service:** one failing card or claim is counted and the pass continues; a card with no
  candidate costs no further query after the statements and settled keys (R-12).
- **Elevation of Privilege:** the use case holds a write scope for one owner at a time and the
  recorder re-checks account ownership, so it cannot move money between owners (R-02).

### `apps/api/src/credit-cards/infrastructure/db/drizzle-automatic-debit-source.ts`
- **Spoofing:** not applicable, it reads rows.
- **Tampering:** read only.
- **Repudiation:** not applicable, no write.
- **Information Disclosure:** it reads every owner's cards with a debit account, which is its purpose; it
  returns ids, card fields and the zone only, and is reachable only from the worker (R-03).
- **Denial of Service:** keyset pages of 500 ordered by card id over the partial index keep memory flat
  (R-12).
- **Elevation of Privilege:** owner id and zone come from the same `users` join, so an erased user has no
  entry and the write scope can never be built from anything but a live owner (R-02, R-11).

### `apps/api/src/credit-cards/infrastructure/db/drizzle-automatic-debit-log.ts`
- **Spoofing:** not applicable.
- **Tampering:** `INSERT ... ON CONFLICT DO NOTHING` then `SELECT ... FOR UPDATE` in one transaction makes
  the claim exclusive; the state check keeps `pending`, `recorded` and `skipped` coherent; a throwing
  `settle` rolls the claim back (R-01).
- **Repudiation:** the settled row keeps `status`, `reason`, `movement_id` and `updated_at`.
- **Information Disclosure:** `settledKeys` filters by owner in the same statement and hides `pending`
  rows.
- **Denial of Service:** a concurrent pass blocks on the unique index only until the first commit, then
  answers `already`; the lock is held for one claim (R-01, R-12).
- **Elevation of Privilege:** every statement carries the owner filter, so a scope cannot read or settle
  another owner's claim.

### `apps/api/src/movements/infrastructure/credit-cards/drizzle-automatic-debit-recorder.ts`
- **Spoofing:** the transfer id is supplied by the job, so it could collide with another user's
  movement; the duplicate path reads with the owner scope and a foreign id raises not found and links
  nothing (R-01, R-02).
- **Tampering:** it builds `CreateMovement`, so account ownership, archive state, currency match and
  same-account rules still run; a repeat with the same id returns the stored movement (R-01, R-05).
- **Repudiation:** the movement row is the record; the claim stores its id in `movement_id`.
- **Information Disclosure:** it returns the movement id only.
- **Denial of Service:** the unmetered path skips the manual write limiter on purpose; volume is at
  most one transfer per statement and currency, enforced by the claim key (R-12).
- **Elevation of Privilege:** it never lets the job write outside the scope's owner; a source or
  destination account of another owner is `ResourceNotFound` (R-02).

### `apps/api/src/credit-cards/infrastructure/jobs/automatic-debit-job.ts`
- **Spoofing:** not applicable.
- **Tampering:** timer and in-flight state live in the process, but what is recorded depends only on the
  database, so a restart or several workers change nothing (R-01).
- **Repudiation:** each pass that recorded, skipped or failed logs its counters.
- **Information Disclosure:** the log sink writes card id, period, currency, reason and error class name
  only (R-10).
- **Denial of Service:** passes never overlap, an error in a pass does not stop the chain, and repeated
  failures log once per key through a bounded set (R-12).
- **Elevation of Privilege:** not applicable.

### `apps/api/src/credit-cards/jobs.ts`
- **Spoofing:** the synthetic `AuthContext` carries the fixed marker `automatic-debit-job` as session id,
  never a real session, and `ownerId` comes only from the source's `users` join (R-02).
- **Tampering:** the factory wires fixed dependencies; nothing is read from a request.
- **Repudiation:** the job marker appears in the audit context of the writes.
- **Information Disclosure:** not applicable.
- **Denial of Service:** not applicable.
- **Elevation of Privilege:** it is deliberately not re-exported from `credit-cards/index.ts`, and a test
  asserts that the index and `server.ts` do not reach it (R-03). The policy is the same
  `OwnerOrGroupMemberAccessPolicy` the API uses.

### `apps/api/src/worker.ts`
- **Spoofing:** not applicable.
- **Tampering:** the interval is validated by `parseWorkerEnv` (integer 1 to 300) before any job starts.
- **Repudiation:** it logs `automatic debit job started` with the interval.
- **Information Disclosure:** not applicable.
- **Denial of Service:** on shutdown the job is stopped and awaited before the pool closes; a failing
  job does not stop the recurring jobs (R-12).
- **Elevation of Privilege:** the worker is the only composition root that knows both modules and the
  only caller of the cross-owner read (R-03).

### `apps/web/src/features/credit-cards/debit-accounts-request.ts`
- **Spoofing:** not applicable.
- **Tampering:** the candidate filter (open, same currency, not a card account) is a usability aid; the
  server re-validates everything, so a forged request gets the same 400, 404 or 409 (R-04, R-05).
- **Repudiation:** not applicable.
- **Information Disclosure:** it only builds a request from accounts the owner already loaded.
- **Denial of Service:** not applicable.
- **Elevation of Privilege:** it holds no authority; a card id such as `..` is refused by
  `resourcePath` without a request.

## Data classification
| Data | Class | At rest | In transit |
|---|---|---|---|
| `debit_ars_account_id`, `debit_usd_account_id`, `debit_*_linked_on` on `credit_cards` | financial | PostgreSQL volume encryption of the managed host; owner-scoped queries and composite keys | TLS 1.2 or higher between browser, API, worker and database |
| `card_automatic_debits` row (card, period, currency, status, reason, `movement_id`) | financial | same as above; no amount stored; cascade delete with the card | TLS 1.2 or higher |
| the recorded transfer (amount, accounts, date) | financial | same as above | TLS 1.2 or higher |
| owner time zone read by the source | PII | same as above | TLS 1.2 or higher |
| job log lines (card id, period, currency, reason, error class name) | financial | platform log store; identifiers only, never amounts or names | TLS 1.2 or higher to the log sink |

## Risks and mitigations
| ID | Risk | STRIDE | Likelihood | Impact | Mitigation |
|---|---|---|---|---|---|
| R-01 | Two concurrent passes, several workers, or a crash between recording and the claim commit debit the same statement twice | T | M | H | Primary key (card, period, currency), `ON CONFLICT DO NOTHING` then `FOR UPDATE`, and a SHA-256 transfer id so a repeat returns the stored movement; tests: concurrent `withClaim`, two simultaneous passes, crash then rerun (Blocks 6 and 7, AC-09). Residual edge: if the user deletes the transfer in the seconds between a crash and the rerun, the rerun records it once more, bounded to one remainder and to one interval |
| R-02 | The job writes with the wrong owner's scope, or moves money into or out of another owner's account | E | L | H | Scope built per owner only from the `users` join, composite keys on the debit and claim tables, owner filter on every statement, recorder test for a foreign source or destination account and a two-owner pass test (both added to Blocks 6 and 7) |
| R-03 | The cross-owner source or the job becomes reachable from the API process | E | L | H | Job not exported from `credit-cards/index.ts`, built only in `worker.ts`, tests that the index and `server.ts` do not import it (Blocks 7 and 9) |
| R-04 | IDOR on `PUT /credit-cards/:id/debit-accounts`: linking another user's account or editing another user's card | E | M | H | Session, verified email and owner write scope; card read first; account lookup filtered by owner; 404 for foreign and missing alike; composite foreign key and scoped `UPDATE` as the second layer; tests in Blocks 3, 5 and 8 |
| R-05 | A wrong-currency account, an archived account, or a card account is linked, so a debit mixes currencies or drains a card account | T | M | M | Use-case checks for currency, archive state and `isCardAccount`, a DB check against the card's own accounts, picker filter in the web client, the recorder's own currency rule; tests in Blocks 2, 3, 6, 8 and 10 |
| R-06 | Linking an account pays statements due before the link, moving money the user did not expect | T | M | H | D3 lower bound `debit_*_linked_on` in the owner's zone, kept when the same account is re-saved, reset when it changes; tests for statements due before and on the link date (Blocks 3 and 4) |
| R-07 | A stolen or briefly held session redirects a future automatic debit | S | L | M | The link can only name an account of the same owner, and the transfer only moves the statement remainder from that account to the card's own account, so no money leaves the owner's accounts; the session already allows creating movements, so no new privilege; verified email, session and audit line (R-13) |
| R-08 | A debit account that is archived, deleted or unlinked is debited later against the user's intent | T | M | M | D1: an unavailable account settles the claim `skipped` and is never retried; delete is blocked by the restrict key and `isLinked`; tests for archived, missing and refused accounts (Blocks 4, 5 and 7) |
| R-09 | Stale remainder: the user pays by hand and the job debits the full total, or an older statement absorbs the transfer | T | M | H | Remainder recomputed inside the claim lock from fresh statements and payments with the screen's `buildStatementViews`; a covered statement settles `covered`; tests for partial payment, paid between passes and two statements due together (Blocks 4 and 7) |
| R-10 | Logs or reports expose amounts, account names or card names | I | M | M | D11 and the sink write identifiers and the error class name only; tests in Blocks 4, 7 and 12 assert no amount, account name or card name in any logged field |
| R-11 | Erasure or card deletion leaves debit links or claim rows, or the restrict key blocks erasure | I | L | M | Cascade from `credit_cards` to the claim table, cards deleted before accounts, source inner-joins `users`; erasure test with other users' rows kept (Blocks 2 and 5) |
| R-12 | The job is slow or blocked: one failing card, a large card base, a hot loop, or lock contention | D | M | M | Per-card and per-claim failure isolation, keyset pages of 500 over a partial index, no overlapping passes, bounded log de-duplication, interval 1 to 300 s validated at start-up; tests in Blocks 4, 6, 7 and 9 |
| R-13 | A change to a debit link cannot be attributed to a user | R | L | M | The route's audit line carries request id, user id and card id; a test that the line holds no account id or name was added to Block 8; the claim row and the transfer record each automatic debit |
| R-14 | The migration or its rollback loses links, or merges with a stale journal `when` | T | L | M | Additive migration with nullable columns; the rollback is a manual plan step with a backup and a header warning; migration registry test and the merge-time re-check of `when` (Block 2) |

## Supply chain
No new runtime dependency: the feature uses `node:crypto` for SHA-256, Drizzle, Zod, the Node timer and
the existing access policy. The closeout `pnpm audit --prod --audit-level high` re-checks the installed
set.

## Availability
The job is a single loop in the worker process; several workers can run it because the claim row, its
lock and the deterministic transfer id make each statement record once. If every worker is down, the
first pass after recovery records every due statement (no upper bound on the due date, bounded below by
the link date). The 60 s default and the 300 s ceiling leave the 06:00 to 06:15 window of NFR-02 intact.
One failing card does not stop the pass, and a failed claim rolls back and is retried on the next pass;
a settled `skipped` claim is not retried by design.

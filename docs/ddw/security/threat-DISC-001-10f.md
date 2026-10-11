# Threat model DISC-001-10f: Statement due-date reminders

| Field | Value |
|-------|-------|
| Ticket | DISC-001-10f |
| Spec | docs/ddw/specs/spec-DISC-001-10f.md |
| Tier | FEATURE |
| Date | 2026-10-10 |

## Components
| Component | Source in the spec |
|---|---|
| `apps/api/drizzle/0032_card_statement_reminders.sql` | Block 2 |
| `apps/api/src/credit-cards/infrastructure/db/schema.ts` | Block 2 |
| `apps/api/src/notices/infrastructure/db/schema.ts` | Block 2 |
| `apps/api/src/credit-cards/application/update-credit-card-days.ts` | Block 3 |
| `apps/api/src/credit-cards/infrastructure/db/drizzle-credit-card-repository.ts` | Block 4 |
| `apps/api/src/credit-cards/infrastructure/http/credit-card-routes.ts` | Block 4 |
| `apps/api/src/credit-cards/domain/statement-reminder.ts` | Block 5 |
| `apps/api/src/credit-cards/application/create-statement-reminders.ts` | Block 5 |
| `apps/api/src/notices/domain/notice-text.ts` | Block 6 |
| `apps/api/src/notices/infrastructure/db/drizzle-statement-reminder-publisher.ts` | Block 6 |
| `apps/api/src/credit-cards/infrastructure/db/drizzle-statement-reminder-source.ts` | Block 7 |
| `apps/api/src/credit-cards/infrastructure/jobs/statement-reminder-job.ts` | Block 7 |
| `apps/api/src/credit-cards/jobs.ts` | Block 7 |
| `apps/api/src/worker.ts` | Block 8 |
| `apps/web/src/features/credit-cards/card-reminder-request.ts` | Block 9 |

## Trust boundaries
- Browser → API: `POST /credit-cards` and `PATCH /credit-cards/:id` carry a card id and the reminder days chosen by the
  user over the public internet; the session and the owner scope decide whose card they may name.
- API → database: the routes, the use cases and the repositories read and write `credit_cards` with the owner scope on
  every statement; the database check keeps the value inside 0 to 30.
- Worker process → database: the job reads every owner's cards, statements, purchases and payments and writes notices in
  their names, with no end user and no session in the loop. This is the only cross-owner read of the feature.
- API process → worker-only code: `credit-cards/jobs.ts` and the cross-owner source must stay unreachable from `server.ts`
  and from the module index.
- Credit-cards module → notices module: the publisher port crosses into the notices store; `credit-cards` never imports
  `notices`, and the notices adapter imports only port types.
- Worker → notices read path → browser: the stored text is shown to the owner by the notices screen as a plain text node;
  it is the only output of the job that a person reads.
- Environment → worker: `RECURRING_JOB_INTERVAL_SECONDS` crosses from the platform configuration into the process
  (unchanged validation, now also pacing this job).

## STRIDE analysis
### `apps/api/drizzle/0032_card_statement_reminders.sql`
- **Spoofing:** not applicable, a migration carries no identity.
- **Tampering:** one column with a constant default and a check, and a swap of the notice kind check; existing cards read
  3 and existing notices satisfy the new check, so no row changes meaning (R-08). The check is dropped and re-added in the
  same script, so there is no window without a kind guard in a committed state.
- **Repudiation:** the journal entry and the rollback script record the change; the rollback header states that it loses
  every reminder setting and every statement notice and needs a backup (R-09).
- **Information Disclosure:** the new column holds a small integer; no amount or name is stored.
- **Denial of Service:** `ADD COLUMN` with a constant default does not rewrite the table, and the check scans two small
  tables once; the lock is short (R-08).
- **Elevation of Privilege:** not applicable.

### `apps/api/src/credit-cards/infrastructure/db/schema.ts`
- **Spoofing:** not applicable.
- **Tampering:** `credit_cards_reminder_days_check` keeps the value in 0 to 30 even if a code path skips the schema (R-04).
- **Repudiation:** `updated_at` already records the last change of the card row.
- **Information Disclosure:** the column is read only through owner-scoped statements, or by the worker source.
- **Denial of Service:** a smallint column adds no index and no table growth.
- **Elevation of Privilege:** not applicable, the column grants nothing.

### `apps/api/src/notices/infrastructure/db/schema.ts`
- **Spoofing:** not applicable.
- **Tampering:** `notices_kind_check` lists exactly the four kinds, and the unique constraint (kind, `payment_id`, `due_date`)
  carries the kind, so a statement id can never collide with a recurring payment id; reusing `payment_id` for the statement
  id (D1) has no foreign key to bypass (R-03, R-07).
- **Repudiation:** `created_at` and `read_at` record when each notice was made and read.
- **Information Disclosure:** the row stores the rendered text, the due date and an opaque subject id; the notices
  routes filter by `owner_id` as before (R-05).
- **Denial of Service:** one row per statement and due date bounds the growth; the text length check caps each row.
- **Elevation of Privilege:** the owner key cascades from `users`, so erasing a user removes their notices.

### `apps/api/src/credit-cards/application/update-credit-card-days.ts`
- **Spoofing:** acts only on the write scope built from the session; the card is loaded first and a foreign card stops the
  use case before anything is written (R-01).
- **Tampering:** a reminder-only change passes an empty statement list, so it cannot overwrite hand-edited statement dates
  and therefore cannot silently move a due date (and with it a reminder) (R-06).
- **Repudiation:** the route's audit line records who changed which card (R-10).
- **Information Disclosure:** a missing or foreign card is the same `ResourceNotFound`, so the use case does not confirm that an id exists for another user (R-01).
- **Denial of Service:** one card read, at most one statement read and one transaction per call.
- **Elevation of Privilege:** the setting can only be written on the caller's own card.

### `apps/api/src/credit-cards/infrastructure/db/drizzle-credit-card-repository.ts`
- **Spoofing:** not applicable.
- **Tampering:** `updateDays` writes the three settings and the statements in one transaction with the owner filter in the statement, so the setting and the dates cannot diverge (R-06).
- **Repudiation:** not applicable.
- **Information Disclosure:** another owner's scope matches no row and answers `null` (404), never a difference between "not yours" and "does not exist" (R-01).
- **Denial of Service:** one indexed statement per call.
- **Elevation of Privilege:** the owner filter is in the statement, not in the caller.

### `apps/api/src/credit-cards/infrastructure/http/credit-card-routes.ts`
- **Spoofing:** `requireSession` and `requireVerifiedEmail` run before the handler; the scope comes from the session, never from the body (R-01).
- **Tampering:** the body is a strict Zod object; `reminderDays` must be an integer from 0 to 30, so a fraction, a string or an unknown key is a 400 and the route reads no unvalidated `req.body` (R-04).
- **Repudiation:** the audit line carries request id, user id and card id and never the card name (R-10).
- **Information Disclosure:** a card of another user answers 404, never 403; the 400 body lists failing paths only (R-01).
- **Denial of Service:** the 16 kB body limit and one small write per call.
- **Elevation of Privilege:** Bob's `PATCH` on Ana's card answers 404 and stores nothing (R-01).

### `apps/api/src/credit-cards/domain/statement-reminder.ts`
- **Spoofing:** not applicable.
- **Tampering:** pure functions over `bigint` and calendar dates; the 09:00 rule and the due-date window decide only whether a
  reminder is created, never an amount, and the due date it uses is the one read on that pass (R-06, R-11).
- **Repudiation:** not applicable, no side effects.
- **Information Disclosure:** not applicable.
- **Denial of Service:** linear in the statements of one card.
- **Elevation of Privilege:** not applicable.

### `apps/api/src/credit-cards/application/create-statement-reminders.ts`
- **Spoofing:** each write uses a scope built for the card's owner as read from the source row; the use case never acts as an owner it did not read (R-02).
- **Tampering:** the unpaid amount is recomputed on every pass from fresh payments with the screen's `buildStatementViews`, so a
  statement paid before its reminder day gets none (R-06); candidates already notified are dropped before any view is built (R-12).
- **Repudiation:** every notice is a row with its statement id and due date; failures are reported with ids and the error class name (R-05).
- **Information Disclosure:** `report` and the counters carry card id, statement id and class name only; a test asserts no card name, amount or language appears (R-05).
- **Denial of Service:** a failing card is counted and the pass continues; a card with no candidate costs the statement read only (R-12).
- **Elevation of Privilege:** one owner's write scope at a time; the publisher input carries the owner read from the same row as the card, so a notice cannot be addressed to another user (R-02).

### `apps/api/src/notices/domain/notice-text.ts`
- **Spoofing:** not applicable.
- **Tampering:** the renderer builds the text from a fixed template, the card name and a formatted date; the name is truncated to 80 characters, so the text stays under the 300-character check (R-05).
- **Repudiation:** not applicable.
- **Information Disclosure:** the function receives no amount and no account name, so none can reach the stored text (AC-08); a test scans both languages for amount digits and account names (R-05).
- **Denial of Service:** pure and constant time.
- **Elevation of Privilege:** not applicable. The card name is user-chosen text; the screen renders it as a plain text node, so markup in a name is not interpreted (R-13).

### `apps/api/src/notices/infrastructure/db/drizzle-statement-reminder-publisher.ts`
- **Spoofing:** the owner id comes from the job's source row, not from a request; the adapter has no route (R-02).
- **Tampering:** `INSERT ... ON CONFLICT DO NOTHING` on the unique key makes a repeated or concurrent publish a no-op, so a double pass cannot create a second notice (R-03).
- **Repudiation:** the row records kind, statement id, due date and creation time.
- **Information Disclosure:** `published` filters by owner and kind in the same statement and returns pairs of ids and dates only (R-02).
- **Denial of Service:** one multi-row insert and one indexed read per card per pass; volume is at most one notice per statement and due date (R-12).
- **Elevation of Privilege:** it can only insert notices of its kind for the given owner; it reads and updates nothing else.

### `apps/api/src/credit-cards/infrastructure/db/drizzle-statement-reminder-source.ts`
- **Spoofing:** not applicable, it reads rows.
- **Tampering:** read only.
- **Repudiation:** not applicable, no write.
- **Information Disclosure:** it reads every owner's cards, which is its purpose; it returns ids, card fields, the zone and the language only, and is reachable only from the worker (R-02).
- **Denial of Service:** keyset pages of 500 ordered by card id keep memory flat; it scans every card each pass, which is acceptable at the expected card count and is listed as a scale limit (R-12).
- **Elevation of Privilege:** owner id, zone and language come from the same `users` join, so an erased user has no entry and the write scope can never be built from anything but a live owner (R-02).

### `apps/api/src/credit-cards/infrastructure/jobs/statement-reminder-job.ts`
- **Spoofing:** not applicable.
- **Tampering:** timer and in-flight state live in the process, but what is created depends only on the database and the clock, so a restart or several workers change nothing (R-03).
- **Repudiation:** each pass that created or failed logs its counters.
- **Information Disclosure:** the log sink writes card id and error class name only (R-05).
- **Denial of Service:** passes never overlap, an error in a pass does not stop the chain, and repeated failures log once per card through a bounded set (R-12).
- **Elevation of Privilege:** not applicable.

### `apps/api/src/credit-cards/jobs.ts`
- **Spoofing:** the synthetic `AuthContext` carries the fixed marker `statement-reminder-job` as session id, never a real session, and `ownerId` comes only from the source's `users` join (R-02).
- **Tampering:** the factory wires fixed dependencies; nothing is read from a request.
- **Repudiation:** the job marker appears in the audit context of the writes.
- **Information Disclosure:** not applicable.
- **Denial of Service:** not applicable.
- **Elevation of Privilege:** it is deliberately not re-exported from `credit-cards/index.ts`, and a test asserts that the index and `server.ts` do not reach it (R-02). The policy is the same `OwnerOrGroupMemberAccessPolicy` the API uses; `credit-cards` still imports neither `notices` nor `movements`.

### `apps/api/src/worker.ts`
- **Spoofing:** not applicable.
- **Tampering:** the interval is validated by `parseWorkerEnv` (integer 1 to 300) before any job starts.
- **Repudiation:** it logs `statement reminder job started` with the interval.
- **Information Disclosure:** not applicable.
- **Denial of Service:** on shutdown the job is stopped and awaited before the pool closes; a failing job does not stop the others (R-12).
- **Elevation of Privilege:** the worker is the only composition root that knows credit-cards and notices together and the only caller of the cross-owner read (R-02).

### `apps/web/src/features/credit-cards/card-reminder-request.ts`
- **Spoofing:** not applicable.
- **Tampering:** the parser (digits, 0 to 30) is a usability aid; the server re-validates, so a forged request gets the same 400 (R-04).
- **Repudiation:** not applicable.
- **Information Disclosure:** it only builds a request from values the owner already sees.
- **Denial of Service:** not applicable.
- **Elevation of Privilege:** it holds no authority; a card id such as `..` is refused by `resourcePath` without a request.

## Data classification
| Data | Class | At rest | In transit |
|---|---|---|---|
| `reminder_days` on `credit_cards` | financial | PostgreSQL volume encryption of the managed host; owner-scoped queries | TLS 1.2 or higher between browser, API, worker and database |
| the card statement notice (`kind`, statement id, due date, text with the card name) | financial | same as above; no amount and no account name stored; removed with the owner by cascade | TLS 1.2 or higher |
| owner time zone and language read by the source | PII | same as above | TLS 1.2 or higher |
| statement totals and payments read to decide a reminder | financial | same as above; read in memory only, never stored by this feature | TLS 1.2 or higher |
| job log lines (card id, statement id, error class name) | financial | platform log store; identifiers only, never names or amounts | TLS 1.2 or higher to the log sink |

## Risks and mitigations
| ID | Risk | STRIDE | Likelihood | Impact | Mitigation |
|---|---|---|---|---|---|
| R-01 | IDOR on `PATCH /credit-cards/:id` or `POST /credit-cards`: reading or changing another user's reminder setting | E | M | M | Session, verified email and owner write scope; card read first; scoped `UPDATE`; 404 for foreign and missing alike; tests in Blocks 3 and 4 |
| R-02 | The job writes a notice for the wrong owner, or the cross-owner source or job becomes reachable from the API process | E | L | H | Scope and notice owner built per card only from the `users` join, owner filter on every publisher read, job not exported from `credit-cards/index.ts`, built only in `worker.ts`, tests that the index and `server.ts` do not import it and a two-owner pass test (Blocks 6, 7 and 8) |
| R-03 | Duplicate reminders from repeated passes, several workers or concurrent runs, spamming the user | T | M | M | Unique key (kind, statement id, due date) with `ON CONFLICT DO NOTHING`, plus the `published` pre-check; sequential and concurrent tests on a real database (Blocks 6 and 7, AC-06) |
| R-04 | A reminder setting outside 0 to 30 or not a whole number reaches the database | T | L | L | Shared Zod schema on the route, database check `credit_cards_reminder_days_check`, parser in the web client; tests in Blocks 1, 2, 4 and 9 |
| R-05 | Logs or notice text expose an amount, an account name or a card name where they should not | I | M | M | The renderer receives no amount or account name, the log sink writes ids and the class name only, tests that scan stored texts in both languages and every logged field (Blocks 5, 6 and 7); the card name appears only in the owner's own notice, which is the purpose of AC-08 |
| R-06 | A reminder for a statement the user already paid, a wrong day because the due date changed, or a reminder-only edit that overwrites hand-edited statement dates | T | M | M | The job reads the current due date and payments on each pass, the key carries the due date, a reminder-only change passes no statements to the update; tests for covered, moved and hand-edited dates (Blocks 3, 5 and 7) |
| R-07 | Reusing `payment_id` for the statement id makes the unique key or a reader mix a statement with a payment | T | L | M | The kind is part of the unique key and of every publisher statement, no foreign key exists to be violated, the port speaks of `statementId`, and the schema carries a comment; test of the same id with two kinds (Blocks 2 and 6) |
| R-08 | The migration locks `credit_cards` or `notices` for long, or fails on existing rows | D | L | M | A constant default does not rewrite the table, the notices check re-scan covers a small table and existing kinds all satisfy it; migration test on a populated database (Block 2) |
| R-09 | The rollback loses settings and notices, or leaves rows that an older web client cannot parse, or merges with a stale journal `when` | T | L | M | The reverse script deletes the new-kind notices before restoring the old check, the header warns about the backup, deploy order is migrate then API and web then worker, registry test and merge-time re-check of `when` (Block 2) |
| R-10 | A change to a card setting cannot be attributed to a user | R | L | L | The route's audit line carries request id, user id and card id; a test that the line holds no card name (Block 4) |
| R-11 | The reminder is late or missing because of the clock, the zone or downtime | T | M | M | 09:00 evaluated in the owner's zone with a fallback, catch-up through the due date, interval at most 300 s; fake-clock tests at 08:59, 09:00, 09:10, after downtime, after the due date and in two zones (Blocks 5 and 7) |
| R-12 | The job is slow or blocked: one failing card, a large card base scanned each pass, a hot loop, or three queries per card inside its window | D | M | M | Per-card failure isolation, keyset pages of 500, no overlapping passes, bounded log de-duplication, the `published` pre-check before views, interval 1 to 300 s validated at start-up; tests in Blocks 5, 7 and 8; a card-count index is not needed until the scan is measured to matter |
| R-13 | A card name with markup or control characters turns the notice text into an injection vector | I | L | M | The notices screen renders the text as a plain text node, the renderer truncates to 80 characters, the card name rules already reject control characters; the existing notices screen test covers a plain text node (Block 6) |

## Supply chain
No new runtime dependency: the feature uses Drizzle, Zod, `Intl.DateTimeFormat`, the Node timer and the existing access
policy and shared time helpers. The closeout `pnpm audit --prod --audit-level high` re-checks the installed set.

## Availability
The job is a single loop in the worker process; several workers can run it because the unique key and the conflict-ignoring
insert make each statement and due date produce one notice. If every worker is down, the first pass after recovery creates the
reminders of the days missed, up to the due date and never after it. The 60 s default and the 300 s ceiling leave the
09:00 to 09:15 window of NFR-01 intact. One failing card does not stop the pass, and a failed card is retried on the next pass.
If the notices store is unavailable the pass fails and retries; nothing is created partially for a card.

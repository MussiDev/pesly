# Threat model DISC-001-08c: Reminders and in-app notices for recurring payments

| Field | Value |
|-------|-------|
| Ticket | DISC-001-08c |
| Spec | docs/ddw/specs/spec-DISC-001-08c.md |
| Tier | FEATURE |
| Date | 2026-10-10 |

## Components
| Component | Source in the spec |
|---|---|
| `apps/api/drizzle/0025_notices.sql` | Block 2 |
| `apps/api/src/notices/domain/notice-text.ts` | Block 4 |
| `apps/api/src/notices/infrastructure/db/drizzle-notice-repository.ts` | Block 4 |
| `apps/api/src/notices/infrastructure/db/drizzle-notice-publisher.ts` | Block 4 |
| `apps/api/src/recurring/application/create-due-reminders.ts` | Block 5 |
| `apps/api/src/recurring/infrastructure/db/drizzle-reminder-payment-source.ts` | Block 5 |
| `apps/api/src/recurring/application/record-due-occurrences.ts` | Block 6 |
| `apps/api/src/notices/infrastructure/http/notices-routes.ts` | Block 7 |
| `apps/web/src/features/notices/containers/notices-container.tsx` | Block 8 |

## Trust boundaries
- Browser → API: `GET /notices` and the two `POST` routes carry a session and an id or a cursor over
  the public internet; the payment form carries `reminderDays` to the existing recurring routes.
- Worker process → database: the reminder pass reads every user's active payments and writes notices
  in their names, with no end user and no session in the loop.
- Recurring module → notices module: the publisher port crosses from the recurring use cases into the
  notices adapter, which writes rows for the owner it is given.
- Payment name (user input) → notice text → browser: text the user typed is stored inside a notice and
  rendered later, in the same account only, and in 08d on a lock screen.
- Environment → worker: `RECURRING_JOB_INTERVAL_SECONDS` is reused unchanged from 08b.

## STRIDE analysis
### `apps/api/drizzle/0025_notices.sql`
- **Spoofing:** not applicable, a migration carries no identity.
- **Tampering:** additive and transactional: one column with a default and one new table; the rollback
  drops only what 0025 created (R-09).
- **Repudiation:** the migration journal and its rollback file record the change.
- **Information Disclosure:** the new table holds notice text with a payment name and a date, no amount.
- **Denial of Service:** adding a `smallint` column with a constant default and creating an empty table
  take no long lock on a table of at most 200 rows per user.
- **Elevation of Privilege:** the `owner_id` foreign key cascades on user deletion, so a deleted user
  keeps no notices (AC-30).

### `apps/api/src/notices/domain/notice-text.ts`
- **Spoofing:** not applicable, a pure function.
- **Tampering:** the payment name is user input put inside a sentence; the sentence is stored as text and
  never interpreted as markup (R-03).
- **Repudiation:** not applicable.
- **Information Disclosure:** the function receives no amount and no account name, so neither can reach
  the text, whatever the caller does (R-02).
- **Denial of Service:** the name is cut to its stored limit of 80 characters, so the text stays under
  300 characters and under the table's check.
- **Elevation of Privilege:** not applicable.

### `apps/api/src/notices/infrastructure/db/drizzle-notice-repository.ts`
- **Spoofing:** every query takes the owner from the access scope that the session built.
- **Tampering:** marking read only sets `read_at`; the first read time is kept and nothing else changes.
- **Repudiation:** the route logs an audit line with ids when a notice is marked read.
- **Information Disclosure:** every query carries `owner_id` of the scope, so another user's id returns
  nothing and the route answers 404, never 403 (R-01).
- **Denial of Service:** the page is capped at 50 and keyset-paged on an index; the unread count uses a
  partial index (R-06).
- **Elevation of Privilege:** there is no query without an owner predicate in this repository.

### `apps/api/src/notices/infrastructure/db/drizzle-notice-publisher.ts`
- **Spoofing:** it writes for the `owner_id` it is handed; the only callers are the recurring use cases
  run by the worker, which read the owner from the `users` join (R-04).
- **Tampering:** `ON CONFLICT DO NOTHING` on (kind, payment, due date) makes a repeat or a parallel
  insert a no-op, so a notice cannot be duplicated or overwritten (R-05).
- **Repudiation:** a creation that fails is logged with ids and the error class name by the caller.
- **Information Disclosure:** it returns only whether a row was created.
- **Denial of Service:** one multi-row insert per page of 500 payments keeps a pass of 10,000 payments
  inside its budget (R-06).
- **Elevation of Privilege:** it is not exported through the API barrel, so no route can call it (R-04).

### `apps/api/src/recurring/application/create-due-reminders.ts`
- **Spoofing:** each reminder takes its owner and language from the same `users` row as the payment.
- **Tampering:** dates come from the shared schedule functions in the owner's zone; a user can change
  only their own time zone, which moves only their own reminders (R-07).
- **Repudiation:** failures are logged with payment ids and the error class name, never names or amounts.
- **Information Disclosure:** logs carry ids only; the notice text carries no amount.
- **Denial of Service:** one failing payment or page is isolated and the next one runs; the window looks
  at most 30 days ahead (R-08).
- **Elevation of Privilege:** it receives only the source and publisher ports and holds no write scope on
  any other module's data.

### `apps/api/src/recurring/infrastructure/db/drizzle-reminder-payment-source.ts`
- **Spoofing:** not applicable, it reads rows.
- **Tampering:** read only; active payments of existing users joined to `users`.
- **Repudiation:** not applicable, no write.
- **Information Disclosure:** it reads every owner's payments, which is its purpose; it is reachable only
  from the worker (R-04).
- **Denial of Service:** keyset pages of 500 rows keep memory flat for 10,000 payments.
- **Elevation of Privilege:** not exported through the module index, as the 08b source.

### `apps/api/src/recurring/application/record-due-occurrences.ts`
- **Spoofing:** each write still uses the scope built for the payment's owner (08b).
- **Tampering:** a notice is published after the expense commits, so a notice can never exist for an
  expense that was rolled back, and a repeated pass publishes nothing new (R-05).
- **Repudiation:** a failure to publish is reported with ids; the recorded expense stays linked to its
  occurrence.
- **Information Disclosure:** the `not_recorded` text names the payment and the day, never the reason
  or the account.
- **Denial of Service:** publishing runs outside the occurrence lock and in its own `try/catch`, so a
  notice error never blocks recording or the other payments (R-08).
- **Elevation of Privilege:** only a domain error of the recorder creates a `not_recorded` notice; a
  plain error is retried silently, so a storage outage cannot flood users with notices.

### `apps/api/src/notices/infrastructure/http/notices-routes.ts`
- **Spoofing:** `requireSession` and `requireVerifiedEmail` run before every handler.
- **Tampering:** the three routes validate params, query and body with the shared schemas; the cursor
  is decoded and checked, and a forged one only moves the position inside the caller's own rows (R-10).
- **Repudiation:** audit lines carry the user id and notice id.
- **Information Disclosure:** another user's notice id answers 404 with the same body as a missing one
  (R-01); responses carry no amount, account name or payment id.
- **Denial of Service:** `limit` is at most 50; marking all read is one update on the owner's partial
  index (R-06).
- **Elevation of Privilege:** a read scope serves the list and a write scope the two `POST` routes, as in
  the recurring routes.

### `apps/web/src/features/notices/containers/notices-container.tsx`
- **Spoofing:** the container calls the API with the session cookie; it never builds another user's id.
- **Tampering:** it sends only ids and the cursor it received from the API.
- **Repudiation:** not applicable.
- **Information Disclosure:** notice text is rendered as a text node, never as HTML, so a payment name
  with markup is shown literally (R-03); no notice data is cached outside the page.
- **Denial of Service:** the page loads 20 notices at a time and a failed load shows a retry state.
- **Elevation of Privilege:** not applicable, the browser holds no privilege the API does not check.

## Data classification
| Data | Class | At rest | In transit |
|---|---|---|---|
| notice text (payment name and day, no amount) | financial | PostgreSQL volume encryption of the managed host; owner-scoped queries | TLS 1.2 or higher between the browser and the API, and between the API or worker and the database |
| notice kind, due date, `read_at`, `payment_id` | financial | same as above | TLS 1.2 or higher |
| `reminder_days` | financial | same as above | TLS 1.2 or higher |
| owner language and time zone read by the job | PII | same as above | TLS 1.2 or higher |

## Risks and mitigations
| ID | Risk | STRIDE | Likelihood | Impact | Mitigation |
|---|---|---|---|---|---|
| R-01 | A user reads or marks another user's notice | I | M | H | Every query filters by the scope's owner, 404 for a foreign id, tests AC-22 |
| R-02 | An amount or an account name reaches a notice (and later a push) | I | M | H | The text function takes neither, a guard test over both languages and all kinds, tests AC-17 and NFR-05 |
| R-03 | A payment name with markup runs as script in the notices screen | T | L | H | Text rendered as a text node by React, no raw HTML insertion, a web test with a markup name |
| R-04 | The worker-only source or publisher is reachable from a request | E | L | H | Neither is exported through the module index, the publisher is injected only by the worker, an architecture review of the barrels |
| R-05 | Repeated or parallel passes duplicate notices | T | M | M | Unique key on (kind, payment, due date) with `ON CONFLICT DO NOTHING`, publish after commit, tests AC-23 and AC-24 |
| R-06 | A large list or pass degrades the API or the job | D | M | M | Page of at most 50 on an index, partial unread index, pages of 500 payments, benchmarks NFR-03 and NFR-04 |
| R-07 | A time zone change makes a reminder fire at the wrong time or twice | T | L | L | Times recomputed from the current zone on every pass, uniqueness stops a second notice, test AC-26 |
| R-08 | A failing notice or payment blocks recording and reminders | D | M | M | Per-payment and per-page isolation, publish outside the occurrence lock, tests AC-25 |
| R-09 | The migration blocks or loses data | T | L | M | Additive change only, a rollback that runs twice, a migration test against a fresh database |
| R-10 | A forged cursor reads outside the caller's rows or crashes the query | T | L | M | The cursor is decoded and validated by the shared schema, the keyset predicate sits inside the owner filter, test AC-19 |
| R-11 | Notices pile up without limit | D | L | L | At most three notices per occurrence, 200 payments per user, paged and indexed list; a purge is a follow-up if volume shows it (PRD risk) |

## Supply chain
No new dependency: text and dates use the built-in `Intl`, and everything else is the existing Drizzle,
Zod, Express and React set. The audit step of the closeout re-checks the installed set.

## Availability
The reminder pass is a second `setTimeout` chain in the worker, separate from the recording job, so a
failure in one does not stop the other. Several workers can run it because the unique key makes each
notice be created once. If every worker is down, the next pass after recovery creates the reminders whose
day arrived, as long as the due date has not passed (FR-03); recorded and not-recorded notices come from
the recording pass and follow its retries. The web badge degrades to showing nothing when the API is
unreachable.

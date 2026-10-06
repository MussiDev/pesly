# Threat model DISC-001-10a: Cards, Linked Accounts and Statement Cycles

| Field | Value |
|-------|-------|
| Ticket | DISC-001-10a |
| Spec | docs/ddw/specs/spec-DISC-001-10a.md |
| Tier | FEATURE |
| Date | 2026-10-06 |

## Components
| Component | Source in the spec |
|---|---|
| `apps/api/src/credit-cards/infrastructure/http/credit-card-routes.ts` (the seven `/credit-cards` routes) | Block 6 |
| `apps/api/src/credit-cards/infrastructure/db/drizzle-credit-card-repository.ts` (cards, statements and the linked accounts rows) | Block 4 |
| `apps/api/src/credit-cards/application/` (use cases, statement schedule, time zone port) | Block 3 |
| `apps/api/src/accounts/application/delete-account.ts` with the `AccountLinks` port | Block 5 |
| `apps/api/src/credit-cards/infrastructure/db/erase-user-credit-cards.ts` | Block 4 |
| `apps/api/drizzle/0019_credit_cards.sql` and its rollback | Block 2 |
| `apps/web/src/features/credit-cards/` and `apps/web/src/lib/api-client.ts` | Blocks 7, 8, 9 |

## Trust boundaries
- Browser → API: the seven `/credit-cards` routes and `DELETE /accounts/:id` carry the session
  cookie, the card name, the default days, statement dates and ids over the public internet.
- API → PostgreSQL: owner-scoped statements on `credit_cards`, `credit_card_statements` and
  `accounts`, inside the private network.
- `credit-cards` module → `accounts` and `movements` modules (in process): the card module writes
  account rows and asks whether accounts have movements; the accounts module asks whether an account
  is linked. Ids crossing this boundary come from scoped reads, never from the request directly.
- User erasure (identity) → `credit-cards`: the ordered erasure step runs inside the identity
  module's erasure transaction with the user id that identity verified.

## STRIDE analysis
### `apps/api/src/credit-cards/infrastructure/http/credit-card-routes.ts`
- **Spoofing:** every route sits behind `requireSession` (signed access token plus a live session
  row) and `requireVerifiedEmail`; no route is reachable anonymously. State-changing requests also
  pass the origin guard that requires the `X-Requested-With` header (R-01).
- **Tampering:** bodies, params and responses are validated by the shared strict Zod schemas through
  the one `validate` middleware; the owner is taken from the session, never from the body, so a
  caller cannot create a card for another user or attach someone else's account (R-02).
- **Repudiation:** create, day change, statement edit and delete write an audit line with the request
  id, user id and card or statement id; the request log adds method, route and status.
- **Information Disclosure:** a card or statement of another user answers the standard 404, the same
  as a missing one; audit lines and error bodies carry ids and codes only, never the card name
  (R-03).
- **Denial of Service:** the JSON body is capped at 16 kB; `GET /credit-cards/:id/statements` creates
  at most one statement per elapsed month with a hard guard of 1,200 cycles, and inserts are
  idempotent (R-05).
- **Elevation of Privilege:** the policy is the shared owner scope; there is no role or admin path,
  and group scopes are denied by the default membership reader.

### `apps/api/src/credit-cards/infrastructure/db/drizzle-credit-card-repository.ts`
- **Spoofing:** it receives an `AccessScope` built by the policy from the verified session; it has
  no other notion of identity.
- **Tampering:** every statement filters with `scopedTo` in the same SQL statement; composite foreign
  keys force both linked accounts and every statement to belong to the card's owner, so even a bug
  in the use case cannot link a foreign account (R-02).
- **Repudiation:** the rows carry `created_at` and `updated_at`; the audit lines are written by the
  route on success.
- **Information Disclosure:** all queries use Drizzle with bound parameters; the duplicate-name and
  foreign-key errors are translated into typed errors and never echoed (R-03, R-04).
- **Denial of Service:** creation and deletion are single short transactions over at most four rows;
  list queries use the `(owner_id, created_at, id)` and `(card_id, closing_date)` indexes.
- **Elevation of Privilege:** it writes accounts rows with fixed values (type `credit_card`, opening
  balance 0, not available), so a card cannot create an account the accounts API would refuse; the
  database checks of `accounts` still apply.

### `apps/api/src/credit-cards/application/`
- **Spoofing:** the time zone comes from the caller's own user row by primary key; an invalid zone
  falls back to Buenos Aires and a missing user fails closed.
- **Tampering:** statement dates are validated against the order invariant (previous closing date,
  next cycle's closing date, due after closing) and closed statements are immutable through the API
  (R-06).
- **Repudiation:** use cases return the stored result, which the route logs by id.
- **Information Disclosure:** use cases return only the caller's rows; nothing crosses users.
- **Denial of Service:** the schedule loop is bounded by elapsed months and the 1,200-cycle guard
  (R-05).
- **Elevation of Privilege:** deletion checks movements through the movements module's adapter before
  deleting, so a card cannot be used to delete accounts that hold financial history (R-07).

### `apps/api/src/accounts/application/delete-account.ts`
- **Spoofing:** unchanged: owner scope from the verified session.
- **Tampering:** a linked account cannot be deleted through `DELETE /accounts/:id` (409
  `ACCOUNT_LINKED_TO_CARD`), and the restricting foreign key refuses it at the database even if the
  guard were bypassed (R-08).
- **Repudiation:** the existing account audit lines are unchanged.
- **Information Disclosure:** `isLinked` is unscoped by design but only receives an id the scoped
  repository just returned, and returns a boolean; another user's account still answers 404 before
  the link is checked.
- **Denial of Service:** one indexed lookup on the unique account columns.
- **Elevation of Privilege:** no new capability; the check only narrows what delete may do.

### `apps/api/src/credit-cards/infrastructure/db/erase-user-credit-cards.ts`
- **Spoofing:** it runs only inside the identity erasure transaction, with the user id identity
  authenticated (password and second factor) before erasing.
- **Tampering:** it deletes by `owner_id` of that user only; statements go by cascade.
- **Repudiation:** the identity module records the erasure; this step adds no data.
- **Information Disclosure:** none; it returns nothing.
- **Denial of Service:** one delete per user over an owner index.
- **Elevation of Privilege:** the step cannot be called through HTTP; it is wired only in the
  composition root (R-09).

### `apps/api/drizzle/0019_credit_cards.sql` and its rollback
- **Spoofing:** not applicable to a schema migration run by the deploy pipeline; the reason is that
  no caller identity is involved.
- **Tampering:** check constraints mirror the request validation (name length, day ranges, period
  format, due after closing) as a second line of defence (R-10).
- **Repudiation:** the migration journal records it by `when`.
- **Information Disclosure:** no data is copied or exposed; new tables only.
- **Denial of Service:** additive DDL on two new, empty tables; no lock on existing large tables
  beyond the foreign-key validation on `accounts`, which is instant on new empty tables (R-10).
- **Elevation of Privilege:** no grants or roles change.

### `apps/web/src/features/credit-cards/` and `apps/web/src/lib/api-client.ts`
- **Spoofing:** the client sends the session cookie with credentials and refreshes it once on 401, as
  every other feature does; it stores no token itself.
- **Tampering:** the client validates with the same shared schemas, but the server re-validates
  everything; ids pass through `resourcePath`, which refuses `.` and `..` (R-11).
- **Repudiation:** not applicable on the client: the server holds the audit trail.
- **Information Disclosure:** the card name renders through React text nodes (escaped); nothing is
  written to local storage by this feature (R-12).
- **Denial of Service:** each action sends one request and disables its button while pending.
- **Elevation of Privilege:** the UI hides edit actions on closed statements, but the server is the
  authority (409 `STATEMENT_CLOSED`).

## Data classification
| Data | Class | At rest | In transit |
|---|---|---|---|
| Card name and the linked account names ("Visa ARS") | financial | PostgreSQL volume encrypted at rest, owner-scoped statements with bound parameters | TLS (production HTTPS guard), session cookie flagged Secure |
| Default closing and due days, statement periods, closing and due dates | financial | the same PostgreSQL volume, owner-scoped | TLS |
| Card, statement and account ids (random UUIDs) | public | primary keys; they carry no meaning | TLS |
| User time zone read to compute "today" | PII | stored by the identity module on the encrypted volume; read by primary key, never returned by these routes | not sent by these routes |
| Session cookie presented to the routes | credentials | not stored by this module; the identity module stores sessions hashed | TLS, cookie flagged Secure and HttpOnly in production |

## Risks and mitigations
| ID | Risk | STRIDE | Likelihood | Impact | Mitigation |
|---|---|---|---|---|---|
| R-01 | A cross-site request creates, edits or deletes a card with the victim's cookie | S | Low | Medium | Origin guard requiring `X-Requested-With` on state-changing requests, SameSite session cookie, CORS limited to the web origin; covered by the existing guard tests and a route test without the header (Block 6) |
| R-02 | A caller links another user's account to a card, or reads or edits another user's card or statement by id | T | Low | High | Owner taken from the session; `scopedTo` in every statement; composite foreign keys `(account_id, owner_id)` and `(card_id, owner_id)`; two-user tests for every route (Blocks 2, 4, 6) |
| R-03 | Card names or account names leak through logs or error bodies | I | Medium | Medium | Audit lines carry ids only; database errors become typed codes; a route test reads the captured log lines and a 500 body (Blocks 4, 6) |
| R-04 | SQL injection through the name, dates or ids | T | Low | High | Drizzle with bound parameters only; strict Zod validation of every field before the use case; check-constraint literals come from constants (Blocks 1, 2, 4) |
| R-05 | A card read after a long time, or many concurrent reads, generates statements without bound or twice | D | Low | Medium | Generation stops at the first open cycle and at a 1,200-cycle guard; `on conflict (card_id, period) do nothing` makes concurrent reads idempotent; tests cover the guard and a repeated insert (Blocks 3, 4) |
| R-06 | A closed statement is rewritten, or dates are set out of order so later sub-tickets assign purchases to the wrong statement | T | Medium | Medium | Closed statements answer 409; the order invariant (D9) is validated on every edit and day change; the database check keeps due after closing; tests for each refusal (Blocks 2, 3, 6) |
| R-07 | Deleting a card destroys accounts that hold movements, losing financial history | T | Medium | High | The use case checks movements on both accounts first (user decision D1); the movements' restricting foreign keys refuse the delete if a movement appears in between, which maps to 409 and rolls back; tests for both paths (Blocks 3, 4, 6) |
| R-08 | A linked account is deleted through the accounts API, leaving a card pointing to nothing | T | Medium | Medium | `AccountLinks` guard answers 409 `ACCOUNT_LINKED_TO_CARD`; the restricting composite foreign keys refuse it in the database; the foreign-key race maps to the same code (Blocks 2, 5) |
| R-09 | User erasure fails or leaves card rows because the restricting keys block the cascade from `users` | D | Medium | High | Ordered erasure step `eraseUserCreditCards` registered after `eraseUserMovements`; the erasure registry guard lists both tables and their allowed restricting constraints; an end-to-end erasure test with a card (Blocks 4, 6) |
| R-10 | Migration 0019 fails, is skipped on a database that ran a newer migration, or its rollback breaks | D | Low | Medium | Additive tables only; hand-checked statement order; journal `when` above 0018 and `main`'s maximum, checked before merge; idempotent rollback tested twice; all older migration suites revert 0019 first (Block 2) |
| R-11 | A crafted id in the web app reaches another API path (`..`) | T | Low | Low | `resourcePath` refuses `.`, `..` and empty ids and encodes the rest; ids are also validated as UUIDs by the API (Block 7) |
| R-12 | A card name with markup or bidi characters spoofs other text in the UI | I | Low | Low | Names reject control and format characters (bidi overrides, zero-width) in the shared schema; React renders them as text (Blocks 1, 8) |
| R-13 | A verified user creates a very large number of cards, each writing two accounts and a statement | D | Low | Low | Same surface as `POST /accounts`, which is equally unlimited at personal scale; every request is a constant-size transaction behind a verified session and the 16 kB body cap, and the account name uniqueness forces distinct names (Block 6) |

## Supply chain
No new dependency, runtime or development: the module uses Drizzle, Zod, Express and the date
arithmetic is plain integer code in `packages/shared`. The `pnpm audit --prod --audit-level high`
gate runs at the end of CODE.

## Availability
The DoS vectors are bounded statement generation (R-05), mass card creation (R-13) and the
migration (R-10), each mitigated above. Edge limits of the hosting platform sit in front of the API;
no external service is called by this ticket, so no third-party outage affects it.

# Threat model FEAT-012: Balance adjustments instead of editing the opening balance

| Field | Value |
|-------|-------|
| Ticket | FEAT-012 |
| Spec | docs/ddw/specs/spec-FEAT-012.md |
| Tier | FEATURE |
| Date | 2026-10-13 |

## Components
| Component | Source in the spec |
|---|---|
| `apps/api/src/accounts/application/set-account-balance.ts` | Block 4 |
| `apps/api/src/identity/application/require-second-factor.ts` | Block 4 |
| `apps/api/src/movements/infrastructure/accounts/drizzle-balance-adjuster.ts` | Block 4 |
| `apps/api/src/accounts/infrastructure/http/account-routes.ts` | Block 4, Block 5 |
| `apps/api/src/movements/application/update-movement.ts` | Block 6 |
| `apps/api/drizzle/0040_balance_adjustments.sql` | Block 2 |
| `apps/web/src/features/accounts/containers/accounts-container.tsx` | Block 7 |

## Trust boundaries
- Browser → Express API: the account id, the target balance and the note are chosen by the caller in
  `POST /accounts/:id/balance`; the server decides what the caller may touch and what the difference is.
- Accounts module → identity module: `set-account-balance.ts` asks the second-factor gate whether the
  caller proved the second factor before any write.
- Application → PostgreSQL: the adjuster reads the balance and inserts the adjustment in one
  transaction, while other requests of the same user may be changing the same account at that moment.
- Migration runner → production database: `0040_balance_adjustments.sql` alters constraints on the
  `movements` table that holds every user's financial history.

## STRIDE analysis
### `apps/api/src/accounts/application/set-account-balance.ts`
- **Spoofing:** the user id comes from the session issued by the authentication middleware, never from
  the body, and the account is looked up by id and owner together.
- **Tampering:** the body is parsed by the shared strict schema (integer string within the opening
  balance limits, note of at most 500 code points), and the client never sends the difference: the
  server computes `target − current` itself, so a client cannot choose the stored amount (R-01).
- **Repudiation:** the route writes the audit log line `account balance adjusted` with request id, user
  id and account id, and the adjustment row keeps its own date and note, so who changed a balance and
  when can be told; amounts are not written to the log.
- **Information Disclosure:** a missing account and an account of another user answer the same 404, so
  the answer does not reveal whether another user's account exists (R-02).
- **Denial of Service:** one account, one lock and one insert per request, with no loop over the user's
  data, behind the existing write rate limit per user.
- **Elevation of Privilege:** the route requires the write scope and the owner check, so a read-only
  credential or another user cannot adjust a balance; a credit card account is refused with 422, so
  card statements cannot be altered through this path.

### `apps/api/src/identity/application/require-second-factor.ts`
- **Spoofing:** the user id comes from the session; a code is checked against that user's own 2FA
  settings only, so a code of another user never validates.
- **Tampering:** a TOTP code is accepted only for a step later than the last one used and a recovery code
  only while unused, so a captured code cannot be replayed (R-07).
- **Repudiation:** a refused code writes the same log line as a refused 2FA disable, with ids only, and
  a wrong code is also recorded against the sign-in limit.
- **Information Disclosure:** a missing, wrong or used code answer the same `TOTP_INVALID`, so the answer
  does not tell which of the three happened.
- **Denial of Service:** attempts are reserved with the policies of disabling 2FA before any code check,
  and an exhausted limit answers 429 without checking, so guessing is bounded and an attacker cannot
  use the endpoint to lock the owner out of other actions beyond that limit.
- **Elevation of Privilege:** with 2FA on, a session alone cannot set a balance, so a stolen session
  loses this capability; with 2FA off no code is asked (the residual risk of R-07).

### `apps/api/src/movements/infrastructure/accounts/drizzle-balance-adjuster.ts`
- **Spoofing:** it receives the owner id from the use case and uses it in every query, never an id read
  from the account row.
- **Tampering:** the account row is locked with `for update` before the balance is read, and the sum is
  computed after the lock, so two concurrent requests cannot both compute a difference from the same
  stale balance and double-apply (R-03).
- **Repudiation:** the inserted adjustment cannot be edited (no update path, `PUT` answers 409), and
  its removal goes through the audited movement delete, so the history cannot be rewritten silently.
- **Information Disclosure:** its errors carry a status only (`not_found`, `archived`, `credit_card`)
  and no balance, amount or note.
- **Denial of Service:** the lock is held for two statements inside one transaction, taken on one row,
  so it cannot deadlock with another request of the same account.
- **Elevation of Privilege:** it imports nothing from the accounts module internals and the accounts
  module reaches it only through the `BalanceAdjuster` port, so the owner scoping stays in one place.

### `apps/api/src/accounts/infrastructure/http/account-routes.ts`
- **Spoofing:** every route reads the identity from the session; the removed opening-balance route no
  longer exists, so it cannot be called with another user's account id.
- **Tampering:** removing `PATCH /accounts/:id/opening-balance` closes the path that rewrote the
  opening balance and the whole past net-worth curve without a trace (R-04).
- **Repudiation:** the new route logs through the same audit helper as the other account routes.
- **Information Disclosure:** the 404 of the removed route is the router's standard answer and leaks
  nothing about accounts.
- **Denial of Service:** validation runs before the use case, so a malformed body costs no database
  work.
- **Elevation of Privilege:** `validate({ params, body })` and the write scope are applied to the new
  route as to its neighbours, so no route reads `req.body` unvalidated.

### `apps/api/src/movements/application/update-movement.ts`
- **Spoofing:** the owner comes from the session and the movement is read scoped by owner.
- **Tampering:** an adjustment cannot be edited: `PUT` answers 409 with `MovementTypeImmutable` and the
  row is unchanged, and `POST /movements` refuses `type: 'adjustment'` through the creation schema, so
  an adjustment can only be born from the set-balance route (R-04).
- **Repudiation:** deletion of an adjustment uses the existing delete route and its audit line.
- **Information Disclosure:** another user's adjustment answers 404 on read, edit and delete.
- **Denial of Service:** no new query; the guard is a type check on a row already loaded.
- **Elevation of Privilege:** the creation schema lists only `CREATABLE_MOVEMENT_TYPES`, so a client
  cannot create a signed, category-less movement through the generic route to evade report rules.

### `apps/api/drizzle/0040_balance_adjustments.sql`
- **Spoofing:** it runs only in the deploy pipeline with the migration role, not from a request.
- **Tampering:** it only widens `movements_type_check` and the amount and shape checks and changes no
  row, so existing balances stay the same (AC-13); the shape check forces an adjustment to carry no
  category, rate or destination (R-05).
- **Repudiation:** the migration is a versioned file with a journal entry and a snapshot, reviewed in
  the pull request.
- **Information Disclosure:** it reads and writes no row data.
- **Denial of Service:** replacing the check constraints takes a short lock on `movements`; it runs
  inside the migration transaction at deploy time (R-06).
- **Elevation of Privilege:** it grants nothing and creates no role.

### `apps/web/src/features/accounts/containers/accounts-container.tsx`
- **Spoofing:** the request uses the session cookie like every other call of the web app, with no token
  handled by the component.
- **Tampering:** the dialog sends only the target balance and the note; the displayed difference is a
  preview and the server's value is the one stored.
- **Repudiation:** the user sees the stored adjustment in the movements list right after confirming.
- **Information Disclosure:** the balance is shown only to the signed-in owner and is not written to
  logs, the offline store or the URL.
- **Denial of Service:** the confirm button is disabled while a request is in flight and offline, so a
  double click sends one request.
- **Elevation of Privilege:** hiding the opening-balance form is a convenience; the server rejects the
  removed route regardless of what the client does.

## Data classification
| Data | Class | At rest | In transit |
|---|---|---|---|
| target balance and adjustment amount | financial | PostgreSQL volume encryption of the managed database; bigint in minor units | TLS 1.3 to the API |
| adjustment note | financial | PostgreSQL volume encryption of the managed database | TLS 1.3 to the API |
| account id and user id in the audit line | PII | application log retention policy; no amounts logged | log shipper over TLS |
| second-factor code (TOTP or recovery code) | credentials | not stored by this feature; the existing 2FA secret and recovery code hashes are read, never written beyond marking use | TLS 1.3 to the API |
| session cookie | credentials | not stored by this feature | TLS 1.3, cookie flagged Secure and HttpOnly |

## Risks and mitigations
| ID | Risk | STRIDE | Likelihood | Impact | Mitigation |
|---|---|---|---|---|---|
| R-01 | a client forces an arbitrary adjustment amount | T | M | H | the server computes `target − current` under a row lock and never accepts a difference from the client (Block 4) |
| R-02 | an account of another user is adjusted or its existence is revealed | I | L | H | the account is looked up by id and owner; a foreign or missing account answers 404 (AC-16) |
| R-03 | two concurrent requests lose an update and leave a wrong balance | T | M | H | `select ... for update` on the account row, sum computed after the lock, 20-concurrent-request test (AC-15) |
| R-04 | the history is rewritten through an editable adjustment or the removed opening-balance route | T | M | H | route removed (AC-09), `PUT` on an adjustment answers 409 (AC-08), creation schema refuses the type |
| R-05 | a malformed adjustment row (category, rate, destination) distorts reports | T | L | M | the shape check constraint of migration 0040 and the migration test |
| R-06 | the constraint change locks `movements` during deploy | D | L | M | additive checks only, applied in the migration transaction; rollback script provided and refuses to run when adjustments exist |
| R-07 | a stolen session adjusts balances to hide spending | E | M | M | second-factor code required when 2FA is on (FR-14, AC-19, AC-20), with the limits of disabling 2FA; users without 2FA keep today's exposure, see below |
| R-08 | repeated guesses of the second-factor code through the new route | S | L | H | attempts reserved with the policies of disabling 2FA, 429 when exhausted, wrong codes counted against the sign-in limit |

## Accepted risks
### R-07
- **Accepted by:** the project owner (Joako), who chose the second-factor mitigation instead of accepting the risk in full
- **Justification:** the second factor protects users who turned it on; for users without it a stolen session can already create, edit and delete any movement, so an adjustment adds no capability, and every adjustment is dated, kept in the history and audited.
- **Review conditions:** revisited when password re-entry or a Google re-authentication is wanted for users without 2FA, or before multi-user access to one account is allowed.

## Supply chain
No new runtime dependency is added: the feature uses Zod, Drizzle and the existing money helpers
already in the repository.

## Availability
The only DoS vectors are the account row lock and the constraint change at deploy time (R-06). The lock
is held for two statements on one row, and the write rate limit per user caps the request rate; the
migration is additive and has a rollback script.

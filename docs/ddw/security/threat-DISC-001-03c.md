# Threat model DISC-001-03c: Transfers and Currency Exchange

| Field | Value |
|-------|-------|
| Ticket | DISC-001-03c |
| Spec | docs/ddw/specs/spec-DISC-001-03c.md |
| Tier | FEATURE |
| Date | 2026-10-02 |

## Components
| Component | Source in the spec |
|---|---|
| `packages/shared/src/movements/movement.ts` | Block 1 |
| `packages/shared/src/movements/implied-rate.ts` | Block 1 |
| `apps/api/src/movements/application/create-movement.ts` | Block 2 |
| `apps/api/src/movements/infrastructure/db/schema.ts` | Block 3 |
| `apps/api/drizzle/0016_transfers_exchanges.sql` | Block 3 |
| `apps/api/src/movements/infrastructure/db/drizzle-movement-repository.ts` | Block 3 |
| `apps/api/src/movements/infrastructure/accounts/drizzle-account-movements.ts` | Block 4 |
| `apps/api/src/movements/infrastructure/http/movement-routes.ts` | Block 5 |
| `apps/web/src/features/movements/containers/create-movement-container.tsx` | Block 6 |

## Trust boundaries
- Browser → API: `POST /movements` carries the source and destination account ids, two amounts and a note over the public internet, validated by the shared Zod union before any use case runs.
- API → database: the insert and the balance queries cross into the private database; the composite keys `(account_id, owner_id)` and `(destination_account_id, owner_id)` and the shape check repeat the owner and shape rules there.
- Accounts module → movements module: `AccountMovements` is unscoped by design and answers only for the ids the accounts module gives it; the new destination side keeps that rule.
- Operator → database: the rollback script `0016_transfers_exchanges.down.sql` runs with administrator rights and deletes rows.

## STRIDE analysis
### `packages/shared/src/movements/movement.ts`
- **Spoofing:** the request carries no user id; the owner comes from the session (R-01).
- **Tampering:** a client can send keys that do not belong to the type (a category or a rate on a transfer, a rate on an exchange); the union strips them, so a client can never choose the stored rate of an exchange.
- **Repudiation:** the route logs the request id, user id and movement id for every creation.
- **Information Disclosure:** the schema errors name the field only, never the value or another user's data.
- **Denial of Service:** amount strings are bounded to 16 digits and notes to 500 characters before any BigInt conversion.
- **Elevation of Privilege:** the discriminated union gives each type its own allowed keys; a transfer body cannot smuggle a category or a rate source.

### `packages/shared/src/movements/implied-rate.ts`
- **Spoofing:** not applicable, a pure function with no identity (no actor can impersonate anything here).
- **Tampering:** the rate is always derived on the server from the two stored amounts; the web preview is display only (R-02).
- **Repudiation:** the derived rate is stored with the movement and its amounts, so the calculation can be redone and checked afterwards.
- **Information Disclosure:** the function takes two integers and returns an integer or null; it leaks nothing.
- **Denial of Service:** bigint arithmetic on values below 10^15 is constant time; a zero divisor throws before dividing.
- **Elevation of Privilege:** not applicable, the function has no privileges and touches no data.

### `apps/api/src/movements/application/create-movement.ts`
- **Spoofing:** both accounts are looked up with the caller's scope; an account id of another user is indistinguishable from a missing one (R-03).
- **Tampering:** the currency rules, the archived rule and the implied-rate range are enforced here and again by checks in the database (R-04).
- **Repudiation:** a rejected creation stores nothing and a saved one is logged by id; the limiter refunds its unit on failure so the counters stay truthful.
- **Information Disclosure:** the order of checks looks both accounts up before any account-rule error, so a foreign id answers 404 and never reveals whether the account exists or what its currency is.
- **Denial of Service:** creation is limited to 60 per minute per user, shared by the four movement types (R-05).
- **Elevation of Privilege:** the use case reads only accounts in the caller's scope and writes only with the owner of the scope; there is no path to move money from another user's account.

### `apps/api/src/movements/infrastructure/db/schema.ts`
- **Spoofing:** the owner column is filled from the session scope, never from input.
- **Tampering:** the shape check, the range checks and the composite keys make a malformed row impossible even for code that bypasses the use case.
- **Repudiation:** `created_at` and the owner are stored on every row and rows are not updated by this ticket.
- **Information Disclosure:** no new sensitive column is added; the new columns are an account id and an amount of the same owner.
- **Denial of Service:** the new index on `destination_account_id` keeps the balance and restrict checks indexed; no unbounded scan is introduced.
- **Elevation of Privilege:** `ON DELETE RESTRICT` on the destination key stops an account that holds money history from being deleted.

### `apps/api/drizzle/0016_transfers_exchanges.sql`
- **Spoofing:** not applicable, a migration run by the deploy process with its own credentials (no end-user actor).
- **Tampering:** the migration relaxes not-null columns; the shape check re-imposes the rules per type, and every existing row already satisfies it, so no data is rewritten.
- **Repudiation:** the drizzle journal records that it ran and when.
- **Information Disclosure:** no data leaves the database; the script only alters the structure.
- **Denial of Service:** the alter statements take short locks on `movements`; a failed migration leaves the previous structure in place because it runs in a transaction.
- **Elevation of Privilege:** a `when` lower than another migration would make production skip the file silently; the journal `when` rule of D7 and the merge-time check prevent it (R-06).

### `apps/api/src/movements/infrastructure/db/drizzle-movement-repository.ts`
- **Spoofing:** the owner is forced from the scope on insert; a caller cannot pass another owner.
- **Tampering:** values are inserted field by field through parameters; there is no string-built SQL.
- **Repudiation:** the repository adds no side effects; the route logs by id.
- **Information Disclosure:** every read applies `scopedTo(scope, { owner })` in the same statement, so another owner's transfer or exchange is never returned and a foreign id answers 404 (R-03).
- **Denial of Service:** pages are capped at 100 rows and the list stays on the owner and date index.
- **Elevation of Privilege:** a row with an inconsistent shape is a programming error and is never returned as a valid movement.

### `apps/api/src/movements/infrastructure/accounts/drizzle-account-movements.ts`
- **Spoofing:** not applicable, an internal port with no identity of its own (no actor can impersonate anything here).
- **Tampering:** a wrong sign on the destination side would silently corrupt every balance; the sums are tested for both sides of both new types (R-07).
- **Repudiation:** balances are derived from stored rows and can be recomputed at any time.
- **Information Disclosure:** the adapter is unscoped by design but keyed by the ids it was given and never selects other accounts' rows.
- **Denial of Service:** two grouped queries per chunk of 500 ids over indexed columns; the 03b performance test is re-run with transfers.
- **Elevation of Privilege:** it cannot be reached from a route; only the accounts use cases call it with ids their own scoped repository returned.

### `apps/api/src/movements/infrastructure/http/movement-routes.ts`
- **Spoofing:** `requireSession` and `requireVerifiedEmail` run before the handler; state-changing requests also pass the origin checks.
- **Tampering:** params, query and body go through the shared validation middleware; the response is validated against the shared schema.
- **Repudiation:** the audit line carries request id, user id and movement id only.
- **Information Disclosure:** failures answer `{ code }`; logs never contain amounts, notes or rates; another user's accounts answer 404.
- **Denial of Service:** the 60 per minute limit answers 429 with `Retry-After` (R-05).
- **Elevation of Privilege:** the owner always comes from the session; there is no group scope here (the deny-all membership reader stays).

### `apps/web/src/features/movements/containers/create-movement-container.tsx`
- **Spoofing:** the container sends no identity; the session cookie authenticates the request.
- **Tampering:** the client never sends the rate of an exchange; the preview is display only, and the API recomputes and stores the value (R-02).
- **Repudiation:** the saved view shows the frozen rate returned by the API, so the user sees what was stored.
- **Information Disclosure:** account names and balances come from the user's own API responses; nothing is written to storage or logs, and no amounts go into push text.
- **Denial of Service:** the container blocks a second submit while one is pending and reports 429 with the seconds to wait.
- **Elevation of Privilege:** client-side currency and archived filters are conveniences; the server repeats every rule, so a modified client gains nothing.

## Data classification
| Data | Class | At rest | In transit |
|---|---|---|---|
| amount and destination amount | financial | PostgreSQL bigint columns in the managed database with disk encryption | TLS 1.3 |
| implied rate | financial | PostgreSQL bigint column | TLS 1.3 |
| source and destination account ids | financial | uuid columns with owner-scoped composite keys | TLS 1.3 |
| note | PII | text column of at most 500 characters, owner-scoped | TLS 1.3 |
| session cookie | credentials | not stored by this ticket; handled by the identity module | TLS 1.3, cookie flagged Secure and HttpOnly |

## Risks and mitigations
| ID | Risk | STRIDE | Likelihood | Impact | Mitigation |
|---|---|---|---|---|---|
| R-01 | a client claims another owner by sending a user id | S | L | H | the body has no user id; the owner is taken from the session scope and forced on insert, and the composite keys repeat it in the database |
| R-02 | a client forces the stored rate of an exchange | T | M | H | the union strips any rate on an exchange; the API derives it with `impliedRate` and stores source `implied`; the shape check refuses any other source |
| R-03 | a transfer or exchange uses another user's account as source or destination, or probes whether an id exists | I | M | H | both accounts are looked up with the caller's scope and answer 404 identically; the composite keys refuse a foreign destination in the database; AC-09 is tested for source and destination |
| R-04 | a malformed row (a transfer with a rate, an exchange between equal currencies) corrupts balances | T | M | H | use-case rules plus the database shape check, destination amount equal to amount for transfers, and the same-account check; tests insert malformed rows directly |
| R-05 | bulk creation exhausts the database or hides abuse | D | M | M | the shared limit of 60 per minute per user stored in the database, refunded on failure, 429 with `Retry-After` |
| R-06 | the migration gets a journal `when` lower than another branch's and production skips it | E | M | H | `when` greater than 1790980568164 and than any migration on `main` or an open branch, re-checked at merge, never lowered; tests compare order and never claim a newest migration |
| R-07 | the balance adapter ignores the destination side or flips a sign | T | M | H | two grouped queries (source and destination), tests for transfer and exchange in both directions, totals tests and the performance test re-run |
| R-08 | the rollback script deletes transfers and exchanges and changes balances | R | L | M | the script is documented as destructive for those two types, requires a backup and stopped services, and is run only as a whole; expense and income are untouched |
| R-09 | a rounding difference between the web preview and the API shows the user a rate that differs from the stored one | T | L | L | both use the same shared helper; the saved view shows the value returned by the API |

## Supply chain
No new runtime dependency: the ticket reuses Zod, Drizzle, Express and the existing web stack. The implied rate uses bigint arithmetic from the language, not a library.

## Availability
The only new load is one extra insert shape and one extra grouped balance query per chunk; both stay on indexed columns and the creation limit caps write bursts per user. The rollback and the migration need a short window with the API and the worker stopped, as for 03b.

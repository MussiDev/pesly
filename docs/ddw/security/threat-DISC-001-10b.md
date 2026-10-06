# Threat model DISC-001-10b: Card Expenses and Statement Assignment

| Field | Value |
|-------|-------|
| Ticket | DISC-001-10b |
| Spec | docs/ddw/specs/spec-DISC-001-10b.md |
| Tier | FEATURE |
| Date | 2026-10-06 |

## Components
| Component | Source in the spec |
|---|---|
| `apps/api/src/credit-cards/infrastructure/http/credit-card-routes.ts` | Block 4 |
| `apps/api/src/credit-cards/application/record-card-expense.ts` | Block 2 |
| `apps/api/src/movements/infrastructure/credit-cards/drizzle-card-purchases.ts` | Block 3 |
| `apps/api/src/movements/infrastructure/accounts/drizzle-expense-recorder.ts` | Block 3 |
| `apps/web/src/features/credit-cards/containers/card-expense-container.tsx` | Block 6 |

## Trust boundaries
- Browser → API: `POST /credit-cards/:id/expenses` carries the currency, category id, amount, date, note and rate over the public internet, with the session cookie.
- API → database: the card lookup, the movement insert and the per-day purchase sums cross into PostgreSQL, always filtered by the caller's scope.
- `credit-cards` module → `movements` module: only through the `ExpenseRecorder` port, wired in the composition root `apps/api/src/server.ts`; the card module never imports the movements module.
- Server → browser: statement totals and the expense answer carry the user's financial amounts back to the web app.

## STRIDE analysis
### `apps/api/src/credit-cards/infrastructure/http/credit-card-routes.ts`
- **Spoofing:** every route sits behind `requireSession` and `requireVerifiedEmail`; the owner comes from the session, never from the body.
- **Tampering:** the body is a strict Zod object, so an `accountId` or any extra key is refused with 400; the shared validation middleware parses params, body and response.
- **Repudiation:** an audit line with request id, user id, card id and movement id is written per expense; amounts and notes are never logged.
- **Information Disclosure:** a card that is missing or belongs to another user answers 404, never 403, so card ids cannot be probed; error bodies carry paths, not values.
- **Denial of Service:** the JSON body limit stays 16 kB and the expense passes through the `manual` write limiter of the movements module (R-02).
- **Elevation of Privilege:** the write scope is built by `OwnerOrGroupMemberAccessPolicy` for the session user, so a user cannot record on another user's card or accounts (R-01).

### `apps/api/src/credit-cards/application/record-card-expense.ts`
- **Spoofing:** the use case receives a scope already built from the session; it never accepts a user id as input.
- **Tampering:** the linked account is chosen from the card the scoped repository returned and from the currency, so the client cannot pick an arbitrary account id (R-01).
- **Repudiation:** the recorded movement keeps its creation timestamp and the use case returns its id for the audit line.
- **Information Disclosure:** a foreign card is `ResourceNotFound` before anything is recorded, so no existence signal leaks.
- **Denial of Service:** the creation of missing statement cycles is bounded by the 1,200-cycle guard of 10a and uses `on conflict do nothing`.
- **Elevation of Privilege:** all movements rules (open category of the caller, kind, date not in the future) run in the recorder; the use case adds no bypass.

### `apps/api/src/movements/infrastructure/credit-cards/drizzle-card-purchases.ts`
- **Spoofing:** not applicable beyond the scope: the query takes the scope of the session and the ids of the card just loaded under it.
- **Tampering:** read-only; it issues a single `select` with bound parameters, the time zone is a bound value and never concatenated into SQL (R-03).
- **Repudiation:** read-only, nothing to deny.
- **Information Disclosure:** the owner filter `scopedTo(scope, { owner })` is part of the same statement as the account filter, so another user's expenses on any account never reach the sums (R-01).
- **Denial of Service:** the query returns sums per day and account, not rows, and uses `movements_owner_account_date_idx`; the result size is bounded by days of use times two currencies.
- **Elevation of Privilege:** the module has no write access to `movements` through this adapter.

### `apps/api/src/movements/infrastructure/accounts/drizzle-expense-recorder.ts`
- **Spoofing:** the recorder receives the write scope from the use case and stores the owner from it, never from the input.
- **Tampering:** amounts are `bigint` and pass the movements checks (1 to 10^15 minor units); the frozen rate is stored once and never edited here.
- **Repudiation:** the movement row and the limiter counter are written by the existing movements code, which already logs ids only.
- **Information Disclosure:** it returns only the movement id and its instant to the card module.
- **Denial of Service:** `RecordManualMovement` counts the creation against the per-user `manual` bucket (60 per minute by default), shared with the ordinary movement route (R-02).
- **Elevation of Privilege:** the account lookup of the movements module is scoped, so a linked account of another owner reads as not found.

### `apps/web/src/features/credit-cards/containers/card-expense-container.tsx`
- **Spoofing:** the container only calls the API client with the session cookie; it holds no credential.
- **Tampering:** the request is built and validated client side for usability and again by the server; the card id goes through `resourcePath`, so `.` and `..` never reach a path (R-04).
- **Repudiation:** no client-side log of financial data is written.
- **Information Disclosure:** amounts are shown only to the signed-in user; no amounts are written to the console, the URL or storage (the screen keeps no offline copy).
- **Denial of Service:** the submit button is disabled while the request is pending, so a double click sends one request.
- **Elevation of Privilege:** all authorization is on the server; the screen hides nothing that the API would allow.

## Data classification
| Data | Class | At rest | In transit |
|---|---|---|---|
| expense amount, currency, date | financial | bigint column in PostgreSQL under the managed disk encryption; not logged | TLS 1.3 |
| note | PII | text column in PostgreSQL, same disk encryption; not logged | TLS 1.3 |
| statement totals | financial | never stored; computed on read from the movements | TLS 1.3 |
| card id, account ids, category id | public | uuid columns | TLS 1.3 |
| session cookie | credentials | not touched by this ticket; hashed server side by identity | TLS 1.3, cookie flagged Secure and HttpOnly |

## Risks and mitigations
| ID | Risk | STRIDE | Likelihood | Impact | Mitigation |
|---|---|---|---|---|---|
| R-01 | a user records an expense on, or reads purchase sums of, a card or account of another user | E | M | H | scope filter in the same statement as every read and write, 404 for foreign cards, strict body without `accountId`, account chosen server side from the loaded card; cross-user tests in Blocks 2 to 4 |
| R-02 | flooding the expense route to fill the movements table or the database | D | M | M | the `manual` write limiter of the movements module applies to the new route, plus the 16 kB body limit; a 429 test in Block 4 |
| R-03 | SQL injection through the time zone used to compute local days | T | L | H | the time zone is a bound parameter, it comes from the stored profile (validated IANA name) with a Buenos Aires fallback, never from the request |
| R-04 | a crafted card id reaches another API path from the web client | T | L | M | the client builds the path with `resourcePath`, which refuses `.` and `..`; the id is a UUID in the API schema; test in Block 5 |
| R-05 | a purchase is counted in the wrong statement after a time zone change | T | L | L | the day is derived on every read from the stored zone, so totals follow the change on the next read; documented in D4 and covered by a time zone test in Block 3 |

## Supply chain
No new dependency: the ticket uses Zod, Drizzle, Express and React that the project already ships, so there is no new package to scan beyond the standing `pnpm audit --prod --audit-level high` and the SAST step.

## Availability
The new read adds one grouped query over the user's expenses on two accounts, served by the existing composite index, and the new write goes through the existing per-user limiter. A volumetric attack is handled by the platform edge and the limiter (R-02); no new background job or scheduler exists in this ticket.

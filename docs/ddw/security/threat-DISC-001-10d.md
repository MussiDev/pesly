# Threat model DISC-001-10d: Statement Payments and Status

| Field | Value |
|-------|-------|
| Ticket | DISC-001-10d |
| Spec | docs/ddw/specs/spec-DISC-001-10d.md |
| Tier | FEATURE |
| Date | 2026-10-08 |

## Components
| Component | Source in the spec |
|---|---|
| `apps/api/src/credit-cards/infrastructure/http/credit-card-routes.ts` | Block 3 |
| `apps/api/src/credit-cards/application/record-statement-payment.ts` | Block 2 |
| `apps/api/src/movements/infrastructure/credit-cards/drizzle-card-payments.ts` | Block 3 |
| `apps/api/src/movements/infrastructure/credit-cards/drizzle-statement-payment-recorder.ts` | Block 3 |
| `apps/web/src/features/credit-cards/containers/statement-payment-container.tsx` | Block 5 |

## Trust boundaries
- Browser → API: `POST /credit-cards/:id/payments` carries the currency, source account id, amount, date and note over the public internet, with the session cookie.
- API → database: the transfer insert and the grouped sum of received transfers cross into PostgreSQL, always filtered by the caller's scope.
- `credit-cards` module → `movements` module: only through the `CardPayments` and `StatementPaymentRecorder` ports, wired in the composition root `apps/api/src/server.ts`; the card module never imports the movements module.
- Server → browser: the paid amount and status of each statement carry the user's financial amounts back to the web app.

## STRIDE analysis
### `apps/api/src/credit-cards/infrastructure/http/credit-card-routes.ts`
- **Spoofing:** the route sits behind `requireSession` and `requireVerifiedEmail`; the owner comes from the session, never from the body.
- **Tampering:** the body is a strict Zod object (amount up to 10^15, UUID ids, currency enum), so extra keys and malformed values are refused with 400.
- **Repudiation:** an audit line with request id, user id, card id and movement id is written per payment; amounts and notes are never logged.
- **Information Disclosure:** a card or source account that is missing or another user's answers 404, never 403, so ids cannot be probed (R-01); error bodies carry paths, not values.
- **Denial of Service:** the JSON body limit stays 16 kB and creation passes through the `manual` write limiter (R-02).
- **Elevation of Privilege:** the write scope is built for the session user, so a user cannot pay from another user's account or into another user's card (R-01).

### `apps/api/src/credit-cards/application/record-statement-payment.ts`
- **Spoofing:** the use case receives a scope built from the session and never accepts a user id as input.
- **Tampering:** the destination account is chosen by the server from the loaded card and the currency, so the client cannot redirect the money to another account (R-03).
- **Repudiation:** the saved transfer keeps its creation timestamp and the use case returns its id for the audit line.
- **Information Disclosure:** a foreign card is `ResourceNotFound` before anything is recorded, so no existence signal leaks.
- **Denial of Service:** one transfer row per call, behind the limiter.
- **Elevation of Privilege:** all transfer rules of PRD 03 apply through the recorder (same currency, open accounts, caller-owned accounts, no future date); the use case adds no bypass.

### `apps/api/src/movements/infrastructure/credit-cards/drizzle-card-payments.ts`
- **Spoofing:** the query is keyed by the scope's owner, not by request data.
- **Tampering:** bound parameters through Drizzle; read only.
- **Repudiation:** read only, nothing to attribute.
- **Information Disclosure:** the owner filter is in the same statement as the destination filter, so another user's transfers never reach the sums (R-01).
- **Denial of Service:** one grouped query per statement read, served by the destination index and the owner filter (R-04).
- **Elevation of Privilege:** it has no write path.

### `apps/api/src/movements/infrastructure/credit-cards/drizzle-statement-payment-recorder.ts`
- **Spoofing:** the limiter and the transfer are keyed by the owner id from the scope.
- **Tampering:** it reuses `RecordManualMovement` and the composite owner foreign keys of the movements table, so a transfer cannot point at another owner's account even if the use case were bypassed (R-01).
- **Repudiation:** a refused creation is a 429 with `Retry-After`; a failed refund is logged without request data.
- **Information Disclosure:** it returns the new movement id and instant only.
- **Denial of Service:** it is the control for R-02 and shares the 60 per minute `manual` bucket.
- **Elevation of Privilege:** it grants nothing beyond what `POST /movements` already grants the same user.

### `apps/web/src/features/credit-cards/containers/statement-payment-container.tsx`
- **Spoofing:** the container only calls the API client with the session cookie and holds no credential.
- **Tampering:** the request is built and validated client side for usability and again by the server; ids go through `resourcePath`, so `.` and `..` never reach a path (R-05).
- **Repudiation:** no client-side log of financial data is written.
- **Information Disclosure:** amounts are shown only to the signed-in user; none is written to the console, the URL or storage.
- **Denial of Service:** the submit button is disabled while the request is pending, so a double click sends one request.
- **Elevation of Privilege:** all authorization is on the server; the screen hides nothing that the API would allow.

## Data classification
| Data | Class | At rest | In transit |
|---|---|---|---|
| payment amount, date, source and destination account ids | financial | the existing `movements` table under the managed disk encryption; not logged | TLS 1.3 |
| note | PII | text column in PostgreSQL, same disk encryption; not logged | TLS 1.3 |
| paid amount and status of a statement | financial | never stored; computed on read from the transfers and the statement totals | TLS 1.3 |
| card id, statement id | public | uuid columns | TLS 1.3 |
| session cookie | credentials | not touched by this ticket; hashed server side by identity | TLS 1.3, cookie flagged Secure and HttpOnly |

## Risks and mitigations
| ID | Risk | STRIDE | Likelihood | Impact | Mitigation |
|---|---|---|---|---|---|
| R-01 | a user pays from another user's account, or reads another user's received transfers in a statement status | E | M | H | scope filter in the same statement as the sum, transfer rules resolve accounts under the scope (404 for foreign), composite owner foreign keys of `movements`; cross-user tests in Blocks 2 and 3 |
| R-02 | flooding the payment route to fill the movements table | D | M | M | the `manual` write limiter applies, plus the 16 kB body limit; a 429 test in Block 3 |
| R-03 | the client redirects a payment to an account that is not the card's | T | L | H | the destination is derived on the server from the loaded card and the currency; the request has no destination field and unknown keys are refused; test in Blocks 1 and 2 |
| R-04 | a wrong status or a slow statement read because of a float or an unbounded sum | T | L | M | allocation and sums use `bigint` and text-cast SQL sums, one grouped query per read; a test with amounts above 2^53 in Block 3 |
| R-05 | a crafted card id reaches another API path from the web client | T | L | M | the client builds paths with `resourcePath`, which refuses `.` and `..`; ids are UUIDs in the API schema; test in Block 4 |

## Supply chain
No new dependency: the ticket uses Zod, Drizzle, Express and React that the project already ships, so there is no new package to scan beyond the standing `pnpm audit --prod --audit-level high` and the SAST step.

## Availability
The new read adds one grouped query of received transfers per statement read and the write goes through the existing per-user limiter as a single transfer insert. A volumetric attack is handled by the platform edge and the limiter (R-02); no new background job, scheduler or table exists in this ticket.

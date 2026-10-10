# Threat model DISC-001-10c: Installment Purchases, Statement Totals and Pending Debt

| Field | Value |
|-------|-------|
| Ticket | DISC-001-10c |
| Spec | docs/ddw/specs/spec-DISC-001-10c.md |
| Tier | FEATURE |
| Date | 2026-10-07 |

## Components
| Component | Source in the spec |
|---|---|
| `apps/api/src/credit-cards/infrastructure/http/credit-card-routes.ts` | Block 4 |
| `apps/api/src/credit-cards/application/create-installment-purchase.ts` | Block 3 |
| `apps/api/src/credit-cards/infrastructure/db/drizzle-installment-repository.ts` | Block 2 |
| `apps/api/src/movements/infrastructure/credit-cards/drizzle-installment-write-limit.ts` | Block 4 |
| `apps/web/src/features/credit-cards/containers/installment-purchase-container.tsx` | Block 6 |

## Trust boundaries
- Browser → API: `POST`, `PATCH` and `DELETE /credit-cards/:id/installment-purchases` and `GET /credit-cards/installment-expenses` carry the amount, installment count, category id, purchase date, note and month range over the public internet, with the session cookie.
- API → database: the purchase and installment inserts, the deletes and the per-card row reads cross into PostgreSQL, always filtered by the caller's scope.
- `credit-cards` module → `movements` module: only through the `ExpenseCategoryGuard` and `InstallmentWriteLimit` ports, wired in the composition root `apps/api/src/server.ts`; the card module never imports the movements module.
- Server → browser: statement totals, installments, pending debt and monthly expenses carry the user's financial amounts back to the web app.

## STRIDE analysis
### `apps/api/src/credit-cards/infrastructure/http/credit-card-routes.ts`
- **Spoofing:** every route sits behind `requireSession` and `requireVerifiedEmail`; the owner comes from the session, never from the body.
- **Tampering:** bodies and queries are strict Zod objects (currency fixed to `ARS`, installments 2 to 60, amount up to 10^15), so extra keys, USD and out-of-range counts are refused with 400.
- **Repudiation:** an audit line with request id, user id, card id and purchase id is written per create, edit and delete; amounts and notes are never logged.
- **Information Disclosure:** a card or purchase that is missing, cancelled or another user's answers 404, never 403, so ids cannot be probed (R-01); error bodies carry paths, not values.
- **Denial of Service:** the JSON body limit stays 16 kB, creation passes through the `manual` write limiter (R-02) and the month range of the expenses query is capped at 60 months.
- **Elevation of Privilege:** the write scope is built by `OwnerOrGroupMemberAccessPolicy` for the session user, so a user cannot create on, edit or delete another user's card or purchases (R-01).

### `apps/api/src/credit-cards/application/create-installment-purchase.ts`
- **Spoofing:** the use case receives a scope already built from the session and never accepts a user id as input.
- **Tampering:** the installment amounts and periods are computed server side from the total, the count and the purchase date; the client cannot send individual installments, and the sum equals the total exactly (R-04).
- **Repudiation:** the stored purchase keeps its creation timestamp and the use case returns its id for the audit line.
- **Information Disclosure:** a foreign card or category is `ResourceNotFound` before anything is stored, so no existence signal leaks.
- **Denial of Service:** the creation of missing statement cycles is bounded by the 1,200-cycle guard of 10a, and a purchase creates at most 60 rows; the limiter unit is released when the creation fails.
- **Elevation of Privilege:** the category guard runs the movements rules (open expense category of the caller), so the purchase cannot use another user's or an income category; the use case adds no bypass.

### `apps/api/src/credit-cards/infrastructure/db/drizzle-installment-repository.ts`
- **Spoofing:** not applicable beyond the scope: every method takes the scope of the session and the ids of the card just loaded under it.
- **Tampering:** statements use bound parameters through Drizzle; composite foreign keys on `(card_id, owner_id)` and `(category_id, owner_id, category_kind)` prevent a purchase from pointing at another owner's card or category even if the use case were bypassed (R-01); the delete runs in one transaction.
- **Repudiation:** rows carry `created_at` and `updated_at`; a deleted-with-history purchase keeps `cancelled_at`.
- **Information Disclosure:** the owner filter `scopedTo(scope, { owner })` is part of the same statement as the card filter, so another user's rows never reach the sums (R-01).
- **Denial of Service:** reads return at most the rows of one card (60 purchases of up to 60 installments) or the caller's own rows; indexes on owner and card serve them (R-05).
- **Elevation of Privilege:** the repository has no path that writes without a write scope, and `removeInstallments` only deletes the numbers the use case computed as not closed.

### `apps/api/src/movements/infrastructure/credit-cards/drizzle-installment-write-limit.ts`
- **Spoofing:** the limiter is keyed by the owner id from the scope, not by request data.
- **Tampering:** counters live in PostgreSQL (shared by every API instance) and a failed creation refunds only the window it took from.
- **Repudiation:** a refused creation is a 429 with `Retry-After`; a failed refund is logged without request data.
- **Information Disclosure:** it returns only whether the unit was granted and when the window ends.
- **Denial of Service:** it is the control for R-02; it shares the `manual` bucket of 60 per minute with the movement routes.
- **Elevation of Privilege:** it grants nothing but a unit of rate budget and cannot read or write financial data.

### `apps/web/src/features/credit-cards/containers/installment-purchase-container.tsx`
- **Spoofing:** the container only calls the API client with the session cookie and holds no credential.
- **Tampering:** the request is built and validated client side for usability and again by the server; ids go through `resourcePath`, so `.` and `..` never reach a path (R-03).
- **Repudiation:** no client-side log of financial data is written.
- **Information Disclosure:** amounts are shown only to the signed-in user; none is written to the console, the URL or storage.
- **Denial of Service:** the submit and delete buttons are disabled while the request is pending, so a double click sends one request.
- **Elevation of Privilege:** all authorization is on the server; the screen hides nothing that the API would allow.

## Data classification
| Data | Class | At rest | In transit |
|---|---|---|---|
| purchase total, installment amounts, count, purchase date | financial | bigint and date columns in PostgreSQL under the managed disk encryption; not logged | TLS 1.3 |
| note | PII | text column in PostgreSQL, same disk encryption; not logged | TLS 1.3 |
| statement totals, pending debt, monthly expenses | financial | never stored; computed on read from the installments and movements | TLS 1.3 |
| card id, purchase id, category id | public | uuid columns | TLS 1.3 |
| session cookie | credentials | not touched by this ticket; hashed server side by identity | TLS 1.3, cookie flagged Secure and HttpOnly |

## Risks and mitigations
| ID | Risk | STRIDE | Likelihood | Impact | Mitigation |
|---|---|---|---|---|---|
| R-01 | a user reads, edits or deletes installment purchases, or reads installment sums, of another user | E | M | H | scope filter in the same statement as every read and write, 404 for foreign or cancelled purchases, composite owner foreign keys in the migration; cross-user tests in Blocks 2, 3 and 4 |
| R-02 | flooding the creation route to fill the installments table | D | M | M | the `manual` write limiter applies to the creation route, plus the 16 kB body limit and a cap of 60 rows per purchase; a 429 test in Block 4 |
| R-03 | a crafted card or purchase id reaches another API path from the web client | T | L | M | the client builds paths with `resourcePath`, which refuses `.` and `..`; ids are UUIDs in the API schema; test in Block 5 |
| R-04 | installments that do not add up to the total, or a USD or fractional amount, corrupt the debt shown | T | L | H | the split is integer arithmetic in one shared function with the leftover on the first installment, the currency is a literal `ARS`, a check constraint keeps amounts positive bigint, and a 10,000-purchase test proves the exact sum |
| R-05 | a slow statement read for a card with many installments | D | L | M | one query of the card's rows by indexed owner and card, sums in memory, and a perf test at 60 purchases under 300 ms |

## Supply chain
No new dependency: the ticket uses Zod, Drizzle, Express and React that the project already ships, so there is no new package to scan beyond the standing `pnpm audit --prod --audit-level high` and the SAST step.

## Availability
The new reads add one query of installment rows per statement read, served by indexes on owner and card, and the new write goes through the existing per-user limiter and a single transaction of at most 61 rows. A volumetric attack is handled by the platform edge and the limiter (R-02); no new background job or scheduler exists in this ticket.

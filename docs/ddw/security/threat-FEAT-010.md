# Threat model FEAT-010: Count card purchases in the month their statement is due

| Field | Value |
|-------|-------|
| Ticket | FEAT-010 |
| Spec | docs/ddw/specs/spec-FEAT-010.md |
| Tier | FEATURE |
| Date | 2026-10-12 |

## Components
| Component | Source in the spec |
|---|---|
| `apps/api/src/reports/infrastructure/db/drizzle-flow-reader.ts` | Block 1 |
| `apps/api/src/reports/infrastructure/db/flow-conditions.ts` | Block 1 |
| `apps/api/src/reports/application/get-expenses-by-category.ts` | Block 2 |
| `apps/api/src/dashboard/application/build-month-flows.ts` | Block 2 |
| `apps/web/src/components/card-purchases-note.tsx` | Block 3 |

## Trust boundaries
- Browser → Express API: the reports and dashboard requests carry the period, the optional account id
  and the optional tag text, all chosen by the caller.
- Application → PostgreSQL: `cardPurchaseRows` joins `movements`, `accounts`, `credit_cards` and
  `credit_card_statements`, tables that hold several users' rows, and a missing owner condition on any
  join would cross between users.
- Express API → browser: the response carries the caller's own spending totals, which are financial
  data.

## STRIDE analysis
### `apps/api/src/reports/infrastructure/db/drizzle-flow-reader.ts`
- **Spoofing:** the method takes an `AccessScope` issued by the authentication middleware, never a user
  id from the request, and the existing `assertIssuedScope` guard rejects a scope that was not issued.
- **Tampering:** the method only reads; no write, no stored month and no migration, so a request
  cannot change a statement or a movement through it.
- **Repudiation:** a read leaves no state to deny; the existing request log of the API records the
  authenticated request.
- **Information Disclosure:** every table in the query is joined on the owner column as well as the
  id, as `installmentRows` does, and `scopedTo` filters the movements by the caller; a test seeds a
  matching purchase of another user and expects it absent (R-01).
- **Denial of Service:** the read is one grouped query over the caller's card-account expenses only,
  with no query per row, and the existing latency benchmarks stay in the gate (R-03).
- **Elevation of Privilege:** the reader gives no new capability; it returns aggregates of the caller's
  own rows through the same scope as the other readers.

### `apps/api/src/reports/infrastructure/db/flow-conditions.ts`
- **Spoofing:** the conditions take the scope from the caller of the reader, not from the request body.
- **Tampering:** the tag text is compared with `lower()` and always a bound parameter, as today, and
  the new exclusion of card-account expenses is a fixed condition with no input (R-02).
- **Repudiation:** a pure query condition, nothing to log.
- **Information Disclosure:** the exclusion only removes rows from the date-based sum; a wrong
  condition would drop a purchase or count it twice, not reveal another user's row, and a test adds the
  two sums and expects exactly one count (R-04).
- **Denial of Service:** the exclusion is one `not exists` against the card table by account id, which
  has unique indexes on both account columns.
- **Elevation of Privilege:** no privilege check lives here; the owner condition is kept in the shared
  part used by both queries so it cannot be dropped from one of them.

### `apps/api/src/reports/application/get-expenses-by-category.ts`
- **Spoofing:** the use case receives the scope from the route and passes it on unchanged.
- **Tampering:** it merges two read-only lists and places each row in a month by the existing
  `installmentMonthOf`, with no write.
- **Repudiation:** no state changes, so nothing to deny.
- **Information Disclosure:** the response is the caller's own totals; a row of another user cannot
  appear because the reader never returns it.
- **Denial of Service:** one more read per request, run in parallel with the others, with no loop over
  rows beyond the existing placement.
- **Elevation of Privilege:** no new route and no change to the authorization of the report endpoints.

### `apps/api/src/dashboard/application/build-month-flows.ts`
- **Spoofing:** the scope comes from the dashboard route and is passed on unchanged.
- **Tampering:** it only reads and folds rows; a corrupt row without a category makes it throw instead
  of returning a partial figure (R-04).
- **Repudiation:** nothing is written by the dashboard read.
- **Information Disclosure:** the dashboard shows the caller's own month figures, the same data class as
  today, and the new rows add no field to the response.
- **Denial of Service:** the added read joins the existing `Promise.all`, so the dashboard's latency is
  the slowest read and not the sum, and `pnpm test:perf` keeps its thresholds (R-03).
- **Elevation of Privilege:** no route or permission changes.

### `apps/web/src/components/card-purchases-note.tsx`
- **Spoofing:** the component renders a fixed catalog string and takes no identity.
- **Tampering:** the string comes from the bundled i18n catalogs, not from the API or the URL, so
  nothing the caller or another user controls reaches the markup.
- **Repudiation:** a static note, nothing to log.
- **Information Disclosure:** it carries no amount, account or card name.
- **Denial of Service:** it renders one paragraph and adds no request.
- **Elevation of Privilege:** it renders no action and grants none.

## Data classification
| Data | Class | At rest | In transit |
|---|---|---|---|
| card purchase amounts and categories read by the reports | financial | stored by the API in PostgreSQL; the browser keeps the report only in component state | TLS to the API, session cookie flagged Secure and HttpOnly |
| statement closing and due dates | financial | stored by the API in PostgreSQL; never sent to the browser by this change | TLS inside the API's private network to PostgreSQL |
| the tag text of a report filter | public | not stored by this change; compared as a bound parameter | TLS to the API |
| the note text | public | bundled in the web catalogs | TLS from the web host |

## Risks and mitigations
| ID | Risk | STRIDE | Likelihood | Impact | Mitigation |
|---|---|---|---|---|---|
| R-01 | A join of the new query lacks the owner condition and sums another user's card purchases into the caller's report | I | M | H | every table is joined on its id and its owner column, `scopedTo` filters the movements, and a test seeds a matching purchase of another user and expects it absent from reports and dashboard (AC-16) |
| R-02 | The tag text reaches the SQL as text and allows injection | T | L | H | the tag stays a bound parameter inside the shared condition, the new query is built with the same `sql` template bindings and no string concatenation, and an existing-style test sends a quote-bearing tag and expects an empty, safe result |
| R-03 | The new query makes the reports or the dashboard slow enough to degrade the service | D | M | M | one grouped query over the caller's card-account expenses only, a unique-index lookup for the card, and the latency benchmarks of `pnpm test:perf` kept at their current thresholds (AC-15) |
| R-04 | A purchase is counted twice or not at all, or two screens disagree, so the user acts on wrong spending figures | T | M | M | card-account expenses leave the date-based rows and enter the statement-based rows exactly once, a test adds both sums, a parity test compares dashboard and reports on the same data, and a corrupt row makes the read throw instead of returning a partial figure (AC-08, AC-06) |

## Supply chain
No new dependency: the change uses Drizzle, the shared helpers and the existing report code already in
`apps/api`, and the note uses next-intl already in `apps/web`. AGENTS.md requires a justification for
any new runtime dependency, and there is none to justify.

## Availability
The change adds one bounded read to two endpoints and no background work. A failure of the new read
fails the request with the existing error handling, as a failure of any other flow read does, and the
other screens of the app are unaffected. No cache or process memory is added, so the API stays stateless.

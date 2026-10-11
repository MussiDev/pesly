# Threat model DISC-001-06c: Budget Spending and Rollover

| Field | Value |
|-------|-------|
| Ticket | DISC-001-06c |
| Spec | docs/ddw/specs/spec-DISC-001-06c.md |
| Tier | FEATURE |
| Date | 2026-10-11 |

## Components
| Component | Source in the spec |
|---|---|
| `apps/api/src/budgets/infrastructure/http/budget-routes.ts` | Block 4 |
| `apps/api/src/budgets/application/compute-spending.ts` | Block 4 |
| `apps/api/src/budgets/infrastructure/db/drizzle-spending-reader.ts` | Block 3 |
| `apps/api/src/budgets/infrastructure/db/drizzle-budget-version-reader.ts` | Block 3 |
| `apps/api/src/budgets/domain/spending.ts` | Block 2 |

## Trust boundaries
- Browser → API (`GET /budgets/spending`, `GET /budgets/:id/spending`): untrusted params, query and
  session cookies cross it; the shared `validate` middleware, `requireSession` and
  `requireVerifiedEmail` guard it.
- API → PostgreSQL: SQL statements cross it; only parameterized Drizzle queries are built, and the
  composite owner keys already in the schema are the backstop for the rows read.
- User → financial data: an authenticated user is not the owner of every movement, budget or group
  expense; the shared `AccessScope` and the owner column or member rows of the caller decide per
  request which rows are read.
- Budgets → movements and groups: the module reads `movements`, `accounts` and the group tables only
  through its own `foreign-relations.ts`; it never reads another user's member rows or shares.
- Budgets → exchange rates: none. The module reads the rate frozen on each movement and never calls
  an external service nor the stored current rates.

## STRIDE analysis
### `apps/api/src/budgets/infrastructure/http/budget-routes.ts`
- **Spoofing:** both routes sit behind `requireSession` and `requireVerifiedEmail`; the caller's id comes
  from the session, never from the query or a param.
- **Tampering:** the routes are read-only (GET, no body, no state change); the query is a strict Zod
  object, so an extra key such as `userId` is rejected and cannot select another user's data.
- **Repudiation:** audit lines carry the request id, the user id and the budget id; they never carry a
  name, an amount or a spending figure.
- **Information Disclosure:** a foreign budget, an unknown id and a budget that did not exist in the
  requested month all give the same 404 body; the responses carry no owner id, no email and no category
  or group name.
- **Denial of Service:** a month is one of a bounded set (a month in the future is rejected before any
  read), the route runs two aggregated statements for all budgets, and a user holds at most 50 budgets
  (06b), so one request has bounded cost.
- **Elevation of Privilege:** no route takes an owner or a role; `/budgets/spending` is registered before
  `/budgets/:id`, so the literal `spending` is never read as an id.

### `apps/api/src/budgets/application/compute-spending.ts`
- **Spoofing:** it takes the user id from the issued `AccessScope` only and passes the same scope to
  every reader.
- **Tampering:** it computes the month from the `Clock` and the stored time zone, not from client input,
  and rejects a month after the current one; the client cannot make it read a month the user never
  lived, nor shift the month boundaries.
- **Repudiation:** it writes nothing and stores nothing, so there is no record to dispute; the figures
  are reproducible from the movements at any time.
- **Information Disclosure:** a budget outside the scope is reported as missing before any spending is
  read, and the use case never mixes the rows of two users in one aggregation.
- **Denial of Service:** the previous month is read only when a budget has rollover on, and no query
  runs inside a loop over budgets.
- **Elevation of Privilege:** it cannot compute a budget it was not handed by the scoped version reader.

### `apps/api/src/budgets/infrastructure/db/drizzle-spending-reader.ts`
- **Spoofing:** not applicable below the guard: the reader receives an issued `AccessScope` and filters
  movements by its user id and group shares by the caller's own member rows.
- **Tampering:** the reader only runs `select` statements; ids and dates are bound parameters, never
  concatenated, so a category id or a window cannot inject SQL.
- **Repudiation:** nothing is written; the payer-movement exclusion reads `group_expenses` but changes
  none.
- **Information Disclosure:** the share query starts from the caller's member rows, so the shares of
  other members are never selected; other members' amounts and payer rates are not in the result, and
  the rate joined is that of the caller's own payer movement.
- **Denial of Service:** the personal query is served by `movements_owner_category_date_idx` and the
  exclusion by the new `group_expenses_payer_movement_idx`; a plan test with 100,000 movements guards
  against a sequential scan, and a benchmark holds p95 under 500 ms.
- **Elevation of Privilege:** every joined table is reached through the owner column or the caller's
  member rows; a category id of another user in the union returns no row because of the owner filter.

### `apps/api/src/budgets/infrastructure/db/drizzle-budget-version-reader.ts`
- **Spoofing:** it takes an issued `AccessScope` and puts it in the WHERE clause of every read through
  `scopedTo`.
- **Tampering:** read-only; month values are bound parameters.
- **Repudiation:** it reads the stored versions that 06b keeps as the record of earlier values.
- **Information Disclosure:** categories and children are read inside the same owner scope; a budget of
  another user yields nothing, as a missing id does.
- **Denial of Service:** versions and categories are loaded for all budgets in a fixed number of
  statements, bounded by 50 budgets and 50 categories per version.
- **Elevation of Privilege:** it cannot return a version of a budget outside the scope, so a guessed
  budget id gives no data.

### `apps/api/src/budgets/domain/spending.ts`
- **Spoofing:** not applicable: pure functions with no identity and no I/O.
- **Tampering:** all money is `bigint` and rates are integers scaled by 10,000, so no float rounding or
  overflow can change a total; a rate of 0 or less throws instead of producing a value.
- **Repudiation:** the functions are deterministic, so the same movements always give the same result,
  and unit tests pin the rounding.
- **Information Disclosure:** it returns only figures and counts; names are compared inside the function
  and never returned.
- **Denial of Service:** the work is linear in the number of aggregated rows, which the queries bound;
  no recursion over months, because rollover looks back only one month.
- **Elevation of Privilege:** not applicable: no privileged operation and no access to other modules.

## Data classification
| Data | Class | At rest | In transit |
|---|---|---|---|
| Spending, remaining and available amounts per budget | financial | computed per request and never stored; the source rows are in PostgreSQL with managed encryption at rest | HTTPS to the browser; TLS between the API and the database |
| Budget name, thresholds and currency in the response | PII | stored in PostgreSQL by 06b; managed database encryption at rest | HTTPS to the browser |
| Group category names and the caller's shares used for matching | financial | stored in PostgreSQL by PRD 05; read, never returned | TLS between the API and the database only |
| Frozen rates of the caller's movements | financial | stored in PostgreSQL; read, never returned | TLS between the API and the database only |

## Risks and mitigations
| ID | Risk | STRIDE | Likelihood | Impact | Mitigation |
|---|---|---|---|---|---|
| R-01 | A user reads the spending of another user's budget by guessing an id | I | Medium | High | The version reader uses `scopedTo` with the issued scope; a foreign budget gets the same 404 as a missing one (Blocks 3 to 5 tests) |
| R-02 | The aggregation includes another user's movements or group shares | I | Low | High | The movement query filters by the caller's owner id and the share query starts from the caller's member rows; tests seed a second user and assert none of its rows appear (Block 3) |
| R-03 | A live exchange rate or an external call changes a past month's total | T | Medium | Medium | Conversion uses only the rate frozen on the movement; the reader never touches `exchange_rates` and no adapter of dolarapi.com is on the path; a test changes the stored rates and compares (Blocks 3 and 5) |
| R-04 | A float or an overflow corrupts a money total | T | Low | High | `bigint` and integer-scaled rates in the domain, exact integer strings in the response, a source scan test and a float-column check in the migration test (Blocks 2 and 5) |
| R-05 | A group expense is counted twice (movement and share) and misleads the user | T | Medium | Medium | The payer movement is excluded and the share counted; a test pins AC-26 (Blocks 3 and 5); pending the owner's acceptance |
| R-06 | A heavy month with 100,000 movements slows the API for everyone | D | Medium | Medium | Two aggregated queries for all budgets, existing owner and category index plus the new partial index, a plan test and a p95 benchmark under 500 ms (Blocks 3 and 5) |
| R-07 | Budget names, amounts or spending leak through logs | I | Low | Medium | Audit lines carry ids only; a test asserts that no log line contains a name or an amount (Block 5) |
| R-08 | A client probes ids or months to learn when a budget was created | I | Low | Low | A month before the first version answers the same 404 as an unknown id; the list simply omits the budget (spec D3) |
| R-09 | The month is shifted by the server zone and shows another month's spending | T | Medium | Medium | The month and its bounds come from the stored user time zone and the `Clock` port, never the server zone; tests cover 01:00 UTC on the first day and 23:30 local on the last (Blocks 2 and 4) |

## Supply chain
No new runtime dependency: the feature reuses Drizzle, Zod and Express already in the project and the
shared money, rate-conversion and time helpers (spec D13). The only schema change is one index.

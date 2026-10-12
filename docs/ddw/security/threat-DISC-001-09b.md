# Threat model DISC-001-09b: Dashboard API

| Field | Value |
|-------|-------|
| Ticket | DISC-001-09b |
| Spec | docs/ddw/specs/spec-DISC-001-09b.md |
| Tier | FEATURE |
| Date | 2026-10-12 |

## Components
| Component | Source in the spec |
|---|---|
| `apps/api/src/dashboard/infrastructure/http/dashboard-routes.ts` | Block 2 |
| `apps/api/src/dashboard/application/dashboard-context.ts` | Block 2 |
| `apps/api/src/dashboard/infrastructure/db/drizzle-first-steps-reader.ts` | Block 2 |
| `apps/api/src/dashboard/infrastructure/db/drizzle-group-balance-reader.ts` | Block 3 |
| `apps/api/src/dashboard/infrastructure/investments/portfolio-valuation.ts` | Block 4 |
| `apps/api/src/dashboard/application/build-budgets.ts` | Block 6 |
| `apps/api/src/dashboard/application/build-agenda.ts` | Block 7 |
| `apps/api/src/dashboard/infrastructure/db/drizzle-account-currency-reader.ts` | Block 7 |
| `apps/api/src/dashboard/infrastructure/credit-cards/drizzle-card-statement-source.ts` | Block 7 |
| `apps/api/src/dashboard/application/get-dashboard.ts` | Block 8 |
| `apps/api/src/dashboard/infrastructure/http/present-dashboard.ts` | Block 8 |

## Trust boundaries
- Browser → API (`GET /dashboard`): the session cookie and the query string cross it; `requireSession`,
  `requireVerifiedEmail` and the strict empty query schema of Block 0 guard it. The route takes no body and no id.
- Route → use case (`GetDashboard`): the issued read `AccessScope` is the only identity that crosses; no user id,
  group id or account id comes from the request.
- Application → other modules (reports, budgets, recurring, credit-cards, investments, groups, movements): the
  dashboard calls their use cases and readers only through their barrels with the same scope; each of those
  modules applies its own owner or membership condition.
- Application → PostgreSQL: parameterized Drizzle statements cross it; every dashboard-owned read puts the scope's
  user id, or the caller's own member rows, in its WHERE.
- Group member → other members of the same group: the group read starts from the caller's member rows, so another
  member's balance, shares or expense text is never selected.
- GET → write: `ListUpcoming` runs an idempotent insert of the caller's pending occurrences on a read request
  (owner decision 2); the insert is bound to the scope's user id.
- API → browser: the response carries the caller's own money as integer strings; it must carry no stack, SQL,
  provider text or another user's figure.

## STRIDE analysis
### `apps/api/src/dashboard/infrastructure/http/dashboard-routes.ts`
- **Spoofing:** `GET /dashboard` sits behind `requireSession` and `requireVerifiedEmail`, and the scope is issued by
  the access policy from the session; a request with no session answers 401 before any use case runs (AC-44).
- **Tampering:** the handler is a read-only `GET` with no body; the strict empty query schema refuses every
  parameter with 400 (AC-02), and the response is validated against its schema before sending, so a use case bug
  cannot add fields or a number amount.
- **Repudiation:** each request logs the request id and the user id through the shared logger, never an amount, a
  name or a category, so a disputed read is traceable without copying data.
- **Information Disclosure:** the error middleware answers a code only; a failed source gives the standard 5xx with
  no stack or SQL and no partial section (FR-16, AC-49), and an unverified user gets the 403 of the reports.
- **Denial of Service:** the route has no parameter that grows the work; every list is capped (3, 20, 20), the
  session and verified email are required, and the benchmark holds p95 under 1 s and 40 statements (R-04).
- **Elevation of Privilege:** the route cannot be given another user's scope, because it has no id and the scope
  comes from the session policy; there is no admin or alternate path.

### `apps/api/src/dashboard/application/dashboard-context.ts`
- **Spoofing:** it reads the preferences with the user id of the issued scope only.
- **Tampering:** today and the month are computed from the server clock and the caller's stored zone, never from a
  client value, so a client cannot move the month or the periods.
- **Repudiation:** the same stored preferences and clock give the same context, so a figure can be reproduced from
  the stored zone and display currency.
- **Information Disclosure:** the context holds only the caller's own display currency, rate type and zone, and it
  is never serialized into the response beyond the display currency and today.
- **Denial of Service:** one primary-key read of `users` and pure date arithmetic; `ContextTimeZones` saves three
  further reads.
- **Elevation of Privilege:** `ContextTimeZones` answers only for the context's own user id and throws for any
  other id, so a reused budgets or recurring use case cannot be pointed at another user's zone.

### `apps/api/src/dashboard/infrastructure/db/drizzle-first-steps-reader.ts`
- **Spoofing:** both `exists` probes carry the scope's user id in the WHERE; the id comes from the issued scope.
- **Tampering:** read-only; the user id is a bound parameter and nothing is concatenated into the SQL.
- **Repudiation:** a deterministic read of stored rows; a wrong `show` flag is reproducible from the two probes.
- **Information Disclosure:** it returns two booleans, never an account name, a movement or an id.
- **Denial of Service:** two indexed `exists` probes that stop at the first row, served by the owner indexes.
- **Elevation of Privilege:** it cannot confirm another owner's account or movement, because the owner condition is
  in the same statement.

### `apps/api/src/dashboard/infrastructure/db/drizzle-group-balance-reader.ts`
- **Spoofing:** the statement starts from the `group_members` rows whose `user_id` is the scope's user and derives
  expenses, shares and settlement legs only from those member ids (AC-45).
- **Tampering:** read-only with bound parameters; sums are read as text and parsed with `BigInt`, so no float
  rounding can change a balance.
- **Repudiation:** the balance uses the `balancesByCurrency` formula of the groups module, so it can be reproduced
  from the group's own expenses and settlements and is compared with `GetBalances` in a test.
- **Information Disclosure:** it returns one source set per group and currency for the caller's member only, never
  the other members' balances, ids, names or expense descriptions; the response keeps only the two per-currency
  totals.
- **Denial of Service:** one statement over the caller's memberships, bounded by the 10 groups of the benchmark,
  never one query per group (the roughly six of `GetBalances` per group would break the 40-statement ceiling).
- **Elevation of Privilege:** membership is the root of every join, so no row of a group the caller never belonged
  to can be read, and a former member row resolves to the caller only.

### `apps/api/src/dashboard/infrastructure/investments/portfolio-valuation.ts`
- **Spoofing:** it calls `ListPortfolios` with the issued scope, which filters portfolios and holdings by owner.
- **Tampering:** read-only; it sums `totals` already computed in `bigint` by the investments module from the
  stored holding prices and stored market prices.
- **Repudiation:** the value is the sum of stored prices at request time, and the count of holdings without a
  price is returned, so a lower total can be explained by `holdingsWithoutPrice`.
- **Information Disclosure:** it returns two per-currency totals and a count, never a ticker, a holding or a
  portfolio name.
- **Denial of Service:** three statements regardless of the 500 holdings; the stored market prices are read with
  one lookup and the valuation runs in memory.
- **Elevation of Privilege:** it holds no write path and no provider client, so it cannot trigger a price fetch or
  read another owner's portfolio.

### `apps/api/src/dashboard/application/build-budgets.ts`
- **Spoofing:** `computeSpending` takes the issued scope and every budget read filters by owner.
- **Tampering:** read-only; percentages come from the 06c integer functions, and the section only sorts, slices
  and labels the status with integer comparisons.
- **Repudiation:** the percentage equals the one of the budgets screen for the same data (AC-48), so a disputed
  status can be reproduced.
- **Information Disclosure:** it returns at most 3 budgets of the caller with their own currency; no category list,
  threshold or rollover internals leave the module.
- **Denial of Service:** eight statements for 50 budgets because the 06c reads are per month, never per budget,
  and the result is cut to 3.
- **Elevation of Privilege:** the zone comes from `ContextTimeZones` for the caller's own id, so the month of the
  budgets cannot be chosen by the client.

### `apps/api/src/dashboard/application/build-agenda.ts`
- **Spoofing:** `ListUpcoming`, the card readers and the account currency reader all take the issued scope.
- **Tampering:** the GET materializes pending occurrences through an idempotent insert-or-ignore on the unique
  `(payment, due date)` key bound to the scope's user id; resolved rows are never recreated, so repeated polling
  cannot duplicate or reopen anything. Statements are only read, never created.
- **Repudiation:** the materialized rows are the rows the recurring upcoming list already writes, with the same
  owner and due date, so the audit trail of that module is unchanged.
- **Information Disclosure:** it returns names, dates, currencies and amounts of the caller's own payments and
  cards, with ids only for the resolving action; an entry with an unknown account is an error, not a guessed
  currency.
- **Denial of Service:** the write is bounded by the module's 200-payment cap and 366-day lookback and is a single
  insert; the card cost is three statements per card, and the benchmark counts them.
- **Elevation of Privilege:** the request-scoped `ContextTimeZones` and the scope keep the materialization on the
  caller's payments; no occurrence can be confirmed or skipped from this route.

### `apps/api/src/dashboard/infrastructure/db/drizzle-account-currency-reader.ts`
- **Spoofing:** the statement filters accounts by the scope's owner column.
- **Tampering:** read-only; the account ids are one bound array parameter, never spliced into the SQL.
- **Repudiation:** a deterministic lookup of stored currencies; a wrong currency on an entry is reproducible from
  the account row.
- **Information Disclosure:** it returns a map from id to currency for ids of the caller's own payments, never an
  account name or balance.
- **Denial of Service:** one statement for at most 20 capped entries' accounts and the 200-payment bound.
- **Elevation of Privilege:** an id of another owner is simply absent from the answer, which the builder treats as
  an error, so it can neither read nor probe a foreign account.

### `apps/api/src/dashboard/infrastructure/credit-cards/drizzle-card-statement-source.ts`
- **Spoofing:** the card, installment, statement, purchase and payment reads all take the issued scope and filter
  by owner.
- **Tampering:** read-only; it serves the installment rows to `buildStatementViews` from memory and creates no
  statement, so the allocation of payments is the credit-cards module's own.
- **Repudiation:** the owed amounts come from the same allocation as the statements screen, so a disputed amount
  can be reproduced from the card's statements and payments.
- **Information Disclosure:** it returns card name, statement id, due date and owed amounts for the caller's cards
  only; no purchase detail or installment line leaves the adapter.
- **Denial of Service:** three statements per card plus one cards read and one installment read; a user with many
  cards would exceed the 40-statement ceiling, which the benchmark user of 2 cards is measured against (R-05).
- **Elevation of Privilege:** it has no write method and no scope upgrade; the memoized installment rows belong to
  the request and the caller and are never shared between requests.

### `apps/api/src/dashboard/application/get-dashboard.ts`
- **Spoofing:** it receives the issued scope and passes the same scope to every section; it creates none.
- **Tampering:** sections are computed from stored data in `bigint`; one presenter writes the strings and the shared
  schema validates the result, so a section cannot return a float.
- **Repudiation:** every section is a pure function of stored rows and the context, so the same data gives the same
  response; the request is logged by the route with ids only.
- **Information Disclosure:** `Promise.all` rejects on the first failure and no `catch` returns a partial result,
  so a failed source never yields a section filled with a guessed or stale value (FR-16).
- **Denial of Service:** the sections run in parallel and each reads once per source; the sum is 36 statements for
  the benchmark user against a ceiling of 40, and the response is capped at 32 KB by the list caps (R-04, R-08).
- **Elevation of Privilege:** it cannot widen the scope: it takes the scope as a parameter and the modules it calls
  refuse a scope that was not issued by the policy.

### `apps/api/src/dashboard/infrastructure/http/present-dashboard.ts`
- **Spoofing:** not applicable: a presenter performs no I/O and holds no identity.
- **Tampering:** it converts `bigint` to integer strings only, and percentages through `Number.parseInt` of a bounded
  value, with a scan test banning float functions in the module (R-06).
- **Repudiation:** it adds no data, so what the response says can be traced to the section results one to one.
- **Information Disclosure:** it copies only the schema's fields; an extra property of a section result is not
  forwarded and the response schema would reject it.
- **Denial of Service:** linear in the capped lists and a fixed number of fields; no I/O and no allocation that
  grows with the user's data.
- **Elevation of Privilege:** not applicable beyond the shared function: it has no privilege and no access to the
  database or the scope.

## Data classification
| Data | Class | At rest | In transit |
|---|---|---|---|
| Net worth parts and total, month income, expenses and net, category and insight amounts | financial | computed per request and never stored by this ticket; the source rows are in PostgreSQL with managed encryption at rest | HTTPS to the browser and TLS between the API and the database |
| Budget names, available, spent and percentages; upcoming and action names, dates and amounts | financial | computed per request and never stored; the source rows are in PostgreSQL with managed encryption at rest | HTTPS to the browser and TLS between the API and the database |
| Group owed and owing totals per currency | financial | computed per request and never stored; derived from group rows in PostgreSQL with managed encryption at rest | HTTPS to the browser and TLS between the API and the database |
| Category names, card names and payment names shown in the response | PII | stored by earlier tickets in PostgreSQL with managed encryption at rest; not stored by this ticket | HTTPS to the browser and TLS between the API and the database |
| Display currency, time zone and the first steps flags | PII | stored by earlier tickets in PostgreSQL with managed encryption at rest; not stored by this ticket | HTTPS to the browser and TLS between the API and the database |
| Stored exchange rate of the default rate type | public | stored in PostgreSQL with managed encryption at rest; market data with no user link | TLS between the API and the database only |

## Risks and mitigations
| ID | Risk | STRIDE | Likelihood | Impact | Mitigation |
|---|---|---|---|---|---|
| R-01 | The dashboard returns another user's accounts, shares, balances, budgets, cards or payments through a missing owner condition | I | Low | High | Every read takes the issued `AccessScope` and filters by owner or by the caller's member rows; a two-user flow test asserts each section holds only the caller's figures, and the readers are tested with a second user's rows present (Blocks 2, 3, 7 and 8) |
| R-02 | A group member's balance or the payer movement of a group expense leaks another member's amount or counts the full amount paid | I | Low | High | The group read starts from the caller's member rows and returns only the caller's sources; the flow rules of 09a count only the caller's share; tests assert the caller's own figure and no other member's amount (Blocks 3, 5 and 8) |
| R-03 | A GET request with a write (materialization of pending occurrences) is abused to create rows for another user or in a flood | T | Low | Medium | `ListUpcoming` inserts only the scope's own payments' due dates with insert-or-ignore on the unique key, bounded by the 200-payment cap and the 366-day lookback; a test repeats the request and asserts one row per due date (Block 7) |
| R-04 | Repeated dashboard requests exhaust the database because one request runs many statements over 100,000 movements | D | Medium | Medium | Session and verified email are required, the route has no parameter, each source is one aggregated read, lists are capped, a benchmark holds p95 under 1 s and 40 statements, and the platform's edge limits apply (Block 8) |
| R-05 | A user with many cards multiplies the card statement reads beyond the statement ceiling and slows the home screen | D | Medium | Low | The installment rows are read once for all cards and the cost is 3 statements per card, documented in D13; the benchmark measures 2 cards and a future batch reader is the lever if real users need more (Blocks 7 and 8) |
| R-06 | A float or rounding drift changes an amount or a percentage | T | Low | Medium | `bigint` sums read as text, integer percent functions with truncation and a clamp, integer strings in the response, and a scan test that bans float functions in the module, its schema and its tests (Blocks 0, 5 and 8) |
| R-07 | A dashboard request calls dolarapi.com, CoinGecko or another external service, or uses a rate that is not stored | D | Low | Medium | The module reads stored rates and prices only and imports no provider or job; a test spies on `fetch` and sockets and a scan checks the imports; a missing rate gives `no_rate` and a null total (Blocks 4 and 8) |
| R-08 | An error response or a log line leaks SQL, a stack, an amount or a name | I | Low | Medium | The error middleware returns only the standard code; the route logs the request id and user id only; the flow test inspects the 5xx body for stack and SQL (Blocks 2 and 8) |
| R-09 | A failed source leaves a section with a guessed, stale or partial value that the user trusts | R | Low | Medium | `Promise.all` with no `catch`, so the whole request fails with the standard error and returns no section; a test makes one source throw and asserts no body (Blocks 2 and 8) |
| R-10 | The dashboard disagrees with the reports or the budgets screens, so the user cannot tell which number is right | R | Medium | Low | The module calls the 09a readers and rules, `computeSpending` and the groups formula instead of copying them, and parity tests compare each figure with its own endpoint, with the stated installment difference recorded as an open owner question (Blocks 4, 5, 6 and 8) |
| R-11 | A query parameter or an id from the client changes the periods, the zone or the scope of a read | E | Low | High | The query is a strict empty object that answers 400 for any key; the scope, zone and today come from the session, the stored zone and the server clock only (Blocks 0, 2 and 8) |

## Supply chain
No new runtime dependency: the feature reuses Drizzle, Express and Zod and the existing module code, and a test
pins the dependency lists of `apps/api` and `packages/shared` and asserts that `apps/api/drizzle` is unchanged
(spec D14, Block 8). The only cross-module change is new `export` lines in the barrels of five existing modules
(Block 1), checked by a circular import test and a snapshot of the previous exports.

## Availability
The route has no parameter and every list is capped, so the DoS surface is the fixed cost of one request: 36
statements for the benchmark user against a ceiling of 40, a p95 under 1 s and a body under 32 KB, all measured in
Block 8. The idempotent materialization of pending occurrences is bounded by the recurring module's own caps. The
platform's edge limits cover volumetric attacks before they reach this code, and a user with many cards is the one
known way past the statement ceiling (R-05).

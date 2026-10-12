# Threat model DISC-001-09a: Reports API

| Field | Value |
|-------|-------|
| Ticket | DISC-001-09a |
| Spec | docs/ddw/specs/spec-DISC-001-09a.md |
| Tier | FEATURE |
| Date | 2026-10-12 |

## Components
| Component | Source in the spec |
|---|---|
| `apps/api/src/reports/infrastructure/http/report-routes.ts` | Block 2 |
| `apps/api/src/reports/application/prepare-report.ts` | Block 2 |
| `apps/api/src/reports/infrastructure/db/drizzle-report-filter-reader.ts` | Block 2 |
| `apps/api/src/reports/infrastructure/db/drizzle-flow-reader.ts` | Block 3 |
| `apps/api/src/reports/infrastructure/db/drizzle-account-flow-reader.ts` | Block 6 |
| `apps/api/src/reports/infrastructure/db/drizzle-group-flow-reader.ts` | Block 6 |
| `apps/api/src/reports/infrastructure/db/drizzle-investment-reader.ts` | Block 6 |
| `apps/api/src/reports/infrastructure/db/drizzle-net-worth-rate-reader.ts` | Block 7 |
| `apps/api/src/exchange-rates/infrastructure/db/drizzle-rate-repository.ts` | Block 1 |
| `apps/api/src/exchange-rates/infrastructure/db/schema.ts` | Block 1 |

## Trust boundaries
- Browser → API (`GET /reports/expenses-by-category`, `GET /reports/income-expenses`, `GET /reports/net-worth`):
  untrusted query strings and session cookies cross it; `requireSession`, `requireVerifiedEmail` and the shared
  `validate` middleware with the strict schemas of the spec guard it. The routes take no body.
- Route → use cases (`prepareReport`): the issued read `AccessScope` is the only identity that crosses; the
  filter ids and tag name are untrusted values that `prepareReport` checks for ownership before any report read.
- Application → PostgreSQL: parameterized Drizzle statements cross it; every read puts the scope's user id (or
  the caller's own member rows) in its WHERE, and the composite owner keys of the source tables are the backstop.
- User → another user's data: an authenticated user is not the owner of every account, tag, group, portfolio or
  installment; a foreign id or tag name must be indistinguishable from a missing one (404).
- Group member → other members of the same group: the reports read the caller's own member row and the
  caller's own shares, never the amounts of another member.
- Rate refresh job → PostgreSQL (`replaceAll`): the only writer of `exchange_rate_history`; it receives quotes
  already validated by `assertCompleteQuotes`. The report request path never crosses to the rates provider.
- API → browser: the response carries the caller's own money as integer strings; it must carry no stack, SQL or
  other user's figure.

## STRIDE analysis
### `apps/api/src/reports/infrastructure/http/report-routes.ts`
- **Spoofing:** the three routes sit behind `requireSession` and `requireVerifiedEmail`, and the scope is issued
  by the access policy from the session, never from a user id in the query; a request with no session answers
  401 before any use case runs.
- **Tampering:** the routes are read-only `GET` handlers with no body, so no state can be changed through them;
  the strict query schema refuses unknown keys, and the response is validated against its schema before
  sending, so a use case bug cannot add fields.
- **Repudiation:** each request logs the request id, the user id and the report name through the shared logger,
  and no amount, tag, account name or filter value, so a disputed read can be traced without copying data.
- **Information Disclosure:** the error middleware maps typed errors to a code, `fields` and `details.maxMonths`
  only; stack traces and driver messages go to the log; a foreign filter and a missing one both answer the same
  404 body.
- **Denial of Service:** the range is capped at 24 or 12 months and `from` and `to` are validated before any
  read, so a request cannot ask for an unbounded scan; each report is a fixed number of aggregated statements
  and a benchmark holds each under 2 s at p95 for 100,000 movements.
- **Elevation of Privilege:** the route cannot be given a scope for another user, because the scope comes from
  the session policy; the net worth query refuses `accountId` and `tag`, so no filter path exists there.

### `apps/api/src/reports/application/prepare-report.ts`
- **Spoofing:** it reads the preferences and checks the filters with the user id of the issued scope only.
- **Tampering:** the range is resolved from validated local dates, today in the user's stored zone and the
  limits of the report, and `to` after today is refused, so a client cannot widen a window past the limit or into
  the future by crafting dates.
- **Repudiation:** a refusal is a typed error that the middleware logs with its code and route, so a rejected
  range can be traced.
- **Information Disclosure:** the ownership check answers 404 for a foreign and for an unknown account or tag with
  the same body and the same time-independent logic path, so a request cannot probe which ids exist for others.
- **Denial of Service:** the check is two indexed reads and the range resolution is pure arithmetic; it runs
  before any aggregate, so an invalid request costs almost nothing.
- **Elevation of Privilege:** it hands the use case a context built from the caller's own preferences, so a
  client cannot select another user's display currency, rate type or zone.

### `apps/api/src/reports/infrastructure/db/drizzle-report-filter-reader.ts`
- **Spoofing:** every statement carries the scope's user id in the WHERE through `scopedTo` or the owner column;
  the id comes from the issued scope.
- **Tampering:** the reader only selects; the account id and the tag name are bound parameters, never part of
  the SQL text.
- **Repudiation:** a refused filter surfaces as `ResourceNotFound`, logged by the middleware with the route and
  user id.
- **Information Disclosure:** it returns a boolean per filter, so it never returns another user's account name,
  tag or id; the tag is compared with `lower()` on the caller's own tags only.
- **Denial of Service:** one primary-key lookup for the account and one lookup on the unique
  `(owner_id, lower(name))` index of the tags, so the cost is constant.
- **Elevation of Privilege:** it cannot confirm an account or tag of another owner, because the owner condition
  is in the same statement.

### `apps/api/src/reports/infrastructure/db/drizzle-flow-reader.ts`
- **Spoofing:** personal movements are filtered by the scope's owner column; the shares start from the caller's
  `group_members` rows (`user_id` equal to the scope's user); installments carry their own owner column.
- **Tampering:** the reader only selects; the zone, the instants, the account id and the tag name are bound
  parameters, and the ordinal group-by avoids repeating a parameterized expression; sums are parsed with
  `BigInt`, so no float rounding can change an amount.
- **Repudiation:** it is deterministic for a given database state, so the same request yields the same rows,
  and the frozen rate on each movement is the record of how it converts.
- **Information Disclosure:** a share read joins the other members' rows only through the caller's own share
  row, so no amount of another member is selected; the payer movement of a group expense is excluded so the
  full amount paid for others is not reported as the caller's spending.
- **Denial of Service:** four aggregated statements per report, bucketed in the database, never one query per
  month, category or row; the movements read is served by `movements_owner_date_idx`; the installment read is
  limited to the periods within two months of the range.
- **Elevation of Privilege:** with an account or tag filter the share and installment reads are not run, so a
  filter cannot be used to reach rows that carry no account or tag; no statement runs without the owner
  condition.

### `apps/api/src/reports/infrastructure/db/drizzle-account-flow-reader.ts`
- **Spoofing:** the three signed sources join `accounts` on the owner and require `a.owner_id` to equal the
  scope's user, including the settlement source, whose account is read through `accounts` and not through the
  group.
- **Tampering:** a read-only `union all` with bound parameters; the signed effect of each movement type is fixed
  in the statement, and the opening balances are summed in the database as text and parsed with `BigInt`.
- **Repudiation:** the balance is rebuilt from stored movements and settlements, so the same data always gives
  the same point, and no balance is stored that could drift from its source.
- **Information Disclosure:** the output is per currency and month only, with no account name or movement id;
  archived accounts are excluded, so their balances never enter a point.
- **Denial of Service:** one statement aggregates every movement of the owner before the end bound (100,000
  rows aggregated in the database), never one per month, and the benchmark covers this read.
- **Elevation of Privilege:** a settlement of a group the caller belongs to cannot inject cash into an account
  the caller does not own, because the account's owner must be the caller.

### `apps/api/src/reports/infrastructure/db/drizzle-group-flow-reader.ts`
- **Spoofing:** the statement starts from the `group_members` rows whose `user_id` is the scope's user and
  derives expenses, shares and legs only from those member ids.
- **Tampering:** read-only, with bound parameters; amounts are `bigint` summed in the database and read as text.
- **Repudiation:** it uses the formula of `memberBalances` (paid, minus shares, plus legs), so a point can be
  reproduced from the group's own records.
- **Information Disclosure:** it returns one signed number per currency and month for the caller, never the
  per-member balances of the group, the other members' ids or the expense descriptions.
- **Denial of Service:** one statement over the caller's memberships, bounded by the 10 groups a user is
  expected to hold, never one per group or month.
- **Elevation of Privilege:** a former member row still resolves to the caller only, and no row of a group the
  caller never belonged to can be read, because membership is the root of every join.

### `apps/api/src/reports/infrastructure/db/drizzle-investment-reader.ts`
- **Spoofing:** the snapshot and portfolio reads filter by the owner column of both tables, the user id taken
  from the issued scope.
- **Tampering:** read-only; the dates and end instants are bound as arrays, and a missing snapshot yields 0 and
  an explicit `investmentsIncomplete` flag instead of a guessed value.
- **Repudiation:** the value comes from the stored daily snapshot of a named date, so the point is traceable
  to the row it used; no holding or price of a past day is reconstructed.
- **Information Disclosure:** it returns totals per currency and a set of incomplete dates, never a portfolio
  name, a ticker or a holding.
- **Denial of Service:** one lateral statement over at most 24 dates and the owner's portfolios, served by the
  primary key of the snapshots.
- **Elevation of Privilege:** a portfolio of another owner cannot be summed, because the owner column of the
  snapshot and its composite key to the portfolio are both in the statement.

### `apps/api/src/reports/infrastructure/db/drizzle-net-worth-rate-reader.ts`
- **Spoofing:** the rate type is the caller's own stored default; the rates are market data shared by every
  user and carry no identity.
- **Tampering:** read-only; the dates are a bound `date[]`, and a past point reads only rows with a date on or
  before it, so a later rate can never be substituted.
- **Repudiation:** each converted point can be traced to a history row (rate type and date), and a point with
  no row says `no_rate` instead of using a live value.
- **Information Disclosure:** it returns one sell rate per date, which is public market data.
- **Denial of Service:** one lateral statement over at most 24 dates, served by the primary key
  `(rate_type, rate_date)`, plus one primary-key read of the current rate; it never calls the rates provider.
- **Elevation of Privilege:** not applicable beyond the shared rows: the table holds no user data and the
  reader has no write path.

### `apps/api/src/exchange-rates/infrastructure/db/drizzle-rate-repository.ts`
- **Spoofing:** only the refresh job holds this repository, behind `assertCompleteQuotes`; no request handler
  can reach `replaceAll`.
- **Tampering:** both upserts run in one transaction, so `exchange_rates` and `exchange_rate_history` cannot
  disagree after a failure; the history date is computed in the application from the fetch instant in the
  Argentina zone, and the last values of a day win through `ON CONFLICT DO UPDATE`.
- **Repudiation:** each history row carries `recorded_at`, the fetch time that wrote it, so the last write of
  a day is attributable.
- **Information Disclosure:** the rows are public market quotes, with no user data, no provider text and no
  credential.
- **Denial of Service:** at most seven rows are written per refresh, and the table grows by at most seven rows
  a day, so it stays small and cheap to read.
- **Elevation of Privilege:** the repository takes the same database handle as before and adds no new
  privilege; a failing history write rolls back, so a partial write cannot widen what readers see.

### `apps/api/src/exchange-rates/infrastructure/db/schema.ts`
- **Spoofing:** not applicable: a schema file holds no identity and performs no I/O.
- **Tampering:** the primary key `(rate_type, rate_date)` and the checks on the rate type and on the range of
  `buy` and `sell` keep rows consistent even if application code has a bug; migration 0037 is additive and its
  rollback is idempotent.
- **Repudiation:** history rows are keyed by day and carry `recorded_at`; the migration seeds exactly one row
  per stored rate type, dated by its fetch.
- **Information Disclosure:** the table holds only public rates, with no foreign key to any user or movement.
- **Denial of Service:** the migration locks only the new table and its seed reads at most seven rows; the
  primary key index serves the lookups.
- **Elevation of Privilege:** not applicable: no privileged operation and no grant is added.

## Data classification
| Data | Class | At rest | In transit |
|---|---|---|---|
| Report amounts per category and month (derived from movements, shares and installments) | financial | computed per request and never stored by this ticket; the source rows are in PostgreSQL with managed encryption at rest | HTTPS to the browser and TLS between the API and the database |
| Net worth components per month end (accounts, investments, group part, installment debt) | financial | computed per request and never stored; the source rows are in PostgreSQL with managed encryption at rest | HTTPS to the browser and TLS between the API and the database |
| Filter values (account id, tag name) and display preferences | PII | the tag name and ids are stored by earlier tickets in PostgreSQL with managed encryption at rest; not stored by this ticket | HTTPS to the browser and TLS between the API and the database |
| Exchange rate history (rate type, date, buy, sell) | public | stored in PostgreSQL with managed encryption at rest; market data with no user link | TLS between the API and the database only |

## Risks and mitigations
| ID | Risk | STRIDE | Likelihood | Impact | Mitigation |
|---|---|---|---|---|---|
| R-01 | A report returns another user's movements, shares, snapshots or installments through a missing owner condition | I | Low | High | Every read takes the issued `AccessScope` and filters by owner or by the caller's member rows; a two-user flow test asserts each report returns only the caller's figures, and the readers are tested with a second user's rows present (Blocks 3, 6 and 8) |
| R-02 | A foreign or unknown account or tag id is distinguishable from a missing one, or returns data | I | Medium | Medium | `prepareReport` checks ownership first and answers the same 404 body for both cases; the filter reader returns only a boolean (Block 2 and Block 8 flow test) |
| R-03 | A group member's report exposes another member's amount, or counts the full payer movement of a group expense | I | Low | High | The share read starts from the caller's member row and the payer movement is excluded; tests assert 10,000.00 and not 30,000.00 and that no other member's amount appears (Blocks 3 and 8) |
| R-04 | A heavy 24-month report is used to exhaust the database | D | Medium | Medium | The range is capped before any read, each report is a fixed set of aggregated statements, the session and verified email are required, and a benchmark holds each report under 2 s at p95 for 100,000 movements (Blocks 2, 3, 6 and 8) |
| R-05 | A past month is converted with today's rate, or a flow with a stored rate, so the numbers disagree with the budgets | T | Medium | Medium | Flows use the frozen rate of each movement only, a past point uses the history on or before its date and returns `no_rate` when none exists, and a parity test compares the budgets and the report (Blocks 3 and 7) |
| R-06 | A float or rounding drift changes an amount | T | Low | Medium | `bigint` sums read as text, `convertMinorUnits` only, integer strings in the responses, and a source scan bans float functions in the module, its schemas and its tests (Blocks 0 and 8) |
| R-07 | A report request calls the rates provider or another external service | D | Low | Medium | The module imports no provider or job and reads stored rates only; a test spies on `fetch` and sockets and a scan checks the imports (Block 8) |
| R-08 | The migration collides with another branch or cannot be rolled back | T | Medium | Medium | Journal `when` above the maximum on `main`, renumbering at merge, an idempotent rollback tested twice, and the chain tests updated (Block 1) |
| R-09 | The history write fails or half-writes, so a past rate is missing or the current rate and the history disagree | T | Low | Medium | One transaction for both upserts, last write of the day wins, and a forced-error test asserts `exchange_rates` is unchanged (Block 1) |
| R-10 | An error response leaks SQL, a stack or a filter value | I | Low | Medium | The error middleware returns only a code, `fields` and `details.maxMonths`; logs hold ids and the report name, never amounts or tag names; a flow test inspects the body (Blocks 2 and 8) |
| R-11 | A net worth point looks wrong because investments or rates are missing and the client cannot tell | R | Medium | Low | The point carries `investmentsIncomplete` and the reason `no_rate` instead of guessing, with tests for both (Blocks 6 and 7) |

## Supply chain
No new runtime dependency: the feature reuses Drizzle, Express and Zod and the shared money, time and
statement-cycle helpers already in the project, and a test pins the dependency lists of `apps/api` and
`packages/shared` (spec D17). The only schema change is one table and its seed in migration 0037.

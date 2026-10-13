# Threat model FEAT-011: Budgets by statement month, and available money on the home screen

| Field | Value |
|-------|-------|
| Ticket | FEAT-011 |
| Spec | docs/ddw/specs/spec-FEAT-011.md |
| Tier | FEATURE |
| Date | 2026-10-13 |

## Components

| Component | Source in the spec |
|---|---|
| `packages/shared/src/credit-cards/statement-month.ts` | Block 1 |
| `apps/api/src/budgets/infrastructure/db/drizzle-spending-reader.ts` | Block 3 |
| `apps/api/src/budgets/application/compute-spending.ts` | Block 4 |
| `apps/api/src/budgets/infrastructure/http/spending-presenter.ts` | Block 4 |
| `apps/api/src/dashboard/application/build-available.ts` | Block 6 |
| `apps/api/src/accounts/index.ts` | Block 6 |
| `apps/web/src/features/dashboard/components/net-worth-card.tsx` | Block 7 |

## Trust boundaries

- Browser → API: `GET /budgets/spending`, `GET /budgets/:id/spending` and `GET /dashboard` carry the
  session cookie and the `month` query over the public internet.
- API → database: the spending reader and the accounts read cross into the private PostgreSQL
  network with the caller's owner id bound as a parameter.
- Budgets module → accounts module: the dashboard reaches the accounts totals only through the
  accounts barrel (`apps/api/src/accounts/index.ts`), never through its tables.
- API → browser: the response carries the caller's own amounts, rendered by the web app.

## STRIDE analysis

### `packages/shared/src/credit-cards/statement-month.ts`
- **Spoofing:** a pure function with no identity; nothing to impersonate.
- **Tampering:** its input is the statement row the reader returns; an altered stored due date only
  moves the caller's own purchases to another month, and the owner can already edit it.
- **Repudiation:** it writes nothing, so there is no action to deny; the statement edit is logged by
  the credit-cards module.
- **Information Disclosure:** it returns a `YYYY-MM` string derived from the caller's own row.
- **Denial of Service:** constant-time date arithmetic on one row; unusable days fall back to the
  period month and do not throw (AC-14), so a bad card cannot break a read.
- **Elevation of Privilege:** it has no access to data beyond its arguments.

### `apps/api/src/budgets/infrastructure/db/drizzle-spending-reader.ts`
- **Spoofing:** the owner id comes from the verified session through `scopedTo`, never from the
  request.
- **Tampering:** the three reads are SELECT only; the `month` and category ids are bound parameters,
  and the timestamps are bound as ISO text, so no input is concatenated into the SQL.
- **Repudiation:** a read changes nothing; the existing request log keeps the endpoint and the user.
- **Information Disclosure:** the card, statement, installment and movement joins all carry the owner
  column, so a row of another user cannot join in (R-01, validated by AC-16).
- **Denial of Service:** two more grouped queries per read, joined by card and statement, with the
  existing perf tests as the gate (R-02).
- **Elevation of Privilege:** the reader receives an issued access scope and asserts it, as the
  share read does; a foreign budget id answers 404, never 403.

### `apps/api/src/budgets/application/compute-spending.ts`
- **Spoofing:** it takes the scope from the use case, which takes it from the session.
- **Tampering:** the month is validated as `YYYY-MM` by the route schema and rejected when in the
  future (`BudgetMonthInFuture`).
- **Repudiation:** it persists nothing; the budget alerts it feeds are stored by the existing alert
  store with their month.
- **Information Disclosure:** the figures returned are the caller's own; an installment in another
  currency is counted, never shown with another user's detail.
- **Denial of Service:** one read of each kind for all budgets, never one per budget.
- **Elevation of Privilege:** it reads through the ports and has no direct database access.

### `apps/api/src/budgets/infrastructure/http/spending-presenter.ts`
- **Spoofing:** it formats a response the route already authorised.
- **Tampering:** amounts are exact integer strings, so no float conversion alters them.
- **Repudiation:** nothing to log; it is a pure mapping.
- **Information Disclosure:** it adds one integer, `unconvertedInstallmentCount`, and no account,
  card or merchant detail.
- **Denial of Service:** a fixed-size mapping of the use case result.
- **Elevation of Privilege:** it has no access to the request or to storage.

### `apps/api/src/dashboard/application/build-available.ts`
- **Spoofing:** the scope comes from the session of `GET /dashboard`.
- **Tampering:** it reads the totals the accounts module computes and converts them with the stored
  rate; it cannot write.
- **Repudiation:** read only; the account flag changes are recorded by the accounts module.
- **Information Disclosure:** it returns two sums and a converted total, no account names (R-03); a
  failed accounts read fails the section and is not swallowed, so no partial amount leaks.
- **Denial of Service:** it reuses the rate that the net worth section already read, so there is no
  second rate query and no external call in the request path.
- **Elevation of Privilege:** it reaches accounts through the barrel only, enforced by
  `boundaries.test.ts`.

### `apps/api/src/accounts/index.ts`
- **Spoofing:** exporting adapters adds no entry point; the routes keep their session middleware.
- **Tampering:** the newly exported repository and movement-sum adapters are the existing classes;
  exporting them does not change what they write.
- **Repudiation:** account changes keep their existing logging.
- **Information Disclosure:** wider exports make the adapters importable by other modules; the
  boundaries test restricts which modules may import them (R-04).
- **Denial of Service:** exports add no runtime work.
- **Elevation of Privilege:** a module that imports the adapters could read accounts directly; the
  `SOURCE_MODULES` rule lists the dashboard as the only new consumer.

### `apps/web/src/features/dashboard/components/net-worth-card.tsx`
- **Spoofing:** it renders data the authenticated API returned; no credentials in the component.
- **Tampering:** amounts come from the validated shared schema and are formatted by the locale
  formatter, never edited in the component.
- **Repudiation:** a display component, no action to deny.
- **Information Disclosure:** the available tile shows the user's own amounts on their own screen; no
  amount enters a push notification or a log.
- **Denial of Service:** it renders two parts and a total, with no extra request (AC-25).
- **Elevation of Privilege:** a presentational component with no data fetching and no Server Action.

## Data classification

| Data | Class | At rest | In transit |
|---|---|---|---|
| card purchase and installment amounts | financial | PostgreSQL volume encryption of the hosting platform; bigint minor units | TLS 1.3 |
| available money and net worth parts | financial | computed on read, never stored | TLS 1.3 |
| statement due dates and card closing days | financial | PostgreSQL volume encryption of the hosting platform | TLS 1.3 |
| owner id, session cookie | credentials | session id hashed in the sessions table | TLS 1.3, cookie flagged Secure and HttpOnly |
| month, category ids | public | not sensitive | TLS 1.3 |

## Risks and mitigations

| ID | Risk | STRIDE | Likelihood | Impact | Mitigation |
|---|---|---|---|---|---|
| R-01 | a card purchase or installment of another user enters the caller's budget sum through a join missing the owner column | I | M | H | every join and condition carries the owner column through `scopedTo`, and AC-16 plants another user's purchase and installment in the same period |
| R-02 | the extra card and installment queries push `budget-alerts` past its latency limit | D | M | M | grouped queries joined by card and statement, no per-row query, a query-plan test, and the perf tests run at their existing thresholds (AC-15) |
| R-03 | the new `available` field exposes account names or per-account balances | I | L | M | the section returns only two sums and a converted total, and the shared response contract has no account fields |
| R-04 | exporting the accounts adapters lets any module read accounts directly | E | L | M | `boundaries.test.ts` lists the allowed consumers, and the dashboard imports only through the barrel |
| R-05 | a purchase counted in two months or in none misstates the budget and its alerts | T | M | M | the card rows leave the date-based sum and enter the statement-based one, with a test that adds both and expects exactly one count (AC-07) |
| R-06 | a wrong available figure on the home screen leads the user to overspend | T | L | M | the figure is the accounts module's own totals, with a test that compares both screens (AC-19) |

## Supply chain

No new runtime dependency: the change uses Drizzle, Zod and the shared money helpers already in the
repository, so there is nothing new to pin or scan.

## Availability

The extra budget queries are the only new load, bounded by one grouped read per kind for all budgets
and guarded by the perf tests (R-02). The available section adds no external call, since it reuses the
stored rate the net worth section already read, and it fails with the dashboard section rather than
returning a guessed amount.

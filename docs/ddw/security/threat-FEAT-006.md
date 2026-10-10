# Threat model FEAT-006: Edit an account's opening balance

| Field | Value |
|-------|-------|
| Ticket | FEAT-006 |
| Spec | docs/ddw/specs/spec-FEAT-006.md |
| Tier | FEATURE |
| Date | 2026-10-09 |

## Components
| Component | Source in the spec |
|---|---|
| `packages/shared/src/accounts/account.ts` | Block 1 |
| `apps/api/src/accounts/application/set-opening-balance.ts` | Block 1 |
| `apps/api/src/accounts/infrastructure/db/drizzle-account-repository.ts` | Block 1 |
| `apps/api/src/accounts/infrastructure/http/account-routes.ts` | Block 2 |
| `apps/web/src/lib/api-client.ts` | Block 3 |
| `apps/web/src/features/accounts/opening-balance-request.ts` | Block 3 |
| `apps/web/src/features/accounts/containers/accounts-container.tsx` | Block 4 |
| `apps/web/src/features/accounts/components/account-row.tsx` | Block 4 |

## Trust boundaries
- Browser → API: `PATCH /accounts/:id/opening-balance` carries the account id and a new opening balance (financial data) over the public internet, behind the session cookie, the verified-email guard and the origin guard.
- API → database: the repository's single scoped `UPDATE ... RETURNING` crosses into PostgreSQL with parameters bound by Drizzle.
- API → browser: the response carries the updated account, including the recomputed balance, parsed by the response schema.
- User input → web form: the amount typed in the row form is untrusted text until the request builder parses it.

## STRIDE analysis
### `packages/shared/src/accounts/account.ts`
- **Spoofing:** the schema carries no identity; the caller is identified by the session in Block 2, so nothing can be spoofed here.
- **Tampering:** a client could send a float, a number, a huge value or extra keys; the schema accepts only a minor-units integer string within plus or minus 10^15 and strips unknown keys, so the request fails with a 400 (R-02).
- **Repudiation:** the schema does not change state; the audit line is written by the route (R-04).
- **Information Disclosure:** validation errors name the field path and never echo the submitted value.
- **Denial of Service:** the body is one short string; the bound on its numeric size keeps parsing constant time.
- **Elevation of Privilege:** the schema has no field for type, currency or owner, so the route cannot be used to change them.

### `apps/api/src/accounts/application/set-opening-balance.ts`
- **Spoofing:** the use case receives only an `AccessScope<'write'>` built from the authenticated session, never a raw user id.
- **Tampering:** it calls one repository method that sets one column; movements, rates, name, type and currency cannot change in this path (R-05).
- **Repudiation:** the route logs the change with user id and account id (R-04); the use case itself is pure and testable.
- **Information Disclosure:** a null from the repository becomes `ResourceNotFound`, identical for a missing and a foreign id (R-01).
- **Denial of Service:** one write and one aggregate read through the existing movements port per request; no loop and no retry.
- **Elevation of Privilege:** the use case adds no privilege and no bypass; archived and card-linked accounts are allowed on purpose, like rename, and still only for the owner (R-03).

### `apps/api/src/accounts/infrastructure/db/drizzle-account-repository.ts`
- **Spoofing:** the method requires an `AccessScope` and filters with `scopedTo` in the same statement.
- **Tampering:** the statement sets only `opening_balance` and `updated_at`; the value is a bound bigint parameter, never concatenated SQL.
- **Repudiation:** `updated_at` is stamped by the database clock, giving a trustworthy last-change time.
- **Information Disclosure:** a foreign row matches 0 rows, so no data about it is read or returned (R-01).
- **Denial of Service:** one indexed single-row UPDATE, no lock held beyond the statement.
- **Elevation of Privilege:** no method accepts a raw owner id; the owner condition is part of the WHERE clause.

### `apps/api/src/accounts/infrastructure/http/account-routes.ts`
- **Spoofing:** the route sits behind `requireSession`, `requireVerifiedEmail` and the origin guard with the `X-Requested-With` header, so a cross-site form cannot forge the request (R-06).
- **Tampering:** params and body are validated with the shared schemas through `validate`; the handler never reads `req.body` raw.
- **Repudiation:** the route writes an audit line with request id, user id and account id only (R-04).
- **Information Disclosure:** the response is parsed by the response schema and errors carry a code and field paths, never values; the log line carries no amount and no name.
- **Denial of Service:** the route does one short scoped write; the session controls in front of `/accounts` apply and, like rename and archive, it has no dedicated limiter (R-07).
- **Elevation of Privilege:** another user's account answers 404, the same body as a missing id, so the route cannot probe or change data outside the caller's scope (R-01).

### `apps/web/src/lib/api-client.ts`
- **Spoofing:** the client relies on the session cookie and the existing origin header; it holds no credential of its own.
- **Tampering:** `onAccount` encodes the id as a single path segment, so it cannot rewrite the request path; the body is built from the validated request only.
- **Repudiation:** the client records nothing; the server audit line is the record.
- **Information Disclosure:** failures map to message keys only; no server detail reaches the screen.
- **Denial of Service:** one request per submit; the container disables the row controls while a request is in flight.
- **Elevation of Privilege:** the client cannot grant itself anything; the server decides on the session scope for every call.

### `apps/web/src/features/accounts/opening-balance-request.ts`
- **Spoofing:** the builder is a pure function and handles no identity.
- **Tampering:** typed text becomes a request only after `parseAmountInput` and `openingBalanceSchema`; locale separators cannot be used to smuggle a different number (R-02).
- **Repudiation:** the builder records nothing; it returns either a request or a message key.
- **Information Disclosure:** it returns message keys and never logs or stores the typed amount.
- **Denial of Service:** parsing is linear in a short string.
- **Elevation of Privilege:** the builder cannot reach beyond the amount field; the server validates again.

### `apps/web/src/features/accounts/containers/accounts-container.tsx`
- **Spoofing:** the container never reads or sets identity; a 401 sends the user to sign-in.
- **Tampering:** the row is replaced from the API response and the totals are read again, so a failed request never leaves a client value that disagrees with the server (R-08).
- **Repudiation:** the container shows the outcome of each submit (the updated row or the alert), so the user can tell what happened.
- **Information Disclosure:** amounts are rendered with the locale formatter from the API's decimal strings; nothing is written to storage, logs or the URL.
- **Denial of Service:** a submit triggers one write and one silent list reload; there is no polling.
- **Elevation of Privilege:** the action is shown on every account for clarity only; the server enforces ownership regardless of what the page shows.

### `apps/web/src/features/accounts/components/account-row.tsx`
- **Spoofing:** the component is presentational and handles no identity.
- **Tampering:** the preview is computed with bigint arithmetic from the API's strings and is display only; the saved value always comes from the server response (R-08).
- **Repudiation:** the component keeps no history; the server log is the record.
- **Information Disclosure:** the form shows the account's own values to its owner and puts nothing in the URL or storage.
- **Denial of Service:** the preview recomputes on each keystroke over a short string, with no request.
- **Elevation of Privilege:** the component has no data access; every call goes through the container and the API.

## Data classification
| Data | Class | At rest | In transit |
|---|---|---|---|
| `opening_balance` (per account) | financial | PostgreSQL bigint, NOT NULL, owner-scoped, covered by the database's encrypted volume and backups | TLS 1.3 between browser and API, TLS to the database |
| derived `balance` in the response | financial | derived on read, never stored | TLS 1.3, decimal string in JSON |
| account id in the route path | public identifier (random UUID, access still owner-scoped) | PostgreSQL uuid primary key | TLS 1.3 |
| audit log line (request id, user id, account id) | financial metadata, no name and no amount | application log store, retention as for other audit lines | TLS to the log sink |

## Risks and mitigations
| ID | Risk | STRIDE | Likelihood | Impact | Mitigation |
|---|---|---|---|---|---|
| R-01 | A user changes or learns about another user's account | E | M | H | the UPDATE is filtered by `scopedTo`; foreign and missing ids both answer 404 with the same body and write nothing; tests AC-08, AC-09 |
| R-02 | A crafted value (float, number, out of range, extra keys) corrupts the stored balance or breaks arithmetic | T | M | H | `openingBalanceSchema` bounds the value to 10^15 minor units, bigint end to end, response parsed by schema; tests AC-02, NFR-02 |
| R-03 | Editing the opening balance of a card-linked or archived account changes debt or history unexpectedly | T | M | M | accepted risk, see Accepted risks: the change follows rename's rules, which allow both; the response always carries the recomputed balance and the audit line records the change |
| R-04 | A balance change cannot be attributed to a user afterwards | R | L | M | the route writes an audit line with request id, user id and account id; no name and no amount; test AC-13, NFR-04 |
| R-05 | The change rewrites movements or frozen rates by accident | T | L | H | the repository updates one column and the movements port is read-only; test AC-07 compares movements rows before and after |
| R-06 | A cross-site request changes the balance with the user's session | S | L | H | session cookie plus origin guard and `X-Requested-With`; route test AC-10 |
| R-07 | Repeated writes are used to flood the database | D | L | L | bounded by design: one indexed single-row UPDATE behind a verified session, and the identity module's limiters are not applied to account routes (rename and archive have none either); the question of a shared write limiter on accounts routes is left to the owner |
| R-08 | The page shows a balance that disagrees with the server after a failed update | T | M | L | the row is replaced from the API response only and totals are reloaded; a failure keeps the form open and the previous value; tests AC-19, AC-20 |

## Accepted risks
### R-03: card-linked and archived accounts can be edited
- **Accepted by:** the product owner, who set the scope of this ticket as "the rule rename already uses".
- **Justification:** rename has no rule for card-linked or archived accounts, and the owner must be able to correct a wrong opening balance on any of their accounts; blocking either would leave the production error uncorrectable.
- **Review conditions:** when a ticket changes the card-linked or archived account rules, or when credit card statements start reading the account opening balance.

## Supply chain
No new runtime or development dependency is added: the form reuses `MoneyInput`, the shared parser and Lucide icons already installed, and the route reuses Express, Zod and Drizzle already in the lockfile. `pnpm audit --prod --audit-level high` stays unchanged and runs in CI.

## Availability
The new route is one indexed single-row UPDATE plus the existing balance read per request behind the session guards, so it creates no new amplification vector and needs no migration or downtime.

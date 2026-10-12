# SAST report DISC-001-09a: Reports API

| Field | Value |
|---|---|
| Ticket | DISC-001-09a |
| Tier | FEATURE |
| Date | 2026-10-12 |
| Scope | `apps/api/src/reports/**` (application, domain, infrastructure: the raw-SQL readers, the Drizzle flow reader, `flow-conditions.ts`, `bucketed-sums.ts`, the report routes and presenters), the exchange-rates repository change (`apps/api/src/exchange-rates/infrastructure/db/drizzle-rate-repository.ts` and the `exchangeRateHistory` table in `schema.ts`), migration `apps/api/drizzle/0038_exchange_rate_history.sql`, and `packages/shared/src/reports/{report,report-range}.ts`. Tests are read only for what they assert. No dependency added. |
| Method | Manual review by one reader (no semgrep or other SAST scanner is installed in this environment) against catalog §4: targeted searches over the scope (`db.execute`, `sql.raw`, every `sql` template interpolation, `eval`, `new Function`, `child_process`, `console`, `JSON.parse`, `Math.random`, `process.env`, `parseFloat`, `toFixed`, `Number(`, `req.body`, `req.query`, `req.params`, `any`, `eslint-disable`, `@ts-ignore`, token and secret patterns); a full read of every raw-SQL reader (`drizzle-account-flow-reader.ts`, `drizzle-group-flow-reader.ts`, `drizzle-installment-debt-reader.ts`, `drizzle-investment-reader.ts`, `drizzle-net-worth-rate-reader.ts`), `drizzle-flow-reader.ts`, `flow-conditions.ts`, `bucketed-sums.ts`, `report-routes.ts`, the rate repository, migration 0038 and the report schemas; the threat model (`threat-DISC-001-09a.md`) as checklist |
| Result | PASSED — 0 Critical, 0 High, 0 Medium, 0 Low open; 3 Info documented below |

## Findings by rule

- ✅ F-SAST-01 Hardcoded secrets (CWE-798): the secret-pattern search finds no key, password, token or connection string in the scope; migration 0038 holds only DDL and a copy `INSERT ... SELECT`.
- ✅ F-SAST-02 SQL injection (CWE-89): every `db.execute` template in the scope was read and each interpolated value is a bound parameter. Owner ids go as `${owner}::uuid` (`drizzle-account-flow-reader.ts`, `drizzle-group-flow-reader.ts`, `drizzle-installment-debt-reader.ts`, `drizzle-investment-reader.ts`); window instants are bound ISO text cast with `::timestamptz` (`bucketed-sums.ts:12`, `flow-conditions.ts:10`); the time zone is bound as `${timeZone}::text` (`bucketed-sums.ts:25-26`, `flow-conditions.ts:15-16`); the point date and the `addMonths` result are bound (`drizzle-installment-debt-reader.ts:45-46`); the date and instant arrays are built with `sql.join` over one bound parameter per element (`drizzle-investment-reader.ts:16-21`, `drizzle-net-worth-rate-reader.ts:26-30`); the rate type is bound (`drizzle-net-worth-rate-reader.ts:36,45`); the tag filter compares `lower(${window.tag})` as a bound value (`flow-conditions.ts:46`). The only `sql.raw` calls are `sql.raw(type)` where `type` is the closed union `'date' | 'timestamptz'` set by the two callers (I-1), the constant ordinals `'1, 2, 3, 4, 5'` (I-2), and the schema constants `RATE_MAX_LITERAL` and the `oneOf` literals, which come from compile-time constants and are used in DDL only (`exchange-rates/infrastructure/db/schema.ts:25,39`). No string concatenation builds SQL anywhere.
- ✅ F-SAST-03 OS command injection (CWE-78): no `child_process`, `exec` or `spawn` in the scope.
- ✅ F-SAST-04 Insecure deserialization (CWE-502): no `JSON.parse` in the report code (the only one in the exchange-rates module is the existing provider payload reviver, outside this change); report sums are read as text and converted with `BigInt(...)` (`bucketed-sums.ts:39`), never through a number; the query is parsed by the strict schemas `reportFlowQuerySchema` and `netWorthQuerySchema` and the responses by the shared response schemas.
- ✅ F-SAST-05 Path traversal (CWE-22): no file access in the scope; the account id is `z.uuid()` and the dates and months are anchored regexes or `localDateSchema`.
- ✅ F-SAST-06 XSS (CWE-79): API only, JSON responses; the category name and `defaultKey` are returned as data typed by `expensesByCategoryRowSchema`; no HTML is produced.
- ✅ F-SAST-07 SSRF (CWE-918): the report readers make no outbound call; the rate repository only writes to the database (the provider call stays in the existing adapter and out of any request path).
- ✅ F-SAST-08 Broken cryptography (CWE-327): no cryptography added; no `Math.random`, MD5 or SHA-1 in the scope.
- ✅ F-SAST-09 Debug mode in production (CWE-489): no `console` call, debug flag or `NODE_ENV` branch in the scope.
- ✅ F-SAST-10 Logging sensitive data (CWE-532): the three routes log only `requestId` and `userId` with a fixed message (`report-routes.ts:60,74,87`); no amount, tag, account name or query value is logged.
- ✅ F-SAST-11 Unrestricted upload (CWE-434): no upload surface.
- ✅ F-SAST-12 Missing CSRF protection (CWE-352): the three endpoints are `GET` and read-only, behind `requireSession` and `requireVerifiedEmail` (`report-routes.ts:49`); the rate repository write is a server job, not an HTTP route.
- ✅ F-SAST-13 Critical/High CVE in a dependency: no `package.json` or `pnpm-lock.yaml` change; the audit is re-run by the release gate.
- ✅ F-SAST-14 Incomplete input validation (CWE-20): every route validates the query with `validate({ query, response })` and a strict Zod schema (`reportFlowQuerySchema`: `from`, `to`, `accountId` as `z.uuid()`, `tag` as `movementTagSchema`; `netWorthQuerySchema`: `from`, `to`); unknown keys are rejected; `resolveReportRange` refuses a future `to`, `from > to` and a range over the per-report month cap (`report-range.ts:78-89`), which also bounds the size of the arrays bound in the SQL; the stored user time zone is checked with `isIanaTimeZone` and falls back to the default before use (`drizzle-report-preferences.ts:29`).
- ✅ F-SAST-15 Insecure error handling (CWE-209): range failures are a `VALIDATION_FAILED` `AppError` naming only the query field; `assertCurrency` throws a generic error mapped by the central error middleware; no `catch` is added in the scope and no stack or SQL text reaches a response.
- ✅ F-SAST-16 Medium CVE in a dependency: none (no dependency changed).
- ✅ F-SAST-17 Unsafe function (CWE-95): no `eval`, `new Function` or string timers in the scope.
- ✅ F-SAST-18 Suppressions complete: no suppressions in this report; the scope has no `eslint-disable`, `@ts-ignore` or `@ts-expect-error`, and no `any`.
- ✅ F-SAST-19 Suppressions within review window: no suppressions in this report.

## Cross-cutting checks

- Owner scoping and 404 semantics: every user-data read is scoped. The personal flow read goes through `scopedTo(scope, { owner })` (`flow-conditions.ts:29`) and the group share read filters `group_members.user_id = scope.userId`, with the payer movement joined on `movements.owner_id = scope.userId` (`drizzle-flow-reader.ts:99-110`). Each raw reader calls `assertIssuedScope(scope)` first and filters by `owner_id` or by the caller's own `group_members` rows (`mine`). Joins carry the owner pair (`a.owner_id = m.owner_id`, `p.owner_id = i.owner_id`, `s.owner_id = p.owner_id`), so a foreign row cannot be joined in by id. The `accountId` filter is an extra `AND` on top of the owner condition, so a foreign account id gives an empty report, never another user's data.
- Global data: `exchange_rate_history` and `exchange_rates` are global market data, not user data; `drizzle-net-worth-rate-reader.ts` states this and reads them without an owner filter on purpose. Nothing user-specific is stored in the history table.
- Money handling: the search finds no `parseFloat`, `toFixed` or `Number(` over amounts. Sums are cast `::text` in SQL and parsed with `BigInt` (`drizzle-flow-reader.ts:41,87`, `bucketed-sums.ts:39`, `drizzle-installment-debt-reader.ts`, `drizzle-investment-reader.ts`); the only `Number.parseInt` calls are on validated `YYYY-MM` parts in `report-range.ts` to step months, never on an amount. The migration keeps `buy` and `sell` as `bigint` with range checks (1 to 100000000000), as `exchange_rates`.
- Migration 0038: additive (creates `exchange_rate_history` with a composite primary key, a rate type check and range checks, then copies the current rows); no drop, rename or data loss. The backfill uses a fixed zone literal, not input.
- Rate repository atomicity: `replaceAll` writes the current table and the history in one transaction, and the history upsert is keyed by `(rate_type, rate_date)`, so a repeated refresh on the same day replaces rather than duplicates; a failure of either write rolls back both.
- Read-only surface: the report routes expose three `GET` endpoints and no write; the use cases only call reader ports.
- Resource use: one statement per reader, and the month and point counts are capped by `REPORT_MAX_MONTHS` (24, 12, 24), so the bound arrays and the unnest joins stay small.

## Threat model checklist (threat-DISC-001-09a)

- Reading another user's data through a report filter (`accountId`, `tag`): the owner condition is always present and the filters only narrow it. Mitigated.
- SQL injection through the tag, the time zone or the date arrays: all bound parameters (F-SAST-02). Mitigated.
- An oversized range causes a heavy query: `resolveReportRange` caps the months per report. Mitigated.
- A historical rate is changed after the fact: the history is upserted only for the current Argentina day and keyed per day; earlier days are never rewritten by the refresh. Mitigated.
- Float rounding on report totals: sums stay `bigint` end to end. Mitigated.
- Log leakage of amounts or names: only ids are logged (F-SAST-10). Mitigated.

## Low and informational findings (W-SAST-01)

| ID | Severity | Location | Finding | Disposition |
|---|---|---|---|---|
| I-1 | Info (CWE-89) | `apps/api/src/reports/infrastructure/db/drizzle-investment-reader.ts:20` | `sql.raw(type)` splices a string into the SQL | Not exploitable: `type` is typed as `'date' \| 'timestamptz'` and both call sites pass literals (`:38,:42`); no input reaches it |
| I-2 | Info (CWE-89) | `apps/api/src/reports/infrastructure/db/drizzle-flow-reader.ts:55` | `sql.raw('1, 2, 3, 4, 5')` for group by and order by ordinals (also `:56,112,113`) | Not exploitable: a constant string, kept because the month expression carries a bound zone and cannot be repeated (commented in the code) |
| I-3 | Info (CWE-209) | `apps/api/src/reports/infrastructure/db/bucketed-sums.ts:19` | `assertCurrency` includes the unexpected currency value in an error message | Not exploitable: the value comes from the database currency column (check-constrained to ARS and USD), not from input, and the error middleware does not send the message to the client |

## Summary

Total: 19 categories clean, 0 vulnerabilities open (0 critical, 0 high, 0 medium, 0 low); 3 Info documented, none blocking.

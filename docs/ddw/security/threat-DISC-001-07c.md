# Threat model DISC-001-07c: Balanz Holdings Excel Import

| Field | Value |
|-------|-------|
| Ticket | DISC-001-07c |
| Spec | docs/ddw/specs/spec-DISC-001-07c.md |
| Tier | FEATURE |
| Date | 2026-10-10 |

## Components
| Component | Source in the spec |
|---|---|
| `packages/shared/src/investments/import-plan.ts` | Block 1 |
| `apps/api/src/investments/application/import-holdings.ts` | Block 2 |
| `apps/api/src/investments/infrastructure/http/holding-routes.ts` | Block 3 |
| `apps/api/src/app.ts` | Block 3 |
| `apps/web/src/features/investments/balanz-import/zip-limits.ts` | Block 4 |
| `apps/web/src/features/investments/balanz-import/parse-balanz-xlsx.ts` | Block 4 |
| `apps/web/src/features/investments/balanz-import/parse-balanz-rows.ts` | Block 4 |
| `apps/web/src/lib/api-client.ts` | Block 5 |
| `apps/web/src/features/investments/containers/investments-container.tsx` | Block 6 |

## Trust boundaries
- User's disk → browser: the `.xlsx` file is untrusted input (a zip that may expand enormously or
  carry cells with formulas and markup); it is read in the browser and never leaves it.
- Browser → API: `POST /investments/portfolios/:portfolioId/holdings/import` carries parsed
  holdings over the public internet; the API treats every field as untrusted, because the browser
  is under the user's control.
- API → database: the import transaction writes holdings of one portfolio, scoped by owner.
- Preview (browser) → apply (API): the preview is computed from data that may be stale by the time
  the user confirms; the server recomputes under the portfolio lock.

## STRIDE analysis
### `packages/shared/src/investments/import-plan.ts`
- **Spoofing:** a pure function with no identity; it cannot be impersonated.
- **Tampering:** it receives attacker-shaped input (repeated tickers, `crypto` tickers); it rejects
  a duplicate ticker ignoring case and a ticker equal to a crypto holding, and returns a plan
  instead of mutating anything (R-05).
- **Repudiation:** it records nothing; the use case logs the action and the counts.
- **Information Disclosure:** its errors carry a code only, never a ticker, quantity or price.
- **Denial of Service:** linear in the rows, bounded at 1,000 by the contract; the benchmark
  asserts < 5 s (R-03).
- **Elevation of Privilege:** it holds no authorization decision; scope is enforced by the use case.

### `apps/api/src/investments/application/import-holdings.ts`
- **Spoofing:** the user comes from the session through `scopeOf`, never from the body.
- **Tampering:** the whole replace runs in one transaction that locks the portfolio row, so a
  concurrent add or a second import cannot interleave and a failure rolls everything back (R-06,
  R-09).
- **Repudiation:** one `holdings.import` log line with user id, request id and the created, updated
  and removed counts.
- **Information Disclosure:** another user's portfolio answers 404, never 403; the response is the
  caller's own portfolio view.
- **Denial of Service:** at most 1,000 holdings per call and one lock per portfolio, so one import
  cannot hold more than its own portfolio (R-03).
- **Elevation of Privilege:** every repository call takes an `AccessScope<'write'>`; the import can
  only touch the caller's portfolio (R-02).

### `apps/api/src/investments/infrastructure/http/holding-routes.ts`
- **Spoofing:** the route sits behind the session and verified-email guards of the module and the
  origin guard of the app, with the `X-Requested-With` header (R-07).
- **Tampering:** params, body and response are validated by the shared Zod schemas through the
  `validate` middleware; amounts are bounded integer strings and `pricedOn` a real calendar day
  (R-05).
- **Repudiation:** the mutation is logged with `action: holdings.import`.
- **Information Disclosure:** the log carries counts only; tickers, names, quantities, prices and
  costs are never logged (R-04).
- **Denial of Service:** the 384 kb body limit applies to this path only and the item cap is 1,000
  (R-03).
- **Elevation of Privilege:** an unverified email is refused with 403 and a foreign portfolio with
  404 before any write (R-02).

### `apps/api/src/app.ts`
- **Spoofing:** the larger parser is chosen by method and path only; it adds no identity decision.
- **Tampering:** the path test is anchored, so another route cannot opt into the larger limit by
  crafting its path (R-03).
- **Repudiation:** unchanged; the request logging of the app applies.
- **Information Disclosure:** a body over the limit is answered by the error middleware with the
  standard error body and no echo of the content.
- **Denial of Service:** every other route keeps the 16 kb limit; only this path accepts 384 kb
  (R-03).
- **Elevation of Privilege:** the limit grants no access; guards run unchanged.

### `apps/web/src/features/investments/balanz-import/zip-limits.ts`
- **Spoofing:** a file named `.xlsx` that is a PDF, CSV or executable is rejected as `notExcel` by
  its structure, not by its name.
- **Tampering:** it only reads the central directory; it never extracts or evaluates content.
- **Repudiation:** a purely local check; nothing is recorded or sent.
- **Information Disclosure:** the error carries a reason code and never the file name or content.
- **Denial of Service:** declared uncompressed content above 10 MB and compressed files above 1 MB
  are refused before decompression; a header that lies about sizes is not caught, and the effect is
  limited to the user's own tab (R-01).
- **Elevation of Privilege:** it has no privileges; the browser sandbox applies.

### `apps/web/src/features/investments/balanz-import/parse-balanz-xlsx.ts`
- **Spoofing:** it only accepts the sheet "Mis Instrumentos"; any other workbook is `wrongSheet`.
- **Tampering:** cells are read as text through `parseNumber`, formulas and macros are never
  evaluated, and no cell value reaches `eval`, HTML or a URL (R-08).
- **Repudiation:** local only; no record.
- **Information Disclosure:** the file is read as an in-memory `File`; it is not uploaded, stored in
  IndexedDB or cached by the service worker, and the file name (which carries the holder's name and
  account numbers) is never read or sent (R-10).
- **Denial of Service:** the library runs in the user's browser on a file already capped by
  `zip-limits.ts`; a parser failure maps to `unreadable` (R-01).
- **Elevation of Privilege:** no privileges beyond the page's own.

### `apps/web/src/features/investments/balanz-import/parse-balanz-rows.ts`
- **Spoofing:** headers are matched without accents or case, so a lookalike column cannot stand in
  for a required one; a missing column rejects the whole file.
- **Tampering:** values become scaled integers by string handling only (no float); a row that fails
  is a `badRow` that rejects the whole import, never a partial one (R-05).
- **Repudiation:** local only; no record.
- **Information Disclosure:** its errors carry column names or a row number, never cell values.
- **Denial of Service:** more than 1,000 data rows is `tooManyRows`.
- **Elevation of Privilege:** pure parsing; no authority.

### `apps/web/src/lib/api-client.ts`
- **Spoofing:** the call sends credentials, the origin guard header and the refresh-on-401 of the
  other calls (R-07).
- **Tampering:** the response is parsed with `importHoldingsResponseSchema`; a body that does not
  match becomes `INTERNAL`.
- **Repudiation:** the server logs the action; the client logs nothing.
- **Information Disclosure:** the call takes parsed holdings and no `File`, and sends no file name
  (R-10).
- **Denial of Service:** a pending flag disables a second confirm; a failure keeps the dialog open.
- **Elevation of Privilege:** it holds no authority beyond the session cookie.

### `apps/web/src/features/investments/containers/investments-container.tsx`
- **Spoofing:** the user can switch any holding to USD in the preview; that is a legitimate input,
  not an identity matter.
- **Tampering:** the preview is computed from the portfolio on screen and may be stale; the server
  recomputes at apply time and the response, not the preview, is shown as the truth (R-09).
- **Repudiation:** the done summary shows the counts the server applied.
- **Information Disclosure:** tickers and names from the file are rendered as React text, never as
  HTML (R-08); the parsed rows live in React state only and are dropped on cancel or close (R-10).
- **Denial of Service:** confirm is disabled while the request is pending.
- **Elevation of Privilege:** the import is online only and is never added to the offline queue, so
  no queued request can replay it later under another session (R-10).

## Data classification
| Data | Class | At rest | In transit |
|---|---|---|---|
| the uploaded `.xlsx` file | financial | never stored; in browser memory only until the dialog closes | never sent |
| the file name (holder name, account numbers) | PII | never read, stored or logged | never sent |
| ticker, instrument name, quantity, unit price, total cost | financial | existing `holdings` columns, owner-scoped; no new column | TLS 1.2+ (HSTS enforced by the existing HTTPS guard) |
| the `holdings.import` log line (counts, user id, request id) | public | application logs, without holding data | not applicable |

## Risks and mitigations
| ID | Risk | STRIDE | Likelihood | Impact | Mitigation |
|---|---|---|---|---|---|
| R-01 | a hostile `.xlsx` expands enormously and freezes the user's tab | D | L | M | 1 MB compressed cap, 10 MB declared uncompressed cap read from the central directory before decompression, 1,000-row cap; a lying header affects only the user's own tab |
| R-02 | another user's portfolio is imported into or read (IDOR) | E | M | H | `AccessScope<'write'>` on every repository call; a foreign or missing portfolio answers 404; test with a second user (Block 2, Block 3) |
| R-03 | a large or repeated import degrades the API | D | M | M | 384 kb limit on this path only, 1,000-item contract cap, one transaction per import under the portfolio lock, benchmark < 5 s |
| R-04 | financial data leaks into logs | I | M | M | log line carries counts, user id and request id only; a route test asserts no ticker or amount appears |
| R-05 | the client sends crafted values (negative, huge, repeated tickers, `crypto`) because the file is parsed in the browser | T | H | M | the server validates every field with the shared schemas and re-plans under the lock; a crafted body can only change the caller's own portfolio, as the manual add form already can |
| R-06 | the replace deletes holdings the user added by hand | T | M | H | the preview lists removed holdings with a warning before confirm (AC-02); the replace is atomic; manual holdings belong in another portfolio |
| R-07 | cross-site request forgery of the import endpoint | S | L | H | session cookie plus the origin guard and the `X-Requested-With` header on every mutation, as the other investment routes |
| R-08 | a cell with markup or a formula-looking text (`=0.00 (0.00%)`) runs as code or HTML | T | L | M | cells are plain text, never evaluated; names and tickers are rendered as React text; no `dangerouslySetInnerHTML` (checked by lint and a test) |
| R-09 | the preview is stale and the apply differs, or two imports race | T | M | M | portfolio row lock in one transaction; the response reports what was applied and replaces the screen |
| R-10 | the file or its name persists in IndexedDB, the sync queue or a cache, or is replayed offline | I | M | H | the file never leaves memory; the import is not queued offline; a test checks IndexedDB and the queue after confirm and cancel |

## Supply chain
No new dependency: `package.json` and `pnpm-lock.yaml` stay unchanged. `read-excel-file` 9.3.10 (with
`fflate`, `saxen`, `unzipper-esm`, `worker-f`) is already in `apps/web` for the credit card
statement import and is covered by `pnpm audit --prod --audit-level high` in CI; the new code only
calls its `readSheet` with a `parseNumber` hook.

## Availability
The API side is bounded by the 1,000-item cap, the 384 kb path limit and one transaction under a
per-portfolio lock. The browser side is bounded by the 1 MB and 10 MB caps and runs in the user's own
tab, so it cannot degrade the service for anyone else. There is no external service in the request
path.

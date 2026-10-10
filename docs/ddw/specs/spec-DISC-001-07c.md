# Spec DISC-001-07c: Balanz Holdings Excel Import

| Field | Value |
|-------|-------|
| Ticket | DISC-001-07c |
| PRD | docs/ddw/prd/prd-DISC-001-07c.md |
| Tier | FEATURE |
| Date | 2026-10-10 |
| Spec loops | 0 |
| Loops since last human decision | 0 |

## Summary
The `.xlsx` is read **in the browser** with `read-excel-file`, already a dependency of the web app
for the credit card statement import, so the file never reaches the API, nothing is stored and no
dependency is added. A pure parser turns the sheet "Mis Instrumentos" into a list of incoming
holdings; a pure planner in `packages/shared` compares it with the portfolio's current holdings and
yields what will be created, updated and removed, which is the preview. On confirm the web sends the
parsed holdings (never the file) to one new endpoint,
`POST /investments/portfolios/:portfolioId/holdings/import`, which runs the same planner inside one
transaction that locks the portfolio and applies it: removed holdings are deleted, kept tickers
take the file's "Valor inicial" as total cost, and every unit price is written with source `import`. Block 1 builds the shared contract and planner; Blocks 2-3 the use
case and route; Block 4 the file parser; Blocks 5-6 the web client and screen; Block 7 the fixture,
benchmark and end-to-end flow.

Design choices (marked "human" where decided by the human on 2026-10-10, otherwise technical and
inside the PRD's rules):
- **Currency** (human). The sheet has no currency column, so the preview shows every holding in ARS
  and lets the user switch each one to USD before confirming (FR-06). The choice travels in the
  request as each holding's `valuationCurrency`.
- **Instrument type** (human). Every type is accepted. "Cedears" maps to `cedear`; the type text is
  matched without accents or case: contains "accion" to `stock`, "bono", "titulo" or "obligacion" to
  `bond`, "fondo" or "fci" to `mutual_fund`, "plazo fijo" to `fixed_term_deposit`; anything else to
  `other`. Only "Cedears" is verified against a real file; the type is shown in the preview.
- **Cost** (human). The total cost of every holding is the file's "Valor inicial" (rounded half up to
  minor units); when that cell is empty or 0 the cost stays empty. There is no keep-the-old-cost
  rule.
- **Price.** The unit price is the "Precio" column and `pricedAt` is the "Fecha" column day at 00:00
  UTC, so the 7-day staleness rule of 07a applies to the file's date, not to the upload time.
- **Name and type of a kept ticker** are not rewritten; quantity, currency, cost and price are.
- **A duplicate ticker inside the file, a ticker that is an existing crypto holding, or more than
  1,000 rows** reject the whole import.
- **Preview versus apply.** The preview is computed in the browser from the portfolio already on
  screen; the server recomputes at apply time under the lock, and the response reports what was
  really applied. If the portfolio changed in between, the response is the truth.

## Coverage: PRD → blocks
| Requirement | Covered by |
|---|---|
| FR-01 | Block 2, Block 3, Block 4, Block 5, Block 6, Block 7 |
| FR-02 | Block 1, Block 6, Block 7 |
| FR-03 | Block 1, Block 2, Block 3, Block 7 |
| FR-04 | Block 1, Block 2, Block 3, Block 4, Block 6 |
| FR-06 | Block 1, Block 6, Block 7 |
| FR-07 | Block 4, Block 6 |
| FR-05 | Block 4, Block 6, Block 7 |
| NFR-01 | Strategy: parsing and planning are linear in rows; a benchmark parses and plans 1,000 rows and asserts < 5 s (Block 7), the request body for 1,000 rows is under the route limit set in Block 3 |
| NFR-02 | Strategy: the file is read as an in-memory `File` in the browser and never sent, written or logged; the API receives only parsed fields, and a test asserts the import request carries no file or file name (Block 5, Block 6) |
| NFR-03 | Strategy: before any decompression the central directory of the zip is read and the declared uncompressed sizes are summed; above 10 MB the file is rejected (Block 4) |

## Dependencies between blocks
Block 2 depends on Block 1. Block 3 depends on Blocks 1 and 2. Block 4 depends on Block 1 (the
incoming holding type). Block 5 depends on Blocks 1 and 3. Block 6 depends on Blocks 1, 4 and 5.
Block 7 depends on all. Execution order: 1, 2, 3, 4, 5, 6, 7.

## Block 1 — Shared contract and import planner

**Files**
- `packages/shared/src/investments/constants.ts` (modified) — `IMPORT_MAX_HOLDINGS = 1000`.
- `packages/shared/src/investments/contracts.ts` (modified) — `importHoldingsRequestSchema`, `importHoldingsResponseSchema` and their types.
- `packages/shared/src/investments/import-plan.ts` (new) — `planHoldingsImport`.
- `packages/shared/src/index.ts` (modified, only if it does not already re-export the investments folder) — exports.

**Logic**
- An incoming holding is `{ ticker, instrumentName, instrumentType, valuationCurrency, quantity, totalCost | null, unitPrice, pricedOn }`; `pricedOn` is a `YYYY-MM-DD` day. Amounts and quantities are integer strings, never floats.
- `planHoldingsImport(current, incoming)` is pure. `current` is the portfolio's holdings (`ticker`, `instrumentType`, `id`); `incoming` is the file's. Tickers match ignoring case. It returns `{ create, update, remove }`: `create` are incoming tickers not present, `update` are present ones (carrying the file's cost, currency and price), `remove` are current tickers absent from the file. It throws a typed error `ImportPlanError` with code `duplicateTicker` when the file repeats a ticker (ignoring case) and `cryptoTicker` when an incoming ticker matches a crypto holding.
- The cost is always the file's, for new and kept tickers alike.
- The response is `{ created, updated, removed, portfolio }` with `portfolio` the existing `portfolioResponseSchema`.

**Data model**
- No table, column or migration changes. The in-memory `IncomingHolding` has non-null `ticker` (unique ignoring case within a request), `instrumentName`, `instrumentType` (never `crypto`), `valuationCurrency` (`ARS` or `USD`), `quantity` (> 0), `unitPrice` (> 0), `pricedOn`, and a nullable `totalCost` (> 0 when present).

**Input validation**
- The request is `{ holdings: IncomingHolding[] }` with 1 to `IMPORT_MAX_HOLDINGS` items; ticker, name, type and `valuationCurrency` use the existing ticker, name, `INSTRUMENT_TYPES` (except `crypto`) and `VALUATION_CURRENCIES` schemas; `quantity` and `unitPrice` use the existing bounded integer schemas; `totalCost` is the bounded schema or null; `pricedOn` matches `YYYY-MM-DD` and is a real calendar day.

**Error handling**
- An empty list, more than 1,000 items, an unknown type, `crypto`, a malformed amount or a non-calendar date fails schema validation (400 with `fields`).
- `ImportPlanError` is a plain error the API use case maps to `VALIDATION_FAILED` with the field `holdings`.

**Required tests**
- [ ] `packages/shared/test/investments/import-plan.test.ts` — a file with one new, one kept and one absent ticker yields one create, one update and one remove, matching tickers ignoring case — validates AC-02.
- [ ] `packages/shared/test/investments/import-plan.test.ts` — kept and new tickers both take the file's cost, currency and price, and a USD choice is carried through — validates AC-03 and AC-09.
- [ ] `packages/shared/test/investments/import-plan.test.ts` — a repeated ticker (`ibit`, `IBIT`) throws `duplicateTicker`; a ticker equal to a crypto holding throws `cryptoTicker` (invalid input) — validates AC-05.
- [ ] `packages/shared/test/investments/contracts-import.test.ts` — the request accepts 1,000 items and rejects 0 items, 1,001 items, `crypto`, `"12.5"` as a quantity and `2026-02-30` as a day (invalid input) — validates AC-05.
- [ ] `packages/shared/test/investments/no-float-money.test.ts` — `import-plan.ts` contains no floating-point token — validates NFR-01.

**Completion criterion**
`pnpm --filter @pesly/shared exec vitest run test/investments` passes and `pnpm typecheck` passes.

## Block 2 — `ImportHoldings` use case

**Files**
- `apps/api/src/investments/application/import-holdings.ts` (new) — the use case.

**Logic**
- Inside `unitOfWork.run`: `lockById` the portfolio (404 for a foreign or missing one), `listByPortfolio`, `planHoldingsImport`, then delete `remove` holdings, `update` each `update` (quantity, the file's cost, the chosen currency, price `{ unitPrice, source: 'import', pricedAt }`) and `insert` each `create` followed by `setPrice` with source `import`. Everything commits together or not at all.
- It returns the counts and the portfolio view built with the existing `buildPortfolioView` after the commit, with the market prices lookup of the other use cases.
- No port changes: it uses only the existing repository methods.

**Input validation**
- The scope is `AccessScope<'write'>`; the input is the validated request converted to `bigint` at the route.

**Error handling**
- A foreign or missing portfolio → `ResourceNotFound` (404), never 403.
- `ImportPlanError` and an existing `InvestmentRuleViolation` (quantity or cost above the limits) → `VALIDATION_FAILED` with `body.holdings`; the transaction rolls back and the portfolio is unchanged.

**Required tests**
- [ ] `apps/api/test/investments/import-holdings.test.ts` — with fake repositories, the portfolio ends with exactly the file's holdings, prices of source `import`, the file's costs and the chosen currencies — validates AC-03 and AC-09.
- [ ] `apps/api/test/investments/import-holdings.test.ts` — a failure on the third write leaves the fake store unchanged (rollback) — validates AC-05.
- [ ] `apps/api/test/investments/import-holdings.test.ts` — another user's portfolio answers not found and writes nothing (invalid access) — validates AC-05.
- [ ] `apps/api/test/investments/import-holdings.test.ts` — a duplicate ticker and a crypto ticker reject the whole import (invalid input) — validates AC-05.
- [ ] `apps/api/test/investments/import-holdings-concurrency.test.ts` — two imports of one portfolio run one after the other under the lock and the second sees the first's result — validates AC-03.

**Completion criterion**
`pnpm --filter @pesly/api exec vitest run test/investments/import-holdings.test.ts test/investments/import-holdings-concurrency.test.ts` passes.

## Block 3 — Import route and module wiring

**Files**
- `apps/api/src/investments/infrastructure/http/holding-routes.ts` (modified) — the new route.
- `apps/api/src/investments/index.ts` (modified) — builds and wires `ImportHoldings`.
- `apps/api/src/app.ts` (modified) — a larger JSON limit for this path only.

**Logic**
- `POST /investments/portfolios/:portfolioId/holdings/import` validates params, body and response with the Block 1 schemas through the shared `validate` middleware and converts integer strings to `bigint` at the boundary.
- `app.ts` gains `HOLDINGS_IMPORT_BODY_LIMIT = '384kb'` (1,000 rows of about 250 bytes) applied with the same method-and-path test used for the statement import; every other route keeps the 16 kb limit.
- The log line carries the request id, user id, action `holdings.import` and the three counts, never tickers, names, quantities or prices.

**Input validation**
- Params, body and response are validated by the Block 1 schemas through the shared `validate` middleware: `portfolioId` is a UUID, `holdings` has 1 to 1,000 items, amounts and quantities are bounded integer strings, `pricedOn` is a real `YYYY-MM-DD` day; the body limit is 384 kb on this path only and 16 kb elsewhere.

**API contract**
- Method + path: `POST /investments/portfolios/:portfolioId/holdings/import`.
- Request: `{ holdings: [{ ticker, instrumentName, instrumentType, quantity, totalCost, unitPrice, pricedOn }] }`.
- Response 200: `{ created: number, updated: number, removed: number, portfolio: PortfolioResponse }`.
- Error codes: 400 `VALIDATION_FAILED` (with `fields`), 401, 403 for an unverified email (same guard as the other routes), 404 `NOT_FOUND`, 413 above the body limit.
- Auth: session and verified-email guards of the module; the user always comes from `auth`.

**Error handling**
- A 413 body is answered by the existing error middleware with the standard error body, applying no change.

**Required tests**
- [ ] `apps/api/test/investments/import-holdings-routes.test.ts` — an authenticated import answers 200 with the counts and the portfolio — validates AC-01 and AC-03.
- [ ] `apps/api/test/investments/import-holdings-routes.test.ts` — a body of 1,000 holdings is accepted (under 384 kb) and one of 1,001 answers 400 — validates NFR-01.
- [ ] `apps/api/test/investments/import-holdings-routes.test.ts` — an invalid body, a foreign portfolio (404, not 403), no session (401) and an unverified email each answer their code and leave the portfolio unchanged (invalid input) — validates AC-05.
- [ ] `apps/api/test/investments/import-holdings-routes.test.ts` — the log line contains the counts and none of the tickers or amounts of the request — validates NFR-02.
- [ ] `apps/api/test/investments/import-holdings-routes.test.ts` — a path that only contains the import path (for example `/x/investments/portfolios/<id>/holdings/import` or with a suffix) does not get the 384 kb limit and a 20 kb body to it is refused (invalid input) — validates NFR-01 and the threat R-03.
- [ ] `apps/api/test/investments/request-path.test.ts` (modified) — the import route performs no external call — validates the "no external service in the request path" rule.

**Completion criterion**
`pnpm --filter @pesly/api exec vitest run test/investments/import-holdings-routes.test.ts test/investments/request-path.test.ts` passes.

## Block 4 — Browser file parser

**Files**
- `apps/web/src/features/investments/balanz-import/parse-balanz-rows.ts` (new) — pure rows → incoming holdings.
- `apps/web/src/features/investments/balanz-import/zip-limits.ts` (new) — declared uncompressed size of a zip.
- `apps/web/src/features/investments/balanz-import/parse-balanz-xlsx.ts` (new) — reads the `File` with `read-excel-file` and calls the pure parser.
- `apps/web/src/features/investments/balanz-import/balanz-types.ts` (new) — `BalanzParseError` with a reason code.

**Logic**
- `zip-limits.ts` reads the end-of-central-directory record and the central directory entries of the `.xlsx` (it is a zip) and sums the declared uncompressed sizes. Above 10 MB, or a file that is not a zip, it throws `BalanzParseError('tooLarge' | 'notExcel')` before any decompression. A file above 1 MB is rejected the same way.
- `parse-balanz-xlsx.ts` calls `readSheet(file, 'Mis Instrumentos', { parseNumber: (text) => text })`, so numeric cells arrive as their text and no float is created; a missing sheet maps to `'wrongSheet'`; any other library error maps to `'unreadable'`.
- `parse-balanz-rows.ts` finds the header row, requires the columns Ticker, Tipo de Instrumento, Descripcion, Nominales, Precio, Fecha, Precio promedio de compra and Valor inicial (compared without accents and case), and reads each data row: ticker (trimmed), name, type mapped as in the design choices (unknown types become `other`), quantity and amounts by string handling to scaled integers (quantity ×10^8, amounts ×100, half up), `Fecha` `dd/mm/yyyy` to `YYYY-MM-DD`. Blank trailing rows are skipped. The "Precio promedio de compra" column is validated but not used.
- All number handling reuses `parseScaledDecimal` from `@pesly/shared`; the folder is under the no-float scan of the web app, so it contains no `Number(`, `parseFloat`, `parseInt`, `toFixed`, `Math.round` or `Math.floor`.

**Data model**
- No stored schema. The parser output is the in-memory `IncomingHolding` of Block 1, with the same constraints: non-null ticker, name, type, quantity (> 0), price (> 0) and day, nullable cost.

**Input validation**
- At most 1,000 data rows; quantity greater than 0; price greater than 0; ticker and name within the shared maximum lengths; a real calendar date.

**Error handling**
- Every failure throws `BalanzParseError` with one of `notExcel`, `tooLarge`, `wrongSheet`, `missingColumns`, `badRow`, `tooManyRows`, `empty`; `missingColumns` and `badRow` carry the column names or the row number, never cell values. Nothing is partially returned.

**Required tests**
- [ ] `apps/web/test/parse-balanz-rows.test.ts` — the anonymized sample rows (IBIT 46 at 7535, SPY 2 at 20970) parse to 4,600,000,000 and 200,000,000 scaled quantities, 753500 and 2097000 minor-unit prices, costs 41949600 and 3846400 and day `2026-10-09` — validates AC-01.
- [ ] `apps/web/test/parse-balanz-rows.test.ts` — "Cedears" maps to `cedear`, "Acciones" to `stock`, "Bonos Soberanos" to `bond`, "FCI" to `mutual_fund` and an unrecognized type to `other` — validates AC-10.
- [ ] `apps/web/test/parse-balanz-rows.test.ts` — a decimal cell `9119.47561304` and `Valor inicial` `419496.4` round half up without a float — validates AC-01.
- [ ] `apps/web/test/parse-balanz-rows.test.ts` — missing header columns, a row with quantity 0, a non-calendar date and 1,001 rows each throw the matching `BalanzParseError` with no cell values in the message (invalid input) — validates AC-05 and AC-07.
- [ ] `apps/web/test/zip-limits.test.ts` — a zip whose central directory declares 11 MB uncompressed is rejected before parsing, a CSV, a PDF and an empty file are `notExcel` (invalid input) — validates AC-07 and AC-08.
- [ ] `apps/web/test/parse-balanz-xlsx.test.ts` — the committed sample workbook parses end to end, and a workbook without the "Mis Instrumentos" sheet is `wrongSheet` — validates AC-01 and AC-07.
- [ ] `apps/web/test/no-float-money.test.ts` (modified) — covers the new folder through the existing `features/investments` scan — validates NFR-01.

**Completion criterion**
`pnpm --filter @pesly/web exec vitest run test/parse-balanz-rows.test.ts test/zip-limits.test.ts test/parse-balanz-xlsx.test.ts test/no-float-money.test.ts` passes.

## Block 5 — Web API client call and catalogs

**Files**
- `apps/web/src/lib/api-client.ts` (modified) — `importHoldings(portfolioId, holdings)`.
- `apps/web/messages/en.json` and `apps/web/messages/es.json` (modified) — the `investments.import` strings.

**Logic**
- `importHoldings` posts the parsed holdings to the Block 3 path, parses the response with `importHoldingsResponseSchema` and reuses the client's origin guard header and refresh-on-401. It takes no `File` and sends no file name.
- The catalogs add the labels of the dialog (title, choose file, preview headings "create", "update", "remove", per-row currency selector, confirm, cancel, done summary) and one message per `BalanzParseError` reason, in both languages, with no hardcoded string in any component.

**Error handling**
- A 400 keeps its `fields`; a 404, a network error and a 413 map to the existing failures and messages.

**Required tests**
- [ ] `apps/web/test/api-client-investments.test.ts` (modified) — `importHoldings` calls `POST` on the documented path with the origin guard header and a body with only the holding fields (no file, no name) — validates AC-03 and NFR-02.
- [ ] `apps/web/test/api-client-investments.test.ts` (modified) — a 400 with fields and a 404 map to their failures (error path) — validates AC-05.
- [ ] `apps/web/test/i18n-catalogs.test.ts` — every `investments.import` key exists in both catalogs and every `BalanzParseError` reason has a message in both (missing key) — validates the bilingual-interface rule.

**Completion criterion**
`pnpm --filter @pesly/web exec vitest run test/api-client-investments.test.ts test/i18n-catalogs.test.ts` passes.

## Block 6 — Import dialog and container

**Files**
- `apps/web/src/features/investments/components/import-holdings-dialog.tsx` (new) — presentational: file picker, preview, confirm, cancel, errors.
- `apps/web/src/features/investments/components/import-preview.tsx` (new) — the create, update and remove lists with counts.
- `apps/web/src/features/investments/components/portfolio-card.tsx` (modified) — an "Import from Balanz" action (`onImportHoldings`).
- `apps/web/src/features/investments/containers/investments-container.tsx` (modified) — owns the file reading, the plan, the request and the refresh.

**Logic**
- The container reads the chosen file with `parseBalanzXlsx` and computes the preview with `planHoldingsImport(portfolio.holdings, parsed)`, every holding in ARS until the user changes it; nothing is sent. Cancel or close discards the parsed rows and the `File` reference (the preview state is plain React state, never persisted to IndexedDB, local storage or the service worker queue).
- Confirm calls `importHoldings`, then replaces the portfolio on screen with the response and shows the counts.
- The preview shows each holding's type and a currency selector (ARS or USD, ARS by default) whose choice is sent as `valuationCurrency`; it shows the removed holdings in a distinct list with a warning that manual holdings in that portfolio will be deleted (PRD risk), and disables confirm while the request is pending.
- The dialog is presentational and pure; reading, planning and calling are in the container. It uses the existing shadcn components and theme tokens, with labelled controls, focus management and an error `alert` region like the other investment forms.

**Error handling**
- A `BalanzParseError` shows its translated reason and leaves the portfolio untouched; an API failure shows its message, keeps the dialog open and leaves the portfolio as the last response had it.

**Required tests**
- [ ] `apps/web/test/import-holdings-dialog.test.tsx` — with a parsed sample the dialog lists 2 to create, and with a portfolio holding `AAPL` also 1 to remove, before any request — validates AC-02.
- [ ] `apps/web/test/import-holdings-dialog.test.tsx` — every holding starts in ARS, switching one to USD changes only that holding and is what confirm sends; a type shown as `other` is visible — validates AC-09 and AC-10.
- [ ] `apps/web/test/import-holdings-dialog.test.tsx` — cancel calls no API and leaves the portfolio props unchanged — validates AC-04.
- [ ] `apps/web/test/import-holdings-dialog.test.tsx` — a wrong file shows the translated reason and no confirm button (invalid input) — validates AC-05 and AC-07.
- [ ] `apps/web/test/investments-container-import.test.tsx` — confirm sends only parsed holdings, then renders the returned portfolio; an API 400 keeps the dialog open with the message (error path) — validates AC-03 and AC-05.
- [ ] `apps/web/test/investments-container-import.test.tsx` — after confirm and after cancel, nothing about the file remains in IndexedDB or the sync queue — validates AC-06 and NFR-02.
- [ ] `apps/web/test/import-holdings-dialog.test.tsx` — a ticker and a name such as `<img src=x onerror=alert(1)>` and `=HYPERLINK("x")` render as plain text and no `dangerouslySetInnerHTML` appears in the import components (invalid input) — validates AC-02 and the threat R-08.
- [ ] `apps/web/test/import-holdings-dialog.test.tsx` — the dialog has labelled controls, is operable by keyboard and has no axe violations in English and Spanish — validates the accessibility rule of the web app.

**Completion criterion**
`pnpm --filter @pesly/web exec vitest run test/import-holdings-dialog.test.tsx test/investments-container-import.test.tsx` passes and `pnpm lint` passes.

## Block 7 — Fixture, benchmark and end-to-end flow

**Files**
- `apps/web/test/fixtures/balanz-holdings.xlsx` (new) — the sample workbook, which carries no personal data inside (verified: the sheet has only tickers and amounts; the file name is not kept).
- `apps/web/test/perf/balanz-import.perf.test.ts` (new) — the NFR-01 benchmark.
- `apps/web/e2e/investments-import.spec.ts` (new) — the Playwright flow.

**Logic**
- The benchmark builds 1,000 rows in memory, runs the pure parser and `planHoldingsImport`, and asserts it finishes in < 5 s; it runs under `pnpm test:perf`.
- The end-to-end flow signs in, creates a portfolio, adds `AAPL` by hand, imports the fixture, sees the preview (2 to create, 1 to remove), switches SPY to USD, cancels (portfolio unchanged), imports again, switches SPY to USD and confirms (the portfolio shows IBIT in ARS and SPY in USD with source "import" and no AAPL), then uploads a PDF and sees the rejection.

**Error handling**
- The flow uses a unique email per run and waits for visible text, never for fixed time.

**Required tests**
- [ ] `apps/web/test/perf/balanz-import.perf.test.ts` — 1,000 rows parse and plan in < 5 s — validates NFR-01.
- [ ] `apps/web/e2e/investments-import.spec.ts` — cancel at the preview leaves the portfolio unchanged, confirm leaves exactly the file's holdings — validates AC-02, AC-03 and AC-04.
- [ ] `apps/web/e2e/investments-import.spec.ts` — a PDF upload is rejected with its reason and the portfolio is unchanged (invalid input) — validates AC-05 and AC-07.

**Completion criterion**
`pnpm test:perf` passes the benchmark and `pnpm e2e` passes `investments-import.spec.ts`.

## Final verification
- Every FR, NFR and AC of the PRD is covered by the table and by named tests.
- `pnpm lint`, `pnpm typecheck`, `pnpm test:coverage` (80% floor) and `pnpm e2e` pass; no test calls an external service.
- `pnpm audit --prod --audit-level high` reports nothing new: `package.json` and `pnpm-lock.yaml` are unchanged.
- The file never leaves the browser: no API route, queue entry, log line or storage entry carries it.
- The parent index `prd-DISC-001-07.md` marks 07c as done once merged.

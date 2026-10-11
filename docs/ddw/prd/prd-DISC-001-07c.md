# PRD DISC-001-07c: Balanz Holdings Excel Import

| Field | Value |
|-------|-------|
| Ticket | DISC-001-07c |
| Tracker | none |
| Date | 2026-10-10 |
| PRD loops | 3 |
| Loops since last human decision | 0 |

## Context and Problem
Third sub-ticket of Investments (parent index: `prd-DISC-001-07.md`). Typing every holding by hand
is slow for users who hold many instruments at Balanz. Balanz has no public API for client
holdings (verified 2026-09-25), and storing broker credentials or scraping was rejected, but it
lets clients export their holdings as an Excel file (.xlsx) and a PDF. The first version of this
PRD assumed a CSV export; the real export, received on 2026-10-10, is an `.xlsx` workbook, so the
sub-ticket now imports that file (user decision, 2026-10-10). The anonymized sample is the workbook
`[MisInstrumentos][com…][cuo…][…][20261010]_[…].xlsx`: one sheet, "Mis Instrumentos", with one row
per instrument and the columns Ticker, Tipo de Instrumento, Descripcion, Nominales, Garantias,
Precio, Fecha, Porcentaje de tenencia, Precio promedio de compra, Valor actual, Valor inicial,
Rendimiento, Variacion (%) and Porcentaje de rendimiento. The sheet has no currency column and the
only sample holds CEDEARs priced in pesos, so the user chooses the currency of each holding (ARS or
USD) in the preview. Split from `prd-DISC-001-07.md` (2026-10-01,
user decision). Requirement IDs were renumbered; the parent index maps every original ID to its new
one.

## Goals
- Import holdings from the broker's Excel export, without ever storing broker credentials.
- Never keep the uploaded file.

## Functional Requirements
- FR-01: The system must allow a user to import a Balanz holdings Excel (.xlsx) file into one of
  their portfolios.
- FR-02: The system must show a preview of the holdings read from the file before applying the
  import.
- FR-03: The system must replace all holdings of the target portfolio with the holdings of the
  file when the user confirms the import, taking the total cost of every holding from the file's
  "Valor inicial" column.
- FR-04: The system must reject the whole import, applying no change, when the file is not a
  valid Balanz holdings Excel file.
- FR-05: The system must not keep the uploaded file after the import is applied or cancelled.
- FR-06: The system must allow the user to choose ARS or USD as the valuation currency of each
  holding in the preview, ARS by default.
- FR-07: The system must accept every instrument type of the file, mapping the type to one of the
  instrument types of PRD 07a and using "other" for a type it does not recognize.

## Non-Functional Requirements
- NFR-01: An import of an Excel file of up to 1 MB and 1,000 rows must produce its preview in
  < 5 s.
- NFR-02: 0 uploaded files must remain in any storage after an import is applied or cancelled.
- NFR-03: A file whose uncompressed content exceeds 10 MB must be rejected before it is parsed
  in full (compressed-file bomb protection).

## Acceptance Criteria
- AC-01 (FR-01): WHEN a user uploads a Balanz holdings Excel file for a portfolio, THE system
  SHALL read its holdings.
- AC-02 (FR-02): WHEN the file has been read, THE system SHALL show the holdings it will create,
  update and remove, before any change is applied.
- AC-03 (FR-03): WHEN a user confirms an import, THE system SHALL leave the portfolio with exactly
  the holdings of the file, with unit prices of source "import" and the total cost of each holding
  equal to the file's "Valor inicial".
- AC-04 (FR-03): WHEN a user cancels an import at the preview, THE system SHALL leave the
  portfolio unchanged.
- AC-05 (FR-04): IF the uploaded file is not a valid Balanz holdings Excel file, THEN THE system
  SHALL reject it with the reason and leave the portfolio unchanged.
- AC-06 (FR-05): WHEN an import is applied or cancelled, THE system SHALL delete the uploaded
  file.
- AC-07 (FR-04): IF the uploaded file is a CSV, a PDF or an Excel file without the "Mis
  Instrumentos" sheet and its header columns, THEN THE system SHALL reject it with the reason and
  leave the portfolio unchanged.
- AC-08 (NFR-03): IF the uncompressed content of the uploaded file exceeds 10 MB, THEN THE system
  SHALL reject it before parsing it in full and leave the portfolio unchanged.
- AC-09 (FR-06): WHEN the preview is shown, THE system SHALL show every holding in ARS and allow
  changing each one to USD before the import is confirmed.
- AC-10 (FR-07): WHEN the file has a holding of type "Cedears", THE system SHALL import it as a
  CEDEAR, and WHEN its type is not recognized, THE system SHALL import it as "other" and show that
  type in the preview.

## Out of Scope
- Storing broker credentials, scraping, or any login on behalf of the user (concept decision).
- Importing PDF or CSV files (PDF parsing is fragile; the real export is Excel); only `.xlsx`.
- Importing the Balanz results report (`resultados_por_info_completa`), which lists purchase lots;
  lot-level cost is a different data model and a future PRD.
- Importing from brokers other than Balanz (a future PRD per broker).
- Official broker API integrations (IOL, others) — candidate for a future PRD.

## Risks and Mitigations
- **The Balanz Excel format may change** → the importer sits behind one adapter and validates the
  sheet name and header columns; an unknown format is rejected whole, never partially applied
  (FR-04, AC-07).
- **The sheet has no currency column and there is a single sample** → the user chooses ARS or USD
  per holding in the preview (FR-06); a wrong choice is visible before confirming and editable
  afterwards (PRD 07a FR-04).
- **Instrument type names other than "Cedears" are unverified** → unknown types import as "other"
  and are shown in the preview (FR-07); the user can correct the type later.
- **Excel cells hold decimals** (for example an average price of 9119.47561304) → decimals are
  read as text and converted to integer minor units with the shared money helpers, never through
  floating point (AGENTS.md).
- **An .xlsx is a zip: a hostile file can expand enormously** → the file is read in the browser
  with `read-excel-file`, already a dependency of the web app for the credit card statement import
  (no new dependency); size and uncompressed-size limits (NFR-03, AC-08); formulas and macros in
  cells are never evaluated.
- **An import deletes holdings the user added by hand** → the preview lists what will be removed
  before confirming (AC-02); manual holdings belong in a separate portfolio.
- **Uploaded broker files contain sensitive data** (the sample's file name carries the account
  holder and account numbers) → files are deleted after the import (FR-05, NFR-02); the file name
  is never stored or logged.

## Dependencies
- DISC-001-07a (Portfolios, Holdings and Manual Valuation) — portfolios, holdings and prices
  (merged).
- Balanz holdings Excel export — FR-01, FR-04. The anonymized sample is available (received
  2026-10-10) and becomes a test fixture with the name and account numbers removed.

## Decision Log
- 2026-09-25: Balanz exports PDF and CSV (user); import CSV only.
- 2026-09-25: User approved: import replaces the portfolio after preview keeping manual costs,
  uploaded file deleted. Pending before PLAN: anonymized Balanz CSV sample.
- 2026-10-01: Split from DISC-001-07 (user decision). Blocked until the sample file exists.
- 2026-10-10: The real Balanz holdings export is an `.xlsx` workbook, not a CSV. User decision:
  change the sub-ticket to import the `.xlsx`. Unblocked; NFR-03, AC-07 and AC-08 added; a new
  parser dependency is to be justified in the spec.
- 2026-10-10: PLAN found that `read-excel-file` is already a dependency of the web app and that the
  statement import parses in the browser; 07c reuses it, so no new dependency is added and the file
  never reaches the API. The "new parser dependency" notes above are withdrawn.
- 2026-10-10: Human decisions on the spec: (1) holdings may be ARS or USD, chosen per holding in the
  preview, ARS by default, because no sample shows how Balanz marks the currency; (2) every
  instrument type is accepted, unknown ones as "other"; (3) the total cost always comes from the
  file's "Valor inicial", with no keep-the-old-cost rule. FR-03 and AC-03 changed; FR-06, FR-07,
  AC-09 and AC-10 added.

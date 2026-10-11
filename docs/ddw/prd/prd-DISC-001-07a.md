# PRD DISC-001-07a: Portfolios, Holdings and Manual Valuation

| Field | Value |
|-------|-------|
| Ticket | DISC-001-07a |
| Tracker | none |
| Date | 2026-10-01 |
| PRD loops | 2 |
| Loops since last human decision | 0 |

## Context and Problem
First sub-ticket of Investments (parent index: `prd-DISC-001-07.md`). Users of the finance PWA
(see `docs/ddw/discovery/concept-DISC-001.md`) hold investments — stocks, CEDEARs, bonds, mutual
funds (FCI), fixed-term deposits, crypto — mostly through a broker such as Balanz. Without them,
the app cannot show real net worth. Balanz has no public API for client holdings (verified
2026-09-25), and storing broker credentials or scraping was rejected (concept decision: a breach
would expose the user's brokerage account). This sub-ticket delivers manual entry: portfolios,
holdings, manual prices, valuation and gain or loss. Automatic crypto prices and daily snapshots
come in DISC-001-07b; the Balanz Excel import in DISC-001-07c. Split from `prd-DISC-001-07.md`
(2026-10-01, user decision). Requirement IDs were renumbered; the parent index maps every original
ID to its new one.

## Goals
- Let users record their investment holdings by hand, grouped in portfolios (one per broker or
  wallet).
- Show each holding's value and, when the cost is known, its gain or loss.
- Show every price's source and age so a stale valuation is never presented as current.

## Functional Requirements
- FR-01: The system must allow a user to create a portfolio with a name (for example "Balanz" or
  "Binance").
- FR-02: The system must allow a user to add a holding to a portfolio with an instrument ticker,
  an instrument name, an instrument type, a quantity greater than 0, a valuation currency (ARS
  or USD) and an optional total cost.
- FR-03: The system must offer exactly these instrument types: stock, CEDEAR, bond, mutual fund,
  fixed-term deposit, crypto and other.
- FR-04: The system must allow a user to edit the quantity, total cost and valuation currency of
  a holding.
- FR-05: The system must allow a user to delete a holding.
- FR-06: The system must allow a user to set a manual unit price for a holding.
- FR-07: The system must store with every unit price its source (import, manual or automatic) and
  its date and time.
- FR-08: The system must compute the value of a holding as its quantity multiplied by its latest
  unit price, in its valuation currency.
- FR-09: The system must compute the gain or loss of a holding with a total cost as its value
  minus its total cost, in amount and in percentage.
- FR-10: The system must show the total value of each portfolio per currency.
- FR-11: The system must show, for every holding whose latest price is older than 7 days, the
  date of that price.
- FR-12: The system must let a user read, edit and delete only their own portfolios and holdings.
- FR-13: The system must allow a user to delete a portfolio together with all its holdings.
- FR-14: The system must require USD as the valuation currency of every crypto holding.
- FR-15: The system must show no value and no gain or loss for a holding that has no latest
  price, mark it as "price needed", and exclude it from the portfolio totals.
- FR-16: The system must show, for every portfolio, the number of its holdings without a latest
  price.
- FR-17: The system must clear the latest unit price of a holding when the user changes its
  valuation currency, leaving the user to re-enter the total cost in the new currency.
- FR-18: The system must keep the ticker unique within a portfolio, ignoring letter case, and
  must merge a holding added with a ticker that already exists in that portfolio into the existing
  holding by summing the quantities and summing the total costs, keeping the existing price.
- FR-19: The system must reject the addition, merging nothing, when the valuation currency of the
  holding being added differs from that of the existing holding with the same ticker.
- FR-20: The system must leave the total cost empty when a merge combines holdings of which at
  least one has no total cost.

## Non-Functional Requirements
- NFR-01: Amounts must be stored as 64-bit integers in minor units, with 0 floating-point columns
  or fields for money (concept decision).
- NFR-02: Quantities must be stored as integers scaled by 10^8 (8 decimal places, enough for
  crypto), with 0 floating-point columns or fields for quantities.
- NFR-03: The portfolio screen must answer in < 500 ms at p95 for a user with 10 portfolios and
  500 holdings, measured server-side.

## Acceptance Criteria
- AC-01 (FR-01): WHEN a user creates a portfolio named "Balanz", THE system SHALL store it and
  show it in the investments screen.
- AC-02 (FR-02): WHEN a user adds a holding "AAPL", CEDEAR, 10 units, ARS, with a total cost of
  150,000.00 ARS, THE system SHALL store it in the portfolio.
- AC-03 (FR-02): IF a user adds a holding with a quantity of 0 or less, THEN THE system SHALL
  reject it.
- AC-04 (FR-03): WHEN a user opens the holding form, THE system SHALL offer exactly the types
  stock, CEDEAR, bond, mutual fund, fixed-term deposit, crypto and other.
- AC-05 (FR-04): WHEN a user changes the quantity of a holding from 10 to 15, THE system SHALL
  persist it and recompute its value.
- AC-06 (FR-05): WHEN a user deletes a holding, THE system SHALL remove it and recompute the
  portfolio total.
- AC-07 (FR-06): WHEN a user sets a manual unit price of 18,500.00 ARS on a holding, THE system
  SHALL use it as the holding's latest price with source "manual".
- AC-08 (FR-06): IF a user sets a manual unit price of 0 or less, THEN THE system SHALL reject it.
- AC-09 (FR-07): WHEN a user opens a holding, THE system SHALL show the source and the date and
  time of its latest price.
- AC-10 (FR-08): WHEN a holding has 10 units and a latest unit price of 18,500.00 ARS, THE system
  SHALL show a value of 185,000.00 ARS.
- AC-11 (FR-09): WHEN a holding with a total cost of 150,000.00 ARS has a value of 185,000.00
  ARS, THE system SHALL show a gain of 35,000.00 ARS and 23.33%.
- AC-12 (FR-09): WHILE a holding has no total cost, THE system SHALL show no gain or loss for it.
- AC-13 (FR-10): WHEN a portfolio has holdings valued at 185,000.00 ARS, 15,000.00 ARS and 500.00
  USD, THE system SHALL show totals of 200,000.00 ARS and 500.00 USD.
- AC-14 (FR-11): WHILE the latest price of a holding is older than 7 days, THE system SHALL show
  the date of that price next to the holding.
- AC-15 (FR-12): IF a user requests to read, edit or delete a portfolio or holding owned by
  another user, THEN THE system SHALL answer 404 Not Found and leave it unchanged.
- AC-16 (FR-12): WHEN a user opens the investments screen, THE system SHALL show only portfolios
  they own.
- AC-17 (FR-13): WHEN a user deletes a portfolio, THE system SHALL remove it and all its holdings
  and SHALL not change any account balance.
- AC-18 (FR-14): IF a user adds or edits a crypto holding with ARS as valuation currency, THEN THE
  system SHALL reject it.

- AC-19 (FR-15): WHILE a holding has no latest price, THE system SHALL show "price needed"
  instead of its value and SHALL show no gain or loss for it.
- AC-20 (FR-15): WHEN a portfolio has one holding valued at 185,000.00 ARS and one holding
  without a latest price, THE system SHALL show a total of 185,000.00 ARS.
- AC-21 (FR-16): WHILE a portfolio has 2 holdings without a latest price, THE system SHALL show
  "2 holdings without price" for that portfolio.
- AC-22 (FR-17): WHEN a user changes the valuation currency of a holding that has a latest
  price, THE system SHALL clear that price and show the holding as "price needed".
- AC-23 (FR-18): WHEN a user adds "aapl", 5 units, ARS, with a total cost of 50,000.00 ARS to a
  portfolio that holds "AAPL", 10 units, ARS, with a total cost of 150,000.00 ARS and a price of
  18,500.00 ARS, THE system SHALL leave one holding with 15 units, a total cost of 200,000.00 ARS
  and the price of 18,500.00 ARS, without an error.
- AC-24 (FR-19): IF a user adds a holding whose ticker already exists in the portfolio with a
  different valuation currency, THEN THE system SHALL reject it with a validation error and
  SHALL leave the existing holding unchanged.
- AC-25 (FR-20): WHEN a merge combines a holding with a total cost and a holding without one,
  THE system SHALL leave the merged holding with no total cost.

## Out of Scope
- Automatic crypto prices and the daily portfolio value snapshot (DISC-001-07b).
- Importing holdings from a broker file (DISC-001-07c).
- Storing broker credentials, scraping, or any login on behalf of the user (concept decision).
- Automatic prices for stocks, CEDEARs, bonds and mutual funds (no free, reliable, documented
  source verified; IOL's API requires an IOL client account and BYMA's APIs are commercial).
- Recording individual buy/sell operations, dividends, coupons or fees.
- Performance metrics beyond simple gain/loss (TWR, IRR, benchmarks).
- Linking investment purchases to account movements.
- Tax reports.

## Risks and Mitigations
- **Stale valuations presented as current** → price source and date on every holding (FR-07),
  date highlighted after 7 days (FR-11).
- **Rounding errors in value and percentage** → all arithmetic on integers through the shared
  money helpers (NFR-01, NFR-02).

## Dependencies
- DISC-001-01a (Email & Password Authentication) — sessions, ownership and access control
  (FR-12).
- PRD 03 (Movements & Exchange Rates) — rates used when totals are shown converted (PRD 09); not
  needed by this sub-ticket.

## Decision Log
- 2026-09-25: No broker credentials or scraping; manual entry + broker report import (concept).
- 2026-09-25: User approved: portfolios, positions only (no operations), price date shown after 7
  days, crypto valued in USD.
- 2026-10-01: Split from DISC-001-07 (user decision).
- 2026-10-01: User decision: a holding without a latest price shows "price needed", no gain or
  loss, is excluded from portfolio totals, and the portfolio shows how many holdings lack a price
  (FR-15, FR-16).
- 2026-10-01: User decision: changing the valuation currency of a priced holding clears its
  latest price; the user re-enters the total cost (FR-17).
- 2026-10-01: User decision: ticker is unique per portfolio, case-insensitive; adding an existing
  ticker merges into the existing holding, summing quantity and total cost and keeping the
  existing price (FR-18).
- 2026-10-01: User decision (confirmed after the defaults were proposed): (a) a merge across
  different valuation currencies is rejected, nothing merged (FR-19); (b) a merge where at least
  one holding has no total cost leaves the total cost empty, so no misleading gain or loss is
  shown (FR-20); (c) a merge keeps the existing instrument name and type, which FR-04 does not
  edit.

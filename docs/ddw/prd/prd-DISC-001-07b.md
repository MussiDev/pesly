# PRD DISC-001-07b: Crypto Prices and Daily Portfolio Snapshots

| Field | Value |
|-------|-------|
| Ticket | DISC-001-07b |
| Tracker | none |
| Date | 2026-10-02 |
| PRD loops | 2 |
| Loops since last human decision | 0 |

## Context and Problem
Second sub-ticket of Investments (parent index: `prd-DISC-001-07.md`). Holdings entered in
DISC-001-07a only carry the prices users type in. For crypto a reliable free source exists
(CoinGecko), so those holdings can stay current without user effort. A user who typed a price on
purpose must never see it replaced behind their back, but must be told when the market has moved
away from it. Separately, the dashboard (PRD 09) needs the history of each portfolio's value, which
has to be recorded every day.
Split from `prd-DISC-001-07.md` (2026-10-01, user decision). Requirement IDs were renumbered; the
parent index maps every original ID to its new one.

## Goals
- Keep crypto holdings valued with automatic prices (decision 2026-09-25), without ever replacing
  a price the user set manually.
- Tell the user when a manual crypto price is far from the market, and let them go back to the
  automatic price in one action.
- Record every day the total value of each portfolio, for historical charts (PRD 09).

## Functional Requirements
- FR-01: The system must fetch the USD price of every crypto holding from the crypto price
  provider and use it as the unit price of every crypto holding that does not carry a manual price.
- FR-02: The system must store once a day, at the end of the day in the user's time zone (PRD 01,
  FR-24), the total value of each portfolio per currency, for historical charts (PRD 09).
- FR-03: The system must store the latest market price of each crypto ticker, with its date,
  separately from the unit prices of holdings, on every successful refresh, including for
  holdings that carry a manual price.
- FR-04: The system must never replace a manual unit price with an automatic one.
- FR-05: The system must show a warning on a crypto holding with a manual unit price when its
  stored market price differs from the manual unit price by more than 5% in either direction,
  measured relative to the manual unit price, whatever the age of the market price. The warning
  states that the price is manual, that the market price has changed and what the market price is,
  in the user's language (PRD 01, FR-26): when the market price is at most 24 hours old it says
  that the holding is worth that price today, and when it is older it says that on the market
  price's date the holding was worth that price, with the date in the user's locale and time
  zone (PRD 01, FR-24).
- FR-06: The system must let a user switch a crypto holding from its manual price back to the
  automatic price, which sets its unit price to the stored market price with source "automatic".

## Non-Functional Requirements
- NFR-01: Crypto prices must be refreshed every 60 minutes, using at most 1,000 provider calls
  per month (the free CoinGecko Demo plan allows 10,000).
- NFR-02: The background worker must start and keep running when the provider API key is absent
  (0 startup failures caused by a missing key).

## Acceptance Criteria
- AC-01 (FR-01): WHEN a scheduled crypto price refresh succeeds, THE system SHALL update the unit
  price of every crypto holding that has no manual price with source "automatic".
- AC-02 (FR-01): IF the crypto price provider fails or has no price for a ticker, THEN THE system
  SHALL keep the previous price of the affected holdings.
- AC-03 (FR-02): WHEN a day ends in the user's time zone, THE system SHALL store the total value
  of each portfolio per currency for that day.
- AC-04 (FR-02): IF the total value of a portfolio in a currency exceeds 9,223,372,036,854,775,807
  minor units, THEN THE system SHALL skip that portfolio's snapshot for that day, log the failure
  and keep taking the snapshots of the other portfolios.
- AC-05 (FR-03, FR-04): WHEN a refresh succeeds and a crypto holding carries a manual unit price
  of 60,000.00 USD, THE system SHALL keep that unit price and source "manual" and SHALL store the
  new market price of its ticker.
- AC-06 (FR-04): IF a refresh and a manual price change run at the same time on one holding, THEN
  THE system SHALL keep the manual price.
- AC-07 (FR-05): WHILE a crypto holding has a manual unit price of 60,000.00 USD and a market
  price of 64,000.00 USD from 3 hours ago (6.67% above), THE system SHALL show the warning saying
  that the holding is worth 64,000.00 USD today.
- AC-08 (FR-05): WHILE a crypto holding has a manual unit price of 60,000.00 USD and a market
  price of 56,000.00 USD from 3 hours ago (6.67% below), THE system SHALL show the warning saying
  that the holding is worth 56,000.00 USD today.
- AC-09 (FR-05): WHILE a crypto holding has a manual unit price of 60,000.00 USD and a market
  price of 63,000.00 USD or 57,000.00 USD (exactly 5% away), THE system SHALL show no warning.
- AC-10 (FR-05): WHILE a crypto holding has an automatic or imported unit price, THE system SHALL
  show no warning.
- AC-11 (FR-05): WHILE a crypto holding has a manual unit price of 60,000.00 USD and a market
  price of 64,000.00 USD set 2 days ago, THE system SHALL show the warning saying that on that
  date, in the user's locale and time zone, the holding was worth 64,000.00 USD, and SHALL NOT say
  "today".
- AC-12 (FR-06): WHEN a user switches a warned crypto holding back to the automatic price, THE
  system SHALL set its unit price to the stored market price with source "automatic" and the
  date of that market price, and the warning SHALL disappear.
- AC-13 (FR-06): IF a user requests the switch for a holding that is not crypto or has no stored
  market price, THEN THE system SHALL reject the request and change nothing.
- AC-14 (FR-06): IF a user requests the switch for a holding owned by another user or that does
  not exist, THEN THE system SHALL answer not found.
- AC-15 (NFR-02): WHEN the worker starts without the provider API key, THE system SHALL start the
  worker and run the refresh without the key.
- AC-16 (FR-05): WHILE the stored market price of a manually priced crypto holding is 30 days old
  and differs from the manual unit price by more than 5%, THE system SHALL show the warning.

## Out of Scope
- Automatic prices for stocks, CEDEARs, bonds and mutual funds (no free, reliable, documented
  source verified; IOL's API requires an IOL client account and BYMA's APIs are commercial).
- Charts and converted totals (PRD 09).
- Official broker API integrations (IOL, others) — candidate for a future PRD.
- A finer price scale for crypto priced below 1 cent (recorded as a follow-up in the parent index):
  until then a coin priced below 1 cent is not priced automatically and keeps its previous price.
- Choosing a specific coin when several coins share a ticker: the top-ranked coin of the symbol is
  used (risk accepted by the owner, 2026-10-02).

## Risks and Mitigations
- **CoinGecko's free plan changes or disappears** → prices sit behind one adapter; failures keep
  the last price (AC-02); usage stays at 10% of the free quota (NFR-01).
- **A manual price silently drifts far from the market** → the market price is stored separately
  (FR-03) and a warning with a one-action fix is shown past 5% (FR-05, FR-06).
- **A ticker shared by several coins prices the wrong coin** → accepted by the owner
  (2026-10-02); the source and date stay visible on every holding (07a FR-07).

## Dependencies
- DISC-001-07a (Portfolios, Holdings and Manual Valuation) — holdings, prices and portfolio
  totals.
- CoinGecko API, Demo plan (free, 100 calls/min, 10,000 calls/month) — FR-01, NFR-01.
- PRD 01 (Identity & Access) — user time zone (FR-02), bilingual interface (FR-05).
- PRD 09 (Dashboard & Reports) — consumer of daily portfolio values (FR-02).

## Decision Log
- 2026-09-25: Automatic prices where a reliable free source exists (crypto via CoinGecko); last
  import or manual price for the rest.
- 2026-09-25: User approved: daily portfolio value snapshot; crypto valued in USD.
- 2026-09-25: User decision: per-user time zone, mandatory. Dates and scheduled times are
  computed in the user's time zone (PRD 01, FR-24).
- 2026-10-01: Split from DISC-001-07 (user decision).
- 2026-10-02: Owner decision: the holding's ticker is used as the CoinGecko symbol, taking the
  top-ranked coin per symbol; the risk of a wrong coin for a shared ticker is accepted.
- 2026-10-02: Owner decision: keep the 1-cent floor for automatic prices now (coins below 1 cent
  keep their previous price); a follow-up ticket "finer price scale for sub-cent crypto" is
  recorded in the parent index.
- 2026-10-02: Owner decision (changes the earlier reading): an automatic price never overwrites a
  manual one. The refresh still stores the market price separately for manually priced holdings.
  The web warns when it differs from the manual price by more than 5% in either direction and
  offers to switch back to the automatic price. Interpretation recorded here: the 5% is measured
  relative to the manual price and exactly 5% gives no warning (the age rule first recorded here
  was replaced the same day, see the next entries).
- 2026-10-02: Owner decision: a portfolio total above the 64-bit limit skips that day's snapshot
  of that portfolio, the failure is logged and the app keeps working.
- 2026-10-02: Owner decision: the provider API key is optional; the worker must boot without it.
- 2026-10-02: Owner decision (replaces the 7-day cutoff first proposed): the divergence warning is
  never hidden because of the age of the market price. Its wording depends on that age: within the
  last 24 hours it says the holding is worth the market price today, older it says that on the
  market price's date it was worth that price, with the date in the user's locale and time zone.
- 2026-10-02: Owner accepted: a rejected switch reuses the existing validation error, and the
  provider's per-request symbol limit is verified against the live documentation during
  implementation.

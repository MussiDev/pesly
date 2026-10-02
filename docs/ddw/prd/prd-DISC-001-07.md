# Parent PRD: Investments

| Metric | Value |
|--------|-------|
| Ticket | DISC-001-07 |
| Date | 2026-10-01 |
| Status | Split |

## Sub-tickets

| Sub-ticket | Title | PRD | Dependencies | Status |
|---|---|---|---|---|
| DISC-001-07a | Portfolios, Holdings and Manual Valuation | prd-DISC-001-07a.md | depends on DISC-001-01a (on main) | done — merges when its PR merges (draft PR; migration 0013) |
| DISC-001-07b | Crypto Prices and Daily Portfolio Snapshots | prd-DISC-001-07b.md | depends on a | active — next; branches off main after 07a merges |
| DISC-001-07c | Balanz Holdings CSV Import | prd-DISC-001-07c.md | depends on a | blocked — needs an anonymized Balanz CSV sample |

## Suggested implementation order
a → b → c (c can start only once the sample file exists)

## Follow-ups (not yet PRDs)

- Finer price scale for sub-cent crypto (recorded 2026-10-02, owner decision in DISC-001-07b):
  unit prices are stored in cents, so coins priced below 1 cent cannot be priced automatically
  and keep their previous price. Needs a finer price scale, which changes DISC-001-07a's
  contracts and storage. Depends on b.

## Original context
PRD 07 of discovery DISC-001 defined investments for the finance PWA: portfolios (one per broker
or wallet), manually entered holdings, automatic crypto prices through CoinGecko, import of the
Balanz holdings CSV export, valuation with gain or loss, and a daily snapshot of portfolio values
for the dashboard (PRD 09). No broker credentials are stored and nothing is scraped (concept
decision). With 21 functional requirements and 27 acceptance criteria across four separable areas
(holdings and valuation, crypto prices, daily snapshots, file import) it was too large for one
ticket, and the CSV format is still unconfirmed, so it was split on 2026-10-01 (user decision).
The full original text is in git history (file `docs/ddw/prd/prd-DISC-001-07.md` before the split,
last present at commit 72b5732 and earlier).

## Traceability: original ID → sub-ticket ID

Other PRDs of DISC-001 reference this PRD as "PRD 07, FR-xx"; use this table to resolve them.

| Original | Now |
|---|---|
| FR-01 | DISC-001-07a FR-01 |
| FR-02 | DISC-001-07a FR-02 |
| FR-03 | DISC-001-07a FR-03 |
| FR-04 | DISC-001-07a FR-04 |
| FR-05 | DISC-001-07a FR-05 |
| FR-06 | DISC-001-07a FR-06 |
| FR-07 | DISC-001-07b FR-01 |
| FR-08 | DISC-001-07a FR-07 |
| FR-09 | DISC-001-07a FR-08 |
| FR-10 | DISC-001-07a FR-09 |
| FR-11 | DISC-001-07a FR-10 |
| FR-12 | DISC-001-07c FR-01 |
| FR-13 | DISC-001-07c FR-02 |
| FR-14 | DISC-001-07c FR-03 |
| FR-15 | DISC-001-07c FR-04 |
| FR-16 | DISC-001-07c FR-05 |
| FR-17 | DISC-001-07b FR-02 |
| FR-18 | DISC-001-07a FR-11 |
| FR-19 | DISC-001-07a FR-12 |
| FR-20 | DISC-001-07a FR-13 |
| FR-21 | DISC-001-07a FR-14 |
| NFR-01 | DISC-001-07a NFR-01 |
| NFR-02 | DISC-001-07a NFR-02 |
| NFR-03 | DISC-001-07b NFR-01 |
| NFR-04 | DISC-001-07c NFR-01 |
| NFR-05 | DISC-001-07c NFR-02 |
| NFR-06 | DISC-001-07a NFR-03 |
| AC-01 | DISC-001-07a AC-01 |
| AC-02 | DISC-001-07a AC-02 |
| AC-03 | DISC-001-07a AC-03 |
| AC-04 | DISC-001-07a AC-04 |
| AC-05 | DISC-001-07a AC-05 |
| AC-06 | DISC-001-07a AC-06 |
| AC-07 | DISC-001-07a AC-07 |
| AC-08 | DISC-001-07a AC-08 |
| AC-09 | DISC-001-07b AC-01 |
| AC-10 | DISC-001-07b AC-02 |
| AC-11 | DISC-001-07a AC-09 |
| AC-12 | DISC-001-07a AC-10 |
| AC-13 | DISC-001-07a AC-11 |
| AC-14 | DISC-001-07a AC-12 |
| AC-15 | DISC-001-07a AC-13 |
| AC-16 | DISC-001-07c AC-01 |
| AC-17 | DISC-001-07c AC-02 |
| AC-18 | DISC-001-07c AC-03 |
| AC-19 | DISC-001-07c AC-04 |
| AC-20 | DISC-001-07c AC-05 |
| AC-21 | DISC-001-07c AC-06 |
| AC-22 | DISC-001-07b AC-03 |
| AC-23 | DISC-001-07a AC-14 |
| AC-24 | DISC-001-07a AC-15 |
| AC-25 | DISC-001-07a AC-16 |
| AC-26 | DISC-001-07a AC-17 |
| AC-27 | DISC-001-07a AC-18 |

Requirements DISC-001-07a FR-15..FR-20 and AC-19..AC-25 have no original ID: they record decisions
the user took on 2026-10-01, after the split, for cases the original PRD left open (holdings
without a price, currency change, duplicate tickers).

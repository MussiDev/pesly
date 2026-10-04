# Parent PRD: Movements & Exchange Rates

| Metric | Value |
|--------|-------|
| Ticket | DISC-001-03 |
| Date | 2026-10-02 |
| Status | Split |

## Sub-tickets

| Sub-ticket | Title | PRD | Dependencies | Status |
|---|---|---|---|---|
| DISC-001-03a | Exchange Rates, Store and Sync | prd-DISC-001-03a.md | PRD 01 (sessions); no code dependency on the open branches | done: draft PR #18, merges when the PR merges, after 07a (0008) if that lands first (migration 0012; its journal `when` 1790945403578 must stay greater than main's maximum, re-check before merging); #15 (02b, 0009), #16 (01f, 0010) and #17 (FEAT-003, 0011) are already merged and this branch is rebased on them |
| DISC-001-03b | Expense and Income | prd-DISC-001-03b.md | depends on a (merged, #18); DISC-001-02b is merged into main (#15), so that condition is met (decision 2, resolved) | done: draft PR #20, migration 0014 `0014_movements`, journal `when` 1790966184307 must stay greater than main's maximum at merge time; next: 03c and 03d |
| DISC-001-03c | Transfers and Currency Exchange | prd-DISC-001-03c.md | depends on b (merged, #20) | done: draft PR #25, migration `0016_transfers_exchanges` (journal idx 16, `when` 1790991879498) on top of main's `0015_price_snapshots` (07b merged); 03d takes 0017 after it and must keep its `when` above this one; its rollback is destructive for transfer and exchange rows; next: 03d and 03e |
| DISC-001-03d | Tags and Filters | prd-DISC-001-03d.md | depends on b; DISC-001-02b merged | done: draft PR #26 (merges when the PR merges), migration `0017_tags` (journal idx 17, `when` 1790992572883) on top of main's `0016_transfers_exchanges`; keep its `when` above main's maximum at merge; its rollback drops every tag and tag link; next: 03e |
| DISC-001-03e | Edit and Delete Movements | prd-DISC-001-03e.md | depends on b, c and d (all merged: #20, #25, #26) | done: draft PR #27 (merges when the PR merges), no migration, so there is no journal `when` to keep above main's maximum; adds the project `README.md` as a user-requested extra outside the PRD; this was the last sub-ticket of DISC-001-03 |

## Suggested implementation order
a → b → (c and d, independent of each other) → e

## Pending decisions (not resolved in the sub-PRDs; original wording kept)
1. RESOLVED (2026-10-02, human decision relayed by the orchestrator): **user deletion versus
   restricting keys.** The keys from movements to accounts and categories keep `ON DELETE RESTRICT`;
   deleting a user erases that user's movements FIRST through an ordered erasure step plus the
   DISC-001-01f guard's `policy` value, both added by DISC-001-03b, which also proves the PostgreSQL
   ordering with a test in its PLAN. Original analysis kept below for the record.
   (Was: human decision pending, for DISC-001-03b's PLAN.)
   DISC-001-02a and DISC-001-02b require movements to reference accounts and categories with
   `ON DELETE RESTRICT`, while DISC-001-01f deletes a user through `ON DELETE CASCADE` and its
   erasure guard fails on any foreign key in the graph that is not `CASCADE`. PostgreSQL checks
   `RESTRICT` immediately, not at the end of the statement, so a user deletion that cascades to
   accounts can fail depending on the order of the cascade (to be proven by a test in PLAN).
   Recommended: keep `RESTRICT` and add an ordered erasure step that deletes the user's movements
   before the `users` row, with the guard's `policy` value (the path 01f's spec already
   anticipates). Alternative: `NO ACTION` on `account_id` and `category_id`, simpler but a
   departure from the wording of 02a and 02b, and it still trips the guard.
2. RESOLVED (2026-10-02, human decision relayed by the orchestrator): **DISC-001-02b merge
   order.** DISC-001-03b waits for 02b to be merged into main; no stacking. Original note: movements need the categories table
   (kind check, subcategories) and the real `CategoryUsage` adapter. Recommended: DISC-001-03b
   starts its PLAN after 02b is merged. 03a does not depend on it.
3. RESOLVED (2026-10-02, human decision relayed by the orchestrator): **no stored rate yet.** The
   entry form requires a manual rate, which is frozen on the movement with source "manual"; to be
   folded into DISC-001-03b's FR-04, FR-05 and ACs at its DEFINE. Original note: the original FR-07 does not
   say what an expense or income form prefills when no rate has ever been stored (first run with
   the provider down). Options: block the save, require a manual rate, or use a seeded value.
   Recommended: require a manual rate.
4. RESOLVED (2026-10-02, checked once with a plain GET of `https://dolarapi.com/v1/dolares`):
   "tarjeta" has both `compra` and `venta` like the other six types, so FR-01 of DISC-001-03a
   (buy and sell of each of the 7 types) holds as written. The adapter must still treat a missing
   buy price as a failed refresh rather than store a partial set.
5. **Rate age: which timestamp** (found while splitting; for DISC-001-03b's DEFINE). The provider
   reports a per-type `fechaActualizacion` that can be a day old for oficial and tarjeta, even when
   the refresh ran a minute ago. The original AC-18 shows "the age of the latest stored rate"
   without saying whether that is the provider's timestamp or the time of our refresh.
   DISC-001-03a stores and returns both, so either answer needs no change there.
6. RESOLVED (2026-10-02, human decision relayed by the orchestrator): **implied rate rounding** is
   half-up, `(ars*20000 + usd) / (2*usd)` on bigint, the same rule as `parseScaledRate`; folded into
   DISC-001-03c FR-03 and AC-14. Original note: the original FR-05 divides the ARS amount by the USD
   amount and stores 4 decimals; it does not say how a division that does not end in 4 decimals is
   rounded.

## Added while splitting (not in the original text)
The three DISC-001-03a additions (FR-03, AC-04, AC-05) were ACCEPTED by the human on 2026-10-02.
Each is derived from an obligation or convention already on record; none changes an original
requirement.

| New ID | What | Why |
|---|---|---|
| 03a FR-03, AC-03, AC-04, AC-05 | Read endpoint for the latest stored rates | the original FR-07 and FR-11 need the rates readable, and a ticket that only writes rates cannot be shipped or tested alone |
| 03a NFR-03 | 0 provider calls in the request path of any user request | generalizes the original NFR-07 beyond the movement save |
| 03b FR-12, AC-18, AC-19 | Refuse to delete an account or category with movements | DISC-001-02a AC-10 and DISC-001-02b AC-10 deferred their end-to-end behavior to PRD 03 |
| 03b NFR-06 | Account list with balances < 300 ms p95 at 100 accounts and 100,000 movements | DISC-001-02a NFR-02 deferred the real-table perf test to PRD 03 |
| 03b NFR-07, 03c NFR-04, 03d NFR-04, 03e NFR-04 | Every query filtered by the owner | AGENTS.md rule and PRD 01 FR-23 |
| 03c FR-05, AC-07 | Future-date rule for transfers and exchanges | the original FR-20 covers every movement |
| 03c FR-06, AC-08 | Transfers and exchanges appear in the list | the original FR-15 covers every movement |
| 03c AC-09 | Foreign account on a transfer answers 404 | AGENTS.md rule: data that is not the user's answers 404 |
| 03d AC-06 | Tag length sad path | applies the original NFR-08 |
| 03d AC-07 | Filters never reveal another user's data | AGENTS.md rule |
| 03e FR-04, AC-04, AC-05 | Future date and non-positive amount rejected on edit | applies the original FR-20 and AC-02 to edits |
| 03e NFR-03 | Edit and delete < 300 ms p95 | extends the original NFR-04 (saving) to edit and delete |

## Added while defining DISC-001-03c (not in the original text)
Each applies a rule of DISC-001-03b to transfers and exchanges by human decision (2026-10-02).

| New ID | What | Why |
|---|---|---|
| 03c FR-07, AC-10 | Archived source or destination account rejected (409 ACCOUNT_ARCHIVED) | applies 03b FR-15 |
| 03c FR-08, AC-11, AC-12 | Amount at most 10^15 minor units, note at most 500 characters | applies the 03b caps |
| 03c FR-09, AC-13 | 60 creations per minute per user, shared with expenses and income | applies the 03b creation limit |
| 03c AC-14, AC-15 | Half-up rounding example; implied rate outside 0.0001 to 10,000,000.0000 rejected (400) | decision 6 and the stored-rate range |

## Added while defining and planning DISC-001-03b (not in the original text)
Each is derived from an obligation, a convention or a human decision on record (2026-10-02).

| New ID | What | Why |
|---|---|---|
| 03b FR-13, AC-22, AC-23 | Ordered erasure of a user's movements | human decision: keep ON DELETE RESTRICT and erase movements first (DISC-001-01f guard) |
| 03b FR-14, AC-24 | Movements count in Available and Net worth | FEAT-003 totals with the real AccountMovements adapter |
| 03b FR-15, AC-25 to AC-27 | A movement on an archived account or category is rejected | human decision Q2 |
| 03b FR-16, NFR-08, AC-28 to AC-30 | 60 manual creations per minute per user, counters in the database, imports not counted | human decision Q4 |
| 03b AC-31 and the timestamp in FR-01, FR-02, FR-08, FR-09 | A movement stores date and time (UTC instant, shown in the user's time zone) | human decision Q3 |
| 03b design: caps and read route | Amount at most 10^15 minor units, note at most 500 characters, `RATE_REQUIRED` is a 400, `GET /movements/:id` exists | human decision Q3 (confirmed) |

## Future tickets noted
- **Movement import (for example from Excel):** no PRD covers it yet. It must create movements through the application use case without going through the manual-entry limit of DISC-001-03b (FR-16, AC-30).

## Deferred obligations discharged by this split
- DISC-001-02a (deferred to PRD 03): AC-10 end to end, the history half of AC-07, NFR-01 and NFR-02
  against the real table, and a foreign key from movements to accounts with `ON DELETE RESTRICT`
  (DISC-001-03b).
- DISC-001-02b (deferred to PRD 03): AC-05, AC-06 and AC-10 end to end, and a foreign key from
  movements to categories with `ON DELETE RESTRICT` (DISC-001-03b).
- DISC-001-01f: its erasure guard needs a registry entry for the movements tables (pending
  decision 1).

## Original context
PRD 03 of discovery DISC-001 defined movements (expenses, income, transfers and currency exchanges)
and the market exchange rates that every movement freezes. With 21 functional requirements, 8
non-functional requirements and 32 acceptance criteria, three modules and an external provider, it
was too large for one ticket, so it was split on 2026-10-02 (user decision). The full original text
is in git history (file `docs/ddw/prd/prd-DISC-001-03.md` before the split).

## Traceability: original ID → sub-ticket ID

Other PRDs of DISC-001 reference this PRD as "PRD 03, FR-xx"; use this table to resolve them. A row
with two entries means the original requirement was divided.

| Original | Now |
|---|---|
| FR-01 | DISC-001-03b FR-01 (tags: DISC-001-03d FR-01) |
| FR-02 | DISC-001-03b FR-02 (tags: DISC-001-03d FR-01) |
| FR-03 | DISC-001-03c FR-01 |
| FR-04 | DISC-001-03c FR-02 |
| FR-05 | DISC-001-03c FR-03 |
| FR-06 | DISC-001-03b FR-03 |
| FR-07 | DISC-001-03b FR-04 |
| FR-08 | DISC-001-03b FR-05 |
| FR-09 | DISC-001-03b FR-06 |
| FR-10 | DISC-001-03a FR-01 |
| FR-11 | DISC-001-03a FR-02 (use the last stored rates) and DISC-001-03b FR-11 (show the age) |
| FR-12 | DISC-001-03b FR-07 (expense, income) and DISC-001-03c FR-04 (transfer, exchange) |
| FR-13 | DISC-001-03e FR-01 |
| FR-14 | DISC-001-03e FR-02 |
| FR-15 | DISC-001-03b FR-08 (expenses, income) and DISC-001-03c FR-06 (transfers, exchanges) |
| FR-16 | DISC-001-03d FR-03 |
| FR-17 | DISC-001-03d FR-04 |
| FR-18 | DISC-001-03d FR-01 |
| FR-19 | DISC-001-03d FR-02 |
| FR-20 | DISC-001-03b FR-09, DISC-001-03c FR-05 and DISC-001-03e FR-04 |
| FR-21 | DISC-001-03b FR-10 (read) and DISC-001-03e FR-03 (edit, delete) |
| NFR-01 | DISC-001-03b NFR-01, DISC-001-03c NFR-01, DISC-001-03e NFR-01 |
| NFR-02 | DISC-001-03a NFR-01, DISC-001-03b NFR-02, DISC-001-03c NFR-02, DISC-001-03e NFR-02 |
| NFR-03 | DISC-001-03a NFR-02 |
| NFR-04 | DISC-001-03b NFR-03, DISC-001-03c NFR-03, DISC-001-03e NFR-03 |
| NFR-05 | DISC-001-03d NFR-01 |
| NFR-06 | DISC-001-03b NFR-04, DISC-001-03d NFR-02 |
| NFR-07 | DISC-001-03a NFR-03 and DISC-001-03b NFR-05 |
| NFR-08 | DISC-001-03d NFR-03 |
| AC-01 | DISC-001-03b AC-01 |
| AC-02 | DISC-001-03b AC-02 |
| AC-03 | DISC-001-03b AC-03 |
| AC-04 | DISC-001-03b AC-04 |
| AC-05 | DISC-001-03b AC-05 |
| AC-06 | DISC-001-03c AC-01 |
| AC-07 | DISC-001-03c AC-02 |
| AC-08 | DISC-001-03c AC-03 |
| AC-09 | DISC-001-03c AC-04 |
| AC-10 | DISC-001-03c AC-05 |
| AC-11 | DISC-001-03b AC-06 |
| AC-12 | DISC-001-03b AC-07 |
| AC-13 | DISC-001-03b AC-08 |
| AC-14 | DISC-001-03b AC-09 |
| AC-15 | DISC-001-03b AC-10 |
| AC-16 | DISC-001-03a AC-01 |
| AC-17 | DISC-001-03a AC-02 |
| AC-18 | DISC-001-03b AC-11 |
| AC-19 | DISC-001-03b AC-12 |
| AC-20 | DISC-001-03b AC-13 |
| AC-21 | DISC-001-03c AC-06 |
| AC-22 | DISC-001-03e AC-01 |
| AC-23 | DISC-001-03e AC-02 |
| AC-24 | DISC-001-03b AC-14 |
| AC-25 | DISC-001-03d AC-01 |
| AC-26 | DISC-001-03d AC-02 |
| AC-27 | DISC-001-03d AC-03 |
| AC-28 | DISC-001-03d AC-04 |
| AC-29 | DISC-001-03d AC-05 |
| AC-30 | DISC-001-03b AC-15 (copied to DISC-001-03c AC-07 and DISC-001-03e AC-04) |
| AC-31 | DISC-001-03b AC-16 (read) and DISC-001-03e AC-03 (edit, delete) |
| AC-32 | DISC-001-03b AC-17 |

# Spec FEAT-015: Unpaid card statements as pending, not as this month's expenses

| Field | Value |
|-------|-------|
| Ticket | FEAT-015 |
| PRD | docs/ddw/prd/prd-FEAT-015.md |
| Tier | FEATURE |
| Date | 2026-11-01 |
| Spec loops | 0 |
| Loops since last human decision | 0 |

## Summary

The installment and card purchase flow rows gain the card id, so a row can be matched to its
statement (card, period, currency). The dashboard's card statement source returns every stored
statement that still owes money (no seven-day horizon; the agenda already applies its own horizon)
with its period. `GetDashboard` reads it once and hands the same promise to the agenda and the
month. The month flows split the current month's card rows into those of statements that owe money
(pending) and the rest (expenses). The response's month gains `pendingCard`. The web shows a
"Pending on cards" line under the month cards. No migration, no new route, no new dependency.

## Coverage: PRD → blocks

| Requirement | Covered by |
|---|---|
| FR-01, FR-05 | Block 2 |
| FR-02, FR-03, FR-06 | Block 2, Block 3 |
| FR-04 | Block 1 |
| FR-07, FR-08 | Block 4 |
| NFR-01 | Block 2 (`GetDashboard` reads once) |
| NFR-02 | All blocks |
| NFR-03 | Block 4 (catalog parity test) |

## Block 1 — Flow rows and owed statements

- `apps/api/src/reports/application/ports/flow-reader.ts`: `InstallmentFlowRow` gains `cardId`;
  `CardPurchaseFlowRow` inherits it.
- `apps/api/src/reports/infrastructure/db/drizzle-flow-reader.ts`: both reads select and group by the
  card id. Consumers that sum rows are unaffected (rows only split further).
- `apps/api/src/dashboard/domain/agenda.ts`: `DueStatement` gains `period`.
- `apps/api/src/dashboard/application/ports/card-statement-source.ts`: `dueStatements` becomes
  `owedStatements` — every stored statement that owes money in at least one currency, any due date.

## Block 2 — Month flows

- `apps/api/src/dashboard/domain/pending-card.ts` (new): `pendingKeys(statements)` → map of
  `cardId|period|currency` to due date for each currency with `owed > 0`.
- `build-month-flows.ts`: takes the owed statements; a card row placed in the current month whose key
  is pending goes to the pending bucket instead of the entries. The bucket is converted with
  `convertRows(…, 'count')`; the result has `pendingCard: { amount, nextDueDate, unconvertedCount }`.
  Previous and history months are unchanged.
- `get-dashboard.ts`: `statements: CardStatementSource` moves to the top-level dependencies; one read
  shared by `buildAgenda` and `buildMonthFlows`.

## Block 3 — Contract

- `packages/shared/src/dashboard/dashboard.ts`: `dashboardMonthSchema.pendingCard` =
  `{ amount: exactIntegerString, nextDueDate: localDate | null, unconvertedCount: int ≥ 0 }`.
- `present-dashboard.ts` serializes it.

## Block 4 — Web

- Dashboard adapter maps `pendingCard`; a presentational `PendingCardNote` shows
  "Pending on cards: {amount} · due {date}" under the KPI cards when amount > 0 or the unconverted
  count > 0.
- `CardPurchasesNote` copy changes to the new rule (es/en).

## Tests

- Domain: `pendingKeys` (owed per currency, zero skipped).
- Use case: month flows with a pending statement, a paid one, a partly paid one, a mixed-currency one,
  an unconverted pending installment, an unpaid statement of a previous month.
- Integration: dashboard through the real database: import, pending, record payment, expense.
- Web: adapter mapping, note visible/hidden, catalogs.

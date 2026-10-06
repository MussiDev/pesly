# Parent PRD: Credit Cards: Statements & Installments

| Metric | Value |
|--------|-------|
| Ticket | DISC-001-10 |
| Date | 2026-10-06 |
| Status | Split |

## Sub-tickets

| Sub-ticket | Title | PRD | Dependencies | Status |
|---|---|---|---|---|
| DISC-001-10a | Cards, Linked Accounts and Statement Cycles | prd-DISC-001-10a.md | PRD 01, 02 and 03 (all merged); first to add a migration, number 0019 reserved | active |
| DISC-001-10b | Card Expenses and Statement Assignment | prd-DISC-001-10b.md | depends on a | pending |
| DISC-001-10c | Installment Purchases, Statement Totals and Pending Debt | prd-DISC-001-10c.md | depends on b | pending |
| DISC-001-10d | Statement Payments and Status | prd-DISC-001-10d.md | depends on c | pending |
| DISC-001-10e | Automatic Debit | prd-DISC-001-10e.md | depends on d; the scheduler is an open decision (PRD 08 is not built) | pending |
| DISC-001-10f | Statement Due-Date Reminders | prd-DISC-001-10f.md | PRD 08 (Recurring Payments & Reminders), which is not built | blocked: needs PRD 08 |

## Suggested implementation order
a → b → c → d → e, a chain: each one needs the one before it. f starts when PRD 08 is merged, and
needs only a besides PRD 08.

## Pending decisions (not resolved in the sub-PRDs)
1. **Budgets and reports consuming installments** (for DISC-001-10c's PLAN). The original FR-13
   makes each installment an expense of the purchase's category in the month of its statement's due
   date, "for reports (PRD 09) and budgets (PRD 06)". Neither is built. Recommended: 10c exposes
   the installments by category and month through the API and the movements model, and PRD 06 and
   PRD 09 consume them when they are built, each stating the integration in its own PRD.
   Alternative: 10c waits for PRD 06 and PRD 09.
2. **Reminder channels** (for DISC-001-10f). The original FR-20 sends the reminder "through the
   channels of PRD 08", which does not exist yet. Which channels exist, and how a reminder follows
   a due date edited after scheduling, are decided when PRD 08 is built and 10f starts.
3. **Scheduler of the automatic debit job** (for DISC-001-10e's PLAN). The original dependencies
   list PRD 08 for scheduling (NFR-03, now 10e NFR-02), but 10e must not wait for it. Recommended:
   a scheduled job inside the API, behind a port, replaceable by PRD 08's scheduler later.
   Alternative: block 10e on PRD 08.
4. **Release unit of 10a and the rest** (found while splitting). 10a creates cards and statements
   that nothing can use until 10b records expenses on them. Recommended: merge each sub-ticket to
   `main` as it finishes, but ship the card UI only with 10b. Alternative: release a to d together.

## Added while splitting (not in the original text)
Each addition is derived from an obligation or decision already on record in the original PRD;
none changes an original requirement. They await the human's acceptance with this split.

| New ID | What | Why |
|---|---|---|
| 10b FR-03, AC-05 | The statement total per currency shows the purchases only | the original FR-14 and AC-18 summed purchases and installments, and installments arrive in 10c; 10b needs its own requirement and criterion for the first half |
| 10c FR-06 | The total per currency of 10b also includes the installments assigned to the statement | the second half of the original FR-14; AC-18 stays here unchanged |
| 10b FR-02 (last clause) | The assignment rule applies again when a closing date changes | the original AC-06 required reassigning purchases, but no FR carried it; it belongs with the assignment rule |
| 10a AC-06 and 10b AC-04 | The original AC-06 divided into persisting the date (10a) and reassigning purchases (10b) | the original AC mixed two behaviors owned by different sub-tickets |
| 10a AC-10 and 10c AC-10 | The original AC-30 divided by what it reads: card or statement (10a), installment purchase (10c) | the original FR-22 covers entities that belong to different sub-tickets |
| 10f "Non-Functional Requirements: None" | A section without items | the original PRD set no NFR for FR-20 and the method requires the section; no number was invented |

## Original context
PRD 10 of discovery DISC-001 defined credit cards for the Argentine way of paying: monthly
statements with a closing and a due date, installments that land on future statements, ARS and
USD balances on the same card through two linked accounts, manual statement payments and optional
automatic debit. With 23 functional requirements, 5 non-functional requirements and 32 acceptance
criteria, it was too large for one ticket, so it was split on 2026-10-06 (user decision). The full
original text is in git history (file `docs/ddw/prd/prd-DISC-001-10.md` before the split). Its
Out of Scope items are spread over the sub-PRDs: credit limit, early cancellation of installments,
interest and USD installments, automatic interest, fees and taxes, group expenses in installments,
importing statements, additional and shared cards, minimum payment, and conversion of the USD
balance.

## Traceability: original ID → sub-ticket ID

Other PRDs of DISC-001 reference this PRD as "PRD 10, FR-xx"; use this table to resolve them. A row
with two entries means the original requirement was divided.

| Original | Now |
|---|---|
| FR-01 | DISC-001-10a FR-01 |
| FR-02 | DISC-001-10a FR-02 |
| FR-03 | DISC-001-10b FR-01 |
| FR-04 | DISC-001-10a FR-03 |
| FR-05 | DISC-001-10a FR-05 |
| FR-06 | DISC-001-10a FR-06 |
| FR-07 | DISC-001-10a FR-07 |
| FR-08 | DISC-001-10b FR-02 |
| FR-09 | DISC-001-10c FR-01 |
| FR-10 | DISC-001-10c FR-02 |
| FR-11 | DISC-001-10c FR-03 |
| FR-12 | DISC-001-10c FR-04 |
| FR-13 | DISC-001-10c FR-05 |
| FR-14 | DISC-001-10b FR-03 (purchases) and DISC-001-10c FR-06 (installments) |
| FR-15 | DISC-001-10c FR-07 |
| FR-16 | DISC-001-10d FR-01 |
| FR-17 | DISC-001-10d FR-02 |
| FR-18 | DISC-001-10e FR-01 |
| FR-19 | DISC-001-10e FR-02 |
| FR-20 | DISC-001-10f FR-01 |
| FR-21 | DISC-001-10c FR-08 |
| FR-22 | DISC-001-10a FR-08 (cards, statements) and DISC-001-10c FR-09 (installment purchases) |
| FR-23 | DISC-001-10a FR-04 |
| NFR-01 | DISC-001-10a, 10b, 10c, 10d and 10e NFR-01 (restated in each that stores money) |
| NFR-02 | DISC-001-10c NFR-02 |
| NFR-03 | DISC-001-10e NFR-02 |
| NFR-04 | DISC-001-10e NFR-03 |
| NFR-05 | DISC-001-10c NFR-03 |
| AC-01 | DISC-001-10a AC-01 |
| AC-02 | DISC-001-10a AC-02 |
| AC-03 | DISC-001-10a AC-03 |
| AC-04 | DISC-001-10b AC-01 |
| AC-05 | DISC-001-10a AC-04 |
| AC-06 | DISC-001-10a AC-06 (persist the date) and DISC-001-10b AC-04 (reassign purchases) |
| AC-07 | DISC-001-10a AC-07 |
| AC-08 | DISC-001-10a AC-08 |
| AC-09 | DISC-001-10a AC-09 |
| AC-10 | DISC-001-10b AC-02 |
| AC-11 | DISC-001-10b AC-03 |
| AC-12 | DISC-001-10c AC-01 |
| AC-13 | DISC-001-10c AC-02 |
| AC-14 | DISC-001-10c AC-03 |
| AC-15 | DISC-001-10c AC-04 |
| AC-16 | DISC-001-10c AC-05 |
| AC-17 | DISC-001-10c AC-06 |
| AC-18 | DISC-001-10c AC-07 (with installment; the purchases-only version is DISC-001-10b AC-05) |
| AC-19 | DISC-001-10c AC-08 |
| AC-20 | DISC-001-10d AC-01 |
| AC-21 | DISC-001-10d AC-02 |
| AC-22 | DISC-001-10d AC-03 |
| AC-23 | DISC-001-10d AC-04 |
| AC-24 | DISC-001-10e AC-01 |
| AC-25 | DISC-001-10e AC-02 |
| AC-26 | DISC-001-10e AC-03 |
| AC-27 | DISC-001-10e AC-04 |
| AC-28 | DISC-001-10f AC-01 |
| AC-29 | DISC-001-10c AC-09 |
| AC-30 | DISC-001-10a AC-10 (card, statement) and DISC-001-10c AC-10 (installment purchase) |
| AC-31 | DISC-001-10a AC-11 |
| AC-32 | DISC-001-10a AC-05 |

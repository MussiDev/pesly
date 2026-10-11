# Parent PRD: Savings Goals & Budgets

| Metric | Value |
|--------|-------|
| Ticket | DISC-001-06 |
| Date | 2026-10-11 |
| Status | Split |

## Sub-tickets

| Sub-ticket | Title | PRD | Dependencies | Status |
|---|---|---|---|---|
| DISC-001-06a | Savings Goals API | prd-DISC-001-06a.md | PRD 01, 02 and 03 (all merged); adds the first goal tables | PRD, spec and threat model written: branch `feat/DISC-001-06a-goals-api`; migration 0033 (journal `when` 1791770000000, to be checked again at merge); API only, no web screen; a linked goal cannot be unlinked or relinked after creation, a user holds at most 100 goals, and an account linked to a goal cannot be deleted (all awaiting the owner's confirmation); next: 06b |
| DISC-001-06b | Budgets Core API | not written yet | PRD 01 and 02; independent of 06a; migration 0034 (renumbered at merge) | budgets with categories (subcategories included), currency, rollover flag, alert thresholds, edit and delete, own budgets only; no spending yet |
| DISC-001-06c | Budget Spending and Rollover | not written yet | depends on 06b and on the 05b personal shares endpoint (`GET /groups/personal/shares`); PRD 03 frozen rates; large | spending per month (personal expenses and group shares, frozen rates, user time zone), remaining and percentage used, rollover; decision pending (parent decision 1) |
| DISC-001-06d | Budget Alerts | not written yet | depends on 06c and on the notices module (08c) | in-app alert through `notices` the first time a threshold is crossed in a month, within 5 s of the movement; touches the movements write path (parent decision 2) |
| DISC-001-06e | Goals Screens | not written yet | depends on 06a (API) and the api-client of 04e | goal list and detail, create and edit, contributions and withdrawals, progress, monthly amount needed, reached and overdue states |
| DISC-001-06f | Budgets Screens | not written yet | depends on 06b, 06c and 06d | budget list and detail, create and edit, spending bars, rollover and thresholds, in-app alerts |

## Suggested implementation order
a and b are independent and can run in parallel; b → c → d is a chain (spending needs budgets, alerts
need spending). e starts when a is merged; f starts when d is merged. Migration numbers: 06a 0033 and
06b 0034, both renumbered at merge against the `main` of that day, with the journal `when` above
`main`'s maximum.

## Pending decisions (not resolved in the sub-PRDs)
1. **Rollover: computed on the fly or stored as month snapshots (06c).** The original FR-19 adds the
   previous month's remaining amount to a budget with rollover on. Recommended: compute it on the fly
   from the movements of the previous month, so an edited or late movement fixes the rollover with no
   rewrite, at the cost of reading two months per budget (checked against NFR-02). Alternative: store a
   snapshot of each closed month, which is faster to read but needs a job and a rule for movements that
   change a closed month. Edits to a budget "with effect from the current month" (original FR-22) must
   leave past months unchanged, which favours snapshots of the amount only; decided at 06c's PLAN.
2. **How an alert is fired within 5 seconds (06d).** The original NFR-03 needs the alert soon after the
   movement is saved. Recommended: the movements write path calls a port after commit that evaluates
   the budgets of the movement's categories and publishes a notice through `notices`. Alternative: a
   worker job scanning every few seconds, which cannot meet 5 s without heavy polling. Group shares
   change the budget too (05b write paths); whether they also fire alerts is decided at 06d's PLAN.
3. **Release unit.** 06a creates goals that nothing can show until 06e. Recommended: merge each
   sub-ticket to `main` as it finishes and ship the goals UI with 06e. Alternative: hold 06a until 06e.
4. **Linked goals after creation.** The original text links a goal only when creating it (FR-02).
   06a keeps it that way: the link cannot be changed later. Alternative: allow relinking, which makes
   progress jump and needs a rule for manual contributions already recorded.

## Added while splitting (not in the original text)
Each addition is derived from an obligation or decision already on record in the original PRD; none
changes an original requirement. They await the human's acceptance with this split.

| New ID | What | Why |
|---|---|---|
| 06a FR-12 | Goals are read, edited and deleted only by their owner, split from the original FR-24 | the original FR-24 spans goals and budgets, owned by different sub-tickets |
| 06a FR-13, AC-23 | An account linked to a goal cannot be deleted | the original FR-02 links a goal to an account, and the progress would silently vanish if the account went |
| 06a FR-14, AC-24 | A user holds at most 100 goals | the original NFR-04 only sets a floor of 50; an upper bound keeps one user from growing the table without limit (same as the recurring payments limit) |
| 06a NFR-02 | The goal list answers in under 500 ms at p95 for 50 linked goals and 100,000 movements | the original NFR-02 covers the budgets screen only; linked goals read account balances over the same movements |
| 06a AC-17 to AC-22, AC-25, AC-26 | Sad-path and edge criteria for empty names, foreign accounts, contributions to linked goals, invalid amounts, negative linked balances, invalid edits, rounding and the user time zone | the project rule is that every input has a sad-path test; the original only covered some |

## Original context
PRD 06 of discovery DISC-001 defined savings goals (linked to an account or tracked with manual
contributions, with progress and the monthly amount needed) and monthly category budgets (ARS or USD,
subcategories included, only the user's share of group expenses, rollover of the remaining amount and
configurable in-app alerts) for the PWA. With 24 functional requirements, 5 non-functional requirements
and 34 acceptance criteria, it was too large for one ticket, so it was split on 2026-10-11 (user
decision). The full original text, including its Decision Log, is in git history (file
`docs/ddw/prd/prd-DISC-001-06.md` before the split). Its Out of Scope items are spread over the
sub-PRDs: weekly, yearly or custom budget periods, carrying overspending into the next month, group or
shared budgets, shared or group goals, push or email notifications (in-app only), zero-based and "Flex"
budgeting, automatic contributions to goals, moving money between budget categories and budgets over
income categories. The original decisions stand: goals linked to an account or tracked by manual
contributions; monthly budgets over one or more categories with 80% and 100% default thresholds; the
monthly amount counts the current month; no withdrawal beyond progress; edits effective from the current
month; up to 5 thresholds (1 to 200%); per-user time zone, mandatory.

## Traceability: original ID → sub-ticket ID

Other PRDs of DISC-001 reference this PRD as "PRD 06, FR-xx"; use this table to resolve them. A row
with several entries means the original requirement was divided. Sub-tickets not written yet keep the
original ID in their row; their numbers are assigned when each PRD is written.

| Original | Now |
|---|---|
| FR-01 | DISC-001-06a FR-01 |
| FR-02 | DISC-001-06a FR-02 |
| FR-03 | DISC-001-06a FR-03 |
| FR-04 | DISC-001-06a FR-04 |
| FR-05 | DISC-001-06a FR-05 |
| FR-06 | DISC-001-06a FR-06 |
| FR-07 | DISC-001-06a FR-07 |
| FR-08 | DISC-001-06a FR-08 |
| FR-09 | DISC-001-06a FR-09 |
| FR-10 | DISC-001-06a FR-10 |
| FR-11 | DISC-001-06a FR-11 |
| FR-12 | DISC-001-06b (original FR-12) |
| FR-13 | DISC-001-06b (original FR-13) |
| FR-14 | DISC-001-06c (original FR-14) |
| FR-15 | DISC-001-06c (original FR-15) |
| FR-16 | DISC-001-06c (original FR-16) |
| FR-17 | DISC-001-06c (original FR-17) |
| FR-18 | DISC-001-06b (original FR-18) |
| FR-19 | DISC-001-06c (original FR-19) |
| FR-20 | DISC-001-06b (original FR-20) |
| FR-21 | DISC-001-06d (original FR-21) |
| FR-22 | DISC-001-06b (original FR-22) |
| FR-23 | DISC-001-06b (original FR-23) |
| FR-24 | DISC-001-06a FR-12 (goals) and DISC-001-06b (budgets) |
| NFR-01 | DISC-001-06a NFR-01 and DISC-001-06b (restated in each that stores money) |
| NFR-02 | DISC-001-06c (budgets screen latency) |
| NFR-03 | DISC-001-06d (alert within 5 s) |
| NFR-04 | DISC-001-06a NFR-03 (goals) and DISC-001-06b (budgets) |
| NFR-05 | DISC-001-06b (thresholds) |
| AC-01 | DISC-001-06a AC-01 |
| AC-02 | DISC-001-06a AC-02 |
| AC-03 | DISC-001-06a AC-03 |
| AC-04 | DISC-001-06a AC-04 |
| AC-05 | DISC-001-06a AC-05 |
| AC-06 | DISC-001-06a AC-06 |
| AC-07 | DISC-001-06a AC-07 |
| AC-08 | DISC-001-06a AC-08 |
| AC-09 | DISC-001-06a AC-09 |
| AC-10 | DISC-001-06a AC-10 |
| AC-11 | DISC-001-06a AC-11 |
| AC-12 | DISC-001-06a AC-12 |
| AC-13 | DISC-001-06a AC-13 |
| AC-14 | DISC-001-06a AC-14 |
| AC-15 | DISC-001-06b (original AC-15) |
| AC-16 | DISC-001-06b (original AC-16) |
| AC-17 | DISC-001-06b (original AC-17) |
| AC-18 | DISC-001-06c (original AC-18) |
| AC-19 | DISC-001-06c (original AC-19) |
| AC-20 | DISC-001-06c (original AC-20) |
| AC-21 | DISC-001-06c (original AC-21) |
| AC-22 | DISC-001-06c (original AC-22) |
| AC-23 | DISC-001-06b (original AC-23) |
| AC-24 | DISC-001-06c (original AC-24) |
| AC-25 | DISC-001-06c (original AC-25) |
| AC-26 | DISC-001-06c (original AC-26) |
| AC-27 | DISC-001-06b (original AC-27) |
| AC-28 | DISC-001-06b (original AC-28) |
| AC-29 | DISC-001-06d (original AC-29) |
| AC-30 | DISC-001-06d (original AC-30) |
| AC-31 | DISC-001-06b (original AC-31) |
| AC-32 | DISC-001-06b (original AC-32) |
| AC-33 | DISC-001-06a AC-15 (goals) and DISC-001-06b (budgets) |
| AC-34 | DISC-001-06a AC-16 (goals) and DISC-001-06b (budgets) |

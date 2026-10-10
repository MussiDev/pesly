# Parent PRD: Groups & Expense Splitting

| Metric | Value |
|--------|-------|
| Ticket | DISC-001-05 |
| Date | 2026-10-10 |
| Status | Split |

## Sub-tickets

| Sub-ticket | Title | PRD | Dependencies | Status |
|---|---|---|---|---|
| DISC-001-05a | Groups, Members and Roles | prd-DISC-001-05a.md | PRD 01, 02 and 03 (all merged); first to add group tables (migration number assigned at PLAN) | pending |
| DISC-001-05b | Group Expenses and Splits | prd-DISC-001-05b.md | depends on a | pending |
| DISC-001-05c | Balances and Settlements | prd-DISC-001-05c.md | depends on b | pending |
| DISC-001-05d | Editing Rules and Activity Log | prd-DISC-001-05d.md | depends on b and c; unblocks DISC-001-04e | pending |

## Suggested implementation order
a → b → c → d, a chain: each one needs the one before it. DISC-001-04e (conflicts on group
movements) starts when d is merged.

## Pending decisions (not resolved in the sub-PRDs)
1. **Personal shares and receivables for reports and budgets.** Neither PRD 06 nor PRD 09 is built.
   Recommended: 05b exposes each member's personal shares and receivables through the API (as 10c
   did with `GET /credit-cards/installment-expenses`), and PRD 06 and PRD 09 consume them when they
   are built, each stating the integration in its own PRD. Alternative: 05b waits for PRD 06 and
   PRD 09.
2. **The last admin leaving or being removed.** The original text does not say what happens when no
   admin remains. Recommended: the last admin cannot leave while other members remain, and must
   promote someone first (decided at 05c's PLAN, which owns leaving). Alternative: promote the
   member who joined first automatically.
3. **Offline entry of group expenses.** Whether group expenses can be recorded offline, and how, is
   decided with DISC-001-04e after d. Until then the group expense screens are online only.
4. **Release unit.** 05a creates groups that nothing can use until 05b records expenses on them.
   Recommended: merge each sub-ticket to `main` as it finishes, but ship the group UI only with 05b.
   Alternative: release a to c together.

## Added while splitting (not in the original text)
Each addition is derived from an obligation or decision already on record in the original PRD; none
changes an original requirement. They await the human's acceptance with this split.

| New ID | What | Why |
|---|---|---|
| 05a FR-07, AC-12 | A claimed ghost member keeps its identity in the group | the original FR-07 transferred expenses, shares and settlements, which do not exist until 05b and 05c; keeping the member's identity lets each later ticket prove its own records follow |
| 05b FR-11, AC-21 and 05c FR-11, AC-21 | The original AC-08 divided by what follows the user: expenses and shares (05b), settlements (05c) | the original AC mixed records owned by different sub-tickets |
| 05b FR-12 and 05c FR-12 | Creation entries of the activity log are written where the record is created | the original FR-26 covers creation, edit and deletion; writing creation entries in 05d would leave expenses and settlements without log entries for two tickets |
| 05d FR-03, NFR-01 | Edits and deletions are logged in 05d, and the 100% rule is verified over every write path | the original NFR-06 spans all four sub-tickets |
| 05b NFR-02 | The shares of an expense add up to its amount exactly, tested over 10,000 random splits | the original NFR-02 (zero-sum balances) only holds if shares are exact; it moves to 05c as balances, and the exactness of the split is stated where splits are made |
| 05a AC-02, AC-07, AC-08, AC-10, AC-14, AC-16, AC-18 | Sad-path criteria for empty names, repeated invitations, the 50-member limit, claiming by a current member and non-admin actions | the project rule is that every input has a sad-path test; the original only covered some |
| 05b AC-03, AC-04, AC-06, AC-13, AC-16 | Sad-path and edge criteria for non-member splits, foreign categories, non-admin default split, leftover when the payer is not in the split, and ghost payers | same rule |
| 05c AC-04, AC-06, AC-07, AC-09, AC-10, AC-13, AC-17 | Sad-path and edge criteria for empty balances, invalid settlements, account currency mismatch, invalid manual rates and non-admin removal | same rule |
| 05d AC-02, AC-04, AC-06, AC-07, AC-11 | Criteria for admin edits, settlements, balance restoration, invalid edits and immutability of log entries | the original AC-32, AC-33 and AC-34 covered expenses and the log in general |

## Original context
PRD 05 of discovery DISC-001 defined groups and expense splitting for households and ad-hoc
groups in the PWA: split modes (equal, percentages, exact amounts), ghost members, balances per
currency with optional consolidation at settlement, and an immutable activity log. With 32
functional requirements, 6 non-functional requirements and 42 acceptance criteria, it was too large
for one ticket, so it was split on 2026-10-10 (user decision). The full original text, including its
Decision Log, is in git history (file `docs/ddw/prd/prd-DISC-001-05.md` before the split). Its Out
of Scope items are spread over the sub-PRDs: splitting by shares or weights, several payers, joint
accounts or a shared pot, payments through the app, recurring group expenses, comments and
reactions, receipt photos, notifications, automatic conversion of balances when the rate type
changes, and groups with more than 50 members.

## Traceability: original ID → sub-ticket ID

Other PRDs of DISC-001 reference this PRD as "PRD 05, FR-xx"; use this table to resolve them. A row
with several entries means the original requirement was divided.

| Original | Now |
|---|---|
| FR-01 | DISC-001-05a FR-01 |
| FR-02 | DISC-001-05b FR-02 |
| FR-03 | DISC-001-05a FR-03 |
| FR-04 | DISC-001-05a FR-04 |
| FR-05 | DISC-001-05a FR-05 |
| FR-06 | DISC-001-05a FR-06 |
| FR-07 | DISC-001-05a FR-07 (identity), DISC-001-05b FR-11 (expenses and shares) and DISC-001-05c FR-11 (settlements) |
| FR-08 | DISC-001-05a FR-08 |
| FR-09 | DISC-001-05c FR-08 |
| FR-10 | DISC-001-05c FR-09 |
| FR-11 | DISC-001-05b FR-01 |
| FR-12 | DISC-001-05b FR-03 |
| FR-13 | DISC-001-05b FR-04 |
| FR-14 | DISC-001-05b FR-05 |
| FR-15 | DISC-001-05b FR-06 |
| FR-16 | DISC-001-05b FR-07 |
| FR-17 | DISC-001-05b FR-08 |
| FR-18 | DISC-001-05b FR-09 |
| FR-19 | DISC-001-05c FR-01 |
| FR-20 | DISC-001-05c FR-02 |
| FR-21 | DISC-001-05c FR-03 |
| FR-22 | DISC-001-05c FR-04 |
| FR-23 | DISC-001-05c FR-05 |
| FR-24 | DISC-001-05c FR-06 |
| FR-25 | DISC-001-05d FR-01 and FR-02 |
| FR-26 | DISC-001-05b FR-12 and DISC-001-05c FR-12 (creation), DISC-001-05d FR-03 (edit and deletion) |
| FR-27 | DISC-001-05d FR-04 |
| FR-28 | DISC-001-05a FR-02 |
| FR-29 | DISC-001-05a FR-09 (change) and DISC-001-05c FR-07 (prefill on settlements) |
| FR-30 | DISC-001-05a FR-11, DISC-001-05b FR-13, DISC-001-05c FR-13 and DISC-001-05d FR-06 |
| FR-31 | DISC-001-05c FR-10 |
| FR-32 | DISC-001-05a FR-10 |
| NFR-01 | DISC-001-05b, 05c and 05d NFR-01 or NFR-02 (restated in each that stores money) |
| NFR-02 | DISC-001-05c NFR-02 |
| NFR-03 | DISC-001-05c NFR-03 |
| NFR-04 | DISC-001-05a NFR-01 |
| NFR-05 | DISC-001-05a NFR-02 |
| NFR-06 | DISC-001-05d NFR-01 |
| AC-01 | DISC-001-05a AC-01 |
| AC-02 | DISC-001-05b AC-05 |
| AC-03 | DISC-001-05a AC-04 |
| AC-04 | DISC-001-05a AC-05 |
| AC-05 | DISC-001-05a AC-06 |
| AC-06 | DISC-001-05a AC-09 |
| AC-07 | DISC-001-05a AC-11 |
| AC-08 | DISC-001-05a AC-12, DISC-001-05b AC-21 and DISC-001-05c AC-21 |
| AC-09 | DISC-001-05a AC-13 |
| AC-10 | DISC-001-05a AC-15 |
| AC-11 | DISC-001-05c AC-15 |
| AC-12 | DISC-001-05c AC-16 |
| AC-13 | DISC-001-05c AC-18 |
| AC-14 | DISC-001-05c AC-19 |
| AC-15 | DISC-001-05b AC-01 (store) and DISC-001-05c AC-02 (balances) |
| AC-16 | DISC-001-05b AC-02 |
| AC-17 | DISC-001-05b AC-07 |
| AC-18 | DISC-001-05b AC-09 |
| AC-19 | DISC-001-05b AC-08 |
| AC-20 | DISC-001-05b AC-11 |
| AC-21 | DISC-001-05b AC-12 |
| AC-22 | DISC-001-05b AC-14 |
| AC-23 | DISC-001-05b AC-15 |
| AC-24 | DISC-001-05b AC-17 |
| AC-25 | DISC-001-05b AC-18 |
| AC-26 | DISC-001-05c AC-01 |
| AC-27 | DISC-001-05c AC-03 |
| AC-28 | DISC-001-05c AC-05 |
| AC-29 | DISC-001-05c AC-08 |
| AC-30 | DISC-001-05c AC-11 |
| AC-31 | DISC-001-05c AC-12 |
| AC-32 | DISC-001-05d AC-01 and AC-05 |
| AC-33 | DISC-001-05d AC-03 |
| AC-34 | DISC-001-05b AC-22, DISC-001-05c AC-22 (creation), DISC-001-05d AC-08 and AC-09 (edit and deletion) |
| AC-35 | DISC-001-05d AC-10 |
| AC-36 | DISC-001-05a AC-03 |
| AC-37 | DISC-001-05a AC-20 |
| AC-38 | DISC-001-05a AC-17 (change) and DISC-001-05c AC-14 (prefill) |
| AC-39 | DISC-001-05a AC-21 (the other sub-tickets restate it for their own data) |
| AC-40 | DISC-001-05a AC-22 |
| AC-41 | DISC-001-05c AC-20 |
| AC-42 | DISC-001-05a AC-19 and DISC-001-05b AC-19 and AC-20 |

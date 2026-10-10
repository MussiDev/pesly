# PRD DISC-001-05c: Balances and Settlements

| Field | Value |
|-------|-------|
| Ticket | DISC-001-05c |
| Tracker | none |
| Date | 2026-10-10 |
| PRD loops | 0 |
| Loops since last human decision | 0 |

## Context and Problem
Third of four sub-tickets of Groups & Expense Splitting (parent index: `prd-DISC-001-05.md`). Once
expenses are recorded and split (DISC-001-05b), the group needs to answer "who owes whom". Balances
are kept per currency (ARS and USD separately); the system shows a simplified list of payments, and
members record settlements, optionally consolidating both currencies into one at the group's rate.
Settlements are neither expense nor income. Balances also decide who can leave or be removed, and
what happens to a member who deletes their account. Editing and deleting records and the activity
log reading are DISC-001-05d. Split from `prd-DISC-001-05.md` (2026-10-10, user decision).

## Goals
- Keep balances per currency, and allow consolidating them into one currency when settling.
- Minimize the number of transfers needed to settle a group.
- Never let a member leave or be removed while they owe or are owed.

## Functional Requirements
- FR-01: The system must show the balance of each member per currency (ARS and USD separately),
  updated by every group expense and settlement.
- FR-02: The system must show a simplified list of payments per currency that settles all balances
  with the minimum number of transfers.
- FR-03: The system must allow a member to record a settlement payment from one member to another
  in one currency.
- FR-04: The system must record a settlement paid or received by a registered member, when they
  choose one of their accounts, as a transfer out of or into that account that is neither an
  expense nor an income.
- FR-05: The system must allow two members to settle all their balances in a single currency,
  converting the other currency with the current rate of the group's default rate type.
- FR-06: The system must allow the members settling to replace the conversion rate of a
  consolidated settlement with a manual rate before recording it.
- FR-07: The system must prefill, on a consolidated settlement, the rate of the group's current
  default rate type.
- FR-08: The system must allow an admin to remove a member whose balance is 0 in every currency.
- FR-09: The system must allow a member whose balance is 0 in every currency to leave the group.
- FR-10: The system must replace a member who deletes their account with a ghost member named
  "Former member", keeping all of their group expenses, shares and settlements.
- FR-11: The system must attach to the registered user who claims a ghost member (DISC-001-05a)
  every settlement of that ghost member.
- FR-12: The system must add to the group activity log an entry for every creation of a settlement,
  with the member who did it and the date and time.
- FR-13: The system must allow only members of a group to read its balances or record its
  settlements.

## Non-Functional Requirements
- NFR-01: Amounts must be stored as 64-bit integers in minor units, with 0 floating-point columns
  or fields for money (concept decision).
- NFR-02: For every group and every currency, the sum of all member balances must be exactly 0
  after every operation, verified by an automated test over 10,000 random operations.
- NFR-03: The balance view of a group with 50 members and 10,000 expenses must answer in < 500 ms
  at p95, measured server-side.

## Acceptance Criteria
- AC-01 (FR-01): WHEN a member opens the group balances, THE system SHALL show each member's
  balance in ARS and in USD separately.
- AC-02 (FR-01): WHEN a group expense is recorded, THE system SHALL update the balances of the
  group in the expense currency only.
- AC-03 (FR-02): WHEN A owes B 100.00 ARS and B owes C 100.00 ARS, THE system SHALL show one
  simplified payment of 100.00 ARS from A to C.
- AC-04 (FR-02): WHEN all balances of a currency are 0, THE system SHALL show no payments for that
  currency.
- AC-05 (FR-03): WHEN a member records a settlement of 30,000.00 ARS from A to B, THE system SHALL
  reduce what A owes B in ARS by 30,000.00.
- AC-06 (FR-03): IF a member records a settlement of 0 or less, THEN THE system SHALL reject it.
- AC-07 (FR-03): IF a member records a settlement between two users who are not both members of the
  group, THEN THE system SHALL reject it.
- AC-08 (FR-04): WHEN a registered member records a settlement they received into one of their
  accounts, THE system SHALL add the amount to that account and SHALL not count it as an income.
- AC-09 (FR-04): WHEN a registered member records a settlement they paid from one of their
  accounts, THE system SHALL subtract the amount from that account and SHALL not count it as an
  expense.
- AC-10 (FR-04): IF a registered member chooses an account whose currency differs from the
  settlement currency, THEN THE system SHALL reject it.
- AC-11 (FR-05): WHEN A owes B 100.00 USD and B owes A 50,000.00 ARS and they settle in USD at a
  group rate of 1,000.0000 ARS per USD, THE system SHALL record one settlement of 50.00 USD from A
  to B and leave both balances at 0.
- AC-12 (FR-06): WHEN the members replace the conversion rate of a consolidated settlement with a
  manual rate greater than 0, THE system SHALL use that rate and store it with source "manual".
- AC-13 (FR-06): IF the members replace the conversion rate with a rate of 0 or less, THEN THE
  system SHALL reject it.
- AC-14 (FR-07): WHEN an admin has changed the group's default rate type, THE system SHALL prefill
  the new type's rate on the next consolidated settlement and leave existing records unchanged.
- AC-15 (FR-08): WHEN an admin removes a member whose balance is 0 in ARS and in USD, THE system
  SHALL remove that member from the group.
- AC-16 (FR-08): IF an admin tries to remove a member with a balance other than 0 in any currency,
  THEN THE system SHALL reject it and show the pending balance.
- AC-17 (FR-08): IF a member who is not an admin tries to remove another member, THEN THE system
  SHALL reject it.
- AC-18 (FR-09): WHEN a member with a balance of 0 in every currency leaves the group, THE system
  SHALL remove them from the group.
- AC-19 (FR-09): IF a member with a balance other than 0 in any currency tries to leave, THEN THE
  system SHALL reject it and show the pending balance.
- AC-20 (FR-10): WHEN a member deletes their account, THE system SHALL show a ghost member "Former
  member" in their place, with the same expenses, shares, settlements and balances.
- AC-21 (FR-11): WHEN a registered user claims a ghost member who has 2 settlements, THE system
  SHALL show that user those 2 settlements.
- AC-22 (FR-12): WHEN a settlement is created, THE system SHALL add a log entry with the action,
  the member and the date and time.
- AC-23 (FR-13): IF a user who is not a member of a group tries to read its balances or record a
  settlement, THEN THE system SHALL answer 404 Not Found.

## Out of Scope
- Editing and deleting settlements, and reading the activity log (DISC-001-05d).
- Payments between members through the app (Mercado Pago, bank transfers); settlements are only
  recorded.
- Converting existing balances automatically when the default rate type changes.
- Netting a ghost member's balance: a ghost member settles by someone recording the settlement for
  them.
- Rules for the last admin leaving a group; recorded as a pending decision in the parent index.
- How receivables and settlements appear in dashboards and reports (PRD 09).

## Risks and Mitigations
- **Disputes over the conversion rate when consolidating** → balances stay per currency until
  settlement (FR-01); consolidation is opt-in with an editable rate (FR-05, FR-06).
- **The group does not add up** → zero-sum invariant (NFR-02), on top of the deterministic leftover
  rule of DISC-001-05b.
- **The balance view is slow in large groups** → p95 target of 500 ms with 50 members and 10,000
  expenses (NFR-03).
- **Double counting in personal reports** → settlements are transfers, neither expense nor income
  (FR-04).
- **A deleted account breaks the group's history** → the member becomes a ghost "Former member" and
  the records stay (FR-10).

## Dependencies
- PRD 01 (Identity & Access) — account deletion (FR-10); merged.
- PRD 02 (Accounts & Categories) — the accounts a settlement moves money in or out of (FR-04);
  merged.
- PRD 03 (Movements & Exchange Rates) — transfers, stored rates and rate types (FR-04, FR-05, FR-06,
  FR-07); merged.
- DISC-001-05a (Groups, Members and Roles) — members, roles, default rate type.
- DISC-001-05b (Group Expenses and Splits) — the expenses that create the balances.
- Database migration: assigned at PLAN; its journal `when` must be greater than the maximum on
  `main` when it merges.

## Decision Log
- 2026-09-25: Balances per currency, with optional consolidation at settlement time using the
  group's rate, editable (original Decision Log).
- 2026-09-25: Settlements are neither expense nor income (original Decision Log).
- 2026-09-25: User approved leaving or removal only with 0 balance, simplified debts view and
  deleted accounts becoming "Former member" (original Decision Log).
- 2026-10-10: Parent PRD split into DISC-001-05a to 05d by user decision.
- 2026-10-10: The creation entry of the activity log for settlements is written here (FR-12), as
  for expenses in 05b. Listed in the parent index.

# PRD DISC-001-05b: Group Expenses and Splits

| Field | Value |
|-------|-------|
| Ticket | DISC-001-05b |
| Tracker | none |
| Date | 2026-10-10 |
| PRD loops | 0 |
| Loops since last human decision | 0 |

## Context and Problem
Second of four sub-tickets of Groups & Expense Splitting (parent index: `prd-DISC-001-05.md`). With
a group and its members in place (DISC-001-05a), members can now record shared expenses. One member
pays; the cost is divided among members equally, by percentages or by exact amounts, and the minor
units left over by the division are assigned by a fixed rule. The payer's own money leaves one of
their accounts, but only each member's share counts as their personal expense: the rest is a
receivable, which is neither an expense nor an income. Balances and settlements are
DISC-001-05c; editing, deleting and reading the activity log are DISC-001-05d. Split from
`prd-DISC-001-05.md` (2026-10-10, user decision).

## Goals
- Record a group expense with one payer and a split among members.
- Divide exactly: shares always add up to the amount, with a deterministic leftover rule.
- Reflect in each member's personal finances only their real share.

## Functional Requirements
- FR-01: The system must allow a member to record a group expense with an amount greater than 0, a
  currency (ARS or USD), a date, a payer (any member, including ghost members), a group category,
  a description and a split among members of the group.
- FR-02: The system must allow an admin to set a default split for the group (equal, or a
  percentage per member) that is prefilled on every new group expense.
- FR-03: The system must split an expense in equal parts among the selected members.
- FR-04: The system must split an expense by percentages per member that add up to exactly 100%.
- FR-05: The system must split an expense by exact amounts per member that add up to exactly the
  expense amount.
- FR-06: The system must assign the minor units left over by an equal or percentage split one by
  one to the members in the split, starting with the payer and then in order of joining the group.
- FR-07: The system must require a registered payer who records their own payment to choose one of
  their accounts in the expense currency, and must record the full amount as leaving that account
  (PRD 03).
- FR-08: The system must count the payer's own share as a personal expense and the rest of the
  amount as a receivable, not as a personal expense.
- FR-09: The system must count each non-payer registered member's share as a personal expense of
  that member, with no movement in any of their accounts.
- FR-10: The system must offer, on every new group expense, the current non-archived categories of
  the group.
- FR-11: The system must attach to the registered user who claims a ghost member (DISC-001-05a)
  every expense and share of that ghost member.
- FR-12: The system must add to the group activity log an entry for every creation of a group
  expense, with the member who did it and the date and time.
- FR-13: The system must allow only members of a group to read or record its expenses.

## Non-Functional Requirements
- NFR-01: Amounts must be stored as 64-bit integers in minor units, with 0 floating-point columns
  or fields for money (concept decision).
- NFR-02: For every group expense, the sum of its shares must equal its amount exactly, verified by
  an automated test over 10,000 random splits in each of the three split modes.

## Acceptance Criteria
- AC-01 (FR-01): WHEN a member records a group expense with all required fields and a valid split,
  THE system SHALL store it with its shares.
- AC-02 (FR-01): IF a member records a group expense with an amount of 0 or less, THEN THE system
  SHALL reject it.
- AC-03 (FR-01): IF a member records a group expense whose split includes a user who is not a
  member of the group, THEN THE system SHALL reject it.
- AC-04 (FR-01): IF a member records a group expense with a category that does not belong to the
  group, THEN THE system SHALL reject it.
- AC-05 (FR-02): WHEN an admin sets a default split of 60% / 40% for two members, THE system SHALL
  prefill that split on every new expense of the group.
- AC-06 (FR-02): IF a member who is not an admin tries to set the default split, THEN THE system
  SHALL reject it.
- AC-07 (FR-03): WHEN an expense of 40,000.00 ARS is split equally among 4 members, THE system
  SHALL assign 10,000.00 ARS to each.
- AC-08 (FR-04): WHEN an expense of 100,000.00 ARS is split 60% / 40%, THE system SHALL assign
  60,000.00 ARS and 40,000.00 ARS.
- AC-09 (FR-04): IF a member submits a percentage split that does not add up to exactly 100%, THEN
  THE system SHALL reject it and show the current total.
- AC-10 (FR-05): WHEN a member submits an exact-amount split that adds up to the expense amount,
  THE system SHALL assign those amounts to each member.
- AC-11 (FR-05): IF a member submits an exact-amount split that does not add up to the expense
  amount, THEN THE system SHALL reject it and show the difference.
- AC-12 (FR-06): WHEN an expense of 100.00 ARS is split equally among 3 members with the payer
  first, THE system SHALL assign 33.34 ARS to the payer and 33.33 ARS to each of the other two.
- AC-13 (FR-06): WHEN the payer is not in the split and an expense of 100.00 ARS is split equally
  among 3 members, THE system SHALL assign the leftover minor unit to the member who joined the
  group first.
- AC-14 (FR-07): WHEN a registered member records an expense of 40,000.00 ARS that they paid from
  one of their ARS accounts, THE system SHALL subtract 40,000.00 ARS from that account.
- AC-15 (FR-07): IF a registered payer recording their own payment chooses an account whose
  currency differs from the expense currency, THEN THE system SHALL reject it.
- AC-16 (FR-07): WHEN the payer of an expense is a ghost member, THE system SHALL record the
  expense without any movement in any account.
- AC-17 (FR-08): WHEN a registered member pays 40,000.00 ARS split equally among 4, THE system
  SHALL count 10,000.00 ARS as that member's personal expense and 30,000.00 ARS as a receivable.
- AC-18 (FR-09): WHEN another member pays an expense and a registered member's share is 10,000.00
  ARS, THE system SHALL count 10,000.00 ARS as that member's personal expense and SHALL not change
  any of their account balances.
- AC-19 (FR-10): WHEN an admin archives a group category, THE system SHALL not offer it on the next
  group expense.
- AC-20 (FR-10): WHEN an admin adds a group category, THE system SHALL offer it on the next group
  expense.
- AC-21 (FR-11): WHEN a registered user claims a ghost member who is the payer of 2 expenses and
  part of 3 splits, THE system SHALL show that user those 2 expenses and 3 shares.
- AC-22 (FR-12): WHEN a group expense is created, THE system SHALL add a log entry with the action,
  the member and the date and time.
- AC-23 (FR-13): IF a user who is not a member of a group tries to read or record its expenses,
  THEN THE system SHALL answer 404 Not Found.

## Out of Scope
- Balances, simplified debts and settlements (DISC-001-05c).
- Editing and deleting group expenses, and reading the activity log (DISC-001-05d).
- Updating the group balances after an expense: the data is stored here, the balance view is
  DISC-001-05c.
- Splitting by shares/weights ("2 parts for Juan"); equivalent results through percentages or exact
  amounts.
- Several payers for one expense.
- Recurring group expenses (PRD 08 covers personal recurring payments).
- Receipt photos, comments and reactions.
- Offline entry of group expenses and its conflicts (DISC-001-04e).
- How personal shares and receivables appear in dashboards and reports (PRD 09).

## Risks and Mitigations
- **Rounding makes the shares not add up** → deterministic leftover rule (FR-06) and the sum
  invariant (NFR-02).
- **Double counting in personal reports** → only the member's share is an expense; the receivable
  is neither expense nor income (FR-08, FR-09).
- **Expenses recorded in the name of a ghost member who never sees them** → accepted by decision;
  the activity log (FR-12, and DISC-001-05d) shows who recorded what, and claiming exposes the full
  history to the real person (FR-11).
- **Personal reports and budgets are not built** → this ticket exposes each member's shares and
  receivables through the API; PRD 06 and PRD 09 consume them when built (see the parent index,
  pending decision 1).

## Dependencies
- PRD 01 (Identity & Access) — registered users; merged.
- PRD 02 (Accounts & Categories) — the payer's accounts (FR-07); merged.
- PRD 03 (Movements & Exchange Rates) — account movements (FR-07); merged.
- DISC-001-05a (Groups, Members and Roles) — members, ghost members, categories and default rate
  type (FR-01, FR-02, FR-10, FR-11).
- Database migration: assigned at PLAN; its journal `when` must be greater than the maximum on
  `main` when it merges.

## Decision Log
- 2026-09-25: Split modes are equal, percentages and exact amounts (original Decision Log).
- 2026-09-25: Leftover minor units: the user questioned rounding and asked for exact splits. Exact
  splits are impossible with a minimum currency unit; options were high internal precision with
  rounding at settlement, a rotating leftover, or leftover to the payer first. User chose leftover
  to the payer first (original FR-15, now FR-06).
- 2026-09-25: The payer's account drops by the total; only each member's share counts as their
  expense; the rest is a receivable (original Decision Log).
- 2026-09-25: One payer per expense (original Decision Log).
- 2026-10-10: Parent PRD split into DISC-001-05a to 05d by user decision.
- 2026-10-10: The creation entry of the activity log is written here and not in 05d, so no expense
  exists without its entry. Listed in the parent index.

# PRD DISC-001-03c: Transfers and Currency Exchange

| Field | Value |
|-------|-------|
| Ticket | DISC-001-03c |
| Tracker | none |
| Date | 2026-10-02 |
| PRD loops | 1 |
| Loops since last human decision | 0 |

## Context and Problem
Third sub-ticket of Movements & Exchange Rates (parent index: `prd-DISC-001-03.md`). Money also
moves between a user's own accounts, and Argentine users buy and sell dollars all the time. Neither
is an expense nor an income (decision 2026-09-25), so both need their own movement types, and a
currency exchange needs its implied rate stored. Split from `prd-DISC-001-03.md` (2026-10-02, user
decision). Requirement IDs were renumbered; the parent index maps every original ID to its new one.

## Goals
- Move money between a user's own accounts of the same currency.
- Record buying and selling USD without counting it as spending or earning.
- Store the implied rate of every currency exchange.

## Functional Requirements
- FR-01: The system must allow a user to record a transfer of an amount greater than 0 between
  two different accounts of theirs with the same currency.
- FR-02: The system must allow a user to record a currency exchange: an amount taken out of one
  of their accounts in one currency and an amount put into one of their accounts in the other
  currency (decision 2026-09-25: buying/selling USD is not an expense nor an income).
- FR-03: The system must store on every currency exchange its implied rate, computed as the ARS
  amount divided by the USD amount, rounded half-up (a tie goes up) to 4 decimals, and must
  reject an implied rate outside 0.0001 to 10,000,000.0000 ARS per USD.
- FR-04: The system must subtract the source amount from the source account and add the
  destination amount to the destination account for every transfer and currency exchange.
- FR-05: The system must reject a transfer or currency exchange with a date later than the
  current day in the user's time zone (PRD 01, FR-24).
- FR-06: The system must list transfers and currency exchanges together with expenses and income,
  ordered by date, newest first.
- FR-07: The system must reject a transfer or currency exchange whose source or destination
  account is archived.
- FR-08: The system must reject a transfer or currency exchange with an amount greater than
  10^15 minor units or a note longer than 500 characters after trimming.
- FR-09: The system must limit the creation of transfers and currency exchanges to 60 per
  minute per user, counting the same creations as expenses and income.

## Non-Functional Requirements
- NFR-01: Amounts must be stored as 64-bit integers in minor units (1 unit = 0.01 ARS or 0.01
  USD), with 0 floating-point columns or fields for money.
- NFR-02: The implied rate must be stored as an integer scaled by 10,000 (4 decimal places), with
  0 floating-point columns or fields for rates.
- NFR-03: Saving a transfer or currency exchange must answer in < 300 ms at p95, measured
  server-side.
- NFR-04: Every transfer and currency exchange must belong to exactly one user, and 100% of
  queries on them must be filtered by the owner (PRD 01, FR-23).

## Acceptance Criteria
- AC-01 (FR-01): WHEN a user saves a transfer of an amount greater than 0 between two different
  accounts of theirs with the same currency, THE system SHALL store it.
- AC-02 (FR-01): IF a user saves a transfer whose source and destination are the same account or
  have different currencies, THEN THE system SHALL reject it.
- AC-03 (FR-02): WHEN a user saves a currency exchange of 1,557,300.00 ARS out of an ARS account
  and 1,000.00 USD into a USD account, THE system SHALL store it.
- AC-04 (FR-02): IF a user saves a currency exchange whose two accounts have the same currency,
  THEN THE system SHALL reject it.
- AC-05 (FR-03): WHEN a currency exchange of 1,557,300.00 ARS for 1,000.00 USD is saved, THE
  system SHALL store an implied rate of 1,557.3000 ARS per USD.
- AC-06 (FR-04): WHEN a transfer or currency exchange is saved, THE system SHALL subtract the
  source amount from the source account and add the destination amount to the destination
  account.
- AC-07 (FR-05): IF a user saves a transfer or currency exchange dated after the current day,
  THEN THE system SHALL reject it.
- AC-08 (FR-06): WHEN a user opens the movement list, THE system SHALL show their transfers and
  currency exchanges together with their expenses and income, ordered by date, newest first.
- AC-09 (FR-01): IF a user saves a transfer or currency exchange using an account owned by
  another user, THEN THE system SHALL answer 404 Not Found and store nothing.
- AC-10 (FR-07): IF a user saves a transfer or currency exchange whose source or destination
  account is archived, THEN THE system SHALL reject it with 409 ACCOUNT_ARCHIVED and store
  nothing.
- AC-11 (FR-08): IF a user saves a transfer or currency exchange with an amount greater than
  10^15 minor units, THEN THE system SHALL reject it.
- AC-12 (FR-08): IF a user saves a transfer or currency exchange with a note longer than 500
  characters after trimming, THEN THE system SHALL reject it.
- AC-13 (FR-09): IF a user saves a 61st transfer, currency exchange, expense or income within
  the same minute, THEN THE system SHALL answer 429 RATE_LIMITED and store nothing.
- AC-14 (FR-03): WHEN a currency exchange of 2,000.00 ARS for 3.00 USD is saved, THE system
  SHALL store an implied rate of 666.6667 ARS per USD.
- AC-15 (FR-03): IF the implied rate of a currency exchange is below 0.0001 or above
  10,000,000.0000 ARS per USD, THEN THE system SHALL reject it with 400 and store nothing.

## Out of Scope
- Expenses and income (DISC-001-03b).
- Tags and filters (DISC-001-03d); editing and deleting (DISC-001-03e).
- Fees or spread on an exchange as a separate movement.
- Currencies other than ARS and USD.
- Future-dated and recurring movements (PRD 08).
- Transfers between accounts of different users; groups settle debts instead (PRD 05).

## Risks and Mitigations
- **Rounding errors in the implied rate** → integer minor units and a scaled integer rate
  (NFR-01, NFR-02); a division that does not end in 4 decimals rounds half-up (decision 2026-10-02, FR-03,
  AC-14).
- **An exchange miscounted as spending** → it is its own movement type, never an expense or income
  (FR-02).

## Dependencies
- DISC-001-03b (Expense and Income) — the movements table, balances and the list (FR-04, FR-06).
- PRD 01 (Identity & Access) — user time zone (FR-05) and access control (AC-09, NFR-04).
- PRD 02 (Accounts & Categories) — accounts and their currencies (FR-01, FR-02).
- PRD 08 (Recurring Payments & Reminders) — future-dated payments (FR-05).
- PRD 10 (Credit Cards: Statements & Installments) — credit card payments are transfers that this
  ticket's movement type serves.

## Decision Log
- 2026-09-25: Buying/selling USD is a cross-currency transfer with its implied rate stored.
- 2026-09-25: User approved rates with 4 decimals as scaled integers.
- 2026-10-02: Parent PRD split into DISC-001-03a to 03e by user decision.
- 2026-10-02: FR-05 and AC-07 apply the original FR-20 and AC-30 to transfers and exchanges; FR-06
  and AC-08 are the half of the original FR-15 that the expense and income list does not cover;
  AC-09 applies the owner-scope rule of AGENTS.md. Listed in the parent index as added while
  splitting.
- 2026-10-02: Human decision Q1 (relayed by the orchestrator), decision 6 of the parent index: the
  implied rate rounds half-up, computed as (ars*20000 + usd) / (2*usd) on bigint, the same rule as
  `parseScaledRate`. Folded into FR-03 with AC-14.
- 2026-10-02: Human decision Q2 (relayed by the orchestrator): the rules DISC-001-03b applies to
  expense and income apply as they are to transfers and exchanges: amounts at most 10^15 minor
  units, a note of at most 500 characters, an archived source or destination rejected with 409
  ACCOUNT_ARCHIVED, the same 60 per minute per user creation limit, and an implied rate outside
  1 to RATE_MAX scaled (0.0001 to 10,000,000.0000) rejected with 400. FR-07, FR-08, FR-09, AC-10 to
  AC-13 and AC-15 are not in the original text; listed in the parent index as added while defining.
- 2026-10-02: Human decision (relayed by the orchestrator): transfers and exchanges are one
  `movements` row with a destination account and destination amount; the category is absent for
  these types and the rate is stored only on exchanges. Recorded for PLAN; no requirement changes.

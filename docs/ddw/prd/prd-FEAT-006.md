# PRD FEAT-006: Edit an account's opening balance

| Field | Value |
|-------|-------|
| Ticket | FEAT-006 |
| Tracker | none |
| Date | 2026-10-09 |
| PRD loops | 0 |
| Loops since last human decision | 0 |

## Context and Problem

An account's opening balance ("saldo inicial") is set once, when the account is created
(`POST /accounts`, `createAccountRequestSchema`). Nothing lets the owner change it afterwards: the
accounts module offers rename, archive/unarchive, include-in-available and delete, and the account
list in the web app offers Rename, Archive and Delete. A user in production entered a wrong opening
balance and cannot correct it, short of deleting the account, which is impossible once it has
movements.

The balance an account shows is derived: the opening balance plus the sum of its movements, computed
on read. Changing the opening balance therefore changes the balance by exactly the difference and
touches no movement and no frozen exchange rate.

## Goals

- Let the owner correct the opening balance of any of their accounts after creation.
- Keep the same limits and sign rules as at creation, so no value becomes possible that creation
  would refuse.
- Make the effect obvious before saving: the form shows the current value, explains that the balance
  moves by the difference and that movements are not touched, and previews the new balance.

## Functional Requirements

- FR-01: The API exposes `PATCH /accounts/:id/opening-balance` with body `{ openingBalance }`, a
  minor-units integer string validated by the same schema as account creation (absolute value at
  most 10^15 minor units, negative allowed).
- FR-02: The endpoint answers with the updated account in the same shape as the other account
  endpoints, with `openingBalance` set to the new value and `balance` recomputed as the new opening
  balance plus the sum of the account's movements.
- FR-03: Changing the opening balance writes only the account's opening balance (and its
  `updated_at`); it creates, changes or deletes no movement and changes no frozen exchange rate.
- FR-04: The endpoint is scoped to the owner like every account route: a missing account or an
  account that is not the user's answers 404, and nothing is written.
- FR-05: The change is allowed on archived accounts and on accounts linked to a credit card, exactly
  as rename is: the accounts module has no rule that blocks rename for either.
- FR-06: Every successful change writes one audit log line carrying the request id, the user id and
  the account id, and no amount and no account name.
- FR-07: The account list offers an "Edit opening balance" action on every account row, next to
  Rename, that opens a small form in the row.
- FR-08: The form shows the current opening balance, an amount input formatted for the account's
  currency and the user's locale (the same input and parser as the account creation form), an
  explanatory line (the balance changes by the difference; movements are not touched) and a preview
  of the new balance.
- FR-09: The form validates the amount before sending: empty or malformed input and values outside
  the creation limits show a field message and send nothing.
- FR-10: On success the row shows the updated opening balance and balance, the form closes and the
  list totals are read again from the API; on failure the form stays open and the error is shown
  with the same mapping the rename action uses.
- FR-11: Every new user-facing string exists in both the Spanish and the English catalogs.

## Non-Functional Requirements

- NFR-01: A successful change issues exactly 1 write statement that updates exactly 1 row of the
  accounts table; a refused or not-found request issues 0 write statements.
- NFR-02: Amounts are bigint minor units end to end: 0 uses of floating point (`Number`,
  `parseFloat`, `toFixed`) on amounts in the new code, and values of 10^15 minor units and of
  -10^15 minor units are accepted while 10^15 + 1 and -(10^15 + 1) are refused.
- NFR-03: The ticket adds 0 new runtime dependencies and 0 database migrations.
- NFR-04: Audit log lines of this operation contain 0 amounts and 0 account names.
- NFR-05: The new row action and the form buttons have a touch target of at least 44 by 44 CSS
  pixels, like the existing row actions.
- NFR-06: Test coverage over `apps/api/src`, `apps/web/src` and `packages/shared/src` stays at or
  above 80% lines, branches and functions, and 0 pre-existing automated tests fail.

## Acceptance Criteria

- AC-01 (FR-01): WHEN the owner sends `PATCH /accounts/:id/opening-balance` with a valid
  `openingBalance`, THE API SHALL answer 200 with the account carrying that opening balance.
- AC-02 (FR-01): IF the body is missing `openingBalance`, carries a non-integer string, a number
  instead of a string, or a value whose absolute value exceeds 10^15 minor units, THEN THE API
  SHALL answer 400 with a validation error and leave the account unchanged.
- AC-03 (FR-01): IF the `id` path parameter is not a UUID, THEN THE API SHALL answer 400 and write
  nothing.
- AC-04 (FR-01): WHEN the new opening balance is negative or zero, THE API SHALL accept it, as
  account creation does.
- AC-05 (FR-02): WHEN the opening balance changes on an account that has movements, THE API SHALL
  answer a `balance` equal to the new opening balance plus the sum of those movements.
- AC-06 (FR-02): WHEN the same value the account already has is sent, THE API SHALL answer 200 with
  the unchanged account.
- AC-07 (FR-03): WHEN the opening balance changes, THE API SHALL leave every movement of the account
  and its frozen exchange rate unchanged.
- AC-08 (FR-04): IF the account does not exist, THEN THE API SHALL answer 404 and write nothing.
- AC-09 (FR-04): IF the account belongs to another user, THEN THE API SHALL answer 404, the same
  response as for a missing account, and leave that account unchanged.
- AC-10 (FR-04): IF the request carries no session, THEN THE API SHALL answer 401, and IF the user's
  email is not verified, THEN THE API SHALL answer the same error as the other account write routes.
- AC-11 (FR-05): WHEN the account is archived, THE API SHALL accept the change and keep the account
  archived.
- AC-12 (FR-05): WHEN the account is one of the linked accounts of a credit card, THE API SHALL
  accept the change.
- AC-13 (FR-06): WHEN the opening balance changes, THE API SHALL log one line with the request id,
  the user id and the account id, and no amount and no account name.
- AC-14 (FR-07): THE account list SHALL show an "Edit opening balance" action on every account row,
  active or archived, credit cards included.
- AC-15 (FR-08): WHEN the user opens the action, THE row SHALL show a form with the current opening
  balance formatted for the account's currency, an amount input pre-filled with it, and the
  explanatory line.
- AC-16 (FR-08): WHEN the user types a valid amount, THE form SHALL show the new balance as the
  current balance minus the current opening balance plus the typed amount.
- AC-17 (FR-09): IF the amount is empty or malformed, THEN THE form SHALL show an invalid-amount
  message and send no request.
- AC-18 (FR-09): IF the amount is outside the creation limits, THEN THE form SHALL show an
  out-of-range message with the limit formatted for the currency and send no request.
- AC-19 (FR-10): WHEN the API accepts the change, THE list SHALL show the updated row, close the form
  and read the totals again.
- AC-20 (FR-10): IF the API answers with an error, THEN THE form SHALL stay open and the error SHALL
  be shown with the message of the same error class that rename uses, and IF the session has expired,
  THEN THE app SHALL go to the sign-in page.
- AC-21 (FR-10): WHEN the user cancels, THE form SHALL close and send no request.
- AC-22 (FR-11): IF a new string is missing from either the Spanish or the English catalog, THEN THE
  test suite SHALL fail.

## Out of Scope

- Editing the type or currency of an account (still immutable).
- Creating an adjustment movement or any history of opening balance changes; the audit trail is the
  log line only.
- Editing an opening balance offline or through the sync queue.
- A confirmation step or an undo for the change.
- Changing how balances, totals or credit card statements are computed.
- Database migrations and new runtime dependencies.

## Dependencies

- DISC-001-02a (Accounts): the account model, `openingBalanceSchema`, the account routes and the
  rename behavior this mirrors (FR-01, FR-04, FR-05).
- PRD 01 (Identity & Access): session, verified email and the 404 policy (FR-04).
- PRD 03 (Movements & Exchange Rates): movements that make up the derived balance (FR-02, FR-03).
- FEAT-004 and FEAT-005 (design system and redesign): the row actions and money input the form
  reuses (FR-07, FR-08).

## Risks and Mitigations

- **A wrong value silently moves a balance that statements or reports already used.** The change is
  explicit, owner-only and logged; the form states the effect and previews the result. Accepted: the
  owner may correct their own data.
- **Card-linked accounts.** Changing the opening balance of a linked account changes the debt shown
  for the card. The rule is the one rename already follows (allowed); the spec records it so a later
  ticket can tighten it.
- **Concurrent edits.** Two devices editing at once is last write wins; the response always carries
  the stored value and the list is read again.

## Decision Log

- 2026-10-09: card-linked and archived accounts are allowed because rename has no rule for either
  (confirmed by reading the accounts module); the owner asked for the same behavior as rename.

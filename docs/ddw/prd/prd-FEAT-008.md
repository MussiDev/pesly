# PRD FEAT-008: Link a group expense to the payer's own account

| Field | Value |
|-------|-------|
| Ticket | FEAT-008 |
| Tracker | none |
| Date | 2026-10-12 |
| PRD loops | 1 |
| Loops since last human decision | 1 |

## Context and Problem

A group expense moves money out of a registered payer's account only when the payer records it
themselves: the use case that records an expense writes the payer's movement only when the caller is
the payer, and refuses an account otherwise (DISC-001-05b FR-07, FR-09, AC-18). When another member
records "Ana paid 40,000.00 ARS", Ana's share counts as her personal expense and the group balance
shows what she is owed, but no movement appears in any of her accounts. The system does not know
which account the money left, so Ana's account balance is wrong until she corrects it by hand.

There is no way to fix it afterwards. "Send to group" (DISC-001-05i) goes the other way: it turns a
personal movement into a new group expense, so using it here would duplicate the expense.

The pieces exist. An expense already stores `payerMovementId` and `adoptedMovement`; edits and
deletes of an expense propagate to the payer's movement under the payer's scope (05b D6); an adopted
movement is locked against changes of amount, account and date (05i). What is missing is a way for
the payer to attach a movement to an expense that has none.

## Goals

- Let the payer of an expense that has no movement attach one afterwards, in either of two ways:
  create the movement from an account and a personal category, or adopt a movement they already
  registered.
- Reuse the existing meaning of a linked expense, so edits, deletes and locks behave exactly as they
  do for an expense the payer recorded or sent themselves.
- Keep the shared record untouched: linking changes nothing that other members see or owe.

## Functional Requirements

- FR-01: The API exposes `POST /groups/:id/expenses/:expenseId/payer-movement`, validated by a
  shared Zod schema, whose body is either `{ mode: "create", accountId, categoryId }` or
  `{ mode: "adopt", movementId }`.
- FR-02: The endpoint accepts the request only from the member who is the payer of the expense, a
  registered member, on an expense that has no linked movement; it answers with the expense in the
  same shape as the other expense endpoints, with `payerMovementId` set.
- FR-03: In `create` mode, the system records one expense movement of the full amount of the group
  expense on the chosen account, with the chosen personal expense category, the expense's date, the
  expense description as note and the stored rate of the group's default rate type, exactly as when
  the payer records the expense; the movement is owned by the payer and is deleted when the expense
  is deleted.
- FR-04: In `adopt` mode, the system links a movement of the payer's own that is an expense, is not
  linked to any group expense, and has the same amount and the same currency as the group expense;
  the link is an adoption as in DISC-001-05i: a later edit of the expense carries amount and date to
  the movement and never the note, deleting the expense detaches the movement and keeps it, and the
  movement's amount, account and date are locked against direct edits.
- FR-05: Linking does not change the expense's shares, receivables, balances, version or activity
  log, and sends no notification.
- FR-06: The API exposes `GET /groups/:id/expenses/:expenseId/movement-candidates`, answered only
  to the payer of an unlinked expense, listing at most 20 of the payer's own movements that are
  expenses, unlinked, in the expense's currency and of the expense's amount, newest first.
- FR-07: The expense row in the web list offers "Link to my account" only to the member who is the
  payer of an expense without a linked movement, and the action opens a screen with the two ways.
- FR-08: The `create` screen offers the payer's accounts in the expense's currency and their personal
  expense categories; the `adopt` screen offers the candidates and, when there are none, says so and
  points to the `create` way.
- FR-09: After a successful link the web app returns to the expense list and shows the row as linked
  to the payer's account.
- FR-10: Linking is online only: while the device is offline the screen says so and sends nothing.
- FR-11: Every string of the screens goes through the i18n catalogs in Spanish and English, and
  amounts and dates use the locale formatters.
- FR-12: The screens are split into containers that own the requests and presentational components
  with no data fetching.

## Non-Functional Requirements

- NFR-01: Linking is atomic: the movement (created or adopted) and the expense's `payerMovementId`
  change in one database transaction, so exactly one of two concurrent requests for the same expense
  succeeds and the other is answered 409.
- NFR-02: `POST .../payer-movement` and `GET .../movement-candidates` answer in under 300 ms at the
  95th percentile with 10,000 expenses in the group.
- NFR-03: The expense list adds 0 requests for members who are not the payer of the expense: the
  action is decided from data the list already holds.
- NFR-04: Every query reads data scoped by the caller's membership or ownership; a movement, account
  or category that is not the caller's is never read for the caller, and a group the caller is not in
  answers 404.
- NFR-05: The screens have no horizontal scroll at 360 px width at the default text size, and every
  action is reachable by keyboard with an accessible name.
- NFR-06: Coverage of the new code stays at or above the project floor of 80% lines, branches and
  functions, and no `any` is introduced.

## Acceptance Criteria

- AC-01 (FR-01): WHEN the body has neither a `create` nor an `adopt` shape, or has extra keys, THE
  API SHALL answer 400 and change nothing.
- AC-02 (FR-02): WHEN the payer of an unlinked expense links it, THE API SHALL answer with the
  expense and its `payerMovementId` set to the linked movement.
- AC-03 (FR-02): IF a member who is not the payer links the expense, THEN THE API SHALL answer 403
  with `GROUP_PAYER_ONLY` and change nothing.
- AC-04 (FR-02): IF the payer of the expense is a ghost member, THEN THE API SHALL answer 403 with
  `GROUP_PAYER_ONLY`, because no registered member can link it.
- AC-05 (FR-02): IF the expense already has a linked movement, THEN THE API SHALL answer 409 with
  `GROUP_EXPENSE_ALREADY_LINKED` and change nothing.
- AC-06 (FR-02): IF the group or the expense does not exist or the caller is not in the group, THEN
  THE API SHALL answer 404.
- AC-07 (FR-03): WHEN the payer links in `create` mode a 40,000.00 ARS expense with one of their ARS
  accounts, THE API SHALL subtract 40,000.00 ARS from that account through one expense movement
  carrying the chosen category, the expense's date and the expense description as note.
- AC-08 (FR-03): IF the chosen account is archived, belongs to another user, or has a currency
  different from the expense's, THEN THE API SHALL answer 400 with `GROUP_PAYER_ACCOUNT_INVALID` and
  create no movement.
- AC-09 (FR-03): IF the chosen category is not a personal expense category of the payer, THEN THE API
  SHALL answer 400 with `GROUP_PAYER_ACCOUNT_INVALID` and create no movement.
- AC-10 (FR-03): WHEN an expense linked in `create` mode is deleted, THE API SHALL delete the
  movement too, as for an expense the payer recorded.
- AC-11 (FR-04): WHEN the payer links in `adopt` mode one of their expense movements of the same
  amount and currency, THE API SHALL link it and change no balance of any account.
- AC-12 (FR-04): IF the movement is not an expense, THEN THE API SHALL answer 400 with
  `GROUP_MOVEMENT_NOT_EXPENSE`.
- AC-13 (FR-04): IF the movement is already linked to a group expense, THEN THE API SHALL answer 409
  with `GROUP_MOVEMENT_ALREADY_SENT`.
- AC-14 (FR-04): IF the movement's amount or currency differs from the expense's, THEN THE API SHALL
  answer 400 with `GROUP_MOVEMENT_MISMATCH` and link nothing.
- AC-15 (FR-04): IF the movement does not exist or is not the payer's, THEN THE API SHALL answer 404.
- AC-16 (FR-04): WHEN an expense linked in `adopt` mode is edited, THE API SHALL carry the new amount
  and date to the movement and keep its note; WHEN it is deleted, THE API SHALL keep the movement and
  detach it; WHEN the payer edits the movement's amount, account or date, THE API SHALL answer 409
  with `MOVEMENT_LOCKED_BY_GROUP_EXPENSE`.
- AC-17 (FR-05): WHEN a link succeeds, THE API SHALL leave the expense's shares, its version, the
  group's balances and the activity log unchanged.
- AC-18 (FR-06): WHEN the payer asks for candidates of an unlinked expense, THE API SHALL return at
  most 20 of their unlinked expense movements with the same currency and amount, newest first, and
  none that belongs to another user.
- AC-19 (FR-06): IF a member who is not the payer asks for candidates, or the expense is already
  linked, THEN THE API SHALL answer 403 with `GROUP_PAYER_ONLY` or 409 with
  `GROUP_EXPENSE_ALREADY_LINKED` respectively.
- AC-20 (FR-07): WHILE the signed-in member is the payer of an expense with no linked movement, THE
  expense row SHALL show "Link to my account"; WHILE they are not, or the expense is linked, THE row
  SHALL not show it.
- AC-21 (FR-08): WHEN the payer opens the `create` way, THE screen SHALL offer only their
  non-archived accounts in the expense's currency and their personal expense categories.
- AC-22 (FR-08): WHEN no candidate exists, THE `adopt` way SHALL say so and offer the `create` way.
- AC-23 (FR-09): WHEN a link succeeds, THE web app SHALL return to the expense list and show the row
  as linked.
- AC-24 (FR-09): IF the link is refused or the request fails, THEN THE screen SHALL show the failure
  with its retry or back action and keep the choices the payer made.
- AC-25 (FR-10): WHILE the device is offline, THE screen SHALL say that linking needs a connection
  and SHALL send no request.
- AC-26 (FR-11): WHILE the interface language is English or Spanish, THE screens SHALL show their
  text from that language's catalog, with amounts and dates in its locale format.
- AC-27 (FR-12): WHEN the presentational components are rendered with props only, THE components
  SHALL show their content with zero calls to the API client.
- AC-28 (NFR-01): WHEN two requests link the same expense at the same time, THE API SHALL apply
  exactly one and answer the other 409, leaving one linked movement.
- AC-29 (NFR-02): WHEN a group holds 10,000 expenses, THE link and candidates endpoints SHALL answer
  in under 300 ms at the 95th percentile.
- AC-30 (NFR-03): WHEN the expense list loads, THE web app SHALL issue the same requests as before
  this change.
- AC-31 (NFR-04): IF the account or the category of a `create` request belongs to another user or does
  not exist, THEN THE API SHALL answer the same 400 with `GROUP_PAYER_ACCOUNT_INVALID` in both cases,
  and IF the movement of an `adopt` request belongs to another user or does not exist, THEN THE API
  SHALL answer the same 404 in both cases, so neither answer reveals whether the record exists.
- AC-32 (NFR-05): WHILE the viewport is 360 px wide at the default text size, THE screens SHALL show
  no horizontal scroll.

## Out of Scope

- Unlinking an expense from its movement without deleting one of them.
- Linking by an admin or any member on behalf of another payer.
- Linking an income or a transfer, or a movement of a different amount or currency.
- Changing the payer of an expense.
- Linking offline or queuing a link for later.
- Matching or suggesting movements by date, note or fuzzy amount; candidates are exact amount and
  currency only.
- Showing the link in the group's activity log or telling other members that a member linked an
  expense.
- Linking several expenses at once.
- Linking the settlements of a group (DISC-001-05c); only expenses are covered.

## Risks and Mitigations

- **Double counting in personal reports.** A linked expense has a full-amount movement and a share.
  Mitigation: the same link semantics as an expense the payer recorded or sent are reused, so the
  reports and budgets treat it as they already do; a test records the same expense both ways and
  compares what the personal views read.
- **Two clients link at once.** Mitigation: one transaction with a lock on the expense row, and a
  test that fires two requests in parallel (NFR-01, AC-28).
- **The movement and the expense disagree on the date after an adoption.** Mitigation: the date is
  not compared at link time (a manual movement date is rarely exact); the first edit of the expense
  carries its date to the movement, and the PRD states it so the behavior is not a surprise.
- **Leaking another user's data through the candidates list.** Mitigation: the query is scoped by the
  payer's user id, and a test seeds a matching movement of another user.
- **Adding error codes breaks clients that switch on codes.** Mitigation: the three new codes
  (`GROUP_PAYER_ONLY`, `GROUP_EXPENSE_ALREADY_LINKED`, `GROUP_MOVEMENT_MISMATCH`) are added to the
  shared error catalog and to both i18n catalogs, and a test checks that every code has a message.

## Dependencies

- DISC-001-05b (group expenses and the payer movement), DISC-001-05d (editing rules that propagate to
  the payer's movement) and DISC-001-05i (adopted movements, their locks and
  `MOVEMENT_LOCKED_BY_GROUP_EXPENSE`).
- DISC-001-03b (movements and frozen rates) and DISC-001-02a (accounts and their currency).
- DISC-001-05f (the group expenses list that hosts the action).
- Shared error catalog and Zod schemas in `packages/shared`.

## Decision log

- 2026-10-13: Corrected by the author after reading the API code, with no change of intent: the error codes that this PRD wrote as 422 answer 400 (the API has no 422, and `GROUP_PAYER_ACCOUNT_INVALID` and `GROUP_MOVEMENT_NOT_EXPENSE` already answer 400); the group id in the paths is `:id`; and a foreign or missing account or category answers `GROUP_PAYER_ACCOUNT_INVALID`, as recording an expense does today, while a foreign or missing movement answers 404 (AC-31).
- 2026-10-13: Decided by the owner: linking an expense to the payer's account writes no entry in the group's activity log, does not change the expense's version and notifies nobody, because the shared record (amount, payer, shares) does not change and the account is the payer's private bookkeeping (FR-05, AC-17).
- 2026-10-12: Decided by the owner: both ways ship in this ticket, creating the movement from an account and a category (`create`) and adopting a movement the payer already registered (`adopt`).

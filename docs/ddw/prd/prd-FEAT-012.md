# PRD FEAT-012: Balance adjustments instead of editing the opening balance

| Field | Value |
|-------|-------|
| Ticket | FEAT-012 |
| Tracker | none |
| Date | 2026-10-13 |
| PRD loops | 1 |
| Loops since last human decision | 0 |

## Context and Problem

When an account balance does not match the bank, the only way to fix it today is to edit the
account's **opening balance** (`PATCH /accounts/:id/opening-balance`). That has three problems:

- The user cannot type the balance they see in the bank. They must work out the opening balance that
  produces it.
- The change leaves no trace. The balance moves, but no movement explains it, so the income vs
  expense report no longer agrees with the balances.
- The net-worth history treats the opening balance as constant for every month, so editing it
  rewrites the whole past curve.

This change replaces that edit with a **balance adjustment**: the user types the balance they want
the account to show now, and the system records the difference as a dated entry in the account's
history. The opening balance becomes read-only once the account exists.

An adjustment is neither an expense nor an income (like a settlement): it changes the account
balance and the net worth from its own date onward, and it never appears in reports of income and
expenses or in budgets.

## Goals

- The user fixes an account balance by typing the target balance, in one step.
- Every correction leaves a dated, visible entry; no past month changes.
- Income vs expense reports and budgets are unaffected by adjustments.
- The net worth and its history include adjustments from their own date.

## Functional Requirements

- FR-01: The user can set the current balance of an account by entering the target balance; the
  system records one adjustment of (target balance − current balance) dated now.
- FR-02: An adjustment is an entry of the account's history with a signed amount, in the account's
  currency, with no category, no tags and no exchange rate, and with an optional note.
- FR-03: The balance of an account includes its adjustments.
- FR-04: The net worth and its history include an adjustment from the month of its date onward, and
  do not change any earlier month.
- FR-05: Reports of income and expenses, budgets, alerts and the groups features do not count
  adjustments.
- FR-06: The movements list shows adjustments, marked as such, and the user can filter them out.
- FR-07: The user can delete an adjustment; the balance and the net worth then return to what they
  would be without it.
- FR-08: An adjustment cannot be edited; to change it the user deletes it and sets the balance
  again.
- FR-09: The opening balance of an account is set only when the account is created; the endpoint and
  the screen that edit it afterwards are removed.
- FR-10: The adjustment dialog shows the current balance, the target balance field and the resulting
  difference before the user confirms.
- FR-11: Setting a balance equal to the current balance records nothing and tells the user there is
  no difference.
- FR-12: The target balance must accept negative values for any account, within the same limits as
  the opening balance.
- FR-13: Existing accounts keep the opening balance they have today; no stored data is changed.
- FR-14: WHEN the user has two-factor authentication on, setting a balance must require a valid
  second-factor code, and when it is off no code is asked.

## Non-Functional Requirements

- NFR-01: Setting a balance responds in at most 500 ms at the 95th percentile on the reference
  dataset of 10,000 movements.
- NFR-02: The difference is computed on the server from the balance stored at that moment; in a test
  of 20 concurrent requests for the same account, 0 lost updates occur and the final balance equals
  the last target applied.
- NFR-03: Amounts are 64-bit integers in minor units; no floating point in the computation, the API
  or the tests.
- NFR-04: Every query on adjustments is scoped by owner; an adjustment or account that is not the
  user's answers 404.
- NFR-05: 0 new strings are missing from the Spanish and English catalogs, and 100% of the dialog's
  controls are reachable and operable by keyboard with an accessible name.
- NFR-06: The feature is online only: 0 adjustment requests enter the offline queue.

## Acceptance Criteria

- AC-01 (FR-01): WHEN the user confirms a target balance different from the current one, THE system
  SHALL record one adjustment equal to target minus current and show the account with the target
  balance.
- AC-02 (FR-02): WHEN an adjustment is recorded, THE system SHALL store it with the account's
  currency, a signed amount, no category, no tags and no rate, and the note the user typed, if any.
- AC-03 (FR-03): WHILE an account has adjustments, THE system SHALL compute its balance as opening
  balance plus movements plus adjustments.
- AC-04 (FR-04): WHEN an adjustment dated in month M is recorded, THE system SHALL leave the net
  worth of every month before M unchanged and include the adjustment from M onward.
- AC-05 (FR-05): WHEN the user opens the income vs expense report, a budget or a group, THE system
  SHALL show the same figures as before the adjustment.
- AC-06 (FR-06): WHEN the user opens the movements list, THE system SHALL show each adjustment with
  an "Adjustment" label, and WHEN the user hides adjustments with the filter, THE system SHALL omit
  them.
- AC-07 (FR-07): WHEN the user deletes an adjustment, THE system SHALL remove it and the balance
  and net worth SHALL equal the values they would have without it.
- AC-08 (FR-08): IF a client tries to edit an adjustment, THEN THE system SHALL reject the request
  and leave the adjustment unchanged.
- AC-09 (FR-09): WHEN the user views an existing account, THE system SHALL show its opening balance
  as read-only, and IF a client calls the removed opening-balance endpoint, THEN THE system SHALL
  answer 404.
- AC-10 (FR-10): WHEN the user types a target balance, THE system SHALL show the current balance and
  the resulting difference, with its sign, before confirmation.
- AC-11 (FR-11): IF the target balance equals the current balance, THEN THE system SHALL record no
  adjustment and show that there is no difference.
- AC-12 (FR-12): IF the target balance is not a valid integer string in minor units or is outside
  the opening balance's limits, THEN THE system SHALL reject it with a validation error and record
  nothing; WHEN the target is negative and within the limits, THE system SHALL accept it.
- AC-13 (FR-13): WHEN the migration is applied to a database with existing accounts, THE system SHALL
  keep every opening balance, balance and net-worth value unchanged.
- AC-14 (FR-03): IF an account is archived, THEN THE system SHALL reject a new adjustment on it.
- AC-15 (NFR-02): WHILE two balance-setting requests for the same account run concurrently, THE
  system SHALL apply them one after the other, so the final balance is the last requested target.
- AC-16 (NFR-04): IF an adjustment or account belongs to another user, THEN THE system SHALL answer
  404 and change nothing.
- AC-17 (NFR-01): WHEN a balance is set on the reference dataset, THE system SHALL respond within
  500 ms at the 95th percentile.
- AC-18 (NFR-06): IF the device is offline, THEN THE system SHALL disable the action and say that it
  needs a connection.
- AC-19 (FR-14): WHILE two-factor authentication is on, THE system SHALL record an adjustment only
  with a valid TOTP or recovery code, and WHILE it is off THE system SHALL ask for no code.
- AC-20 (FR-14): IF two-factor authentication is on and the code is missing, wrong or already used,
  THEN THE system SHALL reject the request, record nothing and count a wrong code against the same
  limits as disabling two-factor authentication.

## Out of Scope

- Editing the amount or date of an adjustment.
- Importing bank statements or reconciling against them.
- Adjusting investment holdings or credit-card statements.
- Backdating an adjustment; it is always dated now.
- Rewriting the opening balance of existing accounts into adjustments.

## Risks and Mitigations

- **Readers that treat every non-income type as an expense** (the account-flow reader does): an
  unhandled adjustment would be counted as spending. Mitigation: the spec lists every reader of
  movements and each gets a test with an adjustment.
- **Users who relied on editing the opening balance** lose that path. Mitigation: the new action is
  one step and shows the difference; the old balances stay untouched.
- **Net worth in USD accounts** converts the adjustment at the rate used for that month's balance;
  the spec must state the rule so history stays consistent.
- **A stolen session could hide spending by adjusting balances.** Mitigation: FR-14 asks for the
  second factor when the user has it on; users without it are not protected beyond today's level.
- **Deleting an old adjustment changes balances after its date.** Accepted: the delete confirmation
  states the effect.

## Dependencies

- Movements module (types, list and filters), accounts module (balance, opening balance), dashboard
  net-worth history and reports of income and expenses (`flow-conditions`, account-flow reader).
- Identity module (two-factor authentication): the second-factor check and its attempt limits are
  reused; no new factor or setting is added.
- Drizzle migration: must follow the merge rule for migration `when` values.

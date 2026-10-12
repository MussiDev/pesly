# PRD DISC-001-05i: Send an Existing Movement to a Group

| Field | Value |
|-------|-------|
| Ticket | DISC-001-05i |
| Tracker | none |
| Date | 2026-10-11 |
| PRD loops | 0 |
| Loops since last human decision | 0 |

## Context and Problem
Follow-up of PRD 05 (parent index: `prd-DISC-001-05.md`; expenses and splits in `prd-DISC-001-05b.md`,
editing rules in `prd-DISC-001-05d.md`, the expense screens in 05f). Today a group expense is born in the
group: when the payer is the caller, the API records a new expense movement on the chosen account in the
same transaction and stores its id in `group_expenses.payer_movement_id`. A person who already recorded a
personal expense that belongs to a group has only one way out: delete the movement and record the expense
again in the group, retyping amount, date and account, and getting a second, different movement.

This ticket adds the reverse path: a "Send to group" action on an existing personal expense. The person
picks the group, the group category and the split, and the group expense is created adopting the movement
as the payer's account movement: no second movement exists, the account balance does not change, and the
movement keeps its own personal category, note, tags and frozen rate. As with every group expense, only the
person's share counts as their personal expense and the rest is a receivable (05b FR-08).

Findings in the code that shape the requirements (investigated 2026-10-11):
- `POST /groups/:id/expenses` always records the payer movement itself (`PayerMovementRecorder.record`); no
  path links an existing movement, so one new endpoint is needed (name and shape left to the spec).
- The link is `group_expenses.payer_movement_id` (`on delete set null`) with a plain, non-unique partial
  index. Nothing prevents two expenses from pointing at one movement, so the one-to-one rule needs a
  database change (a unique index on the link, and a marker of an adopted movement on `group_expenses`).
  The migration number is assigned at PLAN; its journal `when` must exceed the maximum on `main` when it
  merges.
- Deleting a group expense today deletes the payer movement (`DeleteGroupExpense` calls
  `PayerMovementRecorder.remove`). For a movement that existed before the expense, that would destroy the
  person's own record, so the rule for adopted movements changes (Decision Log, open question 1).
- Editing a group expense rewrites the payer movement's amount, date and note (05d). For an adopted
  movement the note is the person's own text and must not be overwritten (open question 2).
- Budgets already leave a payer movement out of personal spending with a `not exists` probe on the link
  and count the payer's share instead, so linking is what moves the figures: no change to reports or
  `GET /groups/personal/shares` is needed.
- A movement has no version counter; `PUT /movements/:id` can change its amount, account and date freely, so
  a linked movement could drift from its expense (open question 3).
- Movements that are not expenses (income, transfers, currency exchanges) cannot be sent. Card installments
  are not movements, and card statement payments and automatic debits are transfers, so they are excluded by
  the type rule. A movement made by a recurring payment or a device is an ordinary expense and may be sent.
- The group currencies are ARS and USD per expense, so the expense takes the account's currency; there is no
  currency mismatch to refuse.

## Goals
- A person turns a personal expense into a group expense without deleting or retyping anything.
- Balances, personal spending and receivables come out exactly as if the expense had been created in the
  group: nothing is counted twice and no movement is duplicated.
- A movement belongs to at most one group expense, even under concurrent requests.
- Deleting the group expense later never destroys the person's own movement.

## Functional Requirements
- FR-01: The system must show a "Send to group" action on an eligible personal expense, only while the
  device is online.
- FR-02: The system must treat as eligible only an expense movement on the user's own account that the
  server already holds and that is not linked to a group expense.
- FR-03: The system must let the person choose one of their groups, one of its categories and the
  description, which starts from the movement's note, with the amount, currency and date taken from the
  movement and shown but not editable.
- FR-04: The system must let the person choose the split (equal, percentage or exact) with the same split
  editor and the group's default split as the group expense form, with the person as the payer.
- FR-05: The system must create the group expense linked to the existing movement in one transaction, with
  its shares and no new movement, and leave the account balance and the movement's category, note, tags and
  frozen rate unchanged.
- FR-06: The system must count only the person's share as their personal expense and the rest as a
  receivable, with the movement left out of personal spending.
- FR-07: The system must write the creation entry of the activity log like any group expense and mark that
  it was created from a movement.
- FR-08: The system must refuse a send that is not allowed (a movement that is not an expense, one that is
  already linked, an invalid category, split or description) with a specific message and change nothing.
- FR-09: The system must let one request win and answer 409 to the other when the same movement is sent
  twice, whether in sequence or at the same time.
- FR-10: The system must refuse an edit that changes the amount, the account or the date of a movement
  adopted by a group expense, and must still allow its category, note and tags.
- FR-11: The system must apply an edit of the group expense to an adopted movement's amount and date but
  never to its note.
- FR-12: The system must, when an adopted group expense is deleted, keep the movement as a plain personal
  expense and write the deletion entry as for any expense.
- FR-13: The system must answer 404, never 403, when the movement is not the user's, does not exist, or the
  group is not one the user belongs to.
- FR-14: The system must show every string of the action and its screen in Spanish and English from the
  i18n catalogs, with amounts and dates from the locale formatters and every amount as an integer in minor
  units.

## Non-Functional Requirements
- NFR-01: The send screen must render without horizontal scrolling at a 360 px wide viewport, verified by an
  end-to-end test at that width.
- NFR-02: The send screen must load with at most 2 API requests before a group is chosen (the movement and
  the groups) and at most 2 more after (the group and its expense options), and the send itself must be 1
  request, each verified by a test that counts the calls.
- NFR-03: A send must create 0 movement rows, verified by a test that counts the rows of `movements` before
  and after, and 100 sends of 100 different movements must leave 100 expenses with 100 distinct links.
- NFR-04: The Spanish and English catalogs must have 0 missing or empty keys, verified by the existing
  catalog parity test.
- NFR-05: Every amount must be handled as an integer in minor units with 0 floating-point conversions,
  verified by a test over 1,000 random amounts that the expense amount equals the movement amount and that
  the shares add up to it.
- NFR-06: When the same movement is sent by 20 concurrent requests, exactly 1 must succeed and 19 must
  answer 409, leaving 1 expense and 1 log entry, verified by an integration test against PostgreSQL.
- NFR-07: A refused send must leave 0 rows written (no expense, share, log entry or change to the movement),
  verified by tests that compare table counts after each refusal.

## Acceptance Criteria
*(EARS)*
- AC-01 (FR-01): WHEN the person opens an eligible expense movement while online, THE system SHALL show a
  "Send to group" action on it.
- AC-02 (FR-01): IF the device is offline, THEN THE system SHALL not offer the action and SHALL say that
  sending to a group needs a connection.
- AC-03 (FR-02): IF the movement is income, a transfer or a currency exchange, THEN THE system SHALL show no
  action and, at the API, SHALL refuse the send with a message that only expenses can be sent.
- AC-04 (FR-02): IF the movement is still waiting in the device queue and the server does not hold it yet,
  THEN THE system SHALL show no action until it has synced.
- AC-05 (FR-02): IF the movement is already linked to a group expense, THEN THE system SHALL show no action
  and show the group it belongs to.
- AC-06 (FR-03): WHEN the person opens the send screen, THE system SHALL show the movement's amount,
  currency and date as text and list the groups the person belongs to.
- AC-07 (FR-03): WHEN the person chooses a group, THE system SHALL list that group's categories and prefill
  the description with the movement's note, cut to the 200 characters a group description allows.
- AC-08 (FR-03): IF the person belongs to no group, THEN THE system SHALL say so and link to the groups
  list.
- AC-09 (FR-03): IF the description is empty or the category is not chosen, THEN THE system SHALL show a
  field error and not send.
- AC-10 (FR-04): WHEN the person chooses equal, percentage or exact, THE system SHALL show the same split
  fields as the group expense form, starting from the group's default split.
- AC-11 (FR-04): IF the percentages do not add up to 100 or the exact amounts do not add up to the
  movement's amount, THEN THE system SHALL show a field error and not send.
- AC-12 (FR-05): WHEN the person sends a 40,000.00 ARS movement to a group split equally among 4 members,
  THE system SHALL store one group expense of 40,000.00 ARS linked to that movement with 10,000.00 ARS for
  each member.
- AC-13 (FR-05): WHEN the send succeeds, THE system SHALL leave the number of movements and the balance of
  the account unchanged and keep the movement's category, note, tags and rate.
- AC-14 (FR-05): IF any step of the send fails, THEN THE system SHALL store nothing and keep the movement
  as it was.
- AC-15 (FR-06): WHEN the person's share of a sent expense is 10,000.00 ARS of 40,000.00 ARS, THE system
  SHALL count 10,000.00 ARS as their personal expense and 30,000.00 ARS as a receivable.
- AC-16 (FR-06): WHEN the send succeeds, THE system SHALL leave the movement out of the personal spending
  that budgets compute and count only the share, so the amount is counted once.
- AC-17 (FR-07): WHEN the send succeeds, THE system SHALL add one creation entry to the group's activity log
  with the member, the date and time and a marker that it came from a movement.
- AC-18 (FR-07): WHEN a member reads that entry, THE system SHALL show that the expense was created from a
  movement, with no reference to the movement's account.
- AC-19 (FR-08): IF the category does not belong to the group or is archived, THEN THE system SHALL refuse
  the send and say that the category is not valid for the group.
- AC-20 (FR-08): IF the split names a person who is not a member of the group, THEN THE system SHALL refuse
  the send and say that a split member is not valid.
- AC-21 (FR-08): IF the movement is already linked to a group expense, THEN THE system SHALL refuse the send
  with a message that it was already sent to a group.
- AC-22 (FR-08): IF the description is empty or over 200 characters, THEN THE system SHALL refuse the send
  and say that the description is not valid.
- AC-23 (FR-09): IF the same movement is sent again after a send succeeded, THEN THE system SHALL answer 409
  and create nothing.
- AC-24 (FR-09): IF two sends of the same movement arrive at the same time, THEN THE system SHALL store one
  expense and answer 409 to the other.
- AC-25 (FR-10): IF the person edits the amount, the account or the date of an adopted movement, THEN THE
  system SHALL refuse the edit with a message that the movement belongs to a group expense and change
  nothing.
- AC-26 (FR-10): WHEN the person edits the category, the note or the tags of an adopted movement, THE system
  SHALL save the edit.
- AC-27 (FR-10): IF an edit queued on the device is refused for that reason after it syncs, THEN THE system
  SHALL show it as failed with the message and offer discard.
- AC-28 (FR-11): WHEN an authorised member changes the amount or the date of an adopted group expense, THE
  system SHALL apply the new amount and date to the movement and leave its note as it was.
- AC-29 (FR-12): WHEN an adopted group expense is deleted, THE system SHALL keep the movement, with its
  amount, account and note, as a plain personal expense that counts fully in personal spending again.
- AC-30 (FR-12): WHEN an adopted group expense is deleted, THE system SHALL leave the account balance as it
  was and write the deletion entry of the activity log.
- AC-31 (FR-12): WHEN a group expense that was created in the group (not adopted) is deleted, THE system
  SHALL delete its payer movement as before this ticket.
- AC-32 (FR-13): IF the movement belongs to another user or does not exist, THEN THE system SHALL answer 404
  and reveal nothing about it.
- AC-33 (FR-13): IF the group does not exist or the person is not a member, THEN THE system SHALL answer 404
  and reveal nothing about it.
- AC-34 (FR-14): WHERE the interface language is Spanish or English, THE system SHALL show every string of
  the action, the screen and its refusals in that language.

## Out of Scope
- Income, transfers and currency exchanges: only expense movements are sent.
- Sending to a group where another member paid: the person is always the payer, the same rule as an
  expense recorded in the group with the caller's account.
- Sending several movements at once (bulk) and sending the same movement to two groups.
- Undoing the send after a settlement touched the balances: deleting the group expense is the only way back,
  under the 05d rules (a member who left blocks it with 409).
- Offline use: group screens are online only (PRD 05 decision), so the action is not queued.
- Turning a group expense back into a personal-only movement beyond the detach on deletion.
- Choosing the group category automatically from the movement's category; the person picks it.
- Changing the currency, the account or the payer of the expense: they come from the movement.
- How reports show the sent expense beyond the existing share and receivable figures (PRD 09).

## Risks and Mitigations
- **The amount is counted twice in personal figures** → the link makes budgets skip the movement and count
  only the share, tested with a before and after figure (FR-06, AC-16).
- **Deleting the expense destroys the person's own movement** → adopted movements are detached, not deleted;
  the marker keeps created-in-group expenses on the old rule (FR-12, AC-29, AC-31).
- **Two requests link one movement to two expenses** → a unique link in the database plus a row lock on the
  movement, tested with 20 concurrent sends (FR-09, NFR-06).
- **The movement drifts from its expense** → amount, account and date are locked on an adopted movement and
  an expense edit carries amount and date over (FR-10, FR-11).
- **A queued offline edit of the movement arrives after the send** → it is refused as a failed change with
  its reason, never applied silently (AC-27).
- **The note of the movement is overwritten by an expense edit** → the note is excluded from propagation
  (FR-11).
- **Existing data already has two expenses on one movement** → none can exist by construction (each
  creation records its own movement), and the migration plan states the check before the unique index.
- **A float slips into money** → amounts stay integers in minor units and go through the shared helpers
  (NFR-05).

## Dependencies
- DISC-001-05b (group expenses and splits) — the expense, its shares, the payer movement link and the
  activity entry that this ticket reuses.
- DISC-001-05d (editing rules and activity log) — the edit and delete behaviour that this ticket changes for
  adopted movements.
- DISC-001-05f (group expense screens) — the split editor, the default split and the expense options that the
  send screen reuses.
- DISC-001-03 (movements) — the movement, its edit rules and the personal movement screens that gain the
  action and the lock.
- DISC-001-06b (budgets) — its spending reader already skips payer movements through the link.
- DISC-001-04c to 04e (offline queues) — a queued edit of a locked movement must surface as failed.
- Database change: a unique index on the movement link and a marker of an adopted movement on
  `group_expenses`; migration number assigned at PLAN, its journal `when` must exceed the maximum on `main`
  when it merges.
- FEAT-004 (design system) — components and tokens.

## Decision Log
- 2026-10-11: Owner asked for a "send to group" button on a personal movement instead of deleting and
  recreating it in the group, ending as if it had been created there. Owner approved the scope: expense
  movements the user paid, no income, transfers or exchanges, same split editor as 05f, one linked movement
  and no duplicate, only the user's share counts as personal expense and online only.
- 2026-10-11: Open question 1 (decision needed): deleting an adopted group expense detaches the movement and
  keeps it, instead of deleting it as today. Owner asked for this behaviour; it is a change to 05d, which
  deletes the payer movement. Recommended: the marker on `group_expenses` limits the new rule to adopted
  expenses; alternative: keep the movement for every expense, which changes data users already have.
- 2026-10-11: Open question 2 (decision needed): editing an adopted expense carries amount and date to the
  movement but not the note. Recommended: yes, the note is the person's own; alternative: overwrite it as
  today.
- 2026-10-11: Open question 3 (decision needed): lock amount, account and date on an adopted movement.
  Recommended: lock only adopted movements and let category, note and tags change; alternatives: lock every
  linked payer movement (touches 05b and 05d data), or lock nothing as today and accept drift.
- 2026-10-11: Open question 4: how the log entry says "from a movement". Recommended: a field on the creation
  entry, so the action set and the 05h labels stay as they are; alternative: a new action value.
- 2026-10-11: Open question 5: deleting the movement of an adopted expense keeps today's behaviour (the link
  becomes null and the expense stays). Recommended: keep it, since the expense belongs to the group.
- 2026-10-11: The model proposes a new endpoint (for example `POST /groups/:id/expenses/from-movement` with a
  `movementId`) and a database change; the spec decides the shape.
- 2026-10-11: Open questions 1 to 5 resolved by the owner, who accepted the recommendation of each: (1) deleting an adopted expense detaches and keeps the movement; (2) an edit carries amount and date to the movement, never the note; (3) amount, account and date of an adopted movement are locked with a 409; (4) the creation log entry carries a field marking it as created from a movement; (5) deleting the movement of an adopted expense nulls the link and keeps the expense.

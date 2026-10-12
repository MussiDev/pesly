# PRD DISC-001-05i: Send an Existing Movement to a Group

| Field | Value |
|-------|-------|
| Ticket | DISC-001-05i |
| Tracker | none |
| Date | 2026-10-11 |
| PRD loops | 4 |
| Loops since last human decision | 0 |

## Context and Problem
Follow-up of PRD 05 (parent index: `prd-DISC-001-05.md`; expenses and splits in `prd-DISC-001-05b.md`,
editing rules in `prd-DISC-001-05d.md`, the expense screens in 05f). Today a group expense is born in the
group: when the payer is the caller, the API records a new expense movement on the chosen account in the
same transaction and stores its id in `group_expenses.payer_movement_id`. A person who already recorded a
personal expense that belongs to a group has only one way out: delete the movement and record the expense
again in the group, retyping amount, date and account, and getting a second, different movement.

This ticket adds the reverse path: a "Send to group" icon action on each eligible row of the movements list
(next to edit and delete). The person picks the group (one tap) and confirms: the category and the split
start preselected (the category is automatic: the server uses the group category equivalent to the movement's
own category and falls back to the group's "Other expenses", creating or restoring it when needed), so the whole send takes at most 3 taps, and the person can change
the split first. The
group expense is created adopting the movement
as the payer's account movement: no second movement exists, the account balance does not change, and the
movement keeps its own personal category, note, tags and frozen rate. As with every group expense, only the
person's share counts as their personal expense and the rest is a receivable (05b FR-08).

Findings in the code that shape the requirements (investigated 2026-10-11):
- There is no movement detail screen. The edit screen (`/movements/edit?id=`) is a form, and the rows of
  the home screen's recent movements (`recent-movements.tsx`) are not clickable. Row actions exist only on
  the rows of the movements list (`movement-row.tsx`: an edit link and a delete button, both icon actions
  with the movement title in their accessible name), so "Send to group" is one more icon there, and the
  home rows need a link to reach the list row.
- The movements list loads 100 movements per page and its rows carry no group link (the list answer holds
  only the movements), so the spec must tell the list which rows are already linked to a group expense.
- `POST /groups/:id/expenses` always records the payer movement itself (`PayerMovementRecorder.record`); no
  path links an existing movement, so one new endpoint is needed (name and shape left to the spec).
- The link is `group_expenses.payer_movement_id` (`on delete set null`) with a plain, non-unique partial
  index. Nothing prevents two expenses from pointing at one movement, so the one-to-one rule needs a
  database change (a unique index on the link, and a marker of an adopted movement on `group_expenses`).
  The migration number is assigned at PLAN (as built: 0037, `when` 1791810000000); its journal `when` must
  exceed the maximum on `main` when it merges.
- Deleting a group expense today deletes the payer movement (`DeleteGroupExpense` calls
  `PayerMovementRecorder.remove`). For a movement that existed before the expense, that would destroy the
  person's own record, so the rule for adopted movements changes (Decision Log, open question 1).
- Editing a group expense rewrites the payer movement's amount, date and note (05d). For an adopted
  movement the note is the person's own text and must not be overwritten (open question 2).
- Budgets already leave a payer movement out of personal spending with a `not exists` probe on the link
  and count the payer's share instead, so linking is what moves the figures: no change to reports or
  `GET /groups/personal/shares` is needed. They match a group share to a personal budget by category NAME,
  so a Food movement sent under the group's "Other expenses" would drain the "Other expenses" budget and
  leave the Food budget untouched (verifier finding B1); the automatic category must therefore be the
  group category equivalent to the movement's own one (FR-18).
- A movement has no version counter; `PUT /movements/:id` can change its amount, account and date freely, so
  a linked movement could drift from its expense (open question 3).
- Movements that are not expenses (income, transfers, currency exchanges) cannot be sent. Card installments
  are not movements, and card statement payments and automatic debits are transfers, so they are excluded by
  the type rule. A movement made by a recurring payment or a device is an ordinary expense and may be sent.
- Groups are created with the default top-level expense categories seeded (`defaultKey` set, among them
  `other-expenses`, icon `ellipsis`, color `slate`), and the table has a unique partial index on
  `(group_id, default_key)`. Creating or editing a category is admin-only and categories can be archived,
  never deleted; the expense use cases refuse an archived category. A group can therefore lack a usable
  "Other expenses" category (an admin archived it, or the group predates the seeding).
- The group currencies are ARS and USD per expense, so the expense takes the account's currency; there is no
  currency mismatch to refuse.

## Goals
- A person turns a personal expense into a group expense without deleting or retyping anything.
- Balances, personal spending and receivables come out exactly as if the expense had been created in the
  group: nothing is counted twice and no movement is duplicated.
- A movement belongs to at most one group expense, even under concurrent requests.
- Deleting the group expense later never destroys the person's own movement.

## Functional Requirements
- FR-01: The system must show a "Send to group" icon action on each eligible row of the movements list, next
  to edit and delete and only while the device is online; it opens the send screen of that movement. The
  action must not live in the edit screen.
- FR-02: The system must treat as eligible only an expense movement on the user's own account that the
  server already holds and that is not linked to a group expense; a row whose movement is already linked
  shows an "In group X" marker instead of the action.
- FR-03: The system must show on the send screen the user's groups, let one tap choose one (preselecting it
  when the person has exactly one), and preselect the automatic category (FR-18: the group category equivalent
  to the movement's own, or "Other expenses") and a description that starts from the movement's note,
  with the amount, currency and date taken from the movement and shown but not editable.
- FR-04: The system must preselect the split as equal among all active members once a group is chosen, with
  the person as the payer, and let the person open the same split editor as the group expense form
  (equal, percentage or exact) to change it before sending.
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
- FR-14: The system must show every string of the action, its screen, the edit-screen notice, the home link
  and the list highlight in Spanish and English from the i18n catalogs, with amounts and dates from the
  locale formatters and every amount as an integer in minor units.
- FR-15: The system must show, on the edit screen of a movement linked to a group expense, a notice that the
  movement belongs to a group expense and which fields are locked (amount, account and date when the
  movement was adopted), and no send action.
- FR-16: The system must turn each row of the home screen's recent movements into a link that opens the
  movements list scrolled to that movement and highlighting it, where the same row actions exist.
- FR-17: The system must show the movements list normally, with no highlight and no error, when the movement
  to focus is not found among the rows or its id is not a valid id.
- FR-18: The system must, when a send names no category, resolve the group category inside the same
  transaction as the send, after the refusal checks: take the default key of the movement's own personal
  category, reduce it to its root key (the part before the first dot), and use the group's NON-archived
  category with that default key (no automatic marker). When the group has no such category (the equivalent
  is archived, the personal category is custom and has no default key, or the group lacks the equivalent),
  the system must fall back to the group's "Other expenses" default category: use it when active, restore it
  when archived and create it with its default key, icon and color when missing. The system never creates or
  restores any other category automatically, a category named in the request still wins, and a refused send
  leaves the categories untouched.
- FR-19: The system must let any member of the group send (the automatic category needs no admin role), must
  take the category's key, name, icon and color only from the server's defaults, never from the request, and
  must choose the equivalent category only from the movement's own data scoped by its owner, never from
  request input.
- FR-21: The system must prefill the description with a localized default ("Gasto" in Spanish, "Expense"
  in English) when the movement has no note, keep it editable, and refuse a description the person clears,
  because the API requires a description when the movement has no note.
- FR-20: The system must record, on the creation entry of the activity log and attributed to the sender, that
  the category was created or restored automatically, answer the send with that fact, and show the person a
  one-line notice in Spanish and English.

## Non-Functional Requirements
- NFR-01: The send screen, the movements list rows with the new icon and marker, and the home recent rows
  must render without horizontal scrolling at a 360 px wide viewport, verified by an end-to-end test at that
  width.
- NFR-02: The send screen must load with 3 API requests before a group is chosen (the movement, the groups
  and the movement's account, because the movement carries no currency) and 1 more after (the expense
  options), so 4 loading requests when the only group is preselected, and the send itself must be 1 request
  (5 in the whole visit), each verified by a test that counts the calls.
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
- NFR-08: From the movements list to a recorded send must take at most 3 taps with the default split (the
  icon, the group, the confirmation; 2 taps when the person has one group), verified by an end-to-end test
  that counts the interactions.
- NFR-10: When 20 different movements are sent at the same time to a group that has no "Other expenses"
  category, the group must end with exactly 1 such category row and 20 expenses that use it, verified by an
  integration test against PostgreSQL.
- NFR-09: The home screen must make 0 more API requests than today, and the movements list at most 1 more
  (the person's groups, only when a loaded row is linked to a group expense), verified by tests that count
  the calls; opening the list with a `focus` id must cost no request beyond opening it without one.

## Acceptance Criteria
*(EARS)*
- AC-01 (FR-01): WHEN the movements list shows an eligible expense movement while online, THE system SHALL
  show on its row a "Send to group" icon action, next to edit and delete, whose accessible name includes the
  movement's title.
- AC-02 (FR-01): IF the device is offline, THEN THE system SHALL not offer the action on any row, and the
  send screen, if opened by address, SHALL say that sending to a group needs a connection.
- AC-03 (FR-02): IF the movement is income, a transfer or a currency exchange, THEN THE system SHALL show no
  action and, at the API, SHALL refuse the send with a message that only expenses can be sent.
- AC-04 (FR-02): IF the movement is still waiting in the device queue and the server does not hold it yet,
  THEN THE system SHALL show no action until it has synced.
- AC-05 (FR-02): IF the movement is already linked to a group expense, THEN THE system SHALL show no action
  on its row and show an "In group X" marker with the group's name, or "In a group" when the person no longer
  sees that group.
- AC-06 (FR-03): WHEN the person taps the icon, THE system SHALL open the send screen of that movement
  showing its amount, currency and date as text and the groups the person belongs to, one tap choosing one.
- AC-07 (FR-03): WHEN the person chooses a group, THE system SHALL list that group's categories with the
  automatic option chosen, labelled in Spanish 'Automática (la misma categoría del movimiento u "Otros
  gastos")' and in English as the same category as the movement or "Other expenses", and prefill
  the description with the movement's note, cut to the 200 characters a group description allows, or with
  the localized default when the movement has no note (AC-54).
- AC-08 (FR-03): IF the person belongs to no group, THEN THE system SHALL say so and link to the groups
  list.
- AC-09 (FR-03): IF the description is empty, THEN THE system SHALL show a field error and not send.
- AC-10 (FR-04): WHEN the person opens the split editor and chooses equal, percentage or exact, THE system
  SHALL show the same split fields as the group expense form.
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
- AC-19 (FR-08): IF a category sent in the request does not belong to the group or is archived, THEN THE system SHALL refuse
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
  the action, the screen, its refusals, the edit-screen notice, the home link and the list highlight in
  that language.
- AC-35 (FR-03): WHEN the person has exactly one group, THE system SHALL preselect it on the send screen and
  load its categories and members without a tap.
- AC-36 (FR-04): WHEN a group is chosen, THE system SHALL preselect the split as equal among all its active
  members, so a 40,000.00 ARS movement in a group of 4 is ready to send as 10,000.00 ARS each.
- AC-37 (FR-04): WHEN the person has chosen a group and the preselected category, description and split are
  valid, THE system SHALL send with one tap on the confirm button and no other input.
- AC-38 (FR-04): WHEN the person opens the split editor and changes the split, THE system SHALL send that
  split instead of the preselected one.
- AC-39 (FR-15): WHEN the person opens the edit screen of a movement adopted by a group expense, THE system
  SHALL show a notice that it belongs to a group expense, name the locked fields (amount, account and date)
  and show them as read-only text, with no "Send to group" action on the screen.
- AC-40 (FR-15): WHEN the person opens the edit screen of a movement linked to a group expense that was
  created in the group, THE system SHALL show the notice that it belongs to a group expense and leave every
  field editable.
- AC-41 (FR-16): WHEN the person opens a row of the home screen's recent movements, THE system SHALL open
  the movements list scrolled to that movement and highlighting it, with the same row actions as any row.
- AC-42 (FR-16): WHEN a home row is read by a screen reader or reached by keyboard, THE system SHALL expose it
  as one link with an accessible name that includes the movement's title, with no interactive element
  inside the link, and the highlighted list row SHALL be marked as such in text and not only by color.
- AC-43 (FR-17): IF the movement to focus is not among the rows of the list, THEN THE system SHALL show the
  list without highlight and without an error.
- AC-44 (FR-17): IF the `focus` value is not a valid id, THEN THE system SHALL ignore it and show the list
  without highlight and without an error.

- AC-45 (FR-18): WHEN a send names no category, the movement has no equivalent group category and the group
  has no "Other expenses" category, THE system SHALL create it with its default key, icon and color, use it for the expense and answer that it was
  created.
- AC-46 (FR-18): WHEN a send names no category, the movement has no equivalent group category and the
  group's "Other expenses" category is archived, THE system SHALL restore it, use it for the expense and answer that it was restored.
- AC-47 (FR-18): WHEN a send names no category, the movement has no equivalent group category and the
  group's "Other expenses" category is active, THE system SHALL use it, create and restore nothing and answer that nothing was changed.
- AC-48 (FR-18): IF two sends reach a group without the category at the same time, THEN THE system SHALL
  leave exactly one "Other expenses" category row and both expenses SHALL use it.
- AC-49 (FR-18): IF a send is refused for any reason, THEN THE system SHALL leave the group's categories as
  they were, so no category is created or restored by a refused send.
- AC-50 (FR-19): WHEN a member who is not an admin of the group sends a movement to a group without the
  category, THE system SHALL accept the send and create the category.
- AC-51 (FR-19): IF the request carries a category name, icon, color or key, THEN THE system SHALL refuse it
  as invalid, and the created category SHALL have the default key, the default icon and color and no custom
  name.
- AC-52 (FR-20): WHEN the category is created or restored by a send, THE system SHALL add to the creation
  entry of the activity log a marker of that action next to the sender and the time, and show it to
  members as text.
- AC-53 (FR-20): WHEN the send answers that the category was created or restored, THE system SHALL show
  the person a one-line notice in Spanish or English, with no amount in it.

- AC-54 (FR-21): WHEN the movement has no note, THE system SHALL prefill the description with the localized
  default ("Gasto" or "Expense"), editable, so the send still takes one tap on the confirm button.
- AC-55 (FR-21): IF the person clears the description, THEN THE system SHALL show a field error on it and not
  send anything.
- AC-56 (FR-18): WHEN a send names no category and the movement's personal category has a default key whose
  root key matches a non-archived category of the group (for example Food), THE system SHALL use that group
  category, create and restore nothing and answer that nothing was changed.
- AC-57 (FR-18): WHEN the movement's category has a sub-category default key (for example `food.restaurants`),
  THE system SHALL use the group category of its root key (`food`).
- AC-58 (FR-18): IF the group category equivalent to the movement's own is archived, THEN THE system SHALL
  fall back to "Other expenses" (use, restore or create it) and SHALL NOT restore the archived equivalent.
- AC-59 (FR-18): IF the movement's personal category is custom and has no default key, THEN THE system SHALL
  fall back to "Other expenses".
- AC-60 (FR-18): IF the group has no category with the equivalent default key, THEN THE system SHALL fall
  back to "Other expenses" and SHALL NOT create the equivalent.
- AC-61 (FR-18): WHEN a send names a category that is valid for the group, THE system SHALL use it and not
  derive one from the movement.
- AC-62 (FR-06, FR-18): WHEN a Food movement is sent with the automatic category to a group whose Food
  category is active, THE system SHALL keep counting the person's share in the sender's Food budget
  (matched by category name) and SHALL NOT count it in the "Other expenses" budget.

## Out of Scope
- Income, transfers and currency exchanges: only expense movements are sent.
- Sending to a group where another member paid: the person is always the payer, the same rule as an
  expense recorded in the group with the caller's account.
- Sending several movements at once (bulk) and sending the same movement to two groups.
- Undoing the send after a settlement touched the balances: deleting the group expense is the only way back,
  under the 05d rules (a member who left blocks it with 409).
- Offline use: group screens are online only (PRD 05 decision), so the action is not queued.
- Turning a group expense back into a personal-only movement beyond the detach on deletion.
- Choosing a different group category per member: the category belongs to the expense, not to each member's
  share.
- Letting the sender name, rename or style the automatic category, and a separate category entry in the
  activity log: the creation entry carries the fact.
- A movement detail screen: the list row carries the action, and the edit screen only shows the notice.
- Finding a focused movement beyond the first page of the list: the list then shows without highlight.
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
- **A Food movement sent under "Other expenses" drains the wrong budget** (verifier finding B1) -> budgets
  match a share to a personal budget by category name, so the automatic category is the group category
  equivalent to the movement's own (root default key), falling back to "Other expenses" only when there is
  no active equivalent; the HTTP budget test proves the Food budget keeps counting the share (FR-18, AC-56,
  AC-62).
- **The default category or split is wrong for the person and they send without looking** → both are shown
  on the screen before the confirm button, the description and the split summary are visible text, and the
  split editor is one tap away (FR-03, FR-04).
- **A member creates categories without being an admin through the send** -> the system action is limited
  to one fixed default key, with its default icon and color and no name taken from the request; the
  unique index makes it idempotent (FR-19, AC-50, AC-51).
- **An admin archived "Other expenses" on purpose and sends restore it** (only when there is no active
  equivalent category) -> stated as a proposed decision
  (Decision Log) with the fallback to the first active category; the admin can archive it again, and the
  log entry shows the restoration (FR-18, FR-20).
- **The `focus` value of the address is hostile or malformed** → it is validated as a uuid, never rendered,
  and used only to find a loaded row (FR-17, AC-44).
- **A float slips into money** → amounts stay integers in minor units and go through the shared helpers
  (NFR-05).

## Dependencies
- DISC-001-05a (groups and their categories) — the default categories seeded at group creation, their unique
  `(group, default key)` index and the archive rule.
- DISC-001-05b (group expenses and splits) — the expense, its shares, the payer movement link and the
  activity entry that this ticket reuses.
- DISC-001-05d (editing rules and activity log) — the edit and delete behaviour that this ticket changes for
  adopted movements.
- DISC-001-05f (group expense screens) — the split editor, the default split and the expense options that the
  send screen reuses.
- DISC-001-03 (movements) — the movement, its edit rules, the movements list rows that gain the icon action
  and the marker, and the edit screen that gains the lock notice.
- FEAT-005 (redesign of the home screen) — the home screen's recent movements, whose rows become links.
- DISC-001-06b (budgets) — its spending reader already skips payer movements through the link.
- DISC-001-04c to 04e (offline queues) — a queued edit of a locked movement must surface as failed.
- Database change: a unique index on the movement link and a marker of an adopted movement on
  `group_expenses`; migration `0037_group_expense_from_movement` (06d merged as 0036), its journal `when` must
  exceed the maximum on `main` when it merges.
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
- 2026-10-11: Owner decision (UX change after reading the spec; verified against the code: there is no
  movement detail screen and the home recent rows are not clickable). (1) "Send to group" is an icon action on
  each eligible row of the movements list, next to edit and delete, and an already-adopted movement shows an
  "In group X" marker; it is not in the edit screen, which only shows a notice of the link and the locked
  fields. (2) The icon opens `/movements/send?id=`, the split is preselected as equal among all active
  members once a group is chosen, and a single group is preselected: icon, group, confirm is at most 3 taps
  (NFR-08). (3) New: the home recent rows become links to `/movements?focus=<id>`, which opens the list
  scrolled to and highlighting that movement. FR-01 to FR-04 and AC-01, AC-02, AC-05 to AC-07, AC-09 and AC-10
  were rewritten; FR-15 to FR-17, NFR-08, NFR-09 and AC-35 to AC-44 were added; the five earlier owner
  decisions stand. Assumption to confirm: the preselected group category is "Other expenses" (needed to meet
  3 taps; deriving it from the movement's own category stays out of scope).
- 2026-10-11: Owner decision (resolves the assumption above): the send-to-group flow keeps the group category
  automatic, with no category step (3 taps), and when the group has no usable "Other expenses" category the
  system creates it for the group. Verified in code: the key is `other-expenses` (icon `ellipsis`, color
  `slate`); group categories are created from the defaults at group creation; the unique partial index on
  `(group_id, default_key)` makes creation idempotent; creating and editing categories is admin-only and
  expense use cases refuse archived categories. Rule: inside the send's transaction the server resolves the
  category; missing, it inserts it with the default key, icon and color (a concurrent insert is absorbed by
  the index); archived, it un-archives it. It is a system action that needs membership only, since the
  category is never user-supplied (fixed key, no name input: no privilege escalation, no name squatting). The
  log has no category actions, so the fact travels on the expense creation entry (smaller change than new
  actions). FR-18 to FR-20, NFR-10 and AC-45 to AC-53 were added; FR-03, FR-08, AC-07, AC-09 and AC-19 were
  adjusted.
- 2026-10-11: Owner decision (approved 2026-10-11): when the category exists but is archived, the send
  restores it (an admin who archived it on purpose can archive it again, and the log shows the restoration).
  Alternative: do not touch an archived category and fall back to the first active category (a send then
  fails only when the group has no active category, which cannot be fixed without an admin).
- 2026-10-11: Implementation finding, proposed by the model, awaiting the owner's ratification: (1) the
  migration is `0037_group_expense_from_movement` (journal `when` 1791810000000), not 0036, because `main`
  already has `0036_budget_alert_marks` from 06d; its rollback script is `0037_group_expense_from_movement.down.sql`.
  (2) NFR-02 changes to 3 requests before a group is chosen (the movement, the groups and the movement's
  account, since the movement carries no currency), 1 after and 1 to send; with a single group the loads are
  4 in total; NFR-08 (3 taps) is unchanged. (3) A movement without a note gets the description prefilled with
  the localized default ("Gasto" / "Expense", key `movements.sendToGroup.defaultDescription`), editable; clearing
  it on purpose is refused with a field error and nothing is sent, because the API requires a description when
  the movement has no note: FR-21, AC-54, AC-55. (4) The rollback script is guarded with `to_regclass` so it is
  idempotent after older rollbacks dropped the group tables.
- 2026-10-11: Owner decision (approved by the owner, 2026-10-11, after verifier finding B1): when a movement
  is sent WITHOUT a category, the server picks the group category EQUIVALENT to the movement's own personal
  category and falls back to the default "Other expenses" category (create or restore, as before) only when
  there is no equivalent. Reason: budgets match a group share to a personal budget by category name, so
  sending Food spending under "Other expenses" would drain the Food budget. Rule: inside the send
  transaction, after the refusal checks, take the movement's personal category default key, reduce it to its
  root key (before the first dot); if the group has a non-archived category with that default key use it (no
  automatic marker); otherwise (archived equivalent, custom personal category without default key, group
  without the equivalent) fall back to the `other-expenses` resolver; the server never creates or restores any
  other category automatically; a category named in the request still wins. The web option label reads in
  Spanish 'Automática (la misma categoría del movimiento u "Otros gastos")'. FR-03, FR-18, FR-19, AC-07 and
  AC-45 to AC-47 were adjusted, AC-56 to AC-62 added, and the Out of Scope line that excluded deriving the
  category was replaced. PRD loops 4; loops since the last human decision 0 because a human decided.

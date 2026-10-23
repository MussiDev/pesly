# PRD FEAT-014: Group activity notices and push notifications

| Field | Value |
|-------|-------|
| Ticket | FEAT-014 |
| Tracker | none |
| Date | 2026-10-23 |
| PRD loops | 0 |
| Loops since last human decision | 0 |

## Context and Problem

When a member records an expense or a settlement in a group, the other members only find out the
next time they open the group. The push pipeline of DISC-001-08d already delivers every stored
notice to each device where its owner enabled notifications (fan-out, delivery queue with retries,
service worker that shows the notification and opens a link on a tap). It only knows the notice
kinds of recurring payments, card statements and budgets.

This change stores a notice for each member a new group expense or settlement involves, so the
existing pipeline pushes it to their phone (a PWA installed on the Home Screen on iPhone and iPad,
or any supported browser on Android and desktop) and a tap opens the group.

## Goals

- A member learns, on their devices, that someone else added an expense or recorded a payment that
  involves them.
- The member who recorded it is never notified about their own record.
- No amount, description or account name reaches the notice or the push.
- The push opens the group the notice is about.

## Functional Requirements

- FR-01: Recording a group expense must store one `group_expense` notice for each registered,
  active member who pays it or holds a share of it, except the member who recorded it.
- FR-02: Recording a group settlement must store one `group_settlement` notice for its payer and
  its receiver, except the member who recorded it.
- FR-03: A ghost member, a former member and a member the record does not involve must get no
  notice.
- FR-04: The notice must be stored in the same transaction as the expense or settlement: a refused
  or rolled back write leaves no notice.
- FR-05: The notice text must name who recorded it and the group, in the recipient's interface
  language: "Bob agregó un gasto en Casa" / "Bob added an expense in Casa", "Bob registró un pago en
  Casa" / "Bob recorded a payment in Casa". A recorder without a display name is "Un integrante" /
  "A member".
- FR-06: The notice date must be the recording day in the recipient's time zone; the notices list
  shows it as "Registrado el {date}" / "Recorded on {date}".
- FR-07: The push of a group notice must link to `/{locale}/groups/{groupId}`; every other kind keeps
  linking to the notices screen.
- FR-08: Sending an existing movement to a group (DISC-001-05i) records an expense and must notify as
  FR-01.

## Non-Functional Requirements

- NFR-01: The text takes no amount, description or account name (AGENTS.md "Do not show amounts or
  account names in push notification text").
- NFR-02: Notices are written in the request path with no external call; delivery stays in the
  worker (DISC-001-08d).
- NFR-03: The migration is additive except for replacing the notices unique key; its rollback
  deletes only the group notices.

## Data model

Migration `0041_group_notices`:

- `notices.kind` accepts `group_expense` and `group_settlement`.
- `notices.group_id uuid null`, set exactly for the group kinds (`notices_group_id_check`); no
  foreign key, like `payment_id`.
- The unique key `(kind, payment_id, due_date)` becomes `(owner_id, kind, payment_id, due_date)`:
  one expense is one notice per member. The other kinds have a single owner per subject, so their
  duplicate rule is unchanged.

## Acceptance Criteria

- AC-01: Bob records an expense paid by Ana and split among Ana, Bob and the ghost Pedro: Ana gets one
  `group_expense` notice with the group id; Bob and Pedro get none. *(FR-01, FR-03)*
- AC-02: Ana records an expense that involves only Pedro and herself: no notice is stored. *(FR-03)*
- AC-03: An English recipient in Buenos Aires gets "Bob added an expense in Casa" dated on the local
  day. *(FR-05, FR-06)*
- AC-04: A refused expense stores no notice. *(FR-04)*
- AC-05: Ana records a settlement from Bob to Ana: Bob gets a `group_settlement` notice, Ana none.
  *(FR-02)*
- AC-06: The notice text never contains the amount or the description. *(NFR-01)*
- AC-07: The push of a group notice has the url `/{locale}/groups/{groupId}`. *(FR-07)*
- AC-08: The migration is reverted by its idempotent rollback, which deletes only the group notices,
  and re-applies. *(NFR-03)*

## Out of Scope

- Notices for edits and deletions of expenses and settlements.
- Notices for invitations, joins, removals and ghost claims.
- Muting a group or choosing which group events notify.
- Opening the group from the in-app notices list (the list does not carry the group id yet).

## Dependencies

- DISC-001-08c (notices), DISC-001-08d (push), DISC-001-05b and 05g (group expenses and settlements).

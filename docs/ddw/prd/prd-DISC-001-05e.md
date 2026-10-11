# PRD DISC-001-05e: Groups Screens, Members and Invitations

| Field | Value |
|-------|-------|
| Ticket | DISC-001-05e |
| Tracker | none |
| Date | 2026-10-11 |
| PRD loops | 0 |
| Loops since last human decision | 0 |

## Context and Problem
First of four web sub-tickets of PRD 05 (parent index: `prd-DISC-001-05.md`; 05f expenses, 05g balances
and settlements, 05h editing, activity and conflicts). The groups API is complete (05a to 05d) and the
offline conflict layer exists (04e), but the web app has no group screen: `/groups` shows a "coming
soon" placeholder, so nobody can create a group, invite someone or join one. This ticket builds the
screens for groups, members, invitations, claim links, roles and group categories, on top of the
existing API. It adds no endpoint.

## Goals
- A user can create a group, see their groups and open one.
- A member can invite people, add a member without an account and see who is in the group.
- Someone with an invitation or claim link can join or claim a place from the link.
- Admins can manage roles, members, the default rate type and the group categories.
- A member can leave when their balance is 0.

## Functional Requirements
- FR-01: The system must replace the groups placeholder with a list of the user's groups, each showing
  its name, the user's role and the member count.
- FR-02: The system must show an empty state with a "create group" action and a "join with a link"
  hint when the user has no groups.
- FR-03: The system must let the user create a group by entering a name and choosing the default rate
  type, and open it afterwards.
- FR-04: The system must show a group's members with display name, role and a marker for members
  without an account, and list the members who left separately.
- FR-05: The system must let a member generate an invitation link and show it with its expiry date and
  a copy action.
- FR-06: The system must provide a join page that reads the invitation token from the link, joins the
  user to the group and opens it.
- FR-07: The system must let a member add a member without an account by entering a display name.
- FR-08: The system must let a member generate a claim link for a member without an account, and
  provide a claim page that reads the token and assigns that place to the user.
- FR-09: The system must let an admin promote a registered member to admin, remove a member, and change
  the default rate type.
- FR-10: The system must hide the admin actions from members who are not admins.
- FR-11: The system must let a member leave the group, and when the balance is not 0 show the
  outstanding amounts per currency instead of leaving.
- FR-12: The system must list the group categories (archived ones marked) and let an admin create,
  edit and archive them.
- FR-13: The system must show every string in Spanish and English from the i18n catalogs.

## Non-Functional Requirements
- NFR-01: Each screen must render without horizontal scrolling at a 360 px wide viewport, verified by
  an end-to-end test at that width.
- NFR-02: Each screen must load its data with at most 2 API requests, verified by a test that counts
  the calls.
- NFR-03: The Spanish and English catalogs must have 0 missing or empty keys, verified by the existing
  catalog parity test.
- NFR-04: An invitation or claim token must be gone from the address bar within 1 second of the page
  opening, and appear in 0 browser history entries, verified by a test that inspects the address and the
  history.

## Acceptance Criteria
*(EARS)*
- AC-01 (FR-01): WHEN a user opens the groups page, THE system SHALL list their groups with name,
  role and member count.
- AC-02 (FR-02): WHILE a user has no groups, THE system SHALL show the empty state with the "create
  group" action.
- AC-03 (FR-03): WHEN a user submits a name and a default rate type, THE system SHALL create the group
  and open its detail.
- AC-04 (FR-03): IF the name is empty or longer than the allowed length, THEN THE system SHALL show a
  field error and not send the request.
- AC-05 (FR-04): WHEN a member opens a group, THE system SHALL show its members with their roles and
  mark the ones without an account, and list former members apart.
- AC-06 (FR-05): WHEN a member asks for an invitation link, THE system SHALL show the link with its
  expiry date and let them copy it.
- AC-07 (FR-06): WHEN a user opens a valid invitation link, THE system SHALL join them to the group
  and open it.
- AC-08 (FR-06): IF the invitation link is expired or invalid, THEN THE system SHALL say so and offer
  to go back to the groups list.
- AC-09 (FR-06): IF the user is already a member or the group is full, THEN THE system SHALL show that
  specific message and not join them twice.
- AC-10 (FR-07): WHEN a member adds a person without an account, THE system SHALL show them in the
  members list with the marker.
- AC-11 (FR-08): WHEN a user opens a valid claim link, THE system SHALL assign that place to them and
  open the group.
- AC-12 (FR-08): IF the claim link was already used or is invalid, THEN THE system SHALL say so and not
  change the group.
- AC-13 (FR-09): WHEN an admin promotes a registered member, THE system SHALL show the member as admin.
- AC-14 (FR-09): IF an admin removes a member whose balance is not 0, THEN THE system SHALL show the
  balance and keep the member.
- AC-15 (FR-10): WHILE the user is not an admin of the group, THE system SHALL not show the admin
  actions.
- AC-16 (FR-11): WHEN a member with balance 0 leaves, THE system SHALL remove the group from their list.
- AC-17 (FR-11): IF a member with a balance other than 0 tries to leave, THEN THE system SHALL show the
  amount per currency and keep them in the group.
- AC-18 (FR-11): IF the only admin tries to leave while other members remain, THEN THE system SHALL ask
  them to promote someone first.
- AC-19 (FR-12): WHEN an admin creates, edits or archives a category, THE system SHALL show the change
  in the list.
- AC-20 (FR-13): WHERE the interface language is Spanish or English, THE system SHALL show every group
  string in that language.

## Out of Scope
- Expenses, splits, balances, settlements, the activity log and conflict resolution (05f to 05h).
- Renaming or deleting a group: the API has no such endpoint.
- Offline use of any group screen, and offline creation of groups or members (PRD 05 decision).
- Sharing through QR codes, contacts or messaging apps beyond copying the link and the browser share
  sheet when available.
- Notifications about invitations or joins.

## Risks and Mitigations
- **Invitation tokens leak through the address bar or history** → the token is read once and removed
  from the address (NFR-04); the page never renders it back.
- **A group UI nobody can reach** → the navigation entry, the bottom-bar slot and the home shortcut
  already exist; the shortcut stops being flagged "in creation".
- **Admin actions shown to the wrong people** → hidden by role (FR-10), and the API still answers 403,
  which the screens must display.
- **Large surface in one ticket** → one container per screen with the shared patterns of the recurring
  payments feature; no new dependency.

## Dependencies
- DISC-001-05a to 05d (the groups API) — all merged or in review.
- DISC-001-04e (draft PR #53) — the api-client group methods and the `groupConflict` catalog this
  ticket builds beside. This ticket branches from it.
- FEAT-004 (design system) — the components and tokens every screen uses.
- PRD 01 (identity, language) — the session and the interface language.

## Decision Log
- 2026-10-11: The group web UI is split into 05e (this one), 05f, 05g and 05h, mirroring the API split,
  so each can be merged on its own. Proposed by the model, awaiting the owner's acceptance.
- 2026-10-11: Group categories are managed in this ticket, not in 05f, because they belong to the group
  itself and the expense form (05f) only reads them.

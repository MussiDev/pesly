# PRD DISC-001-05a: Groups, Members and Roles

| Field | Value |
|-------|-------|
| Ticket | DISC-001-05a |
| Tracker | none |
| Date | 2026-10-10 |
| PRD loops | 0 |
| Loops since last human decision | 0 |

## Context and Problem
First of four sub-tickets of Groups & Expense Splitting (parent index: `prd-DISC-001-05.md`).
Users share expenses in households and ad-hoc groups, and some participants will never install the
app. Before any expense can be split, the system needs the group itself: who belongs to it, who can
administer it, how people join (by invitation, or as a ghost member without an account that is
claimed later) and how access is limited to members. This ticket creates the `groups` module and
its membership model. Expenses and splits are DISC-001-05b; balances and settlements are
DISC-001-05c; editing rules and the activity log are DISC-001-05d. Split from
`prd-DISC-001-05.md` (2026-10-10, user decision). Requirement IDs were renumbered; the parent index
maps every original ID to its new one.

## Goals
- One "group" concept covering households and ad-hoc groups (concept decision).
- Join by invitation link, or be added as a ghost member who can claim their place later.
- Protect group data: only members read or change it, and only admins manage categories and the
  default rate type.

## Functional Requirements
- FR-01: The system must allow a user to create a group with a name and a default rate type, and
  must make the creator an admin of that group.
- FR-02: The system must create for every new group the expense categories listed in Appendix A of
  PRD 02 (top level only).
- FR-03: The system must allow any member to generate an invitation link to the group that expires
  7 days after it is generated.
- FR-04: The system must add a registered user as a member of the group when they open a valid
  invitation link and accept it.
- FR-05: The system must allow any member to add a ghost member to the group with only a display
  name.
- FR-06: The system must allow any member to generate a claim link for a ghost member.
- FR-07: The system must replace a ghost member with a registered user who opens and accepts a
  valid claim link, keeping the identity of that member inside the group so every record attached
  to it follows the user.
- FR-08: The system must allow an admin to make another registered member an admin.
- FR-09: The system must allow an admin to change the group's default rate type.
- FR-10: The system must allow only admins to add, rename and archive group categories.
- FR-11: The system must allow only members of a group to read or change any data of that group,
  and must list for a user only the groups they belong to.

## Non-Functional Requirements
- NFR-01: A group must have at most 50 members, ghost members included.
- NFR-02: Invitation and claim link tokens must carry at least 128 bits of randomness, and claim
  link tokens must be single-use.

## Acceptance Criteria
- AC-01 (FR-01): WHEN a user creates a group with a name and a default rate type, THE system SHALL
  create it and make that user its first admin.
- AC-02 (FR-01): IF a user creates a group with an empty name, THEN THE system SHALL reject it.
- AC-03 (FR-02): WHEN a group is created, THE system SHALL create for it the top-level expense
  categories of PRD 02 Appendix A.
- AC-04 (FR-03): WHEN a member generates an invitation link, THE system SHALL return a link that
  expires 7 days later.
- AC-05 (FR-04): WHEN a registered user opens a valid invitation link and accepts it, THE system
  SHALL add them as a member of the group.
- AC-06 (FR-04): IF a user opens an expired invitation link, THEN THE system SHALL reject it and
  add no member.
- AC-07 (FR-04): IF a user who is already a member opens a valid invitation link, THEN THE system
  SHALL not add a second membership.
- AC-08 (FR-04): IF a group already has 50 members and a user accepts a valid invitation link, THEN
  THE system SHALL reject it and add no member.
- AC-09 (FR-05): WHEN a member adds a ghost member named "Pedro", THE system SHALL add a member
  "Pedro" with no account who can later be payer and part of splits.
- AC-10 (FR-05): IF a group already has 50 members and a member adds a ghost member, THEN THE
  system SHALL reject it.
- AC-11 (FR-06): WHEN a member generates a claim link for a ghost member, THE system SHALL return
  a single-use link bound to that ghost member.
- AC-12 (FR-07): WHEN a registered user opens a valid claim link and accepts it, THE system SHALL
  replace the ghost member with that user in the member list, keeping the member's position and
  identity in the group.
- AC-13 (FR-07): IF a user opens a claim link that was already used, THEN THE system SHALL reject
  it.
- AC-14 (FR-07): IF a user who is already a member of the group accepts a claim link, THEN THE
  system SHALL reject it and leave the ghost member unchanged.
- AC-15 (FR-08): WHEN an admin makes a registered member an admin, THE system SHALL grant that
  member admin permissions in the group.
- AC-16 (FR-08): IF a member who is not an admin tries to make another member an admin, THEN THE
  system SHALL reject it.
- AC-17 (FR-09): WHEN an admin changes the group's default rate type, THE system SHALL store the
  new type and leave existing records unchanged.
- AC-18 (FR-09): IF a member who is not an admin tries to change the default rate type, THEN THE
  system SHALL reject it.
- AC-19 (FR-10): WHEN an admin adds, renames or archives a group category, THE system SHALL apply
  the change.
- AC-20 (FR-10): IF a member who is not an admin tries to add, rename or archive a group category,
  THEN THE system SHALL reject it.
- AC-21 (FR-11): IF a user who is not a member of a group requests any of its data, THEN THE
  system SHALL answer 404 Not Found.
- AC-22 (FR-11): WHEN a user opens their group list, THE system SHALL show only the groups they are
  a member of.

## Out of Scope
- Group expenses and splits (DISC-001-05b).
- Balances, settlements, removing members and leaving a group (DISC-001-05c).
- Editing and deleting group records and the activity log (DISC-001-05d).
- Removing a member or leaving a group: both depend on balances (DISC-001-05c).
- Replacing a deleted account with a "Former member" (DISC-001-05c).
- Transferring the history of a claimed ghost member: the member keeps its identity here, and each
  later sub-ticket proves that its records follow it.
- Deleting a group.
- Groups with more than 50 members.
- Email or push notifications of group activity (PRD 08 covers reminders).

## Risks and Mitigations
- **An invitation link is forwarded to the wrong person** → links expire in 7 days (FR-03) and
  carry at least 128 bits of randomness (NFR-02); removing a member is DISC-001-05c.
- **A claim link is used by the wrong person** → single-use token (NFR-02); the real person sees
  the full history after claiming.
- **The group has no admin** → the creator is admin (FR-01) and admins can promote others (FR-08);
  rules for the last admin leaving are decided with DISC-001-05c, which owns leaving.
- **The migration collides with another branch's** → this ticket adds the first group tables; its
  number is assigned at PLAN from `main`, and its journal `when` must exceed the maximum `when` on
  `main` at merge time, or a database that already ran a newer migration skips it silently (same
  rule as DISC-001-03c and 03d).

## Dependencies
- PRD 01 (Identity & Access) — registered users (FR-04, FR-07) and access control (FR-11); merged.
- PRD 02 (Accounts & Categories) — the default category list (FR-02, FR-10); merged.
- PRD 03 (Movements & Exchange Rates) — rate types (FR-01, FR-09); merged.
- Database migration: assigned at PLAN; its journal `when` must be greater than the maximum on
  `main` when it merges.

## Decision Log
- 2026-09-25: Households are permanent groups; no shared pot (original PRD 05, concept).
- 2026-09-25: Ghost members allowed, claimable by invitation (original Decision Log).
- 2026-09-25: User approved 7-day invitation links, single-use claim links, any member invites and
  adds ghosts, group-level categories managed by admins and 50 members max (original Decision Log).
- 2026-10-10: Parent PRD split into DISC-001-05a to 05d by user decision.
- 2026-10-10: The original AC-07 and FR-07 are divided: the member keeps its identity here, and the
  history following the user is proved in 05b (expenses and shares) and 05c (settlements). Listed
  in the parent index.

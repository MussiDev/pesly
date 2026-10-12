# Threat model DISC-001-05i: Send an Existing Movement to a Group

| Field | Value |
|-------|-------|
| Ticket | DISC-001-05i |
| Spec | docs/ddw/specs/spec-DISC-001-05i.md |
| Tier | FEATURE |
| Date | 2026-10-11 |

## Components
| Component | Source in the spec |
|---|---|
| `POST /groups/:id/expenses/from-movement` route and `send-movement-to-group.ts` | Blocks 3, 6 (`apps/api/src/groups/application/send-movement-to-group.ts`) |
| `drizzle-group-expense-repository.ts` and the unique index `group_expenses_payer_movement_unique` | Blocks 2, 4 (`apps/api/src/groups/infrastructure/db/drizzle-group-expense-repository.ts`, migration 0036) |
| `drizzle-movement-repository.ts` edit lock behind `PUT /movements/:id` | Block 5 (`apps/api/src/movements/infrastructure/db/drizzle-movement-repository.ts`; also the queued edits the sync pass replays through it) |
| `drizzle-payer-movement-recorder.ts` (adoption lock, propagation, detach on delete) | Block 4 (`apps/api/src/groups/infrastructure/movements/drizzle-payer-movement-recorder.ts`) |
| `GET /movements/:id` detail answer and `GET /movements` list `groupLinks` | Block 5 |
| Activity log markers `group_activity_log.from_movement` and `auto_category` | Blocks 2, 4, 11 (migration 0036 and the activity presenter) |
| Automatic category resolver `ensure-default-category.ts`, called inside the send transaction | Blocks 15, 4 (`apps/api/src/groups/infrastructure/db/ensure-default-category.ts`; D18) |
| Web: `api-client.ts`, `features/movements/send-to-group/*` and `edit-movement-container.tsx` | Blocks 7, 8, 9, 10 |
| Web: movements list send icon, marker and `focus` query (`movements-container.tsx`) | Block 12 |
| Web: home recent-movement links (`recent-movements.tsx`) | Block 13 |

## Trust boundaries
- Browser → API send: `POST /groups/:id/expenses/from-movement` takes a group id from the path and a movement
  id, category, description and split from the body. Every one is a claim; the API checks membership of the
  group, ownership of the movement, its type, its link, the category and the split members, and answers 404
  for anything the caller may not see.
- API use case → PostgreSQL under concurrency: the group row, the member rows and the movement row are locked
  in one order inside a transaction; the unique index is the backstop when two transactions disagree.
- Groups module → movements data: the payer recorder reads and rewrites a movement through the movements
  repository under the payer's own owner scope, never the editor's; this is the only group-side write into
  `movements` and it passes an explicit lock bypass.
- Browser or device queue → `PUT /movements/:id`: a queued edit written offline crosses to the server later,
  when the movement may have been adopted; the repository decides, not the device.
- Group member → payer's movement: an author or admin editing an adopted expense propagates amount and date to
  a movement owned by another user.
- API → rendered page: the activity entries, group names and descriptions written by other members are
  untrusted text rendered in this user's page; the new marker is a boolean and carries no text of its own.
- Address bar → movements list: the `focus` query value is untrusted input typed or pasted by anyone (a
  shared or crafted link). It is validated as a uuid, compared only with ids of rows already loaded under the
  caller's own scope, never sent to the API and never rendered, so it can neither read nor reveal anything.
- Member → group category table: a send with no category makes the server create or restore the group's
  "Other expenses" default on behalf of a caller who may not be an admin. The key, icon and color are
  server constants and nothing about the category comes from the request; the caller only needs membership.
- Error body → client: refusals travel as a code only; the client turns a code into catalog text.

## STRIDE analysis
### `POST /groups/:id/expenses/from-movement` route and `send-movement-to-group.ts`
- **Spoofing:** the caller is the session user from `requireSession` and `requireVerifiedEmail`; the payer is
  always the caller's own active member, never read from the body (the strict schema rejects `payerMemberId`),
  so nobody can send a movement as another member.
- **Tampering:** the body cannot carry an amount, currency, date, account or payer (unknown keys are
  rejected, FR-05); the amount, currency and date are read from the locked movement row, so a client cannot
  send a movement for a different value than it holds. The shares are allocated server-side to add up to the
  movement amount.
- **Repudiation:** the creation entry is written in the same transaction with the member, the server time and
  `from_movement`, and the log is immutable (trigger and 405), so the sender cannot deny having moved the
  movement into the group; the audit line carries ids only.
- **Information Disclosure:** a missing movement, another user's movement and a group the caller is not in all
  answer the same 404 body, never 403 (FR-13), so ids cannot be enumerated; refusals carry only a code, never an
  amount, a note or an account name; the type refusal reveals only that the movement is not an expense to its
  own owner.
- **Denial of Service:** each send holds the group row `for share` and the movement row `for update` for one
  short transaction; the group lock is shared, so sends of different movements do not queue behind each other;
  the body is bounded by the shared size limit and a split by 50 members; repeated sends of one movement end at
  the first 409 after reading one row.
- **Elevation of Privilege:** any active member may send their own movement into the group (the same right as
  recording an expense there); a non-member or a former member gets 404 from `GroupAccess.member`; the route
  grants nothing on the group beyond creating the caller's own expense and, when no category is named, the
  one automatic default category (see the resolver section below); `create-group-category.ts` and
  `update-group-category.ts` keep requiring the admin role.

### `drizzle-group-expense-repository.ts` and the unique index `group_expenses_payer_movement_unique`
- **Spoofing:** the movement is locked under the payer's owner scope, so a movement of another user is not
  found even if its id is guessed; the member rows are matched by group id and id together.
- **Tampering:** the movement amount and date are re-read under the lock and compared with the values the use
  case allocated the shares from; a difference answers 409 `GROUP_MOVEMENT_CHANGED` and rolls the transaction
  back, so shares can never add up to a stale amount (the drift this ticket exists to prevent).
- **Repudiation:** the expense and its log row commit or roll back together; no expense exists without its
  entry, and the entry records `from_movement`.
- **Information Disclosure:** the unique violation is caught and mapped to the same 409 code, so the database
  error text, the constraint name and the other expense's id never reach the client.
- **Denial of Service:** 20 concurrent sends of one movement serialise on the movement row and 19 end with a
  409 after one read; the unique index prevents unbounded duplicate rows; the lock order (group, members,
  movement) is the one `lockExpenseForChange` already uses, so no deadlock cycle is added.
- **Elevation of Privilege:** the adoption cannot link a movement to an expense of a group the payer does not
  belong to, because the group row, the payer's active membership and the owner scope are all required in the
  same transaction.

### `drizzle-movement-repository.ts` edit lock behind `PUT /movements/:id`
- **Spoofing:** the update is conditioned on the id, type and owner scope; a queued edit replayed by the sync
  pass carries the same session cookie as any request and is judged the same way.
- **Tampering:** amount, account and date of an adopted movement cannot change except through the group
  expense edit; the check and the write are in one transaction with the row locked `for update`, so an edit
  that read the movement as free cannot overwrite one that a send has just adopted (FR-10). Bypass paths were
  enumerated by reading the code: `drizzle-movement-repository.ts` `update` is the only statement that
  updates a movement row; creation with a device id returns the stored movement and writes nothing
  (`RecordDeviceMovement`); recurring, card-import and installment code only insert; account code never
  writes movements; erasure deletes them. The lock is on by default and the recorder's bypass is an explicit
  option set in one adapter.
- **Repudiation:** a refused edit is a 409 with a code, and a refused queued edit is kept on the device as a
  failed change with its reason until the person discards it, so it is neither silently applied nor silently
  lost; the movement id and user id are logged on success, never the values.
- **Information Disclosure:** the 409 reveals only that the movement belongs to a group expense, to its own
  owner; it carries no group name, amount or member.
- **Denial of Service:** the lock adds one `for update` read and one indexed existence query to an edit;
  contention exists only between writes to the same movement.
- **Elevation of Privilege:** a user cannot clear the lock by deleting and recreating the group expense
  first: only an author or admin of the group can delete it, and the movement stays editable only after the
  detach; the lock never lets a group member edit a movement they do not own.

### `drizzle-payer-movement-recorder.ts` (adoption lock, propagation, detach on delete)
- **Spoofing:** the movement is always written under the payer's user (the member row's `user_id`), never the
  editor's, so an admin cannot write to a movement through their own scope.
- **Tampering:** an expense edit by an author or an admin propagates amount and date to the payer's adopted
  movement (FR-11), the one tampering path that is deliberate; the note, account, category, tags and rate are
  never touched, so an editor cannot rewrite what the payer wrote; the date is clamped to today by the
  existing rule. A member who is not author or admin gets 403 before any write.
- **Repudiation:** every propagation happens in the transaction that writes the `expense_updated` entry with
  before and after snapshots, so the payer can see who moved their movement's amount and when; the movement
  has no edit history of its own, which is why the group log is the evidence.
- **Information Disclosure:** the recorder returns nothing to the editor about the movement beyond the
  expense's own fields; the detach on delete deletes no row and reveals nothing.
- **Denial of Service:** the same locks and one extra row as an ordinary expense edit; deleting an adopted
  expense does less work than before because it skips the movement delete.
- **Elevation of Privilege:** detach on delete is not a new privilege: the author or an admin could already
  delete the expense, and now the payer's movement survives instead of being destroyed; the rollback script
  detaches adopted expenses first so older code can never delete a personal movement through the old rule.

### `GET /movements/:id` detail answer and `GET /movements` list `groupLinks`
- **Spoofing:** owner scope from the session; the link is looked up only for movements the scope owns, for
  the detail and for the ids of the list page alike.
- **Tampering:** read-only; it changes nothing.
- **Repudiation:** not applicable; reads are not audited, the request log carries ids only.
- **Information Disclosure:** the answers add `groupId`, `expenseId` and `adopted` (the list as a record keyed
  by the owner's own movement ids, empty when none) to the owner's own movements;
  it names no group, member or amount of the group, so a person who left the group learns only ids of a group
  they already belonged to, and the group name needs `getGroup`, which answers 404 to a non-member.
- **Denial of Service:** one extra indexed lookup per read by id; the list adds one indexed query for at most
  100 ids of the page (no join in the list query), so a page costs one more statement, not one per row.
- **Elevation of Privilege:** the link grants no access to the group; every group read still checks
  membership.

### Automatic category resolver `ensure-default-category.ts`, called inside the send transaction
- **Spoofing:** the group id is the one `GroupAccess.member` authorised for the session user; the resolver
  takes no user, member or role from the request, so nobody can create a category in a group they are not an
  active member of.
- **Tampering:** the category's default key, icon and color come from the shared `DEFAULT_CATEGORIES`
  entry `other-expenses` and its name is stored as null; the strict body rejects `categoryName`, `categoryKey`,
  `icon` and `color` (FR-19), so a member cannot choose, rename or style the category through the send. A
  category renamed by an admin keeps its key and is used as is, never overwritten. Only `archived_at` of that
  one default row is ever updated.
- **Repudiation:** the creation entry written in the same transaction carries `auto_category` `created` or
  `restored` and the caller's member id and server time; the log is immutable (trigger), so an admin who
  finds the category back can see who caused it and when, and a member cannot deny it.
- **Information Disclosure:** the answer adds only `autoCategory` (`created`, `restored` or null) to a
  response the caller already receives; the resolver returns no row of another group and no name; refusals still
  carry a code only.
- **Denial of Service:** concurrent sends to a group without the category converge on one row through the
  unique partial index `(group_id, default_key)` and `ON CONFLICT DO NOTHING`, then a re-read: at most one
  row can exist per group, so the table cannot be flooded through the send (a group has at most one such row,
  and the action cannot create any other); the work is one indexed read and at most one insert or update, inside
  the transaction that already holds the movement lock. A refused or failed send rolls the creation back.
- **Elevation of Privilege:** a member without the admin role causes a category insert or an un-archive,
  which the category routes reserve to admins. It is bounded by design: one fixed default key per group, no
  user-supplied value, the same row the group is created with, and no other permission changes; an admin who
  archived it on purpose can archive it again and the restoration is visible in the log. Decision awaiting the
  owner: restore an archived category (current proposal) or fall back to the first active one (no write to an
  admin's choice).

### Activity log markers `group_activity_log.from_movement` and `auto_category`
- **Spoofing:** the markers are set by the server in the creation transaction, never by the request; no body
  field can set them.
- **Tampering:** check constraints allow `from_movement` only on `expense_created` and `auto_category` only
  with `from_movement` on a creation (values `created` or `restored`), and the immutability trigger refuses
  update and delete of any row, so the markers cannot be added or removed afterwards.
- **Repudiation:** the entry shows that the expense came from an existing movement, who created it and when,
  so a member cannot later claim the expense was typed in the group.
- **Information Disclosure:** the markers are a boolean and a two-value enum; the entry carries no movement id, account name, note or
  amount of the movement beyond the group expense's own fields (AC-18), so other members learn only that the
  expense was created from a movement.
- **Denial of Service:** one boolean and one short text column on an append-only table; no new query or index.
- **Elevation of Privilege:** not applicable; the marker grants and gates nothing.

### Web: `api-client.ts`, `features/movements/send-to-group/*` and `edit-movement-container.tsx`
- **Spoofing:** the user is the session pointer and cookie; no user, member or payer id is sent as a claim of
  identity, and the movement id from the address is only a claim the API checks.
- **Tampering:** the request is built from the movement's own `bigint` amount and shared parsers and is
  checked locally with the shared strict schema before sending; the response is validated by schema, so a
  modified body becomes a generic failure; the locked fields of an adopted movement are read-only text and
  the request carries the stored values.
- **Repudiation:** not applicable on the client; the server writes the log entry and a failed queued edit
  keeps its code on the device until discarded.
- **Information Disclosure:** failures show catalog text chosen by code, never API text; the query carries
  only a movement id, never an amount or note; group names are rendered as React text, never as HTML.
- **Denial of Service:** the action is online only and the button is disabled while the request runs, so a
  double click sends once; the screen makes at most 2 requests before a group is chosen, 1 after and 1 to
  send (3 loads when the only group is preselected), with no polling or retry loop.
- **Elevation of Privilege:** hiding the action when offline, queued or linked only guides the person; the
  API remains the authority and answers 404 or 409 whatever the UI showed.

### Web: movements list send icon, marker and `focus` query (`movements-container.tsx`)
- **Spoofing:** the icon is a link to `/movements/send?id=<own movement id>`; the id is a claim the API
  checks, and no user, member or payer id travels in any address; a crafted `?focus=` link made by someone
  else can at most highlight a row of the caller's own loaded list.
- **Tampering:** `focus` is parsed with a uuid schema before use and only compared with loaded ids; it is not
  sent to the API, not stored, not written to the DOM as text, an attribute or a selector (the row is found by
  comparing ids in code, not by `querySelector` with the value), and a filter change drops it from the
  address. A malformed or hostile value (`abc`, markup, a very long string) is ignored with the list shown
  as usual (AC-44). The home link target is built from the API's own movement id.
- **Repudiation:** not applicable; navigation and highlight write nothing and the send is logged by the server.
- **Information Disclosure:** an id that is not among the loaded rows behaves exactly like any other unknown
  id (no highlight, no error, no request), so `focus` cannot be used to test whether a movement id exists or
  belongs to someone else; the marker shows a group name only when `listGroups` (membership-checked) returns
  that group, else "In a group"; group names and notes are React text.
- **Denial of Service:** `focus` causes no request; the list adds at most one `listGroups` call, only when a
  loaded row is linked, and the home screen adds none; scroll and focus happen once per `focus` value, with no
  timer or loop.
- **Elevation of Privilege:** hiding the icon offline, for queued rows or linked rows only guides the person;
  the API stays the authority (404 or 409); the highlight grants no access to anything.

### Web: home recent-movement links (`recent-movements.tsx`)
- **Spoofing:** the link target is built from the API's own movement id, never from typed input, and carries
  no user or session claim.
- **Tampering:** the row is one link with no nested interactive element; the target is encoded with
  `encodeURIComponent`, so a note or title cannot alter the address.
- **Repudiation:** not applicable; the link is a navigation and writes nothing.
- **Information Disclosure:** the address holds only a movement id of the caller's own recent list, which the
  browser history keeps on the caller's own device; the row text is React text.
- **Denial of Service:** no request is added to the home screen; the five-row limit is unchanged.
- **Elevation of Privilege:** the link grants nothing; the list answers under the caller's own scope.

## Data classification
| Data | Class | At rest | In transit |
|---|---|---|---|
| Movement amount, date, account, note, tags and rate that the send adopts | financial | PostgreSQL, managed encryption at rest; never copied by a send (0 new movement rows) | HTTPS only, behind the session cookie |
| Group expense, shares and member ids created from a movement | financial | PostgreSQL, managed encryption at rest | HTTPS only |
| Activity log entry with `from_movement`, `auto_category` and the member and time | financial | PostgreSQL, managed encryption at rest; immutable by trigger | HTTPS only |
| Group link of a movement (`groupId`, `expenseId`, `adopted`), in the detail and the list `groupLinks` | public | PostgreSQL, managed encryption at rest; ids only | HTTPS only |
| `focus` query value (a movement id in the address) | public | not stored; lives in the address bar and browser history | HTTPS only; never sent to the API |
| Error codes such as `GROUP_MOVEMENT_ALREADY_SENT` | public | not stored; a rejected queued edit keeps the code (at most 64 characters) in the user's own device database, deleted on sign-out | HTTPS only |
| Session cookie that authorises every call | credentials | HttpOnly cookie, never readable by page code | HTTPS only, sent with `credentials: include` |

## Risks and mitigations
| ID | Risk | STRIDE | Likelihood | Impact | Mitigation |
|---|---|---|---|---|---|
| R-01 | A user sends another user's movement (or guesses its id) into their group and reads or consumes it (IDOR) | I | Medium | High | The movement is read and locked only under the caller's owner scope; a foreign or missing movement is `ResourceNotFound` (404, never 403) with the same body as a missing group; tests for both and for a body without session (Blocks 3, 4, 6) |
| R-02 | A user sends a movement into a group they do not belong to, or whose existence they probe | I | Medium | High | `GroupAccess.member` runs first and answers 404 for a non-member, a former member and an unknown group alike; the active-member recheck under lock covers a member who leaves mid-request (Blocks 3, 4, 6) |
| R-03 | Double spend: two requests, tabs or devices send one movement, giving two expenses and counting the amount twice | T | High | High | One transaction with the movement row `for update`, the link check under that lock, and the unique partial index as backstop; the integration test sends 20 at once and expects 1 success, 19 answers of 409 and 1 expense, 1 log entry and no duplicate rows by counting (Blocks 2, 4, 12) |
| R-04 | An edit of the group expense changes the amount or date of the adopted movement beyond what the person intended, or overwrites their note | T | Medium | Medium | Only amount and date propagate (FR-11), the note is kept through `keepNote`, account, category, tags and rate are never written; the edit stays author or admin only, is version-checked and logged with before and after snapshots; the admin case is a documented, accepted behaviour of 05d (Block 4) |
| R-05 | The movement is edited directly (amount, account, date) after adoption, so the expense and the movement drift apart | T | High | High | The lock sits in the single `update` statement path of the movements repository, in the same transaction as a `for update` read, on by default; tests cover `PUT`, a replayed queued edit, a repeated device creation id, the bypass flag and the race between an edit and a send (Block 5) |
| R-06 | A refusal or the log marker leaks an amount, an account name, the note or the movement id to another member or to the wrong person | I | Medium | Medium | Error bodies are `{ code }` only; the marker is a boolean; the creation entry carries no snapshot; the link answer carries ids only and the group name needs a membership-checked read; tests assert refusals and the activity entry contain no amount, name or movement id (Blocks 5, 6, 11) |
| R-07 | A member denies having sent the movement, or a sent expense is later passed off as typed in the group | R | Medium | Medium | The creation entry in the immutable log records the member, the server time and `from_movement`, written in the same transaction as the expense; the log answers 405 to any change (Blocks 2, 4) |
| R-08 | Concurrent sends are used to exhaust connections or locks | D | Medium | Medium | Shared group lock, short transactions, a 409 after one read for repeats, bounded body and split size, the existing request rate limits; no loop or retry on the client (Blocks 4, 9, 12) |
| R-09 | Deleting an adopted group expense destroys the person's own movement (privilege of the deleter over another user's record) | E | Medium | High | The marker `adopted_movement` makes delete detach and keep the movement; a non-adopted expense keeps the old rule; the migration rollback detaches adopted expenses first; tests for both deletes and for a deleted movement with a null link (Blocks 2, 4) |
| R-10 | A queued offline edit of the movement is applied after the send and silently changes a locked field | T | Medium | High | The sync pass sends it through the same `PUT`, which answers 409 with the lock code; the pass stores a rejected change with that code and the movement screen shows a failed row with the message and the discard action; never applied silently (Blocks 5, 7) |
| R-11 | The edit lock is bypassed by another write path (import, recurring job, card installment, device replay, account code) | E | Low | High | Reading the code shows `update` in `drizzle-movement-repository.ts` is the only statement that updates a movement row; the other paths only insert, delete or read; creation with an existing device id returns the stored movement; a test asserts the replay leaves an adopted movement unchanged, and the bypass is an explicit option used by one adapter (Block 5) |
| R-12 | A database error or a migration step on existing data fails and leaves partial state | T | Low | High | Migration 0036 starts with a pre-check that aborts on a duplicate link and is otherwise additive; the whole send is one transaction so a failure stores nothing; an idempotent rollback script exists and is tested twice (Blocks 2, 4) |
| R-13 | Markup or script in a group description, group name or note runs in another member's page through the lists or the activity page | T | Medium | High | Every description, name and note is rendered as React text with no HTML injection; the new marker is a boolean and the catalog text is static; the list marker "In group X" renders the name as React text (Blocks 9, 10, 11, 12) |
| R-14 | A float slips into money on the way (note derivation, split, display) | T | Medium | High | The amount is the movement's `bigint`, shares go through the shared allocation helper, a test over 1,000 random amounts proves the shares add up, and a scan rejects float conversions in the new files (Blocks 3, 8, 12) |
| R-16 | The `focus` query value of a crafted or shared link injects markup or a selector, probes whether a movement id exists, or breaks the list | T | Medium | Low | Validated as a uuid, compared in code with loaded ids only, never rendered, used in a selector, stored or sent; an unknown or malformed value shows the list with no highlight and no error, so there is no oracle; tests with `abc`, a markup string and an unknown uuid (Block 12, Block 14) |
| R-17 | A member who is not an admin creates or un-archives a group category through the send (elevation of privilege) | E | Medium | Medium | The resolver is a system action limited to one constant default key per group, with its default icon and color and a null name; the caller needs membership only, nothing about the category comes from the request (strict body), so no custom category, name or style can be created; category routes keep `access.admin`; tests with a non-admin member and with a body naming a name or key (Blocks 1, 6, 15) |
| R-18 | The category's name, key, icon or color is tampered with through the send, or its name squatted (tampering) | T | Medium | Medium | The body rejects `categoryName`, `categoryKey`, `icon` and `color`; the row is written with the constants of `DEFAULT_CATEGORIES` and `name` null; an admin's rename of the default is never overwritten; test asserts the stored values (Blocks 1, 6, 15) |
| R-19 | Concurrent sends to a group without the category create duplicate rows or exhaust locks (DoS, race) | D | Medium | Medium | The unique partial index `(group_id, default_key)` with `ON CONFLICT DO NOTHING` and a re-read leaves exactly 1 row; one indexed read and at most one write inside the existing transaction; a test runs 20 concurrent sends of 20 movements and counts 1 category row and 20 expenses (Blocks 4, 15) |
| R-20 | The automatic creation or restoration of a category cannot be traced to who caused it (repudiation) | R | Medium | Medium | The creation entry of the immutable log records `auto_category` `created` or `restored` with the caller's member id and the server time, in the same transaction; the activity page shows it as text (Blocks 2, 4, 11) |
| R-15 | A web bundle cached before the deploy cannot read the activity entry with the new required field | D | Medium | Low | The page shows the generic failure with retry and the service worker update loads the new bundle; accepted as a short transitional effect and listed for the owner in the spec (Block 11) |

## Decision Log
- 2026-10-11: Owner decision: the send keeps the group category automatic and the system creates the group's
  "Other expenses" category when it is missing. The threat entries for the resolver (R-17 to R-20) were added
  for it. Proposed by the model, awaiting the owner: an archived category is restored (alternative: fall back
  to the first active category, which never changes an admin's choice).

## Supply chain
No new runtime dependency is added (spec D13): the send reuses the existing Express route stack, Zod schemas of
`packages/shared`, Drizzle, React, next-intl and the design-system components. The migration is plain SQL generated by
the existing drizzle-kit and no external service (rates, push, email, OAuth) is called by this feature. The
dependency audit (`pnpm audit --prod --audit-level high`) stays in CI unchanged.

## Availability
The send adds one transaction of a few indexed statements and two row locks, held briefly; the group lock is
shared so sends of different movements do not block each other, and repeated sends of one movement end with a
409 after one read. The edit lock adds one `for update` read and one existence query to a movement edit. The
unique partial index replaces the plain one of 0035, so the budgets' `not exists` probe keeps its index and
write cost does not grow. The client screens add no polling, background timer or retry loop; the load budget
is 2 requests, then 1 after choosing a group, then 1 to send, asserted by tests; the movements list adds at
most 1 request (the person's groups, only when a row is linked) and the home screen none, and a `focus` value
costs no request. A failed request
leaves the screen on its error state with a manual retry, and a send that fails stores nothing, so it can be
repeated safely. The send is online only: offline the action is not offered and no change is queued.

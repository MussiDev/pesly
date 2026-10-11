# Threat model DISC-001-05h: Editing, Activity and Conflict Screens

| Field | Value |
|-------|-------|
| Ticket | DISC-001-05h |
| Spec | docs/ddw/specs/spec-DISC-001-05h.md |
| Tier | FEATURE |
| Date | 2026-10-11 |

## Components
| Component | Source in the spec |
|---|---|
| `apps/web/src/lib/api-client.ts` (`listGroupActivity`) | Block 1 |
| `apps/web/src/features/groups/edit/permissions.ts`, `expense-edit-values.ts`, `settlement-edit-request.ts`, `queued-values.ts` | Block 2 |
| `apps/web/src/features/groups/activity/activity-view.ts` | Block 3 |
| `apps/web/src/features/groups/edit/use-group-changes.ts` and `apps/web/src/lib/local-store/group-queue.ts` (the 04e queue it drives) | Block 4 |
| `apps/web/src/features/groups/edit/rejection.ts` and `components/*` (sync marker, row actions, delete confirmation, failed-change panel) | Block 4 |
| `apps/web/src/features/groups/expenses/edit/expense-edit-container.tsx` | Block 5 |
| `apps/web/src/features/groups/settlements-edit/settlement-edit-container.tsx` | Block 6 |
| `apps/web/src/features/groups/expenses/list/group-expenses-container.tsx` and `settlements-history/settlements-history-container.tsx` | Blocks 7, 8 |
| `apps/web/src/features/groups/activity/group-activity-container.tsx` | Block 9 |
| `apps/web/src/features/shell/components/sync-status.tsx` and `containers/authenticated-shell-container.tsx` | Block 11 |

## Trust boundaries
- Browser UI → permission decision: whether the caller may edit or delete (`canEditRecord`, D3) is computed
  in the browser from the group detail. It only decides what is shown; the API remains the authority and
  answers 403 `GROUP_RECORD_EDIT_FORBIDDEN` or 404 to every request, whatever the UI showed.
- Screen → IndexedDB (device): queued edits and deletes, with the loaded record as `base`, are written to the
  `groupQueue` store of the signed-in user's own database. The device, other browser profiles and other
  users of the same browser are outside the trust boundary; the store is the only place group record
  contents live on the device.
- Device queue → API: the existing sync pass sends each queued change with the session cookie, the
  `X-Requested-With` header and `baseVersion`. The API re-validates the body, the membership, the author or
  admin rule and the version, and answers 409 with the current record when the version is stale.
- API → rendered page: activity entries, member display names, group names and descriptions are written by
  other members and cross into this user's page; they are untrusted text.
- User and group scope → shell status: the shell reads counts from the user's own database and shows them on
  every screen; they cross from group-specific data into a global component.
- Route and URL → client state: group, expense and settlement ids in the path and the activity cursor are
  the only external values the screens read; no amount or prefill travels in the URL.

## STRIDE analysis
### `apps/web/src/lib/api-client.ts` (`listGroupActivity`)
- **Spoofing:** the caller is the session cookie; no member id is ever sent as a claim of who is asking, and
  the group id is only a claim the API checks against membership.
- **Tampering:** the response is parsed with `activityPageSchema` (strict entries, string amounts), so a
  modified or malformed body becomes a generic failure and never partial data; the query is checked with
  `listActivityQuerySchema` before sending and the group id goes through `resourcePath`.
- **Repudiation:** not applicable on the client; the API appends the log row and answers 405
  (`GROUP_ACTIVITY_LOG_IMMUTABLE`) to any attempt to change it, and the client exposes no method to try.
- **Information Disclosure:** failures expose only message keys, never API text; entries, ids and cursors are
  not written to the console or any client log.
- **Denial of Service:** one request per user action, no polling or retry loop; a 401 triggers the existing
  single serialized refresh and a 429 is shown as received.
- **Elevation of Privilege:** the client never decides who may read; a group the caller is not in answers 404
  and is shown as not found.

### `apps/web/src/features/groups/edit/permissions.ts`, `expense-edit-values.ts`, `settlement-edit-request.ts`, `queued-values.ts`
- **Spoofing:** the member id comes from the `getGroup` answer (`selfMemberId`), not from storage, the URL or
  user input.
- **Tampering:** requests are built with the shared parsers and `bigint`; the request never contains the
  currency, payer, payer account or creator (the strict schema would refuse them), `baseVersion` is added
  from the record's own `base.version` by the queue, and a property test over 1,000 random amounts proves
  the string queued equals the value typed (NFR-04).
- **Repudiation:** not applicable; pure functions with no I/O.
- **Information Disclosure:** not applicable; no I/O and nothing is logged.
- **Denial of Service:** work is linear in the member count (at most 50) and the length of one typed text,
  which the parsers bound.
- **Elevation of Privilege:** a wrong browser answer of `canEditRecord` (for example a stale role after a
  demotion) only shows an action that the API then refuses with 403; hiding is never relied on to protect
  data.

### `apps/web/src/features/groups/activity/activity-view.ts`
- **Spoofing:** not applicable; the actor name is looked up by the member id the API recorded, never by a
  name inside the entry.
- **Tampering:** values are formatted into plain strings with the shared money and date formatters; an
  entry of the wrong shape never throws and never renders raw ids; pages are merged by entry id so a
  repeated page cannot duplicate or reorder history.
- **Repudiation:** the view is read-only; the log it shows is append-only on the server, so the history of an
  edit or delete stays attributable to its member, and the page never offers to alter or hide an entry.
- **Information Disclosure:** only the entries of the caller's own group arrive; a former member is named
  from `formerMembers` and an unknown id shows the neutral copy, never an identifier.
- **Denial of Service:** the view processes at most 50 entries per page with linear work; the shown list
  grows by one page per click.
- **Elevation of Privilege:** not applicable; the module reads data and grants nothing.

### `apps/web/src/features/groups/edit/use-group-changes.ts` and `apps/web/src/lib/local-store/group-queue.ts`
- **Spoofing:** the queue is opened with the user id of the session pointer into that user's own database
  (`withGroupQueue`), so a change can only be written to the signed-in user's store; another user on the
  device has a different database and sees none of it.
- **Tampering:** a record written by something other than the app (a script run in the user's own console, a
  stale or edited record in DevTools) is re-validated with `queuedGroupChangeSchema` on every read, and
  one that does not parse is left out; whatever reaches the server is validated again by the API (request
  schema, author or admin rule, `baseVersion`), so editing the queue can only produce a change the user
  could make through the API directly. The oldest `base` is kept through folds, so a queued edit cannot
  silently be rebased onto a newer version, and a stale one becomes a 409 conflict with both versions kept
  until the person chooses (`keepMine`, `keepServer`, one transaction each, with the interruption seam).
- **Repudiation:** a queued change carries `createdAt` and `revision`, and the API records the actor in the
  activity log when it applies the change; a change that waited on a device is therefore attributed to the
  member who sent it, with the server's time, and the person cannot later deny an applied edit.
- **Information Disclosure:** the queue holds record contents (amounts, descriptions, shares, member ids)
  on the device; it is per user, never shared across users, and the whole database is deleted by
  `wipeLocalData` on sign-out and on account deletion (tested in Block 12); the rejection keeps only a code
  of at most 64 characters, never message text.
- **Denial of Service:** one record per kind and id, so repeated edits fold instead of growing; the pass
  runs under the existing lock with a concurrency of 4, skips rejected and conflicting records, and backs
  off on network and server errors, so replay cannot become a request storm; a quota failure on write is
  reported as unavailable and stores nothing.
- **Elevation of Privilege:** a queued change gains no authority: it is sent with the user's own session, and
  a change queued while the caller was an admin and sent after losing the role is refused by the API with
  403 and shown as a failed row with its reason.

### `apps/web/src/features/groups/edit/rejection.ts` and `components/*`
- **Spoofing:** not applicable; presentational pieces with no identity of their own.
- **Tampering:** a double click on confirm or retry is harmless: a repeated delete is accepted as done by the
  queue and a retry clears one rejection once; confirm buttons are disabled while a write runs.
- **Repudiation:** not applicable; the components record nothing.
- **Information Disclosure:** a failed row shows the message mapped from the stored code, never server text,
  and the confirmation names the record by its description as React text only.
- **Denial of Service:** retry clears the rejection and the next pass sends it once; a refusal that retrying
  cannot fix (D11) offers only discard, so no retry loop can be started from the UI.
- **Elevation of Privilege:** an action is rendered only when it is allowed, and the screens never call the
  API directly to apply it; a forged click on a hidden action still produces a change that the API refuses.

### `apps/web/src/features/groups/expenses/edit/expense-edit-container.tsx`
- **Spoofing:** the group id and expense id come from the route and are claims the API checks; a non-member
  gets 404 for the group and the screen shows not found.
- **Tampering:** the currency and payer are shown as text with no control, so the form cannot produce a body
  naming them; a hand-crafted queue record that did is refused by the strict request schema and by the API.
  A 404 for a record deleted by someone else is shown as not found, never as stale data.
- **Repudiation:** the saved edit is attributable by the API log (before and after snapshots) once the pass
  applies it; the screen itself keeps no local record beyond the queue.
- **Information Disclosure:** the screen makes 3 requests, all scoped by membership; a non-member sees not
  found with no hint the group exists, and a member who may not edit sees the not-allowed state without the
  fields.
- **Denial of Service:** 3 requests on load and none on save; submit is guarded against a double submit.
- **Elevation of Privilege:** the not-allowed state is a convenience; a member who is neither author nor
  admin who reaches the form by a crafted queue write is refused by the API with 403, and the refusal is
  shown as a failed row with the entered values kept.

### `apps/web/src/features/groups/settlements-edit/settlement-edit-container.tsx`
- **Spoofing:** as the expense screen; the caller's member id comes from `getGroup`.
- **Tampering:** only the amount and the date are inputs; a consolidated settlement offers deletion only, so
  the screen cannot send an edit the API would answer with 409 `GROUP_SETTLEMENT_CONSOLIDATED`; if one is
  queued anyway the refusal is shown and retry is not offered.
- **Repudiation:** the API logs the settlement edit and delete with before and after snapshots.
- **Information Disclosure:** the account is shown only as "with an account" or "no account", never its name
  or id, so another member's account is not exposed (D7).
- **Denial of Service:** 2 requests on load and none on save.
- **Elevation of Privilege:** the not-allowed state hides the actions from non-authors and non-admins; the API
  decides, and a forged edit is refused.

### `apps/web/src/features/groups/expenses/list/group-expenses-container.tsx` and `settlements-history/settlements-history-container.tsx`
- **Spoofing:** not applicable below the session; `selfMemberId` and the role come from `getGroup`.
- **Tampering:** rows come from the API validated by the shared schemas; the overlay only adds the person's own
  queued values for display, and the cursor comes from the previous response and rows are deduplicated by id.
- **Repudiation:** a pending change is marked waiting and a refused one failed with its reason, so a person
  cannot believe an edit was saved when it was not, and cannot lose track of one that was refused.
- **Information Disclosure:** rows show only the group's own members, amounts and dates; a non-member gets 404
  and the not-found state; a queued change shows only to the user whose database holds it.
- **Denial of Service:** the expense list makes 3 requests on load (D5) and the history 2, 50 rows per page;
  "load more" is one request per click and keeps loaded rows on failure; a reload happens once per finished
  pass, not on a timer.
- **Elevation of Privilege:** edit and delete render only for the author and admins; anything else is the
  API's 403, shown to the person.

### `apps/web/src/features/groups/activity/group-activity-container.tsx`
- **Spoofing:** the actor shown is the member id the API stored with the entry; a member cannot choose the
  name shown for their action, only change their own display name later, which the page resolves at read
  time.
- **Tampering:** display names, group names, descriptions and snapshot values are written by other members;
  they are rendered only as React text, never with `dangerouslySetInnerHTML` or markdown, so markup in a name
  or note shows as literal characters (tested with an `onerror` payload); bidirectional and long strings wrap
  inside the row at 360 px.
- **Repudiation:** the page presents the immutable log with before and after values, so a member cannot deny
  an edit or delete they made, and the page offers no edit or delete of an entry (the API answers 405).
- **Information Disclosure:** only the caller's own group's entries are shown; a non-member gets 404 and the
  not-found state with no hint that the group exists (insecure direct object reference by editing the group
  id is answered 404, never 403); former members are named from the group's own list; the category request
  of D6 is scoped to the same group.
- **Denial of Service:** 2 requests on load, one category request at most, 50 entries per page and one
  request per "load more" click; a failed page keeps the loaded entries and a retry is manual.
- **Elevation of Privilege:** read access for every member is by design (PRD 05); the page grants nothing
  more and the API checks membership on every call.

### `apps/web/src/features/shell/components/sync-status.tsx` and `containers/authenticated-shell-container.tsx`
- **Spoofing:** the counts come from the database of the user in the session pointer; no other user's data is
  read.
- **Tampering:** a counter changed in DevTools changes only the number the user sees; it triggers no request
  and no data access.
- **Repudiation:** not applicable; the status shows counts only.
- **Information Disclosure:** the status shows three numbers and a link to the groups list; it contains no
  group id, group name, record or amount, so it discloses nothing about any group on any screen (D12);
  counts are read per user, never across users.
- **Denial of Service:** counts are read on queue and sync events, not on a timer; a queue that cannot be read
  counts as empty.
- **Elevation of Privilege:** the link goes to the groups list, where the API's membership checks decide what
  is visible; the status grants no access.

## Data classification
| Data | Class | At rest | In transit |
|---|---|---|---|
| Queued group record changes: amounts, dates, descriptions, shares, member ids, the `base` record | financial | The signed-in user's own IndexedDB database on the device; not encrypted by the app, protected by the device's disk encryption and the browser profile; deleted entirely on sign-out and account deletion; one record per record id | HTTPS only, sent by the sync pass with the session cookie |
| Activity log entries with before and after values | financial | PostgreSQL, managed encryption at rest; nothing is stored in the browser | HTTPS only |
| Member display names and group membership | PII | PostgreSQL, managed encryption at rest; copies of names inside queued `base` records live only in the user's own device database | HTTPS only |
| Rejection code on a failed change (at most 64 characters) | public | The user's own device database, deleted on sign-out | HTTPS only for the request it came from |
| Session cookie that authorises every call | credentials | HttpOnly cookie, never readable by page code | HTTPS only, sent with `credentials: include` |

## Risks and mitigations
| ID | Risk | STRIDE | Likelihood | Impact | Mitigation |
|---|---|---|---|---|---|
| R-01 | A member who is neither author nor admin edits or deletes another member's record by crafting a queue write or calling the screen's routes | E | Medium | High | The UI hides the actions and shows a not-allowed state, but the API checks author or admin on every PUT, PATCH and DELETE and answers 403; the refusal is stored as a failed change and shown with its reason, the entered values kept (Blocks 2, 4, 5, 6, 7, 8) |
| R-02 | A user edits the group, expense or settlement id in the URL to read or change another group's data (IDOR) | I | Medium | High | The API scopes every query by membership and answers 404, never 403; the screens render the same not-found state with no hint that the record exists (Blocks 5, 6, 9) |
| R-03 | The browser's permission result is stale or wrong, so a user sees an action that will be refused, or an admin does not see one | E | Medium | Low | The decision is documented as a convenience; the server is the authority, a wrongly shown action ends as a failed row with the 403 message, and a missing action is recoverable by reloading the group (Blocks 2, 4) |
| R-04 | Queued group changes on the device are read by someone with access to the device or the browser profile | I | Medium | High | The queue is in the user's own per-user database, holds only record fields of that user's groups, and is deleted entirely on sign-out and account deletion; the device's disk encryption is the remaining control, as for the existing movement queue; tested by a sign-out end-to-end check (Blocks 4, 12) |
| R-05 | A second user of the same browser sees the first user's queued changes or counts after an account switch | I | Medium | High | The database name derives from the user id, the session pointer selects it and sign-out wipes it; the shell reads counts for the pointer's user only; an end-to-end test signs out and signs in as another user and expects 0 group changes (Blocks 4, 11, 12) |
| R-06 | A queued change is sent against a record someone else changed first, and silently overwrites it (lost update) | T | High | High | Every change carries `baseVersion` from the oldest `base`; a stale one becomes a 409 conflict stored next to the untouched local request and skipped by later passes; the person chooses "keep mine" or "keep server's" in one transaction, and the interruption seam test proves an interrupted choice leaves both versions as they were (Blocks 4, 5, 6, 12) |
| R-07 | A tampered or stale queue record changes what is sent | T | Low | Medium | Records are re-validated with `queuedGroupChangeSchema` on every read and the request with the shared strict schema before queuing; unparseable records are left out and not sent; the API validates every body again, so the worst case is a change the user could already make through the API (Block 4) |
| R-08 | Markup or script in a member display name, group name, description or note runs in another member's page through the activity log or the lists | T | Medium | High | Every name, note, description and snapshot value is rendered as React text with no `dangerouslySetInnerHTML` and no markdown; a test renders an `onerror` payload as literal text; scan for `dangerouslySetInnerHTML` in the new folders (Blocks 3, 9, 12) |
| R-09 | The before and after values in the log are mis-shown (a float, a wrong currency, a wrong member), misleading a dispute | T | Low | Medium | Amounts are string minor units formatted with `BigInt` and the shared formatters with the record's currency; only changed fields are shown; members and categories are resolved by id with a neutral fallback, never a raw id (Blocks 3, 9) |
| R-10 | A member denies having changed or deleted a record | R | Medium | Medium | The log is immutable (API answers 405 to any change of an entry), each entry holds the actor, time and before and after snapshots, and the page shows them; the queue's `createdAt` does not replace the server's time (Blocks 3, 9) |
| R-11 | The shell sync status reveals data about other groups, other users or a record to someone looking at the screen | I | Low | Medium | The status shows three counts and a link to the groups list, with no group id, name, record or amount, and reads only the signed-in user's database (Block 11) |
| R-12 | "Load more", reload after a pass or retry is used, or bugs, to flood the API | D | Medium | Medium | One request per click with a 50-row page, no polling, reload only on a finished pass, retry clears one rejection once and the pass keeps its lock, concurrency of 4 and backoff; unretryable refusals offer only discard; request counts are asserted by tests (Blocks 4, 7, 8, 9, 12) |
| R-13 | A very large queue or a quota failure on the device blocks edits or loses a change silently | D | Low | Medium | One record per kind and id folds repeated edits; a failed write reports the unavailable state and stores nothing, with no direct API fallback, so a change is never half-saved and never reported as saved (Block 4) |
| R-14 | Floating point corrupts an amount while typing, queuing or showing a value | T | Medium | High | Minor units and `bigint` only, the shared parsers, a 1,000-amount property test that the queued amount equals the typed one and a scan for `parseFloat`, `toFixed` and `Number(` in the new folders (Blocks 2, 4, 12) |
| R-15 | A double click on delete or save queues or sends the action twice | T | Medium | Low | Confirm and submit are disabled while the write runs; a repeated queued delete is accepted as done by the queue and a delete of an already deleted record is treated as done by the pass (Blocks 4, 5, 6) |
| R-16 | The account of a settlement or another member's name is shown to someone who should not see it | I | Low | Medium | The settlement screen shows only "with an account" or "no account"; names come from the group's own members and former members and render only to members of that group (Block 6) |
| R-17 | A hardcoded or one-language string ships | T | Medium | Low | Catalog parity test and the existing no-literal scan over `src/features/groups` (Block 12) |

## Supply chain
No new runtime dependency (spec D14); the screens use React, next-intl, the existing design system
components, the shared package, the existing api-client and the existing local store. No external service is
called from these screens, and the log values are never fetched from or sent to a third party. The new api-client
method adds no package.

## Availability
The screens add no polling, background timer or new retry loop; the only background work is the existing sync
pass, which runs under its lock with a concurrency of 4 and exponential backoff. Load budgets are asserted
by tests: 3 requests for the expense edit screen, 2 for the settlement edit, 2 for the activity page (plus one
category request at most), 3 for the expense list and 2 for the settlement history. A page of the log or of
rows is at most 50 entries. A failed request leaves the screen on its error state with a manual retry, and
a failed "load more" keeps the loaded rows. Edits and deletes survive a dropped connection in the device
queue and are sent when the connection returns; the creation screens remain online only and fail visibly
when offline.

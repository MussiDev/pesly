# Spec DISC-001-05e: Groups Screens, Members and Invitations

| Field | Value |
|-------|-------|
| Ticket | DISC-001-05e |
| PRD | docs/ddw/prd/prd-DISC-001-05e.md |
| Tier | FEATURE |
| Date | 2026-10-11 |
| Spec loops | 0 |
| Loops since last human decision | 0 |

## Summary
Web only. A `features/groups` module with one container per screen, built on the pattern of the
recurring payments feature: `useApiClient()` plus a `{kind: loading | failed | ready}` state, pure
`build*Request` helpers that return field errors as catalog paths, presentational components with no
data fetching, and failures mapped through `errors.<messageKey>`. Block 1 adds the missing api-client
methods (about 20) that wrap routes that already exist. Screens: the groups list and create form,
the group detail (members, admin actions, leave), the invitation, ghost member and claim link panels,
the join and claim pages, and the categories page. No endpoint, migration or dependency is added.

## Decisions
- **D1 Routes.** `/groups` (list), `/groups/new`, `/groups/[id]` (detail), `/groups/[id]/categories`,
  `/groups/join` and `/groups/claim` (token in the link). Sub-pages inherit the back button and the
  active "Groups" highlight from the shell.
- **D2 Link shape.** The API returns only a token. The web builds
  `<origin>/<locale>/groups/join#token=<token>` (and `/groups/claim#token=…`): a fragment is never sent
  to a server or logged, and the page reads it and clears it with `history.replaceState` at once, using
  the existing `features/auth/take-url-token.ts` pattern.
- **D3 No dialogs.** The design system has no dialog or sheet, so invitation, ghost and claim-link
  actions are inline panels inside the detail page, not modals. A dialog component stays out of scope.
- **D4 Copy and share.** Copy uses `navigator.clipboard` with a visible fallback (the link in a
  selectable field); the browser share sheet is offered only when `navigator.share` exists.
- **D5 Roles.** The screens derive "am I an admin" from the group detail (`members[]` role of the member
  that is the caller, returned by the API as `role` on the group response). Hiding admin actions is a
  convenience; the API's 403 is still displayed through `errors.groupRecordEditForbidden`-style keys.
- **D6 Leaving.** A leave attempt with a balance shows `details.ARS` and `details.USD` from the 409
  `GROUP_MEMBER_HAS_BALANCE` response, formatted with the locale formatters, and keeps the user in the
  group. The last-admin 409 asks to promote someone first.
- **D7 Online only.** No group screen is queued or cached offline (PRD 05 decision); an offline load
  shows the shared error state with a retry.
- **D8 No new dependency.**

## Coverage: PRD → blocks
| Requirement | Covered by |
|---|---|
| FR-01, FR-02 | Block 2 |
| FR-03 | Block 2 |
| FR-04 | Block 3 |
| FR-05, FR-07, FR-08 (generating) | Block 4 |
| FR-06, FR-08 (pages) | Block 5 |
| FR-09, FR-10, FR-11 | Block 3 |
| FR-12 | Block 6 |
| FR-13 | Every block adds its catalog keys; Block 7 checks parity |
| NFR-01 | Block 7 (end-to-end at 360 px) |
| NFR-02 | Strategy: one container per screen makes at most two requests, asserted by call-count tests in Blocks 2, 3 and 6 |
| NFR-03 | Strategy: every block adds Spanish and English keys together; the existing catalog parity test runs in each block |
| NFR-04 | Block 5 |

## Dependencies between blocks
Block 1 first. Blocks 2 and 5 are independent and run in parallel after Block 1. Block 3 needs
Block 2 (it adds the detail page the list links to). Blocks 4 and 6 need Block 3 and are independent
of each other. Block 7 is last. Blocks that touch the catalogs add keys with targeted edits under their
own sub-namespace of `groups` (`list`, `detail`, `invite`, `join`, `categories`) so parallel blocks do
not rewrite each other's keys.

## Block 1 — api-client group methods

**Files**
- `apps/web/src/lib/api-client.ts` (modified) — methods for the existing group calls: `listGroups`,
  `createGroup`, `getGroup`, `updateGroupRateType`, `joinGroup`, `claimGroupSeat`, `createInvitation`,
  `addGhostMember`, `createClaimLink`, `promoteMember`, `removeMember`, `leaveGroup`,
  `listGroupCategories`, `createGroupCategory`, `updateGroupCategory`.
- `apps/web/test/api-client-groups.test.ts` (modified) — the new calls.

**Logic**
Each method (FR-01 to FR-12) validates the response with the shared response validator of its call, returns the existing
`ApiResult` shape and maps error codes with the existing code-to-key map. `leaveGroup` and
`removeMember` expose the `details.ARS` and `details.USD` strings of `GROUP_MEMBER_HAS_BALANCE` on the
failure (typed, not parsed ad hoc by the screens).

**Input validation**
- Tokens are non-empty strings of at most 200 characters; names follow the shared request validators.

**Error handling**
- A response that does not match its validator is a generic `INTERNAL` failure, never partial data.
- The balance details are read only when present and numeric-string shaped.

**Required tests**
- [ ] `createGroup` sends the body and returns the parsed group — validates AC-03.
- [ ] `joinGroup` and `claimGroupSeat` send the token in the body — validates AC-07 and AC-11.
- [ ] A 404 stays not found and a 403 stays forbidden for member actions — validates AC-15.
- [ ] A 409 `GROUP_MEMBER_HAS_BALANCE` surfaces the amounts per currency — validates AC-14 and AC-17.
- [ ] A 409 `GROUP_LAST_ADMIN` surfaces its own key — validates AC-18.
- [ ] A malformed body is an error, not data — invalid input.
- [ ] An empty token is rejected before any request — invalid input.

**Completion criterion**
The api-client tests pass and typecheck is clean.

## Block 2 — Groups list, empty state and create group

**Files**
- `apps/web/src/app/[locale]/(app)/groups/page.tsx` (modified) — renders the list container instead of
  the placeholder.
- `apps/web/src/app/[locale]/(app)/groups/new/page.tsx` (new).
- `apps/web/src/features/groups/containers/groups-list-container.tsx`,
  `create-group-container.tsx` (new).
- `apps/web/src/features/groups/components/groups-list.tsx`, `create-group-form.tsx` (new).
- `apps/web/src/features/groups/group-request.ts`, `group-failure.ts` (new) — request builder and
  failure-to-path mapping.
- `apps/web/src/features/shell/components/home-shortcuts.tsx` (modified) — the groups shortcut is no
  longer flagged `inCreation`.
- `apps/web/messages/es.json`, `en.json` (modified) — `groups.list`.

**Logic**
The list shows name, role badge and member count, links each group to `/groups/[id]`, and shows the
empty state with the create action and a hint about joining with a link. The form takes the name and
the default rate type (the seven rate types, with the user's usual one preselected if the catalog
offers it, otherwise `oficial`) and opens the new group on success.

**Input validation**
- Name: required, trimmed, at most the length the shared schema allows. Rate type: one of the seven.

**Error handling**
- A load failure shows the shared error state with a retry; an unauthenticated answer goes to sign-in.
- A create failure shows the mapped message and keeps the typed values.

**Required tests**
- [ ] The list shows each group with name, role and member count — validates AC-01.
- [ ] The empty state shows the create action when the list is empty — validates AC-02.
- [ ] Submitting a name and a rate type creates the group and opens its detail — validates AC-03.
- [ ] An empty name shows a field error and sends no request — validates AC-04.
- [ ] A name over the limit is invalid and shows a field error — validates AC-04.
- [ ] A load error shows the retry and the retry loads again.
- [ ] The container makes one request to load the list — validates NFR-02.
- [ ] Spanish and English strings render for the list — validates AC-20.
- [ ] The groups shortcut is no longer flagged in creation.

**Completion criterion**
Component and container tests pass, the catalog parity test passes and the page renders the list.

## Block 3 — Group detail, members, admin actions and leaving

**Files**
- `apps/web/src/app/[locale]/(app)/groups/[id]/page.tsx` (new).
- `apps/web/src/features/groups/containers/group-detail-container.tsx` (new).
- `apps/web/src/features/groups/components/group-members.tsx`, `member-row.tsx`,
  `group-admin-actions.tsx`, `leave-group-panel.tsx`, `rate-type-form.tsx` (new).
- `apps/web/messages/es.json`, `en.json` (modified) — `groups.detail`.

**Logic**
The detail loads the group in one request and renders members with role and the marker for members
without an account, and a separate "former members" list. Admin actions (promote a registered member,
remove a member, change the default rate type) render only when the caller is an admin and are
disabled for ghosts where the API forbids them (promote). Remove and leave call the API and, on
`GROUP_MEMBER_HAS_BALANCE`, show the balance per currency instead of changing the list; on
`GROUP_LAST_ADMIN` they ask to promote someone first. A successful leave goes back to the list.
There are links to the categories page (Block 6) and room for the invitation panels (Block 4).

**Input validation**
- The rate type is one of the seven; ids come from the loaded group, never from free text.

**Error handling**
- A 404 for a group the user cannot see shows the not-found state and a link to the list.
- 403 from an admin action shows its message and leaves the data untouched.
- 409 balance and last-admin answers are shown inline, not as a generic failure.

**Required tests**
- [ ] The detail lists members with role and marks members without an account — validates AC-05.
- [ ] Former members are listed apart — validates AC-05.
- [ ] An admin promotes a registered member and the row shows admin — validates AC-13.
- [ ] Removing a member with a balance answers 409, shows the amounts and keeps the member — validates AC-14.
- [ ] A non-admin sees no promote, remove or rate-type controls — validates AC-15.
- [ ] A member with balance 0 leaves and returns to the list — validates AC-16.
- [ ] Leaving with a balance answers 409, shows the amount per currency and keeps the user — validates AC-17.
- [ ] The last admin leaving answers 409 and shows the promote-someone message — validates AC-18.
- [ ] A 404 shows the not-found state with a link back.
- [ ] A 403 from an admin action shows its message and changes nothing.
- [ ] The detail loads with at most two requests — validates NFR-02.

**Completion criterion**
Tests pass and the detail page works for an admin and for a regular member.

## Block 4 — Invitation, member without an account and claim link panels

**Files**
- `apps/web/src/features/groups/components/invite-panel.tsx`, `add-ghost-form.tsx`,
  `claim-link-panel.tsx`, `share-link.tsx` (new).
- `apps/web/src/features/groups/containers/group-invite-container.tsx`,
  `group-ghost-container.tsx` (new).
- `apps/web/src/features/groups/group-link.ts` (new) — builds the join and claim links (D2).
- `apps/web/src/features/groups/containers/group-detail-container.tsx` (modified) — mounts the panels.
- `apps/web/messages/es.json`, `en.json` (modified) — `groups.invite`.

**Logic**
"Invite" (FR-05) asks the API for an invitation and shows the link built from the token, its expiry date
formatted in the user's time zone, a copy action and the share action when available. "Add member
without an account" (FR-07) takes a display name and refreshes the member list. On a ghost row, "claim
link" (FR-08) asks the API for a claim link and shows it the same way.

**Input validation**
- Display name: required, trimmed, at most the shared schema's length. The link is built only from a
  token returned by the API.

**Error handling**
- The 50-member limit answer is shown with its own message and adds no row.
- Copy failure falls back to showing the link in a selectable field.

**Required tests**
- [ ] Asking for an invitation shows the link and its expiry date and copies it — validates AC-06.
- [ ] The link has the join path and a fragment token, never a query token — validates NFR-04.
- [ ] Adding a name shows the member with the marker — validates AC-10.
- [ ] An empty name is invalid and sends no request — invalid input.
- [ ] The member limit answer shows its message and adds no row — 409.
- [ ] A claim link is generated for a ghost and shown — validates AC-11.
- [ ] When clipboard copy fails the link stays visible for manual copy.
- [ ] A 403 from the API shows its message.

**Completion criterion**
Tests pass and the panels work from the detail page.

## Block 5 — Join and claim pages

**Files**
- `apps/web/src/app/[locale]/(app)/groups/join/page.tsx`, `groups/claim/page.tsx` (new).
- `apps/web/src/features/groups/containers/join-group-container.tsx`,
  `claim-seat-container.tsx` (new).
- `apps/web/src/features/groups/components/link-result.tsx` (new) — the success and failure states.
- `apps/web/messages/es.json`, `en.json` (modified) — `groups.join`.

**Logic**
On mount the container (FR-06, FR-08) reads the token from the fragment, removes it from the address with
`history.replaceState` before any request (D2), and calls join or claim once (guarded against double
invocation in development). Success opens the group. Failures show: expired or invalid link, already a
member, group full, claim link already used, each with its own message and a link to the groups list.
A user who is not signed in is sent to sign-in and returned to the same link afterwards, keeping the
fragment through the existing return-to mechanism if one exists, otherwise the page asks the user to
open the link again after signing in.

**Input validation**
- A missing or empty token shows the invalid-link state without a request.

**Error handling**
- Expired or invalid token, already member, group full and used claim link each map to their own state.
- Network failure offers a retry and does not consume the token twice (the request is sent once per
  attempt).

**Required tests**
- [ ] A valid invitation joins the user and opens the group — validates AC-07.
- [ ] An expired or invalid invitation shows the message and the link to the list — validates AC-08.
- [ ] An already-member answer shows its specific message and no second join — validates AC-09.
- [ ] A full group shows its specific message — validates AC-09.
- [ ] A valid claim link assigns the seat and opens the group — validates AC-11.
- [ ] A used claim link shows its message and changes nothing — validates AC-12.
- [ ] A missing token shows the invalid-link state and sends no request — missing input.
- [ ] The token is removed from the address and appears in no history entry — validates NFR-04.
- [ ] The join request is sent once even when the component mounts twice.
- [ ] A network failure offers a retry.

**Completion criterion**
Tests pass and a signed-in user can join from a link in the browser.

## Block 6 — Group categories page

**Files**
- `apps/web/src/app/[locale]/(app)/groups/[id]/categories/page.tsx` (new).
- `apps/web/src/features/groups/containers/group-categories-container.tsx` (new).
- `apps/web/src/features/groups/components/group-categories-list.tsx`, `group-category-form.tsx`
  (new).
- `apps/web/src/features/groups/category-request.ts` (new).
- `apps/web/messages/es.json`, `en.json` (modified) — `groups.categories`.

**Logic**
Lists the group's categories (default ones named from the catalog by their `defaultKey`, archived ones
marked). An admin can create a category (name, icon, color from the existing pickers or token set),
edit it and archive or restore it; a regular member sees the list read-only.

**Input validation**
- Name required and trimmed within the shared limit; icon and color from the allowed sets.

**Error handling**
- A duplicate name answer shows a field error. A 403 shows its message and changes nothing.

**Required tests**
- [ ] The list shows default and custom categories and marks archived ones — validates AC-19.
- [ ] An admin creates a category and it appears — validates AC-19.
- [ ] An admin edits and archives a category and the list shows it — validates AC-19.
- [ ] A regular member sees no create, edit or archive controls — validates AC-15.
- [ ] A duplicate name shows a field error — duplicate.
- [ ] An empty name is invalid and sends no request — invalid input.
- [ ] A 403 shows its message and leaves the list untouched.
- [ ] The page loads with one request — validates NFR-02.

**Completion criterion**
Tests pass and categories can be managed by an admin.

## Block 7 — End-to-end flows and final checks

**Files**
- `apps/web/e2e/groups.spec.ts` (new) — create, invite, join with a second browser context, add a
  member without an account, categories, leave.
- `apps/web/e2e/support/groups.ts` (new) — helpers.
- `apps/web/test/groups-no-hardcoded-strings.test.ts` (new) — scans `features/groups` for literals.

**Logic**
One Playwright spec with two contexts: user A creates a group and an invitation, user B opens the link
and joins, A sees B in the members list, A adds a member without an account and creates a category,
B leaves. A second test runs the list and detail at a 360 px viewport and asserts there is no
horizontal scroll.

**Error handling**
- The spec resets attempt limits before each test, as the existing specs do.

**Required tests**
- [ ] The create, invite, join and leave flow passes with two users — validates AC-03, AC-07, AC-16.
- [ ] The list and detail fit a 360 px viewport without horizontal scroll — validates NFR-01.
- [ ] The Spanish and English catalogs have the same keys, none empty — validates NFR-03 and AC-20.
- [ ] No group string is hardcoded in components or containers — validates AC-20.
- [ ] An invalid invitation link shows the message in the browser — invalid link.

**Completion criterion**
The spec and the scan pass, and the full web suite and coverage thresholds pass.

## Final verification
- Every AC (AC-01 to AC-20) and NFR (NFR-01 to NFR-04) has a test; every input has a sad-path test.
- `pnpm typecheck`, eslint and Prettier on touched files pass; the full suite and coverage pass.
- The design-system scan and accessibility tests pass for the new screens (labels, focus on the first
  invalid field, tokens only).
- Owner ratification items: the web split e to h, links carrying the token in the fragment (D2),
  inline panels instead of dialogs (D3), and that a signed-out visitor is sent to sign-in and must open the link again (the shell has no return-to mechanism).

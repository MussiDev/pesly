# Verification DISC-001-05e

| Field | Value |
|---|---|
| Module | Web only. `apps/web/src/features/groups/**` (31 new source files: 8 containers, 16 components and the request, link, failure-mapping and fragment-token helpers), the app pages under `apps/web/src/app/[locale]/(app)/groups/` (list, `new`, `[id]`, `[id]/categories`, `join`, `claim`), the 15 group methods of `apps/web/src/lib/api-client.ts`, `features/home/components/home-shortcuts.tsx`, and the two message catalogs (`groups.list`, `detail`, `invite`, `join`, `categories`) |
| Line coverage | 96.65% (ticket code, 31 new files, 461 of 477 lines); suite 96.92% |
| Branch coverage | 85.90% (ticket code, 268 of 312 branches); suite 90.67% |
| Function coverage | 94.37% (ticket code, 134 of 142 functions); suite 94.87% |
| Coverage floor | 80% lines, branches and functions (AGENTS.md, "Testing") |
| Lint | `pnpm exec eslint` over `apps/web/src/features/groups`, `apps/web/test` and `apps/web/e2e` — clean, 0 findings; `pnpm typecheck` — clean (shared, api, web); `pnpm lint` as a whole stops only at `prettier --check` because of the repository's CRLF checkout, a known condition |

Verified against HEAD c854b27 (all seven blocks and the review fixes committed), on branch `feat/DISC-001-05e-groups-core-ui`, stacked on `feat/DISC-001-04e-group-conflicts` (draft PR #53). Suite figures come from the full run recorded in `docs/ddw/reports/tests-DISC-001-05e.md` (455 files, 7959 of 7959 tests passed) and from `coverage/coverage-summary.json`; the ticket-code figures are my sum of the per-file rows of that summary for the 31 new source files of `features/groups` (the three 04e files in that folder are left out; the changed parts of `api-client.ts` are not in the sum because the file also holds earlier code). I did not re-run the suite for this report. The numbers are my report of what was run, not something this document proves. The ticket adds no migration, no API change and no dependency.

Per-area ticket coverage (covered of total, from `coverage-summary.json`):

| Area | Lines | Branches | Functions |
|---|---|---|---|
| `features/groups/components` (16 files) | 146/148 = 98.65% | 124/132 = 93.94% | 50/51 = 98.04% |
| `features/groups/containers` (8 files) | 256/269 = 95.17% | 104/128 = 81.25% | 71/77 = 92.21% |
| `features/groups` helpers (7 files) | 59/60 = 98.33% | 40/52 = 76.92% | 13/14 = 92.86% |
| Total | 461/477 = 96.65% | 268/312 = 85.90% | 134/142 = 94.37% |

All three figures clear the 80% floor, which is the bar this spec sets ("the full suite and coverage thresholds pass"). The 90% that the 04e spec asked of its web files is not asked here and the branch figure would not reach it (85.90%); the containers and the helpers hold the unreached branches (mostly `group-categories-container.tsx` and `group-failure.ts`), which I did not list line by line.

## Acceptance criteria
- ✅ AC-01 — the list container loads the groups in one request and the list shows name, role badge and member count; `groups-list.test.tsx` "lists each group with name, role and member count in one request"; `api-client-groups.test.ts` "listGroups, getGroup and updateGroupRateType use their routes".
- ✅ AC-02 — while the list is empty the page shows the create action and the join hint; `groups-list.test.tsx` "shows the empty state with the create action and the join hint".
- ✅ AC-03 — the form sends the trimmed name and the rate type, then opens the new group; `groups-list.test.tsx` "creates the group with the typed name and rate type and opens it" and "offers the seven rate types"; `api-client-groups.test.ts` "createGroup sends the body and returns the parsed group"; `apps/web/e2e/groups.spec.ts` "two users: create, invite, join, add a member without an account, add a category and leave".
- ✅ AC-04 — an empty or over-long name shows a field message and sends no request; `groups-list.test.tsx` the two container tests for an empty name and a name over the limit (field message, no request, titles omitted here), "rejects an empty name and an unknown rate type" and "rejects a name over the limit".
- ✅ AC-05 — the detail shows members with role and the marker for members without an account, and former members apart, from one request; `group-detail.test.tsx` "lists members with role, marks members without an account and loads in one request" and "lists former members apart from the current ones".
- ✅ AC-06 — the invitation panel asks the API, builds the link from the token, shows the expiry date in the user's time zone and copies it; `group-invite.test.tsx` "asks for an invitation, shows the link and the expiry in the user time zone, and copies it", "keeps the link visible for manual copy when the clipboard fails" and "offers the share action only when the browser has one".
- ✅ AC-07 — the join page reads the fragment token, joins once and opens the group; `group-link-pages.test.tsx` "joins with a valid invitation and opens the group (AC-07)" and "sends the request once when the component mounts twice"; `api-client-groups.test.ts` "joinGroup and claimGroupSeat send the token in the body"; the two-user end-to-end flow.
- ✅ AC-08 — an expired or invalid invitation shows the invalid-link message with a link to the list; `group-link-pages.test.tsx` "shows the invalid-link message and a link to the list for an expired invitation (AC-08)", "sends no request and shows the invalid-link state when the token is missing" and "treats an empty token as missing"; end to end "an invalid invitation link shows the invalid-link message".
- ✅ AC-09 — already a member and group full each show their own message and no second join; `group-link-pages.test.tsx` "shows the already-member message once and does not join again (AC-09)" and "shows the group-full message (AC-09)"; `api-client-groups.test.ts` "a bad token answer maps to its own key, and so do already-member and full group".
- ✅ AC-10 — adding a display name reloads the list and shows the member with the marker; `group-invite.test.tsx` "adds a name, reloads the list and shows the new member with the marker", "flags an empty name and sends no request" and "shows the member limit message and adds no row"; the two-user end-to-end flow.
- ✅ AC-11 — a claim link is generated for a member without an account and the claim page assigns the seat and opens the group; `group-invite.test.tsx` "generates a claim link for a member without an account and shows it"; `group-link-pages.test.tsx` "assigns the seat and opens the group (AC-11)" and "sends the request once under strict mode".
- ✅ AC-12 — a used or invalid claim link shows its message and changes nothing; `group-link-pages.test.tsx` "shows the used-link message and changes nothing (AC-12)" and "sends no request when the token is missing".
- ✅ AC-13 — an admin promotes a registered member and the row shows admin; promotion is disabled for a member without an account; `group-detail.test.tsx` "lets an admin promote a registered member and shows the row as admin" and "disables promotion for a member without an account".
- ✅ AC-14 — removing a member with a balance shows the amounts per currency and keeps the member; `group-detail.test.tsx` "removing a member with a balance shows the amounts and keeps the member" and "removing a member without a balance reloads the group"; `api-client-groups.test.ts` "a GROUP_MEMBER_HAS_BALANCE 409 exposes the amounts per currency" and "balance details that are not numeric strings are not exposed".
- ✅ AC-15 — a regular member sees no promote, remove, rate-type or category controls, and an API 403 is shown without changing data; `group-detail.test.tsx` "shows no promote, remove or rate type controls to a regular member" and "a 403 from an admin action shows its message and changes nothing"; `group-categories.test.tsx` "shows a regular member a read-only list with no controls (AC-15)"; `api-client-groups.test.ts` "a 404 stays not found and a 403 stays forbidden for member actions".
- ✅ AC-16 — a member with balance 0 leaves and goes back to the list; `group-detail.test.tsx` "a member with no balance leaves and returns to the list"; `api-client-groups.test.ts` "removeMember and leaveGroup answer 204 as success"; the two-user end-to-end flow ends with the leave.
- ✅ AC-17 — leaving with a balance shows the amount per currency and keeps the user in the group; `group-detail.test.tsx` "leaving with a balance shows the amount per currency and keeps the user".
- ✅ AC-18 — the only admin leaving is asked to promote someone first; `group-detail.test.tsx` "the last admin leaving is asked to promote someone first"; `api-client-groups.test.ts` "a GROUP_LAST_ADMIN 409 surfaces its own key".
- ✅ AC-19 — an admin creates, edits, archives and restores a category and the list shows each change, with archived ones marked; `group-categories.test.tsx` "lists default and custom categories and marks archived ones (AC-19)", "lets an admin create a category and shows it (AC-19)", "lets an admin edit a category and shows the new name (AC-19)" and "archives and restores a category (AC-19)"; `api-client-groups.test.ts` "group categories: list, create and update"; the end-to-end flow adds a category.
- ✅ AC-20 — every group string comes from the catalogs in Spanish and English and none is hardcoded; `groups-no-hardcoded-strings.test.ts` "has no hardcoded user-facing string in components or containers" plus its planted-literal cases; `groups-list.test.tsx`, `group-detail.test.tsx` and `group-invite.test.tsx` each "renders Spanish strings"; `group-categories.test.tsx` "names defaults from the catalog in the locale of the page"; the existing `i18n-catalogs.test.ts` parity test over the new keys.

## Functional and non-functional requirements
- ✅ FR-01 (list of the user's groups): AC-01 above.
- ✅ FR-02 (empty state with create action and join hint): AC-02 above.
- ✅ FR-03 (create a group with name and default rate type): AC-03 and AC-04 above.
- ✅ FR-04 (members with role and marker, former members apart): AC-05 above.
- ✅ FR-05 (invitation link with expiry and copy): AC-06 above.
- ✅ FR-06 (join page): AC-07, AC-08 and AC-09 above.
- ✅ FR-07 (add a member without an account): AC-10 above.
- ✅ FR-08 (claim link and claim page): AC-11 and AC-12 above.
- ✅ FR-09 (promote, remove, change the default rate type): AC-13 and AC-14 above; `group-detail.test.tsx` "lets an admin change the default rate type" and "shows the failure next to the rate type and keeps the previous value".
- ✅ FR-10 (admin actions hidden from non-admins): AC-15 above.
- ✅ FR-11 (leave, with the balance shown instead of leaving): AC-16, AC-17 and AC-18 above.
- ✅ FR-12 (categories list and admin management): AC-19 above.
- ✅ FR-13 (Spanish and English): AC-20 above.
- ✅ NFR-01 (no horizontal scroll at 360 px): `apps/web/e2e/groups.spec.ts` "the groups list and the group detail fit a 360 px viewport (NFR-01)", passed locally; it first broke on the claim-link button, whose class was fixed. The join, claim and categories pages are not in that end-to-end test.
- ✅ NFR-02 (at most 2 requests per screen): the call-count assertions in `groups-list.test.tsx` (one request), `group-detail.test.tsx` (one request) and `group-categories.test.tsx` (the page loads the group and the category list: 2 requests, within the limit).
- ✅ NFR-03 (no missing or empty catalog key): the existing `i18n-catalogs.test.ts` parity test passes over the new keys of both catalogs.
- ✅ NFR-04 (token gone from the address, 0 history entries): `group-link-pages.test.tsx` "removes the token from the address before the request and keeps it out of history (NFR-04)" (strict mode, the hash is empty and the history length is unchanged at request time) and "returns the token and clears the fragment from the address"; `group-invite.test.tsx` "puts the token in the fragment, never in a query string". An end-to-end assertion on back navigation was added in the review fix and was NOT re-run.

## Spec blocks
- ✅ Block 1 — api-client group methods: every task done; the 15 methods, token checks before any request, ids refused when not plain, the typed balance details; `api-client-groups.test.ts` holds every listed test, including the malformed body and the empty token.
- ✅ Block 2 — list, empty state and create: every task done; the page, `new` page, containers, form, request builder and failure mapping, and the home shortcut no longer flagged; `groups-list.test.tsx` holds every listed test.
- ✅ Block 3 — detail, members, admin actions and leaving: every task done; one request, former members apart, promote, remove, rate type, leave, the not-found state and the 401 redirect; `group-detail.test.tsx` holds every listed test.
- ✅ Block 4 — invitation, member without an account and claim link panels: every task done; `group-link.ts` builds fragment links, the share link falls back to a selectable field; `group-invite.test.tsx` holds every listed test.
- ✅ Block 5 — join and claim pages: every task done; `take-fragment-token.ts` and `use-group-link.ts` read and clear the fragment once and guard the double mount; `group-link-pages.test.tsx` holds every listed test.
- ✅ Block 6 — categories page: every task done; `category-request.ts`, the list and the form, admin and read-only views; `group-categories.test.tsx` holds every listed test.
- ✅ Block 7 — end-to-end flows and final checks: every task done; `apps/web/e2e/groups.spec.ts` (3 tests, passed locally before the review fix) and `support/groups.ts`; `groups-no-hardcoded-strings.test.ts`; the catalog parity test; the shell navigation tests were extended (`shell-navigation.test.tsx`, the groups sub-pages keep Groups marked).

## Tests
- ✅ Sad-path tests: every input has an invalid-input test. Empty, over-long and unknown-rate names are refused with a field message and no request; an empty or oversized token and a path segment that is not a plain id are refused before any request; a malformed API body is a generic failure, not data; a missing or empty link token shows the invalid-link state with no request; the 404, 403, 401, 409 balance, 409 last-admin, member-limit, duplicate-name, already-member, group-full and used-link answers each have their own test; a clipboard that rejects keeps the link visible; a profile that cannot be read falls back to a default.
- ✅ No fragile tests found: the join and claim tests assert one request under a double mount and under strict mode rather than timing, each web test builds its own fake client, and the end-to-end spec uses two browser contexts with fresh users after resetting attempt limits.
- ⚠️ Items from the PRD or the spec that are not proven or that deviate, listed for the owner:
  1. Cross-check D1 (an admin sees Remove on their own row): FIXED on the client with the specific `cannotRemoveSelf` message (`group-detail.test.tsx` "removing yourself shows a specific message instead of the generic validation one (D1)"). Limitation: the caller's member id is not in `GroupDetailResponse`, so the button is still drawn and the message appears after the request is refused.
  2. Cross-check D2 (NFR-04 proof too weak): strengthened. The unit test now asserts the hash is empty and the history length unchanged at request time, in strict mode; an end-to-end back-navigation assertion was added in commit `c854b27` and was NOT re-run after it was added.
  3. Cross-check D3 (no return after sign-in): the shell redirects a signed-out visitor to sign-in and has no return-to mechanism, so the visitor must open the link again; the page says so (`group-link-pages.test.tsx` "asks the user to sign in and open the link again when the session is gone"). Recorded in the spec's ratification list; needs the owner's decision.
  4. Cross-check D4 (untested branches): covered by the extra unit tests of the review fix. The branch figure of the containers (81.25%) and the helpers (76.92%) is still the weakest part.
  5. Cross-check D5: leave is one click without a confirmation, because the design system has no dialog (spec D3). Known.
  6. Cross-check D6: the balance wording is in the third person, also when the amount is the caller's. Known.
  7. The shell navigation tests were added for the groups sub-pages (`shell-navigation.test.tsx`).
  8. SAST report `docs/ddw/security/sast-DISC-001-05e.md`: 0 Critical, High or Medium findings; L-1 (ids in routes) is fixed with `encodeURIComponent` in commit `c854b27`; I-1 to I-5 are informational.
  9. Deviation: the invitation, member-without-an-account and claim-link panels are shown to every member, not only admins, as the API and FR-05, FR-07 and FR-08 allow.
  10. Deviation: the categories page makes 2 requests (the group, then the list), within NFR-02.
  11. Deviation: the home shortcut change is in `features/home`, not `features/shell`; the web tests live in `apps/web/test`, not beside the sources.
  12. The claim-link button class was fixed after an NFR-01 end-to-end failure; the 360 px test covers the list and the detail only.
  13. The red-first TDD evidence rests on the implementers' reports, and for most blocks the red state was a failed import of a module that did not exist yet, not a failing assertion; git history has code and tests together in each commit.
  14. Coverage: the verification did not re-run the suite, and the retry option (`--retry=2`) used in the recorded run could hide a flaky test; the run printed one benign `getaddrinfo ENOTFOUND api.argent.test` line from an existing web test.
  15. Playwright ran locally on a fresh `_e2e` database with Mailpit before the review-fix commit; CI was not consulted. No migration, so the Drizzle migration merge rule does not apply to this ticket.

Result: PASSED

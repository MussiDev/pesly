# Verification DISC-001-05f

| Field | Value |
|---|---|
| Module | Mostly web. `apps/web/src/features/groups/**` (expense list, expense form and split editor, default split, personal shares, and the pure split logic), the app pages under `apps/web/src/app/[locale]/(app)/groups/` for the expenses, new expense, default split and `shares` routes, the five expense methods of `apps/web/src/lib/api-client.ts`, and the message catalogs (`groups.expenses`, `groups.split`, `groups.shares`). One additive API change: `selfMemberId` in two group responses (`packages/shared`, `apps/api/src/groups`) |
| Line coverage | 96.83% (suite, whole repository) |
| Branch coverage | 90.19% (suite) |
| Function coverage | 94.78% (suite) |
| Coverage floor | 80% lines, branches and functions (AGENTS.md, "Testing") |
| Lint | `pnpm --filter ./apps/web typecheck` — clean; eslint over the touched web files — clean; `pnpm lint` as a whole stops only at `prettier --check` because of the repository's CRLF checkout, a known condition |

Verified against HEAD 5027656 (the module cross-check fixes committed), on branch `feat/DISC-001-05f-group-expenses-ui`, stacked on `feat/DISC-001-05e-groups-core-ui` (draft PR #54). Suite figures come from the full coverage run recorded in `docs/ddw/reports/tests-DISC-001-05f.md` (465 files, 8083 of 8083 tests passed) and from the "Post-review run" note in the same report (after the cross-check fixes: web suite 172 files, 3291 of 3291 tests passed; shared schema tests and API self-member tests passed; the end-to-end specs `group-expenses.spec.ts` (4 tests) and `groups.spec.ts` (3 tests) passed before the fixes). I did not sum the coverage of the ticket files alone; the figures above are the suite figures. I did not re-run the suite for this report. The numbers are my report of what was run, not something this document proves. The ticket adds no endpoint, no migration and no dependency.

All three suite figures clear the 80% floor, which is the bar this spec sets ("the full suite and coverage thresholds pass").

## Acceptance criteria
- ✅ AC-01 — the list shows description, category, payer, amount, date and the viewer share, newest first; `group-expenses-list.test.tsx` "shows description, category, payer, amount, date and the viewer share, newest first"; `api-client-group-expenses.test.ts` "listGroupExpenses sends limit and cursor and returns items with nextCursor"; the two-user end-to-end flow in `group-expenses.spec.ts`.
- ✅ AC-02 — more expenses are appended without a reload and the button disappears when no next page exists; `group-expenses-list.test.tsx` "loads more without reloading and hides the button when nextCursor is null", "keeps the loaded rows when load more fails and offers a retry" and "ignores a load-more answer that arrives after the group changed"; `api-client-group-expenses.test.ts` "listGroupExpenses sends limit and cursor and returns items with nextCursor".
- ✅ AC-03 — an empty group shows the empty state with the add expense action; `group-expenses-list.test.tsx` "shows the empty state with the add expense action".
- ✅ AC-04 — a valid form creates the expense and returns to the list; `group-expense-form.test.tsx` "creates the expense and returns to the list", "sends an exact split that adds up" and "sends a percentage split that totals 100%"; `group-expense-request.test.ts` builds the request body; the two-user end-to-end flow records an expense with each split mode.
- ✅ AC-05 — an empty, zero or non-numeric amount and an empty or over-long description show a field message and send no request; `group-expense-form.test.tsx` the amount cases (empty, 0, abc) and the description cases (empty and 201 characters), each with no request; `group-expense-request.test.ts` the same rejections in the request builder.
- ✅ AC-06 — changing the split mode keeps amount and payer and resets only the per-member values; `group-expense-form.test.tsx` "keeps amount and payer and resets the per-member values when the mode changes"; `groups-split.test.ts` "keeps amount, payer and selection and clears per-member values".
- ✅ AC-07 — equal mode shows each share with the leftover cent to the payer first and recomputes when a member is unchecked; `group-expense-form.test.tsx` "shows each equal share with the leftover cent to the payer first" and "recomputes the shares when a member is unchecked"; `groups-split.test.ts` "gives the leftover cent of 100.00 over 3 members to the payer first".
- ✅ AC-08 — percentages that do not total 100% show the difference and disable sending; `group-expense-form.test.tsx` "shows the difference and disables sending when percentages do not total 100%"; `groups-split.test.ts` "reports a difference of 1 and no body at 9999 basis points".
- ✅ AC-09 — exact amounts that fall short show the remaining amount and disable sending; `group-expense-form.test.tsx` "shows the remaining amount and disables sending when exact amounts fall short"; `groups-split.test.ts` "reports the remaining amount on a shortfall".
- ✅ AC-10 — a split the server refuses shows the server message and keeps everything entered; `group-expense-form.test.tsx` "shows the server split refusal and keeps everything entered"; `group-expenses.spec.ts` "a split the server refuses shows its message in the browser".
- ✅ AC-11 — when the current user pays, an account in the expense currency and a personal category are required; `group-expense-form.test.tsx` "requires an account and a personal category when the payer is the current user" and "does not render or send the account fields when another member pays"; `group-expense-request.test.ts` "requires an account and a personal category when the payer is the current user"; the caller is identified through `selfMemberId` (`apps/api/test/groups/group-self-member.test.ts`).
- ✅ AC-12 — with no account in the currency the form says so and sends nothing; `group-expense-form.test.tsx` "says there is no account in the currency and sends nothing"; `group-expense-request.test.ts` "says there is no account in the currency and sends nothing".
- ✅ AC-13 — an admin saves an equal or percentage default and the next expense form is prefilled with it; `group-default-split.test.tsx` "lets an admin save a percentage default (AC-13)", "lets an admin save an equal default (AC-13)" and "prefills the form from the stored percentage default"; `group-expense-form.test.tsx` "prefills the default percentage split".
- ✅ AC-14 — a member who is not an admin sees the default read only; `group-default-split.test.tsx` "shows a member the default read only, with no save control (AC-14)" and "shows the message of a 403 and leaves the saved default unchanged".
- ✅ AC-15 — the shares page lists shares with currency and totals per currency, never converted, and shows the receivable only on shares the user paid; `personal-shares.test.tsx` "lists shares with currency and per-currency totals, with no conversion (AC-15)", "shows the receivable only on shares the user paid (AC-15)", "sums per currency with bigint and never mixes currencies" and "says the totals cover only the loaded rows while more pages remain".
- ✅ AC-16 — an invalid range shows a field message and sends no request; `personal-shares.test.tsx` "sends no request for a start after the end (AC-16)" (the field message is asserted in it), "sends no request when a date is missing or malformed (AC-16)" and "rejects malformed and impossible dates and empty fields".
- ✅ AC-17 — every expense string comes from the catalogs in Spanish and English and none is hardcoded; `personal-shares.test.tsx` "renders Spanish and English strings (AC-17)"; `group-expense-form.test.tsx` and `group-expenses-list.test.tsx` each "renders Spanish strings"; `group-expenses-no-hardcoded-strings.test.ts` "has no hardcoded user-facing string".

## Functional and non-functional requirements
- ✅ FR-01 (expense list, newest first, with the viewer share): AC-01 above.
- ✅ FR-02 (load more, 50 per page): AC-02 above.
- ✅ FR-03 (empty state with the add action): AC-03 above.
- ✅ FR-04 (expense form with validation): AC-04 and AC-05 above.
- ✅ FR-05 (split mode choice): AC-06 above.
- ✅ FR-06 (equal split with participants and leftover to the payer): AC-07 above.
- ✅ FR-07 (percentage split with difference): AC-08 above.
- ✅ FR-08 (exact split with remaining amount): AC-09 above.
- ✅ FR-09 (block sending while the split is off, show the server refusal): AC-08, AC-09 and AC-10 above; `group-expense-form.test.tsx` "explains why submit is blocked when no member takes part in the split".
- ✅ FR-10 (payer account and personal category): AC-11 and AC-12 above.
- ✅ FR-11 (default split, admin only): AC-13 and AC-14 above.
- ✅ FR-12 (personal shares page): AC-15 and AC-16 above.
- ✅ FR-13 (Spanish and English): AC-17 above.
- ✅ NFR-01 (no horizontal scroll at 360 px): `group-expenses.spec.ts` "the list, form, default split and shares fit a 360 px viewport (NFR-01)", passed locally before the cross-check fixes.
- ✅ NFR-02 (at most 3 requests for the form, 2 for the list page): `group-expense-form.test.tsx` "loads with at most 3 requests"; `group-expenses-list.test.tsx` "makes at most 2 requests on the first load"; `group-default-split.test.tsx` "loads with at most 2 requests: the options and the group (NFR-02)"; `personal-shares.test.tsx` "makes one request per page and follows the cursor on "load more" (NFR-02)".
- ✅ NFR-03 (no missing or empty catalog key): the existing `i18n-catalogs.test.ts` parity test passes over the new keys of both catalogs.
- ✅ NFR-04 (client split totals agree with the server over 1,000 random splits): `groups-split.property.test.ts` "never accepts a split the shared validators refuse" (1,000 cases); the preview ordering is kept in sync with the allocation by the same property test.
- ✅ NFR-05 (no `parseFloat`, `toFixed` or `Number(` on money): `group-expenses-no-hardcoded-strings.test.ts` "applies no parseFloat, toFixed or Number( to money" over the real tree, plus its planted-literal cases.

## Spec blocks
- ✅ Block 0 — caller member id: every task done; `selfMemberId` is additive in two API responses and in the shared schemas; `apps/api/test/groups/group-self-member.test.ts` holds the two tests (different ids for two members of one group; the ghost member id once the ghost is claimed).
- ✅ Block 1 — api-client expense methods: every task done; five methods, ids refused when not plain; `api-client-group-expenses.test.ts` holds the listed tests.
- ✅ Block 2 — pure split-editor logic: every task done; `groups-split.test.ts` and `groups-split.property.test.ts` hold the listed tests, with bigint arithmetic and no float.
- ✅ Block 3 — expense list container and component: every task done; `group-expenses-list.test.tsx` holds every listed test, plus the malformed-id and stale-page tests added by the cross-check.
- ✅ Block 4 — expense form, split editor and payer account section: every task done; `group-expense-form.test.tsx` and `group-expense-request.test.ts` hold every listed test.
- ✅ Block 5 — default split container: every task done; `group-default-split.test.tsx` holds every listed test.
- ✅ Block 6 — personal shares page: every task done; `personal-shares.test.tsx` holds every listed test, including partial totals and the stale-range case.
- ✅ Block 7 — pages, links, catalogs and end-to-end checks: every task done; `apps/web/e2e/group-expenses.spec.ts` (4 tests, passed locally before the cross-check fixes); `group-expenses-no-hardcoded-strings.test.ts`; the catalog parity test.

## Tests
- ✅ Sad-path tests: every input has an invalid-input test. Empty, zero and non-numeric amounts and empty or over-long descriptions are refused with a field message and no request; percentages and exact amounts that do not add up disable sending and show the difference; a missing account in the currency sends nothing; an inverted, missing or malformed date range sends nothing; a malformed group id shows the not-found state with no request, in the list, the form and the default split; a load that does not complete shows a retry; a load more that does not complete keeps the loaded rows; the 403 and the server split refusal each have their own test.
- ✅ No fragile tests found: stale answers are covered by tests that resolve an older request after a newer one rather than by timing, each web test builds its own fake client, and the end-to-end spec uses two browser contexts with fresh users.
- ✅ Module cross-check outcome: the verifier found 1 high, 4 medium and several low items.
  - High: a malformed group id reached the API. Fixed with an `isGroupId` guard in the list, form and default split containers, with one test each ("shows the not-found state for a malformed group id and sends no request").
  - Medium: the default split screen needs 2 requests, so the spec was amended (NFR-02 allows 2 for that screen); partial shares totals are now labelled as covering only the loaded rows ("says the totals cover only the loaded rows while more pages remain"); a stale load-more answer is dropped through a generation ref ("ignores a load-more answer that arrives after the group changed" and "ignores a load-more answer that arrives after the range changed"); the 2 missing tests were added.
  - Low: archived categories are now filtered out of the category choice; the hint for a blocked submit already existed ("explains why submit is blocked when no member takes part in the split"); blank members dropped silently is kept as documented behaviour; the `previewShares` ordering is kept in sync with the allocation by the property test; the NFR-02 bound for an account list over 100 accounts is accepted.
- ⚠️ Items from the PRD or the spec that are not proven or that deviate, listed for the owner:
  1. Decision for the owner: the web split between 05e and 05h; the 05e web work is already in the stacked PR #54.
  2. Decision for the owner: the additive `selfMemberId` field in two API responses, outside the web-only scope of the PRD.
  3. Decision for the owner: group expenses work online only; there is no offline queue for them in this ticket.
  4. Decision for the owner: the personal shares page is owned by 05f, at the static route `/groups/shares`.
  5. Follow-up for 05h: the group-detail container (05e) lacks the malformed-id guard that the 05f containers now have.
  6. The end-to-end specs passed before the cross-check fixes and were not re-run after them; the web suite was re-run after them (172 files, 3291 tests passed).
  7. SAST report `docs/ddw/security/sast-DISC-001-05f.md`: 0 Critical, High, Medium or Low open findings; 3 informational. Threat model `docs/ddw/security/threat-DISC-001-05f.md`.
  8. The red-first TDD evidence rests on the implementers' reports; git history has code and tests together in each commit.
  9. Coverage: the verification did not re-run the suite, and the coverage figures are suite-wide, not summed over the ticket files alone.
  10. Playwright ran locally on a fresh `_e2e` database with Mailpit; CI was not consulted. No migration, so the Drizzle migration merge rule does not apply to this ticket.

Result: PASSED

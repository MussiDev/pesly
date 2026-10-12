# Verification DISC-001-06e

| Field | Value |
|---|---|
| Module | `apps/web/src/features/goals/**` (list, detail, form, entries, delete, helpers), the goal methods of the api-client, the goals catalogs (es and en) and the four pages under `apps/web/src/app/[locale]/goals` |
| Line coverage | suite 96.79% |
| Branch coverage | suite 90.04% |
| Function coverage | suite 94.81% |
| Coverage floor | 80% lines, branches and functions (AGENTS.md, "Testing") |
| Lint | clean on the files of the ticket: typecheck, ESLint and Prettier, no suppressions in the scope (also recorded in `docs/ddw/security/sast-DISC-001-06e.md`) |

Verified against the PRD (`docs/ddw/prd/prd-DISC-001-06e.md`) and the spec (`docs/ddw/specs/spec-DISC-001-06e.md`) by reading the test files `apps/web/test/goals-list.test.tsx`, `goal-detail.test.tsx`, `goal-form.test.tsx`, `goal-entries.test.tsx`, `goal-delete.test.tsx`, `goals-helpers.test.ts`, `goals-catalog.test.ts`, `goals-no-hardcoded-strings.test.ts`, `api-client-goals.test.ts` and `apps/web/e2e/goals.spec.ts`, and by matching the test names against the test report. Suite figures come from the full run in `docs/ddw/reports/tests-DISC-001-06e.md` (536 files, 9147 of 9147 tests passed; end-to-end `goals.spec.ts` 4 of 4 passed). The numbers are my report of what was run, not something this document proves.

## Acceptance criteria
- ✅ AC-01 — `goals-list.test.tsx` "shows name, progress, target, currency, percentage and a bar per goal (%s, AC-01, AC-29)"; `api-client-goals.test.ts` "listGoals returns the parsed goals (AC-01)".
- ✅ AC-02 — `goals-list.test.tsx` "shows the negative progress, 0% and an empty bar for an overdrawn linked goal (AC-02)"; `goals-helpers.test.ts` "gives an empty bar and the negative amount for a negative progress".
- ✅ AC-03 — `goals-list.test.tsx` "shows the monthly amount as returned for a goal with a target date (AC-03)"; `goals-helpers.test.ts` "returns the monthly amount as the API string parsed to bigint".
- ✅ AC-04 — `goals-list.test.tsx` "shows reached and no monthly amount for a reached goal (AC-04)".
- ✅ AC-05 — `goals-list.test.tsx` "shows overdue instead of a monthly amount for an overdue goal (AC-05)".
- ✅ AC-06 — `goals-list.test.tsx` "shows the empty state with the create action when there are no goals (AC-06)".
- ✅ AC-07 — `goals-list.test.tsx` "shows the problem with a retry, never the empty state, and retries (AC-07)"; `goal-detail.test.tsx` "shows the problem with a retry that loads again when the load does not work (AC-07)".
- ✅ AC-08 — `goal-detail.test.tsx` "shows the figures and the entries newest first with kind, amount and date (AC-08)"; the end-to-end history step.
- ✅ AC-09 — `goal-detail.test.tsx` "shows the not-found state to a missing or foreign goal (AC-09)" and "shows not-found for a malformed id and sends no request (invalid input)"; `goals.spec.ts` "a goal of another user and a malformed id open the not found state (AC-09)".
- ✅ AC-10 — `goal-detail.test.tsx` "\"Load more\" asks for the next larger limit and shows the extra entries (AC-10)" and "keeps an entry recorded while \"load more\" is in flight"; `goals-helpers.test.ts` "nextEntriesLimit goes from 50 to 100 and stops at 100".
- ✅ AC-11 — `goal-detail.test.tsx` "hides the control when fewer entries than asked came back (AC-11)", "hides the control once 100 entries are shown (AC-11)" and "shows the latest-entries note only when the list is at the 100 cap".
- ✅ AC-12 — `goal-form.test.tsx` "creates the goal and goes to the list"; `api-client-goals.test.ts` "createGoal sends the amount as a minor-units string (AC-12)"; the end-to-end create step.
- ✅ AC-13 — `goal-form.test.tsx` "shows a field message and sends nothing for %j / %j" (empty name, 81 characters, empty, zero and non-numeric amount; added after the module verifier asked for a component test) and "blocks the submit with a field message when the link is checked but no account is chosen".
- ✅ AC-14 — `goal-form.test.tsx` "makes no request until the link is chosen, then offers active accounts of the currency" and "says so when there are no accounts in the currency".
- ✅ AC-15 — `goal-form.test.tsx` "clears the chosen account when the currency changes".
- ✅ AC-16 — `goal-form.test.tsx` "loads the goal in one request, shows currency and account read only and no link"; `goals.spec.ts` "a goal linked to an account has no entry forms and shows no raw id on edit".
- ✅ AC-17 — `goal-form.test.tsx` "sends only the changes and shows the figures the API returned"; `goals-helpers.test.ts` "sends only changed values"; the end-to-end edit step.
- ✅ AC-18 — `goal-form.test.tsx` "clearing the target date sends null and shows no monthly amount"; `api-client-goals.test.ts` "updateGoal sends targetDate null to remove the date (AC-18)".
- ✅ AC-19 — `goal-form.test.tsx` "an empty or invalid %s shows a field message and sends nothing" (name, long name, zero amount, non-numeric amount; added after the module verifier asked for a component test); `goals-helpers.test.ts` "rejects an empty name or a zero amount".
- ✅ AC-20 — `goal-entries.test.tsx` "records a contribution of 200.00 once and hands the response to onRecorded (AC-20, AC-23)"; `goal-detail.test.tsx` "puts a recorded entry on top and follows the goal in the response with no request (AC-20, AC-23)"; the end-to-end contribute step.
- ✅ AC-21 — `goal-entries.test.tsx` "shows a field message and sends nothing for \"%s\" (AC-21)" (empty, "0", "abc"); `goals-helpers.test.ts` "rejects %j".
- ✅ AC-22 — `goal-entries.test.tsx` "a linked goal shows no forms and the notice (AC-22)"; `goals.spec.ts` "a goal linked to an account has no entry forms and shows no raw id on edit".
- ✅ AC-23 — the same two tests as AC-20: one request is counted, the response feeds the goal and the history.
- ✅ AC-24 — `goal-delete.test.tsx` "confirming deletes once and calls onDeleted (AC-24)" and "keeps the lock after a successful delete so a later tap sends nothing" (fixed after the module verifier); `goal-detail.test.tsx` "goes to the list after the goal is deleted"; `api-client-goals.test.ts` "deleteGoal resolves with no body (AC-24)"; the end-to-end delete step.
- ✅ AC-25 — `goal-delete.test.tsx` "cancelling closes the confirmation and sends nothing (AC-25)".
- ✅ AC-26 — `goal-entries.test.tsx` "a refused withdrawal shows the message and keeps the amount (AC-26)"; `api-client-goals.test.ts` "a refused withdrawal and a refused 100th goal surface their own keys (AC-26, AC-27)".
- ✅ AC-27 — `goal-form.test.tsx` "shows the refused 100th goal and keeps the values"; the same api-client test.
- ✅ AC-28 — `goals-list.test.tsx` "shows the offline message on a network failure (AC-28)"; `goal-detail.test.tsx` "shows the offline message when the first load is offline (AC-28)"; `goal-entries.test.tsx` "a network failure shows the offline message and keeps the amount (AC-28)"; `goal-delete.test.tsx` "a network failure shows the offline message and keeps the confirmation (AC-28)"; `goal-form.test.tsx` "shows the offline message and keeps the input on a network failure".
- ✅ AC-29 — the es and en run of the list test; `goal-detail.test.tsx` "renders Spanish strings, amounts and dates (AC-29)"; `goal-entries.test.tsx` "renders Spanish and English strings (AC-29)"; `goal-delete.test.tsx` "renders Spanish strings (AC-29)"; `goals-catalog.test.ts` "has every goals key in %s with its ICU arguments"; `goals-no-hardcoded-strings.test.ts` "has no hardcoded user-facing string".

## Spec blocks
- ✅ Block 0 — api-client goal methods: `listGoals`, `getGoal`, `listGoalEntries`, `createGoal`, `updateGoal`, `recordGoalEntry` and `deleteGoal`; `api-client-goals.test.ts` (11 tests).
- ✅ Block 1 — goal view helpers and request builders: `features/goals/helpers/goal-view.ts`, `entries-paging.ts`, `goal-request.ts` and `goal-failure.ts`; `goals-helpers.test.ts`.
- ✅ Block 2 — i18n catalogs: es and en goals keys; `goals-catalog.test.ts` and the existing catalog parity test.
- ✅ Block 3 — goals list screen: `features/goals/list/**`; `goals-list.test.tsx`.
- ✅ Block 4 — goal detail and entries history: `features/goals/detail/**`; `goal-detail.test.tsx`.
- ✅ Block 5 — create and edit forms: `features/goals/form/**`; `goal-form.test.tsx`.
- ✅ Block 6 — contribute, withdraw and delete: `features/goals/entries/**` and `features/goals/delete/**`; `goal-entries.test.tsx` and `goal-delete.test.tsx`.
- ✅ Block 7 — pages, scans and end-to-end checks: the four pages replace the placeholder; `goals-no-hardcoded-strings.test.ts` and `goals.spec.ts` (4 of 4 pass).

## Tests
- ✅ Sad-path tests: signed-out user, list and detail load failure with retry, missing, foreign and malformed goal id with no request, "load more" failure, offline on every screen, empty and oversized names, empty, zero and non-numeric amounts, link without an account, accounts that failed to load, refused 100th goal, refused withdrawal, double tap, delete of a missing goal, malformed response body, invalid input rejected before any request.
- ✅ NFR-01 (no horizontal scroll at 360 px): `goals.spec.ts` "the list, detail, create and edit screens fit a 360 px viewport (NFR-01)".
- ✅ NFR-02 (request budget): `goals-list.test.tsx` "makes exactly 1 request (NFR-02)"; `goal-detail.test.tsx` 1 request for a linked goal and 2 for an unlinked one; `goal-form.test.tsx` no request until the link is chosen and 1 request to load the edit form; recording an entry makes exactly 1 request.
- ✅ NFR-03 (0 missing or empty keys): `goals-catalog.test.ts` "has the same goals keys in es and en, none empty" and the existing parity test.
- ✅ NFR-04 (no float on money, no client-side percentages): `goals-no-hardcoded-strings.test.ts` "applies no parseFloat, toFixed or Number( to money" and "derives no percentage or amount on the client", with planted-code checks.
- ✅ NFR-05 (coverage and one test per AC): suite 96.79% lines, 90.04% branches, 94.81% functions; every AC above has at least one test.
- ✅ NFR-06 (44 px targets, labeled controls): `goals-list.test.tsx`, `goal-entries.test.tsx`, `goal-delete.test.tsx` and `goal-form.test.tsx` each assert them.
- ✅ FR-01 to FR-13 are each covered by at least one passing AC above: FR-01 (AC-01, AC-02), FR-02 (AC-03 to AC-05), FR-03 (AC-06, AC-07), FR-04 (AC-08, AC-09), FR-05 (AC-10, AC-11), FR-06 (AC-12, AC-13), FR-07 (AC-14 to AC-16), FR-08 (AC-17 to AC-19), FR-09 (AC-20 to AC-22), FR-10 (AC-23), FR-11 (AC-24, AC-25), FR-12 (AC-26 to AC-28), FR-13 (AC-29).
- ✅ Independent module verifier: no High finding. Three Medium findings, all fixed in commit c74962a: (1) the delete lock was released after a successful delete, now kept; (2) the create form allowed the link with no account, now an account is required; (3) AC-13 and AC-19 had no component test, now added. Low findings fixed: the entries note shows only at the 100 cap, "load more" merges entries recorded while it is in flight, and comments explain the percentage division by 100. Two Low findings accepted and not fixed: `listAccounts` is capped at 100 accounts, so accounts beyond the first 100 cannot be linked; and after an entry is recorded the form remounts and drops keyboard focus (the `role=status` message still announces the result).
- ✅ Security: `docs/ddw/security/sast-DISC-001-06e.md` reports 0 Critical, 0 High, 0 Medium, 0 Low and 3 Info.
- ⚠️ Items from the PRD or the spec that await the owner, none blocking:
  - Goal screens are online only: the goals API has no offline path (PRD Decision Log, proposed by the model).
  - The entries history stops at the latest 100 entries because the API accepts only a `limit` (PRD Decision Log, proposed by the model).
  - No idempotency key for entries (threat R-03): a retry after a lost response can record the same entry twice.
  - The raw account id of a linked goal is replaced by a generic "linked" label on the edit screen.
  - Accepted Low findings: the 100 account cap on the link list, and the keyboard focus lost after an entry is recorded.

Result: PASSED

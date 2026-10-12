# Test run DISC-001-06e

| Field | Value |
|---|---|
| Runner | vitest (V8 coverage via @vitest/coverage-v8), full suite with coverage; Playwright for the end-to-end file |
| Command | `pnpm test:coverage` (Vitest over `apps/api/src`, `apps/web/src` and `packages/shared/src` together, V8 coverage, `TEST_DATABASE_URL` pointing at the local PostgreSQL) |
| Total | 9147 |
| Passed | 9147 |
| Failed | 0 |
| Skipped | 0 |
| Statement coverage | 94.9 |
| Line coverage | 96.79 |
| Branch coverage | 90.04 |
| Function coverage | 94.81 |
| Coverage floor | 80% lines, branches and functions (AGENTS.md, "Testing") |

## Scope

Full-suite run for ticket DISC-001-06e (536 test files), measured over `apps/api/src`, `apps/web/src` and `packages/shared/src` together, as AGENTS.md requires. The ticket is web only: goal methods in the api-client, the goal view helpers and request builders, the goals catalogs (es and en), the goals list, goal detail with its entries history, create and edit forms, contribution and withdrawal forms, the delete confirmation and the four pages that replace the "coming soon" placeholder. It adds no endpoint, no migration and no dependency. The goals screens are online only (the goals API has no offline path).

End-to-end: `apps/web/e2e/goals.spec.ts`, 4 of 4 tests pass (create, contribute, withdraw, read the history, edit and delete; a goal linked to an account; another user's goal and a malformed id; the screens at 360 px).

## Acceptance criteria to tests

Folder `apps/web/test` unless a path is given.

| AC | Tests |
|---|---|
| AC-01 | `goals-list.test.tsx` "shows name, progress, target, currency, percentage and a bar per goal (%s, AC-01, AC-29)"; `api-client-goals.test.ts` "listGoals returns the parsed goals (AC-01)" |
| AC-02 | `goals-list.test.tsx` "shows the negative progress, 0% and an empty bar for an overdrawn linked goal (AC-02)"; `goals-helpers.test.ts` "gives an empty bar and the negative amount for a negative progress" |
| AC-03 | `goals-list.test.tsx` "shows the monthly amount as returned for a goal with a target date (AC-03)"; `goals-helpers.test.ts` "returns the monthly amount as the API string parsed to bigint" |
| AC-04 | `goals-list.test.tsx` "shows reached and no monthly amount for a reached goal (AC-04)"; `goals-helpers.test.ts` "gives reached, overdue, active with monthly and active" |
| AC-05 | `goals-list.test.tsx` "shows overdue instead of a monthly amount for an overdue goal (AC-05)"; `goals-helpers.test.ts` "gives reached, overdue, active with monthly and active" |
| AC-06 | `goals-list.test.tsx` "shows the empty state with the create action when there are no goals (AC-06)" |
| AC-07 | `goals-list.test.tsx` "shows the error with a retry, never the empty state, and retries (AC-07)"; `goal-detail.test.tsx` "shows the error with a retry that loads again when the load fails (AC-07)" |
| AC-08 | `goal-detail.test.tsx` "shows the figures and the entries newest first with kind, amount and date (AC-08)"; `apps/web/e2e/goals.spec.ts` the create, contribute, withdraw, history, edit and delete test |
| AC-09 | `goal-detail.test.tsx` "shows the not-found state to a missing or foreign goal (AC-09)" and "shows not-found for a malformed id and sends no request (invalid input)"; `api-client-goals.test.ts` "getGoal returns the goal and a 404 is the not found failure (AC-09)"; `apps/web/e2e/goals.spec.ts` "a goal of another user and a malformed id open the not found state (AC-09)" |
| AC-10 | `goal-detail.test.tsx` "\"Load more\" asks for the next larger limit and shows the extra entries (AC-10)" and "keeps an entry recorded while \"load more\" is in flight"; `goals-helpers.test.ts` "nextEntriesLimit goes from 50 to 100 and stops at 100"; `api-client-goals.test.ts` "listGoalEntries sends the limit and returns the entries (AC-10)" |
| AC-11 | `goal-detail.test.tsx` "hides the control when fewer entries than asked came back (AC-11)", "hides the control once 100 entries are shown (AC-11)" and "shows the latest-entries note only when the list is at the 100 cap"; `goals-helpers.test.ts` "canLoadMore is false when fewer came back than asked or 100 are shown" |
| AC-12 | `goal-form.test.tsx` "creates the goal and goes to the list" and "sends the chosen account"; `goals-helpers.test.ts` "builds the body from valid state" and "omits an empty date and link"; `api-client-goals.test.ts` "createGoal sends the amount as a minor-units string (AC-12)"; `apps/web/e2e/goals.spec.ts` the create, contribute, withdraw, history, edit and delete test (AC-12) |
| AC-13 | `goal-form.test.tsx` "shows a field error and sends nothing for %j / %j" (empty name, 81 characters, empty amount, zero, "abc"; focus moves to the first invalid field) and "blocks the submit with a field error when the link is checked but no account is chosen"; `goals-helpers.test.ts` "rejects an empty name or a zero amount" |
| AC-14 | `goal-form.test.tsx` "makes no request until the link is chosen, then offers active accounts of the currency" and "says so when there are no accounts in the currency" |
| AC-15 | `goal-form.test.tsx` "clears the chosen account when the currency changes" |
| AC-16 | `goal-form.test.tsx` "loads the goal in one request, shows currency and account read only and no link"; `apps/web/e2e/goals.spec.ts` "a goal linked to an account has no entry forms and shows no raw id on edit" |
| AC-17 | `goal-form.test.tsx` "sends only the changes and shows the figures the API returned"; `goals-helpers.test.ts` "sends only changed values" and "sends a changed amount as minor units"; `apps/web/e2e/goals.spec.ts` the create, contribute, withdraw, history, edit and delete test (AC-17) |
| AC-18 | `goal-form.test.tsx` "clearing the target date sends null and shows no monthly amount"; `goals-helpers.test.ts` "sends a null date when it was cleared"; `api-client-goals.test.ts` "updateGoal sends targetDate null to remove the date (AC-18)" |
| AC-19 | `goal-form.test.tsx` "an empty or invalid %s shows a field error and sends nothing" (name, long name, amount zero, non-numeric amount); `goals-helpers.test.ts` "rejects an empty name or a zero amount" |
| AC-20 | `goal-entries.test.tsx` "records a contribution of 200.00 once and hands the response to onRecorded (AC-20, AC-23)"; `goal-detail.test.tsx` "puts a recorded entry on top and follows the goal in the response with no request (AC-20, AC-23)"; `api-client-goals.test.ts` "recordGoalEntry returns the entry and the updated goal (AC-20)"; `apps/web/e2e/goals.spec.ts` the create, contribute, withdraw, history, edit and delete test (AC-20) |
| AC-21 | `goal-entries.test.tsx` "shows a field error and sends nothing for \"%s\" (AC-21)" (empty, "0", "abc"); `goals-helpers.test.ts` "rejects %j" for '', '0', 'abc' and '-5' |
| AC-22 | `goal-entries.test.tsx` "a linked goal shows no forms and the notice (AC-22)"; `apps/web/e2e/goals.spec.ts` "a goal linked to an account has no entry forms and shows no raw id on edit" |
| AC-23 | `goal-entries.test.tsx` "records a contribution of 200.00 once and hands the response to onRecorded (AC-20, AC-23)"; `goal-detail.test.tsx` "puts a recorded entry on top and follows the goal in the response with no request (AC-20, AC-23)" |
| AC-24 | `goal-delete.test.tsx` "confirming deletes once and calls onDeleted (AC-24)" and "keeps the lock after a successful delete so a later tap sends nothing"; `goal-detail.test.tsx` "goes to the list after the goal is deleted"; `api-client-goals.test.ts` "deleteGoal resolves with no body (AC-24)"; `apps/web/e2e/goals.spec.ts` the create, contribute, withdraw, history, edit and delete test (AC-24) |
| AC-25 | `goal-delete.test.tsx` "cancelling closes the confirmation and sends nothing (AC-25)" and "asks first, saying entries go and no balance changes (FR-11)" |
| AC-26 | `goal-entries.test.tsx` "a refused withdrawal shows the message and keeps the amount (AC-26)"; `api-client-goals.test.ts` "a refused withdrawal and a refused 100th goal surface their own keys (AC-26, AC-27)"; `goals-helpers.test.ts` "maps refusals to their catalog key" |
| AC-27 | `goal-form.test.tsx` "shows the refused 100th goal and keeps the values"; `api-client-goals.test.ts` "a refused withdrawal and a refused 100th goal surface their own keys (AC-26, AC-27)" |
| AC-28 | `goals-list.test.tsx` "shows the offline message on a network failure (AC-28)"; `goal-detail.test.tsx` "shows the offline message when the first load is offline (AC-28)" and "shows the offline message and keeps the shown data when \"load more\" is offline (AC-28)"; `goal-entries.test.tsx` "a network failure shows the offline message and keeps the amount (AC-28)"; `goal-delete.test.tsx` "a network failure shows the offline message and keeps the confirmation (AC-28)"; `goal-form.test.tsx` "shows the offline message and keeps the input on a network failure" and "keeps the input on a network failure when saving"; `api-client-goals.test.ts` "a network failure is the offline failure (AC-28)" |
| AC-29 | `goals-list.test.tsx` the es and en run of "shows name, progress, target, currency, percentage and a bar per goal (%s, AC-01, AC-29)"; `goal-detail.test.tsx` "renders Spanish strings, amounts and dates (AC-29)"; `goal-entries.test.tsx` "renders Spanish and English strings (AC-29)"; `goal-delete.test.tsx` "renders Spanish strings (AC-29)"; `goal-form.test.tsx` both "renders Spanish strings" tests; `goals-catalog.test.ts` "has every goals key in %s with its ICU arguments" and "bakes no amount or date into a message"; `goals-no-hardcoded-strings.test.ts` "has no hardcoded user-facing string" |

## Non-functional requirements to tests

| NFR | Tests |
|---|---|
| NFR-01 | `apps/web/e2e/goals.spec.ts` "the list, detail, create and edit screens fit a 360 px viewport (NFR-01)" |
| NFR-02 | `goals-list.test.tsx` "makes exactly 1 request (NFR-02)"; `goal-detail.test.tsx` "shows a linked goal without history and with 1 request; an unlinked one makes 2 (NFR-02)" and "makes 2 requests for an unlinked goal (NFR-02)"; `goal-form.test.tsx` "makes no request until the link is chosen, then offers active accounts of the currency" and "loads the goal in one request, shows currency and account read only and no link"; `goal-entries.test.tsx` and `goal-detail.test.tsx` recording an entry makes exactly 1 request (AC-23) |
| NFR-03 | `goals-catalog.test.ts` "has the same goals keys in es and en, none empty" and "error: a catalog lacking a key is detected"; the existing `i18n-catalogs.test.ts` parity test |
| NFR-04 | `goals-no-hardcoded-strings.test.ts` "applies no parseFloat, toFixed or Number( to money" and "derives no percentage or amount on the client", with the planted-code checks "error: planted arithmetic on a percentage is reported with file and line" and "error: planted parseFloat on an amount is reported"; `goals-helpers.test.ts` "clamps the bar width to 100 and keeps the percentage as received" |
| NFR-05 | Coverage figures above (all files: 96.79 lines, 90.04 branches, 94.81 functions); every AC row of the table above names at least one test |
| NFR-06 | `goals-list.test.tsx` "has 44 px targets and a labeled bar (NFR-06)"; `goal-entries.test.tsx` "controls have labels and 44 px targets (NFR-06)"; `goal-delete.test.tsx` "controls have 44 px targets (NFR-06)"; `goal-form.test.tsx` "labels every control and gives buttons a 44 px target" |

Sad-path tests: signed-out user sent to sign in, list load failure with retry, missing, foreign and malformed goal id (no request sent), detail load failure and "load more" failure with retry, offline on every screen, empty or oversized name, empty, zero and non-numeric amount on create, edit and entry forms, link checked with no account or with the accounts failed to load, no accounts in the currency, refused 100th goal, refused withdrawal larger than the progress, double tap sending one request, delete of a goal that is not found, malformed response body, invalid body or limit rejected before any request (`goals-list.test.tsx`, `goal-detail.test.tsx`, `goal-form.test.tsx`, `goal-entries.test.tsx`, `goal-delete.test.tsx`, `goals-helpers.test.ts`, `api-client-goals.test.ts`, `apps/web/e2e/goals.spec.ts`).

Other checks:

- Spec Block 0 (api-client): `api-client-goals.test.ts` (11 tests).
- Spec Block 1 (helpers): `goals-helpers.test.ts`.
- Spec Block 2 (catalogs): `goals-catalog.test.ts` plus the existing catalog parity test.
- Spec Blocks 3 to 6 (screens): `goals-list.test.tsx`, `goal-detail.test.tsx`, `goal-form.test.tsx`, `goal-entries.test.tsx`, `goal-delete.test.tsx`.
- Spec Block 7 (pages, scans, end-to-end): `goals-no-hardcoded-strings.test.ts` and `apps/web/e2e/goals.spec.ts` (4 of 4 pass).
- `pnpm audit --prod --audit-level high`: no dependency was added or changed (no `package.json` or lockfile in the diff).

## Run anomalies

(none)

## Deviations from the spec, for the record

(none)

## Owner decisions pending

- Online-only goal screens: the goals API has no offline path (PRD Decision Log).
- Entries history capped at the latest 100: the API accepts only a `limit` (PRD Decision Log).
- No idempotency key for entries (threat R-03): a retry after a lost response can record the entry twice.
- The raw account id on a linked goal is replaced by a generic "linked" label.

## Failures

(none)

## Skips

(none)

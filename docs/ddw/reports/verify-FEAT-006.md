# Verification FEAT-006

| Field | Value |
|---|---|
| Module | `apps/api/src/accounts/**` (use case, port, repository, routes), `packages/shared/src/accounts/account.ts`, `apps/web/src/lib/api-client.ts`, `apps/web/src/features/accounts/**`, `apps/web/messages/*.json`; no migration |
| Line coverage | 96.88% |
| Branch coverage | 91.67% |
| Function coverage | 94.89% |
| Coverage floor | 80% (AGENTS.md, "Testing"), measured over `apps/api/src`, `apps/web/src` and `packages/shared/src` together |
| Lint | `pnpm exec eslint .` — clean, 0 findings; `pnpm exec prettier --check --end-of-line auto .` — clean; `pnpm typecheck` — clean (the web project includes the e2e folder) |

The cross-verification was done by the author, reading every AC, block and NFR against the code and
the tests; no `ddw-module-verifier` subagent was spawned (the run is single-threaded by the
owner's cap and no block needed one). That is a weaker check than an independent verifier, and it is
declared here on purpose. The coverage numbers come from the full run in
`docs/ddw/reports/tests-FEAT-006.md` (6189 of 6189 tests passed; `coverage/coverage-summary.json`
written after the last code commit). DDW does not run the suite; these are the numbers of the run
recorded there.

Coverage of the new or modified files (lines / branches / functions): `set-opening-balance.ts`,
`opening-balance-request.ts` and `packages/shared/src/accounts/account.ts` are at 100 / 100 / 100;
`drizzle-account-repository.ts` 100 / 88.23 / 100; `account-routes.ts` 100 / 83.33 / 100;
`account-list.tsx` 100 / 94.73 / 100; `account-row.tsx` 100 / 94.11 / 100; `api-client.ts`
100 / 99.03 / 99.06; `accounts-container.tsx` 96.45 / 75 / 100 (its uncovered branches are the
existing error branches of rename, archive and delete, and the silent-reload failure path). Every
changed file is at or above 80% for lines and functions, and the combined figure for the changed
files is above 80% for branches.

## Acceptance criteria
- ✅ AC-01 — `account-routes.test.ts` "changes the opening balance and answers the account, visible in GET" (`account-routes.ts:153`)
- ✅ AC-02 — `account-contracts.test.ts` "rejects ... and names the field" (six inputs); route test "rejects ... naming body.openingBalance and leaves the account unchanged" (five inputs, value read back from the database)
- ✅ AC-03 — route test "rejects an id that is not a UUID and writes nothing"
- ✅ AC-04 — `account-contracts.test.ts` "accepts ... the same range as creation"; use case test "accepts a negative and a zero value"; route test "accepts zero and negative values and the limits"
- ✅ AC-05 — `account-use-cases.test.ts` "returns the new opening balance and a balance that moves by the difference"; route test "answers a balance equal to the new opening balance plus the movement sum, and the totals follow"
- ✅ AC-06 — use case test and route test "answers 200 unchanged when the current value is sent" (`set-opening-balance.ts`)
- ✅ AC-07 — `account-repository.test.ts` "changes only opening_balance and updated_at and leaves the movements rows identical" (reads the movements rows before and after, frozen rate included)
- ✅ AC-08 — use case, repository and route tests for an unknown id (404, nothing written)
- ✅ AC-09 — use case, repository and route tests for another user's account (404 with the same body as a missing id, value read back unchanged)
- ✅ AC-10 — route tests: 401 and 403 `EMAIL_NOT_VERIFIED` through the guard table entry "opening balance", and 403 without the web origin headers with the value unchanged and a control request that succeeds
- ✅ AC-11 — use case test and repository test on an archived account (stays archived); route test "accepts the change on an archived account, a credit card and a card-linked account"
- ✅ AC-12 — use case test (credit card account and an account reported as linked by the links fake) and the route test above; the use case never consults `AccountLinks`, so the linked case is covered by construction
- ✅ AC-13 — route test "logs the change with ids only, never an amount or the name" (message, request id, user id, account id; allowlist of keys; no old or new amount, no name)
- ✅ AC-14 — `accounts-components.test.tsx` "offers the action on an active account, an archived account and a credit card"
- ✅ AC-15 — `accounts-components.test.tsx` "shows the current value formatted for the currency, the pre-filled input and the hint"
- ✅ AC-16 — `accounts-components.test.tsx` "previews the new balance as balance minus opening plus the typed amount, negatives included"; `opening-balance-request.test.ts` locale parsing
- ✅ AC-17 — `opening-balance-request.test.ts` empty and malformed inputs; container test "does not send an empty or malformed amount and says why"; component test with the message
- ✅ AC-18 — `opening-balance-request.test.ts` over-limit in both locales; container test "does not send an amount above the limit and shows the formatted limit"; component test with the limit
- ✅ AC-19 — container test "sends the parsed amount, shows the updated row, closes the form and reads the totals again"; `api-client.test.ts` "sets the opening balance with PATCH"; e2e test in `apps/web/e2e/accounts.spec.ts` (typechecked, not run)
- ✅ AC-20 — `api-client.test.ts` mapping of the API answers equal to rename's (404, 400, 403, and 401 after the refresh is refused); container tests "keeps the form open and shows the mapped message" and "sends the user to sign-in when the session is gone"
- ✅ AC-21 — component test "reports the typed text with the account id on save and closes on cancel"; container test "cancels without calling the API"
- ✅ AC-22 — `i18n-catalogs.test.ts` "has every new string" in both locales, plus the existing parity tests that stop the suite on any one-sided key

## Spec blocks
- ✅ Block 1 — shared schema, port, use case, Drizzle method, fake; the required tests present (commit 2534a5e)
- ✅ Block 2 — route and ids-only audit line; the required tests present (commit c3abce9)
- ✅ Block 3 — web client call, request builder and catalog strings; the required tests present (commit b74307a)
- ✅ Block 4 — row action, form, list props, container and the e2e test; the required tests present (commit 2a36670)

## Non-functional requirements
- ✅ NFR-01 — the repository issues one `UPDATE ... RETURNING` scoped by owner; the foreign and missing cases return `null` from that single statement and run nothing else (`account-repository.test.ts`)
- ✅ NFR-02 — bigint end to end; the schema, route and builder tests accept plus or minus 10^15 and refuse one beyond; the SAST scan found no `Number`, `parseFloat` or `toFixed` on amounts, and the existing no-float-money tests pass
- ✅ NFR-03 — `git diff 533395f` over every `package.json`, the lockfile and `apps/api/drizzle` is empty
- ✅ NFR-04 — the audit test asserts no amount and no name in the log line
- ✅ NFR-05 — the action reuses `IconAction` and the form buttons reuse `Button size="sm"`, as rename does; no new size or class was introduced
- ✅ NFR-06 — 80% floor met (96.88 / 91.67 / 94.89) and 0 failing tests out of 6189

## Tests
- ✅ F-VER-06: every test the spec lists exists and passes (6189 of 6189 in the full run).
- ✅ Sad-path tests: every input path has one — missing, decimal, numeric and over-limit amounts (schema, route and builder), a non-UUID id, an unknown id, another user's account (404 with the same body), no session (401), an unverified email (403), a request without the origin headers (403), an empty or malformed form field, an over-limit form field, a refused API call that keeps the form open, an expired session that goes to sign-in, and cancel.

## Warnings
- ⚠️ The e2e test was written and typechecked but not run, as instructed; the running of `pnpm e2e` is left to the owner.
- ⚠️ In the route test for AC-12 the "card-linked" case uses a links stub that always answers true; because the use case never consults `AccountLinks`, the stub proves nothing by itself and the rule rests on the credit card account and the use case test.
- ⚠️ `accounts-container.tsx` is at 75% branch coverage as a file; the uncovered branches are pre-existing error paths of other actions, not the new code.
- ⚠️ The independent verifier and implementer subagents were not used (declared above).
- ⚠️ The route has no dedicated rate limiter, like rename and archive (threat R-07, left to the owner).

Result: PASSED

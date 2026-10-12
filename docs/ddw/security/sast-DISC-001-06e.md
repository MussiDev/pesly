# SAST report DISC-001-06e: Goals Screens

| Field | Value |
|---|---|
| Ticket | DISC-001-06e |
| Tier | FEATURE |
| Date | 2026-10-11 |
| Scope | The web code of DISC-001-06e: `apps/web/src/features/goals/{helpers,list,detail,form,entries,delete}/*` (25 files), the pages under `apps/web/src/app/[locale]/(app)/goals/**` (4 files), the goal methods of `apps/web/src/lib/api-client.ts` (`listGoals`, `getGoal`, `createGoal`, `updateGoal`, `deleteGoal`, `recordGoalEntry`, `listGoalEntries` and the `onGoal` helper), and the e2e files `apps/web/e2e/goals.spec.ts` and `apps/web/e2e/support/goals.ts`. No API code is in scope (spec: no endpoint added). Tests are read only for what they assert. No dependency added. |
| Method | Manual review by one reader (no semgrep or other SAST scanner is installed in this environment) against catalog §4: targeted searches over the scope (`dangerouslySetInnerHTML`, `innerHTML`, `document.*`, `eval`, `new Function`, `console`, `localStorage`, `sessionStorage`, `window.open`, `window.location`, `href=`, every `router.push` and `router.replace`, `encodeURIComponent`, `Number(`, `parseFloat`, `toFixed`, `Math.`, `JSON.parse`, `setTimeout`, `eslint-disable`, `@ts-ignore`, `any`, `t.rich`, `process.env`, token and secret patterns), a full read of `goal-request.ts`, `goal-view.ts`, `entries-paging.ts`, `goal-failure.ts`, the list, detail, create, edit, entry and delete containers, the account select, the progress bar, the four pages, the goal calls in the api-client, and both e2e files; the threat model R-01 to R-09 as checklist |
| Result | PASSED — 0 Critical, 0 High, 0 Medium, 0 Low open; 3 Info documented below |

## Findings by rule

- ✅ F-SAST-01 Hardcoded secrets (CWE-798): the secret-pattern search finds no key, password, token or connection string in the scope; the client holds no credential, the session is an HttpOnly cookie, and the e2e support file signs in through the existing `signedInUser` helper.
- ✅ F-SAST-02 SQL injection (CWE-89): not applicable; the scope is browser code and builds no SQL; the goal id and the entries limit reach the API only as an encoded path segment and a `URLSearchParams` value.
- ✅ F-SAST-03 OS command injection (CWE-78): no `child_process`, `exec` or `spawn` in the scope.
- ✅ F-SAST-04 Insecure deserialization (CWE-502): every goal call parses its answer with a shared Zod schema (`listGoalsResponseSchema`, `goalResponseSchema`, `recordGoalEntryResponseSchema`, `listGoalEntriesResponseSchema`; the delete expects no body) and a mismatch is the generic failure; no `JSON.parse`, `localStorage` or `sessionStorage` is added by the screens.
- ✅ F-SAST-05 Path traversal (CWE-22): the goal id goes through `onGoal` and `resourcePath('goals', id)` (encoded, refuses `''`, `.` and `..`, `api-client.ts:964-969`); the detail and edit containers also refuse any id that is not a UUID with `z.uuid()` before any request (`goal-detail-container.tsx:37,46`, `edit-goal-container.tsx:25,49`), and the e2e test asserts zero requests for `not-an-id`; the only query string is built with `URLSearchParams` (`limit`, validated by `listGoalEntriesQuerySchema`); no file access in the scope.
- ✅ F-SAST-06 XSS (CWE-79): the search finds no `dangerouslySetInnerHTML`, `innerHTML`, `document.write` or `t.rich` in the scope; goal names, account names and amounts are React text children or ICU arguments (`goal-card.tsx:14`, `goal-account-select.tsx:63`, `goal-progress.tsx`); the only `style` is a `width` percentage where `barWidth` is a number clamped to 0..100 by `Math.min` and `Math.max` (`goal-view.ts:41`), so no string from the server reaches CSS; no `href` is built from free text.
- ✅ F-SAST-07 SSRF (CWE-918): browser code; the only outbound target is the configured API base URL through `request`, which the screens do not bypass.
- ✅ F-SAST-08 Broken cryptography (CWE-327): no cryptography added; no `Math.random`, MD5 or SHA-1 in the scope.
- ✅ F-SAST-09 Debug mode in production (CWE-489): no `console` call, debug flag or `NODE_ENV` branch in the scope.
- ✅ F-SAST-10 Logging sensitive data (CWE-532): no `console` call, analytics or error reporter in the scope; goal names, amounts and ids are never logged; failures carry a code and a catalog key only.
- ✅ F-SAST-11 Unrestricted upload (CWE-434): no upload surface.
- ✅ F-SAST-12 Missing CSRF protection (CWE-352): the state-changing calls (`createGoal`, `updateGoal`, `deleteGoal`, `recordGoalEntry`) go through the existing `request`, which sends `X-Requested-With` and `credentials: 'include'`; the forms never submit natively to a URL.
- ✅ F-SAST-13 Critical/High CVE in a dependency: no `package.json` or `pnpm-lock.yaml` change; the screens import React, next-intl, lucide-react, zod (already a dependency), the owned `components/ui` and `@pesly/shared`; the audit is re-run by the release gate.
- ✅ F-SAST-14 Incomplete input validation (CWE-20): `goal-request.ts` trims the name and checks 1 to `GOAL_NAME_MAX_LENGTH` code points (`Array.from`), parses the amount with `parseAmountInput` and requires a positive value that passes `movementAmountSchema`, and checks the date with `calendarDateSchema`; the api-client parses every request body with the shared schema again before sending (`createGoalRequestSchema`, `updateGoalRequestSchema`, `createGoalEntryRequestSchema`, `listGoalEntriesQuerySchema`); the API validates a third time (threat R-02).
- ✅ F-SAST-15 Insecure error handling (CWE-209): `goalFailureKey` maps a failure to `not-found`, `offline` or `errors.<messageKey>`; the screens render catalog messages, never server text; a missing and a foreign goal both end in one not-found state (`goal-detail-container.tsx:61,90`, `edit-goal-container.tsx:69`), and a 404 on a form is shown as the generic `errors.unexpected` (`form-failure.ts:7`).
- ✅ F-SAST-16 Medium CVE in a dependency: none (no dependency changed).
- ✅ F-SAST-17 Unsafe function (CWE-95): no `eval`, `new Function` or string timers in the scope; the e2e files use no `page.evaluate`, and `scrollsHorizontally` comes from the existing support module.
- ✅ F-SAST-18 Suppressions complete: no suppressions in this report; the scope has no `eslint-disable`, `@ts-ignore` or `@ts-expect-error`, and no `any`.
- ✅ F-SAST-19 Suppressions within review window: no suppressions in this report.

## Cross-cutting checks

- Open redirects and URL building: every `router.push` and `router.replace` in the scope targets a static path (`/sign-in`, `/goals`); every `Link href` is a static path (`/goals`, `/goals/new`) or `/goals/` followed by an id (`goal-detail-view.tsx:49` and `edit-goal-container.tsx:132` use `encodeURIComponent`; `goal-card.tsx:12` interpolates the id directly, see I-1). The paths are relative and prefixed through the i18n `Link`, so they cannot leave the origin or become a `javascript:` URL.
- Money formatting: the search finds no `parseFloat`, `toFixed` or `Number(` in the scope (the R-02 scan holds). `Math.min` and `Math.max` appear once, in `goal-view.ts:41`, on the integer percentage for the bar width only (I-2). Amounts stay `bigint` minor units through `parseAmountInput`, `BigInt(...)`, `formatMinorUnits` and `formatMoney`; the edit comparison is `BigInt(amount) !== BigInt(original.targetAmount)` (`goal-request.ts:107`), never a float. Progress, percentage and monthly amount are shown as the API returned them and are not recomputed (`goal-view.ts`); after an entry the goal comes from the response (`goal-detail-container.tsx:140-150`).
- Double submit (threat R-03): the entry forms and the delete confirmation use a `useRef` lock so that a second tap in the same tick sees the first (`goal-entry-actions.tsx:38,47,58`, `goal-delete-action.tsx:23,26`), released in `finally`; the create and edit forms use a `sending` ref plus the disabled submit control (`create-goal-container.tsx:39,45`, `edit-goal-container.tsx:78,89`). A retry after a lost response can still duplicate an entry, which is the risk the owner accepted in R-03 (the API has no idempotency key).
- Load more (threat R-08): `nextEntriesLimit` returns 50 then 100 and never more (`entries-paging.ts:6-10`), `canLoadMore` hides the control at 100 returned, `loadMore` returns early while a request is in flight (`goal-detail-container.tsx:115`), and the shared query schema bounds the limit again.
- Stale responses: both effects that load goals use an `active` flag in the cleanup (`goal-detail-container.tsx:54-55,93-95`, `goals-container.tsx:29-38`), so an answer for a previous id or attempt cannot overwrite the current state.
- Controls hidden, API authoritative: the entry forms are replaced by `LinkedGoalNotice` when `goal.accountId !== null`, and currency and link are read-only on edit (`goal-read-only-fields.tsx`); these are conveniences. A forged entry, account, currency or withdrawal over the progress is refused by the API and shown as a catalog message (`goalLinkedToAccount`, `goalWithdrawalExceedsProgress`, `goalAccountCurrencyMismatch`). No permission or balance check is derived on the client.
- Information disclosure for 404: the detail and edit screens render one not-found state for a missing goal, a goal of another user and a malformed id; the e2e test for AC-09 asserts it. The edit screen does not show the raw goal id (second e2e test).
- Account list for linking: loaded only when the link is chosen, with `archived: false` and `limit: 100`, filtered again by currency on the client; the API still checks that the account belongs to the caller.
- e2e files: data is created through the UI with one user per test (`goals-flow`, `goals-linked`, `goals-owner`, `goals-outsider`, `goals-narrow`); no credentials, tokens or real external services are used; the second browser contexts are closed in `finally`.
- Supply chain: no manifest or lockfile change, no new import source, no remote script, font or image in the scope.

## Threat model checklist (R-01 to R-09)

- R-01 a user opens another user's goal by guessing an id: the API answers 404 for both cases and the screens render one not-found state; the UUID check stops a malformed id before any request. Mitigated, tested in e2e.
- R-02 floating point or an oversized number corrupts a typed amount: only `parseAmountInput`, `movementAmountSchema` and minor-unit strings; no `parseFloat`, `toFixed` or `Number(` in the scope. Mitigated.
- R-03 duplicate entry on a double tap or a lost response: the in-flight lock and the disabled control cover the double tap; the retry case is accepted by the owner and documented in the threat model.
- R-04 a withdrawal drives progress below zero: the API refuses it (`GOAL_WITHDRAWAL_EXCEEDS_PROGRESS`) and the screen shows the catalog message and keeps the amount; e2e asserts the history is unchanged.
- R-05 a goal name with markup runs script: names render as React text; no `dangerouslySetInnerHTML` (F-SAST-06).
- R-06 a session cookie is abused for a forged request: all writes use the existing request function with its CSRF header and credentialed same-site policy; no token handling is added (F-SAST-12).
- R-07 an error message leaks server details: only catalog keys are rendered (F-SAST-15).
- R-08 load more hammers the entries endpoint: bounded at 100, disabled in flight (cross-cutting check).
- R-09 a hardcoded string or one-language screen ships: every string goes through `useTranslations`; the e2e support reads the same catalogs. Not a security control beyond the code-to-key mapping.

## Low and informational findings (W-SAST-01)

| ID | Severity | Location | Finding | Disposition |
|---|---|---|---|---|
| I-1 | Info (CWE-79) | `apps/web/src/features/goals/list/goal-card.tsx:12` | The card link interpolates `goal.id` into `/goals/<id>` without `encodeURIComponent`, unlike the detail and edit links | Not exploitable: `goalResponseSchema` types `id` as `z.uuid()` (`packages/shared/src/goals`), so a value with `/`, `?` or `#` fails parsing and never reaches the card; the link is relative and prefixed. Encoding it for consistency can be taken in a later ticket |
| I-2 | Info (CWE-682) | `apps/web/src/features/goals/helpers/goal-view.ts:41` | `Math.min(100, Math.max(0, goal.percentage))` is the only `Math` use on a value that comes from money | Display only: the input is the integer percentage the API computed, the result is a number from 0 to 100 used for the bar width and `aria-valuenow`; no amount is derived from it |
| I-3 | Info (CWE-755) | `apps/web/src/features/goals/form/create-goal-container.tsx:48` and `edit-goal-container.tsx:91` | The awaited `createGoal` and `updateGoal` calls have no `try/finally`, so the in-flight flag would stay set if the call threw | Not reachable: the api-client returns an `ApiResult` for network and parse failures instead of throwing, and the entry and delete actions, which move the money figures, do use `finally`; a stuck flag would only block resubmitting until reload |

## Summary

Total: 19 categories clean, 0 vulnerabilities open (0 critical, 0 high, 0 medium, 0 low); 3 Info documented, none blocking.

# SAST report DISC-001-06f: Budgets Screens

| Field | Value |
|---|---|
| Ticket | DISC-001-06f |
| Tier | FEATURE |
| Date | 2026-10-11 |
| Scope | The web code of DISC-001-06f: `apps/web/src/features/budgets/{helpers,list,detail,form,delete}/*`, the pages under `apps/web/src/app/[locale]/(app)/budgets/**` (4 files), the budget methods of `apps/web/src/lib/api-client.ts` (`listBudgetSpending`, `getBudget`, `getBudgetSpending`, `createBudget`, `updateBudget`, `deleteBudget`, the `onBudget` and `monthSuffix` helpers), and the budget-alert branch of `apps/web/src/features/notices/components/notice-list.tsx`. No API code is in scope (spec: no endpoint added). Tests are read only for what they assert. No dependency added. |
| Method | Manual review by one reader (no semgrep or other SAST scanner is installed in this environment) against catalog §4: targeted searches over the scope (`dangerouslySetInnerHTML`, `innerHTML`, `document.*`, `eval`, `new Function`, `console`, `localStorage`, `sessionStorage`, `window.open`, `window.location`, `href=`, every `router.push` and `router.replace`, `useSearchParams`, `encodeURIComponent`, `Number(`, `parseFloat`, `toFixed`, `Math.`, `JSON.parse`, `setTimeout`, `Object.assign`, `__proto__`, `eslint-disable`, `@ts-ignore`, `any`, `t.rich`, `process.env`, token and secret patterns), a full read of `budget-month.ts`, `budget-view.ts`, `budget-request.ts`, the list, detail, create and edit containers, the budget card, the four pages, the budget calls in the api-client and the notice list; the threat model (`threat-DISC-001-06f.md`) as checklist |
| Result | PASSED — 0 Critical, 0 High, 0 Medium, 0 Low open; 3 Info documented below |

## Findings by rule

- ✅ F-SAST-01 Hardcoded secrets (CWE-798): the secret-pattern search finds no key, password, token or connection string in the scope; the client holds no credential and the session is an HttpOnly cookie.
- ✅ F-SAST-02 SQL injection (CWE-89): not applicable; the scope is browser code and builds no SQL; the budget id and the month reach the API only as an encoded path segment and a validated query value.
- ✅ F-SAST-03 OS command injection (CWE-78): no `child_process`, `exec` or `spawn` in the scope.
- ✅ F-SAST-04 Insecure deserialization (CWE-502): every budget call parses its answer with a shared Zod schema (`budgetSpendingListResponseSchema`, `budgetResponseSchema`, `budgetSpendingResponseSchema`; the delete expects no body) and a mismatch is the generic failure; the search finds no `JSON.parse`, `localStorage` or `sessionStorage` in the scope, and no `Object.assign`, `__proto__` or dynamic key write from server data (the destructuring at `budget-month.ts:17` is array destructuring of an already validated string).
- ✅ F-SAST-05 Path traversal (CWE-22): the budget id goes through `onBudget` and `resourcePath('budgets', id)` (encoded, refuses `''`, `.` and `..`, `api-client.ts:996-1002`); the detail and edit containers also refuse any id that is not a UUID with `z.uuid()` before any request (`budget-detail-container.tsx:50`, `edit-budget-container.tsx:26,61`); the month query is built only from a value that already passed `budgetSpendingQuerySchema` (`api-client.ts:2076,2096`); no file access in the scope.
- ✅ F-SAST-06 XSS (CWE-79): the search finds no `dangerouslySetInnerHTML`, `innerHTML`, `document.write` or `t.rich` in the scope; budget names, category names and amounts are React text children or ICU arguments (`budget-card.tsx:19`); the notice list renders `notice.text` as a plain text node and the budget alert caption through `formatPeriod` on a `YYYY-MM` slice (`notice-list.tsx:28`); the only `style` is a `width` percentage where `barWidth` is a number clamped to 0..100 (`budget-view.ts:33`), so no string from the server reaches CSS; no `href` is built from free text.
- ✅ F-SAST-07 SSRF (CWE-918): browser code; the only outbound target is the configured API base URL through `request`, which the screens do not bypass.
- ✅ F-SAST-08 Broken cryptography (CWE-327): no cryptography added; no `Math.random`, MD5 or SHA-1 in the scope.
- ✅ F-SAST-09 Debug mode in production (CWE-489): no `console` call, debug flag or `NODE_ENV` branch in the scope.
- ✅ F-SAST-10 Logging sensitive data (CWE-532): no `console` call, analytics or error reporter in the scope; budget names, amounts and ids are never logged; failures carry a code and a catalog key only.
- ✅ F-SAST-11 Unrestricted upload (CWE-434): no upload surface.
- ✅ F-SAST-12 Missing CSRF protection (CWE-352): the state-changing calls (`createBudget`, `updateBudget`, `deleteBudget`) go through the existing `request`, which sends `X-Requested-With` and `credentials: 'include'`; the forms never submit natively to a URL.
- ✅ F-SAST-13 Critical/High CVE in a dependency: no `package.json` or `pnpm-lock.yaml` change; the screens import React, next-intl, next/navigation, lucide-react, zod (already a dependency), the owned `components/ui` and `@pesly/shared`; the audit is re-run by the release gate.
- ✅ F-SAST-14 Incomplete input validation (CWE-20): `budget-request.ts` trims the name and checks 1 to `BUDGET_NAME_MAX_LENGTH` code points (`Array.from`), parses the amount with `parseAmountInput` and requires a positive value that passes `movementAmountSchema`, bounds categories (unique, 1 to `BUDGET_MAX_CATEGORIES`) and thresholds (unique integers inside the min and max percent, at most `BUDGET_MAX_THRESHOLDS`); the `month` query parameter of the page is checked with `isValidMonth` (`budgetSpendingMonthSchema`) before use (`budget-detail-container.tsx:49`, `budgets-container.tsx:77-79`) and a malformed one is ignored; the api-client parses every request body and query with the shared schema again before sending; the API validates a third time.
- ✅ F-SAST-15 Insecure error handling (CWE-209): `budgetFailureKey` maps a failure to `not-found`, `offline` or `errors.<messageKey>`; the screens render catalog messages, never server text; a missing and a foreign budget both end in one not-found state (`budget-detail-container.tsx:76`, `edit-budget-container.tsx`), and a 404 on a form is shown as a generic message (`form-failure.ts`).
- ✅ F-SAST-16 Medium CVE in a dependency: none (no dependency changed).
- ✅ F-SAST-17 Unsafe function (CWE-95): no `eval`, `new Function` or string timers in the scope (the `setTimeout` search is empty).
- ✅ F-SAST-18 Suppressions complete: no suppressions in this report; the scope has no `eslint-disable`, `@ts-ignore` or `@ts-expect-error`, and no `any`.
- ✅ F-SAST-19 Suppressions within review window: no suppressions in this report.

## Cross-cutting checks

- Open redirects and URL building: every `router.push` and `router.replace` in the scope targets a static path (`/sign-in`, `/budgets`; `budget-detail-container.tsx:75,120`, `create-budget-container.tsx:34,39`, `edit-budget-container.tsx:78,108`, `use-budget-categories.ts:26`). No navigation target is taken from the `month` query or from any other input. Every `Link href` is a static path (`/budgets`, `/budgets/new`) or `/budgets/` followed by an id (`budget-detail-view.tsx:36` and `edit-budget-container.tsx:140` use `encodeURIComponent`; `budget-card.tsx:13` interpolates the id and month directly, see I-1). The paths are relative and prefixed through the i18n `Link`, so they cannot leave the origin or become a `javascript:` URL.
- Route params and the month query: the `[id]` page param is a string that never reaches a request before `z.uuid()` and `resourcePath`; the `month` query is read with `useSearchParams` only as a candidate, accepted by `isValidMonth` (anchored regex `^(197[1-9]|19[89]\d|[2-9]\d{3})-(0[1-9]|1[0-2])$`) and otherwise dropped; the list follows a link month once and only when it is earlier than the current month, and the detail retries without a month when the API answers a future month. The month reaches the request only after `budgetSpendingQuerySchema`, so `monthSuffix` (`api-client.ts:1005-1007`) cannot carry `&`, `#` or `/` (I-3).
- Money formatting: the search finds no `parseFloat`, `toFixed` or `Number(` in the scope. `Math.min` and `Math.max` appear once, in `budget-view.ts:33`, on the integer percentage for the bar width only (I-2); `Number.parseInt` appears only in `budget-month.ts:18` on the already validated `YYYY-MM` parts, to step the month, never on an amount. Amounts stay `bigint` minor units through `parseAmountInput`, `BigInt(...)`, `formatMinorUnits` and `formatMoney` (`toBudgetView` converts `amount`, `available`, `remaining` and `rolloverAmount` with `BigInt`); the spending, available, remaining, rollover and percentage figures are shown as the API returned them and are not recomputed on the client.
- Double submit: the create and edit forms use a `sending` ref plus the disabled submit control (`edit-budget-container.tsx`, `create-budget-container.tsx`), and the delete confirmation keeps a pending state that disables the control (`budget-delete-action.tsx:20`).
- Stale responses: the effects that load budgets use an `active` flag in the cleanup (`budget-detail-container.tsx:57-59,88-90`, `budgets-container.tsx`), so an answer for a previous id, month or attempt cannot overwrite the current state.
- Controls hidden, API authoritative: currency is read-only on edit (`budget-read-only-fields.tsx`) and the covered categories come from the budget, but these are conveniences. A forged currency, a category of the wrong kind, a month in the future or a budget over the plan limit is refused by the API and shown as a catalog message (`budgetLimitReached`, `budgetCategoryKindInvalid`, `budgetMonthInFuture`). No permission check is derived on the client.
- Information disclosure for 404: the detail and edit screens render one not-found state for a missing budget, a budget of another user and a malformed id; the raw id is not shown.
- Storage: no `localStorage`, `sessionStorage` or cookie access in the scope; the selected month lives in component state and the link query only.
- Supply chain: no manifest or lockfile change, no new import source, no remote script, font or image in the scope.

## Threat model checklist (threat-DISC-001-06f)

- Reading another user's budget by guessing an id: the API answers 404 for both cases and the screens render one not-found state; the UUID check stops a malformed id before any request. Mitigated.
- Floating point or an oversized number corrupts a typed amount: only `parseAmountInput`, `movementAmountSchema` and minor-unit strings; no `parseFloat`, `toFixed` or `Number(` in the scope. Mitigated.
- A budget or category name with markup runs script: names render as React text; no `dangerouslySetInnerHTML` (F-SAST-06). Mitigated.
- A crafted `month` query injects a parameter or a redirect: the value is validated by an anchored regex before use and never builds a navigation target (cross-cutting checks). Mitigated.
- A session cookie is abused for a forged request: all writes use the existing request function with its CSRF header and credentialed same-site policy; no token handling is added (F-SAST-12).
- An error message leaks server details: only catalog keys are rendered (F-SAST-15).
- A hardcoded string or one-language screen ships: every string goes through `useTranslations`; not a security control beyond the code-to-key mapping.

## Low and informational findings (W-SAST-01)

| ID | Severity | Location | Finding | Disposition |
|---|---|---|---|---|
| I-1 | Info (CWE-79) | `apps/web/src/features/budgets/list/budget-card.tsx:13` | The card link interpolates `budget.id` and `budget.month` into `/budgets/<id>?month=<month>` without `encodeURIComponent`, unlike the detail and edit links | Not exploitable: `budgetSpendingResponseSchema` types `budgetId` as `z.uuid()` and `month` as `budgetSpendingMonthSchema` (`packages/shared/src/budgets/spending.ts:20,23`), so a value with `/`, `?`, `&` or `#` fails parsing and never reaches the card; the link is relative and prefixed. Encoding it for consistency can be taken in a later ticket |
| I-2 | Info (CWE-682) | `apps/web/src/features/budgets/helpers/budget-view.ts:33` | `Math.min(100, Math.max(0, value))` is the only `Math` use on a value that comes from money | Display only: the input is the integer percentage the API computed, the result is a number from 0 to 100 used for the bar width and `aria-valuenow`; no amount is derived from it |
| I-3 | Info (CWE-74) | `apps/web/src/lib/api-client.ts:1005-1007` | `monthSuffix` builds the query as a template string (`?month=${month}`) instead of `URLSearchParams` | Not exploitable: both callers parse the query with `budgetSpendingQuerySchema` first and return a validation failure otherwise (`api-client.ts:2076,2096`), and the schema is an anchored `YYYY-MM` regex, so no reserved character can pass |

## Summary

Total: 19 categories clean, 0 vulnerabilities open (0 critical, 0 high, 0 medium, 0 low); 3 Info documented, none blocking.

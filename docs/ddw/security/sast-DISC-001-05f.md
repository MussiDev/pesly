# SAST report DISC-001-05f: Group Expenses Screens

| Field | Value |
|---|---|
| Ticket | DISC-001-05f |
| Tier | FEATURE |
| Date | 2026-10-11 |
| Scope | The diff of DISC-001-05f over the 05e branch (`origin/feat/DISC-001-05e-groups-core-ui...HEAD`): 38 source files, namely `apps/web/src/lib/api-client.ts` (5 new calls), `apps/web/src/features/groups/{split,expenses/list,expenses/form,default-split,shares}/*`, `features/groups/containers/group-detail-container.tsx`, the pages under `apps/web/src/app/[locale]/(app)/groups/**`, both message catalogs, the e2e support file, and the API change of Block 0: `apps/api/src/groups/application/{get-group,get-expense-options}.ts` and `apps/api/src/groups/infrastructure/http/{group-presenter,group-expense-presenter}.ts` plus `packages/shared/src/groups/{group,expense}.ts`. Tests are read only for what they assert. No dependency added. |
| Method | Manual review of the diff by one reader (no semgrep or other SAST scanner is installed in this environment) against catalog §4: targeted searches over the scope (`dangerouslySetInnerHTML`, `innerHTML`, `document.*`, `eval`, `new Function`, `console`, `localStorage`, `sessionStorage`, `window.open`, `window.location`, `href=`, every `router.push` and `router.replace`, `encodeURIComponent`, `Number`, `parseFloat`, `toFixed`, `Math`, `eslint-disable`, `@ts-ignore`, `any`, token and secret patterns), a full read of the percentage and shares parsers, the new api-client calls (query building), the form container (payer and `selfMemberId` use), the API presenter and use-case diff, and the threat model R-01 to R-06 as checklist. `pnpm exec eslint` over the changed web source files and the pages under `app/**/groups/**` reports 0 errors and 0 warnings |
| Result | PASSED — 0 Critical, 0 High, 0 Medium, 0 Low open; 3 Info documented below |

## Findings by rule

- ✅ F-SAST-01 Hardcoded secrets (CWE-798): the secret-pattern search finds no key, password or connection string in the scope; the only `token` hits are the existing invitation token presenter (`group-presenter.ts:55-61`, unchanged) and password-reset schema names in `api-client.ts` imports; the client holds no credential, the session is an HttpOnly cookie.
- ✅ F-SAST-02 SQL injection (CWE-89): not applicable to the web scope; the API change reads no new query and builds no SQL (`get-group.ts` and `get-expense-options.ts` return a field of a row the access guard already loaded).
- ✅ F-SAST-03 OS command injection (CWE-78): no `child_process`, `exec` or `spawn` in the scope.
- ✅ F-SAST-04 Insecure deserialization (CWE-502): every new api-client call parses its answer with a shared Zod schema (`expenseOptionsResponseSchema`, `groupDetailResponseSchema` and the list and share schemas) and a mismatch is the generic `INTERNAL` failure; no `JSON.parse`, `localStorage` or `sessionStorage` is added by the screens.
- ✅ F-SAST-05 Path traversal (CWE-22): group ids go through `onGroup` and `resourcePath` (`encodeURIComponent`, refuses `''`, `.` and `..`, `api-client.ts:349`); query strings are built only with `URLSearchParams` (`from`, `to`, `limit`, `cursor`), so a cursor with `&` or `#` cannot add a parameter; no file access in the scope.
- ✅ F-SAST-06 XSS (CWE-79): the search finds no `dangerouslySetInnerHTML`, `innerHTML`, `document.write` or `t.rich` in the scope; descriptions, member names, category names and amounts are React text children or ICU arguments; no `href` is built from free text.
- ✅ F-SAST-07 SSRF (CWE-918): browser code; the only outbound target is the configured API base URL through `send`, which the screens do not bypass.
- ✅ F-SAST-08 Broken cryptography (CWE-327): no cryptography added; no `Math.random`, MD5 or SHA-1 in the scope.
- ✅ F-SAST-09 Debug mode in production (CWE-489): no `console` call, debug flag or `NODE_ENV` branch in the scope.
- ✅ F-SAST-10 Logging sensitive data (CWE-532): no `console` call, analytics or error reporter in the scope; amounts, descriptions and ids are never logged; failures carry a code and a message key only.
- ✅ F-SAST-11 Unrestricted upload (CWE-434): no upload surface.
- ✅ F-SAST-12 Missing CSRF protection (CWE-352): the new state-changing calls (`createGroupExpense`, `setDefaultSplit`) go through `send`, which sends `X-Requested-With` and `credentials: 'include'`; the forms call `preventDefault` and never submit natively to a URL.
- ✅ F-SAST-13 Critical/High CVE in a dependency: no `package.json` or `pnpm-lock.yaml` change in the range (spec D7); the screens import React, next-intl, lucide-react, the owned `components/ui` and `@pesly/shared`; the audit is re-run by the release gate.
- ✅ F-SAST-14 Incomplete input validation (CWE-20): bodies are checked against the shared request validators before sending (`expense-request.ts`, `default-split-request.ts`); amounts use `parseAmountInput`, percentages the digit-only pattern `^(\d{1,3})(?:[.,](\d{1,2}))?$` capped at 10000 basis points (`percentage-input.ts:3-14`), the date range a calendar-day check with from not after to (`shares-request.ts:27-45`); the API validates again with the shared schemas, and `selfMemberId` adds no input.
- ✅ F-SAST-15 Insecure error handling (CWE-209): the screens render catalog messages mapped from codes, never server text; a 404 shows one not-found state with no group data; the API presenters add no error path.
- ✅ F-SAST-16 Medium CVE in a dependency: none (no dependency changed).
- ✅ F-SAST-17 Unsafe function (CWE-95): no `eval`, `new Function` or string timers in the scope; the only `page.evaluate` is in the e2e support file and runs a static scroll-width comparison.
- ✅ F-SAST-18 Suppressions complete: no suppressions in this report; the scope has no `eslint-disable`, `@ts-ignore` or `@ts-expect-error`, and no `any`.
- ✅ F-SAST-19 Suppressions within review window: no suppressions in this report.

## Cross-cutting checks

- Open redirects and URL building: every `router.push` and `router.replace` in the scope targets a static path (`/sign-in`, `/groups`) or `/groups/` followed by `encodeURIComponent(groupId)` and a fixed suffix (`expense-form-container.tsx:176`, `group-detail-container.tsx:185`); every `Link href` is a static path or the same encoded form (`group-detail-container.tsx:199-217`, `expenses-empty-state.tsx:19`, `personal-shares-list.tsx:55`). The path is relative and prefixed, so it cannot leave the origin or become a `javascript:` URL, and an id with `/`, `?` or `#` stays inside one segment. This closes the L-1 pattern recorded for 05e on the new links.
- Money formatting: the search finds no `parseFloat` or `toFixed` in the scope. `Number(` appears once, in `percentage-input.ts:13`, on the digit-only capture groups of a percentage (at most 3 whole and 2 fraction digits), producing integer basis points; it never touches money and creates no fraction (I-1). `Math.trunc` in `default-split-request.ts:48` divides integer basis points for display only (I-2). `Number.parseInt` appears in `shares-request.ts` on date parts and in `api-client.ts:466` on a header (existing). Amounts stay `bigint` minor units through `parseAmountInput`, `allocateShares` and `formatMoney`, and the no-literal and no-float scan test (`group-expenses-no-hardcoded-strings.test.ts`) enforces it for the touched files.
- API presenter change (Block 0): `selfMemberId` is `caller.id` from the group access guard (`get-group.ts:28`, `get-expense-options.ts:34,42`) and is copied by the presenters (`group-presenter.ts:45`, `group-expense-presenter.ts:55`); it is the caller's own member id, already present in the member list of the same response; a non-member gets 404 before any field is built; no other user's id, email or account is added, and nothing is stored or logged. `group-self-member.test.ts` asserts it differs per caller.
- Admin and payer controls hidden, API authoritative: the default-split edit controls and the payer account fields are shown from `role` and `selfMemberId` as returned by the API (`default-split-container.tsx:65`, `expense-form-container.tsx:104,161`); a forged payer, account, category or default split is refused by the API with 400, 403 or 404 and shown as a catalog message. No permission is derived on the client.
- Double submit: the send control is disabled while the request is in flight (threat R-03), tested in `group-expense-form.test.tsx`.
- Information disclosure for 404: the list, form, default split and shares screens render one not-found state for a missing group, a group of someone else and a user who left; shares are caller-scoped by the API.
- Supply chain: no manifest or lockfile change, no new import source, no remote script, font or image in the scope.

## Threat model checklist (R-01 to R-06)

- R-01 client and server disagree on a split: mitigated by the shared split helpers and `allocateShares`, the property test over 1,000 random splits (`groups-split.property.test.ts`), and the server staying authoritative; its refusal is shown with the typed values kept.
- R-02 floating point corrupts money: mitigated by basis points and minor units only; reviewed above and enforced by the scan test.
- R-03 duplicate expense on double submit: mitigated by the in-flight disabled control, tested.
- R-04 a member edits the default split by forging a request: the API answers 403 and the screen shows it; the controls are hidden for non-admins as a convenience only.
- R-05 a screen leaks the existence of a group or another user's shares: one not-found state for every 404; shares come from a caller-scoped endpoint.
- R-06 a hardcoded string or one-language screen ships: every string goes through `useTranslations`; the no-literal scan and the catalog parity test cover it. Not a security control beyond the code-to-key mapping.

## Low and informational findings (W-SAST-01)

| ID | Severity | Location | Finding | Disposition |
|---|---|---|---|---|
| I-1 | Info (CWE-190) | `apps/web/src/features/groups/split/percentage-input.ts:13` | `Number(whole) * 100 + Number(fraction...)` converts digit-only strings with the `Number` constructor | Not money and no float: the pattern admits at most 3 whole and 2 fraction digits, so both operands are small integers and the result is checked against 10000 basis points; documented because the no-float scan targets `Number(` on money and this is the one allowed use |
| I-2 | Info (CWE-682) | `apps/web/src/features/groups/default-split/default-split-request.ts:48` | `Math.trunc(basisPoints / 100)` divides integers with `/` | Display only: the input is an integer from 0 to 10000, the quotient is truncated, and the remainder is taken with `%`; nothing is sent from this value |
| I-3 | Info (CWE-20) | `packages/shared/src/groups/group.ts` and `expense.ts` | `selfMemberId` (like the other ids of the responses) is `z.string()` with no shape check | Not exploitable: the API issues UUIDs, the id is used only to compare with member ids and never goes into a URL or the DOM; every path built from an id in this scope is encoded |

## Summary

Total: 19 categories clean, 0 vulnerabilities open (0 critical, 0 high, 0 medium, 0 low); 3 Info documented, none blocking.

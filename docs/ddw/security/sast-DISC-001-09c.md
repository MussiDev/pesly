# SAST report DISC-001-09c: Dashboard Screen and Theme

| Field | Value |
|---|---|
| Ticket | DISC-001-09c |
| Tier | FEATURE |
| Date | 2026-10-12 |
| Scope | `apps/web/src/features/dashboard/**` (attention, chart, components, containers, contract, `dashboard-view.ts`, `format.ts`), `apps/web/src/lib/dashboard-contract.ts`, the theme code (`apps/web/src/lib/theme.ts`, `components/theme-provider.tsx`, `components/theme-toggle.tsx`), the pre-paint script and its rendering in `apps/web/src/app/[locale]/layout.tsx`, the shell navigation and `features/shell/use-sign-out.ts`, the `getDashboard` and `getNetWorthSeries` calls of `apps/web/src/lib/api-client.ts`, and `apps/web/e2e/support/dashboard*.ts` (read only for secrets). No API code is in scope. Tests are read only for what they assert. No dependency added. |
| Method | Manual review by one reader (no semgrep or other SAST scanner is installed in this environment) against catalog §4: targeted searches over the scope (`dangerouslySetInnerHTML`, `innerHTML`, `document.*`, `eval`, `new Function`, `console`, `localStorage`, `sessionStorage`, `window.open`, `window.location`, `href=`, every `router.push` and `router.replace`, `parseFloat`, `toFixed`, `Number(`, `Math.`, `JSON.parse`, `setTimeout`, `Object.assign`, `__proto__`, `eslint-disable`, `@ts-ignore`, `any`, `process.env`, secret patterns), a full read of `dashboard-adapter.ts`, `dashboard-container.tsx`, `dashboard-session-cache.ts`, `dashboard-view.ts`, `attention-items.ts`, `dashboard-contract.ts`, `theme.ts`, `theme-provider.tsx`, `theme-toggle.tsx`, `use-sign-out.ts`, `content-security-policy.ts` and the layout; the threat model (`threat-DISC-001-09c.md`) as checklist |
| Result | PASSED - 0 Critical, 0 High, 0 Medium, 1 Low open; 4 Info documented below |

## Findings by rule

- ✅ F-SAST-01 Hardcoded secrets (CWE-798): the secret-pattern search finds no key, password, token or connection string in the dashboard code, the theme code or `e2e/support/dashboard*.ts`; the client holds no credential and the session is an HttpOnly cookie. The only stored keys are `pesly-theme` (a theme name) and the existing `pesly.session` pointer (user id and a flag).
- ✅ F-SAST-02 SQL injection (CWE-89): not applicable; the scope is browser code and builds no SQL; the two dashboard calls send no query and no user text.
- ✅ F-SAST-03 OS command injection (CWE-78): no `child_process`, `exec` or `spawn` in the scope.
- ✅ F-SAST-04 Insecure deserialization (CWE-502): `getDashboard` parses its answer with `dashboardResponseSchema` and `getNetWorthSeries` with the shared `netWorthResponseSchema` (`api-client.ts:1302-1314`); every amount is `exactIntegerStringSchema`, ids are `z.uuid()`, dates an anchored `YYYY-MM-DD` regex, currencies and budget status are enums, so `BigInt(text)` in the adapter cannot throw; a mismatch is the generic failure. The only `JSON.parse` in scope is the existing `readSessionPointer`, which re-validates with a Zod schema inside a try/catch. The theme value read from `localStorage` goes through `parseTheme`, which accepts only the two exact literals. No `Object.assign`, `__proto__` or dynamic key write from server data.
- ✅ F-SAST-05 Path traversal (CWE-22): no file access; the dashboard and series paths are constants; the only path built from API data is `/budgets/${budget.id}` and `/cards|/recurring/${entry.id}` in the adapter, where the id is a `z.uuid()` (see cross-cutting checks).
- ✅ F-SAST-06 XSS (CWE-79): no `dangerouslySetInnerHTML` in the dashboard, theme components or shell; the single use is `layout.tsx:55` and it renders the constant `THEME_SCRIPT` (I-1). Budget names, category names, entry names and amounts are React text children or ICU arguments; the only `style` values are `width: N%` where N is clamped by `Math.min(100, Math.max(0, n))` (`budgets-card.tsx:74`, `categories-card.tsx:48`), so no server string reaches CSS.
- ✅ F-SAST-07 SSRF (CWE-918): browser code; the only outbound target is the configured API base URL through `request`.
- ✅ F-SAST-08 Broken cryptography (CWE-327): no cryptography added; no `Math.random`, MD5 or SHA-1 in the scope.
- ✅ F-SAST-09 Debug mode in production (CWE-489): no `console` call, debug flag or `NODE_ENV` branch in the scope (the CSP helper's `isDev` is an input of the existing `proxy.ts`).
- ✅ F-SAST-10 Logging sensitive data (CWE-532): no `console` call, analytics or error reporter in the scope; figures and ids are never logged.
- ✅ F-SAST-11 Unrestricted upload (CWE-434): no upload surface.
- ✅ F-SAST-12 Missing CSRF protection (CWE-352): the dashboard is read only (two GETs through the existing `request`); no state-changing call is added; the theme toggle is local.
- ✅ F-SAST-13 Critical/High CVE in a dependency: no `package.json` or `pnpm-lock.yaml` change; the screens import React, next-intl, lucide-react, zod and `@pesly/shared`; the audit is re-run by the release gate.
- ✅ F-SAST-14 Incomplete input validation (CWE-20): the dashboard has no user input; every server value is validated by `dashboardResponseSchema` before the adapter reads it; the stored theme is validated by `parseTheme`; the session pointer by its Zod schema.
- ✅ F-SAST-15 Insecure error handling (CWE-209): the container maps a failure to catalog states (`states.error`, `states.offline`, `states.outOfDate`) and never renders server text; `UNAUTHENTICATED` redirects to `/sign-in` (`dashboard-container.tsx:62,114`).
- ✅ F-SAST-16 Medium CVE in a dependency: none (no dependency changed).
- ✅ F-SAST-17 Unsafe function (CWE-95): no `eval`, `new Function` or string timers in the scope; the pre-paint script is a constant string run by the browser as a script element, not through `eval`.
- ✅ F-SAST-18 Suppressions complete: the scope has no `eslint-disable`, `@ts-ignore` or `@ts-expect-error`, and no `any`.
- ✅ F-SAST-19 Suppressions within review window: no suppressions in this report.

## Cross-cutting checks

- Open redirect and URL building: every `router.replace` in the scope targets the static `/sign-in`. Every `Link href` is a static path (`/budgets/new`, `/accounts/new`, `/movements/new`, the `QUEUE_LINKS` and nav constants) or comes from `dashboard-adapter.ts`, which builds it as a fixed prefix (`/budgets/`, `/cards`, `/recurring`) plus an id typed `z.uuid()` by `dashboardResponseSchema`. The prefix is chosen by `entry.kind.includes(...)`, so the free-text `kind` selects between two fixed prefixes and never enters the URL. The links are relative, rendered by the i18n `Link`, so they cannot leave the origin or become `javascript:`; a hostile id fails parsing and the whole dashboard shows the generic error. The unencoded interpolation is I-2.
- In-memory cache and cross-user leakage: `dashboard-session-cache.ts` is a module `Map` keyed by user id; `recallDashboard(userId)` returns only that key, with no fallback, and is used only when the dashboard call fails with `NETWORK` while the device is offline (`dashboard-container.tsx:67-80`). The user id comes from the validated session pointer. The cache is never written to `localStorage`, `sessionStorage` or IndexedDB. A second user signing in on the same tab cannot read the first user's entry. It is NOT cleared on sign-out: `clearDashboardMemory` is exported but has no caller (L-1).
- Theme storage: `localStorage` holds only `pesly-theme` with `light` or `dark` (`system` removes the key). Reads and writes are in try/catch; any other value (tampered, legacy `system`) parses to `null`; the value only toggles a CSS class and reaches no URL, HTML or request.
- CSP and the inline theme script: `THEME_SCRIPT` is a constant string (`theme.ts:30`) with no interpolation, rendered by `layout.tsx` only when a nonce exists and with that per-request nonce (`nonce={nonce}`); the CSP (`content-security-policy.ts`) uses `script-src 'self' 'nonce-...' 'strict-dynamic'` with no `unsafe-inline` for scripts, so the script is allowed by nonce and no CSP relaxation was needed. Without a nonce the script is simply not rendered (the provider still applies the class after hydration). The nonce is never reflected into the script body.
- Money: no `parseFloat`, `toFixed` or `Number(` on amounts in the scope. All amounts are `bigint` minor units via `BigInt(string)` in the adapter and `formatMoney` for display. `Math` appears only on integer percentages and chart coordinates (`chart-geometry.ts`, `budgets-card.tsx:74`, `categories-card.tsx:48`, `format.ts:20`, `insight-card.tsx:22`), never on an amount (I-3, I-4).
- Stale responses: the loading effect uses an `active` flag in its cleanup, so an answer for a previous attempt or locale cannot overwrite the current state.
- Data at rest: financial data lives in React state and the session `Map` only; Server Components and Server Actions are not used for it.
- Supply chain: no manifest or lockfile change, no remote script, font or image added in the scope.

## Threat model checklist (threat-DISC-001-09c)

- Another user's figures shown after a user switch: the cache is keyed by user id with no fallback, and the API scopes every query to the owner. Mitigated for display; retention after sign-out is L-1.
- Script injection through names or labels: all rendered as text; no HTML sink fed by server data (F-SAST-06). Mitigated.
- A crafted id or kind builds a malicious link: ids are UUID-typed, the prefix is one of two constants (cross-cutting checks). Mitigated.
- Tampered `pesly-theme` value: parsed to the two known values or ignored. Mitigated.
- Inline script breaks the CSP or invites injection: constant string, nonce, no `unsafe-inline` (cross-cutting checks). Mitigated.
- Floating point on money: none (cross-cutting checks). Mitigated.
- An error leaks server details: only catalog keys are rendered (F-SAST-15). Mitigated.

## Low and informational findings (W-SAST-01)

| ID | Severity | Location | Finding | Disposition |
|---|---|---|---|---|
| L-1 | Low (CWE-212) | `apps/web/src/features/dashboard/containers/dashboard-session-cache.ts:22` and `apps/web/src/features/shell/use-sign-out.ts:30-31` | `clearDashboardMemory()` is never called: `useSignOut` wipes the device copy (`wipeLocalData`) but leaves the dashboard `Map` populated, and the expired-session redirects at `dashboard-container.tsx:62,114` do not clear it either. After sign-out the previous user's net worth, month figures, budget and category names stay in tab memory until a full page reload (the sign-in navigation is client side) | Open. Not reachable by another user (entries are keyed by user id and the session pointer is cleared by the wipe, so no recall happens), but it contradicts the sign-out intent that the device keeps nothing. Fix: call `clearDashboardMemory()` in `useSignOut.signOut` after `wipeLocalData` (and on the `UNAUTHENTICATED` redirect), with a test |
| I-1 | Info (CWE-79) | `apps/web/src/app/[locale]/layout.tsx:55` | `dangerouslySetInnerHTML` renders `THEME_SCRIPT` | Not exploitable: the value is a module constant with no variable part, enforced by the comment in `theme.ts` and covered by a test; the script carries the CSP nonce |
| I-2 | Info (CWE-79) | `apps/web/src/features/dashboard/contract/dashboard-adapter.ts:35,86` | `entryHref` and the budget href interpolate the id without `encodeURIComponent` | Not exploitable: `dashboardResponseSchema` types every id as `z.uuid()`, so no `/`, `?`, `&` or `#` can pass; the links are relative and prefixed by the i18n `Link` |
| I-3 | Info (CWE-682) | `apps/web/src/features/dashboard/components/budgets-card.tsx:74`, `categories-card.tsx:48` | `Math.min(100, Math.max(0, n))` on a server percentage | Display only: the input is a whole number the API computed, used for a bar width; no amount is derived from it |
| I-4 | Info (CWE-682) | `apps/web/src/features/dashboard/chart/chart-geometry.ts:34-63` | `Math.floor` and `Math.round` on chart coordinates | Display only: the scaling works on integer points in a fixed 0..1000 space for the SVG; the amounts shown stay `bigint` |

## Summary

Total: 19 categories clean, 1 vulnerability open (0 critical, 0 high, 0 medium, 1 low); 4 Info documented, none blocking.

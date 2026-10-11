# Threat model DISC-001-05g: Balances and Settlements Screens

| Field | Value |
|-------|-------|
| Ticket | DISC-001-05g |
| Spec | docs/ddw/specs/spec-DISC-001-05g.md |
| Tier | FEATURE |
| Date | 2026-10-11 |

## Components
| Component | Source in the spec |
|---|---|
| `apps/web/src/lib/api-client.ts` | Block 1 |
| `apps/web/src/features/groups/settlements/settlement-request.ts` | Block 2 |
| `apps/web/src/features/groups/balances/group-balances-container.tsx` | Block 3 |
| `apps/web/src/features/groups/settlement-form/settlement-form-container.tsx` | Block 4 |
| `apps/web/src/features/groups/consolidation/consolidation-container.tsx` | Block 5 |
| `apps/web/src/features/groups/settlements-history/settlements-history-container.tsx` | Block 6 |
| `apps/web/src/features/groups/containers/group-detail-container.tsx` | Block 7 |

## Trust boundaries
- Browser → API: the screens call existing settlement, balance and account routes with the session cookie
  and the `X-Requested-With` header; the API's validation, group-membership guard, active-member checks and
  stale-leg check stay authoritative. The client is not trusted for any money value.
- User input → money values: typed amounts, dates and rates become minor units and a rate scaled by
  10,000 on the client; the API re-validates every one, so a tampered request is refused or recorded as
  the caller's own legitimate request, never as another user's.
- Group data → other members: the screens show names, balances and settlements of members of the same
  group only; a group the caller is not in answers 404 and is rendered as not found.
- Route and URL → client state: the group id in the path and the cursor of the history are the only
  external values the pages read; the single-form prefill never travels in the URL.

## STRIDE analysis
### `apps/web/src/lib/api-client.ts`
- **Spoofing:** the caller identity is the session cookie; no user, member or role id is ever sent as a
  claim of who is calling, and the member ids in a body are the parties of the payment, validated by the API
  as active members of the group.
- **Tampering:** every response is parsed with the shared schemas, so a modified or malformed body becomes a
  generic failure and never partial data; request bodies and the preview query are checked against the shared
  request schemas before sending, and the group id goes through `resourcePath`. A client-side change of an
  amount is not a threat to others because the API validates the amount, the parties, the account and the
  legs again.
- **Repudiation:** not applicable on the client; the API records the settlement creator and an activity row
  for every recorded settlement.
- **Information Disclosure:** failures expose only message keys, never API text; amounts, legs, rates and
  member ids are not written to the console or any client log; the cursor is opaque and is not logged.
- **Denial of Service:** one request per user action; no polling or retry loop is added; a 401 triggers the
  existing single serialized refresh, and a 429 is shown as received.
- **Elevation of Privilege:** the client never decides permissions; a 400, 404 or 409 is displayed as
  received, and a forged `accountId` or party is refused by the API.

### `apps/web/src/features/groups/settlements/settlement-request.ts`
- **Spoofing:** not applicable; the module is pure and holds no identity beyond the caller's member id read
  from the loaded group.
- **Tampering:** a body with field errors is never built; amounts and rates go through the shared parsers
  and `bigint`, with a property test over 1,000 random amounts that the string sent equals the value typed;
  the consolidated legs are copied from the preview, never typed; a wrong value that slips through is
  refused by the API, which compares the legs with the current ones.
- **Repudiation:** not applicable.
- **Information Disclosure:** not applicable; no I/O.
- **Denial of Service:** work is linear in the member count, at most 50, and in the length of one typed
  text, which the parsers bound.
- **Elevation of Privilege:** the account id is added to the body only when the caller is a party; the API
  checks it as well and answers `GROUP_SETTLEMENT_ACCOUNT_INVALID` for another user's account.

### `apps/web/src/features/groups/balances/group-balances-container.tsx`
- **Spoofing:** not applicable below the session; the group id comes from the route and is a claim the
  API checks.
- **Tampering:** the page is read-only data plus the form panel; balances are shown as received and never
  recomputed or summed across currencies.
- **Repudiation:** not applicable; the page only reads.
- **Information Disclosure:** a non-member gets 404 and the screen shows the not-found state with no hint
  that the group exists (insecure direct object reference by editing the group id in the URL is answered
  404 by the API, never 403); the page shows only the names and balances of the group's own members and
  former members.
- **Denial of Service:** at most 2 requests on load, asserted by a test, and 1 on each reload after a
  recorded payment.
- **Elevation of Privilege:** not applicable; any member may see balances and record payments by design
  (PRD 05), and the screen offers nothing beyond what the API allows.

### `apps/web/src/features/groups/settlement-form/settlement-form-container.tsx`
- **Spoofing:** the account field is shown only when the caller is a party, using the member id from the
  loaded group; the API checks that the account belongs to the caller and is open, in the right currency.
- **Tampering:** a double submit could record the payment twice; the submit control is disabled while a
  request is in flight and a second submit is ignored. The wrong direction of a payment is reduced by the
  prefill from a suggested payment and by the sentence "A pays B amount" shown before sending.
- **Repudiation:** the API records who created the settlement and logs an activity row; the form adds no
  local record.
- **Information Disclosure:** the form loads the caller's own accounts only, and only when the caller is a
  party; account names are rendered as text and never sent anywhere else; server refusals are shown by key.
- **Denial of Service:** at most one account request per opening of the form and one request per submit.
- **Elevation of Privilege:** a forged party, account id or currency is refused by the API with 400 or 404;
  the screen shows the refusal and keeps the typed values.

### `apps/web/src/features/groups/consolidation/consolidation-container.tsx`
- **Spoofing:** not applicable below the session; the two members are chosen from the loaded group and
  checked by the API as active.
- **Tampering:** the manual rate is user input that sets how much money changes hands, so it is parsed to a
  scaled integer, must be greater than 0 and within the shared maximum, and is shown next to the cash it
  produces before confirming; the API re-validates it and rejects a cash above the maximum. A stale preview
  is refused with 409 because the legs sent must equal the current ones; the screen reloads the preview and
  asks to confirm again, and never retries on its own.
- **Repudiation:** the API stores the rate, whether it was manual or automatic, and the rate type on the
  settlement and logs an activity row, so a disputed rate stays attributable.
- **Information Disclosure:** the preview exposes only the legs between two members of the same group and
  the group's rate type; late answers of an earlier choice are ignored so one pair's legs are never shown
  under another's names.
- **Denial of Service:** one preview per valid choice of pair and currency, with no polling; the choice
  controls do not fire a request while invalid.
- **Elevation of Privilege:** any member may consolidate any two active members by design; a non-member gets
  404, and a forged leg or rate is refused by the API.

### `apps/web/src/features/groups/settlements-history/settlements-history-container.tsx`
- **Spoofing:** not applicable below the session.
- **Tampering:** the list is read-only data; the cursor comes only from the previous response and is
  never built from user text, and rows are deduplicated by id.
- **Repudiation:** not applicable; the page only reads.
- **Information Disclosure:** a non-member gets 404 and the not-found state; rows show only the group's own
  members, amounts and dates; a former member is named from `formerMembers`.
- **Denial of Service:** at most 2 requests on load and 50 rows per page; "load more" is one request per
  click and keeps the loaded rows if it fails.
- **Elevation of Privilege:** not applicable; rows are read-only and edit and delete belong to 05h.

### `apps/web/src/features/groups/containers/group-detail-container.tsx`
- **Spoofing:** the caller's member id comes from the group detail answer, not from a client claim.
- **Tampering:** the own balance is shown as received from the balances route and never computed locally.
- **Repudiation:** not applicable; the change is a link and a read-only summary.
- **Information Disclosure:** the summary shows only the caller's own balance; a balances failure shows a
  short message and never raw API text.
- **Denial of Service:** one additional request on load, keeping the detail within 2 requests.
- **Elevation of Privilege:** not applicable; the new link grants nothing the API does not check.

## Data classification
| Data | Class | At rest | In transit |
|---|---|---|---|
| Settlement amounts, legs, rates, dates and balances | financial | PostgreSQL, managed encryption at rest; nothing is stored in the browser | HTTPS only |
| Member display names and group membership | PII | PostgreSQL, managed encryption at rest | HTTPS only |
| Settlement account id (the caller's own account) and account names | financial | PostgreSQL, managed encryption at rest | HTTPS only |
| Session cookie that authorises every call | credentials | HttpOnly cookie, never readable by page code | HTTPS only, sent with `credentials: include` |

## Risks and mitigations
| ID | Risk | STRIDE | Likelihood | Impact | Mitigation |
|---|---|---|---|---|---|
| R-01 | A user edits the group id in the URL to read another group's balances or settlements (IDOR) | I | Medium | High | The API scopes every query by membership and answers 404, never 403; the screens render the same not-found state with no hint (Blocks 3, 5, 6) |
| R-02 | A stale consolidation preview is recorded after the debts moved, clearing the wrong amounts | T | Medium | High | The request carries the preview legs, the API answers 409 when they differ, and the screen reloads the preview, keeps the choice and requires a new confirmation without auto-retry (Block 5) |
| R-03 | A wrong or abusive manual rate changes how much money changes hands in a consolidation | T | Medium | High | The rate is parsed to a positive scaled integer within the shared maximum, the cash it produces is shown before confirming, the API re-validates it and stores it as manual with the actor, and the API refuses a cash above the maximum (Blocks 2, 5) |
| R-04 | Floating point corrupts an amount or a rate while typing | T | Medium | High | Minor units and scaled integers only, shared parsers, a 1,000-amount property test and a scan for `parseFloat`, `toFixed` and `Number(` (Blocks 1, 2, 8) |
| R-05 | A double submit records a payment or a consolidation twice | T | Medium | Medium | The submit control is disabled while a request is in flight and a second submit is ignored; a repeated consolidation is also refused by the API as stale (Blocks 4, 5) |
| R-06 | A payment is recorded in the wrong direction | T | Medium | Medium | Suggested payments prefill both parties, and the form states "A pays B amount" in words before sending (Block 4) |
| R-07 | A forged account id charges money against another user's account | E | Low | High | The account field renders only for a party and lists only the caller's own accounts; the API checks ownership, currency and state and answers 400 (Blocks 2, 4) |
| R-08 | Amounts, legs or names leak through logs, URLs or browser history | I | Low | Medium | The prefill lives in component state, not in the URL; the client logs nothing about money; errors are shown as message keys; no new storage is used (Blocks 1, 4) |
| R-09 | A late answer for an earlier choice is shown under another pair's names | T | Medium | Medium | The container ignores answers of superseded requests and keeps the latest choice only (Block 5) |
| R-10 | A hardcoded string or a one-language screen ships | T | Medium | Low | Catalog parity test and the existing no-literal scan over `src/features/groups` (Block 8) |

## Supply chain
No new runtime dependency (spec D11); the screens use React, next-intl, the existing design system
components, the shared package and the existing api-client. No external service is called from these
screens: rates come from the API's stored values, never from dolarapi.com in the request path.

## Availability
The screens add no polling, background work or retry loop. Load budgets are asserted by tests: 2 requests
for the balances page, 2 for the history, 1 for the consolidation page plus one per choice, and one
additional request on the group detail. A page of history is at most 50 rows. A failed request leaves the
screen on its error state with a manual retry, so a degraded API causes no request storm from the client.
The screens are online only and fail visibly when offline.

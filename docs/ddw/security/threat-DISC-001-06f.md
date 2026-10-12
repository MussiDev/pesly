# Threat model DISC-001-06f: Budgets Screens

| Field | Value |
|-------|-------|
| Ticket | DISC-001-06f |
| Spec | docs/ddw/specs/spec-DISC-001-06f.md |
| Tier | FEATURE |
| Date | 2026-10-11 |

## Components
| Component | Source in the spec |
|---|---|
| `apps/web/src/lib/api-client.ts` | Block 0 |
| `apps/web/src/features/budgets/helpers/budget-request.ts` | Block 1 |
| `apps/web/src/features/budgets/helpers/budget-thresholds.ts` | Block 1 |
| `apps/web/src/features/budgets/helpers/budget-month.ts` | Block 1 |
| `apps/web/src/features/budgets/helpers/budget-failure.ts` | Block 1 |
| `apps/web/src/features/budgets/list/budgets-container.tsx` | Block 2 |
| `apps/web/src/features/budgets/detail/budget-detail-container.tsx` | Block 3 |
| `apps/web/src/features/budgets/form/create-budget-container.tsx` | Block 4 |
| `apps/web/src/features/budgets/form/edit-budget-container.tsx` | Block 4 |
| `apps/web/src/features/budgets/delete/budget-delete-action.tsx` | Block 5 |
| `apps/web/src/app/[locale]/(app)/budgets/[id]/page.tsx` | Block 5 |
| `apps/web/src/features/notices/components/notice-list.tsx` | Block 6 |

## Trust boundaries
- Browser → API: the screens call the existing budget routes with the session cookie; the API's
  validation, owner scoping and 404 answers stay authoritative. No endpoint, migration or dependency is
  added.
- User input → money and thresholds: typed amounts become minor-unit strings through the money input
  helpers and thresholds are whole numbers from 1 to 200; the server validates both again with the shared
  schemas.
- URL → budget id and month: the budget id in the route and the month in the query are untrusted input;
  they are only passed to the API, which scopes every budget query by owner and bounds the month.
- Stored text → DOM: budget names, category names and server messages come from the database and the API
  and are rendered as text.

## STRIDE analysis
### `apps/web/src/lib/api-client.ts`
- **Spoofing:** the caller identity is the session cookie; no user id is ever sent from the client.
- **Tampering:** every budget and spending response is parsed with the shared validators, so a modified or
  malformed body becomes a generic failure and never partial data. State changing calls (`createBudget`,
  `updateBudget`, `deleteBudget`) go through the existing client, which keeps the credentialed same-site
  cookie policy and its CSRF protection; no token is read or stored by the budgets code.
- **Repudiation:** not applicable on the client; the server owns the budget and its versions.
- **Information Disclosure:** failures expose only catalog message keys, never raw server text, stack
  traces or ids; amounts and budget names are never logged by the client.
- **Denial of Service:** one request per user action; no polling or retry loop is added.
- **Elevation of Privilege:** the client never decides permissions; a 404 is displayed as received.

### `apps/web/src/features/budgets/helpers/budget-request.ts`
- **Spoofing:** not applicable; the module is pure and holds no identity.
- **Tampering:** user text is parsed only with `parseAmountInput` into a bigint minor-unit string; an
  empty, zero, negative or non-numeric value never builds a request, and a value above the supported size
  is refused by the shared schema and then by the API. The name is trimmed and capped at 50 characters.
  The edit builder sends changed fields only, so an untouched field cannot overwrite a newer server value.
  No `parseFloat`, `toFixed` or `Number(` is applied to money (scan in the test suite).
- **Repudiation:** not applicable.
- **Information Disclosure:** not applicable; no I/O.
- **Denial of Service:** work is constant per input; category ids are bounded by the 100 offered categories.
- **Elevation of Privilege:** not applicable; the module sends no owner scope the API trusts, and the API
  checks that every category id is an expense category of the caller.

### `apps/web/src/features/budgets/helpers/budget-thresholds.ts`
- **Spoofing:** not applicable; the module is pure.
- **Tampering:** a threshold is accepted only after a digits-only test, in the range 1 to 200 and not
  already present, with at most 5 entries; negative, decimal, exponent or oversized input is rejected
  before any request, and the shared schema and the API enforce the same rules.
- **Repudiation:** not applicable.
- **Information Disclosure:** not applicable; no I/O.
- **Denial of Service:** the list is capped at 5 entries, so the work is constant.
- **Elevation of Privilege:** not applicable.

### `apps/web/src/features/budgets/helpers/budget-month.ts`
- **Spoofing:** not applicable; the module is pure.
- **Tampering:** the month is only stepped back from the month the API returned and never goes before
  1971-01; the screen never offers a future month, and a forged future month in the URL is refused by the
  API and shown by key.
- **Repudiation:** not applicable.
- **Information Disclosure:** not applicable; the client never reads the clock or the profile.
- **Denial of Service:** stepping is constant work and each step is one request.
- **Elevation of Privilege:** not applicable; the month is a read filter scoped by owner on the server.

### `apps/web/src/features/budgets/helpers/budget-failure.ts`
- **Spoofing:** not applicable; the module is pure.
- **Tampering:** a failure is mapped to a catalog key or to the not-found state; an unknown failure maps to
  a generic key, so a forged error body cannot inject text.
- **Repudiation:** not applicable.
- **Information Disclosure:** only catalog keys are returned; raw server messages, stack traces and ids
  are never passed to the UI.
- **Denial of Service:** not applicable; constant work.
- **Elevation of Privilege:** a 404 for a missing budget and for another user's budget map to the same
  not-found state.

### `apps/web/src/features/budgets/list/budgets-container.tsx`
- **Spoofing:** not applicable below the session.
- **Tampering:** spent, available, remaining, rollover and percentage are shown exactly as the API
  returned them and are never recomputed; the over-budget state is a sign test on the returned remaining
  amount, not arithmetic. Budget names and category data render as React text, never as raw HTML, so
  stored markup cannot execute.
- **Repudiation:** not applicable.
- **Information Disclosure:** the API returns only the caller's budgets; a failed request shows an error
  with retry, never an empty state that could hide data.
- **Denial of Service:** exactly 1 request per selected month, no polling; rapid month changes ignore the
  response of a superseded month, so a slow earlier answer cannot overwrite the month on screen.
- **Elevation of Privilege:** not applicable; the screen only links to the detail and create screens.

### `apps/web/src/features/budgets/detail/budget-detail-container.tsx`
- **Spoofing:** not applicable below the session.
- **Tampering:** a forged budget id or month in the URL is only passed to the API. The detail combines
  3 responses (budget, spending, categories); category names render as text, and a failure of any of them
  shows an error with retry instead of a half-filled screen. After an edit the screen loads from the API
  again, so spending is not left stale from before the edit.
- **Repudiation:** not applicable; read-only apart from the confirmed delete, which the server records.
- **Information Disclosure:** a budget id that does not exist, one owned by another user and one with no
  version in force in the month all answer 404 and render the same not-found state, with no hint of which
  case it was.
- **Denial of Service:** at most 3 requests on load and no polling.
- **Elevation of Privilege:** the delete control is a convenience; the API scopes every read and write by
  owner regardless of what the screen shows.

### `apps/web/src/features/budgets/form/create-budget-container.tsx`
- **Spoofing:** not applicable below the session.
- **Tampering:** a double submit could create 2 budgets; the save control is disabled while a request is
  in flight, and the screen leaves the form only on success. The form keeps every typed value when the API
  refuses the request.
- **Repudiation:** the server records the owner of the budget.
- **Information Disclosure:** the form loads only the caller's expense categories; the API still verifies
  each category id, so a forged id is refused and the message is shown by key.
- **Denial of Service:** at most 1 request on load (the categories) and exactly 1 per submit; the limit of
  50 budgets is enforced by the API.
- **Elevation of Privilege:** a forged category id or income category is refused by the API and the
  refusal is shown with the typed values kept.

### `apps/web/src/features/budgets/form/edit-budget-container.tsx`
- **Spoofing:** not applicable below the session.
- **Tampering:** the currency is read only and never sent; a forged currency change is ignored or refused
  by the API. Only changed fields are sent, the save is disabled with no change and while pending, and the
  figures shown afterwards are the ones the API returned. The form says the change applies from the current
  month, so past spending is not reinterpreted.
- **Repudiation:** the server records the new version of the budget.
- **Information Disclosure:** a budget that is not the caller's answers 404 and shows the not-found state.
- **Denial of Service:** 2 requests on load (the budget and the categories) and exactly 1 per save.
- **Elevation of Privilege:** the API scopes the update by owner, so a forged id changes nothing of
  another user.

### `apps/web/src/features/budgets/delete/budget-delete-action.tsx`
- **Spoofing:** not applicable below the session.
- **Tampering:** the delete needs an explicit confirmation and is sent once; the confirm control is
  disabled while the request is in flight, so a double tap cannot send 2 deletes. Cancelling sends nothing.
  A second delete of a budget already gone answers 404 and shows the not-found state.
- **Repudiation:** the server records the deletion.
- **Information Disclosure:** a budget that is not the caller's answers 404 and shows the not-found state.
- **Denial of Service:** one request per confirmed deletion.
- **Elevation of Privilege:** the API scopes the delete by owner, so a forged id deletes nothing of
  another user; the confirmation text states that past spending is not affected.

### `apps/web/src/app/[locale]/(app)/budgets/[id]/page.tsx`
- **Spoofing:** not applicable; the page is a thin server page behind the existing authenticated layout.
- **Tampering:** the route id and the month query are passed unchanged to the container and the API; they
  are never interpolated into markup, scripts or financial logic, and Server Components touch no financial
  data.
- **Repudiation:** not applicable.
- **Information Disclosure:** the page fetches no data on the server, so no budget data is rendered into
  the HTML shell; an unknown id renders the not-found state of the container.
- **Denial of Service:** the page adds no request of its own.
- **Elevation of Privilege:** not applicable; access control stays in the API, which answers 404 for
  budgets of other users.

### `apps/web/src/features/notices/components/notice-list.tsx`
- **Spoofing:** not applicable below the session.
- **Tampering:** for a `budget_alert` notice the caption shows the month formatted from the notice date
  with the locale formatter instead of "Due {date}"; every other kind keeps its current label.
- **Repudiation:** not applicable.
- **Information Disclosure:** the list shows the text the API produced and no amounts or budget names are
  added by the client; notice text renders as React text.
- **Denial of Service:** no request is added.
- **Elevation of Privilege:** the notice carries no budget id, so the list adds no navigation to a budget.

## Data classification
| Data | Class | At rest | In transit |
|---|---|---|---|
| Budget names, limit amounts and thresholds | financial | PostgreSQL, managed encryption at rest | HTTPS only |
| Budget spending, rollover and remaining amounts | financial | PostgreSQL, managed encryption at rest | HTTPS only |
| Covered category ids and names | financial | PostgreSQL, managed encryption at rest | HTTPS only |

## Risks and mitigations
| ID | Risk | STRIDE | Likelihood | Impact | Mitigation |
|---|---|---|---|---|---|
| R-01 | A user opens, edits or deletes another user's budget by guessing an id in the URL | I | Low | High | The API scopes every query by owner and answers 404 for both missing and foreign budgets; the screens render one not-found state (Blocks 3, 4, 5 tests) |
| R-02 | Floating point or an oversized number corrupts a typed amount or a displayed figure | T | Medium | High | Only `parseAmountInput` and minor-unit strings; figures shown as returned; sign test with bigint; shared schema bounds; scan for `parseFloat`, `toFixed` and `Number(` (Blocks 1, 7) |
| R-03 | A budget or category name with markup runs script in the page | T | Low | High | Names and messages render as React text; no `dangerouslySetInnerHTML`, verified by a scan (Blocks 2, 3, 6, 7) |
| R-04 | A double tap on save or delete creates 2 budgets or sends 2 deletes | T | Medium | Medium | Controls disabled while in flight and the form leaves only on success (Blocks 4, 5 tests); the API limit of 50 budgets bounds the damage and a second delete answers 404 |
| R-05 | A slow answer for an earlier month overwrites the month on screen, or the detail shows spending from before an edit | T | Medium | Medium | A superseded response is ignored; the detail and the list load from the API again after a save; no client cache (Blocks 2, 3 tests) |
| R-06 | A session cookie is abused for a forged state-changing request | E | Low | High | All writes go through the existing api-client with its CSRF protection and same-site cookie; no token handling is added (Block 0) |
| R-07 | An error message leaks server details or other users' data | I | Low | Medium | Only catalog keys are rendered; unknown failures show a generic message (Blocks 0, 1) |
| R-08 | Abusive thresholds, amounts or months (negative, decimal, over 200, more than 5, future month, before 1971) reach the API | T | Medium | Low | Client rules reject them before sending; the shared schemas and the API enforce the same bounds and refuse a future month with a message shown by key (Blocks 1, 2, 4 tests) |
| R-09 | The notices label change hides or misformats an alert, or breaks the other kinds | T | Low | Low | Only `budget_alert` changes; other kinds keep "Due {date}"; tests for both (Block 6) |
| R-10 | A hardcoded string or one-language screen ships | T | Medium | Low | Catalog parity and no-literal scan (Blocks 0, 7) |

## Supply chain
No new runtime dependency; the screens use React, the existing design system components, the shared
package and the existing api-client.

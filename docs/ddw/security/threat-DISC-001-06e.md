# Threat model DISC-001-06e: Goals Screens

| Field | Value |
|-------|-------|
| Ticket | DISC-001-06e |
| Spec | docs/ddw/specs/spec-DISC-001-06e.md |
| Tier | FEATURE |
| Date | 2026-10-11 |

## Components
| Component | Source in the spec |
|---|---|
| `apps/web/src/lib/api-client.ts` | Block 0 |
| `apps/web/src/features/goals/helpers/goal-request.ts` | Block 1 |
| `apps/web/src/features/goals/list/goals-container.tsx` | Block 3 |
| `apps/web/src/features/goals/detail/goal-detail-container.tsx` | Block 4 |
| `apps/web/src/features/goals/form/create-goal-container.tsx` | Block 5 |
| `apps/web/src/features/goals/entries/goal-entry-actions.tsx` | Block 6 |
| `apps/web/src/features/goals/delete/goal-delete-action.tsx` | Block 6 |

## Trust boundaries
- Browser → API: the screens call the existing goals routes with the session cookie; the API's
  validation, owner scoping and 404 answers stay authoritative. No endpoint is added.
- User input → money values: typed amounts become minor-unit strings through the money input helpers on
  the client, and the server validates them again with the shared schemas.
- URL → goal id: the goal id in the route is untrusted input; it is only passed to the API, which scopes
  every goal query by owner.
- Stored text → DOM: goal names and server messages come from the database and the API and are rendered
  as text.

## STRIDE analysis
### `apps/web/src/lib/api-client.ts`
- **Spoofing:** the caller identity is the session cookie; no user id is ever sent from the client.
- **Tampering:** every goal response is parsed with the shared validators, so a modified or malformed
  body becomes a generic failure and never partial data; request bodies are checked before sending. State
  changing calls go through the existing client, which keeps the credentialed same-site cookie policy and
  its CSRF protection; no token is read or stored by the goals code.
- **Repudiation:** not applicable on the client; the server owns the goal and its entries.
- **Information Disclosure:** failures expose only catalog message keys, never raw server text, stack
  traces or ids; amounts and goal names are never logged by the client.
- **Denial of Service:** one request per user action; no polling or retry loop is added.
- **Elevation of Privilege:** the client never decides permissions; a 404 or 403 is displayed as received.

### `apps/web/src/features/goals/helpers/goal-request.ts`
- **Spoofing:** not applicable; the module is pure and holds no identity.
- **Tampering:** user text is parsed only with `parseAmountInput` into a bigint minor-unit string; an
  empty, zero, negative or non-numeric value never builds a request, and a value above the supported size
  is refused by the shared schema and then by the API. No `parseFloat`, `toFixed` or `Number(` is applied
  to money (scan in the test suite).
- **Repudiation:** not applicable.
- **Information Disclosure:** not applicable; no I/O.
- **Denial of Service:** work is constant per input; the name length is capped at 80 characters before
  sending.
- **Elevation of Privilege:** not applicable; the module sends no owner scope the API trusts, and the API
  checks that a linked account belongs to the caller.

### `apps/web/src/features/goals/list/goals-container.tsx`
- **Spoofing:** not applicable below the session.
- **Tampering:** the list is read-only data; progress, percentage and monthly amount are shown exactly as
  the API returned them and are never recomputed.
- **Repudiation:** not applicable.
- **Information Disclosure:** the API returns only the caller's goals; a failed request shows an error
  with retry, never an empty state that could hide data.
- **Denial of Service:** exactly 1 request on load, no polling.
- **Elevation of Privilege:** not applicable; the screen only links to the detail and create forms.

### `apps/web/src/features/goals/detail/goal-detail-container.tsx`
- **Spoofing:** not applicable below the session.
- **Tampering:** a forged goal id in the URL is only passed to the API; the entries limit comes from the
  client but is bounded to 100 by the shared query schema and by the API.
- **Repudiation:** not applicable; read-only apart from the confirmed delete, which the server records.
- **Information Disclosure:** a goal id that does not exist and one owned by another user both answer 404
  and render the same not-found state, with no hint of which case it was. Goal names render as React
  text, never as raw HTML, so stored markup cannot execute.
- **Denial of Service:** the load-more control grows the limit step by step to at most 100 and then
  disappears; each click is one request, and the control is disabled while a request is in flight, so the
  amplification is bounded to a few requests of at most 100 rows each.
- **Elevation of Privilege:** hiding the entry forms for a linked goal is a convenience only; a forged
  entry on a linked goal is refused by the API and the refusal is shown. Deleting needs a confirmation,
  but the API scopes it by owner regardless.

### `apps/web/src/features/goals/form/create-goal-container.tsx`
- **Spoofing:** not applicable below the session.
- **Tampering:** a double submit could create 2 goals; the send control is disabled while a request is in
  flight. Currency and account are not editable on edit, and a forged change is ignored or refused by the
  API.
- **Repudiation:** the server records the owner of the goal.
- **Information Disclosure:** the form loads only the caller's active accounts in the chosen currency; the
  API still verifies the account belongs to the caller, so a forged account id is refused and the message
  is shown by key.
- **Denial of Service:** at most 1 request on load (the account list, only when a link is chosen) and
  one per submit; the 100-goal limit is enforced by the API.
- **Elevation of Privilege:** a forged account or goal id is refused by the API; the screen shows the
  refusal and keeps the typed values.

### `apps/web/src/features/goals/entries/goal-entry-actions.tsx`
- **Spoofing:** not applicable below the session.
- **Tampering:** a double tap could record an entry twice and the API has no idempotency key for goal
  entries; the submit control is disabled while the request is pending and the form clears only on
  success. A retry after a lost response can still duplicate an entry (accepted, see R-03). Progress is
  taken from the response, never summed on the client.
- **Repudiation:** the server records each entry with its kind, amount and date.
- **Information Disclosure:** failures show catalog keys only; the entered amount stays in the form and
  is never logged.
- **Denial of Service:** exactly one request per recorded entry.
- **Elevation of Privilege:** a withdrawal larger than the progress is refused by the API (the overdraw
  check on the server is authoritative), and the client never relies on its own balance check; a forged
  entry on a goal linked to an account is refused by the API.

### `apps/web/src/features/goals/delete/goal-delete-action.tsx`
- **Spoofing:** not applicable below the session.
- **Tampering:** the delete needs an explicit confirmation and is sent once; the control is disabled while
  the request is in flight; cancelling sends nothing.
- **Repudiation:** the server records the deletion.
- **Information Disclosure:** a goal that is not the caller's answers 404 and shows the not-found state.
- **Denial of Service:** one request per confirmed deletion.
- **Elevation of Privilege:** the API scopes the delete by owner, so a forged id deletes nothing of another
  user.

## Data classification
| Data | Class | At rest | In transit |
|---|---|---|---|
| Goal names, target amounts and progress | financial | PostgreSQL, managed encryption at rest | HTTPS only |
| Goal entries (kind, amount, date) | financial | PostgreSQL, managed encryption at rest | HTTPS only |
| Linked account ids | financial | PostgreSQL, managed encryption at rest | HTTPS only |

## Risks and mitigations
| ID | Risk | STRIDE | Likelihood | Impact | Mitigation |
|---|---|---|---|---|---|
| R-01 | A user opens another user's goal by guessing an id in the URL | I | Low | High | The API scopes every query by owner and answers 404 for both missing and foreign goals; the screen renders one not-found state (Block 4 test) |
| R-02 | Floating point or an oversized number corrupts a typed amount | T | Medium | High | Only `parseAmountInput` and minor-unit strings; shared schema bounds; scan for `parseFloat`, `toFixed` and `Number(` (Blocks 1, 7) |
| R-03 | A double tap or a retry after a lost response records an entry twice | T | Medium | Medium | Send disabled while in flight (Block 6 test). The API has no idempotency key, so a retry after a lost response can duplicate an entry. Accepted by the owner: the user sees the history and progress and can offset it with an opposite entry; an idempotency key needs an API change outside this ticket |
| R-04 | A withdrawal drives progress below zero | T | Low | Medium | The API refuses a withdrawal larger than the progress and the screen shows the refusal, keeping the amount (Block 6 test) |
| R-05 | A goal name with markup runs script in the page | T | Low | High | Names and messages render as React text; no `dangerouslySetInnerHTML`, verified by a scan (Blocks 3, 4) |
| R-06 | A session cookie is abused for a forged state-changing request | E | Low | High | All writes go through the existing api-client with its CSRF protection and same-site cookie; no token handling is added (Block 0) |
| R-07 | An error message leaks server details or other users' data | I | Low | Medium | Only catalog keys are rendered; unknown failures show a generic message (Block 0) |
| R-08 | Load more is used to hammer the entries endpoint | D | Low | Low | Limit grows to at most 100, then the control disappears; disabled while in flight; the API caps the limit at 100 (Block 4) |
| R-09 | A hardcoded string or one-language screen ships | T | Medium | Low | Catalog parity and no-literal scan (Block 7) |

## Supply chain
No new runtime dependency; the screens use React, the existing design system components, the shared
package and the existing api-client.

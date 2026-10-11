# Threat model DISC-001-05f: Group Expenses Screens

| Field | Value |
|-------|-------|
| Ticket | DISC-001-05f |
| Spec | docs/ddw/specs/spec-DISC-001-05f.md |
| Tier | FEATURE |
| Date | 2026-10-11 |

## Components
| Component | Source in the spec |
|---|---|
| `apps/web/src/lib/api-client.ts` | Block 1 |
| `apps/web/src/features/groups/split/split-request.ts` | Block 2 |
| `apps/web/src/features/groups/expenses/list/group-expenses-container.tsx` | Block 3 |
| `apps/web/src/features/groups/expenses/form/expense-form-container.tsx` | Block 4 |
| `apps/web/src/features/groups/default-split/default-split-container.tsx` | Block 5 |
| `apps/web/src/features/groups/shares/personal-shares-container.tsx` | Block 6 |

## Trust boundaries
- Browser → API: the screens call existing expense routes with the session cookie; the API's
  validation, group access guard and role checks stay authoritative.
- User input → money values: typed amounts and percentages become minor units and basis points on the
  client, and the server re-validates them.
- Group data → other members: the screens show names and amounts of members of the same group only; the
  personal shares page shows only the caller's own shares.

## STRIDE analysis
### `apps/web/src/lib/api-client.ts`
- **Spoofing:** the caller identity is the session cookie; no user id is ever sent from the client.
- **Tampering:** every response is parsed with the shared validators, so a modified or malformed body
  becomes a generic failure and never partial data; bodies are checked before sending.
- **Repudiation:** not applicable on the client; the server records the expense creator.
- **Information Disclosure:** failures expose only message keys; amounts are never logged by the client.
- **Denial of Service:** one request per user action; no polling or retry loop is added.
- **Elevation of Privilege:** the client never decides permissions; a 403 is displayed as received.

### `apps/web/src/features/groups/split/split-request.ts`
- **Spoofing:** not applicable; the module is pure and holds no identity.
- **Tampering:** a split that does not add up is never built; the property test checks 1,000 random
  splits against the shared rules, and the server refuses anything the client got wrong.
- **Repudiation:** not applicable.
- **Information Disclosure:** not applicable; no I/O.
- **Denial of Service:** work is linear in the member count, at most 50.
- **Elevation of Privilege:** not applicable; member ids come from the loaded options and the API checks
  that each belongs to the group.

### `apps/web/src/features/groups/expenses/list/group-expenses-container.tsx`
- **Spoofing:** not applicable below the session.
- **Tampering:** the list is read-only data; the cursor comes only from the previous response.
- **Repudiation:** not applicable.
- **Information Disclosure:** a non-member gets 404 and the screen shows the not-found state without
  hints; the list shows only the group's own members and amounts.
- **Denial of Service:** at most 2 requests on load and 50 rows per page.
- **Elevation of Privilege:** not applicable; the screen offers no action beyond linking to the form.

### `apps/web/src/features/groups/expenses/form/expense-form-container.tsx`
- **Spoofing:** the payer's account fields are shown only when the caller is the payer, and the API
  checks that the account and category belong to the caller.
- **Tampering:** a double submit could create 2 expenses; the send control is disabled while a request
  is in flight, and amounts and splits are validated on the client and again on the server.
- **Repudiation:** the server records who created the expense.
- **Information Disclosure:** the form loads the caller's own accounts and categories only and never
  renders them for another payer; server messages are shown by key.
- **Denial of Service:** at most 3 requests on load and one per submit.
- **Elevation of Privilege:** a forged payer or account id is refused by the API with 400, 403 or 404;
  the screen shows the refusal and keeps the typed values.

### `apps/web/src/features/groups/default-split/default-split-container.tsx`
- **Spoofing:** the role comes from the loaded group, not from a client claim.
- **Tampering:** percentages are validated to total 10000 basis points and re-validated by the API.
- **Repudiation:** the server records the change.
- **Information Disclosure:** members see the default read only; it contains only member names and
  percentages of their own group.
- **Denial of Service:** one request on load and one per save.
- **Elevation of Privilege:** hiding the edit controls is a convenience only; a member who forges the
  request gets 403 from the API and the screen shows it.

### `apps/web/src/features/groups/shares/personal-shares-container.tsx`
- **Spoofing:** not applicable below the session.
- **Tampering:** the date range is validated before sending; the API validates it again.
- **Repudiation:** not applicable; the page is read-only.
- **Information Disclosure:** the API returns only the caller's own shares; totals stay per currency and
  never mix currencies.
- **Denial of Service:** one request per page of results, with a bounded page size.
- **Elevation of Privilege:** not applicable; there is no write action.

## Data classification
| Data | Class | At rest | In transit |
|---|---|---|---|
| Expense amounts, descriptions and splits | financial | PostgreSQL, managed encryption at rest | HTTPS only |
| Member names and shares | personal | PostgreSQL, managed encryption at rest | HTTPS only |
| Payer account and category ids | financial | PostgreSQL | HTTPS only |

## Risks and mitigations
| ID | Risk | STRIDE | Likelihood | Impact | Mitigation |
|---|---|---|---|---|---|
| R-01 | Client and server disagree on a split and a wrong amount is recorded | T | Medium | High | Shared split helpers, property test over 1,000 random splits, server stays authoritative (Block 2) |
| R-02 | Floating point corrupts money while typing percentages or amounts | T | Medium | High | Basis points and minor units only, scan for `parseFloat`, `toFixed` and `Number(` (Blocks 2, 7) |
| R-03 | A double submit creates a duplicate expense | T | Medium | Medium | Send disabled while in flight (Block 4 test) |
| R-04 | A regular member edits the default split by forging a request | E | Low | High | The API answers 403; the screen hides the controls and shows the refusal (Block 5) |
| R-05 | A screen leaks the existence of a group or another user's shares | I | Low | Medium | 404 renders the same not-found state; shares are caller-scoped by the API (Blocks 3, 6) |
| R-06 | A hardcoded string or one-language screen ships | T | Medium | Low | Catalog parity and no-literal scan (Block 7) |

## Supply chain
No new runtime dependency (spec D7); the screens use React, the existing design system components, the
shared package and the existing api-client.

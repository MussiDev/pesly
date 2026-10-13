# Threat model FEAT-007: Group detail — suggested payments and recent expenses

| Field | Value |
|-------|-------|
| Ticket | FEAT-007 |
| Spec | docs/ddw/specs/spec-FEAT-007.md |
| Tier | FEATURE |
| Date | 2026-10-12 |

## Components
| Component | Source in the spec |
|---|---|
| `apps/web/src/features/groups/detail/use-recent-expenses.ts` | Block 1 |
| `apps/web/src/features/groups/components/group-recent-expenses.tsx` | Block 2 |
| `apps/web/src/features/groups/components/group-suggested-payments-section.tsx` | Block 2 |
| `apps/web/src/features/groups/containers/group-detail-container.tsx` | Block 3 |

## Trust boundaries
- Browser → Express API: the group id comes from the URL path and is attacker-controlled; the API
  answers `GET /groups/:id/balances`, `GET /groups/:id/expenses?limit=5` and the expense options with
  data only for members, and 404 for anyone else.
- Express API → browser: expense descriptions are free text written by other group members and cross
  into the page as untrusted strings.
- Browser → settlement endpoint: the prefill built from the balances (payer, payee, amount, currency)
  crosses back to the API when a payment is recorded; the API must not trust it.

## STRIDE analysis
### `apps/web/src/features/groups/detail/use-recent-expenses.ts`
- **Spoofing:** it sends the user's session through the shared API client; it creates no credential
  and accepts no identity from the URL beyond the group id, which the API authorizes per request.
- **Tampering:** the response is parsed by the shared API client's Zod schemas before it reaches the
  hook, so a malformed body becomes a failure and not a rendered value.
- **Repudiation:** the hook performs reads only; there is no action to deny. Recording a payment stays
  on the existing settlement endpoint and its activity log.
- **Information Disclosure:** a group id the caller does not belong to answers 404 from the API (the
  project rule), so the hook receives `NOT_FOUND` and reports it through `onFatal`; it never caches
  the response outside component state.
- **Denial of Service:** one list call limited to 5 items and one options call per mount; a retry is
  a user action, not a loop, and the write/read rate limit of the API still applies (R-03).
- **Elevation of Privilege:** it cannot request more than the caller's own group data; `limit=5` is
  validated by the shared list query schema and the hook has no way to pass another group's id.

### `apps/web/src/features/groups/components/group-recent-expenses.tsx`
- **Spoofing:** a member could write a description that imitates a system message; it is shown inside
  an expense row with payer and amount beside it, as on the expenses page.
- **Tampering:** the component is presentational and read-only; it renders props and a link, with no
  edit or delete action (out of scope in the PRD).
- **Repudiation:** nothing is written from this component.
- **Information Disclosure:** it shows only what the expenses page already shows to the same
  member (description, category, payer, amount, date, own share); no amount reaches a notification
  or a URL.
- **Denial of Service:** at most 5 rows are rendered; a very long description wraps and is clipped by
  the row layout (AC-15).
- **Elevation of Privilege:** it renders no action, so it grants none; the "See all" link goes to a
  page that authorizes on its own.

### `apps/web/src/features/groups/components/group-suggested-payments-section.tsx`
- **Spoofing:** the payer and payee names come from group members the API returned; the Record button
  only prefills a form, so impersonating a member here records nothing.
- **Tampering:** a user could alter the prefill in the browser (amount, payee) before submitting;
  mitigated because the settlement endpoint validates members, currency and amount on the server and
  answers 409 when the debts moved (R-02).
- **Repudiation:** the recorded payment goes to the existing settlement endpoint and appears in the
  group's activity log with the member who recorded it.
- **Information Disclosure:** it shows balances between members of the same group, the data the
  balances screen already shows to every member.
- **Denial of Service:** rendering is bounded by two currencies and the members of the group; the
  button opens one form at a time (remounted by key).
- **Elevation of Privilege:** pressing Record opens the form with the caller's own permissions; the
  API still checks that the caller may record a payment between those two members.

### `apps/web/src/features/groups/containers/group-detail-container.tsx`
- **Spoofing:** the container keeps the current redirect to sign-in on `UNAUTHENTICATED` for the
  group call; a 401 on a secondary call is handled the same way through `onFatal`.
- **Tampering:** state is local and per mount; the container sends no data on load, and after
  recording a payment it reloads balances from the server instead of editing them locally.
- **Repudiation:** the container performs no write itself; payments are written by the settlement
  form container and logged by the API.
- **Information Disclosure:** a not-found group renders the not-found view and none of the new
  sections, so no partial data of a group the caller cannot see stays on screen (AC-12).
- **Denial of Service:** four requests start on load (NFR-01) and each retry repeats only its own
  section's calls; there is no polling and no timer.
- **Elevation of Privilege:** the container adds no route, no role check and no new API call outside
  the four existing endpoints; admin-only panels keep their `isAdmin` condition unchanged.

## Data classification
| Data | Class | At rest | In transit |
|---|---|---|---|
| balances and suggested payments between members | financial | stored by the API in PostgreSQL; the browser keeps them only in component state, never in IndexedDB or storage | TLS to the API; session cookie flagged Secure and HttpOnly |
| recent expenses (description, amount, category, payer, date) | financial | stored by the API in PostgreSQL; kept only in component state in the browser | TLS to the API |
| member display names | PII | stored by the API in PostgreSQL; not persisted by the web app | TLS to the API |
| group id in the URL | public | not a secret; access is decided by the API per request | TLS to the API |

## Risks and mitigations
| ID | Risk | STRIDE | Likelihood | Impact | Mitigation |
|---|---|---|---|---|---|
| R-01 | A member stores markup or script in an expense description that runs in another member's page | T | M | H | descriptions render as React text children, never with `dangerouslySetInnerHTML`; a component test renders `<img onerror>` as literal text |
| R-02 | The settlement prefill is edited in the browser, or the debts changed since the page loaded, so a wrong payment is recorded | T | M | M | no trust in the prefill: the existing endpoint validates on the server and answers 409 when debts moved; the form shows the failure and the detail reloads balances only after a success |
| R-03 | Opening the detail of many groups, or repeated retries, multiplies requests against the API | D | L | M | four requests per load, no polling; the API rate limit stays in force; a retry reloads only its own section |
| R-04 | A user opens `/groups/<id>` of a group they are not in and sees partial data | I | L | H | the API answers 404 for non-members on all four calls; the container shows the not-found view and renders neither section (AC-12); a test covers a 404 on a secondary call |

## Supply chain
No new dependency: the change uses React, next-intl, the existing UI components and the shared API
client already in `apps/web`. AGENTS.md requires a justification for any new runtime dependency, and
there is none to justify.

## Availability
The four reads are bounded (5 expenses, two currencies of balances, the options of one group) and
independent: a failing section degrades alone and the rest of the screen stays usable (FR-09). The
screen stays online only, as today, and adds no offline queue or background work.

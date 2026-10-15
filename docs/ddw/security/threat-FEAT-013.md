# Threat model FEAT-013: Installment schedule preview and closing-day clarity

| Field | Value |
|-------|-------|
| Ticket | FEAT-013 |
| Spec | docs/ddw/specs/spec-FEAT-013.md |
| Tier | FEATURE |
| Date | 2026-10-15 |

## Components
| Component | Source in the spec |
|---|---|
| `packages/shared/src/credit-cards/installment-schedule.ts` | Block 1 |
| `apps/api/src/credit-cards/domain/statement-assignment.ts` | Block 1 |
| `apps/web/src/features/credit-cards/installment-request.ts` | Block 2 |
| `apps/web/src/features/credit-cards/components/installment-schedule-preview.tsx` | Block 3 |
| `apps/web/src/features/credit-cards/containers/installment-purchase-container.tsx` | Block 4 |

## Trust boundaries
- Browser → Express API: the container reads the card and its statements through the existing
  `GET /credit-cards/:id` and `GET /credit-cards/:id/statements`; the preview adds no request and no
  write, and the save path is unchanged.
- Web app → shared package: the preview and the API assignment path run the same pure functions, so
  what the user sees and what the server stores come from one rule.
- User input → form: the amount, the number of payments and the date are typed by the user and parsed
  on the device before they reach the schedule function.

## STRIDE analysis
### `packages/shared/src/credit-cards/installment-schedule.ts`
- **Spoofing:** it is a pure function with no identity; it receives the card and statements the API
  already scoped to the signed-in owner.
- **Tampering:** it computes a view and stores nothing, so a client that edits its own preview cannot
  change what the server assigns; the server recomputes at save time (R-01).
- **Repudiation:** nothing is recorded by the preview; the saved purchase keeps the existing audit
  line of the create route.
- **Information Disclosure:** it returns only dates and amounts derived from its own inputs and
  reads no other data.
- **Denial of Service:** the loop is bounded by the 60 payments the input schema allows, so the work
  is at most 60 rows per keystroke (R-02).
- **Elevation of Privilege:** it holds no privileges and calls no service.

### `apps/api/src/credit-cards/domain/statement-assignment.ts`
- **Spoofing:** the domain function takes statements already loaded under the owner scope; moving
  its body to the shared package changes no scoping.
- **Tampering:** the rule moves without a change of behavior, and the existing API tests plus the
  parity test fail if the assignment of a day or the leftover split changes (R-03).
- **Repudiation:** the use cases that call it keep their current logging.
- **Information Disclosure:** it returns a statement of the caller's own list and nothing else.
- **Denial of Service:** one linear search over the card's statements, as today.
- **Elevation of Privilege:** it imports from the shared package only, with no layer inversion, so
  the domain still never imports from infrastructure.

### `apps/web/src/features/credit-cards/installment-request.ts`
- **Spoofing:** it holds no session; the user id never reaches it.
- **Tampering:** the draft parser and the request builder share one validation, so a value the
  preview accepts is a value the save accepts, and the server validates the same body again with the
  shared Zod schema (R-04).
- **Repudiation:** it records nothing.
- **Information Disclosure:** the typed amount stays in the component state and is not written to
  logs, the URL or storage.
- **Denial of Service:** the count is matched against a three-digit integer pattern and bounded to
  60 before any loop runs.
- **Elevation of Privilege:** it grants no access; the API still checks the owner and the write
  scope on save.

### `apps/web/src/features/credit-cards/components/installment-schedule-preview.tsx`
- **Spoofing:** it shows what it is given and takes no input that names a user.
- **Tampering:** it is presentational with no fetch and no write.
- **Repudiation:** it records nothing.
- **Information Disclosure:** it renders the user's own amounts and dates in the user's own session
  and writes nothing to logs or storage.
- **Denial of Service:** at most 60 table rows are rendered, within the 100 ms budget of NFR-01.
- **Elevation of Privilege:** values are rendered as text through React, never as HTML, so a note or
  a statement field cannot inject markup (R-05).

### `apps/web/src/features/credit-cards/containers/installment-purchase-container.tsx`
- **Spoofing:** requests use the session cookie like every other call of the web app, with no token
  handled by the component.
- **Tampering:** the container only reads statements; the purchase is still created by the existing
  routes, which recompute the first statement and the amounts on the server.
- **Repudiation:** creation is audited by the existing create routes.
- **Information Disclosure:** the statements it loads belong to the card the owner opened; a card of
  another user answers 404 as today.
- **Denial of Service:** one extra read per page load, and none per keystroke (NFR-04); the read is
  the existing list endpoint, which already sits behind the per-user rate limit (R-06).
- **Elevation of Privilege:** a read-only credential can already list statements and still cannot
  save, so the preview gives no new capability.

## Data classification
| Data | Class | At rest | In transit |
|---|---|---|---|
| purchase amount and installment amounts | financial | not stored by the preview; PostgreSQL volume encryption of the managed database for saved purchases | TLS 1.3 to the API |
| statement closing and due dates | financial | PostgreSQL volume encryption of the managed database | TLS 1.3 to the API |
| session cookie | credentials | not stored by this feature | TLS 1.3, cookie flagged Secure and HttpOnly |

## Risks and mitigations
| ID | Risk | STRIDE | Likelihood | Impact | Mitigation |
|---|---|---|---|---|---|
| R-01 | the preview shows a schedule the save does not store, so the user trusts a wrong due date | T | M | M | one shared function used by both paths, the server recomputes on save, parity test and AC-11 |
| R-02 | a large edit burst makes the form slow | D | L | L | rows bounded at 60 and a 100 ms render test (NFR-01) |
| R-03 | moving the rule to the shared package changes API behavior | T | M | H | the move keeps the signatures, every existing API test stays green and a deterministic parity sweep covers one payment, installments, dates before the first and after the last statement |
| R-04 | the preview and the save validate differently, so a value is previewed but refused | T | M | L | one extracted draft parser used by both, and the server's own schema stays authoritative |
| R-05 | injected markup through a value shown in the schedule | E | L | M | every value is formatted from typed data and rendered as a React text child, and a component test asserts the cells hold plain text only |
| R-06 | opening the page repeatedly creates statements and load | D | L | L | the existing list route already creates missing cycles once and sits behind the per-user rate limit; no new route |

## Supply chain
No new runtime or development dependency is added: the feature uses the existing shared package
helpers, React and the i18n catalogs.

## Availability
The only vector is the extra statements read per page load, behind the existing rate limit, and the
bounded 60-row render. There is no migration, no new route and no change to the write path.

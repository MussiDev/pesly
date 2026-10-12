# Threat model DISC-001-06b: Budgets Core API

| Field | Value |
|-------|-------|
| Ticket | DISC-001-06b |
| Spec | docs/ddw/specs/spec-DISC-001-06b.md |
| Tier | FEATURE |
| Date | 2026-10-11 |

## Components
| Component | Source in the spec |
|---|---|
| `apps/api/src/budgets/infrastructure/http/budget-routes.ts` | Block 4 |
| `apps/api/src/budgets/application/create-budget.ts` | Block 3 |
| `apps/api/src/budgets/application/update-budget.ts` | Block 3 |
| `apps/api/src/budgets/infrastructure/db/drizzle-budget-repository.ts` | Block 2 |
| `apps/api/src/budgets/infrastructure/db/schema.ts` | Block 2 |

## Trust boundaries
- Browser → API (`/budgets` routes): untrusted JSON bodies, params and session cookies cross it; the
  shared `validate` middleware, `requireSession` and `requireVerifiedEmail` guard it.
- API → PostgreSQL: SQL statements cross it; only parameterized Drizzle queries are built, and the
  database constraints (check, unique, composite foreign keys) are the backstop.
- User → budget data: an authenticated user is not the owner of every budget; the shared
  `AccessScope` and `scopedTo` decide per request which rows a user may read or change.
- Budgets → categories: a budget names categories by id; the composite key with the owner decides
  which categories a user may reference.
- Account erasure (identity module) → budget tables: the user delete cascades to every budget row.

## STRIDE analysis
### `apps/api/src/budgets/infrastructure/http/budget-routes.ts`
- **Spoofing:** every route sits behind `requireSession` and `requireVerifiedEmail`; the caller's id
  comes from the session, never from the body or a param.
- **Tampering:** params and body go through the shared Zod schemas with strict objects, so extra keys
  (such as `ownerId` or `currency` on an edit) are rejected and cannot change the owner or the currency.
- **Repudiation:** audit lines carry the request id, the user id and the budget id for every write; they
  never carry a name or an amount.
- **Information Disclosure:** a foreign budget and an unknown id get the same 404 body; a foreign
  category and an unknown category get the same 404, so ids cannot be probed; responses carry no email
  and no owner id.
- **Denial of Service:** the JSON body limit applies; the contract caps categories at 50 and thresholds
  at 5 per request, and a user cannot hold more than 50 budgets.
- **Elevation of Privilege:** no route takes an owner or a role; the scope comes from the session, so a
  user cannot act on another user's budget.

### `apps/api/src/budgets/application/create-budget.ts`
- **Spoofing:** it takes the user id from the issued `AccessScope` only.
- **Tampering:** it validates the category set (own, expense, not archived) before any write and
  normalizes thresholds server side, so the stored version never holds client-chosen order or
  duplicates.
- **Repudiation:** creation is logged with ids by the route; the use case writes nothing else.
- **Information Disclosure:** it answers the same error for an unknown and a foreign category.
- **Denial of Service:** the limit of 50 budgets per user is checked in the repository transaction.
- **Elevation of Privilege:** it cannot create a budget for another owner: the owner is the scope's
  user id.

### `apps/api/src/budgets/application/update-budget.ts`
- **Spoofing:** it takes the user id from the issued write `AccessScope` only.
- **Tampering:** an edit writes only the version of the current month and never an earlier one, so a
  client cannot rewrite history; the month is computed from the server clock and the stored time zone,
  not from client input.
- **Repudiation:** every edit is logged with the budget id; earlier versions remain stored as the
  record of previous values.
- **Information Disclosure:** a foreign or missing budget answers 404 before any category is looked at.
- **Denial of Service:** at most one version per budget and month is kept, so repeated edits do not grow
  the tables.
- **Elevation of Privilege:** a category of another user in an edit is refused by the use case and, as a
  backstop, by the composite foreign key.

### `apps/api/src/budgets/infrastructure/db/drizzle-budget-repository.ts`
- **Spoofing:** not applicable below the guard: the repository receives an issued `AccessScope` and
  every query on a budget goes through `scopedTo`.
- **Tampering:** the 50-budget limit is enforced inside a transaction that takes a per-owner advisory
  lock before counting, so concurrent creates cannot exceed it; the writes of one edit happen in one
  transaction, so a budget never has half a version.
- **Repudiation:** writes are transactional and keyed by ids that appear in the audit lines.
- **Information Disclosure:** queries select only the columns the presenter needs, always filtered by
  the owner in the scope; covered categories are read inside the same owner scope.
- **Denial of Service:** the advisory lock is held for one short transaction per owner; lists are bounded
  by 50 budgets per user.
- **Elevation of Privilege:** the owner column of every write comes from the scope, never from a
  request field.

### `apps/api/src/budgets/infrastructure/db/schema.ts`
- **Spoofing:** the composite keys carry `owner_id` through budget, version, category and threshold
  rows, so a child row cannot name a parent of another owner.
- **Tampering:** checks bound the amount (greater than 0, `bigint`), the name length, the currency, the
  first-of-month date, the threshold range and the `expense` kind; the unique `(budget_id,
  effective_from)` index forbids two versions for one month.
- **Repudiation:** rows keep `created_at` and `updated_at` timestamps.
- **Information Disclosure:** no secret and no credential is stored; budget names and amounts are the
  only personal data.
- **Denial of Service:** indexes on `(owner_id, created_at, id)` and on the category key keep the lists
  and the category-in-use check fast.
- **Elevation of Privilege:** the category key with the owner refuses a foreign category even if a bug
  skipped the use case check; cascades remove a budget's rows with the budget and with the user.

## Data classification
| Data | Class | At rest | In transit |
|---|---|---|---|
| Budget name | PII | stored in PostgreSQL; managed database encryption at rest | HTTPS to the browser |
| Budget amount, currency and thresholds | financial | stored in PostgreSQL as `bigint`, text and `smallint`; managed database encryption at rest | HTTPS to the browser; TLS between the API and the database |
| Category ids a budget covers | financial | stored in PostgreSQL; managed database encryption at rest | HTTPS to the browser |
| Owner id | PII | stored in PostgreSQL | never returned in a response |

## Risks and mitigations
| ID | Risk | STRIDE | Likelihood | Impact | Mitigation |
|---|---|---|---|---|---|
| R-01 | A user reads, edits or deletes another user's budget by guessing an id | I | Medium | High | Every query goes through `scopedTo` with the issued scope; a foreign budget gets the same 404 as a missing one (Blocks 2 to 4 tests) |
| R-02 | A budget references another user's category, leaking its existence or name | I | Medium | High | The use case checks ownership and the composite key with `owner_id` refuses it; unknown and foreign ids give the same 404; responses never return a category name |
| R-03 | An edit rewrites a past month and corrupts history that 06c reads | T | Medium | Medium | Edits write only the current month's version, computed server side in the user's zone; a test compares September's rows before and after (Block 2) |
| R-04 | A user floods the database with budgets, versions or children | D | Medium | Medium | Limit of 50 budgets under an advisory lock, one version per month, at most 50 categories and 5 thresholds per request (D8, D14) |
| R-05 | A float or an overflow corrupts a money amount | T | Low | High | `bigint` column and exact integer string in the contract; introspection test asserts 0 float columns (NFR-01) |
| R-06 | Account erasure fails or leaves budget rows after the user is deleted | E | Low | Medium | All keys cascade from `users` and the category key is `no action`; the erasure registry proves it for the four tables (Block 2) |
| R-07 | Budget names or amounts leak through logs | I | Low | Medium | Audit lines carry ids only; a test asserts that no log line contains a name or an amount (Block 4) |
| R-08 | Deleting a category silently empties a budget | T | Medium | Medium | The category key refuses the delete and the existing `CATEGORY_IN_USE` is returned; archiving keeps the budget intact |

## Supply chain
No new runtime dependency: the module reuses Drizzle, Zod and Express already in the project and the
shared money and time helpers (spec D13).

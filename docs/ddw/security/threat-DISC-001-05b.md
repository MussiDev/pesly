# Threat model DISC-001-05b: Group Expenses and Splits

| Field | Value |
|-------|-------|
| Ticket | DISC-001-05b |
| Spec | docs/ddw/specs/spec-DISC-001-05b.md |
| Tier | FEATURE |
| Date | 2026-10-10 |

## Components
| Component | Source in the spec |
|---|---|
| `apps/api/src/groups/infrastructure/http/group-routes.ts` | Block 5 |
| `apps/api/src/groups/application/record-group-expense.ts` | Block 3 |
| `apps/api/src/groups/infrastructure/db/drizzle-group-expense-repository.ts` | Block 4 |
| `apps/api/src/groups/infrastructure/movements/drizzle-payer-movement-recorder.ts` | Block 4 |
| `packages/shared/src/money/split-expense.ts` | Block 1 |
| `apps/api/src/groups/infrastructure/db/schema.ts` | Block 2 |

## Trust boundaries
- Browser → API (`/groups/:id/expenses` and related routes): untrusted JSON bodies, params, query
  and session cookies cross it; the shared `validate` middleware, `requireSession` and
  `requireVerifiedEmail` guard it.
- API → PostgreSQL: parameterized Drizzle statements cross it; check, unique and composite foreign
  keys are the backstop.
- Group member → group data: an authenticated user is not yet a member of a given group; the
  `GroupAccess` guard decides per request.
- Groups module → accounts and movements data: the payer recorder reads the caller's own account
  and category and writes a movement owned by the caller; it must never touch another user's data.

## STRIDE analysis
### `apps/api/src/groups/infrastructure/http/group-routes.ts`
- **Spoofing:** every route sits behind `requireSession` and `requireVerifiedEmail`; the caller comes
  from the session, never from the body; `createdByMemberId` is derived, not an input.
- **Tampering:** strict Zod schemas reject unknown keys, negative or zero amounts, duplicated
  members and malformed cursors.
- **Repudiation:** audit lines carry request id, user id, group id and expense id for each creation;
  the creation also writes an activity log row in the same transaction (reading it is 05d).
- **Information Disclosure:** non-members and missing groups or expenses get the same 404; the
  personal-shares route only returns the caller's own shares and receivables; no email is returned.
- **Denial of Service:** `limit` is capped at 100, a split has at most 50 members, and the body size
  limit applies.
- **Elevation of Privilege:** only the default-split write is admin-only and answers 403 to a member;
  a member cannot record an expense in a group they do not belong to.

### `apps/api/src/groups/application/record-group-expense.ts`
- **Spoofing:** it takes the caller from the authenticated context only; a payer account is accepted
  only when the payer is the caller.
- **Tampering:** it re-checks that every split member, the payer and the category belong to the group
  and asserts `sum(shares) = amount` before writing.
- **Repudiation:** the use case writes the log row with the member who acted.
- **Information Disclosure:** errors say which rule failed without echoing other members' data.
- **Denial of Service:** work is bounded by 50 members; one transaction per expense.
- **Elevation of Privilege:** a member cannot make another user's account pay: the account must be
  the caller's own, in the expense currency.

### `apps/api/src/groups/infrastructure/db/drizzle-group-expense-repository.ts`
- **Spoofing:** not applicable below the guard; it receives ids already authorized.
- **Tampering:** expense, shares, log row and payer movement are written in one transaction, so a
  partial write cannot leave shares that do not add up; composite foreign keys keep a share in the
  expense's own group.
- **Repudiation:** rows keep timestamps and the creating member id.
- **Information Disclosure:** every query filters by group id; the personal view filters by the
  caller's member rows.
- **Denial of Service:** keyset pagination on indexed columns, bounded page size.
- **Elevation of Privilege:** group id comes from the guarded route, never from the body.

### `apps/api/src/groups/infrastructure/movements/drizzle-payer-movement-recorder.ts`
- **Spoofing:** the movement owner is the authenticated caller, never an id from the body.
- **Tampering:** the movement is built with the existing movement rules (positive amount, frozen
  rate, category of the owner), and `payer_movement_id` is `on delete set null` so erasure cannot be
  blocked.
- **Repudiation:** the movement note and the group expense reference each other by id.
- **Information Disclosure:** reads only the caller's account and category; a foreign account id
  answers the same `GROUP_PAYER_ACCOUNT_INVALID` as a wrong currency, so it cannot be probed.
- **Denial of Service:** three indexed lookups and one insert per expense.
- **Elevation of Privilege:** it cannot create a movement for another user because the scope is the
  caller's.

### `packages/shared/src/money/split-expense.ts`
- **Spoofing:** not applicable, pure functions.
- **Tampering:** integer-only arithmetic with `bigint`; no float path, and the sum is asserted before
  returning.
- **Repudiation:** not applicable.
- **Information Disclosure:** not applicable.
- **Denial of Service:** linear in the number of members, at most 50.
- **Elevation of Privilege:** not applicable.

### `apps/api/src/groups/infrastructure/db/schema.ts`
- **Spoofing:** not applicable.
- **Tampering:** checks on positive amounts, basis points range, currency and split mode; composite
  foreign keys keep expenses, shares and log rows inside their group; amounts are `bigint`.
- **Repudiation:** `created_at` and the creating member id on every expense and log row.
- **Information Disclosure:** no personal data beyond ids and amounts.
- **Denial of Service:** indexes on `(group_id, occurred_at, id)` and `(member_id, expense_id)`.
- **Elevation of Privilege:** member references restrict deletion, so a share cannot be orphaned.

## Data classification
| Data | Class | At rest | In transit |
|---|---|---|---|
| Expense amount, currency, date and description | financial | PostgreSQL, managed encryption at rest | HTTPS only |
| Shares and basis points | financial | PostgreSQL, managed encryption at rest | HTTPS only |
| Payer movement (account and category ids) | financial | PostgreSQL, owned by the payer | HTTPS only |
| Activity log rows | internal | PostgreSQL | HTTPS only |
| Audit lines | internal | ids only, no amounts or descriptions | log pipeline |

## Risks and mitigations
| ID | Risk | STRIDE | Likelihood | Impact | Mitigation |
|---|---|---|---|---|---|
| R-01 | A non-member reads or records expenses of another group by guessing ids | I | Medium | High | `GroupAccess` first; same 404 for missing and foreign groups and expenses (Blocks 3 and 5 tests) |
| R-02 | A member makes another user's account pay for an expense | E | Low | High | The account must be the caller's own, in the expense currency; `payerAccount` rejected when the payer is not the caller (Block 3 tests) |
| R-03 | Shares do not add up to the amount, hiding or inventing debt | T | Medium | High | Integer helpers, asserted sum, 30,000-split property test, one transaction (Blocks 1, 3, 4) |
| R-04 | A partial failure leaves a payer movement without its expense or the reverse | T | Medium | High | One transaction on the same handle; blocker if impossible (D6, Block 4 atomicity test) |
| R-05 | Account erasure fails because movements are referenced by expenses | D | Medium | Medium | `payer_movement_id` is `on delete set null`; member rows survive as ghosts (Block 2 test) |
| R-06 | Sensitive text reaches logs | I | Medium | Medium | Audit lines carry ids only; a test asserts no amount or description in log lines (Block 5) |
| R-07 | A large page or split exhausts the service | D | Low | Medium | `limit` max 100, split max 50 members, strict body schema |

## Supply chain
No new runtime dependency (spec D15); the module reuses Drizzle, Zod and Express, and the existing
accounts and movements lookups.

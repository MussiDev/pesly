# Threat model DISC-001-05c: Balances and Settlements

| Field | Value |
|-------|-------|
| Ticket | DISC-001-05c |
| Spec | docs/ddw/specs/spec-DISC-001-05c.md |
| Tier | FEATURE |
| Date | 2026-10-10 |

## Components
| Component | Source in the spec |
|---|---|
| `apps/api/src/groups/infrastructure/http/group-routes.ts` | Block 6 |
| `apps/api/src/groups/application/record-settlement.ts` | Block 3 |
| `apps/api/src/groups/application/remove-member.ts` and `leave-group.ts` | Block 3 |
| `apps/api/src/groups/infrastructure/db/drizzle-group-settlement-repository.ts` | Block 4 |
| `apps/api/src/groups/infrastructure/db/drizzle-group-repository.ts` (member removal) | Block 5 |
| `apps/api/src/movements/infrastructure/accounts/drizzle-account-movements.ts` | Block 4 |
| `packages/shared/src/money/simplify-debts.ts` and `convert-minor-units.ts` | Block 1 |
| `apps/api/src/groups/infrastructure/db/schema.ts` | Block 2 |

## Trust boundaries
- Browser → API (`/groups/:id/balances`, `/settlements`, `/leave`, `/members/:memberId`): untrusted
  JSON bodies, params, query and session cookies cross it; the shared `validate` middleware,
  `requireSession` and `requireVerifiedEmail` guard it.
- API → PostgreSQL: parameterized Drizzle statements cross it; check, unique and composite foreign
  keys and row locks are the backstop.
- Group member → group data: an authenticated user is not yet a member of a given group; the
  `GroupAccess` guard decides per request, and a user who left is outside it.
- Groups module → accounts data: the account checker reads the caller's own account; the account
  balance reads the settlement rows through the `movements` adapter and never writes them.

## STRIDE analysis
### `apps/api/src/groups/infrastructure/http/group-routes.ts`
- **Spoofing:** every route sits behind `requireSession` and `requireVerifiedEmail`; the caller comes
  from the session, never from the body; `createdByMemberId` is derived.
- **Tampering:** strict Zod schemas reject unknown keys, non-positive amounts, equal parties,
  non-positive rates and malformed cursors.
- **Repudiation:** audit lines carry request id, user id, group id and settlement or member id; the
  creation also writes an activity log row in the same transaction.
- **Information Disclosure:** non-members, users who left and missing groups get the same 404;
  responses carry member ids and amounts of the caller's own group only; no email is returned.
- **Denial of Service:** `limit` is capped at 100; the group has at most 50 active members; the
  body size limit applies.
- **Elevation of Privilege:** only removal is admin-only and answers 403 to a member; leaving needs
  only membership.

### `apps/api/src/groups/application/record-settlement.ts`
- **Spoofing:** the caller comes from the authenticated context; an account is accepted only when
  the caller is a party and owns the account.
- **Tampering:** the use case recomputes the legs of a consolidated settlement from stored data and
  rejects any input that differs; it asserts that legs are non-zero and clear their own currency.
- **Repudiation:** the log row names the member who acted and the clock instant.
- **Information Disclosure:** errors say which rule failed without echoing other members' data; a
  foreign account answers the same code as a wrong currency, so it cannot be probed.
- **Denial of Service:** work is bounded by 50 members; one transaction per settlement.
- **Elevation of Privilege:** a member cannot attach another user's account to a settlement.

### `apps/api/src/groups/application/remove-member.ts` and `leave-group.ts`
- **Spoofing:** the actor is the session user; a member cannot remove themselves through the admin
  route.
- **Tampering:** the balance is read inside the removal transaction under a row lock, so a concurrent
  expense or settlement cannot leave a balance behind.
- **Repudiation:** audit lines name the actor and the removed member.
- **Information Disclosure:** the balance in the 409 is shown only to the caller who is a member of
  the group.
- **Denial of Service:** one transaction with bounded aggregates.
- **Elevation of Privilege:** the last-admin rule keeps the group from losing every admin.

### `apps/api/src/groups/infrastructure/db/drizzle-group-settlement-repository.ts`
- **Spoofing:** not applicable below the guard; it receives ids already authorized.
- **Tampering:** settlement, legs and log row are written in one transaction; composite foreign keys
  keep every member inside the settlement's group; checks keep amounts and rates positive.
- **Repudiation:** rows keep timestamps and the creating member id.
- **Information Disclosure:** every query filters by group id.
- **Denial of Service:** the balance query is an aggregate over indexed columns, bounded by the
  benchmark of 500 ms at p95 for 50 members and 10,000 expenses.
- **Elevation of Privilege:** group id comes from the guarded route, never from the body.

### `apps/api/src/groups/infrastructure/db/drizzle-group-repository.ts` (member removal)
- **Spoofing:** not applicable below the guard.
- **Tampering:** the member row is locked `for update`; the write paths re-read members `for share`
  with `left_at is null`; the invitation and claim link of the removed member are deleted so they
  cannot be used to re-enter.
- **Repudiation:** `left_at` records when the member left.
- **Information Disclosure:** left members are listed only to members of the same group.
- **Denial of Service:** locks are per member row and short.
- **Elevation of Privilege:** a removed admin loses the role with the membership.

### `apps/api/src/movements/infrastructure/accounts/drizzle-account-movements.ts`
- **Spoofing:** not applicable, it is a read adapter keyed by account ids.
- **Tampering:** it adds settlement amounts by account with the same integer arithmetic; it never
  writes.
- **Repudiation:** not applicable.
- **Information Disclosure:** it returns sums only for the account ids it is given, which the
  accounts module has already scoped to the owner.
- **Denial of Service:** chunked queries on an indexed column.
- **Elevation of Privilege:** not applicable.

### `packages/shared/src/money/simplify-debts.ts` and `convert-minor-units.ts`
- **Spoofing:** not applicable, pure functions.
- **Tampering:** integer-only `bigint` arithmetic; the sum and the clearing of every balance are
  asserted before returning.
- **Repudiation:** not applicable.
- **Information Disclosure:** not applicable.
- **Denial of Service:** linear or n log n in at most 50 members.
- **Elevation of Privilege:** not applicable.

### `apps/api/src/groups/infrastructure/db/schema.ts`
- **Spoofing:** not applicable.
- **Tampering:** checks on amounts, rate, source and parties; composite foreign keys; amounts and
  rate are `bigint`.
- **Repudiation:** `created_at` and the creating member id on every settlement.
- **Information Disclosure:** no personal data beyond ids and amounts.
- **Denial of Service:** indexes on `(group_id, occurred_at, id)` and `(group_id, currency)`.
- **Elevation of Privilege:** member references restrict deletion, so history cannot be orphaned.

## Data classification
| Data | Class | At rest | In transit |
|---|---|---|---|
| Settlement amount, currency, legs, rate and date | financial | PostgreSQL, managed encryption at rest | HTTPS only |
| Account reference of a settlement | financial | PostgreSQL, owned by the caller | HTTPS only |
| Balances | financial, derived | computed on read | HTTPS only |
| Activity log rows | internal | PostgreSQL | HTTPS only |
| Audit lines | internal | ids only, no amounts | log pipeline |

## Risks and mitigations
| ID | Risk | STRIDE | Likelihood | Impact | Mitigation |
|---|---|---|---|---|---|
| R-01 | A non-member or a user who left reads balances or records settlements by guessing ids | I | Medium | High | `GroupAccess` first; same 404 for missing, foreign and left (Block 3 and 6 tests) |
| R-02 | A member attaches another user's account to a settlement and changes its balance | E | Low | High | The account must be the caller's own, in the cash currency, and the caller must be a party (Block 3 tests) |
| R-03 | Balances stop adding up and hide or invent debt | T | Medium | High | Derived on read, zero-sum per operation, 10,000-operation tests (Blocks 1, 3, 4) |
| R-04 | A member leaves with a balance because of a concurrent expense | T | Medium | High | Row lock on removal and `for share` recheck on writes (D10, Block 5 test) |
| R-05 | A consolidated settlement clears debts the user did not see | T | Medium | High | Legs recomputed and compared in the transaction, 409 on any difference (D6) |
| R-06 | The last admin leaves and the group cannot be managed | E | Medium | Medium | `GROUP_LAST_ADMIN` while other members remain (D9) |
| R-07 | Account erasure fails because settlements reference accounts | D | Medium | Medium | `account_id` is `on delete set null`; member rows survive as ghosts (Block 2 test) |
| R-08 | The balance query is slow in large groups | D | Low | Medium | Aggregate queries on indexed columns and a benchmark (Block 4) |
| R-09 | Sensitive text reaches logs | I | Medium | Medium | Audit lines carry ids only; a test asserts no amount in log lines (Block 6) |

## Supply chain
No new runtime dependency (spec D18); the module reuses Drizzle, Zod and Express, and the existing
account and rate lookups.

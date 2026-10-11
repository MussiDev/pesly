# Threat model DISC-001-05d: Editing Rules and Activity Log

| Field | Value |
|-------|-------|
| Ticket | DISC-001-05d |
| Spec | docs/ddw/specs/spec-DISC-001-05d.md |
| Tier | FEATURE |
| Date | 2026-10-10 |

## Components
| Component | Source in the spec |
|---|---|
| `apps/api/src/groups/infrastructure/http/group-routes.ts` | Block 5 |
| `apps/api/src/groups/application/update-group-expense.ts` and `delete-group-expense.ts` | Block 3 |
| `apps/api/src/groups/application/update-settlement.ts` and `delete-settlement.ts` | Block 3 |
| `apps/api/src/groups/infrastructure/db/drizzle-group-expense-repository.ts` | Block 4 |
| `apps/api/src/groups/infrastructure/db/drizzle-group-settlement-repository.ts` | Block 4 |
| `apps/api/src/groups/infrastructure/db/drizzle-activity-log-reader.ts` | Block 4 |
| `apps/api/src/groups/infrastructure/movements/drizzle-payer-movement-recorder.ts` | Block 4 |
| `apps/api/src/groups/infrastructure/db/schema.ts` and migration 0029 (trigger) | Block 2 |

## Trust boundaries
- Browser → API (`/groups/:id/expenses/:expenseId`, `/settlements/:settlementId`, `/activity`):
  untrusted JSON bodies, params, query and session cookies cross it; the shared `validate`
  middleware, `requireSession` and `requireVerifiedEmail` guard it.
- API → PostgreSQL: parameterized Drizzle statements cross it; check constraints, composite foreign
  keys, row locks and the immutability trigger are the backstop.
- Group member → group data: an authenticated user is not yet a member of a given group, and a member
  is not yet allowed to change a given record; `GroupAccess` and the permission rule decide per
  request.
- Groups module → movements data: the payer recorder updates or deletes a movement owned by the
  payer, under the payer's scope, never the editor's.

## STRIDE analysis
### `apps/api/src/groups/infrastructure/http/group-routes.ts`
- **Spoofing:** every route sits behind `requireSession` and `requireVerifiedEmail`; the caller comes
  from the session, never from the body.
- **Tampering:** strict Zod schemas reject unknown keys (currency, payer and creator cannot be sent),
  non-positive amounts and malformed cursors; the log routes for update and delete answer 405.
- **Repudiation:** audit lines carry request id, user id, group id and record id; every change also
  writes an immutable log row in the same transaction.
- **Information Disclosure:** non-members, users who left and missing records get the same 404;
  responses carry the data of the caller's own group only.
- **Denial of Service:** `limit` is capped at 100; the body size limit applies; a split has at most
  50 members.
- **Elevation of Privilege:** the permission rule runs after group access and before any write; a
  member who is not the author or an admin gets 403.

### `apps/api/src/groups/application/update-group-expense.ts` and `delete-group-expense.ts`
- **Spoofing:** the caller comes from the authenticated context; the author is compared by member id.
- **Tampering:** an edit re-validates the split, the members and the category with the creation rules
  and asserts that the shares add up before writing; currency and payer cannot change.
- **Repudiation:** the log row names the member who acted and carries the before values.
- **Information Disclosure:** errors say which rule failed without echoing other members' data.
- **Denial of Service:** work is bounded by 50 members; one transaction per change.
- **Elevation of Privilege:** an admin can change any record of their group, which is the decided rule
  (D1) and is visible to all members through the log; a ghost's or a former member's record needs an
  admin.

### `apps/api/src/groups/application/update-settlement.ts` and `delete-settlement.ts`
- **Spoofing:** same as the expense use cases.
- **Tampering:** only `amount` and `occurredAt` of a plain settlement change; a consolidated one
  cannot be edited, so its legs and rate cannot be forged.
- **Repudiation:** the log row carries the legs and amounts before and after.
- **Information Disclosure:** the same 404 for missing and foreign records.
- **Denial of Service:** one transaction per change.
- **Elevation of Privilege:** the permission rule of D1; an account is never attached or changed.

### `apps/api/src/groups/infrastructure/db/drizzle-group-expense-repository.ts`
- **Spoofing:** not applicable below the guard.
- **Tampering:** change, shares, log row and payer movement are written in one transaction under the
  group lock; composite foreign keys keep every share inside the group; a former member's balance
  cannot change.
- **Repudiation:** rows keep the creating member; the log keeps every change.
- **Information Disclosure:** every query filters by group id.
- **Denial of Service:** the group lock is held for one short transaction.
- **Elevation of Privilege:** group id and record id come from the guarded route and are checked
  together, so a record of another group cannot be reached by id.

### `apps/api/src/groups/infrastructure/db/drizzle-group-settlement-repository.ts`
- **Spoofing:** not applicable below the guard.
- **Tampering:** amount and leg change together in one transaction under the group `for update`.
- **Repudiation:** the log row is written in the same transaction.
- **Information Disclosure:** every query filters by group id.
- **Denial of Service:** the group lock serialises changes of one group only.
- **Elevation of Privilege:** group id comes from the guarded route.

### `apps/api/src/groups/infrastructure/db/drizzle-activity-log-reader.ts`
- **Spoofing:** not applicable below the guard.
- **Tampering:** read-only; no write path exists besides the insert inside a change.
- **Repudiation:** not applicable.
- **Information Disclosure:** the log is shown to members of the group only and carries amounts and
  descriptions by decision (all members see group data); no email is returned.
- **Denial of Service:** keyset pagination on an indexed column with a bounded page size.
- **Elevation of Privilege:** the group id filter comes from the guarded route.

### `apps/api/src/groups/infrastructure/movements/drizzle-payer-movement-recorder.ts`
- **Spoofing:** the movement owner is the stored payer, never an id from the body.
- **Tampering:** the movement is rewritten through the existing movement rules (positive amount,
  frozen rate rules, date clamp); a missing movement is left alone.
- **Repudiation:** the movement note and the expense keep referencing each other.
- **Information Disclosure:** it reads only the payer's own movement.
- **Denial of Service:** one indexed lookup and one write per change.
- **Elevation of Privilege:** an admin editing another member's expense acts on that member's movement
  only through the expense, with the account and category the payer already chose.

### `apps/api/src/groups/infrastructure/db/schema.ts` and migration 0029
- **Spoofing:** not applicable.
- **Tampering:** the trigger rejects any update or delete of a log row while the group exists; checks
  tie the action to its snapshot columns; amounts in snapshots are integer strings.
- **Repudiation:** log rows cannot be rewritten, which is the control for repudiation.
- **Information Disclosure:** snapshots hold ids, amounts and descriptions of the group only.
- **Denial of Service:** the trigger is a constant-time check per row.
- **Elevation of Privilege:** even a superuser path through the application cannot edit an entry
  without removing the trigger, which needs a migration reviewed in a pull request.

## Data classification
| Data | Class | At rest | In transit |
|---|---|---|---|
| Expense and settlement amounts, descriptions, shares | financial | PostgreSQL, managed encryption at rest | HTTPS only |
| Activity log snapshots (before and after) | financial | PostgreSQL, managed encryption at rest | HTTPS only |
| Audit lines | internal | ids only, no amounts or descriptions | log pipeline |

## Risks and mitigations
| ID | Risk | STRIDE | Likelihood | Impact | Mitigation |
|---|---|---|---|---|---|
| R-01 | A non-member or a user who left reads the log or changes records by guessing ids | I | Medium | High | `GroupAccess` first; same 404 for missing, foreign and left (Block 3 and 5 tests) |
| R-02 | A member changes or deletes a record of someone else | E | Medium | High | Permission rule D1, 403 before any write (Block 3 and 5 tests) |
| R-03 | A change is made without a log entry, or the log is rewritten | R | Medium | High | Same transaction, trigger D8, 405 routes, test over every write path (Blocks 2, 4, 5) |
| R-04 | An edit breaks the zero-sum balances | T | Medium | High | Balances derived from rows, shares re-asserted, 10,000 random operations with edits (Blocks 3, 4) |
| R-05 | An edit leaves a member who left with a balance | T | Medium | Medium | `GROUP_RECORD_FORMER_MEMBER` 409 (D5) |
| R-06 | An admin abuses edit rights unnoticed | E | Low | Medium | Every change is logged with before and after and visible to all members |
| R-07 | Concurrent edits corrupt the shares | T | Medium | Medium | Group lock serialises changes; concurrency test (Block 4) |
| R-08 | Sensitive text reaches the application logs | I | Medium | Medium | Audit lines carry ids only; a test asserts no amount or description (Block 5) |
| R-09 | The payer movement drifts from the expense | T | Medium | Medium | Rewritten or deleted in the same transaction (D6) |

## Supply chain
No new runtime dependency (spec D13); the module reuses Drizzle, Zod and Express and the existing
movement rules.

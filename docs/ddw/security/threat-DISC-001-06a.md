# Threat model DISC-001-06a: Savings Goals API

| Field | Value |
|-------|-------|
| Ticket | DISC-001-06a |
| Spec | docs/ddw/specs/spec-DISC-001-06a.md |
| Tier | FEATURE |
| Date | 2026-10-11 |

## Components
| Component | Source in the spec |
|---|---|
| `apps/api/src/goals/infrastructure/http/goal-routes.ts` | Block 5 |
| `apps/api/src/goals/infrastructure/db/drizzle-goal-repository.ts` | Block 4 |
| `apps/api/src/goals/infrastructure/db/drizzle-account-balances.ts` | Block 4 |
| `apps/api/src/goals/infrastructure/db/schema.ts` | Block 2 |
| `apps/api/src/goals/infrastructure/db/erase-user-goals.ts` | Block 2 |
| `apps/api/src/accounts/infrastructure/db/drizzle-account-repository.ts` | Block 6 |

## Trust boundaries
- Browser → API (`/goals` routes): untrusted JSON bodies, params, query and session cookies cross it; the
  shared `validate` middleware, `requireSession` and `requireVerifiedEmail` guard it.
- API → PostgreSQL: SQL statements and money amounts cross it; only parameterized Drizzle queries are built,
  and the database constraints (check, foreign key, unique) are the backstop.
- User → goal data: an authenticated user is not the owner of every goal id; the owner scope decides per
  request which goals are visible, and everything else answers 404.
- Goals module → accounts and movements: the goals module reads an account's currency, archive flag and
  balance through a port; the account id is checked against the caller's scope before any balance is read.
- Account erasure (identity module) → goals module: the erasure transaction calls `eraseUserGoals` before the
  user row is deleted.

## STRIDE analysis
### `apps/api/src/goals/infrastructure/http/goal-routes.ts`
- **Spoofing:** every route sits behind `requireSession` and `requireVerifiedEmail`; the owner id comes from the
  session, never from the body, a param or a query.
- **Tampering:** all params, query and body go through the shared Zod schemas with strict objects, so extra
  keys (such as `ownerId`, `progress` or `status`) are rejected and a client cannot set a derived value or
  another owner.
- **Repudiation:** audit lines carry the request id, the user id and the goal id for every write; they never
  carry a goal name or an amount.
- **Information Disclosure:** another user's goal and a missing goal get the same 404 body, so goal ids cannot be
  probed; a foreign account id used to link a goal also answers 404; responses carry no email and no other
  user's data.
- **Denial of Service:** the JSON body limit applies; goals are capped at 100 per user and the entry list at
  100 rows per request, so a user cannot make a response or a table grow without bound.
- **Elevation of Privilege:** there is no admin or shared role in the module; the scope allows only the owner,
  and the `DenyAllGroupMembershipReader` means no group membership can widen it.

### `apps/api/src/goals/infrastructure/db/drizzle-goal-repository.ts`
- **Spoofing:** not applicable below the routes: the repository receives a scope already resolved from the
  session.
- **Tampering:** every statement filters on the owner in the same statement (`scopedTo`), so an id of another
  user matches nothing; a withdrawal and a create run in transactions with a row lock or an advisory lock, so
  concurrent requests cannot overdraw a goal or pass the 100-goal limit.
- **Repudiation:** writes are transactional and keyed by ids that appear in the audit lines; entries keep a
  `created_at` and are never edited.
- **Information Disclosure:** queries select only the columns the presenter needs, and progress is computed from
  the caller's own rows only.
- **Denial of Service:** the progress of all goals is one grouped statement, not one query per goal; the locks
  are held for one short transaction on one goal row or one owner key.
- **Elevation of Privilege:** a linked goal accepts no entries, so manual entries cannot be used to override an
  account-derived progress; the currency and the link cannot be changed after creation.

### `apps/api/src/goals/infrastructure/db/drizzle-account-balances.ts`
- **Spoofing:** it takes account ids that the use case has just checked against the caller's scope.
- **Tampering:** it is read-only: it never writes to accounts or movements, and a contribution to a goal never
  changes an account balance.
- **Repudiation:** it records nothing; the request logger records the route status.
- **Information Disclosure:** `findLinkable` is scoped to the owner, so a foreign account answers as missing;
  balances are returned only for ids of the caller's own goals.
- **Denial of Service:** account ids are read in chunks of at most 500, the same bound the accounts module uses,
  so one list never builds an unbounded statement over 100,000 movements.
- **Elevation of Privilege:** it cannot link a goal to an account the caller does not own; the composite foreign
  key `(linked_account_id, owner_id)` rejects it again in the database.

### `apps/api/src/goals/infrastructure/db/schema.ts`
- **Spoofing:** every row carries an owner id with a foreign key to users, so a row cannot exist without a real
  owner.
- **Tampering:** check constraints keep amounts above 0, the currency to ARS or USD, the kind to contribution or
  withdrawal and names to 1 to 80 characters; money columns are `bigint`, so a float or a rounding error cannot
  be stored.
- **Repudiation:** rows keep `created_at` and `updated_at` timestamps.
- **Information Disclosure:** no column holds a credential or a token; the goal name is the only free text and
  is user-private.
- **Denial of Service:** indexes on `(owner_id, created_at, id)` and `(goal_id, created_at, id)` keep the list
  and the entry history fast.
- **Elevation of Privilege:** the composite keys make the owner of a goal match the owner of its account and of
  its entries at the database level, so a bug in the application cannot attach another user's account or goal.

### `apps/api/src/goals/infrastructure/db/erase-user-goals.ts`
- **Spoofing:** it runs only inside the identity module's erasure transaction, with the id of the user being
  erased.
- **Tampering:** one delete statement in the same transaction removes the user's goals first, so the restricting
  key to accounts cannot block the erasure; if the erasure rolls back, so does this.
- **Repudiation:** account erasure is already recorded by the identity module.
- **Information Disclosure:** the user's goals and entries leave the database with the account; nothing is kept
  or copied.
- **Denial of Service:** one statement indexed by `owner_id`.
- **Elevation of Privilege:** it deletes only rows whose owner is the user being erased.

### `apps/api/src/accounts/infrastructure/db/drizzle-account-repository.ts`
- **Spoofing:** the account delete stays scoped to the owner; the change only maps a database error.
- **Tampering:** the restricting key stops an account that a goal links to from being deleted, so a linked
  goal's progress cannot be silently emptied by deleting its account.
- **Repudiation:** a rejected delete answers 409 and is logged by the request logger.
- **Information Disclosure:** the 409 answers only for the caller's own account, so it reveals nothing about
  other users' goals.
- **Denial of Service:** no extra query: the database key does the check in the delete statement.
- **Elevation of Privilege:** the constraint prefix mapping changes only the error code, not who may delete.

## Data classification
| Data | Class | At rest | In transit |
|---|---|---|---|
| Goal target amounts, entry amounts and derived progress | financial data (private to the owner) | stored in PostgreSQL as `bigint` minor units; managed database encryption at rest | HTTPS to the browser as decimal strings |
| Goal name and target date | PII (private to the owner) | stored in PostgreSQL; managed database encryption at rest | HTTPS to the browser |
| Link between a goal and an account | financial data (private to the owner) | stored in PostgreSQL as a composite foreign key | HTTPS to the browser as an account id |
| User time zone read to compute the current month | PII | stored in PostgreSQL on the user row | read server side only, never returned by this module |

## Risks and mitigations
| ID | Risk | STRIDE | Likelihood | Impact | Mitigation |
|---|---|---|---|---|---|
| R-01 | A user reads, edits or deletes another user's goal by guessing its id | I | Medium | High | Every repository method filters by the owner scope in the same statement and a miss answers the same 404 as an unknown id (Blocks 3, 4 and 5 tests) |
| R-02 | A user links a goal to another user's account to read its balance | I | Medium | High | The use case resolves the account inside the caller's scope (404), and the composite foreign key `(linked_account_id, owner_id)` rejects it again in the database (Blocks 2 and 4 tests) |
| R-03 | Concurrent withdrawals overdraw a goal, or concurrent creates pass the 100-goal limit | T | Medium | Medium | The goal row is locked for the check and the insert, the create takes an advisory lock on the owner, and concurrency tests run 20 times (Block 4) |
| R-04 | Money is stored or computed as a float and drifts | T | Low | High | `bigint` columns, bigint arithmetic, string amounts in JSON, an introspection test for float columns and a no-float source test (Blocks 2 and 7) |
| R-05 | A client sets progress, status or owner through the request body | T | Medium | High | Strict Zod objects reject unknown keys; progress, percentage, status and monthly amount are derived on read and are never inputs (Block 1) |
| R-06 | Deleting an account silently empties a linked goal, or account erasure fails because of the goal key | D | Medium | Medium | The restricting key rejects the account delete with 409 (Block 6), and `eraseUserGoals` runs before the user is deleted (Block 2) |
| R-07 | A large goal list or many entries slow the API for everyone | D | Low | Medium | Progress is one grouped statement plus chunked balance reads, the list is bounded to 100 goals, the history to 100 rows, and a performance test asserts p95 under 500 ms (Block 7) |
| R-08 | Goal names or amounts leak through logs | I | Low | Medium | Audit lines carry ids only, and a test asserts that no log line contains a name or an amount (Block 5) |

## Supply chain
No new runtime dependency: the module reuses Drizzle, Zod and Express already in the project, and the advisory
lock is plain SQL (spec D16).

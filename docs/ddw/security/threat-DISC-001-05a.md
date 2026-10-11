# Threat model DISC-001-05a: Groups, Members and Roles

| Field | Value |
|-------|-------|
| Ticket | DISC-001-05a |
| Spec | docs/ddw/specs/spec-DISC-001-05a.md |
| Tier | FEATURE |
| Date | 2026-10-10 |

## Components
| Component | Source in the spec |
|---|---|
| `apps/api/src/groups/infrastructure/http/group-routes.ts` | Block 5 |
| `apps/api/src/groups/application/group-access.ts` | Block 3 |
| `apps/api/src/groups/infrastructure/db/drizzle-group-repository.ts` | Block 4 |
| `apps/api/src/groups/infrastructure/crypto/random-token-source.ts` | Block 4 |
| `apps/api/src/groups/infrastructure/db/erase-user-groups.ts` | Block 4 |
| `apps/api/src/groups/infrastructure/db/schema.ts` | Block 2 |

## Trust boundaries
- Browser → API (`/groups` routes): untrusted JSON bodies, params and session cookies cross it; the
  shared `validate` middleware, `requireSession` and `requireVerifiedEmail` guard it.
- API → PostgreSQL: SQL statements and token hashes cross it; only parameterized Drizzle queries are
  built, and the database constraints (unique, check, foreign key) are the backstop.
- Group member → group data: an authenticated user is not yet a member of a given group; the
  `GroupAccess` guard decides per request who may read or change which group.
- Invitation or claim link holder → membership: whoever presents a token becomes a member or takes a
  ghost's place; the 256-bit single-purpose token is the only proof.
- Account erasure (identity module) → groups module: the erasure transaction calls
  `eraseUserGroups` before the user row is deleted.

## STRIDE analysis
### `apps/api/src/groups/infrastructure/http/group-routes.ts`
- **Spoofing:** every route sits behind `requireSession` and `requireVerifiedEmail`; the caller's id
  comes from the session, never from the body or a param. Tokens are carried in a POST body, so
  they never appear in the logged URL.
- **Tampering:** all params, query and body go through the shared Zod schemas with strict objects,
  so extra keys (such as `role` or `userId`) are rejected and cannot set a role or a member.
- **Repudiation:** audit lines carry the request id, the user id and the group id for every write;
  the full group activity log is DISC-001-05d. Lines never carry a token or a name.
- **Information Disclosure:** responses never include an email or a token hash; a non-member and an
  unknown group id get the same 404 body; every invalid token (unknown, expired, used) gets the same
  400, so the cases cannot be told apart.
- **Denial of Service:** the JSON body limit applies; ghost members are capped at the 50-member
  limit, and invitations are one per member (D16), so a member cannot grow the tables without bound.
- **Elevation of Privilege:** admin-only routes call the admin guard and answer 403 to a member; a
  member cannot make themselves admin because `role` is not an input of any route.

### `apps/api/src/groups/application/group-access.ts`
- **Spoofing:** it takes the user id from the authenticated context only.
- **Tampering:** it is read-only; membership is loaded from the database on every request, never
  from a client-supplied value or a cache.
- **Repudiation:** a denied access is logged by the request logger with the status code 404 or 403.
- **Information Disclosure:** a non-member gets `ResourceNotFound`, indistinguishable from a missing
  group, so group ids cannot be probed.
- **Denial of Service:** one indexed lookup by `(group_id, user_id)` per request.
- **Elevation of Privilege:** the admin check reads the stored role of the caller's own member row;
  a member id from a param is always resolved inside the caller's group, so a member id of another
  group cannot be reached.

### `apps/api/src/groups/infrastructure/db/drizzle-group-repository.ts`
- **Spoofing:** not applicable below the guard: the repository receives ids already authorized by
  the use cases.
- **Tampering:** the 50-member limit and the single-use claim are enforced in transactions (group
  row lock, `update … where used_at is null returning`), so concurrent requests cannot exceed the
  limit or reuse a claim; unique indexes are the backstop.
- **Repudiation:** writes are transactional and keyed by ids that appear in the audit lines.
- **Information Disclosure:** it stores only the SHA-256 hash of a token, so a database read does not
  yield a working link; queries select only the columns the presenter needs.
- **Denial of Service:** the locks are held for one short transaction on one group row; lists are
  bounded by 50 members per group.
- **Elevation of Privilege:** claiming only sets the user id of the ghost's own member row and keeps
  its role `member`; a check constraint forbids the admin role on a ghost.

### `apps/api/src/groups/infrastructure/crypto/random-token-source.ts`
- **Spoofing:** tokens are 32 bytes from `crypto.randomBytes` (256 bits), not guessable.
- **Tampering:** the value is generated server side and never accepted from the client.
- **Repudiation:** the creation of a link is logged with ids; the token itself is not.
- **Information Disclosure:** the raw token is returned once, in the creation response, and never
  stored or logged.
- **Denial of Service:** generation is a local call with no external service.
- **Elevation of Privilege:** a token grants only membership (invitation) or one ghost's identity
  (claim link), never a role.

### `apps/api/src/groups/infrastructure/db/erase-user-groups.ts`
- **Spoofing:** it runs only inside the identity module's erasure transaction, with the id of the
  user being erased.
- **Tampering:** one update statement in the same transaction turns the user's memberships into
  ghost members; if erasure rolls back, so does this.
- **Repudiation:** account erasure is already recorded by the identity module.
- **Information Disclosure:** the member's link to the user is removed, so a deleted user's identity
  does not stay in the group; the display name becomes "Former member".
- **Denial of Service:** one statement indexed by `user_id`.
- **Elevation of Privilege:** the converted member gets the role `member`, so no admin power is left
  without a registered holder.

### `apps/api/src/groups/infrastructure/db/schema.ts`
- **Spoofing:** the unique `(group_id, user_id)` index prevents a second membership of one user.
- **Tampering:** check constraints forbid a ghost admin, a member with both a user and a name, and
  out-of-range names; the foreign key from members to users restricts deletion.
- **Repudiation:** rows keep `created_at` and `joined_at` timestamps.
- **Information Disclosure:** token columns hold hashes only.
- **Denial of Service:** indexes on `user_id` and on `(group_id, joined_at, id)` keep the membership
  lookups and lists fast.
- **Elevation of Privilege:** unique token hashes and the partial unique index of unused claim links
  stop two live links for one ghost.

## Data classification
| Data | Class | At rest | In transit |
|---|---|---|---|
| Invitation and claim tokens (raw, in a response once) | credentials | never stored; only the SHA-256 hash is | HTTPS only; sent in a response body and in a POST body, never in a URL or a log line |
| Token hashes | credentials | stored in PostgreSQL columns with unique indexes; managed database encryption at rest | TLS between the API and the database |
| Member display names and ghost names | PII | stored in PostgreSQL; managed database encryption at rest | HTTPS to the browser |
| User id and role of a member | PII | stored in PostgreSQL; managed database encryption at rest | HTTPS to the browser |
| Group name and default rate type | public | stored in PostgreSQL | HTTPS to the browser |

## Risks and mitigations
| ID | Risk | STRIDE | Likelihood | Impact | Mitigation |
|---|---|---|---|---|---|
| R-01 | A member or outsider reads or changes another group's data by guessing a group or member id | I | Medium | High | Every use case runs the `GroupAccess` guard first; a non-member gets the same 404 as a missing group; member ids are resolved inside the caller's group (Blocks 3 and 5 tests) |
| R-02 | A leaked invitation link lets strangers join | S | Medium | High | 256-bit random token stored as a hash, 7-day expiry, a new invitation replaces the old one so a leak is revoked (D16), the 50-member limit bounds the damage |
| R-03 | Two people claim the same ghost, or one claim link is reused | T | Medium | High | Atomic `update … where used_at is null returning` and a unique index on unused links; a concurrency test runs 20 times (Block 4) |
| R-04 | A member floods the database with invitations or ghosts | D | Medium | Medium | One invitation per member (D16), ghosts and members capped at 50 per group by a locked count (D6) |
| R-05 | A member promotes themselves or a ghost to admin | E | Low | High | `role` is not an input of any route; only the admin-guarded route changes it; a check constraint forbids a ghost admin |
| R-06 | Tokens leak through logs or URLs | I | Medium | High | Tokens travel in a POST body and the audit lines carry ids only; a test asserts that no log line contains a token (Block 5) |
| R-07 | Account deletion fails or leaves an admin-less identity trail in a group | E | Low | Medium | `eraseUserGroups` turns memberships into ghosts "Former member" with the role `member` inside the erasure transaction, tested in Block 4; the rule for a group left without an admin is parent pending decision 2 |
| R-08 | Members see each other's display names | I | Low | Low | The API never returns an email; the display name is the only identifier shared with members of the same group, as the PRD intends |

## Supply chain
No new runtime dependency: tokens use the Node `crypto` built-in, and the module reuses Drizzle,
Zod and Express already in the project (spec D14).

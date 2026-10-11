# Threat model DISC-001-04e: Conflicts on Group Movements

| Field | Value |
|-------|-------|
| Ticket | DISC-001-04e |
| Spec | docs/ddw/specs/spec-DISC-001-04e.md |
| Tier | FEATURE |
| Date | 2026-10-11 |

## Components
| Component | Source in the spec |
|---|---|
| `packages/shared/src/groups/conflict.ts` | Block 1 |
| `apps/api/src/groups/infrastructure/db/schema.ts` | Block 2 |
| `apps/api/src/groups/application/update-group-expense.ts` | Block 3 |
| `apps/api/src/groups/infrastructure/db/drizzle-group-expense-repository.ts` | Block 3 |
| `apps/api/src/groups/infrastructure/http/group-routes.ts` | Block 4 |
| `apps/web/src/lib/local-store/group-queue.ts` | Block 6 |
| `apps/web/src/lib/sync/sync-pass.ts` | Block 7 |
| `apps/web/src/features/groups/components/group-conflict-view.tsx` | Block 8 |

## Trust boundaries
- Browser → API (`PUT`, `PATCH`, `DELETE` on group expenses and settlements): untrusted bodies,
  queries, params and session cookies cross it; the shared `validate` middleware, `requireSession`
  and `requireVerifiedEmail` guard it.
- API → PostgreSQL: parameterized Drizzle statements cross it; the check on `version`, row locks and
  the group lock are the backstop.
- Group member → group data: `GroupAccess` and the 05d permission rule decide per request, before
  any version comparison.
- Browser tab → local IndexedDB: the queue holds a user's pending group changes and the server copy
  of a record in conflict; it is wiped on sign out by the 04d wipe.

## STRIDE analysis
### `packages/shared/src/groups/conflict.ts` and `apps/api/src/groups/infrastructure/http/group-routes.ts`
- **Spoofing:** the caller comes from the session; the base version never identifies anyone.
- **Tampering:** strict schemas reject a missing, zero, negative, fractional or oversized
  `baseVersion`; a client cannot send a future version and win (refused as a conflict).
- **Repudiation:** audit lines carry request id, user id, group id, record id and both versions; an
  applied change still writes its activity log row.
- **Information Disclosure:** the conflict body holds the server record only after group access and
  the permission rule passed, so a non-member or a member without edit rights gets 404 or 403, never
  the record through a conflict.
- **Denial of Service:** no new work per request beyond one integer comparison; body limits apply.
- **Elevation of Privilege:** the permission rule runs before the comparison, so `baseVersion`
  cannot be used to probe records the caller may not change.

### `apps/api/src/groups/application/update-group-expense.ts` and `apps/api/src/groups/infrastructure/db/drizzle-group-expense-repository.ts`
- **Spoofing:** not applicable below the guard.
- **Tampering:** the comparison and the write happen inside one transaction under the group lock, so
  two writers cannot both pass the check; the counter grows by one per applied change.
- **Repudiation:** a conflict writes nothing, so no change appears without a cause in the log.
- **Information Disclosure:** every query filters by group id; the conflict carries the group's own
  record.
- **Denial of Service:** the lock is held for one short transaction.
- **Elevation of Privilege:** group id and record id are checked together, so another group's record
  cannot be reached by id.

### `apps/api/src/groups/infrastructure/db/schema.ts`
- **Spoofing:** not applicable.
- **Tampering:** a check keeps `version` at 1 or more; the default gives existing rows version 1.
- **Repudiation:** not applicable.
- **Information Disclosure:** the column holds a counter only.
- **Denial of Service:** adding a column with a constant default is a metadata change on current
  PostgreSQL, no table rewrite.
- **Elevation of Privilege:** not applicable; the rollback drops only the two columns.

### `apps/web/src/lib/local-store/group-queue.ts` and `apps/web/src/lib/sync/sync-pass.ts`
- **Spoofing:** queue records are keyed by user through the existing session pointer and wipe.
- **Tampering:** a 409 counts as a conflict only when its body parses as the conflict schema; a
  forged or malformed body is a generic failure and never discards the local change.
- **Repudiation:** not applicable on the device; the server log is authoritative.
- **Information Disclosure:** the server copy stays in the local store only until resolved or until
  sign out wipes it; nothing is written to logs or analytics.
- **Denial of Service:** a conflicted record is skipped by later passes, so a stuck conflict cannot
  loop requests; network failures keep the 04c backoff.
- **Elevation of Privilege:** the client never sends another user's identity; permission is decided by
  the server.

### `apps/web/src/features/groups/components/group-conflict-view.tsx`
- **Spoofing:** not applicable.
- **Tampering:** both buttons call local operations that run as one IndexedDB transaction, so an
  interruption cannot leave neither version.
- **Repudiation:** the applied "keep mine" is a normal change and is logged by the server.
- **Information Disclosure:** the view shows group data to a member of that group on their own
  device.
- **Denial of Service:** not applicable.
- **Elevation of Privilege:** not applicable; the server re-checks everything on resend.

## Data classification
| Data | Class | At rest | In transit |
|---|---|---|---|
| Expense and settlement amounts, descriptions, shares | financial | PostgreSQL, managed encryption at rest | HTTPS only |
| Version counter | internal | PostgreSQL | HTTPS only |
| Queued change and server copy in conflict | financial | IndexedDB on the user's device, wiped on sign out | not applicable |
| Audit lines | internal | ids and versions only, no amounts or descriptions | log pipeline |

## Risks and mitigations
| ID | Risk | STRIDE | Likelihood | Impact | Mitigation |
|---|---|---|---|---|---|
| R-01 | A stale change overwrites another member's work | T | High | High | Required `baseVersion`, comparison under the group lock, 409 with nothing written (Blocks 3, 4) |
| R-02 | A conflict reveals a record to someone without access | I | Low | High | Guard and permission rule run before the comparison (Block 3 tests) |
| R-03 | A client forces a write with a future or missing version | T | Medium | High | Missing is 400, future is a conflict (Blocks 1, 3 tests) |
| R-04 | The user loses a version before choosing | T | Medium | High | One IndexedDB transaction per resolution, 1,000-interruption test (Block 6) |
| R-05 | A forged 409 body makes the client drop a local change | T | Low | Medium | The body must parse as the conflict schema, else it is a failure (Block 5 test) |
| R-06 | Conflict retried in a loop | D | Medium | Low | Conflicted records are skipped by passes until resolved (Block 7 test) |
| R-07 | Sensitive text reaches logs | I | Medium | Medium | Audit lines carry ids and versions only; a test asserts it (Block 4) |
| R-08 | Migration blocks writes on a large table | D | Low | Medium | Constant default, metadata-only change; rollback tested (Block 2) |

## Supply chain
No new runtime dependency (spec D7); the work reuses Drizzle, Zod, Express and the existing
IndexedDB layer.

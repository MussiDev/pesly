# Threat model DISC-001-03d: Tags and Filters

| Field | Value |
|-------|-------|
| Ticket | DISC-001-03d |
| Spec | docs/ddw/specs/spec-DISC-001-03d.md |
| Tier | FEATURE |
| Date | 2026-10-02 |

## Components
| Component | Source in the spec |
|---|---|
| `packages/shared/src/movements/tag.ts` and `packages/shared/src/movements/movement-filters.ts` | Block 1 |
| `apps/api/src/movements/application/list-movements.ts` and `apps/api/src/movements/application/local-day-range.ts` | Block 2 |
| `apps/api/src/movements/infrastructure/db/drizzle-movement-repository.ts` and `apps/api/src/movements/infrastructure/db/drizzle-movement-filters.ts` | Block 3 |
| `apps/api/src/movements/infrastructure/db/drizzle-tag-repository.ts` | Block 3 |
| `apps/api/src/movements/infrastructure/db/tags-schema.ts` and `apps/api/drizzle/0017_tags.sql` | Block 3 |
| `apps/api/src/movements/infrastructure/http/movement-routes.ts` and `apps/api/src/movements/infrastructure/http/tag-routes.ts` | Block 4 |
| `apps/web/src/features/movements/containers/tag-input-container.tsx` and `apps/web/src/features/movements/components/tag-input.tsx` | Block 5 |
| `apps/web/src/features/movements/containers/movements-container.tsx` and `apps/web/src/features/movements/movement-filters-state.ts` | Block 6 |

## Trust boundaries
- Browser → API: `POST /movements` carries tags, `GET /movements` carries the filters and `GET /tags` carries the prefix over the public internet, all as untrusted text, behind the session cookie.
- API routes → use cases: validated, typed values cross from the Express layer into the application layer; nothing else does.
- Application → PostgreSQL: owner-scoped statements with bound parameters cross into the private database network, where the composite foreign keys and checks are the last line of defense.
- URL → web container: the filter values in the address bar are untrusted input to the list container and can be edited or shared by the user.

## STRIDE analysis
### `packages/shared/src/movements/tag.ts` and `packages/shared/src/movements/movement-filters.ts`
- **Spoofing:** the schemas hold no identity; the owner is never read from a tag or a filter value, only from the session scope.
- **Tampering:** NFC normalization, trimming and rejection of control and format characters stop invisible or mixed-form tag spellings from creating look-alike tags; dates and ids are parsed strictly.
- **Repudiation:** not applicable to a schema; the routes log ids only (see the routes below).
- **Information Disclosure:** a schema failure names the field path and never echoes the tag or filter value.
- **Denial of Service:** at most 10 tags of at most 30 code points per request and a prefix of at most 30 code points bound the work a request can ask for.
- **Elevation of Privilege:** the filter shape has no field that widens the owner scope; unknown keys are stripped.

### `apps/api/src/movements/application/list-movements.ts` and `apps/api/src/movements/application/local-day-range.ts`
- **Spoofing:** the use case takes the scope built by the access policy from the session and never an owner id from the query.
- **Tampering:** the local-day conversion is deterministic and uses the user's stored time zone, so a caller cannot widen the interval beyond the days they typed.
- **Repudiation:** failures propagate to the error middleware, which logs the request id without the filter values.
- **Information Disclosure:** the time zone is read only from the caller's own preferences row.
- **Denial of Service:** the page guard (1 to 100) stays in force with filters and a `from` after the `to` is refused before any query runs.
- **Elevation of Privilege:** the use case passes the caller's scope to the repository unchanged, so another user's scope can never be built from request data.

### `apps/api/src/movements/infrastructure/db/drizzle-movement-repository.ts` and `apps/api/src/movements/infrastructure/db/drizzle-movement-filters.ts`
- **Spoofing:** every statement takes the owner from the scope through `scopedTo`, including the subqueries on `categories`, `tags` and `movement_tags`.
- **Tampering:** values reach the database only as bound parameters; the movement and its tag links are written in one transaction, so a partial write rolls back.
- **Repudiation:** the creation line logs the movement id only, so the audit trail exists without amounts, notes or tag names.
- **Information Disclosure:** a foreign account, category or tag id matches no row of the caller, so the answer is the same empty page as for a filter with no matches and nothing about the other user's data is revealed (R-02).
- **Denial of Service:** the new composite indexes keep combined filters on a date-ordered index; the performance test measures p95 with 100,000 movements (R-05).
- **Elevation of Privilege:** a link to a tag or movement of another owner is impossible because the composite foreign keys carry the owner (R-01).

### `apps/api/src/movements/infrastructure/db/drizzle-tag-repository.ts`
- **Spoofing:** the suggestion query filters `tags.owner_id` by the scope's user in the same statement.
- **Tampering:** `%`, `_` and the backslash in the prefix are escaped so the prefix cannot become a wider pattern (R-03).
- **Repudiation:** suggestion reads are not logged with the prefix.
- **Information Disclosure:** only the caller's tag names are returned, at most 20, so the endpoint cannot enumerate other users' tags.
- **Denial of Service:** the page is capped at 20 and the prefix match uses the `text_pattern_ops` index per owner.
- **Elevation of Privilege:** no parameter selects another owner and the response has no ids.

### `apps/api/src/movements/infrastructure/db/tags-schema.ts` and `apps/api/drizzle/0017_tags.sql`
- **Spoofing:** `owner_id` is required on `tags` and `movement_tags` and tied to `users` and to the movement by foreign keys.
- **Tampering:** checks on the name length (1 to 30) and on `position` (0 to 9) and the unique index on `(owner_id, lower(name))` hold even if the application is bypassed.
- **Repudiation:** rows carry `created_at`; edits and removal of tags belong to DISC-001-03e.
- **Information Disclosure:** tag names are personal free text, classified as PII below, and live only in tables reachable through owner-scoped repositories.
- **Denial of Service:** the database caps a movement at 10 links and each user's tag growth is bounded by their own creation limit of 60 movements per minute (R-06).
- **Elevation of Privilege:** the new unique constraint on `movements(id, owner_id)` adds no privilege and the migration is additive; the rollback only drops tag data.

### `apps/api/src/movements/infrastructure/http/movement-routes.ts` and `apps/api/src/movements/infrastructure/http/tag-routes.ts`
- **Spoofing:** both routes sit behind `requireSession` and `requireVerifiedEmail`, and the scope comes from the session.
- **Tampering:** the shared validation middleware rejects an invalid body, query or param before any handler runs; no handler reads `req.query` or `req.body` unvalidated.
- **Repudiation:** the creation and error logs hold the request id, user id and movement id only, never a tag, a prefix or a filter value (R-08).
- **Information Disclosure:** responses are validated against the shared response schemas; a failure answers a generic 500 with no value in the body.
- **Denial of Service:** the page cap of 100, the suggestion cap of 20 and the existing creation limit bound the cost of each call (R-05).
- **Elevation of Privilege:** an unauthenticated or unverified caller is refused with 401 or 403 before the use case runs.

### `apps/web/src/features/movements/containers/tag-input-container.tsx` and `apps/web/src/features/movements/components/tag-input.tsx`
- **Spoofing:** the client holds no identity beyond the session cookie the API client already sends.
- **Tampering:** a typed or suggested tag is rendered as text by React, never as HTML, so a tag cannot inject markup (R-07); the server remains the authority on the limits.
- **Repudiation:** nothing is logged client side.
- **Information Disclosure:** suggestions come only from the caller's own tags and failed requests show no detail.
- **Denial of Service:** the 250 ms debounce and the discard of stale answers bound the suggestion traffic of one typist.
- **Elevation of Privilege:** the component sends nothing that selects an owner.

### `apps/web/src/features/movements/containers/movements-container.tsx` and `apps/web/src/features/movements/movement-filters-state.ts`
- **Spoofing:** a shared or edited URL cannot make the list show another user's data because the owner scope is applied by the API from the session.
- **Tampering:** a malformed filter value in the URL is ignored and a `from` after the `to` is refused before a request is sent.
- **Repudiation:** nothing is logged client side.
- **Information Disclosure:** filter values (tag names, ids) live in the address bar and browser history; the existing referrer policy keeps them from leaving the site (R-10).
- **Denial of Service:** a stale answer for older filters is discarded and "show more" keeps the page size at 100.
- **Elevation of Privilege:** a hand-edited account, category or tag in the URL only yields an empty page.

## Data classification
| Data | Class | At rest | In transit |
|---|---|---|---|
| Tag names (free text chosen by the user) | PII | PostgreSQL volume encrypted at rest; 1 to 30 code points, no control characters; only reachable through the owner-scoped repositories | TLS (production HTTPS guard) |
| Tag-to-movement links (movement id, tag id, owner id, position) | financial | PostgreSQL volume encrypted at rest; composite foreign keys keep them under one owner | private database network |
| Filter values (account, category, type, dates, tag) | PII | not stored; they travel in the query string and the address bar | TLS, and the referrer policy keeps the URL from other sites |
| Movement amount, date, account and category ids | financial | PostgreSQL volume encrypted at rest; unchanged by this ticket | TLS |
| Session cookie presented to the routes | credentials | not stored by this module; the identity module stores it hashed | TLS, cookies flagged Secure in production |

## Risks and mitigations
| ID | Risk | STRIDE | Likelihood | Impact | Mitigation |
|---|---|---|---|---|---|
| R-01 | A tag, a link or a movement of another owner is linked or read through a forged id | E | Low | High | Owner on every statement and subquery through `scopedTo`, and composite foreign keys `(movement_id, owner_id)` and `(tag_id, owner_id)` that make a cross-owner link impossible (Blocks 3, 4) |
| R-02 | A foreign account, category or tag filter lets a caller learn that another user's data exists | I | Medium | Medium | The filter is ANDed with the owner scope, so a foreign id returns the same 200 and empty page as a filter with no matches, and a test asserts the bodies are byte-identical (Blocks 3, 4) |
| R-03 | A suggestion prefix with `%` or `_` becomes a wide pattern and scans or leaks | T | Medium | Low | Escape the backslash, `%` and `_`, cap the page at 20, use the per-owner prefix index (Block 3) |
| R-04 | SQL injection through a filter, a tag or a prefix | T | Low | Critical | Strict shared schemas (UUIDs, real dates, enums, tag rules) and bound parameters only, with no raw string concatenation in the filter builder (Blocks 1, 3) |
| R-05 | The filtered list is slow or exhausts the database at 100,000 movements | D | Medium | Medium | New composite indexes by account and by category with the date order, page cap 100, one statement per list plus one tag query, and a p95 test under 500 ms including the plan check (Blocks 3, 7) |
| R-06 | A user floods the tags table with unique tag names | D | Low | Low | At most 10 tags per movement, and creation is already limited to 60 per minute per user; growth is bounded by the caller's own writes and removed with the user (Blocks 3, 4) |
| R-07 | A tag holding markup runs as script in the list or the form | T | Low | High | Tags are rendered as React text, control and format characters are rejected, and the content security policy of the web app stays in force (Blocks 1, 5, 6) |
| R-08 | Tag names or filters leak into logs or error bodies | I | Medium | Medium | Routes log ids only, schema errors name paths and never values, the 500 body is generic, and a test checks the log and body (Block 4) |
| R-09 | Two spellings that JavaScript keeps apart and PostgreSQL folds together create a duplicate link or a failed insert | T | Low | Low | The repository resolves tags by the database key and collapses repeated tag ids before linking (Block 3) |
| R-10 | Filter values in the address bar leak through the Referer header or browser history | I | Low | Low | The web app's referrer policy keeps the URL from other sites; history is the user's own device (Block 6) |

## Supply chain
There are no new runtime dependencies: the work uses Zod, Drizzle, Express, React and next-intl, which the project already has, and the native `Intl` for time zones. No external service is called.

## Availability
The vectors are an expensive filtered list, the suggestion endpoint and tag-table growth, covered by R-05, R-03 and R-06: indexes, page caps of 100 and 20, the debounce, and the existing per-user creation limit. The migration is additive and the rollback file removes only tag data, so a failed deploy does not lose movements.

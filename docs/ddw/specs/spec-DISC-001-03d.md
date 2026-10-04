# Spec DISC-001-03d: Tags and Filters

| Field | Value |
|-------|-------|
| Ticket | DISC-001-03d |
| PRD | docs/ddw/prd/prd-DISC-001-03d.md |
| Tier | FEATURE |
| Date | 2026-10-02 |
| Spec loops | 2 |
| Loops since last human decision | 0 |

## Summary
Tags become a per-user relation: `tags` holds one row per distinct tag of a user (unique on the owner and the lower-cased name), and `movement_tags` links a movement to up to 10 of them. Both relations carry the owner and reference each other and `movements` with composite foreign keys, so the database itself keeps a tag, a movement and the link under one owner (NFR-04). `POST /movements` accepts an optional `tags` list that is stored in the same transaction as the movement; `GET /tags?prefix=` suggests the caller's existing tags; `GET /movements` gains the optional filters `accountId`, `categoryId`, `from`, `to`, `type` and `tag`, which are ANDed with the owner scope in one statement. A parent category filter expands to the parent and its subcategories inside that statement (categories have one level only). Everything is additive: new shared files, new optional query and body fields, a new `tags` field on the movement response, a new migration, new web components next to the list. A foreign account, category or tag id is a valid filter that simply matches nothing of the caller's, so the answer is an empty page that is indistinguishable from "no matches" (AC-07).

Human decisions of 2026-10-02 folded into this version: Q1 option (a), Q2 option (a), Q3 confirmed (the AC-07 carve-out), spec and threat model approved.

Decisions recorded in this spec:
- **Tag display (human decision Q1, option a):** `tags.name` stores the spelling of the first use; later uses with another case reuse the stored tag and display its spelling. Comparison, suggestions and filters use `lower(name)`.
- **Duplicates inside one movement (human decision Q2, option a):** a request carries at most 10 entries; entries equal after case folding collapse into the first spelling, so `["Trip","trip"]` stores one tag.
- **AC-07 and the 404 rule (explicit carve-out, confirmed by human decision Q3):** AGENTS.md says data that is not the user's answers 404. That rule is about addressing a resource (`GET /movements/:id`). A filter value is a predicate over the caller's own set, so a foreign, unknown or deleted account, category or tag id answers 200 with an empty page, byte-identical to a filter that matches nothing; a 404 would be an existence oracle. This follows the PRD wording of AC-07 ("show no movements").
- A date filter is a local calendar day in the user's time zone (`from` and `to` inclusive, `YYYY-MM-DD`), converted to a half-open UTC interval on the server (PRD 01, FR-24).
- One tag per filter (the PRD names "a tag"); a filter by several tags is not in scope.
- Overlap with DISC-001-03c, kept additive: the shared `movement.ts` (one optional field on the create request, one on the response, the filter shape on the list query), the `MovementRepository` port and `Movement` type (a `tags` field and a `filters` option), the list route and container (one import and one wiring each), and the `type` filter, which uses the movement types that exist when this ships and must be widened by whichever ticket merges second. Everything else is in new files.

## Coverage: PRD → blocks
| Requirement | Covered by |
|---|---|
| FR-01 | Block 1, Block 2, Block 3, Block 4, Block 5 |
| FR-02 | Block 1, Block 2, Block 3, Block 4, Block 5 |
| FR-03 | Block 1, Block 2, Block 3, Block 4, Block 6 |
| FR-04 | Block 3, Block 4, Block 6 |
| NFR-01 | Strategy: a new composite index per equality filter keeps the planner on an index ordered by date, the filter set is one statement with no per-row call, and the tags of a page are loaded by one `in` query; a performance test with 100,000 movements and combined filters measures p95 (Blocks 3, 7) |
| NFR-02 | Strategy: the existing `limit` 1 to 100 rule of `listMovementsQuerySchema` and the use case guard stay in force with filters; the suggestion route caps its page at 20 (Blocks 1, 2, 4) |
| NFR-03 | Strategy: one shared tag schema (NFC, trim, 1 to 30 code points, no control or format characters) used by the request and the filter, a database check on `char_length(name)`, and a unique index on `(owner_id, lower(name))` for the case-insensitive comparison (Blocks 1, 3) |
| NFR-04 | Strategy: `tags` and `movement_tags` carry `owner_id`; composite foreign keys tie a link to a movement and a tag of the same owner; every statement applies `scopedTo(scope, { owner })` in the same query, including the subqueries on `tags` and `categories`; evidence is AC-07 and the other-owner tests (Blocks 3, 4) |

## Dependencies between blocks
Block 1 (shared contracts) first. Block 2 (domain, ports and use cases) needs Block 1. Block 3 (persistence, migration 0017, repositories) needs Blocks 1 and 2. Block 4 (HTTP and composition) needs Blocks 2 and 3. Block 5 (web tag entry) needs Blocks 1 and 4. Block 6 (web filters on the list) needs Blocks 4 and 5. Block 7 (performance, end-to-end, scans) is last.
Execution order: 1, 2, 3, 4, then 5, then 6, then 7. Block 3 starts after DISC-001-03b is on `main`, which it is (migration 0014 exists). The migration is numbered 0017 because 07b takes 0015 and 03c takes 0016 (human instruction 2026-10-02); at merge time it takes the next free number; its journal `when` must exceed the maximum on `main` at merge time and is never lowered.

## Block 1 — Shared contracts

**Files**
- `packages/shared/src/movements/tag.ts` (new) — `MOVEMENT_TAG_MAX_LENGTH` (30), `MOVEMENT_TAGS_MAX_COUNT` (10), `movementTagSchema`, `movementTagsSchema`, `tagSuggestionsQuerySchema`, `tagSuggestionsResponseSchema`.
- `packages/shared/src/movements/movement-filters.ts` (new) — `movementFilterShape` (the optional filter fields) and the local-date schema.
- `packages/shared/src/movements/movement.ts` (modified) — `createMovementRequestSchema` gains `tags: movementTagsSchema.optional()`, `movementResponseSchema` gains `tags: z.array(z.string())`, `listMovementsQuerySchema` is `.extend(movementFilterShape)` and the `from` not after `to` refinement is applied after the extend (a refinement before an extend does not compose in Zod).
- `packages/shared/src/index.ts` (modified) — exports the two new files.
- `packages/shared/test/movement-tags.test.ts`, `packages/shared/test/movement-filters.test.ts` (new); `packages/shared/test/movement-schemas.test.ts` (modified — the response and list query assertions).

**Logic**
`movementTagSchema` is a string: control and format characters are rejected before trimming (as for notes), the text is NFC-normalized and trimmed, and it must have 1 to 30 code points. `movementTagsSchema` is an array of at most 10 such strings whose entries equal after case folding (`toLowerCase`) collapse into the first spelling, in order; the count limit applies to the entries received, before collapsing, so an 11th entry is rejected even when it repeats another. The filter shape adds, all optional: `accountId` and `categoryId` (UUIDs), `type` (a movement type), `tag` (a `movementTagSchema` value), and `from` and `to` (`YYYY-MM-DD` real calendar days between 1970 and 2100); when both are present `from` must not be later than `to`. `tagSuggestionsQuerySchema` is `prefix` (the tag rules, 1 to 30 code points) and `limit` (1 to 20, default 10, blank rejected like the movement list). Unknown keys are stripped, as everywhere else.

**API contract**
Contract shapes only; the routes that serve them are in Block 4.
- Method + path: `GET /movements` (query adds `accountId`, `categoryId`, `type`, `tag`, `from`, `to`), `GET /tags` (query is `prefix`, `limit`), `POST /movements` (body adds `tags`, an array of 0 to 10 strings).
- Request: the query and body fields above, each optional.
- Response: the movement response adds `tags` (array of strings in the order stored); the suggestions response is `{ items: string[] }`.
- Error codes: a request that breaks a schema answers 400 `VALIDATION_FAILED`.
- Auth: unchanged, a session and a verified email (Block 4).

**Data model**
No storage here. The wire shapes: `tags` on the request is optional with an empty default; `tags` on the response is never null; each tag string is not nullable, has a check of 1 to 30 code points and is unique per movement after case folding; the filter fields are all nullable by being absent.

**Input validation**
Tag: string of 1 to 30 code points after NFC and trim, no control or format characters. Tags array: at most 10 entries. `accountId`, `categoryId`: UUID. `type`: `expense` or `income`. `from`, `to`: a real `YYYY-MM-DD` between 1970 and 2100, `from` not after `to`. `prefix`: same as a tag. `limit` of the suggestions: integer 1 to 20.

**Error handling**
- A tag that is empty after trimming, longer than 30 code points or holding a control or format character fails the schema, naming the field path and never the value.
- An 11th entry in `tags` fails the schema.
- A filter with an impossible date (`2026-02-30`), a date outside 1970 to 2100, a `from` later than `to`, a malformed UUID or an unknown `type` fails the query schema.
- A suggestions `prefix` that is empty, blank or longer than 30 code points, and a `limit` of 0, 21 or blank, fail the query schema.

**Required tests**
- [ ] a request with 1 and with 10 tags parses and keeps the order and the first spelling of repeated entries ("Trip","trip" gives one) — validates AC-03
- [ ] an 11th entry is rejected, and so are 11 entries where two repeat each other (invalid input) — validates AC-04
- [ ] an empty tag, a blank tag, a tag of 31 code points and a tag with a control character are rejected, a tag of 30 and a tag of 1 code point pass (invalid input) — validates AC-06
- [ ] `Árbol` typed decomposed and composed is the same tag after NFC, and "VIAJE" and "viaje" collapse (case-insensitive comparison) — validates AC-03
- [ ] the list query accepts each filter alone and all together, still defaults to limit 50 and rejects 101 — validates AC-01
- [ ] an impossible date, a date outside the range, a `from` after the `to`, a malformed UUID and an unknown type are rejected (invalid input) — validates AC-01
- [ ] a prefix that is empty, blank or over 30 code points, and a limit of 0, 21 or blank, are rejected (invalid input) — validates AC-05
- [ ] the filter schema accepts exactly the movement types that exist and a probe fails when `MOVEMENT_TYPES` holds a value the `type` filter does not accept (guards the overlap with DISC-001-03c) — validates AC-01
- [ ] the movement response schema requires the `tags` array, and the old create body without `tags` still parses — validates AC-03

**Completion criterion**
The shared tests pass, `pnpm typecheck` passes and `@pesly/shared` exports the tag and filter schemas and constants.

## Block 2 — Domain, ports and use cases

**Files**
- `apps/api/src/movements/domain/movement.ts` (modified) — `Movement` and `NewMovement` gain `tags: string[]`; a `MovementFilters` type is added.
- `apps/api/src/movements/application/ports/movement-repository.ts` (modified) — `insert` stores `NewMovement.tags`; `list` takes `{ limit, offset, filters }`.
- `apps/api/src/movements/application/ports/tag-repository.ts` (new) — `TagRepository.suggest(scope, prefix, limit): Promise<string[]>`.
- `apps/api/src/movements/application/create-movement.ts` (modified) — passes the tags through.
- `apps/api/src/movements/application/list-movements.ts` (modified) — validates the page, turns the local dates into a UTC interval with the user's time zone and passes the filters.
- `apps/api/src/movements/application/suggest-tags.ts` (new) — `SuggestTags`.
- `apps/api/src/movements/application/local-day-range.ts` (new) — `localDayRange(from, to, timeZone)`.
- `apps/api/test/movements/fakes.ts` (modified) — the in-memory repository learns tags and filters, and a tag repository fake.
- `apps/api/test/movements/create-movement.test.ts`, `apps/api/test/movements/list-and-get-movement.test.ts` (modified); `apps/api/test/movements/suggest-tags.test.ts`, `apps/api/test/movements/local-day-range.test.ts` (new).

**Logic**
`CreateMovement` forwards `input.tags ?? []` unchanged (already normalized by the schema); it adds no new rule and never touches the limiter. `MovementFilters` is `{ accountId?, categoryId?, type?, tag?, occurredFrom?: Date, occurredBefore?: Date }`. `ListMovements.execute(scope, { limit, offset, accountId, categoryId, type, tag, from, to })` keeps the page guard, gains the `UserPreferences` dependency (its dependencies change from `{ movements }` to `{ movements, preferences }`, and the route wiring changes with them) and reads the user's time zone only when `from` or `to` is present, and calls `localDayRange`, which returns `occurredFrom` (the start of the local day of `from`) and `occurredBefore` (the start of the local day after `to`) as instants; it uses `zonedLocalToInstant` and, when `zonedLocalToInstant` returns `null` because midnight does not exist in the zone, it tries 01:00, then 02:00 and so on until the first valid hour of that day. A `from` later than `to` throws `AppError('VALIDATION_FAILED')`. `SuggestTags.execute(scope, { prefix, limit })` validates the limit (1 to 20) and calls the port. Domain and application stay free of `drizzle-orm`, `pg`, `express` and `node:*`.

**Data model**
No storage change. `Movement.tags` is a required array of strings (default empty, never null) and `NewMovement.tags` is the same; `MovementFilters` has only optional fields (nullable by absence), where `occurredFrom` is inclusive and `occurredBefore` exclusive; there is no unique or index concern in this block.

**Input validation**
The use cases receive values already parsed by the shared schemas and still guard what a direct caller could break: `limit` 1 to 100 and `offset` at least 0 for the list, `limit` 1 to 20 for suggestions, and `from` not later than `to`; the format of tags, ids and dates is owned by Block 1.

**Error handling**
- A `from` later than `to` that reaches the use case answers `VALIDATION_FAILED` and the repository is not called.
- A page out of range (limit 0 or above 100, negative offset) still answers `VALIDATION_FAILED`, with or without filters.
- A suggestion limit outside 1 to 20 answers `VALIDATION_FAILED`.
- A failing repository or preferences port is not swallowed: the error propagates to the HTTP error middleware.

**Required tests**
- [ ] creating a movement with tags passes them to the repository, and without tags passes an empty list — validates AC-03
- [ ] listing with every filter passes the account, category, type, tag and the UTC interval of the local days to the repository — validates AC-01
- [ ] `localDayRange` returns the Buenos Aires day boundaries (UTC-3) for `from` and `to`, and a day whose midnight does not exist in a zone with daylight-saving time starts at the first valid hour, where `zonedLocalToInstant` returns null for 00:00 (fixed past fixture) — validates AC-01
- [ ] `from` later than `to` answers `VALIDATION_FAILED` and does not call the repository (invalid input) — validates AC-01
- [ ] a page out of range with filters answers `VALIDATION_FAILED` (invalid input) — validates AC-01
- [ ] the suggestion use case passes the scope, prefix and limit to the port, and a limit of 0 or 21 answers `VALIDATION_FAILED` (invalid input) — validates AC-05
- [ ] a repository failure during listing, creation and suggestion propagates unchanged (error path) — validates AC-01
- [ ] a scope of another user reaches the repository with that user's scope, never the caller's — validates AC-07

**Completion criterion**
The use case and fake-based tests pass, the architecture-boundary tests still pass for `domain` and `application`, and `pnpm typecheck` passes.

## Block 3 — Persistence: tags, migration 0017 and the repositories

**Files**
- `apps/api/src/movements/infrastructure/db/schema.ts` (modified) — `movements` gains the unique constraint `movements_id_owner_unique` on `(id, owner_id)` and two composite indexes; `tags` and `movementTags` are declared in the new `tags-schema.ts` and re-exported from `schema.ts`, because `apps/api/drizzle.config.ts` only globs `src/*/infrastructure/db/schema.ts` and drizzle-kit would otherwise miss both tables. `tags-schema.ts` imports `users` and `movements` through `foreign-relations.ts` and `schema.ts`, never from another module.
- `apps/api/src/movements/infrastructure/db/tags-schema.ts` (new) — `tags` and `movement_tags`.
- `apps/api/src/movements/infrastructure/db/drizzle-movement-repository.ts` (modified) — `insert` runs in a transaction and links tags; `list` applies the filters and loads the tags of the page; `findById` loads the tags.
- `apps/api/src/movements/infrastructure/db/drizzle-movement-filters.ts` (new) — builds the `where` conditions from `MovementFilters`.
- `apps/api/src/movements/infrastructure/db/drizzle-tag-repository.ts` (new) — `suggest`.
- `apps/api/drizzle/0017_tags.sql`, `apps/api/drizzle/meta/_journal.json` and the snapshot (new or modified by drizzle-kit), `apps/api/drizzle/rollback/0017_tags.down.sql` (new).
- `apps/api/test/movements/tag-repository.test.ts`, `apps/api/test/movements/movement-filters-repository.test.ts` (new); `apps/api/test/movements/movement-repository.test.ts`, `apps/api/test/movements/schema-introspection.test.ts` (its `TABLES` list and the `movements_id_owner_unique` and index assertions), `apps/api/test/movements/db-fixtures.ts` (a tag and link seed helper), `apps/api/test/identity/user-erasure.test.ts` (registry entries for `tags` and `movement_tags`, both `cascade`), `apps/api/test/identity/migration.test.ts` (every rollback chain starts from `0017_tags` before `0014_movements`, `MOVEMENTS_TAG`, the journal order and a 0017 block) and `apps/api/test/investments/investments-migration.test.ts` (`LATER_MIGRATIONS` and `LATER_TABLES` gain `0017_tags`, `tags` and `movement_tags`) (modified).

**Logic**
Insertion runs in one transaction: insert the movement, then for the tags (already normalized and collapsed) `insert into tags (owner_id, name) ... on conflict (owner_id, lower(name)) do nothing`, then select the ids of the owner's tags by `lower(name)` in the order given, collapse repeated ids (two spellings that PostgreSQL folds together), and insert the links with `position` 0 to 9. A failure anywhere rolls back the movement. The list statement is one query: `owner_id` from the scope, plus `account_id = $1`, `type = $2`, `occurred_at >= $3 and occurred_at < $4`, plus `category_id in (select id from categories where owner_id = $owner and (id = $c or parent_id = $c))` for a category (one level, so the parent and its direct children), plus `id in (select movement_id from movement_tags where owner_id = $owner and tag_id = (select id from tags where owner_id = $owner and lower(name) = lower($t)))` for a tag. The count query uses the same conditions. The tags of the page are read by one `select ... from movement_tags join tags where movement_tags.owner_id = $owner and movement_id in (...) order by position`, and `findById` uses the same scoped statement; every statement and subquery on `tags`, `movement_tags` and `categories` applies `scopedTo(scope, { owner })` on its own table's owner column (the ids of a page are never trusted as proof of ownership). `ON CONFLICT (owner_id, lower(name))` and the `text_pattern_ops` index are expressions that the Drizzle builder cannot state, so they use `sql` fragments and the generated 0017 DDL is checked by hand; the `lower(name) like ... escape` comparison of `suggest` is a fragment too, with the escaped prefix bound as a parameter; these are the only raw SQL fragments and none concatenates input. `suggest` is `select name from tags where owner_id = $owner and lower(name) like lower($prefix) escaped || '%' order by lower(name) limit $n`, with `\`, `%` and `_` of the prefix escaped. Order and null placement of the list stay those of `movements_owner_date_idx`.

**Data model**
- `tags`: `id uuid pk default gen_random_uuid()`, `owner_id uuid not null references users(id) on delete cascade`, `name text not null` (the first-used spelling), `created_at timestamptz not null default now()`; `unique (id, owner_id)`; check `char_length(name) between 1 and 30`; unique index `tags_owner_name_unique` on `(owner_id, lower(name))`; index `tags_owner_name_prefix_idx` on `(owner_id, lower(name) text_pattern_ops)`.
- `movement_tags`: `movement_id uuid not null`, `tag_id uuid not null`, `owner_id uuid not null`, `position smallint not null`; primary key `(movement_id, tag_id)`; unique `(movement_id, position)`; check `position between 0 and 9` (the database also caps a movement at 10 tags); foreign key `(movement_id, owner_id)` references `movements(id, owner_id)` on delete cascade; foreign key `(tag_id, owner_id)` references `tags(id, owner_id)` on delete cascade; index `movement_tags_tag_idx` on `(tag_id, movement_id)`.
- `movements`: add `unique (id, owner_id)` (`movements_id_owner_unique`), index `movements_owner_account_date_idx` on `(owner_id, account_id, occurred_at desc, id desc)` and index `movements_owner_category_date_idx` on `(owner_id, category_id, occurred_at desc, id desc)`. No column changes and no data change. The older `movements_account_idx` and `movements_category_idx` stay because the composite foreign keys use them for the restrict checks; the extra write cost on `movements` is accepted and the performance test of Block 7 includes saving.
- Rollback `0017_tags.down.sql` drops `movement_tags`, `tags`, the two indexes and the unique constraint of `movements`, as a whole; it deletes only tag data, no movement.

**Input validation**
The repositories receive values already parsed by Blocks 1 and 2 and add the database side: every value is a bound parameter, the suggestion prefix has `\`, `%` and `_` escaped before it becomes a pattern, `tags.name` is checked to 1 to 30 characters, `position` to 0 to 9, and the owner always comes from the scope.

**Error handling**
- A tag link or tag insert that fails rolls back the whole movement insert (no movement without its tags).
- An account or category that vanished between the read and the insert still answers not found, never a 500 (existing behavior kept inside the transaction).
- A tag, account or category of another user used as a filter returns an empty page and no error.
- A suggestion prefix holding `%`, `_` or `\` matches only those literal characters.
- Deleting a user removes that user's tags and links through `on delete cascade` and leaves another user's rows (the erasure guard learns both relations as `cascade`).

**Required tests**
- [ ] a movement saved with 1 and with 10 tags returns them in order, and the tags exist once per user — validates AC-03
- [ ] the same tag typed in another case on a second movement reuses the stored tag and displays the first spelling — validates AC-03
- [ ] a tag insert that fails rolls back the movement (forced error, error path) — validates AC-03
- [ ] the database refuses an 11th link, a link whose tag belongs to another owner and a link whose movement belongs to another owner (constraint probes, invalid input) — validates AC-04
- [ ] the database refuses a tag name of 0 and of 31 characters and a second tag equal under `lower()` for the same owner (constraint probes, invalid input) — validates AC-06
- [ ] filters by account, category, date range, type and tag each narrow the list, and all five together return only the movements that match all of them, with the right `total` — validates AC-01
- [ ] filtering by a parent category returns its own movements and those of its subcategories, and filtering by a subcategory returns only its own — validates AC-02
- [ ] the local-day interval includes a movement at 23:30 and excludes one at 00:30 of the next day in the user's zone — validates AC-01
- [ ] suggestions match the first characters case-insensitively, order alphabetically and respect the limit — validates AC-05
- [ ] a suggestion prefix holding `%`, `_` or `\` matches only those literal characters (invalid input) — validates AC-05
- [ ] an account or category deleted between the read and the insert answers not found, never a 500 (error path) — validates AC-03
- [ ] another user's account id, category id and tag name as filters return an empty page with `total` 0 and no error, and another user's tags never appear in suggestions (error path) — validates AC-07
- [ ] deleting a user who has tags and links leaves no row of that user in `tags` or `movement_tags` and keeps another user's rows and the guard test knows both relations as `cascade` (error path: a non-cascading key on them fails the guard) — validates AC-07
- [ ] the migration applies on a database with 0014 and the introspection test sees the constraints, the checks and the indexes above — validates AC-04
- [ ] a fresh listing of a movement with no tags returns an empty array — validates AC-03
- [ ] the loader of a page's tags returns nothing for a movement id of another owner, and `findById` of a foreign movement stays `null` (error path) — validates AC-07

**Completion criterion**
The repository, constraint, erasure-guard and migration tests pass against PostgreSQL, and the rollback file applies and reverts cleanly on a database that holds movements.

## Block 4 — HTTP and composition

**Files**
- `apps/api/src/movements/infrastructure/http/movement-routes.ts` (modified) — the list route uses the filtered query schema and passes the filters; `POST` passes `tags`.
- `apps/api/src/movements/infrastructure/http/tag-routes.ts` (new) — `createTagRoutes`.
- `apps/api/src/movements/infrastructure/http/movement-presenter.ts` (modified) — presents `tags`.
- `apps/api/src/movements/index.ts` (modified) — exports `createTagRoutes`.
- `apps/api/src/server.ts` (modified) — mounts the tag routes beside the movement routes.
- `apps/api/test/movements/movement-routes.test.ts` (modified); `apps/api/test/movements/tag-routes.test.ts` (new).

**Logic**
`GET /movements` reads the validated query and builds the use case input; the response schema is the existing list response, now with `tags` on each item. `POST /movements` forwards `body.tags`. `GET /tags` runs behind `requireSession` and `requireVerifiedEmail`, builds a read scope with the same owner policy and answers the suggestions. No log line contains a tag name, a prefix or a filter value; the movement-created line still logs ids only.

**Data model**
No storage change in this block. The response gains `tags` (a non-null array, default empty); the unique, foreign key and index definitions live in Block 3.

**API contract**
- `GET /movements?limit&offset&accountId&categoryId&type&tag&from&to` → 200 `{ items: MovementResponse[], total, limit, offset }`; every item has `tags: string[]`. Errors: 400 `VALIDATION_FAILED` (bad filter or page), 401 `UNAUTHENTICATED`, 403 for an unverified email (existing code). A foreign id or tag is 200 with no items. Auth: session cookie, verified email, owner scope.
- `POST /movements` body adds `tags?: string[]` (0 to 10 entries, 1 to 30 code points each) → 201 `MovementResponse` with `tags`. Errors: the existing ones plus 400 `VALIDATION_FAILED` for an invalid tag or an 11th entry.
- `GET /tags?prefix&limit` → 200 `{ items: string[] }` (at most 20, alphabetical, only the caller's tags). Errors: 400 `VALIDATION_FAILED`, 401 `UNAUTHENTICATED`, 403 for an unverified email. Auth: session cookie, verified email, owner scope.

**Input validation**
Query and body go through the shared Zod schemas of Block 1 with the shared validation middleware; no handler reads `req.query` or `req.body` unvalidated. Responses are validated against the shared response schemas.

**Error handling**
- An invalid filter, tag or suggestion query answers 400 `VALIDATION_FAILED` without echoing the value.
- A request without a session answers 401 and an unverified user is refused, on both routes.
- A foreign account, category or tag filter answers 200 with an empty list.
- An unexpected repository error answers the generic 500 from the error middleware with no tag or filter value in the body or the log.

**Required tests**
- [ ] `POST /movements` with tags answers 201 with the tags, and the next `GET /movements` lists them — validates AC-03
- [ ] `POST /movements` with an 11th tag and with an empty or 31-character tag answers 400 and stores nothing (invalid input) — validates AC-04, AC-06
- [ ] `GET /movements` with all five filters returns only matching movements through the real stack — validates AC-01
- [ ] `GET /movements?categoryId=<parent>` includes the subcategory movements — validates AC-02
- [ ] `GET /tags?prefix=vi` answers the caller's tags that start with "vi" in any case — validates AC-05
- [ ] `GET /movements` with another user's account, category and tag answers 200 with `items: []`, `total: 0`, and the body is byte-identical to a filter that matches nothing of the caller's — validates AC-07
- [ ] `GET /tags` never returns another user's tags — validates AC-07
- [ ] a bad UUID, a bad date, `from` after `to`, an unknown type and a bad page answer 400 `VALIDATION_FAILED` on `GET /movements`, and an empty prefix and a bad limit answer 400 on `GET /tags` (invalid input) — validates AC-01, AC-05
- [ ] both new and changed routes refuse a request with no session (401) and an unverified user (error path) — validates AC-07
- [ ] a forced repository error answers 500 and the body and log hold no tag or filter value (error path) — validates AC-06

**Completion criterion**
The route tests pass, `pnpm typecheck` passes, and the request and response bodies match the shared schemas.

## Block 5 — Web: tags on the entry screen

**Files**
- `apps/web/src/lib/api-client.ts` (modified) — `createMovement` body accepts `tags`; a new `listTags(query)`; `listMovements` params accept the filters (used in Block 6).
- `apps/web/src/features/movements/components/tag-input.tsx` (new) — presentational chips input with a suggestion list; no data fetching.
- `apps/web/src/features/movements/containers/tag-input-container.tsx` (new) — debounced suggestions through `listTags`.
- `apps/web/src/features/movements/components/movement-form.tsx` (modified) — renders a tag field slot and submits `tags`; it imports no container and no API client.
- `apps/web/src/features/movements/containers/create-movement-container.tsx` (modified) — wires the tag container and the field errors.
- `apps/web/src/features/movements/movement-form-errors.ts` (modified) — maps the tag errors to message keys.
- `apps/web/messages/en.json`, `apps/web/messages/es.json` (modified) — the `movements.tags` strings.
- `apps/web/test/tag-input.test.tsx`, `apps/web/test/tag-input-container.test.tsx` (new); `apps/web/test/movements-components.test.tsx`, `apps/web/test/movements-containers.test.tsx`, `apps/web/test/api-client-movements.test.ts` (modified — the `MovementResponse` fixtures gain `tags`, and `apps/web/test/movements-list.test.tsx` and `apps/web/test/routes.test.tsx` are checked for response literals).

**Logic**
The field shows the chosen tags as removable chips (shadcn `Badge`, `Input` and `Button` from `components/ui`, theme tokens only) and a text box. `tag-input.tsx` is pure: it receives `suggestions` and `onPrefixChange` as props, and the containers (`create-movement-container.tsx` here and `movements-container.tsx` in Block 6) are the only places that mount `tag-input-container.tsx` and passes the result down through the form's tag slot; the debounce is a small hand-written timer, with no new dependency. Enter or comma adds the typed text as a tag, trimmed; the box stops accepting a new tag at 10 and shows the limit message; a tag that equals a chosen one ignoring case is not added twice. While typing, the container waits 250 ms after the last key and asks `GET /tags` for the typed prefix; an answer for an older prefix is discarded. A suggestion adds that stored spelling. A failed suggestion request shows nothing and never blocks saving. Every string goes through the message catalogs in both languages; the input, the chips and the list have accessible names and are operable from the keyboard.

**API contract**
The client calls existing routes of Block 4 and defines no new endpoint.
- Method + path: `GET /tags` with `prefix` and `limit`; `POST /movements` with `tags`; `GET /movements` with the filters.
- Request: the query and body fields of Block 1.
- Response: `{ items: string[] }` for tags and the movement shapes with `tags`, parsed with the shared response schemas.
- Error codes: 400 `VALIDATION_FAILED` and 401 `UNAUTHENTICATED`, mapped to message keys by the existing `ApiResult` handling.
- Auth: the session cookie the API client already sends.

**Input validation**
The same limits as the shared schema are checked before submit using the shared constants: 1 to 30 code points, at most 10 tags; the server remains the authority.

**Error handling**
- A tag over 30 code points or empty after trimming is refused in the field with a message and is not added.
- An 11th tag is refused with the limit message.
- A `VALIDATION_FAILED` answer from the server shows the generic form error and keeps the typed data.
- A failing suggestion request is ignored without an error banner.
- An `UNAUTHENTICATED` answer redirects to sign-in, as the existing form does.

**Required tests**
- [ ] typing a tag and pressing Enter adds a chip, and saving sends the chips in `tags` — validates AC-03
- [ ] an 11th tag is refused with the limit message and is not sent (invalid input) — validates AC-04
- [ ] an empty tag and a 31-character tag are refused in the field (invalid input) — validates AC-06
- [ ] typing the first characters shows the matching stored tags and choosing one adds it; an answer for an older prefix is dropped — validates AC-05
- [ ] a failing suggestion request shows no banner and saving still works (error path) — validates AC-05
- [ ] a `VALIDATION_FAILED` answer from the server shows the generic form error and keeps the typed data (error path) — validates AC-04
- [ ] an `UNAUTHENTICATED` answer redirects to sign-in (error path) — validates AC-03
- [ ] a tag equal to a chosen one in another case is not added twice — validates AC-03
- [ ] both catalogs hold every new key, and the field is reachable and operable by keyboard — validates AC-03
- [ ] a source check shows `tag-input.tsx`, `movement-form.tsx` and `movement-filters.tsx` import no container and no `@/lib/api-client` — validates AC-05

**Completion criterion**
The web unit tests pass, `pnpm lint` and `pnpm typecheck` pass, and a movement can be saved with tags from the entry screen.

## Block 6 — Web: filters on the movement list

**Files**
- `apps/web/src/features/movements/components/movement-filters.tsx` (new) — presentational filter bar (account, category, type, from, to, tag, clear).
- `apps/web/src/features/movements/movement-filters-state.ts` (new) — reads and writes the filter state as URL search params.
- `apps/web/src/features/movements/containers/movements-container.tsx` (modified) — mounts `tag-input-container.tsx` for the bar's tag box, holds the filters, passes them to `listMovements`, and reloads from the first page when they change.
- `apps/web/src/features/movements/components/movement-list.tsx` and `movement-row.tsx` (modified) — render the filter bar slot, a "no results for these filters" state and the tags of each row.
- `apps/web/messages/en.json`, `apps/web/messages/es.json` (modified) — the `movements.filters` strings.
- `apps/web/src/app/[locale]/(app)/movements/page.tsx` (modified) — wraps the container in a `Suspense` boundary, which `useSearchParams` needs in Next 16.
- `apps/web/test/movement-filters.test.tsx` (new); `apps/web/test/movements-containers.test.tsx`, `apps/web/test/movements-components.test.tsx`, `apps/web/test/movements-list.test.tsx` (modified).

**Logic**
The bar offers the user's accounts and categories (already loaded by the container; a parent category is offered as such and covers its subcategories), the movement type, a date range, and a tag box whose suggestions are injected by the container exactly as in Block 5 (the bar is pure and uses shadcn `Select`, `Input`, `Badge` and `Button`). The reference data (profile, accounts and categories) is loaded once, apart from the filtered list, so changing a filter reloads only the list while the bar stays mounted and keeps its focus; the existing `generation` guard discards stale answers. The state lives in the URL search params, read and written only by the container so that a reload or the back button keeps it. Applying a filter requests the first page with the filters, and "show more" keeps passing them; a response that arrives after the filters changed is discarded. Dates are sent as local days exactly as typed. With no matches the list shows a "no movements match these filters" message and the clear action, which differs from the empty-history message. Each row shows its tags as small badges.

**Input validation**
The date inputs accept only real days, and a `from` after the `to` is refused before the request; the other values come from selects or the shared tag rules.

**Error handling**
- A `from` after the `to` shows a message and sends no request.
- A failed filtered request shows the existing load error with retry and keeps the filters.
- A stale answer for older filters is discarded.
- A URL with a malformed filter value ignores that value instead of failing.
- An `UNAUTHENTICATED` answer redirects to sign-in.

**Required tests**
- [ ] choosing an account, a category, a date range, a type and a tag sends all of them in the list request and shows only the returned rows — validates AC-01
- [ ] choosing a parent category sends its id once and the subcategory rows that come back are shown — validates AC-02
- [ ] "show more" keeps the active filters, and clearing them reloads the unfiltered list — validates AC-01
- [ ] an empty filtered result shows the "no matches" message and the clear action, not the empty-history message — validates AC-07
- [ ] `from` after `to` is refused and sends no request (invalid input) — validates AC-01
- [ ] a failed filtered request shows the retry state and keeps the filters (error path) — validates AC-01
- [ ] an answer for older filters arriving late is discarded (error path) — validates AC-01
- [ ] an `UNAUTHENTICATED` answer to a filtered request redirects to sign-in (error path) — validates AC-07
- [ ] a malformed filter value in the URL is ignored (invalid input) — validates AC-01
- [ ] each row shows its tags, and both catalogs hold the new keys — validates AC-03

**Completion criterion**
The web unit tests pass, `pnpm lint` and `pnpm typecheck` pass, and the list narrows by every filter in the browser.

## Block 7 — Performance, end-to-end flow and scans

**Files**
- `apps/api/test/perf/movements-list-filters.perf.test.ts` (new) — p95 of the filtered list.
- `apps/api/test/perf/movements-seed.ts` (modified) — also seeds tags and links with `generate_series` and bound parameters.
- `apps/web/e2e/tags-filters.spec.ts` (new) — the flow.
- `apps/api/test/movements/request-path.test.ts`, `apps/api/test/movements/no-float-money.test.ts` (modified) — cover the new files.
- `apps/api/test/foundation/architecture-boundaries.test.ts` (modified) — probes for the new files.

**Logic**
The performance test seeds one user with 100,000 movements, 100 accounts, the default categories and 200 tags, then measures the server-side p95 of: the list with all five filters, a category-only filter on a parent, a tag-only filter and an unfiltered first page, with the sample size and warm-up of the existing performance tests; it asserts p95 under 500 ms for each and, with `EXPLAIN`, that the combined statement without the tag filter uses an index ordered by date and has no Sort node, and that the statements with a tag filter start from the tag index, do not scan `movements` sequentially and sort only the tag's few rows with a top-N sort. The end-to-end flow signs up and verifies a user, creates accounts and a movement with two tags (the second in another case of the first), sees the suggestion, and filters the list by tag, by category and by date range, and clears the filters. The scans read source text only: the new files have no `parseFloat`, `Number(`, `.toFixed` or `Math.round`, and no new file imports the exchange-rates provider, the sync job or a foreign persistence file outside `foreign-relations.ts`.

**Input validation**
The performance seed uses bound parameters; the end-to-end flow also types an empty tag and an 11th tag to see the field messages.

**Error handling**
- A failed scan names the file and the offending token.
- The end-to-end flow fails on any console error or API status of 400 or above that it did not provoke on purpose.
- A performance run that exceeds 500 ms names the scenario and its p95.

**Required tests**
- [ ] with 100,000 movements the list with all five filters answers in under 500 ms at p95 — validates NFR-01
- [ ] with 100,000 movements the parent-category filter, the tag filter and the unfiltered first page each answer in under 500 ms at p95 — validates NFR-01
- [ ] the combined statement without the tag filter uses an index ordered by date and its plan has no Sort node; the statements with a tag filter start from the tag index, have no sequential scan of `movements` and use a top-N sort under the limit — validates NFR-01
- [ ] a page of 100 items with filters is returned and a limit of 101 is refused (invalid input) — validates NFR-02
- [ ] the flow saves a movement with two tags typed in different cases, sees one stored tag, and filters the list by tag, by category (parent includes children) and by date range — validates AC-01, AC-02, AC-03, AC-05
- [ ] the flow refuses an 11th tag and a 31-character tag in the field (invalid input) — validates AC-04, AC-06
- [ ] a second user's account, category and tag as filters show no movements and reveal nothing (error path) — validates AC-07
- [ ] the no-float and request-path scans pass on the new files and fail on probe strings (invalid import) — validates NFR-03
- [ ] the architecture probes reject an infrastructure import in the new domain and application files — validates NFR-04
- [ ] `pnpm test`, `pnpm lint`, `pnpm typecheck` and `pnpm e2e` pass with the new migration — validates NFR-04

**Completion criterion**
The performance test meets 500 ms p95 on every scenario, the end-to-end flow passes, and `pnpm test`, `pnpm lint`, `pnpm typecheck` and `pnpm e2e` pass; the migration count and journal checks include 0017, and the pre-existing migration tests that chain rollbacks from 0014 start from 0015.

## Decisions recorded during CODE

- 2026-10-03, human decision (owner): the NFR-01 plan assertion is relaxed for the tagged case. With a tag filter the planner correctly starts from the tag index (a tag matches a few hundred of 100,000 movements) and sorts that small set with a top-N heapsort, which is cheaper than walking the date index; the untagged combined statement keeps the date-ordered index and no Sort node. The p95 limits (500 ms) are unchanged. Known gap: a very popular tag would take the same plan over a large set; only the p95 measurement would catch it.
- 2026-10-03, human decision (owner): the accessibility debt found in review is fixed before VERIFY: after "clear filters" and "show all movements" focus moves to a stable element of the filter bar, and the `useSearchParams` null guard is replaced by a proper fix.
- 2026-10-04, rebase onto origin/main after DISC-001-03c merged (human instruction): movements now have four types. The `type` filter accepts expense, income, transfer and exchange (the probe test keeps `MOVEMENT_TYPES` and the filter in step); only expenses and income carry tags, so a transfer or an exchange answers `tags: []` and a request that sends tags for them has them ignored; the `accountId` filter matches the source account or the destination account of a movement, so the transfers and exchanges into an account appear when filtering by it (still ANDed with the owner scope, a foreign id still matches nothing).
- 2026-10-04, plan assertion for the account filter (decision taken with the coordinator, same rationale as the tag case): `account_id = $a OR destination_account_id = $a` cannot use one date-ordered index, so a statement with an account filter starts from the account or destination index, does not scan `movements` sequentially and sorts only the few rows of that account with a top-N sort; a statement with neither an account nor a tag filter keeps a date-ordered index scan and no Sort node; every p95 limit stays at 500 ms.
- 2026-10-04, migration numbering after the rebase: `0017_tags` takes journal idx 17 after `0016_transfers_exchanges` (idx 16), its snapshot is `0017_snapshot.json` (cumulative, chained to the 0016 snapshot id), its `when` 1790992572883 stays above main's maximum 1790991879498, and every migration test that rolls migrations back starts with `0017_tags`.

## Final verification
- FR-01 and FR-02: up to 10 tags are stored with a movement, and the caller's existing tags are suggested by prefix, through the API and the entry screen.
- FR-03 and FR-04: the list narrows by account, category, date range, type and tag, alone or combined, and a parent category includes its subcategories.
- NFR-01 and NFR-02: p95 under 500 ms with 100,000 movements and pages of at most 100.
- NFR-03 and NFR-04: tags are 1 to 30 code points compared case-insensitively, belong to one user, and every query is scoped by the owner, including the subqueries.
- Rollback: stop the API, run `apps/api/drizzle/rollback/0017_tags.down.sql` as a whole (destructive for tags only; no movement is lost), and revert the commits; the list falls back to its unfiltered behavior.
- No question is open: Q1 to Q3 are resolved by the human decisions of 2026-10-02.

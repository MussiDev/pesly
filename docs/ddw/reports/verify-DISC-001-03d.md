# Verification DISC-001-03d

| Field | Value |
|---|---|
| Module | `apps/api/src/movements` (tags, filters, tag routes), `packages/shared/src/movements`, `apps/web/src/features/movements`, migration `0017_tags` |
| Line coverage | 97.15% |
| Branch coverage | 92.8% |
| Function coverage | 94.94% |
| Coverage floor | 80% lines, branches and functions (AGENTS.md, "Testing") |
| Lint | `pnpm exec eslint .` — clean, 0 findings; `pnpm exec prettier --check --end-of-line auto .` — clean; `pnpm typecheck` — clean |

Source of the numbers: the closeout run in `docs/ddw/reports/tests-DISC-001-03d.md` (210 files, 3567 tests, all passing; e2e 79/79; perf 9/9). DDW does not run the suite and this report is the account of that run; the cross-verification below was done by an agent that did not write the code, by reading `git diff f889df9 HEAD` and the tests, without running them.

## Acceptance criteria
- ✅ AC-01 — `drizzle-movement-filters.ts:movementConditions` and `list-movements.ts:ListMovements.execute`; tests: `movement-filters-repository.test.ts` "with all five filters returns only the movements that match all of them, and the total counts the same set", `movement-routes.test.ts` "applies all five filters together (AC-01)", `movements-list.test.tsx` "sends account, category, dates, type and tag together and shows only the returned rows (AC-01)", e2e `tags-filters.spec.ts` first flow
- ✅ AC-02 — the category subquery in `movementConditions` (parent or direct children); tests: `movement-filters-repository.test.ts` "filters by a parent category through its subcategories, and by a subcategory only its own", `movement-routes.test.ts` "includes the subcategory movements when filtering by the parent category (AC-02)", e2e first flow
- ✅ AC-03 — `movementTagsSchema`, `create-movement.ts:CreateMovement.execute`, `drizzle-movement-repository.ts:insert` and `linkTags`; tests: `movement-tags.test.ts` "parses 1 and 10 tags keeping order and the first spelling (AC-03)", `movement-repository.test.ts` "saves 1 and 10 tags and returns them in the given order from insert, list and get, with each tag stored once per user", `movement-routes.test.ts` "creates a movement with tags and lists them (AC-03)", `movements-containers.test.tsx` "adds a chip on Enter and saves the chips in tags (AC-03)"
- ✅ AC-04 — `movementTagsSchema.max(10)` on the entries received and the database `movement_tags_position_check`; tests: `movement-tags.test.ts` "rejects an 11th entry, even when it repeats another (AC-04)", `movement-repository.test.ts` "refuses an 11th link, and a link whose tag or movement belongs to another owner (constraint probes)", `movement-routes.test.ts` "rejects an 11th tag and an empty or 31-character tag and stores nothing (AC-04, AC-06)", `movements-containers.test.tsx` "refuses an 11th tag with the limit message and does not send it (AC-04)"
- ✅ AC-05 — `drizzle-tag-repository.ts:suggest`, `suggest-tags.ts:SuggestTags`, `tag-routes.ts:createTagRoutes`; tests: `tag-repository.test.ts` "matches the first characters case-insensitively, orders alphabetically and respects the limit", `tag-routes.test.ts` "answers the callers tags that start with the prefix in any case, alphabetical (AC-05)", `tag-input-container.test.tsx` "drops the answer for an older prefix that arrives late"
- ✅ AC-06 — `tag.ts:movementTagSchema` (NFC, trim, 1 to 30 code points, no control or format characters) and the `tags_name_length_check` constraint; tests: `movement-tags.test.ts` "rejects empty, blank, 31 code points and control characters; accepts 1 and 30 (AC-06)", `movement-repository.test.ts` "refuses a tag name of 0 and of 31 characters and a second tag equal under lower() for the same owner", `movements-containers.test.tsx` "refuses an empty tag and a 31-character tag in the field"
- ✅ AC-07 — the owner scope on the main statement and on every subquery, and the composite foreign keys; tests: `movement-routes.test.ts` "answers the same empty body for foreign ids and tags as for a filter matching nothing (AC-07, R-02)" (byte-identical), `movement-filters-repository.test.ts` "answers an empty page with total 0 for another user's account, category and tag", `movement-repository.test.ts` "loads no tags of a movement of another owner, and findById of a foreign movement stays null", e2e `tags-filters.spec.ts` third flow

## Requirements
- ✅ FR-01, FR-02, FR-03, FR-04 — traced through AC-01 to AC-06 above.
- ✅ NFR-01 — `movements_owner_account_date_idx`, `movements_owner_category_date_idx` and one list statement; `movements-list-filters.perf.test.ts` p95 30.6, 41.0, 22.4 and 31.5 ms at 100,000 movements against 500 ms.
- ✅ NFR-02 — `LIST_MOVEMENTS_MAX_LIMIT` and the use case guard; the perf test asserts a 400 on `limit=101` with filters; `suggest-tags.test.ts` for the 20 cap.
- ✅ NFR-03 — `movementTagSchema`, `tags_name_length_check`, unique index `tags_owner_name_unique` on `(owner_id, lower(name))`; `schema-introspection.test.ts` and the tag tests above.
- ✅ NFR-04 — `tags.owner_id`, `movement_tags.owner_id`, composite foreign keys and `scopedTo` on every statement; the constraint probes, the loader test, `user-erasure.test.ts` registry entries and the AC-07 tests.

## Spec blocks
- ✅ Block 1 — every task done (22 new shared tests: `movement-tags.test.ts`, `movement-filters.test.ts`, the `movement-schemas.test.ts` addition); tests named above and listed in the spec.
- ✅ Block 2 — every task done; `list-and-get-movement.test.ts` "passes every filter and the UTC interval of the local days to the repository", "answers VALIDATION_FAILED for from later than to and never calls the repository"; `local-day-range.test.ts`; `suggest-tags.test.ts`; `create-movement.test.ts` "passes the tags to the repository, and an empty list when there are none".
- ✅ Block 3 — every task done; `movement-repository.test.ts`, `movement-filters-repository.test.ts`, `tag-repository.test.ts`, `schema-introspection.test.ts`, `identity/migration.test.ts` ("0017_tags migration"), `user-erasure.test.ts` and `investments-migration.test.ts`; the category-vanished half of the "vanished account or category" bullet is covered by the pre-existing not-found tests, not by a tags-specific one.
- ✅ Block 4 — every task done; `movement-routes.test.ts` and `tag-routes.test.ts`, including both R-08 tests ("answers 500 INTERNAL and logs no tag or filter value when the repository fails (R-08)" and the query-level variant).
- ✅ Block 5 — every task done; `tag-input.test.tsx`, `tag-input-container.test.tsx`, `movements-containers.test.tsx`, `movements-components.test.tsx`, `api-client-movements.test.ts`, `i18n-catalogs.test.ts`; placed flat in `apps/web/test`, not in a `features` folder as the spec listed.
- ✅ Block 6 — every task done; `movements-list.test.tsx` ("MovementsContainer filters"), `movement-filters.test.tsx`; the container tests live in `movements-list.test.tsx` instead of `movements-containers.test.tsx` and `movements-components.test.tsx`; plus the 4 focus tests added after the owner's accessibility decision.
- ✅ Block 7 — every task done; `movements-list-filters.perf.test.ts`, `tags-filters.spec.ts`, `no-float-money.test.ts`, `request-path.test.ts`, `architecture-boundaries.test.ts`. The plan assertion follows the owner's decision of 2026-10-03, recorded in the spec: the untagged combined statement uses a date-ordered index with no Sort node, the tagged statements start from the tag index with a top-N sort and no sequential scan of `movements`; the p95 limits are unchanged.

## Tests
- ✅ Sad-path tests: every input has an invalid-input test — `POST /movements` tags (11 entries, blank, 31 characters, control character), `GET /movements` filters (impossible date, `from` after `to`, bad uuid, bad type, 31-character tag, `limit=101`), `GET /tags` (empty prefix, 31 characters, limit 0 and 21), `ListMovements` and `SuggestTags` guards, repository constraint probes (11th link, cross-owner links, name length, `lower()` duplicate) and the web field refusals; the unit of `localDayRange` has no invalid-input test of its own because only validated callers reach it.
- ✅ Threat model R-01 to R-10: each has an implementation; R-01, R-02, R-03, R-05, R-08 and R-09 have direct tests; R-04, R-06, R-07 and R-10 rest on construction, existing tests or inherited configuration (warnings below).
- ✅ TDD evidence: `docs/ddw/reports/tdd-DISC-001-03d.md` lists the red result per block; Block 4's wiring was proven red by mutation, Block 5 and 6 contain tests that failed only on a missing module, and the guards are labelled.

## Warnings
- ⚠️ W-VER: R-04 has no test that sends an SQL metacharacter payload (a quote) as a tag, filter or prefix; the `%`, `_` and backslash cases are covered. Safe by construction (bound parameters only).
- ⚠️ W-VER: R-07 has no test that renders a tag holding markup as text; the evidence is the absence of `dangerouslySetInnerHTML` and the control-character rejection.
- ⚠️ W-VER: R-10 (referrer policy for the filter URL) is inherited site-wide configuration with no test pinning it for the movements screen.
- ⚠️ W-VER: `tag-input-container.test.tsx` uses real timers against the 250 ms debounce (three waits of 100 ms and one of 350 ms), the likeliest source of CI noise; web tests keep the default 5 s timeout, which flaked twice in full runs under load and passed alone.
- ⚠️ W-VER: the filtered perf test is one large test with time-relative dates and failed once in a full perf run because of contention on the shared PostgreSQL (diagnosed with EXPLAIN, same plan with and without the new indexes, clean reruns).
- ⚠️ W-VER: `SUGGEST_TAGS_MAX_LIMIT` in `suggest-tags.ts` duplicates the shared `TAG_SUGGESTIONS_MAX_LIMIT`; `TagRoutesOptions.logger` is declared and unused by design; the architecture probe for the new domain file targets a path that does not exist (`domain/tag.ts`) but lints a synthetic source.
- ⚠️ W-VER: business-logic coverage is at or near 100%; below 90% only declarative or defensive code (`tags-schema.ts` lambdas, the unreachable `local day has no valid hour` error, the fail-closed `!auth` guard, the `sql\`true\`` fallback, `movement-list.tsx` function coverage 66.66%).
- ⚠️ W-VER: the migration `0017_tags` carries journal idx 15 and `when` 1790992572883; 07b (`0015_price_snapshots`, idx 15, `when` 1790980568164) and 03c (`0016_transfers_exchanges`, idx 15, `when` 1790991879498) use the same idx, so whichever merges last renumbers idx, snapshot name and `prevId` and re-checks that `when` exceeds the maximum on `origin/main` at merge time.

Result: PASSED

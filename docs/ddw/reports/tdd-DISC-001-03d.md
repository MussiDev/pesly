# TDD evidence DISC-001-03d

Red-phase evidence per block, written from the implementer's report of each block and the verifier's judgement of it. Where a test
file could not even load (a missing module or export, so no individual assertion ran) the red result is that failure and no
per-assertion line exists; this is said explicitly. Tests that already passed before the implementation are labelled guards. Paths
are relative to the repository root.

## Block 1 — Shared contracts (22 tests)

19 of 22 new tests failed before the implementation, 3 passed beforehand.

| Test file | Tests | Red result |
|---|---|---|
| `packages/shared/test/movement-tags.test.ts` | 12 | all failed: the new exports did not exist (undefined export), for example "exposes the limits" and the create-request test |
| `packages/shared/test/movement-filters.test.ts` | 9 | 6 failed on assertions: `TypeError: Cannot convert undefined or null to object` (missing `movementFilterShape`); `expected { limit: 20, offset: 5 } to deeply equal { …(8) }` (filters stripped); the default-limit test lacked `"tag": "a"`; `from 2026-02-30: expected true to be false`; the `from` after `to` and the bad uuid, type and tag tests failed |
| `packages/shared/test/movement-schemas.test.ts` | 1 new | "requires the tags array" failed |

Guards (passed before): equal `from` and `to` with range edges, unknown keys stripped, and the `MOVEMENT_TYPES` probe (it only fails when `MOVEMENT_TYPES` gains a value the filter lacks). After: 22/22, shared suite 87/87.

## Block 2 — Domain, ports and use cases (20 new tests, 38 in the four files)

10 failed on an assertion before the implementation; the tests of the two new files failed at import.

| Test | Red result |
|---|---|
| create-movement, passes the tags | `expected undefined to deeply equal ['Viaje','comida']` |
| list, passes every filter | the `listCalls[0]` object lacked `filters` |
| list, uses the user's time zone | `expected undefined to deeply equal {occurredFrom, occurredBefore}` |
| list, passes only the filters given | `expected undefined to deeply equal { tag: 'x' }` |
| list, `from` later than `to` | `promise resolved { items: [], total: 0 } instead of rejecting` |
| list, propagates repository and preferences failures | `expected Error: db down to be Error: prefs down` (the preferences read never happened) |
| list, narrows the fake / another user's scope (2 tests) and 2 existing list tests | `TypeError: Cannot read properties of undefined (reading 'accountId')` (no `filters`) |
| `local-day-range.test.ts`, `suggest-tags.test.ts` | `Cannot find module` (import failure, no per-assertion line) |

After: 38/38; the foundation suite stayed green (253 tests in the run).

## Block 3 — Persistence: tags, migration 0017 and repositories (31 new or changed tests)

24 of 57 tests in the four files run first failed; the 33 that passed were existing tests.

- tags saved and reused: `expected undefined to deeply equal ['Trip']`, `expected undefined to deeply equal ['Trip','other']`;
- tag insert rolls the movement back: `promise resolved instead of rejecting`;
- constraint probes: `'42P01' to be '23514'` (relation "tags" does not exist);
- filters by account, category, type, tag and range: `expected 3 to be 2`, `6 to be 1`, items not narrowed; foreign tag, category and account filters returned `{ items:[1 item], total:1 }` instead of an empty page;
- page tag loader: `TypeError: loadTagsOf is not a function`;
- `tag-repository.test.ts`: `Cannot find module drizzle-tag-repository` (import failure);
- `schema-introspection.test.ts`: `expected [] to deeply equal [...]`, `relation "public.tags" does not exist`.

Not observed red: the migration, user-erasure and investments-migration tests, which need the migration file that did not exist (a missing file is a certain failure, not an observed one; the verifier accepted this with a warning). After: 61/61 in the four files, 53/53 in `identity/migration.test.ts`, 16/16 in the erasure and investments migration tests.

## Block 4 — HTTP and composition (12 new tests, then 3 more)

First red run: all 38 tests of the two files failed with `TypeError: createTagRoutes is not a function` (setup import), so no assertion was observed red. The verifier rejected that as evidence, so the wiring was mutated one point at a time, the two files run, and the code restored (byte-identical to a backup):

| Mutation | Failing tests (assertion) |
|---|---|
| empty `/tags` router | 4: `expected 404 to be 500` (twice), `expected 404 to be 200` and the limit test |
| POST drops `tags` | 5: `expected [] to deeply equal ['Viaje','Comida']`, `expected +0 to be 1`, `expected [] to deeply equal [Array(1)]`, two `/tags` tests |
| list drops the filters | 4: `expected 5 to be 1`, `expected [ …(2) ] to deeply equal [ Array(1) ]`, local-day test, foreign ids `{ items, total } to match { items: [], total: 0 }` |
| `requireVerifiedEmail` removed from `/tags` | 2: `expected 200 to be 403` (both route files) |
| preferences forced to UTC | first attempt did not apply and all passed (no test covered the time zone); a local-day test was added (22:00 Cordoba found by the 10th, not the 11th) and then failed: `expected [] to deeply equal [ Array(1) ]` |

Also added: unknown `type`, malformed `categoryId` and a 31-character `tag` filter answering 400 without echo; a `type` discriminating test (an income matching every other filter); a query-level 500 test with a pg-shaped error whose message holds the tag, prefix and date, asserting neither body nor log holds them. After: 41/41.

## Block 5 — Web: tags on the entry screen (54 tests)

46 of 54 failed before the implementation.

- `api-client-movements.test.ts`: `listMovements` forwarded only `{ limit: '20' }`; `listTags` (2): `client.listTags is not a function`;
- `movements-components.test.tsx`: submit values lacked `tags: []`; slot test found no `tag-error` element; `tagErrorMessage` (3) not exported;
- `movements-containers.test.tsx`: 14 of 15 tag tests failed against the form because it had no tag field (Enter, comma, duplicate, 11th, empty and 31 characters, 30, remove, suggestions, suggestion failure, `VALIDATION_FAILED`, 401, keyboard, English);
- `tag-input.test.tsx`, `tag-input-container.test.tsx`: failed to resolve the imports (import failure, weak evidence).

Guards or vacuous at red time (the verifier counted 8): "sends no tags key when none chosen", the source-check cases for files that did not exist or had no forbidden imports, and two client tests whose behaviour the Block 1 schema already gave. After: 54/54; web suite green.

## Block 6 — Web: filters on the movement list (41 tests)

14 of 41 failed before the implementation.

- `movements-list.test.tsx`: 12 new tests failed, 8 of them on `TypeError: Cannot read properties of undefined (reading 'account' | 'category' | 'type' | 'from')` because the `movements.filters` catalog keys did not exist; the malformed-URL test failed with `Unable to find an element with the text: Filtrada`; the row tags test with `Unable to find an accessible element with the role "group"`; the `UNAUTHENTICATED` test with `expected "vi.fn()" to be called with arguments: ['/es/sign-in']`;
- `movement-filters.test.tsx`: could not load (`Failed to resolve import ... movement-filters-state`), so no per-test red line;
- `tag-input.test.tsx` source check for `movement-filters.tsx`: `expected false to be true` (file missing).

Guards: the other 15 `tag-input.test.tsx` tests and the new scanner self-test that proves a dynamic `import()` is caught. After implementation three of the implementer's own container tests failed because of test mistakes (route keys needed the `GET ` prefix, paging keys come before the filters, an over-broad `listitem` count) and were corrected without weakening an assertion. After: 41/41; web suite 1153/1153.

## Block 7 — Performance, end-to-end flow and scans

- Perf (`movements-list-filters.perf.test.ts`): a measurement, not a red-green test, because the behaviour existed from earlier blocks. Its first run failed on the plan assertion (a Sort node in the tag-filtered plan); the spec deviation was approved by the owner on 2026-10-03 and the assertion now reflects it. p95 stayed under 500 ms in every scenario.
- e2e (`tags-filters.spec.ts`): first run failed with `SyntaxError: The requested module './support/database' does not provide an export named 'movementIdsOf'`; it passed once the helpers were added.
- Scans: the new scan and architecture cases passed first time apart from two wrong assumptions of the implementer (application files do not ban `drizzle-orm` in ESLint; the probe paths were off by directory depth), fixed in the tests.
- Closeout: one failure in the full suite (`build-output.test.ts`, the built migration's table list lacked `tags` and `movement_tags`), fixed in its own commit.

## Accessibility round after the closeout (human decision of 2026-10-03, 4 tests)

3 of 4 new tests failed before the change: the bar did not expose its first control (`expected null to be <select>`), and after "Clear filters" and after "Show all movements" `expected <body> to be the account <select>`. The fourth is a guard that passed before and after by design: focus is not taken on first load or on an ordinary filter change. Removing the `useSearchParams` null guard had no red test: it is a refactor of the tests' setup (a `search` option on `renderApp`) plus removal of an `eslint-disable`, and the evidence is that every existing container test still passes under that helper, with ESLint and the typechecker clean. The review noted that the back-button and failed-reload no-steal paths have no regression test of their own (the code never touches the focus counter on those paths). After: web suite 1157/1157.

## Follow-up round after the rebase onto origin/main (owner decision of 2026-10-04, 11 tests)

The 11 tests added for the verifier's warnings were all guards: the code already behaved correctly, so none could be red, and no mutation check was run. They are the SQL metacharacter payload as a tag, a filter and a prefix (4 API tests, `apps/api/test/movements/sql-payloads.test.ts`, threat R-04), markup tags rendered as text in a row and in the chips (4 web tests, R-07) and the site-wide referrer policy that applies to `/movements` (3 web tests in `apps/web/test/site-referrer-policy.test.ts`, R-10: the `next.config.ts` header, and the proxy leaving it alone for `/es/movements` and `/en/movements`; the header as served by a running server is not pinned). The rebase itself produced red evidence of a different kind: 134 failing tests on the first run (a local database that had recorded migration 0017 before 0015 existed, test files that assumed one newer migration, home container fixtures without `tags`), two e2e failures after the FEAT-004 redesign (the saved confirmation is a status alert, no longer a heading), each fixed in its own commit. After: 4527/4527, e2e 93/93, perf 9/9.

## Second rebase, onto origin/main with DISC-001-03c merged (decision of 2026-10-04)

The merge of the transfer and exchange work gave red evidence of its own before any new code: the first typecheck of the rebased tree and the first runs failed on the fixtures that assumed two movement types or no `tags` (the filter schema test that treated `transfer` as an unknown type, the saved-movement fixtures, the repository round-trip test of transfers and exchanges, which now read back `tags: []`), and `0014 ... rollback still runs when accounts is already gone` failed with `cannot drop desired object(s) because other objects depend on them` because `movement_tags` references `movements`. Each was fixed in its own commit. New behavior, test first: the account filter that also matches the destination account. Two tests were red on an assertion (`expected 2 to be 4` on the total of the repository test, and `expected 1 to be 3` on the page total of the route test), one is a guard (another user's account as a destination already matched nothing). The web filter bar offering the four movement types was red on the option list and on the select test; the parse and serialize cases were already green because the shared schema accepted the four types. The performance plan assertion failed on the account filter with the OR (a bitmap-or and a bounded top-N sort instead of a date-ordered index); it was relaxed by decision for statements with an account or tag filter and kept strict for the others. After: 4766/4766, e2e 97/97, perf 11/11.

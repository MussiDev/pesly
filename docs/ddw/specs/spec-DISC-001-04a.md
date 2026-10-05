# Spec DISC-001-04a: Local Store, App Shell and Reference Cache

| Field | Value |
|-------|-------|
| Ticket | DISC-001-04a |
| PRD | docs/ddw/prd/prd-DISC-001-04a.md |
| Tier | FEATURE |
| Date | 2026-10-04 |
| Spec loops | 1 |
| Loops since last human decision | 1 |

## Summary
The web app gets a per-user IndexedDB store, a service worker that serves the application shell
without the network, and a device copy of what the entry screen and the movement list need. Every
online load of that data writes through to the store; offline (or when the network fails) the same
screens read the store. Because the API cannot list a user's tags today, the ticket also adds
`GET /tags/all` (user decision, 2026-10-04). The service worker is Serwist's Turbopack package,
because Next.js 16 builds with Turbopack. Nothing here saves a movement offline: that is
DISC-001-04b, so a save without connectivity keeps answering with the existing network error.

## Design decisions
- D1: Tags come from a new paginated `GET /tags/all` (alphabetical, owner-scoped), not from the
  cached movements. The existing `GET /tags?prefix=` suggestions are untouched.
- D2: Network first, local copy second. Every online load writes through to the store; a reconnect
  (`online` event) and the app start refresh it too; the store is read only when the device is
  offline or the request fails with a network error. This settles pending decision 2 of the parent
  index.
- D3: When `navigator.onLine` is false the loaders make no request at all (NFR-02) and read the
  store; when it is true and a request fails with `NETWORK`, they fall back to the store.
- D4: One IndexedDB database per user, named `pesly-<userId>`, so one user can never read another's
  copy. A small pointer in `localStorage` (`pesly.session`: user id and verified flag) is written
  after a successful session check, so an offline start knows whose database to open. Wiping both
  is DISC-001-04d.
- D5: No dependency for IndexedDB: a thin typed wrapper in the repository. `fake-indexeddb` (dev
  dependency, MIT, no runtime code in production) lets the unit tests run a real IndexedDB API under
  happy-dom, instead of mocking the wrapper under test.
- D6: Serwist: `@serwist/turbopack` and `serwist`, pinned to 9.5.13, plus `esbuild` (already allowed
  in `pnpm-workspace.yaml`). AGENTS.md names Serwist for the service worker; `@serwist/next` needs
  webpack and the app builds with Turbopack. The service worker is served by a route handler at
  `/serwist/sw.js`; `next.config.ts` adds `Service-Worker-Allowed: /` and `Cache-Control: no-cache`
  for that path, so scope `/` does not depend on a default the Serwist docs leave unstated.
- D7: Document strategy: when offline, a cached document of the requested URL is served with no
  network attempt; when online, network first with the cache as fallback. Only a 200, non-redirected
  HTML response is cached, so a sign-in redirect is never stored under another URL. Hashed static
  assets are precached. The API origin is never cached. A cached document keeps its own CSP header,
  so the nonce in the page and in the header still match.
- D8: A route is cached by visiting it online, and after sign-in the client asks the service worker
  (a `CACHE_URLS` message) to cache `/<locale>/movements` and `/<locale>/movements/new`, the two
  screens the offline flow needs. A route never visited online is not available offline.
- D9: `skipWaiting` is false: a new service worker waits and takes over at the next start, with no
  forced reload. This settles pending decision 3 of the parent index.
- D10: Offline, the movement list shows the cached 100 most recent movements, ignores the filters
  (the filter bar is disabled) and says so. Movements of an archived account or category show the
  existing "unknown" placeholder offline, because only active accounts and categories are copied
  (FR-01).
- D11: The CSP gains `worker-src 'self'`, because `script-src` carries `'strict-dynamic'` and a
  worker could otherwise be refused.
- D12: Persistent storage is requested each time the authenticated shell becomes ready; asking again
  is harmless. A browser without the Storage API gets no request and no warning (FR-05, "where
  supported").

## Coverage: PRD → blocks
| Requirement | Covered by |
|---|---|
| FR-01 | Block 1, Block 2, Block 3, Block 4, Block 5, Block 6 |
| FR-02 | Block 4, Block 5, Block 7 |
| FR-03 | Block 7, Block 11 |
| FR-04 | Block 8, Block 9, Block 11 |
| FR-05 | Block 10 |
| FR-06 | Block 10 |
| NFR-01 | Strategy: offline the document comes from the service worker cache with no network attempt and the data from one IndexedDB read, and Block 11 measures it in Chromium with a 4x CPU throttle as a stand-in for a mid-range phone, asserting under 1000 ms. |
| NFR-02 | Strategy: when `navigator.onLine` is false the service worker answers from its cache and the loaders skip the network (D3), and Block 11 asserts that no same-origin request fails during an offline start. |

## Dependencies between blocks
Execution order: Block 1 → Block 2 → Block 3 (the API list of tags), Block 4 → Block 5 → Block 6 →
Block 7 (the local store and the offline screens), Block 8 → Block 9 (the service worker), then
Block 10 and Block 11. Block 3 gives Block 6 the list of tags to cache. Block 5 needs the store of
Block 4; Block 6 and Block 7 need the cache of Block 5. Block 9 needs the logic of Block 8. Block 10
needs the shell container changed in Block 7. Block 11 needs everything before it.

## Block 1 — Shared contract for the full list of tags (FR-01)

**Files**
- `packages/shared/src/movements/tag.ts` (modified) — adds `listTagsQuerySchema` and
  `listTagsResponseSchema`, with their inferred types and the limit constants.
- `packages/shared/test/movement-tags.test.ts` (modified) — contract tests for both.

**Logic**
The query takes `limit` (default 50, from 1 to 100) and `offset` (default 0), coerced from strings
like the movements list query. The response is `{ items: string[], total, limit, offset }`, items
being the stored spellings of the user's tags.

**Input validation**
- `limit`: integer from 1 to 100, default 50; a blank value is invalid, not 0.
- `offset`: integer of 0 or more, default 0; a blank value is invalid.

**Error handling**
- A `limit` of 0, above 100, blank or not an integer is a validation failure: 400 `VALIDATION_FAILED`.
- A negative, blank or non-integer `offset` is a validation failure of the same kind.

**Required tests**
- [ ] The query defaults to limit 50 and offset 0 and accepts limit 100 — validates FR-01.
- [ ] A limit of 0, 101 or blank is invalid and fails the query — validates FR-01.
- [ ] A negative offset is invalid and fails the query — validates FR-01.
- [ ] The response contract accepts a page of tags and refuses a missing `total` — validates FR-01.

**Completion criterion**
The four tests pass, `pnpm --filter @pesly/shared typecheck` is clean and both contracts are exported
from `@pesly/shared`.

## Block 2 — Use case and repository to list all tags (FR-01)

**Files**
- `apps/api/src/movements/application/ports/tag-repository.ts` (modified) — adds `listAll`.
- `apps/api/src/movements/application/list-tags.ts` (new) — the use case.
- `apps/api/src/movements/infrastructure/db/drizzle-tag-repository.ts` (modified) — `listAll`.
- `apps/api/test/movements/fakes.ts` (modified) — the in-memory repository implements `listAll`.
- `apps/api/test/movements/list-tags.test.ts` (new) — use case tests.
- `apps/api/test/movements/tag-repository.test.ts` (modified) — real PostgreSQL tests of `listAll`.

**Logic**
`listAll(scope, { limit, offset })` returns `{ items, total }`: the stored spellings of the scope's
tags ordered case-insensitively by name, one page, plus the count of all of them. Both statements
filter by owner through `scopedTo`. `ListTags` checks the limit range, as `SuggestTags` does, and
passes the scope to the repository.

**Input validation**
- The use case rejects a limit outside 1 to 100 or a negative offset as invalid before any query.

**Error handling**
- A limit or offset outside the range is rejected as invalid with `VALIDATION_FAILED`.

**Required tests**
- [ ] `listAll` returns the caller's tags alphabetically, ignoring case, with the stored spelling — validates FR-01.
- [ ] `listAll` pages with limit and offset and reports the total of all tags — validates FR-01.
- [ ] `listAll` never returns the tags of another user and answers an empty page for a user without tags — validates FR-01.
- [ ] `ListTags` rejects a limit of 0 and 101 and a negative offset as invalid — validates FR-01.

**Completion criterion**
The use case and repository tests pass against PostgreSQL and `pnpm --filter @pesly/api typecheck` is
clean.

## Block 3 — `GET /tags/all` route (FR-01)

**Files**
- `apps/api/src/movements/infrastructure/http/tag-routes.ts` (modified) — the new route.
- `apps/api/test/movements/tag-routes.test.ts` (modified) — route tests through the real stack.

**Logic**
The route sits behind the existing `requireSession` and `requireVerifiedEmail` of `/tags`, validates
the query with `listTagsQuerySchema` through the shared `validate` middleware, takes a read scope
from the access policy and answers with `ListTags`. Nothing is logged: tag names never reach a log.

**API contract**
- Method and path: `GET /tags/all`.
- Request: query `limit` (integer 1 to 100, default 50) and `offset` (integer 0 or more, default 0).
- Response: 200 with `{ items: string[], total: number, limit: number, offset: number }`.
- Error codes: 400 `VALIDATION_FAILED`, 401 `UNAUTHENTICATED`, 403 `EMAIL_NOT_VERIFIED`, 500 `INTERNAL`.
- Auth: session cookie and verified email; the read scope returns the caller's own tags only.

**Input validation**
- The query is validated by the shared contract of Block 1; unknown keys are stripped.

**Error handling**
- An invalid `limit` or `offset` answers 400 `VALIDATION_FAILED` and runs no query.
- No session answers 401 and an unverified email answers 403, from the existing middleware.
- A database failure answers 500 `{ code: 'INTERNAL' }` and no tag name reaches the response or the log.

**Required tests**
- [ ] The route lists the caller's tags sorted and paged, with `total`, `limit` and `offset` — validates FR-01.
- [ ] Another user's tags never appear in the page of the caller — validates FR-01.
- [ ] An invalid limit or offset answers 400 `VALIDATION_FAILED` — validates FR-01.
- [ ] Without a session the route answers 401 and with an unverified email it answers 403 — validates FR-01.
- [ ] A query-level database error answers 500 and the body and the log hold no tag name — validates FR-01.

**Completion criterion**
`tag-routes.test.ts` passes, the existing `GET /tags` tests pass unchanged and `pnpm lint` and
`pnpm typecheck` are clean for `apps/api`.

## Block 4 — IndexedDB wrapper: the per-user local store (FR-01, FR-02)

**Files**
- `apps/web/src/lib/local-store/database.ts` (new) — opens the database of one user, with its
  version upgrade, and runs transactions as promises.
- `apps/web/src/lib/local-store/stores.ts` (new) — typed read, write, list, replace-all and clear
  over the object stores.
- `apps/web/package.json` (modified) — adds the dev dependency `fake-indexeddb`.
- `pnpm-lock.yaml` (modified) — the lockfile entry for it.
- `apps/web/test/local-store.test.ts` (new) — unit tests over `fake-indexeddb`.

**Logic**
`openLocalStore(userId)` opens the database `pesly-<userId>` at version 1 with two object stores:
`reference` (out-of-line keys such as `accounts`, `categories`, `tags`, `profile`, `rates`) and
`movements` (key `id`, indexed by `occurredAt`). `replaceAll` clears a store and writes the new items
in one transaction, so a failed write leaves the previous copy intact. When IndexedDB does not exist
(a private window, an old browser) the open call fails with `LocalStoreUnavailable`, which callers
read as "no local copy".

**Input validation**
- `userId` must be a non-empty string of letters, digits and hyphens: anything else is refused before
  it becomes part of a database name.

**Error handling**
- IndexedDB missing or blocked: `LocalStoreUnavailable`, never an unhandled rejection.
- A write that fails inside `replaceAll` rolls the whole transaction back and rethrows.
- An invalid `userId` is refused with a `TypeError` and no database is created.

**Required tests**
- [ ] A value written to the `reference` store is read back after reopening the database — validates FR-01.
- [ ] `replaceAll` on `movements` replaces the previous items and the key order by `occurredAt` is available — validates FR-02.
- [ ] Two users get two separate databases and one cannot read the other's data — validates FR-01.
- [ ] Without `indexedDB` the open call raises the `LocalStoreUnavailable` error — validates FR-01.
- [ ] A write error inside `replaceAll` rolls back and leaves the previous copy in place — validates FR-02.
- [ ] An invalid `userId` is refused and creates no database — validates FR-01.

**Completion criterion**
The six tests pass under happy-dom, `pnpm --filter @pesly/web typecheck` is clean and the justification
of `fake-indexeddb` (D5) is the only dependency this block adds.

## Block 5 — Reference cache and session pointer (FR-01, FR-02)

**Files**
- `apps/web/src/lib/local-store/reference-cache.ts` (new) — saves and loads the reference data and
  the recent movements.
- `apps/web/src/lib/local-store/session-pointer.ts` (new) — reads, writes and clears the
  `pesly.session` pointer in `localStorage`.
- `apps/web/test/reference-cache.test.ts` (new) — unit tests of the cache.
- `apps/web/test/session-pointer.test.ts` (new) — unit tests of the pointer.

**Logic**
`saveReferenceData` writes the active accounts, active categories, tags, profile preferences (time
zone, default rate type) and latest rates in one go; `loadReferenceData` returns them or `null` when
nothing was stored. `saveRecentMovements` orders the movements by `occurredAt` and `id`, newest first,
and keeps the 100 first; `loadRecentMovements` returns them in that order. Everything read back is
parsed with the shared response contracts, so a corrupt record counts as missing. The pointer holds
the user id and the verified flag and nothing secret.

**Input validation**
- Stored records are parsed with the shared contracts on every read; one that does not parse is
  treated as missing.
- The pointer is parsed as JSON with `userId` and `emailVerified`; anything else reads as no pointer.

**Error handling**
- Nothing stored yet: `loadReferenceData` and `loadRecentMovements` return `null` or an empty list.
- A stored record that does not parse is treated as missing and not thrown.
- `localStorage` that throws (blocked storage) reads as no pointer and writes nothing.

**Required tests**
- [ ] Reference data saved and loaded keeps the accounts, categories, tags, preferences and rates — validates FR-01.
- [ ] Saving 150 movements keeps only the 100 most recent, newest first — validates AC-03.
- [ ] A later save replaces the earlier copy instead of adding to it — validates AC-03.
- [ ] Loading before anything was saved returns no copy and no error — validates FR-01.
- [ ] A corrupt stored record is invalid and is ignored instead of thrown — validates FR-02.
- [ ] The pointer round trips the user id and verified flag, and clearing it removes it — validates FR-01.
- [ ] An invalid pointer (not JSON) or a blocked `localStorage` reads as no pointer, not as an error — validates FR-01.

**Completion criterion**
The seven tests pass and `pnpm --filter @pesly/web typecheck` is clean.

## Block 6 — Offline entry screen: data loading (FR-01)

**Files**
- `apps/web/src/lib/api-client.ts` (modified) — `listAllTags`.
- `apps/web/src/lib/connectivity.ts` (new) — `isOffline()` and a hook that follows the `online` and
  `offline` events.
- `apps/web/src/features/movements/use-movement-form-data.ts` (modified) — offline fallback and
  write-through.
- `apps/web/src/features/movements/containers/tag-input-container.tsx` (modified) — suggestions from
  the local tags when offline.
- `apps/web/messages/en.json` and `apps/web/messages/es.json` (modified) — the offline texts.
- `apps/web/test/offline-entry-screen.test.tsx` (new) and `apps/web/test/api-client-movements.test.ts`
  (modified) — tests.

**Logic**
The hook reads the pointer and opens the user's store. When `isOffline()` it reads the cached
reference data and makes no request; otherwise it loads from the API as today, pages `listAllTags`
100 at a time, writes everything through to the store and, if a request fails with `NETWORK`, falls
back to the store. The entry screen then opens with the cached accounts, categories and tags and the
rate prefilled from the cached latest rates. The tag field filters the cached tags by prefix while
offline. A refresh also runs when the `online` event fires.

**Input validation**
- The entry screen keeps its existing field validation; the cached data only fills its options.
- `listAllTags` passes `limit` and `offset` as numbers and parses the response with the shared contract.

**Error handling**
- Offline with no cached copy (never loaded online, or the store unavailable) shows a message asking to
  connect once, with a retry, instead of a blank screen.
- A non-network API failure (401, 500) keeps the existing behavior: sign-in redirect or generic error.

**Required tests**
- [ ] Offline, the entry screen offers the cached active accounts, categories and tags and prefills the latest stored rate — validates AC-01.
- [ ] Offline, the screen makes no request at all — validates AC-01.
- [ ] An online load writes accounts, categories, tags, preferences and rates through to the store — validates FR-01.
- [ ] When an online request fails with a network error the screen falls back to the cached copy — validates FR-01.
- [ ] Offline with no cached copy shows the connect-once message with a retry, not a crash — validates AC-01.
- [ ] A 401 while online still sends the user to sign in, and the tag field filters cached tags by prefix offline — validates FR-01.
- [ ] `listAllTags` calls `GET /tags/all`, pages by 100 and parses the response — validates FR-01.

**Completion criterion**
The new tests pass and the existing `movements-containers.test.tsx` and `movements-components.test.tsx`
pass unchanged.

## Block 7 — Offline movement list and shell (FR-02, FR-03)

**Files**
- `apps/web/src/features/movements/containers/movements-container.tsx` (modified) — write-through of
  the unfiltered first page and the offline read.
- `apps/web/src/features/movements/components/movement-list.tsx` (modified) — the offline notice and
  the disabled filter bar.
- `apps/web/src/features/shell/containers/authenticated-shell-container.tsx` (modified) — the session
  check tolerates being offline through the pointer.
- `apps/web/messages/en.json` and `apps/web/messages/es.json` (modified) — the notice.
- `apps/web/test/movements-list.test.tsx` and `apps/web/test/authenticated-shell-container.test.tsx`
  (modified) — tests.

**Logic**
The list container, when online and with no filter on, saves the first page of 100 as the recent
movements. Offline, or when the first request fails with `NETWORK`, it loads the saved movements and
the cached accounts and categories, disables the filters and shows a notice that the 100 most recent
movements are shown. A filtered load never overwrites the copy. The shell container, online, checks
the session as today and writes the pointer when it succeeds; offline it reads the pointer and, if it
names a verified user, renders the app as ready without calling the API; with no pointer it shows the
failed state with a retry.

**Input validation**
- Filter values keep their existing validation; offline they are not read at all.
- The pointer is the only thing the offline shell trusts, and it is parsed before use.

**Error handling**
- Offline with no saved movements shows the existing empty state with the offline notice, not an error.
- Offline with no pointer shows the failed shell state with a retry instead of a sign-in redirect.
- A 401 while online still sends the user to sign in.

**Required tests**
- [ ] Offline, the list shows the 100 most recent saved movements with the offline notice and a disabled filter bar — validates AC-02.
- [ ] An online unfiltered load saves its 100 movements, and a filtered load does not overwrite them — validates FR-02.
- [ ] When the first list request fails with a network error the list falls back to the saved movements — validates FR-03.
- [ ] Offline with nothing saved shows the empty state and the notice, not an error — validates FR-03.
- [ ] Offline with a pointer the shell renders ready and makes no request — validates FR-03.
- [ ] Offline with no pointer the shell shows the failed state with a retry — validates FR-03.
- [ ] A 401 while online still redirects to sign in and the pointer is written only after a successful check — validates FR-03.

**Completion criterion**
The new tests pass and the existing list and shell tests pass unchanged.

## Block 8 — Shell cache logic and CSP (FR-04)

**Files**
- `apps/web/src/lib/service-worker/shell-cache.ts` (new) — pure functions the service worker uses.
- `apps/web/src/lib/content-security-policy.ts` (modified) — adds `worker-src 'self'`.
- `apps/web/test/shell-cache.test.ts` (new) — unit tests of the cache logic.
- `apps/web/test/content-security-policy.test.ts` (modified) — the new directive.

**Logic**
`shouldServeFromCache` decides, from the request mode and `navigator.onLine`, whether a document is
answered from the cache with no network attempt; `isCacheableDocument` accepts only a 200,
non-redirected, `text/html` response of the same origin; `warmUrls` builds the locale-prefixed URLs
to cache after sign-in. They take plain values, so they run in Vitest without a service worker.

**Input validation**
- URLs to cache must be same-origin paths that start with `/`; anything else is dropped.
- Only navigation requests for the app's own origin are candidates for the document cache.

**Error handling**
- A redirected, non-200 or non-HTML response is never cached and falls through to the network.
- A cross-origin URL in a `CACHE_URLS` message is refused and not fetched.

**Required tests**
- [ ] Offline, a navigation request is served from the cache with no network attempt — validates FR-04.
- [ ] Online, a navigation request goes to the network first and uses the cache only as fallback — validates FR-04.
- [ ] A redirected, non-200 or non-HTML response is an invalid candidate and is not cacheable — validates FR-04.
- [ ] A cross-origin or non-path URL in the warm list is refused as invalid — validates FR-04.
- [ ] The CSP now contains `worker-src 'self'` in development and in production and keeps every earlier directive — validates FR-04.

**Completion criterion**
The five tests pass and the existing `content-security-policy.test.ts` cases pass unchanged.

## Block 9 — Serwist wiring and warm-up (FR-04)

**Files**
- `apps/web/package.json` (modified) and `pnpm-lock.yaml` (modified) — `@serwist/turbopack`,
  `serwist` (both 9.5.13) and `esbuild`.
- `apps/web/next.config.ts` (modified) — `withSerwist` and the headers of `/serwist/:path*`.
- `apps/web/src/app/serwist/[path]/route.ts` (new) — serves the compiled service worker.
- `apps/web/src/app/sw.ts` (new) — the service worker source: precache, document strategy from Block 8,
  the `CACHE_URLS` message handler, no `skipWaiting`.
- `apps/web/src/app/[locale]/layout.tsx` (modified) — the Serwist provider that registers it.
- `apps/web/src/features/shell/containers/authenticated-shell-container.tsx` (modified) — sends
  `CACHE_URLS` once the shell is ready.

**Logic**
The route handler builds `app/sw.ts` with esbuild and serves it at `/serwist/sw.js`; the provider
registers it from the root layout. `sw.ts` precaches the hashed static assets from the Serwist
manifest, answers documents with the Block 8 logic, never touches the API origin, and handles the
`CACHE_URLS` message by fetching each accepted URL and caching it if `isCacheableDocument` says so.
The registration scope is `/`, kept by the `Service-Worker-Allowed: /` header of `next.config.ts`. The
service worker is off in development unless the Serwist option says otherwise; its behavior is
verified against a production build in Block 11.

**Input validation**
- The `CACHE_URLS` message is parsed: an array of strings, each accepted by the Block 8 validation.

**Error handling**
- A failed fetch while warming a URL is ignored and the URL is simply not cached.
- A registration failure leaves the app working online and shows the user nothing.

**Required tests**
- [ ] `pnpm --filter @pesly/web build` succeeds and emits the service worker route — validates FR-04.
- [ ] The headers of `/serwist/sw.js` include `Service-Worker-Allowed: /` and `Cache-Control: no-cache` — validates FR-04.
- [ ] The `CACHE_URLS` handler caches an accepted URL and ignores an invalid or failing one — validates FR-04.
- [ ] The layout test still renders, and the shell sends `CACHE_URLS` once after it is ready — validates FR-04.
- [ ] A service worker registration that fails with an error leaves the app working and throws nothing — validates FR-04.

**Completion criterion**
The build and the four tests pass, `pnpm audit --prod --audit-level high` stays clean after the new
dependencies, and the browser registers a service worker with scope `/` in the Block 11 run.

## Block 10 — Persistent storage request and warning (FR-05, FR-06)

**Files**
- `apps/web/src/lib/local-store/persistence.ts` (new) — `requestPersistentStorage`.
- `apps/web/src/features/shell/components/storage-warning.tsx` (new) — the presentational warning.
- `apps/web/src/features/shell/containers/authenticated-shell-container.tsx` (modified) — requests
  persistence once the shell is ready and shows the warning when it is denied.
- `apps/web/messages/en.json` and `apps/web/messages/es.json` (modified) — the warning text.
- `apps/web/test/persistence.test.ts` (new) and `apps/web/test/authenticated-shell-container.test.tsx`
  (modified) — tests.

**Logic**
`requestPersistentStorage` returns `granted` when `navigator.storage.persisted()` is already true or
`persist()` resolves true, `denied` when `persist()` resolves false or rejects, and `unsupported`
when the Storage API is missing. The shell container calls it when it becomes ready and renders the
warning only for `denied`; `unsupported` shows nothing.

**Input validation**
- The result is a closed set of three values; nothing from the user reaches it.

**Error handling**
- `persist()` rejecting counts as denied and shows the warning, never an uncaught error.
- A browser without `navigator.storage` is `unsupported`: no request and no warning.

**Required tests**
- [ ] On a supporting browser the shell calls `persist()` once it is ready — validates AC-05.
- [ ] When the storage is already persistent no second request is made — validates AC-05.
- [ ] When the browser denies persistent storage the shell shows the warning — validates AC-06.
- [ ] When `persist()` rejects with an error the warning shows and nothing is thrown — validates AC-06.
- [ ] A browser without the Storage API gets neither a request, nor a warning, nor an error — validates FR-05.

**Completion criterion**
The five tests pass and the shell tests of Block 7 still pass.

## Block 11 — End-to-end offline flows and entry-time check (NFR-01, NFR-02)

**Files**
- `apps/web/e2e/offline.spec.ts` (new) — the offline flows in Chromium.
- `playwright.config.ts` (modified) — `E2E_PRODUCTION_BUILD=1` runs the web server as build plus start,
  as CI already does, because the service worker is meant for a production build.
- `apps/web/e2e/support/database.ts` (modified) — a helper that seeds many movements for a user.

**Logic**
The flow signs in online, creates an account and a movement with a tag, seeds 120 movements, visits
the entry screen and the movement list, reloads so the service worker controls the page, goes offline
with `context.setOffline(true)`, and reloads. It asserts the entry screen shows the cached account and
tag, the list shows 100 movements and the offline notice, no same-origin request failed, and the amount
field is visible within 1000 ms under a 4x CPU throttle. Another run overrides
`navigator.storage.persist` to deny and to grant, and checks the warning.

**Input validation**
- The seeding helper takes a user email and a positive count; nothing else reaches the database.

**Error handling**
- A run without a production build fails fast with a message naming `E2E_PRODUCTION_BUILD`.
- An offline start that needs the network fails the same-origin request check and the flow fails.

**Required tests**
- [ ] Offline, the entry screen opens with the cached account and tags and the amount field appears within 1000 ms under CPU throttle — validates NFR-01.
- [ ] During the offline start no same-origin request may fail: a failed request is an error and fails the flow — validates NFR-02.
- [ ] Offline, the movement list shows the 100 most recent of 120 seeded movements — validates AC-02.
- [ ] The service worker is registered with scope `/` and the app starts offline from the cached shell — validates AC-04.
- [ ] A browser that denies persistent storage shows the warning and one that grants it shows none, with no console error — validates AC-06.

**Completion criterion**
`E2E_PRODUCTION_BUILD=1 pnpm e2e` passes the new file and the existing flows still pass in the default
mode.

## Final verification
- `pnpm lint`, `pnpm typecheck`, `pnpm test:coverage` (80% lines, branches and functions over the
  three trees together), `pnpm test:perf` and `pnpm e2e` pass, and the offline file passes with
  `E2E_PRODUCTION_BUILD=1`.
- Every AC of the PRD has a passing test: AC-01 and AC-02 offline in a unit test and in the browser,
  AC-03 with 150 movements, AC-04 from the cached shell, AC-05 and AC-06 with both answers of the
  Storage API.
- The new dependencies are exactly `@serwist/turbopack`, `serwist` and `esbuild` in `apps/web`, and
  `fake-indexeddb` as a dev dependency; `pnpm audit --prod --audit-level high` is clean.
- A save without connectivity still answers with the existing network error: queueing is
  DISC-001-04b.
- There is no database migration: the only server change is a read route. Rolling the ticket back is
  reverting the commits; the worker, the store and the cache then disappear at the next load, and the
  pointer in `localStorage` is harmless without the code that reads it.

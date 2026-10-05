# Threat model DISC-001-04a: Local Store, App Shell and Reference Cache

| Field | Value |
|-------|-------|
| Ticket | DISC-001-04a |
| Spec | docs/ddw/specs/spec-DISC-001-04a.md |
| Tier | FEATURE |
| Date | 2026-10-04 |

## Components
| Component | Source in the spec |
|---|---|
| `apps/api/src/movements/infrastructure/http/tag-routes.ts`, `apps/api/src/movements/application/list-tags.ts` and `packages/shared/src/movements/tag.ts` | Block 1, Block 2, Block 3 |
| `apps/api/src/movements/infrastructure/db/drizzle-tag-repository.ts` | Block 2 |
| `apps/web/src/lib/local-store/database.ts` and `apps/web/src/lib/local-store/stores.ts` | Block 4 |
| `apps/web/src/lib/local-store/reference-cache.ts` and `apps/web/src/lib/local-store/session-pointer.ts` | Block 5 |
| `apps/web/src/features/movements/use-movement-form-data.ts` and `apps/web/src/lib/connectivity.ts` | Block 6 |
| `apps/web/src/features/movements/containers/movements-container.tsx` and `apps/web/src/features/shell/containers/authenticated-shell-container.tsx` | Block 7, Block 9, Block 10 |
| `apps/web/src/lib/service-worker/shell-cache.ts` and `apps/web/src/lib/content-security-policy.ts` | Block 8 |
| `apps/web/src/app/sw.ts`, `apps/web/src/app/serwist/[path]/route.ts` and `apps/web/next.config.ts` | Block 9 |
| `apps/web/src/lib/local-store/persistence.ts` and `apps/web/src/features/shell/components/storage-warning.tsx` | Block 10 |

## Trust boundaries
- Browser → API: `GET /tags/all` carries a session cookie over the public internet and returns the caller's own tag names.
- API → PostgreSQL: owner-scoped statements with bound parameters cross into the private database network.
- Page → IndexedDB and `localStorage`: scripts of the web origin read and write the copy of the user's financial data on the device; the browser isolates it per origin.
- Page ↔ service worker: the page sends `CACHE_URLS` messages and the service worker intercepts every navigation and static request of the origin, so it sits between the page and the network.
- Service worker → network: only the web origin is fetched and cached; the API origin is never cached.
- Device owner → browser profile: anyone with the unlocked device or the browser profile can read what the browser stores for the origin.

## STRIDE analysis
### `apps/api/src/movements/infrastructure/http/tag-routes.ts`, `apps/api/src/movements/application/list-tags.ts` and `packages/shared/src/movements/tag.ts`
- **Spoofing:** the route sits behind `requireSession` and `requireVerifiedEmail`, and the owner comes from the access policy scope, never from the query.
- **Tampering:** the route only reads; `limit` and `offset` are validated by the shared contract and unknown keys are stripped.
- **Repudiation:** a read of the caller's own tag names needs no audit line; the error middleware logs the request id and code of every rejected request.
- **Information Disclosure:** the page holds the caller's tags only, and a test with a second user checks that none of theirs appears (R-01); a failure answers `{ code }` and no tag name reaches a log.
- **Denial of Service:** a page is capped at 100 items with one query and one count, and the offset is bounded by the caller's own tag count (R-02).
- **Elevation of Privilege:** no field of the query widens the owner scope, and the use case passes the caller's scope to the repository unchanged.

### `apps/api/src/movements/infrastructure/db/drizzle-tag-repository.ts`
- **Spoofing:** both statements take the owner from the scope through `scopedTo`.
- **Tampering:** the statements are Drizzle builders with bound values; nothing in them is written.
- **Repudiation:** the repository logs nothing and the route does not log tag names.
- **Information Disclosure:** `listAll` selects only the name column of the owner's rows, so no id of another user and no row of another owner is returned.
- **Denial of Service:** the ordering uses the owner's rows only and the count is a single indexed aggregate over the owner's tags.
- **Elevation of Privilege:** there is no way to pass an owner into `listAll`, so the scope is the only filter.

### `apps/web/src/lib/local-store/database.ts` and `apps/web/src/lib/local-store/stores.ts`
- **Spoofing:** the database name carries the user id (`pesly-<userId>`), so one user's code path opens that user's copy only; a malformed id is refused before it becomes part of a name (R-03).
- **Tampering:** a script of the same origin can write the stores (R-06), and `replaceAll` is one transaction, so a failed write leaves the previous copy intact.
- **Repudiation:** the local copy holds data that already exists on the server, so no action on the device needs a separate audit trail.
- **Information Disclosure:** the copy is financial data kept on the device in plain form for the browser to read, under the per-origin isolation of IndexedDB (R-04, accepted).
- **Denial of Service:** a full disk or an evicted store surfaces as `LocalStoreUnavailable`, which the screens read as "no local copy" (R-09).
- **Elevation of Privilege:** nothing in the store grants access to the API; the session cookie is the only credential and it is not stored here.

### `apps/web/src/lib/local-store/reference-cache.ts` and `apps/web/src/lib/local-store/session-pointer.ts`
- **Spoofing:** the pointer names the last user who signed in on the device; editing it only selects which local database is opened and sends no request (R-08).
- **Tampering:** every stored record is parsed with the shared response contracts on read, so a record altered in DevTools that no longer parses is treated as missing.
- **Repudiation:** the cache is a copy of server data; the server stays the record of what the user did.
- **Information Disclosure:** the pointer holds a user id and a verified flag and nothing secret; the cache holds account names, balances, categories, tags, preferences and rates (R-04).
- **Denial of Service:** the movements copy is capped at 100 items and the reference data is small, so reading it is one bounded IndexedDB transaction.
- **Elevation of Privilege:** a verified flag in the pointer lets the shell render offline, but it unlocks no data that the device did not already hold, and the online session check runs again on reconnect (R-08).

### `apps/web/src/features/movements/use-movement-form-data.ts` and `apps/web/src/lib/connectivity.ts`
- **Spoofing:** the hook never builds a request for a user other than the signed-in one, and online it uses the API client with its own cookie.
- **Tampering:** online data is written through to the store as received, and the next online load replaces it.
- **Repudiation:** not applicable; the hook only reads and copies.
- **Information Disclosure:** the hook logs nothing, and an error state shows the generic message key, never a stored value.
- **Denial of Service:** offline it makes zero requests (D3), and online it pages tags 100 at a time with the existing loop.
- **Elevation of Privilege:** a failed request falls back to the same user's copy only, so a 401 still sends the user to sign in.

### `apps/web/src/features/movements/containers/movements-container.tsx` and `apps/web/src/features/shell/containers/authenticated-shell-container.tsx`
- **Spoofing:** offline, the shell trusts only the parsed pointer, and the first online check after reconnecting uses the session cookie (R-08).
- **Tampering:** a filtered list never overwrites the saved 100 movements, so a narrow view cannot shrink the copy.
- **Repudiation:** not applicable; the containers only render.
- **Information Disclosure:** the offline list shows the saved movements of the pointer's user on that device and nothing from the server; archived names show the placeholder.
- **Denial of Service:** the offline path is one IndexedDB read and no request, so it cannot overload the API.
- **Elevation of Privilege:** rendering offline never grants a server action: saving still needs the API, and a 401 online redirects to sign in.

### `apps/web/src/lib/service-worker/shell-cache.ts` and `apps/web/src/lib/content-security-policy.ts`
- **Spoofing:** only responses of the web origin are cacheable, and only a 200 non-redirected HTML document (R-05).
- **Tampering:** a message asking to cache a URL is accepted only for a same-origin path that starts with `/`, and the response must pass `isCacheableDocument` (R-10).
- **Repudiation:** the service worker logs nothing and keeps no record of who asked for a URL.
- **Information Disclosure:** the cached documents are the application shell, which carries no account data (data comes from the API and the per-user store), and the cached CSP header keeps its own nonce (R-05).
- **Denial of Service:** `worker-src 'self'` lets the worker load under `strict-dynamic`, and a wrong CSP is caught by its test instead of by users (R-07).
- **Elevation of Privilege:** `worker-src 'self'` allows only a same-origin worker, and the other directives (script nonce, `connect-src`, `object-src 'none'`) stay as they were.

### `apps/web/src/app/sw.ts`, `apps/web/src/app/serwist/[path]/route.ts` and `apps/web/next.config.ts`
- **Spoofing:** the worker is built from `apps/web/src/app/sw.ts` by the route handler and served from the web origin, so only the deployed build can supply it.
- **Tampering:** `Cache-Control: no-cache` on `/serwist/sw.js` makes the browser revalidate the worker, and a new version waits for the next start instead of replacing the running one (R-06).
- **Repudiation:** nothing the worker does needs attribution; it caches the shell and answers from it.
- **Information Disclosure:** the worker never fetches or stores the API origin, whose responses carry the user's data and cookies.
- **Denial of Service:** a broken worker could leave a device without the app, so the build fails when it cannot compile and the route is revalidated on every load (R-06).
- **Elevation of Privilege:** `Service-Worker-Allowed: /` widens the scope to the whole origin only for this one path, and the worker adds no permission beyond answering the origin's own requests.

### `apps/web/src/lib/local-store/persistence.ts` and `apps/web/src/features/shell/components/storage-warning.tsx`
- **Spoofing:** the Storage API answers about the current origin only.
- **Tampering:** the result is one of three values and no user text reaches it.
- **Repudiation:** not applicable; asking for persistence changes nothing the user did.
- **Information Disclosure:** the warning says that the browser may remove local data and shows no data.
- **Denial of Service:** a denied or rejected request shows the warning once per start and loops on nothing.
- **Elevation of Privilege:** persistent storage keeps the browser from evicting the origin's data; it grants no other permission.

## Data classification
| Data | Class | At rest | In transit |
|---|---|---|---|
| Tag names returned by `GET /tags/all` (free text chosen by the user) | PII | PostgreSQL volume encrypted at rest, read only through the owner-scoped repository; the copy on the device is covered by R-04 | TLS (production HTTPS guard), session cookie flagged Secure |
| Account names, balances, category names and tags copied to the device | financial | browser IndexedDB isolated per origin and per user database, on a disk that the device operating system encrypts where the user has it on (R-04, accepted) | TLS when fetched from the API |
| The 100 most recent movements copied to the device (amounts, dates, notes, rates) | financial | the same per-user IndexedDB database, capped at 100 items and replaced on every online load (R-04, accepted) | TLS when fetched from the API |
| Pointer `pesly.session` (user id and verified flag) | PII | browser `localStorage` of the origin, holding a user id and a flag and nothing that opens the API | stays on the device |
| Session cookie presented to `GET /tags/all` | credentials | not stored by this module; the identity module stores it hashed | TLS, cookie flagged Secure in production |
| Shell documents and static assets in the service worker cache | public | Cache Storage of the origin, holding the application shell that every visitor receives | TLS when fetched from the web origin |

## Risks and mitigations
| ID | Risk | STRIDE | Likelihood | Impact | Mitigation |
|---|---|---|---|---|---|
| R-01 | `GET /tags/all` returns the tags of another user | I | Low | High | Owner predicate through `scopedTo` in both statements, no owner parameter in `listAll`, and a route and repository test with a second user (Blocks 2, 3) |
| R-02 | A caller pages `GET /tags/all` to load the database | D | Low | Low | Page capped at 100, one query plus one count, owner-scoped, and the existing per-session access rules (Blocks 1, 3) |
| R-03 | A user's local copy is opened by another user of the same device | I | Medium | High | One database per user id, a pointer that names only the last user, the API session check on reconnect, and the wipe on confirmed sign out of DISC-001-04d (Blocks 4, 5) |
| R-04 | Financial data kept on the device is readable by someone with the unlocked device or the browser profile | I | Medium | Medium | Accepted risk, see below; the copy is limited to active reference data and 100 movements, and the wipe on sign out is DISC-001-04d |
| R-05 | The service worker serves a cached document that mixes users or leaks data | I | Low | Medium | Only 200 non-redirected HTML documents of the web origin are cached, they hold the shell and no account data, data comes from the per-user store, and the cached CSP header travels with its page (Blocks 8, 9) |
| R-06 | A stale or broken service worker keeps old assets or blocks the app | D | Low | High | `no-cache` on the worker script, a new worker waits for the next start, the build fails if the worker cannot compile, and the end-to-end flow runs against a production build (Blocks 9, 11) |
| R-07 | The CSP blocks the worker, or a script of the origin reads the local store | T | Low | High | `worker-src 'self'` with a test of every directive, the per-request nonce and `strict-dynamic` kept for scripts, and React text rendering for names and notes (Block 8) |
| R-08 | A user edits the pointer in `localStorage` to make the shell render as another user | S | Low | Low | The pointer only selects a local database on that device and sends no request; the online session check runs again on reconnect and a 401 signs the user out (Blocks 5, 7) |
| R-09 | The browser evicts the local store and the copy is lost | D | Medium | Medium | Persistent storage is requested, the user is warned when it is denied (FR-06), and offline with no copy the screens ask for one online visit (Blocks 6, 10) |
| R-10 | A script of the page asks the service worker to cache arbitrary URLs | T | Low | Low | `CACHE_URLS` accepts only same-origin paths starting with `/` and only cacheable HTML responses, and refuses everything else (Blocks 8, 9) |
| R-11 | Tag names or local data leak into logs or error messages | I | Medium | Medium | The route, repository, hook and service worker log nothing about tag names or stored values, a test checks the 500 body and the log, and error states use message keys (Blocks 3, 6) |
| R-12 | A new dependency brings a vulnerability or hostile code | T | Low | High | `@serwist/turbopack`, `serwist` and `esbuild` pinned to exact versions, `fake-indexeddb` as a dev dependency only, `pnpm audit --prod --audit-level high` clean and a SAST pass (Blocks 4, 9) |

## Accepted risks
### R-04
- **Accepted by:** the product owner, as the decision recorded in `docs/ddw/prd/prd-DISC-001-04a.md` (Out of Scope, "Encryption of local data beyond what the browser and operating system provide") and in the original PRD of 2026-09-25.
- **Justification:** offline entry needs the data readable by the app without the user typing a secret, so a key held by the app would protect nothing; the copy is limited to the user's active reference data and 100 movements, it lives in the browser's per-origin sandbox, and the sign-out wipe (DISC-001-04d) removes it from a shared device.
- **Review conditions:** revisited when DISC-001-04d lands, before the app supports group data on shared devices (PRD 05), and immediately if a vulnerability lets a script of the origin read IndexedDB.

## Supply chain
Three runtime packages are new in `apps/web`: `@serwist/turbopack` and `serwist` (the service worker, exact version 9.5.13) and `esbuild` (already allowed in `pnpm-workspace.yaml`, it compiles the worker). `fake-indexeddb` is a dev dependency for tests only and never ships. AGENTS.md names Serwist for the service worker, and `@serwist/next` was set aside because it needs webpack while the app builds with Turbopack. The audit and the SAST step cover them (R-12).

## Availability
The vectors are an expensive `GET /tags/all`, a service worker that fails to install or update, and a browser that evicts the local copy, covered by R-02, R-06 and R-09: a page cap and a count, a `no-cache` worker script that updates at the next start, and persistent storage with a warning. There is no migration: the only server change is a read route, so a failed deploy cannot change a stored movement, and rolling the ticket back is reverting the commits.

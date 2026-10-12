# Threat model DISC-001-09d: Reports Screens

| Field | Value |
|-------|-------|
| Ticket | DISC-001-09d |
| Spec | docs/ddw/specs/spec-DISC-001-09d.md |
| Tier | FEATURE |
| Date | 2026-10-12 |

## Components
| Component | Source in the spec |
|---|---|
| `apps/web/src/features/reports/report-filters-state.ts` | Block 1 |
| `apps/web/src/features/reports/report-adapters.ts` | Block 1 |
| `apps/web/src/features/reports/shares.ts` | Block 1 |
| `apps/web/src/lib/return-path.ts` | Block 1 |
| `apps/web/src/lib/api-client.ts` | Block 1 |
| `apps/web/src/features/reports/use-report.ts` | Block 2 |
| `apps/web/src/features/reports/load-account-options.ts` | Block 2 |
| `apps/web/src/features/reports/components/report-filters.tsx` | Block 2 |
| `apps/web/src/features/reports/components/report-states.tsx` | Block 2 |
| `apps/web/src/features/reports/categories/category-ring.tsx` | Block 3 |
| `apps/web/src/features/reports/income-expenses/month-bars.tsx` | Block 4 |
| `apps/web/src/features/reports/net-worth/net-worth-area-chart.tsx` | Block 5 |
| `apps/web/src/features/shell/containers/authenticated-shell-container.tsx` | Block 6 |
| `apps/web/src/features/auth/containers/sign-in-container.tsx` | Block 6 |
| `apps/web/test/reports-scans.test.ts` | Block 7 |
| `apps/web/e2e/support/reports.ts` | Block 8 |

## Trust boundaries
- Address bar and shared links to browser: the filters of a report (`from`, `to`, `accountId`, `tag`) and the
  `next` value of the sign-in page are typed or edited by anyone who can build a link; they are untrusted
  text until the shared query definitions of 09a (and the fixed allow-list for `next`) accept them.
- Browser to API: the three report reads carry the session cookie; the API's session check, owner scoping
  and 404 answer for data that is not the user's stay authoritative. No route, migration or dependency is
  added and nothing is written by this ticket.
- API response to the DOM and the SVG: category names, tags and account names are user-authored text that
  comes back in answers and is drawn as React text, in HTML and in SVG text nodes.
- Application to device storage: nothing is stored. Report figures live in React state only; the dashboard's
  session memory, `localStorage`, `sessionStorage`, IndexedDB, the Cache Storage and the service worker are
  not used for them (PRD decision 6).
- Test tooling to application: the end-to-end fixtures serve typed fake answers to a test browser only.

## STRIDE analysis
### `apps/web/src/features/reports/report-filters-state.ts`
- **Spoofing:** not applicable; the module is pure and the caller identity is the session cookie.
- **Tampering:** every address value is checked with the shared query definition of the report; a malformed
  date, a non-UUID account, an over-long or malformed tag, an unknown or repeated key is ignored on its own
  and never sent, so an edited address cannot add a query key or inject text such as `&`, `=` or `%0d%0a`
  into the request (values are set with `URLSearchParams`, which encodes them).
- **Repudiation:** not applicable; nothing is changed.
- **Information Disclosure:** the address holds only dates, an account id and a tag name; no amount, balance,
  email or token is ever placed in it, and the referrer rules of the web app stay in force. A shared link
  reveals the filter, never a figure.
- **Denial of Service:** work is constant per key; a long tag is dropped by the length rule before use.
- **Elevation of Privilege:** a tampered `accountId` of another user's account is only a UUID to the client;
  the API answers 404 and the screen shows the filter-gone alert (no 403, so no existence leak).

### `apps/web/src/features/reports/report-adapters.ts`
- **Spoofing:** not applicable.
- **Tampering:** amounts become `bigint` with `BigInt(text)` only after the api-client parsed them as integer
  strings; a body with a float, markup or a non-numeric amount fails parsing and never reaches the adapter.
  No amount is converted or summed across currencies.
- **Repudiation:** not applicable.
- **Information Disclosure:** the adapter keeps only the fields the screens draw and never logs a body.
- **Denial of Service:** linear in the rows of one answer, which the API bounds (at most 24 months).
- **Elevation of Privilege:** not applicable; the adapter grants nothing.

### `apps/web/src/features/reports/shares.ts`
- **Spoofing:** not applicable.
- **Tampering:** shares are bigint divisions; a total of 0 or less returns no shares instead of dividing by
  zero, and a negative or huge amount cannot produce `NaN` or a share above 100 (property test).
- **Repudiation:** not applicable.
- **Information Disclosure:** not applicable; pure function.
- **Denial of Service:** constant work per row.
- **Elevation of Privilege:** not applicable.

### `apps/web/src/lib/return-path.ts`
- **Spoofing:** not applicable.
- **Tampering:** the `next` value is accepted only when it equals one of four fixed report paths; absolute
  URLs, `//host`, backslashes, encoded variants, dot segments, queries and fragments give no return path, so
  the sign-in page cannot be used as an open redirect.
- **Repudiation:** not applicable.
- **Information Disclosure:** only a fixed pathname travels in the sign-in address, never the filters or a
  tag name.
- **Denial of Service:** constant work.
- **Elevation of Privilege:** a return path never skips authentication: it is used only after a successful
  sign-in, and the destination page still checks the session and the owner scoping.

### `apps/web/src/lib/api-client.ts`
- **Spoofing:** no user id is sent; the session cookie identifies the caller.
- **Tampering:** the query string is built from the defined keys of the typed query only, encoded by
  `URLSearchParams`; the answer is parsed with the shared response definitions, so a modified body becomes a
  generic failure and never partial data.
- **Repudiation:** not applicable; the three calls are reads.
- **Information Disclosure:** failures expose only catalog message keys, never server text, stack traces or
  ids; amounts and filters are never logged by the client.
- **Denial of Service:** one request per filter change and per retry, no polling or retry loop.
- **Elevation of Privilege:** the client decides no permission; a 401 leads to sign-in and a 404 to the
  filter-gone state.

### `apps/web/src/features/reports/use-report.ts`
- **Spoofing:** not applicable below the session; an expired session drops the state and redirects to sign-in.
- **Tampering:** a sequence counter makes the answer of a replaced request be discarded, so a slow older
  answer cannot overwrite a newer one with figures of another filter.
- **Repudiation:** not applicable.
- **Information Disclosure:** the earlier answer is dropped before a new key loads, on failure, offline and on
  401, so no earlier figure stays on screen or in memory longer than needed; nothing is written to storage,
  a cache or the service worker (decisions D6 and PRD 6). Offline sends no request and shows no figure.
- **Denial of Service:** exactly one request per key; the retry is single-flight (disabled while in flight);
  there are no timers.
- **Elevation of Privilege:** not applicable; the API scopes every read by owner.

### `apps/web/src/features/reports/load-account-options.ts`
- **Spoofing:** not applicable below the session.
- **Tampering:** the loop reads pages until an empty page or the stated total, so a lying total cannot make
  it loop forever; only ids and names from the parsed answers are kept.
- **Repudiation:** not applicable.
- **Information Disclosure:** it lists only the caller's own accounts (active and archived); names are used as
  option text, never as markup, and balances are not read.
- **Denial of Service:** two calls with bounded pages on mount only.
- **Elevation of Privilege:** not applicable.

### `apps/web/src/features/reports/components/report-filters.tsx`
- **Spoofing:** not applicable.
- **Tampering:** the date fields are checked with the range rules before they reach the container, and the
  account selector holds only ids of the loaded list or empty, so the control cannot produce an id the user
  does not own through the interface (an edited address is covered above).
- **Repudiation:** not applicable.
- **Information Disclosure:** account names are rendered as React text in option labels; an archived account
  gets a catalog suffix; no balance is shown.
- **Denial of Service:** one change event produces one container update.
- **Elevation of Privilege:** not applicable.

### `apps/web/src/features/reports/components/report-states.tsx`
- **Spoofing:** not applicable.
- **Tampering:** the empty state names the range by formatting two validated dates with the locale formatter;
  no unvalidated text is interpolated into a message.
- **Repudiation:** not applicable.
- **Information Disclosure:** error, offline and filter-gone states show catalog text only, with no amount,
  id, tag or server message.
- **Denial of Service:** not applicable.
- **Elevation of Privilege:** not applicable.

### `apps/web/src/features/reports/categories/category-ring.tsx`
- **Spoofing:** not applicable.
- **Tampering:** category names, which users author, render as React text in the legend and the accessible
  summary; no `dangerouslySetInnerHTML` and no string concatenated into markup (scan in Block 7). A name with
  markup, such as an image tag with an event handler, stays text.
- **Repudiation:** not applicable.
- **Information Disclosure:** the legend and list show only the caller's categories and amounts; the drawing
  is hidden from assistive technology and the same figures are in the list.
- **Denial of Service:** at most 6 segments.
- **Elevation of Privilege:** not applicable; the chart is read-only.

### `apps/web/src/features/reports/income-expenses/month-bars.tsx`
- **Spoofing:** not applicable.
- **Tampering:** bar heights come from a bigint division into a bounded integer permille, so a huge or equal
  series cannot produce `NaN` or an infinite coordinate; month labels come from the locale formatter applied to
  validated `YYYY-MM` values, and SVG text content is a React text node, never markup.
- **Repudiation:** not applicable.
- **Information Disclosure:** only the caller's months are drawn; the list below repeats the same figures.
- **Denial of Service:** at most 24 months drawn, no timers or animation loop.
- **Elevation of Privilege:** not applicable.

### `apps/web/src/features/reports/net-worth/net-worth-area-chart.tsx`
- **Spoofing:** not applicable.
- **Tampering:** values are drawn as returned; the selected index is clamped to the drawn points, so pointer
  and keyboard input cannot select a missing point; a point without a total is a gap and is never filled with
  another month's rate; SVG text (dates, values, tooltip) is React text.
- **Repudiation:** not applicable.
- **Information Disclosure:** the tooltip and the selected-point detail show only the user's own series; the
  tooltip is not written to any log or analytics call (no `console` call, scan in Block 7).
- **Denial of Service:** at most 24 points and one state update per pointer move.
- **Elevation of Privilege:** not applicable.

### `apps/web/src/features/shell/containers/authenticated-shell-container.tsx`
- **Spoofing:** the session check against the API stays authoritative; the container only adds the safe `next`
  value to the sign-in address.
- **Tampering:** the path used is the current pathname passed through the allow-list, never raw address text.
- **Repudiation:** not applicable.
- **Information Disclosure:** a signed-out visitor sees no figure; a redirect carries only a fixed path.
- **Denial of Service:** unchanged from today; one session check.
- **Elevation of Privilege:** a report route is still rendered only after the session is confirmed.

### `apps/web/src/features/auth/containers/sign-in-container.tsx`
- **Spoofing:** the credential flow is unchanged; only the destination after success changes.
- **Tampering:** `next` goes through `safeReturnPath`; a rejected value means `/`, so a phishing link cannot
  send a freshly signed-in user to another site.
- **Repudiation:** not applicable.
- **Information Disclosure:** the unverified-email destination still wins, and no return path is stored.
- **Denial of Service:** not applicable.
- **Elevation of Privilege:** not applicable; a return path grants no right.

### `apps/web/test/reports-scans.test.ts`
- **Spoofing:** not applicable; test code.
- **Tampering:** it reads repository files only and writes nothing.
- **Repudiation:** not applicable.
- **Information Disclosure:** it prints file paths and rule names, never data.
- **Denial of Service:** it runs inside the unit suite.
- **Elevation of Privilege:** not applicable; no package is added, so no third-party code enters the build.

### `apps/web/e2e/support/reports.ts`
- **Spoofing:** not applicable; test code against seeded fake users.
- **Tampering:** fixtures are parsed with the shared response definitions before a stub serves them; stubs
  exist only inside the test browser and are removed after each test.
- **Repudiation:** not applicable.
- **Information Disclosure:** fixtures hold invented figures and names only; the storage check asserts that
  no report figure is left in browser storage.
- **Denial of Service:** the suite keeps one worker.
- **Elevation of Privilege:** not applicable.

## Data classification
| Data | Class | At rest | In transit |
|---|---|---|---|
| Report answers (category amounts, income and expense per month, net worth points) | financial | PostgreSQL, managed encryption at rest; in the browser only in React state, never in storage, a cache or the service worker | HTTPS only |
| Account names and tag names shown in filters and legends | personal | PostgreSQL; in the browser only in memory; a tag or account id may appear in the page address | HTTPS only |
| Filters in the page address (`from`, `to`, `accountId`, `tag`) | personal | browser history and bookmarks of the user's own device | not sent anywhere but to the API as query values |
| Return path `next` (one of four fixed routes) | public | the sign-in address only | HTTPS only |

## Risks and mitigations
| ID | Risk | STRIDE | Likelihood | Impact | Mitigation |
|---|---|---|---|---|---|
| R-01 | A tampered address injects extra query keys or characters into the report request | T | Medium | Medium | Each value is checked with the shared query definition, unknown keys are dropped, values are encoded by `URLSearchParams` (Block 1 tests) |
| R-02 | A tampered `accountId` or `tag` reads another user's data | E | Low | High | The API owner scoping answers 404 and the screen shows the filter-gone alert; the client sends no user id (Blocks 1, 2) |
| R-03 | A stored category, tag or account name with markup runs script in the HTML or the SVG | T | Low | High | Names render as React text, including SVG text nodes; no raw HTML insertion; scan and a markup-name test (Blocks 3, 4, 5, 7) |
| R-04 | Report figures are kept on the device (storage, cache, service worker) and read by the next user | I | Low | High | State in React only, answers dropped on change, offline and 401; scan and a browser storage check (Blocks 2, 7, 8) |
| R-05 | Amounts or filters reach logs or analytics | I | Low | Medium | No `console` call or analytics code in the new files, failures show catalog keys only (Block 7 scan) |
| R-06 | The address or sign-in link exposes something sensitive or acts as an open redirect | I | Medium | Medium | The address holds no amount; `next` is an exact allow-list of four paths with no filters (Blocks 1, 6) |
| R-07 | A slow older answer replaces a newer one and shows figures of another filter | T | Medium | Medium | Sequence counter and discard of replaced answers (Block 2 test of two changes within a second) |
| R-08 | Rapid changes or a failing API are amplified into many requests | D | Low | Medium | One request per change, single-flight retry, no timers (Block 2 call-count tests) |
| R-09 | A float or a cross-currency sum makes a figure differ from the API | T | Medium | High | Amounts are `bigint`, shares are integer division, no conversion in the client; scan for `parseFloat`, `toFixed` and `Number(` (Blocks 1, 7) |
| R-10 | A hardcoded or one-language string, or an unreadable chart, ships | T | Medium | Low | Catalog parity test, no-literal scan, text on every mark and the contrast probe (Blocks 1, 7, 8) |

## Supply chain
No new runtime dependency and no new dev dependency: the charts are inline SVG with the existing theme tokens,
the filters reuse the existing presentational components and the single-tag input, and the browser tests use
the existing Playwright helpers. Block 7 compares the dependency lists of `apps/web/package.json` with the
recorded ones and `pnpm audit --prod --audit-level high` runs in the final verification.

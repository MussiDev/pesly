# Threat model DISC-001-09c: Dashboard Screens and Navigation

| Field | Value |
|-------|-------|
| Ticket | DISC-001-09c |
| Spec | docs/ddw/specs/spec-DISC-001-09c.md |
| Tier | FEATURE |
| Date | 2026-10-12 |

## Components
| Component | Source in the spec |
|---|---|
| `apps/web/src/lib/api-client.ts` | Block 0 |
| `apps/web/src/lib/dashboard-contract.ts` | Block 0 |
| `apps/web/src/features/dashboard/contract/dashboard-adapter.ts` | Block 0 |
| `apps/web/src/lib/theme.ts` | Block 2 |
| `apps/web/src/components/theme-provider.tsx` | Block 2 |
| `apps/web/src/features/dashboard/chart/net-worth-chart.tsx` | Block 4 |
| `apps/web/src/features/dashboard/components/categories-card.tsx` | Block 5 |
| `apps/web/src/features/dashboard/components/do-these-first.tsx` | Block 6 |
| `apps/web/src/features/dashboard/attention/use-queue-attention.ts` | Block 6 |
| `apps/web/src/features/dashboard/containers/dashboard-container.tsx` | Block 7 |
| `apps/web/src/features/dashboard/containers/dashboard-session-cache.ts` | Block 7 |
| `apps/web/e2e/support/contrast.ts` | Block 8 |

## Trust boundaries
- Browser → API: the dashboard calls the existing dashboard (09b) and net worth series (09a) reads with the
  session cookie; the API's session check, verified-email check and owner scoping stay authoritative. No
  endpoint, migration or dependency is added, and no write is made by this ticket.
- API response → view types: the answers are untrusted data until the provisional parser of Block 0 (and,
  after 09b merges, the shared schema) accepts them; the adapter is the only code that reads a raw field.
- Response ids and text → DOM and links: category, budget and entry names are rendered as text, and every
  link is built from a fixed route prefix and an id the parser proved to be a UUID.
- Device storage → screen: the theme choice in `localStorage` and the device-queue counts in IndexedDB
  are read as untrusted strings and numbers; the last answers of the session live only in memory.
- Test tooling → application: the end-to-end contrast probe reads computed styles in a test browser only.

## STRIDE analysis
### `apps/web/src/lib/api-client.ts`
- **Spoofing:** the caller identity is the session cookie; no user id is ever sent by the dashboard calls.
- **Tampering:** both answers are parsed before use (`getDashboard`, `getNetWorthSeries`); a modified or
  malformed body becomes a generic failure and never partial data. The two calls are reads with no query,
  so there is no request field to tamper with.
- **Repudiation:** not applicable on the client; the dashboard reads change nothing.
- **Information Disclosure:** failures expose only catalog message keys, never raw server text, stack
  traces or ids; amounts are never logged by the client.
- **Denial of Service:** exactly 2 requests on opening and 1 per retry, no polling or retry loop
  (single-flight retry), so the dashboard cannot amplify load on the API.
- **Elevation of Privilege:** the client never decides permissions; a 401 redirects to sign-in and a
  verified-email error is shown by key.

### `apps/web/src/lib/dashboard-contract.ts`
- **Spoofing:** not applicable; the module is a pure parser.
- **Tampering:** an amount is accepted only as an integer string within the 64-bit range, a percentage
  only as an integer, a status or currency only from its closed set, an id only as a UUID; anything else
  rejects the whole answer, so a forged or drifted body cannot inject a float, a string with markup in a
  numeric slot or a link target.
- **Repudiation:** not applicable.
- **Information Disclosure:** not applicable; no I/O and no logging of the body.
- **Denial of Service:** work is linear in the bounded lists (at most 20 upcoming, 20 actions, 3
  budgets), and the 32 KB response bound of 09b limits the parse cost.
- **Elevation of Privilege:** not applicable. The module is provisional (D1) and deleted when the shared
  schema lands, which removes the risk of two parsers drifting apart.

### `apps/web/src/features/dashboard/contract/dashboard-adapter.ts`
- **Spoofing:** not applicable; the module is pure.
- **Tampering:** amounts become `bigint` with `BigInt(text)` only after the parser proved an integer
  string; no amount is added, subtracted, divided or converted, and no `Number(`, `parseFloat` or
  `toFixed` is applied to money (scan in Block 8). Links come only from fixed prefixes and UUID ids, with
  a fallback to `/recurring` or `/cards`, so a response cannot make a link leave the application.
- **Repudiation:** not applicable.
- **Information Disclosure:** an unknown category key falls back to the response's own name or a generic
  label; no internal key or id is shown as text.
- **Denial of Service:** constant work per row.
- **Elevation of Privilege:** not applicable; the adapter grants nothing, and the API answers 404 for data
  that is not the user's.

### `apps/web/src/lib/theme.ts`
- **Spoofing:** not applicable.
- **Tampering:** the stored theme is read as an unknown string and accepted only when it is exactly
  `light` or `dark`; any other value (tampered, legacy `system`) means no choice. The pre-paint script is
  a constant string rendered under the CSP nonce, so nothing variable enters inline script.
- **Repudiation:** not applicable.
- **Information Disclosure:** the theme is not personal data; the key `pesly-theme` holds one word.
- **Denial of Service:** constant work.
- **Elevation of Privilege:** not applicable; changing the stored value only changes colors on the user's
  own device.

### `apps/web/src/components/theme-provider.tsx`
- **Spoofing:** not applicable.
- **Tampering:** every `localStorage` read and write is guarded; a blocked or throwing storage keeps the
  choice in memory for the session and the page does not fail. Choosing "system" removes the key.
- **Repudiation:** not applicable.
- **Information Disclosure:** the choice is device-local and shared by every account on that device (PRD
  decision 2); it holds no account data and is kept across sign-out on purpose (AC-44).
- **Denial of Service:** one `prefers-color-scheme` listener, removed on unmount.
- **Elevation of Privilege:** not applicable.

### `apps/web/src/features/dashboard/chart/net-worth-chart.tsx`
- **Spoofing:** not applicable below the session.
- **Tampering:** values are shown as returned; the geometry works on `bigint` values and a bounded integer
  permille, so a huge or equal-valued series cannot produce `NaN` or an infinite coordinate. Pointer and
  keyboard input only select an index among the drawn points and is clamped.
- **Repudiation:** not applicable.
- **Information Disclosure:** the tooltip and the points list show only the user's own series; the
  points list gives assistive technology the same data, with no hidden extra fields.
- **Denial of Service:** at most 24 points (the 09a limit, 12 by default) and no animation loop or
  timer; pointer move updates one state value.
- **Elevation of Privilege:** not applicable; the chart is read-only.

### `apps/web/src/features/dashboard/components/categories-card.tsx`
- **Spoofing:** not applicable below the session.
- **Tampering:** category and budget names that come from the database render as React text, never as raw
  HTML, so stored markup cannot execute (scan for `dangerouslySetInnerHTML` in Block 8); a bar width is a
  whole-number share clamped by the response's own bound and set as a style value, not as a class built
  from text.
- **Repudiation:** not applicable.
- **Information Disclosure:** the card shows only what the response carries for the caller; an empty list
  shows a message, never data of another user.
- **Denial of Service:** the number of rows is bounded by the API's response size limit.
- **Elevation of Privilege:** not applicable; the card has no action beyond links.

### `apps/web/src/features/dashboard/components/do-these-first.tsx`
- **Spoofing:** not applicable below the session.
- **Tampering:** each item links to a route built by the adapter or to `/movements` or `/groups`; item
  text comes from catalog labels plus names rendered as text. An unknown action kind gets the generic label
  and the fallback link, so a drifted response cannot create a broken or foreign link.
- **Repudiation:** not applicable.
- **Information Disclosure:** the list never shows more than the API returned and the local counts; push
  notification rules (no amounts or names) are untouched because no notification is sent here.
- **Denial of Service:** at most 20 server items plus 3 queue items.
- **Elevation of Privilege:** the links only navigate; each destination page enforces its own owner
  scoping and 404 answers.

### `apps/web/src/features/dashboard/attention/use-queue-attention.ts`
- **Spoofing:** the queue is read for the user id of the session pointer; the pointer is the same source
  the shell uses, and the counts of another user's queue are never read.
- **Tampering:** only counts are read from IndexedDB (`readQueueCounts`, `readGroupQueueCounts`); a
  corrupt or unreadable queue counts as empty and the hook still becomes ready, so a damaged store cannot
  block the dashboard.
- **Repudiation:** not applicable; the hook changes nothing in the queue.
- **Information Disclosure:** only three integers leave the module; no movement, amount or account name is
  read, and nothing is sent over the network.
- **Denial of Service:** one read at mount and one per queue event, the same cost as the shell's.
- **Elevation of Privilege:** not applicable.

### `apps/web/src/features/dashboard/containers/dashboard-container.tsx`
- **Spoofing:** not applicable below the session; an expired session redirects to sign-in and renders no
  amount.
- **Tampering:** the container sends the two reads together and nothing else for figures (call-count
  test), and shows a failure of the dashboard as an error state rather than a half-filled screen; a
  failure of the series alone leaves the other widgets and shows a retry in the chart's place. A response
  of a superseded attempt is ignored so a slow older answer cannot replace a newer one.
- **Repudiation:** not applicable.
- **Information Disclosure:** the error and offline states show catalog messages and no amount; the old
  home's profile and account requests are gone, so fewer figures cross the wire.
- **Denial of Service:** retry is single-flight (disabled while in flight); no polling or refresh timer.
- **Elevation of Privilege:** not applicable; the API scopes every read by owner, and the container holds
  no permission logic.

### `apps/web/src/features/dashboard/containers/dashboard-session-cache.ts`
- **Spoofing:** the stored answers are keyed by the user id of the session pointer and read only when the
  same id is the current one, so user B on the same tab never sees user A's data.
- **Tampering:** the store lives in module memory and takes only answers that passed the parser; nothing
  outside the container writes to it.
- **Repudiation:** not applicable.
- **Information Disclosure:** financial data stays in memory only (no `localStorage`, `sessionStorage` or
  IndexedDB), so it is gone on reload or tab close; it is shown only when a request fails offline, with an
  out-of-date notice, and it is not read at all when the session pointer is gone. Residual risk: after a
  sign-out without a page reload, the previous user's answers stay in memory until the tab reloads; they
  are unreachable by the next user because of the id key (R-04).
- **Denial of Service:** one pair of answers per user id, replaced on every success.
- **Elevation of Privilege:** not applicable.

### `apps/web/e2e/support/contrast.ts`
- **Spoofing:** not applicable; test code only.
- **Tampering:** the probe only reads computed styles in a test browser and writes nothing to the page or
  the database.
- **Repudiation:** not applicable.
- **Information Disclosure:** it runs against the e2e database with seeded fake users and logs element
  names and colors only, never real data.
- **Denial of Service:** it runs inside the e2e suite, which already uses one worker.
- **Elevation of Privilege:** not applicable; no new package is added (D11), so the test tooling brings no
  new third-party code into the build.

## Data classification
| Data | Class | At rest | In transit |
|---|---|---|---|
| Net worth, month figures, categories, budgets, upcoming entries, group balances, insight | financial | PostgreSQL, managed encryption at rest; in the browser only in memory | HTTPS only |
| Net worth series points (dates and amounts) | financial | PostgreSQL and daily snapshots, managed encryption at rest; in the browser only in memory | HTTPS only |
| Device-queue counts (failed movements, failed and conflicting group changes) | financial | IndexedDB on the device, wiped on sign-out (PRD 04); only integers are read | not transmitted |
| Theme choice (`pesly-theme`) | public | `localStorage` on the device, kept across sign-out by design | not transmitted |

## Risks and mitigations
| ID | Risk | STRIDE | Likelihood | Impact | Mitigation |
|---|---|---|---|---|---|
| R-01 | A drifted or tampered 09b response puts a float, markup or a foreign link on screen | T | Medium | Medium | The parser accepts only integer strings, closed sets and UUIDs and rejects the whole answer otherwise; the adapter builds links from fixed prefixes; names render as text (Blocks 0, 5, 6; scans in Block 8) |
| R-02 | A displayed figure is recomputed on the client and disagrees with the API or with float rounding | T | Medium | High | Amounts are `bigint` from the response and only formatted; chart geometry uses bigint permille; scan for `parseFloat`, `toFixed` and `Number(` in every touched file (Blocks 0, 4, 8) |
| R-03 | A stored name with markup runs script in the page | T | Low | High | Names and messages render as React text, no `dangerouslySetInnerHTML` (scan in Block 8); the CSP nonce rule for the constant pre-paint script is kept (Block 2) |
| R-04 | The out-of-date copy shows one user's figures to another user of the same tab | I | Low | High | Memory only, keyed by the session pointer's user id, read only offline after a network failure, never persisted (Block 7 tests include another user's id) |
| R-05 | Stale data after a failed refresh looks current and misleads a decision | I | Medium | Medium | A visible out-of-date notice whenever the store is used; a successful reload replaces it at once (Block 7) |
| R-06 | A failed device change is hidden from the user, or the queue read blocks the screen | T | Low | Medium | Queue items are read locally, work offline, and an unreadable queue counts as empty without blocking (Block 6); the list renders again when the queue changes |
| R-07 | A second request, retry storm or polling loop loads the API from every open home page | D | Low | Medium | Exactly 2 requests on opening, single-flight retry, no timers (Block 7 call-count test) |
| R-08 | A tampered `pesly-theme` value breaks the theme or the pre-paint script | T | Low | Low | Only `light` or `dark` are accepted; the inline script is constant and guarded by try/catch; blocked storage falls back to the system setting (Block 2 tests) |
| R-09 | The breakpoint change leaves a page unusable between 900 and 1023 px | T | Medium | Low | One token and one hook query move together; the 5-width, 2-theme browser test covers 1023 and 1024 px on the dashboard and the navigation (Blocks 1, 8) |
| R-10 | A hardcoded or one-language string, or a color failing contrast, ships | T | Medium | Low | Catalog parity and no-literal scans, text on every chip and pill, and the contrast probe on every state in both themes (Blocks 0, 3, 5, 8) |

## Supply chain
No new runtime dependency and no new dev dependency: the chart is inline SVG, the contrast probe is
in-repo code (D11), and the screens use React, the existing design-system components, `@pesly/shared` and
the existing api-client. `apps/web/package.json` is compared with its recorded dependency list in Block 8.

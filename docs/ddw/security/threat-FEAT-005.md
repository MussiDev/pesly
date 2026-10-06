# Threat model FEAT-005: Professional UX/UI redesign with merchant and asset logos

| Field | Value |
|-------|-------|
| Ticket | FEAT-005 |
| Spec | docs/ddw/specs/spec-FEAT-005.md |
| Tier | FEATURE |
| Date | 2026-10-05 |

## Components

The redesign adds no API route, database change, shared contract or runtime dependency, so the
components below are the ones with a security-relevant surface. Blocks 3, 8, 10 and 11 only restyle
existing components through tokens and classes, keep every request and validation rule, and add no
data flow; they are not listed.

| Component | Source in the spec |
|---|---|
| `apps/web/src/lib/logos/resolve-merchant.ts` | Block 5 |
| `apps/web/src/lib/logos/resolve-asset.ts` | Block 5 |
| `apps/web/public/logos/` | Block 5 |
| `apps/web/next.config.ts` | Block 5 |
| `apps/web/src/components/ui/avatar.tsx` | Block 2 |
| `apps/web/src/components/ui/donut-chart.tsx` | Block 2 |
| `apps/web/src/features/movements/initial-type.ts` | Block 7 |
| `apps/web/src/app/[locale]/(app)/movements/new/page.tsx` | Block 7 |
| `apps/web/src/features/investments/composition.ts` | Block 9 |
| `apps/web/src/features/shell/components/top-nav.tsx` | Block 4 |
| `apps/web/src/app/[locale]/layout.tsx` | Block 1 |

## Trust boundaries

- Browser → API (HTTPS, unchanged): movements, accounts and holdings already travel here today; this change adds no request and changes no payload.
- Browser → Next.js server: the new-movement page reads one URL query value, `type`, which the user's browser controls; Server Components never touch financial data.
- Browser → same-origin static assets: `/logos/*.svg` is requested by `<img>` and can also be opened directly as a document, which the proxy matcher does not cover because the path contains a dot.
- Repository → runtime: logo files copied from a third-party icon set cross into the app at development time and are served as trusted same-origin files.
- Browser → build-time font host: `next/font` downloads Plus Jakarta Sans during the build and the app serves it from its own origin; nothing is requested from the font host at runtime.

## STRIDE analysis

### `apps/web/src/lib/logos/resolve-merchant.ts`
- **Spoofing:** a note can contain a brand name and so show that brand's logo; only the owner's own notes feed the matching and the note stays visible beside the logo (R-03).
- **Tampering:** the function reads the note and returns a catalog entry; it writes nothing and builds no path, HTML or regular expression from the note.
- **Repudiation:** no state changes and no privileged action happens here, so there is nothing to log or deny.
- **Information Disclosure:** the note is matched in the browser and never sent anywhere new; the resolved logo path is a catalog constant.
- **Denial of Service:** matching is linear in note length times keyword count, with no backtracking, over notes capped at 500 code points by the API contract (R-02).
- **Elevation of Privilege:** the function runs with the page's existing privileges and grants no new capability.

### `apps/web/src/lib/logos/resolve-asset.ts`
- **Spoofing:** a ticker equal to a well-known symbol shows that asset's logo; the ticker and instrument name stay visible in the row, and holdings are owner-scoped.
- **Tampering:** the ticker is trimmed and upper-cased for comparison only; it is never used to build a path or markup.
- **Repudiation:** read-only lookup, nothing to log.
- **Information Disclosure:** the ticker never leaves the browser because of this function; no request is made to resolve a logo (R-05).
- **Denial of Service:** one lookup per holding over a small fixed catalog.
- **Elevation of Privilege:** no capability is added.

### `apps/web/public/logos/`
- **Spoofing:** a file named like a brand could carry another image; the catalog is the only mapping, and every file is reviewed in the pull request and recorded in `NOTICE.md` (R-06).
- **Tampering:** an SVG with a script, an event attribute, a `foreignObject` or an external URL could run code or call out; the integrity test rejects all of them and files load through `<img>`, where scripts never run (R-01).
- **Repudiation:** every file's source, license and retrieval date are written in `NOTICE.md`, so its origin cannot be denied later.
- **Information Disclosure:** files are public static assets with no user data.
- **Denial of Service:** each file is at most 10 KB and lazy-loaded, so a page never requests the whole set.
- **Elevation of Privilege:** an SVG opened directly as a document would run in the app origin; the sandboxing policy header on `/logos/:path*` removes that route (R-01).

### `apps/web/next.config.ts`
- **Spoofing:** the new header rule only adds a response header and creates no identity or trust relationship.
- **Tampering:** a weaker or missing rule would reopen R-01; the header test fails if the rule is absent or lacks `sandbox` or `default-src 'none'`.
- **Repudiation:** the configuration is versioned in git, so every change to a header is attributable.
- **Information Disclosure:** the rule sends a fixed policy string; it exposes nothing about users.
- **Denial of Service:** one extra static header on one path prefix has no measurable cost.
- **Elevation of Privilege:** the policy lowers privilege (sandbox and a deny-by-default source list) for logo documents; the existing site-wide headers keep applying to every path.

### `apps/web/src/components/ui/avatar.tsx`
- **Spoofing:** the component renders only the `src` its caller passes, and callers pass catalog constants.
- **Tampering:** `src` is set as an attribute on an `<img>`, never as HTML, and the alternative text is empty.
- **Repudiation:** a purely visual component with no action to attribute.
- **Information Disclosure:** the image is requested from the app's own origin under `img-src 'self' blob: data:`, so no third party learns what the user buys (R-05).
- **Denial of Service:** the fixed box and the lazy loading prevent layout thrash, and a failed image falls back after a single error event.
- **Elevation of Privilege:** no capability is added; the image element cannot execute script.

### `apps/web/src/components/ui/donut-chart.tsx`
- **Spoofing:** the chart shows only the segments its parent computed from the user's own holdings.
- **Tampering:** weights are accepted only as finite non-negative integers and anything else is dropped before drawing (R-07).
- **Repudiation:** a presentational component; nothing is recorded or denied.
- **Information Disclosure:** the legend repeats what the screen already shows to the same user.
- **Denial of Service:** the number of arcs is bounded by the number of instrument types, a short fixed list.
- **Elevation of Privilege:** no capability is added; the SVG is built from numbers and token classes, never from strings of markup.

### `apps/web/src/features/movements/initial-type.ts`
- **Spoofing:** a crafted link can only pick one of four screen presets for the person who opens it; it carries no identity.
- **Tampering:** only the exact values `expense`, `income`, `transfer` and `exchange` pass; an array, an empty, an unknown or a differently cased value falls back to `expense` (R-04).
- **Repudiation:** the preset changes no stored data; saving still goes through the existing authenticated request.
- **Information Disclosure:** the value is a public enum and holds no user data.
- **Denial of Service:** the parser is a constant-time membership check on one value.
- **Elevation of Privilege:** the preset cannot reach edit mode or another user's movement, because edit mode keeps its type locked and its own route.

### `apps/web/src/app/[locale]/(app)/movements/new/page.tsx`
- **Spoofing:** the page still sits behind the existing authenticated shell and session check.
- **Tampering:** it passes the already-parsed type down and never echoes the raw query value into markup (R-04).
- **Repudiation:** creating a movement keeps its existing authenticated, logged API call.
- **Information Disclosure:** the Server Component reads only the `type` query value and fetches no financial data, as the architecture rules require.
- **Denial of Service:** one extra property read per request.
- **Elevation of Privilege:** the page grants no capability; the API keeps owner-scoping every query.

### `apps/web/src/features/investments/composition.ts`
- **Spoofing:** it consumes the typed API response and cannot be addressed by another actor.
- **Tampering:** each value is parsed with the shared integer string schema and non-positive or malformed values are dropped; shares use `bigint` division with the leftover on the largest share, so the chart cannot drift from the real values (R-07).
- **Repudiation:** a pure calculation with no side effect to record.
- **Information Disclosure:** it displays only the user's own holdings, already loaded on the screen.
- **Denial of Service:** the work is linear in the number of holdings of one portfolio.
- **Elevation of Privilege:** no capability is added; the function has no I/O.

### `apps/web/src/features/shell/components/top-nav.tsx`
- **Spoofing:** it renders only for an authenticated session; the session check of the shell runs before it.
- **Tampering:** destinations are fixed hrefs, and `currentPath` is only compared with them and never rendered or used to build a link.
- **Repudiation:** sign out keeps the existing handler and the server-side session end, so the action stays attributable to the session (R-08).
- **Information Disclosure:** it shows the brand and destination names only, no account data.
- **Denial of Service:** a static list of links with no request.
- **Elevation of Privilege:** it reuses the same sign-out control and handler as before, with no new request or permission (R-08).

### `apps/web/src/app/[locale]/layout.tsx`
- **Spoofing:** the layout only swaps the font import and keeps the existing provider and theme script.
- **Tampering:** the theme script keeps its CSP nonce, and `next/font` self-hosts the file, so no inline style or third-party host is introduced.
- **Repudiation:** nothing user-driven happens in the layout.
- **Information Disclosure:** the font is no longer requested at runtime from a third party, so no visitor address reaches a font host.
- **Denial of Service:** a failed download stops the build instead of degrading a running page.
- **Elevation of Privilege:** the layout keeps the nonce-based script policy; no inline script is allowed.

## Data classification

| Data | Class | At rest | In transit |
|---|---|---|---|
| Movement note | PII (free text the user writes, may name people or places) | no new storage: it stays in the existing movements store, whose encryption at rest is unchanged by this work | TLS (HTTPS) between browser and API, unchanged |
| Balances, holding values and tickers | financial | read-only display of data already loaded; nothing new is stored, and the existing store's encryption at rest is unchanged | TLS (HTTPS) between browser and API, unchanged |
| Movement type query value | public | not stored | URL on HTTPS, contains no secret |
| Logo files, catalogs and `NOTICE.md` | public | static files in the repository and the build output | HTTPS from the app's own origin |

## Risks and mitigations

| ID | Risk | STRIDE | Likelihood | Impact | Mitigation |
|---|---|---|---|---|---|
| R-01 | A logo SVG carrying a script runs in the app origin when opened directly as a document | T | L | H | The integrity test rejects `<script>`, event attributes, `foreignObject` and external URLs in every file; `next.config.ts` sends a sandboxing `Content-Security-Policy` on `/logos/:path*` (spec Block 5) and a header test guards it; images load through `<img>`, where scripts never run |
| R-02 | A long or crafted note slows the merchant matching | D | L | L | No regular expression is built from catalog or note content; tokenization and matching are linear; the note is capped at 500 code points by the API contract; a test feeds control characters and a maximum-length note |
| R-03 | A note crafted to show a trusted brand's logo, as a visual spoof | S | L | L | Movements are owner-scoped, so only the owner's own notes feed the matching; the note stays visible in the row and the image has empty alternative text; to be revisited when group expenses show other members' notes |
| R-04 | The `type` query value is reflected, or an array or oversized value breaks the page | T | L | M | `parseInitialType` accepts only four exact values and falls back to `expense`; the raw value is never rendered or placed in a URL; sad-path tests cover missing, unknown, mixed-case and repeated values |
| R-05 | Logos or fonts fetched from a third party leak what the user buys or add a tracking vector | I | M | M | Logo paths are catalog constants under `/logos/`; `img-src 'self' blob: data:` stays unchanged and is asserted by test; the font is self-hosted by `next/font`; no runtime request to a logo or font host (AC-03, AC-26) |
| R-06 | A tampered or mislicensed logo file enters through the copy step | T | L | M | Files are committed and reviewed in the pull request; `NOTICE.md` records source, license and date; the integrity test checks size and content; no package is added; an entry without a cleared logo is not shipped |
| R-07 | The investments chart misleads: values of different currencies added, or rounding changes the shares | T | M | M | One donut per valuation currency; shares in integer basis points with `bigint` division and the leftover on the largest share; malformed values excluded; tests assert each currency sums to exactly 10000 |
| R-08 | The relocated sign-out control loses its handler or its failure alert | E | L | M | The top navigation reuses the same sign-out control and handler with no new request; Block 4 tests the error alert above the content |

## Supply chain

No runtime dependency is added to any `package.json` (NFR-04). The logo files are copied from a
public icon set whose files are licensed CC0-1.0, with trademarks staying with their owners; the
implementer checks the upstream license text at copy time and records it in `NOTICE.md`. The font is
downloaded at build time by `next/font`, as Inter was before, and then served from the app's own
origin. The residual risk is a tampered or mislicensed file, handled by R-06.

## Availability

Logos are static files of at most 10 KB loaded lazily, so no page requests the whole set. Merchant
matching and the composition calculation are linear over short inputs and make no request. The change
adds no API call, so it opens no new denial-of-service route; the platform's edge limits and the API's
own limits are unchanged.

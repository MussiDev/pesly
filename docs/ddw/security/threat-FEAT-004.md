# Threat model FEAT-004: Pesly design system and UX/UI overhaul

| Field | Value |
|-------|-------|
| Ticket | FEAT-004 |
| Spec | docs/ddw/specs/spec-FEAT-004.md |
| Tier | FEATURE |
| Date | 2026-10-03 |

## Components
| Component | Source in the spec |
|---|---|
| `apps/web/src/app/[locale]/layout.tsx` (pre-paint theme script, `x-nonce`, `next/font`) | Block 1 |
| `apps/web/src/lib/theme.ts` and `apps/web/src/components/theme-provider.tsx` | Block 1 |
| `apps/web/src/app/[locale]/design-system/page.tsx` | Block 1 |
| `apps/web/src/features/shell/components/side-nav.tsx` and `more-menu.tsx` (the shell and the `/more` route) | Block 2 |
| `apps/web/src/features/auth/components/google-sign-in-button.tsx` (brand logo literals) | Block 3 |
| `apps/web/src/features/home/containers/home-container.tsx` | Block 7 |
| `apps/web/test/design-system-scan.test.ts` (NFR-05 scan and its allowlist) | Block 8 |

## Trust boundaries
- Server (Next.js, nonce from `proxy.ts`) → browser: the layout sends an inline script, which the
  browser runs only when the CSP nonce matches.
- Browser `localStorage` → page script: the stored `pesly-theme` value is read back and is
  controllable by anything running on the origin.
- Browser → Express API at `API_ORIGIN`: the home container calls `listAccounts` (active and
  archived), `listCategories` (active and archived), `listMovements` and `getProfile` with session
  cookies, carrying financial data and the user's time zone.
- Production runtime → development-only route: `/design-system` must not be reachable once
  `NODE_ENV` is `production`.
- Build environment → third-party font host: `next/font/google` downloads Inter at build time.

## STRIDE analysis
### `apps/web/src/app/[locale]/layout.tsx` (pre-paint theme script, `x-nonce`, `next/font`)
- **Spoofing:** a page cannot pose as another origin through the script; the script only toggles a
  class on `<html>` and sets no cookie.
- **Tampering:** the inline script is a constant string with no interpolation of request or stored
  data, so nothing attacker-controlled enters executable text (R-01); only the nonce attribute
  varies per request.
- **Repudiation:** the script performs no user action, so there is nothing to attribute or log.
- **Information Disclosure:** the script reads only the theme value and writes only a class; it
  touches no session or financial data, and the nonce is not logged.
- **Denial of Service:** if `x-nonce` is missing the CSP blocks the script and the page falls back
  to the system theme with a flash, never a crash (R-05).
- **Elevation of Privilege:** `strict-dynamic` with a per-request nonce means an injected script
  without the nonce does not run; the layout adds no `unsafe-inline` for scripts.

### `apps/web/src/lib/theme.ts` and `apps/web/src/components/theme-provider.tsx`
- **Spoofing:** not applicable to identity; the theme is a cosmetic preference with no authority
  attached to it.
- **Tampering:** another script on the origin can rewrite `pesly-theme`, so `parseTheme` accepts
  only `light`, `dark` and `system` and returns `system` for anything else (R-02).
- **Repudiation:** a theme change is a local preference with no business effect, so no audit
  record is needed.
- **Information Disclosure:** the key holds one of three words and is not sensitive; balances and
  movements are never written to `localStorage` by this ticket (R-04).
- **Denial of Service:** `localStorage` access that throws is caught, and the provider keeps the
  theme in memory so rendering is unaffected.
- **Elevation of Privilege:** the stored value never reaches `dangerouslySetInnerHTML` or a
  selector; it only chooses between two fixed class states.

### `apps/web/src/app/[locale]/design-system/page.tsx`
- **Spoofing:** the page has no authentication-dependent content, so there is no identity to spoof.
- **Tampering:** the page is read-only and renders static tokens and components; it accepts no
  input.
- **Repudiation:** the page performs no action, so there is nothing to log.
- **Information Disclosure:** exposing the internal component inventory in production would aid
  reconnaissance; the page calls `notFound()` when `NODE_ENV` is `production` and a test asserts
  the 404 (R-03).
- **Denial of Service:** the page renders every variant in both themes, which is heavier than a
  normal page; it is unreachable in production, so it carries no production load.
- **Elevation of Privilege:** the page grants no capability and calls no API, so reaching it in
  development gives no access.

### `apps/web/src/features/shell/components/side-nav.tsx` and `more-menu.tsx` (the shell and the `/more` route)
- **Spoofing:** the shell mounts its children only after the existing session check succeeds, so a
  user without a session or with an unverified email is redirected before any screen requests
  data; the redesign draws a frame and skeleton meanwhile and does not change how the session is
  established.
- **Tampering:** links are static route strings from `nav-items.ts`; no URL is built from user
  input.
- **Repudiation:** sign-out and navigation are unchanged and the API keeps its own audit trail.
- **Information Disclosure:** the shell renders navigation labels only and no account names or
  amounts.
- **Denial of Service:** a failed session check shows the shared error state with a retry button;
  the retry is disabled while the request is in flight (R-08).
- **Elevation of Privilege:** hiding or showing a link is not authorization; every protected page
  still calls the API, which scopes every query to the owner and answers 404 for foreign data
  (R-09).

### `apps/web/src/features/auth/components/google-sign-in-button.tsx` (brand logo literals)
- **Spoofing:** the button starts the existing Google OAuth flow through `google-start-url.ts`,
  unchanged; the restyle adds no new redirect target.
- **Tampering:** the four brand hex fills are inline SVG attributes, constant at build time.
- **Repudiation:** sign-in attempts are logged by the API as today.
- **Information Disclosure:** the button renders no user data.
- **Denial of Service:** a failed start shows the existing auth error alert; behavior is unchanged.
- **Elevation of Privilege:** the NFR-05 allowlist exempts only this file from the color-literal
  scan, so the exception cannot grant privilege and is kept to one entry (R-06).

### `apps/web/src/features/home/containers/home-container.tsx`
- **Spoofing:** the container uses the injected API client with `credentials: 'include'`; on an
  `UNAUTHENTICATED` result it redirects to `/sign-in` and renders nothing.
- **Tampering:** responses are parsed with `listAccountsResponseSchema`,
  `listMovementsResponseSchema` and the categories and profile schemas from `packages/shared`, so a
  malformed payload is rejected instead of rendered, and a malformed amount string renders a
  placeholder instead of crashing the screen.
- **Repudiation:** the home only reads; mutations stay in screens whose API calls the API audits.
- **Information Disclosure:** balances and movements are fetched client-side from the API only,
  held in React state and never written to storage; on error no stale balance is shown, and the
  Server Component `page.tsx` touches no financial data (R-04).
- **Denial of Service:** the home issues six requests per load, all in one parallel batch, each
  with a fixed limit (100 for the account and category lists, 5 for movements) and no polling, and
  the retry button is disabled while a request is in flight, so one click sends one batch (R-08).
- **Elevation of Privilege:** the API scopes accounts and movements to the owner and answers 404
  for anything else; the container cannot request another user's data by construction (R-09).

### `apps/web/test/design-system-scan.test.ts` (NFR-05 scan and its allowlist)
- **Spoofing:** the test has no identity surface.
- **Tampering:** widening the allowlist would silently hide hardcoded colors, so the allowlist is
  one named file and a planted-literal test proves the scan still fails elsewhere (R-06).
- **Repudiation:** a failure names the file and line, so who introduced a literal is visible in
  review history.
- **Information Disclosure:** the scan reads source files only and emits no secret.
- **Denial of Service:** the scan walks two directories and runs in milliseconds, so it cannot slow
  the suite.
- **Elevation of Privilege:** the test runs with no privileges beyond reading the repository.

## Data classification
| Data | Class | At rest | In transit |
|---|---|---|---|
| Account balances and movements shown on the home | financial | not stored by the web app (React state only, never `localStorage` or IndexedDB); API-side storage is unchanged | TLS (HTTPS) to `API_ORIGIN` |
| Session cookies | credentials | HttpOnly cookie held by the browser and never readable by the page script; API-side handling is unchanged | TLS (HTTPS), cookies sent with `credentials: 'include'` |
| Email and display name on profile screens | PII | not persisted by the web app; API-side storage is unchanged | TLS (HTTPS) to `API_ORIGIN` |
| Stored theme (`pesly-theme`) | public | `localStorage`, plain text, one of three words | not transmitted |

## Risks and mitigations
| ID | Risk | STRIDE | Likelihood | Impact | Mitigation |
|---|---|---|---|---|---|
| R-01 | An inline script built from variable data becomes an XSS vector | T | L | H | the pre-paint script is a constant string in `theme.ts`, carries the per-request nonce from `x-nonce`, and a test asserts it contains no interpolation |
| R-02 | A tampered `pesly-theme` value breaks rendering or reaches the DOM | T | L | L | `parseTheme` allows only `light`, `dark` and `system`, falls back to `system`, and the value only selects a fixed class |
| R-03 | `/design-system` is reachable in production and aids reconnaissance | I | M | L | `notFound()` when `NODE_ENV` is `production`, covered by a 404 test in Block 1 |
| R-04 | Financial data is persisted, cached or shown stale after a failure | I | M | H | the home keeps data in React state only, writes nothing to storage, renders no balance on error, and `page.tsx` stays a Server Component with no data access |
| R-05 | A missing `x-nonce` makes the CSP block the theme script | D | L | L | the layout reads the nonce from `x-nonce`, then from the request CSP header; with neither it emits no inline script, falls back to the system theme and still renders, and `locale-layout.test.tsx` plus a proxy test cover the header path |
| R-06 | The NFR-05 allowlist widens and hides hardcoded colors | T | L | L | the allowlist is a single file, and a planted-literal test must fail the scan |
| R-07 | The build-time font download from Google is compromised or unavailable | T | L | L | `next/font` self-hosts the files and serves them from the app's own origin under `font-src 'self'`; AC-03 asserts no runtime third-party font request; the font file is data, not executable |
| R-08 | Repeated retry clicks multiply API requests, and the home sends six requests per load | D | M | L | the retry button is disabled while a request is in flight, the six requests go out as one parallel batch with fixed limits, and the home never polls |
| R-09 | The shell is mistaken for an authorization layer | E | L | H | every protected screen still calls the API, which scopes queries to the owner and answers 404 for foreign data; no new client-side permission logic is added |

## Supply chain
No new runtime dependency is added (NFR-04, checked in VERIFY with `git diff main --
apps/web/package.json`). The one
new external fetch is the build-time download of Inter through `next/font/google`; it is verified
by the AC-03 test and served from the app's own origin (R-07). The theme provider is hand-written
instead of adding a package.

## Availability
The home adds six API requests per load in one parallel batch and the shell adds none; neither
polls, and retries are single-flight (R-08). A blocked `localStorage` or a missing nonce degrades the theme only and never
the page (R-05). The reference page is excluded from production, so its extra render cost is not an
availability vector.

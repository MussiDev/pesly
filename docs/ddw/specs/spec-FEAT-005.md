# Spec FEAT-005: Professional UX/UI redesign with merchant and asset logos

| Field | Value |
|-------|-------|
| Ticket | FEAT-005 |
| PRD | docs/ddw/prd/prd-FEAT-005.md |
| Tier | FEATURE |
| Date | 2026-10-05 |
| Spec loops | 2 |
| Loops since last human decision | 2 |

## Summary

The redesign is a frontend-only change in `apps/web`. Block 1 replaces the token values and the
typeface, Blocks 2 and 3 add and restyle the primitives in `components/ui/`, and Block 4 replaces the
shell (floating pill bottom bar, top navigation card). Block 5 adds a bundled logo layer: a merchant
catalog matched against the movement note and an asset catalog keyed by ticker, with logo files
served from the app's own origin. Blocks 6 to 11 move each screen group onto the new primitives and
add the logo avatars, the circular quick actions, the accounts section and the investments donut
chart. Block 12 closes the reference page, catalog parity, accessibility and performance checks.
No API route, database change, shared contract or runtime dependency is added (NFR-04, NFR-09).

## Coverage: PRD → blocks

| Requirement | Covered by |
|---|---|
| FR-01 | Block 1 |
| FR-02 | Block 1 |
| FR-03 | Block 2, Block 3 |
| FR-04 | Block 4 |
| FR-05 | Block 4 |
| FR-06 | Block 6, Block 7 |
| FR-07 | Block 5 |
| FR-08 | Block 6, Block 7 |
| FR-09 | Block 5, Block 9 |
| FR-10 | Block 2, Block 5, Block 6 |
| FR-11 | Block 9 |
| FR-12 | Block 3, Block 7, Block 8, Block 10, Block 11 |
| FR-13 | Block 12 |
| FR-14 | Block 4, Block 6, Block 12 |
| FR-15 | Block 2, Block 4, Block 12 |
| NFR-01 | Strategy: the contrast test is extended in Block 1 to every new token pair in both themes, token values are tuned until it passes, and the reference page of Block 12 lists the pairs. |
| NFR-02 | Strategy: the circular action, chip, tab and bar targets use a size token of at least 2.75rem (44 px); the Playwright run of Block 12 measures the bounding box of every bar link, quick action and the add button at 360 px. |
| NFR-03 | Strategy: avatars reserve their size (Block 2), skeletons keep the loaded container (Block 3, Block 6), `next/font` keeps its size-adjusted fallback and the theme script runs before paint; Block 12 measures layout shift with a PerformanceObserver on the four pages. |
| NFR-04 | Strategy: no package is added; the donut chart is drawn as inline SVG, fonts load through `next/font`, logos are static files; the final verification diffs every `package.json` against `origin/main`. |
| NFR-05 | Strategy: the existing `design-system-scan.test.ts` already scans `src/features`, `src/app` and `src/components` for colour literals and arbitrary values; every concept value is mapped to a token in Block 1, and logo colours live inside the SVG files, never in TypeScript. |
| NFR-06 | Strategy: the catalog integrity test of Block 5 rejects any logo file over 10 KB; logos are plain `<img>` elements with lazy loading and are never imported by JavaScript, so 0 logo bytes enter the bundle. |
| NFR-07 | Strategy: the home keeps its data path and adds no request (NFR-09), so its latency is unchanged; the skeleton comes from the container's initial state, and Block 12 asserts it is in the first paint. |
| NFR-08 | Strategy: every new component and helper ships with tests in its own block, `pnpm test:coverage` enforces the 80% floor, and Block 4 is the only block allowed to rewrite layout tests, each one named there. |
| NFR-09 | Strategy: no file under `apps/api` or `packages/shared` is touched; the final verification diffs both directories against `origin/main` and expects an empty result. |

## Dependencies between blocks

Execution order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12.

- Block 2 and Block 3 depend on Block 1 (tokens and typeface).
- Block 4 depends on Blocks 2 and 3 (circular action, pill styling).
- Block 5 depends on Block 2 (the avatar that renders a logo).
- Block 6 depends on Blocks 2, 3 and 5.
- Block 7 depends on Block 6, which creates the movement avatar that the movement row reuses.
- Block 9 depends on Blocks 2, 3 and 5.
- Blocks 8, 10 and 11 depend on Block 3 and are independent of each other.
- Block 12 depends on every other block.

## Block 1 — Tokens and typeface

**Files**
- `apps/web/src/app/globals.css` (modified) — navy palette, cool-grey canvas, white card surface, hero surface, `--logo-surface`, `--chart-1` to `--chart-5`, `--radius-card`, `--radius-pill`, `--spacing-circle-action`, dark navy-black values, `--font-sans` pointing at the new typeface
- `apps/web/src/app/[locale]/layout.tsx` (modified) — `Plus_Jakarta_Sans` from `next/font/google` replaces `Inter`, variable `--font-plus-jakarta`, `display: 'swap'`
- `apps/web/test/design-tokens-contrast.test.ts` (modified) — adds the new token pairs (hero, card on canvas, chart colours on card, logo surface) in both themes
- `apps/web/test/locale-layout.test.tsx` (modified) — asserts the new font options and the absence of `Inter`

**Logic**
Every existing token name keeps working so no consumer breaks (FR-01). New tokens are added next to them: canvas is the `--background` value, `--card` stays white, `--primary` becomes a deep navy, `--hero` is a navy gradient with its foreground and muted foreground, and the status and money colours keep their names. The `@theme` block exposes `--radius-card`, `--radius-pill` and `--spacing-circle-action` so components use `rounded-card`, `rounded-pill` and `size-circle-action` (FR-01, FR-02). The concept's literal values are mapped to oklch tokens and tuned until the contrast test passes (NFR-01). Tabular numerals stay on the amount component (FR-02).

**Input validation**
No user input is read. The font is a build-time import with fixed options (`subsets: ['latin']`, `display: 'swap'`).

**Error handling**
- A token declared in `:root` without a `.dark` value, or the reverse — the contrast test reports an error naming the token.
- A token pair below 4.5:1 for text or 3:1 for component borders and icons — the contrast test reports an error naming the pair and the theme.
- The font cannot be downloaded at build time — `next build` stops with an error; no request to a font host is ever made at runtime.

**Required tests**
- [ ] Every semantic token has a light and a dark value and `primary` is the navy accent — validates AC-01
- [ ] Sad path: a token missing its dark value makes the parity check report an error naming it — validates AC-01
- [ ] Every listed pair reaches 4.5:1 for text and 3:1 for component borders and icons in both themes — validates NFR-01
- [ ] Sad path: a pair below the ratio is reported as an error naming the pair — validates NFR-01
- [ ] The layout applies Plus Jakarta Sans with `display: 'swap'` and the `--font-plus-jakarta` variable, with no `Inter` import — validates AC-03
- [ ] Sad path: the layout test reports an error if any stylesheet or font URL points at a third-party host — validates AC-03
- [ ] The amount component keeps `tabular-nums` and the global body uses the new font stack — validates AC-04
- [ ] Radius, pill and circular-control sizes exist only as `@theme` tokens and the scan test reports an error for an arbitrary `rounded-[...]` or `size-[...]` utility — validates AC-05, NFR-05

**Completion criterion**
`pnpm --filter ./apps/web exec vitest run test/design-tokens-contrast.test.ts test/locale-layout.test.tsx test/design-system-scan.test.ts` passes, and `pnpm typecheck` passes.

## Block 2 — New primitives: avatar, pill tabs, chip, circular action, donut chart

**Files**
- `apps/web/src/components/ui/avatar.tsx` (new) — circular avatar that shows a logo image, or a fallback (initials or an icon) when there is no logo or the image fails
- `apps/web/src/components/ui/pill-tabs.tsx` (new) — segmented control with pill styling and `aria-pressed` buttons
- `apps/web/src/components/ui/chip.tsx` (new) — pill toggle button for filters
- `apps/web/src/components/ui/circular-action.tsx` (new) — circular icon button or link with its label underneath
- `apps/web/src/components/ui/donut-chart.tsx` (new) — inline SVG donut with a text legend, drawn from integer basis points
- `apps/web/test/ui-primitives.test.tsx` (new) — tests for the five components

**Logic**
The avatar renders `<img alt="" loading="lazy" decoding="async">` with explicit `width` and `height` from its size variant, inside a fixed-size circle on `--logo-surface`, so its box exists before the image loads (FR-10, AC-27). A client `failed` flag set by the image `error` event swaps the image for the fallback; it resets when `src` changes (FR-10, AC-28). The empty `alt` is correct because the row text always names the movement or the instrument (AC-29). The donut takes `segments: { key, label, basisPoints }[]`; arcs use `stroke-dasharray` computed from integer basis points converted with `Number()` (values never exceed 10000), colours come from `--chart-*` tokens, and the legend lists label and percentage as text so the chart is not the only carrier of meaning (FR-03, FR-11). The chip, tabs and circular action use the pill and circle tokens, a visible focus ring and a minimum 44 px target (FR-03, FR-15).

**Input validation**
Props are typed. The donut accepts only finite non-negative integers as basis points; anything else is dropped before drawing, never thrown.

**Error handling**
- The logo image fails to load — the avatar shows the fallback and no broken-image icon.
- A donut segment has a negative, zero or non-integer weight — that segment is omitted from the arcs and the legend.
- A donut has no positive segment — it renders nothing.

**Required tests**
- [ ] The avatar renders an `<img>` with empty `alt`, explicit width and height and `loading="lazy"` — validates AC-27, AC-29
- [ ] Sad path: dispatching the image error event replaces the image with the fallback and leaves no `<img>` — validates AC-28
- [ ] Sad path: after an error, a new `src` is tried again and the image returns — validates AC-28
- [ ] The donut draws one arc per positive segment and a legend with each label and percentage — validates AC-06
- [ ] Sad path: a segment with a missing, zero or negative weight is omitted and the remaining arcs still render — validates AC-06
- [ ] Sad path: a donut with no positive segment renders nothing and does not throw on an invalid weight — validates AC-06
- [ ] Chip, pill tabs and circular action expose an accessible name, reach 44 px and show a focus ring — validates AC-06, AC-40

**Completion criterion**
`ui-primitives.test.tsx` passes, `pnpm typecheck` passes, and the five components are exported from `components/ui/` and consume only tokens (the scan test stays green).

## Block 3 — Restyled existing primitives

**Files**
- `apps/web/src/components/ui/card.tsx` (modified) — `rounded-card`, soft elevation, no border
- `apps/web/src/components/ui/balance-card.tsx` (modified) — navy hero card with decorative circles, same props
- `apps/web/src/components/ui/button.tsx` (modified) — pill radius on the default and outline variants, same variants and sizes
- `apps/web/src/components/ui/list-row.tsx` (modified) — rounded interactive rows and a leading slot sized for avatars
- `apps/web/src/components/ui/badge.tsx` (modified) — pill badge
- `apps/web/src/components/ui/input.tsx` (modified) — soft field surface, same states
- `apps/web/src/components/ui/select.tsx` (modified) — same treatment as the input
- `apps/web/src/components/ui/checkbox.tsx` (modified) — navy checked state
- `apps/web/src/components/ui/alert.tsx` (modified) — rounded alert surfaces for the status tokens
- `apps/web/src/components/ui/skeleton.tsx` (modified) — new surface colour
- `apps/web/src/components/ui/empty-state.tsx` (modified) — rounded card layout
- `apps/web/src/components/ui/error-state.tsx` (modified) — rounded card layout
- `apps/web/src/components/ui/page-header.tsx` (modified) — new type scale
- `apps/web/src/components/ui/money-input.tsx`, `form.tsx`, `label.tsx`, `icon-action.tsx`, `amount.tsx` (modified) — token and radius updates only
- `apps/web/test/ui-components.test.tsx`, `apps/web/test/checkbox.test.tsx`, `apps/web/test/utils-cn.test.tsx` (modified) — updated expectations for the new classes

**Logic**
Only classes and tokens change; every component keeps its props, variants and `data-slot` attribute, so the 17 pages keep compiling and their behavior tests keep passing (FR-03, FR-12). The amount component keeps the sign or arrow that carries income and expense direction (AC-02). Loading, empty and error states keep their containers and actions in the new look (AC-35, AC-36). `motion-reduce` variants stay on every transition (AC-41).

**Input validation**
No validation rule changes. Field components keep `aria-invalid`, `aria-describedby` and their error text association exactly as they are.

**Error handling**
- A restyle that changes a public prop or variant name — `pnpm typecheck` reports an error in the consumers.
- An invalid field loses its announcement or its error text link — the field tests fail on the missing attribute.

**Required tests**
- [ ] Card and balance card render from tokens only, with `rounded-card` and the group role and labels preserved — validates AC-05, AC-13
- [ ] Income and expense amounts still show a sign and a screen-reader direction label — validates AC-02
- [ ] A loading skeleton occupies the same container as the loaded content — validates AC-35
- [ ] Sad path: an empty state keeps its call to action and an error state keeps its retry action — validates AC-36
- [ ] Sad path: an invalid input keeps `aria-invalid` and its described error text — validates AC-34
- [ ] Every interactive primitive shows a visible focus ring and carries `motion-reduce` on its transitions — validates AC-40, AC-41
- [ ] Existing variants of button, badge and list row still render (no removed variant) — validates AC-34

**Completion criterion**
The three modified test files and the whole `apps/web` Vitest run pass, and `pnpm typecheck` passes.

## Block 4 — Shell: floating bottom bar and top navigation card

**Files**
- `apps/web/src/features/shell/nav-items.ts` (modified) — bar destinations Home and Movements before the add button, Investments and More after it; the More list holds Accounts, Categories, Profile and Security; the top navigation uses Home, Accounts, Movements, Investments plus the secondary items
- `apps/web/src/features/shell/components/bottom-nav.tsx` (modified) — floating pill bar with a circular add button in the center
- `apps/web/src/features/shell/components/top-nav.tsx` (new) — top navigation card with the brand, destination pills, the add-movement action, the theme toggle and sign out
- `apps/web/src/features/shell/components/side-nav.tsx` (deleted) — replaced by the top navigation
- `apps/web/src/features/shell/components/authenticated-shell.tsx` (modified) — renders the top navigation instead of the side navigation and reserves space above the bar
- `apps/web/src/features/shell/components/more-menu.tsx` (modified) — lists Accounts first
- `apps/web/messages/en.json`, `apps/web/messages/es.json` (modified) — any new `app.nav` label
- `apps/web/test/shell-navigation.test.tsx` (modified) — rewritten for the new bar, top navigation and the missing side navigation
- `apps/web/test/authenticated-shell-container.test.tsx` (modified) — rewritten layout assertions
- `apps/web/e2e/design-system.spec.ts` (modified) — viewport navigation assertions rewritten for a floating bar and a top card

**Logic**
Below `md` the bar is `fixed` with a side margin and the safe-area padding, shaped as a pill, with Home, Movements, a circular add button, Investments and More; `isActiveInBottomNav` makes More current on its own page and on Accounts, Categories, Profile and Security (FR-04). From `md` the top navigation card shows the same destinations as pills, the add-movement action, the theme toggle and sign out, and no side navigation exists at any width (FR-05). The `#main-content` wrapper gets bottom padding below `md` equal to the bar height plus its margin so the last element is never covered (AC-10). Both landmarks keep the `app.nav.label` name and `aria-current="page"` on the current destination (AC-09). All new strings exist in both catalogs (FR-14). Both navigations show a focus ring on every link (FR-15).

**Input validation**
`currentPath` comes from the router and is only compared with fixed hrefs; it is never rendered or used to build a link.

**Error handling**
- `currentPath` is undefined or matches no destination — no destination is marked current and nothing throws.
- Sign out fails — the existing alert renders above the content, in both navigations.

**Required tests**
- [ ] Below `md` the bar lists Home, Movements, Investments and More with a circular add button in the center — validates AC-07
- [ ] Activating the add button navigates to `/movements/new` — validates AC-08
- [ ] The current destination carries `aria-current="page"` in the bar and in the top navigation — validates AC-09
- [ ] From `md` the top navigation card lists the destinations as pills and an add-movement action — validates AC-11
- [ ] No element with `data-slot="side-nav"` renders at any width and `side-nav.tsx` no longer exists — validates AC-12
- [ ] Sad path: an undefined or unknown `currentPath` marks no destination and renders without error — validates AC-09
- [ ] Sad path: a sign-out error still renders the alert above the content — validates AC-08
- [ ] Playwright at 360 px: the bar is inset from both edges, the add link is visible and, scrolled to the end, the last page element is above the bar — validates AC-07, AC-10
- [ ] Playwright at 1280 px: the top navigation sits at the top of the viewport and the bar is hidden — validates AC-11, AC-12
- [ ] Every bar link, top navigation link and the add button shows a visible focus ring under keyboard focus — validates AC-40

**Completion criterion**
`shell-navigation.test.tsx`, `authenticated-shell-container.test.tsx` and `shell-boundaries.test.ts` pass, the two Playwright viewport cases in `design-system.spec.ts` pass, and `pnpm typecheck` passes.

## Block 5 — Merchant and asset logo catalogs and resolvers

**Files**
- `apps/web/src/lib/logos/normalize.ts` (new) — NFC normalization, accent stripping, lower-casing and word tokenization
- `apps/web/src/lib/logos/merchant-catalog.ts` (new) — ordered entries `{ id, name, keywords, logo }` where `logo` is a constant path under `/logos/`
- `apps/web/src/lib/logos/asset-catalog.ts` (new) — entries keyed by ticker with the same logo path rule
- `apps/web/src/lib/logos/resolve-merchant.ts` (new) — returns the entry a note names, or `undefined`
- `apps/web/src/lib/logos/resolve-asset.ts` (new) — returns the entry of a ticker, or `undefined`
- `apps/web/public/logos/*.svg` (new) — bundled logo files, each at most 10 KB
- `apps/web/public/logos/NOTICE.md` (new) — source, license and retrieval date of every file
- `apps/web/test/logos-resolve.test.ts` (new) — resolver tests
- `apps/web/test/logos-catalog.test.ts` (new) — catalog integrity tests
- `apps/web/test/content-security-policy.test.ts` (modified) — asserts `img-src` allows no third-party host
- `apps/web/next.config.ts` (modified) — adds a header rule for `/logos/:path*` that sends `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox`
- `apps/web/test/logos-headers.test.ts` (new) — asserts the sandboxing policy on `/logos/:path*`

**Logic**
A note is tokenized into normalized words; a keyword is tokenized the same way and matches when its words appear contiguously in the note's words, so `mercado libre` and `Mercado  Libré` match and `spotifyfy` does not (FR-07, AC-18). Among matching keywords the one with the most words wins, then the most characters, then the entry listed first (AC-19). No regular expression is built from catalog or note content, so matching is linear in note length times keyword count. A ticker matches an asset entry after trimming and upper-casing (FR-09, AC-24). The initial catalogs hold at most 40 merchants and 40 assets, chosen from the common Argentine services, stores, brokers and tickers for which a logo with a clear license exists; the candidate source is the Simple Icons set (CC0-1.0 files, trademarks stay with their owners), which the implementer checks against the upstream license text when copying and records in `NOTICE.md`. An entry without a cleared logo is not added, and the fallback avatar covers it (FR-07, FR-09). Logo colours are baked into the SVG files, never written in TypeScript. Files are plain static assets requested with `<img>` and never imported (FR-10, NFR-06). The proxy matcher skips every path that contains a dot, so a logo opened directly as a document would receive no policy; `next.config.ts` therefore sends a sandboxing `Content-Security-Policy` header for `/logos/:path*`, which stops any script an SVG might carry (R-01 of the threat analysis).

**Input validation**
The note is a string of at most 500 code points (already validated by the API contract) or `null`; the ticker is a string already validated by the investments contract. Both are treated as untrusted text: never interpolated into a path, an HTML string or a regular expression. Logo paths come only from catalog constants.

**Error handling**
- The note is null, empty or whitespace only — no entry is resolved.
- A keyword appears only inside a longer word, or the note names nothing in the catalog — no entry is resolved.
- The ticker is unknown — no entry is resolved and the caller shows the initials avatar.
- A logo file is opened directly in the browser as a document — the sandboxing policy header stops any script it carries.
- A catalog entry has no name, no keyword, a missing file, a file over 10 KB, an SVG with active content, or a keyword shared with another entry — the integrity test reports an error and CI stops.

**Required tests**
- [ ] A keyword inside a note matches as a whole word regardless of case and accents (`SPOTIFY`, `Mercado  Libré`) — validates AC-18
- [ ] Sad path: a keyword embedded in a longer word does not match — validates AC-18
- [ ] When two entries match the longest keyword wins, and the first listed entry wins a tie — validates AC-19
- [ ] Sad path: a null, empty or whitespace-only note resolves no entry — validates AC-20
- [ ] Sad path: a note with no catalog keyword resolves no entry and never throws on control characters — validates AC-20
- [ ] A ticker resolves its asset entry regardless of case — validates AC-24
- [ ] Sad path: an unknown ticker resolves no entry — validates AC-25
- [ ] Every entry has a name, at least one keyword and an existing file under `public/logos/` — validates AC-17
- [ ] Sad path: a file over 10 KB, with a `<script>`, an event attribute, an external URL or a `foreignObject`, or a duplicate keyword is reported as an error — validates AC-17, NFR-06
- [ ] Every logo path starts with `/logos/` and the content security policy `img-src` stays `'self' blob: data:` — validates AC-26
- [ ] Sad path: a missing `/logos/:path*` header rule, or one without `sandbox` and `default-src 'none'`, makes the header test report an error — validates AC-26

**Completion criterion**
`logos-resolve.test.ts`, `logos-catalog.test.ts`, `logos-headers.test.ts` and `content-security-policy.test.ts` pass, and `NOTICE.md` names the source and license of every file in `public/logos/`.

## Block 6 — Home: balance card, quick actions, accounts section, recent movements

**Files**
- `apps/web/src/features/home/components/home-screen.tsx` (modified) — new layout: balance cards, quick actions, accounts section, recent movements, with the matching skeleton
- `apps/web/src/features/home/components/balance-summary.tsx` (modified) — one navy balance card per currency, same data
- `apps/web/src/features/home/components/quick-actions.tsx` (new) — four circular quick actions linking to the new-movement screen with a movement type
- `apps/web/src/features/home/components/home-accounts.tsx` (new) — the first five active accounts with name, currency and balance and a link to all accounts
- `apps/web/src/features/home/components/recent-movements.tsx` (modified) — rows in a rounded card with the movement avatar
- `apps/web/src/features/home/containers/home-container.tsx` (modified) — passes the loaded accounts (name, currency, balance) to the screen; the movement note already travels with each recent movement
- `apps/web/src/features/movements/components/movement-avatar.tsx` (new) — shows the merchant logo for income and expense movements that resolve one, otherwise the category icon, and the type icon for transfers and exchanges
- `apps/web/messages/en.json`, `apps/web/messages/es.json` (modified) — `home.quickActions.*` and `home.accounts.*`
- `apps/web/test/home-components.test.tsx`, `apps/web/test/home-container.test.tsx` (modified) — new layout expectations
- `apps/web/test/movement-avatar.test.tsx` (new) — avatar selection tests

**Logic**
The home shows the balance cards (available as the large figure, net worth below, per currency, from the totals the accounts request already returns), four circular quick actions (`expense`, `income`, `transfer`, `exchange`) whose links carry `?type=` with the matching value, an accounts section built from the accounts already loaded, and the five most recent movements (FR-06). No request is added. The movement avatar picks the logo through `resolveMerchant(note)` for income and expense, the existing category icon when nothing resolves, and the type icon for transfers and exchanges (FR-08, FR-10). All new strings exist in both catalogs (FR-14).

**Input validation**
No user input is read. The `type` values in the quick action links come from a fixed list.

**Error handling**
- The accounts or movements request fails — the existing error state with retry renders and no stale balance.
- The user has no accounts — the existing empty state with the create-account action renders.
- A movement amount is not a valid integer string — the row shows the existing placeholder instead of throwing.

**Required tests**
- [ ] The loaded home shows a balance card per currency, four circular quick actions, the accounts section and the five most recent movements — validates AC-13
- [ ] Each quick action links to `/movements/new` with its `type` value — validates AC-14
- [ ] Sad path: no accounts renders the empty state with the create-account action — validates AC-15
- [ ] Sad path: a failed request renders the error state with retry and no balance figure — validates AC-16
- [ ] Sad path: a malformed movement amount renders the placeholder without an error — validates AC-13
- [ ] An expense whose note names a catalog merchant shows that logo as the leading avatar — validates AC-21
- [ ] An income or expense with no resolved entry shows the category icon avatar — validates AC-22
- [ ] A transfer or exchange shows the type icon and never a logo, even when its note names a merchant — validates AC-23
- [ ] Every new string exists in both catalogs — validates AC-39

**Completion criterion**
`home-components.test.tsx`, `home-container.test.tsx` and `movement-avatar.test.tsx` pass, and the home renders with no new request (the container test asserts the same calls as before).

## Block 7 — Movements screens and preselected type

**Files**
- `apps/web/src/features/movements/components/movement-row.tsx` (modified) — leading slot uses the movement avatar
- `apps/web/src/features/movements/components/movement-list.tsx` (modified) — rounded card list
- `apps/web/src/features/movements/components/movement-filters.tsx` (modified) — new field and chip styling, same filters
- `apps/web/src/features/movements/components/movement-form.tsx` (modified) — restyle only
- `apps/web/src/features/movements/components/movement-field.tsx`, `rate-field.tsx`, `tag-input.tsx`, `movement-saved.tsx`, `movements-load-state.tsx` (modified) — restyle only
- `apps/web/src/features/movements/initial-type.ts` (new) — `parseInitialType(value)` returns a valid movement type
- `apps/web/src/features/movements/containers/create-movement-container.tsx` (modified) — accepts `initialType` and passes it to the screen
- `apps/web/src/app/[locale]/(app)/movements/new/page.tsx` (modified) — reads `searchParams.type` on the server and passes it down
- `apps/web/test/movements-components.test.tsx`, `apps/web/test/movements-list.test.tsx`, `apps/web/test/movement-filters.test.tsx`, `apps/web/test/movements-containers.test.tsx`, `apps/web/test/edit-movement-container.test.tsx` (modified) — updated expectations
- `apps/web/test/initial-type.test.ts` (new) — parser tests
- `apps/web/e2e/movements.spec.ts` (modified) — only where it asserts markup replaced by Block 4 or this block

**Logic**
The movement row reuses the movement avatar of Block 6, so the list and the home resolve logos the same way (FR-08). The new-movement page, a Server Component that never touches financial data, reads `searchParams.type` and passes `parseInitialType(...)`; the screen's existing form state starts from that type, and edit mode keeps the type locked as today (FR-06, AC-14). Every screen in this block adopts the new primitives and keeps its loading, empty and error states, validation messages and API calls (FR-12).

**Input validation**
`type` arrives as `string | string[] | undefined`. Only the exact values `expense`, `income`, `transfer` and `exchange` (validated with the shared movement type schema) are accepted; anything else falls back to `expense`. The value is never rendered as HTML or used to build a URL.

**Error handling**
- `type` is missing, empty, in a different case or not one of the four values — the form starts on `expense`.
- `type` is repeated (`?type=income&type=expense`) — the form starts on `expense`.
- The movements request fails or returns nothing — the existing error and empty states render in the new look.

**Required tests**
- [ ] `parseInitialType('income')` and the other three valid values return themselves — validates AC-14
- [ ] Sad path: a missing, empty, unknown or differently cased value returns `expense` — validates AC-14
- [ ] Sad path: an array value returns `expense` and an invalid value never reaches the form — validates AC-14
- [ ] The new-movement container starts the form on the type it receives, and edit mode keeps the type locked — validates AC-14
- [ ] A list row for an expense with a catalog merchant in its note shows the logo and a transfer never does — validates AC-21, AC-23
- [ ] A list row with no resolved merchant keeps the category icon — validates AC-22
- [ ] Sad path: a failed list request shows the error state with retry and an empty list shows the empty state with its action — validates AC-36
- [ ] The movement screens render only design system components and keep their behavior and validation messages — validates AC-34
- [ ] Loading shows a skeleton in the same container — validates AC-35

**Completion criterion**
All listed Vitest files pass, `e2e/movements.spec.ts` passes, and `pnpm typecheck` passes.

## Block 8 — Accounts, categories and More screens

**Files**
- `apps/web/src/features/accounts/components/account-row.tsx` (modified) — rounded rows, same data
- `apps/web/src/features/accounts/components/account-list.tsx`, `account-form.tsx`, `account-field.tsx`, `accounts-headline.tsx`, `accounts-load-state.tsx` (modified) — restyle only
- `apps/web/src/features/categories/components/category-list.tsx`, `category-form.tsx`, `category-field.tsx`, `category-pickers.tsx`, `category-visual.tsx`, `categories-load-state.tsx` (modified) — restyle only
- `apps/web/test/accounts-components.test.tsx`, `apps/web/test/accounts-containers.test.tsx`, `apps/web/test/categories-components.test.tsx`, `apps/web/test/categories-containers.test.tsx` (modified) — updated expectations

**Logic**
The accounts list, new-account form, categories list, new-category form and the More page adopt the new card, row and button styling through the primitives of Block 3; no data, request or validation rule changes (FR-12). The More page content itself is changed in Block 4.

**Input validation**
No rule changes: the account and category forms keep their existing validation, messages and error association.

**Error handling**
- A list request fails — the existing error state with retry renders.
- A form submission is invalid — the existing validation messages render next to their fields.

**Required tests**
- [ ] The accounts and categories screens render only design system components and keep behavior and messages — validates AC-34
- [ ] Sad path: a failed accounts or categories request shows the error state with retry — validates AC-36
- [ ] Sad path: an invalid account or category form shows the existing validation errors — validates AC-34
- [ ] Loading shows a skeleton in the same container and an empty list shows its call to action — validates AC-35, AC-36

**Completion criterion**
The four test files pass and `e2e/accounts.spec.ts` and `e2e/categories.spec.ts` pass.

## Block 9 — Investments: logos, composition donut and gain markers

**Files**
- `apps/web/src/features/investments/composition.ts` (new) — pure function that groups priced holdings by instrument type within each valuation currency and returns integer basis points
- `apps/web/src/features/investments/components/asset-avatar.tsx` (new) — avatar of a holding: its catalog logo, or the first two characters of the ticker
- `apps/web/src/features/investments/components/portfolio-card.tsx` (modified) — totals per currency and one donut per currency
- `apps/web/src/features/investments/components/holding-row.tsx` (modified) — leading asset avatar and a gain or loss marker with an arrow or sign
- `apps/web/src/features/investments/components/investments-screen.tsx` (modified) — new layout
- `apps/web/src/features/investments/components/add-holding-form.tsx`, `edit-holding-form.tsx`, `create-portfolio-form.tsx`, `price-form.tsx`, `form-error-alert.tsx` (modified) — restyle only
- `apps/web/test/composition.test.ts` (new) — grouping and rounding tests
- `apps/web/test/portfolio-card.test.tsx`, `apps/web/test/holding-row.test.tsx`, `apps/web/test/investments-screen.test.tsx`, `apps/web/test/add-holding-form.test.tsx`, `apps/web/test/edit-holding-form.test.tsx`, `apps/web/test/create-portfolio-form.test.tsx` (modified) — updated expectations
- `apps/web/e2e/investments.spec.ts` (modified) — only where it asserts replaced markup

**Logic**
`composition(holdings)` keeps holdings whose `value` is a valid integer string greater than zero, groups them by `valuationCurrency` and then by `instrumentType`, and returns each type's share as integer basis points computed with `bigint` division; the rounding leftover goes to the largest share so each currency sums to exactly 10000 (FR-11). Currencies are never added together: a portfolio with priced holdings in two currencies draws two donuts (AC-31). The legend uses the existing instrument type translations and the existing percentage formatter. The holding row shows `AssetAvatar` as its leading element, with the ticker as the title so the empty `alt` is correct (FR-09, FR-10), and keeps its existing gain text with a sign, adding an arrow marker so direction is never carried by colour alone (AC-33). An instrument type unknown to the build keeps showing its raw key, as today.

**Input validation**
Holdings come from the typed API response. `composition` parses each `value` with the shared integer string schema and drops anything that does not parse or is not positive. Existing field validation of the five forms is unchanged.

**Error handling**
- A portfolio has no priced holding — no donut renders and the existing "without a price" notice stays.
- A holding value is null, malformed or not positive — it is left out of the donut and the legend.
- A holding has an instrument type this build does not know — the legend and the row show its raw key.
- The shares do not divide evenly — the leftover basis points go to the largest share and the total stays 10000.

**Required tests**
- [ ] A portfolio with priced holdings shows its totals per currency and a donut with a legend of type name and percentage — validates AC-30
- [ ] Priced holdings in two valuation currencies produce two donuts and no cross-currency sum — validates AC-31
- [ ] Sad path: a portfolio with no priced holding renders no donut and keeps the "without a price" notice — validates AC-32
- [ ] Sad path: a null, malformed or non-positive value is excluded from the chart and the legend — validates AC-30
- [ ] Sad path: an uneven division gives a leftover that goes to the largest share and every currency sums to exactly 10000 — validates AC-30
- [ ] A positive gain shows an up arrow and a plus sign, a negative gain a down arrow and a minus sign — validates AC-33
- [ ] A holding whose ticker is in the asset catalog shows that logo — validates AC-24
- [ ] Sad path: a ticker with no logo shows an avatar with the first two characters of the ticker — validates AC-25
- [ ] The five investments forms and the screen keep their behavior and validation messages in the new look — validates AC-34

**Completion criterion**
`composition.test.ts` and the six modified Vitest files pass, and `e2e/investments.spec.ts` passes.

## Block 10 — Auth screens

**Files**
- `apps/web/src/app/[locale]/(auth)/layout.tsx` (modified) — centered card layout on the canvas
- `apps/web/src/features/auth/components/sign-in-form.tsx`, `register-form.tsx`, `forgot-password-form.tsx`, `reset-password-form.tsx`, `second-factor-form.tsx` (modified) — restyle only
- `apps/web/src/features/auth/components/verify-email-notice.tsx`, `auth-field.tsx`, `form-alert.tsx` (modified) — restyle only
- `apps/web/src/features/auth/components/google-sign-in-button.tsx` (modified) — pill styling, the brand colours allowed by the scan test stay untouched
- `apps/web/test/auth-components.test.tsx`, `apps/web/test/auth-screens.test.tsx`, `apps/web/test/auth-form-accessibility.test.tsx` (modified) — updated expectations

**Logic**
The seven public screens (sign in, second factor, register, forgot password, reset password, check your email, verify email) adopt the new card and field styling through the primitives and keep their behavior, validation messages, redirects and API calls (FR-12).

**Input validation**
No rule changes: every form keeps its schema validation, messages and focus-first-invalid behavior.

**Error handling**
- A field is invalid — the existing message renders next to the field and focus moves to the first invalid field.
- A request fails — the existing form alert renders with the translated message.

**Required tests**
- [ ] The seven auth screens render only design system components and keep behavior and messages — validates AC-34
- [ ] Sad path: an invalid field shows its message, sets `aria-invalid` and receives focus — validates AC-34
- [ ] Sad path: a failed request shows the translated form alert — validates AC-34
- [ ] Keyboard focus shows a visible indicator on every field and button — validates AC-40

**Completion criterion**
The three test files pass and `e2e/auth.spec.ts`, `e2e/google.spec.ts` and `e2e/two-factor.spec.ts` pass.

## Block 11 — Profile, security and delete account screens

**Files**
- `apps/web/src/features/profile/components/profile-form.tsx`, `preferences-form.tsx`, `delete-user-form.tsx`, `delete-user-google.tsx`, `profile-load-state.tsx`, `saved-notice.tsx` (modified) — restyle only
- `apps/web/src/features/two-factor/components/two-factor-setup.tsx`, `two-factor-status.tsx`, `recovery-codes.tsx`, `disable-two-factor.tsx` (modified) — restyle only
- `apps/web/test/profile-components.test.tsx`, `apps/web/test/two-factor-components.test.tsx`, `apps/web/test/delete-user-components.test.tsx`, `apps/web/test/settings-screens.test.tsx` (modified) — updated expectations

**Logic**
Profile, security (two-factor setup, recovery codes, disable) and delete account adopt the new primitives and keep their behavior and API calls (FR-12). Destructive actions keep their confirmation steps and the destructive colour.

**Input validation**
No rule changes: profile, preference, delete-account and two-factor forms keep their validation and messages.

**Error handling**
- A form submission is invalid — the existing validation message renders and focus moves to the first invalid field.
- A save or delete request fails — the existing alert renders with its translated message.

**Required tests**
- [ ] The profile, security and delete-account screens render only design system components and keep behavior and messages — validates AC-34
- [ ] Sad path: an invalid profile or delete confirmation shows its error message — validates AC-34
- [ ] Sad path: a failed save or failed delete shows the translated alert and keeps the form data — validates AC-34
- [ ] Loading, empty and error states keep their containers in the new look — validates AC-35, AC-36

**Completion criterion**
The four test files pass and `e2e/profile.spec.ts`, `e2e/delete-user.spec.ts` and `e2e/two-factor.spec.ts` pass.

## Block 12 — Reference page, catalog parity, accessibility and performance

**Files**
- `apps/web/src/app/[locale]/design-system/design-system-showcase.tsx` (modified) — every new and changed token and component variant in both themes, including the pairs the contrast test checks
- `apps/web/test/design-system-page.test.tsx` (modified) — new sections
- `apps/web/test/i18n-catalogs.test.ts` (modified) — covers the keys added by Blocks 4 and 6
- `apps/web/e2e/design-system.spec.ts` (modified) — production 404, keyboard focus and reduced-motion checks
- `apps/web/e2e/layout-shift.spec.ts` (new) — measures cumulative layout shift and the first-paint skeleton on home, sign in, movements and investments

**Logic**
The reference page keeps its non-production rule (FR-13) and lists the avatar, pill tabs, chip, circular action, donut chart, restyled primitives, the balance card, the bar and the top navigation in light and dark. The layout shift test reads `layout-shift` entries through a PerformanceObserver after load on the four pages and keeps the sum at or below 0.1 (NFR-03); on the home it also asserts that the skeleton is in the first paint (NFR-07). The catalog parity test already fails when a key exists in only one catalog (FR-14). The keyboard and reduced-motion cases walk the shell and the quick actions (FR-15). A target-size case measures bar links, quick actions and the add button at 360 px (NFR-02).

**Input validation**
No user input is read. The `/design-system` route keeps its environment check.

**Error handling**
- A UI key exists in only one catalog — the parity test reports an error naming the key.
- `/design-system` is requested in production — the route answers 404.

**Required tests**
- [ ] Outside production `/design-system` shows every new and changed token and component in both themes — validates AC-37
- [ ] Sad path: in production `/design-system` answers 404 — validates AC-38
- [ ] Sad path: a key present in only one catalog is reported as an error naming it — validates AC-39
- [ ] Tabbing through the shell, the quick actions and a form shows a visible focus indicator on every stop — validates AC-40
- [ ] With reduced motion emulated, no non-essential transition or animation runs — validates AC-41
- [ ] Bar links, quick actions and the add button measure at least 44 by 44 px at 360 px — validates NFR-02
- [ ] Cumulative layout shift stays at or below 0.1 on home, sign in, movements and investments — validates NFR-03
- [ ] The home skeleton is present in the first paint — validates NFR-07

**Completion criterion**
`design-system-page.test.tsx`, `i18n-catalogs.test.ts`, `e2e/design-system.spec.ts` and `e2e/layout-shift.spec.ts` pass.

## Final verification

- `pnpm lint`, `pnpm typecheck` and `pnpm test:coverage` pass with at least 80% lines, branches and functions over `apps/api/src`, `apps/web/src` and `packages/shared/src` (NFR-08).
- `pnpm e2e` passes with the rewritten navigation cases.
- `git diff --stat origin/main -- apps/api packages/shared` is empty and no `package.json` differs from `origin/main` (NFR-04, NFR-09).
- `git diff origin/main -- apps/web/test` shows no deleted or weakened behavioral test; the only rewritten layout tests are the ones named in Block 4 (NFR-08).
- `apps/web/public/logos/NOTICE.md` records source and license for every logo, and no logo exceeds 10 KB (NFR-06).
- Rollback: the change is a visual and frontend layer with no data change, so reverting the merge commit restores the FEAT-004 look; no migration has to be reversed.

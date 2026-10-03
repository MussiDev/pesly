# Spec FEAT-004: Pesly design system and UX/UI overhaul

| Field | Value |
|-------|-------|
| Ticket | FEAT-004 |
| PRD | docs/ddw/prd/prd-FEAT-004.md |
| Tier | FEATURE |
| Date | 2026-10-03 |
| Spec loops | 3 |
| Loops since last human decision | 0 |

## Summary

The overhaul is built in three waves. Wave 1 is sequential: Block 1 lays the design system
foundation (tokens, typeface, theme, restyled and new `components/ui/` primitives, reference page)
and Block 2 builds the app shell. Wave 2 runs in parallel: Blocks 3 to 7 restyle the screens group
by group and build the real home, each consuming only `components/ui/` and tokens, each owning its
own files and its own message namespace. Wave 3 is Block 8: cross-cutting scans, a mobile-viewport
e2e spec and the final regression run. No backend, schema or API contract changes: the home reuses
`listAccounts`, `listMovements`, `listCategories` and `getProfile` from the existing API client. No
new runtime dependency: the
theme provider is hand-written, the typeface is loaded with `next/font`, and everything else uses
the packages already installed.

Design decisions taken here (the PRD leaves them open):

- Home data requests (decision of the user, 2026-10-03, taken in CODE when Block 7 showed that two
  requests are not enough): the home issues six requests in one `Promise.all` after the session
  check: `listAccounts` for active and for archived accounts (the API filter is binary, so an
  account that was archived is only found with `archived: true`, and without it a recent movement
  on it would be shown in the wrong currency), `listCategories` for active and for archived
  categories (movements carry only a `categoryId`), `listMovements({ limit: 5 })` and `getProfile`
  (the user's time zone). Each list request has a fixed limit and nothing polls. The spec and the
  threat model were amended to match instead of recording a deviation.

- Typeface: Inter through `next/font/google` (downloaded at build, self-hosted, so `font-src 'self'`
  holds), `display: 'swap'`, exposed as `--font-sans`. Chosen over `next/font/local` because it
  commits no binary asset and no font licence or provenance file; the build already needs network
  for `pnpm install`.
- Palette anchors: indigo hue 275 for primary; green hue 160 for `income` only; cool neutrals at
  hue 250 to 290 with chroma at or below 0.015; `expense` uses the destructive red family; contrast is enforced by test.
- Theme: values `light`, `dark`, `system` stored under the `localStorage` key `pesly-theme`; an
  inline pre-paint script carrying the CSP nonce from the `x-nonce` request header sets the `dark`
  class on `<html>` before first paint.
- Shell: no popover or dialog library. "More" is a route (`/more`, with its own client container)
  listing categories, profile, security, theme and sign out; from the `md` breakpoint the side
  navigation shows those links directly, so existing links by accessible name keep working on
  desktop. `/more` is not redirected on desktop: it renders the same list, which is harmless. The
  shell, its container and `sign-out-button` move wholesale from `features/auth` to
  `features/shell`, so `features/shell` never imports from `features/auth` and no import cycle
  exists.
- The session gate stays as it is today: children do not mount until the session check succeeds,
  so a user with an unverified email is redirected before any screen requests data. The shell
  draws the full frame with a skeleton while the check runs, instead of a bare status line.
- Frozen shared files: `form-alert.tsx`, `auth-field.tsx`, `read-field.ts`, `form-errors.ts`,
  `use-focus-first-invalid.ts` (in `features/auth`), `features/categories/category-display.ts`,
  `features/profile/use-focus-invalid.ts` and `features/accounts/format-amount.ts` and `totals.ts`
  keep their exported API. Only Block 1 may change the markup or styling of the two components;
  Blocks 2 to 8 must not edit any frozen file. If a block finds it needs an API change in a frozen
  file, it stops and reports it, and the spec is updated through a corrective loop.
- Scope enforcement: each block's review (`ddw-module-verifier`) checks that the block's diff
  touches only the files in its own Files list; a frozen file in a Block 2 to 8 diff is a defect.
- UI primitive rule: components in `components/ui/` are presentational and never call
  `useTranslations`; strings, labels and retry actions arrive as props from the caller. `amount`
  takes a `bigint`, a currency and a locale and calls the pure `formatMoney`; `empty-state` and
  `error-state` take already-translated text. This keeps `components/ui/` free of i18n and domain
  coupling, and `error-state` is built on `Alert`, so it does not duplicate `FormAlert`.
- Message namespaces: Block 1 owns `ui.*` and `theme.*`, Block 2 owns `app.*`, Block 3 `auth.*`,
  Block 4 `security.*`, `profile.*` and `deleteUser.*`, Block 5 `accounts.*` and `movements.*`,
  Block 6 `categories.*` and `investments.*`, Block 7 `home.*`. Parallel blocks edit
  `messages/en.json` and `messages/es.json` only with targeted edits inside their own namespaces,
  never by rewriting the file; Block 8 validates both files as JSON and runs the parity test after
  the wave.
- Shared test files have one owner each: `test/i18n-catalogs.test.ts` is edited only by Block 2
  (the `app.nav` assertions) and Block 8 (the `categories`, `investments` and `home` assertions);
  `test/routes.test.tsx` is edited only by Block 7. Parallel blocks run their own test files only,
  and `i18n-catalogs.test.ts` is expected to be red between the waves until Block 8.

## Coverage: PRD → blocks

| Requirement | Covered by |
|---|---|
| FR-01 | Block 1 |
| FR-02 | Block 1 |
| FR-03 | Block 1 |
| FR-04 | Block 1, Block 2 |
| FR-05 | Block 1 |
| FR-06 | Block 1 |
| FR-07 | Block 2 |
| FR-08 | Block 3 |
| FR-09 | Block 4 |
| FR-10 | Block 5, Block 6 |
| FR-11 | Block 7 |
| FR-12 | Block 1, Block 5, Block 6, Block 7 |
| FR-13 | Block 1, Block 8 |
| FR-14 | Block 1, Block 2, Block 3, Block 4, Block 5, Block 6, Block 7, Block 8 |
| NFR-01 | Strategy: Block 1 defines every token pair and a Vitest test computes the WCAG contrast ratio of each text pair (at least 4.5:1) and each border or icon pair (at least 3:1) in both themes; Block 8 re-runs it as the final regression. |
| NFR-02 | Strategy: Block 1 sets a 44 px minimum (`min-h-11 min-w-11`) on button, input, select, checkbox hit area and list-row; Block 8 runs a Playwright check at a 360 px viewport that measures every interactive element on the home, sign-in and movements pages. |
| NFR-03 | Strategy: `next/font` emits size-adjusted fallbacks, the pre-paint script prevents a theme flash, the shell draws its final frame while the session check runs, and skeletons occupy the final container; Block 8 records `layout-shift` entries in Playwright on the home, sign-in and movements pages and asserts a total at or below 0.1. |
| NFR-04 | Strategy: the theme provider is hand-written and the typeface comes from `next/font`; the VERIFY phase checks that `git diff main -- apps/web/package.json` shows no change to `dependencies`, a one-off check for this ticket rather than a permanent test. |
| NFR-05 | Strategy: Block 8 adds a scan test over `apps/web/src/features` and `apps/web/src/app` that fails on hex, `rgb(`, `hsl(` or `oklch(` literals and on arbitrary-value Tailwind classes, with one allowlist entry for the Google brand logo in `google-sign-in-button.tsx`; Block 6 converts the `ring-[3px]` in `category-pickers.tsx`. |
| NFR-06 | Strategy: the shell frame with a skeleton renders on first paint, so the skeleton appears within 100 ms; the data path is the session check followed by the six home data requests (accounts active and archived, categories active and archived, movements, profile) started in the same tick with `Promise.all` and `limit: 5` on movements, which is two sequential round trips with no further waterfall because the six run in parallel and the slowest one bounds the wait; a test asserts all six data requests start before any resolves. |
| NFR-07 | Strategy: every block ships its own Vitest tests (the `design-system` page and the theme script count toward coverage, so they are tested), and `pnpm test:coverage` runs as the closing gate of Block 8 against the 80% floor. |

## Dependencies between blocks

- Block 1 has no dependency and runs first.
- Block 2 depends on Block 1 (tokens, primitives, theme toggle) and runs second, alone.
- Blocks 3, 4, 5, 6 and 7 depend on Blocks 1 and 2 and are independent of each other, so they run in
  parallel. Their file sets are disjoint by construction (see each Files list); the only shared
  files are the frozen ones above and the two message catalogs, where each block edits only its own
  namespaces.
- Block 8 depends on Blocks 1 to 7 and runs last: its scan fails until Block 3 (the allowlist) and
  Block 6 (`ring-[3px]`) have landed.

## Block 1 — Design system foundation

**Files**
- `apps/web/src/app/globals.css` (modified) — semantic tokens for light and dark: background,
  surface, foreground, muted, border, ring, primary (indigo), success, warning, destructive, info,
  income, expense, keeping the existing `--category-*` tokens; type scale, spacing, radius (1rem base),
  elevation and motion tokens; the `--hero` gradient and its text colors for the balance card; `--font-sans`; reduced-motion rule; `@theme inline` mappings.
- `apps/web/src/app/[locale]/layout.tsx` (modified) — load Inter with `next/font/google`, apply
  `--font-sans`, read `x-nonce` from `headers()`, render the pre-paint script, add
  `suppressHydrationWarning` on `<html>`, mount the theme provider.
- `apps/web/src/lib/theme.ts` (new) — the `Theme` type, `parseTheme(value)` (returns `system` for
  any unknown value), `resolveTheme(theme, prefersDark)`, the storage key and the pre-paint script
  source string.
- `apps/web/src/components/theme-provider.tsx` (new) — client provider: reads and writes
  `localStorage` inside try/catch, applies the `dark` class, follows `prefers-color-scheme` while
  the theme is `system`.
- `apps/web/src/components/theme-toggle.tsx` (new) — segmented control for light, dark and system.
- `apps/web/src/components/ui/button.tsx`, `input.tsx`, `select.tsx`, `checkbox.tsx`, `card.tsx`,
  `alert.tsx`, `label.tsx`, `form.tsx` (modified) — restyle with tokens, 44 px targets, visible
  focus ring, same exported APIs; `alert.tsx` gains `success`, `warning` and `info` variants.
- `apps/web/src/components/ui/badge.tsx`, `skeleton.tsx`, `empty-state.tsx`, `page-header.tsx`,
  `list-row.tsx`, `amount.tsx`, `error-state.tsx` (new) — `amount` wraps `formatMoney` from
  `@pesly/shared`, the formatter the accounts and movements screens already use, so a figure reads
  the same everywhere (the investments screens keep `apps/web/src/lib/format-amount.ts`), and adds
  the tabular-numeral class plus a sign or icon for income and expense; `error-state` is the shared failure view with a retry button.
- `apps/web/src/features/auth/components/form-alert.tsx`, `auth-field.tsx` (modified) — restyle
  only, API frozen.
- `apps/web/src/app/[locale]/design-system/page.tsx` (new) — reference page; calls `notFound()`
  when `NODE_ENV` is `production`.
- `apps/web/messages/en.json`, `apps/web/messages/es.json` (modified) — add the `ui` and `theme`
  namespaces (empty state, retry, loading, theme labels, design-system page copy).
- `apps/web/test/theme.test.ts`, `theme-provider.test.tsx`, `ui-components.test.tsx`,
  `design-tokens-contrast.test.ts`, `design-system-page.test.tsx`, `locale-layout.test.tsx`,
  `proxy.test.ts` (new or modified) — see Required tests.

**Logic**
Tokens are the only place a color, radius, spacing, elevation or duration value is written; the
components consume them through Tailwind utilities. `parseTheme` accepts only `light`, `dark` and
`system`. The pre-paint script reads the stored value, falls back to the operating system
preference, and sets the `dark` class before React hydrates; the provider then keeps state in sync.
Existing component APIs do not change, so every current call site keeps compiling and the
parallel blocks can start from a stable surface. The reference page renders every token and every
component variant and state in both themes, uses `bigint` samples for every amount (no `Number(`
or `parseFloat`), and takes every label from the `ui` and `theme` catalogs. The layout reads the
nonce from the `x-nonce` request header and, if that header is absent, from the `'nonce-…'`
value of the request `Content-Security-Policy` header, which Next.js itself already depends on;
with neither it emits no inline script and the page still renders. The pre-paint script is a plain
`<script nonce>` with `suppressHydrationWarning`, not `next/script`.

**Input validation**
- The stored theme value is read from `localStorage`: type string, allowed values `light`, `dark`
  and `system`, anything else treated as `system`.

**Error handling**
- A stored theme value outside the allowed set resolves to `system`.
- `localStorage` access throws (private mode, blocked storage): the provider keeps the theme in
  memory and the app renders correctly.
- A request to `/design-system` in production answers 404.
- Neither `x-nonce` nor a CSP nonce is present on the request: no inline script is emitted and the
  page renders with the system theme.

**Required tests**
- [ ] Every semantic color token has a light and a dark value in `globals.css` — validates AC-01.
- [ ] The amount component renders a sign or icon for income and for expense, not color alone —
      validates AC-02.
- [ ] The locale layout loads the `next/font` typeface and emits no third-party font URL —
      validates AC-03.
- [ ] The amount component applies the tabular-numeral class — validates AC-04.
- [ ] No value for spacing, radius, elevation or motion is written outside `globals.css` and
      `components/ui/` — validates AC-05.
- [ ] Choosing dark, light or system applies the class immediately and persists after remount —
      validates AC-06.
- [ ] The pre-paint script sets the `dark` class from the stored theme and carries the nonce —
      validates AC-07.
- [ ] With no stored theme the app follows the operating system preference — validates AC-08.
- [ ] Each ui component renders every variant and state from tokens — validates AC-09.
- [ ] `/design-system` outside production lists every token and component variant in both
      themes — validates AC-10.
- [ ] `/design-system` in production answers 404 — validates AC-11.
- [ ] A skeleton and an empty state render from the shared ui components — validates AC-21 and
      AC-22.
- [ ] Every interactive ui component shows a focus indicator on keyboard focus — validates AC-23.
- [ ] The reduced-motion rule disables non-essential animation — validates AC-24.
- [ ] The text and border token pairs meet 4.5:1 and 3:1 in both themes — validates NFR-01.
- [ ] A stored theme value outside the allowed set resolves to system — sad path for the invalid
      stored value.
- [ ] A `localStorage` that throws leaves the theme working in memory — sad path for blocked
      storage.
- [ ] The design-system page answers 404 in production — sad path for the production gate.
- [ ] The pre-paint script is a constant string with no interpolation, and the layout takes its
      nonce from `x-nonce`, then from the request CSP header — validates the nonce plan.
- [ ] The proxy output forwards `x-nonce` and the CSP header to the request the layout reads —
      validates that the nonce reaches `headers()` through the next-intl middleware.
- [ ] A request with neither a nonce header nor a CSP nonce renders the page and emits no inline
      script — sad path for the missing nonce.

**Completion criterion**
All listed tests pass; `pnpm typecheck` and `pnpm lint` pass; every existing web test still passes
with the restyled primitives; `/design-system` renders in development in both themes.

## Block 2 — App shell

**Files**
- `apps/web/src/features/shell/components/authenticated-shell.tsx` (moved from
  `features/auth/components/`, modified) — new frame: side navigation from `md`, bottom navigation
  below `md`, persistent add-movement action, a frame with skeleton while the session check runs,
  and the shared error state on failure.
- `apps/web/src/features/shell/containers/authenticated-shell-container.tsx` (moved from
  `features/auth/containers/`) — the session guard, unchanged in behavior.
- `apps/web/src/features/shell/components/sign-out-button.tsx` (moved from
  `features/auth/components/`, restyled).
- `apps/web/src/features/shell/components/bottom-nav.tsx` (new) — bottom bar with Home, Accounts,
  Movements, Investments and More, plus the add-movement action.
- `apps/web/src/features/shell/components/side-nav.tsx` (new) — side navigation with the same
  destinations and, directly, categories, profile, security, theme toggle and sign out.
- `apps/web/src/features/shell/components/more-menu.tsx` (new) — presentational list used by the
  `/more` page; receives sign-out state and handlers as props.
- `apps/web/src/features/shell/containers/more-container.tsx` (new) — client container that owns
  the sign-out state for `/more`.
- `apps/web/src/features/shell/nav-items.ts` (new) — the destination list and the active-link
  rule.
- `apps/web/src/app/[locale]/(app)/more/page.tsx` (new) — the More destination for small screens.
- `apps/web/src/app/[locale]/(app)/layout.tsx` (modified) — import the moved container.
- `apps/web/messages/en.json`, `apps/web/messages/es.json` (modified) — `app.*` namespace.
- `apps/web/test/auth-components.test.tsx`, `authenticated-shell-container.test.tsx`,
  `shell-navigation.test.tsx`, `i18n-catalogs.test.ts` (modified or new) — see Required tests;
  shell assertions move out of `auth-components.test.tsx` and import paths follow the move.
- `apps/web/e2e/profile.spec.ts`, `delete-user.spec.ts`, `google.spec.ts`, `two-factor.spec.ts`,
  `movements.spec.ts`, `accounts.spec.ts` (modified) — keep the profile and security link flows
  green against the new frame and remove any strict-locator clash with the new add-movement link.

**Logic**
The shell renders the bottom bar below `md` and the side navigation from `md` using responsive
utilities (`md:hidden` on the bottom bar, `hidden md:flex` on the side navigation), so the browser
shows exactly one of them. The active destination carries `aria-current="page"`. The add-movement
action links to `/movements/new`, is always visible, and has an accessible name distinct from the
page's own links. While the session check runs, the frame and a page skeleton are drawn and
`children` are not mounted; after it succeeds they mount, exactly as the guard behaves today. On
`md` and above the side navigation exposes categories, profile and security as links with the
accessible names they have today, so desktop e2e flows keep working; on small screens the same
links live on `/more`. Responsive visibility cannot be measured under happy-dom, which has no CSS,
so Vitest asserts the class contract of each navigation and Playwright (Block 8) asserts the real
visibility at 360 px and 1280 px.

**Error handling**
- Session check failure: the shell shows the shared error state with a retry action, as today.
- Sign-out failure: the shell keeps the user in place and shows the existing sign-out error alert.

**Required tests**
- [ ] The shell renders the bottom navigation with the primary destinations and the add-movement
      action, carrying the `md:hidden` class contract — validates AC-12 (visibility is measured in
      Block 8).
- [ ] The shell renders the side navigation with the `hidden md:flex` class contract and the
      direct profile, security and categories links — validates AC-13 (visibility is measured in
      Block 8).
- [ ] The current destination has `aria-current="page"` and no other link has it — validates AC-14.
- [ ] The `/more` page lists categories, profile, security, theme toggle and sign out — validates
      FR-07.
- [ ] While the session check runs the frame and skeleton render and no child is mounted until it
      succeeds — validates the unchanged guard.
- [ ] A session check failure shows the error state and retry works — sad path for the session
      failure.
- [ ] A sign-out failure keeps the user in place and shows the alert — sad path for the sign-out
      failure.

**Completion criterion**
All listed tests pass; the updated unit tests and the four edited e2e specs pass; the shell shows
the correct navigation at 360 px and at 1280 px.

## Block 3 — Auth screens

**Files**
- `apps/web/src/app/[locale]/(auth)/layout.tsx` (modified)
- `apps/web/src/app/[locale]/(auth)/sign-in/page.tsx`, `sign-in/second-factor/page.tsx`,
  `register/page.tsx`, `forgot-password/page.tsx`, `reset-password/page.tsx`,
  `check-your-email/page.tsx`, `verify-email/page.tsx` (modified)
- `apps/web/src/features/auth/components/sign-in-form.tsx`, `register-form.tsx`,
  `forgot-password-form.tsx`, `reset-password-form.tsx`, `second-factor-form.tsx`,
  `verify-email-notice.tsx`, `google-sign-in-button.tsx` (modified) — layout, spacing and state
  restyle using ui components; no change to validation or behavior.
- `apps/web/messages/en.json`, `apps/web/messages/es.json` (modified) — `auth.*` namespace only.
- `apps/web/test/auth-components.test.tsx`, `auth-i18n.test.tsx` (modified) — assertions follow the
  new markup.

**Logic**
Every auth screen uses only ui components and tokens, in a calm centered layout with the
wordmark above the card, and keeps its current fields, validation messages, focus handling and
redirects. The Google logo keeps its brand fills and is the single allowlisted literal for the
NFR-05 scan.

**Input validation**
- Unchanged: every auth form keeps the shared Zod validation it has today (type, length and format
  of email, password and code fields) and its field-level messages; this block adds no new input.

**Error handling**
- Existing sign-in, registration, reset and verification errors keep their current messages and
  alerts; a failed field keeps focus on the first invalid field.

**Required tests**
- [ ] Each of the seven auth screens renders with design system components and keeps its fields
      and validation messages — validates AC-15.
- [ ] A failed sign-in still shows its error alert and focuses the first invalid field — sad path
      preserved from the current behavior.

**Completion criterion**
Listed tests and every existing auth test pass; the seven screens look correct in light and dark at
360 px and 1280 px.

## Block 4 — Profile, security and delete account

**Files**
- `apps/web/src/app/[locale]/(app)/settings/profile/page.tsx`, `settings/security/page.tsx`,
  `settings/delete-account/page.tsx` (modified)
- `apps/web/src/features/profile/components/*.tsx` (modified) — `profile-form`,
  `preferences-form`, `delete-user-form`, `delete-user-google`, `saved-notice`.
- `apps/web/src/features/two-factor/components/*.tsx` (modified) — `two-factor-setup`,
  `two-factor-status`, `recovery-codes`, `disable-two-factor`.
- `apps/web/messages/en.json`, `apps/web/messages/es.json` (modified) — `security.*`, `profile.*`
  and `deleteUser.*` namespaces only.
- `apps/web/test/profile-components.test.tsx`, `two-factor-components.test.tsx` and their i18n
  tests (modified) — assertions follow the new markup.

**Logic**
The three screens adopt ui components, tokens, `page-header` and `list-row`, and keep their
behavior: profile edit, language and time zone preferences, two-factor setup with QR and recovery
codes, disable, and account deletion with confirmation.

**Input validation**
- Unchanged: the profile, preferences, two-factor code and deletion confirmation forms keep the
  shared Zod validation they have today (type, length, format and allowed values); this block adds
  no new input.

**Error handling**
- Existing profile save, two-factor and deletion errors keep their current alerts and messages.

**Required tests**
- [ ] The profile, security and delete-account screens render with design system components and
      keep their behavior — validates AC-16.
- [ ] A rejected profile save still shows its error alert — sad path preserved from the current
      behavior.

**Completion criterion**
Listed tests and every existing profile and two-factor test pass; the screens look correct in both
themes at 360 px and 1280 px.

## Block 5 — Accounts and movements

**Files**
- `apps/web/src/app/[locale]/(app)/accounts/page.tsx`, `accounts/new/page.tsx`,
  `movements/page.tsx`, `movements/new/page.tsx` (modified)
- `apps/web/src/features/accounts/components/*.tsx` (modified) — `account-list`, `account-row`,
  `account-form`, `account-field`, `accounts-headline`, `accounts-load-state`.
- `apps/web/src/features/movements/components/*.tsx` (modified) — `movement-list`,
  `movement-row`, `movement-form`, `movement-field`, `movement-saved`, `movements-load-state`,
  `rate-field`.
- `apps/web/messages/en.json`, `apps/web/messages/es.json` (modified) — `accounts.*` and
  `movements.*` namespaces only.
- `apps/web/test/accounts-components.test.tsx`, `movements-components.test.tsx` and their i18n
  tests (modified).

**Logic**
Both modules adopt ui components and tokens. The load states render a skeleton while loading, an
empty state with a call to action when there is no data, and the shared error state with retry on
failure. Movement rows use the amount component so income and expense read at a glance and digits
align. Behavior, validation and frozen-rate display rules do not change.

**Input validation**
- Unchanged: the account and movement forms keep the shared Zod validation they have today (type,
  length, format, currency and amount rules); this block adds no new input.

**Error handling**
- A failed accounts or movements request shows the error state with retry.
- Existing form errors keep their current alerts and messages.

**Required tests**
- [ ] The accounts and movements screens render with design system components and keep their
      behavior — validates AC-17.
- [ ] While loading, each screen shows a skeleton — validates AC-21.
- [ ] With no data, each screen shows an empty state with a call to action — validates AC-22.
- [ ] A failed accounts or movements request shows the error state and retry works — sad path for
      the failed request.
- [ ] An invalid movement or account form submission still shows its field error and focuses the
      first invalid field — sad path preserved from the current form behavior.

**Completion criterion**
Listed tests and every existing accounts and movements test pass; the four screens look correct in
both themes at 360 px and 1280 px.

## Block 6 — Categories and investments

**Files**
- `apps/web/src/app/[locale]/(app)/categories/page.tsx`, `investments/page.tsx` (modified)
- `apps/web/src/features/categories/components/*.tsx` (modified) — `category-list`,
  `category-form`, `category-field`, `category-pickers`, `category-visual`,
  `categories-load-state`; the `ring-[3px]` in `category-pickers.tsx` becomes a token-based
  utility (it is the only arbitrary design value outside `components/ui/`; structural variants
  such as `data-[error=true]:`, `[&>svg]:` and grid templates stay).
- `apps/web/src/features/investments/components/*.tsx` (modified) — `investments-screen`,
  `portfolio-card`, `holding-row`, `add-holding-form`, `edit-holding-form`,
  `create-portfolio-form`, `price-form`, `form-error-alert`.
- `apps/web/messages/en.json`, `apps/web/messages/es.json` (modified) — `categories.*` and
  `investments.*` namespaces only.
- `apps/web/test/categories-components.test.tsx`, `investments-components.test.tsx` and their i18n
  tests (modified).

**Logic**
Both modules adopt ui components and tokens with the same loading, empty and error pattern as
Block 5. Category colors keep their `--category-*` tokens, now verified for contrast. Behavior and
validation do not change.

**Input validation**
- Unchanged: the category, portfolio, holding and price forms keep the shared Zod validation they
  have today (type, length, format and allowed values); this block adds no new input.

**Error handling**
- A failed categories or investments request shows the error state with retry.
- Existing form errors keep their current alerts and messages.

**Required tests**
- [ ] The categories and investments screens render with design system components and keep their
      behavior — validates AC-17.
- [ ] While loading, each screen shows a skeleton — validates AC-21.
- [ ] With no data, each screen shows an empty state with a call to action — validates AC-22.
- [ ] A failed categories or investments request shows the error state and retry works — sad path
      for the failed request.
- [ ] An invalid category or holding form submission still shows its field error and focuses the
      first invalid field — sad path preserved from the current form behavior.

**Completion criterion**
Listed tests and every existing categories and investments test pass; both screens look correct in
both themes at 360 px and 1280 px.

## Block 7 — Home

**Files**
- `apps/web/src/app/[locale]/(app)/page.tsx` (modified) — renders the home container.
- `apps/web/src/features/home/containers/home-container.tsx` (new) — fetches accounts (active and
  archived), categories (active and archived), the five latest movements and the profile.
- `apps/web/src/features/home/components/home-screen.tsx`, `balance-summary.tsx`,
  `recent-movements.tsx`, `quick-actions.tsx` (new) — presentational, no data fetching.
- `apps/web/messages/en.json`, `apps/web/messages/es.json` (modified) — `home.*` namespace only.
- `apps/web/test/routes.test.tsx` (modified) — the placeholder `home.title` and `home.tagline`
  assertions follow the real home. Block 7 does not edit `i18n-catalogs.test.ts`; Block 8 updates
  its `home` assertions.
- `apps/web/test/home-container.test.tsx`, `home-components.test.tsx` (new).

**Logic**
The container calls, in the same tick, `listAccounts` for active accounts and for archived
accounts, `listCategories` for active and for archived categories, `listMovements({ limit: 5 })`
and `getProfile`, then renders the balance per currency from `availableTotals` of the active
accounts response (no client-side summing), the five latest movements (the API already orders them
newest first) and quick actions to add a movement and an account. Account names and currencies come
from the first 100 accounts of each list and category names from the first 100 of each list, so a
movement on an account beyond those limits is a known limit. Dates are shown in the user's time
zone from the profile. It reuses the `amount` component and `categoryLabel` from
`features/categories/category-display.ts`. A user with no accounts sees an empty state with an
action to create the first account. The home is a client container because all financial data goes
through the Express API.

**Error handling**
- The active accounts or movements request fails: the home shows the shared error state with a
  retry action and renders no balance.
- The session is unauthenticated: the container redirects to `/sign-in`, as the other containers
  do.
- A categories request fails: the rows show an unknown-category placeholder and the home still
  renders, because a category name is not needed to read a balance.
- The profile request fails: dates use the browser's time zone, and UTC if that zone is invalid.
- The archived accounts request fails, or a movement is on an account outside the loaded lists: the
  row shows an unknown-account label and its figure without a currency symbol, never a wrong
  currency.

**Required tests**
- [ ] A loaded home shows the balance per currency and the five most recent movements — validates
      AC-18.
- [ ] A user with no accounts sees an empty state with a create-account action — validates AC-19.
- [ ] A failed accounts or movements request shows the error state, retry works and no stale
      balance is shown — validates AC-20.
- [ ] While loading the home shows a skeleton from its first render, and all six data requests
      start before any resolves — validates AC-21 and NFR-06.
- [ ] A movement on an archived account shows that account's real currency — validates AC-18 for
      archived accounts.
- [ ] Sad path: a failed categories request leaves the rows with the unknown-category placeholder
      and no error screen.
- [ ] Sad path: a failed profile request renders dates in the browser's time zone, and in UTC when
      that zone is invalid.
- [ ] Sad path: a movement on an unknown account shows the unknown-account label and its figure
      without a currency symbol.
- [ ] An unauthenticated response redirects to `/sign-in` — sad path for the unauthenticated
      session.
- [ ] The retry button is disabled while a request is in flight, so repeated clicks send one
      request — sad path for repeated retries.
- [ ] Loading the home writes nothing to `localStorage`, `sessionStorage` or IndexedDB — validates
      that financial data is held in memory only.

**Completion criterion**
Listed tests pass and `routes.test.tsx` passes with the real home; the home looks correct in both
themes at 360 px and 1280 px.

## Block 8 — Cross-cutting verification

**Files**
- `apps/web/test/design-system-scan.test.ts` (new) — NFR-05 scan with the Google logo allowlist.
- `apps/web/test/i18n-catalogs.test.ts` (modified) — update the `categories`, `investments` and
  `home` assertions to the new catalogs, extend the parity check to the new namespaces, and
  validate both catalogs as JSON after the parallel wave.
- `apps/web/e2e/design-system.spec.ts` (new) — checks at 360 px and 1280 px: bottom navigation
  visible and side navigation hidden at 360 px and the reverse at 1280 px, 44 px targets, focus
  indicator, layout shift at or below 0.1, theme persistence and no flash.

**Logic**
The scan walks `apps/web/src/features` and `apps/web/src/app` as `test/no-float-money.test.ts`
does. It fails on hex, `rgb(`, `hsl(` or `oklch(` literals and on arbitrary-value utilities that
carry a design value, matched by `\b(text|bg|border|ring|p[xytblr]?|m[xytblr]?|gap|space-[xy]|w|h|size|min-w|min-h|rounded|shadow|font|duration|ease|outline|opacity)-\[`;
structural variants (`data-[…]:`, `[&>…]:`) and grid templates are not matched. The only
allowlist entry is the Google logo in `google-sign-in-button.tsx`. The parity test fails when a
key exists in only one catalog. The e2e spec runs the NFR-02 and NFR-03 pages in a 360 px viewport
in light and dark and the navigation visibility checks at both widths.

**Error handling**
- A literal or arbitrary-value class found by the scan fails the test and names the file and line.
- A key present in one catalog only fails the parity test and names the key.

**Required tests**
- [ ] The scan finds no color literal outside the allowlist and no arbitrary-value class —
      validates NFR-05 and AC-05.
- [ ] Every key exists in both catalogs — validates AC-25.
- [ ] A key missing from one catalog makes the parity test fail — sad path for the missing
      translation.
- [ ] A color literal planted in a feature file makes the scan fail — sad path for the scan.
- [ ] At 360 px every interactive element on the home, sign-in and movements pages is at least
      44 by 44 px — validates NFR-02.
- [ ] Keyboard tabbing shows a focus indicator on every stop — validates AC-23.
- [ ] Layout shift on the home, sign-in and movements pages totals at most 0.1 — validates NFR-03.
- [ ] At 360 px the bottom navigation is visible and the side navigation is hidden, and at 1280 px
      the reverse — validates AC-12 and AC-13.

**Completion criterion**
All listed tests pass; `pnpm test:coverage` meets the 80% floor for lines, branches and functions;
`pnpm lint`, `pnpm typecheck` and `pnpm --filter @pesly/web build` pass.

## Final verification

- Every acceptance criterion AC-01 to AC-25 has at least one passing test.
- `pnpm lint`, `pnpm typecheck`, `pnpm test:coverage` and the web build pass; the e2e suite,
  including the updated shell flows and the 360 px spec, passes.
- Every one of the 17 pages renders in light and dark with the new system, and the home shows
  real data from the API.
- The reference page lists every token and component and answers 404 in production.
- No backend, schema, API contract or runtime dependency changed: `git diff main --
  apps/web/package.json` shows no change to `dependencies` (NFR-04).
- No block touched a frozen file or a file outside its own Files list.
- Rollback: the change is frontend-only with no data migration, so reverting the merge commit
  restores the previous interface; a stored `pesly-theme` value is ignored by the old code.

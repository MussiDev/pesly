# PRD FEAT-004: Pesly design system and UX/UI overhaul

| Field | Value |
|-------|-------|
| Ticket | FEAT-004 |
| Tracker | none |
| Date | 2026-10-03 |
| PRD loops | 1 |
| Loops since last human decision | 1 |

## Context and Problem

The web app (`apps/web`) has 17 pages across auth, accounts, movements, categories, investments,
profile and security, but no visual identity. The theme is the stock shadcn "neutral" grayscale, the
shell is a plain header with text links, and every feature restyles its own spacing and states.
Two defects are structural: the dark theme variables exist in `globals.css` but nothing ever sets
the `dark` class, so dark mode is unreachable, and no typeface is loaded, so text falls back to the
system font. The home page is a placeholder even though the accounts and movements APIs now exist
on `main`.

The product is a mobile-first PWA used at the moment of paying, so it must be fast to scan, calm to
read and consistent across screens.

## Goals

- Give Pesly one design system: color, type, spacing, radius, elevation, motion and components,
  all expressed as theme tokens and documented in a live reference page.
- Direction: minimalist, emerald accent on warm neutrals, light and dark.
- Apply the system to every existing screen, with a mobile-first app shell.
- Replace the placeholder home with a real one fed by the accounts and movements APIs.
- Ship as a single ticket; screens are built in parallel once the foundation exists.

## Functional Requirements

- FR-01: The system defines semantic color tokens as CSS variables for light and dark: background,
  surface, foreground, muted, border, primary (emerald), and the status colors success, warning,
  destructive and info, plus the money colors income and expense.
- FR-02: The system defines a type scale (display, title, heading, body, small, caption) with one
  self-hosted typeface loaded through `next/font`, and a tabular-numeral style for amounts.
- FR-03: The system defines tokens for spacing, radius, elevation and motion duration/easing.
- FR-04: The user can choose the theme (light, dark, or follow the system) from the app; the choice
  persists and is applied before first paint.
- FR-05: The component library in `apps/web/src/components/ui/` provides restyled button, input,
  select, checkbox, card and alert, plus new badge, skeleton, empty-state, page-header, list-row and
  amount components.
- FR-06: A design system reference page lists every token and component in every variant and state,
  in both themes.
- FR-07: The authenticated area uses a mobile-first shell: a bottom navigation bar below the `md`
  breakpoint and a side navigation at `md` and above, with a persistent primary action to add a
  movement.
- FR-08: The seven public auth screens (sign in, second factor, register, forgot password, reset
  password, check your email, verify email) use the new system.
- FR-09: The profile, security (two-factor setup, recovery codes, disable) and delete-account
  screens use the new system.
- FR-10: The accounts (list, new), movements (list, new), categories and investments screens use
  the new system.
- FR-11: The home screen shows the user's total balance per currency, the five most recent
  movements and quick actions to add a movement and an account, using data from the API.
- FR-12: Every screen that loads data renders a skeleton while loading, an empty state with a
  call to action when there is no data, and an error state with a retry action on failure.
- FR-13: Every interactive element has a visible keyboard focus indicator, and animations stop
  when the user prefers reduced motion.
- FR-14: Every new user-facing string exists in both the Spanish and the English catalogs.

## Non-Functional Requirements

- NFR-01: Text and its background reach a contrast ratio of at least 4.5:1, and interactive
  component borders and icons at least 3:1, in both themes, on every token pair in the reference
  page.
- NFR-02: Every touch target is at least 44 by 44 CSS pixels at a 360 px wide viewport.
- NFR-03: Cumulative Layout Shift stays at or below 0.1 on the home, sign-in and movements pages,
  including font loading and theme application.
- NFR-04: The overhaul adds 0 new runtime dependencies to `apps/web/package.json`.
- NFR-05: No component or page outside `components/ui/` and `globals.css` contains a hardcoded
  color, radius or spacing value; 0 occurrences of hex, `rgb(`, `hsl(` or `oklch(` literals in
  `apps/web/src/features` and `apps/web/src/app`.
- NFR-06: The home screen shows its skeleton within 100 ms of navigation and its data within 2 s at
  the 75th percentile on a throttled 4G profile.
- NFR-07: Test coverage over `apps/api/src`, `apps/web/src` and `packages/shared/src` stays at or
  above 80% lines, branches and functions, and every pre-existing automated test passes.

## Acceptance Criteria

- AC-01 (FR-01): THE design system SHALL define every semantic color token in both a light and a
  dark value in `globals.css`.
- AC-02 (FR-01): WHEN a movement amount is rendered as income or expense, THE amount component
  SHALL convey the direction with a sign or icon as well as color.
- AC-03 (FR-02): WHEN any page is rendered, THE system SHALL apply the self-hosted typeface from
  `next/font` and make no request to a third-party font host.
- AC-04 (FR-02): WHEN a monetary amount is rendered, THE amount component SHALL use tabular
  numerals so digits align in a column.
- AC-05 (FR-03): THE design system SHALL expose spacing, radius, elevation and motion values only
  as tokens that components consume through Tailwind utilities.
- AC-06 (FR-04): WHEN the user selects dark, light or system theme, THE app SHALL apply it
  immediately and keep it after a reload.
- AC-07 (FR-04): WHEN a page is first rendered with a stored theme, THE app SHALL apply that theme
  before first paint, with no flash of the other theme.
- AC-08 (FR-04): IF no theme is stored, THEN THE app SHALL follow the operating system preference.
- AC-09 (FR-05): THE component library SHALL render each component's variants and states from the
  restyled tokens only.
- AC-10 (FR-06): WHEN a developer opens `/design-system` outside production, THE app SHALL show
  every token and component variant in both themes.
- AC-11 (FR-06): IF the app runs in production, THEN THE app SHALL answer `/design-system` with a
  404.
- AC-12 (FR-07): WHILE the viewport is narrower than the `md` breakpoint, THE shell SHALL show a
  bottom navigation bar with the primary destinations and the add-movement action.
- AC-13 (FR-07): WHILE the viewport is at or above the `md` breakpoint, THE shell SHALL show a side
  navigation instead of the bottom bar.
- AC-14 (FR-07): WHEN the user is on a page, THE shell SHALL mark that destination with
  `aria-current="page"`.
- AC-15 (FR-08): WHEN any of the seven auth screens is rendered, THE screen SHALL use only design
  system components and tokens and keep its existing behavior and validation messages.
- AC-16 (FR-09): WHEN the profile, security or delete-account screens are rendered, THE screens
  SHALL use only design system components and tokens and keep their existing behavior.
- AC-17 (FR-10): WHEN the accounts, movements, categories or investments screens are rendered, THE
  screens SHALL use only design system components and tokens and keep their existing behavior.
- AC-18 (FR-11): WHEN the home screen loads, THE home SHALL show the total balance per currency
  from the accounts API and the five most recent movements from the movements API.
- AC-19 (FR-11): IF the user has no accounts, THEN THE home SHALL show an empty state with an
  action to create the first account.
- AC-20 (FR-11): IF the accounts or movements request fails, THEN THE home SHALL show an error state
  with a retry action and no stale balance.
- AC-21 (FR-12): WHILE a data screen is loading, THE screen SHALL show a skeleton that occupies the same
  container as the loaded content, so the swap shifts layout by at most 0.1 CLS (NFR-03).
- AC-22 (FR-12): IF a data screen has no data, THEN THE screen SHALL show an empty state with a
  call to action.
- AC-23 (FR-13): WHEN the user moves focus with the keyboard, THE app SHALL show a focus indicator
  on every interactive element.
- AC-24 (FR-13): WHILE the user prefers reduced motion, THE app SHALL disable non-essential
  animation.
- AC-25 (FR-14): IF a UI string is missing from either the Spanish or the English catalog, THEN THE
  test suite SHALL fail.

## Out of Scope

- New backend endpoints, schema changes or migrations.
- New financial features (budgets, goals, groups, credit cards, reports, charts).
- A logo or brand mark beyond a text wordmark; illustrations and marketing pages.
- Offline queue, service worker and push behavior.
- Changing any business rule, validation rule or API contract of existing screens.
- A user-selectable accent color.

## Risks and Mitigations

- **Large surface (17 pages, ~60 components) in one ticket.** The user chose a single ticket. Mitigation:
  PLAN splits the work into one foundation block and independent screen-group blocks that are
  implemented in parallel, each with its own tests.
- **Visual regressions in existing flows.** Mitigation: every existing test must keep passing
  (NFR-07) and AC-15 to AC-17 require unchanged behavior.
- **Parallel blocks drifting apart visually.** Mitigation: the foundation block lands first and
  screens may only consume tokens and `components/ui/`; NFR-05 is checked by a scan.
- **Contrast failures from a hand-picked palette.** Mitigation: NFR-01 is verified on every token
  pair in the reference page.
- **Home data latency.** Mitigation: skeleton first (NFR-06) and use of the existing API only.

## Assumptions (not stated by the user; confirm or correct)

- A1: One sans typeface, self-hosted through `next/font` (no new dependency), chosen in PLAN.
- A2: Primary destinations are Home, Accounts, Movements and Investments; profile, security and
  categories live under a "More" destination.
- A3: The reference page lives at `/[locale]/design-system` and is hidden in production.
- A4: Wordmark is text only.

## Dependencies

- Identity, accounts and movements modules already on `main` (PRD 01, 02, 03b); home depends on
  the accounts and movements APIs and their existing client code.
- `AGENTS.md` conventions: container/presentational split, theme tokens only, no hardcoded strings,
  Server Components never touch financial data.
- Tailwind CSS 4, shadcn/ui source in `components/ui/`, lucide-react, next-intl.

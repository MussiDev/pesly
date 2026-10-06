# PRD FEAT-005: Professional UX/UI redesign with merchant and asset logos

| Field | Value |
|-------|-------|
| Ticket | FEAT-005 |
| Tracker | none |
| Date | 2026-10-05 |
| PRD loops | 2 |
| Loops since last human decision | 0 |

## Context and Problem

FEAT-004 (merged 2026-10-03, PRs #21 to #23) gave Pesly a token-based design system, a mobile-first
shell and a real home. Its look is flat: an indigo accent on grey, thin borders, text-only rows and a
side navigation on desktop. The user judges it still short of a professional personal-finance and
investment-management product and asked for a complete visual refactor, using modern banking and
investment apps as references.

The user supplied five reference designs and approved a concept in three screens (light mobile home,
dark mobile investments, light desktop summary). What the approved concept takes from the references:

- a cool light-grey canvas with white cards of large radius instead of bordered panels;
- a deep navy accent and a navy balance card as the one saturated surface of a screen;
- circular quick-action buttons, pill-shaped tabs and chips;
- a floating pill bottom bar with a circular add-movement button in its center on mobile, and a
  top navigation card on desktop;
- a company logo as the leading avatar of every movement and every holding;
- a donut chart for portfolio composition.

Facts about the current code that bound the work:

- Movements have no merchant. They carry a free-text `note` (at most 500 characters), a category and
  a type. The movement row already prints the note.
- Holdings carry `ticker`, `instrumentName`, `instrumentType`, `value` and `gain`, so asset logos and
  a composition chart need no backend change.
- The content security policy allows images only from `'self'`, `blob:` and `data:`.
- The new-movement screen does not accept a preselected movement type today.
- Several elements of the concept (month-over-month variation, balance history, monthly flow bars)
  need aggregates that no API returns.

## Goals

- Replace the FEAT-004 look with the approved "soft cards" direction in light and dark, on every
  existing screen, keeping every behavior and API contract unchanged.
- Show a company logo for recognizable merchants in movements and for known tickers in investments,
  with a clean fallback, without changing the backend and without sending any user data to a third
  party.
- Make adding a movement obvious on mobile: a persistent circular add button in the center of the
  bottom bar.
- Add a composition donut to investments using only data the investments API already returns.
- Ship as one ticket, as the user decided on 2026-10-05 after a split into a (foundation and shell),
  b (screens with merchant logos) and c (investments) was proposed and declined. The design system
  and shell land first, and the screens consume only tokens and `components/ui/`.

## Functional Requirements

- FR-01: The system must define the redesigned semantic color tokens in `globals.css` for a light
  and a dark theme: a cool-grey canvas, white card surfaces, a navy primary accent, the status colors
  (success, warning, destructive, info) and the money colors (income, expense).
- FR-02: The system must load Plus Jakarta Sans through `next/font`, self-hosted, as the only
  typeface, and must keep tabular numerals for monetary amounts.
- FR-03: The component library in `apps/web/src/components/ui/` must provide, from tokens only, a
  large-radius card, a pill segmented control, a chip, an avatar, a circular action button and a
  donut chart.
- FR-04: The authenticated shell must show, below the `md` breakpoint, a floating pill bottom bar
  with the destinations Home, Movements, Investments and More and a circular add-movement button in
  its center.
- FR-05: The authenticated shell must show, at and above the `md` breakpoint, a top navigation card
  with the destinations as pills and an add-movement action, and must no longer show a side
  navigation.
- FR-06: The home must show a navy balance card with the total of each currency, four circular
  quick actions (expense, income, transfer, exchange), an accounts section and the five most recent
  movements.
- FR-07: The system must keep a curated catalog of merchants and services bundled with the web app,
  each entry holding a display name, one or more match keywords and a logo file, and must resolve the
  entry that a movement note names.
- FR-08: Each movement row, on the home and in the movements list, must show the resolved merchant
  logo as its leading avatar and otherwise the existing category or movement-type icon.
- FR-09: The system must keep a curated catalog of asset logos keyed by ticker, bundled with the web
  app, and each holding row must show the logo of its ticker or, when none exists, an avatar with the
  ticker's initials.
- FR-10: The system must serve every logo image from the app's own origin, must reserve its final
  size before the image loads, and must replace it with the fallback avatar when it fails to load.
- FR-11: The investments screen must show, for each portfolio, the total value per valuation
  currency and a donut chart of the priced holdings' value by instrument type with a legend, and must
  convey each holding's gain or loss with a sign or arrow as well as color.
- FR-12: The screens that FEAT-004 restyled (the seven auth screens, profile, security, delete
  account, accounts list and new, movements new and edit, categories, and More) must adopt the new
  system, with their loading, empty and error states, and must keep their existing behavior,
  validation messages and API calls.
- FR-13: The design system reference page at `/[locale]/design-system` must show every new and
  changed token and component variant in both themes.
- FR-14: Every new user-facing string must exist in both the Spanish and the English catalogs.
- FR-15: Every interactive element, including the bottom bar, the top navigation and the circular
  actions, must show a visible keyboard focus indicator, and non-essential animation must stop when
  the user prefers reduced motion.

## Non-Functional Requirements

- NFR-01: Text and its background reach a contrast ratio of at least 4.5:1, and interactive
  component borders and icons at least 3:1, in both themes, on every token pair listed in the
  reference page.
- NFR-02: Every touch target is at least 44 by 44 CSS pixels at a 360 px wide viewport.
- NFR-03: Cumulative Layout Shift stays at or below 0.1 on the home, sign-in, movements and
  investments pages, including font loading, theme application and logo loading.
- NFR-04: The redesign adds 0 new runtime dependencies to any `package.json`; the donut chart is
  drawn without a charting library.
- NFR-05: No component or page outside `components/ui/` and `globals.css` contains a hardcoded
  color, radius or spacing value; 0 occurrences of hex, `rgb(`, `hsl(` or `oklch(` literals in
  `apps/web/src/features` and `apps/web/src/app`.
- NFR-06: Each bundled logo file is at most 10 KB, and logos are requested only when the avatar that
  shows them is rendered, so 0 logo bytes are part of the page's JavaScript bundle.
- NFR-07: The home screen shows its skeleton within 100 ms of navigation and its data within 2 s at
  the 75th percentile on a throttled 4G profile.
- NFR-08: Test coverage over `apps/api/src`, `apps/web/src` and `packages/shared/src` stays at or
  above 80% lines, branches and functions; 0 pre-existing behavioral tests are deleted or weakened;
  tests that assert the layout replaced by FR-04 and FR-05 are rewritten to the new layout.
- NFR-09: The change adds 0 API endpoints, 0 database migrations and 0 modifications to any shared
  request or response schema.

## Acceptance Criteria

*(EARS — see `.ddw/rules/validation-rules.instructions.md` §1 for the five patterns)*

- AC-01 (FR-01): THE design system SHALL define every semantic color token with both a light and a
  dark value in `globals.css`, with a navy `primary`.
- AC-02 (FR-01): WHEN a movement amount is rendered as income or expense, THE amount component SHALL
  convey the direction with a sign or an arrow as well as color.
- AC-03 (FR-02): WHEN any page is rendered, THE app SHALL apply Plus Jakarta Sans served from the
  app's own origin and make no request to a third-party font host.
- AC-04 (FR-02): WHEN a monetary amount is rendered, THE amount component SHALL use tabular numerals
  so digits align in a column.
- AC-05 (FR-03): THE design system SHALL expose the card radius, the pill radius and the circular
  control size only as tokens that components consume through Tailwind utilities.
- AC-06 (FR-03): THE component library SHALL provide the card, pill segmented control, chip, avatar,
  circular action button and donut chart in `components/ui/`, each rendering only from tokens.
- AC-07 (FR-04): WHILE the viewport is narrower than the `md` breakpoint, THE shell SHALL show a
  floating pill bottom bar with the Home, Movements, Investments and More destinations and a circular
  add-movement button in its center.
- AC-08 (FR-04): WHEN the user activates the center button of the bottom bar, THE shell SHALL open
  the new-movement screen.
- AC-09 (FR-04): WHEN the user is on a page, THE shell SHALL mark the matching destination with
  `aria-current="page"`.
- AC-10 (FR-04): WHILE the bottom bar is shown, THE app SHALL keep the last element of every page
  fully visible above the bar when scrolled to the end.
- AC-11 (FR-05): WHILE the viewport is at or above the `md` breakpoint, THE shell SHALL show a top
  navigation card that lists the same destinations the side navigation lists today as pills, plus an
  add-movement action.
- AC-12 (FR-05): THE shell SHALL NOT render the side navigation at any viewport width.
- AC-13 (FR-06): WHEN the home loads, THE home SHALL show a balance card with the total balance of
  each currency from the accounts API, four circular quick actions, an accounts section and the five
  most recent movements from the movements API.
- AC-14 (FR-06): WHEN the user activates a circular quick action, THE home SHALL open the
  new-movement screen with that movement type preselected.
- AC-15 (FR-06): IF the user has no accounts, THEN THE home SHALL show an empty state with an action
  to create the first account.
- AC-16 (FR-06): IF the accounts or movements request fails, THEN THE home SHALL show an error state
  with a retry action and no stale balance.
- AC-17 (FR-07): THE merchant catalog SHALL give every entry a display name, at least one match
  keyword and a logo file bundled with the web app.
- AC-18 (FR-07): WHEN a movement note contains a catalog keyword as a whole word, compared without
  regard to case or accents, THE system SHALL resolve the entry that owns that keyword.
- AC-19 (FR-07): IF a note contains keywords of more than one entry, THEN THE system SHALL resolve
  the entry whose matching keyword is longest, and the entry listed first when the lengths tie.
- AC-20 (FR-07): IF a note is empty or contains no catalog keyword, THEN THE system SHALL resolve no
  entry.
- AC-21 (FR-08): WHEN an income or expense movement row is rendered and an entry was resolved, THE
  row SHALL show that entry's logo as its leading avatar.
- AC-22 (FR-08): IF no entry was resolved for an income or expense movement, THEN THE row SHALL show
  the existing category icon avatar.
- AC-23 (FR-08): WHEN a transfer or an exchange row is rendered, THE row SHALL show the
  movement-type icon and never a merchant logo.
- AC-24 (FR-09): WHEN a holding row is rendered, THE row SHALL show the logo of the catalog asset
  whose ticker equals the holding's ticker, compared without regard to case.
- AC-25 (FR-09): IF the catalog has no logo for a holding's ticker, THEN THE row SHALL show an avatar
  with the first two characters of the ticker.
- AC-26 (FR-10): WHEN any page is rendered, THE app SHALL request logo images only from its own
  origin and make no request to a third-party image host.
- AC-27 (FR-10): WHEN a logo avatar is rendered, THE avatar SHALL reserve its final width and height
  before the image loads.
- AC-28 (FR-10): IF a logo file fails to load, THEN THE avatar SHALL show the fallback avatar and no
  broken-image icon.
- AC-29 (FR-10): WHEN a logo image is rendered, THE image SHALL have an empty alternative text,
  because the row text already names the movement or the instrument.
- AC-30 (FR-11): WHEN the investments screen loads a portfolio with priced holdings, THE screen
  SHALL show its total value per valuation currency and a donut chart of the priced holdings' value by
  instrument type with a legend giving each type's name and percentage.
- AC-31 (FR-11): WHERE a portfolio holds priced holdings in more than one valuation currency, THE
  screen SHALL draw one donut per currency and never add values across currencies.
- AC-32 (FR-11): IF a portfolio has no priced holding, THEN THE screen SHALL show no donut chart and
  keep the existing notice about holdings without a price.
- AC-33 (FR-11): WHEN a holding's gain is positive or negative, THE holding row SHALL convey it with
  a sign or an arrow as well as color.
- AC-34 (FR-12): WHEN any screen listed in FR-12 is rendered, THE screen SHALL use only design system
  components and tokens and keep its existing behavior, validation messages and API calls.
- AC-35 (FR-12): WHILE a data screen is loading, THE screen SHALL show a skeleton that occupies the
  same container as the loaded content.
- AC-36 (FR-12): IF a data screen has no data, THEN THE screen SHALL show an empty state with a call
  to action, and IF its request fails, THEN THE screen SHALL show an error state with a retry action.
- AC-37 (FR-13): WHEN a developer opens `/design-system` outside production, THE page SHALL show every
  new and changed token and component variant in both themes.
- AC-38 (FR-13): IF the app runs in production, THEN THE app SHALL answer `/design-system` with a
  404.
- AC-39 (FR-14): IF a UI string is missing from either the Spanish or the English catalog, THEN THE
  test suite SHALL fail.
- AC-40 (FR-15): WHEN the user moves focus with the keyboard, THE app SHALL show a visible focus
  indicator on every interactive element, including the bottom bar, the top navigation and the
  circular actions.
- AC-41 (FR-15): WHILE the user prefers reduced motion, THE app SHALL disable non-essential
  animation.

## Out of Scope

- New backend endpoints, schema changes or migrations, and any change to a request or response
  contract.
- A structured merchant field on movements, and any control to choose or correct a movement's logo.
- Month-over-month variation, balance or net-worth history charts, monthly income and expense bars
  and any other aggregate no API returns today; they belong to Dashboard and Reports (PRD 10).
- Fetching logos from a third-party service at runtime, uploading logos, or a user-managed catalog.
- New financial features: budgets, goals, groups, credit cards, recurring payments.
- Global search and notification buttons.
- Offline queue, service worker and push behavior.
- Changing any business rule or validation rule of an existing screen.
- A user-selectable accent color.

## Risks and Mitigations

- **Brand marks carry trademark and license terms.** Bundling real company logos is not free of
  legal constraint. Mitigation: PLAN selects a source whose license permits redistribution as static
  assets, records the license of every logo, and ships an entry only with a cleared logo; the
  fallback avatar covers everything else (FR-09, AC-25, AC-28).
- **A note can name a merchant without meaning it** ("pago a Netflix Juan"), producing a wrong logo.
  Mitigation: whole-word matching, a curated catalog, longest-keyword rule (AC-18, AC-19) and the
  note stays visible in the row; a per-movement override is out of scope.
- **Concept elements without data behind them.** The approved concept shows aggregates no API
  returns. Mitigation: they are listed as out of scope and none is drawn with invented numbers.
- **Large surface (17 pages, around 60 components) in one ticket.** The user chose to keep one
  ticket (2026-10-05). Mitigation: PLAN orders one foundation block before independent screen-group
  blocks, each with its own tests, so review can proceed block by block.
- **Pre-existing tests assert the old layout.** The side navigation is replaced. Mitigation: NFR-08
  allows rewriting only the layout tests and forbids deleting or weakening behavioral ones.
- **The concept was drawn with literal color values.** Mitigation: PLAN maps every concept value to
  a token and NFR-05 is checked by the existing scan test.
- **Layout shift from late logos and fonts.** Mitigation: AC-27 and NFR-03.
- **Wrong totals if currencies mix in the donut.** Mitigation: AC-31.

## Assumptions (not stated verbatim by the user; confirm or correct)

- A1: The direction is the approved "soft cards" concept: navy accent, cool-grey canvas, white cards
  of 24 px radius, a navy balance card, circular quick actions, a floating pill bottom bar with a
  central add button, a top navigation card on desktop and dark navy-black as the dark theme.
- A2: The bottom bar destinations are Home, Movements, Investments and More. Accounts, Categories,
  Profile and Security live under More, and Accounts is also a section of the home. The concept
  labels the last tab "Profile"; this PRD keeps the existing More page instead.
- A3: The navy hue, the exact token values and the typeface (Plus Jakarta Sans) are proposals made
  in the concept; PLAN fixes the values under the contrast checks of NFR-01.
- A4: Logos are bundled static files served from the app's own origin, never requested from a
  third-party service while the user navigates. The user chose to recognize merchants from the note;
  bundling is this PRD's reading of that choice and of the `img-src 'self'` policy.
- A5: The initial entries of the merchant and asset catalogs, and the source and license of each
  logo, are chosen in PLAN. Catalog keywords and tickers are data, not translated strings.
- A6: Preselecting a movement type on the new-movement screen (AC-14) is a frontend change only,
  through the screen's URL, with no API change.
- A7: The donut groups by `instrumentType`, the field the holdings API already returns, and
  excludes holdings whose `value` is null.
- A8: The numeric budgets of NFR-06 (10 KB per logo) and NFR-02 to NFR-03 are carried or proposed
  by this PRD and can be adjusted.

## Dependencies

- FEAT-004 design system, shell and home, merged on `main` (PRs #21 to #23): this ticket replaces
  its visual layer and its navigation layout.
- Identity, accounts, movements and investments modules on `main` (PRDs 01, 02, 03 and 07) and their
  existing web client code; this ticket calls no new endpoint.
- `AGENTS.md` conventions: container/presentational split, theme tokens only, no hardcoded strings,
  Server Components never touch financial data, external services behind adapters.
- Tailwind CSS 4, shadcn/ui source in `components/ui/`, lucide-react, next-intl and `next/font`.
- The content security policy in `apps/web/src/lib/content-security-policy.ts`, which must keep
  `img-src` limited to the app's own origin.

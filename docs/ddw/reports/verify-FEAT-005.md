# Verification FEAT-005

| Field | Value |
|---|---|
| Module | `apps/web` — design tokens, `components/ui/`, shell, `lib/logos`, home, movements, accounts, categories, investments, auth, profile, security and the reference page |
| Line coverage | 98.96% |
| Branch coverage | 95.41% |
| Function coverage | 98.03% |
| Coverage floor | 80% (AGENTS.md, "Testing") |
| Lint | `pnpm exec eslint .` clean, `pnpm exec prettier --check --end-of-line auto .` clean, `pnpm typecheck` clean |

The three coverage numbers above are measured over the 54 source files this feature added or
changed under `apps/web/src`, from the V8 summary of the full run recorded in
`docs/ddw/reports/tests-FEAT-005.md`. Repository-wide the same run measured 97.32% of lines, 93.05%
of branches and 95.09% of functions. The pure logic is at or above 90% in every file:
`apps/web/src/lib/logos/resolve-merchant.ts`, `resolve-asset.ts` and `normalize.ts` at 100% each,
`apps/web/src/features/investments/composition.ts` at 100% of lines and 90.9% of branches, and
`apps/web/src/features/movements/initial-type.ts` at 100%. Two presentational files sit below 90%
of lines or functions: the reference page demo (`design-system-showcase.tsx`, 76.92% of functions,
its demo handlers) and `card.tsx` (an unused footer part). Neither holds business logic.

These numbers are my account of runs I did; the validator checks that they are stated and clear the
floor, not that the suite ran.

## Acceptance criteria

- ✅ AC-01 — `apps/web/src/app/globals.css` (`:root` and `.dark`, navy `--primary`); `apps/web/test/design-tokens-contrast.test.ts` ("defines --%s in light and in dark", "declares every semantic token in both themes", "anchors the palette: navy at hue 265")
- ✅ AC-02 — `apps/web/src/components/ui/amount.tsx`; `apps/web/test/ui-components.test.tsx` ("shows a plus sign for income and a minus sign for expense, not colour alone")
- ✅ AC-03 — `apps/web/src/app/[locale]/layout.tsx` (`Plus_Jakarta_Sans`); `apps/web/test/locale-layout.test.tsx` ("loads Plus Jakarta Sans through next/font with swap and emits no third-party font URL") and `apps/web/test/design-tokens-contrast.test.ts` ("points the font stack at the Plus Jakarta Sans variable and no longer at Inter")
- ✅ AC-04 — `apps/web/src/components/ui/amount.tsx`; `apps/web/test/ui-components.test.tsx` ("applies tabular numerals")
- ✅ AC-05 — `apps/web/src/app/globals.css` (`--radius-card`, `--radius-pill`, `--spacing-circle-action`); `apps/web/test/design-tokens-contrast.test.ts` ("defines the type, radius, elevation, motion and font tokens") and `apps/web/test/design-system-scan.test.ts`
- ✅ AC-06 — `apps/web/src/components/ui/avatar.tsx`, `pill-tabs.tsx`, `chip.tsx`, `circular-action.tsx`, `donut-chart.tsx`; `apps/web/test/ui-primitives.test.tsx` (every component renders from tokens with its accessible name)
- ✅ AC-07 — `apps/web/src/features/shell/components/bottom-nav.tsx`; `apps/web/test/shell-navigation.test.tsx` ("has four destinations around the add action, in this order, with Investments and no Accounts") and the e2e case "at 360 px the floating bottom bar is visible, inset from the edges"
- ✅ AC-08 — `apps/web/src/features/shell/components/bottom-nav.tsx` (the add link to `/movements/new`); `apps/web/test/shell-navigation.test.tsx` ("keeps a persistent add-movement action with its own accessible name")
- ✅ AC-09 — `apps/web/src/features/shell/nav-items.ts` (`isActiveInBottomNav`, `isActivePath`); `apps/web/test/shell-navigation.test.tsx` ("current destination" table, one link per navigation) and `apps/web/test/authenticated-shell-container.test.tsx`
- ✅ AC-10 — `apps/web/src/features/shell/components/authenticated-shell.tsx` (`pb-28 md:pb-0`); `apps/web/test/shell-navigation.test.tsx` ("keeps the bottom bar out of the content and reserves room for it below md only") and the e2e case "the last element of the page stays above the bar when scrolled to the end"
- ✅ AC-11 — `apps/web/src/features/shell/components/top-nav.tsx`; `apps/web/test/shell-navigation.test.tsx` ("TopNav": the destinations as pills, the add action, the theme toggle, sign out) and the e2e case "at 1280 px the top navigation card is visible and the bottom bar is hidden"
- ✅ AC-12 — `apps/web/src/features/shell/components/authenticated-shell.tsx` (renders `TopNav`, no `side-nav.tsx`); `apps/web/test/shell-navigation.test.tsx` ("renders no side navigation and the side navigation source is gone")
- ✅ AC-13 — `apps/web/src/features/home/components/home-screen.tsx`, `balance-summary.tsx`, `quick-actions.tsx`, `home-accounts.tsx`, `recent-movements.tsx`; `apps/web/test/home-components.test.tsx` ("composes balance, quick actions, accounts and movements") and `apps/web/test/home-container.test.tsx` ("shows the accounts section with the active accounts and the quick actions, with no extra request")
- ✅ AC-14 — `apps/web/src/features/home/components/quick-actions.tsx`, `apps/web/src/features/movements/initial-type.ts`, `apps/web/src/app/[locale]/(app)/movements/new/page.tsx`; `apps/web/test/home-components.test.tsx` ("each linking to the new-movement screen with its type"), `apps/web/test/initial-type.test.ts`, `apps/web/test/movements-containers.test.tsx` ("starts the form on the type it receives") and `apps/web/test/routes.test.tsx` ("passes %s from the URL to the screen")
- ✅ AC-15 — `apps/web/src/features/home/containers/home-container.tsx` (`HomeEmptyAccounts`); `apps/web/test/home-container.test.tsx` ("shows an empty state with a create-account action when there are no accounts")
- ✅ AC-16 — `apps/web/src/features/home/containers/home-container.tsx`; `apps/web/test/home-container.test.tsx` (the unsuccessful accounts request and the unsuccessful movements request each show the retry state with no balance figure, and the retry recovers)
- ✅ AC-17 — `apps/web/src/lib/logos/merchant-catalog.ts`, `asset-catalog.ts`, `apps/web/public/logos/`; `apps/web/test/logos-catalog.test.ts` ("merchant catalog" and "asset catalog": name, keyword and existing file for every entry)
- ✅ AC-18 — `apps/web/src/lib/logos/resolve-merchant.ts`, `normalize.ts`; `apps/web/test/logos-resolve.test.ts` ("matches a keyword inside a note regardless of case and accents", whole-word sad path "a keyword embedded in a longer word is not a match")
- ✅ AC-19 — `apps/web/src/lib/logos/resolve-merchant.ts` (`isBetter`); `apps/web/test/logos-resolve.test.ts` ("prefers the entry whose matching keyword is longest", "lets the first listed entry win when the keyword lengths tie")
- ✅ AC-20 — `apps/web/src/lib/logos/resolve-merchant.ts`; `apps/web/test/logos-resolve.test.ts` (a null, empty or whitespace-only note resolves no entry; a note with no keyword resolves no entry and never throws on odd text)
- ✅ AC-21 — `apps/web/src/features/movements/components/movement-avatar.tsx`; `apps/web/test/movement-avatar.test.tsx`, `apps/web/test/home-components.test.tsx` ("RecentMovements logos") and `apps/web/test/movements-components.test.tsx` ("shows the logo of the merchant an expense note names")
- ✅ AC-22 — `apps/web/src/features/movements/components/movement-avatar.tsx`; the same three files ("keeps the category icon when the note names no merchant, or there is no note")
- ✅ AC-23 — `apps/web/src/features/movements/components/movement-avatar.tsx`; the same three files (a transfer or an exchange shows its type icon and never a logo, even when its note names a merchant)
- ✅ AC-24 — `apps/web/src/features/investments/components/asset-avatar.tsx`, `apps/web/src/lib/logos/resolve-asset.ts`; `apps/web/test/logos-resolve.test.ts` ("resolves a ticker regardless of case and surrounding spaces") and `apps/web/test/holding-row.test.tsx` ("shows the catalog logo of the ticker as its leading avatar")
- ✅ AC-25 — `apps/web/src/features/investments/components/asset-avatar.tsx`; `apps/web/test/holding-row.test.tsx` ("a ticker with no logo shows an avatar with its first two characters") and `apps/web/test/logos-resolve.test.ts` (an unknown ticker resolves no entry)
- ✅ AC-26 — `apps/web/src/lib/content-security-policy.ts` (`img-src 'self' blob: data:`), `apps/web/next.config.ts` (`/logos/:path*` policy); `apps/web/test/content-security-policy.test.ts` ("serves images only from the app itself"), `apps/web/test/logos-headers.test.ts` and `apps/web/test/logos-catalog.test.ts` ("logo files": paths stay inside `/logos/`)
- ✅ AC-27 — `apps/web/src/components/ui/avatar.tsx` (fixed `size-*` circle, explicit width and height); `apps/web/test/ui-primitives.test.tsx` ("renders the logo with an empty alt, explicit size and lazy loading", "reserves its box through a fixed-size circle")
- ✅ AC-28 — `apps/web/src/components/ui/avatar.tsx` (`failedSrc`); `apps/web/test/ui-primitives.test.tsx` (an image that fails to load is replaced by the fallback and leaves no image; a new src is tried again) and `apps/web/test/movement-avatar.test.tsx`
- ✅ AC-29 — `apps/web/src/components/ui/avatar.tsx` (`alt=""`); `apps/web/test/ui-primitives.test.tsx` ("renders the logo with an empty alt")
- ✅ AC-30 — `apps/web/src/features/investments/composition.ts`, `components/portfolio-card.tsx`; `apps/web/test/composition.test.ts` and `apps/web/test/portfolio-card.test.tsx` ("shows a donut of the priced holdings by instrument type with a legend of name and percentage")
- ✅ AC-31 — `apps/web/src/features/investments/composition.ts` (grouped per valuation currency); `apps/web/test/composition.test.ts` ("keeps each valuation currency apart") and `apps/web/test/portfolio-card.test.tsx` ("draws one donut per valuation currency and never adds currencies together")
- ✅ AC-32 — `apps/web/src/features/investments/components/portfolio-card.tsx`; `apps/web/test/portfolio-card.test.tsx` ("with no priced holding there is no donut and the notice about missing prices stays")
- ✅ AC-33 — `apps/web/src/features/investments/components/holding-row.tsx` (`data-gain` arrows plus the signed text); `apps/web/test/holding-row.test.tsx` ("marks a gain with an up arrow and a plus sign", "marks a loss with a down arrow and a minus sign")
- ✅ AC-34 — the restyled screens keep their behavior: `apps/web/test/accounts-components.test.tsx`, `accounts-containers.test.tsx`, `categories-components.test.tsx`, `categories-containers.test.tsx`, `auth-screens.test.tsx`, `auth-components.test.tsx`, `profile-components.test.tsx`, `two-factor-components.test.tsx`, `delete-user-components.test.tsx`, `movements-components.test.tsx` and `movements-containers.test.tsx` all pass unchanged in behavior, plus the shape tests of Blocks 3, 8, 10 and 11, and the token scan `apps/web/test/design-system-scan.test.ts`
- ✅ AC-35 — `apps/web/src/features/home/components/home-screen.tsx` (`HomeSkeleton`), the load-state views of accounts, categories, profile and investments; `apps/web/test/home-components.test.tsx`, `accounts-components.test.tsx`, `categories-components.test.tsx`, `profile-components.test.tsx` and `investments-screen.test.tsx` (skeletons keep the card radius and the container), and the e2e case "the home shows its skeleton while the data is still loading"
- ✅ AC-36 — `apps/web/src/components/ui/empty-state.tsx` and its retry-state sibling in the same folder; `apps/web/test/ui-components.test.tsx` (an empty state keeps its call to action and the unsuccessful-request state keeps its retry action) and the load-state tests of each screen
- ✅ AC-37 — `apps/web/src/app/[locale]/design-system/design-system-showcase.tsx`; `apps/web/test/design-system-page.test.tsx` ("new tokens and components": `--hero-from`, `--hero-to`, `--logo-surface`, `--chart-1` to `--chart-5`, and the six new components in both previews)
- ✅ AC-38 — `apps/web/src/app/[locale]/design-system/page.tsx`; `apps/web/test/design-system-page.test.tsx` ("answers 404" in production)
- ✅ AC-39 — `apps/web/messages/en.json`, `apps/web/messages/es.json`; `apps/web/test/i18n-catalogs.test.ts` ("has every es key in en", "has every en key in es")
- ✅ AC-40 — `apps/web/src/app/globals.css` (focus safety net), the `focus-visible:ring-*` classes of every new control; `apps/web/test/ui-primitives.test.tsx`, `apps/web/test/shell-navigation.test.tsx` and the e2e case "keyboard tabbing across the shell and the quick actions shows a focus indicator on every stop"
- ✅ AC-41 — `apps/web/src/app/globals.css` (`prefers-reduced-motion` rule) and `motion-reduce:transition-none` on the new transitions; `apps/web/test/design-tokens-contrast.test.ts` ("has a prefers-reduced-motion rule that shortens animations and transitions") and the e2e case "with reduced motion no element keeps a transition or an animation of any length"

## Spec blocks

- ✅ Block 1 — tokens and typeface (`100f585`); every task done, tests in `design-tokens-contrast.test.ts` and `locale-layout.test.tsx`
- ✅ Block 2 — avatar, pill tabs, chip, circular action, donut chart (`16d0934`); every task done, tests in `ui-primitives.test.tsx`
- ✅ Block 3 — restyled existing primitives (`02e3423`); every task done; the primitives that carry no radius (`money-input.tsx`, `form.tsx`, `label.tsx`, `icon-action.tsx`, `amount.tsx`, `page-header.tsx`, `checkbox.tsx`) needed no change and are covered by their existing tests
- ✅ Block 4 — floating bottom bar and top navigation (`1bedb42`, and `0b66536` which made the top navigation static); every task done, layout tests rewritten as the spec allowed, e2e viewport cases pass
- ✅ Block 5 — logo catalogs, resolvers, 62 logo files and the `/logos/:path*` policy header (`839cbf1`, `dc960be`); every task done
- ✅ Block 6 — home with quick actions, accounts section and merchant logos (`c047c5c`); every task done
- ✅ Block 7 — movement rows with logos and the preselected type (`cc896c1`); every task done; `routes.test.tsx` was adapted to the asynchronous page
- ✅ Block 8 — accounts, categories and More (`90691c9`, More in `1bedb42`); every task done
- ✅ Block 9 — investments composition, asset logos and gain markers (`0089689`); every task done
- ✅ Block 10 — auth screens (`5fa04f7`); every task done, the auth screens already composed the restyled primitives
- ✅ Block 11 — profile, security and delete account (`5fa04f7`); every task done in the same commit as Block 10
- ✅ Block 12 — reference page, catalog parity, accessibility and layout-shift checks (`1f8eeb8`); every task done; the extra e2e cases live in `apps/web/e2e/design-system.spec.ts` instead of a new `layout-shift.spec.ts`, and the reference page shows the new tokens and components but not the two navigations, which the shell tests and the viewport e2e cases cover

## Tests

- ✅ Sad-path tests: every input and every documented failure has a sad-path test — the `type` query value (`initial-type.test.ts`, `routes.test.tsx`, `movements-containers.test.tsx`), the movement note and the ticker (`logos-resolve.test.ts`), logo files with active or external content and a missing policy header (`logos-catalog.test.ts`, `logos-headers.test.ts`), an image that cannot load and invalid donut weights (`ui-primitives.test.tsx`), invalid and missing holding values (`composition.test.ts`, `portfolio-card.test.tsx`), an unknown or undefined path in the navigation (`shell-navigation.test.tsx`), and the empty and failed states of home, accounts, categories, profile and investments. Invalid-input edge cases are covered, not only the happy path.
- ✅ Full suite: 5062 Vitest tests and 105 Playwright tests, as recorded in `docs/ddw/reports/tests-FEAT-005.md`.
- ✅ SAST: no open finding above Info, recorded in `docs/ddw/security/sast-FEAT-005.md`.

## Warnings that did not block

- ⚠️ W-VER-01 — the `compact` variant of `apps/web/src/components/theme-toggle.tsx` is no longer used by any screen since the side navigation was removed; only its own tests use it. `Chip` and `PillTabs` are used only by the reference page, because the PRD requires them in the library and no screen needs them yet.
- ⚠️ W-VER-03 — the e2e case that tabs through the home creates an account through the UI, so the later cases of that file run against a user that has one; the cases are independent in outcome and run on a fresh database each time.
- ⚠️ W-VER-02 — no business-logic file is between 80% and 90%.
- ⚠️ Terminology — the spec says "movement avatar" and "asset avatar" where the PRD says "logo avatar"; they are the same concept and the spec maps them.
- ⚠️ Catalog reach — Mercado Libre, Rappi, Cabify and PedidosYa have no logo in the CC0 icon set used, so their movements keep the category icon.

Result: PASSED

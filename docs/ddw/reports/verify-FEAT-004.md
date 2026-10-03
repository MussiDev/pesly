# Verification FEAT-004

| Field | Value |
|---|---|
| Module | `apps/web` (design system, app shell, auth, settings, accounts, movements, categories, investments and home screens); no API or shared package change |
| Line coverage | 99.47% |
| Branch coverage | 96.12% |
| Function coverage | 99.09% |
| Coverage floor | 80% lines, branches and functions (AGENTS.md, "Testing") |
| Lint | `pnpm exec eslint .` — clean, 0 findings; `pnpm typecheck` — clean; `pnpm exec prettier --check --end-of-line auto .` — clean |

## Scope and method

Verification ran on the tree of commit `e1e2415`, base `f889df9`, by an agent that did not write the
code (`ddw-module-verifier`), plus the orchestrator's own runs. Coverage above is computed over the 88
files added or modified under `apps/web/src` from `coverage/coverage-summary.json`; the whole
suite measured 97.36% lines, 93.02% branches and 95.18% functions over `apps/api/src`,
`apps/web/src` and `packages/shared/src` together (3906 tests, 0 failed, `tests-FEAT-004.md`). The
verifier re-ran the web project (79 files, 1655 tests, all passed), `pnpm typecheck` and ESLint. The
Playwright suite was run by the orchestrator, not re-run by the verifier: 90 of 90 before the shell
and typography fixes, and 89 of 90 after them, the 90th (`google.spec.ts:186`) being a timeout under
load that passed 3 of 3 in isolation. Only the lowest-coverage file of the new code is below 80% on
one metric: `apps/web/src/components/theme-provider.tsx` has 75% of branches (one branch, the
`useTheme` use outside the provider); the aggregate is far above the floor.

## Acceptance criteria

- ✅ AC-01 — `design-tokens-contrast.test.ts` "defines --%s in light and in dark" (`apps/web/src/app/globals.css`)
- ✅ AC-02 — `ui-components.test.tsx` "shows a plus sign for income and a minus sign for expense, not colour alone" (`apps/web/src/components/ui/amount.tsx`)
- ⚠️ AC-03 — `locale-layout.test.tsx` "loads Inter through next/font with swap and emits no third-party font URL" (`apps/web/src/app/[locale]/layout.tsx`); the test mocks `next/font`, so build-time self-hosting is not exercised
- ⚠️ AC-04 — `ui-components.test.tsx` "applies tabular numerals" (`amount.tsx`); a class-string check
- ✅ AC-05 — `design-system-scan.test.ts` "has no colour literal outside the Google logo and no arbitrary design value" over `src/features`, `src/app` and `src/components`
- ✅ AC-06 — `theme-provider.test.tsx` "applies the chosen theme immediately and persists it after remount" (`apps/web/src/components/theme-provider.tsx`) and the e2e "choosing light on /more removes the dark class and survives a reload"
- ✅ AC-07 — `theme.test.ts` "sets the dark class from the stored theme" (`apps/web/src/lib/theme.ts:21`), `locale-layout.test.tsx` nonce tests and the e2e pre-paint check
- ✅ AC-08 — `theme.test.ts` "follows the system preference without a stored theme"
- ⚠️ AC-09 — `ui-components.test.tsx` `it.each` per variant of Button, Alert and Badge; the variant tests check the focus ring or a slot, not every variant's tokens
- ⚠️ AC-10 — `design-system-page.test.tsx` "lists --%s in both themes" and "lists every component variant in the %s preview"; 18 of 40 colour tokens and no type, radius, elevation, spacing or motion section are asserted
- ✅ AC-11 — `design-system-page.test.tsx` "/design-system in production answers 404" (`apps/web/src/app/[locale]/design-system/page.tsx:7`)
- ⚠️ AC-12 — `shell-navigation.test.tsx` "BottomNav (AC-12) carries the md:hidden class contract" (`apps/web/src/features/shell/components/bottom-nav.tsx`) and the e2e "at 360 px the bottom navigation is visible and the side navigation is hidden"; a class contract backed by real visibility in Playwright
- ⚠️ AC-13 — `shell-navigation.test.tsx` "SideNav (AC-13) carries the hidden md:flex class contract" (`side-nav.tsx`) and the e2e at 1280 px; same caveat
- ✅ AC-14 — `shell-navigation.test.tsx` "current destination (AC-14)" over 10 paths, exactly one `aria-current` per navigation (`apps/web/src/features/shell/nav-items.ts`)
- ✅ AC-15 — `auth-screens.test.tsx` "renders the wordmark above a Card inside main" for the seven pages and the rejected sign-in sad path (`apps/web/src/app/[locale]/(auth)/layout.tsx`)
- ⚠️ AC-16 — `settings-screens.test.tsx` "settings screens (AC-16)" and the profile, two-factor and delete-user component tests; new assertions are mostly class strings, behaviour is kept by the unchanged container tests
- ✅ AC-17 — `accounts-components.test.tsx`, `movements-components.test.tsx`, `categories-components.test.tsx` and `investments-screen.test.tsx` "built on the design system"
- ✅ AC-18 — `home-container.test.tsx` "shows the balance per currency and the five latest movements (AC-18)" and "shows the real name and currency of a movement on an archived account" (`apps/web/src/features/home/containers/home-container.tsx`)
- ✅ AC-19 — `home-container.test.tsx` "shows an empty state with a create-account action when there are no accounts (AC-19)"
- ✅ AC-20 — `home-container.test.tsx` a rejected accounts request and a rejected movements request each show the retry state, retry recovers and no stale balance is shown (AC-20)
- ✅ AC-21 — `home-container.test.tsx` "shows a skeleton from the first render and starts all six requests before any resolves" and the load-state tests of the four feature screens
- ✅ AC-22 — `ui-components.test.tsx` "EmptyState (AC-22)" and the empty-state tests of accounts, movements, categories and investments
- ⚠️ AC-23 — `ui-components.test.tsx` "every interactive primitive carries a focus-visible ring token" and the e2e "keyboard tabbing across the sign-in page shows a focus indicator on every stop"; the e2e covers the sign-in page only
- ⚠️ AC-24 — `design-tokens-contrast.test.ts` "has a prefers-reduced-motion rule that shortens animations and transitions"; it matches the CSS text, not behaviour
- ✅ AC-25 — `i18n-catalogs.test.ts` parity per namespace in both directions, the missing-key sad path and the ICU argument check

## Spec blocks

- ✅ Block 1 — foundation: tokens, type scale, theme provider and toggle, nine ui primitives, reference page, `ui` and `theme` catalogs; every listed test exists and passes (minor: `form-alert.tsx` and `auth-field.tsx` needed no edit because they inherit the new look from `Alert` and `Form`)
- ✅ Block 2 — app shell in `features/shell`: bottom and side navigation, `/more`, session guard with frame and skeleton, skip link; every listed test exists; departs from the spec text on the bottom bar destinations (deviation 5 below)
- ✅ Block 3 — public auth screens: wordmark, divider, 44px links; both listed tests exist
- ✅ Block 4 — profile, security and delete account; both listed tests exist; two containers were edited outside the spec's file list (deviation 3 below)
- ✅ Block 5 — accounts and movements: day grouping, `Amount` rows, skeleton, empty and error states; every listed test exists
- ✅ Block 6 — categories and investments: the `ring-[3px]` is gone, focus and selection cues are distinct; every listed test exists (`investments-screen.test.tsx` and `portfolio-card.test.tsx` stand in for the spec's `investments-components.test.tsx`, which never existed)
- ✅ Block 7 — the real home with six parallel requests; all eleven listed tests exist
- ✅ Block 8 — `design-system-scan.test.ts`, the parity and ICU checks in `i18n-catalogs.test.ts` and `e2e/design-system.spec.ts`; the scan, parity, planted-literal and missing-key tests exist

## Tests

- ✅ Sad-path tests: every input path of the module has at least one sad-path test — `parseTheme` with eight invalid values, a throwing `localStorage`, a missing nonce, the production gate of `/design-system`, the home with accounts, movements, categories, profile and archived-accounts failures, a 401 from any of the six requests, malformed amount strings, an unknown account, a retry in flight, sign-in failure with focus on the first invalid field, invalid account, movement, category and holding submissions, a rejected profile save, a failed session check, a failed sign-out and a key missing from one catalog
- ✅ Coverage of the new and modified code is 99.47% lines, 96.12% branches and 99.09% functions
- ✅ Lint, type checker and formatting are clean (see the table above)

## TDD evidence

The implementers reported, per block, the assertion that failed before each change, and each
`feat` commit contains tests and code together, so git cannot show test-first by itself; this
section is that record. Where a test passed before the change it is called a guard.

- Block 1 — `design-tokens-contrast.test.ts`: 64 failed first on missing tokens; `ui-components.test.tsx`: 35 of 42 failed against stubs; `design-system-page.test.tsx`: 27 of 27 against a stub; `locale-layout.test.tsx`: 5 of 6 new tests failed first; `theme.test.ts` and `theme-provider.test.tsx` failed on the unresolved module import. Guards: the no-nonce test, the proxy forwarding test (mutation-checked by removing the `x-nonce` line), the `THEME_SCRIPT` key test. Correction round: the checkbox size, `Amount` formatter, zero and direction label, and `ListRow` tests failed first on assertions.
- Block 2 — four container tests failed first on `aria-current` counts and the skeleton; `shell-navigation.test.tsx` failed first only on the unresolved import, so its evidence is 14 mutations, each applied, shown to fail the named assertion and restored (drop `md:hidden`, drop `hidden` or `md:flex`, prefix-match `isActivePath`, `aria-current` on the add link, children mounted while loading, sign-out error swallowed in three places, broken retry, missing failure state, a removed catalog key, no `sr-only` on the skip link, no `truncate`, More not current).
- Block 3 — layout and wordmark, 44px targets on six of eight screens and the divider failed first on assertions; the primary-action count, Google fills, token scan and both sad paths were guards.
- Block 4 — 14 of 15 new tests failed first; follow-up, six of eight container tests failed first and one that passed by accident was strengthened; the final four tests failed first.
- Block 5 — seven accounts and seven movements tests failed first; the invalid-form and USD-rate tests were guards; the label text and malformed-value tests failed first (`Cannot convert abc to a BigInt`); the day-grouping DST test is a characterization test.
- Block 6 — 11 of 17 failed first; the error-and-retry and invalid-submit tests were guards; the swatch, focus cue, live region, create-field focus and destructive button tests failed first.
- Block 7 — the two new files failed first on the unresolved import; the single `routes.test.tsx` assertion failed first; 17 mutations were each shown killed and restored; the later six-request, archived-account, secondary-401 and malformed-amount tests failed first.
- Block 8 — the scan failed 18 of 28 with `scanContent` short-circuited, the parity helper failed 4 sad paths under mutation, the focus-indicator evaluation was mutation-checked in a harness; the updated `categories`, `investments` and `home` assertions never went red.
- Found by the real browser rather than by tests, then fixed test-first: `ThemeToggle` radio groups sharing `name="theme"` (`expected 'theme' not to be 'theme'`), `cn()` dropping the type scale (40 of 41 new tests failed first), the include-in-available label text and the movement amount text in two e2e specs.

## Warnings

Each warning below was reported by the verification and did not block it.

- Tests that check class strings instead of behaviour: AC-04, AC-09, AC-12, AC-13, AC-16, AC-23, AC-24 and several `shell-navigation`, `profile-components` and `two-factor-components` assertions, mitigated by the Playwright run for AC-12, AC-13 and AC-23.
- The AC-10 reference page test asserts 18 of 40 colour tokens and none of the type, radius, elevation, spacing or motion sections.
- The AC-23 e2e covers the sign-in page only, not the shell, the home or the movements page.
- NFR-02 (44px targets) and NFR-03 (layout shift) are measured by Playwright against `next dev`, not a production build; NFR-06 (skeleton within 100 ms, data within 2 s at p75 on 4G) has only a structural test and no timing measurement.
- `apps/web/src/components/theme-provider.tsx` has 75% of branches (one uncovered branch, the `useTheme` call outside the provider).
- Dead code left on purpose: `apps/web/src/features/accounts/format-amount.ts` has no importer and 0% coverage; it was frozen during the ticket and no block could delete it.
- Duplication: `features/home/time-zone.ts` and `features/movements/components/movement-row.tsx` each format a day with a different fallback zone (UTC and Buenos Aires), and `PlainAmount` in `recent-movements.tsx` repeats the sign and tone logic of `Amount` to print a figure without a currency symbol.
- Fragile tests: `design-tokens-contrast.test.ts` has a trivially true `--font-sans` regex, `home-container.test.tsx` stubs `indexedDB` without restoring it and contains one Spanish literal, `auth-screens.test.tsx` mutates `window.history`.
- The movements e2e asserts the amount's `data-kind` and magnitude instead of the sign text, because the sign is a separate hidden glyph; the sign is covered at unit level.
- A Next.js warning "script tag while rendering React component" appears in development when the language is switched; the theme script already ran during server rendering.

## Deviations

- The `Amount` component uses `formatMoney` from `@pesly/shared`, not the one in `lib/format-amount.ts`; the spec text was amended for it.
- The home issues six requests instead of two; decided by the user, and the spec and the threat model were amended (`e5e586b`).
- Block 4 edited `profile-container.tsx` and `delete-user-container.tsx`, which are not in the spec's file list, so the profile, delete-account and security screens meet FR-12; the edits are render-only and covered by the container tests.
- Extra files not in the spec: `design-system-showcase.tsx`, `profile-load-state.tsx`, `sign-out-alert.tsx`, `use-sign-out.ts`, `shell-boundaries.test.ts`, `auth-screens.test.tsx`, `settings-screens.test.tsx` and `investments-screen.test.tsx`.
- The bottom navigation has four destinations plus the add button and Investments lives under More, which departs from the PRD assumption A2 and from the Block 2 and AC-12 test wording in the spec; the user chose it after seeing screenshots where five destinations plus the add button truncated their labels at 360px. Neither the PRD nor the spec was amended; the decision is recorded in commit `e5f35f2` and here.
- `ThemeToggle` gained a `size="compact"` variant and a per-instance radio group name, and `cn()` was configured with the custom type scale, spacing and motion tokens; both fixes came from real-browser checks.

Result: PASSED

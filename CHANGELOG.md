# Changelog

All notable changes to this project are documented in this file. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- DISC-001-01a Monorepo foundation: pnpm workspaces with `apps/web` (Next.js 16, next-intl es/en,
  Tailwind, shadcn/ui), `apps/api` (Express 5, hexagonal) and `packages/shared` (Zod schemas),
  PostgreSQL with Drizzle migrations, Vitest, Playwright, ESLint and CI.
- DISC-001-01a Email and password registration with Argon2id hashing, breached-password check
  (HIBP k-anonymity) and email verification through a transactional outbox with retries.
- DISC-001-01a Sign-in with short-lived access tokens and rotating refresh tokens in secure
  cookies, sign-out and sign-out from all devices, with per-account and per-IP attempt limits.
- DISC-001-01a Password reset by email that revokes every existing session.
- DISC-001-01a Access control: data scoped by owner or group membership, answering 404 for
  anything that is not the user's; unverified accounts blocked from data.
- DISC-001-01a Web authentication screens (register, verify, sign in, forgot and reset password)
  in Spanish and English, with time zone and language defaults from the device.
- DISC-001-01b Google sign-in through the OpenID Connect authorization code flow with PKCE, run by
  the API with single-use OAuth states bound to the browser; no Google script in the web app.
- DISC-001-01b Accounts created with Google start verified and without a password; a Google
  account links to an existing account only when Google is authoritative for the email (Gmail or
  Workspace), and an unverified password account with that email is taken over (password and
  sessions removed) to prevent account pre-hijacking.
- DISC-001-01b "Continue with Google" on the sign-in and register screens, in Spanish and English.
- FEAT-001 The Railway services are defined as Infrastructure as Code in `.railway/railway.ts`, a
  partial that owns only `argent-api`, `argent-worker`, `argent-web` and `argent-postgres`;
  secrets stay in Railway, and a test fails if one is given a value. `pnpm railway:plan` and
  `pnpm railway:apply` run Railway's CLI on Windows, Linux and macOS. The deprecated
  `railway.json` files are removed, and restart retries go from 10 to 5.
- DISC-001-01c Optional two-factor authentication with an authenticator app (TOTP, RFC 6238):
  enrollment from a new security settings screen with a QR code, 10 one-time recovery codes shown
  once and stored only as Argon2id hashes, and disabling with a code or a recovery code.
- DISC-001-01c A second step after any sign-in (password or Google) for users with 2FA, through a
  short-lived single-use challenge; failed codes count toward the sign-in limit and are also
  limited per user, so a known email cannot lock its owner out of the second step.
- DISC-001-01c Enabling or disabling 2FA ends every other session and emails the owner a notice.
- DISC-001-01d Profile screen and API (`GET` and `PATCH /profile`): display name, read-only email
  and 2FA status, plus editable default rate type, display currency, time zone (validated against
  the IANA database) and interface language; changing the language moves to the matching locale
  route. Migration `0007_profile_display_name` adds a nullable display name; existing accounts keep
  none until the user sets one.
- DISC-001-01d Shared integer-only amount formatter that follows the interface language (`1,557.30`
  in English, `1.557,30` in Spanish).
- DISC-001-02a Accounts: create, rename, archive, unarchive and delete accounts (cash, bank
  account, digital wallet, credit card, savings) in ARS or USD, with the currency and the type fixed
  at creation, unique names per user and 404 for anything that is not the user's. The list shows
  each balance and one total per currency, computed exactly, and screens in Spanish and English
  reach it from the home page. Migration `0006_accounts` adds the `accounts` table; the opening
  balance is optional, may be negative and is limited to 10^13 major units. Balances read their
  movements through a port, so they equal the opening balance until PRD 03 supplies movements, and
  an account that has movements cannot be deleted. Names refuse control, zero-width and
  bidirectional characters.
- DISC-001-02a Shared integer-only money helpers: exact sums, locale-aware formatting and parsing
  of amounts, and amounts that travel as decimal strings.
- FEAT-002 The product is named Pesly everywhere a user sees it: the web title and PWA name, the
  screens, the recovery codes file and every email, in Spanish and English. The workspace packages
  are `@pesly/*`, and Railway builds the services by path, so a package rename cannot break a
  deploy. No user is signed out: cookie names and token claims are unchanged.
- DISC-001-01e Display name at sign-up: the registration screen and `POST /auth/register` require a
  name (1 to 50 characters, no NUL character), stored on the new account and shown in the profile;
  registering an already registered email still answers exactly as before and never touches the
  existing account. A Google sign-up takes the name from the Google profile (`profile` scope; a
  missing or empty name gives none, a longer one is cut to 50 characters), and a Google sign-in that
  takes over an unverified password account replaces the name typed at registration; linking a
  verified account or signing in again never changes it. No migration.
- DISC-001-02b Categories: each user has expense and income categories with one level of
  subcategories, created with a name, icon and color, renamed, archived (a parent takes its
  subcategories with it), unarchived and deleted while unused. Names are unique per kind and parent
  regardless of case, and an untouched default also blocks its name in the other language.
- DISC-001-02b Default categories: 33 defaults (9 expense, 5 income, 19 subcategories) are created
  with every new account, including Google sign-up, in the same transaction, and by migration
  0009 for existing users; a deleted default is never recreated. Defaults show in the interface
  language until renamed, then keep the name the user gave.
- DISC-001-02b Categories screen in Spanish and English and the `categories` REST routes; the
  `categories` module keeps the identity module free of any dependency on it. Migration 0009
  adds two tables and a guard trigger; its rollback script is destructive. Deferred to PRD 03:
  showing and keeping categories on movements, and blocking deletion of a category in use by a
  movement.
- DISC-001-01f Account deletion: a signed-in user deletes the account and all its data from a new
  screen (`/settings/delete-account`) after re-authenticating: the password (plus a TOTP or recovery
  code when two-factor authentication is on), or, for an account created with Google and no password,
  a fresh Google sign-in that issues a single-use grant (5 minutes, bound to the session). Deletion
  ends every session, removes the pending emails of the user and cascades to every user-owned table;
  a guard test fails when a new table that references a user is not registered for erasure. New
  migration `0010_account_deletion` (OAuth state purpose and `deletion_grants`); `GET /profile` gains
  a required `deletionReauth`, so the API deploys first.
- FEAT-003 Available balance vs net worth: every account has an "include in available" setting
  (cash, bank account and digital wallet start included; savings and credit cards do not, and a
  credit card can never be included), changeable on active non-card accounts through
  `PUT /accounts/:id/include-in-available` (credit card: 400 naming the field; archived: 409
  `ACCOUNT_ARCHIVED`). The account list headline shows Available per currency prominently and Net
  worth (all active accounts, card debt included) smaller, and credit cards move to their own Debt
  section with a per-currency total; the list response replaces `totals` with `availableTotals`,
  `netWorthTotals`, `debtTotals` and `creditCardCount`. Migration 0011 backfills existing accounts
  by type default.
- DISC-001-03a Exchange rates, store and sync: the worker refreshes the buy and sell prices of the
  seven ARS/USD rate types (oficial, blue, MEP, CCL, mayorista, cripto, tarjeta) from dolarapi.com
  every 60 minutes and keeps the last stored set when the provider fails (a failed refresh is
  recorded and retried after 5 minutes); `GET /exchange-rates/latest` returns the stored rates to a
  verified user. Rates are integers scaled by 10,000 end to end and the API never calls the provider.
  New settings `RATE_PROVIDER` (`dolarapi` or `fake`) and `DOLARAPI_BASE_URL`, both with defaults
  and pinned in production. Migration `0012_exchange_rates`.
- DISC-001-07a Investments: each user has portfolios (one per broker or wallet) holding positions with
  a ticker, name, type (stock, CEDEAR, bond, mutual fund, fixed-term deposit, crypto, other),
  quantity, valuation currency (ARS or USD) and an optional total cost. Quantities are integers scaled
  by 10^8 and amounts integers in minor units; nothing uses floating point. Crypto must be valued in
  USD, and a ticker is unique per portfolio ignoring case: adding an existing ticker merges into it
  (quantities and costs are summed, the price is kept; a different currency is rejected).
- DISC-001-07a Manual valuation: a unit price is set by hand and stored with its source and time.
  Value, gain or loss (amount and percentage), totals per currency, holdings without a price (shown
  as "price needed" and left out of totals) and prices older than 7 days are computed on read.
  Changing a holding's currency clears its price and its total cost must be entered again.
- DISC-001-07a Investments screen in Spanish and English and the `investments` REST routes (every row
  is scoped to its owner and answers 404 otherwise). Migration 0013 adds the `portfolios` and
  `holdings` tables; its rollback script is destructive. Deferred to DISC-001-07b and 07c:
  automatic crypto prices, daily value snapshots and the Balanz CSV import.
- DISC-001-03b Expense and income: a user records expenses and income on their own accounts, each
  with a category of the matching kind, an amount in minor units, a date and time (stored as a UTC
  instant and shown in the user's time zone, a later time today is accepted, a later day is not),
  an optional note and the ARS-per-USD rate frozen on the movement with its source. The rate is
  prefilled from the latest stored sell price of the user's default rate type, can be replaced by a
  manual rate, is required when none has ever been stored, and the entry screen warns when the
  stored rate is older than 2 hours. A movement on an archived account or category is refused.
- DISC-001-03b Movements list, newest first, in pages of at most 100, with names, signed amounts and
  the date and time in the user's time zone; the frozen rate shows only on rows of USD accounts.
  Account balances and the Available and Net worth totals now include movements, and an account or
  category with movements can no longer be deleted (the real adapters replace the placeholders of
  DISC-001-02a and DISC-001-02b).
- DISC-001-03b Manual creation is limited to 60 movements per minute per user (429 with a
  `Retry-After` header, counters stored in the database); a future import will not count against
  it. Deleting a user erases their movements first, in the same transaction. Migration
  `0014_movements` adds the `movements` and `movement_rate_limits` tables; its rollback script is
  destructive. Known limitation: a create has no idempotency key, so a retry after a lost response
  can duplicate a movement (follow-up for the offline sync ticket of PRD 04).
- DISC-001-03c Transfers and currency exchange: a user moves money between two of their own accounts
  of the same currency (a transfer) or buys and sells USD between an ARS and a USD account (a
  currency exchange). Neither is an expense nor an income. An exchange stores its implied rate, the
  ARS amount over the USD amount scaled by 10,000 and rounded half-up, and one outside 0.0001 to
  10,000,000.0000 ARS per USD is refused. Balances and the Available and Net worth totals count
  the source and the destination side; an account that is only the destination of a movement can
  no longer be deleted.
- DISC-001-03c The entry screen has a four-way type switch with a destination account picker
  (filtered by currency), a second amount and a read-only implied-rate preview for exchanges, and
  the movements list shows transfers and exchanges with both accounts. The rules of
  DISC-001-03b apply to the new types: amounts up to 10^15 minor units, notes up to 500
  characters, archived accounts refused (409), and the same 60 creations per minute per user
  shared with expenses and income. Migration `0016_transfers_exchanges` stores a transfer or
  exchange as one row with a destination account and amount (category empty, rate only on
  exchanges); its rollback script is destructive for transfers and exchanges only (it deletes
  those rows, so balances change).
- FEAT-004 Design system: indigo on cool neutral tokens for light and dark (colors, type scale,
  spacing, radius, elevation, motion), the Inter typeface self-hosted through `next/font`, a theme
  choice (light, dark or system) that persists and is applied before first paint, and new `badge`,
  `skeleton`, `empty-state`, `error-state`, `page-header`, `list-row` and `amount` components. A
  reference page at `/design-system` lists every token and component and answers 404 in production.
- FEAT-004 Mobile-first app shell: a bottom navigation below 768px and a side navigation from
  768px, a persistent add-movement action, a More page (Investments, categories, profile, security,
  theme and sign out) and a skip link; the shell draws its frame with a skeleton while the session
  is checked, and children still mount only once the session is confirmed.
- FEAT-004 The home is real: the available total and net worth per currency from the API, the five
  latest movements with category, account and signed amount, and quick actions. It loads accounts
  and categories in both states, movements and the profile in one parallel batch, so a movement on
  an archived account keeps its real currency and dates use the user's time zone; it shows a
  skeleton, an empty state without accounts, and the shared error state with a single-flight retry.
  The balance is a gradient hero card with the cents dimmed, the quick actions are icon tiles, and
  from 1024px the home is a two-column dashboard (balance and actions beside the latest movements).
- FEAT-004 Tests that guard the design system: a scan that fails on color literals and arbitrary
  design values (the Google logo is the only exception), a catalog parity check over every
  namespace, key and ICU argument, and a Playwright spec for navigation by viewport, 44px targets,
  focus indicators, layout shift and theme persistence.
- DISC-001-07b Crypto prices: a background job in the worker asks CoinGecko once an hour for the USD
  price of every crypto ticker (the ticker is matched as a CoinGecko symbol, top-ranked coin per symbol)
  and keeps the price in whole cents read from the JSON text, never through a float; a provider fault,
  a missing symbol or a price under one cent keeps the previous price. Requests are limited to 100
  symbols, back off from 15 to 60 minutes after a fault and never exceed 1,000 provider calls a month.
  A price set by hand is never replaced by an automatic one.
- DISC-001-07b Market price warning: the market price of each crypto ticker is stored separately, and a
  crypto holding with a manual price shows a warning (Spanish and English) when the market price differs
  by more than 5% in either direction, saying "today it is worth X" for a price up to 24 hours old and
  "on <date> it was worth X" for an older one, with a button that switches the holding back to the
  automatic price (`POST /investments/holdings/:holdingId/automatic-price`).
- DISC-001-07b Daily portfolio snapshots: once a day, at the end of the day in each user's time zone,
  the total value of every portfolio per currency is stored for the dashboard; a total above the 64-bit
  limit skips that portfolio's snapshot for the day and is logged. Migration 0015 adds the
  `crypto_price_sync`, `crypto_price_usage`, `crypto_price_refresh_failures`, `crypto_market_prices` and
  `portfolio_value_snapshots` tables; its rollback script is destructive. The optional
  `COINGECKO_API_KEY` is a worker-only secret (the worker starts without it); deploy the API before the web
  app because the holding response gained four fields.
- DISC-001-03d Tags and filters: a movement can carry up to 10 free-form tags, entered when it is
  recorded; a tag keeps the spelling of its first use for the user, and repeated tags in one
  movement collapse into one. `GET /tags?prefix=` suggests the user's existing tags while typing.
- DISC-001-03d The movements list filters by account, category, type, tag and a from and to date;
  filters combine, and an account, category or tag that is not the user's answers an empty page
  instead of 404. After "Clear filters" or "Show all movements" the keyboard focus moves to the
  account select. Migration `0017_tags` adds the `tags` and `movement_tags` tables (a database
  cap of 10 tags per movement) and the indexes behind the filters; its rollback script drops
  every tag and tag link, and touches no movement.
- DISC-001-03e Edit and delete movements: `PUT /movements/:id` replaces any of the user's
  movements (an expense, an income, a transfer or an exchange) and `DELETE /movements/:id`
  removes one; account balances are summed from the movements, so both follow at once. An edit
  applies the same rules as a creation (no date after today, no amount of 0 or below), keeps the
  frozen rate unless the rate itself is edited, may keep an archived account or category the
  movement already uses, and cannot change the type of the movement. A movement that is not the
  user's answers 404 on both routes. No migration.
- DISC-001-03e An edit screen at `/movements/<id>/edit` (the entry form filled in, with the type
  locked) and, on every row of the movements list, an edit link and a delete button with an
  inline confirmation, in Spanish and English.
- DISC-001-03e The project `README.md`, with a status section that tells what is built from what
  is planned and the commands to run the project locally; a test checks that every script and
  path it names exists.
- DISC-001-04a Offline reference data on the device: a per-user IndexedDB keeps the active
  accounts, categories, tags, preferences, exchange rates and the 100 most recent movements,
  refreshed on every online visit; the entry form and the movement list open from it without a
  connection and make no request. `GET /tags/all` (paged, 100 at most) feeds the tags.
- DISC-001-04a A service worker (Serwist) caches the application shell, so the app starts offline
  after one online visit: build assets and same-origin pages only, never the API origin; the worker
  waits for the next start before taking over and drops the framework's offline prefetches.
- DISC-001-04a Persistent storage is requested after sign-in and the user is warned, in Spanish
  and English, when the browser denies it. The copy on the device is not wiped on sign-out yet;
  that comes with DISC-001-04d. No migration.

### Changed

- FEAT-004 Every screen uses the design system: the auth, profile, security, delete-account,
  accounts, movements, categories and investments screens, with a skeleton while loading, an empty
  state with a call to action and the shared error state with a retry. Movements are grouped by day
  in the user's time zone, and the shell, its session guard and sign-out moved from `features/auth`
  to `features/shell`.
- FEAT-004 On a 360px screen the bottom bar has Home, Accounts, the add button, Movements and More;
  Investments moved into More (it stays a direct link in the side navigation), because five
  destinations plus the add button truncated their labels. This departs from the PRD assumption
  that Investments is a primary destination.
- FEAT-004 `cn()` is configured with the custom type scale, spacing and motion tokens, so a text
  color no longer removes a size such as `text-caption`, and each theme toggle has its own radio
  group so two toggles in one document no longer uncheck each other.
- FEAT-004 Known limitations: the home resolves names and currencies from the first 100 accounts and
  categories of each list; the performance budget of NFR-06 (skeleton within 100 ms, data within
  2 s at p75 on 4G) has only a structural test; the 44px target and layout shift checks run against
  `next dev`; `features/accounts/format-amount.ts` is unused and can be deleted.

### Fixed

- FIX-001 A refresh that races a sign-out, sign-out-all or password reset is rejected without
  being logged as refresh token reuse or revoking the session family.
- FIX-001 A rate-limited sign-in answers 429 even when refunding its reserved attempts fails.
- FIX-002 Railway deployment: one config per service (API, email worker, web), the API bundled
  with esbuild to run on plain `node`, migrations as a pre-deploy step, the web listening on
  `PORT`, and every start command capping the V8 heap (320 MB API and web, 192 MB worker).
- FIX-003 The email worker validates only the seven settings it reads, so API-only settings (the
  JWT secret, the Google client) can no longer stop it and are no longer handed to it.
- FIX-004 Google sign-ins finishing at the same time for the same new account (a double click, two
  tabs) all sign in, instead of one of them showing "Google sign-in failed".
- FIX-005 The email worker and the web run with container limits on Railway (1 vCPU each; 512 MB
  and 1 GB), so a runaway can no longer grow to the plan maximum. The TOTP encryption key is
  declared as preserved in `.railway/railway.ts`, so applying the definition never deletes it.

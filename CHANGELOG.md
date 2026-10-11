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
- DISC-001-04b Movements can be saved without a connection: expenses, income, transfers and currency
  exchanges go to a durable queue in the per-user IndexedDB, with a UUID chosen on the device, and
  show in the movement list with a "Pending" badge, in Spanish and English. An expense or income
  saved offline freezes the rate on screen as a manual rate, and asks for one when the device has
  none stored.
- DISC-001-04b The queue is sent on its own when the app starts online, when the connection returns
  and when a save gets no answer: up to 4 requests at a time, one pass at a time across tabs, a
  retry after `Retry-After` when the limit is reached, and a movement the server refuses is kept in
  the queue instead of lost (it is shown by DISC-001-04c, so 04b ships with 04c).
- DISC-001-04b `POST /movements` accepts an optional `id`: the same user sending an id that exists
  gets the stored movement back (200) and no second row, an id of another user answers 404, and
  creations with an id have their own limit of 600 per minute. Migration 0018 adds the limit
  bucket to `movement_rate_limits`, with a rollback script.
- DISC-001-04c Movements can be edited and deleted without a connection: the change is applied on
  the device at once and queued, one record per movement, so later changes fold into it; online, a
  change that gets no answer falls back to the queue. The edit screen moved to
  `/movements/edit?id=`, so one cached page serves every movement offline; the old path still works.
- DISC-001-04c Every movement in the list shows its sync state (synced, pending or not synced), and
  the shell shows how many changes wait to be synced and how many did not sync, in Spanish and
  English. A change the server refuses shows the reason, including a movement deleted on another
  device, and can be edited and retried, retried as it is, or discarded.
- DISC-001-04c Queued edits are sent with `PUT` and deletions with `DELETE` (a deletion answered 404
  counts as done); the server keeps the change it receives last, and the device copy takes the
  server's answer. Network and server failures are retried with exponential backoff from 5 s,
  doubling, capped at 5 minutes. No API change, no migration.
- DISC-001-04d Signing out removes the user's data from the device: once the API ends the session,
  the whole per-user IndexedDB database (unsent changes, reference copy and recent movements) and
  the session pointer are deleted. A wipe interrupted half way is finished on the next start, and
  the app cannot reopen that user's data until they sign in again. Deleting the account wipes the
  device the same way, and other open tabs go to sign-in.
- DISC-001-04d Signing out with changes not yet synced shows how many will be lost and asks for
  confirmation, in Spanish and English; cancelling keeps everything. A sign out that fails (for
  example offline) keeps the session and the data.
- DISC-001-04d A session that expires keeps the unsent changes, and they are sent once the same
  user signs in again; another user signing in on the device never sends them. No API change, no
  migration, no new dependency.
- FEAT-005 Merchant logos: an income or expense whose note names a merchant of a bundled catalog
  (40 services and stores, matched by whole words ignoring case and accents, the longest keyword
  first) shows its logo; any other movement keeps its category icon, and a transfer or an exchange
  shows its type icon. The 62 logos are CC0 single-colour SVGs from Simple Icons 16.34.0 served from
  the app's own origin, with a sandboxing policy on `/logos/*`; source, license and colour of each
  are in `apps/web/public/logos/NOTICE.md`. Mercado Libre, Rappi, Cabify and PedidosYa have no logo
  in that set.
- FEAT-005 Asset logos and composition: a holding shows the logo of its ticker (32 tickers, US
  equities and crypto) or its first two letters, a gain or a loss carries an arrow as well as its
  sign, and each portfolio shows one donut per valuation currency by instrument type, in integer
  basis points that always sum to exactly 10000.
- FEAT-005 Home: four circular quick actions (expense, income, transfer, exchange) open the new
  movement screen already on that type through `?type=`, and an accounts section lists the first
  five accounts with their balance. The home still makes the same six requests.
- FEAT-005 New components in `components/ui/`: avatar with a logo fallback, pill tabs, chip,
  circular action and donut chart, shown with the new hero and chart tokens on the reference page.
- DISC-001-10a Credit cards: a card has a name (up to 46 characters) and a default closing day and
  due day (1 to 31). Creating it creates, in the same transaction, two linked credit card accounts,
  "<name> ARS" and "<name> USD"; a taken account name refuses the card. New `/credit-cards` API
  routes and a `/cards` screen with the list, a create form and a card page, in Spanish and English.
- DISC-001-10a Statement cycles: each card has one statement per month whose closing date falls on
  the default closing day and whose due date is the next occurrence of the due day, using the last
  day of the month when the day does not exist. Statements are created when they are read, a
  statement is closed once its closing date has ended in the user's time zone, the dates of an open
  statement can be edited, and changing the default days moves every open statement.
- DISC-001-10a Deleting a card deletes its statements and both linked accounts, and is refused while
  either account has movements; a linked account cannot be deleted on its own from the accounts
  screen (rename and archive still work). Erasing a user deletes their cards first. Migration 0019
  adds `credit_cards` and `credit_card_statements`, with a rollback script.
- DISC-001-10b Card expenses: `POST /credit-cards/:id/expenses` and an "Add expense" screen on the
  card page record an expense on a card in ARS or USD; the app picks the card's linked account of that
  currency, and the usual movement rules (date, category, frozen rate, write limit) apply.
- DISC-001-10b Statement assignment: a purchase belongs to the first statement whose closing date is on
  or after its day in the user's time zone, so moving the closing date of an open statement or the
  default days reassigns purchases without any stored link. Each statement shows its total per
  currency, the sum of the expenses on the card's two accounts. No migration.
- DISC-001-10c Installment purchases: `POST /credit-cards/:id/installment-purchases` and an "Add
  installments" screen record a purchase in ARS in 2 to 60 installments, split into equal parts with
  the leftover minor units on the first installment. The first installment goes to the statement of
  the purchase day and each following one to the next statement; a purchase in USD is refused. A
  purchase can be read, edited (category and note) and deleted; deleting it removes the installments
  of statements not closed yet and keeps the ones in closed statements. Migration 0020.
- DISC-001-10c Statement totals and pending debt: each statement lists its installments and its total
  per currency now adds them to the purchases, and the card page shows the pending debt, the
  installments in statements not yet closed.
- DISC-001-10c Installments by category and month: `GET /credit-cards/installment-expenses` returns each
  installment as an expense of the purchase's category in the due-date month of its statement, for
  budgets (PRD 06) and reports (PRD 09) to read when they are built.
- DISC-001-10d Statement payments: `POST /credit-cards/:id/payments` and a "Pay statement" screen move
  money from one of your accounts to the card's linked account of the same currency as a transfer, never
  an expense; a source in another currency is refused. It reuses the transfer rules and the movement
  write limit. No migration.
- DISC-001-10d Statement status: each closed statement shows, per currency, the amount paid and whether it
  is paid, partially paid or unpaid. The status is derived on read: the transfers received by the card
  account are allocated to the closed statements oldest first, so editing or deleting a payment moves
  the status. An installment purchase is still not a movement, so after paying a statement that
  includes installments the card's ARS account balance exceeds its purchases by the installments paid.
- FEAT-006 Edit an account's opening balance: `PATCH /accounts/:id/opening-balance` with
  `{ openingBalance }` changes the opening balance after creation, with the same limits as account
  creation, and answers the account with the recomputed balance. The balance moves by the difference;
  no movement or frozen rate is touched. Like rename, it works on archived and card-linked accounts, a
  missing or foreign account answers 404, and the audit line carries ids only. The account list gets
  an "Edit opening balance" action with the current value, an explanation and a preview of the new
  balance. No migration and no new dependency.

- DISC-001-08a Recurring payments: create, edit, pause, resume and delete payments that repeat
  weekly, monthly or yearly, with a name, amount, account, expense category, start and optional end
  date and an automatic or confirmation mode. Monthly days that a month lacks fall on its last day.
  A new "Recurring" screen lists overdue, pending and the next 30 days of occurrences; confirming
  a pending one records the expense (amount and date editable) and skipping it records nothing.
  Due dates follow the user's time zone. Migration `0023_recurring_payments` adds two tables;
  automatic recording, reminders and push notifications arrive in DISC-001-08b, 08c and 08d.

- DISC-001-08b Automatic recording of recurring payments: a job in the worker process wakes every
  60 seconds (`RECURRING_JOB_INTERVAL_SECONDS`, 1 to 300) and records the expense of each due
  occurrence of an automatic payment from 06:00 in the owner's time zone, dated at noon of the due
  date. The occurrence id is the movement id, so repeated, concurrent or interrupted runs record
  exactly one expense. Missed dates are recorded on the next run, up to a year back; a failure on
  one payment (archived account, missing rate) leaves it pending and never stops the others.
  Due dates before a payment was created, resumed or switched to automatic stay pending for the
  user. Migration `0024_recurring_auto_recording_from` adds `recurring_payments.auto_recording_from`.
  A pass over 10,000 payments with 1,000 due is benchmarked under 60 seconds. No new dependency.
- DISC-001-08c Reminders and in-app notices for recurring payments: each payment has reminder days
  (0 to 30, default 3) and the worker creates one reminder notice per occurrence at 09:00 in the
  owner's time zone, catching up on the next run until the due date and never before the day the
  payment was created or resumed. It also creates a notice when an automatic expense is recorded
  and one when it is left pending because it cannot be recorded. Notice text is written in the
  owner's language with the payment name and day, never an amount or an account name. A new
  notices screen with an unread count in the top bar, `GET /notices`, `POST /notices/:id/read` and
  `POST /notices/read-all`. Notices are unique per kind, payment and due date, so repeated or
  parallel runs create no duplicates. Migration `0025_notices` adds `recurring_payments.reminder_days`
  and the `notices` table. Push delivery of the same notices arrives in DISC-001-08d. No new
  dependency.
- DISC-001-07c Import of Balanz holdings from the Excel export (`.xlsx`, sheet "Mis Instrumentos"):
  the file is read in the browser and never uploaded, stored or logged, with a limit of 1 MB and
  10 MB declared uncompressed. A preview lists the holdings it will add, update and remove before
  anything changes, each holding starts in ARS and can be switched to USD, every instrument type is
  accepted (unknown ones as "other"), and the total cost is the file's "Valor inicial". Confirming
  replaces the portfolio's holdings in one transaction through
  `POST /investments/portfolios/:portfolioId/holdings/import` (at most 1,000 holdings, 384 kb body
  limit on that path only), with prices of source `import` dated by the file. A file that is not a valid
  Balanz workbook (CSV, PDF, another sheet, a bad row, a repeated ticker) is refused whole. No
  migration and no new dependency: it reuses `read-excel-file` from the statement import.
- DISC-001-05a Groups, members and roles: `POST /groups` creates a group with a name and a default rate
  type and makes its creator an admin, with the top-level expense categories of the default list. Any member
  can generate an invitation link (valid 7 days, one active per member), add a ghost member with only a name
  and generate a single-use claim link that a registered user redeems to take the ghost's place keeping its
  position; admins promote registered members, change the default rate type and add, rename and archive group
  categories. A group has at most 50 members, ghosts included. Tokens carry 256 bits, are stored only as
  SHA-256 hashes and travel in request bodies, never in URLs; unknown, expired and used tokens answer the
  same 400. A non-member gets 404 on every group route. Deleting an account turns the user's memberships into
  "Former member" ghosts. Migration `0026_groups` adds five tables. Expenses, balances, settlements and the
  group screens arrive in DISC-001-05b to 05d. No new dependency.
- DISC-001-05b Group expenses and splits: any member records an expense in ARS or USD with one payer
  (any member, ghosts included), a non-archived group category and a split equal, by percentages (stored as
  basis points) or by exact amounts. Shares always add up to the amount; the leftover minor units go one by
  one to the payer first and then in joining order. A percentage total off 100% or an exact total off the
  amount answers 400 with the total or the signed difference. When the caller is the payer, the full amount
  leaves one of their accounts in the expense currency in the same transaction, as an expense movement with
  the rate of the group's rate type; a ghost or another member as payer records no movement. Admins store a
  default split that `GET /groups/:id/expense-options` returns with the members and the current categories;
  `GET /groups/personal/shares` shows the caller's shares and, as payer, the receivable, which are neither
  movements nor income. Shares follow a claimed ghost because they point to the member, and each expense adds
  a creation entry to the group activity log. Non-members get 404 on every route. Migration
  `0027_group_expenses` adds four tables and `groups.default_split_mode`. Balances and settlements arrive in
  DISC-001-05c, editing and the log view in 05d, and the group screens in a later ticket. No new dependency.
- DISC-001-05c Group balances and settlements: `GET /groups/:id/balances` shows each member's balance in ARS
  and USD separately, derived from the expenses, shares and settlements (never stored), with a short list of
  simplified payments per currency (greedy, at most one payment fewer than the members with a balance, not
  provably minimal). Any member records a settlement between two active members in one currency; paying more
  than is owed reverses the debt. A party who is the caller may attach one of their accounts in that currency:
  its balance rises or drops by the amount, and the settlement is neither an expense nor an income (it creates
  no movement row). Two members can consolidate both currencies into one: the preview returns the debts and
  the stored rate of the group's default rate type, a manual rate replaces it, the cash is converted with
  half-up rounding, and a request whose debts moved since the preview answers 409. A member leaves
  (`POST /groups/:id/leave`) or an admin removes one (`DELETE /groups/:id/members/:memberId`) only at balance 0
  in both currencies, otherwise 409 with the balance; the last admin cannot leave while others remain. Leaving
  is soft: history stays, `GET /groups/:id` lists `formerMembers`, a person who left gets 404 like a
  non-member and can rejoin with a new member row. A claimed ghost keeps its settlements, a deleted account
  keeps them under "Former member", and each settlement adds a creation entry to the group activity log.
  Migration `0028_group_settlements` adds two tables and `group_members.left_at`. Editing and deleting
  settlements and the log view arrive in DISC-001-05d, the group screens in a later ticket. No new dependency.

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
- FEAT-005 Visual redesign of every screen: a deep navy accent on a cool-grey canvas with white
  cards of 24px radius, pill buttons and a navy balance card, in light and in dark (navy-black),
  set in Plus Jakarta Sans instead of Inter. No API, schema or dependency changed.
- FEAT-005 Navigation: below 768px a floating pill bar with Home, Movements, a central circular add
  button, Investments and More (Accounts moved into More); from 768px a top navigation card replaces
  the side navigation. This reverses the FEAT-004 order of the bottom bar. The page keeps clear of
  the bar at the end of its content.
- FEAT-005 The category icon is now a 40px circle so it matches the logos.
- FEAT-005 Known limitations: the concept elements that need data no API returns (month-over-month
  variation, balance history, monthly flow bars) are not drawn and belong to PRD 10; the top
  navigation scrolls away with the page on purpose, because a sticky one covered scrolled-to
  controls; a merchant is recognized only from the note, with no per-movement override.

### Fixed

- Security: `next` is raised to 16.3.8 (GHSA-cjq9-62q9-8jv4, a server-side request forgery in the
  image optimizer), which clears the high advisory of `pnpm audit --prod --audit-level high`.
- Security: `source-map-js` is overridden to 1.2.2 or later (GHSA-68fv-2mgg-jv7q, an event-loop
  denial of service reached through `next` and `postcss`), which clears the high advisory that
  failed the lint job of every pull request.
- Security: `sharp` is overridden to 0.35.5 or later (GHSA-wq5f-xc86-pv6w, CVE-2026-96889, a
  vulnerability in its librsvg dependency, reached through `next`), which clears the high advisory
  reported by `pnpm audit --prod --audit-level high`.
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

# Pesly

> Personal and shared finance, designed for Argentina.

Pesly is a **mobile-first, offline-first personal finance platform** focused on the realities of managing money in Argentina.

It allows users to manage accounts, expenses, income, transfers, foreign currencies, exchange rates, investments, credit cards, budgets, savings goals and shared finances — while keeping financial calculations deterministic and historical data consistent.

The project is designed around a simple principle:

> **The financial domain comes first. Technology exists to serve the domain.**

---

## 📍 Status

Pesly is under active development. This README describes the product the project is building; this section says what exists today. The list is kept honest by the PRDs in `docs/ddw/prd/` and by the CHANGELOG.

### Built

- Identity: email/password sign-in, Google sign-in, two-factor authentication, profile and account deletion
- Accounts and categories
- Movements: expenses, income, transfers, currency exchanges, tags, filters, and editing and deleting them
- Exchange rates with frozen rates per movement
- Investments: portfolios, holdings, crypto prices and daily snapshots
- Spanish and English interface, design system, light and dark themes

### Planned

- Credit cards: statements and installments
- Shared finances: groups and households
- Budgets and savings goals
- Recurring payments
- Dashboard and reports
- Offline-first synchronization (local persistence, sync queue) and push notifications

---

## ✨ Features

### Personal finance

- Multiple financial accounts
- Cash, bank accounts and digital wallets
- ARS and USD
- Expenses and income
- Edit and delete movements
- Transfers between accounts
- Currency exchanges
- Historical exchange rates
- Frozen exchange rates per transaction
- Categories
- Budgets
- Savings goals
- Recurring payments
- Financial reports

### Credit cards

- Credit card accounts
- Statements
- Installments
- Purchase tracking
- Payment tracking

### Investments

- Investment accounts
- Holdings
- Quantities with high precision
- Historical valuations
- Investment transactions

### Shared finances

- Groups
- Shared movements
- Group members
- Shared expenses
- Ownership and authorization boundaries

### Offline-first

Pesly is designed to remain useful when the network is unavailable.

```text
User action
    ↓
Local persistence
    ↓
UI updates immediately
    ↓
Sync queue
    ↓
Network available
    ↓
API
    ↓
Server persistence
```

The goal is not simply to detect that the user is offline.

The goal is to let the user **continue using the application**.

### Authentication & security

- Email/password authentication
- Google OAuth
- Two-factor authentication
- Password hashing with Argon2
- JWT-based authentication
- Secure cookies
- HTTPS enforcement
- Origin validation
- Security headers
- CSP
- Request IDs
- Ownership and membership scoping
- Protection against resource enumeration

### Internationalization

- Spanish
- English
- Locale-aware routing
- Domain-independent translation system

---

# 🏗️ Architecture

Pesly is structured as a **monorepo** containing independent applications and shared contracts.

```text
pesly/
│
├── apps/
│   ├── web/                 # Next.js frontend
│   └── api/                 # Express REST API
│
├── packages/
│   └── shared/              # Shared contracts and domain utilities
│
├── docs/
│   └── ddw/                 # Discovery, PRDs, specs and security docs
│
├── scripts/
│
└── package.json
```

At a high level:

```text
                         ┌──────────────────┐
                         │      Browser     │
                         │   Next.js / PWA  │
                         └────────┬─────────┘
                                  │
                                  │ HTTP / JSON
                                  ▼
                         ┌──────────────────┐
                         │     Express      │
                         │       API        │
                         └────────┬─────────┘
                                  │
                                  ▼
                         ┌──────────────────┐
                         │   Application    │
                         │     Use Cases    │
                         └────────┬─────────┘
                                  │
                                  ▼
                         ┌──────────────────┐
                         │      Domain      │
                         │  Business Rules  │
                         └────────┬─────────┘
                                  │
                                Ports
                                  │
                                  ▼
                         ┌──────────────────┐
                         │ Infrastructure   │
                         │ Drizzle / DB     │
                         └────────┬─────────┘
                                  │
                                  ▼
                         ┌──────────────────┐
                         │   PostgreSQL     │
                         └──────────────────┘
```

---

# 📦 Monorepo

Pesly uses **pnpm workspaces**.

The repository is intentionally divided into applications and packages rather than keeping everything inside one Next.js application.

## `apps/web`

The web application.

Responsibilities include:

- UI
- routing
- layouts
- localization
- PWA behavior
- client-side state
- local/offline persistence
- communication with the API

The web application does **not** own the financial domain.

Financial data is accessed through the Express API.

---

## `apps/api`

The backend application.

Responsibilities include:

- authentication
- authorization
- financial business operations
- validation
- persistence
- integrations
- synchronization
- security
- HTTP API

The API is intentionally independent from Next.js.

This allows the same backend to eventually serve other clients such as:

```text
Next.js
Mobile application
Desktop application
CLI
Other clients
```

---

## `packages/shared`

Shared code used by both web and API.

It contains things that genuinely belong to both sides, such as:

- Zod schemas
- shared contracts
- money utilities
- date/time utilities
- currency definitions
- shared domain concepts
- API input/output contracts

The package intentionally remains independent of:

- React
- Next.js
- Express
- Drizzle
- PostgreSQL

This prevents the shared layer from becoming a dumping ground for application-specific code.

---

# 🧱 Backend Architecture

The backend follows a **modular Hexagonal Architecture / Ports and Adapters** approach.

Each business area is organized around the domain rather than around technical layers.

Example:

```text
accounts/
│
├── domain/
│   ├── account.ts
│   └── errors.ts
│
├── application/
│   ├── create-account.ts
│   ├── get-account.ts
│   ├── list-accounts.ts
│   ├── rename-account.ts
│   └── ports/
│
└── infrastructure/
    ├── db/
    ├── http/
    └── integrations/
```

The same pattern is applied to other business areas such as:

```text
identity
accounts
categories
movements
exchange-rates
investments
groups
budgets
goals
recurring
credit-cards
reports
sync
```

---

## Domain

The domain represents financial concepts and business rules.

The domain should not know about:

- HTTP
- Express
- PostgreSQL
- Drizzle
- cookies
- external APIs

For example, an account is a **financial concept**, not simply a PostgreSQL row.

This separation keeps business rules independent from infrastructure.

---

## Application

The application layer contains **use cases**.

Examples:

```text
CreateAccount
RenameAccount
DeleteAccount
CreateMovement
UpdateMovement
DeleteMovement
TransferMoney
ExchangeCurrency
CreateInvestment
```

Each use case represents a meaningful business operation.

This is preferred over large generic services such as:

```text
AccountService
FinanceService
ApplicationService
```

with hundreds of unrelated methods.

---

## Ports

Ports define what the application needs from the outside world.

For example:

```text
AccountRepository
ExchangeRateProvider
EmailProvider
NotificationProvider
```

The application depends on these abstractions rather than concrete technologies.

```text
Application
     │
     ▼
   Port
     ▲
     │
Adapter / Infrastructure
```

---

## Infrastructure

Infrastructure implements the ports.

Examples:

```text
PostgreSQL
Drizzle
Express
Google OAuth
Resend
CoinGecko
Exchange-rate providers
Web Push
```

Replacing an external provider should therefore not require changing the financial domain.

---

# 💰 Financial Domain

Financial calculations are treated differently from ordinary application data.

## Money is never represented as floating point

Monetary values are represented using integer minor units.

For example:

```text
ARS 10.50
```

becomes:

```text
1050
```

This avoids floating-point precision problems.

Instead of relying on:

```text
0.1 + 0.2
```

the system operates on deterministic integer values.

For example:

```text
1050 + 2025 = 3075
```

which represents:

```text
ARS 30.75
```

---

## Exchange rates

Exchange rates are also stored using integer scaling rather than floating-point values.

This keeps currency calculations deterministic.

---

## Frozen exchange rates

A financial movement stores the exchange rate used when the movement occurred.

For example:

```text
10 USD
Rate at transaction time: 1500 ARS
```

The resulting historical value does not change simply because today's exchange rate becomes:

```text
1600 ARS
```

Historical transactions therefore remain historically accurate.

Editing a movement keeps its frozen rate unless the user changes the rate on purpose.

---

## Currency exchange is not an expense

Buying USD with ARS is modeled as a currency exchange rather than as an expense.

Conceptually:

```text
ARS account
    │
    │ -150,000 ARS
    ▼
Currency exchange
    │
    │ +100 USD
    ▼
USD account
```

The operation changes the composition of the user's assets rather than representing consumption.

This distinction is important for accurate financial reporting.

---

# 🌐 API

The API is a stateless REST service.

```text
HTTP Request
     ↓
Security middleware
     ↓
Request context
     ↓
Validation
     ↓
Route
     ↓
Application use case
     ↓
Domain
     ↓
Infrastructure
     ↓
Database
```

The API does not depend on in-memory session state.

This makes it possible to run multiple API instances behind a load balancer without requiring requests to reach a specific server.

```text
                Load Balancer
                /     |     \
               /      |      \
            API-1   API-2   API-3
               \      |      /
                \     |     /
                 PostgreSQL
```

---

# 🔐 Security

Security is treated as a system-wide concern rather than something added to individual endpoints.

The API includes protections such as:

- secure authentication
- Argon2 password hashing
- JWT validation
- secure cookies
- HTTPS enforcement
- CORS configuration
- origin validation
- Helmet/security headers
- CSP
- request IDs
- structured logging
- centralized error handling
- ownership checks
- membership checks
- resource enumeration protection

## Resource access

Financial resources are always scoped by ownership or membership.

A request such as:

```text
GET /accounts/:id
```

must not simply check whether the account exists.

It must also establish that the authenticated user is authorized to access it.

Unauthorized resources may return `404` rather than revealing their existence through `403`.

This reduces information leakage and protects against resource enumeration.

---

# 🗄️ Database

Pesly uses **PostgreSQL**.

PostgreSQL is a good fit for the domain because the application requires:

- relational data
- referential integrity
- transactions
- constraints
- consistent financial operations
- complex queries
- aggregation

Database access is handled through **Drizzle**.

Migrations are maintained explicitly and tracked in version control.

```text
apps/api/drizzle/
├── 0000_*.sql
├── 0001_*.sql
├── 0002_*.sql
└── ...
```

Database schema evolution is therefore part of the project's source code and history.

---

# 🎨 Design System

The UI is built using:

```text
Tailwind CSS
shadcn/ui
Radix UI
Lucide
CSS variables
OKLCH
Inter
```

The design system is intentionally source-owned.

shadcn/ui components live inside the project instead of being treated as an opaque external UI library.

This allows the product to control:

- visual identity
- accessibility
- behavior
- component APIs
- design evolution

---

## Design tokens

Visual decisions are centralized through semantic tokens.

Examples:

```text
--background
--foreground
--card
--primary
--secondary
--muted
--success
--warning
--destructive
--border
--ring
--radius
```

Components should consume semantic tokens rather than hardcoded colors.

Prefer:

```text
bg-primary
text-muted-foreground
border-border
```

over:

```text
bg-[#6842ff]
```

This keeps the visual language consistent across the application.

---

## Component hierarchy

The UI is separated into:

```text
UI primitives
      ↓
Feature components
      ↓
Pages
```

Generic components live under:

```text
components/ui
```

while business-specific components live inside their respective features.

For example:

```text
features/accounts/
```

owns account-specific UI.

This prevents the global components directory from becoming a collection of unrelated business components.

---

# 🧩 Frontend Architecture

The frontend is organized primarily by **features**.

```text
src/
├── app/
├── components/
├── features/
├── i18n/
└── lib/
```

Features include areas such as:

```text
accounts
auth
categories
home
investments
movements
profile
shell
two-factor
```

A feature can contain:

```text
components
containers
formatters
calculations
hooks
```

without spreading its implementation throughout the application.

---

# 📱 Offline-first

Offline support is a first-class architectural requirement.

The application uses local persistence and a synchronization queue.

Conceptually:

```text
                 ┌─────────────┐
                 │    User     │
                 └──────┬──────┘
                        │
                 ┌──────▼──────┐
                 │     UI      │
                 └──────┬──────┘
                        │
                 ┌──────▼──────┐
                 │  IndexedDB  │
                 └──────┬──────┘
                        │
                    Sync Queue
                        │
                  Network OK?
                    /       \
                  No         Yes
                  │           │
                  │           ▼
                  │          API
                  │           │
                  │           ▼
                  │       PostgreSQL
                  │
                  └── retry later
```

This allows the user to continue recording financial activity when connectivity is unavailable.

Synchronization and conflict resolution are handled explicitly rather than relying only on the browser's network status.

This part of the architecture is planned: see [Status](#-status) for what exists today.

---

# 🔄 External Integrations

External providers are isolated behind adapters.

Examples include:

```text
Google OAuth
Email provider
Exchange-rate providers
CoinGecko
Web Push
```

The application does not directly couple core financial operations to these services.

For example:

```text
Application
    ↓
ExchangeRateProvider
    ↓
DolarApiAdapter
```

rather than:

```text
Application
    ↓
fetch("https://external-provider...")
```

This allows providers to be replaced without changing business logic.

---

# 📨 Outbox & Background Processing

Operations that produce external side effects can use an outbox-based workflow.

Conceptually:

```text
Business transaction
       ↓
PostgreSQL transaction
       ↓
Outbox event
       ↓
Worker
       ↓
External provider
```

This prevents an external dependency from unnecessarily becoming part of the critical financial transaction.

For example, failure of an email provider should not make a successfully completed financial operation fail.

---

# 🧪 Testing

Pesly uses multiple testing layers.

## Unit tests

Used for:

- domain rules
- money calculations
- utilities
- validation
- deterministic business logic

## Integration tests

Used for:

- API behavior
- repositories
- database interactions
- authentication
- persistence

## End-to-end tests

Playwright is used for complete browser workflows.

```text
Browser
   ↓
Next.js
   ↓
API
   ↓
PostgreSQL
```

External services are replaced with controlled test implementations where necessary.

This allows scenarios such as authentication, email flows and offline synchronization to be tested without relying on production providers.

The commands are:

```bash
pnpm test
pnpm test:coverage
pnpm test:perf
pnpm e2e
```

The integration tests need PostgreSQL through `TEST_DATABASE_URL`, and the end-to-end tests need it through `E2E_DATABASE_URL`, plus Mailpit.

---

# 🌍 Internationalization

The application supports:

```text
/es
/en
```

using `next-intl`.

User-facing text is kept separate from business logic.

Domain concepts such as predefined categories are treated differently from UI strings because they are actual application data rather than presentation text.

---

# 📚 Documentation

Documentation is treated as part of the engineering process.

The repository contains documentation for:

```text
Discovery
PRDs
Specifications
Security
Architecture
Implementation
Validation
Reports
```

The development process is based on traceability:

```text
Product idea
     ↓
Discovery
     ↓
PRD
     ↓
Acceptance criteria
     ↓
Technical specification
     ↓
Implementation
     ↓
Tests
     ↓
Validation
```

This makes architectural decisions discoverable rather than leaving them implicit in the code.

---

# 🧭 Development Philosophy

Pesly follows several architectural principles.

### Domain over framework

Business rules should not depend on Next.js, Express or Drizzle.

### Explicit over magical

Financial behavior should be deterministic and understandable.

### Composition over large abstractions

Prefer small use cases and focused modules over enormous services.

### Contracts over duplication

Shared validation schemas should define boundaries where appropriate.

### Security by design

Authorization and data isolation are part of the architecture.

### Offline is a product requirement

Offline behavior is modeled as a real application state.

### Design consistency

Visual decisions belong in the design system, not scattered across features.

### External dependencies are replaceable

Third-party services should sit behind adapters.

### Documentation is part of the system

Important product and architectural decisions should be recoverable from the repository.

---

# 🚀 Getting Started

## Requirements

- Node.js 24 or newer (see `.nvmrc`)
- pnpm
- Docker, for the local PostgreSQL and Mailpit containers
- Git

---

## Installation

Clone the repository:

```bash
git clone https://github.com/MussiDev/pesly.git
cd pesly
```

Install dependencies:

```bash
pnpm install
```

Create the local environment configuration from the template:

```bash
cp .env.example .env
```

Start PostgreSQL and Mailpit (a local mailbox for the emails the API sends):

```bash
docker compose up -d
```

Apply the database migrations:

```bash
pnpm db:migrate
```

Then start the API, the background worker and the web application, each in its own terminal:

```bash
pnpm --filter @pesly/api dev
pnpm --filter @pesly/api worker
pnpm --filter @pesly/web dev
```

The web application runs at `http://localhost:3000`.

Check `.env.example` for the variables each application reads, and `docker-compose.yml` for the ports the local services use.

---

# 🗂️ Repository Structure

```text
.
├── apps/
│   ├── api/
│   │   ├── src/
│   │   │   ├── identity/
│   │   │   ├── accounts/
│   │   │   ├── categories/
│   │   │   ├── movements/
│   │   │   ├── exchange-rates/
│   │   │   ├── investments/
│   │   │   └── ...
│   │   ├── drizzle/
│   │   └── ...
│   │
│   └── web/
│       ├── src/
│       │   ├── app/
│       │   ├── components/
│       │   ├── features/
│       │   ├── i18n/
│       │   └── lib/
│       └── ...
│
├── packages/
│   └── shared/
│       └── src/
│           ├── money/
│           ├── accounts/
│           ├── movements/
│           ├── categories/
│           ├── investments/
│           ├── auth/
│           └── ...
│
├── docs/
│   └── ddw/
│       ├── discovery/
│       ├── prd/
│       ├── specs/
│       ├── security/
│       └── reports/
│
├── scripts/
├── package.json
└── pnpm-workspace.yaml
```

---

# 🤝 Contributing

Before implementing a feature:

1. Understand the relevant domain.
2. Check existing documentation.
3. Identify the appropriate feature/module.
4. Reuse existing shared contracts and design tokens.
5. Keep business logic out of the web layer.
6. Keep infrastructure out of the domain.
7. Add or update tests.
8. Consider authorization and ownership boundaries.
9. Consider offline behavior where relevant.
10. Update the relevant documentation when the decision changes the system.

Avoid introducing a new abstraction simply because the current code looks slightly inconvenient.

Every new layer should solve a real problem.

---

# 📐 Architectural Summary

```text
                         PESLY
                           │
          ┌────────────────┼────────────────┐
          │                │                │
       Product          Domain          Experience
          │                │                │
          ▼                ▼                ▼
      PRDs/specs      Financial rules    Next.js/PWA
          │                │                │
          │                ▼                │
          │           Application            │
          │                │                │
          │              Ports               │
          │                │                │
          │                ▼                │
          │         Infrastructure           │
          │                │                │
          │                ▼                │
          └────────── PostgreSQL ────────────┘
```

The resulting architecture can be summarized as:

```text
Monorepo
  ├── Next.js PWA
  ├── Express REST API
  └── Shared contracts

API
  ├── Domain
  ├── Application
  ├── Ports
  └── Infrastructure

Data
  ├── PostgreSQL
  ├── Drizzle
  └── Explicit migrations

Frontend
  ├── Feature architecture
  ├── Offline-first
  ├── IndexedDB
  └── Design system

Engineering
  ├── Zod contracts
  ├── Unit tests
  ├── Integration tests
  ├── E2E tests
  ├── Security
  └── Traceable documentation
```

---

## Philosophy

Pesly is not built around a particular framework.

It is built around a financial domain.

The technology stack may evolve.

The domain model, invariants, contracts and engineering principles should remain understandable regardless of which framework happens to be underneath them.

> **Build the system around the problem, not around the tools.**

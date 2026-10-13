import { dashboardResponseSchema, type DashboardResponse } from '@pesly/shared';

// TODO: this file builds a `GET /dashboard` response checked against the shared schema (09b is
// merged). The browser specs still stub the endpoint with it; replace it, together with
// `stubDashboard`, by real seeds once a Playwright run can verify them.

const BUDGET_ID = '3f0c1a52-6a43-4e0e-9a33-6f1f2b5d7a10';
const PAYMENT_ID = '9b1d2c34-1e5f-4a67-8b90-0c1d2e3f4a5b';
const STATEMENT_ID = '5d2e8f10-7a3b-4c91-8e24-1f6a9b0c3d57';
const CARD_ID = '7c4e1a90-2b6d-4f38-9a15-3e8d0b2c6f41';
const ZERO_PAIR = { ars: '0', usd: '0' };
const NO_PARTS = {
  accounts: ZERO_PAIR,
  investments: ZERO_PAIR,
  groups: ZERO_PAIR,
  installmentDebt: ZERO_PAIR,
};

/** The calendar day `offset` days from today, as the API writes dates. */
function isoDay(offset: number): string {
  return new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
}

/**
 * A full dashboard answer: a net worth in ARS and USD, the three month figures with their changes,
 * a category, a budget, a recurring payment due in 3 days, a closed statement due in 2 days, an
 * action waiting for the user, group balances and an insight. Money is in minor units.
 */
function base(): DashboardResponse {
  return {
    currency: 'ARS',
    today: isoDay(0),
    netWorth: {
      ars: '100000000',
      usd: '100000',
      total: '142000000',
      reason: null,
      holdingsWithoutPrice: 0,
      parts: { ...NO_PARTS, accounts: { ars: '100000000', usd: '100000' } },
    },
    available: { ars: '60000000', usd: '50000', total: '67000000', reason: null },
    month: {
      from: `${isoDay(0).slice(0, 7)}-01`,
      to: isoDay(0),
      expenses: '24000000',
      income: '80000000',
      net: '56000000',
      change: { expenses: 20, income: -5, net: 0 },
      unconvertedShareCount: 0,
      unconvertedInstallmentCount: 0,
    },
    categories: [
      { categoryId: null, defaultKey: 'food', name: null, amount: '12000000', sharePercent: 50 },
      {
        categoryId: null,
        defaultKey: 'transport',
        name: null,
        amount: '8000000',
        sharePercent: 33,
      },
    ],
    budgets: [
      {
        budgetId: BUDGET_ID,
        name: 'Supermercado',
        currency: 'ARS',
        available: '2000000',
        spent: '8000000',
        percentUsed: 80,
        status: 'close',
      },
    ],
    upcoming: [
      {
        kind: 'recurring_payment',
        paymentId: PAYMENT_ID,
        date: isoDay(3),
        name: 'Alquiler',
        currency: 'ARS',
        amount: '35000000',
      },
      {
        kind: 'card_statement',
        cardId: CARD_ID,
        statementId: STATEMENT_ID,
        date: isoDay(2),
        name: 'Visa',
        currency: 'ARS',
        amount: '9000000',
      },
    ],
    actions: [
      {
        kind: 'pending_occurrence',
        dueDate: isoDay(0),
        name: 'Gimnasio',
        occurrenceId: PAYMENT_ID,
      },
    ],
    groups: { owedToYou: { ars: '3000000', usd: '0' }, youOwe: { ars: '0', usd: '5000' } },
    insight: {
      categoryId: null,
      defaultKey: 'food',
      name: null,
      amount: '12000000',
      sharePercent: 50,
      changePercent: 40,
    },
    firstSteps: { hasAccount: true, hasMovement: true, show: false },
  };
}

/** What a user with no account and no movement gets: zeros everywhere and the guide on. */
export const FIRST_STEPS_DASHBOARD: Partial<DashboardResponse> = {
  netWorth: {
    ars: '0',
    usd: '0',
    total: '0',
    reason: null,
    holdingsWithoutPrice: 0,
    parts: NO_PARTS,
  },
  month: {
    from: `${isoDay(0).slice(0, 7)}-01`,
    to: isoDay(0),
    expenses: '0',
    income: '0',
    net: '0',
    change: { expenses: null, income: null, net: null },
    unconvertedShareCount: 0,
    unconvertedInstallmentCount: 0,
  },
  categories: [],
  budgets: [],
  upcoming: [],
  actions: [],
  groups: { owedToYou: ZERO_PAIR, youOwe: ZERO_PAIR },
  insight: null,
  firstSteps: { hasAccount: false, hasMovement: false, show: true },
};

/** Both parts of the net worth are known but no rate converts them into one figure. */
export const NO_RATE_DASHBOARD: Partial<DashboardResponse> = {
  netWorth: {
    ars: '100000000',
    usd: '100000',
    total: null,
    reason: 'no_rate',
    holdingsWithoutPrice: 0,
    parts: { ...NO_PARTS, accounts: { ars: '100000000', usd: '100000' } },
  },
};

/**
 * The response with the overrides applied at the top level, checked against the same parser the
 * app uses: a fixture that drifts from the contract fails here, not as a silent INTERNAL error.
 */
export function readyDashboard(overrides: Partial<DashboardResponse> = {}): DashboardResponse {
  return dashboardResponseSchema.parse({ ...base(), ...overrides });
}

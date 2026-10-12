import { dashboardResponseSchema, type DashboardResponse } from '../../src/lib/dashboard-contract';

// TODO(09b): this file builds the PROVISIONAL `GET /dashboard` response that slice 09b has not
// merged yet. Once 09b is on this branch, delete it together with `stubDashboard` and let the real
// endpoint answer from real seeds; the nine assumptions A1 to A9 are re-checked in the adapter.

const BUDGET_ID = '3f0c1a52-6a43-4e0e-9a33-6f1f2b5d7a10';
const PAYMENT_ID = '9b1d2c34-1e5f-4a67-8b90-0c1d2e3f4a5b';
const STATEMENT_ID = '5d2e8f10-7a3b-4c91-8e24-1f6a9b0c3d57';

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
    netWorth: {
      ars: '100000000',
      usd: '100000',
      total: '142000000',
      reason: null,
      holdingsWithoutPrice: 0,
    },
    month: {
      expenses: '24000000',
      income: '80000000',
      net: '56000000',
      expensesChange: 20,
      incomeChange: -5,
      netChange: 0,
      leftOutShares: 0,
      leftOutInstallments: 0,
    },
    categories: [
      { categoryId: null, defaultKey: 'food', name: null, amount: '12000000', share: 50 },
      { categoryId: null, defaultKey: 'transport', name: null, amount: '8000000', share: 33 },
    ],
    budgets: [
      { id: BUDGET_ID, name: 'Supermercado', currency: 'ARS', percent: 80, status: 'close' },
    ],
    upcoming: [
      {
        kind: 'payment',
        id: PAYMENT_ID,
        name: 'Alquiler',
        date: isoDay(3),
        amount: '35000000',
        currency: 'ARS',
      },
      {
        kind: 'statement',
        id: STATEMENT_ID,
        name: 'Visa',
        date: isoDay(2),
        amount: '9000000',
        currency: 'ARS',
      },
    ],
    actions: [
      {
        kind: 'pending_occurrence',
        id: PAYMENT_ID,
        name: 'Gimnasio',
        date: isoDay(0),
        amount: '1500000',
        currency: 'ARS',
      },
    ],
    groups: { owedToYou: { ARS: '3000000', USD: '0' }, youOwe: { ARS: '0', USD: '5000' } },
    insight: { defaultKey: 'food', name: null, share: 50, change: 40 },
    firstSteps: { hasAccount: true, hasMovement: true, show: false },
  };
}

/** What a user with no account and no movement gets: zeros everywhere and the guide on. */
export const FIRST_STEPS_DASHBOARD: Partial<DashboardResponse> = {
  netWorth: { ars: '0', usd: '0', total: '0', reason: null, holdingsWithoutPrice: 0 },
  month: {
    expenses: '0',
    income: '0',
    net: '0',
    expensesChange: null,
    incomeChange: null,
    netChange: null,
    leftOutShares: 0,
    leftOutInstallments: 0,
  },
  categories: [],
  budgets: [],
  upcoming: [],
  actions: [],
  groups: { owedToYou: { ARS: '0', USD: '0' }, youOwe: { ARS: '0', USD: '0' } },
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
  },
};

/**
 * The response with the overrides applied at the top level, checked against the same parser the
 * app uses: a fixture that drifts from the contract fails here, not as a silent INTERNAL error.
 */
export function readyDashboard(overrides: Partial<DashboardResponse> = {}): DashboardResponse {
  return dashboardResponseSchema.parse({ ...base(), ...overrides });
}

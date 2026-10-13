import { dashboardResponseSchema } from '@pesly/shared';
import { describe, expect, it } from 'vitest';
import type { GetDashboardDependencies } from '../../src/dashboard/application/get-dashboard';
import { GetDashboard } from '../../src/dashboard/application/get-dashboard';
import type { GroupBalanceReader } from '../../src/dashboard/application/ports/group-balance-reader';
import { presentDashboard } from '../../src/dashboard/infrastructure/http/present-dashboard';
import { readScope } from '../movements/db-fixtures';
import { FakePreferences, FixedClock } from './fakes';

const ME = '11111111-1111-4111-8111-111111111111';
const CARD = '22222222-2222-4222-8222-222222222222';
const STATEMENT = '33333333-3333-4333-8333-333333333333';

interface Spies {
  groupReads: number;
  preferenceReads: number;
}

function setup(overrides: Partial<GetDashboardDependencies> = {}) {
  const spies: Spies = { groupReads: 0, preferenceReads: 0 };
  const preferences = new FakePreferences();
  const groupBalances: GroupBalanceReader = {
    sourcesOf: () => {
      spies.groupReads += 1;
      return Promise.resolve([]);
    },
  };
  const deps: GetDashboardDependencies = {
    clock: new FixedClock(),
    preferences,
    netWorth: {
      sources: {
        accountFlows: () =>
          Promise.resolve({
            opening: { ARS: 1000n, USD: 0n },
            baseline: { ARS: 0n, USD: 0n },
            byMonth: new Map(),
          }),
        installmentDebtRows: () => Promise.resolve([]),
      },
      rates: { sellRates: () => Promise.resolve(new Map()) },
      investments: {
        valueNow: () => Promise.resolve({ ARS: 500n, USD: 0n, holdingsWithoutPrice: 2 }),
      },
    },
    flows: {
      flows: {
        personalRows: () => Promise.resolve([]),
        shareRows: () => Promise.resolve([]),
        installmentRows: () => Promise.resolve([]),
        cardPurchaseRows: () => Promise.resolve([]),
        topCategories: () => Promise.resolve([]),
      },
    },
    budgets: {
      versions: { forMonths: () => Promise.resolve([]) },
      spending: {
        personalSpending: () => Promise.resolve([]),
        shareSpending: () => Promise.resolve([]),
        cardPurchaseSpending: () => Promise.resolve([]),
        installmentSpending: () => Promise.resolve([]),
      },
      clock: new FixedClock(),
    },
    agenda: {
      upcoming: () => ({ execute: () => Promise.resolve([]) }),
      currencies: { currenciesOf: () => Promise.resolve(new Map()) },
      statements: {
        dueStatements: () =>
          Promise.resolve([
            {
              cardId: CARD,
              cardName: 'Visa',
              statementId: STATEMENT,
              dueDate: '2026-10-09',
              closed: true,
              owed: { ARS: 7000n, USD: 0n },
            },
          ]),
      },
    },
    groups: { groupBalances },
    firstSteps: {
      firstSteps: { firstStepsOf: () => Promise.resolve({ hasAccount: true, hasMovement: false }) },
    },
    present: presentDashboard,
    ...overrides,
  };
  return { deps, spies, preferences, useCase: new GetDashboard(deps) };
}

describe('GetDashboard', () => {
  it('(AC-01, AC-03) builds every section and the response parses with integer-string amounts', async () => {
    const { useCase } = setup();

    const response = await useCase.execute(await readScope(ME));

    expect(dashboardResponseSchema.parse(response)).toEqual(response);
    expect(response.currency).toBe('ARS');
    expect(response.today).toBe('2026-10-06');
    expect(response.netWorth.ars).toBe('1500');
    expect(response.netWorth.parts.investments).toEqual({ ars: '500', usd: '0' });
    expect(response.netWorth.holdingsWithoutPrice).toBe(2);
    expect(response.firstSteps).toEqual({ hasAccount: true, hasMovement: false, show: true });
    expect(response.actions).toEqual([
      {
        kind: 'unpaid_statement',
        dueDate: '2026-10-09',
        name: 'Visa',
        statementId: STATEMENT,
        cardId: CARD,
      },
    ]);
    expect(response.month.from).toBe('2026-10-01');
  });

  it('(FR-05, D3) reads the preferences once and the groups once for the whole request', async () => {
    const { useCase, spies, preferences } = setup();

    await useCase.execute(await readScope(ME));

    expect(preferences.calls).toBe(1);
    expect(spies.groupReads).toBe(1);
  });

  it('(FR-02) feeds the net of the groups into the net worth part', async () => {
    const { useCase } = setup({
      groups: {
        groupBalances: {
          sourcesOf: () =>
            Promise.resolve([
              {
                groupId: 'g',
                memberId: 'm',
                sources: {
                  ARS: {
                    paid: new Map([['m', 3000n]]),
                    shares: new Map(),
                    legs: new Map(),
                  },
                  USD: { paid: new Map(), shares: new Map(), legs: new Map() },
                },
              },
            ]),
        },
      },
    });

    const response = await useCase.execute(await readScope(ME));

    expect(response.groups.owedToYou.ars).toBe(response.netWorth.parts.groups.ars);
    expect(response.netWorth.parts.groups.ars).not.toBe('0');
  });

  it.each([
    [
      'net worth',
      () => ({
        netWorth: {
          ...setup().deps.netWorth,
          investments: { valueNow: () => Promise.reject(new Error('boom')) },
        },
      }),
    ],
    [
      'month flows',
      () => ({
        flows: {
          flows: {
            ...setup().deps.flows.flows,
            personalRows: () => Promise.reject(new Error('boom')),
          },
        },
      }),
    ],
    [
      'agenda',
      () => ({
        agenda: {
          ...setup().deps.agenda,
          statements: { dueStatements: () => Promise.reject(new Error('boom')) },
        },
      }),
    ],
    [
      'groups',
      () => ({ groups: { groupBalances: { sourcesOf: () => Promise.reject(new Error('boom')) } } }),
    ],
    [
      'first steps',
      () => ({
        firstSteps: { firstSteps: { firstStepsOf: () => Promise.reject(new Error('boom')) } },
      }),
    ],
  ])('(AC-49) rejects the whole request when the %s source fails', async (_name, make) => {
    const { useCase } = setup(make());

    await expect(useCase.execute(await readScope(ME))).rejects.toThrow('boom');
  });

  it('(FR-16) a missing user rejects before any section is built', async () => {
    const { useCase } = setup({
      preferences: { preferencesOf: () => Promise.reject(new Error('no user')) },
    });

    await expect(useCase.execute(await readScope(ME))).rejects.toThrow('no user');
  });
});

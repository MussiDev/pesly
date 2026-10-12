import { describe, expect, it } from 'vitest';
import { GetIncomeExpenses } from '../../src/reports/application/get-income-expenses';
import { presentIncomeExpenses } from '../../src/reports/infrastructure/http/present-income-expenses';
import type {
  FlowReader,
  FlowWindow,
  InstallmentFlowRow,
  PersonalFlowRow,
  ShareFlowRow,
} from '../../src/reports/application/ports/flow-reader';
import type { ReportPreferences } from '../../src/reports/application/ports/report-preferences';
import type { AccessScope } from '../../src/shared/access';
import { readScope } from '../movements/db-fixtures';
import { FakeFilterReader, FakePreferences, FixedClock } from './fakes';

const ACCOUNT = '3f0c1c9e-5c53-4a53-9a55-0d6a4c0f0a01';
const CATEGORY = '3f0c1c9e-5c53-4a53-9a55-0d6a4c0f0a02';
const END_OF_MONTH = new Date('2026-10-31T15:00:00Z');

class FakeFlowReader implements FlowReader {
  windows: FlowWindow[] = [];
  shareCalls = 0;
  installmentCalls = 0;
  personal: PersonalFlowRow[] = [];
  shares: ShareFlowRow[] = [];
  installments: InstallmentFlowRow[] = [];
  failure: Error | null = null;

  personalRows(_scope: AccessScope, window: FlowWindow): Promise<PersonalFlowRow[]> {
    this.windows.push(window);
    if (this.failure) return Promise.reject(this.failure);
    return Promise.resolve(this.personal);
  }

  shareRows(): Promise<ShareFlowRow[]> {
    this.shareCalls += 1;
    return Promise.resolve(this.shares);
  }

  installmentRows(): Promise<InstallmentFlowRow[]> {
    this.installmentCalls += 1;
    return Promise.resolve(this.installments);
  }

  topCategories(): Promise<never[]> {
    return Promise.reject(new Error('The income and expenses report needs no categories'));
  }
}

const personal = (fields: Partial<PersonalFlowRow>): PersonalFlowRow => ({
  month: '2026-10',
  type: 'expense',
  topCategoryId: CATEGORY,
  currency: 'ARS',
  rate: 14000000n,
  sum: 100n,
  count: 1,
  ...fields,
});

const installment = (fields: Partial<InstallmentFlowRow>): InstallmentFlowRow => ({
  period: '2026-10',
  dueDate: '2026-11-10',
  closingDay: 25,
  dueDay: 10,
  topCategoryId: CATEGORY,
  currency: 'ARS',
  rate: null,
  sum: 1000000n,
  count: 1,
  ...fields,
});

async function setup(preferences?: ReportPreferences, now?: Date) {
  const flows = new FakeFlowReader();
  const useCase = new GetIncomeExpenses({
    clock: new FixedClock(now),
    preferences: new FakePreferences(preferences),
    filters: new FakeFilterReader([ACCOUNT], ['Vacations2026']),
    flows,
    present: presentIncomeExpenses,
  });
  return { flows, useCase, scope: await readScope('11111111-1111-4111-8111-111111111111') };
}

describe('GetIncomeExpenses', () => {
  it('defaults to the 12 months ending in the current one, each with income and expenses (AC-07)', async () => {
    const { useCase, scope } = await setup();

    const response = await useCase.execute(scope, {});

    expect(response.months).toHaveLength(12);
    expect(response.months[0]?.month).toBe('2025-11');
    expect(response.months[11]?.month).toBe('2026-10');
    expect(response.from).toBe('2025-11-01');
    expect(response.to).toBe('2026-10-06');
    expect(response.currency).toBe('ARS');
    for (const month of response.months) {
      expect(month).toEqual({ month: month.month, income: '0', expenses: '0' });
    }
  });

  it('returns "0" income and "0" expenses for a month with no movement (AC-08)', async () => {
    const { useCase, scope, flows } = await setup();
    flows.personal = [personal({ month: '2026-09', type: 'income', sum: 5000n })];

    const response = await useCase.execute(scope, { from: '2026-08-01', to: '2026-10-06' });

    expect(response.months).toEqual([
      { month: '2026-08', income: '0', expenses: '0' },
      { month: '2026-09', income: '5000', expenses: '0' },
      { month: '2026-10', income: '0', expenses: '0' },
    ]);
  });

  it('passes the account filter and the instant bounds to the personal read (AC-12)', async () => {
    const { useCase, scope, flows } = await setup();

    await useCase.execute(scope, { from: '2026-03-01', to: '2026-03-31', accountId: ACCOUNT });

    expect(flows.windows).toHaveLength(1);
    expect(flows.windows[0]).toMatchObject({
      accountId: ACCOUNT,
      timeZone: 'America/Argentina/Buenos_Aires',
    });
    expect(flows.windows[0]?.from.toISOString()).toBe('2026-03-01T03:00:00.000Z');
    expect(flows.windows[0]?.before.toISOString()).toBe('2026-04-01T03:00:00.000Z');
  });

  it('adds income rows to income and expense rows to expenses, converted with the frozen rate (AC-15, AC-22)', async () => {
    const { useCase, scope, flows } = await setup();
    flows.personal = [
      personal({ type: 'income', sum: 300000n }),
      personal({ type: 'expense', sum: 50000n }),
      // 20.00 USD at a frozen 1,400.0000 is 28,000.00 ARS whatever the stored rates are today.
      personal({ type: 'expense', currency: 'USD', sum: 2000n, rate: 14000000n }),
    ];

    const response = await useCase.execute(scope, { from: '2026-10-01', to: '2026-10-06' });

    expect(response.months).toEqual([{ month: '2026-10', income: '300000', expenses: '2850000' }]);
  });

  it('converts to USD with the frozen rate when the display currency is USD', async () => {
    const { useCase, scope, flows } = await setup({
      displayCurrency: 'USD',
      defaultRateType: 'mep',
      timeZone: 'America/Argentina/Buenos_Aires',
    });
    flows.personal = [personal({ sum: 3000000n, rate: 15000000n })];

    const response = await useCase.execute(scope, { from: '2026-10-01', to: '2026-10-06' });

    expect(response.currency).toBe('USD');
    expect(response.months[0]?.expenses).toBe('2000');
  });

  it('never calls the share or installment readers with an account or a tag filter (AC-24)', async () => {
    const { useCase, scope, flows } = await setup();

    await useCase.execute(scope, { accountId: ACCOUNT });
    await useCase.execute(scope, { tag: 'Vacations2026' });

    expect(flows.shareCalls).toBe(0);
    expect(flows.installmentCalls).toBe(0);
  });

  it('adds the shares and the installments of their due month to the expenses without filters (AC-24)', async () => {
    const { useCase, scope, flows } = await setup(undefined, END_OF_MONTH);
    flows.personal = [personal({ sum: 100n })];
    flows.shares = [
      {
        month: '2026-10',
        categoryName: 'Food',
        categoryDefaultKey: null,
        currency: 'ARS',
        rate: null,
        sum: 1000n,
        count: 1,
      },
    ];
    flows.installments = [
      installment({ dueDate: '2026-10-10', period: '2026-10', sum: 20000n }),
      // Due 2026-11-10: after `to`, so it is outside the range.
      installment({ dueDate: '2026-11-10', period: '2026-10', sum: 777n }),
      // Derived dates: a statement not stored yet, closing 25, due 10 -> period 2026-09 is due 2026-10-10.
      installment({ dueDate: null, period: '2026-09', sum: 300n }),
    ];

    const response = await useCase.execute(scope, { from: '2026-10-01', to: '2026-10-31' });

    expect(flows.shareCalls).toBe(1);
    expect(flows.installmentCalls).toBe(1);
    expect(response.months).toEqual([{ month: '2026-10', income: '0', expenses: '21400' }]);
  });

  it('leaves an installment in USD out of an ARS display and counts it (AC-25)', async () => {
    const { useCase, scope, flows } = await setup(undefined, END_OF_MONTH);
    flows.installments = [
      installment({ dueDate: '2026-10-10', currency: 'USD', sum: 5000n, count: 3 }),
      installment({ dueDate: '2026-10-10', sum: 1000n }),
    ];
    flows.shares = [
      {
        month: '2026-10',
        categoryName: null,
        categoryDefaultKey: null,
        currency: 'USD',
        rate: null,
        sum: 900n,
        count: 2,
      },
    ];

    const response = await useCase.execute(scope, { from: '2026-10-01', to: '2026-10-31' });

    expect(response.unconvertedInstallmentCount).toBe(3);
    expect(response.unconvertedShareCount).toBe(2);
    expect(response.months[0]?.expenses).toBe('1000');
  });

  it('rejects a 13 month range and accepts 12 months with from and to (AC-06)', async () => {
    const { useCase, scope } = await setup();

    await expect(
      useCase.execute(scope, { from: '2025-09-01', to: '2026-09-30' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    const ok = await useCase.execute(scope, { from: '2025-10-01', to: '2026-09-30' });

    expect(ok.months).toHaveLength(12);
  });

  it('rethrows a reader error with no partial response and refuses an unknown account', async () => {
    const { useCase, scope, flows } = await setup();
    flows.failure = new Error('db down');

    await expect(useCase.execute(scope, {})).rejects.toThrow('db down');
    await expect(
      useCase.execute(scope, { accountId: '3f0c1c9e-5c53-4a53-9a55-0d6a4c0f0aff' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

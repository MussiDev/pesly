import { describe, expect, it } from 'vitest';
import { GetExpensesByCategory } from '../../src/reports/application/get-expenses-by-category';
import type {
  FlowReader,
  FlowWindow,
  CardPurchaseFlowRow,
  InstallmentFlowRow,
  PersonalFlowRow,
  ShareFlowRow,
} from '../../src/reports/application/ports/flow-reader';
import type { TopCategory } from '../../src/reports/domain/flows';
import { ResourceNotFound } from '../../src/shared/access';
import { readScope } from '../movements/db-fixtures';
import { FakeFilterReader, FakePreferences, FixedClock } from './fakes';

const FOOD = '00000000-0000-4000-8000-0000000000f0';
const FUN = '00000000-0000-4000-8000-0000000000f1';
const LATER = new Date('2026-12-15T16:00:00.000Z');
const ACCOUNT = '3f0c1c9e-5c53-4a53-9a55-0d6a4c0f0a01';

const categories: TopCategory[] = [
  {
    id: FOOD,
    name: 'Food',
    defaultKey: null,
    children: [{ name: 'Groceries', defaultKey: null }],
    createdAt: new Date('2026-01-01T00:00:00Z'),
  },
  {
    id: FUN,
    name: null,
    defaultKey: 'entertainment',
    children: [],
    createdAt: new Date('2026-01-02T00:00:00Z'),
  },
];

class FakeFlows implements FlowReader {
  calls: string[] = [];
  windows: FlowWindow[] = [];

  constructor(
    private readonly data: {
      personal?: PersonalFlowRow[];
      shares?: ShareFlowRow[];
      installments?: InstallmentFlowRow[];
      cardPurchases?: CardPurchaseFlowRow[];
      categories?: TopCategory[];
      fail?: boolean;
    } = {},
  ) {}

  personalRows(_scope: unknown, window: FlowWindow): Promise<PersonalFlowRow[]> {
    this.calls.push('personal');
    this.windows.push(window);
    if (this.data.fail) return Promise.reject(new Error('db down'));
    return Promise.resolve(this.data.personal ?? []);
  }

  shareRows(): Promise<ShareFlowRow[]> {
    this.calls.push('shares');
    return Promise.resolve(this.data.shares ?? []);
  }

  installmentRows(): Promise<InstallmentFlowRow[]> {
    this.calls.push('installments');
    return Promise.resolve(this.data.installments ?? []);
  }

  cardPurchaseRows(): Promise<CardPurchaseFlowRow[]> {
    this.calls.push('card-purchases');
    return Promise.resolve(this.data.cardPurchases ?? []);
  }

  topCategories(): Promise<TopCategory[]> {
    this.calls.push('categories');
    return Promise.resolve(this.data.categories ?? categories);
  }
}

const personal = (fields: Partial<PersonalFlowRow>): PersonalFlowRow => ({
  month: '2026-09',
  type: 'expense',
  topCategoryId: FOOD,
  currency: 'ARS',
  rate: 14000000n,
  sum: 100n,
  count: 1,
  ...fields,
});

const share = (fields: Partial<ShareFlowRow>): ShareFlowRow => ({
  month: '2026-09',
  categoryName: 'Food',
  categoryDefaultKey: null,
  currency: 'ARS',
  rate: null,
  sum: 1000000n,
  count: 1,
  ...fields,
});

const installment = (fields: Partial<InstallmentFlowRow>): InstallmentFlowRow => ({
  period: '2026-10',
  dueDate: '2026-11-10',
  closingDay: 25,
  dueDay: 10,
  topCategoryId: FOOD,
  currency: 'ARS',
  rate: null,
  sum: 1000000n,
  count: 1,
  ...fields,
});

async function run(
  flows: FakeFlows,
  query: Parameters<GetExpensesByCategory['execute']>[1] = {},
  options: { display?: 'ARS' | 'USD'; now?: Date } = {},
) {
  const useCase = new GetExpensesByCategory({
    clock: new FixedClock(options.now),
    preferences: new FakePreferences({
      displayCurrency: options.display ?? 'ARS',
      defaultRateType: 'mep',
      timeZone: 'America/Argentina/Buenos_Aires',
    }),
    filters: new FakeFilterReader([ACCOUNT], ['vacations2026']),
    flows,
  });
  return useCase.execute(await readScope('11111111-1111-4111-8111-111111111111'), query);
}

describe('GetExpensesByCategory', () => {
  it('returns one row per top-level category with id, name and amount (AC-01, AC-02)', async () => {
    const flows = new FakeFlows({
      personal: [
        personal({ topCategoryId: FOOD, sum: 300n }),
        personal({ topCategoryId: FOOD, month: '2026-08', sum: 200n }),
        personal({ topCategoryId: FUN, sum: 900n }),
        personal({ type: 'income', topCategoryId: FOOD, sum: 99999n }),
      ],
    });

    const result = await run(flows, { from: '2025-01-01', to: '2026-09-30' });

    expect(result).toEqual({
      currency: 'ARS',
      from: '2025-01-01',
      to: '2026-09-30',
      total: '1400',
      categories: [
        { categoryId: FUN, name: null, defaultKey: 'entertainment', amount: '900' },
        { categoryId: FOOD, name: 'Food', defaultKey: null, amount: '500' },
      ],
      unconvertedShareCount: 0,
      unconvertedInstallmentCount: 0,
    });
  });

  it('returns an empty list and a total of 0 when there is no expense (AC-03)', async () => {
    const result = await run(new FakeFlows());

    expect(result.categories).toEqual([]);
    expect(result.total).toBe('0');
  });

  it('adds a matched share, and folds an unmatched one into a null category row (AC-18, AC-20)', async () => {
    const flows = new FakeFlows({
      personal: [personal({ sum: 5000000n })],
      shares: [
        share({ categoryName: 'food', sum: 1000000n }),
        share({ categoryName: 'Gifts', sum: 400000n }),
      ],
    });

    const result = await run(flows);

    expect(result.categories).toEqual([
      { categoryId: FOOD, name: 'Food', defaultKey: null, amount: '6000000' },
      { categoryId: null, name: null, defaultKey: null, amount: '400000' },
    ]);
    expect(result.total).toBe('6400000');
  });

  it('matches a share through the name of a child category', async () => {
    const result = await run(
      new FakeFlows({ shares: [share({ categoryName: 'groceries', sum: 10n })] }),
    );

    expect(result.categories.map((row) => row.categoryId)).toEqual([FOOD]);
  });

  it('leaves out a share in the other currency with no rate and counts it (AC-21)', async () => {
    const flows = new FakeFlows({
      shares: [share({ currency: 'USD', rate: null, count: 3 }), share({ sum: 10n })],
    });

    const result = await run(flows);

    expect(result.unconvertedShareCount).toBe(3);
    expect(result.total).toBe('10');
  });

  it('converts a USD share paid by the user with the frozen rate', async () => {
    const result = await run(
      new FakeFlows({ shares: [share({ currency: 'USD', rate: 14000000n, sum: 2000n })] }),
    );

    expect(result.total).toBe('2800000');
  });

  it('adds the installment due inside the range to its purchase category (AC-23)', async () => {
    const flows = new FakeFlows({
      installments: [
        installment({ sum: 1000000n }),
        installment({ dueDate: '2026-12-10', sum: 777n }),
      ],
    });

    const result = await run(flows, { from: '2026-11-01', to: '2026-11-30' }, { now: LATER });

    expect(result.categories).toEqual([
      { categoryId: FOOD, name: 'Food', defaultKey: null, amount: '1000000' },
    ]);
  });

  it('derives the due date when no statement is stored (AC-23)', async () => {
    const flows = new FakeFlows({ installments: [installment({ dueDate: null })] });

    const result = await run(flows, { from: '2026-11-01', to: '2026-11-30' }, { now: LATER });

    expect(result.total).toBe('1000000');
  });

  it('leaves out an installment in the other currency and counts it (AC-25)', async () => {
    const flows = new FakeFlows({ installments: [installment({ currency: 'USD', count: 2 })] });

    const result = await run(flows, { from: '2026-11-01', to: '2026-11-30' }, { now: LATER });

    expect(result.unconvertedInstallmentCount).toBe(2);
    expect(result.categories).toEqual([]);
  });

  it('does not count an unconverted installment due outside the range', async () => {
    const flows = new FakeFlows({
      installments: [installment({ currency: 'USD', dueDate: '2027-01-10' })],
    });

    const result = await run(flows, { from: '2026-11-01', to: '2026-11-30' }, { now: LATER });

    expect(result.unconvertedInstallmentCount).toBe(0);
  });

  it('reads no shares or installments with an account or tag filter (AC-24)', async () => {
    const byAccount = new FakeFlows({ personal: [personal({})] });
    const byTag = new FakeFlows({ personal: [personal({})] });

    await run(byAccount, { accountId: ACCOUNT });
    const result = await run(byTag, { tag: 'Vacations2026' });

    expect(byAccount.calls).not.toContain('shares');
    expect(byAccount.calls).not.toContain('installments');
    expect(byTag.calls).not.toContain('shares');
    expect(byTag.calls).not.toContain('installments');
    expect(byTag.windows[0]?.tag).toBe('Vacations2026');
    expect(result.categories).toHaveLength(1);
  });

  it('is an error when the top-level category is missing from the category read', async () => {
    const flows = new FakeFlows({ personal: [personal({ topCategoryId: 'gone' })] });

    await expect(run(flows)).rejects.toThrow();
  });

  it('is an error when an installment category is missing from the category read', async () => {
    const flows = new FakeFlows({ installments: [installment({ topCategoryId: 'gone' })] });

    await expect(
      run(flows, { from: '2026-11-01', to: '2026-11-30' }, { now: LATER }),
    ).rejects.toThrow();
  });

  it('answers 404 for an account of another user before any read (FR-01)', async () => {
    const flows = new FakeFlows();

    await expect(run(flows, { accountId: '3f0c1c9e-5c53-4a53-9a55-0d6a4c0f0aff' })).rejects.toThrow(
      ResourceNotFound,
    );
    expect(flows.calls).toEqual([]);
  });

  it('rejects a range of 25 months and reads nothing (AC-04)', async () => {
    const flows = new FakeFlows();

    await expect(run(flows, { from: '2024-09-01', to: '2026-09-30' })).rejects.toThrow();
    expect(flows.calls).toEqual([]);
  });

  it('defaults to the current month up to today', async () => {
    const result = await run(new FakeFlows());

    expect(result.from).toBe('2026-10-01');
    expect(result.to).toBe('2026-10-06');
  });

  it('rethrows a reader error with no response', async () => {
    await expect(run(new FakeFlows({ fail: true }))).rejects.toThrow('db down');
  });
});

const cardPurchase = (fields: Partial<CardPurchaseFlowRow>): CardPurchaseFlowRow => ({
  period: '2026-09',
  dueDate: '2026-10-05',
  closingDay: 24,
  dueDay: 5,
  topCategoryId: FOOD,
  currency: 'ARS',
  rate: 14000000n,
  sum: 3000000n,
  count: 1,
  ...fields,
});

describe('GetExpensesByCategory card purchases', () => {
  const NOW = { now: new Date('2026-12-15T16:00:00.000Z') };

  it('counts the purchases whose statement is due in the range, with and without a filter', async () => {
    const flows = new FakeFlows({
      cardPurchases: [
        cardPurchase({ sum: 300n }),
        cardPurchase({ dueDate: '2026-11-05', period: '2026-10', sum: 70n }),
      ],
    });

    const october = await run(flows, { from: '2026-10-01', to: '2026-10-31' }, NOW);
    const filtered = await run(
      new FakeFlows({ cardPurchases: [cardPurchase({ sum: 300n })] }),
      { from: '2026-10-01', to: '2026-10-31', accountId: ACCOUNT },
      NOW,
    );

    expect(october.categories.map((row) => row.amount)).toEqual(['300']);
    expect(filtered.categories.map((row) => row.amount)).toEqual(['300']);
    expect(flows.calls).toContain('card-purchases');
  });

  it('fails the report with an error when a card purchase row has no frozen rate', async () => {
    const flows = new FakeFlows({
      cardPurchases: [cardPurchase({ currency: 'USD', rate: null as unknown as bigint })],
    });

    await expect(run(flows, { from: '2026-10-01', to: '2026-10-31' }, NOW)).rejects.toThrow();
  });

  it('fails the report with a RangeError when the top category of a card purchase is unknown', async () => {
    const flows = new FakeFlows({
      cardPurchases: [cardPurchase({ topCategoryId: '9f000000-0000-4000-8000-000000000009' })],
    });

    await expect(run(flows, { from: '2026-10-01', to: '2026-10-31' }, NOW)).rejects.toThrow(
      /missing/,
    );
  });
});

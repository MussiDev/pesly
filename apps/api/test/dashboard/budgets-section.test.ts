import { beforeEach, describe, expect, it } from 'vitest';
import { CreateBudget, type BudgetVersionReader, type SpendingReader } from '../../src/budgets';
import { buildBudgets } from '../../src/dashboard/application/build-budgets';
import { prepareDashboard } from '../../src/dashboard/application/dashboard-context';
import {
  FakeCategories,
  FakeSpendingReader,
  FakeUserTimeZone,
  FixedClock as BudgetsClock,
  InMemoryBudgetRepository,
  InMemoryVersionReader,
  readScopeFor,
  writeScopeFor,
} from '../budgets/fakes';
import { FakePreferences, FixedClock } from './fakes';

const ANA = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-10-06T16:00:00.000Z');

let categories: FakeCategories;
let repo: InMemoryBudgetRepository;
let spending: FakeSpendingReader;
let versions: InMemoryVersionReader;
let create: CreateBudget;

beforeEach(() => {
  categories = new FakeCategories();
  repo = new InMemoryBudgetRepository(categories);
  spending = new FakeSpendingReader();
  versions = new InMemoryVersionReader(repo, categories);
  create = new CreateBudget({
    budgets: repo,
    categories,
    clock: new BudgetsClock(NOW),
    timeZones: new FakeUserTimeZone(),
  });
});

/** A budget of 100.00 over its own category, with `percent` of it spent this month. */
async function budgetAt(percent: number, currency: 'ARS' | 'USD' = 'ARS', name = `At ${percent}`) {
  const category = categories.add(ANA);
  const created = await create.execute(await writeScopeFor(ANA), {
    name,
    amount: '10000',
    currency,
    rollover: false,
    thresholds: [80, 100],
    categoryIds: [category.id],
  });
  spending.personal.set(ANA, [
    ...(spending.personal.get(ANA) ?? []),
    {
      categoryId: category.id,
      currency,
      rate: 14000000n,
      sum: BigInt(percent) * 100n,
      bucket: 'current',
      count: 1,
    },
  ]);
  return created;
}

async function run(overrides: { versions?: BudgetVersionReader; spending?: SpendingReader } = {}) {
  const scope = await readScopeFor(ANA);
  const context = await prepareDashboard(
    { clock: new FixedClock(NOW), preferences: new FakePreferences() },
    scope,
  );
  return buildBudgets(
    {
      versions: overrides.versions ?? versions,
      spending: overrides.spending ?? spending,
      clock: new FixedClock(NOW),
    },
    scope,
    context,
  );
}

describe('buildBudgets', () => {
  it('returns the three most used budgets, over first, without the lowest', async () => {
    await budgetAt(50);
    await budgetAt(85);
    await budgetAt(105);
    await budgetAt(30);

    const result = await run();

    expect(result.map((row) => [row.percentUsed, row.status])).toEqual([
      [105, 'over'],
      [85, 'close'],
      [50, 'on_track'],
    ]);
  });

  it('puts the boundaries in the right status', async () => {
    await budgetAt(79);
    await budgetAt(80);
    await budgetAt(99);
    await budgetAt(100);

    const result = await run();

    expect(result.map((row) => [row.percentUsed, row.status])).toEqual([
      [100, 'over'],
      [99, 'close'],
      [80, 'close'],
    ]);
  });

  it('keeps each budget in its own currency, compared by percentage only', async () => {
    await budgetAt(40, 'ARS', 'Pesos');
    await budgetAt(90, 'USD', 'Dollars');

    const result = await run();

    expect(result).toEqual([
      expect.objectContaining({
        name: 'Dollars',
        currency: 'USD',
        available: 10000n,
        spent: 9000n,
      }),
      expect.objectContaining({ name: 'Pesos', currency: 'ARS', available: 10000n, spent: 4000n }),
    ]);
  });

  it('is empty when no budget is in force', async () => {
    expect(await run()).toEqual([]);
  });

  it('keeps the older budget first on a tie', async () => {
    const first = await budgetAt(60, 'ARS', 'First');
    await budgetAt(60, 'ARS', 'Second');

    const result = await run();

    expect(result[0]?.budgetId).toBe(first.id);
  });

  it('rejects the section when the spending read fails', async () => {
    await budgetAt(60);
    const failing: SpendingReader = {
      personalSpending: () => Promise.reject(new Error('spending read failed')),
      shareSpending: () => Promise.resolve([]),
    };

    await expect(run({ spending: failing })).rejects.toThrow('spending read failed');
  });

  it('rejects the section on a non-positive available amount', async () => {
    const category = categories.add(ANA);
    const broken: BudgetVersionReader = {
      forMonths: () =>
        Promise.resolve([
          {
            budgetId: '44444444-4444-4444-8444-444444444444',
            currency: 'ARS',
            createdAt: NOW,
            byMonth: new Map([
              [
                '2026-10',
                {
                  version: {
                    id: 'v',
                    effectiveFrom: '2026-10-01',
                    name: 'Broken',
                    amount: 0n,
                    rollover: false,
                    categoryIds: [category.id],
                    thresholds: [80, 100],
                  },
                  covered: [{ id: category.id, name: null, defaultKey: null }],
                },
              ],
              ['2026-09', null],
            ]),
          },
        ]),
    };

    await expect(run({ versions: broken })).rejects.toThrow(RangeError);
  });
});

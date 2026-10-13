import { beforeEach, describe, expect, it } from 'vitest';
import type { CreateBudgetRequest } from '@pesly/shared';
import { CreateBudget, EvaluateBudgetAlerts, ListBudgetSpending } from '../../src/budgets';
import type { BudgetAlertStore } from '../../src/budgets/application/ports/budget-alert-store';
import type { BucketedPersonalRow } from '../../src/budgets/application/ports/spending-reader';
import { cardPurchaseRow } from './spending-fixtures';
import {
  FakeCategories,
  FakeSpendingReader,
  FakeUserTimeZone,
  FixedClock,
  InMemoryAlertStore,
  InMemoryBudgetRepository,
  InMemoryVersionReader,
  readScopeFor,
  writeScopeFor,
} from './fakes';

const ALICE = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';
const OCTOBER = new Date('2026-10-06T16:00:00Z');
const NOVEMBER = new Date('2026-11-06T16:00:00Z');
const IN_OCTOBER = new Date('2026-10-05T15:00:00Z');

let categories: FakeCategories;
let repo: InMemoryBudgetRepository;
let clock: FixedClock;
let reader: FakeSpendingReader;
let versions: InMemoryVersionReader;
let store: InMemoryAlertStore;
let createBudget: CreateBudget;
let evaluate: EvaluateBudgetAlerts;

function build(alertStore: BudgetAlertStore = store) {
  const deps = {
    budgets: repo,
    categories,
    clock,
    timeZones: new FakeUserTimeZone(),
    versions,
    spending: reader,
  };
  createBudget = new CreateBudget(deps);
  evaluate = new EvaluateBudgetAlerts({ ...deps, alerts: alertStore });
}

beforeEach(() => {
  categories = new FakeCategories();
  repo = new InMemoryBudgetRepository(categories);
  clock = new FixedClock(OCTOBER);
  reader = new FakeSpendingReader();
  versions = new InMemoryVersionReader(repo, categories);
  store = new InMemoryAlertStore();
  build();
});

async function budget(
  owner: string,
  categoryIds: string[],
  over: Partial<CreateBudgetRequest> = {},
) {
  return createBudget.execute(await writeScopeFor(owner), {
    name: 'Outings',
    amount: '15000000',
    currency: 'ARS',
    rollover: false,
    thresholds: [80, 100],
    categoryIds,
    ...over,
  });
}

function row(categoryId: string, sum: bigint, over: Partial<BucketedPersonalRow> = {}) {
  return {
    bucket: 'current' as const,
    categoryId,
    currency: 'ARS' as const,
    rate: 15000000n,
    sum,
    count: 1,
    ...over,
  };
}

function spend(owner: string, categoryId: string, sum: bigint) {
  reader.personal.set(owner, [row(categoryId, sum)]);
}

async function run(owner: string, categoryId: string, occurredAt = IN_OCTOBER) {
  await evaluate.execute(await writeScopeFor(owner), { categoryId, occurredAt });
}

describe('EvaluateBudgetAlerts', () => {
  it('yields one crossing for 80 and none for 100 when a 150,000.00 ARS budget reaches 80% (AC-01)', async () => {
    const food = categories.add(ALICE, { name: 'Outings' });
    const created = await budget(ALICE, [food.id]);
    spend(ALICE, food.id, 12000000n);

    await run(ALICE, food.id);

    expect(store.calls).toHaveLength(1);
    expect(store.calls[0]?.userId).toBe(ALICE);
    expect(store.calls[0]?.crossings).toEqual([
      { budgetId: created.id, budgetName: 'Outings', month: '2026-10-01', threshold: 80 },
    ]);
  });

  it('crosses 80 and 100 from 70% to 110%, and only 50 of [50, 90] at 55% (AC-02, AC-03)', async () => {
    const food = categories.add(ALICE, { name: 'Outings' });
    await budget(ALICE, [food.id]);
    spend(ALICE, food.id, 16500000n);
    await run(ALICE, food.id);
    expect(store.calls[0]?.crossings.map((c) => c.threshold)).toEqual([80, 100]);

    const other = categories.add(BOB, { name: 'Other' });
    await budget(BOB, [other.id], { thresholds: [50, 90] });
    spend(BOB, other.id, 8250000n);
    await run(BOB, other.id);
    expect(store.calls[1]?.crossings.map((c) => c.threshold)).toEqual([50]);
  });

  it('compares against the available amount with rollover (AC-04)', async () => {
    const food = categories.add(ALICE, { name: 'Outings' });
    clock.current = new Date('2026-09-10T15:00:00Z');
    await budget(ALICE, [food.id], { rollover: true });
    clock.current = OCTOBER;
    // September left 2,000,000 over; October spent 13,600,000 of 17,000,000 available.
    reader.personal.set(ALICE, [
      row(food.id, 13600000n),
      row(food.id, 13000000n, { bucket: 'previous' }),
    ]);

    await run(ALICE, food.id);

    expect(store.calls[0]?.crossings.map((c) => c.threshold)).toEqual([80]);
  });

  it('publishes nothing new when the 80 mark exists and spending stays at 85% (AC-05)', async () => {
    const food = categories.add(ALICE, { name: 'Outings' });
    await budget(ALICE, [food.id]);
    spend(ALICE, food.id, 12000000n);
    await run(ALICE, food.id);
    spend(ALICE, food.id, 12750000n);
    await run(ALICE, food.id);

    expect(store.published).toHaveLength(1);
  });

  it('evaluates nothing and reads nothing for a past or a future month (AC-10)', async () => {
    const food = categories.add(ALICE, { name: 'Outings' });
    await budget(ALICE, [food.id]);
    spend(ALICE, food.id, 20000000n);

    await run(ALICE, food.id, new Date('2026-09-20T15:00:00Z'));
    await run(ALICE, food.id, new Date('2026-12-20T15:00:00Z'));

    expect(store.calls).toHaveLength(0);
    expect(versions.calls).toHaveLength(0);
    expect(reader.personalCalls).toHaveLength(0);
    expect(reader.shareCalls).toHaveLength(0);
  });

  it('uses the zone of the user: 2026-11-01T01:00Z is still October in Buenos Aires (AC-11)', async () => {
    const food = categories.add(ALICE, { name: 'Outings' });
    await budget(ALICE, [food.id]);
    spend(ALICE, food.id, 12000000n);

    await run(ALICE, food.id, new Date('2026-11-01T01:00:00Z'));

    expect(store.published.map((c) => c.month)).toEqual(['2026-10-01']);
  });

  it('catches up a missed crossing at the next evaluation (AC-09)', async () => {
    const food = categories.add(ALICE, { name: 'Outings' });
    await budget(ALICE, [food.id]);
    spend(ALICE, food.id, 13500000n);

    await run(ALICE, food.id);

    expect(store.published.map((c) => c.threshold)).toEqual([80]);
  });

  it('does not alert again after a fall and a new rise, and alerts again in a new month (AC-12, AC-14)', async () => {
    const food = categories.add(ALICE, { name: 'Outings' });
    await budget(ALICE, [food.id]);
    spend(ALICE, food.id, 12000000n);
    await run(ALICE, food.id);
    spend(ALICE, food.id, 6000000n);
    await run(ALICE, food.id);
    spend(ALICE, food.id, 12000000n);
    await run(ALICE, food.id);
    expect(store.published).toHaveLength(1);

    clock.current = NOVEMBER;
    spend(ALICE, food.id, 12000000n);
    await run(ALICE, food.id, new Date('2026-11-05T15:00:00Z'));

    expect(store.published.map((c) => c.month)).toEqual(['2026-10-01', '2026-11-01']);
  });

  it('reads only the budgets that cover the category and never another owner (AC-19)', async () => {
    const food = categories.add(ALICE, { name: 'Outings' });
    const rent = categories.add(ALICE, { name: 'Rent' });
    const bobFood = categories.add(BOB, { name: 'Outings' });
    await budget(ALICE, [food.id]);
    await budget(ALICE, [rent.id], { name: 'Rent', rollover: true });
    await budget(BOB, [bobFood.id]);
    reader.personal.set(ALICE, [row(food.id, 12000000n), row(rent.id, 15000000n)]);
    spend(BOB, bobFood.id, 15000000n);

    await run(ALICE, food.id);

    expect(store.calls[0]?.userId).toBe(ALICE);
    expect(store.published.map((c) => c.budgetName)).toEqual(['Outings']);
    expect(reader.personalCalls).toHaveLength(1);
    expect(reader.personalCalls[0]?.categoryIds).toEqual([food.id]);
    expect(reader.personalCalls[0]?.window.previous).toBeNull();
  });

  it('reads the previous month when a covering budget has rollover on and a version then', async () => {
    const food = categories.add(ALICE, { name: 'Outings' });
    clock.current = new Date('2026-09-10T15:00:00Z');
    await budget(ALICE, [food.id], { rollover: true });
    clock.current = OCTOBER;
    spend(ALICE, food.id, 1n);

    await run(ALICE, food.id);

    expect(reader.personalCalls[0]?.window.previous).not.toBeNull();
  });

  it('does not call the store when nothing is crossed', async () => {
    const food = categories.add(ALICE, { name: 'Outings' });
    await budget(ALICE, [food.id]);
    spend(ALICE, food.id, 1000000n);

    await run(ALICE, food.id);

    expect(store.calls).toHaveLength(0);
  });

  it('publishes a lowered amount as a new crossing without repeating a mark (AC-21)', async () => {
    const food = categories.add(ALICE, { name: 'Outings' });
    const created = await budget(ALICE, [food.id], { thresholds: [50, 80] });
    spend(ALICE, food.id, 8000000n);
    await run(ALICE, food.id);
    expect(store.published.map((c) => c.threshold)).toEqual([50]);

    const version = repo.rows.get(created.id)?.versions[0];
    if (!version) throw new Error('missing version');
    version.amount = 10000000n;
    await run(ALICE, food.id);

    expect(store.published.map((c) => c.threshold)).toEqual([50, 80]);
  });

  it('rethrows an error of the store and of a reader (AC-18)', async () => {
    const food = categories.add(ALICE, { name: 'Outings' });
    await budget(ALICE, [food.id]);
    spend(ALICE, food.id, 12000000n);
    build({ publish: () => Promise.reject(new Error('store down')) });
    await expect(run(ALICE, food.id)).rejects.toThrow('store down');

    build();
    reader.personalSpending = () => Promise.reject(new Error('read down'));
    await expect(run(ALICE, food.id)).rejects.toThrow('read down');
  });

  it('fires 80 in the month of the statement when a card purchase from September crosses it (AC-11)', async () => {
    const food = categories.add(ALICE, { name: 'Outings' });
    const created = await budget(ALICE, [food.id]);
    // The September statement is due 5 Oct: 120,000.00 of a 150,000.00 budget is 80%.
    reader.cardPurchases.set(ALICE, [cardPurchaseRow(food.id, { sum: 12000000n })]);

    await run(ALICE, food.id);

    expect(store.calls[0]?.crossings).toEqual([
      { budgetId: created.id, budgetName: 'Outings', month: '2026-10-01', threshold: 80 },
    ]);
  });

  it('fires nothing in September for a card purchase that the statement moves to October (AC-11)', async () => {
    const food = categories.add(ALICE, { name: 'Outings' });
    clock.current = new Date('2026-09-10T15:00:00Z');
    await budget(ALICE, [food.id]);
    reader.cardPurchases.set(ALICE, [cardPurchaseRow(food.id, { sum: 12000000n })]);

    await run(ALICE, food.id, new Date('2026-09-09T15:00:00Z'));

    expect(store.calls).toHaveLength(0);
  });
});

describe('computeSpending without a category filter', () => {
  it('still lists every budget of the owner', async () => {
    const food = categories.add(ALICE, { name: 'Outings' });
    const rent = categories.add(ALICE, { name: 'Rent' });
    await budget(ALICE, [food.id]);
    await budget(ALICE, [rent.id], { name: 'Rent' });
    const list = new ListBudgetSpending({
      clock,
      timeZones: new FakeUserTimeZone(),
      versions,
      spending: reader,
    });

    const result = await list.execute(await readScopeFor(ALICE));

    expect(result.budgets.map((b) => b.name)).toEqual(['Outings', 'Rent']);
  });
});

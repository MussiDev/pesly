import { beforeEach, describe, expect, it } from 'vitest';
import { budgetSpendingResponseSchema, type CreateBudgetRequest } from '@pesly/shared';
import {
  BudgetMonthInFuture,
  CreateBudget,
  GetBudgetSpending,
  ListBudgetSpending,
  UpdateBudget,
} from '../../src/budgets';
import type {
  BucketedPersonalRow,
  BucketedShareRow,
} from '../../src/budgets/application/ports/spending-reader';
import { cardPurchaseRow, installmentRow } from './spending-fixtures';
import { ResourceNotFound } from '../../src/shared/access';
import {
  FakeCategories,
  FakeSpendingReader,
  FakeUserTimeZone,
  FixedClock,
  InMemoryBudgetRepository,
  InMemoryVersionReader,
  readScopeFor,
  writeScopeFor,
} from './fakes';

const ALICE = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';
const MISSING = '33333333-3333-4333-8333-333333333333';

const SEPTEMBER = new Date('2026-09-15T15:00:00Z');
const OCTOBER = new Date('2026-10-06T16:00:00Z');

let categories: FakeCategories;
let repo: InMemoryBudgetRepository;
let clock: FixedClock;
let reader: FakeSpendingReader;
let versions: InMemoryVersionReader;
let createBudget: CreateBudget;
let updateBudget: UpdateBudget;
let list: ListBudgetSpending;
let get: GetBudgetSpending;

beforeEach(() => {
  categories = new FakeCategories();
  repo = new InMemoryBudgetRepository(categories);
  clock = new FixedClock(OCTOBER);
  reader = new FakeSpendingReader();
  versions = new InMemoryVersionReader(repo, categories);
  const deps = {
    budgets: repo,
    categories,
    clock,
    timeZones: new FakeUserTimeZone(),
    versions,
    spending: reader,
  };
  createBudget = new CreateBudget(deps);
  updateBudget = new UpdateBudget(deps);
  list = new ListBudgetSpending(deps);
  get = new GetBudgetSpending(deps);
});

async function budget(
  owner: string,
  categoryIds: string[],
  over: Partial<CreateBudgetRequest> = {},
  now: Date = OCTOBER,
) {
  clock.current = now;
  const created = await createBudget.execute(await writeScopeFor(owner), {
    name: 'Groceries',
    amount: '15000000',
    currency: 'ARS',
    rollover: false,
    thresholds: [80, 100],
    categoryIds,
    ...over,
  });
  clock.current = OCTOBER;
  return created;
}

function personal(
  categoryId: string,
  sum: bigint,
  over: Partial<BucketedPersonalRow> = {},
): BucketedPersonalRow {
  return {
    bucket: 'current',
    categoryId,
    currency: 'ARS',
    rate: 15000000n,
    sum,
    count: 1,
    ...over,
  };
}

function share(
  categoryName: string | null,
  sum: bigint,
  over: Partial<BucketedShareRow> = {},
): BucketedShareRow {
  return {
    bucket: 'current',
    categoryName,
    categoryDefaultKey: null,
    currency: 'ARS',
    rate: null,
    sum,
    count: 1,
    ...over,
  };
}

describe('budget spending use cases', () => {
  it('gives two budgets their own spending from one call of each reader (AC-01, AC-24)', async () => {
    const food = categories.add(ALICE, { name: 'Food' });
    const rent = categories.add(ALICE, { name: 'Rent' });
    await budget(ALICE, [food.id]);
    await budget(ALICE, [rent.id], { name: 'Rent' });
    reader.personal.set(ALICE, [personal(food.id, 5000000n), personal(rent.id, 2000000n)]);
    reader.shares.set(ALICE, [share('food', 1000000n)]);

    const result = await list.execute(await readScopeFor(ALICE));

    expect(result.month).toBe('2026-10');
    expect(result.budgets.map((b) => [b.name, b.spent])).toEqual([
      ['Groceries', 6000000n],
      ['Rent', 2000000n],
    ]);
    expect(reader.personalCalls).toHaveLength(1);
    expect(reader.shareCalls).toHaveLength(1);
    expect(versions.calls).toHaveLength(1);
  });

  it('counts a row of a child category in a budget over its parent (AC-02)', async () => {
    const food = categories.add(ALICE, { name: 'Food' });
    const snacks = categories.add(ALICE, { name: 'Snacks', parentId: food.id });
    await budget(ALICE, [food.id]);
    reader.personal.set(ALICE, [personal(snacks.id, 700000n)]);

    const [only] = (await list.execute(await readScopeFor(ALICE))).budgets;
    expect(only?.spent).toBe(700000n);
  });

  it('uses the current month of the clock in the user zone when none is given (AC-15)', async () => {
    const food = categories.add(ALICE);
    await budget(ALICE, [food.id], {}, new Date('2026-09-10T12:00:00Z'));
    // 01:00 UTC on 2026-10-01 is still 2026-09-30 in Buenos Aires.
    clock.current = new Date('2026-10-01T01:00:00Z');
    const result = await list.execute(await readScopeFor(ALICE));
    expect(result.month).toBe('2026-09');
    expect(result.budgets).toHaveLength(1);
  });

  it('rejects a month later than the current one and calls no reader (AC-16)', async () => {
    const food = categories.add(ALICE);
    await budget(ALICE, [food.id]);
    const scope = await readScopeFor(ALICE);
    await expect(list.execute(scope, '2026-11')).rejects.toBeInstanceOf(BudgetMonthInFuture);
    await expect(get.execute(scope, MISSING, '2027-01')).rejects.toBeInstanceOf(
      BudgetMonthInFuture,
    );
    expect(versions.calls).toHaveLength(0);
    expect(reader.personalCalls).toHaveLength(0);
    expect(reader.shareCalls).toHaveLength(0);
  });

  it('accepts the current month explicitly and any past month (AC-16)', async () => {
    const food = categories.add(ALICE);
    await budget(ALICE, [food.id]);
    const scope = await readScopeFor(ALICE);
    expect((await list.execute(scope, '2026-10')).budgets).toHaveLength(1);
    expect((await list.execute(scope, '2020-01')).budgets).toEqual([]);
  });

  it('leaves out a budget that did not exist yet and answers 404 by id (AC-17)', async () => {
    const food = categories.add(ALICE);
    const created = await budget(ALICE, [food.id]);
    const scope = await readScopeFor(ALICE);
    expect((await list.execute(scope, '2026-09')).budgets).toEqual([]);
    await expect(get.execute(scope, created.id, '2026-09')).rejects.toBeInstanceOf(
      ResourceNotFound,
    );
  });

  it('returns remaining and percent for under and over spending (AC-13, AC-14)', async () => {
    const food = categories.add(ALICE);
    const created = await budget(ALICE, [food.id]);
    const scope = await readScopeFor(ALICE);

    reader.personal.set(ALICE, [personal(food.id, 12000000n)]);
    const under = await get.execute(scope, created.id);
    expect([under.remaining, under.percentUsed]).toEqual([3000000n, 80]);

    reader.personal.set(ALICE, [personal(food.id, 18000000n)]);
    const over = await get.execute(scope, created.id);
    expect([over.remaining, over.percentUsed]).toEqual([-3000000n, 120]);
  });

  it('returns spent 0 and remaining equal to available with no rows (AC-05)', async () => {
    const food = categories.add(ALICE);
    const created = await budget(ALICE, [food.id]);
    const result = await get.execute(await readScopeFor(ALICE), created.id);
    expect(result).toMatchObject({
      spent: 0n,
      remaining: 15000000n,
      available: 15000000n,
      percentUsed: 0,
      rolloverAmount: 0n,
      unconvertedShareCount: 0,
      unconvertedInstallmentCount: 0,
    });
  });

  it('carries the leftover of the previous month when rollover is on (AC-18)', async () => {
    const food = categories.add(ALICE);
    const created = await budget(ALICE, [food.id], { rollover: true }, SEPTEMBER);
    reader.personal.set(ALICE, [
      personal(food.id, 13000000n, { bucket: 'previous' }),
      personal(food.id, 1000000n),
    ]);
    const result = await get.execute(await readScopeFor(ALICE), created.id);
    expect(result).toMatchObject({
      rolloverAmount: 2000000n,
      available: 17000000n,
      spent: 1000000n,
      remaining: 16000000n,
    });
    expect(reader.personalCalls[0]?.window.previous).not.toBeNull();
  });

  it('carries nothing after an overspend, with rollover off or with no previous version (AC-19, AC-20, AC-22)', async () => {
    const food = categories.add(ALICE);
    const scope = await readScopeFor(ALICE);
    const over = await budget(ALICE, [food.id], { rollover: true }, SEPTEMBER);
    reader.personal.set(ALICE, [personal(food.id, 16000000n, { bucket: 'previous' })]);
    expect((await get.execute(scope, over.id)).available).toBe(15000000n);

    const off = await budget(ALICE, [food.id], { rollover: false }, SEPTEMBER);
    reader.personal.set(ALICE, [personal(food.id, 1000000n, { bucket: 'previous' })]);
    expect((await get.execute(scope, off.id)).rolloverAmount).toBe(0n);

    const fresh = await budget(ALICE, [food.id], { rollover: true }, OCTOBER);
    expect((await get.execute(scope, fresh.id)).rolloverAmount).toBe(0n);
  });

  it('does not read the previous month when no budget has rollover on (NFR-01)', async () => {
    const food = categories.add(ALICE);
    await budget(ALICE, [food.id], { rollover: false }, SEPTEMBER);
    await list.execute(await readScopeFor(ALICE));
    expect(reader.personalCalls[0]?.window.previous).toBeNull();
    expect(reader.shareCalls[0]?.window.previous).toBeNull();
  });

  it('uses the version and categories of September when asked for September (AC-06)', async () => {
    const food = categories.add(ALICE, { name: 'Food' });
    const fun = categories.add(ALICE, { name: 'Fun' });
    const created = await budget(ALICE, [food.id], {}, SEPTEMBER);
    await updateBudget.execute(await writeScopeFor(ALICE), created.id, {
      amount: '20000000',
      categoryIds: [fun.id],
    });
    reader.personal.set(ALICE, [personal(food.id, 1000000n), personal(fun.id, 4000000n)]);
    const scope = await readScopeFor(ALICE);

    const september = await get.execute(scope, created.id, '2026-09');
    expect([september.amount, september.spent]).toEqual([15000000n, 1000000n]);
    const october = await get.execute(scope, created.id, '2026-10');
    expect([october.amount, october.spent]).toEqual([20000000n, 4000000n]);
  });

  it('reports an unconvertible foreign share and leaves it out of the sum (AC-12)', async () => {
    const food = categories.add(ALICE, { name: 'Food' });
    const created = await budget(ALICE, [food.id]);
    reader.shares.set(ALICE, [
      share('Food', 2000n, { currency: 'USD', rate: null }),
      share('Food', 2000n, { currency: 'USD', rate: 15000000n }),
    ]);
    const result = await get.execute(await readScopeFor(ALICE), created.id);
    expect(result.unconvertedShareCount).toBe(1);
    expect(result.spent).toBe(3000000n);
  });

  it('answers 404 for a budget of another user and calls no spending reader (AC-23)', async () => {
    const food = categories.add(ALICE);
    const created = await budget(ALICE, [food.id]);
    const scope = await readScopeFor(BOB);
    await expect(get.execute(scope, created.id)).rejects.toBeInstanceOf(ResourceNotFound);
    await expect(get.execute(scope, MISSING)).rejects.toBeInstanceOf(ResourceNotFound);
    expect(reader.personalCalls).toHaveLength(0);
    expect(reader.shareCalls).toHaveLength(0);
  });

  it('lists only the budgets of the caller (AC-24)', async () => {
    const mine = categories.add(ALICE);
    const theirs = categories.add(BOB);
    const own = await budget(ALICE, [mine.id]);
    await budget(BOB, [theirs.id]);
    const result = await list.execute(await readScopeFor(ALICE));
    expect(result.budgets.map((b) => b.budgetId)).toEqual([own.id]);
  });

  it('produces values the wire contract accepts, with a signed remaining (AC-28)', async () => {
    const food = categories.add(ALICE);
    const created = await budget(ALICE, [food.id]);
    reader.personal.set(ALICE, [personal(food.id, 18000000n)]);
    const result = await get.execute(await readScopeFor(ALICE), created.id);
    const wire = budgetSpendingResponseSchema.parse({
      ...result,
      amount: result.amount.toString(),
      rolloverAmount: result.rolloverAmount.toString(),
      available: result.available.toString(),
      spent: result.spent.toString(),
      remaining: result.remaining.toString(),
    });
    expect(wire.remaining).toBe('-3000000');
    expect(wire.thresholds).toEqual([80, 100]);
  });
});

describe('budget spending with credit card statements', () => {
  // The September statement (closing 24 Sep) is due on 5 Oct, so its rows belong to October.
  it('counts the September-dated purchase and the first installment in October (AC-01, AC-02)', async () => {
    const food = categories.add(ALICE, { name: 'Food' });
    const created = await budget(ALICE, [food.id]);
    reader.cardPurchases.set(ALICE, [cardPurchaseRow(food.id, { sum: 3000000n })]);
    reader.installments.set(ALICE, [installmentRow(food.id, { sum: 1000000n })]);
    reader.personal.set(ALICE, [personal(food.id, 500000n)]);

    const result = await get.execute(await readScopeFor(ALICE), created.id);

    expect(result.spent).toBe(4500000n);
    expect(reader.cardPurchaseCalls).toHaveLength(1);
    expect(reader.cardPurchaseCalls[0]?.timeZone).toBe('America/Argentina/Buenos_Aires');
    expect(reader.installmentCalls).toHaveLength(1);
  });

  it('counts a purchase once across September and October: the two months add to the purchase (AC-07)', async () => {
    const food = categories.add(ALICE, { name: 'Food' });
    const created = await budget(ALICE, [food.id], {}, SEPTEMBER);
    const scope = await readScopeFor(ALICE);
    reader.cardPurchases.set(ALICE, [
      // Due 5 Sep (August statement) and due 5 Oct (September statement).
      cardPurchaseRow(food.id, { sum: 2000000n, period: '2026-08', dueDate: '2026-09-05' }),
      cardPurchaseRow(food.id, { sum: 3000000n }),
    ]);

    const september = await get.execute(scope, created.id, '2026-09');
    const october = await get.execute(scope, created.id, '2026-10');

    expect([september.spent, october.spent]).toEqual([2000000n, 3000000n]);
    expect(september.spent + october.spent).toBe(5000000n);
  });

  it('computes the due month from the card days when no statement is stored (AC-05)', async () => {
    const food = categories.add(ALICE, { name: 'Food' });
    const created = await budget(ALICE, [food.id]);
    reader.cardPurchases.set(ALICE, [cardPurchaseRow(food.id, { dueDate: null })]);
    const result = await get.execute(await readScopeFor(ALICE), created.id);
    expect(result.spent).toBe(3000000n);
  });

  it('ignores a statement row due in neither the month nor the previous one', async () => {
    const food = categories.add(ALICE, { name: 'Food' });
    const created = await budget(ALICE, [food.id], { rollover: true }, SEPTEMBER);
    reader.cardPurchases.set(ALICE, [
      cardPurchaseRow(food.id, { period: '2026-07', dueDate: '2026-08-05' }),
      cardPurchaseRow(food.id, { period: '2026-10', dueDate: '2026-11-05' }),
    ]);
    reader.installments.set(ALICE, [
      installmentRow(food.id, { period: '2026-07', dueDate: '2026-08-05' }),
    ]);

    const result = await get.execute(await readScopeFor(ALICE), created.id);

    expect([result.spent, result.rolloverAmount]).toEqual([0n, 15000000n]);
  });

  it('puts a row due last month in the previous bucket, so rollover carries its leftover (AC-10)', async () => {
    const food = categories.add(ALICE, { name: 'Food' });
    const created = await budget(ALICE, [food.id], { rollover: true }, SEPTEMBER);
    reader.cardPurchases.set(ALICE, [
      cardPurchaseRow(food.id, { sum: 13000000n, period: '2026-08', dueDate: '2026-09-05' }),
      cardPurchaseRow(food.id, { sum: 1000000n }),
    ]);

    const result = await get.execute(await readScopeFor(ALICE), created.id);

    expect(result).toMatchObject({
      rolloverAmount: 2000000n,
      available: 17000000n,
      spent: 1000000n,
      remaining: 16000000n,
    });
  });

  it('does not count a previous-month statement row when no budget carries a rollover', async () => {
    const food = categories.add(ALICE, { name: 'Food' });
    const created = await budget(ALICE, [food.id], { rollover: false }, SEPTEMBER);
    reader.cardPurchases.set(ALICE, [
      cardPurchaseRow(food.id, { sum: 13000000n, period: '2026-08', dueDate: '2026-09-05' }),
    ]);
    const result = await get.execute(await readScopeFor(ALICE), created.id);
    expect([result.spent, result.rolloverAmount]).toEqual([0n, 0n]);
  });

  it('reports a USD installment in an ARS budget as not converted and leaves it out (AC-27)', async () => {
    const food = categories.add(ALICE, { name: 'Food' });
    const created = await budget(ALICE, [food.id]);
    reader.installments.set(ALICE, [
      installmentRow(food.id, { sum: 500000n }),
      installmentRow(food.id, { currency: 'USD', sum: 1000n, count: 2 }),
    ]);

    const result = await get.execute(await readScopeFor(ALICE), created.id);

    expect([result.spent, result.unconvertedInstallmentCount]).toEqual([500000n, 2]);
    const wire = budgetSpendingResponseSchema.parse({
      ...result,
      amount: result.amount.toString(),
      rolloverAmount: result.rolloverAmount.toString(),
      available: result.available.toString(),
      spent: result.spent.toString(),
      remaining: result.remaining.toString(),
    });
    expect(wire.unconvertedInstallmentCount).toBe(2);
  });

  it('counts the installments left out only for the current month', async () => {
    const food = categories.add(ALICE, { name: 'Food' });
    const created = await budget(ALICE, [food.id], { rollover: true }, SEPTEMBER);
    reader.installments.set(ALICE, [
      installmentRow(food.id, { currency: 'USD', period: '2026-08', dueDate: '2026-09-05' }),
    ]);
    const result = await get.execute(await readScopeFor(ALICE), created.id);
    expect(result.unconvertedInstallmentCount).toBe(0);
  });

  it('answers 404 for a budget of another user and reads no card rows (AC-23)', async () => {
    const food = categories.add(ALICE);
    const created = await budget(ALICE, [food.id]);
    await expect(get.execute(await readScopeFor(BOB), created.id)).rejects.toBeInstanceOf(
      ResourceNotFound,
    );
    expect(reader.cardPurchaseCalls).toHaveLength(0);
    expect(reader.installmentCalls).toHaveLength(0);
  });

  it('rejects a future month and reads no card rows', async () => {
    const food = categories.add(ALICE);
    await budget(ALICE, [food.id]);
    await expect(list.execute(await readScopeFor(ALICE), '2026-11')).rejects.toBeInstanceOf(
      BudgetMonthInFuture,
    );
    expect(reader.cardPurchaseCalls).toHaveLength(0);
    expect(reader.installmentCalls).toHaveLength(0);
  });
});

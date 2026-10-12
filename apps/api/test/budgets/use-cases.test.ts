import { beforeEach, describe, expect, it } from 'vitest';
import {
  type AppError,
  createBudgetRequestSchema,
  updateBudgetRequestSchema,
  type CreateBudgetRequest,
} from '@pesly/shared';
import {
  BudgetCategoryKindInvalid,
  BudgetLimitReached,
  CreateBudget,
  DeleteBudget,
  GetBudget,
  ListBudgets,
  UpdateBudget,
} from '../../src/budgets';
import { CategoryArchived } from '../../src/movements/domain/errors';
import { ResourceNotFound } from '../../src/shared/access';
import {
  FakeCategories,
  FakeUserTimeZone,
  FixedClock,
  InMemoryBudgetRepository,
  readScopeFor,
  writeScopeFor,
} from './fakes';

const ALICE = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';
const MISSING = '33333333-3333-4333-8333-333333333333';

let categories: FakeCategories;
let repo: InMemoryBudgetRepository;
let clock: FixedClock;
let createBudget: CreateBudget;
let listBudgets: ListBudgets;
let getBudget: GetBudget;
let updateBudget: UpdateBudget;
let deleteBudget: DeleteBudget;

beforeEach(() => {
  categories = new FakeCategories();
  repo = new InMemoryBudgetRepository(categories);
  // 2026-09-15 noon in Buenos Aires.
  clock = new FixedClock(new Date('2026-09-15T15:00:00Z'));
  const deps = { budgets: repo, categories, clock, timeZones: new FakeUserTimeZone() };
  createBudget = new CreateBudget(deps);
  listBudgets = new ListBudgets(deps);
  getBudget = new GetBudget(deps);
  updateBudget = new UpdateBudget(deps);
  deleteBudget = new DeleteBudget(deps);
});

function body(categoryIds: string[], overrides: Partial<CreateBudgetRequest> = {}) {
  return {
    name: 'Outings',
    amount: '15000000',
    currency: 'ARS' as const,
    categoryIds,
    ...overrides,
  };
}

async function create(userId: string, overrides: Partial<CreateBudgetRequest> = {}) {
  const cat = categories.add(userId);
  return createBudget.execute(await writeScopeFor(userId), body([cat.id], overrides));
}

describe('CreateBudget', () => {
  it('stores 150,000.00 ARS over two categories and lists it (AC-01)', async () => {
    const a = categories.add(ALICE);
    const b = categories.add(ALICE);
    const created = await createBudget.execute(await writeScopeFor(ALICE), body([a.id, b.id]));
    expect(created.version.amount).toBe(15000000n);
    expect(created.currency).toBe('ARS');
    expect(created.version.categoryIds).toEqual([a.id, b.id]);
    const list = await listBudgets.execute(await readScopeFor(ALICE));
    expect(list.map((item) => item.id)).toEqual([created.id]);
  });

  it('rejects an invalid body before any write (AC-02)', () => {
    const cat = '0b0f6f0e-8c1d-4c8e-9a53-3d1f2a9c5b11';
    const bad = [
      body([]),
      body([cat], { amount: '0' }),
      body([cat], { name: '' }),
      body([cat], { currency: 'EUR' as 'ARS' }),
    ];
    for (const input of bad) {
      expect(createBudgetRequestSchema.safeParse(input).success).toBe(false);
    }
    expect(repo.rows.size).toBe(0);
  });

  it('answers 404 for an unknown or foreign category and stores nothing (AC-03)', async () => {
    const foreign = categories.add(BOB);
    const scope = await writeScopeFor(ALICE);
    await expect(createBudget.execute(scope, body([foreign.id]))).rejects.toBeInstanceOf(
      ResourceNotFound,
    );
    const mine = categories.add(ALICE);
    await expect(createBudget.execute(scope, body([mine.id, MISSING]))).rejects.toBeInstanceOf(
      ResourceNotFound,
    );
    expect(repo.rows.size).toBe(0);
  });

  it('rejects an income category with a 400 error (AC-04)', async () => {
    const income = categories.add(ALICE, { kind: 'income' });
    const error = await createBudget
      .execute(await writeScopeFor(ALICE), body([income.id]))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BudgetCategoryKindInvalid);
    expect((error as AppError).code).toBe('BUDGET_CATEGORY_KIND_INVALID');
    expect(repo.rows.size).toBe(0);
  });

  it('rejects an archived category with a 409 conflict (AC-05)', async () => {
    const archived = categories.add(ALICE, { archived: true });
    await expect(
      createBudget.execute(await writeScopeFor(ALICE), body([archived.id])),
    ).rejects.toBeInstanceOf(CategoryArchived);
    expect(repo.rows.size).toBe(0);
  });

  it('defaults rollover to off and keeps an explicit on (AC-07, AC-08)', async () => {
    expect((await create(ALICE)).version.rollover).toBe(false);
    const on = await create(ALICE, { rollover: true });
    expect(on.version.rollover).toBe(true);
    expect((await getBudget.execute(await readScopeFor(ALICE), on.id)).version.rollover).toBe(true);
  });

  it('stores 80 and 100 by default and sorts explicit thresholds (AC-09, AC-10)', async () => {
    expect((await create(ALICE)).version.thresholds).toEqual([80, 100]);
    expect((await create(ALICE, { thresholds: [120, 50, 80] })).version.thresholds).toEqual([
      50, 80, 120,
    ]);
  });

  it('accepts five thresholds and rejects a sixth (AC-22)', async () => {
    expect(
      (await create(ALICE, { thresholds: [10, 20, 30, 40, 50] })).version.thresholds,
    ).toHaveLength(5);
    expect(
      createBudgetRequestSchema.safeParse(body([MISSING], { thresholds: [10, 20, 30, 40, 50, 60] }))
        .success,
    ).toBe(false);
  });

  it('covers the children of a parent, including one added later (AC-06)', async () => {
    const food = categories.add(ALICE);
    const child = categories.add(ALICE, { parentId: food.id });
    const created = await createBudget.execute(await writeScopeFor(ALICE), body([food.id]));
    expect(created.version.categoryIds).toEqual([food.id]);
    expect([...created.coveredCategoryIds].sort()).toEqual([food.id, child.id].sort());
    const later = categories.add(ALICE, { parentId: food.id });
    const read = await getBudget.execute(await readScopeFor(ALICE), created.id);
    expect(read.coveredCategoryIds).toContain(later.id);
  });

  it('writes the first version at the first day of the local month', async () => {
    expect((await create(ALICE)).version.effectiveFrom).toBe('2026-09-01');
  });

  it('allows the 50th budget, rejects the 51st with 409; a delete frees a slot (AC-23, AC-24)', async () => {
    const cat = categories.add(ALICE);
    const scope = await writeScopeFor(ALICE);
    const ids: string[] = [];
    for (let i = 0; i < 50; i++) ids.push((await createBudget.execute(scope, body([cat.id]))).id);
    const error = await createBudget.execute(scope, body([cat.id])).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BudgetLimitReached);
    expect((error as AppError).code).toBe('BUDGET_LIMIT_REACHED');
    await deleteBudget.execute(scope, ids[0] as string);
    await expect(createBudget.execute(scope, body([cat.id]))).resolves.toBeDefined();
  });
});

describe('UpdateBudget', () => {
  it('an October amount edit leaves September untouched (AC-12)', async () => {
    const created = await create(ALICE);
    clock.current = new Date('2026-10-10T15:00:00Z');
    const updated = await updateBudget.execute(await writeScopeFor(ALICE), created.id, {
      amount: '20000000',
    });
    expect(updated.version.effectiveFrom).toBe('2026-10-01');
    expect(updated.version.amount).toBe(20000000n);
    expect(updated.version.name).toBe('Outings');
    const versions = repo.rows.get(created.id)?.versions ?? [];
    expect(versions.map((v) => v.effectiveFrom).sort()).toEqual(['2026-09-01', '2026-10-01']);
    expect(versions.find((v) => v.effectiveFrom === '2026-09-01')?.amount).toBe(15000000n);
  });

  it('categories, thresholds and rollover edits follow the same rule (AC-14)', async () => {
    const created = await create(ALICE);
    const other = categories.add(ALICE);
    clock.current = new Date('2026-10-10T15:00:00Z');
    const updated = await updateBudget.execute(await writeScopeFor(ALICE), created.id, {
      categoryIds: [other.id],
      thresholds: [90, 30],
      rollover: true,
    });
    expect(updated.version).toMatchObject({
      effectiveFrom: '2026-10-01',
      categoryIds: [other.id],
      thresholds: [30, 90],
      rollover: true,
    });
    const september = repo.rows
      .get(created.id)
      ?.versions.find((v) => v.effectiveFrom === '2026-09-01');
    expect(september).toMatchObject({ rollover: false, thresholds: [80, 100] });
  });

  it('two edits in the same month leave one version (AC-13)', async () => {
    const created = await create(ALICE);
    const scope = await writeScopeFor(ALICE);
    await updateBudget.execute(scope, created.id, { amount: '1' });
    await updateBudget.execute(scope, created.id, { amount: '2' });
    const versions = repo.rows.get(created.id)?.versions ?? [];
    expect(versions).toHaveLength(1);
    expect(versions[0]?.amount).toBe(2n);
  });

  it('an edit that changes nothing still writes the version of the month', async () => {
    const created = await create(ALICE);
    clock.current = new Date('2026-10-10T15:00:00Z');
    const updated = await updateBudget.execute(await writeScopeFor(ALICE), created.id, {
      name: 'Outings',
    });
    expect(updated.version.effectiveFrom).toBe('2026-10-01');
    expect(repo.rows.get(created.id)?.versions).toHaveLength(2);
  });

  it('at 23:30 local on the last day, where UTC is next month, writes the local month (AC-12)', async () => {
    const created = await create(ALICE);
    clock.current = new Date('2026-11-01T02:30:00Z'); // 2026-10-31 23:30 in Buenos Aires
    const updated = await updateBudget.execute(await writeScopeFor(ALICE), created.id, {
      amount: '5',
    });
    expect(updated.version.effectiveFrom).toBe('2026-10-01');
  });

  it('rejects a foreign category and leaves the budget unchanged (AC-16)', async () => {
    const created = await create(ALICE);
    const foreign = categories.add(BOB);
    await expect(
      updateBudget.execute(await writeScopeFor(ALICE), created.id, { categoryIds: [foreign.id] }),
    ).rejects.toBeInstanceOf(ResourceNotFound);
    const stored = repo.rows.get(created.id)?.versions ?? [];
    expect(stored).toHaveLength(1);
    expect(stored[0]?.categoryIds).toEqual(created.version.categoryIds);
  });

  it('validates a changed category set like create (income, archived)', async () => {
    const created = await create(ALICE);
    const scope = await writeScopeFor(ALICE);
    const income = categories.add(ALICE, { kind: 'income' });
    const archived = categories.add(ALICE, { archived: true });
    await expect(
      updateBudget.execute(scope, created.id, { categoryIds: [income.id] }),
    ).rejects.toBeInstanceOf(BudgetCategoryKindInvalid);
    await expect(
      updateBudget.execute(scope, created.id, { categoryIds: [archived.id] }),
    ).rejects.toBeInstanceOf(CategoryArchived);
  });

  it('keeps an already-archived category when the set is not changed', async () => {
    const created = await create(ALICE);
    const first = categories.rows.get(created.version.categoryIds[0] as string);
    if (first) first.archived = true;
    await expect(
      updateBudget.execute(await writeScopeFor(ALICE), created.id, { amount: '9' }),
    ).resolves.toBeDefined();
  });

  it('rejects a body that sends a currency (AC-15)', () => {
    expect(updateBudgetRequestSchema.safeParse({ currency: 'USD' }).success).toBe(false);
  });

  it('answers 404 for a missing or foreign budget (AC-18)', async () => {
    const created = await create(BOB);
    const scope = await writeScopeFor(ALICE);
    await expect(updateBudget.execute(scope, created.id, { amount: '1' })).rejects.toBeInstanceOf(
      ResourceNotFound,
    );
    await expect(updateBudget.execute(scope, MISSING, { amount: '1' })).rejects.toBeInstanceOf(
      ResourceNotFound,
    );
  });
});

describe('Get, list and delete', () => {
  it('lists only the caller budgets (AC-19)', async () => {
    const mine = await create(ALICE);
    await create(BOB);
    const list = await listBudgets.execute(await readScopeFor(ALICE));
    expect(list.map((b) => b.id)).toEqual([mine.id]);
  });

  it('shows a budget whose first version is in a future month with that version', async () => {
    const created = await create(ALICE);
    clock.current = new Date('2026-08-10T15:00:00Z');
    const read = await getBudget.execute(await readScopeFor(ALICE), created.id);
    expect(read.version.effectiveFrom).toBe('2026-09-01');
    const list = await listBudgets.execute(await readScopeFor(ALICE));
    expect(list[0]?.version.effectiveFrom).toBe('2026-09-01');
  });

  it('deletes a budget (AC-17)', async () => {
    const created = await create(ALICE);
    await deleteBudget.execute(await writeScopeFor(ALICE), created.id);
    expect(repo.rows.size).toBe(0);
    await expect(getBudget.execute(await readScopeFor(ALICE), created.id)).rejects.toBeInstanceOf(
      ResourceNotFound,
    );
  });

  it('answers 404 reading or deleting a foreign or missing budget (AC-18)', async () => {
    const created = await create(BOB);
    await expect(getBudget.execute(await readScopeFor(ALICE), created.id)).rejects.toBeInstanceOf(
      ResourceNotFound,
    );
    await expect(
      deleteBudget.execute(await writeScopeFor(ALICE), created.id),
    ).rejects.toBeInstanceOf(ResourceNotFound);
    expect(repo.rows.size).toBe(1);
  });
});

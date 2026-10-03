import { beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '@pesly/shared';
import {
  CreateMovement,
  type CategorizedMovementInput,
} from '../../src/movements/application/create-movement';
import {
  CategoryArchived,
  MovementAccountArchived,
  MovementCategoryKindMismatch,
  MovementDateInFuture,
  RateRequired,
} from '../../src/movements/domain/errors';
import { ResourceNotFound } from '../../src/shared/access';
import {
  FakeRateLookup,
  FakeUserPreferences,
  InMemoryAccountLookup,
  InMemoryCategoryLookup,
  InMemoryMovementRepository,
  MutableClock,
  writeScopeFor,
} from './fakes';

const ALICE = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';
const UNKNOWN = '33333333-3333-4333-8333-333333333333';

let movements: InMemoryMovementRepository;
let accounts: InMemoryAccountLookup;
let categories: InMemoryCategoryLookup;
let rates: FakeRateLookup;
let preferences: FakeUserPreferences;
let clock: MutableClock;
let create: CreateMovement;

beforeEach(() => {
  movements = new InMemoryMovementRepository();
  accounts = new InMemoryAccountLookup();
  categories = new InMemoryCategoryLookup();
  rates = new FakeRateLookup();
  rates.sells.set('blue', 14_000_000n);
  rates.sells.set('oficial', 10_000_000n);
  preferences = new FakeUserPreferences();
  clock = new MutableClock(new Date('2026-10-02T12:00:00.000Z'));
  create = new CreateMovement({ movements, accounts, categories, rates, preferences, clock });
});

function input(
  overrides: Partial<CategorizedMovementInput> & { accountId: string; categoryId: string },
): CategorizedMovementInput {
  return {
    type: 'expense',
    amount: 1500n,
    occurredAt: new Date('2026-10-01T15:00:00.000Z'),
    rate: { source: 'automatic' },
    ...overrides,
  };
}

async function run(data: CategorizedMovementInput, userId = ALICE) {
  return create.execute(await writeScopeFor(userId), data);
}

describe('CreateMovement', () => {
  it('stores a valid expense and income with the owner of the scope', async () => {
    const account = accounts.seed(ALICE);
    const expenseCat = categories.seed(ALICE, 'expense');
    const incomeCat = categories.seed(ALICE, 'income');

    const expense = await run(input({ accountId: account, categoryId: expenseCat, note: 'lunch' }));
    const income = await run(input({ type: 'income', accountId: account, categoryId: incomeCat }));

    expect(expense).toMatchObject({
      ownerId: ALICE,
      type: 'expense',
      amount: 1500n,
      note: 'lunch',
    });
    expect(income).toMatchObject({ ownerId: ALICE, type: 'income', note: null });
    expect(movements.rows).toHaveLength(2);
  });

  it('stores an empty or whitespace-only note as null', async () => {
    const account = accounts.seed(ALICE);
    const category = categories.seed(ALICE, 'expense');

    for (const note of ['', '   ', ' \t ']) {
      const movement = await run(input({ accountId: account, categoryId: category, note }));
      expect(movement.note).toBeNull();
    }
    const kept = await run(input({ accountId: account, categoryId: category, note: ' hi ' }));
    expect(kept.note).toBe(' hi ');
  });

  it('rejects the wrong category kind and stores nothing', async () => {
    const account = accounts.seed(ALICE);
    const expenseCat = categories.seed(ALICE, 'expense');
    const incomeCat = categories.seed(ALICE, 'income');

    await expect(run(input({ accountId: account, categoryId: incomeCat }))).rejects.toBeInstanceOf(
      MovementCategoryKindMismatch,
    );
    await expect(
      run(input({ type: 'income', accountId: account, categoryId: expenseCat })),
    ).rejects.toMatchObject({ code: 'MOVEMENT_CATEGORY_KIND_MISMATCH' });
    expect(movements.rows).toHaveLength(0);
  });

  it('freezes the stored sell of the default rate type with source automatic', async () => {
    const account = accounts.seed(ALICE);
    const category = categories.seed(ALICE, 'expense');

    const first = await run(input({ accountId: account, categoryId: category }));
    expect(first).toMatchObject({ rate: 14_000_000n, rateSource: 'automatic', rateType: 'blue' });

    preferences.values = { ...preferences.values, defaultRateType: 'oficial' };
    const second = await run(input({ accountId: account, categoryId: category }));
    expect(second).toMatchObject({
      rate: 10_000_000n,
      rateSource: 'automatic',
      rateType: 'oficial',
    });
  });

  it('stores a manual rate with source manual and no rate type, without reading rates', async () => {
    const account = accounts.seed(ALICE);
    const category = categories.seed(ALICE, 'expense');

    const movement = await run(
      input({
        accountId: account,
        categoryId: category,
        rate: { source: 'manual', value: 16_233_000n },
      }),
    );

    expect(movement).toMatchObject({ rate: 16_233_000n, rateSource: 'manual', rateType: null });
    expect(rates.calls).toHaveLength(0);
  });

  it('fails with RateRequired for an automatic rate with none stored, but accepts a manual one', async () => {
    rates.sells.clear();
    const account = accounts.seed(ALICE);
    const category = categories.seed(ALICE, 'expense');

    await expect(run(input({ accountId: account, categoryId: category }))).rejects.toBeInstanceOf(
      RateRequired,
    );
    expect(movements.rows).toHaveLength(0);

    await expect(
      run(
        input({ accountId: account, categoryId: category, rate: { source: 'manual', value: 1n } }),
      ),
    ).resolves.toMatchObject({ rateSource: 'manual' });
  });

  it('rejects a local date after today and accepts a UTC-tomorrow instant that is still today behind UTC', async () => {
    const account = accounts.seed(ALICE);
    const category = categories.seed(ALICE, 'expense');

    await expect(
      run(
        input({
          accountId: account,
          categoryId: category,
          occurredAt: new Date('2026-10-03T03:00:00.000Z'),
        }),
      ),
    ).rejects.toBeInstanceOf(MovementDateInFuture);
    expect(movements.rows).toHaveLength(0);

    // 2026-10-03T02:00Z is still 2026-10-02 23:00 in Buenos Aires (UTC-3).
    await expect(
      run(
        input({
          accountId: account,
          categoryId: category,
          occurredAt: new Date('2026-10-03T02:00:00.000Z'),
        }),
      ),
    ).resolves.toMatchObject({ ownerId: ALICE });
  });

  it('rejects archived accounts and categories and accepts them again once unarchived', async () => {
    const account = accounts.seed(ALICE, true);
    const category = categories.seed(ALICE, 'expense', true);

    await expect(run(input({ accountId: account, categoryId: category }))).rejects.toMatchObject({
      code: 'ACCOUNT_ARCHIVED',
    });
    accounts.setArchived(account, false);
    await expect(run(input({ accountId: account, categoryId: category }))).rejects.toBeInstanceOf(
      CategoryArchived,
    );
    await expect(run(input({ accountId: account, categoryId: category }))).rejects.toMatchObject({
      code: 'CATEGORY_ARCHIVED',
    });
    expect(movements.rows).toHaveLength(0);

    categories.setArchived(category, false);
    await expect(run(input({ accountId: account, categoryId: category }))).resolves.toMatchObject({
      ownerId: ALICE,
    });

    accounts.setArchived(account, true);
    await expect(run(input({ accountId: account, categoryId: category }))).rejects.toBeInstanceOf(
      MovementAccountArchived,
    );
  });

  it('answers 404 for an account or category of another user or unknown, nothing stored', async () => {
    const bobAccount = accounts.seed(BOB);
    const bobCategory = categories.seed(BOB, 'expense');
    const account = accounts.seed(ALICE);
    const category = categories.seed(ALICE, 'expense');

    await expect(
      run(input({ accountId: bobAccount, categoryId: category })),
    ).rejects.toBeInstanceOf(ResourceNotFound);
    await expect(
      run(input({ accountId: account, categoryId: bobCategory })),
    ).rejects.toBeInstanceOf(ResourceNotFound);
    await expect(run(input({ accountId: UNKNOWN, categoryId: category }))).rejects.toBeInstanceOf(
      ResourceNotFound,
    );
    await expect(run(input({ accountId: account, categoryId: UNKNOWN }))).rejects.toBeInstanceOf(
      ResourceNotFound,
    );
    expect(movements.rows).toHaveLength(0);
  });

  it('checks a foreign account as 404 before the archived or category state is considered', async () => {
    const bobAccount = accounts.seed(BOB, true);
    const wrongKind = categories.seed(ALICE, 'income', true);

    const error = await run(input({ accountId: bobAccount, categoryId: wrongKind })).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ResourceNotFound);
  });

  it('checks the account state before the category, the kind before archived, and the date first', async () => {
    const account = accounts.seed(ALICE);
    const archivedWrongKind = categories.seed(ALICE, 'income', true);

    await expect(
      run(input({ accountId: account, categoryId: archivedWrongKind })),
    ).rejects.toBeInstanceOf(MovementCategoryKindMismatch);

    const archivedAccount = accounts.seed(ALICE, true);
    await expect(
      run(input({ accountId: archivedAccount, categoryId: archivedWrongKind })),
    ).rejects.toBeInstanceOf(MovementAccountArchived);

    await expect(
      run(
        input({
          accountId: UNKNOWN,
          categoryId: archivedWrongKind,
          occurredAt: new Date('2026-12-01T00:00:00.000Z'),
        }),
      ),
    ).rejects.toBeInstanceOf(MovementDateInFuture);
  });

  it('domain errors are AppErrors with the documented codes', () => {
    for (const error of [
      new MovementDateInFuture(),
      new RateRequired(),
      new MovementCategoryKindMismatch(),
      new MovementAccountArchived(),
      new CategoryArchived(),
    ]) {
      expect(error).toBeInstanceOf(AppError);
    }
    expect(new MovementDateInFuture().code).toBe('MOVEMENT_DATE_IN_FUTURE');
    expect(new RateRequired().code).toBe('RATE_REQUIRED');
    expect(new MovementAccountArchived().code).toBe('ACCOUNT_ARCHIVED');
  });

  it('has no provider dependency: constructor keys are the stored-data ports only', () => {
    const keys = Object.keys((create as unknown as { deps: Record<string, unknown> }).deps).sort();
    expect(keys).toEqual(['accounts', 'categories', 'clock', 'movements', 'preferences', 'rates']);
    expect(keys.some((key) => /provider|job|sync/i.test(key))).toBe(false);
  });
});

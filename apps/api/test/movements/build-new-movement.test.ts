import { beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '@pesly/shared';
import {
  buildNewMovement,
  type EditCategorizedMovementInput,
  type EditMovementInput,
} from '../../src/movements/application/build-new-movement';
import {
  CategoryArchived,
  ExchangeSameCurrency,
  ImpliedRateOutOfRange,
  MovementAccountArchived,
  MovementCategoryKindMismatch,
  MovementCurrencyMismatch,
  MovementDateInFuture,
  MovementSameAccount,
  RateRequired,
} from '../../src/movements/domain/errors';
import type { Movement } from '../../src/movements/domain/movement';
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

let movements: InMemoryMovementRepository;
let accounts: InMemoryAccountLookup;
let categories: InMemoryCategoryLookup;
let rates: FakeRateLookup;
let preferences: FakeUserPreferences;
let clock: MutableClock;

beforeEach(() => {
  movements = new InMemoryMovementRepository();
  accounts = new InMemoryAccountLookup();
  categories = new InMemoryCategoryLookup();
  rates = new FakeRateLookup();
  rates.sells.set('blue', 14_000_000n);
  preferences = new FakeUserPreferences();
  clock = new MutableClock(new Date('2026-10-02T12:00:00.000Z'));
});

async function build(input: EditMovementInput, existing?: Movement) {
  return buildNewMovement(
    { accounts, categories, rates, preferences, clock },
    await writeScopeFor(ALICE),
    input,
    existing,
  );
}

/** An expense whose rate was typed by hand (`manual`, no rate type) a month before today. */
function storedExpense(accountId: string, categoryId: string): Movement {
  return movements.seed(ALICE, {
    accountId,
    categoryId,
    rate: 9_000_000n,
    rateSource: 'manual',
    rateType: null,
    occurredAt: new Date('2026-09-01T12:00:00.000Z'),
  });
}

function expenseEdit(
  accountId: string,
  categoryId: string,
  overrides: Partial<EditCategorizedMovementInput> = {},
): EditCategorizedMovementInput {
  return {
    type: 'expense',
    accountId,
    categoryId,
    amount: 2500n,
    occurredAt: new Date('2026-09-02T12:00:00.000Z'),
    rate: { source: 'keep' },
    ...overrides,
  };
}

describe('buildNewMovement in edit mode', () => {
  it('keeps the stored rate, its source and its rate type untouched with keep (FR-01)', async () => {
    const account = accounts.seed(ALICE);
    const category = categories.seed(ALICE, 'expense');
    const existing = storedExpense(account, category);

    const built = await build(expenseEdit(account, category), existing);

    expect(built).toMatchObject({
      type: 'expense',
      amount: 2500n,
      rate: 9_000_000n,
      rateSource: 'manual',
      rateType: null,
    });
    expect(rates.calls).toEqual([]);
  });

  it('freezes the latest stored rate with automatic and the given value with manual (FR-01)', async () => {
    const account = accounts.seed(ALICE);
    const category = categories.seed(ALICE, 'expense');
    const existing = storedExpense(account, category);

    const automatic = await build(
      expenseEdit(account, category, { rate: { source: 'automatic' } }),
      existing,
    );
    const manual = await build(
      expenseEdit(account, category, { rate: { source: 'manual', value: 15_500_000n } }),
      existing,
    );

    expect(automatic).toMatchObject({
      rate: 14_000_000n,
      rateSource: 'automatic',
      rateType: 'blue',
    });
    expect(manual).toMatchObject({ rate: 15_500_000n, rateSource: 'manual', rateType: null });
  });

  it('answers RateRequired when automatic finds no stored rate (FR-01)', async () => {
    rates.sells.clear();
    const account = accounts.seed(ALICE);
    const category = categories.seed(ALICE, 'expense');

    await expect(
      build(
        expenseEdit(account, category, { rate: { source: 'automatic' } }),
        storedExpense(account, category),
      ),
    ).rejects.toBeInstanceOf(RateRequired);
  });

  it('keeps an archived account and category the movement already uses (FR-01)', async () => {
    const account = accounts.seed(ALICE);
    const category = categories.seed(ALICE, 'expense');
    const existing = storedExpense(account, category);
    accounts.setArchived(account, true);
    categories.setArchived(category, true);

    const built = await build(expenseEdit(account, category, { note: 'fixed a typo' }), existing);

    expect(built).toMatchObject({ accountId: account, categoryId: category, note: 'fixed a typo' });
  });

  it('rejects moving to an archived account or category with an archived error (FR-01)', async () => {
    const account = accounts.seed(ALICE);
    const category = categories.seed(ALICE, 'expense');
    const existing = storedExpense(account, category);
    const archivedAccount = accounts.seed(ALICE, true);
    const archivedCategory = categories.seed(ALICE, 'expense', true);

    await expect(build(expenseEdit(archivedAccount, category), existing)).rejects.toBeInstanceOf(
      MovementAccountArchived,
    );
    await expect(build(expenseEdit(account, archivedCategory), existing)).rejects.toBeInstanceOf(
      CategoryArchived,
    );
  });

  it('rejects a category of the other kind with a kind mismatch error (FR-01)', async () => {
    const account = accounts.seed(ALICE);
    const category = categories.seed(ALICE, 'expense');
    const income = categories.seed(ALICE, 'income');

    await expect(
      build(expenseEdit(account, income), storedExpense(account, category)),
    ).rejects.toBeInstanceOf(MovementCategoryKindMismatch);
  });

  it('answers not found for an account or category of another user (FR-03)', async () => {
    const account = accounts.seed(ALICE);
    const category = categories.seed(ALICE, 'expense');
    const existing = storedExpense(account, category);

    await expect(build(expenseEdit(accounts.seed(BOB), category), existing)).rejects.toBeInstanceOf(
      ResourceNotFound,
    );
    await expect(
      build(expenseEdit(account, categories.seed(BOB, 'expense')), existing),
    ).rejects.toBeInstanceOf(ResourceNotFound);
  });

  it('rejects a date after today in the user time zone and accepts today (FR-04)', async () => {
    const account = accounts.seed(ALICE);
    const category = categories.seed(ALICE, 'expense');
    const existing = storedExpense(account, category);
    // 2026-10-02T12:00Z is still the 2nd in Buenos Aires; the 3rd at 04:00Z is the 3rd at 01:00 there.
    const tomorrow = expenseEdit(account, category, {
      occurredAt: new Date('2026-10-03T04:00:00.000Z'),
    });
    const today = expenseEdit(account, category, {
      occurredAt: new Date('2026-10-02T23:00:00.000Z'),
    });

    await expect(build(tomorrow, existing)).rejects.toBeInstanceOf(MovementDateInFuture);
    await expect(build(today, existing)).resolves.toMatchObject({ type: 'expense' });
  });

  it('rejects keep without a stored rate to keep: an invalid request (FR-01)', async () => {
    const account = accounts.seed(ALICE);
    const category = categories.seed(ALICE, 'expense');

    await expect(build(expenseEdit(account, category))).rejects.toBeInstanceOf(AppError);
    const transfer = movements.seed(ALICE, {});
    const asTransfer: Movement = {
      id: transfer.id,
      ownerId: ALICE,
      type: 'transfer',
      accountId: account,
      destinationAccountId: accounts.seed(ALICE),
      amount: 10n,
      destinationAmount: 10n,
      occurredAt: new Date('2026-09-01T12:00:00.000Z'),
      note: null,
      tags: [],
      createdAt: transfer.createdAt,
    };
    await expect(build(expenseEdit(account, category), asTransfer)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });

  it('builds a transfer and recomputes the implied rate of an exchange (FR-01)', async () => {
    const ars = accounts.seed(ALICE, false, 'ARS');
    const arsOther = accounts.seed(ALICE, false, 'ARS');
    const usd = accounts.seed(ALICE, false, 'USD');
    const when = new Date('2026-09-02T12:00:00.000Z');

    const transfer = await build({
      type: 'transfer',
      accountId: ars,
      destinationAccountId: arsOther,
      amount: 5000n,
      occurredAt: when,
    });
    const exchange = await build({
      type: 'exchange',
      accountId: ars,
      destinationAccountId: usd,
      amount: 150_000_00n,
      destinationAmount: 100_00n,
      occurredAt: when,
    });

    expect(transfer).toMatchObject({ type: 'transfer', destinationAmount: 5000n });
    expect(exchange).toMatchObject({
      type: 'exchange',
      rate: 15_000_000n,
      rateSource: 'implied',
      rateType: null,
    });
  });

  it('rejects the same account, a currency mismatch and an out of range implied rate (FR-01)', async () => {
    const ars = accounts.seed(ALICE, false, 'ARS');
    const usd = accounts.seed(ALICE, false, 'USD');
    const when = new Date('2026-09-02T12:00:00.000Z');

    await expect(
      build({
        type: 'transfer',
        accountId: ars,
        destinationAccountId: ars,
        amount: 1n,
        occurredAt: when,
      }),
    ).rejects.toBeInstanceOf(MovementSameAccount);
    await expect(
      build({
        type: 'transfer',
        accountId: ars,
        destinationAccountId: usd,
        amount: 1n,
        occurredAt: when,
      }),
    ).rejects.toBeInstanceOf(MovementCurrencyMismatch);
    await expect(
      build({
        type: 'exchange',
        accountId: ars,
        destinationAccountId: accounts.seed(ALICE, false, 'ARS'),
        amount: 1n,
        destinationAmount: 1n,
        occurredAt: when,
      }),
    ).rejects.toBeInstanceOf(ExchangeSameCurrency);
    await expect(
      build({
        type: 'exchange',
        accountId: ars,
        destinationAccountId: usd,
        amount: 1n,
        destinationAmount: 999_999_999_999n,
        occurredAt: when,
      }),
    ).rejects.toBeInstanceOf(ImpliedRateOutOfRange);
  });

  it('keeps an archived transfer destination only when it does not change (FR-01)', async () => {
    const ars = accounts.seed(ALICE, false, 'ARS');
    const destination = accounts.seed(ALICE, false, 'ARS');
    const other = accounts.seed(ALICE, true, 'ARS');
    const existing: Movement = {
      id: movements.seed(ALICE).id,
      ownerId: ALICE,
      type: 'transfer',
      accountId: ars,
      destinationAccountId: destination,
      amount: 10n,
      destinationAmount: 10n,
      occurredAt: new Date('2026-09-01T12:00:00.000Z'),
      note: null,
      tags: [],
      createdAt: new Date('2026-09-01T12:00:00.000Z'),
    };
    accounts.setArchived(destination, true);
    const base = { type: 'transfer', accountId: ars, amount: 20n, occurredAt: existing.occurredAt };

    await expect(
      build({ ...base, type: 'transfer', destinationAccountId: destination }, existing),
    ).resolves.toMatchObject({ destinationAccountId: destination, amount: 20n });
    await expect(
      build({ ...base, type: 'transfer', destinationAccountId: other }, existing),
    ).rejects.toBeInstanceOf(MovementAccountArchived);
  });
});

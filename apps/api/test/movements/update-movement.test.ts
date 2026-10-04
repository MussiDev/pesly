import { beforeEach, describe, expect, it } from 'vitest';
import type { EditCategorizedMovementInput } from '../../src/movements/application/build-new-movement';
import { UpdateMovement } from '../../src/movements/application/update-movement';
import { MovementDateInFuture, MovementTypeImmutable } from '../../src/movements/domain/errors';
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
let clock: MutableClock;
let update: UpdateMovement;

beforeEach(() => {
  movements = new InMemoryMovementRepository();
  accounts = new InMemoryAccountLookup();
  categories = new InMemoryCategoryLookup();
  rates = new FakeRateLookup();
  rates.sells.set('blue', 14_000_000n);
  clock = new MutableClock(new Date('2026-10-02T12:00:00.000Z'));
  update = new UpdateMovement({
    movements,
    accounts,
    categories,
    rates,
    preferences: new FakeUserPreferences(),
    clock,
  });
});

function setup() {
  const accountId = accounts.seed(ALICE);
  const categoryId = categories.seed(ALICE, 'expense');
  const stored = movements.seed(ALICE, {
    accountId,
    categoryId,
    rate: 9_000_000n,
    rateSource: 'manual',
    rateType: null,
    occurredAt: new Date('2026-09-01T12:00:00.000Z'),
  });
  return { accountId, categoryId, stored };
}

function edit(
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

async function run(id: string, input: EditCategorizedMovementInput, userId = ALICE) {
  return update.execute(await writeScopeFor(userId), id, input);
}

describe('UpdateMovement', () => {
  it('returns the updated movement and calls update once with the built values (AC-01)', async () => {
    const { accountId, categoryId, stored } = setup();

    const result = await run(
      stored.id,
      edit(accountId, categoryId, { amount: 4200n, note: 'corrected', tags: ['Viaje'] }),
    );

    expect(result).toMatchObject({
      id: stored.id,
      amount: 4200n,
      note: 'corrected',
      tags: ['Viaje'],
    });
    expect(movements.updateCalls).toHaveLength(1);
    expect(movements.updateCalls[0]?.data).toMatchObject({ type: 'expense', amount: 4200n });
    expect(movements.rows.find((row) => row.id === stored.id)?.amount).toBe(4200n);
  });

  it('keeps the frozen rate of an old expense even when the stored rates changed since (AC-01)', async () => {
    const { accountId, categoryId, stored } = setup();
    rates.sells.set('blue', 99_000_000n);

    const result = await run(stored.id, edit(accountId, categoryId));

    expect(result).toMatchObject({ rate: 9_000_000n, rateSource: 'manual', rateType: null });
    expect(rates.calls).toEqual([]);
  });

  it('accepts an edit that keeps an old past date (FR-04)', async () => {
    const { accountId, categoryId, stored } = setup();

    await expect(
      run(stored.id, edit(accountId, categoryId, { occurredAt: stored.occurredAt })),
    ).resolves.toMatchObject({ occurredAt: stored.occurredAt });
  });

  it('rejects an edit to tomorrow in the user time zone with a future date error and writes nothing (AC-04)', async () => {
    const { accountId, categoryId, stored } = setup();

    await expect(
      run(
        stored.id,
        edit(accountId, categoryId, { occurredAt: new Date('2026-10-03T04:00:00.000Z') }),
      ),
    ).rejects.toBeInstanceOf(MovementDateInFuture);

    expect(movements.updateCalls).toHaveLength(0);
    expect(movements.rows.find((row) => row.id === stored.id)?.amount).toBe(100n);
  });

  it('answers not found for a movement of another owner and for a missing id, writing nothing (AC-03)', async () => {
    const { accountId, categoryId, stored } = setup();

    await expect(run(stored.id, edit(accountId, categoryId), BOB)).rejects.toBeInstanceOf(
      ResourceNotFound,
    );
    await expect(run(UNKNOWN, edit(accountId, categoryId))).rejects.toBeInstanceOf(
      ResourceNotFound,
    );

    expect(movements.updateCalls).toHaveLength(0);
  });

  it('answers 404 before a type error for a foreign movement, so it reveals nothing (AC-03)', async () => {
    const { accountId, stored } = setup();
    const transfer = {
      type: 'transfer',
      accountId,
      destinationAccountId: accounts.seed(ALICE),
      amount: 10n,
      occurredAt: new Date('2026-09-02T12:00:00.000Z'),
    } as const;

    await expect(
      update.execute(await writeScopeFor(BOB), stored.id, transfer),
    ).rejects.toBeInstanceOf(ResourceNotFound);
  });

  it('rejects a different type than the stored one with an immutable type error and writes nothing (FR-01)', async () => {
    const { accountId, stored } = setup();

    await expect(
      update.execute(await writeScopeFor(ALICE), stored.id, {
        type: 'transfer',
        accountId,
        destinationAccountId: accounts.seed(ALICE),
        amount: 10n,
        occurredAt: new Date('2026-09-02T12:00:00.000Z'),
      }),
    ).rejects.toBeInstanceOf(MovementTypeImmutable);

    expect(movements.updateCalls).toHaveLength(0);
  });

  it('answers 404 when the movement vanished between the read and the write (FR-03)', async () => {
    const { accountId, categoryId, stored } = setup();
    // The read finds the row, then the write finds nothing, as after a concurrent delete.
    const original = movements.update.bind(movements);
    movements.update = async (scope, id, data) => {
      movements.rows.splice(0, movements.rows.length);
      return original(scope, id, data);
    };

    await expect(run(stored.id, edit(accountId, categoryId))).rejects.toBeInstanceOf(
      ResourceNotFound,
    );
  });

  it('propagates a repository failure on update unchanged (FR-01)', async () => {
    const { accountId, categoryId, stored } = setup();
    movements.updateError = new Error('database down');

    await expect(run(stored.id, edit(accountId, categoryId))).rejects.toThrow('database down');
  });
});

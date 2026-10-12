import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@pesly/shared';
import {
  BestEffortExpenseSavedHook,
  EXPENSE_SAVED_TIMEOUT_MS,
  type ExpenseSavedFailure,
} from '../../src/movements/application/best-effort-expense-saved';
import {
  CreateMovement,
  type CategorizedMovementInput,
  type CreateMovementInput,
} from '../../src/movements/application/create-movement';
import type {
  ExpenseSavedEvent,
  ExpenseSavedListener,
} from '../../src/movements/application/ports/expense-saved-listener';
import { UpdateMovement } from '../../src/movements/application/update-movement';
import type { AccessScope } from '../../src/shared/access';
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
const BUDGET_NAME = 'Outings secret budget';

class FakeListener implements ExpenseSavedListener {
  readonly calls: { scope: AccessScope<'write'>; event: ExpenseSavedEvent }[] = [];
  /** Rows the repository held when the listener was called. */
  readonly rowsAtCall: number[] = [];
  behavior: () => Promise<void> = () => Promise.resolve();
  constructor(private readonly movements: InMemoryMovementRepository) {}

  afterExpenseSaved(scope: AccessScope<'write'>, event: ExpenseSavedEvent): Promise<void> {
    this.calls.push({ scope, event });
    this.rowsAtCall.push(this.movements.rows.length);
    return this.behavior();
  }
}

let movements: InMemoryMovementRepository;
let accounts: InMemoryAccountLookup;
let categories: InMemoryCategoryLookup;
let rates: FakeRateLookup;
let clock: MutableClock;
let listener: FakeListener;
let failures: ExpenseSavedFailure[];
let hook: BestEffortExpenseSavedHook;
let create: CreateMovement;
let update: UpdateMovement;

beforeEach(() => {
  movements = new InMemoryMovementRepository();
  accounts = new InMemoryAccountLookup();
  categories = new InMemoryCategoryLookup();
  rates = new FakeRateLookup();
  rates.sells.set('blue', 14_000_000n);
  clock = new MutableClock(new Date('2026-10-02T12:00:00.000Z'));
  listener = new FakeListener(movements);
  failures = [];
  hook = new BestEffortExpenseSavedHook(listener, (failure) => failures.push(failure));
  const deps = {
    movements,
    accounts,
    categories,
    rates,
    preferences: new FakeUserPreferences(),
    clock,
    expenseSaved: hook,
  };
  create = new CreateMovement(deps);
  update = new UpdateMovement(deps);
});

afterEach(() => {
  vi.useRealTimers();
});

function expense(accountId: string, categoryId: string): CategorizedMovementInput {
  return {
    type: 'expense',
    accountId,
    categoryId,
    amount: 1500n,
    occurredAt: new Date('2026-10-01T15:00:00.000Z'),
    rate: { source: 'automatic' },
  };
}

describe('expense saved hook in CreateMovement and UpdateMovement', () => {
  it('calls the listener once after a created expense with scope, category and date (AC-06)', async () => {
    const accountId = accounts.seed(ALICE);
    const categoryId = categories.seed(ALICE, 'expense');

    const created = await create.execute(
      await writeScopeFor(ALICE),
      expense(accountId, categoryId),
    );

    expect(listener.calls).toHaveLength(1);
    expect(listener.calls[0]?.scope.userId).toBe(ALICE);
    expect(listener.calls[0]?.event).toEqual({ categoryId, occurredAt: created.occurredAt });
    expect(listener.rowsAtCall).toEqual([1]);
  });

  it('calls the listener once after an edited expense (AC-06)', async () => {
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

    await update.execute(await writeScopeFor(ALICE), stored.id, {
      type: 'expense',
      accountId,
      categoryId,
      amount: 2500n,
      occurredAt: new Date('2026-10-01T12:00:00.000Z'),
      rate: { source: 'keep' },
    });

    expect(listener.calls).toHaveLength(1);
    expect(listener.calls[0]?.event).toEqual({
      categoryId,
      occurredAt: new Date('2026-10-01T12:00:00.000Z'),
    });
  });

  it('never calls the listener for an income, a transfer or an exchange (AC-08)', async () => {
    const scope = await writeScopeFor(ALICE);
    const ars = accounts.seed(ALICE);
    const ars2 = accounts.seed(ALICE);
    const usd = accounts.seed(ALICE, false, 'USD');
    const incomeCategory = categories.seed(ALICE, 'income');
    const occurredAt = new Date('2026-10-01T15:00:00.000Z');

    const inputs: CreateMovementInput[] = [
      { ...expense(ars, incomeCategory), type: 'income' },
      { type: 'transfer', accountId: ars, destinationAccountId: ars2, amount: 100n, occurredAt },
      {
        type: 'exchange',
        accountId: ars,
        destinationAccountId: usd,
        amount: 100_000n,
        destinationAmount: 100n,
        occurredAt,
      },
    ];
    for (const input of inputs) await create.execute(scope, input);

    expect(movements.rows).toHaveLength(3);
    expect(listener.calls).toHaveLength(0);
  });

  it('does not call the listener when the repository rejects the write (AC-18)', async () => {
    const accountId = accounts.seed(ALICE);
    const categoryId = categories.seed(ALICE, 'expense');
    movements.insertError = new Error('db down');

    await expect(
      create.execute(await writeScopeFor(ALICE), expense(accountId, categoryId)),
    ).rejects.toThrow('db down');

    expect(listener.calls).toHaveLength(0);
  });

  it('returns the created movement unchanged and reports once when the listener fails (AC-18)', async () => {
    const accountId = accounts.seed(ALICE);
    const categoryId = categories.seed(ALICE, 'expense');
    listener.behavior = () =>
      Promise.reject(Object.assign(new Error(`insert ${BUDGET_NAME} 15000`), { code: '23505' }));

    const created = await create.execute(
      await writeScopeFor(ALICE),
      expense(accountId, categoryId),
    );

    expect(movements.rows).toEqual([created]);
    expect(failures).toEqual([{ errorName: 'Error', errorCode: '23505', userId: ALICE }]);
    expect(JSON.stringify(failures)).not.toContain(BUDGET_NAME);
    expect(JSON.stringify(failures)).not.toContain('15000');
  });

  it('builds without a hook and behaves as before (AC-06)', async () => {
    const accountId = accounts.seed(ALICE);
    const categoryId = categories.seed(ALICE, 'expense');
    const plain = new CreateMovement({
      movements,
      accounts,
      categories,
      rates,
      preferences: new FakeUserPreferences(),
      clock,
    });

    await expect(
      plain.execute(await writeScopeFor(ALICE), expense(accountId, categoryId)),
    ).resolves.toMatchObject({ type: 'expense' });
    expect(listener.calls).toHaveLength(0);
  });
});

describe('BestEffortExpenseSavedHook', () => {
  const event: ExpenseSavedEvent = {
    categoryId: '44444444-4444-4444-8444-444444444444',
    occurredAt: new Date('2026-10-01T15:00:00.000Z'),
  };

  it('reports the error name and the AppError code, never the message', async () => {
    listener.behavior = () => Promise.reject(new AppError('NOT_FOUND', `leak ${BUDGET_NAME}`));

    await hook.run(await writeScopeFor(ALICE), event);

    expect(failures).toEqual([{ errorName: 'AppError', errorCode: 'NOT_FOUND', userId: ALICE }]);
  });

  it('reads the SQLSTATE from the driver error under cause, never the message', async () => {
    const driver = Object.assign(new Error('driver detail'), { code: '40001' });
    listener.behavior = () =>
      Promise.reject(new Error(`wrapped ${BUDGET_NAME} 15000`, { cause: driver }));

    await hook.run(await writeScopeFor(ALICE), event);

    expect(failures).toEqual([{ errorName: 'Error', errorCode: '40001', userId: ALICE }]);
    expect(JSON.stringify(failures)).not.toContain(BUDGET_NAME);
    expect(JSON.stringify(failures)).not.toContain('driver detail');
  });

  it('reports a non-error rejection with a generic name', async () => {
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- a non-Error reason is the case under test
    listener.behavior = () => Promise.reject(`leak ${BUDGET_NAME}`);

    await hook.run(await writeScopeFor(ALICE), event);

    expect(failures).toEqual([{ errorName: 'UnknownError', errorCode: undefined, userId: ALICE }]);
  });

  it('times out on a listener that never settles and reports it', async () => {
    vi.useFakeTimers();
    listener.behavior = () => new Promise<void>(() => undefined);

    const pending = hook.run(await writeScopeFor(ALICE), event);
    await vi.advanceTimersByTimeAsync(EXPENSE_SAVED_TIMEOUT_MS);
    await pending;

    expect(failures).toEqual([
      { errorName: 'ExpenseSavedTimeout', errorCode: 'TIMEOUT', userId: ALICE },
    ]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reports a rejection that arrives after the time bound without an unhandled rejection', async () => {
    vi.useFakeTimers();
    let rejectLater: (error: Error) => void = () => undefined;
    listener.behavior = () =>
      new Promise<void>((_resolve, reject) => {
        rejectLater = reject;
      });
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      const pending = hook.run(await writeScopeFor(ALICE), event);
      await vi.advanceTimersByTimeAsync(EXPENSE_SAVED_TIMEOUT_MS);
      await pending;
      rejectLater(Object.assign(new Error('late'), { code: 'XX000' }));
      vi.useRealTimers();
      await new Promise((resolve) => setImmediate(resolve));
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }

    expect(unhandled).toEqual([]);
    expect(failures.map((failure) => failure.errorCode)).toEqual(['TIMEOUT', 'XX000']);
  });

  it('does not report a listener that settles in time and leaves no timer', async () => {
    vi.useFakeTimers();

    await hook.run(await writeScopeFor(ALICE), event);

    expect(failures).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
});

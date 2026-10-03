import { beforeEach, describe, expect, it } from 'vitest';
import { AppError, ERROR_CODES, RATE_MAX_SCALED, type AccountCurrency } from '@pesly/shared';
import {
  CreateMovement,
  type ExchangeInput,
  type TransferInput,
} from '../../src/movements/application/create-movement';
import { RecordManualMovement } from '../../src/movements/application/record-manual-movement';
import {
  ExchangeSameCurrency,
  ImpliedRateOutOfRange,
  MovementAccountArchived,
  MovementCurrencyMismatch,
  MovementDateInFuture,
  MovementSameAccount,
  MovementWriteRateLimited,
} from '../../src/movements/domain/errors';
import { ResourceNotFound } from '../../src/shared/access';
import {
  FakeRateLookup,
  FakeUserPreferences,
  InMemoryAccountLookup,
  InMemoryCategoryLookup,
  InMemoryMovementRepository,
  InMemoryMovementWriteLimiter,
  MutableClock,
  writeScopeFor,
} from './fakes';

const ALICE = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';
const UNKNOWN = '33333333-3333-4333-8333-333333333333';
const WINDOW_START = new Date('2026-10-02T12:00:00.000Z');

let movements: InMemoryMovementRepository;
let accounts: InMemoryAccountLookup;
let categories: InMemoryCategoryLookup;
let rates: FakeRateLookup;
let clock: MutableClock;
let create: CreateMovement;

beforeEach(() => {
  movements = new InMemoryMovementRepository();
  accounts = new InMemoryAccountLookup();
  categories = new InMemoryCategoryLookup();
  rates = new FakeRateLookup();
  clock = new MutableClock(new Date('2026-10-02T12:00:00.000Z'));
  create = new CreateMovement({
    movements,
    accounts,
    categories,
    rates,
    preferences: new FakeUserPreferences(),
    clock,
  });
});

function transfer(
  accountId: string,
  destinationAccountId: string,
  overrides: Partial<TransferInput> = {},
): TransferInput {
  return {
    type: 'transfer',
    accountId,
    destinationAccountId,
    amount: 5000n,
    occurredAt: new Date('2026-10-01T15:00:00.000Z'),
    ...overrides,
  };
}

function exchange(
  accountId: string,
  destinationAccountId: string,
  amount: bigint,
  destinationAmount: bigint,
  overrides: Partial<ExchangeInput> = {},
): ExchangeInput {
  return {
    type: 'exchange',
    accountId,
    destinationAccountId,
    amount,
    destinationAmount,
    occurredAt: new Date('2026-10-01T15:00:00.000Z'),
    ...overrides,
  };
}

async function run(data: TransferInput | ExchangeInput, userId = ALICE) {
  return create.execute(await writeScopeFor(userId), data);
}

function pair(a: AccountCurrency, b: AccountCurrency, ownerId = ALICE): [string, string] {
  return [accounts.seed(ownerId, false, a), accounts.seed(ownerId, false, b)];
}

describe('CreateMovement, transfers', () => {
  it('stores a transfer with the scope owner, no category, no rate and destinationAmount = amount (AC-01)', async () => {
    const [from, to] = pair('ARS', 'ARS');
    const movement = await run(transfer(from, to, { note: 'rent' }));

    expect(movement).toMatchObject({
      ownerId: ALICE,
      type: 'transfer',
      accountId: from,
      destinationAccountId: to,
      amount: 5000n,
      destinationAmount: 5000n,
      note: 'rent',
    });
    expect(movement).not.toHaveProperty('categoryId');
    expect(movement).not.toHaveProperty('rate');
    expect(movements.rows).toHaveLength(1);
  });

  it('ignores a destinationAmount smuggled into a transfer input (AC-01)', async () => {
    const [from, to] = pair('USD', 'USD');
    const smuggled = { ...transfer(from, to), destinationAmount: 1n };
    const movement = await run(smuggled);
    expect(movement).toMatchObject({ amount: 5000n, destinationAmount: 5000n });
  });

  it('rejects the same account and an ARS to USD transfer, storing nothing (AC-02)', async () => {
    const [ars, usd] = pair('ARS', 'USD');

    await expect(run(transfer(ars, ars))).rejects.toBeInstanceOf(MovementSameAccount);
    await expect(run(transfer(ars, ars))).rejects.toMatchObject({
      code: 'MOVEMENT_SAME_ACCOUNT',
    });
    await expect(run(transfer(ars, usd))).rejects.toBeInstanceOf(MovementCurrencyMismatch);
    await expect(run(transfer(usd, ars))).rejects.toMatchObject({
      code: 'MOVEMENT_CURRENCY_MISMATCH',
    });
    expect(movements.rows).toHaveLength(0);
  });

  it('checks identical ids before any lookup, naming no data (AC-02)', async () => {
    await expect(run(transfer(UNKNOWN, UNKNOWN))).rejects.toBeInstanceOf(MovementSameAccount);
  });
});

describe('CreateMovement, exchanges', () => {
  it('stores an ARS-out USD-in exchange and the reverse direction (AC-03)', async () => {
    const [ars, usd] = pair('ARS', 'USD');

    const buy = await run(exchange(ars, usd, 155_730_000n, 100_000n));
    expect(buy).toMatchObject({
      ownerId: ALICE,
      type: 'exchange',
      accountId: ars,
      destinationAccountId: usd,
      amount: 155_730_000n,
      destinationAmount: 100_000n,
      rate: 15_573_000n,
      rateSource: 'implied',
      rateType: null,
    });
    expect(buy).not.toHaveProperty('categoryId');

    const sell = await run(exchange(usd, ars, 100_000n, 155_730_000n));
    expect(sell).toMatchObject({
      accountId: usd,
      destinationAccountId: ars,
      amount: 100_000n,
      destinationAmount: 155_730_000n,
      rate: 15_573_000n,
      rateSource: 'implied',
      rateType: null,
    });
    expect(movements.rows).toHaveLength(2);
  });

  it('rejects an exchange between accounts of the same currency (AC-04)', async () => {
    const [a, b] = pair('USD', 'USD');
    const [c, d] = pair('ARS', 'ARS');

    await expect(run(exchange(a, b, 100n, 100n))).rejects.toBeInstanceOf(ExchangeSameCurrency);
    await expect(run(exchange(c, d, 100n, 100n))).rejects.toMatchObject({
      code: 'EXCHANGE_SAME_CURRENCY',
    });
    expect(movements.rows).toHaveLength(0);
  });

  it('rejects the same account for an exchange (AC-02)', async () => {
    const [ars] = pair('ARS', 'USD');
    await expect(run(exchange(ars, ars, 100n, 100n))).rejects.toBeInstanceOf(MovementSameAccount);
  });

  it('stores the implied rate rounded half-up with source implied (AC-05, AC-14)', async () => {
    const [ars, usd] = pair('ARS', 'USD');

    const exact = await run(exchange(ars, usd, 155_730_000n, 100_000n));
    expect(exact).toMatchObject({ rate: 15_573_000n, rateSource: 'implied' });

    const rounded = await run(exchange(ars, usd, 200_000n, 300n));
    expect(rounded).toMatchObject({ rate: 6_666_667n, rateSource: 'implied' });

    // 3 ARS over 20,000 USD minor units is exactly 1.5 scaled: the tie rounds up to 2.
    const tie = await run(exchange(ars, usd, 3n, 20_000n));
    expect(tie).toMatchObject({ rate: 2n });
  });

  it('takes the ARS amount from the ARS side whichever the direction (AC-14)', async () => {
    const [ars, usd] = pair('ARS', 'USD');
    const sell = await run(exchange(usd, ars, 300n, 200_000n));
    expect(sell).toMatchObject({ rate: 6_666_667n });
  });

  it('rejects an implied rate of 0 or above RATE_MAX, storing nothing (AC-15)', async () => {
    const [ars, usd] = pair('ARS', 'USD');

    await expect(run(exchange(ars, usd, 1n, 1_000_000n))).rejects.toBeInstanceOf(
      ImpliedRateOutOfRange,
    );
    await expect(run(exchange(usd, ars, 1_000_000n, 1n))).rejects.toMatchObject({
      code: 'IMPLIED_RATE_OUT_OF_RANGE',
    });
    await expect(run(exchange(ars, usd, 10n ** 15n, 1n))).rejects.toBeInstanceOf(
      ImpliedRateOutOfRange,
    );
    expect(movements.rows).toHaveLength(0);

    // The boundary values themselves are accepted: 1 and RATE_MAX scaled.
    await expect(run(exchange(ars, usd, 1n, 20_000n))).resolves.toMatchObject({ rate: 1n });
    await expect(run(exchange(ars, usd, RATE_MAX_SCALED, 10_000n))).resolves.toMatchObject({
      rate: RATE_MAX_SCALED,
    });
  });
});

describe.each(['transfer', 'exchange'] as const)('CreateMovement, %s shared rules', (kind) => {
  function build(
    from: string,
    to: string,
    overrides: Partial<Pick<TransferInput, 'occurredAt' | 'note'>> = {},
  ) {
    return kind === 'transfer'
      ? transfer(from, to, overrides)
      : exchange(from, to, 15_000n, 10n, overrides);
  }
  function accountsFor(ownerId = ALICE): [string, string] {
    return kind === 'transfer' ? pair('ARS', 'ARS', ownerId) : pair('ARS', 'USD', ownerId);
  }

  it('rejects a local date after today and accepts a UTC-tomorrow instant still today behind UTC (AC-07)', async () => {
    const [from, to] = accountsFor();

    await expect(
      run(build(from, to, { occurredAt: new Date('2026-10-03T03:00:00.000Z') })),
    ).rejects.toBeInstanceOf(MovementDateInFuture);
    expect(movements.rows).toHaveLength(0);

    // 2026-10-03T02:00Z is still 2026-10-02 23:00 in Buenos Aires (UTC-3).
    await expect(
      run(build(from, to, { occurredAt: new Date('2026-10-03T02:00:00.000Z') })),
    ).resolves.toMatchObject({ ownerId: ALICE });
  });

  it('checks the date before the account ids and lookups (AC-07)', async () => {
    await expect(
      run(build(UNKNOWN, UNKNOWN, { occurredAt: new Date('2026-12-01T00:00:00.000Z') })),
    ).rejects.toBeInstanceOf(MovementDateInFuture);
  });

  it('answers 404 for a foreign or unknown source or destination, storing nothing (AC-09)', async () => {
    const [from, to] = accountsFor();
    const [foreignFrom, foreignTo] = accountsFor(BOB);

    for (const [source, destination] of [
      [foreignFrom, to],
      [from, foreignTo],
      [UNKNOWN, to],
      [from, UNKNOWN],
    ] as const) {
      await expect(run(build(source, destination))).rejects.toBeInstanceOf(ResourceNotFound);
    }
    expect(movements.rows).toHaveLength(0);
  });

  it('answers 404 before the archived state or the currency rules are considered (AC-09, AC-10)', async () => {
    const foreignArchived = accounts.seed(BOB, true, 'USD');
    const [from] = accountsFor();
    const error = await run(build(from, foreignArchived)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ResourceNotFound);
  });

  it('rejects an archived source or destination and works again once unarchived (AC-10)', async () => {
    const [from, to] = accountsFor();

    accounts.setArchived(from, true);
    await expect(run(build(from, to))).rejects.toBeInstanceOf(MovementAccountArchived);
    await expect(run(build(from, to))).rejects.toMatchObject({ code: 'ACCOUNT_ARCHIVED' });
    accounts.setArchived(from, false);

    accounts.setArchived(to, true);
    await expect(run(build(from, to))).rejects.toBeInstanceOf(MovementAccountArchived);
    expect(movements.rows).toHaveLength(0);

    accounts.setArchived(to, false);
    await expect(run(build(from, to))).resolves.toMatchObject({ ownerId: ALICE });
  });

  it('checks archived before the currency rules (AC-10)', async () => {
    const wrongPair = kind === 'transfer' ? pair('ARS', 'USD') : pair('USD', 'USD');
    accounts.setArchived(wrongPair[1], true);
    await expect(run(build(wrongPair[0], wrongPair[1]))).rejects.toBeInstanceOf(
      MovementAccountArchived,
    );
  });

  it('never reads the rate lookup (NFR-03)', async () => {
    const [from, to] = accountsFor();
    await run(build(from, to));
    expect(rates.calls).toHaveLength(0);
  });

  it('stores an empty or whitespace-only note as null and keeps a real one (AC-12)', async () => {
    const [from, to] = accountsFor();
    expect((await run(build(from, to, { note: '   ' }))).note).toBeNull();
    expect((await run(build(from, to, { note: ' hi ' }))).note).toBe(' hi ');
  });

  it('passes the amount through unchanged, up to 10^15 minor units (AC-11)', async () => {
    const [from, to] = accountsFor();
    const big = 10n ** 15n;
    const movement = await run(
      kind === 'transfer' ? transfer(from, to, { amount: big }) : exchange(from, to, big, big),
    );
    expect(movement).toMatchObject({ amount: big, destinationAmount: big });
  });
});

describe('RecordManualMovement with transfers and exchanges', () => {
  it('shares the limit of 60 across the four types and refunds a failed creation (AC-13)', async () => {
    const limiter = new InMemoryMovementWriteLimiter(() => clock.now());
    const record = new RecordManualMovement({
      createMovement: create,
      limiter,
      clock,
      reportReleaseFailure: () => undefined,
    });
    const scope = await writeScopeFor(ALICE);
    const [ars1, ars2] = pair('ARS', 'ARS');
    const [ars, usd] = pair('ARS', 'USD');
    const category = categories.seed(ALICE, 'expense');
    rates.sells.set('blue', 14_000_000n);

    for (let i = 0; i < 29; i++) {
      await record.execute(scope, {
        type: 'expense',
        accountId: ars1,
        categoryId: category,
        amount: 100n,
        occurredAt: new Date('2026-10-01T12:00:00.000Z'),
        rate: { source: 'automatic' },
      });
    }
    // A failed creation refunds its unit, so it does not eat the budget.
    await expect(record.execute(scope, transfer(ars1, ars1))).rejects.toBeInstanceOf(
      MovementSameAccount,
    );
    expect(limiter.countFor(ALICE, WINDOW_START)).toBe(29);

    for (let i = 0; i < 16; i++) await record.execute(scope, transfer(ars1, ars2));
    for (let i = 0; i < 15; i++) {
      await record.execute(scope, exchange(ars, usd, 155_730_000n, 100_000n));
    }
    expect(movements.rows).toHaveLength(60);
    expect(limiter.countFor(ALICE, WINDOW_START)).toBe(60);

    const error = await record.execute(scope, transfer(ars1, ars2)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MovementWriteRateLimited);
    expect(error).toMatchObject({ code: 'RATE_LIMITED' });
    expect(movements.rows).toHaveLength(60);
    expect(limiter.countFor(ALICE, WINDOW_START)).toBe(60);
  });
});

describe('new domain errors', () => {
  it('are AppErrors with the codes of the shared catalog', () => {
    const cases = [
      [new MovementSameAccount(), 'MOVEMENT_SAME_ACCOUNT'],
      [new MovementCurrencyMismatch(), 'MOVEMENT_CURRENCY_MISMATCH'],
      [new ExchangeSameCurrency(), 'EXCHANGE_SAME_CURRENCY'],
      [new ImpliedRateOutOfRange(), 'IMPLIED_RATE_OUT_OF_RANGE'],
    ] as const;
    for (const [error, code] of cases) {
      expect(error).toBeInstanceOf(AppError);
      expect(error.code).toBe(code);
      expect(ERROR_CODES).toContain(code);
    }
  });

  it('keeps the constructor keys of the stored-data ports only (NFR-03)', () => {
    const keys = Object.keys((create as unknown as { deps: Record<string, unknown> }).deps).sort();
    expect(keys).toEqual(['accounts', 'categories', 'clock', 'movements', 'preferences', 'rates']);
  });
});

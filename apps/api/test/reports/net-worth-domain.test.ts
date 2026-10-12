import { describe, expect, it } from 'vitest';
import { accumulate, assemblePoints, type AssembleInput } from '../../src/reports/domain/net-worth';

const amounts = (ars: bigint, usd = 0n) => ({ ARS: ars, USD: usd });

function input(overrides: Partial<AssembleInput> = {}): AssembleInput {
  return {
    points: [
      { date: '2026-06-30', month: '2026-06' },
      { date: '2026-07-31', month: '2026-07' },
    ],
    accounts: {
      opening: amounts(1_000_000n),
      baseline: amounts(500_000n),
      byMonth: new Map([
        ['2026-06', amounts(-200_000n, 10_000n)],
        ['2026-07', amounts(100_000n)],
      ]),
    },
    groups: { baseline: amounts(0n), byMonth: new Map() },
    investments: { values: new Map(), incompleteDates: new Set<string>() },
    debt: new Map(),
    rates: new Map([
      ['2026-06-30', 15_000_000n],
      ['2026-07-31', 16_000_000n],
    ]),
    displayCurrency: 'ARS',
    ...overrides,
  };
}

describe('accumulate', () => {
  it('adds opening, baseline and every bucket up to each point month', () => {
    const result = accumulate(
      amounts(100n),
      amounts(10n),
      new Map([
        ['2026-05', amounts(1n)],
        ['2026-06', amounts(2n)],
        ['2026-07', amounts(4n)],
      ]),
      ['2026-06', '2026-07'],
    );
    expect(result.get('2026-06')).toEqual(amounts(113n));
    expect(result.get('2026-07')).toEqual(amounts(117n));
  });
});

describe('assemblePoints', () => {
  it('adds accounts, investments and groups and subtracts the installment debt per currency', () => {
    const [june, july] = assemblePoints(
      input({
        groups: { baseline: amounts(300n), byMonth: new Map([['2026-07', amounts(50n, 1n)]]) },
        investments: {
          values: new Map([['2026-06-30', amounts(1_000n, 5n)]]),
          incompleteDates: new Set(['2026-07-31']),
        },
        debt: new Map([
          ['2026-06-30', amounts(400n, 0n)],
          ['2026-07-31', amounts(100n, 0n)],
        ]),
        rates: new Map([
          ['2026-06-30', null],
          ['2026-07-31', null],
        ]),
      }),
    );
    // june ars: 1_000_000 + 500_000 - 200_000 + 1_000 + 300 - 400
    expect(june?.ars).toBe(1_300_900n);
    expect(june?.usd).toBe(10_005n);
    expect(june?.investmentsIncomplete).toBe(false);
    // july ars: 1_300_000 + 100_000 + 300 + 50 - 100
    expect(july?.ars).toBe(1_400_250n);
    expect(july?.usd).toBe(10_001n);
    expect(july?.investmentsIncomplete).toBe(true);
  });

  it('converts the USD component to ARS with the point rate (display ARS)', () => {
    const [june] = assemblePoints(
      input({
        accounts: { opening: amounts(0n, 100_000n), baseline: amounts(0n), byMonth: new Map() },
      }),
    );
    // 1,000.00 USD at 1,500.0000 is 1,500,000.00 ARS
    expect(june?.total).toBe(150_000_000n);
    expect(june?.reason).toBeNull();
  });

  it('divides the ARS component by the rate in display USD', () => {
    const [june] = assemblePoints(
      input({
        displayCurrency: 'USD',
        accounts: { opening: amounts(150_000_000n), baseline: amounts(0n), byMonth: new Map() },
      }),
    );
    expect(june?.total).toBe(100_000n);
  });

  it('returns a null total and no_rate when the rate is missing and the foreign part is non-zero', () => {
    const [june] = assemblePoints(
      input({
        rates: new Map([['2026-06-30', null]]),
        accounts: { opening: amounts(10n, 5n), baseline: amounts(0n), byMonth: new Map() },
      }),
    );
    expect(june).toMatchObject({ ars: 10n, usd: 5n, total: null, reason: 'no_rate' });
  });

  it('returns the home component without a rate when the foreign component is zero', () => {
    const [june] = assemblePoints(
      input({
        rates: new Map([['2026-06-30', null]]),
        accounts: { opening: amounts(10n, 0n), baseline: amounts(0n), byMonth: new Map() },
      }),
    );
    expect(june).toMatchObject({ total: 10n, reason: null });
  });
});

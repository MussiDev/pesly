import { describe, expect, it } from 'vitest';
import type { DashboardContext } from '../../src/dashboard/application/dashboard-context';
import { netWorthPartsNow, netWorthWindow } from '../../src/dashboard/domain/net-worth-now';

const ZONE = 'America/Argentina/Buenos_Aires';
const ZERO = { ARS: 0n, USD: 0n };

function context(today: string): DashboardContext {
  return {
    preferences: { displayCurrency: 'ARS', defaultRateType: 'mep', timeZone: ZONE },
    today,
    month: today.slice(0, 7),
    monthStart: `${today.slice(0, 7)}-01`,
    userId: 'u',
  };
}

describe('net worth now: window', () => {
  it('(D4) is one point dated today, from the first local instant of the month to after today', () => {
    const window = netWorthWindow(context('2026-10-06'));

    expect(window.timeZone).toBe(ZONE);
    expect(window.start.toISOString()).toBe('2026-10-01T03:00:00.000Z');
    expect(window.end.toISOString()).toBe('2026-10-07T03:00:00.000Z');
    expect(window.points).toHaveLength(1);
    expect(window.points[0]).toMatchObject({ date: '2026-10-06', month: '2026-10' });
    expect(window.points[0]?.end).toEqual(window.end);
  });
});

describe('net worth now: parts', () => {
  it('(AC-04) adds accounts, investments and groups and subtracts the installment debt', () => {
    const parts = netWorthPartsNow({
      context: context('2026-10-06'),
      accounts: {
        opening: { ARS: 90000000n, USD: 0n },
        baseline: { ARS: 5000000n, USD: 0n },
        byMonth: new Map([['2026-10', { ARS: 5000000n, USD: 0n }]]),
      },
      debtRows: [
        {
          period: '2026-11',
          closingDate: '2026-11-20',
          closingDay: 20,
          dueDay: 5,
          purchaseMonth: '2026-09',
          currency: 'ARS',
          sum: 11000000n,
        },
      ],
      investments: { ARS: 50000000n, USD: 0n, holdingsWithoutPrice: 0 },
      groupNet: { ARS: 3000000n, USD: 0n },
      rate: null,
    });

    expect(parts.parts.accounts).toEqual({ ARS: 100000000n, USD: 0n });
    expect(parts.parts.installmentDebt).toEqual({ ARS: 11000000n, USD: 0n });
    expect(parts.ars).toBe(142000000n);
    expect(parts.usd).toBe(0n);
    expect(parts.total).toBe(142000000n);
    expect(parts.reason).toBeNull();
  });

  it('(AC-09) a non-zero foreign part with no rate has no total and the reason no_rate', () => {
    const parts = netWorthPartsNow({
      context: context('2026-10-06'),
      accounts: { opening: { ARS: 0n, USD: 100000n }, baseline: ZERO, byMonth: new Map() },
      debtRows: [],
      investments: { ARS: 0n, USD: 0n, holdingsWithoutPrice: 0 },
      groupNet: ZERO,
      rate: null,
    });

    expect(parts.total).toBeNull();
    expect(parts.reason).toBe('no_rate');
    expect(parts.usd).toBe(100000n);
  });

  it('(AC-10) a zero foreign part with no rate gives the home part', () => {
    const parts = netWorthPartsNow({
      context: context('2026-10-06'),
      accounts: { opening: { ARS: 700n, USD: 0n }, baseline: ZERO, byMonth: new Map() },
      debtRows: [],
      investments: { ARS: 0n, USD: 0n, holdingsWithoutPrice: 0 },
      groupNet: ZERO,
      rate: null,
    });

    expect(parts.total).toBe(700n);
    expect(parts.reason).toBeNull();
  });
});

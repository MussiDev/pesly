import { describe, expect, it } from 'vitest';
import { buildNetWorth } from '../../src/dashboard/application/build-net-worth';
import type { DashboardContext } from '../../src/dashboard/application/dashboard-context';
import type { InvestmentValuation } from '../../src/dashboard/application/ports/investment-valuation';
import { assemblePoints, type NetWorthRateReader } from '../../src/reports';
import type {
  AccountFlows,
  InstallmentDebtRow,
} from '../../src/reports/application/ports/net-worth-sources';
import { readScope } from '../movements/db-fixtures';

const ME = '11111111-1111-1111-1111-111111111111';
const ZERO = { ARS: 0n, USD: 0n };

function context(displayCurrency: 'ARS' | 'USD' = 'ARS'): DashboardContext {
  return {
    preferences: {
      displayCurrency,
      defaultRateType: 'mep',
      timeZone: 'America/Argentina/Buenos_Aires',
    },
    today: '2026-10-06',
    month: '2026-10',
    monthStart: '2026-10-01',
    userId: ME,
  };
}

function accounts(opening = ZERO, current = ZERO): AccountFlows {
  return { opening, baseline: ZERO, byMonth: new Map([['2026-10', current]]) };
}

function setup(
  options: {
    accounts?: AccountFlows;
    debt?: InstallmentDebtRow[];
    investments?: { ARS: bigint; USD: bigint; holdingsWithoutPrice: number };
    rate?: bigint | null;
  } = {},
) {
  const rateCalls: unknown[][] = [];
  const rates: NetWorthRateReader = {
    sellRates: (type, dates, today) => {
      rateCalls.push([type, dates, today]);
      return Promise.resolve(new Map(dates.map((date) => [date, options.rate ?? null])));
    },
  };
  const investments: InvestmentValuation = {
    valueNow: () =>
      Promise.resolve(options.investments ?? { ARS: 0n, USD: 0n, holdingsWithoutPrice: 0 }),
  };
  return {
    rateCalls,
    deps: {
      sources: {
        accountFlows: () => Promise.resolve(options.accounts ?? accounts()),
        installmentDebtRows: () => Promise.resolve(options.debt ?? []),
      },
      rates,
      investments,
    },
  };
}

const debtRow = (sum: bigint, currency = 'ARS'): InstallmentDebtRow => ({
  period: '2026-11',
  closingDate: '2026-11-20',
  closingDay: 20,
  dueDay: 5,
  purchaseMonth: '2026-09',
  currency,
  sum,
});

describe('net worth section', () => {
  it('(AC-04, AC-07) returns the four parts separately and the hand-computed ARS part', async () => {
    const { deps } = setup({
      accounts: accounts({ ARS: 100000000n, USD: 0n }),
      debt: [debtRow(11000000n)],
      investments: { ARS: 50000000n, USD: 0n, holdingsWithoutPrice: 0 },
    });

    const section = await buildNetWorth(deps, await readScope(ME), context(), {
      ARS: 3000000n,
      USD: 0n,
    });

    expect(section.ars).toBe(142000000n);
    expect(section.parts).toEqual({
      accounts: { ARS: 100000000n, USD: 0n },
      investments: { ARS: 50000000n, USD: 0n },
      groups: { ARS: 3000000n, USD: 0n },
      installmentDebt: { ARS: 11000000n, USD: 0n },
    });
  });

  it('(AC-05) USD accounts and group debt give the USD part and leave the ARS part alone', async () => {
    const { deps } = setup({ accounts: accounts({ ARS: 100n, USD: 100000n }) });

    const section = await buildNetWorth(deps, await readScope(ME), context(), {
      ARS: 0n,
      USD: -2000n,
    });

    expect(section.usd).toBe(98000n);
    expect(section.ars).toBe(100n);
  });

  it('(AC-06) the account reader result is the only account source (archived are excluded there)', async () => {
    const { deps } = setup({ accounts: accounts({ ARS: 500n, USD: 0n }) });

    const section = await buildNetWorth(deps, await readScope(ME), context(), ZERO);

    expect(section.parts.accounts.ARS).toBe(500n);
  });

  it('(AC-08) converts the USD part at the stored sell rate into the display currency', async () => {
    const { deps, rateCalls } = setup({
      accounts: accounts({ ARS: 0n, USD: 100000n }),
      rate: 15_000_000n,
    });

    const section = await buildNetWorth(deps, await readScope(ME), context(), ZERO);

    expect(section.total).toBe(150000000n);
    expect(section.reason).toBeNull();
    expect(rateCalls).toEqual([['mep', ['2026-10-06'], '2026-10-06']]);
  });

  it('(AC-09) no rate with a USD part gives a null total, no_rate and both parts', async () => {
    const { deps } = setup({ accounts: accounts({ ARS: 300n, USD: 100000n }) });

    const section = await buildNetWorth(deps, await readScope(ME), context(), ZERO);

    expect(section).toMatchObject({ ars: 300n, usd: 100000n, total: null, reason: 'no_rate' });
  });

  it('(AC-10) no rate with a zero USD part gives the ARS part as total', async () => {
    const { deps } = setup({ accounts: accounts({ ARS: 300n, USD: 0n }) });

    const section = await buildNetWorth(deps, await readScope(ME), context(), ZERO);

    expect(section).toMatchObject({ total: 300n, reason: null });
  });

  it('(AC-11) display USD converts the ARS part with the rounding of convertMinorUnits', async () => {
    const { deps } = setup({ accounts: accounts({ ARS: 150000000n, USD: 0n }), rate: 15_000_000n });

    const section = await buildNetWorth(deps, await readScope(ME), context('USD'), ZERO);

    expect(section.total).toBe(100000n);
  });

  it('(AC-13) reports the holdings without a price from the valuation', async () => {
    const { deps } = setup({ investments: { ARS: 0n, USD: 0n, holdingsWithoutPrice: 1 } });

    const section = await buildNetWorth(deps, await readScope(ME), context(), ZERO);

    expect(section.holdingsWithoutPrice).toBe(1);
  });

  it('(FR-15) matches the 09a assemblePoints result for the same inputs apart from investments', async () => {
    const flows = accounts({ ARS: 700n, USD: 40n }, { ARS: 30n, USD: -5n });
    const { deps } = setup({ accounts: flows, debt: [debtRow(100n)], rate: 15_000_000n });

    const section = await buildNetWorth(deps, await readScope(ME), context(), {
      ARS: 9n,
      USD: 2n,
    });

    const [point] = assemblePoints({
      points: [{ date: '2026-10-06', month: '2026-10' }],
      accounts: flows,
      groups: { baseline: { ARS: 9n, USD: 2n }, byMonth: new Map() },
      investments: { values: new Map(), incompleteDates: new Set() },
      debt: new Map([['2026-10-06', { ARS: 100n, USD: 0n }]]),
      rates: new Map([['2026-10-06', 15_000_000n]]),
      displayCurrency: 'ARS',
    });
    expect(section).toMatchObject({ ars: point?.ars, usd: point?.usd, total: point?.total });
  });

  it('(FR-16) a source or rate error rejects the section and returns no part', async () => {
    const failingSource = setup().deps;
    failingSource.sources.installmentDebtRows = () => Promise.reject(new Error('debt down'));
    await expect(
      buildNetWorth(failingSource, await readScope(ME), context(), ZERO),
    ).rejects.toThrow('debt down');

    const failingRate = setup().deps;
    failingRate.rates = { sellRates: () => Promise.reject(new Error('rate down')) };
    await expect(buildNetWorth(failingRate, await readScope(ME), context(), ZERO)).rejects.toThrow(
      'rate down',
    );
  });
});

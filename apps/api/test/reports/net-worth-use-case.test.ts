import { describe, expect, it } from 'vitest';
import { ReportRangeError, type RateType } from '@pesly/shared';
import { GetNetWorth } from '../../src/reports/application/get-net-worth';
import type { NetWorthRateReader } from '../../src/reports/application/ports/net-worth-rate-reader';
import type {
  NetWorthSources,
  NetWorthWindow,
} from '../../src/reports/application/ports/net-worth-sources';
import { presentNetWorth } from '../../src/reports/infrastructure/http/present-net-worth';
import { readScope } from '../movements/db-fixtures';
import { FakeFilterReader, FakePreferences, FixedClock } from './fakes';

type Amounts = { ARS: bigint; USD: bigint };

class FakeSources implements NetWorthSources {
  calls = 0;
  windows: NetWorthWindow[] = [];
  usd = 100_000n;

  accountFlows(_scope: unknown, window: NetWorthWindow) {
    this.calls += 1;
    this.windows.push(window);
    return Promise.resolve({
      opening: { ARS: 5_000_000n, USD: this.usd },
      baseline: { ARS: 0n, USD: 0n },
      byMonth: new Map<string, Amounts>(),
    });
  }
  groupFlows() {
    this.calls += 1;
    return Promise.resolve({
      baseline: { ARS: 1_000_000n, USD: 0n },
      byMonth: new Map<string, Amounts>(),
    });
  }
  investmentValues() {
    this.calls += 1;
    return Promise.resolve({
      values: new Map<string, Amounts>(),
      incompleteDates: new Set<string>(),
    });
  }
  installmentDebtRows() {
    this.calls += 1;
    return Promise.resolve([
      {
        period: '2027-01',
        closingDate: '2027-01-20',
        closingDay: 20,
        dueDay: 5,
        purchaseMonth: '2025-10',
        currency: 'ARS',
        sum: 400_000n,
      },
    ]);
  }
}

class FakeRates implements NetWorthRateReader {
  calls: { rateType: RateType; dates: string[]; today: string }[] = [];
  fail = false;
  constructor(private readonly byDate: Record<string, bigint | null> = {}) {}
  sellRates(rateType: RateType, dates: readonly string[], today: string) {
    this.calls.push({ rateType, dates: [...dates], today });
    if (this.fail) return Promise.reject(new Error('rates down'));
    return Promise.resolve(new Map(dates.map((d) => [d, this.byDate[d] ?? null] as const)));
  }
}

async function build(
  options: {
    sources?: FakeSources;
    rates?: FakeRates;
    display?: 'ARS' | 'USD';
  } = {},
) {
  const sources = options.sources ?? new FakeSources();
  const rates = options.rates ?? new FakeRates();
  const useCase = new GetNetWorth({
    clock: new FixedClock(),
    preferences: new FakePreferences({
      displayCurrency: options.display ?? 'ARS',
      defaultRateType: 'mep',
      timeZone: 'America/Argentina/Buenos_Aires',
    }),
    filters: new FakeFilterReader(),
    sources,
    rates,
    present: presentNetWorth,
  });
  const scope = await readScope('11111111-1111-4111-8111-111111111111');
  return { useCase, sources, rates, scope };
}

describe('GetNetWorth', () => {
  it('returns 12 points in date order for 2025-10-01 to 2026-09-30', async () => {
    const { useCase, scope } = await build();
    const response = await useCase.execute(scope, { from: '2025-10-01', to: '2026-09-30' });
    const dates = response.points.map((p) => p.date);
    expect(dates).toHaveLength(12);
    expect(dates).toEqual([...dates].sort());
    expect(dates[0]).toBe('2025-10-31');
    expect(dates[11]).toBe('2026-09-30');
    for (const point of response.points) {
      expect(typeof point.ars).toBe('string');
      expect(typeof point.usd).toBe('string');
      expect(point.total === null).toBe(point.reason !== null);
    }
    expect(response).toMatchObject({ currency: 'ARS', from: '2025-10-01', to: '2026-09-30' });
  });

  it('rejects a range over 24 months before any source runs', async () => {
    const { useCase, scope, sources } = await build();
    await expect(
      useCase.execute(scope, { from: '2024-01-01', to: '2026-09-30' }),
    ).rejects.toBeInstanceOf(ReportRangeError);
    expect(sources.calls).toBe(0);
  });

  it('defaults to 12 months ending today', async () => {
    const { useCase, scope } = await build();
    const response = await useCase.execute(scope, {});
    expect(response.points).toHaveLength(12);
    expect(response.points[11]?.date).toBe('2026-10-06');
  });

  it('converts with the default rate type and the rate of the point date, never a later one', async () => {
    const rates = new FakeRates({ '2026-06-30': 12_000_000n, '2026-07-31': 99_990_000n });
    const { useCase, scope } = await build({ rates });
    const response = await useCase.execute(scope, { from: '2026-06-01', to: '2026-07-31' });
    expect(rates.calls).toHaveLength(1);
    expect(rates.calls[0]).toEqual({
      rateType: 'mep',
      dates: ['2026-06-30', '2026-07-31'],
      today: '2026-10-06',
    });
    const june = response.points[0];
    // ars 5,000,000 + 1,000,000 - 400,000; usd 100,000 at 1,200.0000 = 120,000,000
    expect(june?.ars).toBe('5600000');
    expect(june?.total).toBe('125600000');
  });

  it('returns both components, a null total and no_rate without a rate', async () => {
    const { useCase, scope } = await build();
    const response = await useCase.execute(scope, { from: '2026-06-01', to: '2026-06-30' });
    expect(response.points[0]).toMatchObject({ usd: '100000', total: null, reason: 'no_rate' });
  });

  it('keeps a total without a rate when the USD component is zero', async () => {
    const sources = new FakeSources();
    sources.usd = 0n;
    const { useCase, scope } = await build({ sources });
    const response = await useCase.execute(scope, { from: '2026-06-01', to: '2026-06-30' });
    expect(response.points[0]).toMatchObject({ total: '5600000', reason: null });
  });

  it('converts to USD with the convertMinorUnits rounding when the display currency is USD', async () => {
    const rates = new FakeRates({ '2026-06-30': 15_000_000n });
    const sources = new FakeSources();
    sources.usd = 0n;
    const { useCase, scope } = await build({ rates, sources, display: 'USD' });
    const response = await useCase.execute(scope, { from: '2026-06-01', to: '2026-06-30' });
    // 5,600,000 ARS minor units at 1,500.0000 is 3,733.33 minor USD
    expect(response.points[0]?.total).toBe('3733');
    expect(response.currency).toBe('USD');
  });

  it('ends a range that includes the current month with a point dated today', async () => {
    const rates = new FakeRates({ '2026-10-06': 17_000_000n });
    const { useCase, scope, sources } = await build({ rates });
    const response = await useCase.execute(scope, { from: '2026-09-01', to: '2026-10-06' });
    expect(response.points.map((p) => p.date)).toEqual(['2026-09-30', '2026-10-06']);
    expect(response.points[1]?.total).not.toBeNull();
    expect(sources.windows[0]?.points[1]?.end.toISOString()).toBe('2026-10-07T03:00:00.000Z');
    expect(sources.windows[0]?.start.toISOString()).toBe('2026-09-01T03:00:00.000Z');
  });

  it('propagates a rate reader error and builds no response', async () => {
    const rates = new FakeRates();
    rates.fail = true;
    const { useCase, scope } = await build({ rates });
    await expect(useCase.execute(scope, { from: '2026-06-01', to: '2026-06-30' })).rejects.toThrow(
      'rates down',
    );
  });
});

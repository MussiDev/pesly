import { beforeEach, describe, expect, it } from 'vitest';
import {
  BACKOFF_CEILING_MS,
  LEASE_MS,
  MAX_SYMBOLS_PER_CALL,
  MONTHLY_CALL_LIMIT,
  REFRESH_INTERVAL_MS,
  RETRY_DELAY_MS,
  RefreshCryptoPrices,
} from '../../src/investments/application/refresh-crypto-prices';
import { PriceProviderFailure } from '../../src/investments/domain/price-failure';
import { MutableClock } from '../fakes/mutable-clock';
import {
  InMemoryCryptoPrices,
  InMemoryPriceFailureLog,
  InMemoryPriceSchedule,
  ScriptedPriceProvider,
} from './fakes/in-memory-prices';

const MINUTE = 60_000;
const START = new Date('2026-10-01T00:00:00.000Z');

describe('RefreshCryptoPrices', () => {
  let provider: ScriptedPriceProvider;
  let prices: InMemoryCryptoPrices;
  let schedule: InMemoryPriceSchedule;
  let failures: InMemoryPriceFailureLog;
  let clock: MutableClock;
  let refresh: RefreshCryptoPrices;

  beforeEach(() => {
    provider = new ScriptedPriceProvider();
    provider.prices.set('btc', 6_789_012n);
    provider.prices.set('eth', 351_234n);
    prices = new InMemoryCryptoPrices();
    schedule = new InMemoryPriceSchedule();
    failures = new InMemoryPriceFailureLog();
    clock = new MutableClock(START);
    refresh = new RefreshCryptoPrices({ provider, prices, schedule, failures, clock });
  });

  it('exposes the documented constants', () => {
    expect(REFRESH_INTERVAL_MS).toBe(3_600_000);
    expect(RETRY_DELAY_MS).toBe(900_000);
    expect(BACKOFF_CEILING_MS).toBe(3_600_000);
    expect(LEASE_MS).toBe(300_000);
    expect(MONTHLY_CALL_LIMIT).toBe(1_000);
    expect(MAX_SYMBOLS_PER_CALL).toBe(100);
  });

  it('prices every crypto holding of the answered symbols without a manual price and leaves other types alone', async () => {
    const btc = prices.addHolding('BTC');
    const eth = prices.addHolding('eth');
    const btcTwo = prices.addHolding('btc');
    const stock = prices.addHolding('BTC', { type: 'stock', currency: 'USD' });

    const result = await refresh.execute();

    expect(result).toEqual({ outcome: 'refreshed', markets: 2, updated: 3, unpriced: 0 });
    expect(provider.requests).toEqual([['btc', 'eth']]);
    expect(btc.price).toEqual({ unitPrice: 6_789_012n, source: 'automatic', pricedAt: START });
    expect(btcTwo.price).toEqual({ unitPrice: 6_789_012n, source: 'automatic', pricedAt: START });
    expect(eth.price).toEqual({ unitPrice: 351_234n, source: 'automatic', pricedAt: START });
    expect(stock.price).toBeNull();
    expect(schedule.nextAttemptAt).toEqual(new Date(START.getTime() + REFRESH_INTERVAL_MS));
  });

  it('hands storeAndApply the time the request started, not the time it finished', async () => {
    prices.addHolding('btc');
    const slow = new (class extends ScriptedPriceProvider {
      override async fetchPrices(symbols: readonly string[]) {
        clock.advance(2 * MINUTE);
        return super.fetchPrices(symbols);
      }
    })();
    slow.prices.set('btc', 100n);
    const job = new RefreshCryptoPrices({ provider: slow, prices, schedule, failures, clock });

    await job.execute();

    expect(prices.applyCalls[0]?.requestedAt).toEqual(START);
    expect(schedule.lastSuccessAt).toEqual(new Date(START.getTime() + 2 * MINUTE));
  });

  it('keeps a manual price of 60,000.00 USD and its source while the market price is stored, and prices a holding without a price', async () => {
    const manualPricedAt = new Date('2026-09-30T00:00:00.000Z');
    const manual = prices.addHolding('btc', {
      price: { unitPrice: 6_000_000n, source: 'manual', pricedAt: manualPricedAt },
    });
    const bare = prices.addHolding('eth');

    const result = await refresh.execute();

    expect(result).toEqual({ outcome: 'refreshed', markets: 2, updated: 1, unpriced: 0 });
    expect(manual.price).toEqual({
      unitPrice: 6_000_000n,
      source: 'manual',
      pricedAt: manualPricedAt,
    });
    expect(prices.markets.get('btc')).toEqual({ unitPrice: 6_789_012n, pricedAt: START });
    expect(bare.price?.source).toBe('automatic');
  });

  it('never replaces a newer stored market price and does not overwrite a newer holding price', async () => {
    const newer = new Date(START.getTime() + 10 * MINUTE);
    prices.markets.set('btc', { unitPrice: 7_000_000n, pricedAt: newer });
    const holding = prices.addHolding('btc', {
      price: { unitPrice: 7_000_000n, source: 'automatic', pricedAt: newer },
    });

    const result = await refresh.execute();

    expect(result).toMatchObject({ outcome: 'refreshed', markets: 0, updated: 0 });
    expect(prices.markets.get('btc')?.unitPrice).toBe(7_000_000n);
    expect(holding.price?.unitPrice).toBe(7_000_000n);
  });

  it('a provider failure (error) leaves every price as it was, records the code and backs off 15 then 30 minutes', async () => {
    const before = {
      unitPrice: 5_000_000n,
      source: 'automatic',
      pricedAt: new Date('2026-09-30T00:00:00.000Z'),
    } as const;
    const holding = prices.addHolding('btc', { price: before });
    provider.error = new PriceProviderFailure('provider_bad_status', { statusCode: 500 });

    const first = await refresh.execute();

    expect(first).toEqual({ outcome: 'failed', code: 'provider_bad_status' });
    expect(holding.price).toEqual(before);
    expect(prices.applyCalls).toEqual([]);
    expect(failures.records).toEqual([{ at: START, code: 'provider_bad_status', statusCode: 500 }]);
    expect(schedule.nextAttemptAt).toEqual(new Date(START.getTime() + 15 * MINUTE));

    clock.advance(15 * MINUTE);
    const second = await refresh.execute();

    expect(second).toEqual({ outcome: 'failed', code: 'provider_bad_status' });
    expect(failures.records).toHaveLength(2);
    expect(schedule.nextAttemptAt).toEqual(new Date(clock.now().getTime() + 30 * MINUTE));

    clock.advance(30 * MINUTE);
    await refresh.execute();
    expect(schedule.nextAttemptAt).toEqual(new Date(clock.now().getTime() + 60 * MINUTE));
    clock.advance(60 * MINUTE);
    await refresh.execute();
    expect(schedule.nextAttemptAt).toEqual(new Date(clock.now().getTime() + 60 * MINUTE));
  });

  it('after a failure a success returns to the hourly interval', async () => {
    prices.addHolding('btc');
    provider.error = new PriceProviderFailure('provider_timeout');
    await refresh.execute();
    provider.error = null;
    clock.advance(15 * MINUTE);

    const result = await refresh.execute();

    expect(result.outcome).toBe('refreshed');
    expect(schedule.consecutiveFailures).toBe(0);
    expect(schedule.nextAttemptAt).toEqual(new Date(clock.now().getTime() + REFRESH_INTERVAL_MS));
  });

  it('a symbol missing from the answer and a sub-cent price keep the previous price', async () => {
    const old = new Date('2026-09-30T00:00:00.000Z');
    const doge = prices.addHolding('doge', {
      price: { unitPrice: 8n, source: 'automatic', pricedAt: old },
    });
    const shib = prices.addHolding('shib', {
      price: { unitPrice: 2n, source: 'import', pricedAt: old },
    });
    const btc = prices.addHolding('btc');
    // doge is absent from the answer; shib was priced below one cent, so the adapter dropped it.

    const result = await refresh.execute();

    expect(result).toEqual({ outcome: 'refreshed', markets: 1, updated: 1, unpriced: 2 });
    expect(doge.price?.unitPrice).toBe(8n);
    expect(shib.price).toEqual({ unitPrice: 2n, source: 'import', pricedAt: old });
    expect(prices.markets.has('doge')).toBe(false);
    expect(btc.price?.unitPrice).toBe(6_789_012n);
  });

  it('two concurrent executions produce one provider call and the second is not_due', async () => {
    prices.addHolding('btc');

    const [a, b] = await Promise.all([refresh.execute(), refresh.execute()]);

    expect([a.outcome, b.outcome].sort()).toEqual(['not_due', 'refreshed']);
    expect(provider.calls).toBe(1);
    expect(schedule.usage.get('2026-10')).toBe(1);
  });

  it('a second call before the interval is not_due and calls nothing', async () => {
    prices.addHolding('btc');
    await refresh.execute();
    clock.advance(30 * MINUTE);

    const result = await refresh.execute();

    expect(result).toEqual({ outcome: 'not_due' });
    expect(provider.calls).toBe(1);
    expect(prices.symbolCalls).toHaveLength(1);
  });

  it('no crypto holdings reschedules one interval later without a provider call or a reserved call', async () => {
    prices.addHolding('AAPL', { type: 'stock' });

    const result = await refresh.execute();

    expect(result).toEqual({ outcome: 'no_crypto_holdings' });
    expect(provider.calls).toBe(0);
    expect(schedule.reservations).toEqual([]);
    expect(schedule.nextAttemptAt).toEqual(new Date(START.getTime() + REFRESH_INTERVAL_MS));
  });

  it('asks for at most 100 symbols', async () => {
    prices.addHolding('btc');

    await refresh.execute();

    expect(prices.symbolCalls).toEqual([100]);
  });

  it('a storage error propagates, records no provider failure and still backs off 15 minutes', async () => {
    prices.addHolding('btc');
    prices.applyError = new Error('connection lost');

    await expect(refresh.execute()).rejects.toThrow('connection lost');

    expect(failures.records).toEqual([]);
    expect(schedule.nextAttemptAt).toEqual(new Date(START.getTime() + 15 * MINUTE));
    expect(schedule.consecutiveFailures).toBe(1);
  });

  it('10 retries over one simulated hour of a failing storage cost at most 3 reserved calls', async () => {
    prices.addHolding('btc');
    prices.applyError = new Error('connection lost');

    for (let attempt = 0; attempt < 10; attempt += 1) {
      await refresh.execute().catch(() => undefined);
      clock.advance(6 * MINUTE);
    }

    expect(schedule.reservations.length).toBeLessThanOrEqual(3);
    expect(provider.calls).toBeLessThanOrEqual(3);
  });

  it('an error from the failure log itself still advances the schedule and propagates', async () => {
    prices.addHolding('btc');
    provider.error = new PriceProviderFailure('provider_timeout');
    failures.recordError = new Error('log down');

    await expect(refresh.execute()).rejects.toThrow('log down');

    expect(schedule.nextAttemptAt).toEqual(new Date(START.getTime() + 15 * MINUTE));
    expect(schedule.consecutiveFailures).toBe(1);
  });

  it('an unexpected adapter error advances the schedule and propagates unchanged', async () => {
    prices.addHolding('btc');
    const boom = new TypeError('adapter bug');
    provider.error = boom;

    await expect(refresh.execute()).rejects.toBe(boom);

    expect(failures.records).toEqual([]);
    expect(schedule.nextAttemptAt).toEqual(new Date(START.getTime() + 15 * MINUTE));
  });

  it('a failure of the best-effort backoff never replaces the original error', async () => {
    prices.addHolding('btc');
    prices.applyError = new Error('connection lost');
    schedule.failedError = new Error('schedule down');

    await expect(refresh.execute()).rejects.toThrow('connection lost');
  });

  it('uses one clock reading for the month key and the request time', async () => {
    prices.addHolding('btc');
    const readings: Date[] = [];
    const ticking = {
      now: () => {
        const reading = new Date(START.getTime() + readings.length);
        readings.push(reading);
        return reading;
      },
    };
    const job = new RefreshCryptoPrices({ provider, prices, schedule, failures, clock: ticking });

    await job.execute();

    // claim, symbols/reserve reading, then the success time: three readings in total.
    expect(readings).toHaveLength(3);
    expect(prices.applyCalls[0]?.requestedAt).toEqual(readings[1]);
  });

  it('a budget used up (error) makes no call, defers one interval and keeps the counter at the limit', async () => {
    prices.addHolding('btc');
    schedule.usage.set('2026-10', 1_000);

    const result = await refresh.execute();

    expect(result).toEqual({ outcome: 'budget_exhausted' });
    expect(provider.calls).toBe(0);
    expect(schedule.usage.get('2026-10')).toBe(1_000);
    expect(schedule.nextAttemptAt).toEqual(new Date(START.getTime() + REFRESH_INTERVAL_MS));
    expect(failures.records).toEqual([]);
  });

  it('over 45 simulated days of hourly cycles plus a 3-day outage the reserved calls never exceed 1,000 in a month', async () => {
    prices.addHolding('btc');
    const outageStart = new Date('2026-10-10T00:00:00.000Z').getTime();
    const outageEnd = outageStart + 3 * 24 * 60 * MINUTE;
    const end = START.getTime() + 45 * 24 * 60 * MINUTE;

    while (clock.now().getTime() < end) {
      const now = clock.now().getTime();
      provider.error =
        now >= outageStart && now < outageEnd
          ? new PriceProviderFailure('provider_unreachable')
          : null;
      await refresh.execute();
      clock.advance(5 * MINUTE);
    }

    const months = [...schedule.usage.entries()];
    expect(months.map(([month]) => month).sort()).toEqual(['2026-10', '2026-11']);
    for (const [, calls] of months) expect(calls).toBeLessThanOrEqual(1_000);
    const total = months.reduce((sum, [, calls]) => sum + calls, 0);
    expect(provider.calls).toBe(total);
    expect(failures.records.length).toBeGreaterThan(0);
    // 15 and 30 minutes, then one an hour once backed off: an outage never costs more.
    expect(failures.records.length).toBeLessThanOrEqual(3 * 24 + 3);
  });

  it('the 1,001st reservation of a month returns budget_exhausted with no call', async () => {
    prices.addHolding('btc');
    provider.error = new PriceProviderFailure('provider_unreachable');
    for (let attempt = 0; attempt < 1_000; attempt += 1) {
      schedule.nextAttemptAt = null;
      await refresh.execute();
    }
    expect(provider.calls).toBe(1_000);

    schedule.nextAttemptAt = null;
    const result = await refresh.execute();

    expect(result).toEqual({ outcome: 'budget_exhausted' });
    expect(provider.calls).toBe(1_000);
    expect(schedule.usage.get('2026-10')).toBe(1_000);
  });
});

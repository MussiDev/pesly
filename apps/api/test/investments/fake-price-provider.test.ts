import { describe, expect, it } from 'vitest';
import { PriceProviderFailure } from '../../src/investments/domain/price-failure';
import { FakePriceProvider } from '../../src/investments/infrastructure/provider/fake-price-provider';

describe('FakePriceProvider', () => {
  it('answers fixed prices for btc, eth and sol and nothing for other symbols', async () => {
    const fake = new FakePriceProvider();
    const quotes = await fake.fetchPrices(['BTC', 'eth', 'sol', 'doge']);

    expect(quotes.map((quote) => quote.symbol)).toEqual(['btc', 'eth', 'sol']);
    for (const quote of quotes) expect(quote.unitPrice).toBeGreaterThan(0n);
    expect(await fake.fetchPrices(['btc'])).toEqual(quotes.slice(0, 1));
  });

  it('is deterministic across instances', async () => {
    expect(await new FakePriceProvider().fetchPrices(['btc'])).toEqual(
      await new FakePriceProvider().fetchPrices(['btc']),
    );
  });

  it('counts every call, failed ones included, and records the symbols asked', async () => {
    const fake = new FakePriceProvider();
    expect(fake.calls).toBe(0);
    await fake.fetchPrices(['btc']);
    fake.failWith(new PriceProviderFailure('provider_timeout'));
    await expect(fake.fetchPrices(['eth'])).rejects.toBeInstanceOf(PriceProviderFailure);
    expect(fake.calls).toBe(2);
    expect(fake.requests).toEqual([['btc'], ['eth']]);
  });

  it('fails on demand with the given failure and recovers', async () => {
    const fake = new FakePriceProvider();
    const failure = new PriceProviderFailure('provider_bad_status', { statusCode: 503 });
    fake.failWith(failure);
    await expect(fake.fetchPrices(['btc'])).rejects.toBe(failure);

    fake.recover();
    expect(await fake.fetchPrices(['btc'])).toHaveLength(1);
  });
});

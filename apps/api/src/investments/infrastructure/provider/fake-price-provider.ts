import type { PriceProvider } from '../../application/price-ports';
import type { PriceQuote } from '../../domain/crypto-price';
import type { PriceProviderFailure } from '../../domain/price-failure';

/** US cents. */
const FAKE_PRICES: ReadonlyMap<string, bigint> = new Map([
  ['btc', 6_789_012n],
  ['eth', 351_234n],
  ['sol', 15_432n],
]);

/** Deterministic, offline stand-in for CoinGecko (`PRICE_PROVIDER=fake`); never used in production. */
export class FakePriceProvider implements PriceProvider {
  /** Every call, failed ones included. */
  calls = 0;
  /** The symbols of every call, as received. */
  readonly requests: string[][] = [];
  private failure: PriceProviderFailure | undefined;

  failWith(failure: PriceProviderFailure): void {
    this.failure = failure;
  }

  recover(): void {
    this.failure = undefined;
  }

  fetchPrices(symbols: readonly string[]): Promise<PriceQuote[]> {
    this.calls += 1;
    this.requests.push([...symbols]);
    if (this.failure) return Promise.reject(this.failure);

    const quotes: PriceQuote[] = [];
    const seen = new Set<string>();
    for (const symbol of symbols.map((item) => item.toLowerCase())) {
      const unitPrice = FAKE_PRICES.get(symbol);
      if (unitPrice === undefined || seen.has(symbol)) continue;
      seen.add(symbol);
      quotes.push({ symbol, unitPrice });
    }
    return Promise.resolve(quotes);
  }
}

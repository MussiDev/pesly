import type { InstrumentType, PriceSource, ValuationCurrency } from '@pesly/shared';
import type {
  CryptoPriceRepository,
  PriceFailureLog,
  PriceFailureRecord,
  PriceProvider,
  PriceSchedule,
  SnapshotCandidate,
  SnapshotRepository,
  SnapshotRow,
} from '../../../src/investments/application/price-ports';
import type { PriceQuote } from '../../../src/investments/domain/crypto-price';

const MONTHLY_LIMIT = 1_000;

/** Answers the configured symbols it was asked for, or throws the configured error. */
export class ScriptedPriceProvider implements PriceProvider {
  calls = 0;
  requests: string[][] = [];
  prices = new Map<string, bigint>();
  error: Error | null = null;

  async fetchPrices(symbols: readonly string[]): Promise<PriceQuote[]> {
    await Promise.resolve();
    this.calls += 1;
    this.requests.push([...symbols]);
    if (this.error) throw this.error;
    const quotes: PriceQuote[] = [];
    for (const symbol of symbols) {
      const unitPrice = this.prices.get(symbol);
      if (unitPrice !== undefined) quotes.push({ symbol, unitPrice });
    }
    return quotes;
  }
}

export class InMemoryPriceSchedule implements PriceSchedule {
  nextAttemptAt: Date | null = null;
  lastSuccessAt: Date | null = null;
  consecutiveFailures = 0;
  readonly usage = new Map<string, number>();
  claims: { now: Date; leaseMs: number }[] = [];
  reservations: string[] = [];
  failedError: Error | null = null;

  async claim(now: Date, leaseMs: number) {
    await Promise.resolve();
    this.claims.push({ now, leaseMs });
    if (this.nextAttemptAt && this.nextAttemptAt.getTime() > now.getTime()) return null;
    this.nextAttemptAt = new Date(now.getTime() + leaseMs);
    return { lease: this.nextAttemptAt, consecutiveFailures: this.consecutiveFailures };
  }

  async succeeded(lease: Date, now: Date, intervalMs: number): Promise<void> {
    await Promise.resolve();
    if (this.nextAttemptAt?.getTime() !== lease.getTime()) return;
    this.nextAttemptAt = new Date(now.getTime() + intervalMs);
    this.lastSuccessAt = now;
    this.consecutiveFailures = 0;
  }

  async failed(lease: Date, now: Date, retryMs: number): Promise<void> {
    await Promise.resolve();
    if (this.failedError) throw this.failedError;
    if (this.nextAttemptAt?.getTime() !== lease.getTime()) return;
    this.nextAttemptAt = new Date(now.getTime() + retryMs);
    this.consecutiveFailures += 1;
  }

  async deferred(lease: Date, now: Date, delayMs: number): Promise<void> {
    await Promise.resolve();
    if (this.nextAttemptAt?.getTime() !== lease.getTime()) return;
    this.nextAttemptAt = new Date(now.getTime() + delayMs);
  }

  async reserveCall(month: string): Promise<boolean> {
    await Promise.resolve();
    this.reservations.push(month);
    const calls = this.usage.get(month) ?? 0;
    if (calls >= MONTHLY_LIMIT) return false;
    this.usage.set(month, calls + 1);
    return true;
  }
}

export class InMemoryPriceFailureLog implements PriceFailureLog {
  records: PriceFailureRecord[] = [];
  recordError: Error | null = null;

  async record(failure: PriceFailureRecord): Promise<void> {
    await Promise.resolve();
    if (this.recordError) throw this.recordError;
    this.records.push(failure);
  }

  async purgeOlderThan(cutoff: Date): Promise<number> {
    await Promise.resolve();
    const kept = this.records.filter((r) => r.at.getTime() >= cutoff.getTime());
    const purged = this.records.length - kept.length;
    this.records = kept;
    return purged;
  }
}

export interface PricedHolding {
  id: string;
  ticker: string;
  instrumentType: InstrumentType;
  valuationCurrency: ValuationCurrency;
  price: { unitPrice: bigint; source: PriceSource; pricedAt: Date } | null;
}

export interface MarketPrice {
  unitPrice: bigint;
  pricedAt: Date;
}

/** Models the two statements of the real `storeAndApply`: stored-if-newer, then apply by rules. */
export class InMemoryCryptoPrices implements CryptoPriceRepository {
  readonly holdings: PricedHolding[] = [];
  readonly markets = new Map<string, MarketPrice>();
  symbolCalls: number[] = [];
  applyCalls: { quotes: PriceQuote[]; requestedAt: Date }[] = [];
  applyError: Error | null = null;

  addHolding(
    ticker: string,
    options: {
      type?: InstrumentType;
      currency?: ValuationCurrency;
      price?: PricedHolding['price'];
    } = {},
  ): PricedHolding {
    const holding: PricedHolding = {
      id: `h${this.holdings.length + 1}`,
      ticker,
      instrumentType: options.type ?? 'crypto',
      valuationCurrency: options.currency ?? 'USD',
      price: options.price ?? null,
    };
    this.holdings.push(holding);
    return holding;
  }

  async symbolsToPrice(limit: number): Promise<string[]> {
    await Promise.resolve();
    this.symbolCalls.push(limit);
    const symbols = new Set(
      this.holdings.filter((h) => h.instrumentType === 'crypto').map((h) => h.ticker.toLowerCase()),
    );
    // Never priced first, then least recently priced, like the real NULLS FIRST ordering.
    const pricedAt = (symbol: string): number => this.markets.get(symbol)?.pricedAt.getTime() ?? -1;
    return [...symbols]
      .sort((a, b) => {
        const byTime = pricedAt(a) === pricedAt(b) ? 0 : pricedAt(a) < pricedAt(b) ? -1 : 1;
        return byTime || (a < b ? -1 : a > b ? 1 : 0);
      })
      .slice(0, limit);
  }

  async storeAndApply(
    quotes: readonly PriceQuote[],
    requestedAt: Date,
  ): Promise<{ markets: number; holdings: number }> {
    await Promise.resolve();
    this.applyCalls.push({ quotes: [...quotes], requestedAt });
    if (this.applyError) throw this.applyError;
    let markets = 0;
    for (const quote of quotes) {
      const stored = this.markets.get(quote.symbol);
      if (stored && stored.pricedAt.getTime() >= requestedAt.getTime()) continue;
      this.markets.set(quote.symbol, { unitPrice: quote.unitPrice, pricedAt: requestedAt });
      markets += 1;
    }
    let updated = 0;
    const answered = new Set(quotes.map((q) => q.symbol));
    for (const holding of this.holdings) {
      const symbol = holding.ticker.toLowerCase();
      const market = this.markets.get(symbol);
      if (
        holding.instrumentType !== 'crypto' ||
        holding.valuationCurrency !== 'USD' ||
        !market ||
        !answered.has(symbol) ||
        holding.price?.source === 'manual' ||
        (holding.price && holding.price.pricedAt.getTime() >= market.pricedAt.getTime())
      ) {
        continue;
      }
      holding.price = {
        unitPrice: market.unitPrice,
        source: 'automatic',
        pricedAt: market.pricedAt,
      };
      updated += 1;
    }
    return { markets, holdings: updated };
  }
}

export interface FakePortfolio {
  id: string;
  ownerId: string;
  zone: string;
  createdAt: Date;
  /** Priced holdings only; an empty list models a portfolio without any. */
  holdings: SnapshotCandidate['holdings'];
}

export class InMemorySnapshots implements SnapshotRepository {
  readonly portfolios: FakePortfolio[] = [];
  readonly rows = new Map<string, SnapshotRow>();
  pageRequests: { zone: string; date: string; afterId: string | null; limit: number }[] = [];
  saveCalls = 0;

  async zonesInUse(): Promise<string[]> {
    await Promise.resolve();
    return [...new Set(this.portfolios.map((p) => p.zone))];
  }

  async portfoliosToSnapshot(
    zone: string,
    date: string,
    afterId: string | null,
    limit: number,
  ): Promise<SnapshotCandidate[]> {
    await Promise.resolve();
    this.pageRequests.push({ zone, date, afterId, limit });
    const done = new Set(
      [...this.rows.values()].filter((r) => r.date === date).map((r) => r.portfolioId),
    );
    return this.portfolios
      .filter(
        (p) =>
          p.zone === zone &&
          p.holdings.length > 0 &&
          !done.has(p.id) &&
          (afterId === null || p.id > afterId),
      )
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .slice(0, limit)
      .map((p) => ({
        portfolioId: p.id,
        ownerId: p.ownerId,
        createdAt: p.createdAt,
        holdings: p.holdings,
      }));
  }

  async save(rows: readonly SnapshotRow[]): Promise<number> {
    await Promise.resolve();
    this.saveCalls += 1;
    let inserted = 0;
    for (const row of rows) {
      const key = `${row.portfolioId}|${row.date}|${row.currency}`;
      if (this.rows.has(key)) continue;
      this.rows.set(key, row);
      inserted += 1;
    }
    return inserted;
  }

  rowsOf(portfolioId: string): SnapshotRow[] {
    return [...this.rows.values()]
      .filter((r) => r.portfolioId === portfolioId)
      .sort((a, b) => (a.date + a.currency < b.date + b.currency ? -1 : 1));
  }
}

import { usdPriceToMinorUnits, type PriceQuote } from '../../domain/crypto-price';
import { PriceProviderFailure } from '../../domain/price-failure';

const SYMBOL_PATTERN = /^[a-z0-9._-]+$/;
const MAX_ENTRY_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * The third argument of a JSON.parse reviver is not in the repo's TypeScript lib. `source` is the
 * exact text of a primitive value and is absent when the engine does not provide it.
 */
interface ReviverContext {
  source?: string;
}

function invalidPayload(detail: string): PriceProviderFailure {
  return new PriceProviderFailure('provider_invalid_payload', { detail });
}

/**
 * The symbols a request may carry: lowercase, unique, and only characters that cannot change the
 * meaning of a query string.
 */
export function sanitizeSymbols(symbols: readonly string[]): string[] {
  const clean = new Set<string>();
  for (const symbol of symbols) {
    const lower = symbol.toLowerCase();
    if (SYMBOL_PATTERN.test(lower)) clean.add(lower);
  }
  return [...clean];
}

/**
 * The source text of every `current_price` number, by the object that holds it. The values are left
 * as parsed; only the entries of the top-level array look their source up afterwards, so a nested
 * `current_price` is never converted or priced. `null` marks a number whose text the engine did not
 * hand over.
 */
type PriceSources = WeakMap<object, string | null>;

// A price is read from its source text so it never passes through a binary float.
function sourceCollector(sources: PriceSources) {
  return function collect(this: unknown, key: string, value: unknown, context?: ReviverContext) {
    if (key === 'current_price' && typeof value === 'number' && typeof this === 'object' && this) {
      sources.set(this, context?.source ?? null);
    }
    return value;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface Candidate {
  symbol: string;
  rank: number | null;
  /** Source text of the price; `undefined` when the entry has no numeric price. */
  price: string | null | undefined;
}

function isBetter(candidate: Candidate, current: Candidate): boolean {
  if (candidate.rank === null) return false;
  return current.rank === null || candidate.rank < current.rank;
}

/**
 * Reads a CoinGecko `/coins/markets` answer. Only the symbols asked for come back, an entry that
 * was not updated in the last 24 hours is ignored (a delisted coin keeps its last price), and the
 * best ranked entry of a repeated symbol decides: a worse ranked clone never prices it.
 */
export function parseCoingeckoPayload(
  text: string,
  requested: readonly string[],
  now: Date,
): PriceQuote[] {
  const sources: PriceSources = new WeakMap();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text, sourceCollector(sources));
  } catch {
    throw invalidPayload('body is not JSON');
  }
  if (!Array.isArray(parsed)) throw invalidPayload('body is not an array');

  const wanted = new Set(requested.map((symbol) => symbol.toLowerCase()));
  const oldest = now.getTime() - MAX_ENTRY_AGE_MS;
  const best = new Map<string, Candidate>();

  for (const entry of parsed as unknown[]) {
    if (!isRecord(entry)) continue;
    const price = sources.get(entry);
    if (price === null) {
      throw invalidPayload('number source text is not available');
    }
    if (typeof entry.symbol !== 'string') continue;
    const symbol = entry.symbol.toLowerCase();
    if (!wanted.has(symbol)) continue;

    // A missing or unreadable date compares false and is ignored with the stale ones.
    const updatedAt = typeof entry.last_updated === 'string' ? Date.parse(entry.last_updated) : NaN;
    if (!(updatedAt >= oldest)) continue;

    const candidate: Candidate = {
      symbol,
      rank: typeof entry.market_cap_rank === 'number' ? entry.market_cap_rank : null,
      price,
    };
    const current = best.get(symbol);
    if (current === undefined || isBetter(candidate, current)) best.set(symbol, candidate);
  }

  const quotes: PriceQuote[] = [];
  for (const { symbol, price } of best.values()) {
    if (typeof price !== 'string') continue;
    const unitPrice = usdPriceToMinorUnits(price);
    if (unitPrice !== null) quotes.push({ symbol, unitPrice });
  }
  return quotes;
}

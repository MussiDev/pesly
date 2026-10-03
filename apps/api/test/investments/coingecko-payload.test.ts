import { afterEach, describe, expect, it, vi } from 'vitest';
import { PriceProviderFailure } from '../../src/investments/domain/price-failure';
import {
  parseCoingeckoPayload,
  sanitizeSymbols,
} from '../../src/investments/infrastructure/provider/coingecko-payload';

const NOW = new Date('2026-10-02T12:00:00.000Z');
const FRESH = '2026-10-02T11:58:00.000Z';

/** Builds the array text by hand so the price keeps the exact digits written here. */
function body(...entries: string[]): string {
  return `[${entries.join(',')}]`;
}

type Reviver = (this: unknown, key: string, value: unknown) => unknown;

/** A JSON.parse that, like an engine without source text access, never hands over the context. */
function stubParseWithoutSource(): void {
  const real = JSON.parse.bind(JSON) as (text: string, reviver?: Reviver) => unknown;
  vi.spyOn(JSON, 'parse').mockImplementation((text: string, reviver?: Reviver) =>
    real(
      text,
      reviver &&
        function (this: unknown, key: string, value: unknown) {
          return reviver.call(this, key, value);
        },
    ),
  );
}

function failureOf(run: () => unknown): PriceProviderFailure {
  try {
    run();
  } catch (error) {
    if (error instanceof PriceProviderFailure) return error;
    throw error;
  }
  throw new Error('expected a PriceProviderFailure');
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('parseCoingeckoPayload', () => {
  it('reads the price from the digits of the JSON text', () => {
    const text = body(
      `{"symbol":"btc","current_price":67890.1234,"last_updated":"${FRESH}","market_cap_rank":1}`,
      `{"symbol":"eth","current_price":3512.34,"last_updated":"${FRESH}","market_cap_rank":2}`,
    );
    expect(parseCoingeckoPayload(text, ['btc', 'eth'], NOW)).toEqual([
      { symbol: 'btc', unitPrice: 6789012n },
      { symbol: 'eth', unitPrice: 351234n },
    ]);
  });

  it('reads an exponent price exactly', () => {
    const text = body(
      `{"symbol":"btc","current_price":1.5e3,"last_updated":"${FRESH}","market_cap_rank":1}`,
    );
    expect(parseCoingeckoPayload(text, ['btc'], NOW)).toEqual([
      { symbol: 'btc', unitPrice: 150000n },
    ]);
  });

  it('reads a price a float would get wrong', () => {
    const text = body(`{"symbol":"btc","current_price":0.285,"last_updated":"${FRESH}"}`);
    // 0.285 * 100 is 28.499999999999996 as a float; the digits round half up to 29 cents.
    expect(parseCoingeckoPayload(text, ['btc'], NOW)).toEqual([{ symbol: 'btc', unitPrice: 29n }]);
  });

  it('ignores a null price, a sub-cent price, a string price and an entry without a symbol', () => {
    const text = body(
      `{"symbol":"btc","current_price":null,"last_updated":"${FRESH}"}`,
      `{"symbol":"eth","current_price":0.000007,"last_updated":"${FRESH}"}`,
      `{"symbol":"sol","current_price":"150.5","last_updated":"${FRESH}"}`,
      `{"current_price":10.5,"last_updated":"${FRESH}"}`,
      `{"symbol":42,"current_price":10.5,"last_updated":"${FRESH}"}`,
      'null',
      '7',
    );
    expect(parseCoingeckoPayload(text, ['btc', 'eth', 'sol'], NOW)).toEqual([]);
  });

  it('keeps the entry with the lowest market cap rank for a repeated symbol, null last', () => {
    const text = body(
      `{"symbol":"btc","current_price":1.00,"last_updated":"${FRESH}","market_cap_rank":null}`,
      `{"symbol":"btc","current_price":2.00,"last_updated":"${FRESH}","market_cap_rank":9}`,
      `{"symbol":"btc","current_price":3.00,"last_updated":"${FRESH}","market_cap_rank":2}`,
    );
    expect(parseCoingeckoPayload(text, ['btc'], NOW)).toEqual([{ symbol: 'btc', unitPrice: 300n }]);
  });

  it('prefers a ranked entry over an unranked one whatever the order', () => {
    const text = body(
      `{"symbol":"btc","current_price":1.00,"last_updated":"${FRESH}"}`,
      `{"symbol":"btc","current_price":5.00,"last_updated":"${FRESH}","market_cap_rank":400}`,
    );
    expect(parseCoingeckoPayload(text, ['btc'], NOW)).toEqual([{ symbol: 'btc', unitPrice: 500n }]);
  });

  it('does not fall back to a worse ranked clone when the best ranked entry has no usable price', () => {
    const text = body(
      `{"symbol":"btc","current_price":null,"last_updated":"${FRESH}","market_cap_rank":1}`,
      `{"symbol":"btc","current_price":2.00,"last_updated":"${FRESH}","market_cap_rank":300}`,
    );
    expect(parseCoingeckoPayload(text, ['btc'], NOW)).toEqual([]);
  });

  it('drops symbols that were not asked for and matches case-insensitively', () => {
    const text = body(
      `{"symbol":"BTC","current_price":10.00,"last_updated":"${FRESH}"}`,
      `{"symbol":"doge","current_price":0.5,"last_updated":"${FRESH}"}`,
    );
    expect(parseCoingeckoPayload(text, ['btc'], NOW)).toEqual([
      { symbol: 'btc', unitPrice: 1000n },
    ]);
  });

  it('ignores an entry whose last_updated is missing, unreadable or older than 24 hours (stale entry)', () => {
    const text = body(
      '{"symbol":"btc","current_price":10.00}',
      '{"symbol":"eth","current_price":10.00,"last_updated":"not a date"}',
      '{"symbol":"sol","current_price":10.00,"last_updated":"2026-10-01T11:59:59.000Z"}',
      '{"symbol":"ada","current_price":10.00,"last_updated":null}',
    );
    expect(parseCoingeckoPayload(text, ['btc', 'eth', 'sol', 'ada'], NOW)).toEqual([]);
  });

  it('accepts last_updated exactly 24 hours old and rejects a millisecond older', () => {
    const text = body(
      '{"symbol":"btc","current_price":10.00,"last_updated":"2026-10-01T12:00:00.000Z"}',
      '{"symbol":"eth","current_price":10.00,"last_updated":"2026-10-01T11:59:59.999Z"}',
    );
    expect(parseCoingeckoPayload(text, ['btc', 'eth'], NOW)).toEqual([
      { symbol: 'btc', unitPrice: 1000n },
    ]);
  });

  it('lets a stale clone not block the fresh entry of the same symbol', () => {
    const text = body(
      '{"symbol":"btc","current_price":99.00,"last_updated":"2020-01-01T00:00:00.000Z","market_cap_rank":1}',
      `{"symbol":"btc","current_price":2.00,"last_updated":"${FRESH}","market_cap_rank":5}`,
    );
    expect(parseCoingeckoPayload(text, ['btc'], NOW)).toEqual([{ symbol: 'btc', unitPrice: 200n }]);
  });

  it('only converts current_price of the top-level entries', () => {
    const text = body(
      `{"symbol":"btc","current_price":10.5,"last_updated":"${FRESH}","roi":{"current_price":99.99}}`,
    );
    expect(parseCoingeckoPayload(text, ['btc'], NOW)).toEqual([
      { symbol: 'btc', unitPrice: 1050n },
    ]);
  });

  it('is provider_invalid_payload for a body that is not an array or not JSON', () => {
    for (const text of ['{"symbol":"btc"}', '{oops', '', '"x"', 'null']) {
      expect(failureOf(() => parseCoingeckoPayload(text, ['btc'], NOW)).code).toBe(
        'provider_invalid_payload',
      );
    }
  });

  it('is provider_invalid_payload, never a float fallback, when the number source is missing', () => {
    stubParseWithoutSource();
    const text = body(`{"symbol":"btc","current_price":67890.1234,"last_updated":"${FRESH}"}`);
    expect(failureOf(() => parseCoingeckoPayload(text, ['btc'], NOW)).code).toBe(
      'provider_invalid_payload',
    );
  });

  it('does not fail for a missing source when no top-level current_price is a number', () => {
    stubParseWithoutSource();
    const text = body(
      `{"symbol":"btc","current_price":null,"market_cap_rank":3,"last_updated":"${FRESH}"}`,
    );
    expect(parseCoingeckoPayload(text, ['btc'], NOW)).toEqual([]);
  });

  it('leaves a nested current_price alone: not converted, not priced, no failure without source text', () => {
    let revived: unknown;
    const real = JSON.parse.bind(JSON) as (text: string, reviver?: Reviver) => unknown;
    vi.spyOn(JSON, 'parse').mockImplementation((text: string, reviver?: Reviver) => {
      revived = real(
        text,
        reviver &&
          function (this: unknown, key: string, value: unknown) {
            // Like an engine without source text access: the context is never handed over.
            return reviver.call(this, key, value);
          },
      );
      return revived;
    });
    const text = body(
      `{"symbol":"btc","current_price":null,"last_updated":"${FRESH}","market_cap_rank":1,"roi":{"current_price":99.99,"times":2}}`,
    );

    expect(parseCoingeckoPayload(text, ['btc'], NOW)).toEqual([]);
    const entry = (revived as Record<string, unknown>[])[0];
    expect(entry?.roi).toEqual({ current_price: 99.99, times: 2 });
  });
});

describe('sanitizeSymbols', () => {
  it('lowercases, deduplicates and keeps order', () => {
    expect(sanitizeSymbols(['BTC', 'eth', 'btc', 'Sol'])).toEqual(['btc', 'eth', 'sol']);
  });

  it('drops injection-shaped symbols: a space, an ampersand, a slash, a comma, a percent, empty', () => {
    expect(
      sanitizeSymbols(['btc', 'bt c', 'eth&per_page=1', 'a/b', 'x,y', '', 'a%20b', 'ok.t_-1']),
    ).toEqual(['btc', 'ok.t_-1']);
  });
});

import type { PriceProvider } from '../../application/price-ports';
import type { PriceQuote } from '../../domain/crypto-price';
import { PriceProviderFailure } from '../../domain/price-failure';
import { parseCoingeckoPayload, sanitizeSymbols } from './coingecko-payload';

const MAX_BODY_BYTES = 512 * 1024;
const JSON_CONTENT_TYPE = /^application\/(?:json|[\w.+-]+\+json)\s*(?:;.*)?$/i;

export interface CoingeckoPriceProviderOptions {
  baseUrl: string;
  /** Demo plan key; an empty value counts as none. */
  apiKey?: string | undefined;
  /** Must stay well below the 5-minute refresh lease, or a slow call outlives its lease. */
  timeoutMs?: number;
  /** The clock the freshness of an entry is judged against. */
  now?: () => Date;
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
}

function invalidPayload(detail: string): PriceProviderFailure {
  return new PriceProviderFailure('provider_invalid_payload', { detail });
}

/** Reads at most MAX_BODY_BYTES; a longer body is rejected as soon as the cap is crossed. */
async function readCapped(response: Response): Promise<string> {
  const declared = response.headers.get('content-length');
  if (declared !== null && /^\d+$/.test(declared) && BigInt(declared) > BigInt(MAX_BODY_BYTES)) {
    await response.body?.cancel().catch(() => undefined);
    throw invalidPayload('body too large');
  }
  if (!response.body) return '';

  const reader: ReadableStreamDefaultReader<Uint8Array> = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw invalidPayload('body too large');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * CoinGecko adapter: one `/coins/markets` request per call. Neither the key nor the body is ever
 * logged, stored, put in the URL or copied into a failure.
 */
export class CoingeckoPriceProvider implements PriceProvider {
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly timeoutMs: number;
  private readonly now: () => Date;

  constructor(options: CoingeckoPriceProviderOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.apiKey = options.apiKey ? options.apiKey : undefined;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.now = options.now ?? (() => new Date());
  }

  async fetchPrices(symbols: readonly string[]): Promise<PriceQuote[]> {
    const requested = sanitizeSymbols(symbols);
    if (requested.length === 0) return [];

    const query = [
      'vs_currency=usd',
      `symbols=${encodeURIComponent(requested.join(','))}`,
      'per_page=250',
      'precision=full',
    ].join('&');
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (this.apiKey !== undefined) headers['x-cg-demo-api-key'] = this.apiKey;

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/coins/markets?${query}`, {
        redirect: 'manual',
        signal: AbortSignal.timeout(this.timeoutMs),
        headers,
      });
    } catch (error) {
      throw new PriceProviderFailure(isAbort(error) ? 'provider_timeout' : 'provider_unreachable');
    }

    if (response.status < 200 || response.status > 299) {
      await response.body?.cancel().catch(() => undefined);
      throw new PriceProviderFailure(
        response.status === 429 ? 'provider_rate_limited' : 'provider_bad_status',
        { statusCode: response.status },
      );
    }
    if (!JSON_CONTENT_TYPE.test(response.headers.get('content-type') ?? '')) {
      await response.body?.cancel().catch(() => undefined);
      throw invalidPayload('content type is not JSON');
    }

    let text: string;
    try {
      text = await readCapped(response);
    } catch (error) {
      if (error instanceof PriceProviderFailure) throw error;
      throw new PriceProviderFailure(isAbort(error) ? 'provider_timeout' : 'provider_unreachable');
    }
    return parseCoingeckoPayload(text, requested, this.now());
  }
}

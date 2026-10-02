import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PriceProviderFailure } from '../../src/investments/domain/price-failure';
import { CoingeckoPriceProvider } from '../../src/investments/infrastructure/provider/coingecko-price-provider';

const NOW = new Date('2026-10-02T12:00:00.000Z');
const FRESH = '2026-10-02T11:58:00.000Z';
const KEY = 'CG-demo-secret-key-0123456789';
const MAX_BODY = 512 * 1024;

const ANSWER = `[{"id":"bitcoin","symbol":"btc","current_price":67890.1234,"market_cap_rank":1,"last_updated":"${FRESH}"},{"id":"ethereum","symbol":"eth","current_price":3512.34,"market_cap_rank":2,"last_updated":"${FRESH}"}]`;

interface Seen {
  url: string;
  headers: IncomingMessage['headers'];
  method: string | undefined;
}

interface Stub {
  baseUrl: string;
  server: Server;
  seen: Seen[];
}

const open: { server: Server; sockets: Set<Socket> }[] = [];

async function startStub(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<Stub> {
  const seen: Seen[] = [];
  const sockets = new Set<Socket>();
  const server = createServer((req, res) => {
    seen.push({ url: req.url ?? '', headers: req.headers, method: req.method });
    handler(req, res);
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  open.push({ server, sockets });
  const { port } = server.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${port}/api/v3`, server, seen };
}

afterEach(async () => {
  vi.unstubAllGlobals();
  for (const { server, sockets } of open.splice(0)) {
    for (const socket of sockets) socket.destroy();
    if (server.listening)
      await new Promise<void>((resolve) =>
        server.close(() => {
          resolve();
        }),
      );
  }
});

function json(res: ServerResponse, text: string, type = 'application/json; charset=utf-8'): void {
  res.writeHead(200, { 'content-type': type });
  res.end(text);
}

function provider(
  stub: Stub,
  options: { apiKey?: string; timeoutMs?: number } = {},
): CoingeckoPriceProvider {
  return new CoingeckoPriceProvider({ baseUrl: stub.baseUrl, now: () => NOW, ...options });
}

async function failureOf(run: () => Promise<unknown>): Promise<PriceProviderFailure> {
  try {
    await run();
  } catch (error) {
    if (error instanceof PriceProviderFailure) return error;
    throw error;
  }
  throw new Error('expected a PriceProviderFailure');
}

describe('CoingeckoPriceProvider against a local test server', () => {
  it('returns cents from the digits of the JSON and sends one well-formed request with the key header', async () => {
    const stub = await startStub((_req, res) => {
      json(res, ANSWER);
    });
    const quotes = await provider(stub, { apiKey: KEY }).fetchPrices(['BTC', 'eth']);

    expect(quotes).toEqual([
      { symbol: 'btc', unitPrice: 6789012n },
      { symbol: 'eth', unitPrice: 351234n },
    ]);
    expect(stub.seen).toHaveLength(1);
    const request = stub.seen[0];
    expect(request?.method).toBe('GET');
    const url = new URL(request?.url ?? '', 'http://x');
    expect(url.pathname).toBe('/api/v3/coins/markets');
    expect(url.searchParams.get('vs_currency')).toBe('usd');
    expect(url.searchParams.get('symbols')).toBe('btc,eth');
    expect(url.searchParams.get('per_page')).toBe('250');
    expect(url.searchParams.get('precision')).toBe('full');
    expect(request?.headers.accept).toBe('application/json');
    expect(request?.headers['x-cg-demo-api-key']).toBe(KEY);
    expect(request?.url).not.toContain(KEY);
    expect(request?.url).not.toMatch(/key/i);
  });

  it('URL-encodes the joined symbols', async () => {
    const stub = await startStub((_req, res) => {
      json(res, '[]');
    });
    await provider(stub).fetchPrices(['btc', 'eth']);
    expect(stub.seen[0]?.url).toContain('symbols=btc%2Ceth');
  });

  it('sends no key header when no key is configured and still succeeds', async () => {
    const stub = await startStub((_req, res) => {
      json(res, ANSWER);
    });
    const quotes = await provider(stub).fetchPrices(['btc', 'eth']);

    expect(quotes).toHaveLength(2);
    expect(stub.seen[0]?.headers).not.toHaveProperty('x-cg-demo-api-key');
  });

  it('treats an empty key as no key', async () => {
    const stub = await startStub((_req, res) => {
      json(res, ANSWER);
    });
    await provider(stub, { apiKey: '' }).fetchPrices(['btc']);
    expect(stub.seen[0]?.headers).not.toHaveProperty('x-cg-demo-api-key');
  });

  it('drops injection-shaped symbols from the request and never sends more than it is given', async () => {
    const stub = await startStub((_req, res) => {
      json(res, ANSWER);
    });
    await provider(stub).fetchPrices(['btc', 'bad symbol', 'eth&per_page=1', 'BTC']);

    const url = new URL(stub.seen[0]?.url ?? '', 'http://x');
    expect(url.searchParams.get('symbols')).toBe('btc');
    expect(url.searchParams.getAll('per_page')).toEqual(['250']);
  });

  it('makes no request when no symbol is left after sanitizing', async () => {
    const stub = await startStub((_req, res) => {
      json(res, ANSWER);
    });
    expect(await provider(stub).fetchPrices(['a b', ''])).toEqual([]);
    expect(await provider(stub).fetchPrices([])).toEqual([]);
    expect(stub.seen).toEqual([]);
  });

  it('maps 429 to provider_rate_limited with its status', async () => {
    const stub = await startStub((_req, res) => {
      res.writeHead(429).end('slow down');
    });
    const error = await failureOf(() => provider(stub).fetchPrices(['btc']));
    expect(error.code).toBe('provider_rate_limited');
    expect(error.statusCode).toBe(429);
  });

  it('maps 500 to provider_bad_status with its status', async () => {
    const stub = await startStub((_req, res) => {
      res.writeHead(500).end('boom');
    });
    const error = await failureOf(() => provider(stub).fetchPrices(['btc']));
    expect(error.code).toBe('provider_bad_status');
    expect(error.statusCode).toBe(500);
  });

  it('does not follow a redirect and reports it as a bad status', async () => {
    const target = await startStub((_req, res) => {
      json(res, ANSWER);
    });
    const stub = await startStub((_req, res) => {
      res.writeHead(302, { location: `${target.baseUrl}/coins/markets` }).end();
    });
    const error = await failureOf(() => provider(stub, { apiKey: KEY }).fetchPrices(['btc']));
    expect(error.code).toBe('provider_bad_status');
    expect(error.statusCode).toBe(302);
    expect(target.seen).toEqual([]);
  });

  it('maps a refused connection to provider_unreachable', async () => {
    const stub = await startStub((_req, res) => {
      json(res, '[]');
    });
    await new Promise<void>((resolve) =>
      stub.server.close(() => {
        resolve();
      }),
    );
    const error = await failureOf(() => provider(stub).fetchPrices(['btc']));
    expect(error.code).toBe('provider_unreachable');
  });

  it('maps a slow server to provider_timeout', async () => {
    const stub = await startStub(() => undefined);
    const error = await failureOf(() => provider(stub, { timeoutMs: 100 }).fetchPrices(['btc']));
    expect(error.code).toBe('provider_timeout');
  });

  it('maps headers followed by a stalled body to provider_timeout', async () => {
    const stub = await startStub((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.write('[');
    });
    const error = await failureOf(() => provider(stub, { timeoutMs: 200 }).fetchPrices(['btc']));
    expect(error.code).toBe('provider_timeout');
  });

  it('maps HTML content, malformed JSON and a non-array body to provider_invalid_payload', async () => {
    for (const [text, type] of [
      [ANSWER, 'text/html'],
      ['{oops', 'application/json'],
      ['{"symbol":"btc"}', 'application/json'],
    ] as const) {
      const stub = await startStub((_req, res) => {
        json(res, text, type);
      });
      const error = await failureOf(() => provider(stub).fetchPrices(['btc']));
      expect(error.code).toBe('provider_invalid_payload');
    }
  });

  it('maps a body over 512 KiB to provider_invalid_payload, declared or chunked', async () => {
    const declared = await startStub((_req, res) => {
      json(res, ' '.repeat(MAX_BODY + 1) + ANSWER);
    });
    expect((await failureOf(() => provider(declared).fetchPrices(['btc']))).code).toBe(
      'provider_invalid_payload',
    );

    const chunked = await startStub((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.write(' '.repeat(MAX_BODY + 10));
      res.end(ANSWER);
    });
    expect((await failureOf(() => provider(chunked).fetchPrices(['btc']))).code).toBe(
      'provider_invalid_payload',
    );
  });

  it('accepts a body just under the cap', async () => {
    const stub = await startStub((_req, res) => {
      json(res, ' '.repeat(MAX_BODY - ANSWER.length) + ANSWER);
    });
    expect(await provider(stub).fetchPrices(['btc'])).toHaveLength(1);
  });

  it('never puts the key in a failure', async () => {
    const stub = await startStub((_req, res) => {
      res.writeHead(500).end(`echo ${KEY}`);
    });
    const error = await failureOf(() => provider(stub, { apiKey: KEY }).fetchPrices(['btc']));
    expect(JSON.stringify(error)).not.toContain(KEY);
    expect(error.message).not.toContain(KEY);
    expect(error.stack ?? '').not.toContain(KEY);
  });

  it.each(['AbortError', 'TimeoutError'])(
    'maps a %s from fetch to provider_timeout',
    async (name) => {
      vi.stubGlobal('fetch', () => Promise.reject(new DOMException('aborted', name)));
      const error = await failureOf(() =>
        new CoingeckoPriceProvider({ baseUrl: 'http://x' }).fetchPrices(['btc']),
      );
      expect(error.code).toBe('provider_timeout');
    },
  );

  it('strips a trailing slash from the base URL', async () => {
    const stub = await startStub((_req, res) => {
      json(res, '[]');
    });
    await new CoingeckoPriceProvider({ baseUrl: `${stub.baseUrl}///` }).fetchPrices(['btc']);
    expect(stub.seen[0]?.url).toMatch(/^\/api\/v3\/coins\/markets\?/);
  });
});

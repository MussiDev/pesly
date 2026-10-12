import { readdirSync, readFileSync, statSync } from 'node:fs';
import net from 'node:net';
import { join, relative, resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';
import { addRealUser, buildRealApp, getJson } from './real-app';
import { seedGroup, seedRate, seedWorld } from './world-fixtures';

const apiRoot = resolve(__dirname, '..', '..');
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);

function filesUnder(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return filesUnder(path);
    return path.endsWith('.ts') ? [path] : [];
  });
}

const FORBIDDEN_IMPORTS: [string, RegExp][] = [
  ['a rates provider', /from\s+['"][^'"]*(exchange-rates\/infrastructure\/provider|\/provider\/)/],
  ['a price provider', /from\s+['"][^'"]*(coingecko|price-provider)/i],
  ['a job', /from\s+['"][^'"]*\/jobs?\//],
  [
    'an HTTP client',
    /from\s+['"](axios|undici|node-fetch|got|node:https?|https?|node:net|net)['"]/,
  ],
  ['fetch', /\bfetch\s*\(/],
  ['the exchange-rates barrel', /from\s+['"][^'"]*\/exchange-rates['"]/],
];

describe('the dashboard module makes no outbound call (NFR-04, AC-53)', () => {
  it('imports no rates provider, price provider, job or HTTP client in any source file', () => {
    const files = filesUnder(join(apiRoot, 'src', 'dashboard'));
    expect(files.length).toBeGreaterThan(25);
    for (const [name, pattern] of FORBIDDEN_IMPORTS) {
      const offenders = files
        .filter((path) => pattern.test(readFileSync(path, 'utf8')))
        .map((path) => relative(apiRoot, path));
      expect(offenders, name).toEqual([]);
    }
  });

  it('the scan catches a planted provider, job and client import', () => {
    const planted = [
      "import { x } from '../../exchange-rates/infrastructure/provider/dolarapi';",
      "import { z } from '../investments/infrastructure/coingecko-price-provider';",
      "import { y } from '../exchange-rates/infrastructure/jobs/sync';",
      "import axios from 'axios';",
      'await fetch(url);',
    ];
    const hits = FORBIDDEN_IMPORTS.filter(([, pattern]) =>
      planted.some((line) => pattern.test(line)),
    );
    expect(hits.map(([name]) => name)).toEqual([
      'a rates provider',
      'a price provider',
      'a job',
      'an HTTP client',
      'fetch',
    ]);
  });
});

describe('a full dashboard request at run time', () => {
  let connection: DatabaseConnection;

  beforeAll(() => {
    connection = createDatabase(testDatabaseUrl);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await connection.pool.end();
  });

  it('never calls fetch and never opens a socket to a host outside this machine', async () => {
    const { app } = buildRealApp(connection);
    await seedRate(connection.pool);
    const ana = await addRealUser(connection, app, 'ana');
    const bea = await addRealUser(connection, app, 'bea');
    await seedWorld(connection, ana.id, 'ana');
    await seedGroup(connection.pool, ana.id, bea.id);

    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const targets: string[] = [];
    const connect = Reflect.get(net.Socket.prototype, 'connect') as (...a: unknown[]) => net.Socket;
    const connectSpy = vi.spyOn(net.Socket.prototype, 'connect').mockImplementation(function (
      this: net.Socket,
      ...args: unknown[]
    ) {
      const [first, second] = args;
      let host = 'unknown';
      if (typeof first === 'number') host = typeof second === 'string' ? second : 'localhost';
      else if (typeof first === 'string') host = 'localhost';
      else if (typeof first === 'object' && first !== null) {
        const options = first as { host?: unknown };
        host = typeof options.host === 'string' ? options.host : 'localhost';
      }
      targets.push(host);
      return connect.apply(this, args);
    });

    const response = await getJson(app, '/dashboard', ana.cookies);

    expect(response.status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(connectSpy).toHaveBeenCalled();
    expect(targets.filter((host) => !LOOPBACK.has(host))).toEqual([]);
  });
});

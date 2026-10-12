import { readdirSync, readFileSync, statSync } from 'node:fs';
import net from 'node:net';
import { join, relative, resolve } from 'node:path';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createReportRoutes } from '../../src/reports';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { createLogger } from '../../src/shared/logging/logger';
import { createIdentityHarness } from '../helpers/identity-harness';
import { cookieHeader, seedUser, sessionFrom, signIn } from '../helpers/session-client';
import { testDatabaseUrl } from '../helpers/test-database';
import { trustedHeaders } from '../helpers/test-env';
import { FixedClock } from './fakes';

const apiRoot = resolve(__dirname, '..', '..');
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);
const PASSWORD = 'a long enough passphrase';

function filesUnder(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return filesUnder(path);
    return path.endsWith('.ts') ? [path] : [];
  });
}

const FORBIDDEN_IMPORTS: [string, RegExp][] = [
  ['a rates provider', /from\s+['"][^'"]*(exchange-rates\/infrastructure\/provider|\/provider\/)/],
  ['a job', /from\s+['"][^'"]*\/jobs?\//],
  [
    'an HTTP client',
    /from\s+['"](axios|undici|node-fetch|got|node:https?|https?|node:net|net)['"]/,
  ],
  ['fetch', /\bfetch\s*\(/],
  ['the exchange-rates barrel', /from\s+['"][^'"]*\/exchange-rates['"]/],
];

describe('the reports module makes no outbound call (NFR-04, AC-50)', () => {
  it('imports no rates provider, job or HTTP client in any source file', () => {
    const files = filesUnder(join(apiRoot, 'src', 'reports'));
    expect(files.length).toBeGreaterThan(30);
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
      "import { y } from '../exchange-rates/infrastructure/jobs/sync';",
      "import axios from 'axios';",
      'await fetch(url);',
    ];
    const hits = FORBIDDEN_IMPORTS.filter(([, pattern]) =>
      planted.some((line) => pattern.test(line)),
    );
    expect(hits.map(([name]) => name)).toEqual([
      'a rates provider',
      'a job',
      'an HTTP client',
      'fetch',
    ]);
  });
});

describe('the three reports at run time', () => {
  let connection: DatabaseConnection;
  let app: Express;

  beforeAll(() => {
    connection = createDatabase(testDatabaseUrl);
    const logger = createLogger({ level: 'error', destination: { write: () => undefined } });
    app = createIdentityHarness(connection, {
      realSessions: true,
      routerFactories: [createReportRoutes({ db: connection.db, logger, clock: new FixedClock() })],
    }).app;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await connection.pool.end();
  });

  it('never calls fetch and never opens a socket to a host outside this machine', async () => {
    const email = 'outbound@reports.test';
    await seedUser(connection, { email, password: PASSWORD });
    const cookies = sessionFrom(await signIn(app, email, PASSWORD));

    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const targets: string[] = [];
    const connect = Reflect.get(net.Socket.prototype, 'connect') as (...a: unknown[]) => net.Socket;
    const connectSpy = vi.spyOn(net.Socket.prototype, 'connect').mockImplementation(function (
      this: net.Socket,
      ...args: unknown[]
    ) {
      const [first, second] = args;
      // `connect(port, host)` as pg calls it, `connect({ host, port })` or `connect(path)`.
      let host = 'unknown';
      if (typeof first === 'number') host = typeof second === 'string' ? second : 'localhost';
      else if (typeof first === 'string') host = 'localhost';
      else if (typeof first === 'object' && first !== null) {
        const options = first as { host?: unknown; path?: unknown };
        host = typeof options.host === 'string' ? options.host : 'localhost';
      }
      targets.push(host);
      return connect.apply(this, args);
    });

    for (const path of ['expenses-by-category', 'income-expenses', 'net-worth']) {
      const response = await request(app)
        .get(`/reports/${path}?from=2026-09-01&to=2026-10-06`)
        .set(trustedHeaders)
        .set('Cookie', cookieHeader(cookies));
      expect(response.status, path).toBe(200);
    }

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(connectSpy).toHaveBeenCalled();
    // The database and the in-process test client are the only sockets, both on loopback.
    expect(targets.filter((host) => !LOOPBACK.has(host))).toEqual([]);
  });
});

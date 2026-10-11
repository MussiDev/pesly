import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';
import { call, createAccount, goalsSetup } from './routes-harness';

const apiRoot = resolve(__dirname, '..', '..');
const SELF = 'no-float-money.test.ts';

function filesUnder(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return filesUnder(path);
    return path.endsWith('.ts') ? [path] : [];
  });
}

/** Source of the goals module, its shared schemas and every test of it (this file excluded). */
function scannedFiles(): string[] {
  return [
    ...filesUnder(join(apiRoot, 'src', 'goals')),
    ...filesUnder(join(apiRoot, '..', '..', 'packages', 'shared', 'src', 'goals')),
    ...filesUnder(join(apiRoot, 'test', 'goals')).filter((path) => !path.endsWith(SELF)),
    join(apiRoot, 'test', 'perf', 'goals-list.perf.test.ts'),
  ];
}

/** Drops comments, so a doc line that explains why a float is avoided does not trip the scan. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const FORBIDDEN: [string, RegExp][] = [
  ['parseFloat', /\bparseFloat\b/],
  ['toFixed', /\btoFixed\b/],
  // Row counts (`Number(result.rows[0]?.n)`) are not money; any other Number( is.
  ['Number(', /\bNumber\((?!result\.rows\[0\]\?\.n\))/],
  ['float column', /\b(real|doublePrecision|numeric|decimal|float4|float8)\(/],
];

describe('no float money in the goals module (NFR-01)', () => {
  it('scans a non-empty set of files', () => {
    const files = scannedFiles();
    expect(files.length).toBeGreaterThan(20);
  });

  it.each(FORBIDDEN)('no file of the module or its tests uses %s', (name, pattern) => {
    const offenders = scannedFiles()
      .filter((path) => pattern.test(code(readFileSync(path, 'utf8'))))
      .map((path) => relative(apiRoot, path));
    expect(offenders, name).toEqual([]);
  });

  it('the migration declares no float, numeric or money column for goals', () => {
    const sql = readFileSync(join(apiRoot, 'drizzle', '0033_savings_goals.sql'), 'utf8');
    expect(sql).not.toMatch(/\b(real|double precision|numeric|decimal|float|money)\b/i);
  });
});

describe('float input is rejected (NFR-01)', () => {
  let connection: DatabaseConnection;

  beforeAll(() => {
    connection = createDatabase(testDatabaseUrl);
  });

  afterAll(async () => {
    await connection.pool.end();
  });

  it.each([['10.5'], ['1e3'], ['0.1']])(
    'POST /goals rejects targetAmount %s with 400',
    async (amount) => {
      const s = goalsSetup(connection);
      const ana = await s.addUser('ana');
      const response = await call(s.app, 'post', '/goals', ana.cookies, {
        name: 'Car',
        targetAmount: amount,
        currency: 'ARS',
      });
      expect(response.status).toBe(400);
    },
  );

  it('POST /goals rejects a JSON float targetAmount with 400', async () => {
    const s = goalsSetup(connection);
    const ana = await s.addUser('ana');
    const response = await call(s.app, 'post', '/goals', ana.cookies, {
      name: 'Car',
      targetAmount: 10.5,
      currency: 'ARS',
    });
    expect(response.status).toBe(400);
  });

  it('POST /goals/:id/entries rejects an amount of 10.5 with 400 and records nothing', async () => {
    const s = goalsSetup(connection);
    const ana = await s.addUser('ana');
    const created = await call(s.app, 'post', '/goals', ana.cookies, {
      name: 'Car',
      targetAmount: '500000',
      currency: 'ARS',
    });
    expect(created.status).toBe(201);
    const id = (created.body as { id: string }).id;
    const response = await call(s.app, 'post', `/goals/${id}/entries`, ana.cookies, {
      kind: 'contribution',
      amount: '10.5',
    });
    expect(response.status).toBe(400);
    const entries = await call(s.app, 'get', `/goals/${id}/entries`, ana.cookies);
    expect((entries.body as { entries: unknown[] }).entries).toEqual([]);
  });

  it('PATCH /goals/:id rejects a float targetAmount with 400', async () => {
    const s = goalsSetup(connection);
    const ana = await s.addUser('ana');
    const account = await createAccount(s, ana, 'ARS');
    const created = await call(s.app, 'post', '/goals', ana.cookies, {
      name: 'Car',
      targetAmount: '500000',
      currency: 'ARS',
      accountId: account,
    });
    const id = (created.body as { id: string }).id;
    const response = await call(s.app, 'patch', `/goals/${id}`, ana.cookies, {
      targetAmount: '10.5',
    });
    expect(response.status).toBe(400);
  });
});

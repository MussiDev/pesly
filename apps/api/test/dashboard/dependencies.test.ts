import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const apiRoot = resolve(__dirname, '..', '..');
const sharedRoot = join(apiRoot, '..', '..', 'packages', 'shared');

interface Manifest {
  dependencies: Record<string, string>;
  devDependencies?: Record<string, string>;
}

const manifestOf = (root: string): Manifest =>
  JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as Manifest;

/** The lists before DISC-001-09b: the dashboard adds no dependency (NFR-03, AC-52). */
const API_DEPENDENCIES = [
  '@node-rs/argon2',
  '@pesly/shared',
  'cookie-parser',
  'cors',
  'drizzle-orm',
  'express',
  'helmet',
  'jose',
  'pg',
  'pino',
  'resend',
  'zod',
];
const API_DEV_DEPENDENCIES = [
  '@types/autocannon',
  '@types/cookie-parser',
  '@types/cors',
  '@types/express',
  '@types/express-serve-static-core',
  '@types/node',
  '@types/pg',
  '@types/supertest',
  'autocannon',
  'drizzle-kit',
  'esbuild',
  'railway',
  'supertest',
  'tsx',
];
const SHARED_DEPENDENCIES = ['zod'];

/**
 * The migrations up to DISC-001-09b: the dashboard adds no migration, table or index. Later tickets
 * add their own on top, so the pin is the prefix, not the total.
 */
const MIGRATION_COUNT = 38;
const LAST_MIGRATION = '0038_exchange_rate_history.sql';

describe('the dependency lists and the migrations stay pinned (AC-52)', () => {
  it('apps/api declares exactly the known runtime dependencies', () => {
    expect(Object.keys(manifestOf(apiRoot).dependencies).sort()).toEqual(API_DEPENDENCIES);
  });

  it('apps/api declares exactly the known development dependencies', () => {
    expect(Object.keys(manifestOf(apiRoot).devDependencies ?? {}).sort()).toEqual(
      API_DEV_DEPENDENCIES,
    );
  });

  it('packages/shared declares exactly the known runtime dependencies', () => {
    expect(Object.keys(manifestOf(sharedRoot).dependencies).sort()).toEqual(SHARED_DEPENDENCIES);
  });

  it('apps/api/drizzle holds no new migration', () => {
    const migrations = readdirSync(join(apiRoot, 'drizzle')).filter((name) =>
      name.endsWith('.sql'),
    );
    const sorted = migrations.sort();
    expect(sorted.length).toBeGreaterThanOrEqual(MIGRATION_COUNT);
    expect(sorted[MIGRATION_COUNT - 1]).toBe(LAST_MIGRATION);
    expect(sorted.filter((name) => name.toLowerCase().includes('dashboard'))).toEqual([]);
    const journal = JSON.parse(
      readFileSync(join(apiRoot, 'drizzle', 'meta', '_journal.json'), 'utf8'),
    ) as { entries: unknown[] };
    expect(journal.entries.length).toBeGreaterThanOrEqual(MIGRATION_COUNT);
  });
});

import { readFileSync } from 'node:fs';
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

/** The lists before DISC-001-09a: the reports add no dependency (NFR-03, AC-49). */
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

describe('the dependency lists stay pinned (AC-49)', () => {
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

  it('the migration has an idempotent rollback script next to it', () => {
    const down = readFileSync(
      join(apiRoot, 'drizzle', 'rollback', '0037_exchange_rate_history.down.sql'),
      'utf8',
    );
    expect(down).toMatch(/drop table if exists/i);
    expect(down).toMatch(/delete from "?drizzle"?\."?__drizzle_migrations"?/i);
  });
});

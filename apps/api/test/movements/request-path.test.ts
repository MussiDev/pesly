import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const srcRoot = join(repoRoot, 'apps/api/src');
const movementsRoot = join(srcRoot, 'movements');
const ratesRoot = join(srcRoot, 'exchange-rates');
const FOREIGN_RELATIONS = 'infrastructure/db/foreign-relations.ts';

const STATIC_IMPORT =
  /^\s*(?:import|export)\b[^'"]*?from\s*['"]([^'"]+)['"]|^\s*import\s*['"]([^'"]+)['"]/gm;
const DYNAMIC_IMPORT = /\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

const PROVIDER_OR_JOB =
  /\/infrastructure\/(?:provider|jobs)(?:\/|$)|\/application\/refresh-rates$|(?:^|\/)(?:dolarapi-|fake-)?rate-provider$/;
const FORBIDDEN_RUNTIME = /^(?:drizzle-orm(?:\/.*)?|pg|express|node:.*)$/;

function toPosix(path: string): string {
  return path.replaceAll('\\', '/');
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** Import specifiers (static, dynamic import, require) of the comment-stripped source. */
function specifiers(source: string): string[] {
  const code = stripComments(source);
  const statics = [...code.matchAll(STATIC_IMPORT)].map((m) => m[1] ?? m[2] ?? '');
  const dynamics = [...code.matchAll(DYNAMIC_IMPORT)].map((m) => m[1] ?? '');
  return [...statics, ...dynamics];
}

function resolved(file: string, specifier: string): string {
  return specifier.startsWith('.') ? toPosix(resolve(dirname(file), specifier)) : '';
}

/** Imports of the exchange-rates provider, the sync job, the refresh use case or the barrel. */
function ratesRequestPathFindings(file: string, source: string): string[] {
  const barrel = toPosix(ratesRoot);
  return specifiers(source).filter((specifier) => {
    const target = resolved(file, specifier);
    return (
      PROVIDER_OR_JOB.test(specifier) ||
      PROVIDER_OR_JOB.test(target) ||
      target === barrel ||
      target === `${barrel}/index`
    );
  });
}

/** Imports of another module's persistence files (`<module>/infrastructure/db/...`). */
function foreignPersistenceFindings(file: string, source: string): string[] {
  const own = `${toPosix(movementsRoot)}/`;
  return specifiers(source).filter((specifier) => {
    const target = resolved(file, specifier);
    return (
      target.startsWith(`${toPosix(srcRoot)}/`) &&
      !target.startsWith(own) &&
      /\/infrastructure\/db(?:\/|$)/.test(target)
    );
  });
}

/** Runtime libraries a domain or application file must not load. */
function runtimeFindings(source: string): string[] {
  return specifiers(source).filter((specifier) => FORBIDDEN_RUNTIME.test(specifier));
}

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return tsFiles(full);
    return full.endsWith('.ts') ? [full] : [];
  });
}

function relativeName(file: string): string {
  return toPosix(file.slice(repoRoot.length));
}

describe('the movements request path never reaches the rate provider (NFR-05)', () => {
  const probeFile = join(movementsRoot, 'infrastructure/db/probe.ts');

  it.each([
    "import { DolarapiRateProvider } from '../../../exchange-rates/infrastructure/provider/dolarapi-rate-provider';",
    "import { FakeRateProvider } from '../../../exchange-rates/infrastructure/provider/fake-rate-provider';",
    "import type { RateProvider } from '../../../exchange-rates/application/ports/rate-provider';",
    "import { createRatesSyncJob } from '../../../exchange-rates/infrastructure/jobs/rates-sync-job';",
    "import { RefreshRates } from '../../../exchange-rates/application/refresh-rates';",
    "import { createRatesSyncJob } from '../../../exchange-rates';",
    "import { createRatesSyncJob } from '../../../exchange-rates/index';",
    "const m = await import('../../../exchange-rates');",
    "const m = require('../../../exchange-rates/infrastructure/provider/x');",
  ])('the provider scanner flags %s', (probe) => {
    expect(ratesRequestPathFindings(probeFile, probe)).not.toEqual([]);
  });

  it.each([
    "import { exchangeRates } from './foreign-relations';",
    "import { x } from '../../../exchange-rates/infrastructure/db/schema';",
    "import express from 'express';",
    "// import { x } from '../../../exchange-rates';",
  ])('the provider scanner passes clean probe %s', (probe) => {
    expect(ratesRequestPathFindings(probeFile, probe)).toEqual([]);
  });

  it.each([
    "import { users } from '../../../identity/infrastructure/db/schema';",
    "import { accounts } from '../../../accounts/infrastructure/db/schema';",
    "import { categories } from '../../../categories/infrastructure/db/schema';",
    "import { exchangeRates } from '../../../exchange-rates/infrastructure/db/schema';",
    "export { accounts } from '../../../accounts/infrastructure/db/schema';",
    "const m = await import('../../../accounts/infrastructure/db/schema');",
  ])('the persistence scanner flags %s', (probe) => {
    expect(foreignPersistenceFindings(probeFile, probe)).not.toEqual([]);
  });

  it.each([
    "import { movements } from './schema';",
    "import { x } from '../../infrastructure/db/schema';",
    "import type { AccountMovements } from '../../../accounts/application/ports/account-movements';",
    "import type { Database } from '../../../shared/db/client';",
    "import { accounts } from './foreign-relations';",
  ])('the persistence scanner passes clean probe %s', (probe) => {
    expect(foreignPersistenceFindings(probeFile, probe)).toEqual([]);
  });

  it.each([
    "import { eq } from 'drizzle-orm';",
    "import { pgTable } from 'drizzle-orm/pg-core';",
    "import pg from 'pg';",
    "import express from 'express';",
    "import { randomUUID } from 'node:crypto';",
    "const m = await import('node:fs');",
  ])('the runtime scanner flags %s', (probe) => {
    expect(runtimeFindings(probe)).not.toEqual([]);
  });

  it.each([
    "import { AppError } from '@pesly/shared';",
    "import { z } from 'zod';",
    "import type { Clock } from './ports/clock';",
    "// import { eq } from 'drizzle-orm';",
  ])('the runtime scanner passes clean probe %s', (probe) => {
    expect(runtimeFindings(probe)).toEqual([]);
  });

  const files = tsFiles(movementsRoot);

  it('finds the module files', () => {
    expect(files.length).toBeGreaterThanOrEqual(25);
  });

  it('scans the use case and the repository that now save transfers and exchanges', () => {
    const names = files.map(relativeName);
    expect(names).toContain('apps/api/src/movements/application/create-movement.ts');
    expect(names).toContain(
      'apps/api/src/movements/infrastructure/db/drizzle-movement-repository.ts',
    );
  });

  const TAG_FILTER_FILES = [
    'application/suggest-tags.ts',
    'application/ports/tag-repository.ts',
    'infrastructure/db/drizzle-movement-filters.ts',
    'infrastructure/db/drizzle-tag-repository.ts',
    'infrastructure/db/tags-schema.ts',
    'infrastructure/http/tag-routes.ts',
  ].map((name) => join(movementsRoot, name));

  it.each(TAG_FILTER_FILES.map((file) => [relativeName(file), file]))(
    'the tags and filters file is scanned and the probes fail on it: %s',
    (name, file) => {
      expect(files).toContain(file);
      const toSrc = (target: string) => toPosix(relative(dirname(file), join(srcRoot, target)));
      const clean = readFileSync(file, 'utf8');
      expect(ratesRequestPathFindings(file, clean), name).toEqual([]);
      expect(
        ratesRequestPathFindings(
          file,
          `${clean}
import { x } from '${toSrc('exchange-rates/infrastructure/provider/dolarapi-rate-provider')}';
`,
        ),
      ).not.toEqual([]);
      expect(
        foreignPersistenceFindings(
          file,
          `${clean}
import { accounts } from '${toSrc('accounts/infrastructure/db/schema')}';
`,
        ),
      ).not.toEqual([]);
    },
  );

  it.each(files.map((file) => [relativeName(file), file]))(
    'imports no provider, job or exchange-rates barrel: %s',
    (name, file) => {
      const findings = ratesRequestPathFindings(file, readFileSync(file, 'utf8'));
      expect(findings, `${name}: ${findings.join(', ')}`).toEqual([]);
    },
  );

  const outsideForeignRelations = files.filter(
    (file) => !toPosix(file).endsWith(`/movements/${FOREIGN_RELATIONS}`),
  );

  it.each(outsideForeignRelations.map((file) => [relativeName(file), file]))(
    'imports no other module persistence file: %s',
    (name, file) => {
      const findings = foreignPersistenceFindings(file, readFileSync(file, 'utf8'));
      expect(findings, `${name}: ${findings.join(', ')}`).toEqual([]);
    },
  );

  it('foreign-relations.ts is the one file that imports other modules persistence files', () => {
    const file = join(movementsRoot, FOREIGN_RELATIONS);
    expect(foreignPersistenceFindings(file, readFileSync(file, 'utf8'))).toHaveLength(4);
  });

  const pureFiles = files.filter((file) =>
    /\/movements\/(?:domain|application)\//.test(toPosix(file)),
  );

  it('finds the domain and application files', () => {
    expect(pureFiles.length).toBeGreaterThanOrEqual(10);
  });

  it.each(pureFiles.map((file) => [relativeName(file), file]))(
    'loads no drizzle-orm, pg, express or node:* module: %s',
    (name, file) => {
      const findings = runtimeFindings(readFileSync(file, 'utf8'));
      expect(findings, `${name}: ${findings.join(', ')}`).toEqual([]);
    },
  );
});

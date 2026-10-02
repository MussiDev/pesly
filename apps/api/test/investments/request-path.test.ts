import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const srcRoot = join(repoRoot, 'apps/api/src');
const investmentsRoot = join(srcRoot, 'investments');

const STATIC_IMPORT =
  /^\s*(?:import|export)\b[^'"]*?from\s*['"]([^'"]+)['"]|^\s*import\s*['"]([^'"]+)['"]/gm;
const DYNAMIC_IMPORT = /\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

/** Modules the API process must never load: providers, jobs, the use cases that drive them. */
const FORBIDDEN = [
  /\/investments\/infrastructure\/provider\//,
  /\/investments\/infrastructure\/jobs\//,
  /\/investments\/jobs$/,
  /\/investments\/application\/refresh-crypto-prices$/,
  /\/investments\/application\/take-daily-snapshots$/,
  /\/investments\/application\/price-ports$/,
  /\/investments\/infrastructure\/db\/drizzle-crypto-price-repository$/,
  /\/investments\/infrastructure\/db\/drizzle-price-schedule$/,
  /\/investments\/infrastructure\/db\/drizzle-price-failure-log$/,
  /\/investments\/infrastructure\/db\/drizzle-snapshot-repository$/,
];

function toPosix(path: string): string {
  return path.replaceAll('\\', '/');
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function specifiers(source: string): string[] {
  const code = stripComments(source);
  const statics = [...code.matchAll(STATIC_IMPORT)].map((m) => m[1] ?? m[2] ?? '');
  const dynamics = [...code.matchAll(DYNAMIC_IMPORT)].map((m) => m[1] ?? '');
  return [...statics, ...dynamics];
}

type FileSystem = (path: string) => string | undefined;

function realFile(path: string): string | undefined {
  return existsSync(path) ? readFileSync(path, 'utf8') : undefined;
}

/** The module a relative specifier names: `x.ts`, then `x/index.ts`; bare packages are ignored. */
function resolveModule(from: string, specifier: string, read: FileSystem): string | undefined {
  if (!specifier.startsWith('.')) return undefined;
  const base = toPosix(resolve(dirname(from), specifier));
  return [`${base}.ts`, `${base}/index.ts`].find((candidate) => read(candidate) !== undefined);
}

/** Every module reachable from the entries through static imports, re-exports and dynamic imports. */
function importClosure(entries: string[], read: FileSystem): Set<string> {
  const seen = new Set<string>();
  const queue = entries.map(toPosix);
  for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
    if (seen.has(file)) continue;
    seen.add(file);
    const source = read(file);
    if (source === undefined) continue;
    for (const specifier of specifiers(source)) {
      const target = resolveModule(file, specifier, read);
      if (target !== undefined && !seen.has(target)) queue.push(target);
    }
  }
  return seen;
}

function forbiddenIn(closure: Set<string>): string[] {
  return [...closure].filter((file) => {
    const module = file.replace(/\/index\.ts$/, '').replace(/\.ts$/, '');
    return FORBIDDEN.some((pattern) => pattern.test(module));
  });
}

const apiEntries = [
  join(srcRoot, 'server.ts'),
  join(srcRoot, 'app.ts'),
  join(investmentsRoot, 'index.ts'),
];

describe('request path never reaches the price provider, the jobs or the worker repositories', () => {
  const closure = importClosure(apiEntries, realFile);

  it('walks the real import graph', () => {
    const rel = [...closure].map((file) => file.slice(toPosix(srcRoot).length));
    expect(rel).toContain('/server.ts');
    expect(rel).toContain('/investments/index.ts');
    expect(rel).toContain('/investments/infrastructure/http/holding-routes.ts');
    expect(rel).toContain('/investments/infrastructure/db/schema.ts');
    expect(rel).toContain('/investments/application/ports.ts');
  });

  it('the API closure contains no provider, job, use case of the jobs or worker repository', () => {
    expect(forbiddenIn(closure)).toEqual([]);
  });

  it('the worker side is a separate graph that does reach them', () => {
    const worker = importClosure([join(investmentsRoot, 'jobs.ts')], realFile);
    const names = forbiddenIn(worker).map((file) => file.slice(toPosix(srcRoot).length));
    expect(names).toContain('/investments/infrastructure/jobs/price-sync-job.ts');
    expect(names).toContain('/investments/infrastructure/provider/coingecko-price-provider.ts');
    expect(names).toContain('/investments/infrastructure/db/drizzle-price-schedule.ts');
  });

  describe('deliberate violation probes', () => {
    const barrel = toPosix(join(investmentsRoot, 'index.ts'));
    const probeFs = (extra: string): FileSystem => {
      const files = new Map<string, string>([
        [barrel, extra],
        [toPosix(join(investmentsRoot, 'jobs.ts')), 'export const jobs = 1;'],
        [toPosix(join(investmentsRoot, 'application/ports.ts')), 'export const ports = 1;'],
        [toPosix(join(investmentsRoot, 'infrastructure/db/schema.ts')), 'export const schema = 1;'],
        [
          toPosix(join(investmentsRoot, 'infrastructure/db/drizzle-market-price-reader.ts')),
          'export const reader = 1;',
        ],
        [
          toPosix(join(investmentsRoot, 'infrastructure/db/drizzle-price-schedule.ts')),
          'export const schedule = 1;',
        ],
        [
          toPosix(join(investmentsRoot, 'infrastructure/provider/fake-price-provider.ts')),
          'export const provider = 1;',
        ],
        [
          toPosix(join(investmentsRoot, 'application/take-daily-snapshots.ts')),
          'export const take = 1;',
        ],
      ]);
      return (path) => files.get(path);
    };
    const detect = (source: string): string[] =>
      forbiddenIn(importClosure([barrel], probeFs(source)));

    it.each([
      "import { jobs } from './jobs';",
      "export { jobs } from './jobs';",
      "import { p } from './infrastructure/provider/fake-price-provider';",
      "import { s } from './infrastructure/db/drizzle-price-schedule';",
      "import { t } from './application/take-daily-snapshots';",
      "const m = await import('./jobs');",
      "const m = require('./infrastructure/provider/fake-price-provider');",
    ])('detects %s', (probe) => {
      expect(detect(probe)).not.toEqual([]);
    });

    it.each([
      "import { ports } from './application/ports';",
      "import { schema } from './infrastructure/db/schema';",
      "import { reader } from './infrastructure/db/drizzle-market-price-reader';",
      "// import { jobs } from './jobs';",
      "import express from 'express';",
    ])('allows %s', (probe) => {
      expect(detect(probe)).toEqual([]);
    });

    it('detects a violation reached through an intermediate module', () => {
      const files = new Map<string, string>([
        [barrel, "import './a';"],
        [toPosix(join(investmentsRoot, 'a.ts')), "export * from './jobs';"],
        [toPosix(join(investmentsRoot, 'jobs.ts')), 'export const jobs = 1;'],
      ]);
      expect(forbiddenIn(importClosure([barrel], (path) => files.get(path)))).toEqual([
        toPosix(join(investmentsRoot, 'jobs.ts')),
      ]);
    });
  });
});

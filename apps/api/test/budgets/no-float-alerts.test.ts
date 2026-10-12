import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const apiRoot = resolve(__dirname, '..', '..');
const sharedRoot = join(apiRoot, '..', '..', 'packages', 'shared');

function filesUnder(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return filesUnder(path);
    return path.endsWith('.ts') ? [path] : [];
  });
}

const inApi = (...parts: string[]) => join(apiRoot, ...parts);

/** The runtime files of the alert feature: the budgets module, the movements port and hook, the notice text. */
function sourceFiles(): string[] {
  return [
    ...filesUnder(inApi('src', 'budgets')),
    inApi('src', 'movements', 'application', 'best-effort-expense-saved.ts'),
    inApi('src', 'movements', 'application', 'ports', 'expense-saved-listener.ts'),
    inApi('src', 'notices', 'domain', 'notice-text.ts'),
    inApi('src', 'notices', 'index.ts'),
    ...filesUnder(join(sharedRoot, 'src', 'notices')),
  ];
}

/** The tests of the feature, this file excluded: its planted samples name the forbidden tokens. */
function testFiles(): string[] {
  const own = (directory: string, pattern: RegExp) =>
    readdirSync(inApi('test', directory))
      .filter((name) => pattern.test(name))
      .map((name) => inApi('test', directory, name));
  return [
    ...own('budgets', /^alerts-.*\.test\.ts$/),
    inApi('test', 'perf', 'budget-alerts.perf.test.ts'),
    ...own('movements', /^expense-saved-.*\.test\.ts$/),
    inApi('test', 'notices', 'notice-text.test.ts'),
  ];
}

function scannedFiles(): string[] {
  return [...sourceFiles(), ...testFiles()];
}

/** Drops comments, so a doc line that explains why a float is avoided does not trip the scan. */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\.not\.toMatch\(\/.*\/[a-z]*\)/g, '');
}

// A row count (`Number(result.rows[0]?.n)`) is the only call allowed; the control of the
// benchmark reads one count from SQL the same way. No amount, rate or percent goes through it.
const FORBIDDEN: [string, RegExp][] = [
  ['parse-float', /\bparseFloat\b/],
  ['to-fixed', /\btoFixed\b/],
  ['number-call', /\bNumber\((?!result\.rows\[0\]\?\.(?:n|expected)\))/],
  ['float-column', /\b(real|doublePrecision|numeric|decimal|float4|float8)\(/],
];

// Built from parts so this file does not contain the tokens the scan forbids.
const PLANTED: [string, string][] = [
  ['parse-float', `const a = ${['parse', 'Float'].join('')}(text);`],
  ['to-fixed', `const a = value.${['to', 'Fixed'].join('')}(2);`],
  ['number-call', `const a = ${['Num', 'ber'].join('')}(text);`],
  ['float-column', `${['nume', 'ric'].join('')}('amount')`],
];

describe('no float money in the budget alerts feature (NFR-03, AC-25, AC-26)', () => {
  it('scans a non-empty set of source and test files', () => {
    expect(sourceFiles().length).toBeGreaterThan(15);
    expect(testFiles().length).toBeGreaterThan(8);
  });

  it.each(FORBIDDEN)('no file of the feature uses %s', (name, pattern) => {
    const offenders = scannedFiles()
      .filter((path) => pattern.test(code(readFileSync(path, 'utf8'))))
      .map((path) => relative(apiRoot, path));
    expect(offenders, name).toEqual([]);
  });

  it.each(PLANTED)('the scan catches a planted %s', (name, planted) => {
    const pattern = FORBIDDEN.find(([label]) => label === name)?.[1];
    expect(pattern?.test(code(planted))).toBe(true);
  });

  it('the scan names the file that holds a forbidden token', () => {
    const files = new Map([
      ['clean.ts', 'const a = 1n;'],
      ['dirty.ts', PLANTED[0]?.[1] ?? ''],
    ]);
    const offenders = [...files]
      .filter(([, source]) => FORBIDDEN.some(([, pattern]) => pattern.test(code(source))))
      .map(([name]) => name);
    expect(offenders).toEqual(['dirty.ts']);
  });

  it('the scan ignores a comment and a row count', () => {
    const allowed = [
      `// ${PLANTED[2]?.[1] ?? ''}`,
      `const n = ${['Num', 'ber'].join('')}(result.rows[0]?.n);`,
    ].join('\n');
    for (const [, pattern] of FORBIDDEN) expect(pattern.test(code(allowed))).toBe(false);
  });

  it('the 0036 migration and its rollback declare no float, numeric or money column', () => {
    for (const path of [
      join(apiRoot, 'drizzle', '0036_budget_alert_marks.sql'),
      join(apiRoot, 'drizzle', 'rollback', '0036_budget_alert_marks.down.sql'),
    ]) {
      expect(readFileSync(path, 'utf8'), relative(apiRoot, path)).not.toMatch(
        /\b(real|double precision|numeric|decimal|float|money)\b/i,
      );
    }
  });

  it('the feature adds no runtime dependency: its files import only modules the project already uses', () => {
    const allowed = new Set([
      '@pesly/shared',
      'drizzle-orm',
      'drizzle-orm/node-postgres',
      'drizzle-orm/pg-core',
      'express',
      'zod',
    ]);
    const bare = new Set<string>();
    for (const path of sourceFiles()) {
      for (const match of readFileSync(path, 'utf8').matchAll(/from '([^'.][^']*)'/g)) {
        if (match[1] !== undefined) bare.add(match[1]);
      }
    }
    expect([...bare].filter((name) => !allowed.has(name))).toEqual([]);
  });
});

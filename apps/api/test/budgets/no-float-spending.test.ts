import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const apiRoot = resolve(__dirname, '..', '..');
const SELF = 'no-float-spending.test.ts';

function filesUnder(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return filesUnder(path);
    return path.endsWith('.ts') ? [path] : [];
  });
}

/** The budgets module, its shared schemas and every test of the feature (this file excluded). */
function scannedFiles(): string[] {
  return [
    ...filesUnder(join(apiRoot, 'src', 'budgets')),
    ...filesUnder(join(apiRoot, '..', '..', 'packages', 'shared', 'src', 'budgets')),
    ...filesUnder(join(apiRoot, 'test', 'budgets')).filter((path) => !path.endsWith(SELF)),
    join(apiRoot, 'test', 'perf', 'budget-spending.perf.test.ts'),
  ];
}

/**
 * Drops comments, so a doc line that explains why a float is avoided does not trip the scan, and
 * the `.not.toMatch(/regex/)` assertions of other tests, which name the forbidden tokens to forbid them.
 */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\.not\.toMatch\(\/.*\/[a-z]*\)/g, '');
}

// `Number.parseInt(<bigint>.toString(), 10)` and `Number.isInteger(` stay allowed: neither one
// creates a float, and `percentUsed` is a bounded integer. Only the `Number(` call is banned,
// except for a row count (`Number(result.rows[0]?.n)`) and the journal timestamp of drizzle's
// migrations table: neither is money.
const FORBIDDEN: [string, RegExp][] = [
  ['parseFloat', /\bparseFloat\b/],
  ['toFixed', /\btoFixed\b/],
  ['Number(', /\bNumber\((?!(?:result|columns)\.rows\[0\]\?\.n\)|row\.created_at\))/],
  ['float column', /\b(real|doublePrecision|numeric|decimal|float4|float8)\(/],
];

describe('no float money in the budget spending feature (NFR-02, AC-28)', () => {
  it('scans a non-empty set of files', () => {
    expect(scannedFiles().length).toBeGreaterThan(30);
  });

  it.each(FORBIDDEN)('no source file or test of the feature uses %s', (name, pattern) => {
    const offenders = scannedFiles()
      .filter((path) => pattern.test(code(readFileSync(path, 'utf8'))))
      .map((path) => relative(apiRoot, path));
    expect(offenders, name).toEqual([]);
  });

  it.each([
    ['parseFloat', 'const a = parseFloat(text);'],
    ['toFixed', 'const a = value.toFixed(2);'],
    ['Number(', 'const a = Number(text);'],
    ['float column', "numeric('amount')"],
  ])('the scan catches a planted %s', (name, planted) => {
    const pattern = FORBIDDEN.find(([label]) => label === name)?.[1];
    expect(pattern?.test(code(planted))).toBe(true);
  });

  it('the scan ignores a comment and the integer parse of a bounded bigint', () => {
    const allowed = ['// Number(x)', 'const a = Number.parseInt(percent.toString(), 10);'].join(
      '\n',
    );
    for (const [, pattern] of FORBIDDEN) expect(pattern.test(code(allowed))).toBe(false);
  });

  it('the 0035 migration declares no float, numeric or money column', () => {
    const sql = readFileSync(
      join(apiRoot, 'drizzle', '0035_group_expense_payer_movement_idx.sql'),
      'utf8',
    );
    expect(sql).not.toMatch(/\b(real|double precision|numeric|decimal|float|money)\b/i);
  });

  it('the 0036 migration declares no float, numeric or money column', () => {
    const sql = readFileSync(join(apiRoot, 'drizzle', '0036_budget_alert_marks.sql'), 'utf8');
    expect(sql).not.toMatch(/\b(real|double precision|numeric|decimal|float|money)\b/i);
  });
});

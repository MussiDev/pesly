import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const apiRoot = resolve(__dirname, '..', '..');
const SELF = 'no-float-dashboard.test.ts';

function filesUnder(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return filesUnder(path);
    return path.endsWith('.ts') ? [path] : [];
  });
}

/** The dashboard module, its shared schema and every test of the feature (this file excluded). */
function scannedFiles(): string[] {
  return [
    ...filesUnder(join(apiRoot, 'src', 'dashboard')),
    ...filesUnder(join(apiRoot, '..', '..', 'packages', 'shared', 'src', 'dashboard')),
    ...filesUnder(join(apiRoot, 'test', 'dashboard')).filter((path) => !path.endsWith(SELF)),
    join(apiRoot, 'test', 'perf', 'dashboard.perf.test.ts'),
  ];
}

/** Drops comments and the `.not.toMatch(/regex/)` assertions that name a forbidden token to forbid it. */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\.not\.toMatch\(\/.*\/[a-z]*\)/g, '');
}

const FORBIDDEN: [string, RegExp][] = [
  ['parseFloat', /\bparseFloat\b/],
  ['toFixed', /\btoFixed\b/],
  ['Math.round', /\bMath\.round\b/],
  ['Math.floor', /\bMath\.floor\b/],
  ['Number(', /\bNumber\(/],
  ['float column', /\b(real|doublePrecision|numeric|decimal|float4|float8)\(/],
];

describe('no float money in the dashboard feature (NFR-02, AC-51)', () => {
  it('scans a non-empty set of files', () => {
    expect(scannedFiles().length).toBeGreaterThan(40);
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
    ['Math.round', 'const a = Math.round(value);'],
    ['Math.floor', 'const a = Math.floor(value);'],
    ['Number(', 'const a = Number(text);'],
    ['float column', "numeric('amount')"],
  ])('the scan catches a planted %s', (name, planted) => {
    const pattern = FORBIDDEN.find(([label]) => label === name)?.[1];
    expect(pattern?.test(code(planted))).toBe(true);
  });

  it('the scan ignores a comment, a bigint conversion and the allowed integer helpers', () => {
    const allowed = [
      '// Number(x)',
      'const a = BigInt(text);',
      'const b = Number.parseInt(value.toString(), 10);',
      'const c = Number.isInteger(value);',
    ].join('\n');
    for (const [, pattern] of FORBIDDEN) expect(pattern.test(code(allowed))).toBe(false);
  });
});

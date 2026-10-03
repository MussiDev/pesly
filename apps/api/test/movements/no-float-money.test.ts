import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const SCANNED_DIRS = ['apps/api/src/movements', 'packages/shared/src/movements'];
const SCANNED_FILES = ['apps/web/src/features/movements/format-rate.ts'];

// The age helpers (`rateAgeMs`, `RATE_AGE_WARNING_MS`) measure time, so they are not matched: only
// identifiers named exactly amount, rate, buy or sell are flagged when typed as numbers.
const FORBIDDEN: ReadonlyArray<readonly [string, RegExp]> = [
  ['parseFloat', /\bparseFloat\b/],
  ['Number(', /\bNumber\s*\(/],
  ['.toFixed', /\.toFixed\b/],
  ['Math.round', /\bMath\.round\b/],
  ['number-typed amount/rate/buy/sell', /\b(?:amount|rate|buy|sell)\s*\??\s*:\s*number\b/],
];

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** Source-text scan: the float-style constructs found in the source. */
function floatFindings(source: string): string[] {
  const code = stripComments(source);
  return FORBIDDEN.filter(([, pattern]) => pattern.test(code)).map(([name]) => name);
}

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return tsFiles(full);
    return full.endsWith('.ts') ? [full] : [];
  });
}

describe('no floating point in the movements sources (NFR-01, NFR-02)', () => {
  it.each([
    ['const rate = parseFloat(x);', 'parseFloat'],
    ['const amount = Number(x);', 'Number('],
    ['const s = value.toFixed(2);', '.toFixed'],
    ['const r = Math.round(x * 10000);', 'Math.round'],
    ['interface M { amount: number }', 'number-typed amount/rate/buy/sell'],
    ['interface M { rate?: number }', 'number-typed amount/rate/buy/sell'],
    ['function f(buy: number) {}', 'number-typed amount/rate/buy/sell'],
    ['function f(sell : number) {}', 'number-typed amount/rate/buy/sell'],
  ])('the scanner flags %s', (probe, expected) => {
    expect(floatFindings(probe)).toContain(expected);
  });

  it.each([
    'const amount = 12_3400n;',
    'interface M { amount: bigint; count: number }',
    'export function rateAgeMs(now: Date): number { return 1; }',
    'export const RATE_AGE_WARNING_MS: number = 7_200_000;',
    'interface M { rateAgeMs: number; ratePercent: number }',
    '// parseFloat and Number( and amount: number in a comment\nconst a = 1n;',
    '/* Math.round(x).toFixed(2) */ const a = 1n;',
  ])('the scanner passes clean probe %#', (probe) => {
    expect(floatFindings(probe)).toEqual([]);
  });

  const files = [
    ...SCANNED_DIRS.flatMap((dir) => tsFiles(join(repoRoot, dir))),
    ...SCANNED_FILES.map((file) => join(repoRoot, file)),
  ];

  it('finds the source files to scan', () => {
    expect(files.length).toBeGreaterThanOrEqual(25);
  });

  it('scans the implied-rate helper and the transfer and exchange use case', () => {
    const names = files.map((file) => file.slice(repoRoot.length).replaceAll('\\', '/'));
    expect(names).toContain('packages/shared/src/movements/implied-rate.ts');
    expect(names).toContain('apps/api/src/movements/application/create-movement.ts');
  });

  it.each([
    'export const toRate = (x: bigint) => parseFloat(String(x));',
    'export const toRate = (x: bigint) => Number(x) / 100;',
    'export const text = (x: number) => x.toFixed(4);',
    'export const rounded = (x: number) => Math.round(x);',
    'export function impliedRate(amount: number, destinationAmount: bigint): bigint { return 1n; }',
  ])('a probe appended to implied-rate.ts is flagged: %s', (probe) => {
    const real = readFileSync(
      join(repoRoot, 'packages/shared/src/movements/implied-rate.ts'),
      'utf8',
    );
    expect(floatFindings(real)).toEqual([]);
    expect(
      floatFindings(`${real}
${probe}
`),
    ).not.toEqual([]);
  });

  it.each(files.map((file) => [file.slice(repoRoot.length).replaceAll('\\', '/'), file]))(
    'has no float constructs: %s',
    (name, file) => {
      const findings = floatFindings(readFileSync(file, 'utf8'));
      expect(findings, `${name}: ${findings.join(', ')}`).toEqual([]);
    },
  );
});

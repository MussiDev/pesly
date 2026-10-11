import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const groups = resolve(fileURLToPath(new URL('.', import.meta.url)), '../src/features/groups');

const FOLDERS = [
  'balances',
  'consolidation',
  'settlement-form',
  'settlements',
  'settlements-history',
].map((name) => join(groups, name));

// Intl.NumberFormat is not listed: settlement-request.ts only asks it for the decimal separator
// (formatToParts(1.5)), which is no money value.
const forbidden = [
  'parseFloat',
  'parseInt',
  'Number(',
  'toFixed',
  'Math.round',
  'Math.floor',
  'Math.ceil',
  'Math.trunc',
  'toLocaleString',
];

// Float arithmetic on an amount: a decimal literal next to an operator, or `* 0.x` style scaling.
const FLOAT_ARITHMETIC = /[*/]\s*\d+\.\d+|\d+\.\d+\s*[*/]/;

function sources(path: string): string[] {
  if (!existsSync(path)) return [];
  if (!statSync(path).isDirectory()) return [path];
  return readdirSync(path).flatMap((entry) => {
    const child = join(path, entry);
    if (statSync(child).isDirectory()) return sources(child);
    return /\.tsx?$/.test(entry) ? [child] : [];
  });
}

function violationsIn(text: string): string[] {
  const tokens = forbidden.filter((token) => text.includes(token));
  return FLOAT_ARITHMETIC.test(text) ? [...tokens, 'float arithmetic'] : tokens;
}

describe('no money goes through a float in the group settlement folders (NFR-04)', () => {
  it('finds the sources to scan', () => {
    for (const folder of FOLDERS) expect(sources(folder).length).toBeGreaterThanOrEqual(1);
  });

  it('contains no float conversions, rounding or float arithmetic', () => {
    const offenders = FOLDERS.flatMap((folder) => sources(folder)).flatMap((file) =>
      violationsIn(readFileSync(file, 'utf8')).map((token) => `${file}: ${token}`),
    );
    expect(offenders).toEqual([]);
  });

  it.each([
    ['const r = parseFloat(x);', ['parseFloat']],
    ['const a = Number(x);', ['Number(']],
    ['const s = v.toFixed(2);', ['toFixed']],
    ['const r = Math.round(x);', ['Math.round']],
    ['const half = amount * 0.5;', ['float arithmetic']],
    ['const share = total / 3.0;', ['float arithmetic']],
  ])('the scanner flags the probe %s', (probe, expected) => {
    expect(violationsIn(probe)).toEqual(expected);
  });

  it('the scanner passes clean bigint code', () => {
    expect(violationsIn('const cash = (leg * rate) / 10_000n;')).toEqual([]);
  });
});

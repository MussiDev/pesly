import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const webSrc = resolve(fileURLToPath(new URL('.', import.meta.url)), '../src');
const forbidden = [
  'parseFloat',
  'parseInt',
  'Number(',
  'toFixed',
  'Math.round',
  'Math.floor',
  'Intl.NumberFormat',
  'toLocaleString',
];

function sources(path: string): string[] {
  if (!existsSync(path)) return [];
  if (!statSync(path).isDirectory()) return [path];
  return readdirSync(path).flatMap((entry) => {
    const child = join(path, entry);
    if (statSync(child).isDirectory()) return sources(child);
    return /\.tsx?$/.test(entry) ? [child] : [];
  });
}

function forbiddenTokensIn(text: string): string[] {
  return forbidden.filter((token) => text.includes(token));
}

function offendersIn(path: string): string[] {
  return sources(path).flatMap((file) =>
    forbiddenTokensIn(readFileSync(file, 'utf8')).map((t) => `${file}: ${t}`),
  );
}

describe('no floating-point money arithmetic in the web app (NFR-01, NFR-02) (AC-10, AC-11)', () => {
  const formatAmount = join(webSrc, 'lib/format-amount.ts');
  const investments = join(webSrc, 'features/investments');
  const movementRequest = join(webSrc, 'features/movements/movement-request.ts');
  const impliedRatePreview = join(webSrc, 'features/movements/implied-rate-preview.ts');

  it('finds the sources to scan', () => {
    expect(sources(formatAmount)).toHaveLength(1);
    expect(sources(investments).length).toBeGreaterThanOrEqual(1);
    expect(sources(movementRequest)).toHaveLength(1);
    expect(sources(impliedRatePreview)).toHaveLength(1);
  });

  it('format-amount.ts contains no float conversions or rounding', () => {
    expect(offendersIn(formatAmount)).toEqual([]);
  });

  it('features/investments contains no float conversions or rounding', () => {
    expect(offendersIn(investments)).toEqual([]);
  });

  it('movement-request.ts contains no float conversions or rounding (DISC-001-03c)', () => {
    expect(offendersIn(movementRequest)).toEqual([]);
  });

  it('implied-rate-preview.ts contains no float conversions or rounding (DISC-001-03c)', () => {
    expect(offendersIn(impliedRatePreview)).toEqual([]);
  });

  it.each([
    ['const r = parseFloat(x);', 'parseFloat'],
    ['const n = parseInt(x, 10);', 'parseInt'],
    ['const a = Number(x);', 'Number('],
    ['const s = v.toFixed(2);', 'toFixed'],
    ['const r = Math.round(x);', 'Math.round'],
    ['const r = Math.floor(x);', 'Math.floor'],
    ["const f = new Intl.NumberFormat('es');", 'Intl.NumberFormat'],
    ['const s = v.toLocaleString();', 'toLocaleString'],
  ])('the scanner flags the probe %s (DISC-001-03c)', (probe, token) => {
    expect(forbiddenTokensIn(probe)).toEqual([token]);
  });

  it('the scanner passes clean bigint code', () => {
    expect(forbiddenTokensIn('const rate = (out * 10_000n) / into;')).toEqual([]);
  });

  it('a probe in either new movement file would be reported with the file and the token', () => {
    for (const path of [movementRequest, impliedRatePreview]) {
      const text = `${readFileSync(path, 'utf8')}
const probe = Number(1);
`;
      expect(forbiddenTokensIn(text)).toEqual(['Number(']);
    }
  });
});

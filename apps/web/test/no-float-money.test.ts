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

function offendersIn(path: string): string[] {
  return sources(path).flatMap((file) => {
    const text = readFileSync(file, 'utf8');
    return forbidden.filter((token) => text.includes(token)).map((t) => `${file}: ${t}`);
  });
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
});

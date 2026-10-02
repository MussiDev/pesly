import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../..');
const sharedRoot = 'packages/shared/src/investments';
const apiRoot = 'apps/api/src/investments';
const forbidden = [
  'parseFloat',
  'parseInt',
  'Number(',
  'Number.',
  'toFixed',
  'Math.round',
  'Math.floor',
  'Math.ceil',
  'Math.trunc',
];

function sources(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(entry) ? [path] : [];
  });
}

function offendersIn(relative: string): string[] {
  return sources(join(root, relative)).flatMap((file) => {
    const text = readFileSync(file, 'utf8');
    return forbidden.filter((token) => text.includes(token)).map((t) => `${file}: ${t}`);
  });
}

describe('no floating-point money arithmetic (NFR-01, NFR-02)', () => {
  it('finds the shared investments sources to scan', () => {
    expect(sources(join(root, sharedRoot)).length).toBeGreaterThanOrEqual(4);
  });

  it(`${sharedRoot} contains no float conversions or rounding`, () => {
    expect(offendersIn(sharedRoot)).toEqual([]);
  });

  // The API module only exists from the later blocks on; this row guards those blocks. While the
  // directory is missing it is skipped explicitly (never a silent pass); once it exists it must
  // contain sources and none may use float conversions.
  const apiExists = existsSync(join(root, apiRoot));
  it.skipIf(!apiExists)(`${apiRoot} contains sources and no float conversions`, () => {
    expect(sources(join(root, apiRoot)).length).toBeGreaterThan(0);
    expect(offendersIn(apiRoot)).toEqual([]);
  });

  // The 07b domain files must be part of the scanned set, so a rename or move cannot hide them.
  it.each(['crypto-price.ts', 'snapshot-date.ts', 'price-failure.ts'])(
    `${apiRoot}/domain/%s is scanned and has no float conversions`,
    (name) => {
      const file = join(root, apiRoot, 'domain', name);
      expect(sources(join(root, apiRoot))).toContain(file);
      expect(offendersIn(apiRoot).filter((line) => line.startsWith(file))).toEqual([]);
    },
  );
});

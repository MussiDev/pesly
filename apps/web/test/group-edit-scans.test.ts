import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const groups = resolve(fileURLToPath(new URL('.', import.meta.url)), '../src/features/groups');

const MONEY_FOLDERS = ['edit', 'activity', 'expenses/edit', 'settlements-edit'].map((name) =>
  join(groups, name),
);

// Number.parseInt is allowed: expense-edit-values.ts parses a basis-point string with it, no money value.
const forbidden = [
  'parseFloat',
  'Number(',
  'toFixed',
  'Math.round',
  'Math.floor',
  'Math.ceil',
  'Math.trunc',
  'toLocaleString',
];

const FLOAT_ARITHMETIC = /[*/]\s*\d+\.\d+|\d+\.\d+\s*[*/]/;

// The screens write through the 04e queue only (05h decision D2); the sync pass is the one caller.
const DIRECT_WRITES = [
  'updateGroupExpense',
  'deleteGroupExpense',
  'updateSettlement',
  'deleteSettlement',
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

describe('no money goes through a float in the group edit and activity folders (NFR-04)', () => {
  it('finds the sources to scan', () => {
    for (const folder of MONEY_FOLDERS) expect(sources(folder).length).toBeGreaterThanOrEqual(1);
  });

  it('contains no float conversion, rounding or float arithmetic', () => {
    const offenders = MONEY_FOLDERS.flatMap((folder) => sources(folder)).flatMap((file) => {
      const text = readFileSync(file, 'utf8');
      const tokens = forbidden.filter((token) => text.includes(token));
      return (FLOAT_ARITHMETIC.test(text) ? [...tokens, 'float arithmetic'] : tokens).map(
        (token) => `${file}: ${token}`,
      );
    });
    expect(offenders).toEqual([]);
  });
});

describe('group screens never call the API to change a record directly (decision D2)', () => {
  it('finds the sources to scan', () => {
    expect(sources(groups).length).toBeGreaterThan(20);
  });

  it('keeps every update and delete call out of src/features/groups', () => {
    const offenders = sources(groups).flatMap((file) => {
      const text = readFileSync(file, 'utf8');
      return DIRECT_WRITES.filter((name) => text.includes(name)).map((name) => `${file}: ${name}`);
    });
    expect(offenders).toEqual([]);
  });
});

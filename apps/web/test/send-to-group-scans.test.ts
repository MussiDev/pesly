import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** Cross-cutting scans of spec 05i (Block 14): NFR-05 (no float money), FR-14 (no hardcoded strings). */

const src = resolve(fileURLToPath(new URL('.', import.meta.url)), '../src');
const movements = join(src, 'features/movements');

const NEW_FOLDERS = [join(movements, 'send-to-group'), join(src, 'features/groups/activity')];

const TOUCHED_FILES = [
  join(movements, 'components/movement-row.tsx'),
  join(movements, 'components/movement-list.tsx'),
  join(movements, 'components/movement-form.tsx'),
  join(movements, 'containers/movements-container.tsx'),
  join(movements, 'containers/edit-movement-container.tsx'),
  join(src, 'app/[locale]/(app)/movements/send/page.tsx'),
];

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

// The group write calls of the 04e queue: the send screen and the movement screens never use them.
const DIRECT_GROUP_WRITES = [
  'updateGroupExpense',
  'deleteGroupExpense',
  'updateSettlement',
  'deleteSettlement',
  'createGroupExpense',
  'recordSettlement',
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

const NEW_SOURCES = NEW_FOLDERS.flatMap((folder) => sources(folder));
const ALL_SOURCES = [...NEW_SOURCES, ...TOUCHED_FILES];

/** Code with comments and import lines removed, so prose and module names do not trip the scans. */
function code(file: string): string {
  return (
    readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/^import[\s\S]*?;$/gm, '')
      // `Number(flag)` sorts booleans (archived last); it never touches an amount.
      .replace(/Number\(\w+\.archived\)/g, 'flag')
  );
}

describe('the new and touched files exist', () => {
  it('finds the sources to scan', () => {
    expect(NEW_SOURCES.length).toBeGreaterThanOrEqual(5);
    for (const file of TOUCHED_FILES) expect(existsSync(file), file).toBe(true);
  });
});

describe('no money goes through a float in the new and touched files (NFR-05)', () => {
  it('contains no float conversion, rounding or float arithmetic', () => {
    const offenders = ALL_SOURCES.flatMap((file) => {
      const text = code(file);
      const tokens = forbidden.filter((token) => text.includes(token));
      return (FLOAT_ARITHMETIC.test(text) ? [...tokens, 'float arithmetic'] : tokens).map(
        (token) => `${file}: ${token}`,
      );
    });
    expect(offenders).toEqual([]);
  });
});

describe('the screens never write a group record directly (FR-18)', () => {
  it('uses none of the direct group write calls of the sync queue', () => {
    const offenders = ALL_SOURCES.filter((file) => !file.includes('groups')).flatMap((file) => {
      const text = code(file);
      return DIRECT_GROUP_WRITES.filter((name) => text.includes(name)).map(
        (name) => `${file}: ${name}`,
      );
    });
    expect(offenders).toEqual([]);
  });

  it('sends only through sendMovementToGroup, and only from the send container', () => {
    const callers = ALL_SOURCES.filter((file) => /\.sendMovementToGroup\(/.test(code(file)));
    expect(callers.map((file) => file.replace(/\\/g, '/').split('/').pop())).toEqual([
      'send-to-group-container.tsx',
    ]);
  });
});

describe('no UI string is hardcoded in the new and touched files (FR-14)', () => {
  const TEXT_NODE = />[ \t]*[A-Za-zÁÉÍÓÚáéíóúñÑ¿¡][^<>{}=;()]*<\//;
  const TEXT_ATTRIBUTE = /\b(?:title|aria-label|placeholder|alt|label)="[^"{]*[A-Za-zÁÉÍÓÚáéíóúñÑ]/;
  const TEXT_LITERAL_PROP =
    /\b(?:title|aria-label|placeholder|alt|label)=\{\s*['"`][^'"`]*[A-Za-zÁÉÍÓÚáéíóúñÑ]/;

  it('has no text between tags and no literal in a text attribute', () => {
    const offenders = ALL_SOURCES.filter((file) => file.endsWith('.tsx')).flatMap((file) => {
      const text = code(file);
      return [TEXT_NODE, TEXT_ATTRIBUTE, TEXT_LITERAL_PROP]
        .filter((pattern) => pattern.test(text))
        .map((pattern) => `${file}: ${pattern.source.slice(0, 30)}`);
    });
    expect(offenders).toEqual([]);
  });

  it('the detector flags what it should (guard against a scan that matches nothing)', () => {
    expect(TEXT_NODE.test('<p>Enviar al grupo</p>')).toBe(true);
    expect(TEXT_ATTRIBUTE.test('<a title="Enviar" />')).toBe(true);
    expect(TEXT_LITERAL_PROP.test("<a aria-label={'Enviar'} />")).toBe(true);
    expect(TEXT_NODE.test('<p>{t("title")}</p>')).toBe(false);
    expect(TEXT_NODE.test('Promise<ApiResult<{ items: T[] }>>')).toBe(false);
    expect(TEXT_NODE.test('Promise<ApiResult<{ items: T[] }>>')).toBe(false);
  });
});

type Catalog = { [key: string]: string | Catalog };

function load(locale: string): Catalog {
  const path = fileURLToPath(new URL(`../messages/${locale}.json`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8')) as Catalog;
}

function flatten(catalog: Catalog, prefix = ''): Map<string, string> {
  const result = new Map<string, string>();
  for (const [key, value] of Object.entries(catalog)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') result.set(path, value);
    else for (const [k, v] of flatten(value, path)) result.set(k, v);
  }
  return result;
}

describe('the Spanish and English catalogs carry the new keys (NFR-04)', () => {
  const es = flatten(load('es'));
  const en = flatten(load('en'));
  const OWN = [
    'movements.sendToGroup.',
    'movements.list.inGroup',
    'movements.list.highlighted',
    'movements.list.actions.sendToGroup',
    'movements.edit.groupNotice',
    'movements.edit.lockedFields',
    'groups.activity.fromMovement',
    'groups.activity.autoCategory',
  ];
  const own = (key: string) => OWN.some((prefix) => key.startsWith(prefix));

  it('has the same keys in both languages and none empty', () => {
    expect([...es.keys()].sort()).toEqual([...en.keys()].sort());
    const mine = [...es.keys()].filter(own);
    expect(mine.length).toBeGreaterThanOrEqual(25);
    for (const key of mine) {
      expect(es.get(key)?.trim(), `es ${key}`).not.toBe('');
      expect(en.get(key)?.trim(), `en ${key}`).not.toBe('');
    }
  });

  it('has the four error codes of the send, in both languages', () => {
    const errors = [...es.keys()].filter((key) => key.startsWith('errors.'));
    expect(errors.length).toBeGreaterThan(0);
    for (const key of errors) expect(en.has(key), key).toBe(true);
  });
});

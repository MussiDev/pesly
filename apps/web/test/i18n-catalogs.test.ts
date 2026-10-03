import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CATEGORY_COLORS, CATEGORY_ICONS, DEFAULT_CATEGORIES } from '@pesly/shared';
import { describe, expect, it } from 'vitest';
import manifest from '../src/app/manifest';

type Catalog = { [key: string]: string | Catalog };

const LOCALES = ['es', 'en'] as const;

function loadCatalog(locale: string): Catalog {
  const path = fileURLToPath(new URL(`../messages/${locale}.json`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8')) as Catalog;
}

function flattenKeys(catalog: Catalog, prefix = ''): string[] {
  return Object.entries(catalog).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === 'string' ? [path] : flattenKeys(value, path);
  });
}

function readString(catalog: Catalog, dottedKey: string): string | undefined {
  let current: string | Catalog | undefined = catalog;
  for (const part of dottedKey.split('.')) {
    if (current === undefined || typeof current === 'string') return undefined;
    current = current[part];
  }
  return typeof current === 'string' ? current : undefined;
}

/** Dotted keys of every string that still names the old product (any case; "Argentina" is fine). */
function productNameLeaks(catalog: Catalog, prefix = ''): string[] {
  return Object.entries(catalog).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value !== 'string') return productNameLeaks(value, path);
    return /\bargent\b/i.test(value) ? [path] : [];
  });
}

/** Keys of `from` that `to` lacks; empty when `to` covers `from`. */
function missingKeys(from: Catalog, to: Catalog): string[] {
  const present = new Set(flattenKeys(to));
  return flattenKeys(from).filter((key) => !present.has(key));
}

/** Parity in both directions, one message per gap that names the key and the catalog lacking it. */
function parityProblems(es: Catalog, en: Catalog): string[] {
  return [
    ...missingKeys(es, en).map((key) => `${key} is in es but missing from en`),
    ...missingKeys(en, es).map((key) => `${key} is in en but missing from es`),
  ];
}

/** Index of the `}` that closes the `{` at `open`. */
function closingBrace(text: string, open: number): number {
  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    if (text[index] === '{') depth += 1;
    if (text[index] === '}') depth -= 1;
    if (depth === 0) return index;
  }
  return text.length;
}

/** Argument names of an ICU message, including those nested in plural and select branches. */
function icuArguments(text: string, found = new Set<string>()): Set<string> {
  let index = text.indexOf('{');
  while (index !== -1) {
    const end = closingBrace(text, index);
    const [name = '', type = '', ...rest] = splitTop(text.slice(index + 1, end));
    found.add(name.trim());
    if (['plural', 'select', 'selectordinal'].includes(type.trim())) {
      for (const branch of rest.join(',').matchAll(/\{/g)) {
        const branchEnd = closingBrace(rest.join(','), branch.index);
        icuArguments(rest.join(',').slice(branch.index + 1, branchEnd), found);
      }
    }
    index = text.indexOf('{', end + 1);
  }
  return found;
}

/** Splits an argument body on its first two commas only (name, type, options). */
function splitTop(body: string): string[] {
  const first = body.indexOf(',');
  if (first === -1) return [body];
  const second = body.indexOf(',', first + 1);
  if (second === -1) return [body.slice(0, first), body.slice(first + 1)];
  return [body.slice(0, first), body.slice(first + 1, second), body.slice(second + 1)];
}

/** One message per key whose ICU argument names differ between es and en. */
function placeholderProblems(es: Catalog, en: Catalog): string[] {
  const enStrings = new Map(stringsOf(en));
  const show = (names: Set<string>): string => `{${[...names].sort().join(',')}}`;
  return stringsOf(es).flatMap(([key, value]) => {
    const other = enStrings.get(key);
    if (other === undefined) return [];
    const mine = icuArguments(value);
    const theirs = icuArguments(other);
    return show(mine) === show(theirs)
      ? []
      : [`${key}: es has ${show(mine)} but en has ${show(theirs)}`];
  });
}

/** Top-level keys as written in the file: JSON.parse silently drops a duplicated namespace. */
function topLevelKeys(raw: string): string[] {
  const keys: string[] = [];
  let depth = 0;
  let index = 0;
  while (index < raw.length) {
    const char = raw[index];
    if (char === '"') {
      let end = index + 1;
      while (raw[end] !== '"') end += raw[end] === '\\' ? 2 : 1;
      const isKey = depth === 1 && /^\s*:/.test(raw.slice(end + 1));
      if (isKey) keys.push(JSON.parse(raw.slice(index, end + 1)) as string);
      index = end + 1;
      continue;
    }
    if (char === '{' || char === '[') depth += 1;
    if (char === '}' || char === ']') depth -= 1;
    index += 1;
  }
  return keys;
}

function duplicates(values: string[]): string[] {
  return values.filter((value, index) => values.indexOf(value) !== index);
}

function readRaw(locale: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../messages/${locale}.json`, import.meta.url)),
    'utf8',
  );
}

describe('i18n catalogs (NFR-10)', () => {
  const esKeys = flattenKeys(loadCatalog('es'));
  const enKeys = flattenKeys(loadCatalog('en'));

  it('is not empty', () => {
    expect(esKeys.length).toBeGreaterThan(0);
  });

  it('has every es key in en', () => {
    expect(esKeys.filter((key) => !enKeys.includes(key))).toEqual([]);
  });

  it('has every en key in es', () => {
    expect(enKeys.filter((key) => !esKeys.includes(key))).toEqual([]);
  });
});

describe('i18n catalog parity, namespace by namespace (FEAT-004 AC-25)', () => {
  const es = loadCatalog('es');
  const en = loadCatalog('en');
  const namespaces = Object.keys(es);

  it('has the same top-level namespaces in both catalogs', () => {
    expect(Object.keys(en).sort()).toEqual([...namespaces].sort());
  });

  it.each(namespaces)('has every key of the %s namespace in both catalogs, both ways', (name) => {
    const only = (catalog: Catalog): Catalog => ({ [name]: catalog[name] ?? {} });

    expect(parityProblems(only(es), only(en)), `namespace ${name}`).toEqual([]);
  });

  it('has the same ICU arguments in en and es for every key', () => {
    expect(placeholderProblems(es, en)).toEqual([]);
  });

  it('extracts simple, plural and nested arguments', () => {
    expect(
      [...icuArguments('Hi {name}, {n, plural, one {# {thing}} other {# things}}')].sort(),
    ).toEqual(['n', 'name', 'thing']);
    expect([...icuArguments("No arguments, just a # and an apostrophe's")]).toEqual([]);
  });

  it('error: an es string that lacks an argument of en is reported with its key', () => {
    const esFixture: Catalog = {
      subcategories: { label: 'Subcategorías' },
      ok: { a: 'Hola {name}' },
    };
    const enFixture: Catalog = {
      subcategories: { label: 'Subcategories of {name}' },
      ok: { a: 'Hi {name}' },
    };

    expect(placeholderProblems(esFixture, enFixture)).toEqual([
      'subcategories.label: es has {} but en has {name}',
    ]);
  });

  it('error: a renamed argument and a plural variable that differ are reported', () => {
    const esFixture: Catalog = { a: 'Hola {nombre}', b: '{total, plural, other {# cosas}}' };
    const enFixture: Catalog = { a: 'Hi {name}', b: '{count, plural, other {# things}}' };

    expect(placeholderProblems(esFixture, enFixture)).toEqual([
      'a: es has {nombre} but en has {name}',
      'b: es has {total} but en has {count}',
    ]);
  });

  it('has no empty string in either catalog', () => {
    const empty = LOCALES.flatMap((locale) =>
      stringsOf(loadCatalog(locale))
        .filter(([, value]) => value.trim() === '')
        .map(([key]) => `${locale}: ${key}`),
    );

    expect(empty).toEqual([]);
  });

  it.each(LOCALES)('parses %s.json as JSON with no duplicate top-level namespace', (locale) => {
    const raw = readRaw(locale);

    expect(() => {
      JSON.parse(raw);
    }).not.toThrow();
    expect(duplicates(topLevelKeys(raw))).toEqual([]);
    expect(topLevelKeys(raw).sort()).toEqual(Object.keys(loadCatalog(locale)).sort());
  });

  it('error: a key missing from en is reported by name', () => {
    const esFixture: Catalog = { home: { title: 'Pesly', empty: { action: 'Crear' } } };
    const enFixture: Catalog = { home: { title: 'Pesly', empty: {} } };

    expect(parityProblems(esFixture, enFixture)).toEqual([
      'home.empty.action is in es but missing from en',
    ]);
  });

  it('error: a key missing from es is reported by name', () => {
    const esFixture: Catalog = { home: { title: 'Pesly' } };
    const enFixture: Catalog = { home: { title: 'Pesly', tagline: 'Hi' } };

    expect(parityProblems(esFixture, enFixture)).toEqual([
      'home.tagline is in en but missing from es',
    ]);
  });

  it('error: a whole namespace missing from one catalog lists each of its keys', () => {
    const esFixture: Catalog = { home: { title: 'Pesly' }, ui: { retry: 'Reintentar' } };
    const enFixture: Catalog = { home: { title: 'Pesly' } };

    expect(parityProblems(esFixture, enFixture)).toEqual(['ui.retry is in es but missing from en']);
  });

  it('error: a duplicated top-level namespace is detected in the raw text', () => {
    const raw = '{ "home": { "title": "a" }, "ui": { "home": 1 }, "home": { "title": "b" } }';

    expect(duplicates(topLevelKeys(raw))).toEqual(['home']);
  });

  it('error: a type mismatch (string vs namespace) shows up as a missing key', () => {
    const esFixture: Catalog = { home: { empty: 'x' } };
    const enFixture: Catalog = { home: { empty: { title: 'x' } } };

    expect(parityProblems(esFixture, enFixture)).toEqual([
      'home.empty is in es but missing from en',
      'home.empty.title is in en but missing from es',
    ]);
  });
});

/** Every string of a catalog branch, with its dotted key. */
function stringsOf(catalog: Catalog, prefix = ''): [string, string][] {
  return Object.entries(catalog).flatMap(([key, value]): [string, string][] => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === 'string' ? [[path, value]] : stringsOf(value, path);
  });
}

describe('categories catalog (DISC-001-02b)', () => {
  it.each(LOCALES)('has a categories namespace and a nav label in %s', (locale) => {
    const catalog = loadCatalog(locale);

    expect(readString(catalog, 'categories.title')).toBeTruthy();
    expect(readString(catalog, 'app.nav.categories')).toBeTruthy();
  });

  it.each(LOCALES)(
    'has the restyled list and action strings in %s (FEAT-004 Block 6)',
    (locale) => {
      const catalog = loadCatalog(locale);

      for (const key of [
        'list.activeTitle',
        'list.archivedTitle',
        'list.empty',
        'list.emptyArchived',
        'list.emptyAction',
        'list.emptyArchivedAction',
        'list.emptySection',
        'list.showArchived',
        'list.subcategories',
        'actions.edit',
        'actions.save',
        'actions.cancel',
        'actions.archive',
        'actions.unarchive',
        'actions.delete',
        'actions.confirmDelete',
        'actions.confirmDeleteYes',
        'actions.archiveInstead',
      ]) {
        expect(readString(catalog, `categories.${key}`), `categories.${key}`).toBeTruthy();
      }
    },
  );

  it.each(LOCALES)(
    'does not duplicate any default category name in the %s namespace (shared catalog is the source)',
    (locale) => {
      const namespace = loadCatalog(locale)['categories'];
      expect(typeof namespace).toBe('object');
      const defaultNames = new Set(
        DEFAULT_CATEGORIES.flatMap((entry) => [entry.names.es, entry.names.en]),
      );
      const leaks = stringsOf(namespace as Catalog, 'categories')
        .filter(([, value]) => defaultNames.has(value))
        .map(([key]) => key);

      expect(leaks).toEqual([]);
    },
  );

  it.each(LOCALES)('labels every category icon and color in %s', (locale) => {
    const catalog = loadCatalog(locale);

    for (const icon of CATEGORY_ICONS) {
      expect(readString(catalog, `categories.icons.${icon}`)).toBeTruthy();
    }
    for (const color of CATEGORY_COLORS) {
      expect(readString(catalog, `categories.colors.${color}`)).toBeTruthy();
    }
  });

  it('default-name error: reports a namespace string equal to a default name', () => {
    const namespace: Catalog = { sections: { expense: 'Comida' }, title: 'Categories' };
    const defaultNames = new Set(['Comida']);

    expect(
      stringsOf(namespace, 'categories')
        .filter(([, value]) => defaultNames.has(value))
        .map(([key]) => key),
    ).toEqual(['categories.sections.expense']);
  });
});

describe('available balance labels (FEAT-003 AC-23, NFR-05)', () => {
  it.each([
    ['es', 'accounts.headline.available', 'Disponible'],
    ['es', 'accounts.headline.netWorth', 'Patrimonio neto'],
    ['es', 'accounts.debt.title', 'Deudas'],
    ['es', 'accounts.fields.includeInAvailable', 'Incluir en disponible'],
    ['en', 'accounts.headline.available', 'Available'],
    ['en', 'accounts.headline.netWorth', 'Net worth'],
    ['en', 'accounts.debt.title', 'Debt'],
    ['en', 'accounts.fields.includeInAvailable', 'Include in available'],
  ])('holds the exact wording in %s for %s', (locale, key, wording) => {
    expect(readString(loadCatalog(locale), key)).toBe(wording);
  });

  it.each(LOCALES)('has a non-empty accountArchived error in %s', (locale) => {
    expect(readString(loadCatalog(locale), 'errors.accountArchived')?.length).toBeGreaterThan(0);
  });
});

describe('investments catalog (DISC-001-07a)', () => {
  it.each(LOCALES)('has the investments namespace and the navigation label in %s', (locale) => {
    const catalog = loadCatalog(locale);

    expect(typeof catalog.investments).toBe('object');
    expect(readString(catalog, 'investments.title')).toBeTruthy();
    expect(readString(catalog, 'app.nav.investments')).toBeTruthy();
  });

  it.each(LOCALES)(
    'has the empty state and portfolio strings in %s (FEAT-004 Block 6)',
    (locale) => {
      const catalog = loadCatalog(locale);

      for (const key of [
        'description',
        'empty.title',
        'empty.description',
        'portfolio.totalsLabel',
        'portfolio.holdingsWithoutPrice',
        'portfolio.holdingsLabel',
        'portfolio.noHoldings',
        'portfolio.addHolding',
        'portfolio.addHoldingFor',
        'portfolio.delete',
        'portfolio.deleteFor',
      ]) {
        expect(readString(catalog, `investments.${key}`), `investments.${key}`).toBeTruthy();
      }
      for (const group of [
        'holding',
        'instrumentTypes',
        'priceSources',
        'notices',
        'forms',
        'errors',
      ]) {
        expect(typeof catalog.investments, 'investments namespace').toBe('object');
        expect(
          flattenKeys((catalog.investments as Catalog)[group] as Catalog, group).length,
          `investments.${group}`,
        ).toBeGreaterThan(0);
      }
    },
  );
});

describe('home catalog (FEAT-004 Block 7)', () => {
  it.each(LOCALES)(
    'has the balance, recent movements, quick actions and empty copy in %s',
    (locale) => {
      const catalog = loadCatalog(locale);

      for (const key of [
        'tagline',
        'balance.title',
        'balance.available',
        'balance.netWorth',
        'balance.currencies.ARS',
        'balance.currencies.USD',
        'recent.title',
        'recent.seeAll',
        'recent.income',
        'recent.expense',
        'recent.unknownAccount',
        'recent.unknownCategory',
        'recent.empty.title',
        'recent.empty.description',
        'recent.empty.action',
        'empty.title',
        'empty.description',
        'empty.action',
      ]) {
        expect(readString(catalog, `home.${key}`), `home.${key}`).toBeTruthy();
      }
    },
  );

  it.each(LOCALES)('reuses the balance wording of the accounts headline in %s', (locale) => {
    const catalog = loadCatalog(locale);

    expect(readString(catalog, 'home.balance.available')).toBe(
      readString(catalog, 'accounts.headline.available'),
    );
    expect(readString(catalog, 'home.balance.netWorth')).toBe(
      readString(catalog, 'accounts.headline.netWorth'),
    );
  });
});

describe('app shell catalog (FEAT-004)', () => {
  it.each(LOCALES)(
    'has every navigation label, the More page copy and the brand in %s',
    (locale) => {
      const catalog = loadCatalog(locale);

      for (const key of [
        'label',
        'home',
        'accounts',
        'movements',
        'investments',
        'more',
        'categories',
        'profile',
        'security',
        'addMovement',
      ]) {
        expect(readString(catalog, `app.nav.${key}`), `app.nav.${key}`).toBeTruthy();
      }
      expect(readString(catalog, 'app.more.title')).toBeTruthy();
      expect(readString(catalog, 'app.more.description')).toBeTruthy();
      expect(readString(catalog, 'app.brand')).toBe('Pesly');
      expect(readString(catalog, 'app.skipToContent')).toBeTruthy();
    },
  );

  it.each(LOCALES)('names the add-movement action apart from the list link in %s', (locale) => {
    const catalog = loadCatalog(locale);

    expect(readString(catalog, 'app.nav.addMovement')).not.toBe(
      readString(catalog, 'movements.list.newMovement'),
    );
  });
});

describe('product name in the web catalogs (FEAT-002)', () => {
  it.each(LOCALES)('titles the app "Pesly" in %s', (locale) => {
    const catalog = loadCatalog(locale);

    expect(readString(catalog, 'metadata.title')).toBe('Pesly');
    expect(readString(catalog, 'home.title')).toBe('Pesly');
  });

  it('installs the PWA as Pesly', () => {
    expect(manifest().name).toBe('Pesly');
    expect(manifest().short_name).toBe('Pesly');
  });

  it.each(LOCALES)('has no string naming Argent, in any case, in %s', (locale) => {
    expect(productNameLeaks(loadCatalog(locale))).toEqual([]);
  });

  it.each([
    ['es', 'pesly-codigos-de-recuperacion.txt'],
    ['en', 'pesly-recovery-codes.txt'],
  ])('names the recovery codes file and header after Pesly in %s', (locale, fileName) => {
    const catalog = loadCatalog(locale);

    expect(readString(catalog, 'security.recoveryCodes.fileName')).toBe(fileName);
    expect(readString(catalog, 'security.recoveryCodes.fileHeader')).toMatch(/\bPesly\b/);
  });

  it('product name error: reports every leak by its dotted key, in any case, and not "Argentina"', () => {
    const catalog: Catalog = {
      metadata: { title: 'Argent' },
      twoFactor: { recoveryCodes: { fileName: 'argent-recovery-codes.txt' } },
      home: { tagline: 'Your finances in Argentina' },
    };

    expect(productNameLeaks(catalog)).toEqual([
      'metadata.title',
      'twoFactor.recoveryCodes.fileName',
    ]);
  });
});

describe('movements catalog (DISC-001-03b)', () => {
  it.each(LOCALES)('has a message for each of the four new error codes in %s', (locale) => {
    const catalog = loadCatalog(locale);

    for (const key of [
      'movementDateInFuture',
      'rateRequired',
      'movementCategoryKindMismatch',
      'categoryArchived',
    ]) {
      expect(readString(catalog, `errors.${key}`)?.length).toBeGreaterThan(0);
    }
  });

  it.each(LOCALES)(
    'has a movement-specific archived-account message that does not reuse the account one in %s',
    (locale) => {
      const catalog = loadCatalog(locale);
      const own = readString(catalog, 'movements.errors.accountArchived');

      expect(own?.length).toBeGreaterThan(0);
      expect(own).not.toBe(readString(catalog, 'errors.accountArchived'));
    },
  );

  it.each(LOCALES)('has the entry screen strings in %s', (locale) => {
    const catalog = loadCatalog(locale);

    for (const key of [
      'movements.new.title',
      'movements.fields.amount',
      'movements.fields.occurredAt',
      'movements.fields.rate',
      'movements.rate.age',
      'movements.errors.amountNotPositive',
      'movements.errors.rateLimited',
      'movements.saved.rate',
    ]) {
      expect(readString(catalog, key)?.length).toBeGreaterThan(0);
    }
  });

  it('maps every error code the API sends to a message that exists in both catalogs', async () => {
    const { ERROR_CODES } = await import('@pesly/shared');
    const { createApiClient } = await import('../src/lib/api-client');
    const keys = new Set<string>();
    for (const code of ERROR_CODES) {
      const client = createApiClient({
        baseUrl: 'http://api.argent.test',
        fetch: () => Promise.resolve(new Response(JSON.stringify({ code }), { status: 400 })),
      });
      const result = await client.listMovements({});
      if (!result.ok) keys.add(result.messageKey);
    }

    for (const locale of LOCALES) {
      const catalog = loadCatalog(locale);
      expect([...keys].filter((key) => readString(catalog, `errors.${key}`) === undefined)).toEqual(
        [],
      );
    }
  });
});

describe('investments manual price warning keys (DISC-001-07b)', () => {
  const KEYS: Record<string, string[]> = {
    'investments.holding.manualPriceDiffersToday': ['price'],
    'investments.holding.manualPriceDiffersOn': ['date', 'price'],
    'investments.holding.useAutomaticPrice': [],
    'investments.holding.useAutomaticPriceFor': ['ticker'],
  };

  function placeholders(text: string): string[] {
    return [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1] ?? '').sort();
  }

  it.each(LOCALES)('has the keys in %s with the expected placeholders', (locale) => {
    const catalog = loadCatalog(locale);
    for (const [key, expected] of Object.entries(KEYS)) {
      const text = readString(catalog, key);
      expect(text, `${locale} ${key}`).toBeTruthy();
      expect(placeholders(text ?? '')).toEqual(expected);
    }
  });
});

describe('transfers and exchanges catalog (DISC-001-03c)', () => {
  it.each(LOCALES)('has a message for each of the four new error codes in %s', (locale) => {
    const catalog = loadCatalog(locale);

    for (const key of [
      'movementSameAccount',
      'movementCurrencyMismatch',
      'exchangeSameCurrency',
      'impliedRateOutOfRange',
    ]) {
      expect(readString(catalog, `errors.${key}`)?.length).toBeGreaterThan(0);
    }
  });

  it.each(LOCALES)('has the transfer and exchange entry screen strings in %s', (locale) => {
    const catalog = loadCatalog(locale);

    for (const key of [
      'movements.types.transfer',
      'movements.types.exchange',
      'movements.fields.destinationAccount',
      'movements.fields.destinationAccountPlaceholder',
      'movements.fields.destinationHintTransfer',
      'movements.fields.destinationHintExchange',
      'movements.fields.amountOut',
      'movements.fields.amountIn',
      'movements.exchange.impliedRate',
      'movements.exchange.impliedRateEmpty',
      'movements.exchange.impliedRateOutOfRange',
      'movements.errors.destinationRequired',
      'movements.errors.typeInvalid',
      'movements.saved.impliedRate',
    ]) {
      expect(readString(catalog, key)?.length).toBeGreaterThan(0);
    }
  });
});

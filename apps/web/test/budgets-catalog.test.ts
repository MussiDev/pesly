import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

type Catalog = { [key: string]: string | Catalog };

const LOCALES = ['es', 'en'] as const;

function loadCatalog(locale: string): Catalog {
  const path = fileURLToPath(new URL(`../messages/${locale}.json`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8')) as Catalog;
}

function readString(catalog: Catalog, dottedKey: string): string | undefined {
  let current: string | Catalog | undefined = catalog;
  for (const part of dottedKey.split('.')) {
    if (current === undefined || typeof current === 'string') return undefined;
    current = current[part];
  }
  return typeof current === 'string' ? current : undefined;
}

function flatten(catalog: Catalog, prefix = ''): [string, string][] {
  return Object.entries(catalog).flatMap(([key, value]): [string, string][] => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === 'string' ? [[path, value]] : flatten(value, path);
  });
}

/** Keys the budget screens read (spec 06f Block 0), with the ICU arguments each one needs. */
const BUDGET_KEYS: Record<string, string[]> = {
  'list.title': [],
  'list.description': [],
  'list.create': [],
  'list.empty.title': [],
  'list.empty.description': [],
  'list.empty.action': [],
  'list.retry': [],
  'list.error': [],
  'list.month.label': [],
  'list.month.previous': [],
  'list.month.next': [],
  'list.month.current': [],
  'card.spentOfAvailable': ['spent', 'available'],
  'card.remaining': ['amount'],
  'card.overBudget': ['amount'],
  'card.percentage': ['percent'],
  'card.rollover': ['amount'],
  'card.thresholds': [],
  'card.marker': ['percent'],
  'card.unconvertedShares': ['count'],
  'detail.title': [],
  'detail.back': [],
  'detail.month': ['month'],
  'detail.categories': [],
  'detail.thresholds': [],
  'detail.edit': [],
  'detail.delete': [],
  'detail.notFound.title': [],
  'detail.notFound.description': [],
  'detail.notFound.back': [],
  'form.createTitle': [],
  'form.editTitle': [],
  'form.name': [],
  'form.amount': [],
  'form.currency': [],
  'form.currencyReadOnly': [],
  'form.categories': [],
  'form.categoriesGroup': ['parent'],
  'form.categoryUnavailable': [],
  'form.rollover': [],
  'form.thresholds.label': [],
  'form.thresholds.hint': ['min', 'max'],
  'form.thresholds.input': [],
  'form.thresholds.add': [],
  'form.thresholds.remove': ['percent'],
  'form.editNote': [],
  'form.errors.nameRequired': [],
  'form.errors.nameTooLong': [],
  'form.errors.amountInvalid': [],
  'form.errors.categoriesRequired': [],
  'form.errors.thresholdsRequired': [],
  'form.errors.thresholdInvalid': [],
  'form.errors.thresholdDuplicate': [],
  'form.errors.thresholdsTooMany': ['max'],
  'form.submit': [],
  'form.cancel': [],
  'form.saving': [],
  'form.categoriesError': [],
  'form.categoriesRetry': [],
  'delete.title': [],
  'delete.description': [],
  'delete.confirm': [],
  'delete.cancel': [],
};

describe('budgets catalog (DISC-001-06f Block 0)', () => {
  it.each(LOCALES)('has every budgets key in %s with its ICU arguments', (locale) => {
    const catalog = loadCatalog(locale);

    for (const [key, args] of Object.entries(BUDGET_KEYS)) {
      const text = readString(catalog, `budgets.${key}`);
      expect(text?.trim().length, `${locale} budgets.${key}`).toBeGreaterThan(0);
      const found = [...(text ?? '').matchAll(/\{(\w+)[,}]/g)].map((m) => m[1] ?? '');
      for (const arg of args) expect(found, `${locale} budgets.${key}`).toContain(arg);
    }
  });

  it.each(LOCALES)('has the budget alert month label in notices (%s)', (locale) => {
    const text = readString(loadCatalog(locale), 'notices.alertMonth');
    expect(text?.trim().length).toBeGreaterThan(0);
    expect(text).toContain('{month}');
  });

  it('has the same keys in es and en across the whole catalog, none empty', () => {
    const es = flatten(loadCatalog('es'));
    const en = flatten(loadCatalog('en'));

    expect(es.map(([k]) => k).sort()).toEqual(en.map(([k]) => k).sort());
    expect([...es, ...en].filter(([, v]) => v.trim() === '')).toEqual([]);
  });

  it('has the same budgets keys in es and en', () => {
    const es = flatten(loadCatalog('es')['budgets'] as Catalog);
    const en = flatten(loadCatalog('en')['budgets'] as Catalog);

    expect(es.map(([k]) => k).sort()).toEqual(en.map(([k]) => k).sort());
  });

  it('bakes no amount or date into a message', () => {
    for (const locale of LOCALES) {
      const baked = flatten(loadCatalog(locale)['budgets'] as Catalog).filter(([, v]) =>
        /\d|\$|US\$/.test(v.replace(/\{[^}]*\}/g, '')),
      );
      expect(baked, locale).toEqual([]);
    }
  });

  it('error: a catalog lacking a key or holding an empty value is detected', () => {
    const broken: Catalog = { budgets: { list: { title: '' } } };

    expect(readString(broken, 'budgets.list.title')?.trim().length).toBe(0);
    expect(readString(broken, 'budgets.list.create')).toBeUndefined();
  });
});

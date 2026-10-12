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

/** Keys the goal screens read (spec 06e Block 2), with the ICU arguments each one needs. */
const GOAL_KEYS: Record<string, string[]> = {
  'list.title': [],
  'list.description': [],
  'list.create': [],
  'list.empty.title': [],
  'list.empty.description': [],
  'list.empty.action': [],
  'list.retry': [],
  'list.error': [],
  'card.progressOfTarget': ['saved', 'target'],
  'card.percentage': ['percent'],
  'card.monthlyNeeded': ['amount'],
  'card.reached': [],
  'card.overdue': [],
  'card.targetDate': ['date'],
  'card.linkedToAccount': ['account'],
  'detail.title': [],
  'detail.back': [],
  'detail.entries.title': [],
  'detail.entries.contribution': [],
  'detail.entries.withdrawal': [],
  'detail.entries.latestNote': ['count'],
  'detail.entries.empty': [],
  'detail.entries.loadMore': [],
  'detail.edit': [],
  'detail.delete': [],
  'detail.linkedNotice': [],
  'detail.notFound.title': [],
  'detail.notFound.description': [],
  'detail.notFound.back': [],
  'form.createTitle': [],
  'form.editTitle': [],
  'form.name': [],
  'form.targetAmount': [],
  'form.currency': [],
  'form.targetDate': [],
  'form.clearTargetDate': [],
  'form.account': [],
  'form.accountNone': [],
  'form.noAccounts': [],
  'form.errors.nameRequired': [],
  'form.errors.nameTooLong': [],
  'form.errors.amountInvalid': [],
  'form.errors.dateInvalid': [],
  'entries.errors.amountInvalid': [],
  'form.submit': [],
  'form.cancel': [],
  'form.saving': [],
  'entries.contributionTitle': [],
  'entries.withdrawalTitle': [],
  'entries.amount': [],
  'entries.submitContribution': [],
  'entries.submitWithdrawal': [],
  'entries.recorded': [],
  'delete.title': [],
  'delete.description': [],
  'delete.confirm': [],
  'delete.cancel': [],
};

describe('goals catalog (DISC-001-06e Block 2)', () => {
  it.each(LOCALES)('has every goals key in %s with its ICU arguments', (locale) => {
    const catalog = loadCatalog(locale);

    for (const [key, args] of Object.entries(GOAL_KEYS)) {
      const text = readString(catalog, `goals.${key}`);
      expect(text?.trim().length, `${locale} goals.${key}`).toBeGreaterThan(0);
      const found = [...(text ?? '').matchAll(/\{(\w+)[,}]/g)].map((m) => m[1] ?? '');
      for (const arg of args) expect(found, `${locale} goals.${key}`).toContain(arg);
    }
  });

  it('has the same goals keys in es and en, none empty', () => {
    const es = flatten(loadCatalog('es')['goals'] as Catalog);
    const en = flatten(loadCatalog('en')['goals'] as Catalog);

    expect(es.map(([k]) => k).sort()).toEqual(en.map(([k]) => k).sort());
    expect([...es, ...en].filter(([, v]) => v.trim() === '')).toEqual([]);
  });

  it('bakes no amount or date into a message', () => {
    for (const locale of LOCALES) {
      const baked = flatten(loadCatalog(locale)['goals'] as Catalog).filter(([, v]) =>
        /\d|\$|US\$/.test(v.replace(/\{[^}]*\}/g, '')),
      );
      expect(baked, locale).toEqual([]);
    }
  });

  it('error: a catalog lacking a key is detected', () => {
    const broken: Catalog = { goals: { list: { title: '' } } };

    expect(readString(broken, 'goals.list.title')?.trim().length).toBe(0);
    expect(readString(broken, 'goals.list.create')).toBeUndefined();
  });
});

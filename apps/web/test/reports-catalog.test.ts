import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

type Catalog = { [key: string]: string | Catalog };

function load(locale: string): Catalog {
  const path = fileURLToPath(new URL(`../messages/${locale}.json`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8')) as Catalog;
}

function flatten(catalog: Catalog, prefix = ''): Record<string, string> {
  return Object.entries(catalog).reduce<Record<string, string>>((all, [key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === 'string'
      ? { ...all, [path]: value }
      : { ...all, ...flatten(value, path) };
  }, {});
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

/** Argument names of an ICU message; the text of plural and select branches is read as a message. */
function placeholders(text: string, found = new Set<string>()): string[] {
  let index = text.indexOf('{');
  while (index !== -1) {
    const end = closingBrace(text, index);
    const [name = '', type = '', ...rest] = text.slice(index + 1, end).split(',');
    found.add(name.trim());
    if (['plural', 'select'].includes(type.trim())) {
      const branches = rest.join(',');
      let branch = branches.indexOf('{');
      while (branch !== -1) {
        const branchEnd = closingBrace(branches, branch);
        placeholders(branches.slice(branch + 1, branchEnd), found);
        branch = branches.indexOf('{', branchEnd + 1);
      }
    }
    index = text.indexOf('{', end + 1);
  }
  return [...found].sort();
}

const PRESETS = ['thisMonth', 'last3', 'last12', 'last24'];

const REQUIRED = [
  'app.nav.reports',
  'dashboard.categories.viewReport',
  'dashboard.netWorth.viewReport',
  'reports.title',
  'reports.tabs.label',
  'reports.tabs.categories',
  'reports.tabs.incomeExpenses',
  'reports.tabs.netWorth',
  'reports.range.label',
  'reports.range.from',
  'reports.range.to',
  'reports.range.apply',
  'reports.range.custom',
  ...PRESETS.map((preset) => `reports.range.presets.${preset}`),
  'reports.range.resolved',
  'reports.range.limit',
  'reports.range.errors.fromAfterTo',
  'reports.range.errors.tooLong',
  'reports.range.errors.toInFuture',
  'reports.filters.toggle',
  'reports.filters.account',
  'reports.filters.allAccounts',
  'reports.filters.archivedAccount',
  'reports.filters.unknownAccount',
  'reports.filters.tag',
  'reports.filters.clear',
  'reports.currency.note',
  'reports.currency.changeLink',
  'reports.notices.unconverted',
  'reports.notices.filtered',
  'reports.states.loading',
  'reports.states.emptyTitle',
  'reports.states.emptyDescription',
  'reports.states.widen',
  'reports.states.record',
  'reports.states.errorTitle',
  'reports.states.errorDescription',
  'reports.states.retry',
  'reports.states.retrying',
  'reports.states.offlineTitle',
  'reports.states.offlineDescription',
  'reports.states.offlineRetry',
  'reports.states.filterGoneMessage',
  'reports.states.filterGoneReload',
  'reports.states.badRangeMessage',
  'reports.categories.title',
  'reports.categories.total',
  'reports.categories.other',
  'reports.categories.groupShares',
  'reports.categories.unnamed',
  'reports.categories.percent',
  'reports.categories.underOne',
  'reports.categories.chartName',
  'reports.categories.chartSummary',
  'reports.categories.listName',
  'reports.incomeExpenses.title',
  'reports.incomeExpenses.income',
  'reports.incomeExpenses.expenses',
  'reports.incomeExpenses.net',
  'reports.incomeExpenses.chartName',
  'reports.incomeExpenses.chartSummary',
  'reports.incomeExpenses.listName',
  'reports.netWorth.title',
  'reports.netWorth.date',
  'reports.netWorth.ars',
  'reports.netWorth.usd',
  'reports.netWorth.total',
  'reports.netWorth.noRate',
  'reports.netWorth.investmentsIncomplete',
  'reports.netWorth.conversionUnavailable',
  'reports.netWorth.tooltip',
  'reports.netWorth.chartName',
  'reports.netWorth.chartSummary',
  'reports.netWorth.listName',
  'reports.netWorth.selectedPoint',
  'reports.netWorth.announce',
];

/** Required keys missing from a flattened catalog, or present with an empty value. */
function problems(flat: Record<string, string>): string[] {
  return REQUIRED.flatMap((key) => {
    const value = flat[key];
    if (value === undefined) return [`${key} is missing`];
    return value.trim() === '' ? [`${key} is empty`] : [];
  });
}

describe('reports catalog (NFR-06)', () => {
  it.each(['es', 'en'])('has every reports key in %s, none empty', (locale) => {
    expect(problems(flatten(load(locale)))).toEqual([]);
  });

  it('has the same reports keys in both languages', () => {
    const only = (locale: string) =>
      Object.keys(flatten(load(locale)))
        .filter((key) => key.startsWith('reports.'))
        .sort();
    expect(only('es')).toEqual(only('en'));
  });

  it('has the same placeholders in both languages for every reports key', () => {
    const en = flatten(load('en'));
    const es = flatten(load('es'));
    const mismatched = REQUIRED.filter(
      (key) => placeholders(en[key] ?? '').join() !== placeholders(es[key] ?? '').join(),
    );
    expect(mismatched).toEqual([]);
  });

  it('keeps the placeholders the screens fill in', () => {
    const en = flatten(load('en'));
    expect(placeholders(en['reports.currency.note'] ?? '')).toContain('currency');
    expect(placeholders(en['reports.notices.unconverted'] ?? '')).toEqual([
      'installments',
      'shares',
    ]);
    expect(placeholders(en['reports.range.limit'] ?? '')).toContain('months');
    expect(placeholders(en['reports.states.emptyDescription'] ?? '')).toEqual(['from', 'to']);
  });

  it('names the tabs as the PRD does (AC-01)', () => {
    const en = flatten(load('en'));
    const es = flatten(load('es'));
    expect([
      en['reports.tabs.categories'],
      en['reports.tabs.incomeExpenses'],
      en['reports.tabs.netWorth'],
    ]).toEqual(['Expenses by category', 'Income vs expenses', 'Net worth']);
    expect([
      es['reports.tabs.categories'],
      es['reports.tabs.incomeExpenses'],
      es['reports.tabs.netWorth'],
    ]).toEqual(['Gastos por categoría', 'Ingresos vs gastos', 'Patrimonio neto']);
  });

  it('writes the Spanish reports strings in voseo, like the rest of the catalog (L6)', () => {
    const tuteo = new Set(['revisa', 'inténtalo', 'vuelve', 'cámbiala', 'intenta', 'cambia']);
    const offenders = Object.entries(flatten(load('es')))
      .filter(([key]) => key.startsWith('reports.'))
      .filter(([, value]) =>
        value
          .toLowerCase()
          .split(/[^a-záéíóúñ]+/)
          .some((word) => tuteo.has(word)),
      )
      .map(([key]) => key);
    expect(offenders).toEqual([]);
  });

  it('error: a catalog with a missing key or an empty value fails the check', () => {
    const flat = flatten(load('en'));
    const without = { ...flat };
    delete without['reports.title'];
    expect(problems(without)).toEqual(['reports.title is missing']);
    expect(problems({ ...flat, 'reports.states.retry': ' ' })).toEqual([
      'reports.states.retry is empty',
    ]);
  });
});

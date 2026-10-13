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

const REQUIRED = [
  'dashboard.title',
  'dashboard.netWorth.label',
  'dashboard.available.label',
  'dashboard.netWorth.ars',
  'dashboard.netWorth.usd',
  'dashboard.netWorth.conversionUnavailable',
  'dashboard.netWorth.holdingsWithoutPrice',
  'dashboard.netWorth.lastPointNote',
  'dashboard.month.title',
  'dashboard.month.expenses',
  'dashboard.month.income',
  'dashboard.month.net',
  'dashboard.month.comparison',
  'dashboard.month.leftOut',
  'dashboard.month.leftOutReason',
  'dashboard.delta.favorable',
  'dashboard.delta.unfavorable',
  'dashboard.delta.noChange',
  'dashboard.delta.noComparison',
  'dashboard.chart.name',
  'dashboard.chart.tooltip',
  'dashboard.chart.pointsCaption',
  'dashboard.chart.dateHeading',
  'dashboard.chart.valueHeading',
  'dashboard.chart.arsHeading',
  'dashboard.chart.usdHeading',
  'dashboard.chart.singlePoint',
  'dashboard.chart.noConvertedPoint',
  'dashboard.chart.failed',
  'dashboard.chart.retry',
  'dashboard.categories.title',
  'dashboard.categories.empty',
  'dashboard.categories.other',
  'dashboard.budgets.title',
  'dashboard.budgets.onTrack',
  'dashboard.budgets.close',
  'dashboard.budgets.over',
  'dashboard.budgets.create',
  'dashboard.budgets.used',
  'dashboard.upcoming.title',
  'dashboard.upcoming.empty',
  'dashboard.upcoming.payment',
  'dashboard.upcoming.statement',
  'dashboard.groups.title',
  'dashboard.groups.owedToYou',
  'dashboard.groups.youOwe',
  'dashboard.attention.title',
  'dashboard.attention.overdue',
  'dashboard.attention.pendingOccurrence',
  'dashboard.attention.overdueOccurrence',
  'dashboard.attention.statementDue',
  'dashboard.attention.unknown',
  'dashboard.attention.failedMovements',
  'dashboard.attention.failedGroupChanges',
  'dashboard.attention.groupConflicts',
  'dashboard.insight.above',
  'dashboard.insight.below',
  'dashboard.insight.inLine',
  'dashboard.insight.shareOnly',
  'dashboard.firstSteps.title',
  'dashboard.firstSteps.createAccount',
  'dashboard.firstSteps.recordMovement',
  'dashboard.firstSteps.done',
  'dashboard.states.loading',
  'dashboard.states.error',
  'dashboard.states.offline',
  'dashboard.states.outOfDate',
  'dashboard.states.retry',
  'theme.system',
];

/** Required keys missing from a flattened catalog, or present with an empty value. */
function problems(flat: Record<string, string>): string[] {
  return REQUIRED.flatMap((key) => {
    const value = flat[key];
    if (value === undefined) return [`${key} is missing`];
    return value.trim() === '' ? [`${key} is empty`] : [];
  });
}

describe('dashboard catalog (AC-47)', () => {
  it.each(['es', 'en'])('has every dashboard key in %s, none empty', (locale) => {
    expect(problems(flatten(load(locale)))).toEqual([]);
  });

  it('has the same dashboard keys in both languages', () => {
    const only = (locale: string) =>
      Object.keys(flatten(load(locale)))
        .filter((key) => key.startsWith('dashboard.') || key === 'theme.system')
        .sort();
    expect(only('es')).toEqual(only('en'));
  });

  it('error: a catalog with a missing key or an empty value fails the check', () => {
    const flat = flatten(load('en'));
    const withoutTitle = { ...flat };
    delete withoutTitle['dashboard.title'];
    expect(problems(withoutTitle)).toEqual(['dashboard.title is missing']);
    expect(problems({ ...flat, 'dashboard.states.retry': ' ' })).toEqual([
      'dashboard.states.retry is empty',
    ]);
  });
});

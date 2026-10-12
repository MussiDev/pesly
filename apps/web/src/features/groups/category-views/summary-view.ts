import type { CategoryLanguage, GroupExpenseSummaryResponse } from '@pesly/shared';
import { shareOf } from './format';
import { NEUTRAL_COLOR, NEUTRAL_ICON, resolveCategory } from './resolve-category';
import type { FilteredTotal, SummaryCurrencyView, SummaryLine, SummaryView } from './types';

const UNCATEGORIZED_KEY = 'uncategorized';
const COLLATION_LOCALE: Record<CategoryLanguage, string> = { en: 'en-US', es: 'es-AR' };

/**
 * The summary answer as view lines per currency. Lines are ordered by total desc, then by name in
 * the active language; every line whose id is not in `response.categories` merges into one
 * "No category" line carrying its ids (D7).
 */
export function buildSummaryView(
  response: GroupExpenseSummaryResponse,
  language: CategoryLanguage,
  uncategorizedLabel = '',
): SummaryView {
  const collator = new Intl.Collator(COLLATION_LOCALE[language], { sensitivity: 'base' });
  const known = new Set(response.categories.map((category) => category.id));

  const currencies = response.currencies.map((entry): SummaryCurrencyView => {
    const currencyTotal = BigInt(entry.total);
    const lines: SummaryLine[] = [];
    let merged: SummaryLine | undefined;
    for (const line of entry.categories) {
      const total = BigInt(line.total);
      if (known.has(line.categoryId)) {
        lines.push({
          key: line.categoryId,
          categoryIds: [line.categoryId],
          display: resolveCategory(line.categoryId, response.categories, language),
          total,
          count: line.count,
          shareBasisPoints: shareOf(total, currencyTotal),
        });
      } else if (merged === undefined) {
        merged = {
          key: UNCATEGORIZED_KEY,
          categoryIds: [line.categoryId],
          display: {
            id: UNCATEGORIZED_KEY,
            label: uncategorizedLabel,
            icon: NEUTRAL_ICON,
            color: NEUTRAL_COLOR,
            archived: false,
            known: false,
          },
          total,
          count: line.count,
          shareBasisPoints: 0,
        };
      } else {
        merged.categoryIds.push(line.categoryId);
        merged.total += total;
        merged.count += line.count;
      }
    }
    if (merged !== undefined) {
      merged.shareBasisPoints = shareOf(merged.total, currencyTotal);
      lines.push(merged);
    }
    lines.sort((a, b) => {
      if (a.total !== b.total) return a.total > b.total ? -1 : 1;
      const byName = collator.compare(a.display.label, b.display.label);
      if (byName !== 0) return byName;
      return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
    });
    return { currency: entry.currency, total: currencyTotal, count: entry.count, lines };
  });

  return { currencies };
}

/**
 * Per currency, the sum and count of the lines that hold any of the selected ids (D10). A currency
 * with no selected line is left out.
 */
export function filteredTotals(view: SummaryView, categoryIds: readonly string[]): FilteredTotal[] {
  const selected = new Set(categoryIds);
  const result: FilteredTotal[] = [];
  for (const entry of view.currencies) {
    let total = 0n;
    let count = 0;
    let matched = false;
    for (const line of entry.lines) {
      if (!line.categoryIds.some((id) => selected.has(id))) continue;
      matched = true;
      total += line.total;
      count += line.count;
    }
    if (matched) result.push({ currency: entry.currency, total, count });
  }
  return result;
}

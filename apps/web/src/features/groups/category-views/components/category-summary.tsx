import { useLocale, useTranslations } from 'next-intl';
import { formatMoney } from '@/lib/format-amount';
import { formatShare } from '../format';
import type { SummaryLine, SummaryView } from '../types';
import { CategoryChip } from './category-chip';

function SummaryBar({ basisPoints }: { basisPoints: number }) {
  return (
    <div
      data-slot="summary-bar"
      aria-hidden="true"
      className="h-2 w-full overflow-hidden rounded-pill bg-muted"
    >
      <div className="h-full bg-primary" style={{ width: `${basisPoints / 100}%` }} />
    </div>
  );
}

/** Per currency: the total on its own line, then one line per category with amount, share and bar. */
export function CategorySummary({
  view,
  onSelect,
  selectedCategoryIds,
}: {
  view: SummaryView;
  /** When given, each line is a button that reports the category ids it stands for. */
  onSelect?: (categoryIds: string[]) => void;
  /** The categories the list is filtered by; a line is pressed when it stands for one of them. */
  selectedCategoryIds?: readonly string[];
}) {
  const t = useTranslations('groups.categoryViews.summary');
  const language = useLocale() === 'en' ? 'en' : 'es';
  const selected = new Set(selectedCategoryIds);

  const body = (line: SummaryLine, currency: 'ARS' | 'USD') => (
    <>
      <span className="flex items-start justify-between gap-3">
        <CategoryChip display={line.display} size="sm" />
        <span className="shrink-0 text-end">
          <span className="block font-medium">{formatMoney(line.total, currency, language)}</span>
          <span className="block text-caption text-muted-foreground">
            {formatShare(line.shareBasisPoints, language)}
            {' · '}
            {t('expenses', { count: line.count })}
          </span>
        </span>
      </span>
      <SummaryBar basisPoints={line.shareBasisPoints} />
    </>
  );

  return (
    <div className="grid gap-6">
      {view.currencies.map((entry) => (
        <section key={entry.currency} className="grid gap-3">
          <h3 className="text-small font-medium text-muted-foreground">{entry.currency}</h3>
          <p className="grid gap-0.5">
            <span className="text-caption text-muted-foreground">{t('total')}</span>
            <span className="text-heading font-semibold">
              {formatMoney(entry.total, entry.currency, language)}
            </span>
          </p>
          <ul className="grid gap-3">
            {entry.lines.map((line) => (
              <li key={line.key}>
                {onSelect === undefined ? (
                  <div className="grid gap-2">{body(line, entry.currency)}</div>
                ) : (
                  <button
                    type="button"
                    aria-pressed={line.categoryIds.some((id) => selected.has(id))}
                    className="grid min-h-11 w-full gap-2 rounded-xl text-start outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => {
                      onSelect(line.categoryIds);
                    }}
                  >
                    {body(line, entry.currency)}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

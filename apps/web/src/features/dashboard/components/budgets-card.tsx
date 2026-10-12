'use client';

import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import type { BudgetStatus, BudgetView } from '../dashboard-view';
import { formatWholePercent } from '../format';

const MAX_BUDGETS = 3;

const PILL: Record<BudgetStatus, { variant: 'success' | 'warning' | 'destructive'; key: string }> =
  {
    on_track: { variant: 'success', key: 'onTrack' },
    close: { variant: 'warning', key: 'close' },
    over: { variant: 'destructive', key: 'over' },
  };

interface BudgetsCardProps {
  locale: Locale;
  budgets: BudgetView[];
}

/** Up to 3 budgets in the order received; the status is a word, never only a color. */
export function BudgetsCard({ locale, budgets }: BudgetsCardProps) {
  const t = useTranslations('dashboard.budgets');
  const shown = budgets.slice(0, MAX_BUDGETS);
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle as="h2">{t('title')}</CardTitle>
      </CardHeader>
      <CardContent className="min-w-0">
        {shown.length === 0 ? (
          <Link
            href="/budgets/new"
            className={buttonVariants({ variant: 'outline', size: 'sm' }) + ' min-h-11'}
          >
            {t('create')}
          </Link>
        ) : (
          <ul aria-label={t('title')} className="grid gap-3">
            {shown.map((budget) => {
              const pill = PILL[budget.status];
              return (
                <li key={budget.id} className="min-w-0">
                  <Link
                    href={budget.href}
                    className="grid min-h-11 min-w-0 gap-1.5 focus-visible:outline-2"
                  >
                    <span className="flex min-w-0 items-center justify-between gap-3">
                      <span className="min-w-0 break-words text-body">
                        {budget.name}{' '}
                        <span className="text-caption text-muted-foreground">
                          {budget.currency}
                        </span>
                      </span>
                      <Badge variant={pill.variant} className="shrink-0">
                        {t(pill.key)}
                      </Badge>
                    </span>
                    <span className="text-small text-muted-foreground">
                      {t('used', { percent: formatWholePercent(budget.percent, locale) })}
                    </span>
                    <span
                      aria-hidden="true"
                      className="h-1.5 w-full overflow-hidden rounded-pill bg-muted"
                    >
                      <span
                        data-slot="share-bar"
                        className="block h-full rounded-pill bg-primary"
                        style={{ width: `${Math.min(100, Math.max(0, budget.percent))}%` }}
                      />
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

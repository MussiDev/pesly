'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { Locale } from '@/i18n/routing';
import { formatMoney } from '@/lib/format-amount';
import type { CategoryView, Currency } from '../dashboard-view';
import { formatWholePercent } from '../format';

interface CategoriesCardProps {
  locale: Locale;
  currency: Currency;
  categories: CategoryView[];
}

/** Spending by category, rows as returned; the share is always printed, the bar only draws it. */
export function CategoriesCard({ locale, currency, categories }: CategoriesCardProps) {
  const t = useTranslations('dashboard.categories');
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle as="h2">{t('title')}</CardTitle>
      </CardHeader>
      <CardContent className="min-w-0">
        {categories.length === 0 ? (
          <p className="text-small text-muted-foreground">{t('empty')}</p>
        ) : (
          <ul aria-label={t('title')} className="grid gap-3">
            {categories.map((category) => (
              <li key={category.key} className="grid min-w-0 gap-1.5">
                <div className="flex min-w-0 items-baseline justify-between gap-3">
                  <span className="min-w-0 break-words text-body">
                    {category.label === '' ? t('other') : category.label}
                  </span>
                  <span className="shrink-0 text-small text-muted-foreground">
                    {formatMoney(category.amount, currency, locale)}
                    {' · '}
                    {formatWholePercent(category.share, locale)}
                  </span>
                </div>
                <div
                  aria-hidden="true"
                  className="h-1.5 w-full overflow-hidden rounded-pill bg-muted"
                >
                  <div
                    data-slot="share-bar"
                    className="h-full rounded-pill bg-primary"
                    style={{ width: `${Math.min(100, Math.max(0, category.share))}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
        <Link
          href="/reports/categories"
          className="mt-4 inline-flex min-h-11 items-center text-small font-medium text-primary underline-offset-4 hover:underline"
        >
          {t('viewReport')}
        </Link>
      </CardContent>
    </Card>
  );
}

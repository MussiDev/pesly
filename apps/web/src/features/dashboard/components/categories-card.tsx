'use client';

import { useTranslations } from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CategoryPie } from '@/components/ui/category-pie';
import { Link, useRouter } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { formatMoney } from '@/lib/format-amount';
import type { CategoryView, Currency } from '../dashboard-view';
import { formatWholePercent } from '../format';

interface CategoriesCardProps {
  locale: Locale;
  currency: Currency;
  categories: CategoryView[];
  /** The month's spending, shown in the hole of the ring. */
  total?: bigint | undefined;
}

/**
 * Spending by category as a ring. A tap on an arc or a row opens that category's expenses of the
 * month; the legend always prints the amount and share, so the ring only illustrates them.
 */
export function CategoriesCard({ locale, currency, categories, total }: CategoriesCardProps) {
  const t = useTranslations('dashboard.categories');
  const router = useRouter();
  const segments = categories.map((category) => {
    const label = category.label === '' ? t('other') : category.label;
    return {
      key: category.key,
      label,
      amounts: [formatMoney(category.amount, currency, locale)],
      // The share is a whole percent; the ring wants basis points.
      basisPoints: Math.max(0, Math.round(category.share)) * 100,
      color: category.color,
      href: category.href,
      actionLabel: category.href === undefined ? undefined : t('open', { name: label }),
      selectable: category.href !== undefined,
    };
  });

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle as="h2">{t('title')}</CardTitle>
      </CardHeader>
      <CardContent className="min-w-0">
        {categories.length === 0 ? (
          <p className="text-small text-muted-foreground">{t('empty')}</p>
        ) : (
          <CategoryPie
            label={t('title')}
            segments={segments}
            formatPercent={(basisPoints) => formatWholePercent(basisPoints / 100, locale)}
            onSelect={(key) => {
              const href = segments.find((segment) => segment.key === key)?.href;
              if (href !== undefined) router.push(href);
            }}
            centre={
              total === undefined ? undefined : (
                <>
                  <span className="text-caption text-muted-foreground">{t('total')}</span>
                  <span className="text-caption font-bold tabular-nums">
                    {formatMoney(total, currency, locale)}
                  </span>
                </>
              )
            }
          />
        )}
        <Link
          href="/reports/categories"
          className="mt-2 inline-flex min-h-11 items-center text-small font-medium text-primary underline-offset-4 hover:underline"
        >
          {t('viewReport')}
        </Link>
      </CardContent>
    </Card>
  );
}

'use client';

import { Lightbulb } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Card } from '@/components/ui/card';
import type { Locale } from '@/i18n/routing';
import type { InsightView } from '../dashboard-view';
import { formatWholePercent } from '../format';

/** One sentence about the biggest spending category (FR-14). */
export function InsightCard({ locale, insight }: { locale: Locale; insight: InsightView | null }) {
  const t = useTranslations('dashboard.insight');
  if (insight === null) return null;

  const values = { category: insight.label, share: formatWholePercent(insight.share, locale) };
  let sentence: string;
  if (insight.change === null) sentence = t('shareOnly', values);
  else if (insight.change === 0) sentence = t('inLine', values);
  else {
    sentence = t(insight.change > 0 ? 'above' : 'below', {
      ...values,
      change: formatWholePercent(Math.abs(insight.change), locale),
    });
  }

  return (
    <Card className="min-w-0 flex-row items-start gap-3 px-5">
      <Lightbulb aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-primary" />
      <p className="text-body">{sentence}</p>
    </Card>
  );
}

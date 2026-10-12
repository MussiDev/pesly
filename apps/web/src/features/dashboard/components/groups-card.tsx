'use client';

import { useTranslations } from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { Locale } from '@/i18n/routing';
import { formatMoney } from '@/lib/format-amount';
import type { Currency, GroupsView } from '../dashboard-view';

const CURRENCIES: Currency[] = ['ARS', 'USD'];

interface GroupsCardProps {
  locale: Locale;
  groups: GroupsView;
}

/** Owed and owing per currency, each cell as returned: never summed or netted. */
export function GroupsCard({ locale, groups }: GroupsCardProps) {
  const t = useTranslations('dashboard.groups');
  const sections = [
    { label: t('owedToYou'), amounts: groups.owedToYou },
    { label: t('youOwe'), amounts: groups.youOwe },
  ];
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle as="h2">{t('title')}</CardTitle>
      </CardHeader>
      <CardContent className="grid min-w-0 gap-4">
        {sections.map((section) => (
          <div key={section.label} role="group" aria-label={section.label} className="grid gap-1">
            <span className="text-small text-muted-foreground">{section.label}</span>
            <ul className="grid min-w-0 gap-1">
              {CURRENCIES.map((currency) => (
                <li key={currency} className="min-w-0 break-words text-body">
                  {formatMoney(section.amounts[currency], currency, locale)}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

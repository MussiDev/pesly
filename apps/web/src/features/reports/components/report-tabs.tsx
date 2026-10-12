'use client';

import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import type { ReportKind } from '../report-view';

const TABS: readonly { kind: ReportKind; href: string }[] = [
  { kind: 'categories', href: '/reports/categories' },
  { kind: 'incomeExpenses', href: '/reports/income-expenses' },
  { kind: 'netWorth', href: '/reports/net-worth' },
];

export interface ReportTabsProps {
  /** The path of the page being shown, without the locale. */
  current: string;
}

/** The three report links; the one of the current path carries `aria-current="page"`. */
export function ReportTabs({ current }: ReportTabsProps) {
  const t = useTranslations('reports.tabs');
  return (
    <nav aria-label={t('label')} className="flex gap-2 overflow-x-auto">
      {TABS.map((tab) => {
        const active = current === tab.href;
        return (
          <Link
            key={tab.kind}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'inline-flex min-h-11 shrink-0 items-center rounded-pill px-4 text-small font-semibold whitespace-nowrap transition-colors outline-none motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-ring',
              active
                ? 'bg-primary text-primary-foreground'
                : 'bg-card text-foreground hover:bg-surface',
            )}
          >
            {t(tab.kind)}
          </Link>
        );
      })}
    </nav>
  );
}

/** The tab bar the layout mounts: it follows the current path for the presentational tabs. */
export function ReportTabsBar() {
  return <ReportTabs current={usePathname()} />;
}

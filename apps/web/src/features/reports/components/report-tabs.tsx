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

/**
 * The three report links as one segmented control, as NorteAR's period switch: they share the
 * width, so none is cut off. The one of the current path carries `aria-current="page"`.
 */
export function ReportTabs({ current }: ReportTabsProps) {
  const t = useTranslations('reports.tabs');
  return (
    <nav aria-label={t('label')} className="flex flex-wrap gap-0.5 rounded-3xl bg-secondary p-0.5">
      {TABS.map((tab) => {
        const active = current === tab.href;
        return (
          <Link
            key={tab.kind}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'inline-flex min-h-11 flex-auto items-center justify-center rounded-pill px-2 text-center text-small font-semibold text-balance transition-colors outline-none motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-ring',
              active
                ? 'bg-card text-foreground shadow-xs'
                : 'text-muted-foreground hover:text-foreground',
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

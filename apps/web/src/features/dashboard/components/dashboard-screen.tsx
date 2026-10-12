import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { QuickActions } from '@/features/home/components/quick-actions';
import type { Locale } from '@/i18n/routing';
import type { AttentionItem } from '../attention/attention-items';
import type { DashboardView } from '../dashboard-view';
import { BudgetsCard } from './budgets-card';
import { CategoriesCard } from './categories-card';
import { DoTheseFirst } from './do-these-first';
import { FirstSteps } from './first-steps';
import { GroupsCard } from './groups-card';
import { InsightCard } from './insight-card';
import { KpiCards } from './kpi-cards';
import { NetWorthCard, type SeriesState } from './net-worth-card';
import { UpcomingCard } from './upcoming-card';

export type SlotName =
  | 'firstSteps'
  | 'netWorth'
  | 'kpis'
  | 'quickActions'
  | 'categories'
  | 'attention'
  | 'budgets'
  | 'upcoming'
  | 'groups'
  | 'insight';

/** Each slot reserves the height of its card, so the skeleton and the loaded cards do not move. */
export const SLOT_CLASS: Record<SlotName, string> = {
  firstSteps: 'grid min-w-0 min-h-40',
  netWorth: 'grid min-w-0 min-h-80',
  kpis: 'grid min-w-0 min-h-32',
  quickActions: 'grid min-w-0 min-h-24',
  categories: 'grid min-w-0 min-h-56',
  attention: 'grid min-w-0 min-h-40',
  budgets: 'grid min-w-0 min-h-40',
  upcoming: 'grid min-w-0 min-h-40',
  groups: 'grid min-w-0 min-h-32',
  insight: 'grid min-w-0 min-h-20',
};

const MAIN_SLOTS: SlotName[] = ['firstSteps', 'netWorth', 'kpis', 'quickActions', 'categories'];
const SIDE_SLOTS: SlotName[] = ['attention', 'budgets', 'upcoming', 'groups', 'insight'];

/** The header and spacing every dashboard state shares, so no state moves the page around. */
export function DashboardFrame({ children }: { children: ReactNode }) {
  const t = useTranslations('dashboard');
  const tApp = useTranslations('app');

  return (
    <div className="grid min-w-0 gap-6">
      {/* The top navigation carries the brand from `desk`; below it the page does. */}
      <p className="flex items-center gap-2.5 text-heading desk:hidden">
        <span
          aria-hidden
          className="inline-flex size-9 items-center justify-center rounded-xl bg-primary text-small font-semibold text-primary-foreground"
        >
          {tApp('brand').charAt(0)}
        </span>
        {tApp('brand')}
      </p>
      <h1 className="sr-only">{t('title')}</h1>
      {children}
    </div>
  );
}

/**
 * One stack below `desk`, two columns from it. A slot that is absent from `slots` is not rendered;
 * the loaded screen and the skeleton fill the same slots, so both share this one layout.
 */
export function DashboardLayout({ slots }: { slots: Partial<Record<SlotName, ReactNode>> }) {
  const column = (names: SlotName[]) =>
    names.flatMap((name) => {
      const node = slots[name];
      return node === undefined || node === null
        ? []
        : [
            <div key={name} data-dashboard-slot={name} className={SLOT_CLASS[name]}>
              {node}
            </div>,
          ];
    });

  return (
    <div className="grid min-w-0 items-start gap-6 desk:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
      <div className="grid min-w-0 gap-6">{column(MAIN_SLOTS)}</div>
      <div className="grid min-w-0 gap-6">{column(SIDE_SLOTS)}</div>
    </div>
  );
}

export interface DashboardScreenProps {
  locale: Locale;
  view: DashboardView;
  series: SeriesState;
  attention: AttentionItem[];
}

export function DashboardScreen({ locale, view, series, attention }: DashboardScreenProps) {
  const showGuide = view.firstSteps.show;
  const slots: Partial<Record<SlotName, ReactNode>> = showGuide
    ? {
        firstSteps: <FirstSteps firstSteps={view.firstSteps} />,
        quickActions: <QuickActions />,
        attention: attention.length > 0 ? <DoTheseFirst locale={locale} items={attention} /> : null,
      }
    : {
        netWorth: (
          <NetWorthCard
            locale={locale}
            currency={view.currency}
            netWorth={view.netWorth}
            series={series}
          />
        ),
        kpis: <KpiCards locale={locale} currency={view.currency} month={view.month} />,
        quickActions: <QuickActions />,
        categories: (
          <CategoriesCard locale={locale} currency={view.currency} categories={view.categories} />
        ),
        attention: attention.length > 0 ? <DoTheseFirst locale={locale} items={attention} /> : null,
        budgets: <BudgetsCard locale={locale} budgets={view.budgets} />,
        upcoming: <UpcomingCard locale={locale} upcoming={view.upcoming} />,
        groups: <GroupsCard locale={locale} groups={view.groups} />,
        insight:
          view.insight === null ? null : <InsightCard locale={locale} insight={view.insight} />,
      };

  return (
    <DashboardFrame>
      <DashboardLayout slots={slots} />
    </DashboardFrame>
  );
}

import { useTranslations } from 'next-intl';
import { buttonVariants } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';
import { ExpenseRow } from '../expenses/list/expense-row';
import type { ExpenseListItem } from '../expenses/list/group-expenses-list';
import { GroupSectionState, type SectionStatus } from './group-section-state';

interface GroupRecentExpensesProps {
  groupId: string;
  status: SectionStatus;
  items: readonly ExpenseListItem[];
  onRetry: () => void;
}

/** The newest expenses of the group, read-only, on the group detail; pure, the container loads them. */
export function GroupRecentExpenses({ groupId, status, items, onRetry }: GroupRecentExpensesProps) {
  const t = useTranslations('groups.detail');
  const expensesHref = `/groups/${encodeURIComponent(groupId)}/expenses`;

  return (
    <section aria-labelledby="group-recent-expenses" className="grid gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="group-recent-expenses" className="text-heading">
          {t('recentTitle')}
        </h2>
        {status === 'ready' && items.length > 0 ? (
          <Link href={expensesHref} className={buttonVariants({ variant: 'link', size: 'sm' })}>
            {t('seeAll')}
          </Link>
        ) : null}
      </div>
      <GroupSectionState status={status} onRetry={onRetry}>
        {items.length === 0 ? (
          <div className="grid gap-3">
            <p className="text-small text-muted-foreground">{t('recentEmpty')}</p>
            <Link href={expensesHref} className={buttonVariants({ variant: 'outline' })}>
              {t('recentEmptyLink')}
            </Link>
          </div>
        ) : (
          <ul className="divide-y divide-border/70 rounded-card bg-card px-4">
            {items.map(({ id, ...row }) => (
              <li key={id}>
                <ExpenseRow {...row} />
              </li>
            ))}
          </ul>
        )}
      </GroupSectionState>
    </section>
  );
}

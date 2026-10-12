'use client';

import { useTranslations } from 'next-intl';
import { buttonVariants } from '@/components/ui/button';
import { ListRow } from '@/components/ui/list-row';
import { Link } from '@/i18n/navigation';
import { DeleteConfirm } from '../../edit/components/delete-confirm';
import { FailedChangePanel } from '../../edit/components/failed-change-panel';
import { RowActions } from '../../edit/components/row-actions';
import { SyncMarker } from '../../edit/components/sync-marker';
import { CategoryChip } from '../../category-views/components/category-chip';
import type { CategoryDisplay } from '../../category-views/types';
import type { SyncState } from '../../sync-overlay';

/** What a row needs to show its sync state and the actions the caller may take on it. */
export interface ExpenseRowEdit {
  state: SyncState;
  /** The rejection code, only when the change failed. */
  failureCode: string | undefined;
  /** The caller is the creator or an admin (D3). */
  allowed: boolean;
  /** The edit screen, which is also where a conflict is resolved. */
  editHref: string;
  confirmingDelete: boolean;
  onDelete: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
  onRetry: () => void;
  onDiscard: () => void;
}

export interface ExpenseRowProps {
  description: string;
  category: CategoryDisplay;
  payer: string;
  /** Already formatted with its currency. */
  amount: string;
  date: string;
  /** The viewer's own share, formatted; absent when the viewer holds none or is unknown. */
  share: string | undefined;
  /** Absent while the device queue is unavailable: the row then has no marker and no actions. */
  edit?: ExpenseRowEdit;
}

/** One expense of the group. */
export function ExpenseRow({
  description,
  category,
  payer,
  amount,
  date,
  share,
  edit,
}: ExpenseRowProps) {
  const t = useTranslations('groups.expenses');
  const tCommon = useTranslations('groups.edit.common.actions');
  return (
    <>
      <ListRow
        title={description}
        description={
          <span className="grid gap-0.5">
            <CategoryChip display={category} size="sm" />
            <span>{t('paidBy', { name: payer })}</span>
            <span>{date}</span>
            {share === undefined ? null : <span>{t('yourShare', { amount: share })}</span>}
          </span>
        }
        trailing={<span className="font-medium tabular-nums">{amount}</span>}
      />
      {edit === undefined ? null : (
        <div className="grid gap-2 pb-3">
          <div>
            <SyncMarker state={edit.state} />
          </div>
          {edit.state === 'failed' && edit.failureCode !== undefined ? (
            <FailedChangePanel
              code={edit.failureCode}
              onRetry={edit.onRetry}
              onDiscard={edit.onDiscard}
            />
          ) : null}
          {edit.state === 'conflict' ? (
            <Link
              href={edit.editHref}
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              {tCommon('resolve')}
            </Link>
          ) : null}
          {edit.state === 'pending' || edit.state === 'synced' ? (
            edit.confirmingDelete ? (
              <DeleteConfirm
                pending={false}
                onConfirm={edit.onConfirmDelete}
                onCancel={edit.onCancelDelete}
              />
            ) : (
              <RowActions
                allowed={edit.allowed}
                consolidated={false}
                editHref={edit.editHref}
                onDelete={edit.onDelete}
              />
            )
          ) : null}
        </div>
      )}
    </>
  );
}

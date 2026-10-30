'use client';

import { Archive } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { buttonVariants } from '@/components/ui/button';
import { ListRow } from '@/components/ui/list-row';
import { Link } from '@/i18n/navigation';
import { DeleteConfirm } from '../../edit/components/delete-confirm';
import { FailedChangePanel } from '../../edit/components/failed-change-panel';
import { RowActions } from '../../edit/components/row-actions';
import { SyncMarker } from '../../edit/components/sync-marker';
import { CategoryVisual } from '@/features/categories/components/category-visual';
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
  /**
   * Only for the payer: the way to link an expense that has no movement of theirs, or a marker
   * that it is linked (FEAT-008). Independent of `edit`, so it stays when the device queue is not.
   */
  linkAction?: { kind: 'link'; href: string } | { kind: 'linked' };
  /** Absent while the device queue is unavailable: the row then has no marker and no actions. */
  edit?: ExpenseRowEdit;
}

/** One expense of the group: compact; its actions open with a tap on the row. */
export function ExpenseRow({
  description,
  category,
  payer,
  amount,
  date,
  share,
  linkAction,
  edit,
}: ExpenseRowProps) {
  const t = useTranslations('groups.expenses');
  const tCommon = useTranslations('groups.edit.common.actions');
  const tChip = useTranslations('groups.categoryViews.chip');
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  // A failed change or a conflict keeps its way out in view; an open delete confirmation too.
  const attention = edit !== undefined && (edit.state === 'failed' || edit.state === 'conflict');
  const hasActions =
    linkAction?.kind === 'link' ||
    (edit !== undefined &&
      (edit.state === 'pending' || edit.state === 'synced') &&
      (edit.allowed || edit.confirmingDelete));
  const open = expanded || edit?.confirmingDelete === true;

  const row = (
    <ListRow
      wrapDescription
      className="py-2.5"
      leading={<CategoryVisual icon={category.icon} color={category.color} />}
      title={description}
      description={
        <span className="grid gap-0.5">
          <span>
            <span>{category.label}</span>
            {category.archived ? (
              <span className="inline-flex items-center gap-1 pl-1">
                <Archive aria-hidden="true" className="size-3" />
                {tChip('archived')}
              </span>
            ) : null}
            <span aria-hidden="true"> · </span>
            <span>{t('paidBy', { name: payer })}</span>
          </span>
          <span>{date}</span>
          {linkAction?.kind === 'linked' ? <span>{t('linkedMarker')}</span> : null}
          {edit === undefined ? null : <SyncMarker state={edit.state} />}
        </span>
      }
      trailing={
        <span className="grid justify-items-end gap-0.5">
          <span className="text-small font-bold tabular-nums">{amount}</span>
          {share === undefined ? null : (
            <span className="text-caption text-muted-foreground tabular-nums">
              {t('yourShare', { amount: share })}
            </span>
          )}
        </span>
      }
    />
  );

  return (
    <>
      {/* One structure whether or not the toggle shows, so the row is never remounted. */}
      <div className="relative">
        {row}
        {hasActions ? (
          // Over the row, not around it: the row is block content a button cannot hold.
          <button
            type="button"
            aria-expanded={open}
            aria-controls={panelId}
            className="absolute inset-0 cursor-pointer rounded-xl transition-colors outline-none hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
            onClick={() => {
              if (edit?.confirmingDelete === true) edit.onCancelDelete();
              setExpanded((value) => !value);
            }}
          >
            <span className="sr-only">{t('toggleActions', { description })}</span>
          </button>
        ) : null}
      </div>
      {attention ? (
        <div className="grid gap-2 pb-3">
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
        </div>
      ) : null}
      {hasActions ? (
        <div id={panelId} hidden={!open} className="grid gap-2 pb-3">
          {linkAction?.kind === 'link' ? (
            <div>
              <Link
                href={linkAction.href}
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
              >
                {t('linkAction')}
              </Link>
            </div>
          ) : null}
          {edit === undefined ||
          !(edit.state === 'pending' || edit.state === 'synced') ? null : edit.confirmingDelete ? (
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
          )}
        </div>
      ) : null}
    </>
  );
}

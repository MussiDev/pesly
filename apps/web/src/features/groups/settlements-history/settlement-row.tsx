'use client';

import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';
import { DeleteConfirm } from '../edit/components/delete-confirm';
import { FailedChangePanel } from '../edit/components/failed-change-panel';
import { RowActions } from '../edit/components/row-actions';
import { SyncMarker } from '../edit/components/sync-marker';
import type { SyncState } from '../sync-overlay';

export interface SettlementRowData {
  id: string;
  payer: string;
  payee: string;
  /** Already formatted in the settlement currency. */
  amount: string;
  /** Already formatted in the user's time zone. */
  date: string;
  consolidated: boolean;
  /** Where the row stands against the server; absent means saved. */
  syncState?: SyncState;
  /** The rejection code, only when failed. */
  failureCode?: string;
  /** The caller may change this record and the device queue can take the change. */
  allowed?: boolean;
  editHref?: string;
  confirmingDelete?: boolean;
  deleting?: boolean;
}

interface SettlementRowProps {
  row: SettlementRowData;
  onDelete?: () => void;
  onConfirmDelete?: () => void;
  onCancelDelete?: () => void;
  onRetry?: () => void;
  onDiscard?: () => void;
}

const NOOP = (): void => undefined;

/** One recorded settlement, with its sync marker and the actions its creator or an admin has. */
export function SettlementRow({
  row,
  onDelete = NOOP,
  onConfirmDelete = NOOP,
  onCancelDelete = NOOP,
  onRetry = NOOP,
  onDiscard = NOOP,
}: SettlementRowProps) {
  const t = useTranslations('groups.settlements');
  const tCommon = useTranslations('groups.edit.common.actions');
  const state = row.syncState ?? 'synced';
  const editHref = row.editHref ?? '';

  return (
    <li className="grid gap-2 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 text-small font-semibold break-words">
          {t('parties', { payer: row.payer, payee: row.payee })}
        </span>
        {row.consolidated ? <Badge variant="info">{t('consolidated')}</Badge> : null}
        <SyncMarker state={state} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-small">
        <span className="font-semibold">{row.amount}</span>
        <span className="text-muted-foreground">{row.date}</span>
      </div>
      {state === 'failed' && row.failureCode !== undefined ? (
        <FailedChangePanel code={row.failureCode} onRetry={onRetry} onDiscard={onDiscard} />
      ) : null}
      {state === 'conflict' ? (
        <div>
          <Link href={editHref} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
            {tCommon('resolve')}
          </Link>
        </div>
      ) : null}
      {row.confirmingDelete === true ? (
        <DeleteConfirm
          pending={row.deleting === true}
          onConfirm={onConfirmDelete}
          onCancel={onCancelDelete}
        />
      ) : row.allowed === true && state !== 'conflict' ? (
        <RowActions
          allowed
          consolidated={row.consolidated}
          editHref={editHref}
          onDelete={onDelete}
        />
      ) : null}
    </li>
  );
}

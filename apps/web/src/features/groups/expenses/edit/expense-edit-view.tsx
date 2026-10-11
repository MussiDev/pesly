'use client';

import { CircleAlert, Trash2, TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { Link } from '@/i18n/navigation';
import { DeleteConfirm } from '../../edit/components/delete-confirm';
import { FailedChangePanel } from '../../edit/components/failed-change-panel';
import { ExpenseForm, type ExpenseFormProps } from '../form/expense-form';

export type ExpenseEditNotice = 'notFound' | 'notAllowed' | 'queuedDelete';

/** A screen state with no fields: the record is missing, off limits, or already being deleted. */
export function ExpenseEditNoticeView({
  notice,
  backHref,
}: {
  notice: ExpenseEditNotice;
  backHref: string;
}) {
  const t = useTranslations('groups.edit.expense');
  const Icon = notice === 'notAllowed' ? TriangleAlert : CircleAlert;
  return (
    <EmptyState
      icon={<Icon aria-hidden="true" />}
      title={t(`${notice}.title`)}
      description={t(`${notice}.description`)}
      action={
        <Link href={backHref} className={buttonVariants()}>
          {t('back')}
        </Link>
      }
    />
  );
}

interface ExpenseEditFormViewProps {
  form: ExpenseFormProps;
  /** The code of the refusal of the queued change, when there is one. */
  rejectionCode: string | undefined;
  /** The device queue cannot be used, so nothing can be saved. */
  unavailable: boolean;
  deleting: boolean;
  onRetry: () => void;
  onDiscard: () => void;
  onDelete: () => void;
}

/** The edit form with the failed-change panel above it and the delete action below. */
export function ExpenseEditFormView({
  form,
  rejectionCode,
  unavailable,
  deleting,
  onRetry,
  onDiscard,
  onDelete,
}: ExpenseEditFormViewProps) {
  const t = useTranslations('groups.edit.expense');
  const tCommon = useTranslations('groups.edit.common');
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="grid gap-6">
      <PageHeader title={t('title')} />
      {rejectionCode === undefined ? null : (
        <FailedChangePanel code={rejectionCode} onRetry={onRetry} onDiscard={onDiscard} />
      )}
      {unavailable ? (
        <Alert variant="destructive">
          <CircleAlert aria-hidden />
          <AlertDescription>{tCommon('unavailable')}</AlertDescription>
        </Alert>
      ) : null}
      <ExpenseForm {...form} />
      {confirming ? (
        <DeleteConfirm
          pending={deleting}
          onConfirm={onDelete}
          onCancel={() => {
            setConfirming(false);
          }}
        />
      ) : (
        <div>
          <Button
            variant="outline"
            onClick={() => {
              setConfirming(true);
            }}
          >
            <Trash2 aria-hidden />
            {tCommon('actions.delete')}
          </Button>
        </div>
      )}
    </div>
  );
}

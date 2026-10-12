import { useTranslations } from 'next-intl';
import { useId } from 'react';
import { Button } from '@/components/ui/button';

interface DeleteConfirmProps {
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** The in-page confirmation of a deletion: no dialog (D14). */
export function DeleteConfirm({ pending, onConfirm, onCancel }: DeleteConfirmProps) {
  const t = useTranslations('groups.edit.common.deleteConfirm');
  const titleId = useId();
  return (
    <div
      role="group"
      aria-labelledby={titleId}
      className="grid gap-3 rounded-card border border-destructive/40 bg-card p-4"
    >
      <div className="grid gap-1">
        <p id={titleId} className="font-medium">
          {t('title')}
        </p>
        <p className="text-small text-muted-foreground">{t('description')}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="destructive" size="sm" disabled={pending} onClick={onConfirm}>
          {pending ? t('working') : t('confirm')}
        </Button>
        <Button variant="outline" size="sm" disabled={pending} onClick={onCancel}>
          {t('cancel')}
        </Button>
      </div>
    </div>
  );
}

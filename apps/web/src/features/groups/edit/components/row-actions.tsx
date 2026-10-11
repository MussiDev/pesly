import { Pencil, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { buttonVariants, Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';

interface RowActionsProps {
  /** The caller may change this record (creator or admin, D3). */
  allowed: boolean;
  /** A consolidated settlement can only be deleted (D10). */
  consolidated: boolean;
  editHref: string;
  onDelete: () => void;
}

export function RowActions({ allowed, consolidated, editHref, onDelete }: RowActionsProps) {
  const t = useTranslations('groups.edit.common.actions');
  if (!allowed) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {consolidated ? null : (
        <Link href={editHref} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
          <Pencil aria-hidden />
          {t('edit')}
        </Link>
      )}
      <Button variant="outline" size="sm" onClick={onDelete}>
        <Trash2 aria-hidden />
        {t('delete')}
      </Button>
    </div>
  );
}

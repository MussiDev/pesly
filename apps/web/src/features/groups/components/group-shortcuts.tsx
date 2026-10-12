import { History, Percent, ReceiptText, Tags } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { CircularActionFace, circularActionVariants } from '@/components/ui/circular-action';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

const SHORTCUTS = [
  { path: 'expenses', labelKey: 'expensesLink', icon: ReceiptText },
  { path: 'activity', labelKey: 'activityLink', icon: History },
  { path: 'categories', labelKey: 'categoriesLink', icon: Tags },
  { path: 'default-split', labelKey: 'defaultSplitLink', icon: Percent },
] as const;

/** The sections of one group, one tap away from its detail. */
export function GroupShortcuts({ groupId }: { groupId: string }) {
  const t = useTranslations('groups.detail');

  return (
    <ul className="grid grid-cols-4 items-start gap-3">
      {SHORTCUTS.map(({ path, labelKey, icon: Icon }) => (
        <li key={path} className="flex min-w-0 justify-center">
          <Link
            href={`/groups/${encodeURIComponent(groupId)}/${path}`}
            className={cn(circularActionVariants(), 'min-w-0 text-center')}
          >
            <CircularActionFace icon={<Icon />} label={t(labelKey)} />
          </Link>
        </li>
      ))}
    </ul>
  );
}

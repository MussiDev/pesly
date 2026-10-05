import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, CircleDollarSign } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { CircularActionFace, circularActionVariants } from '@/components/ui/circular-action';
import { Link } from '@/i18n/navigation';

const NEW_MOVEMENT_HREF = '/movements/new';

const ACTIONS = [
  { type: 'expense', icon: ArrowUpRight, tone: 'primary' },
  { type: 'income', icon: ArrowDownLeft, tone: 'secondary' },
  { type: 'transfer', icon: ArrowLeftRight, tone: 'secondary' },
  { type: 'exchange', icon: CircleDollarSign, tone: 'secondary' },
] as const;

/** One tap from the home to the new-movement screen with the type already chosen. */
export function QuickActions() {
  const t = useTranslations('home.quickActions');

  return (
    <ul aria-label={t('label')} className="grid grid-cols-4 gap-3">
      {ACTIONS.map(({ type, icon: Icon, tone }) => (
        <li key={type} className="flex justify-center">
          <Link
            href={{ pathname: NEW_MOVEMENT_HREF, query: { type } }}
            className={circularActionVariants()}
          >
            <CircularActionFace icon={<Icon />} label={t(type)} tone={tone} />
          </Link>
        </li>
      ))}
    </ul>
  );
}

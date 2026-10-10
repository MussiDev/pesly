import { ChartPie, ChevronRight, CreditCard, Users, type LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { Link } from '@/i18n/navigation';

const SHORTCUTS: readonly {
  key: 'budgets' | 'groups' | 'cards';
  href: string;
  icon: LucideIcon;
  inCreation: boolean;
}[] = [
  { key: 'budgets', href: '/budgets', icon: ChartPie, inCreation: true },
  { key: 'groups', href: '/groups', icon: Users, inCreation: true },
  { key: 'cards', href: '/cards', icon: CreditCard, inCreation: false },
];

/** One card per area that lives outside the home; the ones not built yet say so. */
export function HomeShortcuts() {
  const t = useTranslations('home.shortcuts');

  return (
    <ul aria-label={t('label')} className="grid gap-3">
      {SHORTCUTS.map(({ key, href, icon: Icon, inCreation }) => (
        <li key={key}>
          <Link
            href={href}
            className="flex items-center gap-3 rounded-card bg-card p-4 transition-colors outline-none motion-reduce:transition-none hover:bg-surface focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span
              aria-hidden
              className="flex size-10 shrink-0 items-center justify-center rounded-pill bg-accent text-accent-foreground"
            >
              <Icon className="size-5" />
            </span>
            <span className="grid min-w-0 flex-1 gap-0.5">
              <span className="text-small font-bold">{t(`${key}.title`)}</span>
              <span className="text-caption text-muted-foreground">{t(`${key}.description`)}</span>
            </span>
            {inCreation ? <Badge variant="info">{t('inCreation')}</Badge> : null}
            <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          </Link>
        </li>
      ))}
    </ul>
  );
}

import { Plus, Wallet } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { Link } from '@/i18n/navigation';

function ActionTile({ href, icon, label }: { href: string; icon: ReactNode; label: string }) {
  return (
    <Link
      href={href}
      className="flex min-h-11 items-center gap-3 rounded-2xl border border-border/70 bg-card p-3 text-small font-medium shadow-xs transition-colors outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span
        aria-hidden
        className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground [&_svg]:size-5"
      >
        {icon}
      </span>
      {label}
    </Link>
  );
}

export function QuickActions() {
  const t = useTranslations('home.quickActions');

  return (
    <section aria-label={t('title')} className="grid gap-3 sm:grid-cols-2">
      <ActionTile href="/movements/new" icon={<Plus />} label={t('addMovement')} />
      <ActionTile href="/accounts/new" icon={<Wallet />} label={t('addAccount')} />
    </section>
  );
}

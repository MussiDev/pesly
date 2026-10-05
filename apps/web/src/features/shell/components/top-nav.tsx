'use client';

import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { ThemeToggle } from '@/components/theme-toggle';
import { buttonVariants } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import {
  ADD_MOVEMENT_HREF,
  isActivePath,
  PRIMARY_ITEMS,
  SECONDARY_ITEMS,
  type NavItem,
} from '../nav-items';
import { SignOutButton } from './sign-out-button';

export interface TopNavProps {
  /** The current path without the locale; marks its destination. */
  currentPath?: string;
  signingOut: boolean;
  onSignOut: () => void;
}

const DESTINATIONS: readonly NavItem[] = [...PRIMARY_ITEMS, ...SECONDARY_ITEMS];

/** The top navigation card from `md`; below it the floating bottom bar and the More page take over. */
export function TopNav({ currentPath, signingOut, onSignOut }: TopNavProps) {
  const t = useTranslations('app');
  const tNav = useTranslations('app.nav');

  function destination(item: NavItem) {
    const active = isActivePath(item.href, currentPath);
    const Icon = item.icon;
    return (
      <li key={item.href}>
        <Link
          href={item.href}
          aria-current={active ? 'page' : undefined}
          className={cn(
            'inline-flex min-h-11 items-center gap-2 rounded-pill px-4 text-small font-medium text-muted-foreground transition-colors outline-none motion-reduce:transition-none hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring',
            active &&
              'bg-accent text-accent-foreground hover:bg-accent hover:text-accent-foreground',
          )}
        >
          <Icon aria-hidden className="size-4" />
          {tNav(item.labelKey)}
        </Link>
      </li>
    );
  }

  return (
    <nav
      data-slot="top-nav"
      aria-label={tNav('label')}
      className="sticky top-4 z-40 mx-4 mt-4 hidden flex-wrap items-center gap-x-4 gap-y-2 rounded-card bg-card px-4 py-3 shadow-xs md:flex"
    >
      <p className="flex items-center gap-2.5 text-heading">
        <span
          aria-hidden
          className="inline-flex size-9 items-center justify-center rounded-xl bg-primary text-small font-semibold text-primary-foreground"
        >
          {t('brand').charAt(0)}
        </span>
        {t('brand')}
      </p>
      <ul className="flex flex-1 flex-wrap items-center gap-1">{DESTINATIONS.map(destination)}</ul>
      <div className="flex items-center gap-2">
        <Link href={ADD_MOVEMENT_HREF} className={buttonVariants({ variant: 'default' })}>
          <Plus aria-hidden />
          {tNav('addMovement')}
        </Link>
        <ThemeToggle />
        <SignOutButton pending={signingOut} onSignOut={onSignOut} />
      </div>
    </nav>
  );
}

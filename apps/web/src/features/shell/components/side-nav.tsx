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

export interface SideNavProps {
  /** The current path without the locale; marks its destination. */
  currentPath?: string;
  signingOut: boolean;
  onSignOut: () => void;
}

/** The side navigation from `md`; below it the bottom bar and the More page take over. */
export function SideNav({ currentPath, signingOut, onSignOut }: SideNavProps) {
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
            'flex min-h-11 items-center gap-3 rounded-md px-3 text-small font-medium text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring',
            active && 'bg-accent text-primary',
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
      data-slot="side-nav"
      aria-label={tNav('label')}
      className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col gap-4 overflow-y-auto border-r bg-background p-4 md:flex"
    >
      <p className="px-3 text-heading text-primary">{t('brand')}</p>
      <Link href={ADD_MOVEMENT_HREF} className={buttonVariants({ variant: 'default' })}>
        <Plus aria-hidden />
        {tNav('addMovement')}
      </Link>
      <ul className="grid gap-1">{PRIMARY_ITEMS.map(destination)}</ul>
      <ul className="grid gap-1 border-t pt-4">{SECONDARY_ITEMS.map(destination)}</ul>
      <div className="mt-auto grid gap-2">
        <ThemeToggle size="compact" />
        <SignOutButton pending={signingOut} onSignOut={onSignOut} />
      </div>
    </nav>
  );
}

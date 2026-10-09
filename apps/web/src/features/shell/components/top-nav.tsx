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

/**
 * The side menu from 900 px; below it the bottom bar and the More page take over. It keeps the
 * `top-nav` slot name the shell tests and e2e flows already target.
 */
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
            'flex h-11 items-center gap-3 rounded-xl px-3 text-small font-medium text-foreground transition-colors outline-none motion-reduce:transition-none hover:bg-surface focus-visible:ring-2 focus-visible:ring-ring',
            active && 'bg-accent font-bold text-accent-foreground hover:bg-accent',
          )}
        >
          <Icon aria-hidden className="size-5 shrink-0" />
          {tNav(item.labelKey)}
        </Link>
      </li>
    );
  }

  return (
    <nav
      data-slot="top-nav"
      aria-label={tNav('label')}
      className="sticky top-0 hidden h-dvh w-66 shrink-0 flex-col gap-5 overflow-y-auto border-r bg-card px-4 py-5 desk:flex"
    >
      <p className="flex items-center gap-2.5 px-2 py-1 text-heading font-bold tracking-tight">
        <span
          aria-hidden
          className="inline-flex size-8 items-center justify-center rounded-lg bg-primary text-body font-bold text-primary-foreground"
        >
          {t('brand').charAt(0)}
        </span>
        {t('brand')}
      </p>
      <Link
        href={ADD_MOVEMENT_HREF}
        className={cn(buttonVariants({ variant: 'default' }), 'h-12 w-full font-bold')}
      >
        <Plus aria-hidden />
        {tNav('addMovement')}
      </Link>
      <ul className="grid gap-0.5">{PRIMARY_ITEMS.map(destination)}</ul>
      <ul className="grid gap-0.5">{SECONDARY_ITEMS.map(destination)}</ul>
      <div className="flex-1" />
      <div className="flex items-center justify-between gap-2 rounded-2xl bg-surface p-3">
        <ThemeToggle />
        <SignOutButton pending={signingOut} onSignOut={onSignOut} iconOnly />
      </div>
    </nav>
  );
}

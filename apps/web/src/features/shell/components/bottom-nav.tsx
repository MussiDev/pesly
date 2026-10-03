'use client';

import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import {
  ACCOUNTS_ITEM,
  ADD_MOVEMENT_HREF,
  HOME_ITEM,
  isActiveInBottomNav,
  MORE_ITEM,
  MOVEMENTS_ITEM,
  type NavItem,
} from '../nav-items';

export interface BottomNavProps {
  /** The current path without the locale; marks its destination. */
  currentPath?: string;
}

// The add action sits between the two halves so it stays centered and reachable by thumb.
const BEFORE_ADD: readonly NavItem[] = [HOME_ITEM, ACCOUNTS_ITEM];
const AFTER_ADD: readonly NavItem[] = [MOVEMENTS_ITEM, MORE_ITEM];

/** The bottom bar below `md`; the side navigation takes over from `md`. */
export function BottomNav({ currentPath }: BottomNavProps) {
  const t = useTranslations('app.nav');

  function destination(item: NavItem) {
    const active = isActiveInBottomNav(item, currentPath);
    const Icon = item.icon;
    return (
      <li key={item.href} className="min-w-0 flex-1">
        <Link
          href={item.href}
          aria-current={active ? 'page' : undefined}
          className={cn(
            'flex min-h-11 min-w-0 flex-col items-center justify-center gap-0.5 rounded-lg py-1.5 text-caption font-medium text-muted-foreground transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring',
            active && 'bg-accent text-primary',
          )}
        >
          <Icon aria-hidden className="size-5 shrink-0" />
          <span className="min-w-0 max-w-full truncate">{t(item.labelKey)}</span>
        </Link>
      </li>
    );
  }

  return (
    <nav
      data-slot="bottom-nav"
      aria-label={t('label')}
      className="sticky bottom-0 z-40 border-t bg-card px-2 pb-safe md:hidden"
    >
      <ul className="mx-auto flex max-w-md items-center pt-1.5">
        {BEFORE_ADD.map(destination)}
        <li className="flex shrink-0 justify-center">
          <Link
            href={ADD_MOVEMENT_HREF}
            aria-label={t('addMovement')}
            className="inline-flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md transition-colors outline-none hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <Plus aria-hidden className="size-6" />
          </Link>
        </li>
        {AFTER_ADD.map(destination)}
      </ul>
    </nav>
  );
}

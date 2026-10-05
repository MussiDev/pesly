'use client';

import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import {
  ADD_MOVEMENT_HREF,
  HOME_ITEM,
  INVESTMENTS_ITEM,
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
const BEFORE_ADD: readonly NavItem[] = [HOME_ITEM, MOVEMENTS_ITEM];
const AFTER_ADD: readonly NavItem[] = [INVESTMENTS_ITEM, MORE_ITEM];

/**
 * The floating pill bar below `lg`; the top navigation takes over from `lg`. The landmark spans
 * the width and lets taps through, so only the pill itself catches them.
 */
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
            'flex min-h-11 min-w-0 flex-col items-center justify-center gap-0.5 rounded-pill py-1.5 text-nav font-medium text-muted-foreground transition-colors outline-none motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-ring',
            active && 'bg-accent text-accent-foreground',
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
      className="pointer-events-none fixed inset-x-0 bottom-0 z-40 pb-safe lg:hidden"
    >
      <ul className="pointer-events-auto mx-4 mb-4 flex items-center rounded-pill bg-card px-2 py-1.5 shadow-md sm:mx-auto sm:max-w-md">
        {BEFORE_ADD.map(destination)}
        <li className="flex shrink-0 justify-center">
          <Link
            href={ADD_MOVEMENT_HREF}
            aria-label={t('addMovement')}
            className="inline-flex size-circle-action items-center justify-center rounded-pill bg-primary text-primary-foreground shadow-md transition-colors outline-none hover:bg-primary/90 motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <Plus aria-hidden className="size-6" />
          </Link>
        </li>
        {AFTER_ADD.map(destination)}
      </ul>
    </nav>
  );
}

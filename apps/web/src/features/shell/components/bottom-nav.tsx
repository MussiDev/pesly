'use client';

import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import {
  ADD_MOVEMENT_HREF,
  HOME_ITEM,
  GROUPS_ITEM,
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
const AFTER_ADD: readonly NavItem[] = [GROUPS_ITEM, MORE_ITEM];

/**
 * The flat bar below 900 px, with the raised add action; the side menu takes over from 900 px. The landmark spans
 * the width and lets taps through, so only the pill itself catches them.
 */
export function BottomNav({ currentPath }: BottomNavProps) {
  const t = useTranslations('app.nav');

  function destination(item: NavItem) {
    const active = isActiveInBottomNav(item, currentPath);
    const Icon = item.icon;
    return (
      <li key={item.href} className="min-w-0">
        <Link
          href={item.href}
          aria-current={active ? 'page' : undefined}
          className={cn(
            'flex h-14 min-w-0 flex-col items-center justify-center gap-1 text-nav font-medium text-muted-foreground transition-colors outline-none motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-ring',
            active && 'font-bold text-accent-foreground',
          )}
        >
          <span
            className={cn(
              'flex h-7.5 w-14 items-center justify-center rounded-pill transition-colors motion-reduce:transition-none',
              active && 'bg-accent',
            )}
          >
            <Icon aria-hidden className="size-5.5 shrink-0" />
          </span>
          <span className="min-w-0 max-w-full truncate">{t(item.labelKey)}</span>
        </Link>
      </li>
    );
  }

  return (
    <nav
      data-slot="bottom-nav"
      aria-label={t('label')}
      className="pointer-events-none fixed inset-x-0 bottom-0 z-40 pb-safe desk:hidden"
    >
      <ul className="pointer-events-auto grid grid-cols-5 items-start border-t bg-card px-2 pt-1.5 pb-2">
        {BEFORE_ADD.map(destination)}
        <li className="flex justify-center">
          <Link
            href={ADD_MOVEMENT_HREF}
            aria-label={t('addMovement')}
            className="-mt-5.5 inline-flex size-15 items-center justify-center rounded-pill bg-primary text-primary-foreground ring-4 ring-background transition-colors outline-none hover:bg-primary/90 motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background"
          >
            <Plus aria-hidden className="size-6.5" />
          </Link>
        </li>
        {AFTER_ADD.map(destination)}
      </ul>
    </nav>
  );
}

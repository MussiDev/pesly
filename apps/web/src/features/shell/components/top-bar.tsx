'use client';

import { Bell, Check, ChevronLeft, WifiOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import { backButtonVisibility, parentRoute, type ParentRoute } from '../nav-items';

export interface TopBarProps {
  online: boolean;
  /** Changes kept on this device that wait to be sent. */
  pending: number;
  /** The current path without the locale; decides whether a back button shows. */
  currentPath?: string | undefined;
  /** The notices link with its unread badge; without it the bell stays a disabled placeholder. */
  notices?: ReactNode;
}

/**
 * NorteAR's "‹ Parent" link: names the page it goes to, and always goes to the page above, never
 * through the history (a page opened from a notification still has somewhere to go).
 */
function BackLink({ parent, desk }: { parent: ParentRoute; desk: boolean }) {
  const t = useTranslations('app.topBar');

  return (
    <Link
      href={parent.href}
      aria-label={t('backTo', { page: t(`parents.${parent.labelKey}`) })}
      className={cn(
        'mr-auto -ml-1 inline-flex min-h-11 min-w-0 items-center gap-0.5 rounded-md pr-2 text-body font-medium text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring',
        !desk && 'desk:hidden',
      )}
    >
      <ChevronLeft aria-hidden className="size-5 shrink-0" />
      <span className="truncate">{t(`parents.${parent.labelKey}`)}</span>
    </Link>
  );
}

/** The strip above every page: how in sync the device is, and the notifications entry point. */
export function TopBar({ online, pending, currentPath, notices }: TopBarProps) {
  const t = useTranslations('app.topBar');
  const back = backButtonVisibility(currentPath);
  const parent = parentRoute(currentPath);
  const waiting = online && pending > 0;
  const Icon = online ? Check : WifiOff;

  return (
    <div
      data-slot="top-bar"
      className="sticky top-0 z-30 flex items-center justify-end gap-2 bg-background px-4 py-2.5 desk:px-8"
    >
      {parent !== undefined && (back.compact || back.desk) ? (
        <BackLink parent={parent} desk={back.desk} />
      ) : null}
      <p
        className={cn(
          'inline-flex h-8 items-center gap-1.5 rounded-pill px-3 text-caption font-semibold whitespace-nowrap',
          online && !waiting ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning',
        )}
      >
        <Icon aria-hidden className="size-3.5" />
        {!online ? t('offline') : waiting ? t('pending', { count: pending }) : t('upToDate')}
      </p>
      {notices ?? (
        <button
          type="button"
          disabled
          aria-label={t('notifications')}
          title={t('notificationsSoon')}
          className="flex size-11 items-center justify-center rounded-pill bg-card text-foreground disabled:opacity-70"
        >
          <Bell aria-hidden className="size-5" />
        </button>
      )}
    </div>
  );
}

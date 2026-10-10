'use client';

import { Bell, Check, WifiOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

export interface TopBarProps {
  online: boolean;
  /** Changes kept on this device that wait to be sent. */
  pending: number;
}

/** The strip above every page: how in sync the device is, and the notifications entry point. */
export function TopBar({ online, pending }: TopBarProps) {
  const t = useTranslations('app.topBar');
  const waiting = online && pending > 0;
  const Icon = online ? Check : WifiOff;

  return (
    <div
      data-slot="top-bar"
      className="sticky top-0 z-30 flex items-center justify-end gap-2 bg-background px-4 py-2.5 desk:px-8"
    >
      <p
        className={cn(
          'inline-flex h-8 items-center gap-1.5 rounded-pill px-3 text-caption font-semibold whitespace-nowrap',
          online && !waiting ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning',
        )}
      >
        <Icon aria-hidden className="size-3.5" />
        {!online ? t('offline') : waiting ? t('pending', { count: pending }) : t('upToDate')}
      </p>
      <button
        type="button"
        disabled
        aria-label={t('notifications')}
        title={t('notificationsSoon')}
        className="flex size-11 items-center justify-center rounded-pill bg-card text-foreground disabled:opacity-70"
      >
        <Bell aria-hidden className="size-5" />
      </button>
    </div>
  );
}

'use client';

import type { Notice } from '@pesly/shared';
import { useLocale, useTranslations } from 'next-intl';
import { formatCalendarDate } from '@/features/credit-cards/format-dates';
import { cn } from '@/lib/utils';

export interface NoticeListProps {
  notices: readonly Notice[];
  /** Tapping an unread notice; read ones are not interactive. */
  onOpen: (notice: Notice) => void;
}

/** The notices, newest first, unread ones standing out. The text is always a plain text node. */
export function NoticeList({ notices, onOpen }: NoticeListProps) {
  const t = useTranslations('notices');
  const locale = useLocale();

  return (
    <ul aria-label={t('listLabel')} className="divide-y rounded-card bg-card px-4 shadow-xs">
      {notices.map((notice) => {
        const unread = notice.readAt === null;
        const content = (
          <>
            <span
              aria-hidden
              className={cn('mt-1.5 size-2 shrink-0 rounded-full', unread && 'bg-primary')}
            />
            <span className="grid min-w-0 flex-1 gap-0.5">
              {unread ? <span className="sr-only">{t('unread')}</span> : null}
              <span className={cn('text-body break-words', unread && 'font-medium')}>
                {notice.text}
              </span>
              <span className="text-caption text-muted-foreground">
                {t('dueOn', { date: formatCalendarDate(notice.dueDate, locale) })}
              </span>
            </span>
          </>
        );
        return (
          <li key={notice.id}>
            {unread ? (
              <button
                type="button"
                onClick={() => {
                  onOpen(notice);
                }}
                className="flex min-h-14 w-full items-start gap-3 rounded-xl py-3 text-start outline-none hover:bg-surface focus-visible:ring-2 focus-visible:ring-ring"
              >
                {content}
              </button>
            ) : (
              <div className="flex min-h-14 items-start gap-3 py-3 text-muted-foreground">
                {content}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

'use client';

import type { Notice } from '@pesly/shared';
import { useLocale, useTranslations } from 'next-intl';
import { formatCalendarDate, formatPeriod } from '@/features/credit-cards/format-dates';
import { cn } from '@/lib/utils';

export interface NoticeListProps {
  notices: readonly Notice[];
  /** Tapping an unread notice; read ones are not interactive. */
  onOpen: (notice: Notice) => void;
}

const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isCalendarDate(value: string): boolean {
  return CALENDAR_DATE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

/** The notices, newest first, unread ones standing out. The text is always a plain text node. */
export function NoticeList({ notices, onOpen }: NoticeListProps) {
  const t = useTranslations('notices');
  const locale = useLocale();

  // A malformed date is shown as received instead of throwing from the formatter.
  const caption = (notice: Notice): string => {
    if (!isCalendarDate(notice.dueDate)) return t('dueOn', { date: notice.dueDate });
    if (notice.kind === 'budget_alert') {
      return t('alertMonth', { month: formatPeriod(notice.dueDate.slice(0, 7), locale) });
    }
    if (notice.kind === 'group_expense' || notice.kind === 'group_settlement') {
      return t('recordedOn', { date: formatCalendarDate(notice.dueDate, locale) });
    }
    return t('dueOn', { date: formatCalendarDate(notice.dueDate, locale) });
  };

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
              <span className="text-caption text-muted-foreground">{caption(notice)}</span>
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

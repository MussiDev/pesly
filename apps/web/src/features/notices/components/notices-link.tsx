'use client';

import { Bell } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

/** Above this the badge says "99+" instead of the exact number. */
export const MAX_SHOWN_UNREAD = 99;

export interface UnreadCountProps {
  /** `undefined` while loading or when the count could not be read: nothing is shown then. */
  count: number | undefined;
  className?: string;
}

/** The unread number as a small pill; nothing at 0 or when unknown. */
export function UnreadCount({ count, className }: UnreadCountProps) {
  const t = useTranslations('notices');
  const format = useFormatter();
  if (count === undefined || count <= 0) return null;
  return (
    <Badge
      aria-hidden
      className={cn('border-transparent bg-primary text-primary-foreground', className)}
    >
      {count > MAX_SHOWN_UNREAD ? t('overflow', { max: MAX_SHOWN_UNREAD }) : format.number(count)}
    </Badge>
  );
}

export interface NoticesLinkProps {
  count: number | undefined;
}

/** The bell that leads to the notices screen, with the unread number when there is one. */
export function NoticesLink({ count }: NoticesLinkProps) {
  const t = useTranslations('notices');
  const tNav = useTranslations('app.nav');
  const unread = count !== undefined && count > 0;
  return (
    <Link
      href="/notices"
      aria-label={unread ? t('linkLabel', { count }) : tNav('notices')}
      className="relative inline-flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-pill px-3 text-muted-foreground transition-colors outline-none motion-reduce:transition-none hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Bell aria-hidden className="size-4" />
      <UnreadCount count={count} />
    </Link>
  );
}

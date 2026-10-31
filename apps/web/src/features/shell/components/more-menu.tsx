'use client';

import { ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { ThemeToggle } from '@/components/theme-toggle';
import { listRowVariants } from '@/components/ui/list-row';
import { PageHeader } from '@/components/ui/page-header';
import { Link } from '@/i18n/navigation';
import type { ApiErrorKey } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { MORE_SECTIONS, NOTICES_ITEM } from '../nav-items';
import { SignOutAlert } from './sign-out-alert';
import { SignOutButton } from './sign-out-button';

export interface MoreMenuProps {
  signingOut: boolean;
  signOutError: ApiErrorKey | undefined;
  onSignOut: () => void;
  /** The warning before a sign out that would lose changes not yet synced. */
  signOutConfirmation?: ReactNode;
  /** The unread count shown on the notices entry; there is no header to carry it on small screens. */
  noticesBadge?: ReactNode;
}

/**
 * What the bottom bar has no room for, in the side menu's groups (Hick's law: three short lists
 * instead of one of twelve): your money, plan ahead, and account and settings with the theme.
 */
export function MoreMenu({
  signingOut,
  signOutError,
  onSignOut,
  signOutConfirmation,
  noticesBadge,
}: MoreMenuProps) {
  const t = useTranslations('app');
  const tNav = useTranslations('app.nav');

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 p-4">
      <PageHeader title={t('more.title')} description={t('more.description')} />
      {MORE_SECTIONS.map((section) => (
        <section
          key={section.labelKey}
          aria-labelledby={`more-${section.labelKey}`}
          className="grid gap-2"
        >
          <h2
            id={`more-${section.labelKey}`}
            className="px-1 text-caption font-semibold tracking-wide text-muted-foreground uppercase"
          >
            {tNav(section.labelKey)}
          </h2>
          <ul className="divide-y divide-border/70 overflow-hidden rounded-card bg-card px-4 py-1">
            {section.items.map((item) => {
              const Icon = item.icon;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={cn(
                      listRowVariants({ interactive: true }),
                      'min-h-14 outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    )}
                  >
                    <span
                      aria-hidden
                      className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground"
                    >
                      <Icon className="size-5" />
                    </span>
                    <span className="flex-1 text-small font-semibold">{tNav(item.labelKey)}</span>
                    {item.href === NOTICES_ITEM.href ? noticesBadge : null}
                    <ChevronRight aria-hidden className="size-4 text-muted-foreground" />
                  </Link>
                </li>
              );
            })}
            {section.labelKey === 'accountSection' ? (
              <li className="py-3">
                <ThemeToggle />
              </li>
            ) : null}
          </ul>
        </section>
      ))}
      <SignOutAlert error={signOutError} />
      {signOutConfirmation}
      <SignOutButton pending={signingOut} onSignOut={onSignOut} />
    </main>
  );
}

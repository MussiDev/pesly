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
import { MORE_LIST_ITEMS } from '../nav-items';
import { SignOutAlert } from './sign-out-alert';
import { SignOutButton } from './sign-out-button';

export interface MoreMenuProps {
  signingOut: boolean;
  signOutError: ApiErrorKey | undefined;
  onSignOut: () => void;
  /** The warning before a sign out that would lose changes not yet synced. */
  signOutConfirmation?: ReactNode;
}

/** What the bottom bar has no room for: accounts, categories, profile, security, theme and sign out. */
export function MoreMenu({
  signingOut,
  signOutError,
  onSignOut,
  signOutConfirmation,
}: MoreMenuProps) {
  const t = useTranslations('app');
  const tNav = useTranslations('app.nav');
  const tTheme = useTranslations('theme');

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 p-4">
      <PageHeader title={t('more.title')} description={t('more.description')} />
      <ul className="divide-y rounded-card bg-card px-4 shadow-xs">
        {MORE_LIST_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                className={cn(
                  listRowVariants({ interactive: true }),
                  'outline-none focus-visible:ring-2 focus-visible:ring-ring',
                )}
              >
                <Icon aria-hidden className="size-4 text-muted-foreground" />
                <span className="flex-1 text-body">{tNav(item.labelKey)}</span>
                <ChevronRight aria-hidden className="size-4 text-muted-foreground" />
              </Link>
            </li>
          );
        })}
        <li className="flex min-h-14 items-center justify-between gap-4 py-3">
          <span className="text-body">{tTheme('darkMode')}</span>
          <ThemeToggle />
        </li>
      </ul>
      <SignOutAlert error={signOutError} />
      {signOutConfirmation}
      <SignOutButton pending={signingOut} onSignOut={onSignOut} />
    </main>
  );
}

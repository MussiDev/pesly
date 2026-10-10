'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import type { ApiErrorKey } from '@/lib/api-client';
import { BottomNav } from './bottom-nav';
import { SignOutAlert } from './sign-out-alert';
import { TopNav } from './top-nav';

export type ShellState =
  { kind: 'loading' } | { kind: 'ready' } | { kind: 'failed'; error: ApiErrorKey };

export interface AuthenticatedShellProps {
  state: ShellState;
  /** The current path without the locale, e.g. `/settings/security`; marks its nav link. */
  currentPath?: string;
  signingOut: boolean;
  signOutError: ApiErrorKey | undefined;
  onRetry: () => void;
  onSignOut: () => void;
  /** What waits to be synced, shown above the page once the shell is ready. */
  syncStatus?: ReactNode;
  /** The warning before a sign out that would lose changes not yet synced. */
  signOutConfirmation?: ReactNode;
  /** The notices link with its unread badge, shown in the top navigation. */
  notices?: ReactNode;
  children: ReactNode;
}

/** The frame of the authenticated area: session check progress, its failure, or the app. */
export function AuthenticatedShell({
  state,
  currentPath,
  signingOut,
  signOutError,
  onRetry,
  onSignOut,
  syncStatus,
  signOutConfirmation,
  notices,
  children,
}: AuthenticatedShellProps) {
  const t = useTranslations('app');
  const tUi = useTranslations('ui');
  const tErrors = useTranslations('errors');

  if (state.kind === 'failed') {
    return (
      <div className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center p-4">
        <ErrorState
          title={tUi('error.title')}
          description={tErrors(state.error)}
          retryLabel={t('retry')}
          onRetry={onRetry}
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-3 focus:text-small focus:font-medium focus:text-primary-foreground"
      >
        {t('skipToContent')}
      </a>
      <TopNav
        currentPath={currentPath}
        signingOut={signingOut}
        onSignOut={onSignOut}
        notices={notices}
      />
      {/* The pages bring their own <main>; this wrapper is only the skip link's target. The bottom
          padding keeps the last element clear of the floating bar below md. */}
      <div
        id="main-content"
        tabIndex={-1}
        className="flex min-w-0 flex-1 flex-col pb-28 outline-none lg:pb-0"
      >
        {state.kind === 'loading' ? (
          <div className="mx-auto grid w-full max-w-5xl content-start gap-6 p-4 lg:p-8">
            <p role="status" className="sr-only">
              {t('loading')}
            </p>
            <Skeleton className="h-8 w-1/2 max-w-xs" />
            <Skeleton className="h-40 w-full rounded-card" />
            <div className="grid grid-cols-4 gap-3">
              {[0, 1, 2, 3].map((index) => (
                <Skeleton key={index} className="h-20 rounded-card" />
              ))}
            </div>
            <Skeleton className="h-48 w-full rounded-card" />
          </div>
        ) : (
          <>
            {signOutError ? (
              <div className="px-4 pt-4">
                <SignOutAlert error={signOutError} />
              </div>
            ) : null}
            {signOutConfirmation ? <div className="px-4 pt-4">{signOutConfirmation}</div> : null}
            {syncStatus}
            {children}
          </>
        )}
      </div>
      <BottomNav currentPath={currentPath} />
    </div>
  );
}

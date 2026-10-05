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
      <TopNav currentPath={currentPath} signingOut={signingOut} onSignOut={onSignOut} />
      {/* The pages bring their own <main>; this wrapper is only the skip link's target. The bottom
          padding keeps the last element clear of the floating bar below md. */}
      <div
        id="main-content"
        tabIndex={-1}
        className="flex min-w-0 flex-1 flex-col pb-28 outline-none md:pb-0"
      >
        {state.kind === 'loading' ? (
          <div className="mx-auto grid w-full max-w-md content-start gap-4 p-4">
            <p role="status" className="sr-only">
              {t('loading')}
            </p>
            <Skeleton className="h-8 w-1/2" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : (
          <>
            {signOutError ? (
              <div className="px-4 pt-4">
                <SignOutAlert error={signOutError} />
              </div>
            ) : null}
            {children}
          </>
        )}
      </div>
      <BottomNav currentPath={currentPath} />
    </div>
  );
}

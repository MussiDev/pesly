'use client';

import { UnreadBadgeContainer } from '@/features/notices/containers/unread-badge-container';
import { MoreMenu } from '../components/more-menu';
import { SignOutConfirmation } from '../components/sign-out-confirmation';
import { useSignOut } from '../use-sign-out';

/** Owns the sign-out state of the More page. */
export function MoreContainer() {
  const { signingOut, signOutError, confirming, requestSignOut, confirmSignOut, cancelSignOut } =
    useSignOut();

  return (
    <MoreMenu
      noticesBadge={<UnreadBadgeContainer variant="count" />}
      signingOut={signingOut}
      signOutError={signOutError}
      onSignOut={() => {
        void requestSignOut();
      }}
      signOutConfirmation={
        confirming !== undefined ? (
          <SignOutConfirmation
            count={confirming}
            signingOut={signingOut}
            onConfirm={() => {
              void confirmSignOut();
            }}
            onCancel={cancelSignOut}
          />
        ) : null
      }
    />
  );
}

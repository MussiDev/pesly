'use client';

import { MoreMenu } from '../components/more-menu';
import { useSignOut } from '../use-sign-out';

/** Owns the sign-out state of the More page. */
export function MoreContainer() {
  const { signingOut, signOutError, signOut } = useSignOut();

  return (
    <MoreMenu
      signingOut={signingOut}
      signOutError={signOutError}
      onSignOut={() => {
        void signOut();
      }}
    />
  );
}

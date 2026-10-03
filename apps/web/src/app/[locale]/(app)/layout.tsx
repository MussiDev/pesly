import type { ReactNode } from 'react';
import { AuthenticatedShellContainer } from '@/features/shell/containers/authenticated-shell-container';

export default function AppLayout({ children }: { children: ReactNode }) {
  return <AuthenticatedShellContainer>{children}</AuthenticatedShellContainer>;
}

'use client';

import { LogOut } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';

export interface SignOutButtonProps {
  pending: boolean;
  onSignOut: () => void;
}

export function SignOutButton({ pending, onSignOut }: SignOutButtonProps) {
  const t = useTranslations('auth.signOut');
  return (
    <Button
      variant="ghost"
      className="w-full justify-start px-3 text-muted-foreground"
      disabled={pending}
      onClick={onSignOut}
    >
      <LogOut aria-hidden />
      {pending ? t('pending') : t('label')}
    </Button>
  );
}

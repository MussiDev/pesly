'use client';

import { LogOut } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface SignOutButtonProps {
  pending: boolean;
  onSignOut: () => void;
  /** Shows only the icon; the label stays as the accessible name. */
  iconOnly?: boolean;
  className?: string;
}

export function SignOutButton({ pending, onSignOut, iconOnly, className }: SignOutButtonProps) {
  const t = useTranslations('auth.signOut');
  return (
    <Button
      variant="ghost"
      className={cn(
        'text-muted-foreground',
        iconOnly ? 'size-11 shrink-0 px-0' : 'w-full justify-start px-3',
        className,
      )}
      disabled={pending}
      onClick={onSignOut}
      aria-label={iconOnly ? t('label') : undefined}
      title={iconOnly ? t('label') : undefined}
    >
      <LogOut aria-hidden />
      {iconOnly ? null : pending ? t('pending') : t('label')}
    </Button>
  );
}

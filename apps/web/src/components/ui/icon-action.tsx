import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Button } from './button';

interface IconActionProps {
  /** The action, e.g. "Rename"; also the tooltip. */
  label: string;
  /** What it acts on, e.g. the account name: the accessible name is "<label> <subject>". */
  subject: string;
  icon: ReactNode;
  disabled: boolean;
  onClick: () => void;
  /**
   * Shows the label under the icon. Touch screens have no tooltip, so where there is room the
   * action names itself instead of relying on `title`.
   */
  showLabel?: boolean;
  /** A destructive action reads as one, so it is not mistaken for its neighbours. */
  tone?: 'default' | 'destructive';
  className?: string;
}

/** A row action: the visible part is the icon (and its label), the screen-reader name carries the rest. */
export function IconAction({
  label,
  subject,
  icon,
  disabled,
  onClick,
  showLabel = false,
  tone = 'default',
  className,
}: IconActionProps) {
  return (
    <Button
      size={showLabel ? 'sm' : 'icon'}
      variant="ghost"
      title={showLabel ? undefined : label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        showLabel && 'h-auto min-w-14 flex-col gap-0.5 px-2 py-1.5 text-caption font-medium',
        tone === 'destructive' && 'text-destructive hover:text-destructive active:text-destructive',
        className,
      )}
    >
      {icon}
      {showLabel ? <span aria-hidden="true">{label}</span> : null}
      <span className="sr-only">
        {label} {subject}
      </span>
    </Button>
  );
}

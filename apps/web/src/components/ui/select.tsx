import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/**
 * Native `<select>` styled like `Input`: the platform picker on phones, no extra dependency.
 */
export function Select({ className, ...props }: ComponentProps<'select'>) {
  return (
    <select
      data-slot="select"
      className={cn(
        'min-h-11 w-full min-w-0 rounded-lg border border-input bg-card px-3 py-2 text-body text-foreground shadow-xs transition-colors outline-none disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-small',
        '[&>option]:bg-popover [&>option]:text-popover-foreground',
        'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        'aria-invalid:border-destructive aria-invalid:focus-visible:ring-destructive',
        className,
      )}
      {...props}
    />
  );
}

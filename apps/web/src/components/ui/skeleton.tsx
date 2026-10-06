import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/** A pulsing placeholder; the screen that renders it announces the loading state itself. */
export function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn('animate-pulse rounded-lg bg-foreground/10', className)}
      {...props}
    />
  );
}

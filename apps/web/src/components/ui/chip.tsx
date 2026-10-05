import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

interface ChipProps extends ComponentProps<'button'> {
  /** The toggle state, announced to assistive technology through `aria-pressed`. */
  pressed: boolean;
}

/** A pill toggle button, for filters. */
export function Chip({ pressed, className, type = 'button', ...props }: ChipProps) {
  return (
    <button
      data-slot="chip"
      type={type}
      aria-pressed={pressed}
      className={cn(
        'inline-flex min-h-11 items-center justify-center gap-1.5 rounded-pill border px-4 text-small font-medium whitespace-nowrap transition-colors outline-none motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
        pressed
          ? 'border-transparent bg-primary text-primary-foreground'
          : 'border-border bg-card text-muted-foreground hover:bg-accent hover:text-accent-foreground',
        className,
      )}
      {...props}
    />
  );
}

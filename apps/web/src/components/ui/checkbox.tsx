import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/**
 * Native `<input type="checkbox">` drawn with theme tokens: keyboard and screen-reader support
 * come from the platform, with no extra dependency. Label it with `<Label htmlFor>` or `aria-label`.
 * The visible box is 20px; the `::after` pseudo-element grows the clickable area to 44px without
 * affecting layout, so a touch never lands beside the box.
 */
export function Checkbox({ className, ...props }: ComponentProps<'input'>) {
  return (
    <input
      data-slot="checkbox"
      className={cn(
        'relative size-5 shrink-0 cursor-pointer appearance-none rounded-sm border border-input bg-card transition-colors outline-none',
        'after:absolute after:-inset-3 after:content-[""]',
        'before:absolute before:top-1/2 before:left-1/2 before:h-2.5 before:w-1.5 before:-translate-x-1/2 before:-translate-y-[60%] before:rotate-45 before:border-r-2 before:border-b-2 before:border-primary-foreground before:opacity-0 before:content-[""] checked:before:opacity-100',
        'checked:border-primary checked:bg-primary',
        'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        'disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50',
        'aria-invalid:border-destructive',
        className,
      )}
      {...props}
      type="checkbox"
    />
  );
}

import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

// shadcn/ui label on a native <label> (no Radix Label dependency).
export function Label({ className, htmlFor, ...props }: ComponentProps<'label'>) {
  return (
    <label
      data-slot="label"
      htmlFor={htmlFor}
      className={cn(
        'flex items-center gap-2 text-small leading-none font-medium select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

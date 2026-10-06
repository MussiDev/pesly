import { cva } from 'class-variance-authority';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Also usable on a link, the way `buttonVariants` is: `<Link className={listRowVariants(...)}>`. */
export const listRowVariants = cva('flex min-h-11 items-center gap-3 px-1 py-3', {
  variants: {
    interactive: {
      // Hover and focus-within only: for rows whose child is a link or button, which owns the focus ring.
      true: 'cursor-pointer rounded-xl transition-colors hover:bg-surface focus-within:bg-surface',
      false: '',
    },
  },
  defaultVariants: { interactive: false },
});

interface ListRowProps extends Omit<ComponentProps<'div'>, 'title' | 'ref'> {
  as?: 'div' | 'li';
  leading?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  trailing?: ReactNode;
  interactive?: boolean;
}

export function ListRow({
  as = 'div',
  leading,
  title,
  description,
  trailing,
  interactive = false,
  className,
  ...props
}: ListRowProps) {
  // `li` takes the same props as `div` here; the cast only keeps the handler types aligned.
  const Tag = as as 'div';
  return (
    <Tag
      data-slot="list-row"
      className={cn(listRowVariants({ interactive }), className)}
      {...props}
    >
      {leading ? <div className="shrink-0">{leading}</div> : null}
      <div className="grid min-w-0 flex-1 gap-0.5">
        <div className="line-clamp-2 text-body font-medium break-words">{title}</div>
        {description ? (
          <div className="truncate text-small text-muted-foreground">{description}</div>
        ) : null}
      </div>
      {trailing ? <div className="shrink-0">{trailing}</div> : null}
    </Tag>
  );
}

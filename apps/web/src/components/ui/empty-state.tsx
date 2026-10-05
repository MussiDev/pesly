import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface EmptyStateProps extends Omit<ComponentProps<'div'>, 'title'> {
  /** Already translated by the caller: `components/ui/` never reads the message catalogs. */
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
  headingAs?: 'h1' | 'h2' | 'h3';
}

export function EmptyState({
  title,
  description,
  icon,
  action,
  headingAs: Heading = 'h2',
  className,
  ...props
}: EmptyStateProps) {
  return (
    <div
      data-slot="empty-state"
      className={cn(
        'flex flex-col items-center gap-3 rounded-card border border-dashed bg-card px-6 py-10 text-center',
        className,
      )}
      {...props}
    >
      {icon ? <div className="text-muted-foreground [&>svg]:size-8">{icon}</div> : null}
      <Heading className="text-heading">{title}</Heading>
      {description ? (
        <p className="max-w-prose text-small text-muted-foreground">{description}</p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

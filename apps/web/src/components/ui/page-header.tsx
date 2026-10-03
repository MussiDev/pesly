import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface PageHeaderProps extends Omit<ComponentProps<'header'>, 'title'> {
  title: string;
  description?: string;
  actions?: ReactNode;
}

export function PageHeader({ title, description, actions, className, ...props }: PageHeaderProps) {
  return (
    <header
      data-slot="page-header"
      className={cn('flex flex-wrap items-start justify-between gap-4', className)}
      {...props}
    >
      <div className="grid gap-1">
        <h1 className="text-title">{title}</h1>
        {description ? <p className="text-small text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </header>
  );
}

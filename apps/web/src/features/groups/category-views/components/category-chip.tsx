import { Archive } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { CategoryVisual } from '@/features/categories/components/category-visual';
import { cn } from '@/lib/utils';
import type { CategoryDisplay } from '../types';

/** A category as icon, color, name and, when archived, a text marker: color is never alone. */
export function CategoryChip({
  display,
  size = 'md',
  className,
}: {
  display: CategoryDisplay;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const t = useTranslations('groups.categoryViews.chip');
  return (
    <span
      data-slot="category-chip"
      className={cn('inline-flex min-w-0 items-center gap-2 text-small', className)}
    >
      <CategoryVisual
        icon={display.icon}
        color={display.color}
        className={size === 'sm' ? 'size-6 [&>svg]:size-3.5' : 'size-8 [&>svg]:size-4'}
      />
      <span className="min-w-0 break-words whitespace-normal">{display.label}</span>
      {display.archived ? (
        <span className="inline-flex shrink-0 items-center gap-1 text-caption text-muted-foreground">
          <Archive aria-hidden="true" className="size-3" />
          {t('archived')}
        </span>
      ) : null}
    </span>
  );
}

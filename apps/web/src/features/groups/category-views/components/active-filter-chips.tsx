import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import type { CategoryDisplay } from '../types';
import { CategoryChip } from './category-chip';

/** The selected categories as removable chips plus a clear action; nothing when none is selected. */
export function ActiveFilterChips({
  selected,
  onRemove,
  onClear,
}: {
  selected: readonly CategoryDisplay[];
  onRemove: (id: string) => void;
  onClear: () => void;
}) {
  const t = useTranslations('groups.categoryViews.filter');
  if (selected.length === 0) return null;
  return (
    <div role="group" aria-label={t('activeLabel')} className="flex flex-wrap items-center gap-2">
      {selected.map((item) => (
        <span
          key={item.id}
          className="inline-flex items-center gap-1 rounded-pill border border-border bg-card py-1 ps-2"
        >
          <CategoryChip display={item} size="sm" />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label={t('remove', { name: item.label })}
            onClick={() => {
              onRemove(item.id);
            }}
          >
            <X aria-hidden="true" />
          </Button>
        </span>
      ))}
      <Button type="button" variant="ghost" onClick={onClear}>
        {t('clear')}
      </Button>
    </div>
  );
}

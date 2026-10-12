import { useTranslations } from 'next-intl';
import { Chip } from '@/components/ui/chip';
import type { CategoryDisplay } from '../types';
import { CategoryChip } from './category-chip';

/** Toggle buttons, one per offered category; which ones to offer is the container's decision. */
export function CategoryFilter({
  options,
  selected,
  onToggle,
}: {
  options: readonly CategoryDisplay[];
  selected: readonly string[];
  onToggle: (id: string) => void;
}) {
  const t = useTranslations('groups.categoryViews.filter');
  if (options.length === 0) return null;
  return (
    <div role="group" aria-label={t('label')} className="flex flex-wrap gap-2">
      {options.map((option) => (
        <Chip
          key={option.id}
          pressed={selected.includes(option.id)}
          onClick={() => {
            onToggle(option.id);
          }}
          className="h-auto max-w-full py-1 whitespace-normal"
        >
          <CategoryChip display={option} size="sm" />
        </Chip>
      ))}
    </div>
  );
}

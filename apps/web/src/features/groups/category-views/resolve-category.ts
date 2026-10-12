import type { CategoryLanguage, GroupCategoryResponse } from '@pesly/shared';
import { groupCategoryLabel } from '../components/group-categories-list';
import type { CategoryDisplay } from './types';

export const NEUTRAL_ICON = 'unknown';
export const NEUTRAL_COLOR = 'neutral';

/**
 * The display of a category id. An id missing from the list (a queued overlay, a stale options
 * answer or a newer API) is the neutral fallback; `uncategorizedLabel` is the translated text the
 * caller supplies, and the raw id is never shown.
 */
export function resolveCategory(
  id: string,
  categories: readonly GroupCategoryResponse[],
  language: CategoryLanguage,
  uncategorizedLabel = '',
): CategoryDisplay {
  const found = categories.find((category) => category.id === id);
  if (found === undefined) {
    return {
      id,
      label: uncategorizedLabel,
      icon: NEUTRAL_ICON,
      color: NEUTRAL_COLOR,
      archived: false,
      known: false,
    };
  }
  return {
    id,
    label: groupCategoryLabel(found, language),
    icon: found.icon,
    color: found.color,
    archived: found.archivedAt !== null,
    known: true,
  };
}

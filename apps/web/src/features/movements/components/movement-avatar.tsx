import type { MovementType } from '@pesly/shared';
import { ArrowLeftRight } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { CategoryVisual } from '@/features/categories/components/category-visual';
import { resolveMerchant } from '@/lib/logos/resolve-merchant';

export interface MovementAvatarProps {
  type: MovementType;
  /** The movement note: the only place a merchant can be named. */
  note: string | null | undefined;
  categoryIcon: string | undefined;
  categoryColor: string | undefined;
}

/**
 * The leading visual of a movement row. A transfer or an exchange shows its type icon and never a
 * logo; an income or expense shows the logo of the merchant its note names, or else its category.
 */
export function MovementAvatar({ type, note, categoryIcon, categoryColor }: MovementAvatarProps) {
  if (type === 'transfer' || type === 'exchange') {
    return <Avatar fallback={<ArrowLeftRight />} />;
  }
  const merchant = resolveMerchant(note);
  if (merchant !== undefined) {
    return <Avatar src={merchant.logo} fallback={merchant.name.charAt(0)} />;
  }
  return <CategoryVisual icon={categoryIcon ?? ''} color={categoryColor ?? ''} />;
}

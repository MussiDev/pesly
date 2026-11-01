import type { MovementType } from '@pesly/shared';
import { ArrowLeftRight, SlidersHorizontal } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { CategoryVisual } from '@/features/categories/components/category-visual';
import { resolveMerchant } from '@/lib/logos/resolve-merchant';

export interface MovementAvatarProps {
  type: MovementType;
  /** The movement note: the only place a merchant can be named. */
  note: string | null | undefined;
  /** The category's display name: a category named like a merchant shows its logo (FEAT-017). */
  categoryName?: string | undefined;
  categoryIcon: string | undefined;
  categoryColor: string | undefined;
}

/**
 * The leading visual of a movement row. A transfer or an exchange shows its type icon and never a
 * logo; an adjustment shows its own icon; an income or expense shows the logo of the merchant its
 * note names, or else its category (with the merchant logo when the category is named like one).
 */
export function MovementAvatar({
  type,
  note,
  categoryName,
  categoryIcon,
  categoryColor,
}: MovementAvatarProps) {
  if (type === 'adjustment') {
    return <Avatar fallback={<SlidersHorizontal />} />;
  }
  if (type === 'transfer' || type === 'exchange') {
    return <Avatar fallback={<ArrowLeftRight />} />;
  }
  const merchant = resolveMerchant(note);
  if (merchant !== undefined) {
    return <Avatar src={merchant.logo} fallback={merchant.name.charAt(0)} />;
  }
  return (
    <CategoryVisual icon={categoryIcon ?? ''} color={categoryColor ?? ''} name={categoryName} />
  );
}

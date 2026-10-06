import { CATEGORY_COLORS, emojiOfIcon, type CategoryColor } from '@pesly/shared';
import { cn } from '@/lib/utils';
import {
  CATEGORY_ICON_COMPONENTS,
  FALLBACK_CATEGORY_ICON,
  isCategoryIcon,
} from '../category-icons';

// Literal class names so Tailwind can see them; the tokens are defined in globals.css.
export const CATEGORY_COLOR_CLASSES: Record<CategoryColor, string> = {
  red: 'bg-category-red/15 text-category-red',
  orange: 'bg-category-orange/15 text-category-orange',
  amber: 'bg-category-amber/15 text-category-amber',
  yellow: 'bg-category-yellow/15 text-category-yellow',
  lime: 'bg-category-lime/15 text-category-lime',
  green: 'bg-category-green/15 text-category-green',
  teal: 'bg-category-teal/15 text-category-teal',
  cyan: 'bg-category-cyan/15 text-category-cyan',
  blue: 'bg-category-blue/15 text-category-blue',
  violet: 'bg-category-violet/15 text-category-violet',
  pink: 'bg-category-pink/15 text-category-pink',
  slate: 'bg-category-slate/15 text-category-slate',
};

/** Solid fills for the color picker swatches. */
export const CATEGORY_SWATCH_CLASSES: Record<CategoryColor, string> = {
  red: 'bg-category-red',
  orange: 'bg-category-orange',
  amber: 'bg-category-amber',
  yellow: 'bg-category-yellow',
  lime: 'bg-category-lime',
  green: 'bg-category-green',
  teal: 'bg-category-teal',
  cyan: 'bg-category-cyan',
  blue: 'bg-category-blue',
  violet: 'bg-category-violet',
  pink: 'bg-category-pink',
  slate: 'bg-category-slate',
};

const FALLBACK_COLOR_CLASS = 'bg-muted text-muted-foreground';

function isCategoryColor(key: string): key is CategoryColor {
  return (CATEGORY_COLORS as readonly string[]).includes(key);
}

/** A category's icon on its color. Unknown keys render a neutral icon and color, never raw values. */
export function CategoryVisual({
  icon,
  color,
  className,
}: {
  icon: string;
  color: string;
  className?: string;
}) {
  const emoji = emojiOfIcon(icon);
  const Icon = isCategoryIcon(icon) ? CATEGORY_ICON_COMPONENTS[icon] : FALLBACK_CATEGORY_ICON;
  return (
    <span
      aria-hidden="true"
      data-icon={emoji !== undefined || isCategoryIcon(icon) ? icon : 'unknown'}
      data-color={isCategoryColor(color) ? color : 'unknown'}
      className={cn(
        'inline-flex size-10 shrink-0 items-center justify-center rounded-pill [&>svg]:size-5',
        isCategoryColor(color) ? CATEGORY_COLOR_CLASSES[color] : FALLBACK_COLOR_CLASS,
        className,
      )}
    >
      {emoji === undefined ? <Icon /> : <span className="text-heading leading-none">{emoji}</span>}
    </span>
  );
}

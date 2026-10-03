'use client';

import { CATEGORY_COLORS, CATEGORY_ICONS } from '@pesly/shared';
import { Check } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { CategoryFieldControlProps } from './category-field';
import { CATEGORY_SWATCH_CLASSES, CategoryVisual } from './category-visual';

// The label is the touch target (44 px); the visual inside it stays smaller.
const OPTION_LABEL =
  'relative inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center';

// Selected and focused look different: selection is a ring in the ring color (plus a check on
// swatches), keyboard focus is an outline in the foreground color, so neither hides the other.
const OPTION_STATE =
  'peer-checked:ring-2 peer-checked:ring-ring peer-checked:ring-offset-2 peer-checked:ring-offset-background peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-foreground peer-disabled:opacity-50';

/** The 24 icons as native radios; the radio is visually hidden and its label is the icon. */
export function IconPicker({
  control,
  defaultValue,
}: {
  control: CategoryFieldControlProps;
  defaultValue?: string;
}) {
  const t = useTranslations('categories.icons');
  return (
    <div
      role="radiogroup"
      tabIndex={-1}
      aria-labelledby={control['aria-labelledby']}
      aria-invalid={control['aria-invalid']}
      aria-describedby={control['aria-describedby']}
      className="flex flex-wrap gap-1 outline-none"
    >
      {CATEGORY_ICONS.map((icon) => (
        <label key={icon} className={OPTION_LABEL}>
          <input
            type="radio"
            name="icon"
            value={icon}
            defaultChecked={icon === defaultValue}
            className="peer sr-only"
          />
          <CategoryVisual
            icon={icon}
            color="slate"
            className={`rounded-md border bg-card text-card-foreground peer-checked:border-ring peer-checked:bg-secondary ${OPTION_STATE}`}
          />
          <span className="sr-only">{t(icon)}</span>
        </label>
      ))}
    </div>
  );
}

/** The 12 colors as native radios; the label is a swatch of the token plus the color name. */
export function ColorPicker({
  control,
  defaultValue,
}: {
  control: CategoryFieldControlProps;
  defaultValue?: string;
}) {
  const t = useTranslations('categories.colors');
  return (
    <div
      role="radiogroup"
      tabIndex={-1}
      aria-labelledby={control['aria-labelledby']}
      aria-invalid={control['aria-invalid']}
      aria-describedby={control['aria-describedby']}
      className="flex flex-wrap gap-1 outline-none"
    >
      {CATEGORY_COLORS.map((color) => (
        <label key={color} className={OPTION_LABEL}>
          <input
            type="radio"
            name="color"
            value={color}
            defaultChecked={color === defaultValue}
            className="peer sr-only"
          />
          <span
            aria-hidden="true"
            data-slot="swatch"
            className={`block size-7 rounded-full ${CATEGORY_SWATCH_CLASSES[color]} ${OPTION_STATE}`}
          />
          {/* The radio carries the state for assistive tech; the check only keeps selection from resting on color. */}
          <Check
            aria-hidden="true"
            data-slot="swatch-check"
            className="pointer-events-none absolute size-4 text-background opacity-0 peer-checked:opacity-100"
          />
          <span className="sr-only">{t(color)}</span>
        </label>
      ))}
    </div>
  );
}

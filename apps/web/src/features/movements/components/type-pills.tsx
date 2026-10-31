'use client';

import { CREATABLE_MOVEMENT_TYPES, type CreatableMovementType } from '@pesly/shared';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

interface TypePillsProps {
  value: CreatableMovementType;
  onChange: (type: CreatableMovementType) => void;
  /** The type is locked, as when editing a movement. */
  disabled?: boolean;
}

/** The four movement types as one segmented control, the first thing the screen asks for. */
export function TypePills({ value, onChange, disabled = false }: TypePillsProps) {
  const t = useTranslations('movements');

  return (
    <div
      role="group"
      aria-label={t('fields.type')}
      className="grid grid-cols-4 gap-1 rounded-pill bg-surface p-1"
    >
      {CREATABLE_MOVEMENT_TYPES.map((type) => {
        const pressed = type === value;
        return (
          <button
            key={type}
            type="button"
            disabled={disabled}
            aria-pressed={pressed}
            aria-label={t(`types.${type}`)}
            onClick={() => {
              onChange(type);
            }}
            className={cn(
              'min-h-11 min-w-0 rounded-pill px-1 text-center text-nav leading-tight font-semibold transition-colors outline-none motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-ring enabled:active:bg-card/60 disabled:cursor-not-allowed',
              pressed
                ? 'bg-primary text-primary-foreground'
                : 'text-foreground enabled:hover:bg-card disabled:opacity-50',
            )}
          >
            {t(`typesShort.${type}`)}
          </button>
        );
      })}
    </div>
  );
}

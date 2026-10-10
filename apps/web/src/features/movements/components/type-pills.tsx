'use client';

import { MOVEMENT_TYPES, type MovementType } from '@pesly/shared';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

interface TypePillsProps {
  value: MovementType;
  onChange: (type: MovementType) => void;
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
      {MOVEMENT_TYPES.map((type) => {
        const pressed = type === value;
        return (
          <button
            key={type}
            type="button"
            disabled={disabled}
            aria-pressed={pressed}
            onClick={() => {
              onChange(type);
            }}
            className={cn(
              'min-h-11 min-w-0 rounded-pill px-1 text-nav font-semibold whitespace-nowrap transition-colors outline-none motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed',
              pressed
                ? 'bg-primary text-primary-foreground'
                : 'text-foreground enabled:hover:bg-card disabled:opacity-50',
            )}
          >
            {t(`types.${type}`)}
          </button>
        );
      })}
    </div>
  );
}

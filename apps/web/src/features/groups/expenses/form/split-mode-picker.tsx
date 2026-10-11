'use client';

import { GROUP_SPLIT_MODES, type GroupSplitMode } from '@pesly/shared';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

interface SplitModePickerProps {
  mode: GroupSplitMode;
  onChange: (mode: GroupSplitMode) => void;
}

/** Equal, percentage or exact amounts: native radios drawn as a segmented control. */
export function SplitModePicker({ mode, onChange }: SplitModePickerProps) {
  const t = useTranslations('groups.split');

  return (
    <div role="radiogroup" aria-label={t('modeLabel')} className="grid grid-cols-3 gap-2">
      {GROUP_SPLIT_MODES.map((option) => (
        <label
          key={option}
          className={cn(
            'flex min-h-11 cursor-pointer items-center justify-center rounded-xl border border-input bg-card px-2 text-center text-small font-medium transition-colors',
            'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-background',
            mode === option && 'border-primary bg-primary text-primary-foreground',
          )}
        >
          <input
            type="radio"
            name="splitMode"
            value={option}
            checked={mode === option}
            onChange={() => {
              onChange(option);
            }}
            className="sr-only"
          />
          {t(`modes.${option}`)}
        </label>
      ))}
    </div>
  );
}

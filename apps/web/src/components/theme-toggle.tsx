'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId } from 'react';
import { THEMES, type Theme } from '@/lib/theme';
import { cn } from '@/lib/utils';
import { useTheme } from './theme-provider';

const ICONS = { light: Sun, dark: Moon, system: Monitor } as const satisfies Record<Theme, unknown>;

/**
 * Segmented control for light, dark and system. Native radios give keyboard support for free.
 * `compact` fills a narrow container (the side navigation) with equal icon-only options; the
 * accessible name and a tooltip still carry the label.
 */
export function ThemeToggle({
  className,
  size = 'default',
}: {
  className?: string;
  size?: 'default' | 'compact';
}) {
  const compact = size === 'compact';
  const t = useTranslations('theme');
  const { theme, setTheme } = useTheme();
  // Radios with one name form a single group per document, so each instance needs its own.
  const groupName = useId();

  return (
    <fieldset className={cn('m-0 min-w-0 border-0 p-0', className)}>
      <legend className="sr-only">{t('label')}</legend>
      <div
        className={cn(
          'gap-1 rounded-lg border bg-surface p-1',
          compact ? 'flex w-full gap-0.5 p-0.5' : 'inline-flex',
        )}
      >
        {THEMES.map((value) => {
          const Icon = ICONS[value];
          return (
            <label
              key={value}
              title={compact ? t(value) : undefined}
              className={cn(
                'relative inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-md text-small font-medium text-muted-foreground transition-colors has-checked:bg-card has-checked:text-foreground has-checked:shadow-xs has-focus-visible:ring-2 has-focus-visible:ring-ring',
                compact ? 'min-w-0 flex-1' : 'min-w-11 px-3',
              )}
            >
              <input
                type="radio"
                name={groupName}
                value={value}
                checked={theme === value}
                onChange={() => {
                  setTheme(value);
                }}
                className="peer absolute inset-0 cursor-pointer appearance-none rounded-md outline-none"
                aria-label={t(value)}
              />
              <Icon aria-hidden className="size-4" />
              <span aria-hidden className={cn(compact && 'hidden')}>
                {t(value)}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

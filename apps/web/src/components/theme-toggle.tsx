'use client';

import { Check, Monitor, Moon, Sun, type LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId } from 'react';
import { cn } from '@/lib/utils';
import { THEME_CHOICES, type ThemeChoice } from '@/lib/theme';
import { useTheme } from './theme-provider';

const ICONS: Record<ThemeChoice, LucideIcon> = { light: Sun, dark: Moon, system: Monitor };

/**
 * Light, dark or system as native radios: arrow keys and focus come from the browser. The current
 * option shows a check mark and the checked state, so it is never marked by color alone.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const t = useTranslations('theme');
  const { choice, setTheme } = useTheme();
  const name = useId();

  return (
    <div
      role="radiogroup"
      aria-label={t('label')}
      className={cn('flex w-full gap-1 rounded-card border bg-surface p-1', className)}
    >
      {THEME_CHOICES.map((option) => {
        const Icon = ICONS[option];
        const checked = choice === option;
        return (
          <label
            key={option}
            className={cn(
              'relative flex min-h-11 min-w-0 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg px-2 text-caption font-medium transition-colors has-focus-visible:ring-2 has-focus-visible:ring-ring motion-reduce:transition-none',
              checked ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground',
            )}
          >
            <input
              type="radio"
              name={name}
              value={option}
              checked={checked}
              onChange={() => {
                setTheme(option);
              }}
              className="peer sr-only"
            />
            <Icon aria-hidden className="size-4 shrink-0" />
            <span className="truncate">{t(option)}</span>
            {checked ? (
              <Check data-slot="theme-check" aria-hidden className="size-4 shrink-0" />
            ) : null}
          </label>
        );
      })}
    </div>
  );
}

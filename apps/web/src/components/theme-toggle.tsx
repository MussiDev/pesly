'use client';

import { Moon, Sun } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { useTheme } from './theme-provider';

/** A dark mode switch: on is dark, off is light. A native button keeps keyboard support for free. */
export function ThemeToggle({ className }: { className?: string }) {
  const t = useTranslations('theme');
  const { theme, setTheme } = useTheme();
  const dark = theme === 'dark';

  return (
    <button
      type="button"
      role="switch"
      aria-checked={dark}
      aria-label={t('darkMode')}
      title={t('darkMode')}
      onClick={() => {
        setTheme(dark ? 'light' : 'dark');
      }}
      className={cn(
        'relative inline-flex h-8 w-14 shrink-0 cursor-pointer items-center rounded-pill border bg-surface p-0.5 transition-colors outline-none motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-ring aria-checked:bg-primary',
        // The 44 px touch target is the pseudo-element, so the visible switch can stay slim.
        'before:absolute before:-inset-y-2 before:inset-x-0 before:content-[""]',
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          'inline-flex size-7 items-center justify-center rounded-pill bg-card text-foreground shadow-xs transition-transform motion-reduce:transition-none',
          dark && 'translate-x-6',
        )}
      >
        {dark ? <Moon className="size-4" /> : <Sun className="size-4" />}
      </span>
    </button>
  );
}

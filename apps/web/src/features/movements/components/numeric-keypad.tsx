'use client';

import { Delete } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';

interface NumericKeypadProps {
  /** Called with a digit, the decimal separator, or `backspace`. */
  onKey: (key: string) => void;
}

const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;

/** The on-screen keys of a phone: the amount is typed here instead of with the system keyboard. */
export function NumericKeypad({ onKey }: NumericKeypadProps) {
  const t = useTranslations('movements.keypad');
  const decimal = useLocale() === 'en' ? '.' : ',';
  const keyClass =
    'flex h-13 items-center justify-center rounded-2xl bg-surface text-title font-semibold text-foreground transition-colors outline-none motion-reduce:transition-none hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring';

  return (
    <div role="group" aria-label={t('label')} className="grid grid-cols-3 gap-2 desk:hidden">
      {DIGITS.map((digit) => (
        <button
          key={digit}
          type="button"
          className={keyClass}
          onClick={() => {
            onKey(digit);
          }}
        >
          {digit}
        </button>
      ))}
      <button
        type="button"
        aria-label={t('decimal')}
        className={keyClass}
        onClick={() => {
          onKey(decimal);
        }}
      >
        {decimal}
      </button>
      <button
        type="button"
        className={keyClass}
        onClick={() => {
          onKey('0');
        }}
      >
        0
      </button>
      <button
        type="button"
        aria-label={t('backspace')}
        className={keyClass}
        onClick={() => {
          onKey('backspace');
        }}
      >
        <Delete aria-hidden className="size-6" />
      </button>
    </div>
  );
}

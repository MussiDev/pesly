import { formatMoney } from '@pesly/shared';
import type { ComponentProps } from 'react';
import type { Locale } from '@/i18n/routing';
import { cn } from '@/lib/utils';

type AmountKind = 'income' | 'expense' | 'neutral';

const SIGN = { income: '+', expense: '−' } as const;

const KIND_CLASS = { income: 'text-income', expense: 'text-expense', neutral: '' } as const;

interface AmountProps extends Omit<ComponentProps<'span'>, 'children'> {
  /** Minor units, never a float. */
  value: bigint;
  currency: string;
  locale: Locale;
  kind?: AmountKind;
  /** Already translated direction ("Income", "Expense"), read instead of the visual sign. */
  directionLabel?: string;
  /** Renders the cents lighter than the integer part, for large headline figures. */
  softDecimals?: boolean;
}

/**
 * Income and expense carry a sign as well as a colour, so the meaning never rests on colour alone.
 * For those two kinds the value is shown as a magnitude behind the sign; a neutral amount keeps
 * its own sign, and zero never gets a sign. The glyph is hidden from screen readers, which hear
 * `directionLabel` instead.
 */
export function Amount({
  value,
  currency,
  locale,
  kind = 'neutral',
  directionLabel,
  softDecimals = false,
  className,
  ...props
}: AmountProps) {
  const effectiveKind: AmountKind = value === 0n ? 'neutral' : kind;
  const signed = effectiveKind !== 'neutral';
  const text = formatMoney(signed && value < 0n ? -value : value, currency, locale);
  return (
    <span
      data-slot="amount"
      data-kind={effectiveKind}
      className={cn('whitespace-nowrap tabular-nums', KIND_CLASS[effectiveKind], className)}
      {...props}
    >
      {signed ? <span aria-hidden="true">{SIGN[effectiveKind]}</span> : null}
      {signed && directionLabel ? <span className="sr-only">{directionLabel}</span> : null}
      {softDecimals ? <SoftDecimals text={text} /> : text}
    </span>
  );
}

/** Splits the last two-digit decimal group (`,75` or `.75`) off so it can be dimmed; no decimals, no split. */
function SoftDecimals({ text }: { text: string }) {
  const match = /^(.*\d)([.,]\d{2})(?!\d)(.*)$/.exec(text);
  if (!match) return <>{text}</>;
  return (
    <>
      {match[1]}
      <span className="opacity-70">{match[2]}</span>
      {match[3]}
    </>
  );
}

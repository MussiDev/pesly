import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import type { Locale } from '@/i18n/routing';
import { formatSignedPercent } from '../format';

export type DeltaKind = 'expense' | 'income' | 'net';

type Tone = 'favorable' | 'unfavorable' | 'noChange' | 'noComparison';

const VARIANT = {
  favorable: 'success',
  unfavorable: 'destructive',
  noChange: 'outline',
  noComparison: 'outline',
} as const;

function toneOf(change: number | null, kind: DeltaKind): Tone {
  if (change === null) return 'noComparison';
  if (change === 0) return 'noChange';
  // A rise in spending is bad news; a rise in income or in the net result is good news.
  const rising = change > 0;
  return rising === (kind !== 'expense') ? 'favorable' : 'unfavorable';
}

export function DeltaChip({
  change,
  kind,
  locale,
}: {
  change: number | null;
  kind: DeltaKind;
  locale: Locale;
}) {
  const t = useTranslations('dashboard.delta');
  const tone = toneOf(change, kind);
  const sign = change === null ? '—' : formatSignedPercent(change, locale);
  return (
    <Badge variant={VARIANT[tone]} className="max-w-full min-w-0 whitespace-normal break-words">
      <span>{sign}</span>
      <span>{t(tone)}</span>
    </Badge>
  );
}

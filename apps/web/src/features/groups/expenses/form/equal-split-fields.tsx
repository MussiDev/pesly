'use client';

import { useTranslations } from 'next-intl';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { formatMoney } from '@/lib/format-amount';

interface EqualSplitFieldsProps {
  members: readonly { id: string; name: string }[];
  selectedIds: readonly string[];
  /** What each selected member owes, or `null` while the amount is not valid yet. */
  shares: ReadonlyMap<string, bigint> | null;
  currency: 'ARS' | 'USD';
  language: 'es' | 'en';
  onToggle: (memberId: string) => void;
}

/** Which members share the expense, with the share each one would owe. */
export function EqualSplitFields({
  members,
  selectedIds,
  shares,
  currency,
  language,
  onToggle,
}: EqualSplitFieldsProps) {
  const t = useTranslations('groups.split.equal');

  return (
    <div className="grid gap-2">
      <p className="text-small text-muted-foreground">{t('hint')}</p>
      <ul className="grid gap-2">
        {members.map((member) => {
          const share = shares?.get(member.id);
          return (
            <li key={member.id} className="flex items-center justify-between gap-3">
              <Label className="flex min-h-11 min-w-0 flex-1 items-center gap-3">
                <Checkbox
                  checked={selectedIds.includes(member.id)}
                  onChange={() => {
                    onToggle(member.id);
                  }}
                />
                <span className="truncate">{member.name}</span>
              </Label>
              {share === undefined ? null : (
                <span className="shrink-0 text-small tabular-nums">
                  {formatMoney(share, currency, language)}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

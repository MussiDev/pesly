'use client';

import { useTranslations } from 'next-intl';
import { MoneyInput } from '@/components/ui/money-input';
import { MovementField } from '@/features/movements/components/movement-field';

interface ExactSplitFieldsProps {
  members: readonly { id: string; name: string }[];
  values: Readonly<Record<string, string>>;
  /** A catalog path per member whose text is not a valid amount. */
  errors: Readonly<Record<string, string>>;
  onChange: (memberId: string, text: string) => void;
}

/** One amount field per member; leaving one empty leaves that member out. */
export function ExactSplitFields({ members, values, errors, onChange }: ExactSplitFieldsProps) {
  const t = useTranslations('groups.split.exact');

  return (
    <div className="grid gap-4">
      <p className="text-small text-muted-foreground">{t('hint')}</p>
      {members.map((member) => (
        <MovementField
          key={member.id}
          label={t('field', { name: member.name })}
          error={errors[member.id]}
        >
          {(control) => (
            <MoneyInput
              value={values[member.id] ?? ''}
              onChange={(event) => {
                onChange(member.id, event.currentTarget.value);
              }}
              {...control}
            />
          )}
        </MovementField>
      ))}
    </div>
  );
}

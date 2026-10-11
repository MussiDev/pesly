'use client';

import { useTranslations } from 'next-intl';
import { Input } from '@/components/ui/input';
import { MovementField } from '@/features/movements/components/movement-field';

interface PercentageSplitFieldsProps {
  members: readonly { id: string; name: string }[];
  values: Readonly<Record<string, string>>;
  /** A catalog path per member whose text is not a valid percentage. */
  errors: Readonly<Record<string, string>>;
  onChange: (memberId: string, text: string) => void;
}

/** One percentage field per member; leaving one empty leaves that member out. */
export function PercentageSplitFields({
  members,
  values,
  errors,
  onChange,
}: PercentageSplitFieldsProps) {
  const t = useTranslations('groups.split.percentage');

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
            <Input
              inputMode="decimal"
              autoComplete="off"
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

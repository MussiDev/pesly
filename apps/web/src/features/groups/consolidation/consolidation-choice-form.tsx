'use client';

import { useTranslations } from 'next-intl';
import { FormItem, FormLabel, FormMessage, FormSelect } from '@/components/ui/form';
import type { ConsolidationFieldMessage } from '../settlements/consolidation-request';

export interface ConsolidationMember {
  id: string;
  name: string;
}

export interface ConsolidationChoiceValues {
  memberA: string;
  memberB: string;
  currency: 'ARS' | 'USD';
}

export interface ConsolidationChoiceFormProps {
  members: readonly ConsolidationMember[];
  values: ConsolidationChoiceValues;
  /** The error of the second person, from the container's validation of the pair. */
  memberBError?: ConsolidationFieldMessage;
  onChange: (values: ConsolidationChoiceValues) => void;
}

/** The two people and the currency to settle in. Pure: the container owns the state. */
export function ConsolidationChoiceForm({
  members,
  values,
  memberBError,
  onChange,
}: ConsolidationChoiceFormProps) {
  const t = useTranslations('groups.consolidate');
  const tAll = useTranslations();
  const tCurrencies = useTranslations('profile.currencies');

  const memberSelect = (field: 'memberA' | 'memberB', error?: ConsolidationFieldMessage) => (
    <FormItem invalid={error !== undefined}>
      <FormLabel>{t(`fields.${field}`)}</FormLabel>
      <FormSelect
        name={field}
        value={values[field]}
        onChange={(event) => {
          onChange({ ...values, [field]: event.target.value });
        }}
      >
        <option value="">{t('choose')}</option>
        {members.map((member) => (
          <option key={member.id} value={member.id}>
            {member.name}
          </option>
        ))}
      </FormSelect>
      <FormMessage>{error ? tAll(error) : undefined}</FormMessage>
    </FormItem>
  );

  return (
    <div className="grid gap-4">
      {memberSelect('memberA')}
      {memberSelect('memberB', memberBError)}
      <FormItem>
        <FormLabel>{t('fields.currency')}</FormLabel>
        <FormSelect
          name="currency"
          value={values.currency}
          onChange={(event) => {
            onChange({ ...values, currency: event.target.value === 'USD' ? 'USD' : 'ARS' });
          }}
        >
          <option value="ARS">{tCurrencies('ARS')}</option>
          <option value="USD">{tCurrencies('USD')}</option>
        </FormSelect>
      </FormItem>
    </div>
  );
}

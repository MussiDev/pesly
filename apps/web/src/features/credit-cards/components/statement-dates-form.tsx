'use client';

import type { StatementResponse } from '@pesly/shared';
import { useTranslations } from 'next-intl';
import { useState, type SubmitEvent } from 'react';
import { Button } from '@/components/ui/button';
import { FormControl, FormItem, FormLabel } from '@/components/ui/form';

export interface StatementDatesValues {
  closingDate: string;
  dueDate: string;
}

interface StatementDatesFormProps {
  statement: StatementResponse;
  pending: boolean;
  onSave: (values: StatementDatesValues) => void;
  onCancel: () => void;
}

/** The closing and due dates of an open statement, edited in place (FR-05). */
export function StatementDatesForm({
  statement,
  pending,
  onSave,
  onCancel,
}: StatementDatesFormProps) {
  const t = useTranslations('creditCards.detail');
  const [values, setValues] = useState<StatementDatesValues>({
    closingDate: statement.closingDate,
    dueDate: statement.dueDate,
  });

  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    onSave(values);
  }

  return (
    <form noValidate onSubmit={submit} className="grid gap-3 pb-3 sm:grid-cols-2">
      <FormItem>
        <FormLabel>{t('closingDate')}</FormLabel>
        <FormControl
          type="date"
          value={values.closingDate}
          onChange={(event) => {
            setValues((current) => ({ ...current, closingDate: event.target.value }));
          }}
        />
      </FormItem>
      <FormItem>
        <FormLabel>{t('dueDate')}</FormLabel>
        <FormControl
          type="date"
          value={values.dueDate}
          onChange={(event) => {
            setValues((current) => ({ ...current, dueDate: event.target.value }));
          }}
        />
      </FormItem>
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" size="sm" disabled={pending}>
          {t('save')}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          {t('cancel')}
        </Button>
      </div>
    </form>
  );
}

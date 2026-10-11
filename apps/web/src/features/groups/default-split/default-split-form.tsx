'use client';

import { useTranslations } from 'next-intl';
import type { SubmitEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FormControl, FormItem, FormLabel, FormMessage, FormSelect } from '@/components/ui/form';
import type { DefaultSplitFieldError, DefaultSplitMode } from './default-split-request';

export interface DefaultSplitFormMember {
  id: string;
  /** `null` for a member without a display name. */
  name: string | null;
}

export interface DefaultSplitFormProps {
  members: readonly DefaultSplitFormMember[];
  mode: DefaultSplitMode;
  values: Readonly<Record<string, string>>;
  fieldErrors: readonly DefaultSplitFieldError[];
  /** Basis points still to assign, signed; `undefined` when the total is fine. */
  difference: bigint | undefined;
  pending: boolean;
  saved: boolean;
  onModeChange: (mode: DefaultSplitMode) => void;
  onValueChange: (memberId: string, value: string) => void;
  onSubmit: () => void;
}

/** Percentage amounts shown to the user: `1050n` -> "10.5", integer arithmetic only. */
function percentText(basisPoints: bigint): string {
  const abs = basisPoints < 0n ? -basisPoints : basisPoints;
  const whole = abs / 100n;
  const fraction = (abs % 100n).toString().padStart(2, '0').replace(/0+$/, '');
  return fraction === '' ? whole.toString() : `${whole.toString()}.${fraction}`;
}

/** Admin editor of the group's default split: equal, or a percentage per member. */
export function DefaultSplitForm({
  members,
  mode,
  values,
  fieldErrors,
  difference,
  pending,
  saved,
  onModeChange,
  onValueChange,
  onSubmit,
}: DefaultSplitFormProps) {
  const t = useTranslations('groups.defaultSplit');
  const tDetail = useTranslations('groups.detail');
  const tAll = useTranslations();

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">{t('editTitle')}</CardTitle>
        <CardDescription>{t('editDescription')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4" noValidate onSubmit={handleSubmit}>
          <FormItem>
            <FormLabel>{t('modeLabel')}</FormLabel>
            <FormSelect
              name="mode"
              value={mode}
              disabled={pending}
              onChange={(event) => {
                onModeChange(event.target.value === 'percentage' ? 'percentage' : 'equal');
              }}
            >
              <option value="equal">{t('modes.equal')}</option>
              <option value="percentage">{t('modes.percentage')}</option>
            </FormSelect>
          </FormItem>
          {mode === 'percentage' ? (
            <div className="grid gap-3">
              {members.map((member) => {
                const error = fieldErrors.find((item) => item.memberId === member.id);
                const name = member.name ?? tDetail('unnamed');
                return (
                  <FormItem key={member.id} invalid={error !== undefined}>
                    <FormLabel>{t('percentLabel', { name })}</FormLabel>
                    <FormControl
                      name={`percentage-${member.id}`}
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      disabled={pending}
                      value={values[member.id] ?? ''}
                      onChange={(event) => {
                        onValueChange(member.id, event.target.value);
                      }}
                    />
                    <FormMessage>{error ? tAll(error.path) : undefined}</FormMessage>
                  </FormItem>
                );
              })}
              {difference !== undefined ? (
                <p role="status" className="text-small text-destructive">
                  {difference > 0n
                    ? t('missing', { amount: percentText(difference) })
                    : t('over', { amount: percentText(difference) })}
                </p>
              ) : null}
            </div>
          ) : null}
          {saved ? (
            <p role="status" className="text-small text-muted-foreground">
              {t('saved')}
            </p>
          ) : null}
          <Button type="submit" disabled={pending}>
            {pending ? t('saving') : t('save')}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

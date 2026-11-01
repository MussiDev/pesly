'use client';

import type { GroupSplitMode } from '@pesly/shared';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState, type SubmitEvent } from 'react';
import { FormActions } from '@/components/ui/form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { GroupIssue } from '@/features/groups/components/group-issue';
import { EqualSplitFields } from '@/features/groups/expenses/form/equal-split-fields';
import { ExactSplitFields } from '@/features/groups/expenses/form/exact-split-fields';
import { PercentageSplitFields } from '@/features/groups/expenses/form/percentage-split-fields';
import { SplitModePicker } from '@/features/groups/expenses/form/split-mode-picker';
import { SplitSummary } from '@/features/groups/expenses/form/split-summary';
import {
  buildSplit,
  exactRemaining,
  percentageTotal,
  previewShares,
} from '@/features/groups/split/split-request';
import { switchSplitMode, type SplitState } from '@/features/groups/split/split-state';
import type { ApiFailure } from '@/lib/api-client';
import { formatMoney } from '@/lib/format-amount';
import { cn } from '@/lib/utils';
import { CategoryChips, type CategoryChipOption } from '../components/category-chips';
import { MovementField } from '../components/movement-field';
import { AUTOMATIC_CATEGORY } from './send-defaults';
import type { SendFieldErrors, SendFormValues } from './send-request';

export interface SendToGroupFormProps {
  /** The movement's amount in minor units and its currency, as read from the server. */
  amount: bigint;
  currency: 'ARS' | 'USD';
  groups: readonly { id: string; name: string }[];
  groupId: string | undefined;
  onChooseGroup: (groupId: string) => void;
  /** The chosen group's options; `null` while they load (or while no group is chosen). */
  options: {
    members: readonly { id: string; name: string }[];
    /** The group's categories that can still be used. */
    categories: readonly CategoryChipOption[];
  } | null;
  initialValues: SendFormValues;
  fieldErrors: SendFieldErrors;
  /** Why the server refused the last send; the entered values stay. */
  issue: ApiFailure | undefined;
  pending: boolean;
  onSubmit: (values: SendFormValues) => void;
}

/** Chooses the group, shows the defaults and sends; presentational, it fetches nothing. */
export function SendToGroupForm({
  amount,
  currency,
  groups,
  groupId,
  onChooseGroup,
  options,
  initialValues,
  fieldErrors,
  issue,
  pending,
  onSubmit,
}: SendToGroupFormProps) {
  const t = useTranslations('movements.sendToGroup');
  const tAll = useTranslations();
  const categoryErrorId = useId();
  const locale = useLocale();
  const language = locale === 'en' ? 'en' : 'es';
  const [values, setValues] = useState(initialValues);
  const [editing, setEditing] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (Object.keys(fieldErrors).length === 0) return;
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [fieldErrors]);

  const members = options?.members ?? [];
  const memberIds = members.map((member) => member.id);
  const { split } = values;
  const selected =
    split.mode === 'equal'
      ? split.selectedMemberIds
      : memberIds.filter((id) => (split.values[id] ?? '').trim() !== '');
  const effective: SplitState = { ...split, selectedMemberIds: [...selected], amount };
  const live = buildSplit(effective, amount, split.payerMemberId, locale);
  const blocked = options !== null && !live.ok;

  const memberErrors: Record<string, string> = {};
  let wholeError: string | undefined;
  if (!live.ok) {
    for (const error of live.errors) {
      if (error.memberId !== null) memberErrors[error.memberId] = error.path;
      else if (live.difference === null) wholeError = error.path;
    }
  }

  function update(patch: Partial<SendFormValues>) {
    setValues((current) => ({ ...current, ...patch }));
  }

  function changeMode(mode: GroupSplitMode) {
    update({ split: switchSplitMode(split, mode) });
  }

  function toggleMember(memberId: string) {
    const chosen = new Set(split.selectedMemberIds);
    if (chosen.has(memberId)) chosen.delete(memberId);
    else chosen.add(memberId);
    update({
      split: { ...split, selectedMemberIds: memberIds.filter((id) => chosen.has(id)) },
    });
  }

  function changeMemberValue(memberId: string, text: string) {
    update({ split: { ...split, values: { ...split.values, [memberId]: text } } });
  }

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || blocked || options === null) return;
    onSubmit(values);
  }

  const shares =
    split.mode === 'equal' ? previewShares(effective, amount, split.payerMemberId, locale) : null;
  const shareMap = shares === null ? null : new Map(shares.map((s) => [s.memberId, s.amount]));
  const equalCount = BigInt(split.selectedMemberIds.length);
  const each = equalCount > 0n ? amount / equalCount : 0n;

  return (
    <form ref={formRef} noValidate onSubmit={handleSubmit} className="grid gap-6">
      {issue ? <GroupIssue failure={issue} /> : null}

      <div role="radiogroup" aria-label={t('chooseGroup')} className="grid gap-2">
        <span className="text-small font-semibold">{t('chooseGroup')}</span>
        {groups.map((group) => {
          const chosen = group.id === groupId;
          return (
            <button
              key={group.id}
              type="button"
              role="radio"
              aria-checked={chosen}
              onClick={() => {
                if (!chosen) onChooseGroup(group.id);
              }}
              className={cn(
                'flex min-h-11 items-center rounded-xl border border-input bg-card px-4 text-left text-small font-medium transition-colors',
                'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none',
                chosen && 'border-primary bg-primary text-primary-foreground',
              )}
            >
              <span className="truncate">{group.name}</span>
            </button>
          );
        })}
      </div>

      {options === null ? null : (
        <>
          <div className="grid min-w-0 gap-2">
            {/* The group's categories as icon tiles; the first tile keeps the automatic choice. */}
            <CategoryChips
              label={t('category')}
              name="groupCategoryId"
              categories={[
                { id: AUTOMATIC_CATEGORY, label: t('automaticCategoryShort'), icon: 'sparkles' },
                ...options.categories,
              ]}
              defaultValue=""
              value={values.category}
              onChange={(id) => {
                update({ category: id });
              }}
              invalid={Boolean(fieldErrors.category)}
              describedBy={fieldErrors.category ? `${categoryErrorId}-message` : undefined}
            />
            {values.category === AUTOMATIC_CATEGORY ? (
              <p className="text-small text-muted-foreground">{t('automaticCategory')}</p>
            ) : null}
            {fieldErrors.category ? (
              <p id={`${categoryErrorId}-message`} className="text-small text-destructive">
                {tAll(fieldErrors.category)}
              </p>
            ) : null}
          </div>
          <MovementField label={t('description')} error={fieldErrors.description}>
            {(control) => (
              <Input
                autoComplete="off"
                value={values.description}
                onChange={(event) => {
                  update({ description: event.currentTarget.value });
                }}
                {...control}
              />
            )}
          </MovementField>

          <div className="grid gap-4">
            {split.mode === 'equal' && !editing ? (
              <p className="text-small">
                {t('splitSummary', {
                  count: split.selectedMemberIds.length,
                  each: formatMoney(each, currency, language),
                })}
              </p>
            ) : null}
            <div>
              <Button
                type="button"
                variant="ghost"
                aria-expanded={editing}
                onClick={() => {
                  setEditing((current) => !current);
                }}
              >
                {t('changeSplit')}
              </Button>
            </div>
            {editing ? (
              <div className="grid gap-4">
                <SplitModePicker mode={split.mode} onChange={changeMode} />
                {split.mode === 'equal' ? (
                  <EqualSplitFields
                    members={members}
                    selectedIds={split.selectedMemberIds}
                    shares={shareMap}
                    currency={currency}
                    language={language}
                    onToggle={toggleMember}
                  />
                ) : split.mode === 'percentage' ? (
                  <>
                    <PercentageSplitFields
                      members={members}
                      values={split.values}
                      errors={memberErrors}
                      onChange={changeMemberValue}
                    />
                    <SplitSummary
                      mode="percentage"
                      difference={percentageTotal(effective)}
                      currency={currency}
                      language={language}
                    />
                  </>
                ) : (
                  <>
                    <ExactSplitFields
                      members={members}
                      values={split.values}
                      errors={memberErrors}
                      onChange={changeMemberValue}
                    />
                    <SplitSummary
                      mode="exact"
                      difference={exactRemaining(effective, amount, locale)}
                      currency={currency}
                      language={language}
                    />
                  </>
                )}
                {wholeError ? (
                  <p role="alert" className="text-small text-destructive">
                    {tAll(wholeError)}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>

          <FormActions>
            <Button type="submit" disabled={pending || blocked}>
              {pending ? t('confirmPending') : t('confirm')}
            </Button>
          </FormActions>
        </>
      )}
    </form>
  );
}

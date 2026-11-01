'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import type { CategoryChipOption } from '@/features/movements/components/category-chips';
import type { ApiFailure } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { GroupIssue } from '../../components/group-issue';
import { PayerAccountFields } from '../form/payer-account-fields';
import type { LinkFieldErrors, LinkWay } from './link-request';

export interface CandidateItem {
  id: string;
  title: string;
  detail: string;
}

export type CandidatesState =
  { kind: 'loading' } | { kind: 'failed' } | { kind: 'ready'; items: readonly CandidateItem[] };

export interface LinkExpenseViewProps {
  /** Description, amount and date of the expense, already formatted. */
  summary: string;
  way: LinkWay;
  onWayChange: (way: LinkWay) => void;
  accounts: readonly { id: string; name: string }[];
  categories: readonly CategoryChipOption[];
  accountId: string;
  categoryId: string;
  onAccountChange: (id: string) => void;
  onCategoryChange: (id: string) => void;
  candidates: CandidatesState;
  movementId: string;
  onMovementChange: (id: string) => void;
  onRetryCandidates: () => void;
  fieldErrors: LinkFieldErrors;
  issue: ApiFailure | undefined;
  pending: boolean;
  onSubmit: () => void;
}

const CHOICE_CLASS = cn(
  'flex min-h-11 w-full items-center rounded-xl border border-input bg-card px-4 text-left text-small font-medium transition-colors',
  'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none',
);
const CHOSEN_CLASS = 'border-primary bg-primary text-primary-foreground';

/** The two ways to link an expense to the payer's account; pure, the container owns every request. */
export function LinkExpenseView({
  summary,
  way,
  onWayChange,
  accounts,
  categories,
  accountId,
  categoryId,
  onAccountChange,
  onCategoryChange,
  candidates,
  movementId,
  onMovementChange,
  onRetryCandidates,
  fieldErrors,
  issue,
  pending,
  onSubmit,
}: LinkExpenseViewProps) {
  const t = useTranslations('groups.expenses.link');

  return (
    <div className="grid gap-6">
      <PageHeader title={t('title')} description={summary} />
      <form
        noValidate
        className="grid gap-6"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        {issue ? <GroupIssue failure={issue} /> : null}
        <p className="text-small text-muted-foreground">{t('intro')}</p>

        <div role="radiogroup" aria-label={t('waysLabel')} className="grid gap-2">
          {(['create', 'adopt'] as const).map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={way === option}
              onClick={() => {
                if (way !== option) onWayChange(option);
              }}
              className={cn(CHOICE_CLASS, way === option && CHOSEN_CLASS)}
            >
              {t(`ways.${option}`)}
            </button>
          ))}
        </div>

        {way === 'create' ? (
          <div className="grid gap-4">
            <p className="text-small text-muted-foreground">{t('createHint')}</p>
            <PayerAccountFields
              accounts={accounts}
              categories={categories}
              accountId={accountId}
              categoryId={categoryId}
              accountError={fieldErrors.account ? t('errors.account') : undefined}
              categoryError={fieldErrors.category ? t('errors.category') : undefined}
              onAccountChange={onAccountChange}
              onCategoryChange={onCategoryChange}
            />
          </div>
        ) : (
          <div className="grid gap-3">
            <p className="text-small text-muted-foreground">{t('adoptHint')}</p>
            {candidates.kind === 'loading' ? (
              <p role="status" className="text-small">
                {t('loadingCandidates')}
              </p>
            ) : null}
            {candidates.kind === 'failed' ? (
              <div className="grid gap-2">
                <p role="alert" className="text-small text-destructive">
                  {t('candidatesFailed')}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  className="w-fit"
                  onClick={onRetryCandidates}
                >
                  {t('retry')}
                </Button>
              </div>
            ) : null}
            {candidates.kind === 'ready' && candidates.items.length === 0 ? (
              <div className="grid gap-2">
                <p className="text-small">{t('noCandidates')}</p>
                <Button
                  type="button"
                  variant="outline"
                  className="w-fit"
                  onClick={() => {
                    onWayChange('create');
                  }}
                >
                  {t('useCreate')}
                </Button>
              </div>
            ) : null}
            {candidates.kind === 'ready' && candidates.items.length > 0 ? (
              <div role="radiogroup" aria-label={t('candidatesLabel')} className="grid gap-2">
                {candidates.items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    role="radio"
                    aria-checked={movementId === item.id}
                    onClick={() => {
                      onMovementChange(item.id);
                    }}
                    className={cn(
                      CHOICE_CLASS,
                      'flex-col items-start gap-0.5 py-2',
                      movementId === item.id && CHOSEN_CLASS,
                    )}
                  >
                    <span className="break-words">{item.title}</span>
                    <span className="text-caption break-words opacity-80">{item.detail}</span>
                  </button>
                ))}
              </div>
            ) : null}
            {fieldErrors.movement ? (
              <p role="alert" className="text-small text-destructive">
                {t('errors.movement')}
              </p>
            ) : null}
          </div>
        )}

        <Button type="submit" disabled={pending}>
          {pending ? t('pending') : t('submit')}
        </Button>
      </form>
    </div>
  );
}

'use client';

import {
  MOVEMENT_NOTE_MAX_LENGTH,
  OPENING_BALANCE_LIMIT_MINOR_UNITS,
  formatMoney,
  parseAmountInput,
  type AccountResponse,
  type SetAccountBalanceRequest,
} from '@pesly/shared';
import { CircleAlert } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type SubmitEvent } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MoneyInput } from '@/components/ui/money-input';
import type { Locale } from '@/i18n/routing';
import {
  balanceDifference,
  buildSetBalanceRequest,
  type SetBalanceFieldError,
} from '../set-balance-request';
import { AccountField } from './account-field';

/**
 * Where the 2FA status stands: the code field exists only for `enabled`, and confirming waits for the
 * status (`loading`) and is impossible when it could not be read (`unavailable`).
 */
export type SetBalanceTwoFactor = 'loading' | 'enabled' | 'disabled' | 'unavailable';

/** What the API refused, already mapped by the container; `message` is a full catalog path. */
export interface SetBalanceFailure {
  field: 'balance' | 'code' | 'form';
  message: string;
}

export interface SetBalanceDialogProps {
  account: AccountResponse;
  twoFactor: SetBalanceTwoFactor;
  online: boolean;
  /** The request is in flight: confirm waits, so a double click sends one request. */
  pending: boolean;
  failure: SetBalanceFailure | undefined;
  onConfirm: (request: SetAccountBalanceRequest) => void;
  onCancel: () => void;
}

/**
 * Sets the balance an account should have. The difference shown is a preview: the server computes
 * the stored adjustment from the balance it finds under its own lock. The dialog is inline (no modal
 * primitive in the app): focus moves to the target on open and back to the element that had it on close.
 */
export function SetBalanceDialog({
  account,
  twoFactor,
  online,
  pending,
  failure,
  onConfirm,
  onCancel,
}: SetBalanceDialogProps) {
  const t = useTranslations('accounts.setBalance');
  const tActions = useTranslations('accounts.actions');
  const tAll = useTranslations();
  const locale: Locale = useLocale() === 'en' ? 'en' : 'es';
  const base = useId();
  const targetRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [note, setNote] = useState('');
  const [code, setCode] = useState('');
  const [submitError, setSubmitError] = useState<SetBalanceFieldError | undefined>();

  useEffect(() => {
    const opener = document.activeElement;
    targetRef.current?.focus();
    return () => {
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, []);

  useEffect(() => {
    if (failure?.field === 'code') codeRef.current?.focus();
  }, [failure]);

  const asksCode = twoFactor === 'enabled';
  const limit = formatMoney(OPENING_BALANCE_LIMIT_MINOR_UNITS, account.currency, locale);
  const live = buildSetBalanceRequest({ text, locale });
  const target = live.request === undefined ? null : parseAmountInput(text, locale);
  const difference = target === null ? null : balanceDifference(BigInt(account.balance), target);
  const noDifference = difference === 0n;

  // An empty target is not an error yet: the user has not typed anything to correct.
  const liveBalanceError =
    text.trim() !== '' && live.error?.field === 'balance' ? live.error : undefined;
  const balanceError =
    liveBalanceError?.message ??
    (submitError?.field === 'balance' ? submitError.message : undefined) ??
    (failure?.field === 'balance' ? failure.message : undefined);
  const noteError = submitError?.field === 'note' ? submitError.message : undefined;
  const codeError =
    (submitError?.field === 'code' ? submitError.message : undefined) ??
    (failure?.field === 'code' ? failure.message : undefined);

  const canConfirm =
    online &&
    !pending &&
    (twoFactor === 'disabled' || (asksCode && code.trim() !== '')) &&
    difference !== null &&
    !noDifference;

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canConfirm) return;
    const built = buildSetBalanceRequest({
      text,
      locale,
      note,
      code: asksCode ? code : undefined,
    });
    if (built.request === undefined) {
      setSubmitError(built.error);
      return;
    }
    setSubmitError(undefined);
    onConfirm(built.request);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLFormElement>) {
    if (event.key === 'Escape' && !pending) {
      event.preventDefault();
      onCancel();
    }
  }

  return (
    <form
      role="dialog"
      aria-labelledby={`${base}-title`}
      aria-describedby={`${base}-description`}
      className="grid gap-3 rounded-card border border-border bg-card p-4"
      noValidate
      onSubmit={handleSubmit}
      onKeyDown={handleKeyDown}
    >
      <h3 id={`${base}-title`} className="text-body font-medium">
        {t('title', { name: account.name })}
      </h3>
      <p id={`${base}-description`} className="text-small text-muted-foreground">
        {t('description')}
      </p>
      <p className="text-small">
        {t('current', { amount: formatMoney(BigInt(account.balance), account.currency, locale) })}
      </p>
      <AccountField label={t('target')} hint={t('targetHint')} error={balanceError} max={limit}>
        {(control) => (
          <MoneyInput
            ref={targetRef}
            name="balance"
            allowNegative
            value={text}
            onChange={(event) => {
              setText(event.currentTarget.value);
              setSubmitError(undefined);
            }}
            {...control}
          />
        )}
      </AccountField>
      {difference === null ? null : (
        <p className="text-small" aria-live="polite">
          {noDifference
            ? t('noDifference')
            : t('difference', {
                amount: `${difference > 0n ? '+' : ''}${formatMoney(difference, account.currency, locale)}`,
              })}
        </p>
      )}
      <AccountField label={t('note')} error={noteError}>
        {(control) => (
          <Input
            name="note"
            type="text"
            autoComplete="off"
            maxLength={MOVEMENT_NOTE_MAX_LENGTH}
            value={note}
            onChange={(event) => {
              setNote(event.currentTarget.value);
              setSubmitError(undefined);
            }}
            {...control}
          />
        )}
      </AccountField>
      {asksCode ? (
        <AccountField label={t('code')} hint={t('codeHint')} error={codeError}>
          {(control) => (
            <Input
              ref={codeRef}
              name="code"
              type="text"
              autoComplete="one-time-code"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={16}
              value={code}
              onChange={(event) => {
                setCode(event.currentTarget.value);
                setSubmitError(undefined);
              }}
              {...control}
            />
          )}
        </AccountField>
      ) : null}
      {failure?.field === 'form' ? (
        <Alert variant="destructive">
          <CircleAlert aria-hidden />
          <AlertDescription>{tAll(failure.message)}</AlertDescription>
        </Alert>
      ) : null}
      {online ? null : (
        <p role="status" className="text-small text-muted-foreground">
          {t('offline')}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={!canConfirm}>
          {t('confirm')}
        </Button>
        <Button type="button" variant="outline" disabled={pending} onClick={onCancel}>
          {tActions('cancel')}
        </Button>
      </div>
    </form>
  );
}

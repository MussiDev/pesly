'use client';

import { ACCOUNT_NAME_MAX_LENGTH, type AccountResponse } from '@pesly/shared';
import { CircleAlert } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useId, useRef, type SubmitEvent } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ListRow } from '@/components/ui/list-row';
import { readField } from '@/features/auth/read-field';
import type { Locale } from '@/i18n/routing';
import type { AccountFieldMessage } from '../account-form-errors';
import { MinorAmount } from './accounts-headline';

export interface AccountRowProps {
  account: AccountResponse;
  /** An action is in flight: the row buttons and the setting wait. */
  pending: boolean;
  editing: boolean;
  confirmingDelete: boolean;
  /** The API refused to delete this account because it has movements. */
  blockedDelete: boolean;
  renameError: AccountFieldMessage | undefined;
  onToggleAvailable: (id: string, value: boolean) => void;
  onStartRename: (id: string) => void;
  onCancelRename: () => void;
  onRename: (id: string, name: string) => void;
  onArchive: (id: string) => void;
  onUnarchive: (id: string) => void;
  onAskDelete: (id: string) => void;
  onCancelDelete: () => void;
  onConfirmDelete: (id: string) => void;
}

interface RenameFormProps {
  account: AccountResponse;
  pending: boolean;
  error: AccountFieldMessage | undefined;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}

function RenameForm({ account, pending, error, onSubmit, onCancel }: RenameFormProps) {
  const t = useTranslations('accounts');
  const tAll = useTranslations();
  const messageId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit(readField(event.currentTarget, 'name'));
  }

  return (
    <form className="grid gap-2" noValidate onSubmit={handleSubmit}>
      <Input
        ref={inputRef}
        name="name"
        type="text"
        autoComplete="off"
        defaultValue={account.name}
        aria-label={t('actions.renameField', { name: account.name })}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? messageId : undefined}
      />
      {error ? (
        <p id={messageId} className="text-small text-destructive">
          {tAll(error, { max: ACCOUNT_NAME_MAX_LENGTH })}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {t('actions.save')}
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={onCancel}>
          {t('actions.cancel')}
        </Button>
      </div>
    </form>
  );
}

/** One account: name, type, balance, the include-in-available setting and the row actions. */
export function AccountRow(props: AccountRowProps) {
  const { account, pending, editing, confirmingDelete, blockedDelete, renameError } = props;
  const t = useTranslations('accounts');
  const tErrors = useTranslations('errors');
  const locale: Locale = useLocale() === 'en' ? 'en' : 'es';
  const settingId = useId();
  const nameId = useId();
  // The setting exists only for active accounts that hold money (cards are debt, FR-04/FR-06).
  const hasSetting = !account.archived && account.type !== 'credit_card';

  return (
    <li aria-label={account.name} className="grid gap-2 py-2 text-card-foreground">
      <ListRow
        title={<span id={nameId}>{account.name}</span>}
        description={t(`types.${account.type}`)}
        trailing={
          <div className="flex flex-col items-end gap-1">
            <MinorAmount
              value={account.balance}
              currency={account.currency}
              locale={locale}
              className="text-body font-semibold"
            />
            <Badge variant="outline">{account.currency}</Badge>
          </div>
        }
      />
      {hasSetting ? (
        <div className="flex min-h-11 items-center gap-2">
          <Checkbox
            id={settingId}
            checked={account.includeInAvailable}
            // Not `disabled`: that would drop keyboard focus while the request runs.
            aria-disabled={pending}
            // One name from two existing elements, so the visible label text stays the catalog string.
            aria-labelledby={`${settingId}-label ${nameId}`}
            onChange={(event) => {
              if (pending) return;
              props.onToggleAvailable(account.id, event.currentTarget.checked);
            }}
          />
          <Label
            id={`${settingId}-label`}
            htmlFor={settingId}
            className="min-h-11 flex-1 cursor-pointer items-center text-small text-muted-foreground"
          >
            {t('fields.includeInAvailable')}
          </Label>
        </div>
      ) : null}
      {editing ? (
        <RenameForm
          account={account}
          pending={pending}
          error={renameError}
          onSubmit={(name) => {
            props.onRename(account.id, name);
          }}
          onCancel={props.onCancelRename}
        />
      ) : confirmingDelete ? (
        <div className="grid gap-2">
          <p role="status" className="text-small">
            {t('actions.confirmDelete', { name: account.name })}
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              className="text-destructive"
              disabled={pending}
              onClick={() => {
                props.onConfirmDelete(account.id);
              }}
            >
              {t('actions.confirmDeleteYes')}
            </Button>
            <Button size="sm" variant="outline" disabled={pending} onClick={props.onCancelDelete}>
              {t('actions.cancel')}
            </Button>
          </div>
        </div>
      ) : (
        <>
          {blockedDelete ? (
            <Alert variant="destructive">
              <CircleAlert aria-hidden />
              <AlertDescription>
                {tErrors('accountHasMovements')}
                {account.archived ? null : (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() => {
                      props.onArchive(account.id);
                    }}
                  >
                    {t('actions.archiveInstead')}
                  </Button>
                )}
              </AlertDescription>
            </Alert>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => {
                props.onStartRename(account.id);
              }}
            >
              {t('actions.rename')}
              <span className="sr-only"> {account.name}</span>
            </Button>
            {account.archived ? (
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => {
                  props.onUnarchive(account.id);
                }}
              >
                {t('actions.unarchive')}
                <span className="sr-only"> {account.name}</span>
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => {
                  props.onArchive(account.id);
                }}
              >
                {t('actions.archive')}
                <span className="sr-only"> {account.name}</span>
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => {
                props.onAskDelete(account.id);
              }}
            >
              {t('actions.delete')}
              <span className="sr-only"> {account.name}</span>
            </Button>
          </div>
        </>
      )}
    </li>
  );
}

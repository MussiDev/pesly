'use client';

import {
  ACCOUNT_NAME_MAX_LENGTH,
  OPENING_BALANCE_LIMIT_MINOR_UNITS,
  formatMoney,
  parseAmountInput,
  type AccountCurrency,
  type AccountResponse,
  type AccountType,
} from '@pesly/shared';
import {
  Archive,
  ArchiveRestore,
  Banknote,
  CircleAlert,
  Coins,
  CreditCard,
  Landmark,
  Pencil,
  PiggyBank,
  Smartphone,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState, type SubmitEvent } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { IconAction } from '@/components/ui/icon-action';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MoneyInput } from '@/components/ui/money-input';
import { readField } from '@/features/auth/read-field';
import type { Locale } from '@/i18n/routing';
import type { AccountFieldMessage } from '../account-form-errors';
import { AccountField } from './account-field';
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
  editingOpening: boolean;
  openingError: AccountFieldMessage | undefined;
  onToggleAvailable: (id: string, value: boolean) => void;
  onStartRename: (id: string) => void;
  onCancelRename: () => void;
  onRename: (id: string, name: string) => void;
  onStartEditOpening: (id: string) => void;
  onCancelEditOpening: () => void;
  /** The typed text, untouched: the container parses and validates it. */
  onSetOpening: (id: string, text: string) => void;
  onArchive: (id: string) => void;
  onUnarchive: (id: string) => void;
  onAskDelete: (id: string) => void;
  onCancelDelete: () => void;
  onConfirmDelete: (id: string) => void;
}

const TYPE_ICONS: Record<AccountType, LucideIcon> = {
  cash: Banknote,
  bank_account: Landmark,
  digital_wallet: Smartphone,
  credit_card: CreditCard,
  savings: PiggyBank,
};

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

interface OpeningBalanceFormProps {
  account: AccountResponse;
  locale: Locale;
  pending: boolean;
  error: AccountFieldMessage | undefined;
  onSubmit: (text: string) => void;
  onCancel: () => void;
}

/** A saved amount as typed text: no grouping, so the field parses it back to the same figure. */
function typedAmount(minorUnits: string, locale: Locale): string {
  const value = BigInt(minorUnits);
  const abs = value < 0n ? -value : value;
  const separator = locale === 'es' ? ',' : '.';
  const fraction = (abs % 100n).toString().padStart(2, '0');
  return `${value < 0n ? '-' : ''}${(abs / 100n).toString()}${separator}${fraction}`;
}

function OpeningBalanceForm({
  account,
  locale,
  pending,
  error,
  onSubmit,
  onCancel,
}: OpeningBalanceFormProps) {
  const t = useTranslations('accounts');
  const inputRef = useRef<HTMLInputElement>(null);
  const [typed, setTyped] = useState(typedAmount(account.openingBalance, locale));
  const currency: AccountCurrency = account.currency;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Preview only: the stored balance moves by the difference, as the API computes it.
  const next = parseAmountInput(typed, locale);
  const previewBalance =
    next === null ? null : BigInt(account.balance) - BigInt(account.openingBalance) + next;

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit(readField(event.currentTarget, 'openingBalance'));
  }

  return (
    <form className="grid gap-3" noValidate onSubmit={handleSubmit}>
      <p className="text-small text-muted-foreground">
        {t('openingEdit.current', {
          amount: formatMoney(BigInt(account.openingBalance), currency, locale),
        })}
      </p>
      <AccountField
        label={t('openingEdit.field', { name: account.name })}
        hint={t('openingEdit.hint')}
        error={error}
        max={formatMoney(OPENING_BALANCE_LIMIT_MINOR_UNITS, currency, locale)}
      >
        {(control) => (
          <MoneyInput
            ref={inputRef}
            name="openingBalance"
            allowNegative
            value={typed}
            onChange={(event) => {
              setTyped(event.currentTarget.value);
            }}
            {...control}
          />
        )}
      </AccountField>
      {previewBalance === null ? null : (
        <p className="text-small" aria-live="polite">
          {t('openingEdit.preview', { amount: formatMoney(previewBalance, currency, locale) })}
        </p>
      )}
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

/**
 * One account as a card: its type icon, name and currency on top, the balance on its own line so a
 * large figure has the full width and wraps instead of running into the badge, then the
 * include-in-available setting and the row actions.
 */
export function AccountRow(props: AccountRowProps) {
  const {
    account,
    pending,
    editing,
    editingOpening,
    confirmingDelete,
    blockedDelete,
    renameError,
    openingError,
  } = props;
  const t = useTranslations('accounts');
  const tErrors = useTranslations('errors');
  const locale: Locale = useLocale() === 'en' ? 'en' : 'es';
  const settingId = useId();
  const nameId = useId();
  const TypeIcon = TYPE_ICONS[account.type];
  // The setting exists only for active accounts that hold money (cards are debt, FR-04/FR-06).
  const hasSetting = !account.archived && account.type !== 'credit_card';

  return (
    <li
      aria-label={account.name}
      className="grid min-w-0 content-start gap-3 rounded-card bg-card p-5 text-card-foreground shadow-xs"
    >
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className="inline-flex size-10 shrink-0 items-center justify-center rounded-pill bg-accent text-accent-foreground [&_svg]:size-5"
        >
          <TypeIcon />
        </span>
        <div className="grid min-w-0 flex-1 gap-0.5">
          <span id={nameId} className="truncate text-body font-medium">
            {account.name}
          </span>
          <span className="truncate text-small text-muted-foreground">
            {t(`types.${account.type}`)}
          </span>
        </div>
        <Badge variant="outline">{account.currency}</Badge>
      </div>
      <MinorAmount
        value={account.balance}
        currency={account.currency}
        locale={locale}
        className="text-heading break-words whitespace-normal"
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
      ) : editingOpening ? (
        <OpeningBalanceForm
          account={account}
          locale={locale}
          pending={pending}
          error={openingError}
          onSubmit={(text) => {
            props.onSetOpening(account.id, text);
          }}
          onCancel={props.onCancelEditOpening}
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
          <div className="flex items-center justify-end gap-1 border-t border-border/70 pt-2">
            <IconAction
              label={t('actions.rename')}
              subject={account.name}
              icon={<Pencil aria-hidden />}
              disabled={pending}
              onClick={() => {
                props.onStartRename(account.id);
              }}
            />
            <IconAction
              label={t('actions.editOpeningBalance')}
              subject={account.name}
              icon={<Coins aria-hidden />}
              disabled={pending}
              onClick={() => {
                props.onStartEditOpening(account.id);
              }}
            />
            {account.archived ? (
              <IconAction
                label={t('actions.unarchive')}
                subject={account.name}
                icon={<ArchiveRestore aria-hidden />}
                disabled={pending}
                onClick={() => {
                  props.onUnarchive(account.id);
                }}
              />
            ) : (
              <IconAction
                label={t('actions.archive')}
                subject={account.name}
                icon={<Archive aria-hidden />}
                disabled={pending}
                onClick={() => {
                  props.onArchive(account.id);
                }}
              />
            )}
            <IconAction
              label={t('actions.delete')}
              subject={account.name}
              icon={<Trash2 aria-hidden />}
              disabled={pending}
              onClick={() => {
                props.onAskDelete(account.id);
              }}
            />
          </div>
        </>
      )}
    </li>
  );
}

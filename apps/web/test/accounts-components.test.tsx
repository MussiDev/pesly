// @vitest-environment happy-dom
import {
  ACCOUNT_CURRENCIES,
  ACCOUNT_NAME_MAX_LENGTH,
  ACCOUNT_TYPES,
  defaultIncludeInAvailable,
  formatMoney,
  type AccountResponse,
} from '@pesly/shared';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import en from '../messages/en.json';
import es from '../messages/es.json';
import { AccountForm } from '../src/features/accounts/components/account-form';
import { AccountsHeadline } from '../src/features/accounts/components/accounts-headline';
import {
  AccountList,
  type AccountListProps,
} from '../src/features/accounts/components/account-list';
import { AccountsLoadStateView } from '../src/features/accounts/components/accounts-load-state';
import {
  nameErrorMessage,
  type AccountFormErrors,
} from '../src/features/accounts/account-form-errors';

afterEach(cleanup);

const CATALOGS = { es, en } as const;

function renderIntl(ui: ReactElement, locale: 'es' | 'en' = 'es') {
  return render(
    <NextIntlClientProvider locale={locale} timeZone="UTC" messages={CATALOGS[locale]}>
      {ui}
    </NextIntlClientProvider>,
  );
}

function markup(element: ReactElement): string {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="es" timeZone="UTC" messages={es}>
      {element}
    </NextIntlClientProvider>,
  );
}

/** Intl uses no-break spaces; Testing Library collapses them, so expectations do too. */
function money(value: bigint, currency: 'ARS' | 'USD', locale: 'es' | 'en'): string {
  return formatMoney(value, currency, locale).replace(/\s+/g, ' ');
}

function account(overrides: Partial<AccountResponse> = {}): AccountResponse {
  return {
    id: 'a1',
    name: 'Caja',
    type: 'cash',
    currency: 'ARS',
    openingBalance: '0',
    balance: '150000',
    includeInAvailable: true,
    archived: false,
    archivedAt: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

const noop = () => undefined;

// The type scale tokens, smallest to largest.
const TEXT_SIZES = [
  'text-caption',
  'text-small',
  'text-body',
  'text-heading',
  'text-title',
  'text-display',
];

/** The Tailwind type-size rank of an element, so a test compares sizes without hardcoding one. */
function sizeRank(element: Element): number {
  const sizes = [...element.classList]
    .map((name) => TEXT_SIZES.indexOf(name))
    .filter((i) => i >= 0);
  return sizes.length === 0 ? -1 : Math.max(...sizes);
}

/** The value (`dd`) shown next to a headline label inside a currency's group. */
function metric(locale: 'es' | 'en', currency: 'ARS' | 'USD', label: string): HTMLElement {
  const group = screen.getByRole('group', { name: CATALOGS[locale].accounts.currencies[currency] });
  const value = within(group).getByText(label).nextElementSibling;
  if (!(value instanceof HTMLElement)) throw new Error(`no value next to ${label}`);
  return value;
}

function listProps(overrides: Partial<AccountListProps> = {}): AccountListProps {
  return {
    accounts: [account()],
    availableTotals: { ARS: '150000', USD: '0' },
    netWorthTotals: { ARS: '150000', USD: '0' },
    debtTotals: { ARS: '0', USD: '0' },
    creditCardCount: 0,
    showArchived: false,
    pending: false,
    editingId: undefined,
    confirmingDeleteId: undefined,
    blockedDeleteId: undefined,
    renameError: undefined,
    actionError: undefined,
    onToggleArchived: noop,
    onToggleAvailable: noop,
    onStartRename: noop,
    onCancelRename: noop,
    onRename: noop,
    onArchive: noop,
    onUnarchive: noop,
    onAskDelete: noop,
    onCancelDelete: noop,
    onConfirmDelete: noop,
    ...overrides,
  };
}

describe('AccountForm', () => {
  it('offers exactly the five account types and the two currencies (AC-03)', () => {
    renderIntl(<AccountForm pending={false} errors={{}} onSubmit={noop} />);

    const type = screen.getByLabelText(es.accounts.fields.type);
    const typeOptions = within(type).getAllByRole<HTMLOptionElement>('option');
    expect(typeOptions.filter((option) => option.value !== '').map((o) => o.value)).toEqual([
      ...ACCOUNT_TYPES,
    ]);
    expect(typeOptions.filter((o) => o.value !== '').map((o) => o.textContent)).toEqual([
      es.accounts.types.cash,
      es.accounts.types.bank_account,
      es.accounts.types.digital_wallet,
      es.accounts.types.credit_card,
      es.accounts.types.savings,
    ]);

    const currency = screen.getByLabelText(es.accounts.fields.currency);
    const currencyOptions = within(currency).getAllByRole<HTMLOptionElement>('option');
    expect(currencyOptions.filter((o) => o.value !== '').map((o) => o.value)).toEqual([
      ...ACCOUNT_CURRENCIES,
    ]);
  });

  it('starts with no type or currency chosen and the opening balance pre-filled with 0 (AC-16)', () => {
    renderIntl(<AccountForm pending={false} errors={{}} onSubmit={noop} />);

    expect(screen.getByLabelText<HTMLSelectElement>(es.accounts.fields.type).value).toBe('');
    expect(screen.getByLabelText<HTMLSelectElement>(es.accounts.fields.currency).value).toBe('');
    expect(screen.getByLabelText<HTMLInputElement>(es.accounts.fields.openingBalance).value).toBe(
      '0',
    );
  });

  it('hands the raw field values to onSubmit', async () => {
    const onSubmit = vi.fn();
    renderIntl(<AccountForm pending={false} errors={{}} onSubmit={onSubmit} />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(es.accounts.fields.name), 'Caja chica');
    await user.selectOptions(screen.getByLabelText(es.accounts.fields.type), 'savings');
    await user.selectOptions(screen.getByLabelText(es.accounts.fields.currency), 'USD');
    await user.clear(screen.getByLabelText(es.accounts.fields.openingBalance));
    await user.type(screen.getByLabelText(es.accounts.fields.openingBalance), '-1.500,00');
    await user.click(screen.getByRole('button', { name: es.accounts.form.submit }));

    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({
      name: 'Caja chica',
      type: 'savings',
      currency: 'USD',
      openingBalance: '-1.500,00',
      includeInAvailable: false,
    });
  });

  it('disables the submit button while pending', () => {
    renderIntl(<AccountForm pending errors={{}} onSubmit={noop} />);

    expect(
      screen.getByRole('button', { name: es.accounts.form.pending }).hasAttribute('disabled'),
    ).toBe(true);
  });

  it('shows the form-level error in an alert', () => {
    renderIntl(<AccountForm pending={false} errors={{ form: 'network' }} onSubmit={noop} />);

    expect(screen.getByRole('alert').textContent).toContain(es.errors.network);
  });
});

const INVALID: AccountFormErrors = {
  fields: {
    name: 'accounts.errors.nameRequired',
    type: 'accounts.errors.typeRequired',
    currency: 'accounts.errors.currencyRequired',
    openingBalance: 'accounts.errors.amountInvalid',
  },
};

function describedByIds(html: string): string[] {
  return [...html.matchAll(/aria-describedby="([^"]*)"/g)].flatMap(([, ids = '']) =>
    ids.split(' ').filter(Boolean),
  );
}

describe('AccountForm accessibility', () => {
  it('leaves validation messages to the catalogs', () => {
    expect(markup(<AccountForm pending={false} errors={{}} onSubmit={noop} />)).toMatch(
      /<form[^>]* novalidate=""/i,
    );
  });

  it('only points aria-describedby at ids that exist', () => {
    for (const errors of [{}, INVALID]) {
      const html = markup(<AccountForm pending={false} errors={errors} onSubmit={noop} />);

      for (const id of describedByIds(html)) {
        expect(html, `aria-describedby points at missing #${id}`).toContain(`id="${id}"`);
      }
    }
  });

  it('marks each invalid field and describes it with its message', () => {
    renderIntl(<AccountForm pending={false} errors={INVALID} onSubmit={noop} />);

    const expected: [string, string][] = [
      [es.accounts.fields.name, es.accounts.errors.nameRequired],
      [es.accounts.fields.type, es.accounts.errors.typeRequired],
      [es.accounts.fields.currency, es.accounts.errors.currencyRequired],
      [es.accounts.fields.openingBalance, es.accounts.errors.amountInvalid],
    ];
    for (const [label, message] of expected) {
      const control = screen.getByLabelText(label);
      expect(control.getAttribute('aria-invalid')).toBe('true');
      const ids = (control.getAttribute('aria-describedby') ?? '').split(' ');
      const texts = ids.map((id) => document.getElementById(id)?.textContent);
      expect(texts).toContain(message);
    }
  });

  it('moves focus to the first invalid field', () => {
    renderIntl(<AccountForm pending={false} errors={INVALID} onSubmit={noop} />);

    expect(document.activeElement).toBe(screen.getByLabelText(es.accounts.fields.name));
  });

  it('shows the duplicate-name message from the errors catalog on the name field', () => {
    renderIntl(
      <AccountForm
        pending={false}
        errors={{ fields: { name: 'errors.accountNameTaken' } }}
        onSubmit={noop}
      />,
    );

    const name = screen.getByLabelText(es.accounts.fields.name);
    expect(name.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText(es.errors.accountNameTaken)).toBeDefined();
  });
});

describe('nameErrorMessage', () => {
  const ZWSP = '\u200B';
  const RLO = '\u202E';

  it('answers invalid characters for visible text next to a control or format character (AC-20)', () => {
    expect(nameErrorMessage(`Caja${ZWSP}${RLO}`)).toBe('accounts.errors.nameInvalidCharacters');
    expect(nameErrorMessage(`Ca${ZWSP}ja`)).toBe('accounts.errors.nameInvalidCharacters');
    expect(nameErrorMessage('Caja\u0000')).toBe('accounts.errors.nameInvalidCharacters');
    expect(nameErrorMessage('Caja\u00AD')).toBe('accounts.errors.nameInvalidCharacters');
  });

  it('answers invalid characters when trim would hide the control or format character', () => {
    expect(nameErrorMessage('\uFEFFCaja')).toBe('accounts.errors.nameInvalidCharacters');
    expect(nameErrorMessage('Caja\n')).toBe('accounts.errors.nameInvalidCharacters');
    expect(nameErrorMessage('\tCaja')).toBe('accounts.errors.nameInvalidCharacters');
  });

  it('answers required when nothing visible is left (AC-21)', () => {
    expect(nameErrorMessage(`${ZWSP}${ZWSP}`)).toBe('accounts.errors.nameRequired');
    expect(nameErrorMessage(`${RLO}\u200D\uFEFF`)).toBe('accounts.errors.nameRequired');
    expect(nameErrorMessage('   ')).toBe('accounts.errors.nameRequired');
    expect(nameErrorMessage('')).toBe('accounts.errors.nameRequired');
  });

  it('answers too long above 50 code points, counting an emoji once', () => {
    expect(nameErrorMessage('x'.repeat(51))).toBe('accounts.errors.nameTooLong');
    expect(nameErrorMessage('\u{1F4B0}'.repeat(51))).toBe('accounts.errors.nameTooLong');
  });
});

describe('AccountForm new messages', () => {
  it('shows the invalid-characters message on the name field', () => {
    renderIntl(
      <AccountForm
        pending={false}
        errors={{ fields: { name: 'accounts.errors.nameInvalidCharacters' } }}
        onSubmit={noop}
      />,
    );

    expect(screen.getByText(es.accounts.errors.nameInvalidCharacters)).toBeDefined();
    expect(screen.getByLabelText(es.accounts.fields.name).getAttribute('aria-invalid')).toBe(
      'true',
    );
  });

  it('interpolates the formatted limit into the out-of-range message', () => {
    const limit = money(10n ** 15n, 'ARS', 'es');
    renderIntl(
      <AccountForm
        pending={false}
        errors={{
          fields: { openingBalance: 'accounts.errors.amountOutOfRange' },
          openingBalanceLimit: limit,
        }}
        onSubmit={noop}
      />,
    );

    const control = screen.getByLabelText(es.accounts.fields.openingBalance);
    expect(control.getAttribute('aria-invalid')).toBe('true');
    const ids = (control.getAttribute('aria-describedby') ?? '').split(' ');
    const texts = ids.map((id) => document.getElementById(id)?.textContent.replace(/\s+/g, ' '));
    expect(texts).toContain(es.accounts.errors.amountOutOfRange.replace('{max}', limit));
  });
});

describe('accounts error copy', () => {
  it('has the two new messages in both languages, the amount one with the {max} slot', () => {
    for (const catalog of [es, en]) {
      expect(catalog.accounts.errors.nameInvalidCharacters.length).toBeGreaterThan(0);
      expect(catalog.accounts.errors.amountOutOfRange).toContain('{max}');
    }
    expect(es.accounts.errors.nameInvalidCharacters).not.toBe(
      en.accounts.errors.nameInvalidCharacters,
    );
  });
});

describe('AccountList soft-card shapes (AC-34)', () => {
  it('draws each account as a rounded card without a border, with a circular type icon', () => {
    renderIntl(
      <AccountList
        {...listProps({ accounts: [account({ id: 'a1', name: 'Caja', currency: 'ARS' })] })}
      />,
    );

    const card = screen.getByRole('listitem', { name: 'Caja' });
    expect(card.className).toMatch(/rounded-card/);
    expect(card.className).not.toMatch(/(^|\s)border(\s|$)/);
    expect(card.querySelector('.rounded-pill')).not.toBeNull();
  });
});

describe('AccountList', () => {
  it('shows each balance and the headline totals formatted for the active locale (AC-14, AC-16)', () => {
    const accounts = [
      account({ id: 'a1', name: 'Caja', currency: 'ARS', balance: '150000' }),
      account({ id: 'a2', name: 'Dolares', currency: 'USD', balance: '-2550' }),
    ];
    for (const locale of ['es', 'en'] as const) {
      renderIntl(
        <AccountList
          {...listProps({
            accounts,
            availableTotals: { ARS: '150000', USD: '-2550' },
            netWorthTotals: { ARS: '140000', USD: '-3000' },
          })}
        />,
        locale,
      );
      const catalog = CATALOGS[locale].accounts.headline;

      const pesos = screen.getByRole('listitem', { name: 'Caja' });
      expect(within(pesos).getByText(money(150000n, 'ARS', locale))).toBeDefined();
      const dollars = screen.getByRole('listitem', { name: 'Dolares' });
      expect(within(dollars).getByText(money(-2550n, 'USD', locale))).toBeDefined();

      expect(metric(locale, 'ARS', catalog.available).textContent).toBe(
        formatMoney(150000n, 'ARS', locale),
      );
      expect(metric(locale, 'ARS', catalog.netWorth).textContent).toBe(
        formatMoney(140000n, 'ARS', locale),
      );
      expect(metric(locale, 'USD', catalog.available).textContent).toBe(
        formatMoney(-2550n, 'USD', locale),
      );
      expect(metric(locale, 'USD', catalog.netWorth).textContent).toBe(
        formatMoney(-3000n, 'USD', locale),
      );
      cleanup();
    }
    expect(money(150000n, 'ARS', 'es')).not.toBe(money(150000n, 'ARS', 'en'));
  });

  it('formats balances and totals beyond int64 without throwing (AC-17, NFR-01)', () => {
    const accounts = [
      account({ id: 'a1', name: 'Caja', currency: 'ARS', balance: '9223372036854775808' }),
    ];
    for (const locale of ['es', 'en'] as const) {
      renderIntl(
        <AccountList
          {...listProps({
            accounts,
            availableTotals: { ARS: '9300000000000000000', USD: '0' },
            netWorthTotals: { ARS: '9300000000000000000', USD: '0' },
          })}
        />,
        locale,
      );
      const row = screen.getByRole('listitem', { name: 'Caja' });
      expect(within(row).getByText(money(9223372036854775808n, 'ARS', locale))).toBeDefined();
      expect(metric(locale, 'ARS', CATALOGS[locale].accounts.headline.available).textContent).toBe(
        formatMoney(9300000000000000000n, 'ARS', locale),
      );
      cleanup();
    }
  });

  it('shows the type of each account through the catalog', () => {
    renderIntl(<AccountList {...listProps({ accounts: [account({ type: 'digital_wallet' })] })} />);

    expect(screen.getByText(es.accounts.types.digital_wallet)).toBeDefined();
  });

  it('shows the empty state and the link to create an account', () => {
    renderIntl(<AccountList {...listProps({ accounts: [] })} />);

    expect(screen.getByText(es.accounts.list.empty)).toBeDefined();
    const link = screen.getByRole('link', { name: es.accounts.list.newAccount });
    expect(link.getAttribute('href')).toBe('/es/accounts/new');
  });

  it('renders an account name containing markup as literal text (NFR-05)', () => {
    const name = '<img src=x onerror="alert(1)"><b>Caja</b>';
    const { container } = renderIntl(
      <AccountList {...listProps({ accounts: [account({ name })] })} />,
    );

    // The name is the row title and also the screen-reader suffix of each action.
    expect(screen.getAllByText(name).length).toBeGreaterThan(0);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
  });

  it('reports each row action with the account id', async () => {
    const handlers = {
      onStartRename: vi.fn(),
      onArchive: vi.fn(),
      onAskDelete: vi.fn(),
    };
    renderIntl(<AccountList {...listProps(handlers)} />);
    const user = userEvent.setup();
    const row = screen.getByRole('listitem', { name: 'Caja' });

    await user.click(within(row).getByRole('button', { name: /^Renombrar/ }));
    await user.click(within(row).getByRole('button', { name: /^Archivar/ }));
    await user.click(within(row).getByRole('button', { name: /^Eliminar/ }));

    expect(handlers.onStartRename).toHaveBeenCalledExactlyOnceWith('a1');
    expect(handlers.onArchive).toHaveBeenCalledExactlyOnceWith('a1');
    expect(handlers.onAskDelete).toHaveBeenCalledExactlyOnceWith('a1');
  });

  it('offers unarchive instead of archive on the archived view, with no headline, Debt section or setting (AC-12)', async () => {
    const onUnarchive = vi.fn();
    renderIntl(
      <AccountList
        {...listProps({
          showArchived: true,
          accounts: [account({ archived: true, archivedAt: '2026-10-02T00:00:00.000Z' })],
          onUnarchive,
        })}
      />,
    );
    const user = userEvent.setup();
    const row = screen.getByRole('listitem', { name: 'Caja' });

    expect(within(row).queryByRole('button', { name: /^Archivar/ })).toBeNull();
    await user.click(within(row).getByRole('button', { name: /^Desarchivar/ }));

    expect(onUnarchive).toHaveBeenCalledExactlyOnceWith('a1');
    expect(screen.queryByText(es.accounts.headline.available)).toBeNull();
    expect(screen.queryByText(es.accounts.headline.netWorth)).toBeNull();
    expect(screen.queryByText(es.accounts.debt.title)).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('toggles between the active and the archived accounts', async () => {
    const onToggleArchived = vi.fn();
    renderIntl(<AccountList {...listProps({ onToggleArchived })} />);

    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: es.accounts.list.showArchived }));

    expect(onToggleArchived).toHaveBeenCalledOnce();
    cleanup();
    renderIntl(<AccountList {...listProps({ showArchived: true, accounts: [] })} />);
    expect(screen.getByRole('button', { name: es.accounts.list.showActive })).toBeDefined();
    expect(screen.getByText(es.accounts.list.emptyArchived)).toBeDefined();
  });

  it('renames inline: the field holds the current name and reports the new one', async () => {
    const onRename = vi.fn();
    const onCancelRename = vi.fn();
    renderIntl(<AccountList {...listProps({ editingId: 'a1', onRename, onCancelRename })} />);
    const user = userEvent.setup();

    const field = screen.getByLabelText(es.accounts.actions.renameField.replace('{name}', 'Caja'));
    expect((field as HTMLInputElement).value).toBe('Caja');
    await user.clear(field);
    await user.type(field, 'Billetera');
    await user.click(screen.getByRole('button', { name: es.accounts.actions.save }));
    await user.click(screen.getByRole('button', { name: es.accounts.actions.cancel }));

    expect(onRename).toHaveBeenCalledExactlyOnceWith('a1', 'Billetera');
    expect(onCancelRename).toHaveBeenCalledOnce();
  });

  it('shows the rename error on the field', () => {
    renderIntl(
      <AccountList {...listProps({ editingId: 'a1', renameError: 'errors.accountNameTaken' })} />,
    );

    const field = screen.getByLabelText(es.accounts.actions.renameField.replace('{name}', 'Caja'));
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText(es.errors.accountNameTaken)).toBeDefined();
  });

  it('asks for confirmation before deleting', async () => {
    const onConfirmDelete = vi.fn();
    const onCancelDelete = vi.fn();
    renderIntl(
      <AccountList {...listProps({ confirmingDeleteId: 'a1', onConfirmDelete, onCancelDelete })} />,
    );
    const user = userEvent.setup();

    expect(
      screen.getByText(es.accounts.actions.confirmDelete.replace('{name}', 'Caja')),
    ).toBeDefined();
    await user.click(screen.getByRole('button', { name: es.accounts.actions.confirmDeleteYes }));
    await user.click(screen.getByRole('button', { name: es.accounts.actions.cancel }));

    expect(onConfirmDelete).toHaveBeenCalledExactlyOnceWith('a1');
    expect(onCancelDelete).toHaveBeenCalledOnce();
  });

  it('explains a blocked deletion and offers to archive instead (AC-10)', async () => {
    const onArchive = vi.fn();
    renderIntl(<AccountList {...listProps({ blockedDeleteId: 'a1', onArchive })} />);

    expect(screen.getByText(es.errors.accountHasMovements)).toBeDefined();
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: es.accounts.actions.archiveInstead }));

    expect(onArchive).toHaveBeenCalledExactlyOnceWith('a1');
  });

  it('does not offer archive instead on an already archived row', () => {
    renderIntl(
      <AccountList
        {...listProps({
          showArchived: true,
          accounts: [account({ archived: true, archivedAt: '2026-10-01T00:00:00.000Z' })],
          blockedDeleteId: 'a1',
        })}
      />,
    );

    expect(screen.getByText(es.errors.accountHasMovements)).toBeDefined();
    expect(screen.queryByRole('button', { name: es.accounts.actions.archiveInstead })).toBeNull();
  });

  it('disables the view toggle while an action is pending', () => {
    renderIntl(<AccountList {...listProps({ pending: true })} />);

    expect(
      screen.getByRole('button', { name: es.accounts.list.showArchived }).hasAttribute('disabled'),
    ).toBe(true);
  });

  it('disables the rename cancel button while pending', () => {
    renderIntl(<AccountList {...listProps({ editingId: 'a1', pending: true })} />);

    expect(
      screen.getByRole('button', { name: es.accounts.actions.cancel }).hasAttribute('disabled'),
    ).toBe(true);
  });

  it('disables the delete cancel button while pending', () => {
    renderIntl(<AccountList {...listProps({ confirmingDeleteId: 'a1', pending: true })} />);

    expect(
      screen.getByRole('button', { name: es.accounts.actions.cancel }).hasAttribute('disabled'),
    ).toBe(true);
  });

  it('announces the delete confirmation as a live region', () => {
    renderIntl(<AccountList {...listProps({ confirmingDeleteId: 'a1' })} />);

    expect(screen.getByRole('status').textContent).toBe(
      es.accounts.actions.confirmDelete.replace('{name}', 'Caja'),
    );
  });

  it('shows the name length limit from the shared constant on the rename field', () => {
    renderIntl(
      <AccountList
        {...listProps({ editingId: 'a1', renameError: 'accounts.errors.nameTooLong' })}
      />,
    );

    expect(
      screen.getByText(
        es.accounts.errors.nameTooLong.replace('{max}', String(ACCOUNT_NAME_MAX_LENGTH)),
      ),
    ).toBeDefined();
  });

  it('shows an action failure in an alert', () => {
    renderIntl(<AccountList {...listProps({ actionError: 'network' })} />);

    expect(screen.getByRole('alert').textContent).toContain(es.errors.network);
  });
});

describe('AccountsHeadline', () => {
  it('renders Available larger than Net worth for each currency with the formatted amounts (AC-14, AC-16, AC-18)', () => {
    for (const locale of ['es', 'en'] as const) {
      renderIntl(
        <AccountsHeadline
          availableTotals={{ ARS: '150000', USD: '2000' }}
          netWorthTotals={{ ARS: '-50000', USD: '2500' }}
        />,
        locale,
      );
      const labels = CATALOGS[locale].accounts.headline;

      for (const [currency, available, netWorth] of [
        ['ARS', 150000n, -50000n],
        ['USD', 2000n, 2500n],
      ] as const) {
        const availableValue = metric(locale, currency, labels.available);
        const netWorthValue = metric(locale, currency, labels.netWorth);
        expect(availableValue.textContent).toBe(formatMoney(available, currency, locale));
        expect(netWorthValue.textContent).toBe(formatMoney(netWorth, currency, locale));
        expect(sizeRank(availableValue)).toBeGreaterThan(sizeRank(netWorthValue));
        expect(sizeRank(netWorthValue)).toBeGreaterThanOrEqual(0);
      }
      cleanup();
    }
  });

  it('shows 0 Available for a currency with no included account (AC-15)', () => {
    renderIntl(
      <AccountsHeadline
        availableTotals={{ ARS: '0', USD: '0' }}
        netWorthTotals={{ ARS: '99000', USD: '0' }}
      />,
    );

    expect(metric('es', 'ARS', es.accounts.headline.available).textContent).toBe(
      formatMoney(0n, 'ARS', 'es'),
    );
    expect(metric('es', 'ARS', es.accounts.headline.netWorth).textContent).toBe(
      formatMoney(99000n, 'ARS', 'es'),
    );
  });

  it('falls back to 0 when a currency is missing from a totals map', () => {
    renderIntl(<AccountsHeadline availableTotals={{}} netWorthTotals={{}} />);

    expect(metric('es', 'USD', es.accounts.headline.available).textContent).toBe(
      formatMoney(0n, 'USD', 'es'),
    );
  });
});

describe('AccountList Debt section', () => {
  const VISA = account({
    id: 'c1',
    name: 'Visa',
    type: 'credit_card',
    balance: '-45000',
    includeInAvailable: false,
  });

  it('lists cards only under Debt with the per-currency Debt total, never in the other section (AC-19)', () => {
    const accounts = [account(), VISA];
    for (const locale of ['es', 'en'] as const) {
      renderIntl(
        <AccountList
          {...listProps({
            accounts,
            creditCardCount: 1,
            debtTotals: { ARS: '-45000', USD: '0' },
          })}
        />,
        locale,
      );
      const catalog = CATALOGS[locale].accounts;

      const debt = screen.getByRole('region', { name: catalog.debt.title });
      expect(within(debt).getByRole('listitem', { name: 'Visa' })).toBeDefined();
      expect(within(debt).queryByRole('listitem', { name: 'Caja' })).toBeNull();
      const total = within(debt).getByText(catalog.currencies.ARS).nextElementSibling;
      expect(total?.textContent).toBe(formatMoney(-45000n, 'ARS', locale));

      expect(screen.getAllByRole('listitem', { name: 'Visa' })).toHaveLength(1);
      expect(screen.getAllByRole('listitem', { name: 'Caja' })).toHaveLength(1);
      expect(debt.contains(screen.getByRole('listitem', { name: 'Caja' }))).toBe(false);
      cleanup();
    }
  });

  it('is absent when creditCardCount is 0 (AC-19)', () => {
    renderIntl(<AccountList {...listProps({ creditCardCount: 0 })} />);

    expect(screen.queryByText(es.accounts.debt.title)).toBeNull();
    // Control: the rest of the active view is there, so the absence is the rule, not a blank page.
    expect(screen.getAllByText(es.accounts.headline.available)).toHaveLength(2);
  });

  it('is present when creditCardCount is above 0 even if the page lists no card (AC-20)', () => {
    renderIntl(
      <AccountList
        {...listProps({ creditCardCount: 2, debtTotals: { ARS: '-80000', USD: '0' } })}
      />,
    );

    const debt = screen.getByRole('region', { name: es.accounts.debt.title });
    expect(within(debt).queryAllByRole('listitem')).toHaveLength(0);
    expect(within(debt).getByText(es.accounts.currencies.ARS).nextElementSibling?.textContent).toBe(
      formatMoney(-80000n, 'ARS', 'es'),
    );
  });

  it('follows creditCardCount exactly: a card on the page without a count shows no Debt section', () => {
    renderIntl(<AccountList {...listProps({ accounts: [VISA], creditCardCount: 0 })} />);

    expect(screen.queryByText(es.accounts.debt.title)).toBeNull();
  });

  it('keeps the card actions working inside Debt', async () => {
    const onArchive = vi.fn();
    renderIntl(<AccountList {...listProps({ accounts: [VISA], creditCardCount: 1, onArchive })} />);

    const debt = screen.getByRole('region', { name: es.accounts.debt.title });
    const row = within(debt).getByRole('listitem', { name: 'Visa' });
    await userEvent.setup().click(within(row).getByRole('button', { name: /^Archivar/ }));

    expect(onArchive).toHaveBeenCalledExactlyOnceWith('c1');
  });
});

describe('AccountList include in available setting', () => {
  it('shows the labelled checkbox with the account name on active non-card rows (AC-02, AC-23)', () => {
    for (const locale of ['es', 'en'] as const) {
      renderIntl(
        <AccountList
          {...listProps({
            accounts: [
              account({ id: 'a1', name: 'Caja', includeInAvailable: true }),
              account({ id: 'a2', name: 'Ahorro', type: 'savings', includeInAvailable: false }),
            ],
          })}
        />,
        locale,
      );
      const label = CATALOGS[locale].accounts.fields.includeInAvailable;

      const included = screen.getByRole<HTMLInputElement>('checkbox', { name: `${label} Caja` });
      const excluded = screen.getByRole<HTMLInputElement>('checkbox', { name: `${label} Ahorro` });
      expect(included.checked).toBe(true);
      expect(excluded.checked).toBe(false);
      expect(included.labels?.[0]?.textContent).toBe(label);
      cleanup();
    }
    expect(es.accounts.fields.includeInAvailable).not.toBe(en.accounts.fields.includeInAvailable);
  });

  it('reports the opposite value with the account id when toggled, also from the keyboard (AC-07)', async () => {
    const onToggleAvailable = vi.fn();
    renderIntl(<AccountList {...listProps({ onToggleAvailable })} />);
    const user = userEvent.setup();
    const box = screen.getByRole('checkbox', {
      name: `${es.accounts.fields.includeInAvailable} Caja`,
    });

    await user.click(box);
    box.focus();
    await user.keyboard(' ');

    expect(onToggleAvailable).toHaveBeenCalledTimes(2);
    expect(onToggleAvailable).toHaveBeenNthCalledWith(1, 'a1', false);
    expect(onToggleAvailable).toHaveBeenNthCalledWith(2, 'a1', false);
  });

  it('reports true when an excluded account is toggled (AC-07)', async () => {
    const onToggleAvailable = vi.fn();
    renderIntl(
      <AccountList
        {...listProps({
          accounts: [account({ type: 'savings', includeInAvailable: false })],
          onToggleAvailable,
        })}
      />,
    );

    await userEvent.setup().click(screen.getByRole('checkbox'));

    expect(onToggleAvailable).toHaveBeenCalledExactlyOnceWith('a1', true);
  });

  it('has no checkbox for credit cards or archived accounts (AC-11, AC-12)', () => {
    const visa = account({
      id: 'c1',
      name: 'Visa',
      type: 'credit_card',
      includeInAvailable: false,
    });
    renderIntl(<AccountList {...listProps({ accounts: [account(), visa], creditCardCount: 1 })} />);
    // Only the cash account has one.
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    expect(
      within(screen.getByRole('listitem', { name: 'Visa' })).queryByRole('checkbox'),
    ).toBeNull();
    cleanup();

    const archived = account({ archived: true, archivedAt: '2026-10-02T00:00:00.000Z' });
    renderIntl(<AccountList {...listProps({ showArchived: true, accounts: [archived] })} />);
    expect(screen.getByRole('listitem', { name: 'Caja' })).toBeDefined();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('keeps the checkbox focusable while pending but ignores a change (double submit, focus)', async () => {
    const onToggleAvailable = vi.fn();
    const { rerender } = renderIntl(<AccountList {...listProps({ onToggleAvailable })} />);
    const box = screen.getByRole('checkbox');
    box.focus();

    rerender(
      <NextIntlClientProvider locale="es" timeZone="UTC" messages={es}>
        <AccountList {...listProps({ onToggleAvailable, pending: true })} />
      </NextIntlClientProvider>,
    );
    await userEvent.setup().click(screen.getByRole('checkbox'));

    const pendingBox = screen.getByRole<HTMLInputElement>('checkbox');
    expect(pendingBox.hasAttribute('disabled')).toBe(false);
    expect(pendingBox.getAttribute('aria-disabled')).toBe('true');
    expect(document.activeElement).toBe(pendingBox);
    expect(pendingBox.checked).toBe(true);
    expect(onToggleAvailable).not.toHaveBeenCalled();
  });

  it('is not aria-disabled when nothing is pending', () => {
    renderIntl(<AccountList {...listProps()} />);

    expect(screen.getByRole('checkbox').getAttribute('aria-disabled')).not.toBe('true');
  });
});

describe('AccountForm include in available setting', () => {
  const LABEL = es.accounts.fields.includeInAvailable;

  it.each(ACCOUNT_TYPES.filter((type) => type !== 'credit_card'))(
    'starts %s with the shared type default (AC-03, AC-04)',
    async (type) => {
      renderIntl(<AccountForm pending={false} errors={{}} onSubmit={noop} />);

      await userEvent.setup().selectOptions(screen.getByLabelText(es.accounts.fields.type), type);

      expect(screen.getByRole<HTMLInputElement>('checkbox', { name: LABEL }).checked).toBe(
        defaultIncludeInAvailable(type),
      );
    },
  );

  it('hides the checkbox for a credit card and shows it again for another type (AC-09)', async () => {
    renderIntl(<AccountForm pending={false} errors={{}} onSubmit={noop} />);
    const user = userEvent.setup();
    const type = screen.getByLabelText(es.accounts.fields.type);

    await user.selectOptions(type, 'credit_card');
    expect(screen.queryByRole('checkbox')).toBeNull();
    await user.selectOptions(type, 'cash');

    expect(screen.getByRole<HTMLInputElement>('checkbox', { name: LABEL }).checked).toBe(true);
  });

  it('follows the type default until the user touches the checkbox (AC-05)', async () => {
    renderIntl(<AccountForm pending={false} errors={{}} onSubmit={noop} />);
    const user = userEvent.setup();
    const type = screen.getByLabelText(es.accounts.fields.type);

    await user.selectOptions(type, 'cash');
    await user.selectOptions(type, 'savings');
    expect(screen.getByRole<HTMLInputElement>('checkbox', { name: LABEL }).checked).toBe(false);

    await user.click(screen.getByRole('checkbox', { name: LABEL }));
    await user.selectOptions(type, 'cash');
    expect(screen.getByRole<HTMLInputElement>('checkbox', { name: LABEL }).checked).toBe(true);
    await user.click(screen.getByRole('checkbox', { name: LABEL }));
    await user.selectOptions(type, 'savings');

    // Touched twice: the user's last choice (excluded) stays although cash defaults to included.
    await user.selectOptions(type, 'cash');
    expect(screen.getByRole<HTMLInputElement>('checkbox', { name: LABEL }).checked).toBe(false);
  });

  it('hands an explicit boolean for a non-card type and undefined for a card (AC-05, AC-09)', async () => {
    const onSubmit = vi.fn();
    renderIntl(<AccountForm pending={false} errors={{}} onSubmit={onSubmit} />);
    const user = userEvent.setup();
    const type = screen.getByLabelText(es.accounts.fields.type);

    await user.selectOptions(type, 'savings');
    await user.click(screen.getByRole('checkbox', { name: LABEL }));
    await user.click(screen.getByRole('button', { name: es.accounts.form.submit }));
    await user.selectOptions(type, 'credit_card');
    await user.click(screen.getByRole('button', { name: es.accounts.form.submit }));

    expect(onSubmit).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ includeInAvailable: true }),
    );
    expect(onSubmit).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ includeInAvailable: undefined }),
    );
  });

  it('labels the checkbox in English too (AC-23)', async () => {
    renderIntl(<AccountForm pending={false} errors={{}} onSubmit={noop} />, 'en');

    await userEvent.setup().selectOptions(screen.getByLabelText(en.accounts.fields.type), 'cash');

    expect(
      screen.getByRole('checkbox', { name: en.accounts.fields.includeInAvailable }),
    ).toBeDefined();
  });
});

describe('AccountsLoadStateView (FEAT-004 AC-21)', () => {
  it('draws its card skeletons with the card radius so the swap keeps the shape (AC-35)', () => {
    const { container } = renderIntl(
      <AccountsLoadStateView state={{ kind: 'loading' }} onRetry={noop} />,
    );

    expect(container.querySelectorAll('[data-slot="skeleton"].rounded-card').length).toBe(2);
  });

  it('shows skeletons inside a labelled busy status while loading, with no list yet', () => {
    const { container } = renderIntl(
      <AccountsLoadStateView state={{ kind: 'loading' }} onRetry={noop} />,
    );

    const status = screen.getByRole('status');
    expect(status.textContent).toBe(es.app.loading);
    expect(status.getAttribute('aria-busy')).toBe('true');
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(1);
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('shows the shared error state with the failure message and a working retry', async () => {
    const onRetry = vi.fn();
    const { container } = renderIntl(
      <AccountsLoadStateView state={{ kind: 'failed', error: 'network' }} onRetry={onRetry} />,
    );

    expect(container.querySelector('[data-slot="alert"]')).not.toBeNull();
    expect(screen.getByText(es.ui.error.title)).toBeDefined();
    expect(screen.getByText(es.errors.network)).toBeDefined();
    await userEvent.setup().click(screen.getByRole('button', { name: es.app.retry }));

    expect(onRetry).toHaveBeenCalledOnce();
  });
});

describe('accounts screens built on the design system (FEAT-004 AC-17, AC-22)', () => {
  it('shows an empty state with a call to action to create the first account', () => {
    const { container } = renderIntl(<AccountList {...listProps({ accounts: [] })} />);

    const empty = container.querySelector<HTMLElement>('[data-slot="empty-state"]');
    if (empty === null) throw new Error('Expected an empty state');
    expect(within(empty).getByRole('heading', { name: es.accounts.list.emptyTitle })).toBeDefined();
    expect(within(empty).getByText(es.accounts.list.empty)).toBeDefined();
    expect(
      within(empty).getByRole('link', { name: es.accounts.list.newAccount }).getAttribute('href'),
    ).toBe('/es/accounts/new');
  });

  it('keeps the archived empty message without a call to action', () => {
    const { container } = renderIntl(
      <AccountList {...listProps({ accounts: [], showArchived: true })} />,
    );

    const empty = container.querySelector<HTMLElement>('[data-slot="empty-state"]');
    if (empty === null) throw new Error('Expected an empty state');
    expect(within(empty).getByText(es.accounts.list.emptyArchived)).toBeDefined();
    expect(within(empty).queryByRole('link')).toBeNull();
  });

  it('renders each account as a card with its currency badge and an Amount balance on its own line', () => {
    renderIntl(<AccountList {...listProps()} />);

    const row = screen.getByRole('listitem', { name: 'Caja' });
    const badge = row.querySelector('[data-slot="badge"]');
    const amount = row.querySelector('[data-slot="amount"]');
    expect(badge?.textContent).toBe('ARS');
    expect(amount?.textContent).toBe(formatMoney(150000n, 'ARS', 'es'));
    // A large balance never shares a row with the badge, so the two cannot overlap.
    expect(amount?.parentElement).toBe(row);
    expect(badge?.parentElement).not.toBe(row);
  });

  it('puts the totals in tabular Amount figures inside the headline card', () => {
    const { container } = renderIntl(
      <AccountsHeadline
        availableTotals={{ ARS: '150000', USD: '0' }}
        netWorthTotals={{ ARS: '150000', USD: '0' }}
      />,
    );

    expect(container.querySelectorAll('[data-slot="amount"]')).toHaveLength(4);
    expect(container.querySelectorAll('[data-slot="balance-card"]').length).toBe(2);
  });

  it('shows the field errors of an invalid submission and focuses the first invalid field', () => {
    const { container } = renderIntl(
      <AccountForm pending={false} errors={INVALID} onSubmit={noop} />,
    );

    expect(container.querySelector('[data-slot="card"]')).not.toBeNull();
    expect(screen.getByText(es.accounts.errors.nameRequired)).toBeDefined();
    expect(document.activeElement).toBe(screen.getByLabelText(es.accounts.fields.name));
  });
});

describe('accounts round 2 (FEAT-004 review items)', () => {
  it('gives the include-in-available row a 44px target with one accessible name from its label', () => {
    renderIntl(<AccountList {...listProps()} />);

    const box = screen.getByRole('checkbox', {
      name: `${es.accounts.fields.includeInAvailable} Caja`,
    });
    // One name only: the visible label (with the account name for screen readers), no aria-label.
    expect(box.hasAttribute('aria-label')).toBe(false);
    const wrapper = box.parentElement;
    expect(wrapper?.className).toContain('min-h-11');
    const label = wrapper?.querySelector('label');
    expect(label?.className).toContain('flex-1');
  });

  it('shows the archived title once on the archived empty view', () => {
    renderIntl(<AccountList {...listProps({ accounts: [], showArchived: true })} />);

    expect(screen.getAllByText(es.accounts.list.archivedTitle)).toHaveLength(1);
    expect(screen.getByText(es.accounts.list.emptyArchived)).toBeDefined();
  });

  it('renders a placeholder, never a crash, for a malformed balance or total', () => {
    const { container } = renderIntl(
      <>
        <AccountList
          {...listProps({
            accounts: [account({ balance: '12.5x' })],
            availableTotals: { ARS: 'abc', USD: '0' },
            netWorthTotals: { ARS: '1e3', USD: '0' },
            debtTotals: { ARS: 'nope', USD: '0' },
            creditCardCount: 1,
          })}
        />
      </>,
    );

    const row = screen.getByRole('listitem', { name: 'Caja' });
    expect(within(row).getByText('—')).toBeDefined();
    expect(row.querySelector('[data-slot="amount"]')).toBeNull();
    // Both malformed headline figures and the malformed debt total degrade the same way.
    expect(container.querySelectorAll('dd').length).toBeGreaterThan(0);
    expect(
      within(metric('es', 'ARS', es.accounts.headline.available)).getByText('—'),
    ).toBeDefined();
    expect(within(metric('es', 'ARS', es.accounts.headline.netWorth)).getByText('—')).toBeDefined();
    const debt = screen.getByRole('region', { name: es.accounts.debt.title });
    expect(within(debt).getByText('—')).toBeDefined();
  });
});

// @vitest-environment happy-dom
import { ACCOUNT_NAME_MAX_LENGTH, formatMoney, type AccountResponse } from '@pesly/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { AccountsContainer } from '../src/features/accounts/containers/accounts-container';
import { CreateAccountContainer } from '../src/features/accounts/containers/create-account-container';
import { CATALOGS, renderApp, stubApi } from './support/render-app';

const { es, en } = CATALOGS;

const ACTIVE = 'GET /accounts?archived=false&limit=100';
const ARCHIVED = 'GET /accounts?archived=true&limit=100';

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

interface Totals {
  availableTotals: Record<'ARS' | 'USD', string>;
  netWorthTotals: Record<'ARS' | 'USD', string>;
  debtTotals: Record<'ARS' | 'USD', string>;
  creditCardCount: number;
}

function list(items: AccountResponse[], overrides: Partial<Totals> = {}) {
  const body: Totals & Record<string, unknown> = {
    availableTotals: { ARS: '0', USD: '0' },
    netWorthTotals: { ARS: '0', USD: '0' },
    debtTotals: { ARS: '0', USD: '0' },
    creditCardCount: 0,
    ...overrides,
    items,
    total: items.length,
    limit: 100,
    offset: 0,
  };
  return { status: 200, body };
}

function money(value: bigint, currency: 'ARS' | 'USD', locale: 'es' | 'en'): string {
  return formatMoney(value, currency, locale).replace(/\s+/g, ' ');
}

/** The text of the value shown next to a headline label inside a currency's group. */
function headlineValue(locale: 'es' | 'en', currency: 'ARS' | 'USD', label: string): string {
  const group = screen.getByRole('group', { name: CATALOGS[locale].accounts.currencies[currency] });
  return within(group).getByText(label).nextElementSibling?.textContent ?? '';
}

const CAJA = account();
const DOLARES = account({ id: 'a2', name: 'Dolares', currency: 'USD', balance: '-2550' });

describe('AccountsContainer', () => {
  it('lists the active accounts with locale-formatted balances and the headline totals (AC-14, AC-16)', async () => {
    const { calls } = stubApi({
      [ACTIVE]: list([CAJA, DOLARES], {
        availableTotals: { ARS: '150000', USD: '0' },
        netWorthTotals: { ARS: '140000', USD: '-2550' },
      }),
    });
    renderApp(<AccountsContainer />, { locale: 'es' });

    const row = await screen.findByRole('listitem', { name: 'Caja' });
    expect(within(row).getByText(money(150000n, 'ARS', 'es'))).toBeDefined();
    expect(headlineValue('es', 'ARS', es.accounts.headline.available)).toBe(
      formatMoney(150000n, 'ARS', 'es'),
    );
    expect(headlineValue('es', 'ARS', es.accounts.headline.netWorth)).toBe(
      formatMoney(140000n, 'ARS', 'es'),
    );
    expect(headlineValue('es', 'USD', es.accounts.headline.available)).toBe(
      formatMoney(0n, 'USD', 'es'),
    );
    expect(headlineValue('es', 'USD', es.accounts.headline.netWorth)).toBe(
      formatMoney(-2550n, 'USD', 'es'),
    );
    expect(calls.map((call) => call.path)).toEqual(['/accounts?archived=false&limit=100']);
  });

  it('formats amounts in the English locale too', async () => {
    stubApi({ [ACTIVE]: list([CAJA], { availableTotals: { ARS: '150000', USD: '0' } }) });
    renderApp(<AccountsContainer />, { locale: 'en' });

    const row = await screen.findByRole('listitem', { name: 'Caja' });
    expect(within(row).getByText(money(150000n, 'ARS', 'en'))).toBeDefined();
    expect(headlineValue('en', 'ARS', en.accounts.headline.available)).toBe(
      formatMoney(150000n, 'ARS', 'en'),
    );
    expect(screen.getAllByText(en.accounts.headline.netWorth)).toHaveLength(2);
  });

  it('shows a negative balance as created (AC-17)', async () => {
    stubApi({ [ACTIVE]: list([account({ balance: '-150000' })]) });
    renderApp(<AccountsContainer />);

    const row = await screen.findByRole('listitem', { name: 'Caja' });
    expect(within(row).getByText(money(-150000n, 'ARS', 'es'))).toBeDefined();
  });

  it('shows the loading state first and the empty state without accounts', async () => {
    stubApi({ [ACTIVE]: list([]) });
    renderApp(<AccountsContainer />);

    expect(screen.getByRole('status').textContent).toBe(es.app.loading);
    expect(await screen.findByText(es.accounts.list.empty)).toBeDefined();
  });

  it('renders an account name containing markup as literal text (NFR-05)', async () => {
    const name = '<img src=x onerror="alert(1)">';
    stubApi({ [ACTIVE]: list([account({ name })]) });
    const { container } = renderApp(<AccountsContainer />);

    expect((await screen.findAllByText(name)).length).toBeGreaterThan(0);
    expect(container.querySelector('img')).toBeNull();
  });

  it('shows the retry state when the API is unreachable and loads on retry (error path)', async () => {
    stubApi({ [ACTIVE]: ['network-error', list([CAJA])] });
    renderApp(<AccountsContainer />, { locale: 'en' });

    expect(await screen.findByText(en.errors.network)).toBeDefined();
    expect(screen.queryByRole('list')).toBeNull();
    await userEvent.setup().click(screen.getByRole('button', { name: en.app.retry }));

    expect(await screen.findByRole('listitem', { name: 'Caja' })).toBeDefined();
    expect(screen.queryByText(en.errors.network)).toBeNull();
  });

  it('sends the user to sign-in when the session is gone', async () => {
    stubApi({ [ACTIVE]: { status: 401, body: { code: 'UNAUTHENTICATED' } } });
    const { router } = renderApp(<AccountsContainer />);

    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith('/es/sign-in');
    });
  });

  it('renames inline and shows the new name (AC-06)', async () => {
    const { calls } = stubApi({
      [ACTIVE]: list([CAJA]),
      'PATCH /accounts/a1': { status: 200, body: account({ name: 'Billetera' }) },
    });
    renderApp(<AccountsContainer />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: /^Renombrar/ }));
    const field = screen.getByLabelText(es.accounts.actions.renameField.replace('{name}', 'Caja'));
    await user.clear(field);
    await user.type(field, '  Billetera ');
    await user.click(screen.getByRole('button', { name: es.accounts.actions.save }));

    expect(await screen.findByRole('listitem', { name: 'Billetera' })).toBeDefined();
    expect(screen.queryByRole('listitem', { name: 'Caja' })).toBeNull();
    expect(screen.queryByLabelText(/Nuevo nombre/)).toBeNull();
    const patch = calls.find((call) => call.method === 'PATCH');
    expect(patch?.body).toEqual({ name: 'Billetera' });
  });

  it('keeps the rename open with the duplicate-name message (AC-13)', async () => {
    stubApi({
      [ACTIVE]: list([CAJA]),
      'PATCH /accounts/a1': { status: 409, body: { code: 'ACCOUNT_NAME_TAKEN' } },
    });
    renderApp(<AccountsContainer />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: /^Renombrar/ }));
    const field = screen.getByLabelText(es.accounts.actions.renameField.replace('{name}', 'Caja'));
    await user.clear(field);
    await user.type(field, 'Banco');
    await user.click(screen.getByRole('button', { name: es.accounts.actions.save }));

    expect(await screen.findByText(es.errors.accountNameTaken)).toBeDefined();
    expect(field.getAttribute('aria-invalid')).toBe('true');
  });

  it('does not send an empty new name', async () => {
    const { calls } = stubApi({ [ACTIVE]: list([CAJA]) });
    renderApp(<AccountsContainer />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: /^Renombrar/ }));
    await user.clear(
      screen.getByLabelText(es.accounts.actions.renameField.replace('{name}', 'Caja')),
    );
    await user.click(screen.getByRole('button', { name: es.accounts.actions.save }));

    expect(await screen.findByText(es.accounts.errors.nameRequired)).toBeDefined();
    expect(calls.filter((call) => call.method === 'PATCH')).toHaveLength(0);
  });

  it('does not send a new name with a zero-width character and says why (AC-20)', async () => {
    const { calls } = stubApi({ [ACTIVE]: list([CAJA]) });
    renderApp(<AccountsContainer />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: /^Renombrar/ }));
    const field = screen.getByLabelText(es.accounts.actions.renameField.replace('{name}', 'Caja'));
    await user.clear(field);
    await user.type(field, 'Banco\u200B');
    await user.click(screen.getByRole('button', { name: es.accounts.actions.save }));

    expect(await screen.findByText(es.accounts.errors.nameInvalidCharacters)).toBeDefined();
    expect(calls.filter((call) => call.method === 'PATCH')).toHaveLength(0);
  });

  it('cancels a rename without calling the API', async () => {
    const { calls } = stubApi({ [ACTIVE]: list([CAJA]) });
    renderApp(<AccountsContainer />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: /^Renombrar/ }));
    await user.click(screen.getByRole('button', { name: es.accounts.actions.cancel }));

    expect(screen.queryByLabelText(/Nuevo nombre/)).toBeNull();
    expect(calls.filter((call) => call.method === 'PATCH')).toHaveLength(0);
  });

  describe('edit opening balance (FEAT-006)', () => {
    const PATCH = 'PATCH /accounts/a1/opening-balance';
    const fieldLabel = es.accounts.openingEdit.field.replace('{name}', 'Caja');

    async function openForm() {
      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: /^Editar saldo inicial/ }));
      return { user, field: screen.getByLabelText(fieldLabel) };
    }

    it('sends the parsed amount, shows the updated row, closes the form and reads the totals again (AC-19)', async () => {
      const updated = account({ openingBalance: '500000', balance: '650000' });
      const { calls } = stubApi({
        [ACTIVE]: [list([CAJA]), list([updated])],
        [PATCH]: { status: 200, body: updated },
      });
      renderApp(<AccountsContainer />);

      const { user, field } = await openForm();
      await user.clear(field);
      await user.type(field, '5000');
      await user.click(screen.getByRole('button', { name: es.accounts.actions.save }));

      const row = await screen.findByRole('listitem', { name: 'Caja' });
      expect(await within(row).findByText(money(650000n, 'ARS', 'es'))).toBeDefined();
      expect(screen.queryByLabelText(fieldLabel)).toBeNull();
      expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({
        openingBalance: '500000',
      });
      await waitFor(() => {
        expect(calls.filter((call) => call.method === 'GET')).toHaveLength(2);
      });
    });

    it('error: does not send an empty or malformed amount and says why (AC-17)', async () => {
      const { calls } = stubApi({ [ACTIVE]: list([CAJA]) });
      renderApp(<AccountsContainer />);

      const { user, field } = await openForm();
      await user.clear(field);
      await user.click(screen.getByRole('button', { name: es.accounts.actions.save }));
      expect(await screen.findByText(es.accounts.errors.amountInvalid)).toBeDefined();
      expect(field.getAttribute('aria-invalid')).toBe('true');

      await user.type(field, 'abc');
      await user.click(screen.getByRole('button', { name: es.accounts.actions.save }));
      expect(screen.getByText(es.accounts.errors.amountInvalid)).toBeDefined();
      expect(calls.filter((call) => call.method === 'PATCH')).toHaveLength(0);
    });

    it('error: does not send an amount above the limit and shows the formatted limit (AC-18)', async () => {
      const { calls } = stubApi({ [ACTIVE]: list([CAJA]) });
      renderApp(<AccountsContainer />);

      const { user, field } = await openForm();
      await user.clear(field);
      await user.type(field, '10000000000000,01');
      await user.click(screen.getByRole('button', { name: es.accounts.actions.save }));

      const message = await screen.findByText(/no puede superar/);
      expect(message.textContent.replace(/\s/g, ' ')).toContain(
        money(1_000_000_000_000_000n, 'ARS', 'es'),
      );
      expect(calls.filter((call) => call.method === 'PATCH')).toHaveLength(0);
    });

    it('error: keeps the form open and shows the mapped message when the API refuses (AC-20)', async () => {
      stubApi({
        [ACTIVE]: list([CAJA]),
        [PATCH]: { status: 400, body: { code: 'VALIDATION_FAILED' } },
      });
      renderApp(<AccountsContainer />);

      const { user, field } = await openForm();
      await user.clear(field);
      await user.type(field, '10');
      await user.click(screen.getByRole('button', { name: es.accounts.actions.save }));

      expect(await screen.findByText(es.errors.validationFailed)).toBeDefined();
      expect(screen.getByLabelText(fieldLabel)).toBeDefined();
    });

    it('error: sends the user to sign-in when the session is gone (AC-20)', async () => {
      stubApi({
        [ACTIVE]: list([CAJA]),
        [PATCH]: { status: 401, body: { code: 'UNAUTHENTICATED' } },
        'POST /auth/refresh': { status: 401, body: { code: 'UNAUTHENTICATED' } },
      });
      const { router } = renderApp(<AccountsContainer />);

      const { user, field } = await openForm();
      await user.clear(field);
      await user.type(field, '10');
      await user.click(screen.getByRole('button', { name: es.accounts.actions.save }));

      await waitFor(() => {
        expect(router.replace).toHaveBeenCalledWith('/es/sign-in');
      });
    });

    it('cancels without calling the API (AC-21)', async () => {
      const { calls } = stubApi({ [ACTIVE]: list([CAJA]) });
      renderApp(<AccountsContainer />);

      const { user } = await openForm();
      await user.click(screen.getByRole('button', { name: es.accounts.actions.cancel }));

      expect(screen.queryByLabelText(fieldLabel)).toBeNull();
      expect(calls.filter((call) => call.method === 'PATCH')).toHaveLength(0);
    });
  });

  it('archives an account out of the active view and unarchives it from the archived view (AC-07, AC-08)', async () => {
    const archived = account({ archived: true, archivedAt: '2026-10-02T00:00:00.000Z' });
    const { calls } = stubApi({
      [ACTIVE]: [list([CAJA, DOLARES]), list([DOLARES]), list([CAJA, DOLARES])],
      [ARCHIVED]: [list([archived]), list([])],
      'POST /accounts/a1/archive': { status: 200, body: archived },
      'POST /accounts/a1/unarchive': { status: 200, body: CAJA },
    });
    renderApp(<AccountsContainer />);
    const user = userEvent.setup();

    const row = await screen.findByRole('listitem', { name: 'Caja' });
    await user.click(within(row).getByRole('button', { name: /^Archivar/ }));
    await waitFor(() => {
      expect(screen.queryByRole('listitem', { name: 'Caja' })).toBeNull();
    });
    expect(screen.getByRole('listitem', { name: 'Dolares' })).toBeDefined();

    await user.click(screen.getByRole('button', { name: es.accounts.list.showArchived }));
    const archivedRow = await screen.findByRole('listitem', { name: 'Caja' });
    await user.click(within(archivedRow).getByRole('button', { name: /^Desarchivar/ }));
    expect(await screen.findByText(es.accounts.list.emptyArchived)).toBeDefined();

    await user.click(screen.getByRole('button', { name: es.accounts.list.showActive }));
    expect(await screen.findByRole('listitem', { name: 'Caja' })).toBeDefined();
    expect(calls.filter((call) => call.method === 'POST').map((call) => call.path)).toEqual([
      '/accounts/a1/archive',
      '/accounts/a1/unarchive',
    ]);
  });

  it('asks for confirmation before deleting and then removes the row (AC-09)', async () => {
    const { calls } = stubApi({
      [ACTIVE]: [list([CAJA, DOLARES]), list([DOLARES])],
      'DELETE /accounts/a1': { status: 204 },
    });
    renderApp(<AccountsContainer />);
    const user = userEvent.setup();

    const row = await screen.findByRole('listitem', { name: 'Caja' });
    await user.click(within(row).getByRole('button', { name: /^Eliminar/ }));

    expect(
      screen.getByText(es.accounts.actions.confirmDelete.replace('{name}', 'Caja')),
    ).toBeDefined();
    expect(calls.filter((call) => call.method === 'DELETE')).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: es.accounts.actions.confirmDeleteYes }));

    await waitFor(() => {
      expect(screen.queryByRole('listitem', { name: 'Caja' })).toBeNull();
    });
    expect(calls.filter((call) => call.method === 'DELETE')).toHaveLength(1);
  });

  it('does not delete when the confirmation is cancelled', async () => {
    const { calls } = stubApi({ [ACTIVE]: list([CAJA]) });
    renderApp(<AccountsContainer />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: /^Eliminar/ }));
    await user.click(screen.getByRole('button', { name: es.accounts.actions.cancel }));

    expect(screen.queryByText(es.accounts.actions.confirmDeleteYes)).toBeNull();
    expect(calls.filter((call) => call.method === 'DELETE')).toHaveLength(0);
  });

  it('answers a refused deletion with the message and an archive-instead action (AC-10)', async () => {
    const archived = account({ archived: true, archivedAt: '2026-10-02T00:00:00.000Z' });
    const { calls } = stubApi({
      [ACTIVE]: [list([CAJA]), list([])],
      'DELETE /accounts/a1': { status: 409, body: { code: 'ACCOUNT_HAS_MOVEMENTS' } },
      'POST /accounts/a1/archive': { status: 200, body: archived },
    });
    renderApp(<AccountsContainer />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: /^Eliminar/ }));
    await user.click(screen.getByRole('button', { name: es.accounts.actions.confirmDeleteYes }));

    expect(await screen.findByText(es.errors.accountHasMovements)).toBeDefined();
    expect(screen.getByRole('listitem', { name: 'Caja' })).toBeDefined();

    await user.click(screen.getByRole('button', { name: es.accounts.actions.archiveInstead }));

    expect(await screen.findByText(es.accounts.list.empty)).toBeDefined();
    expect(screen.queryByText(es.errors.accountHasMovements)).toBeNull();
    expect(calls.filter((call) => call.method === 'POST').map((call) => call.path)).toEqual([
      '/accounts/a1/archive',
    ]);
  });

  it('shows an unreachable API during an action in an alert and keeps the row', async () => {
    stubApi({ [ACTIVE]: list([CAJA]), 'POST /accounts/a1/archive': 'network-error' });
    renderApp(<AccountsContainer />, { locale: 'en' });

    await userEvent.setup().click(await screen.findByRole('button', { name: /^Archive/ }));

    expect((await screen.findByRole('alert')).textContent).toContain(en.errors.network);
    expect(screen.getByRole('listitem', { name: 'Caja' })).toBeDefined();
  });
});

describe('AccountsContainer include in available setting', () => {
  const PUT = 'PUT /accounts/a1/include-in-available';
  const AHORRO = account({ id: 'a3', name: 'Ahorro', type: 'savings', includeInAvailable: false });
  const VISA = account({
    id: 'c1',
    name: 'Visa',
    type: 'credit_card',
    balance: '-45000',
    includeInAvailable: false,
  });

  function checkbox(name: string): HTMLInputElement {
    return screen.getByRole<HTMLInputElement>('checkbox', {
      name: `${es.accounts.fields.includeInAvailable} ${name}`,
    });
  }

  it('calls the API, updates the row and reloads the totals (AC-07)', async () => {
    const excluded = account({ includeInAvailable: false });
    const { calls } = stubApi({
      [ACTIVE]: [
        list([CAJA], {
          availableTotals: { ARS: '150000', USD: '0' },
          netWorthTotals: { ARS: '150000', USD: '0' },
        }),
        list([excluded], {
          availableTotals: { ARS: '0', USD: '0' },
          netWorthTotals: { ARS: '150000', USD: '0' },
        }),
      ],
      [PUT]: { status: 200, body: excluded },
    });
    renderApp(<AccountsContainer />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('checkbox', { name: /Caja$/ }));

    await waitFor(() => {
      expect(checkbox('Caja').checked).toBe(false);
    });
    await waitFor(() => {
      expect(headlineValue('es', 'ARS', es.accounts.headline.available)).toBe(
        formatMoney(0n, 'ARS', 'es'),
      );
    });
    expect(headlineValue('es', 'ARS', es.accounts.headline.netWorth)).toBe(
      formatMoney(150000n, 'ARS', 'es'),
    );
    const put = calls.find((call) => call.method === 'PUT');
    expect(put?.body).toEqual({ includeInAvailable: false });
    expect(calls.filter((call) => call.method === 'GET')).toHaveLength(2);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('includes an excluded account when its checkbox is checked (AC-07)', async () => {
    const included = account({
      id: 'a3',
      name: 'Ahorro',
      type: 'savings',
      includeInAvailable: true,
    });
    const { calls } = stubApi({
      [ACTIVE]: [list([AHORRO]), list([included])],
      'PUT /accounts/a3/include-in-available': { status: 200, body: included },
    });
    renderApp(<AccountsContainer />);

    await userEvent.setup().click(await screen.findByRole('checkbox', { name: /Ahorro$/ }));

    await waitFor(() => {
      expect(checkbox('Ahorro').checked).toBe(true);
    });
    expect(calls.find((call) => call.method === 'PUT')?.body).toEqual({
      includeInAvailable: true,
    });
  });

  it('shows the cards under Debt with the API total and no checkbox for them (AC-11, AC-19)', async () => {
    stubApi({
      [ACTIVE]: list([CAJA, VISA], {
        creditCardCount: 1,
        debtTotals: { ARS: '-45000', USD: '0' },
      }),
    });
    renderApp(<AccountsContainer />);

    const debt = await screen.findByRole('region', { name: es.accounts.debt.title });
    expect(within(debt).getByRole('listitem', { name: 'Visa' })).toBeDefined();
    expect(within(debt).queryByRole('checkbox')).toBeNull();
    expect(within(debt).getByText(es.accounts.currencies.ARS).nextElementSibling?.textContent).toBe(
      formatMoney(-45000n, 'ARS', 'es'),
    );
  });

  it('keeps the previous value and shows the alert on 409 ACCOUNT_ARCHIVED (AC-12)', async () => {
    const { calls } = stubApi({
      [ACTIVE]: list([CAJA]),
      [PUT]: { status: 409, body: { code: 'ACCOUNT_ARCHIVED' } },
    });
    renderApp(<AccountsContainer />);

    await userEvent.setup().click(await screen.findByRole('checkbox', { name: /Caja$/ }));

    expect((await screen.findByRole('alert')).textContent).toContain(es.errors.accountArchived);
    expect(checkbox('Caja').checked).toBe(true);
    expect(calls.filter((call) => call.method === 'PUT')).toHaveLength(1);
  });

  it('keeps the previous value and shows the alert on a network failure (error path)', async () => {
    stubApi({ [ACTIVE]: list([CAJA]), [PUT]: 'network-error' });
    renderApp(<AccountsContainer />, { locale: 'en' });

    await userEvent.setup().click(await screen.findByRole('checkbox', { name: /Caja$/ }));

    expect((await screen.findByRole('alert')).textContent).toContain(en.errors.network);
    expect(
      screen.getByRole<HTMLInputElement>('checkbox', {
        name: `${en.accounts.fields.includeInAvailable} Caja`,
      }).checked,
    ).toBe(true);
  });

  it('sends the user to sign-in on a 401 (error path)', async () => {
    stubApi({
      [ACTIVE]: list([CAJA]),
      [PUT]: { status: 401, body: { code: 'UNAUTHENTICATED' } },
    });
    const { router } = renderApp(<AccountsContainer />);

    await userEvent.setup().click(await screen.findByRole('checkbox', { name: /Caja$/ }));

    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith('/es/sign-in');
    });
    expect(checkbox('Caja').checked).toBe(true);
  });

  it('shows no headline, Debt section or checkbox on the archived view (AC-12)', async () => {
    const archived = account({ archived: true, archivedAt: '2026-10-02T00:00:00.000Z' });
    stubApi({
      [ACTIVE]: list([CAJA], { creditCardCount: 1 }),
      [ARCHIVED]: list([archived], { creditCardCount: 1 }),
    });
    renderApp(<AccountsContainer />);
    const user = userEvent.setup();

    await screen.findByRole('checkbox', { name: /Caja$/ });
    expect(screen.getByRole('region', { name: es.accounts.debt.title })).toBeDefined();
    await user.click(screen.getByRole('button', { name: es.accounts.list.showArchived }));

    expect(await screen.findByRole('button', { name: /^Desarchivar/ })).toBeDefined();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByText(es.accounts.debt.title)).toBeNull();
    expect(screen.queryByText(es.accounts.headline.available)).toBeNull();
  });
});

async function fillName(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.type(screen.getByLabelText(es.accounts.fields.name), name);
}

async function choose(user: ReturnType<typeof userEvent.setup>, type = 'cash', currency = 'ARS') {
  await user.selectOptions(screen.getByLabelText(es.accounts.fields.type), type);
  await user.selectOptions(screen.getByLabelText(es.accounts.fields.currency), currency);
}

async function submit(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: es.accounts.form.submit }));
}

describe('CreateAccountContainer', () => {
  it('creates the account once and goes back to the list (AC-01)', async () => {
    const { calls } = stubApi({ 'POST /accounts': { status: 201, body: account() } });
    const { router } = renderApp(<CreateAccountContainer />);
    const user = userEvent.setup();

    await fillName(user, '  Caja chica ');
    await choose(user, 'bank_account', 'USD');
    await submit(user);

    await waitFor(() => {
      expect(router.push).toHaveBeenCalledWith('/es/accounts');
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/accounts' });
    expect(calls[0]?.body).toEqual({
      name: 'Caja chica',
      type: 'bank_account',
      currency: 'USD',
      openingBalance: '0',
      includeInAvailable: true,
    });
  });

  it('sends the pre-filled 0 as the opening balance (AC-16)', async () => {
    const { calls } = stubApi({ 'POST /accounts': { status: 201, body: account() } });
    renderApp(<CreateAccountContainer />);
    const user = userEvent.setup();

    expect(screen.getByLabelText<HTMLInputElement>(es.accounts.fields.openingBalance).value).toBe(
      '0',
    );
    await fillName(user, 'Caja');
    await choose(user);
    await submit(user);

    await waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    expect((calls[0]?.body as { openingBalance?: string }).openingBalance).toBe('0');
  });

  it('sends an empty opening balance as omitted (AC-16)', async () => {
    const { calls } = stubApi({ 'POST /accounts': { status: 201, body: account() } });
    renderApp(<CreateAccountContainer />);
    const user = userEvent.setup();

    await fillName(user, 'Caja');
    await choose(user);
    await user.clear(screen.getByLabelText(es.accounts.fields.openingBalance));
    await submit(user);

    await waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    expect(calls[0]?.body).toEqual({
      name: 'Caja',
      type: 'cash',
      currency: 'ARS',
      includeInAvailable: true,
    });
    expect(calls[0]?.body).not.toHaveProperty('openingBalance');
  });

  it('sends -1.500,00 typed in es as a negative amount in minor units (AC-17)', async () => {
    const { calls } = stubApi({ 'POST /accounts': { status: 201, body: account() } });
    renderApp(<CreateAccountContainer />, { locale: 'es' });
    const user = userEvent.setup();

    await fillName(user, 'Tarjeta');
    await choose(user, 'credit_card');
    const amount = screen.getByLabelText(es.accounts.fields.openingBalance);
    await user.clear(amount);
    await user.type(amount, '-1.500,00');
    await submit(user);

    await waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    expect((calls[0]?.body as { openingBalance?: string }).openingBalance).toBe('-150000');
  });

  it('reads the opening balance in the English notation in en', async () => {
    const { calls } = stubApi({ 'POST /accounts': { status: 201, body: account() } });
    renderApp(<CreateAccountContainer />, { locale: 'en' });
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(en.accounts.fields.name), 'Card');
    await user.selectOptions(screen.getByLabelText(en.accounts.fields.type), 'cash');
    await user.selectOptions(screen.getByLabelText(en.accounts.fields.currency), 'USD');
    const amount = screen.getByLabelText(en.accounts.fields.openingBalance);
    await user.clear(amount);
    await user.type(amount, '-1,500.25');
    await user.click(screen.getByRole('button', { name: en.accounts.form.submit }));

    await waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    expect((calls[0]?.body as { openingBalance?: string }).openingBalance).toBe('-150025');
  });

  it('names each missing field, focuses the first one and sends nothing (AC-02)', async () => {
    const { calls } = stubApi({});
    const { router } = renderApp(<CreateAccountContainer />);
    const user = userEvent.setup();

    await submit(user);

    expect(await screen.findByText(es.accounts.errors.nameRequired)).toBeDefined();
    expect(screen.getByText(es.accounts.errors.typeRequired)).toBeDefined();
    expect(screen.getByText(es.accounts.errors.currencyRequired)).toBeDefined();
    for (const label of [
      es.accounts.fields.name,
      es.accounts.fields.type,
      es.accounts.fields.currency,
    ]) {
      expect(screen.getByLabelText(label).getAttribute('aria-invalid')).toBe('true');
    }
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByLabelText(es.accounts.fields.name));
    });
    expect(calls).toHaveLength(0);
    expect(router.push).not.toHaveBeenCalled();
  });

  it('treats a blank name as missing and a 51-character name as too long', async () => {
    const { calls } = stubApi({});
    renderApp(<CreateAccountContainer />);
    const user = userEvent.setup();

    await fillName(user, '   ');
    await choose(user);
    await submit(user);
    expect(await screen.findByText(es.accounts.errors.nameRequired)).toBeDefined();

    const name = screen.getByLabelText(es.accounts.fields.name);
    await user.clear(name);
    await user.type(name, 'x'.repeat(51));
    await submit(user);
    expect(
      await screen.findByText(
        es.accounts.errors.nameTooLong.replace('{max}', String(ACCOUNT_NAME_MAX_LENGTH)),
      ),
    ).toBeDefined();
    expect(calls).toHaveLength(0);
  });

  it('shows an error for a malformed amount and sends nothing', async () => {
    const { calls } = stubApi({});
    renderApp(<CreateAccountContainer />);
    const user = userEvent.setup();

    await fillName(user, 'Caja');
    await choose(user);
    const amount = screen.getByLabelText(es.accounts.fields.openingBalance);
    await user.clear(amount);
    // The field only keeps digits, one decimal mark and a leading minus, so a lone minus is the
    // malformed text that can still reach the container.
    await user.type(amount, '-');
    await submit(user);

    expect(await screen.findByText(es.accounts.errors.amountInvalid)).toBeDefined();
    expect(amount.getAttribute('aria-invalid')).toBe('true');
    expect(calls).toHaveLength(0);
  });

  it('shows the invalid-characters message for a name with a zero-width character and sends nothing (AC-20)', async () => {
    const { calls } = stubApi({});
    renderApp(<CreateAccountContainer />);
    const user = userEvent.setup();

    await fillName(user, 'Caja\u200B');
    await choose(user);
    await submit(user);

    expect(await screen.findByText(es.accounts.errors.nameInvalidCharacters)).toBeDefined();
    expect(screen.queryByText(es.accounts.errors.nameRequired)).toBeNull();
    expect(screen.getByLabelText(es.accounts.fields.name).getAttribute('aria-invalid')).toBe(
      'true',
    );
    expect(calls).toHaveLength(0);
  });

  it('shows the name-required message for a zero-width-only name and sends nothing (AC-21)', async () => {
    const { calls } = stubApi({});
    renderApp(<CreateAccountContainer />);
    const user = userEvent.setup();

    await fillName(user, '\u200B\u200B');
    await choose(user);
    await submit(user);

    expect(await screen.findByText(es.accounts.errors.nameRequired)).toBeDefined();
    expect(screen.queryByText(es.accounts.errors.nameInvalidCharacters)).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('shows the out-of-range message with the formatted limit for 10.000.000.000.000,01 typed in es and sends nothing (AC-18)', async () => {
    const { calls } = stubApi({});
    renderApp(<CreateAccountContainer />, { locale: 'es' });
    const user = userEvent.setup();

    await fillName(user, 'Caja');
    await choose(user);
    const amount = screen.getByLabelText(es.accounts.fields.openingBalance);
    await user.clear(amount);
    await user.type(amount, '10.000.000.000.000,01');
    await submit(user);

    const message = es.accounts.errors.amountOutOfRange.replace(
      '{max}',
      money(10n ** 15n, 'ARS', 'es'),
    );
    await waitFor(() => {
      expect(document.body.textContent.replace(/\s+/g, ' ')).toContain(message);
    });
    expect(amount.getAttribute('aria-invalid')).toBe('true');
    expect(screen.queryByText(es.accounts.errors.amountInvalid)).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('refuses a negative amount beyond the limit and formats the limit in the account currency (AC-19)', async () => {
    const { calls } = stubApi({});
    renderApp(<CreateAccountContainer />, { locale: 'en' });
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(en.accounts.fields.name), 'Card');
    await user.selectOptions(screen.getByLabelText(en.accounts.fields.type), 'cash');
    await user.selectOptions(screen.getByLabelText(en.accounts.fields.currency), 'USD');
    const amount = screen.getByLabelText(en.accounts.fields.openingBalance);
    await user.clear(amount);
    await user.type(amount, '-10,000,000,000,000.01');
    await user.click(screen.getByRole('button', { name: en.accounts.form.submit }));

    const message = en.accounts.errors.amountOutOfRange.replace(
      '{max}',
      money(10n ** 15n, 'USD', 'en'),
    );
    await waitFor(() => {
      expect(document.body.textContent.replace(/\s+/g, ' ')).toContain(message);
    });
    expect(calls).toHaveLength(0);
  });

  it.each([
    ['10.000.000.000.000,00', '1000000000000000'],
    ['-10.000.000.000.000,00', '-1000000000000000'],
  ])('sends the limit %s as %s minor units (AC-18, AC-19)', async (typed, minor) => {
    const { calls } = stubApi({ 'POST /accounts': { status: 201, body: account() } });
    renderApp(<CreateAccountContainer />, { locale: 'es' });
    const user = userEvent.setup();

    await fillName(user, 'Caja');
    await choose(user);
    const amount = screen.getByLabelText(es.accounts.fields.openingBalance);
    await user.clear(amount);
    await user.type(amount, typed);
    await submit(user);

    await waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    expect((calls[0]?.body as { openingBalance?: string }).openingBalance).toBe(minor);
  });

  it('shows the duplicate-name message on the name field (AC-13)', async () => {
    stubApi({ 'POST /accounts': { status: 409, body: { code: 'ACCOUNT_NAME_TAKEN' } } });
    const { router } = renderApp(<CreateAccountContainer />);
    const user = userEvent.setup();

    await fillName(user, 'Caja');
    await choose(user);
    await submit(user);

    expect(await screen.findByText(es.errors.accountNameTaken)).toBeDefined();
    const name = screen.getByLabelText(es.accounts.fields.name);
    expect(name.getAttribute('aria-invalid')).toBe('true');
    await waitFor(() => {
      expect(document.activeElement).toBe(name);
    });
    expect(router.push).not.toHaveBeenCalled();
  });

  it('shows the retry alert on a network failure and keeps the typed values', async () => {
    const { calls } = stubApi({
      'POST /accounts': ['network-error', { status: 201, body: account() }],
    });
    const { router } = renderApp(<CreateAccountContainer />);
    const user = userEvent.setup();

    await fillName(user, 'Caja');
    await choose(user, 'savings', 'USD');
    const amount = screen.getByLabelText(es.accounts.fields.openingBalance);
    await user.clear(amount);
    await user.type(amount, '25,50');
    await submit(user);

    expect(await screen.findByText(es.errors.network)).toBeDefined();
    expect(screen.getByLabelText<HTMLInputElement>(es.accounts.fields.name).value).toBe('Caja');
    expect(screen.getByLabelText<HTMLSelectElement>(es.accounts.fields.type).value).toBe('savings');
    expect(screen.getByLabelText<HTMLSelectElement>(es.accounts.fields.currency).value).toBe('USD');
    expect((amount as HTMLInputElement).value).toBe('25,50');
    expect(
      screen.getByRole('button', { name: es.accounts.form.submit }).hasAttribute('disabled'),
    ).toBe(false);
    expect(router.push).not.toHaveBeenCalled();

    await submit(user);
    await waitFor(() => {
      expect(router.push).toHaveBeenCalledWith('/es/accounts');
    });
    expect(calls).toHaveLength(2);
  });

  it('shows an unexpected failure above the form', async () => {
    stubApi({ 'POST /accounts': { status: 500, body: { code: 'INTERNAL' } } });
    renderApp(<CreateAccountContainer />);
    const user = userEvent.setup();

    await fillName(user, 'Caja');
    await choose(user);
    await submit(user);

    expect(await screen.findByText(es.errors.unexpected)).toBeDefined();
  });

  it('sends the user to sign-in when the session is gone', async () => {
    stubApi({ 'POST /accounts': { status: 401, body: { code: 'UNAUTHENTICATED' } } });
    const { router } = renderApp(<CreateAccountContainer />);
    const user = userEvent.setup();

    await fillName(user, 'Caja');
    await choose(user);
    await submit(user);

    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith('/es/sign-in');
    });
  });
});

describe('CreateAccountContainer include in available setting', () => {
  const LABEL = es.accounts.fields.includeInAvailable;

  it('sends the type default as an explicit value for a non-card type (AC-03, AC-04, AC-05)', async () => {
    const { calls } = stubApi({ 'POST /accounts': { status: 201, body: account() } });
    renderApp(<CreateAccountContainer />);
    const user = userEvent.setup();

    await fillName(user, 'Ahorro');
    await choose(user, 'savings');
    await submit(user);

    await waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    expect(calls[0]?.body).toMatchObject({ type: 'savings', includeInAvailable: false });
  });

  it('sends the explicit choice of the user (AC-05)', async () => {
    const { calls } = stubApi({ 'POST /accounts': { status: 201, body: account() } });
    renderApp(<CreateAccountContainer />);
    const user = userEvent.setup();

    await fillName(user, 'Ahorro');
    await choose(user, 'savings');
    await user.click(screen.getByRole('checkbox', { name: LABEL }));
    await submit(user);

    await waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    expect(calls[0]?.body).toMatchObject({ type: 'savings', includeInAvailable: true });
  });

  it('sends no value for a credit card (AC-09)', async () => {
    const { calls } = stubApi({ 'POST /accounts': { status: 201, body: account() } });
    renderApp(<CreateAccountContainer />);
    const user = userEvent.setup();

    await fillName(user, 'Visa');
    await choose(user, 'credit_card');
    expect(screen.queryByRole('checkbox')).toBeNull();
    await submit(user);

    await waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    expect(calls[0]?.body).toMatchObject({ type: 'credit_card' });
    expect(calls[0]?.body).not.toHaveProperty('includeInAvailable');
  });

  it('shows the generic validation alert when the API names body.includeInAvailable (error path)', async () => {
    stubApi({
      'POST /accounts': {
        status: 400,
        body: { code: 'VALIDATION_FAILED', fields: ['body.includeInAvailable'] },
      },
    });
    renderApp(<CreateAccountContainer />);
    const user = userEvent.setup();

    await fillName(user, 'Caja');
    await choose(user);
    await submit(user);

    expect((await screen.findByRole('alert')).textContent).toContain(es.errors.validationFailed);
  });
});

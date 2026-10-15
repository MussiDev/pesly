// @vitest-environment happy-dom
import { formatMoney, type AccountResponse } from '@pesly/shared';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import en from '../messages/en.json';
import es from '../messages/es.json';
import {
  SetBalanceDialog,
  type SetBalanceDialogProps,
} from '../src/features/accounts/components/set-balance-dialog';

afterEach(cleanup);

const CATALOGS = { es, en } as const;

function renderIntl(ui: ReactElement, locale: 'es' | 'en' = 'es') {
  return render(
    <NextIntlClientProvider locale={locale} timeZone="UTC" messages={CATALOGS[locale]}>
      {ui}
    </NextIntlClientProvider>,
  );
}

/** Intl uses no-break spaces; Testing Library collapses them, so expectations do too. */
function flat(text: string | null | undefined): string {
  return (text ?? '').replace(/\s/g, ' ');
}

function money(value: bigint, currency: 'ARS' | 'USD', locale: 'es' | 'en'): string {
  return flat(formatMoney(value, currency, locale));
}

const CAJA: AccountResponse = {
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
};

const noop = () => undefined;

function props(overrides: Partial<SetBalanceDialogProps> = {}): SetBalanceDialogProps {
  return {
    account: CAJA,
    twoFactor: 'disabled',
    online: true,
    pending: false,
    failure: undefined,
    onConfirm: noop,
    onCancel: noop,
    ...overrides,
  };
}

const t = es.accounts.setBalance;

function target() {
  return screen.getByLabelText<HTMLInputElement>(t.target);
}

function confirm() {
  return screen.getByRole<HTMLButtonElement>('button', { name: t.confirm });
}

describe('SetBalanceDialog', () => {
  it('shows the current balance and, as the target is typed, the signed difference (AC-10)', async () => {
    renderIntl(<SetBalanceDialog {...props()} />);
    const user = userEvent.setup();

    expect(flat(screen.getByText(/^Saldo actual:/).textContent)).toBe(
      `Saldo actual: ${money(150000n, 'ARS', 'es')}`,
    );

    await user.type(target(), '2000');
    expect(flat(screen.getByText(/^Diferencia:/).textContent)).toBe(
      `Diferencia: +${money(50000n, 'ARS', 'es')}`,
    );

    await user.clear(target());
    await user.type(target(), '1000');
    expect(flat(screen.getByText(/^Diferencia:/).textContent)).toBe(
      `Diferencia: ${money(-50000n, 'ARS', 'es')}`,
    );
  });

  it('accepts a negative target and formats USD for the English locale (AC-12)', async () => {
    renderIntl(<SetBalanceDialog {...props({ account: { ...CAJA, currency: 'USD' } })} />, 'en');
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(en.accounts.setBalance.target), '-10');
    expect(flat(screen.getByText(/^Difference:/).textContent)).toBe(
      `Difference: ${money(-151000n, 'USD', 'en')}`,
    );
  });

  it('says there is no difference for an equal target and cannot confirm (AC-11)', async () => {
    const onConfirm = vi.fn();
    renderIntl(<SetBalanceDialog {...props({ onConfirm })} />);
    const user = userEvent.setup();

    await user.type(target(), '1500');

    expect(screen.getByText(t.noDifference)).toBeDefined();
    expect(confirm().disabled).toBe(true);
    await user.click(confirm());
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('cannot confirm an empty target and shows no field error for it (AC-12)', () => {
    renderIntl(<SetBalanceDialog {...props()} />);

    expect(confirm().disabled).toBe(true);
    expect(target().getAttribute('aria-invalid')).toBe('false');
  });

  it('shows the invalid-amount message on the field and disables confirm (AC-12)', async () => {
    renderIntl(<SetBalanceDialog {...props()} />);
    await userEvent.setup().type(target(), '-');

    expect(screen.getByText(es.accounts.errors.amountInvalid)).toBeDefined();
    expect(target().getAttribute('aria-invalid')).toBe('true');
    expect(confirm().disabled).toBe(true);
  });

  it('shows the out-of-range message with the limit formatted for the currency (AC-12)', async () => {
    renderIntl(<SetBalanceDialog {...props()} />);
    await userEvent.setup().type(target(), '10000000000000,01');

    expect(flat(screen.getByText(/no puede superar/).textContent)).toContain(
      money(1_000_000_000_000_000n, 'ARS', 'es'),
    );
    expect(confirm().disabled).toBe(true);
  });

  it('confirms with the target in minor units and the trimmed note, with no code field when 2FA is off (AC-19)', async () => {
    const onConfirm = vi.fn();
    renderIntl(<SetBalanceDialog {...props({ onConfirm })} />);
    const user = userEvent.setup();

    expect(screen.queryByLabelText(t.code)).toBeNull();
    await user.type(target(), '2000');
    await user.type(screen.getByLabelText(t.note), ' Cash count ');
    await user.click(confirm());

    expect(onConfirm).toHaveBeenCalledExactlyOnceWith({ balance: '200000', note: 'Cash count' });
  });

  it('asks for the second-factor code when 2FA is on and sends it (AC-19)', async () => {
    const onConfirm = vi.fn();
    renderIntl(<SetBalanceDialog {...props({ twoFactor: 'enabled', onConfirm })} />);
    const user = userEvent.setup();

    await user.type(target(), '2000');
    expect(confirm().disabled).toBe(true);

    await user.type(screen.getByLabelText(t.code), '123456');
    await user.click(confirm());

    expect(onConfirm).toHaveBeenCalledExactlyOnceWith({
      balance: '200000',
      secondFactorCode: '123456',
    });
  });

  it('refuses a malformed code on the code field without calling back (AC-20)', async () => {
    const onConfirm = vi.fn();
    renderIntl(<SetBalanceDialog {...props({ twoFactor: 'enabled', onConfirm })} />);
    const user = userEvent.setup();

    await user.type(target(), '2000');
    await user.type(screen.getByLabelText(t.code), '12');
    await user.click(confirm());

    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByText(es.errors.secondFactorCodeFormat)).toBeDefined();
    expect(screen.getByLabelText(t.code).getAttribute('aria-invalid')).toBe('true');
  });

  it('shows the invalid-code message on the code field, keeps the dialog and focuses the field (AC-20)', () => {
    renderIntl(
      <SetBalanceDialog
        {...props({
          twoFactor: 'enabled',
          failure: { field: 'code', message: 'errors.codeInvalid' },
        })}
      />,
    );

    const field = screen.getByLabelText(t.code);
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText(es.errors.codeInvalid)).toBeDefined();
    expect(document.activeElement).toBe(field);
    expect(screen.getByRole('dialog')).toBeDefined();
  });

  it('shows a form-level failure in an alert', () => {
    renderIntl(
      <SetBalanceDialog {...props({ failure: { field: 'form', message: 'errors.retryLater' } })} />,
    );

    expect(screen.getByRole('alert').textContent).toContain(es.errors.retryLater);
  });

  it('disables confirm offline and explains that it needs a connection (AC-18)', async () => {
    const onConfirm = vi.fn();
    renderIntl(<SetBalanceDialog {...props({ online: false, onConfirm })} />);
    const user = userEvent.setup();

    await user.type(target(), '2000');

    expect(screen.getByText(t.offline)).toBeDefined();
    expect(confirm().disabled).toBe(true);
    await user.click(confirm());
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('disables confirm while the request is in flight so a double click sends one (threat: DoS)', async () => {
    renderIntl(<SetBalanceDialog {...props({ pending: true })} />);
    await userEvent.setup().type(target(), '2000');

    expect(confirm().disabled).toBe(true);
  });

  it('waits for the 2FA status before it can confirm, and says when it is unavailable', () => {
    const { rerender } = renderIntl(<SetBalanceDialog {...props({ twoFactor: 'loading' })} />);
    expect(confirm().disabled).toBe(true);

    rerender(
      <NextIntlClientProvider locale="es" timeZone="UTC" messages={es}>
        <SetBalanceDialog
          {...props({
            twoFactor: 'unavailable',
            failure: { field: 'form', message: 'errors.network' },
          })}
        />
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole('alert').textContent).toContain(es.errors.network);
    expect(confirm().disabled).toBe(true);
  });

  it('is a labelled dialog and every control has an accessible name (NFR-05)', () => {
    renderIntl(<SetBalanceDialog {...props({ twoFactor: 'enabled' })} />);

    const dialog = screen.getByRole('dialog', { name: t.title.replace('{name}', 'Caja') });
    expect(dialog.getAttribute('aria-describedby')).toBeTruthy();
    expect(screen.getByLabelText(t.target)).toBeDefined();
    expect(screen.getByLabelText(t.note)).toBeDefined();
    expect(screen.getByLabelText(t.code)).toBeDefined();
    expect(screen.getByRole('button', { name: t.confirm })).toBeDefined();
    expect(screen.getByRole('button', { name: es.accounts.actions.cancel })).toBeDefined();
  });

  it('focuses the target on open, confirms with Enter and cancels with Escape from the keyboard (NFR-05)', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    renderIntl(<SetBalanceDialog {...props({ onConfirm, onCancel })} />);
    const user = userEvent.setup();

    expect(document.activeElement).toBe(target());
    await user.keyboard('2000{Enter}');
    expect(onConfirm).toHaveBeenCalledExactlyOnceWith({ balance: '200000' });

    await user.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('returns focus to the element that opened it when it closes (NFR-05)', () => {
    function Opener({ open }: { open: boolean }) {
      return (
        <NextIntlClientProvider locale="es" timeZone="UTC" messages={es}>
          <button type="button">Fijar saldo</button>
          {open ? <SetBalanceDialog {...props()} /> : null}
        </NextIntlClientProvider>
      );
    }
    const { rerender } = render(<Opener open={false} />);
    const opener = screen.getByRole('button', { name: 'Fijar saldo' });
    opener.focus();

    rerender(<Opener open />);
    expect(document.activeElement).toBe(target());

    rerender(<Opener open={false} />);
    expect(document.activeElement).toBe(opener);
  });
});

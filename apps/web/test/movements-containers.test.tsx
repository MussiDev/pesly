// @vitest-environment happy-dom
import type { AccountResponse, CategoryResponse } from '@pesly/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CreateMovementContainer } from '../src/features/movements/containers/create-movement-container';
import { CATALOGS, renderApp, stubApi, type ApiCall } from './support/render-app';
import { category as categoryFixture, uuid } from './support/category-fixtures';

const { es, en } = CATALOGS;

/** 12:30 in Buenos Aires (UTC-3). */
const NOW = '2026-10-02T15:30:00.000Z';

const PROFILE = 'GET /profile';
const ACCOUNTS = 'GET /accounts?archived=false&limit=100';
const CATEGORIES = 'GET /categories?archived=false&limit=100';
const RATES = 'GET /exchange-rates/latest';
const POST = 'POST /movements';

const CAJA_ID = uuid(1);
const DOLARES_ID = uuid(2);
const COMIDA_ID = uuid(11);
const SUELDO_ID = uuid(12);

function account(overrides: Partial<AccountResponse> = {}): AccountResponse {
  return {
    id: CAJA_ID,
    name: 'Caja',
    type: 'cash',
    currency: 'ARS',
    openingBalance: '0',
    balance: '0',
    includeInAvailable: true,
    archived: false,
    archivedAt: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

function category(overrides: Partial<CategoryResponse>) {
  return categoryFixture({ icon: 'utensils', ...overrides });
}

function page<T>(items: T[], total = items.length) {
  return { status: 200, body: { items, total, limit: 100, offset: 0 } };
}

function accountPage(items: AccountResponse[]) {
  return {
    status: 200,
    body: {
      items,
      availableTotals: { ARS: '0', USD: '0' },
      netWorthTotals: { ARS: '0', USD: '0' },
      debtTotals: { ARS: '0', USD: '0' },
      creditCardCount: 0,
      total: items.length,
      limit: 100,
      offset: 0,
    },
  };
}

function profile(timeZone = 'America/Argentina/Buenos_Aires', defaultRateType = 'blue') {
  return {
    status: 200,
    body: {
      displayName: 'Ana',
      email: 'ana@example.com',
      twoFactorEnabled: false,
      deletionReauth: 'password',
      preferences: { defaultRateType, displayCurrency: 'ARS', timeZone, language: 'es' },
    },
  };
}

function rate(rateType: string, sell: string, fetchedAt = NOW) {
  return {
    rateType,
    buy: sell,
    sell,
    providerUpdatedAt: fetchedAt,
    fetchedAt,
  };
}

function rates(...items: ReturnType<typeof rate>[]) {
  return { status: 200, body: { rates: items } };
}

const SAVED = {
  id: uuid(99),
  type: 'expense',
  accountId: CAJA_ID,
  categoryId: COMIDA_ID,
  amount: '150050',
  occurredAt: NOW,
  note: null,
  rate: '12505000',
  rateSource: 'automatic',
  rateType: 'blue',
  createdAt: NOW,
};

function routes(overrides: Record<string, Parameters<typeof stubApi>[0][string]> = {}) {
  return {
    [PROFILE]: profile(),
    [ACCOUNTS]: accountPage([
      account(),
      account({ id: DOLARES_ID, name: 'Dolares', currency: 'USD' }),
    ]),
    [CATEGORIES]: page([
      category({ id: COMIDA_ID, kind: 'expense', name: 'Comida' }),
      category({ id: SUELDO_ID, kind: 'income', name: 'Sueldo' }),
      category({ id: uuid(13), kind: 'expense', name: 'Vieja', archived: true }),
    ]),
    [RATES]: rates(rate('blue', '12505000'), rate('oficial', '9000000')),
    [POST]: { status: 201, body: SAVED },
    ...overrides,
  };
}

beforeEach(() => {
  // Only `Date`: timers stay real so user-event and Testing Library keep working.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
});

afterEach(() => {
  vi.useRealTimers();
});

const field = (name: string) => screen.getByLabelText<HTMLInputElement>(name);
const submit = () => screen.getByRole('button', { name: es.movements.form.submit });
const posts = (calls: ApiCall[]) => calls.filter((call) => call.method === 'POST');

async function open(answers = routes(), locale: 'es' | 'en' = 'es') {
  const stub = stubApi(answers);
  const view = renderApp(<CreateMovementContainer />, { locale });
  await screen.findByLabelText(CATALOGS[locale].movements.fields.amount);
  return { ...stub, ...view };
}

/** Picks the Caja account and the Comida category and types an amount, leaving the rest as is. */
async function fill(amount: string, user = userEvent.setup()) {
  await user.selectOptions(field(es.movements.fields.account), CAJA_ID);
  await user.selectOptions(field(es.movements.fields.category), COMIDA_ID);
  if (amount !== '') await user.type(field(es.movements.fields.amount), amount);
  return user;
}

describe('CreateMovementContainer: loading', () => {
  it('loads the profile, the active accounts, the categories and the latest rates', async () => {
    const { calls } = await open();

    expect(calls.map((call) => call.path).sort()).toEqual(
      [
        '/profile',
        '/accounts?archived=false&limit=100',
        '/categories?archived=false&limit=100',
        '/exchange-rates/latest',
      ].sort(),
    );
  });

  it('pages the categories by 100 until the total is reached', async () => {
    const first = Array.from({ length: 100 }, (_, i) =>
      category({ id: uuid(1000 + i), kind: 'expense', name: `Cat ${i}` }),
    );
    const second = [category({ id: uuid(2000), kind: 'expense', name: 'Ultima' })];
    const { calls } = await open(
      routes({
        [CATEGORIES]: page(first, 101),
        'GET /categories?archived=false&limit=100&offset=100': page(second, 101),
      }),
    );

    expect(calls.map((call) => call.path)).toContain(
      '/categories?archived=false&limit=100&offset=100',
    );
    expect(screen.getByRole('option', { name: 'Ultima' })).toBeDefined();
  });

  it('shows the generic message with a retry when loading fails, and loads on retry (error path)', async () => {
    stubApi(routes({ [PROFILE]: [{ status: 500, body: { code: 'INTERNAL' } }, profile()] }));
    renderApp(<CreateMovementContainer />);

    expect(await screen.findByText(es.errors.unexpected)).toBeDefined();
    await userEvent.setup().click(screen.getByRole('button', { name: es.app.retry }));

    expect(await screen.findByLabelText(es.movements.fields.amount)).toBeDefined();
  });

  it('redirects to sign in when loading answers 401 (error path)', async () => {
    stubApi(
      routes({
        [ACCOUNTS]: { status: 401, body: { code: 'UNAUTHENTICATED' } },
        'POST /auth/refresh': { status: 401, body: { code: 'UNAUTHENTICATED' } },
      }),
    );
    const { router } = renderApp(<CreateMovementContainer />);

    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith('/es/sign-in');
    });
  });
});

describe('CreateMovementContainer: rate (AC-06 to AC-11, AC-20, AC-21)', () => {
  it('prefills the default rate type sell price and sends an automatic rate while untouched (AC-06, AC-07)', async () => {
    const { calls } = await open();
    expect(field(es.movements.fields.rate).value).toBe('1250,5');

    const user = await fill('1.500,50');
    await user.click(submit());

    await waitFor(() => {
      expect(posts(calls)).toHaveLength(1);
    });
    expect(posts(calls)[0]?.body).toEqual({
      type: 'expense',
      accountId: CAJA_ID,
      categoryId: COMIDA_ID,
      amount: '150050',
      occurredAt: NOW,
      rate: { source: 'automatic' },
    });
  });

  it('uses the default rate type chosen in the profile, not another one (AC-06)', async () => {
    await open(routes({ [PROFILE]: profile('America/Argentina/Buenos_Aires', 'oficial') }));

    expect(field(es.movements.fields.rate).value).toBe('900');
  });

  it('formats the prefilled rate in the English notation too (AC-06)', async () => {
    await open(routes(), 'en');

    expect(screen.getByLabelText<HTMLInputElement>(en.movements.fields.rate).value).toBe('1250.5');
  });

  it('sends a manual rate when the prefilled value is edited, even back to the same value (AC-08)', async () => {
    const { calls } = await open();
    const user = await fill('100');
    await user.type(field(es.movements.fields.rate), '0');
    await user.type(field(es.movements.fields.rate), '{Backspace}');
    expect(field(es.movements.fields.rate).value).toBe('1250,5');
    await user.click(submit());

    await waitFor(() => {
      expect(posts(calls)).toHaveLength(1);
    });
    expect(posts(calls)[0]?.body).toMatchObject({ rate: { source: 'manual', value: '12505000' } });
  });

  it('sends the typed manual rate scaled by 10,000 (AC-08)', async () => {
    const { calls } = await open();
    const user = await fill('100');
    await user.clear(field(es.movements.fields.rate));
    await user.type(field(es.movements.fields.rate), '1.300,25');
    await user.click(submit());

    await waitFor(() => {
      expect(posts(calls)).toHaveLength(1);
    });
    expect(posts(calls)[0]?.body).toMatchObject({ rate: { source: 'manual', value: '13002500' } });
  });

  it.each(['0', '0,0000', 'abc', '1,23456', '-5'])(
    'rejects a manual rate of %j on the client and sends nothing (invalid input) (AC-09)',
    async (typed) => {
      const { calls } = await open();
      const user = await fill('100');
      await user.clear(field(es.movements.fields.rate));
      await user.type(field(es.movements.fields.rate), typed);
      await user.click(submit());

      expect(await screen.findByText(es.movements.errors.rateInvalid)).toBeDefined();
      expect(posts(calls)).toHaveLength(0);
      expect(field(es.movements.fields.rate).getAttribute('aria-invalid')).toBe('true');
    },
  );

  it('leaves the rate empty and required with no stored rate, and refuses to save without one (AC-20, AC-21)', async () => {
    const { calls } = await open(routes({ [RATES]: rates() }));
    expect(field(es.movements.fields.rate).value).toBe('');
    expect(field(es.movements.fields.rate).required).toBe(true);

    const user = await fill('100');
    await user.click(submit());

    expect(await screen.findByText(es.movements.errors.rateRequired)).toBeDefined();
    expect(posts(calls)).toHaveLength(0);
  });

  it('keeps working with a required manual rate when the latest rates cannot be loaded', async () => {
    const { calls } = await open(routes({ [RATES]: { status: 500, body: { code: 'INTERNAL' } } }));
    expect(field(es.movements.fields.rate).value).toBe('');
    expect(field(es.movements.fields.rate).required).toBe(true);

    const user = await fill('100');
    await user.type(field(es.movements.fields.rate), '1300');
    await user.click(submit());

    await waitFor(() => {
      expect(posts(calls)).toHaveLength(1);
    });
    expect(posts(calls)[0]?.body).toMatchObject({ rate: { source: 'manual', value: '13000000' } });
  });

  it('shows "rate from 3 h ago" for a rate older than 2 hours (AC-11)', async () => {
    await open(routes({ [RATES]: rates(rate('blue', '12505000', '2026-10-02T12:30:00.000Z')) }));

    expect(screen.getByRole('status').textContent).toBe(
      es.movements.rate.age.replace('{hours}', '3'),
    );
  });

  it('shows no age message for a fresh rate or a rate of exactly 2 hours (AC-11)', async () => {
    await open(routes({ [RATES]: rates(rate('blue', '12505000', '2026-10-02T13:30:00.000Z')) }));

    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows the frozen rate after saving and links back to the list', async () => {
    await open();
    const user = await fill('100');
    await user.click(submit());

    const status = await screen.findByRole('status');
    expect(status.textContent).toContain('1250,50');
    expect(
      within(status).getByRole('link', { name: es.movements.saved.back }).getAttribute('href'),
    ).toBe('/es/movements');
    // The entry form is back, empty, ready for the next movement.
    expect((field(es.movements.fields.amount)).value).toBe('');
  });
});

describe('CreateMovementContainer: amount, account, category and note (AC-02, AC-03, AC-05)', () => {
  // A minus sign cannot be typed here: the field drops it, so "-5" reads as 5.
  it.each(['0', '0,00'])(
    'shows "Amount must be greater than 0" for %j and sends nothing (invalid input) (AC-02)',
    async (typed) => {
      const { calls } = await open();
      const user = await fill(typed);
      await user.click(submit());

      expect(await screen.findByText(es.movements.errors.amountNotPositive)).toBeDefined();
      expect(posts(calls)).toHaveLength(0);
    },
  );

  it('shows the English wording of the amount message (AC-02)', async () => {
    stubApi(routes());
    renderApp(<CreateMovementContainer />, { locale: 'en' });
    await screen.findByLabelText(en.movements.fields.amount);
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText(en.movements.fields.account), CAJA_ID);
    await user.selectOptions(screen.getByLabelText(en.movements.fields.category), COMIDA_ID);
    await user.type(screen.getByLabelText(en.movements.fields.amount), '0');
    await user.click(screen.getByRole('button', { name: en.movements.form.submit }));

    expect(await screen.findByText('Amount must be greater than 0')).toBeDefined();
  });

  // Letters and a third decimal are dropped while typing, so what reaches the container is empty or too large.
  it.each(['abc', '', '10000000000000,01'])(
    'rejects the amount %j with its own message and sends nothing (invalid input)',
    async (typed) => {
      const { calls } = await open();
      const user = await fill(typed);
      await user.click(submit());

      await waitFor(() => {
        expect(field(es.movements.fields.amount).getAttribute('aria-invalid')).toBe('true');
      });
      expect(posts(calls)).toHaveLength(0);
    },
  );

  it('requires an account and a category (invalid input)', async () => {
    const { calls } = await open();
    await userEvent.setup().type(field(es.movements.fields.amount), '100');
    await userEvent.setup().click(submit());

    expect(await screen.findByText(es.movements.errors.accountRequired)).toBeDefined();
    expect(screen.getByText(es.movements.errors.categoryRequired)).toBeDefined();
    expect(posts(calls)).toHaveLength(0);
    expect(document.activeElement).toBe(field(es.movements.fields.account));
  });

  it('filters the category picker by type and hides archived categories (AC-03, AC-05)', async () => {
    await open();
    const options = () =>
      screen
        .getAllByRole('option')
        .map((option) => option.textContent)
        .filter((text) => ['Comida', 'Sueldo', 'Vieja'].includes(text));

    expect(options()).toEqual(['Comida']);
    await userEvent.setup().selectOptions(field(es.movements.fields.type), 'income');

    expect(options()).toEqual(['Sueldo']);
  });

  it('shows default categories with their translated names (AC-03)', async () => {
    await open(
      routes({
        [CATEGORIES]: page([category({ id: COMIDA_ID, kind: 'expense', key: 'food', name: null })]),
      }),
    );

    expect(screen.getByRole('option', { name: 'Comida' })).toBeDefined();
  });

  it('shows default categories in English with the English locale (AC-03)', async () => {
    stubApi(
      routes({
        [CATEGORIES]: page([category({ id: COMIDA_ID, kind: 'expense', key: 'food', name: null })]),
      }),
    );
    renderApp(<CreateMovementContainer />, { locale: 'en' });
    await screen.findByLabelText(en.movements.fields.amount);

    expect(screen.getByRole('option', { name: 'Food' })).toBeDefined();
  });

  it('sends an income with the income category (AC-03)', async () => {
    const { calls } = await open();
    const user = userEvent.setup();
    await user.selectOptions(field(es.movements.fields.type), 'income');
    await user.selectOptions(field(es.movements.fields.account), CAJA_ID);
    await user.selectOptions(field(es.movements.fields.category), SUELDO_ID);
    await user.type(field(es.movements.fields.amount), '2.000');
    await user.click(submit());

    await waitFor(() => {
      expect(posts(calls)).toHaveLength(1);
    });
    expect(posts(calls)[0]?.body).toMatchObject({
      type: 'income',
      categoryId: SUELDO_ID,
      amount: '200000',
    });
  });

  it('sends the trimmed note and rejects one over 500 characters (invalid input)', async () => {
    const { calls } = await open();
    const user = await fill('100');
    fireEvent.change(field(es.movements.fields.note), { target: { value: 'x'.repeat(501) } });
    await user.click(submit());

    expect(
      await screen.findByText(es.movements.errors.noteTooLong.replace('{max}', '500')),
    ).toBeDefined();
    expect(posts(calls)).toHaveLength(0);

    fireEvent.change(field(es.movements.fields.note), { target: { value: '  Almuerzo  ' } });
    await user.click(submit());
    await waitFor(() => {
      expect(posts(calls)).toHaveLength(1);
    });
    expect(posts(calls)[0]?.body).toMatchObject({ note: 'Almuerzo' });
  });
});

describe('CreateMovementContainer: date and time (AC-15, AC-31)', () => {
  it('defaults to now in the user time zone and sends it as a UTC instant (AC-31)', async () => {
    const { calls } = await open();
    expect(field(es.movements.fields.occurredAt).value).toBe('2026-10-02T12:30');

    const user = await fill('100');
    await user.click(submit());

    await waitFor(() => {
      expect(posts(calls)).toHaveLength(1);
    });
    expect(posts(calls)[0]?.body).toMatchObject({ occurredAt: '2026-10-02T15:30:00.000Z' });
  });

  it('turns an edited local date and time into the matching UTC instant (AC-31)', async () => {
    const { calls } = await open();
    fireEvent.change(field(es.movements.fields.occurredAt), {
      target: { value: '2026-10-01T09:15' },
    });
    const user = await fill('100');
    await user.click(submit());

    await waitFor(() => {
      expect(posts(calls)).toHaveLength(1);
    });
    expect(posts(calls)[0]?.body).toMatchObject({ occurredAt: '2026-10-01T12:15:00.000Z' });
  });

  it('uses the time zone of the profile, not the browser one (AC-31)', async () => {
    await open(routes({ [PROFILE]: profile('Asia/Tokyo') }));

    expect(field(es.movements.fields.occurredAt).value).toBe('2026-10-03T00:30');
  });

  it('rejects a later local date on the client and sends nothing (invalid input) (AC-15)', async () => {
    const { calls } = await open();
    fireEvent.change(field(es.movements.fields.occurredAt), {
      target: { value: '2026-10-03T10:00' },
    });
    const user = await fill('100');
    await user.click(submit());

    expect(await screen.findByText(es.errors.movementDateInFuture)).toBeDefined();
    expect(posts(calls)).toHaveLength(0);
  });

  it('accepts a later time on the same local day, as the API does (AC-15)', async () => {
    const { calls } = await open();
    fireEvent.change(field(es.movements.fields.occurredAt), {
      target: { value: '2026-10-02T23:59' },
    });
    const user = await fill('100');
    await user.click(submit());

    await waitFor(() => {
      expect(posts(calls)).toHaveLength(1);
    });
  });

  it('refuses a skipped daylight-saving local time with a message (invalid input) (AC-15)', async () => {
    const { calls } = await open(routes({ [PROFILE]: profile('America/New_York') }));
    fireEvent.change(field(es.movements.fields.occurredAt), {
      target: { value: '2026-03-08T02:30' },
    });
    const user = await fill('100');
    await user.click(submit());

    expect(await screen.findByText(es.movements.errors.dateSkipped)).toBeDefined();
    expect(posts(calls)).toHaveLength(0);
  });

  it('rejects an empty date and one before 1970 (invalid input)', async () => {
    const { calls } = await open();
    const user = await fill('100');
    fireEvent.change(field(es.movements.fields.occurredAt), { target: { value: '' } });
    await user.click(submit());
    expect(await screen.findByText(es.movements.errors.dateInvalid)).toBeDefined();

    fireEvent.change(field(es.movements.fields.occurredAt), {
      target: { value: '1969-12-31T10:00' },
    });
    await user.click(submit());
    expect(screen.getByText(es.movements.errors.dateInvalid)).toBeDefined();
    expect(posts(calls)).toHaveLength(0);
  });
});

describe('CreateMovementContainer: server answers (AC-01, AC-15, AC-21, AC-25, AC-26, AC-28)', () => {
  async function save(answer: Parameters<typeof stubApi>[0][string]) {
    const stub = await open(routes({ [POST]: answer }));
    const user = await fill('100');
    await user.click(submit());
    return { ...stub, user };
  }

  /** The error message is the last element the control is described by (a hint may come first). */
  const describedBy = (control: HTMLElement) =>
    document.getElementById(control.getAttribute('aria-describedby')?.split(' ').pop() ?? '')
      ?.textContent;

  it('shows the unarchive-first message on the account field for ACCOUNT_ARCHIVED, not the global one (AC-25)', async () => {
    await save({ status: 409, body: { code: 'ACCOUNT_ARCHIVED' } });

    const account = field(es.movements.fields.account);
    await waitFor(() => {
      expect(account.getAttribute('aria-invalid')).toBe('true');
    });
    expect(describedBy(account)).toBe(es.movements.errors.accountArchived);
    expect(describedBy(account)).not.toBe(es.errors.accountArchived);
  });

  it('shows the unarchive-first message on the category field for CATEGORY_ARCHIVED (AC-26)', async () => {
    await save({ status: 409, body: { code: 'CATEGORY_ARCHIVED' } });

    const control = field(es.movements.fields.category);
    await waitFor(() => {
      expect(control.getAttribute('aria-invalid')).toBe('true');
    });
    expect(describedBy(control)).toBe(es.errors.categoryArchived);
  });

  it('shows RATE_REQUIRED on the rate field (AC-21)', async () => {
    await save({ status: 400, body: { code: 'RATE_REQUIRED' } });

    const control = field(es.movements.fields.rate);
    await waitFor(() => {
      expect(describedBy(control)).toBe(es.errors.rateRequired);
    });
  });

  it('shows MOVEMENT_DATE_IN_FUTURE on the date field (AC-15)', async () => {
    await save({ status: 400, body: { code: 'MOVEMENT_DATE_IN_FUTURE' } });

    await waitFor(() => {
      expect(describedBy(field(es.movements.fields.occurredAt))).toBe(
        es.errors.movementDateInFuture,
      );
    });
  });

  it('shows MOVEMENT_CATEGORY_KIND_MISMATCH on the category field', async () => {
    await save({ status: 400, body: { code: 'MOVEMENT_CATEGORY_KIND_MISMATCH' } });

    await waitFor(() => {
      expect(describedBy(field(es.movements.fields.category))).toBe(
        es.errors.movementCategoryKindMismatch,
      );
    });
  });

  it('shows the too-many-requests message with the seconds from Retry-After (AC-28)', async () => {
    await save({ status: 429, body: { code: 'RATE_LIMITED' }, headers: { 'Retry-After': '42' } });

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(es.movements.errors.rateLimited.replace('{seconds}', '42'));
  });

  it('shows the too-many-requests message without seconds when Retry-After is missing (AC-28)', async () => {
    await save({ status: 429, body: { code: 'RATE_LIMITED' } });

    expect((await screen.findByRole('alert')).textContent).toBe(
      es.movements.errors.rateLimitedGeneric,
    );
  });

  it('redirects to sign in on a 401 (error path) (AC-01)', async () => {
    const stub = await open(
      routes({
        [POST]: { status: 401, body: { code: 'UNAUTHENTICATED' } },
        'POST /auth/refresh': { status: 401, body: { code: 'UNAUTHENTICATED' } },
      }),
    );
    const user = await fill('100');
    await user.click(submit());

    await waitFor(() => {
      expect(stub.router.replace).toHaveBeenCalledWith('/es/sign-in');
    });
  });

  it('shows the generic message on a server error, keeps what was typed and allows a retry (error path)', async () => {
    const { calls, user } = await save([
      { status: 500, body: { code: 'INTERNAL' } },
      { status: 201, body: SAVED },
    ]);

    expect(await screen.findByText(es.errors.unexpected)).toBeDefined();
    expect(field(es.movements.fields.amount).value).toBe('100');
    expect(submit().hasAttribute('disabled')).toBe(false);

    await user.click(submit());
    await waitFor(() => {
      expect(posts(calls)).toHaveLength(2);
    });
    expect(await screen.findByRole('status')).toBeDefined();
  });

  it('shows the network message when the API is unreachable (error path)', async () => {
    await save('network-error');

    expect(await screen.findByText(es.errors.network)).toBeDefined();
  });
});

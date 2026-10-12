// @vitest-environment happy-dom
import { formatMoney, type AccountResponse, type CategoryResponse } from '@pesly/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditMovementContainer } from '../src/features/movements/containers/edit-movement-container';
import { CATALOGS, renderApp, stubApi, type ApiCall } from './support/render-app';
import { category as categoryFixture, uuid } from './support/category-fixtures';

const { es, en } = CATALOGS;

const NOW = '2026-10-02T15:30:00.123Z';
const CAJA_ID = uuid(1);
const COMIDA_ID = uuid(11);
const MOVEMENT_ID = uuid(99);
const GROUP_ID = uuid(50);
const EXPENSE_ID = uuid(51);

const GET_MOVEMENT = `GET /movements/${MOVEMENT_ID}`;
const PUT_MOVEMENT = `PUT /movements/${MOVEMENT_ID}`;
const GET_GROUP = `GET /groups/${GROUP_ID}`;

const account = (): AccountResponse => ({
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
});

const category = (): CategoryResponse =>
  categoryFixture({ icon: 'utensils', id: COMIDA_ID, kind: 'expense', name: 'Comida' });

const PROFILE = {
  status: 200,
  body: {
    displayName: 'Ana',
    email: 'ana@example.com',
    twoFactorEnabled: false,
    deletionReauth: 'password',
    preferences: {
      defaultRateType: 'blue',
      displayCurrency: 'ARS',
      timeZone: 'America/Argentina/Buenos_Aires',
      language: 'es',
    },
  },
};

const STORED = {
  id: MOVEMENT_ID,
  type: 'expense',
  accountId: CAJA_ID,
  categoryId: COMIDA_ID,
  destinationAccountId: null,
  amount: '150050',
  destinationAmount: null,
  occurredAt: NOW,
  note: 'almuerzo',
  rate: '9000000',
  rateSource: 'manual',
  rateType: null,
  createdAt: NOW,
  tags: [],
};

const GROUP = {
  id: GROUP_ID,
  name: 'Flatmates',
  defaultRateType: 'blue',
  role: 'member',
  memberCount: 1,
  createdAt: '2026-10-01T00:00:00.000Z',
  selfMemberId: 'm1',
  members: [],
  formerMembers: [],
};

const link = (adopted: boolean) => ({ groupId: GROUP_ID, expenseId: EXPENSE_ID, adopted });

function routes(groupExpense: ReturnType<typeof link> | null, extra: Record<string, never> = {}) {
  return {
    'GET /profile': PROFILE,
    'GET /accounts?archived=false&limit=100': {
      status: 200,
      body: {
        items: [account()],
        availableTotals: { ARS: '0', USD: '0' },
        netWorthTotals: { ARS: '0', USD: '0' },
        debtTotals: { ARS: '0', USD: '0' },
        creditCardCount: 0,
        total: 1,
        limit: 100,
        offset: 0,
      },
    },
    'GET /accounts?archived=true&limit=100': {
      status: 200,
      body: {
        items: [],
        availableTotals: { ARS: '0', USD: '0' },
        netWorthTotals: { ARS: '0', USD: '0' },
        debtTotals: { ARS: '0', USD: '0' },
        creditCardCount: 0,
        total: 0,
        limit: 100,
        offset: 0,
      },
    },
    'GET /categories?archived=false&limit=100': {
      status: 200,
      body: { items: [category()], total: 1, limit: 100, offset: 0 },
    },
    'GET /categories?archived=true&limit=100': {
      status: 200,
      body: { items: [], total: 0, limit: 100, offset: 0 },
    },
    'GET /exchange-rates/latest': {
      status: 200,
      body: {
        rates: [
          {
            rateType: 'blue',
            buy: '12505000',
            sell: '12505000',
            providerUpdatedAt: NOW,
            fetchedAt: NOW,
          },
        ],
      },
    },
    [GET_MOVEMENT]: { status: 200, body: { ...STORED, groupExpense } },
    [GET_GROUP]: { status: 200, body: GROUP },
    [PUT_MOVEMENT]: { status: 200, body: STORED },
    ...extra,
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-02T15:40:00.000Z'));
  globalThis.indexedDB = new IDBFactory();
});

afterEach(() => {
  vi.useRealTimers();
});

async function open(
  answers: ReturnType<typeof routes>,
  locale: 'es' | 'en' = 'es',
  calls?: { current?: ApiCall[] },
) {
  const stub = stubApi(answers);
  if (calls) calls.current = stub.calls;
  const view = renderApp(<EditMovementContainer movementId={MOVEMENT_ID} />, { locale });
  await screen.findByRole('heading', { name: CATALOGS[locale].movements.edit.title });
  return { ...stub, ...view };
}

// Intl output uses no-break spaces; the default matcher normalizes only the node text.
const sameText = (expected: string) => (content: string) =>
  content.replace(/\s/g, ' ') === expected.replace(/\s/g, ' ');

const puts = (calls: ApiCall[]) => calls.filter((call) => call.method === 'PUT');

describe('EditMovementContainer: group link notice', () => {
  it('shows no notice and no send action for a free movement (AC-01)', async () => {
    const { calls } = await open(routes(null));

    expect(screen.queryByText(/Este movimiento pertenece/)).toBeNull();
    expect(screen.queryByText(es.movements.edit.lockedFields)).toBeNull();
    expect(screen.queryByRole('link', { name: /grupo/i })).toBeNull();
    expect(calls.some((call) => call.path.startsWith('/groups/'))).toBe(false);
    expect(screen.getByLabelText(es.movements.fields.amount)).toBeDefined();
  });

  it('names the group and the locked fields for an adopted movement (AC-39)', async () => {
    const { calls } = await open(routes(link(true)));

    expect(
      await screen.findByText(es.movements.edit.groupNotice.replace('{group}', 'Flatmates')),
    ).toBeDefined();
    expect(screen.getByText(es.movements.edit.lockedFields)).toBeDefined();
    expect(calls.filter((call) => call.path === `/groups/${GROUP_ID}`)).toHaveLength(1);
  });

  it('shows the neutral text when the group answers 404 (AC-39)', async () => {
    await open(
      routes(link(true), { [GET_GROUP]: { status: 404, body: { code: 'NOT_FOUND' } } as never }),
    );

    expect(await screen.findByText(es.movements.edit.groupNoticeUnknown)).toBeDefined();
    expect(screen.getByText(es.movements.edit.lockedFields)).toBeDefined();
  });

  it('shows the notice in English too (AC-34)', async () => {
    await open(routes(link(true)), 'en');

    expect(
      await screen.findByText(en.movements.edit.groupNotice.replace('{group}', 'Flatmates')),
    ).toBeDefined();
    expect(screen.getByText(en.movements.edit.lockedFields)).toBeDefined();
  });

  it('keeps every field editable when the expense was created in the group (AC-40)', async () => {
    await open(routes(link(false)));

    expect(
      await screen.findByText(es.movements.edit.groupNotice.replace('{group}', 'Flatmates')),
    ).toBeDefined();
    expect(screen.queryByText(es.movements.edit.lockedFields)).toBeNull();
    expect(screen.getByLabelText<HTMLInputElement>(es.movements.fields.amount).readOnly).toBe(
      false,
    );
    expect(screen.getByLabelText(es.movements.fields.account)).toBeDefined();
    expect(screen.getByLabelText(es.movements.fields.occurredAt)).toBeDefined();
  });
});

describe('EditMovementContainer: locked fields', () => {
  it('shows amount, account and date as read-only text and saves the rest with the stored values (AC-26)', async () => {
    const { calls, router } = await open(routes(link(true)));
    await screen.findByText(es.movements.edit.lockedFields);
    const user = userEvent.setup();

    expect(screen.queryByLabelText(es.movements.fields.amount)).toBeNull();
    expect(screen.queryByLabelText(es.movements.fields.account)).toBeNull();
    expect(screen.queryByLabelText(es.movements.fields.occurredAt)).toBeNull();
    expect(screen.getByText(sameText(formatMoney(150050n, 'ARS', 'es')))).toBeDefined();
    expect(screen.getByText('Caja (ARS)')).toBeDefined();

    await user.clear(screen.getByLabelText(es.movements.fields.note));
    await user.type(screen.getByLabelText(es.movements.fields.note), 'cena');
    await user.click(screen.getByRole('button', { name: es.movements.form.save }));

    await waitFor(() => {
      expect(router.push).toHaveBeenCalledWith('/es/movements');
    });
    expect(puts(calls)).toHaveLength(1);
    expect(puts(calls)[0]?.body).toMatchObject({
      accountId: CAJA_ID,
      amount: '150050',
      occurredAt: NOW,
      note: 'cena',
      categoryId: COMIDA_ID,
    });
  });
});

describe('EditMovementContainer: lock refused on save', () => {
  it.each([
    ['es', es],
    ['en', en],
  ] as const)(
    'keeps the typed values and shows the message in %s (AC-25, AC-34)',
    async (locale, catalog) => {
      await open(
        routes(null, {
          [PUT_MOVEMENT]: {
            status: 409,
            body: { code: 'MOVEMENT_LOCKED_BY_GROUP_EXPENSE' },
          } as never,
        }),
        locale,
      );
      const user = userEvent.setup();
      const amount = screen.getByLabelText<HTMLInputElement>(catalog.movements.fields.amount);

      await user.clear(amount);
      await user.type(amount, '90');
      await user.click(screen.getByRole('button', { name: catalog.movements.form.save }));

      expect(await screen.findByText(catalog.errors.movementLockedByGroupExpense)).toBeDefined();
      expect(screen.getByLabelText<HTMLInputElement>(catalog.movements.fields.amount).value).toBe(
        '90',
      );
      expect(within(document.body).queryByText(catalog.movements.edit.lockedFields)).toBeNull();
    },
  );
});

describe('EditMovementContainer: locked amount and date formatting', () => {
  it.each([
    ['es', '1500,50'],
    ['en', '1,500.50'],
  ] as const)('shows the amount as money in %s, not raw digits', async (locale, digits) => {
    await open(routes(link(true)), locale);
    await screen.findByText(CATALOGS[locale].movements.edit.lockedFields);

    const text = formatMoney(150050n, 'ARS', locale);
    expect(text).toContain(digits);
    expect(screen.getByText(sameText(text))).toBeDefined();
    expect(screen.queryByText('150050')).toBeNull();
    expect(screen.queryByText(digits)).toBeNull();
  });
});

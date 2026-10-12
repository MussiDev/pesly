// @vitest-environment happy-dom
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import {
  SendToGroupContainer,
  SendToGroupRouteContainer,
} from '../src/features/movements/send-to-group/send-to-group-container';
import { CATALOGS, renderApp, stubApi } from './support/render-app';

const { en, es } = CATALOGS;
const t = en.movements.sendToGroup;
const tEs = es.movements.sendToGroup;

const MOV = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const G1 = '55555555-5555-4555-8555-555555555555';
const G2 = '66666666-6666-4666-8666-666666666666';
const ANA = '11111111-1111-4111-8111-111111111111';
const BRUNO = '22222222-2222-4222-8222-222222222222';
const CARLA = '33333333-3333-4333-8333-333333333333';
const DANI = '44444444-4444-4444-8444-444444444444';
const CAT = '77777777-7777-4777-8777-777777777777';

const ACCOUNT_ID = '99999999-9999-4999-8999-999999999999';
const MOVEMENT_PATH = `GET /movements/${MOV}`;
const ACCOUNT_PATH = `GET /accounts/${ACCOUNT_ID}`;
const GROUPS = 'GET /groups';
const OPTIONS1 = `GET /groups/${G1}/expense-options`;
const OPTIONS2 = `GET /groups/${G2}/expense-options`;
const SEND1 = `POST /groups/${G1}/expenses/from-movement`;

const ZONE = 'America/Argentina/Buenos_Aires';

const movement = (overrides: Record<string, unknown> = {}) => ({
  id: MOV,
  type: 'expense',
  accountId: ACCOUNT_ID,
  categoryId: null,
  destinationAccountId: null,
  amount: '1000000',
  destinationAmount: null,
  occurredAt: '2026-10-11T15:00:00.000Z',
  note: 'Groceries',
  rate: null,
  rateSource: null,
  rateType: null,
  createdAt: '2026-10-11T15:00:00.000Z',
  tags: [],
  groupExpense: null,
  ...overrides,
});

const group = (id: string, name: string) => ({
  id,
  name,
  defaultRateType: 'blue',
  role: 'member',
  memberCount: 4,
  createdAt: '2026-10-01T00:00:00.000Z',
});

const member = (id: string, displayName: string) => ({
  id,
  displayName,
  isGhost: false,
  joinedAt: '2026-10-01T00:00:00.000Z',
});

const options = (categories: unknown[] = []) => ({
  selfMemberId: ANA,
  members: [
    member(ANA, 'Ana'),
    member(BRUNO, 'Bruno'),
    member(CARLA, 'Carla'),
    member(DANI, 'Dani'),
  ],
  categories,
  defaultSplit: { mode: 'equal' },
  defaultRateType: 'blue',
});

const groupCategory = {
  id: CAT,
  defaultKey: null,
  name: 'Rent',
  icon: 'home',
  color: 'blue',
  archivedAt: null,
};

const sent = (autoCategory: 'created' | 'restored' | null) => ({
  id: '88888888-8888-4888-8888-888888888888',
  groupId: G1,
  payerMemberId: ANA,
  createdByMemberId: ANA,
  amount: '1000000',
  currency: 'ARS',
  occurredAt: '2026-10-11T15:00:00.000Z',
  categoryId: CAT,
  description: 'Groceries',
  splitMode: 'equal',
  payerMovementId: MOV,
  createdAt: '2026-10-11T15:00:00.000Z',
  shares: [],
  version: 1,
  autoCategory,
});

const account = {
  id: ACCOUNT_ID,
  name: 'Wallet',
  type: 'cash',
  currency: 'ARS',
  openingBalance: '0',
  balance: '0',
  includeInAvailable: true,
  archived: false,
  archivedAt: null,
  createdAt: '2026-10-01T00:00:00.000Z',
};

type Routes = Parameters<typeof stubApi>[0];

function routes(overrides: Routes = {}): Routes {
  return {
    [MOVEMENT_PATH]: { status: 200, body: movement() },
    [GROUPS]: { status: 200, body: [group(G1, 'Casa'), group(G2, 'Viaje')] },
    [ACCOUNT_PATH]: { status: 200, body: account },
    [OPTIONS1]: { status: 200, body: options() },
    [OPTIONS2]: { status: 200, body: options() },
    [SEND1]: { status: 201, body: sent(null) },
    ...overrides,
  };
}

function open(locale: 'en' | 'es' = 'en') {
  return renderApp(<SendToGroupContainer movementId={MOV} timeZone={ZONE} />, { locale });
}

function setOnline(online: boolean): void {
  Object.defineProperty(navigator, 'onLine', { value: online, configurable: true });
}

afterEach(() => {
  setOnline(true);
});

const radio = (name: string) => screen.findByRole('radio', { name });
const confirm = () => screen.findByRole('button', { name: t.confirm });

describe('SendToGroupContainer', () => {
  it('shows the amount and date as text and lists the groups (AC-06)', async () => {
    stubApi(routes());
    open();
    expect(await radio('Casa')).toBeTruthy();
    expect(await radio('Viaje')).toBeTruthy();
    expect(screen.getByText(/10,000\.00.ARS/)).toBeTruthy();
    expect(screen.getByText(/2026/)).toBeTruthy();
    expect(screen.getByRole('heading', { name: t.title })).toBeTruthy();
  });

  it('lists the categories with the automatic one chosen, also with none, and prefills the description (AC-07)', async () => {
    const longNote = 'x'.repeat(250);
    stubApi(routes({ [MOVEMENT_PATH]: { status: 200, body: movement({ note: longNote }) } }));
    const user = userEvent.setup();
    open();
    await user.click(await radio('Casa'));
    const select = await screen.findByLabelText<HTMLSelectElement>(t.category);
    expect(select.value).toBe('automatic');
    expect(select.selectedOptions[0]?.textContent).toBe(t.automaticCategory);
    expect(t.automaticCategory).toBe(
      `Automatic (the movement's own category, or "Other expenses")`,
    );
    expect(tEs.automaticCategory).toBe(
      'Automática (la misma categoría del movimiento u "Otros gastos")',
    );
    expect(select.options).toHaveLength(1);
    expect(screen.getByLabelText<HTMLInputElement>(t.description).value).toBe('x'.repeat(200));
  });

  it('lists the active group categories after the automatic one', async () => {
    stubApi(
      routes({
        [OPTIONS1]: {
          status: 200,
          body: options([
            groupCategory,
            { ...groupCategory, id: DANI, name: 'Old', archivedAt: '2026-10-02T00:00:00.000Z' },
          ]),
        },
      }),
    );
    const user = userEvent.setup();
    open();
    await user.click(await radio('Casa'));
    const select = await screen.findByLabelText<HTMLSelectElement>(t.category);
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
      t.automaticCategory,
      'Rent',
    ]);
  });

  it.each([
    ['created', 'en', t.categoryCreated],
    ['restored', 'en', t.categoryRestored],
    ['created', 'es', tEs.categoryCreated],
    ['restored', 'es', tEs.categoryRestored],
  ] as const)(
    'a send answered %s shows the notice in %s with a link and no navigation (AC-53)',
    async (change, locale, text) => {
      stubApi(routes({ [SEND1]: { status: 201, body: sent(change) } }));
      const user = userEvent.setup();
      const { router } = open(locale);
      const labels = locale === 'en' ? t : tEs;
      await user.click(await radio('Casa'));
      await user.click(await screen.findByRole('button', { name: labels.confirm }));
      const notice = await screen.findByRole('status');
      expect(notice.textContent).toContain(text);
      expect(notice.textContent).not.toMatch(/\d/);
      const link = screen.getByRole('link', { name: labels.viewExpenses });
      expect(link.getAttribute('href')).toContain(`/groups/${G1}/expenses`);
      expect(router.push).not.toHaveBeenCalled();
    },
  );

  it('a send answered with no automatic category goes straight to the expense list', async () => {
    stubApi(routes());
    const user = userEvent.setup();
    const { router } = open();
    await user.click(await radio('Casa'));
    await user.click(await confirm());
    await waitFor(() => {
      expect(router.push).toHaveBeenCalledWith(`/en/groups/${G1}/expenses`);
    });
  });

  it('a person with one group sees it chosen with its options loaded and no tap (AC-35)', async () => {
    const { calls } = stubApi(routes({ [GROUPS]: { status: 200, body: [group(G1, 'Casa')] } }));
    open();
    const only = await radio('Casa');
    expect(only.getAttribute('aria-checked')).toBe('true');
    expect(await screen.findByLabelText(t.category)).toBeTruthy();
    expect(calls.map((c) => `${c.method} ${c.path}`).sort()).toEqual(
      [MOVEMENT_PATH, GROUPS, ACCOUNT_PATH, OPTIONS1].sort(),
    );
  });

  it('a person with no group sees the empty message and the link to the groups list (AC-08)', async () => {
    stubApi(routes({ [GROUPS]: { status: 200, body: [] } }));
    open();
    expect(await screen.findByText(t.noGroups)).toBeTruthy();
    const link = screen.getByRole('link', { name: t.goToGroups });
    expect(link.getAttribute('href')).toContain('/groups');
    expect(screen.queryByRole('button', { name: t.confirm })).toBeNull();
  });

  it('one tap on confirm sends the equal split among all members and nothing typed (AC-36, AC-37)', async () => {
    const { calls } = stubApi(routes());
    const user = userEvent.setup();
    open();
    await user.click(await radio('Casa'));
    expect(await screen.findByText('Equal among 4 members: 2,500.00 ARS each')).toBeTruthy();
    await user.click(await confirm());
    await waitFor(() => {
      expect(calls.some((c) => c.method === 'POST')).toBe(true);
    });
    const post = calls.find((c) => c.method === 'POST');
    expect(post?.path).toBe(`/groups/${G1}/expenses/from-movement`);
    expect(post?.body).toEqual({
      movementId: MOV,
      description: 'Groceries',
      split: { mode: 'equal', memberIds: [ANA, BRUNO, CARLA, DANI] },
    });
  });

  it('sends a chosen group category as categoryId', async () => {
    const { calls } = stubApi(
      routes({ [OPTIONS1]: { status: 200, body: options([groupCategory]) } }),
    );
    const user = userEvent.setup();
    open();
    await user.click(await radio('Casa'));
    await user.selectOptions(await screen.findByLabelText(t.category), CAT);
    await user.click(await confirm());
    await waitFor(() => {
      expect(calls.some((c) => c.method === 'POST')).toBe(true);
    });
    expect(
      (calls.find((c) => c.method === 'POST')?.body as { categoryId: string }).categoryId,
    ).toBe(CAT);
  });

  it('the split editor sends a changed percentage split and a total mismatch blocks the submit (AC-10, AC-11, AC-38)', async () => {
    const { calls } = stubApi(routes());
    const user = userEvent.setup();
    open();
    await user.click(await radio('Casa'));
    await user.click(await screen.findByRole('button', { name: t.changeSplit }));
    await user.click(screen.getByRole('radio', { name: en.groups.split.modes.percentage }));
    await user.type(screen.getByLabelText('Percentage of Ana'), '60');
    await user.type(screen.getByLabelText('Percentage of Bruno'), '30');
    const button = await confirm();
    expect((button as HTMLButtonElement).disabled).toBe(true);
    await user.click(button);
    expect(calls.some((c) => c.method === 'POST')).toBe(false);

    await user.type(screen.getByLabelText('Percentage of Carla'), '10');
    await user.click(await confirm());
    await waitFor(() => {
      expect(calls.some((c) => c.method === 'POST')).toBe(true);
    });
    expect((calls.find((c) => c.method === 'POST')?.body as { split: unknown }).split).toEqual({
      mode: 'percentage',
      shares: [
        { memberId: ANA, basisPoints: 6000 },
        { memberId: BRUNO, basisPoints: 3000 },
        { memberId: CARLA, basisPoints: 1000 },
      ],
    });
  });

  it('an empty description shows the field error and sends nothing (AC-09)', async () => {
    const { calls } = stubApi(routes());
    const user = userEvent.setup();
    open();
    await user.click(await radio('Casa'));
    await user.clear(await screen.findByLabelText(t.description));
    await user.click(await confirm());
    expect(
      await screen.findByText(en.groups.expenses.form.errors.descriptionRequired),
    ).toBeTruthy();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
    expect(document.activeElement).toBe(screen.getByLabelText(t.description));
  });

  it.each([
    ['en', t.defaultDescription, 'Expense'],
    ['es', tEs.defaultDescription, 'Gasto'],
  ] as const)(
    'a movement without a note prefills the default description in %s and one tap sends it (NFR-08)',
    async (locale, defaultDescription, expected) => {
      expect(defaultDescription).toBe(expected);
      const { calls } = stubApi(
        routes({ [MOVEMENT_PATH]: { status: 200, body: movement({ note: null }) } }),
      );
      const user = userEvent.setup();
      open(locale);
      const labels = locale === 'en' ? t : tEs;
      await user.click(await radio('Casa'));
      expect((await screen.findByLabelText<HTMLInputElement>(labels.description)).value).toBe(
        expected,
      );
      await user.click(await screen.findByRole('button', { name: labels.confirm }));
      await waitFor(() => {
        expect(calls.some((c) => c.method === 'POST')).toBe(true);
      });
      expect(
        (calls.find((c) => c.method === 'POST')?.body as { description: string }).description,
      ).toBe(expected);
    },
  );

  it('clearing the prefilled default description shows the error and sends nothing', async () => {
    const { calls } = stubApi(
      routes({ [MOVEMENT_PATH]: { status: 200, body: movement({ note: null }) } }),
    );
    const user = userEvent.setup();
    open();
    await user.click(await radio('Casa'));
    await user.clear(await screen.findByLabelText(t.description));
    await user.click(await confirm());
    expect(
      await screen.findByText(en.groups.expenses.form.errors.descriptionRequired),
    ).toBeTruthy();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('makes 3 requests before a group is chosen (the account gives the currency), 1 after and exactly 1 to send (NFR-02)', async () => {
    const { calls } = stubApi(routes());
    const user = userEvent.setup();
    open();
    await radio('Casa');
    expect(calls).toHaveLength(3);
    await user.click(await radio('Casa'));
    await screen.findByLabelText(t.category);
    expect(calls).toHaveLength(4);
    await user.click(await confirm());
    await waitFor(() => {
      expect(calls).toHaveLength(5);
    });
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1);
  });

  it('offline offers no form, says sending needs a connection and sends no request (AC-02)', async () => {
    setOnline(false);
    const { calls } = stubApi(routes());
    open();
    expect(await screen.findByText(t.offline)).toBeTruthy();
    expect(screen.queryByRole('button', { name: t.confirm })).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it.each([
    ['en', en],
    ['es', es],
  ] as const)(
    'a 409 already sent keeps the screen and shows the message in %s with no amount (AC-21)',
    async (locale, catalog) => {
      stubApi(
        routes({
          [SEND1]: {
            status: 409,
            body: { code: 'GROUP_MOVEMENT_ALREADY_SENT', message: 'x' },
          },
        }),
      );
      const user = userEvent.setup();
      open(locale);
      await user.click(await radio('Casa'));
      await user.click(
        await screen.findByRole('button', { name: catalog.movements.sendToGroup.confirm }),
      );
      const alert = await screen.findByRole('alert');
      expect(alert.textContent).toBe(catalog.errors.groupMovementAlreadySent);
      expect(alert.textContent).not.toMatch(/\d/);
      expect(screen.getByLabelText(catalog.movements.sendToGroup.description)).toBeTruthy();
    },
  );

  it('a 404 for the movement shows the not-found state (AC-34)', async () => {
    stubApi(
      routes({ [MOVEMENT_PATH]: { status: 404, body: { code: 'NOT_FOUND', message: 'x' } } }),
    );
    open();
    expect(await screen.findByText(t.notFound)).toBeTruthy();
    expect(screen.queryByRole('radio')).toBeNull();
  });

  it('a movement already sent says so and offers no form', async () => {
    stubApi(
      routes({
        [MOVEMENT_PATH]: {
          status: 200,
          body: movement({ groupExpense: { groupId: G1, expenseId: CAT, adopted: false } }),
        },
      }),
    );
    open();
    expect(await screen.findByText(t.alreadySent)).toBeTruthy();
    expect(screen.queryByRole('button', { name: t.confirm })).toBeNull();
  });

  it('a malformed id renders not-found and sends no request', async () => {
    const { calls } = stubApi(routes());
    renderApp(<SendToGroupRouteContainer />, { search: 'id=not-a-uuid' });
    expect(await screen.findByText(es.movements.sendToGroup.notFound)).toBeTruthy();
    expect(calls).toHaveLength(0);
  });

  it('the route container reads the id from the query', async () => {
    const { calls } = stubApi(routes());
    renderApp(<SendToGroupRouteContainer />, { locale: 'en', search: `id=${MOV}` });
    await radio('Casa');
    expect(calls[0]?.path).toBe(`/movements/${MOV}`);
  });
});

describe('movements.sendToGroup catalogs', () => {
  it('has the same non-empty keys in Spanish and English (NFR-04)', () => {
    const keys = Object.keys(en.movements.sendToGroup).sort();
    expect(Object.keys(es.movements.sendToGroup).sort()).toEqual(keys);
    for (const key of keys) {
      expect((en.movements.sendToGroup as Record<string, string>)[key]?.trim()).toBeTruthy();
      expect((es.movements.sendToGroup as Record<string, string>)[key]?.trim()).toBeTruthy();
    }
  });
});

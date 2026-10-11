// @vitest-environment happy-dom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { GroupDetailContainer } from '../src/features/groups/containers/group-detail-container';
import { CATALOGS, renderApp, stubApi } from './support/render-app';

const { en, es } = CATALOGS;
const GROUP_ID = '55555555-5555-4555-8555-555555555555';
const ANA = '11111111-1111-4111-8111-111111111111';
const BRUNO = '22222222-2222-4222-8222-222222222222';
const CARLA = '33333333-3333-4333-8333-333333333333';
const DIEGO = '44444444-4444-4444-8444-444444444444';
const GET_GROUP = `GET /groups/${GROUP_ID}`;
const GET_BALANCES = `GET /groups/${GROUP_ID}/balances`;
const PATCH_GROUP = `PATCH /groups/${GROUP_ID}`;
const LEAVE = `POST /groups/${GROUP_ID}/leave`;
const PROMOTE = `POST /groups/${GROUP_ID}/members/${BRUNO}/admin`;
const REMOVE = `DELETE /groups/${GROUP_ID}/members/${BRUNO}`;

const member = (id: string, displayName: string, overrides: Record<string, unknown> = {}) => ({
  id,
  displayName,
  isGhost: false,
  role: 'member',
  joinedAt: '2026-10-01T00:00:00.000Z',
  ...overrides,
});

const detail = (overrides: Record<string, unknown> = {}) => ({
  id: GROUP_ID,
  name: 'Flatmates',
  defaultRateType: 'blue',
  role: 'admin',
  memberCount: 3,
  createdAt: '2026-10-01T00:00:00.000Z',
  selfMemberId: ANA,
  members: [
    member(ANA, 'Ana', { role: 'admin' }),
    member(BRUNO, 'Bruno'),
    member(CARLA, 'Carla', { isGhost: true }),
  ],
  formerMembers: [{ id: DIEGO, displayName: 'Diego', leftAt: '2026-10-05T00:00:00.000Z' }],
  ...overrides,
});

const balances = (ars: string, usd: string) => ({
  ARS: { members: [{ memberId: ANA, balance: ars }], payments: [] },
  USD: { members: [{ memberId: ANA, balance: usd }], payments: [] },
});

const rowOf = (name: string) => {
  const row = screen.getByText(name).closest('li');
  if (!row) throw new Error(`No row for ${name}`);
  return row;
};

const open = (locale: 'en' | 'es' = 'en') =>
  renderApp(<GroupDetailContainer groupId={GROUP_ID} />, { locale });

describe('GroupDetailContainer', () => {
  it('lists members with role, marks members without an account and loads in one request', async () => {
    const { calls } = stubApi({ [GET_GROUP]: { status: 200, body: detail() } });
    open();

    expect(await screen.findByRole('heading', { name: 'Flatmates' })).toBeTruthy();
    expect(within(rowOf('Ana')).getByText(en.groups.detail.roles.admin)).toBeTruthy();
    expect(within(rowOf('Bruno')).getByText(en.groups.detail.roles.member)).toBeTruthy();
    expect(within(rowOf('Bruno')).queryByText(en.groups.detail.ghost)).toBeNull();
    expect(within(rowOf('Carla')).getByText(en.groups.detail.ghost)).toBeTruthy();
    expect(calls.length).toBeLessThanOrEqual(2);
    expect(calls.map((call) => `${call.method} ${call.path}`).sort()).toEqual(
      [GET_BALANCES, GET_GROUP].sort(),
    );
  });

  it('lists former members apart from the current ones', async () => {
    stubApi({ [GET_GROUP]: { status: 200, body: detail() } });
    open();
    await screen.findByText('Ana');

    const former = screen.getByRole('list', { name: en.groups.detail.formerTitle });
    expect(within(former).getByText('Diego')).toBeTruthy();
    const current = screen.getByRole('list', { name: en.groups.detail.membersTitle });
    expect(within(current).queryByText('Diego')).toBeNull();
  });

  it('links to the categories page and leaves a mount point for the panels', async () => {
    stubApi({ [GET_GROUP]: { status: 200, body: detail() } });
    const { container } = open();
    const link = await screen.findByRole('link', { name: en.groups.detail.categoriesLink });
    expect(link.getAttribute('href')).toBe(`/en/groups/${GROUP_ID}/categories`);
    expect(container.querySelector('[data-slot="group-panels"]')).toBeTruthy();
  });

  it('links to the expenses, the new expense form and the default split', async () => {
    stubApi({ [GET_GROUP]: { status: 200, body: detail() } });
    open();
    const href = async (name: string) =>
      (await screen.findByRole('link', { name })).getAttribute('href');

    expect(await href(en.groups.detail.expensesLink)).toBe(`/en/groups/${GROUP_ID}/expenses`);
    expect(await href(en.groups.detail.addExpenseLink)).toBe(`/en/groups/${GROUP_ID}/expenses/new`);
    expect(await href(en.groups.detail.defaultSplitLink)).toBe(
      `/en/groups/${GROUP_ID}/default-split`,
    );
  });

  it('renders Spanish strings', async () => {
    stubApi({ [GET_GROUP]: { status: 200, body: detail() } });
    open('es');
    await screen.findByText('Ana');
    expect(within(rowOf('Carla')).getByText(es.groups.detail.ghost)).toBeTruthy();
  });

  it('lets an admin promote a registered member and shows the row as admin', async () => {
    const { calls } = stubApi({
      [GET_GROUP]: { status: 200, body: detail() },
      [PROMOTE]: { status: 200, body: member(BRUNO, 'Bruno', { role: 'admin' }) },
    });
    open();
    await screen.findByText('Ana');

    await userEvent.click(
      screen.getByRole('button', {
        name: en.groups.detail.actions.promoteLabel.replace('{name}', 'Bruno'),
      }),
    );

    await waitFor(() => {
      expect(within(rowOf('Bruno')).getByText(en.groups.detail.roles.admin)).toBeTruthy();
    });
    expect(
      within(rowOf('Bruno')).queryByRole('button', {
        name: en.groups.detail.actions.promoteLabel.replace('{name}', 'Bruno'),
      }),
    ).toBeNull();
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);
  });

  it('disables promotion for a member without an account', async () => {
    stubApi({ [GET_GROUP]: { status: 200, body: detail() } });
    open();
    await screen.findByText('Ana');
    const promote = within(rowOf('Carla')).getByRole('button', {
      name: en.groups.detail.actions.promoteLabel.replace('{name}', 'Carla'),
    });
    expect((promote as HTMLButtonElement).disabled).toBe(true);
  });

  it('removing a member with a balance shows the amounts and keeps the member', async () => {
    const { calls } = stubApi({
      [GET_GROUP]: { status: 200, body: detail() },
      [REMOVE]: {
        status: 409,
        body: { code: 'GROUP_MEMBER_HAS_BALANCE', details: { ARS: '-12000', USD: '500' } },
      },
    });
    open();
    await screen.findByText('Ana');

    await userEvent.click(
      screen.getByRole('button', {
        name: en.groups.detail.actions.removeLabel.replace('{name}', 'Bruno'),
      }),
    );

    const alert = await within(rowOf('Bruno')).findByRole('alert');
    expect(alert.textContent).toMatch(/Owes 120\.00\s?ARS/);
    expect(alert.textContent).toMatch(/Is owed 5\.00\s?USD/);
    expect(rowOf('Bruno')).toBeTruthy();
    expect(calls.filter((call) => call.path === `/groups/${GROUP_ID}`)).toHaveLength(1);
  });

  it('removing yourself shows a specific message instead of the generic validation one (D1)', async () => {
    const REMOVE_ANA = `DELETE /groups/${GROUP_ID}/members/${ANA}`;
    const { calls } = stubApi({
      [GET_GROUP]: { status: 200, body: detail() },
      [REMOVE_ANA]: {
        status: 400,
        body: { code: 'VALIDATION_FAILED', fields: ['params.memberId'] },
      },
    });
    open();
    await screen.findByText('Ana');

    await userEvent.click(
      screen.getByRole('button', {
        name: en.groups.detail.actions.removeLabel.replace('{name}', 'Ana'),
      }),
    );

    const alert = await within(rowOf('Ana')).findByRole('alert');
    expect(alert.textContent).toContain(en.groups.detail.cannotRemoveSelf);
    expect(alert.textContent).not.toContain(en.errors.validationFailed);
    expect(calls.filter((call) => call.path === `/groups/${GROUP_ID}`)).toHaveLength(1);
  });

  it('removing a member without a balance reloads the group', async () => {
    const { calls } = stubApi({
      [GET_GROUP]: [
        { status: 200, body: detail() },
        {
          status: 200,
          body: detail({
            members: [
              member(ANA, 'Ana', { role: 'admin' }),
              member(CARLA, 'Carla', { isGhost: true }),
            ],
            formerMembers: [
              { id: BRUNO, displayName: 'Bruno', leftAt: '2026-10-06T00:00:00.000Z' },
            ],
          }),
        },
      ],
      [REMOVE]: { status: 204 },
    });
    open();
    await screen.findByText('Ana');
    await userEvent.click(
      screen.getByRole('button', {
        name: en.groups.detail.actions.removeLabel.replace('{name}', 'Bruno'),
      }),
    );
    await waitFor(() => {
      const former = screen.getByRole('list', { name: en.groups.detail.formerTitle });
      expect(within(former).getByText('Bruno')).toBeTruthy();
    });
    expect(calls.filter((call) => call.path === `/groups/${GROUP_ID}`)).toHaveLength(2);
  });

  it('shows no promote, remove or rate type controls to a regular member', async () => {
    stubApi({ [GET_GROUP]: { status: 200, body: detail({ role: 'member' }) } });
    open();
    await screen.findByText('Ana');
    expect(
      screen.queryByRole('button', { name: /Make .* an admin|Hacer administrador/ }),
    ).toBeNull();
    expect(screen.queryByRole('button', { name: /^Remove / })).toBeNull();
    expect(screen.queryByLabelText(en.groups.detail.rateType.label)).toBeNull();
    expect(screen.getByRole('button', { name: en.groups.detail.leave.action })).toBeTruthy();
  });

  it('lets an admin change the default rate type', async () => {
    const { calls } = stubApi({
      [GET_GROUP]: { status: 200, body: detail() },
      [PATCH_GROUP]: {
        status: 200,
        body: { ...detail(), defaultRateType: 'mep', members: undefined, formerMembers: undefined },
      },
    });
    open();
    const select = await screen.findByLabelText(en.groups.detail.rateType.label);
    expect((select as HTMLSelectElement).value).toBe('blue');
    await userEvent.selectOptions(select, 'mep');
    await userEvent.click(screen.getByRole('button', { name: en.groups.detail.rateType.save }));

    expect(await screen.findByText(en.groups.detail.rateType.saved)).toBeTruthy();
    expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({ defaultRateType: 'mep' });
  });

  it('a member with no balance leaves and returns to the list', async () => {
    const { calls } = stubApi({
      [GET_GROUP]: { status: 200, body: detail({ role: 'member' }) },
      [LEAVE]: { status: 204 },
    });
    const { router } = open();
    await userEvent.click(
      await screen.findByRole('button', { name: en.groups.detail.leave.action }),
    );
    await waitFor(() => {
      expect(router.push).toHaveBeenCalledWith('/en/groups');
    });
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);
  });

  it('leaving with a balance shows the amount per currency and keeps the user', async () => {
    const { calls } = stubApi({
      [GET_GROUP]: { status: 200, body: detail({ role: 'member' }) },
      [LEAVE]: {
        status: 409,
        body: { code: 'GROUP_MEMBER_HAS_BALANCE', details: { ARS: '-12000', USD: '0' } },
      },
    });
    const { router } = open();
    await userEvent.click(
      await screen.findByRole('button', { name: en.groups.detail.leave.action }),
    );
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/Owes 120\.00\s?ARS/);
    expect(alert.textContent).not.toMatch(/USD/);
    expect(router.push).not.toHaveBeenCalled();
    expect(screen.getByText('Ana')).toBeTruthy();
    expect(calls.filter((call) => call.path === `/groups/${GROUP_ID}`)).toHaveLength(1);
  });

  it('the last admin leaving is asked to promote someone first', async () => {
    stubApi({
      [GET_GROUP]: { status: 200, body: detail() },
      [LEAVE]: { status: 409, body: { code: 'GROUP_LAST_ADMIN' } },
    });
    const { router } = open();
    await userEvent.click(
      await screen.findByRole('button', { name: en.groups.detail.leave.action }),
    );
    expect((await screen.findByRole('alert')).textContent).toContain(en.errors.groupLastAdmin);
    expect(router.push).not.toHaveBeenCalled();
  });

  it('shows the not-found state with a link back for a group the user cannot see', async () => {
    stubApi({ [GET_GROUP]: { status: 404, body: { code: 'NOT_FOUND' } } });
    open();
    expect(await screen.findByText(en.groups.detail.notFound.title)).toBeTruthy();
    const back = screen.getByRole('link', { name: en.groups.detail.notFound.back });
    expect(back.getAttribute('href')).toBe('/en/groups');
  });

  it('a 403 from an admin action shows its message and changes nothing', async () => {
    stubApi({
      [GET_GROUP]: { status: 200, body: detail() },
      [PROMOTE]: { status: 403, body: { code: 'GROUP_ADMIN_REQUIRED' } },
    });
    open();
    await screen.findByText('Ana');
    await userEvent.click(
      screen.getByRole('button', {
        name: en.groups.detail.actions.promoteLabel.replace('{name}', 'Bruno'),
      }),
    );
    expect((await within(rowOf('Bruno')).findByRole('alert')).textContent).toContain(
      en.errors.groupAdminRequired,
    );
    expect(within(rowOf('Bruno')).getByText(en.groups.detail.roles.member)).toBeTruthy();
  });

  it('shows the retry on a load error', async () => {
    stubApi({ [GET_GROUP]: [{ status: 500 }, { status: 200, body: detail() }] });
    open();
    await userEvent.click(await screen.findByRole('button', { name: en.app.retry }));
    expect(await screen.findByText('Ana')).toBeTruthy();
  });
});

describe('GroupDetailContainer balances', () => {
  it('links to the balances page of the group', async () => {
    stubApi({
      [GET_GROUP]: { status: 200, body: detail() },
      [GET_BALANCES]: { status: 200, body: balances('0', '0') },
    });
    open();
    const link = await screen.findByRole('link', { name: en.groups.detail.balancesLink });
    expect(link.getAttribute('href')).toBe(`/en/groups/${GROUP_ID}/balances`);
  });

  it('shows the own balance in ARS and USD, marked owing or owed', async () => {
    stubApi({
      [GET_GROUP]: { status: 200, body: detail() },
      [GET_BALANCES]: { status: 200, body: balances('-12000', '500') },
    });
    open();
    const summary = await screen.findByRole('region', { name: en.groups.detail.ownBalance.title });
    expect(summary.textContent).toMatch(/You owe 120\.00\s?ARS/);
    expect(summary.textContent).toMatch(/You are owed 5\.00\s?USD/);
  });

  it('shows a settled currency as even', async () => {
    stubApi({
      [GET_GROUP]: { status: 200, body: detail() },
      [GET_BALANCES]: { status: 200, body: balances('0', '500') },
    });
    open();
    const summary = await screen.findByRole('region', { name: en.groups.detail.ownBalance.title });
    expect(summary.textContent).toContain(
      en.groups.detail.ownBalance.even.replace('{currency}', 'ARS'),
    );
  });

  it('keeps members, actions and the link visible when the balances request fails', async () => {
    stubApi({
      [GET_GROUP]: { status: 200, body: detail() },
      [GET_BALANCES]: { status: 500 },
    });
    open();
    expect(await screen.findByText(en.groups.detail.ownBalance.unavailable)).toBeTruthy();
    expect(screen.getByText('Bruno')).toBeTruthy();
    expect(screen.getByRole('button', { name: en.groups.detail.leave.action })).toBeTruthy();
    expect(screen.getByRole('link', { name: en.groups.detail.balancesLink })).toBeTruthy();
  });

  it('loads with at most 2 requests', async () => {
    const { calls } = stubApi({
      [GET_GROUP]: { status: 200, body: detail() },
      [GET_BALANCES]: { status: 200, body: balances('0', '0') },
    });
    open();
    await screen.findByRole('region', { name: en.groups.detail.ownBalance.title });
    expect(calls).toHaveLength(2);
  });

  it('renders Spanish strings for the link and the summary', async () => {
    stubApi({
      [GET_GROUP]: { status: 200, body: detail() },
      [GET_BALANCES]: { status: 200, body: balances('-12000', '500') },
    });
    open('es');
    const summary = await screen.findByRole('region', { name: es.groups.detail.ownBalance.title });
    expect(summary.textContent).toMatch(/Debes 120/);
    expect(screen.getByRole('link', { name: es.groups.detail.balancesLink })).toBeTruthy();
  });
});

describe('GroupDetailContainer session and failure paths', () => {
  const UNAUTHENTICATED = { status: 401, body: { code: 'UNAUTHENTICATED' } };

  it('goes to sign-in when the group cannot be loaded because the session is gone', async () => {
    stubApi({ [GET_GROUP]: UNAUTHENTICATED });
    const { router } = open();
    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith('/en/sign-in');
    });
    expect(screen.queryByText('Ana')).toBeNull();
  });

  it('goes to sign-in when an action answers 401', async () => {
    stubApi({ [GET_GROUP]: { status: 200, body: detail() }, [PROMOTE]: UNAUTHENTICATED });
    const { router } = open();
    await screen.findByText('Ana');
    await userEvent.click(
      screen.getByRole('button', {
        name: en.groups.detail.actions.promoteLabel.replace('{name}', 'Bruno'),
      }),
    );
    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith('/en/sign-in');
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows the failure next to the rate type and keeps the previous value', async () => {
    stubApi({
      [GET_GROUP]: { status: 200, body: detail() },
      [PATCH_GROUP]: { status: 403, body: { code: 'GROUP_ADMIN_REQUIRED' } },
    });
    open();
    const select = await screen.findByLabelText(en.groups.detail.rateType.label);
    await userEvent.selectOptions(select, 'mep');
    await userEvent.click(screen.getByRole('button', { name: en.groups.detail.rateType.save }));

    expect((await screen.findByRole('alert')).textContent).toContain(en.errors.groupAdminRequired);
    expect(screen.queryByText(en.groups.detail.rateType.saved)).toBeNull();
  });

  it('keeps the screen when the quiet reload after a removal fails', async () => {
    const { calls } = stubApi({
      [GET_GROUP]: [{ status: 200, body: detail() }, { status: 500 }],
      [REMOVE]: { status: 204 },
    });
    open();
    await screen.findByText('Ana');
    await userEvent.click(
      screen.getByRole('button', {
        name: en.groups.detail.actions.removeLabel.replace('{name}', 'Bruno'),
      }),
    );
    await waitFor(() => {
      expect(calls.filter((call) => call.path === `/groups/${GROUP_ID}`)).toHaveLength(2);
    });
    expect(screen.getByText('Bruno')).toBeTruthy();
    expect(screen.queryByRole('button', { name: en.app.retry })).toBeNull();
  });
});

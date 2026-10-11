// @vitest-environment happy-dom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { CreateGroupContainer } from '../src/features/groups/containers/create-group-container';
import { GroupsListContainer } from '../src/features/groups/containers/groups-list-container';
import { buildGroupRequest } from '../src/features/groups/group-request';
import { HomeShortcuts } from '../src/features/home/components/home-shortcuts';
import { CATALOGS, renderApp, stubApi } from './support/render-app';

const { en, es } = CATALOGS;
const GROUPS = 'GET /groups';
const CREATE = 'POST /groups';
const PROFILE = 'GET /profile';
const GROUP_ID = '55555555-5555-4555-8555-555555555555';

const group = (overrides: Record<string, unknown> = {}) => ({
  id: GROUP_ID,
  name: 'Flatmates',
  defaultRateType: 'blue',
  role: 'admin',
  memberCount: 3,
  createdAt: '2026-10-01T00:00:00.000Z',
  ...overrides,
});

const profile = {
  status: 200,
  body: {
    displayName: 'Ana',
    email: 'ana@example.com',
    twoFactorEnabled: false,
    deletionReauth: 'password',
    preferences: {
      defaultRateType: 'mep',
      displayCurrency: 'ARS',
      timeZone: 'America/Argentina/Buenos_Aires',
      language: 'en',
    },
  },
} as const;

describe('buildGroupRequest', () => {
  it('trims the name and keeps the rate type', () => {
    expect(buildGroupRequest({ name: '  Trip  ', defaultRateType: 'blue' })).toEqual({
      request: { name: 'Trip', defaultRateType: 'blue' },
    });
  });

  it('rejects an empty name and an unknown rate type', () => {
    expect(buildGroupRequest({ name: '   ', defaultRateType: 'blue' }).fields).toEqual({
      name: 'groups.list.errors.nameRequired',
    });
    expect(buildGroupRequest({ name: 'Trip', defaultRateType: 'euro' }).fields).toEqual({
      defaultRateType: 'groups.list.errors.rateTypeRequired',
    });
  });

  it('rejects a name over the limit', () => {
    expect(buildGroupRequest({ name: 'x'.repeat(51), defaultRateType: 'oficial' }).fields).toEqual({
      name: 'groups.list.errors.nameTooLong',
    });
  });
});

describe('GroupsListContainer', () => {
  it('lists each group with name, role and member count in one request', async () => {
    const { calls } = stubApi({
      [GROUPS]: {
        status: 200,
        body: [
          group(),
          group({
            id: '66666666-6666-4666-8666-666666666666',
            name: 'Trip',
            role: 'member',
            memberCount: 1,
          }),
        ],
      },
    });
    renderApp(<GroupsListContainer />, { locale: 'en' });

    const flat = await screen.findByRole('link', { name: /Flatmates/ });
    expect(flat.getAttribute('href')).toBe(`/en/groups/${GROUP_ID}`);
    expect(within(flat).getByText(en.groups.list.roles.admin)).toBeTruthy();
    expect(within(flat).getByText('3 members')).toBeTruthy();
    const trip = screen.getByRole('link', { name: /Trip/ });
    expect(within(trip).getByText(en.groups.list.roles.member)).toBeTruthy();
    expect(within(trip).getByText('1 member')).toBeTruthy();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.path).toBe('/groups');
  });

  it('renders Spanish strings', async () => {
    stubApi({ [GROUPS]: { status: 200, body: [group()] } });
    renderApp(<GroupsListContainer />, { locale: 'es' });
    const row = await screen.findByRole('link', { name: /Flatmates/ });
    expect(within(row).getByText(es.groups.list.roles.admin)).toBeTruthy();
    expect(within(row).getByText('3 miembros')).toBeTruthy();
  });

  it('shows the empty state with the create action and the join hint', async () => {
    stubApi({ [GROUPS]: { status: 200, body: [] } });
    renderApp(<GroupsListContainer />, { locale: 'en' });
    expect(await screen.findByText(en.groups.list.empty.title)).toBeTruthy();
    expect(screen.getByText(en.groups.list.empty.joinHint)).toBeTruthy();
    expect(screen.getByRole('link', { name: en.groups.list.create }).getAttribute('href')).toBe(
      '/en/groups/new',
    );
  });

  it('shows the retry on a load error and loads again on retry', async () => {
    const { calls } = stubApi({
      [GROUPS]: [{ status: 500 }, { status: 200, body: [group()] }],
    });
    renderApp(<GroupsListContainer />, { locale: 'en' });
    await userEvent.click(await screen.findByRole('button', { name: en.app.retry }));
    expect(await screen.findByRole('link', { name: /Flatmates/ })).toBeTruthy();
    expect(calls.filter((call) => call.path === '/groups')).toHaveLength(2);
  });

  it('goes to sign-in when unauthenticated', async () => {
    stubApi({
      [GROUPS]: { status: 401, body: { code: 'UNAUTHENTICATED' } },
      'POST /auth/refresh': { status: 401, body: { code: 'UNAUTHENTICATED' } },
    });
    const { router } = renderApp(<GroupsListContainer />, { locale: 'en' });
    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith('/en/sign-in');
    });
  });
});

describe('CreateGroupContainer', () => {
  it('creates the group with the typed name and rate type and opens it', async () => {
    const { calls } = stubApi({ [PROFILE]: profile, [CREATE]: { status: 201, body: group() } });
    const { router } = renderApp(<CreateGroupContainer />, { locale: 'en' });

    const select = await screen.findByLabelText(en.groups.list.fields.rateType);
    await waitFor(() => {
      expect((select as HTMLSelectElement).value).toBe('mep');
    });
    await userEvent.type(screen.getByLabelText(en.groups.list.fields.name), 'Flatmates');
    await userEvent.selectOptions(select, 'blue');
    await userEvent.click(screen.getByRole('button', { name: en.groups.list.submit }));

    await waitFor(() => {
      expect(router.push).toHaveBeenCalledWith(`/en/groups/${GROUP_ID}`);
    });
    expect(calls.find((call) => call.method === 'POST')?.body).toEqual({
      name: 'Flatmates',
      defaultRateType: 'blue',
    });
  });

  it('offers the seven rate types', async () => {
    stubApi({ [PROFILE]: profile });
    renderApp(<CreateGroupContainer />, { locale: 'en' });
    const select = await screen.findByLabelText(en.groups.list.fields.rateType);
    expect(within(select).getAllByRole('option')).toHaveLength(7);
  });

  it('falls back to oficial when the profile cannot be read', async () => {
    stubApi({ [PROFILE]: { status: 500 } });
    renderApp(<CreateGroupContainer />, { locale: 'en' });
    const select = await screen.findByLabelText(en.groups.list.fields.rateType);
    await waitFor(() => {
      expect((select as HTMLSelectElement).value).toBe('oficial');
    });
  });

  it('shows a field error and sends nothing for an empty name', async () => {
    const { calls } = stubApi({ [PROFILE]: profile });
    renderApp(<CreateGroupContainer />, { locale: 'en' });
    await userEvent.click(await screen.findByRole('button', { name: en.groups.list.submit }));
    expect(await screen.findByText(en.groups.list.errors.nameRequired)).toBeTruthy();
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(0);
  });

  it('shows a field error and sends nothing for a name over the limit', async () => {
    const { calls } = stubApi({ [PROFILE]: profile });
    renderApp(<CreateGroupContainer />, { locale: 'en' });
    await userEvent.type(await screen.findByLabelText(en.groups.list.fields.name), 'x'.repeat(51));
    await userEvent.click(screen.getByRole('button', { name: en.groups.list.submit }));
    expect(await screen.findByText(en.groups.list.errors.nameTooLong)).toBeTruthy();
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(0);
  });

  it('shows the mapped failure and keeps what was typed', async () => {
    stubApi({
      [PROFILE]: profile,
      [CREATE]: { status: 500, body: { error: { code: 'INTERNAL', message: 'x' } } },
    });
    const { router } = renderApp(<CreateGroupContainer />, { locale: 'en' });
    const name = await screen.findByLabelText(en.groups.list.fields.name);
    await userEvent.type(name, 'Flatmates');
    await userEvent.click(screen.getByRole('button', { name: en.groups.list.submit }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect((name as HTMLInputElement).value).toBe('Flatmates');
    expect(router.push).not.toHaveBeenCalled();
  });
});

describe('HomeShortcuts', () => {
  it('no longer flags the groups shortcut as in creation', () => {
    renderApp(<HomeShortcuts />, { locale: 'en' });
    const groups = screen.getByRole('link', { name: new RegExp(en.home.shortcuts.groups.title) });
    expect(within(groups).queryByText(en.home.shortcuts.inCreation)).toBeNull();
    const budgets = screen.getByRole('link', { name: new RegExp(en.home.shortcuts.budgets.title) });
    expect(within(budgets).getByText(en.home.shortcuts.inCreation)).toBeTruthy();
  });
});

// @vitest-environment happy-dom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GroupDetailContainer } from '../src/features/groups/containers/group-detail-container';
import { buildGroupLink } from '../src/features/groups/group-link';
import { CATALOGS, renderApp, stubApi } from './support/render-app';

const { en, es } = CATALOGS;
const GROUP_ID = '55555555-5555-4555-8555-555555555555';
const ANA = '11111111-1111-4111-8111-111111111111';
const BRUNO = '22222222-2222-4222-8222-222222222222';
const CARLA = '33333333-3333-4333-8333-333333333333';
const NEW_GHOST = '66666666-6666-4666-8666-666666666666';
const TOKEN = 'T'.repeat(43);
const GET_GROUP = `GET /groups/${GROUP_ID}`;
const INVITE = `POST /groups/${GROUP_ID}/invitations`;
const GHOST = `POST /groups/${GROUP_ID}/ghost-members`;
const CLAIM = `POST /groups/${GROUP_ID}/members/${CARLA}/claim-links`;
const PROFILE = 'GET /profile';

const member = (id: string, displayName: string, overrides: Record<string, unknown> = {}) => ({
  id,
  displayName,
  isGhost: false,
  role: 'member',
  joinedAt: '2026-10-01T00:00:00.000Z',
  ...overrides,
});

const members = [
  member(ANA, 'Ana', { role: 'admin' }),
  member(BRUNO, 'Bruno'),
  member(CARLA, 'Carla', { isGhost: true }),
];

const detail = (overrides: Record<string, unknown> = {}) => ({
  id: GROUP_ID,
  name: 'Flatmates',
  defaultRateType: 'blue',
  role: 'admin',
  memberCount: 3,
  createdAt: '2026-10-01T00:00:00.000Z',
  selfMemberId: ANA,
  members,
  formerMembers: [],
  ...overrides,
});

const open = (locale: 'en' | 'es' = 'en') =>
  renderApp(<GroupDetailContainer groupId={GROUP_ID} />, { locale });

function stubClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
}

afterEach(() => {
  Reflect.deleteProperty(navigator, 'clipboard');
  Reflect.deleteProperty(navigator, 'share');
});

describe('buildGroupLink', () => {
  it('puts the token in the fragment, never in a query string', () => {
    const join = buildGroupLink('join', TOKEN, 'https://pesly.test', 'en');
    expect(join).toBe(`https://pesly.test/en/groups/join#token=${TOKEN}`);
    const claim = buildGroupLink('claim', TOKEN, 'https://pesly.test', 'es');
    expect(claim).toBe(`https://pesly.test/es/groups/claim#token=${TOKEN}`);
    expect(new URL(join).search).toBe('');
    expect(new URL(claim).search).toBe('');
  });
});

describe('group invitation panel', () => {
  it('asks for an invitation, shows the link and the expiry in the user time zone, and copies it', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    stubClipboard(writeText);
    const { calls } = stubApi({
      [GET_GROUP]: { status: 200, body: detail() },
      [INVITE]: { status: 201, body: { token: TOKEN, expiresAt: '2026-10-20T01:30:00.000Z' } },
      [PROFILE]: {
        status: 200,
        body: {
          displayName: 'Ana',
          email: 'ana@example.com',
          twoFactorEnabled: false,
          deletionReauth: 'password',
          preferences: {
            defaultRateType: 'oficial',
            displayCurrency: 'ARS',
            language: 'en',
            timeZone: 'America/Argentina/Buenos_Aires',
          },
        },
      },
    });
    open();
    await screen.findByText('Ana');

    await userEvent.click(screen.getByRole('button', { name: en.groups.invite.create }));

    const field = await screen.findByLabelText<HTMLInputElement>(en.groups.invite.linkLabel);
    expect(field.readOnly).toBe(true);
    expect(field.value).toBe(`${window.location.origin}/en/groups/join#token=${TOKEN}`);
    expect(field.value).not.toContain('?');
    // 01:30 UTC on the 20th is still the 19th in Buenos Aires.
    const expiry = document.body.textContent;
    expect(expiry).toContain('Oct 19, 2026');
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);

    await userEvent.click(screen.getByRole('button', { name: en.groups.invite.copy }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(field.value);
    });
    expect(await screen.findByText(en.groups.invite.copied)).toBeTruthy();
  });

  it('keeps the link visible for manual copy when the clipboard fails', async () => {
    stubClipboard(() => Promise.reject(new Error('denied')));
    stubApi({
      [GET_GROUP]: { status: 200, body: detail() },
      [INVITE]: { status: 201, body: { token: TOKEN, expiresAt: '2026-10-20T01:30:00.000Z' } },
      [PROFILE]: { status: 500 },
    });
    open();
    await screen.findByText('Ana');
    await userEvent.click(screen.getByRole('button', { name: en.groups.invite.create }));
    const field = await screen.findByLabelText<HTMLInputElement>(en.groups.invite.linkLabel);

    await userEvent.click(screen.getByRole('button', { name: en.groups.invite.copy }));

    expect(await screen.findByText(en.groups.invite.copyFailed)).toBeTruthy();
    expect(field.value).toContain(TOKEN);
    expect(screen.queryByText(en.groups.invite.copied)).toBeNull();
  });

  it('offers the share action only when the browser has one', async () => {
    stubApi({
      [GET_GROUP]: { status: 200, body: detail() },
      [INVITE]: { status: 201, body: { token: TOKEN, expiresAt: '2026-10-20T01:30:00.000Z' } },
      [PROFILE]: { status: 500 },
    });
    open();
    await screen.findByText('Ana');
    await userEvent.click(screen.getByRole('button', { name: en.groups.invite.create }));
    await screen.findByLabelText(en.groups.invite.linkLabel);
    expect(screen.queryByRole('button', { name: en.groups.invite.share })).toBeNull();

    const share = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'share', { value: share, configurable: true });
    // Re-render the result with the capability present.
    await userEvent.click(screen.getByRole('button', { name: en.groups.invite.create }));
    await userEvent.click(await screen.findByRole('button', { name: en.groups.invite.share }));
    expect(share).toHaveBeenCalledTimes(1);
  });

  it('shows the API message for a 403 and no link', async () => {
    stubApi({
      [GET_GROUP]: { status: 200, body: detail() },
      [INVITE]: { status: 403, body: { code: 'GROUP_ADMIN_REQUIRED', message: 'no' } },
    });
    open();
    await screen.findByText('Ana');
    await userEvent.click(screen.getByRole('button', { name: en.groups.invite.create }));

    expect(await screen.findByText(en.errors.groupAdminRequired)).toBeTruthy();
    expect(screen.queryByLabelText(en.groups.invite.linkLabel)).toBeNull();
  });

  it('renders the invitation and member panels for a regular member too', async () => {
    stubApi({ [GET_GROUP]: { status: 200, body: detail({ role: 'member' }) } });
    open();
    await screen.findByText('Ana');
    expect(screen.getByRole('button', { name: en.groups.invite.create })).toBeTruthy();
    expect(screen.getByLabelText(en.groups.invite.ghost.nameLabel)).toBeTruthy();
  });

  it('renders Spanish strings', async () => {
    stubApi({ [GET_GROUP]: { status: 200, body: detail() } });
    open('es');
    await screen.findByText('Ana');
    expect(screen.getByRole('button', { name: es.groups.invite.create })).toBeTruthy();
  });
});

describe('member without an account', () => {
  it('adds a name, reloads the list and shows the new member with the marker', async () => {
    const { calls } = stubApi({
      [GET_GROUP]: [
        { status: 200, body: detail() },
        {
          status: 200,
          body: detail({
            memberCount: 4,
            members: [...members, member(NEW_GHOST, 'Dario', { isGhost: true })],
          }),
        },
      ],
      [GHOST]: { status: 201, body: member(NEW_GHOST, 'Dario', { isGhost: true }) },
    });
    open();
    await screen.findByText('Ana');

    await userEvent.type(screen.getByLabelText(en.groups.invite.ghost.nameLabel), '  Dario ');
    await userEvent.click(screen.getByRole('button', { name: en.groups.invite.ghost.submit }));

    const row = (await screen.findByText('Dario')).closest('li');
    expect(row).toBeTruthy();
    expect(within(row as HTMLElement).getByText(en.groups.detail.ghost)).toBeTruthy();
    expect(calls.find((call) => call.path.endsWith('/ghost-members'))?.body).toEqual({
      displayName: 'Dario',
    });
  });

  it('flags an empty name and sends no request', async () => {
    const { calls } = stubApi({ [GET_GROUP]: { status: 200, body: detail() } });
    open();
    await screen.findByText('Ana');

    await userEvent.type(screen.getByLabelText(en.groups.invite.ghost.nameLabel), '   ');
    await userEvent.click(screen.getByRole('button', { name: en.groups.invite.ghost.submit }));

    expect(await screen.findByText(en.groups.invite.ghost.errors.nameRequired)).toBeTruthy();
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(0);
  });

  it('shows the member limit message and adds no row', async () => {
    const { calls } = stubApi({
      [GET_GROUP]: { status: 200, body: detail() },
      [GHOST]: { status: 409, body: { code: 'GROUP_MEMBER_LIMIT_REACHED', message: 'full' } },
    });
    open();
    await screen.findByText('Ana');

    await userEvent.type(screen.getByLabelText(en.groups.invite.ghost.nameLabel), 'Dario');
    await userEvent.click(screen.getByRole('button', { name: en.groups.invite.ghost.submit }));

    expect(await screen.findByText(en.errors.groupMemberLimitReached)).toBeTruthy();
    expect(screen.queryByText('Dario', { selector: 'span' })).toBeNull();
    expect(
      calls.filter((call) => call.method === 'GET' && call.path === `/groups/${GROUP_ID}`),
    ).toHaveLength(1);
  });

  it('shows the API message for a 403', async () => {
    stubApi({
      [GET_GROUP]: { status: 200, body: detail() },
      [GHOST]: { status: 403, body: { code: 'GROUP_ADMIN_REQUIRED', message: 'no' } },
    });
    open();
    await screen.findByText('Ana');
    await userEvent.type(screen.getByLabelText(en.groups.invite.ghost.nameLabel), 'Dario');
    await userEvent.click(screen.getByRole('button', { name: en.groups.invite.ghost.submit }));
    expect(await screen.findByText(en.errors.groupAdminRequired)).toBeTruthy();
  });
});

describe('claim link', () => {
  it('generates a claim link for a member without an account and shows it', async () => {
    stubApi({
      [GET_GROUP]: { status: 200, body: detail() },
      [CLAIM]: { status: 201, body: { token: TOKEN } },
    });
    open();
    await screen.findByText('Ana');

    await userEvent.click(
      screen.getByRole('button', {
        name: en.groups.invite.claim.create.replace('{name}', 'Carla'),
      }),
    );

    const field = await screen.findByLabelText<HTMLInputElement>(en.groups.invite.linkLabel);
    expect(field.value).toBe(`${window.location.origin}/en/groups/claim#token=${TOKEN}`);
  });

  it('shows no claim action when nobody is without an account', async () => {
    stubApi({
      [GET_GROUP]: {
        status: 200,
        body: detail({ members: [member(ANA, 'Ana', { role: 'admin' })] }),
      },
    });
    open();
    await screen.findByText('Ana');
    expect(
      screen.queryByRole('button', {
        name: en.groups.invite.claim.create.replace('{name}', 'Carla'),
      }),
    ).toBeNull();
  });
});

describe('group invitation and member panels: session and fallbacks', () => {
  const UNAUTHENTICATED = { status: 401, body: { code: 'UNAUTHENTICATED' } };
  const profileIn = (timeZone: string) => ({
    status: 200,
    body: {
      displayName: 'Ana',
      email: 'ana@example.com',
      twoFactorEnabled: false,
      deletionReauth: 'password',
      preferences: { defaultRateType: 'oficial', displayCurrency: 'ARS', language: 'en', timeZone },
    },
  });

  it('goes to sign-in when creating an invitation answers 401', async () => {
    stubApi({ [GET_GROUP]: { status: 200, body: detail() }, [INVITE]: UNAUTHENTICATED });
    const { router } = open();
    await screen.findByText('Ana');
    await userEvent.click(screen.getByRole('button', { name: en.groups.invite.create }));
    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith('/en/sign-in');
    });
    expect(screen.queryByLabelText(en.groups.invite.linkLabel)).toBeNull();
  });

  it('still shows the link with a formatted expiry when the profile cannot be read', async () => {
    stubApi({
      [GET_GROUP]: { status: 200, body: detail() },
      [INVITE]: { status: 201, body: { token: TOKEN, expiresAt: '2026-10-20T12:00:00.000Z' } },
      [PROFILE]: { status: 500 },
    });
    open();
    await screen.findByText('Ana');
    await userEvent.click(screen.getByRole('button', { name: en.groups.invite.create }));
    const field = await screen.findByLabelText<HTMLInputElement>(en.groups.invite.linkLabel);
    expect(field.value).toContain(TOKEN);
    expect(document.body.textContent).toContain('Oct 20, 2026');
  });

  it('falls back to the browser time zone when the stored one is not valid', async () => {
    stubApi({
      [GET_GROUP]: { status: 200, body: detail() },
      [INVITE]: { status: 201, body: { token: TOKEN, expiresAt: '2026-10-20T12:00:00.000Z' } },
      [PROFILE]: profileIn('Not/AZone'),
    });
    open();
    await screen.findByText('Ana');
    await userEvent.click(screen.getByRole('button', { name: en.groups.invite.create }));
    const field = await screen.findByLabelText<HTMLInputElement>(en.groups.invite.linkLabel);
    expect(field.value).toContain(TOKEN);
    expect(document.body.textContent).toContain('Oct 20, 2026');
  });

  it('goes to sign-in when adding a member without an account answers 401', async () => {
    stubApi({ [GET_GROUP]: { status: 200, body: detail() }, [GHOST]: UNAUTHENTICATED });
    const { router } = open();
    await screen.findByText('Ana');
    await userEvent.type(screen.getByLabelText(en.groups.invite.ghost.nameLabel), 'Dario');
    await userEvent.click(screen.getByRole('button', { name: en.groups.invite.ghost.submit }));
    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith('/en/sign-in');
    });
  });

  it('goes to sign-in when generating a claim link answers 401', async () => {
    stubApi({ [GET_GROUP]: { status: 200, body: detail() }, [CLAIM]: UNAUTHENTICATED });
    const { router } = open();
    await screen.findByText('Ana');
    await userEvent.click(
      screen.getByRole('button', {
        name: en.groups.invite.claim.create.replace('{name}', 'Carla'),
      }),
    );
    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith('/en/sign-in');
    });
    expect(screen.queryByLabelText(en.groups.invite.linkLabel)).toBeNull();
  });

  it('shows the API message when generating a claim link fails', async () => {
    stubApi({
      [GET_GROUP]: { status: 200, body: detail() },
      [CLAIM]: { status: 403, body: { code: 'GROUP_ADMIN_REQUIRED' } },
    });
    open();
    await screen.findByText('Ana');
    await userEvent.click(
      screen.getByRole('button', {
        name: en.groups.invite.claim.create.replace('{name}', 'Carla'),
      }),
    );
    expect(await screen.findByText(en.errors.groupAdminRequired)).toBeTruthy();
  });
});

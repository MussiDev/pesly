// @vitest-environment happy-dom
import type { Notice } from '@pesly/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { NoticeList } from '../src/features/notices/components/notice-list';
import { NoticesLink } from '../src/features/notices/components/notices-link';
import { NoticesContainer } from '../src/features/notices/containers/notices-container';
import { UnreadBadgeContainer } from '../src/features/notices/containers/unread-badge-container';
import { MoreMenu } from '../src/features/shell/components/more-menu';
import { TopNav } from '../src/features/shell/components/top-nav';
import { CATALOGS, renderApp, stubApi } from './support/render-app';

const { en, es } = CATALOGS;

const FIRST_PAGE = 'GET /notices?limit=20';
const BADGE = 'GET /notices?limit=1';
const READ_ALL = 'POST /notices/read-all';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function notice(n: number, overrides: Partial<Notice> = {}): Notice {
  return {
    id: id(n),
    kind: 'reminder',
    text: `Notice number ${String(n)}`,
    dueDate: '2026-10-12',
    createdAt: `2026-10-0${String(n)}T10:00:00.000Z`,
    readAt: null,
    ...overrides,
  };
}

const READ_AT = '2026-10-09T10:00:00.000Z';

function page(items: Notice[], unreadCount: number, nextCursor: string | null = null) {
  return { status: 200, body: { items, nextCursor, unreadCount } };
}

const writes = (calls: { method: string; path: string }[]) =>
  calls.filter((call) => call.method !== 'GET');

describe('UnreadBadgeContainer (AC-27)', () => {
  it('shows the number of unread notices on the link', async () => {
    stubApi({ [BADGE]: page([notice(1)], 3) });
    renderApp(<UnreadBadgeContainer />, { locale: 'en' });

    const link = await screen.findByRole('link', { name: /3 unread/ });
    expect(link.getAttribute('href')).toBe('/en/notices');
    expect(within(link).getByText('3')).toBeTruthy();
  });

  it('shows no number at 0 unread, but keeps the link', async () => {
    const { fetch } = stubApi({ [BADGE]: page([], 0) });
    renderApp(<UnreadBadgeContainer />, { locale: 'en' });

    await waitFor(() => {
      expect(fetch).toHaveBeenCalled();
    });
    const link = await screen.findByRole('link', { name: en.app.nav.notices });
    expect(link.textContent.trim()).toBe('');
  });

  it('shows no number when the count request fails', async () => {
    const { fetch } = stubApi({ [BADGE]: { status: 500 } });
    renderApp(<UnreadBadgeContainer />, { locale: 'en' });

    await waitFor(() => {
      expect(fetch).toHaveBeenCalled();
    });
    const link = await screen.findByRole('link', { name: en.app.nav.notices });
    expect(link.textContent.trim()).toBe('');
  });

  it('does not ask for the count without a connection', () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    const { fetch } = stubApi({ [BADGE]: page([], 3) });
    try {
      renderApp(<UnreadBadgeContainer />, { locale: 'en' });
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    }
  });

  it('shows no number while the count loads', () => {
    stubApi({ [BADGE]: page([], 3) });
    renderApp(<UnreadBadgeContainer />, { locale: 'en' });

    expect(screen.queryByText('3')).toBeNull();
  });

  it('caps the number at 99+', async () => {
    stubApi({ [BADGE]: page([notice(1)], 250) });
    renderApp(<UnreadBadgeContainer />, { locale: 'en' });

    expect(await screen.findByText('99+')).toBeTruthy();
  });
});

describe('NoticesLink', () => {
  it('names the link in the current language', () => {
    renderApp(<NoticesLink count={2} />, { locale: 'es' });

    expect(screen.getByRole('link', { name: /2 sin leer/ })).toBeTruthy();
    expect(es.app.nav.notices.length).toBeGreaterThan(0);
  });
});

describe('NoticeList', () => {
  it('shows markup in the text literally, never as HTML (AC-28)', () => {
    const text = '<b>Pay</b> <img src="x" onerror="alert(1)">';
    const { container } = renderApp(
      <NoticeList notices={[notice(1, { text })]} onOpen={() => undefined} />,
      { locale: 'en' },
    );

    expect(screen.getByText(text)).toBeTruthy();
    expect(container.querySelector('b, img')).toBeNull();
  });

  it('formats the due date with the locale, not a fixed format', () => {
    renderApp(<NoticeList notices={[notice(1)]} onOpen={() => undefined} />, { locale: 'en' });

    expect(screen.getByText(/Oct/)).toBeTruthy();
  });
});

describe('NoticesContainer', () => {
  it('lists the notices and marks an unread one read when tapped (AC-28)', async () => {
    const { calls } = stubApi({
      [FIRST_PAGE]: page([notice(2), notice(1, { readAt: READ_AT })], 1),
      [`POST /notices/${id(2)}/read`]: { status: 200, body: notice(2, { readAt: READ_AT }) },
    });
    renderApp(<NoticesContainer />, { locale: 'en' });

    const button = await screen.findByRole('button', { name: /Notice number 2/ });
    expect(screen.queryByRole('button', { name: /Notice number 1/ })).toBeNull();
    await userEvent.setup().click(button);

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /Notice number 2/ })).toBeNull();
    });
    expect(screen.getByText('Notice number 2')).toBeTruthy();
    expect(screen.getByText('No unread notices')).toBeTruthy();
    expect(writes(calls).map((call) => `${call.method} ${call.path}`)).toEqual([
      `POST /notices/${id(2)}/read`,
    ]);
  });

  it('puts the notice back as unread with a message when marking fails (AC-28)', async () => {
    stubApi({
      [FIRST_PAGE]: page([notice(2)], 1),
      [`POST /notices/${id(2)}/read`]: { status: 500 },
    });
    renderApp(<NoticesContainer />, { locale: 'en' });

    await userEvent.setup().click(await screen.findByRole('button', { name: /Notice number 2/ }));

    expect((await screen.findByRole('alert')).textContent).toContain(en.notices.errors.markRead);
    expect(screen.getByRole('button', { name: /Notice number 2/ })).toBeTruthy();
    expect(screen.getByText('1 unread notice')).toBeTruthy();
  });

  it('loads the next page with the cursor and appends it (AC-18)', async () => {
    const { calls } = stubApi({
      [FIRST_PAGE]: page([notice(3)], 2, 'cursor-1'),
      'GET /notices?limit=20&cursor=cursor-1': page([notice(2, { readAt: READ_AT })], 2),
    });
    renderApp(<NoticesContainer />, { locale: 'en' });

    const user = userEvent.setup();
    await screen.findByText('Notice number 3');
    await user.click(screen.getByRole('button', { name: en.notices.loadMore }));

    expect(await screen.findByText('Notice number 2')).toBeTruthy();
    expect(screen.getByText('Notice number 3')).toBeTruthy();
    expect(screen.queryByRole('button', { name: en.notices.loadMore })).toBeNull();
    expect(calls.map((call) => call.path)).toEqual([
      '/notices?limit=20',
      '/notices?limit=20&cursor=cursor-1',
    ]);
  });

  it('keeps what is shown and says so when the next page fails', async () => {
    stubApi({
      [FIRST_PAGE]: page([notice(3)], 1, 'cursor-1'),
      'GET /notices?limit=20&cursor=cursor-1': { status: 500 },
    });
    renderApp(<NoticesContainer />, { locale: 'en' });

    await userEvent.setup().click(await screen.findByRole('button', { name: en.notices.loadMore }));

    expect((await screen.findByRole('alert')).textContent).toContain(en.notices.errors.load);
    expect(screen.getByText('Notice number 3')).toBeTruthy();
  });

  it('shows the retry state when loading fails, and loads again on retry (AC-28)', async () => {
    const { calls } = stubApi({
      [FIRST_PAGE]: [{ status: 500 }, page([notice(1)], 1)],
    });
    renderApp(<NoticesContainer />, { locale: 'en' });

    const user = userEvent.setup();
    expect(await screen.findByText(en.notices.errors.load)).toBeTruthy();
    expect(screen.queryByText('Notice number 1')).toBeNull();
    await user.click(screen.getByRole('button', { name: en.notices.retry }));

    expect(await screen.findByText('Notice number 1')).toBeTruthy();
    expect(calls).toHaveLength(2);
  });

  it('shows the empty state without notices', async () => {
    stubApi({ [FIRST_PAGE]: page([], 0) });
    renderApp(<NoticesContainer />, { locale: 'en' });

    expect(await screen.findByText(en.notices.empty)).toBeTruthy();
    expect(screen.queryByRole('button', { name: en.notices.markAllRead })).toBeNull();
  });

  it('marks everything read and shows 0 unread (AC-21)', async () => {
    const { calls } = stubApi({
      [FIRST_PAGE]: page([notice(2), notice(1)], 2),
      [READ_ALL]: { status: 200, body: { unreadCount: 0 } },
    });
    renderApp(<NoticesContainer />, { locale: 'en' });

    await userEvent
      .setup()
      .click(await screen.findByRole('button', { name: en.notices.markAllRead }));

    expect(await screen.findByText('No unread notices')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Notice number/ })).toBeNull();
    expect(screen.queryByRole('button', { name: en.notices.markAllRead })).toBeNull();
    expect(writes(calls).map((call) => `${call.method} ${call.path}`)).toEqual([READ_ALL]);
  });

  it('keeps the notices unread with a message when mark all fails', async () => {
    stubApi({ [FIRST_PAGE]: page([notice(1)], 1), [READ_ALL]: { status: 500 } });
    renderApp(<NoticesContainer />, { locale: 'en' });

    await userEvent
      .setup()
      .click(await screen.findByRole('button', { name: en.notices.markAllRead }));

    expect((await screen.findByRole('alert')).textContent).toContain(en.notices.errors.markRead);
    expect(screen.getByRole('button', { name: /Notice number 1/ })).toBeTruthy();
  });

  it('sends the user to sign in when the session is gone', async () => {
    stubApi({
      [FIRST_PAGE]: { status: 401, body: { code: 'UNAUTHENTICATED' } },
      'POST /auth/refresh': { status: 401, body: { code: 'UNAUTHENTICATED' } },
    });
    const { router } = renderApp(<NoticesContainer />, { locale: 'en' });

    await waitFor(() => {
      expect(router.replace).toHaveBeenCalled();
    });
  });

  it('updates the unread badge after a notice is read (AC-27)', async () => {
    stubApi({
      [FIRST_PAGE]: page([notice(2), notice(1)], 2),
      [BADGE]: [page([notice(2)], 2), page([notice(1)], 1)],
      [`POST /notices/${id(2)}/read`]: { status: 200, body: notice(2, { readAt: READ_AT }) },
    });
    renderApp(
      <>
        <UnreadBadgeContainer />
        <NoticesContainer />
      </>,
      { locale: 'en' },
    );

    await screen.findByRole('link', { name: /2 unread/ });
    await userEvent.setup().click(await screen.findByRole('button', { name: /Notice number 2/ }));

    expect(await screen.findByRole('link', { name: /1 unread/ })).toBeTruthy();
  });
});

describe('shell entries for the notices (AC-27)', () => {
  it('shows the notices link with its badge slot in the top navigation', () => {
    const { container } = renderApp(
      <TopNav
        signingOut={false}
        onSignOut={() => undefined}
        notices={<span data-testid="slot">badge</span>}
      />,
      { locale: 'en' },
    );

    const nav = container.querySelector<HTMLElement>('[data-slot="top-nav"]');
    expect(nav).not.toBeNull();
    expect(within(nav as HTMLElement).getByTestId('slot')).toBeTruthy();
  });

  it('lists the notices on the More page, carrying the badge', () => {
    renderApp(
      <MoreMenu
        signingOut={false}
        signOutError={undefined}
        onSignOut={() => undefined}
        noticesBadge={<span data-testid="more-badge">3</span>}
      />,
      { locale: 'en' },
    );

    const row = screen.getByRole('link', { name: new RegExp(en.app.nav.notices) });
    expect(row.getAttribute('href')).toBe('/en/notices');
    expect(within(row).getByTestId('more-badge')).toBeTruthy();
  });
});

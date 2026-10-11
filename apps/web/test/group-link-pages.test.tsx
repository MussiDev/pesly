// @vitest-environment happy-dom
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, type Mock } from 'vitest';
import ClaimPage from '../src/app/[locale]/(app)/groups/claim/page';
import JoinPage from '../src/app/[locale]/(app)/groups/join/page';
import { takeFragmentToken } from '../src/features/groups/take-fragment-token';
import { CATALOGS, renderApp, stubApi } from './support/render-app';

const { es, en } = CATALOGS;
const TOKEN = 'B'.repeat(43);
const GROUP_ID = '3f0c1a52-6a43-4e0e-9a33-6f1f2b5d7a10';
const GROUP = {
  id: GROUP_ID,
  name: 'Casa',
  defaultRateType: 'blue',
  role: 'member',
  memberCount: 2,
  createdAt: '2026-10-02T15:30:00.000Z',
};

function openAt(path: string) {
  window.history.replaceState(null, '', path);
}

/**
 * Records what the address and the history look like when the first request leaves, then lets the
 * stubbed API answer as usual (so `calls` still records it).
 */
function snapshotAtRequest(fetch: Mock<(url: string, init?: RequestInit) => Promise<Response>>) {
  const seen: { hash?: string; historyLength?: number } = {};
  const answer = fetch.getMockImplementation();
  if (!answer) throw new Error('fetch is not stubbed');
  fetch.mockImplementation((url, init) => {
    seen.hash ??= window.location.hash;
    seen.historyLength ??= window.history.length;
    return answer(url, init);
  });
  return seen;
}

describe('takeFragmentToken', () => {
  it('returns the token and clears the fragment from the address', () => {
    openAt(`/es/groups/join?x=1#token=${TOKEN}`);
    expect(takeFragmentToken()).toBe(TOKEN);
    expect(window.location.hash).toBe('');
    expect(window.location.pathname + window.location.search).toBe('/es/groups/join?x=1');
  });

  it('returns null without a fragment token', () => {
    openAt('/es/groups/join');
    expect(takeFragmentToken()).toBeNull();
    openAt('/es/groups/join#other=1');
    expect(takeFragmentToken()).toBeNull();
  });
});

describe('join page', () => {
  it('joins with a valid invitation and opens the group (AC-07)', async () => {
    openAt(`/es/groups/join#token=${TOKEN}`);
    const { calls } = stubApi({ 'POST /groups/join': { status: 200, body: GROUP } });
    const { router } = renderApp(<JoinPage />);
    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith(`/es/groups/${GROUP_ID}`);
    });
    expect(calls).toEqual([{ method: 'POST', path: '/groups/join', body: { token: TOKEN } }]);
  });

  it('removes the token from the address before the request and keeps it out of history (NFR-04)', async () => {
    openAt(`/es/groups/join#token=${TOKEN}`);
    const { fetch } = stubApi({ 'POST /groups/join': { status: 200, body: GROUP } });
    const atRequest = snapshotAtRequest(fetch);
    const historyBefore = window.history.length;
    const replaceState = vi.spyOn(window.history, 'replaceState');
    const pushState = vi.spyOn(window.history, 'pushState');
    const { router } = renderApp(<JoinPage />);
    await waitFor(() => {
      expect(router.replace).toHaveBeenCalled();
    });
    expect(atRequest.hash).toBe('');
    expect(atRequest.historyLength).toBe(historyBefore);
    expect(window.history.length).toBe(historyBefore);
    expect(window.location.href).not.toContain(TOKEN);
    expect(pushState).not.toHaveBeenCalled();
    expect(replaceState.mock.calls.every(([, , url]) => !String(url).includes(TOKEN))).toBe(true);
  });

  it('shows the invalid-link message and a link to the list for an expired invitation (AC-08)', async () => {
    openAt(`/es/groups/join#token=${TOKEN}`);
    stubApi({ 'POST /groups/join': { status: 400, body: { code: 'TOKEN_INVALID' } } });
    const { router } = renderApp(<JoinPage />);
    expect(await screen.findByText(es.groups.join.join.invalid)).toBeTruthy();
    const back = screen.getByRole('link', { name: es.groups.join.backToGroups });
    expect(back.getAttribute('href')).toMatch(/\/groups$/);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('shows the already-member message once and does not join again (AC-09)', async () => {
    openAt(`/en/groups/join#token=${TOKEN}`);
    const { calls } = stubApi({
      'POST /groups/join': { status: 409, body: { code: 'GROUP_ALREADY_MEMBER' } },
    });
    renderApp(<JoinPage />, { locale: 'en' });
    expect(await screen.findByText(en.groups.join.alreadyMember)).toBeTruthy();
    expect(calls).toHaveLength(1);
  });

  it('shows the group-full message (AC-09)', async () => {
    openAt(`/es/groups/join#token=${TOKEN}`);
    stubApi({ 'POST /groups/join': { status: 409, body: { code: 'GROUP_MEMBER_LIMIT_REACHED' } } });
    renderApp(<JoinPage />);
    expect(await screen.findByText(es.groups.join.full)).toBeTruthy();
  });

  it('sends no request and shows the invalid-link state when the token is missing', async () => {
    openAt('/es/groups/join');
    const { calls } = stubApi({});
    renderApp(<JoinPage />);
    expect(await screen.findByText(es.groups.join.join.invalid)).toBeTruthy();
    expect(calls).toHaveLength(0);
  });

  it('treats an empty token as missing', async () => {
    openAt('/es/groups/join#token=');
    const { calls } = stubApi({});
    renderApp(<JoinPage />);
    expect(await screen.findByText(es.groups.join.join.invalid)).toBeTruthy();
    expect(calls).toHaveLength(0);
  });

  it('sends the request once when the component mounts twice', async () => {
    openAt(`/es/groups/join#token=${TOKEN}`);
    const { calls, fetch } = stubApi({ 'POST /groups/join': { status: 200, body: GROUP } });
    const atRequest = snapshotAtRequest(fetch);
    const historyBefore = window.history.length;
    const { router } = renderApp(<JoinPage />, { strict: true });
    await waitFor(() => {
      expect(router.replace).toHaveBeenCalled();
    });
    expect(calls).toHaveLength(1);
    expect(atRequest.hash).toBe('');
    expect(atRequest.historyLength).toBe(historyBefore);
    expect(window.history.length).toBe(historyBefore);
    expect(window.location.hash).toBe('');
  });

  it('offers a retry after a network failure that reuses the token from memory', async () => {
    openAt(`/es/groups/join#token=${TOKEN}`);
    const { calls } = stubApi({
      'POST /groups/join': ['network-error', { status: 200, body: GROUP }],
    });
    const { router } = renderApp(<JoinPage />);
    await userEvent.click(await screen.findByRole('button', { name: es.app.retry }));
    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith(`/es/groups/${GROUP_ID}`);
    });
    expect(calls.map((call) => call.body)).toEqual([{ token: TOKEN }, { token: TOKEN }]);
    expect(window.location.hash).toBe('');
  });

  it('asks the user to sign in and open the link again when the session is gone', async () => {
    openAt(`/es/groups/join#token=${TOKEN}`);
    stubApi({ 'POST /groups/join': { status: 401, body: { code: 'UNAUTHENTICATED' } } });
    renderApp(<JoinPage />);
    expect(await screen.findByText(es.groups.join.signIn)).toBeTruthy();
  });
});

describe('claim page', () => {
  it('assigns the seat and opens the group (AC-11)', async () => {
    openAt(`/es/groups/claim#token=${TOKEN}`);
    const { calls, fetch } = stubApi({ 'POST /groups/claim': { status: 200, body: GROUP } });
    const atRequest = snapshotAtRequest(fetch);
    const historyBefore = window.history.length;
    const { router } = renderApp(<ClaimPage />);
    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith(`/es/groups/${GROUP_ID}`);
    });
    expect(calls).toEqual([{ method: 'POST', path: '/groups/claim', body: { token: TOKEN } }]);
    expect(window.location.hash).toBe('');
    expect(atRequest.hash).toBe('');
    expect(atRequest.historyLength).toBe(historyBefore);
    expect(window.history.length).toBe(historyBefore);
  });

  it('shows the used-link message and changes nothing (AC-12)', async () => {
    openAt(`/es/groups/claim#token=${TOKEN}`);
    const { calls } = stubApi({
      'POST /groups/claim': { status: 400, body: { code: 'TOKEN_INVALID' } },
    });
    const { router } = renderApp(<ClaimPage />);
    expect(await screen.findByText(es.groups.join.claim.invalid)).toBeTruthy();
    expect(screen.getByRole('link', { name: es.groups.join.backToGroups })).toBeTruthy();
    expect(router.replace).not.toHaveBeenCalled();
    expect(calls).toHaveLength(1);
  });

  it('sends no request when the token is missing', async () => {
    openAt('/es/groups/claim');
    const { calls } = stubApi({});
    renderApp(<ClaimPage />);
    expect(await screen.findByText(es.groups.join.claim.invalid)).toBeTruthy();
    expect(calls).toHaveLength(0);
  });

  it('sends the request once under strict mode', async () => {
    openAt(`/es/groups/claim#token=${TOKEN}`);
    const { calls, fetch } = stubApi({ 'POST /groups/claim': { status: 200, body: GROUP } });
    const atRequest = snapshotAtRequest(fetch);
    const historyBefore = window.history.length;
    const { router } = renderApp(<ClaimPage />, { strict: true });
    await waitFor(() => {
      expect(router.replace).toHaveBeenCalled();
    });
    expect(calls).toHaveLength(1);
    expect(atRequest.hash).toBe('');
    expect(atRequest.historyLength).toBe(historyBefore);
    expect(window.history.length).toBe(historyBefore);
    expect(window.location.hash).toBe('');
  });
});

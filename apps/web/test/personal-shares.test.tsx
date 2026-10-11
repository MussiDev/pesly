// @vitest-environment happy-dom
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PersonalSharesContainer } from '../src/features/groups/shares/personal-shares-container';
import {
  buildSharesRequest,
  currentMonthRange,
  sumByCurrency,
} from '../src/features/groups/shares/shares-request';
import { CATALOGS, renderApp, stubApi } from './support/render-app';

const { en, es } = CATALOGS;
const GROUP_A = '55555555-5555-4555-8555-555555555551';
const GROUP_B = '55555555-5555-4555-8555-555555555552';
const SHARES = 'GET /groups/personal/shares';

const share = (n: number, overrides: Record<string, unknown> = {}) => ({
  expenseId: `66666666-6666-4666-8666-66666666666${n}`,
  groupId: GROUP_A,
  currency: 'ARS',
  occurredAt: '2026-10-05T15:00:00.000Z',
  shareAmount: '1000',
  receivableAmount: null,
  ...overrides,
});

const ITEMS = [
  share(1, { shareAmount: '100000', receivableAmount: '200000' }),
  share(2, { shareAmount: '50050' }),
  share(3, { currency: 'USD', groupId: GROUP_B, shareAmount: '1234' }),
];

function pathsOf(calls: { path: string }[]) {
  return calls.map((call) => new URL(`http://x${call.path}`));
}

describe('shares-request', () => {
  it('turns local calendar days into the UTC bounds of the range', () => {
    const built = buildSharesRequest(
      { from: '2026-10-01', to: '2026-10-31' },
      'America/Argentina/Buenos_Aires',
    );
    expect(built).toEqual({
      request: { from: '2026-10-01T03:00:00.000Z', to: '2026-11-01T02:59:59.999Z' },
    });
  });

  it('rejects a start after the end', () => {
    expect(buildSharesRequest({ from: '2026-10-10', to: '2026-10-09' }, 'UTC')).toEqual({
      fields: { to: 'groups.shares.errors.rangeOrder' },
    });
  });

  it('rejects malformed and impossible dates and empty fields', () => {
    expect(buildSharesRequest({ from: '2026-13-45', to: '10/31/2026' }, 'UTC').fields).toEqual({
      from: 'groups.shares.errors.fromInvalid',
      to: 'groups.shares.errors.toInvalid',
    });
    expect(buildSharesRequest({ from: '2026-02-30', to: '2026-03-01' }, 'UTC').fields).toEqual({
      from: 'groups.shares.errors.fromInvalid',
    });
    expect(buildSharesRequest({ from: '', to: '' }, 'UTC').fields).toEqual({
      from: 'groups.shares.errors.fromRequired',
      to: 'groups.shares.errors.toRequired',
    });
  });

  it('defaults to the current month in the time zone', () => {
    // 2026-11-01 01:00 UTC is still October 31 in Buenos Aires.
    expect(
      currentMonthRange(new Date('2026-11-01T01:00:00Z'), 'America/Argentina/Buenos_Aires'),
    ).toEqual({
      from: '2026-10-01',
      to: '2026-10-31',
    });
    expect(currentMonthRange(new Date('2028-02-10T12:00:00Z'), 'UTC')).toEqual({
      from: '2028-02-01',
      to: '2028-02-29',
    });
  });

  it('sums per currency with bigint and never mixes currencies', () => {
    const totals = sumByCurrency([
      { currency: 'ARS', shareAmount: '9007199254740993' },
      { currency: 'ARS', shareAmount: '7' },
      { currency: 'USD', shareAmount: '5' },
    ]);
    expect(totals).toEqual([
      { currency: 'ARS', total: 9007199254741000n },
      { currency: 'USD', total: 5n },
    ]);
  });
});

// Testing Library normalizes the non-breaking space the formatter uses to a plain space.
const NBSP = ' ';

// The test renderer's time zone is UTC, so the default range is this month in UTC.
const RANGE = currentMonthRange(new Date(), 'UTC');
const BOUNDS = (() => {
  const built = buildSharesRequest(RANGE, 'UTC');
  if (!built.request) throw new Error('the default range must be valid');
  return built.request;
})();

function sharesPath(range: { from: string; to: string }, cursor?: string): string {
  const query = new URLSearchParams({ from: range.from, to: range.to });
  if (cursor !== undefined) query.set('cursor', cursor);
  return `${SHARES}?${query.toString()}`;
}

const DEFAULT_PATH = sharesPath(BOUNDS);

const page = (items: unknown[], nextCursor: string | null = null) => ({
  status: 200,
  body: { items, nextCursor },
});

const open = (locale: 'en' | 'es' = 'en') => renderApp(<PersonalSharesContainer />, { locale });

const list = () => screen.getByRole('list', { name: en.groups.shares.listLabel });
const listed = (text: string) => within(list()).getByText(text);
const rowOf = (text: string) => {
  const row = listed(text).closest('li');
  if (!row) throw new Error(`No row for ${text}`);
  return row;
};
const ready = () => screen.findByRole('list', { name: en.groups.shares.listLabel });

describe('PersonalSharesContainer', () => {
  it('lists shares with currency and per-currency totals, with no conversion (AC-15)', async () => {
    const { calls } = stubApi({ [DEFAULT_PATH]: page(ITEMS) });
    open();

    await ready();
    expect(listed(`1,000.00${NBSP}ARS`)).toBeTruthy();
    expect(listed(`500.50${NBSP}ARS`)).toBeTruthy();
    expect(listed(`12.34${NBSP}USD`)).toBeTruthy();

    const totals = screen.getByRole('region', { name: en.groups.shares.totals.title });
    expect(within(totals).getByText(`1,500.50${NBSP}ARS`)).toBeTruthy();
    expect(within(totals).getByText(`12.34${NBSP}USD`)).toBeTruthy();
    // Two currencies, two totals: nothing is summed across them.
    expect(within(totals).getAllByRole('listitem')).toHaveLength(2);

    const url = pathsOf(calls)[0];
    expect(url?.searchParams.get('from')).toBe(BOUNDS.from);
    expect(url?.searchParams.get('to')).toBe(BOUNDS.to);
  });

  it('shows the receivable only on shares the user paid (AC-15)', async () => {
    stubApi({ [DEFAULT_PATH]: page(ITEMS) });
    open();
    await ready();

    const paid = rowOf(`1,000.00${NBSP}ARS`);
    expect(within(paid).getByText(en.groups.shares.receivable)).toBeTruthy();
    expect(within(paid).getByText(`2,000.00${NBSP}ARS`)).toBeTruthy();
    expect(within(rowOf(`12.34${NBSP}USD`)).queryByText(en.groups.shares.receivable)).toBeNull();
    expect(screen.getAllByText(en.groups.shares.receivable)).toHaveLength(1);
    expect(within(rowOf(`500.50${NBSP}ARS`)).queryByText(en.groups.shares.receivable)).toBeNull();
  });

  it('sends no request for a start after the end and shows a field error (AC-16)', async () => {
    const { calls } = stubApi({ [DEFAULT_PATH]: page(ITEMS) });
    open();
    await ready();
    const before = calls.length;

    fireEvent.change(screen.getByLabelText(en.groups.shares.from), {
      target: { value: '2026-12-31' },
    });
    fireEvent.change(screen.getByLabelText(en.groups.shares.to), {
      target: { value: '2026-12-01' },
    });
    await userEvent.click(screen.getByRole('button', { name: en.groups.shares.apply }));

    expect(await screen.findByText(en.groups.shares.errors.rangeOrder)).toBeTruthy();
    expect(calls.length).toBe(before);
  });

  it('sends no request when a date is missing or malformed (AC-16)', async () => {
    const { calls } = stubApi({ [DEFAULT_PATH]: page(ITEMS) });
    open();
    await ready();
    const before = calls.length;

    fireEvent.change(screen.getByLabelText(en.groups.shares.from), { target: { value: '' } });
    await userEvent.click(screen.getByRole('button', { name: en.groups.shares.apply }));

    expect(await screen.findByText(en.groups.shares.errors.fromRequired)).toBeTruthy();
    expect(calls.length).toBe(before);
  });

  it('requests the new range when it is valid', async () => {
    const next = { from: '2026-01-01', to: '2026-01-31' };
    const nextBounds = buildSharesRequest(next, 'UTC').request;
    if (!nextBounds) throw new Error('valid range expected');
    const { calls } = stubApi({
      [DEFAULT_PATH]: page(ITEMS),
      [sharesPath(nextBounds)]: page([share(4, { shareAmount: '777' })]),
    });
    open();
    await ready();

    fireEvent.change(screen.getByLabelText(en.groups.shares.from), {
      target: { value: next.from },
    });
    fireEvent.change(screen.getByLabelText(en.groups.shares.to), { target: { value: next.to } });
    await userEvent.click(screen.getByRole('button', { name: en.groups.shares.apply }));

    await waitFor(() => {
      expect(listed(`7.77${NBSP}ARS`)).toBeTruthy();
    });
    expect(within(list()).queryByText(`500.50${NBSP}ARS`)).toBeNull();
    expect(calls.map((call) => call.path)).toContain(sharesPath(nextBounds).replace('GET ', ''));
  });

  it('shows the empty state for a range with no shares', async () => {
    stubApi({ [DEFAULT_PATH]: page([]) });
    open();
    expect(await screen.findByText(en.groups.shares.empty.title)).toBeTruthy();
    expect(screen.queryByRole('region', { name: en.groups.shares.totals.title })).toBeNull();
  });

  it('shows the error state and retries a failed load', async () => {
    const { calls } = stubApi({ [DEFAULT_PATH]: [{ status: 500 }, page(ITEMS)] });
    open();

    await userEvent.click(await screen.findByRole('button', { name: en.app.retry }));

    await ready();
    expect(listed(`1,000.00${NBSP}ARS`)).toBeTruthy();
    expect(calls).toHaveLength(2);
  });

  it('makes one request per page and follows the cursor on "load more" (NFR-02)', async () => {
    const { calls } = stubApi({
      [DEFAULT_PATH]: page([ITEMS[0]], 'CURSOR-1'),
      [sharesPath(BOUNDS, 'CURSOR-1')]: page([ITEMS[2]]),
    });
    open();
    await ready();
    expect(calls).toHaveLength(1);

    await userEvent.click(screen.getByRole('button', { name: en.groups.shares.loadMore }));

    await waitFor(() => {
      expect(listed(`12.34${NBSP}USD`)).toBeTruthy();
    });
    expect(calls).toHaveLength(2);
    expect(listed(`1,000.00${NBSP}ARS`)).toBeTruthy();
    // The totals follow what is listed: the USD total appears only once it is loaded.
    const totals = screen.getByRole('region', { name: en.groups.shares.totals.title });
    expect(within(totals).getByText(`1,000.00${NBSP}ARS`)).toBeTruthy();
    expect(within(totals).getByText(`12.34${NBSP}USD`)).toBeTruthy();
    expect(screen.queryByRole('button', { name: en.groups.shares.loadMore })).toBeNull();
  });

  it('says the totals cover only the loaded rows while more pages remain', async () => {
    stubApi({
      [DEFAULT_PATH]: page([ITEMS[0]], 'CURSOR-1'),
      [sharesPath(BOUNDS, 'CURSOR-1')]: page([ITEMS[2]]),
    });
    open();
    await ready();
    const totals = screen.getByRole('region', { name: en.groups.shares.totals.title });
    expect(within(totals).getByText(en.groups.shares.totals.partial)).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: en.groups.shares.loadMore }));
    await waitFor(() => {
      expect(listed(`12.34${NBSP}USD`)).toBeTruthy();
    });
    expect(screen.queryByText(en.groups.shares.totals.partial)).toBeNull();
  });

  it('ignores a load-more answer that arrives after the range changed', async () => {
    const next = { from: '2026-01-01', to: '2026-01-31' };
    const nextBounds = buildSharesRequest(next, 'UTC').request;
    if (!nextBounds) throw new Error('valid range expected');
    const stub = stubApi({
      [DEFAULT_PATH]: page([ITEMS[0]], 'CURSOR-1'),
      [sharesPath(BOUNDS, 'CURSOR-1')]: page([ITEMS[2]]),
      [sharesPath(nextBounds)]: page([share(4, { shareAmount: '777' })]),
    });
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) =>
      url.includes('cursor=CURSOR-1')
        ? held.then(() => stub.fetch(url, init))
        : stub.fetch(url, init),
    );
    open();
    await ready();
    await userEvent.click(screen.getByRole('button', { name: en.groups.shares.loadMore }));

    fireEvent.change(screen.getByLabelText(en.groups.shares.from), {
      target: { value: next.from },
    });
    fireEvent.change(screen.getByLabelText(en.groups.shares.to), { target: { value: next.to } });
    await userEvent.click(screen.getByRole('button', { name: en.groups.shares.apply }));
    await waitFor(() => {
      expect(listed(`7.77${NBSP}ARS`)).toBeTruthy();
    });

    release();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(within(list()).queryByText(`12.34${NBSP}USD`)).toBeNull();
    expect(within(list()).queryByText(`1,000.00${NBSP}ARS`)).toBeNull();
    expect(listed(`7.77${NBSP}ARS`)).toBeTruthy();
  });

  it('renders Spanish and English strings (AC-17)', async () => {
    stubApi({ [DEFAULT_PATH]: page(ITEMS) });
    const spanish = open('es');
    expect(await screen.findByRole('heading', { name: es.groups.shares.title })).toBeTruthy();
    expect(screen.getByLabelText(es.groups.shares.from)).toBeTruthy();
    expect(screen.getByRole('region', { name: es.groups.shares.totals.title })).toBeTruthy();
    expect(screen.getByText(es.groups.shares.receivable)).toBeTruthy();
    spanish.unmount();

    stubApi({ [DEFAULT_PATH]: page(ITEMS) });
    open('en');
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: en.groups.shares.title })).toBeTruthy();
    });
    expect(screen.getByLabelText(en.groups.shares.from)).toBeTruthy();
  });
});

// @vitest-environment happy-dom
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { DefaultSplitContainer } from '../src/features/groups/default-split/default-split-container';
import { buildDefaultSplitRequest } from '../src/features/groups/default-split/default-split-request';
import { CATALOGS, renderApp, stubApi } from './support/render-app';
import { findSegment, pickSegment, segmentValue } from './support/segmented';

const { en } = CATALOGS;
const GROUP_ID = '55555555-5555-4555-8555-555555555555';
const ANA = '77777777-7777-4777-8777-777777777771';
const BEN = '77777777-7777-4777-8777-777777777772';
const OPTIONS = `GET /groups/${GROUP_ID}/expense-options`;
const GROUP = `GET /groups/${GROUP_ID}`;
const PUT = `PUT /groups/${GROUP_ID}/default-split`;

const options = (defaultSplit: object = { mode: 'equal' }) => ({
  selfMemberId: ANA,
  members: [
    { id: ANA, displayName: 'Ana', isGhost: false, joinedAt: '2026-10-01T00:00:00.000Z' },
    { id: BEN, displayName: 'Ben', isGhost: false, joinedAt: '2026-10-02T00:00:00.000Z' },
  ],
  categories: [],
  defaultSplit,
  defaultRateType: 'blue',
});

const detail = (role: 'admin' | 'member') => ({
  id: GROUP_ID,
  name: 'Flatmates',
  defaultRateType: 'blue',
  role,
  memberCount: 2,
  createdAt: '2026-10-01T00:00:00.000Z',
  selfMemberId: ANA,
  members: [
    { id: ANA, displayName: 'Ana', isGhost: false, role, joinedAt: '2026-10-01T00:00:00.000Z' },
    {
      id: BEN,
      displayName: 'Ben',
      isGhost: false,
      role: 'member',
      joinedAt: '2026-10-02T00:00:00.000Z',
    },
  ],
  formerMembers: [],
});

const PERCENTAGE_6040 = {
  mode: 'percentage',
  shares: [
    { memberId: ANA, basisPoints: 6000 },
    { memberId: BEN, basisPoints: 4000 },
  ],
};

const open = () => renderApp(<DefaultSplitContainer groupId={GROUP_ID} />, { locale: 'en' });

const percentField = (name: string) =>
  screen.getByLabelText(en.groups.defaultSplit.percentLabel.replace('{name}', name));

describe('buildDefaultSplitRequest', () => {
  it('builds an equal request that names no members', () => {
    expect(buildDefaultSplitRequest('equal', [ANA, BEN], {})).toEqual({
      request: { mode: 'equal' },
    });
  });

  it('builds a percentage request in basis points', () => {
    expect(
      buildDefaultSplitRequest('percentage', [ANA, BEN], { [ANA]: '60,5', [BEN]: '39.5' }),
    ).toEqual({
      request: {
        mode: 'percentage',
        shares: [
          { memberId: ANA, basisPoints: 6050 },
          { memberId: BEN, basisPoints: 3950 },
        ],
      },
    });
  });

  it('reports the signed difference when the total is not 100%', () => {
    const result = buildDefaultSplitRequest('percentage', [ANA, BEN], { [ANA]: '60', [BEN]: '30' });
    expect(result.request).toBeUndefined();
    expect(result.difference).toBe(1000n);
    const over = buildDefaultSplitRequest('percentage', [ANA, BEN], { [ANA]: '60', [BEN]: '50' });
    expect(over.difference).toBe(-1000n);
  });

  it('flags unparseable percentages per member', () => {
    const result = buildDefaultSplitRequest('percentage', [ANA, BEN], { [ANA]: 'abc' });
    expect(result.request).toBeUndefined();
    expect(result.errors?.map((e) => e.memberId)).toEqual([ANA, BEN]);
  });
});

describe('DefaultSplitContainer', () => {
  it('lets an admin save a percentage default (AC-13)', async () => {
    const { calls } = stubApi({
      [OPTIONS]: { status: 200, body: options() },
      [GROUP]: { status: 200, body: detail('admin') },
      [PUT]: { status: 200, body: PERCENTAGE_6040 },
    });
    open();
    const user = userEvent.setup();

    await findSegment(en.groups.defaultSplit.modeLabel);
    await pickSegment(en.groups.defaultSplit.modeLabel, 'percentage');
    await user.type(percentField('Ana'), '60');
    await user.type(percentField('Ben'), '40');
    await user.click(screen.getByRole('button', { name: en.groups.defaultSplit.save }));

    await waitFor(() => {
      expect(calls.find((c) => c.method === 'PUT')?.body).toEqual(PERCENTAGE_6040);
    });
    expect(await screen.findByText(en.groups.defaultSplit.saved)).toBeTruthy();
    expect((percentField('Ana') as HTMLInputElement).value).toBe('60');
  });

  it('prefills the form from the stored percentage default', async () => {
    stubApi({
      [OPTIONS]: { status: 200, body: options(PERCENTAGE_6040) },
      [GROUP]: { status: 200, body: detail('admin') },
    });
    open();

    await findSegment(en.groups.defaultSplit.modeLabel);
    expect(segmentValue(en.groups.defaultSplit.modeLabel)).toBe('percentage');
    expect((percentField('Ana') as HTMLInputElement).value).toBe('60');
    expect((percentField('Ben') as HTMLInputElement).value).toBe('40');
  });

  it('lets an admin save an equal default (AC-13)', async () => {
    const { calls } = stubApi({
      [OPTIONS]: { status: 200, body: options(PERCENTAGE_6040) },
      [GROUP]: { status: 200, body: detail('admin') },
      [PUT]: { status: 200, body: { mode: 'equal' } },
    });
    open();
    const user = userEvent.setup();

    await findSegment(en.groups.defaultSplit.modeLabel);
    await pickSegment(en.groups.defaultSplit.modeLabel, 'equal');
    await user.click(screen.getByRole('button', { name: en.groups.defaultSplit.save }));

    await waitFor(() => {
      expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ mode: 'equal' });
    });
    expect(await screen.findByText(en.groups.defaultSplit.saved)).toBeTruthy();
  });

  it('shows a member the default read only, with no save control (AC-14)', async () => {
    stubApi({
      [OPTIONS]: { status: 200, body: options(PERCENTAGE_6040) },
      [GROUP]: { status: 200, body: detail('member') },
    });
    open();

    expect(await screen.findByText(en.groups.defaultSplit.readOnly)).toBeTruthy();
    expect(screen.getByText('Ana')).toBeTruthy();
    expect(screen.getByText('60%')).toBeTruthy();
    expect(screen.getByText('40%')).toBeTruthy();
    expect(screen.queryByRole('button', { name: en.groups.defaultSplit.save })).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('rejects percentages that do not total 100%, shows the difference and sends nothing', async () => {
    const { calls } = stubApi({
      [OPTIONS]: { status: 200, body: options() },
      [GROUP]: { status: 200, body: detail('admin') },
    });
    open();
    const user = userEvent.setup();

    await findSegment(en.groups.defaultSplit.modeLabel);
    await pickSegment(en.groups.defaultSplit.modeLabel, 'percentage');
    await user.type(percentField('Ana'), '60');
    await user.type(percentField('Ben'), '30');
    await user.click(screen.getByRole('button', { name: en.groups.defaultSplit.save }));

    expect(
      await screen.findByText(en.groups.defaultSplit.missing.replace('{amount}', '10')),
    ).toBeTruthy();
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(0);
  });

  it('shows the message of a 403 and leaves the saved default unchanged', async () => {
    stubApi({
      [OPTIONS]: { status: 200, body: options() },
      [GROUP]: { status: 200, body: detail('admin') },
      [PUT]: { status: 403, body: { error: { code: 'GROUP_ADMIN_REQUIRED', message: 'no' } } },
    });
    open();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: en.groups.defaultSplit.save }));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByText(en.groups.defaultSplit.saved)).toBeNull();
    expect(segmentValue(en.groups.defaultSplit.modeLabel)).toBe('equal');
  });

  it('keeps the typed values after a 400 refusal', async () => {
    stubApi({
      [OPTIONS]: { status: 200, body: options() },
      [GROUP]: { status: 200, body: detail('admin') },
      [PUT]: {
        status: 400,
        body: { error: { code: 'GROUP_SPLIT_PERCENTAGE_INVALID', message: 'bad' } },
      },
    });
    open();
    const user = userEvent.setup();

    await findSegment(en.groups.defaultSplit.modeLabel);
    await pickSegment(en.groups.defaultSplit.modeLabel, 'percentage');
    await user.type(percentField('Ana'), '70');
    await user.type(percentField('Ben'), '30');
    await user.click(screen.getByRole('button', { name: en.groups.defaultSplit.save }));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect((percentField('Ana') as HTMLInputElement).value).toBe('70');
    expect((percentField('Ben') as HTMLInputElement).value).toBe('30');
  });

  it('shows the shared error state with a retry when the load fails', async () => {
    const { calls } = stubApi({
      [OPTIONS]: [{ status: 500 }, { status: 200, body: options() }],
      [GROUP]: [
        { status: 200, body: detail('admin') },
        { status: 200, body: detail('admin') },
      ],
    });
    open();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: en.app.retry }));

    expect(await screen.findByLabelText(en.groups.defaultSplit.modeLabel)).toBeTruthy();
    expect(calls.filter((c) => c.path.endsWith('/expense-options'))).toHaveLength(2);
  });

  it('loads with at most 2 requests: the options and the group (NFR-02)', async () => {
    const { calls } = stubApi({
      [OPTIONS]: { status: 200, body: options() },
      [GROUP]: { status: 200, body: detail('admin') },
    });
    open();

    await screen.findByLabelText(en.groups.defaultSplit.modeLabel);
    expect(calls).toHaveLength(2);
  });

  it('shows the not-found state for a malformed group id and sends no request', () => {
    const { calls } = stubApi({});
    renderApp(<DefaultSplitContainer groupId="not-a-uuid" />, { locale: 'en' });
    expect(screen.getByText(en.groups.detail.notFound.title)).toBeTruthy();
    expect(calls).toHaveLength(0);
  });
});

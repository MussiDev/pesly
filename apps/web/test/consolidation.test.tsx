// @vitest-environment happy-dom
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ConsolidationContainer } from '../src/features/groups/consolidation/consolidation-container';
import { formatMoney } from '../src/lib/format-amount';
import { API_ORIGIN, CATALOGS, renderApp, stubApi } from './support/render-app';

const { en, es } = CATALOGS;
const GROUP_ID = '55555555-5555-4555-8555-555555555555';
const ANA = '11111111-1111-4111-8111-111111111111';
const BRUNO = '22222222-2222-4222-8222-222222222222';
const CARLA = '33333333-3333-4333-8333-333333333333';
const GET_GROUP = `GET /groups/${GROUP_ID}`;
const POST = `POST /groups/${GROUP_ID}/settlements`;
const PREVIEW = (a: string, b: string, currency = 'ARS') =>
  `GET /groups/${GROUP_ID}/settlements/consolidation?memberA=${a}&memberB=${b}&currency=${currency}`;

const group = {
  id: GROUP_ID,
  name: 'Flatmates',
  defaultRateType: 'blue',
  role: 'admin',
  memberCount: 3,
  createdAt: '2026-10-01T00:00:00.000Z',
  selfMemberId: ANA,
  members: [
    {
      id: ANA,
      displayName: 'Ana',
      isGhost: false,
      role: 'admin',
      joinedAt: '2026-10-01T00:00:00.000Z',
    },
    {
      id: BRUNO,
      displayName: 'Bruno',
      isGhost: false,
      role: 'member',
      joinedAt: '2026-10-01T00:00:00.000Z',
    },
    {
      id: CARLA,
      displayName: 'Carla',
      isGhost: true,
      role: 'member',
      joinedAt: '2026-10-01T00:00:00.000Z',
    },
  ],
  formerMembers: [],
};

/** Ana is owed 50,000.00 ARS and owes 20.00 USD; at 1200 the cash is 26,000.00 ARS, Ana to Bruno. */
const preview = (overrides: Record<string, unknown> = {}) => ({
  legs: { ARS: '5000000', USD: '-2000' },
  defaultRateType: 'blue',
  rate: '12000000',
  ...overrides,
});

const settlement = {
  id: '99999999-9999-4999-8999-999999999999',
  groupId: GROUP_ID,
  fromMemberId: ANA,
  toMemberId: BRUNO,
  currency: 'ARS',
  amount: '2600000',
  legs: [
    { currency: 'ARS', amount: '5000000' },
    { currency: 'USD', amount: '-2000' },
  ],
  occurredAt: '2026-10-10T12:00:00.000Z',
  createdByMemberId: ANA,
  accountId: null,
  rate: '12000000',
  rateSource: 'automatic',
  rateType: 'blue',
  createdAt: '2026-10-10T12:00:00.000Z',
  version: 1,
};

// A space the DOM text normalizer also produces for the non-breaking one money uses.
const money = (value: bigint, currency: 'ARS' | 'USD', locale: 'en' | 'es' = 'en') =>
  formatMoney(value, currency, locale).replace(/\s/g, ' ');

const open = (locale: 'en' | 'es' = 'en') =>
  renderApp(<ConsolidationContainer groupId={GROUP_ID} />, { locale });

async function choose(second = BRUNO) {
  await screen.findByLabelText(en.groups.consolidate.fields.memberB);
  await userEvent.selectOptions(
    screen.getByLabelText(en.groups.consolidate.fields.memberB),
    second,
  );
}

function fieldValue(label: string): string {
  const field = screen.getByLabelText(label);
  if (!(field instanceof HTMLInputElement || field instanceof HTMLSelectElement)) {
    throw new Error('Not a form field');
  }
  return field.value;
}

const recordButton = () => screen.queryByRole('button', { name: en.groups.consolidate.record });

describe('ConsolidationContainer', () => {
  it('shows each currency per direction, the rate type, the rate and the cash (AC-12)', async () => {
    const { calls } = stubApi({
      [GET_GROUP]: { status: 200, body: group },
      [PREVIEW(ANA, BRUNO)]: { status: 200, body: preview() },
    });
    open();
    await choose();

    expect(await screen.findByText(`Ana pays Bruno ${money(5000000n, 'ARS')}`)).toBeTruthy();
    expect(screen.getByText(`Bruno pays Ana ${money(2000n, 'USD')}`)).toBeTruthy();
    expect(screen.getByText('Default rate type: Blue')).toBeTruthy();
    expect(fieldValue(en.groups.consolidate.fields.rate)).toBe('1200');
    expect(screen.getByText(`Ana pays Bruno ${money(2600000n, 'ARS')}`)).toBeTruthy();
    // The first member defaults to the caller; the group and one preview are all that was loaded.
    expect(calls.map((call) => call.path)).toEqual([
      `/groups/${GROUP_ID}`,
      `/groups/${GROUP_ID}/settlements/consolidation?memberA=${ANA}&memberB=${BRUNO}&currency=ARS`,
    ]);
  });

  it('swaps the parties of the cash when the total is negative (AC-16)', async () => {
    stubApi({
      [GET_GROUP]: { status: 200, body: group },
      [PREVIEW(ANA, BRUNO)]: {
        status: 200,
        body: preview({ legs: { ARS: '100000', USD: '-2000' } }),
      },
    });
    open();
    await choose();

    // 1,000.00 ARS - 20.00 USD * 1200 = -23,000.00 ARS: Bruno pays Ana.
    expect(await screen.findByText(`Bruno pays Ana ${money(2300000n, 'ARS')}`)).toBeTruthy();
  });

  it('says there is nothing to consolidate and offers no record action for a zero leg (AC-13)', async () => {
    stubApi({
      [GET_GROUP]: { status: 200, body: group },
      [PREVIEW(ANA, BRUNO)]: { status: 200, body: preview({ legs: { ARS: '5000000', USD: '0' } }) },
    });
    open();
    await choose();

    expect(await screen.findByText(en.groups.consolidate.nothing)).toBeTruthy();
    expect(recordButton()).toBeNull();
  });

  it('sends a typed rate greater than 0 as its scaled string (AC-14)', async () => {
    const { calls } = stubApi({
      [GET_GROUP]: { status: 200, body: group },
      [PREVIEW(ANA, BRUNO)]: { status: 200, body: preview() },
      [POST]: { status: 201, body: settlement },
    });
    open();
    await choose();
    const rate = await screen.findByLabelText(en.groups.consolidate.fields.rate);
    await userEvent.clear(rate);
    await userEvent.type(rate, '1,300.5');
    // 50,000.00 - 20.00 * 1300.5 = 23,990.00 ARS.
    expect(await screen.findByText(`Ana pays Bruno ${money(2399000n, 'ARS')}`)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: en.groups.consolidate.record }));

    await waitFor(() => {
      expect(calls.some((call) => call.method === 'POST')).toBe(true);
    });
    const post = calls.find((call) => call.method === 'POST');
    expect(post?.body).toMatchObject({
      kind: 'consolidated',
      memberIds: [ANA, BRUNO],
      currency: 'ARS',
      rate: '13005000',
      legs: { ARS: '5000000', USD: '-2000' },
    });
  });

  it('sends no rate when the prefilled one is left alone (D7)', async () => {
    const { calls } = stubApi({
      [GET_GROUP]: { status: 200, body: group },
      [PREVIEW(ANA, BRUNO)]: { status: 200, body: preview() },
      [POST]: { status: 201, body: settlement },
    });
    open();
    await choose();
    await screen.findByText('Default rate type: Blue');
    await userEvent.click(screen.getByRole('button', { name: en.groups.consolidate.record }));

    await waitFor(() => {
      expect(calls.some((call) => call.method === 'POST')).toBe(true);
    });
    expect(calls.find((call) => call.method === 'POST')?.body).not.toHaveProperty('rate');
  });

  it.each(['', '0', 'abc'])(
    'refuses the typed rate "%s" and sends nothing (AC-15)',
    async (typed) => {
      const { calls } = stubApi({
        [GET_GROUP]: { status: 200, body: group },
        [PREVIEW(ANA, BRUNO)]: { status: 200, body: preview() },
        [POST]: { status: 201, body: settlement },
      });
      open();
      await choose();
      const rate = await screen.findByLabelText(en.groups.consolidate.fields.rate);
      await userEvent.clear(rate);
      if (typed !== '') await userEvent.type(rate, typed);
      await userEvent.click(screen.getByRole('button', { name: en.groups.consolidate.record }));

      expect(await screen.findByText(en.groups.consolidate.errors.rateInvalid)).toBeTruthy();
      expect(calls.some((call) => call.method === 'POST')).toBe(false);
    },
  );

  it('requires a typed rate when the preview has none (AC-15)', async () => {
    const { calls } = stubApi({
      [GET_GROUP]: { status: 200, body: group },
      [PREVIEW(ANA, BRUNO)]: { status: 200, body: preview({ rate: null }) },
      [POST]: { status: 201, body: settlement },
    });
    open();
    await choose();
    await screen.findByText(en.groups.consolidate.rate.missing);
    await userEvent.click(screen.getByRole('button', { name: en.groups.consolidate.record }));

    expect(await screen.findByText(en.groups.consolidate.errors.rateRequired)).toBeTruthy();
    expect(calls.some((call) => call.method === 'POST')).toBe(false);
  });

  it('confirms who paid whom and shows both legs at 0 after recording (AC-16)', async () => {
    stubApi({
      [GET_GROUP]: { status: 200, body: group },
      [PREVIEW(ANA, BRUNO)]: [
        { status: 200, body: preview() },
        { status: 200, body: preview({ legs: { ARS: '0', USD: '0' } }) },
      ],
      [POST]: { status: 201, body: settlement },
    });
    open();
    await choose();
    await screen.findByText('Default rate type: Blue');
    await userEvent.click(screen.getByRole('button', { name: en.groups.consolidate.record }));

    expect(await screen.findByText(`Ana paid Bruno ${money(2600000n, 'ARS')}.`)).toBeTruthy();
    expect(await screen.findByText(`No balance in ARS`)).toBeTruthy();
    expect(screen.getByText('No balance in USD')).toBeTruthy();
    expect(recordButton()).toBeNull();
  });

  it('reloads the preview on a stale answer, keeps the typed rate and asks to confirm again (AC-17)', async () => {
    const { calls } = stubApi({
      [GET_GROUP]: { status: 200, body: group },
      [PREVIEW(ANA, BRUNO)]: [
        { status: 200, body: preview() },
        { status: 200, body: preview({ legs: { ARS: '6000000', USD: '-2000' } }) },
      ],
      [POST]: [
        { status: 409, body: { code: 'GROUP_SETTLEMENT_STALE' } },
        { status: 201, body: settlement },
      ],
    });
    open();
    await choose();
    const rate = await screen.findByLabelText(en.groups.consolidate.fields.rate);
    await userEvent.clear(rate);
    await userEvent.type(rate, '1,000');
    await userEvent.click(screen.getByRole('button', { name: en.groups.consolidate.record }));

    expect(await screen.findByText(en.groups.consolidate.stale)).toBeTruthy();
    // 60,000.00 - 20.00 * 1000 = 40,000.00 ARS, with the typed rate still in the field.
    expect(await screen.findByText(`Ana pays Bruno ${money(6000000n, 'ARS')}`)).toBeTruthy();
    expect(screen.getByText(`Ana pays Bruno ${money(4000000n, 'ARS')}`)).toBeTruthy();
    expect(fieldValue(en.groups.consolidate.fields.rate)).toBe('1,000');
    // Nothing was recorded meanwhile: one refused POST, and the second needs a new confirmation.
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: en.groups.consolidate.record }));
    await waitFor(() => {
      expect(calls.filter((call) => call.method === 'POST')).toHaveLength(2);
    });
    expect(calls.filter((call) => call.method === 'POST')[1]?.body).toMatchObject({
      legs: { ARS: '6000000', USD: '-2000' },
      rate: '10000000',
    });
  });

  it('shows the message of a nothing-to-consolidate refusal and no record action', async () => {
    stubApi({
      [GET_GROUP]: { status: 200, body: group },
      [PREVIEW(ANA, BRUNO)]: { status: 200, body: preview() },
      [POST]: { status: 400, body: { code: 'GROUP_SETTLEMENT_NOTHING_TO_CONSOLIDATE' } },
    });
    open();
    await choose();
    await screen.findByText('Default rate type: Blue');
    await userEvent.click(screen.getByRole('button', { name: en.groups.consolidate.record }));

    expect(await screen.findByText(en.errors.groupSettlementNothingToConsolidate)).toBeTruthy();
    expect(recordButton()).toBeNull();
  });

  it('shows the member-invalid message and keeps the choice', async () => {
    stubApi({
      [GET_GROUP]: { status: 200, body: group },
      [PREVIEW(ANA, BRUNO)]: { status: 200, body: preview() },
      [POST]: { status: 400, body: { code: 'GROUP_SETTLEMENT_MEMBER_INVALID' } },
    });
    open();
    await choose();
    await screen.findByText('Default rate type: Blue');
    await userEvent.click(screen.getByRole('button', { name: en.groups.consolidate.record }));

    expect(await screen.findByText(en.errors.groupSettlementMemberInvalid)).toBeTruthy();
    expect(fieldValue(en.groups.consolidate.fields.memberB)).toBe(BRUNO);
  });

  it('flags the same member twice as a field error and requests no preview', async () => {
    const { calls } = stubApi({ [GET_GROUP]: { status: 200, body: group } });
    open();
    await screen.findByLabelText(en.groups.consolidate.fields.memberB);
    await userEvent.selectOptions(screen.getByLabelText(en.groups.consolidate.fields.memberB), ANA);

    expect(await screen.findByText(en.groups.consolidate.errors.sameMember)).toBeTruthy();
    expect(calls.map((call) => call.path)).toEqual([`/groups/${GROUP_ID}`]);
    expect(recordButton()).toBeNull();
  });

  it('shows a preview failure with a retry that keeps the choice', async () => {
    const { calls } = stubApi({
      [GET_GROUP]: { status: 200, body: group },
      [PREVIEW(ANA, BRUNO)]: [{ status: 500 }, { status: 200, body: preview() }],
    });
    open();
    await choose();

    await userEvent.click(await screen.findByRole('button', { name: en.app.retry }));

    expect(await screen.findByText('Default rate type: Blue')).toBeTruthy();
    expect(fieldValue(en.groups.consolidate.fields.memberB)).toBe(BRUNO);
    expect(calls.filter((call) => call.path.includes('consolidation'))).toHaveLength(2);
  });

  it("shows the not-found state when the group is not the user's", async () => {
    stubApi({ [GET_GROUP]: { status: 404, body: { code: 'NOT_FOUND' } } });
    open();

    expect(await screen.findByText(en.groups.detail.notFound.title)).toBeTruthy();
  });

  it('ignores the late preview of an earlier choice', async () => {
    const pending = new Map<string, (response: Response) => void>();
    const json = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        const path = url.slice(API_ORIGIN.length);
        if (path === `/groups/${GROUP_ID}`) return Promise.resolve(json(200, group));
        return new Promise<Response>((resolve) => pending.set(path, resolve));
      }),
    );
    open();
    await choose(BRUNO);
    await userEvent.selectOptions(
      screen.getByLabelText(en.groups.consolidate.fields.memberB),
      CARLA,
    );
    const forBruno = `/groups/${GROUP_ID}/settlements/consolidation?memberA=${ANA}&memberB=${BRUNO}&currency=ARS`;
    const forCarla = `/groups/${GROUP_ID}/settlements/consolidation?memberA=${ANA}&memberB=${CARLA}&currency=ARS`;
    await waitFor(() => {
      expect(pending.has(forCarla)).toBe(true);
    });

    pending.get(forCarla)?.(json(200, preview({ legs: { ARS: '700000', USD: '-1000' } })));
    expect(await screen.findByText(`Ana pays Carla ${money(700000n, 'ARS')}`)).toBeTruthy();
    pending.get(forBruno)?.(json(200, preview()));

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByText(`Ana pays Bruno ${money(5000000n, 'ARS')}`)).toBeNull();
    expect(screen.getByText(`Ana pays Carla ${money(700000n, 'ARS')}`)).toBeTruthy();
  });

  it('sends one record request on a double click (AC-16)', async () => {
    let posts = 0;
    let release: (response: Response) => void = () => undefined;
    const json = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        const path = url.slice(API_ORIGIN.length);
        if (init?.method === 'POST') {
          posts += 1;
          return new Promise<Response>((resolve) => {
            release = resolve;
          });
        }
        if (path === `/groups/${GROUP_ID}`) return Promise.resolve(json(200, group));
        return Promise.resolve(json(200, preview()));
      }),
    );
    open();
    await choose();
    await screen.findByText('Default rate type: Blue');

    await userEvent.dblClick(screen.getByRole('button', { name: en.groups.consolidate.record }));
    release(json(201, settlement));

    await screen.findByText(`Ana paid Bruno ${money(2600000n, 'ARS')}.`);
    expect(posts).toBe(1);
  });

  it('renders the flow in Spanish and in English (AC-22)', async () => {
    stubApi({
      [GET_GROUP]: { status: 200, body: group },
      [PREVIEW(ANA, BRUNO)]: { status: 200, body: preview() },
    });
    open('es');
    await screen.findByLabelText(es.groups.consolidate.fields.memberB);
    await userEvent.selectOptions(
      screen.getByLabelText(es.groups.consolidate.fields.memberB),
      BRUNO,
    );

    expect(
      await screen.findByText('Ana le paga a Bruno ' + money(5000000n, 'ARS', 'es')),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: es.groups.consolidate.record })).toBeTruthy();
    expect(screen.getByRole('heading', { name: es.groups.consolidate.title })).toBeTruthy();
  });
});

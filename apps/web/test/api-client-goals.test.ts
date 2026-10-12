import { describe, expect, it, vi } from 'vitest';
import { createApiClient, type FetchLike } from '../src/lib/api-client';

const BASE_URL = 'http://api.argent.test';
const GOAL_ID = '3f0c1a52-6a43-4e0e-9a33-6f1f2b5d7a10';
const ENTRY_ID = '9b1d2c34-1e5f-4a67-8b90-0c1d2e3f4a5b';

const goal = {
  id: GOAL_ID,
  name: 'Trip',
  targetAmount: '100000',
  currency: 'ARS',
  targetDate: '2027-01-31',
  accountId: null,
  progress: '25000',
  percentage: 25,
  status: 'active',
  monthlyAmountNeeded: '25000',
  createdAt: '2026-10-06T12:00:00.000Z',
};

const entry = {
  id: ENTRY_ID,
  kind: 'contribution',
  amount: '5000',
  createdAt: '2026-10-07T12:00:00.000Z',
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function clientWith(...responses: (Response | Error)[]) {
  const queue = [...responses];
  const fetch = vi.fn<FetchLike>(() => {
    const next = queue.shift();
    if (!next) throw new Error('unexpected fetch call');
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  });
  return { client: createApiClient({ baseUrl: BASE_URL, fetch }), fetch };
}

function requestAt(fetch: ReturnType<typeof clientWith>['fetch'], index: number) {
  const call = fetch.mock.calls[index];
  if (!call) throw new Error(`no fetch call #${index}`);
  const [url, init] = call;
  return { url, init: init ?? {} };
}

describe('goals api client', () => {
  it('listGoals returns the parsed goals (AC-01)', async () => {
    const { client, fetch } = clientWith(jsonResponse(200, { goals: [goal] }));

    expect(await client.listGoals()).toEqual({ ok: true, data: { goals: [goal] } });
    expect(requestAt(fetch, 0)).toMatchObject({
      url: `${BASE_URL}/goals`,
      init: { method: 'GET', credentials: 'include' },
    });
  });

  it('getGoal returns the goal and a 404 is the not found failure (AC-09)', async () => {
    const { client, fetch } = clientWith(
      jsonResponse(200, goal),
      jsonResponse(404, { code: 'NOT_FOUND' }),
    );

    expect(await client.getGoal(GOAL_ID)).toEqual({ ok: true, data: goal });
    expect(requestAt(fetch, 0).url).toBe(`${BASE_URL}/goals/${GOAL_ID}`);
    expect(await client.getGoal(GOAL_ID)).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  });

  it('listGoalEntries sends the limit and returns the entries (AC-10)', async () => {
    const { client, fetch } = clientWith(jsonResponse(200, { entries: [entry] }));

    expect(await client.listGoalEntries(GOAL_ID, { limit: 50 })).toEqual({
      ok: true,
      data: { entries: [entry] },
    });
    expect(requestAt(fetch, 0).url).toBe(`${BASE_URL}/goals/${GOAL_ID}/entries?limit=50`);
  });

  it('createGoal sends the amount as a minor-units string (AC-12)', async () => {
    const { client, fetch } = clientWith(jsonResponse(201, goal));

    const result = await client.createGoal({
      name: 'Trip',
      targetAmount: '100000',
      currency: 'ARS',
    });

    expect(result).toEqual({ ok: true, data: goal });
    const { url, init } = requestAt(fetch, 0);
    expect(url).toBe(`${BASE_URL}/goals`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      name: 'Trip',
      targetAmount: '100000',
      currency: 'ARS',
    });
    expect(init.headers).toMatchObject({ 'X-Requested-With': 'argent' });
  });

  it('updateGoal sends targetDate null to remove the date (AC-18)', async () => {
    const { client, fetch } = clientWith(jsonResponse(200, { ...goal, targetDate: null }));

    const result = await client.updateGoal(GOAL_ID, { targetDate: null });

    expect(result.ok).toBe(true);
    const { url, init } = requestAt(fetch, 0);
    expect(url).toBe(`${BASE_URL}/goals/${GOAL_ID}`);
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(String(init.body))).toEqual({ targetDate: null });
  });

  it('recordGoalEntry returns the entry and the updated goal (AC-20)', async () => {
    const { client, fetch } = clientWith(jsonResponse(201, { entry, goal }));

    const result = await client.recordGoalEntry(GOAL_ID, { kind: 'contribution', amount: '5000' });

    expect(result).toEqual({ ok: true, data: { entry, goal } });
    const { url, init } = requestAt(fetch, 0);
    expect(url).toBe(`${BASE_URL}/goals/${GOAL_ID}/entries`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ kind: 'contribution', amount: '5000' });
  });

  it('deleteGoal resolves with no body (AC-24)', async () => {
    const { client, fetch } = clientWith(new Response(null, { status: 204 }));

    expect(await client.deleteGoal(GOAL_ID)).toEqual({ ok: true, data: undefined });
    expect(requestAt(fetch, 0)).toMatchObject({
      url: `${BASE_URL}/goals/${GOAL_ID}`,
      init: { method: 'DELETE' },
    });
  });

  it('a refused withdrawal and a refused 100th goal surface their own keys (AC-26, AC-27)', async () => {
    const { client } = clientWith(
      jsonResponse(409, { code: 'GOAL_WITHDRAWAL_EXCEEDS_PROGRESS' }),
      jsonResponse(409, { code: 'GOAL_LIMIT_REACHED' }),
    );

    expect(
      await client.recordGoalEntry(GOAL_ID, { kind: 'withdrawal', amount: '1' }),
    ).toMatchObject({
      ok: false,
      messageKey: 'goalWithdrawalExceedsProgress',
    });
    expect(
      await client.createGoal({ name: 'Trip', targetAmount: '1', currency: 'USD' }),
    ).toMatchObject({ ok: false, messageKey: 'goalLimitReached' });
  });

  it('a network failure is the offline failure (AC-28)', async () => {
    const { client } = clientWith(new TypeError('Failed to fetch'));

    expect(await client.listGoals()).toMatchObject({
      ok: false,
      code: 'NETWORK',
      messageKey: 'network',
    });
  });

  it('a malformed response body is a failure, not data', async () => {
    const { client } = clientWith(
      jsonResponse(200, { goals: [{ ...goal, percentage: 'high' }] }),
      jsonResponse(200, { entries: 'none' }),
    );

    expect(await client.listGoals()).toMatchObject({ ok: false, code: 'INTERNAL' });
    expect(await client.listGoalEntries(GOAL_ID, { limit: 50 })).toMatchObject({
      ok: false,
      code: 'INTERNAL',
    });
  });

  it('an invalid body or limit is rejected before any request', async () => {
    const { client, fetch } = clientWith();

    expect(
      await client.createGoal({ name: '', targetAmount: '100', currency: 'ARS' }),
    ).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    expect(await client.updateGoal(GOAL_ID, {})).toMatchObject({
      ok: false,
      code: 'VALIDATION_FAILED',
    });
    expect(
      await client.recordGoalEntry(GOAL_ID, { kind: 'contribution', amount: '0' }),
    ).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    expect(await client.listGoalEntries(GOAL_ID, { limit: 101 })).toMatchObject({
      ok: false,
      code: 'VALIDATION_FAILED',
    });
    expect(await client.listGoalEntries(GOAL_ID, { limit: 0 })).toMatchObject({
      ok: false,
      code: 'VALIDATION_FAILED',
    });
    expect(await client.getGoal('..')).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    expect(fetch).not.toHaveBeenCalled();
  });
});

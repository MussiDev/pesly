import { describe, expect, it, vi } from 'vitest';
import { createApiClient, type FetchLike } from '../src/lib/api-client';

const BASE_URL = 'http://api.pesly.test';
const GROUP_ID = '22222222-2222-4222-8222-222222222222';
const EXPENSE_ID = '33333333-3333-4333-8333-333333333333';
const MEMBER_ID = '44444444-4444-4444-8444-444444444444';
const ACCOUNT_ID = '3f0c1a52-6a43-4e0e-9a33-6f1f2b5d7a10';
const CATEGORY_ID = '9b1d2c34-1e5f-4a67-8b90-0c1d2e3f4a5b';
const MOVEMENT_ID = '11111111-1111-4111-8111-111111111111';

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function clientWith(...responses: Response[]) {
  const queue = [...responses];
  const fetch = vi.fn<FetchLike>(() => {
    const next = queue.shift();
    if (!next) throw new Error('unexpected fetch call');
    return Promise.resolve(next);
  });
  return { client: createApiClient({ baseUrl: BASE_URL, fetch }), fetch };
}

const EXPENSE = {
  id: EXPENSE_ID,
  groupId: GROUP_ID,
  description: 'Supermarket',
  categoryId: CATEGORY_ID,
  currency: 'ARS',
  amount: '4000000',
  occurredAt: '2026-10-10T10:00:00.000Z',
  payerMemberId: MEMBER_ID,
  createdByMemberId: MEMBER_ID,
  splitMode: 'equal',
  payerMovementId: MOVEMENT_ID,
  createdAt: '2026-10-10T10:01:00.000Z',
  version: 1,
  shares: [{ memberId: MEMBER_ID, amount: '4000000' }],
};

describe('api client: link a group expense to the payer account (FEAT-008)', () => {
  it('posts a create body to the payer-movement path and returns the expense (AC-02)', async () => {
    const { client, fetch } = clientWith(jsonResponse(200, EXPENSE));

    const result = await client.linkPayerMovement(GROUP_ID, EXPENSE_ID, {
      mode: 'create',
      accountId: ACCOUNT_ID,
      categoryId: CATEGORY_ID,
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.payerMovementId).toBe(MOVEMENT_ID);
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe(`${BASE_URL}/groups/${GROUP_ID}/expenses/${EXPENSE_ID}/payer-movement`);
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({
      mode: 'create',
      accountId: ACCOUNT_ID,
      categoryId: CATEGORY_ID,
    });
  });

  it('posts an adopt body (AC-11)', async () => {
    const { client, fetch } = clientWith(jsonResponse(200, EXPENSE));

    const result = await client.linkPayerMovement(GROUP_ID, EXPENSE_ID, {
      mode: 'adopt',
      movementId: MOVEMENT_ID,
    });

    expect(result.ok).toBe(true);
    expect(JSON.parse(fetch.mock.calls[0]?.[1]?.body as string)).toEqual({
      mode: 'adopt',
      movementId: MOVEMENT_ID,
    });
  });

  it('refuses a body with an extra key or no mode as invalid and sends no request (AC-01)', async () => {
    const { client, fetch } = clientWith();

    const extra = await client.linkPayerMovement(GROUP_ID, EXPENSE_ID, {
      mode: 'adopt',
      movementId: MOVEMENT_ID,
      amount: '1',
    } as never);
    const noMode = await client.linkPayerMovement(GROUP_ID, EXPENSE_ID, {
      movementId: MOVEMENT_ID,
    } as never);

    expect(extra.ok).toBe(false);
    expect(noMode.ok).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    [403, 'GROUP_PAYER_ONLY', 'groupPayerOnly'],
    [409, 'GROUP_EXPENSE_ALREADY_LINKED', 'groupExpenseAlreadyLinked'],
    [400, 'GROUP_MOVEMENT_MISMATCH', 'groupMovementMismatch'],
    [409, 'GROUP_MOVEMENT_ALREADY_SENT', 'groupMovementAlreadySent'],
    [400, 'GROUP_PAYER_ACCOUNT_INVALID', 'groupPayerAccountInvalid'],
  ])('maps a %i %s answer to the message key %s', async (status, code, key) => {
    const { client } = clientWith(jsonResponse(status, { code }));

    const result = await client.linkPayerMovement(GROUP_ID, EXPENSE_ID, {
      mode: 'adopt',
      movementId: MOVEMENT_ID,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(code);
      expect(result.messageKey).toBe(key);
    }
  });

  it('refuses an id that would escape the path as invalid and sends no request', async () => {
    const { client, fetch } = clientWith();

    const result = await client.linkPayerMovement('..', EXPENSE_ID, {
      mode: 'adopt',
      movementId: MOVEMENT_ID,
    });

    expect(result.ok).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reads the candidates from the movement-candidates path (AC-18)', async () => {
    const { client, fetch } = clientWith(
      jsonResponse(200, {
        items: [
          {
            id: MOVEMENT_ID,
            amount: '4000000',
            occurredAt: '2026-10-10T10:00:00.000Z',
            note: 'Chango',
            accountId: ACCOUNT_ID,
            accountName: 'Bank',
          },
        ],
      }),
    );

    const result = await client.getMovementCandidates(GROUP_ID, EXPENSE_ID);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.items).toHaveLength(1);
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe(`${BASE_URL}/groups/${GROUP_ID}/expenses/${EXPENSE_ID}/movement-candidates`);
    expect(init?.method ?? 'GET').toBe('GET');
  });

  it('answers a failure, not a throw, when the candidates answer has an invalid shape (error)', async () => {
    const { client } = clientWith(jsonResponse(200, { items: [{ id: 1 }] }));

    const result = await client.getMovementCandidates(GROUP_ID, EXPENSE_ID);

    expect(result.ok).toBe(false);
  });
});

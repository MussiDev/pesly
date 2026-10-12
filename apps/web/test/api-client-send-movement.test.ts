import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { MovementResponse } from '@pesly/shared';
import { describe, expect, it, vi } from 'vitest';
import { overlayQueue } from '../src/features/movements/sync-overlay';
import { createApiClient, messageKeyOf, type FetchLike } from '../src/lib/api-client';
import type { QueuedMovement } from '../src/lib/local-store/queue';

const BASE_URL = 'http://api.pesly.test';
const MOVEMENT_ID = '11111111-1111-4111-8111-111111111111';
const GROUP_ID = '22222222-2222-4222-8222-222222222222';
const EXPENSE_ID = '33333333-3333-4333-8333-333333333333';
const MEMBER_ID = '44444444-4444-4444-8444-444444444444';
const ACCOUNT_ID = '3f0c1a52-6a43-4e0e-9a33-6f1f2b5d7a10';
const CATEGORY_ID = '9b1d2c34-1e5f-4a67-8b90-0c1d2e3f4a5b';

const MOVEMENT = {
  id: MOVEMENT_ID,
  type: 'expense',
  accountId: ACCOUNT_ID,
  categoryId: CATEGORY_ID,
  destinationAccountId: null,
  amount: '150050',
  destinationAmount: null,
  occurredAt: '2026-10-02T15:30:00.000Z',
  note: null,
  rate: null,
  rateSource: null,
  rateType: null,
  createdAt: '2026-10-02T15:31:00.000Z',
  tags: [],
};

const LINK = { groupId: GROUP_ID, expenseId: EXPENSE_ID, adopted: false };

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

const BODY = {
  movementId: MOVEMENT_ID,
  split: { mode: 'equal', memberIds: [MEMBER_ID] },
} as never;

/** Reads the shared response schema's required shape from the real one, so the fixture cannot drift. */
async function expenseFixture() {
  const shared = await import('@pesly/shared');
  const sample = {
    id: EXPENSE_ID,
    groupId: GROUP_ID,
    description: 'Dinner',
    categoryId: CATEGORY_ID,
    currency: 'ARS',
    amount: '150050',
    occurredAt: MOVEMENT.occurredAt,
    payerMemberId: MEMBER_ID,
    createdByMemberId: MEMBER_ID,
    splitMode: 'equal',
    payerMovementId: MOVEMENT_ID,
    createdAt: MOVEMENT.createdAt,
    version: 1,
    shares: [{ memberId: MEMBER_ID, amount: '150050' }],
    autoCategory: null,
  };
  return { shared, sample };
}

describe('api client: send movement to group (DISC-001-05i Block 7)', () => {
  it('posts to /groups/:id/expenses/from-movement and returns the expense and autoCategory (AC-12, AC-45)', async () => {
    const { shared, sample } = await expenseFixture();
    const parsed = shared.sendMovementToGroupResponseSchema.safeParse({
      ...sample,
      autoCategory: 'created',
    });
    // The fixture must be a valid answer, or the test would prove nothing about the client.
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    const { client, fetch } = clientWith(jsonResponse(201, { ...sample, autoCategory: 'created' }));

    const result = await client.sendMovementToGroup(GROUP_ID, BODY);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.autoCategory).toBe('created');
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe(`${BASE_URL}/groups/${GROUP_ID}/expenses/from-movement`);
    expect(init?.method).toBe('POST');
    const sent = JSON.parse(init?.body as string) as Record<string, unknown>;
    expect(sent).not.toHaveProperty('categoryId');
    expect(sent.movementId).toBe(MOVEMENT_ID);
  });

  it('refuses a body with an extra key or a malformed movement id and sends no request', async () => {
    const { client, fetch } = clientWith();
    const extra = await client.sendMovementToGroup(GROUP_ID, {
      ...(BODY as object),
      amount: '1',
    } as never);
    const malformed = await client.sendMovementToGroup(GROUP_ID, {
      ...(BODY as object),
      movementId: 'nope',
    } as never);
    expect(extra).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    expect(malformed).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('answers the message keys of the 409 codes (AC-21, AC-25)', async () => {
    const { client } = clientWith(
      jsonResponse(409, { code: 'GROUP_MOVEMENT_ALREADY_SENT', message: 'x' }),
      jsonResponse(409, { code: 'MOVEMENT_LOCKED_BY_GROUP_EXPENSE', message: 'x' }),
    );
    expect(await client.sendMovementToGroup(GROUP_ID, BODY)).toMatchObject({
      ok: false,
      code: 'GROUP_MOVEMENT_ALREADY_SENT',
      messageKey: 'groupMovementAlreadySent',
    });
    expect(await client.updateMovement(MOVEMENT_ID, {} as never)).toMatchObject({
      ok: false,
      code: 'MOVEMENT_LOCKED_BY_GROUP_EXPENSE',
      messageKey: 'movementLockedByGroupExpense',
    });
    expect(messageKeyOf('GROUP_MOVEMENT_NOT_EXPENSE')).toBe('groupMovementNotExpense');
    expect(messageKeyOf('GROUP_MOVEMENT_CHANGED')).toBe('groupMovementChanged');
  });

  it('shows a queued edit refused by the lock as a failed change with that message (AC-27)', () => {
    const record: QueuedMovement = {
      operation: 'update',
      id: MOVEMENT_ID,
      revision: 1,
      createdAt: MOVEMENT.createdAt,
      base: MOVEMENT as MovementResponse,
      request: {
        type: 'expense',
        accountId: ACCOUNT_ID,
        categoryId: CATEGORY_ID,
        amount: '1',
        occurredAt: MOVEMENT.occurredAt,
        tags: [],
        rate: { source: 'keep' },
      },
      rejection: { code: 'MOVEMENT_LOCKED_BY_GROUP_EXPENSE' },
    };
    const [row] = overlayQueue([MOVEMENT as MovementResponse], [record], { includeUnlisted: true });
    expect(row?.syncState).toBe('failed');
    expect(row?.failure?.code).toBe('MOVEMENT_LOCKED_BY_GROUP_EXPENSE');
    expect(messageKeyOf(row?.failure?.code ?? '')).toBe('movementLockedByGroupExpense');
  });

  it('a 404 is NOT_FOUND and a numeric amount is a failure with no data (AC-32)', async () => {
    const { sample } = await expenseFixture();
    const { client } = clientWith(
      jsonResponse(404, { code: 'NOT_FOUND', message: 'x' }),
      jsonResponse(201, { ...sample, amount: 150050 }),
    );
    expect(await client.sendMovementToGroup(GROUP_ID, BODY)).toMatchObject({
      ok: false,
      code: 'NOT_FOUND',
    });
    const bad = await client.sendMovementToGroup(GROUP_ID, BODY);
    expect(bad.ok).toBe(false);
    expect(bad).not.toHaveProperty('data');
  });

  it('getMovement returns the group link of the detail answer', async () => {
    const { client } = clientWith(
      jsonResponse(200, { ...MOVEMENT, groupExpense: LINK }),
      jsonResponse(200, { ...MOVEMENT, groupExpense: null }),
    );
    const linked = await client.getMovement(MOVEMENT_ID);
    expect(linked.ok && linked.data.groupExpense).toEqual(LINK);
    const free = await client.getMovement(MOVEMENT_ID);
    expect(free.ok && free.data.groupExpense).toBeNull();
  });

  it('listMovements returns groupLinks and fails on a malformed link (AC-05)', async () => {
    const page = { items: [MOVEMENT], total: 1, limit: 50, offset: 0 };
    const { client } = clientWith(
      jsonResponse(200, { ...page, groupLinks: { [MOVEMENT_ID]: LINK } }),
      jsonResponse(200, { ...page, groupLinks: { [MOVEMENT_ID]: { ...LINK, expenseId: 'bad' } } }),
    );
    const ok = await client.listMovements({});
    expect(ok.ok && ok.data.groupLinks).toEqual({ [MOVEMENT_ID]: LINK });
    const bad = await client.listMovements({});
    expect(bad.ok).toBe(false);
    expect(bad).not.toHaveProperty('data');
  });

  it('both catalogs carry the four error keys, none empty (AC-34, NFR-04)', () => {
    const keys = [
      'groupMovementNotExpense',
      'groupMovementAlreadySent',
      'groupMovementChanged',
      'movementLockedByGroupExpense',
    ];
    for (const locale of ['es', 'en']) {
      const path = fileURLToPath(new URL(`../messages/${locale}.json`, import.meta.url));
      const errors = (JSON.parse(readFileSync(path, 'utf8')) as { errors: Record<string, string> })
        .errors;
      for (const key of keys) {
        expect(errors[key]?.trim(), `${locale}.errors.${key}`).toBeTruthy();
      }
    }
  });
});

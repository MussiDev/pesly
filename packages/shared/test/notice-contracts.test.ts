import { describe, expect, it } from 'vitest';
import {
  createRecurringPaymentSchema,
  recurringPaymentResponseSchema,
  updateRecurringPaymentSchema,
} from '../src/recurring';
import {
  decodeNoticeCursor,
  encodeNoticeCursor,
  listNoticesQuerySchema,
  listNoticesResponseSchema,
  markAllReadResponseSchema,
  noticeIdParamsSchema,
  noticeKindSchema,
  noticeSchema,
} from '../src/notices';
import * as shared from '../src/index';

const ID = '0b6f5d2e-6c1c-4f3e-9a55-3d9d3c1c2a10';
const ID2 = '1c7a6e3f-7d2d-4a4f-8b66-4e0e4d2d3b21';

const rent = {
  name: 'Rent',
  amount: '35000000',
  accountId: ID,
  categoryId: ID2,
  frequency: 'monthly',
  dayOfMonth: 5,
  startDate: '2026-11-05',
  mode: 'confirmation',
};

describe('reminderDays on recurring payments', () => {
  it('create without reminderDays parses to 3 (AC-01)', () => {
    expect(createRecurringPaymentSchema.parse(rent).reminderDays).toBe(3);
  });

  it('create accepts 0 and 30', () => {
    expect(createRecurringPaymentSchema.parse({ ...rent, reminderDays: 0 }).reminderDays).toBe(0);
    expect(createRecurringPaymentSchema.parse({ ...rent, reminderDays: 30 }).reminderDays).toBe(30);
  });

  it.each([-1, 31, 1.5])('rejects reminderDays %s on the path (AC-02)', (value) => {
    const created = createRecurringPaymentSchema.safeParse({ ...rent, reminderDays: value });
    expect(created.success).toBe(false);
    if (!created.success) {
      expect(created.error.issues[0]?.path).toEqual(['reminderDays']);
    }
    const updated = updateRecurringPaymentSchema.safeParse({ reminderDays: value });
    expect(updated.success).toBe(false);
    if (!updated.success) {
      expect(updated.error.issues[0]?.path).toEqual(['reminderDays']);
    }
  });

  it('update accepts reminderDays 0 alone and does not inject a default (AC-03)', () => {
    expect(updateRecurringPaymentSchema.parse({ reminderDays: 0 })).toEqual({ reminderDays: 0 });
    expect(updateRecurringPaymentSchema.safeParse({}).success).toBe(false);
  });

  it('response requires an integer reminderDays', () => {
    const response = {
      id: ID,
      name: 'Rent',
      amount: '35000000',
      accountId: ID,
      categoryId: ID2,
      frequency: 'monthly',
      weekday: null,
      dayOfMonth: 5,
      month: null,
      startDate: '2026-11-05',
      endDate: null,
      mode: 'confirmation',
      status: 'active',
      nextDueDate: '2026-11-05',
    };
    expect(recurringPaymentResponseSchema.safeParse(response).success).toBe(false);
    expect(recurringPaymentResponseSchema.safeParse({ ...response, reminderDays: 3 }).success).toBe(
      true,
    );
    expect(
      recurringPaymentResponseSchema.safeParse({ ...response, reminderDays: 1.5 }).success,
    ).toBe(false);
  });
});

describe('listNoticesQuerySchema', () => {
  const cursor = encodeNoticeCursor({ createdAt: '2026-11-02T12:00:00.000Z', id: ID });

  it('defaults limit to 20', () => {
    expect(listNoticesQuerySchema.parse({})).toEqual({ limit: 20 });
  });

  it('accepts limit 50 and a cursor produced by the encoder (AC-18)', () => {
    const parsed = listNoticesQuerySchema.parse({ limit: '50', cursor });
    expect(parsed).toEqual({ limit: 50, cursor });
  });

  it.each(['51', '0', '1.5', 'abc'])('rejects limit %s (AC-19)', (limit) => {
    expect(listNoticesQuerySchema.safeParse({ limit }).success).toBe(false);
  });

  it('rejects a cursor that does not decode (AC-19)', () => {
    const result = listNoticesQuerySchema.safeParse({ cursor: 'not-a-cursor!' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['cursor']);
    }
    expect(listNoticesQuerySchema.safeParse({ cursor: 'aGVsbG8' }).success).toBe(false);
  });

  it('rejects a cursor longer than 200 characters', () => {
    expect(listNoticesQuerySchema.safeParse({ cursor: 'a'.repeat(201) }).success).toBe(false);
  });
});

describe('notice cursor helpers', () => {
  it('round-trips createdAt and id', () => {
    const value = { createdAt: '2026-11-02T12:00:00.000Z', id: ID };
    expect(decodeNoticeCursor(encodeNoticeCursor(value))).toEqual(value);
  });

  it('returns null for malformed content', () => {
    const encode = (v: { createdAt: string; id: string }): string => encodeNoticeCursor(v);
    expect(decodeNoticeCursor('')).toBeNull();
    expect(decodeNoticeCursor('%%%')).toBeNull();
    expect(decodeNoticeCursor(encode({ createdAt: 'nope', id: ID }))).toBeNull();
    expect(
      decodeNoticeCursor(encode({ createdAt: '2026-11-02T12:00:00.000Z', id: 'x' })),
    ).toBeNull();
    expect(decodeNoticeCursor('WzEsMl0')).toBeNull();
  });
});

describe('notice response schemas', () => {
  const notice = {
    id: ID,
    kind: 'reminder',
    text: 'Rent is due on 5',
    dueDate: '2026-11-05',
    createdAt: '2026-11-02T12:00:00.000Z',
    readAt: null,
  };

  it('parses a notice and the list response', () => {
    expect(noticeSchema.safeParse(notice).success).toBe(true);
    expect(noticeSchema.safeParse({ ...notice, readAt: '2026-11-03T10:00:00.000Z' }).success).toBe(
      true,
    );
    expect(noticeSchema.safeParse({ ...notice, kind: 'other' }).success).toBe(false);
    expect(
      listNoticesResponseSchema.safeParse({ items: [notice], nextCursor: null, unreadCount: 1 })
        .success,
    ).toBe(true);
  });

  it('knows the three kinds', () => {
    expect(noticeKindSchema.options).toEqual(['reminder', 'recorded', 'not_recorded']);
  });

  it('validates params and the mark-all-read response', () => {
    expect(noticeIdParamsSchema.safeParse({ id: ID }).success).toBe(true);
    expect(noticeIdParamsSchema.safeParse({ id: 'x' }).success).toBe(false);
    expect(markAllReadResponseSchema.safeParse({ updated: 4 }).success).toBe(true);
  });

  it('is exported from the package barrel', () => {
    expect(shared.listNoticesQuerySchema).toBe(listNoticesQuerySchema);
  });
});

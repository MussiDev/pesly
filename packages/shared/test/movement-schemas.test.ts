import { describe, expect, it } from 'vitest';
import {
  ERROR_CODES,
  MOVEMENT_AMOUNT_MAX_MINOR_UNITS,
  MOVEMENT_NOTE_MAX_LENGTH,
  RetryableError,
  CATEGORIZED_MOVEMENT_TYPES,
  MOVEMENT_TYPES,
  createMovementRequestSchema,
  listMovementsQuerySchema,
  movementResponseSchema,
  updateMovementRequestSchema,
} from '../src';

const ACCOUNT_ID = '0b9d1f6e-5a3c-4c8e-9a43-2f1d7a6b8c90';
const CATEGORY_ID = '5d7c2b1a-9e84-4f3a-8b61-0c2d4e6f8a10';

const base = {
  type: 'expense',
  accountId: ACCOUNT_ID,
  categoryId: CATEGORY_ID,
  amount: '150050',
  occurredAt: '2026-10-02T15:30:00Z',
  rate: { source: 'automatic' },
};

function fieldsOf(input: unknown): string[] {
  const result = createMovementRequestSchema.safeParse(input);
  if (result.success) return [];
  return result.error.issues.map((issue) => issue.path.join('.'));
}

describe('create movement request', () => {
  it('accepts an expense and an income with automatic and manual rates (AC-01, AC-04, AC-08)', () => {
    expect(createMovementRequestSchema.safeParse(base).success).toBe(true);
    const income = createMovementRequestSchema.parse({
      ...base,
      type: 'income',
      rate: { source: 'manual', value: '16233000' },
    });
    expect(income.type).toBe('income');
    expect('rate' in income && income.rate).toEqual({ source: 'manual', value: '16233000' });
  });

  it('accepts the amount bounds 1 and 10^15 and rejects 0, negatives, decimals and above (AC-02)', () => {
    expect(createMovementRequestSchema.safeParse({ ...base, amount: '1' }).success).toBe(true);
    expect(
      createMovementRequestSchema.safeParse({
        ...base,
        amount: MOVEMENT_AMOUNT_MAX_MINOR_UNITS.toString(),
      }).success,
    ).toBe(true);
    for (const amount of ['0', '-5', '12.5', '1000000000000001', '', 'abc', '007']) {
      expect(fieldsOf({ ...base, amount }), amount).toContain('amount');
    }
  });

  it('rejects a manual rate of 0 or below, non-numeric and above the maximum (AC-09)', () => {
    for (const value of ['0', '-1', 'abc', '1.5', '100000000001', '']) {
      expect(fieldsOf({ ...base, rate: { source: 'manual', value } }), value).toContain(
        'rate.value',
      );
    }
    expect(fieldsOf({ ...base, rate: { source: 'manual' } })).toContain('rate.value');
    expect(fieldsOf({ ...base, rate: { source: 'other' } }).length).toBeGreaterThan(0);
    expect(fieldsOf({ ...base, rate: undefined })).toContain('rate');
  });

  it('rejects malformed, non-UTC and impossible timestamps, and years outside 1970-2100', () => {
    for (const occurredAt of [
      'yesterday',
      '2026-10-02',
      '2026-10-02T15:30:00',
      '2026-10-02T15:30:00-03:00',
      '2026-02-30T00:00:00Z',
      '1969-12-31T23:59:59Z',
      '2101-01-01T00:00:00Z',
    ]) {
      expect(fieldsOf({ ...base, occurredAt }), occurredAt).toContain('occurredAt');
    }
    expect(
      createMovementRequestSchema.safeParse({ ...base, occurredAt: '1970-01-01T00:00:00Z' })
        .success,
    ).toBe(true);
    expect(
      createMovementRequestSchema.safeParse({ ...base, occurredAt: '2026-10-02T15:30:00.123Z' })
        .success,
    ).toBe(true);
  });

  it('trims the note, turns an empty one into absent and rejects 501 characters or controls', () => {
    expect(createMovementRequestSchema.parse({ ...base, note: '  lunch  ' }).note).toBe('lunch');
    expect(createMovementRequestSchema.parse({ ...base, note: '   ' }).note).toBeUndefined();
    expect(
      createMovementRequestSchema.safeParse({
        ...base,
        note: 'a'.repeat(MOVEMENT_NOTE_MAX_LENGTH),
      }).success,
    ).toBe(true);
    expect(fieldsOf({ ...base, note: 'a'.repeat(MOVEMENT_NOTE_MAX_LENGTH + 1) })).toContain('note');
    expect(fieldsOf({ ...base, note: 'a\u0000b' })).toContain('note');
    expect(fieldsOf({ ...base, note: 'a‮b' })).toContain('note');
  });

  it('stores the NFC and NFD forms of the same note identically', () => {
    const nfc = 'café';
    const nfd = 'café';
    expect(nfc).not.toBe(nfd);
    const a = createMovementRequestSchema.parse({ ...base, note: nfc }).note;
    const b = createMovementRequestSchema.parse({ ...base, note: nfd }).note;
    expect(b).toBe(a);
    expect(a).toBe(nfc);
  });

  it('rejects bad ids and types and strips unknown keys', () => {
    expect(fieldsOf({ ...base, accountId: 'nope' })).toContain('accountId');
    expect(fieldsOf({ ...base, categoryId: 'nope' })).toContain('categoryId');
    expect(fieldsOf({ ...base, type: 'refund' })).toContain('type');
    const parsed = createMovementRequestSchema.parse({ ...base, ownerId: 'x' });
    expect(parsed).not.toHaveProperty('ownerId');
  });

  it('never echoes the rejected value in the issues', () => {
    const result = createMovementRequestSchema.safeParse({ ...base, note: 'secret\u0000' });
    expect(JSON.stringify(result.error?.issues)).not.toContain('secret');
  });
});

const DEST_ID = '7c1e9a20-3b4d-4e5f-8a6b-9c0d1e2f3a4b';

const transfer = {
  type: 'transfer',
  accountId: ACCOUNT_ID,
  destinationAccountId: DEST_ID,
  amount: '150050',
  occurredAt: '2026-10-02T15:30:00Z',
};

const exchange = {
  type: 'exchange',
  accountId: ACCOUNT_ID,
  destinationAccountId: DEST_ID,
  amount: '155730000',
  destinationAmount: '100000',
  occurredAt: '2026-10-02T15:30:00Z',
};

describe('transfer and exchange create requests', () => {
  it('lists the four types and the two categorized ones', () => {
    expect(MOVEMENT_TYPES).toEqual(['expense', 'income', 'transfer', 'exchange']);
    expect(CATEGORIZED_MOVEMENT_TYPES).toEqual(['expense', 'income']);
  });

  it('parses a valid transfer and a valid exchange and strips keys of other types (AC-01, AC-03)', () => {
    const t = createMovementRequestSchema.parse({
      ...transfer,
      categoryId: CATEGORY_ID,
      rate: { source: 'automatic' },
      destinationAmount: '5',
    });
    expect(t).toEqual(transfer);
    const e = createMovementRequestSchema.parse({
      ...exchange,
      categoryId: CATEGORY_ID,
      rate: { source: 'manual', value: '16233000' },
    });
    expect(e).toEqual(exchange);
  });

  it('rejects 0, negative, malformed and above-10^15 amounts on both amount fields (AC-11)', () => {
    for (const amount of ['0', '-5', '12.5', '1000000000000001', '', 'abc']) {
      expect(fieldsOf({ ...transfer, amount }), amount).toContain('amount');
      expect(fieldsOf({ ...exchange, amount }), amount).toContain('amount');
      expect(fieldsOf({ ...exchange, destinationAmount: amount }), amount).toContain(
        'destinationAmount',
      );
    }
  });

  it('rejects a note of 501 characters and a control character (AC-12)', () => {
    for (const body of [transfer, exchange]) {
      expect(fieldsOf({ ...body, note: 'a'.repeat(MOVEMENT_NOTE_MAX_LENGTH + 1) })).toContain(
        'note',
      );
      expect(fieldsOf({ ...body, note: 'a\u0000b' })).toContain('note');
    }
  });

  it('names the missing destination fields (FR-02)', () => {
    const without = (body: Record<string, string>, key: string) =>
      Object.fromEntries(Object.entries(body).filter(([name]) => name !== key));
    const noDestTransfer = without(transfer, 'destinationAccountId');
    const noDestExchange = without(exchange, 'destinationAccountId');
    const noAmountExchange = without(exchange, 'destinationAmount');
    expect(fieldsOf(noDestTransfer)).toContain('destinationAccountId');
    expect(fieldsOf(noDestExchange)).toContain('destinationAccountId');
    expect(fieldsOf(noAmountExchange)).toContain('destinationAmount');
    expect(fieldsOf({ ...transfer, destinationAccountId: 'nope' })).toContain(
      'destinationAccountId',
    );
  });
});

describe('device id on create requests', () => {
  const DEVICE_ID = '3f2b8c14-6d7e-4a90-b1c2-5e8f0a9d7c61';
  const withoutId = (body: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(body).filter(([key]) => key !== 'id'));

  it('keeps a valid UUID on each of the four types (AC-03)', () => {
    for (const body of [base, { ...base, type: 'income' }, transfer, exchange]) {
      const parsed = createMovementRequestSchema.parse({ ...body, id: DEVICE_ID });
      expect(parsed, body.type).toHaveProperty('id', DEVICE_ID);
    }
  });

  it('still parses a request without an id, and stays without one (FR-05)', () => {
    for (const body of [base, { ...base, type: 'income' }, transfer, exchange]) {
      const parsed = createMovementRequestSchema.parse(body);
      expect(parsed, body.type).not.toHaveProperty('id');
    }
  });

  it('rejects an id that is not a UUID: text, empty or a number (AC-03)', () => {
    for (const id of ['nope', '', 42]) {
      for (const body of [base, transfer, exchange]) {
        expect(fieldsOf({ ...body, id }), `${body.type} ${String(id)}`).toContain('id');
      }
    }
  });

  it('does not carry an id into an edit: the update request strips it (FR-05)', () => {
    for (const body of [base, transfer, exchange]) {
      const parsed = updateMovementRequestSchema.parse({ ...body, id: DEVICE_ID });
      expect(parsed, body.type).toEqual(withoutId(body));
    }
  });
});

describe('list movements query', () => {
  it('defaults to limit 50 and offset 0 and accepts 100 (AC-14)', () => {
    expect(listMovementsQuerySchema.parse({})).toEqual({ limit: 50, offset: 0 });
    expect(listMovementsQuerySchema.parse({ limit: '100', offset: '10' })).toEqual({
      limit: 100,
      offset: 10,
    });
  });

  it('rejects 101, 0, a blank limit and a negative offset (AC-14)', () => {
    for (const query of [{ limit: '101' }, { limit: '0' }, { limit: '' }, { offset: '-1' }]) {
      expect(listMovementsQuerySchema.safeParse(query).success, JSON.stringify(query)).toBe(false);
    }
    expect(listMovementsQuerySchema.safeParse({ offset: ' ' }).success).toBe(false);
  });
});

describe('movement response', () => {
  const response = {
    id: ACCOUNT_ID,
    type: 'expense',
    accountId: ACCOUNT_ID,
    categoryId: CATEGORY_ID,
    destinationAccountId: null,
    amount: '150050',
    destinationAmount: null,
    occurredAt: '2026-10-02T15:30:00.000Z',
    note: null,
    rate: '16233000',
    rateSource: 'automatic',
    rateType: 'blue',
    createdAt: '2026-10-02T15:31:00.000Z',
    tags: ['viaje'],
  };

  it('accepts an automatic and a manual movement', () => {
    expect(movementResponseSchema.safeParse(response).success).toBe(true);
    expect(
      movementResponseSchema.safeParse({ ...response, rateSource: 'manual', rateType: null })
        .success,
    ).toBe(true);
    expect(movementResponseSchema.safeParse({ ...response, rateSource: 'x' }).success).toBe(false);
  });

  it('accepts an expense with null destination fields, a transfer and an exchange (FR-06)', () => {
    expect(movementResponseSchema.safeParse(response).success).toBe(true);
    const transferResponse = {
      ...response,
      type: 'transfer',
      categoryId: null,
      rate: null,
      rateSource: null,
      rateType: null,
      destinationAccountId: DEST_ID,
      destinationAmount: '150050',
    };
    expect(movementResponseSchema.safeParse(transferResponse).success).toBe(true);
    const exchangeResponse = {
      ...transferResponse,
      type: 'exchange',
      amount: '155730000',
      destinationAmount: '100000',
      rate: '15573000',
      rateSource: 'implied',
    };
    expect(movementResponseSchema.safeParse(exchangeResponse).success).toBe(true);
    expect(movementResponseSchema.safeParse({ ...exchangeResponse, rateSource: 'x' }).success).toBe(
      false,
    );
  });

  it('requires the tags array (AC-03)', () => {
    expect(movementResponseSchema.safeParse({ ...response, tags: [] }).success).toBe(true);
    const withoutTags: Partial<typeof response> = { ...response };
    delete withoutTags.tags;
    expect(movementResponseSchema.safeParse(withoutTags).success).toBe(false);
    expect(movementResponseSchema.safeParse({ ...response, tags: null }).success).toBe(false);
    expect(movementResponseSchema.safeParse({ ...response, tags: [1] }).success).toBe(false);
  });
});

describe('new error codes and RetryableError', () => {
  it('lists the four new error codes (AC-15, AC-21, AC-26)', () => {
    for (const code of [
      'MOVEMENT_DATE_IN_FUTURE',
      'RATE_REQUIRED',
      'MOVEMENT_CATEGORY_KIND_MISMATCH',
      'CATEGORY_ARCHIVED',
    ]) {
      expect(ERROR_CODES as readonly string[]).toContain(code);
    }
  });

  it('lists the four transfer and exchange codes (AC-02, AC-04, AC-15)', () => {
    for (const code of [
      'MOVEMENT_SAME_ACCOUNT',
      'MOVEMENT_CURRENCY_MISMATCH',
      'EXCHANGE_SAME_CURRENCY',
      'IMPLIED_RATE_OUT_OF_RANGE',
    ]) {
      expect(ERROR_CODES as readonly string[]).toContain(code);
    }
  });

  it('carries a validated positive integer retryAfterSeconds', () => {
    const error = new RetryableError('RATE_LIMITED', 17);
    expect(error.retryAfterSeconds).toBe(17);
    expect(error.code).toBe('RATE_LIMITED');
    expect(error.name).toBe('RetryableError');
    for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => new RetryableError('RATE_LIMITED', bad), String(bad)).toThrow(RangeError);
    }
  });
});

function updateFieldsOf(input: unknown): string[] {
  const result = updateMovementRequestSchema.safeParse(input);
  if (result.success) return [];
  return result.error.issues.map((issue) => issue.path.join('.'));
}

describe('update movement request', () => {
  it('accepts a valid body of each of the four types (FR-01)', () => {
    for (const body of [base, { ...base, type: 'income' }, transfer, exchange]) {
      expect(updateMovementRequestSchema.safeParse(body).success, body.type).toBe(true);
    }
  });

  it('accepts keep, automatic and manual rates on an expense and an income (FR-01)', () => {
    for (const type of ['expense', 'income']) {
      for (const rate of [
        { source: 'keep' },
        { source: 'automatic' },
        { source: 'manual', value: '16233000' },
      ]) {
        expect(updateMovementRequestSchema.safeParse({ ...base, type, rate }).success).toBe(true);
      }
    }
  });

  it('does not accept keep when creating: only an edit has a stored rate to keep (FR-01)', () => {
    expect(fieldsOf({ ...base, rate: { source: 'keep' } })).toContain('rate.source');
  });

  it('strips a rate from a transfer and keys of other types, like the create request (FR-01)', () => {
    const parsed = updateMovementRequestSchema.parse({
      ...transfer,
      categoryId: CATEGORY_ID,
      rate: { source: 'keep' },
      destinationAmount: '5',
    });
    expect(parsed).toEqual(transfer);
  });

  it('strips ownerId, id and createdAt instead of carrying them (FR-03)', () => {
    const parsed = updateMovementRequestSchema.parse({
      ...base,
      ownerId: ACCOUNT_ID,
      id: ACCOUNT_ID,
      createdAt: '2020-01-01T00:00:00Z',
    });
    expect(parsed).toEqual(base);
  });

  it('rejects an amount of 0 or below, malformed, or above 10^15 on every amount field (AC-05)', () => {
    for (const amount of ['0', '-5', '12.5', '1000000000000001', '', 'abc', '007']) {
      expect(updateFieldsOf({ ...base, amount }), amount).toContain('amount');
      expect(updateFieldsOf({ ...transfer, amount }), amount).toContain('amount');
      expect(updateFieldsOf({ ...exchange, amount }), amount).toContain('amount');
      expect(updateFieldsOf({ ...exchange, destinationAmount: amount }), amount).toContain(
        'destinationAmount',
      );
    }
  });

  it('rejects a missing category, an unknown type and a malformed id or date (FR-01)', () => {
    const noCategory = Object.fromEntries(
      Object.entries(base).filter(([key]) => key !== 'categoryId'),
    );
    expect(updateFieldsOf(noCategory)).toContain('categoryId');
    expect(updateFieldsOf({ ...base, type: 'refund' })).toContain('type');
    expect(updateFieldsOf({ ...base, accountId: 'nope' })).toContain('accountId');
    expect(updateFieldsOf({ ...base, occurredAt: 'yesterday' })).toContain('occurredAt');
  });

  it('rejects a manual rate of 0 or below and a note with a control character (FR-01)', () => {
    for (const value of ['0', '-1', 'abc', '']) {
      expect(updateFieldsOf({ ...base, rate: { source: 'manual', value } }), value).toContain(
        'rate.value',
      );
    }
    expect(updateFieldsOf({ ...base, note: 'a\u0000b' })).toContain('note');
  });

  it('lists the immutable type error code (FR-01)', () => {
    expect(ERROR_CODES as readonly string[]).toContain('MOVEMENT_TYPE_IMMUTABLE');
  });
});

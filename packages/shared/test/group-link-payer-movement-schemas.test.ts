import { describe, expect, it } from 'vitest';
import {
  ERROR_CODES,
  linkPayerMovementRequestSchema,
  movementCandidatesResponseSchema,
} from '../src';

const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const CATEGORY = '22222222-2222-4222-8222-222222222222';
const MOVEMENT = '33333333-3333-4333-8333-333333333333';

const okRequest = (input: unknown) => linkPayerMovementRequestSchema.safeParse(input).success;

const candidate = (n: number) => ({
  id: `44444444-4444-4444-8444-44444444${String(n).padStart(4, '0')}`,
  amount: '4000000',
  occurredAt: '2026-10-05T15:30:00.000Z',
  note: n % 2 === 0 ? null : 'Supermarket',
  accountId: ACCOUNT,
  accountName: 'Banco',
});

describe('linkPayerMovementRequestSchema', () => {
  it('accepts a well formed create body and a well formed adopt body (AC-01)', () => {
    expect(okRequest({ mode: 'create', accountId: ACCOUNT, categoryId: CATEGORY })).toBe(true);
    expect(okRequest({ mode: 'adopt', movementId: MOVEMENT })).toBe(true);
  });

  it.each([
    ['an unknown mode', { mode: 'link', movementId: MOVEMENT }],
    ['no mode', { movementId: MOVEMENT }],
    ['a create body without a category', { mode: 'create', accountId: ACCOUNT }],
    ['a create body without an account', { mode: 'create', categoryId: CATEGORY }],
    ['an adopt body without a movement', { mode: 'adopt' }],
    ['a body that mixes both modes', { mode: 'adopt', movementId: MOVEMENT, accountId: ACCOUNT }],
    ['an extra key', { mode: 'adopt', movementId: MOVEMENT, amount: '1' }],
    ['an id that is not a uuid', { mode: 'adopt', movementId: 'not-a-uuid' }],
  ])('rejects %s as invalid (AC-01)', (_name, input) => {
    expect(okRequest(input)).toBe(false);
  });
});

describe('movementCandidatesResponseSchema', () => {
  it('accepts at most 20 candidates (AC-18)', () => {
    const items = Array.from({ length: 20 }, (_, n) => candidate(n));
    expect(movementCandidatesResponseSchema.safeParse({ items }).success).toBe(true);
  });

  it('rejects a 21st candidate and a number for the amount as invalid (AC-18)', () => {
    const items = Array.from({ length: 21 }, (_, n) => candidate(n));
    expect(movementCandidatesResponseSchema.safeParse({ items }).success).toBe(false);
    expect(
      movementCandidatesResponseSchema.safeParse({ items: [{ ...candidate(1), amount: 4000000 }] })
        .success,
    ).toBe(false);
  });
});

describe('error codes', () => {
  it('include the three codes of linking an expense to the payer account', () => {
    for (const code of [
      'GROUP_PAYER_ONLY',
      'GROUP_EXPENSE_ALREADY_LINKED',
      'GROUP_MOVEMENT_MISMATCH',
    ]) {
      expect(ERROR_CODES).toContain(code);
    }
  });
});

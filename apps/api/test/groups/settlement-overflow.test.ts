import { AppError, MOVEMENT_AMOUNT_MAX_MINOR_UNITS, RATE_MAX_SCALED } from '@pesly/shared';
import { describe, expect, it } from 'vitest';
import { consolidate } from '../../src/groups/domain/settlement';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const MAX = MOVEMENT_AMOUNT_MAX_MINOR_UNITS;
const PARITY = 10_000n;

function failure(run: () => unknown): AppError {
  try {
    run();
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error('expected consolidate to fail');
}

describe('consolidate overflow guard', () => {
  it('answers a VALIDATION_FAILED error when a leg near the maximum converts above it', () => {
    const error = failure(() => consolidate(A, B, { ARS: -1n, USD: MAX }, 'ARS', RATE_MAX_SCALED));
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.fields).toEqual(expect.arrayContaining(['body.rate']));
  });

  it('answers a VALIDATION_FAILED error when a manual rate near its maximum inflates the cash', () => {
    const error = failure(() =>
      consolidate(A, B, { ARS: 1_000n, USD: 500_000_000_000_000n }, 'ARS', RATE_MAX_SCALED),
    );
    expect(error.code).toBe('VALIDATION_FAILED');
  });

  it('answers a VALIDATION_FAILED error when the cash alone is above the maximum', () => {
    const error = failure(() => consolidate(A, B, { ARS: MAX, USD: MAX }, 'ARS', PARITY));
    expect(error.code).toBe('VALIDATION_FAILED');
  });

  it('accepts a cash exactly at the maximum, in either direction', () => {
    expect(consolidate(A, B, { ARS: MAX, USD: 0n }, 'ARS', PARITY).amount).toBe(MAX);
    const swapped = consolidate(A, B, { ARS: -MAX, USD: 0n }, 'ARS', PARITY);
    expect(swapped).toMatchObject({ fromMemberId: B, toMemberId: A, amount: MAX });
  });
});

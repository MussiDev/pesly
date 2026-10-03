import { describe, expect, it } from 'vitest';
import { RATE_MAX_SCALED, impliedRate } from '../src';

describe('impliedRate', () => {
  it('computes 1,557.3000 for 1,557,300.00 ARS over 1,000.00 USD (AC-05)', () => {
    expect(impliedRate(155_730_000n, 100_000n)).toBe(15_573_000n);
  });

  it('rounds half-up: 2,000.00 ARS for 3.00 USD is 6,666,667 (AC-14)', () => {
    expect(impliedRate(200_000n, 300n)).toBe(6_666_667n);
  });

  it('rounds an exact tie up (AC-14)', () => {
    // 1 / 20000 * 10000 = 0.5 exactly
    expect(impliedRate(1n, 20_000n)).toBe(1n);
    // 3 * 10000 / 20000 = 1.5 exactly
    expect(impliedRate(3n, 20_000n)).toBe(2n);
  });

  it('returns null for a result of 0 or above RATE_MAX_SCALED (AC-15)', () => {
    expect(impliedRate(1n, 30_000n)).toBeNull();
    expect(impliedRate(RATE_MAX_SCALED + 1n, 10_000n)).toBeNull();
  });

  it('returns the boundary values 1 and RATE_MAX_SCALED (AC-15)', () => {
    expect(impliedRate(1n, 20_000n)).toBe(1n);
    expect(impliedRate(RATE_MAX_SCALED, 10_000n)).toBe(RATE_MAX_SCALED);
  });

  it('throws a RangeError for zero and negative arguments (FR-03)', () => {
    for (const [ars, usd] of [
      [0n, 100n],
      [100n, 0n],
      [-1n, 100n],
      [100n, -1n],
    ] as const) {
      expect(() => impliedRate(ars, usd), `${ars}/${usd}`).toThrow(RangeError);
    }
  });
});

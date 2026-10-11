import { describe, expect, it } from 'vitest';
import { convertMinorUnits } from '../src/money/convert-minor-units';

describe('convertMinorUnits', () => {
  it('converts 50,000.00 ARS at 1,000.0000 to 50.00 USD and back (AC-11)', () => {
    expect(convertMinorUnits(5_000_000n, 'ARS', 10_000_000n)).toBe(5_000n);
    expect(convertMinorUnits(5_000n, 'USD', 10_000_000n)).toBe(5_000_000n);
  });

  it('rounds half up: 0.5 cent goes to 1, 0.4 cent stays 0 (AC-11)', () => {
    // 500 centavos at 1,000.0000 is exactly 0.5 cent.
    expect(convertMinorUnits(500n, 'ARS', 10_000_000n)).toBe(1n);
    expect(convertMinorUnits(499n, 'ARS', 10_000_000n)).toBe(0n);
    // 1 cent at 1,000.5000 is 1,000.5 centavos.
    expect(convertMinorUnits(1n, 'USD', 10_005_000n)).toBe(1_001n);
  });

  it('rounds half up on the absolute value for negative amounts (AC-11)', () => {
    expect(convertMinorUnits(-500n, 'ARS', 10_000_000n)).toBe(-1n);
    expect(convertMinorUnits(-499n, 'ARS', 10_000_000n)).toBe(0n);
    expect(convertMinorUnits(-5_000n, 'USD', 10_000_000n)).toBe(-5_000_000n);
  });

  it('keeps 0 as 0', () => {
    expect(convertMinorUnits(0n, 'ARS', 10_000_000n)).toBe(0n);
  });

  it('rejects a rate of 0 or less', () => {
    expect(() => convertMinorUnits(100n, 'ARS', 0n)).toThrow(RangeError);
    expect(() => convertMinorUnits(100n, 'USD', -1n)).toThrow(RangeError);
  });
});

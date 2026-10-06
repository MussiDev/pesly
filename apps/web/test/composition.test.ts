import { describe, expect, it } from 'vitest';
import { composeByInstrumentType } from '../src/features/investments/composition';

function holding(instrumentType: string, value: string | null, valuationCurrency = 'ARS') {
  return { instrumentType, value, valuationCurrency };
}

const sum = (segments: readonly { basisPoints: bigint }[]) =>
  segments.reduce((total, segment) => total + segment.basisPoints, 0n);

describe('composeByInstrumentType (AC-30, AC-31, AC-32)', () => {
  it('groups priced holdings by instrument type and gives each share in basis points', () => {
    const result = composeByInstrumentType([
      holding('stock', '60000'),
      holding('bond', '30000'),
      holding('crypto', '10000'),
    ]);

    expect(result).toEqual([
      {
        currency: 'ARS',
        segments: [
          { instrumentType: 'stock', basisPoints: 6000n },
          { instrumentType: 'bond', basisPoints: 3000n },
          { instrumentType: 'crypto', basisPoints: 1000n },
        ],
      },
    ]);
  });

  it('adds holdings of the same type into one segment', () => {
    const [only] = composeByInstrumentType([
      holding('stock', '1000'),
      holding('stock', '3000'),
      holding('bond', '4000'),
    ]);

    expect(only?.segments).toEqual([
      { instrumentType: 'bond', basisPoints: 5000n },
      { instrumentType: 'stock', basisPoints: 5000n },
    ]);
  });

  it('keeps each valuation currency apart and never adds one to another', () => {
    const result = composeByInstrumentType([
      holding('stock', '1000', 'ARS'),
      holding('stock', '9000', 'USD'),
      holding('bond', '1000', 'ARS'),
    ]);

    expect(result.map((entry) => entry.currency)).toEqual(['ARS', 'USD']);
    expect(result[0]?.segments).toEqual([
      { instrumentType: 'bond', basisPoints: 5000n },
      { instrumentType: 'stock', basisPoints: 5000n },
    ]);
    expect(result[1]?.segments).toEqual([{ instrumentType: 'stock', basisPoints: 10000n }]);
  });

  it('error: a null, malformed, zero or negative value is left out of the chart', () => {
    const result = composeByInstrumentType([
      holding('stock', null),
      holding('stock', 'abc'),
      holding('stock', '12.5'),
      holding('stock', '0'),
      holding('stock', '-500'),
      holding('bond', '2000'),
    ]);

    expect(result).toEqual([
      { currency: 'ARS', segments: [{ instrumentType: 'bond', basisPoints: 10000n }] },
    ]);
  });

  it('error: with no priced holding there is nothing to chart', () => {
    expect(composeByInstrumentType([])).toEqual([]);
    expect(composeByInstrumentType([holding('stock', null), holding('bond', 'x')])).toEqual([]);
  });

  it('error: an uneven division puts the leftover on the largest share and still sums to 10000', () => {
    const [only] = composeByInstrumentType([
      holding('a', '1'),
      holding('b', '1'),
      holding('c', '1'),
    ]);

    expect(only?.segments.map((segment) => segment.basisPoints)).toEqual([3334n, 3333n, 3333n]);
    expect(sum(only?.segments ?? [])).toBe(10000n);
  });

  it('sums to exactly 10000 for awkward values and orders by size, then by type', () => {
    const [only] = composeByInstrumentType([
      holding('stock', '123456789'),
      holding('bond', '987654321'),
      holding('crypto', '55555'),
      holding('other', '7'),
    ]);

    expect(sum(only?.segments ?? [])).toBe(10000n);
    expect(only?.segments.map((segment) => segment.instrumentType)).toEqual([
      'bond',
      'stock',
      'crypto',
      'other',
    ]);
  });

  it('handles values far beyond what a float can hold exactly', () => {
    const big = '900000000000000000';
    const [only] = composeByInstrumentType([holding('stock', big), holding('bond', big)]);

    expect(only?.segments).toEqual([
      { instrumentType: 'bond', basisPoints: 5000n },
      { instrumentType: 'stock', basisPoints: 5000n },
    ]);
  });

  it('passes an instrument type this build does not know through as its own key', () => {
    const [only] = composeByInstrumentType([holding('future_type', '100')]);

    expect(only?.segments).toEqual([{ instrumentType: 'future_type', basisPoints: 10000n }]);
  });
});

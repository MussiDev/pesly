import { describe, expect, it } from 'vitest';
import {
  BACKOFF_CAP_SECONDS,
  BACKOFF_START_SECONDS,
  retryDelaySeconds,
} from '../src/lib/sync/backoff';

describe('retryDelaySeconds', () => {
  it('starts at 5 s, doubles, and stays at the 300 s cap (NFR-01)', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 50].map(retryDelaySeconds)).toEqual([
      5, 10, 20, 40, 80, 160, 300, 300, 300,
    ]);
    expect(BACKOFF_START_SECONDS).toBe(5);
    expect(BACKOFF_CAP_SECONDS).toBe(300);
  });

  it('answers the start delay for 0, a negative and a non-integer attempt (invalid input)', () => {
    expect([0, -3, 2.5, Number.NaN].map(retryDelaySeconds)).toEqual([5, 5, 5, 5]);
  });
});

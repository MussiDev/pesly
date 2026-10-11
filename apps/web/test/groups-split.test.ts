import { describe, expect, it } from 'vitest';
import { parsePercentageInput } from '../src/features/groups/split/percentage-input';
import {
  createSplitState,
  switchSplitMode,
  type SplitState,
} from '../src/features/groups/split/split-state';
import {
  buildSplit,
  exactRemaining,
  percentageTotal,
  previewShares,
} from '../src/features/groups/split/split-request';

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const C = '00000000-0000-4000-8000-00000000000c';
const LOCALE = 'en-US';

function state(overrides: Partial<SplitState> = {}): SplitState {
  return { ...createSplitState(10_000n, A, [A, B, C]), ...overrides };
}

describe('percentage input', () => {
  it('parses decimal text to basis points without a float step', () => {
    expect(parsePercentageInput('33.33')).toBe(3333);
    expect(parsePercentageInput('50')).toBe(5000);
    expect(parsePercentageInput('0.5')).toBe(50);
    expect(parsePercentageInput('100')).toBe(10_000);
    expect(parsePercentageInput('0')).toBe(0);
  });

  it.each(['12.345', 'abc', '', '-1', '100.01', '101', '1e2', '1.', '.5'])('rejects %j', (text) => {
    expect(parsePercentageInput(text)).toBeNull();
  });
});

describe('equal mode', () => {
  it('gives the leftover cent of 100.00 over 3 members to the payer first', () => {
    const s = state({ mode: 'equal' });
    const shares = previewShares(s, 10_000n, B, LOCALE);
    expect(shares).toEqual([
      { memberId: B, amount: 3334n },
      { memberId: A, amount: 3333n },
      { memberId: C, amount: 3333n },
    ]);
  });

  it('builds the shared equal body', () => {
    const result = buildSplit(state({ mode: 'equal' }), 10_000n, A, LOCALE);
    expect(result).toEqual({ ok: true, split: { mode: 'equal', memberIds: [A, B, C] } });
  });

  it('rejects an empty selection with a field error', () => {
    const result = buildSplit(state({ selectedMemberIds: [] }), 10_000n, A, LOCALE);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toEqual([{ memberId: null, path: 'groups.split.errors.noMembers' }]);
    }
  });
});

describe('percentage mode', () => {
  it('reports a difference of 1 and no body at 9999 basis points', () => {
    const s = state({ mode: 'percentage', values: { [A]: '33.33', [B]: '33.33', [C]: '33.33' } });
    expect(percentageTotal(s)).toBe(1n);
    const result = buildSplit(s, 10_000n, A, LOCALE);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.difference).toBe(1n);
      expect(result.errors[0]?.path).toBe('groups.split.errors.percentageTotal');
    }
  });

  it('builds a body when the percentages total 100', () => {
    const s = state({ mode: 'percentage', values: { [A]: '50', [B]: '25.5', [C]: '24.5' } });
    expect(percentageTotal(s)).toBe(0n);
    expect(buildSplit(s, 10_000n, A, LOCALE)).toEqual({
      ok: true,
      split: {
        mode: 'percentage',
        shares: [
          { memberId: A, basisPoints: 5000 },
          { memberId: B, basisPoints: 2550 },
          { memberId: C, basisPoints: 2450 },
        ],
      },
    });
  });

  it('flags 12.345 and abc as field errors on their member', () => {
    const s = state({ mode: 'percentage', values: { [A]: '12.345', [B]: 'abc', [C]: '' } });
    const result = buildSplit(s, 10_000n, A, LOCALE);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.map((e) => e.memberId)).toEqual([A, B, C]);
      expect(result.errors.every((e) => e.path === 'groups.split.errors.percentageInvalid')).toBe(
        true,
      );
    }
  });
});

describe('exact mode', () => {
  it('builds a body when the amounts add up', () => {
    const s = state({ mode: 'exact', values: { [A]: '50.00', [B]: '30.00', [C]: '20.00' } });
    expect(exactRemaining(s, 10_000n, LOCALE)).toBe(0n);
    expect(buildSplit(s, 10_000n, A, LOCALE)).toEqual({
      ok: true,
      split: {
        mode: 'exact',
        shares: [
          { memberId: A, amount: '5000' },
          { memberId: B, amount: '3000' },
          { memberId: C, amount: '2000' },
        ],
      },
    });
  });

  it('reports the remaining amount on a shortfall', () => {
    const s = state({ mode: 'exact', values: { [A]: '50.00', [B]: '30.00', [C]: '19.99' } });
    expect(exactRemaining(s, 10_000n, LOCALE)).toBe(1n);
    const result = buildSplit(s, 10_000n, A, LOCALE);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.difference).toBe(1n);
      expect(result.errors[0]?.path).toBe('groups.split.errors.amountTotal');
    }
  });

  it('reports a negative remaining when the amounts overshoot', () => {
    const s = state({ mode: 'exact', values: { [A]: '60.00', [B]: '30.00', [C]: '20.00' } });
    expect(exactRemaining(s, 10_000n, LOCALE)).toBe(-1000n);
  });

  it('rejects negative and non numeric amounts', () => {
    const s = state({ mode: 'exact', values: { [A]: '-5.00', [B]: 'abc', [C]: '' } });
    const result = buildSplit(s, 10_000n, A, LOCALE);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.map((e) => e.memberId)).toEqual([A, B, C]);
      expect(result.errors.every((e) => e.path === 'groups.split.errors.amountInvalid')).toBe(true);
    }
  });
});

describe('mode switching', () => {
  it('keeps amount, payer and selection and clears per-member values', () => {
    const s = state({ mode: 'exact', values: { [A]: '50.00', [B]: '50.00' } });
    const next = switchSplitMode(s, 'percentage');
    expect(next.mode).toBe('percentage');
    expect(next.amount).toBe(10_000n);
    expect(next.payerMemberId).toBe(A);
    expect(next.selectedMemberIds).toEqual([A, B, C]);
    expect(next.values).toEqual({});
  });
});

describe('amount guard', () => {
  it('returns an error for a non positive total', () => {
    const result = buildSplit(state({ mode: 'equal' }), 0n, A, LOCALE);
    expect(result.ok).toBe(false);
  });
});

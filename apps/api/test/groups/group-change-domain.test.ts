import { describe, expect, it } from 'vitest';
import {
  assertChangedMembersActive,
  expenseChangedMembers,
  GroupRecordFormerMember,
  settlementChangedMembers,
} from '../../src/groups';

const ANA = 'member-ana';
const PEDRO = 'member-pedro';

describe('settlementChangedMembers', () => {
  it('reports both parties of a consolidated settlement whose legs have equal minor units in opposite currencies', () => {
    // ARS +500 and USD -500: summed across currencies the delta would net to zero.
    const effect = {
      fromMemberId: PEDRO,
      toMemberId: ANA,
      legs: [
        { currency: 'ARS' as const, amount: 500n },
        { currency: 'USD' as const, amount: -500n },
      ],
    };

    expect(settlementChangedMembers(effect, null).sort()).toEqual([ANA, PEDRO].sort());
    expect(() => {
      assertChangedMembersActive(settlementChangedMembers(effect, null), new Set([ANA]));
    }).toThrow(GroupRecordFormerMember);
  });

  it('reports no member when the effect is identical (a date-only change)', () => {
    const effect = {
      fromMemberId: PEDRO,
      toMemberId: ANA,
      legs: [{ currency: 'ARS' as const, amount: 500n }],
    };

    expect(settlementChangedMembers(effect, { ...effect })).toEqual([]);
  });

  it('reports the parties when only one currency leg changes', () => {
    const before = {
      fromMemberId: PEDRO,
      toMemberId: ANA,
      legs: [
        { currency: 'ARS' as const, amount: 500n },
        { currency: 'USD' as const, amount: -500n },
      ],
    };
    const after = {
      ...before,
      legs: [before.legs[0] ?? { currency: 'ARS' as const, amount: 500n }],
    };

    expect(settlementChangedMembers(before, after).sort()).toEqual([ANA, PEDRO].sort());
  });
});

describe('expenseChangedMembers', () => {
  it('is computed in one currency: an unchanged expense changes nobody', () => {
    const effect = {
      payerMemberId: ANA,
      amount: 1_000n,
      shares: [
        { memberId: ANA, amount: 500n },
        { memberId: PEDRO, amount: 500n },
      ],
    };

    expect(expenseChangedMembers(effect, { ...effect })).toEqual([]);
    expect(expenseChangedMembers(effect, null).sort()).toEqual([ANA, PEDRO].sort());
  });
});

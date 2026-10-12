import { describe, expect, it } from 'vitest';
import type { BalanceSources, BalanceSourcesByCurrency } from '../../src/groups';
import type { GroupBalanceSource } from '../../src/dashboard/application/ports/group-balance-reader';
import { groupTotalsOf, netOf } from '../../src/dashboard/domain/group-totals';
import { buildGroups } from '../../src/dashboard/application/build-groups';

const ME = 'member-me';
const OTHER = 'member-other';

function side(paid: bigint, shares: bigint, legs: bigint): BalanceSources {
  return {
    paid: new Map(paid === 0n ? [] : [[ME, paid]]),
    shares: new Map(shares === 0n ? [] : [[ME, shares]]),
    legs: new Map(legs === 0n ? [] : [[ME, legs]]),
  };
}

function group(
  groupId: string,
  ars: [bigint, bigint, bigint],
  usd: [bigint, bigint, bigint] = [0n, 0n, 0n],
): GroupBalanceSource {
  const sources: BalanceSourcesByCurrency = { ARS: side(...ars), USD: side(...usd) };
  return { groupId, memberId: ME, sources };
}

describe('group totals', () => {
  it('(AC-36) keeps what is owed to you and what you owe per currency', () => {
    // Group A: the user paid 30,000.00 ARS for another member. Group B: the user owes 50.00 USD.
    const entries = [group('a', [3000000n, 0n, 0n]), group('b', [0n, 0n, 0n], [0n, 5000n, 0n])];

    expect(groupTotalsOf(entries)).toEqual({
      owedToYou: { ARS: 3000000n, USD: 0n },
      youOwe: { ARS: 0n, USD: 5000n },
    });
  });

  it('(AC-37) never nets one group against another, while the net is their difference', () => {
    const entries = [group('a', [3000000n, 0n, 0n]), group('b', [0n, 2000000n, 0n])];

    const totals = groupTotalsOf(entries);

    expect(totals.owedToYou.ARS).toBe(3000000n);
    expect(totals.youOwe.ARS).toBe(2000000n);
    expect(netOf(totals)).toEqual({ ARS: 1000000n, USD: 0n });
  });

  it('(AC-38) a group with a zero balance contributes nothing and a left group with a balance counts', () => {
    const settled = group('settled', [1000n, 1000n, 0n]);
    const left = group('left', [0n, 700n, 0n]);

    expect(groupTotalsOf([settled])).toEqual({
      owedToYou: { ARS: 0n, USD: 0n },
      youOwe: { ARS: 0n, USD: 0n },
    });
    expect(groupTotalsOf([settled, left]).youOwe.ARS).toBe(700n);
  });

  it('(FR-11) counts the settlement legs with their sign, as the 04e formula does', () => {
    // Paid 5,000.00, share 2,000.00, signed legs +500.00.
    const entries = [group('a', [500000n, 200000n, 50000n])];

    expect(groupTotalsOf(entries).owedToYou.ARS).toBe(350000n);
  });

  it('ignores another member of the same group', () => {
    const sources: BalanceSourcesByCurrency = {
      ARS: { paid: new Map([[OTHER, 900n]]), shares: new Map(), legs: new Map() },
      USD: side(0n, 0n, 0n),
    };

    expect(groupTotalsOf([{ groupId: 'a', memberId: ME, sources }]).owedToYou.ARS).toBe(0n);
  });

  it('buildGroups returns the section and the net for the net worth', () => {
    const section = buildGroups([group('a', [3000000n, 0n, 0n]), group('b', [0n, 2000000n, 0n])]);

    expect(section.owedToYou.ARS).toBe(3000000n);
    expect(section.youOwe.ARS).toBe(2000000n);
    expect(section.net).toEqual({ ARS: 1000000n, USD: 0n });
  });
});

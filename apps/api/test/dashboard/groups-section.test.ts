import { describe, expect, it } from 'vitest';
import type { GroupBalanceReader } from '../../src/dashboard/application/ports/group-balance-reader';
import { loadGroups } from '../../src/dashboard/application/build-groups';
import { readScope } from '../movements/db-fixtures';

describe('groups section', () => {
  it('(FR-16) a database error rejects the whole read and returns no group', async () => {
    const failing: GroupBalanceReader = {
      sourcesOf: () => Promise.reject(new Error('database down')),
    };

    await expect(
      loadGroups(
        { groupBalances: failing },
        await readScope('11111111-1111-1111-1111-111111111111'),
      ),
    ).rejects.toThrow('database down');
  });

  it('reads through the reader with the issued scope', async () => {
    const scope = await readScope('11111111-1111-1111-1111-111111111111');
    let seen: unknown = null;
    const reader: GroupBalanceReader = {
      sourcesOf: (given) => {
        seen = given;
        return Promise.resolve([]);
      },
    };

    const section = await loadGroups({ groupBalances: reader }, scope);

    expect(seen).toBe(scope);
    expect(section.net).toEqual({ ARS: 0n, USD: 0n });
  });
});
